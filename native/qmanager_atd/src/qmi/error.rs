//! The QMI lane's typed error and its client vocabulary:
//! `qmi_unavailable | modem_not_ready | not_supported | bad_args | command_failed`.

use std::fmt;

/// QMI error codes the lane gives a meaning to (QMI common error table).
pub const QMI_ERR_MALFORMED_MSG: u16 = 0x0001;
pub const QMI_ERR_MISSING_ARG: u16 = 0x0011;
pub const QMI_ERR_ARG_TOO_LONG: u16 = 0x0013;
pub const QMI_ERR_OP_DEVICE_UNSUPPORTED: u16 = 0x0019;
pub const QMI_ERR_INVALID_ARG: u16 = 0x0030;
pub const QMI_ERR_DEVICE_NOT_READY: u16 = 0x0034;
pub const QMI_ERR_INVALID_QMI_CMD: u16 = 0x0047;
/// Seen for a few seconds after an SSR, before NAS reports `searching`.
pub const QMI_ERR_INFO_UNAVAILABLE: u16 = 0x004A;
pub const QMI_ERR_NOT_SUPPORTED: u16 = 0x005E;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum QmiError {
    /// No QRTR on this host, or the service was never found.
    Unavailable,
    /// The service is down (SSR window), the modem says not ready, or the
    /// transport failed mid-request.
    ModemNotReady(Option<u16>),
    /// No response within the per-request timeout.
    Timeout,
    /// The modem answered "not supported" for this message.
    NotSupported(Option<u16>),
    /// The request was malformed (by size, or per the modem's result TLV).
    BadArgs(Option<u16>),
    /// The (service, message) pair is not on the read-only allow-list. It
    /// never reached the socket.
    Refused { svc: u32, msg: u16 },
    /// Any other QMI failure; carries the result TLV's error code, or None
    /// when the response had no usable result TLV.
    CommandFailed(Option<u16>),
}

impl QmiError {
    /// Maps a failing result TLV's error code.
    pub fn from_qmi(ec: u16) -> QmiError {
        match ec {
            QMI_ERR_DEVICE_NOT_READY | QMI_ERR_INFO_UNAVAILABLE => QmiError::ModemNotReady(Some(ec)),
            QMI_ERR_NOT_SUPPORTED | QMI_ERR_INVALID_QMI_CMD | QMI_ERR_OP_DEVICE_UNSUPPORTED => {
                QmiError::NotSupported(Some(ec))
            }
            QMI_ERR_MALFORMED_MSG | QMI_ERR_MISSING_ARG | QMI_ERR_ARG_TOO_LONG | QMI_ERR_INVALID_ARG => {
                QmiError::BadArgs(Some(ec))
            }
            _ => QmiError::CommandFailed(Some(ec)),
        }
    }

    /// The client-facing error word.
    pub fn code(&self) -> &'static str {
        match self {
            QmiError::Unavailable => "qmi_unavailable",
            QmiError::ModemNotReady(_) | QmiError::Timeout => "modem_not_ready",
            QmiError::NotSupported(_) | QmiError::Refused { .. } => "not_supported",
            QmiError::BadArgs(_) => "bad_args",
            QmiError::CommandFailed(_) => "command_failed",
        }
    }

    /// The QMI error code from the result TLV, when the modem gave one.
    pub fn qmi_code(&self) -> Option<u16> {
        match self {
            QmiError::ModemNotReady(c)
            | QmiError::NotSupported(c)
            | QmiError::BadArgs(c)
            | QmiError::CommandFailed(c) => *c,
            _ => None,
        }
    }
}

impl fmt::Display for QmiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            QmiError::Refused { svc, msg } => write!(f, "not_supported (refused {}:{:#06x})", svc, msg),
            QmiError::Timeout => write!(f, "modem_not_ready (timeout)"),
            e => match e.qmi_code() {
                Some(c) => write!(f, "{} (qmi {:#06x})", e.code(), c),
                None => write!(f, "{}", e.code()),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn qmi_codes_map_to_the_client_vocabulary() {
        assert_eq!(QmiError::from_qmi(0x004A), QmiError::ModemNotReady(Some(0x004A)));
        assert_eq!(QmiError::from_qmi(0x0034).code(), "modem_not_ready");
        assert_eq!(QmiError::from_qmi(0x005E), QmiError::NotSupported(Some(0x005E)));
        assert_eq!(QmiError::from_qmi(0x0047).code(), "not_supported");
        assert_eq!(QmiError::from_qmi(0x0030), QmiError::BadArgs(Some(0x0030)));
        assert_eq!(QmiError::from_qmi(0x0003), QmiError::CommandFailed(Some(0x0003)));
        assert_eq!(QmiError::from_qmi(0x0003).qmi_code(), Some(3));
        assert_eq!(QmiError::Unavailable.code(), "qmi_unavailable");
        assert_eq!(QmiError::Timeout.code(), "modem_not_ready");
        assert_eq!(QmiError::Refused { svc: 3, msg: 0x6C }.code(), "not_supported");
        assert_eq!(QmiError::CommandFailed(None).to_string(), "command_failed");
        assert_eq!(QmiError::from_qmi(0x004A).to_string(), "modem_not_ready (qmi 0x004a)");
    }
}
