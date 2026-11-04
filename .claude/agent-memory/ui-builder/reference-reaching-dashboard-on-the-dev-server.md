---
name: reaching-dashboard-on-the-dev-server
description: How to actually load an authed route like /dashboard in the Browser pane against `next dev`, and the two things that block it (an https upgrade on navigate, and the login gate)
metadata:
  type: reference
---

Two blockers sit between a running `next dev` and an authed route, and neither
announces itself as what it is.

1. **`navigate` upgrades a bare or http localhost URL to https and the tab dies
   silently.** The error reads "navigation to http://localhost:3010 was denied
   or failed", then the tab's origin shows `https://localhost:3010` and every
   later `screenshot` / `get_page_text` returns an empty non-http page — which
   looks exactly like an infinite render loop. `preview_start` with the full
   `url` (e.g. `http://localhost:3010/dashboard`) navigates correctly where
   `navigate` refuses, and `javascript_tool` setting `location.href` to an
   absolute `http://` URL works too.

2. **The route gate is a client-side cookie.** `document.cookie =
   "qm_logged_in=1; path=/"` then navigating reaches `/dashboard` with no
   backend at all — every CGI call 404s, so the surface renders its error and
   empty states, which is usually the more interesting screenshot anyway.
   Without the cookie you land on the onboarding splash and can spend a while
   thinking the route is broken.

**Screenshots lie more than the DOM here.** A `screenshot` timing out with
"the page did not finish rendering in time", or returning solid black on a page
whose `get_page_text` is full of content, is a compositing artifact of this
pane, not a blank render. To prove a motion cascade actually settled, measure it:
`getComputedStyle(el).opacity` / `.transform` over the container's children, and
a sweep for any element in `main` still below opacity 1. That is the only check
that distinguishes "frozen at `initial`" from "the frame did not composite".

Related: [[reference-visual-verification-fixture-route]],
[[reference-preview-start-serves-repo-root]].
