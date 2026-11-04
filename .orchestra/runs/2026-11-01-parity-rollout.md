# Run: parity backend rollout to the live RM520N-GL (2026-11-01)

Device: RM520N-GL, serial `61368cd2` (proved by `/proc/cmdline` on every probe). Source: `development` @ `50cad073`.

## 1. Read-only census (12:36 PST)

Full md5 census of `/usr/bin/qmanager_*`, `/usr/lib/qmanager/*.sh`, CGI tree and units vs `development`:
everything matches except the files below. Device copies were traced to the commit they match.

| File | Device md5 (= commit) | development md5 |
| --- | --- | --- |
| /usr/lib/qmanager/parse_at.sh | 3408732f… (281bd7e2) | 5b6d4320… |
| /usr/lib/qmanager/alert_engine.sh | 60c9a8b0… (9cba2b93) | 50e1499c… |
| /usr/lib/qmanager/cgi_auth.sh | 1482a65a… (d6f99251, pre-P0b) | 8d4b387f… |
| /usr/bin/qmanager_poller | 2c788e00… (358c1747) | b08fd79e… |
| /usr/bin/qmanager_set_ssh_password | 700ac631… (b88e07f1) | ca9e8858… |
| /usr/bin/qmanager_debug_report | missing | 0327bbd8… |
| /usr/bin/qmanager_profile_apply | 6ec62433… (6daf6dbd, pre T-A) | 4ad83b7e… |
| CGI auth/password.sh | 81928b93… (d6f99251, pre-P0b) | beeb7aee… |
| CGI auth/ssh_password.sh | 27eebda5… (d0063078) | 1a5d65f5… |
| CGI auth/login.sh | 630c672e… (3c320288, pre-P0b) | 82cdf3fd… |
| CGI system/settings.sh | 1879e4f4… (358c1747) | 5d926aab… |
| CGI system/diagnostics.sh | missing | baa4f0d0… |
| CGI cellular/apn.sh | 9322eccd… (5cd5e53e) | 78038c85… |

Sudoers drop-in matches development (5c71ba98…, already grants `qmanager_set_ssh_password`). Units all match.
Device-only extras (not in dev tree): `/usr/bin/qmanager_atd`, `/usr/bin/qmanager_discord`, `qmanager-scenario-schedule.timer`, `qmanager_smd11_udev.sh` (installer-generated / udev; untouched).

Units: poller, ping, lighttpd, sites active, NRestarts=0, started 09:55:54. Failed units are vendor (pcie, pcie-diag, ql_ctcc_selfreg, r8168).
`status.json`: no `last_outage_*` keys (old poller). `lte.sinr`=25 (raw QENG, unconverted).

### QCAINFO LTE SINR question (parse_at.sh:729) — answered from live AT, 3 samples

| QENG LTE raw | 2X−20 | QCAINFO PCC last field | QSINR LTE per antenna |
| --- | --- | --- | --- |
| 25 | 30 | 30 | 28,28,30,28 |
| 24 | 28 | 28 | 28,28,29,28 |
| 25 | 30 | 29 | 29,29,30,30 |

QCAINFO's LTE SINR is already dB: taking it verbatim is correct, no conversion. The QENG 2X−20 conversion matches QSINR.
Side note: QCAINFO NR SCC last field read 69 / 2078 / 746 across three 2 s samples (parsed as /100 → 0.7 / 20.8 / 7.5 dB) while QSINR NR antenna 1 held 28–29. Unverified whether that field is SINR; not in scope.

### Staged dry run (in /tmp only)

13 development files SCP'd to `/tmp/qm_rollout/`; md5 all match development; `sh -n`/`bash -n` clean.
`qmanager_debug_report` run from /tmp as www-data: rc 0, 677 lines, file 0600 www-data; IMEI/IMSI/ICCID show `[masked]`, and a grep for the real 15/20/15-digit values finds 0 hits.

## 2. Rollout (user approved "Yes, all of it", 12:44 PST)

Script `/tmp/qm_rollout_install.sh`: backup of the 11 existing files with `cp -p` to `/usrdata/qmanager_rollback_20261101/`;
`mount -o remount,rw /` once + `sync` (not restored to ro); each file copied to `<dst>.qmnew`, owner/mode of the old file applied
(new files 755 root:root), `mv -f` over the target (new inode, so the running poller never read a half-written file); md5 checked.
Order: libs → /usr/bin → CGI. Then `systemctl restart qmanager-poller` only.

| File | before | after (= development) |
| --- | --- | --- |
| /usr/lib/qmanager/parse_at.sh | 3408732f | 5b6d4320 |
| /usr/lib/qmanager/alert_engine.sh | 60c9a8b0 | 50e1499c |
| /usr/lib/qmanager/cgi_auth.sh | 1482a65a | 8d4b387f |
| /usr/bin/qmanager_poller | 2c788e00 | b08fd79e |
| /usr/bin/qmanager_set_ssh_password | 700ac631 | ca9e8858 |
| /usr/bin/qmanager_profile_apply | 6ec62433 | 4ad83b7e |
| /usr/bin/qmanager_debug_report | missing | 0327bbd8 (755) |
| CGI auth/password.sh | 81928b93 | beeb7aee |
| CGI auth/ssh_password.sh | 27eebda5 | 1a5d65f5 |
| CGI auth/login.sh | 630c672e | 82cdf3fd |
| CGI system/settings.sh | 1879e4f4 | 5d926aab |
| CGI cellular/apn.sh | 9322eccd | 78038c85 |
| CGI system/diagnostics.sh | missing | baa4f0d0 (755) |

All 13 "OK". Poller restarted 12:44:43, active, NRestarts=0.

Rollback: copy each file in `/usrdata/qmanager_rollback_20261101/` back (names are the path with `/` → `_`), remove
`/usr/bin/qmanager_debug_report` and `.../system/diagnostics.sh`, `systemctl restart qmanager-poller`.

## 3. Proofs

- **status.json**: `connectivity` carries `last_outage_s/_ago_s/_wan_ip/_wan_changed` (null until an outage). `lte.sinr` 30 with QENG raw 24–25 (2X−20 = 28–30), QSINR LTE 27–30 on the live ports. PASS.
- **Per-antenna nulls**: after restart `lte_sinr` read `[30,null,30,null]`; raw `AT+QSINR` at the same time returned `-32768,-32768,30,30` and QRSRP `-140`. The modem drops LTE ports intermittently while NR uses all 4; the parser is correct. Not a defect.
- **Forced outage** (approved): `iptables -I OUTPUT -p icmp -j DROP` (the `comment` match module is absent on this kernel) with a 120 s self-removing fallback. Ping reported down at +52 s, rule removed at +64 s, back up 17 s later. Result: `last_outage_s 29, last_outage_ago_s 2 → 17 (ticks), last_outage_wan_ip 10.110.45.34, last_outage_wan_changed false`; `/tmp/qmanager_last_outage` = `29 10410 false 10.110.45.34 -`. Rule count after: 0. poller/ping NRestarts=0. PASS. (IPv6 WAN path still not exercised — no IPv6 WAN here.)
- **SSH `--verify` as www-data** (session minted in /tmp/qmanager_sessions, lighttpd https):
  - wrong password → `{"success":false,"error":"invalid_password","attempts_remaining":4}`; attempts file absent → `count 1, level 0`.
  - right password (sent from a 0600 /tmp file, never printed; file and session removed) → `{"success":true}`; attempts file cleared.
  - `/etc/shadow` md5 d564121d… unchanged throughout (mtime 2026-08-16). PASS.
- **Debug Report** via `system/diagnostics.sh {"action":"capture"}` → `success:true`, 31,865 bytes; IMEI/IMSI/ICCID lines show `[masked]`; grep for the real 15/20/15-digit values: 0/0/0. PASS.
- **Clock fields**: `system/settings.sh` GET returns `device_clock: {epoch, local}` plus `effective_offset "+0800"`, `effective_zone_abbr`; `hooks/use-system-settings.ts:183` reads `json.device_clock`. PASS.
- **QCAINFO LTE SINR**: already dB (section 1); no change needed.

## 4. Device state left

13 files at development md5; rootfs left rw (per contract); backups in `/usrdata/qmanager_rollback_20261101/` (11 files);
OUTPUT chain policy ACCEPT, no rules; poller/ping/lighttpd active, NRestarts=0; auth attempts file absent; only the user's pre-existing
web session remains; all my /tmp files and the two debug report files removed. Web UI assets were NOT updated (backend only),
so the device's UI is still the older build: the new Device Access / Debug Report / last-outage UI is not visible until a full install.

## Not verified / open

- IPv6 last-outage WAN path (no IPv6 WAN on this SIM).
- QCAINFO NR SCC SINR field jumps 69 / 2078 / 746 between 2 s samples (parsed /100) while QSINR NR stays ~28: unclear whether that field is SINR. Out of scope.
- The frontend for P1/P2/P6 is not on the device; a `bun run package` install would prove the UI end to end.
