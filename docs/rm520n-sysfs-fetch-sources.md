# RM520N-GL: sysfs as a Telemetry Fetch Source

**Status:** Investigation, 2026-05-08. Read-only exploration of `/sys`, `/proc`, and `/sys/kernel/debug` on a live RM520N-GL running QManager v0.1.7. Goal: identify which AT-command-driven fetches in the QManager poller can be replaced by direct kernel-exposed reads.

**Platform under test:** SDXLEMUR (SDX65), kernel 5.4.210, distro `qti-distro-nogplv3-perf` (`LE.UM.6.3.6.r1-02600-SDX65.0`).

## TL;DR

| Today (AT command) | sysfs replacement | Status |
|---|---|---|
| `AT+QTEMP` (~5 readings) | `/sys/class/thermal/thermal_zone*/{type,temp}` (43 zones) | **Direct replacement, richer** |
| `AT+QGDCNT` | `/proc/net/dev` and `/sys/class/net/*/statistics/` | **Direct replacement, no AT-lock contention** |
| Modem alive/crashed state | `/sys/devices/platform/4080000.qcom,mss/subsys0/{state,crash_count}` | **New capability**, AT can't expose this cleanly |
| System health (CPU/load/mem/uptime) | `/proc/{loadavg,uptime,meminfo}`, `/sys/devices/system/cpu/cpu0/cpufreq/` | Direct file reads, replaces shell utils |
| Ethernet link to host | `/sys/class/net/eth0/{speed,duplex,carrier}` | Cheap, exact RGMII negotiated rate |
| Signal metrics, cell info, operator, IMEI, SMS, band locking | (none) | **Stay on AT** — modem-firmware-internal, not exposed via sysfs |

## Tier 1 — Direct AT replacements

### Thermal: `AT+QTEMP` → `/sys/class/thermal/`

43 thermal zones, each with `type` (sensor name) and `temp` (millidegree C). A representative read:

```
thermal_zone0  modem-lte-sub6-pa1   35721
thermal_zone1  modem-lte-sub6       34000
thermal_zone11 modem-sdr0           33000
thermal_zone26 cpuss-0-step         38300
thermal_zone27 mdmss-0-step         39300
thermal_zone33 mdmq6-0-usr          38300
thermal_zone38 pmx65_tz             35397
thermal_zone40 modem-skin-usr       37801
thermal_zone41 modem-ambient-usr    37351
```

Notable sensors absent from `AT+QTEMP`:
- `modem-lte-sub6-pa1`, `pa2` — per-PA LTE sub-6 power amplifier temps
- `modem-sdr0`, `modem-sdr1` — software-defined-radio chip temps (RF front-end health)
- `mdmss-0-step` … `mdmss-3-step` — modem subsystem step-throttling sensors
- `mdmq6-0-usr` — modem Q6 DSP
- `aoss-0-usr` — always-on subsystem
- `pmx65_tz` — PMIC

Sensors that read `-273000` or `-40960` are inactive/disabled (placeholder values). Filter those out at read time.

**Implementation note:** `awk` over `/sys/class/thermal/thermal_zone*/{type,temp}` from one shell invocation is faster and lower-overhead than a single AT round-trip.

### Traffic counters: `AT+QGDCNT` → `/proc/net/dev`

`/proc/net/dev` provides per-interface RX/TX bytes, packets, errors, drops, multicast — at every poll, no AT lock contention.

Confirmed live readings:
```
rmnet_data0:  rx 852066 / 17914  tx 713738 / 18000   ← active LTE/NR bearer
rmnet_ipa0:  rx 1008094 / 20484  tx 857738 / 18000   ← parent IPA-accelerated iface
bridge0:      rx 858784 / 18356  tx 8481045 / 22626   ← LAN bridge
eth0:         rx 1380668          tx 8481799          ← RGMII to host
```

**Caveat:** counters wrap at u64. Compute byte/sec deltas in the poller, don't display raw counters.

### Modem subsystem state: new capability

`/sys/devices/platform/4080000.qcom,mss/subsys0/`

| File | Read | Purpose |
|---|---|---|
| `state` | `ONLINE` | Modem firmware running. Other values: `OFFLINE`, `CRASHED` (during SSR window). |
| `crash_count` | `0` | Monotonic count of modem subsystem crashes since boot. **AT can't reliably expose this.** |
| `firmware_name` | `modem` | Firmware image identifier loaded into Q6. |
| `restart_level` | `RELATED` | SSR cascade configuration. Static. |
| `system_debug` | `reset` | Debug behavior on crash. Static. |
| `quec_state` | `Terminated` | **Quectel-added attribute, semantics unclear.** Reads `Terminated` while `state=ONLINE` — do NOT trust this field as a health signal until we figure out what it represents. May be referring to a one-shot init process that genuinely terminated, not modem firmware state. |

**Status: implemented.** The poller's `update_system_health()` function (Tier 1, every ~2s) reads `subsys0/{state,crash_count}` and the `ramdump_modem/` directory and emits a `system_health` block in `/tmp/qmanager_status.json`. The "System Health" card in System Settings consumes this via `GET /cgi-bin/quecmanager/system/modem-subsys.sh`, which is a thin `jq` reader over the cache. See `docs/BACKEND.md` § `qmanager_poller` and `docs/API-REFERENCE.md` § `/system/modem-subsys.sh`.

Original recommendation (now satisfied):
- `state` for live up/down
- `crash_count` delta to detect silent recoveries (modem rebooted itself but cellular came back too fast for `AT+CEREG` polling to notice)
- `ramdump_modem/` directory presence as a "core dump available" indicator

### CPU / memory / uptime

| Source | Value sample | Use |
|---|---|---|
| `/proc/loadavg` | `1.20 1.19 1.18 4/405 29833` | Load average, runnable/total tasks, last PID |
| `/proc/uptime` | `3704.23 2635.36` | Uptime seconds, idle time |
| `/proc/meminfo` (head) | `MemTotal: 182516 kB`, `MemAvailable: 23152 kB` | RAM headroom — tight on this platform |
| `/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq` | `1804800` | Current CPU clock (kHz). Max same value (no DVFS headroom under load). |
| `/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor` | `ondemand` | DVFS policy |

These are already partially read by QManager via shell commands. Cleaner reads via direct sysfs paths reduce shell-fork cost in the poller.

### Ethernet link

```
/sys/class/net/eth0/speed     → 2500
/sys/class/net/eth0/duplex    → full
/sys/class/net/eth0/carrier   → 1
```

The Ethernet-status feature was removed from `dev-rm520`, but if reintroduced this is the canonical source. Don't shell out to `ethtool` — read these files.

### USB cable / OTG state

```
/sys/class/extcon/extcon0/state  → USB=0\nSDP=0
/sys/class/extcon/extcon1/state  → USB=1\nUSB-HOST=0
```

`extcon1` is the PMIC VBUS detector — `USB=1` means the modem is plugged into a host (RGMII bridge active). Useful as a "tethered to upstream device" indicator.

## Tier 2 — Supplementary signals

| Path | What it gives you |
|---|---|
| `/sys/class/wakeup/wakeupN/{event_count,active_count,total_time_ms}` | Power-management debug — wake event counters per source. Idle on healthy connections. |
| `/sys/kernel/debug/ipa/active_clients` | IPA hardware accelerator active client count (4 here). Cheap "is HW path engaged" indicator. |
| `/sys/kernel/debug/gsi/gsi_fw_version` | `hw=13 flavor=0 fw=70`. Static; useful in support bundles. |
| `/sys/devices/platform/4080000.qcom,mss/ramdump/ramdump_modem/` | Modem coredump path — directory presence indicates a captured crash dump waiting for retrieval. |
| `/sys/class/subsys/` enum | `subsys_modem`, `subsys_ipa_fws` — enumerable subsystem list. |

## Tier 3 — NOT in sysfs (must remain AT or QMI)

| Data | Why sysfs can't help |
|---|---|
| RSRP / RSRQ / SINR per antenna | Lives in modem firmware (Q6 DSP). Not exported to Linux side. |
| Cell ID, TAC, PCI, EARFCN, band, CA info | Same — internal to modem. |
| Operator / PLMN name | Same. |
| IMEI / IMSI / ICCID, SIM PIN status | Same. |
| Locked-band, network-mode preferences | NV items in modem firmware. AT or QMI only. |
| SMS | sms_tool (own bundled binary) on `/dev/smd11` at the time; since T5.1 `qsms` over QMI WMS. |

These are the same wall the original QMI investigation hit at the **information level** — sysfs cannot give us this data. **However, the QMI feasibility assessment itself is reversed once we look at the right places on this platform.** See the next section.

## QMI Re-investigation (2026-05-08)

The original QMI conclusion ("not worth it") appears to have been formed against a different deployment shape — likely a host-side libqmi-glib + cdc-wdm0 setup. On RM520N-GL, where QManager runs **on the modem itself**, the picture is qualitatively different:

### What's actually present on RM520N-GL

**Kernel:**
- `AF_QIPCRTR` socket family is built and active. Confirmed via `/proc/net/protocols`: `QIPCRTR  616  0  -1  NI  0  yes  kernel`. 147 qrtr-related symbols in `/proc/kallsyms`.
- `rmnet_core`, `rmnet_eth` modules loaded.

**Userspace daemons running at boot:**
| Process | Role |
|---|---|
| `qrtr-ns` | QRTR name service (the registry every QMI service registers with) |
| `[qrtr_ns]` / `[qrtr_rx]` | Kernel threads for the QRTR transport |
| `netmgrd` | Qualcomm Network Manager — uses QMI WDS to manage rmnet data sessions |
| `qmuxbridge` | Legacy QMUX-over-SMD bridge |
| `atfwd_daemon` | AT-command-over-QMI forwarding daemon |
| `port_bridge at_mdm0 at_usb0 0` | Bridges modem AT to USB AT |
| `qmi_shutdown_modem` | QMI helper for clean shutdown |

**Userspace libraries (already on the rootfs):**
```
/usr/lib/libqrtr.so.1
/usr/lib/libqmi_cci.so.1            ← Qualcomm Client-Common-Interface (the high-level API)
/usr/lib/libqmi_csi.so.1            ← Server side
/usr/lib/libqmi_client_qmux.so.1    ← Legacy QMUX/SMD path
/usr/lib/libqmi_client_helper.so.1
/usr/lib/libqmi_encdec.so.1         ← Message encoder/decoder
/usr/lib/libqmiservices.so.1        ← Service ID definitions
/usr/lib/libqmiidl.so.1             ← IDL runtime
/usr/lib/libqmi_sap.so.1
/usr/lib/libqmi_common_so.so.1
/usr/lib/libqmi.so.1
/usr/lib/libqmi_ip.so.1
```

**Tools already shipped in `/usr/bin/`:**
- `qrtr-ns`, `qrtr-lookup`, `qrtr-cfg`, `qrtr-filter` — QRTR transport utilities
- `qmi_simple_ril_test` — interactive RIL/QMI console (Quectel-shipped test tool)
- `qmi_ip_multiclient`, `qmi_test_service_*`, `qmi_test_mt_client_init_instance` — Qualcomm QMI test/diagnostic binaries
- `qmi_shutdown_modem` — sends QMI shutdown to modem

**Headers:**
- Only one Quectel-supplied header survived in `/usr/include`: `/usr/include/ql_lib_ipc/ql_ipc_qmi_net_v01.h`. The full Qualcomm QMI IDL set is not on the rootfs.

### Service inventory (from `qrtr-lookup`, run live)

Every QMI service QManager would want is **already advertised by the modem at boot** on QRTR Node 3:

| QMI svc ID | Service name | Node | Port | Maps to today's AT path |
|---|---|---|---|---|
| **1** | Wireless Data Service (WDS) | 3 | 68 | data session state, IPv4/IPv6, byte counters |
| **2** | Device Management Service (DMS) | 3 | 79 | `ATI`, IMEI, firmware, model, serial |
| **3** | Network Access Service (NAS) | 3 | 63 | `AT+QENG`, `AT+QCAINFO`, RSRP/RSRQ/SINR, cell ID, TAC, PLMN, registration |
| **5** | Wireless Messaging Service (WMS) | 3 | 77 | `sms_tool` send/recv at the time; since T5.1 `qsms` uses WMS directly |
| **8** | AT service | 3 | 71 | (AT-over-QMI proxy) |
| **9** | Voice service | 3 | 62 | voice (unused today) |
| **10** | Card Application Toolkit (CAT v2) | 3 | 64 | SIM toolkit |
| **11** | User Identity Module (UIM) | 3 | 66 | `AT+CIMI`, ICCID, IMSI, SIM PIN state |
| **12** | Phonebook Management | 3 | 60 | (unused today) |
| **16** | Location service (PDS v2) | 3 | 88 | GPS |
| **17** | Specific Absorption Rate (SAR) | 3 | 41 | RF SAR backoff control |
| **22** | Time service | 3 | 22 | network time |
| **24** | Thermal mitigation device | 3 | 12 | throttling state (also sysfs) |
| **34** | Coexistence service | 3 | 42 | LTE/WiFi/BT coex |
| **41** | RF radiated performance enhancement | 3 | 44 | antenna/RF tuning |
| **42** | Data system determination | 3 | 78 | RAT selection |
| **49** | IPA control | 2,3 | 16389,27 | IPA HW accelerator |
| **66** | Service registry notification | 3 | 1 | service liveness events |

There are also DIAG service ports for `MODEM/LPASS/WCNSS/SENSORS/CDSP/WDSP` subsystems — separate from the QMI services above; these are the Qualcomm DM (Diagnostic Monitor) channels, useful for low-level troubleshooting but out of scope for normal telemetry.

### Permission gate (the critical check)

Tested on the live device:

```sh
# Logged in as root, then:
$ id www-data
uid=33(www-data) gid=33(www-data) groups=33(www-data),20(dialout)

$ su -s /bin/sh -c '/usr/bin/qrtr-lookup' www-data
  Service Version Instance Node  Port
       49       1        1    2 16389 IPA control service
       ...
```

**`www-data` can open `AF_QIPCRTR` and query the name service without elevation.** No sudoers helper required. No group membership change needed. This was the major friction point in the AT path (which needed `dialout` for `/dev/smd11`); QMI doesn't have that gate.

### So why did the original investigation conclude "no"?

Best guess: it was reasoning about libqmi-glib's host-side flow (qmi-proxy, /dev/cdc-wdm0, USB descriptors) which is heavy and was overkill for our use case. On the modem-as-host platform we now have, QMI is the **native** IPC the modem firmware speaks, and we just need a small client to shape requests.

### Implementation paths, ranked

**Path A — Bundle a small static Rust client (recommended)**

Pattern matches `atcli_smd11`: ARMv7 static binary, ~1–2 MB, ships with the installer at `/usr/bin/qmicli_qrtr` (or similar). Opens `AF_QIPCRTR` directly, no Qualcomm libraries linked. Implements just the requests QManager needs (NAS get-signal, NAS get-serving-cell, DMS get-IMEI, DMS get-firmware, UIM get-iccid, WDS get-current-settings) and emits JSON. The QMI wire format is well-documented (libqmi-glib has it open under LGPL-2.1+).

- Pros: zero on-device dependencies, predictable size, fits the project's "small Rust binary" pattern, JSON output for easy CGI consumption.
- Cons: must implement request/response struct encoding ourselves. Mitigated by libqmi-glib's published TLV schema.

**Path B — Cross-compile and adapt OpenWRT's `uqmi`**

[uqmi](https://github.com/openwrt/uqmi) is a tiny C QMI client (~200 KB) with JSON output and no glib. Originally targets `/dev/cdc-wdm0`. Would need a small port to use `AF_QIPCRTR`. The codebase is small enough that this is a few-day port, not a rewrite.

- Pros: known-good QMI implementation; existing JSON output schema we could match.
- Cons: maintenance burden of carrying a fork.

**Path C — Link the on-device `libqmi_cci.so`**

Use Qualcomm's CCI API directly. Same library `netmgrd` uses — battle-tested on this exact platform.

- Pros: idiomatic, official.
- Cons: only one Quectel-supplied header is present. We'd be reverse-engineering API signatures from `objdump` and the LGPL libqmi-glib's interpretation of QMI structs. Fragile across firmware revisions.

**Path D — Drive `qmi_simple_ril_test` interactively**

Pre-built tool already on device. Pipe commands at it, parse text output.

- Pros: zero new code to ship.
- Cons: text-output parsing is fragile; the binary is interactive (holds state); Quectel could change/remove it; not designed for production use.

### Recommended next steps (no implementation yet — flag for /gsd-spec-phase)

1. **Write a small spike** under `/gsd-spike` to validate Path A: open `AF_QIPCRTR` from a Rust binary, send a NAS Get Signal Strength request to `node=3 port=63`, parse the response. ~1–2 days of dev time including envelope encoding.
2. If that works, scope a phase to **migrate the antenna-alignment poll path to QMI**. This is QManager's heaviest-cost AT consumer (RSRP/RSRQ/SINR per antenna) and the highest-value showcase: QMI exposes per-antenna directly without `AT+QENG` parsing.
3. Once one path is migrated, the rest (DMS for IMEI, UIM for ICCID, WDS for byte counters) become low-risk follow-ons — same client, different services.

### What we should NOT migrate to QMI even if it works

- **SMS** — `sms_tool` already handles multi-part reassembly and works reliably. WMS via QMI duplicates it without obvious benefit. (Superseded: T5.1 moved SMS to WMS and retired `sms_tool`.)
- **Band locking / network mode preferences** — `AT+QNWPREFCFG` is well-trodden in the codebase. QMI equivalents exist but the reward for swapping a working path is low.
- **Modem reboot / shutdown** — `qmi_shutdown_modem` exists but `AT+CFUN=1,1` is fine.

The QMI win is concentrated on **read-only telemetry from NAS, DMS, UIM**, not control-plane operations.

## Empty-on-read debugfs nodes

The following nodes exist but returned empty on a passive read:

```
/sys/kernel/debug/ipa/hw_stats
/sys/kernel/debug/ipa/holb_events
/sys/kernel/debug/ipa/pm_ex_stats
/sys/kernel/debug/ipa/dbg_cnt
/sys/kernel/debug/gsi/stats
/sys/kernel/debug/usb_diag/status
/sys/kernel/debug/diag/   (empty directory)
```

Some Qualcomm IPA debugfs nodes require a write to a sibling `enable_*` flag before they emit data. We did NOT write anything during this investigation. If we decide to surface these, it will be a separate scoped change — not a passive read.

## Caveats and gotchas

1. **`/sys/class/leds/` is empty** on this device. No signal-LED driver — so the "drive a status LED from sysfs" pattern that works on OpenWRT routers does not work here.
2. **`quec_state` is unreliable** (see above). Use `state` for canonical modem-firmware health.
3. **AT-lock-free does not equal AT-snapshot-consistent.** Reads from `/sys` and AT come from independent state machines; they will not be perfectly aligned in time. Acceptable for thermal/counters/health, but if a future feature ever needs an atomic "signal+temp+byte-count" snapshot, that requires holding the AT lock anyway.
4. **`/proc/net/dev` counters are u64 wrapping.** Always compute deltas, never display raw values.
5. **`/sys/class/net/rmnet_data0/operstate` reads `unknown`** even though `carrier=1` and bytes are flowing. The rmnet driver doesn't drive operstate; trust `carrier` plus byte-counter motion as the liveness signal.

## Concrete recommendation

Lowest-risk, highest-leverage migration for the poller:

1. Move `AT+QTEMP` → read `/sys/class/thermal/`. Drop one AT call per poll, gain ~40 sensors of granularity.
2. Move `AT+QGDCNT` → read `/proc/net/dev`. Drop one AT call per poll, gain per-interface granularity.
3. Add a new "Modem Subsystem" health indicator using `subsys0/state` + `subsys0/crash_count`. Costs nothing; catches silent modem reboots that AT polling misses. **(Done — shipped as the "System Health" card; collected by the poller's `update_system_health()` and exposed via `/system/modem-subsys.sh`.)**

Both AT removals free up `/run/qmanager_at/at.lock` for the genuinely modem-firmware-bound queries (signal, cell, registration), where AT serialization actually matters.

## Open questions for the QMI re-visit

- The smd channels `/dev/smdcntl0`, `/dev/smdcntl1`, `/dev/smdcntl8` exist and are the in-modem QMI control endpoints. Is there a working userspace QMI client on this rootfs (or one we can cross-compile cheaply for ARMv7)?
- Quectel ships `quectel-CM` for host-side QMI. Does the on-modem distribution include an analogous tool, or any client of `libqmi-glib`?
- If we pursued QMI, the high-value targets would be: NAS service (signal, cell, registration), DMS service (IMEI, firmware), WDS service (data session state). These are exactly the pieces sysfs cannot give us.
