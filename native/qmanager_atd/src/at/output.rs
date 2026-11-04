//! qcmd output contract: raw mode, -j JSON mode (jq -n layout), error codes.

use crate::common::json::json_escape;

/// Error codes callers depend on (docs/features/error-codes.md, qcmd).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Code {
    ModemBusy,
    ModemNotReady,
    ScanInProgress,
    CommandTimeout,
    CommandFailed,
    /// Not an AT command: refused before it reaches the modem.
    InvalidCommand,
}

impl Code {
    pub fn as_str(self) -> &'static str {
        match self {
            Code::ModemBusy => "modem_busy",
            Code::ModemNotReady => "modem_not_ready",
            Code::ScanInProgress => "scan_in_progress",
            Code::CommandTimeout => "command_timeout",
            Code::CommandFailed => "command_failed",
            Code::InvalidCommand => "invalid_command",
        }
    }

    pub fn parse(s: &str) -> Option<Code> {
        Some(match s {
            "modem_busy" => Code::ModemBusy,
            "modem_not_ready" => Code::ModemNotReady,
            "scan_in_progress" => Code::ScanInProgress,
            "command_timeout" => Code::CommandTimeout,
            "command_failed" => Code::CommandFailed,
            "invalid_command" => Code::InvalidCommand,
            _ => return None,
        })
    }
}

/// Legacy qcmd captured atcli with `$(...)`, which strips every trailing '\n',
/// then printed it with `echo`, which adds exactly one. Reproduce that.
pub fn shell_capture(raw: &[u8]) -> String {
    let s = String::from_utf8_lossy(raw);
    s.trim_end_matches('\n').to_string()
}

/// Same layout as `jq -n '{success: true, response: $r, command: $c}'`.
pub fn json_success(response: &str, command: &str) -> String {
    format!(
        "{{\n  \"success\": true,\n  \"response\": \"{}\",\n  \"command\": \"{}\"\n}}\n",
        json_escape(response),
        json_escape(command)
    )
}

pub fn json_error(code: Code, command: &str) -> String {
    format!(
        "{{\n  \"success\": false,\n  \"error\": \"{}\",\n  \"command\": \"{}\"\n}}\n",
        code.as_str(),
        json_escape(command)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capture_matches_dollar_paren_plus_echo() {
        // atcli stdout "AT+CSQ\r\r\n+CSQ: 24,99\r\n\r\nOK\r\n" -> $() -> "...OK\r"
        let raw = b"AT+CSQ\r\r\n+CSQ: 24,99\r\n\r\nOK\r\n";
        assert_eq!(shell_capture(raw), "AT+CSQ\r\r\n+CSQ: 24,99\r\n\r\nOK\r");
        assert_eq!(shell_capture(b"x\n\n\n"), "x");
    }

    #[test]
    fn json_matches_live_qcmd_j() {
        // Live: {"success": true, "response": "AT+CSQ\r\r\n+CSQ: 24,99\r\n\r\nOK\r", ...}
        let j = json_success("AT+CSQ\r\r\n+CSQ: 24,99\r\n\r\nOK\r", "AT+CSQ");
        assert!(j.contains(r#""response": "AT+CSQ\r\r\n+CSQ: 24,99\r\n\r\nOK\r","#));
        assert!(j.starts_with("{\n  \"success\": true,\n"));
    }

    #[test]
    fn codes_round_trip() {
        for c in [
            Code::ModemBusy,
            Code::ModemNotReady,
            Code::ScanInProgress,
            Code::CommandTimeout,
            Code::CommandFailed,
            Code::InvalidCommand,
        ] {
            assert_eq!(Code::parse(c.as_str()), Some(c));
        }
    }
}
