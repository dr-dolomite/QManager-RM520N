# S7 — `+QMAP` guard after a QCMAP restart (2026-11-02)

Board: `2026-10-26-atd-poller-port.md` (S7, PM owns it). Defect F2 from S5 proof 2. Branch `claude/epic-cannon-d6acbf`.

## Understand

- Worktree was cut from `main` 7a7007c1; reset (0 own commits, clean) to `development` dcc80644. `.env` copied, `git check-ignore .env` holds.
- Evidence (no device touched by S7; read from S5's notes and transcript, R6 notes):
  | | R6 F1, RG501Q-EU | S5 F2, RM520N-GL 61368cd2 |
  |---|---|---|
  | QCMAP | SIGKILLed by the vendor stack, not restarted | `systemctl stop` (refused 3×, 10 ms) → `start` at uptime ≈221 s, new PID 8099 |
  | First QMAP | while QCMAP absent (before S1's guard) | `AT+QMAP="WWAN"` at uptime 230.9 s, 9 s after start; deadline kill 08:28:12, `AT channel down` 08:28:19 |
  | atfwd | restarted in the same second as the kill | untouched until the recovery attempt |
  | Recovery | `systemctl restart qmanager-atd` (fresh open): no reply | `systemctl restart atfwd` 08:40:31: no recovery in 2 min |
  | What cleared it | reboot | warm reboot 08:42:38 |
  | Data path | already down (carrier) | stayed up |
- QMAP is safe when QCMAP was started by the boot itself: QCMAP at 8.7–8.9 s uptime on three RG501Q boots, the poller's boot-only QMAP reads at ~40 s, no wedge (R6 proof 1, proof 2). RM520N-GL boot QCMAP start time is not yet measured.
- No evidence of a warm-up that ends: one sample, 9 s after start, wedged. Testing longer delays costs a reboot per sample, and on the RG501Q-EU QCMAP cannot be restarted after boot at all (`systemrw.mount` bad-setting).
- Keying on atfwd (option c) has no support: restarting atfwd after the wedge did not help, and F2 shows the wedge with atfwd never touched. Whether an atfwd restart *before* the first QMAP would make it safe is unknown and would need another disruptive test.
- Callers hit by a persistent refusal: poller Tier 2 sends `AT+CGCONTRDP;+QMAP="WWAN"` as one compound when `qcmap_up` says yes (systemd `ActiveState=active` is true after a restart) → whole compound refused → APN/WAN IP lost every cycle until reboot. `cgi_at.sh::detect_active_cid` sends `AT+CGPADDR;+QMAP="WWAN"` → refused → falls back to CID 1. Others (`ip_passthrough.sh`, LAN card, boot-only reads) are QMAP-only and simply fail.

## Plan (stop for OK)

Choice: **(a)** — refuse `+QMAP` when the running QCMAP started after the boot window, until the next boot.

1. `at/qcmap.rs`: new `State::Restarted`. `probe` reads `<proc_root>/<pid>/stat` of the matching comm, field 22 (`starttime`, clock ticks since boot; parse after the last `)`), divides by `sysconf(_SC_CLK_TCK)`. Start > `BOOT_WINDOW` = 120 s → `Restarted`; unreadable/unparsable stat → `Restarted` (fail closed, like S1's unreadable comm). `refuses()` refuses `Stopped` and `Restarted`; WARN once per change of reason: `QCMAP restarted after boot (started at Ns): refusing AT+QMAP until reboot`. `--qcmap` prints `qcmap=restarted`. Tests on the fake proc root (stat files): boot start → Running, late start → Restarted, garbage stat → Restarted, comm with spaces/parens parsed right.
2. Wire: `Code::ModemNotReady` unchanged, no proto bump (stays 3). Crate 0.7.6 → 0.7.7.
3. Poller `qcmap_up`: ask the broker's own view instead of systemd — `qmanager_atd --qcmap`; `running` or `absent` or empty output (binary missing = no qcmd either) → up, `stopped`/`restarted` → down. Same WARN/INFO transition lines with the state named. Tier 2 then sends plain `AT+CGCONTRDP`. Drops the `systemctl show` fork. busybox checker on both devices.
4. `cgi_at.sh::detect_active_cid`: if the compound reply has no `+CGPADDR:` line, retry `AT+CGPADDR` alone so a refused QMAP does not cost the CGPADDR fallback. Small; drop it if you'd rather keep S7 to the broker + poller.
5. No broker recovery after a QMAP wedge: atd restart (F1c) and atfwd restart (F2) both failed; only reboot cleared it. The existing down/backoff behaviour stays. Surfacing "AT port wedged, reboot needed" in the UI is a follow-up, not S7.
6. armv7 musl build, refresh `dependencies/qmanager_atd`; `cargo test` as user + root; blind `qm-verifier`; `docs/reference/at-command-transport.md` QMAP paragraph.

Device proof (later, PM slot + your yes each time; RM520N-GL only, the RG501Q cannot restart QCMAP): read-only first — `/proc/<qcmap>/stat` start time on a fresh boot (confirms 120 s fits the RM520N) and `--qcmap` = `running`. Disruptive — `/tmp` copy is not enough, the broker must be the new one: deploy atd + poller, `systemctl stop/start QCMAP`, expect `qcmap=restarted`, `qcmd AT+QMAP="WWAN"` refused fast, poller Tier 2 still fills APN/WAN IP, AT channel stays up for 10 min, then a reboot to clear the state (expect `running` again).
Risk: a manual QCMAP restart inside the first 120 s of uptime still slips through; a QCMAP that the boot starts later than 120 s (slow boot) loses QMAP reads until the next reboot (degraded, logged). Rollback: revert the branch.

## Log
- Plan approved by the user ("Yes, build all"), 2026-11-02.
- Build: `at/qcmap.rs` `State::Restarted(Option<u64>)`, `BOOT_WINDOW_SECS` 120, `start_ticks` (field 22 after the last `)`), earliest QCMAP wins, WARN per change of reason; exec test for a restarted QCMAP (compound `AT+CGCONTRDP;+QMAP`). Poller `qcmap_up` → `qmanager_atd --qcmap`. `cgi_at.sh::detect_active_cid` retries plain `AT+CGPADDR`. Crate 0.7.7, proto 3.
- `cargo test`: 328 passed as user and as root (WSL). One test-only miscount (fake stat filler 19 → 18) fixed before the run.
- armv7 musl release (`--locked`, toolchain 1.99.0): md5 **a5018749** = `dependencies/qmanager_atd` (was b2441f56). Build warnings predate S7.
- Docs: `at-command-transport.md` QMAP paragraph.
- Validation on e9b9b9ca (no device touched; S5 held both): busybox-portability-checker **SAFE TO SHIP** locally (bash + dash stubs; no real BusyBox / bash 3.2; device run owed). Blind qm-verifier **PASS_WITH_NOTES**: 328 user + root, fresh armv7 md5 = a5018749, field 22 parse checked against proc(5). Acted on in cbd9adcd: doc said "9 s" for both devices (RG501Q-only data) and missed the third WARN text; `profiles/current_settings.sh` compound `AT+CGDCONT?;+CGSN;+QCCID;+CGPADDR;+QMAP="WWAN";+QSPN` would return nothing after a restart → re-sends without the QMAP leg (`sh -n` ok). Not acted on: `detect_active_cid` fallback loses the QMAP CID (documented); its retry also fires on `modem_busy` (one extra lock wait); `Restarted(None)`→`Restarted(Some)` logs no new WARN; per-command WARN in the in-process fallback (pre-existing).
- **Open, high:** the RM520N-GL boot QCMAP start time is unmeasured. If it is > 120 s, every boot refuses QMAP. First item of the device slot (read-only).
- **Device part 1 (PM grant, read-only), RM520N-GL 61368cd2, 2026-11-02 09:00–09:01 PST:** serial proven. Current boot is S5's recovery reboot (08:42:38), uptime 577–652 s, so the PM's reading (a) "restarted on the current boot" was no longer available; this is reading (b). QCMAP PID 437, `/proc/437/stat` starttime **695 ticks ≈ 7 s** after boot (RG501Q-EU: 8.7–8.9 s), far inside the 120 s window. `/tmp/s7` copy md5 a5018749, `0.7.7 proto=3`; `--qcmap` = `qcmap=running` rc 0 as root and as www-data (`sudo -n -u`). `--qcmap` scans /proc only (static: `main.rs` Mode::Qcmap → `Qcmap::system().state()`, no socket). No AT sent; installed atd b2441f56 PID 1878 untouched; `/tmp/s7` self-deleted (`cleaned: yes`). The restarted reading on a real `/proc` is left for part 2.
