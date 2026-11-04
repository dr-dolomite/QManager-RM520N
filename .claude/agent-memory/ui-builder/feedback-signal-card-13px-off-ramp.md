---
name: feedback-signal-card-13px-off-ramp
description: Approved off-ramp font sizes on the dashboard (13px signal rows, 44/52/26px speedtest numerals, 11/17px latency tile) — the impeccable hook flags them every edit and they stay
metadata:
  type: feedback
---

Several dashboard surfaces carry literal font sizes that are **not** on
DESIGN.md's type ramp, so the `impeccable` PostToolUse hook raises
`design-system-font-size` on every edit to those files. All are approved and
should stay; no ignore-rule has been persisted, so expect the findings to recur:

- `signal-status-card.tsx` — `text-[13px]/5` on both `dt` and `dd`
- `speedtest-dialog.tsx` — 44px ping / 52px live throughput / 26px result tile
- `live-latency.tsx` — 11px `agoLabel` + unit, 17px speedtest-tile figure

The speedtest and latency values are self-documenting: each file carries a
header/inline note ("DISPLAY NUMERALS", and "Do not 'correct' these to
text-base/text-xs") explaining why. Read the note before acting on the hook.

**Why:** the value came from the approved mock (`QManager Dashboard Final.dc.html`
lines 106-112) and it is what lets seven rows fit the paired-card height without
the cards outgrowing their column.

**How to apply:** don't "fix" it to `text-sm`, and don't silently add a hook
suppression either — the user has not asked for one. Keep the explicit `/5`
leading: an arbitrary font-size otherwise inherits the surrounding leading, and
the loading skeleton's `h-10` rows depend on the line box being exactly 20px.
Related: [[feedback-signal-chip-identity-not-quality]].
