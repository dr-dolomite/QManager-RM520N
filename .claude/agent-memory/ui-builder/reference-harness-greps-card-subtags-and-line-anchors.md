---
name: harness-greps-card-subtags-and-line-anchors
description: When a harness assertion disagrees with the reference implementation it points you at, run its own grep by hand — twice now the harness was wrong, and contorting the code to satisfy it manufactured divergence between sibling families
metadata:
  type: reference
---

**Both concrete defects below are FIXED** (`56a7778`, 2026-08-31). They are
recorded because the *pattern* recurs and the recovery is what matters, not
because the greps still behave this way.

`scripts/test/local-network-settings-design-language.sh` shipped two grep shapes
that a builder copying the shipped reference implementation would fail, with no
hint in the failure message about why:

**1. `<Card` matched every Card sub-primitive.** `[5]` called
`open_tags "$path" 'Card'` = `grep -oE "<Card[^>]*>"` over the newline-flattened
file, then required the literal `CARD_SHELL` in every match. `<CardHeader …>`,
`<CardTitle …>` and `<CardContent …>` all matched and none can carry
`CARD_SHELL`. Now requires whitespace, `/` or `>` after the tag name.

**2. `grep -E '^export const CARD_SHELL'` read ONE line.** `[5]` then tested that
line for `rounded-card`, `border-0` and `shadow-[var(--shadow-whisper)]!`. A
declaration wrapped after the `=` handed the assertion
`export const CARD_SHELL =` and nothing else, so it reported a missing radius
against a shell that had one. Now reads the whole declaration through the
terminating `;`.

**What made them provable rather than arguable:**
`components/local-network/ethernet/speed-limit-card.tsx:134-139` uses
`<CardHeader>` / `<CardTitle>` / `<CardDescription>`, and `ethernet/shapes.ts:231`
wraps `CARD_SHELL` after the `=`. Ethernet is not in this harness's file list, so
both spellings are correct there and both failed here. **An assertion that the
reference implementation cannot pass is a defect in the assertion.** That is a
one-command check, and it settles the question without debate.

**What the wrong recovery cost.** Three builders ran in parallel. Two deleted the
header primitives and hand-rolled `<h2>`/`<p>`; the third kept them under invented
`CARD_SHELL_HEAD`/`_TITLE`/`_DESC`/`_BODY` names. Three sibling families, three
spellings of one thing — which is the exact divergence the re-author existed to
remove, manufactured by the test meant to prevent it. It took a fourth pass to
normalise them back. `CLAUDE.md` states the convention outright ("CardHeader:
Always plain CardTitle + CardDescription without icons"), so the code was right
and the harness was wrong the whole time.

**How to apply:** when a harness assertion disagrees with the reference
implementation it points you at, run its own grep/awk by hand before changing any
code. If the reference fails it, say so and get the harness fixed — do not
contort the component to satisfy it, and above all do not invent a local
workaround, because a parallel sibling will invent a different one.

Related: [[reference-awk-range-collapses-to-one-line]] — the same file uses
`awk '/^export const DELTA/,/;/'`, which collapses to a single line whenever the
opening line also ends in `;`.
