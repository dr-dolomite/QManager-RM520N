//! The QRTR transport seam and the name-server protocol.
//!
//! `Datagram` is one socket; `Transport` opens them. The real implementation
//! is a raw AF_QIPCRTR datagram socket (ported from qmi_probe/src/qrtr.rs);
//! tests use a fake (`super::fake`). Over QRTR a socket's own port is the QMI
//! client identity: closing it releases every per-client setting.

use std::io;
use std::mem;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

pub const AF_QIPCRTR: libc::c_int = 42;
/// The name server listens on this port of the local node.
pub const QRTR_PORT_CTL: u32 = 0xffff_fffe;
pub const QRTR_TYPE_NEW_SERVER: u32 = 4;
pub const QRTR_TYPE_DEL_SERVER: u32 = 5;
pub const QRTR_TYPE_NEW_LOOKUP: u32 = 10;
pub const CTRL_PKT_LEN: usize = 20;

/// One datagram socket. All methods take `&self` so a demux thread can block
/// in `recv` while request threads `send_to` on the same socket.
pub trait Datagram: Send + Sync {
    fn send_to(&self, node: u32, port: u32, buf: &[u8]) -> io::Result<()>;
    /// Ok((len, src_node, src_port)). Err of kind TimedOut when nothing
    /// arrived within `timeout`; any other error is the socket's (a reset).
    fn recv(&self, buf: &mut [u8], timeout: Duration) -> io::Result<(usize, u32, u32)>;
    /// This socket's QRTR node (the name server lives on it).
    fn local_node(&self) -> u32;
    /// Wakes and fails any further I/O. The fd itself closes on drop.
    fn shutdown(&self);
}

pub trait Transport: Send + Sync {
    fn open(&self) -> io::Result<Box<dyn Datagram>>;
}

pub fn timed_out() -> io::Error {
    io::Error::new(io::ErrorKind::TimedOut, "timed out")
}

pub fn is_timeout(e: &io::Error) -> bool {
    matches!(e.kind(), io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock)
}

/// A name-server control packet: `cmd:u32 service:u32 instance:u32 node:u32 port:u32`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Ctrl {
    NewServer { svc: u32, node: u32, port: u32 },
    /// The all-zero NEW_SERVER that ends one lookup's initial listing.
    EndOfList,
    DelServer { svc: u32, node: u32, port: u32 },
    Other,
}

fn le32(b: &[u8], o: usize) -> u32 {
    u32::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]])
}

pub fn encode_ctrl(cmd: u32, svc: u32, instance: u32, node: u32, port: u32) -> [u8; CTRL_PKT_LEN] {
    let mut p = [0u8; CTRL_PKT_LEN];
    for (i, v) in [cmd, svc, instance, node, port].iter().enumerate() {
        p[i * 4..i * 4 + 4].copy_from_slice(&v.to_le_bytes());
    }
    p
}

/// A lookup for every instance of `svc`; the name server keeps it as a
/// subscription, so later NEW_SERVER / DEL_SERVER for `svc` arrive on the
/// same socket.
pub fn encode_lookup(svc: u32) -> [u8; CTRL_PKT_LEN] {
    encode_ctrl(QRTR_TYPE_NEW_LOOKUP, svc, 0, 0, 0)
}

pub fn parse_ctrl(b: &[u8]) -> Option<Ctrl> {
    if b.len() < CTRL_PKT_LEN {
        return None;
    }
    let (svc, node, port) = (le32(b, 4), le32(b, 12), le32(b, 16));
    Some(match le32(b, 0) {
        QRTR_TYPE_NEW_SERVER if svc == 0 => Ctrl::EndOfList,
        QRTR_TYPE_NEW_SERVER => Ctrl::NewServer { svc, node, port },
        QRTR_TYPE_DEL_SERVER => Ctrl::DelServer { svc, node, port },
        _ => Ctrl::Other,
    })
}

/// Opens a socket subscribed to the name server for each of `svcs`.
pub fn watch(t: &dyn Transport, svcs: &[u32]) -> io::Result<Box<dyn Datagram>> {
    let s = t.open()?;
    let node = s.local_node();
    for &svc in svcs {
        s.send_to(node, QRTR_PORT_CTL, &encode_lookup(svc))?;
    }
    Ok(s)
}

/// One-shot lookup: where does `svc` live? The probe's `qrtr::lookup`, over
/// the seam. Ok(None) when the listing ends (or `timeout` passes) without it.
pub fn lookup(t: &dyn Transport, svc: u32, timeout: Duration) -> io::Result<Option<(u32, u32)>> {
    let s = watch(t, &[svc])?;
    let end = Instant::now() + timeout;
    let mut buf = [0u8; 256];
    loop {
        let left = end.saturating_duration_since(Instant::now());
        if left.is_zero() {
            return Ok(None);
        }
        match s.recv(&mut buf, left) {
            Ok((n, _, _)) => match parse_ctrl(&buf[..n]) {
                Some(Ctrl::NewServer { svc: s2, node, port }) if s2 == svc => return Ok(Some((node, port))),
                Some(Ctrl::EndOfList) => return Ok(None),
                _ => {}
            },
            Err(e) if is_timeout(&e) => return Ok(None),
            Err(e) => return Err(e),
        }
    }
}

// ---- the real AF_QIPCRTR socket ----

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct SockaddrQrtr {
    family: u16,
    node: u32,
    port: u32,
}

/// Send timeout: QRTR flow control can block a send to a remote that stops
/// confirming; never longer than the request timeout.
const SEND_TIMEOUT: Duration = Duration::from_secs(1);

pub struct QrtrSocket {
    fd: libc::c_int,
    shut: AtomicBool,
}

pub struct QrtrTransport;

impl Transport for QrtrTransport {
    fn open(&self) -> io::Result<Box<dyn Datagram>> {
        Ok(Box::new(QrtrSocket::open()?))
    }
}

impl QrtrSocket {
    pub fn open() -> io::Result<QrtrSocket> {
        let fd = unsafe { libc::socket(AF_QIPCRTR, libc::SOCK_DGRAM | libc::SOCK_CLOEXEC, 0) };
        if fd < 0 {
            return Err(io::Error::last_os_error());
        }
        // Field-by-field with `as _`: the musl time_t alias is deprecated.
        let mut tv: libc::timeval = unsafe { mem::zeroed() };
        tv.tv_sec = SEND_TIMEOUT.as_secs() as _;
        tv.tv_usec = SEND_TIMEOUT.subsec_micros() as _;
        unsafe {
            libc::setsockopt(
                fd,
                libc::SOL_SOCKET,
                libc::SO_SNDTIMEO,
                &tv as *const _ as *const libc::c_void,
                mem::size_of::<libc::timeval>() as libc::socklen_t,
            );
        }
        Ok(QrtrSocket { fd, shut: AtomicBool::new(false) })
    }

    fn check_open(&self) -> io::Result<()> {
        if self.shut.load(Ordering::Acquire) {
            Err(io::Error::new(io::ErrorKind::NotConnected, "socket shut down"))
        } else {
            Ok(())
        }
    }
}

impl Drop for QrtrSocket {
    fn drop(&mut self) {
        unsafe { libc::close(self.fd) };
    }
}

fn poll_ms(d: Duration) -> libc::c_int {
    let ms = d.as_millis();
    if ms == 0 && !d.is_zero() {
        1
    } else {
        ms.min(i32::MAX as u128) as libc::c_int
    }
}

impl Datagram for QrtrSocket {
    fn send_to(&self, node: u32, port: u32, b: &[u8]) -> io::Result<()> {
        self.check_open()?;
        let sa = SockaddrQrtr { family: AF_QIPCRTR as u16, node, port };
        let r = unsafe {
            libc::sendto(
                self.fd,
                b.as_ptr() as *const libc::c_void,
                b.len(),
                0,
                &sa as *const _ as *const libc::sockaddr,
                mem::size_of::<SockaddrQrtr>() as libc::socklen_t,
            )
        };
        if r < 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
        }
    }

    fn recv(&self, b: &mut [u8], timeout: Duration) -> io::Result<(usize, u32, u32)> {
        self.check_open()?;
        // poll, then a non-blocking read: a per-call timeout without
        // SO_RCVTIMEO, so concurrent callers can't disturb each other.
        let mut pfd = libc::pollfd { fd: self.fd, events: libc::POLLIN, revents: 0 };
        let r = unsafe { libc::poll(&mut pfd, 1, poll_ms(timeout)) };
        if r == 0 {
            return Err(timed_out());
        }
        if r < 0 {
            let e = io::Error::last_os_error();
            return if e.raw_os_error() == Some(libc::EINTR) { Err(timed_out()) } else { Err(e) };
        }
        self.check_open()?;
        let mut sa = SockaddrQrtr::default();
        let mut sl = mem::size_of::<SockaddrQrtr>() as libc::socklen_t;
        let n = unsafe {
            libc::recvfrom(
                self.fd,
                b.as_mut_ptr() as *mut libc::c_void,
                b.len(),
                libc::MSG_DONTWAIT,
                &mut sa as *mut _ as *mut libc::sockaddr,
                &mut sl,
            )
        };
        if n < 0 {
            let e = io::Error::last_os_error();
            return match e.raw_os_error() {
                Some(libc::EAGAIN) | Some(libc::EINTR) => Err(timed_out()),
                _ => Err(e),
            };
        }
        Ok((n as usize, sa.node, sa.port))
    }

    fn local_node(&self) -> u32 {
        let mut sa = SockaddrQrtr::default();
        let mut sl = mem::size_of::<SockaddrQrtr>() as libc::socklen_t;
        unsafe { libc::getsockname(self.fd, &mut sa as *mut _ as *mut libc::sockaddr, &mut sl) };
        sa.node
    }

    fn shutdown(&self) {
        self.shut.store(true, Ordering::Release);
        // Best effort: QRTR may not implement shutdown; the flag plus the
        // bounded poll in `recv` are what end a reader.
        unsafe { libc::shutdown(self.fd, libc::SHUT_RDWR) };
    }
}

#[cfg(test)]
mod tests {
    use super::super::fake::FakeNet;
    use super::*;

    #[test]
    fn ctrl_packets_round_trip() {
        let p = encode_ctrl(QRTR_TYPE_NEW_SERVER, 3, 1, 0, 0x2a);
        assert_eq!(parse_ctrl(&p), Some(Ctrl::NewServer { svc: 3, node: 0, port: 0x2a }));
        assert_eq!(parse_ctrl(&encode_ctrl(QRTR_TYPE_NEW_SERVER, 0, 0, 0, 0)), Some(Ctrl::EndOfList));
        assert_eq!(
            parse_ctrl(&encode_ctrl(QRTR_TYPE_DEL_SERVER, 42, 0, 0, 7)),
            Some(Ctrl::DelServer { svc: 42, node: 0, port: 7 })
        );
        assert_eq!(parse_ctrl(&encode_ctrl(2, 0, 0, 0, 0)), Some(Ctrl::Other));
        assert_eq!(parse_ctrl(&p[..19]), None);
        let l = encode_lookup(11);
        assert_eq!(&l[..8], &[10, 0, 0, 0, 11, 0, 0, 0]);
    }

    #[test]
    fn lookup_finds_a_listed_service_and_misses_an_absent_one() {
        let net = FakeNet::new();
        net.add_server(3, 0, 0x40);
        let t = net.transport();
        assert_eq!(lookup(&t, 3, Duration::from_millis(200)).unwrap(), Some((0, 0x40)));
        assert_eq!(lookup(&t, 42, Duration::from_millis(200)).unwrap(), None);
        // The one-shot socket is closed again.
        assert_eq!(net.open_sockets(), 0);
    }

    #[test]
    fn the_real_transport_degrades_cleanly_on_a_host_without_a_modem() {
        // Build hosts have no QRTR (EAFNOSUPPORT) or no QMI services: the
        // registry must come up, refuse nothing it shouldn't, and stop.
        let t0 = Instant::now();
        let reg = super::super::registry::Registry::start_qrtr();
        let r = reg.request(super::super::SVC_NAS, 0x0024, &[]);
        if QrtrSocket::open().is_err() {
            assert_eq!(r.unwrap_err(), super::super::error::QmiError::Unavailable);
        }
        reg.shutdown();
        assert!(t0.elapsed() < Duration::from_secs(3));
    }
}
