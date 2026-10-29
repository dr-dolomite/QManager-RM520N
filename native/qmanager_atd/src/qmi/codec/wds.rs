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
//! - 0x002D Get Runtime Settings (bound client only): request TLV 0x10 `mask u32`.
//!   IPv4 TLVs device-proven 2026-10-29; the IPv6 ones are not (no IPv6 PDN).
//! - 0x00A2 Bind Mux Data Port  TLV 0x10 `{ep_type u32, iface_id u32}`,
//!   TLV 0x11 `mux_id u8`. 0x00AF Bind Subscription TLV 0x01 `u32` (1 =
//!   primary). 0x004D Set Client IP Family TLV 0x01 `u8` (4 / 6).

use super::{text, Rd};
use crate::qmi::msg::{Msg, Tlv};
use std::net::{Ipv4Addr, Ipv6Addr};

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

/// Get Runtime Settings mask: every field the modem reports.
pub const SETTINGS_MASK: u32 = 0x0000_FFFF;

pub fn settings_request_tlvs() -> Vec<Tlv> {
    vec![Tlv::new(0x10, &SETTINGS_MASK.to_le_bytes())]
}

/// The network-provided settings of one IP family's call. An absent TLV, or
/// an all-zero address, is None.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Settings {
    pub ip4: Option<Ipv4Addr>,
    pub gw4: Option<Ipv4Addr>,
    pub mask4: Option<Ipv4Addr>,
    /// Primary, secondary.
    pub dns4: [Option<Ipv4Addr>; 2],
    pub mtu: Option<u32>,
    pub ip6: Option<Ipv6Addr>,
    pub ip6_prefix: Option<u8>,
    pub gw6: Option<Ipv6Addr>,
    pub dns6: [Option<Ipv6Addr>; 2],
}

impl Settings {
    pub fn is_empty(&self) -> bool {
        *self == Settings::default()
    }

    /// The IPv4 client's view with the IPv6 client's fields added; the MTU
    /// is the IPv4 one when both have it.
    pub fn merge(v4: Settings, v6: Settings) -> Settings {
        Settings { mtu: v4.mtu.or(v6.mtu), ip6: v6.ip6, ip6_prefix: v6.ip6_prefix, gw6: v6.gw6, dns6: v6.dns6, ..v4 }
    }
}

/// IPv4 on the wire is a little-endian u32 of the address.
fn addr4(m: &Msg, t: u8) -> Option<Ipv4Addr> {
    let a = Ipv4Addr::from(Rd::new(m.tlv(t)?).u32()?);
    (!a.is_unspecified()).then_some(a)
}

fn addr6(r: &mut Rd) -> Option<Ipv6Addr> {
    let mut o = [0u8; 16];
    o.copy_from_slice(r.take(16)?);
    let a = Ipv6Addr::from(o);
    (!a.is_unspecified()).then_some(a)
}

/// 0x25 / 0x26: 16 address bytes then a prefix length.
fn addr6_prefixed(m: &Msg, t: u8) -> (Option<Ipv6Addr>, Option<u8>) {
    let mut r = match m.tlv(t) {
        Some(b) => Rd::new(b),
        None => return (None, None),
    };
    let a = addr6(&mut r);
    (a, r.u8().filter(|_| a.is_some()))
}

/// Decodes a successful 0x002D; never fails (a short TLV is just absent).
pub fn settings(m: &Msg) -> Settings {
    let (ip6, ip6_prefix) = addr6_prefixed(m, 0x25);
    Settings {
        ip4: addr4(m, 0x1E),
        gw4: addr4(m, 0x20),
        mask4: addr4(m, 0x21),
        dns4: [addr4(m, 0x15), addr4(m, 0x16)],
        mtu: m.tlv(0x29).and_then(|b| Rd::new(b).u32()),
        ip6,
        ip6_prefix,
        gw6: addr6_prefixed(m, 0x26).0,
        dns6: [0x27, 0x28].map(|t| m.tlv(t).and_then(|b| addr6(&mut Rd::new(b)))),
    }
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
                let _ = settings(&m);
            }
        }
    }

    fn resp(tlvs: Vec<Tlv>) -> Msg {
        let mut t = vec![result_tlv(None)];
        t.extend(tlvs);
        Msg { kind: KIND_RESP, txn: 1, id: 0x002D, tlvs: t }
    }

    fn hex(s: &str) -> Vec<u8> {
        (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
    }

    #[test]
    fn settings_request_is_the_device_proven_mask() {
        assert_eq!(settings_request_tlvs(), vec![Tlv::new(0x10, &[0xFF, 0xFF, 0, 0])]);
    }

    #[test]
    fn settings_decode_the_rm520n_ipv4_capture() {
        // 2026-10-29, serial 61368cd2, IPv4 client bound to mux 1. AT+CGCONTRDP:
        // 10.110.187.26, DNS 10.151.151.44 / .48; `ip route`: gw .25, /30.
        let tlvs: Vec<Tlv> = [
            (0x10, "70726f66696c6531"),
            (0x11, "00"),
            (0x15, "2c97970a"),
            (0x16, "3097970a"),
            (0x1d, "00"),
            (0x1e, "1abb6e0a"),
            (0x1f, "0001"),
            (0x20, "19bb6e0a"),
            (0x21, "fcffffff"),
            (0x22, "00"),
            (0x29, "dc050000"),
            (0x2a, "00"),
            (0x2b, "04"),
        ]
        .iter()
        .map(|&(t, h)| Tlv::new(t, &hex(h)))
        .collect();
        let s = settings(&resp(tlvs));
        assert_eq!(s.ip4, Some(Ipv4Addr::new(10, 110, 187, 26)));
        assert_eq!(s.gw4, Some(Ipv4Addr::new(10, 110, 187, 25)));
        assert_eq!(s.mask4, Some(Ipv4Addr::new(255, 255, 255, 252)));
        assert_eq!(s.dns4, [Some(Ipv4Addr::new(10, 151, 151, 44)), Some(Ipv4Addr::new(10, 151, 151, 48))]);
        assert_eq!(s.mtu, Some(1500));
        assert_eq!((s.ip6, s.ip6_prefix, s.gw6, s.dns6), (None, None, None, [None, None]));
    }

    #[test]
    fn settings_decode_ipv6_in_network_order_and_drop_zero_addresses() {
        let a: Ipv6Addr = "2001:db8:1:2::5".parse().unwrap();
        let g: Ipv6Addr = "fe80::1".parse().unwrap();
        let d: Ipv6Addr = "2001:4860:4860::8888".parse().unwrap();
        let with_prefix = |a: Ipv6Addr, p: u8| {
            let mut v = a.octets().to_vec();
            v.push(p);
            v
        };
        let m = resp(vec![
            Tlv::new(0x25, &with_prefix(a, 64)),
            Tlv::new(0x26, &with_prefix(g, 64)),
            Tlv::new(0x27, &d.octets()),
            Tlv::new(0x28, &Ipv6Addr::UNSPECIFIED.octets()),
            Tlv::new(0x1E, &[0, 0, 0, 0]),
            Tlv::new(0x29, &1400u32.to_le_bytes()),
        ]);
        let s = settings(&m);
        assert_eq!((s.ip6, s.ip6_prefix, s.gw6), (Some(a), Some(64), Some(g)));
        assert_eq!(s.dns6, [Some(d), None]);
        assert_eq!((s.ip4, s.mtu), (None, Some(1400)));
    }

    #[test]
    fn settings_short_or_missing_tlvs_are_absent() {
        assert!(settings(&resp(vec![])).is_empty());
        let m = resp(vec![Tlv::new(0x1E, &[1, 2, 3]), Tlv::new(0x29, &[0xDC, 5]), Tlv::new(0x25, &[0x20; 10]), Tlv::new(0x27, &[1; 15])]);
        assert!(settings(&m).is_empty());
        // An address without its prefix byte keeps the address, not a prefix.
        let a: Ipv6Addr = "2001:db8::1".parse().unwrap();
        let s = settings(&resp(vec![Tlv::new(0x25, &a.octets())]));
        assert_eq!((s.ip6, s.ip6_prefix), (Some(a), None));
    }

    #[test]
    fn merge_takes_v6_fields_from_the_v6_client_and_mtu_from_v4() {
        let a: Ipv6Addr = "2001:db8::1".parse().unwrap();
        let four = Settings { ip4: Some(Ipv4Addr::new(10, 0, 0, 2)), mtu: Some(1500), ..Settings::default() };
        let six = Settings { ip6: Some(a), ip6_prefix: Some(64), mtu: Some(1400), ..Settings::default() };
        let m = Settings::merge(four, six);
        assert_eq!((m.ip4, m.ip6, m.ip6_prefix, m.mtu), (Some(Ipv4Addr::new(10, 0, 0, 2)), Some(a), Some(64), Some(1500)));
        assert_eq!(Settings::merge(Settings::default(), six).mtu, Some(1400));
        assert!(Settings::merge(Settings::default(), Settings::default()).is_empty());
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
