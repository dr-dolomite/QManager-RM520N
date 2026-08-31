---
name: reference-draft-must-be-derived-not-synced
description: The server-state -> local-draft `useEffect` sync every settings card reaches for is an ESLint ERROR here (react-hooks/set-state-in-effect); hold only the edits and derive the draft
metadata:
  type: reference
---

The canonical settings-card shape — `useState<Draft>` plus a `useEffect` that
copies the hook's server values in when they arrive — **fails `bunx eslint` in
this repo**, as `react-hooks/set-state-in-effect`: "Calling setState
synchronously within an effect can trigger cascading renders." It is an error,
not a warning, so it blocks the Done bar.

The shape that passes, and is also better behaviour:

```ts
const baseline = useMemo(() => (serverValuesArrived ? {...} : null), [prims]);
const [edits, setEdits] = useState<Partial<Draft>>({});
const draft = useMemo(() => (baseline === null ? null : { ...baseline, ...edits }), [baseline, edits]);
```

Discard is `setEdits({})`. A field setter is `setEdits(p => ({ ...p, [f]: v }))`.

**Why:** the effect version is not merely lint noise — it is a real defect. Every
background re-read or manual Refresh overwrites whatever the user had typed. The
overlay re-BASES the deltas against the new server values instead of erasing
them, which is what the delta chips are there to show. Found on
`/local-network/ip-passthrough` 2026-08-31; the retired card had exactly this
effect and exactly this data loss.

**How to apply:** whenever a card holds a dirty/draft state against a hook's
server values. Never reach for an `eslint-disable` — the compiler-backed plugin
**bails per component**, so one disable hides every later diagnostic in that same
component (see [[reference_react_hooks_lint_bails_per_component]]).

**A second shape that also passes, and when it is the right one.** If the route
has NO background poll — the hook fetches once on mount and Refresh is an
explicit press — the card can require a NON-NULL payload and be mounted on the
landed read, seeding every field from `useState(() => settings.x)`:

```tsx
{settings ? <Card settings={settings} … /> : <CardSkeleton />}
```

There is then exactly one moment the state can be seeded, and it is the moment
the component exists: no effect, no `hydratedRef`, nothing to reset after a save.
The dirty markers compare local against `settings`, which the save response
replaces, so they go clean on their own.

Its cost is the mirror of the overlay's benefit: a later Refresh does NOT re-base
the form, because the component is already mounted. That is correct on a
manual-refresh route (Refresh updates the live band and deliberately does not
reach into a form being edited) and WRONG on anything polling in the background,
where the overlay is the only honest answer. Used on `/local-network/custom-dns`
2026-08-31.

Two narrowing corollaries, both hit in the same pass:

* `const ready = a !== null && b !== null` does **not** reliably narrow `a`/`b`
  at every later use. Build one nullable object instead —
  `const state = a !== null && b !== null ? { a, b } : null` — and check
  `state !== null`. One check, no reliance on aliased-condition analysis.
* An aliased boolean derived from that (`macRequired`) does not carry the
  narrowing forward either; repeat the `state !== null &&` on each line.
