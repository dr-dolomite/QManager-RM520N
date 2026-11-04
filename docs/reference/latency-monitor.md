# Latency Monitor Page

> **Applies to:** RM520N-GL (SDX65) · written 2026-10-11 from source; the data captures behind the design were taken on serial `61368cd2`
> **RG501Q-EU (SDX55):** unverified — see [`platform-matrix.md`](./platform-matrix.md)

`/monitoring/latency` shows how the cellular link is answering right now, how it has behaved over the last day, and how quickly a list of websites opens a connection. It is three cards under a plain page header: **Right now** (5fr) beside **History** (7fr), then a full-width **Sites** card. Each card reads a different data source at a different cadence, and every colour on the page is graded against the same two limits the user sets in Connection Quality. The page owns no backend of its own: Right now and History read the `qmanager_ping` / poller pipeline described in [connection-quality.md](connection-quality.md), and Sites reads the `qmanager_sites` daemon described in [sites-monitor.md](sites-monitor.md).

## Quick Reference

| Item | Value |
|------|-------|
| Route | `app/monitoring/latency/page.tsx` → `components/monitoring/latency-monitoring/latency-monitoring.tsx` |
| Page data hook | `use-latency-monitoring.ts` — `useModemStatus({ pollInterval: 5000 })` + `useLatencyHistory()` |
| Right now | `now-card.tsx` — `connectivity` from `GET /cgi-bin/quecmanager/at_cmd/fetch_data.sh` (`/tmp/qmanager_status.json`) every 5 s |
| History | `history-card.tsx` — `GET /cgi-bin/quecmanager/at_cmd/fetch_ping_history.sh` every 30 s (`/tmp/qmanager_ping_history.json`, `PING_HISTORY_MAX=8640` rows, RAM) |
| Sites | `sites-card.tsx` + `manage-sites-dialog.tsx` — `hooks/use-sites.ts` → `GET/POST /cgi-bin/quecmanager/monitoring/sites.sh` |
| Derivations | `derive.ts` — `resolveCuts` / `cutsFrom`, `latencyTone`, `lossTone`, `deriveHistory`, `siteAverage`, `normalizeHost`, `hostError`, `MAX_SITES` |
| Geometry and tone maps | `shapes.ts` — `PAIR`, `FIGURE_INK`, `ALERT_INK`, `SITE_INK`, `BAR_FILL`, `STATUS_VARIANT`, `SITES`, `DIALOG` |
| Brand marks | `site-mark.tsx` — `SITE_MARKS`, `markFor`, `SiteMark`, favicon fallback |
| Empty / error / off states | `condition-block.tsx` — `ConditionBlock` (`muted` or `destructive`) |
| Sites types | `types/sites.ts` — `SitesResponse`, `SiteEntry`, `SiteBucket`, `SitesConfig`, `SitesRange` |
| Limits | `connectivity.thresholds.latency_ms` / `.loss_pct`; fallback **250 ms / 30 %** |
| i18n | `dashboard` namespace, `latencyMonitor.*`, all five locales |

## Which source feeds which card

| Card | Source | Cadence | Reads |
|------|--------|---------|-------|
| Right now | `connectivity` (status poll) | 5 s | `latency_ms`, `avg_latency_ms`, `max_latency_ms`, `latency_history` (last 60 probes), `history_interval_sec`, `jitter_ms`, `packet_loss_pct`, `ping_target`, `last_family`, `status`, `thresholds` |
| History | `useLatencyHistory()` archive | 30 s | each row's `lat` only, plus `ts` |
| Sites | `useSites(range)` | Now: 2 s while visible and enabled; other ranges: 30 s idle, 3 s busy | `enabled`, `interval_sec`, `checked_at`, `checking`, `sites[].latest`, `sites[].series` |

- **History reads `lat`, never `max` or `avg`.** An archive row's `min` / `avg` / `max` are the poller's rolling statistics over its 60-probe window, so one spike repeats in every row archived while it stays in that window. Worst, Typical and the bucket averages are computed from the per-row `lat` instead; a `null` `lat` is a lost probe.
- **The strip has a hover readout** (`ProbeStrip` in `now-card.tsx`): the pointer's slot shows its RTT (or No reply) and its age, `(slots − 1 − i) × history_interval_sec`, as Now / N s ago / N min ago; the other bars dim to 40 %. It is pointer-only; the strip's `aria-label` carries the summary.
- **Right now's 60-probe strip is the live window, not the archive.** It is `connectivity.latency_history` padded on the left with empty slots until the ring fills. Its footer span is `60 × history_interval_sec` (5 s if absent), rounded to minutes.
- **Right now uses the archive in one place.** When `latency_ms` is `null`, the big figure reads "No reply" and the caption falls back to `lastAnswer()` — the newest archive row with a non-null `lat` — as "Last answer at HH:MM, N ms".
- **Unreachable** means `useModemStatus` returned an error or the last snapshot's `timestamp` is more than 60 s behind the browser clock (`UNREACHABLE_AGE_SEC`). It never reads `modem_reachable`: the poller sets that false after one failed AT read, and the ping data does not use the AT port. Right now then swaps its body for a destructive `ConditionBlock` with Try again and shows the Unknown chip; History and Sites keep their own states.

## Limits and tones

Every tone on the page reads `resolveCuts(connectivity)`: `connectivity.thresholds.latency_ms` and `.loss_pct`, falling back to 250 ms and 30 % when the poller predates `thresholds` or the status poll has not landed. There is no second set of numbers anywhere on the page; the earlier version graded loss against three fixed cuts that did not match the configured ones.

| Rule | Amber | Red |
|------|-------|-----|
| `latencyTone(ms)` | over the latency cut | over twice the cut |
| `lossTone(pct)` | any loss above 0 | at or over the loss cut |

- **A healthy figure is plain ink** (`FIGURE_INK.ok` = `text-on-surface`) on Right now. History's three figures are always plain ink; a figure past a cut gets an 18px `TriangleAlertIcon` before it, inked by `ALERT_INK` (amber or red) and labelled `latencyMonitor.history.attention`. Only a Sites value is green when healthy (`SITE_INK`), because there it reads as a per-site verdict against the limit.
- Sites compares a **TCP connect time** against the same latency cut as the ICMP probe. The cut is the user's one latency limit, not a site-specific number.
- Right now's RTT bar and the strip's bar heights scale to **twice** the latency cut, with a tick at the cut; strip bars are floored at 12 % so a fast probe stays visible, and a lost probe is a full-height red bar.
- The Limits row links to `/monitoring/connection-quality/`, where the cuts are set.

## History card

Ranges are `1h` / `6h` / `24h` (`HISTORY_RANGE` in `derive.ts`); the default is `1h`.

| Range | Span | Bucket |
|-------|------|--------|
| `1h` | 3600 s | 1 min |
| `6h` | 21600 s | 10 min |
| `24h` | 86400 s | 30 min |

- **Buckets are cut in local time** (`bucketStart`): every bucket size divides the hour, so a 10-minute bucket starts at :00, :10, …, in the browser's time zone. Axis ticks and tooltips print local `HH:MM`.
- **The window ends at the newest archive row, not the wall clock.** `deriveHistory` is a pure function of the data; an archive that stopped updating shows its last window rather than an empty one.
- **One line, one reference.** The chart draws the bucket average (mean of answered `lat`) and a dashed line at the latency cut. A bucket where every probe failed is a gap (`connectNulls={false}`), never 0 ms. Typical is the median probe RTT in the range, Worst the highest probe RTT, Loss the share of `null` rows.
- **Y-domain rule.** `domainMax = niceDomain(max(p95 of bucket averages × 1.25, cut × 1.2))`, with ticks at 0, half and the top. The limit line is therefore always on the plot, and a single spike no longer sets the scale (the old chart's axis was set by one 1,942 ms sample). An average above `domainMax` is drawn at the top (`plot`) with a caret, and the tooltip still shows the real value.
- **Error states.** A failed read with no rows is a destructive `ConditionBlock` with Try again; a failed read with rows already loaded keeps the chart and shows the "Not updating" notice above it.

### What was removed, and why not to restore it

- **No 12 h or Daily range.** With a 24 h history window those gave two points and one point.
- **No min–max spread band.** The archive's `min` / `max` are rolling-window values (see above), so a band built from them is wide for reasons unrelated to the bucket it is drawn on.
- **No Samples table.** Removed at the 2026-10-11 design review: the chart and its three figures carry the same information, and the user asked for less on this page, not more.
- **No separate Live chart or status band.** The live window is the Right now strip. The old status band read the live window while the cards below it read the selected range, so the two disagreed.

## Sites card

Ranges are `now` / `1h` / `24h` / `7d` (`SITES_RANGES`, typed by `SitesRange`; the CGI serves more); the default is **Now** (`latencyMonitor.range.now`). Now is the live view: its reads renew the daemon's live lease and return no history ([sites-monitor.md → Live mode](sites-monitor.md#live-mode)). The range pill is hidden while the monitor is off. There is no Check now button: a successful Manage save with the monitor on calls `checkNow()` without blocking the dialog, and only a failed check toasts (`check_failed`).

**The value under each logo** is chosen in this order:

| Condition | Shows |
|-----------|-------|
| `latest` is `null` | "Not checked yet" (quiet) |
| `latest.ok` is `false` | "No reply" (red), whatever the range average is |
| the figure is `null` | `—` |
| otherwise | the figure, toned by `latencyTone` |

The figure is `latest.ms` when the data on screen was read for Now, and `siteAverage(series)` on every other range, because a `range=now` response carries an empty `series`. "Read for Now" is `dataRange === "now"`, not the selected `range`: `dataRange` is the range the current `data` was fetched for, and it lags `range` until the new read lands. Keying on `range` would average a Now response's empty series to `—` for the moment between a switch to another range and its first read.

`siteAverage` is the mean of **answered** samples over the whole range: each bucket's `ms` is weighted by its `ok` count, and buckets with `ms: null` or `ok ≤ 0` are skipped. It is not a mean of bucket means.

**Polling (`hooks/use-sites.ts`).**

- **Now, monitor enabled:** every 2 s (`LIVE_POLL_MS`), only while `document.visibilityState` is `visible`. A hidden tab polls nothing; becoming visible fetches at once, then resumes the 2 s interval. Selecting Now in a hidden tab skips the initial read too, so no lease renews. Each read renews the lease, so this gate is what ends live mode on the device.
- **Now, monitor disabled** (`data.enabled === false`): falls back to the idle cadence. The CGI writes no lease while disabled, so 2 s reads would cost CGI and jq time for nothing.
- **Other ranges:** 30 s while idle; 3 s while the response says `checking: true` or a check is pending.
- A check stays pending until a response shows `checking: false` after either having seen `checking: true` or a `checked_at` different from the one before the click. A pending check the daemon never picks up stops counting after 90 s.
- Every fetch carries a sequence number and only the newest may land, so a slow `7d` read cannot overwrite a newer `1h` one after a range switch.

**Manage dialog (`manage-sites-dialog.tsx`).** On / Off, a sweep interval (60 s, 5 min, 15 min, 1 h, plus the saved value if it is none of those — shown as itself, never rounded), and the site list. Add normalises the input with `normalizeHost` (lower-case; strips scheme, credentials, path, query, port — **not** `www.`) and rejects it with `hostError`: `invalid` (the daemon's host check, mirrored), `duplicate`, or `full` at `MAX_SITES = 32`. The draft re-seeds from the last response on every open (`formKey`), so a cancelled edit never lingers.

> ⚠️ WARNING: the saved config is built by `configOf()`, which keeps only `kind: "site"` entries. The CGI's response can include a `kind: "gateway"` entry that is not part of the config; saving it back would add the gateway as a site. Any new save path (Turn on, the dialog) must go through `configOf`.

**States.** First load is a skeleton of `SITES.SKELETON_COUNT` (13, the default list length) cells. A failed first read is a destructive block with Try again; a later failure keeps the grid under the "Not updating" notice. Monitor off is a muted block whose **Turn on** saves the current config with `enabled: true`. An empty list is a muted block that opens Manage.

## Brand marks

`site-mark.tsx` holds **one** map, `SITE_MARKS`, from a registrable domain to a `react-icons/si` glyph and a colour.

- `markFor()` strips a leading `www.` and matches the exact domain or any subdomain of it; any `shopee.*` host gets the Shopee mark. Add a brand by adding one row, nowhere else.
- **Brand hex is allowed here.** A logo is content, like the RAT marks on the dashboard, so it keeps its brand colour; the label under it carries identity.
- **`null` colour means on-surface ink.** Use it for near-black brands (TikTok, X, GitHub) and for any brand colour that fails on either tile: Snapchat's yellow on the light tile, Dota 2's `#BF2E1A` on the dark one (2.88:1; 4.85:1 on light). Check a new hex on the tile in both themes before adding it.
- **Dota 2 needs its mapped mark.** `dota2.com` serves only a 16 px favicon, which the fallback below reads as "no icon", so `SiDota2` is mapped explicitly.
- **No mark, a favicon.** An unmapped host loads `https://www.google.com/s2/favicons?domain=<host>&sz=64` (`referrerPolicy="no-referrer"`), crossfading over its monogram once loaded. The browser's HTTP cache keeps it (the service sends `max-age` of 7 days); `faviconSeen` remembers the result for the session so a remount does not flash. The service has no CORS headers, so the image cannot be copied into storage.
- **Monogram fallback.** A load error (no internet) or an image 16px or smaller (the service's stand-in globe for an unknown domain) shows the first letter of the label (or host).

Both range pickers pass `glyph={() => null}` to `SegmentedField`: the active pill's fill marks it, with no check mark (user decision, 2026-10-12).

## Toasts

Each Sites mutation fires one sonner toast at the handler's end; the failure toast's description is the call's returned `error`. See [toast-confirmation.md](toast-confirmation.md).

| Action | Success key | Failure key |
|--------|-------------|-------------|
| Check after save | — (the save toast covers it) | `latencyMonitor.toast.check_failed` |
| Turn on (monitor-off block) | `latencyMonitor.toast.turn_on_ok` | `latencyMonitor.toast.turn_on_failed` |
| Save (Manage dialog) | `latencyMonitor.toast.save_ok` | `latencyMonitor.toast.save_failed` |

Polling, range switches and draft edits in the dialog never toast. The dialog's `SaveButton` keeps its own Saved flash, then the dialog closes.

## Related docs

- [connection-quality.md](connection-quality.md) — `qmanager_ping`, the `connectivity` block, `thresholds`, and the ping-history archive
- [sites-monitor.md](sites-monitor.md) — the `qmanager_sites` daemon and the `monitoring/sites.sh` contract
- [dashboard-chart-cards.md](dashboard-chart-cards.md) — the dashboard's Connection Quality card, which reads the same two sources
- [toast-confirmation.md](toast-confirmation.md) — the toast rules
