# Languages (`/system-settings/languages`)

> **Applies to:** RM520N-GL (SDX65) · frontend re-authored onto the design canon 2026-09-07
> **RG501Q-EU (SDX55):** unverified — see [`platform-matrix.md`](./platform-matrix.md)
> Family: `components/system-settings/languages/**` · namespace `public/locales/*/system-settings.json`, `languages.*` subtree

The Languages page answers one question — *what language is this interface in, and how do I
change it?* — and offers a second thing on the side: community translation packs the device can
download and install at runtime. It exists because QManager ships five languages inside the
firmware tarball and can grow that set without a firmware update, so the device needs a place to
show what it has, what the catalog holds, and what an install is currently doing.

The backend was **not touched** by the 2026-09-07 re-authoring. Everything that changed is on
the client: two components under `components/i18n/` were deleted and replaced by a new family
under `/system-settings`, the catalog's failure state was split into two different facts, 51
hardcoded English strings became 94 locale keys, and the install progress the device has always
reported got a meter to render it in. This doc covers the family contract, the six non-obvious
decisions a future change will otherwise undo, the measured geometry, and what was deliberately
left alone.

---

## Quick Reference

| Thing | Where |
| ----- | ----- |
| Route | `app/system-settings/languages/page.tsx` (a five-line re-export) |
| Page shell / cascade root | `components/system-settings/languages/languages.tsx` |
| Page header + Refresh | `components/system-settings/languages/page-header.tsx` |
| Status band (3 tiles) | `components/system-settings/languages/status-band.tsx` |
| Display-language card | `components/system-settings/languages/display-language-card.tsx` |
| One selectable language | `components/system-settings/languages/language-row.tsx` |
| Community packs card | `components/system-settings/languages/community-packs-card.tsx` |
| One pack + install meter | `components/system-settings/languages/pack-row.tsx` |
| State block | `components/system-settings/languages/condition-block.tsx` |
| Loading placeholder | `components/system-settings/languages/card-skeleton.tsx` |
| Geometry + tone + faces | `components/system-settings/languages/shapes.ts` (the family's **only** shape module) |
| Derivations | `components/system-settings/languages/derive.ts` (pure; no React, no classes) |
| Hook | `hooks/use-language-packs.ts` |
| CGI client | `lib/i18n/language-pack-client.ts` |
| Error-code → locale key map | `lib/i18n/resolve-error.ts` |
| Bundled catalog | `lib/i18n/available-languages.ts` (five languages, `bundled: true`) |
| Catalog merge | `lib/i18n/language-pack-manifest.ts` (`buildCatalogView`) |
| Types | `types/i18n.ts` |
| CGI base | `/cgi-bin/quecmanager/system/language-packs/` |
| Endpoints | `list.sh` · `install.sh` · `install_status.sh` · `install_cancel.sh` · `remove.sh` |
| Install status poll | `STATUS_POLL_INTERVAL_MS = 1500` (`hooks/use-language-packs.ts`), armed **only** while an install is active |
| Icon family | **lucide** — `/system-settings` is a lucide route, no Material Symbols here |

---

## Data path

```
list.sh?manifest_url=...   -> { installed[], manifest, manifest_error }
useLanguagePacks()         -> list / isLoading / isRefetching / listError / install
buildCatalogView()         -> { builtIn[], downloaded[], available[] }
languageRows(view)         -> the radiogroup's rows (built-in first, then downloaded)
packRows(view)             -> update rows first, then install rows
catalogState({error,view}) -> unreachable | updates | available | none
```

`install.sh` returns `202 {state:"pending"}` or `409 {error:"install_in_progress"}`; the hook
then arms a 1.5 s poll against `install_status.sh` and stops on any terminal state
(`done` / `cancelled` / `failed` / `idle`), refetching the list silently as it stops.

---

## The family contract

`components/system-settings/languages/shapes.ts` is this route's **only** exporter of geometry,
tone, face and skeleton constants. No component in the directory exports a shape, and the loaded
views and their skeletons read the same values.

It has a deliberate two-source split, and the split is the part that gets undone.

**Imported and re-exported** from `components/system-settings/shapes.ts` — the same family, one
level up, so this is not a boundary crossing: `PAGE_ROOT`, `PAGE_HEAD`, `BAND`, `TILE`,
`DISC_TONE`, `DISC_TRANSITION`, `EYEBROW`, `VALUE`, `VALUE_TEXT`, `VALUE_NONE`, `CAPTION`,
`CARD_SHELL`, `CARD_PAD`, `CARD_BODY`, `CARD_TITLE`, `CARD_DESC`, `ROW_GROUP`, `GROUP_FILL`,
`CONDITION`, `CONDITION_PANEL`, `NOTICE`, `CHIP_ON_TONAL`, `META_INK_ON_TONAL`, `PILL_ACTION`,
`PILL_GLYPH`, `FOCUS_RING`, `COARSE_TARGET`, `SKELETON`, and the `DiscTone` type. They are
re-exported so every component in the directory imports from one place.

**Restated locally** — only what this surface invents: `CARD_SHELL_HERO`, `LANG_GRID`,
`LANG_ROW`, `PACK_ROW`, `METER`, `CMD`, `ERROR_STATE`, `FAILURE`, `TAG_ON_TONAL`, `MONO_TAG`,
`CHIP_GLYPH`, `SPIN`, the three face maps, and the skeleton line boxes.

> ⚠️ WARNING: **both precedents exist inside this one family, and they disagree.** `logs/` and
> `connection-quality/` import the shared names one level up; `system-health-check/` restates
> them, with a header comment saying a sibling shape module is not a shared library. Languages
> follows `logs/` and `connection-quality/`. A reader who finds `system-health-check/shapes.ts`
> first will conclude this file is wrong. It is not — the restate rule is about **sibling
> families** (`components/cellular/**`, `components/local-network/**`,
> `components/monitoring/**`), not about the parent module of the family you are already in.

> ⚠️ WARNING: this module must **never** import from a sibling family's shape module, and
> nothing in a sibling family may import from here. What is shared between families is the
> *system's numbers* — the 52px pinned row, the 104px tile, the 42px pill control — and they are
> copied, not imported. The one deliberate cross-family import in this directory is
> `CONDITION_TONE` from `components/cellular/condition-screen.tsx`, which is a **tone map**, not
> geometry, and is the product-wide condition palette.

`derive.ts` is the non-geometry sibling: the only place a value becomes a string or a state
union. It holds no React and no class names.

---

## The three catalog states, and why they are three

Short version: *"the device could not ask"* and *"the answer was nothing"* are different facts,
and the old page told both of them as the same red alert.

Before this pass, a `manifest_error` or a failed list GET rendered a half-page destructive alert
saying the pack catalog could not be loaded. The `language-packs` GitHub release the manifest
lives in **has never been published**, so that alert was on screen on every device in the field,
telling the user their modem was broken when nothing about it was.

`catalogState()` in `derive.ts` now resolves one of four values, in this order:

| State | Reached when | Tile tone | Glyph | Card body |
| ----- | ------------ | --------- | ----- | --------- |
| `unreachable` | `listError` **or** `list.manifest_error` is non-null | `warning` | `CloudOffIcon` | `ConditionBlock tone="warning"`, `role="alert"`, with a **Check again** retry |
| `updates` | at least one installed pack has a newer published version | `primary` | `ArrowUpCircleIcon` | the pack list |
| `available` | the manifest holds packs this device does not have | `primary` | `DownloadIcon` | the pack list |
| `none` | the manifest read fine and offered nothing | `neutral` | `GlobeIcon` | `ConditionBlock tone="neutral"`, `role="status"`, same retry |

Two rules hold that table together, and both are easy to erase:

- **`unreachable` is `warning`, never `destructive`.** A catalog nobody has published yet, or a
  device with no route to GitHub, is not a fault in this modem. The copy says so in plain
  English: the installed languages are untouched, this is a read that failed, and nothing on the
  device changed.
- **`none` is neutral and carries no alarm at all.** It is the expected state today.

`available` and `updates` are both `primary`, so their two glyphs are the **only** thing
separating "there is something new" from "something you have is out of date". That is the
same constraint the status-chip rule imposes everywhere: two states in one slot never share a
glyph, because the container fills do not separate under deuteranopia.

The page computes the error once — `catalogError = listError ?? list?.manifest_error ?? null` in
`languages.tsx` — and passes the same value to the band and to the card, so the tile and the
card body cannot disagree. In the `unreachable` card body the device's own message is printed
**beneath** the block in mono, never folded into the translated sentence (see i18n below).

---

## The row IS the control

The display card is one `role="radiogroup"` of language rows. Selecting a row switches the
interface immediately; there is no separate Use button.

- Each row is a `div` with `role="radio"` and `aria-checked`, **not** a `<button>` — a
  downloaded row nests a Remove button, and a button inside a button is not a tree a browser
  will render.
- **Roving tabindex:** exactly one row carries `tabIndex={0}` (the checked one, index-clamped to
  0 if the active code is not in the list); every other row is `-1`.
- **Arrows move focus AND selection.** Down/Right and Up/Left wrap, Home/End jump to the ends,
  and each of them focuses the target row *and* calls `onSelect`. Space and Enter select in
  place. This is the stock ARIA radiogroup contract, and it is correct here because switching is
  instant and reversible — there is nothing to confirm first.

> ℹ️ NOTE: this is the opposite of the Traffic Engine's mode radiogroup, where arrows move focus
> only. That surface diverges on purpose because selecting a mode there restarts the service
> carrying the user's own session. Nothing on this page has that cost. See [`dpi.md`](./dpi.md).

- `aria-busy` is set on a row while `switchLanguage` is resolving that row's pack, and the
  selection ring swaps its dot for a spinner.

**The nested Remove button must swallow both events.** It calls `stopPropagation` on `onClick`
*and* on `onKeyDown`. Drop either and opening the remove dialog also selects the row — clicking
Remove on Italian would switch the interface to Italian on the way to asking whether you want to
delete it.

Remove is confirmed through an `AlertDialog`. When the row being removed is the active one, the
page **switches to English before the delete** so i18next never tries to resolve against
resources that are no longer on disk, and the success toast says so.

### The row is pinned, so everything inside it truncates

`LANG_ROW.ROOT` pins the row at 52px rather than flooring it. Two consequences that are not
optional:

1. Every text child carries `truncate` and `min-w-0`, and the text column is
   `min-w-0 flex-1`. A name that would wrap has nowhere to go.
2. The skeleton can mirror it exactly, because a pinned height *resolves* — it does not have to
   be asserted. `card-skeleton.tsx` wears the real `ROW_GROUP`, `LANG_GRID` and `LANG_ROW.ROOT`
   and fills them with slivers, so the placeholder's height cannot drift away from the loaded
   view's.

The pack row is the opposite and deliberately so: `PACK_ROW.ROOT` is a **floor**, not a pin,
because its meta cluster (version, completeness, size, contributors, and possibly an
incompatibility badge) wraps to a second line on a narrow card and a fixed height would clip it.

---

## The promoted-row chip rule

The active row is promoted by **container**: `bg-primary-container` with
`text-on-primary-container` ink. That is Highlight-by-Container — the row itself becomes the
tonal surface rather than growing a border or an accent bar.

A chip riding that row breaks unless it is re-grounded. A stock `Tag variant="neutral"` keeps
`text-tag-neutral-text` and a neutral border, and both of those are measured against `surface`.
On a `primary-container` row they are nearly the ground they sit on.

`TAG_ON_TONAL` is the fix, and it is three things at once:

```ts
export const TAG_ON_TONAL = `${CHIP_ON_TONAL} border-transparent text-current`;
```

`CHIP_ON_TONAL` supplies the on-tonal chip ground from the family module, `border-transparent`
drops the neutral stroke (a neutral stroke on a chromatic surface is a crossed pair), and
`text-current` makes the chip inherit the row's own ink outright rather than naming a second
token that could drift from it.

**Measured after re-grounding: 4.91:1 in dark, 5.77:1 in light**, both over the 4.5:1 floor.
Anyone changing `primary-container`, `on-primary-container` or the tag tokens has to re-measure
these two numbers — the chip is the tightest pair on the surface.

The same host-dependence applies to the row's secondary ink and to the Remove button's hover
ground: `META_INK_ON_TONAL` versus `text-on-surface-variant` for the English name, and
`REMOVE_ACTIVE` versus `REMOVE_REST` for the hover fill. A promoted row has no neutral surface
to reach for, so it reaches for a translucent step of its own ink instead.

### Chips versus badges on this surface

Identity and metadata are `Tag` — built-in provenance, version, completeness, size,
contributors. Only two things stay `Badge`: the **incompatible pack** warning and the **install
failure** notice, which are genuine status. The surface this replaced shipped "Installed" and
"Active" side by side as two `success` badges with the same `CheckCircle2` glyph — same fill,
same glyph, two different states.

Version strings ride `MONO_TAG` (`font-mono tabular-nums`): a version is an identifier the
publisher emits, so it is machine voice. The install percentage is **not** — it is a changing
reading, so it takes `tabular-nums` in the UI face, never mono.

---

## The install meter, and the one line that is load-bearing

The device has always reported `progress` as 0–100 and nothing rendered it. The pack row now
draws a real meter with `role="progressbar"`, `aria-valuemin`/`aria-valuemax`/`aria-valuenow`,
the translated step label with `aria-live="polite"`, the percentage, and a Cancel action (hidden
once the state is `cancelling`, since the request is already accepted).

```tsx
<motion.div
  className={METER.FILL}
  initial={{ width: 0 }}
  animate={{ width: `${progress}%` }}
  transition={transitionMeterFill}
/>
```

> ⚠️ WARNING: **`initial={{ width: 0 }}` is not decoration and must not be deleted.**
> `METER.FILL` carries no width utility of its own, so before Framer Motion writes the animated
> value the element resolves to a **full** track. A 45% install paints as 100%, then drops back.
> This was found by measuring, not by reading.

The other half of the recipe is `transitionMeterFill` in `lib/motion.ts`, which is documented
there as the **first-paint** transition — the one that travels 0 → full and therefore takes
`emphasized`, the top of the duration scale, rather than `standard`. The explicit `initial` and
that transition are one mechanism described in two files; changing either alone reintroduces
the bug silently, because nothing type-checks a missing `initial`.

`METER.ROOT` takes a **definite** width rather than `flex-1`: the meter rides the row's
`flex-none` action cluster, which is shrink-to-fit, and a percentage width there has nothing to
resolve against.

### The failure block

A failed install hangs a `NOTICE` under its own row, plus the manual SSH recovery command in a
`CMD` box that is `select-all` and copies on click. The command box sits **below** the notice,
never inside it — `CMD` is `surface-container-high`, one step above the row group, and inside a
`destructive-container` notice that step reads as a hole.

The command is built inline from the pack's own manifest entry:
`qmanager_language_install <code> <url> <sha256>`.

---

## Motion gating

One cascade root on the page: `languages.tsx` declares `initial="hidden" animate="visible"` with
`staggerContainer`. The header, the band section and both cards are `staggerItem` and declare
**nothing** of their own — a `staggerItem` child that declares its own `initial`/`animate`
detaches from the page clock.

The rule that decides the rest:

> **Every cascade root that mounts *behind the loading gate* must declare its own
> `initial`/`animate`.** By the time it mounts the page clock has already run, and a
> variants-only child arriving late waits forever at `opacity: 0`.

Two roots do this and both are correct: the radiogroup in `display-language-card.tsx` and the
pack list in `community-packs-card.tsx`. Both sit inside the `isLoading ? <CardSkeleton/> : ...`
branch, so they mount after the cascade has finished.

Rows inside those groups are `staggerRowItem` under `staggerRows` — the dense in-card pair (5px
rise, tighter step), not the page pair (10px rise). The choice is mechanical: cards use
`staggerItem`/`staggerContainer`, rows sharing one card's border use the row pair.

### The one place that does not follow the rule

`status-band.tsx` renders **outside** the loading gate — it is always mounted and swaps its
three tiles between `TileSkeleton` and `Tile` internally. Its tile grid is a `motion.div` with
`variants={staggerRows}` and **no** `initial`/`animate`, so it inherits from the page root,
matching the shipped `components/system-settings/system-health-check/status-band.tsx` it was
patterned on. Because the grid element itself never remounts, the skeleton→loaded swap happens
under a container that has already animated, and the tiles are `staggerRowItem` children of a
container whose `visible` state is already active.

> ⚠️ UNVERIFIED RISK: whether that swap re-runs the row cascade, plays it once, or leaves the
> loaded tiles pinned at the container's resting state **was not confirmed in a browser.** The
> Browser pane was hidden for the whole verification session, which freezes `requestAnimationFrame`
> and pins Framer Motion at `initial` — including on the reference page used as a control, so
> there was no working comparison to reason from. Treat this as a thing to look at with a
> **visible** pane, not as a known bug. If it does misbehave, the fix is the same one the two
> gated cascades already use.

Everything else on the surface obeys the standing motion rules: no raw duration utilities, no
bare `transition-all`, and `LANG_ROW.TRANSITION` names its two properties (background colour and
colour) and reads the duration from the scale through a custom property, so a retune reaches it.

---

## Measured geometry

These figures come from measuring the shipped page, not from reading the constants.

| Thing | Value |
| ----- | ----- |
| Status-band tile | exactly **104px**, in the loaded view and in the skeleton |
| Language row | exactly **52px**, in the loaded view and in the skeleton |
| Row group at 1440px wide | two tracks of **645.5px**, rows paired at identical tops |
| Row group at 375px wide | one track of **275px**, zero horizontal overflow |
| English names at 375px | `display: none` |

The two-column flip is a plain `grid-cols-1 @2xl/card:grid-cols-2`, and it is **never**
`auto-fit`/`minmax`.

> ⚠️ WARNING: `auto-fit` needs a definite available width to count repetitions against. Given an
> indefinite one it resolves to a **single** track, and an N-item rail silently stacks vertically.
> The group is a block-level child of the card body today, so its width happens to be definite —
> the fixed column count is what makes the layout independent of how the group is ever
> re-parented. Do not "modernise" this to `auto-fit`.

The display card takes the **hero** radius (`CARD_SHELL_HERO`) because the choice the page
exists to offer is that card; the community card takes the ordinary card radius. The family one
level up has no hero shell, because its anchor is the status band rather than a card.

> ℹ️ NOTE: `CARD_SHELL_HERO`'s whisper shadow is important-marked. `twMerge` reads an arbitrary
> shadow value as a colour and cannot dedupe it against `card.tsx`'s own `shadow-sm`, so without
> the marker the primitive wins by name-sort. The marker has to be written **inside** the
> exported constant — appended at a call site it never appears as a literal in source, Tailwind's
> scanner never emits the rule, and `tsc`, ESLint and the build all stay green while the style
> does nothing.

The skeleton assumes **five** language rows and two pack rows. Five is not a guess: the bundled
catalog in `lib/i18n/available-languages.ts` always ships exactly five languages, so the display
card's height is knowable before the GET lands.

---

## i18n

Every user-visible string on this surface is keyed under `languages.*` in the **`system-settings`**
namespace — **94 keys**, in all five packs (`en`, `zh-CN`, `zh-TW`, `it`, `id`). The two
components this replaced carried 51 hardcoded English strings, and `language-pack-row.tsx`
called `t()` zero times. `docs/reference/i18n.md` had recorded this page as a known limitation
blocked on a missing namespace; the namespace exists, so the block is gone.

The subtree covers card copy, tile eyebrows and captions, every chip and tag, every button and
`aria-label`, the seven install steps, every toast, the remove dialog and both condition blocks.

### Error codes translate now

`lib/i18n/resolve-error.ts` used to return an English sentence. It now returns a **locale key**
and nothing else:

```ts
export function installErrorKey(code?: string | null): string | null
```

Eleven device error codes map to `languages.errors.*`. The module stays free of React and of
i18next on purpose — the caller holds the `t`, so the same map serves the pack row's failure
notice, the install toast and the remove toast.

**An unmapped code renders the translated generic line, with the device's own words quoted
beneath it as machine voice.** It is never spliced into the sentence, where an English fragment
would land mid-Chinese. The same shape is used for the `unreachable` card body, where the raw
`manifest_error` string sits under the block in mono.

> ⚠️ WARNING: routing the code to the UI required a hook change, and half of it is still
> missing. The hook used to resolve the code into English and **discard it**, so
> `LanguagePackInstallState` gained `error_code` and `startInstall` now carries the raw code
> through. But `getLanguagePackInstallStatus()` in `lib/i18n/language-pack-client.ts` still does
> not read a code off the status payload — it maps `state`, `code`, `progress`, `step`,
> `message` and `updated_at` only. **A failure the device reports mid-install therefore arrives
> with no `error_code`**, and the row falls through to the generic sentence plus the raw
> `message`. Only a failure at *start* time (the `install.sh` POST) carries a translatable code
> today.

### Two shapes worth copying

- **The byte unit is its own leaf.** `formatBytes()` returns `{ value, unit }` and the caller
  resolves `languages.community.size.kb` or `.mb` with the value. The unit is nested under
  `size`, not appended as a plural suffix, and no glue character (`·` or otherwise) is used
  anywhere on the surface.
- **Casing lives in the class, never in the locale value.** Eyebrows are uppercased by
  `EYEBROW`; content casing does not translate.

### Plurals in the non-English packs

`zh-CN`, `zh-TW` and `id` carry **both** `_one` and `_other` for every plural pair, with
identical text, even though CLDR gives each of them a single plural category. That is the
existing convention in those files, and the gate compares against the English superset, so
dropping `_one` there reads as a missing key. `it` genuinely inflects.

Four orphaned `language.*` leaves were removed from all five packs in the same pass
(`active`, `select_prompt`, `page_title`, `page_description`). `language.label` and
`language.switch_aria` are still consumed and were kept.

> ℹ️ NOTE: `bun run i18n:check` cannot see an *unused* key — nothing would ever have flagged
> those four. They were found by grepping consumers. The gate after this change reports 0 errors
> and 26 warnings (the pre-existing passthrough baseline), with every locale at 3741/3741.

> ⚠️ WARNING: the locale packs are **CRLF**. A `JSON.parse` → `JSON.stringify` round-trip
> rewrites every line ending and produces a whole-file diff; so does `sed -i` under Git Bash.
> This pass edited them surgically and verified byte-level afterwards. See [`i18n.md`](./i18n.md).

---

## Deliberately out of scope

These are known, were looked at, and were left alone. None of them is a bug on this surface.

- **`components/ui/copyable-command.tsx` now has zero call sites.** It survives as a pre-canon
  primitive — `rounded-md`, `bg-muted`, untranslated strings — and the recovery command box was
  rebuilt locally on canon tokens (`CMD` in `shapes.ts`) rather than adopting it. Deleting it, or
  bringing it onto the canon, is a separate change.
- **`LanguageMeta.bundled` in `types/i18n.ts` still carries a doc comment describing the
  retired bundle-only model** — it says every catalog language is bundled and the field is
  retained for a future downloadable-pack increment. The downloader shipped; the comment did
  not get rewritten. The neighbouring comment in `lib/i18n/available-languages.ts` *was*
  corrected in this pass (it claimed there was no remote manifest and no download flow, directly
  above a full manifest/download/verify/extract/install pipeline).
- **`refetch` in `hooks/use-language-packs.ts` takes no argument and is always silent** — it
  calls `fetchList(true)`, which drives `isRefetching` rather than `isLoading`. There is no loud
  refetch available to a caller, so the header's Refresh action and both condition-block retries
  spin the header pill and leave the page in place. That is the behaviour this surface wants;
  it is recorded because the hook's signature does not advertise it.
- **The `Empty` primitive is unusable here.** `components/ui/empty.tsx` bakes `md:p-12` into its
  base class — a viewport breakpoint no call site can remove, inside a card that sizes on
  container queries. `ConditionBlock` is the surface's state block instead: geometry from
  `./shapes`, colour from the shared `CONDITION_TONE`, glyph from lucide.
- **The backend was not touched.** `list.sh`, `install.sh`, `install_status.sh`,
  `install_cancel.sh` and `remove.sh` are unchanged by this pass.

---

## Known debt

- **The status poll cannot deliver a translatable error code** (above). Fixing it means adding
  one line to `getLanguagePackInstallStatus()` — and confirming the CGI actually emits a code
  field on that path, which has not been checked on a device.
- **The status band's tile grid inherits its cascade** (above) — unverified, needs a visible
  browser pane.
- **The community catalog has never been published.** Every device in the field lands in the
  `unreachable` state, so the `available` and `updates` states have not been exercised against a
  real manifest. The install meter, the step labels and the failure block are all reachable only
  once a pack exists to install.
- **`docs/reference/system-settings.md`'s sub-route sentence and the `CLAUDE.md` System Settings
  row both track how many sub-routes have taken the canon pass.** Four of the seven have now.

---

## Related

- [`system-settings.md`](./system-settings.md) — the route index and the shared family module
  this one imports from
- [`logs.md`](./logs.md) — the sibling sub-route family; the structural model for the file split
  and the shape-module import decision
- [`i18n.md`](./i18n.md) — the translation gate, the pack format, and the CRLF hazard
- [`docs/CONTRIBUTING-translations.md`](../CONTRIBUTING-translations.md) — how a community pack
  is authored and published
- [`color-system.md`](./color-system.md) — the container/on-container pairs the promoted row and
  its chips are measured against
- [`icon-system.md`](./icon-system.md) — the route-scoped lucide/Material boundary
- [`tailwind-prose-hazard.md`](./tailwind-prose-hazard.md) — why this doc describes bracketed
  utility spellings in words instead of quoting them
