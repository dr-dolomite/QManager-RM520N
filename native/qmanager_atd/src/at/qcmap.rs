//! Is QCMAP_ConnectionManager running? `AT+QMAP` with QCMAP down can wedge
//! smd11 for tens of minutes (RG501Q-EU 2026-11-01), so the executor refuses it.

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

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum State {
    Running,
    Stopped,
    /// No QCMAP binary: the guard is off.
    Absent,
}

impl State {
    pub fn name(self) -> &'static str {
        match self {
            State::Running => "running",
            State::Stopped => "stopped",
            State::Absent => "absent",
        }
    }
}

pub struct Qcmap {
    proc_root: PathBuf,
    bin: PathBuf,
    cache: Mutex<Option<(Instant, State)>>,
    /// 0 = nothing logged yet, 1 = logged down, 2 = logged up after down.
    logged: AtomicU8,
}

impl Qcmap {
    pub fn new(proc_root: impl Into<PathBuf>, bin: impl Into<PathBuf>) -> Qcmap {
        Qcmap { proc_root: proc_root.into(), bin: bin.into(), cache: Mutex::new(None), logged: AtomicU8::new(0) }
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
        let s = probe(&self.proc_root, &self.bin);
        *c = Some((Instant::now(), s));
        s
    }

    /// True when `AT+QMAP` must be refused. Logs WARN once per down spell, INFO on recovery.
    pub fn refuses(&self, log: &Logger, cmd: &str) -> bool {
        if self.state() != State::Stopped {
            if self.logged.compare_exchange(1, 2, Ordering::Relaxed, Ordering::Relaxed).is_ok() {
                log.info("QCMAP running again: AT+QMAP allowed");
            }
            return false;
        }
        if self.logged.swap(1, Ordering::Relaxed) != 1 {
            log.warn("QCMAP not running: refusing AT+QMAP");
        }
        log.debug(&format!("QCMAP not running, refused: {cmd}"));
        true
    }
}

fn probe(proc_root: &Path, bin: &Path) -> State {
    if !bin.exists() {
        return State::Absent;
    }
    let Ok(dir) = std::fs::read_dir(proc_root) else {
        return State::Stopped;
    };
    let found = dir.flatten().any(|e| {
        let name = e.file_name();
        let pid = name.to_string_lossy();
        !pid.is_empty()
            && pid.bytes().all(|b| b.is_ascii_digit())
            && std::fs::read_to_string(e.path().join("comm")).map_or(false, |c| c.trim_end() == QCMAP_COMM)
    });
    if found {
        State::Running
    } else {
        State::Stopped
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A fake /proc with the given (pid, comm) entries and an optional QCMAP binary.
    pub(crate) fn fake(tag: &str, procs: &[(&str, &str)], bin: bool) -> (PathBuf, Qcmap) {
        let d = std::env::temp_dir().join(format!("qatd-qcmap-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        let root = d.join("proc");
        std::fs::create_dir_all(&root).unwrap();
        for (pid, comm) in procs {
            std::fs::create_dir(root.join(pid)).unwrap();
            std::fs::write(root.join(pid).join("comm"), format!("{comm}\n")).unwrap();
        }
        let b = d.join("QCMAP_ConnectionManager");
        if bin {
            std::fs::write(&b, b"").unwrap();
        }
        (d, Qcmap::new(root, b))
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
