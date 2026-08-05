# Band Locking (`/cellular/cell-locking`)

**Band Locking is the page where a user narrows what their radio is allowed to use — and it is one of the few surfaces in QManager where a wrong click can take the connection away while you are standing on it.** Locking a band writes `AT+QNWPREFCFG="lte_band",…` (or the NSA / SA equivalent) to the modem; if the bands you picked are not actually serving your location, the modem has nowhere to camp and the link drops. That single risk shapes everything below: the two-axis band chip that shows you a pending change *before* you write it, the deliberately un-gated "Restore all supported" recovery action, and the failover watcher that reverts your lock automatically when no carrier appears.

The 2026-08 redesign is **frontend-only**. `hooks/use-band-locking.ts`, `types/band-locking.ts` and all four CGI scripts under `scripts/www/cgi-bin/quecmanager/bands/` are untouched. What changed is the shape of the page (a read-only hero over three peer control cards, replacing a four-way grid that treated a status panel and three control surfaces as peers), the control itself (a two-axis chip replacing a checkbox), and the copy (2 i18n keys → 54, in all five locales).

This doc records the invariants that a future contributor will otherwise "clean up": why the live ring is a shadow and not a border, why `unlockAll` is a write, why one render-phase state sync must never become an effect, why the busy flag blocks all three categories, and why a string-surgery toast was a translation bug waiting to fire.

## Quick Reference

| Thing | Where |
| ----- | ----- |
| Route | `/cellular/cell-locking` (`app/cellular/cell-locking/page.tsx`) |
| Page coordinator | `components/cellular/band-locking/band-locking.tsx` |
| Geometry + tone contract | `components/cellular/band-locking/shapes.ts` |
| Read-only hero | `components/cellular/band-locking/live-band-hero.tsx` |
| One category card (×3) | `components/cellular/band-locking/band-grid-card.tsx` |
| Shared `/cellular/` page header | `components/cellular/page-header.tsx` |
| Data + actions hook | `hooks/use-band-locking.ts` |
| Types + band-string helpers | `types/band-locking.ts` |
| Read current config | `GET /cgi-bin/quecmanager/bands/current.sh` |
| Apply a lock | `POST /cgi-bin/quecmanager/bands/lock.sh` |
| Failover toggle / poll | `POST …/failover_toggle.sh`, `GET …/failover_status.sh` |
| Failover watcher | `scripts/usr/bin/qmanager_band_failover` |
| Supported bands + on-air bands | `hooks/use-modem-status.ts` (`device.supported_*_bands`, `network.carrier_components`) |
| i18n | `band_locking.*` in `public/locales/{en,zh-CN,zh-TW,it,id}/cellular.json` (**54 keys per locale**, key paths verified identical across all five) |

> ℹ️ NOTE: `band-settings.tsx` and `band-cards.tsx` are **deleted**, not renamed. `live-band-hero.tsx` and `band-grid-card.tsx` are their replacements, and neither is a port — the hero dropped two of its four rows and the card replaced its control.

## Component tree

```
BandLockingComponent                      ← owns every hook; no child talks to CGI
├── CellularPageHeader                     (shared, components/cellular/page-header.tsx)
├── ProfileOverrideAlert | Banner          (the two gates, one primitive)
└── motion cascade
    ├── LiveBandHero                       ← read-only: posture, failover, on-air bands
    └── grid (1 col → 2 at @3xl/main)
        ├── BandGridCard  category="lte"
        ├── BandGridCard  category="nsa_nr5g"
        └── BandGridCard  category="sa_nr5g"
```

The coordinator is the only component that calls a hook. It reads `useModemStatus`, `useBandLocking`, `useConnectionScenarios` and `useSimProfiles`, and hands everything down as props. There are three band categories because there are three AT parameters — `lte_band`, `nsa_nr5g_band`, `nr5g_band` — and `lock.sh` maps `BandCategory` onto them one-to-one.

## The two-axis band chip

**Short version: a band has two independent facts about it, and the old checkbox could only carry one.** The two facts are:

- **SELECTED** — what you have picked and have not applied yet. Purely local React state.
- **LIVE** — what is actually configured on the modem right now, read back from `AT+QNWPREFCFG="ue_capability_band"` by `current.sh`.

A checkbox has one channel. So the moment you clicked, the incumbent grid claimed the new state as though the modem already had it — and the two most important states on this page, *pending add* and *pending removal*, could not be drawn at all.

The chip splits them onto two channels that cannot interfere:

| Channel | Carries | Rendering |
| ------- | ------- | --------- |
| **Fill** | SELECTED | `primary-container` when picked, `surface-container` when not (`bandChipFill`) |
| **Ring** | LIVE | 2px inset `--primary` shadow, present iff the band is on the modem (`BAND_CHIP_LIVE_RING`) |

Which gives four readable combinations:

| Fill | Ring | Means |
| ---- | ---- | ----- |
| yes | yes | Already locked, staying locked |
| yes | no | **Pending add** — will be locked when you apply |
| no | yes | **Pending removal** — will be dropped when you apply |
| no | no | Not locked, staying that way |

`bandChipClass(selected, live)` composes both; nothing else may hand-write the classes.

### Why the ring is an inset shadow, not a border

A real CSS `border` adds a layout box. Every chip in the grid would therefore grow by 2px the instant a lock landed, and the whole grid would visibly reflow on **every successful apply** — the one moment the user is watching it most closely. An inset `box-shadow` costs no box, so gaining or losing the ring is a pure repaint. This is the same construction and the same reasoning as `PROFILE_ROW_ACTIVE_RING` in [sim-profiles.md](sim-profiles.md)'s shapes contract.

This is *not* a No-Hairline-On-Fill violation. That rule bans a stroke drawn to prop up a fill too weak to read on its own. Here the fill reads fine alone and the ring carries a **different fact** — a second independent signal, not a crutch for the first.

`--primary` is the ring colour because it has to survive on both fills, in both themes. `--primary` and `--primary-container` sit far apart on the lightness axis and move in opposite directions across the theme flip (light: L 0.488 on L 0.885; dark: L 0.79 on L 0.4). A ring drawn in `on-primary-container` would vanish against the container it sits on.

### Non-visual channels

The ring is a *shape* signal, so it survives greyscale and every colour-vision deficiency. Screen readers get words regardless: `bandChipA11yKey(selected, live)` resolves to one of three sentences (`{{band}}, selected` / `, not selected` / `, selected and active on the modem`). A pending removal announces as "not selected", which is the truthful description of what applying would do.

Chips also carry `aria-pressed={selected}`, and the grid is a `role="group"` labelled with the category title.

### Touch target

The chip paints at **40px** (`h-10`, matching the metric-row-pill height so a band chip and a glance row read as one family) with a `before:` overlay expanding the hit area to the project's 44px coarse-pointer floor without adding a layout box. The incumbent target was a `size-4` checkbox — 16px, on a page used roadside, in sun, on a tablet, on a device whose connection you are about to reconfigure.

### The legend names the CONFIGURATION fact

The legend under a chip grid (`BAND_LEGEND`, rendered only when at least one band is live) labels the ring swatch **"Currently locked"** (`band_locking.card.legend_live`). It used to read "On the modem now" — and the hero directly above the card has its own, unrelated **"On air now"** block. Two near-identical phrases, one metre apart, describing different data:

| Label | Source | Fact |
| ----- | ------ | ---- |
| Hero, "On air now" | `network.carrier_components` (poller) | Where the radio is **actually camped** this instant |
| Card legend, "Currently locked" | `ue_capability_band` (`current.sh`) | What is **configured** — whether or not the radio is using it right now |

Both are loosely describable as "on the modem now", which is exactly how they got conflated. The rename is copy-only: no props, no components and no keys changed, just the English string plus its translated equivalents in the other four locales, and the rationale comment above `BAND_LEGEND` in `shapes.ts`.

## `unlockAll` is a WRITE, not a clear

**"Restore all supported" does not clear anything — it writes the full supported band list to the modem.** `useBandLocking.unlockAll` (`hooks/use-band-locking.ts:265-279`) is a thin wrapper that calls `lockBands(category, supportedBands)`. The same `lock.sh` endpoint, the same `AT+QNWPREFCFG` write, the same failover watcher arming. "Unlock" on this page means "lock to everything", because the modem has no concept of an empty band restriction.

The incumbent labelled it "unlock/reset" behind an unlabelled `restart_alt` icon whose only explanation was a `title` attribute — which never appears on a touch device. It now has a visible label, `Restore all supported`.

**It deliberately has no confirmation dialog.** It is the one band write on this page that can only ever *widen* what the modem may use, so it is the recovery action — the thing you reach for when a lock you just applied left you with no service. Gating recovery behind a dialog while `Apply` (the write that can actually cost you the connection) fires freely would invert the risk gradient this product is built around.

It is disabled only when it would be a no-op (`categoryPosture(...) === "unrestricted"`) or when the card is frozen. That check goes through the shared helper in `shapes.ts`, so the button's enabled-ness, the card's header chip and the hero's badge for this category all read one definition of "unrestricted".

## The `prevLockedKey` render-phase sync

`band-grid-card.tsx` keeps the local selection in sync with the modem using React's documented "adjust state when a prop changes" pattern, run **during render**:

```tsx
const [prevLockedKey, setPrevLockedKey] = useState("");
const lockedKey = currentLockedBands.join(":");
if (prevLockedKey !== lockedKey && currentLockedBands.length > 0) {
  setPrevLockedKey(lockedKey);
  setCheckedBands(new Set(currentLockedBands));
}
```

Three things about this block are load-bearing.

**It must not become a `useEffect`.** `currentLockedBands` is rebuilt by a `useMemo` in the coordinator on every parent render, so it is a **new array identity every time**. An effect keyed on it would re-run forever. The joined string key is what makes the comparison meaningful — it compares *contents*, not identity.

There is a second, quieter cost to getting this wrong: `eslint-plugin-react-hooks` v7 is compiler-backed and **stops at the first violation it finds in a component**. Introducing one here would suppress every later diagnostic in the file, so the mistake would also hide its own neighbours. (Same toolchain behaviour documented in [radio-information.md](radio-information.md).)

**The `length > 0` guard is not dead defensiveness.** `current.sh` initialises each band variable to `""` and only fills it if the corresponding `+QNWPREFCFG:` line is present — so a category the modem does not report comes back as an empty string, which `parseBandString` turns into `[]`. Without the guard, every poll of an unreported category would wipe a selection the user was in the middle of making.

**This block is the ONLY thing that repaints the grid after a write.** The full chain is:

```
Apply / Restore all
  → onLock / onRestoreAll (coordinator)
  → lockBands  (hooks/use-band-locking.ts)
  → POST lock.sh
  → fetchCurrent()  → GET current.sh
  → new currentBands → new lockedBands memo → new currentLockedBands prop
  → new lockedKey → THIS BLOCK → setCheckedBands
```

Nothing else connects a click to the grid updating. Delete or "simplify" this block and Apply becomes a button that appears to do nothing.

## The gate chain

Two things outside this page can own radio configuration, and while either does, the band controls are read-only.

| Gate | Source | Banner |
| ---- | ------ | ------ |
| **Profile** (outranks scenario) | `useSimProfiles` → the active profile's scenario binding, resolved for *now* | `ProfileOverrideAlert` |
| **Scenario** | `useConnectionScenarios.activeScenarioId !== "balanced"` | `Banner role="override"` |

Both banners go through one primitive family. The incumbent rendered the profile gate through the shared `Banner` and the scenario gate through a legacy `Alert`, so two near-identical sentences arrived in two different shapes depending on which override happened to be in force.

A **Balanced** binding is treated as "no opinion" and leaves bands editable: Balanced re-applies AUTO mode and does not touch bands, so it is not competing for this setting.

### `resolveScheduledScenario(now, …)` is not `profile.scenario.default`

**The gate resolves the scenario that is in force at this instant, not the profile's default binding — and the difference is a real conflict, not a nicety.**

`profile.scenario.default` mirrors only the profile's fallback binding. It is blind to a schedule window that is active right now. The on-device systemd timer applies the **windowed** scenario (see [scheduled-timers.md](scheduled-timers.md) and [sim-profiles.md](sim-profiles.md)), so reading the static field would make this page disagree with the modem — and would let a user edit bands that a scheduled scenario is about to overwrite.

That matters because **scenarios issue the identical `AT+QNWPREFCFG` writes this page does.** It is genuine last-writer-wins contention over one modem parameter, not an advisory hint. `nextChangeAt(now, …)` supplies the "the active scenario is scheduled to change at HH:MM" note in the same banner.

### `isGated` and `isBusy` are separate props — keep them separate

The incumbent fused them into a single `isDisabled`, and only the header chip told them apart. They mean different things and the user needs both:

| Prop | Kind | Meaning | How it clears |
| ---- | ---- | ------- | ------------- |
| `isGated` | **Standing condition** | A Custom SIM Profile or Connection Scenario owns radio config | By changing something on another page; explained by the page-level banner |
| `isBusy` | **Transient** | A band write is in flight | On its own, in seconds |
| `isLocking` | Transient, **this card only** | *This* category's write is in flight | Drives the `SaveButton` spinner |

`isFrozen = isGated || isBusy` is the interaction block; `isLocking` stays per-card so the spinner lands on the button the user actually pressed. The header status chip reads `scenario` (info / `shield`) when gated, so a disabled card always says *why*.

## `isBusy` blocks all three categories during any lock

**This is a deliberate correction to the incumbent's per-category blocking, and the reason is in the shell, not the UI.**

When `lock.sh` arms the failover watcher, it first **kills any watcher already running** (`lock.sh`, the `FAILOVER_PID_FILE` branch) — only the most recent lock is monitored. The watcher's safety window is ~30 seconds: a 5-second settle, then five `AT+QCAINFO` checks 5 seconds apart (`SETTLE_DELAY=5`, `CHECK_INTERVAL=5`, `MAX_CHECKS=5` in `scripts/usr/bin/qmanager_band_failover`). It exits early and cleanly the moment any check finds carrier data.

So two locks fired seconds apart leave the **first** narrowing completely unmonitored for the rest of its safety window. If that first lock was the one that killed your connection, nothing is watching for it any more. Blocking all three cards while any one writes is the cheapest way to make that unrepresentable from this page.

> ⚠️ WARNING: a future "apply all three categories at once" button must be built as a **multi-category `lock.sh` that arms ONE watcher**, not as a client-side fan-out. Three concurrent POSTs would have each one kill the previous watcher, leaving two of the three narrowings unmonitored — strictly worse than the serialised behaviour this flag enforces. `components/onboarding/steps/step-band-locking.tsx` already demonstrates exactly this pathology: it fires up to three `lock.sh` POSTs under a single `Promise.allSettled`.

## Error scoping

`useBandLocking` exposes **one shared `error` string** for all three categories. The incumbent handed it to all three cards, so a failed SA write painted an identical red notice under LTE, NSA and SA and the user had to guess which had actually failed.

The coordinator scopes it with a single piece of state:

```tsx
const [lastAttempted, setLastAttempted] = useState<BandCategory | null>(null);
// …
error={lastAttempted === category ? error : null}
```

`setLastAttempted(category)` runs **before** the call, so it is already correct by the time a failure lands. This scopes the error without reshaping the hook's contract — deliberately, since the hook is shared with nothing else and reshaping it would be a larger change than the bug warrants.

The notice itself is a filled tonal block (`NOTICE` + `NOTICE_TONE`, `destructive-container` with a `destructive` glyph disc), replacing the surface's loudest legacy tell: `bg-destructive/10 border border-destructive/30 text-destructive`. A 10% alpha over a tinted surface is not a stable colour — it collapses in dark mode and washes out first in sunlight, which is the exact ambient condition this product is designed against.

## The killed translation trap

**Short version: the incumbent built its toast copy by cutting a substring out of the rendered English title, so translating the page would have broken the toast — silently, with no gate able to see it.**

The incumbent line was:

```tsx
toast.success(`${title.replace(" Locking", "")} bands locked successfully`)
```

The first thing any i18n pass does is translate the card titles — they are the most visible strings on the page. The moment that happens, `.replace(" Locking", "")` stops matching, and the toast reads "LTE Band Locking bands locked successfully" **in English**, beside a translated title.

No gate catches this:

- `bun run i18n:check` grades **missing** keys as warnings and exits 0, so a green run proves nothing about a locale landing (see [i18n.md](i18n.md)).
- A hardcoded literal has **no key to be missing** in the first place, so the check cannot see it at all.

The fix is `categoryShortKey(category)` in `shapes.ts`, alongside `categoryTitleKey` and `categoryDescriptionKey`. Each resolves an i18n key from the **`BandCategory` discriminator**, never from rendered copy:

```ts
categoryTitleKey("nsa_nr5g")  // "band_locking.categories.nsa_nr5g.title"  → "5G NSA"
categoryShortKey("nsa_nr5g")  // "band_locking.short.nsa_nr5g"             → "5G NSA"
```

`band-grid-card.tsx` reads `shortName` once and interpolates it into all five toast keys and the `sr-only` applying announcement. The title and the short name are now derived from the same enum in every locale, so they cannot drift.

## The hero: what was cut, and why the rest stayed

`LiveBandHero` replaces `band-settings.tsx`, which was six label/value rows held apart by seven `<Separator>` elements (one of them trailing, with nothing after it) sitting in the same grid as the three interactive cards — as though a read-only status panel and a control surface were the same kind of object.

The incumbent rendered four rows from `carrier_components`: Active LTE Bands, **Active LTE Channels**, Active 5G Bands, **Active 5G Channels**.

**The two ARFCN / channel rows are gone.** `components/cellular/radio/active-bands-card.tsx` already renders every ARFCN per carrier, with the correct RAT-specific label, a per-carrier quality chip and released-carrier handling (see [radio-information.md](radio-information.md)). Four comma-joined strings here were a worse copy of a better surface one click away. The incumbent helper also documented "includes duplicates since different carriers can share the same ARFCN" and then deduplicated on the very next line, so it did not do what it said.

**The two BAND rows stayed, as identity chips**, because they are the only on-page evidence that a lock actually took:

| View | Source | What it proves |
| ---- | ------ | -------------- |
| **CONFIGURED** | `ue_capability_band` via `current.sh` | What you asked the modem for |
| **ACTUAL** | `network.carrier_components` via the poller | Where the modem is actually camped |

Those are different facts, and the gap between them is exactly the class of bug that bit APN management, where `AT+CGDCONT?` reported a context the modem had never attached with (see [wan-profile-management.md](wan-profile-management.md)). Delete the on-air chips and applying a band lock gives you a green button and no evidence.

On-air chips use the `nr` / `lte` **identity** variants — the fill says which radio the band belongs to and never that it is healthy. They are deduplicated (a band can legitimately appear twice, as PCC and as SCC) and sorted numerically with the `B`/`N` prefix stripped, because a lexical sort puts B12 before B3 and a technician notices immediately. LTE is listed first: the LTE leg is the anchor in NSA, so it is what a reader looks for when a 5G connection misbehaves.

### Lock posture: three per-category badges, not one summed count

**The headline used to be a single number summed across all three categories, and that number could not be acted on.** It read `lockedTotal` / `supportedTotal` — LTE, NSA-NR5G and SA-NR5G band counts added together — producing a sentence like "Locked to 12 of 34 bands". Three unrelated band lists do not add up to anything a reader can use: "LTE fully locked, both NR categories open" and "NR narrowed a little, LTE untouched" are very different radio states that can sum to the identical headline, and neither tells you *which* category to go fix.

It is now a row of **three per-category badges** (`HERO_POSTURE_ROW` in `shapes.ts`), one per `BAND_CATEGORIES` entry, each showing that category's own short name + glyph and reusing `CATEGORY_BADGE`. The visible chip carries only the short name; the full sentence goes to assistive technology as the badge's `aria-label` via `band_locking.live.category_{posture}` with a `{{category}}` interpolation.

Posture is **derived, never asserted**, by one shared helper — `categoryPosture(locked, supported)` in `shapes.ts`:

| Condition | Posture | Badge (`CATEGORY_BADGE`) | `aria-label` key |
| --------- | ------- | ------------------------ | ---------------- |
| `supported.length === 0` | `unknown` | `muted` / `schedule` | `category_unknown` → "{{category}} not reported" |
| `locked` covers the whole supported list | `unrestricted` | `success` / `lock_open` | `category_unrestricted` → "{{category}} unrestricted" |
| otherwise (incl. an empty `locked` list) | `locked` | `warning` / `lock` | `category_locked` → "{{category}} band-restricted" |

`unknown` is a real state, not a loading state. A modem that has not reported a supported-band list yet must not be described as unrestricted, because "all supported bands available" would be a claim about a list nobody has seen.

**`categoryPosture` is shared with `BandGridCard` on purpose.** The card's own header chip reads the same helper (`isUnrestricted` is now a call, not a local re-derivation), so the hero's per-category badge and the card's status chip can never quietly disagree about what "unrestricted" means. Before, they were two independent comparisons that happened to agree.

#### The one combined fact that stayed

The hero's leading glyph disc still shows **one** posture, computed as `overallPosture` in `live-band-hero.tsx`: `unknown` if any category is unknown, else `locked` if any category is locked, else `unrestricted`. That is an **OR across categories** ("is anything restricted?"), which is a coherent question in a way the old SUM never was — and `unknown` outranking everything preserves the same honesty rule as above. Each posture gets its **own** glyph (`POSTURE_GLYPH`): `settings_input_antenna`, `cell_tower`, `schedule`. Two states in one slot never share a mark.

> ℹ️ NOTE: `BAND_CATEGORIES` is exported from `types/band-locking.ts` and imported by both `band-locking.tsx` and `live-band-hero.tsx`. It was previously a local const inside the coordinator; two iterations over three categories must not be able to disagree about order.

### Why failover lives in the hero

Band failover is not a fourth setting alongside the three categories — it is the safety net under all of them. `lock.sh` arms **one** watcher for the most recent lock regardless of which category it belonged to, so failover is a property of the modem, not of a card. Rendering it as a peer of the category cards said otherwise.

Its chip is a genuine four-state indicator (`FAILOVER_BADGE`), derived by `failoverKey()` in a **significant order**:

| Order | Condition | Key | Variant / glyph |
| ----- | --------- | --- | --------------- |
| 1 | `!failover.enabled` | `disabled` | `muted` / `do_not_disturb_on` |
| 2 | `failover.activated` | `fallback` | `warning` / `warning` |
| 3 | `failover.watcher_running` | `monitoring` | `info` / `progress_activity` (spins) |
| 4 | — | `ready` | `success` / `check_circle` |

`activated` outranks `watcher_running` because a watcher that has already fired is reporting a fallback, not progress, even while it keeps running. Every state carries a **distinct** glyph, which here is mandatory rather than tidy: `success-container` and `warning-container` measure ~1.03:1 apart and are the same surface under deuteranopia, so the glyph is the only channel separating "the safety net is armed" from "the safety net has fired and your lock is not in force". `disabled` is `muted`, never `destructive` — it is deliberately off, not broken.

The hook drives this chip live. After a successful lock that returns `failover_armed: true`, `useBandLocking` polls `failover_status.sh` every 1s (it reads flag files only — no modem contact) until the watcher exits, then re-fetches `current.sh` if the watcher activated, because the watcher will have rewritten all three band lists back to the supported set.

## Geometry and tone

Everything shape- or tone-bearing on this surface lives in `components/cellular/band-locking/shapes.ts`, modelled on the custom-profiles contract and for the same reason: the incumbent declared its card shell in **three places inside one file** — the loading, empty and loaded branches of `band-cards.tsx` — so a radius fixed in one branch stayed wrong in the other two.

| Constant | Purpose |
| -------- | ------- |
| `BAND_HERO` | The one hero card, `rounded-hero` (40px). A second hero on this page spends the Consistent-Layout Rule's glance-surface exception twice |
| `BAND_CARD` | One category card, `rounded-card` (36px). Imported by all three branches |
| `CARD_PAD`, `HERO_DISC`, `HERO_EYEBROW`, `HERO_VALUE`, `HERO_POSTURE_ROW`, `HERO_ROW`, `HERO_ONAIR` | Hero internals. `HERO_POSTURE_ROW` is the wrapping badge row that replaced the summed headline (see Lock posture); `HERO_ROW` is `rounded-field` (20px) because that row genuinely wraps — a pill that has wrapped to two lines is a stadium |
| `BAND_CHIP`, `BAND_CHIP_LIVE_RING`, `bandChipFill`, `bandChipClass`, `bandChipA11yKey`, `BAND_LEGEND` | The chip contract (above). `BAND_LEGEND`'s rationale comment carries the "Currently locked" naming rule — see The legend names the CONFIGURATION fact |
| `NOTICE`, `NOTICE_TONE` | The card-scoped error slot |
| `PILL_ACTION`, `PILL_ACTION_PLAIN`, `PILL_QUIET` | Action sizing. `PILL_QUIET` is deliberately smaller: Select all / Clear change a selection, they do not write to the modem, and three equal-weight pills in one footer loses which is consequential. It carries **size only** — no fill, no ink |
| `FAILOVER_BADGE`, `CATEGORY_BADGE`, `POSTURE_GLYPH`, `BADGE_GLYPH_SIZE` | Tone + glyph maps, keyed onto the exported `BadgeVariant` type so an unmapped state fails the build |
| `categoryPosture` | `(locked, supported) => BandPosture`. The single derivation shared by the hero's per-category badges and the card's header chip |
| `SKELETON_SHAPE` | Loaded geometry restated once so skeletons mirror by import, not by estimate. Includes `POSTURE_CHIP`, the mirror for one hero posture badge |
| `categoryTitleKey`, `categoryDescriptionKey`, `categoryShortKey` | Category → i18n key (above) |

`CATEGORY_BADGE` reads the functional contract, not a value judgement about locking: `unrestricted` is `success`, `locked` is `warning` (a narrowed band list is the state that can cost you the connection — `warning` means *constrained*, not *you did something wrong*), and `scenario` is `info` (something else owns the setting; a standing condition, not a fault). It carries a **fourth** entry, `unknown` (`muted` / `schedule`), because the hero's per-category badges have to render a category the modem has not reported a supported-band list for — the card never reaches that state (it renders its Empty branch instead).

### Select all / Clear are `tonal-neutral`, never `ghost`

`PILL_QUIET` sizes those two footer buttons but deliberately carries **no fill and no ink of its own** — the `variant="tonal-neutral"` Button supplies both. It used to be `variant="ghost"` plus a hardcoded `text-on-surface-variant` in the constant, and a ghost button has no resting fill at all: sitting beside a filled `Apply` and an outlined `Restore all supported`, it read as *disabled or absent* rather than as a third, quieter action. `tonal-neutral` gives it a real but muted presence (`surface-container`) instead of asking the reader to discover it by hovering.

Both chip hovers are `enabled:`-scoped. Tailwind's `hover:` does not exclude a disabled element on its own, so an unscoped hover would light up every chip on a gated card — advertising an interaction that is switched off.

Chip entrance motion uses `rowCascadeDelay(index)` from `lib/motion.ts` on the item variant via `custom`, **not** `staggerRows`. `staggerChildren` is unbounded, and a supported-band list routinely exceeds twenty entries: at the 80ms row step the twenty-first chip would land 1.68s after the first, which reads as the card still loading. `rowCascadeDelay` caps the index, but is a per-child delay and cannot be combined with `staggerChildren` — hence the `custom` route.

## The shared `/cellular/` page header

`components/cellular/page-header.tsx` (`CellularPageHeader`) is the header half of the Consistent-Layout Rule's page shape: a Display-step `h1`, an optional muted description, and optional right-aligned actions, laid out with a **container query** against `@container/main` so it responds to the content column rather than the viewport (and stays correct when the sidebar expands).

It exists rather than a copy-pasted `<h1>` because `text-3xl font-bold mb-2` appears in 26 component files and is missing the `tracking-[-0.02em]` the Display step actually specifies — so every one of those pages renders its title fractionally wider than the migrated surfaces. A class you have to remember to type is a class that will be typed wrong.

**Scope is deliberately three routes.** Band Locking, Tower Locking and Frequency Locking are one sub-tree a user crosses three times in a single task, so they move together; Tower and Frequency received **header-only** edits. The other unmigrated routes are not swept as a side effect — DESIGN.md's Migration Deltas table is explicit that new work follows the canon without "fixing" unconverted surfaces in passing.

It is deliberately **not** `components/cellular/radio/page-header.tsx`. That component owns Radio Information's freshness chip, its clipboard action and its own namespace lookups; it is a page, not a primitive.

## Props contracts

### `LiveBandHeroProps`

| Prop | Type | Notes |
| ---- | ---- | ----- |
| `failover` | `FailoverState` | `{ enabled, activated, watcher_running }` |
| `carrierComponents` | `CarrierComponent[]` | From `useModemStatus`; the ACTUAL view |
| `supportedBands` | `Record<BandCategory, number[]>` | Hardware-supported bands **per category** (`policy_band`). Replaced the summed `supportedTotal: number` |
| `lockedBands` | `Record<BandCategory, number[]>` | Configured bands **per category** (`ue_capability_band`). Replaced the summed `lockedTotal: number` |
| `onToggleFailover` | `(enabled: boolean) => Promise<boolean>` | Returns success; the hero owns its own toast |
| `isLoading` | `boolean` | Page-level (`statusLoading \|\| bandsLoading \|\| scenariosLoading`) |
| `isGated` | `boolean?` | Disables the failover switch — see Known gaps |

### `BandGridCardProps`

| Prop | Type | Notes |
| ---- | ---- | ----- |
| `bandCategory` | `BandCategory` | `"lte" \| "nsa_nr5g" \| "sa_nr5g"`; also the i18n key stem |
| `supportedBands` | `number[]` | From `device.supported_*_bands` (`policy_band`), sorted |
| `currentLockedBands` | `number[]` | From `ue_capability_band`, sorted. **New array identity every parent render** |
| `onLock` | `(bands: number[]) => Promise<boolean>` | Coordinator sets `lastAttempted`, then calls `lockBands` |
| `onRestoreAll` | `() => Promise<boolean>` | Coordinator sets `lastAttempted`, then calls `unlockAll` |
| `isLocking` | `boolean` | THIS category only — drives the spinner |
| `isBusy` | `boolean` | ANY category — blocks interaction |
| `isLoading` | `boolean` | Page-level |
| `error` | `string \| null` | Already scoped by the coordinator; never the raw hook error |
| `isGated` | `boolean?` | Standing condition |

The card owns only `checkedBands` (the local selection), `prevLockedKey` (the sync guard) and its `useSaveFlash` state. Everything else is a prop.

## Card states

Three branches, all rendering `BAND_CARD` so the shell cannot drift:

- **Loading** — skeletons imported from `SKELETON_SHAPE`, including `CHIP_COUNT = 12` chip placeholders at the real 40px height and the footer actions at the real 42px pill height. The incumbent guessed `h-9 w-40` for a 42px button and `size-4` slivers for a control that no longer exists.
- **Empty** (`supportedBands.length === 0`) — a real state, not a failure: plenty of RM520N SKUs report no SA band list at all. It keeps the card shell so the grid does not reflow around it.
- **Loaded** — header chip, chip grid, conditional legend (rendered only when at least one band is live, because a key explaining a mark that appears nowhere is noise), conditional error notice, `sr-only` live region for the applying announcement, and the footer.

The footer separates two different truths: the header chip reports the **modem's** state (`{count} of {total} locked`), while the pending count beside Select all / Clear reports the **form's** (`{count} pending changes`). Merging them into one line would merge two facts.

## Known gaps

- **The failover switch is disabled while gated**, so a scenario-controlled page cannot turn the safety net **on** — arguably backwards, since a scenario-applied band lock is exactly the case where you most want the net. It is left unchanged deliberately: [sim-profiles.md](sim-profiles.md) documents that the profile-apply path arms the watcher itself, and changing the gate here without changing that path would create two owners for one flag.
- **`hasChanges` blocks re-applying an identical lock.** `SaveButton` is disabled when `pendingCount === 0`, which is right for avoiding a pointless modem write — but it also means the **failover watcher cannot be re-armed without changing the selection**. If a watcher's 30-second window has expired and the user wants to re-arm it, they must toggle a band off and back on.
- **`components/onboarding/steps/step-band-locking.tsx` is a fully independent implementation** that this redesign did not touch. It still uses checkboxes, its own preset radio group, hardcoded English copy, its own `authFetch` POSTs straight to `lock.sh`, and a `Promise.allSettled` fan-out of up to three concurrent locks (the watcher-starvation pathology described above). A user's **first** band-lock experience therefore diverges from every later one.
- **The failover help copy said 15 seconds — FIXED in this pass, and worth knowing why it was wrong.** The incumbent tooltip claimed the modem falls back "after 15 seconds", and the new i18n key inherited the figure verbatim before anyone checked it against the daemon. `qmanager_band_failover` is `SETTLE_DELAY=5` then `MAX_CHECKS=5 × CHECK_INTERVAL=5` — a **~30 second** window, which the script's own log line at `:84` states outright. All five locales now say "about 30 seconds". The lesson generalises: a number in user-facing copy is a claim about the device, and the State-Honesty Rule applies to it exactly as it does to a status chip. If `SETTLE_DELAY`, `CHECK_INTERVAL` or `MAX_CHECKS` is ever retuned, `band_locking.live.failover_help` has to move in the same change, in all five locales — nothing links them mechanically.
- **Tower Locking's and Frequency Locking's header strings are hardcoded English.** The header-only migration passed literals to `CellularPageHeader` rather than `t()` calls; those two routes are not yet in the i18n sweep.

## Related

- [sim-profiles.md](sim-profiles.md) — the profile/scenario gate's other half, the scheduled-scenario resolution, and the band-failover watcher on the apply path
- [scheduled-timers.md](scheduled-timers.md) — the on-device timer that applies a windowed scenario, and why a schedule is authoritative over a static binding
- [radio-information.md](radio-information.md) — `active-bands-card.tsx` (which owns ARFCN rendering), and the compiler-backed `react-hooks` bail-on-first-violation behaviour
- [carrier-aggregation.md](carrier-aggregation.md) — `carrier_components[]`, the ACTUAL view the hero's on-air chips read
- [wan-profile-management.md](wan-profile-management.md) — the configured-vs-actual gap that motivated keeping the on-air chips
- [i18n.md](i18n.md) — the locale pipeline and why `i18n:check` is not a gate
- [icon-system.md](icon-system.md) — `/cellular/` is a Material Symbols route; every glyph used here is already in the subset allowlist
- `DESIGN.md` > Named Rules (Consistent-Layout, Identity-Chip, Filled-Chip, Glyph-Disc, Skeleton-Mirror, One-Scale, Solid-Container)
