# Centralized Alerts

> **Applies to:** RM520N-GL (SDX65) · verified 2026-08; the 2026-10-12 backend fixes were run on RM520N-GL `61368cd2`; of the later Discord spool change, only the shell enqueue side has run there (the daemon's drain and connect retry have not)
> **RG501Q-EU (SDX55):** unverified — see [`platform-matrix.md`](./platform-matrix.md)

The Alerts subsystem consolidates the three previously-independent notification channels — **SMS**, **Email**, and **Discord** — behind ONE page, ONE CGI endpoint, and ONE backend state machine. It exists to answer a single question every poll cycle: *"the internet just went down / came back / the device just rebooted — which enabled, routed, and physically-capable channel(s) should fire?"* Before this rework each channel carried its own downtime timer, its own threshold, and (for Discord) its own autonomous Go-side timer — three clocks that could drift apart and double-send. Now a single monotonic timer in `alert_engine.sh` drives all dispatch, and each channel library (`email_alerts.sh`, `sms_alerts.sh`, `discord_alerts.sh`) is reduced to a pure *transport* that only knows how to SEND, never *when*.

> ℹ️ NOTE: This engine decides alert **dispatch** only. Whether the link went down or came back is decided once, by `detect_data_connection_events` in `events.sh` (the Recent Activities producer), and the engine follows its `ev_link_state`. So every outage that reaches a channel also has an `internet_lost` / `internet_restored` pair in the feed; an outage shorter than the [alert wait](#threshold-semantics) is logged and sends nothing. Detector rules: [connection-quality.md → One detector, one alert](connection-quality.md#one-detector-one-alert).

---

## Quick Reference

| Item | Value |
|------|-------|
| Frontend page | `/monitoring/alerts` (`components/monitoring/alerts/`) |
| Hooks | `useAlerts` (`hooks/use-alerts.ts`), `useAlertsLog` (`hooks/use-alerts-log.ts`) |
| Types | `types/alerts.ts` |
| CGI endpoint | `GET`/`POST` `/cgi-bin/quecmanager/monitoring/alerts.sh` |
| Alert engine | `/usr/lib/qmanager/alert_engine.sh` (sourced by `qmanager_poller`) |
| Channel transports | `/usr/lib/qmanager/{email_alerts,sms_alerts,discord_alerts}.sh` |
| Discord daemon | `/usr/bin/qmanager_discord` (source: `discord-bot/`) |
| Discord hand-off | `/tmp/qmanager_discord_spool/` (`root:root 1777`, one `<epoch>-<pid>-<seq>.json` per DM) — see [Spool directory](#spool-directory-tmpqmanager_discord_spool) |
| Reboot breadcrumb helper | `/usr/bin/qmanager_crash_log_append` (sudoers-gated root helper) |
| Routing config | `/etc/qmanager/alert_routing.json` (**persistent**, version 1) |
| Channel configs | `/etc/qmanager/{sms_alerts,email_alerts,discord_bot}.json` (**persistent**, **no secrets**) |
| Alert wait (one for all channels) | `alert_after_min` in `/etc/qmanager/quality_thresholds.json`, resolved by `cq_alert_after_min` (`/usr/lib/qmanager/conn_state.sh`); default 5 min. Exposed as top-level `alert_after_min` (1–1440) in the CGI's `GET` and `save_settings` — see [CGI contract](#cgi-contract--cgi-binquecmanagermonitoringalertssh) |
| Channel logs | `/tmp/qmanager_{sms,email,discord}_log.json` (NDJSON, cap 100 each). SMS and Discord seeded `root:root 0666` by `qmanager_setup`; email is root-only and unseeded — see [tmp-file-ownership.md](tmp-file-ownership.md#the-alert-channel-logs) |
| Link verdict source | `ev_link_state`, set by `detect_data_connection_events` in `events.sh` |
| Last cleared outage | `/tmp/qmanager_last_outage` (**tmpfs on purpose**), one line `<secs> <end_uptime> <changed\|-> <wan4\|-> <wan6\|->`; published as `connectivity.last_outage_*` — see [Last cleared outage](#last-cleared-outage-tmpqmanager_last_outage) |
| Secrets store | `/etc/qmanager-secrets/` (`0700 root:root`) — `discord_bot_token`, `email_app_password`, `msmtprc` (each `0600 root:root`) |
| Secret helper | `/usr/bin/qmanager_secret_set` (sudoers-gated root helper; value on **stdin**) |
| Test-email helper | `/usr/bin/qmanager_email_send` (sudoers-gated root helper; one verb, `test`) |
| Reboot ledger | `/etc/qmanager/reboot_history.json` (**persistent**, NDJSON, cap 10) |
| Boot-id state | `/etc/qmanager/last_boot_id` (**persistent**) |
| Crash log (read-only here) | `/usrdata/qmanager/crash.log` (**persistent**, `root:root 0644` in a root-owned dir; written by watchdog / scheduled-reboot worker / root helper; two line shapes — see [the line contract](#the-crashlog-line-contract)). Path and one-time legacy migration: `scripts/usr/lib/qmanager/crash_log.sh` (`QM_CRASH_LOG`, `qm_crash_log_prepare`) |
| Legacy redirects | `/monitoring/{email-alerts,sms-alerts,discord-bot}` → `/monitoring/alerts` |

**The model, at a glance:** 3 events × 3 channels, gated by a user routing matrix AND a hardcoded backend capability table.

| Event | SMS capable? | Email capable? | Discord capable? |
|-------|:---:|:---:|:---:|
| `connection_lost` | ✅ | ❌ (needs internet) | ❌ (needs internet) |
| `connection_restored` | ✅ | ✅ | ✅ |
| `reboot` | ✅ | ✅ | ✅ |

**Effective send** = channel master-enabled **AND** routing cell = true **AND** capable. The engine's capability table (`_ae_capable`) is the single source of truth; the CGI mirrors it and hard-clamps the incapable `connection_lost` cells to `false` on every save.

---

## The routing × capability model

Two independent matrices decide whether a `(event, channel)` pair fires. Keeping them separate is deliberate: *routing* is user preference (a mutable file), *capability* is physical reality (hardcoded truth).

### Capability (physical possibility — hardcoded)

`connection_lost` alerts fire *while the internet is down*. Email (SMTP over the WAN) and Discord (Gateway API over the WAN) physically cannot be delivered in that state, so only SMS — which rides the cellular control channel via `qsms`, independent of the data bearer — is capable. Both `connection_restored` and `reboot` fire *after* connectivity is back, so all three channels are capable.

This lives in `alert_engine.sh`:

```sh
_ae_capable() {
    case "$1" in
        connection_lost)            [ "$2" = "sms" ] ;;              # SMS only
        connection_restored|reboot) case "$2" in sms|email|discord) return 0 ;; *) return 1 ;; esac ;;
        *) return 1 ;;
    esac
}
```

The CGI's `GET` response advertises the same table verbatim, with machine-readable reason keys the UI renders as tooltips:

```json
"capabilities": {
  "connection_lost":     { "sms": true, "email": false, "email_reason": "email_needs_internet",
                           "discord": false, "discord_reason": "discord_needs_internet" },
  "connection_restored": { "sms": true, "email": true, "discord": true },
  "reboot":              { "sms": true, "email": true, "discord": true }
}
```

> ⚠️ WARNING: The capability table is duplicated in exactly two places — `_ae_capable()` in `alert_engine.sh` and the `capabilities` block + the `ROUTING_DEFAULT` clamp in `alerts.sh`. **These must stay in lockstep.** Adding a new capable `(event, channel)` pair is a one-line change to `_ae_capable`, but you must mirror it in the CGI's `capabilities` JSON and relax the clamp, or the UI will show a cell the engine refuses to fire (or the server will strip a cell the engine would honor).

### Routing (user preference — `alert_routing.json`)

Per-event, per-channel booleans the user ticks under **Sends for** in each channel's panel. Missing file or unparseable JSON falls back to the built-in default (see schema below). The engine reads only the `.events` object; the `version` wrapper is metadata for future migrations.

### Effective-send resolution

```sh
_ae_effective_send() {           # <event> <channel>
    _ae_capable "$event" "$channel" || return 1        # 1. physically possible?
    # 2. channel master-enabled? (_sa_enabled / _ea_enabled / _ae_discord_enabled)
    # 3. routing cell true? (jq lookup into _ae_routing_json)
}
```

All three must hold. Because capability is checked *first*, a routing cell the user could never have set true (the clamped `connection_lost` email/discord cells) can never fire even if a hand-edited config file forces it.

---

## Config files & on-disk shapes

Config was additive through the centralized-alerts consolidation: no channel key was renamed or removed, so an OTA-upgraded device kept its SMS/email/Discord settings untouched, and the only *new* file, `alert_routing.json`, defaults-on-missing.

> ⚠️ WARNING: **v0.1.14 broke that additive streak, deliberately and exactly once.** `bot_token` and `app_password` are now `del()`ed from their config JSONs and replaced by the marker booleans `token_set` / `app_password_set`; the credentials moved to a root-only directory. `migrate_alert_secrets()` performs the conversion on install and on every OTA. See [Secret storage](#secret-storage-etcqmanager-secrets) — including why a permission fix would not have worked.

### `alert_routing.json` (new, version 1)

`/etc/qmanager/alert_routing.json` — **persistent**, written atomically by the CGI on save, read by the engine on init and on reload.

```json
{
  "version": 1,
  "events": {
    "connection_lost":     { "sms": true, "email": false, "discord": false },
    "connection_restored": { "sms": true, "email": true, "discord": true },
    "reboot":              { "sms": true, "email": true, "discord": true }
  }
}
```

- `version` — schema version. Currently `1`. Reserved for future migrations; the engine ignores it and reads only `.events`.
- `events.<event>.<channel>` — routing boolean. The `connection_lost.email` and `connection_lost.discord` cells are **server-authoritative false** — the CGI clamps them on every write regardless of what the client submits.
- **Defaults-on-missing:** both the engine (`_AE_ROUTING_DEFAULT`) and the CGI (`ROUTING_DEFAULT`) carry an identical literal used verbatim when the file is absent or fails to parse.

### Channel configs (no secrets, as of v0.1.14)

| File | Keys | Secret handling |
|------|------|-----------------|
| `sms_alerts.json` | `enabled`, `recipient_phone`, `threshold_minutes` | none |
| `email_alerts.json` | `enabled`, `sender_email`, `recipient_email`, `app_password_set`, `threshold_minutes` | the password is **not in this file** — `app_password_set` is a non-secret marker boolean |
| `discord_bot.json` | `enabled`, `owner_discord_id`, `threshold_minutes`, `token_set`, `autonomous_notify` | the token is **not in this file** — `token_set` is a non-secret marker boolean |

These three files stay `www-data:www-data 0644` on purpose: the CGI must keep rewriting them, and they no longer hold anything worth protecting. The credentials themselves live in a separate root-only directory — see below.

> ℹ️ NOTE: `threshold_minutes` in these files is now a **copy** of the one alert wait. The authority is `alert_after_min` in `/etc/qmanager/quality_thresholds.json` (Connection Quality); the per-channel keys are only the resolver's fallbacks for a device that has never written it. Every `save_settings` writes the same value into all four places.

---

## Secret storage (`/etc/qmanager-secrets/`)

**Short version: the Discord bot token and the Gmail app password used to sit in plaintext inside `/etc/qmanager`, a directory `www-data` owns, so every local account on the modem could read them. They now live in a sibling directory that only root can enter, and `www-data` writes them exclusively through one narrow root helper.**

### What was wrong

`/etc/qmanager/discord_bot.json` shipped mode `0644` with a live Discord bot token stored as a plain JSON string; `/etc/qmanager/email_alerts.json` did the same with the operator's Gmail app password; and the generated `/etc/qmanager/msmtprc` held that password a second time, because msmtp has no other way to receive it non-interactively.

> ℹ️ NOTE: Scope it accurately. This was **local-process disclosure**, not an unauthenticated web fetch. The lighttpd docroot is `/usrdata/qmanager/www` — `/etc/qmanager` was never served, and no CGI endpoint ever returned either secret (`GET` has always surfaced only the `*_set` booleans). What could read them was any local account on the device: the web console shell, any Entware daemon, `www-data`, and anything that obtained a shell through an unrelated CGI bug. Overstating this as "the token was on the web" is as wrong as understating it.

### Why a `chmod` was NOT the fix

This is the load-bearing rationale. Do not "simplify" this back to a permission pin.

- **Directory write permission governs unlink and rename, not the file's mode.** `www-data` *owns* `/etc/qmanager`, so it can delete a `root:root 0600` file there and drop in its own — or simply `chmod` a file it owns back to `0644`. A per-file pin inside that directory is decorative.
- **A root-owned *subdirectory* does not help either.** The parent's owner can rename the subdirectory out of the way and put its own in its place. Nor does the sticky bit: the sticky-bit exemption covers the directory's owner, which *is* `www-data`.
- **`qmanager_setup:177` runs a bare `chown -R www-data:www-data /etc/qmanager` on every boot**, with no exclusion list. Any ownership pin applied at install time therefore survives exactly one boot cycle.
- **This was already learned the hard way, and the answer has been the same three times.** The systemd `EnvironmentFile` used to live in that directory with a `root:root` carve-out; fielded devices were found with the pin flipped, and it was relocated to `/etc/qmanager.env`. This secrets store was the second. The third is the **auth-backup store** — `/etc/qmanager/backups` → `/etc/qmanager-backups` (`0700 root:root`), holding the timestamped `auth.json` snapshots of the QManager login password — moved by `migrate_backup_location()` for exactly the reasons in this section, not for any new one. `install_rm520n.sh:1333-1344` carries a standing instruction not to reintroduce carve-outs. Live evidence that relocation works: `/etc/qmanager.env` is still `root:root` today, after many boots, and a real migration run on the RM520N-GL carried five existing snapshots across byte-for-byte. All three siblings are tabulated together in [qmanager-independence.md](qmanager-independence.md#-nothing-that-must-be-protected-from-www-data-may-live-in-etcqmanager).

### The layout

```
/etc/qmanager-secrets/          0700 root:root   ← a SIBLING of /etc/qmanager, not a child
├── discord_bot_token           0600 root:root   raw value, no trailing newline
├── email_app_password          0600 root:root   raw value, no trailing newline
└── msmtprc                     0600 root:root   moved from /etc/qmanager/msmtprc
/usr/bin/qmanager_secret_set    0755 root:root   root helper (sudoers-gated)
/usr/bin/qmanager_email_send    0755 root:root   root helper (sudoers-gated)
```

> ⚠️ WARNING: **The sibling relationship is the whole fix.** `qmanager_setup:177` chowns the literal path `/etc/qmanager`, so `-R` cannot descend into `/etc/qmanager-secrets`. That is a *structural* property — it holds for files that do not exist yet. A carve-out list inside the chown would fail open the moment someone adds a new secret and forgets to list it. Never move this directory under `/etc/qmanager`.

The installer creates the directory with `install -d -m 0700` (never `mkdir -p`, which no-ops on an existing directory and would let a drifted mode persist across every future OTA), then re-asserts `chown root:root` + `chmod 0700`. Every step is non-fatal — an abort inside `install_backend()` would kill an in-flight OTA with services already stopped.

### `qmanager_secret_set` — the write path

`www-data` never writes the secrets directory itself. The CGI shells out over one bare-path sudoers grant:

```
www-data ALL=(root) NOPASSWD: /usr/bin/qmanager_secret_set
```

No arguments in the grant, no wildcards — matching `qmanager_crash_log_append` and the `qmanager_*_arm` helpers. All validation lives inside the helper, where it can be read and tested; a sudoers wildcard cannot express a whitelist, a length cap, or a symlink refusal.

| Invocation | Behavior |
|------------|----------|
| `qmanager_secret_set set <name>` | Reads the value from **stdin**, validates it, writes it `0600 root:root`, renders `msmtprc` (email only), then sets the `*_set` marker |
| `qmanager_secret_set clear <name>` | Removes the secret file (and `msmtprc` + any legacy copy, for email), then sets the marker `false` |
| `qmanager_secret_set refresh email_app_password` | Re-renders `msmtprc` from the **already-stored** password plus the current `sender_email`. Exists because the user can change `sender_email` without re-typing the password, and `msmtprc` embeds both |

`<name>` is a hard two-literal whitelist: `discord_bot_token` or `email_app_password`. Nothing from argv is ever interpolated into a path. Output is exactly one line of JSON (`{"success":true}` or `{"success":false,"error":…,"detail":…}`), matching every other `qmanager_*` root helper.

> ⚠️ WARNING: **The value goes on stdin, never on argv.** `/proc/<pid>/cmdline` is world-readable, so passing a credential as an argument would recreate the exact disclosure this change removed — for the lifetime of the call, to every local process. The CGI's `root_helper_call_stdin` pipes it (`printf '%s' "$val" | $_SUDO …`), which is the same idiom `cgi_auth.sh` uses for `qmanager_set_ssh_password`.

Other invariants worth not "fixing" away:

- **Store the secret first, marker last.** `msmtprc` and the `*_set` marker are both *derived* artifacts. Writing the credential first means a failure anywhere downstream still leaves the credential durably on disk, so the resulting error is safely retryable and an interrupted save can never lose what the user typed.
- **A failed marker write is a hard `marker_write_failed` error, not a warning.** See [The `*_set` marker is load-bearing](#the-_set-marker-is-load-bearing) below.
- **Symlink refusal on every path written**, including inside the root-owned directory. `www-data` owns `/etc/qmanager` and could pre-plant a config path as a symlink to a root-owned target; a root write would otherwise follow it.
- **`mktemp` inside the destination directory**, with mode *and* owner set on the temp before the rename. A bare `mktemp` lands in `/tmp` (tmpfs — a different filesystem from `/etc`'s UBIFS), where `mv` degrades to copy+unlink and a power cut can tear the file. Setting the mode before the rename means the plaintext is never briefly world-readable at the final path.
- **No Oniguruma in the device's `jq`** — `gsub`/`test`/`match` abort at runtime. The helper uses only plain filters, `del()`, `//`, assignment and `--arg`/`--argjson`.

### `qmanager_email_send` — why a second helper exists

The email test-send used to run `msmtp -C <msmtprc>` **inline in the CGI, as `www-data`**. Once `msmtprc` became `0600 root:root` inside a `0700` directory, that stopped working — and `www-data` cannot even `stat` the file to explain why, so a `[ -f ]` precondition in the CGI could no longer tell "absent" from "forbidden". Relocating the credential therefore relocated the send:

```
www-data ALL=(root) NOPASSWD: /usr/bin/qmanager_email_send
```

One verb, `test`. Nothing is read from stdin. Subject and body are canned constants inside `email_alerts.sh` (`_ea_send_test_email` → `_ea_build_test_html`), so the helper cannot be driven into sending arbitrary content. Sender and recipient come from `email_alerts.json`, which root reads directly.

> ℹ️ NOTE: **This grants `www-data` no new capability.** It already owns `email_alerts.json`, so it already controlled the sender and recipient and could already trigger a test send — that button has always existed. The helper only removes its *need to read the credential*. It strictly narrows the web process's reach. It is kept separate from `qmanager_secret_set` on purpose: custody of secrets and sending mail are different privileges and should stay separately auditable.

The poller and `alert_engine.sh` already run as root and keep calling `email_alerts.sh` directly — they need nothing from this helper. A useful side effect: every writer of `/tmp/qmanager_email_log.json` is now root, and `www-data` only ever reads it (see [tmp-file-ownership.md](tmp-file-ownership.md)).

### The `*_set` marker is load-bearing

`app_password_set` / `token_set` started life as cosmetic UI hints. They are now the **sole authority** on whether a channel is configured, because nothing outside root can look at the credential any more:

- `email_alerts.sh:_ea_read_config` forces `_ea_enabled=false` when `app_password_set` is not `true`. (Before the relocation this tested the plaintext `$_ea_app_password`; leaving it that way would have silently disabled email on every device the moment the secret left the JSON.)
- The CGI's `GET` renders `app_password_set` / `token_set` straight through, and `save_settings` carries the existing marker forward when the user saves without re-typing a secret.
- The Go daemon's `Config` struct has **no `BotToken` field at all** — only `TokenSet bool`. The token is read from `/etc/qmanager-secrets/discord_bot_token` by `loadBotToken()`, which `TrimSpace`s it (a stray `\n` fails Discord auth with an opaque 401). Without a struct field the JSON physically cannot carry the token again, even if a future writer tries.

That is why a secret stored *without* its marker is a hard error: the operator would see a green save and then silently receive no alerts, with the explanation buried in a `detail` field the UI does not surface. The credential is already durable when the marker write is attempted, so the error is safely retryable — and the message is deliberately verb-neutral ("the credential store was updated"), because it is reachable from `clear` as well as `set`.

### Migration & OTA behavior

`migrate_alert_secrets()` in `install_rm520n.sh` (modeled on `migrate_environment_location()`) moves any existing plaintext out of the two config JSONs and out of `/etc/qmanager/msmtprc`, then `del()`s the secret keys and writes the marker in their place.

- **The `del()` is the point.** `/etc/qmanager` is an additive-only bucket — nothing in this tree prunes stale keys. Copying the secret to the new store and leaving the key behind would make the whole change cosmetic.
- **Ordering is safe against interruption.** The secret is durably at its new home *before* the key is deleted, so a power cut mid-migration can never lose the credential.
- **OTA self-heals.** `qmanager_update` re-runs the whole installer (`install_rm520n.sh --force --skip-packages --no-reboot`), so already-deployed devices sitting at `0644` are repaired on their next update. A second OTA is a clean no-op: once the key is gone there is nothing left to extract.
- **A `--purge` uninstall removes it.** `/etc/qmanager-secrets` is outside `$CONF_DIR`, so `uninstall_rm520n.sh` deletes it explicitly — otherwise a purge would leave a live bot token and a plaintext Gmail password on a device the user believes is clean.

### Support-bundle rules (two ways to leak this by accident)

`qmanager_health_check`'s bundle builder has two non-obvious constraints:

1. **`discord_bot_token` and `email_app_password` are deliberately NOT collected.** Redaction works by `sed`-matching a pattern *within* a line; these files are raw values with no surrounding structure, so **the entire file is the secret and there is no line for redaction to match**. `_purge_raw_secrets()` runs over the staged bundle immediately before redaction as a backstop against a future collector adding them by accident — but the primary control is that nothing collects them in the first place.
2. **`msmtprc` must keep its exact basename in the bundle.** `_redact_tree` finds it with `-name 'msmtprc'` and strips the `password` line. Copying it in as `msmtprc-secrets` or `email-msmtprc` would silently ship the SMTP password in cleartext. The collector reads from `/etc/qmanager-secrets/msmtprc` with the legacy path as a fallback, and stages both as plain `msmtprc`.

The `bot_token` / `app_password` JSON-key redaction patterns are still in `_redact_tree`, but they are now only reachable on a device whose migration has not run or failed — after a successful migration those keys do not exist in the configs at all.

### Reboot ledger

`/etc/qmanager/reboot_history.json` — **persistent** NDJSON, one JSON object per line, capped to the newest 10. Written by the engine, read-only in the CGI.

```
{"epoch":1721390000,"cause":"user"}
{"epoch":1721400000,"cause":"watchdog"}
```

---

## Engine placement in the poller cycle

`qmanager_poller` sources `alert_engine.sh` at startup (non-fatal — a broken alert channel must never crash the poller; missing lib stubs out `check_alerts`/`alert_engine_init` to no-ops). It calls:

- **`alert_engine_init`** — once, at poller startup. Resets in-memory state, reloads the [last cleared outage](#last-cleared-outage-tmpqmanager_last_outage) and takes a forced WAN address read, runs the boot-id reboot check (below), then `_ae_load_all_config` (routing, each channel's config, the wait).
- **`check_alerts`** — once per poll cycle, after the connectivity verdict for that cycle is known.

> ⚠️ WARNING: **Config is not trusted until `jq` exists.** `/usr/bin/jq` is a symlink into `/opt`, which mounts ~30 s into boot (RM520N-GL), and every config read before that silently returns defaults. `_ae_load_all_config` therefore checks `command -v jq` first; without it, it sets `_ae_cfg_pending=1`, logs one `config load deferred` warning, and returns 1. `check_alerts` retries it at the top of every cycle and **skips the whole cycle** while it still fails, so the engine never dispatches against default routing or a default wait. The init log line carries `cfg_pending=` for this reason.

The poller calls `detect_data_connection_events` immediately before `check_alerts`, so the engine reads that same cycle's `ev_link_state` (`"down"` / `"up"` / `""`). It also reads `CQ_ALERT_AFTER_MIN` (from `conn_state.sh`) and, for late reboot delivery only, `conn_internet_available`. It never probes or issues AT commands itself.

### Per-cycle flow

1. **Bail on low-power.** If `/tmp/qmanager_low_power_active` exists, return immediately. There is **no** freeze during watchdog recovery any more.
2. **Finish what init could not.** Retry `_ae_load_all_config` while `_ae_cfg_pending=1` (return if `jq` is still missing); classify a reboot held for the clock (`_ae_resolve_held_reboot`, see [Detection](#detection-boot-id-compare)); and trim the Discord log (`_ae_trim_discord_log`, see [Discord IPC contract](#discord-ipc-contract)).
3. **Pick up reload flags.** If the CGI touched any of `qmanager_alert_routing_reload`, `qmanager_email_reload`, `qmanager_sms_reload`, `qmanager_discord_reload` in `/tmp/`, consume (delete) the flag, re-read that config, and re-resolve the wait. (`qmanager_events_reload` is consumed earlier in the cycle by the poller's `cq_thresholds_refresh`, which also re-resolves the wait.)
4. **Read the monotonic clock.** `int($1)` from `/proc/uptime`. If unreadable, skip the cycle.
5. **Follow the detector:**
   - `""` (stale/unknown) → do nothing; a running outage timer keeps running.
   - `down` and not already down → start tracking: record `_ae_down_start = now_up`, reset the SMS `connection_lost` latch, remember the pre-outage WAN addresses (`_ae_outage_begin`), re-resolve the wait.
   - `up` and currently down → recovery: run `_ae_handle_restore` (which also records the cleared outage, `_ae_outage_record`), clear the timer.
   - Not down and `ev_link_state` is `up` → refresh the last-seen WAN addresses (`_ae_wan_seen_refresh`, throttled to one read per 30 s).
6. **While down:** send `connection_lost` once the outage reaches the wait (once per outage, latched by `_ae_lost_sent_sms`).
7. **Late reboot delivery:** if a reboot was detected at startup but the device came back already connected (never observed "down" by this engine — e.g. a clean user reboot with a fast reconnect), deliver the reboot alert once, here.

### Threshold semantics

There is **one wait** for every channel: `alert_after_min`, resolved by `cq_alert_after_min` in `conn_state.sh` from `quality_thresholds.json`, else the SMS, email, then Discord `threshold_minutes`, else 5. Each candidate must be an integer 1–1440. `_ae_wait_secs` converts it to seconds (300 if unset).

- **`connection_lost`** — SMS only. Fires once when the *ongoing* outage reaches the wait. It is not deferred while the watchdog ladder runs.
- **`connection_restored`** — SMS, email and Discord (routing permitting). Each fires at restore iff the TOTAL outage reached the same wait.
- **Degraded links never reach a channel.** `high_latency` / `high_packet_loss` are Network Events only.

Measured on RM520N-GL `61368cd2` (`/tmp` copies, faked clock, dispatch stubbed): a simulated 2-minute outage logged `internet_lost` + `internet_restored` and sent nothing (under the 5-minute default); a 10-minute outage sent the SMS at 5 min and `connection_restored` on all three channels.

Durations in message text are formatted from the monotonic elapsed seconds (`_ae_format_duration` → e.g. `"1h 4m 12s"`).

### Last cleared outage (`/tmp/qmanager_last_outage`)

**Short version:** every time an outage clears, the engine remembers how long it lasted, when it ended, and whether the device came back on a different WAN IP. The poller publishes that as `connectivity.last_outage_*` for the dashboard's "Last outage" row (field list: [connection-quality.md → The poller](connection-quality.md#the-poller--turning-probes-into-stats)). It sends nothing and does not affect dispatch.

| Edge | What is recorded | Function |
|------|------------------|----------|
| Down (`down` and not already down) | The pre-outage WAN IPv4 and IPv6. Each family falls back to its **last-seen** address when the bearer has already lost it by the time the drop is seen | `_ae_outage_begin` |
| While up | Last-seen WAN addresses, refreshed **at most every 30 s** (`_AE_WAN_SEEN_EVERY`). An empty read never overwrites a known address. Also forced once at `alert_engine_init` | `_ae_wan_seen_refresh` |
| Restore (`up` while down) | The outage's seconds (the same `elapsed` the restore alerts use), the end uptime (`now_up`), the WAN IPv4/IPv6 held now, and `changed` | `_ae_outage_record` |

`changed` compares the pre-outage and post-outage IPv4. When either IPv4 side is unknown it compares IPv6 instead, and when that is unknown too it stays unset (`-` on disk, `null` in the JSON). An unknown is never reported as "same".

**The WAN read is kernel-only — no AT command, no `qcmd`.** `_ae_wan_read` takes the first `ip -4 route show default` line, extracts its `dev`, and reads that device's first `ip -4 -o addr show dev <dev> scope global` address; the same again with `-6`. It goes through `dev` because on the RM520N-GL the default route carries **no `src`** (live: `default via 10.113.82.153 dev rmnet_data0`), so the route line itself never names the address. A result that is not address-shaped (digits and dots for IPv4, hex and colons for IPv6) is discarded as empty.

**The file.** One line, written `tmp` + `mv` so a reader never sees half of it:

```text
<secs> <end_uptime> <changed|-> <wan4|-> <wan6|->
```

Example (illustrative values: a 46 s outage that ended at uptime 81234, same IPv4, no IPv6):

```text
46 81234 false 192.0.2.10 -
```

It is **in tmpfs on purpose**. `end_uptime` is a `/proc/uptime` stamp, which is meaningless after a reboot; `/tmp` clears with the same reboot that resets the clock, so the two can never disagree. A poller respawn within one boot reloads it (`_ae_last_outage_load`), so the row survives a crash-restart. The loader validates every field and ignores the whole file on any failure: a non-numeric `secs` or `end_uptime`, a `changed` other than `true`/`false`/`-`, a non-address WAN field, a sixth field, or an `end_uptime` **ahead of** the current uptime.

> ⚠️ WARNING: this rides on `check_alerts`, so it is **skipped whenever `check_alerts` returns early**: while `/tmp/qmanager_low_power_active` exists, while `jq` is not yet mounted (`_ae_cfg_pending`, the first ~30 s of boot on the RM520N-GL), and on a cycle where `/proc/uptime` is unreadable. An outage that starts and clears inside that window is never recorded; one already in progress when the window ends is timed from the first cycle that runs, with the pre-outage address taken from the last-seen fallback.

> ℹ️ NOTE: device scope. The `dev`-not-`src` route shape was measured on the RM520N-GL. The RG501Q-EU is unverified: a default route there with no ` dev ` token, or a bearer with no `scope global` address, reads as unknown rather than wrong.

---

## Guardrails

- **Monotonic clock only.** Durations come from `/proc/uptime`, never `date +%s`. NTP/NITZ can step the wall clock backward or forward mid-outage; a monotonic source can't produce a negative or inflated downtime. (`date +%s` *is* used for the reboot ledger's wall-clock epoch and the coalescer window — those are timestamps, not durations, and the ledger write waits for the [epoch floor](#detection-boot-id-compare).)
- **No edge detector here.** The engine never compares `conn_internet_available` against a previous value. Two detectors could disagree about the same outage, so the feed and the channels could tell different stories. Following `ev_link_state` also inherits the detector's hold on a tier-flap repeat drop.
- **No freeze during watchdog recovery** (removed 2026-10-11). The old freeze deferred the down SMS until the ladder finished; the down SMS is now gated by the wait alone.
- **Freeze during low-power windows.** `/tmp/qmanager_low_power_active` suppresses all dispatch, same as the legacy per-channel timers.
- **Connectivity signal only.** Never latency or packet loss; a degraded link reaches no channel.
- **Null-safe.** `ev_link_state=""` (stale/unknown ping data) never starts or ends an outage; it only leaves an existing timer running.
- **Poller-lifetime state.** The outage timer and latches are in-memory only, not persisted across a poller restart — matching the pre-existing per-channel timers this engine replaced. The one exception is the *display-only* [last cleared outage](#last-cleared-outage-tmpqmanager_last_outage), which reloads from tmpfs.

---

## Reboot ledger & classification

The engine detects that a reboot happened by comparing the kernel's current boot id against the last one it saw, then classifies *why* by reading a breadcrumb the watchdog (or a root helper) left in `crash.log`. The watchdog itself is **not** modified — the wiring is entirely ledger-mediated.

### Detection (boot-id compare)

On `alert_engine_init`, `_ae_init_boot_check`:

1. Reads `/proc/sys/kernel/random/boot_id` (a fresh random UUID every boot).
2. Compares against `/etc/qmanager/last_boot_id`.
3. **First boot (file absent):** record the id, but **never alert.** Installs and OTA upgrades reboot the device themselves; that must not look like a crash to the user.
4. **Id changed, clock set:** `_ae_record_reboot` classifies the cause, appends to the ledger, arms `_ae_reboot_pending`, and persists the new id.
5. **Id changed, clock not set:** hold it in `_ae_boot_unresolved` and persist nothing. `_ae_resolve_held_reboot` retries every cycle and runs step 4 once the clock is sane.

**The epoch floor.** "Clock set" means `date +%s` ≥ `_AE_SANE_EPOCH=1700000000` (`_ae_clock_sane`), the same floor `qmanager_sites` uses. The device has no battery RTC and boots at Jan 1970 until `ql_time_daemon` steps the clock ([scheduled-timers.md](scheduled-timers.md) § "The 1970 boot window"). Classifying before the step compared a 1970 `now` against a real crash.log epoch, so every reboot read as `unplanned` and the ledger stored a 1970 epoch.

> ⚠️ WARNING: **Do not persist `last_boot_id` before classifying.** The id stays unwritten while the reboot is held so a poller restart inside the 1970 window still sees the change. With no SIM the clock never steps, so that boot's reboot is never classified, ledgered or alerted.

### The `crash.log` line contract

`crash.log` is a pipe-delimited flat file with **three fields and two line shapes**:

```
<epoch>|<verb>|<tag>
```

| Shape | Meaning | Written by |
|-------|---------|------------|
| `<epoch>\|reboot\|<tag>` | A reboot is about to happen (or just did) | `qmanager_watchcat` (Tier 4), `qmanager_crash_log_append` (user), `qmanager_scheduled_reboot` (scheduled) |
| `<epoch>\|skip\|<reason>` | The scheduled-reboot worker decided **not** to reboot | `qmanager_scheduled_reboot` |

The `skip` shape was added in 2026-09 for issue #9. It is a diagnostic breadcrumb, not an alert input: this platform masks `systemd-journald` to `/dev/null` and wipes `/tmp` each boot, so a fire guard that denies a spurious reboot would otherwise leave no evidence it ran at all. See [scheduled-timers.md](scheduled-timers.md#the-skip-trace-a-denied-fire-leaves-evidence).

> ⚠️ WARNING: **Field 2 is a discriminator, and every reader must filter on it.** There are three read sites across two files, and all three now test `$2 == "reboot"` (or `grep '|reboot|'`):
>
> | Reader | Purpose | Filter |
> |--------|---------|--------|
> | `alert_engine.sh` → `_ae_classify_reboot` | Which cause to report | `grep '\|reboot\|' \| tail -n 1` |
> | `alert_engine.sh` → `_ae_deliver_reboot` | Coalescing count for the trailing hour | `awk '$2 == "reboot"'` |
> | `qmanager_watchcat` → `count_recent_reboots()` | The watchdog's own hourly reboot budget | `awk '$2 == "reboot" && $3 == "tier4_escalation"'`, numeric epoch, 1970-clock aware |
>
> **Anyone adding a third line shape must update all three.** This is not hypothetical — missing the watchdog reader was a live regression during the issue #9 change: the new `skip` lines were counted as reboots by `count_recent_reboots()`, which tripped the hourly cap and silently disabled the watchdog's Tier-4 recovery rung for an hour. The classifier and the coalescer were correct; the third reader, in a different file, was not.

### Classification (crash.log tags)

`_ae_classify_reboot` takes the newest line **whose verb field is exactly `reboot`** — not simply the last line, which may now be a `skip` — and trusts it only if the entry is within a 600-second window of now (an old breadcrumb from a previous boot must not misclassify this one). A **negative** age — a breadcrumb stamped after `now` — is untrusted and leaves the cause `unplanned`; it used to be clamped to 0 and read as "just now":

| crash.log tag | Classified cause |
|---------------|------------------|
| `tier4_escalation` | `watchdog` |
| `user` | `user` |
| `scheduled` | `scheduled` |
| *(anything else, or no recent `reboot` line)* | `unplanned` |

- **`watchdog`** — the connection watchdog's Tier-4 reboot wrote `tier4_escalation` as root (see [connection-watchdog.md](connection-watchdog.md)).
- **`user`** — a user-initiated reboot (via `system/reboot.sh`) wrote the `user` breadcrumb through the sudoers-gated root helper (below).
- **`scheduled`** — the Scheduled Reboot timer fired legitimately and `qmanager_scheduled_reboot` wrote `<epoch>|reboot|scheduled` immediately before calling `reboot`. Before this existed, a scheduled reboot had no breadcrumb at all and fell through to `unplanned` — so the feature working exactly as configured was reported to the user as a crash.
- **`unplanned`** — the fallback when there's no positive breadcrumb: power loss, kernel panic, hardware watchdog. There is no hardware signal for this — it's inferred from the *absence* of an intentional-reboot tag.

The cause vocabulary is therefore **`watchdog | user | scheduled | unplanned`**, mirrored by the `RebootCause` union in `types/alerts.ts`. The four maps in `components/monitoring/alerts/alerts-log-card.tsx` — `REBOOT_TONE`, `REBOOT_GLYPH`, `REBOOT_CAUSE_KEY`, `REBOOT_CAUSE_EN` — are each declared `Record<RebootCause, …>`, so adding a member to the union without filling in all four **fails the build** rather than rendering a blank row. That is the enforcement; the shell side has none, so a new tag written by a worker but absent from `_ae_classify_reboot`'s `case` silently classifies as `unplanned`.

`scheduled` renders as a **neutral** row with a `CalendarClockIcon` — a reboot you asked for is not something to notice, so it sits beside `user` rather than beside `watchdog`. Its label is `alerts.activity.cause.scheduled`, present in all five locales.

> ℹ️ NOTE: The engine reads `crash.log` but never writes it — it only ever `tail`s it. A www-data CGI writing it directly would be a symlink-escalation hole, which is why the `user` breadcrumb goes through a root helper (below).
>
> ⚠️ WARNING: **`crash.log` moved to `/usrdata/qmanager/crash.log` (2026-10) and is genuinely root-owned now.** It used to live in `/etc/qmanager`, which `www-data` owns, so `www-data` could replace the file with a symlink between a root writer's check and its write — and `qmanager_setup`'s boot-time `chown -R www-data:www-data /etc/qmanager` handed the file itself back to `www-data` on every boot. `/usrdata/qmanager` is `root:root 0755`, so neither applies. **Never move it back under `/etc/qmanager`, and never point a new writer at the old path.** Every path constant comes from `crash_log.sh` (`QM_CRASH_LOG`); each consumer also hardcodes `/usrdata/qmanager/crash.log` as a fallback for when the lib is missing, so a path change must touch both.
>
> **One-time migration.** `qm_crash_log_prepare` (root only; a no-op for any other uid) creates the dir, then — if `/usrdata/qmanager/.crash_log_migrated` is absent and `/etc/qmanager/crash.log` is a regular file — reads the legacy file **as `www-data`** (`sudo -n -u www-data cat`, bounded by a 5 s timeout), keeps only lines matching `^[0-9]+\|[A-Za-z_]+\|[A-Za-z0-9_]+$`, puts them ahead of anything already in the new log, keeps the newest 100, and writes the marker. After that the legacy path is deleted on every call without being read: once the marker exists, anything at the old path could only have been planted by `www-data`. It runs from `qmanager_setup` at boot and at the top of every root writer and of `_ae_classify_reboot`. If the read fails — for example `sudo` is not reachable yet because `/opt` is not mounted at early boot — the legacy file is kept and the next caller retries.
>
> Reading as `www-data` matters: a symlink planted at the old path then resolves with `www-data`'s rights, so root never discloses a file `www-data` could not already read. Do not "simplify" it to a root `cat`, and never use `su` for it (the PAM module on this firmware hangs).

### The `user` breadcrumb root helper

`/usr/bin/qmanager_crash_log_append` — a narrowly-scoped root helper called by `system/reboot.sh` via sudoers:

```
www-data ALL=(root) NOPASSWD: /usr/bin/qmanager_crash_log_append
```

It exists solely so a user-initiated reboot leaves a `user` breadcrumb *before* the device goes down (the watchdog's own Tier-4 path writes `tier4_escalation` directly as root and needs no gate). Hardening the `installer-safety-auditor` required:

- **Reason whitelist:** the only accepted argument is the literal string `user`. Anything else is rejected with a JSON error — caller text is never interpolated.
- **Root-owned location:** the log lives in `/usrdata/qmanager`, which `www-data` cannot write, so the path cannot be swapped under the helper. The helper calls `qm_crash_log_prepare` first (dir + one-time migration, see the warning above).
- **Symlink refusal (defence in depth):** if `crash.log` is somehow a symlink, the helper refuses with `{"success":false,"error":"write_failed","detail":"crash.log is a symlink"}` and exit 1, rather than removing or following it.
- **Pinned environment:** `PATH` is set to `/opt/bin:/opt/sbin:/usr/bin:/usr/sbin:/bin:/sbin` and `umask 022`. The sudoers drop-in now sets `secure_path` for `www-data`, but the helper does not rely on it.
- Trims to the last 20 lines after its own append, matching the watchdog's own convention.
- **Pre-caps at 200 lines before appending.** The helper's 20-line trim only ever runs when the helper itself is called, and root workers now append directly without going through it — the scheduled-reboot worker writes a `skip` line on every denied fire, which on a device inside the boot-misfire window is once per boot. Both this helper and the worker's own appender therefore trim to the newest 100 lines whenever the file passes 200, so the added write volume cannot grow unbounded on flash. Neither trim is allowed to fail the append: on a failed `tail`/`mv` the temp file is removed and the line is written anyway.

### Delivery & coalescing

Reboot alerts are delivered **post-recovery** (once the device is back online), not at boot. `_ae_deliver_reboot`:

1. Reads the cause from the newest ledger entry.
2. **Coalesces:** counts `reboot` entries in `crash.log` from the trailing hour (same awk technique as the watchdog's own token bucket). If more than 3 (`_AE_REBOOT_COALESCE_THRESHOLD`), the message becomes *"Device rebooted N times in the last hour"* instead of one message per reboot — a flapping device doesn't spam N notifications.
3. Fires `reboot` to every effective-send channel (`sms`, `email`, `discord`).

> ℹ️ NOTE: There is **no** alerting on watchdog *tier transitions*. Only a completed reboot (boot-id change) produces a `reboot` alert. The tiers 1–3 recovery actions are invisible to the alert engine.

---

## Discord IPC contract

The Discord daemon (`/usr/bin/qmanager_discord`) is now a **pure DM transport**. Its old autonomous downtime timer is gated off by default; the shell alert engine owns all timing and drives the daemon through a spool directory.

### Spool directory (`/tmp/qmanager_discord_spool`)

One JSON file per DM. `qmanager_setup` seeds the directory `root:root` mode **1777** (`install -d -o root -g root -m 1777`), because the root poller and the www-data CGI test both enqueue and only the root daemon removes.

`discord_dispatch_message <message> [trigger] [recipient]` (in `discord_alerts.sh`) is fire-and-forget and never sleeps:

1. Verifies the daemon is running (see `da_is_running` below). If not, returns 1.
2. Returns 1 if the directory is missing or a symlink. It never creates it: only root (`qmanager_setup`, the daemon) does, and the daemon removes any spool dir that is not a real root-owned 1777 directory ([tmp-file-ownership.md](tmp-file-ownership.md#the-discord-spool-directory)).
3. Counts `*.json` entries. At `_DA_SPOOL_MAX=50` or more it logs `dispatch refused — spool holds N entries` and returns 1.
4. Writes the payload to a dot-temp in the same directory (`.tmp.<pid>.<seq>`), then hard-links it (`ln`, which fails if the name exists) to `<epoch %010d>-<pid>-<seq %04d>.json`, for example `1760266800-4123-0001.json`, and removes the temp. On a name clash it bumps the seq and retries (up to 20 times): a subshell shares `$$` and the seq counter, and `mv` would silently overwrite the earlier entry.
5. Returns 0. It does **not** wait for delivery.

Payload, built with `jq -n --arg` (defaults when the argument is omitted: `trigger` = `alert`, `recipient` = `discord`):

```json
{ "message": "[QManager] ...", "trigger": "connection_restored", "recipient": "discord:123456789012345678" }
```

The engine passes its event key and `discord:<owner id>`; the CGI test passes `test` and the same recipient. On return 1 the caller logs its own `failed` row (`_ae_log_discord_failed`, or the CGI's test-failure row), since nothing else will.

The daemon side is `discord-bot/spool.go`. `runCmdWatcher` drains the directory every 1 s in name order (`os.ReadDir` sorts by name): it skips dotfiles and anything not ending `.json`, removes a non-regular entry (symlink, FIFO) without reading it, reads at most 16 KB (`maxSpoolEntryBytes`), removes the file, then sends. It appends one NDJSON row per entry to `/tmp/qmanager_discord_log.json` with the payload's `trigger` and `recipient` (empty fields fall back to `alert` / `discord`). Because the daemon logs success itself, the shell side logs *only* the hand-off failure — otherwise a success would be double-logged. At start the daemon also removes the retired single-slot file `/tmp/qmanager_discord_cmd`.

- **Order.** Entries from one process deliver in exact order (the per-process `_DA_SEQ` counter). Two processes enqueueing in the same second sort by PID, which is arbitrary. The zero-padded epoch keeps the lexical order correct across the 1970 boot clock.
- **Late delivery is by design.** The watcher starts only after the daemon's first gateway connect. While it is still in its [connect backoff](discord-bot.md#lifecycle-and-restart-behaviour) the process is running, so `da_is_running` passes and entries queue; they deliver, oldest first, once it connects. A `reboot` or `connection_restored` DM can therefore arrive minutes after the event.
- **Leftover dot-temps.** A writer killed between step 4's write and `ln` leaves a `.tmp.*` file. The daemon never reads or removes it, and it does not count toward the cap; it goes away with `/tmp` at reboot.

> ⚠️ WARNING: Do not go back to a single command file. Two alerts inside one daemon tick overwrote each other there, and the wait that prevented it blocked the poller for up to 3 s. Keep the write as temp + `ln` inside the spool directory: the daemon reads any `*.json` it sees, so a direct `>` into a `.json` name can be read half-written.

**Log trim.** The daemon only appends, so the root engine trims `/tmp/qmanager_discord_log.json` to the newest `_AE_MAX_DISCORD_LOG=100` rows. `_ae_trim_discord_log` checks the size once every `_AE_DISCORD_TRIM_EVERY=150` cycles (~10 min at ~4 s/cycle) and copies through the seeded inode (`cat tmp > log`), never `mv` ([tmp-file-ownership.md](tmp-file-ownership.md#the-alert-channel-logs)).

### `autonomous_notify` flag

`discord_bot.json.autonomous_notify` (Go `Config.AutonomousNotify`) gates the daemon's own `RunNotifier` downtime timer. **Absent key → false** (Go zero value), so an OTA-upgraded device with an old config has NO double-send window: the shell engine is the sole alert driver. Flip it true only as a debug escape hatch.

### `da_is_running()` — the detail not to "fix" back

> ⚠️ WARNING: `da_is_running()` in `discord_alerts.sh` must work in **two** contexts with different capabilities. Do not simplify it back to a pidfile or a platform.sh-only check.

```sh
da_is_running() {
    if command -v svc_is_running >/dev/null 2>&1; then   # CGI context (platform.sh loaded)
        svc_is_running qmanager_discord
        return $?
    fi
    pgrep -f '/usr/bin/qmanager_discord' >/dev/null 2>&1  # poller context (no platform.sh)
}
```

- In the **CGI** context, `cgi_base.sh` sources `platform.sh`, so `svc_is_running` is available (as `www-data` it runs `sudo -n /usr/bin/qmanager_svc is-active qmanager-discord`; there is no raw `systemctl` grant for QManager units).
- In the **poller** context, `alert_engine.sh` sources `discord_alerts.sh` but the poller does **not** source `platform.sh` — so `svc_is_running` is undefined and the function falls back to a standalone `pgrep`.

The old `/run/qmanager-discord.pid` check was dead code: `qmanager-discord.service` is `Type=simple` with no `PIDFile=`, so nothing ever created that file — every poller-fired Discord alert silently failed. The `pgrep` fallback is what fixed it. Reverting to a pidfile or making the function depend on `platform.sh` re-breaks poller-driven Discord alerts.

---

## CGI contract — `/cgi-bin/quecmanager/monitoring/alerts.sh`

One endpoint replaces eight legacy ones (`email_alerts.sh`, `email_alert_log.sh`, `sms_alerts.sh`, `sms_alert_log.sh`, `discord_bot/{configure,status,test,alert_log}.sh`).

### `GET` — aggregated state

Returns all three channels' settings, the routing matrix, the capability table, and reboot history in one payload. **Never returns secrets** — the email password and the bot token are surfaced only as `app_password_set` / `token_set` booleans. Since the [secrets relocation](#secret-storage-etcqmanager-secrets) this endpoint could not return them even by accident: the credentials are no longer in the config directory at all, and `www-data` cannot read them.

```json
{
  "success": true,
  "alert_after_min": 5,
  "channels": {
    "sms":     { "enabled": false, "recipient_phone": "", "threshold_minutes": 5, "configured": false },
    "email":   { "enabled": false, "sender_email": "", "recipient_email": "", "app_password_set": false,
                 "threshold_minutes": 5, "msmtp_installed": false, "configured": false },
    "discord": { "enabled": false, "owner_discord_id": "", "token_set": false, "threshold_minutes": 5,
                 "connected": false, "configured": false }
  },
  "routing": { "events": { "connection_lost": {"sms":true,"email":false,"discord":false}, "...": {} } },
  "capabilities": { "connection_lost": {"sms":true,"email":false,"email_reason":"email_needs_internet",
                    "discord":false,"discord_reason":"discord_needs_internet"}, "...": {} },
  "reboots": [ {"epoch":1721400000,"cause":"watchdog"}, {"epoch":1721390000,"cause":"user"} ]
}
```

- `alert_after_min` — the one wait, from `cq_alert_after_min`. This is the field the page reads; `useAlertsForm` falls back to `channels.sms.threshold_minutes` only when an older backend omits it.
- `threshold_minutes` — the same value on all three channels, kept so older clients keep working. It is not the channel file's own key.
- `configured` — per channel, whether it has everything needed to send (SMS: phone set; email: sender + recipient + password stored; Discord: owner id + token stored).
- `msmtp_installed` — whether the `msmtp` mailer binary is present.
- `connected` — `true` only when `/tmp/qmanager_discord_status.json` says `"connected": true` **and** its mtime is under `DISCORD_STATUS_MAX_AGE=90` s old. The daemon rewrites the file every 30 s; a crashed daemon leaves its last `true` behind, which used to read as connected forever. A negative age (mtime ahead of the clock, e.g. across the boot clock step) also reads `false`.
- `reboots` — newest-first, capped 10 (read-only mirror of the ledger).

The handler reads each channel config with one `jq` (`cfg_json`, which yields `{}` when the file is absent or unparseable) instead of one per field, and derives `configured` inside the final response `jq`. Measured on RM520N-GL: 14 → 8 `jq` forks per `GET`, 329 → 260 ms.

### `POST` — dispatched on `action`

| Action | Purpose |
|--------|---------|
| `save_settings` | Persist all three channel configs + routing, atomically. |
| `send_test` | `{channel}` — send a real test alert through that channel's live transport. |
| `get_log` | Merged NDJSON log across all three channels, newest first, cap 100. |
| `install_msmtp` | Background `opkg` install of the `msmtp` mailer (optional email dependency). The CGI writes the background job's PID (`$!`) to `/tmp/qmanager_msmtp_install.pid`; it used to write `$$` from inside the subshell, which is the CGI's own PID, so the already-running guard never matched a live install. |
| `install_status` | Poll `install_msmtp` progress. |

**`save_settings`** validates everything up front, then writes each config atomically (temp + `mv`):

- Booleans (`sms.enabled` etc.) must be literal `true`/`false`.
- **The wait.** A top-level `alert_after_min` wins: when present and non-null it must be an integer 1–1440 with no leading zero (`invalid_threshold` otherwise) and becomes the new wait. Without it (older clients), the per-channel `threshold_minutes` set the wait: each is validated the same way, an **omitted one means the current wait**, and the last of SMS, email, Discord that differs from the current wait wins. Either way the value is merge-written to `quality_thresholds.json` `.alert_after_min` (`cq_quality_merge`; failure → `write_failed`) **before** the channel files, then written as `threshold_minutes` into all three channel files.

  The page sends `alert_after_min` **only when the user edited the wait** and never sends a per-channel `threshold_minutes`. That is the fix for the stale-wait bug: the old page posted all three per-channel values from its form, so a form seeded before another tab or the Connection Quality page changed the wait wrote the old value back on an unrelated save.
- SMS phone (when enabled): 7–15 digits, optional leading `+`, must start with a country code (not `0`).
- Email (when enabled): valid sender + recipient addresses; **control-character gate first** (a newline in any field templated into `msmtprc` would inject arbitrary msmtp directives — config-injection defense); a password is required only when `app_password_set` is not already `true`. The gate can check only a *newly typed* password — an already-stored one was validated by the helper when it was set, and this process can no longer read it. `qmanager_secret_set` re-validates the password and `sender_email` itself before templating, so nothing reaches `msmtprc` unchecked.
- Discord (when enabled): numeric snowflake owner id (15–25 digits; the form's `DISCORD_ID_REGEX` in `use-alerts-form.ts` matches it); a bot token is required only when `token_set` is not already `true`.
- **Marker carry-forward (replaces the old secret preservation):** the CGI can no longer read a stored secret, so an omitted/empty `app_password` or `bot_token` carries the existing `*_set` marker forward and leaves the credential untouched at its root-only path. The client still sends a secret only when the user typed a new one; the error slugs (`missing_app_password` / `missing_bot_token`) are unchanged so the frontend's handling and i18n still fire.
- **Routing clamp:** the submitted routing is merged over the default (`$def * $usr`), then `connection_lost.email` and `connection_lost.discord` are hard-set to `false` — server-authoritative, mirroring `_ae_capable`.
- **Discord service state.** The daemon caches token, owner and DM channel in memory at startup, so a *restart* (not start) is what picks up a change — but only when one is needed. With Discord enabled, `svc_enable qmanager_discord` always runs; `svc_reset_failed` then `svc_restart` run only if Discord was previously disabled, the owner id changed, a new token was stored this save, or `svc_is_running` says the daemon is down. An unrelated save (an SMS number, a routing tick) leaves the bot connected; the old code restarted it on every save, dropping its Gateway session each time. With Discord disabled, the CGI runs `svc_stop` then `svc_disable` (a disable failure is only logged).
- **Restart failure is reported, after the save.** If `svc_restart` fails, every config is already written and the reload flags touched; the response is then `{ "success": false, "error": "service_restart_failed", "detail": "Discord alert settings were saved, but the Discord service could not be restarted" }`. It takes precedence over `service_enable_failed`. Because a failed response can still mean "saved", `useAlerts.saveSettings` re-reads the state (`fetchState(true)`) on every failed save.
- **Why `svc_reset_failed` comes first.** `qmanager-discord.service` has `StartLimitBurst=5` / `StartLimitIntervalSec=3600`; once the daemon has exited non-zero five times (a rejected token does that), systemd refuses every start for the hour and the save would return `service_restart_failed`. Clearing the failed state lets a save that the user asked for start the bot again. It runs only on this user-initiated path, never from the poller, so a daemon that keeps crashing is still held down by the limit.
- **Reload signalling:** touches the four alert reload flags (`sms`, `email`, `discord`, `routing`) plus `/tmp/qmanager_events_reload`, so the poller picks up the new config and wait on its next cycle.

**Error shape** (all failures): `{ "success": false, "error": "<code>", "detail"?: "<human message>" }`.

**`get_log`** runs a single `jq` over whichever of the three logs is non-empty (the whole request went from 6 `jq` forks to 2, counting the `action` parse):

```sh
jq -R -n -c --arg sms "$SMS_LOG" --arg email "$EMAIL_LOG" '
    [inputs | input_filename as $f
     | (fromjson? | select(type == "object")
        | . + {channel: (if $f == $sms then "sms" elif $f == $email then "email" else "discord" end)})]
    | {success: true, entries: (sort_by(.timestamp) | reverse | .[0:100]), total: length}' "$@"
```

- `-R` + `fromjson?` drops a torn line instead of aborting the whole read. The logs are written in place without rename-atomicity ([tmp-file-ownership.md](tmp-file-ownership.md)), so a half-written row is possible.
- The channel is derived from `input_filename`, so a row never carries its own `channel` key on disk.
- `timestamp` is a local `"YYYY-MM-DD HH:MM:SS"` string, so a 1970-stamped row sorts oldest and never displaces a real row from the cap.
- No logs, or a `jq` failure, returns `{"success":true,"entries":[],"total":0}`.

**Log `trigger` values.** An engine row carries the event key (`connection_lost`, `connection_restored`, `reboot`). Every test send — SMS and email from their libraries, the CGI's own SMS and Discord-failure rows, and the Discord daemon's row for a spooled test — logs `"trigger": "test"` (it used to log free text such as `"Test SMS"`). The Discord daemon logs the `trigger` and `recipient` it was handed in the [spool payload](#spool-directory-tmpqmanager_discord_spool), so its rows read `connection_restored` / `reboot` / `test` with recipient `discord:<owner id>`; `"alert"` and `"discord"` appear only when a payload left them empty. `alerts-log-card.tsx` names the three event keys plus `test` and `alert` (`TRIGGER_KEY` → `alerts.activity.trigger.*`) and prints anything else verbatim.

### Email save & msmtp

The CGI no longer renders `msmtprc` itself — it has no `MSMTP_CONFIG` constant at all, deliberately, because a path constant would only invite a `[ -f ]` check that is always false and means nothing. On email save it:

1. Writes `email_alerts.json` **first**, carrying the existing `app_password_set` marker forward. Ordering matters: the helper reads `sender_email` out of this file to render `msmtprc`, and it owns the marker — writing the JSON afterwards would clobber whatever the helper just set.
2. Calls `qmanager_secret_set set email_app_password` (value piped on stdin) when the user typed a new password, or `qmanager_secret_set refresh email_app_password` when they did not — a `sender_email` change alone still has to be re-templated into `msmtprc`.

The helper renders `/etc/qmanager-secrets/msmtprc` for `smtp.gmail.com:587` STARTTLS with `timeout 30` in its `defaults` block, `0600 root:root`, from a temp file that carries the final mode and owner *before* the rename, then removes any pre-relocation copy at `/etc/qmanager/msmtprc`.

The Discord token is stored the same way (`qmanager_secret_set set discord_bot_token`), and — importantly — **before** the `qmanager-discord` service restart further down, because the daemon reads the secret file at startup. Storing after the restart would race the daemon against a token that is not on disk yet.

A helper failure surfaces as a normal `cgi_error`, reusing the helper's own slug and detail. A save that *looks* successful but silently did not store the credential is worse than a visible error.

> ℹ️ NOTE: `msmtprc` must still never contain a `logfile` directive — msmtp returns `rc=1` if it cannot write its log, even when the mail was sent.

> ℹ️ NOTE: **`timeout 30` caps how long an email send can block the poller.** The engine dispatches inline, so an unreachable SMTP server used to stall the poll cycle for msmtp's default network timeout. The directive lands only when `msmtprc` is next rendered: on the next Alerts save, since every `save_settings` runs `set` or `refresh`. An OTA does not re-render it.

### `send_test` per channel

- **SMS** — bypasses the registration guard for this one call (the CGI context has no poller globals to satisfy it, and the user explicitly asked to test), then calls `sms_alert_send`.
- **Email** — the *only* branch that cannot do the work itself. It shells out to `sudo qmanager_email_send test` and returns whatever the helper says; the whole send, including its NDJSON log entry, happens root-side. No precondition is duplicated in the CGI on purpose — the helper's `_ea_read_config` is the single authority on whether email is configured, and two checks that can disagree are worse than one that cannot. The error slugs (`library_missing` / `not_configured` / `msmtp_missing` / `send_failed`) come straight back from the helper, so the frontend is unchanged.
- **Discord** — requires the daemon running (`da_is_running`), reads `owner_discord_id` from `discord_bot.json`, then calls `discord_dispatch_message "<text>" "test" "discord:<owner id>"`. Success is NOT logged by the CGI — the daemon logs it, as `test`, once it completes the API call. A refused hand-off logs one `failed` row with the same recipient and returns `send_failed`.

---

## Frontend anatomy

Page: `/monitoring/alerts` — `components/monitoring/alerts/alerts.tsx`. Re-authored 2026-10-12 onto the compact bento used by Latency Monitor, Watchdog and Network Events. Two hooks, one type contract (`types/alerts.ts`):

- **`useAlerts`** (`hooks/use-alerts.ts`) — the whole settings surface: fetches `{alert_after_min, channels, routing, capabilities, reboots}`, saves it in one atomic POST, runs per-channel tests, and drives the msmtp install lifecycle. Exposes `saveSettings`, `sendTest`, `runInstall`, `refresh`.
- **`useAlertsLog`** (`hooks/use-alerts-log.ts`) — the merged activity log (`get_log`).

> ⚠️ WARNING: **`useAlerts().error` is load failures only.** `saveSettings` and `sendTest` no longer set it; each returns an `AlertsMutationResult` (`{ ok, error, code }`), and the caller toasts from that result ([toast-confirmation.md](toast-confirmation.md)). The page passes `error` to the Coverage card as "the last read failed": with state in hand it adds a "Showing the settings we last read from the device" notice, and with none it renders the read-failure block. A failed save or test that wrote `error` would put that notice over correct data. Keep mutation failures out of it.

### Layout

Header (title, one **Refresh** that reloads both the settings and the log), then one bento (`BENTO` / `BENTO_AREA` in `shapes.ts`): **Coverage** over **Channels** on the left (`3fr`), **Activity** spanning both rows on the right (`2fr`), stacked below `@5xl/main`.

| File | Role |
|------|------|
| `alerts.tsx` | Page shell, bento, the shared Refresh; `isComplete` stops a partial payload before `useAlertsForm` reads it |
| `coverage-card.tsx` | `AlertsCoverageCard` — three receipt rows (`COVERAGE_ROW`), one per event, listing the channels that will deliver and the ones that will try and fail; one verdict `Badge` in the header (`all` success, `outage` / `partial` warning); `none` shows no chip, because the rows already say nothing is delivered |
| `alerts-settings-card.tsx` | `AlertsSettingsCard` — the **Wait before alerting** row (`WaitRow`), the channel rail, one channel's panel (Off/On `SegmentedField`, **Sends for** event ticks, then its fields), and one `CardFoot` holding the selected channel's test button, **Discard** (while dirty) and **Save** for all three channels |
| `channel-field.tsx` | `ChannelPanelHead`, `ChannelField`, `ChannelSecretField`, `ChannelNotice` |
| `channel-rail.tsx` | `ChannelRail` — the three-pill channel tabs, each with a saved-status dot |
| `alerts-log-card.tsx` | `AlertsLogCard` — alert sends and reboots merged into day blocks; the list scrolls inside the card past `LOG_SCROLL`'s `max-h-[min(36rem,70svh)]` |
| `activity-row.tsx` | `ActivityRow` — the 52px log row |
| `derive.ts` | `deriveCoverage` — the page's one derived model (cells, channel status, rows, verdict) from saved state |
| `shapes.ts` | Every class string, tone map and geometry constant for the family |
| `use-alerts-form.ts` | `useAlertsForm` — the draft, validation, `isDirty`, `buildPayload` |
| `constants.tsx` | Channel and event glyphs, i18n key helpers, `isEventKey` |

Removed 2026-10-12, do not restore: `alerts-status-card.tsx` (the three-tile status band, which repeated what Coverage already says), `alert-routing-grid.tsx` (the editable 3×3 matrix — routing is now each panel's **Sends for** ticks), `coverage-model.ts` (the draft-versus-saved split that let Coverage preview a draft) and `coverage-labels.tsx` (the matrix cells' tone and glyph maps).

> ℹ️ NOTE: **Coverage is saved truth only.** It derives from `confirmedInput(state)`, never from the draft, so editing a channel does not move it until Save lands. The channel rail's dots read the same saved model, except that a channel whose draft blocks Save (`blockedChannelMap`) shows as incomplete.

> ℹ️ NOTE: The UI **renders** capability from the API `capabilities` block; it never hard-codes which `(event, channel)` pairs are possible. An incapable pair shows as a plain row with its reason (`alerts.coverage.reason.*`, via `reasonKey`) instead of a tick. A future capability change is a backend-only edit.

### The one wait

`WaitRow` edits the single wait (`form.threshold`, validated 1–1440 to match the CGI). `buildPayload` adds a top-level `alert_after_min` **only when the field differs from the saved wait** and never sends a per-channel `threshold_minutes`, so a form that loaded before the wait changed elsewhere cannot write the old value back. The saved wait is `state.alert_after_min`, falling back to `channels.sms.threshold_minutes` for an older backend (`savedWait`).

### Failure copy: CGI slug → `t()` key

A failed save or test toasts translated copy, never the CGI's English `detail`. `useAlerts` returns the `error` slug as `code` (`null` on success or a transport failure), and `alerts-settings-card.tsx` passes it through two helpers in `constants.tsx`:

| Helper | Map | Fallback |
|--------|-----|----------|
| `saveErrorKey(code)` | `SAVE_ERROR_KEY` → `alerts.channels.save.errors.*`. `invalid_sender` shares `invalid_email`; `empty_value` / `invalid_value` / `value_too_long` (from `qmanager_secret_set`) share `invalid_secret`; `marker_write_failed` → `partial` | `alerts.channels.save.failed` |
| `testErrorKey(channel, code)` | `send_failed` → `send_failed_{sms,email,discord}` (it means a different thing per channel); otherwise `TEST_ERROR_KEY` → `alerts.channels.test.errors.*` | `alerts.channels.test.failed` |

An unknown or missing slug gets the generic fallback. A new `cgi_error` slug on either path needs a map row and a key in all five catalogs, or it toasts the generic line.

### Form re-seeding, and why the secret inputs are cleared on save

`useAlertsForm` mirrors server truth into local `useState` and re-seeds itself **in place** when that truth changes, via a render-phase sync on a value fingerprint (`settingsSignature` in `use-alerts-form.ts`, which calls the hook's own `discard()`). The page used to force the same re-seed by putting a React `key` on `AlertsBody` — that remounted the whole body on every save, which also destroyed the "Saved!" flash, the active settings tab, the show-password / show-token toggles, keyboard focus, and the log card's fetch state. The key is gone; nothing on this page remounts on save. Full reasoning: [dashboard-state-motion.md](dashboard-state-motion.md) > Part 3.

> ⚠️ WARNING: **`alerts-settings-card.tsx` must clear `app_password` and `bot_token` after a successful save** (`handleSave` calls `form.setAppPassword("")` and `form.setBotToken("")` before `markSaved`), and this is required, not cosmetic. Because `GET` never returns secrets — only `app_password_set` / `token_set` booleans — a **rotation** (an already-set secret replaced with a new one) moves those booleans `true → true` and is therefore invisible to `settingsSignature`. Without the explicit clear, the typed secret stays in the input, `isDirty` (true whenever either secret field is non-blank) never settles, and the Save button stays enabled forever after a successful save. This bug shipped in production: the *first* password a user ever set worked only by accident, because `app_password_set` flipped `false → true` and the old key remounted the field away.

### Legacy page redirects

The three old pages are kept as thin client-side redirects so old bookmarks still work:

| Legacy route | Redirects to |
|--------------|--------------|
| `/monitoring/email-alerts` | `/monitoring/alerts` |
| `/monitoring/sms-alerts` | `/monitoring/alerts` |
| `/monitoring/discord-bot` | `/monitoring/alerts` |

The sidebar (`components/app-sidebar.tsx`) now lists a single **Alerts** entry pointing at `/monitoring/alerts`.

---

## Split-ownership boundaries

The Alerts page owns *notification* config only. Several adjacent files are owned by other subsystems and share the same `/etc/qmanager/` directory — **the Alerts page must never write them:**

| File | Owner | Alerts relationship |
|------|-------|---------------------|
| `qmanager.conf` `[watchcat]` (`watchcat.*`) | Connection Watchdog (`watchdog.sh`) | Off-limits. Recovery tiers, thresholds, SIM-failover config. |
| `ping_profile.json` | Connection Quality (all keys; the Watchdog page writes `interval_sec` through `watchdog.sh`) | Off-limits. The connectivity *producer's* config. |
| `quality_thresholds.json` | Connection Quality (presets, and `alert_after_min`) | **One key only:** `alerts.sh` merge-writes `alert_after_min` through `cq_quality_merge`, never a whole-file write. The presets are off-limits. |
| `crash.log` (`/usrdata/qmanager/`) | Watchdog (Tier 4) + Scheduled Reboot worker + the `user` root helper | **Read-only** for the engine; written only by root paths, in a root-owned dir. Three writers, two line shapes — see [the line contract](#the-crashlog-line-contract). |

The alert engine *reads* the link verdict indirectly (via `ev_link_state` from `events.sh`, itself derived from `qmanager_ping`) and writes none of these files. Conversely, the watchdog and quality subsystems never touch `alert_routing.json` or the channel configs. An alert can fire without a watchdog recovery, and a recovery can happen without an alert.

---

## Known gaps

Left open on purpose:

- **SMS and email send inline in the poll cycle, only time-capped.** An SMS or email send blocks the poller for its duration; email is capped by `timeout 30` in `msmtprc`. Moving them off the cycle was declined in favour of timeouts. Discord no longer blocks: its hand-off is a [spool write](#spool-directory-tmpqmanager_discord_spool).
- **Spooled Discord DMs deliver late while the daemon is connecting.** Entries queued during the daemon's connect backoff wait until it connects (up to 300 s between attempts), then go out oldest first. By design: dropping them would lose the alert.
- **The Discord status file can go stale during a long backoff.** The daemon writes `"error": "connecting"` once per failed attempt, so between attempts 300 s apart the file is older than 90 s. The `GET` reads only `.connected` and treats a file over `DISCORD_STATUS_MAX_AGE=90` s as disconnected, so the page shows "not connected", which is correct; the `error` string is not shown.

---

## Related docs

- Connection Watchdog — the recovery ladder that writes `tier4_escalation` reboot breadcrumbs, and the third `crash.log` reader — [connection-watchdog.md](connection-watchdog.md)
- Scheduled timers — the `scheduled` reboot cause, the `skip` line shape, and the clock-step fire guard that produces it — [scheduled-timers.md](scheduled-timers.md#the-skip-trace-a-denied-fire-leaves-evidence)
- Connection Quality — the `qmanager_ping` producer and the latency/loss thresholds surface — [connection-quality.md](connection-quality.md)
- Discord bot internals (daemon lifecycle, DM channel resolution, OAuth) — [discord-bot.md](discord-bot.md)
- SMS transport (`qsms` contract and `.detail` error mapping) — [sms.md](sms.md#transport-qsms)
- QManager independence (email/SMS alert install, msmtp, poller PATH, sudoers) — [qmanager-independence.md](qmanager-independence.md)
- `/tmp` cross-UID ownership rules (why the SMS and Discord logs are seeded and every writer of `/tmp/qmanager_email_log.json` is root) — [tmp-file-ownership.md](tmp-file-ownership.md#the-alert-channel-logs)
- Platform architecture, poller, boot sequence — `../rm520n-gl-architecture.md`
