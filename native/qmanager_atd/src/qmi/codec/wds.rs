//! WDS (service 1) decoders and the broker-internal request builders.
//! Fixtures from the RM551E, 2026-10-22 / 2026-10-23.
//!
//! - 0x002A Get Profile List  TLV 0x01 `{n u8; type u8, index u8, name_len
//!   u8, name}`. Names only: the APN is not in this message.
//! - 0x0024 Get Packet Statistics (broker-internal, on a bound client only)
//!   request TLV 0x01 `mask u32` (bit 6 tx bytes, bit 7 rx bytes); response
//!   TLV 0x19 `tx_ok_bytes u64`, TLV 0x1A `rx_ok_bytes u64`. Without a call
//!   on the client's IP family the result is 0x000F (out of call) and only
//!   the last-call TLVs 0x1B / 0x1C come back.
//! - 0x00A2 Bind Mux Data Port  TLV 0x10 `{ep_type u32, iface_id u32}`,
//!   TLV 0x11 `mux_id u8`. 0x00AF Bind Subscription TLV 0x01 `u32` (1 =
//!   primary). 0x004D Set Client IP Family TLV 0x01 `u8` (4 / 6).

use super::{text, Rd};
use crate::qmi::msg::{Msg, Tlv};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Profile {
    /// 0 = 3GPP, 1 = 3GPP2, 2 = EPC.
    pub profile_type: u8,
    pub index: u8,
    pub name: Option<String>,
}

pub fn profile_list(m: &Msg) -> Vec<Profile> {
    let mut out = Vec::new();
    let mut r = match m.tlv(0x01) {
        Some(v) => Rd::new(v),
        None => return out,
    };
    for _ in 0..r.u8().unwrap_or(0) {
        let p = (|| {
            let profile_type = r.u8()?;
            let index = r.u8()?;
            let l = r.u8()? as usize;
            Some(Profile { profile_type, index, name: text(r.take(l)?) })
        })();
        match p {
            Some(p) => out.push(p),
            None => break,
        }
    }
    out
}

/// QMI_ERR_OUT_OF_CALL: no call on this client's IP family.
pub const ERR_OUT_OF_CALL: u16 = 0x000F;

/// Get Packet Statistics mask: tx ok bytes (bit 6) and rx ok bytes (bit 7).
pub const STATS_MASK_BYTES: u32 = 0x0000_00C0;

/// The data endpoint a bind names (Qualcomm `ds_get_epid`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Endpoint {
    pub ep_type: u32,
    pub iface_id: u32,
}

/// The embedded (IPA) endpoint behind `rmnet_ipa0` / `rmnet_data<N>`.
pub const EP_IPA: Endpoint = Endpoint { ep_type: 4, iface_id: 1 };

pub fn bind_mux_tlvs(ep: Endpoint, mux: u8) -> Vec<Tlv> {
    let mut v = Vec::with_capacity(8);
    v.extend_from_slice(&ep.ep_type.to_le_bytes());
    v.extend_from_slice(&ep.iface_id.to_le_bytes());
    vec![Tlv::new(0x10, &v), Tlv::new(0x11, &[mux])]
}

pub fn bind_subscription_tlvs() -> Vec<Tlv> {
    vec![Tlv::new(0x01, &1u32.to_le_bytes())]
}

pub fn ip_family_tlvs(family: u8) -> Vec<Tlv> {
    vec![Tlv::new(0x01, &[family])]
}

pub fn stats_request_tlvs() -> Vec<Tlv> {
    vec![Tlv::new(0x01, &STATS_MASK_BYTES.to_le_bytes())]
}

/// Ok byte counters of the current call, from a successful 0x0024.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PktBytes {
    pub tx: u64,
    pub rx: u64,
}

/// Both counters, or None when either TLV is missing or short.
pub fn pkt_bytes(m: &Msg) -> Option<PktBytes> {
    let tx = Rd::new(m.tlv(0x19)?).u64()?;
    let rx = Rd::new(m.tlv(0x1A)?).u64()?;
    Some(PktBytes { tx, rx })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::qmi::codec::testfix::{fx, mangled};
    use crate::qmi::msg::{result_tlv, Msg, KIND_RESP};

    #[test]
    fn profile_list_fixture() {
        let p = profile_list(&fx!("r1_1_0x002A"));
        assert_eq!(p.len(), 3);
        assert_eq!((p[0].profile_type, p[0].index, p[0].name.as_deref()), (0, 1, Some("profile1")));
        assert_eq!((p[1].index, p[1].name.as_deref()), (2, Some("profile2")));
        assert_eq!((p[2].index, p[2].name.clone()), (3, None));
    }

    #[test]
    fn truncated_tlvs_never_panic() {
        for base in crate::qmi::codec::testfix::all() {
            for m in mangled(&base) {
                let _ = profile_list(&m);
                let _ = pkt_bytes(&m);
            }
        }
    }

    #[test]
    fn request_tlvs_are_the_device_proven_bytes() {
        let b = bind_mux_tlvs(EP_IPA, 6);
        assert_eq!(b, vec![Tlv::new(0x10, &[4, 0, 0, 0, 1, 0, 0, 0]), Tlv::new(0x11, &[6])]);
        assert_eq!(bind_subscription_tlvs(), vec![Tlv::new(0x01, &[1, 0, 0, 0])]);
        assert_eq!(ip_family_tlvs(6), vec![Tlv::new(0x01, &[6])]);
        assert_eq!(stats_request_tlvs(), vec![Tlv::new(0x01, &[0xC0, 0, 0, 0])]);
    }

    #[test]
    fn packet_stats_decode_the_ok_byte_counters() {
        // 2026-10-23 capture shape: tx 0x19, rx 0x1A, u64 LE.
        let m = Msg {
            kind: KIND_RESP,
            txn: 1,
            id: 0x0024,
            tlvs: vec![result_tlv(None), Tlv::new(0x19, &12_345_678u64.to_le_bytes()), Tlv::new(0x1A, &730_328_803u64.to_le_bytes())],
        };
        assert_eq!(pkt_bytes(&m), Some(PktBytes { tx: 12_345_678, rx: 730_328_803 }));
        // Past 4 GiB: the full u64 survives.
        let big = Msg { tlvs: vec![Tlv::new(0x19, &u64::MAX.to_le_bytes()), Tlv::new(0x1A, &(5u64 << 32).to_le_bytes())], ..m.clone() };
        assert_eq!(pkt_bytes(&big), Some(PktBytes { tx: u64::MAX, rx: 5 << 32 }));
        // A missing or short counter is no reading.
        let short = Msg { tlvs: vec![Tlv::new(0x19, &[1, 2, 3]), Tlv::new(0x1A, &1u64.to_le_bytes())], ..m.clone() };
        assert_eq!(pkt_bytes(&short), None);
        let last_call_only = Msg { tlvs: vec![Tlv::new(0x1B, &0u64.to_le_bytes()), Tlv::new(0x1C, &0u64.to_le_bytes())], ..m };
        assert_eq!(pkt_bytes(&last_call_only), None);
    }
}
