//! `qsms <op> ...`: the SMS client. RM520N and RG501Q: QMI WMS in process (sms/wms.rs).
//! Any other model: AT through the broker socket first, never run twice, like qcmd.

use super::transport::{try_broker_raw, Broker};
use crate::at::qcmap::Qcmap;
use crate::at::exec::{self, Executor};
use crate::at::new_channel;
use crate::at::output::Code;
use crate::common::lock::LockFile;
use crate::common::log::Logger;
use crate::common::proto;
use crate::sms;
use std::io::Write;
use std::time::Duration;

const PROJECT_FILE: &str = "/etc/quectel-project-version";

/// Fixed per platform, never auto-detected: WMS on an RM520N or RG501Q (same allow-list as
/// hw_profile.sh qm_hw_atd_enabled); any other or unreadable model stays on AT.
fn use_wms() -> bool {
    match std::env::var("QSMS_BACKEND").as_deref() {
        Ok("wms") => return true,
        Ok("at") => return false,
        _ => {}
    }
    std::fs::read_to_string(PROJECT_FILE).map(|s| wms_model(&s)).unwrap_or(false)
}

/// The `Project Name:` value (words may be split by several spaces) starts with RM520N or RG501Q.
fn wms_model(file: &str) -> bool {
    file.lines()
        .filter_map(|l| l.split_once(':'))
        .find(|(k, _)| k.split_whitespace().eq(["Project", "Name"]))
        .map(|(_, v)| {
            let v = v.trim();
            v.starts_with("RM520N") || v.starts_with("RG501Q")
        })
        .unwrap_or(false)
}

/// `qsms <op> ...`: one JSON envelope on stdout, rc 0 on success, 1 on failure.
/// AT backend: socket first, in-process only if the request never reached the
/// broker, never run twice. WMS backend: always in process.
pub(crate) fn run_qsms(args: &[String]) -> i32 {
    let op = match sms::parse_args(args) {
        Ok(op) => op,
        Err(e) => return emit_sms(false, sms::error_json("bad_args", Some(&e))),
    };
    if use_wms() {
        if op == sms::Op::Watch {
            return sms::wms::watch();
        }
        let (ok, json) = sms::wms::run(&op);
        return emit_sms(ok, json);
    }
    if matches!(op, sms::Op::Tag { .. } | sms::Op::Watch) {
        // 2 = permanently unavailable: the shell supervisor stops respawning on it.
        let rc = if op == sms::Op::Watch { 2 } else { 1 };
        emit_sms(false, sms::error_json("unsupported", Some("Not available on this modem.")));
        return rc;
    }
    if exec::long_running() {
        return emit_sms(false, client_fail(&op, Code::ScanInProgress));
    }
    let label = op.label();
    let req = proto::encode_sms_request(args, proto::mono_ms());
    let (ok, json) = match try_broker_raw(&req, true, &label, None) {
        Broker::Reply(proto::Reply::Res(ok, body)) => (ok, String::from_utf8_lossy(&body).into_owned()),
        Broker::Reply(proto::Reply::Err(code)) | Broker::Lost(code) => (false, client_fail(&op, code)),
        Broker::Reply(proto::Reply::Ok(_)) => (false, client_fail(&op, Code::CommandFailed)),
        Broker::Unreachable => {
            let log = Logger::new("qsms");
            match LockFile::open_or_create_modem() {
                Ok(lock) => {
                    let mut ch = new_channel();
                    sms::run(&mut Executor { ch: &mut ch, lock: &lock, log: &log, qcmap: Qcmap::system() }, &op, Duration::ZERO)
                }
                Err(_) => (false, client_fail(&op, Code::ModemBusy)),
            }
        }
    };
    emit_sms(ok, json)
}

/// A client-side failure. For a send it carries the resume state: nothing from this run is known,
/// so `sent_parts` is the `--from` baseline; only a refusal before the modem ran is unambiguous.
fn client_fail(op: &sms::Op, code: Code) -> String {
    let sms::Op::Send { concat_ref, from, .. } = op else {
        return sms::error_json(code.as_str(), None);
    };
    let ambiguous = !matches!(code, Code::ScanInProgress | Code::ModemBusy);
    let r = concat_ref.map(|r| r.to_string()).unwrap_or_else(|| "null".into());
    format!(
        "{{\"success\":false,\"error\":\"{}\",\"sent_parts\":{},\"concat_ref\":{r},\"ambiguous\":{ambiguous}}}\n",
        code.as_str(),
        from - 1
    )
}

fn emit_sms(ok: bool, json: String) -> i32 {
    let mut out = std::io::stdout().lock();
    let _ = out.write_all(json.as_bytes());
    let _ = out.flush();
    if ok {
        0
    } else {
        1
    }
}

#[cfg(test)]
mod tests {
    use super::wms_model;

    #[test]
    fn only_an_rm520n_or_rg501q_project_name_selects_wms() {
        let rm520n = "Project Name: RM520NGL_VC\nProject Rev : RM520NGLAAR03A03M4G_A0.304\nBranch  Name: SDX6X\nCustom  Name: STD\n";
        let rg501q = "Project Name: RG501QEU_VD\nProject Rev : RG501QEUAAR12A11M4G_04.202\nBranch  Name: SDX55\n";
        assert!(wms_model(rm520n));
        assert!(wms_model(rg501q));
        assert!(!wms_model("Project Name: RM551E_GL\n"));
        assert!(!wms_model(""));
        assert!(!wms_model("Project Rev : RM520NGLAAR03A03M4G_A0.304\n"));
    }
}
