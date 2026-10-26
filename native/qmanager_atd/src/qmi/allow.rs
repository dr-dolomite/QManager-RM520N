//! The read-only (service, message) allow-list, enforced inside the daemon:
//! the broker socket is the trust boundary, so a client can only ever reach
//! these Get messages. Nothing here writes modem configuration.
//!
//! From qmi_probe's WHITELIST minus WDS 0x0024 (Get Packet Statistics) and
//! WDS 0x002D (Get Current Settings): both fail on an unbound client (Phase
//! 0). NAS 0x006C (Config Signal Info v2) is a config write: it is
//! broker-internal (`BROKER_CONFIG`, user-approved 2026-10-22), applied by
//! the daemon with compiled-in TLVs only, and never reachable through the
//! `QMI` verb / qcmd or the in-process fallback client.
//!
//! Data Used (broker 0.6.0) reads WDS 0x0024 on two broker-internal WDS
//! clients that the daemon binds to the default data call's mux port first
//! (0x00A2 Bind Mux Data Port, 0x00AF Bind Subscription, 0x004D Set Client
//! IP Family for the IPv6 client). Those binds are per-client state on the
//! broker's own sockets (released when they close) and change nothing about
//! the data call, but they are writes: they sit in `BROKER_CONFIG`, and the
//! stats read in `BROKER_READ`, with the same rule as 0x006C. WDS 0x0086
//! (Reset) and every call-control message are never sent.

use super::error::QmiError;
use super::{SVC_DMS, SVC_DSD, SVC_NAS, SVC_UIM, SVC_WDS};

pub const CLIENT_ALLOWED: &[(u32, u16)] = &[
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
    (SVC_WDS, 0x002A), // Get Profile List
    (SVC_DSD, 0x0024), // Get System Status
];

/// NAS Indication Register: per-client state on our own socket (released
/// when it closes), changes no modem configuration. Reachable only through
/// the registry's internal API, never from a client request.
#[allow(dead_code)] // consumed by the phase 2 indication path
pub const NAS_INDICATION_REGISTER: u16 = 0x0003;
#[allow(dead_code)] // consumed by the phase 2 indication path
pub const INTERNAL_ONLY: &[(u32, u16)] = &[(SVC_NAS, NAS_INDICATION_REGISTER)];

/// NAS Config Signal Info v2: sets the report deltas that keep the modem's
/// shared signal cache (read by Get Signal Info 0x004F) live. Not persisted
/// by the modem (an SSR wipes it), so the registry replays it per socket.
pub const NAS_CONFIG_SIG_INFO2: u16 = 0x006C;
/// WDS Bind Mux Data Port: ties a WDS client to one data call's mux port.
pub const WDS_BIND_MUX_DATA_PORT: u16 = 0x00A2;
/// WDS Bind Subscription (primary).
pub const WDS_BIND_SUBSCRIPTION: u16 = 0x00AF;
/// WDS Set Client IP Family (the IPv6 client only).
pub const WDS_SET_CLIENT_IP_FAMILY: u16 = 0x004D;
/// WDS Get Packet Statistics: answered only on a bound client.
pub const WDS_GET_PKT_STATS: u16 = 0x0024;

/// The only config writes the broker itself may send; never in
/// `CLIENT_ALLOWED` or `INTERNAL_ONLY`, so no request path can reach them.
/// The WDS binds are per-client state on the broker's internal WDS sockets.
pub const BROKER_CONFIG: &[(u32, u16)] = &[
    (SVC_NAS, NAS_CONFIG_SIG_INFO2),
    (SVC_WDS, WDS_BIND_MUX_DATA_PORT),
    (SVC_WDS, WDS_BIND_SUBSCRIPTION),
    (SVC_WDS, WDS_SET_CLIENT_IP_FAMILY),
];

/// Reads only the broker sends, on its internal bound WDS clients. Never in
/// `CLIENT_ALLOWED`: on the shared (unbound) client it fails anyway, and the
/// per-call counters are published through the `qmi.env` sidecar instead.
pub const BROKER_READ: &[(u32, u16)] = &[(SVC_WDS, WDS_GET_PKT_STATS)];

/// Whether the daemon itself may send (svc, msg) on an internal client.
pub fn broker_allowed(svc: u32, msg: u16) -> bool {
    BROKER_CONFIG.contains(&(svc, msg)) || BROKER_READ.contains(&(svc, msg))
}

pub fn client_allowed(svc: u32, msg: u16) -> bool {
    CLIENT_ALLOWED.contains(&(svc, msg))
}

#[allow(dead_code)] // consumed by the phase 2 indication path
pub fn internal_allowed(svc: u32, msg: u16) -> bool {
    client_allowed(svc, msg) || INTERNAL_ONLY.contains(&(svc, msg))
}

pub fn check_client(svc: u32, msg: u16) -> Result<(), QmiError> {
    if client_allowed(svc, msg) {
        Ok(())
    } else {
        Err(QmiError::Refused { svc, msg })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exactly_the_read_only_gets() {
        assert_eq!(CLIENT_ALLOWED.len(), 18);
        for &(s, m) in &[
            (SVC_NAS, 0x0020u16),
            (SVC_NAS, 0x00AC),
            (SVC_DMS, 0x0025),
            (SVC_UIM, 0x0047),
            (SVC_WDS, 0x002A),
            (SVC_DSD, 0x0024),
        ] {
            assert!(client_allowed(s, m), "{s}:{m:#06x}");
        }
        // Excluded on purpose, or writes.
        for &(s, m) in &[
            (SVC_WDS, 0x0024u16), // Get Packet Statistics (needs session ownership)
            (SVC_WDS, 0x002D),    // Get Current Settings (needs session ownership)
            (SVC_NAS, 0x006C),    // Config Signal Info v2 (config write)
            (SVC_NAS, 0x0033),    // Set System Selection Preference
            (SVC_DMS, 0x002E),    // Set Operating Mode
            (SVC_WDS, 0x0020),    // Start Network Interface
            (SVC_NAS, NAS_INDICATION_REGISTER),
            (99, 0x0020),
        ] {
            assert!(!client_allowed(s, m), "{s}:{m:#06x}");
            assert_eq!(check_client(s, m), Err(QmiError::Refused { svc: s, msg: m }));
        }
        assert!(internal_allowed(SVC_NAS, NAS_INDICATION_REGISTER));
        assert!(!internal_allowed(SVC_NAS, 0x006C));
        assert!(!internal_allowed(SVC_DMS, NAS_INDICATION_REGISTER));
    }

    #[test]
    fn broker_only_pairs_are_exact_and_never_client_reachable() {
        assert_eq!(BROKER_CONFIG, &[(SVC_NAS, 0x006C), (SVC_WDS, 0x00A2), (SVC_WDS, 0x00AF), (SVC_WDS, 0x004D)]);
        assert_eq!(BROKER_READ, &[(SVC_WDS, 0x0024)]);
        for &(s, m) in BROKER_CONFIG.iter().chain(BROKER_READ) {
            assert!(!client_allowed(s, m), "{s}:{m:#06x}");
            assert!(!internal_allowed(s, m), "{s}:{m:#06x}");
            assert_eq!(check_client(s, m), Err(QmiError::Refused { svc: s, msg: m }));
            assert!(broker_allowed(s, m));
        }
        // NAS 0x004D (Get Sys Info) stays a client read; WDS 0x004D does not.
        assert!(client_allowed(SVC_NAS, 0x004D));
        // Never sent by anyone: WDS Reset, Start/Stop Network Interface.
        for m in [0x0086u16, 0x0020, 0x0021, 0x002D] {
            assert!(!broker_allowed(SVC_WDS, m), "{m:#06x}");
            assert!(!client_allowed(SVC_WDS, m), "{m:#06x}");
        }
    }
}
