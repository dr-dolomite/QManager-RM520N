# 🚀 QManager RM520N BETA v0.1.13-draft

QManager now speaks your language. A new language picker brings the interface to English, 简体中文, 繁體中文, Italiano, and Bahasa Indonesia — switch it from the sidebar, the login screen, or the new **System Settings → Languages** page, and your choice sticks on that device. This release also fixes timezone selection so the device clock, log timestamps, and alert times finally follow the zone you pick.

> One-click OTA from **System Settings → Software Update** if you're on v0.1.5 or newer.

## ✨ New Features

- **Pick your language.** The interface now ships in five languages — English, Simplified Chinese (简体中文), Traditional Chinese (繁體中文), Italian (Italiano), and Indonesian (Bahasa Indonesia). Switch from the language menu in the sidebar, the picker on the login screen, or the new **System Settings → Languages** page; your choice is saved per device. The Dashboard and navigation are fully translated now, with the remaining screens following in upcoming releases (every language is bundled in the firmware — nothing to download).

## 🐛 Fixes

- **Timezone selection now actually changes the device clock.** Picking a zone in **System Settings** updates the clock, log timestamps, and alert times instead of silently snapping back to UTC (glibc reads `/etc/localtime`, which QManager now writes via a root helper using Entware's full IANA tzdata). Heads-up: scheduled-reboot and low-power windows follow the device's local timezone and shift to a newly-set zone after the next reboot — set your timezone first, then schedule.

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
