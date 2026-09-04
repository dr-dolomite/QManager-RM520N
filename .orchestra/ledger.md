# Orchestration Ledger — /monitoring/alerts re-authoring to the design canon

BASELINE: 7bef685c1ca4efc4bf2e784956c043c574069c73 | dirty: ` M components/monitoring/network-events/shapes.ts` (uncommitted, NOT ours — pre-existing density change to the reference family; left untouched) | 2026-09-04

MODE: Full (Agent tool + real shell). Codex CLI absent (`codex: command not found`) → Claude-only seats, no consent question needed.
LEAD SEAT: Opus 5 — frontier class. Cache valid.

GOVERNING DOCS: docs/reference/redesign-proposal-playbook.md (Phase 1+2 of change-workflow.md
for "apply the design language to surface X"), DESIGN.md Migration Deltas row 23,
docs/reference/alerts.md, impeccable skill (context.mjs already run — do not rerun).

GATE: user approves a published before/after Artifact BEFORE planning and implementation.

## Plan
1. Recon A — map the /monitoring/alerts surface exhaustively (read-only)          | class FAST/WORKHORSE
2. Recon B — extract the finalized language from the network-events refit + refs   | class FAST/WORKHORSE
3. Recon C — capture BEFORE screenshots of the live route via a throwaway fixture  | class WORKHORSE
4. Conductor — read alerts.md, globals.css tokens, DESIGN.md (non-duplicative)     | LEAD
5. Conductor — establish re-authoring vs polish, write the proposal Artifact       | LEAD (FRONTIER judgment)
6. GATE — user approval
7. (post-approval) plan + implementation waves — not scoped yet

## Routing
1 → FAST/census → Explore @ sonnet — deliverable is a list, per the project's model-tiering rule
2 → FAST/census → Explore @ sonnet — same
3 → WORKHORSE → general-purpose @ sonnet — needs write + browser tools; mechanical but fiddly
5 → FRONTIER → LEAD (conductor) — design judgment is the whole deliverable, not delegable

## Tasks
| id | state | owned paths | job |
| 1 | ACCEPTED | (read-only) | Explore@sonnet |
| 2 | ACCEPTED | (read-only) | Explore@sonnet |
| 3 | ACCEPTED | app/qm-preview/**, public/__qm-preview-shim.js, .orchestra/scratch/** | |

## Attempts
(append-only)
| 1 | 1 | Explore@sonnet | rev1 | DONE | 13 sections, exhaustive | see Findings A below |
| 2 | 1 | Explore@sonnet | rev1 | DONE | tokens/primitives/i18n/motion extracted verbatim | .orchestra/scratch/tokens-verbatim.css |
| 3 | 1 | general-purpose@sonnet | rev1 | DONE | real page rendered loaded; full geometry census | .orchestra/scratch/before-measurements.json |

## Conductor reading (task 4, done inline)
- docs/reference/alerts.md read in full. Key model: effective send = capable AND master-enabled AND routed.
  Capability is hardcoded truth (connection_lost is SMS-only); routing is user preference. 3 events x 3 channels.
  Per-channel threshold_minutes with non-obvious semantics (a channel fires iff TOTAL outage crossed ITS threshold).
  Secret inputs MUST clear after a successful save (load-bearing; documented production bug).
  Nothing on the page may remount on save (the React key was removed deliberately).
  Page owns notification config ONLY; watchcat/ping_profile/quality_thresholds/crash.log are off-limits.
- DESIGN.md read: Motion, Components, Colors named rules, Do's and Don'ts.
- REFRAME CANDIDATE (to be confirmed against recon): the backend ANDs three inputs in
  _ae_effective_send(); the UI shows all three inputs across two cards and never shows the output.

## Decisions
- Codex not installed → no consent question, Claude-only ensemble.
- Recon fan-out of 3 announced to the user before dispatch.
- The dirty `network-events/shapes.ts` is INTENTIONAL and user-confirmed (2026-09-04): the event-row
  heights were deliberately reverted from the slim 44px back to the original 52px, as planned.
  => THE WORKING TREE IS CANON, NOT HEAD. Derive Alerts row geometry from the working-tree values
  (ROW_HEIGHT h-[3.25rem], DISC size-8, GLYPH size-4, ROOT gap-3 px-4 py-2, MESSAGE text-sm,
  META h-4, RELATIVE text-[0.8125rem], ABSOLUTE text-[0.6875rem] pt-[4px]).
  Do NOT propose re-slimming Network Events; it is outside scope and was just decided.

## Scratch
.orchestra/scratch/

## Findings A (surface census) — accepted
SIZE: 8 files, ~2,656 lines. alerts.tsx 270 / status 277 / settings 977 / log 401 / routing-grid 148 /
constants 130 / info-tip 32 / use-alerts-form 411. NO shapes.ts.
LAYOUT: page = raw h1+p (NOT the shared components/monitoring/page-header.tsx), then a 2-col
grid at @4xl/main. LEFT col = status card + log card stacked; RIGHT col = settings card (4 tabs).
VIOLATIONS: 14 opacity washes on role colours; 2 Badge variant=outline (one status, one identity);
2 class-string tone maps (TONE_RING/TONE_TILE) sitting beside a correctly-typed TONE_BADGE;
27 legacy radii (15 rounded-full, 5 -md, 4 -lg, 2 -xl, 1 -sm); 34 text-muted-foreground
+ 4 /70 + 2 /40 + 2 text-info/80; 6 borders on tonal containers; 4 arbitrary rem sizes.
CLEAN: zero raw Tailwind colours; motion fully tokenized; lucide only (correct for /monitoring);
container queries throughout; TONE_BADGE + REBOOT_TONE_BADGE already typed to BadgeVariant.
i18n: ZERO useTranslation. ~144 hardcoded strings (floor, not ceiling).
EM DASHES: 5 in user-visible copy (settings 223, 517; status 153; constants 70, 72)
+ 2 bare em-dash placeholders in the log table (log 261, 273).
SKELETONS: StatusSkeleton + SettingsSkeleton RESTATE geometry inline (Skeleton-Mirror violation).
LogSkeleton is correct: shares the exported AlertsActivityTableSkeleton.
DRIFT: RoutingDraft + AlertsFormErrors exported with no external consumers.
PHONE_REGEX duplicated verbatim in sms-forwarding-card.tsx:132 (same value, no shared module).
STATE HOLES: status card has no loading/empty/error of its own; settings card has NO inline error
(save/test failures are toast-only); page level has no error branch at all.
CONTRACT (do not break): secrets clear after save; nothing remounts on save; test gated on
saved+configured+!dirty; routing renders capability from the API, never hardcoded.

## Findings C (measured, before) — accepted
FIXTURE: app/qm-preview/alerts/page.tsx (210 lines, renders the REAL AlertsComponent behind a
module-scope cookie+fetch shim, inside the real AppLayout). Dev server STILL RUNNING on :3010.
BOTH ARE OWED CLEANUP at the end of the run.
HEIGHT desktop@1440: main container 1178px. Cards 441 / 605 / 1070px.
HEIGHT narrow@420 (container query): main 2320px. Cards 545 / 703 / 892px.
RADII (429 elements): pill 43 | 14.4px 6 | 8.4px 8 | 10.4px 2 | bottom-only 1.
  ==> CONDUCTOR NOTE: 14.4/10.4/8.4px are the LEGACY --radius:0.65rem chain
  (rounded-xl = radius+4, rounded-lg = radius, rounded-md = radius-2).
  ZERO elements on the role scale (--radius-inline 12 / field 20 / tile 28 / card 36 / hero 40).
DURATIONS: 0.15s x22 | 0.36s x10 | 0.6s x4 | (0.6,0.6,0.36) x26.
  ==> CONDUCTOR CORRECTION: the agent mislabelled these. Shipped scale is quick=360ms,
  standard=600ms, emphasized=800ms. So 0.15s x22 is OFF-SCALE (Tailwind default leaking from
  components/ui primitives) and is a real One-Scale finding; 0.36/0.6 are correct.
INK: text-muted-foreground renders on 131 nodes (light) / 134 (dark).
  ==> 34 literal occurrences in the family source vs 131 rendered nodes. The gap is
  CardDescription hardcoding the retired ink inside components/ui/card.tsx:51 (DESIGN.md delta 43).
GEOMETRY vs CANON:
  Card      14.4px radius + 1px border + shadow-sm   vs  36px, border-0, --shadow-whisper
  Input     36px tall, 8.4px, transparent + border   vs  42px, 20px, surface-container, no border
  Button    32px (Save/Discard), 8.4px               vs  42px, pill
  TabsTrig  29px, 8.4px                              vs  pill
  Switch    18.39px tall                             vs  44px coarse-pointer target (9 in the grid)
  Badge     22px pill, correct on the 5 roles        vs  correct; the 2 outline ones are the break
TOKENS extracted verbatim to .orchestra/scratch/tokens-verbatim.css (399 lines, :root + .dark).

## Task 5 — proposal Artifact (LEAD, FRONTIER) — DONE, at the gate
URL: https://claude.ai/code/artifact/0c40bae6-0b98-48f1-b11d-e4a6a540e4f7
Source: <scratchpad>/alerts-refit.html (1549 lines; 400 of them the verbatim :root/.dark splice).
VERIFIED IN A BROWSER, not asserted: served from public/ via the running :3010 dev server, read back
computed styles. Hero 40px/border-0, tile 104px, disc 52px, row 52px, field 42px/20px/surface-container
/0 border, button 42px/pill, chip 22px/0 border, --duration-standard 600ms, success-container resolving
to the exact shipped oklch(0.31 0.086 149). Rethink Sans loaded. All SIX state toggles exercised via
JS click and asserted (gap/dirty/loading/empty/error/live). One self-inflicted copy bug found and fixed
(gap-state column chips said Ready while rendering muted). public/ preview copy REMOVED.

## GATE — awaiting user decision. Nothing built.
Three calls flagged for veto: (1) routing grid becomes the hero and reports resolved effective-send;
(2) activity table becomes the /monitoring 52px event row; (3) tabs become a pill rail.
One optional fold-in offered: server-side redirects for /monitoring/{sms,email}-alerts.

## OWED CLEANUP at end of run
- app/qm-preview/alerts/page.tsx  (fixture, kept for the AFTER comparison)
- bunx next dev -p 3010           (still running, backgrounded)
- rm -rf .next && bunx next typegen after deleting the fixture

---

# RUN 2 — implementation (post-approval)

BASELINE: 4cfb49aa218db2b694907c66bca9ed8d57b9c5f4 | clean except `.orchestra/scratch/`, `app/qm-preview/` (ours) | 2026-09-05
MODE: Full. Codex re-probed: still ABSENT. Claude-only seats.
LEAD SEAT: Opus 5 — frontier. Cache valid.

## Gate outcome
APPROVED. All three veto-flagged calls stand:
 1. routing grid becomes the hero and reports resolved effective-send
 2. activity table becomes the /monitoring 52px event row
 3. tabs become a pill rail
FOLD-IN: YES — /monitoring/{sms,email}-alerts redirect.
 NOTE: `output: "export"` in next.config, so Next `redirects()`/`redirect()` are unavailable.
 Approach is a SERVER component emitting a hoisted `<meta http-equiv="refresh">`: lands in the
 emitted HTML, ships zero client JS, kills the hydrate-then-flash, retires both strings.

## New user constraint (2026-09-05, mid-run)
HARD RULE: cards side by side on desktop share ONE height; a bento group resolves to one
symmetrical height. Written into DESIGN.md as **The Symmetric-Pair Rule** + the amended
"Equal heights are not optional" paragraph.
CONFLICT FOUND AND RECONCILED: DESIGN.md already carried the Radio Information lesson AGAINST
h-full locking (stranded ~200px). Reconciliation, per the Traffic Engine precedent: the lock is
honest only when every card has a state built to FILL; a card that cannot fill belongs in a
full-width band, not in a ragged row. Radio Information's blockquote amended to say so.
CONSEQUENCE FOR THIS REFIT: the approved mock's `.cols` uses `align-items:start` — that is now a
defect. COLS ships `items-stretch`, and Channels + Activity each nominate one fill region.

## Plan
| W1 | shapes.ts + derive.ts (family contract)                    | serial  | ui-builder |
| W2 | 3x parallel card re-authoring, disjoint files              | parallel| ui-builder |
| W3 | shell composition + page header + height lock + redirect   | serial  | ui-builder |
| W4 | i18n: merge per-area key fragments into 5 locales          | serial  | general-purpose |
| W5 | build + browser measurement + BLIND VERIFIER               | serial  | orchestra-verifier |
| W6 | /impeccable critique (frontier seat) -> batched polish      | serial  | frontier |
| W7 | docs, fixture cleanup, commit to development               | serial  | LEAD |

## Tasks
| id | state | owned paths | job |
| W1 | DISPATCHED | components/monitoring/alerts/{shapes,derive}.ts | ui-builder |

## Attempts
(append-only)
| W1 | 1 | ui-builder | rev1 | DONE | shapes.ts + derive.ts; tsc clean, eslint 0 | deriveCoverage(draft, confirmed) is the ONE derivation |
| W2a| 1 | ui-builder | rev1 | DONE_WITH_CONCERNS | coverage hero + band; own 5 files clean | never rendered in a browser |

## Carried defects (must close before W7)
- D1 shapes.ts `CELL_TONE.quiet` ships `cursor-not-allowed`, but derive.ts says a quiet cell is
  `interactive: capable` and must stay clickable. W2a patched it at the call site with a trailing
  `cursor-pointer`. FIX IN SHAPES, drop the override. Owner: W3 (shapes.ts is free once W2 lands).
- D2 `LastAlertSummary` on the band has NO data source in use-alerts. Shell must feed it from
  use-alerts-log. `undefined` = skeleton, `null` = never sent. Owner: W3.
- D3 Nobody has loaded the surface. /qm-preview/alerts 500s until alerts.tsx is rewired. Owner: W5.
- D4 constants.tsx now has dead exports (EVENT_META unused by W2a, REASON_TEXT/reasonText,
  TONE_* maps gone). Verify against the OTHER two workers before deleting. Owner: W3.
| W2b| 1 | ui-builder | rev1 | DONE_WITH_CONCERNS | channels rail + fields; browser-measured | 3 new files; 96 i18n keys |
- D5 `FIELD.SHELL` loses to Input's `dark:bg-input/30` (0,2,0) in dark. W2b proved the fix by
  measurement (`dark:bg-surface-container!` computes to the real token) but had to keep it as a
  LOCAL const because shapes.ts was read-only. PROMOTE to shapes.ts `FIELD.SHELL`, with
  `FIELD_INVALID` (border-0! kills the primitive's aria-invalid border). Owner: W3.
- D6 `use-alerts-form.ts` destructures `state.channels` and reads `sms.enabled` UNGUARDED, so it
  throws on a partial payload BEFORE any card renders. The shell must branch on channel presence
  before calling useAlertsForm or every empty/error state on the page is dead code. Owner: W3.
- D7 W2b created an EXTRA fixture `app/qm-preview/channels/page.tsx`. Delete with the rest at W7,
  NOT mid-run (deleting a route strands .next/types/validator.ts until .next is cleared).
- D8 i18n debt so far: 96 channels keys. Until merged, i18n:check reports 96 x 4 = 384 strict errors.
- D9 New export `AlertsSettingsCardSkeleton`; shell must drop its local `SettingsSkeleton`, which
  still mirrors the retired Routing tab. Owner: W3.
| W2c| 1 | ui-builder | rev1 | DONE_WITH_CONCERNS | 52px activity rows; never rendered | ActivityFeedSkeleton replaces the table skeleton |
| W3 | 1 | ui-builder | rev1 | DONE_WITH_CONCERNS | shell composed; tsc 0, eslint 0; PAGE RENDERS | D1/D2/D4/D5/D6/D9 all closed |
| LEAD | - | conductor  | -    | DONE | key-in-spread console error fixed; tsc 0 eslint 0 | last console error from our code |
| W4en| 1 | conductor  | rev1 | DONE | 174 keys into en/common.json, 238 additions / 0 deletions | insertion-only proven |
| W4x4| 1 | gp@sonnet  | rev1 | DISPATCHED | id / it / zh-CN / zh-TW fragments | merged by tool, not by hand |

## Measured (W3, fixture at :3010, container 1105px — same width as the BEFORE capture)
Pair offsetHeight 772/772 in EVERY state exercised (loaded light+dark, loading, dirty, invalid,
stale, empty, error, retry). Hero 40px radius / 0 border. Field 42px / 20px / 0 border.
Row 52px single distinct value. Tile 104px single distinct value. Cell 77px against a 74px floor.
PAGE HEIGHT: 1178 -> 1491 @1440 (+313); 2320 -> 3425 @420 (+1105). Reported as found, not tuned.
The +1105 at 420 is the hero matrix stacking to nine full cells.

## Open concerns from W3 (for the critique wave)
- C1 `hook.error` is ONE channel for read AND save failures, so a failed save will also paint the
  hero's stale notice. Reasoned, not observed (the fixture always saves).
- C2 420px save-bar overflow of 50px while RAW KEYS render. Substituting real copy took it to
  exactly 0. RE-CHECK after the packs merge.
- C3 The band cannot distinguish "unknown" from "loading": a failed log read with zero entries
  shows a permanently pulsing skeleton tile rather than a third honest state.
- C4 55px settle on the pair loading->settled (827->772), from ActivityFeedSkeleton's 12 rows.

## CORRECTION — the redirect fold-in (LEAD, caught at the build gate)
FIRST ATTEMPT WAS WRONG AND WAS REPLACED. A server component returning
`<meta httpEquiv="refresh">` does NOT reach the emitted `<head>` under `output: "export"`.
Proof: the tag appears only inside the RSC flight payload of
out/monitoring/sms-alerts/index.html, as `\"meta\",null,{\"httpEquiv\":\"refresh\"...`.
So the forward still waited for hydration -- the exact bug the fold-in was meant to kill, only
now with a blank page instead of a visible string. Strictly worse than the code it replaced.
SHIPPED INSTEAD: delete both app routes; serve real static files from
public/monitoring/{sms,email}-alerts/index.html. Exported artifact is 232 bytes, zero JS, no
framework, meta refresh + canonical + a bare anchor fallback whose text is the path (nothing to
translate). Verified by reading out/ after a clean rebuild.
LESSON: for a static export, verify a redirect in the EXPORTED HTML, never in the source.

## i18n baseline correction
An early i18n:check reading of 2747 was WRONG. Controlled A/B (stash the locale changes, rerun,
restore) gives baseline 2809 -> 2983, delta exactly 174, 0 errors on both sides. All five packs
238 additions / 0 deletions, 174 leaves each, one `alerts` block each.
Passthrough allowlist gained "Email" (SMS and Discord were already listed). Warnings 12 -> 16;
the 4 remaining are the deliberate `xxxx xxxx xxxx xxxx` password placeholder, one per non-en pack.

## Gates at this point
tsc --noEmit: EXIT 0. eslint components/monitoring/alerts/: EXIT 0 (repo-wide eslint has
PRE-EXISTING errors in app/not-found.tsx etc., none in our change set).
bun run build: success, all routes static. i18n:check: 0 errors.

| W5 | 1 | orchestra-verifier | rev1 | DISPATCHED | blind, original task verbatim |
| W6 | 1 | gp@opus (impeccable) | rev1 | DISPATCHED | design critique, read-only |
| W5 | 1 | orchestra-verifier | rev1 | PASS_WITH_NOTES | 11 criteria; 4 defects | height rule PASS in 8 states |
| W6 | 1 | gp@opus (impeccable) | rev1 | DONE | 8 defects, 4 canon, 7 craft, 3 taste | deterministic detector 0; all judgment-level |
| LEAD | - | conductor | - | DONE | DESIGN.md: 2 delta rows closed + 4th sanctioned container use |

## LEAD-caused incident (recorded so it is not repeated)
I ran `rm -rf .next` while `next dev` was RUNNING on 3010. That deleted the dev server's chunks
underneath it and latched every route to 500 (chunks 404). Both review agents hit it: the verifier
and the critic each fell back to serving the `out/` static export instead. Neither result is
invalidated (the export was newer than every source file), but the critic's browser findings were
made against a build, not a live server. Killed PID and restarted via preview_start; all routes 200.
RULE: never clear `.next` while a dev server is up. Stop it first.

## W6 headline finding (accepted)
The APPROVED MOCK'S OWN CELL WORDS contradict the refit's thesis: `quiet`="Routed" and
`unrouted`="Off" describe the INPUT, not the outcome, and "Off" collides with the column chip's
word for a disabled channel. The build reproduced the mock faithfully; the mock was wrong.
Also 4 measured WCAG AA failures (CELL_HELD_INK opacity-60 at 2.44:1 light / 3.83:1 dark;
MATRIX.CHANNEL_LABEL opacity-75 at 3.2:1) on the copy that explains why an alert will not arrive.

| W7 | 1 | ui-builder | rev1 | DISPATCHED | F1-F17 batched polish | en strings to a scratch delta, not the packs |
| W7 | 1 | ui-builder | rev1 | DONE | all 17 findings closed; tsc 0, eslint 0 | 14 en keys to a scratch delta |
| W8 | 1 | conductor | rev1 | DONE | en delta applied: 5 changed, 9 added, 174 -> 183 leaves |

## LEAD independent verification (not taken on report)
Browser, dev server :3010, fixture route, viewport emulated:
- @1440 (main 1377px): pair 772 / 772, gridTemplateColumns "654.5px 654.5px", align-items stretch.
- @420: horizontal page overflow 0. The earlier 50px save-bar overflow was RAW KEYS, now resolved.
  Remaining scrollWidth>clientWidth nodes are sr-only spans (clipped by design) and the Switch
  primitive's thumb track. Page height 3590 @420 viewport, 1644 @1440 (main 1377).
- New copy renders, ZERO raw `alerts.*` keys leaking, zero em dashes on the surface.
- Accessible names carry the reason: "Connection lost by Email: Can't send. Needs the internet"
  -- F7 + F13 both confirmed, on the engine's real capability table.
NOTE: the first screenshot came back BLANK because the tab was backgrounded and Framer Motion
was frozen at `initial` (rAF throttled). tabs_select first, then screenshot.

| W9 | 1 | gp@sonnet | rev1 | DISPATCHED | 14 keys x 4 locales |
