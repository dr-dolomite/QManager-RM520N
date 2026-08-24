# Cell Scanner (`/cellular/cell-scanner/**`)

> **Applies to:** RM520N-GL (SDX65) · verified 2026-08
> **RG501Q-EU (SDX55):** unverified — see [`platform-matrix.md`](./platform-matrix.md)

**Three routes share one prefix and one visual vocabulary, and exactly two of them talk to the modem — at costs that differ by roughly 100x.** A full sweep (`AT+QSCAN=3,1`) holds the single global AT mutex for 30–180 seconds and pauses every other modem operation on the device, including the poller that feeds the dashboard you are reading the page on. A neighbour read (`AT+QENG="neighbourcell"`) holds the same mutex for about two seconds. The frequency calculator holds nothing — it is browser arithmetic. That asymmetry is the organising idea of the whole surface, and most of what follows exists to keep it visible.

This doc records the invariants and sharp edges a contributor needs **before** touching the family: the single `flock` that makes the two scanning routes mutually exclusive and how it survives the CGI that took it, why the two routes are deliberately not merged, the `/tmp/qmanager_long_running` maintenance contract that was described in two docs long before anything implemented it, why this surface keeps signal thresholds that disagree with the rest of the product, why `0` is a sentinel rather than a reading, why the two result types were not widened into one, and why the calculator takes the family's anchor geometry while taking none of its run vocabulary.

The rationale for the individual design moves lives in the commits (`a2394ee`, `e4e5441`, `5871e8c`, `16d129c`) and in the long file header of `components/cellular/cell-scanner/shapes.ts`. This doc does not restate them.

## Quick Reference

| Thing | Where |
| ----- | ----- |
| Full sweep route | `/cellular/cell-scanner` (`app/cellular/cell-scanner/page.tsx`) |
| Neighbour read route | `/cellular/cell-scanner/neighbourcell-scanner` |
| Frequency calculator route | `/cellular/cell-scanner/frequency-calculator` |
| Calculator coordinator | `components/cellular/cell-scanner/freq-calculator/calculator.tsx` |
| Calculator types + arithmetic (pure, no copy) | `components/cellular/cell-scanner/freq-calculator/calc-model.ts` |
| Calculator readout rail (the anchor's left column) | `components/cellular/cell-scanner/freq-calculator/calc-readout.tsx` |
| Calculator band grid + agreement verdict | `components/cellular/cell-scanner/freq-calculator/band-tiles.tsx` |
| Calculator history list | `components/cellular/cell-scanner/freq-calculator/history-list.tsx` |
| Band tables + channel↔frequency maths | `lib/earfcn.ts` |
| Geometry + tone contract (all three routes) | `components/cellular/cell-scanner/shapes.ts` |
| Result + transport types | `types/cell-scanner.ts` |
| Full-sweep coordinator | `components/cellular/cell-scanner/scanner.tsx` |
| Neighbour coordinator | `components/cellular/cell-scanner/neighbourcell/neighbour-scanner.tsx` |
| Shared run hero | `components/cellular/cell-scanner/run-hero.tsx` |
| Shared run summary ("What this sweep found") | `components/cellular/cell-scanner/run-summary.tsx` |
| **All** derived aggregates (pure, no copy) | `components/cellular/cell-scanner/summaries.ts` |
| Shared cross-route link | `components/cellular/cell-scanner/sibling-link.tsx` |
| Shared under-table strip | `components/cellular/cell-scanner/table-note.tsx` |
| Shared empty / error panels | `components/cellular/cell-scanner/scan-states.tsx` |
| Shared results table | `components/cellular/cell-scanner/scan-table.tsx` |
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
| i18n | `cell_scanner.*` in `public/locales/{en,zh-CN,zh-TW,it,id}/cellular.json` (**225 paths in `en`**, covering all three routes — `cell_scanner.neighbour.*` (**58 paths**) and `cell_scanner.calculator.*` (**68 paths**) are subtrees. The whole family had **zero** i18n before 2026-08-12; the count dropped 227 → 225 on 2026-08-24 when the two `summary_title` keys retired with the summary panel's heading). All five locales now carry the same 225, and `bun run i18n:check` is clean at `strict` |

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
| `/tmp/qmanager_long_running` | www-data | `qmanager_cell_scanner` **only** | Maintenance marker — see below |
| `/tmp/qmanager_at.lock` | mode 0666 | `qcmd` | The single global AT mutex |

> ℹ️ **The pid files are not a gate.** Both start endpoints used to enforce "one at a time" by testing their own pid file; they now enforce it with the `flock` above and keep the pid file only to decide *which* of two messages to show. `pid_alive()` is `[ -d /proc/$1 ]` (`platform.sh`) — it proves *a* process with that number exists, never that it is our worker, so it must never be load-bearing for exclusion again.

### AT commands this surface issues

| Operation | Command | Sent by |
| --------- | ------- | ------- |
| Full sweep, LTE + NR5G, extended fields | `AT+QSCAN=3,1` | `qmanager_cell_scanner:60` |
| LTE neighbours | `AT+QENG="neighbourcell"` | `qmanager_neighbour_scanner:57` |
| Enable NR5G measurement reporting | `AT+QNWCFG="nr5g_meas_info",1` | `qmanager_neighbour_scanner:115` |
| Read NR5G measurements | `AT+QNWCFG="nr5g_meas_info"` | `qmanager_neighbour_scanner:119` |

The frequency calculator issues **nothing**. It has no fetch and no AT contact, which is why it has no posture chip, no elapsed clock, no spinner and no cost statement — nothing is spent. It *does* take the family's anchor card, at `rounded-hero`, via `CALC_HERO` and the shared `HERO_SPLIT` — see [The calculator takes the anchor, not the run](#the-calculator-takes-the-anchor-not-the-run).

## The cost asymmetry, and why the routes are not merged

`qcmd` serialises every AT command in the product on `flock` over `/tmp/qmanager_at.lock` (`scripts/usr/bin/qcmd:39`). "flock" is an advisory file lock — a do-not-disturb sign on the file that only one process may hold at a time — so while a sweep holds it, nothing else on the device can reach the modem.

`qcmd` classifies commands into two wait budgets (`qcmd:104-109`, `qcmd:41-42`):

| Class | Match | Lock wait |
| ----- | ----- | --------- |
| Long | `*QSCAN*`, `*QSCANFREQ*`, `*QFOTADL*` | `LOCK_WAIT_LONG=10` s |
| Everything else | — | `LOCK_WAIT_SHORT=5` s |

`AT+QENG` is **not** long. So firing a neighbour read while a sweep is in flight gives the neighbour worker five seconds against a lock that will be held for up to three minutes; `flock_wait` gives up, `qcmd` exits 2, and `output_result "" "modem_busy"` (`qcmd:165-169`) is what the worker sees. The neighbour worker treats a non-zero `qcmd` exit as "skip this half" (`qmanager_neighbour_scanner:62`, `:122`).

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
- `useCellScanner` still computes and returns `elapsedSeconds`, and **no component consumes it** — see [The running state carries no numbers](#the-running-state-carries-no-numbers). That is not dead code left behind by accident: leaving the transport intact is what keeps the number-free running state a *surface* decision, revisitable without touching a hook that also owns the poll loop, the failure counter and the `sessionStorage` restore.

## What the two runs are called

**Four titles were reworded on 2026-08-24. No key was added or removed** — the family is still 225 paths in `en`, all five packs moved together, and `bun run i18n:check` was clean at `strict` before and after.

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

## The `/tmp/qmanager_long_running` contract

**Short version: the marker tells the two root daemons "a long AT command is in flight — stand down", and for most of this product's life it had three readers, two deleters and zero writers.** `docs/ARCHITECTURE.md` and `docs/BACKEND.md` both described the guard; nothing in the tree created the file. During a real sweep the poller kept issuing serving-cell and `QCAINFO` reads that each waited five seconds on the lock and returned `modem_busy`, and the watchdog — the thing that reboots the modem when it believes the connection died — never saw maintenance mode at all.

> ⚠️ **A writer landing in the repo is not the same as a marker that works, and this doc previously conflated the two.** The `qmanager_cell_scanner` writer was committed on 2026-08-11, but the deployed device was still running the old binary, so on hardware the marker continued to have zero writers and the poller continued not to back off. **Verified end-to-end on 2026-08-12**: with the current binary deployed, starting a sweep raises the marker, `/tmp/qmanager_status.json` reports `system_state: "scan_in_progress"` for the duration, and it returns to `"normal"` once the sweep completes. When you are checking this guard, check the binary on the device — `/usr/bin/qmanager_cell_scanner` — not the file in the tree.

The contract:

| Role | Who | Where |
| ---- | --- | ----- |
| **Writer** | `qmanager_cell_scanner`, as **www-data** | `qmanager_cell_scanner:59` — `: > "$LONG_FLAG"`, raised *before* taking the AT mutex |
| Clearer (normal) | the same worker's `cleanup()` on `EXIT`/`INT`/`TERM` | `qmanager_cell_scanner:41-44` |
| Reader | `qmanager_poller` (root) → `system_state="scan_in_progress"`, ping-only, no AT | `qmanager_poller:2082-2086` |
| Reader | `qmanager_watchcat` (root) → `LOCKED`, and Tier 2 skipped outright | `qmanager_watchcat:203`, `:346` |
| Expirer | `qmanager_poller`, if the flag is older than `LONG_FLAG_MAX_AGE` (300 s) | `qmanager_poller:2059-2073`, constant at `:79` |
| Clearer (boot) | `scripts/etc/init.d/qmanager:87` | removes any flag stranded across a reboot |

Both readers test **existence only**. The file has no content, so none of the `/tmp` publishing rules in [tmp-file-ownership.md](tmp-file-ownership.md) apply — there is nothing to write into it and nothing to `mv` over it.

> ℹ️ **Why a www-data writer with root readers is safe here, and would not be in reverse.** `fs.protected_regular=1` blocks a process from opening a *world-writable file it does not own* in a sticky directory for writing — and on this device that restriction bites **root**, not www-data (validated on live hardware; see [tmp-file-ownership.md](tmp-file-ownership.md), which corrected three docs that had the direction backwards). `stat()` and `unlink()` are unaffected by it. So root reading the flag's existence and root removing it both work; a design that required root to *write* this www-data-owned file would not. If you ever move the raise into a root helper, the ownership flips and every one of these statements has to be re-derived.

**The neighbour worker does not raise the flag, and this is deliberate.** A ~2 s hold does not warrant parking the watchdog: the poller would drop a cycle and the watchdog would skip a tier for an operation shorter than the poller's own cadence. `qmanager_neighbour_scanner` has no `LONG_FLAG` at all — do not add one "for symmetry".

The 300 s expiry is the only thing that recovers a flag from a worker killed with `SIGKILL` (which no trap catches). `AT+QSCAN` is documented at up to 180 s, so the ceiling has ~2 minutes of headroom; if a future long command exceeds 300 s, raise `LONG_FLAG_MAX_AGE` rather than teaching the worker to re-touch the file.

## Signal thresholds: deliberately divergent

This surface rates cells with **three** tiers at **-85 / -100 dBm** (`shapes.ts:344-345`). The rest of the product rates the serving cell with the **four**-tier `RSRP_THRESHOLDS` in `types/modem-status.ts:296` (-80 / -100 / -110 / -140).

That is not an oversight and not drift. A scan rates **candidate** cells the modem is *not camped on* — a different judgement from grading the link you are currently carrying traffic over. The divergence was reviewed and kept on purpose on 2026-08-11.

> ⚠️ Do not "unify" these as a side effect of unrelated work. If a future change genuinely wants one scale, it needs its own decision and its own record here — not a drive-by import of `RSRP_THRESHOLDS`.

## The 0-dBm sentinel

**Both workers emit `0` for an unreported reading, not `null`.** The sweep worker's jq stage coerces an empty field to `0` for `signalStrength`, `pci`, `earfcn`, `band`, `bandwidth`, `cellID` and `tac` (`qmanager_cell_scanner:249-255`); the neighbour worker does the same for `signalStrength`, `frequency` and `pci` (`qmanager_neighbour_scanner:190-192`). Only `rsrq` / `rssi` / `sinr` are allowed to be `null`.

0 dBm is not a physically meaningful RSRP, so `signalTier()` (`shapes.ts:347-355`) treats it as the sentinel and returns the `none` tier — a **muted** "No data" chip with `signal_cellular_off`, not a verdict. The incumbent rendered 0 as the destructive **"Bad"** chip, which asserted a judgement where there was no reading at all.

Two rules follow:

- `none` is **muted**, never `warning`. The same table column already spends `warning` on "Fair"; giving "No data" the warning role puts two unrelated states in one tone in one slot.
- If a worker is ever changed to emit `null` instead of `0`, `signalTier` already handles it (`null` and `undefined` both map to `none`) — but the numeric fields' TypeScript types in `types/cell-scanner.ts` would need widening, and every `tabular-nums` cell that prints the raw number needs a formatter.

## Lock is LTE-only on the neighbour route

The lock action on a neighbour row is enabled only when `networkType` starts with `LTE` (`neighbour-scan-result.tsx:214-215`). The reason is upstream, in the backend: `tower/lock.sh`'s NR-SA branch requires **four** fields — `pci`, `arfcn`, `scs` and `band` — and refuses the request with `missing_fields` if any is absent (`scripts/www/cgi-bin/quecmanager/tower/lock.sh:221-222`), then validates SCS against `15|30|60|120|240` (`:227-231`).

A neighbour report carries neither a band nor an SCS. `AT+QNWCFG="nr5g_meas_info"` returns only `<arfcn>,<pci>,<rsrp>,<rsrq>,<sinr>` (`qmanager_neighbour_scanner:131-139`), and `NeighbourCellResult` has no field for either. So an NR neighbour is structurally unlockable from this route — not merely unsupported.

The control is **disabled with a reason**, not hidden: `cell_scanner.neighbour.actions.lock_lte_only` renders in place of the label. The incumbent suppressed the button entirely for non-LTE rows, which left the reader to infer a rule from an absence.

The full-sweep route *is* able to lock NR, because `AT+QSCAN` reports band and SCS (`qmanager_cell_scanner:131-137`). Where the modem reported no SCS, the shared dialog applies the common 30 kHz default at the point of use (`NR_DEFAULT_SCS`, `lock-cell-dialog.tsx:67`, applied at `:85`) rather than fabricating one in the worker — one place to look when a lock lands on the wrong numerology.

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

`ScanStatus` (`idle` | `running` | `complete` | `error`) *is* shared — it is the workers' transport vocabulary, identical on both routes. It is mapped to the surface's `RunPosture` (`idle` | `scanning` | `complete` | `failed`) in exactly one place, `runPosture()` in `shapes.ts:283`. The two vocabularies use different words on purpose: "running" is what the modem is doing, "scanning" is what the page is showing, and collapsing them would make a rename of one a silent rename of the other. `runPosture` takes a structural union rather than importing `ScanStatus`, which keeps `shapes.ts` free of app-code imports while still failing the build at the call site if the two unions diverge.

## What is shared, and what is deliberately not

Eleven modules are shared by the two scanning routes: `lock-cell-dialog.tsx`, `run-hero.tsx`, `run-summary.tsx`, `sibling-link.tsx`, `table-note.tsx`, `summaries.ts`, `scan-states.tsx`, `scan-table.tsx`, `scanner-skeleton.tsx`, `signal-badges.tsx` and `shapes.ts`. (The sweep takes only `ScanErrorState` from `scan-states.tsx` — its empty panel is the shared `Empty` primitive instead; see [The sweep's empty state owns its action](#the-sweeps-empty-state-no-longer-owns-an-action-and-no-longer-renders-before-a-run).)

The four added in 2026-08-12's refinement follow the same rule as the hero: **shape shared, words not**. `run-summary.tsx`, `sibling-link.tsx` and `table-note.tsx` take every string as a prop; `summaries.ts` returns numbers, tiers and identifiers and never a sentence.

Three of the eleven reach across to the **calculator** as well: `shapes.ts` (which holds the calculator's own section), `sibling-link.tsx` (its anchor's cross-route link) and `scan-states.tsx` (`ScanEmptyState`, for the bands card and the empty history). The calculator's own four modules live under `freq-calculator/` and are used by nothing else.

`lock-cell-dialog.tsx` is the one worth calling out: **it owns the write, not just the confirmation.** A component that only asked the question and handed back a callback would have left both routes holding their own identical `fetch`, payload builder and toast set — which is the duplication that actually cost something. The caller owns exactly one thing: which cell is targeted, cleared when the dialog closes. `kind: "nr_sa" | "lte"` is a discriminator on the *target* rather than a flag on the request, because `AT+QNWLOCK` takes two different shapes and the modem rejects the wrong one outright.

**The CSV builders are NOT shared, and should not be.** Each route keeps its own `buildCsvRows` and header constant (`scanner.tsx:41`/`:59`, `neighbour-scanner.tsx:45`/`:60`) because the two row shapes have different columns; both go through the shared `lib/download-csv.ts` for the actual download. Sharing the *builder* would require the widened type this doc argues against.

> ℹ️ **The download BUTTON moved on 2026-08-24; the builders did not.** Both routes took "Download CSV" out of the hero header's `actions` slot and now render it in an end-justified row (`flex justify-end`) directly under the results table, inside the results card, only when there are rows. The header's `actions` therefore carries exactly one act — "Sweep again" / "Read again", the thing you do to the *run* — while exporting is a fact about a finished table and sits at that table's own bottom edge. It is the same `Button` (`variant="tonal-neutral"`, `PILL_ACTION`), the same `handleDownload`, and still the one shared `cell_scanner.run.download` key on both routes. Nothing about `buildCsvRows`, either header constant or `lib/download-csv.ts` changed. Both routes moved together on purpose: the two are siblings a click apart, and a control that changes rows between them is the defect the [empty panel's button](#the-sweeps-empty-state-no-longer-owns-an-action-and-no-longer-renders-before-a-run) was retired for.

## The calculator takes the anchor, not the run

`/cellular/cell-scanner/frequency-calculator` shares the route prefix and the canon — `CellularPageHeader`, `SECTION_HEAD`, role radii, the `nr`/`lte` identity variants, the machine-voice split — and now also the family's **anchor geometry**. It takes `CALC_HERO` (which *is* `RUN_HERO`, deliberately the same exported value rather than a copy of its class string) and the shared `HERO_SPLIT`. What it does **not** take is the **run vocabulary**: no posture chip, no elapsed clock, no spinner, no cost statement — it makes no request, holds no lock and spends nothing.

Its form column's `FORM.NOTE` is now a **spec citation only**, rendered once there is a result to cite. The pre-calculation hint that used to fill the same slot (`cell_scanner.calculator.form.hint_auto`, *"Auto picks LTE or NR from the number's range"*) was removed on 2026-08-14 in the same pass as the scanner's cost statement: the three mode tabs directly above it already say Auto is one of three choices. `noteText` is `string | null` and the note block is suppressed when it is null, so the slot is empty before the first calculation rather than pre-filled with instruction.

**This inverts what this doc and both of those files used to say**, and the old argument is worth keeping because the interesting part of it was the mistake: it held that a `rounded-hero` radius here was "a promise of importance the page cannot keep", on the grounds that the family's heroes are *run* heroes and nothing here runs. Right about runs, wrong about heroes. What an anchor promises is not that something ran — it is that **one object on the page is the thing the reader came for**, and everything else on the page reports on it. That is unambiguous here: you came to turn a channel number into a frequency, and the bands grid and the history are both readings of that one answer. The incumbent's two peer cards claimed the converter and its own history were equally important, which is the single thing this page is certain they are not.

The layout that follows is three cards: the anchor (readout rail + form), the matching bands, the history. **The middle card never disappears** — it carries an empty state before the first calculation, as the sweep's results card does, so the page fills in rather than assembling itself. (The two empties are no longer the *same* object: see [The sweep's empty state owns its action](#the-sweeps-empty-state-no-longer-owns-an-action-and-no-longer-renders-before-a-run).)

`shapes.ts` (`components/cellular/cell-scanner/shapes.ts`, "The frequency calculator" section) carries the long form of the decision, plus module-level `IDENT` and `FIGURE` — the machine-voice pair that was previously nested inside `TABLE` and is now hoisted so the calculator's tiles and history rows can key off the same two strings the scan table does.

### The readout rail

The anchor's left column (`calc-readout.tsx`) sits exactly where the scanning routes put their posture rail, and it reuses `POSTURE.ROOT` and `POSTURE.DISC` outright rather than restating their sizes. Same object, same corner, same hero — they must never drift apart by a padding step. What differs is the tone map: `READOUT_DISC` instead of `POSTURE_DISC`.

**Four states, four distinct glyphs**: `tune` when nothing has been calculated, `graphic_eq` for a resolved frequency on **either** radio, `error` for a failure. Idle and resolved share a slot and must not share a glyph.

`READOUT_DISC.lte` (`bg-lte-container`) and `.nr` (`bg-primary-container`) are **IDENTITY fills, not status roles** — they say which radio family owns the answer. Per DESIGN.md's Identity-Chip Rule that meaning has to be carried non-chromatically too, and it is: the `NetworkTypeBadge` and the band label directly beneath the disc say "NR" and "n78" in words.

The frequency is `READOUT.FIGURE` at **44px**, not `POSTURE.CLOCK`'s 48 — a frequency runs to seven characters (`3489.42`) where an elapsed clock runs to four, and at 48px the longest value collides with the 17rem rail on the phone-width view. The unit is a separate node at label size, so "MHz" does not shout as loudly as the number.

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

### The `ulEarfcnOffset` correctness fix

**Short version: the old calculator computed the uplink channel number as `earfcn + 18000`, which is right for most FDD bands and wrong for three shipped ones — and it printed the wrong answer in `font-mono`, the voice this product reserves for things the device actually said.**

The real rule (3GPP TS 36.101 §5.7.3) is `N_UL = N_Offs-UL + (N_DL − N_Offs-DL)`, and `N_Offs-UL` is a **table value**, not a constant gap. `LTEBandEntry` now carries it as `ulEarfcnOffset` (`lib/earfcn.ts:34`), sourced from TS 36.101 Table 5.7.3-1, and `lteULEarfcn(band, earfcn)` (`:220`) applies the formula.

Verified against the shipped table, the gap is 18000 for every FDD band except:

| Band | `N_Offs-DL` | `N_Offs-UL` | Actual gap | Old `+18000` was off by |
| ---- | ----------- | ----------- | ---------- | ----------------------- |
| B30 (WCS 2300) | 9770 | 27660 | **17890** | +110 |
| B66 (AWS-3) | 66436 | 131972 | **65536** | −47536 |
| B71 (600 MHz) | 68586 | 133122 | **64536** | −46536 |

Two smaller corrections came with it. `lteULEarfcn` takes the band **as an argument** rather than looking it up, so a caller iterating several matching bands gets each band's own answer instead of the first match's. And it returns `null` for SDL bands (B29, B32), which have no uplink carrier at all — the old expression fell through to `earfcn` unchanged and printed a UL channel for a downlink-only band. `MatchingBand.ulChannel` is `null` for both SDL and NR, and `band-tiles.tsx:151` omits the row entirely rather than printing a placeholder. NR has no second channel number to omit: it numbers the uplink on the same global raster as the downlink.

### Auto's dead zone has a name

Auto mode picks LTE or NR by magnitude. The LTE table stops at EARFCN **56739** and the NR table starts at ARFCN **123400** (`MAX_LTE_EARFCN` / `MIN_NR_ARFCN`, both derived from the band tables rather than hardcoded). Everything in **56740–123399** belongs to neither.

That gap used to fall off the end of auto's own if/else and report the generic `no_band` — "no band matches your number", which reads as *your number is wrong* when the true answer is *Auto cannot tell which scheme you meant here*. It now has its own code, `auto_gap`, whose sentence names the range and points at the LTE and NR tabs. The gap is a fact about our band tables, not about the input, and the copy says so.

> ℹ️ The error strip and the quiet method note share **one slot** and are never both shown (`calculator.tsx:312`). Both reachable failure codes already end with the recovery, so leaving the hint up under a red strip prints the same advice twice in two voices.

### Errors are codes, and why that rule generalises

`calculateFrequency` is a module-level pure function outside `t()`, and it used to return English sentences **as data** (`{ error: "Please enter a valid number" }`) that travelled through React state into the DOM with no key ever involved. `bun run i18n:check` only sees keys, so this was invisible to the gate. It now returns a `CalcErrorCode` (`empty` | `not_a_number` | `negative` | `auto_gap` | `no_band` | `unexpected`) mapped to a **literal** key at the call site (`ERROR_KEY`, `calculator.tsx:76`), with runtime values interpolated rather than concatenated so a locale can place them where its grammar wants.

> ℹ️ Any pure function that returns user-visible English is an i18n hole the checker cannot see. Return a code.

The same rule holds for the spec citations: `NR_SPEC` and `LTE_SPEC` (`calc-model.ts:45-46`) are **proper nouns** and live in code rather than in the five locale files, so a translator cannot accidentally localise a clause number. `t()` receives the surrounding sentence and interpolates them verbatim.

### Motion on the calculator

There is exactly **one authored moment**, and everything else arrives with the page's entrance cascade and then holds still.

- **The readout swap.** The calculation is user-initiated and instantaneous — no request, no spinner, nothing to wait for — so without motion the 44px figure simply becomes a different 44px figure between two frames, and a reader who mistyped one digit cannot tell whether the button did anything. The shared `SwapLabel` gives the outgoing value an exit and the incoming one an entrance offset by one stagger step. The swap key is `networkType:channelLabel:figure`, not the figure alone: two calculations resolving to the same MHz on different radios must still read as a change.
- **Band tiles cascade on `staggerRows`** (80 ms step, 5px rise — the *row* cascade, not the card one; these are siblings a few pixels apart and a 10px lift would read as the card reflowing). The container declares `initial`/`animate` explicitly rather than inheriting them, because it mounts on a swap long after the page's entrance clock has settled — a variants-only child mounting on a swap stays pinned at `hidden` forever, which renders a complete DOM at zero opacity and passes every checker. Its `key` is the channel, so a **second** calculation replays the cascade instead of React quietly reconciling four tiles into four tiles.
- **History rows enter on `standard` and exit on `quick`.** `AnimatePresence initial={false}` keeps the first paint silent, so ten rows restored from `localStorage` do not claim ten things just happened.

> ℹ️ **The history exit is not an Enter-Only Rule violation.** That rule governs **conditions** and **navigation** — a banner leaving means the condition cleared and should feel immediate, and an outgoing route is already gone. Neither applies to a row the user just deleted: here the deletion *is* the event and the row is the thing that was acted on, and a row vanishing between two frames while the rows below it jump up is indistinguishable from having deleted the wrong one. The exit is the *faster* leg for the same reason the Modal-Exit Rule gives — confirmation of something already decided should not be slower than the decision.

### History persistence and its silent migration

History lives in `localStorage` under `earfcnHistory` (`HISTORY_KEY`), capped at `HISTORY_LIMIT` = 10, most recent first.

The stored row shape **narrowed**: it used to be a whole `CalculationResult` (`earfcn` for the channel, `possibleBands` as an array of full band *objects*), and is now `HistoryEntry` (`channel`, and `bands` as plain numbers). That cuts the payload by roughly 90% and stops a schema change in the band tables from resurrecting a stale duplex mode out of the browser.

**The key did not change, and `readHistory()` normalises the legacy shape on read** (`calc-model.ts:268`) — it accepts `channel` or `earfcn`, and `bands` as numbers or `possibleBands` as objects — so nobody loses saved history on upgrade. A row that survives neither shape is dropped **individually** rather than failing the whole parse; a corrupt or unreadable store is an empty history, never a crash. `writeHistory` swallows quota and private-mode failures for the same reason: the history is a convenience and the calculation itself already succeeded.

Two smaller rules the coordinator holds:

- **Only an asked-for calculation is recorded.** Pressing Calculate or Enter is a request and lands in the history; switching the mode tab re-answers a question already on screen and does not, or ten tab presses would bury the ten calculations the reader actually made (`run(…, record)`, `calculator.tsx:126`).
- **The saved history is read after mount, in an effect, not in a lazy `useState` initialiser.** On a statically exported page the initialiser runs during render, so the server produces an empty list and the client's first render produces ten rows — a hydration mismatch React resolves by throwing the server's markup away.

## Machine voice on this surface

The two voices are now **module-level** `IDENT` and `FIGURE` (`shapes.ts:355`, `:358`), because only one of the three routes is a table; `TABLE.IDENT` / `TABLE.FIGURE` alias them, and the calculator's tiles, input and history rows key off the same two strings.

`TABLE.IDENT` is `font-mono` and carries band, EARFCN, PCI, Cell ID and TAC — identifiers that hold steady until something reconfigures them. `TABLE.FIGURE` is interface-font `tabular-nums` and carries RSRP, RSRQ, SINR and RSSI — readings. `POSTURE.CLOCK`, `TOOLBAR.COUNT`, `SUMMARY.VALUE` and `TABLE_NOTE.TALLY` are changing figures and therefore also interface-font `tabular-nums`, never mono. This is DESIGN.md's Machine-Voice Rule applied per value; see DESIGN.md > Named Rules.

The split runs **per detail, not per tile**, inside the run summary: a provider's band list and a relation's channel numbers are identifiers (`SUMMARY.DETAIL_IDENT`, mono), while "best −113 dBm" and "5 channel only" are readings and counts (`SUMMARY.DETAIL_FIGURE`). The caller tags each detail with its voice, because only the caller knows what the string is.

Every count on this surface must be assembled by the i18n layer's plural machinery, never by a JS ternary — the table's row count, the four tier tallies, the verdict, the summary tiles' overflow and channel labels. The incumbent hardcoded `filtered === 1 ? "cell" : "cells"` in *both* copies, which is wrong in four of the five shipped locales before a translator ever sees it. That is also why the tally is a **list of separate strings** rather than one sentence: one plural rule cannot carry four independent counts, and the No-Dot-Separator Rule bans the `·` that would otherwise glue them (DESIGN.md > Named Rules).

## The posture chip is gone

The hero header carried a `Badge` reading Ready / Sweeping / Complete / Failed, morphing its fill on the `standard` clock while its label crossfaded on `quick`. It was a well-built **restatement**: the posture rail immediately below it already says the same thing with a tinted disc, a spinning glyph, a title and a line of body copy. Two objects, one fact, ~200 px apart — and the chip was the one with no room to explain itself.

Removed on both routes and all four postures (user decision, 2026-08-12). What follows from it:

- `RUN_BADGE` became `POSTURE_GLYPH` and **dropped its `BadgeVariant` field**. The disc still needs the glyph and its fill; nothing needed the badge role once there was no badge, and an exported field with no reader is exactly the dead contract `shapes.ts` exists to prevent. The disc's tone is `POSTURE_DISC`, unchanged.
- `cell_scanner.run.chip_*` and `cell_scanner.neighbour.run.chip_*` were deleted from all five locales.
- `SKELETON_SHAPE.CHIP` stayed — `scanner-skeleton.tsx` still mirrors the column menu with it.
- The vacated header slot now holds the [cross-route link](#cross-navigation-between-the-two-routes).

## The running state carries no numbers

While a sweep is in flight the rail shows a spinning disc, a title and a body line. **No `m:ss`, no count, no percentage, no ETA** — the elapsed clock was removed and nothing replaced it (user decision, 2026-08-12).

The reason is what the modem reports, which is nothing at all: `AT+QSCAN=3,1` publishes no per-band progress, no partial rows and no remaining time, and the status endpoint returns only `idle|running|complete|error`. The results arrive exactly once, as one JSON array, at completion. So every figure a running state could show would be either the one honest number available (elapsed) or a number the page invented about a process it cannot see — and elapsed itself invites the reader to estimate a remaining time that does not exist.

The "is it hung?" risk is answered by the **disc's ambient spin** (the surface's single sanctioned loop, and now the only thing carrying "still working") and by copy that sets the expectation, not by a figure.

`POSTURE.CLOCK` survives under its old name with one occupant, the completed result count; its doc comment records the change. Restoring a clock means restoring `formatElapsed` and `cell_scanner.a11y.elapsed`, both deleted for the same reason.

## The completed rail is two marks, not five

Also a user decision, 2026-08-12, and the second half of the same argument. The completed posture used to stack **disc → count → context line → title → body**:

> ( ✓ ) · **8** · "across 3 providers on 7 bands" · "Sweep finished" · "8 cells in range."

Three of those five say the same thing. The body sentence restated the figure directly above it, and the context line re-derived a provider and band breakdown that the summary panel two hundred pixels to its right already gives provider by provider. Both lines are **gone on the complete posture only** — `postureBody` is still rendered for idle, scanning and failed, where it is the only copy explaining what is happening — and the two survivors were sized up to carry the rail alone: the disc 52 → **64 px** with a 24 → **32 px** glyph, the count 28 → **48 px**. Both sizes survive the 2026-08-24 rebuild unchanged; what moved is which constant holds them — the hero's rail is now `RAIL` (a row) and the constants are `RAIL.DISC` and `RAIL.COUNT`, while `POSTURE.DISC` keeps the 64 px disc for the results card's panels. `SKELETON_SHAPE.POSTURE` is gone with the hero's use of `POSTURE.ROOT`; `EMPTY_PANEL` is what restates the 13 rem now. All of them are literals rather than a shared interpolated string because Tailwind's JIT scans source text and an interpolated `min-h-[${X}]` compiles to nothing.

What went with the lines:

- `POSTURE.CONTEXT` and `RunHeroProps.metricContext`, deleted.
- `SweepSummary.providerCount` / `.bandCount` and `NeighbourSummary.channelCount`, deleted — the context caption was their only reader, and an aggregate with no consumer is an untested aggregate.
- Ten locale keys across all five packs: `cell_scanner.run.context_providers_*`, `context_bands_*`, `complete_body_*` and `cell_scanner.neighbour.run.context_channels_*`, `complete_body_*`.

**The rail's figure carries no unit**, and that is deliberate rather than an oversight: the results card below it is headed "Cells found", and each summary tile beside it now states its own count *with* a unit ("12 cells"). A later canon pass should restore neither retired line, and should not "recover" the unit with a new caption under the figure.

> ℹ️ The summary panel's own "What this sweep found" heading was **deleted** on 2026-08-24 along with the panel wrapper — see [The summary tiles are neutral and the colour is on the disc](#the-summary-tiles-are-neutral-and-the-colour-is-on-the-disc). The unit argument above therefore now rests on the results card's heading and the tiles' own fact lines, not on that heading.

The 32 px glyph propagates to `scan-states.tsx`, which shares `POSTURE.DISC` for the results card's empty and error panels — the same 64 px disc as the hero's `RAIL.DISC`, so a 24 px glyph would have floated inside an oversized circle there.

## The hero is as tall as it has something to say

**The sweep page asks three questions in sequence, and since 2026-08-24 the hero is only as big as the one it is currently answering.** Before a run the reader wants to know *how do I start this*; during, *is it still working*; after, *what did it find*. The hero used to give all three the same fixed height, sized for the third — a `minmax(0,17rem) 1fr` split holding a 13 rem posture rail beside a summary column that at idle contained nothing but the launch button. Roughly 280 px of card spent saying that nothing had happened yet, which the reader could already see.

The three phases now:

| Posture | The hero | The results card |
| ------- | -------- | ---------------- |
| `idle` | a compact **launch bar**: title with the description stacked beneath it, and the primary action in the header's `META` slot. No rail, no summary column | **not rendered at all** |
| `scanning` | the same container **grows** into the rail-plus-summary body. The rail carries the spinning disc and the copy; the summary arrives as a skeleton | enters on the shared `staggerItem` card cascade, showing `ScannerSkeleton` |
| `complete` | rail carries the 48 px count; summary carries real tiles | the table, or the empty panel if the run listed nothing |
| `failed` | rail carries the modem's own error string, in machine voice (`RAIL.TITLE_MACHINE`) — **and the hero withholds its launch button entirely** | `ScanErrorState`, which carries the single recovery action |

### The morph

The growth is a real container morph, not a swap: `HERO_MORPH` (`shapes.ts`) is a `grid-template-rows: 0fr → 1fr` wrapper over an `overflow-hidden` clip, so the card genuinely grows to whatever the body measures rather than animating toward a guessed pixel height. It runs on `--duration-emphasized` / `--ease-emphasized` (800 ms), because DESIGN.md files container size and shape changes there and this is the largest single re-proportion on the surface. The idiom already exists in the product at `components/onboarding/steps/step-connection.tsx`; only the clock differs.

Four details that are easy to undo by accident:

- **`RUN_HERO` carries no `gap-5`, and that is load-bearing.** A flex gap is paid whether or not the item it separates has any height, so a gap on the card would leave 20 px of unexplained space under the launch bar — in exactly the state the redesign exists to compact. The separation lives in `HERO_MORPH.BODY`'s own top padding, *inside* the clipped region, where it collapses with everything else.
- **`HERO_MORPH.CLIP` needs `min-h-0`.** Without it a grid row will not shrink below its content and the collapse silently does nothing.
- **`motion-reduce:transition-none` is not optional.** A reader who asked for less motion still needs the body; they need it instantly.
- **The open/closed pair lives in one constant**, driven by `data-[open=true]` rather than a conditional class string at the call site, so the two states cannot drift apart.

`isLoading` forces the body **open**. A first paint that starts collapsed and then grows the moment the worker's status arrives is a morph the reader did not cause.

### The structural consequences

- **The primary action moved into the header** (`SECTION_HEAD.META`, beside the sibling link). There is no action row under the summary any more, because at idle there is no summary for it to sit under — and a button that changes which row it belongs to depending on posture is the incumbent's problem in miniature.
- **The hero's rail is a row (`RAIL`), not the centred `POSTURE` stack.** Its height *is* the hero's height in every open state, so every pixel has to be carrying something; a centred 13 rem block was mostly air once the complete posture was down to a disc and a figure. `min-h-[6.5rem]` is the row measured (40 px of padding around a 64 px disc), mirrored by `SKELETON_SHAPE.RAIL`. It is `items-center` with **no** `justify-center`: the disc anchors the left edge, so variable-length copy beside it does not move the disc on every posture change.
- **`POSTURE` is now the results card's empty and error panels, and the calculator's readout rail — nothing else.** `SKELETON_SHAPE.POSTURE` is gone with it: those are terminal states that never stand in for data still loading.
- **`HERO_SPLIT` went 17 rem → 19 rem** on its fixed column, because a row has to fit a 64 px disc, a gap and a wrapping title where the old centred stack only had to fit the widest of them.
- **`CALC_HERO` is no longer an alias of `RUN_HERO`.** Both now read from a private `HERO_SHELL`, and the calculator appends `gap-5` — nothing on that page collapses, so its sections still want a real flex gap. A retune of the anchor's radius, padding or shadow still moves both.

> ⚠️ **The failed posture's missing hero button is deliberate.** `RunHero` has no opinion about it — the route passes `actions={null}` when `posture === "failed"` (`scanner.tsx`). The recovery affordance exists exactly once, in `ScanErrorState`. Adding a launch button back to the hero puts two buttons on one screen for one act, which is the same defect that retired the empty panel's trigger.

### The neighbour route deliberately does not morph

`RunHero` exposes the collapse as `idleCollapsed`, and the neighbour route is the reason the prop exists rather than the behaviour being unconditional. That route takes **every other part** of the 2026-08-24 change — the stacked section head, the neutral summary tiles with their tier discs, the header action row, the returned ink — and **not** the height morph.

It is the same cost asymmetry that keeps the two routes unmerged. A sweep holds the AT lock for 30–180 seconds, so the grow lands once, early, and the reader then waits *inside* the shape it grew into; the morph reads as the page committing to a long operation. A neighbour read is done in about two seconds: the container would finish an 800 ms grow, hold the skeleton for barely a second, and swap to the result. **Growth that resolves before the reader has finished registering it is jitter, not progress.**

Two consequences on that route:

- **Its hero is always open**, and its rail is present at idle carrying the `idle` posture — which is also the only place on the route that explains what a neighbour read *is* before you run one.
- **With no summary beside it, the rail takes the full width** via `HERO_RAIL_ONLY` rather than anchoring a 19 rem column with two thirds of a hero blank next to it. That blank is precisely the void the sweep's redesign removed from its own idle state, and passing an empty right-hand cell would import it here.

The results card also stays mounted at idle on that route, for the same reason: a two-second act does not need the page rearranged around it.

### …but its completed rail folds into the tile grid

**Short version: on the neighbour route's `complete` posture with rows, the hero stops drawing its own posture rail and the run's status is rendered instead as the first card *inside* the summary tile grid — so "Read finished", "Same frequency", "Other frequency" and "With measurements" are four cards of one size, rather than a fixed-width rail beside three auto-fitted tiles.** User-reported, 2026-08-24.

They are four peer facts about one finished read, and the split said the opposite: the rail's 64 px disc and 48 px count held a fixed `minmax(0,19rem)` column while the tiles' 52 px discs shared what was left, so the object with the least to say was the widest thing on the row and read as a different kind of object.

The mechanism is two optional props and no new component:

- **`RunHero` gained `hideRail`** (default `false`). When it is true **and** a `summary` is present, the hero skips its own rail and wraps the body in the single-column `HERO_RAIL_ONLY` instead of `HERO_SPLIT`, so the summary fills the whole width. `HERO_RAIL_ONLY`'s doc comment now records this as its second use — same shape, two reasons to reach for it.
- **`RunSummary` gained `leading`**, a `ReactNode` rendered as the first child *inside* `SUMMARY.GRID`. That placement is the whole point: the folded rail is subject to the identical `auto-fit` column sizing as the tiles rather than approximating it, which is what makes the four cards match rather than nearly match. `RunSummary` stays **copy-blind and posture-blind** — it does not build the node, it only owns a slot in the grid it already owns. (`tiles.length === 0` alone no longer means "empty": the empty sentence is shown only when there is also no `leading`.)
- **`neighbour-scanner.tsx` builds `readFinishedTile`** and is the only caller of either prop. The node restates the tile classes exactly (`SUMMARY.TILE` / `DISC` / `COPY` / `LABEL` / `DETAILS`) and reuses `cell_scanner.results.tally_rows` for its fact line, so it carries its siblings' typographic weight and their "N rows" phrasing. What it keeps of the rail is the run's own `POSTURE_DISC.complete` fill and `check_circle` glyph, **not** a `SignalTier` tone: the card is peer-sized but it is still the *run's* status, and keying it onto a tier would put a signal-coloured disc there for a reason that has nothing to do with signal.

**`hideRail` fails safe.** The route passes `hideRail={hasResults}`, and `RunHero` derives `showOwnRail = !hideRail || !hasSummary` — with no summary there is nothing carrying the folded status, so the rail is drawn regardless of what the caller asked for. Without that fallback a `true` on an `idle`, `scanning` or `failed` posture would delete the only object reporting what the page is doing. Those three postures, and a completed read that listed nothing, are otherwise untouched: they keep the hero's own rail, in `HERO_SPLIT` where a summary sits beside it and `HERO_RAIL_ONLY` at idle.

> ⚠️ **Do not "unify" the sweep route the same way.** It passes neither prop, and its rail keeps the 64 px disc, 48 px numeral and 19 rem column described in [The hero is as tall as it has something to say](#the-hero-is-as-tall-as-it-has-something-to-say) and [The completed rail is two marks, not five](#the-completed-rail-is-two-marks-not-five). That rail spends 30–180 seconds answering *is it still working*, and its size is what makes it readable from across a room while you wait; the neighbour route's two-second read never has that job, so its rail is only ever a completed count. The same cost asymmetry that keeps the height morph off this route keeps the fold off that one.

## The summary tiles are neutral and the colour is on the disc

**A tile's colour now means the strongest signal in that group.** `SUMMARY_TILE_TONE` / `summaryTileTone(index)` — a three-tone triad (`bg-primary` / `bg-primary-container` / `bg-uplink-container`) rotated by array position — was **deleted** on 2026-08-24. Tile bodies are `bg-surface-container` on every tile, and the hue moved to a 52 px disc (`SUMMARY.DISC`, 26 px glyph) keyed on the group's best measured tier.

The triad's stated problem was real: every tile on the identical `surface-container-high` made three (or nine) peer findings read as one grey block with numbers in it. But rotating by index solved it with colour that encodes nothing — tile 0 wore the brand's one acting fill because it sorted first, so a reader who learned "the blue one matters" had learned a fact about sort order. The body is neutral now and the differentiation *is* the finding.

`SUMMARY_TILE_DISC` (`shapes.ts`) is keyed onto `SignalTier` and `MaterialSymbolName`, so a tier with no tone or a glyph the subset does not ship fails the build rather than rendering untinted or as the literal ligature text:

| Tier | Disc tone | Glyph |
| ---- | --------- | ----- |
| `good` | `bg-success-container text-on-success-container` | `signal_cellular_alt` |
| `fair` | `bg-warning-container text-on-warning-container` | `signal_cellular_alt_2_bar` |
| `poor` | `bg-destructive-container text-on-destructive-container` | `signal_cellular_alt_1_bar` |
| `none` | `bg-surface-container-high text-on-surface-variant` | `signal_cellular_off` |

> ⚠️ **Every tier carries its own glyph, and that is not decoration.** `success-container` and `warning-container` measure **1.03:1** apart — the same surface to the eye, and identical under deuteranopia — so on a disc with no text inside it the glyph is the only thing separating good from fair. `signal_cellular_alt_1_bar` and `_2_bar` were added to the Material subset for this and the font was regenerated; a tier added later needs its own glyph in the subset before it will render at all.

Rules that follow:

- **`none` is not `warning`.** It means "the modem listed this group but measured none of it" — the absence of a verdict rather than a poor one. Same distinction `SIGNAL_BADGE.none` draws, and the incumbent table's bug.
- **The tier is derived in `summaries.ts`, never at a call site.** `ProviderGroup.tier`, `RelationGroup.tier`, `SweepSummary.overflowTier` and `NeighbourSummary.tier` are all computed there, because a tier is a judgement over a nullable reading and computing it inside a `.map()` in a component is how the same judgement ends up spelled two different ways on two routes. `summaries.ts` still returns no copy — the routes turn the enum into a label.
- **The overflow tile takes the best tier among the *folded* groups**, not `none`. The folded groups may hold the strongest reading of the run, and a muted disc there would claim nothing in them was measured.
- **The neighbour route's measurement-split tile takes the best tier across the whole read**, because it is a count rather than a relation and has no tier of its own. When nothing was measured the tier is `none`, which is exactly that tile's subject.
- **The disc's meaning must survive greyscale and a screen reader.** `MaterialSymbol` is ligature-driven and therefore always `aria-hidden`, so each tile carries an `sr-only` `tierLabel`. Both routes map the tier onto `cell_scanner.signal.{good,fair,poor,none}` through a literal-keyed record (`SIGNAL_LABEL_KEY`), restated per route rather than shared — `i18n:check` cannot see an interpolated stem, and a key it cannot see is a key nothing will ever report as missing.
- **The tier ladder is a different mark from the table's.** `signal_cellular_alt*` on a tile disc summarises a *group's* best reading; `SIGNAL_BADGE`'s `signal_cellular_N_bar` rates *one* cell. A sweep renders both on the same screen, so the two ladders must stay visually distinct.

### What went with the triad

- **The three `opacity-85` ink washes.** `SUMMARY.LABEL`, `DETAIL_IDENT` and `DETAIL_FIGURE` carried them only because a fixed neutral ink sat wrong on a solid `bg-primary` tile. With a neutral body the wash is a contrast reduction with nothing left to compensate for; the JSDoc that argued for it said as much.
- **The panel wrapper and its heading.** `SUMMARY.ROOT` (a `surface-container` panel) and `SUMMARY.TITLE` are gone, and the two `summary_title` keys — `cell_scanner.run.summary_title` ("What this sweep found") and `cell_scanner.neighbour.run.summary_title` — were deleted from all five locale packs. A `surface-container` panel holding `surface-container` tiles is not a tone step, it is a tile-shaped hole; the only way to keep a step would have been to push the tiles up to `surface-container-high`, which is the undifferentiated grey block the triad existed to fix. The tiles sit on the hero's own `surface` instead, which is a real step. The heading went with the panel because "What this sweep found" over four tiles inside a card titled "Full band sweep" (now "Full network sweep" — see [What the two runs are called](#what-the-two-runs-are-called)) was the third thing on one screen naming the same run.
- **`SummaryTile.value`.** The big numeral moved into the fact line *with* a unit — `t("cell_scanner.results.count", { count })` on the sweep, `tally_rows` / `tally_measured` on the neighbour route, all reusing existing plurals. On a row-shaped tile the disc holds the left edge, and a bare numeral with no unit beside it read as a second figure competing with the rail's count.
- **`SKELETON_SHAPE.SUMMARY`, the single tall bar.** The skeleton now mirrors **by composition**: the same `SUMMARY.GRID` holding the same `SUMMARY.TILE` boxes with a disc placeholder and two line boxes inside (`SUMMARY_DISC` / `SUMMARY_LABEL` / `SUMMARY_DETAILS`, `SUMMARY_TILES = 4`). A single `h-[13.5rem]` bar is a shape the loaded panel can no longer take.

> ℹ️ `SKELETON_SHAPE.SUMMARY_DISC` restates `rounded-pill` and `size-13` rather than importing `SUMMARY.DISC`. That is not laziness: `cn()` is bare `twMerge`, which cannot dedupe this codebase's custom radius names, so `Skeleton`'s own `rounded-md` beats a custom radius alphabetically. `size-13` has no default to lose to.

> ⚠️ **`VERDICT_TONE.muted` moved `bg-surface` → `bg-surface-container-high` in the same pass, and the move is not cosmetic.** The rule is that a muted verdict must not read as one more, wider tile — `muted` is the tone the neighbour route's only verdict uses, so that is its normal appearance rather than an edge case. It used to be `surface` because the tiles were `surface-container-high` inside a `surface-container` panel. With the panel gone and the tiles on `surface-container` sitting directly on the card's `surface`, a `surface` verdict would be **invisible**, and the lift is now `surface-container-high`. If the tiles' step ever moves again, this token moves with it.

## The section head stacks its description

`SECTION_HEAD` puts the description **under** the title (`SECTION_HEAD.TITLES` is the stacking pair), family-wide — both scanning routes' heroes and results cards, and all three of the frequency calculator's section heads. User decision, 2026-08-24.

The retired argument, which this file and `shapes.ts` both used to make: *"a section header is a signpost over content the reader can already see, and stacking it spends two lines of rhythm restating what the content demonstrates."* That premise stopped holding the moment the hero collapsed at idle. In the launch state there **is** no content below the header demonstrating anything — the description is the only thing on the page saying what a sweep costs, and on one row beside a bold title and an `ms-auto` action it read as a caption on the title rather than as the sentence a reader has to weigh before spending three minutes of the modem's AT lock. Stacked, it gets its own measure (`max-w-[56ch]`) and its own line.

Two mechanics worth keeping:

- **The root is `items-start`**, which is what keeps `META` on the *title's* row however many lines the description wraps to.
- **`META` carries `ms-auto` rather than the root carrying `justify-between`.** The row wraps, and with `justify-between` a wrap leaves the meta slot marooned against the right edge of its own line.

## The sweep's empty state no longer owns an action, and no longer renders before a run

**One act gets one affordance.** Since 2026-08-24 (user decision) the sweep's results card is not rendered at all while the posture is `idle`, and the `Empty` panel inside it carries no button.

The retired shape, kept here so nobody re-derives it: from 2026-08-14 the sweep's pre-run panel was the shared `Empty` primitive (`components/ui/empty.tsx`) with its own "Sweep all bands" / "Sweep again" button in an `EmptyContent` slot, wired to the same `startScan` the hero's button used. The argument was that before a run the results card *is* the whole page, so a reader looking at an empty table should not have to travel back up to the hero to start one. The neighbour route kept the quieter `ScanEmptyState` posture stack with no button, and the two panels were described as **deliberately different objects**.

Why it was overturned:

- **The pair read as awkward.** Two buttons on one screen, forty pixels apart in the vertical, both starting the same three-minute sweep.
- **Two triggers for one act is the thing this surface spent a whole pass removing.** It is the same duplication that retired the posture chip and the completed rail's third and fourth lines.
- **The trigger moving between rows is what made the layout lurch.** The empty panel's button existed only at idle, so pressing it swapped the card's dashed box for a taller skeleton at the same instant the hero grew — one click, two panels resizing, and only one of the moves meant anything. See [The hero is as tall as it has something to say](#the-hero-is-as-tall-as-it-has-something-to-say).

What holds now, on both routes:

| Route | Before the first run | After a run that listed nothing |
| ----- | -------------------- | ------------------------------- |
| **Full sweep** | the results card is **not mounted** (`scanner.tsx` returns `null` for `posture === "idle"`); it enters on the shared `staggerItem` card cascade the moment a sweep starts, and from then on it stays through complete, failed and a re-run | the `Empty` primitive on `EMPTY_PANEL` — a dashed `rounded-tile` slot with an `EmptyMedia` disc, title and description, **and no button**. The hero directly above is already showing a `0` and a "Sweep again" action in exactly this state |
| **Neighbour read** | the results card **stays mounted** with `ScanEmptyState`, i.e. the `POSTURE` stack, and no button | the same panel |

> ℹ️ **The two empty panels are still different objects, but the reason changed.** It is no longer "one owns an action and the other does not" — neither does. What differs now is *when they exist*: the sweep's panel is reachable only after a completed run that listed nothing, while the neighbour route's is also its pre-run state, because a two-second read does not earn the page rearranging itself around it. That divergence is the same cost asymmetry recorded in [the hero's morph](#the-hero-is-as-tall-as-it-has-something-to-say), not a second, independent decision.

Two things about the sweep's panel that are still load-bearing:

- **It cannot be reached while a run is in flight.** `scanning` renders `ScannerSkeleton` and `failed` renders `ScanErrorState`, so the branch is structurally a completed-and-empty state. That is also why it never needed a `disabled` button and now needs no button at all.
- **`EMPTY_PANEL` restates `POSTURE.ROOT`'s `min-h-[13rem]`**, so swapping between the skeleton, the error panel and the table does not jump the card. Move one and move the other; they are literals in both places because Tailwind's JIT scans source text and an interpolated `min-h-[${X}]` compiles to nothing.

The dashed stroke is this codebase's vocabulary for a slot with nothing in it yet (the same idiom as `custom-profiles/empty-profile.tsx`), not a compensation for a weak fill — No-Hairline-On-Fill does not apply.

> ⚠️ **Do not restore the panel's button in a later pass**, and do not restore the card at idle. Both were removed together and each one alone brings back half of the double-resize.

## The run summary, the verdict and the tally

Three additions of the same 2026-08-12 pass, all derived from rows the surface already has — no new endpoint, no new poll.

| Object | Where | Sweep | Neighbour |
| ------ | ----- | ----- | --------- |
| **Summary panel** | hero, right column, above the action row | one tile per provider: cell count, bands seen, best RSRP (capped at `MAX_PROVIDER_TILES` + one overflow tile) | one tile per relation that appeared, plus a measured-vs-channel-only tile |
| **Verdict strip** | under the tiles, only when true | shown only when every *measured* cell shares one tier; explains that a sweep measures without the serving cell's help and reads low indoors | explains the channel-only rows: named by the serving cell, unmeasured, so no quality and not lockable |
| **Tally** | under the table, beside the lock explainer | rows + per-tier counts, tiers with 0 omitted | rows, measured, channel-only — and since 2026-08-14 this is the route's **only** count: `ScanTableProps.countLabel` is now optional and the neighbour table omits it, because the pager's "N cells" restated the tally's row count twelve pixels lower. The sweep still passes one |
| **Context line** | under the result count | "across N providers on M bands" | "on N channels around the serving cell" |

Two rules hold this together:

- **All arithmetic lives in `summaries.ts`, and it contains no copy.** `Math.max()` of an empty list is `-Infinity`, a mean over zero rows is `NaN`, and both render as confident text beside real numbers. One pure, total function per route means "survives an empty array, a single row and all-sentinel data" is a property of one file rather than of a rendering path nobody re-reads. And a pure function that returns English is an i18n hole the checker cannot see — the frequency calculator on this same prefix shipped exactly that bug once.
- **A mixed spread gets NO verdict.** "The readings vary" is not an explanation, and a strip that is always present stops being read. The tone follows the tier being described (`destructive` when every reading is weak, `muted` when nothing was measured at all), and each verdict carries a distinct bar-count glyph — three of them can appear in one slot, and `success-container` / `warning-container` are 1.03:1 apart.

`run-summary.tsx`, like `run-hero.tsx`, is **copy-blind**: every string arrives as a prop and every number pre-derived, because the two routes disagree about all of them.

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

- [at-command-transport.md](at-command-transport.md) — `qcmd`, `atcli_smd11`, the AT mutex, the "sip, don't gulp" convention
- [tmp-file-ownership.md](tmp-file-ownership.md) — which direction `fs.protected_regular=1` actually blocks
- [tower-locking.md](tower-locking.md) — `tower/lock.sh`, the payload shapes this surface targets, the failover watcher a scan-initiated lock arms
- [connection-watchdog.md](connection-watchdog.md) — the `LOCKED` maintenance state the marker drives
- [radio-information.md](radio-information.md) — the `/cellular/` index that links here
