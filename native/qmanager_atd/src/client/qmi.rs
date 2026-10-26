//! `qmi <read> [<read>...]`: read-only QMI, one JSON line on stdout (rc 0 ok,
//! 1 failure). See `qmi::query` for the envelope and the partial-failure rule.
//!
//! Transport, in order:
//! 1. The broker, but only if its capability file says `proto>=3` and
//!    `qmi=1`. An older daemon (or none) never sees the `QMI` verb: a 0.2.0
//!    broker would refuse it, and a file that is missing or unreadable means
//!    nothing is assumed.
//! 2. Otherwise, or if the broker does not answer with a `RES` within
//!    `REPLY_TIMEOUT` (it hangs up, resets, answers `ERR`, or stalls), the
//!    same reads run in this process on a registry of its own. That is safe
//!    because QMI is read-only and takes no lock, so asking twice is harmless,
//!    and it is one behaviour because both paths call `query::answer`.
//!
//! In the fallback `ssr_count` is that of the client's own, fresh registry
//! (always 0): only the daemon's counter says anything about SSRs.

use crate::common::proto::{self, Reply};
use crate::qmi::query;
use crate::qmi::registry::Registry;
use std::io::{Read, Write};
use std::os::unix::net::UnixStream;
use std::time::{Duration, Instant};

/// A live broker answers a QMI read in a millisecond or two; past this it is
/// treated as unreachable and the read runs in-process.
const REPLY_TIMEOUT: Duration = Duration::from_secs(3);

pub(crate) fn run_qmi(args: &[String]) -> i32 {
    if args == ["--version"] {
        let _ = writeln!(std::io::stdout(), "{}", proto::version_line());
        return 0;
    }
    if query::parse_reads(args).is_err() {
        return emit(false, query::fail_envelope("bad_args"));
    }
    let caps = std::fs::read_to_string(proto::PROTO_PATH).ok();
    let (ok, json) = exchange(caps.as_deref(), proto::SOCKET_PATH, args, REPLY_TIMEOUT, || {
        let reg = Registry::start_qrtr();
        let r = query::answer(Some(&reg), args);
        // One-shot process: skip Drop's watcher join (up to one 250 ms tick).
        std::mem::forget(reg);
        r
    });
    emit(ok, json)
}

/// The broker if the capability text allows it and it answers, else
/// `fallback`.
fn exchange(
    caps: Option<&str>,
    socket: &str,
    args: &[String],
    timeout: Duration,
    fallback: impl FnOnce() -> (bool, String),
) -> (bool, String) {
    if proto::broker_serves_qmi(caps) {
        if let Some(r) = ask_broker(socket, args, timeout) {
            return r;
        }
    }
    fallback()
}

/// One `QMI` exchange. None on anything but a `RES` reply in time.
fn ask_broker(socket: &str, args: &[String], timeout: Duration) -> Option<(bool, String)> {
    let deadline = Instant::now() + timeout;
    let mut s = UnixStream::connect(socket).ok()?;
    s.set_write_timeout(Some(timeout)).ok()?;
    s.write_all(&proto::encode_qmi_request(args, proto::mono_ms())).ok()?;
    s.shutdown(std::net::Shutdown::Write).ok()?;
    let mut buf = Vec::new();
    let mut tmp = [0u8; 4096];
    loop {
        let left = deadline.checked_duration_since(Instant::now()).filter(|d| !d.is_zero())?;
        s.set_read_timeout(Some(left)).ok()?;
        match s.read(&mut tmp) {
            Ok(0) => break,
            Ok(n) => buf.extend_from_slice(&tmp[..n]),
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
            Err(_) => return None,
        }
    }
    match proto::decode_reply(&buf)? {
        Reply::Res(ok, body) => Some((ok, String::from_utf8_lossy(&body).into_owned())),
        _ => None,
    }
}

/// A write error (closed stdout) is ignored, as in qcmd; the rc still says
/// whether the read worked.
fn emit(ok: bool, json: String) -> i32 {
    let mut out = std::io::stdout().lock();
    let _ = out.write_all(json.as_bytes());
    let _ = out.write_all(b"\n");
    let _ = out.flush();
    if ok {
        0
    } else {
        1
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::qmi::fake::{r1_net, start_registry};
    use std::os::unix::net::UnixListener;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    fn sv(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }

    fn sock(name: &str) -> String {
        let p = std::env::temp_dir().join(format!("qatd-qc-{name}-{}.sock", std::process::id()));
        let p = p.to_str().unwrap().to_string();
        let _ = std::fs::remove_file(&p);
        p
    }

    /// A fake broker: counts connections, reads the request to EOF and
    /// answers with `reply(request_bytes)` (None = say nothing, hold open).
    fn fake_broker(
        path: &str,
        reply: impl Fn(&[u8]) -> Option<Vec<u8>> + Send + 'static,
    ) -> Arc<AtomicUsize> {
        let l = UnixListener::bind(path).unwrap();
        let n = Arc::new(AtomicUsize::new(0));
        let n2 = n.clone();
        std::thread::spawn(move || {
            for c in l.incoming() {
                let mut c = c.unwrap();
                n2.fetch_add(1, Ordering::SeqCst);
                let mut req = Vec::new();
                let _ = c.read_to_end(&mut req);
                match reply(&req) {
                    Some(r) => {
                        let _ = c.write_all(&r);
                    }
                    None => std::thread::sleep(Duration::from_secs(2)),
                }
            }
        });
        n
    }

    fn local(args: &[&str]) -> (bool, String) {
        let reg = start_registry(&r1_net());
        query::answer(Some(&reg), &sv(args))
    }

    #[test]
    fn the_broker_is_used_only_when_the_capability_file_allows_it() {
        let path = sock("gate");
        let n = fake_broker(&path, |req| {
            assert!(req.starts_with(b"QMI "));
            Some(proto::encode_reply(&Reply::Res(true, b"{\"from\":\"broker\"}".to_vec())))
        });
        let fb = || (true, "{\"from\":\"local\"}".to_string());
        let args = sv(&["serving"]);
        let t = Duration::from_secs(2);
        // proto 3 + qmi=1: the broker answers.
        let r = exchange(Some("proto=3\nversion=0.3.0\nqmi=1\n"), &path, &args, t, fb);
        assert_eq!(r, (true, "{\"from\":\"broker\"}".to_string()));
        assert_eq!(n.load(Ordering::SeqCst), 1);
        // Everything else falls back WITHOUT ever connecting: an old daemon
        // must never be sent the QMI verb.
        for caps in [Some("proto=2\nversion=0.2.0\n"), Some("proto=3\nversion=0.3.0\n"), Some("proto=3\nqmi=0\n"), Some(""), None] {
            let r = exchange(caps, &path, &args, t, fb);
            assert_eq!(r, (true, "{\"from\":\"local\"}".to_string()), "{caps:?}");
        }
        assert_eq!(n.load(Ordering::SeqCst), 1, "an old or unknown broker was contacted");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn the_broker_failing_in_any_way_falls_back() {
        let caps = Some("proto=3\nqmi=1\n");
        let args = sv(&["ca"]);
        let fb = || (true, "{\"from\":\"local\"}".to_string());
        let local_answer = (true, "{\"from\":\"local\"}".to_string());
        // No socket at all.
        assert_eq!(exchange(caps, &sock("none"), &args, Duration::from_secs(1), fb), local_answer);
        // ERR instead of RES (e.g. refused), garbage, and a hang-up with nothing.
        for reply in [b"ERR command_failed\n".to_vec(), b"zzz".to_vec(), Vec::new(), b"RES 0 9\nshort".to_vec()] {
            let path = sock("bad");
            let r2 = reply.clone();
            fake_broker(&path, move |_| Some(r2.clone()));
            assert_eq!(exchange(caps, &path, &args, Duration::from_secs(1), fb), local_answer, "{reply:?}");
            let _ = std::fs::remove_file(&path);
        }
        // A broker that accepts and never answers: fallback after the timeout.
        let path = sock("hang");
        fake_broker(&path, |_| None);
        let t = Instant::now();
        assert_eq!(exchange(caps, &path, &args, Duration::from_millis(300), fb), local_answer);
        let e = t.elapsed();
        assert!(e >= Duration::from_millis(300) && e < Duration::from_millis(1500), "{e:?}");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_failed_read_from_the_broker_is_still_the_answer() {
        // RES 1 is a real answer (e.g. modem_not_ready): not a reason to ask again.
        let path = sock("res1");
        let body = query::fail_envelope("modem_not_ready");
        let b2 = body.clone();
        fake_broker(&path, move |_| Some(proto::encode_reply(&Reply::Res(false, b2.clone().into_bytes()))));
        let r = exchange(Some("proto=3\nqmi=1\n"), &path, &sv(&["cell"]), Duration::from_secs(1), || panic!("must not fall back"));
        assert_eq!(r, (false, body));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn broker_and_fallback_give_the_same_json_modulo_the_clock() {
        // Same reads through the daemon-side lane and the in-process path.
        let lane = crate::daemon::qmi_lane::QmiLane::with_registry(start_registry(&r1_net()));
        let norm = |j: &str| {
            // Drop the two per-call numbers: mono_ms and ssr_count.
            let a = j.find("\"mono_ms\":").unwrap();
            let b = j.find("\"data\":").unwrap();
            format!("{}{}", &j[..a], &j[b..])
        };
        let via_lane = match lane.answer(&sv(&["serving", "cell", "ca"])) {
            Reply::Res(ok, b) => (ok, String::from_utf8(b).unwrap()),
            _ => panic!(),
        };
        let direct = local(&["serving", "cell", "ca"]);
        assert!(via_lane.0 && direct.0);
        assert_eq!(norm(&via_lane.1), norm(&direct.1));
    }

    #[test]
    fn bad_arguments_fail_fast_with_rc_1_and_never_touch_a_socket() {
        for a in [&[][..], &["bogus"], &["bundle", "ca"], &["--daemon"], &["-d"], &[""]] {
            let t = Instant::now();
            assert_eq!(run_qmi(&sv(a)), 1, "{a:?}");
            assert!(t.elapsed() < Duration::from_millis(200), "{a:?}");
        }
        assert_eq!(run_qmi(&sv(&["--version"])), 0);
    }

    #[test]
    fn without_qrtr_the_fallback_reports_qmi_unavailable() {
        // On a host with no AF_QIPCRTR the in-process registry finds nothing.
        // (On the modem this same path answers with live data.)
        let net = crate::qmi::fake::FakeNet::new();
        net.set_fail_open(true);
        let reg = start_registry(&net);
        assert_eq!(query::answer(Some(&reg), &sv(&["serving"])), (false, query::fail_envelope("qmi_unavailable")));
    }
}
