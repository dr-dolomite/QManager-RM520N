//! /tmp/qmanager_at.lock, shared with the RM520N shell qcmd (`flock -x -n` on a
//! read-only fd 9), sms_tool callers and www-data CGIs.
//! Same semantics as qcmd's flock_wait: non-blocking tries on a 100 ms grain
//! until the budget runs out, then one final try.

use std::fs::{File, OpenOptions};
use std::io;
use std::os::unix::fs::OpenOptionsExt;
use std::os::unix::io::AsRawFd;
use std::thread;
use std::time::{Duration, Instant};

pub const LOCK_FILE: &str = "/tmp/qmanager_at.lock";

pub struct LockFile {
    file: File,
}

pub struct Held<'a> {
    lock: &'a LockFile,
}

impl LockFile {
    /// RM520N: www-data-owned in sticky /tmp, so root may not O_CREAT it; open
    /// read-only, never create (qmanager_setup does). flock works read-only.
    pub fn open(path: &str) -> io::Result<LockFile> {
        let file = OpenOptions::new()
            .read(true)
            // Never follow a planted symlink; a planted FIFO must not block.
            .custom_flags(crate::common::safefs::NOFOLLOW | libc::O_NONBLOCK)
            .open(path)?;
        crate::common::safefs::check_trusted(&file)?;
        Ok(LockFile { file })
    }

    fn try_lock(&self) -> bool {
        unsafe { libc::flock(self.file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) == 0 }
    }

    /// Waits up to `budget` for the exclusive lock.
    pub fn acquire(&self, budget: Duration) -> Option<Held<'_>> {
        let deadline = Instant::now() + budget;
        loop {
            if self.try_lock() {
                return Some(Held { lock: self });
            }
            if Instant::now() >= deadline {
                break;
            }
            thread::sleep(Duration::from_millis(100));
        }
        if self.try_lock() {
            Some(Held { lock: self })
        } else {
            None
        }
    }
}

impl Drop for Held<'_> {
    fn drop(&mut self) {
        unsafe {
            libc::flock(self.lock.file.as_raw_fd(), libc::LOCK_UN);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn second_holder_waits_then_times_out() {
        let p = std::env::temp_dir().join(format!("qatd-lock-{}", std::process::id()));
        let p = p.to_str().unwrap();
        std::fs::write(p, b"").unwrap();
        let a = LockFile::open(p).unwrap();
        let b = LockFile::open(p).unwrap();
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
        let p = std::env::temp_dir().join(format!("qatd-lock-fifo-{}", std::process::id()));
        let p = p.to_str().unwrap();
        let _ = std::fs::remove_file(p);
        assert!(LockFile::open(p).is_err(), "a missing lock is an error");
        assert!(!std::path::Path::new(p).exists(), "never created");
        let c = std::ffi::CString::new(p).unwrap();
        assert_eq!(unsafe { libc::mkfifo(c.as_ptr(), 0o666) }, 0);
        assert!(LockFile::open(p).is_err(), "a FIFO is refused");
        let _ = std::fs::remove_file(p);
    }
}
