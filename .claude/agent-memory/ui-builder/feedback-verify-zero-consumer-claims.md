---
name: verify-zero-consumer-claims
description: A brief's "field X is never read anywhere" is a census that may have missed a sibling file — grep before deleting or before "wiring the vestigial escape hatch"
metadata:
  type: feedback
---

Grep for a symbol repo-wide before acting on a brief that says it has zero consumers.

**Why:** On 2026-09-01 the connectivity-chip brief stated that `ok` on
`RealtimeDataPoint` (latency-monitoring-card.tsx) was "declared, written at two
sites, and **never read anywhere** — someone built the escape hatch for this
exact bug and never wired it. Consider wiring it or removing it." It is in fact
read by the sibling `ping-entries-card.tsx`, which uses it to print "Timeout"
instead of a latency number. Removing it would have broken the table; "wiring"
it would have duplicated behaviour that already exists. The census had looked at
one file, not the pair.

**How to apply:** Any brief clause of the form "nothing reads this" / "a census
found zero consumers repo-wide" is a claim to check, not a premise — one
`Grep` for the bare identifier costs a single call. Especially when the symbol
lives on an exported interface: the consumer is usually in the *other* file of
the pair, which is often outside the brief's edit allowlist and therefore
outside the files you were told to read. Report the correction rather than
silently keeping the field.
