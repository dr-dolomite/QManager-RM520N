# Handoff — execute the `/login/` design-language adoption

> **Status:** designed, mock published, **awaiting the user's answers to the three veto questions
> below**. Nothing in `components/` has been touched. This file is the executable brief — it is
> self-contained, so you do not need the published artifact to build from it.
>
> **Companion artifact** (carries the interactive mock, all ten states, the motion table and the
> 14-finding evidence list): <https://claude.ai/code/artifact/a3fb7e64-c22c-41cd-aa96-bdcf5b56e26f>
> Read it with the `Artifact` tool, `action: "read"`. **Do not block on it** — everything required
> to build is below.
>
> Supersedes `_handoff-login-redesign.md` (the recon brief). Delete both when this lands.

---

## Paste this into a fresh session

> Execute the `/login/` design-language adoption for QManager RM520N. The design is finalized and
> the mock is approved; read `docs/reference/_handoff-login-execute.md` in full and build from it.
> Follow `docs/reference/change-workflow.md` — this is **Tier 2, frontend-only (Lite Path)**, so
> Phase 4a (harness committed red first) applies, and `modem-investigator` /
> `installer-safety-auditor` do **not** fire. Start at Phase 4a. Do not redesign — the decisions are
> settled and the rationale for each is recorded below.

---

## ⛔ Blocked until three things are true

1. **The three veto questions below are answered.** They change what gets built, not how.
2. **The Overview commit has landed**, because this surface must *import* `components/pre-auth-type.ts`
   rather than create it. Verify with `ls components/pre-auth-type.ts` and
   `grep -n 'text-2xl' components/auth/login-component.tsx` — the file should exist and the grep
   should return nothing. If `text-2xl` is still there, the Overview has not landed; **wait**, do
   not create `pre-auth-type.ts` yourself.
3. **Findings 1, 2 and 13/14's line numbers have moved.** The Overview commit edits
   `login-component.tsx:275` and `:296`. Re-locate by symbol, never by the line numbers in this doc.

### The three questions

> **ANSWERED 2026-08-30 by the user: A = yes, B = yes (both discs), C = yes.**
> The full plan ships: hostname becomes the `h1`, both `primary-container` mark plates are deleted
> (login **and** `/`), and the recovery disclosure is built with the five-locale `SLOT` reshape.
> Harness assertions 4, 5 and 13 are all in scope.


| # | Question | Recommendation | If declined |
| --- | --- | --- | --- |
| **A** | Does the **hostname become the `h1`**? | **Yes.** It is the reframe; everything else follows. | Keep `text-2xl`→19px only and stop — this becomes a two-line type fix, not a redesign. Say so and re-scope. |
| **B** | Is the **76px `primary-container` mark plate deleted**, and does `/` follow? | **Yes on both.** Measured: the mark's tail renders **1.54:1** against that plate in dark mode. | Neutral `surface-container` plate is the sanctioned middle (3.42 / 4.81). Keeping `primary-container` means shipping the 1.54:1 knowingly. |
| **C** | Is the **`login.recovery.*` disclosure built**? | **Yes** — but it costs a five-locale copy reshape (see below). | Then **delete the four leaves**. Leaving translated copy unrendered indefinitely is the one option to argue against. Deleting them means the brand footer stays and finding 9 goes unfixed. |

**Question B has a cross-surface cost.** `DESIGN.md` > Typography requires the pre-auth pair to move
together, and `/` has the identical disc. The approved Overview plan does **not** include this
change. A "yes" therefore means a small follow-up edit to `components/public/overview-card.tsx`
inside this same commit — one class string, not a re-plan.

---

## What this change is

`/login/` is the last surface on the **Material-3 tonal** language that `PRODUCT.md` replaced on
**2026-08-16**. Same migration as `radio/summary-tiles.tsx`, the SMS strip (`084d7c1`), the Cell
Scanner triad (`e32258c`) and the Overview: **neutral surfaces, colour on the data-ink.**

On top of the migration, one composition decision:

> **The card currently greets, then asks. It identifies, then asks.** It spends 24px and its only
> colour on a constant string, and 14px muted, folded mid-sentence, on the hostname — the one fact
> on the screen that varies. `login-device-name.tsx`'s own header comment says its job is to answer
> "which modem am I signing into?", and the composition gives that answer the least weight on the
> card. Invert it: the device is the title, the action is its eyebrow.

---

## Target composition

```
div  bg-background relative grid min-h-svh place-items-center
     p-4 sm:p-7                          ← was a flat p-7
  ├─ corner chrome  LoginLanguagePicker + ModeToggle  (unchanged)
  └─ div  @container/login  w-full max-w-[404px]
       motion.div  bg-card rounded-hero shadow-[var(--shadow-whisper)]
                   flex flex-col py-9  px-6 @[25rem]/login:px-[34px]
                   gap-6 | gap-5 when a notice shows
       ├─ TonalBanner  warning / wifi_off     — ?reason=offline && !locked   (unchanged)
       ├─ TonalBanner  warning / lock_clock   — rate limited                 (unchanged)
       ├─ ZONE 1  IDENTITY   flex flex-col items-center gap-2.5 text-center
       │    ├─ mark, 48px, BARE — no disc, no plate
       │    └─ <LoginDeviceName variant="title" />   ← new variant, see below
       ├─ ZONE 2  FIELD      (unchanged anatomy: label / Input / eye / inline error)
       ├─ ZONE 3  SUBMIT     (unchanged: 48px pill, three labels in one grid cell)
       └─ ZONE 4  RECOVERY   "Can't sign in?" disclosure     ← replaces the brand footer
```

Four zones instead of three. Everything inside zones 2 and 3 is preserved verbatim except the
error-ink token and the two motion repairs.

### `LoginDeviceName` — the `title` variant

The component's own header comment sanctions this: *"If the Overview wants a third form … that is a
new variant, not a redefinition of this one."* **Additive only** — `signin` (used by `/`) and
`sentence` are not touched by the variant addition itself.

| Case | Renders |
| --- | --- |
| resolving | skeleton sized to the **19px** line box — see the Skeleton-Mirror note below |
| hostname present | eyebrow `t("login.sign_in_to_label")` + `h1` = the hostname |
| hostname absent | **no eyebrow**, `h1` = `t("login.welcome")` |

Type steps, all imported from `components/pre-auth-type.ts` — **restate nothing**:

- eyebrow → `PRE_AUTH_TYPE.EYEBROW` (11px / 600 / uppercase / `tracking-[0.11em]`) + `text-on-surface-variant`
- title → `PRE_AUTH_TYPE.CARD_TITLE` (19px / 600 / `-0.01em`), `min-w-0 max-w-full truncate`

The `sr-only` line stays `t("login.signing_in_to", { hostname })`. That is the point of the
"Sign in to" eyebrow: the visible copy and the screen-reader copy now **agree**, retiring the
`signing_in_as` / `signing_in_to` disagreement structurally rather than by picking a word.

**The silent-omission contract is preserved exactly.** No placeholder device name is ever rendered;
with no hostname the eyebrow disappears and the title falls back to an existing translated key.

**Consequence to handle:** `variant="sentence"` loses its only call site. **Delete the variant**;
**keep** `login.password_to_manage` / `login.password_to_manage_bare` per this repo's practice of not
breaking installed language packs.

### The recovery disclosure (only if question C is "yes")

```
button  w-full inline-flex items-center justify-center gap-1
        PRE_AUTH_TYPE.BODY (13px) font-medium text-on-surface-variant
        hover:text-foreground   +  MaterialSymbol "expand_more" size={18}
        rotate-180 when open, transition-transform on `standard`
panel   grid-template-rows 0fr→1fr on `emphasized`, opacity on `standard`
  div   bg-surface-container rounded-field px-4 py-3.5 mt-2.5
        13px leading-normal text-on-surface-variant, flex-col gap-2.5
    ├─ t("login.recovery.intro")
    ├─ row  MaterialSymbol "terminal" size={18}                 + option_reset
    └─ row  MaterialSymbol "settings_backup_restore" size={18}  + option_backup
```

The command chip is `font-mono text-[12px] bg-surface-container-high rounded-inline px-1.5 py-0.5`
— `surface-container-high` because its host is `surface-container` (the Field-Step Rule, applied to
a code chip). **This is the one legal mono on the surface**: `qmanager_reset_password` and
`.qmbackup` are copyable machine strings, which is exactly the Machine-Voice Rule's scope. Nothing
else on the card is mono — the countdown is `font-sans tabular-nums`, correctly.

**The copy cost, and it is the reason this is a question:** `login.recovery.option_reset` embeds a
literal `<code>` tag. This repo does not render markup from translations — it routes styled
substrings through `components/auth/interpolation-slot.tsx` (`SLOT` / `withSlot`). So the string
must be reshaped to the `SLOT` form in **all five locales** before it can be displayed. Those files
are **CRLF**; see Gotchas.

---

## Phase 4a — the harness, committed red first

Write it from this document, run it, commit it **red** with the failure count in the commit body.
The builder who writes the fix must not edit the harness. Assertions are text-anchored to names in
*this* plan, never to names invented while writing the fix. Harnesses live in `scripts/test/`;
`bun run package` gates only on `run-all.sh`, so a knowingly-red harness blocks nothing.

| # | Assertion | Pins |
| --- | --- | --- |
| 1 | `login-component.tsx` imports `PRE_AUTH_TYPE` and contains no `text-2xl`, no `text-xs`, no `text-[0.8125rem]` literal | Type steps imported, not restated |
| 2 | `login-device-name.tsx` exports a `"title"` variant and no `"sentence"` variant | The variant swap, both halves |
| 3 | `login-device-name.tsx` contains no `text-sm` and no `text-muted-foreground` | Findings 3 and 4 — the shared-file half |
| 4 | `login-component.tsx` contains no `bg-primary-container` | The mark plate (skip if question B was declined) |
| 5 | `overview-card.tsx` contains no `bg-primary-container` | The pair moves together (skip if B declined) |
| 6 | `login-component.tsx` uses `text-destructive-on-surface`, not a bare `text-destructive` | The Three-Layer Rule |
| 7 | The submit's locked/unlocked branch carries `transition-colors` **and** a `duration-[var(--duration-standard)]` | Finding 13 — the untokenized role morph |
| 8 | The field group's `opacity-50` branch carries a `duration-[var(--duration-standard)]` | Finding 14 |
| 9 | `app/login/page.tsx` matches `p-4` and `sm:p-7`; `login-component.tsx` matches `@container/login` and `@[` | Finding 12 — the zero-instrumentation surface |
| 10 | No `·` glue character anywhere in `login-component.tsx` or in `login.brand_label`'s render path | The No-Dot-Separator Rule |
| 11 | `formatLockout` contains no bare `"s"` string literal; the unit resolves through `t()` | Finding 8 |
| 12 | `login-component.tsx` contains no literal `duration-[0-9]` and no `{ duration: 0.` outside a `reducedMotion` guard | The One-Scale Rule |
| 13 | If C is yes: `login.recovery.toggle` has ≥1 call site, and no locale's `option_reset` contains `<code>` | The orphan retired, and the markup actually reshaped |
| 14 | `login-component.tsx` has exactly **four** `variants={staggerItem}` children | The zone cascade is 4, not 3 |

---

## Phase 4b — the fix, in dependency order

| # | File | Change |
| --- | --- | --- |
| 1 | `public/locales/{en,zh-CN,zh-TW,it,id}/common.json` | Add `login.sign_in_to_label` ("Sign in to"). If C is yes, reshape `login.recovery.option_reset` from `<code>…</code>` to the `SLOT` form. **CRLF — see Gotchas.** |
| 2 | `components/auth/login-device-name.tsx` | Add `variant="title"`; delete `variant="sentence"`; move both remaining variants onto `PRE_AUTH_TYPE` steps and `text-on-surface-variant`. Skeleton mirrors the 19px line box. |
| 3 | `components/auth/login-component.tsx` | Zone 1 re-composed (bare 48px mark + `LoginDeviceName variant="title"`). Error ink → `text-destructive-on-surface`. Submit morph and field dim get `standard` transitions. Brand footer → recovery disclosure (or footer stays, if C declined). Add `@container/login` + the `@[25rem]/login:px-[34px]` step. Correct the `:296` and `:428` comments — **both currently reason from values the code does not contain.** |
| 4 | `app/login/page.tsx` | Page gutter `p-7` → `p-4 sm:p-7`. Wrap the card in the `@container/login` element. |
| 5 | `components/public/overview-card.tsx` | **Only if B is yes:** the same disc deletion, one class string. |

### i18n

- **One new key**, `login.sign_in_to_label`, in all five locales. `bun run i18n:check` must pass at
  100% parity.
- `login.brand_label` loses its call site. **Keep the key.**
- `login.password_to_manage` / `_bare` lose theirs. **Keep both.**
- If C is declined, the four `login.recovery.*` leaves are **deleted** from all five locales.

---

## Motion — the full accounting

Three durations, three curves, two stagger steps. Everything from `lib/motion.ts`; a literal
duration in a component is a bug. **The surface is already the product's best-behaved screen on this
axis** — most rows are *keep*, and the accounting exists so the re-composition does not lose that.

| Moment | Token | Status |
| --- | --- | --- |
| Card entrance | `standard` 600ms · `EASE_STANDARD` · y 10 | Keep — `cardVariants` verbatim |
| Zone cascade | `STAGGER_STEP` 120ms · y 10 | **3 → 4 children.** Card step, not the 80ms row step. Last zone lands at 360 + 600 = 960ms |
| Banner arrival | `.animate-banner-in` · `emphasized` 800ms · 6px rise, enter only | Keep. Notices stay **unstaggered direct children** — a wrapper transform compounds |
| Hostname resolving | `quick` 360ms · `EASE_QUICK` · `AnimatePresence mode="wait"` | Same token, new slot. **Skeleton must move to the 19px line box** |
| Submit label swaps | `quick` 360ms, opacity + `visibility` | Keep. The button never resizes |
| Submit role morph | `standard` 600ms on `background-color` **and** `color` | **NEW — repair.** Today it snaps, with no transition at all |
| Field group dim | `standard` 600ms opacity | **NEW — repair.** Same gap |
| Focus ring | `quick` 360ms `box-shadow`, in only | Keep. Error ring *replaces* the focus ring |
| Recovery disclosure | `emphasized` 800ms `grid-template-rows` + `standard` opacity; chevron `standard` | **NEW.** The only container *size* change on the surface |
| Countdown digits | `tabular-nums`, **no animation** | Deliberate. The tick is for poll-driven figures at ~4s cadence; a 1 Hz countdown running a 1.4s dip is a strobe |
| The spinner | 900ms linear loop | Keep. One of the two sanctioned literal-duration exceptions; it carries its comment |
| Reduced motion | one global `MotionConfig` switch | Keep — **except the disclosure.** `grid-template-rows` is neither transform nor opacity, so it needs its own `prefers-reduced-motion` guard rather than inheriting the global one |

**Two of the three new rows are repairs.** The submit morph and the field dim are the surface's only
untokenized state changes: both snap instantly while the banner announcing the *same condition*
eases in over 800ms, so the card currently reports one event at two speeds.

---

## Phase 5 — validation

No shell or systemd changes, so `busybox-portability-checker` has nothing to audit.

```
bunx tsc --noEmit
bun run build
bun run i18n:check     # 100% parity, five locales
bun run icons:check
bun run lint           # against its known pre-existing baseline, not zero
```

Then the measurements this plan owes:

1. **The container-query cliff is arithmetic, not measured.** `@[25rem]/login` = 400px. The
   `@container/login` element is `w-full max-w-[404px]` inside the page gutter, so at a 375px
   viewport with `p-4` it resolves to **343px** — below the cliff, taking `px-6`. At ≥432px viewport
   it hits 404px and takes `px-[34px]`. **Measure the real container width at 375px and 390px before
   confirming.**
2. **Visual check both themes**, and specifically the bare mark on `--card` in dark — that is the
   surface the whole B decision turns on.

Dev server: use **`-p 3010`**, never kill port 3000 (that is the sibling repo). Prefer a throwaway
`app/qm-preview/` fixture route (no `_` prefix — App Router hides those), and
`rm -rf .next && bunx next typegen` after deleting it, or `tsc` fails on a stranded validator file.
**Screenshots of the local preview pane come back black in this environment** — verify with
`getComputedStyle` / `getBoundingClientRect` through the JS tool instead. It is stronger evidence
anyway. Avoid `requestAnimationFrame`; it never fires while the pane is hidden.

---

## Phase 6 — docs

- `docs/reference/overview-splash.md` — record the `/login/` composition change and the
  `LoginDeviceName` variant swap. Both pre-auth surfaces are documented there.
- `DESIGN.md` — close the pre-auth Migration Delta row (the Overview commit opens it). **And add the
  one thing this surface has been shipping undocumented: the pre-auth control height is 48px**, not
  the canon's 42px. It is defensible — the canon's own Field-ergonomics rule sets a 44px coarse-pointer
  floor, and the pre-auth card is the most phone-first surface in the product — but today it is drift
  that happens to be right. Write it down or fix it; do not leave it silent.
- `RELEASE_NOTES.md` — one bullet, house tone.
- `CLAUDE.md` — no new row; `overview-splash.md` already routes the pre-auth pair.
- **Delete** `docs/reference/_handoff-login-redesign.md` and this file.

---

## Explicitly out of scope

| Item | Why |
| --- | --- |
| `auth/check.sh`, `auth/login.sh`, `cgi_auth.sh` | No backend change. Touching them leaves the Lite Path |
| The rate-limit disclosure copy (`login.attempts_left` leaking the count) | Security-sensitive and deliberate; it mirrors `MAX_ATTEMPTS` in `cgi_auth.sh`. Do not change without asking |
| The logout split | Load-bearing: voluntary `logout()` → `/`; expiry / auth-guard / post-reboot / `changePassword()` → `/login/`. Do not collapse |
| `components/auth/change-password-dialog.tsx` | Mounts from the **authed** sidebar, so lucide is correct there. Do not "fix" its icons |
| `components/public/mode-toggle.tsx`, `login-language-picker.tsx` | Already correct — Material glyphs, explicit sizes, right elevation |
| Adding a shake on a wrong password | `overview-splash.md` is explicit: the error is carried by ring colour, glyph and copy. **Do not add one** |
| A shared pre-auth `shapes.ts` | The two cards differ in width (544 vs 404), padding and gap, so it would be mostly non-shared. `pre-auth-type.ts` is type-only **by design** |
| `/setup/` | Still a lucide route; the Icon-Boundary Rule covers `/` and `/login/` only. Mounting the picker there would walk Material across the boundary |

---

## What is already correct — do not churn it

- **Icon boundary intact.** Zero lucide imports; every `MaterialSymbol` passes an explicit `size`.
- **No `Badge` misuse**, no hand-written status-chip strings.
- **Both banners already use `TonalBanner`** at `warning`. Rate-limited is amber, **not** destructive,
  on purpose: being locked out is degraded-but-recoverable and self-clearing.
- **The submit button does not change width** across idle / submitting / locked — three labels
  stacked in one grid cell, `visibility` riding along with opacity so hidden labels leave the a11y
  tree. Preserve exactly.
- **The loading state is a bare spinner, deliberately not a skeleton** — the round trip is localhost,
  so a card outline would flash and vanish before it could be read.
- **`error === "rate_limited"` branches on the sentinel, never on `retry_after`'s truthiness.** A
  lockout with under a second left reports `retry_after: 0`.
- **The `attempts_remaining: 0` on an unlocked form** case, and the comment explaining why it renders
  the plain sentence rather than "0 attempts left".

---

## Gotchas that cost time

- **Locale packs are CRLF.** A naive `JSON.stringify(...) + "\n"` round-trip differs by one char per
  line. Normalize to `\r\n` and prove byte-identity on an untouched file first. `core.autocrlf=true`
  makes `git diff` blind to a silent LF conversion, and `cat -A` / `awk` / `sed` strip `\r` here —
  only `od -c` or a Node byte read (assert `loneLF === 0`) is real evidence.
- **`cn()` is bare tailwind-merge and cannot dedupe this repo's custom radii.** `Skeleton`'s default
  `rounded-md` silently beats `rounded-card` / `field` / `hero` / `inline`. Verify against the built
  CSS, never by reasoning. Relevant here: the `title`-variant skeleton.
- **An explicit field fill is always a light/dark pair.** `input.tsx` ships `dark:bg-input/30` at
  specificity (0,2,0); a light-only override loses in dark mode. The shipped login field already
  writes `bg-surface-container dark:bg-surface-container` for exactly this reason — keep both halves.
- **A misnamed Motion variant renders the whole page invisible** with a complete DOM, zero errors,
  and `tsc` / build / lint all passing. If the card goes blank, check `animate="…"` against the
  variant's real key first.
- **`react-hooks` lint bails per component** — an `eslint-disable` hides every later diagnostic in
  that component.
- **Worktree:** verify `git merge-base HEAD development` equals `git rev-parse HEAD` before writing.
  Copy `.env`, run `bun install` and `bunx next typegen`. Diff against the **base SHA**, not the
  branch name — parallel sessions move `development`. `/reimagine/` is gitignored and will not exist
  there; it is content reference only and predates the confirmed direction, so it is **not** a
  visual target.
