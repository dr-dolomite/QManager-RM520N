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
| W9 | 1 | gp@sonnet | rev1 | DONE | 14 keys x 4 locales, back-translations given |
| W10| 1 | conductor | rev1 | DONE | deltas applied; all 5 packs 183 leaves, key sets match en |

## RUN CLOSED 2026-09-05
COMMIT bd8225b on feat/alerts-design-canon-refit, merged --no-ff as 1877da0 into development.
First-parent history verified intact (1877da0 -> 4cfb49a -> 7bef685 -> ...), bd8225b and 4cfb49a
both ancestors of HEAD, nothing displaced.

FINAL GATES on the merged tree: tsc --noEmit EXIT 0 | eslint components/monitoring/alerts/ EXIT 0
| i18n:check 0 errors, 16 warnings (baseline 12; the 4 added are the deliberate
`xxxx xxxx xxxx xxxx` password placeholder, one per non-en pack) | bun run build success, all
routes static, out/qm-preview absent, both redirects present at 232 bytes.

CLEANUP DONE: app/qm-preview/ deleted (all three fixtures), dev server stopped via preview_stop,
.next and out cleared, next typegen re-run. `.orchestra/scratch/` deliberately left untracked --
it holds the recon captures (before-measurements.json, tokens-verbatim.css) and the merged i18n
fragments, and is working state, not product.

CARRIED FORWARD, NOT DONE (out of scope, recorded so they are not rediscovered as bugs):
- Heading levels skip H1 -> H3 on this page; app-wide via CardTitle, not introduced here.
- components/ui/input.tsx contributes a 0.15s transition and button/switch contribute
  `transition-all` to 5 nodes on this surface. Product-wide One-Scale leak, already tracked as a
  DESIGN.md delta row; worked around at call sites, not fixed here.
- PHONE_REGEX still duplicated verbatim between use-alerts-form.ts and sms-forwarding-card.tsx.
- Repo-wide `bunx eslint` has PRE-EXISTING errors (app/not-found.tsx and others). Untouched.

---

# Ledger — /system-settings design-canon refit

Baseline commit: e91806fa1e4cbf567fcd4a19a7596cbf1bfdf294
Branch: worktree-system-settings-canon-refit
Worktree: .claude/worktrees/system-settings-canon-refit
Mode: Full (Agent tool + real shell). Codex not probed — user pinned ui-builder for all code steps.
Lead seat: Opus (FRONTIER).

Plan: docs/superpowers/plans/2026-09-05-system-settings-canon-refit.md (gitignored)
Tier 2, Frontend-Only Lite Path. Phases 4-6 of change-workflow.

## Tasks

| id | task | write set | seat | status |
| -- | ---- | --------- | ---- | ------ |
| R1 | scout: reference impls + shapes precedents | (read-only) | orchestra-scout | PENDING |
| R2 | scout: current surface + hook/type contracts + lucide names | (read-only) | orchestra-scout | PENDING |
| 00 | shapes.ts | components/system-settings/shapes.ts | ui-builder | PENDING |
| 01 | page shell | components/system-settings/system-settings.tsx | ui-builder | PENDING |
| 02 | status band | components/system-settings/status-band.tsx | ui-builder | PENDING |
| 03 | Time & Units | components/system-settings/system-settings-card.tsx | ui-builder | PENDING |
| 04 | Scheduled Reboot | components/system-settings/scheduled-operations-card.tsx | ui-builder | PENDING |
| 05 | SSH Access | components/system-settings/ssh-password-card.tsx | ui-builder | PENDING |
| 06 | Tracked SIMs | components/system-settings/sim-registry-card.tsx | ui-builder | PENDING |
| 07 | i18n | public/locales/{en,zh-CN,zh-TW,it,id}/system-settings.json | ui-builder | PENDING |
| DA | devil's advocate | (read-only) | general-purpose (opus) | PENDING |
| 08 | docs | docs/reference/system-settings.md, CLAUDE.md, DESIGN.md, RELEASE_NOTES.md | docs-writer | PENDING |

## Conductor rulings (plan text vs canon — resolved before/while building)

- **C1 — `Repeats Sun · Wed` violates the No-Dot-Separator Rule.** DESIGN.md:797 bans `·`
  as a glue character between short facts. Days are a homogeneous list, not two facts, so
  a comma is the correct prose punctuation. RULING: render `Repeats Sun, Wed`. The
  separator is a translated leaf, not a hardcoded literal.

- **C2 — `FIELD` carries `rounded-pill`, DESIGN.md > Shapes assigns inputs `rounded-field`.**
  NOT a conflict. custom-dns:425, ip-passthrough:384 and ttl-mtu all ship pill fields, and
  ip-passthrough:62 / ttl-mtu:49 state it in their own radius-map comment ("999px fields,
  chips -> rounded-pill"). DESIGN.md's "20px radius" line for inputs is a doc/code delta,
  out of scope for this pass. RULING: `rounded-pill`, per the plan.

- **C3 — `ConditionScreen` renders a `MaterialSymbol`, and `/system-settings` is a lucide
  route.** DESIGN.md:846 bans mixing the two libraries inside one route. Census: the
  component has ZERO consumers on any lucide route — all 14 are under `components/cellular/`.
  The newest local-network family, `traffic-engine/shapes.ts:735-770`, **restates** the
  geometry in its own module and documents why; `ethernet` uses a lucide `NoticeTile`
  instead. The plan's own reference-implementation header also says "copy the values, not
  the module".
  RULING: mint a local `CONDITION` object in `system-settings/shapes.ts` restating the
  geometry (model: traffic-engine's `CONDITION`), render **lucide** glyphs, and import
  `ConditionTone` + `CONDITION_TONE` from `components/cellular/condition-screen.tsx` for
  the TONE only. That satisfies all three rules at once: no class-string tone map
  (CLAUDE.md > Shared Constants makes this compiler-enforced), no cross-family geometry
  import, no Material glyph on a lucide route.

- **C4 — `EYEBROW` and the `uppercase` step.** ethernet:152 ships no `uppercase`; the
  freshest refit (alerts) does. The plan writes band eyebrows in caps in its copy table.
  RULING: `uppercase` lives in the CSS class, never in the locale string — otherwise the
  Italian and both Chinese packs carry shouted or meaningless casing.

- **C5 — `card.tsx:51` hardcodes `text-muted-foreground` into `CardDescription`.** A
  tracked product-wide delta (DESIGN.md:273). The reference implementation takes the
  primitive bare; 4 of the 5 re-authored families follow it.
  RULING: take `CardDescription` bare, matching the reference. Record in the feature doc
  that a family-scoped grep for the retired ink cannot see the primitive.

- **C5 REVERSED.** The step-00 builder independently minted
  `CARD_DESC = "text-on-surface-variant text-sm"`. It is right and I was wrong: this pass's
  whole thesis is closing out the retired ink on the last unmigrated route, and
  `ip-passthrough-card.tsx:468` is the existing precedent for overriding at the call site.
  RULING: use `CARD_DESC` on every `CardDescription` here. Record the primitive as the
  product-wide delta it is.

- **C6 — the band and the SIM card would each mount `useSimRegistry`.** The hook fetches on
  mount with NO shared cache (`hooks/use-sim-registry.ts`), so two mounts = two GETs of
  `sim_registry.sh` per page load, with independent state — dismissing a SIM in the card
  would NOT update the count in the band directly above it. Not addressed by the plan.
  RULING: lift `useSimRegistry()` into the page shell (`system-settings.tsx`) and pass it
  to both consumers as props — the same shape the shell already uses for
  `useSystemSettings`. `useKnownSims()` stays in the card; its `count` is a different fact
  (known ICCIDs, not registry rows).

- **C7 — plan's finding "`useSystemSettings().refresh` is destructured by nothing" is
  CORRECT.** Scout R2 claimed it was called by `sim-registry-card`; it is not — that card
  uses `useSimRegistry().refresh`. `useSystemSettings()` is called only in
  `system-settings.tsx`, and neither card's `Pick<>` includes `refresh`. Verified.

- **C8 — all 34 candidate lucide names verified** against the installed lucide-react
  0.562.0 export list. All exist. Note `CardSimIcon`, NOT `SimCardIcon`.

## Attempts (append-only)

---

# Orchestration Ledger — /monitoring/tailscale re-authoring to the design canon

BASELINE: e91806fa1e4cbf567fcd4a19a7596cbf1bfdf294 | clean except untracked .orchestra/scratch/ | 2026-09-05
BRANCH: feat/tailscale-design-canon-refit (main checkout — this session has a pinned cwd, so
EnterWorktree is unavailable. The one parallel session holds wt+watchdog-canon-refit with a
disjoint component write set, so the main checkout's index is uncontended.)

MODE: Full (Agent tool + real shell). No Codex.
LEAD SEAT: Opus 5 — frontier class.
TIER: 2, Frontend-Only Lite Path (every file in components/ or public/locales/).
Phases 1-3 were completed by the parent session; this run starts at Phase 4 Execute.
PLAN (approved, contract): .orchestra/scratch/tailscale-refit-plan.md

## Tasks
| id | state | owned paths | job |
| T1 | ACCEPTED | components/monitoring/tailscale/**, public/locales/en/common.json | ui-builder (opus, pinned) |
| T2 | PENDING  | public/locales/{zh-CN,zh-TW,it,id}/common.json | translation worker |
| T3 | PENDING  | (read-only) | LEAD — tsc / lint / i18n:check / build |
| T4 | PENDING  | (read-only) | LEAD — browser, both themes, narrow + wide |
| T5 | PENDING  | (read-only) | orchestra-verifier — blind pass against the plan |

## Attempts
(append-only)
| T1 | 1 | ui-builder@opus (pinned, no override) | rev1 | DONE | 8 new files, 2 re-authored, 2 deleted, 137 en keys | tsc exit 0, scoped eslint exit 0 |

## Notes
- CONDUCTOR ERROR, repaired: the first write of this ledger clobbered the committed Alerts-run
  ledger above it (Write overwrote a tracked 324-line file). Restored from the base SHA and
  appended instead. The Alerts record is intact.
| T2 | 1 | orchestra-worker@sonnet | rev1 | RUNNING | 137 keys x 4 locales |
| T3 | 1 | LEAD | rev1 | PARTIAL | tsc exit 0; eslint(family) exit 0; i18n/build pending T2 |
| T4 | 1 | LEAD | rev1 | DONE | browser pass, see below |
| T5 | 1 | orchestra-verifier | rev1 | RUNNING | blind, given the plan verbatim |

## T4 — browser evidence (dev server :3019, port 3000 untouched)
Shape C (unreadable): header + Unknown chip + Refresh, destructive condition with Retry,
  peers card carrying its OWN condition (plan §3 C). Verified light AND dark.
Shape A (Running, 4 peers, 1 exit node, DERP health advisory): 4-tile band, v1.78.1 neutral Tag
  in the card header, warning-container health notice, both switch tiles tonal (on =
  primary-container), 7 identity pill rows with no hairlines, full-width peers table showing the
  OS and Last-seen columns, counts as header tags, danger row split out. Verified light AND dark.
Shape A (empty peers): "No other devices" condition; band reads 0 / 0, "No exit node".
  Cards go honest — the IPv6 row and the health notice simply vanish, no fallback tone.
Shape B (not installed): no chip, install hero, #24's consequence copy ("uses your data
  allowance"), install/check rail, ONE labelled machine-voice command row (#20's divider ritual
  gone), no band / peers / danger row.
1970 GUARD (#18): a peer with last_seen 1970-01-01T00:00:20Z renders "Unknown", NOT "20456d ago".
Narrow (375x812): band tiles stack, header wraps, no horizontal overflow.
Console: only 404s from the absent CGI backend. No React or hydration errors.

## T3 — deterministic gates (all green)
bunx tsc --noEmit                        EXIT 0, no output
bunx eslint components/monitoring/tailscale  EXIT 0, no output
bun run i18n:check                       EXIT 0 — "0 error(s), 22 warning(s) [strict]";
  all five packs 100% translated (3129/3129). Baseline was 16 warnings; the 6 added are
  zh-CN/zh-TW passthroughs of the bare product names "Tailnet" and "MagicDNS", which are
  correct as-is. NOT allowlisted, following the Alerts run's precedent of recording rather
  than silencing; lib/i18n/passthrough-allowlist.json is outside this plan's file list.
bun run build                            EXIT 0 — compiled in 19.6s, 48/48 static pages,
  /monitoring/tailscale static. ZERO "warnings while optimizing generated CSS", so no
  Tailwind prose hazard was introduced.
i18n parity: 137 tailscale.* keys in en and in all four target packs, 0 missing / 0 extra.
CRLF preserved: every locale pack is +159 / -0. No whole-file rewrite.

NOTE on `bun run lint` (unscoped): red, but PRE-EXISTING and not caused by this change. The
script is bare `eslint` with only .next/out/build in globalIgnores, so it lints other sessions'
.claude/worktrees/**/.next/** bundles and simpleadmin-source/**. Proven independently:
`bunx eslint app/not-found.tsx` — a file untouched by this change — errors. The Alerts run
recorded the same pre-existing condition when it closed.

## COMMIT
13608db on feat/tailscale-design-canon-refit — 18 files, +3044 / -1273.
Base SHA e91806f verified an ancestor of HEAD; branch is 1 commit ahead.
NOT merged and NOT pushed — the parent session integrates after a separate critique pass.
Out-of-scope files confirmed byte-unchanged vs the base SHA: hooks/use-tailscale.ts,
app/monitoring/tailscale/page.tsx, scripts/www/cgi-bin/quecmanager/vpn/tailscale.sh.
.orchestra/scratch/ deliberately left untracked (working state, not product) — same call the
Alerts run made.

## T5 — blind verification (orchestra-verifier, given the plan verbatim)
VERDICT: PASS_WITH_NOTES.
All 24 numbered changes Verified, none "Not done". All seven states confirmed reachable and
mapped to the right shape. §7 constraints all Verified except one, §5 motion Verified
(no bare-var arbitrary anywhere; exactly one ambient loop, mounted only under needsLogin).

DEFECT FOUND (low, real, FIXED in d85415a): two skeletons restated geometry instead of
importing it — connection-card's rail placeholder hardcoded the 42px action height, peers-card's
head placeholder hardcoded the 36px head height and double-applied rounded-inline. Values
matched, so nothing was visibly wrong; the risk was silent drift on a future retune of
shapes.ts. Fixed by extracting ACTION_HEIGHT / TABLE.HEAD_HEIGHT and adding SKELETON.ACTION /
SKELETON.HEAD. Every <Skeleton> on the surface now reads a SKELETON.* constant.
The conductor's own sweep MISSED this — it checked that skeletons use shape constants without
checking every one. This is the dispatch that earned its cost.

Verifier's second note (header chip reads "Unknown" on first paint) was assessed by the verifier
itself as within spec — the plan's skeleton row does not specify chip behaviour. Not changed.

## RUN CLOSED 2026-09-05
Branch feat/tailscale-design-canon-refit, 3 commits: 13608db (refit), efa40df (ledger),
d85415a (skeleton-mirror fix). NOT merged, NOT pushed — the parent session integrates.

CARRIED FORWARD, NOT DONE (recorded so they are not rediscovered as bugs):
- 6 new i18n:check WARNINGS (not errors): zh-CN/zh-TW passthroughs of the bare product names
  "Tailnet" and "MagicDNS". Correct as-is. Silencing them means adding to
  lib/i18n/passthrough-allowlist.json, which is outside this plan's file list.
- No docs were written. There is no DESIGN.md Migration Deltas row and no
  docs/reference/tailscale.md for this surface, and the plan's file list excludes docs. This is
  a refit of an existing surface, not a new feature with new invariants.
- public/locales/*/common.json is a write-set collision with the parallel watchdog refit in
  wt+watchdog-canon-refit. Both append a sibling top-level block; expect a merge conflict there.
- The longest status label ("Needs login") truncates in the narrowest 190px band tile. This is
  the canon's own `truncate` behaviour restated from the Latency band, not a regression, but
  i18n will make it more visible in longer languages.
- Not exercised on hardware. Every state was driven through a fetch shim on the dev server;
  the RM520N-GL was not probed. This is a frontend-only change with no backend surface.

---

# Orchestra ledger — watchdog canon refit

Baseline commit: e91806f (branch worktree-wt+watchdog-canon-refit, == development)
Mode: Full (Agent tool + real shell). Codex: not probed, not used — the brief specifies Claude
tiers (Sonnet legwork / Opus judgment), which is also this project's convention.
LEAD seat: Opus (frontier).

## Commit plan (10, build-safe order; plan step in parentheses)

| # | Commit | Plan step | Write set |
|---|---|---|---|
| 1 | shapes.ts + derive.ts | 1 | components/monitoring/watchdog/{shapes.ts,derive.ts} |
| 2 | status-band.tsx | 3 | components/monitoring/watchdog/status-band.tsx |
| 3 | ladder-card.tsx | 5 | components/monitoring/watchdog/ladder-card.tsx |
| 4 | detection-card.tsx | 6a | components/monitoring/watchdog/detection-card.tsx |
| 5 | recovery-activity-card.tsx | 6b | components/monitoring/watchdog/recovery-activity-card.tsx |
| 6 | save-bar.tsx | 7 | components/monitoring/watchdog/save-bar.tsx |
| 7 | shell re-author + honesty wiring | 2 + 4 | watchdog.tsx, use-watchdog-form.ts |
| 8 | motion sweep | 8 | components/monitoring/watchdog/** |
| 9 | i18n namespace | 9 | public/locales/*/common.json |
| 10 | deletions + cleanup | 10 | old cards, hooks/use-watchdog-settings.ts |

Rationale for the reorder: the plan numbers steps by topic, but a shell that imports cards which do
not exist yet does not typecheck. Leaves land first, the shell wires them, so every commit builds.

## Tasks

| id | task | seat | status | attempts |
|----|------|------|--------|----------|
| R1 | incumbent inventory | sonnet/general-purpose | DONE | 1 |
| R2 | reference impl distillation | sonnet/general-purpose | DONE | 1 |
| R3 | contracts + primitives + i18n plumbing | sonnet/general-purpose | DONE | 1 |
| DA | devil's advocate vs plan | opus/general-purpose | DONE_WITH_CONCERNS | 1 |

## Advocate adjudication (all findings accepted; three re-verified by the lead)

| # | Finding | Ruling | Re-verified against |
|---|---|---|---|
| B1 | SIM-failover banner + Revert action deleted with no home in the anatomy | ACCEPT — add a band and a commit | `watchdog.sh:342` handles `revert_sim`; no other renderer |
| M1 | `not_running` cannot see a *dead* daemon — the poller strips `timestamp` | ACCEPT — narrow the claim and the caption | `qmanager_poller:1969-1979`, `:2303-2312`: 9 fields, no timestamp |
| M2 | 30s grace is shorter than the settle path | ACCEPT — 60s | `qmanager_poller:51` `TIER1_5_EVERY=5` × ~3.7-4.0s ≈ 20s |
| M3 | grace must not read a clock in render | ACCEPT — anchor on `receivedAtMs`, render-phase state | `use-modem-status.ts:96-102` |
| M4 | D3: Detection is the height DRIVER, not the absorber | ACCEPT — Activity absorbs, `overflow-y-auto` | `alerts-log-card.tsx:382-387` |
| M5 | `derive.ts` cannot own `isDirty` — draft state lives in the form hook | ACCEPT — `use-watchdog-form.ts` stays | `use-watchdog-form.ts:196-225` |
| M6 | Event records carry no tier, and messages are backend English | ACCEPT — type label, not tier | `events.sh:123-128` |
| M7 | `reboots_this_hour` is frozen between daemon starts | ACCEPT — honest caption | `qmanager_watchcat`: `count_recent_reboots` only at `:595`, `:892` |
| M8 | No docs step; the change falsifies a whole doc section | ACCEPT — add a docs commit | `connection-watchdog.md:359-381` |
| N1 | Omitting `check_interval` beats round-tripping it | ACCEPT | `watchdog.sh:229-231`, `:284` — optional on both passes |
| N8 | `isStale` pins to true forever on a 1970 clock | ACCEPT — gate on clock plausibility | CLAUDE.md: no battery RTC |
| N2-N7, N9 | wording / scope clarifications | ACCEPT | — |

Commit count moves 10 → 12: +1 for the failover band (B1), +1 for docs (M8).

---

# Run: /system-settings critique residue (2026-09-06)

**Baseline:** 44c1a9722b81dc4efdace89c4e24f65db9bf4ead on `fix/system-settings-critique-residue`
**Mode:** Full (Agent tool + real shell). Tier 2, Frontend-Only Lite Path.
**Worktree:** deliberately NOT used. Browser verification is required here and
`preview_start` serves the repo root, not a worktree, so a worktree would make the
one check that matters impossible to run. Main checkout, feature branch.

**Origin:** three items the 2026-09-05 `/impeccable critique` pass reported but did
not fix before hitting a session rate limit. Recorded in
`docs/reference/system-settings.md`. None are shipping defects.

## Tasks

| # | Task | Seat | Status |
|---|---|---|---|
| T1 | Attack all three premises + the conductor's item-2 counter-finding | advocate (Opus) | PENDING |
| T2 | Implement whatever survives T1 | ui-builder | PENDING |
| T3 | Blind verify | orchestra-verifier | PENDING |
| T4 | Load the page, read the rendered node | conductor | PENDING |

## Conductor's pre-dispatch reading (to be attacked by T1)

- **I1 `GROUP_FILL` — CONFIRMED, wider than reported.** Two distinct idioms, not one:
  `cn(ROW_GROUP, "min-h-0 flex-1")` at 4 literal sites plus a file-local const in
  `system-settings-card.tsx:98` used twice; and `"flex min-h-0 flex-1 flex-col"` on
  `CardContent` at 3 sites. Sub-route files (`web-console/`, `at-terminal/`,
  `system-health-check/`) also carry the idiom but have NOT taken the canon pass and
  are out of scope.

- **I2 receipt `aria-hidden` — BELIEVED FALSE.** The critique claimed a screen reader
  gets no write confirmation. But `scheduled-operations-card.tsx:141` and `:177` both
  fire `toast.success`, and Sonner renders toasts inside its own `aria-live` region.
  Removing `aria-hidden` would be a REGRESSION: the strip's three layers all coexist
  in the DOM cross-faded by opacity, and `opacity-0` does not remove content from the
  accessibility tree, so AT would read "Saves automatically Saving Saved" as one
  permanent string. The genuine residual gap is smaller and different: the idle layer
  is ambient affordance text telling a sighted user this card has no Save button, and
  AT users never receive that.

- **I3 `{{detail}}` splice — CONFIRMED, two sites.**
  `scheduled-operations-card.tsx:108` falls back to `defaultValue: reason`, splicing a
  raw snake_case backend token into a translated sentence in all five locales.
  `system-settings-card.tsx:137` splices `error ?? ""` — which per
  `hooks/use-system-settings.ts:176` can be `json.detail` straight off the backend, or
  a hardcoded English string — into a localized sentence, and yields a dangling
  trailing space when null.

## Attempts (append-only)

### T1 — devil's advocate (Opus) — DONE

Adjudicated all three premises and overturned part of BOTH the critique's reading and
the conductor's.

- **C1 RE-SCOPED.** Idiom A (`GROUP_FILL`) upheld: six sites, one contract, and two
  independent authors had written the same rationale as a comment, which is the
  opposite of coincidence. Idiom B **OVERTURNED** — `"flex min-h-0 flex-1 flex-col"`
  is already `CONDITION_PANEL.CONTENT` (`shapes.ts:434`), byte-identical, and four
  sites already import it for that exact slot. A second export would have created the
  rival copy this module exists to prevent. Ruling: rename to a top-level `CARD_BODY`
  and point the four literals at it.
  Conductor also **mis-keyed** `sim-registry-card.tsx:427` — its loaded counterpart
  wears `SIM_LIST`, which already contains `min-h-0 flex-1`, so the skeleton was
  restating two of four classes and dropping the scroll cap. Skeleton-Mirror
  violation, not a `GROUP_FILL` site.
  Found three more file-local geometry constants the conductor missed: `SAVE_LAYER`,
  `LABEL_LINE`, `TZ_NOTICE` — and noted `SAVE_LAYER`'s own mirror
  (`SKELETON.REBOOT.RECEIPT`) is already in `shapes.ts` while the thing it mirrors is
  not.

- **C2 UPHELD.** The critique's finding is false and acting on it would regress.
  Traced every branch of the two save paths for a silent-success case: none exists,
  and the only silent path (a throw) skips `markSaved()` too, so there is no
  AT-vs-sighted asymmetry. Better citation than the conductor had:
  `components/ui/save-button.tsx:162-165` already documents this exact decision for
  the identical three-layer construction, and all three of its layers carry
  `aria-hidden` for the same reason. Per-layer `aria-hidden` does not rescue it
  either. Residual gap re-scoped to low value with a cheaper shape: `aria-describedby`
  at an `sr-only` span reusing the EXISTING `reboot.states.autosave` leaf — no new key
  in five packs, and the accessible text cannot drift from the visible one.

- **C3 RE-SCOPED.** Corrected the conductor's DESIGN.md citation: the Machine-Voice
  Rule is purely typographic and does not forbid this; the argument is State-Honesty.
  Site 1 **downgraded to a latent latch** — the backend's reason vocabulary is closed
  to three values and `no_schedule` is provably unreachable through the CGI
  (`settings.sh:216-219` rejects an empty day list first), so `defaultValue: reason`
  is dead code today. Fix as a one-line latch, not five locale-pack edits.
  Site 2 **upheld and worse than reported**: the dangling-space case is the PRIMARY
  path, not a side effect — the documented partial-envelope case leaves `error` null
  and `settings` undefined, so the user reads "The modem didn't answer. " which is
  factually false at HTTP 200.

- **ALSO FOUND (3).** (1) Deselecting the last day yields `no_days` at HTTP 200; the
  card fires the generic `save_failed` toast, DISCARDING the one sentence that says
  what to do, then paints a "lost contact" stale banner that is wrong — one click to
  reproduce. (2) The `SIM_LIST` skeleton drift above. (3) `ssh-password-card.tsx:229`
  renders raw `{error}` inside a `role="alert"` — untranslated backend text or one of
  two hardcoded English literals, announced assertively on a zh-TW device.

**Conductor's scoping call:** implement C1 (re-scoped), C2's cheap residual, and C3 at
ALL THREE sites — ALSO FOUND (3) is the same named defect on the same surface, so it
completes the user's item rather than widening it. ALSO FOUND (1) is a DIFFERENT
defect (wrong tone + discarded actionable detail) and changes user-visible error
behaviour; it is reported to the user, not silently folded in.

### T2 — ui-builder — DISPATCHED

Write set: `shapes.ts`, the four index cards, the five locale packs. Sequential (write
sets overlap heavily; no fan-out).

### T2 — ui-builder — DONE

All items implemented. Gates green. Two residuals self-reported: an `aria-describedby`
on a role-less div it flagged as possibly unexposed, and one byte-identical
`LABEL_LINE` literal it declined to touch because the ticket had not enumerated it.
Conductor fixed the latter inline (one line, below the dispatch gate).

### T3 — orchestra-verifier (blind) — FAIL, adjudicated

Returned FAIL on A, C, D. Conductor adjudicated each against evidence:

- **A (redesign) — REJECTED.** The verifier read `sim-registry-card.tsx:428`'s move to
  `SIM_LIST` as introducing a 153px void, measuring new-skeleton against OLD-skeleton.
  The contract's comparator is the LOADED list, which the verifier states it could not
  render. Measured directly in the real cell: baseline skeleton `max-height:none`;
  new skeleton `max-height:384px, overflow-y:auto`; loaded list `max-height:384px,
  overflow-y:auto`. New skeleton is now byte-identical to what it mirrors, so the
  change REMOVES a Skeleton-Mirror violation rather than adding a redesign.
  Pair height lock re-measured in the LOADED state at 1440px: Time & Units 611 =
  Scheduled Reboot 611; SSH Access 677 = Tracked SIMs 677.

- **C (a11y) — UPHELD, fixed.** Verifier's AX probe showed `aria-describedby` on a
  role-less `motion.div` is not exposed as an AX object at all; the ui-builder had
  independently flagged the same risk. Moved onto the `Switch`. Re-measured on the
  rendered node with the loaded state forced: `<button role="switch"
  id="scheduled-reboot" aria-describedby="reboot-autosave-hint">`, hint present,
  `sr-only`, `closest('[aria-hidden=true]') === null`, ids match.

- **D (machine text) — UPHELD, fixed.** `sim-registry-card.tsx:382` rendered
  `result.detail` as the ENTIRE toast body, so a non-English device got raw backend
  text with no translated sentence. Now the translated sentence is the toast and the
  detail rides the description slot, matching the SSH card's treatment.

- **Defect 1 (opacity wash) — HALF-REJECTED.** The verifier proposed
  `text-on-surface-variant`. That is wrong here: `NOTICE.FAILED` is
  `bg-destructive-container text-on-destructive-container`, so a surface-variant token
  would be "a fill role's ink with nothing under it" — the exact failure this module's
  own comment warns about. Opacity is the correct tool on a tonal fill. But the
  verifier was right that the VALUE was restated: `NOTICE.DETAIL` now composes
  `META_INK_ON_TONAL` (moved above `NOTICE` to clear the TDZ) instead of repeating
  `opacity-90`. Conductor's earlier call to keep them separate was wrong — both are
  "step back inherited ink on a tonal fill", one contract.

- **B residue — ADOPTED.** Verifier found call-site-to-call-site duplication the
  ticket had not asked about but which is the same defect class:
  `"w-full @2xl/card:w-auto"` x3 and `"flex justify-end px-1"` x2. Hoisted as
  `CONTROL_FILL` and `RECEIPT_ROW`. A literal sweep across the four index cards now
  returns ZERO restated geometry.

### T4 — conductor browser verification — DONE

Loaded state forced via a fetch shim (dev server on :3019 is another session's; not
stopped). Measurements above. Gates after all fixes: `tsc --noEmit` exit 0;
`i18n:check` 0 errors, 100% (3361/3361); `next build` compiled, NO CSS optimizer
warnings (re-run after the docs edit, since Tailwind scans docs prose).

**Outcome:** the critique's item 2 was a false finding and is now documented in
`docs/reference/system-settings.md` so a future pass does not re-report it. One live
defect found and NOT fixed (reported to the user): the `no_days` path fires a generic
toast that discards the backend's actionable sentence, then paints a false
"lost contact" banner.

---

# Addendum — /monitoring/tailscale docs + integration (2026-09-06)

Follows the run recorded above, which closed at `0bd51d2` unmerged by design.

**Critique pass.** The `/impeccable critique` agent died mid-run on an Opus session
limit, but its edits were already complete on disk, not half-applied — reviewed file
by file, verified, and committed as `58b5975`. Its one genuinely new finding:
`TABLE.ROW_HEIGHT` was pinned at 44px while every row rendered 52 (a 20px name over a
16px DNS name inside 16px of cell padding), so the pin was inert and the
Skeleton-Mirror Rule was failing with nothing looking wrong.

**Integration.** `development` had advanced with the watchdog refit, which appends a
sibling top-level block to the same five `common.json` packs. Resolved semantically —
a real three-way merge at the JSON level off `:1:`/`:2:`/`:3:`, after confirming the
packs serialize byte-exactly as `JSON.stringify(obj, null, 2)` with NO trailing
newline. Zero real key collisions; both blocks survive in all five. Merged at
`c8eb7bb`.

**Docs.** `44c1a97` — the DESIGN.md delta row, `docs/reference/tailscale.md` (new), and
one CLAUDE.md routing row. The row above it claims watchdog was "the last unmigrated
/monitoring/ surface"; it was not, and the new row says so. Tailscale was missed for
the same reason it went unmigrated: no feature doc and no routing row, so nothing
pointed at it. Both gaps now closed.

**Verified at `e91806f` rather than asserted:** the old surface had zero
`useTranslation` calls, and `install-log-viewer.tsx` was the only component file in the
product hardcoding raw Tailwind palette colours.

**Open:** `RELEASE_NOTES.md`'s Unreleased block still has no bullet for either the
Alerts or the Tailscale refit. Left deliberately — out of the scope the user set.

# Run: System Logs follow-ups — border-current/45 contrast sweep (2026-09-06)

Baseline: 5e5fb1c. Mode: Full. LEAD = Opus 5.
Scope as spun out by the user: watchdog + alerts only. network-events deliberately NOT included.

## Tasks

| ID | Task | State |
|----|------|-------|
| T2b-1 | Verify the recorded 2.13:1 claim independently | DONE |
| T2b-2 | watchdog/shapes.ts:179 + :282 -> clearing alpha | DONE |
| T2b-3 | alerts/shapes.ts:327 -> clearing alpha | DONE |
| T2b-4 | DESIGN.md Migration Deltas row | DONE |
| T2b-5 | Blind verification | PASS_WITH_NOTES, notes closed |

## Measurement (two independent methods, agree within 0.04)

LEAD offline: OKLCH -> sRGB, alpha composited in gamma sRGB.
LEAD in-browser: canvas rasterisation, so the BROWSER does conversion + compositing.
orchestra-verifier reproduced both with its own script: warning@45 light = 2.131.

              light45  light65  dark45  dark65
  warning       2.14     3.19     2.63    3.77
  destructive   2.34     3.57     3.30    5.64
  success       2.21     3.41     3.26    5.07
  primary       2.32     3.62     2.79    4.20

45% fails 3:1 on SIX of the EIGHT reachable (role, theme) pairs — all four in light, plus
warning and primary in dark. 65% clears all eight; binding figure light/warning at 3.19.

Chose 65% for parity with the corrected logs copy; a third value would recreate the drift.

## Reachability (traced, not assumed)

  watchdog RUNG:181  -> primary-container ONLY (gated on `running`)
  watchdog ROW:285   -> destructive / warning / success (presentEvent TONAL_FILL)
  alerts ROW:328     -> success / destructive ONLY (ROW_TONE_IS_TONAL: sent, failed)

Union = all four roles. success-container and primary-container are reachable here and were
NOT covered by the logs rationale, which measured only warning and destructive.

## Gates

tsc clean. eslint exit 0. i18n:check 0 errors / 100% parity (no strings changed).
next build NOT run: another chat's dev server owns .next. No new utility-class literal was
introduced (both /45 and /65 already existed in source), so the Tailwind prose hazard is not in play.
Browser: border-current/65 confirmed to COMPILE to a real rule; verifier further proved twMerge
strips `border-tag-neutral-border` so the fix is not shadowed by tag.tsx's earlier-emitted token.
The chip was never seen rendered — no device backend, so both routes sit in their 404 condition state.

## Verifier notes, all closed

1. Comments named containers their site cannot reach (watchdog RUNG cited warning; alerts cited
   warning). FIXED — each comment now names its own reachable pair.
2. DESIGN.md row miscounted ("four of the six") and omitted dark primary. FIXED — "six of the eight".
3. Four connection-quality files showed as modified mid-verification. Re-checked: clean. They were a
   PARALLEL SESSION mid-edit in this same checkout, not part of this change.

## Hazards logged

- MSYS `sed -i` on a CRLF file strips every CR in the working copy. Git normalizes so the committed
  diff stayed 1 line, but the working copy needed add + rm + checkout to repair. Use Edit, not sed -i.
- `.orchestra/ledger.md` is TRACKED and holds prior run history. A `cat >` clobbered 780 lines;
  recovered with git checkout. ALWAYS append.
- Another Claude session is actively writing in this same checkout and owns the dev server on 3019.
  Do not `git add -A` / `git commit -a` here.

STATUS: not committed. No approval requested yet.

## T2b-6 — network-events folded in (delegated, 2026-09-06)

Dispatched to a single sonnet worker with the spec + measurements inlined; no orchestration
(one constant + one doc row, decision already made). Worker returned DONE_WITH_CONCERNS.

Result: components/monitoring/network-events/shapes.ts:124 -> border-current/65.
DESIGN.md row closed: Delta cell struck, Status Open -> **Landed** 2026-09-06, trailing
sentence now reads "all five copies now match at 65%".

ALL FIVE META_CHIP_ON_TONAL copies are now /65. Zero border-current/45 remain in components/.

LEAD corrections applied after the worker:
  1. Worker CONVERTED network-events/shapes.ts to LF despite being told to use Edit and not
     sed -i. Its three siblings were still CRLF. Repaired via add + rm + checkout. The tell was
     the git "LF will be replaced by CRLF" warning firing on that one file only.
  2. Its comment ran ~105 cols on one line against the file's ~80 wrap. Reflowed to 3 lines and
     reworded to match the sibling copies.
  3. Its report attributed the pre-existing DESIGN.md row and the alerts/watchdog edits to
     "the other Claude session". Those were THIS session's earlier work. Harmless - it correctly
     left them alone - but its numstat reasoning was built on a false premise.

Gates after LEAD fixes: tsc clean, eslint clean on all five sites, i18n:check 0 errors.
next build still NOT run (another session owns .next).

STATUS: complete, NOT committed.

---

## Run: software-update design-canon re-authoring (2026-09-07)

- **Worktree:** `.claude/worktrees/wt-software-update-refit`, branch `worktree-wt-software-update-refit`
- **Baseline commit:** `1a33d26` (`merge-base HEAD development == HEAD` verified)
- **Spec:** scratchpad `software-update-refit-spec.md` (APPROVED, phases 1-3 complete)
- **Mode:** Full (Agent tool + real shell). No Codex.
- **Seats:** LEAD = Opus (conductor). Workers = `ui-builder` (opus-pinned, NO model override),
  `docs-writer`, devil's advocate on Opus.
- **Gates skipped by Lite Path (pre-triaged):** modem-investigator, installer-safety-auditor,
  busybox-portability-checker.

### Tasks

| # | Task | Write set | Status |
|---|---|---|---|
| T0 | Move monitoring/software-update -> system-settings/software-update; page import; hook types | components/, app/, hooks/ | PENDING |
| T1 | Contract: shapes.ts + derive.ts + en software_update locale subtree | 3 files | PENDING |
| T2a | page-header.tsx, status-band.tsx, card-skeleton.tsx | 3 files | PENDING |
| T2b | update-card.tsx, step-ladder.tsx | 2 files | PENDING |
| T2c | release-notes-card.tsx, update-preferences-card.tsx, version-management-card.tsx | 3 files | PENDING |
| T3 | Shell software-update.tsx + wiring reconcile | 1 file | PENDING |
| T4 | Translations: zh-CN, zh-TW, it, id | 4 locale files | PENDING |
| T5 | Gates: tsc / eslint / i18n:check / next build / browser render | - | PENDING |
| T6 | Devil's advocate against the finished diff | read-only | PENDING |
| T7 | docs-writer: docs/reference/software-update.md + 1 CLAUDE.md row | 2 files | PENDING |

### Attempts (append-only)

| T0 | Move + page import + hook types | conductor | DONE |
| T1 | shapes.ts + derive.ts + en locale subtree (133 keys) | ui-builder | DONE |
| T2a | page-header / status-band / card-skeleton | ui-builder | DONE_WITH_CONCERNS (2 missing keys, 3 canon flags — all resolved) |
| T2b | update-card / step-ladder | ui-builder | DONE |
| T2c | release-notes / preferences / versions + hook save signatures | ui-builder | DONE_WITH_CONCERNS (2 missing keys, 3 shape gaps — all resolved) |
| T3 | Shell wiring + staged-install confirm | conductor | DONE |
| T4 | Translations zh-CN / zh-TW / it / id | general-purpose | DONE (i18n:check 0 errors) |
| T5 | Gates: tsc / eslint / i18n:check / next build / browser | conductor | DONE |
| T6 | Devil's advocate | opus, read-only | **FAIL** — 2 blockers, 3 majors, 13 minors |
| T6b | Fix round against the findings list | ui-builder | DONE_WITH_CONCERNS |
| T6c | Anchor-card residue (title/desc/chip by failure kind) | ui-builder | DONE |
| T6d | Ladder keeps download+verify done on a staged install failure | conductor | DONE |
| T7 | docs/reference/software-update.md + 1 CLAUDE.md row | docs-writer | DONE |

### Outcome

The adversarial pass earned its keep: it found that a failed install repainted the page as
"Ready to install" with no notice at all (the `staged` guard sat above the failure guard), and
that a failed `installVersion` stranded the page in a spinning `downloading` forever. Both were
regressions introduced by routing the surface through one derived union without carrying the
hook's error provenance with it. Fixed by giving the hook an `errorKind` and reordering
`resolveView`; the three failure kinds now drive copy and glyph in four slots that previously
all claimed GitHub was unreachable.

Gates, final: `tsc` clean, `eslint` clean on every touched path, `i18n:check` 0 errors,
`next build` exit 0 with no CSS-optimizer warnings. All ten `UpdateView` members plus the
interrupted banner and both notes states rendered in a browser at desktop and 375px in both
themes, against a fetch-shimmed CGI; the reboot handoff was driven end to end.

Not merged. The parent session owns merge and close-out.


---

## Run — Console surfaces adoption pass (AT Terminal + Web Console)

**Date:** 2026-09-07
**Worktree:** `.claude/worktrees/console-surfaces-adoption`
**Branch:** `worktree-console-surfaces-adoption`
**Baseline commit:** f10172f13e214be38b59ddc0aebbf797ee492444 (clean tree)
**Mode:** Full (Agent tool + real shell). LEAD seat: Opus 5 (FRONTIER). Codex not probed / not routed.
**Scope:** the last two un-migrated `/system-settings` sub-routes. 24 approved changes.
**Hard exclusion:** the eight Signal Storm modules. Its launch seam inside the AT Terminal card
is a preserved five-point contract, not a redesign target.

### Tasks

| ID | Task | Write set | Status |
|---|---|---|---|
| T1 | AT Terminal: page head, real card header, log-view transcript, gate banner, input bar, popover groups, motion, shapes+derive | components/system-settings/at-terminal/**, app/system-settings/at-terminal/page.tsx, constants/at-commands.ts | PENDING |
| T2 | Web Console: page head, header status chip, themed xterm, honest failure states, tap targets, flex height, shapes+derive | components/system-settings/web-console/**, app/system-settings/web-console/page.tsx, hooks/use-web-console.ts | PENDING |
| T3 | i18n: merge both routes' key maps into all five locale packs, CRLF preserved | 5 locale files | PENDING |
| T4 | Gates: eslint / tsc / i18n:check / next build, incl. optimizer warnings | - | PENDING |
| T5 | Blind verification against the original brief | read-only | PENDING |
| T6 | docs/reference/at-terminal.md + web-console.md + 2 CLAUDE.md routing rows | 3 files | PENDING |

### Attempts (append-only)


**2026-09-07 20:12 — conductor handover.** The first orchestrator ended its turn with two
`ui-builder` workers unreported. Those workers were NOT dead: at 20:09 an AT Terminal worker was
still actively writing into this worktree (`constants/at-commands.ts` rewritten with a category
axis, plus new `at-terminal/derive.ts`, `shapes.ts`, `transcript-row.tsx`). No web-console file
had moved in 14 minutes, so that half of the original wave was dead or never dispatched.

| Attempt | Task | Seat | Result |
|---|---|---|---|
| A1 | T1 (AT Terminal) | ui-builder / Opus, GHOST from the prior session | IN FLIGHT, unowned — adopt the diff, grade it, do not dispatch over it |
| A2 | T2 (Web Console) | ui-builder / Opus | dispatched 20:12, write set disjoint from the ghost's |

Write-set fence for A2: `components/system-settings/web-console/**`, `hooks/use-web-console.ts`,
`app/system-settings/web-console/page.tsx`. Explicitly barred from `at-terminal/**`,
`constants/at-commands.ts`, the family `shapes.ts`/`derive.ts`/`condition-block.tsx`, and all of
`public/locales/`. Both routes emit their English key subtree to a scratchpad JSON instead of
editing the packs, so T3 merges all five locales in one pass with no collision.
