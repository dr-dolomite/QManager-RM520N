# 🚀 QManager RM520N BETA v0.1.14

The biggest QManager update yet: a brand-new **Traffic Engine** for beating carrier video throttling (ported by **carp4**), ground-up redesigns of System Settings, Watchdog, Alerts, Tailscale, Custom SIM Profiles, Speed Test, Cellular Radio Information, SMS Center and Cell Scanner, a fix for a reboot loop some modems hit with Scheduled Reboot on, and a sweep of file-permission security fixes across the device.

> One-click OTA from **System Settings → Software Update** if you're on v0.1.5 or newer.

## ✨ New Features

- **Beat carrier video throttling with Traffic Engine.** A new **Local Network → Traffic Engine** page adds **Video Optimizer** (garbles the handshake for sites on your list) and **Full Bypass** (garbles everything) — downloaded and checksum-verified on-device from the zapret project, no PC needed.
- **Test bypass in one click.** A two-phase speed test compares your connection with and without the engine and shows the improvement factor, through its own private copy so your live connection is never interrupted. It also now samples speedtest.net (falling back to Cloudflare) as a reference, so a slow fast.com beside a healthy reference correctly reads as *throttled* rather than just slow.
- **Edit, back up and restore your protected sites list.** Video Optimizer's hostlist is editable with instant apply, and gains **Export**, **Import** and **Restore defaults** (subdomains match automatically; bad or duplicate entries are skipped on import).
- **QUIC → Force TCP tile.** A standalone tile on Traffic Engine blocks QUIC (UDP 443) so QUIC-first apps fall back to TCP where the engine can tune the stream — independent of the engine's own install and enable state. Automatic QUIC marking is removed; QUIC is now passthrough by default, blocked only when you switch this on.
- **"Traffic Masquerade" is now "Full Bypass."** Your setting carries over on update.
- **See exactly how your bands stack up.** The dashboard's Secondary Carriers card is now a full-width **Carrier Aggregation** strip — a proportional bandwidth bar plus a tile per carrier with role, PCI, ARFCN and signal. A dropped carrier stays visible, greyed with "Released Xm ago," before it fades out.
- **Ready-made profiles for your carrier.** Insert a SIM and **Custom SIM Profiles** adds ready-made APN/TTL setups for T-Mobile, T-Mobile Home Internet, Verizon, AT&T, Smart, Globe, GOMO and DITO, marked **Suggested**. Prepaid/reseller SIMs (Mint, Google Fi, US Mobile, Visible, Cricket, Metro, etc.) are correctly excluded.
- **See every SIM QManager remembers.** A new **Tracked SIMs** card in System Settings lists each SIM by carrier, number and first-seen date, flags the active one, and lets you re-arm its new-SIM alert.
- **QManager now flags a flapping connection.** Recent Activities raises one amber "LTE band unstable" warning instead of a row per hop when the modem changes band or cell six or more times in five minutes.
- **The Speed Test has been rebuilt.** A Latency → Download → Upload stepper shows live readouts as each stage lands, with a full result panel (jitter, packet loss, server). A run that fails partway keeps what it already measured, and a test started elsewhere (another tab or device) shows up live on the dashboard's Speed Test tile.
- **Every band, with its own readings — no clicking.** **Cellular and Radio Information** shows one row per carrier with RSRP/RSRQ/SINR/RSSI and meters side by side, a Live/Stale chip, link uptime, address family and an estimated distance to site. A **Copy diagnostics** button puts a safe-to-share summary (no IMEI, ICCID, IP or cell IDs) on the clipboard.
- **Antenna Statistics has been rebuilt.** Summary tiles for MIMO, serving mode and chain count sit above one card per radio with all four ports, each with its own RSRP/RSRQ/SINR and quality verdict — a dead or unplugged port stays visible instead of vanishing.
- **Antenna Alignment now gives you one number to aim by.** A live **Live Aim** score out of 100 combines the readings behind it, alongside your best session score and how much it just moved.
- **Custom SIM Profiles and Connection Scenarios are now one page**, opening with an "in force now" card (active profile, APN, TTL, bound scenario) and a 24-hour strip showing the day's scenario schedule.
- **Choose how much animation you want.** A new sidebar **Animations** setting (System/Full/Reduced) applies before the page paints.
- **Your modem can now notice a SIM swap while running.** A new **SIM Hot-Swap Detection** switch under Cellular Basic Settings detects insert/removal without a reboot, and reports whether a card is present.
- **See what's in your other SIM slot.** Cellular Basic Settings now shows the inactive slot's card presence and last four digits, where firmware supports it.
- **See what your carrier actually granted.** APN Settings opens with a card showing your live-attached APN, bearer state and IPv4/IPv6 addresses beside your saved setting.
- **"Reboot Later" on IMEI Settings now actually remembers**, with a persistent reminder banner until you restart.

## 🛠️ Improvements

- **The welcome and sign-in screens have been redesigned** to match the rest of QManager — Internet and Temperature lead, status tiles use an icon on a coloured disc instead of a colour-only fill, and sign-in names the device you're connecting to, with a new "Can't sign in?" recovery-help link.
- **Login lockout now backs off gradually** — 30 seconds, then 2/5/15 minutes on repeated failures — and shows tries remaining; the countdown survives a refresh.
- **System Settings has been rebuilt**, leading with the modem's real clock, next scheduled reboot and SIM count before any settings. Every control now states its consequence up front (a reboot drops your session ~90s), it no longer shows plausible defaults for config the modem didn't report, and the whole page is translated into all five languages.
- **The connectivity check tries real hostnames first** (cloudflare.com, google.com, then 1.1.1.1/8.8.8.8), all four editable under **System Settings → Connection Quality → Probe Targets**.
- **Connection Quality profiles now actually change the fail window** — previously all four profiles shared one stored value.
- **The Watchdog page has been rebuilt** — four status tiles plus a single Recovery ladder card, replacing a layout that drew the same four steps twice. A stopped-but-enabled watchdog now says so instead of claiming it's still starting, turning it on warns about the unattended-reboot step it arms, and Recovery history now sorts correctly by time. Fully translated.
- **The Alerts page has been rebuilt**, leading with a coverage grid answering "if this happens, where does it go?" SMS, Email and Discord are now three pills instead of four tabs, so Save can't commit hidden fields. History now reads as the same event rows as the dashboard. Fully translated (183 strings), and old `/monitoring/sms-alerts` / `/monitoring/email-alerts` bookmarks redirect instantly.
- **The Tailscale page has been rebuilt**, opening with connection state, tailnet address, tailnet name and peer count. The peer table gets its full width and hidden OS/Last-seen columns back, offline peers no longer show a fake decades-old timestamp, and a failed peer load offers retry. Fully translated (137 strings); the install log now follows your theme instead of a hardcoded dark panel.
- **Internet badge finally works.** It now reads **Online**, **Unstable**, **Recovering**, **No Reply** or **Not Measured**, replacing a field that was permanently blank.
- **Lost pings now show as gaps, not 0 ms**, on Live Latency and Monitoring → Latency Monitoring, and the average latency ignores those gaps.
- **Jitter and packet loss read as unknown until there's enough data**, instead of a false "0 ms / 0%" from two samples. Latency is now credited to whichever probe target actually replied, so a fallback switch shows as a gap, not a fake spike.
- **The dashboard finally has a page header** (Radio/Internet/Stale chips) and consistent card sizing, with one shared geometry module so a card and its loading skeleton can no longer disagree.
- **Cards show "No reading" instead of a fake 0 or dash** when the modem can't be reached; identifiers like IMEI keep their last known value.
- **LTE/5G signal cards refreshed** — tinted rows, filled quality chips, radio-coloured badges (blue 5G / violet 4G) with bar-count for quality so it still reads in greyscale, plus a hidden screen-reader word alongside colour.
- **Smoother dashboard state changes.** Readings ease between values instead of snapping, and only the values that actually changed dip in, in reading order, over ~700ms.
- **One rounded icon set across the dashboard and the entire Cellular section**, replacing four mismatched sets.
- **Recent Activities redesigned** — a header chip reads "All clear" or a count of open issues, rows fade after an hour unless still unresolved, band-change spam is debounced into one "settled on B28 (was B41)" line, and history now retains 300 events (was 50). Fully translated.
- **The Cell Scanner has been redesigned** — a compact launch bar that grows into the progress view, one **Sweep all bands** button stating its 30s–3min cost, and a coloured signal dial per operator in the summary.
- **The Neighbour Scanner now shows RSRQ/RSSI/SINR** and filters by channel; a cell that can't be locked says why. Frequency Calculator matches the new page style. All three pages fully translated.
- **Cellular Basic Settings has been redesigned** — one list of settings rows each stating its consequence in plain English, tappable pill groups instead of dropdowns, changes staged behind a pending-changes bar with before/after per row, and a named progress stage during a ~35s slot change. Fully translated.
- **Applying a profile now shows real step detail** — the APN that landed, "already set," or the exact modem error — with a **Reapply profile** option on failure.
- **Deactivating a profile now reverts your APN properly**, instead of just clearing the Active badge.
- **Creating a profile moved into a dialog** instead of taking over half the page.
- **Dialogs, alerts and slide-outs now sit on a proper raised surface** everywhere in QManager, instead of blending into the page background in dark mode.
- **A part-applied or empty profiles state now offers the right next step** — Reapply, Activate a profile, or New Profile — instead of a dead end or a duplicate button.
- **The new-profile form pre-fills from your SIM** (APN, ICCID) without a manual Load-from-SIM press; IMEI still needs the explicit button since it triggers a reboot on apply.
- **A clearer "New SIM card detected" banner** names the carrier and number and offers one action; dismissing it now confirms first and explains it only silences that SIM.
- **Remembered SIMs moved to live under Tracked SIMs** in System Settings. Connection Scenarios is fully translated too.
- **Cellular and Radio Information redesigned**, with summary tiles, a Live/Stale indicator, and carrier counts now derived from actual reported bands. Fully translated.
- **Antenna Alignment redesigned** — live aim instrument, then the 3-position recorder, then a Receive Chains strip; clearing a recording now confirms first. Fully translated, along with Antenna Statistics.
- **SMS Center redesigned** — three summary tiles (unread, modem memory, SIM memory), separate storage meters for modem (255) vs SIM (35) instead of one combined figure, per-memory delete-all reporting, and clearer SMS Forwarding status states. Fully translated.
- **Save buttons across QManager now confirm properly** — label → spinner → tick, without resizing or losing keyboard focus, and a second press during save is ignored.
- **Config writes are now atomic**, so a power cut mid-update can't leave a half-written file.
- **Band Locking redesigned** — one status card (posture, failover state, on-air bands) above tappable band chips showing pending changes before you apply; "unlock" is now labelled **Restore all supported**. Gains a Refresh button. Fully translated.
- **Tower Locking redesigned** — a status card plus tap-to-lock cell tiles with **Use this cell**, a last-read timestamp, and clearer failure/partial-lock reporting. Fully translated.
- **Frequency Locking redesigned** — a "Right now" verdict strip with tap-to-add channels, real downlink frequency shown per EARFCN, up to 32 5G channels (was 4), and an explicit warning that this lock has no automatic safety net. Fully translated.
- **APN Settings redesigned** to match Cellular Basic Settings' grouped-row layout; the carrier profile (MBN) picker is now a keyboard-navigable tappable list.
- **Network Priority redesigned** — each technology is a row with rank, meaning and a "Serving now" chip (correctly marking both legs on 5G NSA); reordering now works with a keyboard.
- **IMEI Settings redesigned** — the legal notice is now a persistent top banner, and current vs. draft IMEI are two clearly separated fields.
- **"FPLMN Settings" renamed to "Blocked Networks"** for consistency across sidebar, breadcrumb and title. APN Management, Network Priority, IMEI Settings and Blocked Networks are all fully translated.
- **Ethernet Status redesigned** with colour-coded summary tiles for link/speed/duplex/negotiation, and instant-apply speed limit. Fully translated.
- **Traffic Engine layout polish** — Bypass mode and Test bypass sit side by side on wide windows, Test bypass gets a proper resting state, the loading skeleton now matches the real page, and the protected-sites list flows into columns with a five-row scroll cap.
- **A branded 404 page** replaces the blank error page, matching the login/splash style.

## 🐛 Fixes

- **Closed several permission holes across the device's file system.** The SSH service file, QManager's program folder, web root, settings folder, scheduling folder, background-service config and the HTTPS certificate folder were all world-writable — any local process could tamper with them or intercept traffic. All are now locked down and self-repair on update.
- **A security hole letting the web interface control root-level background services is closed.** That config moved to `/etc/qmanager.env` — if you hand-edited `/etc/qmanager/environment` over SSH, that's the new path.
- **Your Discord bot token, email app password and saved login backups are no longer world-readable.** All three move to a root-only store automatically on update — **please rotate your Discord token and email app password anyway**, since a permission fix can't un-expose a credential that was already readable.
- **SSH no longer gives up permanently while the modem is still booting.** It now retries for over a minute instead of failing five times in half a second and waiting for the next reboot.
- **A second, unwanted lighttpd instance could grab the web port on some boots**, making QManager unreachable until an SSH fix; the installer now disables it for good.
- **Fixed a reboot loop after upgrading with Scheduled Reboot enabled**, caused by the modem's clockless 1970-boot jump tripping the scheduler. **⚠️ If your modem is looping right now, pull the SIM before updating** — a loop only stays up ~30s at a time, too short to install an update — then switch Scheduled Reboot off and reinsert the SIM.
- **A weekday-only reboot schedule is now checked twice** — at save and again when it fires — so a stray trigger on the wrong day is refused.
- **A crashing background service now actually stops** instead of restarting forever (a restart-limit setting was silently ignored on six services).
- **A schedule that fails to arm no longer reports success** — Scheduled Reboot and Tower Lock Schedule now say when the timer isn't actually running.
- **A band lock from a SIM profile scenario can no longer strand you offline** — QManager now watches for a lost carrier and reverts to all supported bands, the same safety net Band Locking has always had.
- **Recent Activities was silently dropping every event the web interface itself caused** (APN saves, profile changes) — a log-file ownership bug at boot; all events now land in the same feed.
- **"No Events" no longer means "we couldn't check"** — a failed activity-log read now says so instead of showing a false all-clear.
- **Stale radio readings no longer look live**, and a carrier's "released" state is now timed off real data arrival instead of screen redraws.
- **An idle antenna port no longer reads as a failing one** — both Radio Info and Antenna pages now say "Not reporting" instead of a fake -140 dBm reading.
- **Antenna recording accuracy fixes** — positions no longer re-rank themselves on a routine 4G/5G switch, "Averages 3 samples" now waits for genuinely new readings, and a missing reading no longer costs a position a flat 40-point penalty.
- **4G/5G cards misaligned in Italian** — long headings now trim instead of wrapping.
- **Applying a SIM profile now really changes your APN** — the apply step now confirms what the carrier granted instead of reading back the modem's own unchanged setting.
- **An APN save and a profile apply can no longer collide** — one now waits for the other instead of both racing the connection.
- **Deactivating or deleting a profile no longer returns a broken, unreadable response.**
- **Editing your currently-active profile now actually re-applies it**, instead of only updating the saved copy.
- **A profile activation started elsewhere (another tab, at boot) now shows up and tracks correctly**, including its progress and any part-applied warning attaching to the right profile.
- **Deactivate/Reapply/Activate now go dead while another apply is in flight**, instead of allowing a second command into a busy modem.
- **A long apply step message no longer breaks the dialog layout, and Cancel in the profile wizard now just closes it** instead of wiping everything you'd typed.
- **Saving an APN no longer reports failure on a save that worked** — the brief link drop during apply used to kill the response; it now verifies and re-reads instead.
- **An APN your carrier silently changed is now reported as such**, instead of a false success.
- **Your APN and profile-slot names are actually saved now** — both were being written to a folder the web interface can't create files in.
- **IPv4/IPv6/DNS/gateway now parse correctly on IPv6 and dual-stack connections.**
- **"Use carrier default" no longer arms before the page has read anything.**
- **The VoLTE/emergency-call confirmation is back for CID 2/3 on modems that don't report a context list.**
- **The MTU page now reads whichever channel is actually carrying your traffic**, instead of always the first one.
- **A band-lock error no longer appears under all three radio cards at once, and applying one lock now pauses the other two** so a second apply can't cancel the first's safety-net window.
- **Tower Locking's switches no longer freeze up when signal failover is on.**
- **A narrowed frequency lock no longer silently re-sends the channel you removed**, Refresh no longer blanks the page, and "Use current" is disabled with a clear reason when there's no carrier to copy.
- **A half-finished 5G channel entry (ARFCN with no subcarrier spacing) can no longer be silently dropped.**
- **Frequency Locking now refuses to write when it can't confirm a tower lock isn't active**, instead of risking both locks stacked.
- **Tower Locking no longer reports a confident "Unlocked" or a false-off "Keep lock after reboot" when the modem simply didn't answer, and a lock is no longer undone ~30s later by the brief signal drop locking itself causes.**
- **Losing signal readings no longer clears your tower locks** — "no reading" no longer counts as a 0% reading.
- **The failover chip's states now report accurately, and a tower lock that half-succeeds no longer reports total failure.**
- **Six controls on Tower Locking were invisible** (same colour as their background) — now visible in both themes.
- **A running full sweep no longer looks like a broken modem** — the connection watchdog and dashboard poller now stand down for the sweep's duration.
- **A cell with no signal measurement now reads "No data" instead of a false "Bad," and a scan that dies mid-run reports lost after ~10s** instead of hanging forever.
- **The Neighbour Scanner now shares the main scanner's code**, picking up four fixes it had been missing.
- **Starting a scan while the other type is running now says so immediately**, instead of failing confusingly ~16s later.
- **A failed scan's error no longer vanishes on reload or in a second tab, and a half-blocked neighbour read no longer reports a false "complete — 0 cells."**
- **Switching language mid-scan no longer freezes the progress display.**
- **Retrying a failed read no longer discards your unsaved staged changes** on Cellular Basic Settings.
- **An incomplete 5G rate-limit reading from your carrier no longer breaks the whole page, and two open tabs no longer mix their rate-limit readings together.**
- **An unrecognized network type now reads "Unknown" instead of a false "LTE."**
- **Changing carrier-profile auto-select and picking a bundle together no longer drops one of the two changes.**
- **An invalid IMEI is now rejected by checksum before it's written**, not just checked for digit count.
- **"No Blocked Networks" no longer means "we couldn't check," and clearing the list now asks for confirmation first.**
- **Network Priority no longer hides a failed read behind an empty list**, and Save is no longer permanently lit when nothing changed. 4G/3G rows now use their own radio colour instead of a false green/red health tint.
- **A failed AT command is no longer reported as a success** — this swept across Tower Locking's schedule, IP Passthrough, IMEI Settings and MBN carrier bundles.
- **The watchdog no longer undoes a working SIM failover** by checking readiness before the newly-inserted backup SIM has finished starting.
- **The Traffic Engine no longer shows "Stopped" while actually running**, on modems where the web user lacks systemd query privileges.
- **"Packets processed" no longer resets to zero every minute** from an unnecessary rule recreation.
- **Switching Bypass Mode no longer blanks the whole page**, including a running Test bypass, which used to be silently thrown away.
- **Arrow keys no longer apply every mode they pass over** when navigating Bypass Mode with a keyboard.
- **Your inbox no longer vanishes when the modem is momentarily busy** — it shows a "Stale" tag instead of blanking.
- **Reply is hidden on senders that aren't real phone numbers** (e.g. GLOBE, SMART, NDRRMC).
- **Filtering or searching no longer lets a hidden selected message get deleted, and Refresh no longer resets your tab, search, sort and selection.**
- **Refresh/Retry now show a spinner and can't be double-fired.**
- **SMS Center and SMS Forwarding are now fully translated** (~100 previously-English labels each).
- **SMS Forwarding no longer claims "off" before it's actually read your settings**, and highlights unsaved changes. A long forwarding error message no longer overflows its card.
- **Screen readers no longer announce the whole SMS page on every background refresh.**
- **Your SMS inbox works again after an OTA update** — the bundled `sms_tool` binary is now refreshed on in-app updates too.
- **Save-button "Saving…" no longer reverts to English mid-save, and the success tick now actually appears** on TTL & Hop Limit, MTU, System Settings, Alerts and Watchdog.
- **Saving on Alerts or Watchdog no longer bounces you back to the first tab or flashes the activity list back to loading.**
- **Replacing a stored app password or bot token now clears the input field on success.**
- **System Settings no longer re-animates itself on every save.**
- **Rounded corners now render at their intended size** (~174 places were falling back to a smaller radius).
- **The Back button no longer traps you in a login redirect loop.**
- **A setting that silently reverted at reboot now fixes itself.** Watchdog, SMS Forwarding, tower failover and Discord alerts could report success and then vanish after a restart (most often after Tailscale had been installed) — affected devices repair themselves on this update, and the page now tells you if a save genuinely can't persist.
- **Dialog close no longer freezes the page for a second afterward.**
- **The speed test progress bar is now visible in dark mode** (was nearly invisible from insufficient contrast).
- **Two profile activations can no longer run at once**, and the apply progress dialog no longer shows a stale previous run's result.
- **Connection Quality settings can now recover from a corrupted probe-target file**, instead of refusing every future save.
- **A dashboard speed test and the Speed Test dialog can no longer both grab the same result and report a false failure.**
- **Devices whose speed-test tool never finished downloading now repair themselves on update.**
- **A setup-time warning that could leave Tracked SIMs incomplete now repairs itself on update.**

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

Special thanks to **carp4** for the Traffic Engine port.

Bug reports and feature requests welcome on [GitHub Issues](https://github.com/dr-dolomite/QManager-RM520N/issues).

Like what's new? QManager is built and maintained for free — if these updates have made your setup a little better, you can show your support via [Wise](https://wise.com/pay/business/blackcatdev?currency=USD) or [PayPal](https://paypal.me/iamrusss). Every bit helps keep this project alive. [GitHub Sponsors](https://github.com/sponsors/dr-dolomite) works too.

**License:** MIT + Commons Clause — **Happy connecting!**
