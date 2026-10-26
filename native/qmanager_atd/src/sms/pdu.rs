//! SMS PDU codec: decode SMS-DELIVER, encode SMS-SUBMIT (3GPP TS 23.040 / 23.038).
//!
//! Decode input is untrusted modem output, so every access is bounds-checked
//! and nothing here can panic. Behaviour deliberately matches what existing
//! consumers (stored fingerprints, the inbox UI) already expect: sender
//! numbers never get a '+' prefix, and the SCTS timezone octet is ignored.

/// GSM 03.38 default alphabet. Index 0x1B is the escape and never decodes
/// to a character on its own.
const GSM7: [char; 128] = [
    '@', '£', '$', '¥', 'è', 'é', 'ù', 'ì', 'ò', 'Ç', '\n', 'Ø', 'ø', '\r', 'Å', 'å', //
    'Δ', '_', 'Φ', 'Γ', 'Λ', 'Ω', 'Π', 'Ψ', 'Σ', 'Θ', 'Ξ', '\u{1B}', 'Æ', 'æ', 'ß', 'É', //
    ' ', '!', '"', '#', '¤', '%', '&', '\'', '(', ')', '*', '+', ',', '-', '.', '/', //
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', ':', ';', '<', '=', '>', '?', //
    '¡', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', //
    'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'Ä', 'Ö', 'Ñ', 'Ü', '§', //
    '¿', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', //
    'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z', 'ä', 'ö', 'ñ', 'ü', 'à', //
];

const ESC: u8 = 0x1B;

/// Extension table (code after ESC, char).
const GSM7_EXT: [(u8, char); 10] = [
    (0x0A, '\u{0C}'),
    (0x14, '^'),
    (0x28, '{'),
    (0x29, '}'),
    (0x2F, '\\'),
    (0x3C, '['),
    (0x3D, '~'),
    (0x3E, ']'),
    (0x40, '|'),
    (0x65, '€'),
];

/// Hex string (case-insensitive, surrounding whitespace/CR/LF trimmed) to bytes.
pub fn from_hex(s: &str) -> Option<Vec<u8>> {
    let b = s.trim().as_bytes();
    if b.len() % 2 != 0 {
        return None;
    }
    fn nib(c: u8) -> Option<u8> {
        match c {
            b'0'..=b'9' => Some(c - b'0'),
            b'a'..=b'f' => Some(c - b'a' + 10),
            b'A'..=b'F' => Some(c - b'A' + 10),
            _ => None,
        }
    }
    b.chunks(2)
        .map(|p| Some(nib(p[0])? << 4 | nib(p[1])?))
        .collect()
}

/// Uppercase hex.
pub fn to_hex(b: &[u8]) -> String {
    const D: &[u8; 16] = b"0123456789ABCDEF";
    let mut s = String::with_capacity(b.len() * 2);
    for &x in b {
        s.push(D[(x >> 4) as usize] as char);
        s.push(D[(x & 15) as usize] as char);
    }
    s
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Concat {
    pub reference: u16,
    pub part: u8,
    pub total: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Encoding {
    Gsm7,
    EightBit,
    Ucs2,
    Compressed,
}

impl Encoding {
    pub fn as_str(self) -> &'static str {
        match self {
            Encoding::Gsm7 => "gsm7",
            Encoding::EightBit => "8bit",
            Encoding::Ucs2 => "ucs2",
            Encoding::Compressed => "compressed",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Deliver {
    pub sender: String,
    /// "MM/DD/YY HH:MM:SS"
    pub timestamp: String,
    /// Some only when a concat IE (00 or 08) is present and total > 0.
    pub concat: Option<Concat>,
    pub encoding: Encoding,
    pub content: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DecodeError {
    /// TP-MTI was not SMS-DELIVER (first_octet & 3: 1 = SUBMIT, 2 = STATUS-REPORT,
    /// 3 = reserved). AT+CMGL=4 lists those too; the caller skips them.
    NotDeliver(u8),
    /// Truncated or inconsistent PDU.
    Malformed,
}

fn byte(p: &[u8], i: usize) -> Result<u8, DecodeError> {
    p.get(i).copied().ok_or(DecodeError::Malformed)
}

/// Read `septets` 7-bit units starting at septet index `start` from LSB-first
/// packed data. Missing trailing bits read as zero (callers length-check first).
fn unpack7(ud: &[u8], start: usize, end: usize) -> Vec<u8> {
    (start..end)
        .map(|i| {
            let bit = i * 7;
            let (o, sh) = (bit / 8, bit % 8);
            let lo = ud.get(o).copied().unwrap_or(0) as u16;
            let hi = ud.get(o + 1).copied().unwrap_or(0) as u16;
            (((lo | hi << 8) >> sh) & 0x7F) as u8
        })
        .collect()
}

fn gsm7_to_string(septets: &[u8]) -> String {
    let mut out = String::with_capacity(septets.len());
    let mut it = septets.iter().copied();
    while let Some(s) = it.next() {
        if s != ESC {
            out.push(GSM7[(s & 0x7F) as usize]);
            continue;
        }
        // ESC + unknown code falls back to the basic char (23.038); a lone
        // trailing ESC yields nothing.
        let Some(n) = it.next() else { break };
        if let Some(&(_, c)) = GSM7_EXT.iter().find(|(k, _)| *k == n) {
            out.push(c);
        } else if n != ESC {
            out.push(GSM7[(n & 0x7F) as usize]);
        }
    }
    out
}

fn bcd_num(x: u8) -> u32 {
    (x & 0x0F) as u32 * 10 + (x >> 4) as u32
}

fn encoding_from_dcs(dcs: u8) -> Encoding {
    match dcs {
        0x00..=0x7F => {
            if dcs & 0x20 != 0 {
                Encoding::Compressed
            } else {
                match (dcs >> 2) & 3 {
                    1 => Encoding::EightBit,
                    2 => Encoding::Ucs2,
                    _ => Encoding::Gsm7,
                }
            }
        }
        0x80..=0xDF => Encoding::Gsm7,
        0xE0..=0xEF => Encoding::Ucs2,
        0xF0..=0xFF => {
            if dcs & 0x04 != 0 {
                Encoding::EightBit
            } else {
                Encoding::Gsm7
            }
        }
    }
}

/// Walk the UDH (excluding the UDHL octet) for the first concat IE.
fn parse_udh(h: &[u8]) -> Option<Concat> {
    let mut i = 0usize;
    while i + 2 <= h.len() {
        let (iei, iedl) = (h[i], h[i + 1] as usize);
        let Some(d) = h.get(i + 2..i + 2 + iedl) else {
            break;
        };
        let c = match (iei, iedl) {
            (0x00, 3) => Some(Concat {
                reference: d[0] as u16,
                total: d[1],
                part: d[2],
            }),
            (0x08, 4) => Some(Concat {
                reference: (d[0] as u16) << 8 | d[1] as u16,
                total: d[2],
                part: d[3],
            }),
            _ => None,
        };
        if let Some(c) = c {
            return if c.total > 0 { Some(c) } else { None };
        }
        i += 2 + iedl;
    }
    None
}

/// Shared by DELIVER decode and the test-only SUBMIT reader.
fn decode_user_data(
    ud: &[u8],
    udl: usize,
    enc: Encoding,
    udhi: bool,
) -> Result<(Option<Concat>, String), DecodeError> {
    let mut concat = None;
    let mut hdr = 0usize; // octets incl. the UDHL octet
    if udhi {
        hdr = byte(ud, 0)? as usize + 1;
        let h = ud.get(1..hdr).ok_or(DecodeError::Malformed)?;
        concat = parse_udh(h);
    }
    let content = match enc {
        Encoding::Gsm7 => {
            if ud.len() < (udl * 7).div_ceil(8) {
                return Err(DecodeError::Malformed);
            }
            // Text starts on a septet boundary after the header (fill bits).
            let h = (hdr * 8).div_ceil(7);
            if h > udl {
                return Err(DecodeError::Malformed);
            }
            gsm7_to_string(&unpack7(ud, h, udl))
        }
        Encoding::Ucs2 | Encoding::EightBit => {
            if ud.len() < udl || hdr > udl {
                return Err(DecodeError::Malformed);
            }
            let t = &ud[hdr..udl];
            if enc == Encoding::Ucs2 {
                let units = t.chunks_exact(2).map(|c| (c[0] as u16) << 8 | c[1] as u16);
                char::decode_utf16(units)
                    .map(|r| r.unwrap_or('\u{FFFD}'))
                    .collect()
            } else {
                to_hex(t)
            }
        }
        Encoding::Compressed => String::new(),
    };
    Ok((concat, content))
}

fn decode_address(pdu: &[u8], at: usize) -> Result<(String, usize), DecodeError> {
    let l = byte(pdu, at)? as usize;
    let toa = byte(pdu, at + 1)?;
    if l > 20 {
        return Err(DecodeError::Malformed);
    }
    let n = l.div_ceil(2);
    let a = pdu.get(at + 2..at + 2 + n).ok_or(DecodeError::Malformed)?;
    let s = if toa & 0x70 == 0x50 {
        let mut sep = unpack7(a, 0, l * 4 / 7);
        // A final 0x00 septet is packing padding, not an '@'.
        if sep.last() == Some(&0) {
            sep.pop();
        }
        gsm7_to_string(&sep)
    } else {
        let mut s = String::new();
        for i in 0..l {
            let b = a[i / 2];
            let nib = if i % 2 == 0 { b & 0x0F } else { b >> 4 };
            match nib {
                0..=9 => s.push((b'0' + nib) as char),
                0xA => s.push('*'),
                0xB => s.push('#'),
                0xC => s.push('a'),
                0xD => s.push('b'),
                0xE => s.push('c'),
                _ => {}
            }
        }
        s
    };
    Ok((s, at + 2 + n))
}

/// Full PDU as listed by AT+CMGL in PDU mode (starts with the SMSC length octet).
pub fn decode_deliver(pdu: &[u8]) -> Result<Deliver, DecodeError> {
    let s = 1 + byte(pdu, 0)? as usize;
    let f = byte(pdu, s)?;
    if f & 3 != 0 {
        return Err(DecodeError::NotDeliver(f & 3));
    }
    let udhi = f & 0x40 != 0;
    let (sender, p) = decode_address(pdu, s + 1)?;
    let dcs = byte(pdu, p + 1)?;
    let t = pdu.get(p + 2..p + 9).ok_or(DecodeError::Malformed)?;
    // Timezone octet (t[6]) is dropped on purpose: sender-local time as sent.
    let timestamp = format!(
        "{:02}/{:02}/{:02} {:02}:{:02}:{:02}",
        bcd_num(t[1]),
        bcd_num(t[2]),
        bcd_num(t[0]),
        bcd_num(t[3]),
        bcd_num(t[4]),
        bcd_num(t[5])
    );
    let udl = byte(pdu, p + 9)? as usize;
    let ud = pdu.get(p + 10..).unwrap_or(&[]);
    let encoding = encoding_from_dcs(dcs);
    let (concat, content) = decode_user_data(ud, udl, encoding, udhi)?;
    Ok(Deliver {
        sender,
        timestamp,
        concat,
        encoding,
        content,
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubmitPart {
    /// Full PDU, uppercase, including the leading "00" SMSC octet.
    pub hex: String,
    /// Byte length minus the SMSC octet: the n for AT+CMGS=<n>.
    pub tpdu_len: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EncodeError {
    BadNumber,
    TooLong,
}

impl EncodeError {
    pub fn as_str(self) -> &'static str {
        match self {
            EncodeError::BadNumber => "bad_number",
            EncodeError::TooLong => "message_too_long",
        }
    }
}

fn parse_number(number: &str) -> Result<(Vec<u8>, u8), EncodeError> {
    let n = number.trim();
    let (plus, d) = match n.strip_prefix('+') {
        Some(r) => (true, r),
        None => (false, n),
    };
    if d.is_empty() || d.len() > 20 || !d.bytes().all(|c| c.is_ascii_digit()) {
        return Err(EncodeError::BadNumber);
    }
    // Callers strip '+', so the legacy rule (>= 6 digits means international)
    // is what keeps short codes national.
    let toa = if plus || d.len() >= 6 { 0x91 } else { 0x81 };
    Ok((d.bytes().map(|c| c - b'0').collect(), toa))
}

/// Septets for one char (1, or 2 with ESC), None if outside GSM7.
fn gsm7_units(c: char) -> Option<Vec<u8>> {
    if let Some(i) = GSM7.iter().position(|&g| g == c) {
        if i != ESC as usize {
            return Some(vec![i as u8]);
        }
    }
    GSM7_EXT
        .iter()
        .find(|(_, g)| *g == c)
        .map(|&(k, _)| vec![ESC, k])
}

/// Group units into parts without splitting a unit. Single part when the
/// whole thing fits `single`; empty input still yields one empty part.
fn chunk<T: Copy>(units: &[Vec<T>], single: usize, multi: usize) -> Vec<Vec<T>> {
    let total: usize = units.iter().map(Vec::len).sum();
    if total <= single {
        return vec![units.iter().flatten().copied().collect()];
    }
    let mut parts: Vec<Vec<T>> = vec![Vec::new()];
    for u in units {
        if parts.last().map_or(0, Vec::len) + u.len() > multi {
            parts.push(Vec::new());
        }
        if let Some(l) = parts.last_mut() {
            l.extend_from_slice(u);
        }
    }
    parts
}

fn set_septet(buf: &mut [u8], at_bit: usize, v: u8) {
    for k in 0..7 {
        if v >> k & 1 == 1 {
            let b = at_bit + k;
            if let Some(o) = buf.get_mut(b / 8) {
                *o |= 1 << (b % 8);
            }
        }
    }
}

fn build_pdu(digits: &[u8], toa: u8, udhi: bool, dcs: u8, udl: usize, ud: &[u8]) -> SubmitPart {
    let mut p = vec![
        0x00,
        if udhi { 0x51 } else { 0x11 },
        0x00,
        digits.len() as u8,
        toa,
    ];
    for pair in digits.chunks(2) {
        let hi = pair.get(1).copied().unwrap_or(0xF);
        p.push(hi << 4 | pair[0]);
    }
    p.extend_from_slice(&[0x00, dcs, 0xB0, udl as u8]);
    p.extend_from_slice(ud);
    SubmitPart {
        tpdu_len: p.len() - 1,
        hex: to_hex(&p),
    }
}

/// `concat_ref` is used only when the text needs more than one part.
pub fn encode_submit(
    number: &str,
    text: &str,
    concat_ref: u8,
) -> Result<Vec<SubmitPart>, EncodeError> {
    let (digits, toa) = parse_number(number)?;
    let gsm: Option<Vec<Vec<u8>>> = text.chars().map(gsm7_units).collect();
    let mut out = Vec::new();
    if let Some(units) = gsm {
        let parts = chunk(&units, 160, 153);
        if parts.len() > 255 {
            return Err(EncodeError::TooLong);
        }
        let multi = parts.len() > 1;
        for (i, sep) in parts.iter().enumerate() {
            if multi {
                let udl = 7 + sep.len();
                let mut ud = vec![0u8; (udl * 7).div_ceil(8)];
                ud[..6].copy_from_slice(&[5, 0, 3, concat_ref, parts.len() as u8, i as u8 + 1]);
                for (k, &s) in sep.iter().enumerate() {
                    set_septet(&mut ud, 49 + 7 * k, s);
                }
                out.push(build_pdu(&digits, toa, true, 0x00, udl, &ud));
            } else {
                let udl = sep.len();
                let mut ud = vec![0u8; (udl * 7).div_ceil(8)];
                for (k, &s) in sep.iter().enumerate() {
                    set_septet(&mut ud, 7 * k, s);
                }
                out.push(build_pdu(&digits, toa, false, 0x00, udl, &ud));
            }
        }
    } else {
        let units: Vec<Vec<u16>> = text
            .chars()
            .map(|c| {
                let mut b = [0u16; 2];
                c.encode_utf16(&mut b).to_vec()
            })
            .collect();
        let parts = chunk(&units, 70, 67);
        if parts.len() > 255 {
            return Err(EncodeError::TooLong);
        }
        let multi = parts.len() > 1;
        for (i, u) in parts.iter().enumerate() {
            let mut ud = Vec::new();
            if multi {
                ud.extend_from_slice(&[5, 0, 3, concat_ref, parts.len() as u8, i as u8 + 1]);
            }
            for w in u {
                ud.extend_from_slice(&w.to_be_bytes());
            }
            out.push(build_pdu(&digits, toa, multi, 0x08, ud.len(), &ud));
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dec(h: &str) -> Result<Deliver, DecodeError> {
        decode_deliver(&from_hex(h).unwrap())
    }

    const V1: &str = "07911326040000F0040B911346610089F60000208062917314080CC8F71D14969741F977FD07";
    const V2: &str = "07916831081010F0040ED0D637396C7EBBCB00006201619050700002C834";
    const V2B: &str = "07916831081010F0040BD0C7F7FBCC2E030000620161905070000BC337B90C8AC966B49A0D";
    const V3: &str = "07916831081010F0040B915155214365F70000620161905070000BE10D4FBC298F37C04D0F";
    const V4: &str =
        "07916831081010F0040C9144214365870900086201619050700012004800690020D83DDE00002000E9043420AC";
    const V5: &str = "07916831081010F0440B915155214365F700006201619050700015050003CC0201906536FB0D8287E574D0DB5D06";
    const V6: &str = "07916831081010F0440B915155214365F70000620161905070000D06080412340302D7B79C4D06";
    const V7: &str = "07916831081010F0440B915155214365F700086201619050700012050003770302041F04400438043204350442";
    const V8: &str = "07916831081010F0040B915155214365F700046201619050700003010203";
    const V9: &str = "07916831081010F0040B915155214365F7000062016190507000 02100C";
    const V10: &str = "0011000B916407281553F80000AA0AE8329BFD4697D9EC37";
    const V11: &str = "07916831081010F0040B915155214365F70000620161905070000DF3701E2442A745AFCD4B8107";
    const V12: &str = "07916831081010F00405812143F500F09921133295954A02EF35";

    fn all_vectors() -> Vec<String> {
        [V1, V2, V2B, V3, V4, V5, V6, V7, V8, V9, V10, V11, V12]
            .iter()
            .map(|s| s.replace(' ', ""))
            .collect()
    }

    #[test]
    fn hex_roundtrip() {
        assert_eq!(from_hex(" 0aFf\r\n"), Some(vec![0x0A, 0xFF]));
        assert_eq!(from_hex("abc"), None);
        assert_eq!(from_hex("zz"), None);
        assert_eq!(from_hex("é1"), None);
        assert_eq!(from_hex(""), Some(vec![]));
        assert_eq!(to_hex(&[0x0a, 0xff, 0x00]), "0AFF00");
    }

    #[test]
    fn v1_basic() {
        let d = dec(V1).unwrap();
        assert_eq!(d.sender, "31641600986");
        assert_eq!(d.timestamp, "08/26/02 19:37:41");
        assert_eq!(d.content, "How are you?");
        assert_eq!(d.encoding, Encoding::Gsm7);
        assert_eq!(d.concat, None);
    }

    #[test]
    fn v2_alphanumeric_senders() {
        let d = dec(V2).unwrap();
        assert_eq!(d.sender, "Vodafone");
        assert_eq!(d.timestamp, "10/16/26 09:05:07");
        assert_eq!(d.content, "Hi");
        let d = dec(V2B).unwrap();
        assert_eq!(d.sender, "Google");
        assert_eq!(d.content, "Code 123456");
    }

    #[test]
    fn v3_extension_chars_and_no_plus() {
        let d = dec(V3).unwrap();
        assert_eq!(d.sender, "15551234567"); // toa 0x91 but never '+'
        assert_eq!(d.content, "a[b€c|~");
    }

    #[test]
    fn v4_ucs2_surrogates() {
        let d = dec(V4).unwrap();
        assert_eq!(d.encoding, Encoding::Ucs2);
        assert_eq!(d.sender, "441234567890");
        assert_eq!(d.content, "Hi 😀 éд€");
    }

    #[test]
    fn v5_v6_v7_concat() {
        let d = dec(V5).unwrap();
        assert_eq!(d.content, "Hello part one");
        assert_eq!(
            d.concat,
            Some(Concat {
                reference: 204,
                part: 1,
                total: 2
            })
        );
        let d = dec(V6).unwrap();
        assert_eq!(d.content, "World");
        assert_eq!(
            d.concat,
            Some(Concat {
                reference: 4660,
                part: 2,
                total: 3
            })
        );
        let d = dec(V7).unwrap();
        assert_eq!(d.encoding, Encoding::Ucs2);
        assert_eq!(d.content, "Привет");
        assert_eq!(
            d.concat,
            Some(Concat {
                reference: 119,
                part: 2,
                total: 3
            })
        );
    }

    #[test]
    fn v8_eight_bit_is_hex() {
        let d = dec(V8).unwrap();
        assert_eq!(d.encoding, Encoding::EightBit);
        assert_eq!(d.content, "010203");
    }

    #[test]
    fn v9_two_septets_not_truncated() {
        assert_eq!(dec(V9.replace(' ', "").as_str()).unwrap().content, "ΔΣ");
    }

    #[test]
    fn v10_submit_is_skipped() {
        assert_eq!(dec(V10), Err(DecodeError::NotDeliver(1)));
    }

    #[test]
    fn status_report_is_skipped() {
        assert_eq!(
            dec("0006000B916407281553F8"),
            Err(DecodeError::NotDeliver(2))
        );
        assert_eq!(dec("0007"), Err(DecodeError::NotDeliver(3)));
    }

    #[test]
    fn v11_escapes_in_basic_table() {
        assert_eq!(dec(V11).unwrap().content, "say \"hi\"/\\\nx");
    }

    #[test]
    fn v12_dcs_f0_and_timezone_ignored() {
        let d = dec(V12).unwrap();
        assert_eq!(d.sender, "12345");
        assert_eq!(d.timestamp, "12/31/99 23:59:59");
        assert_eq!(d.content, "ok");
        assert_eq!(d.encoding, Encoding::Gsm7);
    }

    #[test]
    fn mwi_store_ucs2_dcs_e0() {
        let d = dec("000405812143F500E0620161905070000400480069").unwrap();
        assert_eq!(d.encoding, Encoding::Ucs2);
        assert_eq!(d.content, "Hi");
    }

    #[test]
    fn dcs_mapping() {
        assert_eq!(encoding_from_dcs(0x00), Encoding::Gsm7);
        assert_eq!(encoding_from_dcs(0x04), Encoding::EightBit);
        assert_eq!(encoding_from_dcs(0x08), Encoding::Ucs2);
        assert_eq!(encoding_from_dcs(0x0C), Encoding::Gsm7);
        assert_eq!(encoding_from_dcs(0x20), Encoding::Compressed);
        assert_eq!(encoding_from_dcs(0x44), Encoding::EightBit);
        assert_eq!(encoding_from_dcs(0x90), Encoding::Gsm7);
        assert_eq!(encoding_from_dcs(0xC0), Encoding::Gsm7);
        assert_eq!(encoding_from_dcs(0xD8), Encoding::Gsm7);
        assert_eq!(encoding_from_dcs(0xEF), Encoding::Ucs2);
        assert_eq!(encoding_from_dcs(0xF4), Encoding::EightBit);
        assert_eq!(encoding_from_dcs(0xF0), Encoding::Gsm7);
        assert_eq!(encoding_from_dcs(0xF8), Encoding::Gsm7);
    }

    #[test]
    fn compressed_is_empty_and_udl_zero_ok() {
        let d = dec("000405812143F500 20 62016190507000 02 0102".replace(' ', "").as_str()).unwrap();
        assert_eq!(d.encoding, Encoding::Compressed);
        assert_eq!(d.content, "");
        let d = dec("000405812143F5000062016190507000 00".replace(' ', "").as_str()).unwrap();
        assert_eq!(d.content, "");
    }

    #[test]
    fn gsm7_escape_edge_cases() {
        // ESC + unknown code -> basic char of that code; lone trailing ESC -> nothing.
        assert_eq!(gsm7_to_string(&[ESC, 0x41]), "A");
        assert_eq!(gsm7_to_string(&[0x41, ESC]), "A");
        assert_eq!(gsm7_to_string(&[ESC, ESC, 0x41]), "A");
        assert_eq!(gsm7_to_string(&[ESC, 0x0A]), "\u{0C}");
    }

    #[test]
    fn ucs2_unpaired_surrogate_and_odd_byte() {
        let (_, s) =
            decode_user_data(&[0xD8, 0x3D, 0x00, 0x41, 0x99], 5, Encoding::Ucs2, false).unwrap();
        assert_eq!(s, "\u{FFFD}A");
    }

    #[test]
    fn truncation_never_panics() {
        for v in all_vectors() {
            let b = from_hex(&v).unwrap();
            for n in 0..=b.len() {
                let _ = decode_deliver(&b[..n]);
            }
        }
        // Truncated bodies of otherwise valid vectors are errors, not garbage.
        let b = from_hex(V1).unwrap();
        assert_eq!(decode_deliver(&b[..b.len() - 1]), Err(DecodeError::Malformed));
        assert_eq!(decode_deliver(&[]), Err(DecodeError::Malformed));
    }

    #[test]
    fn random_bytes_never_panic() {
        let mut x: u64 = 0x1234_5678_9ABC_DEF1;
        let mut next = || {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            x
        };
        let vecs: Vec<Vec<u8>> = all_vectors().iter().map(|v| from_hex(v).unwrap()).collect();
        for i in 0..30000 {
            let mut b = if i % 2 == 0 {
                vecs[(next() as usize) % vecs.len()].clone()
            } else {
                (0..(next() % 60) as usize).map(|_| next() as u8).collect()
            };
            if !b.is_empty() {
                for _ in 0..3 {
                    let k = (next() as usize) % b.len();
                    b[k] = next() as u8;
                }
            }
            let _ = decode_deliver(&b);
        }
    }

    #[test]
    fn oversized_address_rejected() {
        assert_eq!(
            dec("000415 81 2143F5".replace(' ', "").as_str()),
            Err(DecodeError::Malformed)
        );
    }

    // ---- encode ----

    fn one(number: &str, text: &str) -> SubmitPart {
        let mut v = encode_submit(number, text, 0).unwrap();
        assert_eq!(v.len(), 1);
        v.remove(0)
    }

    #[test]
    fn enc_vectors() {
        let p = one("491701234567", "Hello World");
        assert_eq!(p.tpdu_len, 24);
        assert_eq!(p.hex, "0011000C919471103254760000B00BC8329BFD065DDF723619");
        let p = one("12345", "Hi");
        assert_eq!(p.tpdu_len, 13);
        assert_eq!(p.hex, "00110005812143F50000B002C834");
        assert_eq!(one("+12345", "Hi").hex, "00110005912143F50000B002C834");
        let p = one("491701234567", "12345678");
        assert_eq!(p.tpdu_len, 21);
        assert_eq!(p.hex, "0011000C919471103254760000B00831D98C56B3DD70");
        let p = one("0123456789", "hellohello");
        assert_eq!(p.tpdu_len, 22);
        assert_eq!(p.hex, "0011000A9110325476980000B00AE8329BFD4697D9EC37");
        let p = one("491701234567", "a[b]{}~^|\\");
        assert_eq!(p.tpdu_len, 30);
        assert_eq!(p.hex, "0011000C919471103254760000B012E10D4FBCF16D509BD4A6B7A16C809B17");
    }

    #[test]
    fn enc_e_acute_is_gsm7() {
        let p = one("491701234567", "é");
        // DCS 00, UDL 1, septet 0x05.
        assert_eq!(p.hex, "0011000C919471103254760000B00105");
        assert_eq!(p.tpdu_len, 15);
    }

    #[test]
    fn enc_ucs2() {
        let p = one("491701234567", "д");
        assert_eq!(p.hex, "0011000C919471103254760008B0020434");
        let p = one("491701234567", "😀");
        assert_eq!(p.hex, "0011000C919471103254760008B004D83DDE00");
        assert_eq!(p.tpdu_len, 18);
    }

    #[test]
    fn enc_empty_text() {
        let p = one("12345", "");
        assert_eq!(p.hex, "00110005812143F50000B000");
    }

    #[test]
    fn enc_161_x_two_parts() {
        let v = encode_submit("491701234567", &"x".repeat(161), 0xAB).unwrap();
        assert_eq!(v.len(), 2);
        assert_eq!(v[1].tpdu_len, 28);
        assert_eq!(
            v[1].hex,
            "0051000C919471103254760000B00F050003AB0202F0783C1E8FC7E301"
        );
        let b = from_hex(&v[0].hex).unwrap();
        assert_eq!(b[1], 0x51);
        assert_eq!(v[0].tpdu_len, 154);
        assert!(v[0].hex.contains("B0A0050003AB0201"));
    }

    #[test]
    fn enc_160_x_single_exact_octets() {
        let v = encode_submit("491701234567", &"x".repeat(160), 1).unwrap();
        assert_eq!(v.len(), 1);
        let b = from_hex(&v[0].hex).unwrap();
        // 00 11 00 | DA len, toa, 6 octets | pid dcs vp | udl | ud
        let ud_at = 3 + 2 + 6 + 3 + 1;
        assert_eq!(b[ud_at - 1], 0xA0);
        assert_eq!(b.len() - ud_at, 140);
    }

    #[test]
    fn enc_esc_pair_not_split() {
        // 152 x then a euro (2 septets) would end at 154 > 153: euro moves on.
        let t = format!("{}€{}", "x".repeat(152), "y".repeat(10));
        let v = encode_submit("12345", &t, 7).unwrap();
        assert_eq!(v.len(), 2);
        assert_eq!(round_trip(&v), t);
        let b0 = from_hex(&v[0].hex).unwrap();
        let udl0 = b0[11];
        assert_eq!(udl0 as usize, 7 + 152);
        let b1 = from_hex(&v[1].hex).unwrap();
        assert_eq!(b1[11] as usize, 7 + 2 + 10);
    }

    #[test]
    fn enc_ucs2_boundaries() {
        let t70 = "д".repeat(70);
        assert_eq!(encode_submit("12345", &t70, 1).unwrap().len(), 1);
        let t71 = "д".repeat(71);
        let v = encode_submit("12345", &t71, 1).unwrap();
        assert_eq!(v.len(), 2);
        let udl = |p: &SubmitPart| from_hex(&p.hex).unwrap()[11] as usize;
        assert_eq!(udl(&v[0]), 6 + 67 * 2);
        assert_eq!(udl(&v[1]), 6 + 4 * 2);
        // Emoji whose first unit would be the 67th: moves wholly to part 2.
        let t = format!("{}😀{}", "д".repeat(66), "я".repeat(3));
        let v = encode_submit("12345", &t, 1).unwrap();
        assert_eq!(v.len(), 2);
        assert_eq!(udl(&v[0]), 6 + 66 * 2);
        assert_eq!(udl(&v[1]), 6 + 2 * 2 + 3 * 2);
        assert_eq!(round_trip(&v), t);
    }

    #[test]
    fn enc_part_count_limits() {
        let ok = "x".repeat(255 * 153);
        assert_eq!(encode_submit("12345", &ok, 1).unwrap().len(), 255);
        let big = "x".repeat(255 * 153 + 1);
        assert_eq!(encode_submit("12345", &big, 1), Err(EncodeError::TooLong));
        let u = "д".repeat(255 * 67 + 1);
        assert_eq!(encode_submit("12345", &u, 1), Err(EncodeError::TooLong));
        assert_eq!(EncodeError::TooLong.as_str(), "message_too_long");
        assert_eq!(EncodeError::BadNumber.as_str(), "bad_number");
    }

    #[test]
    fn enc_bad_numbers() {
        for n in ["", "+", "12a4", "123456789012345678901", " + "] {
            assert_eq!(encode_submit(n, "hi", 0), Err(EncodeError::BadNumber), "{n:?}");
        }
        assert!(encode_submit("  +12345678901234567890 ", "hi", 0).is_ok());
    }

    #[test]
    fn enc_toa_rule() {
        assert!(one("12345", "a").hex.starts_with("00110005 81".replace(' ', "").as_str()));
        assert!(one("123456", "a").hex.starts_with("00110006 91".replace(' ', "").as_str()));
    }

    /// Test-only SUBMIT reader: reuses the DELIVER user-data decoder.
    fn read_submit(p: &SubmitPart) -> (Option<Concat>, String) {
        let b = from_hex(&p.hex).unwrap();
        assert_eq!(b.len() - 1, p.tpdu_len);
        let f = b[1];
        let da = b[3] as usize;
        let mut i = 5 + da.div_ceil(2); // -> PID
        let dcs = b[i + 1];
        i += 3; // skip PID, DCS, VP
        let udl = b[i] as usize;
        decode_user_data(&b[i + 1..], udl, encoding_from_dcs(dcs), f & 0x40 != 0).unwrap()
    }

    fn round_trip(parts: &[SubmitPart]) -> String {
        let mut got: Vec<(Option<Concat>, String)> = parts.iter().map(read_submit).collect();
        if parts.len() > 1 {
            for (i, (c, _)) in got.iter().enumerate() {
                let c = c.unwrap();
                assert_eq!(c.total as usize, parts.len());
                assert_eq!(c.part as usize, i + 1);
            }
        } else {
            assert_eq!(got[0].0, None);
        }
        got.drain(..).map(|(_, s)| s).collect()
    }

    #[test]
    fn round_trips() {
        let texts = [
            "Hello World".to_string(),
            "a[b]{}~^|\\ €".to_string(),
            "Привет мир".to_string(),
            "Hi 😀 there é".to_string(),
            "x".repeat(160),
            "ab€".repeat(200),
            "Привет😀".repeat(40),
            "x".repeat(153 * 3 + 5),
            "é".repeat(500),
            "".to_string(),
        ];
        for t in &texts {
            let v = encode_submit("491701234567", t, 9).unwrap();
            assert_eq!(&round_trip(&v), t);
        }
        let v = encode_submit("491701234567", &"x".repeat(161), 0xAB).unwrap();
        assert_eq!(read_submit(&v[0]).0.unwrap().reference, 0xAB);
    }

    #[test]
    fn encoding_names() {
        assert_eq!(Encoding::Gsm7.as_str(), "gsm7");
        assert_eq!(Encoding::EightBit.as_str(), "8bit");
        assert_eq!(Encoding::Ucs2.as_str(), "ucs2");
        assert_eq!(Encoding::Compressed.as_str(), "compressed");
    }
}
