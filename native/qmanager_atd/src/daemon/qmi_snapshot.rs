//! The QMI snapshot engine: a sampler thread in the QMI lane that reads the
//! bundle (serving + cell + CA + RF: four requests, about 1.5 ms) and
//! publishes it for the poller and the CGIs, so they get LTE identity, signal
//! and CA at most 2 s old in every poller tier, with no AT and no fork.
//!
//! Two files, written atomically (`<path>.new`, O_EXCL + O_NOFOLLOW, rename),
//! JSON first and env right after it so the env is never older than the JSON
//! it mirrors:
//!
//! - `/var/run/qmanager/qmi.env` (root-only dir, made 0700 and verified before
//!   each write; the poller sources it) follows the sidecar contract of `ping.env` and
//!   `ondemand.env` (`cq_env_source`): every line a single-quoted assignment,
//!   the last line `qm_sidecar_end='1'`, names from the compiled `NAMES` list
//!   (all `qmi_`-prefixed, never the poller's `lte_*` / `t2_*`), every value
//!   an integer or empty, except `qmi_state` (the token `up|down|unavailable`;
//!   the contract allows any single-quoted text, the poller compares it with
//!   `case`). Never a float, never `N/A`.
//! - `/tmp/qmanager_qmi.json`: the same data for CGIs, plus the full bundle.
//!
//! Semantics.
//! - `qmi_mono` is the CLOCK_BOOTTIME second (the same clock as
//!   `/proc/uptime`, which the poller compares it with) of the last read that
//!   succeeded, so a reader sees the data's age, not the sampler's heartbeat
//!   (the file's mtime is that). Empty until the first success.
//! - `qmi_state` is `up` when this cycle's read succeeded, `down` when it
//!   failed (an SSR window, the modem not ready), `unavailable` when QRTR or
//!   the NAS service does not exist. On `down` / `unavailable` the previous
//!   values are kept and republished, `qmi_ssr_count` keeps counting; the
//!   files are never deleted, so a reader never sees a missing file.
//! - `qmi_registered` is `1` / `0` from NAS serving system, empty when
//!   serving could not be read. Signal values (rsrp / rsrq / rssi, whole dBm
//!   or dB) are empty unless registered: the model's registration gate, which
//!   avoids the RSRP-while-searching trap.
//! - CA is the PCC plus up to four SCCs, 5 fields each; the contract is flat
//!   names, so the list is fixed. A fifth SCC is not published.
//! - Data Used (0.6.0): `qmi_wds_ok`, `qmi_wds_rx_bytes`, `qmi_wds_tx_bytes`,
//!   `qmi_wds_mux` are the default call's ok byte counters from WDS Get
//!   Packet Statistics on the registry's two internal, bound WDS clients
//!   (IPv4 + IPv6, summed). Read once per sidecar write (the 2 s cadence,
//!   never the lease rate) and only when this cycle's bundle read succeeded.
//!   They describe this cycle only and are **never republished**: with
//!   `qmi_state` down / unavailable, no call (`data_call`), no `rmnet_ipa0`,
//!   or no WDS service, `qmi_wds_ok` and the bytes are empty. `qmi_wds_ok`
//!   is `1` when at least one family read ok (a family out of call, QMI
//!   0x000F, adds 0) and `0` when a read was tried and none did, or when a
//!   family that read ok last cycle failed now (its bytes would be missing
//!   from the sum, which a delta consumer would see as a counter reset). The
//!   bytes are empty unless `qmi_wds_ok` is `1`. `qmi_wds_mux` is the mux id
//!   of the default call whenever one is detected.
//!   An IPv6-only call (no IPv4 default route, 0.6.1) takes its mux id from
//!   the IPv6 table (`data_call`) and reads the IPv6 client alone; the IPv4
//!   client is read only while an IPv4 default route exists or it read ok
//!   last cycle.
//!
//! Cadence. Every 2 s, or faster while the live channel (`live.rs`) holds a
//! lease: 1 s for both `watch` and `aim` (aim's 5 Hz was dropped, see
//! `live::AIM_PERIOD`). Samples run on a fixed deadline grid
//! (`next_deadline`), so a lease delivers 1.0 Hz however long a sample
//! takes. The two files above keep the 2 s
//! cadence whatever the tier (`sidecar_due`): only the live file follows the
//! lease rate. They are also written at once when `qmi_state` or the SSR
//! count changes, and on the first sample, so the poller's freshness gate
//! (`qmi_mono` at most a few seconds old) holds in every tier. The sampler
//! re-checks the lease stamps every `min(period, 250 ms)`. (Phase 1's
//! world-writable `/tmp/qmanager_qmi_live` mtime lease is retired; the
//! broker ignores it.)

use crate::common::json::J;
use crate::common::log::Logger;
use crate::common::safefs;
use crate::qmi::codec::wds::ERR_OUT_OF_CALL;
use crate::qmi::error::QmiError;
use crate::qmi::model::{self, Bundle, Registration};
use crate::qmi::registry::{BindTarget, IpFamily, Registry, SvcState, WdsBind, THREAD_STACK};
use crate::qmi::SVC_NAS;
use super::data_call;
use super::live::{self, Live, LivePaths, Tier};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// The sourced sidecar lives in the root-only run dir (a world-writable /tmp
/// path could be planted before the first write and then sourced by the
/// poller). Same dir as ping.env / ondemand.env.
pub const RUN_DIR: &str = "/var/run/qmanager";
pub const ENV_PATH: &str = "/var/run/qmanager/qmi.env";
pub const JSON_PATH: &str = "/tmp/qmanager_qmi.json";

pub struct Paths {
    /// Made root-only (0700, own, not a link) before each env write; None
    /// skips it (tests on a plain temp dir).
    pub run_dir: Option<String>,
    pub env: String,
    pub json: String,
    pub live: LivePaths,
    /// `/proc/net/route` (the default call's mux id).
    pub route: String,
    /// `/proc/net/ipv6_route` (the mux id of an IPv6-only call).
    pub route6: String,
    /// `/sys/class/net/rmnet_ipa0` (the bind endpoint's presence check).
    pub ipa_dev: String,
}

impl Paths {
    pub fn production() -> Paths {
        Paths {
            run_dir: Some(RUN_DIR.into()),
            env: ENV_PATH.into(),
            json: JSON_PATH.into(),
            live: LivePaths::production(),
            route: data_call::ROUTE_PATH.into(),
            route6: data_call::ROUTE6_PATH.into(),
            ipa_dev: data_call::IPA_DEV_PATH.into(),
        }
    }
}

/// The sidecars' cadence while a lease samples faster.
pub const SIDECAR_EVERY: Duration = Duration::from_secs(2);
/// Early allowance, so scheduling jitter on the 1 s grid cannot push a due
/// write one sample (to 3 s) late.
const SIDECAR_SLACK: Duration = Duration::from_millis(100);

/// Whether this sample writes `qmi.env` and the CGI JSON: always without a
/// lease (the sample period is already 2 s), on the first sample, when the
/// state or the SSR count changed since the last write, and otherwise once
/// `SIDECAR_EVERY` has passed.
pub fn sidecar_due(tier: Tier, last: Option<Instant>, now: Instant, changed: bool) -> bool {
    match last {
        _ if tier == Tier::None || changed => true,
        None => true,
        Some(l) => now.saturating_duration_since(l) + SIDECAR_SLACK >= SIDECAR_EVERY,
    }
}

/// The deadline after `prev` on a fixed grid: `prev + period`, so the time a
/// sample takes never stretches the period. More than a period late (a
/// blocked read, a suspended thread) resyncs to `now` instead of bursting to
/// catch up.
pub fn next_deadline(prev: Instant, period: Duration, now: Instant) -> Instant {
    let d = prev + period;
    if now > d + period {
        now
    } else {
        d
    }
}

/// Carriers published beyond the PCC.
const SCCS: usize = 4;

/// The compiled allow-list: every name the env file may contain, in file
/// order. `values()` returns one value per name, in this order.
pub const NAMES: &[&str] = &[
    "qmi_mono",
    "qmi_state",
    "qmi_ssr_count",
    "qmi_registered",
    "qmi_lte_pci",
    "qmi_lte_earfcn",
    "qmi_lte_tac",
    "qmi_lte_cell_id",
    "qmi_lte_band",
    "qmi_lte_bw_mhz",
    "qmi_lte_rsrp",
    "qmi_lte_rsrq",
    "qmi_lte_rssi",
    "qmi_ca_count",
    "qmi_pcc_pci",
    "qmi_pcc_earfcn",
    "qmi_pcc_band",
    "qmi_pcc_bw_mhz",
    "qmi_scc1_pci",
    "qmi_scc1_earfcn",
    "qmi_scc1_band",
    "qmi_scc1_bw_mhz",
    "qmi_scc1_active",
    "qmi_scc2_pci",
    "qmi_scc2_earfcn",
    "qmi_scc2_band",
    "qmi_scc2_bw_mhz",
    "qmi_scc2_active",
    "qmi_scc3_pci",
    "qmi_scc3_earfcn",
    "qmi_scc3_band",
    "qmi_scc3_bw_mhz",
    "qmi_scc3_active",
    "qmi_scc4_pci",
    "qmi_scc4_earfcn",
    "qmi_scc4_band",
    "qmi_scc4_bw_mhz",
    "qmi_scc4_active",
    "qmi_wds_ok",
    "qmi_wds_rx_bytes",
    "qmi_wds_tx_bytes",
    "qmi_wds_mux",
];

/// This cycle's WDS packet statistics (Data Used). All None: not read.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct WdsView {
    /// Some(true) = counters valid, Some(false) = read tried and failed.
    pub ok: Option<bool>,
    pub rx: Option<u64>,
    pub tx: Option<u64>,
    pub mux: Option<u8>,
}

/// What one publication shows.
pub struct View<'a> {
    /// CLOCK_BOOTTIME seconds of the last successful read.
    pub mono_s: Option<u64>,
    pub state: &'static str,
    pub ssr_count: u64,
    /// The broker-held NAS signal config (`SigConfig::as_str`): JSON only.
    pub sig: &'static str,
    pub wds: WdsView,
    pub bundle: Option<&'a Bundle>,
}

fn num<T: std::fmt::Display>(v: Option<T>) -> String {
    v.map_or(String::new(), |v| v.to_string())
}

/// "B41" -> 41. Only an LTE band label; anything else is empty.
fn band_num(label: Option<&str>) -> Option<u32> {
    label?.strip_prefix('B')?.parse().ok()
}

fn registered(b: &Bundle) -> Option<bool> {
    match b.signal.registration {
        Registration::Registered => Some(true),
        Registration::Unknown => None,
        _ => Some(false),
    }
}

/// One value per `NAMES` entry. Integer text or empty (`qmi_state` aside).
fn values(v: &View) -> Vec<String> {
    let mut out: Vec<String> = Vec::with_capacity(NAMES.len());
    out.push(num(v.mono_s));
    out.push(v.state.to_string());
    out.push(v.ssr_count.to_string());
    let b = v.bundle;
    out.push(num(b.and_then(registered).map(|r| r as u8)));

    let lte = b.and_then(|b| b.cell.as_ref()).and_then(|c| c.lte.as_ref());
    out.push(num(lte.map(|l| l.pci)));
    out.push(num(lte.map(|l| l.earfcn)));
    out.push(num(lte.map(|l| l.tac)));
    out.push(num(lte.map(|l| l.cell_id)));
    let (band, bw) = b.map_or((None, None), |b| b.lte_band());
    out.push(num(band_num(band.as_deref())));
    out.push(num(bw));
    // Signal: already None unless registered; the explicit gate is for the
    // day the model changes.
    let sig = b.filter(|b| b.registered()).and_then(|b| b.signal.lte);
    out.push(num(sig.and_then(|s| s.rsrp).map(|r| r.whole())));
    out.push(num(sig.and_then(|s| s.rsrq).map(|r| r.whole())));
    out.push(num(sig.and_then(|s| s.rssi).map(|r| r.whole())));

    let ca = b.and_then(|b| b.ca.as_ref());
    out.push(num(ca.map(|c| c.count())));
    let pcc = ca.and_then(|c| c.pcc());
    out.push(num(pcc.map(|c| c.pci)));
    out.push(num(pcc.map(|c| c.earfcn)));
    out.push(num(pcc.and_then(|c| band_num(c.band.as_deref()))));
    out.push(num(pcc.and_then(|c| c.bandwidth_mhz)));
    let sccs: Vec<_> = ca.map_or(Vec::new(), |c| c.carriers.iter().filter(|c| c.kind == "SCC").collect());
    for i in 0..SCCS {
        let s = sccs.get(i);
        out.push(num(s.map(|c| c.pci)));
        out.push(num(s.map(|c| c.earfcn)));
        out.push(num(s.and_then(|c| band_num(c.band.as_deref()))));
        out.push(num(s.and_then(|c| c.bandwidth_mhz)));
        out.push(num(s.map(|c| c.active as u8)));
    }
    // Bytes only alongside ok=1, whatever the view says.
    let w = v.wds;
    let valid = w.ok == Some(true);
    out.push(num(w.ok.map(|o| o as u8)));
    out.push(num(w.rx.filter(|_| valid)));
    out.push(num(w.tx.filter(|_| valid)));
    out.push(num(w.mux));
    debug_assert_eq!(out.len(), NAMES.len());
    out
}

/// The env file: `name='value'` per line, then the terminator.
pub fn render_env(v: &View) -> String {
    let mut s = String::with_capacity(1024);
    for (name, val) in NAMES.iter().zip(values(v)) {
        // Values are digits, a minus sign or the state token: nothing a
        // single-quoted shell string needs escaping for.
        s.push_str(name);
        s.push_str("='");
        s.push_str(&val);
        s.push_str("'\n");
    }
    s.push_str("qm_sidecar_end='1'\n");
    s
}

/// The JSON file: the freshness fields and the full bundle.
pub fn render_json(v: &View) -> String {
    let mut j = J::obj();
    j.num("v", 1)
        .opt_num("qmi_mono", v.mono_s)
        .str("qmi_state", v.state)
        .num("qmi_ssr_count", v.ssr_count)
        .str("qmi_sig_config", v.sig)
        .opt_bool("registered", v.bundle.and_then(registered));
    match v.bundle {
        Some(b) => j.raw("data", &b.json()),
        None => j.null("data"),
    };
    let w = v.wds;
    let valid = w.ok == Some(true);
    let wds = J::obj()
        .opt_bool("ok", w.ok)
        .opt_num("rx_bytes", w.rx.filter(|_| valid))
        .opt_num("tx_bytes", w.tx.filter(|_| valid))
        .opt_num("mux", w.mux)
        .done();
    j.raw("wds", &wds);
    let mut s = j.done();
    s.push('\n');
    s
}

/// CLOCK_BOOTTIME seconds: `/proc/uptime`'s clock.
pub fn boot_secs() -> u64 {
    let mut ts: libc::timespec = unsafe { std::mem::zeroed() };
    unsafe { libc::clock_gettime(libc::CLOCK_BOOTTIME, &mut ts) };
    ts.tv_sec as u64
}

/// Holds what the last good read said, and publishes after every read.
pub struct Sampler {
    paths: Paths,
    last: Option<Bundle>,
    last_mono: Option<u64>,
    write_failed: bool,
    log: Arc<Logger>,
    live: Live,
    /// When the sidecars were last written, and the state and SSR count
    /// they said then.
    side_at: Option<Instant>,
    side_state: &'static str,
    side_ssr: u64,
    /// Sidecar publications so far (tests count them).
    side_writes: u64,
    /// Per family (`IpFamily::ALL` order): read ok last cycle.
    wds_prev_ok: [bool; 2],
    /// Per family: the bind state last logged.
    wds_logged: [WdsBind; 2],
    /// A call without the IPA endpoint was logged (once until it changes).
    wds_no_ep_logged: bool,
}

impl Sampler {
    pub fn new(mut paths: Paths, log: Arc<Logger>) -> Sampler {
        let lp = std::mem::replace(&mut paths.live, LivePaths::production());
        let live = Live::new(lp, log.clone());
        Sampler {
            paths,
            last: None,
            last_mono: None,
            write_failed: false,
            log,
            live,
            side_at: None,
            side_state: "",
            side_ssr: 0,
            side_writes: 0,
            wds_prev_ok: [false; 2],
            wds_logged: [WdsBind::Unbound; 2],
            wds_no_ep_logged: false,
        }
    }

    /// This cycle's Data Used counters (see the module doc). Never fails.
    fn read_wds(&mut self, reg: &Registry) -> WdsView {
        let call = data_call::discover(&self.paths.route, &self.paths.route6, &self.paths.ipa_dev);
        let mux = match call.mux {
            Some(m) => m,
            None => {
                self.wds_prev_ok = [false; 2];
                return WdsView::default();
            }
        };
        let ep = match call.ep {
            Some(ep) => {
                self.wds_no_ep_logged = false;
                ep
            }
            None => {
                if !self.wds_no_ep_logged {
                    self.log.warn("qmi wds: no rmnet_ipa0 endpoint, packet stats not bound");
                    self.wds_no_ep_logged = true;
                }
                self.wds_prev_ok = [false; 2];
                return WdsView { mux: Some(mux), ..WdsView::default() };
            }
        };
        let t = BindTarget { ep, mux };
        let (mut rx, mut tx) = (0u64, 0u64);
        let mut any_ok = false;
        let mut lost_ok = false;
        let mut now_ok = [false; 2];
        for (k, fam) in IpFamily::ALL.iter().enumerate() {
            let was_ok = self.wds_prev_ok.get(k).copied().unwrap_or(false);
            // An IPv6-only call (no IPv4 default route) reads the IPv6 client
            // alone; a v4 family that read ok last cycle stays read, so its
            // route flapping never shrinks the sum.
            if *fam == IpFamily::V4 && !call.v4 && !was_ok {
                continue;
            }
            match reg.wds_packet_bytes(*fam, t) {
                Ok(b) => {
                    any_ok = true;
                    if let Some(s) = now_ok.get_mut(k) {
                        *s = true;
                    }
                    rx = rx.saturating_add(b.rx);
                    tx = tx.saturating_add(b.tx);
                }
                Err(e) if e.qmi_code() == Some(ERR_OUT_OF_CALL) => {}
                // No WDS service (or no internal clients): not attempted.
                Err(QmiError::Unavailable) => {
                    self.wds_prev_ok = [false; 2];
                    return WdsView { mux: Some(mux), ..WdsView::default() };
                }
                Err(_) => lost_ok |= was_ok,
            }
            self.log_bind(reg, k, *fam);
        }
        self.wds_prev_ok = now_ok;
        let ok = any_ok && !lost_ok;
        WdsView { ok: Some(ok), rx: ok.then_some(rx), tx: ok.then_some(tx), mux: Some(mux) }
    }

    /// Logs a change of family `k`'s bind state (state changes only).
    fn log_bind(&mut self, reg: &Registry, k: usize, fam: IpFamily) {
        let now = reg.wds_bind_state(fam);
        let prev = match self.wds_logged.get_mut(k) {
            Some(p) => p,
            None => return,
        };
        if *prev == now {
            return;
        }
        *prev = now;
        match now {
            WdsBind::Bound { mux, subs_ok: true } => self.log.info(&format!("qmi {} bound to mux {mux}", fam.tag())),
            WdsBind::Bound { mux, subs_ok: false } => {
                self.log.warn(&format!("qmi {} bound to mux {mux} (bind subscription failed, ignored)", fam.tag()))
            }
            WdsBind::Failed { mux, code: Some(c) } => {
                self.log.warn(&format!("qmi {} bind to mux {mux} failed (qmi {c:#06x})", fam.tag()))
            }
            WdsBind::Failed { mux, code: None } => {
                self.log.warn(&format!("qmi {} bind to mux {mux} failed (no response)", fam.tag()))
            }
            WdsBind::Unbound => {}
        }
    }

    /// One read and one publication, at the tier the stamps say now (tests).
    #[cfg(test)]
    pub fn sample(&mut self, reg: &Registry) {
        let tier = self.live.tier(boot_secs());
        self.sample_at(reg, tier);
    }

    /// One read, the live file (under a lease) and, when due, the sidecars.
    /// Never fails: a failed read republishes the last values with a
    /// `down` / `unavailable` state.
    pub fn sample_at(&mut self, reg: &Registry, tier: Tier) {
        let fetch = |svc: u32, id: u16| reg.request(svc, id, &[]);
        let mut fresh = false;
        let state = match model::bundle(&fetch) {
            Ok(b) => {
                self.last = Some(b);
                self.last_mono = Some(boot_secs());
                fresh = true;
                "up"
            }
            Err(QmiError::Unavailable) => "unavailable",
            // NAS gone for good looks the same as a reset until its state says so.
            Err(_) if reg.state(SVC_NAS) == Some(SvcState::Unavailable) => "unavailable",
            Err(_) => "down",
        };
        let ssr = reg.ssr_count();
        let now = Instant::now();
        let changed = state != self.side_state || ssr != self.side_ssr;
        if sidecar_due(tier, self.side_at, now, changed) {
            // Data Used: on the sidecar cadence only, and only with a fresh
            // bundle (no binds or stats reads into an SSR window).
            let wds = if fresh {
                self.read_wds(reg)
            } else {
                self.wds_prev_ok = [false; 2];
                WdsView::default()
            };
            self.write_sidecars(state, ssr, reg.sig_config_state().as_str(), wds);
            self.side_at = Some(now);
            self.side_state = state;
            self.side_ssr = ssr;
        }
        let fresh_bundle = if fresh { self.last.as_ref() } else { None };
        self.live.on_sample(tier, state, ssr, fresh_bundle);
    }

    fn write_sidecars(&mut self, state: &'static str, ssr_count: u64, sig: &'static str, wds: WdsView) {
        self.side_writes += 1;
        let v = View { mono_s: self.last_mono, state, ssr_count, sig, wds, bundle: self.last.as_ref() };
        let json = render_json(&v);
        let env = render_env(&v);
        // JSON first, then env, each on its own: a path planted in /tmp can
        // cost the CGI json, never the poller's root-only sidecar.
        let rj = safefs::write_atomic(&self.paths.json, json.as_bytes());
        let re = match &self.paths.run_dir {
            Some(d) => safefs::ensure_own_dir(d, 0o700),
            None => Ok(()),
        }
        .and_then(|_| safefs::write_atomic(&self.paths.env, env.as_bytes()));
        let r = match (rj, re) {
            (Ok(()), Ok(())) => Ok(()),
            (Err(e), Ok(())) => Err(format!("{}: {e}", self.paths.json)),
            (Ok(()), Err(e)) => Err(format!("{}: {e}", self.paths.env)),
            (Err(a), Err(b)) => Err(format!("{}: {a}; {}: {b}", self.paths.json, self.paths.env)),
        };
        match (r, self.write_failed) {
            (Err(e), false) => {
                self.log.warn(&format!("cannot publish the qmi snapshot: {e}"));
                self.write_failed = true;
            }
            (Ok(()), true) => {
                self.log.info("qmi snapshot publishing again");
                self.write_failed = false;
            }
            _ => {}
        }
    }
}

/// Starts the sampler thread (128 KiB stack).
pub fn spawn(reg: Arc<Registry>, paths: Paths, log: Arc<Logger>) -> std::io::Result<()> {
    std::thread::Builder::new().name("qmi-sampler".into()).stack_size(THREAD_STACK).spawn(move || run(&reg, paths, log))?;
    Ok(())
}

fn run(reg: &Registry, paths: Paths, log: Arc<Logger>) {
    let mut s = Sampler::new(paths, log);
    s.live.start();
    // The deadline the last sample was scheduled for. None: sample at once.
    // (Not `now - period`: Instant subtraction panics if the host has been
    // up for less than the period.) The period is the current tier's, so a
    // new lease is picked up within a slice, not after the idle period.
    let mut prev: Option<Instant> = None;
    loop {
        let now_s = boot_secs();
        let tier = s.live.tier(now_s);
        s.live.tick(tier, now_s);
        let period = live::period_for(tier);
        let mut now = Instant::now();
        let mut due = prev.map_or(now, |p| next_deadline(p, period, now));
        if now >= due {
            s.sample_at(reg, tier);
            prev = Some(due);
            now = Instant::now();
            due = next_deadline(due, period, now);
            if now >= due {
                continue;
            }
        }
        // Sleeping straight to the next deadline after a sample saves a
        // second stamp read per sample.
        std::thread::sleep((due - now).min(live::slice_for(period)).max(Duration::from_millis(1)));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::qmi::codec::testfix::fx;
    use crate::qmi::fake::{r1_net, start_registry};
    use crate::qmi::model::Inputs;
    use std::path::PathBuf;

    fn dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("qatd-snap-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn paths(d: &std::path::Path) -> Paths {
        let p = |n: &str| d.join(n).to_str().unwrap().to_string();
        let live = LivePaths {
            run_dir: None,
            aim: p("aim"),
            watch: p("watch"),
            token: p("token"),
            lock: p("lock"),
            public_dir: p("pub"),
            long_flag: p("long"),
        };
        // No route file and no rmnet_ipa0 here: no call, nothing bound.
        Paths { run_dir: None, env: p("q.env"), json: p("q.json"), live, route: p("route"), route6: p("route6"), ipa_dev: p("rmnet_ipa0") }
    }

    fn log() -> Arc<Logger> {
        Arc::new(Logger::new("test"))
    }

    fn bundle(serving: &str) -> Bundle {
        let s = match serving {
            "registered" => fx!("r1_3_0x0024"),
            _ => fx!("serving_searching"),
        };
        Bundle::build(&Inputs {
            serving: Some(&s),
            cell: Some(&fx!("r1_3_0x0043")),
            ca: Some(&fx!("ca_0x15_two_scells")),
            rf: Some(&fx!("r1_3_0x0031")),
            sig_info: None,
        })
    }

    /// The env as `(name, value)` pairs, parsed the way the shell would.
    fn pairs(env: &str) -> Vec<(String, String)> {
        env.lines()
            .map(|l| {
                let (n, v) = l.split_once('=').unwrap();
                (n.to_string(), v.strip_prefix('\'').unwrap().strip_suffix('\'').unwrap().to_string())
            })
            .collect()
    }

    fn get<'a>(p: &'a [(String, String)], name: &str) -> &'a str {
        &p.iter().find(|(n, _)| n == name).unwrap().1
    }

    /// Everything the sidecar contract demands, line by line: the shell
    /// validator's pattern (`[A-Za-z_]*=\'*\'`), the terminator, our allow-list
    /// and the value alphabet. Returns the first violation.
    fn violation(env: &str) -> Option<String> {
        let lines: Vec<&str> = env.lines().collect();
        if !env.ends_with('\n') {
            return Some("no trailing newline".into());
        }
        if lines.last() != Some(&"qm_sidecar_end='1'") {
            return Some("terminator is not the last line".into());
        }
        for l in &lines {
            // [A-Za-z_]*=\'*\' : starts with a letter or _, has =', ends with '.
            let first = l.chars().next().unwrap_or(' ');
            if !(first.is_ascii_alphabetic() || first == '_') || !l.contains("='") || !l.ends_with('\'') {
                return Some(format!("shell pattern: {l}"));
            }
        }
        let body = &lines[..lines.len() - 1];
        if body.len() != NAMES.len() {
            return Some(format!("{} lines, {} names", body.len(), NAMES.len()));
        }
        for (l, name) in body.iter().zip(NAMES) {
            let (n, v) = l.split_once('=').unwrap();
            if n != *name || !n.starts_with("qmi_") {
                return Some(format!("name: {l}"));
            }
            let v = &v[1..v.len() - 1];
            let ok = if n == "qmi_state" {
                matches!(v, "up" | "down" | "unavailable")
            } else {
                v.is_empty() || (v.trim_start_matches('-').bytes().all(|b| b.is_ascii_digit()) && v != "-" && !v.starts_with("--"))
            };
            if !ok {
                return Some(format!("value: {l}"));
            }
            if v.contains('\'') || v.contains('.') || v.contains("N/A") || v.contains("NaN") || v.contains("null") {
                return Some(format!("float or sentinel: {l}"));
            }
        }
        None
    }

    #[test]
    fn names_are_unique_prefixed_and_never_the_pollers_own() {
        let mut seen = std::collections::HashSet::new();
        for n in NAMES {
            assert!(n.starts_with("qmi_"), "{n}");
            assert!(seen.insert(*n), "dup {n}");
            assert!(n.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_'), "{n}");
        }
        assert!(!NAMES.iter().any(|n| n.starts_with("lte_") || n.starts_with("t2_") || n.starts_with("nr_")));
        assert!(!NAMES.contains(&"qm_sidecar_end"));
    }

    #[test]
    fn a_registered_lte_bundle_fills_every_identity_and_signal_name() {
        let b = bundle("registered");
        let env = render_env(&View { mono_s: Some(4242), state: "up", ssr_count: 3, sig: "off", wds: WdsView::default(), bundle: Some(&b) });
        assert_eq!(violation(&env), None, "{env}");
        let p = pairs(&env[..env.len() - "qm_sidecar_end='1'\n".len()]);
        assert_eq!(get(&p, "qmi_mono"), "4242");
        assert_eq!(get(&p, "qmi_state"), "up");
        assert_eq!(get(&p, "qmi_ssr_count"), "3");
        assert_eq!(get(&p, "qmi_registered"), "1");
        // r1 capture: PCI 295, EARFCN 150 (B1, 20 MHz), synthetic TAC / ECI.
        assert_eq!(get(&p, "qmi_lte_pci"), "295");
        assert_eq!(get(&p, "qmi_lte_earfcn"), "150");
        assert_eq!(get(&p, "qmi_lte_tac"), "4660");
        assert_eq!(get(&p, "qmi_lte_cell_id"), "19088641");
        assert_eq!(get(&p, "qmi_lte_band"), "1");
        assert_eq!(get(&p, "qmi_lte_bw_mhz"), "20");
        assert_eq!(get(&p, "qmi_lte_rsrp"), "-90");
        assert_eq!(get(&p, "qmi_lte_rsrq"), "-7");
        assert_eq!(get(&p, "qmi_lte_rssi"), "-63");
        // The two-SCell capture: B3 PCC, SCC B1 (inactive) and SCC B41.
        assert_eq!(get(&p, "qmi_ca_count"), "3");
        assert_eq!((get(&p, "qmi_pcc_band"), get(&p, "qmi_pcc_bw_mhz")), ("3", "15"));
        assert_eq!((get(&p, "qmi_scc1_band"), get(&p, "qmi_scc1_bw_mhz"), get(&p, "qmi_scc1_active")), ("1", "20", "0"));
        assert_eq!((get(&p, "qmi_scc2_band"), get(&p, "qmi_scc2_bw_mhz")), ("41", "15"));
        // Carriers beyond the carriers present stay empty.
        for n in ["qmi_scc3_pci", "qmi_scc3_active", "qmi_scc4_earfcn", "qmi_scc4_band"] {
            assert_eq!(get(&p, n), "", "{n}");
        }
    }

    #[test]
    fn not_registered_keeps_identity_but_empties_the_signal() {
        let b = bundle("searching");
        let env = render_env(&View { mono_s: Some(10), state: "up", ssr_count: 0, sig: "off", wds: WdsView::default(), bundle: Some(&b) });
        assert_eq!(violation(&env), None, "{env}");
        let p = pairs(&env[..env.len() - "qm_sidecar_end='1'\n".len()]);
        assert_eq!(get(&p, "qmi_registered"), "0");
        for n in ["qmi_lte_rsrp", "qmi_lte_rsrq", "qmi_lte_rssi"] {
            assert_eq!(get(&p, n), "", "{n} must be empty while not registered");
        }
        assert_eq!(get(&p, "qmi_lte_pci"), "295", "identity is not gated");
        // Serving unreadable: registration unknown -> empty, signal empty.
        let b = Bundle::build(&Inputs { cell: Some(&fx!("r1_3_0x0043")), ..Inputs::default() });
        let env = render_env(&View { mono_s: Some(10), state: "up", ssr_count: 0, sig: "off", wds: WdsView::default(), bundle: Some(&b) });
        let p = pairs(&env[..env.len() - "qm_sidecar_end='1'\n".len()]);
        assert_eq!((get(&p, "qmi_registered"), get(&p, "qmi_lte_rsrp")), ("", ""));
    }

    #[test]
    fn nothing_read_yet_is_all_empty_but_state_and_counters() {
        let env = render_env(&View { mono_s: None, state: "unavailable", ssr_count: 0, sig: "off", wds: WdsView::default(), bundle: None });
        assert_eq!(violation(&env), None, "{env}");
        let p = pairs(&env[..env.len() - "qm_sidecar_end='1'\n".len()]);
        for (n, v) in &p {
            match n.as_str() {
                "qmi_state" => assert_eq!(v, "unavailable"),
                "qmi_ssr_count" => assert_eq!(v, "0"),
                _ => assert_eq!(v, "", "{n}"),
            }
        }
        let j = render_json(&View { mono_s: None, state: "unavailable", ssr_count: 0, sig: "off", wds: WdsView::default(), bundle: None });
        assert_eq!(j, "{\"v\":1,\"qmi_mono\":null,\"qmi_state\":\"unavailable\",\"qmi_ssr_count\":0,\"qmi_sig_config\":\"off\",\"registered\":null,\"data\":null,\"wds\":{\"ok\":null,\"rx_bytes\":null,\"tx_bytes\":null,\"mux\":null}}\n");
    }

    #[test]
    fn the_json_carries_the_freshness_fields_and_the_bundle() {
        let b = bundle("registered");
        let j = render_json(&View { mono_s: Some(7), state: "down", ssr_count: 2, sig: "off", wds: WdsView::default(), bundle: Some(&b) });
        assert!(j.starts_with("{\"v\":1,\"qmi_mono\":7,\"qmi_state\":\"down\",\"qmi_ssr_count\":2,\"qmi_sig_config\":\"off\",\"registered\":true,\"data\":{\"serving\":{"), "{j}");
        assert!(j.ends_with("}}\n") && j.matches('\n').count() == 1, "{j}");
        assert!(j.contains("\"rsrp\":{\"value\":-90"), "{j}");
    }

    #[test]
    fn no_value_is_ever_a_float_even_for_odd_input() {
        // Fuzz the model with truncated/mangled captures: every render must
        // still satisfy the contract.
        for base in crate::qmi::codec::testfix::all() {
            for m in crate::qmi::codec::testfix::mangled(&base) {
                let b = Bundle::build(&Inputs { serving: Some(&m), cell: Some(&m), ca: Some(&m), rf: Some(&m), sig_info: Some(&m) });
                let env = render_env(&View { mono_s: Some(1), state: "up", ssr_count: 0, sig: "off", wds: WdsView::default(), bundle: Some(&b) });
                assert_eq!(violation(&env), None, "{env}");
            }
        }
    }

    #[test]
    fn the_real_shell_validator_accepts_the_files_and_rejects_a_damaged_one() {
        // Runs conn_state.sh's `cq_env_source` (the loop the poller uses for
        // ping.env, copied verbatim into qmi_load later) under the host `sh`.
        let script = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../scripts/usr/lib/qmanager/conn_state.sh");
        if !script.exists() || std::process::Command::new("sh").arg("-c").arg("true").status().is_err() {
            eprintln!("skipped: no sh or no conn_state.sh");
            return;
        }
        let d = dir("shell");
        let run = |file: &std::path::Path| {
            let out = std::process::Command::new("sh")
                .arg("-c")
                .arg(r#". "$1" || exit 9; if cq_env_source "$2"; then echo "SOURCED mono=$qmi_mono state=$qmi_state reg=$qmi_registered pci=$qmi_lte_pci rsrp=$qmi_lte_rsrp ca=$qmi_ca_count scc2=$qmi_scc2_band end=$qm_sidecar_end"; else echo REJECTED; fi"#)
                .arg("sh")
                .arg(&script)
                .arg(file)
                .output()
                .unwrap();
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        };
        let b = bundle("registered");
        let good = d.join("good.env");
        std::fs::write(&good, render_env(&View { mono_s: Some(99), state: "up", ssr_count: 1, sig: "off", wds: WdsView::default(), bundle: Some(&b) })).unwrap();
        assert_eq!(run(&good), "SOURCED mono=99 state=up reg=1 pci=295 rsrp=-90 ca=3 scc2=41 end=1");
        // Empty values source as empty strings.
        let empty = d.join("empty.env");
        std::fs::write(&empty, render_env(&View { mono_s: None, state: "down", ssr_count: 4, sig: "off", wds: WdsView::default(), bundle: None })).unwrap();
        assert_eq!(run(&empty), "SOURCED mono= state=down reg= pci= rsrp= ca= scc2= end=1");
        // A file cut short (no terminator) or with a stray line is rejected.
        let full = render_env(&View { mono_s: Some(1), state: "up", ssr_count: 0, sig: "off", wds: WdsView::default(), bundle: Some(&b) });
        let cut = d.join("cut.env");
        std::fs::write(&cut, &full[..full.len() - "qm_sidecar_end='1'\n".len()]).unwrap();
        assert_eq!(run(&cut), "REJECTED");
        let stray = d.join("stray.env");
        std::fs::write(&stray, full.replace("qmi_mono='1'\n", "qmi_mono=1\n")).unwrap();
        assert_eq!(run(&stray), "REJECTED");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_sample_publishes_both_files_atomically_and_leaves_no_temp() {
        let d = dir("pub");
        let p = paths(&d);
        let (env_p, json_p) = (p.env.clone(), p.json.clone());
        let net = r1_net();
        let reg = start_registry(&net);
        let mut s = Sampler::new(p, log());
        s.sample(&reg);
        let env = std::fs::read_to_string(&env_p).unwrap();
        assert_eq!(violation(&env), None, "{env}");
        let pr = pairs(&env[..env.len() - "qm_sidecar_end='1'\n".len()]);
        assert_eq!((get(&pr, "qmi_state"), get(&pr, "qmi_registered"), get(&pr, "qmi_lte_pci")), ("up", "1", "295"));
        let mono: u64 = get(&pr, "qmi_mono").parse().unwrap();
        assert!(mono.abs_diff(boot_secs()) <= 2, "{mono} vs {}", boot_secs());
        let json = std::fs::read_to_string(&json_p).unwrap();
        assert!(json.contains("\"qmi_state\":\"up\"") && json.contains("\"pci\":295"), "{json}");
        // The env is never older than the JSON it mirrors.
        let (je, ee) = (std::fs::metadata(&json_p).unwrap().modified().unwrap(), std::fs::metadata(&env_p).unwrap().modified().unwrap());
        assert!(ee >= je);
        // Republishing replaces whole files; no .new is left behind.
        s.sample(&reg);
        let names: Vec<String> = std::fs::read_dir(&d).unwrap().map(|e| e.unwrap().file_name().into_string().unwrap()).collect();
        assert!(names.iter().all(|n| !n.ends_with(".new")), "{names:?}");
        assert_eq!(names.len(), 2, "{names:?}");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn an_ssr_keeps_the_last_values_marks_down_and_counts_it() {
        let d = dir("ssr");
        let p = paths(&d);
        let env_p = p.env.clone();
        let net = r1_net();
        let reg = start_registry(&net);
        let mut s = Sampler::new(p, log());
        s.sample(&reg);
        let before = std::fs::read_to_string(&env_p).unwrap();
        let mono_before = get(&pairs(&before[..before.len() - 19]), "qmi_mono").to_string();
        // The baseband resets: every service leaves the name server.
        for (svc, _) in reg.states() {
            net.del_server(svc);
        }
        let end = Instant::now() + Duration::from_secs(2);
        while reg.states().iter().any(|(_, st)| *st == SvcState::Up) && Instant::now() < end {
            std::thread::sleep(Duration::from_millis(2));
        }
        s.sample(&reg);
        let after = std::fs::read_to_string(&env_p).unwrap();
        assert_eq!(violation(&after), None, "{after}");
        let pr = pairs(&after[..after.len() - 19]);
        assert_eq!(get(&pr, "qmi_state"), "down");
        assert_eq!(get(&pr, "qmi_ssr_count"), "1");
        // Last values kept, and the data's age is still the last good read's.
        assert_eq!((get(&pr, "qmi_lte_pci"), get(&pr, "qmi_lte_rsrp"), get(&pr, "qmi_registered")), ("295", "-90", "1"));
        assert_eq!(get(&pr, "qmi_mono"), mono_before);
        assert!(std::fs::read_to_string(&paths(&d).json).unwrap().contains("\"qmi_state\":\"down\""));
        // And they recover on the next successful read.
        for (i, svc) in crate::qmi::SERVICES.iter().enumerate() {
            net.add_server(*svc, 0, 0x90 + i as u32);
        }
        let end = Instant::now() + Duration::from_secs(2);
        while reg.states().iter().any(|(_, st)| *st != SvcState::Up) && Instant::now() < end {
            std::thread::sleep(Duration::from_millis(2));
        }
        s.sample(&reg);
        let again = std::fs::read_to_string(&env_p).unwrap();
        assert_eq!(get(&pairs(&again[..again.len() - 19]), "qmi_state"), "up");
        assert_eq!(get(&pairs(&again[..again.len() - 19]), "qmi_ssr_count"), "1");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn without_qrtr_the_files_exist_and_say_unavailable() {
        let d = dir("noqrtr");
        let p = paths(&d);
        let env_p = p.env.clone();
        let net = crate::qmi::fake::FakeNet::new();
        net.set_fail_open(true);
        let reg = start_registry(&net);
        Sampler::new(p, log()).sample(&reg);
        let env = std::fs::read_to_string(&env_p).unwrap();
        assert_eq!(violation(&env), None);
        assert_eq!(get(&pairs(&env[..env.len() - 19]), "qmi_state"), "unavailable");
        assert!(std::path::Path::new(&paths(&d).json).exists());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn the_env_goes_into_a_root_only_dir_that_is_made_trustworthy() {
        use std::os::unix::fs::PermissionsExt;
        let d = dir("rundir");
        let run = d.join("run");
        // A planted symlink where the dir should be must not receive the file.
        let victim = d.join("victim");
        std::fs::create_dir(&victim).unwrap();
        std::os::unix::fs::symlink(&victim, &run).unwrap();
        let mut p = paths(&d);
        p.run_dir = Some(run.to_str().unwrap().to_string());
        p.env = run.join("qmi.env").to_str().unwrap().to_string();
        let env_p = p.env.clone();
        let reg = start_registry(&r1_net());
        Sampler::new(p, log()).sample(&reg);
        assert!(std::fs::read_to_string(&env_p).unwrap().ends_with("qm_sidecar_end='1'\n"));
        assert_eq!(std::fs::metadata(&run).unwrap().permissions().mode() & 0o777, 0o700);
        assert!(std::fs::read_dir(&victim).unwrap().next().is_none(), "nothing written through the link");
        assert_eq!(ENV_PATH, "/var/run/qmanager/qmi.env");
        assert!(Paths::production().json.starts_with("/tmp/"));
        assert_eq!(Paths::production().live.public_dir, "/var/run/qmanager/live");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_dir_planted_at_the_json_path_never_blocks_the_env() {
        let d = dir("planted");
        let p = paths(&d);
        let (env_p, json_p) = (p.env.clone(), p.json.clone());
        // Planted at both the JSON target and its temp name.
        std::fs::create_dir_all(format!("{json_p}/x")).unwrap();
        std::fs::create_dir_all(format!("{json_p}.new/y")).unwrap();
        let reg = start_registry(&r1_net());
        let mut s = Sampler::new(p, log());
        s.sample(&reg);
        let env = std::fs::read_to_string(&env_p).unwrap();
        assert_eq!(violation(&env), None, "{env}");
        assert_eq!(get(&pairs(&env[..env.len() - 19]), "qmi_state"), "up");
        assert!(s.write_failed, "the json failure is still reported");
        assert!(std::fs::symlink_metadata(&json_p).unwrap().is_dir(), "the planted target is left alone");
        assert!(!std::path::Path::new(&format!("{json_p}.new")).exists(), "the planted temp dir is cleared");
        // Once the target is free again, both files publish.
        std::fs::remove_dir_all(&json_p).unwrap();
        s.sample(&reg);
        assert!(!s.write_failed);
        assert!(std::fs::read_to_string(&json_p).unwrap().contains("\"qmi_state\":\"up\""));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn an_unwritable_target_is_survived() {
        let d = dir("ro");
        let mut p = paths(&d);
        p.env = d.join("no/such/dir/q.env").to_str().unwrap().to_string();
        let reg = start_registry(&r1_net());
        let mut s = Sampler::new(p, log());
        s.sample(&reg);
        assert!(s.write_failed);
        s.sample(&reg);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn the_env_contract_is_42_names_in_order() {
        assert_eq!(NAMES.len(), 42);
        let mut want: Vec<String> = ["qmi_mono", "qmi_state", "qmi_ssr_count", "qmi_registered"].iter().map(|s| s.to_string()).collect();
        for f in ["pci", "earfcn", "tac", "cell_id", "band", "bw_mhz", "rsrp", "rsrq", "rssi"] {
            want.push(format!("qmi_lte_{f}"));
        }
        want.push("qmi_ca_count".into());
        for f in ["pci", "earfcn", "band", "bw_mhz"] {
            want.push(format!("qmi_pcc_{f}"));
        }
        for i in 1..=4 {
            for f in ["pci", "earfcn", "band", "bw_mhz", "active"] {
                want.push(format!("qmi_scc{i}_{f}"));
            }
        }
        // 0.6.0 appends Data Used, still before the terminator.
        for f in ["ok", "rx_bytes", "tx_bytes", "mux"] {
            want.push(format!("qmi_wds_{f}"));
        }
        assert_eq!(NAMES, want.iter().map(|s| s.as_str()).collect::<Vec<_>>().as_slice());
    }

    // ------------------------------------------------------ Data Used (0.6.0)

    use crate::qmi::fake::{start_registry_wds, wds_net};
    use std::sync::atomic::Ordering::SeqCst;

    /// A test dir with a default route on rmnet_data<n> (None: no route
    /// file) and, when `ipa`, an rmnet_ipa0 entry.
    fn call_dir(name: &str, n: Option<u8>, ipa: bool) -> (PathBuf, Paths) {
        let d = dir(name);
        let p = paths(&d);
        if let Some(n) = n {
            set_route(&p, n);
        }
        if ipa {
            std::fs::create_dir_all(&p.ipa_dev).unwrap();
        }
        (d, p)
    }

    fn set_route(p: &Paths, n: u8) {
        let r = format!(
            "Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT\nrmnet_data{n}\t00000000\t0100000A\t0003\t0\t0\t0\t00000000\t0\t0\t0\n"
        );
        std::fs::write(&p.route, r).unwrap();
    }

    fn env_of(path: &str) -> Vec<(String, String)> {
        let env = std::fs::read_to_string(path).unwrap();
        assert_eq!(violation(&env), None, "{env}");
        pairs(&env[..env.len() - "qm_sidecar_end='1'\n".len()])
    }

    fn wds_vals(p: &[(String, String)]) -> [String; 4] {
        ["qmi_wds_ok", "qmi_wds_rx_bytes", "qmi_wds_tx_bytes", "qmi_wds_mux"].map(|n| get(p, n).to_string())
    }

    #[test]
    fn the_wds_lines_sit_last_before_the_terminator_integer_or_empty() {
        let w = WdsView { ok: Some(true), rx: Some(730_344_017), tx: Some(41_000_123), mux: Some(1) };
        let env = render_env(&View { mono_s: Some(5), state: "up", ssr_count: 0, sig: "off", wds: w, bundle: None });
        assert_eq!(violation(&env), None, "{env}");
        assert!(env.ends_with(
            "qmi_scc4_active=''\nqmi_wds_ok='1'\nqmi_wds_rx_bytes='730344017'\nqmi_wds_tx_bytes='41000123'\nqmi_wds_mux='1'\nqm_sidecar_end='1'\n"
        ), "{env}");
        // ok=0 or unknown: never bytes, even if the view carried some.
        for ok in [Some(false), None] {
            let w = WdsView { ok, rx: Some(1), tx: Some(2), mux: Some(3) };
            let env = render_env(&View { mono_s: Some(5), state: "up", ssr_count: 0, sig: "off", wds: w, bundle: None });
            assert_eq!(violation(&env), None, "{env}");
            let p = pairs(&env[..env.len() - 19]);
            let okv = if ok == Some(false) { "0" } else { "" };
            assert_eq!(wds_vals(&p), [okv.to_string(), String::new(), String::new(), "3".to_string()]);
        }
        // A full u64 stays an integer.
        let w = WdsView { ok: Some(true), rx: Some(u64::MAX), tx: Some(0), mux: Some(16) };
        let env = render_env(&View { mono_s: Some(5), state: "up", ssr_count: 0, sig: "off", wds: w, bundle: None });
        assert_eq!(violation(&env), None, "{env}");
        let j = render_json(&View { mono_s: Some(5), state: "up", ssr_count: 0, sig: "off", wds: w, bundle: None });
        assert!(j.ends_with(",\"wds\":{\"ok\":true,\"rx_bytes\":18446744073709551615,\"tx_bytes\":0,\"mux\":16}}\n"), "{j}");
    }

    #[test]
    fn a_call_publishes_the_summed_counters_of_the_bound_clients() {
        let (d, p) = call_dir("wds-sum", Some(0), true);
        let env_p = p.env.clone();
        let (net, md) = wds_net();
        md.rx4.store(730_328_803, SeqCst);
        md.tx4.store(41_000_123, SeqCst);
        let reg = start_registry_wds(&net);
        let mut s = Sampler::new(p, log());
        // IPv6 out of call (0x000F): adds nothing, ok stays 1.
        s.sample_at(&reg, Tier::None);
        assert_eq!(wds_vals(&env_of(&env_p)), ["1", "730328803", "41000123", "1"].map(String::from));
        // A v6 call too: the sum.
        md.v6_call.store(true, SeqCst);
        md.rx6.store(1_000, SeqCst);
        md.tx6.store(10, SeqCst);
        s.sample_at(&reg, Tier::None);
        assert_eq!(wds_vals(&env_of(&env_p)), ["1", "730329803", "41000133", "1"].map(String::from));
        assert!(std::fs::read_to_string(paths(&d).json).unwrap().contains("\"wds\":{\"ok\":true,\"rx_bytes\":730329803"));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn no_call_publishes_empty_values_and_binds_nothing() {
        for (name, n, ipa, mux) in [("wds-nocall", None, true, ""), ("wds-noipa", Some(2), false, "3")] {
            let (d, p) = call_dir(name, n, ipa);
            let env_p = p.env.clone();
            let (net, _md) = wds_net();
            let reg = start_registry_wds(&net);
            let mut s = Sampler::new(p, log());
            s.sample_at(&reg, Tier::None);
            let pr = env_of(&env_p);
            assert_eq!(get(&pr, "qmi_state"), "up");
            assert_eq!(wds_vals(&pr), ["", "", "", mux].map(String::from), "{name}");
            assert!(net.sent().iter().all(|x| x.svc != crate::qmi::SVC_WDS), "{name}: nothing sent to WDS");
            let _ = std::fs::remove_dir_all(&d);
        }
    }

    #[test]
    fn a_mux_change_rebinds_and_the_new_mux_is_published() {
        let (d, p) = call_dir("wds-mux", Some(0), true);
        let env_p = p.env.clone();
        let (net, md) = wds_net();
        md.rx4.store(5, SeqCst);
        let reg = start_registry_wds(&net);
        let mut s = Sampler::new(p, log());
        s.sample_at(&reg, Tier::None);
        assert_eq!(get(&env_of(&env_p), "qmi_wds_mux"), "1");
        set_route(&paths(&d), 5);
        s.sample_at(&reg, Tier::None);
        let pr = env_of(&env_p);
        assert_eq!((get(&pr, "qmi_wds_ok"), get(&pr, "qmi_wds_mux")), ("1", "6"));
        let binds: Vec<u8> = net
            .sent()
            .iter()
            .filter(|x| x.svc == crate::qmi::SVC_WDS && x.msg.id == 0x00A2)
            .filter_map(|x| x.msg.tlv(0x11).and_then(|v| v.first().copied()))
            .collect();
        assert_eq!(binds, vec![1, 1, 6, 6], "both clients bound to mux 1, then both to mux 6");
        let _ = std::fs::remove_dir_all(&d);
    }

    /// An IPv6 default route on rmnet_data<n> (the v6-only call's table).
    fn set_route6(p: &Paths, n: u8) {
        let z = "0".repeat(32);
        let r = format!("{z} 00 {z} 00 {z} 00000400 00000001 00000000 00450003 rmnet_data{n}\n");
        std::fs::write(&p.route6, r).unwrap();
    }

    fn wds_msgs(net: &crate::qmi::fake::FakeNet, id: u16) -> usize {
        net.sent().iter().filter(|x| x.svc == crate::qmi::SVC_WDS && x.msg.id == id).count()
    }

    fn bind_muxes(net: &crate::qmi::fake::FakeNet) -> Vec<u8> {
        net.sent()
            .iter()
            .filter(|x| x.svc == crate::qmi::SVC_WDS && x.msg.id == 0x00A2)
            .filter_map(|x| x.msg.tlv(0x11).and_then(|v| v.first().copied()))
            .collect()
    }

    #[test]
    fn an_ipv6_only_call_binds_and_reads_the_ipv6_client_alone() {
        let (d, p) = call_dir("wds-v6only", None, true);
        set_route6(&p, 0);
        let env_p = p.env.clone();
        let (net, md) = wds_net();
        md.v6_call.store(true, SeqCst);
        md.rx6.store(1_000, SeqCst);
        md.tx6.store(10, SeqCst);
        // A v4 client would answer; it must never be asked.
        md.rx4.store(777, SeqCst);
        let reg = start_registry_wds(&net);
        let mut s = Sampler::new(p, log());
        s.sample_at(&reg, Tier::None);
        assert_eq!(wds_vals(&env_of(&env_p)), ["1", "1000", "10", "1"].map(String::from));
        assert_eq!((wds_msgs(&net, 0x00A2), wds_msgs(&net, 0x004D), wds_msgs(&net, 0x0024)), (1, 1, 1), "the v6 client only");
        assert_eq!(reg.wds_bind_state(IpFamily::V4), WdsBind::Unbound);
        assert_eq!(reg.wds_bind_state(IpFamily::V6), WdsBind::Bound { mux: 1, subs_ok: true });
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn an_ipv6_only_call_follows_its_mux_and_grows_into_dual_stack() {
        let (d, p) = call_dir("wds-v6mux", None, true);
        set_route6(&p, 0);
        let (env_p, p2) = (p.env.clone(), paths(&d));
        let (net, md) = wds_net();
        md.v6_call.store(true, SeqCst);
        md.rx6.store(500, SeqCst);
        let reg = start_registry_wds(&net);
        let mut s = Sampler::new(p, log());
        s.sample_at(&reg, Tier::None);
        // The call comes back on another PDN: rebind to its mux.
        set_route6(&p2, 4);
        s.sample_at(&reg, Tier::None);
        let pr = env_of(&env_p);
        assert_eq!((get(&pr, "qmi_wds_ok"), get(&pr, "qmi_wds_rx_bytes"), get(&pr, "qmi_wds_mux")), ("1", "500", "5"));
        assert_eq!(bind_muxes(&net), vec![1, 5]);
        // An IPv4 default appears on the same PDN: the v4 client joins the sum.
        set_route(&p2, 4);
        md.rx4.store(200, SeqCst);
        s.sample_at(&reg, Tier::None);
        assert_eq!(wds_vals(&env_of(&env_p)), ["1", "700", "0", "5"].map(String::from));
        assert_eq!(bind_muxes(&net), vec![1, 5, 5], "v6 stays bound, v4 binds once");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_flapping_ipv4_route_does_not_shrink_the_sum_while_v4_reads_ok() {
        let (d, p) = call_dir("wds-v4flap", Some(0), true);
        set_route6(&p, 0);
        let (env_p, p2) = (p.env.clone(), paths(&d));
        let (net, md) = wds_net();
        md.rx4.store(100, SeqCst);
        md.v6_call.store(true, SeqCst);
        md.rx6.store(50, SeqCst);
        let reg = start_registry_wds(&net);
        let mut s = Sampler::new(p, log());
        s.sample_at(&reg, Tier::None);
        assert_eq!(get(&env_of(&env_p), "qmi_wds_rx_bytes"), "150");
        // The v4 default route is gone for a moment, the call is not.
        std::fs::remove_file(&p2.route).unwrap();
        s.sample_at(&reg, Tier::None);
        assert_eq!(wds_vals(&env_of(&env_p)), ["1", "150", "0", "1"].map(String::from));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn an_ipv6_only_call_rebinds_after_an_ssr_and_still_leaves_v4_alone() {
        let (d, p) = call_dir("wds-v6ssr", None, true);
        set_route6(&p, 0);
        let env_p = p.env.clone();
        let (net, md) = wds_net();
        md.v6_call.store(true, SeqCst);
        md.rx6.store(9, SeqCst);
        let reg = start_registry_wds(&net);
        let mut s = Sampler::new(p, log());
        s.sample_at(&reg, Tier::None);
        assert_eq!(get(&env_of(&env_p), "qmi_wds_ok"), "1");
        for (svc, _) in reg.states() {
            net.del_server(svc);
        }
        let end = Instant::now() + Duration::from_secs(2);
        while reg.states().iter().any(|(_, st)| *st == SvcState::Up) && Instant::now() < end {
            std::thread::sleep(Duration::from_millis(2));
        }
        for (i, svc) in crate::qmi::SERVICES.iter().enumerate() {
            net.add_server(*svc, 0, 0xA0 + i as u32);
        }
        let end = Instant::now() + Duration::from_secs(2);
        while !(reg.states().iter().all(|(_, st)| *st == SvcState::Up)
            && reg.wds_bind_state(IpFamily::V6) == WdsBind::Bound { mux: 1, subs_ok: true })
            && Instant::now() < end
        {
            std::thread::sleep(Duration::from_millis(2));
        }
        s.sample_at(&reg, Tier::None);
        assert_eq!(wds_vals(&env_of(&env_p)), ["1", "9", "0", "1"].map(String::from));
        assert_eq!(reg.wds_bind_state(IpFamily::V4), WdsBind::Unbound);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn an_ipv6_table_without_a_data_route_is_no_call() {
        let (d, p) = call_dir("wds-v6none", None, true);
        let z = "0".repeat(32);
        // The RM551E's table today: reject default on lo, link-local on LAN.
        std::fs::write(
            &p.route6,
            format!("{z} 00 {z} 00 {z} ffffffff 00000001 00000000 00200200 lo\nfe800000000000000000000000000000 40 {z} 00 {z} 00000100 00000001 00000000 00000001 eth0\n"),
        )
        .unwrap();
        let env_p = p.env.clone();
        let (net, _md) = wds_net();
        let reg = start_registry_wds(&net);
        let mut s = Sampler::new(p, log());
        s.sample_at(&reg, Tier::None);
        assert_eq!(wds_vals(&env_of(&env_p)), ["", "", "", ""].map(String::from));
        assert!(net.sent().iter().all(|x| x.svc != crate::qmi::SVC_WDS));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_failed_read_is_ok_0_and_a_lost_family_never_shrinks_the_sum() {
        let (d, p) = call_dir("wds-fail", Some(0), true);
        let env_p = p.env.clone();
        let (net, md) = wds_net();
        md.rx4.store(100, SeqCst);
        md.v6_call.store(true, SeqCst);
        md.rx6.store(50, SeqCst);
        let reg = start_registry_wds(&net);
        let mut s = Sampler::new(p, log());
        s.sample_at(&reg, Tier::None);
        assert_eq!(get(&env_of(&env_p), "qmi_wds_rx_bytes"), "150");
        // The v6 client stops answering 0x0024 with a real error: ok=0 this
        // cycle (a v4-only sum would look like a counter drop).
        let v6_sock = net.sent().iter().rev().find(|x| x.msg.id == 0x004D).unwrap().sock;
        let model = md.clone();
        net.set_responder_by_sock(move |sock, svc, m| {
            if sock == v6_sock && m.id == 0x0024 {
                use crate::qmi::msg::{encode, result_tlv, KIND_RESP};
                return Some(encode(KIND_RESP, m.txn, m.id, &[result_tlv(Some(0x0003))]));
            }
            match (svc, m.id) {
                (crate::qmi::SVC_WDS, 0x00A2 | 0x00AF | 0x004D | 0x0024) => model.reply(sock, m),
                _ => crate::qmi::fake::r1_reply(svc, m),
            }
        });
        s.sample_at(&reg, Tier::None);
        assert_eq!(wds_vals(&env_of(&env_p)), ["0", "", "", "1"].map(String::from));
        // Still failing next cycle: no longer a fresh loss, v4 alone is published.
        s.sample_at(&reg, Tier::None);
        assert_eq!(wds_vals(&env_of(&env_p)), ["1", "100", "0", "1"].map(String::from));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_down_cycle_blanks_the_wds_values_and_reads_nothing() {
        let (d, p) = call_dir("wds-down", Some(0), true);
        let env_p = p.env.clone();
        let (net, md) = wds_net();
        md.rx4.store(9, SeqCst);
        let reg = start_registry_wds(&net);
        let mut s = Sampler::new(p, log());
        s.sample_at(&reg, Tier::None);
        assert_eq!(get(&env_of(&env_p), "qmi_wds_ok"), "1");
        for (svc, _) in reg.states() {
            net.del_server(svc);
        }
        let end = Instant::now() + Duration::from_secs(2);
        while reg.states().iter().any(|(_, st)| *st == SvcState::Up) && Instant::now() < end {
            std::thread::sleep(Duration::from_millis(2));
        }
        let before = net.sent().len();
        s.sample_at(&reg, Tier::None);
        let pr = env_of(&env_p);
        assert_eq!(get(&pr, "qmi_state"), "down");
        assert_eq!(get(&pr, "qmi_lte_pci"), "295", "the bundle is republished");
        assert_eq!(wds_vals(&pr), ["", "", "", ""].map(String::from), "WDS values are never republished");
        assert_eq!(net.sent().len(), before);
        // Back up: the rebuilt clients are bound again before the next read.
        for (i, svc) in crate::qmi::SERVICES.iter().enumerate() {
            net.add_server(*svc, 0, 0xA0 + i as u32);
        }
        let end = Instant::now() + Duration::from_secs(2);
        let bound = |f| matches!(reg.wds_bind_state(f), crate::qmi::registry::WdsBind::Bound { mux: 1, .. });
        while !(reg.states().iter().all(|(_, st)| *st == SvcState::Up) && bound(IpFamily::V4) && bound(IpFamily::V6))
            && Instant::now() < end
        {
            std::thread::sleep(Duration::from_millis(2));
        }
        s.sample_at(&reg, Tier::None);
        assert_eq!(wds_vals(&env_of(&env_p)), ["1", "9", "0", "1"].map(String::from));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn wds_stats_follow_the_sidecar_cadence_not_the_lease_rate() {
        let (d, p) = call_dir("wds-rate", Some(0), true);
        let (net, _md) = wds_net();
        let reg = start_registry_wds(&net);
        let mut s = Sampler::new(p, log());
        for _ in 0..5 {
            s.sample_at(&reg, Tier::Aim);
        }
        let reads = || net.sent().iter().filter(|x| x.svc == crate::qmi::SVC_WDS && x.msg.id == 0x0024).count();
        assert_eq!(reads(), 2, "one read per family for the one sidecar write");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_leased_sample_publishes_the_live_file_beside_both_sidecars() {
        let d = dir("leased");
        let p = paths(&d);
        let (env_p, json_p) = (p.env.clone(), p.json.clone());
        let tok = "ab".repeat(32);
        std::fs::write(d.join("token"), format!("{tok}\n")).unwrap();
        std::fs::write(d.join("aim"), format!("{}\n", boot_secs())).unwrap();
        let reg = start_registry(&r1_net());
        let mut s = Sampler::new(p, log());
        s.live.start();
        s.sample(&reg);
        assert_eq!(violation(&std::fs::read_to_string(&env_p).unwrap()), None);
        assert!(std::fs::read_to_string(&json_p).unwrap().contains("\"qmi_state\":\"up\""));
        let f = std::fs::read_to_string(d.join("pub").join(format!("{tok}.json"))).unwrap();
        assert!(f.contains("\"period_ms\":1000,\"qmi_state\":\"up\"") && f.contains("\"pci\":295"), "{f}");
        assert_eq!(std::fs::read(d.join("pub").join("index.html")).unwrap(), b"");
        // The retired Phase 1 lease file means nothing any more.
        std::fs::remove_file(d.join("aim")).unwrap();
        std::fs::write(d.join("q_live"), b"").unwrap();
        assert_eq!(s.live.tier(boot_secs()), Tier::None);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn the_sidecars_keep_a_2_s_cadence_under_a_lease_but_follow_changes_at_once() {
        let t0 = Instant::now();
        let ms = |n: u64| t0 + Duration::from_millis(n);
        // No lease: every sample (2 s apart) writes.
        assert!(sidecar_due(Tier::None, Some(t0), t0, false));
        // The first sample always writes.
        assert!(sidecar_due(Tier::Aim, None, t0, false));
        // Not at 1.8 s, yes at 2.0 s (any grid), and jitter that
        // lands the 2.0 s sample a few ms early still counts.
        assert!(!sidecar_due(Tier::Aim, Some(t0), ms(1800), false));
        assert!(sidecar_due(Tier::Aim, Some(t0), ms(1997), false));
        assert!(sidecar_due(Tier::Aim, Some(t0), ms(2000), false));
        assert!(!sidecar_due(Tier::Watch, Some(t0), ms(1000), false));
        assert!(sidecar_due(Tier::Watch, Some(t0), ms(2000), false));
        // A state or SSR change writes at once.
        assert!(sidecar_due(Tier::Aim, Some(t0), ms(200), true));

        let d = dir("throttle");
        let p = paths(&d);
        let env_p = p.env.clone();
        let tok = "ef".repeat(32);
        std::fs::write(d.join("token"), &tok).unwrap();
        std::fs::write(d.join("aim"), format!("{}\n", boot_secs())).unwrap();
        let reg = start_registry(&r1_net());
        let mut s = Sampler::new(p, log());
        s.live.start();
        for _ in 0..5 {
            s.sample_at(&reg, Tier::Aim);
        }
        assert_eq!(s.side_writes, 1, "five back-to-back aim samples write the sidecars once");
        let f = std::fs::read_to_string(d.join("pub").join(format!("{tok}.json"))).unwrap();
        assert_eq!(f.matches("{\"seq\":").count(), 5, "the live file has every sample: {f}");
        assert_eq!(violation(&std::fs::read_to_string(&env_p).unwrap()), None);
        // 2 s later the next sample writes them again.
        s.side_at = s.side_at.and_then(|t| t.checked_sub(SIDECAR_EVERY));
        s.sample_at(&reg, Tier::Aim);
        assert_eq!(s.side_writes, 2);
        // A state change (here: the SSR count moving) writes at once.
        s.side_ssr += 1;
        s.sample_at(&reg, Tier::Aim);
        assert_eq!(s.side_writes, 3);
        s.sample_at(&reg, Tier::Aim);
        assert_eq!(s.side_writes, 3);
        // Without a lease every sample writes, as before.
        s.sample_at(&reg, Tier::None);
        s.sample_at(&reg, Tier::None);
        assert_eq!(s.side_writes, 5);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn samples_follow_a_fixed_deadline_grid_and_resync_when_far_behind() {
        let t0 = Instant::now();
        let ms = |n: u64| t0 + Duration::from_millis(n);
        let p = Duration::from_millis(200);
        // On time or a little late: the grid holds.
        assert_eq!(next_deadline(t0, p, ms(12)), ms(200));
        assert_eq!(next_deadline(t0, p, ms(350)), ms(200));
        assert_eq!(next_deadline(t0, p, ms(400)), ms(200));
        // More than a period late: resync to now, no burst.
        assert_eq!(next_deadline(t0, p, ms(401)), ms(401));
        assert_eq!(next_deadline(t0, p, ms(3000)), ms(3000));
        // The run loop's arithmetic on a virtual clock: a sample costs
        // 12 ms and every sleep overshoots by 1 ms, yet 10 s gives exactly
        // 50 samples (the old "period after the sample" gave ~47).
        let (mut now, mut prev, mut n) = (t0, None::<Instant>, 0u32);
        while now < ms(10_000) {
            let due = prev.map_or(now, |q| next_deadline(q, p, now));
            if now >= due {
                n += 1;
                prev = Some(due);
                now += Duration::from_millis(12);
                continue;
            }
            now = due + Duration::from_millis(1);
        }
        assert_eq!(n, 50);
    }

    #[test]
    fn the_sampler_thread_follows_the_tiers_and_expires_the_lease() {
        let d = dir("run");
        let p = paths(&d);
        let json_p = p.json.clone();
        let tok = "cd".repeat(32);
        let reg = start_registry(&r1_net());
        let r2 = reg.clone();
        std::thread::spawn(move || run(&r2, p, log()));
        let pubf = d.join("pub").join(format!("{tok}.json"));
        let mtime = |p: &std::path::Path| std::fs::metadata(p).and_then(|m| m.modified()).ok();
        // Distinct publications of the live file and of the sidecar JSON
        // seen while polling for `ms`.
        let changes = |ms: u64| {
            let end = Instant::now() + Duration::from_millis(ms);
            let (mut lf, mut lj) = (mtime(&pubf), mtime(std::path::Path::new(&json_p)));
            let (mut nf, mut nj) = (0, 0);
            while Instant::now() < end {
                let (f, j) = (mtime(&pubf), mtime(std::path::Path::new(&json_p)));
                if f != lf {
                    nf += 1;
                    lf = f;
                }
                if j != lj {
                    nj += 1;
                    lj = j;
                }
                std::thread::sleep(Duration::from_millis(5));
            }
            (nf, nj)
        };
        // Idle: the first sample is immediate, the next is 2 s later.
        std::thread::sleep(Duration::from_millis(600));
        assert!(mtime(std::path::Path::new(&json_p)).is_some(), "the first sample is not delayed");
        assert_eq!(changes(1000).1, 0, "idle period is 2 s");
        // watch: about 1 Hz.
        let stamp = |t: &str| std::fs::write(d.join(t), format!("{}\n", boot_secs())).unwrap();
        std::fs::write(d.join("token"), &tok).unwrap();
        stamp("watch");
        let t0 = Instant::now();
        while !pubf.exists() && t0.elapsed() < Duration::from_secs(2) {
            std::thread::sleep(Duration::from_millis(5));
        }
        assert!(t0.elapsed() < Duration::from_millis(300), "lease to file took {:?}", t0.elapsed());
        let (n, _) = changes(2100);
        assert!((1..=3).contains(&n), "watch gave {n} publications in 2.1 s");
        // aim beats watch but runs at the same 1 Hz since 5 Hz was dropped,
        // never faster; the sidecars keep their 2 s cadence.
        stamp("watch");
        stamp("aim");
        let (n, nj) = changes(1600);
        assert!(n >= 1, "aim gave {n} publications in 1.6 s");
        assert!(n <= 2, "aim must stay at or under 1 Hz, got {n} in 1.6 s");
        assert!(nj <= 1, "the sidecar JSON was written {nj} times in 1.6 s of aim");
        stamp("aim");
        let (n, nj) = changes(4100);
        assert!((3..=5).contains(&n), "aim gave {n} publications in 4.1 s");
        assert!((1..=3).contains(&nj), "the sidecar JSON was written {nj} times in 4.1 s of aim");
        // Lease gone: expiry removes the token and the file within a slice.
        std::fs::remove_file(d.join("aim")).unwrap();
        std::fs::remove_file(d.join("watch")).unwrap();
        let t0 = Instant::now();
        while (pubf.exists() || d.join("token").exists()) && t0.elapsed() < Duration::from_secs(2) {
            std::thread::sleep(Duration::from_millis(5));
        }
        assert!(!pubf.exists() && !d.join("token").exists(), "expired within {:?}", t0.elapsed());
        assert!(d.join("pub").join("index.html").exists());
        let _ = std::fs::remove_dir_all(&d);
    }
}
