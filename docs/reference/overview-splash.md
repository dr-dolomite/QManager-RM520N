# Overview Splash

> The **Overview** splash is the public, unauthenticated landing page served at `/`. Instead of dropping an anonymous visitor straight onto a login form, QManager greets them with a live status card — device name, carrier, network type, aggregate bandwidth, per-band signal, and an Overall/Internet/Temperature verdict trio — all refreshed every 5 seconds *before* anyone logs in. A **Sign in** button takes them to `/login/`, and a deliberate logout now lands the user back here rather than on the bare login screen.

Short version: `/` used to render the login form directly. It now renders a client-side gate that decides between three outcomes — show the public splash, confirm an existing session and forward to the dashboard, or (on a fresh device) bounce to `/setup/`. The splash reads three brand-new **public CGI endpoints** that expose a deliberately narrow, allowlisted slice of the poller cache. Nothing sensitive (IMEI, ICCID, IMSI, phone number, WAN/LAN IPs) is ever in the anonymous payload.

This feature was ported from the sibling RM551E/OpenWRT project. The one RM551E affordance that was **dropped** is the "LuCI" button — the RM520N-GL runs vanilla Linux with no OpenWRT/LuCI web UI to link to.

---

## Quick Reference

| Item | Value |
|------|-------|
| Public route | `/` (`app/page.tsx`) |
| Splash component | `components/public/overview-card.tsx` |
| Supporting components | `components/public/mode-toggle.tsx`, `components/auth/login-device-name.tsx` |
| Hooks | `hooks/use-public-overview.ts` (5s poll), `hooks/use-device-hostname.ts`, `hooks/use-public-unit-preferences.ts` |
| Types | `types/public-overview.ts`, `types/device-hostname.ts`; `SignalQuality` + `worstSignalQuality` in `types/modem-status.ts` |
| Presentation helpers | `lib/public-overview/format.ts` (`deriveConnectionLabel`), `lib/motion.ts` (`DUR`, `EASE_OUT_EXPO`) |
| Public CGI endpoints | `scripts/www/cgi-bin/quecmanager/public/{overview,hostname,units}.sh` |
| Install path on device | `/usrdata/qmanager/www/cgi-bin/quecmanager/public/` |
| Poller cache read by `overview.sh` | `/tmp/qmanager_status.json` (read-only; **zero** AT/`qcmd`/`flock`) |
| Indicator cookie | `qm_logged_in=1` (optimistic hint, not proof of session) |
| Session-authority endpoint | `GET /cgi-bin/quecmanager/auth/check.sh` → `{authenticated:bool}` |
| New CSS tokens | `-on-surface` OKLCH pairs (success/warning/info/destructive, light+dark) in `app/globals.css` |
| i18n namespace/keys | `common` → `overview.*`, `login.signing_in_*` (already bundled in all 5 languages) |

> ℹ️ NOTE: Jargon glossary. **CGI** = a shell script lighttpd runs per HTTP request as `www-data`. **Poller** = the background daemon that queries the modem over AT and writes a JSON snapshot to `/tmp/qmanager_status.json`. **Allowlist projection** = the endpoint copies out only a named set of fields and drops everything else, so a new sensitive field in the cache can never leak by default. **RSRP / RSRQ / SINR** = the three cellular signal-quality metrics (received power, quality, and signal-to-noise). **NSA / SA** = 5G Non-Standalone (LTE anchor + NR) vs. Standalone (NR only).

---

## The `/` gate — three states, one rule

`app/page.tsx` is a `"use client"` component whose entire job is to decide what `/` renders. It never renders a login form itself; it either shows the splash or forwards elsewhere.

```
Gate = "public" | "checking" | "redirecting"
```

- **public** — render `<OverviewCard/>`. This is the default landing surface and the common case (any logged-out visitor, including right after logout).
- **checking** — an indicator cookie is present, so confirm the session before forwarding. Renders a blank background (never a flash of the splash).
- **redirecting** — the session was confirmed; `window.location.href = "/dashboard/"`.

### Why the gate exists — the stale-cookie / login-trap rationale

The `qm_logged_in=1` cookie is an **optimistic hint, not proof of a live session**. It's a plain, non-HttpOnly indicator the frontend sets so it can make fast client-side routing decisions without a round-trip. But it can linger after the real server-side session is gone:

- a foreign-domain leftover (browsing the modem IP directly vs. through the dev proxy),
- a cached / bfcache page restored by the browser,
- a deploy skew between the cookie and the current build.

If `/` trusted that cookie blindly, it would forward a logged-out visitor to `/dashboard/`, where the dashboard's auto-logout poller immediately kicks them to `/login/` — turning the public landing page into a **login trap** the user can't escape. So the gate only forwards to the dashboard after `auth/check.sh` **confirms** the session; on any other outcome it falls through to the public splash.

`auth/check.sh` is authoritative because it validates the **session file** (not the cookie): it reads the session token cookie and runs `qm_validate_session` server-side, answering `{authenticated:true|false}`. The gate treats every non-confirming result as "show the splash":

| `check.sh` result | Gate action |
|-------------------|-------------|
| `authenticated:true` | `redirecting` → `/dashboard/` |
| `authenticated:false` | `clearIndicatorCookie()`, then `public` (the cookie was stale) |
| non-2xx / network / parse error | `public`, **cookie kept** — could be a transient blip on a genuinely logged-in device; don't trap them, don't nuke the hint |

**Fast path:** if there's no indicator cookie at all, the gate initializes straight to `public` and skips the network round-trip entirely — no flash, no wait for the logged-out majority.

> ℹ️ NOTE: A fresh-install device (no password set) is handled one layer deeper. The splash's own `overview.sh` returns `{state:"setup_required"}`, and `OverviewCard` redirects to `/setup/` when it sees that state. The `/` gate itself only distinguishes public/checking/redirecting.

---

## The OverviewCard UI

`components/public/overview-card.tsx` is the splash body. It is a single shadcn `Card` laid out as: header (logo + product title + device-name line + theme toggle), body (the live status), and footer (Sign-in button + copyright).

**Header:**
- QManager logo (decorative, `alt=""`) + `CardTitle` (`overview.title`).
- `<LoginDeviceName/>` in the `CardDescription` slot — the device-identity line (see below).
- `<ModeToggle/>` (`components/public/mode-toggle.tsx`) in the `CardAction` slot. Per the No-Header-Icon contract, the theme switcher lives in the action slot, not beside the title.

**Body — three stacked zones (`renderBody`):**

1. **Header trio** — Carrier · Network · Bandwidth. The third cell shows *aggregate* channel bandwidth summed across carrier components (e.g. "95 MHz"); the joined band list ("B1, N41") survives as that cell's hover tooltip. (The i18n key is still `overview.header.bands` — kept, not renamed to `.bandwidth`, so installed language packs that mirror the id keep their translation.)
2. **Signal section** — one dense row per aggregated carrier: band label · fill bar · signal value. A small **RSRP ↔ SINR** segmented toggle (`MetricToggle`) in the section header flips every band row (and its threshold tinting) between the two metrics. RSRQ is intentionally *not* a per-band view — it still feeds the Overall verdict but keeps the toggle binary. When no carrier components are reported (e.g. attach in progress), the section falls back to a single aggregate `SignalBar` for the selected metric rather than dropping it.
3. **Status trio** — Overall · Internet · Temperature.
   - **Overall** = the *worst* of RSRP/RSRQ/SINR (`worstSignalQuality`). RSRP alone would mask a strong-signal / poor-SINR scene (an interference-bound link).
   - **Internet** = a single connection label reduced from the LTE and NR states by `deriveConnectionLabel` (priority: connected > searching > limited > inactive > error > disconnected > unknown). When the modem is unreachable it reads `modem_unreachable`.
   - **Temperature** = the SoC temperature, formatted in the visitor's preferred unit, with a tinted `TriangleAlertIcon` at ≥60 °C (warn) / ≥75 °C (danger). The digits stay neutral; the icon carries the state, so the meaning survives for colour-blind users (WCAG 1.4.1).

**States the body can render:** loading skeleton (mirrors the final layout so there's no layout shift on data arrival), `setup_required` (spinner while redirecting to `/setup/`), `unavailable` / repeated-fetch-failure EmptyState (amber warning, not destructive — this surface is degraded/recoverable, with a Retry button), and the live `ok` layout above. A **stale** badge appears above the header trio when the cache timestamp is older than 15 s.

**Accessibility:** a single `sr-only` `aria-live` region announces only *verdict transitions* (a change in signal quality, connection state, or temperature band), gated by comparing the current verdict against the previous one — so the 5 s poll doesn't re-announce the whole status trio on every tick.

**Footer:** a full-width `Button asChild` wrapping `<Link href="/login/">` (the Sign-in CTA) and a copyright line. The RM551E "LuCI" button is gone.

### `LoginDeviceName` — "which modem am I signing into?"

`components/auth/login-device-name.tsx` renders a quiet muted-text line answering which device the visitor is about to log into. It owns its own hostname fetch (`useDeviceHostname`) and all three states (loading skeleton → resolved name → nothing). Its contract is **silent omission**: older firmware without the CGI, or an unnamed device, resolves to `null` and the line simply doesn't render — the title block closes up around it. Per DESIGN.md's Machine-Voice Rule the hostname renders in the UI sans typeface, not the mono machine voice (mono is scoped to the AT terminal). It is used by both the splash and the login screen.

---

## The three public CGI endpoints

All three live in a new directory, `scripts/www/cgi-bin/quecmanager/public/`, deployed to `/usrdata/qmanager/www/cgi-bin/quecmanager/public/`. Each sets `_SKIP_AUTH=1` **before** sourcing `cgi_base.sh`, each is **GET-only** (guarded by `cgi_method_not_allowed`), and each is strictly read-only.

> ℹ️ NOTE — the auth model is opt-out. lighttpd has no path-based auth gate; `cgi_base.sh` runs `require_auth` on every request *unless* `_SKIP_AUTH=1` is set before it's sourced. So making an endpoint public is a deliberate one-line act, and these three are the entire unauthenticated modem-status attack surface. Treat any new field added to them as a security change.

### `overview.sh` — the allowlisted status projection

`GET /cgi-bin/quecmanager/public/overview.sh` is a **pure cache read** of `/tmp/qmanager_status.json` — **zero** AT commands, `qcmd`, or `flock`. It projects a fixed, field-by-field jq allowlist and nothing else.

The "project, don't fetch" security model is the whole point: rather than re-query the modem (which would risk exposing whatever the query returns), the endpoint copies out only named fields from a snapshot the authenticated poller already produced. A field that isn't in the jq template cannot appear in the response, so IMEI, ICCID, IMSI, phone number, boot identifiers, and WAN/LAN IPs are structurally excluded — you'd have to edit the allowlist to leak them.

Live `ok` response shape (mirrored 1:1 by `PublicOverviewOk` in `types/public-overview.ts`):

```json
{
  "state": "ok",
  "timestamp": 1721390000,
  "modem_reachable": true,
  "uptime_seconds": 84213,
  "network": {
    "type": "5G-NSA",
    "service_status": "registered",
    "carrier": "Example Mobile",
    "bands": [
      { "band": "B1", "bandwidth_mhz": 20, "pci": 431, "rsrp": -92, "rsrq": -11, "sinr": 14 },
      { "band": "N41", "bandwidth_mhz": 75, "pci": 512, "rsrp": -88, "rsrq": -10, "sinr": 18 }
    ],
    "lte_state": "connected",
    "nr_state": "connected"
  },
  "signal": { "rsrp": -92, "rsrq": -11, "sinr": 14 },
  "temperature": 48
}
```

Field notes:

| Field | Source in cache | Notes |
|-------|-----------------|-------|
| `timestamp` | `.timestamp` | Cache write time; the hook flags data older than 15 s as stale |
| `modem_reachable` | `.modem_reachable` | Drives the "modem unreachable" verdict |
| `uptime_seconds` | `.device.uptime_seconds // 0` | Present in the contract; not currently surfaced in the card |
| `network.bands[]` | `.network.carrier_components[]` | Only components with a non-empty `band` are kept; each carries its own `bandwidth_mhz`/`pci`/`rsrp`/`rsrq`/`sinr` |
| `signal.{rsrp,rsrq,sinr}` | `.lte.*` else `.nr.*` | LTE value preferred, NR fallback, else `null` — a single aggregate figure |
| `temperature` | `.device.temperature // null` | SoC temperature in °C |

Non-`ok` states:

| Condition | Response |
|-----------|----------|
| No password set yet (`is_setup_required`) | `{ "state": "setup_required" }` |
| Cache file missing or empty (boot / poller crash) | `{ "state": "unavailable", "reason": "poller_not_started" }` |
| jq parse failure on the cache | `{ "state": "unavailable", "reason": "parse_error" }` |

### `hostname.sh` — device identity

`GET /cgi-bin/quecmanager/public/hostname.sh` → `{ "hostname": "<string>" }`. It reads `/proc/sys/kernel/hostname` (the canonical hostname on vanilla Linux), strips CR/LF, and clamps to 63 chars (RFC-1123). It always answers HTTP 200; an **empty string** is the explicit "no name set" signal that drives the frontend's silent-omission state.

> ⚠️ WARNING — this is the **kernel** hostname, which can diverge from the human-readable name. On the RM520N-GL the kernel hostname is typically `sdxlemur` (the SoC name), whereas `qmanager.conf`'s `settings.hostname` may hold a friendly name the user set (e.g. `"Russ"`). They are **different values by design** — the splash shows the kernel hostname. The RM551E port read this from OpenWRT's `uci`, which has no analog here; that source was dropped in favour of `/proc`.

### `units.sh` — unit preferences

`GET /cgi-bin/quecmanager/public/units.sh` → `{ "settings": { "temp_unit": "celsius|fahrenheit", "distance_unit": "km|miles" } }`. It reads only those two non-sensitive keys from `/etc/qmanager/qmanager.conf` via `qm_config_get`, mirroring the read path of `system/settings.sh` exactly (same helper, same keys, same defaults). This lets the splash format temperature in the visitor's preferred unit before login.

> ⚠️ WARNING — this endpoint deliberately does **not** call `qm_config_init`. `qm_config_init` *writes* a default config file when one is missing, and an unauthenticated GET must perform **zero file writes** (a hard constraint). `qm_config_get` already degrades gracefully to the supplied default when the file is absent, so a plain read is sufficient. Do not "helpfully" add an init call here.

### Security posture, verified on-device

All three were confirmed GET-only, read-only, and free of secret leakage against the live modem. Because the installer's `install_tree()` wholesale-copies the CGI directory, the new `public/` folder ships with **no installer, sudoers, systemd, or OTA changes** — there is nothing to register.

> ℹ️ NOTE — the CGI docroot is `/usrdata/qmanager/www/cgi-bin/quecmanager/` (per `WWW_ROOT` / `CGI_DIR` in `scripts/install_rm520n.sh` and `server.document-root` in `scripts/usrdata/qmanager/lighttpd.conf`), **not** `/opt/share/www`. If you see the latter in any older note, it's wrong for this platform.

---

## The `credentials:"omit"` hook rationale

All three splash hooks (`use-public-overview`, `use-device-hostname`, `use-public-unit-preferences`) use a **plain `fetch` with `credentials:"omit"`** — deliberately, **not** the app's `authFetch`.

The reason is subtle but important. `authFetch` has a 401 handler that hard-redirects to `/login/` whenever the server says "unauthenticated." A logged-out visitor on the public splash *is* unauthenticated by definition — so if the splash used `authFetch`, its very first fetch would bounce the user straight off the public page to the login form, defeating the entire feature. Using a plain `fetch` that never throws-to-redirect keeps the public surface reachable. `credentials:"omit"` additionally ensures the pre-auth page never sends a session cookie it doesn't need.

The public-overview hook adds production-grade resilience on top:

- **5 s poll** (`POLL_INTERVAL`), because a passerby doesn't need the dashboard's 0.5 Hz cadence.
- **Exponential backoff** once `consecutiveFailures` crosses `BACKOFF_THRESHOLD` (6), capped at 60 s — a down device doesn't get hammered.
- **Stale detection** at 15 s cache age → a stale chip, without blanking the last-good numbers.
- **Failure → EmptyState** after 3 consecutive misses, so the user gets an obvious Retry instead of staring at indefinitely stale data.
- **Tab-visibility pause** (stops polling when the tab is hidden; refreshes on return) and **AbortController** cancellation so a slow response can't clobber newer state.

`use-device-hostname` and `use-public-unit-preferences` are single-shot (no poll) and both resolve to `null` on *any* failure — the consumers hide the device pill / fall back to default units. Neither ever throws or redirects.

---

## Logout wiring — which redirects moved, which stayed

The point of the splash is that a **deliberate** logout lands you on it. In `hooks/use-auth.ts`, `logout()` now redirects to `/` (was `/login/`). Everything else that needs to *show a login form* was deliberately **left at `/login/`**:

| Flow | Redirect target | Why |
|------|-----------------|-----|
| Deliberate `logout()` | `/` (the splash) | The user chose to leave; greet them with the public overview |
| `changePassword()` success | `/login/` | Password just changed — the user must re-authenticate on a form |
| Session-expiry / auto-logout / auth-guard bounces | `/login/` | These are *involuntary* — the user needs a login form, not a marketing splash |
| `reboot-countdown.tsx` post-reboot | `/login/` | After a reboot the intent is to return to a login form; the direct-access guard was repointed `/` → `/login/` to preserve that |

> ⚠️ WARNING: keep this distinction when touching auth redirects. **Voluntary exit → `/` (splash). Involuntary/credential-change exit → `/login/` (form).** Collapsing them would either strand a re-authenticating user on a form-less splash, or greet an intentional logout with a bare login box.

---

## CSS tokens added

`app/globals.css` gained `-on-surface` OKLCH token pairs for `success`, `warning`, `info`, and `destructive`, in both light and dark mode, plus their `@theme` mappings (`text-success-on-surface`, etc.). These are darker-in-light / lighter-in-dark variants of the functional colors, tuned so functional-color **text** clears WCAG AA 4.5:1 against the card surface in both themes — the base fill tokens stay tuned for the 3:1 non-text threshold. The status trio and per-band value text consume the `-on-surface` variants; the signal fill bars consume the base fills.

---

## Related docs

- Auth model, session cookies, `cgi_base.sh` `require_auth` / `_SKIP_AUTH` — `docs/reference/qmanager-independence.md`
- Poller cache (`/tmp/qmanager_status.json`) field sourcing — `docs/BACKEND.md`, `docs/ARCHITECTURE.md`
- i18n bundle and `overview.*` keys — `docs/reference/i18n.md`
- Signal thresholds / `SignalQuality` / `worstSignalQuality` — `types/modem-status.ts`
- Platform docroot, lighttpd config, install layout — `docs/rm520n-gl-architecture.md`
