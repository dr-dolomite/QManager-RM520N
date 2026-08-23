# Overview Splash

> **Applies to:** RM520N-GL (SDX65) · verified 2026-08
> **RG501Q-EU (SDX55):** unverified — see [`platform-matrix.md`](./platform-matrix.md)

> The **Overview** splash is the public, unauthenticated landing page served at `/`. Instead of dropping an anonymous visitor straight onto a login form, QManager greets them with a live status card — device name, carrier, network type, aggregate bandwidth, per-band signal, and an Overall/Internet/Temperature verdict trio — all refreshed every 5 seconds *before* anyone logs in. A **Sign in** button takes them to `/login/`, and a deliberate logout now lands the user back here rather than on the bare login screen.

Short version: `/` used to render the login form directly. It now renders a client-side gate that decides between three outcomes — show the public splash, confirm an existing session and forward to the dashboard, or (on a fresh device) bounce to `/setup/`. The splash reads three brand-new **public CGI endpoints** that expose a deliberately narrow, allowlisted slice of the poller cache. Nothing sensitive (IMEI, ICCID, IMSI, phone number, WAN/LAN IPs) is ever in the anonymous payload.

This feature was ported from the sibling RM551E/OpenWRT project. The one RM551E affordance that was **dropped** is the "LuCI" button — the RM520N-GL runs vanilla Linux with no OpenWRT/LuCI web UI to link to.

---

## Quick Reference

| Item | Value |
|------|-------|
| Public route | `/` (`app/page.tsx`) |
| Login route | `/login/` (`app/login/page.tsx`) |
| Splash component | `components/public/overview-card.tsx` (the shell + `resolveBodyMode`) |
| Splash sub-components | `components/public/overview/{tone.ts,tiles.tsx,band-rows.tsx,states.tsx}` |
| Login component | `components/auth/login-component.tsx` |
| Shared in-card notice | `components/ui/tonal-banner.tsx` |
| Supporting components | `components/public/mode-toggle.tsx`, `components/auth/login-device-name.tsx`, `components/auth/login-language-picker.tsx` |
| Icon library on both routes | **Material Symbols** — the Icon-Boundary Rule covers `/` and `/login/` |
| Hooks | `hooks/use-public-overview.ts` (5s poll), `hooks/use-device-hostname.ts`, `hooks/use-public-unit-preferences.ts` |
| Types | `types/public-overview.ts`, `types/device-hostname.ts`; `SignalQuality` + `worstSignalQuality` in `types/modem-status.ts` |
| Presentation helpers | `lib/public-overview/format.ts` (`deriveConnectionLabel`), `lib/motion.ts` (`DUR`, `EASE_OUT_EXPO`) |
| Public CGI endpoints | `scripts/www/cgi-bin/quecmanager/public/{overview,hostname,units}.sh` |
| Install path on device | `/usrdata/qmanager/www/cgi-bin/quecmanager/public/` |
| Poller cache read by `overview.sh` | `/tmp/qmanager_status.json` (read-only; **zero** AT/`qcmd`/`flock`) |
| Indicator cookie | `qm_logged_in=1` (optimistic hint, not proof of session) |
| Session-authority endpoint | `GET /cgi-bin/quecmanager/auth/check.sh` → `{authenticated:bool}` |
| New CSS tokens | `-on-surface` OKLCH pairs (success/warning/info/destructive, light+dark) in `app/globals.css` |
| i18n namespace/keys | `common` → `overview.*`, `login.*` (bundled in all 5 languages) |
| Type scale | `DESIGN.md` > Typography > Hierarchy > **pre-auth card exception** — 19 / 17 / 15 / 13 / 11 px, mirrored in `.impeccable/design.json` as `pre-auth-card` |

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

> ⚠️ WARNING — `check.sh` now returns **additive rate-limit fields** on its unauthenticated branch (`rate_limited`, `retry_after`, `attempts_remaining`), which `/login/` uses to restore a lockout countdown across a page reload. Because `app/page.tsx` calls `check.sh` on **every** load of the public splash, that endpoint must call only the **read-only** limiter accessor `qm_get_rate_limit_status` — never the mutating `qm_check_rate_limit`, or refreshing this page would extend the visitor's own lockout. There is a regression test for it (`scripts/test/auth-lockout-ladder.sh`, section 8). See `docs/reference/auth-rate-limiting.md`.

> ℹ️ NOTE: A fresh-install device (no password set) is handled one layer deeper. The splash's own `overview.sh` returns `{state:"setup_required"}`, and `OverviewCard` redirects to `/setup/` when it sees that state. The `/` gate itself only distinguishes public/checking/redirecting.

---

## The OverviewCard UI

`components/public/overview-card.tsx` is the splash body. It is a single shadcn `Card` laid out as: header (logo + product title + device-name line + theme toggle), body (the live status), and footer (Sign-in button + copyright).

> ℹ️ NOTE — both pre-auth surfaces were **retargeted to the Material-3 tonal system** against the `Login and Overview.dc.html` comp. The structure below is unchanged; what changed is the visual vocabulary (tonal containers instead of washes, pill controls, role radii), the glyph library (Material Symbols), the motion (Motion Guide recipes), and the file layout. See *The retarget* below.

### File layout after the retarget

`overview-card.tsx` went from 841 to 557 lines and four sibling modules were extracted under `components/public/overview/`:

| File | Holds |
|------|-------|
| `tone.ts` | The whole tone vocabulary — `qualityValueClass()` / `qualityBarClass()` / `RAMP_BAR_CLASS`, `TILE_CLASSES`, `OVERALL_TILE` / `CONNECTION_TILE` / `TEMPERATURE_TILE` verdict maps, `temperatureBand`, `BAND_METRIC_THRESHOLDS`, `EYEBROW_CLASS`, `TILE_SHAPE`, `formatAge`, `isNrBand` |
| `tiles.tsx` | `TonalTile`, `StatusTile` — the status-trio cells |
| `band-rows.tsx` | `BandRow`, `AggregateBandRow`, `SegmentedMetricToggle`, plus the shared `BAND_ROW_SHAPE` / `ROW_GAP` / `ROW_STACK_GAP` geometry constants |
| `states.tsx` | `ReadingChip`, `SkeletonBody`, `UnreachableState` |

Total across the five files is roughly 1235 lines — **more** than before. The extraction was not a line-count exercise; the retarget genuinely adds surface (tonal maps, a segmented toggle, a real skeleton that mirrors the loaded geometry), and the split is what keeps the shell readable.

Every map in `tone.ts` is keyed on a **union type**, never on a raw class string, so a new state without a matching role fails the build rather than rendering untinted.

#### The quality half of that vocabulary is not declared here

`tone.ts` used to own a private `Tone` union with its own `qualityTone()` and `TONE_CLASSES` — one of five rival quality→colour maps in the tree. All three were **deleted**. The canonical map now lives in `components/cellular/signal-quality-display.ts`, and `tone.ts` keeps only two thin wrappers that fold in this surface's extra **`reachable`** axis before delegating:

| Export | Delegates to | Extra behaviour |
| ------ | ------------ | --------------- |
| `qualityValueClass(quality, reachable)` | `qualityInkClass()` | An unreachable modem returns `text-on-surface-variant`, never a ramp stop |
| `qualityBarClass(quality, reachable)` | `qualityMeterTone()` → `RAMP_BAR_CLASS` | Returns `null` — the empty-track signal — when unreachable, or when the tone is `null` |

The `reachable` axis is the point of the wrappers, and it is a real distinction: **an unreachable modem is not a bad reading, it is NO reading.** Painting it the bottom of the scale would tell a visitor their signal is terrible when in fact nothing was measured.

`RAMP_BAR_CLASS` is the one place the ramp's `bg-quality-N-bar` classes are restated outside `metric-bar.tsx`, because this surface's band meter is a hand-built 7px `motion.div` (first-paint-only `scaleX`, staggered 40ms), not a `MetricBar` — swapping it for one would change both its geometry and its entrance. The restatement is kept safe by keying on `MetricBarTone` rather than on `SignalQuality`: the *source* of the tone is still `qualityMeterTone()`, so a sixth ramp stop cannot be added on one side only.

> ⚠️ WARNING: `qualityBarClass()` returning `null` means **draw no fill element**, not "draw a zero-length one". A 0%-wide bar in the ramp's darkest ink beside a "−140 dBm" label reads as a fault the visitor should go and fix. A caller that `??`-es a fallback colour in re-creates exactly the bug this migration removed on `active-bands-card.tsx`, where `none` fell through to `success` and an unread antenna painted green.

`OVERALL_TILE` stays a `Record<SignalQuality, TileVerdict>` on the **container** axis, which is a different axis from the ramp: filled tonal tiles run on the functional roles, and those have no fifth failure step. So `bad` shares `destructive` with `poor` and is separated only by its glyph — `signal_cellular_0_bar`, the same glyph the canonical `QUALITY_GLYPH` gives it, so the tile and the band rows name the state the same way. `priority_high` stays `poor`'s alone.

### `resolveBodyMode()` — one decision, two consumers

The old `renderBody` carried a seven-branch `if` chain. The order was correct and load-bearing (re-ordering it changes what a flapping modem shows), so it was preserved verbatim but **extracted into a pure function returning a `BodyMode` union**:

```ts
type BodyMode =
  | "skeleton"           // 1. first paint, no data yet
  | "redirecting"        // 2. setup_required → /setup/
  | "empty_fetch"        // 3 & 4. fetch error, with or without prior data
  | "empty_unavailable"  // 5. the poller itself reports unavailable
  | "bare_skeleton"      // 6. no usable payload, but no error either
  | "live";              // 7. the real thing
```

The reason it had to move out of the render function is that the **footer caption must agree with the body about which state the card is in** — the footer suffix reads "updated 4 s ago" / "retrying every 8 s" / "signing in still works" depending on the mode. With the chain inlined in `renderBody`, the footer had to re-derive the same conditions independently, and the two could drift. Now there is one call site and both read `mode`.

`FAILURE_EMPTY_STATE_THRESHOLD = 3` is the consecutive-failure count that promotes a still-rendering stale card to the empty state.

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

**States the body can render:** loading skeleton (`SkeletonBody`, mirrors the final layout so there's no layout shift on data arrival — the title, CTA and footer caption are real text and are never skeletonised, because the card's identity is known before its reading is), `setup_required` (spinner while redirecting to `/setup/`), `unavailable` / repeated-fetch-failure (`UnreachableState`), and the live `ok` layout above.

While the first read is in flight a `ReadingChip` replaces the theme toggle at the same 36 px height, so the header does not reflow when it swaps back. Its spinner is the only loop permitted on this surface.

**Staleness** is now a `TonalBanner` (`tone="warning"`, `size="compact"`, `role="status"`) rather than the old chip — "Readings are 42s old. The device may be busy." The chip's key `overview.stale_indicator` is now unreferenced but was **left in place** so installed language packs that already translate it do not error.

**The modem-unreachable empty state is `warning`, not `destructive`**, and its footer says *"signing in still works"*. The distinction is the whole point of the state: the status feed is gone, the login is not, and a red card would tell a visitor the device is broken when it is merely quiet. `overview.empty.subtitle` was rewritten to name cause and recovery ("The modem has not reported in for a minute. It may be rebooting — the reading resumes on its own.") instead of the old "Log in for diagnostic details.", which offered a next step that does not help.

**Band chips carry IDENTITY, not quality.** Per DESIGN.md's Identity-Chip Rule the chip says which radio the row belongs to, while the meter and the value carry the **five-stop quality ramp**, which contains no identity hue at all. That is the point of the ramp here: these two channels used to run through a four-tone functional map whose healthy end resolved to `--primary` — i.e. to 5G NR's own identity colour — so an LTE-only visitor was shown "all good" in the 5G blue. As of 2026-08-17 it renders as an outline `Tag variant="nr" | "lte"` (`components/ui/tag.tsx`) rather than a hand-rolled container fill — identity never takes a large tinted block. `AggregateBandRow`'s summary pill became `<Tag variant="neutral">` in the same change.

> ⚠️ WARNING — the comp calls the LTE role `--sc` (secondary-container). **Do not use `secondary-container` here.** This repo ships Carrier Violet under the non-canon name `--lte-*` specifically to avoid colliding with the shadcn neutral secondary. See `DESIGN.md` > Colors > Secondary.

**Accessibility:** a single `sr-only` `aria-live` region announces only *verdict transitions* (a change in signal quality, connection state, or temperature band), gated by comparing the current verdict against the previous one — so the 5 s poll doesn't re-announce the whole status trio on every tick.

**Footer:** a full-width `Button asChild` wrapping `<Link href="/login/">` (the Sign-in CTA) and a copyright line. The RM551E "LuCI" button is gone.

### `LoginDeviceName` — "which modem am I signing into?"

`components/auth/login-device-name.tsx` renders a quiet muted-text line answering which device the visitor is about to log into. It owns its own hostname fetch (`useDeviceHostname`) and all three states (loading skeleton → resolved name → nothing). Its contract is **silent omission**: older firmware without the CGI, or an unnamed device, resolves to `null` and the line simply doesn't render — the title block closes up around it. Per DESIGN.md's Machine-Voice Rule the hostname renders in the UI sans typeface, not the mono machine voice (mono is scoped to the AT terminal). It is used by both the splash and the login screen.

---

## The `/login/` screen

`app/login/page.tsx` and `components/auth/login-component.tsx` were both rewritten in the same retarget, because the two surfaces are one experience: a visitor moves from `/` to `/login/` in a single click, and the 48 px pill CTA is the same role appearing on two consecutive screens. That is why the pre-auth type scale is defined once and applied to both (`DESIGN.md` > Typography > Hierarchy > pre-auth card exception; five steps 19 / 17 / 15 / 13 / 11 px — the comp draws the eyebrow at 10 px, but 11 px is the floor already set by the sidebar exception).

`app/login/page.tsx` now mounts `ModeToggle`, which the route had never carried. It sits beside `LoginLanguagePicker` at `icon-sm`, and both use `rounded-pill`.

The login form renders two `TonalBanner`s:

| Condition | Tone | Copy keys |
|-----------|------|-----------|
| Session ended (device was unreachable) | `destructive` | `login.session_expired_title` + `login.session_expired` |
| Rate limited | **`warning`** | `login.locked_title` + `login.locked_body` |

> ℹ️ NOTE — **the rate-limit banner is amber, not red, on purpose.** Being rate-limited is degraded-but-recoverable: the device is working, it is deliberately pausing you, and the pause ends by itself. Red would read as a fault. The copy names the *reason* ("Locked for 4:32 to protect the device.") rather than only the consequence, which is what turns a punishment into an explanation.

The countdown is formatted by `formatLockout()` — `28 s` under a minute, `4:32` above it — which is why the i18n template lost its baked-in unit. See `docs/reference/auth-rate-limiting.md` for the ladder, the response shapes, and the `attempts_remaining: 0` gotcha the form has to render around.

### `TonalBanner` — the card-scoped notice

`components/ui/tonal-banner.tsx` is a **new shared primitive**, and the sibling of `components/ui/banner.tsx` rather than a replacement for it. The two split on *where they mount*, and everything else follows:

| | `Banner` | `TonalBanner` |
|---|---|---|
| Mounts | Page level, any route | Inside a single card, pre-auth surfaces |
| Roles | Eight named system roles | Three tones: `warning`, `destructive`, `info` |
| Slots | CTA + dismiss | Neither |
| Disc | 36 px | 32 px |
| Glyphs | lucide (route-agnostic) | Material Symbols (`/` and `/login/` are Material end to end) |

```tsx
<TonalBanner tone="warning" icon="schedule" size="compact" role="status">
  …
</TonalBanner>
```

Props: `tone`, `icon: MaterialSymbolName`, `title?: ReactNode`, `children`, `size?: "default" | "compact"`, `role?: "alert" | "status"`, `className?`.

It exists because a page-level `Banner` dropped inside a 404 px login card is the wrong instrument — its CTA lane, dismiss lane and 300 px text basis all assume a full content column, and its role vocabulary (`sim-swap-matched`, `deferred-reboot`) describes conditions a signed-out visitor cannot act on.

What it **keeps** from the page-level primitive, because these are rules rather than geometry:

- **Solid-Container Rule** — `bg-{role}-container` + `text-on-{role}-container`, never a wash. The pattern it retires from `/login/` was `border-warning/30 bg-warning/10`; a 10 % alpha over a tinted surface is not a stable colour — it collapses in dark mode and washes out first in sunlight.
- **Glyph-Disc Rule** — the icon always sits in a filled circle on the role's *strong* fill. The disc is what survives when the container fill washes out; a bare icon on the container does not.
- **Info-Is-Brand** — the informational tone uses `primary-container`. There is no separate info hue.
- **Field radius** — 20 px (`rounded-field`): a banner must not out-round the surface it sits on. The comp draws 24/22 px, which is not a step on this repo's shape scale (12 / 20 / 28 / 36 / 40).

Motion is enter-only (`.animate-banner-in`, 400 ms emphasized, 6 px rise + fade, already reduced-motion-guarded in `globals.css`). A banner *leaving* means the condition cleared, and that should feel immediate.

### Motion on the pre-auth surfaces

| Recipe | Where |
|--------|-------|
| 01 — card entrance | `standard` easing, `y: 10`. Replaced `y: 12, ease: "easeOut"`, a token mixture the system does not produce |
| 02 — content cascade | 60 ms stagger, composed onto the same element as recipe 01 |
| 07 — meter growth | `scaleX`, **first paint only**: a `metersPainted` flag flips one frame after the first live render, so rows added mid-poll settle in without re-growing and the 5 s poll never replays the entrance |
| 15 — submit button | No width change across idle / submitting / locked states |

> ⚠️ WARNING — **there is deliberately no shake on a wrong password.** The Motion Guide prohibits rubber-band motion. The error is carried by ring colour, glyph, and copy. Do not add one back.

Two pre-existing motion bugs were fixed in passing: `SignalBar` in `overview-card.tsx` used `ease: [0.16, 1, 0.3, 1]` (easeOutExpo — not a system curve), and several retired `duration-200` values were moved onto the token scale.

### `hooks/use-auth.ts` changes

`useLogin()` now also returns `lockout: LockoutState`, seeded from `check.sh` so a page reload during a lockout restores the countdown instead of showing an enabled button that would just earn another 429. `LoginError`, `LoginResult` and `LockoutState` are exported. A pre-existing bug was fixed here — the old `error: data.detail || data.error` overwrote the machine sentinel with human text, making `rate_limited` indistinguishable from any other failure at the call site. Full detail in `docs/reference/auth-rate-limiting.md`.

### i18n

`common.json` is at 889/889 keys across all five locales, 0 warnings.

**8 new `login.*` keys:** `session_expired_title`, `locked_title`, `locked_body`, `invalid_password`, `attempts_left_one`, `attempts_left_other`, `password_to_manage`, `password_to_manage_bare`.

**7 new `overview.*` keys:** `stale.banner`, `footer.updated_ago`, `footer.retrying`, `footer.signin_works`, `loading_chip`, `bands.section_count_one`, `bands.section_count_other`.

Copy changes worth knowing about:

| Key | Change | Why |
|-----|--------|-----|
| `login.locked` | `"Locked ({{seconds}}s)"` → `"Locked ({{seconds}})"`, all 5 locales | The unit was baked into the template. Once the ladder reached 900 s the UI needed to render `4:32`, and `4:32s` is wrong. The formatter owns the unit now |
| `overview.actions.login` | "Sign in" → "Sign in to manage" | Names what the button gets you, not just where it goes |
| `overview.empty.subtitle` | Now states cause + recovery | The old "Log in for diagnostic details." offered a step that does not help |
| `overview.stale_indicator` | **Unreferenced**, kept in place | The `TonalBanner` replaced the chip; the key stays so installed language packs keep resolving |

#### `interpolation-slot.tsx` — styling one value inside a translated sentence

`components/auth/interpolation-slot.tsx` is a small new helper for the case where a *value* inside a translated sentence needs different treatment from the prose around it — mono digits in "Locked for 4:32", a bolder hostname in "Enter your password to manage sdxlemur."

i18next interpolation returns a flat string, so the value cannot be styled after the fact. The three ways out, and why this one:

| Approach | Why not |
|----------|---------|
| Split into two keys | Breaks in zh-CN / zh-TW / it, where the value does not sit at that position in the sentence. The translator loses word order — the one thing a translator must keep |
| `<Trans>` with markup | Puts `<0>` tags in the JSON. Translators must preserve markup they cannot see rendered, and a dropped tag is a runtime error rather than a typo |
| **Interpolate a sentinel** ✅ | ONE key, ordinary `{{value}}` syntax, translator keeps full control of word order, and the slice happens *after* i18next has done its job |

The sentinel exported as `SLOT` is **U+0000**. It cannot occur in real copy, no keyboard or CAT tool emits it, and — unlike a visible marker like `%%` or `{0}` — a translator will never "helpfully" correct it.

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

- Login lockout ladder, `check.sh`'s rate-limit fields, `useLogin().lockout` — `docs/reference/auth-rate-limiting.md`
- Glyphs on `/` and `/login/`, the extended Icon-Boundary Rule, the `/setup/` caveat — `docs/reference/icon-system.md`
- Auth model, session cookies, `cgi_base.sh` `require_auth` / `_SKIP_AUTH` — `docs/reference/qmanager-independence.md`
- Poller cache (`/tmp/qmanager_status.json`) field sourcing — `docs/BACKEND.md`, `docs/ARCHITECTURE.md`
- i18n bundle and `overview.*` keys — `docs/reference/i18n.md`
- Signal thresholds / `SignalQuality` / `worstSignalQuality` — `types/modem-status.ts`
- Platform docroot, lighttpd config, install layout — `docs/rm520n-gl-architecture.md`
