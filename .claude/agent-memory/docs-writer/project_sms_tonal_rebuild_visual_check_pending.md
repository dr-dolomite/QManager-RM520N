---
name: sms-tonal-rebuild-visual-check-pending
description: SMS Center + SMS Forwarding tonal rebuild (2026-07-31) shipped statically verified only; owner's live-device visual check still outstanding
metadata:
  type: project
---

The SMS Center and SMS Forwarding tonal rebuild closed on **2026-07-31** with `tsc`, `next build`, eslint, `i18n:check` (0 errors / 392 warnings) and `icons:check` all passing, but **no page was ever rendered**. The project owner's live-device visual check was still pending at close.

**Why:** the dev server redirects to `/setup/` without a backend, so authed routes cannot be screenshotted locally. This is the same class of gap `icon-system.md` already warns about for the 17 `/cellular/` sub-route conversion — the `has-[>svg]` layout-leak bug class is invisible to every automated check.

**How to apply:** `docs/reference/sms.md` and `sms-forwarding.md` each carry an explicit "verified statically only" warning. If the owner reports the visual check passed, remove those two warnings (and the SMS clause appended to the warning in `icon-system.md`). Until then, never write anything in these docs that implies the UI was seen.

Related open items recorded in the same pass: `components/ui/checkbox.tsx` and `components/ui/sonner.tsx` still leak lucide glyphs onto Material routes (recorded in `icon-system.md` > Known unfixed instances), and `SaveButton` hardcodes "Saving…"/"Saved!" so those strings stay English product-wide (recorded in `sms-forwarding.md` > Known gaps).
