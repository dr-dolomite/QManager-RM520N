# Colour System — roles, hue arithmetic, and the CVD floor

QManager's palette is a **role system**, not a swatch list: every colour in `app/globals.css` answers a question about *what a thing is*, and a surface picks a token by answering that question rather than by picking a colour it likes. `DESIGN.md` > Colors is the binding canon for what each role means and what its OKLCH values are. **This doc is the other half** — the measurements, the arithmetic, and the traps that explain *why* those values are what they are, and which of them must not be "tidied up" by a future pass.

Read this before adding a colour, retuning one, or looking at a token that seems out of line with its siblings. At least one of them is out of line on purpose.

> ℹ️ NOTE — jargon used throughout. **OKLCH** is a perceptual colour space: `oklch(L C H)` is lightness (0–1), chroma (saturation), hue angle (0–360°). Unlike hex or HSL, equal steps in L look like equal steps to the eye, which is what makes the measurements below meaningful. **CVD** is colour-vision deficiency; **deuteranopia** and **protanopia** are the two common red-green forms, together affecting roughly 1 in 12 men. **Container** vs **strong fill**: Material 3 pairs every role as a pale tinted surface (`--x-container`, for large blocks) and a saturated fill (`--x`, for small emphatic marks), each with its own guaranteed-legible ink.

## Quick Reference

| Thing | Where |
| ----- | ----- |
| Token definitions (both themes) | `app/globals.css` |
| Tailwind mappings | `@theme inline` block in the same file |
| Canon (meanings, values, rules) | `DESIGN.md` > Colors |
| Chip roles | `components/ui/badge.tsx` |
| Separation floor, decorative vs **functional** | **40 degrees** (one-directional — see below) |
| CVD collapse floor between two tones | **0.05** simulated separation |
| Signal-quality ramp (the one scale, not a role) | `--quality-{1..5}` / `--quality-{1..5}-bar`; mapped by `components/cellular/signal-quality-display.ts` |

## The role families

| Family | Tokens | Means | Axis |
| ------ | ------ | ----- | ---- |
| Primary / NR blue | `--primary-*`, aliased by `--info`, `--ring`, `--sidebar-primary`, `--chart-nr` | 5G NR **identity**, the brand, "in progress", info | Identity |
| Carrier Violet | `--lte-*`, `--chart-lte` | 4G LTE **identity** | Identity |
| **Downlink Rose** | `--downlink`, `-foreground`, `-on-surface`, `-container`, `--on-downlink-container` | The **download direction**, and **capacity / throughput** | Direction |
| **Uplink Cyan** | `--uplink`, `-foreground`, `-on-surface`, `-container`, `--on-uplink-container` | The **upload direction**, and **counts** | Direction |
| **Spatial Azure** | `--spatial`, `-foreground`, `-on-surface`, `-container`, `--on-spatial-container` | **Antenna and spatial-stream readouts** — MIMO layer counts, per-antenna chains | Spatial |
| Success / Warning / Destructive | `--success-*`, `--warning-*`, `--destructive-*` | Functional verdicts only | Status |
| Neutral ramp | `--surface-*`, `--on-surface*`, `--outline` | No claim at all | — |

Each family ships the same five-token shape: the **strong fill**, its `-foreground` ink, an `-on-surface` **tinted-ink** step for text on a plain card, the `-container`, and the container's `on-` ink. Take a **pair**, never a crossed one: `bg-downlink` goes with `text-downlink-foreground`, `bg-downlink-container` with `text-on-downlink-container`. A container fill under a strong fill's ink is the single most common way this system goes wrong.

## The Direction-Is-Not-A-Radio rule

**Short version: which way the bytes are going and which radio is carrying them are two independent facts, so they get two independent hue axes.** Before 2026-08-16 they shared one, and the damage only showed up across pages.

Download used to be `--primary` — which is simultaneously the 5G NR identity, the brand, and "in progress". Upload used to be `--lte`, the 4G LTE identity (except on the dashboard data-usage row, which had always used cyan). So a user learned *blue = download* on the speedtest dialog and met *blue = NR* two clicks later on the Radio Information page; and an LTE speedtest painted its upload figure in the LTE hue for reasons that had nothing to do with LTE.

Downlink Rose exists to break that overload. Both direction roles now hold hues that **cannot** be confused for a radio, which is what lets a rose download chip sit *inside* a violet LTE block and read as two independent facts rather than one muddled one.

### Where each direction hue lands

| Surface | Download / capacity | Upload / count |
| ------- | ------------------- | -------------- |
| Speedtest dialog `ROLE` map (`speedtest-dialog.tsx:143`) | `downlink-*` | `uplink-*` |
| Cached speedtest chips (`live-latency.tsx:888`) | `downlink-container` | `uplink-container` |
| Device Metrics data-usage glyphs (`device-metrics.tsx:424`) | `text-downlink-on-surface` | `text-uplink-on-surface` |
| AMBR rate chips (`settings/shapes.ts:1064`) | `bg-downlink` | `bg-uplink` |
| Radio Information summary tiles | Bandwidth → `downlink-container` | Carriers → `uplink-container` |
| Ethernet link speed tile (`ethernet-card.tsx:114`) | `downlink-container` | — |

Two consequences that are easy to get wrong:

- **Capacity takes rose, not cyan.** Aggregate channel width and a negotiated Ethernet link rate are *bidirectional* figures. Cyan would claim an upload direction they do not have; rose's second meaning is throughput, which is exactly the pipe. That is why the Ethernet speed tile moved off cyan.
- **A directionless figure takes neither.** Latency has no direction, so the speedtest's ping role went **neutral** rather than keeping a hue. Packet loss on the Live Latency chart went neutral for the same reason plus one more: painting it from the functional ramp would draw a healthy 0% line permanently red, and this product reports rather than alarms.

## Hue-slot arithmetic: why 341, and why there is no room for a fifth

The system enforces a **40-degree minimum separation** between a decorative role hue and a functional one. Taken slots:

| Hue | Role |
| --- | ---- |
| 27 | destructive |
| 72 | warning |
| 149 | success |
| 200 | uplink |
| 264 | primary / NR / info |
| 296 | lte |

Sweeping all 360 degrees against that set leaves **exactly one window** clearing the floor against *every* taken hue: **h ∈ [336, 347]**. Downlink Rose sits at **341**, the middle of it. Hue 341 was therefore not chosen by eye — it was the only wholly-unconstrained slot left.

### The amendment: the floor is one-directional (2026-08-16)

Adding **Spatial Azure at hue 232** for MIMO and per-antenna readouts forced the rule to be stated precisely, because 232 sits 32 degrees from Uplink Cyan (200) and 32 from the brand ramp (264) — inside the floor as previously written.

The resolution is not a carve-out, it is what the rule was always protecting against. **The failure mode is a decorative hue being mistaken for a functional one**, because that is a lie about the device: a tile that reads as `warning` when nothing is wrong. Two *decorative* hues sitting close is a legibility question, not an honesty one, and legibility has other channels — a glyph, a label, a lightness step. The system has always accepted exactly this: **NR 264 and LTE 296 are 32 degrees apart** and have been since the palette was written.

So the floor is measured **against functional hues** (149 / 72 / 27 plus the brand ramp) and decorative crowding is permitted. Spatial Azure's nearest functional hue is success at **83 degrees** — it is one of the *safest* hues in the palette by the measure that matters.

**The trap this exposes, and it is counter-intuitive.** The widest unused position on the whole circle is **hue ~110**, at 38.5 degrees from both warning (72) and success (149). It looks like the best remaining slot and it is the worst one available: a yellow-green sitting precisely where deuteranopia merges amber into green, i.e. maximally confusable with the two functional states it is nearest. Anyone hunting for "the biggest gap" will find 110 first. Do not take it.

### What a fifth role costs now

The circle is full in the sense that no wholly-unconstrained slot remains. A new role must therefore either accept decorative crowding — measuring **functional distance first, decorative second**, and stating both — or take a neutral, a lightness step, or a non-chromatic channel. It should also justify a *class* of readout rather than one surface: Spatial Azure was minted because MIMO layers, per-antenna chains and the alignment surfaces are a whole family with no axis, not because one tile looked plain.

The tightest remaining adjacency is rose vs destructive red, which was flagged as the riskiest pairing *before* it was measured and then cleared comfortably: **0.47 separation in dark, 0.25 in light**, against a 0.05 floor.

> ℹ️ NOTE — precedent. Uplink Cyan sits at 200 rather than the design bundle's literal 185 for exactly this reason: 185 was 36 degrees from success at 149. The rule has bitten once already.

## Dark-mode identity fills were toned down (2026-08-16)

The three identity fills sat at L 0.79–0.81 on an L 0.155 ground — **the brightest objects in the interface were the ones carrying the least information**. They now land at 0.72–0.74:

| Token | Was | Now |
| ----- | --- | --- |
| `--primary` | 0.79 | **0.72** |
| `--lte` | 0.80 | **0.73** |
| `--uplink` | 0.81 | **0.74** |

The aliases move in lockstep — `--info`, `--ring`, `--sidebar-primary`, `--sidebar-ring`, `--chart-nr`, `--chart-lte`. Retuning one without the others silently splits the brand.

Two measured facts behind those numbers:

- **Ink holds at 7.2–7.7:1** (was 9.1–9.2), comfortably past WCAG AA. The fills moved and their inks did not need to, because both stay on the same side of the light/dark flip — the Paired-Theme Rule is intact.
- **L 0.76 was deliberately skipped.** At 0.76 NR and LTE measure **0.047** separation under protanopia — just under the 0.05 collapse floor. At 0.72 / 0.73 they measure 0.094.

> ⚠️ Toning a token is not the strongest lever available. Moving a block from a **strong fill** to a **container** is worth roughly a 0.47 lightness drop in dark mode — an order of magnitude more than any token nudge. When a surface reads loud, check the role choice before reaching for the value. The Radio Information summary strip is the worked example ([radio-information.md](radio-information.md)).

## `--lte-container` light: a correctness fix, not a taste change

Light-mode `--lte-container` moved **L 0.90 → 0.855**.

At 0.90 it measured **0.007** separation from `--primary-container` (L 0.885) under protanopia simulation. In plain terms: **light-mode NR and LTE were the same object to a red-blind user** — the exact failure mode `DESIGN.md` bans the generic `--chart-1..5` ramp for. Dropping 0.045 takes the separation to **0.156**, and ink holds at 10.1:1.

This is why the change is filed as a correctness fix. Anyone reverting it on aesthetic grounds is reintroducing a defect, not a preference.

## The trap: never equalise `--primary-container` and `--lte-container` in dark

**Dark `--primary-container` sits at L 0.40 while its five sibling containers sit at 0.30–0.325. That looks exactly like a calibration defect. It is not, and closing the gap breaks the system.**

Why the gap has to be there: NR blue (264) and LTE violet (296) are **32 degrees apart**, which is *inside* this system's own 40-degree floor. They are the one pair that cannot be separated by hue, so **lightness is carrying the entire distinction**. Equalise them and the pair measures **0.049** — collapsed — against the shipped pair's **0.216**.

The gap is real and it has real costs, which are paid by *routing around it*, never by levelling it:

- On a dark tile, `primary-container` genuinely lifts about 2.06:1 off the page ground where its siblings sit at 1.49–1.53:1. Recent Activities uses that fact as an argument for keeping routine events on the neutral ramp — a routine handoff must not out-shout an outage ([recent-activities.md](recent-activities.md)).
- The Radio Information doc previously carried a "known token asymmetry" note proposing exactly this levelling in a future token pass. That note is **retracted**.

Before touching either token, re-run the CVD simulation on the pair. The asymmetry is load-bearing.

## The CVD floor, and what colour can actually do on a dark surface

**Short version: in dark mode, container tints are decoration. The glyph and the label are the information.**

Simulating deuteranopia and protanopia across this system's **container** tones in dark mode, nearly every pair collapses below the 0.05 separation floor — **including pairs that already ship**: success/warning, warning/destructive, and uplink against a plain `surface-container`. Light-mode containers are clean, and **strong fills separate cleanly in both themes**.

Three design consequences follow, and they are not optional:

1. **Every status chip carries an icon**, and two states in one slot never share a glyph. `success-container` and `warning-container` measure ~1.03:1 apart in ordinary vision *before* any simulation — the glyph is the only thing separating healthy from degraded.
2. **Every direction chip carries an arrow.** Same mechanism, same non-negotiability.
3. **Colour that must survive belongs on the small strong-filled element** — a 52px disc, a chip — not on the large tinted body. This is why the `/cellular/` summary tiles put the fill on the disc and leave the tile body neutral ([radio-information.md](radio-information.md)).
4. **Identity never renders as a container at all.** It renders as **ink** or as an **outline tag** (`components/ui/tag.tsx`, variants `nr` / `lte` / `spatial` / `neutral`, consuming `--tag-*-text` / `--tag-*-border`), or as a strong **fill** on a glyph disc. Those tag tokens shipped without consumers on 2026-08-16 and were wired up on 2026-08-17, when all 11 identity chip sites moved off `Badge`; `nr` / `lte` / `spatial` / `downlink` / `uplink` were then deleted from `badge.tsx`, so `BadgeVariant` is now status-only and the split is compiler-enforced.

A useful way to hold it: on a dark surface, a container tint groups things; a strong fill and a glyph distinguish them. Ask a tint to distinguish and it will fail for one reader in twelve.

## The signal-quality ramp

**Short version: this is the one scale in the system that deliberately breaks the 0.05 floor above, and it is only safe because colour is never the ramp's only channel. A bar carries the magnitude and `QUALITY_GLYPH` carries the stop.**

`--quality-1` … `--quality-5` (plus a `-bar` sibling for each) are a **five-stop continuous scale** for measured signal quality: RSRP, RSRQ, SINR, aim score. Every other colour in this document is a *category* — it answers "what kind of thing is this". The ramp is a **position on a scale**, and that difference drives everything below.

They shipped in `fefba29` with no consumer at all. As of **2026-08-17** ten surfaces read them, through the single canonical map in `components/cellular/signal-quality-display.ts`.

### Two channels, one step apart

| Token | Drawn as | Reached through |
| ----- | -------- | --------------- |
| `--quality-N` | The **numeral** ink | `qualityInkClass()` → `text-quality-N` |
| `--quality-N-bar` | The **bar** fill, one lightness step bolder | `qualityMeterTone()` → `MetricBar`'s `TONE_CLASS` |

The bar value is bolder because a 4px fill needs more weight than a text figure to read as the same colour. They are not interchangeable.

### It is a lightness staircase, not a hue wheel

This is the load-bearing fact. Under deuteranopia, hues 27 / 45 / 72 / 115 / 149 flatten onto a **single yellow axis** — the ramp cannot separate by hue *at all* for those readers. So each ramp is monotone in lightness (light 0.385 → 0.505 in 0.030 steps; dark 0.620 → 0.800 in 0.045 steps), and the staircase is what carries it.

**Adjacent stops sit deliberately below the 0.05 floor.** Every non-adjacent pair clears it (worst: 0.055 light, 0.077 dark). That is a designed trade, not an oversight — and the thing bought with it is resolution, five levels where the functional roles could only afford four.

**What each channel actually carries.** Bar **length** carries *magnitude within the scale*, not the stop boundary. `signalToProgress()` is a continuous map, so at any cut it draws both sides nearly the same (an RSRP of -80 dBm is 100% and -81 dBm is 98.3%), and that is honest: two readings 1 dB apart *are* nearly the same signal. What separates one **stop** from the next is `QUALITY_GLYPH`'s monotonic wedge ladder, which survives greyscale and every CVD type. Widening the map would not change this; it would reproduce the same near-identity at every cut while shortening every bar. Recorded 2026-08-23 after a review proposed exactly that widening.

> ⚠️ WARNING: the trade only pays if a **second channel is present**. Ramp ink on a numeral with no bar beside it is a **bug**, not a shortcut: it leaves colour as the only carrier, which for one reader in twelve is no carrier at all. Two independent guards exist in code: `qualityMeterTone()` returns `null` rather than a colour for `none`, and `MetricBar value={null}` draws the track with no fill element at all. A caller that `??`-es a fallback colour past either one re-creates the exact bug this migration removed, where an unread antenna painted green.

### Light-mode stops 1–3 are deep reds and browns, and that is a ceiling

4.5:1 against a near-white ground caps those hues at **L ≈ 0.50**, and the non-adjacent floor then forces the whole span downward from that cap. The result reads as maroon and umber rather than vivid red-orange. **Do not "fix" it by brightening** — the contrast requirement is what put it there. Dark mode is genuinely vivid (#ed4b43 → #42e071) because a dark ground has the headroom light does not. Verified on screen in both themes, 2026-08-17.

Where a numeral is large enough to fall under the 3:1 threshold instead of 4.5:1, use the `-bar` value as its ink.

### The ramp is a scale; chips are categories. They did not merge

`BadgeVariant` still carries only the five status roles. So `bad` and `poor` both key onto `destructive`, and their **glyphs** separate them (`signal_cellular_0_bar` vs `signal_cellular_1_bar`) — the same Every-Chip-Has-A-Glyph obligation the CVD floor imposes on every other chip above.

Giving chips a fifth failure step would mean minting a `--quality-N-container` / `--on-quality-N-container` pair for every stop, each needing its own contrast and CVD work against both grounds. That was deliberately not attempted. If a future pass wants it, it is a token-layer change with the arithmetic in this document, not a component tweak.

## Related docs

- [radio-information.md](radio-information.md) — the four summary tiles: the worked example of role choice beating token tuning, and of the tile bodies going neutral so colour survives only where it is true.
- [speedtest.md](speedtest.md) — the direction contract from tile to dialog to result.
- [dashboard-chart-cards.md](dashboard-chart-cards.md) — why the packet-loss series is neutral ink.
- [ethernet.md](ethernet.md) — capacity vs direction on the link-speed tile.
- [cellular-settings-family.md](cellular-settings-family.md) — the AMBR rate chips, and why direction chips sit *on* a radio container rather than borrowing from it.
- [icon-system.md](icon-system.md) — the identity outline `Tag` variants, and the glyph obligations that come with them.
- [recent-activities.md](recent-activities.md) — routing around the `primary-container` lightness outlier.
