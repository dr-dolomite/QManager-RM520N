# System Logs (`/system-settings/logs`)

> **Applies to:** RM520N-GL (SDX65) · frontend re-authored onto the design canon 2026-09-06
> **RG501Q-EU (SDX55):** unverified — see [`platform-matrix.md`](./platform-matrix.md)
> Family: `components/system-settings/logs/**` · namespace `public/locales/*/system-settings.json`, `logs.*` subtree

The System Logs page is QManager's window onto its own diagnostic transcript: the file every
QManager shell script writes to through `qlog.sh`. It exists because the device has **no
journal to fall back on** — `journald` is masked to `/dev/null` on both modems, so
`/tmp/qmanager.log` is the only durable record of what a CGI script, a daemon or the poller
actually did, and this page is the only way to read it without an SSH session.

The backend was **not touched** by the 2026-09-06 re-authoring. Everything that changed is on
the client: the surface moved out of `components/monitoring/logs/` into its own family under
`/system-settings`, the fetch moved out of the card into `hooks/use-system-logs.ts`, the table
became a 52px row list, and three claims the old UI made that were not true were retired. This
doc covers the frozen backend contract, the five non-obvious decisions on the client, the five
states, and the gotchas that live in the shell script and will bite anyone who trusts the
payload at face value.

---

## Quick Reference

| Thing | Where |
| ----- | ----- |
| Route | `app/system-settings/logs/page.tsx` (a three-line re-export) |
| Page shell | `components/system-settings/logs/system-logs.tsx` |
| Status band | `components/system-settings/logs/status-band.tsx` |
| Transcript card | `components/system-settings/logs/transcript-card.tsx` |
| Row | `components/system-settings/logs/log-row.tsx` |
| State block | `components/system-settings/logs/condition-block.tsx` |
| Geometry + tone | `components/system-settings/logs/shapes.ts` (the family's **only** shape module) |
| Derivations | `components/system-settings/logs/derive.ts` (pure; no React, no classes) |
| Hook | `hooks/use-system-logs.ts` |
| Types | `types/system-logs.ts` |
| CGI endpoint | `GET`/`POST` `/cgi-bin/quecmanager/system/logs.sh` |
| Producer library | `scripts/usr/lib/qmanager/qlog.sh` (sourced by every QManager shell script) |
| Log file | `/tmp/qmanager.log` — **RAM disk**, seeded `root:root 0666` by `qmanager_setup` |
| Rotated files | `/tmp/qmanager.log.1`, `/tmp/qmanager.log.2` (`MAX_ROTATED=2`) |
| Rotation trigger | `QLOG_MAX_SIZE_KB`, default **256 KB** |
| Default write threshold | `QLOG_LEVEL`, default **INFO** — so `DEBUG` lines are usually never written |
| Poll cadence | `POLL_INTERVAL_MS = 10_000` (`hooks/use-system-logs.ts`) |
| Search debounce | 400 ms |
| Line budgets | `LINE_BUDGETS = ["50", "100", "200", "500"]` |
| Rotation warn threshold | `ROTATION_WARN_KB = 205` (80% of 256, `derive.ts`) |
| Icon family | **lucide** — `/system-settings` is a lucide route, no Material Symbols here |

---

## Data path

```
qlog_info "..."          -> [TS] LEVEL [component:PID] Message   (qlog.sh, appends)
_qlog_rotate()           -> mv to .1/.2 at >= QLOG_MAX_SIZE_KB   (chmod 666 re-asserted)
logs.sh  parse_logs()    -> single awk pass -> NDJSON            (oldest first)
logs.sh                  -> jq -s wrap -> {entries, total, stats, available_components}
useSystemLogs()          -> unfiltered-by-level window, 10s poll
filterByLevel()          -> exact-level filter, CLIENT side
[...].reverse()          -> newest first
withRowKeys()            -> stable identity per row
groupByDay()             -> Today / Yesterday / a formatted date
```

The line format `qlog.sh` writes, and the only format `logs.sh` can parse, is:

```
[2026-09-06 01:02:03] INFO  [poller:1234] Cycle complete
```

A line that does not start with `[` is skipped outright, and a line whose level word is not
one of the four is dropped by the awk pass. That is why `LogLevel` is a **closed union** in
`types/system-logs.ts`: widening it on the client would be a lie until the backend widens too.

> ℹ️ NOTE: `qlog.sh` also mirrors every line to syslog via `logger` when `QLOG_TO_SYSLOG=1`
> (the default). This page never reads syslog — only the file.

---

## The backend contract (frozen)

`scripts/www/cgi-bin/quecmanager/system/logs.sh` was **not edited** by the re-authoring. Treat
the shapes below as fixed; the client bends around them.

### GET parameters

| Param | Default | Meaning | Sent by the UI? |
| ----- | ------- | ------- | --------------- |
| `lines` | `100` | Max entries returned. Non-numeric input is coerced back to `100`. | Yes — the line-budget `Select` |
| `level` | *(none)* | **Minimum severity**, not an exact match. See below. | **No — deliberately dropped** |
| `component` | *(none)* | Exact match on the component name. | Yes, when not `all` |
| `search` | *(none)* | Case-insensitive substring over the **entire raw line**. | Yes, after a 400 ms debounce |
| `include_rotated` | `0` | `1` also reads `.2` then `.1`, oldest first. | Yes — the "Include archived" switch |

`lines` is a **tail**: the awk pass accumulates every matching entry and then emits only the
last `max_lines` of them, so what you get is the newest slice of whatever survived the other
filters.

### GET response

```json
{
  "success": true,
  "entries": [
    {
      "timestamp": "2026-09-06 01:02:03",
      "level": "INFO",
      "component": "poller",
      "pid": "1234",
      "message": "Cycle complete"
    }
  ],
  "total": 0,
  "stats": { "current_size_kb": 42, "current_lines": 1180, "rotated_files": 1 },
  "available_components": ["poller", "qcmd", "cgi_logs"]
}
```

Every key is always present. `pid` may be the empty string (a log line with no `:PID` in its
component block) but is **never absent** — the awk `printf` always emits the field. `entries`
is ordered **oldest first**; the UI reverses it.

### POST actions

| Body | Effect |
| ---- | ------ |
| `{"action":"clear"}` | Truncates `/tmp/qmanager.log` in place and `rm -f`s both rotated files. Returns `cgi_success`. |
| `{"action":"status"}` | Returns `stats` only. **Unused by this UI.** |

The clear path truncates through the existing inode (`: > "$LOG_FILE"`) rather than recreating
it, which is what preserves the `0666` seed — see [`tmp-file-ownership.md`](./tmp-file-ownership.md)
for why that mode is load-bearing for a file both root daemons and `www-data` CGI append to.

### Rotation and volatility

`/tmp` is a RAM disk. **The log is empty after every reboot** — there is no persistence, by
design, because the flash is UBIFS and a chatty log would wear it. `_qlog_rotate()` moves the
current file to `.1` (shifting `.1` to `.2`) once `wc -c` divided by 1024 reaches
`QLOG_MAX_SIZE_KB`, then re-asserts mode `666` on the fresh file. Nothing is compressed.

That volatility is the single most useful fact a first-time reader is missing, so the page
description and the empty state both say it in plain English rather than leaving it to this doc.

---

## The five things a reader will otherwise get wrong

### 1. `total` is dead. Never read it.

`logs.sh` computes it as `wc -l` over **the very NDJSON string it then serializes into
`entries`**, after the `lines` truncation has already happened. The two can never disagree, so
the old UI's "Showing 60 of 60" was tautological in every possible state — it looked like a
window into a larger log and was not.

It is worse than merely redundant. Command substitution strips the trailing newline, so a
non-empty window has `N` lines but only `N - 1` newline characters:

```sh
entries=$(parse_logs ...)               # trailing newline stripped here
entry_count=$(printf '%s' "$entries" | wc -l)   # counts newlines -> N - 1
```

**`total === entries.length - 1` for any non-empty window** (and `0` when empty). It is kept in
the payload and typed in `LogsResponse`, with a doc comment saying so, purely so nobody
re-derives it and thinks they found something. The card description reports what is actually
true instead: how many lines are on screen, and how many `stats.current_lines` says the live
log holds.

### 2. The backend's `level` is a severity FLOOR, so the client filters instead

In the awk pass, `level` sets `min_level` and every entry with `lvl[level] < min_level` is
dropped. Picking `WARN` therefore also returned every `ERROR`. That is a reasonable thing for a
log reader to offer and the wrong thing for a rail of mutually-exclusive chips to be built on.

The hook **does not send `level` at all**. It fetches one window filtered only by
`component` / `search` / `lines` / `include_rotated`, and `filterByLevel()` applies an exact
match in the view. That is what lets every rail chip carry a live count off the window already
in hand, with no extra request — `levelCounts()` tallies all five numbers in one pass.

> ⚠️ WARNING: `lines` bounds the fetched window **before** client-side level filtering. On a
> device with `QLOG_LEVEL=DEBUG` set, a 100-line budget can be almost entirely `DEBUG` noise,
> and selecting **Error** will then show fewer errors than the log actually holds. This is a
> deliberate trade — honest counts on every chip, in exchange for a window the user must widen
> themselves. **Widening the line budget is the user's lever**, and it is why the budget
> `Select` sits on the same row as the other filters rather than being hidden.

A related consequence: the rail counts are counts **within the fetched window**, already
narrowed by the server-side component and search filters. They are not global log statistics
and the copy never claims they are.

### 3. The row key is an identity, not a position

`rowIdentity()` in `derive.ts` builds `timestamp|component|pid|message`. `withRowKeys()` then
disambiguates exact duplicates — a script can emit the same line twice inside one second — by
appending an ordinal within the window, which is stable because the window is a tail and its
ordering never reshuffles.

The previous surface keyed rows on `${timestamp}-${index}`. Every new line arriving at the top
shifted every index below it, React saw a completely new key set, and **the entrance animation
replayed in full on every 10-second poll**. An identity key is what stops that; it is not a
lint-rule nicety.

### 4. The cascade is a MOUNT event, not a filter event

`transcript-card.tsx` holds a `cascade` boolean, initialised `true` and set `false` by the
first interaction with any control — a rail chip, the search field, either `Select`, the
archived switch, or the "Clear filters" action in the empty state. Rows pass
`initial={cascade ? "hidden" : false}`, so after the first touch a re-render swaps content
without re-choreographing it.

The entrance is a welcome; pressing **Error** is not an arrival. Same pattern, same rationale
as `components/monitoring/network-events/event-log-card.tsx`.

### 5. Feed state is a three-member union with a fixed precedence

`FeedState` in `hooks/use-system-logs.ts`:

| Member | Means | Reached by |
| ------ | ----- | ---------- |
| `live` | The interval is armed and the last read landed | The default |
| `paused` | Deliberately suspended | The browser tab is hidden, **or** the clear-confirmation dialog is open |
| `stopped` | The last read failed, so the feed is not delivering | Any failed read, background or foreground |

The resolution order is **`stopped` before `paused` before `live`**: a failed read while the
clear dialog is open reads "Stopped", not "Paused". The interval is genuinely torn down while
suspended (`pollSuspended` is a dependency of the effect), so the tile and the timer cannot
disagree — the face reports a real referent, not an intention.

> ℹ️ NOTE: when the poll resumes, `setInterval` is re-created and the **first tick is a full
> 10 s away**. Un-hiding the tab does not force an immediate read. The Feed caption's age
> counter keeps ticking, so this is visible rather than silent.

**The ambient ring is CSS-only.** `FEED_RING` applies `animate-pulse-ring`, a keyframe in
`globals.css` running on `--duration-ambient` (2 s) with its `prefers-reduced-motion` block
sitting beside it. The element is rendered only while `feedState === "live"`. Nothing starts,
stops or retimes it from JavaScript, and nothing should — this is the surface's one sanctioned
ambient loop, and it is sanctioned precisely because it is bound to a real running process.

---

## The status band

Three tiles, neutral bodies, colour only on the 52px disc. Each tile drives its tone **and** its
glyph off one state union — the `Face` pattern from `components/system-settings/status-band.tsx`
— never off three independent ternaries that can answer the same question differently.

| Tile | States | Disc tone | Glyph |
| ---- | ------ | --------- | ----- |
| **Severity** | `unread` / `errors` / `warnings` / `clean` | `neutral` / `destructive` / `warning` / `success` | `CircleDashedIcon` / `CircleXIcon` / `TriangleAlertIcon` / `CircleCheckIcon` |
| **Feed** | `live` / `paused` / `stopped` | `primary` / `neutral` / `neutral` | `RadioTowerIcon` / `PauseIcon` / `CloudOffIcon` |
| **Log file** | `unread` / `filling` / `resting` | `neutral` / `warning` / `neutral` | `FileClockIcon` / `FileWarningIcon` / `FileTextIcon` |

`FEED_FACE` is typed `satisfies Record<FeedState, Face>` against the hook's own union, so a
fourth feed state fails the build rather than rendering untoned.

Every state carries its **own** glyph and no two states in one slot share one. This is not
decoration: `success-container` and `warning-container` measure 1.03:1 apart and are identical
under deuteranopia, so the glyph is the only thing separating a healthy tile from a degraded one.

**Before any read has landed the band shows skeletons**, and where a read failed the tiles show
the `VALUE_NONE` em dash. A confident reading with no data behind it is a lie.

### The log-file threshold is a client-side mirror

`ROTATION_SIZE_KB = 256` in `derive.ts` mirrors `QLOG_MAX_SIZE_KB`'s **default** in `qlog.sh`,
and `ROTATION_WARN_KB` is 80% of it (205 KB). The backend does not report its own rotation
limit, so there is nothing to read.

> ⚠️ WARNING: if a device overrides `QLOG_MAX_SIZE_KB` in the environment, the tile's warning
> threshold is wrong and nothing detects it. If that override ever becomes a supported setting,
> `stats` must start carrying the limit and `derive.ts` must start reading it.

Also note `stats.current_size_kb` is integer KB from `wc -c` divided by 1024, so a log under
1024 bytes reports **0 KB**, not a fraction.

---

## The transcript card

`CardHeader` is a plain `CardTitle` + `CardDescription` with **no icon**, both carrying their
explicit ink constants because the shadcn primitives hardcode retired token values.

**Row 1 — the level rail.** Five 36px chips: All · Debug · Info · Warn · Error. Selection is
carried by a **fill** (`bg-primary` with its `primary-foreground` ink), never by a border, and
each chip renders its live count from `levelCounts()`. Counts are hidden while loading and in
the unreadable state, where they would be zeros pretending to be measurements.

**Row 2 — the rest.** Search field (400 ms debounce), component `Select`, line-budget `Select`,
archived `Switch`, all on the family's 42px `FIELD` grammar with pill radius.

> ⚠️ WARNING: the coarse-pointer height bump on the two `Select` triggers is written
> `pointer-coarse:h-11!` with the important marker **inside** the exported constant. Two traps
> stack here. `select.tsx` ships its own height behind a data-attribute selector that outranks a
> bare media-variant utility; and a marker appended at the call site never appears as a literal
> in source, so Tailwind's scanner never emits the rule and `tsc`, ESLint and `next build` all
> stay green while the style silently does nothing. The bare `Switch` paints roughly 18×32, so
> it reaches the touch floor through `COARSE_TARGET`, a pseudo-element overlay that does not
> move the row's baseline.

**The log.** Day-grouped with a label (`Today` / `Yesterday` / a formatted date, or `Undated`
for a timestamp this UI could not parse) and a rule on every group after the first. Rows sit
6px apart with no hairlines between them.

`groupByDay()` is a run-length pass over an **already-ordered** array — it does not sort. It is
correct only because `transcript-card.tsx` reverses the payload to newest-first first. Reorder
one without the other and days will fragment into repeated groups.

The crossfade between states shares a single grid cell (`CROSSFADE_STACK`), so the swap
contributes zero layout shift, and the `AnimatePresence` child is keyed on
`` `${level}-${component}-${lines}` `` — **not** on the search text or the archived switch,
which update in place rather than crossfading.

---

## The row

52px, **pinned** rather than floored: 8px of padding over an 18.9px message line, a 2px gap and
a 16px meta line. A floor cannot mirror a skeleton, and `SKELETON_ROW` composes the same
exported height constant the real row uses, so the two cannot drift.

Anatomy, left to right: a 32px glyph disc · a body column with the message (truncated, 14px/500)
over a meta line carrying the component as a `Tag variant="neutral"` and the PID as mono machine
voice · a right column with relative age over clock time, both `tabular-nums`.

### Tone

`ERROR` and `WARN` rows take a **tonal container**; `INFO` and `DEBUG` do not.

| Level | Container | Disc | Chromatic |
| ----- | --------- | ---- | --------- |
| `ERROR` | `bg-destructive-container` / `text-on-destructive-container` | `bg-destructive` / `text-destructive-foreground` | yes |
| `WARN` | `bg-warning-container` / `text-on-warning-container` | `bg-warning` / `text-warning-foreground` | yes |
| `INFO` | `bg-surface-container` | `bg-primary` / `text-primary-foreground` | no |
| `DEBUG` | `bg-surface-container` | `bg-surface-container-high` / `text-on-surface-variant` | no |

Note the disc is a **fill** pair while the row is a **container** pair — the disc is the one
saturated element on a quiet row, which is what keeps a 500-row list from reading as a stripe
chart.

On a chromatic row the `Tag` and the mono PID take the container's **own** ink
(`border-current` / `text-current`), never the neutral ramp token. A neutral stroke on a
chromatic surface is a crossed pair.

Tone changes transition on the standard duration, scoped to `background-color` and `color` by
name — never `transition-all`, never a bare `transition-colors`.

### The type chain is two hops, and both are enforced

```ts
LEVEL_TONE satisfies Record<LogLevel, BadgeVariant>   // level -> status role
ROW_TONE   satisfies Record<LevelTone, RowSpec>       // status role -> surfaces
```

A level the backend grows without a matching role fails the build, and a role without a row spec
fails the build. `DEBUG` maps to **`muted`** — the deliberately-quiet role — and never to
`secondary`, which is not one of the five status roles.

Four levels, four **distinct** lucide glyphs (`CircleXIcon` / `TriangleAlertIcon` / `InfoIcon` /
`BugIcon`), plus an `sr-only` severity word before the message so the level survives for a
screen reader that cannot see either the glyph or the fill.

---

## The five states

Every one of these is built, and all five are reachable on a real device.

| State | Reached when | Treatment |
| ----- | ------------ | --------- |
| **Loading** | `isLoading` — true until the first read settles, and **never true again** | Tile skeletons in the band; row skeletons wearing the row's own pinned height, inside the crossfade cell |
| **Empty — no log** | Zero rows, no filter active | `ConditionBlock tone="neutral"`, `role="status"`, `ScrollTextIcon`. Copy explains the RAM-disk/reboot behaviour. **No retry** — nothing failed |
| **Empty — filtered** | Zero rows, `filtersActive` | Distinct copy, plus a **Clear filters** action that resets level, component and search |
| **Error** | `error !== null` **and** `entries.length === 0` | `ConditionBlock tone="destructive"`, `role="alert"`, `UnplugIcon`, with a Retry, in place of the transcript |
| **Stale** | `error !== null` **and** entries in hand | A non-blocking `NOTICE` strip **above** the log, never replacing it |

Two rules make that table work:

- **A stale list beats a blank card.** A failed refresh with data already on screen must never
  swap the transcript for an error block. The distinction between Error and Stale is entirely
  `entries.length === 0`.
- **The silent refresh is not silent any more.** A failed *background* poll sets `error`, which
  drives the stale notice and flips the Feed tile to Stopped. The **toast is reserved for a
  user-initiated refresh** — `handleRefresh` in `system-logs.tsx` is the only caller that
  raises one. A background failure that interrupted with a toast every 10 seconds would be
  unusable.

`filtersActive` covers level, component and search — **not** the archived switch, and
`clearFilters()` does not reset it. Turning on "Include archived" and finding nothing therefore
shows the plain empty state, which is correct: archived is a widening control, not a narrowing
one.

---

## Geometry and the family boundary

`components/system-settings/logs/shapes.ts` is this route's **only** shape module, and it has a
deliberate two-source split.

**Imported** from `components/system-settings/shapes.ts` — the same family, one level up:
`PAGE_ROOT`, `PAGE_HEAD`, `PILL_ACTION`, `PILL_GLYPH`, `CARD_SHELL`, `CARD_PAD`, `CARD_TITLE`,
`CARD_DESC`, `FOCUS_RING`, `FIELD`, `COARSE_TARGET`, `EYEBROW`, `VALUE`, `VALUE_TEXT`,
`CAPTION`, `VALUE_NONE`, `TILE`, `DISC_TONE`, `DISC_TRANSITION`, `BAND`, `SKELETON`. These are
re-exported so components in this directory import from one place. Re-declaring twenty names
from the family's own module is the duplication the restate rule exists to prevent.

**Restated** — the transcript grammar (row, rail, day divider, notice, condition block):

> ⚠️ WARNING: this module must **never** import from
> `components/monitoring/network-events/shapes.ts`. That is a sibling family, and a sibling
> family's module is not a shared library. What is shared is the *system's numbers* — the 52px
> pinned row, the 32px row disc, the 36px filter chip, the 6px row gap — and they are copied,
> not imported. The same rule holds in reverse: nothing under `/monitoring` may import from
> here.

Other standing constraints on this surface:

- **`/system-settings` is a lucide route.** No Material Symbols anywhere in this family. See
  [`icon-system.md`](./icon-system.md).
- **No raw durations and no bare `transition-all`.** Three durations, two curves, two stagger
  steps, no springs — every custom property is referenced through `var()`, because the bare-var
  arbitrary shorthand is invalid CSS in Tailwind v4 and is dropped silently.
- **The cascade root declares `initial`/`animate` exactly once**, on the page shell. A
  `staggerItem` child that declares its own detaches from the clock.
- **Row cascade delay comes from `rowCascadeDelay(index)`** in `lib/motion.ts`, which caps the
  total so a 500-line window does not choreograph for half a minute. The delay keys off a row's
  **flat** position, derived once into a `Map` because the day groups no longer carry it.

---

## Gotchas in the frozen backend

These are read from `logs.sh` and `qlog.sh`, not observed on a device. None of them were
introduced or fixed by the re-authoring; they are the shape the client has to live with.

### `available_components` is polluted with timestamp fragments

`get_components()` extracts names with:

```sh
grep -h -o '\[[^:]*:' $sources | sed 's/\[//;s/:$//' | sort -u
```

On a line like `[2026-09-06 01:02:03] INFO  [poller:1234] ...` the **first** bracket that
matches is the timestamp's, because `2026-09-06 01` contains no colon. `grep -o` emits it,
resumes after it, and then correctly finds `[poller:`. So the list comes back as real component
names **plus one `YYYY-MM-DD HH` fragment per distinct hour present in the sources**.

The component `Select` renders `available_components` verbatim, so those fragments appear as
selectable options. Picking one filters on an exact component match that nothing will ever
satisfy, producing an empty-filtered state. Toggling "Include archived" widens the sources and
therefore lengthens the pollution.

Fixing it means anchoring the pattern past the timestamp block in `logs.sh` — a backend change,
out of scope for the frontend pass, and recorded here so the next person does not assume the
client is mangling the list.

### `stats` describes the current log only

`get_stats()` reads `/tmp/qmanager.log` and counts how many rotated files exist. It never counts
lines inside them. With "Include archived" on, the transcript can legitimately show **more**
lines than `stats.current_lines`, so the card description can read "Showing 400 lines. The live
log holds 180." That is honest — the two numbers measure different things — but it surprises
people, and `current_lines` must not be repurposed as a total.

### `DEBUG` is usually absent entirely

`QLOG_LEVEL` defaults to `INFO`, and `_qlog_write` returns early below that threshold. On a
stock device **no `DEBUG` line is ever written**, so the Debug rail chip reads `0` and is not
broken. It only populates on a device that exports `QLOG_LEVEL=DEBUG` for a component.

### `search` matches the whole raw line

The awk pass lowercases and searches `$0`, not the parsed message. Searching `error` also
matches the level word, and searching `2026-09-06` matches every line from that day. Useful, and
not what the placeholder copy implies.

### Minor residue

- `parse_logs`'s awk carries a three-argument `match(rest, /.../, _)` whose result is never
  read; the level actually comes from the `split()` on the next line. Vestigial.
- The `{"action":"status"}` POST branch has no client. It predates `stats` being folded into
  the GET response.

---

## i18n

Every user-visible string on this surface is keyed under `logs.*` in the **`system-settings`**
namespace, in all five packs (`en`, `zh-CN`, `zh-TW`, `it`, `id`). The surface it replaced
called `t()` **zero** times.

Notable shapes:

- Pluralised keys use i18next's `_one` / `_other` suffixes (`band.severity.errors`,
  `band.file.caption`, and the severity captions).
- Relative ages are **not** formatted in `derive.ts`. `relativeAge()` returns a
  `{ unit, count }` pair and the caller resolves `logs.time.<unit>` with the count, so unit
  words are translatable rather than concatenated.
- Casing lives in the class (`uppercase` on `EYEBROW`), never in the locale value — casing in
  content does not translate.

> ⚠️ WARNING: the locale packs are **CRLF**. A naive `JSON.parse` → `JSON.stringify` round-trip
> rewrites every line ending and produces a whole-file diff. `bun run i18n:check` is a hard
> gate and exits 1 on a missing key or an empty value. See [`i18n.md`](./i18n.md).

---

## Known debt

- **No request cancellation.** `fetchLogs` has no `AbortController`. Rapid filter changes can
  leave two reads in flight, and the later `setState` wins by arrival order rather than by
  request order. In practice the 400 ms search debounce plus a fast local CGI makes this hard
  to hit, but it is a real race.
- **Two independent one-second tickers** run while the page is open — one in `status-band.tsx`
  for the Feed caption's age, one in `transcript-card.tsx` for row ages. They are cheap and
  independent of the 10 s data poll, but they are duplicated.
- **`available_components` pollution** (above) is a backend fix nobody has taken.
- **The rotation warn threshold is a client-side mirror** of a backend default with no wire
  representation.

---

## Related

- [`system-settings.md`](./system-settings.md) — the route index and the shared family module
  this one imports from
- [`recent-activities.md`](./recent-activities.md) — the product's other transcript surface;
  the structural model this row anatomy was restated from
- [`tmp-file-ownership.md`](./tmp-file-ownership.md) — why `/tmp/qmanager.log` is seeded
  `root:root 0666` and why rotation re-asserts it
- [`icon-system.md`](./icon-system.md) — the route-scoped lucide/Material boundary
- [`i18n.md`](./i18n.md) — the translation gate
- [`tailwind-prose-hazard.md`](./tailwind-prose-hazard.md) — why this doc describes bracketed
  utility spellings in words instead of quoting them
