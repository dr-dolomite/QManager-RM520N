---
name: jq-default-masks-absent-key
description: A jq `//` default turns an ABSENT key into a truthy sentinel, never null — so a doc claiming a field "is null when missing" can be structurally impossible
metadata:
  type: reference
---

When a QManager shell producer stops writing a key, a downstream `jq '(.key // "unknown")'` piped through `--arg` emits the **string** `"unknown"` forever — never `null`. A consumer guarding on truthiness can never see through it, so a documented "rolling-upgrade fallback to null" can be unreachable code that no reviewer notices.

**Why:** this is how `connectivity.state` stayed the string `"unknown"` for six weeks after the ICMP ping port (fixed 2026-09-01), pinning the dashboard's Internet chip grey on every shipped device. Three layers each carried a guard, and each assumed another was authoritative. The type's own doc comment described a `null` the pipeline could not emit — the comment is what made later readers believe the fallback worked.

**How to apply:** when documenting any poller/daemon field, do not write "null when missing" unless you have read the emit and confirmed a real JSON null is produced (the guarded-sentinel pattern: carry `"null"` through the shell, then `if $x == "null" then null else $x end`). Where a producer's key set is fixed, document the **complete** key list as a contract in the reference doc so the next divergence is caught by reading rather than by probing hardware — see `docs/reference/connection-quality.md` > "The producer key contract". Related: [[documented-guard-had-no-writer]].
