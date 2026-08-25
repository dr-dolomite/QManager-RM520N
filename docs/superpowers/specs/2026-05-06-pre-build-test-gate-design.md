# Pre-Build Test Gate — Design

**Status:** Approved (brainstorming) — pending implementation plan.
**Branch:** `feat/pre-build-test-gate`.

## Problem

`bun run package` builds the QManager tarball with no test step. Today the pipeline is:

```
bun run package
  └─ bun --bun next build         # frontend
  └─ bash build.sh                # stages backend + frontend, makes
                                  # qmanager-build/qmanager.tar.gz
```

Three workstation fixture harnesses exist already and are not run anywhere automatically:

- `scripts/test/health-check-redaction.sh`
- `scripts/test/poller-phase-a.sh` — 12 PASS, ~1s
- `scripts/test/poller-phase-bcd.sh` — 11 PASS, ~6s (3 jq-aware SKIPs)

A failing harness today only surfaces if someone runs it by hand. Backend regressions can land in a tarball untouched.

## Goal

A pre-build gate that:

1. Runs every harness in `scripts/test/*.sh` (auto-discovered).
2. Statically lints all daemon, library, and CGI shell scripts for syntax errors before they ship.
3. Surfaces — without blocking — any CRLF line endings introduced by Windows editors.
4. Aborts `bun run package` with a clear, scannable error if anything fails.

The gate runs *before* `next build` so backend regressions fail fast (~7s) rather than after the 30–60s frontend build.

## Hookup point

Modify `package.json` only:

```json
"package": "bash scripts/test/run-all.sh && bun --bun next build && bash build.sh"
```

`bun run build` (frontend dev iteration) is intentionally left ungated — it doesn't produce a tarball, and gating it would slow the dev loop without protecting any shipping artifact.

The existing `build.sh` service-unit lint stays where it is. That lint is a *staging-time* check (does the .service file exist for the tarball copy step) — different concern from source-quality testing, and bundling them would muddle responsibilities.

## Architecture

A single thin orchestrator script `scripts/test/run-all.sh` runs four checks in fixed order:

1. **`bash -n` syntax check** (~1s). Globs daemon scripts, library scripts, CGI scripts, and harness scripts. `bash -n` is a superset of POSIX `sh -n` and parses both correctly. Fail-on-first-section-end (lists all offenders before failing the gate).
2. **CRLF detector** (sub-second, warn-only). Greps tarball-bound scripts/units/sudoers for `\r`. Prints offending file list with a one-line nudge. Never fails the gate — installer already strips CRLF on-device per `CLAUDE.md`; the detector exists to flag a misconfigured editor early.
3. **All harnesses in `scripts/test/*.sh`** (auto-discovered glob, excluding `run-all.sh` itself). Each runs in a subshell. On failure, captured output is printed and the gate exits 1 immediately — no point running subsequent harnesses while a known regression is unfixed.
4. **Final summary line** — single line, easy to grep: `gate PASS` or `gate FAIL: <which check>`.

Auto-discovery means new harnesses (including `parse-at.sh` from this work) are picked up without runner edits.

## Components

### 1. `scripts/test/run-all.sh` (new, ~80 lines)

POSIX-`bash`, `set -eu`, `mktemp` work dir + EXIT trap. Mirrors the `ok()` / `bad()` / `section()` style of the existing harnesses, but at meta-level (sections become "syntax check", "CRLF check", per-harness banners). Repo-root anchored via `REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"`. No new tooling deps — uses `bash -n`, `grep -rlI`, and the existing harnesses.

**Behavior per section:**

- **Section 1 (`bash -n`):** Iterate over the union of these globs and run `bash -n <file>` on each, accumulating failures into a counter. Print `FAIL  <path>` plus the captured stderr line for each offender. If any failed, print summary and exit 1 at end of section.
  - `scripts/usr/bin/*` (daemon and helper executables — most are extension-less)
  - `scripts/usr/lib/qmanager/*.sh` (libraries)
  - `scripts/www/cgi-bin/quecmanager/**/*.sh` (CGI handlers)
  - `scripts/test/*.sh` (harnesses themselves)
- **Section 2 (CRLF, warn-only):** `grep -rlI $'\r' <paths>` with explicit `--include` filters for `*.sh`, `*.service`, and `sudoers.d/*`. Prints `WARN  CRLF line endings found in N files:` followed by the file list and a one-line `Set your editor to LF — installer normalizes on-device, but this is a misconfig signal.` nudge. Never sets the failure flag.
- **Section 3 (harnesses):** Glob `scripts/test/*.sh`, sort, exclude `run-all.sh`. For each: print `== <path> ==` banner, run `bash <path>` with stdout/stderr passed through to the operator, capture exit code. On non-zero, print `gate FAIL: <path>` and exit 1 immediately. Otherwise continue.
- **Section 4 (summary):** Print `gate PASS` if every prior section returned successfully.

### 2. `scripts/test/parse-at.sh` (new, ~150 lines)

Same shape as `poller-phase-bcd.sh`. Sources `scripts/usr/lib/qmanager/parse_at.sh` directly (it's a library, no `awk`-extraction needed). Builds fixture AT-command outputs, calls each parser, asserts on the resulting global vars.

**Coverage:**

- `parse_serving_cell` — three fixture inputs:
  - LTE-only `+QENG: "servingcell",...` line — assert `network_type="LTE"`, `lte_band`, `lte_pci`, `lte_rsrp/rsrq/sinr` populated.
  - 5G-NSA (LTE PCC + NR endc) — assert `network_type="5G-NSA"`, both LTE and NR fields populated.
  - 5G-SA — assert `network_type="5G-SA"`, NR fields populated, LTE fields empty.
- `parse_qrsrp` / `parse_qrsrq` / `parse_qsinr` — multi-antenna fixtures (4-antenna form). Assert the per-antenna globals (`*_rsrp_a0`, `*_rsrp_a1`, etc.) are populated.
- `parse_temperature` — multi-zone fixture. Assert `t2_temperature_*` fields populated as expected.

jq-dependent assertions guarded with the same `command -v jq 2>/dev/null || true` SKIP pattern from existing harnesses, so the harness runs cleanly on the Windows dev box without jq.

The harness's own `bad()` messages always include the actual mismatched value (e.g., `bad "parse_serving_cell band mismatch: '$got'"`) so failures are diffable at a glance — mirrors `poller-phase-bcd.sh`'s convention.

### 3. `package.json` — single-line change

```diff
-    "package": "bun --bun next build && bash build.sh"
+    "package": "bash scripts/test/run-all.sh && bun --bun next build && bash build.sh"
```

### 4. Executable bit on new scripts

Both new files (`run-all.sh`, `parse-at.sh`) need `git update-index --add --chmod=+x` at commit time, per the existing convention for harness files on Windows.

## Failure UX

The existing harnesses already print clean per-test failures (`FAIL  <message>`). The runner's job is to surface those without burying.

**Happy path:**
```
== bash -n syntax check ==
  PASS  87 scripts parsed cleanly

== CRLF check (warn-only) ==
  PASS  no CRLF detected

== scripts/test/health-check-redaction.sh ==
  ...
  3 passed, 0 failed, ALL PASS

== scripts/test/parse-at.sh ==
  ...
  9 passed, 0 failed, ALL PASS

== scripts/test/poller-phase-a.sh ==
  ...
  12 passed, 0 failed, ALL PASS

== scripts/test/poller-phase-bcd.sh ==
  ...
  11 passed, 0 failed, ALL PASS

gate PASS
```

**Syntax failure (lists every offender, then fails):**
```
== bash -n syntax check ==
  FAIL  scripts/usr/bin/qmanager_poller
    line 1334: syntax error near unexpected token `fi'
  FAIL  1 of 87 scripts have syntax errors

gate FAIL: bash -n syntax check
```

**CRLF (warn-only, gate continues):**
```
== CRLF check (warn-only) ==
  WARN  CRLF line endings found in 2 files:
    scripts/usr/bin/qmanager_new_thing
    scripts/etc/systemd/system/qmanager-new.service
  WARN  Set your editor to LF — installer normalizes on-device, but this is a misconfig signal.
```

**Harness failure (fails on first failing harness, prints its full output):**
```
== scripts/test/poller-phase-bcd.sh ==
  [full harness output captured, including the failing assertion text]
  ...
  FAIL  read_sim_state output mismatch: 'true|...'
  10 passed, 1 failed, FAILURES

gate FAIL: scripts/test/poller-phase-bcd.sh
```

## Scope

### In scope (this work)

- New `scripts/test/run-all.sh` orchestrator (POSIX-bash, ~80 lines).
- New `scripts/test/parse-at.sh` harness covering `parse_serving_cell` (LTE / 5G-NSA / 5G-SA), `parse_qrsrp`, `parse_qrsrq`, `parse_qsinr`, `parse_temperature`.
- Single-line `package.json` change to gate `bun run package`.
- `RELEASE_NOTES.md` entry — bullet under v0.1.7 *Improvements* if v0.1.7 is unreleased, or a new v0.1.8 *Improvements* section if v0.1.7 has shipped (resolved at plan time by reading the file).

### Out of scope (deferred)

- Deeper coverage of `email_alerts.sh` / `sms_alerts.sh` registration-guard branches — phase-a already covers async dispatch; deeper coverage needs poller globals to be meaningful. Defer until concrete bug.
- Harnesses for `profile_mgr.sh` / `tower_lock_mgr.sh` / `ttl_state.sh` — valuable but scope creep without a known bug. Defer.
- Auto-fixing CRLF — warn-only is sufficient because the installer already strips `\r` on-device.
- Moving `build.sh`'s service-unit lint into the gate — that's a staging-time check, not source-quality. Leaves where it is.
- CI hook — no CI on this project today; gate is operator-side via `bun run package`.
- TypeScript validation gate — `next build` already type-checks; redundant.
- Pre-commit hook — out of scope, separate concern.

## Open at plan time

These resolve while writing the plan, not now:

- Exact glob set for `bash -n` recursion (some scripts under `scripts/usr/bin/` are extension-less; need to confirm none are non-shell binaries that would error under `bash -n`).
- Whether v0.1.7 is shipped yet — determines whether release-notes goes under v0.1.7 *Improvements* or new v0.1.8.

## Done criteria

- `bash scripts/test/run-all.sh` exits 0 on a clean tree.
- `bash scripts/test/run-all.sh` exits non-zero with clear output if any of the four checks fail.
- New `parse-at.sh` harness passes on workstation (with full coverage when jq is present, clean SKIPs when jq is absent).
- `bun run package` runs the gate before `next build` and `build.sh`.
- All four existing harnesses (incl. new `parse-at.sh`) auto-discovered without runner edits.
- RELEASE_NOTES.md entry committed.
