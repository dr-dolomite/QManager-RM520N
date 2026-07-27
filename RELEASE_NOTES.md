# 🚀 QManager RM520N BETA v0.1.14-draft

Custom SIM Profiles gets a full redesign — a guided step-by-step wizard for creating profiles and at-a-glance cards for managing them, matching the polish of the RM551E build — plus ready-made profile suggestions for T-Mobile SIMs.

> One-click OTA from **System Settings → Software Update** if you're on v0.1.5 or newer.

## ✨ New Features

- **Ready-made profiles for T-Mobile SIMs.** Pop in a T-Mobile SIM and **Cellular → Custom SIM Profiles** now offers a **Recommended for your SIM** section with one-tap setups for T-Mobile and T-Mobile Home Internet — APN, TTL, and a 5G band lock already filled in. The suggestions disappear once you have a profile for that SIM, and come back if you delete it (the network can't tell TMHI and phone lines apart, so both are offered and you pick; recommended bands are checked against what your modem actually supports before anything is locked).

## 🛠️ Improvements

- **Custom SIM Profiles has a whole new look.** Creating a profile is now a guided four-tab wizard — Identity, Network, Scenario, Review — with Load-from-SIM quick-fill, a "use my saved APN" pick, a live duplicate-SIM warning, and a summary step before you save. Saved profiles now show as stacked cards with config pills, a live dot on the active one, and an "Applied/Partial/Failed at HH:MM" line, instead of a plain table. Find it under **Cellular → Custom SIM Profiles**, fully translated in all five languages (frontend-only redesign ported from the RM551E build — the profile data model and 4-step apply pipeline are unchanged; Verizon-specific UI is intentionally omitted since it doesn't apply to this modem).
- **The new-profile form fills itself in from your SIM.** Open the create form under **Cellular → Custom SIM Profiles** and your SIM's APN and ICCID appear on their own, without pressing Load from SIM — and anything you've already typed is left alone if the read finishes while you're mid-sentence. IMEI is still only filled by pressing **Load from SIM**, on purpose: a stored IMEI reboots the modem when the profile is applied.
- **A friendlier "page not found."** Hit a broken bookmark or a mistyped link and you now land on a branded 404 that speaks QManager's language — an animated signal meter reaching for a lock it can't get, the exact address you asked for, and a one-tap **Return to Dashboard** — instead of a blank error page (new `not-found` route styled to match the login/splash screens; works in light and dark).
- **SMS Center now speaks all five languages.** The inbox, compose dialog, and message views under **Cellular → SMS Center** are fully translated into English, Simplified Chinese (简体中文), Traditional Chinese (繁體中文), Italian (Italiano), and Indonesian (Bahasa Indonesia), matching the rest of the localized interface.

## 🐛 Fixes

- **A band lock applied by a SIM profile can no longer strand you offline.** If a profile's scenario locks bands your area can't serve, QManager now watches for a lost carrier and automatically reverts to all supported bands — the same safety net the manual Band Locking page has always had. This mattered most here, because binding that scenario also disables the Band Locking page, so there was no manual way back (opt-in via the existing band-failover setting; built-in Balanced/Gaming/Streaming scenarios are unaffected).
- **The profile form no longer repopulates itself after you edit a profile.** A SIM read that finished while you were editing could re-fill the form the next time you opened it; that stale response is now discarded instead of queued.
- **Your SMS inbox works again after an update.** Texts from both the SIM and the modem's own memory show up in **Cellular → SMS Center** again on devices that upgraded over-the-air, where the inbox could previously come up empty (in-app "Software Update" upgrades now refresh the bundled `sms_tool` binary they used to skip — the older stranded copy talked to the wrong device).

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
