//! The AT channel (/dev/smd11). glink_pkt does the framing in the kernel, so
//! this is plain read/write. What atcli_smd11 lacked, and this adds:
//! - a real deadline on every read (poll), so a stalled glink read can no
//!   longer hold the modem lock for 300 s;
//! - a drain before each send, so a late reply or unsolicited line left in the
//!   channel never leaks into the next caller's output;
//! - resync (AT -> OK) after a timeout, and reopen if the channel stays dead.
//!
//! Callers must hold /var/lock/qmanager.lock for the whole exchange. The
//! channel is never read outside an exchange, because the retired sms_tool opened the same
//! device under the same lock (verified on-device: a second opener still gets
//! its own reply while this fd stays open and idle).

use std::fs::{File, OpenOptions};
use std::io;
use std::os::unix::fs::OpenOptionsExt;
use std::os::unix::io::{AsRawFd, RawFd};
use std::time::{Duration, Instant};

/// Final result codes, identical to atcli_smd11 (prefix match on a full line).
pub const TERMINATORS: &[&[u8]] = &[
    b"+CME ERROR:",
    b"+CMS ERROR:",
    b"BUSY\r\n",
    b"ERROR\r\n",
    b"NO ANSWER\r\n",
    b"NO CARRIER\r\n",
    b"NO DIALTONE\r\n",
    b"OK\r\n",
];

pub fn is_terminator(line: &[u8]) -> bool {
    TERMINATORS.iter().any(|t| line.starts_with(t))
}

/// Errors that mean the channel itself went away (baseband SSR, glink reset),
/// not that the command was bad. Seen on the RM551E during an SSR: ECONNRESET
/// on read and EBUSY on open/read. The caller reports these as modem_not_ready.
pub fn is_reset(e: &io::Error) -> bool {
    matches!(
        e.raw_os_error(),
        Some(
            libc::ECONNRESET
                | libc::ENETRESET
                | libc::ECONNABORTED
                | libc::EPIPE
                | libc::EBUSY
                | libc::ENODEV
                | libc::ENXIO
                | libc::ENOENT
                | libc::ENOTCONN
                | libc::ESHUTDOWN
        )
    )
}

#[derive(Debug)]
pub enum AtError {
    /// No final result code before the deadline.
    Timeout,
    /// The device returned EOF (e.g. baseband SSR).
    Eof,
    // Read only through Debug in the "Command failed" log line; the dead-code
    // lint ignores derived impls, so silence it rather than drop the detail.
    Io(#[allow(dead_code)] io::Error),
    /// Resync failed even after reopening the device.
    NotReady,
}

/// Anything that can stand in for the modem (the device file, or a socket in tests).
pub trait Device: AsRawFd {}
impl Device for File {}
impl Device for std::os::unix::net::UnixStream {}

enum Prompt {
    /// The prompt arrived; holds any bytes read after it.
    Ready(Vec<u8>),
    /// A final result code arrived instead (the whole reply).
    Refused(Vec<u8>),
}

pub struct Channel<D: Device> {
    opener: Box<dyn Fn() -> io::Result<D> + Send>,
    dev: Option<D>,
    dirty: bool,
    /// True once a command has been written on the current fd. glink_pkt resets
    /// the channel (EBUSY/ECONNRESET) if you read before the first write, so a
    /// drain only runs on an established fd — never right after open. Matches
    /// atcli, which always wrote before reading.
    established: bool,
    /// Bytes read past a terminator (a URC glued onto the reply) that belong to
    /// no command. Folded into the next drain so they are logged, not returned.
    pending: Vec<u8>,
    /// Bytes drained before the last send (stale replies or URCs), for logging.
    pub last_drained: Vec<u8>,
}

/// Bound on a blocking open. glink_pkt's open() waits for the remote channel,
/// which can stall while the baseband restarts (SSR).
const OPEN_TIMEOUT: Duration = Duration::from_secs(5);

/// glink_pkt only works on a blocking fd (verified on-device): O_NONBLOCK at
/// open() fails with EBUSY, and a non-blocking write never succeeds (EBUSY for
/// the whole deadline), because it is the blocking write that asks the remote
/// for an RX intent. So the fd stays blocking, like atcli. Deadlines still hold:
/// reads go through poll() first, writes through a bounded helper thread. The
/// open itself runs on a helper thread so a stalled open (SSR) can't hang us.
pub fn open_smd(path: &str) -> io::Result<File> {
    let p = path.to_string();
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let r = OpenOptions::new()
            .read(true)
            .write(true)
            .custom_flags(libc::O_NOCTTY | libc::O_CLOEXEC)
            .open(&p);
        // If we already gave up, the receiver is gone: dropping the File here
        // closes it, so a late open never leaks an fd.
        let _ = tx.send(r);
    });
    match rx.recv_timeout(OPEN_TIMEOUT) {
        Ok(r) => r,
        Err(_) => Err(io::Error::new(io::ErrorKind::TimedOut, "smd open timed out")),
    }
}

/// Upper bound on one write. An AT command is a few bytes; a healthy channel
/// accepts it in milliseconds.
const WRITE_TIMEOUT: Duration = Duration::from_secs(5);

/// Writes all of `buf` to `fd`, waiting out EAGAIN on non-blocking test sockets.
fn write_all_fd(fd: RawFd, buf: &[u8]) -> io::Result<()> {
    let mut off = 0;
    while off < buf.len() {
        match raw_write(fd, &buf[off..]) {
            Ok(n) => off += n,
            Err(e) if would_block(&e) => {
                poll_fd(fd, libc::POLLOUT, Duration::from_millis(50))?;
            }
            Err(e) => return Err(e),
        }
    }
    Ok(())
}

fn poll_fd(fd: RawFd, events: i16, timeout: Duration) -> io::Result<bool> {
    let mut pfd = libc::pollfd { fd, events, revents: 0 };
    let ms = timeout.as_millis().min(i32::MAX as u128) as i32;
    loop {
        let r = unsafe { libc::poll(&mut pfd, 1, ms) };
        if r < 0 {
            let e = io::Error::last_os_error();
            if e.kind() == io::ErrorKind::Interrupted {
                continue;
            }
            return Err(e);
        }
        return Ok(r > 0);
    }
}

fn raw_read(fd: RawFd, buf: &mut [u8]) -> io::Result<usize> {
    let n = unsafe { libc::read(fd, buf.as_mut_ptr() as *mut libc::c_void, buf.len()) };
    if n < 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(n as usize)
    }
}

fn raw_write(fd: RawFd, buf: &[u8]) -> io::Result<usize> {
    let n = unsafe { libc::write(fd, buf.as_ptr() as *const libc::c_void, buf.len()) };
    if n < 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(n as usize)
    }
}

fn would_block(e: &io::Error) -> bool {
    matches!(e.kind(), io::ErrorKind::WouldBlock | io::ErrorKind::Interrupted)
}

fn remaining(deadline: Instant) -> Option<Duration> {
    deadline.checked_duration_since(Instant::now()).filter(|d| !d.is_zero())
}

impl<D: Device> Channel<D> {
    pub fn new(opener: Box<dyn Fn() -> io::Result<D> + Send>) -> Self {
        Channel {
            opener,
            dev: None,
            dirty: false,
            established: false,
            pending: Vec::new(),
            last_drained: Vec::new(),
        }
    }

    pub fn close(&mut self) {
        self.dev = None;
        self.established = false;
        self.pending.clear();
    }

    /// Any I/O error on the fd: drop it and make the next exchange reopen and
    /// prove the channel (AT -> OK) first. Keeping the fd would be wrong: the
    /// daemon holds one fd for its lifetime, and glink can keep failing a fd
    /// that was reset under it (SSR), which would fail every later command
    /// until restart. Only for errors from calls that have returned, so no
    /// thread can still be using the fd number (a wedged write uses forget).
    fn fail_io(&mut self, e: io::Error) -> AtError {
        self.close();
        self.dirty = true;
        AtError::Io(e)
    }

    /// EOF from the device: same recovery as an I/O error.
    fn fail_eof(&mut self) -> AtError {
        self.close();
        self.dirty = true;
        AtError::Eof
    }

    fn fd(&mut self) -> Result<RawFd, AtError> {
        if self.dev.is_none() {
            // A stalled open (SSR) is "not ready", not a command failure.
            self.dev = Some((self.opener)().map_err(|e| match e.kind() {
                io::ErrorKind::TimedOut => AtError::NotReady,
                _ => AtError::Io(e),
            })?);
        }
        Ok(self.dev.as_ref().unwrap().as_raw_fd())
    }

    /// Reads and discards whatever is already queued, until `quiet` passes
    /// with nothing new (capped at 1 s total).
    fn drain(&mut self, quiet: Duration) -> Result<Vec<u8>, AtError> {
        // Never read a fresh fd before its first write (see `established`).
        if !self.established {
            return Ok(std::mem::take(&mut self.pending));
        }
        let fd = self.fd()?;
        let cap = Instant::now() + Duration::from_secs(1);
        // Anything left past a previous terminator is stale too.
        let mut out = std::mem::take(&mut self.pending);
        let mut buf = [0u8; 4096];
        while Instant::now() < cap {
            match poll_fd(fd, libc::POLLIN, quiet) {
                Ok(false) => break,
                Ok(true) => {}
                Err(e) => return Err(self.fail_io(e)),
            }
            match raw_read(fd, &mut buf) {
                Ok(0) => return Err(self.fail_eof()),
                Ok(n) => out.extend_from_slice(&buf[..n]),
                Err(e) if would_block(&e) => break,
                Err(e) => return Err(self.fail_io(e)),
            }
        }
        Ok(out)
    }

    /// Blocking write on a helper thread, bounded by WRITE_TIMEOUT (or the
    /// command deadline if sooner).
    fn send(&mut self, bytes: &[u8], deadline: Instant) -> Result<(), AtError> {
        let fd = self.fd()?;
        let data = bytes.to_vec();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let _ = tx.send(write_all_fd(fd, &data));
        });
        let bound = remaining(deadline).unwrap_or(Duration::ZERO).min(WRITE_TIMEOUT);
        match rx.recv_timeout(bound) {
            Ok(Ok(())) => {
                self.established = true;
                Ok(())
            }
            // The write thread has returned, so closing the fd is safe.
            Ok(Err(e)) => Err(self.fail_io(e)),
            Err(_) => {
                // The write is wedged inside the driver. Abandon this fd WITHOUT
                // closing it: closing would free the fd number for reuse while
                // the stuck thread could still complete its write into whatever
                // file got that number. The next exchange opens a fresh fd.
                if let Some(d) = self.dev.take() {
                    std::mem::forget(d);
                }
                self.established = false;
                self.pending.clear();
                Err(AtError::NotReady)
            }
        }
    }

    /// Reads until a complete line that is a final result code. Returns every
    /// byte up to and including that line, exactly as atcli printed it.
    fn read_reply(&mut self, deadline: Instant) -> Result<Vec<u8>, AtError> {
        self.read_reply_from(Vec::with_capacity(512), deadline)
    }

    /// `read_reply`, continuing from bytes already read after a prompt.
    fn read_reply_from(&mut self, mut acc: Vec<u8>, deadline: Instant) -> Result<Vec<u8>, AtError> {
        let fd = self.fd()?;
        let mut line_start = 0usize;
        let mut buf = [0u8; 4096];
        loop {
            // Check every complete line received so far.
            while let Some(rel) = acc[line_start..].iter().position(|&b| b == b'\n') {
                let end = line_start + rel + 1;
                if is_terminator(&acc[line_start..end]) {
                    // Bytes after the terminator are a glued URC: keep them for
                    // the next drain rather than discarding or returning them.
                    if end < acc.len() {
                        self.pending.extend_from_slice(&acc[end..]);
                    }
                    acc.truncate(end);
                    return Ok(acc);
                }
                line_start = end;
            }
            let left = match remaining(deadline) {
                Some(d) => d,
                None => {
                    self.dirty = true;
                    return Err(AtError::Timeout);
                }
            };
            match poll_fd(fd, libc::POLLIN, left) {
                Ok(false) => continue,
                Ok(true) => {}
                Err(e) => return Err(self.fail_io(e)),
            }
            match raw_read(fd, &mut buf) {
                Ok(0) => return Err(self.fail_eof()),
                Ok(n) => acc.extend_from_slice(&buf[..n]),
                Err(e) if would_block(&e) => {}
                Err(e) => return Err(self.fail_io(e)),
            }
        }
    }

    fn try_sync(&mut self) -> Result<(), AtError> {
        self.drain(Duration::from_millis(200))?;
        let deadline = Instant::now() + Duration::from_secs(3);
        self.send(b"AT\r\n", deadline)?;
        let reply = self.read_reply(deadline)?;
        if reply.windows(4).any(|w| w == b"OK\r\n") {
            Ok(())
        } else {
            Err(AtError::NotReady)
        }
    }

    /// After a timeout the modem may still answer the old command later.
    /// Prove the channel is back in step before reusing it; reopen once if not.
    fn resync(&mut self) -> Result<(), AtError> {
        if self.try_sync().is_ok() {
            self.dirty = false;
            return Ok(());
        }
        self.close();
        match self.try_sync() {
            Ok(()) => {
                self.dirty = false;
                Ok(())
            }
            Err(_) => Err(AtError::NotReady),
        }
    }

    /// Reads until the `> ` input prompt (it ends no line, so it is matched as
    /// bytes, not as a line) or a final result code (the modem refused the
    /// command). The prompt must arrive by `deadline`.
    fn read_prompt(&mut self, deadline: Instant) -> Result<Prompt, AtError> {
        let fd = self.fd()?;
        let mut acc: Vec<u8> = Vec::with_capacity(128);
        let mut line_start = 0usize;
        let mut buf = [0u8; 1024];
        loop {
            while let Some(rel) = acc[line_start..].iter().position(|&b| b == b'\n') {
                let end = line_start + rel + 1;
                if is_terminator(&acc[line_start..end]) {
                    if end < acc.len() {
                        self.pending.extend_from_slice(&acc[end..]);
                    }
                    acc.truncate(end);
                    return Ok(Prompt::Refused(acc));
                }
                line_start = end;
            }
            if let Some(p) = acc.windows(2).position(|w| w == b"> ") {
                // Anything after the prompt (a URC) belongs to what follows.
                return Ok(Prompt::Ready(acc.split_off(p + 2)));
            }
            let left = match remaining(deadline) {
                Some(d) => d,
                None => return Err(AtError::Timeout),
            };
            match poll_fd(fd, libc::POLLIN, left) {
                Ok(false) => continue,
                Ok(true) => {}
                Err(e) => return Err(self.fail_io(e)),
            }
            match raw_read(fd, &mut buf) {
                Ok(0) => return Err(self.fail_eof()),
                Ok(n) => acc.extend_from_slice(&buf[..n]),
                Err(e) if would_block(&e) => {}
                Err(e) => return Err(self.fail_io(e)),
            }
        }
    }

    /// A two-stage exchange (AT+CMGS in PDU mode): write `cmd`, wait for the
    /// `> ` prompt by `prompt_deadline`, then write `payload` + Ctrl-Z and read
    /// to the final result code (so the OK after +CMGS: is consumed). A refusal
    /// before the prompt (ERROR, +CMS ERROR) is returned as the reply. With no
    /// prompt the modem may still be waiting for input, so ESC cancels it and
    /// the channel is resynced before its next use. Nothing follows Ctrl-Z: a
    /// trailing CRLF would only be read as an empty command line.
    pub fn exchange_prompt(
        &mut self,
        cmd: &str,
        payload: &[u8],
        prompt_deadline: Instant,
        deadline: Instant,
    ) -> Result<Vec<u8>, AtError> {
        if self.dirty {
            self.resync()?;
        }
        self.last_drained = self.drain(Duration::ZERO)?;
        let mut line = Vec::with_capacity(cmd.len() + 2);
        line.extend_from_slice(cmd.as_bytes());
        line.extend_from_slice(b"\r\n");
        self.send(&line, deadline)?;
        let rest = match self.read_prompt(prompt_deadline.min(deadline)) {
            Ok(Prompt::Ready(rest)) => rest,
            Ok(Prompt::Refused(reply)) => return Ok(reply),
            Err(AtError::Timeout) => {
                let _ = self.send(&[0x1B], Instant::now() + Duration::from_secs(2));
                self.dirty = true;
                return Err(AtError::Timeout);
            }
            Err(e) => return Err(e),
        };
        let mut body = Vec::with_capacity(payload.len() + 1);
        body.extend_from_slice(payload);
        body.push(0x1A);
        self.send(&body, deadline)?;
        self.read_reply_from(rest, deadline)
    }

    /// One AT exchange. The caller holds the modem lock.
    pub fn exchange(&mut self, cmd: &str, deadline: Instant) -> Result<Vec<u8>, AtError> {
        if self.dirty {
            self.resync()?;
        }
        // Zero-wait: stale bytes are already queued in the kernel when we look.
        // Waiting a "quiet" window here cost ~20 ms on every daemon command.
        self.last_drained = self.drain(Duration::ZERO)?;
        let mut line = Vec::with_capacity(cmd.len() + 2);
        line.extend_from_slice(cmd.as_bytes());
        line.extend_from_slice(b"\r\n");
        self.send(&line, deadline)?;
        self.read_reply(deadline)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::os::unix::net::UnixStream;
    use std::sync::{Arc, Mutex};
    use std::thread;

    /// A fake modem on the far end of a socketpair. `script` maps each received
    /// command line to the bytes to answer (None = never answer).
    fn fake_modem(
        script: impl Fn(&str) -> Option<Vec<u8>> + Send + 'static,
    ) -> (Channel<UnixStream>, Arc<Mutex<Vec<String>>>) {
        let (near, mut far) = UnixStream::pair().unwrap();
        near.set_nonblocking(true).unwrap();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let seen2 = seen.clone();
        thread::spawn(move || {
            let mut buf = [0u8; 1024];
            let mut acc = Vec::new();
            loop {
                let n = match far.read(&mut buf) {
                    Ok(0) | Err(_) => return,
                    Ok(n) => n,
                };
                acc.extend_from_slice(&buf[..n]);
                while let Some(p) = acc.windows(2).position(|w| w == b"\r\n") {
                    let cmd = String::from_utf8_lossy(&acc[..p]).to_string();
                    acc.drain(..p + 2);
                    seen2.lock().unwrap().push(cmd.clone());
                    if let Some(r) = script(&cmd) {
                        let _ = far.write_all(&r);
                    }
                }
            }
        });
        let slot = Mutex::new(Some(near));
        let ch = Channel::new(Box::new(move || {
            slot.lock().unwrap().take().ok_or_else(|| io::Error::other("reopen not supported"))
        }));
        (ch, seen)
    }

    fn soon(ms: u64) -> Instant {
        Instant::now() + Duration::from_millis(ms)
    }

    #[test]
    fn returns_echo_body_and_terminator_like_atcli() {
        let (mut ch, _) = fake_modem(|c| Some(format!("{c}\r\r\n+CSQ: 24,99\r\n\r\nOK\r\n").into_bytes()));
        let r = ch.exchange("AT+CSQ", soon(500)).unwrap();
        assert_eq!(r, b"AT+CSQ\r\r\n+CSQ: 24,99\r\n\r\nOK\r\n");
    }

    #[test]
    fn at_error_is_a_normal_reply_not_a_failure() {
        let (mut ch, _) = fake_modem(|c| Some(format!("{c}\r\r\nERROR\r\n").into_bytes()));
        assert_eq!(ch.exchange("AT+FOOBAR", soon(500)).unwrap(), b"AT+FOOBAR\r\r\nERROR\r\n");
    }

    #[test]
    fn cme_error_terminates() {
        let (mut ch, _) = fake_modem(|c| Some(format!("{c}\r\r\n+CME ERROR: 10\r\n").into_bytes()));
        assert!(ch.exchange("AT+CPIN?", soon(500)).unwrap().ends_with(b"+CME ERROR: 10\r\n"));
    }

    #[test]
    fn ok_inside_a_line_is_not_a_terminator() {
        let (mut ch, _) = fake_modem(|c| Some(format!("{c}\r\r\n+X: \"OK\r\n\"\r\nOK\r\n").into_bytes()));
        let r = ch.exchange("AT+X", soon(500)).unwrap();
        assert!(r.ends_with(b"\r\nOK\r\n"));
    }

    #[test]
    fn deadline_ends_a_silent_command_and_resync_recovers() {
        // First command never answers; the late reply arrives with the resync.
        let (mut ch, seen) = fake_modem(|c| match c {
            "AT+HANG" => None,
            "AT" => Some(b"AT+HANG\r\r\nLATE\r\nOK\r\nAT\r\r\nOK\r\n".to_vec()),
            c => Some(format!("{c}\r\r\nOK\r\n").into_bytes()),
        });
        let t = Instant::now();
        assert!(matches!(ch.exchange("AT+HANG", soon(150)), Err(AtError::Timeout)));
        assert!(t.elapsed() < Duration::from_millis(600));
        // The next caller gets only its own reply, never the late one.
        let r = ch.exchange("AT+NEXT", soon(1000)).unwrap();
        assert_eq!(r, b"AT+NEXT\r\r\nOK\r\n");
        assert!(seen.lock().unwrap().iter().any(|c| c == "AT"), "resync sent AT");
    }

    #[test]
    fn stale_bytes_are_drained_before_send() {
        let (mut ch, _) = fake_modem(|c| match c {
            "AT+ONE" => Some(b"AT+ONE\r\r\nOK\r\n+QIND: \"urc\"\r\n".to_vec()),
            c => Some(format!("{c}\r\r\nOK\r\n").into_bytes()),
        });
        ch.exchange("AT+ONE", soon(500)).unwrap();
        thread::sleep(Duration::from_millis(30));
        let r = ch.exchange("AT+TWO", soon(500)).unwrap();
        assert_eq!(r, b"AT+TWO\r\r\nOK\r\n");
        assert!(String::from_utf8_lossy(&ch.last_drained).contains("+QIND"));
    }

    #[test]
    fn split_reads_reassemble_lines() {
        let (near, mut far) = UnixStream::pair().unwrap();
        near.set_nonblocking(true).unwrap();
        thread::spawn(move || {
            let mut b = [0u8; 64];
            let _ = far.read(&mut b);
            for chunk in [&b"AT\r"[..], b"\r\nO", b"K", b"\r\n"] {
                far.write_all(chunk).unwrap();
                thread::sleep(Duration::from_millis(15));
            }
            thread::sleep(Duration::from_millis(500));
        });
        let slot = Mutex::new(Some(near));
        let mut ch: Channel<UnixStream> =
            Channel::new(Box::new(move || slot.lock().unwrap().take().ok_or_else(|| io::Error::other("x"))));
        assert_eq!(ch.exchange("AT", soon(1000)).unwrap(), b"AT\r\r\nOK\r\n");
    }

    /// A fake modem that answers every line with `<cmd>\r\r\nOK\r\n`.
    fn healthy_dev() -> UnixStream {
        let (near, mut far) = UnixStream::pair().unwrap();
        near.set_nonblocking(true).unwrap();
        thread::spawn(move || {
            let mut buf = [0u8; 256];
            let mut acc = Vec::new();
            loop {
                let n = match far.read(&mut buf) {
                    Ok(0) | Err(_) => return,
                    Ok(n) => n,
                };
                acc.extend_from_slice(&buf[..n]);
                while let Some(p) = acc.windows(2).position(|w| w == b"\r\n") {
                    let c = String::from_utf8_lossy(&acc[..p]).to_string();
                    acc.drain(..p + 2);
                    let _ = far.write_all(format!("{c}\r\r\nOK\r\n").as_bytes());
                }
            }
        });
        near
    }

    /// Channel whose first open yields `broken`, every later open a healthy fake.
    fn first_open_broken(broken: UnixStream) -> Channel<UnixStream> {
        let first = Mutex::new(Some(broken));
        Channel::new(Box::new(move || Ok(first.lock().unwrap().take().unwrap_or_else(healthy_dev))))
    }

    #[test]
    fn reset_fd_is_dropped_and_the_next_call_reopens() {
        // glink reset under an open fd (SSR): the peer goes away with our
        // command unread, so the read fails with ECONNRESET.
        let (near, far) = UnixStream::pair().unwrap();
        near.set_nonblocking(true).unwrap();
        thread::spawn(move || {
            let mut p = libc::pollfd { fd: far.as_raw_fd(), events: libc::POLLIN, revents: 0 };
            unsafe { libc::poll(&mut p, 1, 2000) };
            drop(far);
        });
        let mut ch = first_open_broken(near);
        match ch.exchange("AT+CSQ", soon(800)) {
            Err(AtError::Io(e)) => assert!(is_reset(&e), "{e:?}"),
            other => panic!("expected a reset error, got {:?}", other.map(|_| ())),
        }
        assert_eq!(ch.exchange("AT+CSQ", soon(800)).unwrap(), b"AT+CSQ\r\r\nOK\r\n");
    }

    #[test]
    fn fd_that_keeps_failing_is_not_reused() {
        // A fd that errors on every write (EPIPE) must not be kept: before
        // the fix the daemon failed every later command on it until restart.
        let (near, far) = UnixStream::pair().unwrap();
        near.set_nonblocking(true).unwrap();
        drop(far);
        let mut ch = first_open_broken(near);
        assert!(ch.exchange("AT+CSQ", soon(500)).is_err());
        for _ in 0..3 {
            assert_eq!(ch.exchange("AT+CSQ", soon(800)).unwrap(), b"AT+CSQ\r\r\nOK\r\n");
        }
    }

    /// A fake modem for AT+CMGS: answers `AT+CMGS=` with `prompt` (None = no
    /// prompt), records the payload up to Ctrl-Z and answers it with `result`.
    /// Every other line gets OK. Records "ESC" when it sees 0x1B.
    fn cmgs_modem(prompt: Option<&'static [u8]>, result: &'static [u8]) -> (Channel<UnixStream>, Arc<Mutex<Vec<String>>>) {
        let (near, mut far) = UnixStream::pair().unwrap();
        near.set_nonblocking(true).unwrap();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let seen2 = seen.clone();
        thread::spawn(move || {
            let mut buf = [0u8; 1024];
            let mut acc: Vec<u8> = Vec::new();
            let mut in_pdu = false;
            loop {
                let n = match far.read(&mut buf) {
                    Ok(0) | Err(_) => return,
                    Ok(n) => n,
                };
                acc.extend_from_slice(&buf[..n]);
                loop {
                    if let Some(p) = acc.iter().position(|&b| b == 0x1B) {
                        acc.drain(..=p);
                        in_pdu = false;
                        seen2.lock().unwrap().push("ESC".into());
                        continue;
                    }
                    if in_pdu {
                        let Some(p) = acc.iter().position(|&b| b == 0x1A) else { break };
                        let pdu = String::from_utf8_lossy(&acc[..p]).to_string();
                        acc.drain(..=p);
                        in_pdu = false;
                        seen2.lock().unwrap().push(format!("PDU {pdu}"));
                        let _ = far.write_all(result);
                        continue;
                    }
                    let Some(p) = acc.windows(2).position(|w| w == b"\r\n") else { break };
                    let cmd = String::from_utf8_lossy(&acc[..p]).to_string();
                    acc.drain(..p + 2);
                    seen2.lock().unwrap().push(cmd.clone());
                    if cmd.starts_with("AT+CMGS=") {
                        let _ = far.write_all(format!("{cmd}\r\r\n").as_bytes());
                        if let Some(pr) = prompt {
                            let _ = far.write_all(pr);
                            in_pdu = pr.ends_with(b"> ");
                        }
                    } else {
                        let _ = far.write_all(format!("{cmd}\r\r\nOK\r\n").as_bytes());
                    }
                }
            }
        });
        let slot = Mutex::new(Some(near));
        let ch = Channel::new(Box::new(move || slot.lock().unwrap().take().ok_or_else(|| io::Error::other("x"))));
        (ch, seen)
    }

    #[test]
    fn cmgs_waits_for_prompt_then_sends_pdu_and_ctrl_z() {
        let (mut ch, seen) = cmgs_modem(Some(b"> "), b"\r\n+CMGS: 17\r\n\r\nOK\r\n");
        let r = ch.exchange_prompt("AT+CMGS=13", b"00110005812143F50000B002C834", soon(500), soon(1000)).unwrap();
        let r = String::from_utf8_lossy(&r).to_string();
        assert!(r.contains("+CMGS: 17") && r.ends_with("OK\r\n"), "{r:?}");
        assert_eq!(seen.lock().unwrap()[1], "PDU 00110005812143F50000B002C834");
        // The trailing OK was consumed: the next caller gets only its own reply.
        assert_eq!(ch.exchange("AT+NEXT", soon(500)).unwrap(), b"AT+NEXT\r\r\nOK\r\n");
        assert!(ch.last_drained.is_empty(), "{:?}", ch.last_drained);
    }

    #[test]
    fn cms_error_after_pdu_is_the_reply() {
        let (mut ch, _) = cmgs_modem(Some(b"> "), b"\r\n+CMS ERROR: 500\r\n");
        let r = ch.exchange_prompt("AT+CMGS=13", b"00", soon(500), soon(1000)).unwrap();
        assert!(r.ends_with(b"+CMS ERROR: 500\r\n"));
    }

    #[test]
    fn refusal_before_the_prompt_is_returned_without_sending_the_pdu() {
        let (mut ch, seen) = cmgs_modem(Some(b"+CMS ERROR: 302\r\n"), b"");
        let r = ch.exchange_prompt("AT+CMGS=13", b"00", soon(500), soon(1000)).unwrap();
        assert!(r.ends_with(b"+CMS ERROR: 302\r\n"));
        assert!(!seen.lock().unwrap().iter().any(|c| c.starts_with("PDU")));
    }

    #[test]
    fn missing_prompt_cancels_with_esc_and_resyncs() {
        let (mut ch, seen) = cmgs_modem(None, b"");
        let t = Instant::now();
        assert!(matches!(ch.exchange_prompt("AT+CMGS=13", b"00", soon(200), soon(5000)), Err(AtError::Timeout)));
        assert!(t.elapsed() < Duration::from_millis(1500));
        assert_eq!(ch.exchange("AT+NEXT", soon(1000)).unwrap(), b"AT+NEXT\r\r\nOK\r\n");
        let s = seen.lock().unwrap().clone();
        let esc = s.iter().position(|c| c == "ESC").expect("ESC sent");
        let at = s.iter().position(|c| c == "AT").expect("resync AT");
        assert!(esc < at, "{s:?}");
    }

    #[test]
    fn reset_errnos_are_classified() {
        for code in [libc::ECONNRESET, libc::EBUSY, libc::EPIPE, libc::ENETRESET] {
            assert!(is_reset(&io::Error::from_raw_os_error(code)));
        }
        assert!(!is_reset(&io::Error::from_raw_os_error(libc::EINVAL)));
    }

    #[test]
    fn eof_is_reported() {
        let (near, far) = UnixStream::pair().unwrap();
        near.set_nonblocking(true).unwrap();
        drop(far);
        let slot = Mutex::new(Some(near));
        let mut ch: Channel<UnixStream> =
            Channel::new(Box::new(move || slot.lock().unwrap().take().ok_or_else(|| io::Error::other("x"))));
        assert!(matches!(ch.exchange("AT", soon(300)), Err(AtError::Eof) | Err(AtError::Io(_))));
    }
}
