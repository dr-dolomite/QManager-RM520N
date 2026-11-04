---
name: shared-primitive-classes-are-invisible
description: A class baked into a components/ui/** primitive renders on every page that uses it, but is invisible to any check scoped to one family's own files — never write "X does not render on this page" without opening the primitive
metadata:
  type: reference
---

Reasoning scoped to a family's own component files cannot see a class that ships inside a shared `components/ui/**` primitive. The primitive is not in the family's file set and never will be — it belongs to all of them.

**Why it matters for docs:** the natural sentence at the close of a re-author is "no retired ink left on this surface". That is true about the family's source and **false** about what the browser paints. Measured 2026-08-31 on the `/local-network/` re-author: `components/ui/card.tsx:51` bakes `text-muted-foreground text-sm` into `CardDescription`, and the reference implementation (`ethernet/speed-limit-card.tsx:137`) uses the primitive bare.

**How to apply:** before writing "X does not render here", ask whether X can originate in a shared primitive. If it can, open the primitive — or load the page — and record any gap as a Migration Delta. Same reasoning covers `empty.tsx`'s `md:p-12` and the `select.tsx` / `input.tsx` / `textarea.tsx` specificity cluster: a call site that "wins" only via an important modifier is a local patch over a delta, not a closed one.

Related: [[commit-is-archive-doc-is-forward-looking]].
