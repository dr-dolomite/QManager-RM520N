# 🚀 QManager RM520N BETA v0.1.11-draft

Fixes the Data Used counter showing swapped or inaccurate upload/download totals on certain modem firmwares — QManager now reads the device's traffic figures straight from the Linux kernel instead of a firmware-specific modem counter, so the numbers are correct on every modem.

> One-click OTA from **System Settings → Software Update** if you're on v0.1.5 or newer. SSH/ADB is not required.

## ✨ New Features (v0.1.11)

_Nothing yet for this release._

## 🛠️ Improvements (v0.1.11)

- **`curl` is no longer required to install or update QManager.** The installer and the OTA updater now auto-detect whichever downloader your modem has — `curl` or `wget` — and use it. `curl` is still preferred when both are present, but it is never force-installed. This unblocks fresh installs on firmwares that ship `wget` only (common on x5x/x6x modems like the RM502/RM520/RM521).

## 🐛 Fixes (v0.1.11)

- **Data Used counter is now accurate on every modem firmware.** Some users still saw swapped or wrong upload/download totals — on certain modems the "uploaded" figure showed tens of gigabytes while "downloaded" showed almost nothing, or the two were simply reversed. The cause: QManager read the modem's `+QGDNRCNT` AT counter, whose two fields appear in a firmware-specific order, then ran a one-time calibration download to guess which field was upload and which was download. That guess was unreliable — it failed outright on x55-based modems (the RM502 series) and mis-fired on some RM520N-GL firmware builds, after which it locked itself to the wrong answer for the life of the install. QManager now skips the modem counter entirely and reads the byte totals straight from the Linux kernel's own network-interface statistics, where download and upload are labelled identically on every firmware — there is nothing left to guess. The throwaway calibration download has been removed as well. Your counter resets to zero on upgrade — this is intentional and clears any incorrect totals carried over from the old method.

## 📥 Installation

### Upgrading from v0.1.10

**System Settings → Software Update.** Click Download, then Install. No SSH/ADB needed. All settings preserved.

### Fresh Install

ADB or SSH into the modem and run:

```sh
curl -fsSL -o /tmp/qmanager-installer.sh \
  https://github.com/dr-dolomite/QManager-RM520N/raw/refs/heads/main/qmanager-installer.sh && \
  bash /tmp/qmanager-installer.sh
```

If your modem has `wget` but not `curl` (common on x5x/x6x firmwares like RM502/RM520/RM521), just use `wget` instead — QManager auto-detects whichever downloader is available, so `curl` is no longer required at install time or for OTA updates:

```sh
wget -O /tmp/qmanager-installer.sh \
  https://github.com/dr-dolomite/QManager-RM520N/raw/refs/heads/main/qmanager-installer.sh && \
  bash /tmp/qmanager-installer.sh
```

## 💙 Thank You!

Bug reports and feature requests welcome on [GitHub Issues](https://github.com/dr-dolomite/QManager-RM520N/issues).

Like what's new? QManager is built and maintained for free — if these updates have made your setup a little better, you can show your support via [Wise](https://wise.com/pay/business/blackcatdev?currency=USD) or [PayPal](https://paypal.me/iamrusss). Every bit helps keep this project alive and growing. [GitHub Sponsors](https://github.com/sponsors/dr-dolomite) is also an option if that works better for you.


**License:** MIT + Commons Clause — **Happy connecting!**

---
