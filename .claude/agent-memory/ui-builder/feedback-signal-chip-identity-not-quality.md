---
name: feedback-signal-chip-identity-not-quality
description: User directive on the dashboard Primary signal cards — chip fill carries radio identity (NR blue / LTE violet), quality moves to the glyph; metric value tints stay green/amber/red for BOTH radios
metadata:
  type: feedback
---

On the shared `SignalStatusCard` ("5G NR Primary" / "4G LTE Primary"), the quality
chip's FILL carries **radio identity**, not quality: NR = `primary-container`,
LTE = `lte-container`. Quality moved entirely to the Material Symbols bar count,
using the constant-silhouette **wedge** family: `signal_cellular_4_bar` → `_3_bar`
→ `_2_bar` → `_1_bar` → `signal_cellular_off`. Do NOT use the `signal_cellular_alt*`
bar family the source mock drew, even though the mock pins it for Excellent and
Good: it only has three rungs, `alt_1_bar` is a ~2×4px speck at `size={16}`, and
Poor/None have to fall back to full wedges, so ink mass runs large → medium →
speck → large → large. The in-code comment that argued the opposite ("quality is
a status, so it reads on the status palette") was **explicitly overruled** by the
user on 2026-07-28 and has been deleted.

Separately and in the *other* direction: the metric values (RSRP/RSRQ/SINR) keep
**green / amber / red** for both radios. The mock tints some LTE values with its
violet `--s`; the user rejected that.

**Why:** the two cards sit side by side, so the fill's job is telling the pair
apart at a glance; the glyph is a stronger quality channel anyway
(`success-container` vs `warning-container` is 1.03:1 and identical under
deuteranopia). But the *measurements* are genuinely a health readout, so their
ink must stay on the status ramp — tinting them by radio would delete the only
good/bad signal on the card.

**How to apply:** don't "fix" the identity-toned chip back to `success`/`warning`
on a later pass, and don't extend the identity hue down into the value ink.
Identity roles `nr`/`lte` now exist in `badge.tsx`'s cva and are NOT status
roles — a real status indicator still uses the five status variants. See
[[feedback-signal-card-13px-off-ramp]].
