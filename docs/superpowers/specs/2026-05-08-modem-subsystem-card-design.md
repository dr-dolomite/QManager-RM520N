# SPEC: Modem Subsystem Card (System Settings)

**Status:** Locked, 2026-05-08. Lightweight spec — falsifiable requirements, in-scope/out-of-scope explicit, acceptance criteria as pass/fail.

**Background:** First feature in the sysfs-fetch-source initiative. Surfaces modem firmware health from `/sys/devices/platform/4080000.qcom,mss/subsys0/` directly to the UI, replacing nothing today (this data was previously invisible). See `docs/rm520n-sysfs-fetch-sources.md` for the full sysfs investigation.

**Goal:** Add a "Modem Subsystem" card to the System Settings page that exposes live modem firmware state, crash history, and coredump presence. Includes a poller-side crash watcher that persists timestamped crash events across reboots.

## In Scope

1. New CGI endpoint `scripts/www/cgi-bin/quecmanager/system/modem-subsys.sh` returning JSON with sysfs-derived fields plus crash-log summary.
2. New React hook `hooks/use-modem-subsys.ts` consuming the endpoint.
3. New card component `components/system-settings/modem-subsystem-card.tsx`.
4. Integration into `components/system-settings/system-settings.tsx` grid (4th card).
5. Poller-side crash watcher block added to `scripts/usr/bin/qmanager_poller` that:
   - Reads `crash_count` once per Tier 1 cycle (2s)
   - On increment, appends an NDJSON entry to `/etc/qmanager/modem_crashes.json`
   - Caps the log at 100 most-recent entries via atomic `.tmp`+`mv` rewrite
   - Maintains a sidecar last-known-count file at `/etc/qmanager/.modem_crash_count_last` to survive poller restarts without false-positive log entries
6. Type definitions in `types/modem-subsys.ts`.
7. Installer changes:
   - Ensure `/etc/qmanager/` is created with `www-data:www-data` ownership at install time (existing pattern, verify only)
   - Initialize `/etc/qmanager/modem_crashes.json` as empty (`[]`) on fresh installs only — preserve existing log on upgrades

## Out of Scope (explicit, with reasoning)

- **Email/SMS alert pipeline integration on crash events.** Defer to a follow-on phase. Reason: the crash event shape needs to prove out in the wild before we wire it through `email_alerts.sh` / `sms_alerts.sh`; alerting also drags in template + recipient gating not relevant to the card itself.
- **Dedicated crash history page or drilldown.** v1 card surfaces total count + last-crash relative timestamp only. The full NDJSON log is written but not rendered. Reason: keep card scope tight; drilldown is a future feature once log volume justifies it.
- **Modem coredump retrieval/download.** Card only indicates "coredump present" via the existence of files in `ramdump_modem/`. Reason: download/parsing of coredumps is a separate engineering effort.
- **Migration of `AT+QTEMP` or `AT+QGDCNT` to sysfs.** Those are separate phases under the same sysfs initiative. Reason: each migration carries its own risk and verification surface.
- **QMI integration.** See `docs/rm520n-sysfs-fetch-sources.md` § "QMI Re-investigation". Out of scope for this card.
- **Manual SSR triggering or modem-reset controls.** Read-only telemetry only.
- **Surfacing `quec_state`, `restart_level`, or `system_debug` fields.** Investigation showed `quec_state` is unreliable (reads `Terminated` while `state=ONLINE`); the other two are static config noise.

## Requirements

### R1 — CGI endpoint contract

- **Current state:** No endpoint exists. Sysfs files are world-readable but not exposed via HTTP.
- **Target state:** `GET /cgi-bin/quecmanager/system/modem-subsys.sh` returns HTTP 200 with `Content-Type: application/json` and the body shape below.
- **Acceptance:**
  - [ ] Endpoint returns JSON parseable by `JSON.parse` on the frontend.
  - [ ] Response time under 100ms at p95 on the live device (sysfs reads only — no AT-lock acquisition).
  - [ ] When `state` file reads `ONLINE`, response `state` field is the string `"online"` (lowercased).
  - [ ] When the `crash_count` file is missing or unreadable, response `crash_count` is `null` (not `0`, not omitted).
  - [ ] When `/etc/qmanager/modem_crashes.json` is missing or empty, `last_crash_at` is `null` and `total_logged_crashes` is `0`.
  - [ ] When `ramdump_modem/` contains regular files, `coredump_present` is `true`; when the directory is empty or missing, `false`.
  - [ ] Endpoint uses `cgi_base.sh` for headers + auth (existing CGI pattern).

**Response shape:**
```json
{
  "state": "online",
  "state_raw": "ONLINE",
  "crash_count": 0,
  "firmware_name": "modem",
  "coredump_present": false,
  "last_crash_at": null,
  "total_logged_crashes": 0,
  "uptime_seconds": 3704
}
```

`state` enum (lowercased for frontend convenience): `"online" | "offline" | "crashed" | "unknown"`. `unknown` covers the case where the sysfs file is unreadable or contains an unrecognized string. `state_raw` preserves the original sysfs value for diagnostic display.

### R2 — Crash log NDJSON shape

- **Current state:** No crash history is logged anywhere.
- **Target state:** `/etc/qmanager/modem_crashes.json` is a JSON array (NOT NDJSON despite the file extension — match the pattern of `qmanager_sms_log.json` which uses array form for atomic capping). Each entry has the shape below.
- **Acceptance:**
  - [ ] On first crash detection after install, file goes from `[]` to `[<entry>]`.
  - [ ] On subsequent crashes, new entries are appended; oldest entries are dropped when length exceeds 100.
  - [ ] File is rewritten atomically via `<file>.tmp` + `mv` — no partial writes visible to readers.
  - [ ] File survives reboots (lives on persistent partition `/etc/qmanager/`).

**Entry shape:**
```json
{
  "ts": 1715184000,
  "previous_count": 0,
  "new_count": 1,
  "modem_state_at_event": "crashed",
  "uptime_at_event_seconds": 3704
}
```

`ts` is Unix epoch seconds, matching the convention in `qmanager_events.json`.

### R3 — Poller crash watcher

- **Current state:** `scripts/usr/bin/qmanager_poller` does not read `crash_count`.
- **Target state:** Poller reads `crash_count` and `state` from sysfs once per Tier 1 cycle, compares `crash_count` to a last-known value held in `/etc/qmanager/.modem_crash_count_last`, and on increment appends an entry to the crash log.
- **Acceptance:**
  - [ ] Watcher block sources or inlines no AT-command calls — pure file reads.
  - [ ] On poller startup, if the sidecar file is missing, the current `crash_count` is recorded WITHOUT writing a crash log entry (treat as baseline, not as a new crash).
  - [ ] If the sysfs `crash_count` file is unreadable, watcher logs a warning via `qlog.sh` and skips the cycle without crashing the poller.
  - [ ] Watcher adds < 5ms per Tier 1 cycle on average (sysfs reads are µs; budget is generous).
  - [ ] Sidecar file `/etc/qmanager/.modem_crash_count_last` is written atomically (`.tmp` + `mv`).

### R4 — Card UI

- **Current state:** No card exists.
- **Target state:** A new card slots into the System Settings grid as the 4th card, following the existing `Card / CardHeader / CardTitle / CardDescription / CardContent` pattern from `system-settings-card.tsx`.
- **Acceptance — content:**
  - [ ] CardTitle reads "Modem Subsystem".
  - [ ] CardDescription is a single sentence, plain text, no icon (per CLAUDE.md UI Component Conventions).
  - [ ] State badge renders using the **outline + bg-{color}/15** pattern from `health-status-badge.tsx`. State→badge mapping:
    - `online` → success palette (`bg-success/15 text-success border-success/30`), `CheckCircle2Icon` size-3, label "Online"
    - `offline` → muted palette (`bg-muted/50 text-muted-foreground border-muted-foreground/30`), `MinusCircleIcon` size-3, label "Offline"
    - `crashed` → destructive palette (`bg-destructive/15 text-destructive border-destructive/30`), `XCircleIcon` size-3, label "Crashed"
    - `unknown` → muted palette, `MinusCircleIcon`, label "Unknown"
  - [ ] Total `crash_count` is rendered as a numeric stat with a small label ("Crashes since boot").
  - [ ] When `last_crash_at` is non-null, render a relative time string ("3 days ago") using the project's existing date utility (whichever the codebase already uses — verify in implementation; do not introduce a new dependency).
  - [ ] When `last_crash_at` is null, render the literal text "Never" (not "—", not blank).
  - [ ] `firmware_name` is rendered in monospaced text (`font-mono`) below the main stats.
  - [ ] When `coredump_present` is `true`, render a warning row using the warning palette (`bg-warning/15 text-warning border-warning/30`) with `TriangleAlertIcon` size-3 and label "Coredump available". When `false`, the row is omitted entirely (no "no coredump" placeholder).
- **Acceptance — states:**
  - [ ] Loading state uses `Skeleton` placeholders matching the final layout (no spinners, no blank screen).
  - [ ] Error state renders an `Alert` with a retry affordance — never a blank card.
  - [ ] All animations follow existing `motion/react` patterns in `system-settings-card.tsx` if any; do not introduce new motion timings.
- **Acceptance — antipatterns explicitly forbidden (per CLAUDE.md):**
  - [ ] No solid badge variants (`variant="success"`, `variant="destructive"` with no className override). Outline only.
  - [ ] No icons inside `CardHeader` / `CardTitle` / `CardDescription`.
  - [ ] No fill bars or progress bars for the crash count or any other field.
  - [ ] No raw shell-output text or terminal aesthetic.
  - [ ] No emoji in component code unless explicitly requested.

### R5 — Hook contract

- **Current state:** No hook exists.
- **Target state:** `hooks/use-modem-subsys.ts` exports a hook that returns `{ data, isLoading, error, refetch }` matching the shape of other hooks in `hooks/` (e.g. `use-modem-status.ts`).
- **Acceptance:**
  - [ ] Hook auto-refreshes on a fixed interval (recommended: 5s — System Settings doesn't need 2s cadence).
  - [ ] Hook uses the same fetch / data-loading library as other System Settings hooks (do not introduce a new one).
  - [ ] Hook surfaces network errors as `error` without crashing the page.

### R6 — Type definitions

- **Current state:** No types exist for this data.
- **Target state:** `types/modem-subsys.ts` exports `ModemSubsysState` (string literal union), `ModemSubsysData` (response shape), and `ModemCrashLogEntry` (NDJSON entry shape).
- **Acceptance:**
  - [ ] All three types compile under the project's `tsconfig.json` strict mode.
  - [ ] Types are imported (not duplicated) by the hook and component.

### R7 — Installer

- **Current state:** Installer creates `/etc/qmanager/` and seeds some files there (sms_alerts, email_alerts).
- **Target state:** Installer ensures `/etc/qmanager/modem_crashes.json` exists as an empty JSON array `[]` on fresh installs. On upgrades, the existing file is preserved untouched.
- **Acceptance:**
  - [ ] Fresh install creates the file with mode 644, owner `www-data:www-data` (matching sms_alerts pattern).
  - [ ] Upgrade install does not overwrite an existing non-empty file.
  - [ ] Sidecar `/etc/qmanager/.modem_crash_count_last` is NOT pre-seeded by installer (poller creates it on first run).

## Constraints

- **Performance budget:** CGI endpoint p95 < 100ms; poller watcher < 5ms per cycle.
- **Memory budget:** No additional persistent process. Logic lives entirely in existing poller and CGI.
- **Storage budget:** Crash log capped at 100 entries — at ~120 bytes per entry, max ~12 KB. Sidecar < 16 bytes.
- **Compatibility:** Sysfs paths under `/sys/devices/platform/4080000.qcom,mss/subsys0/` confirmed present on RM520N-GL kernel 5.4.210. RM551E (OpenWRT) variant of QManager would NOT have these paths — endpoint must degrade gracefully (return `state: "unknown"` and `crash_count: null`) so the same frontend code can run on both platforms without conditionals.
- **Permissions:** All sysfs files in `subsys0/` are world-readable (mode 444). `www-data` does not need group `dialout` or any sudoers rule for this feature.
- **Line endings:** All shell scripts must be LF-only (existing project convention; installer strips `\r` but should not have to).

## Acceptance Criteria (top-level pass/fail)

Once all of these can be checked, v1 is complete:

- [ ] Visiting `/system-settings` on a live RM520N-GL displays the new "Modem Subsystem" card.
- [ ] Card shows `state`, `crash_count`, `firmware_name`, and (when applicable) coredump warning row, with no console errors.
- [ ] `curl http://192.168.225.1/cgi-bin/quecmanager/system/modem-subsys.sh` returns valid JSON matching R1's response shape.
- [ ] After a forced modem SSR (verified by user), `crash_count` increments in the sysfs file AND a new entry appears in `/etc/qmanager/modem_crashes.json` AND the card updates within 5s of the next refetch AND `last_crash_at` renders as "Just now" (or equivalent recent relative time).
- [ ] After a device reboot, the crash log entries persist and `last_crash_at` continues to render correctly.
- [ ] Lighthouse / type-check pass: `bunx tsc --noEmit` reports zero errors.
- [ ] No new ESLint warnings introduced.
- [ ] All antipatterns from R4 are absent (verified by code review against the antipatterns checklist).
- [ ] Card renders correctly in both light and dark mode.
- [ ] Loading state shows Skeletons matching final layout (no flash of "0 crashes").

## Ambiguity Report

| Dimension | Score | Min | Status |
|---|---|---|---|
| Goal Clarity | 0.95 | 0.75 | ✓ |
| Boundary Clarity | 0.90 | 0.70 | ✓ |
| Constraint Clarity | 0.85 | 0.65 | ✓ |
| Acceptance Criteria | 0.80 | 0.70 | ✓ |
| **Ambiguity** | **0.11** | **≤ 0.20** | **✓ Gate passed** |

## Locked decisions (do not relitigate during implementation)

1. **Persistent crash log over raw counter display.** Rationale: `crash_count` resets to 0 on reboot; without persistent timestamping, "0 crashes" is ambiguous between "stable for 30 days" and "just rebooted." The persistent log makes "last crashed" meaningful.
2. **Log file in `/etc/qmanager/`, not `/tmp/`.** Must survive reboots.
3. **NDJSON capped at 100 entries, atomic rewrite.** Mirrors `qmanager_sms_log.json` pattern.
4. **No alert hookup in v1.** Email/SMS alert integration is a follow-on once the event shape proves stable.
5. **No drilldown page in v1.** Card shows count + last-crash only.
6. **`quec_state` is excluded from the response.** Investigation showed it's unreliable.
7. **Outline-pattern badges only.** No solid variant badges anywhere on this card.

## Next steps

Once spec is reviewed and committed:
1. `/gsd-discuss-phase` is unavailable (no .planning/ structure) — discuss-phase concerns are minimal here since architecture is well-established (existing card pattern + existing log pattern). Skip directly to planning.
2. Implementation order: types → CGI script → hook → card component → poller watcher → installer → grid integration → manual verify on live device.
3. The first thing to land could be the CGI script + a manual `curl` smoke test against the live device, since that proves the data path end-to-end before any frontend code is written.
