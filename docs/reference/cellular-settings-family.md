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
| `FIELD_INPUT` | Any free-text field on the family |
| `FIELD_SHELL`, `FIELD_SHELL_ON_FILL` | IMEI Settings (both cards), APN Management |
| `INLINE_ERROR` | Inline validation copy on a plain card |
| `SECTION_DIVIDER` | A rule *between sections inside* a card |
| `READOUT_ROW.GRID` | APN Management's "What the network granted" strip |
| `EMPTY_BLOCK` | **Renamed** from `AMBR_EMPTY` — it is no longer AMBR-specific |

---

## The shared contract

### Rows are neutral at rest and promote to `primary-container` when dirty

A setting row with an unsaved edit gets `bg-primary-container text-on-primary-container`. That promotion is **the brand acting** — a pending edit is an action awaiting commit, which is exactly what `primary` means in this system.

**It is not a status.** A dirty row is neither "good" nor "warning", so no functional role (`success` / `warning` / `destructive`) may ever be spent on pendingness. This is the same Functional-Color Promise DESIGN.md states: a user learns one meaning for red once, and a surface that reuses it for something else breaks that lesson everywhere.

Two consequences that are easy to get wrong:

- **Every control that can land on a promoted row needs an `_ON_FILL` twin.** `SEGMENTED.SEGMENT_ON_FILL`, `SELECT_TRIGGER_ON_FILL`, `FIELD_SHELL_ON_FILL` all exist because leaving the neutral variant in place puts one role's ink (or fill) on another role's container — a *cross-pair*, and the single most common way this pattern goes wrong.
- **No row carries a border.** Rows are separated by a hairline divider *inside* the group (`ROW_GROUP.DIVIDER`); a promoted row drops the divider by covering it, never by drawing an outline.

Compute the dirty flag **once** and pass it to both the row and its control. Computing it twice is how the IMEI field ended up neutral on a promoted row.

### `RATE_CHIP`: direction is not a radio

The AMBR (Aggregate Maximum Bit Rate) chips on `/cellular/settings` carry **`bg-downlink` / `bg-uplink`** fill pairs — `RATE_CHIP.ON_DOWNLOAD` and `.ON_UPLOAD` at `components/cellular/settings/shapes.ts:1064`. The radio identity still lives one layer out, in the block's own container fill (`AMBR_BLOCK.LTE` / `AMBR_BLOCK.NR`).

**They used to be `bg-primary` (download) and `bg-lte` (upload), and that was a real mistake worth not repeating.** The reasoning at the time was local and correct as far as it went: Uplink Cyan sitting inside the violet LTE block read as a discordant third accent, so the chips reached for blue and violet to match the block family. That fixed a local adjacency by **spending the two radio identity hues on a fact that is not about radios** — inside the LTE block, an upload chip then rendered in the LTE hue for reasons having nothing to do with LTE, and blue meant 5G NR, the brand, "in progress" *and* download depending on which page you were reading.

Direction now has its own axis, so the chips sit **on** the block's radio container rather than borrowing from it. A rose download chip inside a violet LTE block is legible as two independent facts instead of one muddled one. See [color-system.md](color-system.md).

Two invariants the chip carries regardless of hue:

- **The arrow glyph is the direction's second channel**, never optional. At container lightness in dark mode this system's tonal pairs collapse under red-green colour-vision simulation, so on a dark block the arrow is the information and the hue is reinforcement.
- **Fill pairs, never an alpha wash.** An earlier draft wrote `bg-lte/25`; an alpha is a different perceived lightness in each theme, where `bg-downlink` + `text-downlink-foreground` is a real pair in both. The pairs are declared in `shapes.ts`, so a consumer must **not** also set an ink class on the chip.

### The field-shell pair, and why `components/ui/input.tsx` is unusable here

Free-text fields on this family are a **raw `<input>`** carrying `FIELD_SHELL` (or `FIELD_SHELL_ON_FILL` when its row is promoted) — not the shadcn `Input` primitive.

**Short version:** `tailwind-merge` de-duplicates classes *per modifier*, so an unprefixed override cannot displace a `dark:`- or `md:`-scoped class. Both survive, and the scoped one wins wherever it applies.

The mechanism matters because the failure is invisible in review. `input.tsx` ships `dark:bg-input/30` and `md:text-sm`. Handing it `SELECT_TRIGGER`'s unprefixed `bg-surface-container-high` and text size does **not** replace those — tailwind-merge treats `bg-*` and `dark:bg-*` as different groups, keeps both, and the `dark:` rule wins in dark mode. So the field silently reverts to the primitive's fill in dark mode and to the primitive's type size above 768 px: the two axes a desktop light-mode review never looks at.

The primitive smuggles three more things past the same boundary:

| Primitive class | What it costs here |
| --------------- | ------------------ |
| `md:text-sm` | The field renders 14 px above 768 px while every sibling renders 13.5 px |
| `transition-[color,box-shadow]` with no duration | A raw Tailwind 150 ms — off the `--duration-*` scale, so it silently will not retune |
| `shadow-xs` | A cast shadow on an input, which DESIGN.md > Inputs forbids |
| `placeholder:text-muted-foreground` | A legacy token surviving in the rest state |

Overriding all of these at the call site means restating `SELECT_TRIGGER`'s own numbers as `dark:` and `md:` variants — which is the drift `shapes.ts` exists to prevent. Two independent builders hit this on two different pages in the same change and each wrote a local constant; `FIELD_INPUT` is that constant, promoted once so a third page cannot write a fourth version.

> ⚠️ WARNING: `FIELD_SHELL_ON_FILL` appends its placeholder ink **last** on purpose. It lands in the same tailwind-merge group as `FIELD_INPUT`'s placeholder colour, so order decides the winner. Reordering the template literal breaks it silently.

`font-mono` on these fields is not a costume — every consumer holds an identifier the device emits verbatim (an IMEI, a TAC, an APN), and the letter-spacing is what makes fifteen undifferentiated digits scannable. The **placeholder** deliberately drops back to `font-sans`: a placeholder is human-authored instruction, not machine output, and mono'd prompt text reads as though the field were already filled.

### Skeletons import the geometry, never restate it

Every consumer, **including the loading branch**, takes its numbers from `shapes.ts` (`SETTING_ROW.HEIGHT`, `REORDER_ROW.HEIGHT`, `CHOICE_ROW.HEIGHT`, `READOUT_ROW.HEIGHT`). A skeleton that hand-writes `h-12 w-48` has left the contract. Both Network Priority and Blocked Networks shipped with skeletons whose numbers matched nothing that rendered, and Network Priority's skeleton title and its loaded title were two different string literals — a visible title swap on every load.

Blocked Networks solves this differently and correctly: its loaded body is one text block, so its "skeleton" is the **same `ConditionScreen` component** driven transient. It cannot drift, because it is the same code.

### Motion: `SORTABLE_TRANSITION`

`lib/motion.ts` gained one export. `dnd-kit`'s `useSortable` defaults to `{ duration: 200, easing: "ease" }` and writes it into an inline `style.transition` string — a duration and a curve that are in neither the `--duration-*` scale nor the three-curve vocabulary, authored by a third-party hook rather than by anyone in this repo. `SORTABLE_TRANSITION` performs the two conversions dnd-kit needs (milliseconds, and a CSS easing *string*) once, on the `standard` step.

It is the only place in the product where a library authors a duration on our behalf, which is exactly why the conversion belongs in `lib/motion.ts` rather than at the call site — a retune of the scale has to reach it.

---

## APN Management

Route shell: `components/cellular/settings/apn-management/apn-settings.tsx`. The backend contract (`apn.sh`, the `apn_apply.sh` attach-cycle primitive, the `/etc/qmanager/apn_setting.json` sidecar) is unchanged — see [wan-profile-management.md](wan-profile-management.md).

### Three data sources, deliberately separate

| Hook | Clock | Answers |
| ---- | ----- | ------- |
| `useApnSettings` | one read on mount, re-read around a save | what is **configured** |
| `useMbnSettings` | its own | which carrier bundle is loaded |
| `useModemStatus` | the poller, ~2 s | what the network actually **granted** |

`useModemStatus` is a new dependency for this route. Keeping it separate is the point: collapsing "configured" and "granted" into one source would let a stored value masquerade as a negotiated one, which is the exact class of bug the `AT+CGCONTRDP`-not-`AT+CGDCONT?` rule exists to prevent on the backend.

### "What the network granted" — the read-only strip

A full-width card below the write surfaces, reading `network.apn`, `network.wan_ipv4` and `network.wan_ipv6` from the poller snapshot. IPv6 goes through `compressIPv6()` from `lib/ipv6.ts`, because the modem reports IPv6 in `+CGCONTRDP` as sixteen dotted **decimal** octets, not colon-hex.

Rules it holds to:

- **Rows, not tiles.** Two of the five values are a full APN and a full IPv6 (39 chars even after RFC 5952 compression). At `1fr` of a card column each, the two values a technician opened the page to read are the two that truncate to noise. `READOUT_ROW.GRID` is a two-up label-left/value-right grid; the IPv6 row spans both columns.
- **Every unknown value degrades to an em-dash**, never to a plausible default. An empty string from the poller means "we do not know", not "none".
- **Bearer state is derived**, never asserted: "Attached" appears only when an address was actually granted.
- **The strip sits outside the profile-override `<fieldset>`.** When a Custom SIM Profile owns the APN the write surfaces go read-only, but a profile owning the APN does not make the network's answer less true — dimming live truth to 60 % opacity would be the page hiding the one thing still worth reading.

### The `detect_active_cid()` honesty gap — a known backend limitation

> ⚠️ WARNING: `detect_active_cid()` (`scripts/usr/lib/qmanager/cgi_at.sh:103`) **silently defaults to `"1"`** when both `AT+QMAP="WWAN"` and `AT+CGPADDR` fail to yield a CID, and the GET envelope carries **no confidence signal** to distinguish that guess from a real reading.

The frontend cannot tell a measured CID from a fallback, so the UI is worded for what is provable:

- Exactly **one** CID chip is rendered — for the CID reported as bearing the internet — rather than the comp's four chips, which would have invited a reader to treat the whole set as verified.
- Its label is **"in use for Internet"**, never "confirmed" or "verified".
- When no active CID is reported at all, the chip degrades to a muted "not reported" rather than defaulting to CID 1 in the UI as well.

**The fix is a backend one and was scoped out of this frontend-only change:** add a confidence field to the GET envelope (e.g. `active_cid_source: "qmap" | "cgpaddr" | "default"`), so the UI can say "in use" when it is read and "assumed" when it is not. Until that lands, do not strengthen the chip's wording.

### The MBN card

`AT+QMBNCFG` bundle selection. Rebuilt from two Selects to a **Switch** (automatic selection on/off) plus a promoted-row bundle list (`CHOICE_ROW`).

- **Selection is a promotion, not a radio circle.** The comp drew Material's `radio_button_checked` / `radio_button_unchecked`; neither glyph is in the font subset, and adding them means a Google Fonts round-trip plus a committed binary for an affordance this system already expresses better. The chosen row *is* a `primary-container` block — readable across the card, and it survives grayscale.
- **The list is a real `role="radiogroup"`** with roving tabindex: exactly one row is tabbable, arrow keys move focus *and* selection with wrapping, Home/End jump to the ends. Some carrier firmware ships twenty-plus bundles, and the previous list made every one of them its own tab stop while the arrow keys did nothing — a screen reader announced a radio group whose members behaved like a button list. `CHOICE_ROW.SCROLL_CAP` bounds the list in `rem` so it scales with the user's text size instead of clipping at 200 % zoom.
- **The save is now sequential, in dependency order** (bug fix): `auto_sel` is written first, and `apply_profile` only if that write landed. Auto-select must be OFF before a pinned bundle means anything. The previous card applied whichever single change it noticed first, so turning auto off *and* picking a bundle in the same pass **silently dropped the bundle**.
- **The reboot is offered, never taken.** QManager is served *by* the modem, so a reboot kills its own HTTP response. The write completes first; the reboot is a separate confirmed action that hands off to `/reboot/`.
- The card was **100 % untranslated** and is now fully keyed under `core_settings.apn.mbn.*`.

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

### Luhn validation now gates both write paths

> ⚠️ WARNING: The incumbent guard was a bare shape regex, `/^\d{15}$/`. A Luhn-invalid IMEI — a number the network will reject — could reach modem NVM, and the device needed a reboot to find out.

`validateImei()` had been sitting in `lib/imei-utils.ts` used only by the Tools card. It is now the gate on **both** `imei-settings-card.tsx` and `backup-imei-card.tsx`.

The two checks are staged deliberately: **shape first, then checksum.** Naming "not 15 digits" while the user is still typing would be noise, so the length message waits for a full field and only then does the checksum message appear. Both fail **inline** (`INLINE_ERROR`, or a filled `destructive-container` chip where the row may be promoted) rather than as a toast — a toast is gone in four seconds, and this is the one message a user must act on to proceed.

### The legal warning is a banner, not a tooltip

It used to be a 16 px `warning` glyph in an input addon whose tooltip had to be hovered — duplicated in two cards, with a **third, differently worded** copy in the loading skeleton, so the sentence visibly changed as the skeleton resolved. A notice a user must discover is not a notice. There is now one persistent page-level `Banner role="degraded"`, one wording, above everything it governs.

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
