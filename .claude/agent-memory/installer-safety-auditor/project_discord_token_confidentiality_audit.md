---
name: project_discord_token_confidentiality_audit
description: 2026-08-04 Phase 1 audit of hardening the plaintext Discord bot token in /etc/qmanager/discord_bot.json — PROCEED-WITH-CONDITIONS on relocation + root helper; www-data provably never needs to READ the token
metadata:
  type: project
---

Audit of making the live Discord bot token in `/etc/qmanager/discord_bot.json`
unreadable by www-data. Verdict: **PROCEED-WITH-CONDITIONS** on a relocate-plus-root-
helper design (option "c"); the chown-carve-out option was **disqualified** by
[[project_etc_qmanager_env_relocation_precedent]].

**The load-bearing discovery: www-data never needs to READ the token.** Traced all
three consumers:
- `discord_dispatch_message()` (`usr/lib/qmanager/discord_alerts.sh`) is
  **fire-and-forget** — it writes a command file to `/tmp/qmanager_discord_cmd` and the
  **root daemon** performs the actual Discord API call. The CGI's `send_test` path
  (`monitoring/alerts.sh:528-557`) goes through this, so the "Send test message" button
  does **not** need the secret.
- `alert_engine.sh:149-158` (`_ae_read_discord_config`) reads only `.enabled`,
  `.owner_discord_id`, `.threshold_minutes` — never `.bot_token`.
- `install_rm520n.sh:2394` and `:2504` read only `.enabled`.

Only **two** www-data reads of `.bot_token` exist, and both are incidental:
1. `alerts.sh:120-121` — reads it purely to compute a `token_set` boolean for the UI.
   Replace with a non-secret `"token_set": true` marker maintained by the root helper.
2. `alerts.sh:333-336` — the **carry-forward** read: on a partial save (user didn't
   re-type the token) it reads the existing token back and rewrites it into the JSON.
   This is the only real coupling, and it **disappears entirely** under the new model:
   if the submitted token is empty, the CGI simply doesn't invoke the helper and the
   root-side secret is left untouched.

The Go daemon (`discord-bot/config.go:10`) hardcodes
`configPath = "/etc/qmanager/discord_bot.json"` and must learn the second path.

**Unit facts (live 2026-08-04):** `qmanager-discord.service` has empty `User=`/`Group=`/
`SupplementaryGroups=` → runs as **root**, so it can read a 0600 root:root file with no
group scheme at all. `FragmentPath=/lib/systemd/system/...` (ro rootfs). It already
carries an `EnvironmentFile=-/etc/qmanager.env` and a comment explaining the
out-of-`/etc/qmanager` rule — the same reasoning applies to the token.

**Why a group scheme (option "a") fails beyond the carve-out problem:** it needs a
`SupplementaryGroups=` edit to a unit in `/lib/systemd/system`, which drags in the
rootfs remount-rw contract; and the daemon already runs as root so the group buys
nothing.

**Migration is a mode/location change, not a key rename**, so `config.sh`'s missing
key-migration primitive is NOT hit — but the `bot_token` key must be **explicitly
deleted** from the surviving `discord_bot.json` (`jq 'del(.bot_token)'` + atomic
replace), or the plaintext copy just sits there forever: `/etc/qmanager` is the
additive-only, never-pruned bucket (see [[project_config_pruning_asymmetry]]).

**Uninstall leak:** `uninstall_rm520n.sh:573-588` removes `$CONF_DIR` and
`/etc/qmanager.env` only under `--purge`, each on its own line. A new secret file
outside `$CONF_DIR` needs its **own** `rm -f` line in that same `--purge` branch or an
uninstall leaves a live bot token on disk.

**Incidental pre-existing bug found:** `install_rm520n.sh:2504`
`_dc_enabled=$(jq -r '.enabled // false' ... 2>/dev/null)` is an **unguarded** command
substitution under `set -e` — corrupt JSON makes jq exit non-zero and aborts the
installer mid-OTA with services already stopped. Line 2394 does the same read but is
correctly guarded with `|| enabled=false`. Fix 2504 to match if that region is touched.

**Sudoers install facts:** written by `install_rm520n.sh:1253-1266` via
`install_file ... 440` then `chown root:root`. There is **no `visudo -c` validation
anywhere in the repo** — a syntax error in `scripts/etc/sudoers.d/qmanager` ships
straight to the fleet and breaks every privileged CGI action at once (sudo rejects the
whole drop-in directory). Any sudoers append should be gated on a
`visudo -c -f <staged>` check before the `mv` into place. `install_file` already strips
CRLF for non-ELF files, so the line-ending hazard is covered.

**How to apply:** reuse this trace for any future "secret in a config file" hardening —
the pattern is (1) prove whether www-data needs read or only write, (2) relocate to
`/etc/<name>` 0600 root:root, (3) write-only via a hardcoded-path root helper installed
to `/usr/bin` (0755 root:root, root-owned dir — verified not www-data-writable),
(4) leave a non-secret `*_set` boolean behind for the UI.
