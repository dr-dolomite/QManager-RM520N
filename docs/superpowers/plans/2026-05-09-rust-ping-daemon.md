# Rust Ping Daemon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the POSIX shell `qmanager_ping` daemon with a static ARMv7 Rust binary featuring HTTP keep-alive, tri-state connectivity detection (connected / limited / disconnected), and profile-driven probe cadence.

**Architecture:** Single-crate Rust project at `ping-daemon/`, cross-compiled to `armv7-unknown-linux-musleabihf` via WSL2 (same toolchain used for `atcli_smd11`). Sync, single-threaded, blocking I/O. Lean dependencies: `serde`, `serde_json`, `libc`, `signal-hook`. Hand-rolled HTTP/1.1 over `std::net::TcpStream` for keep-alive across probe cycles. Drop-in replacement at `/usr/bin/qmanager_ping` via existing systemd unit.

**Tech Stack:** Rust 1.70+, cargo, `armv7-unknown-linux-musleabihf` target, WSL2, serde + serde_json, libc, signal-hook, std::net::TcpStream.

**Spec:** `docs/superpowers/specs/2026-05-09-rust-ping-daemon-design.md`

---

## File Structure

### Files created (Rust crate)

```
ping-daemon/
├── Cargo.toml                                  # Crate manifest, deps, release profile
├── .gitignore                                  # Ignore target/
├── build-ping-daemon.sh                        # Cross-compile + strip + install to scripts/usr/bin/
├── README.md                                   # Build/test/release docs
└── src/
    ├── main.rs                                 # Loop, signal handling, error fan-in
    ├── config.rs                               # ProfileConfig load (JSON + env), thresholds
    ├── carrier.rs                              # Sysfs carrier read
    ├── probe.rs                                # KeepAliveClient, ProbeOutcome enum
    ├── state.rs                                # Tri-state streak machine
    ├── history.rs                              # Ring buffer, flat-file write
    ├── cache.rs                                # Atomic JSON cache write
    ├── reload.rs                               # Reload flag watcher
    ├── pid.rs                                  # Singleton PID guard
    └── qlog.rs                                 # File-append logging
```

### Files created (deployment / test)

```
scripts/test/qmanager-ping-smoke.sh             # NEW: on-device smoke harness
```

### Files modified

```
scripts/usr/bin/qmanager_ping                   # REPLACED by built binary
scripts/etc/systemd/system/qmanager-ping.service # MODIFIED: env var name changes
scripts/usr/bin/qmanager_watchcat               # MODIFIED: tri-state read + state machine skip
install.sh                                      # MODIFIED: profile.json bootstrap + env migration
```

### Files deleted

```
scripts/test/qmanager-ping-probe.sh             # No longer applicable (was a shell extractor)
```

### Files NOT modified (verification)

- `scripts/usr/bin/qmanager_poller` — `read_ping_data` reads only backwards-compat fields. Verify in Task 17.
- `scripts/www/cgi-bin/quecmanager/at_cmd/fetch_ping_history.sh` — reads poller's NDJSON, not the daemon's flat-file history. No change needed.

### Module responsibilities

| Module | Owns | Reads from disk | Writes to disk |
|---|---|---|---|
| `config` | `ProfileConfig` struct, threshold computation | `/etc/qmanager/ping_profile.json`, env vars | none |
| `carrier` | One function: `is_up() -> bool` | `/sys/class/net/.../carrier` | none |
| `probe` | `KeepAliveClient`, `ProbeOutcome`, `DownReason` | none | none (network only) |
| `state` | `Connectivity`, `StreakState`, transition logic | none | none (in-memory) |
| `history` | `History` struct (`VecDeque<Option<f32>>`) | none | `/tmp/qmanager_ping_history` |
| `cache` | `CacheWriter`, the 18-field JSON shape | `/tmp/qmanager_recovery_active` (existence) | `/tmp/qmanager_ping.json` |
| `reload` | `ReloadWatcher` | `/tmp/qmanager_ping_reload` | unlinks the flag |
| `pid` | `PidGuard` (RAII) | `/tmp/qmanager_ping.pid` | `/tmp/qmanager_ping.pid` |
| `qlog` | `Logger`, `qlog_*` macros | none | `/tmp/qmanager.log` |
| `main` | Loop, `signal-hook` channel, fan-in | calls all of the above | calls all of the above |

---

## Task 1: Initialize Rust crate scaffolding

**Files:**
- Create: `ping-daemon/Cargo.toml`
- Create: `ping-daemon/.gitignore`
- Create: `ping-daemon/src/main.rs` (placeholder — exits 0)

- [ ] **Step 1: Create the crate directory and Cargo.toml**

Create `ping-daemon/Cargo.toml`:

```toml
[package]
name = "qmanager-ping"
version = "0.1.0"
edition = "2021"
description = "QManager unified ping daemon — HTTP/204 connectivity probe with keep-alive"
license = "MIT OR Apache-2.0"
publish = false

[[bin]]
name = "qmanager_ping"
path = "src/main.rs"

[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
libc = "0.2"
signal-hook = "0.3"

[profile.release]
opt-level = "z"
lto = true
codegen-units = 1
panic = "abort"
strip = "symbols"
```

- [ ] **Step 2: Create the .gitignore**

Create `ping-daemon/.gitignore`:

```
target/
Cargo.lock
```

(`Cargo.lock` is gitignored because this is a binary built only by the build script — no library consumers depend on a pinned lockfile, and binary lockfiles in this repo follow the same convention as `discord-bot/`.)

- [ ] **Step 3: Create placeholder main.rs**

Create `ping-daemon/src/main.rs`:

```rust
fn main() {
    eprintln!("qmanager-ping placeholder — not yet implemented");
    std::process::exit(0);
}
```

- [ ] **Step 4: Verify the crate builds (host target)**

Run from WSL2 (or any Linux host):

```bash
cd ping-daemon && cargo build --release
```

Expected: clean compile, produces `target/release/qmanager_ping`.

- [ ] **Step 5: Verify ARMv7 cross-target is available**

Run:

```bash
rustup target add armv7-unknown-linux-musleabihf
cd ping-daemon && cargo build --release --target=armv7-unknown-linux-musleabihf
```

Expected: clean compile, produces `target/armv7-unknown-linux-musleabihf/release/qmanager_ping`. If the linker fails (missing `arm-linux-musleabihf-gcc`), follow the same WSL2 setup used for `atcli_smd11` — typically `apt install gcc-arm-linux-gnueabihf` plus a `.cargo/config.toml` linker override (added in a later task).

- [ ] **Step 6: Commit**

```bash
git add ping-daemon/Cargo.toml ping-daemon/.gitignore ping-daemon/src/main.rs
git commit -m "feat(ping-daemon): scaffold Rust crate for qmanager_ping rewrite"
```

---

## Task 2: Cross-compile linker config

**Files:**
- Create: `ping-daemon/.cargo/config.toml`

- [ ] **Step 1: Create the cargo config**

Create `ping-daemon/.cargo/config.toml`:

```toml
[target.armv7-unknown-linux-musleabihf]
linker = "arm-linux-gnueabihf-gcc"

[target.armv7-unknown-linux-musleabihf.qmanager-ping]
rustflags = ["-C", "target-feature=+crt-static"]
```

The `+crt-static` flag ensures a fully static binary that runs on the device's musl-only environment without glibc.

- [ ] **Step 2: Verify static linking**

Run:

```bash
cd ping-daemon && cargo build --release --target=armv7-unknown-linux-musleabihf
file target/armv7-unknown-linux-musleabihf/release/qmanager_ping
```

Expected output contains `statically linked` and `ARM, EABI5`.

- [ ] **Step 3: Commit**

```bash
git add ping-daemon/.cargo/config.toml
git commit -m "build(ping-daemon): pin ARMv7 musl linker + static CRT"
```

---

## Task 3: `qlog` module — file-append logger

**Files:**
- Create: `ping-daemon/src/qlog.rs`
- Modify: `ping-daemon/src/main.rs` (add `mod qlog;`)

- [ ] **Step 1: Write failing unit test**

Create `ping-daemon/src/qlog.rs`:

```rust
use std::fs::OpenOptions;
use std::io::Write;
use std::path::Path;
use std::sync::Mutex;

pub struct Logger {
    file: Mutex<Option<std::fs::File>>,
    component: String,
}

impl Logger {
    pub fn new(component: &str, log_path: &Path) -> Self {
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(log_path)
            .ok();
        Logger {
            file: Mutex::new(file),
            component: component.to_string(),
        }
    }

    fn write_line(&self, level: &str, msg: &str) {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let line = format!("[{}] [{}] [{}] {}\n", ts, self.component, level, msg);
        if let Ok(mut guard) = self.file.lock() {
            if let Some(f) = guard.as_mut() {
                let _ = f.write_all(line.as_bytes());
            }
        }
    }

    pub fn info(&self, msg: &str) { self.write_line("INFO", msg); }
    pub fn warn(&self, msg: &str) { self.write_line("WARN", msg); }
    pub fn error(&self, msg: &str) { self.write_line("ERROR", msg); }
    pub fn debug(&self, msg: &str) { self.write_line("DEBUG", msg); }
    pub fn state_change(&self, field: &str, old: &str, new: &str) {
        self.write_line("STATE", &format!("{}: {} -> {}", field, old, new));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::read_to_string;

    #[test]
    fn writes_log_line_with_component_and_level() {
        let dir = tempdir_unique();
        let path = dir.join("test.log");
        let log = Logger::new("ping", &path);
        log.info("hello");
        let content = read_to_string(&path).unwrap();
        assert!(content.contains("[ping]"), "got: {}", content);
        assert!(content.contains("[INFO]"), "got: {}", content);
        assert!(content.contains("hello"), "got: {}", content);
    }

    #[test]
    fn state_change_formats_arrow() {
        let dir = tempdir_unique();
        let path = dir.join("state.log");
        let log = Logger::new("ping", &path);
        log.state_change("reachable", "false", "true");
        let content = read_to_string(&path).unwrap();
        assert!(content.contains("reachable: false -> true"), "got: {}", content);
    }

    fn tempdir_unique() -> std::path::PathBuf {
        let pid = std::process::id();
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let p = std::env::temp_dir().join(format!("qping-test-{}-{}", pid, nanos));
        std::fs::create_dir_all(&p).unwrap();
        p
    }
}
```

Modify `ping-daemon/src/main.rs`:

```rust
mod qlog;

fn main() {
    eprintln!("qmanager-ping placeholder — not yet implemented");
    std::process::exit(0);
}
```

- [ ] **Step 2: Run tests — verify they pass**

```bash
cd ping-daemon && cargo test qlog
```

Expected: 2 tests pass.

- [ ] **Step 3: Commit**

```bash
git add ping-daemon/src/qlog.rs ping-daemon/src/main.rs
git commit -m "feat(ping-daemon): qlog module with file-append logging"
```

---

## Task 4: `config` module — ProfileConfig + resolution

**Files:**
- Create: `ping-daemon/src/config.rs`
- Modify: `ping-daemon/src/main.rs` (add `mod config;`)

- [ ] **Step 1: Write failing unit tests**

Create `ping-daemon/src/config.rs`:

```rust
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProfileConfig {
    pub profile: String,
    pub interval_sec: u64,
    pub fail_secs: u64,
    pub recover_secs: u64,
    pub intercept_secs: u64,
    pub history_secs: u64,
    pub target_1: String,
    pub target_2: String,
    pub carrier_file: PathBuf,
}

impl ProfileConfig {
    pub fn relaxed() -> Self {
        Self {
            profile: "relaxed".into(),
            interval_sec: 5,
            fail_secs: 15,
            recover_secs: 10,
            intercept_secs: 8,
            history_secs: 300,
            target_1: "http://www.gstatic.com/generate_204".into(),
            target_2: "http://cp.cloudflare.com/".into(),
            carrier_file: PathBuf::from("/sys/class/net/rmnet_data0/carrier"),
        }
    }

    pub fn for_profile(name: &str) -> Self {
        let mut cfg = Self::relaxed();
        match name {
            "sensitive" => {
                cfg.profile = "sensitive".into();
                cfg.interval_sec = 1;
                cfg.fail_secs = 6;
                cfg.recover_secs = 3;
                cfg.intercept_secs = 8;
                cfg.history_secs = 300;
            }
            "regular" => {
                cfg.profile = "regular".into();
                cfg.interval_sec = 2;
                cfg.fail_secs = 10;
                cfg.recover_secs = 6;
                cfg.intercept_secs = 8;
                cfg.history_secs = 300;
            }
            "relaxed" => {} // already set
            "quiet" => {
                cfg.profile = "quiet".into();
                cfg.interval_sec = 10;
                cfg.fail_secs = 30;
                cfg.recover_secs = 20;
                cfg.intercept_secs = 8;
                cfg.history_secs = 600;
            }
            _ => {} // unknown name — fall through with relaxed defaults
        }
        cfg
    }

    /// Compute fail-threshold cycle count from time-based fail_secs.
    pub fn fail_threshold_cycles(&self) -> u32 {
        max1(div_ceil(self.fail_secs, self.interval_sec))
    }

    pub fn recover_threshold_cycles(&self) -> u32 {
        max1(div_ceil(self.recover_secs, self.interval_sec))
    }

    pub fn intercept_threshold_cycles(&self) -> u32 {
        max1(div_ceil(self.intercept_secs, self.interval_sec))
    }

    pub fn history_size(&self) -> usize {
        let n = div_ceil(self.history_secs, self.interval_sec);
        n.max(1) as usize
    }
}

#[derive(Debug, Deserialize)]
struct ProfileJson {
    profile: Option<String>,
    interval_sec: Option<u64>,
    fail_secs: Option<u64>,
    recover_secs: Option<u64>,
    intercept_secs: Option<u64>,
    history_secs: Option<u64>,
}

/// Resolution order: env vars > JSON > hardcoded defaults.
/// If any time-based env var is set, profile is reported as "custom".
pub fn load(json_path: &Path) -> ProfileConfig {
    let json: Option<ProfileJson> = std::fs::read_to_string(json_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok());

    let profile_name = std::env::var("PING_PROFILE")
        .ok()
        .or_else(|| json.as_ref().and_then(|j| j.profile.clone()))
        .unwrap_or_else(|| "relaxed".into());

    let mut cfg = ProfileConfig::for_profile(&profile_name);

    if let Some(j) = json.as_ref() {
        if let Some(v) = j.interval_sec { cfg.interval_sec = v; }
        if let Some(v) = j.fail_secs { cfg.fail_secs = v; }
        if let Some(v) = j.recover_secs { cfg.recover_secs = v; }
        if let Some(v) = j.intercept_secs { cfg.intercept_secs = v; }
        if let Some(v) = j.history_secs { cfg.history_secs = v; }
    }

    let mut env_override = false;
    if let Ok(v) = std::env::var("PING_INTERVAL") {
        if let Ok(n) = v.parse() { cfg.interval_sec = n; env_override = true; }
    }
    if let Ok(v) = std::env::var("FAIL_SECS") {
        if let Ok(n) = v.parse() { cfg.fail_secs = n; env_override = true; }
    }
    if let Ok(v) = std::env::var("RECOVER_SECS") {
        if let Ok(n) = v.parse() { cfg.recover_secs = n; env_override = true; }
    }
    if let Ok(v) = std::env::var("INTERCEPT_SECS") {
        if let Ok(n) = v.parse() { cfg.intercept_secs = n; env_override = true; }
    }
    if let Ok(v) = std::env::var("HISTORY_SECS") {
        if let Ok(n) = v.parse() { cfg.history_secs = n; env_override = true; }
    }
    if let Ok(v) = std::env::var("PING_TARGET_1") { cfg.target_1 = v; }
    if let Ok(v) = std::env::var("PING_TARGET_2") { cfg.target_2 = v; }
    if let Ok(v) = std::env::var("CARRIER_FILE") { cfg.carrier_file = PathBuf::from(v); }

    if env_override {
        cfg.profile = "custom".into();
    }

    if cfg.interval_sec == 0 { cfg.interval_sec = 1; }

    cfg
}

fn div_ceil(a: u64, b: u64) -> u64 {
    if b == 0 { return a; }
    (a + b - 1) / b
}

fn max1(n: u64) -> u32 {
    n.max(1) as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_match_relaxed_when_no_json_no_env() {
        clear_env();
        let cfg = load(Path::new("/nonexistent/no_such_file.json"));
        assert_eq!(cfg.profile, "relaxed");
        assert_eq!(cfg.interval_sec, 5);
        assert_eq!(cfg.fail_secs, 15);
        assert_eq!(cfg.recover_secs, 10);
        assert_eq!(cfg.intercept_secs, 8);
    }

    #[test]
    fn json_profile_overrides_default() {
        clear_env();
        let p = write_temp_json(r#"{"profile":"regular"}"#);
        let cfg = load(&p);
        assert_eq!(cfg.profile, "regular");
        assert_eq!(cfg.interval_sec, 2);
        assert_eq!(cfg.fail_secs, 10);
    }

    #[test]
    fn json_field_overrides_profile_default() {
        clear_env();
        let p = write_temp_json(r#"{"profile":"regular","fail_secs":99}"#);
        let cfg = load(&p);
        assert_eq!(cfg.fail_secs, 99);
    }

    #[test]
    fn env_overrides_json_and_marks_custom() {
        clear_env();
        let p = write_temp_json(r#"{"profile":"regular","fail_secs":99}"#);
        std::env::set_var("FAIL_SECS", "42");
        let cfg = load(&p);
        assert_eq!(cfg.fail_secs, 42);
        assert_eq!(cfg.profile, "custom");
        std::env::remove_var("FAIL_SECS");
    }

    #[test]
    fn malformed_json_falls_back_to_defaults() {
        clear_env();
        let p = write_temp_json("{ this is not valid json }");
        let cfg = load(&p);
        assert_eq!(cfg.profile, "relaxed");
        assert_eq!(cfg.interval_sec, 5);
    }

    #[test]
    fn threshold_cycles_round_up() {
        let mut cfg = ProfileConfig::for_profile("relaxed");
        cfg.intercept_secs = 8;
        cfg.interval_sec = 5;
        // ceil(8/5) == 2
        assert_eq!(cfg.intercept_threshold_cycles(), 2);
    }

    #[test]
    fn threshold_cycles_at_least_one() {
        let mut cfg = ProfileConfig::for_profile("relaxed");
        cfg.fail_secs = 0;
        cfg.interval_sec = 10;
        assert_eq!(cfg.fail_threshold_cycles(), 1);
    }

    #[test]
    fn history_size_scales_with_interval() {
        let mut cfg = ProfileConfig::for_profile("regular");
        cfg.history_secs = 300;
        cfg.interval_sec = 2;
        assert_eq!(cfg.history_size(), 150);
    }

    #[test]
    fn quiet_profile_intercept_one_cycle() {
        let cfg = ProfileConfig::for_profile("quiet");
        assert_eq!(cfg.interval_sec, 10);
        assert_eq!(cfg.intercept_secs, 8);
        assert_eq!(cfg.intercept_threshold_cycles(), 1);
    }

    fn clear_env() {
        for k in &["PING_PROFILE","PING_INTERVAL","FAIL_SECS","RECOVER_SECS",
                   "INTERCEPT_SECS","HISTORY_SECS","PING_TARGET_1","PING_TARGET_2",
                   "CARRIER_FILE"] {
            std::env::remove_var(k);
        }
    }

    fn write_temp_json(body: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let p = std::env::temp_dir().join(format!("qping-cfg-{}-{}.json", std::process::id(), nanos));
        std::fs::write(&p, body).unwrap();
        p
    }
}
```

Modify `ping-daemon/src/main.rs`:

```rust
mod config;
mod qlog;

fn main() {
    eprintln!("qmanager-ping placeholder — not yet implemented");
    std::process::exit(0);
}
```

- [ ] **Step 2: Run tests — verify they pass**

```bash
cd ping-daemon && cargo test config -- --test-threads=1
```

Use `--test-threads=1` because tests mutate process-global env vars. Expected: 9 tests pass.

- [ ] **Step 3: Commit**

```bash
git add ping-daemon/src/config.rs ping-daemon/src/main.rs
git commit -m "feat(ping-daemon): config module with profile presets + env override"
```

---

## Task 5: `carrier` module — sysfs reachability gate

**Files:**
- Create: `ping-daemon/src/carrier.rs`
- Modify: `ping-daemon/src/main.rs` (add `mod carrier;`)

- [ ] **Step 1: Write failing unit tests**

Create `ping-daemon/src/carrier.rs`:

```rust
use std::path::Path;

/// Returns true if the carrier sysfs file contains exactly "1" (trimmed).
/// Returns false if file is missing, unreadable, or contains anything else.
/// Cheap: one syscall, no fork.
pub fn is_up(path: &Path) -> bool {
    match std::fs::read_to_string(path) {
        Ok(s) => s.trim() == "1",
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn returns_true_for_one() {
        let p = write_temp("1\n");
        assert!(is_up(&p));
    }

    #[test]
    fn returns_true_for_one_no_newline() {
        let p = write_temp("1");
        assert!(is_up(&p));
    }

    #[test]
    fn returns_false_for_zero() {
        let p = write_temp("0\n");
        assert!(!is_up(&p));
    }

    #[test]
    fn returns_false_for_missing_file() {
        let p = PathBuf::from("/nonexistent/carrier_does_not_exist");
        assert!(!is_up(&p));
    }

    #[test]
    fn returns_false_for_garbage() {
        let p = write_temp("hello world\n");
        assert!(!is_up(&p));
    }

    fn write_temp(body: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let p = std::env::temp_dir().join(format!("qping-carrier-{}-{}", std::process::id(), nanos));
        std::fs::write(&p, body).unwrap();
        p
    }
}
```

Modify `ping-daemon/src/main.rs`:

```rust
mod carrier;
mod config;
mod qlog;

fn main() {
    eprintln!("qmanager-ping placeholder — not yet implemented");
    std::process::exit(0);
}
```

- [ ] **Step 2: Run tests — verify they pass**

```bash
cd ping-daemon && cargo test carrier
```

Expected: 5 tests pass.

- [ ] **Step 3: Commit**

```bash
git add ping-daemon/src/carrier.rs ping-daemon/src/main.rs
git commit -m "feat(ping-daemon): carrier module reads sysfs link state"
```

---

## Task 6: `state` module — tri-state streak machine

**Files:**
- Create: `ping-daemon/src/state.rs`
- Modify: `ping-daemon/src/main.rs` (add `mod state;`)

- [ ] **Step 1: Write the state machine and unit tests**

Create `ping-daemon/src/state.rs`:

```rust
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Connectivity {
    Connected,
    Limited,
    Disconnected,
}

#[derive(Debug, Clone)]
pub struct Thresholds {
    pub fail: u32,
    pub recover: u32,
    pub intercept: u32,
}

#[derive(Debug, Clone)]
pub struct StreakState {
    pub connectivity: Connectivity,
    pub streak_success: u32,
    pub streak_limited: u32,
    pub streak_fail: u32,
}

impl StreakState {
    pub fn new() -> Self {
        Self {
            connectivity: Connectivity::Connected,
            streak_success: 0,
            streak_limited: 0,
            streak_fail: 0,
        }
    }
}

/// What kind of probe outcome happened. Numeric details (rtt, http code) are
/// orthogonal to the state machine — passed in separately by main.rs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutcomeKind {
    Connected,
    Limited,
    Disconnected,
}

/// Optional state change for logging.
#[derive(Debug, Clone)]
pub struct StateChange {
    pub from: Connectivity,
    pub to: Connectivity,
}

/// Apply one probe outcome. Returns Some(StateChange) if connectivity flipped.
pub fn tick(s: &mut StreakState, outcome: OutcomeKind, t: &Thresholds) -> Option<StateChange> {
    match outcome {
        OutcomeKind::Connected => {
            s.streak_success = s.streak_success.saturating_add(1);
            s.streak_limited = 0;
            s.streak_fail = 0;
        }
        OutcomeKind::Limited => {
            s.streak_success = 0;
            s.streak_limited = s.streak_limited.saturating_add(1);
            s.streak_fail = 0;
        }
        OutcomeKind::Disconnected => {
            s.streak_success = 0;
            s.streak_limited = 0;
            s.streak_fail = s.streak_fail.saturating_add(1);
        }
    }

    let prev = s.connectivity;
    let next = match s.connectivity {
        Connectivity::Connected => {
            if s.streak_fail >= t.fail {
                Connectivity::Disconnected
            } else if s.streak_limited >= t.intercept {
                Connectivity::Limited
            } else {
                prev
            }
        }
        Connectivity::Limited => {
            if s.streak_success >= t.recover {
                Connectivity::Connected
            } else if s.streak_fail >= t.fail {
                Connectivity::Disconnected
            } else {
                prev
            }
        }
        Connectivity::Disconnected => {
            if s.streak_success >= t.recover {
                Connectivity::Connected
            } else if s.streak_limited >= t.intercept {
                Connectivity::Limited
            } else {
                prev
            }
        }
    };

    if next != prev {
        s.connectivity = next;
        Some(StateChange { from: prev, to: next })
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t() -> Thresholds {
        // Realistic regular-profile thresholds:
        // fail_secs=10, recover_secs=6, intercept_secs=8 at interval_sec=2
        Thresholds { fail: 5, recover: 3, intercept: 4 }
    }

    #[test]
    fn cold_start_is_connected_by_design() {
        let s = StreakState::new();
        assert_eq!(s.connectivity, Connectivity::Connected);
    }

    #[test]
    fn fail_threshold_must_be_consecutive() {
        let mut s = StreakState::new();
        let th = t();
        // 4 fails — not enough
        for _ in 0..4 {
            tick(&mut s, OutcomeKind::Disconnected, &th);
        }
        assert_eq!(s.connectivity, Connectivity::Connected);
        // 5th fail — flip
        let chg = tick(&mut s, OutcomeKind::Disconnected, &th);
        assert!(chg.is_some());
        assert_eq!(s.connectivity, Connectivity::Disconnected);
    }

    #[test]
    fn one_success_resets_fail_streak() {
        let mut s = StreakState::new();
        let th = t();
        for _ in 0..4 { tick(&mut s, OutcomeKind::Disconnected, &th); }
        tick(&mut s, OutcomeKind::Connected, &th);
        assert_eq!(s.streak_fail, 0);
        assert_eq!(s.streak_success, 1);
        assert_eq!(s.connectivity, Connectivity::Connected);
    }

    #[test]
    fn limited_resets_fail_streak_and_success_streak() {
        let mut s = StreakState::new();
        let th = t();
        tick(&mut s, OutcomeKind::Disconnected, &th);
        tick(&mut s, OutcomeKind::Disconnected, &th);
        tick(&mut s, OutcomeKind::Limited, &th);
        assert_eq!(s.streak_fail, 0);
        assert_eq!(s.streak_success, 0);
        assert_eq!(s.streak_limited, 1);
    }

    #[test]
    fn intercept_threshold_flips_to_limited() {
        let mut s = StreakState::new();
        let th = t();
        for _ in 0..3 { tick(&mut s, OutcomeKind::Limited, &th); }
        assert_eq!(s.connectivity, Connectivity::Connected);
        let chg = tick(&mut s, OutcomeKind::Limited, &th);
        assert!(chg.is_some());
        assert_eq!(chg.unwrap().to, Connectivity::Limited);
    }

    #[test]
    fn limited_to_connected_via_recover_threshold() {
        let mut s = StreakState::new();
        let th = t();
        for _ in 0..4 { tick(&mut s, OutcomeKind::Limited, &th); }
        assert_eq!(s.connectivity, Connectivity::Limited);
        for _ in 0..2 { tick(&mut s, OutcomeKind::Connected, &th); }
        assert_eq!(s.connectivity, Connectivity::Limited);
        let chg = tick(&mut s, OutcomeKind::Connected, &th);
        assert_eq!(chg.unwrap().to, Connectivity::Connected);
    }

    #[test]
    fn disconnected_to_limited_when_carrier_intercepts_after_outage() {
        let mut s = StreakState::new();
        let th = t();
        for _ in 0..5 { tick(&mut s, OutcomeKind::Disconnected, &th); }
        assert_eq!(s.connectivity, Connectivity::Disconnected);
        for _ in 0..4 { tick(&mut s, OutcomeKind::Limited, &th); }
        assert_eq!(s.connectivity, Connectivity::Limited);
    }

    #[test]
    fn limited_to_disconnected_on_link_drop() {
        let mut s = StreakState::new();
        let th = t();
        for _ in 0..4 { tick(&mut s, OutcomeKind::Limited, &th); }
        assert_eq!(s.connectivity, Connectivity::Limited);
        for _ in 0..5 { tick(&mut s, OutcomeKind::Disconnected, &th); }
        assert_eq!(s.connectivity, Connectivity::Disconnected);
    }

    #[test]
    fn no_state_change_returns_none() {
        let mut s = StreakState::new();
        let th = t();
        let chg = tick(&mut s, OutcomeKind::Connected, &th);
        assert!(chg.is_none());
    }

    #[test]
    fn streak_counters_saturate_not_overflow() {
        let mut s = StreakState::new();
        s.streak_success = u32::MAX - 1;
        let th = t();
        tick(&mut s, OutcomeKind::Connected, &th);
        tick(&mut s, OutcomeKind::Connected, &th);
        // Did not panic on overflow
        assert_eq!(s.streak_success, u32::MAX);
    }
}
```

Modify `ping-daemon/src/main.rs`:

```rust
mod carrier;
mod config;
mod qlog;
mod state;

fn main() {
    eprintln!("qmanager-ping placeholder — not yet implemented");
    std::process::exit(0);
}
```

- [ ] **Step 2: Run tests — verify they pass**

```bash
cd ping-daemon && cargo test state
```

Expected: 9 tests pass.

- [ ] **Step 3: Commit**

```bash
git add ping-daemon/src/state.rs ping-daemon/src/main.rs
git commit -m "feat(ping-daemon): tri-state streak machine with hysteresis"
```

---

## Task 7: `history` module — ring buffer + flat-file write

**Files:**
- Create: `ping-daemon/src/history.rs`
- Modify: `ping-daemon/src/main.rs` (add `mod history;`)

- [ ] **Step 1: Write history module and tests**

Create `ping-daemon/src/history.rs`:

```rust
use std::collections::VecDeque;
use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};

pub struct History {
    entries: VecDeque<Option<f32>>,
    capacity: usize,
    path: PathBuf,
    tmp: PathBuf,
}

impl History {
    pub fn new(path: &Path, capacity: usize) -> Self {
        let tmp = path_with_suffix(path, ".tmp");
        Self {
            entries: VecDeque::with_capacity(capacity),
            capacity,
            path: path.to_path_buf(),
            tmp,
        }
    }

    pub fn push(&mut self, rtt_ms: Option<f32>) {
        if self.entries.len() >= self.capacity {
            self.entries.pop_front();
        }
        self.entries.push_back(rtt_ms);
    }

    /// Resize on profile change. Keeps the newest entries when shrinking.
    pub fn resize(&mut self, new_capacity: usize) {
        self.capacity = new_capacity.max(1);
        while self.entries.len() > self.capacity {
            self.entries.pop_front();
        }
    }

    /// Atomic write: serialize to <path>.tmp, then rename to <path>.
    /// Returns Err on I/O failure — caller should log and continue.
    pub fn flush(&self) -> std::io::Result<()> {
        let mut f = File::create(&self.tmp)?;
        for entry in &self.entries {
            match entry {
                Some(rtt) => writeln!(f, "{:.1}", rtt)?,
                None => writeln!(f, "null")?,
            }
        }
        f.sync_all().ok();
        std::fs::rename(&self.tmp, &self.path)?;
        Ok(())
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }
}

fn path_with_suffix(p: &Path, suffix: &str) -> PathBuf {
    let mut s = p.as_os_str().to_owned();
    s.push(suffix);
    PathBuf::from(s)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::read_to_string;

    fn temp_path(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        std::env::temp_dir().join(format!("qping-hist-{}-{}-{}", std::process::id(), nanos, name))
    }

    #[test]
    fn push_and_evict_oldest() {
        let mut h = History::new(&temp_path("evict"), 3);
        h.push(Some(1.0));
        h.push(Some(2.0));
        h.push(Some(3.0));
        h.push(Some(4.0));
        assert_eq!(h.len(), 3);
    }

    #[test]
    fn flush_writes_one_per_line_with_one_decimal() {
        let p = temp_path("flush");
        let mut h = History::new(&p, 5);
        h.push(Some(34.2));
        h.push(None);
        h.push(Some(38.15)); // should round to 38.1 or 38.2
        h.flush().unwrap();
        let body = read_to_string(&p).unwrap();
        let lines: Vec<&str> = body.lines().collect();
        assert_eq!(lines.len(), 3);
        assert_eq!(lines[0], "34.2");
        assert_eq!(lines[1], "null");
        assert!(lines[2] == "38.1" || lines[2] == "38.2", "got: {}", lines[2]);
    }

    #[test]
    fn flush_is_atomic_via_rename() {
        let p = temp_path("atomic");
        let tmp = path_with_suffix(&p, ".tmp");
        let mut h = History::new(&p, 5);
        h.push(Some(1.0));
        h.flush().unwrap();
        // Tmp should not exist after flush
        assert!(!tmp.exists());
        assert!(p.exists());
    }

    #[test]
    fn resize_smaller_keeps_newest() {
        let mut h = History::new(&temp_path("resize_smaller"), 5);
        for i in 0..5 { h.push(Some(i as f32)); }
        h.resize(2);
        assert_eq!(h.len(), 2);
        // Newest two are 3.0 and 4.0
        assert_eq!(h.entries[0], Some(3.0));
        assert_eq!(h.entries[1], Some(4.0));
    }

    #[test]
    fn resize_larger_preserves_existing() {
        let mut h = History::new(&temp_path("resize_larger"), 3);
        h.push(Some(1.0));
        h.push(Some(2.0));
        h.resize(10);
        assert_eq!(h.len(), 2);
        assert_eq!(h.capacity, 10);
    }
}
```

Modify `ping-daemon/src/main.rs`:

```rust
mod carrier;
mod config;
mod history;
mod qlog;
mod state;

fn main() {
    eprintln!("qmanager-ping placeholder — not yet implemented");
    std::process::exit(0);
}
```

- [ ] **Step 2: Run tests — verify they pass**

```bash
cd ping-daemon && cargo test history
```

Expected: 5 tests pass.

- [ ] **Step 3: Commit**

```bash
git add ping-daemon/src/history.rs ping-daemon/src/main.rs
git commit -m "feat(ping-daemon): history ring buffer with atomic flat-file flush"
```

---

## Task 8: `cache` module — atomic JSON cache write

**Files:**
- Create: `ping-daemon/src/cache.rs`
- Modify: `ping-daemon/src/main.rs` (add `mod cache;`)

- [ ] **Step 1: Write cache module and tests**

Create `ping-daemon/src/cache.rs`:

```rust
use crate::state::Connectivity;
use serde::Serialize;
use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};

/// Full daemon snapshot written to /tmp/qmanager_ping.json every cycle.
/// Field order matches the design spec — backwards-compat fields first,
/// new optional fields after.
#[derive(Debug, Serialize)]
pub struct PingCache {
    // Backwards-compat (existing consumers depend on these)
    pub timestamp: u64,
    pub targets: [String; 2],
    pub interval_sec: u64,
    pub last_rtt_ms: Option<f32>,
    pub reachable: bool,
    pub streak_success: u32,
    pub streak_fail: u32,
    pub during_recovery: bool,

    // New optional fields
    pub connectivity: Connectivity,
    pub limited_reason: Option<u16>,
    pub down_reason: Option<String>,
    pub streak_limited: u32,
    pub probe_target_used: Option<String>,
    pub http_code_seen: Option<u16>,
    pub tcp_reused: bool,
    pub fail_secs: u64,
    pub recover_secs: u64,
    pub intercept_secs: u64,
    pub profile: String,
}

pub struct CacheWriter {
    path: PathBuf,
    tmp: PathBuf,
    recovery_flag_path: PathBuf,
}

impl CacheWriter {
    pub fn new(path: &Path, recovery_flag_path: &Path) -> Self {
        let tmp = path_with_suffix(path, ".tmp");
        Self {
            path: path.to_path_buf(),
            tmp,
            recovery_flag_path: recovery_flag_path.to_path_buf(),
        }
    }

    pub fn during_recovery(&self) -> bool {
        self.recovery_flag_path.exists()
    }

    pub fn write(&self, snap: &PingCache) -> std::io::Result<()> {
        let body = serde_json::to_vec(snap).map_err(io_err)?;
        let mut f = File::create(&self.tmp)?;
        f.write_all(&body)?;
        f.write_all(b"\n")?;
        f.sync_all().ok();
        std::fs::rename(&self.tmp, &self.path)?;
        Ok(())
    }
}

fn io_err(e: serde_json::Error) -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::Other, e)
}

fn path_with_suffix(p: &Path, suffix: &str) -> PathBuf {
    let mut s = p.as_os_str().to_owned();
    s.push(suffix);
    PathBuf::from(s)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use std::fs::read_to_string;

    fn temp_path(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        std::env::temp_dir().join(format!("qping-cache-{}-{}-{}", std::process::id(), nanos, name))
    }

    fn fixture(connectivity: Connectivity, rtt: Option<f32>) -> PingCache {
        PingCache {
            timestamp: 1_700_000_000,
            targets: ["http://a/204".into(), "http://b/204".into()],
            interval_sec: 2,
            last_rtt_ms: rtt,
            reachable: matches!(connectivity, Connectivity::Connected),
            streak_success: 5,
            streak_fail: 0,
            during_recovery: false,
            connectivity,
            limited_reason: None,
            down_reason: None,
            streak_limited: 0,
            probe_target_used: Some("http://a/204".into()),
            http_code_seen: Some(204),
            tcp_reused: true,
            fail_secs: 10,
            recover_secs: 6,
            intercept_secs: 8,
            profile: "regular".into(),
        }
    }

    #[test]
    fn writes_valid_json_with_all_fields() {
        let p = temp_path("valid");
        let flag = temp_path("flag");
        let w = CacheWriter::new(&p, &flag);
        w.write(&fixture(Connectivity::Connected, Some(34.2))).unwrap();
        let body = read_to_string(&p).unwrap();
        let v: Value = serde_json::from_str(&body).unwrap();
        // Backwards-compat fields
        for k in ["timestamp","targets","interval_sec","last_rtt_ms","reachable",
                  "streak_success","streak_fail","during_recovery"] {
            assert!(v.get(k).is_some(), "missing field {}", k);
        }
        // New fields
        for k in ["connectivity","limited_reason","down_reason","streak_limited",
                  "probe_target_used","http_code_seen","tcp_reused",
                  "fail_secs","recover_secs","intercept_secs","profile"] {
            assert!(v.get(k).is_some(), "missing field {}", k);
        }
    }

    #[test]
    fn last_rtt_is_json_null_not_string_when_none() {
        let p = temp_path("rtt_null");
        let flag = temp_path("flag2");
        let w = CacheWriter::new(&p, &flag);
        w.write(&fixture(Connectivity::Disconnected, None)).unwrap();
        let v: Value = serde_json::from_str(&read_to_string(&p).unwrap()).unwrap();
        assert!(v.get("last_rtt_ms").unwrap().is_null());
    }

    #[test]
    fn connectivity_serializes_lowercase() {
        let p = temp_path("conn");
        let flag = temp_path("flag3");
        let w = CacheWriter::new(&p, &flag);
        w.write(&fixture(Connectivity::Limited, Some(50.0))).unwrap();
        let v: Value = serde_json::from_str(&read_to_string(&p).unwrap()).unwrap();
        assert_eq!(v.get("connectivity").unwrap().as_str().unwrap(), "limited");
    }

    #[test]
    fn during_recovery_reflects_flag_file() {
        let p = temp_path("rec");
        let flag = temp_path("rec_flag");
        let w = CacheWriter::new(&p, &flag);
        assert!(!w.during_recovery());
        std::fs::write(&flag, "").unwrap();
        assert!(w.during_recovery());
        std::fs::remove_file(&flag).unwrap();
    }

    #[test]
    fn write_is_atomic_via_rename() {
        let p = temp_path("atomic");
        let flag = temp_path("flag4");
        let tmp = path_with_suffix(&p, ".tmp");
        let w = CacheWriter::new(&p, &flag);
        w.write(&fixture(Connectivity::Connected, Some(1.0))).unwrap();
        assert!(!tmp.exists());
        assert!(p.exists());
    }
}
```

Modify `ping-daemon/src/main.rs`:

```rust
mod cache;
mod carrier;
mod config;
mod history;
mod qlog;
mod state;

fn main() {
    eprintln!("qmanager-ping placeholder — not yet implemented");
    std::process::exit(0);
}
```

- [ ] **Step 2: Run tests — verify they pass**

```bash
cd ping-daemon && cargo test cache
```

Expected: 5 tests pass.

- [ ] **Step 3: Commit**

```bash
git add ping-daemon/src/cache.rs ping-daemon/src/main.rs
git commit -m "feat(ping-daemon): atomic JSON cache writer with tri-state schema"
```

---

## Task 9: `reload` module — flag file watcher

**Files:**
- Create: `ping-daemon/src/reload.rs`
- Modify: `ping-daemon/src/main.rs` (add `mod reload;`)

- [ ] **Step 1: Write module and tests**

Create `ping-daemon/src/reload.rs`:

```rust
use std::path::{Path, PathBuf};

pub struct ReloadWatcher {
    flag_path: PathBuf,
}

impl ReloadWatcher {
    pub fn new(flag_path: &Path) -> Self {
        Self { flag_path: flag_path.to_path_buf() }
    }

    /// Returns true if the flag file exists. Caller must clear() afterwards.
    pub fn pending(&self) -> bool {
        self.flag_path.exists()
    }

    /// Removes the flag. Silently ignores ENOENT (already gone) but logs nothing here —
    /// caller does the logging.
    pub fn clear(&self) -> std::io::Result<()> {
        match std::fs::remove_file(&self.flag_path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        std::env::temp_dir().join(format!("qping-reload-{}-{}-{}", std::process::id(), nanos, name))
    }

    #[test]
    fn pending_false_when_flag_absent() {
        let p = temp_path("absent");
        let w = ReloadWatcher::new(&p);
        assert!(!w.pending());
    }

    #[test]
    fn pending_true_when_flag_present() {
        let p = temp_path("present");
        let w = ReloadWatcher::new(&p);
        std::fs::write(&p, "").unwrap();
        assert!(w.pending());
    }

    #[test]
    fn clear_removes_flag() {
        let p = temp_path("clear");
        let w = ReloadWatcher::new(&p);
        std::fs::write(&p, "").unwrap();
        w.clear().unwrap();
        assert!(!p.exists());
    }

    #[test]
    fn clear_is_idempotent_when_flag_missing() {
        let p = temp_path("missing");
        let w = ReloadWatcher::new(&p);
        // Should not error
        w.clear().unwrap();
    }
}
```

Modify `ping-daemon/src/main.rs`:

```rust
mod cache;
mod carrier;
mod config;
mod history;
mod qlog;
mod reload;
mod state;

fn main() {
    eprintln!("qmanager-ping placeholder — not yet implemented");
    std::process::exit(0);
}
```

- [ ] **Step 2: Run tests — verify they pass**

```bash
cd ping-daemon && cargo test reload
```

Expected: 4 tests pass.

- [ ] **Step 3: Commit**

```bash
git add ping-daemon/src/reload.rs ping-daemon/src/main.rs
git commit -m "feat(ping-daemon): reload flag watcher"
```

---

## Task 10: `pid` module — singleton guard

**Files:**
- Create: `ping-daemon/src/pid.rs`
- Modify: `ping-daemon/src/main.rs` (add `mod pid;`)

- [ ] **Step 1: Write module and tests**

Create `ping-daemon/src/pid.rs`:

```rust
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

pub struct PidGuard {
    path: PathBuf,
}

#[derive(Debug)]
pub enum PidError {
    AlreadyRunning(i32),
    Io(std::io::Error),
}

impl std::fmt::Display for PidError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PidError::AlreadyRunning(p) => write!(f, "another instance is running (PID {})", p),
            PidError::Io(e) => write!(f, "{}", e),
        }
    }
}

impl From<std::io::Error> for PidError {
    fn from(e: std::io::Error) -> Self { PidError::Io(e) }
}

impl PidGuard {
    /// Acquire the PID file, refusing if a live PID owns it.
    pub fn acquire(path: &Path) -> Result<Self, PidError> {
        if let Ok(s) = fs::read_to_string(path) {
            if let Ok(old_pid) = s.trim().parse::<i32>() {
                if pid_alive(old_pid) {
                    return Err(PidError::AlreadyRunning(old_pid));
                }
            }
        }
        let mut f = fs::File::create(path)?;
        let me = std::process::id();
        write!(f, "{}", me)?;
        Ok(PidGuard { path: path.to_path_buf() })
    }
}

impl Drop for PidGuard {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

/// Cross-user PID liveness check via kill(pid, 0) — sends no signal,
/// returns 0 if process exists. Matches platform.sh's pid_alive() helper.
fn pid_alive(pid: i32) -> bool {
    if pid <= 0 { return false; }
    unsafe { libc::kill(pid, 0) == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM) }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        std::env::temp_dir().join(format!("qping-pid-{}-{}-{}", std::process::id(), nanos, name))
    }

    #[test]
    fn acquire_writes_own_pid() {
        let p = temp_path("own");
        let _guard = PidGuard::acquire(&p).unwrap();
        let body = std::fs::read_to_string(&p).unwrap();
        assert_eq!(body.trim().parse::<u32>().unwrap(), std::process::id());
    }

    #[test]
    fn drop_removes_pid_file() {
        let p = temp_path("drop");
        {
            let _guard = PidGuard::acquire(&p).unwrap();
            assert!(p.exists());
        }
        assert!(!p.exists());
    }

    #[test]
    fn acquire_succeeds_when_stale_pid_present() {
        let p = temp_path("stale");
        // Write an absurdly high PID that almost certainly does not exist.
        // Cannot guarantee, but on a dev box with PID 4_000_000 free this is reliable.
        std::fs::write(&p, "4000000").unwrap();
        let _guard = PidGuard::acquire(&p).unwrap();
    }

    #[test]
    fn acquire_fails_when_self_holds_pid() {
        let p = temp_path("self");
        let me = std::process::id().to_string();
        std::fs::write(&p, &me).unwrap();
        let result = PidGuard::acquire(&p);
        assert!(matches!(result, Err(PidError::AlreadyRunning(_))));
        // Cleanup since no guard was created
        let _ = std::fs::remove_file(&p);
    }
}
```

Modify `ping-daemon/src/main.rs`:

```rust
mod cache;
mod carrier;
mod config;
mod history;
mod pid;
mod qlog;
mod reload;
mod state;

fn main() {
    eprintln!("qmanager-ping placeholder — not yet implemented");
    std::process::exit(0);
}
```

- [ ] **Step 2: Run tests — verify they pass**

```bash
cd ping-daemon && cargo test pid
```

Expected: 4 tests pass.

- [ ] **Step 3: Commit**

```bash
git add ping-daemon/src/pid.rs ping-daemon/src/main.rs
git commit -m "feat(ping-daemon): RAII PID guard with kill(0) liveness check"
```

---

## Task 11: `probe` module — HTTP keep-alive client (the heart of the daemon)

**Files:**
- Create: `ping-daemon/src/probe.rs`
- Modify: `ping-daemon/src/main.rs` (add `mod probe;`)

- [ ] **Step 1: Write the probe module**

Create `ping-daemon/src/probe.rs`:

```rust
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DownReason {
    CarrierDown,
    Timeout,
    Refused,
    Reset,
    Dns,
    Malformed,
}

impl DownReason {
    pub fn as_str(&self) -> &'static str {
        match self {
            DownReason::CarrierDown => "carrier_down",
            DownReason::Timeout => "timeout",
            DownReason::Refused => "refused",
            DownReason::Reset => "reset",
            DownReason::Dns => "dns",
            DownReason::Malformed => "malformed",
        }
    }
}

#[derive(Debug, Clone)]
pub enum ProbeOutcome {
    Connected { rtt_ms: f32, tcp_reused: bool },
    Limited { rtt_ms: f32, http_code: u16, tcp_reused: bool },
    Disconnected { reason: DownReason },
}

pub struct KeepAliveClient {
    connections: HashMap<String, TcpStream>,
    timeout: Duration,
}

impl KeepAliveClient {
    pub fn new(timeout: Duration) -> Self {
        Self { connections: HashMap::new(), timeout }
    }

    /// Probe a target URL. Returns the outcome enum.
    pub fn probe(&mut self, url: &str) -> ProbeOutcome {
        let parsed = match parse_http_url(url) {
            Some(p) => p,
            None => return ProbeOutcome::Disconnected { reason: DownReason::Malformed },
        };
        let host_port = format!("{}:{}", parsed.host, parsed.port);
        let host_for_header = parsed.host.clone();

        let start = Instant::now();
        let (mut stream, tcp_reused) = match self.connections.remove(&host_port) {
            Some(s) => (s, true),
            None => match self.dial(&host_port) {
                Ok(s) => (s, false),
                Err(reason) => return ProbeOutcome::Disconnected { reason },
            },
        };

        if let Err(reason) = self.send_get(&mut stream, &host_for_header, &parsed.path) {
            // Reset path: drop connection, attempt one fresh dial in this same probe cycle.
            // This avoids a "stale keepalive = false alarm" event on every Nth probe when
            // the server / carrier closes idle connections silently.
            if tcp_reused {
                let mut fresh = match self.dial(&host_port) {
                    Ok(s) => s,
                    Err(r) => return ProbeOutcome::Disconnected { reason: r },
                };
                if let Err(r) = self.send_get(&mut fresh, &host_for_header, &parsed.path) {
                    return ProbeOutcome::Disconnected { reason: r };
                }
                return self.read_response(fresh, &host_port, start, false);
            }
            return ProbeOutcome::Disconnected { reason };
        }

        self.read_response(stream, &host_port, start, tcp_reused)
    }

    fn dial(&self, host_port: &str) -> Result<TcpStream, DownReason> {
        let addrs: Vec<_> = match host_port.to_socket_addrs() {
            Ok(it) => it.collect(),
            Err(_) => return Err(DownReason::Dns),
        };
        let addr = addrs.first().ok_or(DownReason::Dns)?;
        let stream = TcpStream::connect_timeout(addr, self.timeout).map_err(map_io_err)?;
        stream.set_read_timeout(Some(self.timeout)).ok();
        stream.set_write_timeout(Some(self.timeout)).ok();
        stream.set_nodelay(true).ok();
        Ok(stream)
    }

    fn send_get(&self, stream: &mut TcpStream, host: &str, path: &str) -> Result<(), DownReason> {
        let req = format!(
            "GET {} HTTP/1.1\r\nHost: {}\r\nConnection: keep-alive\r\nUser-Agent: qmanager-ping/0.1\r\nAccept: */*\r\n\r\n",
            path, host
        );
        stream.write_all(req.as_bytes()).map_err(map_io_err)?;
        Ok(())
    }

    fn read_response(
        &mut self,
        stream: TcpStream,
        host_port: &str,
        start: Instant,
        tcp_reused: bool,
    ) -> ProbeOutcome {
        let mut reader = BufReader::new(stream);

        let mut status_line = String::new();
        if reader.read_line(&mut status_line).is_err() || status_line.is_empty() {
            return ProbeOutcome::Disconnected { reason: DownReason::Reset };
        }

        let code = match parse_status_code(&status_line) {
            Some(c) => c,
            None => return ProbeOutcome::Disconnected { reason: DownReason::Malformed },
        };

        let mut content_length: u64 = 0;
        let mut connection_close = false;
        loop {
            let mut line = String::new();
            if reader.read_line(&mut line).is_err() {
                return ProbeOutcome::Disconnected { reason: DownReason::Reset };
            }
            if line == "\r\n" || line == "\n" || line.is_empty() {
                break;
            }
            let lower = line.to_ascii_lowercase();
            if let Some(rest) = lower.strip_prefix("content-length:") {
                if let Ok(n) = rest.trim().parse::<u64>() { content_length = n; }
            } else if let Some(rest) = lower.strip_prefix("connection:") {
                if rest.trim() == "close" { connection_close = true; }
            }
        }

        if content_length > 0 {
            let mut to_read = content_length;
            let mut buf = [0u8; 4096];
            while to_read > 0 {
                let want = std::cmp::min(buf.len() as u64, to_read) as usize;
                match reader.read(&mut buf[..want]) {
                    Ok(0) => return ProbeOutcome::Disconnected { reason: DownReason::Reset },
                    Ok(n) => to_read -= n as u64,
                    Err(_) => return ProbeOutcome::Disconnected { reason: DownReason::Reset },
                }
            }
        }

        let rtt_ms = (start.elapsed().as_secs_f64() * 1000.0) as f32;
        let stream = reader.into_inner();

        if !connection_close {
            self.connections.insert(host_port.to_string(), stream);
        }
        // If connection_close, we drop `stream` here; the next probe will dial fresh.

        if code == 204 {
            ProbeOutcome::Connected { rtt_ms, tcp_reused }
        } else {
            ProbeOutcome::Limited { rtt_ms, http_code: code, tcp_reused }
        }
    }
}

#[derive(Debug)]
struct ParsedUrl {
    host: String,
    port: u16,
    path: String,
}

fn parse_http_url(url: &str) -> Option<ParsedUrl> {
    let rest = url.strip_prefix("http://")?;
    let (host_part, path) = match rest.find('/') {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, "/"),
    };
    let (host, port) = match host_part.rsplit_once(':') {
        Some((h, p)) => {
            let port: u16 = p.parse().ok()?;
            (h.to_string(), port)
        }
        None => (host_part.to_string(), 80),
    };
    if host.is_empty() { return None; }
    Some(ParsedUrl { host, port, path: path.to_string() })
}

fn parse_status_code(line: &str) -> Option<u16> {
    let mut parts = line.split_whitespace();
    let _proto = parts.next()?;
    let code = parts.next()?;
    code.parse().ok()
}

fn map_io_err(e: std::io::Error) -> DownReason {
    use std::io::ErrorKind::*;
    match e.kind() {
        TimedOut | WouldBlock => DownReason::Timeout,
        ConnectionRefused => DownReason::Refused,
        ConnectionReset | BrokenPipe | UnexpectedEof => DownReason::Reset,
        NotFound => DownReason::Dns,
        _ => DownReason::Reset,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write as _;
    use std::net::TcpListener;
    use std::sync::mpsc;
    use std::thread;

    /// Spawn a one-shot HTTP server on 127.0.0.1:<chosen port>.
    /// The handler is run for each accepted connection until the listener is dropped.
    fn spawn_server(
        responses: Vec<&'static str>,
    ) -> (u16, mpsc::Sender<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let (shutdown_tx, shutdown_rx) = mpsc::channel();
        thread::spawn(move || {
            listener.set_nonblocking(true).ok();
            let mut idx = 0usize;
            loop {
                if shutdown_rx.try_recv().is_ok() { break; }
                match listener.accept() {
                    Ok((mut s, _)) => {
                        s.set_read_timeout(Some(Duration::from_secs(1))).ok();
                        // Drain request (read until \r\n\r\n)
                        let mut buf = [0u8; 1024];
                        let mut total = String::new();
                        for _ in 0..10 {
                            match s.read(&mut buf) {
                                Ok(0) => break,
                                Ok(n) => {
                                    total.push_str(&String::from_utf8_lossy(&buf[..n]));
                                    if total.contains("\r\n\r\n") { break; }
                                }
                                Err(_) => break,
                            }
                        }
                        // Pick next response (cycle)
                        let resp = responses[idx % responses.len()];
                        idx += 1;
                        let _ = s.write_all(resp.as_bytes());
                        let _ = s.flush();
                        // Don't immediately shutdown — let client drive close
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(10));
                    }
                    Err(_) => break,
                }
            }
        });
        (port, shutdown_tx)
    }

    #[test]
    fn probe_204_returns_connected_first_cycle_not_reused() {
        let (port, _stop) = spawn_server(vec![
            "HTTP/1.1 204 No Content\r\nContent-Length: 0\r\n\r\n",
        ]);
        let mut c = KeepAliveClient::new(Duration::from_secs(2));
        let url = format!("http://127.0.0.1:{}/204", port);
        let r = c.probe(&url);
        match r {
            ProbeOutcome::Connected { tcp_reused, .. } => assert!(!tcp_reused),
            _ => panic!("expected Connected, got {:?}", r),
        }
    }

    #[test]
    fn probe_204_second_cycle_reuses_connection() {
        let (port, _stop) = spawn_server(vec![
            "HTTP/1.1 204 No Content\r\nContent-Length: 0\r\n\r\n",
            "HTTP/1.1 204 No Content\r\nContent-Length: 0\r\n\r\n",
        ]);
        let mut c = KeepAliveClient::new(Duration::from_secs(2));
        let url = format!("http://127.0.0.1:{}/204", port);
        let _ = c.probe(&url);
        let r = c.probe(&url);
        match r {
            ProbeOutcome::Connected { tcp_reused, .. } => assert!(tcp_reused),
            _ => panic!("expected reused Connected, got {:?}", r),
        }
    }

    #[test]
    fn probe_200_with_html_returns_limited() {
        let body = "<html>captive portal</html>";
        let resp = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nContent-Type: text/html\r\n\r\n{}",
            body.len(), body
        );
        let leaked: &'static str = Box::leak(resp.into_boxed_str());
        let (port, _stop) = spawn_server(vec![leaked]);
        let mut c = KeepAliveClient::new(Duration::from_secs(2));
        let url = format!("http://127.0.0.1:{}/", port);
        match c.probe(&url) {
            ProbeOutcome::Limited { http_code, .. } => assert_eq!(http_code, 200),
            other => panic!("expected Limited, got {:?}", other),
        }
    }

    #[test]
    fn probe_5xx_returns_limited() {
        let resp = "HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n";
        let (port, _stop) = spawn_server(vec![resp]);
        let mut c = KeepAliveClient::new(Duration::from_secs(2));
        let url = format!("http://127.0.0.1:{}/", port);
        match c.probe(&url) {
            ProbeOutcome::Limited { http_code, .. } => assert_eq!(http_code, 502),
            other => panic!("expected Limited 502, got {:?}", other),
        }
    }

    #[test]
    fn probe_unroutable_returns_disconnected_timeout_or_refused() {
        let mut c = KeepAliveClient::new(Duration::from_millis(500));
        // Port 1 is well-known privileged, refused on most hosts
        let url = "http://127.0.0.1:1/";
        match c.probe(url) {
            ProbeOutcome::Disconnected { reason } => {
                assert!(matches!(reason, DownReason::Refused | DownReason::Timeout | DownReason::Reset));
            }
            other => panic!("expected Disconnected, got {:?}", other),
        }
    }

    #[test]
    fn probe_connection_close_drops_keepalive() {
        let (port, _stop) = spawn_server(vec![
            "HTTP/1.1 204 No Content\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
            "HTTP/1.1 204 No Content\r\nContent-Length: 0\r\n\r\n",
        ]);
        let mut c = KeepAliveClient::new(Duration::from_secs(2));
        let url = format!("http://127.0.0.1:{}/", port);
        let _ = c.probe(&url);
        // Second probe should NOT be tcp_reused since first response had Connection: close
        let r = c.probe(&url);
        match r {
            ProbeOutcome::Connected { tcp_reused, .. } => assert!(!tcp_reused),
            _ => panic!("expected Connected, got {:?}", r),
        }
    }

    #[test]
    fn parse_url_with_path_and_no_port() {
        let p = parse_http_url("http://www.gstatic.com/generate_204").unwrap();
        assert_eq!(p.host, "www.gstatic.com");
        assert_eq!(p.port, 80);
        assert_eq!(p.path, "/generate_204");
    }

    #[test]
    fn parse_url_with_explicit_port() {
        let p = parse_http_url("http://127.0.0.1:8080/foo").unwrap();
        assert_eq!(p.host, "127.0.0.1");
        assert_eq!(p.port, 8080);
        assert_eq!(p.path, "/foo");
    }

    #[test]
    fn parse_url_no_path_defaults_to_slash() {
        let p = parse_http_url("http://example.com").unwrap();
        assert_eq!(p.path, "/");
    }

    #[test]
    fn parse_url_rejects_https() {
        assert!(parse_http_url("https://example.com").is_none());
    }

    #[test]
    fn parse_status_code_extracts_204() {
        assert_eq!(parse_status_code("HTTP/1.1 204 No Content\r\n"), Some(204));
        assert_eq!(parse_status_code("HTTP/1.0 200 OK\r\n"), Some(200));
        assert_eq!(parse_status_code("garbage"), None);
    }
}
```

Modify `ping-daemon/src/main.rs`:

```rust
mod cache;
mod carrier;
mod config;
mod history;
mod pid;
mod probe;
mod qlog;
mod reload;
mod state;

fn main() {
    eprintln!("qmanager-ping placeholder — not yet implemented");
    std::process::exit(0);
}
```

- [ ] **Step 2: Run tests — verify they pass**

```bash
cd ping-daemon && cargo test probe
```

Expected: 11 tests pass. Some may take ~500ms due to the timeout test.

- [ ] **Step 3: Commit**

```bash
git add ping-daemon/src/probe.rs ping-daemon/src/main.rs
git commit -m "feat(ping-daemon): hand-rolled HTTP/1.1 keep-alive probe client"
```

---

## Task 12: `main` module — wire it all together

**Files:**
- Modify: `ping-daemon/src/main.rs` (replace placeholder with full main loop)

- [ ] **Step 1: Replace main.rs with the full daemon loop**

Replace the entire contents of `ping-daemon/src/main.rs` with:

```rust
mod cache;
mod carrier;
mod config;
mod history;
mod pid;
mod probe;
mod qlog;
mod reload;
mod state;

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use cache::{CacheWriter, PingCache};
use config::ProfileConfig;
use history::History;
use pid::PidGuard;
use probe::{KeepAliveClient, ProbeOutcome};
use qlog::Logger;
use reload::ReloadWatcher;
use state::{tick, Connectivity, OutcomeKind, StreakState, Thresholds};

const PROFILE_JSON: &str = "/etc/qmanager/ping_profile.json";
const CACHE_PATH: &str = "/tmp/qmanager_ping.json";
const HISTORY_PATH: &str = "/tmp/qmanager_ping_history";
const PID_PATH: &str = "/tmp/qmanager_ping.pid";
const RELOAD_FLAG: &str = "/tmp/qmanager_ping_reload";
const RECOVERY_FLAG: &str = "/tmp/qmanager_recovery_active";
const QLOG_PATH: &str = "/tmp/qmanager.log";
const PROBE_TIMEOUT: Duration = Duration::from_secs(2);

fn main() {
    let log = Arc::new(Logger::new("ping", Path::new(QLOG_PATH)));

    let _pid_guard = match PidGuard::acquire(Path::new(PID_PATH)) {
        Ok(g) => g,
        Err(e) => {
            log.error(&format!("Cannot start: {}", e));
            std::process::exit(1);
        }
    };

    let stop = Arc::new(AtomicBool::new(false));
    install_signal_handlers(Arc::clone(&stop), Arc::clone(&log));

    let mut cfg = config::load(Path::new(PROFILE_JSON));
    log.info("========================================");
    log.info(&format!("QManager Ping Daemon starting (PID {})", std::process::id()));
    log.info(&format!("Profile: {}", cfg.profile));
    log.info(&format!("Targets: {}, {}", cfg.target_1, cfg.target_2));
    log.info(&format!(
        "Interval: {}s, fail/recover/intercept: {}s/{}s/{}s, history: {}s",
        cfg.interval_sec, cfg.fail_secs, cfg.recover_secs, cfg.intercept_secs, cfg.history_secs
    ));
    log.info(&format!("Carrier file: {}", cfg.carrier_file.display()));
    log.info("========================================");

    let cache = CacheWriter::new(Path::new(CACHE_PATH), Path::new(RECOVERY_FLAG));
    let mut history = History::new(Path::new(HISTORY_PATH), cfg.history_size());
    let reload = ReloadWatcher::new(Path::new(RELOAD_FLAG));
    let mut client = KeepAliveClient::new(PROBE_TIMEOUT);
    let mut streaks = StreakState::new();
    let mut target_index = 0u8;

    while !stop.load(Ordering::SeqCst) {
        if reload.pending() {
            let new_cfg = config::load(Path::new(PROFILE_JSON));
            if new_cfg.profile != cfg.profile
                || new_cfg.interval_sec != cfg.interval_sec
                || new_cfg.fail_secs != cfg.fail_secs
                || new_cfg.recover_secs != cfg.recover_secs
                || new_cfg.intercept_secs != cfg.intercept_secs
                || new_cfg.history_secs != cfg.history_secs
            {
                log.state_change("profile", &cfg.profile, &new_cfg.profile);
                history.resize(new_cfg.history_size());
            }
            cfg = new_cfg;
            if let Err(e) = reload.clear() {
                log.error(&format!("Failed to clear reload flag: {}", e));
            }
        }

        let (target, outcome) = if !carrier::is_up(&cfg.carrier_file) {
            log.debug("carrier=0, skipping probe");
            (None, ProbeOutcome::Disconnected { reason: probe::DownReason::CarrierDown })
        } else {
            let t = pick_target(&cfg, &mut target_index);
            let r = client.probe(&t);
            (Some(t), r)
        };

        let kind = match &outcome {
            ProbeOutcome::Connected { .. } => OutcomeKind::Connected,
            ProbeOutcome::Limited { .. } => OutcomeKind::Limited,
            ProbeOutcome::Disconnected { .. } => OutcomeKind::Disconnected,
        };

        let thresholds = Thresholds {
            fail: cfg.fail_threshold_cycles(),
            recover: cfg.recover_threshold_cycles(),
            intercept: cfg.intercept_threshold_cycles(),
        };
        if let Some(chg) = tick(&mut streaks, kind, &thresholds) {
            log.state_change(
                "connectivity",
                conn_label(chg.from),
                conn_label(chg.to),
            );
            if matches!(chg.to, Connectivity::Disconnected) {
                log.warn("Internet unreachable");
            }
        }

        let (rtt, http_code, tcp_reused, limited_reason, down_reason) = match &outcome {
            ProbeOutcome::Connected { rtt_ms, tcp_reused } => {
                (Some(*rtt_ms), Some(204u16), *tcp_reused, None, None)
            }
            ProbeOutcome::Limited { rtt_ms, http_code, tcp_reused } => {
                (Some(*rtt_ms), Some(*http_code), *tcp_reused, Some(*http_code), None)
            }
            ProbeOutcome::Disconnected { reason } => {
                (None, None, false, None, Some(reason.as_str().to_string()))
            }
        };

        history.push(rtt);
        if let Err(e) = history.flush() {
            log.error(&format!("history flush failed: {}", e));
        }

        let snap = PingCache {
            timestamp: now_secs(),
            targets: [cfg.target_1.clone(), cfg.target_2.clone()],
            interval_sec: cfg.interval_sec,
            last_rtt_ms: rtt,
            reachable: streaks.connectivity == Connectivity::Connected,
            streak_success: streaks.streak_success,
            streak_fail: streaks.streak_fail,
            during_recovery: cache.during_recovery(),
            connectivity: streaks.connectivity,
            limited_reason,
            down_reason,
            streak_limited: streaks.streak_limited,
            probe_target_used: target,
            http_code_seen: http_code,
            tcp_reused,
            fail_secs: cfg.fail_secs,
            recover_secs: cfg.recover_secs,
            intercept_secs: cfg.intercept_secs,
            profile: cfg.profile.clone(),
        };
        if let Err(e) = cache.write(&snap) {
            log.error(&format!("cache write failed: {}", e));
        }

        sleep_interruptibly(&stop, Duration::from_secs(cfg.interval_sec));
    }

    log.info("SIGTERM/SIGINT received, exiting cleanly");
}

fn pick_target(cfg: &ProfileConfig, idx: &mut u8) -> String {
    let t = if *idx == 0 { &cfg.target_1 } else { &cfg.target_2 };
    *idx = (*idx + 1) % 2;
    t.clone()
}

fn conn_label(c: Connectivity) -> &'static str {
    match c {
        Connectivity::Connected => "connected",
        Connectivity::Limited => "limited",
        Connectivity::Disconnected => "disconnected",
    }
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn install_signal_handlers(stop: Arc<AtomicBool>, log: Arc<Logger>) {
    use signal_hook::consts::{SIGINT, SIGTERM};
    use signal_hook::iterator::Signals;
    let mut signals = match Signals::new([SIGTERM, SIGINT]) {
        Ok(s) => s,
        Err(e) => {
            log.error(&format!("Failed to install signal handlers: {}", e));
            return;
        }
    };
    std::thread::spawn(move || {
        for _ in signals.forever() {
            stop.store(true, Ordering::SeqCst);
            break;
        }
    });
}

/// Sleep up to `total`, waking early if shutdown was signaled.
fn sleep_interruptibly(stop: &AtomicBool, total: Duration) {
    let step = Duration::from_millis(100);
    let mut elapsed = Duration::ZERO;
    while elapsed < total {
        if stop.load(Ordering::SeqCst) { return; }
        let remaining = total - elapsed;
        let nap = if remaining < step { remaining } else { step };
        std::thread::sleep(nap);
        elapsed += nap;
    }
}
```

- [ ] **Step 2: Verify the host build still succeeds**

```bash
cd ping-daemon && cargo build --release
```

Expected: clean compile, no warnings beyond unused-import noise (which we'll address by ensuring nothing is unused — the build should be warning-free).

- [ ] **Step 3: Verify all unit tests still pass**

```bash
cd ping-daemon && cargo test -- --test-threads=1
```

Expected: all tests across all modules pass. Roughly 47 tests total.

- [ ] **Step 4: Verify the ARMv7 cross build still succeeds**

```bash
cd ping-daemon && cargo build --release --target=armv7-unknown-linux-musleabihf
file target/armv7-unknown-linux-musleabihf/release/qmanager_ping
ls -la target/armv7-unknown-linux-musleabihf/release/qmanager_ping
```

Expected: `statically linked`, ARM EABI5, binary size ≤ 800 KB unstripped.

- [ ] **Step 5: Strip and check final size**

```bash
arm-linux-gnueabihf-strip ping-daemon/target/armv7-unknown-linux-musleabihf/release/qmanager_ping
ls -la ping-daemon/target/armv7-unknown-linux-musleabihf/release/qmanager_ping
```

Expected: stripped binary ≤ 500 KB. (Spec target: 300–450 KB. If significantly larger, investigate via `cargo bloat --release`.)

- [ ] **Step 6: Commit**

```bash
git add ping-daemon/src/main.rs
git commit -m "feat(ping-daemon): wire main loop with signal handling and reload"
```

---

## Task 13: Build script

**Files:**
- Create: `ping-daemon/build-ping-daemon.sh`

- [ ] **Step 1: Write the build script**

Create `ping-daemon/build-ping-daemon.sh`:

```bash
#!/usr/bin/env bash
# Build the qmanager_ping Rust binary for ARMv7-musl and install it into
# scripts/usr/bin/ where the QManager installer expects it.
#
# Usage: bash ping-daemon/build-ping-daemon.sh [--debug]
#
# Prerequisites:
#   - Rust toolchain (rustup recommended)
#   - rustup target add armv7-unknown-linux-musleabihf
#   - arm-linux-gnueabihf-gcc (apt: gcc-arm-linux-gnueabihf)
#
# WSL2 setup parallels the atcli_smd11 build flow.

set -euo pipefail

MODE="release"
if [ "${1:-}" = "--debug" ]; then
    MODE="debug"
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CRATE_DIR="$REPO_ROOT/ping-daemon"
TARGET="armv7-unknown-linux-musleabihf"
DEST="$REPO_ROOT/scripts/usr/bin/qmanager_ping"

cd "$CRATE_DIR"

if ! rustup target list --installed | grep -q "^${TARGET}\$"; then
    echo "Installing Rust target ${TARGET}..."
    rustup target add "$TARGET"
fi

if ! command -v arm-linux-gnueabihf-gcc >/dev/null 2>&1; then
    echo "ERROR: arm-linux-gnueabihf-gcc not found. Install with:" >&2
    echo "  sudo apt install gcc-arm-linux-gnueabihf" >&2
    exit 1
fi

echo "Building qmanager_ping (${MODE}, target=${TARGET})..."
if [ "$MODE" = "release" ]; then
    cargo build --release --target="$TARGET"
    BIN="$CRATE_DIR/target/$TARGET/release/qmanager_ping"
else
    cargo build --target="$TARGET"
    BIN="$CRATE_DIR/target/$TARGET/debug/qmanager_ping"
fi

if [ ! -f "$BIN" ]; then
    echo "ERROR: build did not produce $BIN" >&2
    exit 1
fi

if [ "$MODE" = "release" ]; then
    if command -v arm-linux-gnueabihf-strip >/dev/null 2>&1; then
        echo "Stripping binary..."
        arm-linux-gnueabihf-strip "$BIN"
    fi
fi

# DO NOT UPX-compress: Rust ARM + UPX = segfault on exit (project memory).
echo "(skipping UPX — Rust ARM binaries segfault on exit when packed)"

cp "$BIN" "$DEST"
chmod +x "$DEST"

SIZE=$(stat -c %s "$DEST")
SIZE_KB=$((SIZE / 1024))
echo "Installed to: $DEST (${SIZE_KB} KB)"

if [ "$SIZE_KB" -gt 800 ]; then
    echo "WARNING: binary is ${SIZE_KB} KB — spec target is 300-450 KB. Consider:" >&2
    echo "  - cargo install cargo-bloat && cargo bloat --release --target=$TARGET" >&2
fi
```

- [ ] **Step 2: Make it executable and run it**

```bash
chmod +x ping-daemon/build-ping-daemon.sh
bash ping-daemon/build-ping-daemon.sh
```

Expected:
- Successful build
- `scripts/usr/bin/qmanager_ping` is now an ARMv7 binary (replacing the old shell script)
- Output line `Installed to: .../qmanager_ping (XXX KB)` with a size ≤ 500 KB.

- [ ] **Step 3: Confirm scripts/usr/bin/qmanager_ping is now the binary**

```bash
file scripts/usr/bin/qmanager_ping
```

Expected: ARM ELF, statically linked.

- [ ] **Step 4: Commit**

```bash
git add ping-daemon/build-ping-daemon.sh scripts/usr/bin/qmanager_ping
git commit -m "build(ping-daemon): add build-ping-daemon.sh, replace shell daemon binary"
```

---

## Task 14: Update systemd unit

**Files:**
- Modify: `scripts/etc/systemd/system/qmanager-ping.service`

- [ ] **Step 1: Update the unit file**

Replace the contents of `scripts/etc/systemd/system/qmanager-ping.service` with:

```ini
# /lib/systemd/system/qmanager-ping.service
[Unit]
Description=QManager Ping Daemon (Rust)
After=network.target qmanager-setup.service

[Service]
Type=simple
ExecStart=/usr/bin/qmanager_ping
# Documented relaxed-profile defaults — preserve today's 5s probe behavior on
# fresh starts before /etc/qmanager/ping_profile.json is read. Operator
# overrides via EnvironmentFile= below win because systemd processes these
# directives in declaration order and later assignments override earlier ones
# for the same variable.
Environment=PING_PROFILE=relaxed
Environment=PING_INTERVAL=5
Environment=FAIL_SECS=15
Environment=RECOVER_SECS=10
Environment=INTERCEPT_SECS=8
Environment=HISTORY_SECS=300
Environment=PING_TARGET_1=http://www.gstatic.com/generate_204
Environment=PING_TARGET_2=http://cp.cloudflare.com/
Environment=CARRIER_FILE=/sys/class/net/rmnet_data0/carrier
EnvironmentFile=-/etc/qmanager/environment
TimeoutStopSec=10
Restart=on-failure
RestartSec=5s
StartLimitIntervalSec=3600
StartLimitBurst=5

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 2: Commit**

```bash
git add scripts/etc/systemd/system/qmanager-ping.service
git commit -m "chore(ping-daemon): update systemd unit env vars to time-based names"
```

---

## Task 15: Default `ping_profile.json` + installer migration

**Files:**
- Create: `scripts/etc/qmanager/ping_profile.json` (default — shipped by installer)
- Modify: `install.sh` (add migration logic)

- [ ] **Step 1: Locate the installer's qmanager-ping handling**

```bash
grep -n "qmanager-ping\|qmanager_ping" install.sh
```

Capture the output — you'll need to insert the migration logic near the existing systemd-unit install step. Note the line number for the next step.

- [ ] **Step 2: Create the default profile JSON**

Create `scripts/etc/qmanager/ping_profile.json`:

```json
{
  "profile": "relaxed",
  "interval_sec": 5,
  "fail_secs": 15,
  "recover_secs": 10,
  "intercept_secs": 8,
  "history_secs": 300
}
```

The installer will copy this only if no existing profile is present.

- [ ] **Step 3: Add installer logic for profile bootstrap and env migration**

Add the following function definition near the other `install_*` helpers in `install.sh` (near top, before main flow). Insert at the helper section — typically after other `install_<feature>()` functions:

```bash
# Bootstrap default ping_profile.json on first install. Idempotent.
install_ping_profile() {
    local target="/etc/qmanager/ping_profile.json"
    local source_file="$INSTALL_SOURCE_DIR/etc/qmanager/ping_profile.json"

    mkdir -p /etc/qmanager
    if [ ! -f "$target" ]; then
        if [ -f "$source_file" ]; then
            cp "$source_file" "$target"
            chmod 644 "$target"
            echo "  Installed default ping profile (relaxed)"
        else
            echo "  WARNING: $source_file missing from installer payload" >&2
        fi
    else
        echo "  Existing ping profile preserved at $target"
    fi
}

# Migrate old cycle-count env vars in /etc/qmanager/environment to time-based.
# Old: FAIL_THRESHOLD=3 (cycles)  ->  New: FAIL_SECS=15 (seconds, assuming 5s probe interval)
# Idempotent: re-running on already-migrated file is a no-op.
migrate_ping_environment() {
    local env_file="/etc/qmanager/environment"
    [ -f "$env_file" ] || return 0

    # Skip if migration already happened (FAIL_SECS present, FAIL_THRESHOLD absent)
    if grep -q '^FAIL_SECS=' "$env_file" && ! grep -q '^FAIL_THRESHOLD=' "$env_file"; then
        return 0
    fi
    if ! grep -q '^FAIL_THRESHOLD=\|^RECOVER_THRESHOLD=\|^HISTORY_SIZE=' "$env_file"; then
        return 0
    fi

    echo "  Migrating ping env vars from cycle-count to time-based..."
    local interval=5
    if grep -q '^PING_INTERVAL=' "$env_file"; then
        interval=$(grep '^PING_INTERVAL=' "$env_file" | head -1 | cut -d= -f2)
        # Defensive default if the value is missing or non-numeric
        case "$interval" in
            ''|*[!0-9]*) interval=5 ;;
        esac
    fi

    local backup="${env_file}.pre-rust-ping.bak"
    cp "$env_file" "$backup"

    local tmp; tmp=$(mktemp)
    while IFS= read -r line || [ -n "$line" ]; do
        case "$line" in
            FAIL_THRESHOLD=*)
                local n="${line#FAIL_THRESHOLD=}"
                case "$n" in ''|*[!0-9]*) n=3 ;; esac
                printf 'FAIL_SECS=%s\n' "$((n * interval))" >> "$tmp"
                ;;
            RECOVER_THRESHOLD=*)
                local n="${line#RECOVER_THRESHOLD=}"
                case "$n" in ''|*[!0-9]*) n=2 ;; esac
                printf 'RECOVER_SECS=%s\n' "$((n * interval))" >> "$tmp"
                ;;
            HISTORY_SIZE=*)
                local n="${line#HISTORY_SIZE=}"
                case "$n" in ''|*[!0-9]*) n=60 ;; esac
                printf 'HISTORY_SECS=%s\n' "$((n * interval))" >> "$tmp"
                ;;
            *)
                printf '%s\n' "$line" >> "$tmp"
                ;;
        esac
    done < "$env_file"
    mv "$tmp" "$env_file"
    chmod 644 "$env_file"
    echo "  Migrated $env_file (backup at $backup)"
}
```

- [ ] **Step 4: Wire the helpers into the main install flow**

Find the section in `install.sh` where the qmanager-ping service is installed (located via Step 1). Insert these two calls before that block:

```bash
install_ping_profile
migrate_ping_environment
```

- [ ] **Step 5: Add the source JSON to the installer's payload list**

If `install.sh` has an explicit list of files to copy from the installer's source directory (search for `etc/qmanager` patterns in the script — they may be globbed or explicit), ensure `etc/qmanager/ping_profile.json` is included. If the installer uses `cp -r`, no change is needed.

- [ ] **Step 6: Verify the installer syntax**

```bash
bash -n install.sh
```

Expected: no syntax errors.

- [ ] **Step 7: Commit**

```bash
git add install.sh scripts/etc/qmanager/ping_profile.json
git commit -m "feat(installer): bootstrap ping_profile.json + migrate cycle-count env"
```

---

## Task 16: Update `qmanager_watchcat` for tri-state connectivity

**Files:**
- Modify: `scripts/usr/bin/qmanager_watchcat`

- [ ] **Step 1: Read the current `read_ping` function**

```bash
grep -n "read_ping\|ping_streak_fail\|ping_reachable" scripts/usr/bin/qmanager_watchcat
```

Capture lines 209–245 (the `read_ping` function) and the state machine entry around line 720–770. You'll need both for the next steps.

- [ ] **Step 2: Update `read_ping` to also capture connectivity**

In `scripts/usr/bin/qmanager_watchcat`, find the block that initializes ping variables (around line 211):

```sh
ping_streak_fail=0
ping_reachable="true"
ping_during_recovery="false"
```

Replace with:

```sh
ping_streak_fail=0
ping_reachable="true"
ping_during_recovery="false"
ping_connectivity="connected"
ping_limited_reason="null"
```

Then find the `read_ping()` function body. The current `_pdata` jq extraction reads 4 fields. Update it to 6 fields — the format mirrors the existing pattern exactly:

```sh
_pdata=$(jq -r '[
    (.timestamp | if . == null then "0" else tostring end),
    ((.streak_fail) | if . == null then "0" else tostring end),
    ((.reachable) | if . == null then "true" else tostring end),
    ((.during_recovery) | if . == null then "false" else tostring end),
    ((.connectivity) | if . == null then "disconnected" else tostring end),
    ((.limited_reason) | if . == null then "null" else tostring end)
] | @tsv' "$PING_CACHE" 2>/dev/null)
```

After the existing `cut -f` lines for the first four fields, add:

```sh
ping_connectivity=$(printf '%s' "$_pdata" | cut -f5)
ping_limited_reason=$(printf '%s' "$_pdata" | cut -f6)
```

- [ ] **Step 3: Update the state machine entry to skip recovery on `limited`**

Find the state machine entry block (around line 720–745). The current code:

```sh
case "$state" in
    monitor)
        if [ "$ping_streak_fail" -gt 0 ]; then
            prev_state="$state"
            state="suspect"
            failure_counter=1
            qlog_info "MONITOR → SUSPECT: streak_fail=$ping_streak_fail"
        fi
        ;;
```

Insert a new branch before this (matching existing indentation):

```sh
# Carrier intercept (limited) — recovery cannot help (modem reset, cfun
# toggle, SIM failover, reboot all leave the carrier intercept in place).
# Stay in monitor and clear any pending recovery flag.
if [ "$ping_connectivity" = "limited" ]; then
    if [ "$state" != "monitor" ]; then
        qlog_info "$state → MONITOR: carrier-limited (HTTP $ping_limited_reason); abandoning recovery"
        state="monitor"
        failure_counter=0
        rm -f "$RECOVERY_FLAG"
    elif [ -n "$ping_limited_reason" ] && [ "$ping_limited_reason" != "null" ]; then
        # First detection in monitor — log once
        if [ "${prev_limited_reason:-null}" = "null" ]; then
            qlog_info "MONITOR: carrier-limited (HTTP $ping_limited_reason); recovery suppressed"
        fi
    fi
    prev_limited_reason="$ping_limited_reason"
    write_state
    sleep "$CFG_CHECK_INTERVAL"
    continue
fi
prev_limited_reason="null"

case "$state" in
    monitor)
        ...
```

(The `prev_limited_reason` tracking prevents log-flooding while limited.)

- [ ] **Step 4: Verify the watchcat script still parses**

```bash
sh -n scripts/usr/bin/qmanager_watchcat
```

Expected: no output (clean).

- [ ] **Step 5: Smoke-test `read_ping` against a fixture**

Create a test fixture and source the relevant function. Run:

```bash
cat > /tmp/test_ping.json <<'EOF'
{"timestamp":1700000000,"streak_fail":0,"reachable":true,"during_recovery":false,"connectivity":"limited","limited_reason":200}
EOF

# Quick sanity check of the jq extraction
jq -r '[
    (.timestamp | if . == null then "0" else tostring end),
    ((.streak_fail) | if . == null then "0" else tostring end),
    ((.reachable) | if . == null then "true" else tostring end),
    ((.during_recovery) | if . == null then "false" else tostring end),
    ((.connectivity) | if . == null then "disconnected" else tostring end),
    ((.limited_reason) | if . == null then "null" else tostring end)
] | @tsv' /tmp/test_ping.json
```

Expected output (tab-separated):

```
1700000000	0	true	false	limited	200
```

- [ ] **Step 6: Commit**

```bash
git add scripts/usr/bin/qmanager_watchcat
git commit -m "feat(watchcat): suppress recovery while connectivity=limited"
```

---

## Task 17: Verify `qmanager_poller` does not need changes

**Files:**
- Inspect (no change): `scripts/usr/bin/qmanager_poller`

- [ ] **Step 1: Confirm the poller only reads backwards-compat fields**

```bash
grep -n -A 25 'read_ping_data()' scripts/usr/bin/qmanager_poller | head -60
```

Verify that the function reads only: `timestamp`, `interval_sec`, `last_rtt_ms`, `reachable`, `streak_success`, `streak_fail`, `during_recovery`, `targets`. No reference to `connectivity`, `streak_limited`, etc.

If the poller already reads only backwards-compat fields, no change is needed — the new daemon's JSON contains all expected fields with identical types.

**Out of scope for this plan:** Forwarding `connectivity` / `limited_reason` / `down_reason` into `/tmp/qmanager_status.json` for frontend consumption is part of the future Network Status badge UI work, not this daemon phase. The daemon ships standalone — frontend cannot read the new fields from `status.json` until that follow-up phase. This plan does NOT modify `qmanager_poller`.

---

## Task 18: Replace the test harness

**Files:**
- Delete: `scripts/test/qmanager-ping-probe.sh`
- Create: `scripts/test/qmanager-ping-smoke.sh`

- [ ] **Step 1: Delete the old shell extractor harness**

```bash
git rm scripts/test/qmanager-ping-probe.sh
```

The Rust unit + integration tests (run via `cargo test`) cover everything this harness used to verify. We replace it with a minimal on-device smoke test.

- [ ] **Step 2: Write the new smoke harness**

Create `scripts/test/qmanager-ping-smoke.sh`:

```bash
#!/bin/sh
# Workstation/on-device smoke test for the Rust qmanager_ping binary.
# Stops the systemd service, runs the binary against a local stub HTTP server
# and a fake carrier file, then validates the JSON output.
#
# Run on the device or in WSL2 with the binary built. Requires: jq, python3.
set -eu

if ! command -v jq >/dev/null; then
    echo "FAIL: jq not found" >&2
    exit 1
fi
if ! command -v python3 >/dev/null; then
    echo "FAIL: python3 not found (install with: opkg install python3-light)" >&2
    exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="${PING_BIN:-$REPO_ROOT/scripts/usr/bin/qmanager_ping}"
if [ ! -x "$BIN" ]; then
    echo "FAIL: $BIN not executable" >&2
    exit 1
fi

WORK=$(mktemp -d)
trap 'cleanup' EXIT INT TERM
cleanup() {
    [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null || true
    [ -n "${DAEMON_PID:-}" ] && kill -9 "$DAEMON_PID" 2>/dev/null || true
    rm -rf "$WORK"
}

CACHE="$WORK/cache.json"
HIST="$WORK/hist"
PID="$WORK/pid"
RELOAD="$WORK/reload"
RECOVERY="$WORK/recovery"
CARRIER="$WORK/carrier"
echo 1 > "$CARRIER"

# Tiny always-204 server
python3 -c '
import http.server, socketserver, sys
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(204); self.send_header("Content-Length","0"); self.end_headers()
    def log_message(self, *a, **k): pass
with socketserver.TCPServer(("127.0.0.1", 18204), H) as s:
    s.serve_forever()
' &
SERVER_PID=$!
sleep 0.5

# NOTE: the Rust daemon hardcodes /tmp/qmanager_ping.json, /tmp/qmanager_ping_history,
# /tmp/qmanager_ping.pid, etc. This smoke runs against those production paths —
# stop the live qmanager-ping service first if it's running on this host, and
# expect /tmp/qmanager_ping.json to be overwritten by the test cycles.
# Run this smoke on a dev machine (WSL2) or on a device where the service is stopped.

PING_INTERVAL=1 \
FAIL_SECS=3 \
RECOVER_SECS=2 \
INTERCEPT_SECS=4 \
HISTORY_SECS=10 \
PING_TARGET_1="http://127.0.0.1:18204/" \
PING_TARGET_2="http://127.0.0.1:18204/" \
CARRIER_FILE="$CARRIER" \
"$BIN" >/tmp/qping_smoke.log 2>&1 &
DAEMON_PID=$!

sleep 4

if [ ! -f /tmp/qmanager_ping.json ]; then
    echo "FAIL: /tmp/qmanager_ping.json was not created"
    exit 1
fi

CONN=$(jq -r .connectivity /tmp/qmanager_ping.json)
RTT_TYPE=$(jq -r '.last_rtt_ms | type' /tmp/qmanager_ping.json)
TCP_REUSED=$(jq -r .tcp_reused /tmp/qmanager_ping.json)
PROFILE=$(jq -r .profile /tmp/qmanager_ping.json)

[ "$CONN" = "connected" ] || { echo "FAIL: connectivity=$CONN expected connected"; exit 1; }
[ "$RTT_TYPE" = "number" ] || { echo "FAIL: last_rtt_ms type=$RTT_TYPE expected number"; exit 1; }
[ "$TCP_REUSED" = "true" ] || echo "WARN: tcp_reused=$TCP_REUSED (may be ok on first cycle, but should flip true within 4s)"
[ "$PROFILE" = "custom" ] || { echo "FAIL: profile=$PROFILE expected custom (env overrides)"; exit 1; }
echo "PASS: connected path"

# Flip carrier to 0
echo 0 > "$CARRIER"
sleep 4

CONN=$(jq -r .connectivity /tmp/qmanager_ping.json)
DOWN=$(jq -r .down_reason /tmp/qmanager_ping.json)
[ "$CONN" = "disconnected" ] || { echo "FAIL: connectivity=$CONN expected disconnected"; exit 1; }
[ "$DOWN" = "carrier_down" ] || { echo "FAIL: down_reason=$DOWN expected carrier_down"; exit 1; }
echo "PASS: disconnected path"

echo
echo "All smoke checks passed."
```

- [ ] **Step 3: Make it executable and check syntax**

```bash
chmod +x scripts/test/qmanager-ping-smoke.sh
sh -n scripts/test/qmanager-ping-smoke.sh
```

Expected: no syntax errors.

- [ ] **Step 4: Run the smoke test on dev machine (WSL2)**

```bash
bash scripts/test/qmanager-ping-smoke.sh
```

Expected output ending with:

```
PASS: connected path
PASS: disconnected path

All smoke checks passed.
```

If the binary is the ARMv7 version (cannot run on x86_64), build a host-target debug binary first and override `PING_BIN`:

```bash
cd ping-daemon && cargo build
PING_BIN=$(pwd)/target/debug/qmanager_ping bash ../scripts/test/qmanager-ping-smoke.sh
```

- [ ] **Step 5: Commit**

```bash
git add scripts/test/qmanager-ping-smoke.sh
git commit -m "test(ping-daemon): replace shell extractor with end-to-end smoke harness"
```

---

## Task 19: Add crate README

**Files:**
- Create: `ping-daemon/README.md`

- [ ] **Step 1: Write the README**

Create `ping-daemon/README.md`:

````markdown
# qmanager-ping (Rust)

Static ARMv7 binary for the QManager unified ping daemon. Replaces the POSIX shell daemon at `/usr/bin/qmanager_ping` with a single-process design that does HTTP/204 connectivity probing with persistent TCP keep-alive across cycles.

## Why this exists

The shell daemon forks `curl` per probe (~5 forks/cycle) and pays a fresh TCP handshake every time, so the reported `last_rtt_ms` is dominated by handshake latency, not actual round-trip time. This binary keeps one TCP connection open per target and reuses it across probes — the `last_rtt_ms` you see is real network RTT.

It also distinguishes three connectivity states (instead of two):

- `connected` — got HTTP 204
- `limited` — got HTTP non-204 (carrier billing / cap / activation intercept)
- `disconnected` — TCP failure or carrier link down

## Build

Requires the standard Rust toolchain plus the ARMv7-musl cross-compilation target.

```bash
rustup target add armv7-unknown-linux-musleabihf
sudo apt install gcc-arm-linux-gnueabihf

bash build-ping-daemon.sh        # release, stripped
bash build-ping-daemon.sh --debug
```

Output goes to `../scripts/usr/bin/qmanager_ping`. The QManager installer picks it up from there.

**Do not UPX-compress.** Rust ARM binaries packed with UPX segfault on exit. Same rule as `atcli_smd11`. The build script intentionally does not call upx.

## Test

Pure Rust unit + integration tests (no device required):

```bash
cargo test -- --test-threads=1
```

`--test-threads=1` is required because the config tests mutate process-global env vars.

End-to-end smoke (binary spawns a real systemd-style process, talks to a local Python stub server, validates JSON output):

```bash
bash ../scripts/test/qmanager-ping-smoke.sh
```

## Configuration

The daemon reads, in priority order:

1. Env vars (`PING_INTERVAL`, `FAIL_SECS`, `RECOVER_SECS`, `INTERCEPT_SECS`, `HISTORY_SECS`, `PING_TARGET_1`, `PING_TARGET_2`, `CARRIER_FILE`, `PING_PROFILE`)
2. `/etc/qmanager/ping_profile.json`
3. Hardcoded relaxed-profile defaults (5s/15s/10s/8s)

Profiles:

| Profile | interval | fail | recover | intercept | history |
|---|---|---|---|---|---|
| sensitive | 1s | 6s | 3s | 8s | 300s |
| regular | 2s | 10s | 6s | 8s | 300s |
| relaxed | 5s | 15s | 10s | 8s | 300s |
| quiet | 10s | 30s | 20s | 8s | 600s |

Reload at runtime: write a new `/etc/qmanager/ping_profile.json` and `touch /tmp/qmanager_ping_reload`. The daemon picks up the change at the start of the next probe cycle without restarting; streak counters survive.

## Outputs

- `/tmp/qmanager_ping.json` — atomic JSON cache, read by `qmanager_poller` and `qmanager_watchcat`.
- `/tmp/qmanager_ping_history` — flat-file ring buffer of RTTs, read by `qmanager_poller` for stats.
- `/tmp/qmanager.log` — appended log lines (qlog format).
- `/tmp/qmanager_ping.pid` — singleton guard.

## Architecture

See `docs/superpowers/specs/2026-05-09-rust-ping-daemon-design.md` for the full design.
````

- [ ] **Step 2: Commit**

```bash
git add ping-daemon/README.md
git commit -m "docs(ping-daemon): add crate README with build + test + config"
```

---

## Task 20: Final verification — full test sweep

**Files:**
- None (verification only)

- [ ] **Step 1: Run all Rust tests**

```bash
cd ping-daemon && cargo test -- --test-threads=1
```

Expected: ~47 tests across all modules, all passing.

- [ ] **Step 2: Build release ARMv7 binary, verify size and static linking**

```bash
bash ping-daemon/build-ping-daemon.sh
file scripts/usr/bin/qmanager_ping
ls -la scripts/usr/bin/qmanager_ping
```

Expected:
- `ARM, EABI5, statically linked`
- Size ≤ 500 KB
- Mode 0755

- [ ] **Step 3: Run on-device smoke**

If you have access to the target device, scp the binary and run:

```bash
scp -O scripts/usr/bin/qmanager_ping root@<device>:/tmp/qmanager_ping.new
ssh root@<device> 'systemctl stop qmanager-ping && mv /tmp/qmanager_ping.new /usr/bin/qmanager_ping && chmod +x /usr/bin/qmanager_ping && systemctl start qmanager-ping'
ssh root@<device> 'sleep 5 && cat /tmp/qmanager_ping.json | jq'
```

Expected: valid JSON with `connectivity`, `tcp_reused`, `profile` fields all populated.

If no device is available, the WSL2 smoke test from Task 18 covers the same surface.

- [ ] **Step 4: Confirm no fork(2) syscalls during steady-state**

On the device, after the daemon has been running for at least 30s:

```bash
ssh root@<device> 'strace -e trace=fork,clone,vfork -p $(pidof qmanager_ping) -c 2>&1 &
sleep 60
kill %1' | tail -20
```

Expected: zero `fork`/`clone`/`vfork` events recorded over 60s. (The daemon may emit `clone` once at startup for the signal-handling thread, but the steady-state loop must be fork-free.)

- [ ] **Step 5: Final commit (if anything was tweaked during verification)**

```bash
git status
# If changes — commit them; otherwise nothing to do.
```

---

## Self-review checklist (already performed)

**Spec coverage:** Every section of the spec maps to a task:

- Spec §1 (architecture) → Tasks 1, 2, 12 (scaffolding + main wiring)
- Spec §2 (keep-alive) → Task 11 (probe module)
- Spec §3 (tri-state outcomes) → Task 11 (ProbeOutcome enum), Task 6 (state machine consumes them)
- Spec §4 (state machine) → Task 6
- Spec §5 (output contract) → Task 8 (cache writer schema)
- Spec §6 (config + reload) → Task 4 (config), Task 9 (reload), Task 12 (main applies reload)
- Spec §7 (watchcat coordination) → Task 16
- Spec §8 (migration) → Task 15
- Spec §9 (build & deploy) → Tasks 2, 13, 14, 15
- Spec §10 (error handling) → covered in Tasks 11, 12 (probe + main fan-in)
- Spec §11 (testing) → Tasks 3–11 (unit per module), Task 11 (integration via stub server in same module), Task 18 (smoke)

**Type consistency:** verified — `ProbeOutcome` used identically in `probe.rs` and consumed in `main.rs`; `Connectivity` shared between `state.rs` and `cache.rs` via `crate::state::Connectivity`; `Thresholds` constructed in `main.rs` from `ProfileConfig::*_threshold_cycles()`.

**Placeholder scan:** no TODOs, no "implement later". Task 17 Step 2 is explicitly optional with rationale; not a placeholder.

**Frequent commits:** 19 commits across 19 tasks (one per task) — frequent, atomic, each independently testable.
