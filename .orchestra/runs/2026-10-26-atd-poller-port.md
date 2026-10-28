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
| D6 | QMI over `AF_QIPCRTR` (42), NAS/DMS/UIM/WDS/DSD | **proven on RM520N-GL 2026-10-26** (`native/qmi_probe`, root and www-data); RG501Q unprobed | P7 gate GO on RM520N-GL |
| D7 | `rmnet_ipa0` / `rmnet_data<N>` in `data_call.rs` | unverified | measure before porting the data-call lane |
| D8 | installer installs from `dependencies/` | `install_rm520n.sh:3371-3377` deletes `/usr/bin/qmanager_*` not shipped | ship through `build.sh` + installer like `atcli_smd11` |
| D9 | `qcmd` stdout = `$(...)`+echo capture (output.rs:42) | callers strip the echoed command line (`cgi_at.sh:28-40`, poller `:515-523`) | byte-for-byte stdout parity gate |
| D10 | **modem `ERROR` = stdout, rc 0** (`client/qcmd.rs:133-142`) | **rc 1, empty stdout, stderr `ERROR: command_failed`** (`qcmd:174-179`); callers branch on rc | a straight port turns every rejected AT write into success — keep the RM520N contract |
| D11 | new code `scan_in_progress` | callers grep `modem_busy` (`qmanager_neighbour_scanner:174`, `qmanager_health_check:483`); Discord bot treats any "OK" in stdout+stderr as success (`discord-bot/handlers.go:507-513`) | error-code mapping in the client, caller census includes the bot |
| D12 | broker holds one smd11 fd open; `sms_tool` beside it verified on RM551E only | nothing holds smd11 between commands today; ≥7 direct openers: 6 `sms_tool` sites, `qmanager_health_check:581` (no lock), `install_rm520n.sh:3877` (atcli) | multi-opener behaviour on RM520N decides whether SMS (P5) is mandatory before go-live |
| D13 | one device | one installer serves RM520N and RG501Q (`install_rm520n.sh:457`) | the first broker release reaches RG501Q users — installer must skip the broker there until P8 passes |
| D15 | `safefs.rs` opens state files `O_NOFOLLOW` but blocking and without an fstat type/owner check | any local user can plant a FIFO at `/tmp/qmanager_long_running` or the PID path and stall the AT worker (security review 2026-10-26, MEDIUM); on RM520N www-data legitimately creates the long flag (`qmanager_cell_scanner:62`), so a "root-owned only" rule does not fit as-is | T2.1: open `O_NONBLOCK`, fstat, accept only regular files, owner = root or www-data; move broker-only files (PID) into a root-only dir |
| D14 | — | uninstall misses `qsms` link + `/var/run/qmanager_atd.*` (`uninstall_rm520n.sh:373-379`); dropping atcli breaks `qmanager_health_check:358` and `install_rm520n.sh:3876` | atcli and sms_tool are dropped (user 2026-10-26): rewire both sites onto the broker/`qcmd`; uninstall removes the old binaries |

## Phases (dependency order)
| id | phase | depends on | exit criterion |
|---|---|---|---|
| P0 | **Device feasibility + value baseline** — both devices: QRTR + published services + vendor holders; smd11 multi-opener test; `protected_regular` + lock/`/var/run` perms; space; armv7 build `--version` + idle RSS; timing: 20× `qcmd AT` vs 20× `atcli_smd11 AT`, each `sms_tool` hold in `sms.sh`, poller `cutime+cstime` on the real transport | devices online | written GO/NO-GO per lane per device + baseline numbers |
| P1 | **Poller shell wins (no broker)** — port B5.29 Phases A and C into the RM520N poller | P0 baseline | measured CPU drop vs P0 real-transport baseline; status.json unchanged; soak |
| — | **GATE: broker GO/NO-GO** — user decides with P0 + P1 numbers | P1 | decision recorded below |
| P2 | **Broker AT core on RM520N** — vendor crate, D1/D3/D5 deltas, www-data peer policy (D2), systemd unit + restart redesign (D4) | gate GO | broker owns smd11 inside the lock, survives restart and the 1970 window; no EACCES as root or www-data |
| P3 | **Packaging** — build.sh, installer, uninstall, OTA rollback, RG501Q skip (D8, D13, D14) | P2 | installer-safety-auditor CLEAR before and after; fresh install + OTA + uninstall on device |
| P4 | **qcmd cut-over** — Rust client behind `/usr/bin/qcmd`, in-process fallback, RM520N error contract (D9–D11) | P3 | rc/stdout/stderr diff = 0 vs shell `qcmd` for OK, ERROR, busy, long QSCAN, attach cycle, as root and www-data; Discord bot checked |
| P5 | **SMS lane** — port `qsms` (feature set from RM551E `at-broker.md` SMS phase 3) to every `sms_tool` site, then drop `sms_tool` and `atcli_smd11` from build + installer; no decompiling | P4 (P0's multi-opener result decides whether P4 can go live before P5) | SMS read/send/forward/storage parity; the 6.8 s hold explained and not kept; no `atcli`/`sms_tool` caller left |
| P6 | **Activity tiers** — B5.29 tiering keyed on a UI heartbeat (`.mono`, `poller_tier`), watchcat/heartbeat outside the AT gate. G1 (2026-10-27): the shell-only part runs **before P4**; any part that truly needs the broker waits for P4 (T6.1 plan decides the split) | P1 (shell part); P4 (broker part, if any) | touches poller, watchcat, health_check and frontend heartbeat; soak |
| P7 | **QMI lane** (+ live 1 Hz + WDS as a later slice) — registry, `qmi_snapshot` sidecar, `qmi_merge.sh`, additive `lte.source` / `device.qmi_*`; bound WDS 0x002D (gateway, MTU) | P0 QMI GO (RM520N-GL: GO 2026-10-26), P4 | sidecar fresh every 2 s; overlay only when QENG missing; SSR count stable over soak |
| P8 | **RG501Q-EU enablement** — run P2–P4 (P7 if GO) on SDX55, then lift the installer skip | P4 | portability diff clean; per-device row in `platform-matrix.md` |
| P9 | **Docs + release** — each phase closes its own docs; P9 is the final sweep (router rows, `at-command-transport.md` rewrite, RELEASE_NOTES) | all | router rows present; release entry on template |

## Tasks (each gets its own plan file before build: `.orchestra/runs/2026-10-26-atd-port-<id>.md`)
| id | phase | task | seat | write set (planned) | state |
|---|---|---|---|---|---|
| T0.1 | P0 | Device probe: QRTR, vendor QMI holders, smd11 multi-opener, protected_regular, `/var/run` perms, space | independent Opus session (atd-t01-probe) | none (read-only) | DONE on RM520N-GL 2026-10-26; RG501Q-EU still to run (offline) |
| T0.2 | P0 | Value baseline: qcmd vs atcli timing, lock occupancy, sms_tool status cost, poller real-transport CPU | independent Opus session (brief `2026-10-26-atd-port-T0.2.md`) | none | DONE_WITH_CONCERNS on RM520N-GL 2026-10-26 (idle UI only; contention not measured) |
| T0.3 | P0 | armv7 musl cross-build (pinned toolchain); `--version` + idle RSS on device | lead | `native/qmanager_atd/{.cargo/config.toml,rust-toolchain.toml,Cargo.lock}` | DONE on RM520N-GL 2026-10-26; idle daemon RSS moved to the T2 smoke test (needs smd11) |
| T1.1 | P1 | Re-author the RM520N poller hot path with B5.29 techniques (plan `2026-10-26-atd-port-T1.1.md`, slices S1–S7) | lead + cgi-endpoint-builder | poller, `qmanager_ping`, `parse_at.sh` | DONE 2026-10-26 (S1–S6, S8, S9; S7 dropped): 874 → 344 ms CPU/cycle, 27.4 → 13.0 % core; verifier fix round e7d349f6; all four files deployed on RM520N-GL; merged to development |
| T1.2 | P1 | Soak + CPU vs P0 baseline | modem-investigator | none | DONE_WITH_CONCERNS 2026-10-27: 12 h soak clean (0 restarts, 0 bad lines); CPU 353–379 ms/cycle (13.1–14.2 % core) but drifts up ~7 %, poller RSS +552 kB — cause found: bash 3.2 `read` leak at `qmanager_poller:606,782` (pre-T1.1), fixed and deployed 2026-10-27 |
| G1 | gate | Broker GO/NO-GO with P0 + P1 numbers | user | — | DONE 2026-10-27: **GO**, with P6 shell tiers moved ahead of P4 and a dashboard CGI cost task added (see Decisions taken) |
| T2.1 | P2 | Vendor crate; D1 target, D3 no-create lock/flag opens, D5 TZ | cgi-endpoint-builder | `native/qmanager_atd/**` | DONE 2026-10-27 (plan `2026-10-26-atd-port-T2.1.md`): lock/flag no-create opens, `check_trusted`, PID in `/var/run/qmanager`, TZ from `/etc/localtime`; verifier PASS_WITH_NOTES; merged 87c769a9. Observations for T2.3/P3/P4 in its plan |
| T2.2 | P2 | www-data peer policy (D2) | cgi-endpoint-builder | `native/…/daemon/mod.rs` | DONE 2026-10-27 (plan `2026-10-26-atd-port-T2.2-T2.3.md`): socket `root:dialout 0660` (lighttpd CGIs carry gid 20 only), peers root + www-data; merged 380ae694 |
| T2.3 | P2 | systemd unit + restart redesign (D4) | cgi-endpoint-builder | `scripts/etc/systemd/system/qmanager-atd.service`, `client/transport.rs` | DONE 2026-10-27: `Type=notify` + `WatchdogSec=30`, ping withheld when an AT job runs > 340 s; client restart path removed; device smoke passed (idle RSS 568 kB, 0.59 % core, kill -9 restart < 8 s, watchdog restart 33 s, D12 sms_tool beside held smd11 OK). T3.1 to-do list in its plan. **P2 closed** |
| T3.1 | P3 | build.sh, install, uninstall, OTA rollback, RG501Q skip | qm-worker under installer-safety-auditor | `build.sh`, `install_rm520n.sh`, `uninstall_rm520n.sh`, `dependencies/`, `qmanager_health_check` | **DONE + merged 2026-10-28** (d0b22f5c, plan `2026-10-26-atd-port-T3.1.md`): device steps 1–4 PASS on 61368cd2 (OTA fwd, reboot = atd not started, rollback v0.1.17 + reboot + OTA fwd, uninstall + fresh install); auditor CLEAR, busybox SAFE, verifier host + device PASS_WITH_NOTES. Not run: manual broker start, stale-wants-link plant. Carried to T4.1: drop enable skip + link rm, hw_profile-missing guard, lock-dir hardening; docs nit Step 11/10 in qmanager-independence.md. Original brief: Must also: (a) ship the T5.1 S1-built `dependencies/qmanager_atd` (md5 = S1 build); (b) install the binary + `qsms`/`qcmd` links on **both** devices and keep the broker unit off RG501Q by a platform key, not `ConditionPathExists` (T5.1 plan §2); (c) the T2.2/T2.3 to-do list in its plan file |
| T4.1 | P4 | qcmd cut-over + error-contract adapter + full caller census (incl. Discord bot) | cgi-endpoint-builder | `scripts/usr/bin/qcmd`, `client/qcmd.rs` | PENDING |
| T4.2 | P4 | Portability residue on both devices | busybox-portability-checker | none | PENDING |
| T5.1 | P5 | qsms port + retire `sms_tool` / `atcli_smd11` — **transport = QMI WMS (decision 3); planned after T5.0** | cgi-endpoint-builder (installer part under installer-safety-auditor) | sms CGIs, `qmanager_sms_*`, `sms_alerts.sh`, `qmanager_health_check`, `build.sh`, `install_rm520n.sh`, `uninstall_rm520n.sh` | **S1–S5 DONE + merged 2026-10-28** (4024c6a2, branch HEAD 1323988a): SMS Center CGI, alerts, forwarding test, storage oneshot, forwarder (watch wake-up) and health check on `qsms`; `sms_tool` copy dropped. Forwarder key storage|sender|ref|total with a 24 h window. Sends: 7 of 8 segments, send_test as www-data delivered (ME 160), forwarder forwarded once (ME 161), loop guard held. busybox SAFE (RM520N; RG501Q audit only), verifier r2 PASS_WITH_NOTES. Nothing deployed; device restored. Open: forced watch reconnect (next natural reboot), RG501Q S0 (offline), S6 after T4.1; notes: CGI merge has no time split on ref reuse, retry after partial multi-part failure can duplicate early parts, compose dialog over-counts UCS-2 parts, RG501Q watch logs `unsupported` per respawn, plan §4 `bad_args` vs code `bad_number`/`message_too_long`. PLAN r2 APPROVED 2026-10-27 (`2026-10-26-atd-port-T5.1.md`; Q1 yes). **S1 DONE + merged 2026-10-28** (979bcb33): WMS backend device-proven (parity 134=134, tag round-trip, watch saw ME 148); binary md5 `ecad8a40` tracked at `dependencies/qmanager_atd`. Probes 2026-10-28 (73d829fe): empty list = success count 0; mem3 = same setting as 0x0033 (keep one CPMS self-heal); local delete PASS; network send BLOCKED by carrier (RP cause 21 / CMS 350, likely no SIM credit) so 2-part + UCS-2 delivery unproven; forced watch reconnect deferred (needs qrtr-ns restart/SSR, drops data call) to the next natural reboot. Send proofs in S2–S4 need SIM credit; S2–S5 land with/after T3.1; S6 after T3.1 + T4.1 |
| T5.0 | P5 | WMS probe: send, delete, new-message indications, storage, as root and www-data; extend `native/qmi_probe` | independent Opus session | `native/qmi_probe/**`, `docs/reference/qmi-probe.md` | DONE 2026-10-27: **GO** for list, read, send, delete, tag, indications, multi-part receive, www-data; network proof of a multi-part send owed (SIM out of credit). Findings + T5.1 design inputs in `2026-10-26-atd-port-T5.0.md`; merged |
| T6.1 | P6 | Activity tiers + heartbeat + watchcat outside AT gate | cgi-endpoint-builder + ui-builder | poller, `qmanager_watchcat`, `qmanager_health_check`, heartbeat hook | DONE 2026-10-27 (plan `2026-10-26-atd-port-T6.1.md`): poller % of core active 12.9 / idle 8.1 / deep 6.0 (was 14.0); system busy deep ≈ 15 % (was 22.8); status.json shape diff 0 (4 additive keys); verifier PASS_WITH_NOTES; merged. **Soak PASS 2026-10-28** (11.9 h, 10-27 22:05→10-28 09:58): 0 restarts, 0/137 bad samples, poller RSS 2420→2376 kB, deep 126 ms/cycle 5.9 % core, active 346 ms 13.2 % (07:46–08:57, user's own dashboard, real use); excluded T6.2 load 23:23–23:36; 02:16–02:32 power cut, not a fault; MemAvailable 64.0→54.9 MB system-wide, watch. Owed: 1970 cold-boot proof, RG501Q-EU; open: verifier notes 2–4 (incl. watchcat stop timeout, pre-existing) |
| T6.2 | P6 | Dashboard CGI cost: +13 points of the core while the dashboard is open (T1.2 replay, 38.5 % vs 25.7 % busy); measure per-CGI cost, then cut forks | lead (plan first) | TBD in its plan | **DONE + merged 2026-10-28** (c55a0046): dashboard adds 1.4 points of busy, was 15.1 (closed 20.9 %, open 22.3 %); CGI share 12.5 → 1.4 %; request floor 39 → 15 ms; forks/request 19 → 2; busybox SAFE, verifier PASS_WITH_NOTES. Backend-only deploy, restored to T3.1 tree 11:08:27; artificial active load 10:43:35–11:08:27. Not measured: 1 MB ping-history cut, lighttpd keep-alive CPU, hidden tab on device. Follow-ups: 2 s useModemStatus default on other pages, lighttpd keep-alive, settings/about one-shot cost, qlog.sh:28 set -u |
| T7.1 | P7 | QMI lane + sidecar + overlay + types; add bound WDS 0x002D (IP/DNS/gateway/netmask/MTU) beside RM551E's bound 0x0024 | cgi-endpoint-builder + ui-builder (types) | `native/…/qmi/**`, `qmi_merge.sh`, `types/modem-status.ts` | PENDING — P0 gate GO on RM520N-GL (needs P4) |
| T8.1 | P8 | RG501Q-EU validation, lift installer skip | busybox-portability-checker + modem-investigator | `install_rm520n.sh`, `platform-matrix.md` | PENDING. Read-only scan DONE 2026-10-28 (47692d88, `2026-10-28-rg501q-port-scan.md`): no blocker; QMI, WMS reads, broker preconditions and BusyBox 1.29.3 residue match. Owed, user OK: broker daemon smoke (blocks the skip lift), `qsms` WMS write + indication proofs, then widen `qm_hw_atd_enabled` and `use_wms()` to `RG501Q*` |
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
- ~~`atcli_smd11` stays shipped~~ — reversed by USER 2026-10-26: **atcli and sms_tool are fully dropped.**
  The broker replaces atcli (same binary as RM551E's); `qsms` replaces sms_tool, built from the
  RM551E docs' SMS feature set. Neither is decompiled.
- USER 2026-10-26: no REA for this port. The RM520N/OpenWRT differences are in the userspace
  (init, libc, permissions), which device probes measure; the vendor binaries are the same.
- USER 2026-10-26: crate is **vendored** into `native/qmanager_atd/` and synced by hand. Copied
  verbatim (93 tracked files, `git archive`) from QManager `7f7d1827c9b71aaf523c51276bc837498a1baaa2`
  (crate 0.6.1). Upstream `.rs` blobs are CRLF; kept byte-identical so upstream diffs stay clean.
  To sync: `git -C ../QManager diff 7f7d1827..<new> -- native/qmanager_atd`, then record the new base here.
- USER 2026-10-27, **G1 = GO**, chose "GO, reorder P6 (Recommended)": proceed P2 → P5 and P7; move the
  shell-only activity tiers (P6) ahead of P4; add a dashboard CGI cost task (T6.2). Basis: poller 27.4 →
  13–14 % (P1); broker CPU gain only ≈ 2.5–3 points; the case is atcli/sms_tool retirement, the 6.8 s SMS
  lock hold and the QMI lane. Still owed: broker RSS (T2 smoke test), SMS-under-UI contention.

- USER 2026-10-27, **decision 3 = QMI WMS** for T5.1 SMS, not AT `qsms`. Probe send, delete and
  new-message indications first (T5.0); T5.1 is planned from that result. WMS reads need no AT lock (~1 / ~4 ms).

## Decisions open — the user's call
1. ~~**Broker GO/NO-GO (G1)**~~ — decided GO 2026-10-27; moved to Decisions taken (numbering kept for references).
2. **QMI / live / WDS scope (P7):** P0 gate is GO on RM520N-GL (see "QMI probe result"); scope
   (live 1 Hz, WDS) still the user's call when P7 starts.
3. ~~**SMS transport for T5.1**~~ — decided 2026-10-27: QMI WMS; moved to Decisions taken.

## Risks
- ~~QRTR absent or contended → P7 cut.~~ Retired on RM520N-GL 2026-10-26; still open for RG501Q-EU.
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
| T1.1 | 1 | lead | plan r1 | S1–S6, S8, S9 built + deployed on RM520N-GL; 344 ms/cycle, 13.1 % core | parity scripts, 300 s measures, instrumented profile, status.json shape diff | `2026-10-26-atd-port-T1.1.md` Progress |

## Device state
Not touched. Both devices unreachable from the host on 2026-10-26.

## Pause 2026-10-26
User paused the run. T0.1 (r2, REA dropped) was stopped mid-run: no report. The probe script was
still finishing its bounded 20 s smd11 hold on the RM520N-GL (serial 61368cd2) and self-deletes at
the end; `qcmd ATI` answered and the poller was active at the stop check. Resume: re-dispatch T0.1
from `.orchestra/runs/2026-10-26-atd-port-T0.1.md`.

## T0.1 result — RM520N-GL, 2026-10-26 (resumed after the pause)
Seat: independent Opus session, brief r3, modem bridge. Report `.orchestra/scratch/atd-T0.1-report.md`,
raw capture `.orchestra/scratch/atd-T0.1-rm520n.txt` (gitignored). Lead spot-checked QRTR config,
the root lock denial and the default route against the raw capture. RG501Q-EU offline: not measured.

| delta | finding | effect on the roadmap |
|---|---|---|
| D1 | one core, armv7l, NEON/VFPv4, glibc 2.31; 46 MB RAM available of 182 MB, 91 MB swap | static armv7 musl target stands; RSS budget is tight — measure in T0.3 |
| D3 | `fs.protected_regular=1`; root `exec 3>>/tmp/qmanager_at.lock` → Permission denied; read-only `9<` works | **confirmed** — broker and fallback must open the lock and long flag without O_CREAT |
| D4 | `/run` root 0755, `/var/run`→`/run`, `/var/lock`→`/run/lock` | **confirmed** — www-data cannot claim a restart marker there |
| D6 | **QRTR present** (`CONFIG_QRTR=y`, QIPCRTR in protocols, `qrtr-ns` running). Modem is node 3; WDS/DMS/NAS/UIM/WMS published. ~20 vendor daemons hold presumed-QRTR sockets | QMI lane **feasible on RM520N-GL as root**; www-data QRTR access untested (only matters for the in-process QMI fallback) |
| D7 | `rmnet_ipa0` + `rmnet_data0..5,15,16`; default route on `rmnet_data0` | same names as RM551E — data-call lane feasible |
| D12 | an idle second opener on smd11 for 20 s: `qcmd ATI` and `sms_tool status` both answered normally; nothing holds smd11 between commands today | idle multi-open is safe; a *reading* second opener is untested — cover in the T2 broker smoke test |
| D2 | www-data is in `dialout`; smd11 `root:dialout 660` | confirmed — admit www-data on the socket |
| new | BusyBox `flock` has no `-w`; `/usrdata` and `/opt` are one UBIFS volume, 88.9 MB free | timed waits stay on the `flock -x -n` retry loop |

Lead reading (not yet a GO/NO-GO — that waits for T0.2 + P1 numbers): no blocker found for the AT,
QMI or data-call lanes on the RM520N-GL.

| T0.1 | 3 | independent Opus session r3 | r3 | DONE_WITH_CONCERNS (RG501Q offline) | 7 questions, raw capture | .orchestra/scratch/atd-T0.1-report.md |

## T0.2 result — RM520N-GL, 2026-10-26
Report `.orchestra/scratch/atd-T0.2-report.md`, raw `.orchestra/scratch/atd-T0.2-rm520n.txt` (gitignored).
Measured with the dashboard closed; poller running throughout.

| metric | value |
|---|---|
| `qcmd AT` per call | wall median 45 ms, CPU 40 ms |
| locked `atcli_smd11 AT` per call | wall median 16 ms, CPU 17 ms |
| fork floor (`/bin/true` in the harness) | CPU 12 ms |
| qcmd CPU above floor | ≈ 28 ms: atcli spawn ≈ 5 ms, the qcmd shell wrapper ≈ 23 ms |
| poller | 947 ms CPU per 3.25 s cycle = **29.1 % of the core**; 85 % of it in children (forks) |
| qcmd calls per cycle | 2.53 (from code) |
| transport share of poller CPU | 7.6–10.8 % (≈ 2.2–3.1 % of the core); atcli spawn alone ≈ 1.3 % |
| lock busy / `modem_busy` | ≈ 1 % (code estimate; sampled 0.2 %) / 0 of 30 |
| `sms_tool status` | 18 ms wall, 18 ms CPU |
| memory | 54.6 MB available of 182.5 MB; poller RSS 6.9 MB |

Lead reading: on CPU the broker can win at most ~3 % of the core, and most of that comes from replacing
the **shell `qcmd` wrapper** with a native client, not from removing the atcli spawn. The poller's own
forks (~26 % of the core) are P1's target. A resident broker is a net memory addition. Contention under
UI load (the broker's other claim) is still unmeasured — measure it in T1.2 with the dashboard open.

## T0.3 result — 2026-10-26
Built with rustc/cargo 1.99.0 on the Windows host: `rustup target add armv7-unknown-linux-musleabihf`,
`cargo build --release --target armv7-unknown-linux-musleabihf` with `rust-lld` + `crt-static` (now
pinned in `.cargo/config.toml` and `rust-toolchain.toml`; `Cargo.lock` committed). 662 328 B ELF32 ARM
EABI5 static, stripped, md5 `735c4144…`, 20 s clean build, 2 dead-code warnings (upstream).
On RM520N-GL (serial 61368cd2) from `/tmp`: `qmanager_atd --version` → `qmanager_atd 0.6.1 proto=3`
rc 0; `--bogus` → usage, rc 2. No daemon run, no socket created, binary removed. Idle daemon RSS is
owed by the T2 smoke test. Vendoring note: the three build files are RM520N-local additions to the
otherwise byte-identical crate.

| T0.2 | 1 | independent Opus session | r1 | DONE_WITH_CONCERNS (no UI load) | 6 measurements | .orchestra/scratch/atd-T0.2-report.md |
| T0.3 | 1 | lead | — | DONE (RSS deferred) | build + `--version` on device | this section |
| T1.2 | 1 | lead (soak session) | — | DONE_WITH_CONCERNS (slow CPU and RSS drift; 3 AT ERRORs) | ~11 h soak + dashboard replay | this section |
| T1.2 | 2 | lead | — | DONE (leak cause found; AT ERRORs = scenario timer) | heap read + isolated bash 3.2 `read` probes on device | T1.2 result, Concerns |
| G1 | 1 | user (G1 side session prepared the page) | — | GO, P6 shell tiers before P4, T6.2 added | numbers checked against T0.1–T1.2 sections; no device run | Decisions taken |

## QMI probe result — RM520N-GL, 2026-10-26
Tool: `native/qmi_probe` (RM551E probe ported to armv7, commit 73c06e34); full table in
`docs/reference/qmi-probe.md`. Serial 61368cd2, read-only plus client-local WDS binds.

| item | result | effect |
|---|---|---|
| NAS/DMS/UIM/WDS-profiles/DSD reads RM551E uses | all OK, 17 reads ~15 ms | P7 codec ports as is |
| NAS 0x005A Tx/Rx | NOT_SUPPORTED (same as RM551E) | per-antenna stays AT |
| WMS list 0x0031 / raw read 0x0022 | OK, ~1 ms / ~4 ms, tag unchanged | input to decision 3 (T5.1) |
| WDS 0x002D / 0x0024 bound (mux 1, IPv4) | OK; matches CGCONTRDP and `/proc/net/dev` rx | added to T7.1 |
| www-data opens `AF_QIPCRTR` | OK (NAS, UIM, WMS) | in-process QMI fallback works without root; any www-data process can read SMS over QMI (it already can via `dialout` on smd11) |
| LOC, SAR, PDC, VOICE | published, answer 0x001E | not in scope |

| QMI | 1 | lead | — | DONE (RG501Q not run) | probe on device, root + www-data | docs/reference/qmi-probe.md |

## T1.2 result — RM520N-GL, 2026-10-27
Read-only soak on serial 61368cd2, 2026-10-26 20:40 → 2026-10-27 08:42 (≈ 12 h, 153 samples, 26 CPU windows of 300 s).
Raw: `/tmp/t12/{soak,cpu}.log` on the device (not copied to the repo). Poller build = T1.1 final.

| metric | result |
|---|---|
| restarts | poller pid 10730 and ping pid 1224 unchanged, NRestarts 0; device uptime unbroken |
| status.json | 153/153 valid; age ≤ 4 s; last_successful_poll age ≤ 4 s; `system_state` always `normal` |
| history files (signal, ping, events, sites) | 0 bad NDJSON lines in any sample |
| data_used | schema 6 throughout; age ≤ 32 s; rx/tx never decreased |
| CPU per cycle | min 353 / median ≈ 371 / max 379 ms (T1.1 final 344; before T1.1 874) |
| poller core share | 13.1 / ≈ 13.9 / 14.2 % (before 27.4 %) |
| system busy | 23.3 – 34.3 %, median ≈ 23.8 % (the 34.3 % is one window, soak7, early; dashboard replay in the brief gave 38.5 %) |
| poller RSS | 2408 → 2960 kB (+552 kB, steady ≈ 46 kB/h) |
| MemAvailable | 52.0 – 59.3 MB, no downward trend in the final samples (58.4 → 57.5 MB first to last) |
| load1 | max 2.31 |
| AT lock | busy ≤ 3 %, mean 0.4 %; 0 "Lock acquisition failed" |
| WARN/ERROR after 20:40 | 3 ERROR, 0 WARN: `AT+QRSRP;+QRSRQ;+QSINR` rejected at 22:00:24 and 06:00:20; `AT+QNWCFG="lte_time_advance";…"lte_mimo_layers"` rejected at 06:00:22. The 2 older WARN lines are from boot (18:53/18:54) |
| dashboard open (replay, from brief) | poller 339 ms / 12.7 % unchanged; system 38.5 % vs 25.7 % closed (CGI forks) |

Concerns, not blockers:
- **RSS leak, cause found (corrected 2026-10-27; the ping-history guess was wrong — the poller only
  appends to that file and keeps a line counter, never reads it back).** Growth is in bash's heap and
  stays linear at ≈ 45 kB/h (2408 → 2960 → 3388 kB at 20:40 / 08:38 / 18:27). Bash 3.2 leaks ≈ 17 B
  every time `read` puts more than one word into its last variable under the default IFS (isolated
  40 000-call probes on the device: 17 B/call; `IFS= read` or an exact field count: ≈ 1 B/call, noise).
  Two per-cycle reads in `poll_cycle` hit it: `update_proc_metrics` (`qmanager_poller:606`,
  `_pm_tail` gets `guest guest_nice` from `/proc/stat`) and `update_system_health`
  (`:782`, `_rest` gets `1/383 29191` from `/proc/loadavg`). 2 × 17 B × ≈ 1350 cycles/h ≈ 46 kB/h,
  matching the soak. Both lines predate T1.1 (2026-05-11, 2026-09-02), so the old poller leaked too.
  ≈ 1.1 MB/day, unbounded until the poller restarts. **Fixed 2026-10-27:** both reads now take the
  line with `IFS= read -r` and split with `set --`; same values on device, probe 1 B/iter vs 32 B old;
  blind verifier PASS after one fix (`_pm_tail` kept local). Deployed 19:32 (md5 `0449ef11`), poller
  restarted with the user's OK; RSS 2360 → 2396 kB over the first 25 min (warm-up), one-hour check pending.
  One-hour check (19:33–20:48, 16 samples, pid 10560, NRestarts 0): 2396 kB flat 19:53–20:13, one
  +68 kB step at 20:18, then 2464 kB flat to 20:48. The old leak would have added ≈ 4 kB every 5 min
  (≈ 40 kB over 19:53–20:48) as a steady ramp; the single step reads as a one-off allocation. Leak fixed.
- CPU per cycle rises slowly (≈ 353 → 379 ms, ≈ +7 % over 12 h). Likely the same leak: each fork
  copies a larger parent. Not proven; re-measure after the fix.
- The three AT rejections (22:00, 06:00) are explained: `qmanager-scenario-schedule.timer` fires at
  06:00 and 22:00 and switches network mode; the per-antenna query hits the modem mid-switch. Not a
  poller defect.

### G1 input (the decision is the user's)
- Poller CPU is now ≈ 13–14 % of the core, down from 27–29 %, and held for 12 h with no restarts, no corrupt data and no AT lock failures.
- The broker's CPU gain is small: about 2.5–3 points of the core (saves ≈ 28 ms of the 40 ms `qcmd` cost × ≈ 2.5 calls/cycle). It also adds a resident process on ≈ 55 MB free.
- Its real case is not CPU: retiring `atcli_smd11`/`sms_tool` (already decided), shorter AT lock holds (the 6.8 s SMS inbox read), and the QMI lane (probe passed).
- The biggest remaining CPU levers do not need the broker: activity tiers (P6, shell-only) and the dashboard CGI fork cost (+13 points of system busy while the dashboard is open), which no phase covers yet.
- Unmeasured: AT contention under UI load with SMS reads; whether fixing the `read` leak also stops the CPU drift.

## Side task: RM520N LAN subnet (2026-10-28, merged 12221fef)
Outside the atd port, done on request. The factory /22 (192.168.225.1, 224.0–227.255) overlapped the user's RM551E at 192.168.224.1 on Tailscale. The mask is now /24 on install/OTA, factory value only, once (marker `/usrdata/.qm_lan_subnet_set`); there is a LAN card and a root apply helper. Device proof on 61368cd2: bridge0 192.168.225.1/24 after reboot, DHCP .20–.170, CGI and web UI OK; verifier PASS_WITH_NOTES. Tailscale route is now 192.168.225.0/24 on GL-X2000. Device left on the lan-subnet build (T3.1 + T6.2 code + LAN). Not run: full installer/uninstaller end to end, real LAN save through sudo.
