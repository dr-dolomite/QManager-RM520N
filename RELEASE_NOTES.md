# 🚀 QManager RM520N BETA v0.1.18-draft

QManager's modem broker now runs on both the RM520N-GL and the RG501Q-EU, so both modems get lighter polling, a faster SMS inbox and fresher signal readings, plus a live **Now** view for Sites and a redesign of the dashboard, Cellular and System Settings pages to match QManager on the RM551E.

> One-click OTA from **System Settings → Software Update** if you're on v0.1.5 or newer.

## ✨ New Features

- **Live "Now" view for Sites.** The **Sites** card on **Monitoring → Latency Monitor** now opens on **Now**, which re-checks every site about every 2 seconds while the page is open and visible; switching to 1 h / 24 h / 7 d, leaving the page or hiding the tab stops it within about 10 seconds, and history keeps its normal 5-minute checks. (Live checks are a light HTTP request, about 25 MB per hour while open, and are never written to history; the first live value lands about 6 seconds after opening.)
- **A new setup wizard.** A fresh install now opens a step-by-step wizard: set your password and device name, then optionally choose the network mode, an APN or SIM profile, and a band preset before landing on the dashboard. You can skip any optional step, and a step that fails stays put and says why instead of moving on.
- **Change the modem's LAN address.** **Local Network → Ethernet** has a new **LAN Address** card where you set the gateway IP and subnet; applying it reboots the modem, and the page opens the new address on its own once the modem is back, on both the RM520N-GL and the RG501Q-EU. (Edits `mobileap_cfg.xml` without needing `xmllint`, which the RG501Q-EU lacks; the DHCP range moves into the new subnet.)
- **See your last outage at a glance.** The **Connection Quality** card on the dashboard now shows how long the last drop lasted, how long ago it was, and whether you came back on a new WAN IP. (Tracked by the alert engine from the kernel routing table; resets on reboot.)
- **Suggested APNs for your SIM.** On **Cellular → Settings → APN Management**, the APN field now offers the known internet APNs for the SIM in the modem; pick one and the APN (and its IP protocol, when the carrier lists one) fills in, then Save as usual. (Matched by the SIM's home network from its IMSI against a bundled list of about 800 networks built from LineageOS APN data; typing your own APN still works.)
- **Device Access page.** **System Settings → Device Access** holds a Passwords card with Web and SSH tabs; each asks for its current password first, and the SSH tab now checks the real root password. (Wrong guesses share the sign-in lockout and show the attempts left.)
- **Debug Report.** **System Settings → System Health Check** has a one-click download of a plain-text snapshot to share when troubleshooting. (IMEI, IMSI, ICCID and phone numbers are masked.)

## 🛠️ Improvements

- **Lighter background polling.** The modem's status poller now uses about half the CPU while a QManager page is open, and about a fifth when none is, leaving more headroom on the modem's single core. With no page open (or the tab hidden) it asks the modem for full signal data every 15 seconds, then every minute after 5 minutes, and goes back to full speed as soon as you open the dashboard. (Poller share of the core 27 % → 13 % active, 6 % idle on an RM520N-GL; status data is unchanged, but Signal History has fewer points while no browser is open.)
- **The LAN no longer overlaps 192.168.224.x.** The modem's factory LAN mask is a /22 (192.168.224.0–227.255), which clashes with routers on 192.168.224.1; QManager now sets it to /24 (192.168.225.0–255) and keeps the 192.168.225.1 address. It applies on the next reboot, and only if you never changed the LAN yourself. (Devices with a fixed IP in 192.168.224.x, .226.x or .227.x must move into 192.168.225.x.)
- **A lighter dashboard.** An open dashboard now uses much less of the modem's CPU, and a dashboard left in a background tab stops polling entirely until you switch back to it. (One shared status poll instead of three, Data Used and storage read from it, a 30-minute latency slice instead of the full 24 h history, and about 2 forks per request instead of 19; the SIM-swap banner now checks every 10 seconds instead of 2.)
- **Fresher LTE signal while nobody is looking.** When no QManager page is open, LTE signal strength (RSRP, RSRQ, RSSI) now updates every few seconds instead of every 15 seconds to a minute, so tower failover and the Discord bot act on current readings. (Read over QMI by the modem broker, without extra AT commands; values run about 1 dB lower than the AT reading.)
- **Faster SMS inbox and forwarding.** **Cellular → SMS Center** now reads and sends messages over the modem's own messaging service instead of the AT channel, so opening the inbox no longer pauses signal updates, and SMS Forwarding relays a new text within moments instead of up to 15 seconds later. (QMI WMS through `qsms`; an inbox read used to hold the AT channel for about 7 seconds.)
- **RG501Q-EU joins the new modem broker.** The RG501Q-EU now gets everything this release brought to the RM520N-GL: AT commands go through QManager's own broker, the SMS inbox and forwarding use the modem's messaging service, and LTE signal stays fresh when no page is open. (`qmanager-atd` now runs on both models; checked on an RG501Q-EU upgraded from v0.1.14.)
- **Two old helper programs retired.** On both the RM520N-GL and the RG501Q-EU every AT command now goes through QManager's own modem broker and SMS through the modem's messaging service, so the install is smaller and nothing changes in the app. (`atcli_smd11` and `sms_tool` are no longer shipped; an upgrade removes the old copies only after `qcmd` and `qsms` answer.)
- **A sidebar that folds into icons.** Collapse the sidebar to a slim icon strip with the button at the top left or Ctrl+B (Cmd+B on a Mac); each icon shows its name on hover, and a section with sub-pages opens them in a pop-out menu. The bar at the top of each page now shows where you are, named the same way as the sidebar. (Your choice is remembered; on a phone the sidebar stays a full-screen menu.)
- **A heads-up when the modem stops answering.** If QManager loses contact with the modem, a "Lost contact with the device. Reconnecting…" strip appears at the top of every page and goes away as soon as the modem answers again, instead of the page just freezing. (You are still sent to the login page only after about 90 seconds without contact, as before.)
- **More of QManager in your language.** The reboot countdown and the page-not-found screen are now translated, and error messages from the modem on the sign-in page and in the account menu now appear in your language when QManager recognizes them. (A new `errors` translation set for backend error codes.)
- **A new page-not-found screen.** A broken or mistyped link now lands on a small pixel-art campfire scene with a **Back to Dashboard** button; the fire holds still when **Animations** is set to Reduced.
- **Clearer password rules.** The setup wizard and **Change Password** in the account menu now show a checklist that ticks off each rule as you type, and **Use strong password** (on by default) asks for an uppercase letter, a lowercase letter and a number. Turn it off to allow any password of 6 characters or more. (The modem checks the same rules.)
- **Clearer signal colours.** Signal readings on the dashboard and the **Cellular** pages now use plain red, yellow and green, so fair and good signal no longer look alike. (Five quality levels on three colours; the bar icon still tells neighbouring levels apart.)
- **Speed Test moved to Device Metrics.** The last result sits in a pinned tile at the foot of the dashboard's **Device Metrics** card, and both cell distances share one row.
- **Radio page tidy-up.** On **Cellular**, Copy diagnostics now sits in the corner of the Spectrum card, the distance estimate gets a tappable hint, and cell numbers use the regular typeface.
- **A redesigned Band Locking page.** **Cellular → Band Locking** opens on a status card showing the carriers on air and how each band category is locked, with Band Failover as an Off/On switch. Cards owned by a SIM profile now say "Profile controlled". (NR-DC band locking is not included.)
- **A redesigned Tower Locking page.** **Cellular → Tower Locking** lets you lock, add or remove a cell straight from its carrier tile, and the failover threshold has a slider with a live signal meter. **Keep after reboot** is now set separately on the LTE and NR cards. (Maps to the per-radio values of `AT+QNWLOCK="save_ctrl"`.)
- **A redesigned Frequency Locking page.** **Cellular → Frequency Locking** drops the bar under the cards: each card now has its own Apply, Clear lock and clear-fields buttons, and a failed lock says why.
- **A redesigned Custom Profiles page.** **Cellular → Custom Profiles** lists your profiles with an Active / SIM Mismatch / Inactive chip, and creating or editing one opens a four-step wizard. Applying a profile made for a different SIM now asks first. (Scenarios are added and edited in one dialog, and the running scenario pulses.)
- **Tidier Settings and IMEI buttons.** **Cellular → Settings** gets a compact Refresh button, and **IMEI Settings** gets a Reset button and a check mark when the field already matches the modem's IMEI. "Reboot later" after an IMEI change keeps the reboot reminder on every page until you restart.
- **NR bandwidth in MHz on the Cell Scanner.** **Cellular → Cell Scanner** shows NR bandwidth in MHz instead of resource blocks, in the table and the CSV export. (Converted with the cell's subcarrier spacing per 3GPP TS 38.101-1; the raw PRB count shows when it can't be converted.)
- **System Settings matches RM551E.** **System Settings** is now two cards: Device & Units (with Tracked SIMs and a Discard button) and Scheduled Reboot, which shows the modem's live clock and a day rail.
- **Stuck installs are caught.** **Software Update** notices when an install goes quiet for two minutes and offers a confirmed Restart now; failure messages now say why.
- **Ethernet speed waits for Apply.** On **Local Network → Ethernet**, choosing a link speed no longer applies it at once; press Apply (or Discard) in the card. **Local Network** now opens on Ethernet.
- **A redesigned Traffic Engine page.** **Local Network → Traffic Engine** now opens on one engine card where you pick Off, Video Optimizer or Full Bypass, with status, uptime and a one-minute chart of new connections; each mode has its own card, and Video Optimizer's hostnames are grouped by service and saved together. (Same tpws backend; nothing to reconfigure.)
- **A redesigned Custom DNS page.** **Local Network → Custom DNS** now has a Resolver card with one-click provider presets (Cloudflare, Google, Quad9, AdGuard, ControlD) and separate IPv4 and IPv6 server cards, all applied from one button; the card shows which servers are answering right now.
- **Small extras.** **Logs** has a Copy button, the **AT Terminal** refuses text that isn't an AT command, **About** has a Credits dialog, and the **Support** page is easier to read on a phone.

## 🐛 Fixes

- **The Web Console now requires you to be logged in.** Before, anyone who could reach the modem's web address on your network could open a root shell at `/console` without signing in; now **System Settings → Web Console** only starts a shell for a logged-in QManager session. Thanks to Chris (Flachzange) for reporting it. (Each connection uses a single-use, 30-second token from a login-checked endpoint; ttyd refuses the shell without one.)
- **SSH is no longer reachable from the mobile network.** The firewall now blocks SSH on the cellular side for both IPv4 and IPv6, so on carriers that give the modem a public address the root login is no longer exposed to the internet; SSH from your LAN, USB and Tailscale works as before. (New `ip6tables` rules too; the web UI was already LAN-only. The firewall now also stays up during an update.)
- **No more shared default SSH password.** A fresh install now sets a random temporary root password, shown once at the end of the install, instead of `qmanager`; onboarding still replaces it with your own. If onboarding can't update the SSH password, you now get a warning pointing to **System Settings → SSH Access**. (SSH passwords are now stored as SHA-512 instead of MD5.)
- **Setup no longer rejects every APN.** The APN step in setup was sent in a format the modem refused, so a typed APN never saved; it now saves, and a network mode the modem refuses no longer moves on as if it had worked.
- **Change Password counts wrong guesses.** A wrong current password in **Change Password** now counts toward the same lockout as the sign-in page: after 5 wrong tries both wait 30 seconds, and the wait grows with more failures.
- **Dashboard rows no longer cut off labels on phones.** On a narrow screen, **Data Used** and **Cell Distance** in the dashboard's **Device Metrics** card now wrap their values under the label instead of cutting it short.
- **Safer updates.** **Software Update** now refuses to install anything that doesn't match the release's published checksum, including rollbacks, and only downloads from QManager's own GitHub releases. (Closes a URL trick that could point an update at another repository, and a local file swap in `/tmp`.)
- **Pinned downloads.** The Entware bootstrap, the speed-test tool and Tailscale are now checked against fixed SHA-256 hashes before they're installed, and the public-IP lookup on the **About** page now checks the server's certificate.
- **Data Used counts bytes correctly.** Once more than about 10 MB had moved, **Data Used** counted packets instead of bytes and read far too low; it now counts bytes. Your Data Used total starts again from zero once after this update.
- **Long SMS no longer arrive twice or merge with an older text.** When a multi-part alert or forwarded SMS fails partway, QManager no longer resends the parts that already went out, and **Cellular → SMS Center** keeps two different long messages apart even when the network reused their part number; the compose box now counts parts the way the modem sends them (accented letters like é no longer halve the limit). (A failed send in the compose box says how many parts were already delivered.)
- **Tighter system permissions for the web app.** The web interface could ask for more system access than its features need; it is now limited to exactly those actions, and nothing changes in how you use it. (Service, firewall and Custom DNS changes go through small root helpers that check every request; the reboot-cause log moved to `/usrdata/qmanager/` and is migrated automatically.)
- **Other programs on the modem can no longer block it.** Any local account could take the lock QManager uses to talk to the modem and stall signal readings and settings changes; now only QManager itself can, and nothing changes in how you use it. (The AT lock moved from `/tmp` to the root-owned `/run/qmanager_at/`; updates and rollbacks across the move are handled automatically.)
- **4G SINR now reads in real dB.** The LTE SINR on the dashboard and the **Cellular** page was the modem's raw value and could read several dB off; it now matches the modem's own per-antenna figures. (QENG raw X → 2X−20.)
- **Reverting to the carrier APN no longer fails silently.** "Use carrier default" on the APN card now completes cleanly, and if the modem changed but QManager could not save the setting, you get a warning instead of a quiet success. (`apn.sh` no longer leaves a stray temp file when a save fails.)
- **Clearer APN error messages.** When an APN change fails, the message now says what went wrong (the modem couldn't detach, didn't confirm it re-registered, was given a different APN, or another change was still running) in all five languages.
- **Cell Scanner locks NR cells with the right spacing.** Locking an NR cell from **Cellular → Cell Scanner** now picks the subcarrier spacing from the band instead of always 30 kHz, which mis-locked bands such as n71 and n25.

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
