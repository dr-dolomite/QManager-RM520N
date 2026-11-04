---
name: reference-recharts-range-area-and-tooltip-none
description: recharts 2.15.4 renders a min-max band natively from a [low,high] tuple dataKey, and tooltipType="none" is the only way to keep that band out of the shadcn tooltip
metadata:
  type: reference
---

Pinned recharts is **2.15.4**. Two facts verified in `node_modules`, not guessed:

- **A range/spread band needs no stacked base+delta pair.** `Area.getComposedData`
  (`node_modules/recharts/es6/cartesian/Area.js:462-500`) checks `Array.isArray(value)` per point;
  a tuple sets `isRange` and it builds a per-point `baseLine`. So a datum field shaped
  `[number, number] | null` plotted with a plain `<Area dataKey="spread">` draws the band. A `null`
  becomes `[baseValue, null]`, which is a break point, so `connectNulls={false}` breaks it correctly.
- **`tooltipType="none"` on the `Area` is what hides it from the tooltip.** `Area.d.ts:40` carries the
  prop, and `components/ui/chart.tsx`'s `ChartTooltipContent` filters on `item.type !== "none"`.
  Without it a band row prints its raw tuple next to the real series.

Related gotcha in the same primitive: `ChartTooltipContent`'s `labelFormatter` receives the *config
label*, not the x value, whenever the `XAxis` `dataKey` is **not** a string (a numeric timestamp, say)
— `typeof label === "string"` gates that branch. Read the stamp off the second argument
(`items[0].payload.<field>`) instead.

See [[reference-visual-verification-fixture-route]] for how to actually look at the result.
