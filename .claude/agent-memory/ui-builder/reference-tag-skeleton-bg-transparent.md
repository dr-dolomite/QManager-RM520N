---
name: tag-skeleton-bg-transparent
description: A Skeleton that mirrors geometry via tagVariants()/badgeVariants() renders invisible or mis-tinted unless bg-accent is restored explicitly
metadata:
  type: reference
---

The house idiom for an honest skeleton is to hand `Skeleton` the real
component's own class string (`cn(tagVariants({variant}), w)`) so its height
derives from the component instead of a restated `h-5`. That idiom has a trap
on the two chip primitives:

- `components/ui/tag.tsx`'s base carries **`bg-transparent`** — an outline tag
  has no fill, that IS its construction. `Skeleton` composes as
  `cn("bg-accent animate-pulse rounded-md", className)`, so the caller's class
  wins and the placeholder shimmers as a rectangle of nothing. It looks like
  the skeleton "didn't render".
- `components/ui/badge.tsx`'s status roles carry a real container fill
  (`bg-surface-container-high` etc.), so a badge-shaped skeleton pulses in the
  role's own colour and reads as a finished chip rather than a placeholder.

Fix both by appending `"border-transparent bg-accent"` **after** the variant
call, never before — `cn` keeps the last class in the `bg-*` / `border-color`
groups.

Nothing type-checks or lints this: the class strings are valid, so it ships
silently. Related: [[reference-input-primitive-modifier-classes-survive-cn]] is
the same family of defect — a primitive's own classes surviving an override.
