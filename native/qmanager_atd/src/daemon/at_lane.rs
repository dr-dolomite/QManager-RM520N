//! The AT lane: one worker thread that owns the modem channel and runs AT and
//! SMS requests one at a time, in arrival order, from a bounded in-process
//! FIFO. It is the kernel accept backlog of the single-threaded broker moved
//! in-process, nothing more: the worker runs exactly what `serve()` ran
//! (peer_gone at its turn, queue time charged to the lock budget, the same
//! `Executor`), so every frozen AT invariant holds unchanged:
//!
//! - One request on the modem at a time: only this thread touches the channel.
//!   The client's long-flag watch relies on it (a short command that sees the
//!   flag while waiting cannot be the one running, so it is still queued).
//! - `waited = now - sent_ms` still covers all time since the client sent,
//!   including time in this queue, so nobody waits longer than the 5 s / 10 s
//!   lock budget in total.
//! - A caller that hung up while queued is dropped at dequeue, never run.
//!
//! Order is arrival at the queue. Readers finish reading in parallel, so two
//! requests can enter the queue in a different order than they were
//! accepted; a live client writes its whole request at once, so that only
//! happens when one peer is slow to write, and the slow one then simply goes
//! after the fast one instead of holding it up for up to 2 s. Each request's
//! budget comes from its own `sent_ms`, so no one is charged for another's
//! delay.

use super::peer_gone;
use crate::at::channel::{Channel, Device};
use crate::at::exec::{Executor, Outcome};
use crate::at::output::Code;
use crate::common::lock::LockFile;
use crate::common::log::Logger;
use crate::common::proto::{self, Reply};
use crate::sms;
use std::io::Write;
use std::os::unix::net::UnixStream;
use std::sync::mpsc::{self, Receiver, SyncSender, TrySendError};
use std::sync::Arc;
use std::time::Duration;

/// Requests that may wait in the lane. Past this the caller gets modem_busy at
/// once (the old equivalent was a full accept backlog). Anything queued behind
/// 64 others is past its 5 s budget at its turn anyway.
pub(crate) const QUEUE_CAP: usize = 64;

/// A decoded, validated request for the modem.
pub(crate) enum AtRequest {
    /// `REQ`: one AT command for `Executor::run_after`.
    Req(String),
    /// `SMS`: an operation already checked by `sms::parse_args`.
    Sms(sms::Op),
}

impl AtRequest {
    /// What the log names: the command, or the SMS label (never message text).
    pub(crate) fn label(&self) -> String {
        match self {
            AtRequest::Req(cmd) => cmd.clone(),
            AtRequest::Sms(op) => op.label(),
        }
    }

    /// The modem_busy answer in the form this request's client already reads
    /// for it: `ERR modem_busy` for qcmd; for qsms the same `RES` envelope
    /// `sms::run` produces when its lock budget runs out.
    pub(crate) fn busy_reply(&self) -> Reply {
        match self {
            AtRequest::Req(_) => Reply::Err(Code::ModemBusy),
            AtRequest::Sms(_) => Reply::Res(false, sms::error_json(Code::ModemBusy.as_str(), None).into_bytes()),
        }
    }
}

/// One queued request and the connection its reply goes to.
pub(crate) struct Job {
    pub stream: UnixStream,
    pub req: AtRequest,
    /// The client's CLOCK_MONOTONIC send time, from the request header.
    pub sent_ms: u64,
}

/// What the worker runs for each job it pops. Production is `ModemRunner`
/// (the real `Executor` on the real channel); tests plug in a closure.
pub(crate) trait AtRunner {
    fn run(&mut self, req: &AtRequest, waited: Duration) -> Reply;
}

impl<F: FnMut(&AtRequest, Duration) -> Reply> AtRunner for F {
    fn run(&mut self, req: &AtRequest, waited: Duration) -> Reply {
        self(req, waited)
    }
}

/// The real thing: exactly the calls the single-threaded `serve()` and
/// `serve_sms()` made, on a channel and lock owned by the lane.
pub(crate) struct ModemRunner<D: Device> {
    pub ch: Channel<D>,
    pub lock: LockFile,
    pub log: Arc<Logger>,
}

impl<D: Device> AtRunner for ModemRunner<D> {
    fn run(&mut self, req: &AtRequest, waited: Duration) -> Reply {
        let mut ex = Executor { ch: &mut self.ch, lock: &self.lock, log: &self.log };
        match req {
            AtRequest::Req(cmd) => match ex.run_after(cmd, waited) {
                Outcome::Ok(raw) => Reply::Ok(raw),
                Outcome::Err(code) => Reply::Err(code),
            },
            AtRequest::Sms(op) => {
                let (ok, json) = sms::run(&mut ex, op, waited);
                Reply::Res(ok, json.into_bytes())
            }
        }
    }
}

/// The handle readers push jobs through.
pub(crate) struct AtLane {
    tx: SyncSender<Job>,
    /// Production: a lane whose worker is gone means a broker that would
    /// accept forever and never answer, so the process exits for procd.
    exit_if_dead: bool,
}

impl AtLane {
    /// Starts the worker. `cap` is the queue bound (`QUEUE_CAP` in
    /// production). With `exit_if_dead`, the process exits if the worker ever
    /// stops (release builds abort on panic anyway; this covers any other end).
    pub(crate) fn spawn<R: AtRunner + Send + 'static>(
        runner: R,
        cap: usize,
        log: Arc<Logger>,
        exit_if_dead: bool,
    ) -> std::io::Result<AtLane> {
        let (tx, rx) = mpsc::sync_channel::<Job>(cap);
        // Default stack (as large as the single-threaded broker's ever needed
        // to be on the main thread): this thread runs the whole AT and SMS path.
        std::thread::Builder::new().name("atd-at-lane".into()).spawn(move || {
            let _exit = exit_if_dead.then(|| ExitOnDrop(log.clone()));
            work(rx, runner, &log);
        })?;
        Ok(AtLane { tx, exit_if_dead })
    }

    /// Queues `job`, or answers it modem_busy at once when the queue is full.
    /// Never blocks, so a reader is never held up by the modem.
    pub(crate) fn submit(&self, job: Job, log: &Logger) {
        match self.tx.try_send(job) {
            Ok(()) => {}
            Err(TrySendError::Full(mut job)) => {
                log.error(&format!("AT queue full ({QUEUE_CAP}), modem_busy for: {}", job.req.label()));
                let _ = job.stream.write_all(&proto::encode_reply(&job.req.busy_reply()));
            }
            Err(TrySendError::Disconnected(_)) => {
                log.error("AT lane worker is gone; exiting so the broker is restarted");
                if self.exit_if_dead {
                    std::process::exit(1);
                }
            }
        }
    }
}

struct ExitOnDrop(Arc<Logger>);

impl Drop for ExitOnDrop {
    fn drop(&mut self) {
        self.0.error("AT lane worker stopped; exiting so the broker is restarted");
        std::process::exit(1);
    }
}

fn work<R: AtRunner>(rx: Receiver<Job>, mut runner: R, log: &Logger) {
    for job in rx {
        serve_job(job, &mut runner, log);
    }
}

/// Today's `serve()` tail, unchanged: skip a caller that already hung up,
/// charge the time since it sent to the budget, run, reply.
fn serve_job<R: AtRunner>(mut job: Job, runner: &mut R, log: &Logger) {
    if peer_gone(&job.stream) {
        log.warn(&format!("caller gone before its turn, not run: {}", job.req.label()));
        return;
    }
    let waited = Duration::from_millis(proto::mono_ms().saturating_sub(job.sent_ms));
    let reply = runner.run(&job.req, waited);
    let _ = job.stream.write_all(&proto::encode_reply(&reply));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::at::exec::LOCK_WAIT_SHORT;
    use std::io::Read;
    use std::sync::Mutex;
    use std::time::Instant;

    fn test_log() -> Arc<Logger> {
        Arc::new(Logger::new("test"))
    }

    /// A job whose reply the returned client end can read.
    fn job(req: AtRequest, sent_ms: u64) -> (UnixStream, Job) {
        let (client, stream) = UnixStream::pair().unwrap();
        (client, Job { stream, req, sent_ms })
    }

    fn req(cmd: &str) -> AtRequest {
        AtRequest::Req(cmd.to_string())
    }

    fn read_reply(mut c: UnixStream) -> Vec<u8> {
        c.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
        let mut v = Vec::new();
        let _ = c.read_to_end(&mut v);
        v
    }

    /// A fake runner: "HOLD" signals `started` and blocks until `release`;
    /// anything else answers OK with its own text. Every run is recorded.
    struct Fake {
        seen: Arc<Mutex<Vec<(String, Duration)>>>,
        started: mpsc::Sender<()>,
        release: mpsc::Receiver<()>,
    }

    fn fake_lane(cap: usize) -> (AtLane, Arc<Mutex<Vec<(String, Duration)>>>, mpsc::Receiver<()>, mpsc::Sender<()>) {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let f = Fake { seen: seen.clone(), started: started_tx, release: release_rx };
        let runner = move |r: &AtRequest, waited: Duration| {
            let label = r.label();
            f.seen.lock().unwrap().push((label.clone(), waited));
            if label == "HOLD" {
                let _ = f.started.send(());
                let _ = f.release.recv();
            }
            Reply::Ok(label.into_bytes())
        };
        let lane = AtLane::spawn(runner, cap, test_log(), false).unwrap();
        (lane, seen, started_rx, release_tx)
    }

    /// Puts a HOLD job on the lane and waits until the worker is running it.
    fn hold(lane: &AtLane, started: &mpsc::Receiver<()>, log: &Logger) -> UnixStream {
        let (c, j) = job(req("HOLD"), proto::mono_ms());
        lane.submit(j, log);
        started.recv_timeout(Duration::from_secs(5)).expect("worker never started HOLD");
        c
    }

    #[test]
    fn jobs_run_one_at_a_time_in_arrival_order() {
        let log = test_log();
        let (lane, seen, started, release) = fake_lane(QUEUE_CAP);
        let h = hold(&lane, &started, &log);
        let names = ["A", "B", "C", "D", "E"];
        let clients: Vec<_> = names
            .iter()
            .map(|n| {
                let (c, j) = job(req(n), proto::mono_ms());
                lane.submit(j, &log);
                c
            })
            .collect();
        release.send(()).unwrap();
        assert_eq!(read_reply(h), b"OK 4\nHOLD");
        for (c, n) in clients.into_iter().zip(names) {
            assert_eq!(read_reply(c), format!("OK 1\n{n}").into_bytes());
        }
        let order: Vec<String> = seen.lock().unwrap().iter().map(|(l, _)| l.clone()).collect();
        assert_eq!(order, ["HOLD", "A", "B", "C", "D", "E"]);
    }

    #[test]
    fn time_spent_in_the_queue_counts_as_waited() {
        let log = test_log();
        let (lane, seen, started, release) = fake_lane(QUEUE_CAP);
        let h = hold(&lane, &started, &log);
        // Already 1 s old when it reached the broker, then 300 ms in the lane.
        let (c, j) = job(req("X"), proto::mono_ms() - 1000);
        lane.submit(j, &log);
        std::thread::sleep(Duration::from_millis(300));
        release.send(()).unwrap();
        drop(read_reply(h));
        assert_eq!(read_reply(c), b"OK 1\nX");
        let w = seen.lock().unwrap().iter().find(|(l, _)| l == "X").unwrap().1;
        assert!(w >= Duration::from_millis(1300), "waited {w:?}");
    }

    #[test]
    fn a_job_queued_past_its_budget_is_busy_and_never_reaches_the_modem() {
        // The production runner behind a held lane: 4.7 s old on arrival plus
        // 400 ms queued is past the 5 s short budget, so the real Executor
        // answers modem_busy without taking the lock or opening the channel.
        let log = test_log();
        let p = std::env::temp_dir().join(format!("qatd-lane-lock-{}", std::process::id()));
        let lock = LockFile::open(p.to_str().unwrap()).unwrap();
        let ch: Channel<UnixStream> = Channel::new(Box::new(|| panic!("command was sent")));
        let mut modem = ModemRunner { ch, lock, log: log.clone() };
        let (started_tx, started) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel::<()>();
        let runner = move |r: &AtRequest, waited: Duration| {
            if r.label() == "HOLD" {
                let _ = started_tx.send(());
                let _ = release_rx.recv();
                return Reply::Ok(Vec::new());
            }
            modem.run(r, waited)
        };
        let lane = AtLane::spawn(runner, QUEUE_CAP, log.clone(), false).unwrap();
        let h = hold(&lane, &started, &log);
        let aged = LOCK_WAIT_SHORT.as_millis() as u64 - 300;
        let (c, j) = job(req("AT+CSQ"), proto::mono_ms() - aged);
        lane.submit(j, &log);
        std::thread::sleep(Duration::from_millis(400));
        release_tx.send(()).unwrap();
        drop(read_reply(h));
        assert_eq!(read_reply(c), b"ERR modem_busy\n");
        let _ = std::fs::remove_file(p);
    }

    #[test]
    fn a_caller_that_hung_up_while_queued_is_skipped() {
        let log = test_log();
        let (lane, seen, started, release) = fake_lane(QUEUE_CAP);
        let h = hold(&lane, &started, &log);
        let (gone, j) = job(req("GONE"), proto::mono_ms());
        lane.submit(j, &log);
        drop(gone);
        let (c, j) = job(req("NEXT"), proto::mono_ms());
        lane.submit(j, &log);
        // Let the hang-up land even if a parallel test's fork holds a copy
        // of the fd until its exec.
        std::thread::sleep(Duration::from_millis(100));
        release.send(()).unwrap();
        drop(read_reply(h));
        assert_eq!(read_reply(c), b"OK 4\nNEXT");
        let order: Vec<String> = seen.lock().unwrap().iter().map(|(l, _)| l.clone()).collect();
        assert_eq!(order, ["HOLD", "NEXT"]);
    }

    #[test]
    fn a_full_queue_answers_modem_busy_at_once_in_each_clients_format() {
        let log = test_log();
        let (lane, seen, started, release) = fake_lane(2);
        let h = hold(&lane, &started, &log);
        let queued: Vec<_> = ["A", "B"]
            .iter()
            .map(|n| {
                let (c, j) = job(req(n), proto::mono_ms());
                lane.submit(j, &log);
                c
            })
            .collect();
        let t = Instant::now();
        let (c, j) = job(req("C"), proto::mono_ms());
        lane.submit(j, &log);
        assert_eq!(read_reply(c), b"ERR modem_busy\n");
        let op = sms::parse_args(&["status".to_string()]).unwrap();
        let (c, j) = job(AtRequest::Sms(op), proto::mono_ms());
        lane.submit(j, &log);
        let want = proto::encode_reply(&Reply::Res(false, sms::error_json("modem_busy", None).into_bytes()));
        assert_eq!(read_reply(c), want);
        assert!(t.elapsed() < Duration::from_millis(500), "{:?}", t.elapsed());
        release.send(()).unwrap();
        drop(read_reply(h));
        for c in queued {
            drop(read_reply(c));
        }
        let order: Vec<String> = seen.lock().unwrap().iter().map(|(l, _)| l.clone()).collect();
        assert_eq!(order, ["HOLD", "A", "B"]);
    }
}
