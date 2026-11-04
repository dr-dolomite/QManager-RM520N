//! RM520N-local (not in the RM551E upstream): `qsms` over QMI WMS, no AT lock.
//!
//! A small synchronous client on `qmi::transport`; WMS stays out of the broker
//! registry. Output envelopes match the AT backend in `sms/mod.rs`.
//! Message bodies and numbers never reach the log.

use super::{
    error_json, error_message_json, message_json, pdu, plan_send, remaining, send_fail_json, send_ok_json, Listing, Mem,
    Op, SendPlan, Which,
};
use crate::common::json::json_escape;
use crate::common::log::Logger;
use crate::qmi::msg::{self, Msg, QmiResult, Tlv};
use crate::qmi::transport::{
    is_timeout, parse_ctrl, watch as lookup_socket, Ctrl, Datagram, QrtrTransport, QRTR_PORT_CTL,
};
use std::fmt::Write as _;
use std::io::{self, Write};
use std::time::{Duration, Instant};

const SVC_WMS: u32 = 5;
const OP_EVENT_REPORT: u16 = 0x0001;
const OP_RAW_SEND: u16 = 0x0020;
const OP_RAW_READ: u16 = 0x0022;
const OP_MODIFY_TAG: u16 = 0x0023;
const OP_DELETE: u16 = 0x0024;
const OP_LIST: u16 = 0x0031;
const OP_MAX_SIZE: u16 = 0x0036;

/// QMI result error: no such message / empty set.
const ERR_NO_ENTRY: u16 = 0x0032;
/// Message format 6: GSM/WCDMA point-to-point. Mode TLV value 1: GW.
const FMT_GW_PP: u8 = 6;
const MODE_GW: u8 = 1;

const OP_DEADLINE: Duration = Duration::from_secs(10);
const SEND_DEADLINE: Duration = Duration::from_secs(60);
const BACKOFF_MIN: Duration = Duration::from_millis(250);
const BACKOFF_MAX: Duration = Duration::from_secs(2);

const NOT_READY: &str = "SMS service is not ready yet. Try again in a minute.";
const NO_REPLY: &str = "No reply from the modem.";
const REFUSED: &str = "The modem refused the request.";

/// WMS storage type: NV is AT "ME", UIM is AT "SM".
fn st_of(m: Mem) -> u8 {
    match m {
        Mem::Me => 1,
        Mem::Sm => 0,
    }
}

fn mem_of(st: u8) -> Option<Mem> {
    match st {
        1 => Some(Mem::Me),
        0 => Some(Mem::Sm),
        _ => None,
    }
}

fn le32(b: &[u8], o: usize) -> Option<u32> {
    let s = b.get(o..o + 4)?;
    Some(u32::from_le_bytes([s[0], s[1], s[2], s[3]]))
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

enum ConnErr {
    /// WMS is not (yet) listed, or the name server is not answering.
    NotReady,
    /// No AF_QIPCRTR on this kernel: retrying cannot help.
    Fatal(io::Error),
}

enum CallErr {
    /// The request never left the socket.
    Unsent,
    Timeout,
    /// Socket error or the WMS server went away.
    Gone,
}

struct Conn {
    sock: Box<dyn Datagram>,
    node: u32,
    port: u32,
    txn: u16,
}

fn pause(d: Duration, until: Instant) {
    std::thread::sleep(d.min(until.saturating_duration_since(Instant::now())));
}

/// Looks WMS up on the name server, retrying with backoff until `until`.
fn connect(until: Instant) -> Result<Conn, ConnErr> {
    let mut back = BACKOFF_MIN;
    loop {
        match lookup_socket(&QrtrTransport, &[SVC_WMS]) {
            Ok(sock) => {
                if let Some((node, port)) = wait_server(&*sock, until) {
                    return Ok(Conn { sock, node, port, txn: 0 });
                }
            }
            Err(e) if matches!(e.raw_os_error(), Some(libc::EAFNOSUPPORT) | Some(libc::EPROTONOSUPPORT)) => {
                return Err(ConnErr::Fatal(e));
            }
            Err(_) => {}
        }
        if Instant::now() >= until {
            return Err(ConnErr::NotReady);
        }
        pause(back, until);
        back = (back * 2).min(BACKOFF_MAX);
    }
}

/// The name server lists existing servers, then an end marker: Some(addr) for WMS, else None.
fn wait_server(sock: &dyn Datagram, until: Instant) -> Option<(u32, u32)> {
    let mut buf = [0u8; 256];
    loop {
        let left = until.saturating_duration_since(Instant::now()).min(BACKOFF_MAX);
        if left.is_zero() {
            return None;
        }
        match sock.recv(&mut buf, left) {
            Ok((n, _, _)) => match parse_ctrl(&buf[..n]) {
                Some(Ctrl::NewServer { svc: SVC_WMS, node, port }) => return Some((node, port)),
                Some(Ctrl::EndOfList) => return None,
                _ => {}
            },
            Err(_) => return None,
        }
    }
}

impl Conn {
    /// One request, matched by transaction id; indications and strays are skipped.
    fn call(&mut self, id: u16, tlvs: &[Tlv], timeout: Duration) -> Result<Msg, CallErr> {
        self.txn = self.txn.wrapping_add(1).max(1);
        let txn = self.txn;
        self.sock.send_to(self.node, self.port, &msg::encode(msg::KIND_REQ, txn, id, tlvs)).map_err(|_| CallErr::Unsent)?;
        let end = Instant::now() + timeout;
        let mut buf = [0u8; 4096];
        loop {
            let left = end.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return Err(CallErr::Timeout);
            }
            let (n, node, port) = match self.sock.recv(&mut buf, left) {
                Ok(x) => x,
                Err(e) if is_timeout(&e) => return Err(CallErr::Timeout),
                Err(_) => return Err(CallErr::Gone),
            };
            if port == QRTR_PORT_CTL {
                if let Some(Ctrl::DelServer { svc: SVC_WMS, .. }) = parse_ctrl(&buf[..n]) {
                    return Err(CallErr::Gone);
                }
                continue;
            }
            if (node, port) != (self.node, self.port) {
                continue;
            }
            if let Some(m) = msg::parse(&buf[..n]) {
                if m.kind == msg::KIND_RESP && m.txn == txn && m.id == id {
                    return Ok(m);
                }
            }
        }
    }

    /// `call`, then the QMI result: the response on success, else the error code.
    fn ask(&mut self, id: u16, tlvs: &[Tlv], timeout: Duration) -> Result<Msg, Fail> {
        let m = self.call(id, tlvs, timeout).map_err(|_| Fail::Call)?;
        match m.result() {
            QmiResult::Ok => Ok(m),
            QmiResult::Err(ec) => Err(Fail::Qmi(ec)),
            QmiResult::Missing => Err(Fail::Qmi(0xffff)),
        }
    }
}

enum Fail {
    Call,
    Qmi(u16),
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/// 0x0031 for one storage: (index, tag) pairs, ascending. "No entry" is an empty storage.
fn list_indices(c: &mut Conn, st: u8) -> Result<Vec<(u32, u8)>, Fail> {
    let m = match c.ask(OP_LIST, &[Tlv::new(0x01, &[st]), Tlv::new(0x11, &[MODE_GW])], OP_DEADLINE) {
        Ok(m) => m,
        Err(Fail::Qmi(ERR_NO_ENTRY)) => return Ok(Vec::new()),
        Err(e) => return Err(e),
    };
    let v = m.tlv(0x01).unwrap_or(&[]);
    let n = le32(v, 0).unwrap_or(0) as usize;
    let mut out = Vec::new();
    for i in 0..n {
        let o = 4 + i * 5;
        match (le32(v, o), v.get(o + 4)) {
            (Some(idx), Some(&tag)) => out.push((idx, tag)),
            _ => break,
        }
    }
    out.sort_unstable();
    Ok(out)
}

/// WMS tag to the AT `stat` the shell callers know.
fn stat_of(tag: u8) -> &'static str {
    match tag {
        1 => "0",
        0 => "1",
        3 => "2",
        2 => "3",
        _ => "null",
    }
}

fn fail_json(f: Fail, code: &str, log: &Logger) -> String {
    match f {
        Fail::Call => error_json(code, Some(NO_REPLY)),
        Fail::Qmi(ec) => {
            log.warn(&format!("WMS error {:#06x}", ec));
            error_json(code, Some(REFUSED))
        }
    }
}

fn list(c: &mut Conn, ms: &[Mem], log: &Logger) -> String {
    let mut acc = Listing::default();
    let mut storage_errors: Vec<(Mem, String)> = Vec::new();
    for &m in ms {
        let one = (|| -> Result<(), Fail> {
            for (idx, tag) in list_indices(c, st_of(m))? {
                let mut req = vec![st_of(m)];
                req.extend_from_slice(&idx.to_le_bytes());
                let index = idx.to_string();
                let stat = stat_of(tag);
                let raw = match c.ask(OP_RAW_READ, &[Tlv::new(0x01, &req), Tlv::new(0x10, &[MODE_GW])], OP_DEADLINE) {
                    Ok(r) => r,
                    Err(Fail::Qmi(ERR_NO_ENTRY)) => continue,
                    Err(Fail::Qmi(ec)) => {
                        log.warn(&format!("WMS read error {:#06x}", ec));
                        acc.errors += 1;
                        let mut o = String::new();
                        error_message_json(&mut o, &index, m, stat);
                        acc.json.push(o);
                        continue;
                    }
                    Err(e) => return Err(e),
                };
                // TLV 0x01: tag u8, format u8, len u16 LE, then the PDU (SMSC octet first).
                let pdu_bytes = raw.tlv(0x01).filter(|v| v.len() >= 4).map(|v| {
                    let len = u16::from_le_bytes([v[2], v[3]]) as usize;
                    &v[4..(4 + len).min(v.len())]
                });
                let mut o = String::new();
                match pdu_bytes.map(pdu::decode_deliver) {
                    Some(Ok(d)) => message_json(&mut o, &index, m, stat, &d),
                    Some(Err(pdu::DecodeError::NotDeliver(_))) => {
                        acc.skipped += 1;
                        continue;
                    }
                    Some(Err(pdu::DecodeError::Malformed)) | None => {
                        acc.errors += 1;
                        error_message_json(&mut o, &index, m, stat);
                    }
                }
                acc.json.push(o);
            }
            Ok(())
        })();
        match one {
            Err(Fail::Qmi(ec)) if ms.len() > 1 => {
                log.warn(&format!("WMS list error {:#06x}", ec));
                storage_errors.push((m, "storage unavailable".to_string()));
            }
            Err(f) => return fail_json(f, "command_failed", log),
            Ok(()) => {}
        }
    }
    let mut out = format!("{{\"success\":true,\"msg\":[{}],\"skipped\":{}", acc.json.join(","), acc.skipped);
    if !storage_errors.is_empty() {
        let e: Vec<String> =
            storage_errors.iter().map(|(m, e)| format!("\"{}\":\"{}\"", m.as_str(), json_escape(e))).collect();
        let _ = write!(out, ",\"storage_errors\":{{{}}}", e.join(","));
    }
    out.push_str("}\n");
    out
}

fn status(c: &mut Conn, ms: &[Mem], log: &Logger) -> String {
    let mut items = Vec::new();
    for &m in ms {
        let r = c.ask(OP_MAX_SIZE, &[Tlv::new(0x01, &[st_of(m)]), Tlv::new(0x10, &[MODE_GW])], OP_DEADLINE);
        let r = match r {
            Ok(r) => r,
            Err(f) => return fail_json(f, "command_failed", log),
        };
        // TLV 0x01 max slots, TLV 0x10 free slots (both u32 LE).
        let (Some(max), Some(free)) = (r.tlv(0x01).and_then(|v| le32(v, 0)), r.tlv(0x10).and_then(|v| le32(v, 0))) else {
            return error_json("command_failed", Some(REFUSED));
        };
        items.push(format!("{{\"storage\":\"{}\",\"used\":{},\"total\":{}}}", m.as_str(), max.saturating_sub(free), max));
    }
    if items.len() == 1 {
        format!("{{\"success\":true,{}}}\n", &items[0][1..items[0].len() - 1])
    } else {
        format!("{{\"success\":true,\"storages\":[{}]}}\n", items.join(","))
    }
}

/// One raw-send reply: Ok(network ref), or Err((detail, ambiguous)). A QMI result error or a
/// request that never left is a definite rejection; no reply or a lost server may have reached the network.
fn send_reply(r: Result<Msg, CallErr>, log: &Logger, part: usize) -> Result<u16, (String, bool)> {
    let m = match r {
        Ok(m) => m,
        Err(CallErr::Unsent) => return Err((NO_REPLY.to_string(), false)),
        Err(_) => return Err((NO_REPLY.to_string(), true)),
    };
    match m.result() {
        QmiResult::Ok => Ok(m.tlv(0x01).filter(|v| v.len() >= 2).map(|v| u16::from_le_bytes([v[0], v[1]])).unwrap_or(0)),
        r => {
            let ec = if let QmiResult::Err(ec) = r { ec } else { 0xffff };
            // TLV 0x12 on a failed send: rp_cause u16 LE, tp_cause u8.
            let detail = match m.tlv(0x12).filter(|v| v.len() >= 2) {
                Some(v) => format!("The network rejected the message (cause {}).", u16::from_le_bytes([v[0], v[1]])),
                None => "The modem refused the message.".to_string(),
            };
            log.warn(&format!("WMS send part {part} error {:#06x}", ec));
            // No result TLV at all is a malformed reply, not a refusal.
            Err((detail, matches!(r, QmiResult::Missing)))
        }
    }
}

fn send(plan: &SendPlan, log: &Logger) -> String {
    let parts = &plan.parts;
    let mut refs: Vec<String> = Vec::new();
    let mut c = match connect(Instant::now() + SEND_DEADLINE) {
        Ok(c) => c,
        Err(_) => return send_fail_json(plan, "send_failed", NOT_READY, &refs, false),
    };
    for (i, p) in remaining(parts, plan.from).iter().enumerate() {
        let n = plan.from + i;
        let prefix = if parts.len() > 1 { format!("Part {} of {}: ", n, parts.len()) } else { String::new() };
        let Some(raw) = pdu::from_hex(&p.hex) else {
            return send_fail_json(plan, "send_failed", &format!("{prefix}{REFUSED}"), &refs, false);
        };
        // The PDU keeps its leading 00 SMSC octet.
        let mut v = vec![FMT_GW_PP];
        v.extend_from_slice(&(raw.len() as u16).to_le_bytes());
        v.extend_from_slice(&raw);
        match send_reply(c.call(OP_RAW_SEND, &[Tlv::new(0x01, &v)], SEND_DEADLINE), log, n) {
            Ok(mr) => refs.push(mr.to_string()),
            Err((detail, amb)) => return send_fail_json(plan, "send_failed", &format!("{prefix}{detail}"), &refs, amb),
        }
    }
    send_ok_json(plan, &refs)
}

fn index_error(f: Fail, log: &Logger) -> Result<&'static str, Fail> {
    match f {
        Fail::Qmi(ERR_NO_ENTRY) => Ok("no such message"),
        Fail::Qmi(ec) => {
            log.warn(&format!("WMS error {:#06x}", ec));
            Ok("the modem refused the request")
        }
        f => Err(f),
    }
}

fn delete(c: &mut Conn, mem: Mem, which: &Which, log: &Logger) -> String {
    let st = st_of(mem);
    match which {
        Which::Indices(v) => {
            let (mut deleted, mut failed) = (Vec::new(), Vec::new());
            for &i in v {
                let req = [Tlv::new(0x01, &[st]), Tlv::new(0x12, &[MODE_GW]), Tlv::new(0x10, &i.to_le_bytes())];
                match c.ask(OP_DELETE, &req, OP_DEADLINE) {
                    Ok(_) => deleted.push(i.to_string()),
                    Err(f) => match index_error(f, log) {
                        Ok(e) => failed.push(format!("{{\"index\":{i},\"error\":\"{e}\"}}")),
                        Err(f) => return fail_json(f, "delete_failed", log),
                    },
                }
            }
            let ok = failed.is_empty();
            format!(
                "{{\"success\":{ok},{}\"storage\":\"{}\",\"deleted\":[{}],\"failed\":[{}]}}\n",
                if ok { "" } else { "\"error\":\"delete_failed\"," },
                mem.as_str(),
                deleted.join(","),
                failed.join(",")
            )
        }
        Which::All => {
            let before = match list_indices(c, st) {
                Ok(l) => l.len(),
                Err(f) => return fail_json(f, "delete_failed", log),
            };
            if before > 0 {
                // Storage + mode only: every message in the storage.
                match c.ask(OP_DELETE, &[Tlv::new(0x01, &[st]), Tlv::new(0x12, &[MODE_GW])], OP_DEADLINE) {
                    Ok(_) | Err(Fail::Qmi(_)) => {}
                    Err(f) => return fail_json(f, "delete_failed", log),
                }
            }
            let left = match list_indices(c, st) {
                Ok(l) => l.len(),
                Err(f) => return fail_json(f, "delete_failed", log),
            };
            let ok = left == 0;
            format!(
                "{{\"success\":{ok},{}\"storage\":\"{}\",\"deleted\":{},\"remaining\":{left}}}\n",
                if ok { "" } else { "\"error\":\"delete_failed\"," },
                mem.as_str(),
                before.saturating_sub(left)
            )
        }
    }
}

fn tag(c: &mut Conn, mem: Mem, indices: &[u32], read: bool, log: &Logger) -> String {
    let mut failed = Vec::new();
    for &i in indices {
        let mut v = vec![st_of(mem)];
        v.extend_from_slice(&i.to_le_bytes());
        // Tag 0 = MT read, 1 = MT not read.
        v.push(if read { 0 } else { 1 });
        match c.ask(OP_MODIFY_TAG, &[Tlv::new(0x01, &v), Tlv::new(0x10, &[MODE_GW])], OP_DEADLINE) {
            Ok(_) => {}
            Err(f) => match index_error(f, log) {
                Ok(e) => failed.push(format!("{{\"index\":{i},\"error\":\"{e}\"}}")),
                Err(f) => return fail_json(f, "tag_failed", log),
            },
        }
    }
    if failed.is_empty() {
        "{\"success\":true}\n".to_string()
    } else {
        format!("{{\"success\":false,\"error\":\"tag_failed\",\"storage\":\"{}\",\"failed\":[{}]}}\n", mem.as_str(), failed.join(","))
    }
}

/// Runs a one-shot `op`. Returns (success, JSON envelope ending in a newline).
pub fn run(op: &Op) -> (bool, String) {
    let t = Instant::now();
    let log = Logger::new("qsms");
    let label = op.label();
    let plan = match op {
        Op::Send { number, text, concat_ref, from } => match plan_send(number, text, *concat_ref, *from) {
            Ok(p) => Some(p),
            Err(j) => return (false, j),
        },
        _ => None,
    };
    let json = if let Some(plan) = &plan {
        send(plan, &log)
    } else {
        match connect(Instant::now() + OP_DEADLINE) {
            Err(e) => {
                if let ConnErr::Fatal(e) = e {
                    log.error(&format!("{label}: QRTR unavailable: {e}"));
                }
                error_json("sms_unavailable", Some(NOT_READY))
            }
            Ok(mut c) => match op {
                Op::List(m) => list(&mut c, m, &log),
                Op::Status(m) => status(&mut c, m, &log),
                Op::Delete { mem, which } => delete(&mut c, *mem, which, &log),
                Op::Tag { mem, indices, read } => tag(&mut c, *mem, indices, *read, &log),
                Op::Send { .. } | Op::Watch => unreachable!("handled elsewhere"),
            },
        }
    };
    let ok = !json.starts_with("{\"success\":false");
    log.info(&format!("{label}: {} in {}ms", if ok { "ok" } else { "failed" }, t.elapsed().as_millis()));
    (ok, json)
}

// ---------------------------------------------------------------------------
// watch
// ---------------------------------------------------------------------------

/// True once the reader of stdout has gone (a closed pipe reports POLLERR).
fn stdout_closed() -> bool {
    let mut p = libc::pollfd { fd: 1, events: 0, revents: 0 };
    unsafe { libc::poll(&mut p, 1, 0) > 0 && p.revents & (libc::POLLERR | libc::POLLHUP | libc::POLLNVAL) != 0 }
}

fn emit(line: &str) -> io::Result<()> {
    let mut o = io::stdout().lock();
    o.write_all(line.as_bytes())?;
    o.flush()
}

/// One connected, registered session. Ok(()) means reconnect; Err means stdout is gone.
fn watch_session(c: &mut Conn, log: &Logger) -> Result<Instant, io::Error> {
    // TLV 0x10 = 1: report new MT messages.
    if c.ask(OP_EVENT_REPORT, &[Tlv::new(0x10, &[1])], OP_DEADLINE).is_err() {
        log.warn("watch: event report registration failed");
        return Ok(Instant::now());
    }
    emit("ready\n")?;
    let up = Instant::now();
    let mut buf = [0u8; 4096];
    loop {
        match c.sock.recv(&mut buf, Duration::from_secs(1)) {
            Ok((n, node, port)) => {
                if port == QRTR_PORT_CTL {
                    if let Some(Ctrl::DelServer { svc: SVC_WMS, .. }) = parse_ctrl(&buf[..n]) {
                        log.warn("watch: WMS server went away");
                        return Ok(up);
                    }
                    continue;
                }
                if (node, port) != (c.node, c.port) {
                    continue;
                }
                let Some(m) = msg::parse(&buf[..n]) else { continue };
                if m.kind != msg::KIND_IND || m.id != OP_EVENT_REPORT {
                    continue;
                }
                // TLV 0x10 of the indication: storage type u8, index u32 LE.
                let Some(v) = m.tlv(0x10).filter(|v| v.len() >= 5) else { continue };
                if let (Some(mem), Some(idx)) = (mem_of(v[0]), le32(v, 1)) {
                    emit(&format!("{} {}\n", mem.as_str(), idx))?;
                }
            }
            Err(e) if is_timeout(&e) => {
                if stdout_closed() {
                    return Err(io::Error::from(io::ErrorKind::BrokenPipe));
                }
            }
            Err(e) => {
                log.warn(&format!("watch: socket error {e}"));
                return Ok(up);
            }
        }
    }
}

/// `qsms watch`: prints `ready` after every (re)registration, then `<ME|SM> <index>` per new
/// message. Reconnects forever; exits 0 when stdout closes, 2 if QRTR is unsupported.
pub fn watch() -> i32 {
    let log = Logger::new("qsms");
    let mut back = BACKOFF_MIN;
    loop {
        let mut c = match connect(Instant::now() + OP_DEADLINE) {
            Ok(c) => c,
            Err(ConnErr::NotReady) => continue,
            Err(ConnErr::Fatal(e)) => {
                log.error(&format!("watch: QRTR unavailable: {e}"));
                let _ = writeln!(io::stderr(), "qsms watch: QRTR unavailable: {e}");
                // 2 = permanently unavailable: the shell supervisor stops respawning on it.
                return 2;
            }
        };
        match watch_session(&mut c, &log) {
            Ok(up) => {
                if up.elapsed() > Duration::from_secs(5) {
                    back = BACKOFF_MIN;
                }
            }
            Err(_) => return 0,
        }
        drop(c);
        std::thread::sleep(back);
        back = (back * 2).min(BACKOFF_MAX);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn resp(ec: Option<u16>, extra: &[Tlv]) -> Msg {
        let mut t = vec![msg::result_tlv(ec)];
        t.extend_from_slice(extra);
        msg::parse(&msg::encode(msg::KIND_RESP, 1, OP_RAW_SEND, &t)).unwrap()
    }

    #[test]
    fn from_skips_the_earlier_parts() {
        let plan = plan_send("491701234567", &"x".repeat(320), Some(9), 2).unwrap();
        assert_eq!(plan.parts.len(), 3);
        assert_eq!(remaining(&plan.parts, plan.from), &plan.parts[1..]);
        // A failure at part 2 of a --from 2 run: part 1 still counts as sent.
        let j = send_fail_json(&plan, "send_failed", "x", &[], false);
        assert!(j.contains("\"sent_parts\":1,\"concat_ref\":9,\"ambiguous\":false"), "{j}");
    }

    #[test]
    fn reply_classes_are_ambiguous_only_when_the_network_may_have_it() {
        let log = Logger::new("test");
        assert_eq!(send_reply(Ok(resp(None, &[Tlv::new(0x01, &[7, 0])])), &log, 1), Ok(7));
        // QMI result error (with or without the cause TLV): a definite rejection.
        assert_eq!(send_reply(Ok(resp(Some(0x0003), &[])), &log, 1).unwrap_err().1, false);
        let rej = send_reply(Ok(resp(Some(0x0003), &[Tlv::new(0x12, &[0x1D, 0, 0])])), &log, 1).unwrap_err();
        assert_eq!(rej, ("The network rejected the message (cause 29).".to_string(), false));
        // No reply, a lost server, or a reply without a result TLV: may have been sent.
        assert!(send_reply(Err(CallErr::Timeout), &log, 1).unwrap_err().1);
        assert!(send_reply(Err(CallErr::Gone), &log, 1).unwrap_err().1);
        let none = msg::parse(&msg::encode(msg::KIND_RESP, 1, OP_RAW_SEND, &[])).unwrap();
        assert!(send_reply(Ok(none), &log, 1).unwrap_err().1);
        // The request never left the socket.
        assert!(!send_reply(Err(CallErr::Unsent), &log, 1).unwrap_err().1);
    }
}
