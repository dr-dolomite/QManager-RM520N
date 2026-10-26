//! Command classification. `is_long` must match the shell qcmd exactly: it
//! decides who sets /tmp/qmanager_long_running and who gets scan_in_progress.

use std::fs;

pub const LONG_COMMANDS_LIST: &str = "/etc/qmanager/long_commands.list";

/// Built-in long patterns, identical to the legacy qcmd `case` arms.
const BUILTIN_LONG: &[&str] = &["QSCAN", "QSCANFREQ", "QFOTADL", "COPS=2", "COPS=0"];

/// Commands that legitimately run long but never set the long-running flag in
/// legacy qcmd. They only get the long deadline here, so behaviour toward
/// other callers is unchanged.
const SLOW: &[&str] = &["COPS=?", "CFUN=", "QMBNCFG", "CGATT=", "QPRTPARA"];

/// Case-sensitive substring match, like the shell `*"$pattern"*`.
pub fn is_long_with(cmd: &str, extra: &[String]) -> bool {
    extra.iter().any(|p| !p.is_empty() && cmd.contains(p.as_str()))
        || BUILTIN_LONG.iter().any(|p| cmd.contains(p))
}

pub fn is_long(cmd: &str) -> bool {
    is_long_with(cmd, &read_long_list())
}

pub fn is_slow(cmd: &str) -> bool {
    SLOW.iter().any(|p| cmd.contains(p))
}

/// True if the modem will answer `cmd`: an `AT` prefix in any case and no
/// control characters. The modem stays silent on a line that does not start
/// with AT, so sending one holds the modem lock for the whole deadline and
/// every caller queued behind it fails modem_busy. The channel appends CR LF,
/// so an embedded CR or LF would put a second, unanswered line on the wire.
pub fn is_at_command(cmd: &str) -> bool {
    let b = cmd.as_bytes();
    b.len() >= 2 && b[..2].eq_ignore_ascii_case(b"AT") && !b.iter().any(|&c| c < 0x20 || c == 0x7f)
}

/// Parses long_commands.list the way qcmd does: skip blank and '#' lines.
pub fn parse_long_list(text: &str) -> Vec<String> {
    text.lines()
        .map(|l| l.trim_end_matches('\r'))
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .map(str::to_string)
        .collect()
}

pub fn read_long_list() -> Vec<String> {
    fs::read_to_string(LONG_COMMANDS_LIST)
        .map(|t| parse_long_list(&t))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_long_matches_legacy_case_arms() {
        assert!(is_long_with("AT+QSCAN=3,1", &[]));
        assert!(is_long_with("AT+QSCANFREQ", &[]));
        assert!(is_long_with("AT+QFOTADL=\"x\"", &[]));
        assert!(is_long_with("AT+COPS=2", &[]));
        assert!(is_long_with("AT+COPS=0", &[]));
        assert!(!is_long_with("AT+COPS?", &[]));
        assert!(!is_long_with("AT+COPS=?", &[]));
        assert!(!is_long_with("AT+QENG=\"servingcell\"", &[]));
    }

    #[test]
    fn match_is_case_sensitive_like_shell() {
        assert!(!is_long_with("at+qscan=3,1", &[]));
    }

    #[test]
    fn list_skips_comments_and_blanks() {
        let l = parse_long_list("# hi\n\nQSCAN\r\nQXYZ\n");
        assert_eq!(l, vec!["QSCAN".to_string(), "QXYZ".to_string()]);
        assert!(is_long_with("AT+QXYZ=1", &l));
    }

    #[test]
    fn at_commands_are_accepted_in_any_case() {
        for c in ["AT", "at", "At+CSQ", "AT+QENG=\"servingcell\"", "AT+QRSRP;+QRSRQ;+QSINR", "ATI", "at+cops?"] {
            assert!(is_at_command(c), "{c}");
        }
    }

    #[test]
    fn non_at_input_is_rejected() {
        for c in ["", "A", "hello", "--bogus", "-x", "A/", " AT+CSQ", "+CSQ", "TA+CSQ"] {
            assert!(!is_at_command(c), "{c}");
        }
    }

    #[test]
    fn control_characters_are_rejected() {
        for c in ["AT\rhello", "AT+CSQ\n", "AT\r\nAT", "AT+CSQ\u{1a}", "AT\t+CSQ", "AT\u{7f}"] {
            assert!(!is_at_command(c), "{c:?}");
        }
    }

    #[test]
    fn slow_is_separate_from_long() {
        assert!(is_slow("AT+COPS=?"));
        assert!(is_slow("AT+CFUN=1"));
        assert!(!is_long_with("AT+CFUN=1", &[]));
    }
}
