# 🚀 QManager RM520N BETA v0.1.14

QManager now remembers your SIM cards properly. A new **Tracked SIMs** list in System Settings shows every SIM the modem has seen — carrier, number, when it was added — and the "New SIM card detected" banner finally stays dismissed for good, per SIM, on the device itself. This release also hardens several file permissions on the modem and fixes a wrong phone number showing after a SIM swap.

> One-click OTA from **System Settings → Software Update** if you're on v0.1.5 or newer.

## ✨ New Features

- **See every SIM QManager remembers.** A new **Tracked SIMs** card in **System Settings** lists each SIM by carrier, phone number, and the date it was first seen, marks the one currently in the modem, and shows whether it still raises a new-SIM alert. SIMs already known to your device appear on the list after updating, with alerts already switched off (existing SIMs are backfilled from the known-SIMs list; historical entries show "Added before tracking began" rather than a made-up date).

- **Turn the new-SIM alert back on for any SIM.** If you dismissed the "New SIM card detected" banner and want it back — say you're testing a profile — hit **Show Alert** on that SIM's row in Tracked SIMs and the banner returns, no reboot or reload needed.

## 🛠️ Improvements

- **A clearer "New SIM card detected" banner.** The banner now names the SIM's carrier and phone number instead of just announcing a swap, and offers exactly one next step: **Apply Profile** when a saved profile matches the card, or **Create Profile** when none does — which now drops you straight into the profile creation form.

- **Dismissing the banner asks first, and says what it means.** Closing the banner now opens a short confirmation that spells out the SIM's ID and makes clear you're silencing the alert for *that SIM only* — every other card still raises it, and you can undo it from Tracked SIMs.

## 🐛 Fixes

- **Dismissing "New SIM card detected" now really sticks — on the modem, not just in your browser.** The dismissal used to be remembered only by the browser you clicked it in, so the banner came back on your phone, on another laptop, or after clearing site data. It's now stored on the device per SIM and survives reboots and updates (the old dismiss request quietly failed on the device and reported success anyway; it's been replaced with a proper privileged write).

- **The wrong phone number no longer sticks around after a SIM swap.** If you switched to a SIM with no number provisioned — common on prepaid and data-only cards — QManager kept displaying the *previous* SIM's number. It now correctly shows "No number provisioned" instead (also made the number parsing robust against carriers that put a comma in the SIM's name field).

- **Tightened permissions on the folder QManager's system helpers load code from.** This folder was world-writable, which could have let a local attacker on the device replace one of those files and have it run with full privileges. It's now locked down, and the fix re-applies itself on every update so existing devices are repaired automatically.

- **Tightened permissions on QManager's own program folder.** The folder holding the web console was world-writable, which could have let a local attacker swap in their own console program to be run with full privileges at the next start. Now locked down, and repaired automatically on update.

- **Tightened permissions on the HTTPS certificate folder.** The certificate folder and the public certificate were world-writable, which could have let a local attacker replace them and intercept your connection to the QManager web interface. Both are now locked down, with the private key restricted on every update.

- **Tightened permissions on the web root.** The folder QManager serves the web interface from was world-writable, which could have let a local attacker on the device tamper with the pages and scripts it serves. Now locked down, and repaired automatically on update.

## 📥 Installation

### Upgrading from v0.1.13

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
