# Run: Port the101 radius role scale retune + card-sheen gradient
status: closed
lane: full
base: 8600a4ffe05fedf3fb2b8b2cb9c31669491c03bc   branch: development (worktree TBD)   opened: 2026-09-13   lead: opus

## Request
Can you please check the QManager-101's DESIGN language / rules for rounded corner size
changes and the subtle gradient background for cards and apply it also on our repo?
Orchestrate a team if needed and update all docs.

## Decisions taken — do not re-ask
- Source of truth for the port: `D:\Projects\QM PROJECT\QManager-the101` DESIGN.md §5 Elevation (Sheen,
  The Card-Sheen Rule) and §6 Shapes (role radius table, Radius-Follows-Size / Role-Radius rules).
- No device work in this run — frontend/tokens/docs only. Device untouched.
- GATE APPROVED 2026-09-13 via Artifact https://claude.ai/code/artifact/0355fd44-b084-463d-b899-8a57e1a2a4cf
- User chose EXACT PARITY with the101: 8/10/12/16/20 + pill unchanged. No middle position.
- User chose the FULL doc sweep including all ~10 reference docs.
- User chose: fix the two hardcoded skeleton radii; record the installer-gui divergence.
- RELEASE_NOTES: user chose "rename the draft to v0.1.16" — the unreleased v0.1.15 draft rolls
  forward. `### Upgrading from v0.1.14` STAYS v0.1.14 (v0.1.15 never shipped). package.json -> v0.1.16.
- DEVIATION (conductor): no worktree. The main tree holds the uncommitted v0.1.15 release draft that
  RELEASE_NOTES/package.json edits depend on, and preview_start serves the repo root, not a worktree.
  Working directly on `development`.

## Plan
| id | task | class | seat (model/effort) | write set | state |
|---|---|---|---|---|---|
| R1 | Census radius call sites + arbitrary-radius risks in our repo | recon | qm-scout (sonnet/low) | none | PENDING |
| R2 | Census docs stating the 12/20/28/36/40 scale or shadow/elevation rules | recon | qm-scout (sonnet/low) | none | PENDING |
| R3 | Extract the101's card-sheen implementation verbatim | recon | conductor | none | PENDING |

## Attempts   (append-only)
| task | # | seat | ticket rev | outcome | checks run | evidence path |
|---|---|---|---|---|---|---|
| - | - | - | - | - | - | - |

## Findings that survive
- app/globals.css:216-220 is the ONLY definition of the role scale. No `var(--radius-*)` consumer
  exists anywhere in components/ hooks/ lib/ app/ constants/ — the retune is five literals.
- 1034 `rounded-{role}` call sites (inline 74 / field 147 / tile 183 / card 90 / hero 66 / pill 474),
  concentrated in per-feature shapes.ts. None needs editing; they follow the tokens.
- components/ui/card.tsx:9 ships `rounded-xl` and dialog.tsx:76 ships `rounded-lg` — the LEGACY
  --radius chain (~14px), not the role scale. Untouched by the retune; both take `card-sheen`.
- No hand-tuned radius pinned to old values. Exception: components/public/overview/states.tsx:62,82
  hardcode rounded-[0.375rem]/[0.5rem] on skeletons (pre-existing rule break, not caused here).
- Our --shadow-whisper is byte-identical to the101 in both themes; dark canvas 0.120 / card 0.170
  matches too. The sheen premise transfers with zero reinterpretation.
- the101 sheen implementation (verbatim): :root `--card-sheen: none;` · .dark
  `linear-gradient(180deg, oklch(1 0 0 / 0.045) 0%, oklch(1 0 0 / 0) 42%, oklch(0 0 0 / 0.03) 100%)`
  · `@utility card-sheen { background-image: var(--card-sheen); }` · class on Card root + DialogContent.
- globals.css has NO `@utility` blocks yet — this adds the first one.
- Docs carrying stale radius numbers: CLAUDE.md:42 · DESIGN.md:187-191, 206-209, 541-558 ·
  app/globals.css:78 · redesign-proposal-playbook.md:116 · tower-locking.md:106,500,1000-1003 ·
  sms-forwarding.md:148 · band-locking.md:261,632,640-641 · sim-profiles.md:676,1080,1818 ·
  frequency-locking.md:328-329 · about-support.md:145 · cell-scanner.md:76 · overview-splash.md:243
- DESIGN.md contradictions the sheen must reconcile, not bypass: :524 "Depth is tonal, not cast",
  :528-531 Shadow Vocabulary (two entries, no gradient), :556 "no gradient, no shadow".
  Migration Deltas is at :231-257. No router row / reference doc owns shapes — DESIGN.md is canon.
- installer-gui/src/qmanager_installer/ui/styles.css duplicates the same var names (separate Python
  GUI). Out of scope; will diverge silently unless noted.
- RELEASE_NOTES.md active entry: v0.1.15, sections already populated.

## Device state
Not touched. No deploys in this run.

## Handoff — NEXT ACTION
CLOSED. Three blind verification rounds ran; each FAIL was a stale-figure miss, never the
implementation, which passed on round one and was never re-opened.

Round 1 FAIL -> 49 stale figures in source comments + an inverted argument in recent-activities.md.
Round 2 FAIL -> DESIGN.md body text contradicting its own Shapes table (6 lines), 8 more component
  files, 3 design.json prose fields, a historical figure wrongly "corrected", and my overlay delta
  row claiming drawer.tsx has a shadow (it has none, and zero consumers).
Round 3 FAIL -> 6 lines in ip-passthrough/ + ttl-mtu-settings/ shapes.ts RADIUS MAPPING blocks
  (these say "The role scale", so the px column is the TOKEN's value; ethernet/ and traffic-engine/
  say "comp 36px" and were correctly left), plus a wrong count in the delta row.
Both round-3 items fixed and self-verified rather than spending a fourth agent round on two lines.

METHOD NOTE THAT SURVIVES: rounds 1 and 2 failed because the ticket said "find the hits yourself"
and each regex missed variants. Round 3's ticket handed the worker an explicit 101-line candidate
list built by the conductor; it came back with every candidate triaged and the counts summing.
For a figure sweep, build the candidate set at the conductor and delegate only the judgment.

ALSO FIXED (pre-existing, surfaced by the pass, not caused by it): the ui-builder agent-memory
"custom radius overrides lose alphabetically" and its twin warning in cellular-settings-family.md
both asserted `cn()` is bare tailwind-merge. lib/utils.ts:23 extends it with our radius names —
proven by calling twMerge directly. Both rewritten as resolved.

OPEN, SURFACED TO THE USER, NOT ACTED ON: AlertDialogContent / SheetContent / DrawerContent paint
bg-surface but take no card-sheen. In spec (the101 scopes to Card + DialogContent). Tracked as an
Open (accepted) Migration Delta. drawer.tsx has no shadow fallback and would earn it first, but has
zero consumers.

Final gates: tsc 0 · build 0, no CSS-optimizer warning · i18n:check 0 errors, 5 packs 100%.
Device never touched. Not merged to main — release is the user's act.
