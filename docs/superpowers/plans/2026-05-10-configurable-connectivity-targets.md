# Configurable Connectivity Targets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken alternating-target probe logic with a primary-then-fallback strategy, swap defaults to Cloudflare-primary/Google-secondary, expose target inputs in the Connectivity Sensitivity UI, and add HTTPS support so a user can type `youtube.com` and have it work.

**Architecture:**
1. **Daemon (Rust):** Add `rustls`+`webpki-roots` for HTTPS. Replace `pick_target` (alternating) with `probe_with_fallback` (primary first; secondary only on primary-fail). Normalize bare hostnames to `https://host/`. Auto-detect captive-portal semantics by path.
2. **Config:** Targets become first-class JSON fields in `/etc/qmanager/ping_profile.json`, written by the CGI from the UI. Daemon resolution order stays env > JSON > defaults; we drop the `Environment=PING_TARGET_*` lines from the systemd unit so JSON wins.
3. **CGI:** Extend `ping_profile.sh` to read/write `target_1` and `target_2` with strict validation.
4. **UI:** Add two URL inputs (Primary / Secondary) inside the existing `ConnectivitySensitivityCard`, sharing its single Save button. Reset-to-default button restores Cloudflare/Google.

**Tech Stack:**
- Rust 1.x (existing `qmanager_ping`); new deps `rustls = "0.23"`, `webpki-roots = "0.26"`, `rustls-pki-types = "1"`
- BusyBox `sh` + `jq` (existing CGI)
- React + TypeScript + shadcn/ui (existing frontend)

**Out of scope:**
- Cross-region default selection (one default for all users; user can edit).
- IPv6-specific behavior (reuses current `to_socket_addrs` resolution).
- Migrating users mid-outage — daemon picks up changes on its next probe cycle (1–10s).

---

## File Structure

**Files to create:**
- `ping-daemon/src/url.rs` — URL parsing/normalization (extracted; gains HTTPS + bare-hostname support)
- `ping-daemon/src/tls_dial.rs` — Thin rustls wrapper for HTTPS dial+handshake

**Files to modify:**
- `ping-daemon/Cargo.toml` — add rustls + webpki-roots
- `ping-daemon/src/probe.rs` — switch to URL-aware dial (HTTP or HTTPS), captive-portal vs custom-URL response semantics
- `ping-daemon/src/main.rs` — replace `pick_target` with `probe_with_fallback`
- `ping-daemon/src/config.rs` — add `target_1`/`target_2` to `ProfileJson`, normalize on load
- `scripts/www/cgi-bin/quecmanager/settings/ping_profile.sh` — read/write target fields with validation
- `scripts/etc/systemd/system/qmanager-ping.service` — remove `Environment=PING_TARGET_*` lines (JSON now drives this)
- `scripts/etc/qmanager/ping_profile.json` — add Cloudflare-primary / Google-secondary defaults to bootstrap file
- `hooks/use-ping-profile.ts` — extend `PingProfileSettings` with `target_1`/`target_2`
- `components/system-settings/connection-quality/connectivity-sensitivity-card.tsx` — add target inputs + reset
- `scripts/test/ping-profile-cgi.sh` — add target validation cases
- `scripts/test/qmanager-ping-smoke.sh` — exercise primary-fallback + HTTPS path
- `docs/BACKEND.md` and `docs/API-REFERENCE.md` — document new endpoint shape

**Files to read for context (do not modify):**
- `ping-daemon/src/state.rs` — state machine; unchanged but consumes new outcome semantics
- `scripts/usr/bin/qmanager_poller` lines 1080–1100 — how `connectivity` block is built
- `types/modem-status.ts` — `PingProfile`, `ConnectivityStatus` types

---

## Migration Notes (read before starting)

1. The systemd unit currently sets `Environment=PING_TARGET_1=http://www.gstatic.com/generate_204` (line 18) and `Environment=PING_TARGET_2=http://cp.cloudflare.com/` (line 19). **These env vars override JSON** by the resolution order in `config.rs:117–134`. Both lines must be removed in Task 7 — otherwise the UI changes are silently ignored.
2. Existing devices may have a `ping_profile.json` without `target_1`/`target_2` fields. The new daemon must treat missing fields as "use hardcoded defaults" — already handled by `Option<String>` deserialization once Task 3 lands.
3. The `EnvironmentFile=-/etc/qmanager/environment` line (line 21) stays — operators who set `PING_TARGET_1=` there still win. This is the documented escape hatch.
4. Daemon picks up JSON changes via `RELOAD_FLAG` at `/tmp/qmanager_ping_reload` (already wired). No restart needed for target changes.

---

## Task 1: Add rustls dependency and verify cross-compile build

**Files:**
- Modify: `ping-daemon/Cargo.toml`

- [ ] **Step 1: Add rustls and webpki-roots dependencies**

Edit `ping-daemon/Cargo.toml`, adding to the `[dependencies]` block:

```toml
[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
libc = "0.2"
signal-hook = "0.3"
rustls = { version = "0.23", default-features = false, features = ["std", "tls12", "ring"] }
webpki-roots = "0.26"
rustls-pki-types = "1"
```

Rationale: `default-features = false` excludes `aws-lc-rs` (which needs C toolchain). `ring` is pure Rust assembly + C, builds cleanly for ARMv7. `tls12` enables TLS 1.2 (the GFW occasionally interferes less with TLS 1.2 than 1.3 fingerprints, and not all targets run TLS 1.3 yet).

- [ ] **Step 2: Verify compile**

Run: `cd ping-daemon && cargo check`
Expected: `Finished ... profile [unoptimized + debuginfo]` with no errors. Lockfile updated.

- [ ] **Step 3: Verify the binary still runs in tests**

Run: `cd ping-daemon && cargo test --lib`
Expected: All existing tests pass. Output ends with `test result: ok.`

- [ ] **Step 4: Commit**

```bash
git add ping-daemon/Cargo.toml ping-daemon/Cargo.lock
git commit -m "feat(ping-daemon): add rustls for HTTPS probe support"
```

---

## Task 2: Extract URL parsing into `url.rs` with HTTPS and bare-hostname support

**Files:**
- Create: `ping-daemon/src/url.rs`
- Modify: `ping-daemon/src/probe.rs` (remove inline `parse_http_url`)
- Modify: `ping-daemon/src/main.rs` (declare `mod url`)

**Behavior contract:**
- `https://example.com/x` → `{ scheme: Https, host: "example.com", port: 443, path: "/x", is_canonical_204: false }`
- `http://gstatic.com/generate_204` → `{ scheme: Http, host: "gstatic.com", port: 80, path: "/generate_204", is_canonical_204: true }`
- `youtube.com` → normalize to `https://youtube.com/`
- `youtube.com/foo` → normalize to `https://youtube.com/foo`
- ` ` (whitespace) / empty → `None`
- `ftp://x` / unknown scheme → `None`

`is_canonical_204 = path matches /generate_204 or /hotspot-detect.html (case-insensitive)`. This drives response-code interpretation downstream.

- [ ] **Step 1: Write `url.rs` with failing tests**

Create `ping-daemon/src/url.rs`:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Scheme { Http, Https }

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedUrl {
    pub scheme: Scheme,
    pub host: String,
    pub port: u16,
    pub path: String,
    /// True when path matches a known captive-portal probe endpoint
    /// (`/generate_204` or `/hotspot-detect.html`, case-insensitive).
    /// When true, response interpretation is strict (204=Connected, 200=Limited).
    /// When false, any 2xx/3xx/4xx/5xx response = Connected (custom URL semantics).
    pub is_canonical_204: bool,
}

/// Parse a target URL. Bare hostnames are normalized to https://.
/// Returns None for unparseable / unsupported-scheme inputs.
pub fn parse(input: &str) -> Option<ParsedUrl> {
    let trimmed = input.trim();
    if trimmed.is_empty() { return None; }

    let (scheme, rest) = if let Some(r) = trimmed.strip_prefix("https://") {
        (Scheme::Https, r)
    } else if let Some(r) = trimmed.strip_prefix("http://") {
        (Scheme::Http, r)
    } else if trimmed.contains("://") {
        // Unsupported scheme like ftp://
        return None;
    } else {
        // Bare hostname or host/path — default to https
        (Scheme::Https, trimmed)
    };

    let (host_part, path) = match rest.find('/') {
        Some(i) => (&rest[..i], rest[i..].to_string()),
        None => (rest, "/".to_string()),
    };

    let (host, port) = match host_part.rsplit_once(':') {
        Some((h, p)) => {
            let port: u16 = p.parse().ok()?;
            (h.to_string(), port)
        }
        None => (
            host_part.to_string(),
            match scheme { Scheme::Http => 80, Scheme::Https => 443 },
        ),
    };

    if host.is_empty() { return None; }

    let path_lower = path.to_ascii_lowercase();
    let is_canonical_204 =
        path_lower == "/generate_204" || path_lower == "/hotspot-detect.html";

    Some(ParsedUrl { scheme, host, port, path, is_canonical_204 })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn https_explicit() {
        let p = parse("https://example.com/x").unwrap();
        assert_eq!(p.scheme, Scheme::Https);
        assert_eq!(p.host, "example.com");
        assert_eq!(p.port, 443);
        assert_eq!(p.path, "/x");
        assert!(!p.is_canonical_204);
    }

    #[test]
    fn http_explicit_gstatic_is_canonical() {
        let p = parse("http://www.gstatic.com/generate_204").unwrap();
        assert_eq!(p.scheme, Scheme::Http);
        assert_eq!(p.port, 80);
        assert!(p.is_canonical_204);
    }

    #[test]
    fn apple_hotspot_is_canonical() {
        let p = parse("http://captive.apple.com/hotspot-detect.html").unwrap();
        assert!(p.is_canonical_204);
    }

    #[test]
    fn bare_hostname_defaults_https_and_root_path() {
        let p = parse("youtube.com").unwrap();
        assert_eq!(p.scheme, Scheme::Https);
        assert_eq!(p.host, "youtube.com");
        assert_eq!(p.port, 443);
        assert_eq!(p.path, "/");
    }

    #[test]
    fn bare_hostname_with_path() {
        let p = parse("youtube.com/foo").unwrap();
        assert_eq!(p.scheme, Scheme::Https);
        assert_eq!(p.path, "/foo");
    }

    #[test]
    fn bare_hostname_with_explicit_port() {
        let p = parse("example.com:8443/x").unwrap();
        assert_eq!(p.port, 8443);
        assert_eq!(p.scheme, Scheme::Https);
    }

    #[test]
    fn whitespace_trimmed() {
        let p = parse("  youtube.com  ").unwrap();
        assert_eq!(p.host, "youtube.com");
    }

    #[test]
    fn empty_returns_none() {
        assert!(parse("").is_none());
        assert!(parse("   ").is_none());
    }

    #[test]
    fn unsupported_scheme_returns_none() {
        assert!(parse("ftp://x").is_none());
        assert!(parse("file:///etc/passwd").is_none());
    }

    #[test]
    fn invalid_port_returns_none() {
        assert!(parse("example.com:abc").is_none());
    }

    #[test]
    fn canonical_match_is_case_insensitive() {
        let p = parse("http://x.com/Generate_204").unwrap();
        assert!(p.is_canonical_204);
    }
}
```

- [ ] **Step 2: Wire `url` module into the crate**

Edit `ping-daemon/src/main.rs`. Find the existing `mod` declarations near the top (around line 1–9) and add `mod url;`:

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
mod url;
```

- [ ] **Step 3: Run url tests, verify all pass**

Run: `cd ping-daemon && cargo test --lib url::`
Expected: 10 tests pass. `test result: ok. 10 passed`.

- [ ] **Step 4: Remove old inline `parse_http_url` from probe.rs**

In `ping-daemon/src/probe.rs`, delete lines 172–194 (`struct ParsedUrl` + `fn parse_http_url`). Also delete the four `parse_url_*` tests at lines 392–415 — they're now in `url.rs`.

- [ ] **Step 5: Update probe.rs to use `crate::url::parse`**

In `ping-daemon/src/probe.rs:48`, replace:

```rust
let parsed = match parse_http_url(url) {
    Some(p) => p,
    None => return ProbeOutcome::Disconnected { reason: DownReason::Malformed },
};
```

with:

```rust
let parsed = match crate::url::parse(url) {
    Some(p) => p,
    None => return ProbeOutcome::Disconnected { reason: DownReason::Malformed },
};
```

(Field names `host`, `port`, `path` are unchanged — the rest of `probe()` keeps working.)

- [ ] **Step 6: Run full daemon test suite, verify nothing regressed**

Run: `cd ping-daemon && cargo test --lib`
Expected: All tests pass (existing probe tests + new url tests).

- [ ] **Step 7: Commit**

```bash
git add ping-daemon/src/url.rs ping-daemon/src/main.rs ping-daemon/src/probe.rs
git commit -m "refactor(ping-daemon): extract URL parsing, add HTTPS + bare-hostname support"
```

---

## Task 3: Add `target_1` / `target_2` to JSON config

**Files:**
- Modify: `ping-daemon/src/config.rs`

- [ ] **Step 1: Write a failing test for JSON-driven targets**

Add this test inside the `mod tests` block at the end of `ping-daemon/src/config.rs`:

```rust
#[test]
fn json_targets_override_defaults() {
    clear_env();
    let p = write_temp_json(
        r#"{"profile":"relaxed","target_1":"https://1.1.1.1/","target_2":"http://example.com/"}"#,
    );
    let cfg = load(&p);
    assert_eq!(cfg.target_1, "https://1.1.1.1/");
    assert_eq!(cfg.target_2, "http://example.com/");
}

#[test]
fn missing_json_targets_keep_hardcoded_defaults() {
    clear_env();
    let p = write_temp_json(r#"{"profile":"regular"}"#);
    let cfg = load(&p);
    // Hardcoded defaults from ProfileConfig::relaxed() (Task 8 will swap these).
    assert_eq!(cfg.target_1, "http://www.gstatic.com/generate_204");
    assert_eq!(cfg.target_2, "http://cp.cloudflare.com/");
}

#[test]
fn env_target_still_beats_json() {
    clear_env();
    let p = write_temp_json(r#"{"target_1":"https://json.example/"}"#);
    std::env::set_var("PING_TARGET_1", "https://env.example/");
    let cfg = load(&p);
    assert_eq!(cfg.target_1, "https://env.example/");
    std::env::remove_var("PING_TARGET_1");
}
```

- [ ] **Step 2: Run tests, verify they fail with "no field target_1"**

Run: `cd ping-daemon && cargo test --lib config::tests::json_targets_override_defaults`
Expected: COMPILE ERROR — `ProfileJson` has no `target_1` field.

- [ ] **Step 3: Add `target_1` / `target_2` to `ProfileJson`**

In `ping-daemon/src/config.rs`, modify `struct ProfileJson` (lines 84–92):

```rust
#[derive(Debug, Deserialize)]
struct ProfileJson {
    profile: Option<String>,
    interval_sec: Option<u64>,
    fail_secs: Option<u64>,
    recover_secs: Option<u64>,
    intercept_secs: Option<u64>,
    history_secs: Option<u64>,
    target_1: Option<String>,
    target_2: Option<String>,
}
```

- [ ] **Step 4: Apply JSON target fields in `load()`**

In `ping-daemon/src/config.rs:108–114`, extend the `if let Some(j) = json.as_ref()` block:

```rust
    if let Some(j) = json.as_ref() {
        if let Some(v) = j.interval_sec { cfg.interval_sec = v; }
        if let Some(v) = j.fail_secs { cfg.fail_secs = v; }
        if let Some(v) = j.recover_secs { cfg.recover_secs = v; }
        if let Some(v) = j.intercept_secs { cfg.intercept_secs = v; }
        if let Some(v) = j.history_secs { cfg.history_secs = v; }
        if let Some(v) = j.target_1.as_ref() { cfg.target_1 = v.clone(); }
        if let Some(v) = j.target_2.as_ref() { cfg.target_2 = v.clone(); }
    }
```

(Env-var overrides for `PING_TARGET_1/2` at lines 132–133 stay — they correctly run after the JSON block, preserving env > JSON precedence.)

- [ ] **Step 5: Run tests, verify they pass**

Run: `cd ping-daemon && cargo test --lib config::`
Expected: All config tests pass including the three new ones.

- [ ] **Step 6: Commit**

```bash
git add ping-daemon/src/config.rs
git commit -m "feat(ping-daemon): accept target_1/target_2 in ping_profile.json"
```

---

## Task 4: Implement HTTPS probe via rustls

**Files:**
- Create: `ping-daemon/src/tls_dial.rs`
- Modify: `ping-daemon/src/probe.rs`
- Modify: `ping-daemon/src/main.rs` (declare `mod tls_dial`)

The current `KeepAliveClient` holds `HashMap<String, TcpStream>`. For HTTPS we need `HashMap<String, ConnectionState>` where `ConnectionState` is either a plain `TcpStream` or a `rustls::StreamOwned<rustls::ClientConnection, TcpStream>`.

- [ ] **Step 1: Write a failing test for HTTPS probe**

Add this test to `ping-daemon/src/probe.rs` inside `mod tests`:

```rust
#[test]
fn probe_https_url_against_real_server_returns_some_outcome() {
    // Network-dependent smoke test, gated by env to keep CI offline-friendly.
    if std::env::var("QMANAGER_TLS_TEST").is_err() {
        eprintln!("skipping HTTPS smoke test (set QMANAGER_TLS_TEST=1 to run)");
        return;
    }
    let mut c = KeepAliveClient::new(Duration::from_secs(5));
    let r = c.probe("https://www.cloudflare.com/");
    match r {
        ProbeOutcome::Connected { .. } | ProbeOutcome::Limited { .. } => {}
        other => panic!("expected Connected or Limited, got {:?}", other),
    }
}
```

- [ ] **Step 2: Create `tls_dial.rs` with rustls config helpers**

Create `ping-daemon/src/tls_dial.rs`:

```rust
use std::io;
use std::net::TcpStream;
use std::sync::Arc;
use std::time::Duration;

use rustls::pki_types::ServerName;
use rustls::{ClientConfig, ClientConnection, RootCertStore, StreamOwned};

/// Lazy global TLS config. Built once with webpki-roots trust anchors.
fn tls_config() -> Arc<ClientConfig> {
    use std::sync::OnceLock;
    static CFG: OnceLock<Arc<ClientConfig>> = OnceLock::new();
    CFG.get_or_init(|| {
        let mut roots = RootCertStore::empty();
        roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
        let config = ClientConfig::builder()
            .with_root_certificates(roots)
            .with_no_client_auth();
        Arc::new(config)
    }).clone()
}

/// Establish TLS over an existing TcpStream. Caller has already set R/W timeouts on `tcp`.
pub fn handshake(
    tcp: TcpStream,
    host: &str,
    timeout: Duration,
) -> io::Result<StreamOwned<ClientConnection, TcpStream>> {
    let server_name = ServerName::try_from(host.to_string())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "bad SNI host"))?;
    let conn = ClientConnection::new(tls_config(), server_name)
        .map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;
    // StreamOwned drives the handshake on first read/write — but we want to bound it.
    // The TcpStream's existing read/write timeout is what enforces the bound.
    let _ = timeout; // already enforced via tcp timeouts; param kept for symmetry with future tunables.
    Ok(StreamOwned::new(conn, tcp))
}
```

- [ ] **Step 3: Wire `tls_dial` module into the crate**

Add to `ping-daemon/src/main.rs` mod block:

```rust
mod tls_dial;
```

- [ ] **Step 4: Refactor `KeepAliveClient` to support both schemes**

Replace `ping-daemon/src/probe.rs` lines 36–82 (struct + `new` + `probe`). Full replacement:

```rust
use crate::url::Scheme;
use std::io;

/// Connection variant cached per host:port keep-alive bucket.
enum Conn {
    Plain(TcpStream),
    Tls(rustls::StreamOwned<rustls::ClientConnection, TcpStream>),
}

impl io::Read for Conn {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        match self {
            Conn::Plain(s) => s.read(buf),
            Conn::Tls(s) => s.read(buf),
        }
    }
}

impl io::Write for Conn {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        match self {
            Conn::Plain(s) => s.write(buf),
            Conn::Tls(s) => s.write(buf),
        }
    }
    fn flush(&mut self) -> io::Result<()> {
        match self {
            Conn::Plain(s) => s.flush(),
            Conn::Tls(s) => s.flush(),
        }
    }
}

pub struct KeepAliveClient {
    connections: HashMap<String, Conn>,
    timeout: Duration,
}

impl KeepAliveClient {
    pub fn new(timeout: Duration) -> Self {
        Self { connections: HashMap::new(), timeout }
    }

    /// Probe a target URL. Returns the outcome enum.
    pub fn probe(&mut self, url: &str) -> ProbeOutcome {
        let parsed = match crate::url::parse(url) {
            Some(p) => p,
            None => return ProbeOutcome::Disconnected { reason: DownReason::Malformed },
        };
        let host_port = format!("{}:{}", parsed.host, parsed.port);

        let start = Instant::now();
        let (mut conn, tcp_reused) = match self.connections.remove(&host_port) {
            Some(c) => (c, true),
            None => match self.dial(&parsed.host, &host_port, parsed.scheme) {
                Ok(c) => (c, false),
                Err(reason) => return ProbeOutcome::Disconnected { reason },
            },
        };

        if let Err(reason) = self.send_get(&mut conn, &parsed.host, &parsed.path) {
            if tcp_reused {
                let mut fresh = match self.dial(&parsed.host, &host_port, parsed.scheme) {
                    Ok(c) => c,
                    Err(r) => return ProbeOutcome::Disconnected { reason: r },
                };
                if let Err(r) = self.send_get(&mut fresh, &parsed.host, &parsed.path) {
                    return ProbeOutcome::Disconnected { reason: r };
                }
                return self.read_response(fresh, &host_port, parsed.is_canonical_204, start, false);
            }
            return ProbeOutcome::Disconnected { reason };
        }

        self.read_response(conn, &host_port, parsed.is_canonical_204, start, tcp_reused)
    }

    fn dial(&self, host: &str, host_port: &str, scheme: Scheme) -> Result<Conn, DownReason> {
        let addrs: Vec<_> = match host_port.to_socket_addrs() {
            Ok(it) => it.collect(),
            Err(_) => return Err(DownReason::Dns),
        };
        let addr = addrs.first().ok_or(DownReason::Dns)?;
        let stream = TcpStream::connect_timeout(addr, self.timeout).map_err(map_io_err)?;
        stream.set_read_timeout(Some(self.timeout)).ok();
        stream.set_write_timeout(Some(self.timeout)).ok();
        stream.set_nodelay(true).ok();
        match scheme {
            Scheme::Http => Ok(Conn::Plain(stream)),
            Scheme::Https => {
                let tls = crate::tls_dial::handshake(stream, host, self.timeout)
                    .map_err(map_io_err)?;
                Ok(Conn::Tls(tls))
            }
        }
    }

    fn send_get(&self, conn: &mut Conn, host: &str, path: &str) -> Result<(), DownReason> {
        let req = format!(
            "GET {} HTTP/1.1\r\nHost: {}\r\nConnection: keep-alive\r\nUser-Agent: qmanager-ping/0.1\r\nAccept: */*\r\n\r\n",
            path, host
        );
        conn.write_all(req.as_bytes()).map_err(map_io_err)?;
        Ok(())
    }
}
```

- [ ] **Step 5: Update `read_response` signature to take `is_canonical_204`**

Replace `read_response` in `ping-daemon/src/probe.rs` (the function starting around line 106). The signature changes from `stream: TcpStream` to `conn: Conn`, and gains an `is_canonical_204: bool` parameter that controls how the status code is mapped. Full replacement:

```rust
    fn read_response(
        &mut self,
        conn: Conn,
        host_port: &str,
        is_canonical_204: bool,
        start: Instant,
        tcp_reused: bool,
    ) -> ProbeOutcome {
        let mut reader = BufReader::new(conn);

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
        let conn = reader.into_inner();

        if !connection_close {
            self.connections.insert(host_port.to_string(), conn);
        }

        // Response interpretation:
        // - Canonical 204 endpoint (gstatic, apple): 204=Connected, 200=Limited (captive portal),
        //   anything else = Limited (treat as broken intercept).
        // - Custom URL (e.g. youtube.com): any HTTP response we read = Connected. The probe
        //   reaching this point already proves DNS+TCP+TLS+HTTP all worked end-to-end.
        if is_canonical_204 {
            if code == 204 {
                ProbeOutcome::Connected { rtt_ms, tcp_reused }
            } else {
                ProbeOutcome::Limited { rtt_ms, http_code: code, tcp_reused }
            }
        } else {
            ProbeOutcome::Connected { rtt_ms, tcp_reused }
        }
    }
}
```

- [ ] **Step 6: Update existing tests for new signature**

The existing `probe_204_*` and `probe_5xx_*` tests use HTTP-only stub server and should still work because the test URLs use `http://127.0.0.1/...`. The path `/204` in `probe_204_returns_connected_first_cycle_not_reused` is NOT canonical, so under the new semantics it would be `Connected` for any response. Update those tests:

In `ping-daemon/src/probe.rs`, replace the URL in `probe_204_returns_connected_first_cycle_not_reused` (line 308):
```rust
let url = format!("http://127.0.0.1:{}/generate_204", port);
```

Same in `probe_204_second_cycle_reuses_connection` (line 324):
```rust
let url = format!("http://127.0.0.1:{}/generate_204", port);
```

And in `probe_connection_close_drops_keepalive` (line 381):
```rust
let url = format!("http://127.0.0.1:{}/generate_204", port);
```

(`probe_200_with_html_returns_limited` and `probe_5xx_returns_limited` also need `/generate_204` paths since they assert `Limited` — under custom-URL semantics any 200/502 would be `Connected`. Fix both.)

For `probe_200_with_html_returns_limited` (line 343):
```rust
let url = format!("http://127.0.0.1:{}/generate_204", port);
```

For `probe_5xx_returns_limited` (line 354):
```rust
let url = format!("http://127.0.0.1:{}/generate_204", port);
```

Add a NEW test that verifies custom-URL semantics:

```rust
#[test]
fn probe_custom_url_treats_200_as_connected() {
    let body = "<html>youtube</html>";
    let resp = format!(
        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nContent-Type: text/html\r\n\r\n{}",
        body.len(), body
    );
    let leaked: &'static str = Box::leak(resp.into_boxed_str());
    let (port, _stop) = spawn_server(vec![leaked]);
    let mut c = KeepAliveClient::new(Duration::from_secs(2));
    // Path "/" is NOT canonical → custom URL semantics → 200 = Connected
    let url = format!("http://127.0.0.1:{}/", port);
    match c.probe(&url) {
        ProbeOutcome::Connected { .. } => {}
        other => panic!("expected Connected for custom URL 200, got {:?}", other),
    }
}

#[test]
fn probe_custom_url_treats_502_as_connected() {
    let resp = "HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n";
    let (port, _stop) = spawn_server(vec![resp]);
    let mut c = KeepAliveClient::new(Duration::from_secs(2));
    let url = format!("http://127.0.0.1:{}/", port);
    match c.probe(&url) {
        // Network worked — server is the broken party. We're online.
        ProbeOutcome::Connected { .. } => {}
        other => panic!("expected Connected for custom URL 502, got {:?}", other),
    }
}
```

- [ ] **Step 7: Build and run all tests**

Run: `cd ping-daemon && cargo test --lib`
Expected: All tests pass. Includes new custom-URL tests, all existing probe tests still pass with `/generate_204` paths.

- [ ] **Step 8: Optional — exercise live HTTPS once**

Run: `cd ping-daemon && QMANAGER_TLS_TEST=1 cargo test --lib probe_https_url_against_real_server -- --nocapture`
Expected: PASS, returning `Connected` from a real cloudflare.com HTTPS handshake. (Skip if no network.)

- [ ] **Step 9: Commit**

```bash
git add ping-daemon/src/tls_dial.rs ping-daemon/src/main.rs ping-daemon/src/probe.rs
git commit -m "feat(ping-daemon): probe HTTPS URLs via rustls; auto-detect captive vs custom"
```

---

## Task 5: Replace alternating probe with primary-then-fallback

**Files:**
- Modify: `ping-daemon/src/main.rs`

The current `pick_target` toggles between target_1 and target_2 each tick. We replace it with `probe_with_fallback` which probes target_1 first; if the outcome is `Disconnected`, we immediately probe target_2 in the same tick and use its outcome instead. The reported `probe_target_used` reflects which target produced the final outcome.

- [ ] **Step 1: Remove `pick_target` and `target_index` state**

In `ping-daemon/src/main.rs`:

Delete line 65 (`let mut target_index = 0u8;`).
Delete lines 165–169 (`fn pick_target`).

- [ ] **Step 2: Replace probe-pick block with fallback logic**

In `main.rs`, replace lines 86–93 (the `let (target, outcome) = ...` block). New version:

```rust
        let (target, outcome) = if !carrier::is_up(&cfg.carrier_file) {
            log.debug("carrier=0, skipping probe");
            (None, ProbeOutcome::Disconnected { reason: probe::DownReason::CarrierDown })
        } else {
            // Primary first; if Disconnected, fallback to secondary in the same tick.
            // Limited / Connected from primary skips the secondary probe (saves data).
            let primary_outcome = client.probe(&cfg.target_1);
            match &primary_outcome {
                ProbeOutcome::Disconnected { .. } => {
                    log.debug(&format!(
                        "primary {} failed, trying secondary {}",
                        cfg.target_1, cfg.target_2,
                    ));
                    let secondary_outcome = client.probe(&cfg.target_2);
                    match &secondary_outcome {
                        ProbeOutcome::Connected { .. } | ProbeOutcome::Limited { .. } => {
                            (Some(cfg.target_2.clone()), secondary_outcome)
                        }
                        ProbeOutcome::Disconnected { .. } => {
                            // Both failed — report primary's reason for clearer debugging.
                            (Some(cfg.target_1.clone()), primary_outcome)
                        }
                    }
                }
                _ => (Some(cfg.target_1.clone()), primary_outcome),
            }
        };
```

- [ ] **Step 3: Verify build**

Run: `cd ping-daemon && cargo build --release`
Expected: Builds successfully. No `target_index` / `pick_target` references remain.

- [ ] **Step 4: Run existing main-loop integration paths**

Run: `cd ping-daemon && cargo test --lib`
Expected: All tests pass. (No new tests for this change; the unit test layer is in `state.rs` which is unchanged. Live behavior is verified by the smoke test in Task 11.)

- [ ] **Step 5: Commit**

```bash
git add ping-daemon/src/main.rs
git commit -m "feat(ping-daemon): replace alternating targets with primary-fallback strategy"
```

---

## Task 6: Swap default targets — Cloudflare primary, Google secondary

**Files:**
- Modify: `ping-daemon/src/config.rs`
- Modify: `scripts/etc/qmanager/ping_profile.json`

- [ ] **Step 1: Update hardcoded defaults**

In `ping-daemon/src/config.rs:26–27`, swap the order:

```rust
            target_1: "http://cp.cloudflare.com/".into(),
            target_2: "http://www.gstatic.com/generate_204".into(),
```

- [ ] **Step 2: Update the corresponding test in config.rs**

The test `missing_json_targets_keep_hardcoded_defaults` from Task 3 needs its assertions flipped:

```rust
#[test]
fn missing_json_targets_keep_hardcoded_defaults() {
    clear_env();
    let p = write_temp_json(r#"{"profile":"regular"}"#);
    let cfg = load(&p);
    assert_eq!(cfg.target_1, "http://cp.cloudflare.com/");
    assert_eq!(cfg.target_2, "http://www.gstatic.com/generate_204");
}
```

- [ ] **Step 3: Update the bootstrap JSON shipped to fresh installs**

Replace `scripts/etc/qmanager/ping_profile.json` contents:

```json
{
  "profile": "relaxed",
  "interval_sec": 5,
  "fail_secs": 15,
  "recover_secs": 10,
  "intercept_secs": 8,
  "history_secs": 300,
  "target_1": "http://cp.cloudflare.com/",
  "target_2": "http://www.gstatic.com/generate_204"
}
```

- [ ] **Step 4: Run tests**

Run: `cd ping-daemon && cargo test --lib config::`
Expected: All config tests pass with the new defaults.

- [ ] **Step 5: Commit**

```bash
git add ping-daemon/src/config.rs scripts/etc/qmanager/ping_profile.json
git commit -m "feat(ping-daemon): default to cloudflare-primary, google-secondary targets"
```

---

## Task 7: Drop `Environment=PING_TARGET_*` from systemd unit

**Files:**
- Modify: `scripts/etc/systemd/system/qmanager-ping.service`

- [ ] **Step 1: Remove the two PING_TARGET environment lines**

Edit `scripts/etc/systemd/system/qmanager-ping.service`. Delete lines 18 and 19:

```
Environment=PING_TARGET_1=http://www.gstatic.com/generate_204
Environment=PING_TARGET_2=http://cp.cloudflare.com/
```

Keep:
- `Environment=CARRIER_FILE=/sys/class/net/rmnet_data0/carrier` (line 20)
- `EnvironmentFile=-/etc/qmanager/environment` (line 21) — this is the documented operator escape hatch

- [ ] **Step 2: Update the comment block above to reflect target precedence**

Replace lines 9–17 (the `# Targets and the carrier sysfs path...` comment block) with:

```
# Carrier sysfs path is the only target/device-config that lives here.
# All probe targets and timing knobs (PING_TARGET_1, PING_TARGET_2,
# PING_PROFILE, PING_INTERVAL, FAIL_SECS, RECOVER_SECS, INTERCEPT_SECS,
# HISTORY_SECS) are intentionally NOT set here: the daemon's resolution
# order is env > JSON > hardcoded defaults (see ping-daemon/src/config.rs),
# so any inline Environment= here would beat /etc/qmanager/ping_profile.json
# written by the Connectivity Sensitivity UI. The daemon's hardcoded
# defaults (Cloudflare primary, Google secondary; relaxed profile) cover
# fresh boots before the JSON exists. Operators who genuinely need a
# manual override can drop values into /etc/qmanager/environment.
```

- [ ] **Step 3: Sanity-check syntax**

Run: `grep -nE '^(Environment|ExecStart|Type|After|EnvironmentFile)=' "scripts/etc/systemd/system/qmanager-ping.service"`
Expected: Only `Environment=CARRIER_FILE=...`, `EnvironmentFile=-/etc/qmanager/environment`, `ExecStart=/usr/bin/qmanager_ping`, `Type=simple`, `After=...`. No more `PING_TARGET_*`.

- [ ] **Step 4: Commit**

```bash
git add scripts/etc/systemd/system/qmanager-ping.service
git commit -m "chore(ping-daemon): remove PING_TARGET_* env from unit; JSON-driven now"
```

---

## Task 8: Extend CGI to read/write target_1 and target_2

**Files:**
- Modify: `scripts/www/cgi-bin/quecmanager/settings/ping_profile.sh`

**URL validation rules (server-side):**
- Reject empty / whitespace-only.
- Length limit: 256 chars (defense against pathological input).
- Allowed character classes: `[A-Za-z0-9._:/?#@!$&'()*+,;=~%-]` (URL-safe set; covers IDN punycoded hosts).
- Reject any input containing `\x00`, `\n`, `\r`, backtick, `$(`, `;`, `|`, `&` outside the allowlist (paranoia layer; jq's `--arg` already prevents shell injection but we want to fail fast and obviously).
- Trust the daemon's `url::parse` for scheme/host validation — CGI only enforces the safe-character + length contract.

- [ ] **Step 1: Replace the GET handler block**

In `scripts/www/cgi-bin/quecmanager/settings/ping_profile.sh`, replace lines 31–47 (the `if [ "$REQUEST_METHOD" = "GET" ]` block) with:

```sh
if [ "$REQUEST_METHOD" = "GET" ]; then
    qlog_info "Fetching ping profile selection"

    profile="relaxed"
    target_1="http://cp.cloudflare.com/"
    target_2="http://www.gstatic.com/generate_204"

    if [ -f "$CONFIG" ]; then
        v=$(jq -r '.profile // empty' "$CONFIG" 2>/dev/null) || v=""
        case "$v" in
            sensitive|regular|relaxed|quiet) profile="$v" ;;
            *) qlog_warn "ping_profile.json had unexpected profile value '$v', returning default" ;;
        esac

        t1=$(jq -r '.target_1 // empty' "$CONFIG" 2>/dev/null) || t1=""
        t2=$(jq -r '.target_2 // empty' "$CONFIG" 2>/dev/null) || t2=""
        [ -n "$t1" ] && target_1="$t1"
        [ -n "$t2" ] && target_2="$t2"
    fi

    jq -n \
        --arg profile "$profile" \
        --arg target_1 "$target_1" \
        --arg target_2 "$target_2" \
        '{success: true, settings: {profile: $profile, target_1: $target_1, target_2: $target_2}}'
    exit 0
fi
```

- [ ] **Step 2: Add a URL validator helper above the POST handler**

Insert this validator function above line 49 (the `# POST` comment):

```sh
# Validate a target URL string. Echoes the trimmed input on success, prints
# error and returns 1 on failure. Used by both target_1 and target_2.
validate_target_url() {
    local label="$1"
    local raw="$2"

    # Strip leading/trailing whitespace
    local trimmed
    trimmed=$(printf '%s' "$raw" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')

    if [ -z "$trimmed" ]; then
        echo "${label} cannot be empty"
        return 1
    fi

    # Length cap
    if [ ${#trimmed} -gt 256 ]; then
        echo "${label} exceeds 256 characters"
        return 1
    fi

    # Reject control chars + shell metacharacters not in URL-safe set
    case "$trimmed" in
        *[\`\$\(\)\;\|\&\<\>\"\\]*)
            echo "${label} contains disallowed characters"
            return 1
            ;;
    esac

    # Allow only URL-safe charset (RFC 3986 reserved + unreserved + percent + IDN-friendly)
    if printf '%s' "$trimmed" | LC_ALL=C grep -qE '[^A-Za-z0-9._:/?#@!$%&'"'"'()*+,;=~-]'; then
        echo "${label} contains invalid characters"
        return 1
    fi

    printf '%s' "$trimmed"
    return 0
}
```

- [ ] **Step 3: Replace the POST handler block**

Replace lines 52–100 (the `if [ "$REQUEST_METHOD" = "POST" ]` block through `cgi_success; exit 0`) with:

```sh
if [ "$REQUEST_METHOD" = "POST" ]; then
    cgi_read_post

    ACTION=$(printf '%s' "$POST_DATA" | jq -r '.action // empty' 2>/dev/null)
    if [ -z "$ACTION" ]; then
        cgi_error "missing_action" "action field is required"
        exit 0
    fi

    if [ "$ACTION" != "save_settings" ]; then
        cgi_error "unknown_action" "Unknown action: $ACTION"
        exit 0
    fi

    new_profile=$(printf '%s' "$POST_DATA" | jq -r '.profile // empty' 2>/dev/null)
    case "$new_profile" in
        sensitive|regular|relaxed|quiet) ;;
        *)
            cgi_error "invalid_profile" "profile must be one of: sensitive, regular, relaxed, quiet"
            exit 0
            ;;
    esac

    new_t1_raw=$(printf '%s' "$POST_DATA" | jq -r '.target_1 // empty' 2>/dev/null)
    new_t2_raw=$(printf '%s' "$POST_DATA" | jq -r '.target_2 // empty' 2>/dev/null)

    # Both targets are required on every save (kept idempotent + simple).
    if ! new_t1=$(validate_target_url "target_1" "$new_t1_raw"); then
        cgi_error "invalid_target" "$new_t1"
        exit 0
    fi
    if ! new_t2=$(validate_target_url "target_2" "$new_t2_raw"); then
        cgi_error "invalid_target" "$new_t2"
        exit 0
    fi

    mkdir -p "$(dirname "$CONFIG")"

    if ! jq -n \
        --arg profile "$new_profile" \
        --arg target_1 "$new_t1" \
        --arg target_2 "$new_t2" \
        '{profile: $profile, target_1: $target_1, target_2: $target_2}' \
        > "${CONFIG}.tmp"; then
        rm -f "${CONFIG}.tmp"
        cgi_error "write_failed" "Failed to generate config JSON"
        exit 0
    fi

    if ! mv "${CONFIG}.tmp" "$CONFIG"; then
        rm -f "${CONFIG}.tmp"
        cgi_error "write_failed" "Failed to write config file"
        exit 0
    fi

    qlog_info "Ping profile saved: profile=$new_profile target_1=$new_t1 target_2=$new_t2"

    if ! touch "$RELOAD_FLAG" 2>/dev/null; then
        qlog_warn "Failed to touch reload flag at $RELOAD_FLAG (daemon may not reload until restart)"
    fi

    cgi_success
    exit 0
fi
```

- [ ] **Step 4: Update existing CGI test fixture**

Open `scripts/test/ping-profile-cgi.sh`. Find the test cases that POST a profile, and update them to include `target_1` and `target_2` since they are now required. For example, a test that posts `{"action":"save_settings","profile":"regular"}` should now post `{"action":"save_settings","profile":"regular","target_1":"http://cp.cloudflare.com/","target_2":"http://www.gstatic.com/generate_204"}`.

Add three new test cases at the bottom of the file (above any final `echo "All ping-profile CGI tests passed"`):

```sh
# ─── Target validation: empty target rejected ───────────────────────────────
echo "TEST: empty target_1 rejected"
resp=$(REQUEST_METHOD=POST CONTENT_LENGTH=99 \
    bash -c 'echo -n "{\"action\":\"save_settings\",\"profile\":\"relaxed\",\"target_1\":\"\",\"target_2\":\"http://x/\"}" | "'"$CGI_SCRIPT"'"')
echo "$resp" | grep -q '"error":"invalid_target"' || { echo "FAIL: expected invalid_target error, got: $resp"; exit 1; }

# ─── Target validation: shell-injection attempt rejected ────────────────────
echo "TEST: shell metacharacter in target rejected"
resp=$(REQUEST_METHOD=POST CONTENT_LENGTH=99 \
    bash -c 'echo -n "{\"action\":\"save_settings\",\"profile\":\"relaxed\",\"target_1\":\"http://x/\\\";rm -rf /tmp\",\"target_2\":\"http://y/\"}" | "'"$CGI_SCRIPT"'"')
echo "$resp" | grep -q '"error":"invalid_target"' || { echo "FAIL: expected invalid_target error, got: $resp"; exit 1; }

# ─── Target validation: bare hostname accepted ──────────────────────────────
echo "TEST: bare hostname accepted"
resp=$(REQUEST_METHOD=POST CONTENT_LENGTH=99 \
    bash -c 'echo -n "{\"action\":\"save_settings\",\"profile\":\"relaxed\",\"target_1\":\"youtube.com\",\"target_2\":\"google.com\"}" | "'"$CGI_SCRIPT"'"')
echo "$resp" | grep -q '"success":true' || { echo "FAIL: expected success, got: $resp"; exit 1; }
```

- [ ] **Step 5: Run the CGI smoke test**

Run: `bash scripts/test/ping-profile-cgi.sh`
Expected: `All ping-profile CGI tests passed` (or equivalent existing success line). Three new tests pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/www/cgi-bin/quecmanager/settings/ping_profile.sh scripts/test/ping-profile-cgi.sh
git commit -m "feat(cgi): expose target_1/target_2 in ping_profile endpoint"
```

---

## Task 9: Extend frontend hook to carry target fields

**Files:**
- Modify: `hooks/use-ping-profile.ts`

- [ ] **Step 1: Update the response interface**

In `hooks/use-ping-profile.ts:20–23`, replace `interface PingProfileSettings`:

```ts
interface PingProfileSettings {
  profile: PingProfile;
  target_1: string;
  target_2: string;
}
```

- [ ] **Step 2: Update the `UsePingProfileReturn` interface**

Replace `interface UsePingProfileReturn` (lines 31–38):

```ts
export interface UsePingProfileReturn {
  profile: PingProfile | undefined;
  target1: string | undefined;
  target2: string | undefined;
  isLoading: boolean;
  error: string | null;
  isSaving: boolean;
  saveError: string | null;
  save: (settings: {
    profile: PingProfile;
    target_1: string;
    target_2: string;
  }) => Promise<PingProfileResponse>;
}
```

- [ ] **Step 3: Update the hook body to track target state**

Replace the hook function body (lines 42–145). Full replacement:

```ts
export function usePingProfile(): UsePingProfileReturn {
  const [profile, setProfile] = useState<PingProfile | undefined>(undefined);
  const [target1, setTarget1] = useState<string | undefined>(undefined);
  const [target2, setTarget2] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchProfile = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    setError(null);

    try {
      const resp = await authFetch(ENDPOINT);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const json: PingProfileResponse = await resp.json();
      if (!mountedRef.current) return;

      if (!json.success || !json.settings) {
        throw new Error(json.detail ?? json.error ?? "Failed to load profile");
      }

      setProfile(json.settings.profile);
      setTarget1(json.settings.target_1);
      setTarget2(json.settings.target_2);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load profile");
    } finally {
      if (mountedRef.current && !silent) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const save = useCallback(
    async (settings: {
      profile: PingProfile;
      target_1: string;
      target_2: string;
    }): Promise<PingProfileResponse> => {
      setSaveError(null);
      setIsSaving(true);

      try {
        const resp = await authFetch(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "save_settings",
            profile: settings.profile,
            target_1: settings.target_1,
            target_2: settings.target_2,
          }),
        });

        const json: PingProfileResponse = await resp.json();
        if (!mountedRef.current) return json;

        if (!json.success) {
          throw new Error(json.detail ?? json.error ?? "Save failed");
        }

        setProfile(settings.profile);
        setTarget1(settings.target_1);
        setTarget2(settings.target_2);
        fetchProfile(true);

        return json;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Save failed";
        if (mountedRef.current) setSaveError(msg);
        throw err;
      } finally {
        if (mountedRef.current) setIsSaving(false);
      }
    },
    [fetchProfile],
  );

  return {
    profile,
    target1,
    target2,
    isLoading,
    error,
    isSaving,
    saveError,
    save,
  };
}
```

- [ ] **Step 4: Type-check**

Run: `bunx tsc --noEmit`
Expected: No type errors. (Compilation will surface the breaking change in `connectivity-sensitivity-card.tsx` — that's Task 10. We expect that one error.)

- [ ] **Step 5: Commit**

```bash
git add hooks/use-ping-profile.ts
git commit -m "feat(hooks): extend usePingProfile to carry target_1/target_2"
```

---

## Task 10: Add target inputs to ConnectivitySensitivityCard

**Files:**
- Modify: `components/system-settings/connection-quality/connectivity-sensitivity-card.tsx`

**UI design:**
- Add a new section below the active-profile meta panel and above the daemon-stuck warning. Heading: "Probe Targets". Subtext: "Primary is checked first. Secondary is only used if primary fails."
- Two `Input` components labeled "Primary URL" and "Secondary URL", placeholder showing `youtube.com or https://example.com/`.
- A small "Reset to defaults" link/button below the inputs (sets fields back to `http://cp.cloudflare.com/` / `http://www.gstatic.com/generate_204`).
- Client-side validation: nonempty, ≤256 chars, no spaces in middle. Mirrors server-side rules to prevent obvious-error round-trips.
- Save button (existing) saves profile + both targets in a single POST. `isDirty` now includes target changes.

- [ ] **Step 1: Add imports for Input + helpers**

In `components/system-settings/connection-quality/connectivity-sensitivity-card.tsx`, add to the imports near the top (after the `Tabs` import):

```tsx
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { RotateCcwIcon } from "lucide-react";
```

- [ ] **Step 2: Add default target constants and a client-side validator**

After `STUCK_THRESHOLD_MS` (around line 76), add:

```tsx
const DEFAULT_TARGET_1 = "http://cp.cloudflare.com/";
const DEFAULT_TARGET_2 = "http://www.gstatic.com/generate_204";

function validateTargetClient(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "URL cannot be empty";
  if (trimmed.length > 256) return "URL too long (max 256 characters)";
  if (/\s/.test(trimmed)) return "URL cannot contain spaces";
  if (/[`$();|<>"\\]/.test(trimmed)) return "URL contains disallowed characters";
  return null;
}
```

- [ ] **Step 3: Wire target state and dirty detection**

In the component body, replace the existing destructuring of `usePingProfile` (around line 87) and the local-state block (lines 92–103). The new block:

```tsx
  const {
    profile,
    target1,
    target2,
    isLoading,
    error,
    isSaving,
    saveError,
    save,
  } = usePingProfile();
  const { data: modemStatus } = useModemStatus();
  const { saved, markSaved } = useSaveFlash();

  const [selected, setSelected] = useState<PingProfile | undefined>(profile);
  const [target1Input, setTarget1Input] = useState<string>("");
  const [target2Input, setTarget2Input] = useState<string>("");
  const [target1Err, setTarget1Err] = useState<string | null>(null);
  const [target2Err, setTarget2Err] = useState<string | null>(null);
  const initializedRef = useRef(false);

  // When the saved settings arrive, sync local state once.
  useEffect(() => {
    if (
      profile !== undefined &&
      target1 !== undefined &&
      target2 !== undefined &&
      !initializedRef.current
    ) {
      setSelected(profile);
      setTarget1Input(target1);
      setTarget2Input(target2);
      initializedRef.current = true;
    }
  }, [profile, target1, target2]);
```

- [ ] **Step 4: Update `isDirty` and `canSave` to include target changes**

Replace the `isDirty` memo (around lines 110–113) and `canSave` (line 115):

```tsx
  const isDirty = useMemo(() => {
    if (!profile || selected === undefined) return false;
    if (selected !== profile) return true;
    if (target1 !== undefined && target1Input !== target1) return true;
    if (target2 !== undefined && target2Input !== target2) return true;
    return false;
  }, [profile, selected, target1, target1Input, target2, target2Input]);

  const hasValidationErrors = target1Err !== null || target2Err !== null;
  const canSave = isDirty && !isSaving && !hasValidationErrors;
```

- [ ] **Step 5: Update the save handler**

Replace `handleSave` (around lines 141–155):

```tsx
  const handleSave = async () => {
    if (!canSave || !selected) return;
    // Re-validate at submit time
    const e1 = validateTargetClient(target1Input);
    const e2 = validateTargetClient(target2Input);
    setTarget1Err(e1);
    setTarget2Err(e2);
    if (e1 || e2) return;

    try {
      await save({
        profile: selected,
        target_1: target1Input.trim(),
        target_2: target2Input.trim(),
      });
      markSaved();
      lastSavedAtRef.current = Date.now();
      lastSavedProfileRef.current = selected;
      setStuckHint(false);
      setSaveCount((c) => c + 1);
      toast.success("Connectivity settings updated");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to save";
      toast.error(msg);
    }
  };
```

- [ ] **Step 6: Add target-input section to JSX**

After the active-profile `MetaPanel` `motion.div` block (around line 263, just before the daemon-stuck banner block), insert:

```tsx
          {/* ── Probe target inputs ──────────────────────────────────── */}
          <motion.div variants={staggerItem} className="grid gap-3 pt-2 border-t border-border/50">
            <div>
              <p className="text-sm font-medium">Probe Targets</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Primary is checked first. Secondary is only used if primary fails. URLs without a scheme default to https.
              </p>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="target-primary">Primary URL</Label>
              <Input
                id="target-primary"
                value={target1Input}
                onChange={(e) => {
                  setTarget1Input(e.target.value);
                  setTarget1Err(validateTargetClient(e.target.value));
                }}
                placeholder="youtube.com or https://example.com/"
                aria-invalid={target1Err !== null}
                aria-describedby={target1Err ? "target-primary-err" : undefined}
              />
              {target1Err && (
                <p id="target-primary-err" className="text-xs text-destructive">
                  {target1Err}
                </p>
              )}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="target-secondary">Secondary URL (fallback)</Label>
              <Input
                id="target-secondary"
                value={target2Input}
                onChange={(e) => {
                  setTarget2Input(e.target.value);
                  setTarget2Err(validateTargetClient(e.target.value));
                }}
                placeholder="cloudflare.com or http://example.com/generate_204"
                aria-invalid={target2Err !== null}
                aria-describedby={target2Err ? "target-secondary-err" : undefined}
              />
              {target2Err && (
                <p id="target-secondary-err" className="text-xs text-destructive">
                  {target2Err}
                </p>
              )}
            </div>

            <div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setTarget1Input(DEFAULT_TARGET_1);
                  setTarget2Input(DEFAULT_TARGET_2);
                  setTarget1Err(null);
                  setTarget2Err(null);
                }}
              >
                <RotateCcwIcon className="size-3 mr-1.5" />
                Reset to defaults
              </Button>
            </div>
          </motion.div>
```

- [ ] **Step 7: Type-check the frontend**

Run: `bunx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 8: Commit**

```bash
git add components/system-settings/connection-quality/connectivity-sensitivity-card.tsx
git commit -m "feat(ui): expose probe target URLs in Connectivity Sensitivity card"
```

---

## Task 11: Update smoke test to exercise primary-fallback and HTTPS

**Files:**
- Modify: `scripts/test/qmanager-ping-smoke.sh`

The current smoke test uses `PING_TARGET_1=PING_TARGET_2=http://127.0.0.1:18204/`. We add a second case where target_1 is a deliberately unreachable port (forces fallback) and target_2 is the working stub, asserting the daemon still reports Connected.

- [ ] **Step 1: Read the existing smoke test**

Open and read `scripts/test/qmanager-ping-smoke.sh` to understand the current stub-server-on-127.0.0.1 fixture (look for the python/socat/nc-based stub HTTP server it spawns).

- [ ] **Step 2: Add a fallback-path test case**

Add a new test scenario at the bottom of the file (above any final `echo` summary line):

```sh
# ─── Test: primary unreachable, fallback succeeds ───────────────────────────
echo "TEST: primary down → fallback to secondary"

# Reuse same stub server on port 18204 from the earlier setup.
# Point primary at port 18203 (no listener) so it always fails.
PING_TARGET_1="http://127.0.0.1:18203/" \
PING_TARGET_2="http://127.0.0.1:18204/generate_204" \
PING_INTERVAL=1 \
FAIL_SECS=10 \
RECOVER_SECS=2 \
CARRIER_FILE="$CARRIER_STUB" \
timeout 6 "$BIN" &
DAEMON_PID=$!
sleep 4

# Cache should report reachable=true because secondary works.
reachable=$(jq -r '.reachable' /tmp/qmanager_ping.json)
target_used=$(jq -r '.probe_target_used' /tmp/qmanager_ping.json)

kill "$DAEMON_PID" 2>/dev/null
wait "$DAEMON_PID" 2>/dev/null

if [ "$reachable" != "true" ]; then
    echo "FAIL: expected reachable=true with working fallback, got $reachable"
    exit 1
fi

if [ "$target_used" != "http://127.0.0.1:18204/generate_204" ]; then
    echo "FAIL: expected probe_target_used to be the secondary, got $target_used"
    exit 1
fi

echo "PASS: fallback to secondary works"
```

- [ ] **Step 3: Run the smoke test on the dev host (Linux/WSL)**

Run: `bash scripts/test/qmanager-ping-smoke.sh`
Expected: All scenarios pass, including the new fallback test.

(If running on Windows: skip and run during integration on the device. Note this in the task closeout.)

- [ ] **Step 4: Commit**

```bash
git add scripts/test/qmanager-ping-smoke.sh
git commit -m "test(ping-daemon): cover primary-fallback path in smoke test"
```

---

## Task 12: Documentation pass

**Files:**
- Modify: `docs/BACKEND.md`
- Modify: `docs/API-REFERENCE.md`
- Modify: `RELEASE_NOTES.md`

- [ ] **Step 1: Update `docs/BACKEND.md`**

Find the section that documents the ping daemon (search for "ping_profile.json" or "qmanager_ping"). Update the section describing config keys to include `target_1` and `target_2`. Add a note that targets are JSON-driven now (env-only override), and that the daemon supports HTTPS and bare hostnames.

Specifically, add a subsection:

```markdown
### Probe Targets

The ping daemon checks two targets in a primary-then-fallback strategy. Primary is probed every interval; secondary is only probed when primary returns `Disconnected`.

Both targets accept:
- Full URL: `https://example.com/path` or `http://example.com/path`
- Bare hostname: `youtube.com` (auto-prefixed to `https://youtube.com/`)
- Hostname with path: `example.com/health` → `https://example.com/health`

**Response interpretation:**
- For canonical captive-portal endpoints (`/generate_204`, `/hotspot-detect.html`): 204 = Connected, anything else = Limited (probable captive portal intercept).
- For custom URLs: any HTTP response (2xx–5xx) = Connected — the network path worked end-to-end. Limited state only triggers from canonical endpoints.

**Defaults:** `http://cp.cloudflare.com/` (primary), `http://www.gstatic.com/generate_204` (secondary).

**Why these defaults:** Cloudflare's captive portal endpoint is reachable from most regions including networks that filter Google services (e.g. mainland China). Google's `gstatic` is the established fallback for everywhere else.
```

- [ ] **Step 2: Update `docs/API-REFERENCE.md`**

Find the section documenting `/cgi-bin/quecmanager/settings/ping_profile.sh`. Update the GET response example and the POST request example to include `target_1` and `target_2` fields. Add validation rules (nonempty, ≤256 chars, no shell metacharacters).

- [ ] **Step 3: Add a release-notes entry**

In `RELEASE_NOTES.md`, find the most recent version's "New Features" section (or add one before "Improvements" per project convention). Add this bullet:

```markdown
- **Configurable connectivity probe targets.** The connectivity engine now exposes Primary and Secondary URLs in System Settings → Connectivity Sensitivity. Defaults to Cloudflare-primary and Google-secondary so installs in regions that block Google still come up clean. Targets accept full URLs (`https://...`, `http://...`) or bare hostnames (e.g. `youtube.com`) which default to HTTPS. The probe now uses primary-then-fallback instead of alternating, so a single broken endpoint can never lock the device in a "failed" state.
```

- [ ] **Step 4: Commit**

```bash
git add docs/BACKEND.md docs/API-REFERENCE.md RELEASE_NOTES.md
git commit -m "docs: document configurable probe targets and HTTPS support"
```

---

## Task 13: End-to-end manual verification on device

**Files:** none (deployment + manual test)

- [ ] **Step 1: Cross-compile the daemon for ARMv7**

Run the project's existing cross-compile workflow (the same one that produces `scripts/usr/bin/qmanager_ping`). Confirm binary size growth is acceptable (~600 KB → ~2 MB expected).

- [ ] **Step 2: Deploy to a dev device**

SCP the new `qmanager_ping` binary, the updated CGI script, the updated systemd unit, and the new bootstrap `ping_profile.json`. Restart the service.

```bash
scp -O ping-daemon/target/armv7-unknown-linux-musleabihf/release/qmanager_ping root@<device>:/usr/bin/
scp -O scripts/www/cgi-bin/quecmanager/settings/ping_profile.sh root@<device>:/usrdata/qmanager/www/cgi-bin/quecmanager/settings/
scp -O scripts/etc/systemd/system/qmanager-ping.service root@<device>:/lib/systemd/system/
ssh root@<device> 'mount -o remount,rw / && systemctl daemon-reload && systemctl restart qmanager-ping && mount -o remount,ro /'
```

- [ ] **Step 3: Verify defaults apply on first boot**

SSH in, check the cache:

```bash
ssh root@<device> 'cat /tmp/qmanager_ping.json | jq .targets'
```

Expected: `["http://cp.cloudflare.com/", "http://www.gstatic.com/generate_204"]`

- [ ] **Step 4: Verify HTTPS probe works**

Manually edit JSON to use HTTPS:

```bash
ssh root@<device> 'mount -o remount,rw / && cat > /etc/qmanager/ping_profile.json <<EOF
{
  "profile": "regular",
  "target_1": "https://www.cloudflare.com/",
  "target_2": "https://www.google.com/"
}
EOF
mount -o remount,ro /
touch /tmp/qmanager_ping_reload'
```

Wait 5s, then check:

```bash
ssh root@<device> 'cat /tmp/qmanager_ping.json | jq "{reachable, last_rtt_ms, probe_target_used}"'
```

Expected: `reachable: true`, sane RTT, `probe_target_used: "https://www.cloudflare.com/"`.

- [ ] **Step 5: Verify bare hostname works via UI**

Open the QManager web UI → System Settings → Connectivity Sensitivity. Type `youtube.com` in Primary URL, leave Secondary as default. Save. Wait 5s, then on the device:

```bash
ssh root@<device> 'cat /tmp/qmanager_ping.json | jq .targets'
ssh root@<device> 'cat /tmp/qmanager_ping.json | jq .reachable'
```

Expected: targets reflect the saved values, reachable is `true`.

- [ ] **Step 6: Verify primary-fallback works**

Set primary to a deliberately broken URL:

```bash
# Via UI: Primary = "https://this-host-does-not-exist-1234.example/"
# Secondary = "https://www.cloudflare.com/"
```

Wait 10s, then:

```bash
ssh root@<device> 'cat /tmp/qmanager_ping.json | jq "{reachable, probe_target_used, down_reason}"'
```

Expected: `reachable: true`, `probe_target_used` is the secondary (cloudflare), `down_reason: null`.

- [ ] **Step 7: Restore device to defaults via UI**

Click "Reset to defaults" in the UI, save. Verify cache reports the Cloudflare/Google pair again.

- [ ] **Step 8: Document any deviations**

If any step failed, capture the error in this plan as a comment and address before merging. Otherwise, no commit needed for this task — it's verification only.

---

## Self-Review Notes

**Spec coverage:**
- Recommendation #1 (stop alternating, primary-fallback) → Task 5
- Recommendation #2 (Cloudflare primary, Google secondary defaults) → Task 6 + 7 + 8 (CGI + systemd + bootstrap JSON all aligned)
- Recommendation #3 (UI configurable) → Tasks 8, 9, 10
- Recommendation #4 (HTTPS support, bare hostnames "just work") → Tasks 1, 2, 4

**Open decisions (already confirmed with user):**
- Probe strategy: primary-then-fallback ✓
- Bare hostname default scheme: HTTPS ✓
- TLS lib: rustls + webpki-roots ✓
- Response semantics: auto-detect by URL pattern (canonical 204 endpoints keep strict semantics; custom URLs treat any HTTP response as Connected) ✓

**Risks / things to watch during implementation:**
- Binary size growth from rustls. Acceptable per discussion (~600 KB → ~2 MB).
- TLS handshake adds 200-500ms RTT. Won't trip fail thresholds in any profile (interval 1s minimum, fail 6s minimum).
- `probe_with_fallback` doubles probe traffic when primary is down. Mitigated: secondary only fires on Disconnected (not Limited), and the fallback only persists while primary is broken — once primary recovers, secondary is skipped again.
- Captive-portal detection now ONLY works for canonical endpoints. If user replaces both targets with custom URLs, the daemon loses ability to flag "Limited" intercepts. Documented in Task 12.

---

**Plan complete.**
