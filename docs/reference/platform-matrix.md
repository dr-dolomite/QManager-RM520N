# Platform Matrix — per-device facts

> **Applies to:** all supported modems. This document is the single canonical home
> for facts that differ by device. Any doc asserting a device-measured fact should
> link here rather than restating it.

QManager supports two modems. Community-tier devices — RM502Q-AE and other SDX55
parts that run these releases unsupported — deliberately get **no column**; they
are mentioned in prose where a finding came from one, but a matrix that grows a
column per field-sighting becomes unmaintainable at the fourth device.

| | RM520N-GL | RG501Q-EU |
| --- | --- | --- |
| Form factor | M.2 | LGA |
| SoC | SDX65 / SDXLEMUR (X62 silicon) | SDX55 / SDXPRAIRIE |
| `Project Name:` in `/etc/quectel-project-version` | `RM520N…` | `RG501QEU_VD` |
| `Branch Name:` in `/etc/quectel-project-version` | `SDX6X` | `SDX55` |
| Status | reference device — everything below measured here | probed 2026-08-24 — see [`rg501q-bringup.md`](./rg501q-bringup.md) |

## How to read this document

**A cell stays `*unverified*` until the hardware is probed.** Phase A0 recorded
provenance and never invented a measurement. The first RG501Q-EU probe ran
**2026-08-24** over adb — full results, including the GFW/GitHub finding that
reframed the work, are in [`rg501q-bringup.md`](./rg501q-bringup.md). Cells filled
from it carry `on-device 2026-08` in `How established`; everything still reading
`*unverified*` was not covered by that probe.

`How established` distinguishes a live measurement from an inference. Treat
`inferred` rows with the same suspicion as an unverified one: they are reasoning
about the device, not observation of it.

---

## Boot & time

| Fact | RM520N-GL (SDX65) | RG501Q-EU (SDX55) | How established |
| --- | --- | --- | --- |
| Battery RTC | None — every boot starts at Jan 1970 | *unverified* | on-device 2026-07 · `scheduled-timers.md` |
| Clock step at boot | `ql_time_daemon` steps ~24s in; requires a registered SIM (no SIM ⇒ 1970 forever) | *unverified* | on-device 2026-07 · `scheduled-timers.md` |
| `OnCalendar` timer behavior | Every armed timer misfires **twice** per boot (~23s at 1970, ~29s post-step) | *unverified* | on-device, reproduced across 2 boots · `scheduled-timers.md` |
| `crond` | Binary ships but daemon never runs; `/var/spool/cron/crontabs/` empty | *unverified* | on-device, re-confirmed twice · `scheduled-timers.md` |
| `systemd-time-wait-sync` | Not shipped | *unverified* | on-device · `scheduled-timers.md` |
| journald | Disabled device-wide — use `/var/log/messages` | *unverified* | on-device · `scheduled-timers.md` |
| systemd version | 244 (minimal build; `systemctl is-enabled` reads only `/etc/systemd/system/`) | *unverified* | on-device · `qmanager-independence.md` |

## Filesystem & partitions

| Fact | RM520N-GL (SDX65) | RG501Q-EU (SDX55) | How established |
| --- | --- | --- | --- |
| Rootfs | `ubi0:rootfs`, boots **`ro`** — proof is `ro` in `/proc/cmdline`, not `/proc/mounts` | *unverified* | on-device · `qmanager-independence.md` |
| `/etc` + `/usrdata` | Same UBIFS volume `ubi2_0`, always rw, no remount needed | *unverified* | reboot-proven 2026-08-10 |
| `/tmp` | tmpfs, `root:root 1777`, ~89 MB, cleared every boot | *unverified* | on-device · `tmp-file-ownership.md` |
| `fs.protected_regular` | `=1` — blocks **root** (not www-data) from write-opening another UID's file in a sticky dir | *unverified* | on-device · `tmp-file-ownership.md` |
| Cross-FS `mv` | `/tmp`→`/etc` gets `EXDEV`; degrades to copy+unlink | *unverified* | inferred from the volume split above |
| `pid_max` | 32768; PID churn ~100/s ⇒ wraps in ~325s | *unverified* | on-device · `tmp-file-ownership.md` |

## Shell & toolchain

| Fact | RM520N-GL (SDX65) | RG501Q-EU (SDX55) | How established |
| --- | --- | --- | --- |
| BusyBox | v1.31.1 | *unverified* | on-device · `auth-rate-limiting.md` |
| `flock -w` (timeout) | **Absent** — poll `flock -x -n` in a loop instead | *unverified* | on-device · `at-command-transport.md` |
| `flock` bare-FD form | Supported; a read-only fd suffices for `-x` | *unverified* | on-device via `/proc/<pid>/fdinfo` |
| Fractional `sleep` | Supported | *unverified* | on-device · `speedtest.md` |
| `/bin/bash` | Present, 3.2.57 — many modern bashisms missing | *unverified* | on-device · `docs/BACKEND.md` |
| Shell arithmetic | BusyBox `sh` is 32-bit signed (wraps past 2.15 GB); bash 3.2 is 64-bit | *unverified* | on-device · `data-usage-counter.md` |
| Entware `jq` | 1.7.1, built **without** ONIGURUMA — `gsub`/`test`/`match` abort at runtime | *unverified* | on-device · `alerts.md` |
| `sftp-server` | Absent — deploy with `scp -O` only | *unverified* | on-device |
| `stdbuf` | Absent | *unverified* | on-device · `qmanager-independence.md` |

## AT transport

| Fact | RM520N-GL (SDX65) | RG501Q-EU (SDX55) | How established |
| --- | --- | --- | --- |
| AT device node | `/dev/smd11` (Qualcomm SMD char device, not a UART) | *unverified* | on-device · `at-command-transport.md` |
| Default node permissions | `crw------- root:root` | *unverified* | on-device · `qmanager-independence.md` |
| udev subsystem | `glinkpkt` (sysfs `/sys/class/glinkpkt/smd11`) | *unverified* — **see PRAIRIE note below** | on-device · `qmanager-independence.md:273` |
| `smd11` creation timing | Exists before `qmanager-setup.service` runs | *unverified* — **see PRAIRIE note below** | on-device |
| termios | Returns `ENOTTY` for `tcgetattr`/`tcsetattr` | *unverified* | on-device · `sms.md` |
| URC listener | None resident; `smd11` **not** selectable via `AT+QURCCFG="urcport"` (only `usbat`/`usbmodem`/`uart1`/`all`) | *unverified* | live `/proc/*/fd/*` scan · `at-command-transport.md` |
| `AT+CGAUTH` | **Unsupported** — returns `ERROR`; use `AT+QICSGP` | *unverified* | on-device · `wan-profile-management.md:81` |
| Per-context MTU write | No reliable write; `+CGCONTRDP` returns no MTU field | *unverified* | on-device · `wan-profile-management.md:400` |
| `+CGCONTRDP` IPv6 format | 16 dotted-decimal octets; gateway quoting varies between reads | *unverified* | on-device 2026-08-03 |

### PRAIRIE-family note — a hypothesis, not a measurement

Two existing docs already record deviations on **PRAIRIE-derived** platforms:

- `qmanager-independence.md:273-281` — the udev rule deliberately omits
  `SUBSYSTEM==` because the subsystem name differs off RM520N-GL, and on
  PRAIRIE platforms the modem re-creates `/dev/smd11` **after**
  `qmanager-setup.service` completes, so the one-shot's guard returns false and
  permissions end up wrong.
- `docs/BACKEND.md:1031` — same udev reasoning.

**Both were established against RG502Q / RM502Q, not RG501Q-EU.** Same SDX55
family, different model. They are the strongest starting hypotheses we have for
Phase B — and they are still hypotheses. Do not promote either to a measured
fact for RG501Q-EU without probing it. If the boot-ordering deviation does hold,
it is a real bug on the new target, not a cosmetic difference.

## Network interfaces

| Fact | RM520N-GL (SDX65) | RG501Q-EU (SDX55) | How established |
| --- | --- | --- | --- |
| Ethernet controller | Realtek RTL8125B 2.5GbE as `eth0`, out-of-tree `r8125` driver | *unverified* — **may not exist at all** | on-device · `ethernet.md` |
| Ethernet during attach cycle | PHY drops ~4s on every `AT+COPS=0` re-attach | *unverified* — **likely inapplicable** | on-device, 2 runs |
| TTL interface | `rmnet+` | *unverified* | on-device |
| WAN data interface | Not fixed — the `rmnet_dataN` index migrates across attach cycles | *unverified* | on-device · `wan-profile-management.md:418` |
| Counter orientation (`/proc/net/dev`) | normal (rx=DL, tx=UL) | *unverified* — see the orientation note below | `data-counter-platform-matrix.md` — already per-SoC |

**The Ethernet rows carry the largest form-factor risk in this table.** RTL8125B
sits on the **M.2 carrier board**, not inside the modem. RG501Q-EU is LGA — a
different carrier board entirely, which may route Ethernet differently or not at
all. The ~4s attach-cycle link drop is therefore probably a property of *our
board*, not of *the modem*, and should be treated as inapplicable until proven
otherwise.

**On counter orientation — a hypothesis, not a measurement.** An **RM502Q-AE**
(SDX55, community tier) probe found `/proc/net/dev` rx/tx labels reversed on
*some* IPA driver builds — the source hedges deliberately, and a slow-path test
on the same part showed correct labels. Schema v5 keys a static orientation map
on `Branch Name`, so an RG501Q-EU reporting `SDX55` **would inherit** the
reversed map. Two reasons that is not a measurement: it was established on a
different model, and `Branch Name` for RG501Q-EU is itself `*unverified*` (see
the header table) — it is a map lookup on an unmeasured key. Treat as a Phase-B
hypothesis to test, never as a known value.

## CPU & ABI

| Fact | RM520N-GL (SDX65) | RG501Q-EU (SDX55) | How established |
| --- | --- | --- | --- |
| Core | Single-core ARMv7-A Cortex-A7 @ ~1.2 GHz | *unverified* | on-device · `docs/BACKEND.md:1647` |
| RAM | 178 MB + ~91 MB zram swap | *unverified* | on-device |
| Float ABI | `vfp vfpv3 vfpv4 neon` in `/proc/cpuinfo` — armhf hard-float runs natively | *unverified* | on-device `/proc/cpuinfo` |
| `aarch64` | Will not run | *unverified* | inferred from ARMv7-A |
| glibc | 2.31 | *unverified* | on-device |
| Kernel | `5.4.210-perf` | *unverified* | on-device 2026-05-09 |
| Entware target | `armv7sf-k3.2` | *unverified* | on-device |

**Float ABI is the highest-consequence unverified row.** SDX55 is a genuinely
different SoC, not a revision of SDX65. Bundling a hard-float binary for
RG501Q-EU on the assumption that VFP support carries over risks a hard `SIGILL`
at runtime — a crash, not a degradation. Probe `/proc/cpuinfo` before shipping
any native binary to the new target.

---

## Known gaps blocking Phase B

### Test-device credentials are singular

Every SSH reference in the repo uses one flat triad — `MODEM_IP`,
`MODEM_SSH_USER`, `MODEM_SSH_PASSWORD` — with no device qualifier. Probing a
second modem requires either a per-device prefix or a selector variable.

Three files plus one agent memory hardcode the single-device assumption:

| File | What assumes one device |
| --- | --- |
| `CLAUDE.md` | "Credentials are in `.env`" — the Live Device Access section |
| `.claude/agents/modem-investigator.md` | The canonical PowerShell connection snippet |
| `.claude/agents/busybox-portability-checker.md` | Same snippet, restated |
| `.claude/agent-memory/modem-investigator/stale_env_ssh_password.md` | "ask the user to refresh `MODEM_SSH_PASSWORD`" — no notion of *which* device |

**Deliberately not solved in Phase A0.** Choosing a scheme without a second
device to test it against is guesswork; it is a Phase-B prerequisite. Never print
a credential value into a transcript — reference variable names only.

## Open questions for Phase B

Each becomes a filled cell above once measured:

- Does `eth0` exist on the RG501Q-EU carrier board at all, and does
  `qmanager_ethernet_apply` have anything to apply to?
- What is the udev subsystem name for `smd11`, and does the PRAIRIE
  boot-ordering deviation reproduce on this specific model?
- Is there a battery RTC, or does the 1970 boot window apply identically?
- Is `crond` present *and running*, making the systemd-timer machinery
  unnecessary?
- Does the rootfs `ro` / `ubi2_0` volume split match?
- Does the CPU expose VFP, so hard-float binaries are safe?
- Does the device `jq` have ONIGURUMA, and does BusyBox `flock` support the
  bare-FD form?
- Is `AT+CGAUTH` supported, and is there a per-context MTU write?
