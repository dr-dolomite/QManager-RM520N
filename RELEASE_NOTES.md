# 🚀 QManager RM520N BETA v0.1.18-draft

The **Sites** monitor goes live: a new **Now** view refreshes every site's response time about every 2 seconds while you watch, and Dota 2 gets its logo.

> One-click OTA from **System Settings → Software Update** if you're on v0.1.5 or newer.

## ✨ New Features

- **Live "Now" view for Sites.** The **Sites** card on **Monitoring → Latency Monitor** now opens on **Now**, which re-checks every site about every 2 seconds while the page is open and visible; switching to 1 h / 24 h / 7 d, leaving the page or hiding the tab stops it within about 10 seconds, and history keeps its normal 5-minute checks. (Live checks are a light HTTP request, about 25 MB per hour while open, and are never written to history; the first live value lands about 6 seconds after opening.)

## 🛠️ Improvements

- **Lighter background polling.** The modem's status poller now uses about 60 % less CPU, so the dashboard and other services have more headroom on the modem's single core. (874 → 344 ms CPU per cycle on an RM520N-GL; status data is unchanged.)
- **The modem rests when nobody is looking.** With no QManager page open (or the tab hidden), the status poller asks the modem for signal data every 15 seconds, then every minute after 5 minutes, and goes back to full speed as soon as you open the dashboard. Signal history has fewer points while no browser is open. (Poller CPU on an RM520N-GL: 12.9 % of the core with the dashboard open, 8.1 % idle, 6.0 % after 5 minutes.)

## 🐛 Fixes

- **Data Used counts bytes correctly.** Once more than about 10 MB had moved, **Data Used** counted packets instead of bytes and read far too low; it now counts bytes. Your Data Used total starts again from zero once after this update.
- **Dota 2 shows its logo in Sites.** Adding `dota2.com` used to show only a letter because the site's own icon is too small to use; it now has a built-in logo.

## 📥 Installation

### Upgrading from v0.1.17

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
