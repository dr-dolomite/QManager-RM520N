---
name: harness-green-is-family-scoped
description: A design-language harness's class bans grep only the family's own files, so a retired class living in a components/ui primitive stays invisible — never write "GREEN, so X does not render on this page"
metadata:
  type: reference
---

A `*-design-language.sh` harness's "retired ink / legacy radius" bans are greps over a **hand-listed set of the family's own component files**, comment-stripped. They cannot see a class that ships inside a shared `components/ui/**` primitive, because that file is not in the list and never will be — putting it there would fail every family at once.

**Why it matters for docs:** the natural sentence to write at the close of a re-author is "pinned by `<harness>`, GREEN at N/0". That is a true statement about the family's source and a **false** one about what the browser paints. Measured 2026-08-31 on the `/local-network/` re-author: `components/ui/card.tsx:51` bakes `text-muted-foreground text-sm` into `CardDescription`, the reference implementation (`ethernet/speed-limit-card.tsx:137`) uses the primitive bare, and the harness's `[8]` ban was green the whole time.

**How to apply:** before writing "the harness pins X", ask whether X can also originate in a shared primitive. If it can, either say what the harness actually covers ("no retired ink in the family's own source") or check the primitive yourself and record the gap as a Migration Delta. The same reasoning covers `empty.tsx`'s `md:p-12` and the `select.tsx` / `input.tsx` / `textarea.tsx` specificity cluster — a call site that "wins" only because it carries an important modifier is a local patch over a delta, not a closed one.

Related: [[commit-is-archive-doc-is-forward-looking]] — the commit body will claim the fix landed; the primitive is where to check whether it landed everywhere.
