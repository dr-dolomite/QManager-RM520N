# qmanager-ping (Rust)

Static ARMv7 binary for the QManager unified ping daemon. Replaces the POSIX shell daemon at `/usr/bin/qmanager_ping` with a single-process design that does HTTP/204 connectivity probing with persistent TCP keep-alive across cycles.

## Why this exists

The shell daemon forks `curl` per probe (~5 forks/cycle) and pays a fresh TCP handshake every time, so the reported `last_rtt_ms` is dominated by handshake latency, not actual round-trip time. This binary keeps one TCP connection open per target and reuses it across probes — the `last_rtt_ms` you see is real network RTT.

It also distinguishes three connectivity states (instead of two):

- `connected` — got HTTP 204
- `limited` — got HTTP non-204 (carrier billing / cap / activation intercept)
- `disconnected` — network failure (timeout, connection refused/reset, DNS failure, or malformed response)

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

1. Env vars (`PING_INTERVAL`, `FAIL_SECS`, `RECOVER_SECS`, `INTERCEPT_SECS`, `HISTORY_SECS`, `PING_TARGET_1`, `PING_TARGET_2`, `PING_PROFILE`)
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

The full design was written up as a local working note (not tracked in the repo).
