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
| Root helper | `/usr/bin/qmanager_tailscale_mgr` (`install` · `uninstall` · `ensure_units`) |
| CGI endpoint | `GET`/`POST` `/cgi-bin/quecmanager/vpn/tailscale.sh` |
| SSH intent flag | `/etc/qmanager/tailscale_ssh` — `1` or absent. QManager-owned, **not** Tailscale's |
| Install progress | `/tmp/qmanager_tailscale_install.json` · `.pid` · `.log` |
| Auth URL spill | `/tmp/qmanager_tailscale_auth_url` |
| `tailscale up` tracking | `/tmp/qmanager_tailscale_up_output` · `_up_pid` |
| Frontend page | `/monitoring/tailscale` (`components/monitoring/tailscale/`) |
| i18n | `common.json` → `tailscale.*` (137 keys, all five packs) |
| Pinned version | `TAILSCALE_VERSION="1.92.5"`, `TAILSCALE_ARCH="arm"` in the helper |

---

## The install is a download, over the link being managed

`qmanager_tailscale_mgr install` curls `https://pkgs.tailscale.com/stable/tailscale_<ver>_arm.tgz` and unpacks it into `/usrdata/tailscale/`. Three consequences fall out of that and all three are visible in the UI:

- **It needs working upstream connectivity**, on the very cellular link the user's session is riding. The install hero says so in one sentence rather than discovering it in a failure.
- **It is slow and must not block a request.** The helper runs detached, writes progress to `/tmp/qmanager_tailscale_install.json`, and appends to `/tmp/qmanager_tailscale_install.log`. The CGI's `install_status` action polls both, which is what feeds the live transcript panel.
- **It writes to the rootfs.** The unit lands in `/lib/systemd/system/`, so the helper does `mount -o remount,rw /` first and **never restores `ro`** — the platform contract in `docs/BACKEND.md` §2.1.

`uninstall` reverses all of it and the UI then offers a reboot, because firewall rules and interface state outlive the packages.

---

## The GET is tiered, and the tiers are the contract

`tailscale.sh` answers at one of four depths. **A shallow tier is not a failure** — it is the honest answer, and every field below the tier it stopped at is simply absent:

| Tier | Condition | Payload |
| --- | --- | --- |
| 1 | `is_installed()` false | `installed: false` + `install_hint` |
| 2 | installed, daemon down | `+ daemon_running: false`, `enabled_on_boot`, `ssh_enabled`, `version` |
| 3 | daemon up, `status --json` unparseable | tier 2 fields `+ backend_state: "Unknown"`, `error_detail` |
| 4 | daemon up, status parsed | `+ backend_state`, `auth_url`, `self`, `tailnet`, `peers[]`, `health[]` |

**Every field after `installed` is optional**, which is why `deriveView()` in `tailscale.tsx` tests them explicitly (`status.daemon_running ?? false`) instead of defaulting a tone in. A `??` that supplies a cheerful default here invents a verdict the device never gave.

### Two detection tricks worth knowing

- **`is_installed()` does not stat the binaries.** `tailscaled` resets `/usrdata/tailscale/` to mode 700 while it runs, so a www-data CGI cannot traverse it. The test is instead `[ -f /lib/systemd/system/tailscaled.service ] && [ -d /usrdata/tailscale ]` — a world-readable unit plus a directory whose *existence* is checkable without entry. The unit's `ExecStartPost=/bin/chmod 755` puts the mode back, but only once the daemon is up.
- **Boot enablement is the symlink, not `is-enabled`.** On this platform `systemctl is-enabled` always reads `disabled`, because wants-symlinks live under `/lib`, not `/etc`. `get_boot_enabled()` tests for the symlink directly. Never gate logic on `is-enabled` here.

---

## Tailscale SSH is a QManager intent flag, not a Tailscale setting

`/etc/qmanager/tailscale_ssh` holds `1` or nothing, and it is **QManager's own record of what the user asked for** — the source of truth for whether `tailscale up` gets `--ssh`. It exists because the flag is only meaningful at connect time, but the user may set it while the daemon is down.

`set_ssh` therefore does two things: it always persists the flag, and it *additionally* runs `tailscale set --ssh=<v>` when the daemon is reachable. When it is not, the CGI answers `{success: true, pending: true}` and the UI says **Pending — applies on next connect** rather than showing a switch that lies.

> ⚠️ `/etc/qmanager` is **www-data-owned and non-sticky**, so nothing in it is root-pinned and a plain `>` there is redirectable via a planted symlink. This file is low-stakes (a boolean the user controls anyway), but do not add a secret or a privileged flag beside it — see [`platform-profile.md`](./platform-profile.md) and [`alerts.md`](./alerts.md) for where those go instead.

---

## Sudoers surface

`www-data` is granted exactly what the CGI needs and nothing wider:

```
/usr/bin/qmanager_tailscale_mgr
/usrdata/tailscale/tailscale
/usrdata/tailscale/tailscaled --version
/bin/ln -sf /lib/systemd/system/tailscaled.service \
            /lib/systemd/system/multi-user.target.wants/tailscaled.service
/bin/systemctl {start,stop,restart,is-active} tailscaled
```

The `tailscale` CLI is granted **unrestricted** because the CGI drives it with many verbs; the ban on `--accept-routes` is a code-level discipline, not a sudoers one. A bare `*` on `systemctl` was deliberately avoided — the whitelist names `tailscaled` explicitly beside the `qmanager-*` glob.

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
- **The version is pinned in the helper, in two places.** `TAILSCALE_VERSION` appears at the top of `qmanager_tailscale_mgr` and again inside the heredoc it writes. Bump both.
- **`peers[]` is `.Peer` keyed by node ID**, flattened to an array by the CGI's jq. Ordering is therefore whatever jq's `to_entries` gives, not "most recently seen" — the table does not sort, and a large tailnet has no search. Both are known gaps.

---

## Related docs

- [`qmanager-independence.md`](./qmanager-independence.md) — the install/runtime contract this feature plugs into, and what lives inside vs outside `/etc/qmanager`
- [`ip-passthrough.md`](./ip-passthrough.md) — the reboot handoff contract, and the surface that most depends on Tailscale being available as a way back in
- [`platform-profile.md`](./platform-profile.md) — why `/etc/qmanager` cannot hold a root-pinned file
- [`connection-watchdog.md`](./connection-watchdog.md) — the `/monitoring` sibling this family's shape grammar was restated alongside
- `docs/BACKEND.md` §2.1 — the rootfs remount contract the installer follows
