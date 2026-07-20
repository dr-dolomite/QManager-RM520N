# 🚀 QManager RM520N BETA v0.1.32

This release closes out a false-alarm bug in SIM swap detection, lets a SIM profile switch Connection Scenarios on a schedule, and gives the APN Settings page a cleaner single-APN layout.

> One-click OTA from **System Settings → Software Update** if you're on v0.1.5 or newer.

## ✨ New Features

- **Schedule your Connection Scenario by time of day.** A SIM profile can now bind up to two daily time windows to a scenario — e.g. Gaming from 6pm to 11pm on weekdays, Balanced the rest of the time — set right from the profile's scenario picker under **Cellular → Custom SIM Profiles** (applied on-device by a systemd timer, since this modem has no cron daemon to run a traditional schedule).

- **See how many SIM cards QManager remembers, and clear the list.** A new row in **System Settings** shows the count of known SIMs and lets you reset it, keeping the currently-inserted SIM known so it doesn't immediately re-trigger a "new SIM" notice.

## 🛠️ Improvements

- **APN Settings has a cleaner single-card layout.** The page now shows one focused APN card instead of a 6-slot list. (Per-slot enable/disable and PAP/CHAP auth editing move off this page for now — the underlying 6-context support on the modem is unchanged.)

- **SIM-to-profile matching is more forgiving.** A SIM card's ID is now compared the same way everywhere internally, so a saved profile keeps matching its SIM even when different parts of QManager read the card slightly differently.

## 🐛 Fixes

- **"New SIM card detected" no longer fires on a SIM you've already used.** QManager now remembers every SIM it's seen instead of just the last one, so failing over to your backup SIM (and back) no longer re-triggers the new-SIM banner.

- **SIM slot switches are now verified before QManager trusts them.** Both the Watchdog's automatic SIM failover and a manual slot switch in Cellular Settings now confirm the modem actually landed on the requested slot before applying anything for it, closing a rare case where a busy modem silently stayed on the old SIM.

## 📥 Installation

### Upgrading from v0.1.31

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
