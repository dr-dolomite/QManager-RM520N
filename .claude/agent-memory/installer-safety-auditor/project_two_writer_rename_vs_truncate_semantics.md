---
name: project_two_writer_rename_vs_truncate_semantics
description: Unix rename() vs open(O_TRUNC) semantics explain why mktemp+mv two-writer files in a world-writable /etc/qmanager are safer than raw >/>> redirection, and when a root helper is still warranted anyway
type: project
---

Derived while auditing the sim_registry.json two-writer design (root poller +
www-data CGI both touching one file, 2026-07-27) — a direct sequel to
[[project_crash_log_dual_writer_audit]].

**The nuance the crash_log audit didn't need to spell out:** `/etc/qmanager`
is confirmed `drwxrwxrwx www-data:www-data` on the live device (world-writable
directory). Two different write idioms behave very differently against a file
in a world-writable dir regardless of the FILE's own owner/mode:

1. **`mktemp` (same dir) + `mv` (rename)** — e.g. `ping_profile.sh` :226-237,
   `migrate_ping_targets()` install_rm520n.sh:1337-1345. `rename(2)` only
   requires write+exec on the CONTAINING DIRECTORY, not on the destination
   file. It also does NOT dereference a symlink at the destination path — it
   atomically replaces whatever directory entry is there. So in a
   world-writable dir, ANY writer (root or www-data) can always successfully
   replace ANY existing file this way, regardless of who created it or its
   current mode — ownership just flips to whoever wrote last. This is
   symlink-attack-safe too, UNLIKE append.
2. **Raw `>` / `>>` redirection onto the final path** — e.g. the retired
   `dismiss_sim_swap` action (`jq ... "$SIM_SWAP_FLAG"` then `>`) and
   `qmanager_watchcat`'s crash.log append (`>>`). This is `open(O_TRUNC)` or
   `open(O_APPEND)` — it FOLLOWS a symlink at that path and is gated by the
   FILE's own permission bits, not the directory's. This is the vulnerable
   pattern the crash_log audit correctly blocked.

**How to apply:** a root-vs-www-data ownership collision on a shared
`/etc/qmanager/*.json` file is largely defused (not eliminated) if BOTH
writers strictly use pattern 1. Don't reflexively demand a root-helper
purely on ownership-collision grounds — check which write idiom is actually
proposed first. A root helper (matching the `qmanager_*_apply` sudoers
family) is still the better call when: (a) the field being written is
security-relevant provenance (crash.log's reboot trail) rather than a UI
toggle, (b) the file carries PII (e.g. phone numbers) and narrowing the
direct-write surface is worth it independent of the rename-safety argument,
or (c) a lost-update race between the two writers' read-modify-write cycles
would corrupt more than a single low-stakes field. For a low-stakes flag
(e.g. a dismissed:true/false toggle) where the file is already fully
www-data-readable/writable by repo convention, mktemp+mv with a scoped
per-key jq merge (only touch the one key/field each writer owns — see
[[project_config_pruning_asymmetry]] sibling doc `ping_profile.sh` header
:19-31 for the split-ownership atomic-key-merge pattern) is an acceptable,
precedented alternative to a root helper — just make it a MANDATORY,
explicitly-reviewed condition, never an assumption.
