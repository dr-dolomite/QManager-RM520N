---
name: custom-radius-overrides-lose-alphabetically
description: A theme radius (rounded-field/card/hero/inline) on a Skeleton silently loses to the primitive's own rounded-md; verified in built CSS, and the fix is a trailing `!`
metadata:
  type: reference
---

`cn()` is bare `tailwind-merge`, which does not know this repo's custom radius
names (`field` / `card` / `hero` / `inline` / `pill` / `tile`). It cannot dedupe
them against a stock `rounded-md`, so **both survive into the class list** and the
CASCADE decides — by the order Tailwind emits the rules, which is alphabetical by
utility name.

**Verified in built CSS on 2026-08-31** (`out/_next/static/chunks/*.css`, after
`bun --bun next build`):

```
.rounded-field{        <- emitted FIRST
.rounded-field\!{
.rounded-md{           <- emitted LATER, therefore WINS
```

So `<Skeleton className={cn(SOMETHING, "rounded-field")} />` renders at **6px**,
not 20px — `Skeleton`'s own base class is `"bg-accent animate-pulse rounded-md"`.
`pill` and `tile` sort after `md` and win **by luck**, not by design.

**The fix is the Tailwind v4 important modifier:** `rounded-field!`. It compiles
to `.rounded-field\!{border-radius:1.25rem!important}` and wins in both
directions. Same instrument as [[dark-fill-override-wins-by-source-order]].

**How to apply:** whenever a custom `rounded-*` is handed to a primitive that
already declares one — `Skeleton` above all, since the Skeleton-Mirror Rule
means every loading branch does this — write the `!`. No lint rule, no harness
and no type sees it, and the failure is a 6px skeleton standing in for a 20px
block, which reads as "slightly off" rather than as a bug. ~20 call sites across
the product still have the un-`!`'d spelling; they are a separate cleanup, but do
not add a new one.

**Never verify this by reasoning about `cn()`.** Grep the built CSS — the source
order is the only evidence.
