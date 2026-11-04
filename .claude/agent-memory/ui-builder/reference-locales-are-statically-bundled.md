---
name: reference-locales-are-statically-bundled
description: Locale packs are static ESM imports, not runtime fetches — so a fetch shim cannot inject a key, and an unwritten key renders its own dotted path (a clean verification signal)
metadata:
  type: reference
---

`lib/i18n/resources.ts` imports all five packs with `import enSystemSettings from "@/public/locales/en/system-settings.json"`. There is NO http-backend and no runtime GET for a bundled language — the comment says so explicitly ("Bundle-only: the whole locale catalog rides the existing out/ → www deploy path").

**Consequences when verifying a UI change in the browser:**

- A `window.fetch` shim can force any CGI state, but it **cannot** add an i18n key. There is no request to intercept.
- A key you used in code but have not written into the JSON renders as its own dotted path — `band.reboot.never`, `known_sims.remembered_unknown`. That is not a failure; it is the **most precise possible evidence of which branch fired**, better than the English would be. Report it verbatim alongside the intended string.
- Only a *downloaded* (non-bundled) pack hydrates at runtime via `addResourceBundle`, so that is the only case where a network path exists.

**How to force backend state on a REAL route (no fixture needed):** install the fetch shim after load, then click the surface's own Refresh button. The page's `refresh()` re-runs every lifted hook's GET, so the whole surface re-derives without a remount — no need to defeat Next's segment cache. Match endpoints with `url.includes("settings.sh")`; return `new Response(JSON.stringify(body))` for a good read and `new Response("", {status:500})` for a failed one. A failed refresh over cached data is exactly how you reach a *stale* state, which a fresh mount can never produce.

Related: [[reference-visual-verification-fixture-route]], [[reference-soft-nav-remount-keeps-fetch-shim]], [[reference-hidden-browser-pane-freezes-raf]] (the pane can stay hidden — DOM text and classList read fine while motion is frozen at opacity 0).
