---
name: soft-nav-remount-keeps-fetch-shim
description: Use window.next.router.push() to soft-navigate away and back, remounting a page component while a console-installed fetch wrapper survives — the only way to exercise a first-fetch failure on a qm-preview fixture
metadata:
  type: reference
---

A `app/qm-preview/*` fixture installs its `window.fetch` shim at **module scope**, so states that
depend on the *first* fetch outcome (hard read error, malformed payload) cannot be reached by
`location.reload()`: a reload re-runs the fixture module and discards any wrapper you installed
from the console.

**The move:** wrap `window.fetch` once from the console with a mode flag, then remount the page
component with a SOFT navigation, which keeps the same `window`:

```js
window.next.router.push('/qm-preview/latency');   // away
await new Promise(r => setTimeout(r, 1000));
window.next.router.push('/qm-preview/alerts');    // back — component remounts, wrapper intact
```

`window.next` is exposed by `next dev` (App Router) and carries
`push / replace / back / forward / refresh / prefetch`. A plain `<a href>` will NOT work: the App
Router does not intercept bare anchors, so it does a full document load and drops the wrapper.

**How to apply:** any time a ticket says "exercise every state" and the fixture has no state
matrix, this reaches the mount-time branches — loading (add a `setTimeout` delay in the wrapper),
hard error, and partial payload — without editing `app/`, which is usually outside the write set.
Pair it with [[reference-visual-verification-fixture-route]].

**It does NOT work on a real feature route.** Measured 2026-09-05 on `/system-settings/`: a
`push('/dashboard/')` → `push('/system-settings/')` round trip changed `location.pathname` but the
page's data hook never re-ran its mount fetch, so the shim had no effect and the card stayed in the
error state it had before the shim existed. The App Router's client cache keeps the segment alive
across the round trip; only a fixture route (fresh each mount) reliably remounts.

**What works on a real route instead:** install the shim, then trigger the surface's OWN refetch —
click the card's retry / the page header's refresh, whatever is wired to the hook's `refresh()`.
That is a real user path, it re-enters the same code the mount fetch uses, and it doubles as proof
the retry affordance is actually wired. For the loading skeleton, give the shim a `setTimeout`
delay and screenshot during the window; for a stale-read notice, flip a mode flag to return 500 and
refresh again.

**Give that delay a finite length — a never-resolving `hang` mode WEDGES the surface.** A shim
returning `new Promise(() => {})` leaves `isLoading` true forever, and a page header's Refresh is
`disabled={isLoading}`, so the one lever that re-enters the fetch is now dead and the only way out
is a reload, which drops the shim. Measured 2026-09-05 on `/system-settings/`. Use
`await new Promise(r => setTimeout(r, 8000))` instead: long enough to measure the skeleton, and it
resolves on its own, so ONE click yields both halves of a loading→loaded delta in a single run.
