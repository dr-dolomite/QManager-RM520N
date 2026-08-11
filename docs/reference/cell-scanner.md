# Cell Scanner (`/cellular/cell-scanner/**`)

**Three routes share one prefix and one visual vocabulary, and exactly two of them talk to the modem — at costs that differ by roughly 100x.** A full sweep (`AT+QSCAN=3,1`) holds the single global AT mutex for 30–180 seconds and pauses every other modem operation on the device, including the poller that feeds the dashboard you are reading the page on. A neighbour read (`AT+QENG="neighbourcell"`) holds the same mutex for about two seconds. The frequency calculator holds nothing — it is browser arithmetic. That asymmetry is the organising idea of the whole surface, and most of what follows exists to keep it visible.

This doc records the invariants and sharp edges a contributor needs **before** touching the family: why the two scanning routes are deliberately not merged, the `/tmp/qmanager_long_running` maintenance contract that until 2026-08-11 was described in two docs but implemented nowhere, why this surface keeps signal thresholds that disagree with the rest of the product, why `0` is a sentinel rather than a reading, and why the two result types were not widened into one.

The rationale for the individual design moves lives in the commits (`a2394ee`, `e4e5441`, `5871e8c`, `16d129c`) and in the long file header of `components/cellular/cell-scanner/shapes.ts`. This doc does not restate them.

## Quick Reference

| Thing | Where |
| ----- | ----- |
| Full sweep route | `/cellular/cell-scanner` (`app/cellular/cell-scanner/page.tsx`) |
| Neighbour read route | `/cellular/cell-scanner/neighbourcell-scanner` |
| Frequency calculator route | `/cellular/cell-scanner/frequency-calculator` |
| Geometry + tone contract (all three routes) | `components/cellular/cell-scanner/shapes.ts` |
| Result + transport types | `types/cell-scanner.ts` |
| Full-sweep coordinator | `components/cellular/cell-scanner/scanner.tsx` |
| Neighbour coordinator | `components/cellular/cell-scanner/neighbourcell/neighbour-scanner.tsx` |
| Shared run hero | `components/cellular/cell-scanner/run-hero.tsx` |
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
| i18n | `cell_scanner.*` in `public/locales/{en,zh-CN,zh-TW,it,id}/cellular.json` (**174 keys per locale**, covering all three routes — `cell_scanner.neighbour.*` and `cell_scanner.calculator.*` are subtrees. The whole family had **zero** i18n before 2026-08-12) |

### Runtime files

| Path | Owner | Written by | Meaning |
| ---- | ----- | ---------- | ------- |
| `/tmp/qmanager_cell_scan.pid` | www-data | `qmanager_cell_scanner` | Sweep in flight (singleton gate) |
| `/tmp/qmanager_cell_scan_result.json` | www-data | `qmanager_cell_scanner` | Final JSON array of cells |
| `/tmp/qmanager_cell_scan_error` | www-data | `qmanager_cell_scanner` | Error text; consumed **destructively** by `cell_scan_status.sh:42` |
| `/tmp/qmanager_neighbour_scan.pid` | www-data | `qmanager_neighbour_scanner` | Neighbour read in flight |
| `/tmp/qmanager_neighbour_scan_result.json` | www-data | `qmanager_neighbour_scanner` | Final JSON array |
| `/tmp/qmanager_neighbour_scan_error` | www-data | `qmanager_neighbour_scanner` | Error text, destructively consumed |
| `/tmp/qmanager_long_running` | www-data | `qmanager_cell_scanner` **only** | Maintenance marker — see below |
| `/tmp/qmanager_at.lock` | mode 0666 | `qcmd` | The single global AT mutex |

### AT commands this surface issues

| Operation | Command | Sent by |
| --------- | ------- | ------- |
| Full sweep, LTE + NR5G, extended fields | `AT+QSCAN=3,1` | `qmanager_cell_scanner:60` |
| LTE neighbours | `AT+QENG="neighbourcell"` | `qmanager_neighbour_scanner:57` |
| Enable NR5G measurement reporting | `AT+QNWCFG="nr5g_meas_info",1` | `qmanager_neighbour_scanner:115` |
| Read NR5G measurements | `AT+QNWCFG="nr5g_meas_info"` | `qmanager_neighbour_scanner:119` |

The frequency calculator issues **nothing**. It has no fetch and no AT contact, which is why it has no run hero, no posture chip and no cost statement — see [The calculator is not a scanner](#the-calculator-is-not-a-scanner).

## The cost asymmetry, and why the routes are not merged

`qcmd` serialises every AT command in the product on `flock` over `/tmp/qmanager_at.lock` (`scripts/usr/bin/qcmd:39`). "flock" is an advisory file lock — a do-not-disturb sign on the file that only one process may hold at a time — so while a sweep holds it, nothing else on the device can reach the modem.

`qcmd` classifies commands into two wait budgets (`qcmd:104-109`, `qcmd:41-42`):

| Class | Match | Lock wait |
| ----- | ----- | --------- |
| Long | `*QSCAN*`, `*QSCANFREQ*`, `*QFOTADL*` | `LOCK_WAIT_LONG=10` s |
| Everything else | — | `LOCK_WAIT_SHORT=5` s |

`AT+QENG` is **not** long. So firing a neighbour read while a sweep is in flight gives the neighbour worker five seconds against a lock that will be held for up to three minutes; `flock_wait` gives up, `qcmd` exits 2, and `output_result "" "modem_busy"` (`qcmd:165-169`) is what the worker sees. The neighbour worker treats a non-zero `qcmd` exit as "skip this half" (`qmanager_neighbour_scanner:62`, `:122`), so the run finishes fast and reports zero cells — a *plausible empty result* rather than an error.

> ⚠️ **Known sharp edge, unfixed by design-of-omission.** The two start endpoints enforce singletons against **separate** pid files and **neither checks the other**: `cell_scan_start.sh:34` tests only `/tmp/qmanager_cell_scan.pid`, and `neighbour_scan_start.sh:33` tests only `/tmp/qmanager_neighbour_scan.pid`. Nothing prevents a neighbour read from being started during a sweep, and its failure mode is a silently empty table rather than a stated "the modem is busy". If you add a cross-check, add it in both start endpoints (a neighbour read is short enough that a sweep started during one is also worth refusing), and give the UI the `modem_busy` error code rather than an empty result.

**This is why the two routes are deliberately NOT merged.** They read as one feature and share seven modules, but merging them into one route with a mode toggle would put a three-minute modem freeze one click away from a two-second read. `COST` (`shapes.ts:164`) is therefore a *required* slot in the run hero, not an optional flourish: same shape on both routes, different content. Before the 2026-08 rebuild both routes shipped a button reading the identical string "Start New Scan"; the sweep's action now reads "Sweep all bands" and states its cost in plain language.

Corollaries that follow from the same asymmetry, and should not be "harmonised" away:

- The sweep hook polls every **2 s** and runs an elapsed clock; the neighbour hook polls every **1 s** and has none (`use-cell-scanner.ts:15`, `use-neighbour-scanner.ts:41`). A timer on a two-second operation has finished before the eye reaches it.
- The sweep route has a `beforeunload` guard (`use-cell-scanner.ts:236-245`); the neighbour route deliberately does not. Losing a two-second read costs nothing, so prompting over it would invent a stake the operation does not have.

## The `/tmp/qmanager_long_running` contract

**Short version: the marker tells the two root daemons "a long AT command is in flight — stand down", and until 2026-08-11 it had three readers, two deleters and zero writers.** `docs/ARCHITECTURE.md` and `docs/BACKEND.md` both described the guard; nothing in the tree created the file. During a real sweep the poller kept issuing serving-cell and `QCAINFO` reads that each waited five seconds on the lock and returned `modem_busy`, and the watchdog — the thing that reboots the modem when it believes the connection died — never saw maintenance mode at all.

The contract now:

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

Seven modules are shared by the two scanning routes: `lock-cell-dialog.tsx`, `run-hero.tsx`, `scan-states.tsx`, `scan-table.tsx`, `scanner-skeleton.tsx`, `signal-badges.tsx` and `shapes.ts`.

`lock-cell-dialog.tsx` is the one worth calling out: **it owns the write, not just the confirmation.** A component that only asked the question and handed back a callback would have left both routes holding their own identical `fetch`, payload builder and toast set — which is the duplication that actually cost something. The caller owns exactly one thing: which cell is targeted, cleared when the dialog closes. `kind: "nr_sa" | "lte"` is a discriminator on the *target* rather than a flag on the request, because `AT+QNWLOCK` takes two different shapes and the modem rejects the wrong one outright.

**The CSV builders are NOT shared, and should not be.** Each route keeps its own `buildCsvRows` and header constant (`scanner.tsx:41`/`:59`, `neighbour-scanner.tsx:45`/`:60`) because the two row shapes have different columns; both go through the shared `lib/download-csv.ts` for the actual download. Sharing the *builder* would require the widened type this doc argues against.

## The calculator is not a scanner

`/cellular/cell-scanner/frequency-calculator` shares the route prefix and the canon — `CellularPageHeader`, `SECTION_HEAD`, role radii, the `nr`/`lte` identity variants, the machine-voice split — but **not the run vocabulary**. It gets no run hero, no posture chip and no `COST` statement, because it makes no request and holds no lock. It has no cost to state. Both of its files say so in their headers so a later canon pass does not restore the family's run vocabulary onto a page that does arithmetic in the browser.

One i18n trap it fixed is worth generalising: `calculateFrequency` is a module-level pure function outside `t()`, and it used to return English sentences **as data** (`{ error: "Please enter a valid number" }`) that travelled through React state into the DOM with no key ever involved. `bun run i18n:check` only sees keys, so this was invisible to the gate. It now returns a `CalcErrorCode` mapped to a literal key at the call site, with runtime values interpolated rather than concatenated so a locale can place them where its grammar wants.

> ℹ️ Any pure function that returns user-visible English is an i18n hole the checker cannot see. Return a code.

## Machine voice on this surface

`TABLE.IDENT` (`shapes.ts:186`) is `font-mono` and carries band, EARFCN, PCI, Cell ID and TAC — identifiers that hold steady until something reconfigures them. `TABLE.FIGURE` (`:188`) is interface-font `tabular-nums` and carries RSRP, RSRQ, SINR and RSSI — readings. `POSTURE.CLOCK` (`:156`) and `TOOLBAR.COUNT` (`:204`) are changing figures and therefore also interface-font `tabular-nums`, never mono. This is DESIGN.md's Machine-Voice Rule applied per value; see DESIGN.md > Named Rules.

The result count must be assembled by the i18n layer's plural machinery, never by a JS ternary. The incumbent hardcoded `filtered === 1 ? "cell" : "cells"` in *both* copies, which is wrong in four of the five shipped locales before a translator ever sees it.

## Known gaps

- **The two start endpoints do not check each other's pid file.** Documented above; a neighbour read started during a sweep returns an empty table rather than `modem_busy`.
- **`AT+QSCAN` has no cancel.** Once the sweep is in flight the only way to end it early is to kill the worker; the UI has no stop control, and adding one means killing the pid and relying on the `TERM` trap (`qmanager_cell_scanner:44`) to clear the marker.
- **NR5G bandwidth is passed through raw.** `qmanager_cell_scanner:170-175` keeps the NR carrier bandwidth as the modem's resource-block count, because the MHz conversion depends on SCS. LTE *is* converted (`:158-169`). The two columns therefore print different units under one header.
- **The error files are consumed destructively.** `cell_scan_status.sh:42` and its neighbour twin `rm` the error file as they read it, so exactly one poll ever sees a failure. Two clients polling the same run means one of them silently misses the error — the same class of bug the speedtest surface solved with a `flock`ed harvest (see [speedtest.md](speedtest.md)).

## Related

- [at-command-transport.md](at-command-transport.md) — `qcmd`, `atcli_smd11`, the AT mutex, the "sip, don't gulp" convention
- [tmp-file-ownership.md](tmp-file-ownership.md) — which direction `fs.protected_regular=1` actually blocks
- [tower-locking.md](tower-locking.md) — `tower/lock.sh`, the payload shapes this surface targets, the failover watcher a scan-initiated lock arms
- [connection-watchdog.md](connection-watchdog.md) — the `LOCKED` maintenance state the marker drives
- [radio-information.md](radio-information.md) — the `/cellular/` index that links here
