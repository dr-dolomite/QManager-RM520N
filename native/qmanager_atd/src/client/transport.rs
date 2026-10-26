//! Client side of the broker socket, shared by qcmd and qsms: send one
//! request, wait for the reply (watching the long flag), and restart a broker
//! that accepted a request but froze.

use crate::at::exec;
use crate::at::output::Code;
use crate::common::log::Logger;
use crate::common::proto;
use crate::common::safefs;
use std::io::{Read, Write};
use std::os::unix::fs::OpenOptionsExt;
use std::os::unix::net::UnixStream;
use std::os::unix::process::CommandExt;
use std::time::{Duration, Instant};

/// Longest an exchange can take inside the broker: the long deadline, the long
/// lock budget, the warm-up and a worst-case resync with reopen, plus margin.
const CLIENT_REPLY_TIMEOUT: Duration = Duration::from_secs(340);

pub(crate) enum Broker {
    Reply(proto::Reply),
    /// The request never reached the broker: safe to run it in-process.
    Unreachable,
    /// The request was delivered but no reply came back. The broker may have
    /// run it, so running it again in-process could execute a write twice.
    Lost(Code),
}

/// Sends one encoded request (AT or SMS). `short` requests watch the long
/// flag while queued; `label` is what the logs name (never message text).
/// With `cap` (`qcmd -t`), the client stops waiting `cap` after it started and
/// reports modem_busy: the broker skips the request if it is still queued
/// (peer_gone), or discards the reply if it is already running. A capped wait
/// is never read as a frozen broker. Only read-only callers should cap.
pub(crate) fn try_broker_raw(req: &[u8], short: bool, label: &str, cap: Option<Duration>) -> Broker {
    let started = Instant::now();
    let wait = cap.unwrap_or(CLIENT_REPLY_TIMEOUT);
    let mut stream = match UnixStream::connect(proto::SOCKET_PATH) {
        Ok(s) => s,
        Err(_) => return Broker::Unreachable,
    };
    if stream.set_read_timeout(Some(wait)).is_err()
        || stream.set_write_timeout(Some(wait.min(Duration::from_secs(10)))).is_err()
    {
        return Broker::Unreachable;
    }
    // A failed or partial write leaves a body shorter than its header says,
    // which the broker refuses, so falling back cannot double-run it.
    if stream.write_all(req).is_err() {
        return Broker::Unreachable;
    }
    if stream.shutdown(std::net::Shutdown::Write).is_err() {
        return Broker::Lost(Code::CommandFailed);
    }
    // A short command watches the long flag while it waits: one that was
    // already queued when a scan started would otherwise sit behind the whole
    // scan. Only a long command can raise the flag, and the broker runs one
    // request at a time, so while our short command is the one executing the
    // flag cannot appear: seeing it means we are still queued. Dropping the
    // socket then makes the broker skip us (peer_gone), so nothing runs twice.
    let watch = || short && exec::long_running();
    let w = await_reply(&mut stream, started + wait, &watch);
    // Dropping the stream (on return) is what the broker's peer_gone sees.
    settle(w, cap.is_some(), label)
}

/// Maps the end of a wait to the client's result.
fn settle(w: Wait, capped: bool, label: &str) -> Broker {
    match w {
        Wait::Reply(buf) => match proto::decode_reply(&buf) {
            Some(r) => Broker::Reply(r),
            None => Broker::Lost(Code::CommandFailed),
        },
        Wait::Abandoned => Broker::Lost(Code::ScanInProgress),
        // The caller's own budget ran out: the modem is busy for it, nothing
        // says the broker is stuck.
        Wait::TimedOut if capped => Broker::Lost(Code::ModemBusy),
        Wait::TimedOut => {
            restart_frozen_broker(label);
            Broker::Lost(Code::CommandTimeout)
        }
        Wait::Failed => Broker::Lost(Code::CommandFailed),
    }
}

/// How often a waiting client re-checks the long flag.
const WATCH_SLICE: Duration = Duration::from_millis(250);

enum Wait {
    Reply(Vec<u8>),
    /// `give_up` turned true before the reply arrived.
    Abandoned,
    /// No reply by the deadline.
    TimedOut,
    Failed,
}

/// Reads the reply to EOF in WATCH_SLICE steps, checking `give_up` between
/// steps, until `deadline`.
fn await_reply(stream: &mut UnixStream, deadline: Instant, give_up: &dyn Fn() -> bool) -> Wait {
    let mut buf = Vec::new();
    let mut tmp = [0u8; 4096];
    loop {
        let left = match deadline.checked_duration_since(Instant::now()) {
            Some(d) if !d.is_zero() => d,
            _ => return Wait::TimedOut,
        };
        if stream.set_read_timeout(Some(left.min(WATCH_SLICE))).is_err() {
            return Wait::Failed;
        }
        match stream.read(&mut tmp) {
            Ok(0) => return Wait::Reply(buf),
            Ok(n) => buf.extend_from_slice(&tmp[..n]),
            Err(e) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => {}
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
            Err(_) => return Wait::Failed,
        }
        // Only before any reply bytes: once the broker answers, take it.
        if buf.is_empty() && give_up() {
            return Wait::Abandoned;
        }
    }
}

/// Marker that serialises restarts of a frozen broker across clients.
const RESTART_MARKER: &str = "/var/run/qmanager_atd.restart";
/// At most one restart per this window, however many clients time out.
const RESTART_GAP: Duration = Duration::from_secs(120);

/// True if this caller won the right to restart: it created `marker` with
/// O_EXCL, or replaced one older than `gap`. Every other caller in the window
/// sees a fresh marker and leaves the restart to the winner.
fn claim_restart(marker: &str, gap: Duration) -> bool {
    let create = || {
        std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .custom_flags(safefs::NOFOLLOW)
            .open(marker)
            .is_ok()
    };
    if create() {
        return true;
    }
    let age = std::fs::symlink_metadata(marker)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.elapsed().ok());
    match age {
        Some(a) if a < gap => false,
        // Old (or unreadable) marker: remove it and race for a fresh one.
        _ => std::fs::remove_file(marker).is_ok() && create(),
    }
}

/// The broker accepted our request but sent nothing back within the longest
/// possible exchange: it is alive but stuck, and procd never restarts a
/// process that has not exited. Ask the init script to restart it, detached so
/// it outlives this client, and leave the request unanswered: it may have run.
fn restart_frozen_broker(cmd: &str) {
    let log = Logger::new("qcmd");
    if !claim_restart(RESTART_MARKER, RESTART_GAP) {
        log.warn(&format!("broker gave no reply for: {cmd}; restart already requested"));
        return;
    }
    log.error(&format!(
        "broker gave no reply in {}s for: {cmd}; restarting it",
        CLIENT_REPLY_TIMEOUT.as_secs()
    ));
    let mut c = std::process::Command::new("/etc/init.d/qmanager_atd");
    c.arg("restart")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    // New session: a CGI timeout killing our process group must not kill the
    // restart half-way.
    unsafe {
        c.pre_exec(|| {
            libc::setsid();
            Ok(())
        });
    }
    if let Err(e) = c.spawn() {
        log.error(&format!("could not restart the broker: {e}"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::daemon::peer_gone;
    use std::os::unix::io::AsRawFd;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::thread;

    fn soon(ms: u64) -> Instant {
        Instant::now() + Duration::from_millis(ms)
    }

    #[test]
    fn a_capped_wait_that_runs_out_is_busy_not_a_frozen_broker() {
        // Capped: modem_busy, and settle must not reach restart_frozen_broker
        // (which would spawn the init script).
        assert!(matches!(settle(Wait::TimedOut, true, "AT+CSQ"), Broker::Lost(Code::ModemBusy)));
        assert!(matches!(settle(Wait::Abandoned, true, "AT+CSQ"), Broker::Lost(Code::ScanInProgress)));
        assert!(matches!(settle(Wait::Failed, true, "AT+CSQ"), Broker::Lost(Code::CommandFailed)));
        match settle(Wait::Reply(b"OK 2\nhi".to_vec()), true, "AT") {
            Broker::Reply(proto::Reply::Ok(raw)) => assert_eq!(raw, b"hi"),
            _ => panic!("expected the reply"),
        }
    }

    #[test]
    fn a_capped_client_hangs_up_on_time_so_the_broker_skips_it() {
        // A broker that accepted but never answers: the capped wait ends at
        // the cap, and the hang-up is visible to the broker's peer_gone.
        let (mut client, broker) = UnixStream::pair().unwrap();
        let t = Instant::now();
        let w = await_reply(&mut client, t + Duration::from_millis(300), &|| false);
        assert!(matches!(w, Wait::TimedOut));
        let e = t.elapsed();
        assert!(e >= Duration::from_millis(300) && e < Duration::from_millis(700), "{e:?}");
        assert!(matches!(settle(w, true, "AT+CSQ"), Broker::Lost(Code::ModemBusy)));
        drop(client);
        let mut p = libc::pollfd { fd: broker.as_raw_fd(), events: 0, revents: 0 };
        unsafe { libc::poll(&mut p, 1, 2000) };
        assert!(peer_gone(&broker));
    }

    #[test]
    fn queued_short_command_gives_up_when_a_scan_starts() {
        let (mut client, broker) = UnixStream::pair().unwrap();
        let scan = Arc::new(AtomicBool::new(false));
        let s2 = scan.clone();
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(300));
            s2.store(true, Ordering::SeqCst);
        });
        let t = Instant::now();
        let w = await_reply(&mut client, soon(5000), &|| scan.load(Ordering::SeqCst));
        assert!(matches!(w, Wait::Abandoned));
        // Gave up within about one slice of the flag appearing.
        assert!(t.elapsed() < Duration::from_millis(900), "{:?}", t.elapsed());
        // Dropping the client is what the broker's peer_gone check sees.
        drop(client);
        // Wait for the hang-up rather than sampling it: a test running in
        // parallel that spawns a process holds a forked copy of `client` until
        // its exec, which delays the close by a few milliseconds.
        let mut p = libc::pollfd { fd: broker.as_raw_fd(), events: 0, revents: 0 };
        unsafe { libc::poll(&mut p, 1, 2000) };
        assert!(p.revents & libc::POLLHUP != 0);
    }

    #[test]
    fn a_reply_that_has_started_is_taken_even_if_the_flag_appears() {
        let (mut client, mut broker) = UnixStream::pair().unwrap();
        thread::spawn(move || {
            broker.write_all(b"OK 4\nAB").unwrap();
            thread::sleep(Duration::from_millis(400));
            broker.write_all(b"CD").unwrap();
        });
        thread::sleep(Duration::from_millis(50));
        match await_reply(&mut client, soon(5000), &|| true) {
            Wait::Reply(b) => assert_eq!(b, b"OK 4\nABCD"),
            _ => panic!("expected the reply"),
        }
    }

    #[test]
    fn no_reply_by_the_deadline_is_a_timeout() {
        let (mut client, _broker) = UnixStream::pair().unwrap();
        let t = Instant::now();
        assert!(matches!(await_reply(&mut client, soon(600), &|| false), Wait::TimedOut));
        assert!(t.elapsed() >= Duration::from_millis(600));
    }

    #[test]
    fn only_one_restart_per_window() {
        let p = std::env::temp_dir().join(format!("qatd-restart-{}", std::process::id()));
        let p = p.to_str().unwrap();
        let _ = std::fs::remove_file(p);
        assert!(claim_restart(p, Duration::from_secs(120)));
        assert!(!claim_restart(p, Duration::from_secs(120)));
        // An old marker (a restart long ago) is replaced.
        let old = std::time::SystemTime::now() - Duration::from_secs(300);
        std::fs::File::options().write(true).open(p).unwrap().set_modified(old).unwrap();
        assert!(claim_restart(p, Duration::from_secs(120)));
        let _ = std::fs::remove_file(p);
    }
}
