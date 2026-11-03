# Run: Port qmanager_atd + broker-backed poller from RM551E to RM520N
status: port DONE (P0–P9 merged); residue boards R1–R7 merged, S1–S6 merged 2026-11-02; S5 device proofs running
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
| T4.1 | P4 | qcmd cut-over + error-contract adapter + full caller census (incl. Discord bot) | cgi-endpoint-builder | `scripts/usr/bin/qcmd`, `client/qcmd.rs` | **DONE + merged 2026-10-28 (baa5fa5a, branch HEAD f3ffe189)** (plan `2026-10-26-atd-port-T4.1.md`): RM520N `qcmd` = broker client with the shell error contract, broker boot-linked + started; proto-gated broker use (9bcfd5d0). Auditor CLEAR, verifier A3 fixed, device lifecycle PASS (OTA fwd, mismatch, reboot order, v0.1.17 rollback + reboot, OTA fwd, uninstall, fresh). Split out: T4.3 lock-dir hardening |
| T4.2 | P4 | Portability residue on both devices | busybox-portability-checker | none | **DONE + merged 2026-10-28 (fa7e8e75, ff)** (SAFE TO SHIP, 0 fixes; `2026-10-26-atd-port-T4.2.md`) |
| T5.1 | P5 | qsms port + retire `sms_tool` / `atcli_smd11` — **transport = QMI WMS (decision 3); planned after T5.0** | cgi-endpoint-builder (installer part under installer-safety-auditor) | sms CGIs, `qmanager_sms_*`, `sms_alerts.sh`, `qmanager_health_check`, `build.sh`, `install_rm520n.sh`, `uninstall_rm520n.sh` | **S1–S5 DONE + merged 2026-10-28** (4024c6a2, branch HEAD 1323988a): SMS Center CGI, alerts, forwarding test, storage oneshot, forwarder (watch wake-up) and health check on `qsms`; `sms_tool` copy dropped. Forwarder key storage|sender|ref|total with a 24 h window. Sends: 7 of 8 segments, send_test as www-data delivered (ME 160), forwarder forwarded once (ME 161), loop guard held. busybox SAFE (RM520N; RG501Q audit only), verifier r2 PASS_WITH_NOTES. Nothing deployed; device restored. Open: forced watch reconnect (next natural reboot), RG501Q S0 (offline), S6 after T4.1; notes: CGI merge has no time split on ref reuse, retry after partial multi-part failure can duplicate early parts, compose dialog over-counts UCS-2 parts, RG501Q watch logs `unsupported` per respawn, plan §4 `bad_args` vs code `bad_number`/`message_too_long`. PLAN r2 APPROVED 2026-10-27 (`2026-10-26-atd-port-T5.1.md`; Q1 yes). **S1 DONE + merged 2026-10-28** (979bcb33): WMS backend device-proven (parity 134=134, tag round-trip, watch saw ME 148); binary md5 `ecad8a40` tracked at `dependencies/qmanager_atd`. Probes 2026-10-28 (73d829fe): empty list = success count 0; mem3 = same setting as 0x0033 (keep one CPMS self-heal); local delete PASS; network send BLOCKED by carrier (RP cause 21 / CMS 350, likely no SIM credit) so 2-part + UCS-2 delivery unproven; forced watch reconnect deferred (needs qrtr-ns restart/SSR, drops data call) to the next natural reboot. Send proofs in S2–S4 need SIM credit; S2–S5 land with/after T3.1; S6 after T3.1 + T4.1. **S6 DONE + merged 2026-10-29 (879eabf8, branch HEAD 86b7dbcf); RG501Q-EU in-process qcmd on the 6b328dd8 binary still unchecked, gates T8.1 and any release for RG501Q users:** sms_tool + atcli_smd11 retired on every model, qcmd = qmanager_atd link everywhere; RM520N lifecycle PASS (OTA fwd, rollback v0.1.17, uninstall, fresh); RG501Q in-process qcmd unverified (follow-up). Plan + results `2026-10-26-atd-port-T5.1-S6.md` |
| T5.0 | P5 | WMS probe: send, delete, new-message indications, storage, as root and www-data; extend `native/qmi_probe` | independent Opus session | `native/qmi_probe/**`, `docs/reference/qmi-probe.md` | DONE 2026-10-27: **GO** for list, read, send, delete, tag, indications, multi-part receive, www-data; network proof of a multi-part send owed (SIM out of credit). Findings + T5.1 design inputs in `2026-10-26-atd-port-T5.0.md`; merged |
| T6.1 | P6 | Activity tiers + heartbeat + watchcat outside AT gate | cgi-endpoint-builder + ui-builder | poller, `qmanager_watchcat`, `qmanager_health_check`, heartbeat hook | DONE 2026-10-27 (plan `2026-10-26-atd-port-T6.1.md`): poller % of core active 12.9 / idle 8.1 / deep 6.0 (was 14.0); system busy deep ≈ 15 % (was 22.8); status.json shape diff 0 (4 additive keys); verifier PASS_WITH_NOTES; merged. **Soak PASS 2026-10-28** (11.9 h, 10-27 22:05→10-28 09:58): 0 restarts, 0/137 bad samples, poller RSS 2420→2376 kB, deep 126 ms/cycle 5.9 % core, active 346 ms 13.2 % (07:46–08:57, user's own dashboard, real use); excluded T6.2 load 23:23–23:36; 02:16–02:32 power cut, not a fault; MemAvailable 64.0→54.9 MB system-wide, watch. Owed: 1970 cold-boot proof, RG501Q-EU; open: verifier notes 2–4 (incl. watchcat stop timeout, pre-existing) Follow-up (flagged by automated review 3×, 2026-10-28/29): `overview.sh` / `fetch_data.sh` write `/tmp/qmanager_ui_active` with `>` (no symlink guard); www-data CGI, root is the only other account, so low risk; `/var/run/qmanager` is root-only, so the suggested move does not fit as written |
| T6.2 | P6 | Dashboard CGI cost: +13 points of the core while the dashboard is open (T1.2 replay, 38.5 % vs 25.7 % busy); measure per-CGI cost, then cut forks | lead (plan first) | TBD in its plan | **DONE + merged 2026-10-28** (c55a0046): dashboard adds 1.4 points of busy, was 15.1 (closed 20.9 %, open 22.3 %); CGI share 12.5 → 1.4 %; request floor 39 → 15 ms; forks/request 19 → 2; busybox SAFE, verifier PASS_WITH_NOTES. Backend-only deploy, restored to T3.1 tree 11:08:27; artificial active load 10:43:35–11:08:27. Not measured: 1 MB ping-history cut, lighttpd keep-alive CPU, hidden tab on device. Follow-ups: 2 s useModemStatus default on other pages, lighttpd keep-alive, settings/about one-shot cost, qlog.sh:28 set -u |
| T7.1 | P7 | QMI lane + sidecar + overlay + types; add bound WDS 0x002D (IP/DNS/gateway/netmask/MTU) beside RM551E's bound 0x0024 | cgi-endpoint-builder + ui-builder (types) | `native/…/qmi/**`, `qmi_merge.sh`, `types/modem-status.ts` | **DONE 2026-10-29; MERGED into development as 7511dd70 (`--no-ff`, branch tip 39d9b3f8; router-row conflict resolved keeping both rows); not merged** (plan `2026-10-26-atd-port-T7.1.md`): base lane + bound WDS 0x002D, no live 1 Hz. Broker 0.7.0 (binary a4e157ca) publishes `wds.settings`; poller adds `network.wds`, `lte.source`, `device.qmi_*`/`at_read_mono`; QMI feeds lte.rsrp/rsrq/rssi only when QENG is missing (idle/deep). Sidecar ≤ 2 s old; byte identity with QENG present; WDS = CGCONTRDP. **Soak PASS** 8.0 h: 0 restarts, SSR 0, 0 bad samples, source qmi 94/97 in deep, poller RSS +8 kB. CPU: poller deep 6.16-6.32 % (+0.36 vs 0.3 budget, accepted), broker 0.66 %. busybox SAFE, verifier PASS_WITH_NOTES. Device runs the pre-24f5a44c lib (state-order fix untested in soak). Unproven: IPv6, live 0x002D client refusal, active-tier overlay, SSR recovery |
| T8.1 | P8 | RG501Q-EU validation, lift installer skip | busybox-portability-checker + modem-investigator | `install_rm520n.sh`, `platform-matrix.md` | **DONE + merged 2026-10-29 (ff 11eb619a; see end of row).** Read-only scan DONE 2026-10-28 (47692d88, `2026-10-28-rg501q-port-scan.md`): no blocker; QMI, WMS reads, broker preconditions and BusyBox 1.29.3 residue match. Owed, user OK: broker daemon smoke (blocks the skip lift), `qsms` WMS write + indication proofs, then widen `qm_hw_atd_enabled` and `use_wms()` to `RG501Q*`; **2026-10-29 T8.1 worker (branch `claude/t81-rg501q-parity-fb6ce1`):** parity PASS on RG501Q-EU b7e3d6f1 (user OK: install the latest build there). (a) 0.7.0 in-process qcmd vs old shell qcmd: byte-identical stdout on 7 queries (QENG differs only in live RSRQ/RSSI), same error contract (rc 1, `ERROR: command_failed`), same lock wait, www-data OK. Installed development as-is (OTA path, from v0.1.14-draft): rc 0, unit skipped, 55/55 read CGIs 200+JSON, poller AT-source. Then widened `qm_hw_atd_enabled` + `use_wms()` to `RG501Q*` (atd 0.7.1, md5 e6ee48bc, 301 tests pass) and reinstalled: (b) broker up under systemd 239 Type=notify, socket root:dialout 0660, proto=3 qmi=1, no watchdog restart in 40 s, kill -9 restart OK, RSS 560 kB, qmi.env/json match AT; (c) status.json valid, `lte.source` qmi, `qmi_state` up, `network.wds` populated (= RM520N-GL shape). busybox SAFE TO SHIP, installer-safety-auditor CLEAR (rollback source-traced). No soak/SMS tests (user). Open: RG501Q has no `xmllint` (LAN Address card `lan_read_failed`); installer banner hardcodes 192.168.225.1; RG501Q alert routing sends SMS on connection_lost (carrier rejects, CMS 350); device left on the T8.1 build. RM520N-GL SSH unreachable during the run (compared against an earlier capture). **MERGED 2026-10-29: fast-forward to 11eb619a (code 462afec9, docs 15159e90, release notes 11eb619a folded into v0.1.18-draft by user decision).** RG501Q-EU alert SMS for connection_lost/reboot turned off (user OK); device keeps the T8.1 build. Not tested on RG501Q by user decision: soak, SMS send, incoming SMS. Follow-ups: no `xmllint` on RG501Q (LAN Address card `lan_read_failed`), installer banner hardcodes 192.168.225.1, OTA from v0.1.14 leaves sms-forward `failed` once. |
| T9.1 | P9 | Docs + router + release notes | docs-writer | `docs/reference/**`, `RELEASE_NOTES.md` | **DONE 2026-10-29; MERGED into development by fast-forward to 801f52f9**: docs sweep eadf23b8; unused `qmanager_at.pid` seed + stale shell-qcmd comments dbd27547 (user asked); T7.1 synced 34d60c67; v0.1.18 notes with the RG501Q-EU wait note, wording approved by the user. Installer gives RG501Q no warning and OTA has no model check (notes folder `T9.1-docs-census.md`) |

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
2. ~~**QMI / live / WDS scope (P7)**~~ — decided 2026-10-29: base lane (2 s sidecar, overlay only when QENG missing) + bound WDS; live 1 Hz NOT in scope.
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

## PM board — residue after T9.1 (opened 2026-10-31)
The main session is PM; one orchestrator session per task, each with its own `.orchestra/runs/2026-10-31-<id>.md`. Only the PM edits this file. Device writes are serialized through the PM.

| id | task | session | file set | status |
| --- | --- | --- | --- | --- |
| R1 | T4.3 lock-dir hardening + T3.1 leftovers (wants-link rm, hw_profile guard, Step 11/10 doc nit) | t43-lockdir | crate, `dependencies/qmanager_atd`, `qcmd`, `qmanager_setup`, `qmanager_health_check`, install/uninstall/OTA | RUNNING: base reset to 5b985b4f before any write; plan r1 `2026-10-31-t43-lockdir.md`, auditor + advocate running, then user OK stop. RM520N-GL still on atd 0.7.0 (a4e157ca), RG501Q on 0.7.1 (e6ee48bc) |
| R2 | SMS: ref-reuse merge, partial-retry duplicates, UCS-2 part count, error-code doc, RG501Q connection_lost SMS default | sms-fixes | SMS CGIs, `qmanager_sms_*`, `sms_alerts.sh`, SMS UI, locales | RUNNING |
| R3 | T6.2/T6.1 residue: `useModemStatus` 2 s default, lighttpd keep-alive, settings/about cost, `qlog.sh:28` set -u, `ui_active` symlink guard | cgi-cost | status hooks, overview/fetch_data/settings/about CGIs, `qlog.sh` | RUNNING |
| R4 | RG501Q LAN card without `xmllint` | rg501q-lan | LAN CGI + apply helper | RUNNING: awk reader aea25f87; device slot GRANTED both devices 2026-10-31 (user yes, leave new lib) |
| R5 | Installer UX: banner hardcodes 192.168.225.1, no RG501Q warning / OTA model check, OTA from v0.1.14 leaves sms-forward `failed` once; crate: RG501Q watch logs `unsupported` per respawn; crate fix for R2 item 2 if needed | — | installer + crate | QUEUED until R1 merges |
| R6 | Device proof campaign: 1970 cold boot (T6.1), T7.1 IPv6 / 0x002D refusal / active overlay / SSR / 24f5a44c soak, SMS forced watch reconnect + multi-part/UCS-2 delivery (needs SIM credit), AT contention under UI + SMS load, manual broker start, stale wants-link | — | none (read-only + user-approved reboots) | DONE + MERGED 30304531 (2026-11-01); results `2026-10-31-r6-proofs.md` |
| R7 | Investigate the proper RG501Q-EU LAN subnet change method (device is on 192.168.120.1); findings feed R4 | rg501q-subnet | none (read-only, shared checkout) | DONE 2026-10-31: 120.1 = hand XML edit 2026-08-25; `AT+QMAP="LANIP",start,end,gw,0` + reboot is the vendor path (no mask field); findings `.orchestra/scratch/2026-10-31-rg501q-lan-subnet.md`, relayed to R4 |

### PM log (append-only)
- 2026-10-31 R1: auditor gate-before BLOCKED, 2 must-fix (BusyBox `flock` has no `-w`, so the planned drain wait fails; second item in the session's plan file); revising plan with the advocate findings before the user OK stop.
- 2026-10-31 R2: busybox SAFE TO SHIP on both devices; blind verifier pending.
- 2026-10-31 R3: hook default 2 s → 5 s; PM approved edits to 5 components outside its set (antenna-alignment stays 2 s; cellular-settings, network-priority-card, custom-profile, step-band-locking → 10 s), on the condition that the T6.1 heartbeat window exceeds 10 s.
- 2026-10-31 R4: user approved the deploy in-session; aea25f87 deployed to both devices, md5 match, LAN card data loads on RG501Q-EU as www-data; blind verifier pending.
- 2026-10-31 R1: plan r2 APPROVED by the user in-session ("Approve r2"); building. T3.1 leftovers found already shipped in T4.1 (baa5fa5a). New follow-ups for the PM: move `/tmp/qmanager_long_running` into `/run/qmanager_at/`; `lighttpd.service` lacks `After=qmanager-setup.service`; stale `/tmp/qmanager_at.lock` comments in 7 files.
- 2026-10-31 R4: DONE + MERGED into development by fast-forward to becd9d54 (fix aea25f87). busybox SAFE both, verifier PASS_WITH_NOTES. Not run: real apply + reboot. Haiku cleanup of the worktree dispatched.
- 2026-10-31 R4 housekeeping: worktree unregistered + pruned, branch deleted with `-d`; empty folder left, held open by the idle rg501q-lan session (removable once it is archived).
- 2026-10-31 R1: security review of the uncommitted diff found root chown/chmod/create on names inside the dialout-writable 2770 `/run/qmanager_at` (symlink → LPE; bridge marker spoofable). Sent as must-fix: dir 0750/2750 root-only entries, root pre-creates lock, no CGI-side create, `bridge` trusted only if root-owned.
- 2026-10-31 R2: DONE + MERGED into development (95e28f70, --no-ff; code f0fa602c, docs dd67a986). busybox SAFE both, verifier PASS_WITH_NOTES (2 low: interleaved same-ref within seconds still misgroups; duplicate part with different timestamps loses a read mark once). PM gate: `tsc --noEmit` exit 0 on merged development. User kept the RG501Q alert-routing defaults. Not proven: partial multi-part send failure on air (SIM credit), CGI through lighttpd, dialog in a browser. Carried to R5: `qsms send --ref --from` resume of the missing parts (crate).
- 2026-10-31 R4/R7 sessions archived (user OK); empty R4 worktree folder removed.
- 2026-10-31 R1 r3: symlink must-fix already fixed by the session (65d841a8 crate + binary md5 90592930 broker 0.7.2; 6188b6eb shell): dir root:dialout 0750, lock 0640, root-only creation, bridge trusted only if root-owned. PM decision: lighttpd `After=qmanager-setup.service` moved INTO T4.3 (T4.3 causes the boot modem_busy window; cycle-free). Auditor, busybox and verifier running on r3.
- 2026-10-31 R2 housekeeping: session archived, worktree removed, branch deleted with `-d`. qsms resume plan saved at `.orchestra/scratch/sms-fixes-qsms-resume-plan.md` → R5.
- 2026-10-31 R1: auditor verify CLEAR (stale comment fixed 2deeb2b1; delta on eebec007 re-running), busybox SAFE both, cargo 306 pass, broker 0.7.2 md5 90592930; lighttpd After=setup + setup 60 s timeout (eebec007). Device proof (RM520N-GL, 7 steps + reboots + v0.1.17 rollback) GO from PM under user-delegated approval, conditional on: verifier pass + auditor delta CLEAR; development merged into the branch before the tarball; cgi-cost releases the device slot; 5-min post-boot check that `/tmp/qmanager_at.lock` is not recreated; stop at first surprise.
- 2026-10-31 R3: committed f2c85129; busybox pass both after one fix; verifier running; device files /tmp/cgicost only. Holds the RM520N-GL slot until its verifier finishes.
- 2026-10-31 R3: DONE + MERGED into development (a379b63d, --no-ff; f2c85129 + 861c4eeb). PM gate `tsc` exit 0. Rates: alignment 2 s, default 5 s, config pages 10 s (worst heartbeat age ≈ 14 s < 20 s grace). settings.sh 57→15 forks, 276→83 ms; ping history ≈1.8→0.25 pts with ?last=400; `ui_active` `[ -L ]` guard; qlog.sh set -u fixed. Verifier A2/A6 FAIL on "byte-identical" for 10/35 edge configs (`-n`/`-e` hostname, trailing newlines, object values, two-doc files, multi-line days): PM ACCEPTED the new behaviour as fixes, claim corrected in 861c4eeb. Not run: CGIs through lighttpd, hidden tab on device. Session archived; device slot handed to R1.
- Carried to R5: lighttpd `server.max-keep-alive-idle = 30` (≤1.1 pts, `scripts/usrdata/qmanager/lighttpd.conf`); cache the public IP in about.sh; health check `stat -c %U` reads a symlink's own owner; settings.sh still reads retired `low_power_*` keys.
- 2026-10-31 R1: verifier PASS_WITH_NOTES (88560244); development a379b63d merged into the branch; atd 90592930, tarball 3cbaeff3; device untouched (atd a4e157ca). Session context-handed-off (same id). PM decision: fix `live.rs` scan_up untrusted long flag before the proof (rebuild + delta re-verify); the by-hand rollback stays a documented residual unless step 4 shows otherwise.
- 2026-10-31 R1: scan_up fix 9f9126e3 (atd 6b0026d4, tarball a7562894), cargo 307 pass user + root, delta re-verify PASS_WITH_NOTES. Device proof GO once the auditor delta on eebec007 is CLEAR. Carried to R5 (long-flag move): shell readers of `/tmp/qmanager_long_running` still trust any file (`[ -f ]`).
- 2026-10-31 Side fix: RG501Q GUI dead over HTTPS. qmanager_firewall half-built its chain at boot (xtables lock held by QCMAP, no `-w`, exit codes ignored). Fixed on claude/exciting-hamilton-3284b0: `-w 5`, 3 retries, safe-prefix rule order (WAN drops first, catch-all last), failure exits non-zero. PM chose the safe-prefix option over "leave no chain". MERGED 5d64b87c; branch and worktree cleaned.
- 2026-10-31 R1: device proof step 5 (UI OTA) deadlocked on eebec007's lighttpd `After=qmanager-setup`. PM decision: drop the edge (db81d2d5) on condition of fail-closed qcmd with no dir (proved: `modem_busy`, no fallback). Console start `--no-block` (7cfa9486). Steps 4–7 + final reboot PASS (tarball 63fb57b1); firewall fix also proved on RM520N-GL. Verifier PASS_WITH_NOTES. MERGED 6a47198a. RM520N-GL now on v0.1.18-draft; /usrdata/t43 holds the proof logs.
- Carried to R5: long flag into /run; stale lock comments (apn_apply, cfun_fix, neighbour_scanner, cell_scan_start, neighbour_scan_start); OTA status page loses lighttpd between the restart and the reboot (predates T4.3).
- 2026-10-31 R5: MERGED 9400643f (merged by the R5 session on the user's word). Broker 0.7.3 (atd a643c60b), cargo 317 user + root. Long flag at `/run/qmanager_at/long_running`, root-only trust; scanner early write dropped. sms-forward OTA stop ~1 s (was 90 s, KILL + scoped reset-failed); lighttpd restart deferred to the reboot inside lighttpd's cgroup; qsms `--ref/--from` resume, retried only when not ambiguous and sent_parts > 0. Gates: auditor CLEAR, busybox SAFE both devices, verifier FAIL→fixed (ambiguous part-1 retry), stub run 5/5. Proofs (c)+(d) PASS on RM520N-GL. Tarball 342cb82a predates the retry fix — rebuild before R6. Logs `/usrdata/r5/`.
- Carried to R6: real `--from 2` SMS (user SIM credit + recipient); RG501Q-EU still on atd 0.7.1 (needs this OTA); 1970 cold boot T6.1; T7.1 IPv6/0x002D/overlay/SSR/soak; SMS forced reconnect + multi-part/UCS-2; AT contention under UI + SMS load; manual broker start, stale wants-link; real LAN apply + reboot.
- Follow-ups (not R6): RG501Q log spam (79x QNWCFG lte_time_advance ERROR, 7x QRSRP, 82x "Internet unreachable" / 33 h); systemd-run updater outside lighttpd's cgroup (sudoers); UI rollback still runs the target's installer; cargo flake `client::qmi::tests::the_broker_failing_in_any_way_falls_back` (300 ms floor, qmi.rs:200).
- 2026-11-01 R6: MERGED into development 30304531 (--no-ff, user's word). PASS: 1 (RG501Q OTA 0.7.4), 3b, 3c, 3e soak (97/97 clean; RM520N same PIDs 21 h; CPU atd 0.64 %, poller 6.99 %), 4 receive (3-part UCS-2 + emoji, watch + CGI merge), 5, 6 (hand start + wants-link both ways, 2 reboots), 7. Partial: 2 (no OnCalendar timer armed). Not run: 3a (no carrier IPv6), 3d SSR and 4 forced reconnect (drop the data call), 8 (no real SMS). Code in the merge: broker 0.7.4 (atd 23be0cb4, channel-down backoff) proven on RG501Q only; RM520N-GL still runs 0.7.3 a643c60b; poller QMAP guard; T-A profile fail-closed + once-per-boot gate passed busybox + verifier but is NOT device-proven. Incident I1: an R6 proof log filled /usrdata (= /etc, one UBIFS) for ~45 s; QCMAP wrote two 0-byte XMLs, restored from factory_* (user yes), regenerated by QCMAP at the next boot.
- Carried from R6: T-B reused-PID kill (`bands/failover_toggle.sh`, `bands/lock.sh`); T-C central `+QMAP` broker guard; `apn.sh` `write_setting_json` leaks its temp file on a failed write; T-A and 0.7.4 on the RM520N-GL with the next tarball.

## PM board — residue after R6 (opened 2026-11-02, base c2b39b37)
Same rules as the R board: the main session is PM and the only editor of this file; one session per task with its own `.orchestra/runs/2026-11-02-<id>.md`; device writes (deploys, restarts, reboots) go through the PM one device at a time; every merge is the user's word.

| id | task | seat | file set | status |
| --- | --- | --- | --- | --- |
| S1 | T-C central `+QMAP` broker guard + cargo flake `the_broker_failing_in_any_way_falls_back` | orchestrator session s1-qmap-guard | `native/qmanager_atd/**`, `dependencies/qmanager_atd`, `at-command-transport.md` | DONE + MERGED 44f487e3 (atd 0.7.5 d5b06114) |
| S2 | Updater via `systemd-run` outside lighttpd's cgroup; UI rollback runs the target's installer | orchestrator session s2-updater-cgroup | `system/update.sh`, `qmanager_update`, sudoers drop-in, install/uninstall/OTA | DONE + MERGED 4b831829 (ff) |
| S3 | RG501Q-EU log spam: QNWCFG `lte_time_advance` ERROR, QRSRP ERROR, "Internet unreachable" | orchestrator session s3-rg501q-logspam | poller, `qmanager_ping`, `parse_at.sh` (as the plan decides) | DONE + MERGED 08ce31a9 |
| S4 | T-B reused-PID kill (`pid_is` in `platform.sh`) + `apn.sh` `write_setting_json` temp leak | Sonnet high-effort worker (PM gates) | `platform.sh`, `bands/failover_toggle.sh`, `bands/lock.sh`, `qmanager_band_failover`, `qmanager_profile_apply` | DONE + MERGED c48658f3 |
| S5 | Device proof campaign 2: next tarball on RM520N-GL (atd 0.7.4 + T-A + S1–S4), SSR recovery, SMS forced reconnect, 1970 boot with an armed OnCalendar timer, multi-part send (needs SIM credit), IPv6 (no carrier v6) | orchestrator session | none (read-only + user-approved steps) | RUNNING (session s5-device-proofs) |
| S6 | qcmd quiet-read option so expected-failure reads (TA/QRSRP on a flapping link) do not log ERROR; poller uses it on the S3 reads | orchestrator session s6-qcmd-quiet | `native/qmanager_atd/**`, `dependencies/qmanager_atd`, `qmanager_poller` (those reads only) | DONE + MERGED b4e22af1 (atd 0.7.6 b2441f56) |
| S7 | F2 fix: `+QMAP` after a QCMAP restart wedges smd11 on the RM520N-GL (S5 proof 2; same wedge as R6 F1); make the guard cover a restarted QCMAP | orchestrator session s7-qmap-restart | `native/qmanager_atd/**`, `dependencies/qmanager_atd`, `qmanager_poller` `qcmap_up` | RUNNING (local_ab227d74, started by the user) |

### PM log (append-only)
- 2026-11-02 Board opened from the R6 carry list. S1 takes the cargo flake because it shares the crate file set. Lower-value items kept out of the board: none.
- 2026-11-02 S4: worker committed fd5f490d (branch worktree-agent-a79f6c6bfec84fa71): `pid_is` in platform.sh, both CGIs kill on match with TERM, cgi_base.sh stub returns 1. Isolated pid_is tests pass on both devices, sh + bash, as root. apn.sh temp leak NOT present in current code (write and mv failures both rm the temp); the 2026-11-01 0-byte temp is likely a failed UBIFS delete on the full volume or a killed CGI — no change. Blind verifier running (www-data path).
- 2026-11-02 S1: plan written (`2026-11-02-s1-qmap-guard.md`), waiting on the user's OK. Correction to the PM design: the QCMAP binary is `/usr/bin/QCMAP_ConnectionManager` on both devices (not `...Managerd`).
- 2026-11-02 S3: user approved the plan. The ERRORs are not a capability gap: TA/QRSRP fail only in cycles right after a real radio drop on a weak cell; "Internet unreachable" lines are real outages, logged once each. Fix = one-file poller gate (skip those reads while no radio is connected). RG501Q-EU slot GRANTED to S3 (~30 min, poller replace + restart, user confirms the restart). S1 told: /tmp read-only runs only on the RG501Q until S3 releases it.
- 2026-11-02 S2: plan drafted; installer-safety-auditor gate running before it goes to the user.
- 2026-11-02 S1: building; atd 0.7.5 (md5 d5b06114). Read-only /tmp `--qcmap` run on the RG501Q-EU as root + www-data APPROVED during the S3 slot (no AT, no restart, installed broker untouched).
- 2026-11-02 S1: RG501Q-EU read-only run done, /tmp clean: `--qcmap` (0.7.5, md5 d5b06114) = running as root and www-data, matches QCMAP pid 430; /proc has no hidepid. Verifier running.
- 2026-11-02 S2: auditor CLEAR on the plan (no must-fix); waiting on the user's OK. Its worktree was 299 commits behind development and was fast-forwarded to c2b39b37 before any write.
- 2026-11-02 S3: committed cc95a3c5; busybox SAFE on both; verifier running; patched poller staged in /tmp on the RG501Q-EU with a backup; waiting on the user's yes to replace + restart.
- 2026-11-02 S4: blind verifier FAIL on fd5f490d — pid_is PASS on both devices (www-data + root, sh + bash), but the watcher traps TERM to rm its pid file without exiting, so failover OFF no longer stops it (old `kill -9` did). PM brief error. Also missed: qmanager_profile_apply:907-915 pid_alive kill; cgi_base.sh stub unreachable under BusyBox (failed `.` exits sh). Fix round 1 sent to the worker: trap exits on INT/TERM + `sleep & wait $!`, pid_is in profile_apply. Note: development advanced to 0a1aa313 (P4 follow-ups, other session).
- 2026-11-02 S1: DONE, not merged — branch claude/s1-qmap-guard-ee4a56 head 0fcae06e (code 73398ad7), atd 0.7.5 md5 d5b06114; verifier PASS_WITH_NOTES; cargo 324 user + root. Not device-proven: the refusal (needs QCMAP stopped) and the WARN/INFO lines. Known gap: 2 s cache can pass one QMAP right after QCMAP exits. Awaiting the user merge decision. S2: busybox SAFE both, verifier running.
- 2026-11-02 S4 round 1: a166eca6 — watcher `trap 'cleanup; exit 143' INT TERM` + every sleep as `sleep N & wait $!`; TERM exit 0.08–0.10 s on both devices (was ~24 s); pid_is at profile_apply:910. PM added b1cb6cec: cleanup removes the pid file only if it still holds $$. Blind verifier round 2 running (last round before asking the user).
- 2026-11-02 S1: MERGED into development 44f487e3 (user said merge; no conflicts; not pushed). Verified: 0fcae06e is an ancestor; dependencies/qmanager_atd md5 d5b06114. Worktree + session cleanup deferred to the end-of-board Haiku sweep. Refusal + 0.7.5 on the RM520N-GL go to S5.
- 2026-11-02 S2: branch claude/s2-updater-cgroup-dc45b4 @ 480cdd32; auditor CLEAR (plan + code), busybox SAFE both, verifier PASS_WITH_NOTES (note fixed). RM520N-GL slot GRANTED for 3 installs + reboots (SSH install of the build → UI downgrade to v0.1.17 → SSH re-install), user yes per step. Its tarball carries atd 0.7.4 (base c2b39b37), so the RM520N-GL ends on 0.7.4, not 0.7.5. UI OTA to this build is not testable until a release exists → S5.
- 2026-11-02 S3: RG501Q-EU slot RELEASED. Branch claude/s3-rg501q-logspam-2356a2 @ cdc2c918 (fix cc95a3c5, poller + docs). Soak 18 min: 4 radio drops, TA ERROR 0, QRSRP ERROR 1, unreachable WARN 1 (real outage); before ~3.4/h over ~40 h (126 TA + 10 QRSRP). Device LEFT on the patched build over the older 21ea3282 base: poller md5 b01ae872 ≠ HEAD 0d725f02; backup /tmp/s3_poller.bak 9e2285f1 (lost at reboot). The restart re-ran the boot profile auto-apply ("Smart", complete) because 21ea3282 lacks T-A's once-per-boot guard → S5 brings the RG501Q to a full development build. Verifier: 47/136 errors were sent while QENG still showed a cell (flapping link); gate can't catch them; clean fix = quiet-read option in qcmd (crate) → new S6.
- 2026-11-02 S4: blind verifier round 2 PASS_WITH_NOTES on b1cb6cec, both devices, www-data, stub qcmd: TERM latency 0.08–0.11 s; owner check holds; exit codes unchanged. Low notes: substring match; TERM waits for an in-flight qcmd (≤ the call, then skips the remaining band writes); ms race in cleanup read-then-rm; bash 3.2 only on the RM520N. Nothing deployed.
- 2026-11-02 S3 + S4: MERGED into development by the PM on the user's word ("Merge both"): 08ce31a9 (S3) and c48658f3 (S4), --no-ff, no conflicts, bash -n clean on the 4 scripts. Not pushed. S6 opened from the S3 verifier finding.
- 2026-11-02 S6: writer found — the qcmd client logs "Command returned ERROR" at ERROR level, so no socket/proto change needed; plan in its run notes, waiting on the user OK. S2: RM520N-GL rebooting mid-proof (unreachable to S6 for that reason).
- 2026-11-02 S2: step 1 (SSH install of 480cdd32) clean, updater md5 1ab24a87 = HEAD, lighttpd restarted; RM520N-GL unreachable >10 min after the user-approved reboot. PM check: host Tailscale reports "starting/NoState" but ping 100.108.49.113 = 2/2 replies — client state lagged the real path. S2 told to retry SSH and prove serial/uptime/unit state before step 2; slot stays with S2.
- 2026-11-02 S2 correction: 100.108.49.113 is the subnet router, not the modem (SSH with RM520N creds denied); the PM ping claim above is void. Behind it 192.168.225.1 = no ping, HTTP/HTTPS timeout; modem bridge SSH handshake timeout from the PM too. No serial/uptime proven since the step-1 reboot. S2 asked the user to look at the modem; no power cycle until the user reports. Proof paused, slot held.
- 2026-11-02 S2: user reports the RM520N-GL sits behind their GL-X2000 (Tailscale, advertises the modem subnet); the GL WAN is stuck on "Connecting" → modem LAN side gives no link/lease. Relayed to S2 with a check order for when it returns (QCMAP, df /usrdata, 0-byte /etc/data XMLs, bridge0). User step 1: reconnect GL WAN / replug cable; power-cycle only on their yes.
- 2026-11-02 S2: GL WAN reconnect did not help; the USER is power-cycling the RM520N-GL. S2 waits for their word, then runs the check order before step 2.
- 2026-11-02 RM520N-GL back after the user's power cycle; now cabled to the user's laptop (weak signal there). S2 told to run the recovery checks, save persistent evidence, then continue step 2.
- 2026-11-02 Outage investigation opened on the user's request: read-only session rm520n-outage (local_e5f0c7f6), joint with the UI/UX parity lead (local_6f0a1b77). Hypotheses: S2 build, parallel parity deploys (P5 Alerts + Tailscale), QCMAP/0-byte XMLs, slow boot. Parity lead asked to list its RM520N-GL actions 22:00–23:35 UTC and to hold new RM520N-GL writes until slots are coordinated with this PM. Gap found: the two groups did not share device slots.
- 2026-11-02 Parity lead reply (unverified): no P5 session touched the RM520N-GL; all hit SSH handshake timeouts there and used the RG501Q-EU /tmp only; no Tailscale install/update anywhere; P5 merged to development 67d1435a, not deployed. P5 holds RM520N-GL writes until the PM grants a slot. Forwarded to rm520n-outage with the task: compare P5 timeout times with S2 install/reboot times (path vs modem).
- 2026-11-02 Housekeeping: S1 and S3 sessions ARCHIVED (user asked); Haiku cleanup dispatched for the S1, S3 and S4 worktrees/branches (merge-base check, `branch -d` only). S3 session confirmed its fix is in development (08ce31a9; development now e9eff77f).
- 2026-11-02 Housekeeping DONE (verified by PM with git): S1, S3, S4 worktrees removed and branches deleted with -d after merge-base checks. Left alone (not this board): .claude/worktrees/parity-p4-traffic-dns-585057 (unregistered folder) and t81-build.log.
- 2026-11-02 S6: commit e421ec43, atd 0.7.6 md5 b2441f56, cargo 325 user + root. RG501Q-EU /tmp read-only slot GRANTED (qcmd rc/stdout/stderr diff, -q / QCMD_QUIET, root + www-data; harmless queries; installed broker there is 0.7.4).
- 2026-11-02 Outage: investigator timeline — all 62 RM520N calls 21:53:47–22:49:15 OK; S2 reboot 22:49:25; ECONNREFUSED :22 at 22:49:35 (shutting down); handshake timeouts until the cold power-up (first success 23:56:58, laptop cable). All P5 timeouts are after the reboot → P5 / parallel sessions RULED OUT; no path fault evidence (GL path not re-tested). Open: did a WARM reboot of the S2 build hang (shutdown stall or warm-only boot step)? S2 told to capture shutdown state to /usrdata before its next 2 reboots and stop if it hangs again.
- 2026-11-02 S2 step 2 PASS: UI downgrade to v0.1.17 via CGI; updater detached into qm-update-worker.service; v0.1.17 installer restarted lighttpd (~2 s) without killing the worker; reboot_ack HTTP 200; the updater's own warm reboot returned in ~50 s (v0.1.17, units NRestarts 0, usual 4 vendor failures). No pre-reboot capture. Step 3 (SSH install of 480cdd32 + warm reboot) repeats step 1 with a /usrdata capture first. Forwarded to the investigator.
- 2026-11-02 Outage follow-up: device traces cannot tell shutdown hang from boot hang; no QManager cause found (all units TimeoutStopSec=10, no worker alive; reboot cmd `sync; (sleep 1; reboot) &`). Device has no ShutdownWatchdogSec and no /dev/watchdog, so a post-PID1 stall waits for a power cut. No persistent traces 22:49:26–23:49:11. S2 step 3 to carry temporary markers: /etc oneshot unit (ExecStop → /usrdata log) + optional /lib/systemd/system-shutdown hook (rootfs rw, user yes). GL path re-test still open.
- 2026-11-02 Outage correction: /sbin/reboot -> systemctl on 61368cd2, so steps 1 and 2 used the same `systemctl reboot`; differences are caller (dropbear SSH vs qm-update-worker), tree (480cdd32 vs v0.1.17) and install path. Step 3 is the discriminating test. NEW: investigator saw uptime 149 s at a later probe → another reboot after step 2; source unknown, S2 asked.
- 2026-11-02 S2 DONE, RM520N-GL slot RELEASED: branch claude/s2-updater-cgroup-dc45b4 @ 27e53c29 (code 480cdd32; 6 files; merge-tree clean vs development). Self re-exec into qm-update-worker.service, no sudoers change; rollback keeps the target installer (guarded, documented; CGI rollback action has no UI caller). Proven: detach (download + install_staged), v0.1.17 installer lighttpd restart survives, --collect cleanup, two warm reboots OK (step 3 = same build + command as step 1, ~10 s shutdown → hang NOT reproduced; difference = laptop Ethernet vs GL-X2000 peer). Device: v0.1.18-draft, atd 0.7.4 23be0cb4, units NRestarts 0, bridge0 /24, UI 200. Not proven: UI OTA TO this build (needs a release). Uptime-149 s reboot = step 3. Investigator asked to conclude (one-off vs warm-reboot link state vs GL).
- 2026-11-02 S2: marker request arrived after step 3; step 3 had only /usrdata/s2_prereboot3.txt + s2_shutdown3.txt (list-jobs per second to 08:08:51). The instrumented warm reboot (marker A, B with user yes), cabled to the GL-X2000, moves to S5. No new S2 slot.
- 2026-11-02 Outage investigation DONE (notes `2026-11-02-rm520n-outage.md`, item 6): S2 tree and reboot method cleared (step 3 identical, came back). A GL link problem alone does not fit (the failed boot left no reboot_history entry, which needs LTE + poller). Leading: intermittent platform hang on warm reboot (late shutdown / early boot) with no watchdog. Second: GL-on-eth0 boot interaction. Test in S5: GL back on eth0, a few warm reboots with marker A (+B on user yes). S2 confirms the 149 s uptime = its step 3 (user yes); watchcat inactive, NRestarts 0.
- 2026-11-02 Outage conclusion: (a) unreproduced one-off warm-reboot hang most likely; (b) "modem up, only GL link dead" unlikely (poller does not depend on QCMAP/eth0, yet no reboot_history entry); (b) survives only as NIC/PCIe bring-up hanging the boot. S5 probe (user OK): GL cabled; marker A (date, uptime, ip -br link, ethtool eth0 → /usrdata/qmanager/rebootprobe.log) then reboot; optional marker B shutdown hook; check reboot_history / last_boot_id after; read the GL side during; if it hangs wait ≥35 min (reboot.target 30-min reboot-force) before power-cycling; 3–5 reboots GL vs laptop for a rate. Session archived.
- 2026-11-02 S6 DONE, RG501Q-EU slot RELEASED: branch claude/s6-qcmd-quiet-2eca03 @ 29b07690 (feature e421ec43); atd 0.7.6 proto 3 md5 b2441f56; cargo 325 user + root; busybox SAFE; verifier PASS_WITH_NOTES; new client vs installed 0.7.4 broker OK; rc/stdout/stderr identical for OK/ERROR, root + www-data, -j. Poller: QCMD_QUIET=1 on the 3 S3-gated reads. Test lines left in RG501Q /tmp/qmanager.log: 8 ERROR + 1 DEBUG "s6probe" 00:05:15-16, 1 ERROR "s6verify" 00:11:31. Not proven: RM520N-GL, empty-response path, quiet on in-process fallback, real-install log counts (→ S5). S2 and S6 both merge clean vs development.
- 2026-11-02 S2: MERGED by the S2 session on the user's word — development fast-forwarded to 4b831829 (merge of development 931f08cf into the branch), no conflicts, sh/bash -n + CRLF clean; PM verified cb9ed06c is an ancestor. Not pushed. Outage investigation session ARCHIVED. S6 still awaiting the user merge decision.
- 2026-11-02 S6: MERGED into development b4e22af1 by the PM on the user's word ("Merge S6"), --no-ff, no conflicts; poller bash -n + 0 CR; dependencies/qmanager_atd md5 b2441f56 (0.7.6). S2 + S6 sessions ARCHIVED; Haiku cleanup of their worktrees dispatched. All S1–S4 + S6 code merged → S5 starting.
- 2026-11-02 Housekeeping: S2 + S6 worktrees removed and branches deleted with -d (verified by PM with git). S5 started as session s5-device-proofs (local_ca132502). dcc80644 = the PM ledger commit.
- 2026-11-02 S5: base dcc80644 OK, both devices healthy (atd 0.7.4); tarball building; next: SSH install RG501Q-EU then RM520N-GL (user yes each). PM: marker A before each install reboot too; these count toward the warm-reboot sample.
- 2026-11-02 S5: proofs 1 (both installed, atd 0.7.6, NRestarts 0) and 3 (T-A skip on poller restart, both) PASS. Proof 2: S1 refusal PASS (QCMAP stopped → AT+QMAP refused in 10 ms, one WARN, INFO on recovery) but DEFECT F2: the first AT+QMAP 9 s after QCMAP restarted (guard "allowed") got no answer, deadline kill 08:28:12, then AT channel down 7+ min; data path up, modem_reachable false. Same wedge as R6 F1. Evidence /usrdata/s5/wedge.txt on 61368cd2. PM: recover via atfwd_daemon restart first (user yes), then atd, then reboot (marker A); no repeat of proof 2; S7 opened for the fix.
- 2026-11-02 S7 started by the user (local_ab227d74); built, busybox SAFE locally (no on-device run yet), blind verifier running. S5 waiting on the user (F2 recovery step on the RM520N-GL). PM context handoff at ~30%.
- 2026-11-02 S7: branch claude/epic-cannon-d6acbf @ efe17a7c (atd 0.7.7 proto 3, md5 a5018749; broker refuses +QMAP when earliest QCMAP started >120 s after boot, until reboot). cargo 328, busybox SAFE (local), verifier PASS_WITH_NOTES. RM520N-GL part 1 GRANTED during the S5 slot: read-only /tmp `--qcmap` root + www-data, QCMAP stat field 22 now and after the S5 recovery reboot (the 120 s window is measured only on the RG501Q-EU). Part 2 (deploy, QCMAP restart, 10-min AT check, warm reboot with marker A) QUEUED until S5 releases; user yes per step. S5 told.
- 2026-11-02 S7 part 1 DONE (RM520N-GL 61368cd2): reading (a) missed — S5 recovery reboot already at 08:42:38. Reading (b): QCMAP PID 437 starttime 695 ticks ≈ 7 s after boot (RG501Q-EU 8.7–8.9 s), so the 120 s window holds. /tmp `--qcmap` (md5 a5018749) = `qcmap=running` rc 0 root + www-data; scans /proc only, no broker socket (main.rs). No AT, installed atd b2441f56 untouched, /tmp/s7 self-deleted. Restarted state on a real /proc still unproven → part 2, QUEUED behind S5.
- 2026-11-02 S5: F2 recovery = atfwd restart 08:40 (no recovery in 2 min) → warm reboot with marker A → healthy; atd-restart step skipped; QCMAP/atfwd start times lost at reboot; fuser 08:34 showed only atd on smd11. Proof 2 not repeated. Proof 5 (S4) PASS: watcher gone ≤160 ms, no revert. Proof 6 laptop half 5/5 warm reboots OK with marker A; GL half OWED (user away from the GL); marker B dropped (shutdown hook cannot write /usrdata). Soak to ~09:51 local, then user power-cycle for the 1970 cold boot (OnCalendar timer armed; warm-boot misfire skipped by the guard). User DECLINED SSR, SMS reconnect, SMS send. S5 keeps the RM520N-GL; S7 part 2 queued behind it.
- 2026-11-02 S5 DONE, RM520N-GL slot RELEASED: commit 1bbec761 on claude/s5-device-proofs-2ed46c (notes 2026-11-02-s5-device-proofs.md), not merged. PASS: 1 rollout both (tarball 827b2666, atd 0.7.6 b2441f56), 3 T-A both, 4 soak (RG501Q 1h29m, 9 drops, 0 gated ERROR; RM520N 1h no drops), 5 S4, 7a 1970 cold boot (OnCalendar fire at 28.6 s skipped). 2 refusal PASS then F2 (→ S7). 6 laptop 5/5, GL half owed. Not run: SSR, SMS reconnect/send, IPv6 (user declined / no v6); UI OTA owed. Observations: RG501Q boot auto-apply runs the COPS attach cycle once per boot (CGCONTRDP bare OK before bearer up); installers warn "no usable wget for opkg" on both. RM520N-GL on laptop cable, cold-booted ~09:56. S7 part 2 slot GRANTED.
- 2026-11-02 PM correction: development moved to f0107058 (P5 watchdog merge) after dcc80644; S7 told to merge it before deploying. S5 branch adds only its notes file (62 lines).
- 2026-11-02 S5: MERGED into development 8cece42c on the user's word ("Merge S5"), --no-ff, notes file only; not pushed. Session idle; worktree cleanup deferred to the end-of-board sweep.
- 2026-11-02 S7 part 2 (RM520N-GL, user yes 10:12:50): QCMAP restarted (PID 25564, 1024 s after boot) → `--qcmap` restarted root + www-data; AT+QMAP="WWAN" refused 3/3 in 10–30 ms and the CGCONTRDP+QMAP compound too; CGCONTRDP + ATI rc 0. 10 min: ATI rc 0 every minute, 0 AT-down lines, atd NRestarts 0, modem_reachable true, bridge0 + data up; profile/APN CGIs via lighttpd as www-data fell back OK. GAP: status.json wan_ipv4 blank from minute 5 (poller blanks it without a +QMAP line, rule from 21ea3282; S7 makes it last until reboot). Fix in progress: IPv4 from CGCONTRDP (parse_at.sh + poller). PM asked for: real-device CGCONTRDP lines + correct CID, bare-OK case, read only when +QMAP refused, verifier + busybox re-run before deploy. development f0107058 merged into S7 as 7e221e27. Reboot not yet done.
- 2026-11-02 S7 DONE, RM520N-GL slot RELEASED: branch claude/epic-cannon-d6acbf @ f36713ce (dev f0107058 merged as 7e221e27), atd 0.7.7 a5018749; WAN IP fix a3b80351 (parse_cgcontrdp field 4, 4/8-octet IPv4 only; same record + Tier 2 read as APN/DNS, so no extra AT). Proven: restarted → +QMAP refused 3/3, 10 min no AT-down, CGIs fall back, wan_ipv4 back 10 s after poller restart; warm reboot marker A 10:33:16, back ~58 s, QCMAP 6.6 s, `--qcmap` running, QMAP OK, NRestarts 0. RM520N-GL QCMAP boot start 6.6–7.1 s over 3 boots. Device LEFT on the S7 build (backups /usrdata/s7/bak, evidence /usrdata/s7/s2.txt). Owed: blind verifier on a3b80351, busybox ash on the CGI case blocks, RG501Q-EU untested (QCMAP cannot be restarted there). Open: intermittent host SSH after cold boot; 10:14 latency events (RSRP −114). Not merged; user deciding in S7.
- 2026-11-02 Issue dr-dolomite/QManager#34 (filed in the RM551E repo, RM520N v0.1.17): NOT covered by S7. Still live on development: watchcat `count_recent_reboots` counts every `reboot` row since now-3600, so at a 1970 clock all real-dated rows count → Tier 4 disables watchcat with no reboot; it also counts user/scheduled rows. Fix = port RM551E v0.1.34 wd_ledger.sh count (tier4_escalation only, clock-sane gate). Proposed as S8 (card, not started). Issue transfer/close awaits the user.
- 2026-11-02 S7: fallback reworked per PM review → 8e9535ee (poller c16e3e96, parse_at 59973b5c), NOT deployed; device still on a3b80351 build (healthy, QCMAP boot-started). Non-IMS records, 4/8-octet IPv4, 0.0.0.0 dropped, prefers the rmnet address, bare OK = empty, runs only without +QMAP. Real reply is single-context CID 1 IPV4V6, so multi-CID/v4v6 are synthetic. Verifier + busybox on the delta next. S7 holds the RM520N-GL slot again (for an 8e9535ee device check); handing off to a fresh session. Merge waits for verifier + busybox + device check of 8e9535ee.
- 2026-11-02 Issue dr-dolomite/QManager#34 TRANSFERRED on the user's word → dr-dolomite/QManager-RM520N#20. No comment posted. Fix = S8 card (not started).
- 2026-11-02 S7 gates on edd438cd (scripts = 8e9535ee): busybox SAFE (RG501Q 1.29.3 /tmp, 10/10, rmnet match vs real rmnet_data1, CGI case blocks OK, LF); verifier PASS_WITH_NOTES (6/6 criteria, criterion 4 per PM ruling; notes: no-rmnet → first candidate, joined "v6 v4" field → blank, leading-zero octets pass, first `ip` use in poller with fallback). Not run: BusyBox 1.31.1 / bash 3.2 → the RM520N-GL device check covers both. S7 asking the user for the device steps.
- 2026-11-02 S8 (local_f08573d8, branch claude/vigorous-allen-5c6c3b on 8cece42c): /tmp/wd34-only test GRANTED on both modems (crafted crash.log copies, no service/restart/AT; 11/11 local). Runs beside S7's RM520N-GL slot.
- 2026-11-02 S7 device proof of 8e9535ee (user yes per step): normal path wan_ipv4 back 10 s after poller restart; device BusyBox 1.31.1 cgc_wan_ipv4 live/256.1.2.3/bare-OK OK; refused path QMAP refused 10 ms, call moved rmnet_data0→1, wan_ipv4 kept; marker A #2 warm reboot 10:52:01, QCMAP 6.9 s, `--qcmap` running, NRestarts 0. Device LEFT on the 8e9535ee build (backups /usrdata/s7/bak). Watch item: internet_lost 10:54:01 after that boot with bearer up, B28 RSRP −114 SINR 5, intermittent, unattributed, no action. S7 slot RELEASED.
- 2026-11-02 S7: MERGED into development 760725a0 on the user's word ("Check, then merge"), --no-ff, head 06603ae4 (scripts = 8e9535ee); atd md5 a5018749 (0.7.7); poller + parse_at bash -n OK, 0 CR. Not pushed.
- 2026-11-02 S8 ready: claude/vigorous-allen-5c6c3b @ f3120e04 (fix 84025f29; follow-ups f3120e04: "In the last hour" caption 5 locales + doc/comment fixes). count only tier4_escalation numeric rows; sane clock = rolling hour; 1970 = clockless tier4 rows since last real-dated row; wd_ledger_tick once a minute. Device /tmp/wd34 11/11 ash+bash both devices (schedule_timer.sh md5 33b30ca1 both), repro old 5 → new 0, cleaned. busybox SAFE (static), verifier all code criteria PASS (doc FAIL fixed after, not re-run). Not run: i18n:check, next build. Edge: clockless outage allows cap+1 tier4 reboots (same as RM551E). Awaiting the user's merge word.
- 2026-11-02 S8: MERGED into development 49e152a4 on the user's word ("Merge S8"), --no-ff, head f3120e04; watchcat bash -n OK, 0 CR; 5 locale JSON parse OK; i18n:check 0 errors (29 pre-existing passthrough warnings). Not run: next build, verifier re-run on f3120e04 docs fix. Not pushed. Issue dr-dolomite/QManager-RM520N#20 left open (closes on release).
- 2026-11-02 Housekeeping on the user's word: S5, S7, S8 sessions ARCHIVED; worktrees removed, branches deleted with -d (all verified ancestors of development first). Empty locked dir .claude/worktrees/vigorous-allen-5c6c3b remains (Permission denied; 0 files) — delete once the lock clears.

## PM board — closeout (opened 2026-11-03, base 69604a63)
Goal: close the atd/poller port. Same rules as the S board: main session is PM and sole editor of this file; device writes go through the PM one device at a time; every merge is the user's word.

Checked closed on 2026-11-03 (no work): `/tmp/qmanager_ui_active` symlink guard (fetch_data.sh:24, overview.sh:28); useModemStatus default 5000 ms on a shared timer; qlog.sh `set -u` gone; remaining `/tmp/qmanager_at.lock` refs are the deliberate rollback-compat code (install_rm520n.sh:941, qmanager_update:617-636); installer banner reads the LAN IP from config (192.168.225.1 is only the fallback); SMS CGI merge 24 h time split + compose dialog part count (f0fa602c).

| id | task | seat | file set | device | status |
| --- | --- | --- | --- | --- | --- |
| S9 | `lighttpd.service` ordering after `qmanager-setup.service` | Sonnet worker (qm-worker, high) | `scripts/etc/systemd/system/lighttpd.service` (+ installer only if lockstep needs it) | none | DISPATCHED |
| S10 | T6.2 residue: lighttpd keep-alive CPU; one-shot CGI cost of settings + about pages | Opus session | lighttpd.conf, the CGIs it names | RM520N-GL (slot from PM) | STARTING |
| S11 | RG501Q-EU residue: "no usable wget for opkg"; boot auto-apply COPS attach cycle every boot; sms-forward `failed` once after OTA from v0.1.14 | Opus session | as its plan decides | RG501Q-EU (slot from PM) | STARTING |
| S12 | Proof campaign 3 + close-or-waive: SSR, SMS forced reconnect, multi-part send, IPv6, UI OTA to this build, GL-X2000 warm reboots, RG501Q S7 path | Opus session | none (notes only) | both, user yes per step | QUEUED until S9–S11 merge |
| PM | S8 gates not run: `next build`, verifier re-run on f3120e04 docs fix; push `development` (user's word) | PM | — | none | OPEN |

### PM log (append-only)
- 2026-11-03 Board opened. Closed items above verified by PM grep. Parity-board worktree folders (p5-wd-backend-ea7696, parity-p4-traffic-dns-585057, t81-build.log) are not this board's; left alone.
- 2026-11-03 S9 dispatched (qm-worker, Sonnet, high effort, own worktree, no device). S10 started (local_59b8d665, RM520N-GL slot GRANTED). S11 started (local_d4511d90, RG501Q-EU slot GRANTED; RM520N-GL read-only only). S12 brief at `.orchestra/scratch/s12-brief.md`, starts after S9–S11 merge. PM `next build` running.
- 2026-11-03 S9 DONE: branch worktree-agent-a1562a562820ec3ee @ 5c26e54f, 1 file (+2/-1), `After=... qmanager-setup.service`, ordering only. PM checked diff, no cycle (setup never names lighttpd; firewall is Before both). Installer copies unit + daemon-reload (:1886-1894), uninstall removes it; no installer change. Device proof = boot order in S12's install + reboots. Awaiting the user's merge word.
- 2026-11-03 PM: `bun run build` on development 69604a63 PASS (compiled clean, 52/52 static pages, exit 0) — S8's owed build gate closed. S8 verifier re-run on the f3120e04 docs fix still open.
- 2026-11-03 S9: MERGED into development dcda2e72 on the user's word ("Merge S9"), --no-ff, head 5c26e54f. Not pushed. Worktree unregistered, branch deleted with -d; folder held by this session's shell (Permission denied), delete it later.
- 2026-11-03 S10 measured (no code yet; branch reset onto 69604a63, it had been cut from main): keep-alive CLOSED no change (30 s idle live since R5, ~0.15 pts); settings/about one-shots CLOSED (110–540 ms per mount). New: Logs page `logs.sh` every 10 s = 2.2 pts now, 5.1 pts at the 256 KB log. Options L1 single-awk rewrite (byte-compare gate) / L2 poll 30 s; awaiting the user. Note: a foreign root session file appeared on the RM520N-GL 09:03:29 during S10 runs (another bridge client). S11: auditor CLEAR on the diff; busybox + verifier pending.
- 2026-11-03 S10: user chose L1 ("L1: single-awk rewrite"); relayed to S10 with the byte-compare gate.
- 2026-11-03 S11 DONE: claude/s11-rg501q-residue-62f8e8 @ 5d7216ea (base 69604a63), 6 files +111/-13. Item 1 fixed (opkg real error named via qm_opkg_update; wget fine, RG501Q has no data/DNS); item 2 fixed (boot skips COPS cycle when no CGCONTRDP record and CGDCONT? already holds the APN; PDP-type-only change not written on that skip, documented); item 3 already fixed by R5 9400643f. Gates: auditor CLEAR plan+diff, busybox SAFE both (r2), verifier PASS_WITH_NOTES (r2). Not proven: real boot, real install run (→ S12). PM read the code diff. Release-note bullets drafted in its notes, not in RELEASE_NOTES.md. Awaiting the user's merge word. S10: L1 built, byte compare 150/150 identical on RM520N-GL; busybox + verifier running.
- 2026-11-03 S11: MERGED into development 08688c29 on the user's word ("Merge S11"), --no-ff, head 5d7216ea; bash -n OK, 0 CR on both scripts. Not pushed. Session worktree left for the end-of-board cleanup.
- 2026-11-03 S10: busybox RM520N-GL 378/378 byte-identical; RG501Q-EU read-only probes OK but the /tmp byte compare was DENIED by the permission classifier — needs the user's OK (RG501Q slot is free since S11 merged). Blind verifier running.
- 2026-11-03 S10: user approved the RG501Q-EU /tmp byte compare ("Allow the /tmp test"); RG501Q slot GRANTED to S10 (/tmp only, no installed files, no restarts).
- 2026-11-03 S10: RG501Q /tmp write DENIED again by S10's auto-mode classifier despite the user's OK; nothing written. Branch claude/s10-cgi-cost-residue-b2cf85 (e914d813 code, 0701fd5f docs). Verifier still running. Options for the user: add a modem_write permission rule themself, or waive the RG501Q compare (S12 install exercises logs.sh there).
- 2026-11-03 PM: on the user's request ("Please add the permission") added allow rule mcp__modem-rg501q__modem_write to .claude/settings.local.json in the main checkout and the S10 worktree; S10 told to retry.
- 2026-11-03 S10: e2ae6d0c (verifier found invalid UTF-8 → raw bytes; now U+FFFD as jq). 228→92 ms (28.5 KB), 494→304 ms (256 KB); 175/175 identical RM520N-GL, 150/150 RG501Q-EU (pre-U+FFFD). Session context-handed-off; told to resume from its brief and re-gate e2ae6d0c (busybox both + verifier). Open user decision: accept output differences where old output was broken (raw control byte, " or bad escape in component/pid → old body empty; backslash escape in component now literal; rotated file without trailing newline).
- 2026-11-03 S10: user ACCEPTED the output differences ("Accept them"). Merge waits for the e2ae6d0c re-gate.
- 2026-11-03 Housekeeping on the user's word: S11 session ARCHIVED, worktree removed, branch deleted with -d (ancestor of development verified). S10 to be archived after its merge.
- 2026-11-03 Slot: RM520N-GL window GRANTED to the issue-14/15 session (local_56201fd0): copy ttl_state.sh + qmanager_fw_apply from b8f27666, re-apply TTL/HL once, restore TTL=64/HL=64; no restarts. S10 /tmp-only runs continue alongside. S12 must not start until that session reports done.
- 2026-11-03 Slot: issue-14/15 session reports its RM520N-GL window CLOSED (unverified by PM): ttl_state.sh cfa30792…, qmanager_fw_apply 940e8273… from b8f27666 on rootfs; TTL/HL 64 restored; one qmanager-ttl restart; ip6tables POSTROUTING now has 3 ND ACCEPT rules (expected). RM520N-GL free for S12.
- 2026-11-03 PM (resumed after handoff): S10 still running; busybox checker found one more case, S10 is fixing it and re-running its RM520N-GL byte compare. Merge waits for its report.
- 2026-11-03 S10: fix committed 600a3ecd; busybox + verifier re-gate running against it.
- 2026-11-03 S10: busybox SAFE TO SHIP on 600a3ecd, 433/433 identical on both devices. Blind verifier still running.
- 2026-11-03 S10 re-gate DONE @ cf9d5b53: busybox SAFE both (433/433); verifier FAIL on A2 only = 2 unlisted diffs where old output was wrong (NUL byte in log -> old components []; component line >4094 B -> old jq split a char into U+FFFD). Now listed in logs.md. CPU 230->86 ms (30 KB), 496->302 ms (262 KB), forks 59->9. PM checked: merge-tree clean vs b8f27666, bash -n OK, 0 CR, comments short. Release-note figures (80/294 ms) slightly differ from final (86/302); fix at release fold. Awaiting the user: accept the 2 diffs + merge.
- 2026-11-03 S10: user ACCEPTED the 2 extra diffs and said merge ("Accept and merge"). MERGED into development ca24cc1f, --no-ff, head cf9d5b53; ancestor verified, 0 CR in logs.sh. Not pushed. Session ARCHIVED, worktree unregistered (only its settings.local.json allow rule was uncommitted, same rule is in the main checkout), branch deleted -d. Empty-ish folder .claude/worktrees/s10-cgi-cost-residue-b2cf85 held (Permission denied); delete later. Next: S12 proof campaign, needs the user's word to start.
- 2026-11-03 S12 STARTED on the user's word ("Start S12"): session local_12da196b, Opus, own worktree from development ca24cc1f. Both device slots GRANTED to S12 (user yes per install/restart/reboot/SSR/SMS).
