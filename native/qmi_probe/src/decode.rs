//! TLV decoders for the read-only messages the probe sends, emitting JSON.
//! Unknown TLVs are kept as hex under "raw" so Phase 0 can map them.

use crate::qrtr::Msg;

pub struct J(String, bool);

impl J {
    pub fn obj() -> J {
        J(String::from("{"), true)
    }
    fn key(&mut self, k: &str) {
        if !self.1 {
            self.0.push(',');
        }
        self.1 = false;
        self.0.push('"');
        self.0.push_str(k);
        self.0.push_str("\":");
    }
    pub fn num<T: std::fmt::Display>(&mut self, k: &str, v: T) -> &mut J {
        self.key(k);
        self.0.push_str(&v.to_string());
        self
    }
    pub fn f1(&mut self, k: &str, v: f64) -> &mut J {
        self.key(k);
        self.0.push_str(&format!("{:.1}", v));
        self
    }
    pub fn null(&mut self, k: &str) -> &mut J {
        self.key(k);
        self.0.push_str("null");
        self
    }
    pub fn str(&mut self, k: &str, v: &str) -> &mut J {
        self.key(k);
        self.0.push('"');
        for c in v.chars() {
            match c {
                '"' => self.0.push_str("\\\""),
                '\\' => self.0.push_str("\\\\"),
                c if (c as u32) < 0x20 => self.0.push_str(&format!("\\u{:04x}", c as u32)),
                c => self.0.push(c),
            }
        }
        self.0.push('"');
        self
    }
    pub fn raw(&mut self, k: &str, json: &str) -> &mut J {
        self.key(k);
        self.0.push_str(json);
        self
    }
    pub fn done(&mut self) -> String {
        self.0.push('}');
        std::mem::take(&mut self.0)
    }
}

pub fn arr(items: &[String]) -> String {
    format!("[{}]", items.join(","))
}

pub fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{:02x}", x)).collect()
}

struct Rd<'a> {
    b: &'a [u8],
    bad: bool,
}

impl<'a> Rd<'a> {
    fn new(b: &'a [u8]) -> Rd<'a> {
        Rd { b, bad: false }
    }
    fn take(&mut self, n: usize) -> &'a [u8] {
        if self.b.len() < n {
            self.bad = true;
            return &[];
        }
        let (h, t) = self.b.split_at(n);
        self.b = t;
        h
    }
    fn u8(&mut self) -> u8 {
        self.take(1).first().copied().unwrap_or(0)
    }
    fn i8(&mut self) -> i8 {
        self.u8() as i8
    }
    fn u16(&mut self) -> u16 {
        let b = self.take(2);
        if b.len() < 2 { 0 } else { u16::from_le_bytes([b[0], b[1]]) }
    }
    fn i16(&mut self) -> i16 {
        self.u16() as i16
    }
    fn u32(&mut self) -> u32 {
        let b = self.take(4);
        if b.len() < 4 { 0 } else { u32::from_le_bytes([b[0], b[1], b[2], b[3]]) }
    }
}

fn plmn(b: &[u8]) -> String {
    if b.len() < 3 {
        return String::from("?");
    }
    let d = |x: u8| if x == 0xf { String::new() } else { x.to_string() };
    let mcc = d(b[0] & 0xf) + &d(b[0] >> 4) + &d(b[1] & 0xf);
    let mnc = d(b[2] & 0xf) + &d(b[2] >> 4) + &d(b[1] >> 4);
    format!("{}-{}", mcc, mnc)
}

fn rat(x: u8) -> &'static str {
    match x {
        0 => "none",
        4 => "gsm",
        5 => "umts",
        8 => "lte",
        9 => "tdscdma",
        0x0c => "nr5g",
        _ => "other",
    }
}

/// QMI NAS active band class → ("B"/"n", 3GPP band). The enum is not
/// linear. Verified on device: 120=B1, 142=B40, 149=B41; the rest follows
/// libqmi's QmiNasActiveBand and must be cross-checked against EARFCN.
fn band_num(class: u16) -> Option<(&'static str, u16)> {
    const LTE: &[u16] = &[
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 17, 33, 34, 35, 36, 37, 38, 39, 40, 18, 19, 20, 21,
        24, 25, 41, 42, 43, 23, 26, 32, 125, 126, 127, 28, 29, 30, 66, 250, 46, 27, 31, 71, 47, 48, 67, 68,
        49, 85, 72, 73, 86, 53, 87, 88, 70,
    ];
    const NR: &[u16] = &[
        1, 2, 3, 5, 7, 8, 20, 28, 38, 41, 50, 51, 66, 70, 71, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84,
        85, 257, 258, 259, 260, 261, 12, 25, 34, 39, 40, 65, 86, 48, 14, 13, 18, 26, 30, 29, 53, 46, 91, 92,
        93, 94,
    ];
    match class {
        120..=249 => LTE.get((class - 120) as usize).map(|b| ("B", *b)),
        250..=400 => NR.get((class - 250) as usize).map(|b| ("n", *b)),
        _ => None,
    }
}

fn unknown(j: &mut J, m: &Msg, known: &[u8]) {
    let items: Vec<String> = m
        .tlvs
        .iter()
        .filter(|t| t.t != 0x02 && !known.contains(&t.t))
        .map(|t| format!("\"{:02x}\":\"{}\"", t.t, hex(&t.v)))
        .collect();
    if !items.is_empty() {
        j.raw("raw", &format!("{{{}}}", items.join(",")));
    }
}

fn sig_val(j: &mut J, k: &str, v: i16, scale10: bool) {
    // 0x8000 / -32768 is the "invalid" sentinel seen on NR SNR.
    if v == i16::MIN {
        j.null(k);
    } else if scale10 {
        j.f1(k, v as f64 / 10.0);
    } else {
        j.num(k, v);
    }
}

/// NAS 0x004F Get Signal Info, and its 0x0051 indication (same TLVs).
pub fn sig(m: &Msg) -> String {
    let mut j = J::obj();
    if let Some(v) = m.tlv(0x14) {
        let mut r = Rd::new(v);
        let (rssi, rsrq, rsrp, snr) = (r.i8(), r.i8(), r.i16(), r.i16());
        let mut l = J::obj();
        l.num("rssi", rssi).num("rsrq", rsrq);
        sig_val(&mut l, "rsrp", rsrp, false);
        sig_val(&mut l, "sinr", snr, true);
        j.raw("lte", &l.done());
    }
    if m.tlv(0x17).is_some() || m.tlv(0x18).is_some() {
        let mut n = J::obj();
        if let Some(v) = m.tlv(0x17) {
            let mut r = Rd::new(v);
            let (rsrp, snr) = (r.i16(), r.i16());
            sig_val(&mut n, "rsrp", rsrp, false);
            sig_val(&mut n, "sinr", snr, true);
        }
        if let Some(v) = m.tlv(0x18) {
            sig_val(&mut n, "rsrq", Rd::new(v).i16(), false);
        }
        j.raw("nr", &n.done());
    }
    unknown(&mut j, m, &[0x14, 0x17, 0x18]);
    j.done()
}

fn cells(r: &mut Rd, n: usize) -> String {
    let mut out = Vec::new();
    for _ in 0..n {
        if r.bad {
            break;
        }
        let (pci, rsrq, rsrp, rssi, srx) = (r.u16(), r.i16(), r.i16(), r.i16(), r.i16());
        let mut c = J::obj();
        c.num("pci", pci)
            .f1("rsrq", rsrq as f64 / 10.0)
            .f1("rsrp", rsrp as f64 / 10.0)
            .f1("rssi", rssi as f64 / 10.0)
            .num("srxlev", srx);
        out.push(c.done());
    }
    arr(&out)
}

/// NAS 0x0043 Get Cell Location Info.
pub fn cell(m: &Msg) -> String {
    let mut j = J::obj();
    if let Some(v) = m.tlv(0x13) {
        let mut r = Rd::new(v);
        let idle = r.u8();
        let pl = plmn(r.take(3));
        let tac = r.u16();
        let gci = r.u32();
        let earfcn = r.u16();
        let pci = r.u16();
        r.take(4); // cell resel priority, s_non_intra_search, thresh_serving_low, s_intra_search
        let n = r.u8() as usize;
        let list = cells(&mut r, n);
        let mut l = J::obj();
        l.num("idle", idle)
            .str("plmn", &pl)
            .num("tac", tac)
            .num("cell_id", gci)
            .num("earfcn", earfcn)
            .num("pci", pci)
            .raw("cells", &list);
        j.raw("lte_intra", &l.done());
    }
    if let Some(v) = m.tlv(0x14) {
        let mut r = Rd::new(v);
        r.u8();
        let nf = r.u8() as usize;
        let mut fs = Vec::new();
        for _ in 0..nf {
            if r.bad {
                break;
            }
            let ea = r.u16();
            r.take(3);
            let n = r.u8() as usize;
            let list = cells(&mut r, n);
            let mut f = J::obj();
            f.num("earfcn", ea).raw("cells", &list);
            fs.push(f.done());
        }
        j.raw("lte_inter", &arr(&fs));
    }
    if let Some(v) = m.tlv(0x27) {
        j.num("lte_earfcn32", Rd::new(v).u32());
    }
    if let Some(v) = m.tlv(0x2e) {
        j.num("nr_arfcn", Rd::new(v).u32());
    }
    // TA candidates (spike: 0x1E=2, 0x2D=4 while QNWCFG lte_time_advance=4).
    if let Some(v) = m.tlv(0x1e) {
        j.num("tlv1e_u32", Rd::new(v).u32());
    }
    if let Some(v) = m.tlv(0x2d) {
        j.num("tlv2d_u32", Rd::new(v).u32());
    }
    unknown(&mut j, m, &[0x13, 0x14, 0x27, 0x2e, 0x1e, 0x2d]);
    j.done()
}

/// NAS 0x0031 Get RF Band Info.
pub fn rf(m: &Msg) -> String {
    let mut j = J::obj();
    let mut list = |t: u8, f: &dyn Fn(&mut Rd) -> String| -> Option<String> {
        let v = m.tlv(t)?;
        let mut r = Rd::new(v);
        let n = r.u8() as usize;
        let mut out = Vec::new();
        for _ in 0..n {
            if r.bad {
                break;
            }
            out.push(f(&mut r));
        }
        Some(arr(&out))
    };
    let ext = list(0x11, &|r| {
        let (a, b, c) = (r.u8(), r.u16(), r.u32());
        let mut o = J::obj();
        o.str("rat", rat(a)).num("chan", c);
        band_obj(&mut o, b);
        o.done()
    });
    let bw = list(0x12, &|r| {
        let (a, b) = (r.u8(), r.u32());
        let mut o = J::obj();
        o.str("rat", rat(a)).num("bw_enum", b);
        o.done()
    });
    match ext {
        Some(e) => {
            j.raw("bands", &e);
        }
        None => {
            if let Some(l) = list(0x01, &|r| {
                let (a, b, c) = (r.u8(), r.u16(), r.u16());
                let mut o = J::obj();
                o.str("rat", rat(a)).num("band_class", b).num("chan", c);
                o.done()
            }) {
                j.raw("bands", &l);
            }
        }
    }
    if let Some(b) = bw {
        j.raw("bandwidth", &b);
    }
    unknown(&mut j, m, &[0x01, 0x11, 0x12]);
    j.done()
}

fn band_obj(o: &mut J, class: u16) {
    o.num("band_class", class);
    match band_num(class) {
        Some((r, n)) => o.str("band", &format!("{}{}", r, n)),
        None => o.null("band"),
    };
}

/// NAS 0x00AC Get LTE CPHY CA Info. Layout on RM551E R02A01 (matched
/// against AT+QCAINFO 2026-10-22): 0x13 PCell {pci u16, earfcn u16,
/// bw u32, band u16}; 0x19 SCell list {n u8; pci u16, earfcn u32, bw u32,
/// band u16, state u32 (2 = activated), idx u8, pad u8}.
pub fn ca(m: &Msg) -> String {
    let mut j = J::obj();
    if let Some(v) = m.tlv(0x13) {
        let mut r = Rd::new(v);
        let mut p = J::obj();
        p.num("pci", r.u16()).num("earfcn", r.u16()).num("bw_enum", r.u32());
        band_obj(&mut p, r.u16());
        j.raw("pcell", &p.done());
    }
    // 0x15 = SCell list with u16 EARFCN (present in every sample so far);
    // 0x19 = the same list with u32 EARFCN (seen only sometimes).
    let wide = m.tlv(0x15).is_none();
    if let Some(v) = m.tlv(0x15).or(m.tlv(0x19)) {
        let mut r = Rd::new(v);
        let n = r.u8() as usize;
        let mut out = Vec::new();
        for _ in 0..n {
            if r.bad {
                break;
            }
            let mut s = J::obj();
            let pci = r.u16();
            let earfcn = if wide { r.u32() } else { r.u16() as u32 };
            s.num("pci", pci).num("earfcn", earfcn).num("bw_enum", r.u32());
            band_obj(&mut s, r.u16());
            // state: 0 deconfigured, 1 configured-deactivated, 2 activated
            s.num("state", r.u32()).num("idx", r.u8());
            if wide {
                r.u8();
            }
            out.push(s.done());
        }
        j.raw("scells", &arr(&out));
    }
    unknown(&mut j, m, &[0x13, 0x15, 0x19]);
    j.done()
}

/// NAS 0x0024 Get Serving System.
pub fn serving(m: &Msg) -> String {
    let mut j = J::obj();
    if let Some(v) = m.tlv(0x01) {
        let mut r = Rd::new(v);
        let (reg, cs, ps, net) = (r.u8(), r.u8(), r.u8(), r.u8());
        let n = r.u8() as usize;
        let rats: Vec<String> = (0..n).map(|_| format!("\"{}\"", rat(r.u8()))).collect();
        let reg_s = match reg {
            0 => "not_registered",
            1 => "registered",
            2 => "searching",
            3 => "denied",
            _ => "unknown",
        };
        j.str("reg", reg_s).num("cs_attach", cs).num("ps_attach", ps).num("net", net).raw("rats", &arr(&rats));
    }
    if let Some(v) = m.tlv(0x10) {
        j.num("roaming", Rd::new(v).u8());
    }
    if let Some(v) = m.tlv(0x12) {
        let mut r = Rd::new(v);
        let (mcc, mnc) = (r.u16(), r.u16());
        let l = r.u8() as usize;
        let d = String::from_utf8_lossy(r.take(l)).to_string();
        j.num("mcc", mcc).num("mnc", mnc).str("desc", &d);
    }
    unknown(&mut j, m, &[0x01, 0x10, 0x12]);
    j.done()
}

/// Any message: result + hex of every TLV.
pub fn dump(m: &Msg) -> String {
    let mut j = J::obj();
    unknown(&mut j, m, &[]);
    j.done()
}

/// DMS 0x0025 Get IDs / 0x0023 Get Revision: string TLVs.
pub fn strings(m: &Msg) -> String {
    let mut j = J::obj();
    for t in &m.tlvs {
        if t.t == 0x02 {
            continue;
        }
        j.str(&format!("{:02x}", t.t), &String::from_utf8_lossy(&t.v));
    }
    j.done()
}

/// UIM 0x002F Get Card Status: card + first-app state per slot.
pub fn card(m: &Msg) -> String {
    let mut j = J::obj();
    if let Some(v) = m.tlv(0x10) {
        let mut r = Rd::new(v);
        r.take(8); // primary/secondary GW/1x app indexes
        let n = r.u8() as usize;
        let mut out = Vec::new();
        for _ in 0..n {
            if r.bad {
                break;
            }
            let card_state = r.u8();
            r.take(3); // UPIN state, retries
            let err = r.u8();
            let na = r.u8() as usize;
            let mut apps = Vec::new();
            for _ in 0..na {
                if r.bad {
                    break;
                }
                let (typ, st) = (r.u8(), r.u8());
                r.take(4); // perso state/feature/retries
                let aid = r.u8() as usize;
                r.take(aid);
                r.take(7); // univ pin, pin1/pin2/puk
                apps.push(format!("{{\"type\":{},\"state\":{}}}", typ, st));
            }
            let cs = match card_state {
                0 => "absent",
                1 => "present",
                2 => "error",
                _ => "unknown",
            };
            out.push(format!("{{\"card\":\"{}\",\"err\":{},\"apps\":{}}}", cs, err, arr(&apps)));
        }
        j.raw("cards", &arr(&out));
    }
    unknown(&mut j, m, &[0x10]);
    j.done()
}
