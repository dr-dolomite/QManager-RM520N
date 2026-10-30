# Poller CPU Profile

> **Applies to:** RM520N-GL (SDX6X) · RG501Q-EU (SDX55) — **both measured live**
> Serials: `61368cd2` (RM520N-GL) · `b7e3d6f1` (RG501Q-EU)
> **Baseline profiled** 2026-09-01 · **de-fork pass measured** 2026-09-02

`qmanager_poller` is the single largest CPU consumer on both devices — **85% of all busy CPU** on the RM520N-GL before the de-fork pass. This document records what it actually spends that CPU on, measured rather than estimated, so that any optimisation effort (further de-forking, helper binaries, or a full rewrite) is aimed at the right functions.

The headline is counter-intuitive and worth stating up front:

> ⚠️ **Almost none of the poller's CPU is computation.** It is process-creation overhead. "Fork+exec" is what a shell does every time it runs an external program: it clones itself (`fork`), then replaces the clone with the new program (`execve`). On these SoCs that costs more than the program's actual work. A `/bin/true` — a program that does nothing — costs **2.40 ms of CPU** on the RM520N-GL and **4.95 ms** on the RG501Q-EU. The poller forked roughly **220 times per cycle**. Multiply those and you have essentially the entire measured cost. Optimising the *logic* of these functions achieves nothing; only removing `$(...)`, pipes, and exec sites moves the needle.

> ⚠️ **htop under-reports the poller by ~9×.** See [The htop trap](#the-htop-trap). Never quote htop's poller `CPU%` or `TIME+` as the cost.

**What has already been done.** A de-fork pass (commits `931b32e..a95c098`, 2026-09-02) rewrote four functions with no behaviour change, taking their combined static fork sites from **251 to 8**, and cutting attributed child CPU by **41% / 44%**. See [The 2026-09-02 de-fork pass](#the-2026-09-02-de-fork-pass) for the paired measurements, and [Ranked remediation](#ranked-remediation) for what is left.

---

## Quick Reference

| Item | Value |
|------|-------|
| Daemon | `qmanager_poller` (`scripts/usr/bin/qmanager_poller`, installed `/usr/bin/qmanager_poller`) |
| Current poller cost (RM520N-GL, live transport) | **344 ms/cycle, 13.0 % of core** after T1.1; `active` 12.9 % / `idle` 8.1 % / `deep` 6.0 % after T6.1 — see [Hot-path re-author](#hot-path-re-author-t11-2026-10-26) and [Activity tiers](#activity-tiers-t61-2026-10-27) |
| Poller share of one core (2026-09, stubbed AT) | **30% → 23%** (RM520N-GL) · **31% → 26%** (RG501Q-EU) after the de-fork pass |
| Attributed child CPU per cycle | **595 → 351 ms** (RM520N-GL, −41%) · **877 → 487 ms** (RG501Q-EU, −44%) |
| Same, incl. unattributed residual | 769 → 500 ms (RM520N-GL) · 1079 → 664 ms (RG501Q-EU) |
| Measured cycle cadence | **3.39 → 3.18 s** (RM520N-GL) · **5.00 → 4.01 s** (RG501Q-EU) — **not** the 2 s `POLL_INTERVAL` |
| Fork sites removed | `parse_serving_cell` 184→3 · `update_system_health` 37→4 · `update_proc_metrics` 22→0 · `qcmd_exec` 8→1 |
| System-wide CPU busy (baseline) | 38.3% (RM520N-GL) · 39.1% (RG501Q-EU) — kernel time **1.6× user time** |
| Dashboard CGI per-request floor | **39 ms CPU**, 19 → 2 forks after T6.2 S1 (RM520N-GL) — see [Dashboard CGI cost](#dashboard-cgi-cost-t62-2026-102728) |
| Go equivalent, same work | **2.39 ms/cycle** (RM520N-GL) · 2.84 ms (RG501Q-EU), **0 forks**, 6.3 MB RSS |
| Proof | No harness or gates — `scripts/test/` was deleted 2026-09-03 (it held `qm_fork_probe.sh`, `poller-defork-forkcount.sh` and `poller-defork-equivalence.sh`; see [The 2026-09-02 de-fork pass](#the-2026-09-02-de-fork-pass) for what they used to check). Re-measure on the device and byte-compare output by hand |

> ℹ️ **NOTE:** the "before" figures above come from the de-fork pass's own paired baseline runs (pinned AT fixtures, 2026-09-02), **not** from the original 2026-09-01 profiling run. The two used different durations and different device conditions, so their absolute numbers differ — 595 ms/cycle here against the original run's 815 ms, for instance. Never mix a number from one run with a number from the other. The original run's per-function figures are preserved below as the historical baseline they were.

---

## The htop trap

htop shows only the parent bash process's `utime` + `stime`. Every helper the poller forks is reaped, and a reaped child's CPU is accumulated into the parent's **`cutime`/`cstime`** (fields 16 and 17 of `/proc/<pid>/stat`), which htop does not display.

Measured over 59 s on the RM520N-GL, before the de-fork pass:

| | ticks/59 s | % of one core |
|---|---:|---:|
| Poller's own time (**what htop shows**) | 211 | 3.6% |
| Poller's reaped children (**hidden**) | 1713 | **29.0%** |
| **Poller tree total** | 1924 | **32.6%** |
| All other processes combined | 341 | 5.7% |

The poller tree was **85% of all busy CPU on the device**. A `TIME+` of 38:34 over 19 h of uptime is the *parent only* and is ~3.4% — consistent with the 3.6% above, and ~9× too low as a measure of what the daemon costs.

**To read the real number:**

```bash
awk '{print "own:", $14+$15, "children:", $16+$17}' /proc/$(pgrep -f /usr/bin/qmanager_poller | head -1)/stat
```

The trap does not go away after de-forking. In relative terms it eases — the pass removed child forks, so more of what remains is parent time htop can see — but the residual children are still invisible.

---

## The cost of one fork+exec

200 samples per binary, stdin pinned to `/dev/null`, CPU measured via `cutime`+`cstime` delta. These are device constants and are unaffected by the de-fork pass.

| binary | RM520N-GL (SDX6X) | RG501Q-EU (SDX55) |
|---|---:|---:|
| `/bin/true` — **pure fork+exec floor** | **2.40 ms** | **4.95 ms** |
| `cut` / `date` / `stat` / `sed` | ~2.6 ms | ~5.1 ms |
| `awk` / `head` / `cat` / `tr` / `wc` | ~2.7 ms | ~5.1 ms |
| `grep` | 3.55 ms | 4.85 ms |
| **`jq`** | **11.10 ms** | **13.75 ms** |
| subshell `$( )`, no exec | 0.65 ms | 0.85 ms |

Three things follow:

1. **`/bin/true` costing 2.4 ms while doing nothing is the whole story.** That is `fork` + `execve` + ELF load + dynamic-linker relocation + libc init. The work the applet then performs is nearly free by comparison.
2. **`jq` is 4.3× a normal applet.** Every `jq` call for a single-field extraction costs as much as four other forks. Batch or eliminate it first.
3. **The SDX55 pays ~2× per exec.** The same script hurts the RG501Q-EU roughly twice as much, which is also why de-forking helps it more (−44% against −41%).

A useful sanity check on the baseline: 815 ms ÷ ~220 forks ≈ **3.7 ms average**, which is exactly what a mix of ~2.6 ms applets and 11.1 ms `jq` calls predicts. The CPU accounting and the fork accounting agree independently, so neither is an artifact.

---

## Per-function attribution (baseline, 2026-09-01)

**This table is history, kept deliberately.** It is the measurement the de-fork pass was aimed by and argued from, and it describes the poller as it was *before* commits `931b32e..a95c098`. Rows marked ✅ have since been rewritten — see the next section for their post-change figures.

Amortised across **every** cycle (so a Tier-1.5 function that runs 1-in-5 shows its true contribution to the average cycle). `ms/cycle` is exact — it comes from per-process `cutime`+`cstime` deltas. `forks/call` is a system-wide counter delta and carries ~96/s of background noise; treat it as indicative, not exact.

| function | RM520N ms/cycle | share | RG501Q ms/cycle | forks/call (RM/RG) | cadence | status |
|---|---:|---:|---:|---:|---|---|
| `poll_serving_cell` | **200** | 25% | **238** | 83 / 86 | every cycle | ✅ de-forked |
| `read_ping_data` | **154** | 19% | 126 | 62 / 42 | every cycle | ⚠️ figures stale — see below |
| CA block *(unattributed)* | ~98 | 12% | **~278** | — | every cycle | ❌ estimate was wrong — see below |
| `update_system_health` | 78 | 10% | 105 | 34 / 37 | every cycle | ✅ de-forked |
| `poll_per_antenna_signal` | 66 | 8% | 81 | 132 / 137 | 1-in-5 | open |
| `update_proc_metrics` | 66 | 8% | 86 | 25 / 26 | every cycle | ✅ de-forked |
| `update_data_used` | 51 | 6% | 63 | 19 / 19 | every cycle | open |
| `poll_tier2` | 44 | 5% | 55 | 268 / 257 | 1-in-15 | open |
| `write_cache` | 31 | 4% | 40 | 7 / 7 | every cycle | open |
| `detect_events` | 15 | 2% | **55** | 5 / **15** | every cycle | not a usable control — see below |
| `check_alerts` | 6 | <1% | 9.5 | 3 / 3 | every cycle | open |
| `append_ping_history` | 5 | <1% | 6 | 8 / 8 | 1-in-5 | open |
| `read_sim_state` | 0.5 | <1% | 0.8 | 4 / 4 | 1-in-15 | open |
| `crash_watcher_check` | **0** | — | 0 | 0 | every cycle | already free |
| `determine_service_status` | **0** | — | 0 | 0 | every cycle | already free |
| `update_conn_uptime` | **0** | — | 5.7 | 0 / 2 | every cycle | already free (RM520N) |
| `read_watchcat_state` | **0** | — | 0 | 0 | 1-in-5 | already free |

The four functions that already cost **zero** (`crash_watcher_check`, `determine_service_status`, `update_conn_uptime`, `read_watchcat_state`) were the proof of what was achievable: they are pure builtin/sysfs reads with no subprocesses, and they are free. `update_proc_metrics` has since joined them at a measured literal zero.

### Two corrections to this table

- **The CA block figure (~98 / ~278 ms) was arithmetic, and the arithmetic was loose.** It is the unattributed residual — whole-cycle cost minus everything the harness wrapped — and the original subtraction did not remove the harness's one-time PART 1 microbenchmark, which alone is ~835 ticks of a run. Done properly, the residual is **174 ms/cycle** (RM520N-GL) and **202 ms** (RG501Q-EU) before the de-fork pass, falling to **149 ms** and **176 ms** after it. So the CA block is *larger* than the old estimate on the RM520N-GL, not smaller, and it is the **single biggest remaining per-cycle cost** on that device. See the note below on what that bucket actually contains.
- **`read_ping_data`'s 154 / 126 ms was measured against code that no longer exists.** Per-function md5 comparison found the repo copy and the two device copies are **three different versions**. Fresh measurement against the current repo copy: **105–109 ms** (RM520N-GL) and **159 ms** (RG501Q-EU). That stale baseline is why it was dropped from the pass.

### RG501Q-EU deltas worth investigating on their own

These are behavioural differences, **not** explained by the SDX55's 2× slower exec:

- **`detect_events` forks 15×/call against 5×** on the RM520N-GL (3.6× the CPU: 55 ms against 15 ms). Something in the event-detection path takes a different branch on SDX55.
- **`update_conn_uptime` forks twice per call** on the RG501Q-EU and zero times on the RM520N-GL.

---

## The 2026-09-02 de-fork pass

Four functions were rewritten to remove process launches. **No emitted value changed** — that was the pass's whole contract, pinned by `scripts/test/poller-defork-equivalence.sh`, which byte-compared a golden dump against a fresh run over raw AT-response fixtures. `scripts/test/` (and that harness with it) was deleted 2026-09-03 — see [Method](#method) below for how it worked, since re-measuring means rebuilding it from that description.

Static fork-site counts came from `scripts/test/poller-defork-forkcount.sh`. That scanner summed command substitutions, pipeline segments and applet calls independently, so a single `x=$(df -P /usrdata)` scored **2** — one substitution plus one applet. Ceilings are derived floors, not round numbers.

| function | fork sites | ceiling | RM520N ms/cycle | RG501Q ms/cycle |
|---|---:|---:|---:|---:|
| `parse_serving_cell` (in `parse_at.sh`) | 184 → **3** | 3 | 164 → **24** (−85%) | 239 → **32** (−87%) |
| `update_system_health` | 37 → **4** | 4 | 66 → **7** (−89%) | 107 → **8** (−93%) |
| `update_proc_metrics` | 22 → **0** | 0 | 62 → **0** (−100%) | 84 → **0** (−100%) |
| `qcmd_exec` | 8 → **1** | 1 | *(folded into the callers above)* | |

- **Whole-cycle attributed child CPU: 595 → 351 ms (−41%) RM520N-GL · 877 → 487 ms (−44%) RG501Q-EU.**
- Including the unattributed residual: 769 → 500 ms and 1079 → 664 ms.
- Poller share of one core: 30% → 23% and 31% → 26%.
- Cadence: 3.39 → 3.18 s and 5.00 → 4.01 s.
- **`update_proc_metrics` records a literal zero** attributed child ticks over 95 calls (RM520N-GL) and 75 calls (RG501Q-EU). Not "rounds to zero" — zero.

`qcmd_exec` runs for **every** AT command the poller issues, so its saving spreads across every caller rather than showing as its own line. The unattributed residual — which is where `AT+QCAINFO` lives — improved by ~14% for free on that basis alone: **174 → 149 ms/cycle** (RM520N-GL) and **202 → 176 ms** (RG501Q-EU).

> ℹ️ **NOTE: that residual is a bucket, not a function.** The harness attributes only the functions `poll_cycle` calls **by name**, and `AT+QCAINFO` is invoked inline in `poll_cycle`'s own body. So the 149 / 176 ms figure covers the CA block **and** everything else `poll_cycle` does inline. It is an **upper bound** on the CA block, not a measurement of it. Anyone targeting it next should wrap it into a named function first and re-run, to get a clean number. Every other row in the ranked table below is measured per-function and is exact.
>
> The residual is derived as `(unattributed_ticks − PART 1 microbenchmark) ÷ cycles`, at 10 ms per tick. On the RM520N-GL after-run that is `(2254 − 835) ÷ 95 = 14.9 ticks = 149 ms`. Forgetting to subtract the one-time microbenchmark is what made the earlier estimate wrong. The independent check is that attributed plus residual must equal the whole-cycle figure: `351 + 149 = 500 ms`, which it does.

The surviving fork sites are each load-bearing and were argued individually:

- `parse_serving_cell`: one `awk` pass, its command substitution, and its pipeline segment (3).
- `update_system_health`: `df` is the only source of the `/usrdata` figures; `jq` is the schema boundary on the modem crash log. Each scores 2, hence a ceiling of 4.
- `qcmd_exec`: `result=$(qcmd "$cmd")` — the AT transport itself (1).

### Portability findings that made the rewrite possible

Both devices run BusyBox `awk`, not GNU `awk`. Two findings were load-bearing, and one nearly derailed the pass:

- ⚠️ **BusyBox `awk` has no `strtonum()`** on either device — both answer `awk: Call to undefined function`. Hex decoding therefore goes through a **manual base-16 loop** over `toupper` / `index` / `substr`. Verified exact for the 36-bit NR cell identity (NCI): `0x2FCB04A0F` decomposes to `12829346319 / 783041 / 2575` on both devices. (A 36-bit integer is exact in awk's double-precision float, but it must be printed with `%.0f`, never `%d`.)
- Verified **present** on both devices: `toupper`, `tolower`, `split` (empty fields preserved), `gsub`, `sub`, `substr`, `index`, `length`, and multiple `-v` assignments.
- ⚠️ **`printf '%(%s)T'` works on the RG501Q-EU and fails on the RM520N-GL.** The RG501Q-EU ships bash 4.4.23; the RM520N-GL ships bash 3.2.57, which predates that format. So `date +%s` **cannot** be eliminated on the reference target — and a portability check run only on the newer device would pass a real defect. Test bash-version-gated builtins on the *older* shell, always.

> ⚠️ **Git Bash / MSYS `grep` treats CRLF as a line terminator; real GNU grep does not.**
>
> ```sh
> printf 'a\r\nOK\r\n' | grep -v '^OK$'
> ```
>
> On Git Bash this outputs `a` plus a bare newline — it both matches `^OK$` against `OK` followed by a carriage return, **and strips the carriage return from the surviving line**. Real GNU grep on Linux, and BusyBox grep on the devices, keep both lines and both CRs. MSYS's `awk` and `sed` normalise CR the same way.
>
> AT responses are CRLF-terminated (verified by octal dump), so **any workstation harness that shells out to `grep`/`awk`/`sed` to model device text handling gives the opposite answer on carriage returns.** During this pass that nearly produced a false defect report against a correct rewrite. **WSL is the honest oracle** — the differential that cleared the rewrite was run there, with a BusyBox 1.36.1 multi-call binary shimmed in as `awk`/`grep`/`sed`/`cut`/`tr`/`head`.

The rewrite deliberately **reproduces** the old code's uneven carriage-return stripping field for field rather than normalising it, so old and new agree whether or not a CR is on the wire. Do not "fix" that asymmetry inside a refactor whose contract is byte-identical output.

---

## Ranked remediation

Items 1, 3 and 4 of the original list landed in the 2026-09-02 pass. **What follows is the ranking against today's code**, amortised per cycle on the RM520N-GL — the order changed substantially once the cheap wins were gone.

| # | target | status | RM520N ms/cycle | RG501Q ms/cycle | approach |
|---|---|---|---:|---:|---|
| **A** | **CA block + `poll_cycle` body** *(bucket)* | **open — largest remaining** | **149** | **176** | `AT+QCAINFO` / `parse_ca_info`, invoked inline. **Wrap it in a named function and re-profile first** — 149 ms is an upper bound on the bucket, not a measurement of the CA block. |
| **B** | **`read_ping_data`** | **open — second largest** | **105–109** | **159** | Ten `printf`-piped-to-`cut` idioms, **not** the two `jq` calls. Reconcile its three drifted copies first. See the corrected analysis below. |
| **C** | `poll_per_antenna_signal` | open | 55 *(275 per call, 1-in-5)* | 81 *(405 per call)* | 132/137 forks per call: `parse_qrsrp`/`qrsrq`/`qsinr` plus `append_signal_history`'s `jq -n -c`. One `awk`, drop the `jq`. |
| **D** | `update_data_used` | open | 46 | 63 | Not yet analysed at fork-site level. |
| **E** | `poll_tier2` | open | 38 *(567 per call, 1-in-15)* | 54 *(808 per call)* | **The biggest per-call cost in the daemon** at 268/257 forks, but it runs 1-in-15 so it amortises low. Attack as a batch of AT reads plus one parse rather than field by field. |
| **F** | `write_cache` | open | 30 | 40 | Not yet analysed at fork-site level. |
| **G** | `detect_events` | open | 25 | *(see RG501Q deltas)* | Cost tracks how many events fire, so it varies run to run by up to 77%. Measure over a long window before believing any figure. |
| 1 | `poll_serving_cell` / `parse_at.sh` | ✅ **done** | 24 | 32 | Was one AT response shredded by 184 fork sites; now a single BusyBox-`awk` pass, walked in pure bash. Realised ~140 / ~207 ms. |
| 3 | `update_system_health` | ✅ **done** | 7 | 8 | `cat`/`tr`/`find`/`nproc`/`awk`/`jq` → `read` builtins, globs, and one conditional `jq`. Realised ~59 / ~99 ms. |
| — | `check_alerts` | open | 5 | 9.5 | Small. |
| — | `append_ping_history` | open | 4.6 *(23 per call, 1-in-5)* | 6 | Small. |
| 4 | `update_proc_metrics` | ✅ **done** | **0** | **0** | `/proc/stat`, `/proc/meminfo`, `/proc/uptime` via `read` plus parameter expansion. Zero forks. Realised 62 / 84 ms. |
| — | `qcmd_exec` | ✅ **done** | folded in | folded in | Three `grep -v` filters → a pure-bash line walk. Reaches **every** AT caller, so its ~11 / ~14 ms per call is spread across all of them. |

The RM520N-GL column sums to ~493 ms against the measured whole-cycle 500 ms — the ~7 ms gap is rounding across twelve rows. That sum is the check that the attribution hangs together; if a future edit of this table stops summing to the whole-cycle figure, one of the numbers is wrong.

### Correcting item 2: where `read_ping_data`'s cost actually is

The previous edition of this document said `read_ping_data`'s 62 forks were "~10 `jq`, that alone is 111 ms" and prescribed batching the `jq` calls. **That was wrong**, and acting on it would have optimised the cheap half.

Read the function: it contains **exactly two** `jq` invocations (a metadata read and an eight-field `@tsv` read), ≈24 ms combined. Its real cost is **ten instances of this idiom**:

```sh
conn_internet_available=$(printf '%s' "$_pdata" | cut -f1)
```

Each one is ~3 fork sites — the command substitution's subshell, the pipeline segment, and the `cut` exec — so ten of them is ≈30 fork sites and **≈78 ms**, three times what the `jq` calls cost. The fix is to split the TSV in pure bash with the same suffix/prefix-trim walk `parse_serving_cell` and the history parser already use, and to leave the two `jq` calls alone.

> ⚠️ **Re-measure before optimising it.** `read_ping_data` was dropped from the 2026-09-02 pass because its baseline is stale in the strongest sense: **the repo copy and the two device copies are three different versions**, confirmed by per-function md5. The 154 / 126 ms in the historical table was measured against code that no longer exists anywhere in the repo. `scripts/test/poller-defork-forkcount.sh` (deleted with the rest of `scripts/test/` on 2026-09-03) deliberately asserted **no** ceiling on it for the same reason — a ceiling on a function whose baseline is unknown would have been red forever and told nobody anything.

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

Two more the pass added, both bash-3.2 safe:

```sh
# Splitting a delimited record with no forks (the parse_serving_cell idiom).
rest="$record"
field1="${rest%%|*}"; rest="${rest#*|}"
field2="${rest%%|*}"; rest="${rest#*|}"

# Case-insensitive compare without `tr` — bash 3.2 has no ${var,,}.
case "$state" in
    [Oo][Nn][Ll][Ii][Nn][Ee]) ... ;;
esac
```

> ⚠️ **`set -- $line` is not a drop-in replacement for `awk '{print $2}'`.** Unquoted `set --` performs word splitting **and** pathname expansion; the `awk` it replaces only ever split. Disable globbing across the split (`set -f`, restoring the prior state afterwards), or a filesystem name containing a glob metacharacter shifts every positional parameter. Fixed in `a2b367a`.

> ⚠️ **A vertical bar inside a `case` pattern reads as a pipeline to a lexical fork-site scanner.** `scripts/test/poller-defork-forkcount.sh` counted this way before it was deleted along with the rest of `scripts/test/` on 2026-09-03; there is no gate left to keep honest, but the lesson holds if this kind of scanner is ever rebuilt: write alternations as separate `case` branches rather than one alternation. It costs nothing at runtime.

---

## Method

The harness was **`scripts/test/qm_fork_probe.sh`**. **It is deleted** — the whole of `scripts/test/` was removed from the repo on 2026-09-03 — so what follows is the record of how it worked, not a script you can run. Re-measuring means rebuilding it from this description. It was **read-only with respect to production state**: everything it wrote landed in `/tmp/qmprobe/` or `/tmp/qm_fork_attribution.txt`.

> ℹ️ **NOTE:** it first existed only as a copy in `/tmp` on each device, which made this document's own "gate a redeploy on `device_md5 == local_md5`" rule unsatisfiable — there was no local copy to compare against. A power outage mid-project then wiped both devices' `/tmp`, destroying the on-device copies and the original attribution reports. It was moved into the repo for that reason, and went with `scripts/test/` when that directory was deleted.

It worked by:

1. Sourcing a **copy** of the poller with `main "$@"` disabled, so every function and every sourced lib is defined exactly as in production.
2. Redirecting every writable path constant (`CACHE_FILE`, `DATA_USED_FILE`, `EVENTS_FILE`, `_CRASH_LOG`, …) into `/tmp/qmprobe`, and stubbing the outbound dispatchers (`email_alert_send`, `sms_alert_send`, `_ae_dispatch`).
3. Replacing `qcmd` with a **record-once / replay** stub: the first call for a given AT command hits the real modem through `/usr/bin/qcmd` and its own flock; every later call replays from cache. Faithful parse input, no lock contention with the live poller, no extra AT traffic.
4. Wrapping each function `poll_cycle` calls **directly** (nested callees roll up into their caller, so nothing is double-counted) and sampling two kernel counters around each:
   - `/proc/self/stat` `cutime`+`cstime` — **exact, per-process** CPU of reaped children.
   - `/proc/stat` `processes` — system-wide fork count; noisy, reported with a measured noise floor.
5. Both samplers use **only bash builtins**, so the instrument forks zero times and does not contaminate what it measures.

**Validation:** the harness measured 27–31% of a core against the live daemon's independently measured 32.6%. The small gap is the stubbed AT transport. It reproduces the real workload closely enough to trust.

bash 3.2 compatible — the RM520N-GL ships **bash 3.2.57**, so no associative arrays. (The RG501Q-EU has 4.4.23.)

### Arguments

```bash
# $1  duration in seconds        (default 3600)
# $2  poller source to profile   (default /usr/bin/qmanager_poller)
# QMFP_KEEP_FX=1  reuse the AT fixtures recorded by the previous run
setsid nohup bash /tmp/qm_fork_probe.sh 3600 </dev/null >/tmp/qmfp.log 2>&1 &
```

An argument-free run is unchanged from the published baseline: it profiles the installed daemon and captures fresh fixtures. The report header records `poller_src`, `poller_md5`, and whether fixtures were reused, so two reports are never indistinguishable after the fact.

Checkpoints land every 25 cycles, so partial data accrues within minutes. Progress is observable at `/tmp/qmfp_heartbeat`.

### The before/after protocol

This is subtle, and getting any of it wrong produces a confident wrong answer.

**1. Build the candidate in `/tmp`, and rewrite its lib paths.** The poller sources its libraries by **absolute path**:

```sh
. /usr/lib/qmanager/parse_at.sh
```

So profiling a `/tmp` copy of the poller still loads the *installed* library — and `parse_serving_cell`, the largest single target, lives in that library. A candidate must therefore be assembled in `/tmp` with that source line rewritten to point at the candidate lib. Done properly, this is how the entire 2026-09-02 pass was measured **without a single write to `/usr/bin` or `/usr/lib` on either production device**.

**2. Pin the fixtures, then check what got captured.** The `qcmd` stub is **record-once/replay**, so the captured response decides which branch of the parser executes and therefore what the run costs. An attached 20-field LTE response drives the full field-by-field shred; a two-field

```
+QENG: "servingcell","SEARCH"
```

falls through to a near-free branch. Those are wildly different workloads, and a modem that reselects between a baseline run and a candidate run yields a "speedup" or a "regression" that is really just a different AT response. This is not theoretical: the RM520N-GL sat at RSRP −121 and was observed in SEARCH during this work.

`QMFP_KEEP_FX=1` carries the fixture directory across runs so the comparison is pinned. **Validity gate: inspect the captured fixture before trusting a run.** A pinned SEARCH fixture pins the *wrong* workload just as firmly as a good one does the right one.

**3. Trust `child_ticks`, not `fork_delta`.**

> ⚠️ **`fork_delta` degrades as a metric on a faster poller.** It is a system-wide counter, and a cheaper cycle yields the CPU sooner — so the live daemon and other background processes get scheduled inside more of the measurement window, and their forks land in the count. `read_ping_data`, which was **not modified by the pass**, went from 38 to 51 forks/call across it with completely flat `child_ticks`. Treat fork columns as directional; `child_ticks` is exact, because it is per-process.

**4. `detect_events` is not a usable control.** Two baseline runs on the same device under identical pinned fixtures differed by **77%** (22 ms against 39 ms). Its cost tracks how many events actually fire, and pinning the AT fixtures does not pin that. Use an untouched *pure-read* function as the control, or no control at all.

### Harness gotchas that cost real time

> ⚠️ **BusyBox `tr` ignores a FILE argument and reads stdin — it hangs forever, it does not error.** `tr -d x /proc/uptime` wedges the script *and* the SSH channel. Always redirect (`< file`), and pin `</dev/null` on every exec inside a benchmarking loop.

> ⚠️ **`pkill -f` / `pgrep -f` self-match.** A `-f` pattern is matched against process command lines — *including the command line of the shell running the `pkill`/`pgrep`*. `pkill -f qm_fork_probe.sh` kills its own shell; `pgrep -f qm_fork_probe.sh` always reports a match and therefore always reports "running". Kill by PID file, and check liveness with `kill -0 "$(cat /tmp/qmfp.pid)"`.

> ⚠️ **Verify the deployed md5 *against local*, not just that one exists.** A self-killed `pkill` shell skipped a `: > file` truncation, so nine `>>` appends stacked onto the previous base64 payload. `base64 -d` decoded both streams, `bash -n` passed (two valid scripts in sequence), and an entire hour was wasted running a concatenated script. The device file had **2 shebangs** and was 26965 bytes against 13662 locally. Gate the launch on `device_md5 == local_md5` — now actually possible, since the harness has a local copy.

---

## Known gaps

Four items were found during the de-fork pass and deliberately left unfixed. Each is recorded here so it is findable rather than rediscovered.

### 1. `df -P /usrdata` reports a tmpfs, not the `/usrdata` volume

On **both** devices, `df -P /usrdata` resolves to a tmpfs mount (`/etc/machine-id`) and answers something like:

```
tmpfs   126624   30036   96588   24%   /etc/machine-id
```

So System Health's `sh_storage_*` fields report the size and usage of a tmpfs rather than of the persistent `/usrdata` volume the user cares about. This is **pre-existing** — it predates the de-fork pass, which preserved it deliberately so the refactor stayed byte-identical. Fixing it is a behaviour change and needs its own change with its own validation.

### 2. `/tmp/qmanager_ping.json` carries no `last_target` on the deployed devices

`read_ping_data` reads a `last_target` field so it can name **the leg that actually answered**, falling back to `targets[0]` when it is absent. On both live devices the file carries no such key, so the fallback is always taken and the "name the winning leg" behaviour is inert — the reported target is whatever is configured first, even on a link where that target never replies.

The repo's `scripts/usr/bin/qmanager_ping` **does** emit `last_target`, so what was observed is producer/consumer version drift on the *installed* copies, not a missing feature in the tree. **Re-verify after the next install before assuming it is still inert.** See [`connection-quality.md`](./connection-quality.md) for the producer's full key contract.

### 3. `qcmd_exec` has a dead `*ERROR*` branch, and a dead caller path behind it

```sh
case "$result" in
    *ERROR*)
        qlog_debug "qcmd_exec AT ERROR: cmd=${cmd}"
        echo "$result"
        return 2
        ;;
esac
```

`qcmd` reports failure by **exit code and stderr**; it never writes `ERROR` to stdout. So this branch cannot fire, `qcmd_exec` never returns 2 — and `poll_serving_cell`'s `if [ $rc -eq 0 ] || [ $rc -eq 2 ]` guard tests against a value that never arrives, making that half of the condition dead too. Same family as the sites swept repo-wide in `b4d87ef`; see [`at-command-transport.md`](./at-command-transport.md) for how `qcmd` actually signals failure. Left in place by the de-fork pass because removing it is a behaviour change, not a refactor.

### 4. `read_ping_data` has drifted three ways, and is the largest remaining *measured* cost

The repo copy, the RM520N-GL copy and the RG501Q-EU copy are **three different versions** (confirmed by per-function md5). At 105–109 ms (RM520N-GL) and 159 ms (RG501Q-EU) against the current repo copy, it is second only to the CA-block bucket — and it is the largest cost that is measured per-function rather than inferred from a residual. Reconcile the three copies before optimising, and target the ten `printf`-piped-to-`cut` idioms rather than the two `jq` calls — see [Correcting item 2](#correcting-item-2-where-read_ping_datas-cost-actually-is).

---

## The compiled-language comparison

A Go equivalent was built and run **on both devices** doing genuinely comparable work: the same `/proc` and sysfs reads, the same 8 real AT responses parsed field-by-field from the fixtures captured off each device, and an atomic JSON write.

| | shell poller (baseline) | shell poller (de-forked) | Go equivalent |
|---|---:|---:|---:|
| CPU per cycle, RM520N-GL | 815 ms | ~500 ms | **2.39 ms** |
| CPU per cycle, RG501Q-EU | 1150 ms | ~664 ms | **2.84 ms** |
| forks per cycle | ~220 | four functions de-forked (`parse_serving_cell` alone 184→3 sites) | **0** |
| RSS | — | — | 6.3 MB |

**Caveat, stated plainly:** the benchmark emits a 1012-byte JSON against the real 5234-byte cache and omits the events, alerts, history, and data-counter state machines. It is a lower bound, not the finished article. But even assuming the real port is **10× more work**, that is ~24 ms/cycle — still **under 1% of a core**.

### Binary size (Go 1.26.2, `GOOS=linux GOARCH=arm GOARM=7 CGO_ENABLED=0`, `-trimpath -ldflags="-s -w"`)

| build | stripped |
|---|---:|
| bare `main` (runtime floor) | 1408 K |
| + `regexp` | 1664 K |
| + `encoding/json` | 1728 K |
| **realistic poller skeleton, hand-rolled JSON** | **1728 K** |
| same + `fmt` + `encoding/json` | 2112 K |
| **+ `net/http`** | **6016 K** |

> ⚠️ **`net/http` is the size trap, not `regexp`.** `regexp` costs +256 K and is fine to use; `net/http` adds ~3.9 MB on its own. `encoding/json` (+320 K, drags in `reflect`) is affordable but avoidable — hand-rolling JSON emission with `strconv.AppendInt` into a byte slice is ~40 lines and keeps the binary at the floor.

`-ldflags="-s -w"` is worth a consistent ~30% and is not optional. A full port adds *code* but no new runtime, so it projects to **~2.0–2.5 MB stripped** — inside a 3 MB budget on devices with ~20 MB of writable `/opt`.

**RAM, not disk, is the real cost.** 6.3 MB RSS against 182 MB total (RM520N-GL) / 230 MB (RG501Q-EU). Go's runtime and GC baseline is heavier than bash's; tune with `GOGC`/`GOMEMLIMIT` and measure against the bash poller's RSS before claiming a win. Hard-float is confirmed fine on both SoCs.

---

## Hot-path re-author (T1.1, 2026-10-26)

RM520N-GL `61368cd2`, 300 s windows against the live AT transport (no replay stub), so these figures include the `qcmd` cost the 2026-09 runs stubbed out. Plan and raw numbers: `.orchestra/runs/2026-10-26-atd-port-T1.1.md`.

| step | poller CPU/cycle | % of core | period |
|---|---:|---:|---:|
| before (HEAD at 2026-10-26) | 874 ms | 27.4 | 3.19 s |
| one `date +%s` per cycle, `data_used` printf write + change-gated persist, DNS read gated on mtime, crash counter via `read` | 759 ms | 24.6 | 3.09 s |
| single-awk `parse_ca_info`, builtin `parse_serving_cell`, SCC checks gated | 426 ms | 15.6 | 2.73 s |
| per-antenna parse and history appends without forks | **344 ms** | **13.0–13.1** | 2.63–2.65 s |

Profile of the final build (55 cycles, 371 ms instrumented): `AT+QCAINFO` 70 ms, serving cell 54, Tier 2 52 (≈ 700 per run, every ~14 cycles), `write_cache` 38, `read_ping_data` 25, `update_system_health` 21, `detect_events` 18, per-antenna 10.5. A printf `write_cache` composer was dropped: it saves at most ~30 ms and would rebuild every `status.json` field.

> ⚠️ WARNING: **bash 3.2 `read` leaks memory when its last variable receives several words.** On the RM520N-GL each such `read` keeps ~17 bytes, which grew the poller's RSS by ~45 kB per hour (found in the 12 h soak, 2026-10-27). `update_proc_metrics` (`/proc/stat`) and the `/proc/loadavg` read now take the whole line with `IFS= read -r` and split it with `set --`. Any new `read` in a long-running daemon must give its last variable a single word, or read the line whole.

## Activity tiers (T6.1, 2026-10-27)

RM520N-GL `61368cd2`, 300 s windows from `/proc/<pid>/stat` (method as above), cycles counted from `status.json` `.mono` changes. Tiers are described in [`adaptive-polling.md`](./adaptive-polling.md).

| window | poller ms/cycle | % of core | system busy | period |
|---|---:|---:|---:|---:|
| pre-T6.1 poller, no browser | 366 | 14.0 | 22.8 | 2.6 s |
| `active` (dashboard open) | 347 | 12.9 | 37.5 | 2.7 s |
| `idle` (20 s – 5 min after the last fetch) | 182 | 8.1 | 16.7 | 2.24 s |
| `deep` (> 5 min) | 128 | 6.0 | 14.7–15.0 | 2.14 s |

What remains in `deep` is the local work that runs every cycle in every tier (proc metrics, ping reads, alerts, Data Used, `write_cache`).

## Dashboard CGI cost (T6.2, 2026-10-27/28)

RM520N-GL `61368cd2`. Plan, census and raw numbers: `.orchestra/runs/2026-10-26-atd-port-T6.2.md`.

With `/dashboard` open, the CGIs the page polls cost about as much again as the poller's own `active`-tier work. The poller is not the only fork-heavy shell on the device: every CGI is a fresh `#!/bin/sh` (BusyBox ash) process that sources `cgi_base.sh` and runs `require_auth` before it does anything, so the same fork+exec cost described above is paid **per HTTP request**.

### Method

- **CGI CPU per request.** lighttpd's `mod_cgi` reaps each CGI, so a CGI's CPU (and its children's) lands in lighttpd's `cutime`+`cstime` (`/proc/<lighttpd pid>/stat` fields 16–17). 20 sequential `curl -sk` calls per endpoint through lighttpd as www-data, with a throwaway minted session; the delta divided by 20. Resolution 0.5 ms.
- **Forks.** Delta of the `processes` line in `/proc/stat`. `/proc/sys/kernel/ns_last_pid` does not exist on this kernel, so there is no exact per-PID counter. Under live traffic the counter carries the poller's background (14.4 forks/s, in bursts of ≈ 39 per cycle), so the census column below is ± ≈ 2 per call. The before/after fork figures for the floor come from direct runs under `sudo -n -u www-data` with no browser open, reported as the minimum/median.
- **System busy.** 300 s windows of the `/proc/stat` `cpu` line, poller held in `active`, as in T1.2.

### The per-request floor

The cheapest endpoint, `at_cmd/speedtest_status.sh`, costs **39 ms of CPU**: that is `cgi_base.sh` + auth before the script does any work. An authenticated trivial GET forked **19 times before S1, 2 after** (direct runs, 2026-10-28). Removed:

| fork site | file | replaced by |
|---|---|---|
| `$(id -u)` | `platform.sh` | builtin `read` loop over `/proc/self/status` (`Uid:` line, 2nd value); falls back to `id -u` if unreadable |
| `/opt/bin/timeout 1 true` probe (2 processes) | `platform.sh` | deferred to the first `qm_timeout` call when `GATEWAY_INTERFACE` is set (lighttpd CGI); still eager for daemons |
| `$(dirname "$QLOG_FILE")` | `qlog.sh` | `${QLOG_FILE%/*}` |
| `$(printf … \| awk …)` cookie read | `cgi_auth.sh` | `qm_cookie_var NAME VAR` (parameter expansion, no subshell) |
| `printf … \| grep -qE '^[0-9a-f]{64}$'` token check | `cgi_auth.sh` | `${#1}` = 64 plus `case *[!0-9a-f]*` |
| `$(cat "$_session_file")` | `cgi_auth.sh` | `IFS= read -r`, accepting a file with no trailing newline |
| two `jq -n` response bodies | `auth/check.sh` | `printf` of the same bytes (2-space, LF) |

What is left: `$(date +%s)` in `qm_validate_session` (kept on purpose) and one fork not identified.

### Per-endpoint cost (before, 2026-10-27 23:24 PST)

| endpoint | wall ms | CGI CPU ms | lighttpd own ms | forks | bytes |
|---|---:|---:|---:|---:|---:|
| `at_cmd/fetch_data.sh` | 111 | 41.5 | 20.5 | 19.5 | 6 190 |
| `network/data_used.sh` | 165 | 82.0 | 20.5 | 28.1 | 245 |
| `system/modem-subsys.sh` | 118 | 58.5 | 20.5 | 18.1 | 564 |
| `at_cmd/fetch_signal_history.sh` | 149 | 73.5 | 26.5 | 16.8 | 79 051 |
| `at_cmd/fetch_events.sh` | 112 | 54.5 | 20.0 | 16.8 | 4 506 |
| `at_cmd/fetch_ping_history.sh` | 678 | **428.5** | **96.0** | 20.0 | **1 011 274** |
| `auth/check.sh` | 106 | 49.5 | 20.0 | 15.0 | 28 |
| `at_cmd/speedtest_status.sh` | 90 | 39.0 | 20.0 | 12.7 | 18 |
| `speedtest_check.sh` (one-shot) | 107 | 49.5 | 20.5 | 15.3 | 24 |
| `system/settings.sh` (one-shot) | 378 | 296.0 | 20.5 | 71.3 | 684 |

"lighttpd own" is mostly the TLS handshake `curl` makes on every call. A browser reuses its connection, so that column overstates the browser's cost and was left out of the ranking.

At the dashboard's census cadence the CGIs alone cost **13.8 points of the core** (137.8 ms/s at 2.19 req/s). The largest single items were `data_used.sh` and `modem-subsys.sh` (both 2 s, both reshapes of `/tmp/qmanager_status.json`, which `fetch_data.sh` already returns whole) and three separate `useModemStatus` timers.

### System busy, dashboard closed vs open

| window (PST, 2026-10-27) | what ran | system busy | lighttpd tree | poller tree |
|---|---|---:|---:|---:|
| 23:25:24–23:30:28 | closed: heartbeat only, as www-data every 10 s | **21.0 %** | 0.0 % | 14.1 % |
| 23:30:31–23:36:41 | open: replay of the census cadence, one `curl` per 1 s tick | **36.6 %** | **13.0 %** | 13.2 % |

+15.6 points open. The replay ran at 0.81 of the census cadence, so at full cadence the lighttpd tree is ≈ 16 %; the tree includes lighttpd's own TLS time; ≈ 2.6 points of the rest are the on-device `curl`, which a real browser does not cost the modem.

### What changed

| slice | commit | change |
|---|---|---|
| S1 | `acd61473`, `fc8a49dc` | The per-request floor de-fork above. Affects every CGI on every page. |
| S2 | `8990154e` | `fetch_ping_history.sh?last=N` (digits only, else ignored) serves the newest N rows through `serve_ndjson_as_array`'s existing cap. No parameter = the whole 24 h file, byte-identical to before. |
| S3 | `b220c169` | `useModemStatus` is one module-level store with one timer; see [`adaptive-polling.md`](./adaptive-polling.md) invariant 6. The SIM-swap banner and the sidebar watchdog row now ask for 10 s instead of 2 s / 15 s. |
| S4 | `38ac76b8` | The dashboard's device-metrics card reads `.data_used` and `.system_health.storage` from the shared status payload. `useDataUsed` became `useDataUsedReset` (the reset POST only), so `data_used.sh` and `modem-subsys.sh` are no longer polled from `/dashboard`. |
| S5 | `86fb7006` | Signal history, recent events, latency history and the auto-logout check run on `lib/visible-interval.ts`; the speedtest status loop has its own hidden-tab gate. The dashboard's latency strip asks for `?last=400` (30 min needs ≤ 240 rows at the 10–16 s row cadence). |

> ⚠️ WARNING: the timeout-probe deferral is scoped to CGI context on purpose. Root daemons (`qmanager_ping`, `qmanager_health_check`) call `qm_timeout` inside `$(…)`; a lazy probe there would run in the subshell and be thrown away, so it would re-probe on every call. Keep `[ -n "${GATEWAY_INTERFACE:-}" ] || _qm_timeout_probe` as it is.

### After-build device numbers

Measured on RM520N-GL 61368cd2, 2026-10-28 10:43–11:08 PST, on T3.1's install tree (v0.1.18-draft). Backend only (4 libs + 2 CGIs) was deployed for the run and then restored. The frontend was not deployed: the "new" window replays the built dashboard's request pattern (`fetch_data.sh` every 5 s, the four 10 s pollers, `fetch_ping_history.sh?last=400` every 30 s). Every window ran at 0.98–0.99 of its nominal cadence, with `curl` in the background so ticks stayed 1 s apart.

| window (300 s) | system busy | CGI (lighttpd cutime) | lighttpd own |
|---|---:|---:|---:|
| closed (heartbeat only) | 20.9 % | 0.0 % | 0.0 % |
| open, old pattern, old backend | 36.0 % | 12.5 % | 1.5 % |
| open, old pattern, new backend | 30.7 % | 7.2 % | 1.6 % |
| **open, new pattern, new backend** | **22.3 %** | **1.4 %** | 0.5 % |

The CGIs went from 12.5 % to 1.4 % of the core with the dashboard open. About 5 points of that came from the backend de-fork and the rest from the frontend cuts. System busy is now 1.4 points above closed, against 15.1 points before.

| per call (20 calls, CGI CPU) | before | after |
|---|---:|---:|
| `speedtest_status.sh` (the floor) | 39.0 ms | 15.0 ms |
| `fetch_data.sh` | 41.5 ms | 17.5 ms |
| `auth/check.sh` | 50.0 ms | 14.0 ms |
| `fetch_events.sh` | 53.5 ms | 29.0 ms |

Forks per authenticated request: 19 → 2 (portability checker, direct runs). The fork column of the 20-call loop is too noisy for this, because the poller adds 16–27 forks/s in the background.

Tier: with `fetch_data.sh` every 10 s (the shared store's cap), the poller stayed `active` in all 12 samples over 60 s, so a 30–60 s ping interval cannot drop an open page out of `active`. No `interval_sec` write was needed, because the tier depends only on heartbeat age.

Not measured on the device:
- The 1 MB ping-history cut: T3.1's install had cleared `/tmp`, so the archive was 17 KB. Measured 2026-10-31, see below.
- A real browser's lighttpd own CPU (keep-alive). The replay's 0.5 % is an upper bound with one TLS handshake per tick.
- The hidden-tab gate. It was verified in the browser pane off-device: 0 requests while hidden.

### Follow-ups (2026-10-31)

Measured on RM520N-GL 61368cd2 through lighttpd (per call, minted session) and old vs new as direct www-data runs of `/tmp` copies. Results file: `.orchestra/runs/2026-10-31-cgi-cost.md`.

| item | before | after |
|---|---:|---:|
| `system/settings.sh` GET (one `jq` for every key, `set --` for the tz fields; same body except odd values the old `echo` mangled, e.g. a hostname of `-n`) | 276 ms, 57 forks | 83 ms, 15 forks |
| `fetch_ping_history.sh`, full 1.16 MB archive vs `?last=400` (CGI + lighttpd own) | 536 ms | 74.5 ms |
| `useModemStatus` default (17.5 ms per `fetch_data.sh`) | 2 s = 0.88 pts | 5 s = 0.35 pts; config-only pages 10 s = 0.18 pts |

- `device/about.sh` costs ≈ 187 ms, almost all of it the two public-IP `curl` calls (≈ 100 ms CPU each). Cutting its other forks (38 → 20) did not move CPU, so it was not shipped; caching the public IP is the real cut.
- lighttpd keep-alive: the idle timeout is lighttpd's default 5 s (a second request on one TLS connection is answered after a 4 s gap, not after 6 s). A new TLS connection costs ≈ 17.5 ms of lighttpd's own CPU against 2.5 ms on a reused one. Every dashboard stream polls slower than 5 s, so the upper bound is ≈ 1.1 points. `server.max-keep-alive-idle = 30` in the installer-managed `lighttpd.conf` would remove it (proposed, not shipped).

---

## Recommendation

> ℹ️ NOTE: this section was written after the 2026-09 pass. T1.1 (2026-10-26) has since done items A and C (single-awk `parse_ca_info`, fork-free per-antenna parse) and measured `read_ping_data` at 25 ms/cycle; see [Hot-path re-author](#hot-path-re-author-t11-2026-10-26) for what is left.

**Continue the shell de-fork pass.** The 2026-09-02 pass took the four cheapest wins and realised 41–44% for a few days of low-risk work that stays reviewable and debuggable on-device.

The next step is **item A, the CA block** — but the first move there is *not* a rewrite. Wrap `AT+QCAINFO` and `parse_ca_info` into a named function so the harness attributes them, and re-profile. Until that is done, 149 ms is the cost of a bucket that also contains `poll_cycle`'s own inline body, and nobody knows how it splits. **Item B (`read_ping_data`)** is the largest cleanly-measured cost and needs its three drifted copies reconciled before any optimisation; **item C (`poll_per_antenna_signal`)** is the same kind of mechanical change the pass has already done four times. Those three are worth roughly another 60% of what remains.

A rewrite's case rests on **where the architecture should go** — a resident AT transport, event-driven rather than polling — not on whether the CPU is recoverable. (The resident AT transport now exists: `qmanager_atd` serves `qcmd` on the RM520N-GL since T4.1, see [`at-command-transport.md`](./at-command-transport.md). Its CPU gain for the poller was estimated at only ≈ 2.5–3 points of a core; it was adopted to retire `atcli_smd11` / `sms_tool` and to remove the SMS lock hold.) It plainly is, and the de-fork pass has now demonstrated that on hardware. At 1.7 MB measured, binary size is not the obstacle either.

Whichever path is taken, a port must reproduce these contracts exactly, and they — not the coding — are the real cost:

- the `/tmp/qmanager_status.json` schema every CGI reads as a thin cache
- the cross-UID `/tmp` ownership rules (see [`tmp-file-ownership.md`](./tmp-file-ownership.md))
- `flock` serialisation against the CGI layer (see [`at-command-transport.md`](./at-command-transport.md)) — bit-identical, or AT responses corrupt
- events, alerts, the persistent Data Used counter, crash watcher, SIM registry
- the 1970 boot window (see [`scheduled-timers.md`](./scheduled-timers.md))
