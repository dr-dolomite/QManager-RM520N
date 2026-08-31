# Tailwind's Content Scan: Prose Compiles to CSS

`app/globals.css` line 1 is a bare `@import "tailwindcss"` with no `@source` narrowing, so Tailwind v4's automatic content detection scans **every non-gitignored file in the repository**, and its scanner matches raw text rather than parsing the language a file is written in. A utility class quoted in a code comment, a documentation sentence or a shell failure message is therefore extracted and compiled into real CSS exactly as if it had been applied to an element. Most malformed spellings cost one dead rule and nothing else. Four of them instead make the whole stylesheet unparseable, and because `next dev` skips the error-recovery pass that the production build runs, every route in the app returns 500 — the shell, not just the page that mentioned the class. This doc records what is actually scanned, which spellings are harmless and which are fatal, the two gates that now catch them, and the recovery behaviour that has cost the most time.

> ⚠️ WARNING: **this file is itself scanned.** Describe spellings in *words*. A concrete arbitrary value naming a custom property that actually exists is fine — it costs at most one dead utility and cannot break anything. A stand-in between the brackets is not.

## Quick Reference

| | |
| --- | --- |
| Content detection | Automatic — `app/globals.css` line 1 is a bare `@import "tailwindcss"` with no `@source` |
| Scope | Every non-gitignored file. Gitignored paths (including `.claude/`) and `node_modules` are the only exemptions |
| Measured 2026-08-31 | **983 files, 30,513 candidates**, using Tailwind's own oxide `Scanner` |
| Build gate | `scripts/test/build-css-gate.sh` — runs the production build, fails on the CSS optimizer's warning report. Wired into `bun run package` |
| Prose harness | `scripts/test/tailwind-prose-candidates.sh` — repo-wide, text-only, auto-discovered by `run-harnesses.sh` |
| Recovering a dev server that has 500ed | **Cold restart.** Deleting the offending text is not enough |
| Narrow sibling check | `scripts/test/ethernet-design-language.sh` assertion 1 — the same defect, but only two utility prefixes under one route family |

## What is actually scanned

The commonly repeated phrasing "Tailwind scans `docs/` and `scripts/`" undersells this badly. Python, Rust, JSON, the licence file and the workflow YAML are all scanned; the scanner has no notion of a file being source or not.

Measured 2026-08-31 by driving Tailwind's own oxide `Scanner` over the repo — 983 files, 30,513 candidates:

| Location | Candidates |
| -------- | ---------- |
| `components/` | 303 |
| `scripts/` | 237 |
| `docs/` | 124 |
| `hooks/` | 59 |
| `installer-gui/` (Python) | 43 |
| `lib/` | 30 |
| `types/` | 27 |
| `discord-bot/` | 18 |
| `ping-daemon/` (Rust) | 15 |
| `.impeccable/` | 5 |
| `.github/` | 3 |
| Repo root | `DESIGN.md`, `CLAUDE.md`, `PRODUCT.md`, `RELEASE_NOTES.md`, `LICENSE`, `package.json` |

`.claude/` is force-added to git but is still gitignored, so Tailwind never reads it. That is why the prose harness excludes it too: policing a file that cannot compile would be noise.

## Harmless versus fatal

> ℹ️ NOTE: the rule this repo recorded for months — that *a placeholder inside the brackets is what 500s the dev server* — is **wrong in both directions**. It over-blames the placeholder, which is merely dead, and it misses three of the four shapes that actually abort the stylesheet. Everything below was measured through the project's own toolchain on 2026-08-31.

### Harmless — one dead rule, and several were shipping

An unparseable **declaration value** is stored verbatim by the parser. The rule is emitted, the browser discards it at CSSOM, and the stylesheet is otherwise fine. Measured examples, all of which were live in the tree before `44b3783`:

- An ellipsis standing in for a value.
- Three ASCII dots standing in for a value.
- An angle-bracketed word standing in for a value.
- A custom property written directly between the brackets with no `var()` wrapper (the "bare-var arbitrary" — see below).

The cost of these is not the dead rule. It is that they are an attractive nuisance: **both of this repo's total outages began with someone spelling a placeholder more helpfully inside a `var()`**, which lands in family 1 below.

### Fatal — the stylesheet does not parse, and every route 500s in `next dev`

Four families, none of which is "a placeholder":

1. **`var()` or `env()` whose first argument is not exactly one valid dashed identifier followed by a comma or a closing paren** — at *any* nesting depth, so a `calc()` wrapping a bad `var()` counts.
2. **An arbitrary variant that yields an invalid selector.** No `var()` involved.
3. **An arbitrary property whose *name* is invalid.** The value side is tolerated; only the name is validated.
4. **An arbitrary media or container query that does not parse.**

Two retractions worth keeping, because both were plausible enough to be re-derived:

- It is **not** "a delimiter token inside `var()`". A `var()` carrying an ellipsis, one with an empty name, and one with a comma fallback all parse fine — while a `var()` carrying two identifiers aborts with no delimiter present at all.
- **Underscores are safe.** An earlier claim that they were not came from a contaminated measurement and is withdrawn.

## The bare-var arbitrary is a silent no-op, not an off-scale duration

Tailwind v4 dropped the shorthand that let a custom property sit naked between the brackets. That spelling still generates a class; it compiles to a declaration whose value is the property **name** rather than its value, which the browser discards. So it ships as **no transition at all** — not a wrong one, and not an off-scale one.

This matters for how you hunt it. The class *is* generated, so grepping for the class name finds it; `tsc --noEmit`, `eslint` and `next build` all pass. Only the emitted value tells. Verify in the built CSS under `out/_next/static/chunks/`, or by compiling the single class with `bunx @tailwindcss/cli`.

The correct spelling wraps the property in `var()` inside the brackets — `duration-[var(--duration-standard)]`, deliberately written concretely here because it names a token that exists and therefore cannot break anything. Tailwind v4's parenthesis shorthand `duration-(--duration-standard)` is the same declaration and is equally valid. Both forms are live in `components/`; neither is drift.

## `next build` was never silent — it was merely unread

Tailwind's PostCSS plugin runs an optimization pass whenever `NODE_ENV` is production, and that pass runs Lightning CSS **with error recovery enabled**. So the production build prints

```
Found N warnings while optimizing generated CSS
```

with a full code frame naming the offending class, drops the rule, and exits 0. `next dev` skips that pass entirely, and that is the whole of the dev/build divergence: the same input, one path recovering and reporting, the other refusing the stylesheet.

The signal was complete and already paid for. Nothing in `package.json`, `run-all.sh`, `run-harnesses.sh` or any hook consumed it — which is the actual reason two outages reached a browser.

## The 500 latches

> ⚠️ WARNING: **removing the offending text does not recover a dev server that has already failed.** Measured 2026-08-31: after the bad file was deleted, every route stayed 500 for **12 consecutive polls across 60 seconds**, still logging a rule from a file that no longer existed. Only a cold restart cleared it.

The obvious reading of that is "my fix did not work", followed by hunting a second occurrence that does not exist. Stop the dev server and start it again before concluding anything.

## The two gates

| Gate | Catches | Runs in |
| ---- | ------- | ------- |
| `scripts/test/build-css-gate.sh` | All four fatal families, and any future one — by consuming Tailwind's own optimizer report rather than by guessing spellings | `bun run package` |
| `scripts/test/tailwind-prose-candidates.sh` | The quieter dead-rule forms the build gate **cannot** see, because they emit no warning: the bare-var arbitrary, and placeholders written as an ellipsis, three dots, or an angle-bracketed word | `run-harnesses.sh` / `bun run test:harness` |

**Why the build gate is the real defense.** A grep can only ever cover the spellings somebody thought to write down — this repo had written down exactly one of the four fatal families. Gating on the optimizer's report covers all of them with no prose heuristics. It was proven to fire against a planted defect before it was committed (`f2d9a02`), and it fails the run rather than letting the build exit 0 with a rule quietly dropped.

**Why the build gate is excluded from `run-harnesses.sh`.** It runs a full production build, so it belongs to `bun run package` — where the build happens anyway — rather than to a suite meant to stay text-only and fast. `bun run package` therefore now gates on `run-all.sh` (syntax + CRLF), `icons:check`, **and** the CSS gate, which is the step that produces the static export.

**Two notes on the prose harness.** Every bracket in its patterns is composed from variables rather than written literally, so the harness cannot emit the candidates it polices — do not "simplify" those back. And do not relax the required hyphen before the bracket in its utility pattern: that hyphen is the only thing separating a real utility from a shell glob or a regex character class, and an earlier draft without it flagged every glob in the tree.

## The writing rule

In a comment, a harness failure message, or a doc:

- **Describe the spelling in words.** "A bare-var duration arbitrary", "an arbitrary shadow value", "the custom property written directly in the brackets with no `var()` wrapper".
- **A concrete arbitrary value naming a custom property that actually exists is fine.** It costs one dead utility and breaks nothing, and it shows the correct spelling without being able to cause an outage. `scripts/test/settings-hero-design-language.sh` and `scripts/test/toggle-primitive-one-scale.sh` both keep such examples on purpose.
- **A stand-in between the brackets is not fine** — an ellipsis, three dots, an angle-bracketed word, a lone asterisk. Name the tokens individually instead (`-quick` / `-standard` / `-emphasized`).
- **Never assemble a class from parts.** The scanner reads source text, so an interpolated class compiles to nothing at all. That is a different failure with the same root cause, and it has shipped here more than once — see [cellular-settings-family.md](cellular-settings-family.md) and [cell-scanner.md](cell-scanner.md).

## History

- **The first outage** came from a lone asterisk written in a harness comment as a wildcard for a token name.
- **The second, `92781f8`,** came from a dotted placeholder inside a `var()` — in a harness failure message that was *warning about precisely the bug it was causing*. `next build`, `tsc --noEmit`, `eslint`, `i18n:check` and the harness itself were all green on a tree where the product did not render in development. The only thing that surfaced it was loading a page in a browser.
- **`44b3783`** reworded 28 more prose sites across `components/`, `docs/`, `DESIGN.md`, `scripts/test/` and `ping-daemon/`. Every one was a comment, a doc sentence or a shell message string; no assertion logic, grep pattern, `className` or shape constant was touched. It also turned `scripts/test/ethernet-design-language.sh` green — that assertion greps *raw* source, comments included, and had been correctly red since `ef9e7d7`, reporting real dead rules a comment-stripped check would have been blind to.

Both outages originated in files whose **subject** was arbitrary-value classes. That is where near-miss spellings cluster and where the blast radius is total, which is the whole reason this doc opens with a warning about itself.

## See also

- [change-workflow.md](change-workflow.md) — the Phase 4 rule for harness prose, and what `bun run package` gates on
- [cellular-settings-family.md](cellular-settings-family.md) — the family that carried six bare-var sites, and the interpolated-breakpoint failure
- [ethernet.md](ethernet.md) — the last two bare-var sites in the tree, and the `tailwind-merge` name-sort trap that lives beside them
- `DESIGN.md` > The One-Scale Rule — the duration scale these spellings are trying to name
