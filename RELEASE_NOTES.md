# 🚀 QManager RM520N BETA v0.1.13-draft

QManager now speaks your language, and the Connection Watchdog gets a ground-up rework. A new language picker brings the interface to English, 简体中文, 繁體中文, Italiano, and Bahasa Indonesia — switch it from the sidebar, the login screen, or the new **System Settings → Languages** page, and your choice sticks on that device. The watchdog gains a redesigned status page and a much tougher SIM-failover engine that survives reboots, gives a real SIM swap time to settle, and won't reboot-loop on a bad setting. This release also fixes timezone selection so the device clock, log timestamps, and alert times finally follow the zone you pick.

> One-click OTA from **System Settings → Software Update** if you're on v0.1.5 or newer.

## ✨ New Features

- **Pick your language.** The interface now ships in five languages — English, Simplified Chinese (简体中文), Traditional Chinese (繁體中文), Italian (Italiano), and Indonesian (Bahasa Indonesia). Switch from the language menu in the sidebar, the picker on the login screen, or the new **System Settings → Languages** page; your choice is saved per device. The Dashboard and navigation are fully translated now, with the remaining screens following in upcoming releases (every language is bundled in the firmware — nothing to download).

- **Redesigned Watchdog page.** **Monitoring → Watchdog** now leads with a live status hero — current state, failed-check counters, and a recovery-ladder view — beside a Recovery Activity log and a tabbed **Detection / Recovery** settings panel with a single save bar. See at a glance what the watchdog is doing and which SIM you're on.

- **Translate QManager in your own language.** A new community translation toolkit lets anyone add or complete a language without being a developer — `bun run lang scaffold` starts a new language, `status`/`check` show what's left and check your work with plain-English fixes, and one command packages a finished pack (zero-dependency Bun CLI sharing the app's `i18n:check` validation engine; partial translations are welcome and fall back to English). See `docs/CONTRIBUTING-translations.md`.

## 🛠️ Improvements

- **SIM failover now survives a reboot.** If the watchdog switched you to your backup SIM, that state is kept across a restart, so the page still shows you're on the backup slot (and offers the revert) instead of losing track (failover state moved to persistent storage).

- **Backup SIM slot is now required to arm SIM failover.** Turning on the "Switch to Backup SIM" step without picking a slot is blocked at save with a clear prompt, so failover can never be enabled in a state where it can't actually fail over.

- **Cleaner watchdog settings save.** The watchdog settings form now validates every field before writing anything and points at the exact field that's out of range, so a bad value can't half-apply.

- **Translation pull requests are checked automatically.** Every PR that touches a language now gets a bot comment with a per-language completeness table and inline notes, failing only on real structural mistakes — so contributors get instant, plain-English feedback (`bun run lang check --all --ci` on CI, ~20–30s, no install).

## 🐛 Fixes

- **Timezone selection now actually changes the device clock.** Picking a zone in **System Settings** updates the clock, log timestamps, and alert times instead of silently snapping back to UTC (glibc reads `/etc/localtime`, which QManager now writes via a root helper using Entware's full IANA tzdata). Heads-up: scheduled-reboot and low-power windows follow the device's local timezone and shift to a newly-set zone after the next reboot — set your timezone first, then schedule.

- **Real SIM swaps get time to settle.** A genuine failover now waits ~90 seconds for the backup SIM to attach before the watchdog judges it, so a working swap is no longer wrongly reverted mid-connect.

- **A misconfigured backup SIM no longer triggers reboots.** If the backup slot is unset or the same as the active one, the watchdog stops there and flags it instead of escalating to a device reboot.

- **"Running on backup SIM" status shows correctly again.** The live status now reports an active failover accurately, so the backup-SIM banner and Revert button appear when they should.

- **A brief connectivity blip during cooldown no longer forces a reboot.** The watchdog now retries a transient ping hiccup after a recovery step rather than treating it as a hard failure and jumping to the next tier.

## 📥 Installation

### Upgrading from v0.1.12

**System Settings → Software Update** → Download → Install. No SSH/ADB needed. All settings preserved.

### Fresh Install

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
