# Centralized Alerts

> **Applies to:** RM520N-GL (SDX65) · verified 2026-08
> **RG501Q-EU (SDX55):** unverified — see [`platform-matrix.md`](./platform-matrix.md)

The Alerts subsystem consolidates the three previously-independent notification channels — **SMS**, **Email**, and **Discord** — behind ONE page, ONE CGI endpoint, and ONE backend state machine. It exists to answer a single question every poll cycle: *"the internet just went down / came back / the device just rebooted — which enabled, routed, and physically-capable channel(s) should fire?"* Before this rework each channel carried its own downtime timer, its own threshold, and (for Discord) its own autonomous Go-side timer — three clocks that could drift apart and double-send. Now a single monotonic timer in `alert_engine.sh` drives all dispatch, and each channel library (`email_alerts.sh`, `sms_alerts.sh`, `discord_alerts.sh`) is reduced to a pure *transport* that only knows how to SEND, never *when*.

> ℹ️ NOTE: This engine decides alert **dispatch** only. The Recent Activities feed (`events.sh`, surfaced at `/monitoring`) has its own independent internet-lost/internet-restored detection and is **not** touched by the alert engine. A device can log a "connection lost" activity without sending any alert, and vice-versa.

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
| Reboot breadcrumb helper | `/usr/bin/qmanager_crash_log_append` (sudoers-gated root helper) |
| Routing config | `/etc/qmanager/alert_routing.json` (**persistent**, version 1) |
| Channel configs | `/etc/qmanager/{sms_alerts,email_alerts,discord_bot}.json` (**persistent**, **no secrets**) |
| Secrets store | `/etc/qmanager-secrets/` (`0700 root:root`) — `discord_bot_token`, `email_app_password`, `msmtprc` (each `0600 root:root`) |
| Secret helper | `/usr/bin/qmanager_secret_set` (sudoers-gated root helper; value on **stdin**) |
| Test-email helper | `/usr/bin/qmanager_email_send` (sudoers-gated root helper; one verb, `test`) |
| Reboot ledger | `/etc/qmanager/reboot_history.json` (**persistent**, NDJSON, cap 10) |
| Boot-id state | `/etc/qmanager/last_boot_id` (**persistent**) |
| Crash log (read-only here) | `/etc/qmanager/crash.log` (**persistent**, written by watchdog / root helper) |
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

`connection_lost` alerts fire *while the internet is down*. Email (SMTP over the WAN) and Discord (Gateway API over the WAN) physically cannot be delivered in that state, so only SMS — which rides the cellular control channel via `sms_tool`, independent of the data bearer — is capable. Both `connection_restored` and `reboot` fire *after* connectivity is back, so all three channels are capable.

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

Per-event, per-channel booleans the user toggles in the routing grid. Missing file or unparseable JSON falls back to the built-in default (see schema below). The engine reads only the `.events` object; the `version` wrapper is metadata for future migrations.

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
- **`qmanager_setup:139` runs a bare `chown -R www-data:www-data /etc/qmanager` on every boot**, with no exclusion list. Any ownership pin applied at install time therefore survives exactly one boot cycle.
- **This was already learned the hard way.** The systemd `EnvironmentFile` used to live in that directory with a `root:root` carve-out; fielded devices were found with the pin flipped, and it was relocated to `/etc/qmanager.env`. `install_rm520n.sh:1333-1344` carries a standing instruction not to reintroduce carve-outs. Live evidence that relocation works: `/etc/qmanager.env` is still `root:root` today, after many boots.

### The layout

```
/etc/qmanager-secrets/          0700 root:root   ← a SIBLING of /etc/qmanager, not a child
├── discord_bot_token           0600 root:root   raw value, no trailing newline
├── email_app_password          0600 root:root   raw value, no trailing newline
└── msmtprc                     0600 root:root   moved from /etc/qmanager/msmtprc
/usr/bin/qmanager_secret_set    0755 root:root   root helper (sudoers-gated)
/usr/bin/qmanager_email_send    0755 root:root   root helper (sudoers-gated)
```

> ⚠️ WARNING: **The sibling relationship is the whole fix.** `qmanager_setup:139` chowns the literal path `/etc/qmanager`, so `-R` cannot descend into `/etc/qmanager-secrets`. That is a *structural* property — it holds for files that do not exist yet. A carve-out list inside the chown would fail open the moment someone adds a new secret and forgets to list it. Never move this directory under `/etc/qmanager`.

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

- **`alert_engine_init`** — once, at poller startup. Resets in-memory state, runs the boot-id reboot check (below), loads routing, and refreshes each channel's config.
- **`check_alerts`** — once per poll cycle, after the connectivity verdict for that cycle is known.

The engine reads two poller globals: `conn_internet_available` (`true`/`false`/`null`) and `conn_during_recovery`. It never probes or issues AT commands itself.

### Per-cycle flow

1. **Bail on low-power / recovery.** If `/tmp/qmanager_low_power_active` exists, or `conn_during_recovery = true`, return immediately — no timer reset, no dispatch, no config reload. (See guardrails.)
2. **Pick up reload flags.** If the CGI touched any of `qmanager_alert_routing_reload`, `qmanager_email_reload`, `qmanager_sms_reload`, `qmanager_discord_reload` in `/tmp/`, consume (delete) the flag and re-read that config.
3. **Read the monotonic clock.** `int($1)` from `/proc/uptime`. If unreadable, skip the cycle.
4. **Edge-detect connectivity:**
   - `null`/empty → do nothing (don't guess; if already tracking an outage, leave the timer running — the poller may just be stuck on AT I/O).
   - `false` and not already down → start tracking: record `_ae_down_start = now_up`, reset the SMS `connection_lost` latch.
   - `true` and currently down → recovery: run `_ae_handle_restore`, clear the timer.
5. **While down:** check whether the SMS `connection_lost` threshold has now elapsed (fires once per outage, latched by `_ae_lost_sent_sms`).
6. **Late reboot delivery:** if a reboot was detected at startup but the device came back already connected (never observed "down" by this engine — e.g. a clean user reboot with a fast reconnect), deliver the reboot alert once, here.

### Threshold semantics

- **`connection_lost`** — SMS only. Fires once when the *ongoing* outage crosses the SMS channel's own `threshold_minutes`.
- **`connection_restored`** — each channel is evaluated independently against *its own* `threshold_minutes` at recovery time: a channel fires iff the TOTAL outage duration crossed that channel's threshold. This preserves the exact semantics of the three timers the engine replaced (each channel used to track downtime and threshold independently).

Durations in message text are formatted from the monotonic elapsed seconds (`_ae_format_duration` → e.g. `"1h 4m 12s"`).

---

## Guardrails

- **Monotonic clock only.** Durations come from `/proc/uptime`, never `date +%s`. NTP/NITZ can step the wall clock backward or forward mid-outage; a monotonic source can't produce a negative or inflated downtime. (`date +%s` *is* used for the reboot ledger's wall-clock epoch and the coalescer window — those are timestamps, not durations, and a small clock step there is harmless.)
- **Freeze during watchdog recovery.** When `conn_during_recovery = true`, `check_alerts` returns at the very top — no timer reset, no dispatch, not even config reloads. This mirrors `events.sh`'s `detect_data_connection_events` guard, so a watchdog recovery action (radio toggle, SIM swap) is never misread as a real downtime edge.
- **Freeze during low-power windows.** `/tmp/qmanager_low_power_active` suppresses all dispatch, same as the legacy per-channel timers.
- **Connectivity signal only.** The downtime signal is `conn_internet_available` exclusively — never latency or packet loss. Those are *quality* signals owned by `events.sh` / the Quality Thresholds card, not connectivity signals.
- **Null-safe.** Stale/null ping data never starts or ends an outage; it only leaves an existing timer running.
- **Poller-lifetime state.** The outage timer and latches are in-memory only, not persisted across a poller restart — matching the pre-existing per-channel timers this engine replaced.

---

## Reboot ledger & classification

The engine detects that a reboot happened by comparing the kernel's current boot id against the last one it saw, then classifies *why* by reading a breadcrumb the watchdog (or a root helper) left in `crash.log`. The watchdog itself is **not** modified — the wiring is entirely ledger-mediated.

### Detection (boot-id compare)

On `alert_engine_init`, `_ae_init_boot_check`:

1. Reads `/proc/sys/kernel/random/boot_id` (a fresh random UUID every boot).
2. Compares against `/etc/qmanager/last_boot_id`.
3. **First boot (file absent):** record the id, but **never alert.** Installs and OTA upgrades reboot the device themselves; that must not look like a crash to the user.
4. **Id changed:** classify the cause, append to the ledger, arm `_ae_reboot_pending`, and persist the new id.

### Classification (crash.log tags)

`_ae_classify_reboot` inspects the newest `crash.log` line — pipe-delimited `<epoch>|reboot|<tag>` — but only trusts it if the entry is within a 600-second window of now (an old breadcrumb from a previous boot must not misclassify this one):

| crash.log tag | Classified cause |
|---------------|------------------|
| `tier4_escalation` | `watchdog` |
| `user` | `user` |
| *(anything else, or no recent line)* | `unplanned` |

- **`watchdog`** — the connection watchdog's Tier-4 reboot wrote `tier4_escalation` as root (see [connection-watchdog.md](connection-watchdog.md)).
- **`user`** — a user-initiated reboot (via `system/reboot.sh`) wrote the `user` breadcrumb through the sudoers-gated root helper (below).
- **`unplanned`** — the fallback when there's no positive breadcrumb: power loss, kernel panic, hardware watchdog. There is no hardware signal for this — it's inferred from the *absence* of an intentional-reboot tag.

> ℹ️ NOTE: The engine reads `crash.log` but never writes it — it only ever `tail`s it. A www-data CGI writing it directly would be a symlink-escalation hole, which is why the `user` breadcrumb goes through a root helper (below).
>
> ⚠️ WARNING: `crash.log` is **not** root-owned in practice, whatever older comments claim. Like everything else in `/etc/qmanager` it is flipped back to `www-data:www-data 0644` by `qmanager_setup`'s boot-time `chown -R` (verified live). The root helper's value is **validation and integrity** — fixed path, fixed reason enum, symlink refusal, bounded trim — not exclusivity of write access. Do not build new logic on a "root-owned" premise for this file; if something genuinely must be out of www-data's reach, relocate it outside `/etc/qmanager` (see [Secret storage](#secret-storage-etcqmanager-secrets)).

### The `user` breadcrumb root helper

`/usr/bin/qmanager_crash_log_append` — a narrowly-scoped root helper called by `system/reboot.sh` via sudoers:

```
www-data ALL=(root) NOPASSWD: /usr/bin/qmanager_crash_log_append
```

It exists solely so a user-initiated reboot leaves a `user` breadcrumb *before* the device goes down (the watchdog's own Tier-4 path writes `tier4_escalation` directly as root and needs no gate). Hardening the `installer-safety-auditor` required:

- **Reason whitelist:** the only accepted argument is the literal string `user`. Anything else is rejected with a JSON error — caller text is never interpolated.
- **Symlink guard:** a symlinked `crash.log` is removed rather than followed.
- **Re-asserts `root:root 644` on every call**, not just at creation, because the `chown -R www-data:www-data /etc/qmanager` pass flips it back. Note that this only holds until the next boot chown — see the warning above; treat it as hygiene, not as an ownership guarantee.
- Trims to the last 20 lines, matching the watchdog's own convention.

### Delivery & coalescing

Reboot alerts are delivered **post-recovery** (once the device is back online), not at boot. `_ae_deliver_reboot`:

1. Reads the cause from the newest ledger entry.
2. **Coalesces:** counts `reboot` entries in `crash.log` from the trailing hour (same awk technique as the watchdog's own token bucket). If more than 3 (`_AE_REBOOT_COALESCE_THRESHOLD`), the message becomes *"Device rebooted N times in the last hour"* instead of one message per reboot — a flapping device doesn't spam N notifications.
3. Fires `reboot` to every effective-send channel (`sms`, `email`, `discord`).

> ℹ️ NOTE: There is **no** alerting on watchdog *tier transitions*. Only a completed reboot (boot-id change) produces a `reboot` alert. The tiers 1–3 recovery actions are invisible to the alert engine.

---

## Discord IPC contract

The Discord daemon (`/usr/bin/qmanager_discord`) is now a **pure DM transport**. Its old autonomous downtime timer is gated off by default; the shell alert engine owns all timing and drives the daemon over a filesystem command channel.

### Command file (`/tmp/qmanager_discord_cmd`)

`discord_dispatch_message` (in `discord_alerts.sh`) is fire-and-forget:

1. Verifies the daemon is running (see `da_is_running` below). If not, returns 1 — the caller logs its own `failed` entry, since nothing else will.
2. Atomically writes `{"message":"..."}` to `/tmp/qmanager_discord_cmd` (temp file + `mv`).
3. Returns 0 the instant the hand-off lands. It does **not** wait for delivery.

The daemon's `runCmdWatcher` goroutine polls that path on a 1s ticker: stat → read → remove → `ChannelMessageSend` to the owner DM channel → append its own NDJSON result line (`sent`/`failed`) to `/tmp/qmanager_discord_log.json`. Because the daemon logs success itself, the shell side logs *only* the "never reached the daemon" failure case (`_ae_log_discord_failed`) — otherwise a success would be double-logged.

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

- In the **CGI** context, `cgi_base.sh` sources `platform.sh`, so `svc_is_running` (which uses `sudo systemctl`) is available.
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

- `configured` — per channel, whether it has everything needed to send (SMS: phone set; email: sender + recipient + password stored; Discord: owner id + token stored).
- `msmtp_installed` — whether the `msmtp` mailer binary is present.
- `connected` — Discord daemon reachable / logged in (read from `/tmp/qmanager_discord_status.json`).
- `reboots` — newest-first, capped 10 (read-only mirror of the ledger).

### `POST` — dispatched on `action`

| Action | Purpose |
|--------|---------|
| `save_settings` | Persist all three channel configs + routing, atomically. |
| `send_test` | `{channel}` — send a real test alert through that channel's live transport. |
| `get_log` | Merged NDJSON log across all three channels, newest first, cap 100. |
| `install_msmtp` | Background `opkg` install of the `msmtp` mailer (optional email dependency). |
| `install_status` | Poll `install_msmtp` progress. |

**`save_settings`** validates everything up front, then writes each config atomically (temp + `mv`):

- Booleans (`sms.enabled` etc.) must be literal `true`/`false`.
- `threshold_minutes` per channel: integer 1–60.
- SMS phone (when enabled): 7–15 digits, optional leading `+`, must start with a country code (not `0`).
- Email (when enabled): valid sender + recipient addresses; **control-character gate first** (a newline in any field templated into `msmtprc` would inject arbitrary msmtp directives — config-injection defense); a password is required only when `app_password_set` is not already `true`. The gate can check only a *newly typed* password — an already-stored one was validated by the helper when it was set, and this process can no longer read it. `qmanager_secret_set` re-validates the password and `sender_email` itself before templating, so nothing reaches `msmtprc` unchecked.
- Discord (when enabled): numeric snowflake owner id (15–25 digits); a bot token is required only when `token_set` is not already `true`.
- **Marker carry-forward (replaces the old secret preservation):** the CGI can no longer read a stored secret, so an omitted/empty `app_password` or `bot_token` carries the existing `*_set` marker forward and leaves the credential untouched at its root-only path. The client still sends a secret only when the user typed a new one; the error slugs (`missing_app_password` / `missing_bot_token`) are unchanged so the frontend's handling and i18n still fire.
- **Routing clamp:** the submitted routing is merged over the default (`$def * $usr`), then `connection_lost.email` and `connection_lost.discord` are hard-set to `false` — server-authoritative, mirroring `_ae_capable`.
- **Discord service state:** enabling restarts `qmanager_discord` (a *restart*, not start — the daemon caches token/owner/DM-channel in memory at startup); disabling stops it.
- **Reload signalling:** touches all four reload flags (`sms`, `email`, `discord`, `routing`) so the poller's `check_alerts` picks up the new config on its next cycle.

**Error shape** (all failures): `{ "success": false, "error": "<code>", "detail"?: "<human message>" }`.

### Email save & msmtp

The CGI no longer renders `msmtprc` itself — it has no `MSMTP_CONFIG` constant at all, deliberately, because a path constant would only invite a `[ -f ]` check that is always false and means nothing. On email save it:

1. Writes `email_alerts.json` **first**, carrying the existing `app_password_set` marker forward. Ordering matters: the helper reads `sender_email` out of this file to render `msmtprc`, and it owns the marker — writing the JSON afterwards would clobber whatever the helper just set.
2. Calls `qmanager_secret_set set email_app_password` (value piped on stdin) when the user typed a new password, or `qmanager_secret_set refresh email_app_password` when they did not — a `sender_email` change alone still has to be re-templated into `msmtprc`.

The helper renders `/etc/qmanager-secrets/msmtprc` for `smtp.gmail.com:587` STARTTLS, `0600 root:root`, from a temp file that carries the final mode and owner *before* the rename, then removes any pre-relocation copy at `/etc/qmanager/msmtprc`.

The Discord token is stored the same way (`qmanager_secret_set set discord_bot_token`), and — importantly — **before** the `qmanager-discord` service restart further down, because the daemon reads the secret file at startup. Storing after the restart would race the daemon against a token that is not on disk yet.

A helper failure surfaces as a normal `cgi_error`, reusing the helper's own slug and detail. A save that *looks* successful but silently did not store the credential is worse than a visible error.

> ℹ️ NOTE: `msmtprc` must still never contain a `logfile` directive — msmtp returns `rc=1` if it cannot write its log, even when the mail was sent.

### `send_test` per channel

- **SMS** — bypasses the registration guard for this one call (the CGI context has no poller globals to satisfy it, and the user explicitly asked to test), then calls `sms_alert_send`.
- **Email** — the *only* branch that cannot do the work itself. It shells out to `sudo qmanager_email_send test` and returns whatever the helper says; the whole send, including its NDJSON log entry, happens root-side. No precondition is duplicated in the CGI on purpose — the helper's `_ea_read_config` is the single authority on whether email is configured, and two checks that can disagree are worse than one that cannot. The error slugs (`library_missing` / `not_configured` / `msmtp_missing` / `send_failed`) come straight back from the helper, so the frontend is unchanged.
- **Discord** — requires the daemon running (`da_is_running`), then `discord_dispatch_message`. Success is NOT logged by the CGI — the daemon logs it once it completes the API call (fire-and-forget hand-off).

---

## Frontend anatomy

Page: `/monitoring/alerts` — `components/monitoring/alerts/alerts.tsx`. Two hooks, one type contract (`types/alerts.ts`):

- **`useAlerts`** (`hooks/use-alerts.ts`) — the whole settings surface: fetches the combined `{channels, routing, capabilities, reboots}`, saves it in one atomic POST, runs per-channel tests, and drives the msmtp install lifecycle. Exposes `saveSettings`, `sendTest`, `runInstall`, `refresh`.
- **`useAlertsLog`** (`hooks/use-alerts-log.ts`) — the merged activity log (`get_log`).

Components: `alerts-settings-card.tsx` (per-channel config), `alert-routing-grid.tsx` (the event × channel matrix — renders capability from the API, never hard-coding which cells are possible; incapable cells render disabled with the reason tooltip), `alerts-status-card.tsx`, `alerts-log-card.tsx`, plus `use-alerts-form.ts` (form state) and `constants.tsx`.

> ℹ️ NOTE: The UI **renders** capability from the API `capabilities` block; it never hard-codes which `(event, channel)` cells are possible. A future capability change is a backend-only edit.

### Form re-seeding, and why the secret inputs are cleared on save

`useAlertsForm` mirrors server truth into local `useState` and re-seeds itself **in place** when that truth changes, via a render-phase sync on a value fingerprint (`settingsSignature` in `use-alerts-form.ts`, which calls the hook's own `discard()`). The page used to force the same re-seed by putting a React `key` on `AlertsBody` — that remounted the whole body on every save, which also destroyed the "Saved!" flash, the active settings tab, the show-password / show-token toggles, keyboard focus, and the log card's fetch state. The key is gone; nothing on this page remounts on save. Full reasoning: [dashboard-state-motion.md](dashboard-state-motion.md) > Part 3.

> ⚠️ WARNING: **`alerts-settings-card.tsx` must clear `app_password` and `bot_token` after a successful save**, and this is load-bearing rather than cosmetic. Because `GET` never returns secrets — only `app_password_set` / `token_set` booleans — a **rotation** (an already-set secret replaced with a new one) moves those booleans `true → true` and is therefore invisible to `settingsSignature`. Without the explicit clear, the typed secret stays in the input, `isDirty` (true whenever either secret field is non-empty) never settles, and the Save button stays enabled forever after a successful save. This bug shipped in production: the *first* password a user ever set worked only by accident, because `app_password_set` flipped `false → true` and the old key remounted the field away.

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
| `ping_profile.json` | Watchdog (`interval_sec`) + Connection Quality (`profile`/`targets`) | Off-limits. The connectivity *producer's* config. |
| `quality_thresholds.json` | Connection Quality (Latency & Loss Thresholds card, feeding `events.sh`) | Off-limits. Latency/loss presets are quality signals, not connectivity. |
| `crash.log` | Watchdog (Tier 4) + the `user` root helper | **Read-only** for the engine; written only by root paths. |

The alert engine *reads* the connectivity verdict indirectly (via the poller's `conn_internet_available` global, itself derived from `qmanager_ping`) but never touches any of these files. Conversely, the watchdog and quality subsystems never touch `alert_routing.json` or the channel configs. This clean separation is why an alert can fire without a watchdog recovery, and a recovery can happen without an alert.

---

## Related docs

- Connection Watchdog — the recovery ladder that writes `tier4_escalation` reboot breadcrumbs — [connection-watchdog.md](connection-watchdog.md)
- Connection Quality — the `qmanager_ping` producer and the latency/loss thresholds surface — [connection-quality.md](connection-quality.md)
- Discord bot internals (daemon lifecycle, DM channel resolution, OAuth) — [discord-bot.md](discord-bot.md)
- AT command transport (`sms_tool`, `flock` serialization for the SMS channel) — [at-command-transport.md](at-command-transport.md)
- QManager independence (email/SMS alert install, msmtp, poller PATH, sudoers) — [qmanager-independence.md](qmanager-independence.md)
- `/tmp` cross-UID ownership rules (why every writer of `/tmp/qmanager_email_log.json` is now root) — [tmp-file-ownership.md](tmp-file-ownership.md)
- Platform architecture, poller, boot sequence — `../rm520n-gl-architecture.md`
