# Ethernet Status & Link Speed

> **Applies to:** RM520N-GL (SDX65) · verified 2026-08
> **RG501Q-EU (SDX55):** unverified — see [`platform-matrix.md`](./platform-matrix.md)

> The `/local-network/ethernet` page: link state, negotiated speed/duplex, and an optional forced speed limit for the on-board 2.5 GbE port.

## Hardware

The RM520N-GL carries a **Realtek RTL8125B 2.5GbE** controller exposed as `eth0`, driven by the out-of-tree `r8125` module. This is a real PHY with real autonegotiation — link state and speed can change under the app at any time, so both are read live rather than cached.

## Where each value comes from

| Value | Source | Notes |
| ----- | ------ | ----- |
| Link up/down | **sysfs** (`/sys/class/net/eth0/…`) | Cheap, always readable, no external binary |
| Speed / duplex | **`ethtool`** | Only meaningful while the link is up; an unplugged port reports nothing usable |

The split is deliberate: sysfs answers "is there a cable" without paying for an `ethtool` fork, and `ethtool` is only consulted once sysfs says the link is up.

## Files

| Layer | Path |
| ----- | ---- |
| Page | `app/local-network/ethernet/` |
| Components | `components/local-network/ethernet-card.tsx`, `components/local-network/ethernet-status.tsx` |
| CGI | `scripts/www/cgi-bin/quecmanager/network/ethernet.sh` |
| Shared lib | `scripts/usr/lib/qmanager/ethtool_helper.sh` |
| Root helper | `scripts/usr/bin/qmanager_ethernet_apply` |
| Unit | `scripts/etc/systemd/system/qmanager-ethernet.service` |

## Page anatomy (frontend)

`ethernet-status.tsx` is the data shell: it owns the fetch, the 10 s poll, and the speed-limit apply with its confirm-poll, and renders the page header with a Refresh pill. `ethernet-card.tsx` is presentational — four summary tiles (link state carries the tone: `success-container` when up, `destructive-container` when down, neutral when unknown) and the speed-limit card, whose Select applies on change with an in-place **Applying… → Saved** flash (the trigger doubles as the confirmation; there is no separate Save button). The skeleton mirrors the tiles through the shared `ETH_TILE_SHAPE` constant, and the whole route stays on lucide icons per the Icon-Boundary Rule. All copy lives in `common.json` under `ethernet.*`, keyed across all five locales.

### Tile tones

| Tile | Tone | Why |
| ---- | ---- | --- |
| Link state | `success-container` / `destructive-container` / neutral | Functional — up, down, unknown |
| **Link speed** | `downlink-container` + `bg-downlink` disc | **Capacity**, which is Downlink Rose's second meaning |
| Negotiation mode | `primary-container` + `bg-primary` disc | A plain configuration readout, which is the one thing the brand ramp is always allowed to be |

**Link speed was Uplink Cyan until 2026-08-16, and cyan is now wrong here.** Since the direction token family landed, `--uplink-*` means the **upload direction** specifically. A negotiated Ethernet link rate is *bidirectional* — 2500 Mb/s is what the PHY can carry either way — so cyan was claiming a direction the figure does not have. Downlink Rose carries "download direction **and** capacity", and this is the capacity sense, the same reason the Radio Information bandwidth tile wears it. See [color-system.md](color-system.md) and [radio-information.md](radio-information.md).

## Applying a speed limit

Forcing a link speed requires privileges `www-data` does not have, so the CGI never calls `ethtool` to *write*. It goes through the **`qmanager_ethernet_apply` root helper** (bare-path sudoers line, all validation inside the helper) — the same pattern used by `qmanager_timezone_apply`, `qmanager_scenario_schedule_arm`, and the other privileged appliers.

## The `ConditionPathExists` placement (non-obvious)

`qmanager-ethernet.service` puts its `ConditionPathExists` in the **`[Unit]`** section, not `[Service]`.

**Why it matters:** a systemd condition that fails in `[Unit]` causes the unit to be *skipped* — it reports `inactive`. The same check expressed as a failing `ExecStartPre` would report `failed`. On a device with no Ethernet cable or no `eth0`, the second reading is alarming and wrong: nothing is broken, there is simply nothing to configure.

> ⚠️ Do not "fix" an `inactive` `qmanager-ethernet.service` on an idle device. That is the designed outcome.
