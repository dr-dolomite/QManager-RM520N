//! One `qmi <read>...` request, start to finish: the argument rules, the
//! reads, and the JSON envelope. The daemon (QMI verb) and the client's
//! in-process fallback both call this, so there is one behaviour.
//!
//! Envelope: `{"v":1,"ok":true,"mono_ms":N,"ssr_count":N,"data":{...}}`, or
//! `{"v":1,"ok":false,"error":"<code>"}` with the code from `QmiError::code`
//! (`qmi_unavailable | modem_not_ready | not_supported | bad_args |
//! command_failed`).
//!
//! Partial failure. `data` has one key per requested read, in the order
//! given. A read that failed appears as `{"error":"<code>"}` in its slot; the
//! envelope is `ok:true` as long as at least one read succeeded, and
//! `ok:false` (with the first read's error) only when every read failed. A
//! consumer that needs all of them checks each slot. `bundle` is the
//! poller-shaped read and must be requested alone; its keys (`serving`,
//! `signal`, `cell`, `ca`, `rf`) become `data`'s own keys.

use super::error::QmiError;
use super::model::{self, Fetch, Read};
use super::registry::Registry;
use crate::common::json::J;
use crate::common::proto::mono_ms;
use std::time::Instant;

/// Arguments accepted in one request (there are 14 reads; the rest is noise).
pub const MAX_ARGS: usize = 16;

/// Validates and orders the requested reads: at least one, each a known
/// name, repeats dropped (a repeated read would repeat a JSON key), and
/// `bundle` only on its own.
pub fn parse_reads(args: &[String]) -> Result<Vec<Read>, String> {
    if args.is_empty() {
        return Err("no read given".into());
    }
    if args.len() > MAX_ARGS {
        return Err("too many reads".into());
    }
    let mut reads: Vec<Read> = Vec::new();
    for a in args {
        let r = Read::parse(a).ok_or_else(|| format!("unknown read: {}", crate::common::safefs::one_line(a)))?;
        if !reads.contains(&r) {
            reads.push(r);
        }
    }
    if reads.contains(&Read::Bundle) && reads.len() > 1 {
        return Err("bundle cannot be combined with other reads".into());
    }
    Ok(reads)
}

pub fn fail_envelope(code: &str) -> String {
    let mut j = J::obj();
    j.num("v", 1).boolean("ok", false).str("error", code);
    j.done()
}

fn error_slot(code: &str) -> String {
    let mut j = J::obj();
    j.str("error", code);
    j.done()
}

/// Runs the reads and renders the envelope. Returns whether it is a success.
pub fn execute(fetch: Fetch, reads: &[Read], mono_ms: u64, ssr_count: u64) -> (bool, String) {
    let mut slots: Vec<String> = Vec::new();
    let mut first_err: Option<QmiError> = None;
    let mut any_ok = false;
    for &r in reads {
        match model::run(fetch, r) {
            Ok(json) => {
                any_ok = true;
                if r == Read::Bundle {
                    // `{...}` -> its members, spliced into `data`.
                    slots.push(json.get(1..json.len().saturating_sub(1)).unwrap_or("").to_string());
                } else {
                    slots.push(format!("\"{}\":{}", r.name(), json));
                }
            }
            Err(e) => {
                slots.push(format!("\"{}\":{}", r.name(), error_slot(e.code())));
                first_err.get_or_insert(e);
            }
        }
    }
    if !any_ok {
        let code = first_err.map_or("command_failed", |e| e.code());
        return (false, fail_envelope(code));
    }
    let mut j = J::obj();
    j.num("v", 1).boolean("ok", true).num("mono_ms", mono_ms).num("ssr_count", ssr_count);
    j.raw("data", &format!("{{{}}}", slots.join(",")));
    (true, j.done())
}

/// The whole request against a registry. `None` is a lane whose registry is
/// still starting: valid requests answer `modem_not_ready`, bad ones still
/// `bad_args`.
pub fn answer(reg: Option<&Registry>, args: &[String]) -> (bool, String) {
    answer_by(reg, args, None)
}

/// `answer`, bounded: no request is sent past `deadline` and no response is
/// waited for past it; the reads left fail `modem_not_ready`.
pub fn answer_by(reg: Option<&Registry>, args: &[String], deadline: Option<Instant>) -> (bool, String) {
    let reads = match parse_reads(args) {
        Ok(r) => r,
        Err(_) => return (false, fail_envelope("bad_args")),
    };
    match reg {
        Some(reg) => {
            let fetch = |svc: u32, id: u16| reg.request_by(svc, id, &[], deadline);
            execute(&fetch, &reads, mono_ms(), reg.ssr_count())
        }
        None => (false, fail_envelope("modem_not_ready")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::qmi::fake::{r1_net, start_registry};
    use crate::qmi::msg::Msg;

    fn sv(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn reads_are_validated_deduped_and_ordered() {
        let names = |a: &[&str]| parse_reads(&sv(a)).map(|r| r.iter().map(|r| r.name()).collect::<Vec<_>>());
        assert_eq!(names(&["serving"]).unwrap(), ["serving"]);
        assert_eq!(names(&["ca", "serving", "ca"]).unwrap(), ["ca", "serving"]);
        assert_eq!(names(&["bundle"]).unwrap(), ["bundle"]);
        assert_eq!(names(&["bundle", "bundle"]).unwrap(), ["bundle"]);
        for bad in [&[][..], &["nope"], &[""], &["serving", "nope"], &["bundle", "ca"], &["Serving"], &["--daemon"]] {
            assert!(names(bad).is_err(), "{bad:?}");
        }
        assert!(parse_reads(&vec!["serving".to_string(); MAX_ARGS + 1]).is_err());
        for r in Read::ALL {
            assert!(parse_reads(&sv(&[r.name()])).is_ok());
        }
    }

    #[test]
    fn failure_envelope_is_exact() {
        for code in ["qmi_unavailable", "modem_not_ready", "not_supported", "bad_args", "command_failed"] {
            assert_eq!(fail_envelope(code), format!("{{\"v\":1,\"ok\":false,\"error\":\"{code}\"}}"));
        }
        assert_eq!(answer(None, &[]), (false, fail_envelope("bad_args")));
        assert_eq!(answer(None, &sv(&["serving"])), (false, fail_envelope("modem_not_ready")));
        assert_eq!(answer(None, &sv(&["bogus"])), (false, fail_envelope("bad_args")));
    }

    #[test]
    fn success_envelope_wraps_each_read_under_its_name() {
        let net = r1_net();
        let reg = start_registry(&net);
        let (ok, j) = answer(Some(&reg), &sv(&["serving", "ca"]));
        assert!(ok, "{j}");
        assert!(j.starts_with("{\"v\":1,\"ok\":true,\"mono_ms\":"), "{j}");
        assert!(j.contains(",\"ssr_count\":0,\"data\":{\"serving\":{\"registration\":\"registered\""), "{j}");
        assert!(j.contains(",\"ca\":{\"count\":1,\"carriers\":["), "{j}");
        assert!(j.ends_with("}}}"), "{j}");
        // `bundle` flattens into data: the poller-shaped read.
        let (ok, j) = answer(Some(&reg), &sv(&["bundle"]));
        assert!(ok);
        assert!(j.contains("\"data\":{\"serving\":{") && j.contains(",\"rf\":{\"bands\":["), "{j}");
        assert!(!j.contains("\"bundle\""), "{j}");
        // Every envelope is one line.
        assert!(!j.contains('\n'));
    }

    #[test]
    fn a_failed_read_is_an_error_slot_unless_every_read_failed() {
        let net = r1_net();
        let reg = start_registry(&net);
        // DSD down: dsd fails, serving still answers -> ok with an error slot.
        net.del_server(crate::qmi::SVC_DSD);
        let end = std::time::Instant::now() + std::time::Duration::from_secs(2);
        while reg.state(crate::qmi::SVC_DSD) == Some(crate::qmi::registry::SvcState::Up) && std::time::Instant::now() < end {
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
        let (ok, j) = answer(Some(&reg), &sv(&["serving", "dsd"]));
        assert!(ok, "{j}");
        assert!(j.contains("\"dsd\":{\"error\":\"modem_not_ready\"}"), "{j}");
        assert!(j.contains("\"serving\":{\"registration\":"), "{j}");
        // Only failures: not ok, the first read's error.
        assert_eq!(answer(Some(&reg), &sv(&["dsd"])), (false, fail_envelope("modem_not_ready")));
        assert_eq!(answer(Some(&reg), &sv(&["dsd", "serving"])).0, true);
    }

    #[test]
    fn execute_maps_every_error_kind() {
        let one = |e: QmiError| {
            let f = move |_: u32, _: u16| -> Result<Msg, QmiError> { Err(e.clone()) };
            execute(&f, &[Read::Cell], 1, 0)
        };
        assert_eq!(one(QmiError::Unavailable), (false, fail_envelope("qmi_unavailable")));
        assert_eq!(one(QmiError::Timeout), (false, fail_envelope("modem_not_ready")));
        assert_eq!(one(QmiError::Refused { svc: 3, msg: 0x6c }), (false, fail_envelope("not_supported")));
        assert_eq!(one(QmiError::BadArgs(None)), (false, fail_envelope("bad_args")));
        assert_eq!(one(QmiError::CommandFailed(Some(3))), (false, fail_envelope("command_failed")));
    }
}
