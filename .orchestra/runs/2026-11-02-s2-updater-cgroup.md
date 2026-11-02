# S2 — UI updater outside lighttpd's cgroup; rollback installer (2026-11-02)

Board: `.orchestra/runs/2026-10-26-atd-poller-port.md` (PM owns it). Branch `claude/s2-updater-cgroup-dc45b4`, fast-forwarded from a05c4e92 (299 behind) to `development` c2b39b37.

## Recon (facts)

- Spawn sites: `system/update.sh:385` (download), `:399` (install_staged), `:417` (install), `:437` (rollback) — all `( sudo -n "$UPDATER" … & )` → updater lives in `lighttpd.service`'s cgroup.
- Auto-update: `qmanager_auto_update:180` `exec "$UPDATER" install …` from its own timer unit — not in lighttpd's cgroup.
- Installer deferral: `install_rm520n.sh:3970-3978` (cgroup grep), verify skip `:4072`, `lighttpd -tt` `:4095`.
- Installer/uninstaller unit scans are filesystem globs over `/lib/systemd/system/qmanager-*.service` (`install:1580,3558,3794`; `uninstall:209,331`) — a transient unit in `/run/systemd/transient` is never seen.
- `qmanager_svc:41` accepts any `qmanager-?*` → a transient unit named `qmanager-*` could be stopped by www-data. Name it outside that prefix.
- CGI busy check: `update.sh:58,213` read `/tmp/qmanager_update.pid` via `pid_alive` (`/proc/$pid` exists).
- The CGI `rollback` action has no UI caller (`software-update.md` > Out of scope). The UI's real downgrade is the version picker → `download <older>` → `install_staged`, which also runs the target's own installer.
- sudoers: `scripts/etc/sudoers.d/qmanager:125` `www-data ALL=(root) NOPASSWD: /usr/bin/qmanager_update`.

### Device probe (read-only, both devices, 2026-11-02)

| | RM520N-GL `61368cd2` | RG501Q-EU `b7e3d6f1` |
| --- | --- | --- |
| `/usr/bin/systemd-run` | yes (systemd 244) | yes (systemd 239) |
| `--no-block --collect --quiet -E` | all present | all present |
| transient unit cgroup | `0::/system.slice/qmprobe-s2.service` | same |
| env via `-E`, `INVOCATION_ID` set | yes | yes |
| 2nd start, same name, while active | rc 1 "already exists" | same |
| failed unit with `--collect` | `LoadState=not-found` after exit | same |

## Plan

**Task 1 — self re-exec, no sudoers change.**
`qmanager_update` already runs as root via the existing bare-path grant, so it can call `systemd-run` itself. At the top (before the "Lock & setup" block, so the outer instance touches nothing):

```sh
if [ -z "${QM_UPDATE_DETACHED:-}" ] && grep -q 'lighttpd\.service' /proc/self/cgroup 2>/dev/null \
   && command -v systemd-run >/dev/null 2>&1; then
    systemd-run --unit=qm-update-worker --no-block --collect --quiet \
        -E QM_UPDATE_DETACHED=1 /usr/bin/qmanager_update "$@" && exit 0
    # unit already exists = an update is running: refuse, never run a second copy in place
    [ "$(systemctl show -p LoadState --value qm-update-worker 2>/dev/null)" = "not-found" ] || exit 1
    # else fall through: run in place (old behaviour; installer's cgroup deferral covers it)
fi
```

- Re-exec only from lighttpd's cgroup: auto-update and SSH runs stay as today.
- Unit name `qm-update-worker` (not `qmanager-*`, so `qmanager_svc` cannot touch it). The fixed name also closes the PID-file race between two rapid POSTs.
- `--collect` → nothing persists; uninstall needs no change (auditor to confirm).
- `update.sh` unchanged: same `sudo -n "$UPDATER" …` lines; args still validated by the inner instance.
- systemd 239 `systemctl show --value` must be checked on the RG501Q; fallback `sed 's/^LoadState=//'`.

**Deferral — user call.** In the transient unit the cgroup check no longer matches, so the new installer would restart lighttpd mid-install. That restart is now safe (it cannot kill the updater), but a 2 s status poll that hits the ~1 s gap takes the hook's `catch` branch and navigates to `/reboot/` early; that page's one-shot `reboot_ack` is then discarded by `wait_for_reboot_ack` (it `rm`s the file first) → 20 s timeout.
- **(A, recommended)** keep the deferral, keyed on an explicit flag: `qmanager_update` exports `QM_DEFER_LIGHTTPD_RESTART=1` for the installer; installer defers when the flag is set **or** the cgroup names lighttpd. The cgroup arm must stay anyway: the first OTA *to* this version runs the device's old worker inside lighttpd's cgroup. Auto-update also defers (a reboot always follows a successful install).
- **(B)** drop the flag; new installer restarts lighttpd during UI OTA; keep only the cgroup arm for the rollout hop. Accepts the early-`/reboot/` blip.

**Task 2 — rollback / downgrade runs the target's installer: keep it, guarded.**
- *Current installer + old payload* is not viable: `build.sh` bakes `VERSION` into the installer, so it stamps the current version and `post_install_check` fails; its file lists, `cleanup_legacy_scripts` and migrations assume the current payload (it would delete or expect files the old tree lacks). Risk: high, silent layout damage.
- *Target installer (keep)*: Task 1 removes the worst inherited bug — an old installer's `systemctl restart lighttpd` from inside lighttpd's cgroup hung until lighttpd's stop timeout SIGKILLed the whole cgroup, installer included. Out of the cgroup it is a ~1 s restart. Remaining risk: any other bug in the old installer is inherited (same as today); updater-side guards stay (`rollback_prep_at_lock`, checksum, tag pin). Optional: a rollback floor (refuse targets older than a named release) — user call, not in this change unless asked.

**Lockstep:** installer (flag arm), updater (re-exec + export), uninstall (nothing persistent; verify). Docs: `qmanager-independence.md` cgroup section + WARNING/NOTE rewrite, `software-update.md` reboot-handoff line, BACKEND.md §7 if the grant table mentions it. `RELEASE_NOTES.md` bullet (Improvements: updates and downgrades from the web UI no longer depend on the web server staying up).

**Gates:** CRLF + `sh -n`; installer-safety-auditor after; busybox-portability-checker (both devices); blind qm-verifier; device: UI OTA current→this build, then UI downgrade to v0.1.17 and back — needs user yes + PM slot.

## Log

- 2026-11-02 recon + probe done; plan gate → installer-safety-auditor.
- 2026-11-02 auditor plan gate: **CLEAR**, no must-fix. Folded in: (a) re-exec test widened to `lighttpd\.service|qmanager-auto-update\.service` — `stop_services` (`install:1580-1590`) stops the auto-update oneshot that `exec`s the updater, so an unattended OTA may stop its own parent (inferred, not proven); (b) on "already exists" retry once after 2 s, then write an `error` status instead of exiting silently; (c) place the re-exec after the `PATH` export (`qmanager_update:43`); (d) flag exported only by `qmanager_update`. `systemctl show --value` proven on systemd 239. Waiting for the user's OK.
- 2026-11-02 user: "Yes, build with A". Built: detach block in `qmanager_update` (retry once, exit 1 without a status write on a live unit), `QM_DEFER_LIGHTTPD_RESTART=1` on the installer line, installer flag-or-cgroup deferral. Gates: auditor post-check **CLEAR**; portability **SAFE TO SHIP** (both devices, stubbed worker: detach, env, exists→retry→rc 1, not-found fall-through, `VAR=1 sh x &`); qm-verifier **PASS_WITH_NOTES**. Verifier note acted on: systemd 239/244 expand `$VAR` in unit args (probe: `'$HOME'` dropped, `""` and `%n` kept, n=4 of 5) → args with `$` skip the detach. Stale comments at `install:4061` and the run_install block fixed. Docs: `qmanager-independence.md` section rewritten, `software-update.md` anchor, RELEASE_NOTES Improvements bullet.
- 2026-11-02 PM granted the RM520N-GL slot for the 3-step proof (user's yes still needed per install). Baseline 61368cd2: VERSION v0.1.18-draft, no VERSION.pending, atd 0.7.3 md5 a643c60b, qmanager_update md5 2c2c9756, previous_version v0.1.18-draft, /usrdata 52% (59 MB free). Tarball from 480cdd32 carries atd 0.7.4 (S1's 0.7.5 not merged, per PM).
- 2026-11-02 step 1: tarball sha256 99329f45… built from 480cdd32 (atd 0.7.4), scp'd, `install_rm520n.sh --force --no-reboot` over SSH (detached). Log clean, no VERSION.pending, /usr/bin/qmanager_update md5 1ab24a87 (= HEAD), "lighttpd restarted with QManager config" (SSH path, expected). Rebooted with `reboot`.
- After the reboot the modem has been unreachable for 15+ min. Path: host Wi-Fi → 192.168.8.1 → Tailscale 100.108.49.113 (the user's GL router; it rejects the modem creds) → 192.168.225.1: no ping, no HTTP/S, no SSH. The user reports the GL router, whose WAN is on the modem's LAN, is "stuck on Connecting". Serial and uptime after the reboot are not proven. Possible causes: still booting or looping; QCMAP/DHCP not serving (compare I1); a bridge0/LAN change. PM advised the user to reconnect the GL WAN or replug the cable first; a modem power-cycle needs the user's yes here. On recovery, check: serial, uptime, `systemctl --failed`, QCMAP_ConnectionManager, `df /usrdata`, 0-byte `/etc/data/*.xml`, bridge0 addr/mask, qmanager units reached.
- Recovery (user power-cycled; modem now on the user's laptop Ethernet, weak signal): 61368cd2, uptime 494 s at 07:56:58, `degraded` from vendor units pcie (rc 2), pcie-diag, r8168 (rc 1; NIC loads as r8125, eth0 UP carrier 1 in bridge0), ql_ctcc_selfreg — none touched by QManager. QCMAP_ConnectionManager running; /usrdata 53%; no 0-byte /etc/data/*.xml; bridge0 192.168.225.1/24; VERSION v0.1.18-draft, no .pending; all qmanager units NRestarts 0; lighttpd active; atd md5 23be0cb4 (0.7.4), qmanager_update 1ab24a87. /tmp lost. mtimes: VERSION 06:44:14, qmanager_atd 06:44:15, qmanager_update 06:44:31, lighttpd.conf 06:44:35. /var/log/messages{,.0} and wtmp present (left for the investigator).
- Step 2 (UI downgrade path through lighttpd: curl to https://127.0.0.1 with a minted session):
  - `download v0.1.17`: updater pid 19200 in `/system.slice/qm-update-worker.service` (detach proven from lighttpd's cgroup). 1st try: download timeout at 120 s (~54 KB/s link); unit then `inactive` (--collect). 2nd try: ready in 93 s, SHA-256 eaadd1ea… verified.
  - `install_staged`: updater pid 25372 in qm-update-worker.service. v0.1.17's installer restarted lighttpd (MainPID 1595 → 27820 between t=14 and t=16 s), worker kept going, `rebooting` at t=26 s, `reboot_ack` via lighttpd HTTP 200, log "Waiting up to 20s for /reboot/ ack...".
  - Seen: the poll right after a POST can read the previous run's status for a moment (the stale-status window the auditor noted).
- Step 2 warm reboot (updater's own `reboot` inside qm-update-worker): back in ~50 s (up 55 s at 08:06:34). VERSION v0.1.17, previous_version v0.1.18-draft, lighttpd active, all qmanager units NRestarts 0, same 4 vendor failures. No pre-reboot capture (the PM's request arrived after it).
- Step 3: SSH install of the same tarball (sha256 99329f45…). Log in /usrdata/s2inst3.log, clean, 40 s. Deployed vs tarball: usr/bin + usr/lib/qmanager 79/79 match; cgi-bin 87/88 (only `operator-list.json` differs, a data file). Pre-reboot capture /usrdata/s2_prereboot3.txt: no jobs, no deactivating units, qm-update-worker not-found. `reboot` at 08:08:50 (same command as step 1); /usrdata/s2_shutdown3.txt got 3 samples (08:08:50–51, then the stop jobs queued). Back at ~08:09:01 (shutdown ~10 s): up 33 s at 08:09:34. Final at up 72 s: 61368cd2, VERSION v0.1.18-draft, no .pending, atd 0.7.4 md5 23be0cb4, qmanager_update md5 1ab24a87, bridge0 192.168.225.1/24, UI https 200, WAN ping ok, all qmanager units NRestarts 0, `degraded` only from pcie, pcie-diag, r8168, ql_ctcc_selfreg. The step-1 warm-reboot hang did NOT recur with the same build and command; the difference is that the modem now sits on the laptop's Ethernet instead of behind the GL-X2000.
- Correction (investigator): on 61368cd2 `/sbin/reboot` is a symlink to `/bin/systemctl`, so every reboot here (steps 1–3, and the updater's) was `systemctl reboot`. The investigator's probe at uptime 149 s saw the step-3 reboot, not an extra one. PM's marker A/B request arrived after step 3 had run, so no markers were used.
- Minted session removed (lost with /tmp anyway). Left on the device for the investigator: /usrdata/s2inst3.log, s2_prereboot3.txt, s2_shutdown3.txt.
- Not yet proven: a real UI OTA and downgrade on a device (needs user yes + PM slot). Note: the OTA *to* this build runs the device's old worker, so the detach is first exercised by the update *after* it — the device proof needs two installs (this build, then a downgrade or a re-install of this build).
