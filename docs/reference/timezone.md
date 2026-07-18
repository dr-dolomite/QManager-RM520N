# Timezone

> Timezone lets the user set the device's local clock from **System Settings**. Selecting a zone (for example `Asia/Manila`) persists the choice to config, then pushes it to the live system by copying the matching zoneinfo file over `/etc/localtime` through a small root helper. Once applied, `date`, log timestamps, and alert times switch to local time immediately. Cron-driven schedules (scheduled reboot, low-power windows) adopt the new zone on the next device reboot, not instantly.

Before this feature was fixed, selecting a zone saved to config so the UI *showed* it, but the device clock stayed on UTC. The old apply path failed three ways at once, all silently (`2>/dev/null`): it looked for zone data under `/usr/share/zoneinfo` (which ships **empty** on this device), it wrote `/etc/TZ` (which glibc ignores), and it ran as `www-data` (which cannot write root-owned `/etc`). The current implementation resolves zone data from Entware's `/opt/share/zoneinfo`, installs `/etc/localtime` through a `sudo` root helper, and reports the live effective offset back to the UI so a partial failure is visible instead of hidden.

---

## Quick Reference

| Item | Value |
|------|-------|
| CGI endpoint | `scripts/www/cgi-bin/quecmanager/system/settings.sh` |
| HTTP methods | `GET` (read settings + live timezone truth), `POST` (`action=save_settings` with `timezone` + `zonename`) |
| Install path on device | `/www/cgi-bin/quecmanager/system/settings.sh` |
| Config library | `scripts/usr/lib/qmanager/system_config.sh` (installed `/usr/lib/qmanager/system_config.sh`) |
| Root helper | `scripts/usr/bin/qmanager_timezone_apply` (installed `/usr/bin/qmanager_timezone_apply`) |
| Config store | `/etc/qmanager/qmanager.conf` section `[settings]`, keys `timezone` (POSIX TZ) + `zonename` (IANA) |
| Live clock target | `/etc/localtime` (a **copied** TZif file, glibc-authoritative) |
| tzdata source | `/opt/share/zoneinfo` (Entware `zoneinfo-all`); fallback `/usr/share/zoneinfo` (empty on stock RM520N-GL) |
| Installer hook | `ensure_zoneinfo_packages()` in `scripts/install_rm520n.sh` (runs unconditionally, including OTA) |
| Sudoers rule | `scripts/etc/sudoers.d/qmanager` (one NOPASSWD line for `qmanager_timezone_apply`) |
| Frontend route | `app/system-settings/page.tsx` -> `components/system-settings/system-settings.tsx` |
| Frontend component | `components/system-settings/system-settings-card.tsx` |
| Frontend hook | `hooks/use-system-settings.ts` |
| Frontend types | `types/system-settings.ts` (`SystemSettings`, `TIMEZONES` table) |
| libc | glibc 2.31 (reads `/etc/localtime` or `TZ` env var, never `/etc/TZ`) |
| Modem NITZ | `AT+CTZU` disabled: the modem does not restamp the zone |

---

## The Apply Flow

```
System Settings card (system-settings-card.tsx)
  -> useSystemSettings.saveSettings()   (hooks/use-system-settings.ts)
    -> POST settings.sh action=save_settings { timezone, zonename }
      -> sys_set_timezone "$tz" "$zn"     (system_config.sh)
        -> persist timezone + zonename to qmanager.conf
        -> sudo -n /usr/bin/qmanager_timezone_apply "$zn"
          -> copy /opt/share/zoneinfo/<zn>  ->  /etc/localtime  (atomic)
        -> return status token: applied | failed | not_attempted | invalid
      <- POST response { success: true, timezone_apply_status: "<token>" }
    -> hook re-fetches GET (silent) to pull fresh effective-tz truth
```

The user picks a zone from a searchable combobox backed by the `TIMEZONES` table in `types/system-settings.ts`. Each entry carries both an IANA `zonename` (for example `America/New_York`) and its POSIX `timezone` string (for example `EST5EDT,M3.2.0,M11.1.0`). The POST sends both; the backend stores both but applies the live clock from the `zonename` alone (glibc resolves the TZif by name).

### POST request and response

`POST /cgi-bin/quecmanager/system/settings.sh`:

```json
{
  "action": "save_settings",
  "timezone": "PHT-8",
  "zonename": "Asia/Manila"
}
```

The `save_settings` action also carries the optional `hostname`, `temp_unit`, and `distance_unit` fields; only `timezone`/`zonename` are covered here. The response reports the live-apply outcome as a status token:

```json
{ "success": true, "timezone_apply_status": "applied" }
```

| `timezone_apply_status` | Meaning |
|-------------------------|---------|
| `applied` | Helper ran and installed the TZif over `/etc/localtime` successfully |
| `failed` | Helper ran but reported an error (zone not found, copy failed, sudoers not yet rolled out) |
| `not_attempted` | `timezone` was valid but `zonename` was empty, so no live apply was tried |
| `invalid` | `timezone` itself was empty; nothing was persisted (also returns a non-zero status) |

The hook (`use-system-settings.ts`) toasts a warning on `failed` ("Timezone saved, but couldn't apply to the device clock") and otherwise stays quiet. `save_settings` always triggers a silent re-fetch so the card can render the fresh ground-truth fields below.

### GET response: live timezone truth

`GET /cgi-bin/quecmanager/system/settings.sh` returns three timezone fields inside `settings{}` that describe what the clock is *actually* doing, not just what config says:

```json
{
  "success": true,
  "settings": {
    "timezone": "PHT-8",
    "zonename": "Asia/Manila",
    "effective_offset": "+0800",
    "effective_zone_abbr": "PHT",
    "timezone_applied": true
  }
}
```

| Field | Meaning |
|-------|---------|
| `effective_offset` | The live UTC offset from `date +%z` (for example `+0800`, `+0000`) |
| `effective_zone_abbr` | The live zone abbreviation from `date +%Z` (for example `PHT`, `UTC`) |
| `timezone_applied` | `true` when the live offset matches the offset recomputed from the configured zone's tzdata; `false` when the config and clock disagree |

The card shows a warning badge ("Not applied - clock shows `<offset>`") whenever `timezone_applied === false`, and a plain confirmation line ("Clock: `PHT +0800`") when it is `true`. These three fields are optional in `SystemSettings` (older backends omit them), so the UI only renders the badge when the backend explicitly reports the state.

---

## The Root Helper: `qmanager_timezone_apply`

The CGI runs as `www-data`, which cannot write root-owned `/etc`. `sys_set_timezone` therefore calls a dedicated root helper through `sudo -n` (non-interactive). The helper is deliberately tiny and self-validating because it runs as root on attacker-influenceable input (the zone name comes from an HTTP POST).

Contract: `sudo -n /usr/bin/qmanager_timezone_apply <zonename>`. It prints a one-line JSON result and exits `0` on success, non-zero on any rejection.

Validation and install steps, in order:

1. **Empty check.** Reject an empty zone name.
2. **Path-traversal guard.** Reject any name containing `..` (checked separately so the error pinpoints the cause).
3. **Charset guard.** The name must start with a letter and contain only IANA zone-name characters (`A-Z a-z 0-9 . _ + / -`).
4. **Resolve the source.** Look for `<dir>/<zonename>` under `/opt/share/zoneinfo` first, then `/usr/share/zoneinfo`. For the bare `UTC` zone, fall back to `Etc/UTC` (some trees ship only that).
5. **TZif magic-byte check.** Confirm the resolved file begins with the ASCII bytes `TZif`. This is the real security backstop: it proves the resolved path is genuine zone data, not some other file reached by an unexpected name.
6. **Atomic install.** Copy the source to a temp file `/etc/localtime.tmp.$$` **inside `/etc`**, re-verify the copy's `TZif` magic, then `mv -f` it over `/etc/localtime`.

Two design choices worth remembering:

- **Copy, not symlink.** `/opt` is Entware's late-boot bind-mount. A symlink from `/etc/localtime` into `/opt/share/zoneinfo` would dangle in early boot before `/opt` is mounted, leaving the clock on UTC until late boot. Copying the TZif bytes into `/etc` makes the zone available the instant `/etc` mounts.
- **Temp file inside `/etc`, not `/tmp`.** Only root can create files in root-owned `/etc`, so `www-data` cannot pre-stage a malicious file or symlink for the helper to land on. Staging in `/tmp` (world-writable, tmpfs) would open that race and would also downgrade the final `mv` from an atomic rename to a cross-filesystem copy.

Example success output:

```json
{"success":true,"zonename":"Asia/Manila","source":"/opt/share/zoneinfo/Asia/Manila"}
```

Example rejection outputs: `{"success":false,"error":"zone_not_found",...}`, `{"success":false,"error":"invalid_tzif",...}`, `{"success":false,"error":"path_traversal",...}`.

### Sudoers grant

One line in `scripts/etc/sudoers.d/qmanager`:

```
www-data ALL=(root) NOPASSWD: /usr/bin/qmanager_timezone_apply
```

Because the helper does its own IANA validation and magic-byte check, a bare grant (no argument constraint) is safe: `www-data` can pass any string, but only a real TZif under a whitelisted directory is ever copied.

---

## The Ground-Truth Check: `sys_get_effective_tz`

Since `/etc/localtime` is a **copied** TZif (no symlink), `readlink` cannot recover the zone name from it the way it can on a distro that symlinks `/etc/localtime -> ../usr/share/zoneinfo/...`. To answer "is the configured zone actually live?", `sys_get_effective_tz` compares offsets instead of names:

1. Read the live offset: `date +%z` (and abbreviation `date +%Z`).
2. Recompute the expected offset for the configured zone directly from tzdata, without touching the live clock: `TZDIR=/opt/share/zoneinfo TZ=<zonename> date +%z`.
3. If the two offsets match, the zone is applied (`applied=1`); otherwise not.

It prints a single space-separated line consumed by the GET handler:

```
<live_offset> <expected_offset> <applied:0|1> <live_zone_abbr>
# e.g.  +0800 +0800 1 PHT
```

> ℹ️ NOTE: `sys_set_timezone` deliberately does **not** `export TZ` or write `/etc/TZ`. Exporting `TZ` inside the CGI process would poison the later `date`-based check in the same request; writing `/etc/TZ` is inert here (that file is a musl/BusyBox convention, not glibc's).

---

## Platform Facts (why it works this way)

These are the load-bearing platform truths behind the design. Several older docs stated the opposite; treat this section as the corrected record.

- **glibc governs the clock.** This platform's libc is glibc 2.31. glibc reads `/etc/localtime` (or the `TZ` environment variable) as authoritative and **never** reads `/etc/TZ`. `/etc/TZ` is a musl/BusyBox convention and is inert on RM520N-GL. Writing it does nothing.
- **The zoneinfo database lives at `/opt/share/zoneinfo`.** The vendor path `/usr/share/zoneinfo` ships **empty** on stock RM520N-GL. Entware's `zoneinfo-all` package populates `/opt/share/zoneinfo`. Quick manual check: `TZDIR=/opt/share/zoneinfo TZ=Asia/Manila date` yields a `+0800` time.
- **`/etc` is its own persistent read-write UBIFS volume** (`/dev/ubi2_0`), separate from the read-only rootfs `/` (`ubi0`). A TZif copied to `/etc/localtime` survives reboot with no boot unit and no rootfs remount. (This corrects the older "`/etc` is read-only rootfs" and "system runs in UTC, no `/etc/localtime`" claims.)
- **Cron is BusyBox `crond`, not systemd.** On RM520N-GL scheduled jobs live in `/var/spool/cron/crontabs/root`, written directly; there is no `cron`/`crond`/`cronie` systemd unit. See the caveat below for the consequence.
- **The modem does not set the zone.** Network Identity and Time Zone updates (`AT+CTZU`) are disabled, so cellular registration never restamps the zone out from under a user selection. (Wall-clock *time* still syncs from the network; only the zone is under app control.)

---

## Installer and OTA Behavior

`ensure_zoneinfo_packages()` in `scripts/install_rm520n.sh` installs the `zoneinfo-all` Entware meta-package into `/opt/share/zoneinfo`. Without it, `qmanager_timezone_apply` has nothing to copy from and every apply returns `zone_not_found`.

Two properties make it OTA-safe:

- **It runs unconditionally**, outside the `--skip-packages` / `DO_PACKAGES` gate in `main()` (alongside `remove_conflicts()`). OTA upgrades invoke the installer with `--skip-packages`, which gates the normal `install_dependencies()` step. If zoneinfo install were behind that gate, the majority upgrade path (in-app **Software Update**) would never fetch tzdata and the fix would stay silently broken for existing users. Running it unconditionally means an OTA upgrade also picks up the zone database.
- **`zoneinfo-all` is additive and warn-only.** It is safe to install over partially pre-existing zoneinfo packages. If Entware is not yet bootstrapped (fresh install, pre-Entware) or the device is offline mid-update, the function logs and returns `0` rather than failing the upgrade. A subsequent run catches up.

---

## Cron Caveat: schedules adopt the new zone on the next reboot

`date`, log timestamps, and alert timestamps go local **immediately** after apply, because each of those is a fresh process that reads `/etc/localtime` at exec time.

Cron is different. RM520N-GL's `crond` is a long-lived BusyBox process, and glibc caches the timezone per-process at startup. A running `crond` cannot be forced to re-read `/etc/localtime` in place. Because scheduled-reboot and low-power windows are interpreted in system-local time, a zone change does not shift their trigger times until `crond` restarts, which happens naturally on the next device reboot.

`sys_set_timezone` deliberately does **not** attempt an in-request `crond` restart: doing so from a CGI response path would be unreliable, and the natural next-boot start picks up `/etc/localtime` cleanly. Practical guidance for users: set the timezone first, then configure scheduled reboot / low-power windows, so the two agree from the next boot onward.

---

## Related Docs

- Platform time and clock facts: `docs/rm520n-gl-architecture.md` (Time and Clock)
- `system_config.sh` function reference and the settings CGI: `docs/BACKEND.md`
- Settings endpoint request/response: `docs/API-REFERENCE.md` (System -> `settings.sh`)
- Filesystem topology (`/etc` as a separate UBIFS volume, `/opt` bind-mount): `docs/rm520n-gl-architecture.md` (Filesystem Topology)
