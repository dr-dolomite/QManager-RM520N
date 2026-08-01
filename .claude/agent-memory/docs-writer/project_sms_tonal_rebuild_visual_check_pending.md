---
name: sms-tonal-rebuild-visual-check-pending
description: SMS Center + SMS Forwarding tonal rebuild (2026-07-31) shipped statically verified only; owner's live-device visual check still outstanding
metadata:
  type: project
---

The SMS Center and SMS Forwarding tonal rebuild closed on **2026-07-31** with `tsc`, `next build`, eslint, `i18n:check` (0 errors / 392 warnings) and `icons:check` all passing, but **no page was ever rendered**. The project owner's live-device visual check was still pending at close.

**Why:** the dev server redirects to `/setup/` without a backend, so authed routes cannot be screenshotted locally. This is the same class of gap `icon-system.md` already warns about for the 17 `/cellular/` sub-route conversion — the `has-[>svg]` layout-leak bug class is invisible to every automated check.

**How to apply:** `docs/reference/sms.md` and `sms-forwarding.md` each carry an explicit "verified statically only" warning. If the owner reports the visual check passed, remove those two warnings (and the SMS clause appended to the warning in `icon-system.md`). Until then, never write anything in these docs that implies the UI was seen.

**Extended 2026-08-01** by the save-flow / checkbox-slot change, which closed the three open items recorded above (`checkbox.tsx` got a `glyph` slot, `sonner.tsx` became a sanctioned route-agnostic lucide exception, `SaveButton` was rebuilt and fully keyed) **under the same caveat** — again zero pages rendered. The "visually unreviewed" warnings now also live in `dashboard-state-motion.md` > Part 3 and in `icon-system.md`'s `has-[>svg]` warning; clear all of them together when the owner confirms.

That change also revealed that the 392 warnings above were not noise: **98 of them were SMS keys that shipped English-only** in `it`/`id`/`zh-CN`/`zh-TW`, because `i18n:check` grades a missing key as a warning and still exits 0. Now backfilled; the tree is at 0/0. Documented in `i18n.md` > Validation policy and `sms-forwarding.md`.
