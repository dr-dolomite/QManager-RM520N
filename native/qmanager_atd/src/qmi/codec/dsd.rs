//! DSD (service 42) decoders. Fixtures from the RM551E, 2026-10-22 (NSA).
//!
//! 0x0024 Get System Status:
//! - TLV 0x10 available systems `{n u8; tech u32, rat u32, so_mask u64}`
//! - TLV 0x11 per-APN systems `{n u8; apn_len u8, apn, n u8, systems..}`
//!   with the same 16-byte system element
//!
//! The element layout was recovered from the fixture (the 3-APN list
//! consumes the TLV exactly). `rat` 3 = LTE and 6 = NR5G is inferred: the
//! NSA network lists LTE for ims/sos and LTE + 6 for internet. `so_mask` is
//! reported raw. TLVs 0x12 / 0x13 (current/previous) are not decoded.

use super::{text, Rd};
use crate::qmi::msg::Msg;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DsdSystem {
    /// 0 = 3GPP.
    pub tech: u32,
    pub rat: u32,
    pub so_mask: u64,
}

impl DsdSystem {
    pub fn rat_str(&self) -> &'static str {
        match self.rat {
            3 => "lte",
            6 => "nr5g",
            _ => "other",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ApnSystems {
    pub apn: Option<String>,
    pub systems: Vec<DsdSystem>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SystemStatus {
    pub available: Vec<DsdSystem>,
    pub apns: Vec<ApnSystems>,
}

fn systems(r: &mut Rd) -> Vec<DsdSystem> {
    let mut v = Vec::new();
    for _ in 0..r.u8().unwrap_or(0) {
        let s = (|| Some(DsdSystem { tech: r.u32()?, rat: r.u32()?, so_mask: r.u64()? }))();
        match s {
            Some(s) => v.push(s),
            None => break,
        }
    }
    v
}

pub fn system_status(m: &Msg) -> SystemStatus {
    let mut out = SystemStatus::default();
    if let Some(v) = m.tlv(0x10) {
        out.available = systems(&mut Rd::new(v));
    }
    if let Some(v) = m.tlv(0x11) {
        let mut r = Rd::new(v);
        for _ in 0..r.u8().unwrap_or(0) {
            let a = (|| {
                let l = r.u8()? as usize;
                let apn = text(r.take(l)?);
                Some(ApnSystems { apn, systems: systems(&mut r) })
            })();
            match a {
                Some(a) => out.apns.push(a),
                None => break,
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::qmi::codec::testfix::{fx, mangled};

    #[test]
    fn system_status_fixture() {
        let s = system_status(&fx!("r1_42_0x0024"));
        let rats: Vec<_> = s.available.iter().map(|x| x.rat_str()).collect();
        assert_eq!(rats, ["nr5g", "lte"]);
        assert_eq!(s.apns.len(), 3);
        let names: Vec<_> = s.apns.iter().map(|a| a.apn.as_deref().unwrap()).collect();
        assert_eq!(names, ["ims", "internet", "sos"]);
        assert_eq!(s.apns[0].systems.len(), 1);
        assert_eq!(s.apns[1].systems.len(), 2);
        assert_eq!(s.apns[0].systems[0], DsdSystem { tech: 0, rat: 3, so_mask: 0x1000 });
        assert_eq!(s.apns[2].systems[0].rat_str(), "lte");
    }

    #[test]
    fn truncated_tlvs_never_panic() {
        for base in crate::qmi::codec::testfix::all() {
            for m in mangled(&base) {
                let _ = system_status(&m);
            }
        }
    }
}
