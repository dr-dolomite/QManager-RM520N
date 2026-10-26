//! The normalised QMI model: codec structs turned into QManager's own
//! vocabulary, and the per-read JSON the `qmi` client prints (the
//! `{"v":1,"ok":..}` envelope is added around it by the QMI verb, not here).
//!
//! Conventions, matching `parse_at.sh`:
//! - bands are `"B41"` (LTE) / `"N41"` (NR); bandwidth is whole MHz
//!   (1.4 MHz rounds to 1); signal is whole dBm/dB plus a 0.1 dB field;
//! - an absent value is JSON `null`, never `NaN`, `N/A` or an empty string.
//!
//! The two rules that matter to consumers:
//! - **Registration gate.** Every signal field is `None` unless NAS serving
//!   system says `registered` (or serving could not be read). A modem that is
//!   searching still answers cell location with a stale serving row.
//! - **Freshness tag.** Each signal reading carries `source`:
//!   `cell_location` (NAS 0x0043 serving row, live) or `signal_info`
//!   (NAS 0x004F, cached by the modem: a handful of values per half hour).
//!   Live is preferred per metric; SINR and all NR values exist only as
//!   `signal_info`.

use super::codec::nas::{self, CellLocation, LteCa, RfBandInfo, SignalInfo};
use super::codec::{dms, dsd, uim, wds, Rat};
use super::error::QmiError;
use super::msg::Msg;
use super::{SVC_DMS, SVC_DSD, SVC_NAS, SVC_UIM, SVC_WDS};
use crate::common::json::{arr, J};

pub use nas::{RegState as Registration, ServingSystem};

// ---------------------------------------------------------------- signal

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Source {
    CellLocation,
    SignalInfo,
}

impl Source {
    pub fn as_str(self) -> &'static str {
        match self {
            Source::CellLocation => "cell_location",
            Source::SignalInfo => "signal_info",
        }
    }

    /// True when the modem computed the value at request time.
    #[allow(dead_code)] // freshness helper for consumers of the tags
    pub fn is_live(self) -> bool {
        self == Source::CellLocation
    }
}

/// One signal metric: tenths of a dB(m) and where it came from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Reading {
    pub x10: i32,
    pub source: Source,
}

impl Reading {
    /// Whole dB(m), rounded half away from zero.
    pub fn whole(&self) -> i32 {
        if self.x10 >= 0 {
            (self.x10 + 5) / 10
        } else {
            -((-self.x10 + 5) / 10)
        }
    }

    pub fn json(&self) -> String {
        let mut j = J::obj();
        j.num("value", self.whole()).num("x10", self.x10).str("source", self.source.as_str());
        j.done()
    }
}

// Plausible ranges in tenths; anything outside is an invalid-value
// sentinel from the modem and becomes None.
fn ok_rsrp(x: i32) -> bool {
    (-1500..0).contains(&x)
}
fn ok_rsrq(x: i32) -> bool {
    (-400..0).contains(&x)
}
fn ok_rssi(x: i32) -> bool {
    (-1300..0).contains(&x)
}
fn ok_sinr(x: i32) -> bool {
    (-300..=500).contains(&x)
}

fn pick(live: Option<i32>, cached: Option<i32>, ok: fn(i32) -> bool) -> Option<Reading> {
    if let Some(x) = live.filter(|x| ok(*x)) {
        return Some(Reading { x10: x, source: Source::CellLocation });
    }
    cached.filter(|x| ok(*x)).map(|x| Reading { x10: x, source: Source::SignalInfo })
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct LteSignal {
    pub rsrp: Option<Reading>,
    pub rsrq: Option<Reading>,
    pub rssi: Option<Reading>,
    pub sinr: Option<Reading>,
}

/// NR (NSA) readings. Always `signal_info`, hence cached.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct NrSignal {
    pub rsrp: Option<Reading>,
    pub rsrq: Option<Reading>,
    pub sinr: Option<Reading>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Signal {
    pub registration: Registration,
    pub lte: Option<LteSignal>,
    pub nr: Option<NrSignal>,
}

impl Signal {
    /// Builds the signal block. `reg` is the serving system's registration
    /// (`Unknown` if serving could not be read); anything but `Registered`
    /// yields no readings.
    pub fn build(reg: Registration, cell: Option<&CellLocation>, info: Option<&SignalInfo>) -> Signal {
        let mut s = Signal { registration: reg, lte: None, nr: None };
        if reg != Registration::Registered {
            return s;
        }
        let row = cell.and_then(|c| c.lte.as_ref()).and_then(|l| l.serving_row());
        let li = info.and_then(|i| i.lte);
        let lte = LteSignal {
            rsrp: pick(row.map(|r| r.rsrp_x10 as i32), li.map(|l| l.rsrp as i32 * 10), ok_rsrp),
            rsrq: pick(row.map(|r| r.rsrq_x10 as i32), li.map(|l| l.rsrq as i32 * 10), ok_rsrq),
            rssi: pick(row.map(|r| r.rssi_x10 as i32), li.map(|l| l.rssi as i32 * 10), ok_rssi),
            sinr: pick(None, li.and_then(|l| l.sinr_x10).map(|v| v as i32), ok_sinr),
        };
        if lte != LteSignal::default() {
            s.lte = Some(lte);
        }
        if let Some(n) = info.and_then(|i| i.nr) {
            let nr = NrSignal {
                rsrp: pick(None, n.rsrp.map(|v| v as i32 * 10), ok_rsrp),
                rsrq: pick(None, n.rsrq.map(|v| v as i32 * 10), ok_rsrq),
                sinr: pick(None, n.sinr_x10.map(|v| v as i32), ok_sinr),
            };
            if nr != NrSignal::default() {
                s.nr = Some(nr);
            }
        }
        s
    }

    pub fn json(&self) -> String {
        let m = |r: &Option<Reading>| r.as_ref().map(|r| r.json()).unwrap_or_else(|| "null".into());
        let mut j = J::obj();
        j.str("registration", self.registration.as_str());
        match &self.lte {
            Some(l) => {
                let mut o = J::obj();
                o.raw("rsrp", &m(&l.rsrp)).raw("rsrq", &m(&l.rsrq)).raw("rssi", &m(&l.rssi)).raw("sinr", &m(&l.sinr));
                j.raw("lte", &o.done())
            }
            None => j.null("lte"),
        };
        match &self.nr {
            Some(n) => {
                let mut o = J::obj();
                o.raw("rsrp", &m(&n.rsrp)).raw("rsrq", &m(&n.rsrq)).raw("sinr", &m(&n.sinr));
                j.raw("nr", &o.done())
            }
            None => j.null("nr"),
        };
        j.done()
    }
}

// ------------------------------------------------------------------ cell

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LteCell {
    pub pci: u16,
    pub earfcn: u32,
    pub tac: u16,
    /// 28-bit ECI.
    pub cell_id: u32,
    pub enodeb_id: u32,
    pub sector_id: u32,
    /// Exact digit strings ("515", "03").
    pub mcc: String,
    pub mnc: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NrCell {
    pub arfcn: Option<u32>,
    /// From the untested NR5G serving TLV; None in NSA.
    pub pci: Option<u16>,
    pub tac: Option<u32>,
    pub cell_id: Option<u64>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Cell {
    pub lte: Option<LteCell>,
    pub nr: Option<NrCell>,
}

fn mcc_mnc(mcc: u16, mnc: u16, digits: u8) -> (String, String) {
    (format!("{:03}", mcc), format!("{:0w$}", mnc, w = digits as usize))
}

impl Cell {
    pub fn from_codec(c: &CellLocation) -> Cell {
        let lte = c.lte.as_ref().map(|l| {
            let (mcc, mnc) = mcc_mnc(l.mcc, l.mnc, l.mnc_digits);
            LteCell {
                pci: l.pci,
                earfcn: l.earfcn,
                tac: l.tac,
                cell_id: l.cell_id,
                enodeb_id: l.cell_id >> 8,
                sector_id: l.cell_id & 0xff,
                mcc,
                mnc,
            }
        });
        let nr = if c.nr_arfcn.is_some() || c.nr.is_some() {
            Some(NrCell {
                arfcn: c.nr_arfcn,
                pci: c.nr.as_ref().map(|n| n.pci),
                tac: c.nr.as_ref().map(|n| n.tac),
                cell_id: c.nr.as_ref().map(|n| n.cell_id),
            })
        } else {
            None
        };
        Cell { lte, nr }
    }

    pub fn json(&self) -> String {
        let mut j = J::obj();
        match &self.lte {
            Some(l) => {
                let mut o = J::obj();
                o.num("pci", l.pci)
                    .num("earfcn", l.earfcn)
                    .num("tac", l.tac)
                    .num("cell_id", l.cell_id)
                    .num("enodeb_id", l.enodeb_id)
                    .num("sector_id", l.sector_id)
                    .str("mcc", &l.mcc)
                    .str("mnc", &l.mnc);
                j.raw("lte", &o.done())
            }
            None => j.null("lte"),
        };
        match &self.nr {
            Some(n) => {
                let mut o = J::obj();
                o.opt_num("arfcn", n.arfcn).opt_num("pci", n.pci).opt_num("tac", n.tac).opt_num("cell_id", n.cell_id);
                j.raw("nr", &o.done())
            }
            None => j.null("nr"),
        };
        j.done()
    }
}

// -------------------------------------------------------------------- ca

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Carrier {
    /// "PCC" or "SCC".
    pub kind: &'static str,
    pub pci: u16,
    pub earfcn: u32,
    pub band: Option<String>,
    pub bandwidth_mhz: Option<u32>,
    /// Always true for the PCC; for an SCC, QMI state 2 (activated) as
    /// opposed to 1 (configured, not activated).
    pub active: bool,
}

/// LTE carrier aggregation. `carriers` is the PCC followed by every
/// configured or activated SCC (so, like `AT+QCAINFO`, the count is at
/// least 1 when LTE is up). NR SCCs are not in this message.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Ca {
    pub carriers: Vec<Carrier>,
}

impl Ca {
    pub fn from_codec(c: &LteCa) -> Ca {
        let mk = |x: &nas::CaCarrier, kind: &'static str, active: bool| Carrier {
            kind,
            pci: x.pci,
            earfcn: x.earfcn,
            band: nas::band_from_class(x.band_class).map(|b| b.label()),
            bandwidth_mhz: nas::lte_bw_mhz(x.bw_enum),
            active,
        };
        let mut carriers = Vec::new();
        if let Some(p) = &c.pcell {
            carriers.push(mk(p, "PCC", true));
        }
        for s in &c.scells {
            if matches!(s.state, Some(1) | Some(2)) {
                carriers.push(mk(s, "SCC", s.state == Some(2)));
            }
        }
        Ca { carriers }
    }

    pub fn count(&self) -> usize {
        self.carriers.len()
    }

    pub fn pcc(&self) -> Option<&Carrier> {
        self.carriers.first().filter(|c| c.kind == "PCC")
    }

    pub fn json(&self) -> String {
        let items: Vec<String> = self
            .carriers
            .iter()
            .map(|c| {
                let mut o = J::obj();
                o.str("type", c.kind)
                    .str("technology", "LTE")
                    .opt_str("band", c.band.as_deref())
                    .num("earfcn", c.earfcn)
                    .opt_num("bandwidth_mhz", c.bandwidth_mhz)
                    .num("pci", c.pci)
                    .boolean("active", c.active);
                o.done()
            })
            .collect();
        let mut j = J::obj();
        j.num("count", self.count()).raw("carriers", &arr(&items));
        j.done()
    }
}

// -------------------------------------------------------------------- rf

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RfEntry {
    pub rat: &'static str,
    pub band: Option<String>,
    pub channel: u32,
    /// LTE only; the NR bandwidth enum is unconfirmed.
    pub bandwidth_mhz: Option<u32>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Rf {
    pub entries: Vec<RfEntry>,
}

impl Rf {
    pub fn from_codec(r: &RfBandInfo) -> Rf {
        let mut seen: Vec<(Rat, usize)> = Vec::new();
        let entries = r
            .bands
            .iter()
            .map(|b| {
                // The nth band of a RAT pairs with the nth bandwidth of it.
                let nth = seen.iter().find(|(r, _)| *r == b.rat).map(|(_, n)| *n).unwrap_or(0);
                match seen.iter_mut().find(|(r, _)| *r == b.rat) {
                    Some(e) => e.1 += 1,
                    None => seen.push((b.rat, 1)),
                }
                let bw = r.bandwidths.iter().filter(|(rat, _)| *rat == b.rat).nth(nth).map(|(_, e)| *e);
                RfEntry {
                    rat: b.rat.as_str(),
                    band: nas::band_from_class(b.band_class).map(|x| x.label()),
                    channel: b.channel,
                    bandwidth_mhz: if b.rat == Rat::Lte { bw.and_then(nas::lte_bw_mhz) } else { None },
                }
            })
            .collect();
        Rf { entries }
    }

    pub fn json(&self) -> String {
        let items: Vec<String> = self
            .entries
            .iter()
            .map(|e| {
                let mut o = J::obj();
                o.str("rat", e.rat).opt_str("band", e.band.as_deref()).num("channel", e.channel).opt_num("bandwidth_mhz", e.bandwidth_mhz);
                o.done()
            })
            .collect();
        let mut j = J::obj();
        j.raw("bands", &arr(&items));
        j.done()
    }
}

// ---------------------------------------------------------------- bundle

/// The raw responses a bundle is built from; `None` when that request
/// failed. `sig_info` is optional extra (SINR, NR, fallback).
#[derive(Clone, Copy, Default)]
pub struct Inputs<'a> {
    pub serving: Option<&'a Msg>,
    pub cell: Option<&'a Msg>,
    pub ca: Option<&'a Msg>,
    pub rf: Option<&'a Msg>,
    pub sig_info: Option<&'a Msg>,
}

/// The poller-shaped read: serving + cell + CA + RF + Signal Info, plus the
/// signal block derived from them (Signal Info adds SINR and NR; it is live
/// while the broker holds the NAS signal config).
#[derive(Clone, Debug)]
pub struct Bundle {
    pub serving: Option<ServingSystem>,
    pub cell: Option<Cell>,
    pub signal: Signal,
    pub ca: Option<Ca>,
    pub rf: Option<Rf>,
}

impl Bundle {
    pub fn build(i: &Inputs) -> Bundle {
        let serving = i.serving.map(nas::serving_system);
        let cell_c = i.cell.map(nas::cell_location);
        let info = i.sig_info.map(nas::signal_info);
        let reg = serving.as_ref().and_then(|s| s.reg).unwrap_or(Registration::Unknown);
        Bundle {
            signal: Signal::build(reg, cell_c.as_ref(), info.as_ref()),
            cell: cell_c.as_ref().map(Cell::from_codec),
            ca: i.ca.map(|m| Ca::from_codec(&nas::lte_ca(m))),
            rf: i.rf.map(|m| Rf::from_codec(&nas::rf_band_info(m))),
            serving,
        }
    }

    pub fn registered(&self) -> bool {
        self.signal.registration == Registration::Registered
    }

    /// Band and bandwidth of the serving LTE carrier: the RF entry on the
    /// serving EARFCN (else the first LTE entry), falling back to the CA
    /// PCC when RF info is missing.
    pub fn lte_band(&self) -> (Option<String>, Option<u32>) {
        let earfcn = self.cell.as_ref().and_then(|c| c.lte.as_ref()).map(|l| l.earfcn);
        if let Some(rf) = &self.rf {
            let lte = || rf.entries.iter().filter(|e| e.rat == "lte");
            let e = lte().find(|e| Some(e.channel) == earfcn).or_else(|| lte().next());
            if let Some(e) = e {
                return (e.band.clone(), e.bandwidth_mhz);
            }
        }
        match self.ca.as_ref().and_then(|c| c.pcc()) {
            Some(p) if earfcn.is_none() || earfcn == Some(p.earfcn) => (p.band.clone(), p.bandwidth_mhz),
            _ => (None, None),
        }
    }

    pub fn json(&self) -> String {
        let mut j = J::obj();
        match &self.serving {
            Some(s) => j.raw("serving", &serving_json(s)),
            None => j.null("serving"),
        };
        j.raw("signal", &self.signal.json());
        match &self.cell {
            Some(c) => j.raw("cell", &c.json()),
            None => j.null("cell"),
        };
        match &self.ca {
            Some(c) => j.raw("ca", &c.json()),
            None => j.null("ca"),
        };
        match &self.rf {
            Some(r) => j.raw("rf", &r.json()),
            None => j.null("rf"),
        };
        j.done()
    }
}

// ----------------------------------------------------------- JSON per read

pub fn serving_json(s: &ServingSystem) -> String {
    let rats: Vec<String> = s.rats.iter().map(|r| format!("\"{}\"", r.as_str())).collect();
    let mut j = J::obj();
    j.str("registration", s.reg.unwrap_or(Registration::Unknown).as_str())
        .opt_bool("cs_attached", s.cs_attached)
        .opt_bool("ps_attached", s.ps_attached)
        .raw("rats", &arr(&rats))
        .opt_bool("roaming", s.roaming)
        .opt_num("mcc", s.mcc)
        .opt_num("mnc", s.mnc)
        .opt_str("operator", s.operator.as_deref());
    j.done()
}

pub fn ids_json(i: &dms::Ids) -> String {
    let mut j = J::obj();
    j.opt_str("imei", i.imei.as_deref())
        .opt_str("imei_sv", i.imei_sv.as_deref())
        .opt_str("esn", i.esn.as_deref())
        .opt_str("meid", i.meid.as_deref());
    j.done()
}

pub fn rev_json(model: Option<&str>, revision: Option<&str>) -> String {
    let mut j = J::obj();
    j.opt_str("model", model).opt_str("revision", revision);
    j.done()
}

pub fn opmode_json(m: Option<dms::OpMode>) -> String {
    let mut j = J::obj();
    j.opt_str("mode", m.map(|m| m.as_str())).opt_num("code", m.map(|m| m.code()));
    j.done()
}

pub fn time_json(t: Option<&dms::DeviceTime>) -> String {
    let mut j = J::obj();
    j.opt_num("unix_s", t.map(|t| t.unix_s()))
        .opt_num("ms_since_gps_epoch", t.map(|t| t.ms_since_gps_epoch))
        .opt_num("source", t.map(|t| t.source));
    j.done()
}

pub fn card_json(c: &uim::CardStatus) -> String {
    let cards: Vec<String> = c
        .cards
        .iter()
        .map(|c| {
            let apps: Vec<String> = c
                .apps
                .iter()
                .map(|a| {
                    let mut o = J::obj();
                    o.str("type", a.type_str()).str("state", a.state_str()).str("pin1", a.pin1_str());
                    o.done()
                })
                .collect();
            let mut o = J::obj();
            o.str("state", c.state.as_str()).num("error_code", c.error_code).raw("apps", &arr(&apps));
            o.done()
        })
        .collect();
    let mut j = J::obj();
    j.raw("cards", &arr(&cards));
    j.done()
}

pub fn slots_json(s: &uim::SlotsStatus) -> String {
    let slots: Vec<String> = s
        .slots
        .iter()
        .map(|s| {
            let mut o = J::obj();
            o.str("card", s.card_str())
                .boolean("active", s.active)
                .opt_num("logical_slot", if s.active { Some(s.logical_slot) } else { None })
                .opt_str("iccid", s.iccid.as_deref());
            o.done()
        })
        .collect();
    let mut j = J::obj();
    j.raw("slots", &arr(&slots));
    j.done()
}

pub fn profiles_json(p: &[wds::Profile]) -> String {
    let items: Vec<String> = p
        .iter()
        .map(|p| {
            let t = match p.profile_type {
                0 => "3gpp",
                1 => "3gpp2",
                2 => "epc",
                _ => "other",
            };
            let mut o = J::obj();
            o.str("type", t).num("index", p.index).opt_str("name", p.name.as_deref());
            o.done()
        })
        .collect();
    let mut j = J::obj();
    j.raw("profiles", &arr(&items));
    j.done()
}

fn dsd_systems(s: &[dsd::DsdSystem]) -> String {
    let items: Vec<String> = s
        .iter()
        .map(|x| {
            let mut o = J::obj();
            o.str("rat", x.rat_str()).num("rat_code", x.rat).num("tech", x.tech).num("so_mask", x.so_mask);
            o.done()
        })
        .collect();
    arr(&items)
}

pub fn dsd_json(s: &dsd::SystemStatus) -> String {
    let apns: Vec<String> = s
        .apns
        .iter()
        .map(|a| {
            let mut o = J::obj();
            o.opt_str("apn", a.apn.as_deref()).raw("systems", &dsd_systems(&a.systems));
            o.done()
        })
        .collect();
    let mut j = J::obj();
    j.raw("available", &dsd_systems(&s.available)).raw("apns", &arr(&apns));
    j.done()
}

// ---------------------------------------------------------------- reads

/// The reads of `qmi <read>`, plus `bundle`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Read {
    Serving,
    Signal,
    Cell,
    Ca,
    Rf,
    Ids,
    Rev,
    Opmode,
    Time,
    Card,
    Slots,
    Profiles,
    Dsd,
    Bundle,
}

impl Read {
    pub const ALL: [Read; 14] = [
        Read::Serving,
        Read::Signal,
        Read::Cell,
        Read::Ca,
        Read::Rf,
        Read::Ids,
        Read::Rev,
        Read::Opmode,
        Read::Time,
        Read::Card,
        Read::Slots,
        Read::Profiles,
        Read::Dsd,
        Read::Bundle,
    ];

    pub fn name(self) -> &'static str {
        match self {
            Read::Serving => "serving",
            Read::Signal => "signal",
            Read::Cell => "cell",
            Read::Ca => "ca",
            Read::Rf => "rf",
            Read::Ids => "ids",
            Read::Rev => "rev",
            Read::Opmode => "opmode",
            Read::Time => "time",
            Read::Card => "card",
            Read::Slots => "slots",
            Read::Profiles => "profiles",
            Read::Dsd => "dsd",
            Read::Bundle => "bundle",
        }
    }

    pub fn parse(s: &str) -> Option<Read> {
        Read::ALL.iter().copied().find(|r| r.name() == s)
    }

    /// The `(service, message)` requests the read issues, all on the
    /// read-only allow-list.
    pub fn requests(self) -> &'static [(u32, u16)] {
        match self {
            Read::Serving => &[(SVC_NAS, 0x0024)],
            // serving gates, cell is the live reading, signal info the
            // cached SINR / NR / fallback.
            Read::Signal => &[(SVC_NAS, 0x0024), (SVC_NAS, 0x0043), (SVC_NAS, 0x004F)],
            Read::Cell => &[(SVC_NAS, 0x0043)],
            Read::Ca => &[(SVC_NAS, 0x00AC)],
            Read::Rf => &[(SVC_NAS, 0x0031)],
            Read::Ids => &[(SVC_DMS, 0x0025)],
            Read::Rev => &[(SVC_DMS, 0x0022), (SVC_DMS, 0x0023)],
            Read::Opmode => &[(SVC_DMS, 0x002D)],
            Read::Time => &[(SVC_DMS, 0x002F)],
            Read::Card => &[(SVC_UIM, 0x002F)],
            Read::Slots => &[(SVC_UIM, 0x0047)],
            Read::Profiles => &[(SVC_WDS, 0x002A)],
            Read::Dsd => &[(SVC_DSD, 0x0024)],
            Read::Bundle => &[(SVC_NAS, 0x0024), (SVC_NAS, 0x0043), (SVC_NAS, 0x00AC), (SVC_NAS, 0x0031), (SVC_NAS, 0x004F)],
        }
    }
}

/// Issues one request: the registry's `request` (or a fixture in tests).
pub type Fetch<'a> = &'a dyn Fn(u32, u16) -> Result<Msg, QmiError>;

/// Runs one read and renders its JSON object. A single-request read fails
/// with that request's error. In a multi-request read the first request is
/// the primary one (its failure fails the read, except `rev` and `bundle`,
/// which fail only if every request does); a failed secondary request
/// leaves its part null / ungated-to-unknown.
pub fn run(fetch: Fetch, read: Read) -> Result<String, QmiError> {
    let q = |i: usize| {
        let (svc, id) = read.requests()[i];
        fetch(svc, id)
    };
    Ok(match read {
        Read::Serving => serving_json(&nas::serving_system(&q(0)?)),
        Read::Cell => Cell::from_codec(&nas::cell_location(&q(0)?)).json(),
        Read::Ca => Ca::from_codec(&nas::lte_ca(&q(0)?)).json(),
        Read::Rf => Rf::from_codec(&nas::rf_band_info(&q(0)?)).json(),
        Read::Ids => ids_json(&dms::ids(&q(0)?)),
        Read::Opmode => opmode_json(dms::op_mode(&q(0)?)),
        Read::Time => time_json(dms::time(&q(0)?).as_ref()),
        Read::Card => card_json(&uim::card_status(&q(0)?)),
        Read::Slots => slots_json(&uim::slots_status(&q(0)?)),
        Read::Profiles => profiles_json(&wds::profile_list(&q(0)?)),
        Read::Dsd => dsd_json(&dsd::system_status(&q(0)?)),
        Read::Rev => {
            let (m, r) = (q(0), q(1));
            if let (Err(e), Err(_)) = (&m, &r) {
                return Err(e.clone());
            }
            let m = m.ok().and_then(|m| dms::string_tlv(&m));
            let r = r.ok().and_then(|m| dms::string_tlv(&m));
            rev_json(m.as_deref(), r.as_deref())
        }
        Read::Signal => {
            // Fetched exactly once each: re-fetching to recover the error
            // could succeed the second time (NAS recovering) and must never
            // be unwrapped.
            let (serving, cell, info) = (q(0), q(1), q(2));
            if let (Err(e), Err(_), Err(_)) = (&serving, &cell, &info) {
                return Err(e.clone());
            }
            let (serving, cell, info) = (serving.ok(), cell.ok(), info.ok());
            Bundle::build(&Inputs { serving: serving.as_ref(), cell: cell.as_ref(), sig_info: info.as_ref(), ..Inputs::default() })
                .signal
                .json()
        }
        Read::Bundle => bundle(fetch)?.json(),
    })
}

/// The poller-shaped read as a struct (the snapshot sampler needs the values,
/// not only the JSON). Fails only if all five requests fail, with the first
/// one's error; a failed part is `None` / null.
pub fn bundle(fetch: Fetch) -> Result<Bundle, QmiError> {
    let r: Vec<Result<Msg, QmiError>> = Read::Bundle.requests().iter().map(|&(svc, id)| fetch(svc, id)).collect();
    let mut first_err = None;
    for x in &r {
        match x {
            Ok(_) => {
                first_err = None;
                break;
            }
            Err(e) if first_err.is_none() => first_err = Some(e.clone()),
            Err(_) => {}
        }
    }
    if let Some(e) = first_err {
        return Err(e);
    }
    let m: Vec<Option<Msg>> = r.into_iter().map(|x| x.ok()).collect();
    let part = |i: usize| m.get(i).and_then(|x| x.as_ref());
    Ok(Bundle::build(&Inputs { serving: part(0), cell: part(1), ca: part(2), rf: part(3), sig_info: part(4) }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::qmi::codec::testfix::{all, fx, mangled};

    fn bundle_r1() -> Bundle {
        Bundle::build(&Inputs {
            serving: Some(&fx!("r1_3_0x0024")),
            cell: Some(&fx!("r1_3_0x0043")),
            ca: Some(&fx!("r1_3_0x00AC")),
            rf: Some(&fx!("r1_3_0x0031")),
            sig_info: None,
        })
    }

    #[test]
    fn bundle_matches_probe_output_and_at_truth() {
        // Expected: r1_json.txt (the probe's decoding of the same round) and
        // AT+QENG / AT+QCAINFO (PCI 295, EARFCN 150, B1, 20 MHz, RSRP -90).
        let b = bundle_r1();
        assert!(b.registered());
        let l = b.cell.as_ref().unwrap().lte.as_ref().unwrap();
        assert_eq!((l.pci, l.earfcn), (295, 150));
        assert_eq!((l.mcc.as_str(), l.mnc.as_str()), ("515", "03"));
        // Synthetic ECI 0x01234501 and TAC 0x1234 in the committed fixture.
        assert_eq!((l.cell_id, l.enodeb_id, l.sector_id, l.tac), (0x0123_4501, 0x01_2345, 1, 0x1234));
        assert_eq!(b.lte_band(), (Some("B1".to_string()), Some(20)));
        let lte = b.signal.lte.unwrap();
        let rsrp = lte.rsrp.unwrap();
        assert_eq!((rsrp.x10, rsrp.whole(), rsrp.source), (-900, -90, Source::CellLocation));
        assert!(rsrp.source.is_live());
        assert_eq!(lte.rsrq.unwrap().x10, -74);
        assert_eq!(lte.rssi.unwrap().whole(), -63);
        assert!(lte.sinr.is_none(), "SINR exists only in cached Signal Info");
        assert!(b.signal.nr.is_none());
        let ca = b.ca.unwrap();
        assert_eq!(ca.count(), 1);
        let p = ca.pcc().unwrap();
        assert_eq!((p.band.as_deref(), p.earfcn, p.bandwidth_mhz, p.pci), (Some("B1"), 150, Some(20), 295));
        let n = b.cell.unwrap().nr.unwrap();
        assert_eq!((n.arfcn, n.pci), (Some(528030), None));
    }

    #[test]
    fn bundle_json_exact() {
        let j = bundle_r1().json();
        assert_eq!(
            j,
            concat!(
                "{\"serving\":{\"registration\":\"registered\",\"cs_attached\":true,\"ps_attached\":true,\"rats\":[\"lte\"],",
                "\"roaming\":false,\"mcc\":515,\"mnc\":3,\"operator\":\"TNT\"},",
                "\"signal\":{\"registration\":\"registered\",\"lte\":{",
                "\"rsrp\":{\"value\":-90,\"x10\":-900,\"source\":\"cell_location\"},",
                "\"rsrq\":{\"value\":-7,\"x10\":-74,\"source\":\"cell_location\"},",
                "\"rssi\":{\"value\":-63,\"x10\":-628,\"source\":\"cell_location\"},\"sinr\":null},\"nr\":null},",
                "\"cell\":{\"lte\":{\"pci\":295,\"earfcn\":150,\"tac\":4660,\"cell_id\":19088641,\"enodeb_id\":74565,",
                "\"sector_id\":1,\"mcc\":\"515\",\"mnc\":\"03\"},\"nr\":{\"arfcn\":528030,\"pci\":null,\"tac\":null,\"cell_id\":null}},",
                "\"ca\":{\"count\":1,\"carriers\":[{\"type\":\"PCC\",\"technology\":\"LTE\",\"band\":\"B1\",\"earfcn\":150,",
                "\"bandwidth_mhz\":20,\"pci\":295,\"active\":true}]},",
                "\"rf\":{\"bands\":[{\"rat\":\"lte\",\"band\":\"B1\",\"channel\":150,\"bandwidth_mhz\":20}]}}"
            )
        );
    }

    #[test]
    fn signal_info_is_tagged_cached_and_fills_sinr_and_nr() {
        let b = Bundle::build(&Inputs {
            serving: Some(&fx!("r1_3_0x0024")),
            cell: Some(&fx!("r1_3_0x0043")),
            sig_info: Some(&fx!("r1_3_0x004F")),
            ..Inputs::default()
        });
        let l = b.signal.lte.unwrap();
        // Live wins for rsrp; the cached SINR is tagged as cached.
        assert_eq!(l.rsrp.unwrap().source, Source::CellLocation);
        let sinr = l.sinr.unwrap();
        assert_eq!((sinr.x10, sinr.whole(), sinr.source), (264, 26, Source::SignalInfo));
        assert!(!sinr.source.is_live());
        let n = b.signal.nr.unwrap();
        assert_eq!((n.rsrp.unwrap().whole(), n.sinr.unwrap().x10, n.rsrq.unwrap().whole()), (-89, 250, -11));
        assert_eq!(n.rsrp.unwrap().source, Source::SignalInfo);
    }

    #[test]
    fn signal_info_alone_is_the_fallback_when_cell_location_fails() {
        let b = Bundle::build(&Inputs {
            serving: Some(&fx!("r1_3_0x0024")),
            sig_info: Some(&fx!("r1_3_0x004F")),
            ..Inputs::default()
        });
        let r = b.signal.lte.unwrap().rsrp.unwrap();
        assert_eq!((r.whole(), r.source), (-92, Source::SignalInfo));
    }

    #[test]
    fn registration_gate_nulls_signal() {
        for serving in [Some(fx!("serving_searching")), None] {
            let b = Bundle::build(&Inputs {
                serving: serving.as_ref(),
                cell: Some(&fx!("r1_3_0x0043")),
                ca: Some(&fx!("r1_3_0x00AC")),
                rf: Some(&fx!("r1_3_0x0031")),
                sig_info: Some(&fx!("r1_3_0x004F")),
            });
            assert!(!b.registered());
            assert!(b.signal.lte.is_none() && b.signal.nr.is_none());
            let j = b.signal.json();
            assert!(j.contains("\"lte\":null,\"nr\":null"), "{j}");
            // Identity is not gated: the consumer decides with `registered`.
            assert!(b.cell.unwrap().lte.is_some());
        }
        let b = Bundle::build(&Inputs { serving: Some(&fx!("serving_searching")), ..Inputs::default() });
        assert!(b.json().contains("\"registration\":\"searching\""));
    }

    #[test]
    fn invalid_sentinel_readings_become_null() {
        let mut cell = fx!("r1_3_0x0043");
        // Zero the serving row's rsrp (0 is "not measured").
        for t in cell.tlvs.iter_mut() {
            if t.t == 0x13 {
                let n = t.v.len();
                t.v[n - 6] = 0;
                t.v[n - 5] = 0;
            }
        }
        let b = Bundle::build(&Inputs {
            serving: Some(&fx!("r1_3_0x0024")),
            cell: Some(&cell),
            ..Inputs::default()
        });
        let l = b.signal.lte.unwrap();
        assert!(l.rsrp.is_none());
        assert!(l.rsrq.is_some());
    }

    #[test]
    fn rounding_is_half_away_from_zero() {
        let r = |x10| Reading { x10, source: Source::SignalInfo }.whole();
        assert_eq!((r(-884), r(-885), r(-886), r(-5), r(5), r(0), r(264)), (-88, -89, -89, -1, 1, 0, 26));
    }

    #[test]
    fn ca_layouts_and_counts() {
        let ca = Ca::from_codec(&nas::lte_ca(&fx!("ca_0x15_two_scells")));
        assert_eq!(ca.count(), 3);
        let s: Vec<_> = ca.carriers.iter().map(|c| (c.kind, c.band.clone().unwrap(), c.bandwidth_mhz.unwrap(), c.active)).collect();
        assert_eq!(
            s,
            vec![
                ("PCC", "B3".to_string(), 15, true),
                ("SCC", "B1".to_string(), 20, false),
                ("SCC", "B41".to_string(), 15, false)
            ]
        );
        let ca = Ca::from_codec(&nas::lte_ca(&fx!("ca_0x19_wide_scell")));
        assert_eq!(ca.count(), 2);
        assert_eq!((ca.carriers[1].earfcn, ca.carriers[1].active), (39965, true));
        // A deconfigured SCell (state 0) is not a carrier.
        let ca = Ca::from_codec(&nas::lte_ca(&fx!("ca_0x15_deconfigured")));
        assert_eq!(ca.count(), 1);
        // Nothing at all.
        let ca = Ca::from_codec(&nas::lte_ca(&Msg { kind: 2, txn: 1, id: 0, tlvs: vec![] }));
        assert_eq!(ca.count(), 0);
        assert!(ca.json().starts_with("{\"count\":0,\"carriers\":[]"));
    }

    #[test]
    fn lte_band_falls_back_to_ca_pcc() {
        let b = Bundle::build(&Inputs {
            serving: Some(&fx!("r1_3_0x0024")),
            cell: Some(&fx!("r1_3_0x0043")),
            ca: Some(&fx!("r1_3_0x00AC")),
            ..Inputs::default()
        });
        assert_eq!(b.lte_band(), (Some("B1".to_string()), Some(20)));
        let b = Bundle::build(&Inputs::default());
        assert_eq!(b.lte_band(), (None, None));
    }

    /// One request answered from the r1 fixtures.
    fn r1(svc: u32, id: u16) -> Result<Msg, QmiError> {
        {
            let m = match (svc, id) {
                (3, 0x0020) => fx!("r1_3_0x0020"),
                (3, 0x0024) => fx!("r1_3_0x0024"),
                (3, 0x0031) => fx!("r1_3_0x0031"),
                (3, 0x0043) => fx!("r1_3_0x0043"),
                (3, 0x004F) => fx!("r1_3_0x004F"),
                (3, 0x00AC) => fx!("r1_3_0x00AC"),
                (2, 0x0022) => fx!("r1_2_0x0022"),
                (2, 0x0023) => fx!("r1_2_0x0023"),
                (2, 0x0025) => fx!("r1_2_0x0025"),
                (2, 0x002D) => fx!("r1_2_0x002D"),
                (2, 0x002F) => fx!("r1_2_0x002F"),
                (11, 0x002F) => fx!("r1_11_0x002F"),
                (11, 0x0047) => fx!("r1_11_0x0047"),
                (1, 0x002A) => fx!("r1_1_0x002A"),
                (42, 0x0024) => fx!("r1_42_0x0024"),
                _ => return Err(QmiError::NotSupported(None)),
            };
            m.into_result()
        }
    }

    /// Runs `read` against the r1 fixtures.
    fn run_r1(read: Read) -> Result<String, QmiError> {
        run(&r1, read)
    }

    #[test]
    fn every_read_renders_valid_clean_json() {
        for r in Read::ALL {
            let j = run_r1(r).unwrap_or_else(|e| panic!("{}: {e:?}", r.name()));
            assert!(j.starts_with('{') && j.ends_with('}'), "{}: {j}", r.name());
            assert_clean(&j);
            assert_eq!(Read::parse(r.name()), Some(r));
            for (svc, id) in r.requests() {
                assert!(crate::qmi::allow::client_allowed(*svc, *id), "{} {svc} {id:#x}", r.name());
            }
        }
        assert_eq!(Read::parse("nope"), None);
    }

    fn assert_clean(j: &str) {
        for bad in ["NaN", "N/A", "Infinity", ":inf", "None", "undefined", ":,", ",,", "[,", ",]", ",}", ":}"] {
            assert!(!j.contains(bad), "{bad:?} in {j}");
        }
        // Brackets and quotes balance outside strings.
        let (mut depth, mut in_str, mut esc) = (0i32, false, false);
        for c in j.chars() {
            if in_str {
                match (esc, c) {
                    (true, _) => esc = false,
                    (false, '\\') => esc = true,
                    (false, '"') => in_str = false,
                    _ => {}
                }
            } else {
                match c {
                    '"' => in_str = true,
                    '{' | '[' => depth += 1,
                    '}' | ']' => depth -= 1,
                    _ => {}
                }
                assert!(depth >= 0, "{j}");
            }
        }
        assert!(depth == 0 && !in_str, "{j}");
    }

    #[test]
    fn read_outputs() {
        assert_eq!(
            run_r1(Read::Opmode).unwrap(),
            "{\"mode\":\"online\",\"code\":0}"
        );
        assert_eq!(
            run_r1(Read::Rev).unwrap(),
            "{\"model\":\"RM551E-GL\",\"revision\":\"RM551EGL00AAR02A01M8G\"}"
        );
        assert_eq!(
            run_r1(Read::Ids).unwrap(),
            "{\"imei\":\"490154203237518\",\"imei_sv\":\"28\",\"esn\":null,\"meid\":null}"
        );
        assert_eq!(
            run_r1(Read::Profiles).unwrap(),
            concat!(
                "{\"profiles\":[{\"type\":\"3gpp\",\"index\":1,\"name\":\"profile1\"},",
                "{\"type\":\"3gpp\",\"index\":2,\"name\":\"profile2\"},{\"type\":\"3gpp\",\"index\":3,\"name\":null}]}"
            )
        );
        assert_eq!(
            run_r1(Read::Card).unwrap(),
            "{\"cards\":[{\"state\":\"present\",\"error_code\":0,\"apps\":[{\"type\":\"usim\",\"state\":\"ready\",\"pin1\":\"disabled\"}]}]}"
        );
        assert_eq!(
            run_r1(Read::Slots).unwrap(),
            concat!(
                "{\"slots\":[{\"card\":\"present\",\"active\":true,\"logical_slot\":1,\"iccid\":\"89630300000000000015\"},",
                "{\"card\":\"absent\",\"active\":false,\"logical_slot\":null,\"iccid\":null}]}"
            )
        );
        let t = run_r1(Read::Time).unwrap();
        assert!(t.starts_with("{\"unix_s\":1792"), "{t}");
        let s = run_r1(Read::Signal).unwrap();
        assert!(s.contains("\"sinr\":{\"value\":26,\"x10\":264,\"source\":\"signal_info\"}"), "{s}");
        assert!(s.contains("\"nr\":{\"rsrp\":{\"value\":-89,"), "{s}");
    }

    #[test]
    fn partial_failures() {
        // Cell fails, serving + signal info succeed: still a signal block.
        let f = |svc: u32, id: u16| match (svc, id) {
            (3, 0x0024) => fx!("r1_3_0x0024").into_result(),
            (3, 0x004F) => fx!("r1_3_0x004F").into_result(),
            _ => Err(QmiError::Timeout),
        };
        let s = run(&f, Read::Signal).unwrap();
        assert!(s.contains("\"source\":\"signal_info\""), "{s}");
        // Bundle with only serving: other parts null.
        let b = run(&f, Read::Bundle).unwrap();
        assert!(b.contains("\"cell\":null,\"ca\":null,\"rf\":null"), "{b}");
        // Everything failing is an error; a single-request read fails alone.
        let none = |_: u32, _: u16| -> Result<Msg, QmiError> { Err(QmiError::Unavailable) };
        assert_eq!(run(&none, Read::Bundle).unwrap_err(), QmiError::Unavailable);
        assert_eq!(run(&none, Read::Signal).unwrap_err(), QmiError::Unavailable);
        assert_eq!(run(&none, Read::Rev).unwrap_err(), QmiError::Unavailable);
        assert_eq!(run(&f, Read::Cell).unwrap_err(), QmiError::Timeout);
        // A failing result TLV maps through into_result.
        let g = |svc: u32, id: u16| {
            let _ = (svc, id);
            let m = Msg { kind: 2, txn: 1, id: 0x24, tlvs: vec![crate::qmi::msg::result_tlv(Some(0x005E))] };
            m.into_result()
        };
        assert_eq!(run(&g, Read::Serving).unwrap_err(), QmiError::NotSupported(Some(0x005E)));
    }

    #[test]
    fn a_read_whose_fetch_recovers_after_failing_never_panics() {
        // NAS recovering after an SSR: the first N fetches fail, the rest
        // succeed. A read must fail with the first error, never re-fetch
        // and unwrap a success as an error.
        use std::cell::Cell as Count;
        for fails in 1..=4 {
            let n = Count::new(0u32);
            let f = |svc: u32, id: u16| {
                n.set(n.get() + 1);
                if n.get() <= fails {
                    return Err(if n.get() == 1 { QmiError::Timeout } else { QmiError::Unavailable });
                }
                r1(svc, id)
            };
            let reqs = |r: Read| r.requests().len() as u32;
            for read in [Read::Signal, Read::Bundle, Read::Rev] {
                n.set(0);
                let got = run(&f, read);
                if fails >= reqs(read) {
                    assert_eq!(got.unwrap_err(), QmiError::Timeout, "{read:?} fails={fails}");
                } else {
                    assert!(got.is_ok(), "{read:?} fails={fails}");
                }
                assert_eq!(n.get(), reqs(read), "{read:?} fetches each request exactly once");
            }
        }
    }

    #[test]
    fn mangled_messages_render_clean_json_without_panicking() {
        for base in all() {
            for m in mangled(&base) {
                let b = Bundle::build(&Inputs {
                    serving: Some(&m),
                    cell: Some(&m),
                    ca: Some(&m),
                    rf: Some(&m),
                    sig_info: Some(&m),
                });
                assert_clean(&b.json());
                assert_clean(&b.signal.json());
                let _ = b.lte_band();
                assert_clean(&ids_json(&dms::ids(&m)));
                assert_clean(&rev_json(dms::string_tlv(&m).as_deref(), None));
                assert_clean(&opmode_json(dms::op_mode(&m)));
                assert_clean(&time_json(dms::time(&m).as_ref()));
                assert_clean(&card_json(&uim::card_status(&m)));
                assert_clean(&slots_json(&uim::slots_status(&m)));
                assert_clean(&profiles_json(&wds::profile_list(&m)));
                assert_clean(&dsd_json(&dsd::system_status(&m)));
            }
        }
    }

    #[test]
    fn json_strings_are_escaped() {
        let s = ServingSystem { operator: Some("A\"B\\C".into()), ..ServingSystem::default() };
        let j = serving_json(&s);
        assert!(j.contains("\"operator\":\"A\\\"B\\\\C\""), "{j}");
        assert_clean(&j);
    }
}
