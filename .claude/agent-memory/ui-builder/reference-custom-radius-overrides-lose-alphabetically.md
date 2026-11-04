---
name: custom-radius-overrides-lose-alphabetically
description: RESOLVED — cn() now extends tailwind-merge with our radius names, so a custom rounded-* deduplicates the primitive's rounded-md and wins. The trailing `!` this file used to prescribe is no longer needed.
metadata:
  type: reference
---

**This is closed. Do not add `rounded-field!` / `rounded-card!` to new work.**

`lib/utils.ts:23` builds `cn()` from `extendTailwindMerge({ extend: { theme: {
radius: ["inline","field","tile","card","hero","pill"] } } })`, so twMerge knows
this repo's radius names and drops the losing one instead of letting both survive.

Verified by CALLING the merge, which is the only evidence this file ever accepted:

```
m("bg-accent animate-pulse rounded-md rounded-field")  -> "bg-accent animate-pulse rounded-field"
m("rounded-card rounded-hero")                          -> "rounded-hero"
```

**What the old rule said, and why it is dead.** Before the extension, `cn()` was
bare `tailwind-merge`: it could not dedupe a custom radius against a stock
`rounded-md`, both reached the class list, and the cascade decided by Tailwind's
alphabetical emission order — so `.rounded-md` came after `.rounded-field` and a
Skeleton rendered at the legacy 10.4px instead of the field radius. `pill` and
`tile` happened to sort after `md` and won by luck. The prescribed workaround was
a trailing `!`. All of that is now handled by the merge configuration.

The `!` spellings still in the tree are harmless but redundant. Related:
[[dark-fill-override-wins-by-source-order]], which is a different mechanism and
still live.

**The verification rule survives the fix:** never reason about `cn()`. Call
`twMerge` against the installed library, or grep the built CSS.
