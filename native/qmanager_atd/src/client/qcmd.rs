//! `qcmd [-j] [-q] [-t MS] "AT..."`: the broker first, in-process fallback only if
//! the request never reached it.

use super::transport::{try_broker_raw, Broker};
use crate::at::qcmap::Qcmap;
use crate::at::exec::{self, Executor, Outcome};
use crate::at::new_channel;
use crate::at::classify;
use crate::at::output::{json_error, json_success, shell_capture, Code};
use crate::common::lock::{self, LockFile};
use crate::common::log::{Level, Logger};
use crate::common::proto;
use std::io::Write;
use std::time::{Duration, Instant};

pub(crate) fn run_qcmd(args: &[String]) -> i32 {
    let started = Instant::now();
    // Parse `qcmd [-j] [-q] [-t MS] "AT..."`, matching the shell script for `-j`.
    // `-q` and `-t` count only before the command: a later one is an extra
    // argument, ignored as before.
    let mut json = false;
    let mut quiet = false;
    let mut cap: Option<Duration> = None;
    let mut rest: Vec<&String> = Vec::new();
    let mut it = args.get(1..).unwrap_or(&[]).iter();
    while let Some(a) = it.next() {
        if a == "-j" && !json {
            json = true;
        } else if a == "-q" && rest.is_empty() {
            quiet = true;
        } else if a == "-t" && cap.is_none() && rest.is_empty() {
            match it.next().and_then(|v| parse_cap(v)) {
                Some(c) => cap = Some(c),
                None => {
                    let _ = writeln!(
                        std::io::stderr(),
                        r#"{{"error":"bad_cap","detail":"Usage: qcmd [-j] [-q] [-t MS] \"AT+COMMAND\" (MS {}-{})"}}"#,
                        CAP_MIN_MS,
                        CAP_MAX_MS
                    );
                    return 1;
                }
            }
        } else {
            rest.push(a);
        }
    }
    let command = match rest.first() {
        Some(c) if !c.is_empty() => c.as_str(),
        _ => {
            let _ = writeln!(
                std::io::stderr(),
                r#"{{"error":"no_command","detail":"Usage: qcmd [-j] [-q] [-t MS] \"AT+COMMAND\""}}"#
            );
            return 1;
        }
    };

    // QCMD_QUIET=1: a modem ERROR or empty reply the caller expects logs at
    // DEBUG. Env for scripts, as QCMD_WAIT_MS: an older binary ignores it.
    let quiet = quiet || quiet_from_env(std::env::var("QCMD_QUIET").ok().as_deref());

    // Not an AT command (a typo, an unknown flag such as `--bogus`): answer at
    // once. Sent on, the modem would stay silent and the broker would hold the
    // lock for the whole deadline while every other caller fails modem_busy.
    if !classify::is_at_command(command) {
        return emit(json, quiet, command, proto::Reply::Err(Code::InvalidCommand));
    }

    // Legacy fast-reject: while a long command runs, a short one answers at
    // once instead of queueing behind it in the broker for minutes.
    if !classify::is_long(command) && exec::long_running() {
        return emit(json, quiet, command, proto::Reply::Err(Code::ScanInProgress));
    }

    // QCMD_WAIT_MS=<ms> is the same cap for scripts: a binary that predates it
    // ignores an unknown variable, while an unknown flag would reach the modem
    // as a command. Set per call (`QCMD_WAIT_MS=2500 qcmd ...`), never exported,
    // so a write run from the same script keeps its full wait. An invalid value
    // is ignored. `-t` wins.
    let cap = cap.or_else(|| cap_from_env(std::env::var("QCMD_WAIT_MS").ok().as_deref()));
    // A long command (a scan) is never cut short: giving up would only discard
    // a reply the broker still spends minutes producing.
    let cap = if classify::is_long(command) { None } else { cap };

    let reply = match try_broker(command, cap) {
        Broker::Reply(r) => r,
        Broker::Unreachable => run_in_process(command, cap.map(|c| c.saturating_sub(started.elapsed()))),
        Broker::Lost(code) => proto::Reply::Err(code),
    };
    emit(json, quiet, command, reply)
}

/// Bounds of `qcmd -t`, in milliseconds.
const CAP_MIN_MS: u64 = 50;
const CAP_MAX_MS: u64 = 60_000;

/// `-t` value: plain decimal milliseconds within the bounds.
fn parse_cap(v: &str) -> Option<Duration> {
    if v.is_empty() || v.len() > 6 || !v.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let ms: u64 = v.parse().ok()?;
    (CAP_MIN_MS..=CAP_MAX_MS).contains(&ms).then(|| Duration::from_millis(ms))
}

fn cap_from_env(v: Option<&str>) -> Option<Duration> {
    v.and_then(parse_cap)
}

/// Any non-empty value but `0` turns quiet on.
fn quiet_from_env(v: Option<&str>) -> bool {
    matches!(v, Some(s) if !s.is_empty() && s != "0")
}

fn try_broker(cmd: &str, cap: Option<Duration>) -> Broker {
    // Mid-OTA the broker may be the previous binary: never send it a request it may misread.
    if !proto::broker_speaks_ours(std::fs::read_to_string(proto::PROTO_PATH).ok().as_deref()) {
        return Broker::Unreachable;
    }
    try_broker_raw(&proto::encode_request(cmd, proto::mono_ms()), !classify::is_long(cmd), cmd, cap)
}

/// `left`: what remains of a `qcmd -t` cap. It bounds the lock wait (counted
/// as time already queued against the 5 s short budget); the exchange itself
/// keeps its deadline, as the broker does.
fn run_in_process(cmd: &str, left: Option<Duration>) -> proto::Reply {
    let log = Logger::new("qcmd");
    let lock = match LockFile::open_or_create_modem() {
        Ok(l) => l,
        Err(e) => {
            log.error(&format!("AT lock {} refused: {e}", lock::LOCK_FILE));
            return proto::Reply::Err(Code::ModemBusy);
        }
    };
    let waited = left.map_or(Duration::ZERO, |l| exec::LOCK_WAIT_SHORT.saturating_sub(l));
    let mut ch = new_channel();
    match (Executor { ch: &mut ch, lock: &lock, log: &log, qcmap: Qcmap::system() }).run_after(cmd, waited) {
        Outcome::Ok(raw) => proto::Reply::Ok(raw),
        Outcome::Err(code) => proto::Reply::Err(code),
    }
}


/// RM520N contract (D10): a modem ERROR or empty reply is rc 1 +
/// `command_failed`, judged as the shell qcmd did; never stdout. `quiet`
/// changes only the level of those two log lines.
fn rm520n_reply(command: &str, reply: proto::Reply, quiet: bool) -> proto::Reply {
    let level = if quiet { Level::Debug } else { Level::Error };
    match reply {
        proto::Reply::Ok(raw) => {
            let body = shell_capture(&raw);
            if body.contains("ERROR") {
                Logger::new("qcmd").log(level, &format!("Command returned ERROR: {command}"));
                proto::Reply::Err(Code::CommandFailed)
            } else if body.is_empty() {
                Logger::new("qcmd").log(level, &format!("Empty response for: {command}"));
                proto::Reply::Err(Code::CommandFailed)
            } else {
                proto::Reply::Ok(raw)
            }
        }
        proto::Reply::Err(code) => {
            let shown = rm520n_code(code);
            if shown != code {
                Logger::new("qcmd").info(&format!("{} reported as {}: {command}", code.as_str(), shown.as_str()));
            }
            proto::Reply::Err(shown)
        }
        r => r,
    }
}

/// RM520N callers know only the shell's two codes (D11).
fn rm520n_code(code: Code) -> Code {
    match code {
        Code::ModemBusy | Code::ScanInProgress => Code::ModemBusy,
        Code::CommandFailed | Code::ModemNotReady | Code::CommandTimeout | Code::InvalidCommand => {
            Code::CommandFailed
        }
    }
}

/// print!/println! panic when stdout is closed (EPIPE; Rust ignores SIGPIPE),
/// and with panic=abort that is a SIGABRT. Like the shell's echo, a write
/// error is ignored and the exit code still reports the AT result.
fn emit(json: bool, quiet: bool, command: &str, reply: proto::Reply) -> i32 {
    // An SMS reply to an AT request can only be a protocol mix-up.
    if let proto::Reply::Res(..) = reply {
        return emit(json, quiet, command, proto::Reply::Err(Code::CommandFailed));
    }
    let reply = rm520n_reply(command, reply, quiet);
    let mut out = std::io::stdout().lock();
    match reply {
        proto::Reply::Ok(raw) => {
            let body = shell_capture(&raw);
            let _ = if json {
                out.write_all(json_success(&body, command).as_bytes())
            } else {
                writeln!(out, "{body}")
            };
            let _ = out.flush();
            0
        }
        proto::Reply::Err(code) => {
            if json {
                let _ = out.write_all(json_error(code, command).as_bytes());
                let _ = out.flush();
            } else {
                let _ = writeln!(std::io::stderr(), "ERROR: {}", code.as_str());
            }
            1
        }
        proto::Reply::Res(..) => 1,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn qcmd_refuses_non_at_input_at_once() {
        // Returns before the long-flag gate and the socket, so no broker is needed.
        for a in [&["qcmd", "--bogus"][..], &["qcmd", "hello"], &["qcmd", "-j", "-x"], &["qcmd", "AT\rhello"]] {
            let args: Vec<String> = a.iter().map(|s| s.to_string()).collect();
            let t = Instant::now();
            assert_eq!(run_qcmd(&args), 1, "{a:?}");
            assert!(t.elapsed() < Duration::from_millis(200), "{a:?}");
        }
    }

    fn sv(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn rm520n_contract_matches_the_shell_qcmd() {
        let ok = |s: &str| proto::Reply::Ok(s.as_bytes().to_vec());
        let failed = |r| matches!(r, proto::Reply::Err(Code::CommandFailed));
        assert!(failed(rm520n_reply("AT+X", ok("AT+X\r\r\nERROR\r\n"), false)));
        assert!(failed(rm520n_reply("AT+CPIN?", ok("AT+CPIN?\r\r\n+CME ERROR: 10\r\n"), false)));
        assert!(failed(rm520n_reply("AT", ok("\n\n"), false)));
        assert!(matches!(rm520n_reply("AT", ok("AT\r\r\nOK\r\n"), false), proto::Reply::Ok(_)));
        // Neither OK nor ERROR: passed through for the caller to judge.
        assert!(matches!(rm520n_reply("AT+Q", ok("AT+Q\r\r\n+Q: 1\r\n"), false), proto::Reply::Ok(_)));
        // Quiet changes the log level only, never the verdict.
        assert!(failed(rm520n_reply("AT+X", ok("AT+X\r\r\nERROR\r\n"), true)));
        assert!(failed(rm520n_reply("AT", ok("\n\n"), true)));
        assert!(matches!(rm520n_reply("AT", ok("AT\r\r\nOK\r\n"), true), proto::Reply::Ok(_)));
        assert_eq!(rm520n_code(Code::ScanInProgress), Code::ModemBusy);
        for c in [Code::ModemNotReady, Code::CommandTimeout, Code::InvalidCommand] {
            assert_eq!(rm520n_code(c), Code::CommandFailed);
        }
    }

    #[test]
    fn cap_accepts_plain_milliseconds_in_range_only() {
        assert_eq!(parse_cap("2500"), Some(Duration::from_millis(2500)));
        assert_eq!(parse_cap("50"), Some(Duration::from_millis(50)));
        assert_eq!(parse_cap("60000"), Some(Duration::from_millis(60000)));
        for bad in ["", "0", "49", "60001", "-5", "+5", "2.5", "2500ms", "abc", "99999999999999999999", " 25"] {
            assert_eq!(parse_cap(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn the_env_cap_is_ignored_unless_valid() {
        assert_eq!(cap_from_env(Some("2500")), Some(Duration::from_millis(2500)));
        assert_eq!(cap_from_env(None), None);
        for bad in ["", "x", "0", "2500 ", "1e3"] {
            assert_eq!(cap_from_env(Some(bad)), None, "{bad:?}");
        }
    }

    #[test]
    fn quiet_env_is_on_for_any_value_but_empty_or_zero() {
        for on in ["1", "yes", "00"] {
            assert!(quiet_from_env(Some(on)), "{on:?}");
        }
        for off in [None, Some(""), Some("0")] {
            assert!(!quiet_from_env(off), "{off:?}");
        }
    }

    #[test]
    fn a_bad_cap_is_refused_before_anything_runs() {
        for a in [&["qcmd", "-t"][..], &["qcmd", "-t", "AT+CSQ"], &["qcmd", "-t", "0", "AT+CSQ"], &["qcmd", "-j", "-t", "x", "AT"]] {
            let t = Instant::now();
            assert_eq!(run_qcmd(&sv(a)), 1, "{a:?}");
            assert!(t.elapsed() < Duration::from_millis(200), "{a:?}");
        }
    }
}
