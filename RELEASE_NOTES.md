# 🚀 QManager RM520N BETA v0.1.31

All your alerts finally live in one place. A new **Monitoring → Alerts** page unifies email, SMS, and Discord into a single routing grid — you decide which events reach which channel — and it can now tell you when (and why) the Connection Watchdog reboots your modem. QManager also speaks your language, with a picker that brings the interface to English, 简体中文, 繁體中文, Italiano, and Bahasa Indonesia from the sidebar, the login screen, or the new **System Settings → Languages** page. Your SIM profiles can now switch Connection Scenarios on a daily schedule, the APN Settings page gets a cleaner single-card layout, and the Connection Quality probe switches to a lean ICMP ping matching the RM551E build. The Connection Watchdog gets a ground-up rework — a redesigned status page and a much tougher SIM-failover engine that survives reboots, gives a real SIM swap time to settle, and won't reboot-loop on a bad setting — SIM-swap detection stops false-alarming on your own backup SIM, timezone selection is fixed so the device clock and alert times follow the zone you pick, and time-based schedules (scenario windows, scheduled reboots, and tower-lock windows) now actually fire on this cron-less modem.

> One-click OTA from **System Settings → Software Update** if you're on v0.1.5 or newer.

## ✨ New Features

- **All your alerts in one place.** Email, SMS, and Discord notifications now live on a single **Monitoring → Alerts** page with a routing grid where you choose which events — connection lost, connection restored, or a device reboot — reach each channel. Alerts can now also tell you *why* your modem rebooted (a watchdog recovery, a reboot you asked for, or an unexpected one), so an unattended device is never silent about what happened. This replaces the separate Email Alerts, SMS Alerts, and Discord Bot pages — those links now redirect here (one unified alert engine replaces the three separate per-channel downtime timers; the grid greys out combinations that can't fire — only SMS can reach you *while* the internet is down, since email and Discord need the connection that's out — and reboot causes are read from the watchdog's crash-log ledger and coalesced if they repeat).

- **Pick your language.** The interface now ships in five languages — English, Simplified Chinese (简体中文), Traditional Chinese (繁體中文), Italian (Italiano), and Indonesian (Bahasa Indonesia). Switch from the language menu in the sidebar, the picker on the login screen, or the new **System Settings → Languages** page; your choice is saved per device. The Dashboard and navigation are fully translated now, with the remaining screens following in upcoming releases (every language is bundled in the firmware — nothing to download).

- **Schedule your Connection Scenario by time of day.** A SIM profile can now bind up to two daily time windows to a scenario — e.g. Gaming from 6pm to 11pm on weekdays, Balanced the rest of the time — set right from the profile's scenario picker under **Cellular → Custom SIM Profiles** (applied on-device by a systemd timer, since this modem has no cron daemon to run a traditional schedule).

- **New public Overview landing page.** QManager's home page (`/`) is now an **Overview** splash that shows the device name plus live carrier, network, signal, and temperature *before* you log in — and logging out returns you here instead of a bare login form (three read-only public endpoints project an allowlisted slice of the poller cache; nothing sensitive is exposed).

- **Redesigned Watchdog page.** **Monitoring → Watchdog** now leads with a live status hero — current state, failed-check counters, and a recovery-ladder view — beside a Recovery Activity log and a tabbed **Detection / Recovery** settings panel with a single save bar. See at a glance what the watchdog is doing and which SIM you're on.

- **See how many SIM cards QManager remembers, and clear the list.** A new row in **System Settings** shows the count of known SIMs and lets you reset it, keeping the currently-inserted SIM known so it doesn't immediately re-trigger a "new SIM" notice.

- **Auto-forward incoming texts to another number.** A new **Cellular → SMS Center → SMS Forwarding** page relays every SMS the modem receives to a phone number you choose — handy for a headless modem or a data-only SIM you can't otherwise check (a background daemon polls the inbox, seeds silently on first enable so it never blasts your existing messages, guards against relay loops, and logs delivery failures right on the page).

- **Translate QManager in your own language.** A new community translation toolkit lets anyone add or complete a language without being a developer — `bun run lang scaffold` starts a new language, `status`/`check` show what's left and check your work with plain-English fixes, and one command packages a finished pack (zero-dependency Bun CLI sharing the app's `i18n:check` validation engine; partial translations are welcome and fall back to English). See `docs/CONTRIBUTING-translations.md`.

- **Install extra languages without a firmware update.** Beyond the five built-in languages, **System Settings → Languages** now has an Available list of community translation packs you can download and install straight onto the modem, then switch to like any other language — no OTA, no reflash. Packs survive reboots and future updates, and untranslated bits fall back to English (each pack is fetched only from the project's own GitHub release and sha256-verified before it's ever loaded; installed packs live outside the web root and are re-linked on every update).

## 🛠️ Improvements

- **The Watchdog now owns connection timing.** Probe interval and failure threshold moved from Connection Quality into the Watchdog's **Detection** tab, so one place decides how often your link is checked and when it counts as down — and the Connection Quality page is now a simpler "Probe Targets" card (detection reads the ping daemon's raw failure streak directly, fixing a double-count that made the "declares down after ~Ns" estimate drift).

- **APN Settings has a cleaner single-card layout.** The page now shows one focused APN card instead of a 6-slot list. (Per-slot enable/disable and PAP/CHAP auth editing move off this page for now — the underlying 6-context support on the modem is unchanged.)

- **Connection Quality now checks the internet with a plain ICMP ping.** The reachability probe switched from an HTTP request to a straightforward `ping` of a DNS server, so **System Settings → Connection Quality** now takes an IPv4 and an IPv6 **DNS-server address** (default `1.1.1.1` and Cloudflare's `2606:4700:4700::1111`) instead of web URLs — it tries IPv4 first and falls back to IPv6. Existing setups are migrated automatically on update (a small shell daemon replaces the previous compiled probe for 1:1 parity with the RM551E build; the failure streak the Watchdog acts on is unchanged, so self-healing works exactly as before).

- **Band Locking follows your scheduled scenario.** The **Cellular → Band Locking** page now respects whichever Connection Scenario your profile has in force *right now* — including an active scheduled window — instead of only the profile's default, so the band controls lock and unlock in step with your time-of-day scenario schedule.

- **The schedule save button now tells the truth.** Saving a Scheduled Reboot or Tower Lock schedule now warns you if it couldn't be armed on your device, instead of always flashing a green "saved" — so a schedule that can't run never looks like it will.

- **SMS Center now shows texts stored on the SIM.** Messages the carrier routed to SIM storage used to be silently missed; the inbox at **Cellular → SMS Center** now reads both modem and SIM memory and merges them, and adds Unread/Read tabs plus search, sort, and rows-per-page pagination for a busy inbox (dual **CPMS ME+SM** storage routing, self-healed at boot; read/unread tracked per-browser; and a cleaner bundled `sms_tool`).

- **SIM-to-profile matching is more forgiving.** A SIM card's ID is now compared the same way everywhere internally, so a saved profile keeps matching its SIM even when different parts of QManager read the card slightly differently.

- **SIM failover now survives a reboot.** If the watchdog switched you to your backup SIM, that state is kept across a restart, so the page still shows you're on the backup slot (and offers the revert) instead of losing track (failover state moved to persistent storage).

- **Backup SIM slot is now required to arm SIM failover.** Turning on the "Switch to Backup SIM" step without picking a slot is blocked at save with a clear prompt, so failover can never be enabled in a state where it can't actually fail over.

- **Cleaner watchdog settings save.** The watchdog settings form now validates every field before writing anything and points at the exact field that's out of range, so a bad value can't half-apply.

- **Translation pull requests are checked automatically.** Every PR that touches a language now gets a bot comment with a per-language completeness table and inline notes, failing only on real structural mistakes — so contributors get instant, plain-English feedback (`bun run lang check --all --ci` on CI, ~20–30s, no install).

- **Installs and updates are tougher.** A momentary system hiccup partway through an install no longer aborts the whole thing, an upgrade can't lose your custom TTL/HL setting, and files are flushed to flash before the filesystem is sealed — so an install or update is far less likely to leave the device half-finished (guarded `systemctl daemon-reload`, ordered TTL-state migration that keeps the old value on a failed write, and `sync`-before-remount discipline).

- **Automatic updates switch on the instant you toggle them.** Flipping **Automatic updates** in **System Settings → Software Update** now arms (or disarms) the daily updater right away, instead of waiting until the next update to take effect. The old time field — which never actually controlled anything — is replaced by a short note explaining the updater runs a check once a day at a randomized time (a small root helper arms the systemd timer live; the crontab path it replaced was dead on this device, since nothing runs cron here).

- **Tightened the web backend's system permissions.** QManager's web service can now start and stop only *its own* services rather than any service on the device — a defense-in-depth cleanup with zero change to what you can do in the UI (the `www-data` sudoers grant is scoped to the `qmanager-*` and `tailscaled` units it actually uses).

## 🐛 Fixes

- **Scheduled reboots and tower-lock schedules now actually happen.** A Scheduled Reboot or a Tower Lock apply/clear window you set used to be saved but never fire — this modem has no running cron daemon, so the schedule sat dead while the page reported success. Both now run on a systemd timer that triggers at the time you set, and a scheduled reboot politely stands down if a firmware update is in progress so it can't interrupt one.

- **"New SIM card detected" no longer fires on a SIM you've already used.** QManager now remembers every SIM it's seen instead of just the last one, so failing over to your backup SIM (and back) no longer re-triggers the new-SIM banner.

- **SIM slot switches are now verified before QManager trusts them.** Both the Watchdog's automatic SIM failover and a manual slot switch in Cellular Settings now confirm the modem actually landed on the requested slot before applying anything for it, closing a rare case where a busy modem silently stayed on the old SIM.

- **Timezone selection now actually changes the device clock.** Picking a zone in **System Settings** updates the clock, log timestamps, and alert times instead of silently snapping back to UTC (glibc reads `/etc/localtime`, which QManager now writes via a root helper using Entware's full IANA tzdata). Heads-up: scheduled-reboot and tower-lock schedule windows follow the device's local timezone and adopt a newly-set zone after the next reboot — set your timezone first, then schedule.

- **Real SIM swaps get time to settle.** A genuine failover now waits ~90 seconds for the backup SIM to attach before the watchdog judges it, so a working swap is no longer wrongly reverted mid-connect.

- **A misconfigured backup SIM no longer triggers reboots.** If the backup slot is unset or the same as the active one, the watchdog stops there and flags it instead of escalating to a device reboot.

- **"Running on backup SIM" status shows correctly again.** The live status now reports an active failover accurately, so the backup-SIM banner and Revert button appear when they should.

- **A brief connectivity blip during cooldown no longer forces a reboot.** The watchdog now retries a transient ping hiccup after a recovery step rather than treating it as a hard failure and jumping to the next tier.

- **Fewer moving parts in the connectivity probe.** The reachability check is now a single self-contained shell daemon with a slimmer status file (latency, jitter, and loss are still computed the same way, downstream). No action needed — the change applies on update.

- **Updates no longer report failure when they actually succeeded.** A completed update whose version differs only by a pre-release tag (like `-draft`) is now recognized as a success instead of throwing a false "update failed" at the very last step (the post-install version check compares releases semantically rather than as an exact string).

- **A clean bill of health after install or update.** Two internal services (Ethernet and IMEI check) used to show up as "failed" on a perfectly healthy device that simply had nothing to do; they now correctly report as idle/skipped, so a quick `systemctl --failed` comes back clean — on both a fresh install and an OTA upgrade of an existing device.

> ⚠️ **Heads-up for power users:** the ICMP probe drops the old "Limited by carrier" state, so QManager no longer flags a captive-portal / billing-wall interception separately — it only reports reachable vs. not. Also note that some carriers filter ICMP to public DNS IPs; if yours does, point the Connection Quality targets at addresses your carrier answers, or Connection Quality may read a false "disconnected."

## 📥 Installation

### Upgrading from v0.1.12

**System Settings → Software Update** → Download → Install. No SSH/ADB needed. All settings preserved.

### Fresh Install

> **No SimpleAdmin required.** QManager installs completely standalone — you do **not** need to install (or uninstall) SimpleAdmin or the RGMII toolkit first. The installer bootstraps everything itself (Entware, web server, users, services).

SSH or ADB into the modem and run:

```sh
curl -fsSL -o /tmp/qmanager-installer.sh \
  https://github.com/dr-dolomite/QManager-RM520N/raw/refs/heads/main/qmanager-installer.sh && \
  bash /tmp/qmanager-installer.sh
```

No `curl`? Use `wget` — the installer works either way:

```sh
wget -O /tmp/qmanager-installer.sh \
  https://github.com/dr-dolomite/QManager-RM520N/raw/refs/heads/main/qmanager-installer.sh && \
  bash /tmp/qmanager-installer.sh
```

## 💙 Thank You!

Bug reports and feature requests welcome on [GitHub Issues](https://github.com/dr-dolomite/QManager-RM520N/issues).

Like what's new? QManager is built and maintained for free — if these updates have made your setup a little better, you can show your support via [Wise](https://wise.com/pay/business/blackcatdev?currency=USD) or [PayPal](https://paypal.me/iamrusss). Every bit helps keep this project alive. [GitHub Sponsors](https://github.com/sponsors/dr-dolomite) works too.

**License:** MIT + Commons Clause — **Happy connecting!**
