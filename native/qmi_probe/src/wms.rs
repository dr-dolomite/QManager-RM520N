//! WMS (SMS) probe commands for T5.0. Bodies are never printed; senders are masked.
//! PDUs go through the broker's own codec so T5.1 is proved with the code it ships.

#[allow(dead_code)]
#[path = "../../qmanager_atd/src/sms/pdu.rs"]
mod pdu;

use crate::decode::{arr, hex, J};
use crate::qrtr::Msg;
use crate::{die, mono_ms, ms, tlv, Svc, SVC_WMS};
use std::time::{Duration, Instant};

/// QMI WMS message format: GSM/WCDMA point-to-point.
const FMT_GW_PP: u8 = 6;

fn storage(a: Option<&String>) -> u8 {
    match a.map(|s| s.as_str()) {
        Some("sm") | Some("uim") => 0,
        Some("me") | Some("nv") | None => 1,
        _ => die("storage must be me|sm"),
    }
}

fn res(m: &Msg) -> String {
    match m.result() {
        Ok(()) => "ok".into(),
        Err(ec) => format!("err_{:#06x}", ec),
    }
}

fn u32le(b: &[u8], o: usize) -> u32 {
    u32::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]])
}

fn mask(num: &str) -> String {
    let n = num.chars().count();
    let tail: String = num.chars().skip(n.saturating_sub(2)).collect();
    format!("{}digits..{}", n, tail)
}

/// 0x0031 → (index, tag) pairs.
fn list(s: &mut Svc, st: u8, tag: Option<u8>) -> Result<(Vec<(u32, u8)>, Duration), String> {
    let mut req = vec![tlv(0x01, &[st]), tlv(0x11, &[1])];
    if let Some(t) = tag {
        req.push(tlv(0x10, &[t]));
    }
    let (m, rtt) = s.call(SVC_WMS, 0x0031, &req)?;
    if let Err(ec) = m.result() {
        // 0x0031 with an empty filtered set answers an error on some firmware.
        return Err(format!("err_{:#06x}", ec));
    }
    let v = m.tlv(0x01).unwrap_or(&[]);
    let mut out = Vec::new();
    if v.len() >= 4 {
        let n = u32le(v, 0) as usize;
        for i in 0..n {
            let o = 4 + i * 5;
            if o + 5 > v.len() {
                break;
            }
            out.push((u32le(v, o), v[o + 4]));
        }
    }
    Ok((out, rtt))
}

/// One message's metadata as JSON (no body).
fn meta(s: &mut Svc, st: u8, idx: u32) -> (String, Option<pdu::Concat>, Duration) {
    let mut req = Vec::with_capacity(5);
    req.push(st);
    req.extend_from_slice(&idx.to_le_bytes());
    let (m, rtt) = match s.call(SVC_WMS, 0x0022, &[tlv(0x01, &req), tlv(0x10, &[1])]) {
        Ok(x) => x,
        Err(e) => return (format!("{{\"idx\":{},\"error\":\"{}\"}}", idx, e), None, Duration::ZERO),
    };
    let mut j = J::obj();
    j.num("idx", idx).f1("rtt_ms", ms(rtt)).str("result", &res(&m));
    let mut concat = None;
    if let Some(v) = m.tlv(0x01) {
        if v.len() >= 4 {
            let raw = &v[4..];
            j.num("tag", v[0]).num("format", v[1]).num("len", raw.len());
            // SMSC length octet first, as AT+CMGL PDU mode; MTI of the TPDU after it.
            let s_len = raw.first().copied().unwrap_or(0) as usize;
            j.num("smsc_len", s_len);
            if let Some(fo) = raw.get(1 + s_len) {
                j.num("mti", fo & 3).num("udhi", (fo >> 6) & 1);
            }
            match pdu::decode_deliver(raw) {
                Ok(d) => {
                    j.str("sender", &mask(&d.sender))
                        .str("ts", &d.timestamp)
                        .str("enc", d.encoding.as_str())
                        .num("chars", d.content.chars().count());
                    if let Some(c) = d.concat {
                        j.raw("concat", &format!("{{\"ref\":{},\"part\":{},\"total\":{}}}", c.reference, c.part, c.total));
                        concat = Some(c);
                    }
                }
                Err(e) => {
                    j.str("decode", &format!("{:?}", e));
                }
            }
        }
    }
    (j.done(), concat, rtt)
}

pub fn cmd_sms(s: &mut Svc, a: &[String]) {
    match a.first().map(|x| x.as_str()) {
        Some("list") => {
            let st = storage(a.get(1));
            let tag = a.get(2).and_then(|x| x.parse().ok());
            match list(s, st, tag) {
                Ok((l, rtt)) => {
                    let mut by = [0usize; 4];
                    for &(_, t) in &l {
                        if (t as usize) < 4 {
                            by[t as usize] += 1;
                        }
                    }
                    let idx: Vec<String> = l.iter().map(|(i, t)| format!("[{},{}]", i, t)).collect();
                    println!(
                        "{{\"storage\":{},\"rtt_ms\":{:.2},\"count\":{},\"by_tag\":[{},{},{},{}],\"items\":{}}}",
                        st, ms(rtt), l.len(), by[0], by[1], by[2], by[3], arr(&idx)
                    );
                }
                Err(e) => println!("{{\"storage\":{},\"error\":\"{}\"}}", st, e),
            }
        }
        Some("info") => {
            let st = storage(a.get(1));
            let idx = a.get(2).and_then(|x| x.parse().ok()).unwrap_or_else(|| die("usage: sms info me|sm <idx>"));
            println!("{}", meta(s, st, idx).0);
        }
        // List, then read every message: per-message metadata, concat groups, timing.
        Some("scan") => {
            let st = storage(a.get(1));
            let quiet = a.get(2).map(|x| x == "quiet").unwrap_or(false);
            let t0 = Instant::now();
            let c0 = crate::cpu_ms();
            let (l, _) = list(s, st, None).unwrap_or_else(|e| die(&e));
            let (mut groups, mut singles, mut fails) = (std::collections::BTreeMap::new(), 0usize, 0usize);
            let mut rtts = Vec::new();
            for &(i, _) in &l {
                let (line, c, rtt) = meta(s, st, i);
                if line.contains("\"error\"") || line.contains("\"decode\"") {
                    fails += 1;
                }
                rtts.push(rtt);
                match c {
                    Some(c) => groups.entry(c.reference).or_insert_with(Vec::new).push((c.part, c.total)),
                    None => singles += 1,
                }
                if !quiet {
                    println!("{}", line);
                }
            }
            rtts.sort();
            let complete = groups.values().filter(|v| v.first().map(|x| x.1 as usize == v.len()).unwrap_or(false)).count();
            let p = |q: f64| rtts.get(((rtts.len().max(1) - 1) as f64 * q) as usize).map(|d| ms(*d)).unwrap_or(0.0);
            println!(
                "{{\"summary\":{{\"count\":{},\"singles\":{},\"concat_groups\":{},\"complete_groups\":{},\"not_deliver_or_fail\":{},\"read_p50_ms\":{:.2},\"read_max_ms\":{:.2},\"wall_ms\":{:.1},\"cpu_ms\":{}}}}}",
                l.len(), singles, groups.len(), complete, fails, p(0.5), p(1.0), ms(t0.elapsed()), crate::cpu_ms() - c0
            );
        }
        Some("limits") => {
            for st in [1u8, 0u8] {
                match s.call(SVC_WMS, 0x0036, &[tlv(0x01, &[st]), tlv(0x10, &[1])]) {
                    Ok((m, _)) => {
                        let max = m.tlv(0x01).filter(|v| v.len() >= 4).map(|v| u32le(v, 0));
                        let free = m.tlv(0x10).filter(|v| v.len() >= 4).map(|v| u32le(v, 0));
                        let n = |x: Option<u32>| x.map(|v| v.to_string()).unwrap_or_else(|| "null".into());
                        println!("{{\"storage\":{},\"result\":\"{}\",\"max\":{},\"free\":{}}}", st, res(&m), n(max), n(free));
                    }
                    Err(e) => println!("{{\"storage\":{},\"error\":\"{}\"}}", st, e),
                }
            }
            for (name, id) in [("protocol", 0x0030u16), ("routes", 0x0033), ("smsc", 0x0034)] {
                match s.call(SVC_WMS, id, &[]) {
                    Ok((m, _)) => {
                        let tl: Vec<String> = m.tlvs.iter().map(|t| format!("{{\"t\":\"{:02x}\",\"hex\":\"{}\"}}", t.t, hex(&t.v))).collect();
                        println!("{{\"{}\":\"{}\",\"tlvs\":{}}}", name, res(&m), arr(&tl));
                    }
                    Err(e) => println!("{{\"{}\":\"{}\"}}", name, e),
                }
            }
        }
        // Modify Tag: 0 read, 1 unread (MT); 2 sent, 3 not sent (MO).
        Some("tag") => {
            let st = storage(a.get(1));
            let idx: u32 = a.get(2).and_then(|x| x.parse().ok()).unwrap_or_else(|| die("usage: sms tag me|sm <idx> <tag>"));
            let tag: u8 = a.get(3).and_then(|x| x.parse().ok()).unwrap_or_else(|| die("usage: sms tag me|sm <idx> <tag>"));
            let mut v = vec![st];
            v.extend_from_slice(&idx.to_le_bytes());
            v.push(tag);
            match s.call(SVC_WMS, 0x0023, &[tlv(0x01, &v), tlv(0x10, &[1])]) {
                Ok((m, rtt)) => println!("{{\"tag\":\"{}\",\"rtt_ms\":{:.2}}}", res(&m), ms(rtt)),
                Err(e) => die(&e),
            }
        }
        // Delete by index (idx=N) or by tag (tag=N); mode GW.
        Some("del") => {
            let st = storage(a.get(1));
            let mut req = vec![tlv(0x01, &[st]), tlv(0x12, &[1])];
            match a.get(2).and_then(|x| x.split_once('=')) {
                Some(("idx", n)) => req.push(tlv(0x10, &n.parse::<u32>().unwrap_or_else(|_| die("bad idx")).to_le_bytes())),
                Some(("tag", n)) => req.push(tlv(0x11, &[n.parse::<u8>().unwrap_or_else(|_| die("bad tag"))])),
                _ => die("usage: sms del me|sm idx=N|tag=N"),
            }
            match s.call(SVC_WMS, 0x0024, &req) {
                Ok((m, rtt)) => println!("{{\"del\":\"{}\",\"rtt_ms\":{:.2}}}", res(&m), ms(rtt)),
                Err(e) => die(&e),
            }
        }
        // Raw Send each part; `nosmsc` drops the SMSC octet, `dry` prints PDUs without sending.
        Some("send") => {
            let nosmsc = a.iter().any(|x| x == "nosmsc");
            let dry = a.iter().any(|x| x == "dry");
            let rest: Vec<&String> = a[1..].iter().filter(|x| *x != "nosmsc" && *x != "dry").collect();
            let num = rest.first().unwrap_or_else(|| die("usage: sms send <number> <text..>"));
            let text = rest[1..].iter().map(|x| x.as_str()).collect::<Vec<_>>().join(" ");
            let cref = (mono_ms() & 0xff) as u8;
            let parts = pdu::encode_submit(num, &text, cref).unwrap_or_else(|e| die(&format!("encode: {:?}", e)));
            println!("{{\"parts\":{},\"ref\":{},\"chars\":{}}}", parts.len(), cref, text.chars().count());
            for (i, p) in parts.iter().enumerate() {
                let mut raw = pdu::from_hex(&p.hex).unwrap_or_else(|| die("hex"));
                if nosmsc {
                    raw.remove(0);
                }
                if dry {
                    println!("{{\"part\":{},\"pdu\":\"{}\"}}", i + 1, hex(&raw));
                    continue;
                }
                let mut v = vec![FMT_GW_PP];
                v.extend_from_slice(&(raw.len() as u16).to_le_bytes());
                v.extend_from_slice(&raw);
                s.get(SVC_WMS).set_timeout(Duration::from_secs(60));
                match s.call(SVC_WMS, 0x0020, &[tlv(0x01, &v)]) {
                    Ok((m, rtt)) => {
                        let tl: Vec<String> = m.tlvs.iter().filter(|t| t.t != 0x02).map(|t| format!("{{\"t\":\"{:02x}\",\"hex\":\"{}\"}}", t.t, hex(&t.v))).collect();
                        println!("{{\"part\":{},\"result\":\"{}\",\"rtt_ms\":{:.1},\"tlvs\":{}}}", i + 1, res(&m), ms(rtt), arr(&tl));
                    }
                    Err(e) => println!("{{\"part\":{},\"error\":\"{}\"}}", i + 1, e),
                }
            }
        }
        // Set Event Report (new MT message), then print each Event Report indication.
        Some("watch") => {
            let secs: u64 = a.get(1).and_then(|x| x.parse().ok()).unwrap_or(60);
            let st_meta = a.iter().any(|x| x == "meta");
            let c = s.get(SVC_WMS);
            match c.request(0x0001, &[tlv(0x10, &[1])]) {
                Ok((m, _)) if m.result().is_ok() => {}
                Ok((m, _)) => die(&format!("set event report: {}", res(&m))),
                Err(e) => die(&format!("set event report: {}", e)),
            }
            println!("{{\"mono_ms\":{},\"watching_s\":{}}}", mono_ms(), secs);
            let end = Instant::now() + Duration::from_secs(secs);
            let mut seen = Vec::new();
            while Instant::now() < end {
                let left = end.saturating_duration_since(Instant::now());
                let c = s.get(SVC_WMS);
                c.set_timeout(left.max(Duration::from_millis(10)));
                let m = match c.next_indication() {
                    Ok(m) => m,
                    Err(_) => break,
                };
                let mut j = J::obj();
                j.num("mono_ms", mono_ms()).str("ind", &format!("{:#06x}", m.id));
                if let Some(v) = m.tlv(0x10).filter(|v| v.len() >= 5) {
                    j.num("storage", v[0]).num("idx", u32le(v, 1));
                    seen.push((v[0], u32le(v, 1)));
                }
                if let Some(v) = m.tlv(0x11) {
                    j.num("transfer_route_len", v.len());
                }
                if let Some(v) = m.tlv(0x12) {
                    j.num("mode", v.first().copied().unwrap_or(0));
                }
                let other: Vec<String> = m.tlvs.iter().filter(|t| !matches!(t.t, 0x10 | 0x11 | 0x12)).map(|t| format!("\"{:02x}\"", t.t)).collect();
                j.raw("other_tlvs", &arr(&other));
                println!("{}", j.done());
            }
            if st_meta {
                s.get(SVC_WMS).set_timeout(Duration::from_secs(3));
                for (st, i) in seen {
                    println!("{}", meta(s, st, i).0);
                }
            }
        }
        _ => die("usage: sms list|info|scan|limits|watch|tag|del|send"),
    }
}

