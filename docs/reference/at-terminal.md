# AT Terminal (`/system-settings/at-terminal`)

> **Applies to:** RM520N-GL (SDX65) · frontend re-authored onto the design canon 2026-09-08
> **RG501Q-EU (SDX55):** unverified — see [`platform-matrix.md`](./platform-matrix.md)
> Family: `components/system-settings/at-terminal/**` · namespace `public/locales/*/system-settings.json`, `at_terminal.*` subtree

AT Terminal is a raw command line onto the modem's own command interpreter: type an
`AT` command (`AT` is the prefix every command a cellular modem understands starts
with — a decades-old convention from Hayes-compatible modems), the CGI hands it to
the modem, and the modem's literal answer comes back. It exists for the case every
other page in the product is deliberately too safe for: a query or a knob the UI
has no card for yet, or a support session where someone on GitHub Issues asks for
the output of a specific command.

The backend was **not touched** by this pass. Everything that changed is on the
client: the card moved off a hand-rolled header and raw text-color rows onto
`CardHeader`/`Badge`/`ConditionBlock`, the transcript gained per-row copy and a
"stay at the foot unless you've scrolled up" rule, the safety rules moved from
inline English sentences to a pattern-plus-locale-key table, and the 26 built-in
presets gained functional grouping, and every string on the surface was keyed
across all five locales. This doc covers the safety-rule contract, the Signal
Storm launch seam, the transcript's follow-the-foot behaviour, and what the pass
deliberately left alone.

---

## Quick Reference

| Thing | Where |
| ----- | ----- |
| Route | `app/system-settings/at-terminal/page.tsx` (a five-line re-export) |
| Page shell | `components/system-settings/at-terminal/at-terminal.tsx` |
| Card | `components/system-settings/at-terminal/at-terminal-card.tsx` |
| One transcript row | `components/system-settings/at-terminal/transcript-row.tsx` |
| Commands popover + Manage dialog | `components/system-settings/at-terminal/commands-popover.tsx` |
| Geometry + tone | `components/system-settings/at-terminal/shapes.ts` (the route's own module) |
| Derivations, safety rules | `components/system-settings/at-terminal/derive.ts` (pure; no React, no classes) |
| Built-in presets | `constants/at-commands.ts` (26 presets, 6 categories) |
| CGI endpoint | `POST /cgi-bin/quecmanager/at_cmd/send_command.sh` |
| History storage | `localStorage` key `qm_at_history`, capped at 100 entries |
| Custom-preset storage | `localStorage` key `qm_at_custom_commands` (in `commands-popover.tsx`) |
| Easter egg | `AT+GAME` launches Signal Storm — **out of scope**, see below |
| Icon family | **lucide** — `/system-settings` is a lucide route, no Material Symbols here |

---

## The safety rules are a table, not a sentence

`derive.ts` holds two small rule arrays, each a regex paired with a **key**, never
with an English sentence:

```ts
const BLOCKED_RULES = [
  { key: "qscanfreq", pattern: /\bQSCANFREQ\b/i },
  { key: "qscan", pattern: /\bQSCAN\b/i },
  { key: "resetfactory", pattern: /QCFG\s*=\s*"resetfactory"/i },
];
const WARNING_RULES = [{ key: "radio_off", pattern: /CFUN\s*=\s*[04]\b/i }];
```

The key resolves to `at_terminal.rules.<key>` at render time, in whichever
component needs the sentence. A rule table holding English prose would only ever
be able to speak English; a rule table holding a key can speak whatever pack the
UI is in. This is the same shape the family uses everywhere a fixed reason needs
to reach more than one place — see `lib/i18n/resolve-error.ts` in
[`languages.md`](./languages.md) for the sibling pattern.

**Blocked** commands never reach the backend at all. `matchBlocked()` short-circuits
`handleSubmit` into a synthetic `status: "blocked"` entry before `sendCommand` is
ever called — `QSCAN`, `QSCANFREQ` (the Cell Scanner's own AT verbs — this route
tells the user to go use that page instead) and the `resetfactory` `QCFG` value are
refused outright. **Warning** commands (today: `AT+CFUN=0` and `AT+CFUN=4`, which
turn the radio off) open a confirmation gate — a filled `warning-container` panel
inline in the transcript pane, described below — rather than sending immediately.

Both tables are checked in `handleSubmit`, in order: the literal `AT+GAME` string
first, then `matchBlocked`, then `matchWarning`. A command that happens to match
more than one rule is caught by whichever check runs first; today's three blocked
patterns and one warning pattern do not overlap, so this has never mattered in
practice, but a new rule that does overlap an existing one resolves to the earlier
check silently.

---

## The confirmation gate is state, not a dialog

`PendingGate` (`{ command, rule }`) sits in `at-terminal-card.tsx`'s own `useState`,
not in a `Dialog`/`AlertDialog` primitive. When `matchWarning` matches, `gate` is
set and the card renders `GATE` — a tonal panel with the rule's sentence, the
command quoted in mono, and two raw `<button>`s (**Send Anyway** / **Cancel**),
inline in the transcript pane rather than as a modal overlay.

The two buttons are raw buttons re-grounded on the panel's own ink
(`GATE.CONFIRM` / `GATE.DISMISS`), not `Button variant="ghost"` over the tonal
fill. `shapes.ts` documents why in a two-line comment: `ghost`'s
`dark:hover:bg-accent/50` compiles to a `:is(.dark *)`-qualified selector, which
outranks a plain `hover:` override written at the call site — so a `variant="ghost"`
button sitting on a tonal container silently loses its hover colour in dark mode.
The fix used here is the same one `ConditionBlock`'s own retry button uses: skip
the primitive, write the two states directly.

While `gate` is non-null, `inputDisabled` is true and the completion-hint row is
suppressed (`suggestions.length > 0 && !gate`) — the gate is the only thing on
screen that can accept input focus. **Send Anyway** clears `gate`, stamps
`lastCommand`, clears the input, and calls `sendCommand` directly — it does not
re-run `matchBlocked`/`matchWarning`, so editing the command is not possible from
inside the gate; **Cancel** clears `gate` and returns focus to the prompt with the
original text still in it.

---

## The Signal Storm launch seam

Typing `AT+GAME` (case-insensitive, matched against the trimmed, upper-cased
input) does not call the backend. `handleSubmit` special-cases the literal string
first, ahead of the safety-rule checks:

1. Appends a synthetic `success` entry whose response is the translated
   `at_terminal.responses.game` string.
2. Clears the input immediately.
3. `setTimeout(() => setGameActive(true), 500)` — the half-second delay is what
   lets the synthetic entry's mount animation actually play before the card body
   is replaced outright.

Once `gameActive` is true:

- The header's action cluster (Commands popover, Clear, Export) is replaced by a
  single `Badge variant="info"` reading "Playing Signal Storm" — a status chip,
  not a text label, so it degrades to a filled tonal pill in every locale rather
  than an English sentence nobody translated (the header actions and the chip are
  siblings inside the same `CardAction`, swapped by one ternary).
- The card's body — the whole `gameActive ? <SignalStormGame .../> : <>...</>`
  branch — swaps from the transcript/hint/gate stack to `SignalStormGame`, mounted
  as a **direct `Card` child**, not inside a `CardContent`. The comment on this
  branch says why: the game keeps the full-bleed slot it has always had, and
  wrapping it in the family's padded content box would inset a canvas game that
  was built to fill the card edge-to-edge.
- `inputDisabled` folds in `gameActive`, so the (now-hidden) prompt bar cannot
  receive a command while the game owns the card.
- **Esc-to-exit is not implemented in this file.** `onExit={() => setGameActive(false)}`
  is the only contract between the card and the game: the game module owns its
  own keydown handling and calls `onExit` when the player backs out. The card's
  job ends at flipping `gameActive` back to false, which restores the header
  actions and the transcript.

Signal Storm itself — `signal-storm-*.{ts,tsx}` — is roughly 3,600 lines across
eight modules (engine, sprites, bosses, audio, labels, types, and the component
shell) and is **excluded from every design pass**, this one included. Nothing in
this doc describes its internals; the launch seam above is the entire contract a
future change to this card needs to preserve.

---

## The transcript follows the foot, but only if you were already there

`viewportRef` is the scrolling container; `historyEndRef` is a sentinel `div`
after the last row. A `useEffect` keyed on `history` calls
`historyEndRef.current?.scrollIntoView(...)` on every change — but only when
`followRef.current` is true.

`followRef` is not read at effect time. It is **sampled inside `appendEntry`**, via
`isNearBottom(viewportRef.current)`, before the new row is added to state:

```ts
const appendEntry = useCallback((entry) => {
  followRef.current = isNearBottom(viewportRef.current);
  setHistory((prev) => [...]);
}, []);
```

The ordering is the whole trick. By the time the scroll effect runs, the new row
is already in the DOM and the viewport's `scrollHeight` has already grown — so
testing "am I at the foot" *after* the row lands would almost always read false,
because the foot moved out from under the read. Sampling before the append is
what lets a reader who has scrolled up to re-read an earlier response stay exactly
where they are when a new command completes, while a reader who was already
watching the bottom keeps riding it down. `isNearBottom` treats anything within
`FOLLOW_SLACK_PX` (56px) of the true bottom as "at the foot", so a reader does not
have to be pixel-perfect to keep following.

`prefersReducedMotion()` gates the scroll behaviour between `"smooth"` and
`"auto"` — a `matchMedia` read at call time, not a stored preference, so it tracks
a live OS-level toggle.

---

## The commands popover is grouped, and the grouping is data-driven

The 26 built-in presets (`constants/at-commands.ts`) now carry a `category` field
— `modem` / `network` / `sim` / `apn` / `bands` / `passthrough` — and
`groupedDefaults()` in `derive.ts` partitions them into one `CommandGroupSpec` per
non-empty category, in `AT_COMMAND_CATEGORIES`'s declared order. The popover
renders one `CommandGroup` per entry, so a flat 26-item list a reader had to scan
line by line to find a band query is now six short, labelled sections. **Empty
categories are dropped** — adding a category with no members yet never renders a
heading with nothing under it.

A built-in preset's `label` is not carried on the object at all — only an `id`.
The visible label is resolved at render time as `at_terminal.commands.presets.<id>`,
so the 26 labels are translatable; a **custom** preset's `label` is exactly what
the user typed into the Manage dialog, so it is never translated and travels with
the entry verbatim, in `ATCommandPreset` rather than `ATCommandDefault`.

The command preview beside each label is now an outline `Tag variant="neutral"`
(`POPOVER.PREVIEW`), not a plain `span` — the command string is metadata (an
identifier the preset carries), which is exactly the case `Tag` exists for
(DESIGN.md's Two-Form Rule: identity and metadata are never a `Badge`).

The Manage Custom Commands dialog is unchanged in behaviour from before this pass:
built-ins are not editable or removable, only custom presets are; adding one
validates non-empty fields, an `AT`-prefixed command (case-insensitive), and
rejects a duplicate command or duplicate label against the **combined** built-in +
custom set — where "duplicate label" now compares the custom label against the
built-ins' *translated* labels (`allLabels` maps every built-in through `t()`
before the comparison), so a duplicate check runs against whatever pack the UI
happens to be in.

---

## Status is a role, not a colour name

`STATUS_TONE` in `shapes.ts` keys each `EntryStatus` (`success` / `error` /
`blocked`) onto a `BadgeVariant`, `satisfies Record<EntryStatus, BadgeVariant>` —
so a fourth status the transcript ever grows fails the build rather than
rendering with no tone at all:

```ts
export const STATUS_TONE = {
  success: "success",
  error: "destructive",
  blocked: "muted",
} satisfies Record<EntryStatus, BadgeVariant>;
```

**`blocked` is `muted`, not `destructive`.** A command the client refused to send
is not a failure — nothing was attempted, nothing broke — so it takes the
deliberately-quiet role, the same one Logs' `DEBUG` rows and Languages' inactive
states use. `error` is the only status that means something actually went wrong.

`ROW_INK` is a second map, keyed onto the **tone** (`StatusTone`) rather than onto
the raw `EntryStatus`, specifically so the two maps cannot drift independently —
if a status's role ever changes in `STATUS_TONE`, its ink follows automatically
through the same key. Three glyphs, one per status, sourced from lucide
(`CheckCircle2Icon` / `XCircleIcon` / `MinusCircleIcon`) — never shared between
two statuses, the same rule every status chip in the product follows, because the
container fills alone do not separate reliably under deuteranopia.

The command line itself is **never** tinted by status — `ROW.COMMAND` always
takes the card's own ink. Colouring what the user typed would say the *input* was
at fault; only the response line and the glyph carry the tone.

---

## The row's copy affordance answers to hover AND focus

`transcript-row.tsx` renders a per-row copy `Button`, `opacity-0` at rest and
`opacity-100` on `group-hover/row` **or** `group-focus-within/row`. The `/row`
named group (`group/row` on `ROW.ROOT`) is what makes this possible without a
second state variable — a naive `group-hover:opacity-100` alone would make the
button permanently invisible to anyone tabbing through the transcript with a
keyboard, since a keyboard user never triggers `:hover`.

Copying writes `entryToText(entry)` — the command and response joined by a
newline, no timestamp — to the clipboard, and flips a local `copied` boolean for
1600ms that swaps the glyph from `CopyIcon` to `CheckIcon` and the `aria-label`
from the copy word to the copied word. A denied clipboard permission is swallowed
silently; the comment in the code says why: the transcript text is still
selectable by hand, so a failed `navigator.clipboard.writeText` is not worth an
error state.

**Timestamps are now rendered.** `HistoryEntry.timestamp` used to exist only for
`formatExport`'s `[HH:MM:SS]` prefix (recon before this pass confirmed the field
was written on every entry but never read by the visible UI). `clockTime()` in
`derive.ts` now formats it for a leading `ROW.TIME` column — `tabular-nums`,
24-hour, so a column of times stays a column rather than a ragged edge — and it
still feeds `formatExport` unchanged, so the two consumers agree on the same
stored value.

---

## What this pass deliberately did not change

The **backend was not touched**. `send_command.sh` still takes one command and
returns one response, statelessly, and this route still reads that response
untyped. There is no server-side command log and this pass did not invent one.

The **card has no loading, error or global-failure state**, and that is unchanged
on purpose. The only in-flight affordance is the Send button's own spinner, and a
network failure surfaces as one more transcript row rather than a card-level
condition. The three-state contract exists for a resource with a lifecycle; this
endpoint is a fire-and-forget POST per command, so a card-level skeleton would be
describing a fetch that never happens.

**Signal Storm was not opened.** It is ~3,600 lines across eight modules — around
3.4x the design surface of the route that hosts it — and it is an easter egg, not
a product surface. Only the launch seam above is in scope for a design pass.

## Geometry and the family boundary

`components/system-settings/at-terminal/shapes.ts` follows the `logs/` /
`connection-quality/` precedent (documented in [`languages.md`](./languages.md)'s
warning about the family's two competing conventions): it imports and re-exports
`CARD_DESC`, `CARD_PAD`, `CARD_SHELL`, `CARD_TITLE`, `FOCUS_RING`, `PAGE_HEAD`,
`PAGE_ROOT` and `PILL_ACTION` from `components/system-settings/shapes.ts` one
level up, and restates everything the console itself invents — the transcript
row, the gate, the prompt bar, the popover.

**The transcript deliberately breaks from the family's tonal-row convention.**
Every other card in this family lays rows on a `ROW_GROUP` (a tonal
`surface-container` group holding individually-radiused fields). The transcript
instead uses hairline rules — `divide-y divide-border border-y border-border` —
because this is a **log view**, not a settings surface: density survives a
hundred-row scrollback on hairlines where it would not on a stack of a hundred
individually-padded tonal pills. `shapes.ts`'s own header comment states this
explicitly as the one place this module's grammar diverges from its siblings'.

Four new geometry numbers this route adds, none borrowed from a sibling: a 42px
prompt field (`PROMPT_HEIGHT`, important-marked and written exactly once — see
the Tailwind hazard note below), a 36px header action, a 32px confirmation-gate
disc, and a 28px per-row copy button.

> ⚠️ WARNING: `PROMPT_HEIGHT` and `MANAGE.FIELD`'s height both carry
> `h-[2.625rem]!` with the important marker **inside** the exported string
> literal, for the reason every other important-marked constant in this family
> carries it there: a marker appended at the call site never appears as a literal
> in source, so Tailwind's scanner never emits the rule at all, and `tsc`, ESLint
> and `next build` all stay green while the height silently does nothing. See
> [`tailwind-prose-hazard.md`](./tailwind-prose-hazard.md).

The prompt bar's fill (`PROMPT.ROOT`) is `surface-container` — one step above the
card's own `surface` — following the family's Field-Step Rule, with the dark-mode
half written out explicitly and important-marked for the same name-sort reason:
once both the primitive's own dark fill and the call site's are prefixed, they
tie, and Tailwind's alphabetical tie-break would otherwise decide the surface
rather than the call site.

---

## i18n

Every string on this surface is keyed under `at_terminal.*` in the
**`system-settings`** namespace, and all five packs define the subtree.

Keys are built with template literals — `` t(`${K}.page.title`) `` — with `K` a
module constant. That shape matters for verification: **`i18n:check` cannot see a
template-literal key.** It compares each pack against the English superset and
never reads a call site, so a key the code calls that no pack declares passes the
gate silently and ships a raw key string on screen. The gate is necessary, not
sufficient.

The dynamic segments resolve against their own source of truth rather than a
hand-kept list, which is what keeps the set honest as the data changes:

| Segment | Resolved from |
| --- | --- |
| `commands.presets.<id>` | `DEFAULT_AT_COMMANDS` in `constants/at-commands.ts` |
| `commands.groups.<cat>` | `AT_COMMAND_CATEGORIES`, plus the popover's `custom` heading |
| `rules.<rule>` | `BLOCKED_RULES` + `WARNING_RULES` in `derive.ts` |
| `transcript.status.<s>` | the `EntryStatus` union |

Adding a preset, a category or a safety rule therefore adds a key. Verify by
diffing the referenced set against the declared set **both ways** — a key called
but not declared renders raw, and a key declared but not called fails the gate,
which rejects extras as well as omissions.

---

## Known debt

- **The Manage dialog's duplicate-label check compares against *translated*
  built-in labels**, so whether a custom label is rejected as a duplicate depends
  on the active language, and a label saved under one locale can collide under
  another. This is deliberate rather than accidental: the check exists to stop a
  user creating a label that duplicates one they can currently see. The
  language-independent check is `allCommands`, on the AT string itself, which is
  the one that does the real work.
- **The Manage dialog's duplicate-label check does not re-run when the active
  language changes mid-session.** `allLabels` is memoized on `[groups, customCommands, t]`,
  so a stale `t` reference would be a real bug — it is not stale here because
  `t` itself changes identity on a language switch — but this has not been
  exercised against a live language switch while the dialog is open.
- **No loading, error, or global-failure state exists at the card level.** The
  only "loading" affordance is the Send button's own spinner; a network failure
  surfaces as one more transcript row, not a card-level condition. This mirrors
  the pre-pass behaviour and was left unchanged, since the endpoint is a
  fire-and-forget POST per command rather than a resource with its own lifecycle.

---

## Related

- [`web-console.md`](./web-console.md) — the sibling console surface; shares the
  family's page shell and the two-source `shapes.ts` split
- [`system-settings.md`](./system-settings.md) — the route index and the shared
  family module this one imports from
- [`languages.md`](./languages.md) — the pattern-plus-locale-key precedent this
  route's safety-rule table follows, and the family's two competing shape-module
  conventions
- [`icon-system.md`](./icon-system.md) — the route-scoped lucide/Material boundary
- [`i18n.md`](./i18n.md) — the translation gate and its blind spot for a key no
  pack declares
- [`tailwind-prose-hazard.md`](./tailwind-prose-hazard.md) — why an
  important-marker appended at a call site compiles to nothing
