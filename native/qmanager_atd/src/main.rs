//! qmanager_atd — one static aarch64-musl multicall binary.
//!
//! Invoked as `qmanager_atd` with no arguments (or `-d` / `--daemon`): run the
//! broker — own /dev/smd11, serve one request per unix-socket connection,
//! serialised by the modem lock. Any other argument under that name is refused
//! (see `mode`), and the daemon refuses to start while another one listens.
//! `--version` (any name) prints the crate version and protocol number; the
//! daemon also publishes them in /var/run/qmanager_atd.proto for scripts.
//!
//! `qcmd -t <ms>` (or `QCMD_WAIT_MS=<ms>` for that one call): read-only
//! callers (the poller) cap their wait; see `try_broker_raw`.
//!
//! Invoked as `qcmd` (argv[0] basename; any name without "atd"): behave
//! exactly like the original shell qcmd. Try the broker socket first; if it is absent or errors at
//! the transport level, fall back to running the exchange in-process (same
//! code the daemon runs), so AT never depends on the daemon being up.
//!
//! Invoked as `qmi`: read-only QMI reads (serving, cell, CA, ...), one JSON line
//! on stdout. Broker first when its capability file says `proto>=3` and
//! `qmi=1`, else the same reads in-process (see client/qmi.rs).
//!
//! Invoked as `qsms`: the SMS client (list / status / send / delete, JSON on
//! stdout, see sms.rs), with the same socket-first, never-run-twice transport.
//!
//! The AT path is the same `exec::Executor` in both the daemon and the
//! fallback, so there is one behaviour, not two.

mod at;
mod client;
mod common;
mod daemon;
mod qmi;
mod sms;

use client::qcmd::run_qcmd;
use client::qmi::run_qmi;
use client::qsms::run_qsms;
use common::proto;
use daemon::run_daemon;
use std::io::Write;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let base = args
        .get(0)
        .and_then(|a| a.rsplit('/').next())
        .unwrap_or("qcmd")
        .to_string();

    // qsms and qmi are always clients: qsms's arguments are message text,
    // which may well be "-d" or "--daemon", and qmi never starts a daemon.
    match fixed_client(&base) {
        Some(FixedClient::Qsms) => std::process::exit(run_qsms(&args[1..])),
        Some(FixedClient::Qmi) => std::process::exit(run_qmi(&args[1..])),
        None => {}
    }

    match mode(&base, args.get(1..).unwrap_or(&[])) {
        Mode::Version => {
            let _ = writeln!(std::io::stdout(), "{}", proto::version_line());
            std::process::exit(0);
        }
        Mode::Usage => {
            let _ = writeln!(
                std::io::stderr(),
                "usage: qmanager_atd [-d|--daemon] | --version (AT commands go through qcmd)"
            );
            std::process::exit(2);
        }
        Mode::Daemon => std::process::exit(run_daemon()),
        Mode::Client => std::process::exit(run_qcmd(&args)),
    }
}

/// Names that are a client whatever their arguments say.
#[derive(Debug, PartialEq)]
enum FixedClient {
    Qsms,
    Qmi,
}

fn fixed_client(base: &str) -> Option<FixedClient> {
    match base {
        "qsms" => Some(FixedClient::Qsms),
        "qmi" => Some(FixedClient::Qmi),
        _ => None,
    }
}

#[derive(Debug, PartialEq)]
enum Mode {
    Daemon,
    Client,
    Version,
    Usage,
}

/// Picks the role from the invoked name and the arguments after it.
/// `--version` alone is answered by every name. Under the `qmanager_atd` name
/// the daemon starts only with no arguments or `-d` / `--daemon`: anything
/// else is refused, because a stray daemon unlinks the live broker's socket
/// (a v0.1.32 binary run as `qmanager_atd --version` did exactly that).
fn mode(base: &str, rest: &[String]) -> Mode {
    if let [only] = rest {
        if only == "--version" {
            return Mode::Version;
        }
    }
    if base.contains("atd") {
        return match rest {
            [] => Mode::Daemon,
            [a] if a == "-d" || a == "--daemon" => Mode::Daemon,
            _ => Mode::Usage,
        };
    }
    if rest.iter().any(|a| a == "--daemon") || rest.iter().any(|a| a == "-d" && base != "qcmd") {
        Mode::Daemon
    } else {
        Mode::Client
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sv(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn the_atd_name_starts_a_daemon_only_when_asked_plainly() {
        assert_eq!(mode("qmanager_atd", &sv(&[])), Mode::Daemon);
        assert_eq!(mode("qmanager_atd", &sv(&["-d"])), Mode::Daemon);
        assert_eq!(mode("qmanager_atd", &sv(&["--daemon"])), Mode::Daemon);
        assert_eq!(mode("qmanager_atd", &sv(&["--version"])), Mode::Version);
        for bad in [&["--bogus"][..], &["AT+CSQ"], &["-t", "2500"], &["--version", "x"], &["-d", "-d"]] {
            assert_eq!(mode("qmanager_atd", &sv(bad)), Mode::Usage, "{bad:?}");
        }
        assert_eq!(mode("qcmd", &sv(&["--version"])), Mode::Version);
        assert_eq!(mode("qcmd", &sv(&["AT+CSQ"])), Mode::Client);
        assert_eq!(mode("qcmd", &sv(&["-t", "2500", "AT+CSQ"])), Mode::Client);
        assert_eq!(mode("qcmd", &sv(&["-d"])), Mode::Client);
        assert_eq!(mode("qcmd", &sv(&["--daemon"])), Mode::Daemon);
    }

    #[test]
    fn qsms_and_qmi_are_fixed_clients_and_nothing_else_is() {
        assert_eq!(fixed_client("qmi"), Some(FixedClient::Qmi));
        assert_eq!(fixed_client("qsms"), Some(FixedClient::Qsms));
        // The dispatch sees the basename: /usr/bin/qmi, and a stray .qmi.tmp
        // link name, resolve as the code in main does.
        let base = |a0: &str| a0.rsplit('/').next().unwrap().to_string();
        assert_eq!(fixed_client(&base("/usr/bin/qmi")), Some(FixedClient::Qmi));
        for other in ["qcmd", "qmanager_atd", "qmi2", "Qmi", "qmi.exe", ""] {
            assert_eq!(fixed_client(other), None, "{other}");
        }
        // The daemon rule is untouched: an argument under the atd name is usage,
        // and `qmi` never reaches `mode` at all.
        assert_eq!(mode("qmanager_atd", &sv(&["serving"])), Mode::Usage);
    }

}
