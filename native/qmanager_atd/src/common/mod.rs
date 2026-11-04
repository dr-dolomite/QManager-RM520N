//! Shared plumbing: the wire protocol, logging, the modem lock, safe file
//! writes and JSON escaping.

pub mod json;
pub mod lock;
pub mod log;
pub mod proto;
pub mod safefs;
