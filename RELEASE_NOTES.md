# 🚀 QManager RM520N BETA v0.1.19-draft

This release speeds up internet outage detection: when the main probe target stops answering, the backup targets are now checked all at once.

> One-click OTA from **System Settings → Software Update** if you're on v0.1.5 or newer.

## 🛠️ Improvements

- **Faster, steadier internet check** — When the first probe target stops answering, the other three are now tried at the same time, so a failing check takes about 4 seconds instead of up to 13, and the **sensitive** profile reacts much sooner. (`qmanager_ping` runs the fallback legs in parallel, uses fewer process forks per cycle, and times the debounce from the start of the first failing probe.)
- **Packet loss and jitter no longer reset** — Switching to a backup target no longer wipes the latency history on the dashboard and **Monitoring → Connection Quality**, so loss and jitter stay meaningful on a flaky link. (The history ring records which leg answered; jitter only compares samples from the same target.)

## 🐛 Fixes

- **Fresh installs work again** — On a modem without Entware, the v0.1.18 installer stopped with "SHA-256 mismatch … discarding download" and never finished. It now installs normally; upgrades were never affected. (The pinned checksum for Entware's `opkg` was wrong; it now matches the file the mirror serves.)

## 📥 Installation

### Upgrading from v0.1.18

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
