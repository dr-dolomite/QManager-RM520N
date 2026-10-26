//! The one execution path shared by the daemon and the in-process fallback.
//! Mirrors legacy qcmd: long-flag gate, warm-up for long commands, lock budgets,
//! error-code mapping. Output framing is produced by the caller from `Outcome`.

use crate::at::channel::{AtError, Channel, Device};
use crate::at::classify;
use crate::common::lock::LockFile;
use crate::common::log::Logger;
use crate::at::output::Code;
use crate::common::safefs::{one_line, write_nofollow};
use std::time::{Duration, Instant};

pub const LONG_FLAG: &str = "/tmp/qmanager_long_running";
pub const PID_FILE: &str = "/var/lock/qmanager.pid";

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
pub fn long_running() -> bool {
    std::path::Path::new(LONG_FLAG).exists()
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

/// The one AtError -> error-code mapping, shared by AT requests and SMS ops.
fn map_error(log: &Logger, cmd: &str, e: AtError) -> Code {
    match e {
        AtError::Timeout => {
            log.error(&format!("Command killed by deadline: {cmd}"));
            Code::CommandTimeout
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
        if !self.ch.last_drained.is_empty() {
            log_drained(self.log, &self.ch.last_drained, cmd);
        }
        r.map_err(|e| map_error(self.log, cmd, e))
    }

    /// A prompt exchange (AT+CMGS): `payload` is written after the `> ` prompt.
    pub fn at_prompt(&mut self, cmd: &str, payload: &[u8], prompt: Duration, timeout: Duration) -> Result<Vec<u8>, Code> {
        let Some(deadline) = self.bound(timeout) else {
            self.log.error(&format!("SMS session out of time before: {cmd}"));
            return Err(Code::CommandTimeout);
        };
        let r = self.ch.exchange_prompt(cmd, payload, Instant::now() + prompt, deadline);
        r.map_err(|e| map_error(self.log, cmd, e))
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
            if let Err(e) = self.ch.exchange("AT", Instant::now() + Duration::from_secs(3)) {
                let _ = std::fs::remove_file(LONG_FLAG);
                let _ = std::fs::remove_file(PID_FILE);
                self.log.error(&format!("Modem warm-up failed before: {cmd} ({e:?})"));
                return Outcome::Err(Code::ModemNotReady);
            }
        }

        let outcome = match self.ch.exchange(cmd, deadline_for(cmd, long)) {
            Ok(raw) => {
                if !self.ch.last_drained.is_empty() {
                    log_drained(self.log, &self.ch.last_drained, cmd);
                }
                self.log.at_cmd(cmd, &String::from_utf8_lossy(&raw), true);
                Outcome::Ok(raw)
            }
            Err(e) => Outcome::Err(map_error(self.log, cmd, e)),
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
        let lock = LockFile::open(p.to_str().unwrap()).unwrap();
        let log = Logger::new("test");
        // Opening the channel at all would mean the command reached the modem.
        let mut ch: Channel<UnixStream> = Channel::new(Box::new(|| panic!("command was sent")));
        let mut ex = Executor { ch: &mut ch, lock: &lock, log: &log };
        let out = ex.run_after("AT+CSQ", LOCK_WAIT_SHORT + Duration::from_millis(1));
        assert!(matches!(out, Outcome::Err(Code::ModemBusy)));
        let _ = std::fs::remove_file(p);
    }

    #[test]
    fn non_at_input_is_refused_without_the_lock_or_the_modem() {
        let p = std::env::temp_dir().join(format!("qatd-exec-invalid-{}", std::process::id()));
        let lock = LockFile::open(p.to_str().unwrap()).unwrap();
        // Hold the lock: a refusal must not wait for it.
        let _held = lock.acquire(Duration::ZERO).unwrap();
        let other = LockFile::open(p.to_str().unwrap()).unwrap();
        let log = Logger::new("test");
        let mut ch: Channel<UnixStream> = Channel::new(Box::new(|| panic!("command was sent")));
        let mut ex = Executor { ch: &mut ch, lock: &other, log: &log };
        for cmd in ["--bogus", "hello", "AT\rhello"] {
            let t = Instant::now();
            assert!(matches!(ex.run(cmd), Outcome::Err(Code::InvalidCommand)), "{cmd:?}");
            assert!(t.elapsed() < Duration::from_millis(500), "{cmd:?} waited {:?}", t.elapsed());
        }
        let _ = std::fs::remove_file(p);
    }
}
