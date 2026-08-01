# Dashboard State-Change Motion

Two gestures that fire when the modem reports something new, and that live in shared primitives rather
than in the cards that use them: the **live value tick cascade** (Motion Guide recipe 06 — a number
dips when it moves, and a card full of numbers dips in sequence) and the **status chip morph**
(recipe 05 — a chip's fill and its label change on two different clocks). Both were shipping with one
half of the gesture missing, in ways nothing in TypeScript or the build could catch. This note records
what the two primitives guarantee, which alternatives were rejected on measured evidence, and the
contracts a future edit must not quietly drop.

A third gesture was added later and lives here for the same reason the first two do — it is a **shared
primitive**, and its contracts are the ones `lib/motion.ts` has to keep: the **save flow** (recipe 15),
in `components/ui/save-button.tsx`. It is product-wide rather than dashboard-scoped, so it sits in
Part 3 below rather than renaming the file; the alternative was a new reference doc for a primitive,
which the routing table does not want.

> ℹ️ NOTE: "Motion Guide" is the project's design-mock motion deck (`/reimagine/Motion Guide.dc.html`),
> which numbers its gestures as recipes. It is **gitignored**, so it does not exist in a worktree — the
> reasoning below is the durable copy.

## Quick Reference

| Item | Value |
|------|-------|
| Tick hook | `hooks/use-value-tick.ts` — `useValueTick(value)`, returns a ref |
| Tick component | `components/ui/ticking-value.tsx` — `TickingValue`, for use inside a `.map` |
| Tick cascade | `components/ui/tick-group.tsx` — `TickGroup`, renders **no DOM** |
| Chip label half | `components/ui/swap-label.tsx` — `SwapLabel`, keyed crossfade |
| Chip container half | `components/ui/badge.tsx` — longhand transition in the `cva` base |
| Cascade step | `TICK_STAGGER_STEP` (100ms) from `lib/motion.ts` — a **non-entrance** step, neither the 60ms card nor the 40ms row step |
| Cascade clamp | `MAX_RANK = 7` in `tick-group.tsx` |
| Tick shape | `TICK` in `lib/motion.ts` — 700ms total (`standard` down on standard's curve + `emphasized`'s duration up on a **linear** ramp), dip to 35% at ~43% of the run |
| Reference chip implementation | `components/dashboard/network-status.tsx` |
| Save flow | `components/ui/save-button.tsx` — `SaveButton` + `useSaveFlash` |
| Save-check overshoot | `SAVE_CHECK_OVERSHOOT` (1.03), `SAVE_CHECK_KEYFRAMES` (`[0.4, 1.03, 1]`), `transitionSaveCheck` in `lib/motion.ts` |
| Design canon | `DESIGN.md` > Motion > "Live value tick" and "Status chip swap"; > Named Rules > The No-Overshoot Rule; > Components > Buttons |

---

## Part 1 — The live value tick cascade

### The problem: one commit, one frame, one flash

`useValueTick` knows when *one* figure moved. It cannot know that five others moved in the same poll.
Every dashboard value arrives in a single poll response and lands in a single React commit, so every
dip started on the same frame — and a card carrying eight live figures read as **the whole card
flashing** rather than as its individual numbers ticking. That is the opposite of the recipe's intent:
the dip exists to draw a flicker of attention to *the number that changed*.

Recipe 06's own demo stages its three values apart for exactly this reason. `TickGroup` is the piece
that gives a real group the same ordering.

### How it works

`TickGroup` is a React context provider that renders no DOM of its own — it is a coordination scope,
not a layout box, so dropping one into a flex row or a grid cannot disturb the row.

1. A value changes. `useValueTick` runs its **layout effect** and, if a `TickGroup` is in context,
   calls `group.enqueue({ node, start })` instead of starting the dip.
2. The first enqueue of a commit schedules a `queueMicrotask` drain.
3. The drain sorts the enqueued members with `compareDocumentPosition` and calls
   `member.start(rank × 100ms)`.

Outside a group the delay is zero and the behaviour is exactly what it was. That is deliberate: a
`TickingValue` mounted without a group is not broken, it simply dips immediately, which is the right
answer for a card carrying one live figure.

### Why each decision, and what it replaced

These four are the load-bearing calls. Each of them has an obvious alternative that was tried or
considered and lost.

#### 1. Rank among the values that CHANGED, not ordinal position in the card

This was the decisive call, and it was made against measured evidence rather than taste.

Ordinal indexing — give each value a fixed slot in the card and delay by that slot — fails on the two
biggest cards:

- **Device Information** holds nine identity rows (manufacturer, firmware, build date, IMSI, ICCID,
  IMEI, LAN gateway, version) that change approximately never, above two live uptime tiles. Under
  ordinal indexing a typical poll sits silent through nine slots and then dips at **540ms and 600ms**.
  That is not a cascade. It is unexplained latency.
- **Device Metrics** would cascade with **holes** wherever a value happened not to move that poll,
  which reads as rows failing to render rather than as choreography.

Ranking over only the values that actually moved gives a gapless cascade whose total length is bounded
by how many figures changed — typically three to five, so a ≤400ms tail — whichever ones they were.

> ℹ️ NOTE: The tradeoff, recorded honestly: one row's **absolute** delay shifts between polls. What
> never shifts is its position **relative to its neighbours**, and that relative order is what the eye
> is actually reading in a cascade. Absolute timing is not perceivable here; sequence is.

#### 2. Order comes from live DOM nodes, not an index prop or an axis flag

Members are sorted with `compareDocumentPosition`, so **document order is reading order** — and in this
dashboard that holds for every group without a direction hint:

| Group | Layout | Why document order is correct |
|-------|--------|-------------------------------|
| Device Metrics | vertical stack | reads top-to-bottom |
| Data Used rx/tx pair | horizontal pair | reads left-to-right |
| Carrier Aggregation tiles | `grid-cols-1 → @md:grid-cols-2 → @3xl:grid-cols-4` | CSS grid places **row-major**, so index order survives all three breakpoints |

An index prop would have needed an axis flag to cover the second and third rows of that table, and the
flag would have had to be responsive to cover the third alone.

Sorting **live nodes** buys a second property that an index cannot: a value that renders conditionally
is simply **absent from the set** rather than leaving a dead beat. Signal Status' band row (`rows[0]`)
takes an identity-pill branch that mounts no tick at all — with a naive map index every cascade on that
card would have opened with a silent slot.

#### 3. The drain is a microtask, not a parent layout effect

A parent layout effect *would* also see every child, because React runs child layout effects before the
parent's. But it only runs **if the parent re-rendered in that commit** — so a memoized subtree
updating on its own would strand its registrations and never dip at all.

A single shared microtask flushes after the whole commit's layout effects regardless of which
components rendered, so the group always sees the true set of values that moved together.

> ⚠️ WARNING: `useValueTick` registers in a `useLayoutEffect`, not a `useEffect`. That ordering is what
> puts the registration in front of the microtask drain. Moving it to `useEffect` would let the drain
> run first and each value would fire alone — a silent regression to the pre-cascade behaviour, with no
> type error and no visible breakage in a single-value card.

#### 4. The step is `TICK_STAGGER_STEP` (100ms), which is neither entrance step

This shipped first at the 40ms row step, reasoning that `DESIGN.md` gives the denser step to "rows
inside one card's border" and that these figures are exactly that. The premise was right and the
conclusion was wrong, because the two entrance steps are tuned against a failure this cascade does not
have:

| | Entrance cascade | Tick cascade |
|---|---|---|
| What the user is waiting for | the content itself | nothing — the card is already on screen |
| Failure if too slow | reads as still loading | none, until it collides with the poll |
| Failure if too fast | none | dips overlap and merge back into one flash |
| Correct instinct | as dense as still reads as sequence | as loose as the poll affords |

At 40ms four dips spanned 120ms against a dip several times longer, so consecutive dips overlapped
almost entirely and a card still read as flashing — the exact symptom the cascade was built to remove.

100ms sits in the middle of the usable range. The **floor** is ~80ms, below which consecutive dips
merge. The **ceiling** is the poll: with `MAX_RANK` (7) the worst case is 700ms of lead plus a 700ms
dip, comfortably inside the measured ~3s cadence.

Recipe 06's demo stages its values **350ms** apart, and that number still is not the product value: the
demo is a **2s looping** showcase spacing three dips far enough apart to be legible in isolation.

> ⚠️ WARNING: Do not "restore" the mock's 350ms. At 350ms a five-value cascade spends 1.4s on lead
> alone before its last dip even starts, which is longer than the poll that produced it — the next poll
> would land mid-cascade, permanently.

Rank is clamped at `MAX_RANK` (7), so a group past the guide's ~8-item cascade ceiling shares the tail
slot instead of growing an unbounded tail.

> ℹ️ NOTE: This is the product's only non-entrance stagger, and the exception is closed. A third
> *entrance* step is still a mistake; `staggerContainer`/`staggerRows` remain the only two.

### Why the return leg is linear, and how that was established

The tick's two legs each carried their own token's curve — `standard` down, `emphasized` up. That is
the right instinct and it produced a measurably bad return.

The shape was measured on the live dashboard at `192.168.225.1` by pulling a running tick's keyframes
off the page and stepping a probe animation through fixed `currentTime` values. Clock-independent, so
it stays valid even though the automated tab is backgrounded and Chrome freezes the animation clock
there — a detail worth remembering before anyone tries to verify this by sampling `getComputedStyle`
during a real tick and concludes the animation is broken because everything reads `1.00`.

| t | eased return (`emphasized`) | linear return (shipped) |
|---|---|---|
| 0ms | 1.000 | 1.000 |
| 100ms | 0.524 | 0.524 |
| 200ms | 0.380 | 0.380 |
| **300ms** | **0.350** (dip bottom) | **0.350** |
| 400ms | 0.890 | 0.513 |
| 500ms | 0.968 | 0.675 |
| 600ms | ~0.99 | 0.838 |
| 700ms | 1.000 | 1.000 |

The eased return recovers **78% of its distance in its first 100ms** and then spends 300ms travelling
0.89 → 1.00 — below the threshold where an opacity change on text is noticeable. The gesture was
nominally 700ms and perceptually about **400ms**. That is why it still read fast at a duration that
should have been ample, and why reaching for another scale step would have been the wrong fix: the
budget was already there, the curve was hiding it.

> ℹ️ NOTE: The general lesson, worth applying beyond this hook. **Every curve on this scale is
> front-loaded**, because they are shaped for content that *arrives* — depart decisively, settle into
> place. A return to rest has no arrival to sell; its whole job is a recovery that stays visible for as
> long as it lasts. Linear is the only ramp with no invisible tail. On a pure opacity fade it reads as
> smooth, not mechanical, and the down leg still carries `standard` so the dip keeps its shape and
> decelerates into the bottom.

**A duration is only as long as its visible part.** When a gesture reads fast at a duration that should
be ample, measure where the curve is spending it before lengthening it.

### The retarget fix the cascade forced

`useValueTick`'s second contract is **interrupt and retarget, never queue** — a value that moves
mid-dip must restart from where it currently is. The old implementation called `cancel()`, which
reverts the node to its resting opacity of 1 before the replacement animation starts.

That was survivable only because every tick began on the frame it was requested: the snap to 1 and the
new dip happened in the same frame, so nothing was visible. Under a cascade delay it becomes
**snap → freeze → dip** — the value pops to full opacity, sits there for its whole rank delay, and only
then dips. The fastest-moving figures on a card would have received the worst feedback in the product.

Two changes fix it together:

```ts
// Read BEFORE cancelling: cancel() reverts the node to its resting opacity,
// so asking afterwards always answers 1 and the retarget is lost.
const from = running.current
  ? Number.parseFloat(window.getComputedStyle(el).opacity) || 1
  : 1;

running.current?.cancel();
running.current = el.animate([{ opacity: from, offset: 0, easing: "ease-out" }, /* … */], {
  duration: TICK.duration * 1000,
  delay: delayMs,
  fill: "backwards", // holds the `from` keyframe through the delay
});
```

`fill: "backwards"` is what stops the node painting its resting state during the delay. This is the
same construction `.ca-meter` already uses in `app/globals.css` (`animation-fill-mode: backwards`),
where it stops a staggered meter painting at full scale before its turn arrives.

### Where the groups are scoped

One `TickGroup` per card body, **not** per sub-group. A group of one is pointless, and a group spanning
several cards would let a single poll cascade past the poll interval itself.

| Card | Wraps | Note |
|------|-------|------|
| `components/dashboard/device-metrics.tsx` | the body `motion.div` | One wrapper already yields temp → cpu → mem → storage → rx → tx → lteDist → nrDist: top-to-bottom down the card **and** left-to-right across the rx/tx pair |
| `components/dashboard/device-status.tsx` | both halves (identity `motion.dl` + the uptime tiles `div`) | 11 figures, past the ~8 ceiling — and that is fine *precisely because* rank is over what moved: the nine identity rows never enter the ranking |
| `components/dashboard/carrier-aggregation.tsx` | the card | Two cascades on this card, see below |
| `components/dashboard/signal-status-card.tsx` | the rows `motion.dl` | Shared body for **both** the 4G and 5G primary status cards |

Deliberately **ungrouped**, because a group of one buys nothing: `live-latency.tsx`'s single figure,
and the LTE/NR distance rows.

> ⚠️ WARNING: Carrier Aggregation now carries **two** cascades and they must not be conflated.
> `--meter-index` staggers the meter **fill arrival** at the 60ms *card* step, on first paint only.
> `TickGroup` staggers the value **dip** at the 100ms *tick* step, on every poll. Different step,
> different trigger, different lifetime.

### A verified fact, so nobody re-litigates it

**Placing a `TickGroup` between a variant parent and its `motion` children does not sever
`staggerRows` → `staggerRowItem` propagation.** motion/react resolves a child's variant parent through
`useContext(MotionContext)` (`node_modules/framer-motion/dist/es/motion/utils/use-visual-element.mjs:13`),
not by direct-child adjacency, so an intervening plain provider is transparent to it.

Wrapping from outside the `motion` element is therefore a readability preference, not a correctness
requirement. Both placements work.

---

## Part 2 — The status chip morph

### The two clocks

Recipe 05 runs a chip's state change on two clocks so it is **felt peripherally before it is read**:

| Half | Duration | Owner |
|------|----------|-------|
| Container — fill and ink morph | `standard` (300ms) | `components/ui/badge.tsx`, longhand in the `cva` base |
| Container — focus ring | `quick` (180ms) | same |
| Label — crossfade + 7px travel | `quick` (180ms), incoming delayed one 60ms `--stagger-step` | `components/ui/swap-label.tsx` |

The container half was already correct and is untouched by this change. `badge.tsx` writes its
transition longhand precisely because no single Tailwind duration utility can express two clocks —
which is how `background-color` fell out of the property list once before, and every chip in the
product spent a while cutting straight to its new fill.

The gap was entirely in the **label** half, at three call sites.

### What `SwapLabel` guarantees

- Both legs of the crossfade. `AnimatePresence` with `mode="popLayout"` keeps the outgoing span
  rendered while it fades, and pulls it out of layout flow so the two labels cannot stack and shove the
  chip taller.
- The recipe's direction: exit rises out at −7px, entrance rises in from +7px.
- `initial={false}`, so a chip arriving with its card is silent — arrival belongs to the entrance
  cascade, and this reports only a *change*. Same reasoning as `useValueTick` seeding its previous
  value.
- `inline-flex`, because a transform on a plain inline box is dropped outright and the 7px travel would
  vanish leaving a bare opacity fade.

### The three sites that were wrong, and how

| Site | Failure | Fix |
|------|---------|-----|
| `components/dashboard/recent-activities.tsx` | A keyed `motion.span` with **no `AnimatePresence`** — React drops the outgoing node in one commit, so only the incoming label animated. No `exit` leg, and 4px of travel instead of the recipe's 7px | `SwapLabel` keyed `` `${chipTone}-${unresolvedCount}` `` |
| `components/dashboard/live-latency.tsx` | Hand-rolled duplicate of `SwapLabel`, **and left the glyph outside** the `AnimatePresence` so it snapped in one frame while the fill morphed over 300ms. Its key (`hasReading`) was also coarser than the variant, so a `success → warning` change with a reading present animated nothing at all | `SwapLabel` keyed `` `${tone.variant}-${hasReading}` `` with the glyph inside |
| `components/dashboard/signal-status-card.tsx` | **No label motion at all** — the container half running solo, the exact inverse of the bug `badge.tsx` had already fixed on the fill | `SwapLabel` keyed `` `${identityVariant}-${quality}` `` |

`components/dashboard/network-status.tsx` was audited and is the correct reference implementation. It
is unchanged.

### Two clauses that are easy to get wrong

**The glyph goes inside the swap.** Every status chip carries an icon because `success-container` and
`warning-container` measure ~1.03:1 apart and are identical under deuteranopia — the glyph is the only
channel separating those states in greyscale. A glyph that snaps in one frame while its fill morphs
over 300ms is the motion half of that colour-blindness contract failing.

**The `sr-only` accessible name stays OUTSIDE the swap.** `mode="popLayout"` keeps the outgoing and
incoming spans mounted together for the length of the crossfade. Inside the wrapper, a screen reader
would meet the accessible name **twice for 180ms** on every tone change.

### Choosing the swap key

Key on what the chip **says**, not on its variant, since two states can share a container. But the
inverse failure is just as real: a key coarser than the variant animates nothing when only the tone
moves — which is exactly what `live-latency.tsx`'s `hasReading` key did. Where the label text and the
tone can move independently, encode **both**, as all three fixed sites now do.

### Deliberately out of scope

**A reduced-motion kill switch for `badge.tsx`'s colour transition.** The project rule is "movement
goes, opacity stays". A colour morph is neither movement nor a repeating flash, and suppressing it
would make state changes *less* perceptible — the opposite of what the colour-blindness contract asks
for. `SwapLabel`'s own 7px travel needs no branch either: `<MotionConfig reducedMotion="user">`
(`components/motion-provider.tsx`) drops the transform and keeps the opacity, so the gesture degrades
to a plain crossfade, which still carries the information that the state changed.

---

## Part 3 — The save flow (`SaveButton`, recipe 15)

`components/ui/save-button.tsx` is the product-wide save action: **18 call sites**, 9 on Material
routes and 9 on lucide ones. Three states cross-fade **in place** inside one pill — idle label →
spinner + `actions.saving` → check + `actions.saved` — and the button never changes width while it
does, so a toolbar cannot reflow mid-save.

### The width lock is a grid stack, not the mock's absolute layers

The Motion Guide's own technique for the lock is three `position: absolute` layers over a pill with a
`min-width`. That does not survive contact with this codebase, for two reasons that were both proven
rather than guessed:

1. **Absolutely-positioned children contribute no width.** The button's intrinsic width would collapse
   to its horizontal padding — and `components/cellular/sms/forwarding/sms-forwarding-card.tsx:376`
   passes `w-fit`, which would then resolve to roughly 40px. The incumbent's `overflow-hidden` was
   silently clipping the label rather than fixing anything.
2. **No single `min-width` works across five locales.** It has to hold `"Update"` (6ch),
   `"Lock Selected Bands"` (19ch) and Italian `"Salvataggio…"` at once. Any number wide enough to avoid
   clipping the longest leaves a cavern on `zh-CN` / `zh-TW`, where the same strings are three or four
   glyphs.

The shipped implementation is a **CSS grid stack**: `inline-grid` on the `Button`, all three layers at
`[grid-area:1/1]`, opacity alone driving visibility. A grid track sizes itself to its widest item, so
the pill's width is `max(idle, saving, saved)` **per locale, automatically** — no measurement pass, no
magic number, no clipping, and nothing to retune when a translator lengthens a string.

> ⚠️ WARNING: **`AnimatePresence` cannot be used here, and this is a constraint rather than a
> preference.** Unmounting a layer removes its contribution to the grid track, so the width would
> collapse on the exact frame the lock exists to cover. All three layers stay permanently mounted.
> `overflow-hidden` is gone with them — it only ever existed to hide the clipping this design removes.

### The check: a keyframe list, because a spring has no ceiling

`DESIGN.md`'s No-Overshoot Rule and `lib/motion.ts:14` both named this button as the *one* sanctioned
overshoot, at 1.03. The code underneath was running `{ type: "spring", stiffness: 400, damping: 22 }`
on `scale: 0.85 → 1` — an underdamped spring, whose peak is an emergent property of two dials and is
bounded by nothing. The rule was being violated by the exact component it cited.

It is now a keyframe list with the peak exported as a constant:

| Export | Value | Why |
|--------|-------|-----|
| `SAVE_CHECK_OVERSHOOT` | `1.03` | The ceiling, as a number something can import and a reviewer can grep |
| `SAVE_CHECK_KEYFRAMES` | `[0.4, SAVE_CHECK_OVERSHOOT, 1]` | In from 0.4, past the ceiling, settled at rest |
| `transitionSaveCheck` | `DUR.standard`, `EASE_STANDARD`, `times: [0, 0.55, 1]` | The 0.55 midpoint spends more of the budget on arrival than on settle, so the overshoot reads as a landing, not a bounce |

The generalizable lesson: **a motion ceiling enforced by a prose comment is not a ceiling.** If a rule
names a number, export the number.

### Accessibility decisions, and the reasoning behind each

All three layers are `aria-hidden`; the `Button` carries one stable `aria-label` that does **not**
change across states, so a state change never re-announces the control.

- **No `aria-live`, deliberately.** All 22 `markSaved()` call sites are immediately followed by a
  `toast.success(...)`, and sonner already renders into a live region. An `aria-live` on the button
  would double-announce every save product-wide. **The toast is the announcement channel; the button is
  the visual confirmation.**
- **No hard `disable` during the flow, deliberately.** A `disabled` element drops focus to `<body>` in
  both Chrome and Firefox, so a keyboard user who pressed Enter on Save lost their place for the ~1.8s
  of the flash — which is what the incumbent did. Instead: the caller's own `disabled` passes through
  untouched, and while `isSaving || saved` the button sets `aria-disabled` plus an `onClick` guard
  calling `preventDefault()` / `stopPropagation()`. The guard is what actually stops the second
  activation, **including native form submission** — 11 of the 18 call sites are `type="submit"` inside
  a `<form>` with no `onClick` of their own, so returning early from a handler they do not use would
  have stopped nothing.
- **The spinner gained `motion-reduce:animate-none`.** It was the only spinner in the product missing
  it; 82 siblings had it. It stays `animate-spin` at 1s: the guide's "ambient 2s" token is for genuine
  loops like the service ring, and `lib/motion.ts:76` forbids JS-driven continuous animation.
- **`useSaveFlash`'s `setTimeout` is now cleaned up** — on unmount *and* on re-trigger. Several callers
  (tower-settings among them) unmount the button while the flash is still live, and a caller that saves
  twice inside the window would otherwise have the first timeout cut the second flash short.

### Every idle label is a translation key now

The recorded defect was that `SaveButton` hardcoded `Saving…` / `Saved!`. The larger half was
undocumented: **16 of the 18 call sites hardcoded English idle labels**, so an Italian user watched
`"Lock Selected Bands"` → `"Salvataggio…"` → `"Salvato!"` → `"Lock Selected Bands"` — the transient
states translated and the resting state not.

New `common.json` keys under `actions`: `save_settings`, `save_and_apply`, `save_profile`, `update`
(`apply` / `save` / `saving` / `saved` already existed). New `cellular` key:
`band_locking.actions.lock_selected`. **Pass a translated `label`; an English literal is a bug.**

### Known gap — three cards remount the flash away (pre-existing, NOT fixed here)

`components/local-network/ttl-mtu-settings/ttl-settings-card.tsx`,
`components/local-network/ttl-mtu-settings/mtu-settings-card.tsx` and
`components/system-settings/system-settings-card.tsx` each mount their inner form with a `key` derived
from live data (e.g. `` `${data.isEnabled}-${data.ttl}-${data.hl}` ``), and call `useSaveFlash()`
**inside** that keyed form. A successful save triggers a silent re-fetch whose `setData(...)` changes
the key, remounting the form and destroying the `saved` state at or immediately after `markSaved()`.
So the "Saved!" leg of the flash likely never renders on those three cards — only the toast does.

Verified pre-existing: the save-flow change touched two lines in each of the first two files (a
`useTranslation` import and a label) and did not touch `system-settings-card.tsx` at all. **The fix is
to hoist `useSaveFlash` above the keyed boundary in all three cards**, which is a separate, unscoped
change. Recorded here so the next person does not re-derive the diagnosis.

> ⚠️ WARNING: none of this was seen on screen. The dev server redirects to `/setup/` without a backend,
> so no authed route could be loaded or screenshotted. `tsc`, `next build` (49/49 pages), `icons:check`
> and `i18n:check` all pass — and all four pass on a broken layout, since none of them render a page.
> **The grid-stack width lock in particular is mechanism-proven and visually unreviewed.**

---

## Contracts a future edit must not drop

All silent failures. Each one compiles, renders, and is wrong.

| Contract | Where | What breaks without it |
|----------|-------|------------------------|
| `useLayoutEffect` for the tick registration | `hooks/use-value-tick.ts` | The microtask drain runs before registration and every value fires alone — the pre-cascade flash, with no error |
| Read computed opacity **before** `cancel()` | `hooks/use-value-tick.ts` | `cancel()` reverts to opacity 1, so the retarget always reads 1 and an interrupted dip snaps to full |
| `fill: "backwards"` | `hooks/use-value-tick.ts` | The node paints its resting state through the rank delay: pop, freeze, then dip |
| `TickGroup` renders no DOM | `components/ui/tick-group.tsx` | Adding a wrapper element would inject a box into every grouped card's flex/grid layout |
| `MAX_RANK` clamp | `components/ui/tick-group.tsx` | An oversized group grows a tail that can outlive the poll that started it |
| `TickingValue`'s `value` prop takes the **raw datum**, not the formatted string | `components/ui/ticking-value.tsx` | `-78` re-rendering as `-78` would tick every poll to announce that nothing happened |
| `AnimatePresence` around the swapping label | via `SwapLabel` | Half a crossfade: the outgoing label vanishes in one frame |
| Glyph **inside** `SwapLabel` | every chip call site | The one channel that separates these tones in greyscale snaps while the fill morphs |
| `sr-only` name **outside** `SwapLabel` | every chip call site | `popLayout` doubles the accessible name for 180ms on each change |
| Swap key encodes text **and** variant where both can move | every chip call site | A tone-only change animates nothing |
| All three `SaveButton` layers stay mounted in one grid cell — **no `AnimatePresence`** | `components/ui/save-button.tsx` | The width lock collapses on the frame it exists to cover; `w-fit` callers shrink to their padding |
| `aria-disabled` + `onClick` guard, never `disabled` | `components/ui/save-button.tsx` | A keyboard user loses focus to `<body>` for the length of the save |
| No `aria-live` on the save button | `components/ui/save-button.tsx` | Every save double-announces, because the sonner toast beside it is already a live region |
| `SaveButton`'s `label` is a `t()` result | every save call site | The resting state reverts to English mid-flow in four of five locales |
| `useSaveFlash` called **above** any data-derived `key` boundary | the three cards in Part 3's Known gap | The remount destroys `saved` and the "Saved!" leg never renders |

## Related docs

- [dashboard-chart-cards.md](dashboard-chart-cards.md) — the other dashboard motion contract (the
  recipe-16 chart draw-in and the entrance-vs-poll two-clock split in `hooks/use-chart-motion.ts`)
- [carrier-aggregation.md](carrier-aggregation.md) — the card that carries both the `--meter-index`
  fill cascade and a `TickGroup`
- [recent-activities.md](recent-activities.md) — the header chip that now uses `SwapLabel`, and the
  Age-Gated Tone Rule behind its tone
- [icon-system.md](icon-system.md) — why every status chip carries a glyph in the first place, and the
  route-agnostic rule that pins `SaveButton`'s check to lucide
- [i18n.md](i18n.md) — the parity gate that graded the save button's 16 hardcoded English labels, and a
  98-key English-only regression, as silence
- `DESIGN.md` > Motion > "Live value tick" and "Status chip swap"; > Motion > "Row cascade" for the two
  entrance steps this one is deliberately *not*
