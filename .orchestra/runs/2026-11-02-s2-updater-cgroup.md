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
- Not yet proven: a real UI OTA and downgrade on a device (needs user yes + PM slot). Note: the OTA *to* this build runs the device's old worker, so the detach is first exercised by the update *after* it — the device proof needs two installs (this build, then a downgrade or a re-install of this build).
