//! NAS (service 3) decoders.
//!
//! Device-verified against an RM551E (R02A01), 2026-10-22, and AT ground
//! truth (`AT+QENG="servingcell"`, `AT+QCAINFO`):
//! - 0x0024 Get Serving System   TLV 0x01 / 0x10 / 0x12
//! - 0x0043 Get Cell Location    TLV 0x13 (LTE intra), 0x27, 0x2E
//! - 0x0031 Get RF Band Info     TLV 0x11 (else 0x01), 0x12
//! - 0x00AC Get LTE CPHY CA Info TLV 0x13, 0x15 / 0x19, 0x16, 0x17
//! - 0x004F Get Signal Info      TLV 0x14, 0x17, 0x18 (values are CACHED)
//! - 0x0020 Get Signal Strength  TLV 0x01
//!
//! Not decoded: 0x0043 inter-frequency neighbours (TLV 0x14), timing
//! advance (no TLV tracked AT consistently), 0x0034 / 0x004D / 0x005A.

use super::{plmn3, text, Rat, Rd};
use crate::qmi::msg::Msg;

// ---------------------------------------------------------------- bands

/// A 3GPP band: LTE `B<n>` or NR `N<n>`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Band {
    pub nr: bool,
    pub num: u16,
}

impl Band {
    pub fn label(&self) -> String {
        format!("{}{}", if self.nr { "N" } else { "B" }, self.num)
    }
}

/// QMI NAS active band class to a 3GPP band. The enum is not linear.
/// Verified on device: 120=B1, 122=B3, 142=B40, 149=B41; the rest follows
/// libqmi's QmiNasActiveBand. NR (250..) is untested (NSA reports its NR
/// carrier through ARFCN only).
pub fn band_from_class(class: u16) -> Option<Band> {
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
        120..=249 => LTE.get((class - 120) as usize).map(|n| Band { nr: false, num: *n }),
        250..=400 => NR.get((class - 250) as usize).map(|n| Band { nr: true, num: *n }),
        _ => None,
    }
}

/// LTE channel bandwidth enum (RF band info TLV 0x12 and the CA carriers;
/// the same enum as `AT+QENG` DL_bw) to whole MHz. 1.4 MHz rounds to 1, as
/// parse_at.sh does. Verified: 5 = 20 MHz (QCAINFO 100 RB), 4 = 15 MHz.
pub fn lte_bw_mhz(e: u32) -> Option<u32> {
    match e {
        0 => Some(1),
        1 => Some(3),
        2 => Some(5),
        3 => Some(10),
        4 => Some(15),
        5 => Some(20),
        _ => None,
    }
}

// ---------------------------------------------------------- 0x0024 serving

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RegState {
    NotRegistered,
    Registered,
    Searching,
    Denied,
    Unknown,
}

impl RegState {
    pub fn from_u8(v: u8) -> RegState {
        match v {
            0 => RegState::NotRegistered,
            1 => RegState::Registered,
            2 => RegState::Searching,
            3 => RegState::Denied,
            _ => RegState::Unknown,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            RegState::NotRegistered => "not_registered",
            RegState::Registered => "registered",
            RegState::Searching => "searching",
            RegState::Denied => "denied",
            RegState::Unknown => "unknown",
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ServingSystem {
    pub reg: Option<RegState>,
    /// QMI attach state: 1 attached, 2 detached, anything else unknown.
    pub cs_attached: Option<bool>,
    pub ps_attached: Option<bool>,
    /// Radio interfaces in use (NSA reports LTE only: NR is not listed).
    pub rats: Vec<Rat>,
    /// TLV 0x10 roaming indicator: 0 = roaming, 1 = home (value 1 seen on
    /// the home network).
    pub roaming: Option<bool>,
    /// TLV 0x12 current PLMN; the MNC is numeric here, so a leading zero
    /// is lost (the cell location PLMN keeps it).
    pub mcc: Option<u16>,
    pub mnc: Option<u16>,
    pub operator: Option<String>,
}

fn attach(v: u8) -> Option<bool> {
    match v {
        1 => Some(true),
        2 => Some(false),
        _ => None,
    }
}

pub fn serving_system(m: &Msg) -> ServingSystem {
    let mut s = ServingSystem::default();
    if let Some(v) = m.tlv(0x01) {
        let mut r = Rd::new(v);
        if let (Some(reg), Some(cs), Some(ps), Some(_net)) = (r.u8(), r.u8(), r.u8(), r.u8()) {
            s.reg = Some(RegState::from_u8(reg));
            s.cs_attached = attach(cs);
            s.ps_attached = attach(ps);
            if let Some(n) = r.u8() {
                for _ in 0..n {
                    match r.u8() {
                        Some(x) => s.rats.push(Rat::from_u8(x)),
                        None => break,
                    }
                }
            }
        }
    }
    if let Some(v) = m.tlv(0x10) {
        s.roaming = match v.first() {
            Some(0) => Some(true),
            Some(1) => Some(false),
            _ => None,
        };
    }
    if let Some(v) = m.tlv(0x12) {
        let mut r = Rd::new(v);
        if let (Some(mcc), Some(mnc)) = (r.u16(), r.u16()) {
            s.mcc = Some(mcc);
            s.mnc = Some(mnc);
            if let Some(l) = r.u8() {
                s.operator = r.take(l as usize).and_then(text);
            }
        }
    }
    s
}

// ------------------------------------------------------- 0x0043 cell location

/// One row of the LTE intra-frequency cell list. Signal in 0.1 dB(m).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CellRow {
    pub pci: u16,
    pub rsrq_x10: i16,
    pub rsrp_x10: i16,
    pub rssi_x10: i16,
    pub srxlev: i16,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LteServingCell {
    pub idle: u8,
    pub mcc: u16,
    pub mnc: u16,
    pub mnc_digits: u8,
    pub tac: u16,
    /// 28-bit E-UTRAN cell identity (eNB id << 8 | sector).
    pub cell_id: u32,
    /// TLV 0x27 (u32) when present, else the u16 in TLV 0x13.
    pub earfcn: u32,
    pub pci: u16,
    pub rows: Vec<CellRow>,
}

impl LteServingCell {
    /// The row for the serving PCI, the live signal reading.
    pub fn serving_row(&self) -> Option<&CellRow> {
        self.rows.iter().find(|r| r.pci == self.pci)
    }
}

/// NR5G serving cell (TLV 0x2F). UNTESTED: an NSA network does not send
/// it, so this has never been seen on a device. The identity layout
/// (PLMN, 24-bit TAC, u64 cell id, PCI) is from the REA IDL. The trailing
/// RSRQ/RSRP/SNR i16s are NOT decoded: their units are unconfirmed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Nr5gServingCell {
    pub mcc: u16,
    pub mnc: u16,
    pub mnc_digits: u8,
    pub tac: u32,
    pub cell_id: u64,
    pub pci: u16,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CellLocation {
    pub lte: Option<LteServingCell>,
    /// TLV 0x2E: NR ARFCN of the NSA carrier (matches AT).
    pub nr_arfcn: Option<u32>,
    pub nr: Option<Nr5gServingCell>,
}

pub fn cell_location(m: &Msg) -> CellLocation {
    let mut c = CellLocation::default();
    if let Some(v) = m.tlv(0x13) {
        c.lte = lte_intra(v, m.tlv(0x27));
    }
    c.nr_arfcn = m.tlv(0x2e).and_then(|v| Rd::new(v).u32());
    // UNTESTED (see Nr5gServingCell).
    c.nr = m.tlv(0x2f).and_then(nr5g_serving);
    c
}

fn lte_intra(v: &[u8], earfcn32: Option<&[u8]>) -> Option<LteServingCell> {
    let mut r = Rd::new(v);
    let idle = r.u8()?;
    let (mcc, mnc, mnc_digits) = plmn3(r.take(3)?)?;
    let tac = r.u16()?;
    let cell_id = r.u32()?;
    let earfcn16 = r.u16()?;
    let pci = r.u16()?;
    let mut rows = Vec::new();
    // cell reselection priority, s_non_intra_search, thresh_serving_low,
    // s_intra_search, then the row count.
    if r.skip(4).is_some() {
        if let Some(n) = r.u8() {
            for _ in 0..n {
                let row = (|| {
                    Some(CellRow {
                        pci: r.u16()?,
                        rsrq_x10: r.i16()?,
                        rsrp_x10: r.i16()?,
                        rssi_x10: r.i16()?,
                        srxlev: r.i16()?,
                    })
                })();
                match row {
                    Some(row) => rows.push(row),
                    None => break,
                }
            }
        }
    }
    let earfcn = earfcn32.and_then(|b| Rd::new(b).u32()).unwrap_or(earfcn16 as u32);
    Some(LteServingCell { idle, mcc, mnc, mnc_digits, tac, cell_id, earfcn, pci, rows })
}

/// UNTESTED (see Nr5gServingCell).
fn nr5g_serving(v: &[u8]) -> Option<Nr5gServingCell> {
    let mut r = Rd::new(v);
    let (mcc, mnc, mnc_digits) = plmn3(r.take(3)?)?;
    let t = r.take(3)?;
    let tac = t[0] as u32 | (t[1] as u32) << 8 | (t[2] as u32) << 16;
    let cell_id = r.u64()?;
    let pci = r.u16()?;
    Some(Nr5gServingCell { mcc, mnc, mnc_digits, tac, cell_id, pci })
}

// ---------------------------------------------------------- 0x0031 RF band

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RfBand {
    pub rat: Rat,
    pub band_class: u16,
    /// EARFCN / ARFCN.
    pub channel: u32,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct RfBandInfo {
    pub bands: Vec<RfBand>,
    /// TLV 0x12: `(rat, bandwidth enum)`. The enum is the LTE one for LTE;
    /// the NR enum is unconfirmed, so the model reports LTE only.
    pub bandwidths: Vec<(Rat, u32)>,
}

pub fn rf_band_info(m: &Msg) -> RfBandInfo {
    let mut out = RfBandInfo::default();
    let list = |t: u8, wide: bool| -> Option<Vec<RfBand>> {
        let mut r = Rd::new(m.tlv(t)?);
        let n = r.u8()?;
        let mut v = Vec::new();
        for _ in 0..n {
            let e = (|| {
                let rat = Rat::from_u8(r.u8()?);
                let band_class = r.u16()?;
                let channel = if wide { r.u32()? } else { r.u16()? as u32 };
                Some(RfBand { rat, band_class, channel })
            })();
            match e {
                Some(e) => v.push(e),
                None => break,
            }
        }
        Some(v)
    };
    // 0x11 is the extended list (u32 channel); 0x01 the legacy one.
    out.bands = list(0x11, true).or_else(|| list(0x01, false)).unwrap_or_default();
    if let Some(v) = m.tlv(0x12) {
        let mut r = Rd::new(v);
        if let Some(n) = r.u8() {
            for _ in 0..n {
                match (r.u8(), r.u32()) {
                    (Some(rat), Some(bw)) => out.bandwidths.push((Rat::from_u8(rat), bw)),
                    _ => break,
                }
            }
        }
    }
    out
}

// -------------------------------------------------------------- 0x00AC CA

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CaCarrier {
    pub pci: u16,
    pub earfcn: u32,
    pub bw_enum: u32,
    pub band_class: u16,
    /// SCell state (0 deconfigured, 1 configured, 2 activated). None on
    /// the PCell.
    pub state: Option<u32>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct LteCa {
    pub pcell: Option<CaCarrier>,
    /// Every SCell the modem lists (any state; the model keeps 1 and 2).
    pub scells: Vec<CaCarrier>,
}

/// Layout on RM551E R02A01 (matched against AT+QCAINFO): 0x13 PCell
/// `{pci u16, earfcn u16, bw u32, band u16}`; 0x16 the PCell EARFCN as u32;
/// 0x15 SCell list `{n u8; pci u16, earfcn u16, bw u32, band u16, state u32,
/// idx u8}`; 0x19 the same with a u32 EARFCN and a trailing pad byte
/// (18-byte entries); 0x17 the SCell EARFCNs as u32 (`{n u8; u32 ..}`).
pub fn lte_ca(m: &Msg) -> LteCa {
    let mut ca = LteCa::default();
    if let Some(v) = m.tlv(0x13) {
        let mut r = Rd::new(v);
        ca.pcell = (|| {
            Some(CaCarrier {
                pci: r.u16()?,
                earfcn: r.u16()? as u32,
                bw_enum: r.u32()?,
                band_class: r.u16()?,
                state: None,
            })
        })();
    }
    if let (Some(p), Some(e)) = (ca.pcell.as_mut(), m.tlv(0x16).and_then(|v| Rd::new(v).u32())) {
        p.earfcn = e;
    }
    // 0x15 is present in every sample; 0x19 only sometimes. Take whichever
    // lists more carriers (0x15 on a tie).
    let narrow = m.tlv(0x15).map(|v| scell_list(v, false)).unwrap_or_default();
    let wide = m.tlv(0x19).map(|v| scell_list(v, true)).unwrap_or_default();
    if wide.len() > narrow.len() {
        ca.scells = wide;
    } else {
        ca.scells = narrow;
        if let Some(v) = m.tlv(0x17) {
            let mut r = Rd::new(v);
            if r.u8().map(|n| n as usize) == Some(ca.scells.len()) {
                for s in ca.scells.iter_mut() {
                    match r.u32() {
                        Some(e) => s.earfcn = e,
                        None => break,
                    }
                }
            }
        }
    }
    ca
}

fn scell_list(v: &[u8], wide: bool) -> Vec<CaCarrier> {
    let mut r = Rd::new(v);
    let mut out = Vec::new();
    let n = match r.u8() {
        Some(n) => n,
        None => return out,
    };
    for _ in 0..n {
        let e = (|| {
            let pci = r.u16()?;
            let earfcn = if wide { r.u32()? } else { r.u16()? as u32 };
            let bw_enum = r.u32()?;
            let band_class = r.u16()?;
            let state = r.u32()?;
            r.u8()?; // index
            if wide {
                r.u8()?; // pad
            }
            Some(CaCarrier { pci, earfcn, bw_enum, band_class, state: Some(state) })
        })();
        match e {
            Some(e) => out.push(e),
            None => break,
        }
    }
    out
}

// --------------------------------------------------- 0x004F / 0x0020 signal

/// LTE values of Signal Info. CACHED by the modem (4 distinct RSRP values
/// in 30 minutes): never the live reading. SINR in 0.1 dB; i16::MIN is
/// the "invalid" sentinel and becomes None.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LteSigInfo {
    pub rssi: i8,
    pub rsrq: i8,
    pub rsrp: i16,
    pub sinr_x10: Option<i16>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct NrSigInfo {
    pub rsrp: Option<i16>,
    pub sinr_x10: Option<i16>,
    pub rsrq: Option<i16>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SignalInfo {
    pub lte: Option<LteSigInfo>,
    pub nr: Option<NrSigInfo>,
}

fn valid(v: Option<i16>) -> Option<i16> {
    v.filter(|x| *x != i16::MIN)
}

pub fn signal_info(m: &Msg) -> SignalInfo {
    let mut s = SignalInfo::default();
    if let Some(v) = m.tlv(0x14) {
        let mut r = Rd::new(v);
        s.lte = (|| {
            Some(LteSigInfo { rssi: r.i8()?, rsrq: r.i8()?, rsrp: r.i16()?, sinr_x10: valid(r.i16()) })
        })();
    }
    let nr_ie = m.tlv(0x17).map(|v| {
        let mut r = Rd::new(v);
        (valid(r.i16()), valid(r.i16()))
    });
    let nr_rsrq = m.tlv(0x18).and_then(|v| valid(Rd::new(v).i16()));
    if nr_ie.is_some() || nr_rsrq.is_some() {
        let (rsrp, sinr) = nr_ie.unwrap_or((None, None));
        s.nr = Some(NrSigInfo { rsrp, sinr_x10: sinr, rsrq: nr_rsrq });
    }
    s
}

/// 0x0020: TLV 0x01 `{strength i8 dBm, radio interface u8}`. The RSSI of
/// the strongest RAT; the model does not use it for LTE (0x0043 and 0x004F
/// carry more).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[allow(dead_code)] // decoded, not yet rendered by any read
pub struct SignalStrength {
    pub dbm: i8,
    pub rat: Rat,
}

#[allow(dead_code)] // decoded, not yet rendered by any read
pub fn signal_strength(m: &Msg) -> Option<SignalStrength> {
    let mut r = Rd::new(m.tlv(0x01)?);
    Some(SignalStrength { dbm: r.i8()?, rat: Rat::from_u8(r.u8()?) })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::qmi::codec::testfix::{fx, mangled};

    #[test]
    fn band_table_is_non_linear() {
        for (class, label) in [(120, "B1"), (122, "B3"), (142, "B40"), (149, "B41"), (143, "B18"), (166, "B71")] {
            assert_eq!(band_from_class(class).unwrap().label(), label, "class {class}");
        }
        assert_eq!(band_from_class(259).unwrap().label(), "N41");
        assert_eq!(band_from_class(250).unwrap().label(), "N1");
        assert_eq!(band_from_class(119), None);
        assert_eq!(band_from_class(180), None);
        assert_eq!(band_from_class(65535), None);
        assert_eq!(band_from_class(0), None);
    }

    #[test]
    fn bandwidth_enum() {
        assert_eq!(lte_bw_mhz(5), Some(20));
        assert_eq!(lte_bw_mhz(4), Some(15));
        assert_eq!(lte_bw_mhz(0), Some(1));
        assert_eq!(lte_bw_mhz(9), None);
    }

    #[test]
    fn serving_system_fixture() {
        let s = serving_system(&fx!("r1_3_0x0024"));
        assert_eq!(s.reg, Some(RegState::Registered));
        assert_eq!((s.cs_attached, s.ps_attached), (Some(true), Some(true)));
        assert_eq!(s.rats, vec![Rat::Lte]);
        assert_eq!(s.roaming, Some(false));
        assert_eq!((s.mcc, s.mnc, s.operator.as_deref()), (Some(515), Some(3), Some("TNT")));
        let s = serving_system(&fx!("serving_searching"));
        assert_eq!(s.reg, Some(RegState::Searching));
        assert_eq!(s.ps_attached, Some(false));
        assert!(s.rats.is_empty());
    }

    #[test]
    fn cell_location_fixture() {
        let c = cell_location(&fx!("r1_3_0x0043"));
        let l = c.lte.unwrap();
        // ECI and TAC are synthetic in the committed fixture.
        assert_eq!((l.pci, l.earfcn, l.tac, l.cell_id), (295, 150, 0x1234, 0x0123_4501));
        assert_eq!((l.mcc, l.mnc, l.mnc_digits), (515, 3, 2));
        assert_eq!(l.idle, 0);
        assert_eq!(c.nr_arfcn, Some(528030));
        assert!(c.nr.is_none(), "NSA sends no TLV 0x2F");
        let row = l.serving_row().unwrap();
        assert_eq!((row.rsrp_x10, row.rsrq_x10, row.rssi_x10), (-900, -74, -628));
        // The three rounds against the AT ground truth (QENG rsrp/rsrq/rssi).
        for (m, at) in [
            (fx!("r1_3_0x0043"), (-90, -7, -62)),
            (fx!("r2_3_0x0043"), (-90, -7, -62)),
            (fx!("r3_3_0x0043"), (-88, -10, -56)),
        ] {
            let row = *cell_location(&m).lte.unwrap().serving_row().unwrap();
            assert!((row.rsrp_x10 as i32 / 10 - at.0).abs() <= 2, "rsrp {row:?} vs {at:?}");
            assert!((row.rsrq_x10 as i32 / 10 - at.1).abs() <= 2, "rsrq {row:?}");
            assert!((row.rssi_x10 as i32 / 10 - at.2).abs() <= 2, "rssi {row:?}");
        }
    }

    #[test]
    fn earfcn32_wins_over_u16() {
        let mut m = fx!("r1_3_0x0043");
        for t in m.tlvs.iter_mut() {
            if t.t == 0x27 {
                t.v = 70000u32.to_le_bytes().to_vec();
            }
        }
        assert_eq!(cell_location(&m).lte.unwrap().earfcn, 70000);
        m.tlvs.retain(|t| t.t != 0x27);
        assert_eq!(cell_location(&m).lte.unwrap().earfcn, 150);
    }

    #[test]
    fn nr5g_serving_untested_layout() {
        // plmn 515-03, tac 0x010203, cell id 0x1122334455, pci 500.
        let mut v = vec![0x15, 0xf5, 0x30, 0x03, 0x02, 0x01];
        v.extend_from_slice(&0x11_2233_4455u64.to_le_bytes());
        v.extend_from_slice(&500u16.to_le_bytes());
        v.extend_from_slice(&[0, 0, 0, 0, 0, 0]);
        let mut m = fx!("r1_3_0x0043");
        m.tlvs.push(crate::qmi::msg::Tlv { t: 0x2f, v });
        let n = cell_location(&m).nr.unwrap();
        assert_eq!((n.pci, n.tac, n.cell_id, n.mcc, n.mnc), (500, 0x010203, 0x11_2233_4455, 515, 3));
    }

    #[test]
    fn rf_band_info_fixture() {
        let r = rf_band_info(&fx!("r1_3_0x0031"));
        assert_eq!(r.bands, vec![RfBand { rat: Rat::Lte, band_class: 120, channel: 150 }]);
        assert_eq!(r.bandwidths, vec![(Rat::Lte, 5)]);
        // The legacy list is used when the extended one is absent.
        let mut m = fx!("r1_3_0x0031");
        m.tlvs.retain(|t| t.t != 0x11);
        assert_eq!(rf_band_info(&m).bands, r.bands);
    }

    #[test]
    fn ca_zero_and_pcell_only() {
        assert_eq!(lte_ca(&Msg { kind: 2, txn: 1, id: 0, tlvs: vec![] }), LteCa::default());
        let ca = lte_ca(&fx!("r1_3_0x00AC"));
        let p = ca.pcell.unwrap();
        assert_eq!((p.pci, p.earfcn, p.bw_enum, p.band_class), (295, 150, 5, 120));
        assert!(ca.scells.is_empty());
    }

    #[test]
    fn ca_narrow_scell_list_with_earfcn32() {
        let ca = lte_ca(&fx!("ca_0x15_two_scells"));
        let p = ca.pcell.unwrap();
        assert_eq!((p.pci, p.earfcn, p.band_class), (295, 1350, 122));
        assert_eq!(ca.scells.len(), 2);
        assert_eq!((ca.scells[0].earfcn, ca.scells[0].band_class, ca.scells[0].bw_enum), (150, 120, 5));
        assert_eq!((ca.scells[1].earfcn, ca.scells[1].band_class, ca.scells[1].state), (39965, 149, Some(1)));
    }

    #[test]
    fn ca_wide_scell_list() {
        let ca = lte_ca(&fx!("ca_0x19_wide_scell"));
        assert_eq!(ca.scells.len(), 1);
        let s = ca.scells[0];
        assert_eq!((s.pci, s.earfcn, s.bw_enum, s.band_class, s.state), (295, 39965, 4, 149, Some(2)));
    }

    #[test]
    fn signal_info_fixture_is_cached_data() {
        let s = signal_info(&fx!("r1_3_0x004F"));
        let l = s.lte.unwrap();
        assert_eq!((l.rssi, l.rsrq, l.rsrp, l.sinr_x10), (-61, -9, -92, Some(264)));
        let n = s.nr.unwrap();
        assert_eq!((n.rsrp, n.sinr_x10, n.rsrq), (Some(-89), Some(250), Some(-11)));
    }

    #[test]
    fn signal_info_sentinel_is_none() {
        let mut m = fx!("r1_3_0x004F");
        for t in m.tlvs.iter_mut() {
            if t.t == 0x17 {
                t.v = vec![0xa7, 0xff, 0x00, 0x80];
            }
        }
        assert_eq!(signal_info(&m).nr.unwrap().sinr_x10, None);
    }

    #[test]
    fn signal_strength_fixture() {
        let s = signal_strength(&fx!("r1_3_0x0020")).unwrap();
        assert_eq!((s.dbm, s.rat), (-61, Rat::Lte));
    }

    #[test]
    fn truncated_tlvs_never_panic() {
        for base in crate::qmi::codec::testfix::all() {
            for m in mangled(&base) {
                let _ = serving_system(&m);
                let _ = cell_location(&m);
                let _ = rf_band_info(&m);
                let _ = lte_ca(&m);
                let _ = signal_info(&m);
                let _ = signal_strength(&m);
            }
        }
    }
}
