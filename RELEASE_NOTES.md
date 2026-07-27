# 🚀 QManager RM520N BETA v0.1.14-draft

Custom SIM Profiles gets a full redesign — a guided step-by-step wizard for creating profiles and at-a-glance cards for managing them, matching the polish of the RM551E build — plus ready-made profile suggestions for eight carriers. QManager also remembers your SIM cards properly now: a new **Tracked SIMs** list in System Settings shows every SIM the modem has seen, and the "New SIM card detected" banner finally stays dismissed for good, per SIM, on the device itself.

> One-click OTA from **System Settings → Software Update** if you're on v0.1.5 or newer.

## ✨ New Features

- **Ready-made profiles for your carrier.** Insert a SIM and **Cellular → Custom SIM Profiles** now offers a **Recommended for your SIM** section with one-tap setups — APN and TTL already filled in — for T-Mobile, T-Mobile Home Internet, Verizon, AT&T, Smart, Globe, GOMO, and DITO. The suggestions disappear once you have a profile for that SIM, and come back if you delete it (the T-Mobile pair also includes a 5G band lock, checked against what your modem actually supports before anything is applied; the other carriers set APN and TTL only, so your Band Locking page stays available).
- **Prepaid and reseller SIMs are left alone.** SIMs from resellers that ride a bigger carrier's network — Mint, Google Fi, US Mobile, Visible, Cricket, Metro and others — no longer get their host carrier's suggestions, since those need a different APN. The check reads the service-provider name written on the SIM itself, which is the only place a reseller's identity actually appears.

- **See every SIM QManager remembers.** A new **Tracked SIMs** card in **System Settings** lists each SIM by carrier, phone number, and the date it was first seen, marks the one currently in the modem, and shows whether it still raises a new-SIM alert. SIMs already known to your device appear on the list after updating, with alerts already switched off (existing SIMs are backfilled from the known-SIMs list; historical entries show "Added before tracking began" rather than a made-up date).

- **Turn the new-SIM alert back on for any SIM.** If you dismissed the "New SIM card detected" banner and want it back — say you're testing a profile — hit **Show Alert** on that SIM's row in Tracked SIMs and the banner returns, no reboot or reload needed.

## 🛠️ Improvements

- **Custom SIM Profiles has a whole new look.** Creating a profile is now a guided four-tab wizard — Identity, Network, Scenario, Review — with Load-from-SIM quick-fill, a "use my saved APN" pick, a live duplicate-SIM warning, and a summary step before you save. Saved profiles now show as stacked cards with config pills, a live dot on the active one, and an "Applied/Partial/Failed at HH:MM" line, instead of a plain table. Find it under **Cellular → Custom SIM Profiles**, fully translated in all five languages (frontend-only redesign ported from the RM551E build — the profile data model and 4-step apply pipeline are unchanged; Verizon-specific UI is intentionally omitted since it doesn't apply to this modem).
- **The new-profile form fills itself in from your SIM.** Open the create form under **Cellular → Custom SIM Profiles** and your SIM's APN and ICCID appear on their own, without pressing Load from SIM — and anything you've already typed is left alone if the read finishes while you're mid-sentence. IMEI is still only filled by pressing **Load from SIM**, on purpose: a stored IMEI reboots the modem when the profile is applied.
- **A clearer "New SIM card detected" banner.** The banner now names the SIM's carrier and phone number instead of just announcing a swap, and offers exactly one next step: **Apply Profile** when a saved profile matches the card, or **Create Profile** when none does — which now drops you straight into the profile creation form.
- **Dismissing the banner asks first, and says what it means.** Closing the banner now opens a short confirmation that spells out the SIM's ID and makes clear you're silencing the alert for *that SIM only* — every other card still raises it, and you can undo it from Tracked SIMs.
- **A friendlier "page not found."** Hit a broken bookmark or a mistyped link and you now land on a branded 404 that speaks QManager's language — an animated signal meter reaching for a lock it can't get, the exact address you asked for, and a one-tap **Return to Dashboard** — instead of a blank error page (new `not-found` route styled to match the login/splash screens; works in light and dark).
- **SMS Center now speaks all five languages.** The inbox, compose dialog, and message views under **Cellular → SMS Center** are fully translated into English, Simplified Chinese (简体中文), Traditional Chinese (繁體中文), Italian (Italiano), and Indonesian (Bahasa Indonesia), matching the rest of the localized interface.
- **Your settings survive a power cut during an update.** Config files rewritten by an update are now swapped into place in a single step instead of being rewritten in the open, so losing power mid-update can no longer leave one half-written on flash (also cleans up leftover scheduling entries from pre-timer versions, which a bug could previously skip entirely).

## 🐛 Fixes

- **A band lock applied by a SIM profile can no longer strand you offline.** If a profile's scenario locks bands your area can't serve, QManager now watches for a lost carrier and automatically reverts to all supported bands — the same safety net the manual Band Locking page has always had. This mattered most here, because binding that scenario also disables the Band Locking page, so there was no manual way back (opt-in via the existing band-failover setting; built-in Balanced/Gaming/Streaming scenarios are unaffected).
- **The profile form no longer repopulates itself after you edit a profile.** A SIM read that finished while you were editing could re-fill the form the next time you opened it; that stale response is now discarded instead of queued.
- **Your SMS inbox works again after an update.** Texts from both the SIM and the modem's own memory show up in **Cellular → SMS Center** again on devices that upgraded over-the-air, where the inbox could previously come up empty (in-app "Software Update" upgrades now refresh the bundled `sms_tool` binary they used to skip — the older stranded copy talked to the wrong device).
- **Dismissing "New SIM card detected" now really sticks — on the modem, not just in your browser.** The dismissal used to be remembered only by the browser you clicked it in, so the banner came back on your phone, on another laptop, or after clearing site data. It's now stored on the device per SIM and survives reboots and updates (the old dismiss request quietly failed on the device and reported success anyway; it's been replaced with a proper privileged write).
- **The wrong phone number no longer sticks around after a SIM swap.** If you switched to a SIM with no number provisioned — common on prepaid and data-only cards — QManager kept displaying the *previous* SIM's number. It now correctly shows "No number provisioned" instead (also made the number parsing robust against carriers that put a comma in the SIM's name field).
- **Tightened permissions on the folder QManager's system helpers load code from.** This folder was world-writable, which could have let a local attacker on the device replace one of those files and have it run with full privileges. It's now locked down, and the fix re-applies itself on every update so existing devices are repaired automatically.
- **Tightened permissions on QManager's own program folder.** The folder holding the web console was world-writable, which could have let a local attacker swap in their own console program to be run with full privileges at the next start. Now locked down, and repaired automatically on update.
- **Tightened permissions on the HTTPS certificate folder.** The certificate folder and the public certificate were world-writable, which could have let a local attacker replace them and intercept your connection to the QManager web interface. Both are now locked down, with the private key restricted on every update.
- **Tightened permissions on the web root.** The folder QManager serves the web interface from was world-writable, which could have let a local attacker on the device tamper with the pages and scripts it serves. Now locked down, and repaired automatically on update.
- **An update can no longer stop partway through.** On a small number of devices, a config check during the update could fail and take the whole update down with it — after QManager's services had already been shut down for the upgrade. That check now logs a warning and carries on.
- **Tightened permissions on the scheduling folder and the background-service settings file.** Both were writable by the web interface, which could have let a local attacker influence code that runs with full privileges. The settings file is repaired the moment you update; the folder is repaired on your **next reboot after** updating, since that's when QManager's boot setup runs.

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
