---
name: reference-tailwind-scanner-needs-literal-bang
description: A class assembled across a template boundary (`${FIELD_HEIGHT}!`) is never generated — Tailwind's scanner only sees literal candidates, so put the `!` inside the const
metadata:
  type: reference
---

Tailwind v4 extracts candidates from **raw source text**. A class whose final
form only exists at runtime is never generated. So in a `shapes.ts`:

```ts
const FIELD_HEIGHT = "h-[2.625rem]";
SHELL: `${FIELD_HEIGHT}! w-full ...`   // ← "h-[2.625rem]!" appears NOWHERE literally
```

`h-[2.625rem]` gets a rule; `h-[2.625rem]!` does not. The composed class list
carries an **inert** class, so `select.tsx`'s `data-[size=default]:h-9` at
(0,2,0) wins outright and the field renders 36px — the exact defect the marker
was added to prevent, now invisible to tsc, eslint, the build, AND a
class-string grep.

Fix: put the whole class, bang included, in the const.

```ts
const FIELD_HEIGHT = "h-[2.625rem]!";      // literal → generated
export const FIELD = `${FIELD_HEIGHT} w-full ...`;
```

Interpolating a **whole** class is always safe; splitting one is never safe.
The same trap applies to a variant prefix (`` `dark:${FILL}` ``) and to a
trailing `/50`.

**Why:** `components/monitoring/alerts/shapes.ts` ships the unsafe form at
`FIELD.SHELL` (and the same pattern is available to copy in `CELL`, `SWITCH_ROW`,
`ROW`), so the next family that copies the house style inherits it. Verified by
reading the emitted CSS, not by reasoning — same discipline as
[[reference-custom-radius-overrides-lose-alphabetically]].

**How to apply:** whenever a shapes module names a height/fill once so a
skeleton can mirror it, check the const holds the *complete* utility. If the
call site needs `!` and the skeleton does not, give the skeleton the marked one
too — a `!important` height on a `Skeleton` competes with nothing.
