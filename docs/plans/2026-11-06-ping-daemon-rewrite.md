# Plan: port the rewritten `qmanager_ping` to RM520N

Status: **done** — option A, device-verified on RM520N-GL `61368cd2` and merged to `development` 2026-11-07 (`eaf4e036`); figures in `docs/reference/connection-quality.md` > Measured on hardware. Large change: the daemon feeds the watchdog, alerts, poller and dashboard.

Source: RM551E `development-home` merge `bd8f42d0` (`scripts/usr/bin/qmanager_ping`, `docs/plans/ping-daemon-rewrite.md`).

## What changes, what stays

| Weakness on RM520N today | Fix |
|---|---|
| 4 legs run one after another (12–13 s worst case) | Leg 1 alone; on failure the other legs run **in parallel** (`wait`), winner by fixed priority |
| History truncated on every winner change (wipes loss % and jitter) | Never truncated; lines become `<rtt\|null> <leg>`; jitter only between consecutive samples of the same leg |
| 3 forking clock reads per cycle, plus ~10 forks of grep/cut/awk/jq | `/proc/uptime` via `read`; `parse_rtt` in builtins; `ping.json` written with `printf` (also removes the jq-before-`/opt`-mounts gap at boot) |
| Debounce timed from the END of the first failing cycle | Timed from its START |
| 1 s sleep floor, integer sleep | Fractional sleep, 0.2 s floor (falls back to integer if the device's `sleep` refuses fractions) |

Kept as is: the config file and its keys, the CGI, the profile table (`15/20/30/60` fail secs), reload flag, PID/trap discipline, the detached DNS sampler, `qm_timeout` from `platform.sh`, the `ping.json` keys. Added keys: `cycle_ms` (last real cycle period). RM520N has no `ping.env` sidecar and none is added.

## Your call: what leg 1 is

RM520N stores four user targets (`target_host_1/2`, `target_ip_1/2`); RM551E had two and used built-in alternates. Three ways to map them:

- **A (recommended) — keep the hostname-first order.** Leg 1 = `target_host_1` (under `qm_timeout 4`, since `ping -w` does not bound the lookup). On failure, `target_host_2`, `target_ip_1` and `target_ip_2` run in parallel; priority host_2 > ip_1 > ip_2. Worst case ~8 s (4 s hung lookup + 4 s fan-out), under the 15 s stale floor. **No UI, CGI, config or copy change**: the Probe Targets card's "Leg N answering" / "DNS not resolving" chips stay true. Keeps the documented reason hostnames come first: the resolver picks IPv4 or IPv6, so a v6-only bearer works with zero config. Cost: a healthy cycle still does one DNS lookup (no on-device cache), and the latency series follows whatever address the resolver returns.
- **B — IPv4 literal first.** Leg 1 = `target_ip_1` (`ping -c1 -W2 -w3`); fan-out ip_2, host_1, host_2. DNS-independent verdict and a stable latency series (RM551E parity). Needs a UI change: card order and chip logic (slot 1 = healthy, any other = "primary not answering"), new copy in all 5 catalogs. On a v6-only bearer the chip would read as a warning permanently.
- **C — drop the hostname legs** (RM551E's exact design, with built-in IPv6 literal legs). Removes two UI fields and two config keys; needs a config migration. Not recommended.

Built-in IPv6 literal legs (RM551E's P6/S6) are **left out** under A and B: the hostname legs already reach IPv6, and a winner that is not one of the user's four slots would show the card's "unknown" chip.

## Files (build order, one commit each)

1. `scripts/usr/bin/qmanager_ping` — new daemon, ported from RM551E and fitted to RM520N's JSON config, profile table, `qm_timeout`, four slots, and RM520N's 1–2 line comment rule. Fan-out scratch dir `mktemp -d /tmp/qmanager_ping_fan.XXXXXX` (root 0700, safe in sticky `/tmp`; removed at start and by the trap). Uninstall gains `rm -rf /tmp/qmanager_ping_fan.*`, since its `rm -f /tmp/qmanager_*` skips directories. Also: if `jq` is not mounted yet at boot, the config is re-loaded on the first cycle where it is.
2. `scripts/usr/bin/qmanager_poller` — stats awk reads `$1`, same-leg jitter, history array emits `$1`; drop the truncation comment (~line 368).
3. `scripts/usr/lib/qmanager/wd_quality.sh` — history awk reads `$1`; drop the truncation comment.
4. Gate: `grep -rn qmanager_ping_history scripts tools` shows no other `$0` reader. The watchcat needs no change (its down wait already uses the wall-clock `fail_elapsed_sec`). `conn_state.sh` needs no change.
5. Docs: `docs/reference/connection-quality.md` (cycle, history format, budget, measured figures), router row wording if needed, `RELEASE_NOTES.md` Improvements bullet.

## Validation

- Static: CRLF check, BusyBox ash audit (no multi-var `local`, octal guards, traps end in `exit`, leg jobs reset traps), `bash -n` / `sh -n`.
- Blind `qm-verifier` pass on the diff.
- On the RM520N: first read-only probes (iputils `ping -w`, fractional `sleep`, `/var/run/qmanager` ownership, live config and history), then deploy to `/usr/bin` with `sync` + md5 check, keeping the old files in `/tmp/qm_ping_backup/`:
  1. Healthy: one probe per cycle, period = interval, dashboard latency/jitter/loss normal.
  2. Leg-1 failure: temporarily set `target_host_1` to an unresolvable/unreachable value → a fan-out leg wins in ~4–8 s, `reachable` stays true, history not truncated.
  3. Total outage: temporary iptables rule dropping ICMP out of `rmnet+` only (LAN SSH unaffected), with a detached 300 s failsafe delete. Measure time-to-fail and recover for `relaxed` and `sensitive`; check the watchcat sees the streak.
  4. Restore config, remove the rule, kill the failsafe, touch the reload flag.

**Approving this plan approves:** deploying the new daemon + poller + `wd_quality.sh` to the RM520N, restarting `qmanager-ping` and the poller service, the temporary `target_host_1` edit in step 2 and the temporary ICMP-drop rule in step 3. Nothing else.

## Risks and rollback

- A missed `$0` history reader shows garbage: the grep gate above.
- Orphan leg jobs on TERM mid-fan-out: the trap kills their pids and removes the scratch dir.
- Rollback: `git revert` the merge; on the device restore from `/tmp/qm_ping_backup/` and restart the two services.

## Execution

Worktree `.claude/worktrees/ping-daemon-rewrite` on branch `feat/ping-daemon-rewrite` from `development` (merge-base checked). No auto-merge; end with branch + status.
