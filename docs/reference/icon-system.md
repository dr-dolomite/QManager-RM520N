# Icon System

QManager draws its glyphs from two libraries separated by a hard, tracked boundary. **Material Symbols Rounded** is scoped to the sidebar navigation, the dashboard route, the two pre-auth routes `/` and `/login/`, and the **entire `/cellular/` route family** (index plus all 17 sub-routes); **lucide-react** covers every other route. The boundary exists because the failure it prevents is *two icon sets inside one screen*, not "Material is nicer than lucide". Before this change the dashboard carried four icon sets in a single viewport (`lucide-react`, `react-icons/md`, `react-icons/fa6`, `react-icons/tb`) sitting beside a sidebar that was already on Material Symbols. The rule that governs it is DESIGN.md's **Icon-Boundary Rule**, which replaced the retired Nav-Glyph Boundary Rule.

Material Symbols is a **self-hosted, ligature-driven icon font**, not an SVG component library. That single fact produces every gotcha on this page: the sizing behaviour, the build-time subsetting step, and the way a missing glyph fails.

## Quick Reference

| Thing | Where |
|-------|-------|
| Icon component | `components/ui/material-symbol.tsx` |
| **Canonical glyph list (single source of truth)** | `MATERIAL_SYMBOL_NAMES` in `components/ui/material-symbol-names.ts` |
| Allowed glyph names (TS type) | `MaterialSymbolName`, **derived** from that array |
| Subset generator | `scripts-dev/subset-icons.ts` (imports the same array) |
| Shipped font file | `app/fonts/MaterialSymbolsRounded-subset.woff2` (97 glyphs, 36.3 KB) |
| Generator manifest | `app/fonts/MaterialSymbolsRounded-subset.json` — what was requested + sha256 of what shipped |
| Font binding | `app/layout.tsx` (`next/font/local`, bound to a CSS variable) |
| Regenerate the font | `bun run icons:subset` |
| **Verify the font is not stale** | `bun run icons:check` — runs inside `bun run package` |
| Canon | `DESIGN.md` > Components > Icons; the Icon-Boundary Rule, the Network Status Landmark Rule |
| Machine-readable copy (audit tooling reads this) | `.impeccable/design.json` |

```sh
# after editing the glyph list
bun run icons:subset
bun run icons:check
git add app/fonts/MaterialSymbolsRounded-subset.woff2 \
        app/fonts/MaterialSymbolsRounded-subset.json
```

## Where each library is allowed

| Surface | Library |
|---------|---------|
| Sidebar nav (`components/app-sidebar.tsx`, `nav-section.tsx`, `nav-user.tsx`) | Material Symbols |
| Dashboard route (`components/dashboard/*`) | Material Symbols |
| **Pre-auth routes `/` and `/login/`** (`components/public/*`, `components/auth/login-*.tsx`, `components/ui/tonal-banner.tsx`) | Material Symbols |
| **All of `/cellular/`** (index `components/cellular/cellular-information.tsx` + `components/cellular/radio/**`, and all 17 sub-routes: Cell Scanner, Band Locking, SMS, APN Management, Antenna Alignment, Antenna Statistics, Tower Locking, Custom SIM Profiles, ...) | Material Symbols |
| `/setup/` (`components/onboarding/**`) | **lucide** — deliberately out of scope, see below |
| Local Network, Monitoring, System Settings, their dialogs | lucide |
| Header bar above the content (`SidebarTrigger`, breadcrumbs) | lucide — it is not the sidebar |
| **Route-agnostic shared infrastructure** — page-level banners (`components/ui/banner.tsx`), the save action (`components/ui/save-button.tsx`), toasts (`components/ui/sonner.tsx`) | lucide — all three mount on lucide pages too, so none of them can follow the route it is standing on. See "Route-agnostic primitives" below |
| Glyphs lucide lacks | Tabler (`@tabler/icons-react`), the sanctioned secondary |

### The boundary is keyed on ROUTES, not on directories

This matters more than it sounds, because `components/auth/` reads like a pre-auth folder and is not one.

> ⚠️ WARNING — known false positive. `grep -rn lucide-react components/auth/` returns a hit on `components/auth/change-password-dialog.tsx`. **That is correct code, not a leak.** The dialog is mounted from `components/nav-user.tsx` — the authenticated sidebar — so it renders on lucide surfaces and keeps its lucide glyphs (`EyeIcon`, `EyeOffIcon`). Only the files that actually render on `/` or `/login/` (`login-component.tsx`, `login-device-name.tsx`, `login-language-picker.tsx`) are inside the Material half of the boundary. Do not "fix" the dialog; converting it would pull Material Symbols onto an authed surface.

### The `/cellular/` extension: closed

The Cellular and Radio Information page (`/cellular/`, the section index) was retargeted to Material Symbols as part of the M3 migration's step 4, but its 17 sub-routes were left on lucide — the first and only place the boundary sat *inside* a route family rather than around one, and a user walking from the index into Cell Scanner crossed icon libraries mid-section. That gap is now closed: all 17 sub-routes (Cell Scanner, Band Locking, SMS, APN Management, Antenna Alignment, Antenna Statistics, Tower Locking, Custom SIM Profiles and the rest) are converted, across 49 files under `components/cellular/**`. **A lucide glyph anywhere under `/cellular/` is no longer correct code** (see the one deliberate exception just below) — the whole family reads as one screen now.

The reasoning that was recorded while the gap stood is worth keeping, because it is the reason the conversion was done as one pass rather than piecemeal: retargeting one sub-route at a time reproduces the same split one level down, and doing it as two separate passes means touching every shared primitive twice. It also validates the original worry — the risk named at the time was "the follow-up never happens, and temporary quietly becomes the documented behaviour" — this is the case where the follow-up *did* happen, on the next Tier 3 pass through the route family.

One concrete conversion cost, already known before this pass: `components/ui/accordion.tsx`'s `AccordionTrigger` bakes in a lucide `ChevronDownIcon` (and a legacy `rounded-md`). `active-bands-card.tsx:489` reaches for `AccordionPrimitive.Trigger` directly to avoid it, preserving every Radix affordance. Any shared primitive with a hardcoded lucide glyph needs the same treatment or a real fix — and this pass surfaced a second, more expensive case: see "Shared primitives style themselves on `>svg`" below.

#### Both former leaks are now decided — one fixed, one sanctioned

This section previously listed `checkbox.tsx` and `sonner.tsx` as **known unfixed instances**. Both are now settled, in opposite directions, and the reasoning for the split is the useful part: a primitive whose glyph sits *inside a route's content* must follow the route; a primitive that *floats over every route* cannot, and so is pinned.

**`components/ui/checkbox.tsx` — fixed, via an opt-in glyph slot.** `Checkbox` gained `glyph?: MaterialSymbolName`. Omit it and you get the existing lucide `CheckIcon`, byte-identical to before; pass it and the indicator renders `<MaterialSymbol name={glyph} size={14} />`. The two Material-route call sites now pass `glyph="check"` (`components/cellular/sms/inbox-table.tsx` ×2 — the header select-all and the per-row select); the lucide-route call sites (`components/local-network/custom-dns/custom-dns-card.tsx`, `components/onboarding/steps/step-band-locking.tsx`) correctly pass nothing. Radix keeps its keyboard handling, indeterminate state and ARIA wiring, because the slot swaps the *glyph inside* `CheckboxPrimitive.Indicator` rather than reaching around it — which is exactly the concern that kept this open.

> ℹ️ NOTE: **this cost zero bytes.** `check` was already in the 97-glyph subset (the service-ring core glyph uses it), so no name was added, no font was regenerated, and the subset-growth table below is unchanged. The `check` row is also the one the unused-glyph substring scan can never speak about honestly — see the warning under `icons:check`.

**The 14px is hardcoded inside the primitive, and there is deliberately no `size` prop.** `MaterialSymbol` applies `size` as an inline `fontSize`, which outranks every Tailwind utility (see "The sizing gotcha" below), so a call site that forgot a size would drop a defaulted **20px** glyph inside the `size-4` root — and `Indicator`'s `grid place-content-center` carries no `overflow-hidden` to catch the spill. Pinning the number in the primitive removes the failure mode instead of documenting it. This is the one sanctioned exception to "every Material glyph passes `size` explicitly at its call site": the call site here *is* the primitive.

**`components/ui/sonner.tsx` — sanctioned lucide, no longer an open question.** Toasts mount over every route, so there is no route for their glyphs to agree with; they are covered by the same rule that pins `components/ui/banner.tsx`. The boundary table above now lists them, so this is a documented exception rather than something settled by omission.

#### Route-agnostic primitives: the tie-breaker rule

`banner.tsx`, `sonner.tsx` and `save-button.tsx` share one property — **no route owns them** — and the boundary is keyed on routes. Where there is no route to follow, the primitive is pinned to **lucide**, the default half of the boundary.

`components/ui/save-button.tsx` is the case that forced the rule to be written down rather than inferred. It mounts on **9 Material routes and 9 lucide routes**: there is no majority to default to, and a route-sensing branch would mean a shared primitive reading its own URL to pick an icon library — the exact coupling the boundary exists to avoid. It renders lucide `CheckCircle2Icon`: the **circular-check form** the design mock asked for, drawn with the **library the canon requires**. Form from the mock, library from the rule.

The corollary for future work: **a new `components/ui/` primitive that mounts route-agnostically is lucide by default.** Reaching for Material inside one is the signal that it is not actually route-agnostic, and belongs in a route-scoped sibling instead — which is precisely the `Banner` / `TonalBanner` split documented further down.

**One lucide import deliberately survives under `components/cellular/` and it is correct code.** `components/cellular/custom-profiles/apply-progress-dialog.tsx` imports `RotateCwIcon` to pass into `Banner`'s `icon` prop, which is typed `LucideIcon`. `components/ui/banner.tsx` is the page-level, route-agnostic banner and stays lucide by the existing rule (it mounts on lucide pages too) — the same shape of false positive as `components/auth/change-password-dialog.tsx`. Grepping `lucide-react` under `components/cellular/` will find this hit; do not "fix" it.

### The `/setup/` caveat

`/setup/` was **explicitly left out of scope** and is still a lucide route: `app/setup/page.tsx` imports no icons of its own and renders `components/onboarding/**` (`onboarding-shell.tsx`, `steps/step-*.tsx`), which is lucide-only with zero `MaterialSymbol` imports. The boundary is intact today.

The hazard is forward-looking. `LoginLanguagePicker` and `ModeToggle` were both converted to Material Symbols, and `LoginLanguagePicker`'s own header comment advertises that it is layout-agnostic and can "drop into `/login`, `/setup`, or any pre-auth surface unchanged." Neither control is mounted on `/setup/` at present — but mounting either one there **would** walk Material Symbols across the boundary silently, because a ligature font renders wherever it is asked to. **Retarget `/setup/` first, or give it a lucide sibling.** Both files carry a warning comment saying so.

### The two sanctioned exceptions

Both live in `components/dashboard/network-status.tsx` and are covered by DESIGN.md's **Network Status Landmark Rule**: Network Status is a recognized landmark on the one glance surface, and re-glyphing it buys nothing.

1. **The SIM orb keeps lucide** `CardSimIcon` and `Plane`.
2. **The RAT glyphs keep `react-icons/md`** — `MdOutline5G`, `Md4gPlusMobiledata`, `Md4gMobiledata`, `Md3gMobiledata`. These are typographic marks (the low-power leaf that used to sit here migrated to Material `energy_savings_leaf` — it is an ordinary pictogram, so the exception never covered it). They are ("5G", "4G+", "3G"), not pictograms, and Material Symbols has no equivalent.

> ℹ️ NOTE: `react-icons` is a legacy dependency that is not to be extended. These five glyphs are the only sanctioned survivors on the dashboard.

## Adding a glyph

Because the typeface is ligature-driven — the component renders the literal text `cell_tower` and the font substitutes a glyph for it — a name the type permits but the shipped subset lacks does **not** fail the build. It type-checks, it builds, and it ships a card that renders the literal word `sim_card` to a technician standing at a mast. This is the one failure mode in the icon system that is invisible until it reaches a device: there is no runtime error to trace, because a ligature font failing to substitute is just a font drawing the letters it was given.

The procedure is two steps:

1. Add the ligature name to `MATERIAL_SYMBOL_NAMES` in `components/ui/material-symbol-names.ts`, **keeping the array sorted**.
2. Run `bun run icons:subset`, then **commit the regenerated `.woff2` and `.json` together**.

There is no second list to keep in step. `MaterialSymbolName` is derived from the array (`(typeof MATERIAL_SYMBOL_NAMES)[number]`) and the generator imports the same array, so the compiler and the font cannot disagree about which glyphs exist. That used to be two hand-maintained copies with nothing checking them; the duplication was removed rather than policed.

Sorting is enforced, and not for tidiness: it keeps "we added one glyph" a one-line diff, and stops two people who each append to the end in the same week from colliding on the same line.

### What `icons:check` actually proves

The remaining hazard is the **committed font going stale**. Editing the list is one text edit; regenerating the font is a network round-trip plus a `git add` of a binary — that is the half people skip, and skipping it produces a clean diff, a passing `tsc`, a successful `next build`, and a broken device.

WOFF2 cannot be cheaply introspected: it is Brotli-compressed with per-table transforms, so reading its ligature table needs a real font parser. Rather than take that dependency, **the generator testifies** — `icons:subset` writes `MaterialSymbolsRounded-subset.json` recording the exact names requested, the axis string, the byte count, and the sha256 of the bytes received. `icons:check` compares the committed font against that testimony and fails the build on any mismatch. It catches:

| Failure | How it is caught |
|---------|------------------|
| Glyph added to the list, font not regenerated | name in the array but not in `manifest.icons` |
| Font cut from a stale list | name in `manifest.icons` but not in the array |
| List left unsorted | direct sort comparison, names the first offending entry |
| Font hand-edited, truncated, or corrupted in transit | byte count, then sha256 |
| `FILL` axis collapsed to a pinned value | `manifest.axes` vs `MATERIAL_SYMBOL_AXES` — a change no glyph list can reveal |
| Glyph carried with no call site | **warning only**, see below |

> ⚠️ WARNING: the unused-glyph scan is a **substring search, not a resolver.** A name that also reads as an ordinary string — `check`, `info`, `home`, `router` — looks used even when it is not, so the scan can miss dead weight. It must never fail the build over one.

**Stated honestly, this proves the `.woff2` is the file the generator produced for this list and these axes. It does not re-derive the glyphs from the font's own tables**, so a hand-edited font committed alongside a hand-edited manifest would pass. That is not a realistic accident, and it is the price of staying dependency-free.

### How the generator works

`scripts-dev/subset-icons.ts` asks Google Fonts for a CSS file with an `icon_names=` parameter, which performs the subsetting **server side**, then follows the `url(...)` in the response and downloads the WOFF2. Two constraints are load-bearing:

- **`FILL` must stay a range (`0..1`), never a pinned value.** Pinning it collapses the variable axis and the active nav row's filled-glyph affordance silently stops working. The URL requests `opsz,wght,FILL,GRAD@20..48,400,0..1,0`.
- **A desktop `User-Agent` is sent on both requests.** Google serves WOFF2 only to user agents it believes support it.

The full family is roughly 3.4 MB, which is why the subset exists at all: QManager is served *by* the modem, which frequently has no internet, so a `fonts.googleapis.com` link at runtime would render a page of literal words.

Subset growth, by the change that caused it:

| Boundary scope | Glyphs | Font size |
|----------------|--------|-----------|
| Sidebar only | 19 | 10.4 KB |
| + dashboard route | 56 | 20.2 KB |
| + pre-auth `/` and `/login/` | 64 | 23.9 KB |
| + `/cellular/` index | 71 | 26.4 KB |
| + `/cellular/` sub-routes (17) | 95 | 35.2 KB |
| **+ SMS Center / SMS Forwarding tonal rebuild** | **97** | **36.3 KB** |

The eight glyphs added for the pre-auth retarget: `dark_mode`, `error`, `light_mode`, `lock`, `lock_clock`, `translate`, `wifi_off`, `wifi_tethering_off`. (The row above reads 64 because one further glyph landed between that change and this one without the table being touched; the baseline this change grew from was 65 glyphs / 24.6 KB.)

The **six** glyphs added for the `/cellular/` index: `content_copy`, `expand_more`, `graphic_eq`, `layers`, `settings_input_antenna`, `sim_card`.

The **24** glyphs added for the 17 `/cellular/` sub-routes, each verified against the live Google Fonts endpoint before use (see "Verifying a glyph name and its substitution" below): `add`, `auto_awesome`, `bolt`, `call`, `delete`, `done_all`, `drag_indicator`, `edit`, `explore`, `first_page`, `location_on`, `lock_open`, `more_horiz`, `more_vert`, `rocket_launch`, `route`, `search`, `send`, `shield`, `sos`, `sports_esports`, `trophy`, `videocam`, `work`.

The **two** glyphs added for the SMS Center / SMS Forwarding tonal rebuild: `mark_email_unread` (the unread row marker, which replaced a bare colour-only dot) and `delete_sweep` (the "Delete all" action, distinct from the single-message `delete`).

> ⚠️ WARNING: the pre-auth extension is still the one where the weight lands on the **first page a visitor loads**. The dashboard's 10 KB rode behind a login; the splash does not, and it now carries 26.4 KB. It was accepted knowingly: the font is served from the modem over LAN, and the alternative — two icon libraries inside one 404px card — is the exact failure the boundary exists to prevent. Every subsequent boundary extension inherits that cost, so the rejection discipline below is not fussiness.

### Glyphs deliberately NOT added, and why

The naive read of the `/cellular/` comp asked for **11 new glyphs and roughly +5 KB**. The real cost was **6 glyphs and +1.9 KB**, because five requests were answered by something already in the subset or by a rule the system already had. The reasoning is reusable, so it is recorded rather than re-derived at the next boundary move.

| Requested | Rejected because |
|-----------|------------------|
| `signal_cellular_alt_1_bar`, `signal_cellular_alt_2_bar` | **The alt family is rejected canon**, and the wedge ladder (`signal_cellular_{1..4}_bar` + `_off`) was already present. `alt_1_bar` is a single 120×240-unit mark (~2×4px at `size={16}`, indistinguishable from a failed icon load) and there is no `alt_0_bar`, so ink mass runs large → medium → speck → large → large and quality reads non-monotone. Settled once on `signal-status-card.tsx`; a comp asking for it again does not reopen it |
| `expand_less` | The accordion chevron **rotates 180°** (`group-data-[state=open]:rotate-180`). A second glyph for the same affordance costs bytes and buys a state the transform already expresses more legibly, since the rotation animates and a swap does not |
| `arrow_forward` | `chevron_right` was already in the subset and is what the rest of the shell uses for **in-app navigation**. An arrow reads as "leaves this app" |
| `travel_explore` | `radar` was already present and reads better against the actual copy ("the scanner sweeps"). Nearest-neighbour glyph matching against a comp is not a reason to add one |
| `5g` | **A typographic mark, not a pictogram.** DESIGN.md ships "5G" / "4G+" / "3G" as text or as a `Badge`, which is also why the two `react-icons/md` RAT marks survive as a named exception rather than migrating. The tile carries `cell_tower` (the radio itself) with the mark as an identity Badge beside it |

The general test, in order: **is it already in the subset under a different name; does an existing transform or text treatment express it; is it a mark rather than a pictogram.** Only a "no" to all three earns a glyph. The `/cellular/` sub-route pass reused this test and turned 11 naively-requested glyphs into 6, roughly the same 2:1 ratio the index pass produced:

| Requested | Rejected because |
|-----------|-------------------|
| `ChevronLeft` (back nav) | Already covered — `chevron_right` rotated 180° serves both directions, same reasoning as the accordion chevron above |
| `ChevronsRight` (skip-to-end control) | `first_page` rotated 180° reads as "skip to end" without a second glyph; one ligature, one transform, two affordances |
| `PercentIcon` | **A typographic mark, not a pictogram** — the literal `%` character does the job, same class as the rejected `5g` mark above |
| `CircleIcon` / `CircleDotIcon` (day-toggle bullet, "not recorded" slot dot) | Plain CSS `<span>`. These are decorative dots whose only state is a CSS class swap; a ligature is unnecessary weight for a bullet |
| `TbInfoCircleFilled` / `TbAlertTriangleFilled` (`react-icons/tb`) | `info` / `warning` **plus the `filled` prop**. The `Filled` suffix in react-icons is that library's fill *variable axis*, not a separate glyph — Material Symbols already has the same axis, so no new glyph was needed across the 12 files that used these two |

And five more requests were already in the subset under another name, the same "is it already there" check that caught `radar`/`chevron_right` on the index pass: `MoonIcon`→`dark_mode`, `PlaneIcon`→`airplanemode_active`, `UserRoundPenIcon`→`badge`, `MessageSquare`→`sms`, `FileDownIcon`→`download`, `ClockIcon`/`CalendarClockIcon`→`schedule`, `CircleSlashIcon`→`do_not_disturb_on`.

The SMS Center / SMS Forwarding rebuild ran the same test and produced the steepest ratio yet. The approved comp named **31** glyphs: 4 were the mock's own deck chrome (never product), **17 were already in the subset**, **8 were rejected**, and **2 were added**.

| Requested | Rejected because |
|-----------|-------------------|
| `chevron_left` | `chevron_right` **rotated 180°** — the pagination "previous" control. Extends the precedent already set twice above; the transform is one class against ~500 bytes of ligature |
| `last_page` | `first_page` **rotated 180°** reads as "skip to end". Exactly the `ChevronsRight` rejection from the sub-route pass, in the mirror direction |
| `sd_storage` | `memory` was already present and is what the rest of the product uses for the modem's own store. Nearest-neighbour matching against a comp is not a reason to add one |
| `edit_square` | `edit` was already present. The square is chrome around the same pictogram |
| `drafts` | `sms` was already present and is the message pictogram this product already uses; an opened-envelope glyph would introduce a second metaphor for one concept |
| `swap_vert` | `unfold_more` was already present and serves the sort-direction control |
| `check_box`, `check_box_outline_blank` | **Rejected outright, not substituted.** The shadcn `Checkbox` is the sanctioned control. Drawing a checkbox as a font glyph throws away Radix's keyboard handling, its indeterminate state and its ARIA wiring — the glyph would look identical and behave worse. A control is never a ligature |

The `check_box` pair is worth keeping separately from the rest: the other rejections are "cheaper glyph available", but this one is **"a glyph is the wrong kind of thing here"**. Add it to the general test as a fourth question: *is this an interactive control rather than a pictogram?*

`MATERIAL_SYMBOL_NAMES` lives in its own **import-free** module on purpose. `subset-icons.ts` is run by bun from `scripts-dev/`, which `tsconfig.json` excludes, so pulling the list out of `material-symbol.tsx` would couple font generation to React and the `@/` path alias. The array is referenced only at type level by the component, so bundlers tree-shake it — verified absent from the production chunks, meaning the modem never downloads the 71 strings.

## The sizing gotcha

`MaterialSymbol` renders a `<span>` and sets `fontSize` as an **inline style**. An inline style outranks any utility class, so a parent's auto-sizing rule that reaches a lucide `<svg>` child does not reach a Material glyph:

| Parent | Rule | Reaches lucide | Reaches MaterialSymbol |
|--------|------|----------------|------------------------|
| `components/ui/badge.tsx` | `[&>svg]:size-3` | yes | **no** |
| `components/ui/empty.tsx` | `[&_svg:not([class*='size-'])]:size-6` | yes | **no** |

A parallel sizing rule for `[data-slot=material-symbol]` would lose to the inline style too, so it is not attempted. **Every Material glyph passes `size` explicitly at its call site**: 12 in a dense chip, 15-17 in a status chip or corner badge, 16 where the glyph is the only channel carrying meaning, 24 in an `EmptyMedia`, 96 in a Network Status orb. Only `pointer-events` ports across, via a parallel `[&>[data-slot=material-symbol]]:pointer-events-none` rule added to both files. Both files carry a comment saying so.

## Shared primitives style themselves on `>svg` — mirror the selector, or the layout silently breaks

The sizing gotcha above has a second, worse sibling, found while converting the 17 `/cellular/` sub-routes. Some `components/ui/` primitives don't just *size* on finding an `svg` child — they make their **layout** conditional on it, via Tailwind `has-[>svg]:` variants. `MaterialSymbol` renders a `<span>`, so those selectors never match, and the fallback branch — the one built for "no icon" — wins silently.

Two real instances, both found and fixed in this pass:

- **`components/ui/alert.tsx`**: `grid has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] grid-cols-[0_1fr] has-[>svg]:gap-x-3`. With no `svg` match, the icon column collapses to **zero width** and the gap disappears, so a Material glyph paints directly on top of the alert title. Measured in a browser against the built CSS: no-icon branch is `grid-template-columns: 0px 1880px` with `gap: normal`; the `<svg>` branch is `16px 1852px` with `gap: 12px` — a Material `<span>` was landing on the 0px branch. Fixed by mirroring each rule for `has-[>[data-slot=material-symbol]]:`, so the span now measures identically to the svg. Six `<Alert>` call sites in the converted family were affected.
- **`components/ui/button.tsx`**: `has-[>svg]:px-3` (and the `xs`/`sm`/`lg` size equivalents) tighten padding on an icon+label button. Left unmirrored, every such button on a Material route silently keeps the wider text-only padding — a quiet ~8px width shift that's consistent across the whole page and therefore easy to miss in review.

**The general rule: when converting a route, grep the shared primitives it renders for `has-[>svg]` and `[&>svg]`, and mirror every *layout* rule for `[data-slot=material-symbol]`.** The one exception is `size-*` rules — those must **not** be mirrored, because the inline `fontSize` already outranks any utility (see above), which is exactly why glyphs pass `size` explicitly instead of relying on a mirrored size selector. This generalizes the `pointer-events` mirror already documented above, which was the first instance of this same pattern — it just happened to be a property, not a whole grid track.

> ⚠️ WARNING: this bug class is invisible to `tsc`, `next build`, `bun run icons:check`, and the design-audit tooling. All four pass cleanly on a broken layout, because none of them render the page — `icons:check` verifies the font artifact, not what consumes it. Only rendering the page catches it. None of the 17 `/cellular/` sub-routes were rendered end-to-end during this pass (they redirect to `/setup/` without a backend, and nothing was loaded on the live modem), so treat the `alert.tsx` and `button.tsx` fixes as verified and everything else on these routes as mechanism-proven but visually unreviewed. **The same caveat applies verbatim to the later SMS Center / SMS Forwarding tonal rebuild**, which also passed `tsc`, `next build`, eslint, `i18n:check` and `icons:check` without any page being rendered — **and to the `checkbox.tsx` glyph slot and the `save-button.tsx` rebuild after it.** The 14px checkbox glyph and the save button's grid-stack width lock are *mechanism-proven and visually unreviewed*: the reasoning behind each is recorded, and no one has looked at either one on screen.

### Verifying a glyph name and its substitution

Two cheap, repeatable checks, worth reusing at the next boundary move rather than re-deriving:

- **Does the name exist?** Request `https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,400,0..1,0&icon_names=<name>` with a desktop `User-Agent`. A real name comes back with a per-request subset URL containing `kit=`; a fake name comes back with the generic, unsubsetted family URL instead. Run a deliberately fake name first, so you know what the negative case looks like before trusting a positive one — this is the same endpoint `scripts-dev/subset-icons.ts` calls, so a name that resolves here will resolve there too.
- **Did the glyph actually substitute, or is it rendering as literal text?** In a real browser, compare a glyph span's `getBoundingClientRect().width` against its computed `fontSize`. A substituted glyph measures at almost exactly **1.0×** its font size (one em advance, since it's a single character); literal text measures many ems wide. All 24 new glyphs plus 6 pre-existing controls measured at exactly 1.0 in this pass; a deliberately fake name measured at 26.0 — the fake control is what proves the instrument has range, not just a number that happens to look right.

## Dashboard glyph decisions worth keeping

These shipped alongside the icon retarget and are documented in full in `DESIGN.md`; they are summarized here because they are what a reader of this file will be looking at.

### Service ring state table (`network-status.tsx`)

Two orthogonal axes. **Ring tone** tracks RAT quality; **core glyph** tracks service liveness. Amber ring means a *working* connection that is not optimal, not a fault.

| Ring tone | Pulse | Core glyph | Meaning |
|-----------|-------|------------|---------|
| Green | Pulses | `check` | Optimal |
| Amber | Pulses | `check` | LTE without carrier aggregation |
| Amber | Static | `warning` | Searching / Limited |
| Red | Static | `priority_high` | No Service / SIM error / unknown |

The pulse is a **redundant** channel, gated by `isServiceActive`. `prefers-reduced-motion` removes it and the glyph carries the meaning alone. Tone says how bad; motion says whether it is alive, which is what keeps a full-strength red ring from crying wolf.

The rings are built from `--tone-destructive-1/2/3`, new in this change, so all three ramps (success, warning, destructive) are now symmetric. The red branch previously borrowed `surface-container` / `surface-container-high` / `destructive-container` — a neutral grey ramp with one red note — because no destructive tone steps existed. It read as broken chrome rather than as a red state. The governing rule, from the Motion Guide's Service Rings recipe: *build the rings from four explicit tone steps, never from one colour at stacked alpha — stacked alpha composites to a flat disc and the ring structure disappears.*

Orb geometry: a 152px disc with a 96px glyph (up from 74px), leaving roughly 28px of optical padding. 96 is near the ceiling set by the corner badge, which occupies x 110-138 / y 4-32 of the orb box. Re-check that overlap before raising it.

### Identity chips on the Primary Status cards (`signal-status-card.tsx`)

The chip carries radio identity, and its **glyph** carries quality. As of 2026-08-17 identity renders as an **outline `Tag`** (`components/ui/tag.tsx`), not as a filled `Badge` container:

| `Tag` variant | Renders | Means |
|---------|---------|-------|
| `nr` | `--tag-nr-border` / `--tag-nr-text` on a transparent fill | 5G NR leg |
| `lte` | `--tag-lte-border` / `--tag-lte-text` on a transparent fill | 4G LTE leg |

> ℹ️ NOTE: the `nr`, `lte`, `downlink`, `uplink` and `spatial` variants were **deleted from `components/ui/badge.tsx`** in the same change, so `BadgeVariant` no longer contains an identity or direction member and `variant="nr"` on a `Badge` fails the build.

The glyph obligation survives the move: a chip that carries identity must encode the quality it also reports **non-chromatically** — here, the Material glyph's bar count. At container lightness in dark mode this system's tonal pairs collapse under red-green colour-vision simulation, so the glyph is the information and the hue is reinforcement. See [color-system.md](color-system.md).

| Quality | Glyph |
|---------|-------|
| Excellent | `signal_cellular_4_bar` |
| Good | `signal_cellular_3_bar` |
| Fair | `signal_cellular_2_bar` |
| Poor | `signal_cellular_1_bar` |
| None | `signal_cellular_off` |

The **wedge** family, not the `signal_cellular_alt*` bar family the source mock drew. The mock only
rendered Excellent and Good, so it never exposed what the alt family does further down: `alt_1_bar`
is a single 120×240-unit mark (~2×4px at `size={16}`, indistinguishable from a failed icon load) and
there is no `alt_0_bar` at all, so Poor and None fall back to full-size wedges. Ink mass would run
large → medium → speck → large → large. The wedge family holds one constant silhouette and grows the
solid fill, so every rung shares a footprint and the ladder scans as a meter.

> ⚠️ WARNING: `nr` and `lte` are **identity** roles, not status roles. An identity fill says "this is the NR card", never "this is fine". The five status roles (`success`, `warning`, `destructive`, `info`, `muted`) remain the only correct choice for a status indicator.

The rule that generalises, DESIGN.md's **Identity-Chip Rule**: *where a chip carries identity, the quality it also reports must be encoded somewhere non-chromatic.* Here that is the bar count, a five-step monotonic ladder legible in greyscale and under deuteranopia. It is a stronger channel than the fill ever was, since `success-container` and `warning-container` measure 1.03:1 apart.

### Metric rows: 13px, tints, and the `sr-only` word

- **13px is now a documented ramp step**, the dense metric-row step, written `text-[13px]/5`. The explicit `/5` leading is load-bearing: 13px is an arbitrary Tailwind size and would otherwise inherit the card's leading, and pinning the line box to 20px is what holds the row at exactly 40px so the loading skeleton's `h-10` keeps mirroring it (Skeleton-Mirror Rule).
- **Metric value tints stay green/amber/red for both radios.** The design mock tinted some LTE values violet; that was deliberately not followed, because a value's colour is a verdict and a verdict must not change meaning with the radio reporting it. The mock's literal tints were also unusable on contrast grounds: it reaches for the *solid* role tokens, which measure **4.29:1 (`--ok`)** and **3.74:1 (`--wa`)** on `surface-container` in light mode, both below AA. The shipped code uses the darkened `-on-surface` ink steps (5.88 / 5.95). Do not "fix" this divergence from the mock.
- **Every tinted value carries an `sr-only` quality word after it.** `success-on-surface` and `warning-on-surface` measure roughly 1.01:1 apart in light mode — same luminance, hue only — and green and amber converge under deuteranopia, so a "good" SINR and a "fair" SINR were the same grey number to a colourblind technician in sunlight. Identifier rows (Band, ARFCN, PCI, SCS) are untinted and must **not** get one; they have no good-or-bad reading to announce.
- **The card header carries `min-w-0` + `truncate`.** Italian trips it: `"Potenza del segnale"` over `"Nessun segnale"` wrapped one card's header to two lines while its sibling stayed at one, and the paired cards stopped reading as a pair.

## Pre-auth glyph decisions worth keeping

### `ModeToggle` — the fill is the caller's business

`components/public/mode-toggle.tsx` swapped lucide `Sun`/`Moon` for Material `light_mode`/`dark_mode`, and dropped `variant="outline"` in the same pass. A 1px outline on a tonal system is the same reasoning that retired outline badges — the trigger now carries a container fill instead.

Which fill, though, is **not** the component's decision. It gained a `className` passthrough rather than a second appearance prop, because the correct fill depends on what sits *behind* the button:

| Route | Context | What it needs |
|-------|---------|---------------|
| `/login/` | Floats on the page background | Lift off the page |
| `/` | Sits **on** the Overview card | Contrast against the card |

Both glyphs stay mounted and swap on transform, so the button never reflows and the swap costs no layout. The rotation is decorative; under `prefers-reduced-motion` the end state is still correct because it is the *scale*, not the transition, that selects a glyph.

### `LoginLanguagePicker` — `Languages` → `translate`

Ghost at rest, `bg-surface-container` while its menu is open (`data-[state=open]:`), so the trigger reads as the origin of the surface hanging beneath it. Sized 17px in the `icon-sm` button and 19px in the `icon` button, matching `ModeToggle` so the `/login/` action cluster reads as one optical rhythm — and, per the sizing gotcha below, **passed explicitly**, since omitting `size` silently pins every glyph to the 20px default.

### `TonalBanner` is Material; `Banner` stays lucide

`components/ui/tonal-banner.tsx` is the card-scoped sibling of the page-level `components/ui/banner.tsx`, not a replacement. The split is by **where they mount**, and the glyph library follows directly from that: `Banner` mounts on every route, so the boundary pins it to lucide; `TonalBanner` mounts only inside the pre-auth cards, so it is Material end to end. See `docs/reference/overview-splash.md` for the rest of its contract.

## Known Risks

- **The manifest is testimony, not proof.** `icons:check` verifies the font is the artifact the generator reported producing; it does not parse the font's ligature table. A hand-edited font plus a matching hand-edited manifest would pass. Accepted deliberately — the alternative is a font-parser dependency.
- **The unused-glyph scan under-reports.** It is a substring search, so common words (`check`, `info`, `home`, `router`) always read as used. Warning-only by design; never make it fail the build.
- **The generator needs network access** (Google Fonts). It cannot run on the modem, and it cannot run in an offline CI job — which is precisely why the *check* is offline and dependency-free while the *generator* is not. `icons:check` is in `bun run package`; `icons:subset` deliberately is not.

- **`MaterialSymbol`'s inline `fontSize` is a footgun inside shared primitives.** A primitive that accepts a caller-supplied glyph but not a caller-supplied size is safe (`checkbox.tsx` pins 14px). One that accepts both, or neither, will eventually paint a 20px default glyph inside a fixed-size box with no `overflow-hidden` to catch it. Prefer pinning the number in the primitive.

*Resolved:* `components/ui/checkbox.tsx` and `components/ui/sonner.tsx` were both listed here as unsanctioned lucide leaks onto Material routes. The checkbox now has a `glyph` slot and the three Material call sites pass `check`; sonner is a documented route-agnostic exception. See "Both former leaks are now decided" above.

*Resolved:* the two hand-synced glyph lists and the missing `icons:check` gate were both live risks here until the list was collapsed to a single source of truth and the manifest gate landed.

## Related

- `DESIGN.md` > Components > Icons, Status chips, Service rings; Typography > Hierarchy
- `.impeccable/design.json` — the machine-readable copy the design-audit tooling reads. **Keep it in step with `DESIGN.md` in the same change**, or the audit will flag correct code.
- `docs/reference/recent-activities.md` — the dashboard event feed, whose glyphs moved to Material in the same pass
- `docs/reference/carrier-aggregation.md` — the CA strip, also on the dashboard route
- `docs/reference/overview-splash.md` — the `/` and `/login/` retarget that extended the boundary to the pre-auth routes
- `docs/reference/radio-information.md`: the `/cellular/` index retarget that extended the boundary, and the render-time `Date.now()` fix that closed the `react-hooks/purity` asymmetry between it and the dashboard
- `docs/reference/auth-rate-limiting.md` — the lockout ladder the retargeted login form renders
- `docs/reference/sms.md` / `docs/reference/sms-forwarding.md` — the tonal rebuild that added `mark_email_unread` and `delete_sweep` and rejected eight further requests, including the `check_box` pair
