---
name: feedback-explanatory-copy-gets-cut
description: The user cuts standing explanatory paragraphs and hints from shipped surfaces; teach through labels, states and structure instead of prose
metadata:
  type: feedback
---

Standing explanatory prose gets cut. Do not add a paragraph whose job is to teach the reader what a control does, how long it takes, or which mode is default — carry that in the button label, the posture/state copy that only appears while it is true, or the structure itself.

**Why:** On 2026-08-14 the user removed, in one pass across `/cellular/cell-scanner/`:
- the run hero's required `COST` paragraph on BOTH scanning routes (the 2–3 minute sweep warning and the "costs nothing" neighbour line)
- the calculator's `hint_auto` pre-calculation hint ("Auto picks LTE or NR from the number's range")
- a duplicated count under the neighbour table

These were not sloppy copy — each had a several-paragraph rationale in its `shapes.ts` contract arguing it was load-bearing, and each was cut anyway. The pattern across the three: they were always-present prose explaining something the interface already demonstrated (distinct button labels, three visible mode tabs, a tally twelve pixels above). Compare [[feedback-middot-only-in-machine-voice-runs]] — same instinct, applied to glue characters.

**How to apply:** When a card design wants an info strip, an `info`-glyph note, or a "this takes N minutes" line, first check whether a label, a state-scoped line (only rendered while the state is true), or the layout already says it. Prefer *conditional* copy over standing copy: the calculator's note now renders only once there is a result to cite, and the scanner's duration expectation lives in `scanning_body`, visible only while a run is in flight. Honesty rules (State-Honesty, "make the dangerous obvious") are satisfied by a control that explains itself *at the moment it matters*, not by a permanent paragraph.

Corollary the same pass established: a card's empty state MAY own the primary action (the sweep's `Empty` + Start button) when the card is the whole page before anything runs — but not when a hero directly above already carries that button.
