# Product

## Register

product

## Users

**Hobbyist power users and field technicians managing the Quectel RM520N-GL.** Technically literate without being developers: comfortable with concepts like APN, PCI, RSRP, and bands, but not expected to read shell scripts or write AT commands by hand. The hobbyist is optimizing a home cellular setup for better speeds and coverage; the field tech is deploying and maintaining modems on site.

Two session shapes share the same UI:

- **The quick check.** Mid-day glance at signal, watchdog state, data usage, recent events. Seconds, not minutes. Often on a phone or tablet beside the modem. This is the session color serves most directly: health should be readable from the shape and fill of a block before any number is parsed.
- **The focused configuration.** Activating a custom SIM profile, locking to a tower or band, tuning APN contexts, aligning an antenna. Minutes of deliberate work, usually at a desk on a laptop, occasionally roadside on a tablet in direct sun.

QManager runs **on the modem it manages**: the app itself lives on the RM520N-GL's internal Linux system. A wrong click can sever the user's own connection. That single fact shapes every confirmation, every deferred reboot, every persistent banner in the product.

## Product Purpose

QManager is the modern web GUI for the Quectel RM520N-GL cellular modem. It deploys directly onto the modem's internal vanilla Linux system (Next.js static export served by lighttpd, CGI shell backend, systemd services) and is fully standalone: no host router, no external toolkit, no SimpleAdmin dependency. It replaces the engineer-flavored defaults (legacy toolkit admin panels, raw AT consoles, vendor utilities) with an interface that respects the user's intelligence without requiring modem-engineering background.

Success looks like:

- A first-time user reaches signal-and-network clarity within thirty seconds of loading the dashboard.
- A returning user activates a saved SIM profile, locks a tower, or reconfigures an APN in one focused session, with no terminal fallback required.
- A power user can still see every underlying value (EARFCN, PCI, CFUN state, raw AT responses) when they want to, without having to be confronted with all of it by default.
- The modem never gets bricked, stranded, or silently reconfigured by the UI it serves.

## Brand Personality

**Modern, Approachable, Smart.** A premium engineering tool that talks to you like a peer, not a novice and not a sysadmin.

- **Voice.** Direct, specific, never apologetic. "Lock to cell 412" beats "Are you sure you want to proceed?". Real units, real values, real consequences in plain language.
- **Tone.** Calm by default. Risk surfaces visibly, but the routine 90% feels quiet and confident.
- **Feel.** Expressive in transition, settled at rest. Motion is allowed to be *felt* — longer and more confident than a snappy corporate transition — but never allowed to wobble on a tool people use to keep a connection alive. Nothing springs, stretches, or rubber-bands. `DESIGN.md` owns the curves and durations.
- **The mark.** The identity asset is the "Tonal Q" at `public/qmanager-mark.svg`: a ring plus a 45-degree tail anchored at dead center, two tones of one blue, no gradient and no shadow. The tail starts at the center rather than outside the counter on purpose, and it carries the product idea directly — the signal originates at the device, and QManager runs on the device it manages. The mark is binding: new brand and UI surfaces derive from it rather than beside it.
- **Visual signature.** A tonal color system **derived from the mark**. The mark is two tones of one blue, so blue is simultaneously the brand, the only action accent, and the identity of the 5G NR leg. Around it sit two identity hues that never act (violet for the 4G LTE leg, cyan for counts and upload) and the four functional colors that only ever report state. Color arrives as large filled tonal containers carrying content, not as bright text sprinkled on white. Tokens, roles, and named rules live in `DESIGN.md`.
- **Emotional goals.** Two, in this order:
  1. **Trust** that the modem will still be up tomorrow morning, and that nothing the UI does behind the scenes will surprise them.
  2. **Competence**, fast. A new user should feel like they already know what they're doing within a few clicks, not after reading docs.

### Reference touchstones

**Primary references (heavy, load-bearing):**

- **Google's Material 3 / Material You era** (Pixel Settings, Google Home, Wallet, Fi): the dominant *aesthetic* reference. Three facets are adopted deliberately:
  1. **Tonal containers as the unit of color.** Content lives inside filled containers rather than beside colored text. This is the mechanism behind the "candy" feel, and it is what keeps a colorful interface legible: the fill carries the block, the ink on that fill carries the words.
  2. **Shape as hierarchy.** Radius scales with the size and importance of a surface, so a glance tells you what kind of thing you are looking at.
  3. **Grouped rows inside big boxes** (the Pixel Settings pattern) for glance surfaces, with the active nav pill sliding between rows rather than appearing.
- **Apple's professional UI/UX** (macOS System Settings, the Pro-app inspectors in Logic, Final Cut, Xcode): the dominant *structural* reference. Two facets:
  1. **The grouped-card, consistent-shape page.** Every feature page is a page header plus a uniform card layout, never a bespoke per-screen composition. You always know where you are because every page is built the same way.
  2. **Professional density without engineer-ugliness.** Apple's pro apps prove dense expert tooling can stay legible and refined. QManager is a dense modem GUI; the density is earned with hierarchy and grouping, not dumped on the page.

**Supporting references (one facet each):**

- **Ubiquiti UniFi** (Network Controller, UniFi OS, Protect): **data density only.** Its dense pill-and-tag tables and inline status tags are QManager's density heritage — cell scanner results, SMS inbox, log views. One deliberate divergence: QManager's status indicators are filled tonal chips, not UniFi-style outline-and-tint tags. UniFi is a density reference, not a layout or badge reference, and its varied-size hero-mosaic dashboard composition is explicitly not taken.
- **Linear**: voice and microcopy. Restraint, precision, expert-tool register in every confirmation, error, and label.
- **Vercel dashboard**: light-and-dark parity and OKLCH-era discipline. Parity is the part that carries: dark mode is genuinely colored, never a desaturated copy of light.
- **Grafana**: when data viz earns dense readouts. Informs the signal panel, latency monitor, signal-history chart, antenna alignment meter.
- **Raycast**: power-user UX without intimidation. Informs the AT terminal, command-palette interactions, instant feedback patterns.
- **QManager's own Watchdog and Alerts pages (Email / SMS)**: the in-family proof that live-service features share one consistent, learnable card shape, so learning one page teaches the other. Their honesty contracts are the product standard: status surfaces reflect saved state, incapable controls explain themselves, tests only run against saved config.

**Atmospheric hints:**

- **Nokia FastMile 5G Gateway 7 web interface**: borrowed for its friendly-but-technical balance and the soft treatment of signal surfaces, where a strong quality readout is genuinely the best affordance. Applied selectively on signal and antenna pages; recedes elsewhere.
- **Askey CPE Management Utility (iF Design Award winner)**: the proof a CPE interface can be design-award-worthy. Contributes editorial whitespace, a confident typographic hierarchy inside grouped cards, and the premium-consumer feel that softens density without diluting it. The aspirational standard: when in doubt, raise the craft.

### Page anatomy for live-service features (target shape, not yet built)

For features backed by a live service (Watchdog, Alerts, Discord bot), the intended arrangement of the same self-contained cards is a **status-first column**, ordered the way the user's questions arrive: a read-only live-status hero, then the settings card, then the activity log. New live-service pages should move toward it, not away from it. This is a product intent about anatomy, not a shipped pattern — no page implements it in full today.

## Anti-references

What QManager explicitly should not look or feel like:

- **Stock toolkit admin panels (SimpleAdmin-era pages, classic LuCI-style router UIs).** Bare tables, browser-default form widgets, dense data with no hierarchy, no progressive disclosure. The "engineer UI" QManager exists to replace.
- **Terminal and putty-style modem utilities (QNavigator, QCOM, raw AT consoles).** Monospace-everything, command-shaped, assumes you already know which AT command to send. QManager respects expertise without requiring it.
- **Consumer router and "smart home" apps (Netgear Nighthawk, TP-Link Tether, AT&T Smart Home Manager, Linksys Smart Wi-Fi).** Oversimplified, marketing-flavored, hides what power users need behind cartoon icons and gradient hero metrics. Wizards that block direct access. A colorful interface is not permission to become one of these: color organizes the density here, it never replaces it.
- **Generic AI/SaaS dashboard slop.** The hero-metric template (big number, small label, gradient accent), gradient text headlines, glassmorphism heroes. If the page could be reskinned for a CRM or a project tracker without changing anything, it has failed.
- **Hero-reliant, bespoke-per-screen composition.** A page built around one giant focal widget instead of the grouped-card layout every other feature page uses. It looks impressive in isolation and breaks the consistency that lets a user feel oriented everywhere. A hero is a rare, deliberate exception for a genuine glance surface, never the default.
- **Full-bleed feature layouts that use the page as the canvas.** A single feature that claims the whole viewport and scatters cards as loose visual fragments. The settings belong **inside** the card; the page only arranges the cards.
- **Decorative color.** A hue used because a surface looked empty. Every hue in the system owns a meaning: brand and action, LTE identity, counts and upload, or one of the four operational states.

## Design Principles

1. **Data clarity first.** Metrics are scannable at a glance. Real units, sensible precision, no decoration that hurts legibility. Color is part of the clarity budget, not an addition to it: a fill that does not encode something is spending contrast for nothing. The signal dashboard is the test case — someone glancing for half a second should know whether things are healthy.
2. **Progressive disclosure.** Essentials surface immediately, advanced controls stay one click away. A field tech does not need to read the AT command sequence behind a band lock to know the lock is applied.
3. **Confidence through feedback, and interfaces that never lie.** Every action shows loading, success, or error. Async pipelines — a SIM profile apply running APN, TTL, scenario, and IMEI in sequence; an APN save's full detach/attach cycle — show per-step state. The user is never left wondering "did that work?". State honesty extends to color and motion: a status surface reports what is actually running rather than the half-edited form, a released carrier stays visible and greyed rather than silently disappearing, a control that cannot currently work explains why instead of sitting there dead, and an ambient animation only loops where something is genuinely live. Trust is the first emotional goal, and it is built by never letting the UI claim something the device is not doing.
4. **Consistent in shape, not just in parts.** shadcn/ui components and design tokens are used uniformly, no one-off styles: a status chip looks the same on the cellular page as on the watchdog page. The same discipline governs **page structure** — every feature page is a page header followed by a uniform grid of self-contained cards, the way every macOS System Settings pane is the same shape. A user who learns one page has learned them all. A bespoke, hero-driven layout invented for a single screen is a consistency failure even when it looks good on its own. The unit of composition is the **card that wraps a settings group**, not the page.
5. **Responsive and resilient.** Graceful loading, empty, and error states everywhere. Never a blank panel. Field-tech sessions on flaky signal cannot be allowed to leave the UI in an indeterminate state.
6. **Make the dangerous obvious, the safe effortless.** QManager runs on the modem it manages. Routine reads and saves feel quiet. Anything that can disrupt the connection — reboot, SIM profile activation, APN save with its attach cycle, band or tower lock, IMEI write, IP passthrough change — wears its risk visibly: destructive fill, warning copy, explicit dialog, deferred reboot with a persistent banner. The routine 90% should feel instant. The risky 10% should feel deliberate.

## Accessibility & Inclusion

- **WCAG 2.1 AA baseline**, with one project-specific extension below.
- **Outdoor-readable contrast.** Field technicians use this in direct sunlight on tablets and phones. All text and meaningful icons hit 4.5:1 minimum in both light and dark themes, including dense cards where small labels are most at risk. Validate against a bright ambient assumption, not just dark-room AA. Two consequences of the tonal system are load-bearing here: light-mode ink stays dark rather than tinting toward its hue, and a container fill never carries meaning alone, so when the fill washes out under glare the text and the icon still read.
- **Contrast is measured, not eyeballed.** Every role pairing in `DESIGN.md` has been checked, and more than one shipped value is a correctness fix rather than a taste change. Any new pairing gets measured before merge.
- **Reduced motion respected.** `prefers-reduced-motion: reduce` removes movement and keeps opacity, through one global switch plus a media query on raw keyframes. The UI must remain perfectly usable, and feel intentional, with motion off.
- **Color is never the sole carrier of meaning.** Status chips always pair a semantic container with an icon. Any paired or directional readout (download vs. upload) pairs distinct hues with glyphs or arrows so the meaning survives color-blindness. Green and amber converge under deuteranopia, so those two states additionally differ in container lightness, not just hue. In the sidebar, the active nav item differs from inactive ones by icon fill weight as well as container tone, so the active state survives grayscale. Charts and signal-quality indicators must remain readable in deuteranopia and protanopia simulation; any palette addition is re-verified.
- **Keyboard-first.** Every primary action reachable without a mouse, focus rings visible against both themes, no keyboard traps in modals or the AT terminal.
- **Touch-usable in the field.** Interactive targets sized for gloved-adjacent tablet use; dense data surfaces may pack information tightly, but the controls that act on them never shrink below comfortable tap size.
- **No runtime asset fetches.** The app is served by the modem and may have no internet. Fonts and icon fonts are self-hosted and subset at build time; an accessibility affordance that depends on a CDN is not an affordance.
