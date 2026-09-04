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
