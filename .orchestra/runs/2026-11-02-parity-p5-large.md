# Run: P5 Large wave — Watchdog backend + Tailscale exit node (plan v2, awaiting OK)

Roadmap: `.orchestra/runs/2026-10-31-rm551e-ui-parity.md` P5 (D4: port backend gaps, verified on the RM520N-GL).
Base: development 931f08cf. RM520N-GL writes held until the atd PM grants a slot
(`.orchestra/runs/2026-11-02-rm520n-outage.md`). Other lead's open branches touch `install_rm520n.sh` (S2) and
`qmanager_poller` (S6); this plan edits neither. v2 folds in the qm-advocate challenge (10 points).

## Recon facts
- `qmanager_watchcat` is one 995-line script (loop :811-995, reload :879, `write_state` :183, bare `main "$@"` :995).
  Libs ship by glob: install `install_rm520n.sh:1777-1779`, OTA runs `install_rm520n.sh --force`
  (`qmanager_update:275`), uninstall `rm -rf $LIB_DIR` (`uninstall_rm520n.sh:393`), stale-lib prune :3570.
  New libs need no installer edit (advocate confirmed).
- `qm_config_init` returns on any non-empty file (`config.sh:14`): new keys reach OTA'd devices only through reader
  defaults. Daemon and CGI defaults already disagree for `enabled` (watchcat:142 = 1, watchdog.sh:92 = 0).
- `finish_cooldown` judges by reachability only (watchcat:710); watchcat has no mono clock, holdoff or start gate.
- Tailscale `up --reset …` on every Connect (`vpn/tailscale.sh:487`) clears `--advertise-exit-node`.
- Neither device has Tailscale installed, so its netfilter chains / table 52 / MASQUERADE cannot be probed yet.

## Step 0a — read-only probe now-able (one slot, both devices, prove serial first)
`ls /sys/devices/platform/*mss*/subsys*/`; `cat …/subsys0/{state,crash_count,restart_level}`;
`cat /etc/qmanager/.modem_crash_count_last /etc/qmanager/modem_crashes.json`; `dmesg | grep -i 'remoteproc\|fatal error' | tail`;
`cat /proc/sys/net/ipv4/ip_forward /proc/sys/net/ipv6/conf/{all,rmnet_data0}/{forwarding,accept_ra}`;
`ip -6 route show default`; `ip rule show`; `iptables -S FORWARD`; `iptables -t nat -S POSTROUTING`.
Step 0b (exit node only): same netfilter/route reads after an OK'd Tailscale install, exit node advertised.

## Session W — Watchdog backend (Opus; worktree; commits C, A, B)
Common: one defaults table per key shared by daemon and CGI (grep check after build); mono clock from
`/proc/uptime`; add a `WATCHCAT_NO_MAIN` guard so libs and functions can be dry-run without starting a ladder;
deploy libs before the watchcat; never source the watchcat itself on a device.
- **C SSR grace** (`wd_ssr.sh`): sysfs `state`/`crash_count`, own baseline at watchcat start (count resets per
  boot), sampled on every pass incl. cooldown/locked/stale paths; unreadable state = ONLINE (RG501Q path unproven);
  hold ladder up to `ssr_grace` (45 s). Keys `ssr_aware` (1), `ssr_grace` (45).
- **A Quality detection** (`wd_quality.sh`): breaches of the Connection Quality thresholds for
  `quality_consecutive` (5) samples start a quality recovery that is **capped** (see call 2), with a quality
  cooldown verdict (recovered = below thresholds, not just reachable), the sample window reset after every tier, a
  15-min holdoff after a failed quality recovery, and a floor so 1 ms / 1 % custom limits cannot trip it.
  `quality_thresholds.sh` also touches `/tmp/qmanager_watchcat_reload` (the shared events flag is consumed by the
  poller). Key `quality_enabled` (0).
- **B Primary recheck** (`wd_recheck.sh`): gated on failover active AND `tier3_enabled`; mono-clock interval
  (`primary_recheck_interval` 30 min, `primary_recheck_enabled` 0); swap via the Tier-3 sequence, apply the
  primary's profile before the verdict, restart `qmanager_tower_failover` on failback, give up after 3 failed
  rechecks until the next manual save or boot.
- Validation: gates; `busybox-portability-checker`; blind `qm-verifier`; device (slot + user OK each step):
  dry-run libs from /tmp against live state, then a real watchcat deploy + restart (disruptive — ask). B live swap
  only with explicit OK and two SIMs; else ships default-off, logic-verified.
- Rollback: revert the merge; keys are additive and ignored by the old watchcat.

## Session T — Tailscale exit node (Sonnet; worktree; only if call 4 = build)
- Intent flag like SSH: CGI `set_exit_node` writes the intent, then `set --advertise-exit-node=…`; every Connect
  re-adds `--advertise-exit-node` to `up --reset …`. Sudoers: exact lines for `set --advertise-exit-node\=true|false`
  and each `up --reset --accept-dns\=false [--ssh] --advertise-exit-node` form.
- State: GET reports advertised (from prefs) and approved (`Self.ExitNodeOption`) separately, so the pill does not
  snap back while approval is pending; card says it needs approval in the admin console and that peers using it can
  reach the modem's LAN unless the ACL limits them to `autogroup:internet`.
- Forwarding: IPv4 only. If 0a shows `ip_forward=1` already (QCMAP NAT), change nothing. If a write is needed,
  record the value found and restore that value, never write 0; no IPv6 forwarding (would make rmnet ignore RAs).
  Any unit hook uses `ExecStartPost=-…`; then install/OTA/uninstall lockstep + `installer-safety-auditor` before
  and after.
- Validation: gates, verifier, auditor (sudoers), 0b probe on a device with an OK'd Tailscale install.
- Net-fixes: dropped (no fw4/mwan3 on RM520N) unless 0b shows tailnet replies leaving via rmnet.

## Decisions (user, 2026-11-02)
1. SSR source: sysfs.
2. Quality recovery: Tier 1-2 only, never a reboot.
3. Primary recheck: default-off, give up after 3, logic-verified; live SIM-swap test only on a later OK.
4. Exit node: **deferred** until a device has Tailscale installed. Session T is not started; net-fixes dropped.
So the wave is Session W only, plus the Step 0a probe when the atd PM grants an RM520N-GL slot.
