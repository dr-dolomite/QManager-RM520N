---
name: replace-dont-append-on-ui-rewrites
description: When a UI restructure lands, rewrite the affected doc sections in place — no "previously/now" running commentary, except a deliberate "do not restore" note for arrangements someone would helpfully reintroduce
metadata:
  type: feedback
---

When documenting a UI restructure, **REPLACE** the prose describing the old anatomy rather than appending a changelog paragraph beside it. The one exception is a retired arrangement that a future contributor would plausibly reintroduce as a "tidy-up" — record that as an explicit `> ⚠️ WARNING: do not restore …` note naming what it was and why it went.

**Why:** the user's reference docs are written as a single present-tense description of the correct target, the same way `DESIGN.md` is binding canon with no "in progress" hedging. Running before/after commentary makes a doc grow monotonically and forces every future reader to work out which paragraph is current. But the *reverse* failure is real too: on `/cellular/cell-locking/tower-locking` the locked-target panel and the per-leg "Tower lock" `Switch` were each independently reinvented across rebuilds, so their deletions are recorded on purpose. Both the doc and the source comments use this device deliberately.

**How to apply:** on any Phase 6 doc pass following a redesign — rewrite the anatomy sections, delete the retired constants from the geometry table into a short "Constants that no longer exist" table (so a stale search resolves to "gone on purpose"), and reserve do-not-restore warnings for the two or three shapes that were genuinely tempting. Related: [[1970-boot-window-timer-guard]].
