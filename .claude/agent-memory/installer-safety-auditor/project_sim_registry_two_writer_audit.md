---
name: project_sim_registry_two_writer_audit
description: 2026-07-27 Phase 1 gate verdict on the SIM-detection rewrite (localStorage dismissal -> /etc/qmanager/sim_registry.json), root poller + www-data CGI both writing one file
type: project
---

Audited the "New SIM detected" persistence rewrite: root-run `qmanager_poller`
creates/updates records keyed by ICCID (`carrier`, `phone_number`,
`first_seen`, `dismissed`) in `/etc/qmanager/sim_registry.json`; a new
www-data CGI `system/sim_registry.sh` was planned to write `dismissed`
directly, with NO sudoers line / root helper, reasoning that `/etc/qmanager`
is already `drwxrwxrwx www-data:www-data`.

**Verdict: BLOCKED as specified.** Same shape as
[[project_crash_log_dual_writer_audit]], two reasons:

1. `phone_number` is a new class of PII landing in `/etc/qmanager` — no
   existing file there stores a subscriber's phone number. Direct www-data
   write access to the file that also carries poller-owned provenance fields
   widens the blast radius of a compromised/buggy CGI beyond what's needed
   for a UI dismiss toggle.
2. Even though `mktemp`+`mv` (not raw `>`/`>>`) neutralizes the pure
   ownership-collision concern in a world-writable dir — see
   [[project_two_writer_rename_vs_truncate_semantics]] for why — a
   read-modify-write race between the periodic root poller and an
   on-demand www-data dismiss/undismiss action can still lose an update if
   either side does a whole-object rewrite instead of a scoped per-ICCID,
   per-field merge.

**Required condition (given to the builder brief):** root owns ALL writes to
`sim_registry.json` (stays root:root 644, poller creates/updates
carrier/phone_number/first_seen/dismissed=false on detection, mktemp+mv,
matching `ping_profile.sh`'s atomic-key-merge style but scoped to
`.[$iccid]`). www-data's dismiss/undismiss actions go through a new root
helper `qmanager_sim_registry_apply <iccid> <dismiss|undismiss>` (bare-path
NOPASSWD sudoers entry, arg validation lives in the helper per
`feedback_sudoers_arg_validation_pattern` — validate ICCID charset/length and
action against a 2-value enum, never string-interpolate the ICCID into a jq
filter, always pass via `--arg`). The `list` CGI action stays a plain read
(file is world-readable already, no privilege needed). This mirrors the
crash_log recommendation and the existing `qmanager_*_apply` helper family.

**Also cleared in the same audit:**
- OTA/uninstall lockstep: `/etc/qmanager` is never wiped or removed
  file-by-file — `uninstall_rm520n.sh` only does a wholesale `rm -rf
  "$CONF_DIR"` under `--purge` (:536-537), otherwise preserves it wholesale
  (:554-555). `qmanager_update` reruns `install_rm520n.sh --skip-packages`,
  which still runs the additive config-deploy loop and all `migrate_*`
  functions (only package/opkg steps are skipped — see
  `project_ota_skips_packages`). No allowlist edit needed for a new
  `/etc/qmanager/*.json` file.
- `migrate_sim_registry()` should use an **existence-gate** idempotency check
  (`[ -f "$target" ] && return 0`, matching `sim_db_seed_if_absent`'s style)
  rather than `migrate_ping_targets()`'s content-based `has()` check, because
  there's no separate unconditional bootstrap-seed step (like
  `install_ping_profile()`) creating the file first — sim_registry.json only
  ever comes into existence via this migration or the poller's first write.
  Must be called from the same upgrade block as `migrate_watchcat_fail_threshold`
  / `migrate_ping_targets` (install_rm520n.sh ~:1241-1248); ordering vs. the
  other migrations doesn't matter (disjoint files).
- Fresh-install seeding: lazy-create only, matching `known_iccids`
  precedent — do NOT ship a default `sim_registry.json` asset. Critically,
  the poller's new record-creation code must reuse the EXACT
  `_had_prior_sim_db` gate at `qmanager_poller:826-829`
  (`sim_db_seed_if_absent` return code) before writing a `dismissed:false`
  record — otherwise a truly fresh device's first-ever SIM gets a record
  that immediately fires the banner, defeating the suppression
  `sim_db_seed_if_absent` exists for.
- `known_iccids` frozen bare-ICCID-line format is respected by the plan as
  described — no violation.
- Deleting the dead `dismiss_sim_swap` CGI action
  (`monitoring/watchdog.sh:325-335`, writes to a root-owned `/tmp` flag as
  www-data — already silently fails, returns `{"success":true}`
  unconditionally) is safe to remove, no persistence/OTA impact.
