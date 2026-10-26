//! SMS operations (the `qsms` client and the broker's SMS request kind).
//!
//! Each operation runs under ONE hold of /var/lock/qmanager.lock (an
//! `exec::Session`), so a listing, a multipart send or a delete is never
//! interleaved with another caller's AT command. Output keeps sms_tool
//! `recv -j`'s per-message keys so shell callers can move over mechanically;
//! everything is properly JSON-escaped (sms_tool printed sender raw).
//!
//! QManager routes incoming SMS to the user's chosen storage: ME unless
//! /etc/qmanager/sms_storage says SM (see docs/features/sms.md). Selecting the
//! other storage to read or delete it flips mem1, so every operation that
//! selects a storage restores X,X,X (X = the chosen storage) before it lets go
//! of the lock, even when it failed half-way.
//!
//! Message bodies and numbers never reach the log: inboxes hold one-time codes.

mod pdu;

use crate::at::channel::Device;
use crate::at::exec::{Executor, Session};
use crate::at::output::Code;
use crate::common::json::json_escape;
use std::fmt::Write as _;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mem {
    Me,
    Sm,
}

impl Mem {
    fn as_str(self) -> &'static str {
        match self {
            Mem::Me => "ME",
            Mem::Sm => "SM",
        }
    }

    fn parse(s: &str) -> Option<Mem> {
        match s {
            "ME" | "me" => Some(Mem::Me),
            "SM" | "sm" => Some(Mem::Sm),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Which {
    All,
    Indices(Vec<u32>),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Op {
    List(Vec<Mem>),
    Status(Vec<Mem>),
    Send { number: String, text: String },
    Delete { mem: Mem, which: Which },
}

impl Op {
    /// Log/label text. Never includes the number or the text.
    pub fn label(&self) -> String {
        let mems = |m: &[Mem]| m.iter().map(|m| m.as_str()).collect::<Vec<_>>().join("+");
        match self {
            Op::List(m) => format!("SMS list {}", mems(m)),
            Op::Status(m) => format!("SMS status {}", mems(m)),
            Op::Send { .. } => "SMS send".to_string(),
            Op::Delete { mem, which: Which::All } => format!("SMS delete {} all", mem.as_str()),
            Op::Delete { mem, which: Which::Indices(v) } => format!("SMS delete {} ({} indexes)", mem.as_str(), v.len()),
        }
    }
}

pub const USAGE: &str = "Usage: qsms list [ME|SM|all] | status [ME|SM|all] | send <number> <text> | delete <ME|SM> <idx,...|all>";

fn mems(arg: Option<&String>, default: &[Mem]) -> Result<Vec<Mem>, String> {
    match arg.map(String::as_str) {
        None => Ok(default.to_vec()),
        Some("all") | Some("ALL") => Ok(vec![Mem::Me, Mem::Sm]),
        Some(s) => Mem::parse(s).map(|m| vec![m]).ok_or_else(|| format!("unknown storage '{s}'")),
    }
}

fn indices(s: &str) -> Result<Which, String> {
    if s == "all" || s == "ALL" {
        return Ok(Which::All);
    }
    let mut v: Vec<u32> = Vec::new();
    for p in s.split(',') {
        let p = p.trim();
        if p.is_empty() || p.len() > 5 || !p.bytes().all(|b| b.is_ascii_digit()) {
            return Err(format!("bad index '{p}'"));
        }
        let n: u32 = p.parse().map_err(|_| format!("bad index '{p}'"))?;
        if n > 65535 {
            return Err(format!("bad index '{p}'"));
        }
        if !v.contains(&n) {
            v.push(n);
        }
    }
    Ok(Which::Indices(v))
}

/// Parses `qsms` arguments (without argv[0]). Shared by client and broker, so
/// the broker re-validates whatever reaches its socket.
pub fn parse_args(args: &[String]) -> Result<Op, String> {
    let op = args.first().map(String::as_str).unwrap_or("");
    match (op, args.len()) {
        ("list", 1..=2) => Ok(Op::List(mems(args.get(1), &[Mem::Me])?)),
        ("status", 1..=2) => Ok(Op::Status(mems(args.get(1), &[Mem::Me, Mem::Sm])?)),
        ("send", 3) => {
            if args[2].is_empty() {
                return Err("empty message".into());
            }
            Ok(Op::Send { number: args[1].clone(), text: args[2].clone() })
        }
        ("delete", 3) => {
            let mem = Mem::parse(&args[1]).ok_or_else(|| format!("unknown storage '{}'", args[1]))?;
            Ok(Op::Delete { mem, which: indices(&args[2])? })
        }
        _ => Err(USAGE.into()),
    }
}

/// `{"success":false,"error":<code>[,"detail":...]}` plus a newline.
pub fn error_json(code: &str, detail: Option<&str>) -> String {
    match detail {
        Some(d) => format!("{{\"success\":false,\"error\":\"{}\",\"detail\":\"{}\"}}\n", json_escape(code), json_escape(d)),
        None => format!("{{\"success\":false,\"error\":\"{}\"}}\n", json_escape(code)),
    }
}

// ---------------------------------------------------------------------------
// AT reply helpers
// ---------------------------------------------------------------------------

/// Non-empty lines of a reply, CRs dropped.
fn lines(raw: &[u8]) -> Vec<String> {
    String::from_utf8_lossy(raw)
        .split('\n')
        .map(|l| l.trim_matches('\r').to_string())
        .filter(|l| !l.is_empty())
        .collect()
}

/// Ok if the final result code is OK, else that code's line (e.g. `+CMS ERROR: 321`).
fn final_ok(raw: &[u8]) -> Result<(), String> {
    match lines(raw).last() {
        Some(l) if l == "OK" => Ok(()),
        Some(l) => Err(l.clone()),
        None => Err("no reply".into()),
    }
}

/// What a failed step reports: an AT-level refusal or a transport code.
enum Fail {
    At(String),
    Code(Code),
}

impl From<Code> for Fail {
    fn from(c: Code) -> Fail {
        Fail::Code(c)
    }
}

const CMD_TIMEOUT: Duration = Duration::from_secs(10);
const LIST_TIMEOUT: Duration = Duration::from_secs(30);
const PROMPT_TIMEOUT: Duration = Duration::from_secs(10);
/// Per part: submission waits for the network's acknowledgement.
const PART_TIMEOUT: Duration = Duration::from_secs(60);

fn step<D: Device>(s: &mut Session<'_, D>, cmd: &str, t: Duration) -> Result<Vec<u8>, Fail> {
    let raw = s.at(cmd, t)?;
    final_ok(&raw).map_err(Fail::At)?;
    Ok(raw)
}

fn select<D: Device>(s: &mut Session<'_, D>, mem: Mem) -> Result<(), Fail> {
    step(s, &format!("AT+CPMS=\"{}\"", mem.as_str()), CMD_TIMEOUT).map(|_| ())
}

/// The user's storage choice, written by `cellular/sms_storage.sh`. A missing
/// or unreadable file means ME, the routing QManager has always used.
pub const PREF_FILE: &str = "/etc/qmanager/sms_storage";

/// `SM` (any case, whitespace ignored) means the SIM; anything else ME.
fn parse_pref(raw: &str) -> Mem {
    match raw.trim().to_ascii_uppercase().as_str() {
        "SM" => Mem::Sm,
        _ => Mem::Me,
    }
}

fn preferred() -> Mem {
    std::fs::read_to_string(PREF_FILE).map(|r| parse_pref(&r)).unwrap_or(Mem::Me)
}

/// Puts all three pointers back on the chosen storage. False if that failed.
fn restore<D: Device>(s: &mut Session<'_, D>) -> bool {
    restore_to(s, preferred())
}

fn restore_to<D: Device>(s: &mut Session<'_, D>, m: Mem) -> bool {
    let m = m.as_str();
    step(s, &format!("AT+CPMS=\"{m}\",\"{m}\",\"{m}\""), CMD_TIMEOUT).is_ok()
}

/// `+CPMS: "ME",97,255,...` -> (name, used, total) of mem1.
fn parse_cpms(raw: &[u8]) -> Option<(String, u32, u32)> {
    let l = lines(raw).into_iter().find(|l| l.starts_with("+CPMS:"))?;
    let mut f = l["+CPMS:".len()..].split(',').map(str::trim);
    let name = f.next()?.trim_matches('"').to_string();
    let used = f.next()?.parse().ok()?;
    let total = f.next()?.parse().ok()?;
    Some((name, used, total))
}

/// `+CMGD: (0,1,5-7),(0-4)` -> the occupied indexes [0,1,5,6,7].
fn parse_cmgd_test(raw: &[u8]) -> Option<Vec<u32>> {
    let l = lines(raw).into_iter().find(|l| l.starts_with("+CMGD:"))?;
    let open = l.find('(')?;
    let close = open + l[open..].find(')')?;
    let mut v = Vec::new();
    for p in l[open + 1..close].split(',').map(str::trim).filter(|p| !p.is_empty()) {
        match p.split_once('-') {
            Some((a, b)) => {
                let (a, b): (u32, u32) = (a.trim().parse().ok()?, b.trim().parse().ok()?);
                if b < a || b - a > 1024 {
                    return None;
                }
                v.extend(a..=b);
            }
            None => v.push(p.parse().ok()?),
        }
    }
    Some(v)
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

fn message_json(out: &mut String, index: &str, mem: Mem, stat: &str, d: &pdu::Deliver) {
    let _ = write!(
        out,
        "{{\"index\":{},\"storage\":\"{}\",\"stat\":{},\"sender\":\"{}\",\"timestamp\":\"{}\",",
        index,
        mem.as_str(),
        stat,
        json_escape(&d.sender),
        json_escape(&d.timestamp)
    );
    if let Some(c) = d.concat {
        let _ = write!(out, "\"reference\":{},\"part\":{},\"total\":{},", c.reference, c.part, c.total);
    }
    let _ = write!(out, "\"encoding\":\"{}\",\"content\":\"{}\"}}", d.encoding.as_str(), json_escape(&d.content));
}

fn error_message_json(out: &mut String, index: &str, mem: Mem, stat: &str) {
    let _ = write!(
        out,
        "{{\"index\":{},\"storage\":\"{}\",\"stat\":{},\"error\":\"error decoding pdu\",\"sender\":\"\",\"timestamp\":\"\",\"content\":\"\"}}",
        index,
        mem.as_str(),
        stat
    );
}

#[derive(Default)]
struct Listing {
    json: Vec<String>,
    skipped: u32,
    errors: u32,
}

/// Decodes an `AT+CMGL=4` reply (PDU mode).
fn parse_cmgl(raw: &[u8], mem: Mem, acc: &mut Listing) {
    let ls = lines(raw);
    let mut i = 0;
    while i < ls.len() {
        let Some(rest) = ls[i].strip_prefix("+CMGL:") else {
            i += 1;
            continue;
        };
        i += 1;
        let mut f = rest.split(',').map(str::trim);
        let index = f.next().unwrap_or("");
        let stat = f.next().unwrap_or("");
        let numeric = |s: &str| !s.is_empty() && s.len() < 10 && s.bytes().all(|b| b.is_ascii_digit());
        if !numeric(index) {
            acc.errors += 1;
            continue;
        }
        let stat = if numeric(stat) { stat } else { "null" };
        // The PDU is the next line. A URC that slipped in between is skipped;
        // another +CMGL header or the terminator means the PDU is missing.
        let mut bytes = None;
        while i < ls.len() && !ls[i].starts_with("+CMGL:") && ls[i] != "OK" {
            let l = &ls[i];
            i += 1;
            if let Some(b) = pdu::from_hex(l) {
                bytes = Some(b);
                break;
            }
            if !l.starts_with('+') {
                break;
            }
        }
        let mut o = String::new();
        match bytes.as_deref().map(pdu::decode_deliver) {
            Some(Ok(d)) => message_json(&mut o, index, mem, stat, &d),
            Some(Err(pdu::DecodeError::NotDeliver(_))) => {
                acc.skipped += 1;
                continue;
            }
            Some(Err(pdu::DecodeError::Malformed)) | None => {
                acc.errors += 1;
                error_message_json(&mut o, index, mem, stat);
            }
        }
        acc.json.push(o);
    }
}

fn list<D: Device>(s: &mut Session<'_, D>, ms: &[Mem]) -> Result<String, Fail> {
    let mut acc = Listing::default();
    let mut storage_errors: Vec<(Mem, String)> = Vec::new();
    let r = (|| -> Result<(), Fail> {
        step(s, "AT+CMGF=0", CMD_TIMEOUT)?;
        for &m in ms {
            // With `all`, an unusable SIM store must not hide the ME inbox.
            let one = (|| -> Result<(), Fail> {
                select(s, m)?;
                let raw = step(s, "AT+CMGL=4", LIST_TIMEOUT)?;
                parse_cmgl(&raw, m, &mut acc);
                Ok(())
            })();
            match one {
                Err(Fail::At(e)) if ms.len() > 1 => storage_errors.push((m, e)),
                other => other?,
            }
        }
        Ok(())
    })();
    let restored = restore(s);
    r?;
    let mut out = format!("{{\"success\":true,\"msg\":[{}],\"skipped\":{}", acc.json.join(","), acc.skipped);
    if !storage_errors.is_empty() {
        let e: Vec<String> =
            storage_errors.iter().map(|(m, e)| format!("\"{}\":\"{}\"", m.as_str(), json_escape(e))).collect();
        let _ = write!(out, ",\"storage_errors\":{{{}}}", e.join(","));
    }
    if !restored {
        out.push_str(",\"warning\":\"cpms_restore_failed\"");
    }
    out.push_str("}\n");
    Ok(out)
}

fn status<D: Device>(s: &mut Session<'_, D>, ms: &[Mem]) -> Result<String, Fail> {
    let mut items = Vec::new();
    let r = (|| -> Result<(), Fail> {
        for &m in ms {
            select(s, m)?;
            let raw = step(s, "AT+CPMS?", CMD_TIMEOUT)?;
            match parse_cpms(&raw) {
                Some((name, used, total)) if name == m.as_str() => items.push(format!(
                    "{{\"storage\":\"{}\",\"used\":{},\"total\":{}}}",
                    m.as_str(),
                    used,
                    total
                )),
                _ => return Err(Fail::At("unparsable CPMS response".into())),
            }
        }
        Ok(())
    })();
    let restored = restore(s);
    r?;
    let warn = if restored { "" } else { ",\"warning\":\"cpms_restore_failed\"" };
    Ok(if items.len() == 1 {
        // Single storage: flat, like sms_tool status.
        format!("{{\"success\":true,{}{}}}\n", &items[0][1..items[0].len() - 1], warn)
    } else {
        format!("{{\"success\":true,\"storages\":[{}]{}}}\n", items.join(","), warn)
    })
}

fn send<D: Device>(s: &mut Session<'_, D>, parts: &[pdu::SubmitPart]) -> Result<String, String> {
    let mut refs: Vec<String> = Vec::new();
    let fail = |code: &str, detail: &str, refs: &[String]| {
        format!(
            "{{\"success\":false,\"error\":\"{}\",\"detail\":\"{}\",\"parts\":{},\"sent_parts\":{},\"refs\":[{}]}}\n",
            code,
            json_escape(detail),
            parts.len(),
            refs.len(),
            refs.join(",")
        )
    };
    match s.at("AT+CMGF=0", CMD_TIMEOUT) {
        Ok(raw) => {
            if let Err(e) = final_ok(&raw) {
                return Err(fail("send_failed", &e, &refs));
            }
        }
        Err(c) => return Err(fail(c.as_str(), "", &refs)),
    }
    for p in parts {
        let raw = match s.at_prompt(&format!("AT+CMGS={}", p.tpdu_len), p.hex.as_bytes(), PROMPT_TIMEOUT, PART_TIMEOUT) {
            Ok(r) => r,
            Err(c) => return Err(fail(c.as_str(), "", &refs)),
        };
        let ls = lines(&raw);
        let mr = ls.iter().find_map(|l| l.strip_prefix("+CMGS:")).map(|v| v.trim().to_string());
        match (mr, final_ok(&raw)) {
            (Some(mr), Ok(())) if !mr.is_empty() && mr.bytes().all(|b| b.is_ascii_digit()) => refs.push(mr),
            (_, Err(e)) => return Err(fail("send_failed", &e, &refs)),
            _ => return Err(fail("send_failed", "no +CMGS reference", &refs)),
        }
    }
    Ok(format!("{{\"success\":true,\"parts\":{},\"refs\":[{}]}}\n", parts.len(), refs.join(",")))
}

fn delete<D: Device>(s: &mut Session<'_, D>, mem: Mem, which: &Which) -> Result<String, Fail> {
    let r = (|| -> Result<String, Fail> {
        select(s, mem)?;
        match which {
            Which::Indices(v) => {
                let mut deleted = Vec::new();
                let mut failed = Vec::new();
                for &i in v {
                    match step(s, &format!("AT+CMGD={i}"), CMD_TIMEOUT) {
                        Ok(_) => deleted.push(i.to_string()),
                        Err(Fail::At(e)) => failed.push(format!("{{\"index\":{i},\"error\":\"{}\"}}", json_escape(&e))),
                        Err(c) => return Err(c),
                    }
                }
                let ok = failed.is_empty();
                Ok(format!(
                    "{{\"success\":{ok},{}\"storage\":\"{}\",\"deleted\":[{}],\"failed\":[{}]}}\n",
                    if ok { "" } else { "\"error\":\"delete_failed\"," },
                    mem.as_str(),
                    deleted.join(","),
                    failed.join(",")
                ))
            }
            Which::All => {
                // AT+CMGD=? lists the occupied indexes (verified on the RM551E:
                // they run past 49, where sms_tool's `delete all` stopped).
                let occupied = |s: &mut Session<'_, D>| -> Result<Vec<u32>, Fail> {
                    let raw = step(s, "AT+CMGD=?", CMD_TIMEOUT)?;
                    parse_cmgd_test(&raw).ok_or_else(|| Fail::At("unparsable CMGD response".into()))
                };
                let before = occupied(s)?;
                if let Some(&first) = before.first() {
                    // delflag 4 = every message in mem1 (27.005); the index is
                    // ignored but must be valid. Fall back to one by one.
                    if step(s, &format!("AT+CMGD={first},4"), LIST_TIMEOUT).is_err() {
                        for &i in &before {
                            match step(s, &format!("AT+CMGD={i}"), CMD_TIMEOUT) {
                                Ok(_) | Err(Fail::At(_)) => {}
                                Err(c) => return Err(c),
                            }
                        }
                    }
                }
                let left = occupied(s)?.len();
                let ok = left == 0;
                Ok(format!(
                    "{{\"success\":{ok},{}\"storage\":\"{}\",\"deleted\":{},\"remaining\":{left}}}\n",
                    if ok { "" } else { "\"error\":\"delete_failed\"," },
                    mem.as_str(),
                    before.len().saturating_sub(left)
                ))
            }
        }
    })();
    let restored = restore(s);
    let mut out = r?;
    if !restored {
        out.truncate(out.len() - 2);
        out.push_str(",\"warning\":\"cpms_restore_failed\"}\n");
    }
    Ok(out)
}

fn fail_json(f: Fail, at_code: &str) -> String {
    match f {
        Fail::At(e) => error_json(at_code, Some(&e)),
        Fail::Code(c) => error_json(c.as_str(), None),
    }
}

/// An 8-bit concatenation reference that differs between sends.
fn concat_ref() -> u8 {
    (crate::common::proto::mono_ms() as u32 ^ std::process::id()) as u8
}

/// Runs `op`. Returns (success, JSON envelope ending in a newline).
pub fn run<D: Device>(ex: &mut Executor<'_, D>, op: &Op, waited: Duration) -> (bool, String) {
    let t = Instant::now();
    let label = op.label();
    // Encode before taking the lock: a bad number never touches the modem.
    let parts = match op {
        Op::Send { number, text } => match pdu::encode_submit(number, text, concat_ref()) {
            Ok(p) => p,
            Err(e) => return (false, error_json(e.as_str(), None)),
        },
        _ => Vec::new(),
    };
    let r = ex.session(&label, waited, |s| match op {
        Op::List(m) => list(s, m).map_err(|f| fail_json(f, "command_failed")),
        Op::Status(m) => status(s, m).map_err(|f| fail_json(f, "command_failed")),
        Op::Send { .. } => send(s, &parts),
        Op::Delete { mem, which } => delete(s, *mem, which).map_err(|f| fail_json(f, "delete_failed")),
    });
    let (ok, json) = match r {
        Ok(Ok(j)) => (true, j),
        Ok(Err(j)) => (false, j),
        Err(code) => (false, error_json(code.as_str(), None)),
    };
    // A delete that left messages behind reports success:false in its JSON.
    let ok = ok && !json.starts_with("{\"success\":false");
    let what = if let Op::Send { .. } = op { format!(" ({} parts)", parts.len()) } else { String::new() };
    ex.log.info(&format!("{label}{what}: {} in {}ms", if ok { "ok" } else { "failed" }, t.elapsed().as_millis()));
    (ok, json)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::at::channel::Channel;
    use crate::common::lock::LockFile;
    use crate::common::log::Logger;
    use std::io::{Read, Write};
    use std::os::unix::net::UnixStream;
    use std::sync::{Arc, Mutex};
    use std::thread;

    /// A stateful fake modem: two storages, mem1 selection, CMGL, CMGD, CMGS
    /// with a prompt. `cms_on_send` makes the Nth part (1-based) fail.
    struct Modem {
        mem1: &'static str,
        cpms: String,
        me: Vec<(u32, String)>,
        sm: Vec<(u32, String)>,
        cms_on_send: Option<usize>,
        sent: Vec<String>,
        sm_broken: bool,
        no_delflag: bool,
    }

    impl Modem {
        fn new() -> Modem {
            Modem {
                mem1: "ME",
                cpms: "\"ME\",\"ME\",\"ME\"".into(),
                me: vec![],
                sm: vec![],
                cms_on_send: None,
                sent: vec![],
                sm_broken: false,
                no_delflag: false,
            }
        }

        fn store(&mut self) -> &mut Vec<(u32, String)> {
            if self.mem1 == "SM" {
                &mut self.sm
            } else {
                &mut self.me
            }
        }

        fn answer(&mut self, cmd: &str) -> Vec<u8> {
            let ok = |body: String| format!("{cmd}\r\r\n{body}OK\r\n").into_bytes();
            if cmd == "AT+CMGF=0" || cmd == "AT" {
                return ok(String::new());
            }
            if let Some(a) = cmd.strip_prefix("AT+CPMS=") {
                let first = a.split(',').next().unwrap().trim_matches('"');
                if first == "SM" && self.sm_broken {
                    return format!("{cmd}\r\r\n+CMS ERROR: 310\r\n").into_bytes();
                }
                self.mem1 = if first == "SM" { "SM" } else { "ME" };
                if a.contains(',') {
                    self.cpms = a.to_string();
                }
                return ok("+CPMS: 1,255,1,255,1,255\r\n\r\n".into());
            }
            if cmd == "AT+CPMS?" {
                let n = self.store().len();
                let m = self.mem1;
                return ok(format!("+CPMS: \"{m}\",{n},255,\"ME\",{n},255,\"ME\",{n},255\r\n\r\n"));
            }
            if cmd == "AT+CMGL=4" {
                let mut b = String::new();
                for (i, p) in self.store().iter() {
                    // saturating: a stub PDU shorter than the 8-byte SMSC
                    // header must not panic the mock (debug overflow check).
                    let len = (p.len() / 2).saturating_sub(8);
                    b.push_str(&format!("+CMGL: {i},1,,{len}\r\n{p}\r\n"));
                }
                return ok(b + "\r\n");
            }
            if cmd == "AT+CMGD=?" {
                let l: Vec<String> = self.store().iter().map(|(i, _)| i.to_string()).collect();
                return ok(format!("+CMGD: ({}),(0-4)\r\n\r\n", l.join(",")));
            }
            if let Some(a) = cmd.strip_prefix("AT+CMGD=") {
                if let Some((_, flag)) = a.split_once(',') {
                    if flag == "4" && !self.no_delflag {
                        self.store().clear();
                        return ok(String::new());
                    }
                    return format!("{cmd}\r\r\nERROR\r\n").into_bytes();
                }
                let i: u32 = a.parse().unwrap();
                let st = self.store();
                return match st.iter().position(|(k, _)| *k == i) {
                    Some(p) => {
                        st.remove(p);
                        ok(String::new())
                    }
                    None => format!("{cmd}\r\r\n+CMS ERROR: 321\r\n").into_bytes(),
                };
            }
            format!("{cmd}\r\r\nERROR\r\n").into_bytes()
        }
    }

    fn spawn(m: Modem) -> (Channel<UnixStream>, Arc<Mutex<Modem>>, Arc<Mutex<Vec<String>>>) {
        let (near, mut far) = UnixStream::pair().unwrap();
        near.set_nonblocking(true).unwrap();
        let m = Arc::new(Mutex::new(m));
        let m2 = m.clone();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let seen2 = seen.clone();
        thread::spawn(move || {
            let mut buf = [0u8; 4096];
            let mut acc: Vec<u8> = Vec::new();
            let mut in_pdu = false;
            loop {
                let n = match far.read(&mut buf) {
                    Ok(0) | Err(_) => return,
                    Ok(n) => n,
                };
                acc.extend_from_slice(&buf[..n]);
                loop {
                    if in_pdu {
                        let Some(p) = acc.iter().position(|&b| b == 0x1A) else { break };
                        let pdu = String::from_utf8_lossy(&acc[..p]).to_string();
                        acc.drain(..=p);
                        in_pdu = false;
                        let mut mm = m2.lock().unwrap();
                        mm.sent.push(pdu);
                        let k = mm.sent.len();
                        let r = if mm.cms_on_send == Some(k) {
                            "\r\n+CMS ERROR: 500\r\n".to_string()
                        } else {
                            format!("\r\n+CMGS: {}\r\n\r\nOK\r\n", 40 + k)
                        };
                        let _ = far.write_all(r.as_bytes());
                        continue;
                    }
                    let Some(p) = acc.windows(2).position(|w| w == b"\r\n") else { break };
                    let cmd = String::from_utf8_lossy(&acc[..p]).to_string();
                    acc.drain(..p + 2);
                    seen2.lock().unwrap().push(cmd.clone());
                    if cmd.starts_with("AT+CMGS=") {
                        let _ = far.write_all(format!("{cmd}\r\r\n> ").as_bytes());
                        in_pdu = true;
                    } else {
                        let r = m2.lock().unwrap().answer(&cmd);
                        let _ = far.write_all(&r);
                    }
                }
            }
        });
        let slot = Mutex::new(Some(near));
        let ch = Channel::new(Box::new(move || slot.lock().unwrap().take().ok_or_else(|| std::io::Error::other("x"))));
        (ch, m, seen)
    }

    fn run_op(ch: &mut Channel<UnixStream>, args: &[&str]) -> (bool, String) {
        let p = std::env::temp_dir().join(format!("qatd-sms-lock-{}-{:?}", std::process::id(), thread::current().id()));
        let lock = LockFile::open(p.to_str().unwrap()).unwrap();
        let log = Logger::new("test");
        let args: Vec<String> = args.iter().map(|s| s.to_string()).collect();
        let op = parse_args(&args).unwrap();
        let mut ex = Executor { ch, lock: &lock, log: &log };
        let r = run(&mut ex, &op, Duration::ZERO);
        let _ = std::fs::remove_file(p);
        r
    }

    const V1: &str = "07911326040000F0040B911346610089F60000208062917314080CC8F71D14969741F977FD07";
    const V5: &str = "07916831081010F0440B915155214365F700006201619050700015050003CC0201906536FB0D8287E574D0DB5D06";
    const SUBMIT: &str = "0011000B916407281553F80000AA0AE8329BFD4697D9EC37";
    const V11: &str = "07916831081010F0040B915155214365F70000620161905070000DF3701E2442A745AFCD4B8107";

    #[test]
    fn list_all_reads_both_storages_and_restores_me() {
        let mut m = Modem::new();
        m.me = vec![(0, V1.into()), (3, SUBMIT.into()), (60, V11.into())];
        m.sm = vec![(1, V5.into())];
        let (mut ch, modem, seen) = spawn(m);
        let (ok, j) = run_op(&mut ch, &["list", "all"]);
        assert!(ok, "{j}");
        assert!(j.starts_with("{\"success\":true,\"msg\":[{\"index\":0,\"storage\":\"ME\",\"stat\":1,\"sender\":\"31641600986\",\"timestamp\":\"08/26/02 19:37:41\",\"encoding\":\"gsm7\",\"content\":\"How are you?\"}"), "{j}");
        assert!(j.contains("{\"index\":60,\"storage\":\"ME\""), "{j}");
        assert!(j.contains(r#""content":"say \"hi\"/\\\nx""#), "{j}");
        assert!(j.contains("\"index\":1,\"storage\":\"SM\""), "{j}");
        assert!(j.contains("\"reference\":204,\"part\":1,\"total\":2,"), "{j}");
        assert!(j.ends_with(",\"skipped\":1}\n"), "{j}");
        assert_eq!(modem.lock().unwrap().cpms, "\"ME\",\"ME\",\"ME\"");
        assert_eq!(modem.lock().unwrap().mem1, "ME");
        let s = seen.lock().unwrap().clone();
        assert_eq!(s.last().unwrap(), "AT+CPMS=\"ME\",\"ME\",\"ME\"");
        assert!(s.contains(&"AT+CPMS=\"SM\"".to_string()));
    }

    #[test]
    fn storage_preference_parses_sm_and_defaults_to_me() {
        assert_eq!(parse_pref("SM\n"), Mem::Sm);
        assert_eq!(parse_pref("  sm "), Mem::Sm);
        assert_eq!(parse_pref("ME"), Mem::Me);
        assert_eq!(parse_pref(""), Mem::Me);
        assert_eq!(parse_pref("MT"), Mem::Me);
        assert_eq!(parse_pref("SIM"), Mem::Me);
    }

    #[test]
    fn broken_sim_store_keeps_the_me_inbox() {
        let mut m = Modem::new();
        m.me = vec![(0, V1.into())];
        m.sm_broken = true;
        let (mut ch, _, _) = spawn(m);
        let (ok, j) = run_op(&mut ch, &["list", "all"]);
        assert!(ok, "{j}");
        assert!(j.contains("\"storage_errors\":{\"SM\":\"+CMS ERROR: 310\"}"), "{j}");
        // Reading only SM is a real failure, and ME is still restored.
        let mut m = Modem::new();
        m.sm_broken = true;
        let (mut ch, modem, seen) = spawn(m);
        let (ok, j) = run_op(&mut ch, &["list", "SM"]);
        assert!(!ok);
        assert_eq!(j, "{\"success\":false,\"error\":\"command_failed\",\"detail\":\"+CMS ERROR: 310\"}\n");
        assert_eq!(seen.lock().unwrap().last().unwrap(), "AT+CPMS=\"ME\",\"ME\",\"ME\"");
        assert_eq!(modem.lock().unwrap().mem1, "ME");
    }

    #[test]
    fn undecodable_pdu_is_reported_like_sms_tool() {
        let mut m = Modem::new();
        m.me = vec![(7, "0791".into())];
        let (mut ch, _, _) = spawn(m);
        let (ok, j) = run_op(&mut ch, &["list"]);
        assert!(ok);
        assert!(j.contains("{\"index\":7,\"storage\":\"ME\",\"stat\":1,\"error\":\"error decoding pdu\""), "{j}");
    }

    #[test]
    fn status_reports_each_storage_then_restores() {
        let mut m = Modem::new();
        m.me = vec![(0, V1.into()), (1, V1.into())];
        m.sm = vec![(1, V5.into())];
        let (mut ch, modem, _) = spawn(m);
        let (ok, j) = run_op(&mut ch, &["status"]);
        assert!(ok);
        assert_eq!(
            j,
            "{\"success\":true,\"storages\":[{\"storage\":\"ME\",\"used\":2,\"total\":255},{\"storage\":\"SM\",\"used\":1,\"total\":255}]}\n"
        );
        assert_eq!(modem.lock().unwrap().mem1, "ME");
        let (_, j) = run_op(&mut ch, &["status", "SM"]);
        assert_eq!(j, "{\"success\":true,\"storage\":\"SM\",\"used\":1,\"total\":255}\n");
    }

    #[test]
    fn send_single_part() {
        let (mut ch, modem, seen) = spawn(Modem::new());
        let (ok, j) = run_op(&mut ch, &["send", "12345", "Hi"]);
        assert!(ok, "{j}");
        assert_eq!(j, "{\"success\":true,\"parts\":1,\"refs\":[41]}\n");
        assert_eq!(modem.lock().unwrap().sent, vec!["00110005812143F50000B002C834".to_string()]);
        assert!(seen.lock().unwrap().contains(&"AT+CMGS=13".to_string()));
    }

    #[test]
    fn send_multipart_one_prompt_per_part() {
        let text = "x".repeat(320);
        let (mut ch, modem, seen) = spawn(Modem::new());
        let (ok, j) = run_op(&mut ch, &["send", "491701234567", &text]);
        assert!(ok, "{j}");
        assert_eq!(j, "{\"success\":true,\"parts\":3,\"refs\":[41,42,43]}\n");
        let sent = modem.lock().unwrap().sent.clone();
        assert_eq!(sent.len(), 3);
        for (k, p) in sent.iter().enumerate() {
            assert!(p.starts_with("0051000C91947110325476"), "{p}");
            // UD starts at byte 15: UDH 05 00 03 <ref> <total=3> <part>.
            assert_eq!(&p[30..36], "050003", "{p}");
            assert_eq!(&p[36..38], &sent[0][36..38], "one reference for all parts");
            assert_eq!(&p[38..42], format!("03{:02X}", k + 1), "{p}");
        }
        assert_eq!(seen.lock().unwrap().iter().filter(|c| c.starts_with("AT+CMGS=")).count(), 3);
    }

    #[test]
    fn send_stops_at_the_first_failed_part() {
        let mut m = Modem::new();
        m.cms_on_send = Some(2);
        let (mut ch, modem, _) = spawn(m);
        let (ok, j) = run_op(&mut ch, &["send", "491701234567", &"y".repeat(400)]);
        assert!(!ok);
        assert_eq!(
            j,
            "{\"success\":false,\"error\":\"send_failed\",\"detail\":\"+CMS ERROR: 500\",\"parts\":3,\"sent_parts\":1,\"refs\":[41]}\n"
        );
        assert_eq!(modem.lock().unwrap().sent.len(), 2);
        // The channel is clean for the next caller.
        assert_eq!(ch.exchange("AT", Instant::now() + Duration::from_secs(1)).unwrap(), b"AT\r\r\nOK\r\n");
    }

    #[test]
    fn bad_number_never_reaches_the_modem() {
        let mut ch: Channel<UnixStream> = Channel::new(Box::new(|| panic!("modem opened")));
        let (ok, j) = run_op(&mut ch, &["send", "12a45", "Hi"]);
        assert!(!ok);
        assert_eq!(j, "{\"success\":false,\"error\":\"bad_number\"}\n");
    }

    #[test]
    fn delete_indexes_reports_each_and_restores_me() {
        let mut m = Modem::new();
        m.sm = vec![(1, V1.into()), (2, V1.into())];
        let (mut ch, modem, seen) = spawn(m);
        let (ok, j) = run_op(&mut ch, &["delete", "SM", "1,9,1"]);
        assert!(!ok);
        assert_eq!(
            j,
            "{\"success\":false,\"error\":\"delete_failed\",\"storage\":\"SM\",\"deleted\":[1],\"failed\":[{\"index\":9,\"error\":\"+CMS ERROR: 321\"}]}\n"
        );
        assert_eq!(modem.lock().unwrap().sm.len(), 1);
        assert_eq!(seen.lock().unwrap().last().unwrap(), "AT+CPMS=\"ME\",\"ME\",\"ME\"");
        assert_eq!(modem.lock().unwrap().mem1, "ME");
    }

    #[test]
    fn delete_all_covers_indexes_past_49() {
        for no_delflag in [false, true] {
            let mut m = Modem::new();
            m.me = (0..60).chain([134, 135]).map(|i| (i, V1.to_string())).collect();
            m.no_delflag = no_delflag;
            let (mut ch, modem, _) = spawn(m);
            let (ok, j) = run_op(&mut ch, &["delete", "ME", "all"]);
            assert!(ok, "{j}");
            assert_eq!(j, "{\"success\":true,\"storage\":\"ME\",\"deleted\":62,\"remaining\":0}\n");
            assert!(modem.lock().unwrap().me.is_empty());
        }
    }

    #[test]
    fn args_are_validated() {
        let a = |v: &[&str]| parse_args(&v.iter().map(|s| s.to_string()).collect::<Vec<_>>());
        assert_eq!(a(&["list"]).unwrap(), Op::List(vec![Mem::Me]));
        assert_eq!(a(&["list", "all"]).unwrap(), Op::List(vec![Mem::Me, Mem::Sm]));
        assert_eq!(a(&["status"]).unwrap(), Op::Status(vec![Mem::Me, Mem::Sm]));
        assert!(a(&["list", "XX"]).is_err());
        assert!(a(&["send", "1"]).is_err());
        assert!(a(&["send", "1", ""]).is_err());
        assert!(a(&["delete", "ME", "1,x"]).is_err());
        assert!(a(&["delete", "ME", ""]).is_err());
        assert!(a(&["delete", "XX", "1"]).is_err());
        assert!(a(&["delete", "ME", "70000"]).is_err());
        assert!(a(&[]).is_err());
        assert_eq!(
            a(&["send", "+491", "multi\nline \"text\""]).unwrap(),
            Op::Send { number: "+491".into(), text: "multi\nline \"text\"".into() }
        );
    }

    #[test]
    fn cmgd_test_and_cpms_replies_parse() {
        assert_eq!(parse_cmgd_test(b"AT+CMGD=?\r\r\n+CMGD: (0,1,5-7,134),(0-4)\r\n\r\nOK\r\n").unwrap(), vec![0, 1, 5, 6, 7, 134]);
        assert_eq!(parse_cmgd_test(b"+CMGD: (),(0-4)\r\n").unwrap(), Vec::<u32>::new());
        assert_eq!(
            parse_cpms(b"+CPMS: \"ME\",97,255,\"ME\",97,255,\"ME\",97,255\r\n").unwrap(),
            ("ME".to_string(), 97, 255)
        );
    }
}
