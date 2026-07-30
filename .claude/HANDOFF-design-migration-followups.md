# Handoff: QManager design-migration follow-ups (A, B, C)

Paste this whole file as the opening prompt of a fresh session. It is self-contained.

---

## Your task

Orchestrate three follow-up changes left over from the Banner System / Network Status run.
They are independent — **do them as three separate runs, in the order A → B → C**, each with its
own worktree, approval gate and validation. Do not batch them into one commit.

Start by reading `CLAUDE.md` (6-phase change workflow, tier routing, worktree discipline),
`DESIGN.md` (binding visual canon) and `PRODUCT.md` (principles, anti-references, accessibility).

---

## Where things stand

- Branch: **`development`**, currently at `1c4e14f`. This is the integration base for everything.
- Migration **step 1 (tokens)** = landed. **Step 2** = partial (sidebar nav + dashboard card radii;
  the legacy `--radius` chain is deliberately still live — `rounded-md` alone has 114 call sites).
- Migration **step 3** = partial. What already shipped:
  - `components/ui/banner.tsx` — the eight-role Banner primitive. Roles 01/02/03/07 are mounted;
    04 (degraded), 05 (in-progress), 06 (success), 08 (deferred reboot) exist but are unmounted.
  - `components/dashboard/network-status.tsx` — retargeted, and currently **the only surface in the
    product using filled tonal chips**.
  - `DESIGN.md` corrections: banner radius is `rounded-field` (20px, not card); the banner entrance
    is a 6px **descent**; 15px/13px are documented banner type steps.
- **`CLAUDE.md`'s status-badge table still documents the OLD outline pattern on purpose** — DESIGN.md
  requires it stay accurate to what ships until the flip is complete. Task A is what closes that.

---

## Task A — Finish the badge flip, close migration step 3  (do this first)

**Goal.** Replace the retired outline-and-tint badge with the filled tonal chip everywhere, so the
product stops showing two badge systems at once.

**Scope: 32 files** carry the canonical tint. Get the current list with:

```bash
grep -rlE 'bg-(success|warning|destructive|info)/15' --include=*.tsx components app
```

**The mapping** (old → new):

```
bg-success/15 text-success hover:bg-success/20 border-success/30
  -> bg-success-container text-on-success-container hover:bg-success-container/80

bg-warning/15     -> bg-warning-container     text-on-warning-container
bg-destructive/15 -> bg-destructive-container text-on-destructive-container
bg-info/15        -> bg-primary-container     text-on-primary-container   (Info-Is-Brand Rule)
bg-muted/50 text-muted-foreground border-muted-foreground/30
  -> bg-surface-container-high text-on-surface-variant
```
Filled chips carry **no border** and use **pill radius**. Keep the `size-3` lucide icon in every chip.

### STRONG RECOMMENDATION: extract a wrapper, don't find-and-replace

`CLAUDE.md` currently says *"There is no shared badge wrapper component — compose the pattern inline
with `Badge`... if a wrapper is extracted later, update this line and DESIGN.md together."*

Take that option. Add tonal variants (`success` / `warning` / `destructive` / `info` / `muted`) to
`components/ui/badge.tsx` via its existing `cva`, then replace ~32 files of duplicated class strings
with `variant="success"`. This makes future badges correct by construction instead of by reviewer
discipline — the same reason the Banner primitive enforces its own dismiss rule. Then update the
`CLAUDE.md` line and DESIGN.md together, exactly as that sentence instructs.

### Traps — read before editing

1. **DO NOT touch `components/ui/context-menu.tsx` or `components/ui/dropdown-menu.tsx`.** Their
   `bg-destructive/10` hits are shadcn **destructive-menu-item focus states**, not status badges.
   Flipping them is a bug. Same for anything matching only `data-[variant=destructive]:focus:`.
2. **`components/public/overview-card.tsx` is the UNAUTHENTICATED SPLASH** — the first thing a
   stranger sees at `/`. It also has a hand-rolled `role="status"` live region with a re-announce
   guard (around lines 379 and 547). Do not let a mechanical replace break it.
3. **Flip shared tone maps at the map, not per call site**: `components/monitoring/alerts/constants.tsx`,
   `components/system-settings/system-health-check/health-status-badge.tsx`,
   `components/cellular/cell-scanner/signal-badges.tsx`.
4. **Dense data tables keep hairline rows.** DESIGN.md deliberately has two answers here: tonal
   containers replace dividers on *glance* surfaces, but genuine tables (cell scanner, SMS, logs)
   keep hairlines so density survives. Chips inside those tables still flip; the table chrome does not.
5. **Green vs amber must differ by more than hue.** They converge under deuteranopia, so they must
   also differ in container lightness AND carry distinct glyphs. `success-container` (L 0.89) and
   `warning-container` (L 0.905) are nearly identical in lightness — the glyph is doing the work.
   Never ship a state whose only differentiator is colour.
6. **`apply-progress-dialog.tsx` is Task C, not Task A** — its `border-info/30 bg-info/10` block at
   ~line 337 is a *notice*, not a badge.

### Definition of done
- All 32 files flipped; the three shadcn/menu false positives untouched.
- `CLAUDE.md`'s status-badge table rewritten to the filled-chip pattern.
- `DESIGN.md` migration step 3 → **Landed** (Carrier Aggregation strip is separate; note it if still open).
- Both doc edits in the **same commit** as the code, per DESIGN.md's own gate.

---

## Task B — Consolidate the three motion systems

**The problem.** Three competing sources, and the biggest one documents the *retired* canon.

1. `lib/motion.ts` — self-declared "single source of truth". `EASE_OUT_EXPO = [0.16, 1, 0.3, 1]`,
   `DUR = {fast .16, base .24, slow .34, slower .5}`; exports `containerVariants`, `itemVariants`,
   `pageVariants`. **Its header comment says "Apple instrument-class… never Material-pop."**
2. `lib/motion-presets.ts` — near-duplicate exporting `staggerContainer`/`staggerItem` at
   0.25s/`easeOut`. Six consumers: `delivery-health-card`, `sms-forwarding-card`, `sms-inbox-card`,
   `alerts.tsx`, `connectivity-sensitivity-card`, `quality-thresholds-card`.
3. Local re-declarations in individual components (one was removed from `home-component.tsx`; grep
   for more: `grep -rn "const itemVariants\|const containerVariants" components/`).

**The contradiction.** PRODUCT.md and DESIGN.md now specify **Material emphasized easing, 300–400ms**,
and `app/globals.css` already ships the tokens:

```
--ease-emphasized: cubic-bezier(0.05, 0.7, 0.1, 1);   --duration-emphasized: 400ms;
--ease-standard:   cubic-bezier(0.2, 0, 0, 1);        --duration-standard:   300ms;
                                                      --duration-quick:      180ms;
--stagger-step: 60ms;
```

So the **CSS layer migrated in step 1 and the JS layer never did**, and `lib/motion.ts`'s own
documentation now argues against the shipped direction.

**Deliverable.** One motion source, retuned onto the emphasized/standard curves, its doc comment
rewritten to describe the current canon, all consumers repointed, `lib/motion-presets.ts` deleted.

**Traps.**
- **Blast radius is the whole app.** `lib/motion.ts` says it plainly: *"dozens of surfaces consume it
  by reference; change it here and the whole app retunes at once."* This is a Tier 3 change and needs
  a real approval gate — get the user to agree the whole app should retune before you touch a curve.
- Reduced motion is handled globally by `<MotionConfig reducedMotion="user">` in
  `components/motion-provider.tsx`, **plus** a `@media (prefers-reduced-motion: reduce)` block in
  `globals.css` covering `.animate-pulse-ring` / `.animate-live-ping` / `.animate-banner-in`. Both
  mechanisms must survive. Keep variants pure transform + opacity so the global switch is sufficient.
- The canon forbids overshoot. The **only** sanctioned overshoot in the product is the save check at
  1.03 scale. Never springy, never elastic.
- `pageVariants` drives every navigation — the single most-felt motion in the product. Retune it last
  and look at it before committing.

---

## Task C — Scenario gradients + the reboot heartbeat  (needs design decisions — gate hard)

Two related token violations. **Do not start coding until the user has answered the question below.**

### C1 — Raw gradient literals in the scenario identity picker

`components/cellular/custom-profiles/connection-scenarios/connection-scenario-card.tsx`
- **line ~49** — `gradientOptions`, four raw multi-stop Tailwind gradients:
  `from-violet-600 via-purple-600 to-indigo-700`, `from-rose-500 via-pink-500 to-orange-400`,
  `from-emerald-500 via-teal-500 to-cyan-500`, `from-blue-500 via-indigo-500 to-purple-600`
- **line ~87** — per-scenario `gradient:` on each built-in preset (Gaming, etc.)

This violates `CLAUDE.md`'s *"semantic color tokens only, never raw Tailwind colors"* and two
PRODUCT.md anti-references at once: **decorative colour** ("a hue used because a surface looked
empty") and the gradient-heavy **AI/SaaS slop** register.

**Why this is not a mechanical fix:** these gradients are *user-facing identity*. Users have already
picked one for their saved scenarios, and there are ~8 presets. Replacing them changes saved data's
appearance. The tonal system also has no "decorative palette" — every hue owns a meaning, so there is
no legal set of 4–8 arbitrary identity colours to map onto.

**ASK THE USER FIRST**, e.g. via `AskUserQuestion`:
- (a) Drop gradients entirely; give scenarios a tonal container + distinct **icon** as their identity
      (most canon-aligned — identity comes from the glyph, colour stays meaningful).
- (b) Keep a small sanctioned identity palette, added to `globals.css` as real tokens with documented
      names, explicitly marked non-functional in DESIGN.md.
- (c) Leave it; document the exception in DESIGN.md so the hook stops flagging it.

Whatever is chosen, check whether saved scenario config persists a gradient id and needs a migration
or fallback (`config.sh` has **no key-migration primitive** — see the project memory on this; an
OTA-upgraded device must not break).

### C2 — Reboot heartbeat notice

`components/cellular/custom-profiles/apply-progress-dialog.tsx`
- **line ~337** — ships as a wash: `border-info/30 bg-info/10 text-info … rounded-md border`
- **line ~107** — an `info:` entry in a tone map, same wash pattern

DESIGN.md specifies this as *"a calm `primary-container` notice"* ("Modem is restarting… This usually
takes 30-60 seconds…"). This is simpler than C1 and could just **reuse the Banner primitive's
`in-progress` role** (`primary-container`, `role="status"`, spinner in the glyph disc) instead of
hand-rolling it — check whether the dialog's layout allows it; if not, match the role's styling.

---

## Project-wide gotchas that WILL bite you

**Worktrees**
- `EnterWorktree` bases the branch on `origin/<default>` = **`origin/main`, which badly lags
  `development`.** Immediately after entering, verify `git merge-base HEAD development` equals
  `git rev-parse HEAD`. If not, `git reset --hard development` **before any file is written**.
- **`/reimagine/` is gitignored** (`.gitignore:71`) — the entire Claude Design handoff bundle is
  absent in a fresh worktree. Copy it in, or any agent told to "match the prototype" designs blind.
- `.env` is gitignored too (only matters for on-device work; these three tasks are frontend-only).
- **Record the base SHA and diff against it, not against `development`.** The user runs parallel
  Claude sessions; `development` moved mid-run last time and made correct builder output look like a
  silent revert. `BASE=$(git rev-parse HEAD)` then `git diff --stat $BASE`.

**Validation**
- `bun run i18n:check` is **NOT** in `build` or `package`, and CI only runs it on PRs touching
  `public/locales/**`. Run it explicitly; it must report 100% parity across en, zh-CN, zh-TW, it, id.
- Run `bun --bun next build` — and again **after** merging, since a clean auto-merge can still break a
  contract that advanced upstream.
- `bun install` is needed in a fresh worktree before any build.
- **Tailwind silently drops unknown utilities** — a green build does NOT prove a class emitted. Verify
  against the built CSS: `find out .next -name "*.css" -size +10k`, then `grep -F` the class. Note
  arbitrary values appear escaped (`basis-\[280px\]`), so use `grep -F`, not a regex.
- **Contrast must be measured, not eyeballed.** OKLCH `L` is perceptual lightness; WCAG uses
  linear-light luminance after sRGB gamma decode, and they diverge sharply in the mid-tones —
  estimating from `L` alone under-reports contrast by ~2 full ratio points. Use the script below.
- A `git diff --stat` mismatch between the claimed and actual blast radius (a "one-line change" with a
  200-line diff) is the cheapest regression detector there is. Check it every time.

**Verify contrast with this** (drop in a temp file, `node` it):

```js
function oklchToSrgb(L,C,H){const h=H*Math.PI/180,a=C*Math.cos(h),b=C*Math.sin(h);
const l=(L+0.3963377774*a+0.2158037573*b)**3,m=(L-0.1055613458*a-0.0638541728*b)**3,
s=(L-0.0894841775*a-1.2914855480*b)**3;
const e=v=>{v=Math.max(0,Math.min(1,v));return v<=0.0031308?12.92*v:1.055*v**(1/2.4)-0.055};
return [e(4.0767416621*l-3.3077115913*m+0.2309699292*s),
        e(-1.2684380046*l+2.6097574011*m-0.3413193965*s),
        e(-0.0041960863*l-0.7034186147*m+1.7076147010*s)];}
const lum=c=>{const f=v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4;
return 0.2126*f(c[0])+0.7152*f(c[1])+0.0722*f(c[2]);};
const ratio=(x,y)=>{const a=lum(oklchToSrgb(...x)),b=lum(oklchToSrgb(...y));
return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);};
// ratio([0.26,0.11,149],[0.89,0.115,149]) -> 10.96  (on-success-container / success-container)
```
Token values are in `DESIGN.md`'s frontmatter and `app/globals.css`. Body/label text needs ≥4.5:1;
icons and large text ≥3:1. Check **both** themes — dark is a first-class equal here, not a tint.

**Other**
- The Impeccable design hook fires on UI edits. `text-[15px]`/`text-[13px]` in `components/ui/banner.tsx`
  are **documented exemptions** (DESIGN.md now records the banner type steps) — do not "fix" or suppress
  them. Treat other findings on their merits; never silence a real one with an inline ignore.
- **Material Symbols are sidebar-only** (Nav-Glyph Boundary Rule). Everything else uses lucide.
  The prototype bundle uses Material Symbols throughout — ignore it on this point.
- `reimagine/**/DESIGN.md` is a **stale sibling** of the `.dc.html` files: it has no Banner System,
  wrong tertiary hue (185 vs the corrected 200), and wrong Material-Symbols scope. The **repo's**
  `DESIGN.md` wins on rules; the `.dc.html` files win only on pixels.
- **No em dashes in docs or code comments** (UI copy has its own rules).
- Subagent usage hit a monthly spend limit in the last run. If agents start failing with a limit
  error, do the work in the main thread rather than retrying them.

---

## Suggested routing

| Task | Tier | Gates |
|---|---|---|
| A — badge flip | 3 (cross-cutting UI) | Worktree; plan + approval; `next build` + `i18n:check` + contrast; docs in same commit |
| B — motion | 3 (app-wide retune) | Worktree; **hard approval gate** — the whole app's feel changes; look at `pageVariants` before commit |
| C — gradients + heartbeat | 2–3 | **`AskUserQuestion` BEFORE coding**; check saved-config migration |

No backend, no CGI, no device writes in any of these — so `modem-investigator`,
`installer-safety-auditor` and `busybox-portability-checker` do **not** apply. The validators here are
`next build`, `tsc --noEmit`, `bun run i18n:check`, measured contrast, and a design review against
DESIGN.md.

Close each run with `docs-writer` (or equivalent doc edits) and the merge/keep/discard question before
`ExitWorktree`. Never auto-merge to `main` — that is a release act the user gates explicitly.
