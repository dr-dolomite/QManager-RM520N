# Reference Docs

> **Applies to:** RM520N-GL (SDX65) · verified 2026-08
> **RG501Q-EU (SDX55):** unverified — see [`platform-matrix.md`](./platform-matrix.md)

This file is the **router**. One row per reference doc, and each row lists only the concrete names that doc governs — routes, scripts, binaries, symbols, config keys, `/tmp` files. If your task touches any trigger in a row, read that doc before you edit; if it touches none of them, read nothing. The rows say *when* to open a doc, never *what* it says: the invariants, gotchas and rationale live in the doc itself, and this table is deliberately not a summary of them. Read only the matching doc, not its neighbours.

**Scope** is the device a doc's facts were measured on: `RM520N` (RM520N-GL only), `RG501Q` (RG501Q-EU only), `Both`.

### Cellular

| Doc | Triggers | Scope |
| --- | --- | --- |
| [antenna-alignment.md](antenna-alignment.md) | `/cellular/antenna-alignment`, the composite aim score, the recorder sampling gate, `scoreSnapshot`, and the two shared primitives `components/cellular/condition-screen.tsx` and `components/cellular/signal-quality-display.ts` | RM520N |
| [antenna-statistics.md](antenna-statistics.md) | `/cellular/antenna-statistics`, `signal_per_antenna`, `ANTENNA_PORTS`, and the `SIGNAL_SENTINELS` / `normalizeSignalValue` / `isPortReporting` boundary in `types/modem-status.ts` | RM520N |
| [band-locking.md](band-locking.md) | `/cellular/cell-locking`, `unlockAll`, `failover.watcher_running`, `resolveScheduledScenario`, `prevLockedKey`, `categoryShortKey`, the band chip grid and the on-air carrier tile | RM520N |
| [carrier-aggregation.md](carrier-aggregation.md) | `AT+QCAINFO`, `parse_ca_info()`, `network.carrier_components[]`, `lib/carrier-aggregation.ts`, the dashboard CA strip | RM520N |
| [cell-scanner.md](cell-scanner.md) | The three `/cellular/cell-scanner/` routes, `AT+QSCAN`, `AT+QENG="neighbourcell"`, `/tmp/qmanager_long_running`, `/tmp/qmanager_scan.lock`, `earfcnHistory`, `CellScanResult`, `NeighbourCellResult`, `LEDGER` / `LedgerRows`, `simPlmnFromImsi` / `cellMatchesSim`, `signalSortingFn` | RM520N |
| [cellular-basic-settings.md](cellular-basic-settings.md) | `/cellular/settings`, `cellular/settings.sh`, `AT+QUIMSLOT` / `AT+CFUN` / `AT+QNWPREFCFG` / `AT+QSIMDET`, `use-cellular-settings.ts`, `mode_pref`, the poller's `.sim` block, `network.type` | RM520N |
| [cellular-settings-family.md](cellular-settings-family.md) | `components/cellular/settings/shapes.ts`, `apply-foot.tsx` (`ApplyFoot`) and all five `/cellular/settings/` routes — `network_priority.sh` / `rat_acq_order` / `RAT_RANK_TONE`, `imei.sh` / `qm_imei_reboot_pending`, `fplmn.sh` / `AT+CRSM`, `FIELD_SHELL` | RM520N |
| [frequency-locking.md](frequency-locking.md) | `/cellular/cell-locking/frequency-locking`, `AT+QNWCFG`, `lte_earfcn_lock`, `nr5g_earfcn_lock`, `tower_lock_lte_active` / `tower_lock_nr_active`, `LOCK_BADGE` | RM520N |
| [radio-information.md](radio-information.md) | The `/cellular/` index, `lib/radio-info.ts`, `components/cellular/radio/**`, `resolveRadioMode`, `summariseRadio`, `enrichCarriers`, `carrierKey`, `scsInferred` | RM520N |
| [sim-detection.md](sim-detection.md) | `sim_db.sh`, `known_iccids`, `sim_registry.json`, `sim_db_add`, `sim_swap.detected`, the SIM-swap banner, the Tracked SIMs card | RM520N |
| [sim-profiles.md](sim-profiles.md) | `/cellular/custom-profiles`, the retired `connection-scenarios` redirect, `current_settings.sh`, `scenario_id`, `profile_managed`, `+QSPN`, `--auto` apply, suggested profiles, the schedule ribbon | RM520N |
| [sms-forwarding.md](sms-forwarding.md) | `/cellular/sms/forwarding`, `qmanager_sms_forward`, its seed-on-first-run / loop guard / retry state, the gated service unit, the dirty-row promotion | RM520N |
| [sms.md](sms.md) | `/cellular/sms`, `sms.sh`, the patched `sms_tool`, CPMS ME+SM storage routing, the boot routing oneshot, `components/cellular/sms/shapes.ts` | RM520N |
| [speedtest.md](speedtest.md) | Ookla CLI, `at_cmd/speedtest_check.sh` / `speedtest_servers.sh` / `speedtest_start.sh` / `speedtest_status.sh`, `PING_FLOOR_MS`, `lib/speedtest-phases.ts`, the dashboard tile and dialog | RM520N |
| [tower-locking.md](tower-locking.md) | `/cellular/cell-locking/tower-locking`, `AT+QNWLOCK`, `status.sh`'s `lte_read_ok` / `nr_read_ok` / `persist_read_ok`, `/tmp/qmanager_tower_write_inflight`, `qmanager_tower_failover`, `LEG_BADGE` | RM520N |
| [wan-profile-management.md](wan-profile-management.md) | `cellular/apn.sh`, `apn_apply.sh`, the six PDP contexts, `apn_setting.json`, any `AT+CGCONTRDP` or `AT+CGDCONT` parser, the APN Management page and its MBN card | RM520N |

### Local Network

| Doc | Triggers | Scope |
| --- | --- | --- |
| [custom-dns.md](custom-dns.md) | `/local-network/custom-dns`, the sentinel block in `/etc/data/dnsmasq.conf`, `<DNSMode>`, `blockCorrupt`, `clearSettings`, `action=clear`, `components/local-network/custom-dns/shapes.ts` | RM520N |
| [data-counter-platform-matrix.md](data-counter-platform-matrix.md) | The cross-SoC evidence behind the data counter's orientation map — per-device `/proc/net/dev` and `rmnet` direction measurements | RM520N |
| [data-usage-counter.md](data-usage-counter.md) | `/proc/net/dev` counters, the schema-v5 usage store, the static SoC-based orientation map, the data-usage cards | RM520N |
| [dpi.md](dpi.md) | `/local-network/traffic-engine`, `dpi_build_args()`, `dpi_state.sh`, `qmanager_dpi_run --clear`, `--rule-up`/`--rule-down`, `dpi_listener_present`, `svc_reset_failed`, tpws, `full_bypass`, `save_hostlist`, `sni_domain`, `components/local-network/traffic-engine/shapes.ts` | RM520N |
| [ethernet.md](ethernet.md) | `/local-network/ethernet`, `eth0`, `ethtool`, `qmanager_ethernet_apply`, `qmanager-ethernet.service`, `interface_present`, `components/local-network/ethernet/shapes.ts` | RM520N |
| [ip-passthrough.md](ip-passthrough.md) | `/local-network/ip-passthrough`, `AT+QMAP="MPDN_rule"` / `IPPT_NAT` / `DHCPV4DNS`, `AT+QCFG="usbnet"`, `ippt_config.json`, `.device.ippt_*`, `parse_ippt_*` (`parse_at.sh`), `qm_rebooting`, `components/local-network/ip-passthrough/**` (`status-strip.tsx`, `shapes.ts`) | RM520N |
| [lan-gateway-ip.md](lan-gateway-ip.md) | The unbuilt LAN gateway-IP editor — `/etc/data/mobileap_cfg.xml`, `APIPAddr`, `StartIP` / `EndIP`, `GatewayURL`, xmlstarlet | Both |
| [ttl-mtu.md](ttl-mtu.md) | `/local-network/ttl-settings`, `ttl.sh`, `mtu.sh`, `ttl_state.sh`, `/etc/qmanager/ttl_state`, the `rmnet+` mangle rules, `autostart`, `components/local-network/ttl-mtu-settings/shapes.ts` | RM520N |

### Monitoring

| Doc | Triggers | Scope |
| --- | --- | --- |
| [alerts.md](alerts.md) | `/monitoring/alerts`, `components/monitoring/alerts/**`, `use-alerts.ts`, `monitoring/alerts.sh`, top-level `alert_after_min` in its GET/POST, `alert_engine.sh`, `discord_alerts.sh` / `/tmp/qmanager_discord_spool`, `alert_routing.json`, `reboot_history.json` / `last_boot_id`, `/tmp/qmanager_{sms,email,discord}_log.json` and their `qmanager_setup` seeds, `/etc/qmanager-secrets/`, `qmanager_secret_set`, `qmanager_email_send`, `token_set` / `app_password_set` | RM520N |
| [connection-quality.md](connection-quality.md) | `qmanager_ping`, `/tmp/qmanager_ping.json`, `conn_state.sh`, `ping_profile.json`, `quality_thresholds.json`, `alert_after_min`, `detect_data_connection_events`, `/tmp/qmanager_dns.json`, `dns_lookup_ms`, `connectivity.status`, `connectivity.thresholds`, `packet_loss_pct`, `jitter_ms`, `PRESET_LIMIT`, `/monitoring/connection-quality`, the dashboard Internet chip | RM520N |
| [connection-watchdog.md](connection-watchdog.md) | `/monitoring/watchdog`, `qmanager_watchcat`, its 4-tier recovery ladder, `verify_quimslot`, `interval_sec`, the ping-cache staleness threshold, `use-watchdog-form` scoped saves, `deriveTimeline`, the status card probe strip | RM520N |
| [discord-bot.md](discord-bot.md) | `discord-bot/` (incl. `session.go` connect retry, `spool.go` drain), `qmanager_discord`, `qmanager-discord.service`, `build-discord-bot.sh`, the slash commands, `/etc/qmanager/discord_dm_channel` | RM520N |
| [latency-monitor.md](latency-monitor.md) | `/monitoring/latency`, `components/monitoring/latency-monitoring/**` (`now-card.tsx`, `history-card.tsx`, `sites-card.tsx`, `manage-sites-dialog.tsx`, `site-mark.tsx` / `SITE_MARKS`, `derive.ts`, `shapes.ts`), `hooks/use-sites.ts`, `types/sites.ts`, `resolveCuts`, `deriveHistory`, `siteAverage`, `LIVE_POLL_MS`, `dataRange`, `latencyMonitor.*` keys | RM520N |
| [recent-activities.md](recent-activities.md) | `events.sh`, `_ev_settle`, `_ev_ca_check`, `ca_change`, `/tmp/qmanager_events.json`, `fetch_events.sh`, `use-recent-activities`, `lib/event-presentation.ts`, `splitEventMessage`, `components/monitoring/network-events/` (`derive.ts`, `now-card.tsx`, `activity-card.tsx`), `RUN_MIN`, `describeWindow` | RM520N |
| [sites-monitor.md](sites-monitor.md) | `qmanager_sites`, `qmanager-sites.service`, `monitoring/sites.sh`, `/etc/qmanager/sites.json`, `/usrdata/qmanager/sites/`, `/tmp/qmanager_sites*` (incl. the `qmanager_sites_live` lease), `range=now`, `live_at`, `LIVE_LEASE_SEC` | RM520N |
| [tailscale.md](tailscale.md) | `/monitoring/tailscale`, `vpn/tailscale.sh`, `qmanager_tailscale_mgr`, `tailscaled`, `/etc/qmanager/tailscale_ssh`, `TailscaleView`, any `tailscale up` invocation | RM520N |

### System Settings

| Doc | Triggers | Scope |
| --- | --- | --- |
| [at-terminal.md](at-terminal.md) | `/system-settings/at-terminal`, `constants/at-commands.ts`, `components/system-settings/at-terminal/**`, `BLOCKED_RULES` / `WARNING_RULES`, the `AT+GAME` Signal Storm launch seam, `appendEntry`'s foot-follow scroll rule | RM520N |
| [languages.md](languages.md) | `/system-settings/languages`, `hooks/use-language-packs.ts`, `lib/i18n/resolve-error.ts`, `components/system-settings/languages/**`, `manifest_error`, `TAG_ON_TONAL` | RM520N |
| [logs.md](logs.md) | `/system-settings/logs`, `system/logs.sh`, `hooks/use-system-logs.ts`, `types/system-logs.ts`, `components/system-settings/logs/**`, the `level` / `lines` / `total` fields | RM520N |
| [scheduled-timers.md](scheduled-timers.md) | Any scheduled operation — `schedule_timer.sh`, `OnCalendar`, `OnBootSec`, `qmanager_scheduled_reboot_arm`, `qmanager_tower_schedule_arm`, the `armed` flag, the 1970 boot window | RM520N |
| [software-update.md](software-update.md) | `/system-settings/software-update`, `system/update.sh`, `hooks/use-software-update.ts`, `components/system-settings/software-update/**`, `UpdateView`, `auto_update_time`, `previous_install_failed`, `download_size` | RM520N |
| [system-settings.md](system-settings.md) | The `/system-settings` **index only** — `components/system-settings/shapes.ts` and `derive.ts`, `timezone_applied`, `formatOffset`, `useKnownSims`, `scheduled_reboot` | RM520N |
| [timezone.md](timezone.md) | `/etc/localtime`, `qmanager_timezone_apply`, `sys_get_effective_tz`, `/opt/share/zoneinfo`, the timezone picker | RM520N |
| [web-console.md](web-console.md) | `/system-settings/web-console`, `hooks/use-web-console.ts`, `qmanager-console.service`, `components/system-settings/web-console/**`, `ConsoleFailureKind`, `terminal-theme.ts` | RM520N |

### Dashboard

| Doc | Triggers | Scope |
| --- | --- | --- |
| [dashboard-chart-cards.md](dashboard-chart-cards.md) | The Device Metrics, Connection Quality and Signal History cards, `connection-quality.tsx`, `QUALITY` in `components/dashboard/shapes.ts`, `connection_quality.*` keys, the dashboard Speed Test row, `hooks/use-chart-motion.ts`, recharts, the chart draw-in entrance class, `MetricBar`'s `baseTone` / `colorOverride` | Both |
| [dashboard-state-motion.md](dashboard-state-motion.md) | `TickGroup`, `use-value-tick.ts`, `SwapLabel`, the status-chip morph, and `SaveButton` / `SAVE_CHECK_OVERSHOOT` anywhere in the product | Both |
| [dashboard.md](dashboard.md) | `/dashboard`, `home-component.tsx`, `components/dashboard/shapes.ts`, the bento shell, the page header chip rail, any of the nine widgets | RM520N |

### Design System

| Doc | Triggers | Scope |
| --- | --- | --- |
| [color-system.md](color-system.md) | Any colour token in `app/globals.css`, a new role, a `Badge` tone, `--primary-container`, `--lte-container`, the quality-ramp tokens, a surface that reads too loud | Both |
| [icon-system.md](icon-system.md) | Any icon anywhere — `MaterialSymbol`, a lucide import, `bun run icons:subset`, `bun run icons:check`, the route-scoped Material-vs-lucide boundary | Both |
| [toast-confirmation.md](toast-confirmation.md) | Any `toast.success` / `toast.error` call, a save / apply / toggle / delete / install / copy handler, `markSaved()` / `useSaveFlash`, a transient Saved or Applied chip, `lib/clipboard.ts` `copyText`, `navigator.clipboard`, the `<Toaster />` order in `app/layout.tsx` | Both |
| [motion-preference.md](motion-preference.md) | Any reduced-motion branch — `lib/motion-preference.ts`, `components/motion-preference.tsx`, `components/motion-provider.tsx`, `useMotionReduced`, `isMotionReduced`, `data-motion`, a `motion-reduce:` / `motion-safe:` class or `@variant motion-reduce` block, the motion bans in `eslint.config.mjs`, `hooks/use-chart-motion.ts` | Both |
| [tailwind-prose-hazard.md](tailwind-prose-hazard.md) | Any prose that quotes a utility class — a code comment, a doc sentence, a failure message — plus `app/globals.css`'s content scan and the `next build` CSS-optimizer report | Both |

### Platform & Install

| Doc | Triggers | Scope |
| --- | --- | --- |
| [adaptive-polling.md](adaptive-polling.md) | The poller's activity tiers — `decide_tier`, `ap_tier`, `AP_*`, `.device.poller_tier`, `.mono`, `/tmp/qmanager_ui_active` and any CGI that writes it, the shared `useModemStatus` store (10 s cap, visibility pause), `lib/visible-interval.ts`, `watchcat.age_sec` / `stale_after`, which poller work sits inside the AT gate | RM520N |
| [at-command-transport.md](at-command-transport.md) | Any AT path — `atcli_smd11`, `qcmd`, `/dev/smd11`, `/tmp/qmanager_at.lock`, `sms_tool`, `flock` serialization, detecting a `qcmd` failure, AT URCs and `AT+QURCCFG` | Both |
| [auth-rate-limiting.md](auth-rate-limiting.md) | `cgi_auth.sh`, `auth/check.sh`, `qm_get_rate_limit_status`, `/tmp/qmanager_auth_attempts.json`, the login lockout ladder | RM520N |
| [gui-installer.md](gui-installer.md) | `installer-gui/`, `bridge.py`, `core/dpapi.py`, `prefs.py`, `wrap_command`, `__QM_RC=`, `stage_payload`, `tokens.css`, the frozen PyInstaller build | Both |
| [modem-bridge.md](modem-bridge.md) | Running anything on a live device — the `modem` / `modem-rg501q` MCP servers, `tools/modem-mcp/server.ts`, `.mcp.json`, `modem_exec` / `modem_write` / `modem_cgi`, the serial check and deny-list | Both |
| [platform-matrix.md](platform-matrix.md) | Any fact that differs **by device** — BusyBox versions, `wget` / `timeout` / `mountpoint` availability, `PATH` under systemd, `/tmp` semantics, CPU/ABI, the F6–F14 defect register | Both |
| [platform-profile.md](platform-profile.md) | `hw_profile.sh`, `/etc/qmanager/platform.json`, `QM_HW_SCHEMA`, `qm_hw_self_heal`, `qm_hw_write_profile`, and any root helper that writes into `/etc/qmanager` | Both |
| [poller-cpu-profile.md](poller-cpu-profile.md) | Any performance work on `qmanager_poller` — per-function CPU attribution, fork+exec cost, `cutime` / `cstime`, the de-fork pass, the Go rewrite comparison, the CPU cost of the CGIs an open dashboard polls (per-request fork floor, lighttpd `cutime`) | Both |
| [qmanager-independence.md](qmanager-independence.md) | `install_rm520n.sh`, Entware bootstrap, `/dev/smd11` udev rules, CGI auth (`qm_cookie_var`, the fork-free auth path), lighttpd, the firewall, the OTA pipeline, `update.auto_update_enabled`, `qmanager_auto_update_arm`, what lives inside vs outside `/etc/qmanager` | RM520N |
| [qmi-probe.md](qmi-probe.md) | `native/qmi_probe`, any QMI-over-QRTR request (`AF_QIPCRTR`, NAS/DMS/UIM/WDS/DSD/WMS message IDs), the armv7 Rust probe build | RM520N |
| [rg501q-bringup.md](rg501q-bringup.md) | Bringing QManager up on the RG501Q-EU — the Entware `wget` chicken-and-egg, the `timeout` positional form, GitHub/GFW reachability, the bootstrap poison-pill guard | RG501Q |
| [tmp-file-ownership.md](tmp-file-ownership.md) | Any `/tmp` file written by both root daemons and www-data CGI — `fs.protected_regular`, the sticky bit, the `root:root 0666` seed in `qmanager_setup`, `/tmp/qmanager_recovery_active` | RM520N |
| [../rm520n-gl-architecture.md](../rm520n-gl-architecture.md) | Platform internals — the RM551E-vs-RM520N-GL Platform Comparison table, Entware bootstrapping, lighttpd config, the boot sequence, the UBI volume layout, known platform quirks | Both |
| [../BACKEND.md](../BACKEND.md) | Backend contracts, and §2.1 in particular — the rootfs mount-mode contract: `ro` in `/proc/cmdline`, `mount -o remount,rw /`, `sync`, and never restoring `ro` | RM520N |

### Cross-cutting

| Doc | Triggers | Scope |
| --- | --- | --- |
| [about-support.md](about-support.md) | `/about-device`, `/support`, `hooks/use-about-device.ts`, `components/about-device/**`, `components/support/**`, `donate-links.tsx`, `PILL_WISE` / `PILL_PAYPAL` / `PILL_SPONSOR` | RM520N |
| [change-workflow.md](change-workflow.md) | Any code change: validation layers and gates, close-out checks (the flow itself is in CLAUDE.md, ported from QManager 2026-10-26) | Both |
| [i18n.md](i18n.md) | Any user-visible string — `public/locales/**`, `lib/i18n/`, `bun run i18n:check`, `bun run lang`, a namespace, a language pack, any of the picker surfaces | RM520N |
| [overview-splash.md](overview-splash.md) | The pre-auth routes `/` and `/login/`, the public CGI under `public/`, `resolveBodyMode()`, `TonalBanner`, `components/public/overview/`, the pre-auth type scale | RM520N |
| [redesign-proposal-playbook.md](redesign-proposal-playbook.md) | Nothing live — **superseded** by the `qm-redesign-review` skill at `.claude/skills/qm-redesign-review/SKILL.md`, which now owns every "redesign / polish / bring this page onto the design language" request. The stub keeps the 2026-08-21 provenance | Both |
| [../CONTRIBUTING-translations.md](../CONTRIBUTING-translations.md) | Authoring or reviewing a community translation pack — the contributor-facing rules for `public/locales/**` and the `bun run lang` CLI | RM520N |
