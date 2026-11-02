//! The one execution path shared by the daemon and the in-process fallback.
//! Mirrors legacy qcmd: long-flag gate, warm-up for long commands, lock budgets,
//! error-code mapping. Output framing is produced by the caller from `Outcome`.

use crate::at::channel::{AtError, Channel, ChannelEvent, Device};
use crate::at::classify;
use crate::common::lock::LockFile;
use crate::common::log::Logger;
use crate::at::output::Code;
use crate::at::qcmap::Qcmap;
use crate::common::safefs::{one_line, write_nofollow};
use std::time::{Duration, Instant};

/// In the root-only (root:dialout 0750) AT lock dir: only the broker, as root, can raise it.
pub const LONG_FLAG: &str = "/run/qmanager_at/long_running";
/// RM520N: in the broker's root-only run dir (0700, made at daemon start), so
/// nothing can be planted there. The www-data fallback cannot write it; nothing reads it.
pub const PID_FILE: &str = "/var/run/qmanager/atd.pid";

pub const SHORT_DEADLINE: Duration = Duration::from_secs(20);
pub const LONG_DEADLINE: Duration = Duration::from_secs(300);
pub const SLOW_DEADLINE: Duration = Duration::from_secs(60);
pub const LOCK_WAIT_SHORT: Duration = Duration::from_secs(5);
const LOCK_WAIT_LONG: Duration = Duration::from_secs(10);

pub enum Outcome {
    /// Raw bytes exactly as atcli printed them (echo + body + terminator).
    Ok(Vec<u8>),
    Err(Code),
}

pub struct Executor<'a, D: Device> {
    pub ch: &'a mut Channel<D>,
    pub lock: &'a LockFile,
    pub log: &'a Logger,
    pub qcmap: &'a Qcmap,
}

fn deadline_for(cmd: &str, long: bool) -> Instant {
    let d = if long {
        LONG_DEADLINE
    } else if classify::is_slow(cmd) {
        SLOW_DEADLINE
    } else {
        SHORT_DEADLINE
    };
    Instant::now() + d
}

/// Margin before a lock-free flag is treated as abandoned: a flag younger than
/// this may belong to a caller that has only just started a long command (the
/// retired shell qcmd also wrote it before waiting up to LOCK_WAIT_LONG).
const STALE_FLAG_AGE: Duration = Duration::from_secs(15);

/// True while a long command holds the modem (the scan_in_progress gate).
/// Only a trusted flag counts (see `flag_trusted`).
pub fn long_running() -> bool {
    flag_trusted(LONG_FLAG)
}

/// Regular, one link, owned by uid 0: only root can create entries in the flag's
/// dir, so any other owner is a plant. An untrusted flag is logged once.
pub(crate) fn flag_trusted(path: &str) -> bool {
    use std::os::unix::fs::MetadataExt;
    match std::fs::symlink_metadata(path) {
        Err(_) => false,
        Ok(m) if flag_meta_trusted(m.file_type().is_file(), m.nlink(), m.uid()) => true,
        Ok(m) => {
            static WARNED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
            if !WARNED.swap(true, std::sync::atomic::Ordering::Relaxed) {
                Logger::new("qmanager_atd").warn(&format!("Ignoring untrusted {path} (uid {}, links {})", m.uid(), m.nlink()));
            }
            false
        }
    }
}

pub(crate) fn flag_meta_trusted(is_file: bool, nlink: u64, uid: u32) -> bool {
    is_file && nlink == 1 && uid == 0
}

/// Removes a long flag left by a holder that died mid-command (killed broker,
/// broker restart during a scan). Without this every short command answers
/// scan_in_progress until the main service restarts. Safe only when nobody
/// holds the modem lock and the flag is older than STALE_FLAG_AGE.
pub fn clear_stale_long_flag(lock: &LockFile, log: &Logger) {
    let age = match std::fs::symlink_metadata(LONG_FLAG).and_then(|m| m.modified()) {
        Ok(t) => t.elapsed().unwrap_or(Duration::ZERO),
        Err(_) => return,
    };
    if age < STALE_FLAG_AGE {
        return;
    }
    if let Some(_held) = lock.acquire(Duration::ZERO) {
        if std::fs::remove_file(LONG_FLAG).is_ok() {
            log.warn(&format!("Removed stale long-command flag (age {}s, modem lock free)", age.as_secs()));
        }
    }
}

fn log_drained(log: &Logger, drained: &[u8], cmd: &str) {
    let d = String::from_utf8_lossy(drained);
    let d: String = d.chars().take(120).filter(|&c| c != '\r').map(|c| if c == '\n' { ' ' } else { c }).collect();
    log.debug(&format!("drained stale/URC before {cmd}: {d}"));
}

/// Logs a channel up/down change once (the per-command lines go to debug while down).
fn log_event<D: Device>(log: &Logger, ch: &mut Channel<D>) {
    match ch.take_event() {
        Some(ChannelEvent::Down) => log.error("AT channel down: resync failed; failing fast, re-probing every 2-60 s"),
        Some(ChannelEvent::Up { after }) => log.info(&format!("AT channel recovered after {}s", after.as_secs())),
        None => {}
    }
}

/// The one AtError -> error-code mapping, shared by AT requests and SMS ops.
fn map_error(log: &Logger, cmd: &str, e: AtError, down: bool) -> Code {
    match e {
        AtError::Timeout => {
            log.error(&format!("Command killed by deadline: {cmd}"));
            Code::CommandTimeout
        }
        AtError::NotReady if down => {
            log.debug(&format!("Channel down, refused: {cmd}"));
            Code::ModemNotReady
        }
        AtError::NotReady => {
            log.error(&format!("Channel not ready for: {cmd}"));
            Code::ModemNotReady
        }
        // The channel went away under us (SSR / glink reset): the modem is
        // restarting, the command was not at fault.
        e @ AtError::Eof => {
            log.error(&format!("Channel lost during: {cmd} ({e:?})"));
            Code::ModemNotReady
        }
        AtError::Io(e) if crate::at::channel::is_reset(&e) => {
            log.error(&format!("Channel reset during: {cmd} ({e:?})"));
            Code::ModemNotReady
        }
        e => {
            log.error(&format!("Command failed: {cmd} ({e:?})"));
            Code::CommandFailed
        }
    }
}

/// Several exchanges under one hold of the modem lock (an SMS operation).
/// Every exchange is bounded by its own timeout and by the session's end.
pub struct Session<'s, D: Device> {
    ch: &'s mut Channel<D>,
    log: &'s Logger,
    end: Instant,
}

impl<D: Device> Session<'_, D> {
    fn bound(&self, timeout: Duration) -> Option<Instant> {
        let now = Instant::now();
        (now < self.end).then(|| (now + timeout).min(self.end))
    }

    /// One AT exchange. Replies are not logged: SMS listings carry message
    /// bodies (one-time codes), which must not land in the log.
    pub fn at(&mut self, cmd: &str, timeout: Duration) -> Result<Vec<u8>, Code> {
        let Some(deadline) = self.bound(timeout) else {
            self.log.error(&format!("SMS session out of time before: {cmd}"));
            return Err(Code::CommandTimeout);
        };
        let r = self.ch.exchange(cmd, deadline);
        log_event(self.log, self.ch);
        if !self.ch.last_drained.is_empty() {
            log_drained(self.log, &self.ch.last_drained, cmd);
        }
        let down = self.ch.is_down();
        r.map_err(|e| map_error(self.log, cmd, e, down))
    }

    /// A prompt exchange (AT+CMGS): `payload` is written after the `> ` prompt.
    pub fn at_prompt(&mut self, cmd: &str, payload: &[u8], prompt: Duration, timeout: Duration) -> Result<Vec<u8>, Code> {
        let Some(deadline) = self.bound(timeout) else {
            self.log.error(&format!("SMS session out of time before: {cmd}"));
            return Err(Code::CommandTimeout);
        };
        let r = self.ch.exchange_prompt(cmd, payload, Instant::now() + prompt, deadline);
        log_event(self.log, self.ch);
        let down = self.ch.is_down();
        r.map_err(|e| map_error(self.log, cmd, e, down))
    }
}

/// Longest an SMS session may hold the modem. Kept under the client's 340 s
/// reply timeout so a long multipart send never looks like a frozen broker.
pub const SESSION_LIMIT: Duration = Duration::from_secs(270);

impl<D: Device> Executor<'_, D> {
    /// Runs `f` under one acquisition of the modem lock, with the same gate and
    /// budget as a short AT command (scan_in_progress, modem_busy, queue time
    /// counted against the 5 s budget).
    pub fn session<T>(
        &mut self,
        label: &str,
        waited: Duration,
        f: impl FnOnce(&mut Session<'_, D>) -> T,
    ) -> Result<T, Code> {
        if long_running() {
            self.log.log(crate::common::log::Level::Debug, "LOCK: Blocked by long command");
            return Err(Code::ScanInProgress);
        }
        if waited > LOCK_WAIT_SHORT {
            self.log.error(&format!("Lock acquisition failed for: {label} (queued {}ms)", waited.as_millis()));
            return Err(Code::ModemBusy);
        }
        let _held = match self.lock.acquire(LOCK_WAIT_SHORT - waited) {
            Some(h) => h,
            None => {
                self.log.error(&format!("Lock acquisition failed for: {label}"));
                return Err(Code::ModemBusy);
            }
        };
        let _ = write_nofollow(PID_FILE, format!("{}\n", std::process::id()).as_bytes());
        let mut s = Session { ch: &mut *self.ch, log: self.log, end: Instant::now() + SESSION_LIMIT };
        let out = f(&mut s);
        let _ = std::fs::remove_file(PID_FILE);
        Ok(out)
    }

    pub fn run(&mut self, cmd: &str) -> Outcome {
        self.run_after(cmd, Duration::ZERO)
    }

    /// `waited` is how long the caller already queued for this exchange (time
    /// in the broker's accept queue). It counts against the lock budget, so a
    /// request waits no longer in total than legacy qcmd waited for the lock.
    pub fn run_after(&mut self, cmd: &str, waited: Duration) -> Outcome {
        // Checked here too, not only in the client: the socket is the trust
        // boundary. Refused before the lock, so it never delays anyone.
        if !classify::is_at_command(cmd) {
            self.log.warn(&format!("Rejected non-AT command: {}", one_line(cmd)));
            return Outcome::Err(Code::InvalidCommand);
        }
        // QMAP with QCMAP down can wedge smd11; refused before the lock, no I/O.
        if classify::is_qmap(cmd) && self.qcmap.refuses(self.log, cmd) {
            return Outcome::Err(Code::ModemNotReady);
        }
        let long = classify::is_long(cmd);

        // A long command is in progress: short commands fast-reject, exactly
        // like legacy qcmd's LONG_FLAG branch.
        if !long && long_running() {
            self.log.log(crate::common::log::Level::Debug, &format!("LOCK: Blocked by long command"));
            return Outcome::Err(Code::ScanInProgress);
        }

        let budget = if long { LOCK_WAIT_LONG } else { LOCK_WAIT_SHORT };
        if waited > budget {
            self.log.error(&format!("Lock acquisition failed for: {cmd} (queued {}ms)", waited.as_millis()));
            return Outcome::Err(Code::ModemBusy);
        }
        let _held = match self.lock.acquire(budget - waited) {
            Some(h) => h,
            None => {
                self.log.error(&format!("Lock acquisition failed for: {cmd}"));
                return Outcome::Err(Code::ModemBusy);
            }
        };
        let _ = write_nofollow(PID_FILE, format!("{}\n", std::process::id()).as_bytes());

        if long {
            let _ = write_nofollow(LONG_FLAG, format!("{}\n", one_line(cmd)).as_bytes());
            self.log.info(&format!("Long command started: {cmd}"));
            // Warm-up flush, like qcmd:191-192. A failure here is modem_not_ready.
            let warm = self.ch.exchange("AT", Instant::now() + Duration::from_secs(3));
            log_event(self.log, self.ch);
            if let Err(e) = warm {
                let _ = std::fs::remove_file(LONG_FLAG);
                let _ = std::fs::remove_file(PID_FILE);
                let msg = format!("Modem warm-up failed before: {cmd} ({e:?})");
                // While down the one "AT channel down" line already covers it.
                if self.ch.is_down() { self.log.debug(&msg) } else { self.log.error(&msg) }
                return Outcome::Err(Code::ModemNotReady);
            }
        }

        let r = self.ch.exchange(cmd, deadline_for(cmd, long));
        log_event(self.log, self.ch);
        let down = self.ch.is_down();
        let outcome = match r {
            Ok(raw) => {
                if !self.ch.last_drained.is_empty() {
                    log_drained(self.log, &self.ch.last_drained, cmd);
                }
                self.log.at_cmd(cmd, &String::from_utf8_lossy(&raw), true);
                Outcome::Ok(raw)
            }
            Err(e) => Outcome::Err(map_error(self.log, cmd, e, down)),
        };

        if long {
            let _ = std::fs::remove_file(LONG_FLAG);
            self.log.info(&format!("Long command completed: {cmd}"));
        }
        let _ = std::fs::remove_file(PID_FILE);
        outcome
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::net::UnixStream;

    #[test]
    fn request_queued_past_the_lock_budget_is_busy_and_never_sent() {
        let p = std::env::temp_dir().join(format!("qatd-exec-lock-{}", std::process::id()));
        std::fs::write(&p, b"").unwrap();
        let lock = LockFile::open(p.to_str().unwrap()).unwrap();
        let log = Logger::new("test");
        // Opening the channel at all would mean the command reached the modem.
        let mut ch: Channel<UnixStream> = Channel::new(Box::new(|| panic!("command was sent")));
        let mut ex = Executor { ch: &mut ch, lock: &lock, log: &log, qcmap: Qcmap::system() };
        let out = ex.run_after("AT+CSQ", LOCK_WAIT_SHORT + Duration::from_millis(1));
        assert!(matches!(out, Outcome::Err(Code::ModemBusy)));
        let _ = std::fs::remove_file(p);
    }

    #[test]
    fn non_at_input_is_refused_without_the_lock_or_the_modem() {
        let p = std::env::temp_dir().join(format!("qatd-exec-invalid-{}", std::process::id()));
        std::fs::write(&p, b"").unwrap();
        let lock = LockFile::open(p.to_str().unwrap()).unwrap();
        // Hold the lock: a refusal must not wait for it.
        let _held = lock.acquire(Duration::ZERO).unwrap();
        let other = LockFile::open(p.to_str().unwrap()).unwrap();
        let log = Logger::new("test");
        let mut ch: Channel<UnixStream> = Channel::new(Box::new(|| panic!("command was sent")));
        let mut ex = Executor { ch: &mut ch, lock: &other, log: &log, qcmap: Qcmap::system() };
        for cmd in ["--bogus", "hello", "AT\rhello"] {
            let t = Instant::now();
            assert!(matches!(ex.run(cmd), Outcome::Err(Code::InvalidCommand)), "{cmd:?}");
            assert!(t.elapsed() < Duration::from_millis(500), "{cmd:?} waited {:?}", t.elapsed());
        }
        let _ = std::fs::remove_file(p);
    }

    #[test]
    fn qmap_with_qcmap_down_is_refused_before_the_lock() {
        let p = std::env::temp_dir().join(format!("qatd-exec-qmap-{}", std::process::id()));
        std::fs::write(&p, b"").unwrap();
        let lock = LockFile::open(p.to_str().unwrap()).unwrap();
        let _held = lock.acquire(Duration::ZERO).unwrap();
        let other = LockFile::open(p.to_str().unwrap()).unwrap();
        let log = Logger::new("test");
        let mut ch: Channel<UnixStream> = Channel::new(Box::new(|| panic!("command was sent")));
        let (down_dir, down) = crate::at::qcmap::tests::fake("exec-down", &[("1", "systemd")], true);
        let mut ex = Executor { ch: &mut ch, lock: &other, log: &log, qcmap: &down };
        for cmd in ["AT+QMAP=\"WWAN\"", "at+csq;+qmap=\"LANIP\""] {
            let t = Instant::now();
            assert!(matches!(ex.run(cmd), Outcome::Err(Code::ModemNotReady)), "{cmd}");
            assert!(t.elapsed() < Duration::from_millis(500), "{cmd} waited {:?}", t.elapsed());
        }
        // A non-QMAP command still goes to the (held) lock: busy, not refused.
        assert!(matches!(ex.run_after("AT+CSQ", LOCK_WAIT_SHORT - Duration::from_millis(50)), Outcome::Err(Code::ModemBusy)));
        // QCMAP restarted after boot (S5 F2): refused the same way.
        let (late_dir, late) = crate::at::qcmap::tests::fake_at("exec-late", &[("8099", "QCMAP_Connectio", 221)], true);
        let mut ex = Executor { ch: &mut ch, lock: &other, log: &log, qcmap: &late };
        let t = Instant::now();
        assert!(matches!(ex.run("AT+CGCONTRDP;+QMAP=\"WWAN\""), Outcome::Err(Code::ModemNotReady)));
        assert!(t.elapsed() < Duration::from_millis(500));
        let _ = std::fs::remove_dir_all(late_dir);
        // QCMAP up, or no QCMAP binary: QMAP reaches the lock too.
        let (up_dir, up) = crate::at::qcmap::tests::fake("exec-up", &[("430", "QCMAP_Connectio")], true);
        let (off_dir, off) = crate::at::qcmap::tests::fake("exec-off", &[], false);
        for q in [&up, &off] {
            let mut ex = Executor { ch: &mut ch, lock: &other, log: &log, qcmap: q };
            let out = ex.run_after("AT+QMAP=\"WWAN\"", LOCK_WAIT_SHORT - Duration::from_millis(50));
            assert!(matches!(out, Outcome::Err(Code::ModemBusy)));
        }
        for d in [down_dir, up_dir, off_dir] {
            let _ = std::fs::remove_dir_all(d);
        }
        let _ = std::fs::remove_file(p);
    }

    #[test]
    fn flag_trust_is_uid_zero_regular_single_link_only() {
        assert!(flag_meta_trusted(true, 1, 0));
        assert!(!flag_meta_trusted(true, 1, 33), "www-data no longer counts");
        assert!(!flag_meta_trusted(true, 1, 1000));
        assert!(!flag_meta_trusted(true, 2, 0), "hard link");
        assert!(!flag_meta_trusted(false, 1, 0), "not a regular file");
    }

    #[test]
    fn long_flag_counts_only_when_trusted() {
        let d = std::env::temp_dir().join(format!("qatd-flag-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir(&d).unwrap();
        let f = d.join("flag");
        let f = f.to_str().unwrap();
        assert!(!flag_trusted(f), "absent");
        std::fs::write(f, b"QSCAN").unwrap();
        // The real path: counts only when the test runs as root (uid 0 owns the file).
        assert_eq!(flag_trusted(f), unsafe { libc::geteuid() } == 0, "own regular file");
        let link = d.join("flag2");
        std::fs::hard_link(f, &link).unwrap();
        assert!(!flag_trusted(f), "a hard link (nlink 2) is ignored");
        std::fs::remove_file(&link).unwrap();
        std::fs::remove_file(f).unwrap();
        std::os::unix::fs::symlink("/etc/hostname", f).unwrap();
        assert!(!flag_trusted(f), "a symlink is ignored");
        let _ = std::fs::remove_dir_all(&d);
    }
}
