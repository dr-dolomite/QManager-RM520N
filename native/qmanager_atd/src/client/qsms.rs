//! `qsms <op> ...`: the SMS client, with the same socket-first,
//! never-run-twice transport as qcmd.

use super::transport::{try_broker_raw, Broker};
use crate::at::exec::{self, Executor};
use crate::at::new_channel;
use crate::at::output::Code;
use crate::common::lock::{self, LockFile};
use crate::common::log::Logger;
use crate::common::proto;
use crate::sms;
use std::io::Write;
use std::time::Duration;

/// `qsms <op> ...`: one JSON envelope on stdout, rc 0 on success, 1 on failure.
/// Same transport rules as qcmd: socket first, in-process only if the request
/// never reached the broker, never run twice.
pub(crate) fn run_qsms(args: &[String]) -> i32 {
    let op = match sms::parse_args(args) {
        Ok(op) => op,
        Err(e) => return emit_sms(false, sms::error_json("bad_args", Some(&e))),
    };
    if exec::long_running() {
        return emit_sms(false, sms::error_json(Code::ScanInProgress.as_str(), None));
    }
    let label = op.label();
    let req = proto::encode_sms_request(args, proto::mono_ms());
    let (ok, json) = match try_broker_raw(&req, true, &label, None) {
        Broker::Reply(proto::Reply::Res(ok, body)) => (ok, String::from_utf8_lossy(&body).into_owned()),
        Broker::Reply(proto::Reply::Err(code)) | Broker::Lost(code) => (false, sms::error_json(code.as_str(), None)),
        Broker::Reply(proto::Reply::Ok(_)) => (false, sms::error_json(Code::CommandFailed.as_str(), None)),
        Broker::Unreachable => {
            let log = Logger::new("qsms");
            match LockFile::open(lock::LOCK_FILE) {
                Ok(lock) => {
                    let mut ch = new_channel();
                    sms::run(&mut Executor { ch: &mut ch, lock: &lock, log: &log }, &op, Duration::ZERO)
                }
                Err(_) => (false, sms::error_json(Code::ModemBusy.as_str(), None)),
            }
        }
    };
    emit_sms(ok, json)
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
