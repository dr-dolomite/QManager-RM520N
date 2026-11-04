---
name: reference-fetch-shim-must-handle-url-objects
description: A window.fetch shim that reads `input.url` breaks Next's RSC fetch (it passes a URL object), forcing a hard navigation that wipes the shim
metadata:
  type: reference
---

Next's client router calls `fetch(new URL(...))` for the RSC payload. A shim written as `typeof input === "string" ? input : input.url` gets `undefined` for a URL object, throws, and Next logs "Failed to fetch RSC payload ... Falling back to browser navigation" — a full reload that discards the shim, so the route mounts against the real (404) backend.

**Why:** cost one round on /monitoring/alerts (2026-10-12); the page rendered its error state instead of shim data.

**How to apply:** resolve the URL as `String(input instanceof Request ? input.url : input)`. Or skip soft-nav entirely: load the route, install the shim, then click the surface's own Refresh (see [[reference-locales-are-statically-bundled]]).
