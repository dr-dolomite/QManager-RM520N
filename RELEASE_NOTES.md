# 🚀 QManager RM520N BETA v0.1.32

The Connection Quality probe now uses a simple ICMP ping to a DNS server, matching how the RM551E build checks the internet. It's a leaner, more predictable reachability test — with one deliberate tradeoff for power users, noted below.

> One-click OTA from **System Settings → Software Update** if you're on v0.1.5 or newer.

## 🛠️ Improvements

- **Connection Quality now checks the internet with a plain ICMP ping.** The reachability probe switched from an HTTP request to a straightforward `ping` of a DNS server, so **System Settings → Connection Quality** now takes an IPv4 and an IPv6 **DNS-server address** (default `1.1.1.1` and Cloudflare's `2606:4700:4700::1111`) instead of web URLs — it tries IPv4 first and falls back to IPv6. Existing setups are migrated automatically on update (a small shell daemon replaces the previous compiled probe for 1:1 parity with the RM551E build; the failure streak the Watchdog acts on is unchanged, so self-healing works exactly as before).

## 🐛 Fixes

- **Fewer moving parts in the connectivity probe.** The reachability check is now a single self-contained shell daemon with a slimmer status file (latency, jitter, and loss are still computed the same way, downstream). No action needed — the change applies on update.

> ⚠️ **Heads-up for power users:** the ICMP probe drops the old "Limited by carrier" state, so QManager no longer flags a captive-portal / billing-wall interception separately — it only reports reachable vs. not. Also note that some carriers filter ICMP to public DNS IPs; if yours does, point the Connection Quality targets at addresses your carrier answers, or Connection Quality may read a false "disconnected."

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
