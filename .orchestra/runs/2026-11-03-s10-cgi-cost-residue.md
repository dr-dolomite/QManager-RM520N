# S10 — CGI cost residue (lighttpd keep-alive, settings/about one-shots)
status: DONE 2026-11-03 (L1), portability SAFE TO SHIP, verifier FAIL on 2 unlisted diffs (pending user)   base: development @ 69604a63   branch: claude/s10-cgi-cost-residue-b2cf85

Base note: the worktree was cut from `main` (7a7007c1, 1090 commits behind); reset to `development` before any write.

## Device state (RM520N-GL 61368cd2, serial checked before every run, 2026-11-03 08:53–09:10 PST)
- v0.1.18-draft. `lighttpd.conf`, `system/settings.sh`, `device/about.sh` md5 = `development` (7be9512c…, 5d926aab…, e082edfe…).
- Live config already has `server.max-keep-alive-idle = 30` (R5, 354112ac). R3 already cut `settings.sh` (57→15 forks) and added the 300 s public-IP cache in `about.sh`.
- A real browser (192.168.225.86) was using the UI during the first window. A root-owned session file `ce7f0c7a…` appeared at 09:03:29 that is not mine (my sessions are www-data and removed on exit), so lighttpd-counter runs after that may include another client's requests. The decision numbers below are therefore from direct www-data runs, which are isolated.

## 1. lighttpd keep-alive — CLOSED, no change
Method: `/tmp/s10/ka.sh`, `/tmp/s10/idle.sh`; lighttpd own = utime+stime of the lighttpd pid, CGI = cutime+cstime; 10 ms ticks.

| probe | result |
|---|---|
| idle timeout (one `openssl s_client` connection, HEAD at 0 / +3 / +28 s, then idle) | all 3 answered on one connection; server closed it **31 s** after the last request → 30 s idle live |
| real browser (passive, 120 s) | its one connection closed ≈ 30 s after its last request |
| lighttpd own per request, fresh TLS connection (3 × 20) | **20.0–20.5 ms** |
| lighttpd own per request, reused connection (3 × 20) | **2.0–2.5 ms** |
| 6 idle TLS connections held 23 s | **0 ticks** (holding a connection costs nothing; epoll) |
| 6 handshakes | 11 ticks ≈ 18 ms each (no session resumption: upper bound for a browser) |

With 30 s idle, every dashboard stream (5 s / 10 s / 30 s) reuses its connection. Steady TLS cost with the dashboard open ≈ 0.6 req/s × 2.5 ms ≈ **0.15 pts**, plus at most one handshake per 30 s idle gap (≈ 0.06 pts). Before R5 (5 s idle) the upper bound was 1.1 pts. Nothing left to cut.

## 2. Settings / about pages
Census (qm-scout, static): mount requests per route; the shell adds `fetch_data.sh` (shared, 10 s, hidden-paused), `auth/check.sh` (10 s, hidden-paused) and one `settings.sh` from `nav-user.tsx:111`.

Per request, CPU = CGI + children. "lighttpd" = through lighttpd, fresh TLS, n calls (`/tmp/s10/pages.sh`); "direct" = `sudo -n -u www-data`, children CPU of a wrapper shell (`/tmp/s10/direct.sh`; sh start-up alone = 9–12 ms). Forks are min /proc/stat delta over 4 runs and stay noisy (the poller forks in bursts); ± ≈ 5.

| route | request (when) | lighttpd wall / CPU ms | direct wall / CPU ms | forks |
|---|---|---:|---:|---:|
| (floor) | `speedtest_status.sh` | 87 / 15 | 25 / 22 | ≈ 5 |
| `/system-settings` | `settings.sh` ×2 (page + nav-user), mount | 182 / 97 | 100 / 92 | ≈ 16 |
| | `known_sims.sh`, mount | 94 / 33 | 45 / 40 | ≈ 3 |
| `/system-settings/system-health-check` | `health-check/status.sh`, mount | 86 / 26 | — | ≈ 2 |
| `/system-settings/web-console` | `console_token.sh`, mount | 103 / 53 | — | ≈ 10 |
| `/system-settings/languages` | `language-packs/list.sh` (GitHub manifest fetch), mount | 1 060 / 246 | 740 / 220 | ≈ 50–90 |
| `/system-settings/software-update` | `update.sh` (GitHub releases API, no cache), mount | 1 280 / 533 | 1 745 / 540 | ≈ 75 |
| `/about-device` | `about.sh` (public IP cached 300 s), mount | 272 / 124 | 230 / 110 | ≈ 30 |
| **`/system-settings/logs`** | **`logs.sh?lines=100`, mount + every 10 s** (hidden-paused) | 293 / 206 | 244–455 / **215–230** | ≈ 60–90 |
| | same, synthetic 256 KB log (the rotation cap) | — | 960–1 002 / **508–510** | — |

Reading:
- One-shots are single spikes of 0.03–0.54 s CPU per page mount. The settings index costs ≈ 0.23 s once, about ≈ 0.12 s (≈ +0.2 s every 5 min when the IP cache is cold). **Closed, no change.**
- Software Update (0.54 s CPU, 1.3–1.7 s wall) and Languages (0.22–0.25 s) are the largest one-shots. Both are network-bound, and each Software Update mount also spends one unauthenticated GitHub API call (60/h limit). This is a one-shot, so it stays under the threshold; a 5-min response cache is listed as an option, not proposed by default.
- **Logs page is the one steady cost: 215–230 ms every 10 s = 2.2 pts while the page is open at today's 16 KB log, ≈ 5.1 pts at the 256 KB rotation cap** (and more with `include_rotated=1`, up to 3 files). The cost scales with log size because every poll re-parses the whole file: `cat | awk` over all lines, then `grep | sed | sort -u | jq` for the component list, `jq -n` for stats, `jq -s` for the final body.

## 3. Proposed fix (needs user OK)
Logs page only. Options:
- **L1 (recommended), backend:** `system/logs.sh` GET in one `awk` pass that emits the entries, component list and stats, with no `jq` on the hot path. The response shape and field order are unchanged. Target ≤ 60 ms at 16 KB, ≤ 150 ms at 256 KB (≈ 0.6 / 1.5 pts). Risk: JSON escaping must match `jq` (control chars, unicode); equivalence gate = old vs new body `cmp` on the live log, the 256 KB log and a crafted log with quotes, backslashes, tabs, control bytes and non-ASCII.
- **L2, frontend:** poll 10 s → 30 s (`hooks/use-system-logs.ts:27`). It is 3× cheaper with no backend risk, but new lines appear up to 30 s late.
- Optional **U1:** cache the `update.sh` GitHub response for 5 min in `/tmp` (an explicit "Check" action bypasses it).

Gates for L1: busybox-portability-checker (both devices, `/tmp` copies), blind qm-verifier, docs (`docs/reference/` logs note if one exists + RELEASE_NOTES bullet). Deploy for after-numbers only with the user's yes (one CGI, backup first, no restart).

## 4. Build (user chose L1, 2026-11-03)
Commit e914d813: `system/logs.sh` GET rewritten as `render_logs()`, a single awk pass (ring buffer of the newest `lines` entries, component list by an awk `match()` loop on the same regex plus a byte-order insertion sort, stats from one `wc -lc`). The body is printed in jq's pretty-print format; query params are parsed by the builtin `qs_param`. POST is unchanged.

Bugs found on device while building: BusyBox awk parses `out ((c in E) ? …)` as a call to a function `out` ("Call to undefined function"); `\b`/`\f` escapes were replaced by `sprintf("%c")` keys, to avoid relying on escape support.

Equivalence (`/tmp/s10/eq2.sh`, old installed vs new `/tmp` copy, both as www-data, `cmp` on full output): **150/150 identical** over 6 fixtures (live snapshot, 256 KB, crafted edge cases incl. quotes/backslash/tab/DEL/UTF-8/U+2028/nested brackets/leading whitespace/tab separators/bare level, empty, missing, rotated .1/.2) × 25 queries. Control-char/CRLF log (`/tmp/s10/ctl.sh`): old body 0 bytes (jq parse error); new body 710 bytes, valid JSON, `\r` `\u0007` `\u001b` escaped.

| direct www-data, CPU per GET (5 runs ×2) | before | after |
|---|---:|---:|
| 26 KB log | 228 ms | **80 ms** |
| 256 KB log | 494–496 ms | **294 ms** |
| 256 KB, `lines=500&include_rotated=1` | — | 350 ms |
| forks (min, minus 4 for the wrapper) | ≈ 56 | ≈ 6 |

At 10 s: 2.3 → 0.8 pts today, 5.0 → 2.9 pts at the cap. The 256 KB target (≤ 150 ms) was missed: the rest is awk's per-line work (profile on 3 136 lines: component scan 84 ms after the `match()` change, from 110 ms; level `split` 78 → `match` 42 ms; the rest ≈ 40 ms). The frontend 30 s poll (L2) would cut that by another 3×, if wanted.

Docs: `docs/reference/logs.md` (data path, "Cost per poll" section, residue line removed), RELEASE_NOTES bullet.

## 5. Gates (fix rounds e2ae6d0c, 600a3ecd, f366ab93)
- e914d813 verifier FAIL: invalid UTF-8 raw, doc said two diffs. Fixed in e2ae6d0c (U+FFFD, jq 1.7 rules).
- e2ae6d0c portability BLOCKED both devices, 9/328: a lead cut off by the end of a field takes the rest of the field in jq. 600a3ecd copies that, and the `jq -R -s` component-list rule (each `name
` line decoded alone, so a cut-off lead eats the newline and joins two names). My harness 200/200 on RM520N-GL.
- 600a3ecd portability SAFE TO SHIP: 433/433 identical on RM520N-GL and RG501Q-EU, awk constructs same on 1.29.3/1.31.1.
- 600a3ecd verifier FAIL (A2 only): 1632 cases, all invalid UTF-8 identical; A1/A3/A4 PASS (30 KB 230 to 86 ms, 262 KB 496 to 302 ms, forks 59 to 9), A5 PASS_WITH_NOTES. Two unlisted diffs, old output valid but wrong: NUL byte in a file (old component list `[]`), component-list line over ~4094 bytes (old split a multibyte char at jq's 4095-byte fgets chunk). Listed in logs.md by f366ab93; need user acceptance.
- User accepted the four earlier diffs (control byte, quote/bad escape, backslash escape in comp/pid, rotated file without newline), via PM.

## Device files left
None. `/tmp/s10`, `/tmp/s10v`, `/tmp/s10pc` removed on both devices; installed logs.sh md5 ba95fc24... on both. `ce7f0c7a...` (root-owned) is not mine.
