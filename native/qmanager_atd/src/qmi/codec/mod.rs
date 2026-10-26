//! Typed decoders from a QMI response `Msg` to plain structs, one per
//! message. Ported from qmi_probe/src/decode.rs (device-verified on an
//! RM551E, 2026-10-22); the TLV layouts are noted on each decoder.
//!
//! Rules every decoder follows:
//! - infallible and panic-free (the release build aborts on panic): a
//!   missing or short TLV yields `None` / an empty list, never an error;
//! - an incomplete list entry is dropped rather than half-filled;
//! - no interpretation beyond units and enums: normalising (band strings,
//!   dBm, the registration gate) is `qmi::model`'s job;
//! - anything not backed by a device fixture or a well-known layout is not
//!   decoded (see each module's header).

pub mod dms;
pub mod dsd;
pub mod nas;
pub mod uim;
pub mod wds;

/// A bounds-checked little-endian cursor over one TLV value. Every read
/// returns `None` when the value is too short, and leaves the cursor alone.
pub struct Rd<'a> {
    b: &'a [u8],
}

impl<'a> Rd<'a> {
    pub fn new(b: &'a [u8]) -> Rd<'a> {
        Rd { b }
    }

    #[allow(dead_code)] // cursor API kept whole
    pub fn left(&self) -> usize {
        self.b.len()
    }

    pub fn take(&mut self, n: usize) -> Option<&'a [u8]> {
        if self.b.len() < n {
            return None;
        }
        let (h, t) = self.b.split_at(n);
        self.b = t;
        Some(h)
    }

    pub fn skip(&mut self, n: usize) -> Option<()> {
        self.take(n).map(|_| ())
    }

    pub fn u8(&mut self) -> Option<u8> {
        self.take(1).map(|b| b[0])
    }

    pub fn i8(&mut self) -> Option<i8> {
        self.u8().map(|v| v as i8)
    }

    pub fn u16(&mut self) -> Option<u16> {
        self.take(2).map(|b| u16::from_le_bytes([b[0], b[1]]))
    }

    pub fn i16(&mut self) -> Option<i16> {
        self.u16().map(|v| v as i16)
    }

    pub fn u32(&mut self) -> Option<u32> {
        self.take(4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }

    pub fn u64(&mut self) -> Option<u64> {
        self.take(8).map(|b| {
            let mut a = [0u8; 8];
            a.copy_from_slice(b);
            u64::from_le_bytes(a)
        })
    }
}

/// QMI radio interface (`rat`) values.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Rat {
    None,
    Gsm,
    Umts,
    Lte,
    TdScdma,
    Nr5g,
    Other(u8),
}

impl Rat {
    pub fn from_u8(v: u8) -> Rat {
        match v {
            0 => Rat::None,
            4 => Rat::Gsm,
            5 => Rat::Umts,
            8 => Rat::Lte,
            9 => Rat::TdScdma,
            0x0c => Rat::Nr5g,
            o => Rat::Other(o),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Rat::None => "none",
            Rat::Gsm => "gsm",
            Rat::Umts => "umts",
            Rat::Lte => "lte",
            Rat::TdScdma => "tdscdma",
            Rat::Nr5g => "nr5g",
            Rat::Other(_) => "other",
        }
    }
}

/// A BCD PLMN (3 bytes, the 3GPP TS 24.008 nibble order) as
/// `(mcc, mnc, mnc_digits)`. A 2-digit MNC has filler nibble 0xF.
pub fn plmn3(b: &[u8]) -> Option<(u16, u16, u8)> {
    if b.len() < 3 {
        return None;
    }
    let (m1, m2, m3) = (b[0] & 0xf, b[0] >> 4, b[1] & 0xf);
    let (n1, n2, n3) = (b[2] & 0xf, b[2] >> 4, b[1] >> 4);
    if [m1, m2, m3, n1, n2].iter().any(|d| *d > 9) {
        return None;
    }
    let mcc = m1 as u16 * 100 + m2 as u16 * 10 + m3 as u16;
    if n3 == 0xf {
        Some((mcc, n1 as u16 * 10 + n2 as u16, 2))
    } else if n3 <= 9 {
        Some((mcc, n1 as u16 * 100 + n2 as u16 * 10 + n3 as u16, 3))
    } else {
        None
    }
}

/// A QMI string TLV: UTF-8 lossy, control characters dropped, trimmed,
/// capped at 64 chars. None when nothing printable is left.
pub fn text(b: &[u8]) -> Option<String> {
    let s: String = String::from_utf8_lossy(b).chars().filter(|c| !c.is_control()).take(64).collect();
    let s = s.trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

#[cfg(test)]
pub mod testfix {
    //! Fixture loading for codec and model tests. Fixtures are raw device
    //! captures, one JSON line each: `{"rtt_ms":..,"tlvs":[{"t":"02","hex":".."},..]}`.
    //! Identifying values were replaced with synthetic ones of the same
    //! shape before they were committed (see tests/fixtures/qmi/).

    use crate::qmi::msg::{Msg, Tlv, KIND_RESP};

    fn unhex(h: &str) -> Vec<u8> {
        (0..h.len() / 2).map(|i| u8::from_str_radix(&h[2 * i..2 * i + 2], 16).unwrap()).collect()
    }

    pub fn parse(line: &str) -> Msg {
        let mut tlvs = Vec::new();
        let mut rest = line;
        while let Some(i) = rest.find("{\"t\":\"") {
            rest = &rest[i + 6..];
            let t = u8::from_str_radix(&rest[..2], 16).unwrap();
            let j = rest.find("\"hex\":\"").unwrap() + 7;
            let end = rest[j..].find('"').unwrap();
            tlvs.push(Tlv { t, v: unhex(&rest[j..j + end]) });
            rest = &rest[j + end..];
        }
        Msg { kind: KIND_RESP, txn: 1, id: 0, tlvs }
    }

    /// `fx!("r1_3_0x0043")` loads tests/fixtures/qmi/r1_3_0x0043.txt.
    macro_rules! fx {
        ($name:literal) => {
            $crate::qmi::codec::testfix::parse(include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/tests/fixtures/qmi/",
                $name,
                ".txt"
            )))
        };
    }
    pub(crate) use fx;

    /// Every committed fixture, for the truncation fuzz.
    pub fn all() -> Vec<Msg> {
        vec![
            fx!("r1_3_0x0020"),
            fx!("r1_3_0x0024"),
            fx!("r1_3_0x0031"),
            fx!("r1_3_0x0043"),
            fx!("r1_3_0x004F"),
            fx!("r1_3_0x00AC"),
            fx!("r1_2_0x0022"),
            fx!("r1_2_0x0023"),
            fx!("r1_2_0x0025"),
            fx!("r1_2_0x002D"),
            fx!("r1_2_0x002F"),
            fx!("r1_11_0x002F"),
            fx!("r1_11_0x0047"),
            fx!("r1_1_0x002A"),
            fx!("r1_42_0x0024"),
            fx!("ca_0x15_two_scells"),
            fx!("ca_0x19_wide_scell"),
            fx!("ca_0x15_deconfigured"),
            fx!("serving_searching"),
        ]
    }

    /// Variants of `m` with each TLV cut to every shorter length, plus the
    /// message with that TLV removed, plus 0xFF-filled copies (huge counts).
    pub fn mangled(m: &Msg) -> Vec<Msg> {
        let mut out = Vec::new();
        for i in 0..m.tlvs.len() {
            for cut in 0..m.tlvs[i].v.len() {
                let mut c = m.clone();
                c.tlvs[i].v.truncate(cut);
                out.push(c);
            }
            let mut c = m.clone();
            c.tlvs.remove(i);
            out.push(c);
            let mut c = m.clone();
            for b in c.tlvs[i].v.iter_mut() {
                *b = 0xff;
            }
            out.push(c);
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reader_is_bounds_checked() {
        let mut r = Rd::new(&[1, 2, 3]);
        assert_eq!(r.u16(), Some(0x0201));
        assert_eq!(r.u16(), None);
        assert_eq!(r.u8(), Some(3));
        assert_eq!(r.u8(), None);
        assert_eq!(Rd::new(&[]).u64(), None);
    }

    #[test]
    fn plmn_digits() {
        assert_eq!(plmn3(&[0x15, 0xf5, 0x30]), Some((515, 3, 2)));
        assert_eq!(plmn3(&[0x13, 0x00, 0x62]), Some((310, 260, 3)));
        assert_eq!(plmn3(&[0x1a, 0xf5, 0x30]), None);
        assert_eq!(plmn3(&[0x15]), None);
    }

    #[test]
    fn text_is_sanitised() {
        assert_eq!(text(b"RM551E-GL\0"), Some("RM551E-GL".into()));
        assert_eq!(text(b"\0\0"), None);
    }
}
