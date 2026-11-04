---
name: project_config_pruning_asymmetry
description: Which installed-file categories get auto-pruned when removed from source vs which persist forever as orphans
type: project
---

install_rm520n.sh has THREE different pruning strategies depending on what kind
of file is being deployed — knowing which applies to a given path tells you
whether removing a feature's source file is enough, or whether you also need
an explicit migration/cleanup step.

1. **Filesystem-diff pruned** (`cleanup_legacy_scripts()`, install_rm520n.sh
   ~line 1245): `/usr/bin/qmanager_*`, `/lib/systemd/system/qmanager-*.service`,
   `/usr/lib/qmanager/*.sh`. Runs every install/OTA. Compares installed files
   against `$SRC_SCRIPTS` — anything installed but no longer in source (and not
   in `$SRC_DEPS`) gets deleted, including its wants/ symlink. Delete the file
   from source and it disappears from live devices on next OTA. No orphan risk.

2. **Wipe-and-resync pruned** (`install_tree()`, install_rm520n.sh ~line 207):
   used for the CGI directory (`$CGI_DIR` = `/usrdata/qmanager/www/cgi-bin/quecmanager`)
   and a few other trees. Does `rm -rf "$dst"` then copies the whole source tree
   back. Same effect as #1 — deleting a CGI script from source removes it from
   live devices on next OTA. Also applies the CRLF-strip-if-not-ELF pattern
   (matching `install_file`) and a final `chmod` pass (755 for `*.sh`, 644 else)
   done AFTER the CRLF rewrite so the exec bit isn't silently lost.

3. **Additive-only, NEVER pruned** (`$CONF_DIR` = `/etc/qmanager`, install
   ~line 1100): the "Config files (deploy new, don't overwrite existing)" loop
   only copies files that don't already exist on the target. Nothing ever
   deletes a stale config file here. This is the dangerous one — see
   [[config_sh_no_migration_primitive]] (repo-root memory) and
   [[project_ping_daemon_retirement]]. Any feature-removal that leaves a file
   under `/etc/qmanager/` needs an EXPLICIT prune step (see
   `prune_stale_ping_environment()` for the idempotent pattern to copy) or the
   file survives forever on upgraded devices, unread and confusing.

**How to apply:** when auditing a Tier-4 change that retires a feature, check
which of the three buckets every affected file falls into. Bucket 1/2 files
are self-cleaning — no installer edit needed beyond deleting the source.
Bucket 3 files (anything under `/etc/qmanager/`) need a named prune function
added to `install_backend()`'s bootstrap section, run unconditionally on every
install/OTA (OTA does invoke the full installer minus package steps — see
`project_ota_skips_packages`).
