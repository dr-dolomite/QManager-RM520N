# Cellular Settings Family

> **Applies to:** RM520N-GL (SDX65) · verified 2026-08
> **RG501Q-EU (SDX55):** unverified — see [`platform-matrix.md`](./platform-matrix.md)

> The five routes under `/cellular/settings/` share one geometry-and-tone contract (`components/cellular/settings/shapes.ts`) rather than each hand-rolling its own card. This doc covers that shared contract and the four surfaces that adopted it in the 2026-08-13 rebuild — **APN Management**, **Network Priority**, **IMEI Settings**, and **Blocked Networks (FPLMN)**. The fifth route, `/cellular/settings` itself, has its own doc: [cellular-basic-settings.md](cellular-basic-settings.md).

Nothing in that rebuild touched a CGI script, a systemd unit, the installer, or the poller. Every backend contract below is pre-existing and unchanged; what changed is which of it the UI is honest about.

> ℹ️ NOTE: **Why this is a separate doc.** `cellular-basic-settings.md` documents one route's *backend* — six writable fields, one CGI endpoint, an AT compound, a poller block. `shapes.ts` was born there, but it now governs five routes with five unrelated backends, so folding four more surfaces into that file would have made it the family doc under a name that promises a single page. This doc owns what is *shared*; each surface's backend contract stays where it already lived.

---

## Quick Reference

| Route | Component root | Backend | Doc for the backend |
| ----- | -------------- | ------- | ------------------- |
| `/cellular/settings` | `components/cellular/settings/` | `cellular/settings.sh` | [cellular-basic-settings.md](cellular-basic-settings.md) |
| `/cellular/settings/apn-management` | `…/apn-management/` | `cellular/apn.sh`, `cellular/mbn.sh` | [wan-profile-management.md](wan-profile-management.md) |
| `/cellular/settings/network-priority` | `…/network-priority/` | `cellular/network_priority.sh` | this doc |
| `/cellular/settings/imei-settings` | `…/imei-settings/` | `cellular/imei.sh` | this doc |
| `/cellular/settings/fplmn-settings` | `…/fplmn-settings/` | `cellular/fplmn.sh` | this doc |

| Thing | Where |
| ----- | ----- |
| Geometry + tone contract | `components/cellular/settings/shapes.ts` |
| Motion tokens | `lib/motion.ts` (incl. `SORTABLE_TRANSITION`) |
| Shared page header | `components/cellular/page-header.tsx` |
| Shared full-body condition | `components/cellular/condition-screen.tsx` |
| Shared save bar | `components/cellular/settings/pending-save-bar.tsx` |
| Shared setting row | `components/cellular/settings/setting-row.tsx` |
| i18n namespace | `cellular` → `core_settings.{apn,network_priority,imei,fplmn}.*` |

### `shapes.ts` exports added by this change

| Export | Used by |
| ------ | ------- |
| `REORDER_ROW` | Network Priority's draggable rank rows |
| `RANK_PILL`, `RAT_RANK_TONE` | Network Priority's rank numeral |
| `CHOICE_ROW` | APN Management's MBN bundle list |
| ~~`FIELD_INPUT`~~ | **No longer exported** as of 2026-08-30 — it is module-private, and the two `FIELD_SHELL` composites below are the API |
| `FIELD_SHELL` | IMEI Settings (both cards), APN Management. Its `FIELD_SHELL_ON_FILL` twin was **deleted** with the row promotion on 2026-08-30 — the identically-named export still in `components/cellular/sms/shapes.ts` belongs to the SMS family and is unrelated |
| `INLINE_ERROR` | Inline validation copy on a plain card |
| `SECTION_DIVIDER` | A rule *between sections inside* a card |
| `READOUT_ROW.GRID` | APN Management's "What the network granted" strip |
| `EMPTY_BLOCK` | **Renamed** from `AMBR_EMPTY` — it is no longer AMBR-specific |

### `shapes.ts` changes from the 2026-08-30 basic-settings re-authoring

That change was frontend-only and scoped to `/cellular/settings`, but it edits the file all five routes import, so the export list moved.

| Export | Change | Why it matters here |
| ------ | ------ | ------------------- |
| `STRIP` | **Added** | Band A's tile geometry and disc fills. Identity colour is confined to the `DISC_*` keys, and there is no `tone` prop that could tint a tile body |
| `RATE_CEILING` | **Added** | Band A2's summary line and disclosure panel |
| `SEGMENTED.GLYPH_ACTIVE` / `.GLYPH_RESERVED` | **Added** | The reserved-glyph rule below — a layout contract, not a decoration |
| `SEGMENTED_BREAKPOINTS["5xl"]` | **Added** | A fourth step at 64 rem / 1024 px, reachable through `segmentedBreakpoint("5xl")` |
| `FIELD_INPUT` | **`export` removed** | Module-private now. Nothing outside `shapes.ts` imported it — the two `FIELD_SHELL` composites are what call sites use, and they kept their importers |
| `HERO_SHELL`, `HERO_PAD`, `HERO_RAIL`, `HERO_RAIL_TONE`, `HERO_BODY`, `HERO_BODY_CELL`, `HERO_BODY_PARAMS_CELL`, `HERO_FOOTNOTE`, `HERO_PARAMS` | **Deleted** | Their only consumer, `ModemHeroCard`, is deleted. See [cellular-basic-settings.md](cellular-basic-settings.md) |
| `PAGE_TITLE`, `PAGE_DESCRIPTION` | **Deleted** | Consumerless — `CellularPageHeader` owns the page type scale |

> ⚠️ WARNING: **`READOUT_ROW` was deliberately KEPT and must not be swept as dead code.** It looks unused from `/cellular/settings` — that route stopped rendering readout rows when the hero went — but it has **three live consumers in sibling routes** that were out of scope for that change:
>
> - `components/cellular/settings/apn-management/apn-settings.tsx`
> - `components/cellular/settings/imei-settings/imei-settings-card.tsx`
> - `components/cellular/settings/imei-settings/imei-tools-card.tsx`
>
> This is the standing hazard of a shared shape module: "no consumer on the page I am looking at" is not "no consumer". Grep the whole `components/cellular/settings/` tree before deleting any export here.

A comment correction rode along: `shapes.ts` claimed the basic-settings page held **three** segmented controls. It holds **six** — three rows in each of two section cards — and that number is load-bearing, because it is why the thumb's `layoutId` must be instance-scoped (`React.useId()`) rather than a module constant.

---

## The shared contract

### Rows stay neutral, dirty or not — the delta chip is the sole indicator

> ⚠️ WARNING: **Retired 2026-08-30.** Until then, a setting row with an unsaved edit got `bg-primary-container text-on-primary-container` — "promotion", reasoned as *the brand acting*. That reasoning was sound on its own, but it duplicated a signal the row already carried: `SETTING_ROW_DIRTY.DELTA_CHIP` ("SIM 1 → SIM 2") is itself `bg-primary`, so a dirty row said "this is pending" twice — once on the chip, once again on its own body. User-flagged on `/cellular/settings`'s SIM Slot row and closed product-wide (all five routes share `SETTING_ROW`), per Product Principle 4 rather than as a one-page exception. See [DESIGN.md](../../DESIGN.md)'s Migration Deltas for the landed entry.
>
> Rows now render identically in both states. `dirty` still exists on `SettingRow` — it gates the chip's text and a `data-dirty` attribute — but no longer touches the row's own classes. **Re-verified 2026-08-31:** no `SETTING_ROW_DIRTY.ROOT` or `_ON_FILL` symbol survives anywhere in `components/cellular/settings/`. The last in-tree *justification* referencing the promotion — `apn-settings-card.tsx`'s comment explaining why its validation error is a filled chip — was corrected in the same pass: the chip stays, but because it is a message the user must act on to proceed and a filled `destructive-container` declares its own ink pair, not because a row underneath it might promote.

Every control's `_ON_FILL` twin the promotion required is **deleted along with it**: `SEGMENTED.SEGMENT_ON_FILL` / `.TRACK_ON_FILL`, `SELECT_TRIGGER_ON_FILL`, `FIELD_SHELL_ON_FILL`, and `SegmentedField`'s `onFill` prop. None of them had a reason to exist once no row can promote — a control never needs an ink pair for a container it can no longer sit on. `SETTING_ROW_DIRTY.CONSEQUENCE_ON_FILL` is the one survivor, because it turned out to also be backing an unrelated *permanent* `primary-container` accent cell (`imei-tools-card.tsx`'s IMEI check-digit breakdown) that was never conditional on dirtiness in the first place.

**No row carries a border**, still. Rows are separated by a hairline divider *inside* the group (`ROW_GROUP.DIVIDER`).

### `RATE_CHIP`: direction is not a radio

The AMBR (Aggregate Maximum Bit Rate) chips on `/cellular/settings` carry **`bg-downlink` / `bg-uplink`** fill pairs — `RATE_CHIP.ON_DOWNLOAD` and `.ON_UPLOAD` at `components/cellular/settings/shapes.ts:1064`. The radio identity still lives one layer out, in the block's own container fill (`AMBR_BLOCK.LTE` / `AMBR_BLOCK.NR`).

**They used to be `bg-primary` (download) and `bg-lte` (upload), and that was a real mistake worth not repeating.** The reasoning at the time was local and correct as far as it went: Uplink Cyan sitting inside the violet LTE block read as a discordant third accent, so the chips reached for blue and violet to match the block family. That fixed a local adjacency by **spending the two radio identity hues on a fact that is not about radios** — inside the LTE block, an upload chip then rendered in the LTE hue for reasons having nothing to do with LTE, and blue meant 5G NR, the brand, "in progress" *and* download depending on which page you were reading.

Direction now has its own axis, so the chips sit **on** the block's radio container rather than borrowing from it. A rose download chip inside a violet LTE block is legible as two independent facts instead of one muddled one. See [color-system.md](color-system.md).

Two invariants the chip carries regardless of hue:

- **The arrow glyph is the direction's second channel**, never optional. At container lightness in dark mode this system's tonal pairs collapse under red-green colour-vision simulation, so on a dark block the arrow is the information and the hue is reinforcement.
- **Fill pairs, never an alpha wash.** An earlier draft wrote `bg-lte/25`; an alpha is a different perceived lightness in each theme, where `bg-downlink` + `text-downlink-foreground` is a real pair in both. The pairs are declared in `shapes.ts`, so a consumer must **not** also set an ink class on the chip.

### `FIELD_SHELL`, and why `components/ui/input.tsx` is unusable here

Free-text fields on this family are a **raw `<input>`** carrying `FIELD_SHELL` — not the shadcn `Input` primitive.

> ℹ️ NOTE: this used to be a **pair**. `FIELD_SHELL_ON_FILL` was the twin for a promoted (dirty) row, and it went with the promotion on 2026-08-30 — no row can sit on a `primary-container` fill any more, so a second ink spelling has nothing to be correct against. One export now. An identically-named `FIELD_SHELL_ON_FILL` still exists in `components/cellular/sms/shapes.ts`; that is the SMS family's own module and is unrelated to this one.

**Short version:** `tailwind-merge` de-duplicates classes *per modifier*, so an unprefixed override cannot displace a `dark:`- or `md:`-scoped class. Both survive, and the scoped one wins wherever it applies.

The mechanism matters because the failure is invisible in review. `input.tsx` ships `dark:bg-input/30` and `md:text-sm`. Handing it `SELECT_TRIGGER`'s unprefixed `bg-surface-container-high` and text size does **not** replace those — tailwind-merge treats `bg-*` and `dark:bg-*` as different groups, keeps both, and the `dark:` rule wins in dark mode. So the field silently reverts to the primitive's fill in dark mode and to the primitive's type size above 768 px: the two axes a desktop light-mode review never looks at.

The primitive smuggles three more things past the same boundary:

| Primitive class | What it costs here |
| --------------- | ------------------ |
| `md:text-sm` | The field renders 14 px above 768 px while every sibling renders 13.5 px |
| `transition-[color,box-shadow]` with no duration | A raw Tailwind 150 ms — off the `--duration-*` scale, so it silently will not retune |
| `shadow-xs` | A cast shadow on an input, which DESIGN.md > Inputs forbids |
| `placeholder:text-muted-foreground` | A legacy token surviving in the rest state |

Overriding all of these at the call site means restating `SELECT_TRIGGER`'s own numbers as `dark:` and `md:` variants — which is the drift `shapes.ts` exists to prevent. Two independent builders hit this on two different pages in the same change and each wrote a local constant; `FIELD_INPUT` is that constant, promoted once so a third page cannot write a fourth version. It is **module-private** (`shapes.ts:807`) — call sites compose it through `FIELD_SHELL` (`:816`), which is the API.

> ⚠️ WARNING: **order inside the template literal is load-bearing.** `FIELD_SHELL` is `` `${SELECT_TRIGGER} ${FIELD_INPUT}` ``, and the two halves contribute classes to the same tailwind-merge groups, so the later one wins. The retired `FIELD_SHELL_ON_FILL` depended on exactly this to append its placeholder ink last; if a promoted-row variant is ever reintroduced anywhere, it inherits the same trap. Reordering the literal breaks it silently — there is no build error and no visual difference in the state a reviewer usually looks at.

`font-mono` on these fields is not a costume — every consumer holds an identifier the device emits verbatim (an IMEI, a TAC, an APN), and the letter-spacing is what makes fifteen undifferentiated digits scannable. The **placeholder** deliberately drops back to `font-sans`: a placeholder is human-authored instruction, not machine output, and mono'd prompt text reads as though the field were already filled.

### Skeletons import the geometry, never restate it

Every consumer, **including the loading branch**, takes its numbers from `shapes.ts` (`SETTING_ROW.HEIGHT`, `REORDER_ROW.HEIGHT`, `CHOICE_ROW.HEIGHT`, `READOUT_ROW.HEIGHT`). A skeleton that hand-writes `h-12 w-48` has left the contract. Both Network Priority and Blocked Networks shipped with skeletons whose numbers matched nothing that rendered, and Network Priority's skeleton title and its loaded title were two different string literals — a visible title swap on every load.

Blocked Networks solves this differently and correctly: its loaded body is one text block, so its "skeleton" is the **same `ConditionScreen` component** driven transient. It cannot drift, because it is the same code.

### `SegmentedField`: the reserved glyph, and the per-row breakpoint

`SegmentedField` renders a pill group above a container-query step and a `Select` below it. Both bind to the same state; the Select is not a degraded fallback, because four segments do not fit one row on a phone and shrinking them below a 44 px touch target is not an option on a surface field techs use on a tablet.

#### Every segment reserves the check glyph

**Short version: the check mark on the selected segment is rendered on *all* segments and hidden with opacity, because the selected segment is otherwise physically wider than its neighbours — and the travelling highlight animates the segment's own box.**

The thumb is a `motion.span` with `absolute inset-0`, so its box *is* the segment's box. When the glyph rendered only on the active segment, clicking one changed **both ends** of the animation while it was in flight: the glyph plus its `gap-1.5` is worth **21.7 px**, so the destination segment grew and the source shrank as the tween ran. The measured first frame was `translate3d(-266.99px, 0, 0) scale(1.13606, 1)` — the pill stretched 14 % while travelling (on `rounded-pill` that makes the caps read as ellipses) and the label you clicked slid 21.8 px out from under your cursor, un-animated.

`SEGMENTED.GLYPH_ACTIVE` and `SEGMENTED.GLYPH_RESERVED` are the pair. The reserved variant hides the glyph with **opacity and scale only**.

> ⚠️ WARNING: never `display`, `hidden`, or a conditional render. All three give the box back and reintroduce the bug. Widths after the fix run `[118.3, 108, 101.6, 104.3] → [118.6, 108, 101.4, 104.3]`; the 0.3 px residual is `data-[state=on]:font-semibold` and is deliberate, so nothing here asserts `scaleX === 1`.

The same principle governs the row underneath it: `SETTING_ROW` reserves the delta chip unconditionally (`invisible` when clean), **horizontally** — the chip rides the label's line inside `LABEL_ROW`, not a line of its own — so the row's height is dirty-independent without spending 28 px of blank between a title and its consequence line. The `min-h` floor is **5rem**. Reserve, don't animate.

#### The breakpoint travels on the row descriptor

`segmentedBreakpoint(step)` takes `"lg" | "xl" | "2xl" | "5xl"`, defaulting to `2xl` — the family default. A page overrides it per row rather than per card: `cellular-settings-card.tsx` sets `ROW_BREAKPOINT = "lg"` for the basic-settings page (its two half-width section cards would otherwise fall to a Select at desktop widths where the old single wide card showed pills), and a `RowDef` may carry `breakpoint?` to override that.

Exactly one row does. `mode_pref` — the only four-way row on the family, and the only one that renders **five** segments, because the card prepends the modem's own value when it is not in the offered list — declares `breakpoint="5xl"` (64 rem / 1024 px).

**Why a step *above* the row's own flip is the right place for a fallback.** `SETTING_ROW.ROOT` flips stacked → side-by-side at `@2xl/card` (672 px). Below that flip the control is full-width under the text and nothing competes; *above* it the two share one line, and the widest control on the surface takes the text column's share. So the squeeze band starts exactly at the flip.

Measured on the real components (card container width swept in a throwaway fixture route; text-column width / consequence lines / row height):

| Card px | `mode_pref`, 4 segments, `lg` | `mode_pref`, 5 segments, `lg` | Either, `5xl` |
| ------- | ----------------------------- | ----------------------------- | ------------- |
| 672 | 101.8 px / 3 lines / 165.9 px | **0.0 px / 6 lines / 249.4 px** | 433.4 px / 1 line / 102.8 px |
| 740 | 169.8 px / 2 lines / 123.1 px | **0.0 px / 6 lines / 249.4 px** | 501.4 px / 1 line / 102.8 px |
| 896 | 325.8 px / 1 line / 102.8 px | 152.8 px / 2 lines / 145.6 px | 657.4 px / 1 line / 102.8 px |
| 1024 | 453.8 px / 1 line / 102.8 px | 280.8 px / 1 line / 102.8 px | pills return |

A text column of literally **0 px wrapping to six lines in a 249 px row**, at widths a desktop review actually looks at, is the failure `SETTING_ROW.TEXT`'s own JSDoc warns about. It pre-existed at smaller magnitude (the four-segment track was ~386 px) and reserving the glyph widened it to 452 px, which is what made it visible.

**`@4xl` (896 px) was built, measured and rejected.** It clears the four-segment case, but the five-segment case only crosses into two lines at 870 px — 26 px of margin — and returns the pill group into a 145.6 px row, 43 px above the row's own 102.8 px floor. At `@5xl` both cases render one consequence line in a 102.8 px row at every width from the flip upward, so the control change and the row settling coincide; that is what makes the switch read as a layout decision rather than a symptom.

**The other five rows keep `lg`.** Two- and three-segment tracks are 309 px at most and are not the offender — `nr5g_mode` measured identically before and after. Demoting them would spend the pill group to fix a row that does not have the problem.

> ⚠️ WARNING: **`SEGMENTED_BREAKPOINTS`'s class strings must be spelled out verbatim.** Tailwind's scanner only compiles class names it finds literally in source, so an interpolated `` @${step}/card:flex `` produces **no rule at all**. That shipped exactly once, and every `SegmentedField` in the family silently rendered only its Select at every width. Adding a step means writing out its `GROUP` / `SELECT` / `WRAP` strings in full — and verifying them in the **built** CSS (`out/_next/static/chunks/*.css`), not by reading the source.

### Motion: `SORTABLE_TRANSITION`

`lib/motion.ts` gained one export. `dnd-kit`'s `useSortable` defaults to `{ duration: 200, easing: "ease" }` and writes it into an inline `style.transition` string — a duration and a curve that are in neither the `--duration-*` scale nor the three-curve vocabulary, authored by a third-party hook rather than by anyone in this repo. `SORTABLE_TRANSITION` performs the two conversions dnd-kit needs (milliseconds, and a CSS easing *string*) once, on the `standard` step.

It is the only place in the product where a library authors a duration on our behalf, which is exactly why the conversion belongs in `lib/motion.ts` rather than at the call site — a retune of the scale has to reach it.

---

## APN Management

Route shell: `components/cellular/settings/apn-management/apn-settings.tsx`. The backend contract (`apn.sh`, the `apn_apply.sh` attach-cycle primitive, the `/etc/qmanager/apn_setting.json` sidecar) is unchanged — see [wan-profile-management.md](wan-profile-management.md).

> ℹ️ NOTE: **Re-authored 2026-08-31, frontend-only.** No CGI script, poller field, AT command or backend type changed. The headline fix — the page-header status chip — needed **no** new data: it swapped one already-fetched source for another. What follows describes the page as it ships now.

### Three data sources, deliberately separate

| Hook | Clock | Answers |
| ---- | ----- | ------- |
| `useApnSettings` | one read on mount, re-read around a save | what is **configured** |
| `useMbnSettings` | its own | which carrier bundle is loaded |
| `useModemStatus` | the poller (client polls ~2 s; device-side cadence is ~3.7–4 s) | what the network actually **granted** |

Keeping them separate is the point: collapsing "configured" and "granted" into one source would let a stored value masquerade as a negotiated one, which is the exact class of bug the `AT+CGCONTRDP`-not-`AT+CGDCONT?` rule exists to prevent on the backend. The page's own status chip did it anyway until 2026-08-31 — see below.

### The band order is the family's grammar

Three full-width bands under the page header. **Live state → what you can change → the commit**, which is the order `/cellular/settings` ships and is the reference implementation for.

| Band | Card | Clock | Inside the override `<fieldset>`? |
| ---- | ---- | ----- | --------------------------------- |
| A | What the network granted | poller | No |
| B | APN configuration | settings GET | **Yes** |
| C | Carrier bundle (MBN) | its own GET | No |

- **Band A leads.** It is the only thing on the surface that can answer "is my connection actually dialling the APN I think it is". It used to render **last**, behind the heaviest card on the page.
- **Band C left the fieldset** (bug fix). The override gate fires on `profile.settings.apn.name` being non-empty, so a SIM profile owning the APN was disabling the carrier-bundle picker — a control no profile manages and the profile system has nothing to say about. `overrideUndetermined` was dropped from MBN's loading gate at the same time: MBN has no reason to wait on a profile verdict.
- **Band A was always outside it,** on purpose. A profile owning the APN does not make the network's answer less true, and dimming live truth to 60 % opacity would be the page hiding the one thing still worth reading.
- **There is no two-column grid.** `PAGE_GRID`'s `1.35fr / 1fr` was inherited from `/cellular/settings`, and its JSDoc justifies the ratio by a right column ("AMBR + modem reports") that no longer exists anywhere. These cards have unrelated clocks, unrelated weights and different gating — [DESIGN.md](../../DESIGN.md) > Layout: *split a page by cadence, not by symmetry*.

> ℹ️ NOTE: **`PAGE_GRID` is gone as of 2026-08-31.** It survived this change only because `imei-settings.tsx` was still consuming it; the IMEI design-language adoption replaced that call site with `WORKBENCH_SPLIT`, whose justification names the columns it actually has. (It shipped with `items-start`; the 2026-08-31 layout pass replaced that with an explicit `grid-rows-[auto_1fr]` row template — see *The row template, and why `items-start` was not the fix* below.) With its last consumer gone, `PAGE_GRID` was deleted rather than left exported — same disposal as `PAGE_TITLE` / `PAGE_DESCRIPTION` above. `CARD_CELL` stays: it still has real consumers on `/cellular/settings` itself, where the two cards genuinely are peers.

A resting **"Re-read from modem"** footer (`readout.reread`) calls `refresh()` + `refreshMbn()`. Before this change `refresh` was wired but reachable **only** from inside the error banner — the affordance existed exactly when the page had already failed. It is hidden while `isLoading || isSaving || isReconciling`, so it cannot contradict the card's own save bar.

> ℹ️ NOTE: **No "read N seconds ago" stamp, deliberately.** The approved mock drew one beside that footer. This page's writable half is not polled, so the number would count from a fetch the user cannot see. Staleness *is* reported — but as the poller's own `isStale` boolean, not as an elapsed-seconds clock. Do not add the counter back.

### The page-header status chip verifies against `+CGCONTRDP`

> ⚠️ WARNING: **Until 2026-08-31 this chip compared configuration against configuration.** `useApnStatusChip` derived its live/not-live verdict from `cids.find((c) => c.cid === activeCid)?.apn`. `cids[]` is not a reading — `apn.sh:407-408` derives it from the `AT+CGDCONT?` loop with no extra AT calls, and `AT+CGDCONT?` merely echoes back what was last requested, **so it matches even when the bearer is stale** ([wan-profile-management.md](wan-profile-management.md) > *Verification reads `AT+CGCONTRDP`, never `AT+CGDCONT?`*). That comparison is self-concealing, it was already the root cause of the profile worker's silent-failure bug on the backend, and the one chip on this page claiming to report "is it live" was running it again — while rendering a green `success` **Active** over the top.

It now reads `status.network.apn`, the poller's `+CGCONTRDP`-derived **negotiated** value, from a source that cannot echo the request back. The frontend and the backend now hold the same verification rule.

**The branches are ordered, and the order is load-bearing:**

| # | Condition | Variant | Glyph | Key |
| - | --------- | ------- | ----- | --- |
| 0 | `active === null` | *no chip rendered* | — | — |
| 1 | `active === 0` | `muted` | `do_not_disturb_on` | `status.carrier_default` |
| 2 | `isStale` | `warning` | `schedule` | `readout.stale` |
| 3 | granted APN empty or absent | `muted` | `help` | `status.not_reported` |
| 4 | stored `===` granted (case-folded) | `success` | `check_circle` | `status.live` |
| 5 | `isSaving \|\| isReconciling` | `muted` | `help` | `status.not_reported` |
| 6 | otherwise | `warning` | `warning` | `status.not_granted` |

- **Staleness outranks the verdict** (2 before 4/6): a green "Live on the network" drawn from frozen readings is the exact lie this rewrite exists to stop.
- **It does not outrank `carrier_default`** (1 before 2): that is a settings-GET fact, and a frozen poller says nothing about whether a custom APN is configured.
- **The disagree verdict is suppressed mid-write** (5 before 6). An attach cycle legitimately reports the old granted APN while it runs, so the chip stands down to "we cannot say" rather than accusing. The incumbent fell through to `success` here, which is a claim, not a suspension.
- **Comparison is case-folded**, matching the backend's own `tr 'A-Z' 'a-z'`: a live device negotiated `INTERNET.GLOBE.COM.PH` for a stored `internet`.
- **Every branch carries its own glyph.** `success-container` and `warning-container` measure 1.03:1 apart and are identical under deuteranopia, so the glyph is the separator, not the fill.
- An empty string from the poller is collapsed with `||`, not `??` — "we do not know", never "none".

### Band A — "What the network granted"

Reads `network.apn`, `network.wan_ipv4` and `network.wan_ipv6` from the poller snapshot. IPv6 goes through `compressIPv6()` from `lib/ipv6.ts`, because the modem reports IPv6 in `+CGCONTRDP` as sixteen dotted **decimal** octets, not colon-hex.

**The comparison pair.** Two blocks side by side at `@2xl/card` — *You configured* (`apn_setting.json`) and *The network granted* (`+CGCONTRDP`) — each with its own provenance line. The APN is no longer *also* a readout row below; it is one fact stated once, and `readout.serving_apn` was deleted from all five packs.

- **The tint is on the granted side only.** "What you asked for" cannot be right or wrong, so tinting it would spend a functional role on a fact with no verdict attached. Neutral `surface-container` on the left; the right block is `success-container` on agreement and `destructive-container` on disagreement.
- **A verdict needs both halves.** With either missing the granted block stays neutral and shows no mark — "we could not compare" is a third answer, not a failure.
- **A glyph and a word, never the fill alone** (`check_circle` + "Matches" / `warning` + "Does not match").
- **Eyebrow, provenance and mark set no ink.** They sit on three different fills and dim whatever the block already carries. Setting a role ink would produce the cross-pair (one role's ink on another role's container) that this family names as its most common contrast failure — same mechanism as `CHOICE_ROW.CAPTION`.

> ℹ️ NOTE: the chip and the block disagree about tone on purpose. The page-header chip's disagreement is `warning`; the granted block's is `destructive-container`. The chip is a glance-level "check this"; the block is where the user is already reading the two values against each other.

**The remaining rows** (`READOUT_ROW.GRID`, a two-up label-left/value-right grid) are Granted IP, Bearer state, IPv4, and IPv6 spanning both columns.

- **Rows, not tiles.** A `repeat(5, 1fr)` stat-tile grid was built for this data and rejected: two of the five values are a full APN and a full IPv6 (39 chars even after RFC 5952 compression), so at `1fr` of a card column the two values a technician opened the page to read are the two that truncate to noise.
- **Every unknown value degrades to an em-dash**, never to a plausible default. An empty string from the poller means "we do not know", not "none".
- **Bearer state is derived**, never asserted: "Attached" appears only when an address was actually granted.

**Frozen is not absent.** The card consumes `isStale` from `useModemStatus` (a 10 s threshold the hook has always exported and this card never received) and renders the **warning half only** — a `warning` `TonalBanner` on the `schedule` glyph, matching `live-state-strip.tsx`. There is no "live" chip: over values that are simply correct it reports nothing. It renders only when there are values to freeze (`isStale && status`); a failed read has none and takes the `destructive` banner instead. Those are different states and must not share a signal.

### `COMPARE` is module-local on purpose — do not hoist it into `shapes.ts`

The comparison pair's geometry lives in a **non-exported** `const COMPARE` inside `apn-settings.tsx`, beside the block it describes and the skeleton that mirrors it. It is single-consumer geometry with a single-consumer rationale; `shapes.ts` is the *family* contract, and moving a one-page shape there would add to a five-route import surface something no other route can use. The rule that actually matters — skeletons import the geometry rather than restating it — is satisfied without exporting anything: `COMPARE.HEIGHT` mirrors `COMPARE.BLOCK`'s resting height in the same object.

> ⚠️ WARNING: `COMPARE.HEIGHT` is `h-[6.125rem] rounded-field!` and **the `!` is load-bearing**. `cn()` is bare `tailwind-merge`, which does not know this repo's custom radius names and cannot dedupe `rounded-field` against `Skeleton`'s own `rounded-md`. Both survive into the class list and the cascade decides alphabetically — `field` sorts before `md`, so the primitive's 6 px silently wins and the skeleton stops mirroring the 20 px block. The Tailwind v4 important modifier takes the radius back. Product-wide hazard at roughly 20 call sites; this one is spelled correctly rather than adding a twenty-first.

### A save whose response the attach cycle killed is not a failure

Every write on this endpoint runs a full attach cycle — the backend brackets `AT+CGDCONT` in `AT+COPS=2` / `AT+COPS=0`. On the RM520N-GL that cycle **drops the `eth0` link for about four seconds**, so a CGI running it inline finishes its work and then has no route left to answer over. `fetch` rejects with a `TypeError` for a write that **landed**.

`save()` could not tell that apart from a refusal, so the card fired `toast.error("Failed to save APN settings")` over a successful save — and, worse, skipped `scheduleReconcile()`, leaving the page asserting the old APN indefinitely. `deactivate()` carried the identical defect: it runs `apn_apply_write <cid> <pdp> "" 1`, the same cycle.

| What came back | Meaning | `ApnSaveOutcome` |
| -------------- | ------- | ---------------- |
| a response with `success: false` | the modem refused | `"failed"` |
| a response with a non-2xx status | a real transport error | `"failed"` |
| no response at all | the expected link drop | `"reconciling"` |

`HttpStatusError` (module-private in `hooks/use-apn-settings.ts`) is what makes the third case distinguishable: a non-2xx means the server was reachable and said no; a rejection means nobody said anything. Anything that is *not* an `HttpStatusError` is treated as the link drop.

- `save` and `deactivate` return `ApnSaveOutcome` (`types/apn-settings.ts`), not `boolean` — a boolean cannot carry the third case.
- The reconciling branch **patches optimistically exactly as the success path does** and runs the existing `scheduleReconcile()` (a 1500 ms delayed silent re-read), letting the re-read decide.
- `UseApnSettingsReturn` gained **`isReconciling`**, true for the window between the optimistic patch and the re-read landing. The page consumes it in the status chip (branch 5 above) and to hide the re-read footer.
- The card toasts `toast.reconciling` ("Verifying the connection came back…") — not a success it has not earned, and not a failure that did not happen.

The save notice (`save_connection_notice`) now names the wired session, because QManager is served **by** the modem it is configuring: *"Saving detaches and re-attaches the modem. Cellular data drops for about four seconds — and if you are connected over the modem's Ethernet port, this page will drop with it and reconnect on its own."* Four seconds is the measured figure. The old copy warned only about "the cellular connection", so a technician on the modem's Ethernet port watched their own page die with no reason to believe the save had landed.

### Three states the card used to assert without having read them

1. **The never-read branch.** On `isLoading === false && apn === null` — a failed *first* read — the card fell straight past its loading branch into the form body. The APN field honestly showed a placeholder, but the IP-protocol control rendered **IPv4v6 selected** and the CID `Select` rendered **CID 1**, as confirmed-looking choices on a card that had read nothing. Those are the `useState` seeds, never a value from the modem. (`overrideUndetermined` did not guard this: it only holds the card in loading while the *profile* verdict resolves, and is false once settled regardless of the APN fetch.) The card now renders the family's `CARD_NOTICE` primitive (`shapes.ts:567` — `SETTING_ROW.ROOT`'s box composed with `SETTING_ROW.CONSEQUENCE`'s ink) carrying `cards.unread`, stated quietly, because the route shell's banner already owns the alarm and the retry. The header text is real in **all three** branches, so the card never swaps its own title on load. Only the never-read case lands here; a failed *re-read* leaves the previous snapshot in place. Rendering no control at all also closes the last route into the reserved-context fallback below.

2. **The armed deactivate button.** The gate was `active !== 0`, which is **true for `null`** — what `active` holds before the first read resolves and what it keeps when that read fails. So the button rendered, and `disabled={isSaving}` left it enabled; one press POSTed a real `COPS=2` / `COPS=0` attach cycle with a blank APN. Meanwhile `changeCount === 0` correctly disabled Save, so the card was disabling the reversible action and arming the irreversible one. It is now gated on `active === 1`: *we do not know* is not permission to detach the bearer.

3. **The reserved-context guard bypassed itself.** `handleCidChange` gated the IMS/SOS confirmation on `contexts.find(...)`, but the `Select` still offers `FALLBACK_CIDS` (1–6) when the modem has reported no contexts — so on an empty `cids[]` the lookup missed on every option and a data APN could land on the IMS or emergency context with no dialog. The guard switched itself off exactly when the page knew least about which CIDs are reserved. Two gates now: the modem's own classification when it reported one, and `FALLBACK_RESERVED_CIDS` (**CID 2 and CID 3**, the conventional IMS and emergency contexts on this hardware) when `contexts.length === 0`. The fallback path uses a **separate** key, `edit.reserved_dialog.unverified_body`, and does not reuse the IMS/SOS copy — that copy names a context type the modem reported, and here nothing was reported, so the dialog is worded as the guess it is. `pendingCid` is now `{ cid, kind: "ims" | "emergency" | "unverified" }` rather than a `CidContext`.

### The `detect_active_cid()` honesty gap — a known backend limitation

> ⚠️ WARNING: `detect_active_cid()` (`scripts/usr/lib/qmanager/cgi_at.sh:103`) **silently defaults to `"1"`** when both `AT+QMAP="WWAN"` and `AT+CGPADDR` fail to yield a CID, and the GET envelope carries **no confidence signal** to distinguish that guess from a real reading.

The frontend cannot tell a measured CID from a fallback, so the UI is worded for what is provable:

- Exactly **one** CID chip is rendered — for the CID reported as bearing the internet — rather than the comp's four chips, which would have invited a reader to treat the whole set as verified.
- Its label is **"in use for Internet"**, never "confirmed" or "verified".
- When no active CID is reported at all, the chip degrades to a muted "not reported" rather than defaulting to CID 1 in the UI as well.

**The fix is a backend one and has been scoped out of every frontend change so far:** add a confidence field to the GET envelope (e.g. `active_cid_source: "qmap" | "cgpaddr" | "default"`), so the UI can say "in use" when it is read and "assumed" when it is not. Until that lands, do not strengthen the chip's wording — `cid_in_use` and `cid_unknown` are deliberately frozen byte-for-byte.

### The MBN card

`AT+QMBNCFG` bundle selection, on its own GET's clock and **outside** the override fieldset (see the band table above). Rebuilt from two Selects to a **Switch** (automatic selection on/off) plus a promoted-row bundle list (`CHOICE_ROW`).

- **Selection is a promotion, not a radio circle.** The comp drew Material's `radio_button_checked` / `radio_button_unchecked`; neither glyph is in the font subset, and adding them means a Google Fonts round-trip plus a committed binary for an affordance this system already expresses better. The chosen row *is* a `primary-container` block — readable across the card, and it survives grayscale.
- **The list is a real `role="radiogroup"`** with roving tabindex: exactly one row is tabbable, arrow keys move focus *and* selection with wrapping, Home/End jump to the ends. Some carrier firmware ships twenty-plus bundles, and the previous list made every one of them its own tab stop while the arrow keys did nothing — a screen reader announced a radio group whose members behaved like a button list. `CHOICE_ROW.SCROLL_CAP` bounds the list in `rem` so it scales with the user's text size instead of clipping at 200 % zoom.
- **The save is sequential, in dependency order** (bug fix): `auto_sel` is written first, and `apply_profile` only if that write landed. Auto-select must be OFF before a pinned bundle means anything. The previous card applied whichever single change it noticed first, so turning auto off *and* picking a bundle in the same pass **silently dropped the bundle**.
- **The reboot is offered, never taken.** QManager is served *by* the modem, so a reboot kills its own HTTP response. The write completes first; the reboot is a separate confirmed action that hands off to `/reboot/`.
- **The empty state is gated on a real read.** `bundles = profiles ?? []` collapsed `profiles === null` (never fetched, or the fetch failed) and `profiles === []` (the firmware genuinely reported none) into one `.length === 0` branch — so on a failed fetch the user read the destructive banner *"Failed to load carrier profiles"* and, directly underneath it, a paragraph asserting the firmware had reported none. A contradiction on one screen, not a silence. The block is now gated on `profiles !== null`; when the read failed, the banner is the whole story.
- **The standing reboot warning is deleted.** The card rendered `<TonalBanner tone="warning">` unconditionally — at rest, nothing pending, nothing selected — saying what `pending_note` says in the save bar and what `reboot.description` says in the confirm dialog; two of the three were on screen at once. A warning with no off state is wallpaper, and it spends the Functional-Color Promise on a static caption. The fact survives in the two places that carry it when it is actionable, and `mbn.reboot_notice` was deleted from all five packs.
- The card was **100 % untranslated** and is now fully keyed under `core_settings.apn.mbn.*`.

> ℹ️ NOTE: MBN's save bar borrows `core_settings.basic.save_bar.count` / `.discard` **cross-namespace**, so rewording the basic-settings bar silently rewords this page. Recorded as drift rather than fixed — and it is why `readout.reread` is a new key rather than a borrow of the identically-worded `core_settings.basic.footer.reread`. A second cross-namespace instance to save five words is not a trade worth making.

### Deleted files

`wan-profile-list.tsx` and `wan-profile-edit.tsx` are **deleted**. They had zero importers and had already been documented as retired from the page; the 6-slot backend contract in `apn.sh` is untouched and still reachable through `types/wan-profiles.ts` / `hooks/use-wan-profiles.ts`.

---

## Network Priority

Route shell: `network-priority.tsx`; the whole surface is `network-priority-card.tsx`, which owns its own fetch (no separate hook). One writable value: `AT+QNWPREFCFG="rat_acq_order"`, a colon-joined list where index 0 is the technology the modem tries first. `ids.join(":")` on write, `split(":")` on read — the order string is the contract in both directions.

### `RAT_RANK_TONE`: identity hues for the radios, a neutral for WCDMA

The shipped card carried a `RAT_COLORS` map painting **LTE `bg-success`** and **WCDMA `bg-destructive`**. A perfectly healthy 4G row rendered green-for-good and a working 3G fallback rendered red-for-broken, purely as identity — a user who learned on the dashboard that red means failure found it meaning "3G" here. That map is gone.

The rank numeral now wears the radio family's own identity hue:

| RAT | Tone | Why |
| --- | ---- | --- |
| `NR5G` | `bg-primary text-primary-foreground` | 5G identity blue |
| `LTE` | `bg-lte text-lte-foreground` | LTE identity violet |
| `WCDMA` | `bg-surface-container-high text-on-surface-variant` | **neutral** |

**WCDMA gets a neutral, not a third identity hue.** The palette ships exactly **two radio identity hues** — `primary` (NR blue) and `lte` (violet). Cyan and rose are *direction* roles, not identities, and are unavailable here for that reason; inventing a fourth hue by eye is what the Source-Color Rule exists to stop. The neutral is also honest — WCDMA is the fallback of last resort and is the one leg with no brand identity in this product. See [color-system.md](color-system.md).

Each entry is a complete fill **pair**, so it stays correct sitting on a neutral row or on a promoted one. Unknown RAT ids fall back to `RANK_PILL.NEUTRAL` rather than rendering unstyled.

The "Serving now" chip is a separate decision and takes `success` — that chip really is a healthy/active state, and an identity fill must never be read as "healthy".

### What else was retired

- **Dirty tracking exists now.** There was none: Save was disabled only when the list was empty, Discard was always live, and a no-op save was caught *after* the round trip with `toast.info("No changes to save")`. The order is diffed against `fetchedOrder`, and the save bar exists only while that diff is non-empty. **A reorder is one change, not N** — the user is staging a single write of a single AT parameter, so an adjacent swap reads "1 change pending".
- **A GET failure is visible.** It used to land in a bare `catch {}` commented "silently fail — keep current state", leaving a permanently blank card indistinguishable from a modem that genuinely reported no technologies. Error and empty are now separate `ConditionScreen`s that **replace the card body** — rendering an empty group beside a live Save button is the bug this page shipped with. Empty is `neutral`, not `warning`: "we do not know what this modem will try" is not a fault.
- **The drag shadow works.** The old one was `hsl(var(--foreground) / 0.12)` — an `hsl()` wrapper around an OKLCH token, which resolves to nothing.
- **Keyboard reorder works.** The `KeyboardSensor` was mounted but inert: without `sortableKeyboardCoordinates` it never resolves a drop target, so Space picked a row up and the arrows did nothing. The handle is a real focusable `<button>` with an `sr-only` label naming the row and its position.
- The page was **entirely untranslated** and is now fully keyed.

### Position-derived consequence copy

Each row's consequence sentence is a function of its **position** (`first` / `middle` / `last` / `only`), not of its technology — so it re-reads correctly as the user drags. A technology-specific hint (only WCDMA has one) is appended as a second sentence rather than folded into the first.

### Serving-RAT marking handles EN-DC

`servingIds()` maps the poller's `network.type`:

| `network.type` | Marked |
| -------------- | ------ |
| `LTE` | LTE |
| `5G-SA` | NR5G |
| `5G-NSA` | **NR5G and LTE** |
| `""` / anything else | nothing |

Marking both legs under EN-DC (5G non-standalone, where an LTE anchor carries the registration while the NR leg carries data) is the honest answer — claiming only one would be false either way round. `""` marks nothing; per [cellular-basic-settings.md](cellular-basic-settings.md#networktype-can-now-legitimately-be-), it means "not determined" and is explicitly **not** a synonym for LTE.

### Write timing

A `rat_acq_order` write takes effect on the next registration, so the radio drops and re-attaches. The card adopts the written order as its baseline **immediately** on a successful POST (so the save bar retires on that frame rather than waiting across a re-registration), then waits `RECOVERY_WAIT_MS` (3000) before a silent read-back. **The silent read-back never surfaces an error** — a failed read there means "still coming back", not "the card is broken".

---

## IMEI Settings

Route shell: `imei-settings.tsx`. Three cards: the device IMEI write surface, the backup-IMEI config, and a read-only tools/workbench card that touches nothing.

### The 2026-08-31 design-language adoption

The route was the last in the family still outside the finalized language. What landed, and the three defects that came out with it:

| Change | Why |
| ------ | --- |
| `staggerContainer` / `staggerItem` on the card grid | The page had **no motion at all**. `initial`/`animate` are declared on the container only; the three children carry `variants` alone so they share one clock |
| One stable `<Card>` per card, body swapped under `AnimatePresence initial={false}` | Both write cards `return`ed a separate `<Card>` per state, remounting an identical header the moment the read landed. Same fix, same pattern as Network Priority and Blocked Networks |
| `CARD_TITLE` on all three titles | All three were unsized `CardTitle`, inheriting 16 px — the anti-pattern flagged but left out of scope by `96f32aa`. This closes it for `imei-settings/` |
| `REVEAL` on the backup-identifier row | The row the toggle *creates* used to blink in. It now animates `grid-template-rows` 0fr→1fr, and is `inert` + `aria-hidden` while closed — it was neither, so a keyboard user could tab into an invisible field |
| `WORKBENCH_SPLIT` replaces `PAGE_GRID` + `CARD_CELL` | The height lock pinned the workbench card to the **combined** height of the two write cards beside it. Split by symmetry; see the note under *There is no two-column grid* above. Superseded in part on 2026-08-31 — the lock is back by request, but only after the row template made it cheap |
| `FIELD_CLUSTER`, `FIELD_COUNTER`, `ICON_ACTION`, `READOUT_ICON_ACTION`, `SECTION_LABEL`, `BREAKDOWN` promoted to `shapes.ts` | Seven call-site strings, several written out twice across the two write cards. `BREAKDOWN` had also been a module-local constant in `imei-tools-card.tsx` |

> ⚠️ WARNING: **`duration-[--duration-quick]` is invalid CSS, not an off-scale duration.** Tailwind v4 compiles the bare `[--custom-property]` arbitrary value to the *literal* `transition-duration: --duration-quick`; the browser drops the declaration, so the transition ships as **no transition at all**. Six sites in this family carried it (`shapes.ts` ×5, `imei-settings-card.tsx` ×1) and all are now `duration-[var(--duration-*)]`. Verified by compiling the class with `bunx @tailwindcss/cli` and by grepping `out/_next/static/chunks/*.css` before and after. **Two sites survive in `components/local-network/ethernet-card.tsx:155,163`** — a different route family, deliberately not swept.

> ⚠️ WARNING: **`BREAKDOWN.GRID` steps at `@md/card`, not `@2xl/card`, and that is load-bearing.** The workbench card lives in the *narrow* half of `WORKBENCH_SPLIT` — roughly 40 % of the content column — so a 672 px step never fired at any realistic window width and the three cells shipped stacked while looking deliberate. Costed against the column it actually lives in, per [DESIGN.md](../../DESIGN.md) > The Grid-Step-Costing Rule.

> ℹ️ NOTE: **`REVEAL` carries its own reduced-motion guard, and new work here should copy that, not `RATE_CEILING`.** A CSS grid transition is neither transform nor opacity, so `<MotionConfig reducedMotion="user">` cannot see it. `RATE_CEILING.PANEL_MOTION` plugs the hole by making every consumer call `useReducedMotion()` and drop the class — which works and is one `cn()` away from being forgotten. `REVEAL.ROOT` instead prefixes its transition with `motion-safe:`, the `@custom-variant` globals.css redefines to honour the sidebar's Animations preference in **both** directions. The consumer cannot omit it.

### The 2026-08-31 layout pass

Four changes, one root cause between the first two.

#### The row template, and why `items-start` was not the fix

`WORKBENCH_SPLIT` is a two-row grid: the left column stacks the two write cards one per row, and the workbench spans both. With both tracks left `auto`, **a spanning item's height is distributed across the tracks it spans** — so a workbench taller than the two write cards combined pushed the row-2 grid line down and opened roughly 90 px of blank between "Device IMEI" and "Backup IMEI". Nothing in `shapes.ts` declared that space and no gap value could remove it.

> ⚠️ WARNING: **Two sibling cards drifting apart because a THIRD card in the next column got taller is the defect.** The distance between them has to be the family's regular `gap-4` in every state. `items-start` does not fix it: alignment governs how an item sits *inside* its track, and the problem was the track sizing.

`grid-rows-[auto_1fr]` fixes it at the source. Row 1 sizes to the device card and nothing else, so the gap below it is exactly the grid gap; row 2 is the flexible track, so all of the spanning card's surplus lands there and the backup card absorbs it by **stretching** rather than by being pushed. The template is scoped to `@4xl/main` alongside the spans it serves — stacked, the three cards are three auto rows and there is nothing to distribute.

#### The height lock is back, and `CARD_BODY_FILL` is what pays for it

`items-start` is gone by explicit request: the two columns now match. That is normally a split by **symmetry**, which [DESIGN.md](../../DESIGN.md) > Layout names as a defect, and what makes it survivable here is arithmetic rather than taste — measured at a 1500 px viewport, the left column runs 641 px against the workbench's 640 px.

> ℹ️ NOTE: **The lock's cost is real, and it moved rather than vanished.** The two content changes below shorten the workbench by roughly 130 px, so the shorter column is now the right one and it carries ~90 px of slack with a number in the check field (~135 px with the field empty). `CARD_BODY_FILL` spends that deliberately: `BODY` on `CardContent` claims the growth (`Card` is already `flex flex-col`) and `TAIL` anchors the card's standing footnote to the bottom edge, so the slack becomes the space between the work and its caveat instead of dead canvas under both. It is **one** elastic zone on purpose — distributing it across the card's own gaps would make one card's internal rhythm change with the height of a card in the next column, which is off the fixed spacing scale.
>
> If a future row pushes either column materially past the other, revisit the lock rather than letting a card grow a hole.

#### The prefix row is a disclosure, not a standing field

Under a preset, "Prefix" was a **read-only echo** of the TAC the Select above it had just resolved — the same eight digits restated as a field, directly above a breakdown that already names them as "TAC" and "Serial". Three renderings of one number, and the only one the user could act on was the Select.

The row now reveals only for the **Custom code** option, which is the one case where it is the sole input rather than a repeat. Deleting it outright was not available: without it `isValidPrefix` can never become true under Custom, so Generate would sit permanently disabled and Custom would be a dead option. It uses the same `REVEAL` clock and the same `inert` + `aria-hidden` pair as the backup-identifier row, and **the group divider travels inside the clip** so the collapsed group has no dangling hairline.

#### "Check a number" is one row: `CHECK_GROUP`

Copy and "Look up online" sat on a second row under the field. Neither is a decision, both operate on the value above them, and stacked they read as a toolbar for the whole section rather than as two things you can do to *this* number. They are now addons inside the field itself — the outbound link leads, the number is the content, copy closes.

> ⚠️ WARNING: **Do not reach for `components/ui/input-group.tsx` on this surface.** The stock primitive is a hairline `border` over `rounded-md` with `dark:bg-input/30` and `text-muted-foreground`: a stroke where this system uses a fill (The No-Hairline-On-Fill Rule), the legacy `--radius` chain where this system uses the role scale, and precisely the `dark:`-scoped fill that `FIELD_VOICE`'s own note documents as surviving an unprefixed override through tailwind-merge. `CHECK_GROUP` is composed from `CONTROL_BOX` instead, so it is the **same** 42 px pill as the fields above it rather than a lookalike.

Three things about it are load-bearing:

- **The ring is on the shell, not the input.** `has-[input:focus-visible]` lights the whole group. A ring drawn around a transparent child that fills only the middle of the box would trace a rectangle through the middle of a pill.
- **The lead ink is `text-primary-on-surface`, not `text-primary`.** Measured on the shipped tokens: `text-primary` on this group's `surface-container-high` fill is **4.18:1** in dark mode, under the AA floor; `primary-on-surface` reads 5.07 dark / 4.54 light. `--primary` is the strong fill and belongs under `--primary-foreground` — same slot mistake, same fix as `INLINE_ERROR`.
- **The lead's 44 px target grows down, up and left — never right.** A symmetric `::before` inset would overhang the input beside it, and a user aiming at the field would open somebody else's website instead. Verified with `elementFromPoint` at all four edges.

The lead's **label** hides below `@md/card` and the glyph carries the action there; the `aria-label` is unconditional, so the accessible name never changes. That step is not cosmetic — the workbench's own column at the `@4xl/main` breakpoint is ~325 px of content, and a 15-digit mono identifier plus a labelled pill plus a copy target does not fit on one line. Measured at a 390 px viewport: the input's `scrollWidth === clientWidth`, so the value never scrolls out of its own field.

### Luhn validation now gates both write paths

> ⚠️ WARNING: The incumbent guard was a bare shape regex, `/^\d{15}$/`. A Luhn-invalid IMEI — a number the network will reject — could reach modem NVM, and the device needed a reboot to find out.

`validateImei()` had been sitting in `lib/imei-utils.ts` used only by the Tools card. It is now the gate on **both** `imei-settings-card.tsx` and `backup-imei-card.tsx`.

The two checks are staged deliberately: **shape first, then checksum.** Naming "not 15 digits" while the user is still typing would be noise, so the length message waits for a full field and only then does the checksum message appear. Both fail **inline** (`INLINE_ERROR`, or a filled `destructive-container` chip where the row may be promoted) rather than as a toast — a toast is gone in four seconds, and this is the one message a user must act on to proceed.

### The legal warning is a banner, not a tooltip — and a note, not an alarm

It used to be a 16 px `warning` glyph in an input addon whose tooltip had to be hovered — duplicated in two cards, with a **third, differently worded** copy in the loading skeleton, so the sentence visibly changed as the skeleton resolved. A notice a user must discover is not a notice. There is now one persistent page-level banner, one wording, above everything it governs.

> ⚠️ WARNING: **It shipped as `role="degraded"` and that was wrong twice over.** `degraded` is the warning container plus `ariaRole: "alert"`, and this banner is *permanent* — so the page fired a screen-reader alert about a condition that had not arisen, on every load, forever, and painted a state container as wallpaper. `CARD_FOOTNOTE` in `shapes.ts` already states the principle: a banner **is** its state, and a block with no off state is not a state.
>
> The compounding cost was tonal. `deferred-reboot` — the one banner on this page a user must ACT on — is warning-toned too, so it arrived as the second amber block under a permanent first one and read as more of the same. Corrected to `role="override"` on 2026-08-31: the set's neutral page-scoped note (`ariaRole: "note"`, `surface-container`, the one unfilled disc). **Amber on this route now means exactly one thing and means it only when it is true.** Do not put it back on a state role.

### The deferred reboot is real now — the sessionStorage contract

Writing an IMEI lands in NVM immediately but changes nothing the network sees until the modem restarts. The incumbent dialog offered "Reboot Now" / "Reboot Later" and then **dropped the choice**: picking Later recorded nothing, so the user got no reminder, no second chance, and a modem still answering on its old identity with no indication why.

| Key | `qm_imei_reboot_pending` |
| --- | --- |
| Store | `sessionStorage` |
| Value | `"1"`, or absent |
| Written by | `imei-settings.tsx` only (`markRebootPending`) |
| Read by | `imei-settings.tsx` only, in a mount effect |
| Cleared by | `handleReboot`, **before** handing off to `/reboot/` |

Three rules ride on this and are load-bearing:

1. **Read it in an effect, never in a `useState` initialiser.** This route is a static export, so the initialiser also runs where `sessionStorage` does not exist, and a value read during render would hydrate mismatched.
2. **Clear it before the handoff, not after.** `sessionStorage` survives the reload that lands on `/login/` once the modem is back, so leaving it set would resurrect the banner for a reboot that already happened.
3. **It is deliberately not a global reboot-state system.** Exactly one surface writes this key and exactly one reads it. Session lifetime is the right lifetime for "you have not restarted yet" — it should die with the tab.

While set, the page renders `Banner role="deferred-reboot"` — the one banner role permitted two CTAs (a tonal "Review" that scroll-anchors to the device card, and a destructive "Reboot"). **That role shipped in `components/ui/banner.tsx` with zero call sites until now.**

### `rebootDevice` signature change

`useImeiSettings().rebootDevice` changed from `() => Promise<boolean>` to `() => void`, and now follows the product-wide handoff already used by `nav-user.tsx`, `mbn-card.tsx`, `ip-passthrough-card.tsx` and `use-software-update.ts`:

```ts
sessionStorage.setItem("qm_rebooting", "1");
document.cookie = "qm_logged_in=; Path=/; Max-Age=0";
fetch(CGI_ENDPOINT, { …, keepalive: true }).catch(() => {});
window.location.href = "/reboot/";
```

**A reboot is never something this app can await.** QManager is served *by* the modem it reboots, so the request that starts the reboot kills its own HTTP response; awaiting it can only ever resolve to a network error. The incumbent implementation did exactly that and reported "Reboot failed" on a reboot that was already underway. `keepalive` is what lets the request survive the navigation on the next line, and going to `/reboot/` immediately means the countdown page is already in browser memory when the device disappears.

The page was **entirely untranslated** and is now fully keyed under `core_settings.imei.*`.

---

## Blocked Networks (FPLMN)

Route shell: `fplmn-settings.tsx`; the surface is `fplmn-card.tsx`, which owns its own fetch. Backed by `cellular/fplmn.sh` (GET reads the SIM's forbidden-PLMN list, POST clears it).

An FPLMN (Forbidden PLMN) entry is a network the SIM has recorded as having rejected it — the modem then refuses to try that network again until the list is cleared.

### The whole card is one condition

This surface reports exactly one fact, so there is no loaded "layout" to fall back to — the fact *is* the body. Every state renders through `ConditionScreen`, including loading.

| State | Tone | Glyph | ARIA |
| ----- | ---- | ----- | ---- |
| `loading` | `neutral` | `progress_activity` (spinning) | `status` |
| `error` | `destructive` | `error` | `alert` |
| `entries` | `destructive` | `cancel` | `alert` |
| `clean` | `success` | `check_circle` | `status` |
| `unknown` | `neutral` | `help` | `status` |

- **Five states, five glyphs.** `entries` and `error` are both `destructive`, which makes `cancel` vs `error` load-bearing rather than decorative — they must never collapse to one glyph.
- **The clean state is `success`, not `neutral` — and it used to be `primary` only because `success` did not exist here.** `neutral` is spoken for by `unknown`, and clean vs unknown are exactly the two states a user must never confuse, so they cannot share a fill and lean on the glyph alone. That left `primary`, this system's *informational* container (the Info-Is-Brand rule stated outright in `tonal-banner.tsx`) — a stand-in, because `ConditionTone` carried no `success` member. On **2026-08-17** the `--primary`-as-a-health-state delta was closed: `ConditionTone` and `condition-screen.tsx`'s `TONE` map gained a `success` member (`container: bg-success-container text-on-success-container`, `disc: bg-success text-success-foreground`, plus the matching `action` alpha) and this state moved onto it. `primary` stays in the union for genuinely informational conditions.
- **`spin` is honest here** for the same reason it is banned elsewhere: this condition really is transient work in flight.

### The `unknown` state is a bug fix

> ⚠️ WARNING: The incumbent render branched on `hasEntries === true` for the alarming state and fell through to the reassuring "No Blocked Networks" for **everything else — including `null`**, the initial value that survives any failed read. A surface whose only job is reporting a fault was asserting "no fault" when it had no data at all.

The fetch now **normalises** rather than assigning through: a success envelope with no boolean is genuinely unknown, and coercing it to `false` is precisely the false reassurance this rebuild removes.

```ts
setHasEntries(typeof data.has_entries === "boolean" ? data.has_entries : null);
```

### The clear is confirmed

Clearing writes the SIM's `EF_FPLMN` and there is no undo; it previously fired straight from the button's `onClick`. It is now behind an `AlertDialog`. Nothing here reboots, so the dialog says so plainly rather than implying a risk that does not exist.

### Highest-value follow-up: `raw_data` is fetched and discarded

`fplmn.sh` reads the SIM's `EF_FPLMN` with `AT+CRSM=176,28539,0,0,12` — 12 bytes, i.e. **four three-byte PLMN slots** — and already returns the whole thing as `raw_data`, 24 hex characters:

```json
{ "success": true, "has_entries": true, "raw_data": "…24 hex chars…" }
```

`has_entries` is derived from exactly one comparison: the string is all-`F` (`FFFFFFFFFFFFFFFFFFFFFFFF`) or it is not. So the boolean is the *only* thing the backend distils from a payload that names four networks.

The UI reads only `has_entries` and throws `raw_data` away, so the page can tell you *that* something is blocked but never *what*. Decoding the four slots into an MCC-MNC list per the standard `EF_FPLMN` encoding (an unused slot is `FFFFFF`) would turn a boolean into an answer, and would let a user see whether the network they actually care about is the one being refused.

This is the single highest-value improvement available on this page. It needs no backend change — the data is already on the wire.

### Nav rename

`sidebar:items.fplmn_settings` changed from **"FPLMN Settings"** to **"Blocked Networks"** in all five locales, so the sidebar, the breadcrumb, and the page title finally agree. The route path is unchanged (`/cellular/settings/fplmn-settings`) and no bookmark breaks.

---

## i18n

171 new keys in the `cellular` namespace across all five locales (en, zh-CN, zh-TW, it, id), at 100 % parity (2229/2229) with `bun run i18n:check` reporting 0 errors. Three retired APN keys were deleted from every pack.

Three of the four surfaces were **entirely untranslated** before this change (Network Priority, IMEI Settings, Blocked Networks), as was APN Management's MBN card.

The 2026-08-31 APN re-authoring added **15 keys** under `core_settings.apn.*` and rewrote `save_connection_notice`, at 100 % parity (2444/2444) across all five packs. Four keys were deleted from every pack together rather than left as five copies of dead string: `status.active` and `status.not_live` (replaced by the rewritten chip's verdicts), `mbn.reboot_notice` (the standing banner), and `readout.serving_apn` (absorbed by the comparison pair).

> ⚠️ WARNING: the five locale packs are **CRLF**, and no `.gitattributes` rule covers `public/locales/`. A naive `JSON.stringify(obj, null, 2) + "\n"` round-trip differs by one character per line and rewrites ~3000 of them. `core.autocrlf=true` also makes `git diff` blind to a silent LF conversion, and `cat -A` / `awk` / `sed` all strip CR here — only `od -c` or a byte-level read asserting zero lone LFs is evidence.

Key roots:

| Surface | Root |
| ------- | ---- |
| APN Management | `core_settings.apn.*` (MBN under `core_settings.apn.mbn.*`) |
| Network Priority | `core_settings.network_priority.*` |
| IMEI Settings | `core_settings.imei.*` |
| Blocked Networks | `core_settings.fplmn.*` |

See [i18n.md](i18n.md) for the `bun run i18n:check` gate, which exits non-zero on a missing key or an empty value.

---

## Related docs

- [cellular-basic-settings.md](cellular-basic-settings.md) — the fifth route, and the surface `shapes.ts` was born for
- [wan-profile-management.md](wan-profile-management.md) — `apn.sh`, the `apn_apply.sh` attach-cycle primitive, and the sidecars
- [sim-profiles.md](sim-profiles.md) — the Custom SIM Profile override gate that makes APN Management read-only
- [icon-system.md](icon-system.md) — the Material/lucide route boundary these surfaces sit inside
- [dashboard-state-motion.md](dashboard-state-motion.md) — `SaveButton`'s three states and its width lock, used by the save bar
- [i18n.md](i18n.md) — the translation gate
