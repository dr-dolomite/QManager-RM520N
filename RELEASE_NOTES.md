# 🚀 QManager RM520N BETA v0.1.11

Data Used counter swapped or inaccurate on your modem? Fixed — QManager now reads traffic totals straight from the Linux kernel, so the numbers are always correct regardless of firmware version.

> One-click OTA from **System Settings → Software Update** if you're on v0.1.5 or newer.

## ✨ New Features

- **SIM Profiles can now lock in a Connection Scenario.** Pick Balanced, Gaming, Streaming, or one of your custom scenarios in the profile form — when the profile activates (on SIM switch, boot, watchdog recovery, or manual apply), it applies the scenario's network mode and band locks alongside APN, TTL/HL, and IMEI. New profiles default to Balanced, which leaves your modem's current settings untouched. When a non-Balanced scenario is bound, the Connection Scenarios and Band Locking pages become read-only while that profile is active.

- **"+ Create new custom scenario" shortcut in the profile form.** The scenario picker now links directly to the Scenarios page and auto-opens the create dialog. If you have unsaved changes, you'll be asked before navigating away.

- **Custom DNS — override the upstream resolver for all LAN devices.** Under **Local Network → Custom DNS**, set up to 4 upstream servers (IPv4 or IPv6) — Cloudflare, Google, your own resolver, etc. Changes apply instantly with no reboot and no DHCP lease disruption. An "Ignore carrier DNS" toggle prevents the carrier's assigned resolvers from mixing in with your custom ones. Requires the modem's DNS Mode to be set to Proxy (the page will tell you if it isn't).

## 🛠️ Improvements

- **Watchdog Tier 1 renamed: "Re-register to Network"** — better reflects what actually happens (`AT+COPS=2` deregister → `AT+COPS=0` re-register).

- **`curl` is no longer required to install or update QManager.** The installer auto-detects `curl` or `wget` and uses whichever is available. This unblocks fresh installs on firmwares that ship only `wget` (common on RM502/RM520/RM521).

- **Tailscale SSH toggle is the source of truth.** QManager re-applies the toggle on every reconnect, so it survives `tailscale up --reset`. If you change SSH state via the CLI or carried over a Tailscale install from SimpleAdmin/RGMII Toolkit, the GUI won't see that change until you toggle the switch off and back on once.

## 🐛 Fixes

- **Data Used counter now shows correct upload/download on every firmware.** Some users saw swapped totals or a counter stuck near zero — caused by QManager relying on the modem's `+QGDNRCNT` AT command, which returns fields in a firmware-specific order that a one-time calibration download tried (and often failed) to detect. QManager now reads byte totals straight from the kernel's network interface stats, where the labels are consistent everywhere. The calibration download has been removed. **Your counter resets to zero on upgrade** — this clears any incorrect totals from the old method.

## 📥 Installation

### Upgrading from v0.1.10

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

---
