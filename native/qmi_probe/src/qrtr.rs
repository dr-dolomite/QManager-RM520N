//! Minimal QMI-over-QRTR client: raw AF_QIPCRTR datagrams, no libqmi.
//!
//! Each `Client` is one socket, so one QMI control point. Over QRTR there is
//! no QMUX header and no CTL client-ID allocation: the socket's own port is
//! the client identity, and closing it releases every per-client setting
//! (indication registrations included).

use std::io;
use std::mem;
use std::time::{Duration, Instant};

pub const AF_QIPCRTR: libc::c_int = 42;
const QRTR_PORT_CTL: u32 = 0xffff_fffe;
const QRTR_TYPE_NEW_SERVER: u32 = 4;
const QRTR_TYPE_NEW_LOOKUP: u32 = 10;

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct SockaddrQrtr {
    family: u16,
    node: u32,
    port: u32,
}

#[derive(Clone, Debug)]
pub struct Tlv {
    pub t: u8,
    pub v: Vec<u8>,
}

pub struct Msg {
    pub kind: u8, // 0 req, 2 resp, 4 ind
    pub txn: u16,
    pub id: u16,
    pub tlvs: Vec<Tlv>,
}

impl Msg {
    pub fn tlv(&self, t: u8) -> Option<&[u8]> {
        self.tlvs.iter().find(|x| x.t == t).map(|x| x.v.as_slice())
    }

    /// QMI result TLV 0x02: Ok(()) or Err(error code).
    pub fn result(&self) -> Result<(), u16> {
        match self.tlv(0x02) {
            Some(v) if v.len() >= 4 => {
                let st = u16::from_le_bytes([v[0], v[1]]);
                let ec = u16::from_le_bytes([v[2], v[3]]);
                if st == 0 { Ok(()) } else { Err(ec) }
            }
            _ => Err(0xffff),
        }
    }
}

pub struct Client {
    fd: libc::c_int,
    node: u32,
    port: u32,
    txn: u16,
    buf: Vec<u8>,
}

impl Drop for Client {
    fn drop(&mut self) {
        unsafe { libc::close(self.fd) };
    }
}

fn open_socket(timeout: Duration) -> io::Result<libc::c_int> {
    let fd = unsafe { libc::socket(AF_QIPCRTR, libc::SOCK_DGRAM | libc::SOCK_CLOEXEC, 0) };
    if fd < 0 {
        return Err(io::Error::last_os_error());
    }
    set_timeout(fd, timeout);
    Ok(fd)
}

fn set_timeout(fd: libc::c_int, d: Duration) {
    let tv = libc::timeval {
        tv_sec: d.as_secs() as libc::time_t,
        tv_usec: d.subsec_micros() as libc::suseconds_t,
    };
    unsafe {
        libc::setsockopt(
            fd,
            libc::SOL_SOCKET,
            libc::SO_RCVTIMEO,
            &tv as *const _ as *const libc::c_void,
            mem::size_of::<libc::timeval>() as libc::socklen_t,
        );
    }
}

fn sendto(fd: libc::c_int, b: &[u8], node: u32, port: u32) -> io::Result<()> {
    let sa = SockaddrQrtr { family: AF_QIPCRTR as u16, node, port };
    let r = unsafe {
        libc::sendto(
            fd,
            b.as_ptr() as *const libc::c_void,
            b.len(),
            0,
            &sa as *const _ as *const libc::sockaddr,
            mem::size_of::<SockaddrQrtr>() as libc::socklen_t,
        )
    };
    if r < 0 { Err(io::Error::last_os_error()) } else { Ok(()) }
}

fn recvfrom(fd: libc::c_int, b: &mut [u8]) -> io::Result<(usize, SockaddrQrtr)> {
    let mut sa = SockaddrQrtr::default();
    let mut sl = mem::size_of::<SockaddrQrtr>() as libc::socklen_t;
    let n = unsafe {
        libc::recvfrom(
            fd,
            b.as_mut_ptr() as *mut libc::c_void,
            b.len(),
            0,
            &mut sa as *mut _ as *mut libc::sockaddr,
            &mut sl,
        )
    };
    if n < 0 { Err(io::Error::last_os_error()) } else { Ok((n as usize, sa)) }
}

fn local_node(fd: libc::c_int) -> u32 {
    let mut sa = SockaddrQrtr::default();
    let mut sl = mem::size_of::<SockaddrQrtr>() as libc::socklen_t;
    unsafe { libc::getsockname(fd, &mut sa as *mut _ as *mut libc::sockaddr, &mut sl) };
    sa.node
}

fn le32(b: &[u8], o: usize) -> u32 {
    u32::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]])
}

/// Ask the QRTR name service where `svc` lives. Returns (node, port).
pub fn lookup(svc: u32, timeout: Duration) -> io::Result<Option<(u32, u32)>> {
    let fd = open_socket(timeout)?;
    let mut pkt = [0u8; 20];
    pkt[0..4].copy_from_slice(&QRTR_TYPE_NEW_LOOKUP.to_le_bytes());
    pkt[4..8].copy_from_slice(&svc.to_le_bytes());
    let res = (|| {
        sendto(fd, &pkt, local_node(fd), QRTR_PORT_CTL)?;
        let mut buf = [0u8; 256];
        let mut found = None;
        loop {
            let (n, _) = match recvfrom(fd, &mut buf) {
                Ok(x) => x,
                Err(_) => break,
            };
            if n < 20 || le32(&buf, 0) != QRTR_TYPE_NEW_SERVER {
                continue;
            }
            let s = le32(&buf, 4);
            if s == 0 {
                break; // end of lookup
            }
            if s == svc && found.is_none() {
                found = Some((le32(&buf, 12), le32(&buf, 16)));
            }
        }
        Ok(found)
    })();
    unsafe { libc::close(fd) };
    res
}

pub fn parse(b: &[u8]) -> Option<Msg> {
    if b.len() < 7 {
        return None;
    }
    let len = u16::from_le_bytes([b[5], b[6]]) as usize;
    let mut p = b.get(7..7 + len)?;
    let mut tlvs = Vec::new();
    while p.len() >= 3 {
        let tl = u16::from_le_bytes([p[1], p[2]]) as usize;
        if 3 + tl > p.len() {
            break;
        }
        tlvs.push(Tlv { t: p[0], v: p[3..3 + tl].to_vec() });
        p = &p[3 + tl..];
    }
    Some(Msg {
        kind: b[0],
        txn: u16::from_le_bytes([b[1], b[2]]),
        id: u16::from_le_bytes([b[3], b[4]]),
        tlvs,
    })
}

impl Client {
    pub fn connect(node: u32, port: u32, timeout: Duration) -> io::Result<Client> {
        Ok(Client { fd: open_socket(timeout)?, node, port, txn: 1, buf: vec![0u8; 65536] })
    }

    pub fn set_timeout(&self, d: Duration) {
        set_timeout(self.fd, d);
    }

    /// Send one request, wait for its matching response. Indications that
    /// arrive meanwhile are passed to `on_ind` rather than dropped.
    pub fn request_with(
        &mut self,
        id: u16,
        tlvs: &[Tlv],
        on_ind: &mut dyn FnMut(Msg),
    ) -> io::Result<(Msg, Duration)> {
        let mut body = Vec::new();
        for t in tlvs {
            body.push(t.t);
            body.extend_from_slice(&(t.v.len() as u16).to_le_bytes());
            body.extend_from_slice(&t.v);
        }
        let my = self.txn;
        self.txn = self.txn.wrapping_add(1).max(1);
        let mut pkt = Vec::with_capacity(7 + body.len());
        pkt.push(0x00);
        pkt.extend_from_slice(&my.to_le_bytes());
        pkt.extend_from_slice(&id.to_le_bytes());
        pkt.extend_from_slice(&(body.len() as u16).to_le_bytes());
        pkt.extend_from_slice(&body);
        let t0 = Instant::now();
        sendto(self.fd, &pkt, self.node, self.port)?;
        loop {
            let (n, sa) = recvfrom(self.fd, &mut self.buf)?;
            if sa.port != self.port {
                continue;
            }
            let m = match parse(&self.buf[..n]) {
                Some(m) => m,
                None => continue,
            };
            if m.kind == 0x04 {
                on_ind(m);
                continue;
            }
            if m.kind == 0x02 && m.txn == my && m.id == id {
                return Ok((m, t0.elapsed()));
            }
        }
    }

    pub fn request(&mut self, id: u16, tlvs: &[Tlv]) -> io::Result<(Msg, Duration)> {
        self.request_with(id, tlvs, &mut |_| {})
    }

    /// Block for the next indication from this service (respecting timeout).
    pub fn next_indication(&mut self) -> io::Result<Msg> {
        loop {
            let (n, sa) = recvfrom(self.fd, &mut self.buf)?;
            if sa.port != self.port {
                continue;
            }
            if let Some(m) = parse(&self.buf[..n]) {
                if m.kind == 0x04 {
                    return Ok(m);
                }
            }
        }
    }
}
