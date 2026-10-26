//! An in-memory QRTR for tests: a tiny name server (lookups, subscriptions,
//! NEW/DEL_SERVER), service endpoints that record requests, optional auto
//! replies, injected resets, and an open-socket count for leak checks.

use super::msg::{self, Msg};
use super::transport::{
    encode_ctrl, parse_ctrl, timed_out, Datagram, Transport, QRTR_PORT_CTL, QRTR_TYPE_DEL_SERVER,
    QRTR_TYPE_NEW_LOOKUP, QRTR_TYPE_NEW_SERVER,
};
use std::collections::{HashMap, VecDeque};
use std::io;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering::SeqCst};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

pub const LOCAL_NODE: u32 = 1;

/// (client socket id, service, request) -> reply bytes.
type Responder = Arc<dyn Fn(u64, u32, &Msg) -> Option<Vec<u8>> + Send + Sync>;

#[derive(Clone, Debug)]
pub struct Sent {
    pub sock: u64,
    pub svc: u32,
    pub msg: Msg,
}

#[derive(Default)]
struct SockState {
    q: VecDeque<(Vec<u8>, u32, u32)>,
    err: Option<i32>,
    shut: bool,
    peer_svc: Option<u32>,
}

#[derive(Default)]
struct NetState {
    next_id: u64,
    socks: HashMap<u64, SockState>,
    servers: HashMap<u32, (u32, u32)>,
    lookups: Vec<(u64, u32)>,
    sent: Vec<Sent>,
    fail_open: bool,
    responder: Option<Responder>,
}

pub struct FakeNet {
    st: Mutex<NetState>,
    cv: Condvar,
}

pub struct FakeTransport(Arc<FakeNet>);

pub struct FakeSock {
    net: Arc<FakeNet>,
    id: u64,
}

impl FakeNet {
    pub fn new() -> Arc<FakeNet> {
        Arc::new(FakeNet { st: Mutex::new(NetState::default()), cv: Condvar::new() })
    }

    pub fn transport(self: &Arc<Self>) -> FakeTransport {
        FakeTransport(self.clone())
    }

    fn notify(st: &mut NetState, cmd: u32, svc: u32, node: u32, port: u32) {
        let pkt = encode_ctrl(cmd, svc, 1, node, port);
        for &(sock, s) in &st.lookups {
            if s == svc {
                if let Some(ss) = st.socks.get_mut(&sock) {
                    ss.q.push_back((pkt.to_vec(), LOCAL_NODE, QRTR_PORT_CTL));
                }
            }
        }
    }

    pub fn add_server(&self, svc: u32, node: u32, port: u32) {
        let mut st = self.st.lock().unwrap();
        st.servers.insert(svc, (node, port));
        Self::notify(&mut st, QRTR_TYPE_NEW_SERVER, svc, node, port);
        self.cv.notify_all();
    }

    /// Listed for later lookups, but no NEW_SERVER notification.
    pub fn add_server_silently(&self, svc: u32, node: u32, port: u32) {
        self.st.lock().unwrap().servers.insert(svc, (node, port));
    }

    pub fn del_server(&self, svc: u32) {
        let mut st = self.st.lock().unwrap();
        if let Some((node, port)) = st.servers.remove(&svc) {
            Self::notify(&mut st, QRTR_TYPE_DEL_SERVER, svc, node, port);
        }
        self.cv.notify_all();
    }

    pub fn remove_server_silently(&self, svc: u32) {
        self.st.lock().unwrap().servers.remove(&svc);
    }

    /// ECONNRESET on every client socket talking to `svc`.
    pub fn reset_clients(&self, svc: u32) {
        let mut st = self.st.lock().unwrap();
        for ss in st.socks.values_mut() {
            if ss.peer_svc == Some(svc) {
                ss.err = Some(libc::ECONNRESET);
            }
        }
        self.cv.notify_all();
    }

    /// ENETRESET on every open socket, name-server watchers included.
    pub fn reset_all(&self) {
        let mut st = self.st.lock().unwrap();
        for ss in st.socks.values_mut() {
            ss.err = Some(libc::ENETRESET);
        }
        self.cv.notify_all();
    }

    pub fn set_fail_open(&self, on: bool) {
        self.st.lock().unwrap().fail_open = on;
    }

    pub fn set_responder(&self, f: impl Fn(u32, &Msg) -> Option<Vec<u8>> + Send + Sync + 'static) {
        self.st.lock().unwrap().responder = Some(Arc::new(move |_, svc, m| f(svc, m)));
    }

    /// A responder that also sees which client socket sent the request.
    pub fn set_responder_by_sock(&self, f: impl Fn(u64, u32, &Msg) -> Option<Vec<u8>> + Send + Sync + 'static) {
        self.st.lock().unwrap().responder = Some(Arc::new(f));
    }

    pub fn sent(&self) -> Vec<Sent> {
        self.st.lock().unwrap().sent.clone()
    }

    /// Waits until at least `n` requests reached service endpoints.
    pub fn wait_sent(&self, n: usize, timeout: Duration) -> Vec<Sent> {
        let end = Instant::now() + timeout;
        let mut st = self.st.lock().unwrap();
        while st.sent.len() < n {
            let left = end.saturating_duration_since(Instant::now());
            if left.is_zero() {
                break;
            }
            st = self.cv.wait_timeout(st, left).unwrap().0;
        }
        st.sent.clone()
    }

    /// Delivers `bytes` from `svc`'s endpoint to its newest client socket.
    pub fn reply(&self, svc: u32, bytes: Vec<u8>) {
        let mut st = self.st.lock().unwrap();
        let (node, port) = st.servers.get(&svc).copied().unwrap_or((0, 0));
        let id = st.socks.iter().filter(|(_, s)| s.peer_svc == Some(svc)).map(|(id, _)| *id).max();
        if let Some(id) = id {
            st.socks.get_mut(&id).unwrap().q.push_back((bytes, node, port));
        }
        self.cv.notify_all();
    }

    pub fn open_sockets(&self) -> usize {
        self.st.lock().unwrap().socks.len()
    }
}

impl Transport for FakeTransport {
    fn open(&self) -> io::Result<Box<dyn Datagram>> {
        let mut st = self.0.st.lock().unwrap();
        if st.fail_open {
            return Err(io::Error::from_raw_os_error(libc::EAFNOSUPPORT));
        }
        st.next_id += 1;
        let id = st.next_id;
        st.socks.insert(id, SockState::default());
        Ok(Box::new(FakeSock { net: self.0.clone(), id }))
    }
}

impl Drop for FakeSock {
    fn drop(&mut self) {
        let mut st = self.net.st.lock().unwrap();
        st.socks.remove(&self.id);
        let id = self.id;
        st.lookups.retain(|(s, _)| *s != id);
    }
}

impl Datagram for FakeSock {
    fn send_to(&self, node: u32, port: u32, buf: &[u8]) -> io::Result<()> {
        let mut st = self.net.st.lock().unwrap();
        let ss = st.socks.get(&self.id).unwrap();
        if ss.shut {
            return Err(io::Error::new(io::ErrorKind::NotConnected, "shut"));
        }
        if let Some(e) = ss.err {
            return Err(io::Error::from_raw_os_error(e));
        }
        if port == QRTR_PORT_CTL {
            if buf.len() >= 8 && u32::from_le_bytes([buf[0], buf[1], buf[2], buf[3]]) == QRTR_TYPE_NEW_LOOKUP {
                let svc = u32::from_le_bytes([buf[4], buf[5], buf[6], buf[7]]);
                let mut out = Vec::new();
                if let Some(&(n, p)) = st.servers.get(&svc) {
                    out.push(encode_ctrl(QRTR_TYPE_NEW_SERVER, svc, 1, n, p).to_vec());
                }
                out.push(encode_ctrl(QRTR_TYPE_NEW_SERVER, 0, 0, 0, 0).to_vec());
                st.lookups.push((self.id, svc));
                let ss = st.socks.get_mut(&self.id).unwrap();
                for p in out {
                    ss.q.push_back((p, LOCAL_NODE, QRTR_PORT_CTL));
                }
                self.net.cv.notify_all();
            }
            debug_assert!(parse_ctrl(buf).is_some());
            return Ok(());
        }
        let svc = match st.servers.iter().find(|(_, &ep)| ep == (node, port)) {
            Some((&svc, _)) => svc,
            None => return Err(io::Error::from_raw_os_error(libc::EHOSTUNREACH)),
        };
        let m = msg::parse(buf).expect("fake: unparsable request");
        st.socks.get_mut(&self.id).unwrap().peer_svc = Some(svc);
        st.sent.push(Sent { sock: self.id, svc, msg: m.clone() });
        if let Some(r) = st.responder.clone() {
            if let Some(reply) = r(self.id, svc, &m) {
                st.socks.get_mut(&self.id).unwrap().q.push_back((reply, node, port));
            }
        }
        self.net.cv.notify_all();
        Ok(())
    }

    fn recv(&self, buf: &mut [u8], timeout: Duration) -> io::Result<(usize, u32, u32)> {
        let end = Instant::now() + timeout;
        let mut st = self.net.st.lock().unwrap();
        loop {
            let ss = st.socks.get_mut(&self.id).unwrap();
            if ss.shut {
                return Err(io::Error::new(io::ErrorKind::NotConnected, "shut"));
            }
            if let Some(e) = ss.err {
                return Err(io::Error::from_raw_os_error(e));
            }
            if let Some((b, n, p)) = ss.q.pop_front() {
                let len = b.len().min(buf.len());
                buf[..len].copy_from_slice(&b[..len]);
                return Ok((len, n, p));
            }
            let left = end.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return Err(timed_out());
            }
            st = self.net.cv.wait_timeout(st, left).unwrap().0;
        }
    }

    fn local_node(&self) -> u32 {
        LOCAL_NODE
    }

    fn shutdown(&self) {
        let mut st = self.net.st.lock().unwrap();
        if let Some(ss) = st.socks.get_mut(&self.id) {
            ss.shut = true;
        }
        self.net.cv.notify_all();
    }
}

// ------------------------------------------------- shared whole-lane fixtures

use super::registry::{Config, Registry};
use super::{SERVICES, SVC_DMS, SVC_DSD, SVC_NAS, SVC_UIM, SVC_WDS};

/// A network with every service up whose responder answers each allow-listed
/// read with the committed `r1` device capture (LTE B1, PCI 295, EARFCN 150,
/// registered). Replies arrive immediately, as on the device.
pub fn r1_net() -> Arc<FakeNet> {
    let net = FakeNet::new();
    for (i, svc) in SERVICES.iter().enumerate() {
        net.add_server(*svc, 0, 0x40 + i as u32);
    }
    net.set_responder(r1_reply);
    net
}

/// The `r1` capture reply to an allow-listed read, or None.
pub fn r1_reply(svc: u32, m: &Msg) -> Option<Vec<u8>> {
    use crate::qmi::codec::testfix::fx;
    {
        let r = match (svc, m.id) {
            (SVC_NAS, 0x0020) => fx!("r1_3_0x0020"),
            (SVC_NAS, 0x0024) => fx!("r1_3_0x0024"),
            (SVC_NAS, 0x0031) => fx!("r1_3_0x0031"),
            (SVC_NAS, 0x0043) => fx!("r1_3_0x0043"),
            (SVC_NAS, 0x004F) => fx!("r1_3_0x004F"),
            (SVC_NAS, 0x00AC) => fx!("r1_3_0x00AC"),
            (SVC_DMS, 0x0022) => fx!("r1_2_0x0022"),
            (SVC_DMS, 0x0023) => fx!("r1_2_0x0023"),
            (SVC_DMS, 0x0025) => fx!("r1_2_0x0025"),
            (SVC_DMS, 0x002D) => fx!("r1_2_0x002D"),
            (SVC_DMS, 0x002F) => fx!("r1_2_0x002F"),
            (SVC_UIM, 0x002F) => fx!("r1_11_0x002F"),
            (SVC_UIM, 0x0047) => fx!("r1_11_0x0047"),
            (SVC_WDS, 0x002A) => fx!("r1_1_0x002A"),
            (SVC_DSD, 0x0024) => fx!("r1_42_0x0024"),
            _ => return None,
        };
        Some(msg::encode(msg::KIND_RESP, m.txn, m.id, &r.tlvs))
    }
}

/// A modem-side model of WDS packet statistics, per client socket, as seen
/// on the RM551E (2026-10-23): an unbound client gets 0x0046 on 0x0024; a
/// bound IPv4 client gets its call's counters; a bound IPv6 client gets
/// 0x000F (out of call) with zero last-call TLVs unless `v6_call` is set.
#[derive(Default)]
pub struct WdsModel {
    pub rx4: AtomicU64,
    pub tx4: AtomicU64,
    pub rx6: AtomicU64,
    pub tx6: AtomicU64,
    pub v6_call: AtomicBool,
    /// When set, Bind Mux Data Port fails with this QMI error code.
    pub bind_err: Mutex<Option<u16>>,
    /// When set, Bind Subscription fails with this QMI error code.
    pub subs_err: Mutex<Option<u16>>,
    /// Client socket -> (bound mux, IP family).
    socks: Mutex<HashMap<u64, (Option<u8>, u8)>>,
}

impl WdsModel {
    pub fn mux_of(&self, sock: u64) -> Option<u8> {
        self.socks.lock().unwrap().get(&sock).and_then(|s| s.0)
    }

    pub fn reply(&self, sock: u64, m: &Msg) -> Option<Vec<u8>> {
        use super::msg::{result_tlv, Tlv};
        let r = |tlvs: Vec<Tlv>| Some(msg::encode(msg::KIND_RESP, m.txn, m.id, &tlvs));
        let mut socks = self.socks.lock().unwrap();
        let st = socks.entry(sock).or_insert((None, 4));
        match m.id {
            0x00A2 => {
                if let Some(c) = *self.bind_err.lock().unwrap() {
                    return r(vec![result_tlv(Some(c))]);
                }
                st.0 = m.tlv(0x11).and_then(|v| v.first().copied());
                r(vec![result_tlv(None)])
            }
            0x00AF => r(vec![result_tlv(*self.subs_err.lock().unwrap())]),
            0x004D => {
                st.1 = m.tlv(0x01).and_then(|v| v.first().copied()).unwrap_or(4);
                r(vec![result_tlv(None)])
            }
            0x0024 => {
                let (mux, fam) = *st;
                let (tx, rx, call) = match fam {
                    6 => (self.tx6.load(SeqCst), self.rx6.load(SeqCst), self.v6_call.load(SeqCst)),
                    _ => (self.tx4.load(SeqCst), self.rx4.load(SeqCst), true),
                };
                match (mux, call) {
                    (None, _) => r(vec![result_tlv(Some(0x0046))]),
                    (Some(_), false) => r(vec![
                        result_tlv(Some(0x000F)),
                        Tlv::new(0x1B, &0u64.to_le_bytes()),
                        Tlv::new(0x1C, &0u64.to_le_bytes()),
                    ]),
                    (Some(_), true) => {
                        r(vec![result_tlv(None), Tlv::new(0x19, &tx.to_le_bytes()), Tlv::new(0x1A, &rx.to_le_bytes())])
                    }
                }
            }
            _ => None,
        }
    }
}

/// `r1_net` whose WDS service also models packet statistics per client.
pub fn wds_net() -> (Arc<FakeNet>, Arc<WdsModel>) {
    let net = r1_net();
    let model = Arc::new(WdsModel::default());
    let md = model.clone();
    net.set_responder_by_sock(move |sock, svc, m| match (svc, m.id) {
        (SVC_WDS, 0x00A2 | 0x00AF | 0x004D | 0x0024) => md.reply(sock, m),
        _ => r1_reply(svc, m),
    });
    (net, model)
}

/// `start_registry` with the daemon's two internal WDS clients.
pub fn start_registry_wds(net: &Arc<FakeNet>) -> Arc<Registry> {
    Arc::new(Registry::start(Box::new(net.transport()), Config { wds_stats: true, ..fast_config() }))
}

/// Fast timings for tests (the defaults wait whole seconds).
pub fn fast_config() -> Config {
    Config {
        request_timeout: Duration::from_millis(500),
        lookup_timeout: Duration::from_millis(100),
        backoff_min: Duration::from_millis(5),
        backoff_max: Duration::from_millis(20),
        tick: Duration::from_millis(5),
        ssr_merge: Duration::ZERO,
        circuit_after: 2,
        probe_every: Duration::from_millis(200),
        wds_stats: false,
        bind_retry: Duration::from_millis(100),
    }
}

pub fn start_registry(net: &Arc<FakeNet>) -> Arc<Registry> {
    Arc::new(Registry::start(Box::new(net.transport()), fast_config()))
}

/// Every service listed, none answering. `circuit` 0 disables the registry's
/// fast-fail circuit, so every read waits its full timeout.
pub fn silent_registry(timeout_ms: u64, circuit: u32) -> Arc<Registry> {
    let net = FakeNet::new();
    for (i, svc) in SERVICES.iter().enumerate() {
        net.add_server(*svc, 0, 0x40 + i as u32);
    }
    let mut c = fast_config();
    c.request_timeout = Duration::from_millis(timeout_ms);
    c.circuit_after = circuit;
    Arc::new(Registry::start(Box::new(net.transport()), c))
}
