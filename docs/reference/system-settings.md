# System Settings (`/system-settings`)

> **Applies to:** RM520N-GL · re-authored onto the design canon 2026-09-05
> Family: `components/system-settings/**` · namespace `public/locales/*/system-settings.json`

The route's **index only**. Six of the seven sub-routes (AT Terminal, Connection
Quality, Languages, Software Update, System Health Check, Web Console) have their own
components and have **not** taken the canon pass. **Logs has** — see
[logs.md](logs.md).

---

## Why this surface existed unmigrated for so long

It had no feature doc and no routing row in `CLAUDE.md`, so it was the one feature
centre nobody was tracking. Every other route that had not migrated had a Migration
Delta row saying so; this one did not.

The drift was total, not partial. A grep across its five active component files for
`on-surface`, `surface-container` and the whole `rounded-{card,hero,tile,field,pill}`
scale returned **zero** matches, while `text-muted-foreground` returned **fifteen**.
That is the measurement to re-run if anyone doubts the surface is on the canon.

---

## The family contract

`components/system-settings/shapes.ts` is the eighteenth shape module in the product
and owns **every** geometry string, control height, tone map and skeleton line box on
the surface. No component here exports a shape constant, and the loaded views and
their skeletons read the same values.

Geometry is **restated** from the system's numbers, never imported across a family
boundary. `components/cellular/tile-shape.ts` holds the identical tile box and four
`/local-network/` modules hold it again; this file imports none of them.

`components/system-settings/derive.ts` is the non-geometry sibling — how a device
value becomes a string. It exists because `formatOffset` had already been duplicated
byte-for-byte across two files within a day of being written.

### Load-bearing constants

| Constant | Why it is the way it is |
| --- | --- |
| `FIELD_HEIGHT` | Carries its `!` **inside** the string. Tailwind extracts candidates from raw source text, so `` `${FIELD_HEIGHT}!` `` never produces a literal and the marker silently does nothing. `select.tsx:40`'s `data-[size=default]:h-9` then wins at (0,2,0) and the control renders 36px against a call site asking for 42. |
| `CARD_SHELL` | The shadow is `!`-marked because `twMerge` reads an arbitrary shadow value as a colour, so name-sort would otherwise decide against `card.tsx`'s own `shadow-sm`. |
| `TILE.ROOT` | 104px **pinned**, never `min-h`. A floor cannot be a mirror — the skeleton wears `ROOT` itself so the two cannot drift. |
| `CARD_GRID` | `*:h-full *:*:data-[slot=card]:h-full` — the second step is what lets the height lock reach **through** each card's motion wrapper. Drop it and the Symmetric-Pair lock dies silently. |
| `COARSE_TARGET` | A pseudo-element overlay, not a layout box, so a 44px touch target does not move the row's baseline. Applied to the reboot `Switch` (paints 18.4×32) and the password reveal toggles. |
| `CHIP_ON_TONAL` | `Badge variant="info"` resolves to `bg-primary-container` — byte-identical to `SIM_ROW.ACTIVE` — so a stock chip dissolves into a promoted row. Re-grounded on the row's own ink. Same technique as `CONDITION_TONE.action`. |

**`CARD_BODY`, not `CONDITION_PANEL.CONTENT`.** The box that fills a height-locked
cell is used on loaded content as often as on a state screen, so the old name
understated its scope and four call sites had drifted to restating its literal
instead. `CONDITION_PANEL` is now `{ SCREEN }` only. Gaps stay composed at the call
site (`cn(CARD_BODY, "gap-4")`) — the module never bakes a gap into these boxes.

**Geometry lives here even when only one file uses it.** `SAVE_LAYER`, `LABEL_LINE`
and `TZ_NOTICE` were file-local until 2026-09-06; `SAVE_LAYER`'s own skeleton mirror
was already in this module while the thing it mirrored was not. A constant with one
consumer today is still the contract its skeleton must import.

---

## Invariants

- **`timezone_applied` is tri-state.** Older backends omit it, and **absent means
  assume applied**. Test `=== false`, never falsy. Same contract as `lte_read_ok` in
  tower locking.
- **`effective_offset` and `effective_zone_abbr` are both optional.** Without either
  there is no reading to grade, so the clock tile renders `unreported` (neutral),
  never `applied` (green). `formatOffset` returns `string | undefined` — a
  `!== null` test against it is **always true**, which is exactly how the
  `unreported` face was once made unreachable while tsc, eslint and the build all
  stayed green.
- **`useKnownSims().count` is `number | null`.** The hook swallows a failed GET by
  design, so without the null a swallowed failure is indistinguishable from a
  genuine zero — and the card would render "0 SIMs remembered" over a list of three.
- **A payload that omits a key is not an error.** `settings.sh` can answer
  `200 {"success":true}` with no `settings` and no `scheduled_reboot`. Both cards
  gate their condition block on `!data`, **not** on `error && !data`; the second
  form renders invented defaults as though the device had reported them.
- **The reboot card's local state syncs on identity** (`scheduledReboot !== prev`),
  never on truthiness. A truthiness guard means `null` never resets, so a failed
  read leaves the last schedule on screen — and the switch will then arm it.
- **One cascade root per route.** `system-settings.tsx` alone declares
  `initial`/`animate`. The card grid is a nested `staggerContainer` that inherits
  `visible`; a nested container declaring its own clock detaches from the parent.
- **Icons are lucide here.** The Icon-Boundary Rule is route-scoped and
  `/system-settings` is not in the Material set. Verify a name is a live export of
  the installed `lucide-react` — several are aliases whose files are named
  differently (`CheckCircle2Icon` → `circle-check-big.js`).

---

## The status band

Three tiles, all reading data the page already fetches. No new endpoint, no poller.

| Tile | Source | States |
| --- | --- | --- |
| Device clock | `settings.effective_zone_abbr` + `effective_offset` | unreachable · unread · unreported · drifted · applied |
| Next reboot | `scheduled_reboot` | unreachable · unread · off · no_day · armed |
| Tracked SIMs | `sim_registry.sh` rows | count, muted count |

Each tile derives **one state union** and reads tone + glyph from a `Record`-typed
face map. The three independent ternaries this replaced let the value line, the
caption and the disc answer the same question differently — the shipped defect was a
tile reading value `Off`, caption `Enabled, but no day is selected`, and a `primary`
disc documented as "configured and running", simultaneously.

**Every state in a face carries its own glyph.** `success-container` and
`warning-container` measure 1.03:1 apart and the disc fills are no easier under
deuteranopia, so the glyph is the only separator a tile has.

**The band takes `simsLoading` separately from `isLoading`.** The registry has its
own GET and it is slower than settings on first paint; without it the SIM tile shows
a confident `0` before its own read lands.

**The offset does not tick.** It is a config readback that holds steady until
something reconfigures it, so it takes `font-mono` per the Machine-Voice Rule and no
`useValueTick` — dipping a value that holds steady for minutes invents an event.

---

## Deliberate decisions

- **The 2×2 card grid stays.** The user ruled the layout adequate; this pass is
  grammar, tokens, motion, state and i18n, not re-composition.
- **Scheduled Reboot keeps its 800ms debounced autosave** and does **not** get an
  explicit `SaveButton`, even though the card beside it has one. It gained a visible
  saved receipt instead. A schedule is low-risk and the debounce is deliberate.
- **The reboot card and the band must agree on the no-day state.** Both carry a
  third state for *enabled with no day selected*; they were allowed to disagree
  once, and a green "Armed" chip 200px from an amber "Never fires" tile is the
  result.
- **The autosave receipt's `aria-hidden="true"` is CORRECT — do not "fix" it.** A
  critique pass reported it as denying screen-reader users a write confirmation. It
  does not. `toast.success` fires on every successful save path, and Sonner mounts a
  global `<section aria-live="polite">` that announces it — measured in the rendered
  DOM, not inferred. Removing the attribute would *regress*: the strip's three layers
  are all unconditionally mounted and cross-faded by `opacity` alone, and `opacity-0`
  does not remove content from the accessibility tree, so AT would read
  "Saves automatically Saving… Saved" as one permanent string. Per-layer `aria-hidden`
  does not rescue it either — without a live region nothing announces, and with one it
  double-announces against the toast. `components/ui/save-button.tsx:162-165` already
  documents this exact decision for the identical construction. The card instead
  carries an `sr-only` hint wired by `aria-describedby`, reusing the *existing*
  `reboot.states.autosave` leaf so the spoken and visible text cannot drift.

- **`modem-subsystem-card.tsx` stays parked** — commented out of the grid, 447 lines,
  no consumers. **Open question for the user:** parking is the most expensive of the
  three options, because Tailwind v4 scans every non-gitignored file, so its
  pre-canon class strings still compile into the CSS bundle. It also imports
  `react-icons/tb`, a third icon library. Delete or restore; do not leave it.

---

## Known-good and known-open

- **`settings.sms_tool_device`** is on the wire, typed on `SystemSettings`, and has
  **zero consumers product-wide**. Open question: give it a control or drop it from
  the type.
- **`onRetry={refresh}` passes the click event as the `silent` argument.** Fixed at
  this route's two call sites (`() => refresh()`), but the same bare wiring exists at
  roughly fifteen sites repo-wide — `about-device`, `network-events`,
  `latency-monitoring`, `overview-card`, both antenna surfaces. Three families
  already carry a code comment warning about it. Worth a sweep.
- **`error` carried two unrelated facts, and misreported one of them — FIXED.**
  `useSystemSettings().error` was set both by a failed *read* and by a rejected *write*,
  so a write the backend refused lit every "we lost the device" surface on the page.
  There were **three**, not two: the `band.stale` badge in `status-band.tsx`, and the
  `states.stale` notices in both `scheduled-operations-card.tsx` and
  `system-settings-card.tsx` — so deselecting the last reboot day made the *preferences*
  card claim the modem had stopped answering. The write path no longer touches `error`:
  `postAction` returns `{success:false, rejection, rejectionDetail}` and `fetchSettings`
  is the sole writer, which is what `status-band.tsx`'s own prop comment — "Non-null when
  the settings GET failed outright" — always claimed.

  Two parts of that are load-bearing and easy to undo by accident:

  - **The `setError(null)` that used to open `postAction` is gone on purpose.**
    `save_scheduled_reboot` does not re-fetch, so clearing the read error on write entry
    meant a *successful* save silently erased a genuine stale-read warning while every
    value on screen was still from the failed read. The write "proved" the read.
  - **`rejection` is a separate field from `reason`.** `reason` is the *arm* axis (the
    save landed but no timer was installed); `rejection` is the *write* axis (the save
    never happened). The i18n maps mirror the split — `reboot.toast.reasons.*` for arm
    reasons, `reboot.toast.rejected.*` for rejections. Merging them would let an arm
    warning render a validation failure, which is this same defect one layer up.

  A rejected write now also reverts the day rail and time field to the server's values;
  without that the rail read zero days while the band beside it still said "Repeats on
  Mon, Wed". An unmapped token falls back to the translated generic line with the
  device's own words quoted beneath it as machine voice, never spliced into a sentence.

- **Open: the 800ms debounced save races a concurrent refresh.**
  `scheduled-operations-card.tsx` resyncs local state from `scheduledReboot` by object
  identity during render, and every GET yields a fresh object. A refresh landing inside
  the debounce window overwrites an in-flight day edit while the already-scheduled timer
  still POSTs the original payload. Two triggers: the page's Refresh button, and — less
  obviously — a *preferences* save, which calls `fetchSettings(true)`. The POST's own
  response resyncs, so it self-corrects, except on the rejection path where nothing
  resyncs. Unmounting also drops a pending save with no feedback at all. The same closure
  feeds the rejection revert, so a rejection arriving while an earlier save is still
  in flight restores the rail to a value one step behind the server; a ref would
  close both halves at once.

- **Open: the frontend and backend disagree about whether "enabled with no days" is
  legal.** `scheduled-operations-card.tsx` renders it as a first-class `warning` badge
  and `status-band.tsx` gives it a `no_day` face with its own caption, while
  `settings.sh:217-221` rejects it outright — so the band's `no_day` face is unreachable
  from any server response. One layer models it as a warning state, the other as a hard
  error. Reconciling that is a cross-layer (Tier 3) change; the error channel was only
  how the disagreement leaked to the user.

- **`components/ui/empty.tsx:10`** ends its base class with `md:p-12` — a viewport
  breakpoint inside a content-level primitive. This surface stopped consuming it;
  the product-wide sweep is still open.

---

## i18n

131 leaves per pack across five packs, zero drift. Subtrees: `page`, `band`,
`preferences`, `reboot`, `ssh`, `sim_registry`, `known_sims`.

- **The packs are CRLF.** A naive `json.load` → `json.dump` round-trip rewrites every
  line ending and produces a five-file diff that is one character per line.
- **Casing lives in the class, never the leaf.** `EYEBROW` carries `uppercase`.
  Casing in content does not translate: the product's one caps eyebrow leaf
  (`cellular.json` `"IN FORCE NOW"`) had Italian mirroring the shout while both
  Chinese packs silently normalised it.
- **No `·` glue character** between short facts — DESIGN.md's No-Dot-Separator Rule.
  This surface shipped one and had to take it back out of five packs.
