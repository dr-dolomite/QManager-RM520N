# Run: Widen card-sheen to all four overlays + reset RELEASE_NOTES to v0.1.16
status: closed
lane: lite
base: 41219df   branch: development   opened: 2026-09-14   lead: opus

## Request
Attend two items flagged at the close of the radius/sheen run, and strip the stale
v0.1.15 entries from RELEASE_NOTES so only v0.1.16 work remains.

## Decisions taken — do not re-ask
- GATE 2026-09-14: user chose **all four overlays**. card-sheen widened to
  AlertDialogContent / SheetContent / DrawerContent; drawer also gains the `shadow-lg`
  fallback it never had. The Card-Sheen Rule is restated as "Card root + any floating
  surface over a scrim" in DESIGN.md and CLAUDE.md.
- Item 2 (the `cn()` false claim in the ui-builder agent-memory and
  cellular-settings-family.md) needed no action — both were already rewritten as
  resolved in the previous run.
- **Correction to the previous ledger.** It recorded "v0.1.15 never shipped" and pinned
  `### Upgrading from v0.1.14`. The GitHub release v0.1.15 was published 2026-09-10 and
  its body carries all eight bullets the v0.1.16 draft still held. Upgrading-from is now
  **v0.1.15** and those eight bullets are removed as shipped.
- No device work. Device untouched.

## Findings that survive
- The four overlays diverged on shadow, not just sheen: dialog/alert-dialog/sheet all
  ship `shadow-lg`; `drawer.tsx` shipped none. Widening the sheen without the shadow
  would have left drawer the only overlay with no separation cue in either theme.
- drawer.tsx still has **zero** consumers and is tree-shaken out of the bundle — the two
  sheened strings that reach `out/_next/static/chunks/` are alert-dialog and sheet.
  Styled anyway so the primitive is correct the day it gains a call site.
- `cn()` preserves `card-sheen` even when a caller overrides the fill
  (`cn("card-sheen bg-surface …", "bg-background")` -> `card-sheen … bg-background`).
  twMerge has no group for it.

## Proof
- `.card-sheen{background-image:var(--card-sheen)}` plus both theme values present in
  the emitted CSS chunk.
- Browser pane, dark: `card-sheen bg-surface` computes
  `linear-gradient(lab(100 0 0 / 0.045) 0%, lab(100 0 0 / 0) 42%, lab(0 0 0 / 0.03) 100%)`;
  bare `bg-surface` computes `none`.
- Gates: `bunx tsc --noEmit` 0 · `bun run build` 0, no CSS-optimizer warning ·
  `bun run i18n:check` 0 errors, 26 pre-existing passthrough warnings, no new keys.

## Device state
Not touched. No deploys in this run.

## Handoff — NEXT ACTION
CLOSED. Not merged to main — release is the user's act. RELEASE_NOTES now holds exactly
two bullets (radius/sheen, overlay sheen) and `### Upgrading from v0.1.15`.
