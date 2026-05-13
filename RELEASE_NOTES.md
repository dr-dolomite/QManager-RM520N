# 🚀 QManager RM520N BETA v0.1.10-draft

> One-click OTA from **System Settings → Software Update** if you're on v0.1.5 or newer. SSH/ADB is not required.

## 🐛 Fixes

- **Data Used counter no longer reports negative or swapped upload/download values.** Two bugs combined to produce screenshots like "Download 271.9 MB / Upload -772994965 B" on 5G-SA users in v0.1.9: the `+QGDNRCNT` AT counter returns its fields in a firmware-specific order (some Quectel firmwares ship it reversed vs `+QGDCNT`), and the poller's shell arithmetic was wrapping at 2.15 GB on BusyBox `sh`. Both are fixed: the poller now runs under bash for 64-bit arithmetic, and on first run (or after a counter reset) it performs a one-time **1 MB calibration download** to detect the correct field order and locks it for the lifetime of the install. The calibration emits an event to the dashboard's event log so the metered-data cost is transparent. Existing users will see their counter reset to zero on upgrade — this is intentional and heals any corrupted accumulated values from v0.1.9.

## 🛠️ Improvements

- **IPv6 addresses no longer overflow the Cellular Information card on mobile.** WAN IPv6, Primary DNS, and Secondary DNS values now wrap cleanly inside the card on narrow screens instead of running off the right edge. Addresses are also displayed in their standard compressed form (RFC 5952), so a value like `2607:fb91:0000:0000:0000:425d:28b3:2230` shows as `2607:fb91::425d:28b3:2230`. The full uncompressed address is still available in the info-icon tooltip.

- **Secondary DNS shows a clean value on dual-stack (IPv4+IPv6) networks.** On carriers that hand out both an IPv4 and IPv6 data context (e.g. T-Mobile US), the Secondary DNS field could appear as a long garbled string with two addresses fused together (e.g. `10.177.0.34253.0.151.106.0.0…`). The poller now correctly separates the two records before reading the DNS fields, so a single, valid DNS server is shown.

- **The dashboard updates immediately when you switch SIM slots.** Previously, the ISP name and SIM card details shown on the dashboard could remain stuck on the old SIM's values for up to ~30 seconds after a slot swap — long enough that the "SIM Mismatch" badge on the Custom Profiles page could falsely flag a perfectly-matched profile as mismatched. The dashboard now catches up within a couple of seconds, before the profile page has a chance to show a false mismatch.

## 📥 Installation

### Upgrading from v0.1.9

**System Settings → Software Update.** Click Download, then Install. No SSH/ADB needed. All settings preserved.

### Fresh Install

ADB or SSH into the modem and run:

```sh
curl -fsSL -o /tmp/qmanager-installer.sh \
  https://github.com/dr-dolomite/QManager-RM520N/raw/refs/heads/main/qmanager-installer.sh && \
  bash /tmp/qmanager-installer.sh
```

If your modem has `wget` but not `curl` (common on x5x/x6x firmwares like RM502/RM520/RM521), just use `wget` to fetch the installer — preflight auto-installs `curl` from Entware so future OTA updates work (Entware must already be bootstrapped):

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
