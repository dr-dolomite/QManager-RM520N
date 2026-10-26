//! The broker: bind the socket, accept connections, and route each request to
//! its lane.
//!
//! - The acceptor (the main thread) hands every connection to a reader thread
//!   from a bounded pool. While all readers are busy it stops accepting, so the
//!   kernel backlog holds callers exactly as it did for the single-threaded
//!   broker: nobody is turned away.
//! - A reader validates the request exactly as before (peer uid, size caps,
//!   exact length, 2 s read timeout, same refusals) and routes it by verb.
//! - `REQ` and `SMS` go to the AT lane (`at_lane`): one worker, in-process
//!   FIFO, today's `Executor` unchanged. Refusals are answered by the reader
//!   itself.
//! - `QMI` goes to the QMI lane (`qmi_lane`): no modem lock, answered on the
//!   reader thread from the shared service registry, never behind the AT
//!   lane.

pub(crate) mod at_lane;
pub(crate) mod data_call;
pub(crate) mod qmi_lane;
pub(crate) mod live;
pub(crate) mod qmi_snapshot;

use crate::at::exec;
use crate::at::new_channel;
use crate::at::output::Code;
use crate::common::lock::{self, LockFile};
use crate::common::log::Logger;
use crate::common::proto::{self, Reply};
use crate::sms;
use at_lane::{AtLane, AtRequest, Job, ModemRunner};
use qmi_lane::QmiLane;
use std::io::{Read, Write};
use std::os::unix::io::AsRawFd;
use std::os::unix::net::{UnixListener, UnixStream};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

/// Readers that may run at once. A live client's AT or SMS request is read
/// and handed to the AT lane in microseconds; a stuck peer holds a reader for
/// up to its 2 s read timeout. A QMI request is answered on its reader, for
/// up to the QMI lane's deadline (2 s), but at most `qmi_lane::MAX_IN_FLIGHT`
/// at once: the rest of the pool is always free for AT.
const MAX_READERS: usize = 16;
/// Readers only decode a request of at most 64 KB into a heap buffer.
const READER_STACK: usize = 128 * 1024;

pub(crate) fn run_daemon() -> i32 {
    let log = Arc::new(Logger::new("qmanager_atd"));
    let lock = match LockFile::open(lock::LOCK_FILE) {
        Ok(l) => l,
        Err(e) => {
            log.error(&format!("cannot open lock file: {e}"));
            return 1;
        }
    };
    // Never take over a live broker: unlinking its socket would leave it
    // serving nobody while every client fell back to in-process. A stale
    // socket (no listener) refuses the connect and is replaced as before.
    if UnixStream::connect(proto::SOCKET_PATH).is_ok() {
        log.error(&format!("another broker is listening on {}; not starting", proto::SOCKET_PATH));
        return 1;
    }
    let _ = std::fs::remove_file(proto::SOCKET_PATH);
    // Root-only from the instant it exists: /dev/smd11 is crw------- root, and
    // uhttpd runs CGIs as root, so no legitimate caller needs more. Setting the
    // umask before bind (not chmod after) leaves no window where the socket is
    // reachable by other users. /var/run is root:root 0755.
    let old_mask = unsafe { libc::umask(0o177) };
    let bound = UnixListener::bind(proto::SOCKET_PATH);
    unsafe { libc::umask(old_mask) };
    let listener = match bound {
        Ok(l) => l,
        Err(e) => {
            log.error(&format!("cannot bind {}: {e}", proto::SOCKET_PATH));
            return 1;
        }
    };
    log.info(&format!("broker up, listening on {}", proto::SOCKET_PATH));
    // After the bind: the file promises a broker that is already reachable.
    if let Err(e) = proto::write_proto_file(proto::PROTO_PATH) {
        log.warn(&format!("cannot write {}: {e}", proto::PROTO_PATH));
    }
    exec::clear_stale_long_flag(&lock, &log);

    let modem = ModemRunner { ch: new_channel(), lock, log: log.clone() };
    let at = match AtLane::spawn(modem, at_lane::QUEUE_CAP, log.clone(), true) {
        Ok(l) => l,
        Err(e) => {
            log.error(&format!("cannot start the AT lane: {e}"));
            return 1;
        }
    };
    // After the AT lane, off this thread: the registry's startup lookup is
    // bounded at 500 ms and AT serving must never wait on it.
    let qmi = QmiLane::start(log.clone());
    accept_loop(listener, Arc::new(Ctx { log, at, qmi, uid: 0 }))
}

/// What every reader shares.
struct Ctx {
    log: Arc<Logger>,
    at: AtLane,
    qmi: QmiLane,
    /// The only peer uid served: root in production.
    uid: u32,
}

/// Counting semaphore over reader threads.
struct Slots {
    used: Mutex<usize>,
    freed: Condvar,
}

struct Slot(Arc<Slots>);

impl Slots {
    /// Blocks while every reader is busy.
    fn take(self: &Arc<Self>) -> Slot {
        let mut n = self.used.lock().unwrap_or_else(|e| e.into_inner());
        while *n >= MAX_READERS {
            n = self.freed.wait(n).unwrap_or_else(|e| e.into_inner());
        }
        *n += 1;
        Slot(self.clone())
    }
}

impl Drop for Slot {
    fn drop(&mut self) {
        *self.0.used.lock().unwrap_or_else(|e| e.into_inner()) -= 1;
        self.0.freed.notify_one();
    }
}

/// Accepts forever. A free reader slot is taken *before* accepting, so with
/// all readers busy the connection stays in the kernel backlog.
fn accept_loop(listener: UnixListener, ctx: Arc<Ctx>) -> ! {
    let slots = Arc::new(Slots { used: Mutex::new(0), freed: Condvar::new() });
    loop {
        let slot = slots.take();
        let stream = match listener.accept() {
            Ok((s, _)) => s,
            Err(e) => {
                drop(slot);
                // e.g. EMFILE: back off instead of spinning on the log.
                ctx.log.warn(&format!("accept failed: {e}"));
                std::thread::sleep(Duration::from_millis(100));
                continue;
            }
        };
        // Kept so the request is still served (inline) if no thread can be
        // started: the closure, and the stream in it, are dropped on failure.
        let spare = stream.try_clone();
        let c = ctx.clone();
        let spawned = std::thread::Builder::new()
            .name("atd-reader".into())
            .stack_size(READER_STACK)
            .spawn(move || {
                let _slot = slot;
                handle_conn(stream, &c);
            });
        match (spawned, spare) {
            (Ok(_), _) => {}
            (Err(e), Ok(stream)) => {
                ctx.log.warn(&format!("cannot start a reader thread ({e}); reading inline"));
                handle_conn(stream, &ctx);
            }
            (Err(e), Err(_)) => ctx.log.warn(&format!("cannot start a reader thread ({e}); connection dropped")),
        }
    }
}

/// Largest AT request accepted. An AT command is well under 1 KB.
const MAX_REQUEST: usize = 8192;
/// Largest SMS request: 255 parts of 67 UTF-16 units is ~51 KB of UTF-8.
const MAX_SMS_REQUEST: usize = 64 * 1024;
/// Largest QMI request: a handful of read names.
const MAX_QMI_REQUEST: usize = 1024;

/// True once the client closed its end completely (not just its write half),
/// i.e. nobody is waiting for this reply any more: the caller was killed while
/// queued (CGI timeout, `timeout` wrapper). Legacy qcmd, killed while waiting
/// for the lock, never ran the command either.
pub(crate) fn peer_gone(stream: &UnixStream) -> bool {
    let mut pfd = libc::pollfd { fd: stream.as_raw_fd(), events: 0, revents: 0 };
    let r = unsafe { libc::poll(&mut pfd, 1, 0) };
    r > 0 && pfd.revents & (libc::POLLHUP | libc::POLLERR) != 0
}

fn refuse(stream: &mut UnixStream, log: &Logger, why: &str) {
    log.warn(&format!("refused request: {why}"));
    let _ = stream.write_all(&proto::encode_reply(&Reply::Err(Code::CommandFailed)));
}

/// The connecting peer's uid, from the kernel (cannot be spoofed by the peer).
fn peer_uid(stream: &UnixStream) -> Option<u32> {
    let mut cred: libc::ucred = unsafe { std::mem::zeroed() };
    let mut len = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
    let r = unsafe {
        libc::getsockopt(
            stream.as_raw_fd(),
            libc::SOL_SOCKET,
            libc::SO_PEERCRED,
            &mut cred as *mut libc::ucred as *mut libc::c_void,
            &mut len,
        )
    };
    (r == 0).then_some(cred.uid)
}

/// Where a validated request goes.
enum Route {
    /// The AT lane: `REQ` or `SMS`, with the client's send time.
    At(AtRequest, u64),
    /// The QMI lane: `QMI`, with its arguments. Answered by the reader.
    Qmi(Vec<String>),
    /// Answered by the reader itself, without any lane.
    Answer(Reply),
    /// Refused and logged (`refused request: ...`), answered command_failed.
    Refuse(&'static str),
}

/// Decodes a fully-read request and picks its lane. The checks and their
/// answers are the single-threaded broker's, in the same order.
fn route(buf: &[u8]) -> Route {
    if buf.starts_with(b"SMS ") {
        let req = match proto::decode_sms_request(buf) {
            Some(r) => r,
            None => return Route::Refuse("malformed or truncated SMS request"),
        };
        // Re-validated here: the socket is the trust boundary, not the client.
        return match sms::parse_args(&req.args) {
            Ok(op) => Route::At(AtRequest::Sms(op), req.sent_ms),
            Err(e) => Route::Answer(Reply::Res(false, sms::error_json("bad_args", Some(&e)).into_bytes())),
        };
    }
    if buf.starts_with(b"QMI ") {
        // The reads are validated by the lane (bad_args is a normal answer);
        // only framing is checked here.
        return match proto::decode_qmi_request(buf) {
            Some(r) => Route::Qmi(r.args),
            None => Route::Refuse("malformed or truncated QMI request"),
        };
    }
    match proto::decode_request(buf) {
        Some(r) if !r.cmd.is_empty() => Route::At(AtRequest::Req(r.cmd.to_string()), r.sent_ms),
        _ => Route::Refuse("malformed or truncated"),
    }
}

/// One connection, on a reader thread: authenticate, read, route.
fn handle_conn(mut stream: UnixStream, ctx: &Ctx) {
    let log = &*ctx.log;
    // Defense in depth behind the 0600 socket: only root may drive the modem,
    // the same boundary /dev/smd11 itself enforces.
    match peer_uid(&stream) {
        Some(u) if u == ctx.uid => {}
        other => {
            log.warn(&format!("rejected AT request from non-root peer (uid {other:?})"));
            let _ = stream.write_all(&proto::encode_reply(&Reply::Err(Code::CommandFailed)));
            return;
        }
    }
    // The client writes its whole request at once and half-closes, so a live
    // client is done in microseconds. A short timeout bounds how long a stuck
    // peer can hold a reader.
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let mut buf = Vec::new();
    let mut tmp = [0u8; 4096];
    // Read the whole request to EOF. Anything that doesn't end cleanly (read
    // error, timeout, oversize) is refused: a partial command must never run.
    loop {
        match stream.read(&mut tmp) {
            Ok(0) => break,
            Ok(n) => buf.extend_from_slice(&tmp[..n]),
            Err(e) => return refuse(&mut stream, log, &format!("incomplete read ({e})")),
        }
        // The kind is known from the first bytes; an AT request keeps its cap.
        let cap = if buf.starts_with(b"SMS ") {
            MAX_SMS_REQUEST
        } else if buf.starts_with(b"QMI ") {
            MAX_QMI_REQUEST
        } else {
            MAX_REQUEST
        };
        if buf.len() > cap {
            return refuse(&mut stream, log, "oversize");
        }
    }
    match route(&buf) {
        Route::At(req, sent_ms) => ctx.at.submit(Job { stream, req, sent_ms }, log),
        // No modem lock and no queue: answered here, on the reader thread.
        Route::Qmi(args) => {
            let _ = stream.write_all(&proto::encode_reply(&ctx.qmi.answer(&args)));
        }
        Route::Answer(reply) => {
            let _ = stream.write_all(&proto::encode_reply(&reply));
        }
        Route::Refuse(why) => refuse(&mut stream, log, why),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Instant;

    /// A broker on a temp socket whose AT lane runs `runner`, serving this
    /// test's own uid. The acceptor thread lives until the test process ends.
    fn broker<R: at_lane::AtRunner + Send + 'static>(name: &str, runner: R) -> (String, Arc<Ctx>) {
        broker_with(name, runner, QmiLane::starting())
    }

    fn broker_with<R: at_lane::AtRunner + Send + 'static>(name: &str, runner: R, qmi: QmiLane) -> (String, Arc<Ctx>) {
        let path = std::env::temp_dir().join(format!("qatd-{name}-{}.sock", std::process::id()));
        let path = path.to_str().unwrap().to_string();
        let _ = std::fs::remove_file(&path);
        let listener = UnixListener::bind(&path).unwrap();
        let log = Arc::new(Logger::new("test"));
        let at = AtLane::spawn(runner, at_lane::QUEUE_CAP, log.clone(), false).unwrap();
        let ctx = Arc::new(Ctx { log, at, qmi, uid: unsafe { libc::getuid() } });
        let c = ctx.clone();
        std::thread::spawn(move || accept_loop(listener, c));
        (path, ctx)
    }

    /// One client exchange, the way qcmd/qsms do it: write, half-close, read.
    fn call(path: &str, req: &[u8]) -> Vec<u8> {
        let mut s = UnixStream::connect(path).unwrap();
        s.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
        s.write_all(req).unwrap();
        s.shutdown(std::net::Shutdown::Write).unwrap();
        let mut v = Vec::new();
        let _ = s.read_to_end(&mut v);
        v
    }

    #[test]
    fn requests_that_need_no_lane_answer_while_an_at_job_holds_it() {
        let (started_tx, started) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel::<()>();
        let runner = move |r: &AtRequest, _w: Duration| {
            let label = r.label();
            if label == "AT+HOLD" {
                let _ = started_tx.send(());
                let _ = release_rx.recv();
            }
            Reply::Ok(label.into_bytes())
        };
        let (path, _ctx) = broker("route", runner);
        let p2 = path.clone();
        let held = std::thread::spawn(move || call(&p2, &proto::encode_request("AT+HOLD", proto::mono_ms())));
        started.recv_timeout(Duration::from_secs(5)).expect("HOLD never reached the lane");
        // A queued AT request waits its turn behind the held lane.
        let p3 = path.clone();
        let queued = std::thread::spawn(move || call(&p3, &proto::encode_request("AT+CSQ", proto::mono_ms())));

        // Answered by the reader at once, not queued behind the AT job.
        let t = Instant::now();
        assert_eq!(call(&path, b"REQ 9 1\nAT"), b"ERR command_failed\n");
        let bad_sms = proto::encode_sms_request(&["bogus".to_string()], proto::mono_ms());
        let got = call(&path, &bad_sms);
        assert!(got.starts_with(b"RES 1 "), "{:?}", String::from_utf8_lossy(&got));
        assert!(String::from_utf8_lossy(&got).contains("\"bad_args\""));
        assert!(t.elapsed() < Duration::from_millis(1000), "{:?}", t.elapsed());
        assert!(!queued.is_finished() && !held.is_finished());

        release_tx.send(()).unwrap();
        assert_eq!(held.join().unwrap(), b"OK 7\nAT+HOLD");
        assert_eq!(queued.join().unwrap(), b"OK 6\nAT+CSQ");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_qmi_read_answers_in_milliseconds_while_an_at_job_holds_the_lane() {
        use crate::qmi::fake::{r1_net, start_registry};
        let (started_tx, started) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel::<()>();
        let runner = move |r: &AtRequest, _w: Duration| {
            let label = r.label();
            if label == "AT+HOLD" {
                let _ = started_tx.send(());
                let _ = release_rx.recv();
            }
            Reply::Ok(label.into_bytes())
        };
        let lane = QmiLane::with_registry(start_registry(&r1_net()));
        let (path, _ctx) = broker_with("qmi", runner, lane);
        let p2 = path.clone();
        let held = std::thread::spawn(move || call(&p2, &proto::encode_request("AT+HOLD", proto::mono_ms())));
        started.recv_timeout(Duration::from_secs(5)).expect("HOLD never reached the lane");
        let p3 = path.clone();
        let queued = std::thread::spawn(move || call(&p3, &proto::encode_request("AT+CSQ", proto::mono_ms())));

        // The headline invariant: QMI is not behind the AT lane. Warm the
        // connection path once, then time the real thing.
        let bundle = proto::encode_qmi_request(&["bundle".to_string()], proto::mono_ms());
        let _ = call(&path, &bundle);
        let t = Instant::now();
        let got = call(&path, &bundle);
        let el = t.elapsed();
        assert!(el < Duration::from_millis(100), "QMI behind a held AT lane took {el:?}");
        assert!(!held.is_finished() && !queued.is_finished(), "the AT lane must still be held");
        let reply = match proto::decode_reply(&got).unwrap() {
            Reply::Res(true, b) => String::from_utf8(b).unwrap(),
            _ => panic!("expected RES 0: {:?}", String::from_utf8_lossy(&got)),
        };
        assert!(got.starts_with(b"RES 0 "));
        assert!(reply.starts_with("{\"v\":1,\"ok\":true,\"mono_ms\":"), "{reply}");
        assert!(reply.contains("\"pci\":295") && reply.contains("\"band\":\"B1\""), "{reply}");

        // A bad read is a normal failure answer, not a refusal.
        let bad = proto::encode_qmi_request(&["nope".to_string()], proto::mono_ms());
        let got = call(&path, &bad);
        assert!(got.starts_with(b"RES 1 "), "{:?}", String::from_utf8_lossy(&got));
        assert!(String::from_utf8_lossy(&got).contains("\"error\":\"bad_args\""));

        release_tx.send(()).unwrap();
        assert_eq!(held.join().unwrap(), b"OK 7\nAT+HOLD");
        assert_eq!(queued.join().unwrap(), b"OK 6\nAT+CSQ");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn qmi_requests_against_a_silent_service_never_starve_at_of_readers() {
        use crate::qmi::fake::silent_registry;
        assert!(qmi_lane::MAX_IN_FLIGHT + 8 <= MAX_READERS);
        // Every in-cap QMI request holds its reader for the whole deadline.
        let lane = QmiLane::with_registry(silent_registry(500, 0)).limits(qmi_lane::MAX_IN_FLIGHT, Duration::from_secs(1));
        let (path, ctx) = broker_with("qmi-starve", |r: &AtRequest, _w: Duration| Reply::Ok(r.label().into_bytes()), lane);
        let n = MAX_READERS * 2;
        let mut qmi = Vec::new();
        for _ in 0..n {
            let p = path.clone();
            qmi.push(std::thread::spawn(move || call(&p, &proto::encode_qmi_request(&["bundle".to_string()], proto::mono_ms()))));
        }
        let end = Instant::now() + Duration::from_secs(2);
        while ctx.qmi.in_flight() < qmi_lane::MAX_IN_FLIGHT && Instant::now() < end {
            std::thread::sleep(Duration::from_millis(1));
        }
        assert_eq!(ctx.qmi.in_flight(), qmi_lane::MAX_IN_FLIGHT);
        // AT is served at once while the QMI requests are still held.
        let t = Instant::now();
        assert_eq!(call(&path, &proto::encode_request("AT+CSQ", proto::mono_ms())), b"OK 6\nAT+CSQ");
        let el = t.elapsed();
        assert!(el < Duration::from_millis(300), "AT behind QMI took {el:?}");
        assert!(ctx.qmi.in_flight() > 0, "the QMI requests must still be in flight");
        let replies: Vec<Vec<u8>> = qmi.into_iter().map(|h| h.join().unwrap()).collect();
        let fallback = replies.iter().filter(|r| r.as_slice() == b"ERR command_failed\n").count();
        let answered = replies.iter().filter(|r| r.starts_with(b"RES 1 ")).count();
        assert_eq!(fallback + answered, n, "{replies:?}");
        assert!(answered >= qmi_lane::MAX_IN_FLIGHT && fallback >= n - 2 * qmi_lane::MAX_IN_FLIGHT, "{answered} {fallback}");
        assert_eq!(ctx.qmi.peak(), qmi_lane::MAX_IN_FLIGHT);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn qmi_requests_obey_the_framing_and_size_rules() {
        let (path, _ctx) = broker("qmi-frame", |r: &AtRequest, _w: Duration| Reply::Ok(r.label().into_bytes()));
        // A lane whose registry has not arrived: valid -> modem_not_ready.
        let ok = proto::encode_qmi_request(&["serving".to_string()], 1);
        let got = String::from_utf8(call(&path, &ok)).unwrap();
        assert!(got.starts_with("RES 1 ") && got.contains("modem_not_ready"), "{got}");
        // Truncated, padded and oversize requests are refused, never answered.
        assert_eq!(call(&path, &ok[..ok.len() - 1]), b"ERR command_failed\n");
        let mut padded = ok.clone();
        padded.push(b'x');
        assert_eq!(call(&path, &padded), b"ERR command_failed\n");
        let big = proto::encode_qmi_request(&["x".repeat(MAX_QMI_REQUEST + 1)], 1);
        assert_eq!(call(&path, &big), b"ERR command_failed\n");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn route_decodes_qmi_and_refuses_it_malformed() {
        let args = vec!["serving".to_string(), "ca".to_string()];
        assert!(matches!(route(&proto::encode_qmi_request(&args, 3)), Route::Qmi(ref a) if *a == args));
        assert!(matches!(route(&proto::encode_qmi_request(&[], 3)), Route::Qmi(ref a) if a.is_empty()));
        for bad in [&b"QMI 9 1\nx"[..], b"QMI x 1\nab", b"QMI 1 x\na", b"QMI 1 1 1\na", b"QMI 2 1\na\xff"] {
            assert!(matches!(route(bad), Route::Refuse("malformed or truncated QMI request")), "{bad:?}");
        }
        // A QMI body is never run as an AT command, nor the reverse.
        assert!(matches!(route(&proto::encode_request("QMI", 1)), Route::At(AtRequest::Req(_), 1)));
    }

    #[test]
    fn route_keeps_the_single_threaded_checks() {
        assert!(matches!(route(&proto::encode_request("AT+CSQ", 5)), Route::At(AtRequest::Req(ref c), 5) if c == "AT+CSQ"));
        assert!(matches!(route(&proto::encode_request("", 5)), Route::Refuse("malformed or truncated")));
        assert!(matches!(route(b"REQ 3 1\nAT"), Route::Refuse("malformed or truncated")));
        let sms = proto::encode_sms_request(&["status".to_string()], 7);
        assert!(matches!(route(&sms), Route::At(AtRequest::Sms(_), 7)));
        assert!(matches!(route(b"SMS 9 1\nx"), Route::Refuse("malformed or truncated SMS request")));
        let bad = proto::encode_sms_request(&["nope".to_string()], 7);
        assert!(matches!(route(&bad), Route::Answer(Reply::Res(false, _))));
    }
}
