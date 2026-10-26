# Run: Port qmanager_atd + broker-backed poller from RM551E to RM520N
status: planning (roadmap r2 — revised after qm-advocate challenge)
lane: full (multi-phase programme; each task gets its own plan before build)
base: 2ebfada1   branch: development   opened: 2026-10-26   lead: opus

## Request
"Orchestrate a team and start planning out the overall porting of the new qmanager_atd and
qmanager_poller from RM551E to RM520N. Focus on the overall roadmap and ledger. Each task will get
its own detailed plan and approach."

## Source of truth (RM551E, `D:\Projects\QM PROJECT\QManager`, branch development-home)
- Broker: `native/qmanager_atd/` (Rust 0.6.1, only dep `libc`, no Cargo.lock / toolchain pin),
  prebuilt `dependencies/qmanager_atd` (aarch64, 668 KB).
- Design docs: `docs/features/at-broker.md`, `docs/features/qmi-lane.md`,
  `docs/architecture/poller-on-broker.md`, `docs/plans/2026-10-22-qmi-*.md`,
  `docs/research/qmi-phase0-results.md`.
- Commit order: AT core a3a42e6f → qcmd wired 3b07e132 → B5.29 phases 0/1/A/B/C
  (a3e80758 … a732ba2d, soak 25b26437) → SMS/qsms e779f42f → legacy engine dropped 5cd87391 →
  watchcat/heartbeat outside the AT gate 3accb6a1/4c4c9f74 → QMI lane c2612443 (0.3.0) → live 1 Hz
  83f1e8ff (0.4.0) → NAS signal config (0.5.0) → WDS stats (0.6.0) → IPv6-only WDS 88bcd427 (0.6.1).
  CA gap-fill NO-GO (05067e89); Rust poll parsers removed 8aab594e; a Rust poller is "not planned".

## What "the new poller" actually is
Not a rewrite. The RM551E poller is still the shell `qmanager_poller`, re-pointed at `qcmd` → broker,
plus B5.29: a capped wait, a busy latch, activity tiers keyed on a UI heartbeat, and a QMI overlay
(`qmi_merge.sh`). B5.29's measured win (39% → 4.9% CPU) came from Phases A and C, which are
**shell-only and do not need the broker** (`poller-on-broker.md:820-898`). The two pollers have
diverged: RM520N carries crash watcher, `data_used`, `system_health`, SIM-swap/`sim_fo_*`,
`latency_history`, device CPU/mem/storage. **The port is a selective merge into the RM520N poller,
never a file swap.**

## Value case (must be measured, not assumed — P0)
The broker earns its place only if it beats today's per-command `atcli_smd11` spawn on the device.
Today's CPU baseline (`poller-cpu-profile.md`) replaced `qcmd` with a replay stub, so it does **not**
contain the cost the broker removes. The 6.8 s SMS inbox hold is RM520N-specific (RM551E reads took
0.29 s) and the broker does not by itself fix it. P0 produces the numbers; a GO/NO-GO on the broker
is taken after P1 lands and those numbers are in.

## Platform deltas the port must absorb (static recon 2026-10-26 — devices offline)
| # | RM551E assumption | RM520N reality | Consequence |
|---|---|---|---|
| D1 | target `aarch64-unknown-linux-musl` | single-core Cortex-A7, armv7l, VFP/NEON | rebuild `armv7-unknown-linux-musleabihf` static; pin toolchain + add Cargo.lock; measure size/RSS |
| D2 | socket 0600 root, `SO_PEERCRED` uid 0 | CGIs run as www-data and call `qcmd`; www-data is already in `dialout` with raw smd11 access (`install_rm520n.sh:1001,3779-3782`) | admit www-data; a root-only socket adds no protection here |
| D3 | lock `/var/lock/qmanager.lock`, opened `O_CREAT` (`common/lock.rs:28-36`, `at/exec.rs:207,214`) | `/tmp/qmanager_at.lock` is www-data-owned 0666, opened read-only by root (`qmanager_setup:72-77`); `fs.protected_regular` refuses root an `O_CREAT` open of it | broker + root fallback must open the lock and long flag read-only/no-create, or root gets EACCES on every call |
| D4 | procd; frozen-broker restart spawns `/etc/init.d/qmanager_atd`, claims an `O_EXCL` marker in `/var/run` (`client/transport.rs:126-171`) | systemd; `/var/run` root 0755 so www-data cannot claim the marker; sudoers already grants `systemctl restart qmanager-*` | redesign restart: systemd `WatchdogSec=` or `sudo -n systemctl` — not the RM551E path |
| D5 | timezone from OpenWrt `/etc/TZ` | `/etc/localtime` → `/opt/share/zoneinfo`, `/opt` mounts ~30 s into boot; 1970 window | log timestamps only (deadlines are monotonic) — pick a TZ source |
| D6 | QMI over `AF_QIPCRTR` (42), NAS/DMS/UIM/WDS/DSD | unproven on kernel 5.4.210 / 4.14.206; vendor daemons may hold clients | QMI lane gated on P0 |
| D7 | `rmnet_ipa0` / `rmnet_data<N>` in `data_call.rs` | unverified | measure before porting the data-call lane |
| D8 | installer installs from `dependencies/` | `install_rm520n.sh:3371-3377` deletes `/usr/bin/qmanager_*` not shipped | ship through `build.sh` + installer like `atcli_smd11` |
| D9 | `qcmd` stdout = `$(...)`+echo capture (output.rs:42) | callers strip the echoed command line (`cgi_at.sh:28-40`, poller `:515-523`) | byte-for-byte stdout parity gate |
| D10 | **modem `ERROR` = stdout, rc 0** (`client/qcmd.rs:133-142`) | **rc 1, empty stdout, stderr `ERROR: command_failed`** (`qcmd:174-179`); callers branch on rc | a straight port turns every rejected AT write into success — keep the RM520N contract |
| D11 | new code `scan_in_progress` | callers grep `modem_busy` (`qmanager_neighbour_scanner:174`, `qmanager_health_check:483`); Discord bot treats any "OK" in stdout+stderr as success (`discord-bot/handlers.go:507-513`) | error-code mapping in the client, caller census includes the bot |
| D12 | broker holds one smd11 fd open; `sms_tool` beside it verified on RM551E only | nothing holds smd11 between commands today; ≥7 direct openers: 6 `sms_tool` sites, `qmanager_health_check:581` (no lock), `install_rm520n.sh:3877` (atcli) | multi-opener behaviour on RM520N decides whether SMS (P5) is mandatory before go-live |
| D13 | one device | one installer serves RM520N and RG501Q (`install_rm520n.sh:457`) | the first broker release reaches RG501Q users — installer must skip the broker there until P8 passes |
| D14 | — | uninstall misses `qsms` link + `/var/run/qmanager_atd.*` (`uninstall_rm520n.sh:373-379`); dropping atcli breaks `qmanager_health_check:358` and `install_rm520n.sh:3876` | add uninstall + health check to the installer write set; keep `atcli_smd11` shipped |

## Phases (dependency order)
| id | phase | depends on | exit criterion |
|---|---|---|---|
| P0 | **Device feasibility + value baseline** — both devices: QRTR + published services + vendor holders; smd11 multi-opener test; `protected_regular` + lock/`/var/run` perms; space; armv7 build `--version` + idle RSS; timing: 20× `qcmd AT` vs 20× `atcli_smd11 AT`, each `sms_tool` hold in `sms.sh`, poller `cutime+cstime` on the real transport | devices online | written GO/NO-GO per lane per device + baseline numbers |
| P1 | **Poller shell wins (no broker)** — port B5.29 Phases A and C into the RM520N poller | P0 baseline | measured CPU drop vs P0 real-transport baseline; status.json unchanged; soak |
| — | **GATE: broker GO/NO-GO** — user decides with P0 + P1 numbers | P1 | decision recorded below |
| P2 | **Broker AT core on RM520N** — vendor crate, D1/D3/D5 deltas, www-data peer policy (D2), systemd unit + restart redesign (D4) | gate GO | broker owns smd11 inside the lock, survives restart and the 1970 window; no EACCES as root or www-data |
| P3 | **Packaging** — build.sh, installer, uninstall, OTA rollback, RG501Q skip (D8, D13, D14) | P2 | installer-safety-auditor CLEAR before and after; fresh install + OTA + uninstall on device |
| P4 | **qcmd cut-over** — Rust client behind `/usr/bin/qcmd`, in-process fallback, RM520N error contract (D9–D11) | P3 | rc/stdout/stderr diff = 0 vs shell `qcmd` for OK, ERROR, busy, long QSCAN, attach cycle, as root and www-data; Discord bot checked |
| P5 | **SMS lane** — `qsms` for the `sms_tool` sites, or keep `sms_tool` under the lock; mandatory if P0's multi-opener test fails | P4 (blocks P4 go-live if multi-opener fails) | SMS read/send/forward parity; the 6.8 s hold explained and not kept |
| P6 | **Activity tiers on the broker** — B5.29 tiering keyed on a UI heartbeat (`.mono`, `poller_tier`), watchcat/heartbeat outside the AT gate | P4 | touches poller, watchcat, health_check and frontend heartbeat; soak |
| P7 | **QMI lane** (+ live 1 Hz + WDS as a later slice) — registry, `qmi_snapshot` sidecar, `qmi_merge.sh`, additive `lte.source` / `device.qmi_*` | P0 QMI GO, P4 | sidecar fresh every 2 s; overlay only when QENG missing; SSR count stable over soak |
| P8 | **RG501Q-EU enablement** — run P2–P4 (P7 if GO) on SDX55, then lift the installer skip | P4 | portability diff clean; per-device row in `platform-matrix.md` |
| P9 | **Docs + release** — each phase closes its own docs; P9 is the final sweep (router rows, `at-command-transport.md` rewrite, RELEASE_NOTES) | all | router rows present; release entry on template |

## Tasks (each gets its own plan file before build: `.orchestra/runs/2026-10-26-atd-port-<id>.md`)
| id | phase | task | seat | write set (planned) | state |
|---|---|---|---|---|---|
| T0.1 | P0 | Device probe: QRTR, vendor QMI holders, smd11 multi-opener, protected_regular, `/var/run` perms, space | modem-investigator | none (read-only) | BLOCKED — both devices offline 2026-10-26 |
| T0.2 | P0 | Value baseline: qcmd vs atcli timing, sms_tool hold timings, poller real-transport CPU | modem-investigator | none | BLOCKED — devices offline |
| T0.3 | P0 | armv7 musl cross-build (pinned toolchain); `--version` + idle RSS on device | cgi-endpoint-builder | scratch build only | PENDING (build can start offline; run needs device) |
| T1.1 | P1 | Port B5.29 Phases A + C into the RM520N poller | cgi-endpoint-builder | `scripts/usr/bin/qmanager_poller` | PENDING |
| T1.2 | P1 | Soak + CPU vs P0 baseline | modem-investigator | none | PENDING |
| G1 | gate | Broker GO/NO-GO with P0 + P1 numbers | user | — | PENDING |
| T2.1 | P2 | Vendor crate; D1 target, D3 no-create lock/flag opens, D5 TZ | cgi-endpoint-builder | `native/qmanager_atd/**` | PENDING |
| T2.2 | P2 | www-data peer policy (D2) | cgi-endpoint-builder | `native/…/daemon/mod.rs` | PENDING |
| T2.3 | P2 | systemd unit + restart redesign (D4) | cgi-endpoint-builder | `scripts/etc/systemd/system/qmanager-atd.service`, `client/transport.rs` | PENDING |
| T3.1 | P3 | build.sh, install, uninstall, OTA rollback, RG501Q skip | qm-worker under installer-safety-auditor | `build.sh`, `install_rm520n.sh`, `uninstall_rm520n.sh`, `dependencies/`, `qmanager_health_check` | PENDING |
| T4.1 | P4 | qcmd cut-over + error-contract adapter + full caller census (incl. Discord bot) | cgi-endpoint-builder | `scripts/usr/bin/qcmd`, `client/qcmd.rs` | PENDING |
| T4.2 | P4 | Portability residue on both devices | busybox-portability-checker | none | PENDING |
| T5.1 | P5 | SMS lane decision + implementation | lead → cgi-endpoint-builder | sms CGIs, `qmanager_sms_*`, `sms_alerts.sh`, `qmanager_health_check` | PENDING — user call |
| T6.1 | P6 | Activity tiers + heartbeat + watchcat outside AT gate | cgi-endpoint-builder + ui-builder | poller, `qmanager_watchcat`, `qmanager_health_check`, heartbeat hook | PENDING |
| T7.1 | P7 | QMI lane + sidecar + overlay + types | cgi-endpoint-builder + ui-builder (types) | `native/…/qmi/**`, `qmi_merge.sh`, `types/modem-status.ts` | PENDING — gated on P0 |
| T8.1 | P8 | RG501Q-EU validation, lift installer skip | busybox-portability-checker + modem-investigator | `install_rm520n.sh`, `platform-matrix.md` | PENDING |
| T9.1 | P9 | Docs + router + release notes | docs-writer | `docs/reference/**`, `RELEASE_NOTES.md` | PENDING |

Every build task closes with: real run on the device, CRLF + `sh -n`/`bash -n` gates, a blind
`qm-verifier` pass, md5 deployed vs HEAD. Disruptive device steps (service restart, install) need
the user's yes each time.

## Decisions taken — do not re-ask
- The poller port is a selective merge into the RM520N poller, not a file swap.
- No Rust poller (matches RM551E).
- AT lane keeps `/dev/smd11`.
- The RM520N `qcmd` error contract (rc 1 + stderr) wins over RM551E's rc 0 (D10).
- Shell-only poller wins (B5.29 A + C) ship before any broker work (advocate challenge #5).
- `atcli_smd11` stays shipped: health check and installer depend on it (D14).
- USER 2026-10-26: crate is **vendored** into `native/qmanager_atd/` and synced by hand. Copied
  verbatim (93 tracked files, `git archive`) from QManager `7f7d1827c9b71aaf523c51276bc837498a1baaa2`
  (crate 0.6.1). Upstream `.rs` blobs are CRLF; kept byte-identical so upstream diffs stay clean.
  To sync: `git -C ../QManager diff 7f7d1827..<new> -- native/qmanager_atd`, then record the new base here.

## Decisions open — the user's call
1. **Broker GO/NO-GO (G1):** after P0 + P1 numbers.
2. **SMS (P5):** port `qsms` or keep `sms_tool` under the lock — may be forced by P0.
3. **QMI / live / WDS scope (P7):** after the P0 probe.

## Risks
- QRTR absent or contended → P7 cut.
- smd11 multi-opener fails on RM520N → P5 becomes a precondition of P4 go-live.
- Single-core A7: broker threads plus the poller must not exceed today's idle CPU.
- Forced timeout/resync and the frozen-broker restart were exercised only in tests on RM551E
  (`at-broker.md:570-572`); RM520N is the first hardware test.
- Firmware `atcmd` / manual SSH openers bypass the lock.

## Attempts   (append-only)
| task | # | seat | ticket rev | outcome | checks run | evidence path |
|---|---|---|---|---|---|---|
| R1 | 1 | qm-scout | — | DONE_WITH_CONCERNS (atd inventory) | static | conductor transcript |
| R2 | 1 | qm-scout | — | DONE_WITH_CONCERNS (poller is shell, not rewrite) | static | conductor transcript |
| R3 | 1 | qm-scout | — | DONE_WITH_CONCERNS (AT consumer census) | static | conductor transcript |
| R4 | 1 | modem-investigator | — | BLOCKED (both devices unreachable) | reachability only | scratchpad rm520n.txt / rg501q.txt |
| A1 | 1 | qm-advocate | r1 | 9 challenges; D10–D14 added, P1 split out, P7→P8 gate, value case added | static | conductor transcript |
| — | — | lead | r2 | verified D10 (`qcmd.rs:133-142` rc 0) and D3 (`qmanager_setup:72-77`) in source | static | — |

## Device state
Not touched. Both devices unreachable from the host on 2026-10-26.
