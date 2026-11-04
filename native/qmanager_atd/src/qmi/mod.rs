//! QMI lane: read-only QMI over raw AF_QIPCRTR, no libqmi, no modem lock.
//!
//! - `transport`: the `Datagram` / `Transport` seam (real QRTR socket, or a
//!   fake in tests) and the QRTR name-server protocol (lookup, NEW/DEL_SERVER).
//! - `msg`: the QMI service message codec (header, txn, TLVs, result TLV).
//! - `registry`: one long-lived client socket per service with a demux
//!   thread, txn matching, indication fan-out, SSR detection and rebuild.
//! - `allow`: the read-only (service, message) allow-list, enforced here
//!   because the broker socket is the trust boundary.
//! - `error`: the typed error, mapped to the client vocabulary.
//! - `codec`: typed decoders from a response `Msg` to plain structs, one
//!   module per service (`nas`, `dms`, `uim`, `wds`, `dsd`).
//! - `model`: the codec output normalised to QManager vocabulary (registration
//!   gate, freshness tags, `Bundle`) and the JSON for each `qmi <read>`.
//!
//! Phase 0 groundwork: native/qmi_probe (qrtr.rs, main.rs WHITELIST).

pub mod allow;
pub mod codec;
pub mod error;
pub mod model;
pub mod msg;
pub mod query;
pub mod registry;
pub mod transport;

#[cfg(test)]
pub(crate) mod fake;

pub const SVC_WDS: u32 = 1;
pub const SVC_DMS: u32 = 2;
pub const SVC_NAS: u32 = 3;
pub const SVC_UIM: u32 = 11;
pub const SVC_DSD: u32 = 42;

/// Every service the lane looks up, in registry order.
pub const SERVICES: [u32; 5] = [SVC_NAS, SVC_DMS, SVC_UIM, SVC_WDS, SVC_DSD];

pub fn service_name(svc: u32) -> &'static str {
    match svc {
        SVC_WDS => "wds",
        SVC_DMS => "dms",
        SVC_NAS => "nas",
        SVC_UIM => "uim",
        SVC_DSD => "dsd",
        _ => "unknown",
    }
}
