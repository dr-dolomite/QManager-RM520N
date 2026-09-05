---
name: hidden-browser-pane-freezes-raf
description: While the Claude Browser pane is hidden, requestAnimationFrame and CSS animations never run even though document.hidden is false — which turns the pane into a free Non-Load-Bearing Rule test
metadata:
  type: reference
---

While the Browser pane is **hidden**, `requestAnimationFrame` never fires and CSS
animations do not advance. `document.hidden` is not a dependable tell either way:
it has reported **`false`** in this state, and on 2026-09-05 it reported **`true`**
while the pane still painted on demand. Check the rAF probe below, not the flag.

**A hidden pane also reports `innerWidth`/`innerHeight` of 0**, so every
`getBoundingClientRect()` comes back with width 0 and the page has no layout at all.
`resize_window` with an explicit width/height forces a real viewport and layout
resolves — do that first, before you conclude anything from a measurement.

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

**If you must see the settled state, clear framer's inline styles — do NOT inject
`*{opacity:1!important}`.** The blanket override is tempting and it does unfreeze
the cascade, but it silently clobbers every legitimate `opacity-*` utility in the
tree, so a dim-ink token measured under it reads `opacity: 1` and looks like a
missing class. Clear only what framer parked instead, which sticks precisely
because no frame will re-apply it:

```js
root.querySelectorAll('*').forEach(e => {
  if (e.style && e.style.opacity === '0') { e.style.opacity = ''; e.style.transform = ''; }
});
```

**Turn it into a test rather than working around it.** DESIGN.md's
Non-Load-Bearing Rule says that if a transition never runs, the UI must already be
correct. A hidden pane runs no transitions, so any element that is invisible or
wrong in it is a real violation. That is how the alerts Channels panel's
`animate-in` entrance was caught and removed: a navigation panel that only becomes
visible once a frame arrives fails the rule, and the Enter-Only Rule does not ask
for an entrance on navigation anyway.
