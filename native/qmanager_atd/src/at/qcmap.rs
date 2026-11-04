//! Is QCMAP_ConnectionManager running, and did the boot start it? `AT+QMAP`
//! with QCMAP down (RG501Q-EU, R6 F1) or after a QCMAP restart (RM520N-GL,
//! S5 F2) wedged smd11 until reboot, so the executor refuses it in both cases.

use crate::common::log::Logger;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

/// The unit's ExecStart on both devices; firmware without it has no guard.
pub const QCMAP_BIN: &str = "/usr/bin/QCMAP_ConnectionManager";
/// `comm` is truncated to 15 bytes.
const QCMAP_COMM: &str = "QCMAP_Connectio";
const CACHE: Duration = Duration::from_secs(2);
/// The boot starts QCMAP at ~9 s; a later start is a restart, unsafe until reboot.
pub const BOOT_WINDOW_SECS: u64 = 120;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum State {
    Running,
    Stopped,
    /// Started after the boot window (seconds since boot; None = stat unreadable).
    Restarted(Option<u64>),
    /// No QCMAP binary: the guard is off.
    Absent,
}

impl State {
    pub fn name(self) -> &'static str {
        match self {
            State::Running => "running",
            State::Stopped => "stopped",
            State::Restarted(_) => "restarted",
            State::Absent => "absent",
        }
    }
}

// What `refuses` last logged.
const LOG_NONE: u8 = 0;
const LOG_STOPPED: u8 = 1;
const LOG_UP: u8 = 2;
const LOG_RESTARTED: u8 = 3;

pub struct Qcmap {
    proc_root: PathBuf,
    bin: PathBuf,
    cache: Mutex<Option<(Instant, State)>>,
    logged: AtomicU8,
}

impl Qcmap {
    pub fn new(proc_root: impl Into<PathBuf>, bin: impl Into<PathBuf>) -> Qcmap {
        Qcmap { proc_root: proc_root.into(), bin: bin.into(), cache: Mutex::new(None), logged: AtomicU8::new(LOG_NONE) }
    }

    pub fn system() -> &'static Qcmap {
        static Q: OnceLock<Qcmap> = OnceLock::new();
        Q.get_or_init(|| Qcmap::new("/proc", QCMAP_BIN))
    }

    pub fn state(&self) -> State {
        let mut c = self.cache.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((at, s)) = *c {
            if at.elapsed() < CACHE {
                return s;
            }
        }
        let s = probe(&self.proc_root, &self.bin, clk_tck());
        *c = Some((Instant::now(), s));
        s
    }

    /// True when `AT+QMAP` must be refused. Logs WARN once per change of reason, INFO on recovery.
    pub fn refuses(&self, log: &Logger, cmd: &str) -> bool {
        let s = self.state();
        let code = match s {
            State::Stopped => LOG_STOPPED,
            State::Restarted(_) => LOG_RESTARTED,
            State::Running | State::Absent => {
                let was = self.logged.load(Ordering::Relaxed);
                if (was == LOG_STOPPED || was == LOG_RESTARTED)
                    && self.logged.compare_exchange(was, LOG_UP, Ordering::Relaxed, Ordering::Relaxed).is_ok()
                {
                    log.info("QCMAP running again: AT+QMAP allowed");
                }
                return false;
            }
        };
        if self.logged.swap(code, Ordering::Relaxed) != code {
            match s {
                State::Restarted(Some(t)) => {
                    log.warn(&format!("QCMAP restarted after boot (started at {t} s): refusing AT+QMAP until reboot"))
                }
                State::Restarted(None) => log.warn("QCMAP start time unreadable: refusing AT+QMAP until reboot"),
                _ => log.warn("QCMAP not running: refusing AT+QMAP"),
            }
        }
        log.debug(&format!("QCMAP {}, refused: {cmd}", s.name()));
        true
    }
}

fn clk_tck() -> u64 {
    // SAFETY: sysconf has no preconditions.
    let t = unsafe { libc::sysconf(libc::_SC_CLK_TCK) };
    if t > 0 { t as u64 } else { 100 }
}

/// `starttime` (field 22, clock ticks since boot) from a /proc/<pid>/stat line.
fn start_ticks(stat: &str) -> Option<u64> {
    // comm (field 2) may hold spaces or ')': fields 3.. follow the last ')'.
    let rest = &stat[stat.rfind(')')? + 1..];
    rest.split_ascii_whitespace().nth(19)?.parse().ok()
}

fn probe(proc_root: &Path, bin: &Path, hz: u64) -> State {
    if !bin.exists() {
        return State::Absent;
    }
    let Ok(dir) = std::fs::read_dir(proc_root) else {
        return State::Stopped;
    };
    // Earliest start among QCMAP processes; None inside = a match with unreadable stat.
    let mut earliest: Option<Option<u64>> = None;
    for e in dir.flatten() {
        let name = e.file_name();
        let pid = name.to_string_lossy();
        if pid.is_empty() || !pid.bytes().all(|b| b.is_ascii_digit()) {
            continue;
        }
        if !std::fs::read_to_string(e.path().join("comm")).map_or(false, |c| c.trim_end() == QCMAP_COMM) {
            continue;
        }
        let secs = std::fs::read_to_string(e.path().join("stat")).ok().as_deref().and_then(start_ticks).map(|t| t / hz);
        earliest = Some(match (earliest, secs) {
            (None, s) => s,
            (Some(Some(a)), Some(b)) => Some(a.min(b)),
            (Some(a), None) => a,
            (Some(None), s) => s,
        });
    }
    match earliest {
        None => State::Stopped,
        Some(Some(t)) if t <= BOOT_WINDOW_SECS => State::Running,
        Some(t) => State::Restarted(t),
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    fn stat_line(pid: &str, comm: &str, start_ticks: u64) -> String {
        // Field 3 is the state, 4..21 filler, 22 starttime.
        let filler = vec!["0"; 18].join(" ");
        format!("{pid} ({comm}) S {filler} {start_ticks} 1234 56\n")
    }

    /// A fake /proc of (pid, comm, start seconds since boot) and an optional QCMAP binary.
    pub(crate) fn fake_at(tag: &str, procs: &[(&str, &str, u64)], bin: bool) -> (PathBuf, Qcmap) {
        let d = std::env::temp_dir().join(format!("qatd-qcmap-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        let root = d.join("proc");
        std::fs::create_dir_all(&root).unwrap();
        for (pid, comm, secs) in procs {
            std::fs::create_dir(root.join(pid)).unwrap();
            std::fs::write(root.join(pid).join("comm"), format!("{comm}\n")).unwrap();
            std::fs::write(root.join(pid).join("stat"), stat_line(pid, comm, secs * clk_tck())).unwrap();
        }
        let b = d.join("QCMAP_ConnectionManager");
        if bin {
            std::fs::write(&b, b"").unwrap();
        }
        (d, Qcmap::new(root, b))
    }

    /// Same, every process started by the boot (9 s).
    pub(crate) fn fake(tag: &str, procs: &[(&str, &str)], bin: bool) -> (PathBuf, Qcmap) {
        let p: Vec<(&str, &str, u64)> = procs.iter().map(|&(pid, comm)| (pid, comm, 9)).collect();
        fake_at(tag, &p, bin)
    }

    #[test]
    fn running_only_when_a_numeric_pid_has_the_truncated_comm() {
        let (d, q) = fake("run", &[("1", "systemd"), ("430", "QCMAP_Connectio")], true);
        assert_eq!(q.state(), State::Running);
        let _ = std::fs::remove_dir_all(d);
        let (d, q) = fake("stop", &[("1", "systemd"), ("self", "QCMAP_Connectio"), ("9", "QCMAP_Connect")], true);
        assert_eq!(q.state(), State::Stopped, "non-numeric dir and a different comm do not count");
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn a_start_after_the_boot_window_is_a_restart() {
        let (d, q) = fake_at("late", &[("8099", "QCMAP_Connectio", 221)], true);
        assert_eq!(q.state(), State::Restarted(Some(221)));
        assert!(q.refuses(&Logger::new("test"), "AT+QMAP=\"WWAN\""));
        let _ = std::fs::remove_dir_all(d);
        let (d, q) = fake_at("edge", &[("432", "QCMAP_Connectio", BOOT_WINDOW_SECS)], true);
        assert_eq!(q.state(), State::Running, "the window's last second still counts as boot");
        let _ = std::fs::remove_dir_all(d);
        let (d, q) = fake_at("two", &[("432", "QCMAP_Connectio", 9), ("900", "QCMAP_Connectio", 400)], true);
        assert_eq!(q.state(), State::Running, "the earliest QCMAP decides");
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn an_unreadable_start_time_fails_closed() {
        let (d, q) = fake("garbage", &[("430", "QCMAP_Connectio")], true);
        std::fs::write(d.join("proc").join("430").join("stat"), b"430 (QCMAP_Connectio) S 1 2").unwrap();
        assert_eq!(q.state(), State::Restarted(None));
        assert!(q.refuses(&Logger::new("test"), "AT+QMAP=\"WWAN\""));
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn start_ticks_reads_field_22_past_an_odd_comm() {
        assert_eq!(start_ticks(&stat_line("7", "a) b (c", 2210)), Some(2210));
        assert_eq!(start_ticks(&stat_line("7", "QCMAP_Connectio", 900)), Some(900));
        assert_eq!(start_ticks("7 (x) S 1 2 3"), None);
        assert_eq!(start_ticks("no paren"), None);
    }

    #[test]
    fn no_binary_means_the_guard_is_off() {
        let (d, q) = fake("absent", &[("1", "systemd")], false);
        assert_eq!(q.state(), State::Absent);
        assert!(!q.refuses(&Logger::new("test"), "AT+QMAP=\"WWAN\""));
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn the_answer_is_cached() {
        let (d, q) = fake("cache", &[("430", "QCMAP_Connectio")], true);
        assert_eq!(q.state(), State::Running);
        std::fs::remove_dir_all(d.join("proc").join("430")).unwrap();
        assert_eq!(q.state(), State::Running, "within the cache window");
        let _ = std::fs::remove_dir_all(d);
    }
}
