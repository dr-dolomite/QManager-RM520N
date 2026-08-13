import type { Variants, Transition } from "motion/react";

// =============================================================================
// QManager Motion System — the project's single source of truth for motion.
// =============================================================================
// Every animation in the app settles on the same curves, drawn from the same
// duration scale, so the whole product feels like one instrument. Reach for
// these tokens before writing a bespoke transition, and add new shared motion
// here rather than re-deriving a curve locally.
//
// Character (per DESIGN.md > Motion): expressive in duration and curve, and
// still settled. The expressiveness comes from the easing, never from
// overshoot, which is what keeps it compatible with a tool whose job is holding
// a connection alive. The one sanctioned exception in the entire product is the
// save-confirmation check at 1.03 scale. Never springy, never elastic.
//
// These values mirror the CSS custom properties in `app/globals.css`
// (--ease-emphasized, --ease-standard, --duration-*, --stagger-step). The CSS
// layer is authoritative for anything styled in a class; this module exists
// because `motion/react` transitions need the same values as JS numbers. If you
// retune one layer, retune the other in the same change, or the product drifts
// apart curve by curve.
//
// Reduced motion is handled globally by `<MotionConfig reducedMotion="user">`
// in `components/motion-provider.tsx`, so every motion/react component below
// automatically collapses transform movement (keeping opacity) for users who
// ask for it. Keep variants here pure transform + opacity so that one switch
// stays sufficient. Raw CSS keyframes carry their own
// `@media (prefers-reduced-motion: reduce)` block beside them in globals.css.
// =============================================================================

// -----------------------------------------------------------------------------
// Easing
// -----------------------------------------------------------------------------

/**
 * The expressive curve: a deliberate departure and a long settle. Owns
 * container size and shape changes, the aggregation chain re-proportioning, and
 * alert arrival — the moments that should be felt before they are read.
 *
 * Mirrors `--ease-emphasized`.
 */
export const EASE_EMPHASIZED = [0.05, 0.7, 0.1, 1] as const;

/**
 * The everyday curve, and the right default for a state change. Owns the nav
 * indicator, card entrance, meter fill, chip container morph, and the page
 * entrance in `components/app-layout.tsx`.
 *
 * Mirrors `--ease-standard`.
 */
export const EASE_STANDARD = [0.2, 0, 0, 1] as const;

/**
 * The short curve, for moves too brief to need shaping. Owns label swaps, live
 * value ticks, hover tints and focus rings. A plain ease-out, deliberately:
 * below ~180ms a bespoke cubic is indistinguishable from the built-in.
 *
 * Mirrors `--ease-quick`.
 */
export const EASE_QUICK = "easeOut" as const;

/** CSS-string equivalents, for Tailwind arbitrary values and plain transitions. */
export const EASE_EMPHASIZED_CSS = "cubic-bezier(0.05, 0.7, 0.1, 1)";
export const EASE_STANDARD_CSS = "cubic-bezier(0.2, 0, 0, 1)";

// -----------------------------------------------------------------------------
// Duration scale (seconds)
// -----------------------------------------------------------------------------

/**
 * Three steps, and they are the only durations product motion should use.
 * Seconds here because `motion/react` takes seconds; the CSS side of each value
 * is the matching `--duration-*` custom property, in milliseconds.
 *
 * ## Why these are 2x the Motion Guide's printed figures
 *
 * The guide's token table reads 400 / 300 / 180ms, and for a long time so did
 * this file. Those are the numbers the guide *renders at 1x* — but every demo in
 * it is authored as `calc(<loop> * var(--sp))`, where a Playback control sets
 * `--sp` to `1 / speed`. Playback exists because, in the guide's own words,
 * half or quarter speed "is the only way to actually inspect a 180ms token".
 *
 * Reviewed at that 0.5 setting — which is precisely this scale, every duration
 * doubled — the system read as deliberate rather than snappy, and that is the
 * pace the product ships at. So the guide's figures are the inspection
 * baseline; these are the shipped scale. DESIGN.md > Motion is canonical and
 * says the same thing.
 *
 * The ratios are untouched, which is the part that matters: quick : standard :
 * emphasized is still 3 : 5 : 6.67, so every gesture composed from them (the
 * tick's dip/settle split, the chart's lead-follow trail) keeps its shape.
 *
 * The ambient loop (2s, service rings and the live ping dot) is deliberately
 * absent, and deliberately NOT doubled — it is CSS-only, lives on
 * `--duration-ambient`, and nothing in JS should be starting a continuous
 * animation. A loop is not a transition: at 4s a breathing ring stops reading
 * as "alive" and starts reading as "stuck".
 *
 * ## `quick` is load-bearing for input latency, not just for short gestures
 *
 * The CSS side of `quick` is also the exit clock for every modal surface
 * (`dialog`, `alert-dialog`, `sheet` — content and scrim alike). That is not a
 * stylistic pairing: Radix pins `pointer-events: none` on `<body>` for as long
 * as a modal layer is mounted and `<Presence>` keeps it mounted until
 * `animationend`, so a modal's exit duration is literally how long the whole
 * page ignores clicks after the user closes it. Both dialogs shipped an
 * unqualified `emphasized` and cost 800ms of dead input per close.
 *
 * So if this scale is ever raised again, `quick` is the step to check first,
 * and DESIGN.md > The Modal-Exit Rule is the constraint it has to satisfy —
 * the same way `TICK` above is the step to check against the poll cadence.
 */
export const DUR = {
  /** Label swaps, live value ticks, hover tints, focus rings. */
  quick: 0.36,
  /** Most state changes: card entrance, meter fill, nav, page entrance. */
  standard: 0.6,
  /** Container size and shape, aggregation re-proportion, alert arrival. */
  emphasized: 0.8,
} as const;

/** The card-cascade step. Mirrors `--stagger-step` (120ms). */
export const STAGGER_STEP = 0.12;

// -----------------------------------------------------------------------------
// Composed gestures
// -----------------------------------------------------------------------------

/**
 * The live value tick (Motion Guide recipe 06), as a *composition* of two
 * tokens rather than one.
 *
 * The guide files the tick under `quick`, and the shipped implementation read
 * that as "the whole gesture lasts 180ms". But a dip-and-return is two legs, so
 * one `quick` budget bought 90ms each way — under the ~100ms floor where the eye
 * reads a transition as a transition at all. The result was the blink the guide
 * spends its own copy warning against.
 *
 * The guide's own demo is the tell: `mg-tick` puts the dip at 12% of its cycle
 * and spends the remaining 88% returning. It is deliberately ASYMMETRIC — the
 * dip is the event, the return is the settle — and collapsing the recipe into a
 * single duration is what threw that away.
 *
 * So: one scale step down (the leg that carries the signal), the next step up
 * (the leg that lets it land). No fifth token, and the ratio is derived from the
 * scale rather than dialled in by eye.
 *
 * **The pair was raised one step, from `quick`+`standard` to
 * `standard`+`emphasized`.** The asymmetry is the spec; the absolute numbers
 * ride the scale. Under the 2x retune that lands the gesture at 1.4s.
 *
 * **This is the tightest thing in the motion system against the poll, so it is
 * the one to watch.** Worst case is a full `TickGroup` cascade: `MAX_RANK` (7)
 * × `TICK_STAGGER_STEP` of lead, plus one whole dip — 1400 + 1400 = 2800ms.
 * Measured poll cadence is ~3.7-4.0s (NOT the ~2s the Motion Guide assumes; the
 * poller's `sleep 2` runs after the cycle body, so the real interval is roughly
 * double the nominal one). That leaves ~900ms of headroom where the pre-retune
 * scale had ~2.3s. Still inside one cycle, so the anti-queue rule holds
 * unchanged — a value that moves again mid-dip retargets rather than waiting —
 * but this is now the first thing that would break if the scale went up again
 * or the poller got faster. Re-check this arithmetic before either.
 */
export const TICK = {
  /** Peak dip. The guide's 35%, unchanged — this was never the problem. */
  opacity: 0.35,
  /** 600ms + 800ms. Total wall time of the gesture, in seconds. */
  duration: DUR.standard + DUR.emphasized,
  /** Where the dip sits: 600 / 1400 ≈ 0.43. Derived, so it cannot drift. */
  dipOffset: DUR.standard / (DUR.standard + DUR.emphasized),
} as const;

/**
 * The step between two figures' dips inside one `TickGroup`
 * (components/ui/tick-group.tsx). A third stagger step, and the only one that is
 * not an entrance.
 *
 * DESIGN.md's "exactly two stagger steps" rule governs *entrances* — content
 * arriving, where the card/row steps keep a card from reading as still loading.
 * A tick cascade is the opposite situation: nothing is arriving, the whole card
 * is already on screen and settled, and the cascade's only job is to be legible
 * as a sequence rather than as a flash. At the row step a four-value cascade
 * spans less than the dip itself, so the dips overlap almost completely and the
 * group still reads as simultaneous.
 *
 * This step rides the 2x scale with everything else, because the constraint
 * that set it is a RATIO to the dip rather than an absolute number of
 * milliseconds — holding it at 100ms while the dip doubled would have re-created
 * the exact merging it was introduced to fix. The floor is ~1/8th of
 * `TICK.duration`, below which consecutive dips merge; the ceiling is set by the
 * poll, and that arithmetic now lives on `TICK` above, where it is the binding
 * constraint for the whole system. Recipe 06's demo stages its values
 * 350ms apart, which is a 2s *looping* showcase spacing three dips for
 * isolation — legibility spacing, not a product value, and at that step a
 * five-value cascade would outlive its own poll.
 */
export const TICK_STAGGER_STEP = 0.2;

/**
 * Meter fill on FIRST PAINT (Motion Guide recipe 07).
 *
 * Distinct from `transitionStandard`, which still owns the poll retarget, and
 * the split is the point. A first paint travels 0 → full; a retarget moves a few
 * percent. Giving both the same `standard` clock is what made the fill read as a
 * snap: Material scales duration with distance, and this is the longest journey
 * a meter ever makes. `emphasized` is the top of the existing scale, so the
 * arrival gets the system's slowest curve without inventing a sixth value.
 */
export const transitionMeterFill: Transition = {
  duration: DUR.emphasized,
  ease: EASE_EMPHASIZED,
};

/**
 * The row-cascade step, for rows *inside* one card rather than cards across a
 * page. Deliberately denser: a cascade's total length is the step times the
 * child count, and a card holding a dozen metric rows would take most of a
 * second to finish at the card step, which reads as the card still loading.
 * The eye also groups rows inside a shared border as one object, so they should
 * arrive nearly together.
 */
export const STAGGER_STEP_ROWS = 0.08;

/**
 * How many rows deep a list cascade still staggers before every later row
 * shares the last one's delay.
 *
 * An unbounded `index * step` is fine for a metric card with six rows and wrong
 * for a log viewer with two hundred: row 180 would wait 14 seconds to appear,
 * which is not choreography, it is a bug. Ten is where the eye stops reading the
 * sequence as a sequence anyway, and it sits under the Motion Guide's "don't
 * cascade more than about eight items" without contradicting it — the guide's
 * eight is about how many should *feel* staggered, this is the hard stop.
 */
export const ROW_CASCADE_MAX_INDEX = 10;

/**
 * The entrance delay for the Nth row of a list, in seconds.
 *
 * This existed as a copy-pasted `Math.min(index * 0.04, 0.4)` in eight separate
 * cards (activity feeds, log viewers, peer lists, ping entries, scan results),
 * each with its own slightly different step and cap — 0.03/0.4, 0.04/0.4,
 * 0.05/0.35 — none of which read a token. Both numbers now derive from
 * `STAGGER_STEP_ROWS`, so a retune of the scale moves every list at once and
 * the cap can never drift out of proportion with the step again.
 */
export function rowCascadeDelay(index: number): number {
  return Math.min(index, ROW_CASCADE_MAX_INDEX) * STAGGER_STEP_ROWS;
}

// -----------------------------------------------------------------------------
// Prebuilt transitions
// -----------------------------------------------------------------------------

/** The everyday transition: standard curve at the standard duration. */
export const transitionStandard: Transition = {
  duration: DUR.standard,
  ease: EASE_STANDARD,
};

/** The expressive transition, for size, shape and arrival. */
export const transitionEmphasized: Transition = {
  duration: DUR.emphasized,
  ease: EASE_EMPHASIZED,
};

/**
 * `dnd-kit`'s sortable transition, on this scale.
 *
 * `useSortable` defaults to `{ duration: 200, easing: "ease" }` and writes the
 * result out as an inline `style.transition` string, so a reorder animates at
 * 200ms on a curve that is not one of the three in this file — a One-Scale
 * violation nobody typed, and one that would survive a retune of everything
 * else. It is the only place in the product where a third-party hook authors a
 * duration on our behalf, which is exactly why the conversion belongs here
 * rather than at the call site: dnd-kit wants MILLISECONDS and a CSS easing
 * STRING, and both of those translations should be written once.
 *
 * `standard` is the right step by the same reasoning as everywhere else — a row
 * settling into a new rank is an everyday state change, not a container
 * reshaping itself.
 */
export const SORTABLE_TRANSITION = {
  duration: DUR.standard * 1000,
  easing: EASE_STANDARD_CSS,
} as const;

// -----------------------------------------------------------------------------
// The save-confirmation check (Motion Guide recipe 15)
// -----------------------------------------------------------------------------

/**
 * The one sanctioned overshoot in the entire product, as a NUMBER rather than a
 * sentence.
 *
 * The header of this file and DESIGN.md > The No-Overshoot Rule both already
 * promised "1.03 on the save check, and nothing else". A ceiling that lives only
 * in prose is not a ceiling: the shipped button ran an underdamped spring
 * (`stiffness: 400, damping: 22`), whose peak is a function of its constants and
 * is not bounded by anything at all. Exporting the number is what makes the rule
 * checkable — anything that wants the pop imports it, and a second overshoot
 * anywhere else has to be written out in the open.
 */
export const SAVE_CHECK_OVERSHOOT = 1.03;

/**
 * The pop itself: in from 0.4, past the ceiling, and settled at rest. A keyframe
 * list, not a spring, precisely so the peak is the constant above rather than an
 * emergent property of two dial settings.
 */
export const SAVE_CHECK_KEYFRAMES = [0.4, SAVE_CHECK_OVERSHOOT, 1];

/**
 * `standard`, matching the guide's own demo (`animation: mg-pop … var(--std)`).
 * The 0.55 midpoint spends slightly more of the budget on the arrival than on
 * the settle, so the overshoot reads as a landing rather than as a bounce.
 */
export const transitionSaveCheck: Transition = {
  duration: DUR.standard,
  ease: EASE_STANDARD,
  // Mutable on purpose: `motion/react` types `times` as `number[]`, so an
  // `as const` tuple here fails to assign. Matches the other exports above,
  // which are all annotated `Transition` rather than frozen.
  times: [0, 0.55, 1],
};

// -----------------------------------------------------------------------------
// Variants
// -----------------------------------------------------------------------------

/**
 * Card cascade container — the parent of a card's content groups or a list.
 * Children settle in sequence one `STAGGER_STEP` apart. Pair with `staggerItem`
 * on each direct child.
 *
 * Don't widen this beyond the scale. The step is already the point at which the
 * last card in a cascade feels late behind a slow poll, which reads as the page
 * still loading rather than as choreography — at eight items (the guide's
 * cascade ceiling) the tail now lands ~840ms after the first card starts.
 */
export const staggerContainer: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: STAGGER_STEP },
  },
};

/**
 * Row cascade container — the dense sibling of `staggerContainer`, for a list
 * of rows within a single card (metric rows, test results, band rows, activity
 * entries). Same children, tighter step.
 *
 * Choosing between the two: if the children are cards, use `staggerContainer`;
 * if they are rows sharing one card's border, use this.
 */
export const staggerRows: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: STAGGER_STEP_ROWS },
  },
};

/**
 * Card cascade item — content rises 10px into place on the standard curve. This
 * is the most-used entrance in the product and dozens of surfaces consume it by
 * reference, so its curve *is* the app's entrance feel. Change it here and the
 * whole app retunes at once.
 */
export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: DUR.standard, ease: EASE_STANDARD },
  },
};

/**
 * Row cascade item — the in-card sibling of `staggerItem`, and the child that
 * pairs with `staggerRows`. Same curve and duration; the rise is 5px rather
 * than 10px.
 *
 * The shorter travel is not a taste call. Rows inside one card sit at ~6px
 * spacing, so a 10px lift moves each row past its own neighbour's resting
 * position and the group reads as the card reflowing rather than as content
 * arriving. Cards sit in a 16px page gutter, where 10px still reads as a lift.
 *
 * Choosing between the two, restated from `staggerContainer`/`staggerRows`: if
 * the children are cards, `staggerItem`; if they are rows sharing one card's
 * border, this.
 */
export const staggerRowItem: Variants = {
  hidden: { opacity: 0, y: 5 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: DUR.standard, ease: EASE_STANDARD },
  },
};

// The route transition is deliberately NOT defined here. `components/app-layout.tsx`
// implements it inline, keyed on `pathname`, because it is a single site that
// needs no shared definition. It is enter-only by design: DESIGN.md forbids an
// exit animation on navigation, since the outgoing page is already gone and
// animating it out only delays the incoming one. A `pageVariants` export used to
// live here carrying both the retired curve and exactly that forbidden exit. It
// had no consumers, so it was removed rather than retuned.
