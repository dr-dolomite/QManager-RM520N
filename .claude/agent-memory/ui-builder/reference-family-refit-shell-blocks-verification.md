---
name: family-refit-shell-blocks-verification
description: In a parallel card-by-card family refit, the page shell is updated LAST, so every card worker's route 500s and browser verification is impossible until the shell lands
metadata:
  type: reference
---

When an orchestrated run re-authors several cards in one route family in parallel, the shared page shell (`alerts.tsx`, `network-events.tsx`, etc.) is updated by a separate worker, usually last. Until it lands, its stale `import { OldName } from "./card"` fails to resolve and **the whole route 500s** — so `tsc --noEmit` and the dev-server page both report a sibling's error, not yours, and the loaded-page check the repo requires cannot be run.

**Why:** observed 2026-09-05 on the `/monitoring/alerts` refit. Renaming an exported skeleton in one card broke `alerts.tsx`, which was outside that worker's write set. Two other siblings had the same class of breakage in flight simultaneously.

**How to apply:**
- If you rename an export a shell still imports and you cannot edit the shell, **keep a one-line alias export** (`export { NewName as OldName };`) so the family keeps compiling while the run converges. Report the canonical name.
- Do not read a family-mate's compile error as evidence your own file is wrong: check whether the failing line is in a file you own.
- Budget for the fact that a card worker may have to report the browser check as blocked. Say so explicitly with the exact blocking import rather than claiming the page was loaded.
