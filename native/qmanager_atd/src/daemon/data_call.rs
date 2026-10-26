//! The default data call, for the WDS packet-statistics bind (broker 0.6.0).
//!
//! - **Mux id.** The default call's netdev is the `rmnet_data<N>` interface
//!   holding the IPv4 default route (Destination `00000000`, RTF_UP) in
//!   `/proc/net/route`; its mux id is N + 1 (verified on the RM551E,
//!   2026-10-23: rmnet_data0..5 -> mux 1..6, rmnet_data15 -> 16). Several
//!   default routes: the lowest metric wins. No such route: try the IPv6
//!   table (below); neither: no call, so nothing is bound and the sidecar's
//!   WDS values stay empty.
//! - **IPv6-only call.** The mux id belongs to the PDN, not the IP family, so
//!   a call with no IPv4 default route takes its `rmnet_data<N>` from
//!   `/proc/net/ipv6_route` by the same N + 1 rule: the up, non-reject
//!   default route (`::/0`, lowest metric) on an `rmnet_data<N>`; failing
//!   that, the one `rmnet_data<N>` carrying a global-scope route (not
//!   `fe80::/10`, not `ff00::/8`; two such interfaces = ambiguous = none).
//!   The IPv4 mux wins when both exist. `Call::v4` says whether an IPv4
//!   default route backs the mux: without it the sampler binds the IPv6
//!   client alone. (The fallback is unverified on a live v6-only call; the
//!   default route is what a call that sets up its own routes should have.)
//! - **Endpoint.** Qualcomm's `ds_get_epid` maps the netdev family to the
//!   data endpoint: `rmnet_ipa*` -> (4, 1) (embedded / IPA). On this platform
//!   the data netdevs are children of `rmnet_ipa0`, so the bind uses (4, 1)
//!   only while `/sys/class/net/rmnet_ipa0` exists; otherwise nothing is
//!   bound (fail closed).
//!
//! Re-read every sidecar cycle (a small procfs read), so a new call or a
//! moved mux is picked up within one cycle.

use crate::qmi::codec::wds::{Endpoint, EP_IPA};
use std::path::Path;

pub const ROUTE_PATH: &str = "/proc/net/route";
pub const ROUTE6_PATH: &str = "/proc/net/ipv6_route";
pub const IPA_DEV_PATH: &str = "/sys/class/net/rmnet_ipa0";

const RTF_UP: u32 = 0x0001;
const RTF_REJECT: u32 = 0x0200;

/// `rmnet_data<N>` -> mux id N + 1.
fn rmnet_mux(iface: &str) -> Option<u8> {
    iface.strip_prefix("rmnet_data").and_then(|n| n.parse::<u8>().ok()).and_then(|n| n.checked_add(1))
}

/// The mux id of the default IPv4 route's `rmnet_data<N>` netdev.
pub fn default_mux(route: &str) -> Option<u8> {
    let mut best: Option<(u32, u8)> = None;
    for line in route.lines().skip(1) {
        let f: Vec<&str> = line.split_whitespace().collect();
        let (iface, dest, flags, metric) = match (f.first(), f.get(1), f.get(3), f.get(6)) {
            (Some(i), Some(d), Some(fl), Some(m)) => (*i, *d, *fl, *m),
            _ => continue,
        };
        if dest != "00000000" {
            continue;
        }
        match u32::from_str_radix(flags, 16) {
            Ok(fl) if fl & RTF_UP != 0 => {}
            _ => continue,
        }
        let mux = match rmnet_mux(iface) {
            Some(m) => m,
            None => continue,
        };
        let metric = metric.parse::<u32>().unwrap_or(u32::MAX);
        if best.is_none_or(|(bm, _)| metric < bm) {
            best = Some((metric, mux));
        }
    }
    best.map(|(_, m)| m)
}

/// One `/proc/net/ipv6_route` row as (dest, prefix len, metric, flags,
/// iface), all but the interface parsed; short or odd rows are None.
fn route6_row(line: &str) -> Option<(String, u8, u32, u32, &str)> {
    let f: Vec<&str> = line.split_whitespace().collect();
    let dest = f.first()?;
    let plen = u8::from_str_radix(f.get(1)?, 16).ok()?;
    let metric = u32::from_str_radix(f.get(5)?, 16).unwrap_or(u32::MAX);
    let flags = u32::from_str_radix(f.get(8)?, 16).ok()?;
    let iface = f.get(9)?;
    if dest.len() != 32 {
        return None;
    }
    Some((dest.to_ascii_lowercase(), plen, metric, flags, iface))
}

/// The mux id of the up, non-reject IPv6 default route on an
/// `rmnet_data<N>`; the lowest metric wins.
pub fn default_mux6(route6: &str) -> Option<u8> {
    let mut best: Option<(u32, u8)> = None;
    for line in route6.lines() {
        let (dest, plen, metric, flags, iface) = match route6_row(line) {
            Some(r) => r,
            None => continue,
        };
        if plen != 0 || dest.bytes().any(|b| b != b'0') || flags & RTF_UP == 0 || flags & RTF_REJECT != 0 {
            continue;
        }
        let mux = match rmnet_mux(iface) {
            Some(m) => m,
            None => continue,
        };
        if best.is_none_or(|(bm, _)| metric < bm) {
            best = Some((metric, mux));
        }
    }
    best.map(|(_, m)| m)
}

/// Fallback when no default route exists: the mux id of the one
/// `rmnet_data<N>` carrying an up, non-reject global-scope route (not
/// link-local `fe80::/10`, not multicast `ff00::/8`, not the default).
/// Two or more such interfaces are ambiguous: None.
pub fn global_mux6(route6: &str) -> Option<u8> {
    let mut found: Option<u8> = None;
    for line in route6.lines() {
        let (dest, plen, _, flags, iface) = match route6_row(line) {
            Some(r) => r,
            None => continue,
        };
        let link_local = matches!(dest.get(..3), Some("fe8" | "fe9" | "fea" | "feb"));
        if plen == 0 || dest.starts_with("ff") || link_local || flags & RTF_UP == 0 || flags & RTF_REJECT != 0 {
            continue;
        }
        let mux = match rmnet_mux(iface) {
            Some(m) => m,
            None => continue,
        };
        match found {
            Some(m) if m != mux => return None,
            _ => found = Some(mux),
        }
    }
    found
}

/// What the sampler binds to this cycle.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Call {
    /// The default call's mux id; None = no call.
    pub mux: Option<u8>,
    /// An IPv4 default route backs `mux`. False on an IPv6-only call (and
    /// with no call): the sampler then reads the IPv6 client alone.
    pub v4: bool,
    /// The bind endpoint; None = unknown platform, do not bind.
    pub ep: Option<Endpoint>,
}

pub fn discover(route_path: &str, route6_path: &str, ipa_dev: &str) -> Call {
    let v4mux = std::fs::read_to_string(route_path).ok().and_then(|r| default_mux(&r));
    let mux = v4mux.or_else(|| {
        let r6 = std::fs::read_to_string(route6_path).ok()?;
        default_mux6(&r6).or_else(|| global_mux6(&r6))
    });
    let ep = Path::new(ipa_dev).exists().then_some(EP_IPA);
    Call { mux, v4: v4mux.is_some(), ep }
}

#[cfg(test)]
mod tests {
    use super::*;

    const HDR: &str = "Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT\n";

    fn route(rows: &[&str]) -> String {
        let mut s = HDR.to_string();
        for r in rows {
            s.push_str(r);
            s.push('\n');
        }
        s
    }

    #[test]
    fn the_default_rmnet_data_route_gives_n_plus_one() {
        // RM551E shape: default via rmnet_data0, a LAN bridge and a /29 on it.
        let r = route(&[
            "rmnet_data0\t00000000\t0100000A\t0003\t0\t0\t0\t00000000\t0\t0\t0",
            "rmnet_data0\t0000000A\t00000000\t0001\t0\t0\t0\tF8FFFFFF\t0\t0\t0",
            "br-lan\t0001A8C0\t00000000\t0001\t0\t0\t0\t00FFFFFF\t0\t0\t0",
        ]);
        assert_eq!(default_mux(&r), Some(1));
        for (n, want) in [(5u8, 6u8), (15, 16)] {
            let r = route(&[&format!("rmnet_data{n}\t00000000\t00000000\t0001\t0\t0\t0\t00000000\t0\t0\t0")]);
            assert_eq!(default_mux(&r), Some(want));
        }
    }

    #[test]
    fn no_call_or_odd_routes_give_none() {
        assert_eq!(default_mux(""), None);
        assert_eq!(default_mux(HDR), None);
        // Default via something else, not a data netdev.
        assert_eq!(default_mux(&route(&["br-lan\t00000000\t0101A8C0\t0003\t0\t0\t0\t00000000\t0\t0\t0"])), None);
        // A non-default route on rmnet_data only.
        assert_eq!(default_mux(&route(&["rmnet_data2\t0000000A\t00000000\t0001\t0\t0\t0\tF8FFFFFF\t0\t0\t0"])), None);
        // Down route, bad names, mux id overflow, short line.
        for row in [
            "rmnet_data0\t00000000\t00000000\t0000\t0\t0\t0\t00000000\t0\t0\t0",
            "rmnet_data\t00000000\t00000000\t0001\t0\t0\t0\t00000000\t0\t0\t0",
            "rmnet_datax\t00000000\t00000000\t0001\t0\t0\t0\t00000000\t0\t0\t0",
            "rmnet_data255\t00000000\t00000000\t0001\t0\t0\t0\t00000000\t0\t0\t0",
            "rmnet_data-1\t00000000\t00000000\t0001\t0\t0\t0\t00000000\t0\t0\t0",
            "rmnet_data0\t00000000\t00000000",
        ] {
            assert_eq!(default_mux(&route(&[row])), None, "{row}");
        }
    }

    #[test]
    fn the_lowest_metric_default_route_wins() {
        let r = route(&[
            "rmnet_data3\t00000000\t00000000\t0001\t0\t0\t20\t00000000\t0\t0\t0",
            "rmnet_data1\t00000000\t00000000\t0001\t0\t0\t10\t00000000\t0\t0\t0",
        ]);
        assert_eq!(default_mux(&r), Some(2));
    }

    #[test]
    fn discover_fails_closed_without_rmnet_ipa0() {
        let d = std::env::temp_dir().join(format!("qatd-call-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let rp = d.join("route");
        std::fs::write(&rp, route(&["rmnet_data4\t00000000\t00000000\t0001\t0\t0\t0\t00000000\t0\t0\t0"])).unwrap();
        let r6 = d.join("ipv6_route");
        let ipa = d.join("rmnet_ipa0");
        let (rs, r6s, ipas) = (rp.to_str().unwrap(), r6.to_str().unwrap(), ipa.to_str().unwrap());
        let c = discover(rs, r6s, ipas);
        assert_eq!(c, Call { mux: Some(5), v4: true, ep: None });
        std::fs::create_dir(&ipa).unwrap();
        assert_eq!(discover(rs, r6s, ipas), Call { mux: Some(5), v4: true, ep: Some(EP_IPA) });
        let nope = d.join("nope");
        assert_eq!(discover(nope.to_str().unwrap(), nope.to_str().unwrap(), ipas).mux, None);
        let _ = std::fs::remove_dir_all(&d);
    }

    const Z: &str = "00000000000000000000000000000000";

    fn r6(dest: &str, plen: &str, metric: &str, flags: &str, iface: &str) -> String {
        format!("{dest} {plen} {Z} 00 {Z} {metric} 00000001 00000000 {flags} {iface:>8}")
    }

    fn route6(rows: &[String]) -> String {
        rows.iter().map(|r| format!("{r}\n")).collect()
    }

    /// The RM551E table today (v4 call only): nothing on rmnet_data.
    fn live_v4_only_table() -> String {
        route6(&[
            r6("fe800000000000000000000000000000", "40", "00000100", "00000001", "eth0"),
            r6(Z, "00", "ffffffff", "00200200", "lo"),
            r6("fe800000000000000000000000000000", "80", "00000000", "00300001", "br-lan"),
            r6("ff000000000000000000000000000000", "08", "00000100", "00000001", "eth0"),
        ])
    }

    #[test]
    fn the_live_v4_only_ipv6_table_gives_no_mux() {
        let t = live_v4_only_table();
        assert_eq!(default_mux6(&t), None);
        assert_eq!(global_mux6(&t), None);
    }

    #[test]
    fn an_ipv6_default_route_on_rmnet_data_gives_n_plus_one() {
        for (n, want) in [(0u8, 1u8), (5, 6), (15, 16)] {
            let t = route6(&[
                r6("fe800000000000000000000000000000", "40", "00000100", "00000001", "eth0"),
                r6("20010db8000000010000000000000000", "40", "00000100", "00000001", &format!("rmnet_data{n}")),
                r6(Z, "00", "00000400", "00450003", &format!("rmnet_data{n}")),
                r6(Z, "00", "ffffffff", "00200200", "lo"),
            ]);
            assert_eq!(default_mux6(&t), Some(want));
        }
    }

    #[test]
    fn the_lowest_metric_ipv6_default_wins() {
        let t = route6(&[
            r6(Z, "00", "00000400", "00450003", "rmnet_data3"),
            r6(Z, "00", "00000100", "00450003", "rmnet_data1"),
        ]);
        assert_eq!(default_mux6(&t), Some(2));
    }

    #[test]
    fn odd_ipv6_rows_give_no_default() {
        for row in [
            // Reject default, down, non-default prefix, non-data iface, bad names, overflow.
            r6(Z, "00", "ffffffff", "00200200", "rmnet_data0"),
            r6(Z, "00", "ffffffff", "00200201", "rmnet_data0"),
            r6(Z, "00", "00000400", "00450002", "rmnet_data0"),
            r6("20010db8000000010000000000000000", "40", "00000100", "00000001", "rmnet_data0"),
            r6(Z, "00", "00000400", "00450003", "br-lan"),
            r6(Z, "00", "00000400", "00450003", "rmnet_data"),
            r6(Z, "00", "00000400", "00450003", "rmnet_datax"),
            r6(Z, "00", "00000400", "00450003", "rmnet_data255"),
            // Short row, bad hex, short address.
            format!("{Z} 00 {Z} 00"),
            r6(Z, "zz", "00000400", "00450003", "rmnet_data0"),
            r6("0000", "00", "00000400", "00450003", "rmnet_data0"),
            String::new(),
        ] {
            assert_eq!(default_mux6(&route6(std::slice::from_ref(&row))), None, "{row}");
        }
        assert_eq!(default_mux6(""), None);
    }

    #[test]
    fn the_global_prefix_fallback_needs_exactly_one_rmnet_data() {
        let global = |n: u8| r6("20010db8000000010000000000000000", "40", "00000100", "00000001", &format!("rmnet_data{n}"));
        let ll = r6("fe800000000000000000000000000000", "40", "00000100", "00000001", "rmnet_data2");
        let mc = r6("ff000000000000000000000000000000", "08", "00000100", "00000001", "rmnet_data2");
        // An up reject route is not a call either.
        assert_eq!(global_mux6(&route6(&[r6("20010db8000000010000000000000000", "40", "00000100", "00000201", "rmnet_data0")])), None);
        assert_eq!(global_mux6(&route6(&[ll.clone(), mc.clone(), global(0), global(0)])), Some(1));
        // Link-local and multicast alone are not a call.
        assert_eq!(global_mux6(&route6(&[ll, mc])), None);
        // Two data interfaces with global routes: ambiguous.
        assert_eq!(global_mux6(&route6(&[global(0), global(1)])), None);
        // A global route on a non-data interface is not ours.
        let lan = r6("20010db8000000020000000000000000", "40", "00000100", "00000001", "br-lan");
        assert_eq!(global_mux6(&route6(&[lan, global(3)])), Some(4));
    }

    #[test]
    fn discover_uses_the_ipv6_table_only_without_an_ipv4_default() {
        let d = std::env::temp_dir().join(format!("qatd-call6-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let (rp, r6p, ipa) = (d.join("route"), d.join("ipv6_route"), d.join("rmnet_ipa0"));
        std::fs::create_dir(&ipa).unwrap();
        let (rs, r6s, ipas) = (rp.to_str().unwrap(), r6p.to_str().unwrap(), ipa.to_str().unwrap());
        let v4_none = route(&["br-lan\t0001A8C0\t00000000\t0001\t0\t0\t0\t00FFFFFF\t0\t0\t0"]);
        let v6_data2 = route6(&[r6(Z, "00", "00000400", "00450003", "rmnet_data2")]);
        std::fs::write(&rp, &v4_none).unwrap();
        std::fs::write(&r6p, &v6_data2).unwrap();
        // v6-only: mux from the v6 default, no v4 backing.
        assert_eq!(discover(rs, r6s, ipas), Call { mux: Some(3), v4: false, ep: Some(EP_IPA) });
        // A v4 default appears on another interface: v4 wins and backs the mux.
        std::fs::write(&rp, route(&["rmnet_data0\t00000000\t00000000\t0001\t0\t0\t0\t00000000\t0\t0\t0"])).unwrap();
        assert_eq!(discover(rs, r6s, ipas), Call { mux: Some(1), v4: true, ep: Some(EP_IPA) });
        // Neither table: no call; unreadable ipv6 file is just "none".
        std::fs::write(&rp, &v4_none).unwrap();
        std::fs::write(&r6p, live_v4_only_table()).unwrap();
        assert_eq!(discover(rs, r6s, ipas), Call { mux: None, v4: false, ep: Some(EP_IPA) });
        assert_eq!(discover(rs, d.join("nope").to_str().unwrap(), ipas).mux, None);
        let _ = std::fs::remove_dir_all(&d);
    }
}
