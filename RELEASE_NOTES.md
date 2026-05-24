# 🚀 QManager RM520N BETA v0.1.12

Another attempt to fix rx/tx orientation: if Data Used still shows upload/download swapped after v0.1.11, QManager now runs a per-device rx/tx probe at boot and applies the correct mapping so bytes are accounted in the right bucket despite firmware quirks. If you still see reversed totals, please open an issue with your device model and firmware — feedback welcome.

> One-click OTA from **System Settings → Software Update** if you're on v0.1.5 or newer.

## 🛠️ Improvements

- **Storage row added to Device Metrics.** The Dashboard now shows `/usrdata` usage alongside CPU and Memory — the partition where configs, profiles, logs, and Entware (`/opt`) live. Bar turns amber at 80%, red at 95%.

- **Data Used counter auto-detects rx/tx orientation.** A quick 5 MB probe at boot figures out which field your firmware uses for upload vs. download (some Quectel builds swap them on the IPA fast-path), then maps correctly from there on. If the probe can't run, it retries on the next reattach. Any existing reversed totals are migrated automatically — no manual reset needed.

## 🐛 Fixes

- **Live Traffic widget removed.** The per-second ↓/↑ readout on the Dashboard and Discord embed couldn't see LAN-to-WAN traffic — Quectel's IPA hardware offload bypasses the kernel for forwarded packets, so the widget read near-zero during real downloads. Cumulative Data Used totals are unaffected.

- **IP Passthrough "Apply & Reboot" now reboots.** Saving USB Connection Mode applied the change but silently skipped the reboot (the web user couldn't talk to systemd). It now goes through the sudo helper and lands on the countdown page like every other reboot flow.

- **OTA no longer strands the reboot page on a blank screen.** On slow connections the modem could reboot before the countdown page finished loading. All reboot flows (IPPT, Carrier Profile, System Reboot, Tailscale, OTA) now wait for the page to confirm it's ready first.

- **Version Management → Install actually installs.** The button used to stop after download — the tarball staged but nothing ran. It now completes the full download → install → reboot in one click, same as the main Update flow. Works for upgrades, reinstalls, and rollbacks.

## 📥 Installation

### Upgrading from v0.1.11

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
