//! /run/qmanager_at/at.lock (dir root:dialout 0750, lock 0640): only root and
//! the CGIs' dialout group can open it, so no other local uid can hold the
//! modem; only root can create anything there, so nothing can be planted.
//! Non-blocking tries on a 100 ms grain until the budget runs out, then one
//! final try. While the root-only bridge marker exists (an OTA or rollback
//! crossing the move), the legacy /tmp lock is taken too, after this one.

use std::fs::{File, OpenOptions};
use std::io;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
use std::os::unix::io::AsRawFd;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

pub const LOCK_DIR: &str = "/run/qmanager_at";
pub const LOCK_FILE: &str = "/run/qmanager_at/at.lock";
/// Made by the installer / rollback prep while old code may still run; /run is tmpfs, so a reboot clears it.
pub const BRIDGE_MARKER: &str = "/run/qmanager_at/bridge";
/// The pre-T4.3 lock that v0.1.17 and earlier flock.
pub const LEGACY_LOCK: &str = "/tmp/qmanager_at.lock";

struct Bridge {
    marker: PathBuf,
    legacy: PathBuf,
}

pub struct LockFile {
    file: File,
    bridge: Option<Bridge>,
}

pub struct Held<'a> {
    lock: &'a LockFile,
    // Closing it releases the legacy flock.
    _legacy: Option<File>,
}

enum Legacy {
    Off,
    Take(File),
    Skip(&'static str),
}

impl LockFile {
    /// Opens read-only, never creates (flock works on a read-only fd).
    pub fn open(path: &str) -> io::Result<LockFile> {
        let file = OpenOptions::new()
            .read(true)
            // Never follow a planted symlink; a planted FIFO must not block.
            .custom_flags(crate::common::safefs::NOFOLLOW | libc::O_NONBLOCK)
            .open(path)?;
        crate::common::safefs::check_trusted(&file)?;
        Ok(LockFile { file, bridge: None })
    }

    /// The modem lock with the legacy bridge, as every production holder uses it.
    pub fn open_modem() -> io::Result<LockFile> {
        Ok(LockFile::open(LOCK_FILE)?.with_bridge(BRIDGE_MARKER, LEGACY_LOCK))
    }

    /// The in-process clients' open (shell parity, T4.1 S1): root creates a
    /// missing dir or lock; a CGI cannot and gets the open error.
    pub fn open_or_create_modem() -> io::Result<LockFile> {
        match LockFile::open_modem() {
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                create_modem_lock(LOCK_DIR, LOCK_FILE)?;
                LockFile::open_modem()
            }
            r => r,
        }
    }

    pub fn with_bridge(mut self, marker: &str, legacy: &str) -> LockFile {
        self.bridge = Some(Bridge { marker: marker.into(), legacy: legacy.into() });
        self
    }

    fn try_lock(&self) -> bool {
        unsafe { libc::flock(self.file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) == 0 }
    }

    fn unlock(&self) {
        unsafe {
            libc::flock(self.file.as_raw_fd(), libc::LOCK_UN);
        }
    }

    /// Checked with this lock held, so every holder that starts after the
    /// marker appears also takes the legacy lock.
    fn legacy(&self) -> Legacy {
        let Some(b) = &self.bridge else { return Legacy::Off };
        match std::fs::symlink_metadata(&b.marker) {
            Ok(m) if m.file_type().is_file() && m.uid() == 0 && m.nlink() == 1 => {}
            _ => return Legacy::Off,
        }
        let f = match OpenOptions::new()
            .read(true)
            .custom_flags(crate::common::safefs::NOFOLLOW | libc::O_NONBLOCK)
            .open(&b.legacy)
        {
            Ok(f) => f,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Legacy::Skip("absent"),
            Err(_) => return Legacy::Skip("unopenable"),
        };
        // nlink 1: a hard link to some root-owned 0666 /tmp file is refused.
        match f.metadata() {
            Ok(m) if crate::common::safefs::check_trusted(&f).is_ok() && m.nlink() == 1 => Legacy::Take(f),
            _ => Legacy::Skip("untrusted"),
        }
    }

    /// One try at both locks: new first, then (bridged) legacy; never one without the other.
    fn try_both(&self) -> Option<Held<'_>> {
        if !self.try_lock() {
            return None;
        }
        match self.legacy() {
            Legacy::Off => Some(Held { lock: self, _legacy: None }),
            Legacy::Skip(why) => {
                warn_once(why);
                Some(Held { lock: self, _legacy: None })
            }
            Legacy::Take(f) => {
                if unsafe { libc::flock(f.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } == 0 {
                    Some(Held { lock: self, _legacy: Some(f) })
                } else {
                    self.unlock();
                    None
                }
            }
        }
    }

    /// Waits up to `budget` for the exclusive lock.
    pub fn acquire(&self, budget: Duration) -> Option<Held<'_>> {
        let deadline = Instant::now() + budget;
        loop {
            if let Some(h) = self.try_both() {
                return Some(h);
            }
            if Instant::now() >= deadline {
                break;
            }
            thread::sleep(Duration::from_millis(100));
        }
        self.try_both()
    }
}

impl Drop for Held<'_> {
    fn drop(&mut self) {
        self.lock.unlock();
    }
}

fn warn_once(why: &str) {
    static WARNED: AtomicBool = AtomicBool::new(false);
    if !WARNED.swap(true, Ordering::Relaxed) {
        crate::common::log::Logger::new("qmanager_atd")
            .warn(&format!("AT lock bridge on but legacy {LEGACY_LOCK} {why}; not taken"));
    }
}

/// Root only: makes a missing dir root:dialout 0750 and a missing lock
/// root:dialout 0640 (flock needs only a read fd). An existing dir must be root's.
fn create_modem_lock(dir: &str, path: &str) -> io::Result<()> {
    if unsafe { libc::geteuid() } != 0 {
        return Err(io::Error::new(io::ErrorKind::NotFound, "AT lock missing; only root creates it"));
    }
    let gid = crate::common::safefs::dialout_gid()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "no dialout group"))?;
    match std::fs::symlink_metadata(dir) {
        Ok(m) if m.file_type().is_dir() && m.uid() == 0 => {}
        Ok(_) => return Err(io::Error::new(io::ErrorKind::PermissionDenied, "lock dir not root's")),
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            std::fs::create_dir(dir)?;
            std::os::unix::fs::chown(dir, Some(0), Some(gid))?;
            std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o750))?;
        }
        Err(e) => return Err(e),
    }
    match OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o640)
        .custom_flags(crate::common::safefs::NOFOLLOW)
        .open(path)
    {
        Ok(f) => {
            std::os::unix::fs::fchown(&f, Some(0), Some(gid))?;
            f.set_permissions(std::fs::Permissions::from_mode(0o640))
        }
        Err(e) if e.kind() == io::ErrorKind::AlreadyExists => Ok(()),
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> String {
        let p = std::env::temp_dir().join(format!("qatd-lock-{tag}-{}", std::process::id()));
        p.to_str().unwrap().to_string()
    }

    /// A lock, a marker and a legacy file under one fresh dir.
    fn bridged(tag: &str, marker: bool) -> (String, String, String) {
        let d = tmp(tag);
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir(&d).unwrap();
        let (l, m, g) = (format!("{d}/at.lock"), format!("{d}/bridge"), format!("{d}/legacy.lock"));
        std::fs::write(&l, b"").unwrap();
        std::fs::write(&g, b"").unwrap();
        if marker {
            std::fs::write(&m, b"").unwrap();
        }
        (l, m, g)
    }

    #[test]
    fn second_holder_waits_then_times_out() {
        let p = tmp("plain");
        std::fs::write(&p, b"").unwrap();
        let a = LockFile::open(&p).unwrap();
        let b = LockFile::open(&p).unwrap();
        let held = a.acquire(Duration::from_millis(50)).unwrap();
        let t = Instant::now();
        assert!(b.acquire(Duration::from_millis(250)).is_none());
        assert!(t.elapsed() >= Duration::from_millis(250));
        drop(held);
        assert!(b.acquire(Duration::from_millis(50)).is_some());
        let _ = std::fs::remove_file(p);
    }

    #[test]
    fn never_creates_and_refuses_a_fifo_without_blocking() {
        let p = tmp("fifo");
        let _ = std::fs::remove_file(&p);
        assert!(LockFile::open(&p).is_err(), "a missing lock is an error");
        assert!(!std::path::Path::new(&p).exists(), "never created");
        let c = std::ffi::CString::new(p.as_str()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(c.as_ptr(), 0o666) }, 0);
        assert!(LockFile::open(&p).is_err(), "a FIFO is refused");
        let _ = std::fs::remove_file(p);
    }

    /// True while some other open file description holds `path`'s flock.
    fn held_elsewhere(path: &str) -> bool {
        let f = File::open(path).unwrap();
        unsafe { libc::flock(f.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) != 0 }
    }

    #[test]
    fn bridge_takes_legacy_only_while_the_marker_exists() {
        if unsafe { libc::geteuid() } != 0 {
            // The marker must be root's; as non-root, only the off path is testable.
            let (l, m, g) = bridged("nomark-user", true);
            let lock = LockFile::open(&l).unwrap().with_bridge(&m, &g);
            let _h = lock.acquire(Duration::ZERO).unwrap();
            assert!(!held_elsewhere(&g), "a non-root marker never turns the bridge on");
            return;
        }
        let (l, m, g) = bridged("mark", true);
        let lock = LockFile::open(&l).unwrap().with_bridge(&m, &g);
        let h = lock.acquire(Duration::ZERO).unwrap();
        assert!(held_elsewhere(&g), "legacy taken with the marker on");
        drop(h);
        assert!(!held_elsewhere(&g), "legacy released with the hold");
        std::fs::remove_file(&m).unwrap();
        let _h = lock.acquire(Duration::ZERO).unwrap();
        assert!(!held_elsewhere(&g), "marker off: legacy untouched");
    }

    #[test]
    fn legacy_held_elsewhere_is_busy_and_releases_the_new_lock() {
        if unsafe { libc::geteuid() } != 0 {
            return;
        }
        let (l, m, g) = bridged("busy", true);
        let other = File::open(&g).unwrap();
        assert_eq!(unsafe { libc::flock(other.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) }, 0);
        let lock = LockFile::open(&l).unwrap().with_bridge(&m, &g);
        assert!(lock.acquire(Duration::from_millis(150)).is_none());
        assert!(!held_elsewhere(&l), "new lock not left held");
        drop(other);
        assert!(lock.acquire(Duration::ZERO).is_some());
    }

    #[test]
    fn hard_linked_or_missing_legacy_is_skipped_not_busy() {
        if unsafe { libc::geteuid() } != 0 {
            return;
        }
        let (l, m, g) = bridged("link", true);
        let elsewhere = format!("{g}.other");
        std::fs::hard_link(&g, &elsewhere).unwrap();
        let holder = File::open(&elsewhere).unwrap();
        assert_eq!(unsafe { libc::flock(holder.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) }, 0);
        let lock = LockFile::open(&l).unwrap().with_bridge(&m, &g);
        assert!(lock.acquire(Duration::ZERO).is_some(), "nlink 2: skipped, not waited on");
        drop(holder);
        std::fs::remove_file(&elsewhere).unwrap();
        std::fs::remove_file(&g).unwrap();
        assert!(lock.acquire(Duration::ZERO).is_some(), "absent legacy: skipped");
    }

    #[test]
    fn create_makes_the_lock_once_and_never_truncates() {
        let d = tmp("create");
        let _ = std::fs::remove_dir_all(&d);
        let p = format!("{d}/at.lock");
        if unsafe { libc::geteuid() } != 0 {
            assert!(create_modem_lock(&d, &p).is_err(), "a non-root caller cannot make the dir");
            return;
        }
        create_modem_lock(&d, &p).unwrap();
        let m = std::fs::metadata(&d).unwrap();
        assert_eq!(m.mode() & 0o7777, 0o750);
        assert_eq!(std::fs::metadata(&p).unwrap().mode() & 0o777, 0o640);
        std::fs::write(&p, b"x").unwrap();
        create_modem_lock(&d, &p).unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), b"x", "existing lock kept");
        let _ = std::fs::remove_dir_all(&d);
    }
}
