# QMI lane (broker sidecars and the poller overlay)

> **Applies to:** RM520N-GL (SDX65) · built 2026-10-29 (T7.1, plan `.orchestra/runs/2026-10-26-atd-port-T7.1.md`), broker `qmanager_atd` 0.7.0 · verified on serial 61368cd2
> **RG501Q-EU (SDX55):** verified 2026-10-29 on serial b7e3d6f1, broker 0.7.1 (T8.1). Same lane: all five services up, snapshot matched AT (PCI, EARFCN, band, TAC, cell ID, RSRP), `lte.source: "qmi"`, `device.qmi_state: "up"`, `network.wds` with the same keys (IPv4 address, gateway, /28 mask, two DNS, MTU 1500). With the broker not running, every field reads as "no QMI" (`lte.source: "at"`, `device.qmi_state: ""`, QMI fields `null`), as on any model without the broker.

The `qmanager_atd` broker keeps QMI clients open to the modem (QRTR node 3) and writes a snapshot of NAS, WDS and related state every 2 s. The poller uses that snapshot for two things: it fills `lte.rsrp` / `lte.rsrq` / `lte.rssi` in `status.json` on cycles where it did not run `AT+QENG="servingcell"` (the idle and deep tiers in [`adaptive-polling.md`](adaptive-polling.md)), and it publishes the bound data call's runtime settings as `network.wds`. The point is fresher signal data while the AT channel rests, at no extra AT traffic. Raw QMI request results and the probe tool are in [`qmi-probe.md`](qmi-probe.md).

## Quick reference

| What | Where |
| --- | --- |
| Snapshot writer | `native/qmanager_atd/src/daemon/qmi_snapshot.rs` (sampler, every 2 s) |
| WDS 0x002D codec | `native/qmanager_atd/src/qmi/codec/wds.rs` |
| Broker-only allow list | `native/qmanager_atd/src/qmi/allow.rs` `BROKER_READ` |
| Env sidecar (poller reads) | `/var/run/qmanager/qmi.env` |
| JSON sidecar (poller reads) | `/var/run/qmanager/qmi.json` |
| JSON sidecar (CGIs, other readers) | `/tmp/qmanager_qmi.json` |
| Overlay gate | `scripts/usr/lib/qmanager/qmi_merge.sh` `qmi_gate`, `QMI_JQ_DEFS` |
| Poller hook | `scripts/usr/bin/qmanager_poller` `write_cache`, `_QENG_OK` |
| Types | `types/modem-status.ts` `WdsSettings`, `LteStatus.source`, `DeviceStatus.qmi_*` / `at_read_mono` |

Check the lane on a device (read-only):

```bash
cat /var/run/qmanager/qmi.env | head -13
jq '.wds' /var/run/qmanager/qmi.json
jq '{src: .lte.source, rsrp: .lte.rsrp, mono, at: .device.at_read_mono, q: .device.qmi_read_mono, st: .device.qmi_state, wds: .network.wds}' /tmp/qmanager_status.json
```

## Sidecar files

The broker writes all three on every sample, in this order: `/tmp/qmanager_qmi.json`, then (after re-verifying `/var/run/qmanager` is its own 0700 directory) `/var/run/qmanager/qmi.json`, then `/var/run/qmanager/qmi.env`. The env file is therefore never older than the root JSON copy. A failed root JSON write does not stop the env write.

| File | Owner / mode | Content | Read by |
| --- | --- | --- | --- |
| `/var/run/qmanager/qmi.env` | root, dir 0700 | 42 `name='value'` lines in a fixed order, unchanged by T7.1 | poller `qmi_gate` |
| `/var/run/qmanager/qmi.json` | root, dir 0700 | Same document as the `/tmp` copy | poller `write_cache` (for `network.wds` only) |
| `/tmp/qmanager_qmi.json` | root, in sticky `/tmp` | Full snapshot JSON | CGIs and anything else; never the poller |

`wds.settings` is in the JSON only. The env file has no settings keys.

### `wds.settings` (broker 0.7.0)

WDS 0x002D Get Runtime Settings, read by the broker on its own bound WDS clients. Shape, with illustrative values for an IPv4-only call (the addresses are the codec test fixture):

```json
"wds": {
  "ok": true, "rx_bytes": 730344017, "tx_bytes": 41000123, "mux": 1,
  "settings": {
    "ip4": "10.110.187.26", "gw4": "10.110.187.25", "mask4": "255.255.255.252",
    "dns4": ["10.151.151.44", "10.151.151.48"], "mtu": 1500,
    "ip6": null, "ip6_prefix": null, "gw6": null, "dns6": [],
    "read_mono": 4821
  }
}
```

- `read_mono` is CLOCK_BOOTTIME seconds, the same clock as `/proc/uptime` and the poller's `.mono`.
- An absent TLV or an all-zero address is `null`. `dns4` / `dns6` list only present addresses, primary first.
- Both families are merged into one object; when both report an MTU, the IPv4 one wins.
- `settings` is `null` out of call (QMI error 0x000F on every family), while `qmi_state` is not `up`, and after a mux change until the next read.

**When it is read.** Right after a change of the settings key (SSR count, mux, either family's bind state, or the packet-stats `ok` flag), and otherwise every 10 s. Between reads the cached value is republished. The IPv4 client is read only while the packet-stats read uses it, so an IPv6-only call leaves the IPv4 client unbound.

**Who may send it.** 0x002D is in `BROKER_READ`: the broker sends it on its internal clients after binding them (`Registry::wds_settings`). A socket client that asks the broker for it gets `QmiError::Refused`.

| TLV | Field | Proven on RM520N-GL |
| --- | --- | --- |
| 0x1E / 0x20 / 0x21 | `ip4` / `gw4` / `mask4` (LE u32) | Yes, 2026-10-29: match `AT+CGCONTRDP`, `ip addr`, `ip route` |
| 0x15 / 0x16 | `dns4` primary / secondary | Yes, same capture |
| 0x29 | `mtu` (u32) | Yes, matches sysfs with no custom MTU file |
| 0x25 / 0x26 | `ip6` + `ip6_prefix` / `gw6` (16 bytes + prefix) | **No.** The test APN has no IPv6 PDN; the IPv6 client answers 0x000F |
| 0x27 / 0x28 | `dns6` | **No**, same reason |

## The overlay gate

`write_cache` calls `qmi_gate "$QENG_OK"` before its one `jq`. The gate reads the first 13 lines of `qmi.env` with bash builtins (no forks) and sets `QMI_USE`, the three values and the device facts. `lte.rsrp` / `lte.rsrq` / `lte.rssi` come from QMI and `lte.source` is `"qmi"` only when **all** of these hold:

| # | Condition | Source of the fact |
| --- | --- | --- |
| 1 | No good serving-cell read this cycle: `_QENG_OK=0` | Reset at the top of `poll_cycle`; set to 1 when the `AT+QENG="servingcell"` reply contains `+QENG:` |
| 2 | `system_state` is not `scan_in_progress` | Poller |
| 3 | `qmi_state='up'` | env |
| 4 | `qmi_registered='1'` | env |
| 5 | `-5 <= _MONO_TOP - qmi_mono <= 5` | `_MONO_TOP` is uptime at the cycle top |
| 6 | `qmi_lte_pci` and `qmi_lte_earfcn` equal AT's `lte_pci` / `lte_earfcn`; or AT has no LTE PCI/EARFCN **and** no NR PCI | Shell variables from the last AT read |
| 7 | QMI PCI, EARFCN, RSRP, RSRQ and RSSI are all integers | env |

Otherwise the AT values stand and `lte.source` is `"at"`. The boot `write_cache 1` forces the gate off: there is no AT-vs-QMI cycle yet.

`network.wds` is computed in `jq` from the root JSON copy (`--rawfile`, `/dev/null` when the file is missing or unreadable): the `wds.settings` object while the env's `qmi_state` is `up` and `.mono - read_mono <= 30`, else `null`. A malformed sidecar lands in a `try … catch null`.

## `status.json` fields

All additive; every one is optional in `types/modem-status.ts`.

| Field | Values | Without a sidecar |
| --- | --- | --- |
| `lte.source` | `"at"` or `"qmi"`: where this write's `rsrp` / `rsrq` / `rssi` came from | `"at"` |
| `device.qmi_read_mono` | env `qmi_mono` (uptime s of the snapshot) | `null` |
| `device.qmi_state` | `"up"`, `"down"`, `"unavailable"`; any other token reads as `""` | `""` |
| `device.qmi_ssr_count` | Modem subsystem restarts the lane has seen | `null` |
| `device.at_read_mono` | `_AT_LAST_MONO`: uptime s of the last cycle that ran the AT block; `0` until the first one | (same) |
| `network.wds` | `WdsSettings` object or `null` | `null` |

`device.qmi_state` is reported even before the broker's first good QMI read (empty `qmi_mono`), so broker start shows `"down"` or `"unavailable"`, not `""`.

`network.wan_ipv4`, `primary_dns` and `secondary_dns` stay the canonical values from `AT+CGCONTRDP`. `network.wds` is a fresher second view and nothing reads it yet.

## Invariants and gotchas

1. **The poller reads only the `/var/run/qmanager/` copies.** Any www-data process can create a file in `/tmp` while the broker is stopped, and the overlaid RSRP drives `qmanager_tower_failover`. Pointing `QMI_ENV_FILE` / `QMI_JSON_FILE` at `/tmp/qmanager_qmi.json` would let any www-data process steer a failover.
2. **Shell variables are never changed by the overlay.** The swap happens only inside the `jq` program, so `detect_events`, `check_alerts`, `determine_service_status` and `append_signal_history` stay AT-only by construction. Assigning QMI values to `lte_rsrp` and friends would silently change all four.
3. **The gate runs in shell, not in `jq`.** `jq` compile cost grows with program size: the original in-`jq` gate cost +11–13 ms per `write_cache`. Do not move gate logic back into `QMI_JQ_DEFS`.
4. **The env loop stops at `qmi_lte_rssi`.** It reads keys in the broker's fixed order (`NAMES` in `qmi_snapshot.rs`) and breaks on line 13. Moving any of `qmi_mono`, `qmi_state`, `qmi_ssr_count`, `qmi_registered`, `qmi_lte_pci`, `qmi_lte_earfcn`, `qmi_lte_rsrp`, `qmi_lte_rsrq` after `qmi_lte_rssi` makes that key read as missing: the gate fails and `lte.source` stays `"at"` with no error anywhere.
5. **The age window is signed.** `_MONO_TOP` is taken at the top of the cycle, and the broker can rewrite the sidecar while the cycle's AT and ping work runs, so a sidecar 1–3 s newer than the cycle top is normal. A `0..5` window rejected those.
6. **A failed serving-cell read can overlay.** A timeout or a reply with no `+QENG:` leaves `_QENG_OK=0` while `_AT_LAST_MONO` was already set to this cycle. That write can show `lte.source: "qmi"` with `.mono == device.at_read_mono` (and `modem_reachable: false` on a timeout). This is intended: QMI shows the radio is up while AT is not answering. Identity still comes from the last good AT read, so gate 6 holds.
7. **`network.wds.mtu` is the network-provided PDN MTU,** not `rmnet_data0`'s. `qmanager_mtu_apply` can set the interface MTU from `/etc/firewall.user.mtu`, and then the two differ.
8. **The lib is optional.** If `/usr/lib/qmanager/qmi_merge.sh` is missing, the poller logs a warning and installs a stub `qmi_gate` that always reports AT and `def qmi_wds: null;`.

## Who sees QMI values

Accepted by the user 2026-10-29. In the active tier the poller reads AT every cycle, so QMI shows up only after a failed serving-cell read. In idle and deep, most writes between AT reads carry QMI values.

| Reader | Effect |
| --- | --- |
| `qmanager_tower_failover` (`.lte.rsrp` every 20 s) | Its three bad readings are now independent samples in deep, not one 60 s-old AT value counted up to three times |
| Discord bot (`discord-bot/cache.go`, `lte.rsrp`) | Fresher signal in idle and deep |
| `public/overview.sh` | Its first request after an idle period can return QMI values; it also writes the heartbeat, so later requests are active-tier AT |
| `service_status` | AT-only; near a threshold it can briefly disagree with an overlaid RSRP |

QMI reads about 1 dB lower than AT on RSRP and RSRQ on this device, and the same on RSSI (30 pairs ~3 s apart, RM520N-GL 61368cd2, 2026-10-29; identity equal in 30/30).

## Cost (RM520N-GL 61368cd2, 2026-10-29)

| Item | Before | After |
| --- | --- | --- |
| `write_cache` body (60 writes × 3) | 33 ms | 40–41 ms: extra args/fields +3, shell gate +2.5, `network.wds` parse +1.5 |
| Poller, deep tier | — | about +0.36 points of the core |
| Broker CPU | 0.68–0.73 % (0.6.1) | 0.63–0.65 % (0.7.0) |
| Broker RSS | — | +16 kB |

## Lifecycle

No installer, unit or sudoers change. The installer copies `usr/lib/qmanager/*.sh` flat and prunes stale files, so `qmi_merge.sh` arrives and leaves with the tarball. `uninstall_rm520n.sh` removes `/var/run/qmanager` (which holds both root sidecars) and `/tmp/qmanager_qmi.json`. The broker binary ships as `dependencies/qmanager_atd`; see [`at-command-transport.md`](at-command-transport.md) for the unit and [`qmanager-independence.md`](qmanager-independence.md) for packaging.
