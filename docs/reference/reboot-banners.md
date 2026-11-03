# Reboot and Reconnecting Banners

> **Applies to:** RM520N-GL (SDX65) and RG501Q-EU · frontend-only, device-independent · ported from RM551E v0.1.34 in the P0a parity pass (2026-10-31)

Two app-wide banners tell the user about the connection to the modem itself. The **reconnecting** banner shows while the session check cannot reach the modem, so a dropped link reads as "reconnecting" rather than as a sudden logout. The **pending-reboot** banner holds a reboot the user chose to defer: QManager runs on the modem it manages, so a change that needs a reboot never reboots inside the request that made it, and the reminder has to outlive the page that raised it. Both are mounted once in the app shell and are driven by small browser-storage flags with same-tab events, so any page can raise them without rendering its own copy.

## Quick Reference

| Item | Value |
| --- | --- |
| Mount point | `components/app-layout.tsx`, after the header, in the order `SimSwapBanner` → `ReconnectingBanner` → `PendingRebootBanner` |
| Reconnecting banner | `components/reboot/reconnecting-banner.tsx` |
| Reconnecting flag | `sessionStorage["qm_reconnecting"] = "1"` while reconnecting; the key is removed otherwise |
| Reconnecting event | `qmanager:connection-changed` (same tab) |
| Reconnecting API | `reportConnectionState(reconnecting: boolean)`, `useConnectionStatus()` in `lib/reboot/connection.ts` |
| Reconnecting writer | `useAutoLogout()` in `hooks/use-auto-logout.ts`, the only caller |
| Pending-reboot banner | `components/reboot/pending-reboot-banner.tsx` |
| Pending-reboot flag | `localStorage["qmanager_pending_reboot"] = '{"since":<ms epoch>,"source":"<RebootSource>"}'` |
| Pending-reboot events | `qmanager:pending-reboot-changed` (same tab) and the browser `storage` event (other tabs) |
| Pending-reboot API | `requestRebootLater(source)`, `clearPendingReboot()`, `readPendingReboot()`, `usePendingReboot()` from `lib/reboot` (`index.ts` re-exports `pending.ts`) |
| Reboot entry points | `rebootNow(source)` (POST then countdown) and `enterRebootFlow(source)` (countdown only) in `lib/reboot/index.ts` |
| Reboot endpoint | `POST /cgi-bin/quecmanager/system/reboot.sh`; an empty body or `{"action":"reboot"}` reboots, `{"action":"reconnect"}` runs `AT+COPS=2`, waits 2 s, then `AT+COPS=0` |
| Copy | `common.json` keys `connection.reconnecting` and `pending_reboot.*`, in all five catalogs |

## The reconnecting banner

`useAutoLogout()` is called by `AppLayout`, so it runs on every authenticated route. It polls `GET /cgi-bin/quecmanager/auth/check.sh` every 10 s through `startVisibleInterval()` and reports each result:

| Event | `reportConnectionState` | Other effect |
| --- | --- | --- |
| `check.sh` answers with any HTTP status | `false` | Offline clock reset. A 401 also makes `authFetch` clear `qm_logged_in` and redirect to `/login/` |
| The fetch throws (network error) | `true` on the **first** miss | Starts the offline clock |
| Still unreachable 90 s after the first miss | (stays `true`) | Clears `qm_logged_in`, redirects to `/login/?reason=offline` |
| Tab hidden | `false` | Polling stops and the offline clock resets; nobody was watching the gap |

The banner is a compact `warning-container` strip with `role="status"` and `aria-live="polite"`, a spinning lucide `Loader2` (`motion-safe:animate-spin`), and `animate-banner-in` on entry with no exit. It is not a `Banner`: it has no title, action or dismiss, because it clears itself the moment contact returns.

> ℹ️ NOTE: the banner warns on the **first** failed check, not the second. One missed check already spans up to 10 s, so waiting for a second would leave the user staring at a frozen page for 20 s.

> ⚠️ WARNING: only a thrown fetch counts as unreachable. A lighttpd 5xx or any other HTTP answer proves the modem is up and clears the banner. Keep it that way; the banner reports reachability, not CGI health.

> ℹ️ NOTE: RM551E's `evaluateConnection()` / `WARN_AT` / `FAILURE_THRESHOLD` (its 3 s poll) were not ported. RM520N's thresholds are the 10 s poll and the 90 s offline clock in `hooks/use-auto-logout.ts`; the offline redirect clears the flag first.

`sessionStorage` is per tab, so the flag never leaks into another tab, and the event has no cross-tab listener. A static-export prerender reads "not reconnecting".

## The pending-reboot banner

### The flag

`requestRebootLater(source)` (an alias of `setPendingReboot`, default source `"config_restore"`) writes the flag and dispatches `qmanager:pending-reboot-changed`. The `storage` event carries the change to other open tabs. `usePendingReboot()` subscribes to both through `useSyncExternalStore`, snapshotting the raw string so an unchanged store never yields a new object. A value that is not JSON, or has no numeric `since`, reads as no flag.

```json
{ "since": 1761868800000, "source": "imei" }
```

`RebootSource` is `"config_restore" | "imei" | "tailscale" | "mbn" | "manual" | "software_update" | "ip_passthrough"`. The banner has its own consequence line for `config_restore`, `imei` and `mbn` (`pending_reboot.description.<source>`); every other source reads `pending_reboot.description.default`.

### Who sets and clears it

| Action | Writer | Effect on the flag |
| --- | --- | --- |
| A page defers a reboot | `requestRebootLater(source)` | Set |
| **Reboot now** | `PendingRebootBanner` | Cleared **before** the POST, then `enterRebootFlow(source)` hands off to `/reboot/` |
| **Reboot now** fails (fetch throws or non-2xx) | `PendingRebootBanner` | Set again with the same source, `toast.error(t("pending_reboot.reboot_failed_toast"))` |
| **Dismiss**, then confirm | `PendingRebootBanner` | Cleared |
| A reboot by any other path (user menu, power cycle, watchdog, scheduled reboot) | nobody | **Unchanged** |

Three RM520N pages defer through `requestRebootLater`: IMEI (`imei-settings.tsx`, `"imei"`), MBN (`mbn-card.tsx`, `"mbn"`: any reboot-dialog close except **Reboot now**, and a save whose first write landed before the second failed) and Config Restore (`restore-backup-card.tsx`, `"config_restore"`). Their **Reboot now** awaits a reboot POST (the `reboot` action of `imei.sh` / `mbn.sh`, `reboot.sh` for Config Restore), then calls `enterRebootFlow`. Tailscale (`rebootNow("tailscale")`) and the user menu (`rebootNow("manual")`) reboot at once and never set the flag. IP Passthrough (`ip-passthrough-card.tsx`) calls `enterRebootFlow("ip_passthrough")` after its apply CGI's own reboot response, and never sets the flag. Only the four OTA hand-offs in `hooks/use-software-update.ts` still write `qm_rebooting` inline, on purpose (see `software-update.md`).

> ⚠️ WARNING: converting another page means: set the flag with its `RebootSource`, add a `pending_reboot.description.<source>` key to all five catalogs if the default line does not fit, and render nothing of your own.

> ⚠️ WARNING: a reboot that does not go through the banner never clears the flag, because it lives in the browser, not on the modem. That is why the banner keeps **Dismiss** (an accepted exception to the Dismiss-Only-Notices Rule, decided on RM551E as U4.11.2) and why Dismiss sits behind a confirm: dismissing a reboot that is still needed hides a true fact.

### The reboot hand-off

`enterRebootFlow(source)` waits `REBOOT_NAV_DELAY_MS` (2000 ms) so the POST reaches the device, then writes `sessionStorage["qm_rebooting"] = <source>`, clears the `qm_logged_in` cookie and navigates to `/reboot/`. The countdown (`components/reboot/reboot-countdown.tsx`) accepts any non-empty `qm_rebooting` value and removes it on mount; without one it redirects to `/login/` (RM520N keeps this; RM551E sends it to `/`, see `overview-splash.md`). `rebootNow(source)` fires the POST without waiting for its answer and then calls `enterRebootFlow`; the user menu's **Reboot Device** uses it with `"manual"`. The banner awaits the POST instead, so a failure can restore the flag.

## Not ported from RM551E

RM551E also runs `hooks/use-boot-pending-reboot.ts`, which polls `system/pending_reboot.sh` once per app load and raises the banner from flags the backend writes at boot. Both exist only for RM551E's Verizon profile revert (the CGI answers `{ "verizon": bool }`), which RM520N does not have, so neither was ported. Do not add a boot-time poll to RM520N unless a backend flag gains a real writer here.

The user menu's **Reconnect Modem** is a separate action: `hooks/use-modem-reconnect.ts` posts `{"action":"reconnect"}` to `reboot.sh` and does not touch either banner.

## Related docs

- [toast-confirmation.md](toast-confirmation.md): the navigation exception that lets the `/reboot/` hand-off stand in for a success toast
- [overview-splash.md](overview-splash.md): `/login/`, `check.sh` and the `qm_logged_in` cookie
- [icon-system.md](icon-system.md): why the banners carry lucide glyphs on Material routes
- `DESIGN.md` > Components > Banners: the visual contract
