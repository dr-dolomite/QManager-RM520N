> Frozen 2026-09-10. Runs now live in `.orchestra/runs/<date>-<slug>.md` (see the `qm-orchestrate` skill). Do not append here.

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

# Orchestration Ledger — Issue #9 regression audit (1970 clock-step reboot loop)
BASELINE: f10172f13e214be38b59ddc0aebbf797ee492444 | working tree clean | 2026-09-07
MODE: Full (Agent tool + real shell). Codex CLI: NOT INSTALLED — no Codex seats, no consent needed.
LEAD SEAT: Opus 5 (FRONTIER).
SURFACE: live RM520N-GL reachable (port 22 open); RG501Q-EU OFFLINE (port 22 closed).
USER CONSTRAINT: auditor MUST be an Opus agent.
STAKES: field reports include a user who RE-FLASHED the modem to escape the loop.
        Recoverability is in scope, not just "does it fire".

## Plan
1. A1 — Opus auditor: scheduled-reboot fire path + fire-guard correctness (core bug). FRONTIER.
2. A2 — Opus auditor: blast radius — other OnCalendar timers, watchcat wants-link,
        rc.unslung/opt.mount, recoverability, regressions from the patches. FRONTIER.
3. D1 — modem-investigator: live read-only probe of on-device timer/unit state. (pins own model)
4. V1 — orchestra-verifier: blind second read, issue text verbatim, no auditor reasoning. FRONTIER.
5. Conductor: synthesise, gate with user before any code change.

## Routing
A1 → FRONTIER → Agent(general-purpose, model=opus) — adversarial reasoning about a clock-jump race; user mandated Opus.
A2 → FRONTIER → Agent(general-purpose, model=opus) — same class, disjoint surface; runs parallel.
D1 → project agent modem-investigator — pins its own model; NEVER pass a model override.
V1 → FRONTIER → orchestra-verifier (model: inherit = Opus) — blind, same model / independent context.

## Tasks
| id | state | owned paths | notes |
|----|-------|-------------|-------|
| A1 | PENDING | read-only | writes report to .orchestra/scratch/issue9-A1.md |
| A2 | PENDING | read-only | writes report to .orchestra/scratch/issue9-A2.md |
| D1 | PENDING | read-only (device) | no writes, no reboots, no service restarts |
| V1 | PENDING | read-only | dispatched after A1/A2 land |

## Decisions
- No code changes in this run without an explicit user gate (CLAUDE.md change workflow).
- All three dispatches are READ-ONLY; write sets are empty except each agent's own scratch file
  under .orchestra/scratch/ (gitignored) — provably disjoint.
- Device probe is strictly read-only: CLAUDE.md forbids reboot / CFUN / service restart / config
  write on a live device without a user yes.

## Attempts
| A1 | 1 | Agent(general-purpose, model=opus) | rev1 | DISPATCHED | — | .orchestra/scratch/issue9-A1.md | 2026-09-07 |
| A2 | 1 | Agent(general-purpose, model=opus) | rev1 | DISPATCHED | — | .orchestra/scratch/issue9-A2.md | 2026-09-07 |
| D1 | 1 | modem-investigator (pins own model) | rev1 | DISPATCHED | live RM520N-GL, read-only | .orchestra/scratch/issue9-D1.md | 2026-09-07 |
| A1 | 1 | Agent(general-purpose, model=opus) | rev1 | REPORTED(DONE_WITH_CONCERNS) -> ACCEPTED | verdict FIXED_WITH_GAPS; 2 Critical, 3 Major, 3 Minor | .orchestra/scratch/issue9-A1.md | 2026-09-07 |
| V1 | 1 | orchestra-verifier (inherit=Opus) | rev1 | DISPATCHED | blind; fenced from A1/A2 reports | .orchestra/scratch/issue9-V1.md | 2026-09-07 |
| A2 | 1 | Agent(general-purpose, model=opus) | rev1 | REPORTED(DONE_WITH_CONCERNS) -> ACCEPTED | verdict FIXED_WITH_GAPS; 3 Critical, 4 Major, 4 Minor | .orchestra/scratch/issue9-A2.md | 2026-09-07 |

### Note on A2's tree concern
A2 observed `?? public/__proposal_preview.html` mid-run. Re-checked at conductor level after A2
reported: file ABSENT, `git status --porcelain` shows only ` M .orchestra/ledger.md` (the
conductor's own append). Transient, not residue. ` M ledger.md` is this run's own bookkeeping.

### Open deterministic check (outranks any model verdict)
A2 Critical#2 claims `StartLimitIntervalSec=` sits in `[Service]` across 6 units, where systemd
>=229 ignores it, collapsing to the 10s/5 default and (with RestartSec=5) an unbounded restart
loop. This is settleable on the live device in one read-only command:
  systemctl show <unit> -p StartLimitIntervalSec -p StartLimitBurst -p RestartUSec
Effective values of 10s/5 that disagree with the shipped unit file PROVE the claim.
Routed to D1 as a follow-up rather than run by the conductor, to avoid a concurrent-SSH collision.
| D1 | 1 | modem-investigator | rev1 | REPORTED(DONE_WITH_CONCERNS) -> ACCEPTED | md5 match device==repo; guard replay; rc.unslung 203/EXEC live | .orchestra/scratch/issue9-D1.md | 2026-09-07 |

### CONDUCTOR DETERMINISTIC CHECKS (Layer 1 — authoritative, outrank any model verdict)
Run by the conductor over Posh-SSH, strictly read-only. SendMessage is disabled this session, so
the D1 follow-ups were executed here rather than by resuming the agent.

C-1 START LIMITS — A2's INFERRED Critical is now PROVEN on hardware.
  All 6 units declare `StartLimitIntervalSec=3600` INSIDE `[Service]`; systemd's effective
  value is 10s (the default) for every one of them:
    watchcat / ping / poller / discord / sms-forward / dpi
    declared: StartLimitIntervalSec=3600 (in [Service])  effective: StartLimitIntervalUSec=10s
    RestartUSec 5s (10s for discord), StartLimitBurst=5, Restart=on-failure
  => directive SILENTLY DROPPED. Burst of 5 unreachable within 10s at RestartSec=5s,
     so the rate limiter never trips: unbounded restart loop. Status: CONFIRMED, not inferred.

C-2 GUARD REPLAY on the DEPLOYED library (pure funcs, worker never invoked; schedule 04:00 daily):
    year=2026 uptime=26s: 03:49 DENY | 03:50 ALLOW | 03:55 ALLOW | 04:00 ALLOW | 04:02 ALLOW
                          04:05 ALLOW | 04:10 ALLOW | 04:11 DENY | 04:20 DENY | 15:20 DENY
    year=1970 uptime=23s  -> DENY   (pre-step misfire correctly denied)
    year=2026 uptime=400s -> ALLOW  at an UNRELATED 15:20  <== A1 Critical#2 CONFIRMED
    year=1970 uptime=99999-> DENY   (no-SIM device: schedule never fires, ever)
  => A1 Critical#1 and Critical#2 both CONFIRMED against the deployed byte-identical guard.

C-3 ATTRIBUTION CORRECTION — D1 over-claimed; conductor downgrades two of its statements.
  (i) reboot_history.json cause vocabulary is `watchdog | user | unplanned` only
      (alert_engine.sh:236,257). `qmanager_scheduled_reboot` calls `reboot` at :82 WITHOUT
      writing a crash.log marker, unlike the UI path (system/reboot.sh:44). So a scheduled
      reboot is recorded as "unplanned" — indistinguishable from a crash. The 2026-09-03
      cluster (10:54:11, 10:56:08, 10:57:05, 10:58:07 +0800; deltas 117s/57s/62s) has the
      SHAPE of a loop but is NOT attributable to the timer from this data. Downgrade to
      corroborating, not probative.
  (ii) EVERY file under /usr/lib/qmanager and /usr/bin has mtime 2026-09-07 18:59 (today's
      install of v0.1.14-draft). D1's "guard already deployed on 2026-09-03" is NOT supported
      by on-device evidence. Furthermore the device has NOT booted since that install
      (uptime continuous from 04:02), so NO boot-behaviour evidence exists for the current
      build. The probative evidence is C-2 (direct replay of the deployed guard), not history.
  NEW FINDING (conductor): scheduled reboots are misclassified as "unplanned" in reboot_history
      and crash.log — they will read as crashes to the alert engine and the UI.
| V1 | 1 | orchestra-verifier (inherit=Opus) | rev1 | REPORTED(FAIL) -> ACCEPTED | independent FAIL; same two paths; +path (e) second clock step | (chat report) | 2026-09-07 |

### TICKET DEFECT — disclosed, does not overturn the result
`gh issue view 9 --comments` writes ONLY the comments; the issue BODY was never in
.orchestra/scratch/issue9-verbatim.md. A1/A2/V1 therefore read comments + the core claim I
inlined in each ticket, not the full body. Conclusions stand because (a) each ticket inlined the
mechanism and the specific sub-claims verbatim, and (b) all three converged with the conductor's
own hardware replay (C-2), which is independent of the issue text entirely. Recorded as a
conductor error, not papered over. Fix for future runs: `gh issue view N --json body,comments`.

### CONVERGENCE
Four independent readings — A1 (opus), A2 (opus), V1 (opus, blind), conductor hardware replay —
agree on both loop paths. V1 adds path (e): a SECOND/non-NITZ clock step near the schedule
minute also lands in the tolerance window. Independence axis: same model family, independent
contexts + one real-hardware measurement. Disclosed as such, not as a cross-family second opinion.

### TREE STATE AT CLOSE
` M .claude/agent-memory/modem-investigator/*` (2 files) — the agent's own memory upkeep, real
findings (jq-before-opt.mount; /etc/qmanager now 0755 not 0777). Not residue; left uncommitted
for the user. ` M .orchestra/ledger.md` — this file. HEAD unchanged at f10172f. NO source file
was modified by this run: the audit was read-only end to end.

### FINAL VERDICT (conductor)
STILL VULNERABLE. Issue #9 is NOT fixed at HEAD. The patch closed the ordinary-boot misfire and
left two live loop paths, one bounded and one unbounded, plus an unrelated third Critical
(start-limit placement) proven on hardware. 1 of the issue's 3 suggested fixes is fully shipped.
No code change made — remediation gated on the user per CLAUDE.md's change workflow.

---

## RUN 2026-09-07 — About / Support / Donate design-language adoption pass

- **Baseline commit:** f10172f13e214be38b59ddc0aebbf797ee492444 (`development`, clean tree)
- **Worktree:** `.claude/worktrees/about-support-donate` · branch `wt/about-support-donate`
- **Tier:** 2, frontend-only Lite Path. Design approved by the user at the gate before this run.
- **Mode:** Full orchestration (Agent tool + real shell). Conductor does not write production code.

| # | Task | Owner | Write set | State |
|---|------|-------|-----------|-------|
| R1 | Recon: shapes/motion/primitives conventions | orchestra-scout (sonnet) | none (read-only) | DONE |
| R2 | Recon: i18n conventions + CRLF recipe | orchestra-scout (sonnet) | none (read-only) | PENDING |
| B1 | About Device re-author (shapes/derive/components/hook/types) | ui-builder | components/about-device/**, app/about-device/**, hooks/use-about-device.ts, types/about-device.ts | PENDING |
| B2 | Support + Donate re-author (shared donate links) | ui-builder | components/support/**, components/donate-dialog.tsx | PENDING |
| B3 | i18n keying across 5 locale packs | orchestra-worker (sonnet) | public/locales/** | PENDING |
| V1 | Blind verification | orchestra-verifier | none | PENDING |
| D1 | Reference doc + CLAUDE.md routing rows | docs-writer | docs/reference/**, CLAUDE.md | PENDING |


### V1 ADDENDUM (second report) + auditor disagreement RESOLVED
V1 promotes one item out of "Not checked": `install_rm520n.sh:3678-3688` re-arms the timer from
config on every install/OTA, so an affected device carries Path A/C ACROSS the upgrade.
This CONTRADICTS A2's framing ("OTA actively re-arms/tears down from config so upgrading devices
are healed"). Both describe the same mechanism; V1's reading is the correct one for the user's
question: re-arming from an unchanged config re-arms the VULNERABILITY. Conductor adopts V1.
Consequence: "upgrade to the fixed release" is NOT a field remedy on its own — the fix must
change the guard, not merely ship a new build. Belongs in RELEASE_NOTES.
Also: sudoers.d/qmanager:64 confirms qmanager_scheduled_reboot_arm is NOPASSWD for www-data, so
the UI teardown path is genuinely wired — just unreachable inside a ~29s boot window.

### USER GATE — ANSWERED 2026-09-07
Scope: **EVERYTHING FOUND** (loop paths + start limits + rc.unslung/opt.mount incl. field reach +
watchdog wants-symlink restore-from-config + scheduled-reboot cause marking + bare-mv OTA aborts).
Device policy: **ASK BEFORE EACH REBOOT** — deploy + read-only replay free; every reboot or
service restart on the live RM520N-GL needs an explicit yes first.
Run transitions from AUDIT (read-only, complete) to REMEDIATION. Next: read
docs/reference/change-workflow.md in full per CLAUDE.md, then Phase 1 Triage.

### RUN CLOSED 2026-09-07 — AUDIT COMPLETE, REMEDIATION DEFERRED BY USER
User elected to run the (largest-blast-radius) remediation in a FRESH orchestrate session rather
than continue in this one. Correct call: the fix touches install_rm520n.sh, 6 systemd units, the
guard library and 4 workers, and this session is carrying ~full audit context.

Phase 1 Triage was NOT entered. `docs/reference/change-workflow.md` was opened but the fresh
session must read it in full itself before its first `**[Phase 1 — Triage]**` header.

HANDOFF: .orchestra/scratch/issue9-handoff.md — 19 ranked findings with file:line evidence, the
timer inventory, the two user decisions already taken (scope = EVERYTHING FOUND; device policy =
ASK BEFORE EACH REBOOT), device state, and the suggested fix direction (persisted fire-stamp +
gate on time-since-clock-sane rather than uptime + a short-uptime circuit breaker).

TREE AT CLOSE: HEAD f10172f (unchanged). Modified, uncommitted, none of it source:
  M .orchestra/ledger.md                                  (this journal)
  M .claude/agent-memory/modem-investigator/*  (2 files)   (agent memory upkeep, real findings)
Untracked: .orchestra/scratch/issue9-{A1,A2,D1,handoff,verbatim}.md (gitignored).
No production file was touched. Memories written: 3 (issue-9 status, StartLimit trap, gh flag trap).

---

## RUN 2026-09-07 — Issue #9 REMEDIATION (1970 clock-step reboot loop)

- **Baseline commit:** f10172f13e214be38b59ddc0aebbf797ee492444 (`development`)
- **Baseline tree:** M .orchestra/ledger.md, M .claude/agent-memory/modem-investigator/{MEMORY.md,etc_qmanager_is_0777_www_data_writable.md} — no source file modified
- **Mode:** Full orchestration (Agent tool + real shell). Conductor = Opus 5 (FRONTIER, LEAD seat). Codex not probed — project agents pin their own models; no Codex seat needed.
- **Predecessor:** audit run closed same day; handoff `.orchestra/scratch/issue9-handoff.md` (19 findings).
- **User decisions carried in (do NOT re-ask):** scope = EVERYTHING FOUND; device policy = ASK BEFORE EACH REBOOT.
- **Tier:** 4 (installer / systemd units / sudoers-adjacent / OTA path). Full 6-phase flow, no Lite Path.

### Conductor's own reading (before any dispatch)
Read `schedule_timer.sh` in full. Confirms findings 1, 2, 13, 14, 15 first-hand:
- `_qm_timer_fire_allowed` = `sane AND (settled OR matches)`. The `settled` leg is an OR-ESCAPE:
  once uptime >= 300 it allows a fire at ANY time of day. That is finding 2's unbounded loop.
- `_qm_now_matches_hhmm` fail-open confirmed: on awk failure both operands are empty NAMES inside
  `$(( ))`, POSIX arithmetic resolves an unset name to 0, so `d=0` and the tolerance test passes.
- `_qm_validate_hhmm` shape `[0-2][0-9]` accepts hours 24-29 — confirmed line 47.
- Header cites `docs/plans/issue-9-clock-step-timer-fix.md`, deleted in 4a61d7f — confirmed.

### Corrections to the handoff (found by conductor, pre-dispatch)
1. Finding 18 overstates. `qmanager_auto_update:77-82` IS guarded. What it lacks is a LIB-MISSING
   FALLBACK: `[ -f ... ] && . ...` then `if command -v` means a failed load silently proceeds
   UNGUARDED. Same shape in `qmanager_scenario_schedule:54-56` and `qmanager_tower_schedule:49-50`.
   The defect is real; the description "falls through UNGUARDED" is only true on lib-load failure.
2. `qmanager-auto-update.timer` carries **RandomizedDelaySec=3h** — it genuinely has NO single
   schedule minute. Any fix requiring a schedule-minute match CANNOT apply to auto-update.
3. Finding 3 has a 7th site the handoff missed: `install_rm520n.sh:3937-3938`
   (StartLimitIntervalSec=60 / Burst=40, heredoc-written unit) — to be confirmed by census.

### Conductor's proposed fix architecture (to be attacked before it is planned)
The guard asks "did this fire at a plausible TIME?" — a heuristic. Replace with two facts:
- **(A) Persisted occurrence-key fire-stamp.** Before any side effect, stamp the occurrence the
  fire belongs to; refuse a repeat of a stamped occurrence. Key = `YYYY-MM-DD HH:MM` (schedule
  minute) for the fixed-time timers, `YYYY-MM-DD` for auto-update. Root-owned persistent store.
  Kills path A (tolerance re-entry) and path E (second clock step) outright.
- **(B) Make the schedule-minute match REQUIRED, and DELETE the `boot_settled` leg** for the three
  fixed-time workers: `sane AND matches AND not-already-stamped`. A legitimate systemd fire always
  matches by construction. Kills path B (finding 2) outright — a misfire at 15:20 for an 04:00
  schedule is denied regardless of uptime. This makes the handoff's "time-since-clock-sane marker"
  UNNECESSARY, removing a proposed coupling to the poller.
- **(C) auto-update** cannot use (B) (RandomizedDelaySec=3h). It gets (A) alone at day granularity:
  bounded to one fire per calendar day => cannot loop.
- **Store location:** NOT `/etc/qmanager` — it is www-data-owned 0777, so nothing root-pinned
  survives there and a plain `>` is symlink-redirectable. Use a root-owned sibling matching the
  established precedent (`/etc/qmanager.env`, `/etc/qmanager-secrets`, `/etc/qmanager-backups`).
  New installed artifact => installer/uninstall/OTA lockstep => installer-safety-auditor is a
  BLOCKING Phase 1 gate.

### Phase 1 gate routing (by competency, not by tier)
| Gate | Fires? | Why |
|---|---|---|
| `installer-safety-auditor` | YES — blocking | New persistent artifact, 6+ unit edits, OTA field-reach, uninstall lockstep |
| devil's advocate (Opus) | YES — mandatory, never trimmed | Attack the (A)+(B)+(C) design before it is planned |
| census scout (Sonnet) | YES | Legwork: exact file:line for the 12 non-guard findings. A list, not a judgment |
| `modem-investigator` | NO | Change has no modem-state surface. Conductor does the cheap read-only probe himself first, per "run it before you dispatch" |
| `busybox-portability-checker` | Phase 5 only | Dispatch for residue AFTER conductor runs the changed scripts on device |

| # | Task | Class | Owner | Write set | State |
|---|------|-------|-------|-----------|-------|
| G1 | Installer/systemd/OTA safety gate on proposed design | judgment | installer-safety-auditor (pinned) | none (read-only) | PENDING |
| G2 | Devil's advocate vs the (A)+(B)+(C) architecture | judgment | general-purpose (opus) | none (read-only) | PENDING |
| G3 | Census: file:line for findings 3,6,7,8,9,10,11,12,16,17,18,19 | list | general-purpose (sonnet) | none (read-only) | PENDING |
| P0 | Conductor device probe: reachability + unit state, read-only | list | conductor | none | PENDING |

### P0 — CONDUCTOR DEVICE PROBE (read-only) — ACCEPTED. MAJOR NEW FINDING.
RM520N-GL (serial 61368cd2, v0.1.14-draft) reachable. RG501Q-EU OFFLINE (ping fail) — unchanged
from the audit; no cross-device diff possible this run.

**Device did NOT loop, and the reason is an ACCIDENT — this is the field bug's real mechanism.**

Live state: booted 04:02:27, `qmanager-scheduled-reboot.timer` LAST fired 04:02:53 (uptime 26s) —
i.e. the boot-window misfire happened. The worker logged
`Scheduled reboot skipped: fire outside schedule window` and did NOT reboot. But replaying the
DEPLOYED guard proves it should have ALLOWED: `now=04:02 uptime=26 sched=04:00 -> ALLOW`.

Resolved the contradiction by measuring systemd monotonic timestamps:
| Event | Monotonic |
|---|---|
| `timers.target` active | 5,997,359 us  (6.0 s) |
| `qmanager-scheduled-reboot.service` ExecMainStart | 26,903,671 us (26.9 s) |
| `opt.mount` active | 30,226,214 us (30.2 s) |

`jq` is an ENTWARE binary at `/opt/bin/jq` (confirmed; `/opt` is a separate ubi2_0 mount). The
worker runs at 26.9s; `/opt` mounts at 30.2s. So at fire time **jq did not exist**, so
`qm_config_get settings sched_reboot_time` returned its empty default, so the guard was called as
`_qm_timer_fire_allowed ""` — and with no schedule minute the tolerance leg cannot engage, so it
denied. Verified directly: guard with `sched=""`, uptime 26, year 2026 -> **DENY**.

CONSEQUENCES (these change the plan):
1. **The protection is a 3.3-second RACE, not a guard.** Whenever `opt.mount` wins that race (faster
   boot, different SIM registration timing, another device, an OTA that reorders units), the config
   read SUCCEEDS, `sched_time` becomes "04:00", the tolerance leg engages, and Path A goes live ->
   reboot loop. This explains the field pattern precisely: some devices loop, some do not, and it
   presents to the owner as "the hardware suddenly broke".
2. **No part of the fix may depend on `jq` or `/opt`.** A fire-stamp written or read through jq
   silently no-ops in exactly the boot window it exists to defend. The stamp store and its
   reader/writer must use BusyBox-only primitives. HARD CONSTRAINT on the design.
3. Design (B) (match REQUIRED) is reinforced, not broken: in the boot window the config read fails
   -> no schedule minute -> DENY (fail-closed); at the legitimate fire `/opt` is mounted -> match ->
   ALLOW. But the dependency must be made EXPLICIT and intentional rather than accidental.
4. Do NOT "fix" this by ordering the timers After=opt.mount — that would make jq available in the
   boot window and ARM Path A. Counter-intuitive, and worth stating in the plan so nobody does it.
5. `rc.unslung.service` observed `failed` / exit-code (finding 8 reproduced on this boot).
6. `/etc/qmanager` is www-data:www-data 0755 here (not 0777) but still www-data-OWNED, so the
   root-pinned-state objection stands; root-owned siblings `/etc/qmanager-secrets` (0700) and
   `/etc/qmanager-backups` (0700) confirm the precedent for the stamp store.
7. Config lives at `/etc/qmanager/qmanager.conf` (JSON, read via jq) — NOT `config.json`.

STARTLIMIT (finding 3) REPRODUCED on hardware: all six units report effective
`StartLimitIntervalUSec=10s`, `StartLimitBurst=5` despite declaring 3600 — confirming the
`[Service]`-section placement is silently discarded.

### P0 REFINEMENT — the race is a MOUNT race, not a PATH race
Ruled out the PATH hypothesis: `/usr/bin/jq` is a SYMLINK to `/opt/bin/jq`, and systemd's default
PATH (`/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`) contains `/usr/bin`. The
qmanager daemons additionally carry an Entware-prefixed PATH. So jq is reachable by name in every
context — the symlink simply DANGLES until `/opt` mounts. Confirmed jq resolves and the config read
returns "04:00" under the real daemon PATH.
=> The failure window is exactly `[worker start 26.9s, opt.mount 30.2s]` = 3.3 s. Nothing orders any
qmanager timer relative to `opt.mount` (grep: no matches), so the margin is unmanaged on every boot.
=> Restating the hard constraint: the fire-stamp store/reader MUST be BusyBox-only (no jq, nothing
under /opt). `config.sh`'s `qm_config_get` is unusable inside the boot window BY CONSTRUCTION.

### G1 installer-safety-auditor — REPORTED DONE_WITH_CONCERNS -> ACCEPTED
Verdict PROCEED WITH CHANGES. Confirmed F5/F6/F7/F9/F10 with line evidence. Key durable facts:
- FIELD REACH: the 6 unit files, `schedule_timer.sh` and the 4 workers ALL reach deployed devices
  (glob-installed in `install_backend()` :1702-1706, gated only on DO_BACKEND, never --skip-packages).
  `rc.unslung.service` does NOT (written under `if [ ! -f ]` at :1235 inside `install_dependencies()`,
  skipped by --skip-packages via :4303/:4351). Template for the fix: `ensure_dropbear_unit_ordering`,
  called UNCONDITIONALLY at :4382 with a `systemctl show` read-back verifier at :4074-4093.
- F6 correct restore predicate: delete the prior-symlink-state capture (:3562-3566, restored :3617)
  and make the config-driven pass SYMMETRIC (ln -sf when enabled / rm -f when not), copying the
  auto-update timer pattern at :3640-3650.
- F7: config commit at watchdog.sh:266-271 precedes svc_disable at :327-332 — reorder or make the
  write conditional.
- F10: 4 bare `mv` CONFIRMED at :2322, :2371, :2734, :2783 (`set -e` at :42), all post-stop_services.
- An already-looping device does NOT self-heal via OTA — orthogonal to the guard fix.

### G2 devil's advocate — REPORTED DONE_WITH_CONCERNS -> ACCEPTED. CONDUCTOR'S DESIGN IS OVERTURNED.
The advocate broke (A)+(B). Adjudicated by the conductor; the advocate wins on the design, the
auditor's installer facts stand.

**K1 (fatal to (B)):** two callers pass `""` — `qmanager_scenario_schedule:56` and
`qmanager_auto_update:79`. Deleting `_qm_boot_settled` reduces the composite to `return 1` for an
empty sched, so BOTH workers die permanently and silently on every device. My design never said what
replaced the leg for them; the scenario worker was omitted from the design entirely, and (B) is
architecturally inapplicable to it (`_scenario_generate_oncalendar_lines` emits one line per
transition boundary — there is no single minute to match).
**K3 (fatal to (A)+(B) jointly):** device reboots 03:59 for an unrelated reason, clock steps at
04:00:xx. sane OK, matches OK, not-stamped OK -> ALLOW -> reboot, AND today's occurrence is consumed
so the real scheduled reboot is skipped too. The SHIPPED code denies this via uptime 24s < 300.
=> (A)+(B) is WORSE than f10172f on this case, in exchange for a persistent store + OTA lockstep.
**K2:** occurrence key takes its DATE from "now", so any schedule within tol of midnight gets an
extra reboot AND loses the next night's legitimate fire, permanently. Moot once (A) is dropped.
**K4:** stronger reason `/etc/qmanager` is unusable than the conductor's: `qmanager_setup:177` runs
`chown -R www-data:www-data /etc/qmanager` ON EVERY BOOT.
**K6:** under a required match, finding 15's fail-open IS the guard. Must be fixed in the same change.
**K7:** neither guard nor design is DAY-MASK aware. `OnCalendar=Sun,Mon,...` but the guard only sees
HH:MM, so a Mon-only schedule spuriously fires on a Wednesday. `sched_reboot_days` + `date +%w` free.

**CONDUCTOR'S RULING — adopt the advocate's minimal fix, DROP the persistent stamp entirely.**
Uptime was never the wrong axis; it was the wrongly-COMBINED axis. Every misfire lands at
boot+24-29s, so uptime is the one input that cannot be spoofed by a clock step.
    allowed = clock_sane AND uptime >= N AND (sched is empty OR now_matches(sched, tol))
i.e. change the OR-escape into a required AND-leg. Verified by the conductor against the recorded
replay matrix: `04:02/26 -> DENY` (Path A dies), `15:20/400 -> DENY` (Path B dies), legitimate
`04:00/large -> ALLOW`, `""` callers keep `sane AND uptime>=N` (K1 dies). The new composite is a
strict AND-tightening of the shipped one, so it can only ever deny MORE — it cannot introduce a new
spurious fire. Residual cost is false negatives only (device booted < N sec before the schedule
minute), which for a reboot payload is arguably correct behaviour.
=> DROPPED from scope: `/etc/qmanager-state`, the fire-stamp, its write discipline, its retention
policy, and its install/uninstall/OTA lockstep. Large scope reduction on the highest-risk surface.
=> The conductor's P0 `sync`-before-reboot question is now moot for the stamp, and separately
answered: `/sbin/reboot -> /bin/systemctl`, so a reboot is a systemd clean shutdown (which syncs).

**Empty-sched subtlety the conductor is adding on top of the advocate's formula:** "(sched empty OR
match)" lets an empty sched PASS, so a jq/`/opt` read failure at uptime>=N would reopen Path B for
the REBOOT worker. The two workers that HAVE a schedule (reboot, tower) must therefore treat an
unreadable schedule as a hard DENY in the worker itself, before calling the guard — distinguishing
"no schedule by design" (scenario/auto-update) from "schedule unreadable" (a failure).

**Free field remedy the audit missed (advocate).** Pulling the SIM leaves the clock at 1970 forever,
so `_qm_clock_sane` denies every fire and the loop stops — the device stays up and the owner can
disable the schedule in the UI. This is already CONFIRMED in the issue body itself ("SIM removed ->
device stays up indefinitely, fully stable"). Zero code, works on a device that is looping RIGHT NOW,
and it directly refutes handoff finding 4's "no recovery path a normal user can take".
=> Belongs in RELEASE_NOTES and as a comment on issue #9, ahead of any code.

**Circuit breaker: NOT BUILT.** It cannot reach an already-looping device (same ~29s window that
blocks the OTA), so it does nothing for the affected population, and a real one needs monotonic-only
state plus a new unit. The SIM-pull remedy covers the field case for free.

### P0b — CONDUCTOR PROOF OF THE CORRECTED DESIGN (read-only, deployed library, no code written)
Composed the PROPOSED composite out of the DEPLOYED pure functions over SSH and ran both side by
side. Method is D1's replay protocol (QM_TEST_YEAR / QM_TEST_UPTIME / QM_TEST_NOW_HHMM).

| scenario | year | uptime | now | sched | SHIPPED | PROPOSED |
|---|---|---|---|---|---|---|
| Path A re-entry            | 2026 | 26    | 04:02 | 04:00 | ALLOW | **DENY** |
| Path A tolerance edge      | 2026 | 26    | 04:10 | 04:00 | ALLOW | **DENY** |
| Path B late step           | 2026 | 400   | 15:20 | 04:00 | ALLOW | **DENY** |
| Path B late step           | 2026 | 900   | 09:33 | 04:00 | ALLOW | **DENY** |
| K3 unrelated reboot        | 2026 | 24    | 04:00 | 04:00 | ALLOW | **DENY** |
| 1970 boot fire             | 1970 | 23    | 04:02 | 04:00 | DENY  | DENY |
| LEGITIMATE fire            | 2026 | 86400 | 04:00 | 04:00 | ALLOW | **ALLOW** |
| LEGITIMATE + 1min accuracy | 2026 | 86400 | 04:01 | 04:00 | ALLOW | **ALLOW** |
| scenario worker (empty)    | 2026 | 26    | 12:00 | ""    | DENY  | DENY |
| scenario worker (empty)    | 2026 | 400   | 12:00 | ""    | ALLOW | **ALLOW** |
| auto-update (empty)        | 2026 | 400   | 17:45 | ""    | ALLOW | **ALLOW** |
| auto-update (empty)        | 2026 | 26    | 04:02 | ""    | DENY  | DENY |

Every loop path flips ALLOW->DENY. Every legitimate fire and both empty-sched callers are unchanged
(K1 refuted for the corrected design). The design is proven before a line of it is written.
Also recorded: `/sbin/reboot -> /bin/systemctl` (systemd clean shutdown); `/etc` is persistent ubifs
rw; a `set -C` noclobber write into /etc works and correctly refuses a second write; all five timer
workers run as root (no `User=`).

### G3 census — REPORTED DONE_WITH_CONCERNS -> ACCEPTED. 93 verified path:line citations.
Corrections and EXPANSIONS that change the work packages:
- **CONDUCTOR'S OWN CLAIM REFUTED.** My pre-dispatch note said `install_rm520n.sh:3937-3938` was a 7th
  StartLimit site. It is NOT — that heredoc places both directives correctly in `[Unit]` (header
  :3933). Census is exhaustive: exactly **6** affected units, all already in the handoff.
- **D2 is a CLASS defect, not a watchdog one.** `UCI_GATED_SERVICES` (:126) =
  `qmanager-watchcat qmanager-tower-failover qmanager-discord qmanager-sms-forward`. The
  symlink-state capture (:3562-3617) + additive-only config pass applies to ALL FOUR
  (discord :3705-3712, tower-failover :3739-3748, sms-forward :3750-3760). Handoff scoped it to 1 of 4.
- **D3 has a second true instance:** `cellular/sms_forwarding.sh:180` commits then `:201-202`
  `cgi_error`s. (`tower/settings.sh:141-143` and `tower/lock.sh:224-226,356-358` are the SAFE variant —
  they set a warning field and still return success — so they are NOT part of this defect.)
- **D6: handoff was wrong.** `:42` is `set -e` itself, not a `mv`. Two sites were MISSED: `:296`
  (inside `install_file()`) and `:359` (`finalize_version()`). True count of bare, unhandled,
  post-`stop_services` `mv` = **6** (296, 359, 2322, 2371, 2734, 2783). ~17 other `mv` are guarded.
- **D7: handoff path wrong.** No `scripts/usr/bin/qmanager_alert_engine`. Real:
  `scripts/usr/lib/qmanager/alert_engine.sh`, `_ae_classify_reboot()` :237-260, vocabulary comment
  :236, switch :254-257, sole crash.log reader :242. Marker writer is `qmanager_crash_log_append`
  (`CRASH_LOG=/etc/qmanager/crash.log` :29, format `epoch|reboot|reason` :63, root:root 644 :59-60,
  sudoers NOPASSWD `:50`). SECOND producer: `qmanager_watchcat:620`.
- **D13 is 6 sites + 1 worse one, not 1.** Hour range `[0-2][0-9]` (accepts 24-29) at
  `schedule_timer.sh:47`, `:160`, `:169`, `tower/schedule.sh:58`, `:65`, `system/settings.sh:210`.
  `system/update.sh:327` is WORSE — `grep -qE '^[0-9]{2}:[0-9]{2}$'` accepts 00-99. **No validator
  anywhere in the repo restricts the hour to 00-23.** Also `..._arm:151` is the `armed:true` line
  (handoff said :146, which is the failure check).
- D9 softened: `qmanager-dpi-ensure.timer` is `OnBootSec=` and structurally immune, so its absence
  from a table scoped to "families exposed to the window" is arguably correct; the real gap is that
  the doc never says the timer exists or why it is excluded.
- D10 confirmed exact source-time side effects: tower worker sources `qlog.sh` (mkdir at
  `qlog.sh:62` via `qlog_init` :29) + `tower_lock_mgr.sh` (top-level `mkdir -p /etc/qmanager` :93);
  scenario worker sources `qlog.sh` (:34) + `profile_mgr.sh` (top-level `mkdir -p` :44).
  `scenario_mgr.sh`'s mkdir is INSIDE a function — clean, not a source-time effect.
- D12: `scripts-dev/tests/test_timer_guard.sh` exists (155 lines), referenced by NOTHING.

### PHASE 2 — PLAN SYNTHESIZED BY CONDUCTOR (no builder pre-flight dispatched)
Deviation recorded deliberately: change-workflow Phase 2 calls for builder pre-flight on Tier 2+.
Skipped because the design is already fully specified AND proven on hardware by the P0b replay
matrix before any code exists — scaffolding returned by a builder could not add information. The
approval gate, the worktree, all Phase 5 validators and `docs-writer` are unchanged.

### RECONCILE 2026-09-08 (session resumed after a usage-limit stop)
Baseline moved f10172f -> **c472dd9** while stopped. Verified: `f10172f` is an ancestor of HEAD
(clean fast-forward, no rebase), and `c472dd9` touches ONLY `.claude/agent-memory/**` — no source
file. Working tree carries no source modification. Therefore every file:line citation gathered in
Phase 1 against f10172f remains valid verbatim; only the baseline hash changes.
**NEW BASELINE: c472dd9** | tree: `M .claude/agent-memory/ui-builder/MEMORY.md`, `M .orchestra/ledger.md`.
No builder had been dispatched before the stop, so there is no partial work to reconcile.

### PHASE 3 — USER GATE ANSWERED 2026-09-08
1. **Issue #9 comment:** hold the SIM-pull remedy until release — RELEASE_NOTES entry + ONE closing
   comment on the issue at ship time. Do NOT post to GitHub now.
2. **Skip trace:** YES — persist the guard's deny reason by reusing the existing root-owned
   persistent `/etc/qmanager/crash.log` via `qmanager_crash_log_append`. No new artifact, no
   installer lockstep. Its reader (`alert_engine.sh:242`, `tail -n 1`) MUST be made to filter for
   `|reboot|` lines, or a trailing skip line would misclassify the next real reboot.
3. **Verification depth:** replay only. **NO REBOOT**, no daemon-reload on the live device.
   The unit changes are therefore proven by `systemd-analyze verify` + static read, NOT by a live
   `systemctl show` read-back. Recorded as a deliberate evidence limit.
Plan as presented at the gate is APPROVED — proceeding to Phase 4.

### PHASE 4 — WORKTREE + BUILDER DISPATCH (2026-09-08)
Worktree `.claude/worktrees/issue9-clock-step`, branch `worktree-issue9-clock-step`.
Base verified NOT stale: HEAD == merge-base == development == c472dd9. `.env` copied in and
confirmed still gitignored (`.gitignore:34`). Repo `schedule_timer.sh` md5 aaa4a3dd... is IDENTICAL
to the deployed copy replayed in P0b, so that proof applies directly to the code being changed.
NOTE: `.orchestra/scratch/` is gitignored so it does NOT exist in the worktree — briefs therefore
carry the spec INLINE rather than by scratch path. Ledger is appended in the MAIN checkout only
(the worktree's tracked copy predates this run's appends; writing it would fork the journal).

Five builders, one wave, provably disjoint write sets. All `cgi-endpoint-builder` (pins its own
model — dispatched with NO model override, per the project's tiering rule).

| # | Task | Write set | State |
|---|------|-----------|-------|
| B1 | Fire guard + 4 workers: required-AND composite, day mask, fail-open fix, hour range, hard-deny on unreadable schedule, lib-missing fallbacks, cause marker + skip trace | `usr/lib/qmanager/schedule_timer.sh`, `usr/bin/qmanager_{scheduled_reboot,tower_schedule,scenario_schedule,auto_update}` | DISPATCHED |
| B2 | StartLimit* -> `[Unit]` in 6 units; `AccuracySec=1s` in 3 generated timers | `etc/systemd/system/qmanager-{watchcat,poller,ping,discord,sms-forward,dpi}.service`, `usr/bin/qmanager_*_arm` (3) | DISPATCHED |
| B4 | CGI: svc_disable before config commit (x2); HH:MM 00-23 (x4 incl. update.sh 00-99); arm-failure must not report success | `www/cgi-bin/quecmanager/{monitoring/watchdog.sh,cellular/sms_forwarding.sh,tower/schedule.sh,system/settings.sh,system/update.sh}` | DISPATCHED |
| B3 | Installer: unconditional `ensure_rc_unslung_unit_ordering`; symmetric config-driven wants-symlinks for all 4 gated services; 6 bare `mv` guarded | `install_rm520n.sh` | DISPATCHED |
| B5 | alert_engine reader filters `\|reboot\|` + new `scheduled` cause; crash.log size cap; consumer sweep | `usr/lib/qmanager/alert_engine.sh`, `usr/bin/qmanager_crash_log_append` | DISPATCHED |

CROSS-BUILDER CONTRACT fixed by the conductor so B1 and B5 agree without talking:
- Root workers append DIRECTLY to `/etc/qmanager/crash.log` in the `qmanager_watchcat:620` style.
  **The sudo helper's argument surface is NOT changed and sudoers is NOT touched** — deliberately,
  to keep this out of the privilege boundary.
- Line formats: `<epoch>|reboot|scheduled` and `<epoch>|skip|<short_reason>`.
- B5 must make the reader select the last `|reboot|` line, else a trailing `skip` line would
  misclassify the next real reboot. This is the one place the two builders could have collided.

SAFETY CONSTRAINT emphasised to B3 (this would have been a device-bricking bug): making the
wants-symlink pass symmetric means it can now `rm -f`. `qm_config_get` returns its DEFAULT on ANY
jq/config failure, so "unreadable" is indistinguishable from "disabled" unless explicitly checked.
A naive symmetric pass would silently disable watchdog, Discord, tower-failover and SMS-forwarding
on any install where the config read failed. B3 is required to distinguish the two and leave the
symlink alone when the read is not definite.

### B2 — REPORTED DONE -> VERIFIED BY CONDUCTOR (independent read, not the report)
All 12 directives confirmed under `[Unit]` across the 6 units (awk section-walk); `AccuracySec=1s`
present in all 3 arm helpers (`..._reboot_arm:128`, `..._tower_arm:141`, `..._scenario_arm:142`);
no CRLF in any of the 9 files. Report was accurate.
B2 also spotted a stray untracked `scripts/usr/lib/qmanager/schedule_timer.sh.new` — B1's in-flight
artifact. MUST be gone before commit; check with git, not with B1's report.

### B4 — REPORTED DONE -> ACCEPTED, 1 item to the fix wave
Defect 1 (svc_disable before commit) and Defect 2 (HH:MM 00-23, incl. update.sh's 00-99 grep ->
case) applied. Defect 3 resolved as an additive `warning`+`detail` pair, success shape byte-identical.

CONDUCTOR'S CHECK ON THE i18n QUESTION — resolved, no locale work needed:
The frontend ALREADY carries the correct contract. `types/system-settings.ts:35-45` documents
`armed?: boolean` / `reason?: string` and states "The UI must warn on `armed === false` rather than
flash an unconditional success toast (silent-success bug)"; `hooks/use-system-settings.ts:213`
already raises `toast.warning`, and `:222` returns `{success, armed, reason}`. So the user-facing
warning is already keyed and translated, and B4's new slugs are machine-voice belt-and-braces, not
the load-bearing signal. **No new locale keys; the i18n parity gate is NOT triggered by B4's files.**
Verifier must confirm `armed`/`reason` are still emitted alongside the new `warning`.

FIX-WAVE ITEM 1 (B4, self-reported, real): `cellular/sms_forwarding.sh` — its config write is a
single combined `{enabled, target_phone}` object, so deferring it means that on a FAILED disable
nothing at all was persisted. The retained message "Watchdog/SMS settings were saved, but ..." is
now false on that path. `watchdog.sh` is NOT affected (only the `enabled` key was withheld there;
its other fields genuinely did persist). Reword the sms_forwarding message only.

### B1 — REPORTED DONE -> VERIFIED ON HARDWARE BY CONDUCTOR. THE FIX IS PROVEN.
Local checks: stray `schedule_timer.sh.new` is GONE (checked with git, not the report — per the
standing rule that agent cleanup claims are verified with git). Composite matches spec verbatim.
Hour range corrected at all three sites (:46, :156, :165).

DEVICE REPLAY — new library uploaded to **/tmp/issue9/** and sourced from there. The LIVE library at
/usr/lib/qmanager/ was deliberately NOT replaced (md5 still aaa4a3dd... vs new 33b30ca1...), because
this device has a real 04:00 scheduled reboot armed. No system file touched, no unit reloaded.

| scenario | year | up | now | sched | dow | days | SHIPPED | NEW |
|---|---|---|---|---|---|---|---|---|
| Path A re-entry     | 2026 | 26    | 04:02 | 04:00 | - | -   | ALLOW | **DENY** |
| Path A edge         | 2026 | 26    | 04:10 | 04:00 | - | -   | ALLOW | **DENY** |
| Path B late step    | 2026 | 400   | 15:20 | 04:00 | - | -   | ALLOW | **DENY** |
| Path B late step    | 2026 | 900   | 09:33 | 04:00 | - | -   | ALLOW | **DENY** |
| K3 unrelated reboot | 2026 | 24    | 04:00 | 04:00 | - | -   | ALLOW | **DENY** |
| 1970 boot fire      | 1970 | 23    | 04:02 | 04:00 | - | -   | DENY  | DENY |
| LEGITIMATE          | 2026 | 86400 | 04:00 | 04:00 | - | -   | ALLOW | **ALLOW** |
| LEGIT +1min slop    | 2026 | 86400 | 04:01 | 04:00 | - | -   | ALLOW | **ALLOW** |
| empty sched         | 2026 | 400   | 12:00 | ""    | - | -   | ALLOW | **ALLOW** |
| empty sched (boot)  | 2026 | 26    | 04:02 | ""    | - | -   | DENY  | DENY |
| daymask Mon, is Wed | 2026 | 86400 | 04:00 | 04:00 | 3 | 1   | n/a   | **DENY** |
| daymask Mon, is Mon | 2026 | 86400 | 04:00 | 04:00 | 1 | 1   | n/a   | **ALLOW** |
| daymask bad dow     | 2026 | 86400 | 04:00 | 04:00 | x | 1   | n/a   | **DENY** (fails closed) |

Hour validator: 00:00/04:00/23:59 VALID; 24:00/26:30/29:59/2a:00 REJECT (was VALID for 24-29).
Fail-open closed: now="" / "9x:00" / "99:99" all DENY (previously ALLOW via the d=0 arithmetic trap).
=> Both loop paths, K3, and the day-mask hole are closed; both legitimate fires and both empty-sched
callers are preserved. K1 refuted in practice. This is the Phase 5 primary evidence for the guard.

B1 deviations reviewed and ACCEPTED: (a) a local `_qm_crash_log_append` helper inside
qmanager_scheduled_reboot only — direct append in the watchcat:620 style, no sudo helper, no shared
file; (b) tower day mask read from `tower_lock.json .schedule.days` (a JSON array) via
`jq ... | join(",")` — `join` is a builtin, NOT a regex function, so it is safe on the
ONIGURUMA-less device jq; (c) added `update_in_progress` as a skip reason, which correctly covers
the OTA-bail path sitting between the guard and `reboot`; (d) trimmed more stale comment blocks than
asked — consistent with the project's hard comment rule.

### B5 — REPORTED DONE -> VERIFIED BY CONDUCTOR
Reader now takes the newest `|reboot|` line rather than `tail -n 1`, so a trailing `skip` line can
no longer misclassify the next real reboot. `scheduled` added to the vocabulary. B5 also checked the
SECOND consumer and found `_ae_deliver_reboot`'s coalescer (`alert_engine.sh:379-380`) already
filters `$2 == "reboot"` in awk — correct as-is, no change needed. Good catch; that would have been
an easy miss.
Consumer sweep was genuinely small and additive: `types/alerts.ts:83` (RebootCause union) +
`components/monitoring/alerts/alerts-log-card.tsx` (4 maps) + 5 locale packs.
crash.log now has a PRE-append cap (>200 lines -> keep last 100) sited before the existing
post-append MAX_LINES=20 trim, because the new direct root writers bypass that helper entirely.
Cap cannot fail the caller: `wc -l` falls back to 0, a failed `tail` skips the branch, a failed `mv`
falls through to removing the temp — worst case a missed trim, never a lost log.

CONDUCTOR'S INDEPENDENT VERIFICATION (not the report):
- Locale packs: measured by byte (od/PowerShell, NOT `grep -c $'\r'`, which gives a FALSE NEGATIVE
  under Git Bash) — all five packs 1459 CRLF pairs / 0 bare LF, line endings intact, `scheduled`
  key present in all five.
- `bun run i18n:check`: **0 errors**, 100% translated 3893/3893 in every pack. The 26 warnings are
  pre-existing passthrough notices, none touching this key.
NOTE: this change now carries a FRONTEND surface (union member + 4 map entries). tsc and i18n both
pass; residual = no browser render of /monitoring/alerts. Low risk (additive map entry), tracked.

B5 deviations ACCEPTED: `CalendarClockIcon` (lucide) — already used at
`components/system-settings/status-band.tsx`, and `/monitoring/alerts` is outside the Material
Icon-Boundary routes, so lucide is correct there. Tone `neutral` (same as `user`) is right: a
scheduled reboot is expected behaviour, and NOT flagging it is the entire point of finding 11.

### B3 — REPORTED DONE -> ACCEPTED, with a conductor field-reach verification
B3 found and closed a `set -e` hazard IN ITS OWN NEW CODE: a bare `var=$(jq ...)` assignment is NOT
exempt from `set -e` and aborts the installer on jq failure; likewise a trailing
`[ -x foo ] && func` as a function's last statement. Fixed by moving the assignment inside an `if`
condition and converting call sites to `if/fi`. Verified empirically by B3; re-swept by the Phase 5
auditor.
`_apply_gated_symlink` bypasses `qm_config_get` entirely and reads raw jq output + jq's exit status,
mapping an absent key to a sentinel "unset" — so "unreadable" is distinguishable from "explicitly
disabled" and a symlink is only ever removed on a DEFINITE disabled value. That is exactly the
safety constraint; the Phase 5 auditor is re-deriving the truth table adversarially, including the
jq-absent row.

CONDUCTOR'S FIELD-REACH VERIFICATION (the whole point of Defect 1 — does the fix reach devices?):
`ensure_rc_unslung_unit_ordering` only rewrites when the on-disk unit matches
`_rc_unslung_unit_body_legacy` EXACTLY, so a too-strict gate would silently fail to reach the field.
Checked against hardware and history:
- LIVE unit on 61368cd2 is textually identical to the legacy body (193 bytes, LF, trailing newline).
  My first md5 comparison MISmatched only because a PowerShell here-string omits the final newline;
  irrelevant, because B3 compares via `$(...)` on BOTH sides and command substitution strips trailing
  newlines symmetrically. The gate MATCHES on this device.
- History: `git log -S 'Description=Start Entware services'` returns exactly ONE commit (29ca5c7).
  The other hit, 2627e1d, matched only a COMMENT mentioning rc.unslung (the S80lighttpd change) and
  did not touch the heredoc. => exactly ONE historical variant of this unit has ever existed, so the
  equality gate reaches EVERY QManager-installed device. Defect 1's field-reach goal is met.
- Live `systemctl show rc.unslung -p After` contains NO opt.mount — finding 8 reproduced again.
- Device gated-service state is self-consistent (watchcat enabled=1 + symlink present; discord
  enabled=false + symlink absent), so the symmetric pass is a no-op here — no destructive change.

### PHASE 5 — VALIDATORS DISPATCHED (single parallel message, per the hard rule)
| id | validator | scope | State |
|---|---|---|---|
| V1 | orchestra-verifier (BLIND) | original task verbatim + diff; must reproduce, not read reasoning | DISPATCHED |
| V2 | installer-safety-auditor (verify mode) | install_rm520n.sh diff; `_apply_gated_symlink` truth table incl. jq-ABSENT row; `.qmbak` lockstep; `set -e` sweep | DISPATCHED |
| V3 | busybox-portability-checker | residue only — line endings, applet coverage across BOTH BusyBox versions, ash/octal traps, jq `join`/null-test at RUNTIME, unit parse | DISPATCHED |
All three carry explicit HARD DEVICE CONSTRAINTS: stage under /tmp only, never overwrite
/usr/lib//usr/bin//lib/systemd//etc, and NO reboot / restart / daemon-reload / installer run /
config write. The device has a real 04:00 reboot armed and the user's standing policy is
ASK BEFORE EACH REBOOT.

FIX-WAVE ITEM 1 deliberately HELD (not yet applied): the `sms_forwarding.sh` message reword. Editing
the tree while three validators are diffing it would give them a moving target and invalidate their
reports. Will be batched with whatever they return, as one fix wave.

### V2 installer-safety-auditor (verify mode) — VERDICT: PASS_WITH_NOTES -> ACCEPTED
The safety-critical invariant HOLDS. Adversarial truth table for `_apply_gated_symlink`: a symlink is
removed ONLY on an explicitly parsed `false`/`0`. Every ambiguous state — file missing, invalid JSON,
key absent, section absent, explicit null, wrong type, empty output, garbage value, and **jq binary
absent (exit 127)** — falls through to leave-alone. That was the one way this change could have
bricked a fleet, and it does not.
Also confirmed: all four gated services read the CORRECT file+key (discord ->
discord_bot.json .enabled; watchcat -> qmanager.conf .watchcat.enabled; tower-failover ->
tower_lock.json .failover.enabled; sms-forward -> sms_forwarding.json .enabled), each cross-checked
against its real runtime consumer. `set -e` sweep clean on new code. `ensure_rc_unslung_unit_ordering`
is genuinely reached on an OTA (main():4543, no DO_* gate before it). Ordering vs dropbear is a
non-issue: dropbear's `Before=rc.unslung.service` makes systemd derive the reverse edge either way.
`.qmbak` is consistent with the already-shipped dropbear `.qmbak` precedent — not a new gap class.

FIX WAVE (batched — one worker for the whole list, per the delegation rule):
- F1 (from B4): `cellular/sms_forwarding.sh` — message says "settings were saved" on a path where the
  whole config object is now deferred and nothing was saved. Reword. `watchdog.sh` NOT affected.
- F2 (V2 risk 1): `Requires=opt.mount` is emitted unconditionally, and `_verify_rc_unslung_unit` only
  string-matches the property, so it cannot catch a dangling requirement. CONDUCTOR PROBED THE DEVICE:
  `/lib/systemd/system/opt.mount` IS a real QManager-written unit (144 bytes, Aug 16), `/opt` is NOT
  in fstab, so it is not generator-produced. Decisive precedent found on the same device: the SHIPPED
  `dropbear.service` uses `After=network.target opt.mount` with **NO `Requires=`**.
  => Fix: keep `After=opt.mount` unconditional; emit `Requires=opt.mount` ONLY when
  `$SYSTEMD_DIR/opt.mount` exists. Removes the dangling-requirement failure mode without weakening
  the fix on healthy devices.
- F3 (V2 risk 2): `_apply_gated_symlink`'s watchcat call site passes `$QM_CONFIG`, which is never
  assigned in install_rm520n.sh — it only exists because `config.sh` was sourced ~80 lines earlier in
  the same function. A future reorder would silently make it empty, which the function reads as
  "file missing -> leave alone", freezing the watchdog symlink with no error. Make it explicit.
- F4 (V2 risk 4): two comment blocks the diff ADDS exceed the project's hard 1-2 line rule
  (`_apply_gated_symlink` header ~9 lines, `ensure_rc_unslung_unit_ordering` header ~10). Precedent in
  the file is not an exemption — CLAUDE.md is explicit and the builders were briefed on it. Trim.
ACCEPTED AS-IS (no fix): `finalize_version` warn-and-continue can leave `VERSION.pending`, which
`update.sh:120-142` surfaces as `previous_install_failed: true`. That is arguably CORRECT — if the
VERSION rename failed the install genuinely did not complete — and it is strictly better than the old
behaviour, where the same failure aborted the installer under `set -e` with services already up.

### V1 orchestra-verifier (BLIND) — VERDICT: **FAIL** -> ACCEPTED. Found 2 MAJOR defects everyone missed.
Device-proven on 61368cd2, new lib staged in /tmp/verify9/ only, nothing system-level touched.
It CONFIRMS the core result independently: Path A closed (04:02/up26 ALLOW->DENY), Path B closed for
the reboot payload (15:20/up400 ALLOW->DENY), every legitimate fire preserved, both empty-sched
callers preserved (E1/E2 ALLOW), day mask correct against real `date +%w`, 24:00-29:59 now REJECT at
every validator, device-ash `sh -n` 13/13, i18n 0 errors / 3893 all packs, tsc exit 0, jq
`join(",")` verified on device jq-1.7.1.

**DEFECT V1-1 (MAJOR) — CONFIRMED BY CONDUCTOR FIRST-HAND. Our own regression.**
`qmanager_watchcat:318` counts crash.log entries VERB-AGNOSTICALLY:
  `awk -v cutoff="$cutoff" -F'|' '$1 >= cutoff { n++ } END { print n+0 }'`
so the new `skip|` lines are counted as REBOOTS. With `max_reboots_per_hour=3`, two guard denials
plus one real reboot exhausts the budget and the watchdog REFUSES its Tier-4 recovery rung for an
hour — on a device that is by definition already failing. V1 reproduced it on hardware
(2 skip + 1 reboot -> reboots_this_hour=3). It also corrupts the watchdog state JSON and the UI.
ROOT CAUSE IS THE CONDUCTOR'S: my cross-builder contract named `alert_engine.sh` as "the reader" and
B5 correctly fixed it, but crash.log has a SECOND reader and nobody was told to look. The census
listed `qmanager_watchcat:620` only as a PRODUCER.

**DEFECT V1-2 (MAJOR) — CONFIRMED BY CONDUCTOR FIRST-HAND.**
The new inline `_qm_crash_log_append` (`qmanager_scheduled_reboot:43-52`) appends as ROOT into
`/etc/qmanager/crash.log` with NO symlink guard, while the existing `qmanager_crash_log_append:47-49`
carries exactly `[ -L "$CRASH_LOG" ] && rm -f`. `/etc/qmanager` is www-data-owned and non-sticky, so
www-data can plant a symlink and the next scheduled fire writes through it as root. This is the exact
hole that helper was written to close.

**DEFECT V1-3 (conductor-found, not in V1's report):** temp-file COLLISION.
`qmanager_scheduled_reboot:49` uses `${CRASH_LOG}.tmp` and `qmanager_crash_log_append:85` also uses
`${CRASH_LOG}.tmp` — a root worker and a www-data-invoked helper sharing a temp path. B5 deliberately
used `.precap.tmp` for its own new trim to avoid exactly this; B1's inline copy did not.

V1-3(minor) ACCEPTED, NOT FIXED: the new `warning`/`detail` slugs have no UI consumer. Conductor
verified `armed` is STILL emitted (`settings.sh:261`), and `types/system-settings.ts:35-45` +
`hooks/use-system-settings.ts:213` already warn on `armed === false`. So the load-bearing signal is
intact and the new field is harmless redundancy.

"NOT ADDRESSED" items — adjudicated, NOT gaps:
- Finding 16 (dpi-ensure doc row) and 5 (RELEASE_NOTES): Phase 6 has not run yet. Sequenced, not missed.
- Finding 4 (no circuit breaker): DELIBERATE. The devil's advocate showed a breaker cannot reach an
  already-looping device (same ~29s window that blocks the OTA), and the user chose the SIM-pull
  remedy via RELEASE_NOTES at release. Standing decision, recorded at the Phase 3 gate.
- Finding 2 "partial" (empty-sched callers still uptime-only): DELIBERATE and correct. The advocate
  argued auto-update must KEEP its uptime floor rather than take a day-stamp, because a day stamp
  permits one spurious install-and-reboot per day — a permanent nightly reboot for a repeatedly
  failing install. Auto-update is also default-OFF (`update.auto_update_enabled` = 0) and its payload
  no-ops once current==latest. Guard is UNCHANGED for those callers, so this is a pre-existing
  residual, not a regression. Document it.
- Finding 12 "partial" (only the reboot worker persists skips): intentional, and V1-1 makes it
  positively desirable — more skip writers would inflate the watchdog miscount further.
- Finding 19 (test harness): CONDUCTOR'S MISS — it was in no builder's write set. Added to fix wave.

FIX WAVE — FINAL LIST (one worker, batched):
 F1 sms_forwarding.sh message reword (nothing is saved on that path now)
 F2 emit `Requires=opt.mount` only when the unit exists; keep `After=` unconditional
 F3 make `$QM_CONFIG` explicit at the watchcat call site
 F4 trim the 2 over-long comment blocks the diff ADDS
 F5 **MAJOR** qmanager_watchcat:318 must filter `$2 == "reboot"`
 F6 **MAJOR** symlink guard on the new root append
 F7 delete scripts-dev/tests/test_timer_guard.sh
 F8 rename the colliding temp file

### V3 busybox-portability-checker — VERDICT: PASS_WITH_NOTES -> ACCEPTED. No blocking defects.
Independently REPRODUCED the `_apply_gated_symlink` semantics by EXECUTION on the device (not
reasoning), which is stronger evidence than V2's static truth table:
  `{"enabled":false}` -> "false"   |  `{"enabled":null}` -> "unset"  |  `{}` -> "unset"
  missing file -> jq exit 2        |  malformed JSON -> jq exit 5    |  `.days` absent -> "" (safe)
So an explicit disable is genuinely never conflated with an unreadable config, on real hardware.
Also: all 22 staged files LF/no-BOM (checked ON DEVICE, not with Git Bash whose `grep -c $'\r'` gives
a false negative); `sh -n` 15/15 under the device's own ash and bash 3.2.57; `set -e` sweep clean,
including live-verifying that a non-final `[ -L x ] && warn` in an `&&` chain does NOT abort.

TWO CORRECTIONS TO THE PLAN (mine, not the agent's):
1. **`systemd-analyze verify` DOES NOT EXIST on this device build.** My Phase 3 verification plan
   named it as the way the unit changes would be proven. It is absent entirely (`find / -iname
   'systemd-analyze*'` -> nothing; only `systemctl` ships). V3 substituted structural awk inspection
   of all 6 units PLUS a live reproduction of the PRE-fix defect: the running `qmanager-poller.service`
   reports `StartLimitIntervalUSec=10s` / `Burst=5` against a configured 3600 — the bug, reproduced on
   the running system, and proof that `--value` itself works on this systemd.
   => HONEST EVIDENCE LIMIT: the POST-fix read-back is NOT verified, because it needs `daemon-reload`,
   which the user's "replay only, no reboot" decision excludes. Must be stated in the close-out.
2. **The octal trap is FATAL, not merely wrong.** `$((08*60+09))` raises an arithmetic syntax error
   that ABORTS THE ENTIRE SCRIPT (verified: statements after it never ran). So routing HH:MM through
   `awk` is load-bearing, not stylistic — a stray `$(( ))` on a padded field would kill the worker.

CONDUCTOR CORRECTION TO V3'S REPORT: V3 claimed this worktree's `.env` "carries only the bare
`MODEM_*` alias — no RG501Q_* at all". FALSE — `grep -c 'RG501Q_IP\|RG501Q_SSH_USER\|
RG501Q_SSH_PASSWORD' .env` returns **3**. The credentials are present. V3's CONCLUSION (RG501Q
unreachable) is correct and matches the conductor's own ping, but the reason it gave is wrong and
would send a future validator chasing a phantom credential problem. Recorded so it does not.

CARRIED FORWARD (not a defect, but real): `install_rm520n.sh` is the SHARED installer for both
devices (branches on `RG501Q*` at :457), so `ensure_rc_unslung_unit_ordering` and
`_apply_gated_symlink` execute on RG501Q-EU too. Its systemd version is recorded as UNVERIFIED in
platform-matrix.md; if it predates systemd 230 and lacks `--value`, `_verify_rc_unslung_unit` fails
CLOSED and restores the prior unit — worst case "the ordering fix does not apply there", never
corruption. Note for docs.

### FIX WAVE DISPATCHED — one worker, 8 items (F1-F8), write set of 5 paths
F5/F6 are the MAJOR regressions; F7 deletes the test harness (conductor's own scope miss).

### FIX WAVE — REPORTED DONE -> VERIFIED BEHAVIOURALLY ON HARDWARE (serial 61368cd2)
| fix | verification | result |
|---|---|---|
| F5 watchcat verb filter | synthetic crash.log: 2 `skip` + 1 `reboot` within the hour | SHIPPED filter counts **3** (budget exhausted, Tier-4 refused) / FIXED filter counts **1** |
| F6 symlink guard | planted `crash.log` -> symlink to a VICTIM file, then ran the append | VICTIM reads `untouched`; crash.log is a REGULAR file holding the correct line. Redirection blocked |
| F8 temp collision | grep | worker now uses `.sched.tmp`, helper keeps `.tmp`/`.precap.tmp` |
| F1/F2/F3/F4/F7 | read back | message reworded; `Requires=` conditional; literal config path; comments trimmed to 2 lines; harness deleted, dir left empty |
| guard regression check | full matrix re-run after the wave | up=26/04:02 DENY, up=400/15:20 DENY, up=86400/04:00 ALLOW — unchanged |
| syntax | device's OWN ash + bash 3.2.57 | 5/5 OK |

**CONDUCTOR TOOK OVER FOR ONE 3-LINE FIX (precedence table row 1 — bad ticket, not a seat failure).**
The fix worker correctly flagged that my F2 ticket specified only `_rc_unslung_unit_body` and never
mentioned `_verify_rc_unslung_unit`. Result: the emitter became conditional
(`Requires=opt.mount` only when the unit exists) while the verifier still asserted `Requires`
UNCONDITIONALLY — so on exactly the device class F2 protects, the unit would be written correctly,
FAIL verification, and be ROLLED BACK. The fix would have silently undone itself.
Fixed in place: the verifier's `Requires` assertion now sits behind the identical predicate
`[ -f "$SYSTEMD_DIR/opt.mount" ]`. Emitter :4107 and verifier :4227 now use the same test.
`bash -n` clean. Dispatching an agent for three lines would have cost more than the fix.

### PHASE 6 — docs-writer DISPATCHED
Scope: scheduled-timers.md (stale guard description + 1970-boot-window section + the mount-race and
fatal-octal findings + accepted residuals + the missing dpi-ensure timer), alerts.md (crash.log's TWO
line shapes, the four-member cause vocabulary, and the standing warning that crash.log has TWO
readers — missing the second one was a real regression this round), RELEASE_NOTES.md (append to the
existing v0.1.14-draft Unreleased block, headline = loop fixed, plus the SIM-pull field remedy for
devices looping RIGHT NOW), and at most one CLAUDE.md routing row.

### PHASE 6 — docs-writer REPORTED DONE_WITH_CONCERNS -> ACCEPTED
Rewrote `scheduled-timers.md` (new AND composite, day mask, hard-deny pre-check, fail-closed
fallbacks, skip trace, the /opt MOUNT RACE incl. the explicit "After=opt.mount makes it WORSE"
warning, the fatal-octal rule, accepted residuals, and the six-timer inventory with dpi-ensure named
as monotonic-and-excluded). Rewrote the `alerts.md` crash.log contract. Appended 6 bullets to the
existing v0.1.14-draft Unreleased block, incl. the SIM-pull recovery bullet. CLAUDE.md deliberately
NOT touched — both candidate rows are still accurate as routing pointers.

**docs-writer CORRECTED THE CONDUCTOR TWICE — both adopted:**
1. My brief said crash.log has TWO readers. It has **THREE read sites across TWO files**:
   `_ae_classify_reboot`, `_ae_deliver_reboot`'s coalescer (both alert_engine.sh), and
   `count_recent_reboots()` (qmanager_watchcat). The coalescer already filtered `$2 == "reboot"` at
   the base commit, so it was safe — but a doc saying "two" would send the next author looking for
   one reader too few. The verified count is documented.
2. My brief said "HH:MM validators corrected at four MORE sites". The four are `system/settings.sh`,
   `tower/schedule.sh` (start AND end), and `system/update.sh`. `watchdog.sh` and
   `sms_forwarding.sh` got the svc_disable reordering, NOT a validator fix.

### DOCS ROUND 2 DISPATCHED — 5 docs this branch FALSIFIED
Two of them describe bugs this branch FIXES as still-live defects, which would invite a future
session to re-fix them: `platform-matrix.md:966-970` (the StartLimit `[Service]` trap) and
`BACKEND.md:913` ("purely symlink-presence detection", no longer true). Plus
`connection-watchdog.md:207` (crash.log ownership row — and that subsystem owns the third read site,
the one that regressed), `README.md:40` (stale index line), and `qmanager-independence.md` (the
`if [ ! -f ]`-inside-`install_dependencies()` OTA-reach lesson has no home in the installer doc).

### FINAL GATES (conductor-run, in the worktree)
| gate | result |
|---|---|
| `bunx tsc --noEmit` | exit 0 |
| `bun run i18n:check` | 0 errors, 100% (3893/3893) x5 packs |
| `bun run build` | clean; **no CSS optimizer warnings** despite ~500 new lines of docs prose, so the Tailwind prose-extraction hazard did NOT fire. Only the pre-existing workspace-root inference warning (worktree lockfile) |
| device ash/bash `sh -n` | 5/5 on the fix-wave files |
| device behavioural | F5 3->1, F6 symlink refused, guard matrix unchanged |

### DEVICE LEFT CLEAN
All staging dirs removed (/tmp/issue9, /tmp/verify9, /tmp/fc2, /tmp/portcheck). Live
`schedule_timer.sh` still md5 aaa4a3dd (ORIGINAL — never replaced), timer still `active`,
`/etc/qmanager/crash.log` untouched since Aug 24. **The entire verification campaign left zero
footprint on the device**, matching the user's ask-before-any-change policy.

### DOCS ROUND 2 — REPORTED DONE_WITH_CONCERNS -> ACCEPTED (incl. its self-authorised 6th edit)
Corrected 5 docs this branch falsified. It also made a SIXTH correction inside an in-write-set file
and flagged it: `qmanager-independence.md`'s "OTA self-heal for gated services" section asserted the
pass is "additive only", "never runs `rm -f`", and that absent config means "not enabled". All three
are now FALSE. Leaving them would have reproduced exactly the harm the round existed to prevent — a
future session reading the doc, believing symlink-state restore is still live, and re-adding it.
Correct call; adopted.
Left deliberately untouched (flagged, out of scope): a stale "twelve config reads" COUNT attached to
a still-correct rule in the same file; BACKEND.md's poller "2 s cadence" (known-false, pre-existing,
unrelated); a README/CLAUDE.md disagreement on connection-quality's key count (11 vs 13).

### CLOSE-OUT 2026-09-08
COMMIT: `b395eb1` on `worktree-issue9-clock-step` — 42 files, +1081/-463.
  Body carries the full archive per the project's "commit message is the archive" rule: mechanism,
  the before/after replay matrix, the mount-race timings, why the fire-stamp was rejected, the two
  self-inflicted regressions and their fixes, what was deliberately NOT done, and the evidence limits.
  `.claude/agent-memory/docs-writer/reference_crash_log_has_three_readers.md` needed **`git add -f`**
  — `.claude/` is gitignored, so it was `!!` in status and would have been silently lost.
  `scripts-dev/tests/test_timer_guard.sh` deleted.

MERGE: `development` had ADVANCED under us while we worked — c472dd9 -> 691811a (a parallel
about/support/donate run). Verified `c472dd9` is STILL AN ANCESTOR, i.e. a clean advance and NOT a
rebase, before merging. Merged as `3dd8ec2`.
  Overlap risk was real: BOTH branches touched all five `public/locales/*/common.json`. Git
  auto-merged (different regions) and both sides are present — our `scheduled` key AND their
  about-device keys.
POST-MERGE GATES (the workflow requires these because a clean auto-merge can still break the build):
  `bun run i18n:check` -> 0 errors, 100% (3966/3966, up from 3893 — their keys + ours)
  locale CRLF measured by BYTE after the merge -> 1588 CRLF / 0 bare LF in all five packs (intact)
  `bunx tsc --noEmit` -> exit 0
  `bun run build` -> Compiled successfully, no CSS optimizer warnings

FINAL VERDICT TRAIL: V2 PASS_WITH_NOTES, V3 PASS_WITH_NOTES, V1 **FAIL** -> fix wave (8 items) ->
all re-verified on hardware. The FAIL was correct and is the single highest-value dispatch of this
run: it caught two regressions we introduced, one of which (skip lines consuming the watchdog's
reboot budget) traced to a defect in MY OWN briefing — I told the builders `alert_engine.sh` was
"the reader" of crash.log when there are three read sites across two files.

OPEN / CARRIED FORWARD:
- The `[Unit]` StartLimit placement is NOT hardware-verified (needs `daemon-reload`, excluded by the
  user's replay-only decision). The BROKEN state was confirmed live.
- RG501Q-EU offline for the entire run — no cross-device verification of anything.
- Issue #9 itself is NOT closed on GitHub. Per the user's gate answer, the SIM-pull remedy ships in
  RELEASE_NOTES and gets ONE closing comment on the issue AT RELEASE, not now.
