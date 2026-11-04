//! qmi_probe: read-only QMI-over-QRTR probe, ported from the RM551E repo
//! (native/qmi_probe there) and built for armv7. Results: docs/reference/qmi-probe.md.
//!
//! Sends only whitelisted *Get* messages. The one stateful call is NAS
//! Indication Register in `watch`, which is per-client and released when
//! the socket closes; it changes no modem configuration.
//!
//! The one exception is NAS 0x006C Config Signal Info v2, sent only by
//! `siginfo2` and only when `--allow-config` is given (see
//! docs/research/qmi-signal-info-v2.md).
//!
//!   qmi_probe json [sig cell rf ca serving sysinfo ...]   one JSON line
//!   qmi_probe get <svc>:<msg>                             hex dump (whitelisted)
//!   qmi_probe supported                                   0x001E per service
//!   qmi_probe bench <cmd> <n> [hz]                        latency / rate / CPU
//!   qmi_probe watch <secs>                                NAS indications
//!   qmi_probe [--allow-config] siginfo2 <secs> <hz> [live|tt=hex ..]
//!                                                         0x0051 + polled 0x004F
//!   qmi_probe sms list|info|scan|limits|watch             WMS reads (no bodies printed)
//!   qmi_probe --allow-sms-write sms tag|del ..            WMS store writes
//!   qmi_probe --allow-sms-send sms send <num> <text..>    WMS Raw Send

mod decode;
mod qrtr;
mod wms;

use decode::{arr, J};
use qrtr::{Client, Msg, Tlv};
use std::collections::HashMap;
use std::process::exit;
use std::time::{Duration, Instant};

const SVC_WDS: u32 = 1;
const SVC_DMS: u32 = 2;
const SVC_NAS: u32 = 3;
const SVC_UIM: u32 = 11;
const SVC_DSD: u32 = 42;
const SVC_WMS: u32 = 5;
const SVC_LOC: u32 = 16;

/// Services probed with Get Supported Messages (0x001E), read-only.
const DISCOVER: &[u32] = &[1, 2, 3, 4, 5, 7, 9, 11, 12, 16, 17, 22, 24, 26, 29, 36, 42, 47];

/// (service, message) pairs the probe may send. All are Get/query messages.
const WHITELIST: &[(u32, u16)] = &[
    (SVC_NAS, 0x0020), // Get Signal Strength
    (SVC_NAS, 0x0024), // Get Serving System
    (SVC_NAS, 0x0031), // Get RF Band Info
    (SVC_NAS, 0x0034), // Get System Selection Preference
    (SVC_NAS, 0x0043), // Get Cell Location Info
    (SVC_NAS, 0x004D), // Get Sys Info
    (SVC_NAS, 0x004F), // Get Signal Info
    (SVC_NAS, 0x005A), // Get Tx Rx Info
    (SVC_NAS, 0x00AC), // Get LTE CPHY CA Info
    (SVC_DMS, 0x0022), // Get Model
    (SVC_DMS, 0x0023), // Get Revision
    (SVC_DMS, 0x0025), // Get IDs
    (SVC_DMS, 0x002D), // Get Operating Mode
    (SVC_DMS, 0x002F), // Get Time
    (SVC_UIM, 0x002F), // Get Card Status
    (SVC_UIM, 0x0047), // Get Slots Status
    (SVC_WDS, 0x0024), // Get Packet Statistics
    (SVC_WDS, 0x002A), // Get Profile List
    (SVC_WDS, 0x002D), // Get Current Settings
    (SVC_DSD, 0x0024), // Get System Status
    (SVC_WMS, 0x0031), // List Messages
    (SVC_WMS, 0x0022), // Raw Read
    (SVC_WMS, 0x0030), // Get Message Protocol
    (SVC_WMS, 0x0033), // Get Routes
    (SVC_WMS, 0x0034), // Get SMSC Address
    (SVC_WMS, 0x0036), // Get Store Max Size
    (SVC_LOC, 0x0020), // Get Service Revision (LOC)
];

/// Config writes, refused unless `--allow-config` is given.
const CONFIG_WHITELIST: &[(u32, u16)] = &[
    (SVC_NAS, 0x006C), // Config Signal Info v2
    (SVC_WDS, 0x004D), // Set Client IP Family (client-local)
    (SVC_WDS, 0x00A2), // Bind Mux Data Port (client-local)
    (SVC_WDS, 0x00AF), // Bind Subscription (client-local)
];

/// SMS store writes, refused unless `--allow-sms-write`; Raw Send needs `--allow-sms-send`.
const SMS_WRITE: &[(u32, u16)] = &[(SVC_WMS, 0x0023), (SVC_WMS, 0x0024)];
const SMS_SEND: (u32, u16) = (SVC_WMS, 0x0020);

struct Svc {
    clients: HashMap<u32, Client>,
    allow_config: bool,
    allow_sms_write: bool,
    allow_sms_send: bool,
}

impl Svc {
    fn get(&mut self, svc: u32) -> &mut Client {
        if !self.clients.contains_key(&svc) {
            let (node, port) = match qrtr::lookup(svc, Duration::from_millis(500)) {
                Ok(Some(x)) => x,
                Ok(None) => die(&format!("service {} not found", svc)),
                Err(e) => die(&format!("qrtr unavailable: {}", e)),
            };
            let c = Client::connect(node, port, Duration::from_secs(3))
                .unwrap_or_else(|e| die(&format!("socket: {}", e)));
            self.clients.insert(svc, c);
        }
        self.clients.get_mut(&svc).unwrap()
    }

    fn call(&mut self, svc: u32, id: u16, tlvs: &[Tlv]) -> Result<(Msg, Duration), String> {
        let config = CONFIG_WHITELIST.contains(&(svc, id));
        let discover = id == 0x001E && DISCOVER.contains(&svc);
        let sms_w = SMS_WRITE.contains(&(svc, id)) && self.allow_sms_write;
        let sms_s = (svc, id) == SMS_SEND && self.allow_sms_send;
        if !discover && !WHITELIST.contains(&(svc, id)) && !(config && self.allow_config) && !sms_w && !sms_s {
            let why = if config { "config write, needs --allow-config" } else { "not whitelisted" };
            return Err(format!("refused {}:{:#06x} ({})", svc, id, why));
        }
        self.get(svc).request(id, tlvs).map_err(|e| e.to_string())
    }
}

fn die(msg: &str) -> ! {
    eprintln!("qmi_probe: {}", msg);
    exit(1)
}

fn tlv(t: u8, v: &[u8]) -> Tlv {
    Tlv { t, v: v.to_vec() }
}

/// Named command → (service, message, request TLVs, decoder).
fn named(cmd: &str) -> Option<(u32, u16, Vec<Tlv>, fn(&Msg) -> String)> {
    Some(match cmd {
        "sig" => (SVC_NAS, 0x004F, vec![], decode::sig),
        "cell" => (SVC_NAS, 0x0043, vec![], decode::cell),
        "rf" => (SVC_NAS, 0x0031, vec![], decode::rf),
        "ca" => (SVC_NAS, 0x00AC, vec![], decode::ca),
        "serving" => (SVC_NAS, 0x0024, vec![], decode::serving),
        "sysinfo" => (SVC_NAS, 0x004D, vec![], decode::dump),
        "syssel" => (SVC_NAS, 0x0034, vec![], decode::dump),
        "txrx-lte" => (SVC_NAS, 0x005A, vec![tlv(0x01, &[0x08])], decode::dump),
        "txrx-nr" => (SVC_NAS, 0x005A, vec![tlv(0x01, &[0x0c])], decode::dump),
        "ids" => (SVC_DMS, 0x0025, vec![], decode::strings),
        "rev" => (SVC_DMS, 0x0023, vec![], decode::strings),
        "model" => (SVC_DMS, 0x0022, vec![], decode::strings),
        "opmode" => (SVC_DMS, 0x002D, vec![], decode::dump),
        "time" => (SVC_DMS, 0x002F, vec![], decode::dump),
        "card" => (SVC_UIM, 0x002F, vec![], decode::card),
        "slots" => (SVC_UIM, 0x0047, vec![], decode::dump),
        // Mask: tx/rx packets, errors, drops, bytes (bits 0-7).
        "wds-stats" => (SVC_WDS, 0x0024, vec![tlv(0x01, &0x0000_00ffu32.to_le_bytes())], decode::dump),
        "wds-profiles" => (SVC_WDS, 0x002A, vec![tlv(0x10, &[0x00])], decode::dump),
        // Mask: profile, APN, IP family, DNS, address, gateway, MTU.
        "wds-current" => (SVC_WDS, 0x002D, vec![tlv(0x10, &0x0000_ffffu32.to_le_bytes())], decode::dump),
        "dsd-status" => (SVC_DSD, 0x0024, vec![], decode::dump),
        _ => return None,
    })
}

fn mono_ms() -> u128 {
    let mut ts = libc::timespec { tv_sec: 0, tv_nsec: 0 };
    unsafe { libc::clock_gettime(libc::CLOCK_MONOTONIC, &mut ts) };
    ts.tv_sec as u128 * 1000 + ts.tv_nsec as u128 / 1_000_000
}

fn ms(d: Duration) -> f64 {
    d.as_micros() as f64 / 1000.0
}

/// utime+stime of this process in ms (USER_HZ = 100 on this kernel).
fn cpu_ms() -> u64 {
    let s = std::fs::read_to_string("/proc/self/stat").unwrap_or_default();
    let rest = s.rsplit(") ").next().unwrap_or("");
    let f: Vec<&str> = rest.split_whitespace().collect();
    let t = |i: usize| f.get(i).and_then(|x| x.parse::<u64>().ok()).unwrap_or(0);
    (t(11) + t(12)) * 10
}

fn run_one(s: &mut Svc, cmd: &str) -> String {
    let (svc, id, tlvs, dec) = match named(cmd) {
        Some(x) => x,
        None => return format!("{{\"error\":\"unknown command {}\"}}", cmd),
    };
    match s.call(svc, id, &tlvs) {
        Err(e) => {
            let mut j = J::obj();
            j.str("error", &e);
            j.done()
        }
        Ok((m, rtt)) => {
            let body = dec(&m);
            let mut j = J::obj();
            j.f1("rtt_ms", ms(rtt));
            match m.result() {
                Ok(()) => j.str("result", "ok"),
                Err(ec) => j.str("result", &format!("err_{:#06x}", ec)),
            };
            j.raw("data", &body);
            j.done()
        }
    }
}

fn cmd_json(s: &mut Svc, cmds: &[String]) {
    let defaults = ["serving", "sig", "cell", "rf", "ca"];
    let list: Vec<String> = if cmds.is_empty() {
        defaults.iter().map(|x| x.to_string()).collect()
    } else {
        cmds.to_vec()
    };
    let t0 = Instant::now();
    let mut j = J::obj();
    j.num("mono_ms", mono_ms());
    for c in &list {
        let r = run_one(s, c);
        j.raw(c, &r);
    }
    j.f1("total_ms", ms(t0.elapsed()));
    println!("{}", j.done());
}

fn parse_svcmsg(a: &str) -> Option<(u32, u16)> {
    let (sv, mg) = a.split_once(':')?;
    let svc = sv.parse().ok()?;
    let msg = u16::from_str_radix(mg.trim_start_matches("0x"), 16).ok()?;
    Some((svc, msg))
}

fn cmd_bench(s: &mut Svc, cmd: &str, n: usize, hz: f64) {
    let (svc, id, tlvs, dec) = named(cmd).unwrap_or_else(|| die("unknown command"));
    let period = if hz > 0.0 { Duration::from_secs_f64(1.0 / hz) } else { Duration::ZERO };
    let mut rtts = Vec::with_capacity(n);
    let (mut fails, mut changes) = (0usize, 0usize);
    let mut last = String::new();
    let c0 = cpu_ms();
    let t0 = Instant::now();
    for i in 0..n {
        let tick = t0 + period * i as u32;
        let now = Instant::now();
        if tick > now {
            std::thread::sleep(tick - now);
        }
        match s.call(svc, id, &tlvs) {
            Ok((m, rtt)) if m.result().is_ok() => {
                rtts.push(rtt);
                let body = dec(&m);
                if body != last {
                    changes += 1;
                    last = body;
                }
            }
            _ => fails += 1,
        }
    }
    let wall = t0.elapsed();
    let cpu = cpu_ms() - c0;
    rtts.sort();
    let pct = |p: f64| rtts.get(((rtts.len() as f64 - 1.0) * p) as usize).map(|d| ms(*d)).unwrap_or(0.0);
    let mut j = J::obj();
    j.str("cmd", cmd)
        .num("n", n)
        .f1("hz", hz)
        .num("ok", rtts.len())
        .num("fail", fails)
        .num("distinct_values", changes)
        .f1("p50_ms", pct(0.5))
        .f1("p95_ms", pct(0.95))
        .f1("max_ms", pct(1.0))
        .f1("wall_ms", ms(wall))
        .num("cpu_ms", cpu)
        .f1("cpu_pct", if wall.as_millis() > 0 { cpu as f64 * 100.0 / wall.as_millis() as f64 } else { 0.0 });
    println!("{}", j.done());
    if cmd == "sig" || cmd == "cell" {
        println!("{}", last);
    }
}

fn cmd_watch(s: &mut Svc, secs: u64) {
    // NAS Indication Register: serving system (0x13), sys info (0x18),
    // signal info (0x19). Per-client; released on close.
    let req = [tlv(0x13, &[1]), tlv(0x18, &[1]), tlv(0x19, &[1])];
    let c = s.get(SVC_NAS);
    match c.request(0x0003, &req) {
        Ok((m, _)) => {
            if let Err(ec) = m.result() {
                die(&format!("indication register failed: {:#06x}", ec));
            }
        }
        Err(e) => die(&format!("indication register: {}", e)),
    }
    eprintln!("watching NAS indications for {} s", secs);
    let end = Instant::now() + Duration::from_secs(secs);
    let mut counts: HashMap<u16, usize> = HashMap::new();
    while Instant::now() < end {
        let left = end.saturating_duration_since(Instant::now());
        c.set_timeout(left.max(Duration::from_millis(10)));
        let m = match c.next_indication() {
            Ok(m) => m,
            Err(_) => break,
        };
        *counts.entry(m.id).or_default() += 1;
        let body = match m.id {
            0x0051 => decode::sig(&m),
            0x0024 => decode::serving(&m),
            _ => decode::dump(&m),
        };
        println!("{{\"mono_ms\":{},\"ind\":\"{:#06x}\",\"data\":{}}}", mono_ms(), m.id, body);
    }
    let items: Vec<String> = counts.iter().map(|(k, v)| format!("\"{:#06x}\":{}", k, v)).collect();
    println!("{{\"summary\":{{{}}}}}", items.join(","));
}

/// Config Signal Info v2 preset: 1 dB deltas (units of 0.1 dB) for LTE
/// RSSI/SNR/RSRQ/RSRP and NR5G SNR/RSRP/RSRQ, LTE and NR5G report config
/// {rate 1 s, averaging 1 s}.
fn siginfo2_live() -> Vec<Tlv> {
    let d = 10u16.to_le_bytes();
    vec![
        tlv(0x23, &d), // LTE RSSI delta
        tlv(0x25, &d), // LTE SNR delta
        tlv(0x27, &d), // LTE RSRQ delta
        tlv(0x29, &d), // LTE RSRP delta
        tlv(0x2A, &[1, 1]), // LTE report: rate, average period
        tlv(0x34, &d), // NR5G SNR delta
        tlv(0x36, &d), // NR5G RSRP delta
        tlv(0x37, &[1, 1]), // NR5G report: rate, average period
        tlv(0x39, &d), // NR5G RSRQ delta
    ]
}

fn parse_tlv_args(args: &[String]) -> Vec<Tlv> {
    let mut req = Vec::new();
    for a in args {
        let (t, h) = a.split_once('=').unwrap_or_else(|| die("bad tlv arg"));
        let t = u8::from_str_radix(t, 16).unwrap_or_else(|_| die("bad tlv type"));
        let v: Vec<u8> = (0..h.len() / 2)
            .map(|i| u8::from_str_radix(&h[2 * i..2 * i + 2], 16).unwrap_or_else(|_| die("bad hex")))
            .collect();
        req.push(tlv(t, &v));
    }
    req
}

fn emit_ind(m: &Msg, n: &mut usize, ch: &mut usize, last: &mut String) {
    let body = decode::sig(m);
    *n += 1;
    if body != *last {
        *ch += 1;
        *last = body.clone();
    }
    println!("{{\"mono_ms\":{},\"ind\":\"{:#06x}\",\"data\":{}}}", mono_ms(), m.id, body);
}

/// Optionally apply Config Signal Info v2 on this process's NAS client,
/// register for Signal Info indications, then for `secs` print every 0x0051
/// indication and poll 0x004F at `hz` (0 = no polling), one NDJSON line each.
fn cmd_siginfo2(s: &mut Svc, secs: u64, hz: f64, cfg: Option<Vec<Tlv>>) {
    if let Some(t) = cfg {
        match s.call(SVC_NAS, 0x006C, &t) {
            Ok((m, rtt)) => {
                let r = match m.result() {
                    Ok(()) => "ok".to_string(),
                    Err(ec) => format!("err_{:#06x}", ec),
                };
                println!("{{\"mono_ms\":{},\"config\":\"{}\",\"rtt_ms\":{:.2}}}", mono_ms(), r, ms(rtt));
            }
            Err(e) => die(&e),
        }
    }
    let c = s.get(SVC_NAS);
    match c.request(0x0003, &[tlv(0x19, &[1])]) {
        Ok((m, _)) if m.result().is_ok() => {}
        Ok((m, _)) => die(&format!("indication register failed: {:?}", m.result())),
        Err(e) => die(&format!("indication register: {}", e)),
    }
    let period = if hz > 0.0 { Some(Duration::from_secs_f64(1.0 / hz)) } else { None };
    let (mut n_ind, mut n_poll, mut ch_ind, mut ch_poll) = (0usize, 0usize, 0usize, 0usize);
    let (mut last_ind, mut last_poll) = (String::new(), String::new());
    let c0 = cpu_ms();
    let t0 = Instant::now();
    let end = t0 + Duration::from_secs(secs);
    let mut k = 1u32;
    let mut stop = false;
    while !stop && Instant::now() < end {
        let tick = match period {
            Some(p) => (t0 + p * k).min(end),
            None => end,
        };
        // Drain indications until the next poll tick.
        loop {
            let now = Instant::now();
            if now >= tick {
                break;
            }
            c.set_timeout((tick - now).max(Duration::from_millis(1)));
            match c.next_indication() {
                Ok(m) if m.id == 0x0051 => emit_ind(&m, &mut n_ind, &mut ch_ind, &mut last_ind),
                Ok(_) => {}
                Err(e) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => break,
                Err(e) => {
                    println!("{{\"mono_ms\":{},\"error\":\"{}\"}}", mono_ms(), e);
                    stop = true;
                    break;
                }
            }
        }
        if stop || period.is_none() || Instant::now() >= end {
            continue;
        }
        k += 1;
        c.set_timeout(Duration::from_secs(3));
        let mut pending = Vec::new();
        match c.request_with(0x004F, &[], &mut |m| pending.push(m)) {
            Ok((m, rtt)) => {
                let body = decode::sig(&m);
                n_poll += 1;
                if body != last_poll {
                    ch_poll += 1;
                    last_poll = body.clone();
                }
                println!("{{\"mono_ms\":{},\"poll\":{:.2},\"data\":{}}}", mono_ms(), ms(rtt), body);
            }
            Err(e) => {
                println!("{{\"mono_ms\":{},\"error\":\"{}\"}}", mono_ms(), e);
                break;
            }
        }
        for m in pending.iter().filter(|m| m.id == 0x0051) {
            emit_ind(m, &mut n_ind, &mut ch_ind, &mut last_ind);
        }
    }
    let wall = t0.elapsed();
    let mut j = J::obj();
    j.f1("wall_s", wall.as_secs_f64())
        .num("ind", n_ind)
        .num("ind_changes", ch_ind)
        .num("poll", n_poll)
        .num("poll_changes", ch_poll)
        .num("cpu_ms", cpu_ms() - c0);
    println!("{{\"summary\":{}}}", j.done());
}

/// Bind this process's WDS client to the rmnet_ipa (embedded, EPID 1) mux
/// `mux`, optionally set the client IP family, then read Packet Statistics
/// `n` times, `gap` seconds apart. Binds are client-local; released on close.
fn cmd_wds_bound(s: &mut Svc, mux: u8, fam: u8, n: u32, gap: u64) {
    let mut ep = Vec::new();
    ep.extend_from_slice(&4u32.to_le_bytes());
    ep.extend_from_slice(&1u32.to_le_bytes());
    let mut steps: Vec<(&str, u16, Vec<Tlv>)> = vec![
        ("bind_mux", 0x00A2, vec![tlv(0x10, &ep), tlv(0x11, &[mux])]),
        ("bind_subs", 0x00AF, vec![tlv(0x01, &1u32.to_le_bytes())]),
    ];
    if fam != 0 {
        steps.push(("ip_family", 0x004D, vec![tlv(0x01, &[fam])]));
    }
    for (name, id, t) in steps {
        match s.call(SVC_WDS, id, &t) {
            Ok((m, _)) => println!("{{\"{}\":\"{}\"}}", name, match m.result() {
                Ok(()) => "ok".to_string(),
                Err(ec) => format!("err_{:#06x}", ec),
            }),
            Err(e) => die(&e),
        }
    }
    for i in 0..n {
        if i > 0 {
            std::thread::sleep(Duration::from_secs(gap));
        }
        match s.call(SVC_WDS, 0x002D, &[tlv(0x10, &0x0000_ffffu32.to_le_bytes())]) {
            Ok((m, _)) => {
                let tl: Vec<String> = m.tlvs.iter().map(|t| format!("{{\"t\":\"{:02x}\",\"hex\":\"{}\"}}", t.t, decode::hex(&t.v))).collect();
                println!("{{\"current\":{}}}", arr(&tl));
            }
            Err(e) => die(&e),
        }
        // Mask: tx/rx packets, tx/rx bytes, tx/rx drops (QCMAP's 0x3C3).
        match s.call(SVC_WDS, 0x0024, &[tlv(0x01, &0x0000_03c3u32.to_le_bytes())]) {
            Ok((m, rtt)) => {
                let tl: Vec<String> = m.tlvs.iter().map(|t| format!("{{\"t\":\"{:02x}\",\"hex\":\"{}\"}}", t.t, decode::hex(&t.v))).collect();
                println!("{{\"mono_ms\":{},\"rtt_ms\":{:.2},\"tlvs\":{}}}", mono_ms(), ms(rtt), arr(&tl));
            }
            Err(e) => die(&e),
        }
    }
}

fn main() {
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    let allow_config = args.iter().any(|a| a == "--allow-config");
    let allow_sms_write = args.iter().any(|a| a == "--allow-sms-write");
    let allow_sms_send = args.iter().any(|a| a == "--allow-sms-send");
    args.retain(|a| !matches!(a.as_str(), "--allow-config" | "--allow-sms-write" | "--allow-sms-send"));
    let mut s = Svc { clients: HashMap::new(), allow_config, allow_sms_write, allow_sms_send };
    match args.first().map(|x| x.as_str()) {
        Some("json") => cmd_json(&mut s, &args[1..]),
        Some("get") => {
            let (svc, id) = args.get(1).and_then(|a| parse_svcmsg(a)).unwrap_or_else(|| die("usage: get <svc>:<msg> [tt=hex ..]"));
            // Optional request TLVs as tt=hexbytes, e.g. 01=08000000.
            let req = parse_tlv_args(&args[2..]);
            match s.call(svc, id, &req) {
                Ok((m, rtt)) => {
                    let tl: Vec<String> = m.tlvs.iter().map(|t| format!("{{\"t\":\"{:02x}\",\"hex\":\"{}\"}}", t.t, decode::hex(&t.v))).collect();
                    println!("{{\"rtt_ms\":{:.2},\"tlvs\":{}}}", ms(rtt), arr(&tl));
                }
                Err(e) => die(&e),
            }
        }
        Some("supported") => {
            for &svc in DISCOVER {
                if !matches!(qrtr::lookup(svc, Duration::from_millis(500)), Ok(Some(_))) {
                    println!("{{\"svc\":{},\"error\":\"not published\"}}", svc);
                    continue;
                }
                match s.call(svc, 0x001E, &[]) {
                    Ok((m, _)) => {
                        let mut ids = Vec::new();
                        if let Some(v) = m.tlv(0x10) {
                            for (i, b) in v.iter().skip(2).enumerate() {
                                for bit in 0..8 {
                                    if b & (1 << bit) != 0 {
                                        ids.push(format!("\"{:#06x}\"", i * 8 + bit));
                                    }
                                }
                            }
                        }
                        let r = match m.result() { Ok(()) => "ok".to_string(), Err(ec) => format!("err_{:#06x}", ec) };
                        println!("{{\"svc\":{},\"result\":\"{}\",\"msgs\":[{}]}}", svc, r, ids.join(","));
                    }
                    Err(e) => println!("{{\"svc\":{},\"error\":\"{}\"}}", svc, e),
                }
            }
        }
        Some("bench") => {
            let cmd = args.get(1).map(|x| x.as_str()).unwrap_or("sig");
            let n = args.get(2).and_then(|x| x.parse().ok()).unwrap_or(100);
            let hz = args.get(3).and_then(|x| x.parse().ok()).unwrap_or(0.0);
            cmd_bench(&mut s, cmd, n, hz);
        }
        Some("watch") => {
            let secs = args.get(1).and_then(|x| x.parse().ok()).unwrap_or(30);
            cmd_watch(&mut s, secs);
        }
        Some("siginfo2") => {
            let secs = args.get(1).and_then(|x| x.parse().ok()).unwrap_or(60);
            let hz = args.get(2).and_then(|x| x.parse().ok()).unwrap_or(0.0);
            let cfg = match args.get(3).map(|x| x.as_str()) {
                None => None,
                Some("live") => Some(siginfo2_live()),
                Some(_) => Some(parse_tlv_args(&args[3..])),
            };
            cmd_siginfo2(&mut s, secs, hz, cfg);
        }
        Some("sms") => wms::cmd_sms(&mut s, &args[1..]),
        Some("wds-bound") if s.allow_config => {
            let mux = args.get(1).and_then(|x| x.parse().ok()).unwrap_or(1);
            let fam = args.get(2).and_then(|x| x.parse().ok()).unwrap_or(0);
            let n = args.get(3).and_then(|x| x.parse().ok()).unwrap_or(1);
            let gap = args.get(4).and_then(|x| x.parse().ok()).unwrap_or(1);
            cmd_wds_bound(&mut s, mux, fam, n, gap);
        }
        _ => {
            eprintln!("usage: qmi_probe json [cmd..] | get <svc>:<msg> | bench <cmd> <n> [hz] | watch <secs> | [--allow-config] siginfo2 <secs> <hz> [live|tt=hex ..]");
            exit(2);
        }
    }
}
