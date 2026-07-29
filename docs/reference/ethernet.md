# Ethernet Status & Link Speed

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

## Applying a speed limit

Forcing a link speed requires privileges `www-data` does not have, so the CGI never calls `ethtool` to *write*. It goes through the **`qmanager_ethernet_apply` root helper** (bare-path sudoers line, all validation inside the helper) — the same pattern used by `qmanager_timezone_apply`, `qmanager_scenario_schedule_arm`, and the other privileged appliers.

## The `ConditionPathExists` placement (non-obvious)

`qmanager-ethernet.service` puts its `ConditionPathExists` in the **`[Unit]`** section, not `[Service]`.

**Why it matters:** a systemd condition that fails in `[Unit]` causes the unit to be *skipped* — it reports `inactive`. The same check expressed as a failing `ExecStartPre` would report `failed`. On a device with no Ethernet cable or no `eth0`, the second reading is alarming and wrong: nothing is broken, there is simply nothing to configure.

> ⚠️ Do not "fix" an `inactive` `qmanager-ethernet.service` on an idle device. That is the designed outcome.
