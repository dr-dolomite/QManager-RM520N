---
name: stretched-grid-hides-skeleton-delta
description: In a card grid with items-stretch + *:h-full, two cards in a row share one height, so a card-level skeleton→loaded measurement reports the row max and silently hides the shorter card's under-statement — measure CardContent instead
metadata:
  type: reference
---

A family grid built as `items-stretch ... *:h-full` (`/system-settings`' `CARD_GRID`, and the same
construction in several `/local-network/` families) equalises every card in a row. So
`card.getBoundingClientRect().height` is **max(card A, card B)**, not the card you are measuring.

**Why it misleads:** measured 2026-09-05 on `/system-settings/`, both cards in row 1 read 530.50
loading and 611.25 loaded — one number, two different defects. The Time & Units skeleton was 80.75
short (missing Save row + a wrapped consequence line); the Scheduled Reboot skeleton was short by a
similar amount for entirely different reasons (missing receipt strip, a Switch-less row 1). Fixing
only one card makes the ROW stop jumping, so a card-level measurement then reports success for a
sibling that is still wrong.

**How to apply:** measure `[data-slot=card-content]`, and its direct children, per card — that is
the card's own content and it is not equalised. Card height = content + a fixed chrome constant
(118.50px for this family's header + padding), so you can still report card-level numbers.
Second consequence: a skeleton whose group carries `min-h-0 flex-1` is STRETCHED to fill the locked
cell, so its slivers sit at the top over dead space rather than resolving to the loaded height —
the placeholder can be 50px short and look fine, which is exactly how such a miss survives review.
Pair with [[reference-soft-nav-remount-keeps-fetch-shim]] for driving the two states.
