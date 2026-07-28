---
name: feedback-signal-card-13px-off-ramp
description: The 13px row type on the signal cards is an approved off-ramp size; the impeccable design hook flags it every time and it should stay
metadata:
  type: feedback
---

`signal-status-card.tsx` rows use `text-[13px]/5` for both `dt` and `dd`. 13px is
**not** on DESIGN.md's type ramp, so the `impeccable` PostToolUse hook raises
`design-system-font-size` on every edit to that file. It is approved and should
stay; no ignore-rule has been persisted, so expect the finding to recur.

**Why:** the value came from the approved mock (`QManager Dashboard Final.dc.html`
lines 106-112) and it is what lets seven rows fit the paired-card height without
the cards outgrowing their column.

**How to apply:** don't "fix" it to `text-sm`, and don't silently add a hook
suppression either — the user has not asked for one. Keep the explicit `/5`
leading: an arbitrary font-size otherwise inherits the surrounding leading, and
the loading skeleton's `h-10` rows depend on the line box being exactly 20px.
Related: [[feedback-signal-chip-identity-not-quality]].
