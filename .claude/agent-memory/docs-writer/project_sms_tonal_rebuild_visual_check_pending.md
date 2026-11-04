---
name: sms-tonal-rebuild-visual-check-pending
description: SMS visual-verification status — SMS Center cleared 2026-08-20 on a fixture route; SMS Forwarding still unverified (needs a live backend), and the sibling "statically verified only" warnings elsewhere are still open
metadata:
  type: project
---

The SMS Center and SMS Forwarding tonal rebuild closed on **2026-07-31** with `tsc`, `next build`, eslint, `i18n:check` (0 errors / 392 warnings) and `icons:check` all passing, but **no page was ever rendered**. The project owner's live-device visual check was still pending at close.

**Why:** the dev server redirects to `/setup/` without a backend, so authed routes cannot be screenshotted locally. This is the same class of gap `icon-system.md` already warns about for the 17 `/cellular/` sub-route conversion — the `has-[>svg]` layout-leak bug class is invisible to every automated check.

**Updated 2026-08-20 (design-conformance pass).** The **SMS Center** half is now visually verified — on a throwaway `app/` fixture route (since removed), in both light and dark themes: neutral-bodied tiles with a single coloured disc, all eight tiles (five loaded + three skeleton) measuring exactly 104px in the DOM, and the `0 / 35` SIM reading rendering an empty track rather than a zero-length fill. `docs/reference/sms.md`'s blanket "statically only" warning is replaced by a scoped note saying what was and was not seen.

**SMS Forwarding is still unverified** and its warning in `sms-forwarding.md` stays: the surface needs a live backend to reach its loaded state, so no fixture route can render it.

**How to apply:** never write anything implying the forwarding UI was seen. The sibling warnings in `dashboard-state-motion.md` > Part 3 and `icon-system.md`'s `has-[>svg]` warning are **also still open** — the 2026-08-20 pass did not touch those surfaces. Clear each one only against evidence for that specific surface, not as a group.

The 2026-07-31 → 08-01 follow-up also revealed that the 392 warnings above were not noise: **98 of them were SMS keys that shipped English-only** in `it`/`id`/`zh-CN`/`zh-TW`, because `i18n:check` then graded a missing key as a warning and still exited 0. Backfilled; the tree is at 0 errors / 2293×5. Documented in `i18n.md` > Validation policy and `sms-forwarding.md`.
