//! The QMI lane: answers the `QMI` verb on the reader thread, straight from
//! the shared service registry.
//!
//! - **No modem lock, no AT lane, no long-flag gate.** QMI never touches
//!   smd11, so a reader answers a QMI request itself, in a millisecond or two,
//!   while an AT job holds the AT lane or a scan runs. That independence is
//!   the reason the lane exists.
//! - **The registry starts off the serving path.** `Registry::start_qrtr`
//!   does a synchronous name-server lookup bounded at 500 ms; run inline it
//!   could delay the first `accept` on a modem whose QRTR is slow to answer.
//!   So a `qmi-start` thread builds it after the AT lane is up and publishes
//!   it through a `OnceLock`. Until then (a few milliseconds on the device) a
//!   valid request answers `modem_not_ready`, and the AT path never waits.
//! - **QMI can never starve AT of readers.** A QMI request is answered on a
//!   reader thread, and against a listed-but-silent service each read can
//!   wait out its timeout. So at most `MAX_IN_FLIGHT` QMI requests run at
//!   once (a non-blocking try-acquire); over the cap the reader answers
//!   `ERR command_failed` at once, which the `qmi` client treats as "broker
//!   unreachable" and runs the read in its own process. Every request also
//!   has an overall `DEADLINE` (below the client's 3 s reply timeout): the
//!   reads left when it passes fail `modem_not_ready`. With the registry's
//!   per-service fast-fail circuit, a reader is held for at most ~2 s, and at
//!   least `MAX_READERS - MAX_IN_FLIGHT` readers are always left for AT. The
//!   snapshot sampler runs on its own thread, not a reader, and does not
//!   count against the cap.
//! - **A lane that never started answers `ERR command_failed`** too, so the
//!   client falls back instead of reading `modem_not_ready` forever while the
//!   capability file still advertises `qmi=1`. Exiting instead would take the
//!   AT path down over a QMI-only failure (a thread that cannot be spawned is
//!   resource exhaustion, which a procd respawn would likely meet again).
//! - **The snapshot sampler** (`qmi_snapshot`) is started with it and shares
//!   the registry: it publishes the poller's sidecar and the CGI json.
//! - **Logging is state changes only.** The same thread then watches the
//!   registry: it logs when a service changes state and when the SSR counter
//!   moves, never per request.

use crate::at::output::Code;
use crate::common::log::Logger;
use crate::common::proto::{mono_ms, Reply};
use super::qmi_snapshot;
use crate::qmi::query;
use crate::qmi::registry::{Registry, SigConfig, SvcState};
use crate::qmi::service_name;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering::SeqCst};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

/// QMI requests answered at once; the rest of the reader pool stays for AT.
pub(crate) const MAX_IN_FLIGHT: usize = 4;
/// Overall budget of one QMI request. Below the client's 3 s reply timeout
/// with a second to spare: a send blocked in the socket's 1 s send timeout
/// is the one wait a deadline cannot cut short.
pub(crate) const DEADLINE: Duration = Duration::from_secs(2);
/// At most one "busy" warning per this many ms.
const BUSY_LOG_EVERY_MS: u64 = 60_000;

/// How often the monitor looks at the registry (five mutex reads).
const MONITOR_EVERY: Duration = Duration::from_millis(500);
/// Retry cadence for a signal config left unapplied with NAS up.
const CFG_RETRY_EVERY: Duration = Duration::from_secs(30);

pub(crate) struct QmiLane {
    registry: Arc<OnceLock<Arc<Registry>>>,
    /// The start thread could not be spawned: the registry never arrives.
    dead: bool,
    cap: usize,
    deadline: Duration,
    in_flight: AtomicUsize,
    /// Most requests ever in flight at once (tests).
    peak: AtomicUsize,
    last_busy_log: AtomicU64,
    log: Arc<Logger>,
}

/// One held in-flight slot.
struct InFlight<'a>(&'a AtomicUsize);

impl Drop for InFlight<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, SeqCst);
    }
}

impl QmiLane {
    /// Production: builds the real QRTR registry on a background thread.
    pub(crate) fn start(log: Arc<Logger>) -> QmiLane {
        let cell: Arc<OnceLock<Arc<Registry>>> = Arc::new(OnceLock::new());
        let c = cell.clone();
        let lane_log = log.clone();
        let spawned = std::thread::Builder::new()
            .name("qmi-start".into())
            .stack_size(crate::qmi::registry::THREAD_STACK)
            .spawn(move || {
                // The daemon's registry adds the two internal WDS clients the
                // sampler binds for Data Used; the client fallback never has them.
                let reg = Arc::new(Registry::start_qrtr_daemon());
                let _ = c.set(reg.clone());
                // Daemon lane only: hold the signal config so the modem's
                // shared signal cache stays live. NAS not up yet is fine, the
                // held config replays when it is found.
                let _ = reg.hold_config();
                // The snapshot sampler (poller sidecar + CGI json) shares the
                // registry; a failure to start it costs the sidecar only.
                if let Err(e) = qmi_snapshot::spawn(reg.clone(), qmi_snapshot::Paths::production(), log.clone()) {
                    log.error(&format!("cannot start the qmi snapshot sampler: {e}"));
                }
                monitor(&reg, &log);
            });
        let dead = match spawned {
            Ok(_) => false,
            Err(e) => {
                // Never starts: every QMI request answers ERR so the client
                // falls back to its own registry. AT is unaffected.
                lane_log.error(&format!("cannot start the QMI lane: {e}"));
                true
            }
        };
        QmiLane::new(cell, dead, lane_log)
    }

    fn new(registry: Arc<OnceLock<Arc<Registry>>>, dead: bool, log: Arc<Logger>) -> QmiLane {
        QmiLane {
            registry,
            dead,
            cap: MAX_IN_FLIGHT,
            deadline: DEADLINE,
            in_flight: AtomicUsize::new(0),
            peak: AtomicUsize::new(0),
            last_busy_log: AtomicU64::new(0),
            log,
        }
    }

    /// A lane over an existing registry, with no background threads (tests).
    #[cfg(test)]
    pub(crate) fn with_registry(reg: Arc<Registry>) -> QmiLane {
        let cell = Arc::new(OnceLock::new());
        let _ = cell.set(reg);
        QmiLane::new(cell, false, Arc::new(Logger::new("test")))
    }

    /// A lane whose registry never arrived (tests).
    #[cfg(test)]
    pub(crate) fn starting() -> QmiLane {
        QmiLane::new(Arc::new(OnceLock::new()), false, Arc::new(Logger::new("test")))
    }

    /// A lane whose start thread could not be spawned (tests).
    #[cfg(test)]
    pub(crate) fn dead() -> QmiLane {
        QmiLane::new(Arc::new(OnceLock::new()), true, Arc::new(Logger::new("test")))
    }

    /// Overrides the cap and the deadline (tests).
    #[cfg(test)]
    pub(crate) fn limits(mut self, cap: usize, deadline: Duration) -> QmiLane {
        self.cap = cap;
        self.deadline = deadline;
        self
    }

    /// Most QMI requests that were ever in flight at once (tests).
    #[cfg(test)]
    pub(crate) fn peak(&self) -> usize {
        self.peak.load(SeqCst)
    }

    /// QMI requests in flight right now (tests).
    #[cfg(test)]
    pub(crate) fn in_flight(&self) -> usize {
        self.in_flight.load(SeqCst)
    }

    fn try_acquire(&self) -> Option<InFlight<'_>> {
        let cap = self.cap;
        self.in_flight.fetch_update(SeqCst, SeqCst, |n| (n < cap).then_some(n + 1)).ok().map(|n| {
            self.peak.fetch_max(n + 1, SeqCst);
            InFlight(&self.in_flight)
        })
    }

    /// The reply to a decoded `QMI` request. The arguments are re-validated
    /// here: the socket is the trust boundary, not the client. `ERR` (not a
    /// `RES`) means "run it yourself": the client falls back in-process.
    pub(crate) fn answer(&self, args: &[String]) -> Reply {
        if query::parse_reads(args).is_err() {
            return Reply::Res(false, query::fail_envelope("bad_args").into_bytes());
        }
        if self.dead {
            return Reply::Err(Code::CommandFailed);
        }
        let reg = match self.registry.get() {
            Some(r) => r,
            None => return Reply::Res(false, query::fail_envelope("modem_not_ready").into_bytes()),
        };
        let _slot = match self.try_acquire() {
            Some(s) => s,
            None => {
                let now = mono_ms();
                let last = self.last_busy_log.load(SeqCst);
                if (last == 0 || now.saturating_sub(last) >= BUSY_LOG_EVERY_MS)
                    && self.last_busy_log.compare_exchange(last, now.max(1), SeqCst, SeqCst).is_ok()
                {
                    self.log.warn(&format!("qmi lane busy ({} in flight); a client read in-process", self.cap));
                }
                return Reply::Err(Code::CommandFailed);
            }
        };
        let (ok, json) = query::answer_by(Some(reg), args, Some(Instant::now() + self.deadline));
        Reply::Res(ok, json.into_bytes())
    }
}

/// Remembers the registry's last observed state and says what changed.
pub(crate) struct Monitor {
    states: Vec<(u32, SvcState)>,
    ssr: u64,
    sig: SigConfig,
}

impl Monitor {
    pub(crate) fn new() -> Monitor {
        Monitor { states: Vec::new(), ssr: 0, sig: SigConfig::Off }
    }

    /// Log lines (level, text) for what changed since the last call. The
    /// first call reports the starting picture.
    pub(crate) fn poll(&mut self, reg: &Registry) -> Vec<(&'static str, String)> {
        let now = reg.states();
        let ssr = reg.ssr_count();
        let mut out = Vec::new();
        if self.states.is_empty() {
            let line: Vec<String> = now.iter().map(|(s, st)| format!("{}={}", service_name(*s), st.as_str())).collect();
            out.push(("info", format!("qmi lane up: {}", line.join(" "))));
        } else {
            for ((svc, old), (_, new)) in self.states.iter().zip(now.iter()) {
                if old != new {
                    let lvl = if *new == SvcState::Down { "warn" } else { "info" };
                    out.push((lvl, format!("qmi {} {} -> {}", service_name(*svc), old.as_str(), new.as_str())));
                }
            }
            if ssr != self.ssr {
                out.push(("warn", format!("qmi ssr detected (episode {ssr})")));
            }
        }
        let sig = reg.sig_config_state();
        if sig != self.sig {
            match sig {
                SigConfig::Held => out.push(("info", "qmi nas signal config applied".to_string())),
                SigConfig::Unsupported => out.push(("warn", "qmi nas signal config unsupported by the modem".to_string())),
                SigConfig::Rejected(c) => out.push(("warn", format!("qmi nas signal config rejected (qmi {c:#06x})"))),
                SigConfig::Off => {}
            }
            self.sig = sig;
        }
        self.states = now;
        self.ssr = ssr;
        out
    }
}

fn monitor(reg: &Registry, log: &Logger) -> ! {
    let mut m = Monitor::new();
    let mut last_cfg_retry = std::time::Instant::now();
    loop {
        // A replay that timed out on a rebuilt socket leaves the config Off
        // with NAS up; re-send it, at most every CFG_RETRY_EVERY.
        if reg.sig_config_state() == SigConfig::Off
            && reg.state(crate::qmi::SVC_NAS) == Some(SvcState::Up)
            && last_cfg_retry.elapsed() >= CFG_RETRY_EVERY
        {
            last_cfg_retry = std::time::Instant::now();
            let _ = reg.hold_config();
        }
        for (lvl, line) in m.poll(reg) {
            match lvl {
                "warn" => log.warn(&line),
                _ => log.info(&line),
            }
        }
        std::thread::sleep(MONITOR_EVERY);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::qmi::fake::{r1_net, start_registry};
    use crate::qmi::SVC_NAS;
    use std::time::Instant;

    fn sv(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }

    fn body(r: Reply) -> (bool, String) {
        match r {
            Reply::Res(ok, b) => (ok, String::from_utf8(b).unwrap()),
            _ => panic!("expected RES"),
        }
    }

    #[test]
    fn a_lane_still_starting_refuses_politely_and_checks_args_first() {
        let lane = QmiLane::starting();
        assert_eq!(body(lane.answer(&sv(&["serving"]))), (false, query::fail_envelope("modem_not_ready")));
        assert_eq!(body(lane.answer(&sv(&["bogus"]))), (false, query::fail_envelope("bad_args")));
        assert_eq!(body(lane.answer(&[])), (false, query::fail_envelope("bad_args")));
    }

    #[test]
    fn a_lane_that_never_started_tells_the_client_to_fall_back() {
        let lane = QmiLane::dead();
        assert!(matches!(lane.answer(&sv(&["serving"])), Reply::Err(Code::CommandFailed)));
        assert_eq!(body(lane.answer(&sv(&["bogus"]))), (false, query::fail_envelope("bad_args")));
    }

    #[test]
    fn the_deadline_bounds_a_request_against_a_silent_service() {
        let lane = QmiLane::with_registry(crate::qmi::fake::silent_registry(300, 0)).limits(4, Duration::from_millis(500));
        let t = Instant::now();
        // Seven requests of 300 ms each without a deadline; it stops at 500.
        let (ok, j) = body(lane.answer(&sv(&["serving", "cell", "ca", "rf", "signal"])));
        let el = t.elapsed();
        assert!(!ok, "{j}");
        assert_eq!(j, query::fail_envelope("modem_not_ready"));
        assert!(el >= Duration::from_millis(450) && el < Duration::from_millis(900), "{el:?}");
    }

    #[test]
    fn requests_over_the_cap_answer_err_at_once() {
        let lane = Arc::new(QmiLane::with_registry(crate::qmi::fake::silent_registry(400, 0)).limits(2, Duration::from_secs(2)));
        let mut held = Vec::new();
        for _ in 0..2 {
            let l = lane.clone();
            held.push(std::thread::spawn(move || l.answer(&sv(&["serving"]))));
        }
        let end = Instant::now() + Duration::from_secs(2);
        while lane.in_flight() < 2 && Instant::now() < end {
            std::thread::sleep(Duration::from_millis(1));
        }
        let t = Instant::now();
        assert!(matches!(lane.answer(&sv(&["serving"])), Reply::Err(Code::CommandFailed)));
        assert!(t.elapsed() < Duration::from_millis(50));
        for h in held {
            assert!(matches!(h.join().unwrap(), Reply::Res(false, _)));
        }
        assert_eq!(lane.peak(), 2);
        assert_eq!(lane.in_flight(), 0, "slots are released");
        // Free again.
        assert!(matches!(lane.answer(&sv(&["serving"])), Reply::Res(false, _)));
    }

    #[test]
    fn a_lane_answers_reads_from_its_registry() {
        let lane = QmiLane::with_registry(start_registry(&r1_net()));
        let (ok, j) = body(lane.answer(&sv(&["cell"])));
        assert!(ok, "{j}");
        assert!(j.contains("\"cell\":{\"lte\":{\"pci\":295,\"earfcn\":150"), "{j}");
    }

    #[test]
    fn the_monitor_reports_state_changes_and_ssrs_once() {
        let net = r1_net();
        let reg = start_registry(&net);
        let mut m = Monitor::new();
        let first = m.poll(&reg);
        assert_eq!(first.len(), 1);
        assert!(first[0].1.starts_with("qmi lane up: nas=up dms=up uim=up wds=up dsd=up"), "{first:?}");
        assert!(m.poll(&reg).is_empty(), "no change, no log");
        net.del_server(SVC_NAS);
        let end = Instant::now() + Duration::from_secs(2);
        while reg.state(SVC_NAS) == Some(SvcState::Up) && Instant::now() < end {
            std::thread::sleep(Duration::from_millis(2));
        }
        let lines = m.poll(&reg);
        assert!(lines.iter().any(|(l, t)| *l == "warn" && t == "qmi nas up -> down"), "{lines:?}");
        assert!(lines.iter().any(|(_, t)| t.starts_with("qmi ssr detected")), "{lines:?}");
        assert!(m.poll(&reg).is_empty());
        net.add_server(SVC_NAS, 0, 0x77);
        let end = Instant::now() + Duration::from_secs(2);
        while reg.state(SVC_NAS) != Some(SvcState::Up) && Instant::now() < end {
            std::thread::sleep(Duration::from_millis(2));
        }
        assert_eq!(m.poll(&reg), vec![("info", "qmi nas down -> up".to_string())]);
    }
}
