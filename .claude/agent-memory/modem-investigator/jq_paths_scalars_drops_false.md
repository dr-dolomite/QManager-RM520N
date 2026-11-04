---
name: jq-paths-scalars-drops-false
description: jq's paths(scalars) silently omits keys whose value is false or null — never use it to prove a field is absent from a payload
type: feedback
---

Never use `jq '[paths(scalars)|join(".")]'` as a field-presence map when the question is "is this optional field present?".

**Why:** `paths(f)` is defined as `paths | select(getpath($p) | f)` — the `select` tests the *truthiness* of the node, so any key whose value is `false` or `null` is dropped from the output even though it exists in the document. This bit a real probe: the speedtest result's `interface.isVpn` (value `false`) was missing from the generated key list while `result.persisted` (value `true`) was present, which would have been reported as a schema gap that does not exist.

**How to apply:** to enumerate real keys use `jq -c '[paths|map(tostring)|join(".")]'` (no filter), or check the specific field with `jq 'has("isVpn")'` / `jq '.interface|keys'`. When a probe claims a field is absent, confirm against the **raw JSON** before writing it into a report — the raw payload is the evidence, the jq projection is not.
