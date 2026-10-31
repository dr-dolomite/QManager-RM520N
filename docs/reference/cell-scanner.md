# Cell Scanner (`/cellular/cell-scanner/**`)

> **Applies to:** RM520N-GL (SDX65) · verified 2026-08
> **RG501Q-EU (SDX55):** unverified — see [`platform-matrix.md`](./platform-matrix.md)

**Three routes share one prefix and one visual vocabulary, and exactly two of them talk to the modem — at costs that differ by roughly 100x.** A full sweep (`AT+QSCAN=3,1`) holds the single global AT mutex for 30–180 seconds and pauses every other modem operation on the device, including the poller that feeds the dashboard you are reading the page on. A neighbour read (`AT+QENG="neighbourcell"`) holds the same mutex for about two seconds. The frequency calculator holds nothing — it is browser arithmetic. That asymmetry is the organising idea of the whole surface, and most of what follows exists to keep it visible.

This doc records the invariants and sharp edges a contributor needs **before** touching the family: the single `flock` that makes the two scanning routes mutually exclusive and how it survives the CGI that took it, why the two routes are deliberately not merged, the long-running flag contract (who raises it, and why this worker must not), why this surface keeps signal thresholds that disagree with the rest of the product, why `0` is a sentinel rather than a reading, why the two result types were not widened into one, and why the calculator takes the family's anchor geometry while taking none of its run vocabulary.

The rationale for the individual design moves lives in the commits (`a2394ee`, `e4e5441`, `5871e8c`, `16d129c`, and the 2026-10-06 the101 adoption). This doc does not restate them.

## Quick Reference

| Thing | Where |
| ----- | ----- |
| Full sweep route | `/cellular/cell-scanner` (`app/cellular/cell-scanner/page.tsx`) |
| Neighbour read route | `/cellular/cell-scanner/neighbourcell-scanner` |
| Frequency calculator route | `/cellular/cell-scanner/frequency-calculator` |
| Calculator coordinator | `components/cellular/cell-scanner/freq-calculator/calculator.tsx` |
| Calculator types + arithmetic (pure, no copy) | `components/cellular/cell-scanner/freq-calculator/calc-model.ts` |
| Calculator answer rail (the anchor's right column) | `components/cellular/cell-scanner/freq-calculator/calc-readout.tsx` |
| Calculator band table (one well, DL/UL sections) + agreement verdict | `components/cellular/cell-scanner/freq-calculator/band-tiles.tsx` |
| Calculator history list | `components/cellular/cell-scanner/freq-calculator/history-list.tsx` |
| Band tables + channel↔frequency maths | `lib/earfcn.ts` |
| Geometry + tone contract (all three routes) | `components/cellular/cell-scanner/shapes.ts` |
| Result + transport types | `types/cell-scanner.ts` |
| Full-sweep coordinator | `components/cellular/cell-scanner/scanner.tsx` |
| Neighbour coordinator | `components/cellular/cell-scanner/neighbourcell/neighbour-scanner.tsx` |
| Shared run hero (launch bar → ledger status cell, progress bar) | `components/cellular/cell-scanner/run-hero.tsx` |
| Shared ledger rows (`LedgerRows`, one row per carrier or relation) | `components/cellular/cell-scanner/run-summary.tsx` |
| **All** derived aggregates (pure, no copy) | `components/cellular/cell-scanner/summaries.ts` |
| Signal sort: unmeasured rows last in both directions | `components/cellular/cell-scanner/sort.ts` |
| SIM's home network from the IMSI (`simPlmnFromImsi`, `cellMatchesSim`) | `components/cellular/cell-scanner/sim-plmn.ts` |
| Shared cross-route link | `components/cellular/cell-scanner/sibling-link.tsx` |
| Shared under-table strip | `components/cellular/cell-scanner/table-note.tsx` |
| Shared empty / error panels | `components/cellular/cell-scanner/scan-states.tsx` |
| Shared results table (toolbar: filter, Download CSV, Columns; pager only when the set pages) | `components/cellular/cell-scanner/scan-table.tsx` |
| Shared skeleton | `components/cellular/cell-scanner/scanner-skeleton.tsx` |
| Shared signal + identity chips | `components/cellular/cell-scanner/signal-badges.tsx` |
| Shared lock dialog (**owns the write**) | `components/cellular/cell-scanner/lock-cell-dialog.tsx` |
| Full-sweep hook | `hooks/use-cell-scanner.ts` (2 s poll) |
| Neighbour hook | `hooks/use-neighbour-scanner.ts` (1 s poll) |
| Start a sweep | `POST /cgi-bin/quecmanager/at_cmd/cell_scan_start.sh` |
| Poll a sweep | `GET  …/at_cmd/cell_scan_status.sh` |
| Start a neighbour read | `POST …/at_cmd/neighbour_scan_start.sh` |
| Poll a neighbour read | `GET  …/at_cmd/neighbour_scan_status.sh` |
| Sweep worker | `scripts/usr/bin/qmanager_cell_scanner` |
| Neighbour worker | `scripts/usr/bin/qmanager_neighbour_scanner` |
| Lock a scanned cell | `POST …/tower/lock.sh` — see [tower-locking.md](tower-locking.md) |
| i18n | `cell_scanner.*` in `public/locales/{en,zh-CN,zh-TW,it,id}/cellular.json` (**238 paths in `en`**, covering all three routes — `cell_scanner.neighbour.*` (**57 paths**) and `cell_scanner.calculator.*` (**73 paths**) are subtrees. The whole family had **zero** i18n before 2026-08-12; the 2026-10-06 the101 adoption took it 231 → 238, +15 keys for the ledger, progress bar, short link label and SIM lock reason, −8 for the retired summary tiles). All five locales carry the same 238 |
| SIM IMSI (lock gating) | `useModemStatus({ pollInterval: 10000 })` → `device.imsi`, read in `scanner.tsx` |

### Runtime files

| Path | Owner | Written by | Meaning |
| ---- | ----- | ---------- | ------- |
| `/tmp/qmanager_scan.lock` | www-data | either start endpoint (lazily, empty) | **The singleton.** One `flock` shared by both scan types — see [The scan singleton](#the-scan-singleton-one-flock-two-routes) |
| `/tmp/qmanager_cell_scan.pid` | www-data | `cell_scan_start.sh`, then `qmanager_cell_scanner` (same value) | **Identification only** — which sweep holds the lock, never whether one is running |
| `/tmp/qmanager_cell_scan_result.json` | www-data | `qmanager_cell_scanner` | Final JSON array of cells |
| `/tmp/qmanager_cell_scan_error` | www-data | `qmanager_cell_scanner` | Error text; read **non-destructively**, cleared by the next scan start |
| `/tmp/qmanager_neighbour_scan.pid` | www-data | `neighbour_scan_start.sh`, then `qmanager_neighbour_scanner` (same value) | Identification only, as above |
| `/tmp/qmanager_neighbour_scan_result.json` | www-data | `qmanager_neighbour_scanner` | Final JSON array |
| `/tmp/qmanager_neighbour_scan_error` | www-data | `qmanager_neighbour_scanner` | Error text, read non-destructively |
| `/tmp/qmanager_neighbour_scan_{lte,nr}_err.tmp` | www-data | `qmanager_neighbour_scanner` | Per-leg captured `qcmd` stderr; how `modem_busy` is told apart from a real AT failure. Removed by the worker's `EXIT` trap |
| `/run/qmanager_at/long_running` | root 0644 | the `qmanager_atd` broker, around `AT+QSCAN` | Maintenance flag — see [the contract](#the-long-running-flag-contract) |
| `/run/qmanager_at/at.lock` | root:dialout 0640 | `qmanager_setup` creates it; `qcmd` locks it | The single global AT mutex (not in `/tmp` since T4.3) |

> ℹ️ **The pid files are not a gate.** Both start endpoints used to enforce "one at a time" by testing their own pid file; they now enforce it with the `flock` above and keep the pid file only to decide *which* of two messages to show. `pid_alive()` is `[ -d /proc/$1 ]` (`platform.sh`) — it proves *a* process with that number exists, never that it is our worker, so it must never be load-bearing for exclusion again.

### AT commands this surface issues

| Operation | Command | Sent by |
| --------- | ------- | ------- |
| Full sweep, LTE + NR5G, extended fields | `AT+QSCAN=3,1` | `qmanager_cell_scanner:60` |
| LTE neighbours | `AT+QENG="neighbourcell"` | `qmanager_neighbour_scanner:57` |
| Enable NR5G measurement reporting | `AT+QNWCFG="nr5g_meas_info",1` | `qmanager_neighbour_scanner:115` |
| Read NR5G measurements | `AT+QNWCFG="nr5g_meas_info"` | `qmanager_neighbour_scanner:119` |

The frequency calculator issues **nothing**. It has no fetch and no AT contact, which is why it has no posture chip, no elapsed clock, no spinner and no cost statement — nothing is spent. It *does* take the family's anchor card, at `rounded-hero`, via `CALC_HERO` and its own `CALC_SPLIT` — see [The calculator takes the anchor, not the run](#the-calculator-takes-the-anchor-not-the-run).

## The cost asymmetry, and why the routes are not merged

`qcmd` serialises every AT command in the product on `flock` over `/run/qmanager_at/at.lock` (see [at-command-transport.md > qcmd serialization](at-command-transport.md#qcmd-serialization)). "flock" is an advisory file lock — a do-not-disturb sign on the file that only one process may hold at a time — so while a sweep holds it, nothing else on the device can reach the modem.

`qcmd` classifies commands into two wait budgets:

| Class | Match | Lock wait |
| ----- | ----- | --------- |
| Long | substring `QSCAN`, `QSCANFREQ`, `QFOTADL`, `COPS=2`, `COPS=0`, plus `/etc/qmanager/long_commands.list` | 10 s |
| Everything else | — | 5 s |

`AT+QENG` is **not** long. While a sweep's `AT+QSCAN` runs, the broker holds `/run/qmanager_at/long_running` up, so a neighbour read fired during a sweep gets `modem_busy` at once (exit 1, `ERROR: modem_busy` on stderr) instead of waiting out a lock that will be held for up to three minutes. The neighbour worker treats a non-zero `qcmd` exit as "skip this half" (`qmanager_neighbour_scanner:62`, `:122`).

**What that produced depended on how the two runs overlapped, and the distinction matters when you are debugging one.** A neighbour read makes *two* separately-locked AT calls with a `sleep 1` between them, so a sweep can block one leg and miss the other:

| Overlap | `lte_rc` / `nr_rc` | Old outcome | Now |
| ------- | ------------------ | ----------- | --- |
| **Total** — the sweep holds the mutex across both legs | both non-zero | A **real error**: the `[ $lte_rc -ne 0 ] && [ $nr_rc -ne 0 ]` branch wrote `"Both AT commands failed"` to the error file and exited 1 | Same branch, but it now names the cause: if either leg's captured stderr says `modem_busy`, the message is *"The modem is busy with another operation"* rather than a generic AT failure |
| **Partial** — the sweep releases the mutex between the legs, so one leg runs and finds nothing | exactly one non-zero | The **silent lie**: `both failed` was false, so the worker fell through to "no neighbour cells found", wrote `[]`, and the UI reported a confident *"complete — 0 cells"* | A new branch reports it as an error naming the failed leg (*"The modem was busy during the LTE read. Results are incomplete"*) |
| **Partial, and the surviving leg found real rows** | exactly one non-zero | Reported as-is | Still reported as-is — genuine partial data is not a lie. The missing leg is logged to `qlog` (the JSON envelope has no field for it) |

> ℹ️ Earlier revisions of this doc claimed that *any* neighbour read fired during a sweep failed silently with a plausible empty table. That was only ever true of the partial overlap. If you are chasing a report of an empty neighbour table, the thing to check is whether the sweep released the mutex between the two legs — a total collision has always written a real error and always will.

Since 2026-08-12 none of this should be reachable from the UI at all: the [scan singleton](#the-scan-singleton-one-flock-two-routes) refuses the second scan up front with `other_scan_running`. The behaviour above remains the fallback for a worker started outside the CGI (by hand over SSH, say), and for any AT consumer other than a scan holding the mutex.

**The cost asymmetry is also why the two routes are deliberately NOT merged.** They read as one feature and share seven modules, but merging them into one route with a mode toggle would put a three-minute modem freeze one click away from a two-second read. Before the 2026-08 rebuild both routes shipped a button reading the identical string "Start New Scan"; the sweep's action now reads "Sweep all bands" and the neighbour route's reads "Read neighbours".

> ⚠️ **The `COST` slot is gone (2026-08-14, user decision).** The run hero used to carry a *required* `costText` paragraph on both routes — three lines explaining the sweep's 2–3 minute modem freeze, two explaining that a neighbour read costs nothing. It read as a lecture, and it was removed along with `COST`, `SKELETON_SHAPE.COST` and the hero's `costText` prop, plus the `cell_scanner.run.cost` / `cell_scanner.neighbour.run.cost` keys in all five locale packs. The asymmetry is still expressed — by the two distinct button labels, by each route's `scanning_body`, and by the cross-link that disables itself *with its reason* while a run is in flight — but it is no longer a standing paragraph. **Do not restore the slot in a later canon pass.**

Corollaries that follow from the same asymmetry, and should not be "harmonised" away:

- The sweep hook polls every **2 s**; the neighbour hook polls every **1 s** (`use-cell-scanner.ts:15`, `use-neighbour-scanner.ts:41`). A sweep that answers in 180 s does not deserve 180 requests; a read that answers in 2 s should not spend a whole extra poll waiting.
- The sweep route has a `beforeunload` guard (`use-cell-scanner.ts:236-245`); the neighbour route deliberately does not. Losing a two-second read costs nothing, so prompting over it would invent a stake the operation does not have.
- Only the sweep shows a progress bar. `useCellScanner`'s `elapsedSeconds` feeds `estimateScanProgress()` in `scanner.tsx`; the neighbour route passes no `progress`, so its running state is the spinner and skeleton rows only — see [The progress bar is an estimate](#the-progress-bar-is-an-estimate-sweep-only).

## What the two runs are called

**Four titles were reworded on 2026-08-24. No key was added or removed** — the family was 225 paths in `en` at the time, all five packs moved together, and `bun run i18n:check` was clean at `strict` before and after.

| Key | Was | Now |
| --- | --- | --- |
| `cell_scanner.run.title` | "Full band sweep" | "Full network sweep" |
| `cell_scanner.neighbour.run.title` | "Neighbour read" | "Neighbourcell scan" |
| `cell_scanner.neighbour.run.description` | "One question to the serving cell, answered from what it already measures." | "Requests the neighbour cells the serving tower already tracks, without sweeping additional bands." |
| `cell_scanner.neighbour.results.title` | "Neighbours reported" | "Neighbourcell reports" |

The sweep's title named the **mechanism** — a pass across every band — where what the reader gets back is every network the modem can hear from where it is standing, bands and connections together. "Full network sweep" names the finding. On the neighbour route the two titles are now a matched pair: a *scan* produces *reports*, so the hero and the results card below it stop using two unrelated nouns for one act, and the description says what is requested and what is explicitly not swept.

> ℹ️ **The button labels were deliberately left alone.** "Sweep all bands" and "Read neighbours" are load-bearing — they are one of the three things still carrying the [cost asymmetry](#the-cost-asymmetry-and-why-the-routes-are-not-merged) since the `COST` slot was retired. A title rename does not touch that argument, and harmonising the buttons with the new titles would.

## Cross-navigation between the two routes

Until 2026-08-12 there was **no path between the sweep and the neighbour read except the sidebar**, on a surface whose whole argument is that these are two answers to one question at prices that differ by 100x. Each hero header now carries a link to the sibling route (`sibling-link.tsx`), in the slot the retired posture chip used to occupy.

On the sweep the link takes `shortLabel` ("Neighbors", `cell_scanner.run.link_neighbour_short`) below `@xl/section`, and `label` stays its accessible name; below that width `RUN_HERO_META` puts the link on the left edge and the action on the right.

The calculator's anchor carries the same component in the same slot, pointing at the full sweep — and it passes **no** `blockedReason`, because nothing runs there to block it.

The link is blocked while a run is in flight on that route, because the [scan singleton](#the-scan-singleton-one-flock-two-routes) would refuse the second scan with `other_scan_running` anyway. It is blocked with `aria-disabled` and a tooltip carrying the reason, **never** with `disabled`: a disabled button is not focusable and receives no pointer events, so the reason would be unreachable by exactly the users who most need it (DESIGN.md > The State-Honesty Rule).

> ℹ️ **The block is keyed on the route's OWN posture, not on the singleton.** A sweep running on the other route is not observable from here — there is no cross-scan status endpoint, and polling the sibling's status file to find out would add a request per second to a modem that is deliberately busy. So the link stays enabled during the other route's run and the refusal is reported at the far end, by the hook, with copy that names the wait. Closing that gap needs a transport change, not a UI one.

## The scan singleton: one `flock`, two routes

**Short version: both start endpoints take an exclusive lock on the same file, `/tmp/qmanager_scan.lock`, and then hand that lock to the worker they spawn. Whichever scan gets there first owns the modem until it finishes; the second one is refused immediately with a stated reason instead of being launched into a three-minute wait it cannot explain.**

`flock` is an advisory lock — a do-not-disturb sign on a file that only one process may hold at a time. The non-obvious part here is *who* holds it. Both endpoints do the same four things:

```sh
[ -e "$SCAN_LOCK" ] || : > "$SCAN_LOCK"   # 1. create it lazily — the redirect below fails if absent
exec 9<"$SCAN_LOCK"                        # 2. open it READ-ONLY on fd 9
flock -x -n 9 || { … refuse … }            # 3. take it exclusively, non-blocking
( "$SCANNER_BIN" … & echo $! > "$PID_FILE" )  # 4. spawn the worker, which INHERITS fd 9
```

Then the CGI exits — and the lock stays held.

**That works because a `flock` lives on the *open file description*, not on the process that acquired it.** An open file description is the kernel's record of "this file, opened this way, at this offset"; a file descriptor is just a numbered handle pointing at one. `fork` and `exec` copy the handle without duplicating the description, so the child ends up pointing at the very same lock. The kernel releases that lock only when the **last** descriptor referring to the description closes. Nothing in these scripts closes fd 9, so the lock travels to the worker and is held for the worker's whole run.

Two consequences worth having in mind before you change anything here:

- **It is self-healing.** Because the release is the kernel closing a descriptor, it happens on *every* exit path — a clean finish, a crash, or a `SIGKILL` that runs no trap. There is no stale-lock state to detect and no cleanup code to write. Do not add any.
- **Acquire-then-spawn is atomic from the client's point of view.** The old design checked a pid file, spawned, then `sleep 0.8` waiting for the worker to write that pid — a ~0.8 s window in which a second POST saw no pid and happily spawned a second worker. Taking the lock *before* spawning closes it: there is no instant at which a scan is running but unclaimed.

> ℹ️ **Verified on-device (BusyBox v1.31.1, 2026-08-12).** Its usage line is `flock [-sxun] FD|{FILE [-c] PROG ARGS}`, so the bare-FD form is real on this platform and not a GNU-only spelling. A **read-only** fd is sufficient for `-x`: `/proc/<pid>/fdinfo/9` shows `lock: 1: FLOCK ADVISORY WRITE` with no write bit on the descriptor. The read-only open is deliberate, not incidental — `fs.protected_regular=1` blocks **root** from write-opening a world-writable `/tmp` file it does not own (see [tmp-file-ownership.md](tmp-file-ownership.md)), so `9<` keeps the design intact if a root component is ever added to this path. Switching it to `9>` would work today and break the day someone adds a root writer.

> ⚠️ **Never `unlink` this lock file while a request could be in flight.** Deleting the name does **not** release the lock — it detaches the name from the inode the lock lives on. The next opener creates a brand-new inode and takes an entirely independent lock on it, so both scans acquire "the" lock and mutual exclusion silently disappears with nothing in any log to say so. `uninstall_rm520n.sh` is safe only because its `/tmp` sweep runs eight steps after it has stopped lighttpd and killed every worker; a boot-time or periodic "tidy `/tmp`" job would not be.

### Refusal messages, and why `other_scan_running` is its own code

When `flock -x -n` fails, the endpoint consults the (cosmetic) pid file purely to pick a message:

| Condition | Error code | Meaning |
| --------- | ---------- | ------- |
| Our own pid file names a live process | `already_running` | The **same** scan type is in flight |
| It does not | `other_scan_running` | The **other** scan type holds the modem |

**`other_scan_running` must never be collapsed into `already_running`.** The hooks treat `already_running` as "someone else started my scan — attach to it and start polling" (`use-cell-scanner.ts`, `use-neighbour-scanner.ts`). Reuse the code for a cross-scan collision and the neighbour hook attaches a poll loop to a *sweep*: it polls `neighbour_scan_status.sh`, whose pid, result and error files do not exist, gets `idle` one second later, and resets the surface. The user presses the button, watches a spinner for a second, and is told nothing at all — strictly worse than the failure it was meant to report.

Both hooks discard the CGI's `detail` string for this code and use translated copy instead, because `detail` is English-only and the useful part of the message is *how long the wait is worth* (~2 s for a neighbour read, up to three minutes for a sweep).

## The status endpoints are non-destructive, and that forced an ordering rule

Both status endpoints are `GET`s, and a `GET` must not mutate server state. They used to `rm` the error file as they read it, which meant **exactly one poll in the world ever saw a failure**: a second browser tab, a page reload, or a dropped response and the error was gone forever, leaving the surface to report `idle` for a scan that had definitively failed. The `rm` is gone. The error file is now cleared by the *next* scan start instead — both start endpoints and both workers already do this — so an error persists until it is superseded.

**That change forced the result check ABOVE the error check, and the order is load-bearing.** A non-destructive read means both a result file and an error file can be present at once: worker A fails early and writes the error, worker B succeeds late and writes the result. (The singleton should prevent that pairing, but this ordering is the belt to its braces.)

- **Result first** — a genuine completed sweep is delivered, and a stale error is superseded by the next start. Worst case, an error is reported *late*.
- **Error first** — the good result would be shadowed for as long as the stale error sits there, i.e. delivered **never** rather than merely late.

Checking result first cannot suppress a real failure, because on a real failure there is no result file to find: the start endpoint deletes it before spawning, and a worker that failed never wrote one.

> ℹ️ Related, and deliberately left alone: the `PID_FILE` branch above both checks is *not* ordered after the result check, even though `speedtest_status.sh:155-166` documents a `running → idle → complete` flicker from exactly that shape. It is unreachable here because each worker writes its result and removes its own pid file inside one process, with the `rm` in an `EXIT` trap that is the process's last act — so `pid_alive` can only go false after the result already exists. Both status scripts carry this note at the source; do not "harmonise" them with speedtest without re-deriving it.

### Start-endpoint responses

| Outcome | Body |
| ------- | ---- |
| Started | `{"success": true}` |
| Same scan type already running | `{"success": false, "error": "already_running", "detail": "…"}` |
| Other scan type holds the modem | `{"success": false, "error": "other_scan_running", "detail": "…"}` |
| Worker spawned but died immediately | `{"success": false, "error": "start_failed", "detail": "…"}` |

The success body **dropped its `pid` field** (`{"success": true, "pid": N}` → `{"success": true}`). Nothing consumed it: the client polls a status endpoint, it never addresses a process.

`start_failed` is narrower than it looks. The endpoint spawns, waits 0.2 s, and checks the pid is alive — which detects only an install-integrity failure (binary missing or not executable), because a healthy worker holds the modem for seconds to minutes and cannot plausibly be dead that early. It replaced a `sleep 0.8` that was there to let the *worker* write its own pid file; the CGI now writes the pid itself from `$!`, which is the same value the worker later writes as `$$`, so the two are idempotent rather than racing. Without that, the endpoint could return before the pid file existed and the client's first poll would read `idle` for a scan that was running perfectly well.

## The long-running flag contract

**Short version: the flag tells the two root daemons "a long AT command is in flight — stand down".** Since `qmanager_atd` 0.7.3 it is `/run/qmanager_at/long_running`, and the broker raises it, not this worker. Path, trust rule and the no-bridge OTA reasoning: [at-command-transport.md > The long-command flag trust rule](at-command-transport.md#the-long-command-flag-trust-rule).

| Role | Who | Where |
| ---- | --- | ----- |
| **Writer** | the `qmanager_atd` broker, as **root**, once it holds the AT lock for `AT+QSCAN=3,1` | `run_after()` in `native/qmanager_atd/src/at/exec.rs` |
| Clearer (normal) | the broker, when the exchange ends or the warm-up `AT` fails | same function |
| Reader | `qmanager_poller` (root) → `system_state="scan_in_progress"`, ping-only, no AT | `qm_long_flag_up "$LONG_FLAG"` in `poll_cycle()` |
| Reader | `qmanager_watchcat` (root) → `LOCKED`, and Tier 2 skipped outright | `qm_long_flag_up` in `check_locked()` and `execute_tier2()` |
| Expirer | `qmanager_poller`, if the flag is older than `LONG_FLAG_MAX_AGE` (300 s) | `poll_cycle()`; constant near the top of the file |
| Expirer (broker start) | `clear_stale_long_flag()`, flag older than 15 s and the AT lock free | `exec.rs`, called from `daemon/mod.rs` |

`/run` is tmpfs, so no flag survives a reboot. The shell readers count it only when it is root-owned, a regular file and one link (`qm_long_flag_up` in `scripts/usr/lib/qmanager/qlog.sh`); a planted file no longer pauses them.

> ⚠️ WARNING: `qmanager_cell_scanner` must not write the flag itself. It used to `: > "$LONG_FLAG"` before calling `qcmd`, and that early write made a short command that was already running abandon its reply and fail. The worker now only calls `qcmd 'AT+QSCAN=3,1'`. Verified on the RM520N-GL (`61368cd2`, 2026-10-31): during a UI scan the flag was `0:0` 0644 for the length of the sweep, the poller reported `scan_in_progress`, and nothing appeared in `/tmp`.

**The neighbour worker does not raise the flag, and this is deliberate.** `AT+QENG="neighbourcell"` is not a long command, so the broker does not raise it either. A ~2 s hold does not warrant parking the watchdog: the poller would drop a cycle and the watchdog would skip a tier for an operation shorter than the poller's own cadence. Do not add `QENG` to the long-command list "for symmetry".

`AT+QSCAN` is documented at up to 180 s, so the 300 s poller expiry has ~2 minutes of headroom; if a future long command exceeds 300 s, raise `LONG_FLAG_MAX_AGE`.

## Signal thresholds: deliberately divergent

This surface rates cells with **three** tiers at **-85 / -100 dBm** (`SIGNAL_GOOD_DBM` / `SIGNAL_FAIR_DBM` in `shapes.ts`). The rest of the product rates the serving cell with the **four**-tier `RSRP_THRESHOLDS` in `types/modem-status.ts` (-80 / -100 / -110 / -140).

That is not an oversight and not drift. A scan rates **candidate** cells the modem is *not camped on* — a different judgement from grading the link you are currently carrying traffic over. The divergence was reviewed and kept on purpose on 2026-08-11.

> ⚠️ Do not "unify" these as a side effect of unrelated work. If a future change genuinely wants one scale, it needs its own decision and its own record here — not a drive-by import of `RSRP_THRESHOLDS`.

## The 0-dBm sentinel

**Both workers emit `0` for an unreported reading, not `null`.** The sweep worker's jq stage coerces an empty field to `0` for `signalStrength`, `pci`, `earfcn`, `band`, `bandwidth`, `cellID` and `tac` (`qmanager_cell_scanner:249-255`); the neighbour worker does the same for `signalStrength`, `frequency` and `pci` (`qmanager_neighbour_scanner:190-192`). Only `rsrq` / `rssi` / `sinr` are allowed to be `null`.

0 dBm is not a physically meaningful RSRP, so `signalTier()` (`shapes.ts`) treats it as the sentinel and returns the `none` tier — a **muted** "No data" chip with `signal_cellular_off`, not a verdict. The incumbent rendered 0 as the destructive **"Bad"** chip, which asserted a judgement where there was no reading at all.

Two rules follow:

- `none` is **muted**, never `warning`. The same table column already spends `warning` on "Fair"; giving "No data" the warning role puts two unrelated states in one tone in one slot.
- **Unmeasured rows sort last in both directions.** 0 dBm is numerically above every real RSRP, so a plain numeric sort would float "No data" rows to the top of a strongest-first table. Both tables' signal column reads through `signalSortValue()` (`sort.ts`), which maps the sentinel to `undefined`, and sets `sortUndefined: "last"` — TanStack places `undefined` before it applies the descending flip, so the rows stay at the bottom whichever way the reader sorts. Both tables open on `[{ id: "signalStrength", desc: true }]`. Dropping either half (the accessor or `sortUndefined`) puts the sentinel rows back at the top with no error.
- If a worker is ever changed to emit `null` instead of `0`, `signalTier` already handles it (`null` and `undefined` both map to `none`) — but the numeric fields' TypeScript types in `types/cell-scanner.ts` would need widening, and every `tabular-nums` cell that prints the raw number needs a formatter.

## Lock is LTE-only on the neighbour route

The lock action on a neighbour row is enabled only when `networkType` starts with `LTE` and both `pci` and `frequency` are non-zero (the `actions` column in `neighbour-scan-result.tsx`). The reason is upstream, in the backend: `tower/lock.sh`'s NR-SA branch requires **four** fields — `pci`, `arfcn`, `scs` and `band` — and refuses the request with `missing_fields` if any is absent (`scripts/www/cgi-bin/quecmanager/tower/lock.sh:221-222`), then validates SCS against `15|30|60|120|240` (`:227-231`).

A neighbour report carries neither a band nor an SCS. `AT+QNWCFG="nr5g_meas_info"` returns only `<arfcn>,<pci>,<rsrp>,<rsrq>,<sinr>` (`qmanager_neighbour_scanner:131-139`), and `NeighbourCellResult` has no field for either. So an NR neighbour is structurally unlockable from this route — not merely unsupported.

The control is **disabled with a reason**, not hidden: `cell_scanner.neighbour.actions.lock_lte_only` renders in place of the label. The incumbent suppressed the button entirely for non-LTE rows, which left the reader to infer a rule from an absence.

The full-sweep route *is* able to lock NR, because `AT+QSCAN` reports band and SCS (`qmanager_cell_scanner:131-137`). Where the modem reported no SCS, the shared dialog applies the common 30 kHz default at the point of use (`NR_DEFAULT_SCS`, `lock-cell-dialog.tsx:67`, applied at `:85`) rather than fabricating one in the worker — one place to look when a lock lands on the wrong numerology.

## Lock is gated on the SIM's network (sweep only)

A sweep lists every operator the modem can hear, and a lock onto another operator's cell is one the SIM cannot register on. So on the sweep, "Lock to this cell" stays in each row's menu but is **disabled with a reason** (`cell_scanner.actions.lock_other_network`, "Not your SIM's network") for any cell whose MCC/MNC is not the SIM's.

| Piece | Where | Rule |
| ----- | ----- | ---- |
| SIM home network | `simPlmnFromImsi(device.imsi)` (`sim-plmn.ts`), IMSI from `useModemStatus` | MCC = first 3 digits; MNC is 2 or 3 digits, fixed per MCC |
| 3-digit MNC MCCs | `THREE_DIGIT_MNC_MCCS` | Not exhaustive: an unlisted MCC falls back to 2 digits |
| Mixed MCC | `MIXED_MNC_MCCS` (`405`) | Both readings are kept, and a cell matching either passes |
| Row gate | `cellMatchesSim(cell, sim)` → `canLockCell` on `ScanResultView` | **Answers `true` when the SIM is unknown** |
| "Your SIM" tag | `ProviderGroup.isSim` in `summariseSweep` | **Fails closed**: `false` with no SIM PLMN, and `true` only when *every* cell in the group matches |

The two defaults are opposite on purpose. With no IMSI (no SIM, a malformed reply, the first poll not back yet) the page cannot tell which network is yours, so it blocks nothing — the confirmation dialog still guards the write. The tag makes a claim, so it is shown only when the claim is proven.

> ⚠️ **An MCC that uses 3-digit MNCs but is missing from `THREE_DIGIT_MNC_MCCS` reads the IMSI as a 2-digit MNC**, and every cell on that SIM's own network is then wrongly disabled. If a user reports "Not your SIM's network" on their own carrier, add the MCC to the set.

The neighbour route has no SIM gate: `NeighbourCellResult` carries no MCC or MNC to compare.

## Types: the inversion that was fixed, and the merge that was refused

**`CellScanResult` used to live in `components/cellular/cell-scanner/scan-result.tsx`, and `hooks/use-cell-scanner.ts` imported it from there** — a data hook reaching into a table component for the shape of the data it fetches. That inversion is why the table could not be replaced without touching the hook, and it is a direct cause of the neighbour route forking rather than sharing.

Both transport shapes now live in `types/cell-scanner.ts`, and the direction is the usual one: the type is declared there, and both the hook that fetches it and the components that render it import from it. **Nothing in `types/` imports from `components/`.** If you find yourself adding such an import, the type is in the wrong file.

**`NeighbourCellResult` is a separate type from `CellScanResult`, and merging them is a mistake worth resisting** (`types/cell-scanner.ts:57-69` carries the same note at the source). The two workers ask the modem different questions and get different answers:

| | Sweep (`CellScanResult`) | Neighbour (`NeighbourCellResult`) |
| --- | --- | --- |
| What it reports | A cell's full **identity** | A **measurement** of a cell the serving tower already knows about |
| Unique fields | `provider`, `mcc`, `mnc`, `cellID`, `tac`, `bandwidth`, `band`, `scs` | `cellType` (`intra`/`inter`/`nr5g`), `rsrq`, `rssi`, `sinr` |
| Channel field name | `earfcn` | `frequency` |

Only `id`, `networkType`, `pci` and `signalStrength` genuinely overlap, and the two even disagree on what to call the channel. Widening one type to cover both would make ten fields optional and push "which of these is actually populated?" into every call site. **The shell is shared; the shapes are not.**

`ScanStatus` (`idle` | `running` | `complete` | `error`) *is* shared — it is the workers' transport vocabulary, identical on both routes. It is mapped to the surface's `RunPosture` (`idle` | `scanning` | `complete` | `failed`) in exactly one place, `runPosture()` in `shapes.ts`. The two vocabularies use different words on purpose: "running" is what the modem is doing, "scanning" is what the page is showing, and collapsing them would make a rename of one a silent rename of the other. `runPosture` takes a structural union rather than importing `ScanStatus`, which keeps `shapes.ts` free of app-code imports while still failing the build at the call site if the two unions diverge.

## What is shared, and what is deliberately not

Twelve modules are shared by the two scanning routes: `lock-cell-dialog.tsx`, `run-hero.tsx`, `run-summary.tsx`, `sibling-link.tsx`, `table-note.tsx`, `summaries.ts`, `sort.ts`, `scan-states.tsx`, `scan-table.tsx`, `scanner-skeleton.tsx`, `signal-badges.tsx` and `shapes.ts`. `sim-plmn.ts` is read by the sweep only (`scanner.tsx`, and `summariseSweep` for the "Your SIM" tag). Both routes take only `ScanErrorState` from `scan-states.tsx`; their zero-results panel is the `Empty` primitive on `EMPTY_PANEL` — see [The results card](#the-results-card-is-not-mounted-at-idle).

Shared modules follow the same rule as the hero: **shape shared, words not**. `run-hero.tsx`, `run-summary.tsx`, `sibling-link.tsx` and `table-note.tsx` take every string as a prop; `summaries.ts` and `sort.ts` return numbers, tiers and identifiers and never a sentence.

Three of the twelve reach across to the **calculator** as well: `shapes.ts` (which holds the calculator's own section), `sibling-link.tsx` (its anchor's cross-route link) and `scan-states.tsx` (`ScanEmptyState`, for the bands card and the empty history). The calculator's own four modules live under `freq-calculator/` and are used by nothing else.

`lock-cell-dialog.tsx` is the one worth calling out: **it owns the write, not just the confirmation.** A component that only asked the question and handed back a callback would have left both routes holding their own identical `fetch`, payload builder and toast set — which is the duplication that actually cost something. The caller owns exactly one thing: which cell is targeted, cleared when the dialog closes. `kind: "nr_sa" | "lte"` is a discriminator on the *target* rather than a flag on the request, because `AT+QNWLOCK` takes two different shapes and the modem rejects the wrong one outright.

**The CSV builders are NOT shared, and should not be.** Each route keeps its own `buildCsvRows` and header constant (`CELL_SCAN_CSV_HEADER` in `scanner.tsx`, `NEIGHBOUR_CSV_HEADER` in `neighbour-scanner.tsx`) because the two row shapes have different columns; both go through the shared `lib/download-csv.ts` for the actual download. Sharing the *builder* would require the widened type this doc argues against.

> ℹ️ **The download button lives in the table toolbar.** Both routes pass it to the table as `toolbarActions`, which `ScanTable` renders in `TOOLBAR.ACTIONS` before the icon-only Columns menu (`tune` glyph, accessible name `cell_scanner.results.columns`). It is `tonal-neutral` + `PILL_QUIET`, and its text label hides below `@sm/section`, where `aria-label` carries the name. The hero header's `actions` therefore carries exactly one act — the thing you do to the *run*. It only exists when there are rows, because the toolbar only renders with the table. Both routes keep the same placement on purpose: the two are siblings a click apart.

## The calculator takes the anchor, not the run

`/cellular/cell-scanner/frequency-calculator` shares the route prefix and the canon — `CellularPageHeader`, `SECTION_HEAD`, role radii, the `nr`/`lte` identity variants, the machine-voice split — and now also the family's **anchor geometry**. It takes `CALC_HERO`, built from the shared `HERO_SHELL` plus its own `gap-5` rather than aliasing `RUN_HERO` outright — the alias broke when the run hero dropped that gap for its idle collapse, and nothing on the calculator collapses. The split inside it is calculator-only too, recomposed 2026-09-26: `CALC_SPLIT` puts the form in a fixed `25rem` column on the left and the answer rail filling the rest on the right, from `@3xl/section` — calculator-only, so a retune of the run hero's ledger never moves the calculator. What it still does **not** take is the **run vocabulary**: no posture chip, no elapsed clock, no spinner, no cost statement — it makes no request, holds no lock and spends nothing.

The form's spec citation no longer lives on the form. `FORM.NOTE` and its `noteText` slot are gone; the result's citing spec (`NR_SPEC` / `LTE_SPEC`) now renders as a `Tag` in the **matching-bands card's own header**, once there is a result to cite — it is a fact about that card's contents, not about the form. The pre-calculation hint that used to fill the old slot (`cell_scanner.calculator.form.hint_auto`, *"Auto picks LTE or NR from the number's range"*) stays removed for the same reason it was removed on 2026-08-14: the three mode tabs directly above the field, now a `Tabs` control, already say Auto is one of three choices.

**This inverts what this doc and both of those files used to say**, and the old argument is worth keeping because the interesting part of it was the mistake: it held that a `rounded-hero` radius here was "a promise of importance the page cannot keep", on the grounds that the family's heroes are *run* heroes and nothing here runs. Right about runs, wrong about heroes. What an anchor promises is not that something ran — it is that **one object on the page is the thing the reader came for**, and everything else on the page reports on it. That is unambiguous here: you came to turn a channel number into a frequency, and the bands grid and the history are both readings of that one answer. The incumbent's two peer cards claimed the converter and its own history were equally important, which is the single thing this page is certain they are not.

The layout that follows is three cards: the anchor (form left, answer rail right), the matching bands, the history. **The middle card never disappears** — it carries a `ScanEmptyState` before the first calculation, so the page fills in rather than assembling itself. This is the opposite of the scanning routes, whose results card is not mounted until a run starts: a calculation is instant and costs nothing, so there is no launch state to keep compact (see [The results card is not mounted at idle](#the-results-card-is-not-mounted-at-idle)). Bands and history are no longer just two stacked cards — from `@4xl/main` they share one row, `3fr`/`2fr`, `items-stretch`, so the shorter card doesn't dangle in whitespace beside the taller one.

`shapes.ts` (`components/cellular/cell-scanner/shapes.ts`, "The frequency calculator" section) carries the calculator's own section. The calculator keys off its own `CALC_IDENT` (`text-[13px] tabular-nums`, no `font-mono`) rather than the shared `IDENT`; since 2026-10-06 the two strings are identical, but they stay separate constants so a retune of the scan tables never moves the calculator — see [Machine voice on this surface](#machine-voice-on-this-surface).

### The answer rail

The anchor's right column (`calc-readout.tsx`) is a **horizontal** rail (`CALC_RAIL.ROOT`, a `min-h-[6.5rem]` row). It shares the anchor's shell with the run hero, not the run hero's ledger. The form sits to its left under `CALC_SPLIT` (see [The calculator takes the anchor, not the run](#the-calculator-takes-the-anchor-not-the-run)), so on a phone the two stack form-over-rail and from `@3xl/section` they sit side by side.

**Three states, three distinct glyphs**: `tune` when nothing has been calculated, `graphic_eq` for a resolved frequency on **either** radio, `error` for a failure. Idle and resolved share the rail's layout but never its glyph or tone.

`READOUT_DISC.lte` (`bg-lte-container`) and `.nr` (`bg-primary-container`) are **IDENTITY fills, not status roles** — they say which radio family owns the answer. Per DESIGN.md's Identity-Chip Rule that meaning has to be carried non-chromatically too, and it is: the `NetworkTypeBadge` and the band label directly beside the disc say "NR" and "n78" in words.

The frequency is `READOUT.FIGURE` at **40px** — a frequency runs to seven characters (`3489.42`) and still has to leave room, on the same row, for the identity block (`Tag` + band label + caption) pinned to the rail's opposite edge with `ms-auto`. The unit is a separate node at label size, so "MHz" does not shout as loudly as the number.

**The failure sentence now prints in this rail, not on the form.** `CalcReadout`'s `failedBody` prop takes the resolved error text and renders it in the rail's message slot — the same slot the idle hint uses — so a failure replaces the invitation to calculate instead of adding a second thing to read beside the field. The rail only takes `role="alert"` in the `failed` state.

### Band agreement: a channel number does not identify a band

`bandAgreement()` (`calc-model.ts:121`) exists because a channel number can be claimed by several bands at once. The two radios behave differently:

- **LTE EARFCN ranges are disjoint.** `findAllMatchingLTEBands` therefore always returns exactly one entry, and the verdict is always `single`.
- **NR-ARFCN ranges overlap.** NR-ARFCN 528030 sits inside n7 (FDD), n41 (TDD) and n90 (TDD) simultaneously.

The top-level `frequency` field is safe to show regardless of how many bands matched, and that is a fact about the spec rather than a convenience: the NR downlink frequency comes from the **global raster** in 3GPP TS 38.104 §5.4.2.1 and is a function of the ARFCN alone. Bands sharing an ARFCN agree about the downlink. They do **not** agree about duplex mode or where the uplink is — n7 and n41 differ by a duplex scheme and 120 MHz.

| Verdict | When | Rendered as |
| ------- | ---- | ----------- |
| `single` | one matching band | **nothing** — a "1 band matched" line under a list of one is noise |
| `agree` | several bands, all one duplex type | `muted` strip, `layers` glyph — a curiosity |
| `conflict` | several bands, duplex types differ | `warning` strip, `warning` glyph — the uplink shown below is only correct for whichever band the network actually uses |

### One well, not a grid: each band is a DL/UL table section

The matching bands render as **one well** (`BAND_TILE.WELL`, the card's single inner container per the Scanning Rules) holding a hairline-divided `SECTION` per band, not a grid of tiles despite the file's name (`band-tiles.tsx`). Each section is its own table — Frequency, Range, channel-of-range, In band — with Downlink and Uplink as **columns** rather than as separate cards, so bands that agree read as rows of the same fact instead of duplicated layouts.

**The "In band" row is a position track, not a number.** `positionInBand(channel, range)` (`calc-model.ts`) clamps the channel's fraction of its band's range to `0..1`; `BAND_TILE.POSITION_TRACK`/`POSITION_DOT` render it as a dot on a pill, coloured by `BAND_HIT_INK[tone]` so the dot's radio identity matches the disc in the answer rail.

**TDD and SDL bands collapse the Uplink column into a note, not a placeholder.** `uplinkChannelRange(band, channel)` (`calc-model.ts`) returns `null` when the band has no uplink carrier at all (SDL) or when the DL-to-UL offset is `0` (TDD — uplink shares the downlink's own numbering, so a second channel column would just repeat the first). `band-tiles.tsx`'s `hasUplink` is `false` whenever that range is `null`, and the whole Uplink column becomes one note cell instead — `cell_scanner.calculator.result.sdl_uplink` for SDL, `cell_scanner.calculator.result.tdd_uplink` for TDD, two different sentences because "no uplink at all" and "uplink and downlink share a channel" are different facts.

**`@container/band` keeps the table inside its own well on a narrow screen**, independent of the page or card width: each `SECTION` declares the container, so a section stays legible even when the card itself is the one already competing for a phone's width. From `@md/band` up, the note is a `rowSpan={4}` third column beside Downlink; below `@md/band` it drops to its own full-width row (`NOTE_ROW`) under a two-column table, rather than squeezing a third column that has no room.

### The `ulEarfcnOffset` correctness fix

**Short version: the old calculator computed the uplink channel number as `earfcn + 18000`, which is right for most FDD bands and wrong for three shipped ones — and it printed the wrong answer in `font-mono`, the voice this product reserves for things the device actually said.**

The real rule (3GPP TS 36.101 §5.7.3) is `N_UL = N_Offs-UL + (N_DL − N_Offs-DL)`, and `N_Offs-UL` is a **table value**, not a constant gap. `LTEBandEntry` now carries it as `ulEarfcnOffset` (`lib/earfcn.ts:34`), sourced from TS 36.101 Table 5.7.3-1, and `lteULEarfcn(band, earfcn)` (`:220`) applies the formula.

Verified against the shipped table, the gap is 18000 for every FDD band except:

| Band | `N_Offs-DL` | `N_Offs-UL` | Actual gap | Old `+18000` was off by |
| ---- | ----------- | ----------- | ---------- | ----------------------- |
| B30 (WCS 2300) | 9770 | 27660 | **17890** | +110 |
| B66 (AWS-3) | 66436 | 131972 | **65536** | −47536 |
| B71 (600 MHz) | 68586 | 133122 | **64536** | −46536 |

Two smaller corrections came with it. `lteULEarfcn` takes the band **as an argument** rather than looking it up, so a caller iterating several matching bands gets each band's own answer instead of the first match's. And it returns `null` for SDL bands (B29, B32), which have no uplink carrier at all — the old expression fell through to `earfcn` unchanged and printed a UL channel for a downlink-only band. `MatchingBand.ulChannel` is `null` for both SDL and NR; `band-tiles.tsx` now renders that as the TDD/SDL note described in [One well, not a grid](#one-well-not-a-grid-each-band-is-a-dlul-table-section) rather than a placeholder value. NR has no second channel number to omit: it numbers the uplink on the same global raster as the downlink.

### Auto's dead zone has a name

Auto mode picks LTE or NR by magnitude. The LTE table stops at EARFCN **56739** and the NR table starts at ARFCN **123400** (`MAX_LTE_EARFCN` / `MIN_NR_ARFCN`, both derived from the band tables rather than hardcoded). Everything in **56740–123399** belongs to neither.

That gap used to fall off the end of auto's own if/else and report the generic `no_band` — "no band matches your number", which reads as *your number is wrong* when the true answer is *Auto cannot tell which scheme you meant here*. It now has its own code, `auto_gap`, whose sentence names the range and points at the LTE and NR tabs. The gap is a fact about our band tables, not about the input, and the copy says so.

> ℹ️ The failure sentence and the spec citation no longer compete for one slot — the 2026-09-26 recompose moved them to two different cards. The error prints in the answer rail (see [The answer rail](#the-answer-rail)); the citation prints in the bands card's own header, only once there is a result. Both reachable failure codes still end with the recovery, so nothing above the rail repeats it.

### Errors are codes, and why that rule generalises

`calculateFrequency` is a module-level pure function outside `t()`, and it used to return English sentences **as data** (`{ error: "Please enter a valid number" }`) that travelled through React state into the DOM with no key ever involved. `bun run i18n:check` only sees keys, so this was invisible to the gate. It now returns a `CalcErrorCode` (`empty` | `not_a_number` | `negative` | `auto_gap` | `no_band` | `unexpected`) mapped to a **literal** key at the call site (`ERROR_KEY`, `calculator.tsx:56`), with runtime values interpolated rather than concatenated so a locale can place them where its grammar wants.

> ℹ️ Any pure function that returns user-visible English is an i18n hole the checker cannot see. Return a code.

The same rule holds for the spec citations: `NR_SPEC` and `LTE_SPEC` (`calc-model.ts:45-46`) are **proper nouns** and live in code rather than in the five locale files, so a translator cannot accidentally localise a clause number. `t()` receives the surrounding sentence and interpolates them verbatim.

### Motion on the calculator

There is exactly **one authored moment**, and everything else arrives with the page's entrance cascade and then holds still.

- **The readout swap.** The calculation is user-initiated and instantaneous — no request, no spinner, nothing to wait for — so without motion the 40px figure simply becomes a different 40px figure between two frames, and a reader who mistyped one digit cannot tell whether the button did anything. The shared `SwapLabel` gives the outgoing value an exit and the incoming one an entrance offset by one stagger step. The swap key is `networkType:channelLabel:figure`, not the figure alone: two calculations resolving to the same MHz on different radios must still read as a change.
- **Band sections cascade on `staggerRows`** (80 ms step, 5px rise — the *row* cascade, not the card one; these are hairline-divided siblings inside one well, and a 10px lift would read as the well reflowing). The container declares `initial`/`animate` explicitly rather than inheriting them, because it mounts on a swap long after the page's entrance clock has settled — a variants-only child mounting on a swap stays pinned at `hidden` forever, which renders a complete DOM at zero opacity and passes every checker. Its `key` is the channel, so a **second** calculation replays the cascade instead of React quietly reconciling one set of sections into another.
- **History rows enter on `standard` and exit on `quick`.** `AnimatePresence initial={false}` keeps the first paint silent, so ten rows restored from `localStorage` do not claim ten things just happened.

> ℹ️ **The history exit is not an Enter-Only Rule violation.** That rule governs **conditions** and **navigation** — a banner leaving means the condition cleared and should feel immediate, and an outgoing route is already gone. Neither applies to a row the user just deleted: here the deletion *is* the event and the row is the thing that was acted on, and a row vanishing between two frames while the rows below it jump up is indistinguishable from having deleted the wrong one. The exit is the *faster* leg for the same reason the Modal-Exit Rule gives — confirmation of something already decided should not be slower than the decision.

### History persistence and its silent migration

History lives in `localStorage` under `earfcnHistory` (`HISTORY_KEY`), capped at `HISTORY_LIMIT` = 10, most recent first.

The stored row shape **narrowed**: it used to be a whole `CalculationResult` (`earfcn` for the channel, `possibleBands` as an array of full band *objects*), and is now `HistoryEntry` (`channel`, and `bands` as plain numbers). That cuts the payload by roughly 90% and stops a schema change in the band tables from resurrecting a stale duplex mode out of the browser.

**The key did not change, and `readHistory()` normalises the legacy shape on read** (`calc-model.ts:268`) — it accepts `channel` or `earfcn`, and `bands` as numbers or `possibleBands` as objects — so nobody loses saved history on upgrade. A row that survives neither shape is dropped **individually** rather than failing the whole parse; a corrupt or unreadable store is an empty history, never a crash. `writeHistory` swallows quota and private-mode failures for the same reason: the history is a convenience and the calculation itself already succeeded.

**A row is recallable.** Clicking a history row (`HistoryList`'s `onRecall`) restores its channel into the field, forces the mode back to `auto`, and re-derives the answer — the same non-recording path a mode-tab switch takes, so recalling an entry never re-adds the entry it just read. Its relative-time caption comes from `relativeTimeBucket(entry.timestamp)` (`calc-model.ts`), a pure function that buckets an ISO timestamp against the *current* wall clock into `now` / `minutes` / `hours` / `yesterday` / `days`; `history-list.tsx` words each bucket through i18n plurals rather than building English strings, and an unparsable timestamp (`Number.isNaN(then)`) reads as `now` rather than throwing.

Two smaller rules the coordinator holds:

- **Only an asked-for calculation is recorded.** Pressing Calculate or Enter is a request and lands in the history; switching the mode tab re-answers a question already on screen and does not, or ten tab presses would bury the ten calculations the reader actually made (`run(…, record)`, `calculator.tsx:126`).
- **The saved history is read after mount, in an effect, not in a lazy `useState` initialiser.** On a statically exported page the initialiser runs during render, so the server produces an empty list and the client's first render produces ten rows — a hydration mismatch React resolves by throwing the server's markup away.

## Machine voice on this surface

Since 2026-10-06 the scan tables follow the amended Machine-Voice Rule (DESIGN.md > Typography): mono is for a string compared character by character, not for any value that happens to be numeric. Module-level `IDENT` in `shapes.ts` is `text-[13px] tabular-nums` with **no** `font-mono`, and `TABLE.IDENT` aliases it for band, EARFCN, PCI, Cell ID, TAC, the neighbour channel, the MCC/MNC tooltip and the lock dialog's identifier line. `FIGURE` (`tabular-nums`) carries the readings — RSRP, RSRQ, SINR, RSSI, bandwidth. Counts (`TOOLBAR.COUNT`, `TABLE_NOTE.TALLY`, `LEDGER.SUMMARY_FIG_NUM`, `LEDGER.CELLS`, `LEDGER.DBM_VALUE`) are interface-font `tabular-nums` too.

Mono survives in exactly two places on the scanning routes, both opaque strings:

- `LEDGER.STATUS_TITLE_MACHINE` — the modem's own error text, used as the failed status title.
- `LEDGER.NAME_TEXT_MACHINE` — a provider the worker could only name as `<mcc>/<mnc>` (`NUMERIC_PROVIDER_RE` in `scanner.tsx`).

The calculator's `CALC_IDENT` is the same string as `IDENT`, kept as a separate constant (see [The calculator takes the anchor, not the run](#the-calculator-takes-the-anchor-not-the-run)).

Every count on this surface must be assembled by the i18n layer's plural machinery, never by a JS ternary — the table's row count, the four tier tallies, the verdict, the ledger's unit words and its "N more providers" row. The incumbent hardcoded `filtered === 1 ? "cell" : "cells"` in *both* copies, which is wrong in four of the five shipped locales before a translator ever sees it. That is also why the tally is a **list of separate strings** rather than one sentence: one plural rule cannot carry four independent counts, and the No-Dot-Separator Rule bans the `·` that would otherwise glue them (DESIGN.md > Named Rules).

## The posture chip is gone

The hero header carried a `Badge` reading Ready / Sweeping / Complete / Failed, morphing its fill on the `standard` clock while its label crossfaded on `quick`. It was a well-built **restatement**: the posture rail immediately below it already says the same thing with a tinted disc, a spinning glyph, a title and a line of body copy. Two objects, one fact, ~200 px apart — and the chip was the one with no room to explain itself.

Removed on both routes and all four postures (user decision, 2026-08-12). What follows from it:

- `RUN_BADGE` became `POSTURE_GLYPH` and **dropped its `BadgeVariant` field**. The disc still needs the glyph and its fill; nothing needed the badge role once there was no badge, and an exported field with no reader is exactly the dead contract `shapes.ts` exists to prevent. The disc's tone is `POSTURE_DISC`, unchanged.
- `cell_scanner.run.chip_*` and `cell_scanner.neighbour.run.chip_*` were deleted from all five locales.
- `SKELETON_SHAPE.CHIP` stayed — `scanner-skeleton.tsx` still mirrors the column menu with it.
- The vacated header slot now holds the [cross-route link](#cross-navigation-between-the-two-routes).

## Layout grammar shared with the101

**On 2026-10-06 both scanning routes adopted the layout and every state of QManager-the101's Cell Scanner** (user decision). They now render the same two cards through the same four postures. The differences are deliberate and few: only the sweep has a progress bar, only the sweep gates the lock on the SIM, and a ledger row groups by carrier on the sweep and by relation on the neighbour route.

| Posture | Hero (`RunHero`) | Results card |
| ------- | ---------------- | ------------ |
| `idle` | A compact **launch bar**: title, description, sibling link and the start action. The body is collapsed (`idleCollapsed`, passed by both routes) | **Not mounted** |
| `scanning` | The ledger: a status cell (spinning `progress_activity` disc, title, body; on the sweep an estimated progress bar) beside `SKELETON_SHAPE.LEDGER_ROWS` (2) skeleton rows. The start button stays, disabled, with a spinner | `ScannerSkeleton` |
| `complete` | The status cell becomes a summary: the success check beside the run's total and its unit, top-aligned, with the title kept only as `sr-only` (`LEDGER.SUMMARY_*`). The ledger rows sit beside it; the sweep's optional verdict strip sits below | The table, or the dashed zero-results panel |
| `failed` | The status cell only, no rows, titled with the modem's own error in machine voice — **and no action in the header** | `ScanErrorState`, which carries the single retry |

### The ledger

`LEDGER` (`shapes.ts`) is one `rounded-tile` fill holding a status cell and, in `scanning` and `complete` only, a rows region. `ROOT_SPLIT` puts the two side by side from `@2xl/section`; on a phone the status cell is a strip above the rows. `LedgerRows` (`run-summary.tsx`) is **copy-blind and SIM-blind**: every string arrives as a prop, and "Your SIM" is a boolean on the row.

- **Sweep:** one row per carrier from `summariseSweep`, capped at `MAX_PROVIDER_TILES` (5). The SIM's group sorts first and carries the "Your SIM" tag, then the strongest best reading, then the most cells. Groups past the fifth fold into one "N more providers" row (`cell_scanner.run.summary_others`) carrying their cell count and their best reading. Because the SIM's group sorts first, it is never folded.
- **Neighbour:** one row per relation that appeared, in `intra`, `inter`, `nr5g` order, with no band column. Every count is one row per neighbour cell, so the rows use the sweep's `run.ledger.cells_unit` / `col_cells` and the total reads "neighbours" (`neighbour.run.ledger.figure_unit`). Until 2026-10-11 both were worded as bands, which misreported the read.
- **Each row's chip is `SignalBadge` on the group's best reading** — the same chip, and the same `signalTier`, as a table row. An unmeasured group shows the muted "No data" chip and `—` in place of a dBm figure.
- **The status figure is `summary.total`**, the run's total rows, never a count of rendered ledger rows.
- **Rows render in `scanning` and `complete` only; the verdict in `complete` only.** On `failed`, and while a new run is scanning, `results` can still hold the *previous* run, and drawing it under the current status would report an old run as this one.

### The progress bar is an estimate (sweep only)

The sweep's status cell shows a `Progress` bar while scanning. **It is a UI curve over elapsed time, not a measurement.** `AT+QSCAN=3,1` still publishes no per-band progress, no partial rows and no remaining time, and the status endpoint still returns only `idle|running|complete|error` — the results arrive once, as one JSON array, at completion.

`estimateScanProgress(elapsedSeconds)` in `scanner.tsx` rises linearly to 90 % over `SCAN_EXPECTED_SECONDS` (150 s, against the worker's 180 s ceiling), then approaches 99 % and never reaches it. The bar never shows 100 %: `complete` replaces it with the total. Its accessible name is `cell_scanner.run.progress_label` ("Estimated sweep progress").

Rules that follow:

- **Do not wire the bar to a backend field.** None exists, and a worker change that pretended to report progress would be inventing it.
- **No text figure beside it** — no `m:ss`, no percentage, no ETA. A printed number reads as a measurement; the bar's shape alone says "about this far".
- **A tab that attaches to a sweep it did not start begins the estimate at zero.** The start time lives in that tab's `sessionStorage` (`use-cell-scanner.ts`); another tab or browser writes its own start time when it first sees the run.
- **The neighbour route never gets a bar.** A ~2 s read would fill an estimate before the reader registered it; its running state is the spinning disc and the skeleton rows only. Do not pass `progress` to its hero.

### The morph

The growth from launch bar to ledger is a real container morph, not a swap: `HERO_MORPH` (`shapes.ts`) is a `grid-template-rows: 0fr → 1fr` wrapper over an `overflow-hidden` clip, so the card grows to whatever the body measures rather than animating toward a guessed pixel height. It runs on `--duration-emphasized` / `--ease-emphasized`, because DESIGN.md files container size and shape changes there. Both routes take it since 2026-10-06; the neighbour route used to opt out on the grounds that a two-second read would make the grow look like jitter, and the adoption overruled that.

Four details that are easy to undo by accident:

- **`RUN_HERO` carries no `gap-5`, and that is load-bearing.** A flex gap is paid whether or not the item it separates has any height, so a gap on the card would leave 20 px of unexplained space under the launch bar. The separation lives in `HERO_MORPH.BODY`'s own top padding, *inside* the clipped region, where it collapses with everything else.
- **`HERO_MORPH.CLIP` needs `min-h-0`.** Without it a grid row will not shrink below its content and the collapse silently does nothing.
- **`motion-reduce:transition-none` is not optional.** A reader who asked for less motion still needs the body; they need it instantly.
- **The open/closed pair lives in one constant**, driven by `data-[open=true]` rather than a conditional class string at the call site, so the two states cannot drift apart.

`isLoading` forces the body **open**, because a grow the reader did not cause is noise. No caller passes it today.

> ⚠️ **The failed posture's missing hero button is deliberate.** `RunHero` has no opinion about it — each route passes `actions={null}` when `posture === "failed"`. The recovery affordance exists exactly once, in `ScanErrorState`. Adding a launch button back to the hero puts two buttons on one screen for one act.

### The results card is not mounted at idle

Both routes render `{posture === "idle" ? null : <Card …>}`. The card enters when a run starts and stays through `scanning`, `complete` and `failed`. This reverses the 2026-09-10 rule that kept the card mounted at every posture; the launch bar is the whole page until there is something to show.

- **The card's wrapper declares `initial="hidden" animate="visible"` itself.** It mounts long after the page's entrance cascade has settled, and a variants-only child that mounts late stays pinned at `hidden`, which renders a complete DOM at zero opacity with no error.
- **The dashed panel is the zero-results state only.** A `complete` run with no rows renders the `Empty` primitive on `EMPTY_PANEL` (`min-h-[13rem] rounded-tile border border-dashed border-outline`, a `radar` glyph, `results.empty_title` / `empty_body`). Idle no longer shares that branch. The hero's action above it reads "Sweep all bands" / "Read neighbours" in this state, because `hasResults` is false.
- **`POSTURE` is now the results card's error panel and the calculator's empty panels**, nothing else. `ScanEmptyState` is used only by the calculator.

> ⚠️ **Do not add a button to the zero-results panel.** That decision (2026-08-24) still stands: the hero directly above already holds the start action, and two triggers for one act, forty pixels apart, is the duplication this surface spent a whole pass removing.

## The section head stacks its description

`SECTION_HEAD` puts the description **under** the title (`SECTION_HEAD.TITLES` is the stacking pair), family-wide — both scanning routes' heroes and results cards, and all three of the frequency calculator's section heads. User decision, 2026-08-24.

The retired argument, which this file and `shapes.ts` both used to make: *"a section header is a signpost over content the reader can already see, and stacking it spends two lines of rhythm restating what the content demonstrates."* That premise stopped holding the moment the hero collapsed at idle. In the launch state there **is** no content below the header demonstrating anything — the description is the only thing on the page saying what a sweep costs, and on one row beside a bold title and an `ms-auto` action it read as a caption on the title rather than as the sentence a reader has to weigh before spending three minutes of the modem's AT lock. Stacked, it gets its own measure (`max-w-[56ch]`) and its own line.

Two mechanics worth keeping:

- **The root is `items-start`**, which is what keeps `META` on the *title's* row however many lines the description wraps to.
- **`META` carries `ms-auto` rather than the root carrying `justify-between`.** The row wraps, and with `justify-between` a wrap leaves the meta slot marooned against the right edge of its own line.
- **The run hero overrides `META` below `@xl/section` with `RUN_HERO_META`**: the sibling link takes the left edge and the action the right, on their own full-width row. The calculator shares plain `META`.

## The ledger, the verdict and the tally

All three are derived from rows the surface already has — no new endpoint, no new poll.

| Object | Where | Sweep | Neighbour |
| ------ | ----- | ----- | --------- |
| **Ledger rows** | hero, beside the status cell | one row per carrier, SIM's first, capped at 5 plus an overflow row — see [The ledger](#the-ledger) | one row per relation that appeared |
| **Verdict strip** | under the ledger, `complete` only, only when true | every *measured* cell shares one tier (`success` / `warning` / `destructive`, each with its own bar-count glyph), or nothing was measured at all (`muted`, `signal_cellular_off`). A mixed spread gets none | none: the channel-only explanation lives once, in the table note (`neighbour.results.note_channel_only`) |
| **Tally** | `ScanTableNote` under the table, beside the lock note | rows plus per-tier counts, tiers with 0 omitted, over the whole sweep rather than the filtered view | rows, measured, channel only |
| **Count** | the pager row, rendered only when the set pages (more than TanStack's default 10 rows) | `countLabel` | none — `countLabel` is omitted because the tally already counts the read |

Rules that hold this together:

- **All arithmetic lives in `summaries.ts`, and it contains no copy.** `Math.max()` of an empty list is `-Infinity`, a mean over zero rows is `NaN`, and both render as confident text beside real numbers. One pure, total function per route means "survives an empty array, a single row and all-sentinel data" is a property of one file rather than of a rendering path nobody re-reads. And a pure function that returns English is an i18n hole the checker cannot see — the frequency calculator on this same prefix shipped exactly that bug once.
- **A mixed spread gets NO verdict.** "The readings vary" is not an explanation, and a strip that is always present stops being read. Each verdict carries a distinct glyph because `success-container` and `warning-container` measure 1.03:1 apart.
- **`VERDICT_TONE.muted` is `bg-surface-container-high`, one step off the ledger's `bg-surface-container`.** On the ledger's own fill a `muted` strip (the sweep's "nothing was measured") would read as one more, wider ledger row.

> ℹ️ **The lock note says what a lock does.** `cell_scanner.results.note_lock` and `neighbour.results.note_channel_only` used to say a lock "copies" the cell into Tower Locking. `LockCellDialog` posts straight to `tower/lock.sh`, so the modem is locked at once and stays locked until the lock is cleared on Tower Locking; the copy now says that.

## `idle` means two different things, and the hooks must tell them apart

Both hooks receive `{"status":"idle"}` in two unrelated situations, and answering them the same way is how a three-minute sweep disappeared without comment:

- **No poll interval armed** — the mount poll on a page where nothing has ever run. Genuinely idle; say nothing.
- **A poll interval IS armed** — a run was in flight and the status file now reports no pid, no result and no error. The run vanished. Resetting to `idle` here is indistinguishable from never having pressed the button: the spinner disappears, the empty state returns, and the interface volunteers no account of the time it just spent. Both hooks now raise `cell_scanner.error.scan_vanished` (and its `neighbour.` twin) instead.

> ⚠️ **`t` must not sit in the dep array of anything that owns the poll interval.** i18next runs with the default `bindI18n: 'languageChanged'`, so switching language hands back a fresh `t` identity. With `t` in `pollStatus`'s deps, that identity change rebuilt `pollStatus`, which rebuilt the mount effect, whose cleanup calls `stopPolling()` — so **changing language mid-scan tore down the poll interval and nothing ever re-armed it**, while the modem carried on sweeping for its full three minutes. Both hooks now read `t` through a `tRef` that is reassigned on every render: messages stay current (a translation is read at the moment an error is raised, never cached) and `pollStatus` stays identity-stable. Removing `t` from the deps *without* the ref would be the mirror bug — errors raised after a language switch worded in the old language.

## Known gaps

- **`AT+QSCAN` has no cancel.** Once the sweep is in flight the only way to end it early is to kill the worker; the UI has no stop control, and adding one means killing the pid and relying on the `TERM` trap (`qmanager_cell_scanner:44`) to clear the marker.
- **The two result sets cannot be cross-referenced.** A sweep and a neighbour read write separate files with separate lifetimes and no shared row identity, so "this neighbour was also seen by the last sweep" is not answerable today. It would need either a correlation the workers do not compute or a client-side join across two results of unknown relative age — and an age-blind join would confidently pair a fresh read against a sweep from three days ago.
- **A completed result has no timestamp the UI can trust.** Both status endpoints re-present a stored result on reload, so any "finished at HH:MM" the surface stamped client-side would be the time the *page* saw it, not the time the run ended. The surface therefore states no finish time at all.
- **NR5G bandwidth is passed through raw.** `qmanager_cell_scanner:170-175` keeps the NR carrier bandwidth as the modem's resource-block count, because the MHz conversion depends on SCS. LTE *is* converted (`:158-169`). The two columns therefore print different units under one header.
- **A partial neighbour read reports as an error, not as partial data.** The envelope has no third state between `complete` and `error`, so a leg that was blocked while the other found zero rows is surfaced as a failure with a message naming the leg. That is the honest answer available today, but a `partial` status carrying the rows that *did* arrive would be better — it needs a transport-shape change on both sides.

## Related

- [at-command-transport.md](at-command-transport.md) — `qcmd`, the AT mutex, the "sip, don't gulp" convention
- [tmp-file-ownership.md](tmp-file-ownership.md) — which direction `fs.protected_regular=1` actually blocks
- [tower-locking.md](tower-locking.md) — `tower/lock.sh`, the payload shapes this surface targets, the failover watcher a scan-initiated lock arms
- [connection-watchdog.md](connection-watchdog.md) — the `LOCKED` maintenance state the marker drives
- [radio-information.md](radio-information.md) — the `/cellular/` index that links here
