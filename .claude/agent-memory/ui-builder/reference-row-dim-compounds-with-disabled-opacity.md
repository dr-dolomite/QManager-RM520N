---
name: row-dim-compounds-with-disabled-opacity
description: A held/dimmed settings ROW must put its opacity on the text column, never on the row root — every disabled control already ships disabled:opacity-50 and opacity compounds down the tree to 0.30
metadata:
  type: reference
---

When a settings row is "held" (its control disabled by a condition elsewhere —
a gating switch above it, a SIM profile owning the setting), put the dim on the
row's TEXT column, not on the row root.

**Why:** every disabled control in this system carries `disabled:opacity-50` —
`switch.tsx`, `select.tsx`, and the shared `FIELD` constants in every family's
`shapes.ts`. CSS `opacity` composites per element and COMPOUNDS through the
tree, so a row root at `opacity-60` wrapping a control at `disabled:opacity-50`
renders that control at 0.30. On a settings surface the held field is usually the
one still displaying the device's current value, so the compounding hides the
exact number the row exists to report. It also looks approximately right in a
screenshot, which is why it survives review.

**How to apply:** `<div className={ROW.ROOT}>` stays undimmed;
`<div className={cn(ROW.TEXT, held && ROW.HELD)}>` carries the dim. The control
keeps the single disabled treatment the whole product shares. Document the
constraint on the `HELD` constant itself in `shapes.ts`, because the wrong
placement is the intuitive one.
