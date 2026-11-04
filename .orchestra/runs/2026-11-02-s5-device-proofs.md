# S5 — device proofs for the post-R6 board (2026-11-02)

Board: `2026-10-26-atd-poller-port.md` (PM owns it). Branch `claude/s5-device-proofs-2ed46c`, fast-forwarded a05c4e92 → `development` dcc80644 (contains S1 44f487e3, S3 08ce31a9, S4 c48658f3, S2 4b831829, S6 b4e22af1).
`dependencies/qmanager_atd` md5 b2441f56 (0.7.6).

## Device state at start (read-only)
| | RM520N-GL 61368cd2 | RG501Q-EU b7e3d6f1 |
|---|---|---|
| firmware | RM520NGLAAR03A03M4G_A0.304 | RG501QEUAAR12A11M4G_04.202 |
| uptime | 533 s (08:17 local, +08:00) | 1 d 18 h 33 m (00:17 UTC) |
| version | v0.1.18-draft (S2 build 480cdd32) | v0.1.18-draft (21ea3282 + S3 poller b01ae872) |
| atd | 0.7.4 md5 23be0cb4 | 0.7.4 md5 23be0cb4 |
| `/usrdata` free | 58.4 MB (53 %) | 102.9 MB (21 %) |
| atd / poller / ping / lighttpd / QCMAP | active, NRestarts 0 | active, NRestarts 0 |
| LAN | bridge0 192.168.225.1/24, eth0 UP (laptop cable) | — |

Log baseline, RG501Q-EU `/tmp/qmanager.log*` (excluding S6 test lines): before the S3 gate ~40 h, 126 TA + 10 QRSRP ERROR (3.4/h). Since the gate (2026-11-01 22:29 → 11-02 00:17, 1.8 h): TA 0, QRSRP 1 (22:33:04), unreachable 4.
RM520N-GL: current boot (9 min) 0 ERROR lines.

## Proofs
| # | proof | status | evidence |
|---|---|---|---|
| 1 | Tarball rollout | PASS (both) | Tarball from dcc80644: md5 **827b2666**, sha256 bf08c3c9…, 1048 files, embedded atd b2441f56. User yes: "Yes, both, reboot each". Posh-SSH scp to `/usrdata`, md5 verified on device, extracted to `/usrdata/s5`, `install_rm520n.sh --force --no-reboot` detached, rc 0 on both; only warning on both: `Package list download failed — no usable wget for opkg`. Deployed vs tarball (`usr/bin`, `usr/lib/qmanager`, `www/cgi-bin`): 166/167 match on both, the one diff is `operator-list.json` (data file, as S2 saw). **RG501Q-EU:** reboot 00:21:42 UTC, back at uptime 52 s: atd **0.7.6 proto=3 md5 b2441f56** PID 1825, atd/poller/ping/setup/lighttpd/QCMAP active NRestarts 0, UI 200, `qcmd ATI` rc 0; failed units are the vendor three (ipacm_perf, pcie, setup_avtp_routing_le). **RM520N-GL (laptop cable):** marker A then reboot 08:23:2x local, back at uptime 52 s (08:24:54): atd 0.7.6 md5 b2441f56 PID 1892, same units active NRestarts 0, UI 200, `qcmd ATI` rc 0; failed units the usual four (pcie, pcie-diag, r8168, ql_ctcc_selfreg); new `reboot_history` entry 1793579081. Tarball removed from `/usrdata` on both after install (RM520N-GL free went 58 → 30 MB with tarball + tree, 46 MB after). |

| 3 | T-A once-per-boot profile guard | PASS (both) | User yes. RG501Q-EU: boot apply ran once at 00:22:36 (marker `/run/qmanager_profile_boot_applied` = this boot_id + ICCID); `systemctl restart qmanager-poller` 00:26:31 → new PID 9475, NRestarts 0, one line `Profile auto-apply already ran this boot, skipping`, no apply, no COPS. RM520N-GL: same, 08:26:53, PID 6305, one skip line, `Starting profile apply` count stays 1. |
| 2 | S1 QMAP refusal | Refusal PASS; **FAIL after recovery: AT port wedged (F2)** (RM520N-GL) | User yes; RG501Q-EU excluded because its QCMAP cannot be restarted after boot (`systemrw.mount` bad-setting). Detached `/usrdata/s5/s1.sh`, output `/usrdata/s5/s1.txt`. `qmanager_atd --qcmap` running → `systemctl stop QCMAP_ConnectionManagerd` rc 0 → `qcmap=stopped` after 3 s. `qcmd AT+QMAP="WWAN"`: root ×2 rc 1 in **10 ms** each, www-data rc 1 in 130 ms, all `command_failed` (client maps `modem_not_ready`); `ATI` rc 0 meanwhile. Log: exactly one `WARN QCMAP not running: refusing AT+QMAP` (08:27:40), INFO per refusal from the client. `systemctl start` rc 0, new PID 8099, active, `INFO QCMAP running again: AT+QMAP allowed` 08:27:52. **Then:** the script's check `AT+QMAP="WWAN"` 9 s after the start was `Command killed by deadline` (08:28:12) → `Lock acquisition failed` for the poller → 08:28:19 `AT channel down: resync failed`. No recovery after 7 min; every AT command `modem_not_ready`, status `modem_reachable false`; data call stays up (rmnet_data1, ping ok), bridge0 up. Evidence `/usrdata/s5/wedge.txt`. Recovery (user: "restart atfwd, then reboot if needed"): `systemctl restart atfwd` 08:40:31 rc 0 (new PID 21428) → no recovery in 2 min, so atfwd alone is not it. Warm reboot 08:42:38 (marker A, laptop) → up 50 s at 08:43:39, atd/poller/QCMAP/lighttpd active NRestarts 0, `qcmd ATI` ok, reboot_history 1793580209. PM told (STOP). |
| 4 | S3 + S6 log counts (soak) | PASS on RG501Q-EU; RM520N-GL clean but no drops to test | **RG501Q-EU**, atd 0.7.6 + dev poller, 00:22:30 → 01:51:33 UTC (1 h 29 m, poller PID 9475 since 00:26, NRestarts 0 everywhere, status normal): 3 `internet_lost`, 6 unreachable, 9 lte-unknown / `signal_lost` lines, so the radio did drop. Gated reads (QRSRP/TA/MIMO): **0 ERROR** (before S3: 3.4/h; S3-only, 1.8 h: 1 QRSRP). The 4 ERROR lines are 2 × the boot-only compound `AT+QCAINFO=1;+QNWCFG="lte_mimo_layers"…` and 2 × `AT+QMAP="DHCPV4DNS"` (unsupported on SDX55), one each per poller start (boot + proof 3 restart): not S3/S6 paths. Quiet failures run at DEBUG, which the INFO log level drops, so they cannot be counted; the absence of ERROR lines across 9 drops is the proof. **RM520N-GL**, boot 08:50:40 → 09:51:27 local (1 h, PIDs atd 1878 / poller 1960, NRestarts 0, status normal): 0 ERROR, 0 unreachable; the only WARN is the scenario-schedule guard skip. No radio drop happened, so this only shows no regressions. |
| 5 | S4 band failover | PASS (RM520N-GL) | User yes. `/usrdata/s5/p5.sh`, output `p5.txt`. Minted www-data session, CGI POSTs through lighttpd. `band_failover_enabled` was absent (off). Toggle ON → `bands/lock.sh` LTE lock to the current set (all 31 bands, so no radio change) → `failover_armed true`, watcher PID 7767 `/bin/sh /usr/bin/qmanager_band_failover`, user www-data, "settling 5s then monitoring 5x5s". Toggle OFF 3 s later: `WARN Killed active failover watcher (PID=7767)`; the PID was gone by the time the POST returned (≤ 160 ms, uptime 236.97 → 237.13); PID file and flag removed. 40 s later: no `FAILOVER` revert line, `lte_band` unchanged. `band_failover_enabled` removed again (back to absent), session removed. |
| 6 | Warm-reboot probe | PARTIAL: laptop half PASS 5/5; GL half NOT RUN | The user is away from the GL-X2000 and wants the modem on the laptop cable so they can power-cycle it if it sticks, so no reboot behind the GL. Marker B dropped: a `/lib/systemd/system-shutdown/` hook runs after filesystems are unmounted or read-only, so it cannot append to `/usrdata`; no rootfs write made. Marker A (`/usrdata/qmanager/rebootprobe.log`: date, boot_id, uptime, `ip -br link`, eth0 speed/link) before 5 warm `reboot`s on the laptop cable (eth0 100 Mb/s full): proof 1 (08:23), F2 recovery (08:42), and three back-to-back (`/usrdata/s5/rb.sh`, 08:47:42, 08:49:08, 08:50:30). Host-side TCP 22 timing for the three: down at +5–7 s, up at +55–57 s after the command. Each came back with atd/poller/QCMAP/lighttpd active NRestarts 0, `qcmd ATI` ok and a new `reboot_history` entry (1793579081, 1793580209, 1793580512, 1793580600, 1793580681). **0 hangs in 5** on the laptop cable today (plus S2's steps 2–3). Owed: 3–5 warm reboots behind the GL-X2000 with the user on hand to power-cycle. |
| 7a | 1970 cold boot with an OnCalendar timer armed | PASS (RM520N-GL) | User power-cycle ~09:55:50 local (uptime 80 s at 09:57:10). `qmanager-scenario-schedule.timer` (OnCalendar 06:00/22:00) triggered at 09:56:17; service started at monotonic 28.6 s, after `ql_time_daemon` (23.2 s), before atd (36.2 s) and the poller (36.9 s); the guard logged `Scenario schedule skipped: fire outside boot-settle window`, exit 0, no apply. Next elapse still 22:00 PST. 0 log lines stamped 1970. All qmanager units active NRestarts 0, atd b2441f56, reboot_history 1793584591. Warm-boot case agrees (08:51:07, see Log). |
| 7b | SSR recovery | NOT RUN | User declined (drops the data call). |
| 7c | SMS forced reconnect under `qsms watch` | NOT RUN | User declined. |
| 7d | IPv6 | NOT RUN | Neither carrier gives IPv6 (re-checked, see Log). |
| 7e | Real multi-part SMS send | NOT RUN | User: "Skip SMS send". No SMS sent. |
| 7f | UI OTA *to* a build | NOT RUN (owed) | Needs a published release. S2's detach is first used by the update *after* the one that installs it. |

## Defects

**F2 — AT port wedges on the first `AT+QMAP` after a QCMAP restart (RM520N-GL; S1 guard gap).** S1's guard opens as soon as a `QCMAP_Connectio` process exists. QCMAP restarted at about 08:27:41 (`systemctl start`, new PID 8099); the guard logged "AT+QMAP allowed" at 08:27:52; one `AT+QMAP="WWAN"` at about 08:27:52 got no answer → 20 s deadline kill → resync failed → `AT channel down`. No recovery in 12 min of 2–60 s re-probes, nor after `systemctl restart atfwd`; only a reboot cleared it. Same wedge as R6 F1 (RG501Q-EU with QCMAP dead), so it is not SDX55-only. The data path stayed up throughout; QManager lost all modem reads (status `modem_reachable false`). In the field this needs a QCMAP restart after boot, which QManager never does (firmware `Restart=no`). The poller's `qcmap_up` (ActiveState) would also say "up". Design is with S7 (PM). Evidence `/usrdata/s5/wedge.txt`, `s1.txt` on 61368cd2.

**Observation (no ticket unless the PM wants one):** on the RG501Q-EU every boot's profile auto-apply ran the APN attach cycle (COPS=2/COPS=0 at 00:22:41), because `AT+CGCONTRDP=1` returned a bare OK (no bearer yet, by design "proceeds"). Once per boot only (T-A guard holds), and the APN was already right, so this is a detach/attach the device did not need.

**Installer note (both, low):** `Package list download failed — no usable wget for opkg` on every install today. It did not block the install. Not investigated.

## Final device state (2026-11-02)
| | RM520N-GL 61368cd2 | RG501Q-EU b7e3d6f1 |
|---|---|---|
| version | v0.1.18-draft (tarball 827b2666 from dcc80644) | same |
| atd | 0.7.6, md5 b2441f56 | 0.7.6, md5 b2441f56 |
| NRestarts | atd / poller / ping / lighttpd / QCMAP all 0 | atd / poller / ping / lighttpd all 0 |
| boot | cold, ~09:55:50 local | warm, 00:21:42 UTC |
| topology | laptop cable (eth0 100 Mb/s) | unchanged |
| `/usrdata` free | 57.8 MB | 101.9 MB |
| left on device | `/usrdata/s5/` (scripts, `s1.txt`, `p5.txt`, `wedge.txt`, install log; ~25 kB) | nothing (`/usrdata/s5` removed) |
`rebootprobe.log` (5 marker-A entries) removed. Band failover back to absent/off. No minted sessions left.

## Log
- PM's F2 instructions (capture QCMAP start vs btime, atfwd PID/start, `fuser /dev/smd11`; try an atd restart before a reboot) arrived after the recovery had run. Not captured: QCMAP stat field 22 vs btime and atfwd start time (lost with the reboot); `fuser /dev/smd11` at 08:34 showed only atd PID 1892. Order used: atfwd restart (no recovery in 2 min) → reboot; the atd-restart step was skipped. Proof 2 is not repeated.
- 09:00–09:01 local: S7 ran a PM-granted read-only `/tmp/s7` `--qcmap` probe on the RM520N-GL (no AT, broker PID 1878 untouched, self-deleted). Inside the soak window; no AT traffic, so it does not affect the counts.
- 08:5x local: proof 7 user answers: only the 1970 cold boot (no SSR, no SMS forced reconnect); "Skip SMS send".
- IPv6 re-check (read-only): RM520N-GL CID 1 IPV4V6, `wds.ip6` null, no global v6; RG501Q-EU CID 1 IPV4V6 `internet`, no global v6. Still not runnable.
- 1970 window, warm boot: `qmanager-scenario-schedule.timer` (OnCalendar 06:00 + 22:00, user config, `Persistent=false`) is armed on the RM520N-GL. After the 08:50:30 warm reboot it triggered at 08:51:07 (boot ≈ 08:50:40) and the guard logged `Scenario schedule skipped: fire outside boot-settle window (clock-step guard, issue #9)` (08:51:10), exit 0, nothing applied; 0 log lines stamped 1970. Cold boot still to do (user power-cycle after the soak).
