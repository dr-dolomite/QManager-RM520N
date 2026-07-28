# Dashboard State-Change Motion

Two gestures that fire when the modem reports something new, and that live in shared primitives rather
than in the cards that use them: the **live value tick cascade** (Motion Guide recipe 06 — a number
dips when it moves, and a card full of numbers dips in sequence) and the **status chip morph**
(recipe 05 — a chip's fill and its label change on two different clocks). Both were shipping with one
half of the gesture missing, in ways nothing in TypeScript or the build could catch. This note records
what the two primitives guarantee, which alternatives were rejected on measured evidence, and the
contracts a future edit must not quietly drop.

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
| Cascade step | `STAGGER_STEP_ROWS` (40ms) from `lib/motion.ts` — the **row** step, not the 60ms card step |
| Cascade clamp | `MAX_RANK = 7` in `tick-group.tsx` |
| Tick shape | `TICK` in `lib/motion.ts` — 480ms total, dip to 35% at 37.5% of the run |
| Reference chip implementation | `components/dashboard/network-status.tsx` |
| Design canon | `DESIGN.md` > Motion > "Live value tick" and "Status chip swap" |

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
   `member.start(rank × 40ms)`.

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
by how many figures changed — typically three to five, so a ≤160ms tail — whichever ones they were.

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

#### 4. The step is 40ms (the row step), not 60ms and emphatically not 350ms

`DESIGN.md` is explicit that the product has exactly two stagger steps and that the denser one owns
"rows inside one card's border" — which is precisely what these values are. The cascade therefore
reuses `STAGGER_STEP_ROWS` rather than minting a third step.

Recipe 06's demo stages its values **350ms** apart, and that number will look authoritative to anyone
who re-reads the mock. It is not a product value: the demo is a **2s looping** showcase spacing three
dips far enough apart to be legible in isolation, and the Motion Guide's own Don'ts cap stagger at
60ms. Its offsets are legibility spacing.

> ⚠️ WARNING: Do not "restore" the mock's 350ms. At 350ms a five-value cascade runs 1.4s, which is
> longer than the poll interval that produced it — the next poll would land mid-cascade, permanently.

Rank is clamped at `MAX_RANK` (7), so a group past the guide's ~8-item cascade ceiling shares the tail
slot instead of growing an unbounded tail.

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
> `TickGroup` staggers the value **dip** at the 40ms *row* step, on every poll. Different step,
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

## Related docs

- [dashboard-chart-cards.md](dashboard-chart-cards.md) — the other dashboard motion contract (the
  recipe-16 chart draw-in and the entrance-vs-poll two-clock split in `hooks/use-chart-motion.ts`)
- [carrier-aggregation.md](carrier-aggregation.md) — the card that carries both the `--meter-index`
  fill cascade and a `TickGroup`
- [recent-activities.md](recent-activities.md) — the header chip that now uses `SwapLabel`, and the
  Age-Gated Tone Rule behind its tone
- [icon-system.md](icon-system.md) — why every status chip carries a glyph in the first place
- `DESIGN.md` > Motion > "Live value tick" and "Status chip swap"; > Motion > "Row cascade" for the
  40ms step this reuses
