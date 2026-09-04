# Orchestra Ledger — Network Events (/monitoring) design furnishing

Baseline commit: 391e6d8 (development, clean)
Mode: Full (Agent tool + real shell). Codex: not probed, not routed.
Run goal: Recon + design direction for re-furnishing /monitoring (Network Events)
to DESIGN.md canon incl. motion. Deliverable this phase = before/after Artifact
for user approval. NO source edits this phase.

| ID | Task | Seat | Status |
|----|------|------|--------|
| S1 | Scout: current Network Events implementation inventory | FAST | PENDING |
| S2 | Scout: DESIGN.md binding rules for a feed/list surface | FAST | PENDING |
| S3 | Scout: reference implementations (dashboard/cellular/motion/primitives) | FAST | PENDING |
| S4 | Scout: events data contract + recent-activities doc | FAST | PENDING |

## Attempts
- (append-only)

## Attempts (append-only)
- S1 scout current-impl : DONE (full inventory, 13 sections)
- S2 scout DESIGN.md    : DONE (rule sheet incl. Age-Gated Tone Rule)
- S3 scout references   : DONE (motion.ts, shapes.ts template, recent-activities widget)
- S4 scout data contract: DONE (22 event types, tone model, caps 300/50/20/5)

Conductor verdict: RE-AUTHOR, not polish. Key lever = adopt lib/event-presentation.ts
(the dashboard's canonical tone x weight model) on the monitoring surface.
Next: fixture route for BEFORE screenshot, then before/after Artifact for approval.
- Conductor: built before/after Artifact (design judgment, not delegated).
  Published: https://claude.ai/code/artifact/f8aaa3dd-3a30-4888-aeed-42a55ffa6b38
  Fixture route app/qm-preview + public/__refit_preview.html created and REMOVED.
  Repo clean at 391e6d8 apart from this ledger. NO source edits. Awaiting approval.

## Run 2 — IMPLEMENTATION (approved 2026-09-04)
Baseline: 391e6d8, branch feat/network-events-refit (created from development, clean)
Approved scope: full re-author per artifact f8aaa3dd + two later amendments
  (a) slim gapped rows, no hairline rules
  (b) short producer messages, NO em dashes anywhere in product copy

| ID | Task | Write set | Seat | Status |
|----|------|-----------|------|--------|
| T1 | Frontend re-author | components/monitoring/**, lib/event-presentation.ts, hooks/use-recent-activities.ts, constants/network-events.ts | opus | PENDING |
| T2 | Backend message strings (no em dash, no dup figures) | scripts/usr/lib/qmanager/events.sh + 3 sibling producers | opus | PENDING |
| T3 | i18n keys x5 locales | public/locales/** | opus | PENDING (after T1) |
| V1 | Blind verify | (read-only) | - | PENDING |

Write sets T1/T2 are disjoint -> parallel. Workers MUST NOT commit (shared index).
- Device reachability checked: RM520N-GL UP, RG501Q-EU UP (both pingable).
  Plan: after T2 lands, scp events.sh to a scratch dir on BOTH devices and run
  append_event against a scratch output file (NOT /tmp/qmanager_events.json,
  which is live state the poller and UI read) -> non-disruptive, no ask needed.
- T2 attempt 1: DONE_WITH_CONCERNS. Diff graded by conductor. Shortening correct,
  BUT worker stripped the trailing identifier parentheticals that the frontend's
  splitEventMessage()/TRAILING_IDS lifts into mono chips -> real information loss
  (PCI handed off to, band came from, NR anchor band unrecoverable).
  Root cause: conductor did not state the producer<->UI string contract in either
  ticket. Parallel-dispatch seam, my error.
- T2 attempt 2: dispatched to same agent (has context) to restore 8 tails under
  the explicit TRAILING_IDS contract, with regex PASS/FAIL required per site.
- Follow-up logged (NOT this change): APN_APPLY_DETAIL strings still carry em
  dashes and are user-facing on the APN page.
- T2 attempt 2: DONE. Conductor independently re-ran all 8 restored tails against
  TRAILING_IDS read from source (node): 8/8 lift, 4/4 retained parentheticals
  correctly stay in sentence. VERIFIED.
- T2 HARDWARE VERIFICATION (both devices, serials proven):
    RM520N-GL 61368cd2  BusyBox 1.31.1  -> all 6 _ev_ids cases correct
    RG501Q-EU b7e3d6f1  BusyBox 1.29.3  -> byte-identical output
  Empty / literal-"null" / no-arg guards all produce clean strings, no "()",
  no dangling comma, no trailing space. Non-disruptive: probe ran in /tmp and
  self-deleted; live /tmp/qmanager_events.json never touched.
  T2 STATUS: VERIFIED. Awaiting T1 (frontend).

## Conductor review findings (to batch into one fix pass)
F1. event-row.tsx:57 derives `chromatic` as `presentation.messageClass === ""`.
    presentEvent() computes `chromatic` internally (lib/event-presentation.ts:447)
    but does not expose it. The row is coupled to the implementation detail that
    a chromatic row returns an EMPTY message class. If that ever returns a
    non-empty string for a chromatic row, or "" for a neutral one, the row
    silently mis-inks its chips, identifiers and timestamp on a coloured ground.
    FIX: expose `chromatic: boolean` on EventPresentation (additive, dashboard
    unaffected) and read it directly.
F2. Minor inconsistency: shapes.ts uses BOTH `duration-[var(--duration-standard)]`
    (DISC_TRANSITION) and `duration-(--duration-standard)` (ROW.TRANSITION).
    Both compile (verified in built CSS: 18 hits). Cosmetic only.

## Conductor gate results (run personally, not reported by a worker)
- bunx tsc --noEmit                -> exit 0, clean
- bun --bun next build             -> exit 0, all 41 routes static, /monitoring OK
- built CSS audit: var(--duration-standard) x18, var(--ease-standard) x15,
  3.25rem x6, 1.625rem x4, 6.5rem x4 -> every arbitrary utility COMPILED, none
  silently dropped. `--tw-shadow:var(--shadow-whisper)!important` present, so the
  whisper shadow genuinely beats card.tsx's shadow-sm.

## V1 VERDICT: FAIL (blind verifier, 21 criteria)
19 PASS / 2 PARTIAL / 1 FAIL.
FAIL = criterion 15, the user's explicit "slim down" ask:
  measured in Chrome, both markups side by side:
    old row box 53px -> new row box 52px  (1px, not a slim)
    per-event PITCH 53px -> 58px          (+5px: each event costs MORE space)
  Cause: ROW_HEIGHT pinned at 52px == the old table row; the 6px gap was added
  ON TOP rather than the row being slimmed to absorb it.
  Conductor note: my Artifact claimed "~70px -> ~53px, 24% shorter". The 70px
  was an ESTIMATE and it was wrong; measured old row is 53px. Must correct to user.
Also PARTIAL 7: ROW.META_MARKER_ON_TONAL hand-overrides the warning Badge
variant's fill/ink + forces size-2.5 over the pattern's size-3.
Also flagged: network_mode lost its destination ("changed to 5G-NSA" -> "changed").

## Fix pass F (single batched worker) - accepted findings
 1 row genuinely slim to ~45px so pitch <= old 53px   [CRITICAL, the ask]
 2 Ongoing marker: stop overriding a Badge variant; plain inline marker
 3 network_mode: restore destination mode in the sentence
 4 F1 expose `chromatic` on EventPresentation (conductor finding)
 5 remove dead _ev_band_summary/_ev_round_latency/_ev_net_context
 6 consolidate duplicated 300 ring cap
 7 fix comment claiming a crossfade that does not happen; drop no-op mx-auto
 8 trim over-long comments THIS change added
DECLINED, with reasons:
 - family glyphs: type label already names the family in words; tone glyph is
   the accessibility-load-bearing one. Keep tone glyphs.
 - churn counts ("N changes in M min"): user explicitly asked these clauses gone.

## RUN COMPLETE
Fix worker af6f70a was KILLED by a session rate limit mid-run. Reconciled:
all 8 fixes had already been written; it died at the measurement step.
Stray fixture app/qm-rowprobe/ left behind -> removed by conductor.
Conductor took over the remaining work (measurement + gates), per the
takeover row: what was left was verification, which is conductor work.

MEASURED IN CHROME (conductor, both widths):
  new row 44px, pitch 50px   |  pre-fix row 52px, pitch 58px
  original table row 53px, pitch 53px
  -> row 17% shorter than the original AND pitch 3px tighter, WITH 6px gap.
  Holds identically at 380px, no horizontal scroll.

FINAL GATES (conductor-run):
  tsc --noEmit          exit 0
  next build            exit 0, 41 routes static
  i18n:check            exit 0, 100% x5 locales
  sh -n x6              all OK
  dead helpers          none remain
  em dash audit (scoped to this surface, node byte-accurate): 0 rendered
  network_mode regex    3/3 lift correctly, unknown-band case stays whole

COMMITTED 3c7fa3f on feat/network-events-refit. Tree clean except this ledger.
