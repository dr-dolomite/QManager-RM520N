//! The live signal channel (QMI Phase 2, plan L1-L7): while an authenticated
//! page holds a lease, the sampler also publishes a small identifier-free
//! JSON file that uhttpd serves statically from tmpfs.
//!
//! Trust boundary. No client number reaches the broker. The lease CGI writes
//! one stamp file per tier into the root-only run dir
//! (`/var/run/qmanager/qmi_live_{aim,watch}`), each holding one line: the
//! CLOCK_BOOTTIME second (`/proc/uptime`'s integer part) of the renewal. The
//! broker maps the fastest fresh tier to a compiled period (aim 1 s,
//! watch 1 s, none 2 s; aim's 5 Hz was dropped, see `AIM_PERIOD`). A stamp
//! counts only if it is a regular file owned by
//! the broker's euid, opened without following a link, holding digits only
//! (no leading zero, at most 10), not in the future and at most 10 s old. No
//! wall clock is involved, so NTP / NITZ steps cannot hold a lease up.
//!
//! Token. `/var/run/qmanager/qmi_live.token` (exactly 64 lowercase hex, an
//! optional trailing newline) names the public file
//! `/var/run/qmanager/live/<token>.json`. The CGI mints it under
//! `/var/run/qmanager/qmi_live.lock`; the broker validates it before it
//! builds any path from it.
//!
//! Public dir. `/var/run/qmanager/live` (served as `/www/qmlive`, a symlink;
//! uhttpd runs as root) is made a real 0755 directory owned by the euid,
//! inside the verified root-only 0700 run dir, before every publish and always holds an
//! empty `index.html`, so uhttpd's directory listing can never reveal the
//! token. Hygiene (on start, on a token change and on expiry) deletes
//! everything else except the current `<token>.json`.
//!
//! Expiry. When no stamp is fresh and something is still published (or a
//! token file exists), the broker takes the lock without blocking (busy:
//! retry next slice), re-checks the stamps under it, then deletes the token,
//! the public file and its `.new`, and clears its ring. The next lease mints
//! a new token.
//!
//! Ring. Up to 32 samples (about 32 s at 1 Hz), each with a `seq` that only
//! grows within one daemon run (`run` = the daemon's start, CLOCK_BOOTTIME ms; it changes on
//! a restart, which tells a client to reset). A failed read pushes no sample
//! (the file's `qmi_state` says why nothing new arrived). While the long /
//! scan flag is up, `scan` is true and the serving fields of new samples are
//! null: mid-scan the QMI serving EARFCN follows the scanned carriers.

use crate::common::json::{arr, J};
use crate::common::log::Logger;
use crate::common::safefs;
use crate::qmi::model::{Bundle, Registration};
use std::collections::VecDeque;
use std::fs::{File, OpenOptions};
use std::io::{self, Read};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::os::unix::io::AsRawFd;
use std::time::Duration;

pub const STAMP_AIM: &str = "/var/run/qmanager/qmi_live_aim";
pub const STAMP_WATCH: &str = "/var/run/qmanager/qmi_live_watch";
pub const TOKEN_PATH: &str = "/var/run/qmanager/qmi_live.token";
pub const LOCK_PATH: &str = "/var/run/qmanager/qmi_live.lock";
/// Not directly in world-writable /tmp: a local user could pre-create it
/// there and have their content served from the web root.
pub const RUN_DIR: &str = "/var/run/qmanager";
pub const PUBLIC_DIR: &str = "/var/run/qmanager/live";
pub const INDEX: &str = "index.html";

/// 1 s, the same as `watch`, since 2026-10-23: a leased 5 Hz soak coincided
/// with a higher baseband SSR rate. 1 Hz is final (decision 2026-10-25) and
/// 5 Hz is dropped; the aim tier and its stamp stay for the lease contract.
pub const AIM_PERIOD: Duration = Duration::from_millis(1000);
pub const WATCH_PERIOD: Duration = Duration::from_millis(1000);
pub const IDLE_PERIOD: Duration = Duration::from_secs(2);
/// Floor of any period: 1 Hz.
pub const MIN_PERIOD: Duration = Duration::from_millis(1000);
/// The longest the sampler sleeps before it looks at the stamps again.
pub const MAX_SLICE: Duration = Duration::from_millis(250);
/// A stamp older than this (seconds on the boot clock) is no lease.
pub const STAMP_TTL_S: u64 = 10;
pub const RING: usize = 32;
/// SCCs listed per sample (the PCC is the sample's own serving fields).
const SCCS: usize = 4;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Tier {
    None,
    Watch,
    Aim,
}

pub fn period_for(t: Tier) -> Duration {
    match t {
        Tier::Aim => AIM_PERIOD,
        Tier::Watch => WATCH_PERIOD,
        Tier::None => IDLE_PERIOD,
    }
    .max(MIN_PERIOD)
}

/// How long the sampler sleeps at most between checks.
pub fn slice_for(period: Duration) -> Duration {
    period.min(MAX_SLICE)
}

/// CLOCK_BOOTTIME milliseconds.
pub fn boot_ms() -> u64 {
    let mut ts: libc::timespec = unsafe { std::mem::zeroed() };
    unsafe { libc::clock_gettime(libc::CLOCK_BOOTTIME, &mut ts) };
    (ts.tv_sec as u64).saturating_mul(1000).saturating_add(ts.tv_nsec as u64 / 1_000_000)
}

/// One stamp line: digits only, no leading zero (a lone `0` is fine), 1-10
/// digits, one optional trailing newline. Anything else is None.
pub fn parse_stamp(raw: &[u8]) -> Option<u64> {
    let b = raw.strip_suffix(b"\n").unwrap_or(raw);
    if b.is_empty() || b.len() > 10 || !b.iter().all(|c| c.is_ascii_digit()) {
        return None;
    }
    if b.len() > 1 && b.first() == Some(&b'0') {
        return None;
    }
    std::str::from_utf8(b).ok()?.parse().ok()
}

/// Fresh: not in the future and at most `STAMP_TTL_S` old.
pub fn stamp_fresh(stamp: u64, now_s: u64) -> bool {
    stamp <= now_s && now_s - stamp <= STAMP_TTL_S
}

/// Reads at most `cap` bytes of a small control file: opened without
/// following a link (and non-blocking, so a planted FIFO cannot stall the
/// sampler), it must be a regular file owned by `uid`. A file longer than
/// `cap` is refused rather than truncated.
fn read_small(path: &str, cap: usize, uid: u32) -> Option<Vec<u8>> {
    let mut f = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK)
        .open(path)
        .ok()?;
    let m = f.metadata().ok()?;
    if !m.file_type().is_file() || m.uid() != uid {
        return None;
    }
    let mut buf = Vec::with_capacity(cap + 1);
    (&mut f).take(cap as u64 + 1).read_to_end(&mut buf).ok()?;
    if buf.len() > cap {
        return None;
    }
    Some(buf)
}

fn euid() -> u32 {
    unsafe { libc::geteuid() }
}

/// True if the stamp file at `path` is a valid fresh lease for `uid`.
pub fn stamp_file_fresh(path: &str, now_s: u64, uid: u32) -> bool {
    read_small(path, 11, uid).and_then(|b| parse_stamp(&b)).map_or(false, |s| stamp_fresh(s, now_s))
}

/// Exactly 64 lowercase hex characters.
pub fn valid_token(t: &str) -> bool {
    t.len() == 64 && t.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

/// The token, if the file holds a valid one (one optional trailing newline).
pub fn read_token(path: &str, uid: u32) -> Option<String> {
    let b = read_small(path, 65, uid)?;
    let b = b.strip_suffix(b"\n").unwrap_or(&b);
    let t = std::str::from_utf8(b).ok()?;
    valid_token(t).then(|| t.to_string())
}

pub struct LivePaths {
    /// The root-only parent, verified (0700) before the public dir; None
    /// skips it (tests on a plain temp dir).
    pub run_dir: Option<String>,
    pub aim: String,
    pub watch: String,
    pub token: String,
    pub lock: String,
    pub public_dir: String,
    /// The long-command / scan flag.
    pub long_flag: String,
}

impl LivePaths {
    pub fn production() -> LivePaths {
        LivePaths {
            run_dir: Some(RUN_DIR.into()),
            aim: STAMP_AIM.into(),
            watch: STAMP_WATCH.into(),
            token: TOKEN_PATH.into(),
            lock: LOCK_PATH.into(),
            public_dir: PUBLIC_DIR.into(),
            long_flag: crate::at::exec::LONG_FLAG.into(),
        }
    }
}

/// Removes whatever is at `p` without following a link.
fn remove_any(p: &str) {
    match std::fs::symlink_metadata(p) {
        Ok(m) if m.file_type().is_dir() => {
            let _ = std::fs::remove_dir_all(p);
        }
        Ok(_) => {
            let _ = std::fs::remove_file(p);
        }
        Err(_) => {}
    }
}

/// Takes `path`'s flock without waiting. Ok(None) when someone holds it.
/// The lock is released when the returned file is dropped.
fn try_lock(path: &str) -> io::Result<Option<File>> {
    let f = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK)
        .open(path)?;
    if unsafe { libc::flock(f.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } == 0 {
        return Ok(Some(f));
    }
    let e = io::Error::last_os_error();
    if e.raw_os_error() == Some(libc::EWOULDBLOCK) {
        Ok(None)
    } else {
        Err(e)
    }
}

fn registered(b: &Bundle) -> Option<bool> {
    match b.signal.registration {
        Registration::Registered => Some(true),
        Registration::Unknown => None,
        _ => Some(false),
    }
}

/// One sample. Only the allow-listed fields: never cell ID, TAC, eNB /
/// sector, MCC / MNC, operator or any other identifier. Signals are tenths
/// of a dB(m) as integers, null unless registered. `scan` nulls every
/// serving field.
pub fn render_sample(seq: u64, t_ms: u64, b: Option<&Bundle>, scan: bool) -> String {
    let b = if scan { None } else { b };
    let mut j = J::obj();
    j.num("seq", seq).num("t", t_ms).opt_bool("reg", b.and_then(registered));
    let sig = b.filter(|b| b.registered()).and_then(|b| b.signal.lte);
    j.opt_num("rsrp", sig.and_then(|s| s.rsrp).map(|r| r.x10))
        .opt_num("rsrq", sig.and_then(|s| s.rsrq).map(|r| r.x10))
        .opt_num("rssi", sig.and_then(|s| s.rssi).map(|r| r.x10))
        .opt_num("sinr", sig.and_then(|s| s.sinr).map(|r| r.x10));
    // NR (NSA) from Get Signal Info: RSRP is the mean of the NR RX chains,
    // not QENG's strongest chain.
    let nr = b.filter(|b| b.registered()).and_then(|b| b.signal.nr);
    j.opt_num("nr_rsrp", nr.and_then(|s| s.rsrp).map(|r| r.x10))
        .opt_num("nr_rsrq", nr.and_then(|s| s.rsrq).map(|r| r.x10))
        .opt_num("nr_sinr", nr.and_then(|s| s.sinr).map(|r| r.x10));
    let lte =b.and_then(|b| b.cell.as_ref()).and_then(|c| c.lte.as_ref());
    j.opt_num("pci", lte.map(|l| l.pci)).opt_num("earfcn", lte.map(|l| l.earfcn));
    let (band, bw) = b.map_or((None, None), |b| b.lte_band());
    j.opt_str("band", band.as_deref()).opt_num("bw", bw);
    match b.and_then(|b| b.ca.as_ref()) {
        Some(ca) => {
            let items: Vec<String> = ca
                .carriers
                .iter()
                .filter(|c| c.kind == "SCC")
                .take(SCCS)
                .map(|c| {
                    let mut o = J::obj();
                    o.opt_str("band", c.band.as_deref())
                        .num("earfcn", c.earfcn)
                        .num("pci", c.pci)
                        .opt_num("bw", c.bandwidth_mhz)
                        .boolean("active", c.active);
                    o.done()
                })
                .collect();
            j.raw("ca", &arr(&items))
        }
        None => j.null("ca"),
    };
    j.done()
}

/// What the file's header says besides the ring.
pub struct Head<'a> {
    pub run: u64,
    pub seq: u64,
    pub period_ms: u64,
    pub state: &'a str,
    pub ssr_count: u64,
    pub scan: bool,
}

/// The samples are already rendered; they are appended in place (no copy of
/// the ring, one allocation sized for the whole file).
pub fn render_file(h: &Head, ring: &VecDeque<String>) -> String {
    let mut j = J::obj();
    j.num("v", 1)
        .num("run", h.run)
        .num("seq", h.seq)
        .num("period_ms", h.period_ms)
        .str("qmi_state", h.state)
        .num("ssr_count", h.ssr_count)
        .boolean("scan", h.scan);
    let head = j.done();
    let body: usize = ring.iter().map(|x| x.len() + 1).sum();
    let mut s = String::with_capacity(head.len() + body + 16);
    s.push_str(&head[..head.len() - 1]);
    s.push_str(",\"samples\":[");
    for (i, x) in ring.iter().enumerate() {
        if i > 0 {
            s.push(',');
        }
        s.push_str(x);
    }
    s.push_str("]}\n");
    s
}

/// The live channel's state, owned by the sampler thread.
pub struct Live {
    paths: LivePaths,
    uid: u32,
    run: u64,
    seq: u64,
    ring: VecDeque<String>,
    /// The token the public file is currently published under.
    cur_token: Option<String>,
    /// `cur_token`'s public file path, built once per episode.
    cur_file: String,
    /// The index's path, built once.
    index: String,
    /// A sample is waiting for a token (the CGI writes the stamp first).
    pending: bool,
    last_state: &'static str,
    last_ssr: u64,
    last_scan: bool,
    last_period: Duration,
    write_failed: bool,
    log: std::sync::Arc<Logger>,
    /// The boot clock, re-read under the lock (a seam for tests).
    clock: fn() -> u64,
}

impl Live {
    pub fn new(paths: LivePaths, log: std::sync::Arc<Logger>) -> Live {
        let index = format!("{}/{INDEX}", paths.public_dir);
        Live {
            index,
            paths,
            uid: euid(),
            run: boot_ms(),
            seq: 0,
            ring: VecDeque::with_capacity(RING),
            cur_token: None,
            cur_file: String::new(),
            pending: false,
            last_state: "unavailable",
            last_ssr: 0,
            last_scan: false,
            last_period: IDLE_PERIOD,
            write_failed: false,
            log,
            clock: crate::daemon::qmi_snapshot::boot_secs,
        }
    }

    #[cfg(test)]
    pub fn run_id(&self) -> u64 {
        self.run
    }

    pub fn tier(&self, now_s: u64) -> Tier {
        if stamp_file_fresh(&self.paths.aim, now_s, self.uid) {
            Tier::Aim
        } else if stamp_file_fresh(&self.paths.watch, now_s, self.uid) {
            Tier::Watch
        } else {
            Tier::None
        }
    }

    fn public_file(&self, token: &str) -> String {
        format!("{}/{token}.json", self.paths.public_dir)
    }

    fn scan_up(&self) -> bool {
        std::fs::symlink_metadata(&self.paths.long_flag).is_ok()
    }

    /// Makes the public dir trustworthy and puts the empty index in it.
    /// Runs before every publish; in the steady state it is three lstat
    /// calls (`ensure_own_dir` only chmods a dir whose mode is wrong).
    fn ensure_public(&self) -> io::Result<()> {
        if let Some(d) = &self.paths.run_dir {
            safefs::ensure_own_dir(d, 0o700)?;
        }
        safefs::ensure_own_dir(&self.paths.public_dir, 0o755)?;
        match std::fs::symlink_metadata(&self.index) {
            Ok(m) if m.file_type().is_file() && m.len() == 0 && m.uid() == self.uid => Ok(()),
            _ => safefs::write_atomic(&self.index, b""),
        }
    }

    /// Deletes everything in the public dir except the index and `keep`'s
    /// file. The dir is verified first, so a planted link is never listed.
    pub fn hygiene(&self, keep: Option<&str>) -> io::Result<()> {
        self.ensure_public()?;
        let keep_name = keep.map(|t| format!("{t}.json"));
        for e in std::fs::read_dir(&self.paths.public_dir)? {
            let Ok(e) = e else { continue };
            let name = e.file_name();
            let Some(name) = name.to_str() else {
                remove_any(&e.path().to_string_lossy());
                continue;
            };
            if name == INDEX || Some(name) == keep_name.as_deref() {
                continue;
            }
            remove_any(&format!("{}/{name}", self.paths.public_dir));
        }
        Ok(())
    }

    /// On sampler start: a clean public dir with only the index.
    pub fn start(&mut self) {
        let r = self.hygiene(None);
        self.note(r);
    }

    fn note(&mut self, r: io::Result<()>) {
        match (r, self.write_failed) {
            (Err(e), false) => {
                self.log.warn(&format!("cannot publish the live signal file: {e}"));
                self.write_failed = true;
            }
            (Ok(()), true) => {
                self.log.info("live signal file publishing again");
                self.write_failed = false;
            }
            _ => {}
        }
    }

    fn forget(&mut self) {
        self.ring.clear();
        self.cur_token = None;
        self.pending = false;
    }

    /// After every read. `bundle` is this read's result, None when it failed
    /// (then no sample is pushed; the header still carries the new state).
    pub fn on_sample(&mut self, tier: Tier, state: &'static str, ssr_count: u64, bundle: Option<&Bundle>) {
        if tier == Tier::None {
            return;
        }
        self.last_state = state;
        self.last_ssr = ssr_count;
        self.last_scan = self.scan_up();
        self.last_period = period_for(tier);
        // The token first: a new episode clears the ring before this sample.
        let published = self.sync_token();
        if let Some(b) = bundle {
            self.seq += 1;
            if self.ring.len() >= RING {
                self.ring.pop_front();
            }
            self.ring.push_back(render_sample(self.seq, boot_ms(), Some(b), self.last_scan));
        }
        self.pending = true;
        if published {
            self.write();
        }
    }

    /// Every slice: publishes a sample still waiting for its token, or
    /// expires the lease when no stamp is fresh.
    pub fn tick(&mut self, tier: Tier, now_s: u64) {
        if tier != Tier::None {
            if self.pending && self.sync_token() {
                self.write();
            }
            return;
        }
        let token_file = std::fs::symlink_metadata(&self.paths.token).is_ok();
        if self.cur_token.is_none() && self.ring.is_empty() && !self.pending && !token_file {
            return;
        }
        self.expire(now_s);
    }

    /// Expiry under the CGI's lock. Busy: nothing now, the next slice retries.
    fn expire(&mut self, now_s: u64) {
        if let Some(d) = &self.paths.run_dir {
            if let Err(e) = safefs::ensure_own_dir(d, 0o700) {
                self.note(Err(e));
                return;
            }
        }
        let _held = match try_lock(&self.paths.lock) {
            Ok(Some(f)) => f,
            Ok(None) => return,
            Err(e) => {
                self.note(Err(e));
                return;
            }
        };
        // A renewal may have landed between the check and the lock, stamped
        // with a later second than the slice's `now_s` (which would read as
        // "in the future"): re-check on a fresh reading of the clock.
        let now_s = (self.clock)().max(now_s);
        if self.tier(now_s) != Tier::None {
            return;
        }
        remove_any(&self.paths.token);
        if let Some(t) = self.cur_token.clone() {
            let f = self.public_file(&t);
            remove_any(&format!("{f}.new"));
            remove_any(&f);
        }
        self.forget();
        let r = self.hygiene(None);
        self.note(r);
    }

    /// True when a valid token is current, after following a change: a
    /// revoked token unpublishes at once, a new one (a new episode) clears
    /// the ring and the public dir of the old file.
    fn sync_token(&mut self) -> bool {
        let Some(token) = read_token(&self.paths.token, self.uid) else {
            if self.cur_token.is_some() {
                self.cur_token = None;
                self.ring.clear();
                let r = self.hygiene(None);
                self.note(r);
            }
            return false;
        };
        if self.cur_token.as_deref() != Some(token.as_str()) {
            if self.cur_token.is_some() {
                self.ring.clear();
            }
            if let Err(e) = self.hygiene(Some(&token)) {
                self.note(Err(e));
                return false;
            }
            self.cur_file = self.public_file(&token);
            self.cur_token = Some(token);
        }
        true
    }

    /// Publishes under `cur_token` (only called right after `sync_token`
    /// said one is current).
    fn write(&mut self) {
        let head = Head {
            run: self.run,
            seq: self.seq,
            period_ms: self.last_period.as_millis() as u64,
            state: self.last_state,
            ssr_count: self.last_ssr,
            scan: self.last_scan,
        };
        let body = render_file(&head, &self.ring);
        let r = self.ensure_public().and_then(|_| safefs::write_atomic(&self.cur_file, body.as_bytes()));
        if r.is_ok() {
            self.pending = false;
        }
        self.note(r);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::qmi::codec::testfix::fx;
    use crate::qmi::model::Inputs;
    use std::path::{Path, PathBuf};
    use std::sync::Arc;

    const TOK: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const TOK2: &str = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

    fn dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("qatd-live-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn lpaths(d: &Path) -> LivePaths {
        let p = |n: &str| d.join(n).to_str().unwrap().to_string();
        LivePaths { run_dir: None, aim: p("aim"), watch: p("watch"), token: p("token"), lock: p("lock"), public_dir: p("pub"), long_flag: p("long") }
    }

    fn live(d: &Path) -> Live {
        Live::new(lpaths(d), Arc::new(Logger::new("test")))
    }

    fn now_s() -> u64 {
        crate::daemon::qmi_snapshot::boot_secs()
    }

    fn stamp(d: &Path, tier: &str, v: u64) {
        std::fs::write(d.join(tier), format!("{v}\n")).unwrap();
    }

    fn bundle() -> Bundle {
        Bundle::build(&Inputs {
            serving: Some(&fx!("r1_3_0x0024")),
            cell: Some(&fx!("r1_3_0x0043")),
            ca: Some(&fx!("ca_0x15_two_scells")),
            rf: Some(&fx!("r1_3_0x0031")),
            sig_info: Some(&fx!("r1_3_0x004F")),
        })
    }

    fn names(d: &Path) -> Vec<String> {
        let mut v: Vec<String> = std::fs::read_dir(d.join("pub")).unwrap().map(|e| e.unwrap().file_name().into_string().unwrap()).collect();
        v.sort();
        v
    }

    #[test]
    fn stamp_parsing_is_digits_only_without_leading_zero() {
        assert_eq!(parse_stamp(b"1234\n"), Some(1234));
        assert_eq!(parse_stamp(b"1234"), Some(1234));
        assert_eq!(parse_stamp(b"0"), Some(0));
        assert_eq!(parse_stamp(b"9999999999"), Some(9_999_999_999));
        for bad in [&b""[..], b"\n", b"01234", b"00", b"12a4", b"-12", b"+12", b" 12", b"12 ", b"12\n\n", b"12\r\n", b"12345678901", b"1.5", b"\xff"] {
            assert_eq!(parse_stamp(bad), None, "{:?}", String::from_utf8_lossy(bad));
        }
        // Freshness on the boot clock: future = no lease, > 10 s = no lease.
        assert!(stamp_fresh(100, 100) && stamp_fresh(90, 100));
        assert!(!stamp_fresh(89, 100), "older than 10 s");
        assert!(!stamp_fresh(101, 100), "in the future");
    }

    #[test]
    fn a_stamp_must_be_a_regular_own_file_not_a_link() {
        let d = dir("stampfile");
        let p = d.join("aim");
        let ps = p.to_str().unwrap();
        let (now, me) = (now_s(), euid());
        assert!(!stamp_file_fresh(ps, now, me), "missing");
        stamp(&d, "aim", now);
        assert!(stamp_file_fresh(ps, now, me));
        assert!(!stamp_file_fresh(ps, now, me.wrapping_add(1)), "foreign owner");
        std::fs::write(&p, format!("{}\n", now + 5)).unwrap();
        assert!(!stamp_file_fresh(ps, now, me), "future");
        std::fs::write(&p, format!("{}\n", now.saturating_sub(11))).unwrap();
        assert!(!stamp_file_fresh(ps, now.max(11), me) || now < 11, "stale");
        std::fs::write(&p, b"garbage\n").unwrap();
        assert!(!stamp_file_fresh(ps, now, me), "garbage");
        std::fs::write(&p, format!("0{now}\n")).unwrap();
        assert!(!stamp_file_fresh(ps, now, me), "leading zero");
        // A planted symlink to a perfectly good stamp is still no lease.
        let real = d.join("real");
        std::fs::write(&real, format!("{now}\n")).unwrap();
        std::fs::remove_file(&p).unwrap();
        std::os::unix::fs::symlink(&real, &p).unwrap();
        assert!(!stamp_file_fresh(ps, now, me), "symlink");
        // A directory, and an oversized file.
        std::fs::remove_file(&p).unwrap();
        std::fs::create_dir(&p).unwrap();
        assert!(!stamp_file_fresh(ps, now, me), "dir");
        std::fs::remove_dir(&p).unwrap();
        std::fs::write(&p, format!("{now}\n{}", "9".repeat(64))).unwrap();
        assert!(!stamp_file_fresh(ps, now, me), "oversized");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn tiers_map_to_compiled_periods_and_aim_beats_watch() {
        assert_eq!(period_for(Tier::Aim), Duration::from_millis(1000));
        assert_eq!(period_for(Tier::Watch), Duration::from_millis(1000));
        assert_eq!(period_for(Tier::None), Duration::from_secs(2));
        for t in [Tier::None, Tier::Watch, Tier::Aim] {
            assert!(period_for(t) >= MIN_PERIOD, "1 Hz floor");
        }
        assert_eq!(slice_for(period_for(Tier::Aim)), Duration::from_millis(250));
        assert_eq!(slice_for(period_for(Tier::Watch)), Duration::from_millis(250));
        assert_eq!(slice_for(period_for(Tier::None)), Duration::from_millis(250));

        let d = dir("tier");
        let l = live(&d);
        let now = now_s();
        assert_eq!(l.tier(now), Tier::None);
        stamp(&d, "watch", now);
        assert_eq!(l.tier(now), Tier::Watch);
        stamp(&d, "aim", now);
        assert_eq!(l.tier(now), Tier::Aim, "aim beats watch");
        stamp(&d, "aim", now + 100);
        assert_eq!(l.tier(now), Tier::Watch, "a future aim stamp falls back to watch");
        stamp(&d, "watch", now + 100);
        assert_eq!(l.tier(now), Tier::None);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn token_validation_rejects_anything_but_64_lowercase_hex() {
        assert!(valid_token(TOK));
        for bad in [
            "".to_string(),
            TOK[..63].to_string(),
            format!("{TOK}0"),
            TOK.to_uppercase(),
            format!("../{}", &TOK[3..]),
            format!("{}/x", &TOK[..62]),
            format!("{}.json", &TOK[..59]),
            format!("{}g", &TOK[..63]),
            format!("{} ", &TOK[..63]),
        ] {
            assert!(!valid_token(&bad), "{bad}");
        }
        let d = dir("token");
        let p = d.join("token");
        let ps = p.to_str().unwrap();
        let me = euid();
        assert_eq!(read_token(ps, me), None, "missing");
        std::fs::write(&p, format!("{TOK}\n")).unwrap();
        assert_eq!(read_token(ps, me).as_deref(), Some(TOK));
        std::fs::write(&p, TOK).unwrap();
        assert_eq!(read_token(ps, me).as_deref(), Some(TOK), "no newline is fine");
        assert_eq!(read_token(ps, me.wrapping_add(1)), None, "foreign owner");
        std::fs::write(&p, format!("{TOK}\n\n")).unwrap();
        assert_eq!(read_token(ps, me), None, "extra line");
        std::fs::write(&p, "../../etc/passwd\n").unwrap();
        assert_eq!(read_token(ps, me), None, "a path");
        let real = d.join("real");
        std::fs::write(&real, TOK).unwrap();
        std::fs::remove_file(&p).unwrap();
        std::os::unix::fs::symlink(&real, &p).unwrap();
        assert_eq!(read_token(ps, me), None, "symlink");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn an_invalid_token_publishes_nothing() {
        let d = dir("badtok");
        let mut l = live(&d);
        l.start();
        std::fs::write(d.join("token"), "../evil\n").unwrap();
        l.on_sample(Tier::Aim, "up", 0, Some(&bundle()));
        assert_eq!(names(&d), ["index.html"]);
        assert!(!d.join("evil").exists() && !d.join("evil.json").exists());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn the_sample_carries_signal_x10_identity_and_sccs_but_no_identifiers() {
        let b = bundle();
        let s = render_sample(7, 123456, Some(&b), false);
        assert_eq!(
            s,
            "{\"seq\":7,\"t\":123456,\"reg\":true,\"rsrp\":-900,\"rsrq\":-74,\"rssi\":-628,\"sinr\":264,\"nr_rsrp\":-890,\"nr_rsrq\":-110,\"nr_sinr\":250,\"pci\":295,\"earfcn\":150,\"band\":\"B1\",\"bw\":20,\
             \"ca\":[{\"band\":\"B1\",\"earfcn\":150,\"pci\":295,\"bw\":20,\"active\":false},{\"band\":\"B41\",\"earfcn\":39965,\"pci\":295,\"bw\":15,\"active\":false}]}",
        );
        let mut ring = VecDeque::new();
        ring.push_back(s);
        let f = render_file(&Head { run: 5, seq: 7, period_ms: 200, state: "up", ssr_count: 0, scan: false }, &ring);
        for key in ["cell_id", "\"tac\"", "enodeb", "sector", "mcc", "mnc", "operator", "imsi", "iccid", "imei", "plmn", "\"name\"", "description"] {
            assert!(!f.contains(key), "{key} in {f}");
        }
        // The capture's TAC (4660) and ECI (19088641) values are absent too.
        assert!(!f.contains("4660") && !f.contains("19088641"), "{f}");
        assert!(!f.contains('.'), "no floats: {f}");
        assert!(f.starts_with("{\"v\":1,\"run\":5,\"seq\":7,\"period_ms\":200,\"qmi_state\":\"up\",\"ssr_count\":0,\"scan\":false,\"samples\":[{"), "{f}");
        assert!(f.ends_with("]}\n") && f.matches('\n').count() == 1);
    }

    #[test]
    fn identifier_keys_stay_absent_for_any_input() {
        for base in crate::qmi::codec::testfix::all() {
            for m in crate::qmi::codec::testfix::mangled(&base) {
                let b = Bundle::build(&Inputs { serving: Some(&m), cell: Some(&m), ca: Some(&m), rf: Some(&m), sig_info: Some(&m) });
                let s = render_sample(1, 1, Some(&b), false);
                for key in ["cell_id", "tac", "enodeb", "sector", "mcc", "mnc", "operator", "imsi"] {
                    assert!(!s.contains(key), "{key} in {s}");
                }
                assert!(!s.contains('.') && !s.contains("NaN"), "{s}");
            }
        }
    }

    #[test]
    fn unregistered_nulls_the_signal_and_scan_nulls_every_serving_field() {
        let b = Bundle::build(&Inputs {
            serving: Some(&fx!("serving_searching")),
            cell: Some(&fx!("r1_3_0x0043")),
            ca: None,
            rf: Some(&fx!("r1_3_0x0031")),
            sig_info: Some(&fx!("r1_3_0x004F")),
        });
        let s = render_sample(1, 2, Some(&b), false);
        assert!(s.contains("\"reg\":false,\"rsrp\":null,\"rsrq\":null,\"rssi\":null,\"sinr\":null,\"nr_rsrp\":null,\"nr_rsrq\":null,\"nr_sinr\":null,\"pci\":295"), "{s}");
        assert!(s.ends_with("\"ca\":null}"), "{s}");
        let s = render_sample(3, 4, Some(&bundle()), true);
        assert_eq!(s, "{\"seq\":3,\"t\":4,\"reg\":null,\"rsrp\":null,\"rsrq\":null,\"rssi\":null,\"sinr\":null,\"nr_rsrp\":null,\"nr_rsrq\":null,\"nr_sinr\":null,\"pci\":null,\"earfcn\":null,\"band\":null,\"bw\":null,\"ca\":null}");
    }

    #[test]
    fn a_ca_list_without_sccs_is_an_empty_array_not_null() {
        let mut b = bundle();
        // PCC only: the list is known, it just carries no secondary cells.
        b.ca.as_mut().unwrap().carriers.retain(|c| c.kind != "SCC");
        let s = render_sample(1, 2, Some(&b), false);
        assert!(s.ends_with("\"bw\":20,\"ca\":[]}"), "{s}");
        b.ca.as_mut().unwrap().carriers.clear();
        assert_eq!(render_sample(1, 2, Some(&b), false), s);
    }

    #[test]
    fn the_scan_gate_marks_the_file_and_nulls_new_samples() {
        let d = dir("scan");
        let mut l = live(&d);
        l.start();
        std::fs::write(d.join("token"), TOK).unwrap();
        l.on_sample(Tier::Aim, "up", 0, Some(&bundle()));
        std::fs::write(d.join("long"), b"AT+QSCAN=3,1\n").unwrap();
        l.on_sample(Tier::Aim, "up", 0, Some(&bundle()));
        let f = std::fs::read_to_string(d.join("pub").join(format!("{TOK}.json"))).unwrap();
        assert!(f.contains("\"scan\":true"), "{f}");
        assert!(f.contains("{\"seq\":1,") && f.contains("\"pci\":295"), "the pre-scan sample stays: {f}");
        assert!(f.contains("{\"seq\":2,") && f.contains("\"seq\":2,\"t\":") && f.ends_with("\"pci\":null,\"earfcn\":null,\"band\":null,\"bw\":null,\"ca\":null}]}\n"), "{f}");
        std::fs::remove_file(d.join("long")).unwrap();
        l.on_sample(Tier::Aim, "up", 0, Some(&bundle()));
        let f = std::fs::read_to_string(d.join("pub").join(format!("{TOK}.json"))).unwrap();
        assert!(f.contains("\"scan\":false") && f.ends_with("\"active\":false}]}]}\n"), "{f}");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn the_ring_keeps_thirty_two_seq_grows_and_run_names_the_daemon_start() {
        let d = dir("ring");
        let mut l = live(&d);
        l.start();
        std::fs::write(d.join("token"), TOK).unwrap();
        let b = bundle();
        assert_eq!(RING, 32);
        for _ in 0..40 {
            l.on_sample(Tier::Aim, "up", 0, Some(&b));
        }
        let f = std::fs::read_to_string(d.join("pub").join(format!("{TOK}.json"))).unwrap();
        assert_eq!(f.matches("{\"seq\":").count(), RING, "{f}");
        assert!(f.contains("\"seq\":40,\"period_ms\":1000") && f.contains("{\"seq\":9,") && !f.contains("{\"seq\":8,"), "{f}");
        assert!(f.find("{\"seq\":9,").unwrap() < f.find("{\"seq\":40,").unwrap(), "oldest first: {f}");
        assert!(f.contains(&format!("\"run\":{},", l.run_id())));
        // A failed read pushes nothing; the header carries the new state.
        l.on_sample(Tier::Watch, "down", 1, None);
        let f = std::fs::read_to_string(d.join("pub").join(format!("{TOK}.json"))).unwrap();
        assert!(f.contains("\"seq\":40,\"period_ms\":1000,\"qmi_state\":\"down\",\"ssr_count\":1"), "{f}");
        assert_eq!(f.matches("{\"seq\":").count(), RING);
        // A new token is a new episode: the ring restarts, seq keeps growing.
        std::fs::write(d.join("token"), TOK2).unwrap();
        l.on_sample(Tier::Aim, "up", 1, Some(&b));
        assert_eq!(names(&d), ["fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210.json", "index.html"]);
        let f = std::fs::read_to_string(d.join("pub").join(format!("{TOK2}.json"))).unwrap();
        assert_eq!(f.matches("{\"seq\":").count(), 1);
        assert!(f.contains("{\"seq\":41,"), "{f}");
        // A restarted daemon has a different run.
        std::thread::sleep(Duration::from_millis(3));
        let l2 = live(&d);
        assert_ne!(l2.run_id(), l.run_id());
        // No lease: nothing is pushed or published.
        let mut l3 = live(&d);
        l3.on_sample(Tier::None, "up", 0, Some(&b));
        assert_eq!(l3.seq, 0);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_sample_waiting_for_its_token_publishes_on_the_next_slice() {
        let d = dir("pending");
        let mut l = live(&d);
        l.start();
        let now = now_s();
        stamp(&d, "aim", now);
        l.on_sample(Tier::Aim, "up", 0, Some(&bundle()));
        assert_eq!(names(&d), ["index.html"], "no token yet");
        std::fs::write(d.join("token"), format!("{TOK}\n")).unwrap();
        l.tick(Tier::Aim, now);
        let f = std::fs::read_to_string(d.join("pub").join(format!("{TOK}.json"))).unwrap();
        assert!(f.contains("{\"seq\":1,"), "{f}");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn expiry_deletes_token_and_file_only_under_the_lock() {
        let d = dir("expiry");
        let mut l = live(&d);
        l.start();
        let now = now_s();
        stamp(&d, "aim", now);
        std::fs::write(d.join("token"), TOK).unwrap();
        l.on_sample(Tier::Aim, "up", 0, Some(&bundle()));
        let pubf = d.join("pub").join(format!("{TOK}.json"));
        assert!(pubf.exists());
        std::fs::write(d.join("pub").join(format!("{TOK}.json.new")), b"x").unwrap();
        // Still fresh: a tick changes nothing.
        l.tick(Tier::Aim, now);
        assert!(pubf.exists());
        // The CGI holds the lock: the broker waits for a later slice.
        std::fs::remove_file(d.join("aim")).unwrap();
        let held = try_lock(d.join("lock").to_str().unwrap()).unwrap().unwrap();
        l.tick(Tier::None, now);
        assert!(pubf.exists() && d.join("token").exists(), "nothing deleted while the lock is held");
        // A renewal lands under the CGI's lock: the re-check sees it.
        stamp(&d, "watch", now);
        drop(held);
        l.tick(Tier::None, now);
        assert!(pubf.exists() && d.join("token").exists(), "re-checked under the lock");
        // Expired for real.
        std::fs::remove_file(d.join("watch")).unwrap();
        l.tick(Tier::None, now);
        assert!(!d.join("token").exists());
        assert_eq!(names(&d), ["index.html"]);
        assert!(l.ring.is_empty() && l.cur_token.is_none());
        // Idle afterwards: nothing to do, no lock taken.
        let held = try_lock(d.join("lock").to_str().unwrap()).unwrap().unwrap();
        l.tick(Tier::None, now);
        drop(held);
        // A stale token left by a previous run (no stamp) is expired too.
        std::fs::write(d.join("token"), TOK2).unwrap();
        l.tick(Tier::None, now);
        assert!(!d.join("token").exists());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_renewal_stamped_after_the_slice_second_still_holds_the_lease() {
        let d = dir("renew-next-sec");
        let mut l = live(&d);
        l.start();
        let now = now_s();
        std::fs::write(d.join("token"), TOK).unwrap();
        stamp(&d, "aim", now);
        l.on_sample(Tier::Aim, "up", 0, Some(&bundle()));
        let pubf = d.join("pub").join(format!("{TOK}.json"));
        assert!(pubf.exists());
        // The slice read `now`; the CGI renews in the next second before
        // the broker takes the lock. The re-check must use the clock as it
        // reads under the lock, not the slice's `now`.
        std::fs::remove_file(d.join("aim")).unwrap();
        stamp(&d, "watch", now + 1);
        fn next_second() -> u64 {
            crate::daemon::qmi_snapshot::boot_secs() + 1
        }
        l.clock = next_second;
        l.tick(Tier::None, now);
        assert!(pubf.exists() && d.join("token").exists(), "the fresh lease survives");
        assert_eq!(l.cur_token.as_deref(), Some(TOK));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_revoked_token_unpublishes_at_once() {
        let d = dir("revoke");
        let mut l = live(&d);
        l.start();
        std::fs::write(d.join("token"), TOK).unwrap();
        l.on_sample(Tier::Aim, "up", 0, Some(&bundle()));
        assert_eq!(names(&d).len(), 2);
        std::fs::remove_file(d.join("token")).unwrap();
        l.on_sample(Tier::Aim, "up", 0, Some(&bundle()));
        assert_eq!(names(&d), ["index.html"]);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn hygiene_keeps_only_the_index_and_the_current_file() {
        use std::os::unix::fs::PermissionsExt;
        let d = dir("hyg");
        let pubd = d.join("pub");
        std::fs::create_dir_all(pubd.join("sub/deeper")).unwrap();
        std::fs::write(pubd.join("index.html"), b"<html>listing bait</html>").unwrap();
        std::fs::write(pubd.join(format!("{TOK2}.json")), b"old").unwrap();
        std::fs::write(pubd.join("stray.txt"), b"x").unwrap();
        let victim = d.join("victim");
        std::fs::write(&victim, b"keep").unwrap();
        std::os::unix::fs::symlink(&victim, pubd.join("link")).unwrap();
        let mut l = live(&d);
        l.start();
        assert_eq!(names(&d), ["index.html"]);
        assert_eq!(std::fs::read(pubd.join("index.html")).unwrap(), b"", "the index is emptied");
        assert_eq!(std::fs::read(&victim).unwrap(), b"keep", "a link is removed, never followed");
        assert_eq!(std::fs::metadata(&pubd).unwrap().permissions().mode() & 0o777, 0o755);
        // On publish, the current file is kept and the index stays empty.
        std::fs::write(d.join("token"), TOK).unwrap();
        l.on_sample(Tier::Watch, "up", 0, Some(&bundle()));
        std::fs::write(pubd.join("stray2"), b"x").unwrap();
        l.hygiene(Some(TOK)).unwrap();
        assert_eq!(names(&d), [format!("{TOK}.json"), "index.html".to_string()]);
        // A link planted where the dir should be is replaced, its target untouched.
        let other = d.join("other");
        std::fs::create_dir(&other).unwrap();
        std::fs::write(other.join("precious"), b"p").unwrap();
        std::fs::remove_dir_all(&pubd).unwrap();
        std::os::unix::fs::symlink(&other, &pubd).unwrap();
        l.on_sample(Tier::Watch, "up", 0, Some(&bundle()));
        assert!(std::fs::symlink_metadata(&pubd).unwrap().is_dir());
        assert!(other.join("precious").exists(), "never listed through the link");
        assert!(pubd.join("index.html").exists() && pubd.join(format!("{TOK}.json")).exists());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn production_paths_are_the_planned_ones() {
        let p = LivePaths::production();
        assert_eq!(p.aim, "/var/run/qmanager/qmi_live_aim");
        assert_eq!(p.watch, "/var/run/qmanager/qmi_live_watch");
        assert_eq!(p.token, "/var/run/qmanager/qmi_live.token");
        assert_eq!(p.lock, "/var/run/qmanager/qmi_live.lock");
        assert_eq!(p.public_dir, "/var/run/qmanager/live");
        assert_eq!(p.run_dir.as_deref(), Some("/var/run/qmanager"));
        assert!(p.public_dir.starts_with(&format!("{RUN_DIR}/")), "never directly in /tmp");
        assert_eq!(p.long_flag, "/tmp/qmanager_long_running");
    }
}
