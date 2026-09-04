---
name: hidden-browser-pane-freezes-raf
description: While the Claude Browser pane is hidden, requestAnimationFrame and CSS animations never run even though document.hidden is false — which turns the pane into a free Non-Load-Bearing Rule test
metadata:
  type: reference
---

While the Browser pane is **hidden**, `requestAnimationFrame` never fires and CSS
animations do not advance — and `document.hidden` reports **`false`**, `visibilityState`
reports `"visible"`. Only `document.hasFocus()` is `false`, which is not a reliable
tell on its own.

**How you find out you are in this state:** a `javascript_tool` call that awaits a
rAF simply times out at 45s with "The Browser pane is currently hidden." That one
call is the cheapest possible diagnostic — run it before you believe any animation
finding:

```js
await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
```

**Two false bugs it manufactures, both of which look real in a screenshot:**

- **`SaveButton`'s three layers all read `opacity: 1` and overlap into unreadable
  text.** The layers are `motion.span`s driven only by `animate`; with no frame,
  none of them settles. Nothing is wrong with the button or its call site.
- **A `animate-in fade-in-0` entrance pins its element at `opacity: 0` forever.**
  The DOM is complete, there are zero console errors, and the panel is simply
  invisible. Same signature as [[reference_motion_bad_variant_name_renders_invisible_page]],
  different cause.

Waiting does not help — this is not the mid-fade timing issue the fixture-route
memory describes ([[reference-visual-verification-fixture-route]]). **Never judge
an animation from a screenshot here; read `getComputedStyle(el).opacity` instead.**

**Turn it into a test rather than working around it.** DESIGN.md's
Non-Load-Bearing Rule says that if a transition never runs, the UI must already be
correct. A hidden pane runs no transitions, so any element that is invisible or
wrong in it is a real violation. That is how the alerts Channels panel's
`animate-in` entrance was caught and removed: a navigation panel that only becomes
visible once a frame arrives fails the rule, and the Enter-Only Rule does not ask
for an entrance on navigation anyway.
