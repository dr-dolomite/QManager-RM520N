# Config Backup

> **Applies to:** RM520N-GL · built 2026-11-03 (P7b, plan `.orchestra/runs/2026-11-03-parity-p7.md`). Self-restore of all 20 sections verified on 61368cd2 with identical values (no reboot queued); a restore with a changed value and the reboot queue were measured on the RG501Q-EU b7e3d6f1 on 2026-11-03 (WebCrypto on HTTPS, OTA guard included); the watchcat pause is not yet measured.
> **RG501Q-EU (SDX55):** unverified. The only model-specific handling is the foreign-model rule below — see [`platform-matrix.md`](./platform-matrix.md).

Config Backup saves QManager's settings into one encrypted `.qmbackup` file and restores them onto the same or another RM520N-family modem. It exists so a user can move a configured setup to a replacement modem, or get it back after a factory reset, without re-entering ~40 config files and the modem-only AT state by hand. The page is **System Settings → Config Backup** (`/system-settings/config-backup`). The device only ever sees plaintext over the authenticated CGI; encryption and decryption happen in the browser, and the passphrase never leaves it. A restore runs in a detached worker, applies the sections in a fixed order, and **never reboots** — sections that need one raise a flag and the page queues the reboot.

## Quick Reference

| Item | Value |
| --- | --- |
| Route | `/system-settings/config-backup` (`app/system-settings/config-backup/page.tsx`) |
| Frontend | `components/system-settings/config-backup/*.tsx`, `hooks/use-config-backup.ts`, `hooks/use-config-restore.ts`, `lib/config-backup/{crypto,format,sections}.ts`, `types/config-backup.ts` |
| CGIs | `/cgi-bin/quecmanager/system/config-backup/collect.sh` (GET), `apply.sh` (POST), `apply_status.sh` (GET), `apply_cancel.sh` (POST) |
| Registry | `/usr/lib/qmanager/config_backup_sections.sh` (`CFG_BACKUP_APPLY_ORDER`, `CFG_BACKUP_MUTEX`, rc codes, helpers) |
| Section files | `/usr/lib/qmanager/config_backup_{radio,connection,system,monitoring,polling}.sh` — one `collect_<key>` / `apply_<key>` pair per section |
| Worker | `/usr/bin/qmanager_config_restore <job_id>` (www-data, refuses root) |
| Runtime files | `/tmp/qmanager_config_restore.{pid,lock,spawn.lock,json,cancel,reboot_required,section.json}`, `/tmp/qmanager_config_restore_input.json` |
| Constants | `CFG_BACKUP_PLATFORM="rm520n"`, `CFG_BACKUP_FORMAT_VERSION="1.0"`, `CFG_BACKUP_FORMAT_MAJOR=1` |
| File name | `qmanager-<model>-<YYYYMMDD-HHMMSS>.qmbackup` (UTC, `envelopeFilename`) |

## The `.qmbackup` envelope

A JSON object: the header fields at the top level, plus `kdf` and `cipher`.

```json
{
  "magic": "QMBACKUP",
  "version": 1,
  "format_version": "1.0",
  "platform": "rm520n",
  "created_at": "2026-11-03T04:12:09Z",
  "device": { "model": "RM520N-GL", "firmware": "...", "imei": "...", "qmanager_version": "..." },
  "sections_included": ["system", "alerts", "quality"],
  "kdf": { "algo": "PBKDF2-SHA256", "iter": 200000, "salt": "<base64, 16 bytes>" },
  "cipher": { "algo": "AES-256-GCM", "iv": "<base64, 12 bytes>", "ciphertext": "<base64, tag appended>" }
}
```

The ciphertext decrypts to `{ "schema": 1, "sections": { "<key>": { ... } } }`.

- **The header is not encrypted, only authenticated.** `canonicalHeaderAad` serialises it in a fixed key order (`magic, version, format_version, platform, created_at, device{model, firmware, imei, qmanager_version}, sections_included`) with `sections_included` **sorted**, and binds that string as the AES-GCM additional data. Any edit to a header field fails decryption. The file on disk keeps `sections_included` in collect order; only the AAD copy is sorted. The modem's IMEI is readable in the header by anyone holding the file.
- **Crypto:** AES-256-GCM with a 128-bit tag, key from PBKDF2-SHA256 at 200 000 iterations. Decryption uses the file's own `kdf.iter`. Passphrase minimum is 10 characters (`MIN_PASSPHRASE_LEN`).
- **WebCrypto only.** `crypto.subtle` exists only in a secure context (HTTPS or localhost). On plain HTTP `hasWebCrypto()` is false and the page reports `insecure_context`; backup checks this before calling `collect.sh`. Only a GCM tag failure (`DecryptAuthError`) is shown as a wrong passphrase; every other fault keeps its own code.
- **Refused before the passphrase:** `parseEnvelope` rejects a wrong `magic`, `version` ≠ 1 (`wrong_version`), `platform` ≠ `rm520n` (`foreign_platform`, which covers RM551E backups) and a `format_version` major above 1 (`backup_too_new`). `apply.sh` repeats the platform and format checks on the decrypted request before any write.
- **Other model, same platform** (e.g. an RG501Q-EU backup on an RM520N-GL): allowed. The card warns, and the worker sets `CFG_FOREIGN_MODEL=1` when the request's `source_model` differs from `.device.model` in `/tmp/qmanager_status.json`. An AT write the modem rejects then reports `skipped:incompatible` instead of retrying (`cfg_at_failed`).

## CGI contract

| Call | Request | Success response |
| --- | --- | --- |
| `GET collect.sh` | — | `{"success":true,"sections":["system","alerts",...]}` — keys this build has both halves for, in apply order |
| `GET collect.sh?sections=k1,k2` | comma list (`%2C` accepted) | `{"success":true,"header":{...},"payload":{"schema":1,"sections":{...}},"unavailable":["k3"]}` |
| `POST apply.sh` | `{"schema":1,"platform":"rm520n","format_version":"1.0","source_model":"RM520N-GL","options":{"imei_confirmed":false},"sections":{...}}` | `{"success":true,"status":"started","job_id":"1762142400"}` |
| `GET apply_status.sh` | — | `{"success":true,"status":"idle"}`, or the state file plus `success:true` |
| `POST apply_cancel.sh` | — | `{"success":true,"status":"cancel_requested"}` or `{"success":false,"error":"not_running",...}` |

- **collect.sh:** an unknown key → `unknown_section`; a mutex clash → `sections_conflict` with `detail` `"scenarios:bands"`. A section whose collector fails or prints a non-object is left out and listed in `unavailable`; only "no section readable" is fatal (`collect_failed`). The browser encrypts the response; nothing is stored on the device.
- **apply.sh:** POST only, body ≤ 256 KiB (`413 payload_too_large`). It refuses with **409** `restore_in_progress` (detail = pid), `update_in_progress` (`/tmp/qmanager_update.pid` live) or `profile_apply_in_progress` (`/tmp/qmanager_profile_apply.pid` live). The reverse holds too: `system/update.sh` (`check_lock`) and `qmanager_update` (`run_install_with_progress`, which also covers the auto-update timer) refuse an install while the restore worker is live, because the install stops lighttpd and would kill it. Then: `invalid_json`, `wrong_schema`, `foreign_platform`, `wrong_version`, `backup_too_new`, `invalid_section_key` (keys must match `[a-z0-9_]{1,32}`), `no_sections`, `sections_conflict`, `not_installed`. It writes the input file with `umask 077` (the worker inherits it and switches to `umask 022` only around each applier call, so restored config files stay 0644 like a UI save), removes any old cancel flag and state file, double-forks the worker, and waits up to ~2 s for its pid or state file (`start_failed` otherwise). Errors without a `Status:` line are HTTP 200 with `{"success":false,"error":...,"detail":...}`.
- **apply_status.sh:** a state file with `status:"running"` and no live pid is reported as `"crashed"`.

State file `/tmp/qmanager_config_restore.json`:

```json
{
  "job_id": "1762142400",
  "status": "running",
  "started_at": 1762142400,
  "completed_at": null,
  "sections": [
    { "key": "system", "status": "success", "attempts": 1, "message": "", "ignored_keys": 0, "dropped": 0 },
    { "key": "bands", "status": "retrying:1", "attempts": 2, "message": "modem rejected the band lock", "ignored_keys": 0, "dropped": 0 }
  ],
  "summary": null,
  "reboot_required": false
}
```

`status` ends as `done` or `cancelled`; `summary` is then `{"success":N,"failed":N,"skipped":N,"ignored_keys":N,"dropped":N}`. Section statuses: `pending`, `running`, `retrying:<n>`, `success`, `failed`, `skipped:incompatible`, `skipped:not_supported`, `skipped:sim_mismatch`. The page polls every 1 s and gives up after 90 missed polls (`status_lost`); misses are expected while an APN attach cycle drops the link.

## Sections

`lib/config-backup/sections.ts` holds picker order and defaults; the worker owns apply order. "Backup default" is the picker's initial tick; on restore every section in the file is ticked except `imei` and `lan`.

| Key | Source | Restore does | Reboot | Backup default |
| --- | --- | --- | --- | --- |
| `network_mode` | `AT+QNWPREFCFG="mode_pref"` | `rv_mode_pref`, then `radio_set_mode_pref` | no | on |
| `bands` | `AT+QNWPREFCFG="lte_band"` / `"nsa_nr5g_band"` / `"nr5g_band"`, `/etc/qmanager/band_failover_enabled` | All categories validated before the first write; failover toggle first, then `bands_lock_write` per category 0.2 s apart, then `bands_arm_failover`. A `null` or `"0"` category is left as is | no | on |
| `apn` | `/etc/qmanager/apn_setting.json`, `apn_names.json` | Names for CIDs 1–6; active APN through `apn_setting_apply` (attach cycle, WAN drops a few seconds), skipped when `AT+CGDCONT?` already holds the same CID/APN/PDP | no | on |
| `tower_lock` | `/etc/qmanager/tower_lock.json`, `AT+QNWLOCK` persistence | Persistence → LTE leg → NR-SA leg → failover → schedule; the schedule timers are re-armed | no | off |
| `ttl_mtu` | `/etc/qmanager/ttl_state`, `/etc/firewall.user.mtu` | `ttl_state_apply` + persist; MTU via `conn_mtu_set` / `conn_mtu_disable` (root helper `qmanager_mtu_set` over `sudo -n`) | no | on |
| `imei` | modem IMEI, `/etc/qmanager/imei_backup.json` | Writes the IMEI only when it differs **and** `options.imei_confirmed=true`; else `failed` "IMEI change not confirmed" | when written | off |
| `profiles` | `/etc/qmanager/profiles/p_*.json`, `/etc/qmanager/active_profile` | **Replaces** the set via a staging dir and `profile_save`; ICCID gate on the active pointer | see trade-offs | off |
| `scenarios` | `/etc/qmanager/scenarios/custom-*.json`, `/etc/qmanager/active_scenario` | **Replaces** the custom set (≤ 20); built-ins are never stored. Activation skipped while the active SIM profile owns the radio | no | off |
| `ip_passthrough` | `/etc/qmanager/ippt_config.json` (poller cache when absent) | `conn_ippt_apply`; unchanged → no write | when changed | on |
| `sms` | `/etc/qmanager/sms_storage`, `/etc/qmanager/sms_forwarding.json` | `conn_sms_storage_set` (CPMS); SIM storage unavailable → `skipped:incompatible`; forwarding saved | no | on |
| `lan` | `/etc/data/mobileap_cfg.xml` | Only `ipaddr` + `prefix`; `sudo qmanager_lan_apply` derives netmask and DHCP pool. Moves the UI's address after the reboot | when changed | off |
| `custom_dns` | sentinel block of `/etc/data/dnsmasq.conf` | `qm_dns_apply_candidate`; DNS Mode that disallows it → `skipped:incompatible` | only if dnsmasq did not reload | on |
| `ethernet` | `/etc/qmanager/ethernet_speed` | `qm_eth_save` (bounces the link ~8 s); unchanged → skipped | no | on |
| `traffic_engine` | `qmanager.conf` `video_optimizer` / `full_bypass` / `quic`, `/etc/qmanager/video_domains.txt` | Host list **replaced** (≤ 300), then force-TCP, then engine mode last so the engine restarts onto the new list | no | on |
| `watchdog` | `qmanager.conf .watchcat` | `mv_wd_commit`, the Watchdog page's save path | no | on |
| `quality` | `/etc/qmanager/ping_profile.json`, `quality_thresholds.json` | Keyed merge; `ping_profile.interval_sec: null` clears the stored override | no | on |
| `sites` | `/etc/qmanager/sites.json` | Site list **replaced** (≤ 32) | no | on |
| `alerts` | `/etc/qmanager/sms_alerts.json`, `email_alerts.json`, `discord_bot.json`, `alert_routing.json` | Channel settings and wait; routing events **merged** onto the device's | no | on |
| `adaptive_polling` | `qmanager.conf .poller` | `ap_save` + `/tmp/qmanager_poller_reload`; `is_default: true` deletes `.poller` | no | on |
| `system` | `qmanager.conf .settings` / `.update`, `/etc/qmanager/tailscale_ssh` | Units, hostname, timezone (`sys_set_timezone`), scheduled reboot timer, update prefs, Tailscale SSH | no | on |

**`system` hostname.** `settings.hostname` in `qmanager.conf` is a display name (1-64 characters, spaces and non-ASCII allowed, no control characters). `sys_set_hostname` also derives an RFC 1123 label from it (spaces and `_` become `-`, other characters outside `[A-Za-z0-9-]` are dropped, edge hyphens stripped, 63 max) and passes that to the root helper `qmanager_hostname_apply`, which writes `/etc/hostname` and the live kernel name. No usable label means the system name is left alone. rc 1 is a config write failure (retried); rc 2 is "saved, system apply failed" (`failed`, no retry).

**Apply order** (`CFG_BACKUP_APPLY_ORDER`):

```text
system alerts quality sites adaptive_polling traffic_engine ethernet custom_dns ttl_mtu sms
network_mode bands scenarios tower_lock apn profiles imei ip_passthrough lan watchdog
```

File-only sections run first, then the AT sections, then `apn` (the attach cycle) and the reboot-bound sections; `watchdog` runs last, after every AT section. Keys in the backup that are not in this list run after it and end `skipped:not_supported`.

**Mutex pairs** (`CFG_BACKUP_MUTEX`): `scenarios` with `network_mode` or `bands`; `profiles` with `apn`, `ttl_mtu` or `imei`. The left section rewrites the right ones, so the two cannot travel together. Enforced three times: the picker disables the other side (`computeMutex`), `collect.sh` and `apply.sh` refuse with `sections_conflict`. `restoreSelection` drops the parent if a hand-edited file carries both.

## Restore rules

- **Absent key keeps the device value.** Every keyed section reads only the keys the backup carries. Exceptions: `adaptive_polling` with `is_default: true` deletes `.poller`; `watchdog` and `quality` treat a key that is present but `null` as "clear" (`backup_sim_slot`, `interval_sec`).
- **Collections replace.** `profiles`, `scenarios`, `sites` and the Traffic Engine host list: the backup's set replaces the device's. Entries are validated one by one; an invalid entry is dropped and counted in `dropped`. `profiles` and the host list never wipe the device's set when the backup had entries and none were valid. An `active_*` pointer to a missing id is cleared.
- **Unknown keys** inside a known section are ignored and counted in `ignored_keys` (`cfg_count_unknown`). An invalid value for a known key is dropped and counted in `dropped` (`cfg_drop`).
- **Unknown section** → `skipped:not_supported`. One section failing does not stop the others.

Applier return codes (`config_backup_sections.sh`):

| rc | Name | Worker result |
| --- | --- | --- |
| 0 | `CFG_RC_OK` | `success` |
| 1 | `CFG_RC_RETRY` | retried 3 times after 1 s, 2 s, 4 s (`retrying:<n>`), then `failed` |
| 2 | `CFG_RC_INCOMPATIBLE` | `skipped:incompatible` |
| 3 | `CFG_RC_SIM_MISMATCH` | `skipped:sim_mismatch` |
| 4 | `CFG_RC_INVALID` | `failed`, no retry |

Cancel (`apply_cancel.sh` touches `/tmp/qmanager_config_restore.cancel`) is checked before each section and each attempt. A section already running finishes; the run ends `cancelled` with the rest `pending`.

## Worker invariants

- **www-data only.** The worker exits when `id -u` is 0: root-created files in sticky `/tmp` lock the CGIs out (see [`tmp-file-ownership.md`](tmp-file-ownership.md)). To run it by hand, use `sudo -n -u www-data /usr/bin/qmanager_config_restore <job_id>`. It also refuses an input file it does not own.
- **One run at a time:** `exec 9>>/tmp/qmanager_config_restore.lock; flock -n 9`. Appliers run with fd 9 closed so a daemon they start cannot inherit the lock.
- **Files:** pid `/tmp/qmanager_config_restore.pid`, state `/tmp/qmanager_config_restore.json`, input `/tmp/qmanager_config_restore_input.json`, per-section scratch `/tmp/qmanager_config_restore.section.json`, cancel flag `/tmp/qmanager_config_restore.cancel`, reboot flag `/tmp/qmanager_config_restore.reboot_required`. The EXIT trap removes pid, cancel, input and section files; the state file and reboot flag stay for the page. The reboot flag is cleared at the start of each run.
- **Never reboots.** `cfg_reboot_required` touches the flag; the state file reports `reboot_required: true`; the page calls `requestRebootLater("config_restore")` ([`reboot-banners.md`](reboot-banners.md)) and offers Reboot now / Later. The worker runs `sync` before the final state write because UBIFS holds writes for up to 30 s.
- **Watchdog pause.** `qmanager_watchcat` `check_locked` returns locked while the pid in `/tmp/qmanager_config_restore.pid` is alive and its cmdline contains `qmanager_config_restore` (`pid_is`), so no recovery tier fires during band or APN re-registration.
- **Events:** `config_restore_started`, `config_restore_section_success` / `_skipped` / `_failed`, `config_restore_completed`; collect logs `config_backup_collected`.

## IMEI and LAN

Both are off by default on restore. The card compares the backup IMEI (section value, else header) with the modem's; when it differs, Restore stays disabled until the user ticks the confirmation. `options.imei_confirmed` is one flag for both IMEI paths:

- `imei` writes a differing IMEI only with `imei_confirmed=true`, then raises the reboot flag.
- `profiles`: each profile whose IMEI differs from the modem's has it **cleared to `""`** unless confirmed; the count goes into `dropped` and the message. The card shows an optional "keep profile IMEIs" tick; ticking it sends `imei_confirmed=true`.

## Exclusions

Never collected, so never restored:

- **Secrets:** `auth.json`, `/etc/shadow`, the email app password, the Discord bot token, Tailscale node state. `alerts` never calls the secret helper: the device's own `app_password_set` / `token_set` decide whether email or Discord can be enabled.
- **Device state:** `sim_registry.json`, `known_iccids`, `last_iccid`, `qmanager_sim_failover`, `imei_check_pending`, `reboot_history.json`, `last_boot_id`, `modem_crashes.json`, the crash log, `data_used.json`, `sites/*.jsonl`, `/usrdata/.qm_lan_subnet_set`, `sms_sent.json`.
- **Runtime:** `/tmp`, `/run`, `/var/run`, `/etc/data/qmanager/*.new`.
- **Installer-managed:** `platform.json`, `VERSION*`, `long_commands.list`, `log_level`, `video_domains_default.txt`, lighttpd conf, TLS cert and key, sudoers, generated units (re-armed by the setters), language packs, the web port.

## Trade-offs and gotchas

- **`tower_lock` targets travel as a unit.** The NR-SA `pci` / `arfcn` / `scs` / `band` are all valid or all `null` (`null` = empty target); a partial set is dropped. An `lte.cells` array replaces all three slots, and a `null` slot is empty. A restored `enabled: true` lock is written **at once**, even outside its schedule window: the applier arms the schedule timers but never checks the current time against them. An enabled schedule with no lock targets is saved disabled.
- **`bands` support check.** Bands are checked against `.device.supported_*_bands` in `/tmp/qmanager_status.json`: unsupported on the same model → `failed`, on a foreign model → `skipped:incompatible`. An empty supported list (poller not yet populated) passes everything.
- **`alerts` sender email.** A changed `sender_email` is not applied while the device holds an app password, because only the Alerts page save re-renders the mail credentials. An enabled email or Discord channel with no stored password or token is written disabled, with a message.
- **`alert_after_min`** is in both `alerts` and `quality.thresholds`. `quality` runs later, so its value wins when both are restored.
- **`watchdog` `backup_sim_slot: null`** clears the slot; an absent key keeps the device's.
- **`traffic_engine` without tpws:** turning on a mode when the `tpws` binary is missing returns `success` with one `dropped` and the message "tpws is not installed, so the Traffic Engine mode was not turned on".
- **`profiles` and the SIM.** The set is always written. The active pointer is honoured only when the profile's `sim_iccid` matches the inserted SIM (canonical ICCID from the poller cache, else `AT+QCCID`); on a mismatch the section reports `skipped:sim_mismatch` although the set **was** replaced. Activation writes `/etc/qmanager/active_profile` and raises the reboot flag; boot auto-apply then applies it. A replaced set with a profile matching the current SIM also raises it. A profile that references a custom scenario is dropped unless that scenario exists, so restore `scenarios` with it (scenarios apply first) or have it on the device.
- **`scenarios` replace** removes device `custom-*.json` files the backup does not carry, including ones a device profile still points at when `profiles` is not restored too.

## Shared-path guarantees (P7 follow-ups, 2026-11-03)

The restore reuses the same CGIs and libraries as the UI saves, so these hold for both:

- **`qm_config_*` writers are serialised.** `qm_config_set`, `qm_config_delete`, `qm_config_delete_section` and `qm_config_init` take an exclusive `flock` on `/etc/qmanager/qmanager.conf.lock` (created 0644 with noclobber, so a planted symlink is refused; opened read-only, so a root- or www-data-created lock works for both) and publish a per-call `mktemp` file in `/etc/qmanager` with `mv`. The published mode is 0644 and the owner follows the last writer (a root write leaves the file root-owned and readable; the next www-data write replaces it, since `/etc/qmanager` is www-data-owned). A killed writer can leave a `qmanager.conf.XXXXXX` file behind; nothing reads it. Every direct writer outside `config.sh` now goes through these functions (`qmanager_dpi_install` uninstall used a fixed `.tmp` and no lock). Measured with 40 parallel `qm_config_set` calls on a /tmp copy: the old code lost updates on the RM520N-GL and one run left an empty file; the new code landed all 40 in each run on the RM520N-GL and the RG501Q-EU.
- **`apply.sh` check, write and spawn are atomic.** A non-blocking `flock` on `/tmp/qmanager_config_restore.spawn.lock` is held from before the live-pid check until the CGI exits; the worker is started with that fd closed. A second near-simultaneous POST gets 409 `restore_in_progress` (empty `detail` if the first job has no pid yet) and never touches the first job's input file.
- **Scenario ids are unique.** `scenarios/save.sh` creates `custom-<epoch>` and appends `-<n>` while that file exists, under `flock` on `/tmp/qmanager_scenario_save.lock`, which also keeps the 20-scenario limit exact. The ids still match `rv_scenario_id` and every `custom-*` consumer.
- **Tower unlock with nothing locked succeeds.** `_tower_do_unlock` reads the lock state first and skips the AT write when it is `unlocked` (the modem ERRORs on `AT+QNWLOCK="common/4g",0` / `"common/5g",0` with no lock), then still clears the config flag and stops the failover watcher and service. An unreadable state still attempts the write. Applies to `tower/lock.sh` and the applier alike.
- **`tower/lock.sh` NR-SA lock** rejects a `pci`, `arfcn` or `band` that is not digits-only (`invalid_pci`, `invalid_arfcn`, `invalid_band`; `rv_tower_nr_fields`) before any AT write.
- **`bands/lock.sh`** rejects bands outside `.device.supported_*_bands` with `invalid_bands` (`rv_bands_supported`; an empty or missing list passes), as the applier does.
