//! RM520N (D4): systemd readiness and watchdog. The ping stops once an AT job
//! outlives any real exchange, so systemd restarts a frozen broker.

use crate::common::log::Logger;
use crate::common::proto;
use std::os::unix::net::UnixDatagram;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

/// Longer than any real AT or SMS job: the client's own reply timeout.
pub(crate) const FROZEN_AFTER: Duration = crate::client::transport::CLIENT_REPLY_TIMEOUT;

/// Sends one sd_notify datagram to `path` (`@name` = abstract socket).
fn send_to(path: &str, msg: &str) -> bool {
    let Ok(sock) = UnixDatagram::unbound() else { return false };
    match path.strip_prefix('@') {
        Some(name) => {
            use std::os::linux::net::SocketAddrExt;
            std::os::unix::net::SocketAddr::from_abstract_name(name.as_bytes())
                .and_then(|a| sock.send_to_addr(msg.as_bytes(), &a))
                .is_ok()
        }
        None => sock.send_to(msg.as_bytes(), path).is_ok(),
    }
}

fn notify(msg: &str) -> bool {
    match std::env::var("NOTIFY_SOCKET") {
        Ok(p) if !p.is_empty() => send_to(&p, msg),
        _ => false,
    }
}

/// Tells systemd (Type=notify) the socket is bound; a no-op outside systemd.
pub(crate) fn ready() {
    notify("READY=1");
}

/// Ping period: a third of `WATCHDOG_USEC`, only if the watchdog is ours.
fn interval_from(usec: Option<&str>, pid: Option<&str>, me: u32) -> Option<Duration> {
    let usec: u64 = usec?.trim().parse().ok().filter(|&u| u > 0)?;
    if let Some(p) = pid {
        if p.trim().parse::<u32>().ok() != Some(me) {
            return None;
        }
    }
    Some(Duration::from_micros(usec / 3).max(Duration::from_millis(500)))
}

/// Idle, or the running job is younger than `FROZEN_AFTER` (monotonic ms).
fn healthy(busy_since_ms: u64, now_ms: u64) -> bool {
    busy_since_ms == 0 || now_ms.saturating_sub(busy_since_ms) < FROZEN_AFTER.as_millis() as u64
}

/// Starts the ping thread when systemd armed a watchdog for this process.
pub(crate) fn start(busy: Arc<AtomicU64>, log: Arc<Logger>) {
    let usec = std::env::var("WATCHDOG_USEC").ok();
    let pid = std::env::var("WATCHDOG_PID").ok();
    let Some(every) = interval_from(usec.as_deref(), pid.as_deref(), std::process::id()) else { return };
    let l = log.clone();
    let spawned = std::thread::Builder::new().name("atd-watchdog".into()).stack_size(64 * 1024).spawn(move || {
        let mut withheld = false;
        loop {
            let (b, now) = (busy.load(Ordering::Relaxed), proto::mono_ms());
            if healthy(b, now) {
                notify("WATCHDOG=1");
                withheld = false;
            } else if !withheld {
                l.error(&format!("AT lane stuck for {}s; withholding the watchdog ping", now.saturating_sub(b) / 1000));
                withheld = true;
            }
            std::thread::sleep(every);
        }
    });
    if let Err(e) = spawned {
        log.warn(&format!("cannot start the watchdog thread: {e}"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_job_past_the_limit_withholds_the_ping() {
        let limit = FROZEN_AFTER.as_millis() as u64;
        assert!(healthy(0, 5_000_000));
        assert!(healthy(1_000, 1_000 + limit - 1));
        assert!(!healthy(1_000, 1_000 + limit));
        // A clock read before the job's own start never looks frozen.
        assert!(healthy(2_000, 1_000));
    }

    #[test]
    fn the_watchdog_runs_only_when_armed_for_this_pid() {
        assert_eq!(interval_from(Some("30000000"), None, 7), Some(Duration::from_secs(10)));
        assert_eq!(interval_from(Some("30000000"), Some("7"), 7), Some(Duration::from_secs(10)));
        assert_eq!(interval_from(Some("30000000"), Some("8"), 7), None);
        assert_eq!(interval_from(None, None, 7), None);
        assert_eq!(interval_from(Some("0"), None, 7), None);
        assert_eq!(interval_from(Some("junk"), None, 7), None);
        assert_eq!(interval_from(Some("600"), None, 7), Some(Duration::from_millis(500)));
    }

    #[test]
    fn a_notify_datagram_reaches_the_socket() {
        let p = std::env::temp_dir().join(format!("qatd-notify-{}.sock", std::process::id()));
        let p = p.to_str().unwrap().to_string();
        let _ = std::fs::remove_file(&p);
        let rx = UnixDatagram::bind(&p).unwrap();
        rx.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
        assert!(send_to(&p, "READY=1"));
        let mut buf = [0u8; 64];
        let n = rx.recv(&mut buf).unwrap();
        assert_eq!(&buf[..n], b"READY=1");
        let _ = std::fs::remove_file(&p);
        assert!(!send_to(&p, "WATCHDOG=1"));
    }
}
