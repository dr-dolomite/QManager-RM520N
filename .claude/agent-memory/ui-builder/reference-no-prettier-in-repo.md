---
name: reference-no-prettier-in-repo
description: The repo has no prettier dependency or config; `bunx prettier --check` downloads a default-config prettier that fails on untouched files too
metadata:
  type: reference
---

QManager-RM520N has **no prettier** — not in `package.json` dependencies, and no
`.prettierrc*` / `prettier.config.*` anywhere. The only formatting/lint gate is
`bun run lint` (`eslint`).

**Why this matters:** `bunx prettier --check <file>` still *runs* — bun silently
downloads a transient prettier with stock defaults. It then reports style issues
on the file you just wrote, which reads like you malformed it. Verified
2026-08-11: untouched `components/cellular/band-locking/shapes.ts` and
`components/cellular/tower-locking/simple-mode-utils.ts` fail the identical
check.

**How to apply:** When a brief says "run prettier if the repo has it configured",
the answer here is *it does not* — say so and skip it. Do not run
`bunx prettier --write`; stock defaults will reflow the file away from the
house style (the codebase keeps some 80+ char single-line string exports that
prettier would break). Validate with `bunx eslint <file>` and
`bunx tsc --noEmit` instead.
