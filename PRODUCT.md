# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Hobbyist power users and field technicians managing the Quectel RM520N-GL.** Technically literate without being developers: comfortable with APN, PCI, RSRP, EARFCN and band numbers, but not expected to read shell scripts or hand-write AT commands. The hobbyist is tuning a home cellular setup for speed and coverage; the field tech is deploying and maintaining modems on site.

Two session shapes share one UI:

- **The quick check.** A mid-day glance at signal, watchdog state, data usage, recent events. Seconds, not minutes. Often on a phone or tablet beside the modem.
- **The focused configuration.** Activating a SIM profile, locking a tower or band, tuning APN contexts, aligning an antenna. Minutes of deliberate work, usually at a desk.

## Product Purpose

QManager is the web GUI for the Quectel RM520N-GL cellular modem. It deploys onto the modem's own internal Linux system and is fully standalone — no host router, no external toolkit, no SimpleAdmin dependency. It replaces engineer-flavoured defaults (legacy toolkit admin panels, raw AT consoles, vendor utilities) with an interface that respects the user's intelligence without requiring modem-engineering background.

Success looks like:

- A first-time user reaches signal-and-network clarity within thirty seconds of loading the dashboard.
- A returning user activates a saved SIM profile, locks a tower, or reconfigures an APN in one focused session, with no terminal fallback.
- A power user can still see every underlying value — EARFCN, PCI, CFUN state, raw AT responses — without being confronted with all of it by default.
- The modem is never bricked, stranded, or silently reconfigured by the UI it serves.

## Positioning

**QManager runs on the modem it manages.** The app lives on the RM520N-GL's internal vanilla Linux system; there is no host, no companion cloud, and no second device in the path. Every competitor in this space is either a router-resident panel managing a modem over a wire, a desktop utility speaking AT over USB, or a vendor cloud. None of them can claim what follows from residency:

- The UI is reachable exactly as long as the connection it configures is up. A wrong click can sever the user's own session, so risk is a first-class design material rather than a warning string.
- Anything that reboots the modem kills any in-flight HTTP request, which is why reboots are deferred through a dialog plus a persistent banner rather than fired mid-request.
- There is no privileged out-of-band channel to fall back on. The product must never leave the device in a state only a serial console can recover.

## Operating Context

- **Delivery.** Next.js static export served by lighttpd, a CGI shell backend, and systemd services, installed onto the modem's persistent partitions.
- **Access.** Over the LAN from a phone, tablet or laptop; frequently the only interface to a device with no screen and no buttons.
- **Network reality.** Sessions happen on the very link being configured, sometimes a poor one. Flaky signal, mid-operation drops, and a four-second link loss during an APN attach cycle are normal operating conditions, not edge cases.
- **The device clock starts at 1970.** There is no battery-backed real-time clock; the clock steps roughly 24 seconds into boot, and only with a registered SIM. Anything time-scheduled inherits this.
- **No internet guarantee.** The modem may have no upstream connectivity while the UI is in use.

## Capabilities and Constraints

**Capabilities.** Signal and radio information, carrier aggregation, band and tower and frequency locking, cell scanning, antenna alignment and statistics, SIM profiles and connection scenarios, APN and WAN profile management, IMEI and network-priority settings, blocked-network (FPLMN) management, SMS centre and forwarding, data usage accounting, connection watchdog and quality monitoring, centralised alerts over SMS/email/Discord, ethernet and DNS configuration, scheduled operations, speed test, OTA self-update, and a web console.

**Constraints that bind design.**

- **BusyBox-era userland.** POSIX shell, an Entware `/opt`, a jq built without regex support, and a read-only root filesystem that must be remounted deliberately.
- **AT is the only transport, and it is serialised.** There is no resident URC listener, so the product cannot react to unsolicited modem events; every value is polled. The poller's real cadence is roughly 3.7–4.0 seconds.
- **No working cron.** Every scheduled operation is a runtime systemd timer, and each must survive the 1970 boot window.
- **Static export.** No server runtime, no server components, no API routes — the backend is CGI shell scripts.
- **Self-hosted assets only.** Fonts and icon fonts are subset at build time. An affordance that depends on a CDN is not an affordance.
- **Five shipped locales**: English, Simplified Chinese, Traditional Chinese, Italian, Indonesian. Every user-visible string is translated, so layouts must survive strings substantially longer than English.

**Terminology.** The product uses the user's real vocabulary — dBm, MHz, EARFCN, PCI, NR5G, LTE, SA/NSA, MIMO — rather than translating it into consumer euphemism.

## Brand Commitments

- **Name and voice.** QManager. Direct, specific, never apologetic. "Lock to cell 412" beats "Are you sure you want to proceed?". Real units, real values, real consequences in plain language. Calm by default; risk surfaces visibly.
- **Emotional goals, in order.** First **trust** — that the modem will still be up tomorrow morning and nothing happened behind the user's back. Then **competence, fast** — a new user should feel capable within a few clicks, not after reading docs.
- **The mark is binding.** The "Tonal Q" at `public/qmanager-mark.svg`: a ring plus a 45-degree tail anchored at dead centre, two tones of one blue, no gradient and no shadow. The tail starts at the centre because the signal originates at the device — the product idea, carried directly. New brand and UI surfaces derive from the mark rather than beside it.
- **Blue is the single overall hue**, and it is the mark's blue. It is simultaneously the brand, the action accent, and the identity of the 5G NR leg.
- **Radio identity colours are fixed**: blue for 5G NR, violet for 4G LTE. They say which radio, never whether anything is healthy.
- **The operational state colours are fixed**: green, amber, red.
- **Binding visual references, confirmed 2026-08-16**: **WiFiman (Ubiquiti)** and **Firewalla**, for their colour usage and data graphics specifically. Bolder chroma than a pastel tonal system. `DESIGN.md` owns how this is executed.
- **Confirmed direction decisions, 2026-08-16.** Colour lives primarily on **data-ink** — chart strokes, coloured numerals, quality bars, small discs — over neutral surfaces, rather than on large tonal container fills. Identity and metadata tags are **outline-and-tint**; the operational states remain **filled chips with an icon**. Measured signal quality gets a **continuous red-to-green quality ramp** as its own scale, distinct from the discrete states. Light and dark are both first-class and each is authored.
- **Preserved by explicit request**: the shipped dashboard's layout, composition and motion — including the circular treatment behind data entries — and the established look of the Cellular and Radio Information surfaces. These are ground truth for the rewrite, not candidates for replacement.
- **Anti-position.** QManager is not a consumer router app. Oversimplification, marketing-flavoured copy, cartoon icons, and wizards that block direct access are all rejected. Density is the point; the design organises it rather than hiding it.

## Evidence on Hand

- **A live RM520N-GL** is reachable over SSH for verifying platform claims directly. The device is the source of truth; documentation drifts.
- **The shipped product itself** — a large, coherent, working interface across roughly forty routes. Any claim about how QManager behaves is checkable against the code and the device.
- **The mark**, at `public/qmanager-mark.svg`.
- **The reference implementations** the user has confirmed they want preserved: the dashboard and the Cellular / Radio Information surfaces.
- **Measured colour data.** Contrast and colour-vision-deficiency separation for the token system have been computed rather than estimated, and more than one shipped value is a correctness fix rather than a taste change.
- **What does not exist and must not be invented**: customers, testimonials, benchmarks, install counts, pricing, or any commercial claim. QManager is MIT + Commons Clause, distributed through GitHub releases and an in-product OTA updater.

## Product Principles

1. **Data clarity first.** Metrics are scannable at a glance, with real units and sensible precision. Colour is part of the clarity budget, not an addition to it — colour that encodes nothing is spending contrast for nothing.
2. **Progressive disclosure.** Essentials surface immediately; advanced controls stay one click away. A field tech does not need to read the AT sequence behind a band lock to trust that the lock applied.
3. **Interfaces that never lie.** Every action shows loading, success, or error, and multi-step pipelines show per-step state. A status surface reports what is actually running, not the half-edited form. A control that cannot currently work explains why instead of sitting there dead. An ambient animation loops only where something is genuinely live.
4. **Consistent in shape, not just in parts.** Every feature page is a page header followed by a uniform grid of self-contained cards. A user who learns one page has learned them all. A bespoke layout invented for one screen is a consistency failure even when it looks good alone.
5. **Resilient by default.** Every data surface ships loading, empty, and error states. Never a blank panel. A flaky-signal session must never leave the UI indeterminate.
6. **Make the dangerous obvious, the safe effortless.** The routine ninety percent should feel instant. Anything that can disrupt the connection — reboot, profile activation, APN save, band or tower lock, IMEI write — wears its risk visibly and feels deliberate.

## Accessibility & Inclusion

- **WCAG 2.1 AA baseline.** All text and meaningful icons clear 4.5:1 in both themes; large text and UI boundaries clear 3:1.
- **Contrast is measured, not eyeballed.** Every role pairing is checked before merge, against the value the build actually ships rather than the value written in source — the CSS pipeline gamut-maps out-of-sRGB colours, so the declared value is not always the delivered one.
- **Colour is never the sole carrier of meaning.** Status indicators always pair their tone with a distinct icon, and no two states in one slot share a glyph. Directional readouts pair hue with an arrow. The signal quality ramp always pairs its colour with bar length, because a red-to-green ramp is the worst case for deuteranopia and the ramp is read by position as much as by hue.
- **Colour-vision-deficiency separation is a measured floor, not a guideline.** Deuteranopia and protanopia are simulated for any new pairing. Where a pair cannot clear the floor, the meaning moves to a non-chromatic carrier rather than the pair being shipped and hoped for.
- **Reduced motion respected.** `prefers-reduced-motion: reduce` removes movement and keeps opacity. The UI must remain fully usable, and feel intentional, with motion off.
- **Keyboard-first.** Every primary action is reachable without a mouse, focus rings are visible in both themes, and there are no keyboard traps in modals or the AT terminal.
- **Touch-usable in the field.** Dense data surfaces may pack information tightly, but the controls that act on them never shrink below a comfortable tap target.
- **Retired 2026-08-16, by user decision.** The previous "outdoor-readable / direct sunlight" extension and the light-mode ink rule that served it are no longer requirements. WCAG AA remains the floor; validation against a bright ambient assumption does not.
