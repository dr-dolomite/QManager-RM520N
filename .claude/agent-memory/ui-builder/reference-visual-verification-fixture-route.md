---
name: visual-verification-fixture-route
description: How to stand up a throwaway app/qm-preview/ route for visual verification on this repo, and the three environment traps that cost a round each
metadata:
  type: reference
---

For visual verification of a hook-backed surface, compose the **presentational**
components against hand-written mock data in a throwaway `app/qm-preview/page.tsx`.
Do not try to shim `authFetch` — the hooks poll, so each state would need its own
per-instance canned response and the shim gets fragile fast.

**How to drive it without 30 screenshots:** put the state id in the URL **hash**
(`#sweep-rich`), read it with a `hashchange` listener, and switch with
`javascript_tool` (`location.hash = '#x'`). A hash change re-renders without a
reload, so a whole state matrix is one page load. Append a container width to the
same hash (`#sweep-rich@390`) and apply it as a wrapper `maxWidth` — that is the
correct way to exercise container queries, and it also works when
`resize_window` silently no-ops (it did).

**Three traps, each cost a round:**

1. **`bunx next dev -p 3010` backgrounded with a trailing `&` reports exit 0 but
   the server IS running.** A second launch then dies with `EADDRINUSE` and looks
   like a failure. Check with `curl` before relaunching. `/qm-preview` returns
   **308** — this project has `trailingSlash`, so hit `/qm-preview/`.
2. **A Chrome tab can wedge so that every `computer:screenshot` fails with
   "Script injection timed out".** It looks exactly like an infinite render loop
   in the component you just loaded, and it survives navigation within the same
   origin. Before blaming the code, close the tab and open a new one — a route
   that "hangs" in a wedged tab renders instantly in a fresh one.
3. **Deleting the fixture leaves `.next/types/validator.ts` importing
   `app/qm-preview/page.js`, so `tsc --noEmit` fails on a file you deleted.**
   `rm -rf .next && bunx next typegen` clears it. Same family as
   [[reference_worktree_needs_next_typegen]].

Framer Motion row cascades mean the **first** screenshot after a state switch
catches rows mid-fade — wait ~2s before capturing a table, or you will report
missing rows that are simply still animating in.
