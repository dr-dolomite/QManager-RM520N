# Poller CPU Profile

> **Applies to:** RM520N-GL (SDX6X) · RG501Q-EU (SDX55) — **both measured live**, 2026-09-01
> Serials: `61368cd2` (RM520N-GL) · `b7e3d6f1` (RG501Q-EU)

`qmanager_poller` is the single largest CPU consumer on both devices — **85% of all busy CPU** on the RM520N-GL. This document records what it actually spends that CPU on, measured rather than estimated, so that any optimisation effort (a shell de-fork pass, helper binaries, or a full rewrite) is aimed at the right functions.

The headline is counter-intuitive and worth stating up front:

> ⚠️ **Almost none of the poller's CPU is computation.** It is process-creation overhead. A `/bin/true` — a program that does nothing — costs **2.40 ms of CPU** on the RM520N-GL and **4.95 ms** on the RG501Q-EU. The poller forks roughly **220 times per cycle**. Multiply those and you have essentially the entire measured cost. Optimising the *logic* of these functions will achieve nothing; only removing `$(...)`, pipes, and exec sites moves the needle.

> ⚠️ **htop under-reports the poller by ~9×.** See [The htop trap](#the-htop-trap). Never quote htop's poller `CPU%` or `TIME+` as the cost.

---

## Quick Reference

| Item | Value |
|------|-------|
| Daemon | `qmanager_poller` (`scripts/usr/bin/qmanager_poller`, installed `/usr/bin/qmanager_poller`) |
| Measured cost, live daemon | **32.6% of one core** (RM520N-GL), 85% of all busy CPU on the device |
| System-wide CPU busy | 38.3% (RM520N-GL) · 39.1% (RG501Q-EU) — kernel time **1.6× user time** |
| Fork rate, system-wide | **96/sec** (RM520N-GL) · 80/sec (RG501Q-EU) |
| Forks per poll cycle | **~220** (of ~290 raw, after noise correction) |
| Child CPU per cycle | **815 ms** (RM520N-GL) · **1150 ms** (RG501Q-EU) |
| Measured cycle cadence | 3.62 s (RM520N-GL) · 4.33 s (RG501Q-EU) — **not** the 2 s `POLL_INTERVAL` |
| Go equivalent, same work | **2.39 ms/cycle** (RM520N-GL) · 2.84 ms (RG501Q-EU), **0 forks**, 6.3 MB RSS |
| Harness | `/tmp/qm_fork_probe.sh` → report at `/tmp/qm_fork_attribution.txt` |
| Sample size | 996 cycles / 3602 s (RM520N-GL) · 832 cycles / 3601 s (RG501Q-EU) |

---

## The htop trap

htop shows only the parent bash process's `utime` + `stime`. Every helper the poller forks is reaped, and a reaped child's CPU is accumulated into the parent's **`cutime`/`cstime`** (fields 16 and 17 of `/proc/<pid>/stat`), which htop does not display.

Measured over 59 s on the RM520N-GL:

| | ticks/59 s | % of one core |
|---|---:|---:|
| Poller's own time (**what htop shows**) | 211 | 3.6% |
| Poller's reaped children (**hidden**) | 1713 | **29.0%** |
| **Poller tree total** | 1924 | **32.6%** |
| All other processes combined | 341 | 5.7% |

The poller tree is **85% of all busy CPU on the device**. A `TIME+` of 38:34 over 19 h of uptime is the *parent only* and is ~3.4% — consistent with the 3.6% above, and ~9× too low as a measure of what the daemon costs.

**To read the real number:**

```bash
awk '{print "own:", $14+$15, "children:", $16+$17}' /proc/$(pgrep -f /usr/bin/qmanager_poller | head -1)/stat
```

---

## The cost of one fork+exec

200 samples per binary, stdin pinned to `/dev/null`, CPU measured via `cutime`+`cstime` delta.

| binary | RM520N-GL (SDX6X) | RG501Q-EU (SDX55) |
|---|---:|---:|
| `/bin/true` — **pure fork+exec floor** | **2.40 ms** | **4.95 ms** |
| `cut` / `date` / `stat` / `sed` | ~2.6 ms | ~5.1 ms |
| `awk` / `head` / `cat` / `tr` / `wc` | ~2.7 ms | ~5.1 ms |
| `grep` | 3.55 ms | 4.85 ms |
| **`jq`** | **11.10 ms** | **13.75 ms** |
| subshell `$( )`, no exec | 0.65 ms | 0.85 ms |

Two things follow:

1. **`/bin/true` costing 2.4 ms while doing nothing is the whole story.** That is `fork` + `execve` + ELF load + dynamic-linker relocation + libc init. The work the applet then performs is nearly free by comparison.
2. **`jq` is 4.3× a normal applet.** Every `jq` call for a single-field extraction costs as much as four other forks. Batch or eliminate it first.
3. **The SDX55 pays ~2× per exec.** The same script hurts the RG501Q-EU roughly twice as much, which is why its per-cycle cost is 1150 ms against the RM520N's 815 ms.

A useful sanity check: 815 ms ÷ ~220 forks ≈ **3.7 ms average**, which is exactly what a mix of ~2.6 ms applets and 11.1 ms `jq` calls predicts. The CPU accounting and the fork accounting agree independently, so neither is an artifact.

---

## Per-function attribution

Amortised across **every** cycle (so a Tier-1.5 function that runs 1-in-5 shows its true contribution to the average cycle). `ms/cycle` is exact — it comes from per-process `cutime`+`cstime` deltas. `forks/call` is a system-wide counter delta and carries ~96/s of background noise; treat it as indicative, not exact.

| function | RM520N ms/cycle | share | RG501Q ms/cycle | forks/call (RM/RG) | cadence |
|---|---:|---:|---:|---:|---|
| `poll_serving_cell` | **200** | 25% | **238** | 83 / 86 | every cycle |
| `read_ping_data` | **154** | 19% | 126 | 62 / 42 | every cycle |
| CA block *(unattributed)* | ~98 | 12% | **~278** | — | every cycle |
| `update_system_health` | 78 | 10% | 105 | 34 / 37 | every cycle |
| `poll_per_antenna_signal` | 66 | 8% | 81 | 132 / 137 | 1-in-5 |
| `update_proc_metrics` | 66 | 8% | 86 | 25 / 26 | every cycle |
| `update_data_used` | 51 | 6% | 63 | 19 / 19 | every cycle |
| `poll_tier2` | 44 | 5% | 55 | 268 / 257 | 1-in-15 |
| `write_cache` | 31 | 4% | 40 | 7 / 7 | every cycle |
| `detect_events` | 15 | 2% | **55** | 5 / **15** | every cycle |
| `check_alerts` | 6 | <1% | 9.5 | 3 / 3 | every cycle |
| `append_ping_history` | 5 | <1% | 6 | 8 / 8 | 1-in-5 |
| `read_sim_state` | 0.5 | <1% | 0.8 | 4 / 4 | 1-in-15 |
| `crash_watcher_check` | **0** | — | 0 | 0 | every cycle |
| `determine_service_status` | **0** | — | 0 | 0 | every cycle |
| `update_conn_uptime` | **0** | — | 5.7 | 0 / 2 | every cycle |
| `read_watchcat_state` | **0** | — | 0 | 0 | 1-in-5 |

**`poll_serving_cell` + `read_ping_data` alone are 44% of the total.** Neither performs meaningful I/O — that is one AT response being parsed and one JSON file being read.

The four functions that already cost **zero** (`crash_watcher_check`, `determine_service_status`, `update_conn_uptime`, `read_watchcat_state`) are the proof of what's achievable: they are pure builtin/sysfs reads with no subprocesses, and they are free.

### RG501Q-EU deltas worth investigating on their own

These are behavioural differences, **not** explained by the SDX55's 2× slower exec:

- **`detect_events` forks 15×/call vs 5×** on the RM520N-GL (3.6× the CPU: 55 ms vs 15 ms). Something in the event-detection path takes a different branch on SDX55.
- **The CA block costs ~278 ms/cycle** vs ~98 ms — its *third*-largest cost. `AT+QCAINFO` + `parse_ca_info`.
- **`update_conn_uptime` forks twice per call** on the RG501Q-EU and zero times on the RM520N-GL.

---

## Ranked remediation

Ordered by measured payoff. Items 1–4 are mechanical and change no behaviour.

| # | target | current | approach | est. saving |
|---|---|---:|---|---:|
| 1 | `poll_serving_cell` / `parse_at.sh` | 200 ms, 83 forks | One AT response is shredded by dozens of `grep`/`cut`/`awk`. Replace with a **single `awk` pass**. 83 forks → ~5. | **~180 ms** |
| 2 | `read_ping_data` | 154 ms, 62 forks | 62 forks to read one JSON file. If ~10 are `jq`, that alone is 111 ms. **Batch into one `jq` invocation**, or parse with builtins. | **~140 ms** |
| 3 | `update_system_health` | 78 ms, 34 forks | sysfs reads via `cat`/`grep`/`awk` → `read` builtins. | **~70 ms** |
| 4 | `update_proc_metrics` | 66 ms, 25 forks | `/proc/stat`, `/proc/meminfo`, `/proc/uptime` — can be **zero forks** with `read` + `${var%%...}`. | **~66 ms** |
| 5 | CA block | 98 / 278 ms | `parse_ca_info` on `AT+QCAINFO`; the RG501Q path especially. | ~80 / ~250 ms |
| 6 | `poll_per_antenna_signal` | 66 ms, 132 forks | `parse_qrsrp`/`qrsrq`/`qsinr` + `append_signal_history`'s `jq -n -c`. Single `awk`, drop the `jq`. | ~55 ms |

**Items 1–4 total ~456 ms of 815 ms — a 56% cut from four functions**, taking the poller from ~32% to roughly **14% of a core**. Including 5 and 6 approaches **6–8%**.

### The zero-fork idioms

```sh
# WRONG — 3 forks
cpu_line=$(head -1 /proc/stat)
cur_idle=$(echo "$cpu_line" | awk '{print $5}')

# RIGHT — 0 forks
read -r _ user nice system idle _ < /proc/stat

# WRONG — 1 fork          # RIGHT — 0 forks
x=$(cat /proc/uptime)      read -r x < /proc/uptime
y=$(echo "$x" | cut -d. -f1)   y=${x%%.*}
```

---

## Method

The harness is `/tmp/qm_fork_probe.sh` (source in the session scratchpad; redeploy with `base64` over SSH). It is **read-only with respect to production state** — everything it writes lands in `/tmp/qmprobe/` or `/tmp/qm_fork_attribution.txt`.

It works by:

1. Sourcing a **copy** of `/usr/bin/qmanager_poller` with `main "$@"` disabled, so every function and every sourced lib is defined exactly as in production.
2. Redirecting every writable path constant (`CACHE_FILE`, `DATA_USED_FILE`, `EVENTS_FILE`, `_CRASH_LOG`, …) into `/tmp/qmprobe`, and stubbing the outbound dispatchers (`email_alert_send`, `sms_alert_send`, `_ae_dispatch`).
3. Replacing `qcmd` with a **record-once / replay** stub: the first call for a given AT command hits the real modem through `/usr/bin/qcmd` and its own flock; every later call replays from cache. Faithful parse input, no lock contention with the live poller, no extra AT traffic.
4. Wrapping each function `poll_cycle` calls **directly** (nested callees roll up into their caller, so nothing is double-counted) and sampling two kernel counters around each:
   - `/proc/self/stat` `cutime`+`cstime` — **exact, per-process** CPU of reaped children.
   - `/proc/stat` `processes` — system-wide fork count; noisy, reported with a measured noise floor.
5. Both samplers use **only bash builtins**, so the instrument forks zero times and does not contaminate what it measures.

**Validation:** the harness measured 27–31% of a core against the live daemon's independently measured 32.6%. The small gap is the stubbed AT transport. It reproduces the real workload closely enough to trust.

bash 3.2 compatible — the RM520N-GL ships **bash 3.2.57**, so no associative arrays. (The RG501Q-EU has 4.4.23.)

### Re-running after a change

```bash
setsid nohup bash /tmp/qm_fork_probe.sh 3600 </dev/null >/tmp/qmfp.log 2>&1 &
```

Checkpoints land every 25 cycles, so partial data accrues within minutes. Progress is observable at `/tmp/qmfp_heartbeat`. Compare against the baselines in this document.

### Harness gotchas that cost real time

> ⚠️ **BusyBox `tr` ignores a FILE argument and reads stdin — it hangs forever, it does not error.** `tr -d x /proc/uptime` wedges the script *and* the SSH channel. Always redirect (`< file`), and pin `</dev/null` on every exec inside a benchmarking loop. See [`reference_busybox_tr_ignores_file_arg_reads_stdin`].

> ⚠️ **`pkill -f` / `pgrep -f` self-match.** A `-f` pattern is matched against process command lines — *including the command line of the shell running the `pkill`/`pgrep`*. `pkill -f qm_fork_probe.sh` kills its own shell; `pgrep -f qm_fork_probe.sh` always reports a match and therefore always reports "running". Kill by PID file, and check liveness with `kill -0 "$(cat /tmp/qmfp.pid)"`.

> ⚠️ **Verify the deployed md5 *against local*, not just that one exists.** A self-killed `pkill` shell skipped a `: > file` truncation, so nine `>>` appends stacked onto the previous base64 payload. `base64 -d` decoded both streams, `bash -n` passed (two valid scripts in sequence), and an entire hour was wasted running a concatenated script. The device file had **2 shebangs** and was 26965 bytes against 13662 locally. Gate the launch on `device_md5 == local_md5`.

---

## The compiled-language comparison

A Go equivalent was built and run **on both devices** doing genuinely comparable work: the same `/proc` and sysfs reads, the same 8 real AT responses parsed field-by-field from the fixtures captured off each device, and an atomic JSON write.

| | shell poller | Go equivalent |
|---|---:|---:|
| CPU per cycle, RM520N-GL | 815 ms | **2.39 ms** |
| CPU per cycle, RG501Q-EU | 1150 ms | **2.84 ms** |
| forks per cycle | ~220 | **0** |
| RSS | — | 6.3 MB |

**Caveat, stated plainly:** the benchmark emits a 1012-byte JSON against the real 5234-byte cache and omits the events, alerts, history, and data-counter state machines. It is a lower bound, not the finished article. But even assuming the real port is **10× more work**, that is ~24 ms/cycle — still **under 1% of a core** against today's 32.6%.

### Binary size (Go 1.26.2, `GOOS=linux GOARCH=arm GOARM=7 CGO_ENABLED=0`, `-trimpath -ldflags="-s -w"`)

| build | stripped |
|---|---:|
| bare `main` (runtime floor) | 1408 K |
| + `regexp` | 1664 K |
| + `encoding/json` | 1728 K |
| **realistic poller skeleton, hand-rolled JSON** | **1728 K** |
| same + `fmt` + `encoding/json` | 2112 K |
| **+ `net/http`** | **6016 K** |

> ⚠️ **`net/http` is the size trap, not `regexp`.** `regexp` costs +256 K and is fine to use; `net/http` adds ~3.9 MB on its own. `encoding/json` (+320 K, drags in `reflect`) is affordable but avoidable — hand-rolling JSON emission with `strconv.AppendInt` into a `[]byte` is ~40 lines and keeps the binary at the floor.

`-ldflags="-s -w"` is worth a consistent ~30% and is not optional. A full port adds *code* but no new runtime, so it projects to **~2.0–2.5 MB stripped** — inside a 3 MB budget on devices with ~20 MB of writable `/opt`.

**RAM, not disk, is the real cost.** 6.3 MB RSS against 182 MB total (RM520N-GL) / 230 MB (RG501Q-EU). Go's runtime and GC baseline is heavier than bash's; tune with `GOGC`/`GOMEMLIMIT` and measure against the bash poller's RSS before claiming a win. Hard-float is confirmed fine on both SoCs.

---

## Recommendation

**Do the shell de-fork pass first.** It is days of low-risk work against the ranked list above, it stays reviewable and debuggable on-device, it helps the RG501Q-EU more than the RM520N-GL, and it captures ~75% of the available win without touching the architecture.

A rewrite's case rests on **where the architecture should go** — a resident AT transport, event-driven rather than polling — not on whether the CPU is recoverable. It plainly is, either way. And at 1.7 MB measured, binary size is not the obstacle.

Whichever path is taken, a port must reproduce these contracts exactly, and they — not the coding — are the real cost:

- the `/tmp/qmanager_status.json` schema every CGI reads as a thin cache
- the cross-UID `/tmp` ownership rules (see [`tmp-file-ownership.md`](./tmp-file-ownership.md))
- `flock` serialisation against the CGI layer (see [`at-command-transport.md`](./at-command-transport.md)) — bit-identical, or AT responses corrupt
- events, alerts, the persistent Data Used counter, crash watcher, SIM registry
- the 1970 boot window (see [`scheduled-timers.md`](./scheduled-timers.md))
