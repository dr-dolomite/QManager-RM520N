# 🚀 QManager RM520N BETA v0.1.18-draft

QManager's modem broker now runs on both the RM520N-GL and the RG501Q-EU, so both modems get lighter polling, a faster SMS inbox and fresher signal readings, plus a live **Now** view for Sites.

> One-click OTA from **System Settings → Software Update** if you're on v0.1.5 or newer.

## ✨ New Features

- **Live "Now" view for Sites.** The **Sites** card on **Monitoring → Latency Monitor** now opens on **Now**, which re-checks every site about every 2 seconds while the page is open and visible; switching to 1 h / 24 h / 7 d, leaving the page or hiding the tab stops it within about 10 seconds, and history keeps its normal 5-minute checks. (Live checks are a light HTTP request, about 25 MB per hour while open, and are never written to history; the first live value lands about 6 seconds after opening.)
- **Change the modem's LAN address.** **Local Network → Ethernet** has a new **LAN Address** card where you set the gateway IP and subnet; applying it reboots the modem, and the page opens the new address on its own once the modem is back, on both the RM520N-GL and the RG501Q-EU. (Edits `mobileap_cfg.xml` without needing `xmllint`, which the RG501Q-EU lacks; the DHCP range moves into the new subnet.)

## 🛠️ Improvements

- **Lighter background polling.** The modem's status poller now uses about half the CPU while a QManager page is open, and about a fifth when none is, leaving more headroom on the modem's single core. With no page open (or the tab hidden) it asks the modem for full signal data every 15 seconds, then every minute after 5 minutes, and goes back to full speed as soon as you open the dashboard. (Poller share of the core 27 % → 13 % active, 6 % idle on an RM520N-GL; status data is unchanged, but Signal History has fewer points while no browser is open.)
- **The LAN no longer overlaps 192.168.224.x.** The modem's factory LAN mask is a /22 (192.168.224.0–227.255), which clashes with routers on 192.168.224.1; QManager now sets it to /24 (192.168.225.0–255) and keeps the 192.168.225.1 address. It applies on the next reboot, and only if you never changed the LAN yourself. (Devices with a fixed IP in 192.168.224.x, .226.x or .227.x must move into 192.168.225.x.)
- **A lighter dashboard.** An open dashboard now uses much less of the modem's CPU, and a dashboard left in a background tab stops polling entirely until you switch back to it. (One shared status poll instead of three, Data Used and storage read from it, a 30-minute latency slice instead of the full 24 h history, and about 2 forks per request instead of 19; the SIM-swap banner now checks every 10 seconds instead of 2.)
- **Fresher LTE signal while nobody is looking.** When no QManager page is open, LTE signal strength (RSRP, RSRQ, RSSI) now updates every few seconds instead of every 15 seconds to a minute, so tower failover and the Discord bot act on current readings. (Read over QMI by the modem broker, without extra AT commands; values run about 1 dB lower than the AT reading.)
- **Faster SMS inbox and forwarding.** **Cellular → SMS Center** now reads and sends messages over the modem's own messaging service instead of the AT channel, so opening the inbox no longer pauses signal updates, and SMS Forwarding relays a new text within moments instead of up to 15 seconds later. (QMI WMS through `qsms`; an inbox read used to hold the AT channel for about 7 seconds.)
- **RG501Q-EU joins the new modem broker.** The RG501Q-EU now gets everything this release brought to the RM520N-GL: AT commands go through QManager's own broker, the SMS inbox and forwarding use the modem's messaging service, and LTE signal stays fresh when no page is open. (`qmanager-atd` now runs on both models; checked on an RG501Q-EU upgraded from v0.1.14.)
- **Two old helper programs retired.** On both the RM520N-GL and the RG501Q-EU every AT command now goes through QManager's own modem broker and SMS through the modem's messaging service, so the install is smaller and nothing changes in the app. (`atcli_smd11` and `sms_tool` are no longer shipped; an upgrade removes the old copies only after `qcmd` and `qsms` answer.)

## 🐛 Fixes

- **The Web Console now requires you to be logged in.** Before, anyone who could reach the modem's web address on your network could open a root shell at `/console` without signing in; now **System Settings → Web Console** only starts a shell for a logged-in QManager session. Thanks to Chris (Flachzange) for reporting it. (Each connection uses a single-use, 30-second token from a login-checked endpoint; ttyd refuses the shell without one.)
- **SSH is no longer reachable from the mobile network.** The firewall now blocks SSH on the cellular side for both IPv4 and IPv6, so on carriers that give the modem a public address the root login is no longer exposed to the internet; SSH from your LAN, USB and Tailscale works as before. (New `ip6tables` rules too; the web UI was already LAN-only. The firewall now also stays up during an update.)
- **No more shared default SSH password.** A fresh install now sets a random temporary root password, shown once at the end of the install, instead of `qmanager`; onboarding still replaces it with your own. If onboarding can't update the SSH password, you now get a warning pointing to **System Settings → SSH Access**. (SSH passwords are now stored as SHA-512 instead of MD5.)
- **Safer updates.** **Software Update** now refuses to install anything that doesn't match the release's published checksum, including rollbacks, and only downloads from QManager's own GitHub releases. (Closes a URL trick that could point an update at another repository, and a local file swap in `/tmp`.)
- **Pinned downloads.** The Entware bootstrap, the speed-test tool and Tailscale are now checked against fixed SHA-256 hashes before they're installed, and the public-IP lookup on the **About** page now checks the server's certificate.
- **Data Used counts bytes correctly.** Once more than about 10 MB had moved, **Data Used** counted packets instead of bytes and read far too low; it now counts bytes. Your Data Used total starts again from zero once after this update.
- **Long SMS no longer arrive twice or merge with an older text.** When a multi-part alert or forwarded SMS fails partway, QManager no longer resends the parts that already went out, and **Cellular → SMS Center** keeps two different long messages apart even when the network reused their part number; the compose box now counts parts the way the modem sends them (accented letters like é no longer halve the limit). (A failed send in the compose box says how many parts were already delivered.)
- **Dota 2 shows its logo in Sites.** Adding `dota2.com` used to show only a letter because the site's own icon is too small to use; it now has a built-in logo.
- **Tighter system permissions for the web app.** The web interface could ask for more system access than its features need; it is now limited to exactly those actions, and nothing changes in how you use it. (Service, firewall and Custom DNS changes go through small root helpers that check every request; the reboot-cause log moved to `/usrdata/qmanager/` and is migrated automatically.)
- **Other programs on the modem can no longer block it.** Any local account could take the lock QManager uses to talk to the modem and stall signal readings and settings changes; now only QManager itself can, and nothing changes in how you use it. (The AT lock moved from `/tmp` to the root-owned `/run/qmanager_at/`; updates and rollbacks across the move are handled automatically.)

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
