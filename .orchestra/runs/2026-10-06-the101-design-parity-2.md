# Run: Port the101's evolved design rules (CardFoot, SegmentedField, toasts) into RM520N
status: closed
lane: full (tier 2, docs + primitives)
base: 0fbd9ee5   branch: wt/the101-design-parity-2 @ .claude/worktrees/design-parity   opened: 2026-10-06   lead: Sonnet 5.5 session rooted in QManager-the101

## Request
"This task includes another repo which is RM520N-GL. Now, since the101's conventions have since evolved (CardFoot, SegmentedField, toasts, Scanning Rules), I want you to also update the RM20N docs and design language / rules to adopt our the101 changes. I want it to basically have the 1:1 design philosophy."

## Decisions taken — do not re-ask
- 2026-10-06 Code scope: docs + rules + missing primitives, no page sweep.
- 2026-10-06 Card-Foot Apply Rule supersedes the page-level save bar (pending-save-bar / watchdog save-bar become Migration Deltas to retire).
- 2026-10-06 JetBrains Mono vendored via next/font/local; never next/font/google.
- 2026-10-06 Boolean preference -> SegmentedField, ported 1:1; 24 `<Switch` sites become a tracked Migration Delta.
- Preserved: Rethink Sans + JetBrains Mono (no Geist / font-numeric / Three-Voice), 5-catalog i18n parity, no test files.
- Routing: RM520N qm-* agents not dispatchable from a the101-rooted session; general-purpose / orchestra-verifier on sonnet, effort high, with RM520N's qm-worker contract named.
- Release notes: no bullet (internal docs/primitives, nothing user-visible).
- 2026-10-06 Close-out: user chose "Merge into development (Recommended)"; development had not moved (0fbd9ee5), fast-forward.

## Work
| id | task | write set | result |
|---|---|---|---|
| A/B/C | read-only recon: DESIGN.md gap, product/claude/reference/skills gap, code reality | none | DONE_WITH_CONCERNS x3 |
| W1 | DESIGN.md + .impeccable/design.json | those two | DONE_WITH_CONCERNS |
| W2 | PRODUCT, CLAUDE, docs refs, new toast-confirmation.md | docs | DONE_WITH_CONCERNS |
| W3 | qm-redesign-review, ui-builder, qm-verifier, verification.md | .claude | DONE |
| W4 | card-foot, clipboard, segmented-field, hint-icon, font vendoring | components/ui, lib, app/layout, fonts | DONE_WITH_CONCERNS |
| V | blind verifier (orchestra-verifier) | none | PASS_WITH_NOTES, all notes fixed in c8f34673 |

## Evidence
- Lead gates: tsc rc=0, eslint on touched files rc=0, icons:check 117 glyphs ok, `bun run build` rc=0 with no Google Fonts fetch.
- Verifier re-ran every Migration Delta count at HEAD: none off by more than 0.
- Lead error caught by the verifier: I called `SEGMENTED` in shapes.ts live from a name-only grep; the consumers import it from components/ui/segmented-field. Dead block removed.

## Open items
- Button primitive is `rounded-md` 36px while the target canon is the pill; recorded as a Migration Delta, Button code untouched.
- CLAUDE.md says reboots go through a dialog + banner; docs/FRONTEND.md hands off to /reboot/. Pre-existing inconsistency, not touched.
- Un-measured (marked so in the docs): Fact-Is-Info contrast on the amber Frequency Locking panel; whether the 5 "Saved" status lines fade.
