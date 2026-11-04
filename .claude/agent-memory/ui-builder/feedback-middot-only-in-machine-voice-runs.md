---
name: feedback-middot-only-in-machine-voice-runs
description: The `·` glue character survives only between two peers inside one machine-voice run with no room for labels; everywhere else label the value and let layout separate
metadata:
  type: feedback
---

A middot (`·`) in UI copy survives **only** where it separates two peers inside a single machine-voice (mono/tabular) run that has no room for labels — e.g. a tally like `3 LTE · 2 NR` in a 12px mono line. Everywhere else, give the value a label and let layout do the separating.

**Why:** the user called out `/cellular/cell-locking/tower-locking` (2026-08-11) for leaning on `·` as generic glue — `"{{count}} carriers · {{mhz}} MHz"`, `"{{channel}} · PCI {{pci}}"`, `"Custom: {{channel}} · PCI {{pci}}"`. A middot used as a comma substitute reads as machine output in surfaces that are otherwise prose, and it stacks badly once a locale's words get longer.

**How to apply:** when writing or reviewing any i18n string, ask whether both operands are already labelled and sitting in one mono run. If yes, keep the middot. If either side is prose, or a label would fit, reword — a comma, a preposition ("on", "across"), or a real label. Note that zh locales use `，` / `、` rather than `·` for the prose cases.

**Gotcha when reworking a shared key:** a key like `tower_locking.live.rail_target_pair` may have call sites that pass an ALREADY-PREFIXED value (`channel: "EARFCN 1300"`) alongside ones that pass a bare number. Adding a label into the string itself then yields "Channel EARFCN 1300". Check every call site before adding a word; changing the string while preserving the key path and its params is what keeps a parallel builder's work intact.

Related: [[reference-no-prettier-in-repo]]
