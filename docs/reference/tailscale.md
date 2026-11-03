# Tailscale VPN

> **Applies to:** RM520N-GL (SDX65) · verified 2026-09
> **RG501Q-EU (SDX55):** unverified — see [`platform-matrix.md`](./platform-matrix.md)

Tailscale is an **optional, user-installed** mesh VPN. Nothing in a stock QManager install ships it: the surface's first job is to notice it is absent and offer to fetch it. Once installed it gives the modem a stable `100.x.y.z` address that works from anywhere, which on this product is not a convenience — it is the **way back in** when a change severs the LAN route. IP Passthrough, a gateway-IP edit and a full-bypass misconfiguration all warn the user to keep Tailscale or a serial console available, and those warnings are the reason this feature exists.

Everything runs as a real `tailscaled` daemon on the modem's own Linux. QManager owns the install, the systemd unit, the boot symlink and one preference file; it owns none of the protocol.

> ⚠️ **NEVER pass `--accept-routes` to `tailscale up`.** It disconnects the device from the network entirely and takes a **physical reboot** to recover — on a headless modem that means someone standing next to it. The flag is banned in `tailscale.sh` and the ban carries a comment at the call site.

---

## Quick Reference

| Item | Value |
| --- | --- |
| Install root | `/usrdata/tailscale/` (persistent `ubi2_0` volume) |
| Binaries | `/usrdata/tailscale/tailscale`, `/usrdata/tailscale/tailscaled` |
| Daemon state dir | `/usrdata/tailscale/` (`--statedir=`) |
| systemd unit | `tailscaled.service` in `/lib/systemd/system/` (rootfs — needs a `remount,rw`) |
| Boot enablement | the `multi-user.target.wants/tailscaled.service` **symlink**, never `systemctl is-enabled` |
| Root helper | `/usr/bin/qmanager_tailscale_mgr` (`install` · `update` · `uninstall` · `ensure_units`) |
| CGI endpoint | `GET`/`POST` `/cgi-bin/quecmanager/vpn/tailscale.sh` |
| SSH intent flag | `/etc/qmanager/tailscale_ssh` — `1` or absent. QManager-owned, **not** Tailscale's |
| Install / update progress | `/tmp/qmanager_tailscale_install.json` (`op:"update"` for an update) · `.pid` · `.log` |
| Latest-version cache | `/tmp/qmanager_tailscale_latest` — `<epoch> <version>`, 6 h |
| Auth URL spill | `/tmp/qmanager_tailscale_auth_url` |
| `tailscale up` tracking | `/tmp/qmanager_tailscale_up_output` · `_up_pid` |
| Frontend page | `/monitoring/tailscale` (`components/monitoring/tailscale/`) |
| i18n | `common.json` → `tailscale.*` (149 keys, all five packs) |
| Version | resolved at install time from `pkgs.tailscale.com/stable/?mode=json` (`TarballsVersion`); `TAILSCALE_ARCH="arm"` in the helper. No pin, no fallback |

---

## The install is a download, over the link being managed

`qmanager_tailscale_mgr install` asks `pkgs.tailscale.com/stable/?mode=json` for the latest version, fetches the sibling `.sha256`, streams `tailscale_<ver>_arm.tgz` through `sha256sum` into `tar` (no tarball is ever written: on the RM520N-GL 59 MB is free, the tarball is 37 MB and the binaries 70 MB unpacked, and `/tmp` is RAM), and installs the staged binaries into `/usrdata/tailscale/` only if the checksum matches. Measured 2026-11-03: free space bottoms out near 6 MB mid-unpack and settles near 12 MB. An unreachable lookup or a missing or malformed checksum fails the install (`version_lookup_failed` / `checksum_lookup_failed`); there is no pinned fallback, because a stale pin is the vulnerable build. Every curl is bounded (a stall-detecting limit on the download) (the temp unit also has `TimeoutStartSec`), so a stalled link cannot hold the install lock; curl exit 60 (the 1970 clock / no SIM) is reported as a clock/SIM problem. Only an incoherent (already unusable) install reaches the fresh branch, so its binaries and all residue are freed before the download (space is tight on the shared UBIFS volume); free space is logged at each step and the install stops early below 55 MB free. Three consequences fall out of that and all three are visible in the UI:

- **It needs working upstream connectivity**, on the very cellular link the user's session is riding. The install hero says so in one sentence rather than discovering it in a failure.
- **It is slow and must not block a request.** The helper runs detached, writes progress to `/tmp/qmanager_tailscale_install.json`, and appends to `/tmp/qmanager_tailscale_install.log`. The CGI's `install_status` action polls both, which is what feeds the live transcript panel.
- **It writes to the rootfs.** The unit lands in `/lib/systemd/system/`, so the helper does `mount -o remount,rw /` first and **never restores `ro`** — the platform contract in `docs/BACKEND.md` §2.1.

`uninstall` reverses all of it and the UI then offers a reboot, because firewall rules and interface state outlive the packages. It retries the removal, then checks that the directory, unit, wants-symlink and both CLI symlinks are gone; if not, it writes `{"status":"error","op":"uninstall","error":"uninstall_incomplete"}` and exits 1. The helper runs in the background (the firewall reload must not cut the response), so the CGI returns a `run` id the same way `update` does; the helper holds the install lock and writes `running` then `complete` or the error, stamped with that id, to the shared status file, which it keeps afterwards. The hook follows the run for up to 60 s and toasts the translated reason. The install poller ignores an `op:"uninstall"` status, which the file holds until the next install's first write. The UI keeps showing "installed" only while both the unit and the directory remain, so a retry is possible then.

**Install vs update is decided by coherence, not by the binary alone.** A coherent install is the unit plus executable `tailscale` and `tailscaled` (`ts_coherent`, in the wrapper and the inner script). Only a coherent install takes the `tailscale update` branch. Anything else (e.g. binary left after the unit was removed) is cleaned (old binaries, `systemd/`, `/usrdata/tailscale_*_arm*`; `tailscaled.state` is kept) and installed fresh. `install_rm520n.sh` also rewrites a missing unit when the binary exists, so OTA heals that state too.

---

## The GET is tiered, and the tiers are the contract

`tailscale.sh` answers at one of four depths. **A shallow tier is not a failure** — it is the honest answer, and every field below the tier it stopped at is simply absent:

| Tier | Condition | Payload |
| --- | --- | --- |
| 1 | `is_installed()` false | `installed: false` + `install_hint` |
| 2 | installed, daemon down | `+ daemon_running: false`, `enabled_on_boot`, `ssh_enabled`, `version`, `latest_version`, `update_available` |
| 3 | daemon up, `status --json` unparseable | tier 2 fields `+ backend_state: "Unknown"`, `error_detail` |
| 4 | daemon up, status parsed | `+ backend_state`, `auth_url`, `self`, `tailnet`, `peers[]`, `health[]` |

**Every field after `installed` is optional**, which is why `deriveView()` in `tailscale.tsx` tests them explicitly (`status.daemon_running ?? false`) instead of defaulting a tone in. A `??` that supplies a cheerful default here invents a verdict the device never gave.

While an update holds the install lock the GET answers `{installed: true, busy: "update"}` and nothing else (the daemon restarts under it). The hook layers that over the last good payload; `deriveView()` returns `unknown` only when there is no payload yet.

### Two detection tricks worth knowing

- **`is_installed()` does not stat the binaries.** `tailscaled` resets `/usrdata/tailscale/` to mode 700 while it runs, so a www-data CGI cannot traverse it. The test is instead `[ -f /lib/systemd/system/tailscaled.service ] && [ -d /usrdata/tailscale ]` — a world-readable unit plus a directory whose *existence* is checkable without entry. The unit's `ExecStartPost=/bin/chmod 755` puts the mode back, but only once the daemon is up.
- **Boot enablement is the symlink, not `is-enabled`.** On this platform `systemctl is-enabled` always reads `disabled`, because wants-symlinks live under `/lib`, not `/etc`. `get_boot_enabled()` tests for the symlink directly. Never gate logic on `is-enabled` here.

---

## Tailscale SSH is a QManager intent flag, not a Tailscale setting

`/etc/qmanager/tailscale_ssh` holds `1` or nothing, and it is **QManager's own record of what the user asked for** — the source of truth for whether `tailscale up` gets `--ssh`. It exists because the flag is only meaningful at connect time, but the user may set it while the daemon is down.

`set_ssh` therefore does two things: it always persists the flag, and it *additionally* runs `tailscale set --ssh=<v>` when the daemon is reachable. When it is not, the CGI answers `{success: true, pending: true}` and the UI says **Pending — applies on next connect** rather than showing a switch that lies.

> ⚠️ `/etc/qmanager` is **www-data-owned and non-sticky**, so nothing in it is root-pinned and a plain `>` there is redirectable via a planted symlink. This file is low-stakes (a boolean the user controls anyway), but do not add a secret or a privileged flag beside it — see [`platform-profile.md`](./platform-profile.md) and [`alerts.md`](./alerts.md) for where those go instead.

---

## Updating

`check_update` (CGI) fetches `https://pkgs.tailscale.com/stable/?mode=json` as `www-data` with `curl -m 10`, caches the version for 6 hours and answers `latest_version` / `update_available`. Tiers 2-4 of the GET read that cache only and never wait on the network. The comparison is `ts_version_gt` (jq arrays; the device jq has no regex).

`update` runs `qmanager_tailscale_mgr update`, which reuses the install path's `tailscale update` branch, writes `op:"update"` to the status file and restarts `tailscaled` only if it was active. The CGI hands back a `run` id that the helper stamps into every status it writes, so the UI ignores an older install's leftover file and fails after 15 s if the helper never writes one. It tolerates 20 s of failed polls while the daemon restarts. `uninstall` is refused (`install_in_progress`) while an install or update is live. The `update` verb needs no sudoers line: the helper is whitelisted without arguments.

## Sudoers surface

`www-data` is granted exactly what the CGI needs and nothing wider:

```
/usr/bin/qmanager_tailscale_mgr
/usrdata/tailscale/tailscale version
/usrdata/tailscale/tailscale status --json
/usrdata/tailscale/tailscale up --reset --accept-dns\=false
/usrdata/tailscale/tailscale up --reset --accept-dns\=false --ssh
/usrdata/tailscale/tailscale down
/usrdata/tailscale/tailscale logout
/usrdata/tailscale/tailscale set --ssh\=true
/usrdata/tailscale/tailscale set --ssh\=false
/bin/ln -sf /lib/systemd/system/tailscaled.service \
            /lib/systemd/system/multi-user.target.wants/tailscaled.service
/bin/rm -f /lib/systemd/system/multi-user.target.wants/tailscaled.service
/bin/systemctl {start,stop,restart,is-active} tailscaled
```

The `tailscale` CLI is granted **one exact argument list per call** that `vpn/tailscale.sh` makes (`get_ts_version`, and `ts_cmd` with `status --json`, `up`, `down`, `logout`, `set --ssh=`). The old grant was the bare binary, which allowed any verb and any flag as root. The `=` in each flag is backslash-escaped because sudoers treats a bare `=` in a command argument as syntax. The old `tailscaled --version` line is gone; nothing called it.

> ⚠️ WARNING: **A new `tailscale` verb or flag in the CGI needs its own sudoers line.** Without one, `sudo` refuses the call and the CGI sees it as an ordinary CLI failure, with nothing pointing at sudoers. Add the exact line to `scripts/etc/sudoers.d/qmanager` alongside the CGI change. One consequence is intended: `--accept-routes` is now refused by sudoers as well as left out by the code.

`systemctl` stays exact too: the four `tailscaled` lines name the unit. QManager's own units go through the `qmanager_svc` helper instead — see [qmanager-independence.md](qmanager-independence.md#privilege-boundary-sudoers-grants-for-www-data).

---

## Frontend anatomy

Re-authored to the design canon 2026-09-05. `components/monitoring/tailscale/shapes.ts` is the family's **only** geometry module; no component on the surface exports a shape constant, and the family restates its grammar from `/monitoring/latency-monitoring` rather than importing across the family boundary.

### `TailscaleView` — the six things the surface may claim

`deriveView()` collapses the payload into one view that every child reads. **No component may re-derive the state from a payload's shape.**

| View | Reached when | Chip | Glyph |
| --- | --- | --- | --- |
| `notInstalled` | `installed` false | *(no chip — the header carries none)* | — |
| `serviceStopped` | daemon down | `muted` | `MinusCircleIcon` |
| `needsLogin` | `NeedsLogin` / `NeedsMachineAuth` | `warning` | `LogInIcon` |
| `running` | `Running` | `success` | `CheckCircle2Icon` |
| `disconnected` | any other backend state | `muted` | `PlugZapIcon` |
| `unknown` | no status at all | `muted` | `CircleHelpIcon` |

**Three views land on `muted`,** which is exactly why each carries its own glyph — the Status Chip Pattern's requirement that no two states in one slot share one. `STATUS_VARIANT` is `satisfies Record<TailscaleView, BadgeVariant>`, so a view with no matching role fails the build.

### Three page shapes

Six views, three layouts:

- **`notInstalled`** — the install hero alone. No band, no peers card, no danger row. There is nothing to report about a tailnet the device is not on.
- **`unknown`** — a `destructive` condition block carrying the failure, with a Retry. The peers card is a *separate* read and mounts with its own condition rather than inheriting this one.
- **everything else** — header + four-tile band + the Connection / This device pair + the full-width peers table + the danger row.

The Boot and SSH settings are On/Off `SegmentedField` pills. The version is a row on This device in every installed view, with the update offer (`update-control.tsx`) beside it while one exists. `last-known.ts` remembers per tab whether Tailscale was installed, so a cold load on a modem without it paints the install skeleton instead of the installed layout.

A stale read (a failed poll on top of good data) is a **non-blocking `NOTICE` above the content**, never a replacement for it.

### Geometry that is measured, not asserted

Three numbers on this surface deliberately diverge from the Latency sibling they were restated from, and each carries its arithmetic in `shapes.ts`:

- **`TABLE.ROW_HEIGHT` is 52px, not 44.** The device cell is two lines — a 20px name over a 16px DNS name — inside 16px of cell padding. It shipped pinned at 44px, where the pin was **inert** and the skeleton mirrored nothing. Both line boxes are now explicit so the pin is arithmetic rather than the sum of two default leadings.
- **The band's tile floor is 248px, not 190.** A tile's text column is its width minus 106px of disc, gap and padding, so 190px left 84px for a 15-character address.
- **`TILE_VALUE` is 18px, not 22.** This band carries *word* verdicts where the sibling carries two-digit numerals; Italian's "Richiede accesso" measures 167px at 22px.

The peers skeleton takes the table's own **zero** row gap plus each row's hairline, because a gapped placeholder stack is taller than the table it stands in for and the swap then shifts.

### Motion

One page cascade (`staggerContainer` / `staggerItem`, 120ms, 10px), row cascades inside the identity card and the peer table (`staggerRows` / `rowCascadeDelay`, 80ms, 5px), a `SwapLabel` chip morph on `quick`, and switch-tile fills crossing on `standard` over two properties only. **Exactly one ambient loop exists on the surface** — the live dot during the auth wait. Nothing loops once connected; a 10s poll is not "streaming".

---

## Gotchas

- **The `--accept-routes` health advisory is filtered out of the UI.** `tailscaled` emits it as a health warning on this device as a matter of course, and it is not a fault — surfacing it would train the user to ignore the health list. The filter is one line in `connection-card.tsx` and it is deliberate.
- **"Last seen" needs a 1970 guard.** The device has no battery RTC and boots at Jan 1970, so a delta taken before the clock steps renders every offline peer as decades stale. `formatLastSeen` returns the unknown sentinel when `Date.now()` is before 2020 or the delta exceeds a year. Any new relative-time rendering on this platform needs the same guard.
- **Uninstall unmounts the card that confirms it.** A successful uninstall flips the view to `notInstalled`, which would take the danger row — and its own reboot dialog — down with it. The dialog therefore lives in the **page shell**, not in `danger-card.tsx`.
- **The reboot handoff is duplicated here.** The connection flow fires `qm_rebooting` + clears `qm_logged_in` + navigates to `/reboot/` inline, rather than going through the shared three-line contract. Dropping any one of those lines silently breaks `cgi_reboot_response`'s ack wait — see [`ip-passthrough.md`](./ip-passthrough.md). Worth extracting; not yet extracted.
- **A fresh install is the latest stable.** The checksum comes from the same host as the tarball, so it guards against corruption and truncation, not a compromised host.
- **`peers[]` is `.Peer` keyed by node ID**, flattened to an array by the CGI's jq. Ordering is therefore whatever jq's `to_entries` gives, not "most recently seen" — the table does not sort, and a large tailnet has no search. Both are known gaps.

---

## Related docs

- [`qmanager-independence.md`](./qmanager-independence.md) — the install/runtime contract this feature plugs into, and what lives inside vs outside `/etc/qmanager`
- [`ip-passthrough.md`](./ip-passthrough.md) — the reboot handoff contract, and the surface that most depends on Tailscale being available as a way back in
- [`platform-profile.md`](./platform-profile.md) — why `/etc/qmanager` cannot hold a root-pinned file
- [`connection-watchdog.md`](./connection-watchdog.md) — the `/monitoring` sibling this family's shape grammar was restated alongside
- `docs/BACKEND.md` §2.1 — the rootfs remount contract the installer follows
