# The redesign-proposal playbook

**When this applies:** a request of the shape *"apply our finalized design language to
surface X"*, *"redesign the Y page"*, or *"this page is on the old system — bring it
forward."* It governs **Phase 1 (Triage & Recon) and Phase 2 (Plan)** of the
[change workflow](change-workflow.md) for that class of request, and it front-loads a
deliverable the standard flow does not have: **a published sample design that the user
approves before any component is written.**

It does **not** apply to a bug fix on a UI surface, a copy change, or adding one card to an
existing page. Those are ordinary Tier 1/2 work.

The approach was approved on 2026-08-21 (Custom SIM Profiles, `/cellular/custom-profiles`)
and the user asked for it to be the reference basis for subsequent redesigns.

---

## The thesis

A redesign proposal has to be **arguable from the code**, not from taste. "This would look
better" is a preference and invites a debate nobody can win. "This row paints on
`--tone-warning-1`, a token that survives in `globals.css`, is consumed by three files
tree-wide, and appears in no line of `DESIGN.md`" is a finding, and it settles the question.

Everything below exists to produce findings instead of preferences.

---

## Phase 1 — Recon, as two parallel agents

Dispatch **two** `Explore` agents in one message so they run concurrently. The split is not
an optimization; neither agent can do the other's job, and running one of them alone produces
a proposal that is either ungrounded in the surface or ungrounded in the canon.

### Agent A — map the target surface

Ask for, exhaustively and read from source rather than inferred:

- Route files, their line counts, and what each one actually is (a thin `Suspense` shell, a
  retired client-side redirect, a page coordinator).
- Every component in the transitive tree, with line counts and a one-line purpose.
- The family `shapes.ts` **verbatim, in full** — including its JSDoc. The comments carry the
  reasoning for every value and are usually where the previous generation's mistakes are
  recorded.
- Exported prop interfaces, verbatim.
- Hooks, the CGI endpoints each one hits, poll cadences, and which endpoint takes the AT
  mutex.
- The data types the surface renders, verbatim.
- A feature inventory: every user-visible affordance, every dialog, every gate.
- The three states — loading, empty, error — and which skeleton mirrors which loaded shape.
- i18n: namespace file, subtree names, **leaf counts per subtree**.
- The current layout as an indented tree, with the resolved class strings at each level.

Ask explicitly for **exports with no consumers** and **constants defined in more than one
place**. That is where the drift is, and it is invisible in any single file.

### Agent B — extract the finalized language

Ask for, with verbatim dumps rather than summaries:

- The freshest completed migration commit (`git log --oneline` the design work; at time of
  writing that is `084d7c1`, the SMS family) — what it changed and why, from its own comments.
- The two reference implementations `CLAUDE.md` names: `components/dashboard/**` and
  `components/cellular/radio/**`.
- `components/ui/badge.tsx`, `components/ui/tag.tsx`, `lib/motion.ts` — **complete files**,
  not excerpts. Their comments are the canon's rationale in its most compressed form.
- A representative `shapes.ts` from a *different* family, as the structural model.
- The page shell, the card anatomy, the tile strip, the state components.

The point of the verbatim dumps is that the reasoning lives in the comments. A summary of
`badge.tsx` tells you there are five status roles; the file itself tells you that
`success-container` and `warning-container` measure 1.03:1 apart and that this is why the
glyph is mandatory. Only the second fact lets you defend a design decision.

### While they run

Do the non-duplicative reading yourself: `DESIGN.md` (especially **Migration Deltas**),
`PRODUCT.md`, the feature's own `docs/reference/*.md`, and the `:root` / `.dark` blocks of
`app/globals.css`. Do not re-run `context.mjs` if the Impeccable skill already ran it.

---

## Establish that it is a re-authoring, not a polish pass

Before proposing anything, prove which one it is. Three kinds of evidence, and you want more
than one:

1. **The feature doc says so.** `sim-profiles.md:1398` documented the surface as rebuilt onto
   the *tonal* language — that is, a previous, superseded system.
2. **Retired tokens are still consumed.** Grep the token the old system used. If it survives
   in `globals.css`, is read by a handful of files, and is absent from `DESIGN.md`, the
   surface is on the previous generation.
3. **An existing mock predates the confirmed direction.** Check dates. A `.dc.html` under
   `reimagine/` authored before the direction was confirmed is content reference only, never
   a visual target.

If none of the three holds, it is a polish pass — say so and scope it down. Scaling work up
is not the orchestrator's call any more than scaling it down is.

---

## Build the sample design

**Format:** a published `Artifact`. Load the `artifact-design` skill first — its first rule
(*honor the existing design system*) is the whole constraint here.

**Non-negotiable:** copy the `:root` and `.dark` token blocks out of `app/globals.css`
**verbatim** into the mock's stylesheet. Do not eyeball hexes, do not convert OKLCH to
anything else. Declared must equal shipped, or the mock is an impression rather than evidence
and the user is approving something the build will not produce. Rethink Sans, JetBrains Mono
and Material Symbols Rounded are all on Google Fonts, which is the one external host the
Artifact CSP admits.

**Also copy the shipped geometry**, not approximations of it: control heights (42px
`PILL_ACTION`, 36px toolbar, 40px dialog), disc sizes (52px tile, 44px block, 40px row),
tile height (104px, **pinned** not floored), the radius scale (12/20/28/36/40/pill), the chip
and tag box (`px-2 py-0.5 text-xs font-medium`, 22px).

**What the page must contain:**

| Section | Why |
| --- | --- |
| The full composition, desktop | The thing being approved |
| Theme toggle (light / dark) | Both themes are first-class; a proposal that shows one is half a proposal |
| State toggles | Every state the surface really has — in force, applying, partial, error, empty. A hero that exists only in its happy state is not designed |
| Before / after, one row or one component | The single clearest carrier of what changed. Reconstruct the "before" honestly, from the real class strings |
| Narrow-width column | The layout is container-queried, so show the container query resolving |
| A numbered evidence list | See below — this is the load-bearing section |
| Rationale prose | Each decision, and **why it is defensible against the canon** — cite the rule by name |

**The evidence list is the part that earns approval.** Number the findings. Each one names a
file, quotes the value, and states the rule it breaks or the duplicate it has drifted from.
Findings come from *reading* the surface, not from looking at it — duplicate definitions with
diverging values, exports with no consumers, retired tokens, floors where the canon says pin,
opacity washes where a token exists, a `Badge` doing a `Tag`'s job.

---

## Present it

Lead with a **reframe**, not a list of tweaks. The Custom Profiles one was: *the page is
organized by object type — "here are profiles, here are scenarios" — which is a database
view, whereas WiFiman and Firewalla organize by question.* Then name the questions the
surface actually answers and show which one the current layout leaves unanswered. A reframe
gives every subsequent decision a reason; a list of tweaks makes each one a separate argument.

Then, in order:

1. **The one or two decisions worth a veto**, called out explicitly — the calls where a
   reasonable person could go the other way, and where an existing code decision is being
   either upheld or overturned. Say which. If a decision upholds a rule already written into
   the code, quote that code.
2. **The evidence**, three or four highlights with a pointer to the full list.
3. **Scope**, both halves. What is untouched (data model, CGI contract, pipelines), and what
   is *deliberately* untouched because it is already migrated — rewriting a correct subsystem
   is churn, not a win. Name any real bug found that is out of scope and ask whether to fold
   it in.
4. **The gate.** Do not start building.

---

## Then run the normal flow

Approval turns this back into an ordinary [change workflow](change-workflow.md) run at the
tier recon established — usually **Tier 2, frontend-only (Lite Path)**. Worktree discipline
applies in full: verify `git merge-base HEAD development` equals `git rev-parse HEAD` before
any builder writes, copy `.env`, run `bun install` and `bunx next typegen`, and diff against
the **base SHA** rather than the branch name.

The approved mock becomes the builders' brief. Attach the relevant excerpt — never the whole
page — per the workflow's Hard Rules.
