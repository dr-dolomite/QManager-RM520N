//! File writes that never follow symlinks. /tmp and /var/lock are both 1777 on
//! the device, so any local process can pre-plant a symlink at a well-known
//! path (e.g. a /tmp state file). A root process
//! writing through it would clobber an arbitrary file. Legacy qcmd's
//! `echo … > "$LONG_FLAG"` had this flaw; the broker must not.

use std::fs::{File, OpenOptions};
use std::io::{self, Write};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};

/// Open flags shared by every QManager state file the broker touches.
pub const NOFOLLOW: i32 = libc::O_NOFOLLOW | libc::O_CLOEXEC;

fn open_nofollow(path: &str, create_new: bool) -> io::Result<File> {
    let mut o = OpenOptions::new();
    // O_NONBLOCK: a planted FIFO fails (ENXIO) or opens at once and is refused.
    o.write(true).mode(0o644).custom_flags(NOFOLLOW | libc::O_NONBLOCK);
    // RM520N: no O_CREAT on an existing file; protected_regular refuses root
    // that on a www-data-owned file in sticky /tmp (the long flag).
    if create_new {
        o.create_new(true);
    }
    o.open(path)
}

/// www-data's uid, looked up once (musl reads /etc/passwd); None if unknown.
pub(crate) fn www_data_uid() -> Option<u32> {
    static UID: std::sync::OnceLock<Option<u32>> = std::sync::OnceLock::new();
    *UID.get_or_init(|| unsafe {
        let pw = libc::getpwnam(c"www-data".as_ptr());
        if pw.is_null() {
            None
        } else {
            Some((*pw).pw_uid)
        }
    })
}

/// The `dialout` gid (owns /dev/smd11; lighttpd runs its CGIs with it); None if unknown.
pub(crate) fn dialout_gid() -> Option<u32> {
    unsafe {
        let gr = libc::getgrnam(c"dialout".as_ptr());
        if gr.is_null() {
            None
        } else {
            Some((*gr).gr_gid)
        }
    }
}

/// State files may be owned by root, this process, or www-data (CGIs and
/// qmanager_cell_scanner create the long flag and the lock as www-data).
pub(crate) fn trusted_owner(uid: u32) -> bool {
    uid == 0 || uid == unsafe { libc::geteuid() } || Some(uid) == www_data_uid()
}

/// Refuses anything but a regular file with a trusted owner (fstat: the file
/// actually opened, not whatever the path names now).
pub fn check_trusted(f: &File) -> io::Result<()> {
    use std::os::unix::fs::MetadataExt;
    let m = f.metadata()?;
    if m.file_type().is_file() && trusted_owner(m.uid()) {
        Ok(())
    } else {
        Err(io::Error::new(io::ErrorKind::PermissionDenied, "untrusted state file"))
    }
}

/// Opens a trusted file at `path` for writing, else creates it O_EXCL; a link,
/// FIFO, hard-linked (nlink > 1) or foreign file is unlinked and recreated, a directory refused.
fn open_trusted(path: &str) -> io::Result<File> {
    let refused = match open_nofollow(path, false) {
        // A directory never gets here: a write open of it fails EISDIR.
        Ok(f) => match check_trusted(&f) {
            Ok(()) if f.metadata()?.nlink() == 1 => return Ok(f),
            _ => true,
        },
        // O_NOFOLLOW on a symlink fails with ELOOP; a FIFO without a reader
        // fails with ENXIO under O_NONBLOCK.
        Err(e) if matches!(e.raw_os_error(), Some(libc::ELOOP) | Some(libc::ENXIO)) => true,
        Err(e) if e.kind() == io::ErrorKind::NotFound => false,
        Err(e) => return Err(e),
    };
    if refused {
        std::fs::remove_file(path)?;
    }
    match open_nofollow(path, true) {
        Err(e) if !refused && e.kind() == io::ErrorKind::AlreadyExists => {
            // Lost a create race to another writer: open theirs, if trusted.
            let f = open_nofollow(path, false)?;
            check_trusted(&f)?;
            Ok(f)
        }
        r => r,
    }
}

/// Writes `contents` to `path` without ever following a symlink at `path` or
/// blocking on a FIFO there; see `open_trusted`.
pub fn write_nofollow(path: &str, contents: &[u8]) -> io::Result<()> {
    let mut f = open_trusted(path)?;
    f.set_len(0)?;
    f.write_all(contents)
}

/// Replaces `path` with `contents` atomically: written to `<path>.new`
/// (O_EXCL + O_NOFOLLOW, mode 0644), then renamed over `path`. A leftover or
/// planted `.new` is unlinked first (unlink acts on a symlink itself; a
/// planted directory is removed with its contents, never followed), and
/// rename replaces a symlink at `path` rather than following it. A directory
/// planted at `path` itself is refused (rename cannot replace it) and left
/// alone. Readers see the old file or the whole new one, never a partial
/// write; a failure removes the temp file.
pub fn write_atomic(path: &str, contents: &[u8]) -> io::Result<()> {
    let tmp = format!("{path}.new");
    clear_temp(&tmp);
    if let Err(e) = open_nofollow(&tmp, true).and_then(|mut f| f.write_all(contents)) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e
    })
}

/// Removes whatever sits at a temp path: a file or link is unlinked, a real
/// directory (lstat, so never a link's target) removed recursively;
/// `remove_dir_all` does not follow symlinks inside it.
fn clear_temp(tmp: &str) {
    match std::fs::symlink_metadata(tmp) {
        Ok(m) if m.file_type().is_dir() => {
            let _ = std::fs::remove_dir_all(tmp);
        }
        Ok(_) => {
            let _ = std::fs::remove_file(tmp);
        }
        Err(_) => {}
    }
}

/// Makes `dir` a real directory owned by the effective user with `mode`, as
/// `qm_root_dir` does for the shell side: a symlink, file or someone else's
/// directory at `dir` is removed first (unlink never follows a link). Err if
/// it cannot be made trustworthy; the caller must then not write into it.
/// Called before every publish, so the steady state is one lstat: an own
/// directory is only chmodded when its mode is wrong.
pub fn ensure_own_dir(dir: &str, mode: u32) -> io::Result<()> {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    let euid = unsafe { libc::geteuid() };
    if let Ok(m) = std::fs::symlink_metadata(dir) {
        if m.file_type().is_dir() && m.uid() == euid {
            if m.mode() & 0o7777 == mode {
                return Ok(());
            }
            return std::fs::set_permissions(dir, std::fs::Permissions::from_mode(mode));
        }
        if m.file_type().is_dir() {
            std::fs::remove_dir_all(dir)?;
        } else {
            std::fs::remove_file(dir)?;
        }
    }
    std::fs::create_dir(dir)?;
    std::fs::set_permissions(dir, std::fs::Permissions::from_mode(mode))?;
    let m = std::fs::symlink_metadata(dir)?;
    if m.file_type().is_dir() && m.uid() == euid {
        Ok(())
    } else {
        Err(io::Error::new(io::ErrorKind::PermissionDenied, "run dir not trustworthy"))
    }
}

/// Command text for a state file: one line, no CR/LF injection.
pub fn one_line(s: &str) -> String {
    s.chars().filter(|&c| c != '\n' && c != '\r').collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    fn tmp(name: &str) -> String {
        std::env::temp_dir()
            .join(format!("qatd-{name}-{}", std::process::id()))
            .to_str()
            .unwrap()
            .to_string()
    }

    #[test]
    fn writes_a_regular_file() {
        let p = tmp("reg");
        write_nofollow(&p, b"AT+QSCAN=3,1\n").unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), b"AT+QSCAN=3,1\n");
        write_nofollow(&p, b"x").unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), b"x", "truncates on rewrite");
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn never_writes_through_a_planted_symlink() {
        let victim = tmp("victim");
        let flag = tmp("flag");
        std::fs::write(&victim, b"SECRET").unwrap();
        symlink(&victim, &flag).unwrap();

        write_nofollow(&flag, b"attacker text").unwrap();

        assert_eq!(std::fs::read(&victim).unwrap(), b"SECRET", "victim untouched");
        let meta = std::fs::symlink_metadata(&flag).unwrap();
        assert!(meta.file_type().is_file(), "symlink replaced by a regular file");
        assert_eq!(std::fs::read(&flag).unwrap(), b"attacker text");
        let _ = std::fs::remove_file(&victim);
        let _ = std::fs::remove_file(&flag);
    }

    #[test]
    fn a_hard_linked_file_is_unlinked_not_written_through() {
        let victim = tmp("hl-victim");
        let flag = tmp("hl-flag");
        let _ = std::fs::remove_file(&flag);
        std::fs::write(&victim, b"SECRET").unwrap();
        std::fs::hard_link(&victim, &flag).unwrap();
        write_nofollow(&flag, b"x").unwrap();
        assert_eq!(std::fs::read(&victim).unwrap(), b"SECRET", "the other name is untouched");
        assert_eq!(std::fs::read(&flag).unwrap(), b"x");
        assert_eq!(std::fs::metadata(&flag).unwrap().nlink(), 1);
        let _ = std::fs::remove_file(&victim);
        let _ = std::fs::remove_file(&flag);
    }

    #[test]
    fn a_planted_fifo_is_replaced_without_blocking() {
        let p = tmp("fifo");
        let _ = std::fs::remove_file(&p);
        let c = std::ffi::CString::new(p.as_str()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(c.as_ptr(), 0o644) }, 0);
        let (tx, rx) = std::sync::mpsc::channel();
        let q = p.clone();
        std::thread::spawn(move || {
            let _ = tx.send(write_nofollow(&q, b"AT+QSCAN=3,1\n"));
        });
        rx.recv_timeout(std::time::Duration::from_secs(2)).expect("blocked on a FIFO").unwrap();
        assert!(std::fs::symlink_metadata(&p).unwrap().file_type().is_file());
        assert_eq!(std::fs::read(&p).unwrap(), b"AT+QSCAN=3,1\n");
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn a_directory_is_refused_and_left_alone() {
        let d = tmp("flagdir");
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir(&d).unwrap();
        assert!(write_nofollow(&d, b"x").is_err());
        assert!(std::fs::symlink_metadata(&d).unwrap().file_type().is_dir());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn write_atomic_replaces_whole_and_leaves_no_temp() {
        let p = tmp("atomic");
        write_atomic(&p, b"one\n").unwrap();
        write_atomic(&p, b"two\n").unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), b"two\n");
        assert!(!std::path::Path::new(&format!("{p}.new")).exists());
        // A planted link at the target is replaced, not written through; a
        // planted link at the temp name is unlinked, not followed.
        let victim = tmp("atomic-victim");
        std::fs::write(&victim, b"SECRET").unwrap();
        std::fs::remove_file(&p).unwrap();
        symlink(&victim, &p).unwrap();
        symlink(&victim, format!("{p}.new")).unwrap();
        write_atomic(&p, b"three\n").unwrap();
        assert_eq!(std::fs::read(&victim).unwrap(), b"SECRET");
        assert!(std::fs::symlink_metadata(&p).unwrap().file_type().is_file());
        assert_eq!(std::fs::read(&p).unwrap(), b"three\n");
        assert!(!std::path::Path::new(&format!("{p}.new")).exists());
        // A directory planted at the temp name is removed, not written into.
        std::fs::create_dir_all(format!("{p}.new/sub")).unwrap();
        write_atomic(&p, b"four\n").unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), b"four\n");
        assert!(!std::path::Path::new(&format!("{p}.new")).exists());
        // A directory planted at the target is refused cleanly, left alone,
        // and no temp file is left behind.
        let d = tmp("atomic-dir");
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir(&d).unwrap();
        std::fs::write(format!("{d}/keep"), b"k").unwrap();
        assert!(write_atomic(&d, b"x").is_err());
        assert!(std::path::Path::new(&format!("{d}/keep")).exists());
        assert!(!std::path::Path::new(&format!("{d}.new")).exists());
        let _ = std::fs::remove_dir_all(&d);
        // An unwritable directory fails cleanly and leaves nothing behind.
        assert!(write_atomic("/nonexistent-dir-qatd/x", b"x").is_err());
        let _ = std::fs::remove_file(&p);
        let _ = std::fs::remove_file(&victim);
    }

    #[test]
    fn ensure_own_dir_replaces_links_files_and_keeps_a_good_dir() {
        use std::os::unix::fs::PermissionsExt;
        let base = tmp("owndir");
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir(&base).unwrap();
        let d = format!("{base}/run");
        ensure_own_dir(&d, 0o700).unwrap();
        assert_eq!(std::fs::metadata(&d).unwrap().permissions().mode() & 0o777, 0o700);
        std::fs::write(format!("{d}/keep"), b"x").unwrap();
        ensure_own_dir(&d, 0o700).unwrap();
        assert!(std::path::Path::new(&format!("{d}/keep")).exists(), "a good dir is kept");
        // A loosened mode is put back (the steady state skips the chmod).
        std::fs::set_permissions(&d, std::fs::Permissions::from_mode(0o777)).unwrap();
        ensure_own_dir(&d, 0o700).unwrap();
        assert_eq!(std::fs::metadata(&d).unwrap().permissions().mode() & 0o7777, 0o700);
        // A planted symlink is replaced, its target untouched.
        let victim = format!("{base}/victim");
        std::fs::create_dir(&victim).unwrap();
        std::fs::remove_dir_all(&d).unwrap();
        symlink(&victim, &d).unwrap();
        ensure_own_dir(&d, 0o700).unwrap();
        assert!(std::fs::symlink_metadata(&d).unwrap().file_type().is_dir());
        assert!(std::path::Path::new(&victim).exists());
        // A planted file is replaced.
        std::fs::remove_dir_all(&d).unwrap();
        std::fs::write(&d, b"f").unwrap();
        ensure_own_dir(&d, 0o700).unwrap();
        assert!(std::fs::symlink_metadata(&d).unwrap().file_type().is_dir());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn one_line_strips_crlf() {
        assert_eq!(one_line("AT+X\r\nrm -rf /\n"), "AT+Xrm -rf /");
    }
}
