---
name: same-export-name-in-two-shape-modules
description: A retired export can stay greppable because a SIBLING family's shapes.ts exports the same name — verify the owning module, not the symbol
metadata:
  type: reference
---

Each `/cellular/` family owns its own `shapes.ts`, and they independently
minted **identically-named exports**. A repo-wide grep for a symbol therefore
proves nothing about the module you are documenting.

Measured 2026-08-31: `FIELD_SHELL_ON_FILL` was deleted from
`components/cellular/settings/shapes.ts` on 2026-08-30 with the dirty-row
promotion, but `components/cellular/sms/shapes.ts:375` still exports it and
`sms-forwarding-card.tsx` still consumes it. A grep returns three live hits, so
the settings-family doc read as current when three of its statements were dead
— including a `⚠️ WARNING` whose entire subject no longer existed.

**Why:** the families deliberately restate geometry rather than importing it
(only genuinely family-wide shapes belong one level up in
`components/cellular/`), so name collisions are structural, not accidental.
They will keep happening.

**How to apply:** when a doc claims an export exists or is gone, grep with the
module path pinned — `grep -n "NAME" components/cellular/<family>/shapes.ts` —
never bare across `components/`. And when a doc must mention a name that
survives elsewhere, say which module owns each one, or the next reader's grep
will "correct" you back. Related: [[commit-is-archive-doc-is-forward-looking]],
[[replace-dont-append-on-ui-rewrites]].
