# Ledger — /system-settings design-canon refit

Baseline commit: e91806fa1e4cbf567fcd4a19a7596cbf1bfdf294
Branch: worktree-system-settings-canon-refit
Worktree: .claude/worktrees/system-settings-canon-refit
Mode: Full (Agent tool + real shell). Codex not probed — user pinned ui-builder for all code steps.
Lead seat: Opus (FRONTIER).

Plan: docs/superpowers/plans/2026-09-05-system-settings-canon-refit.md (gitignored)
Tier 2, Frontend-Only Lite Path. Phases 4-6 of change-workflow.

## Tasks

| id | task | write set | seat | status |
| -- | ---- | --------- | ---- | ------ |
| R1 | scout: reference impls + shapes precedents | (read-only) | orchestra-scout | PENDING |
| R2 | scout: current surface + hook/type contracts + lucide names | (read-only) | orchestra-scout | PENDING |
| 00 | shapes.ts | components/system-settings/shapes.ts | ui-builder | PENDING |
| 01 | page shell | components/system-settings/system-settings.tsx | ui-builder | PENDING |
| 02 | status band | components/system-settings/status-band.tsx | ui-builder | PENDING |
| 03 | Time & Units | components/system-settings/system-settings-card.tsx | ui-builder | PENDING |
| 04 | Scheduled Reboot | components/system-settings/scheduled-operations-card.tsx | ui-builder | PENDING |
| 05 | SSH Access | components/system-settings/ssh-password-card.tsx | ui-builder | PENDING |
| 06 | Tracked SIMs | components/system-settings/sim-registry-card.tsx | ui-builder | PENDING |
| 07 | i18n | public/locales/{en,zh-CN,zh-TW,it,id}/system-settings.json | ui-builder | PENDING |
| DA | devil's advocate | (read-only) | general-purpose (opus) | PENDING |
| 08 | docs | docs/reference/system-settings.md, CLAUDE.md, DESIGN.md, RELEASE_NOTES.md | docs-writer | PENDING |

## Conductor rulings (plan text vs canon — resolved before/while building)

- **C1 — `Repeats Sun · Wed` violates the No-Dot-Separator Rule.** DESIGN.md:797 bans `·`
  as a glue character between short facts. Days are a homogeneous list, not two facts, so
  a comma is the correct prose punctuation. RULING: render `Repeats Sun, Wed`. The
  separator is a translated leaf, not a hardcoded literal.

- **C2 — `FIELD` carries `rounded-pill`, DESIGN.md > Shapes assigns inputs `rounded-field`.**
  NOT a conflict. custom-dns:425, ip-passthrough:384 and ttl-mtu all ship pill fields, and
  ip-passthrough:62 / ttl-mtu:49 state it in their own radius-map comment ("999px fields,
  chips -> rounded-pill"). DESIGN.md's "20px radius" line for inputs is a doc/code delta,
  out of scope for this pass. RULING: `rounded-pill`, per the plan.

- **C3 — `ConditionScreen` renders a `MaterialSymbol`, and `/system-settings` is a lucide
  route.** DESIGN.md:846 bans mixing the two libraries inside one route. Census: the
  component has ZERO consumers on any lucide route — all 14 are under `components/cellular/`.
  The newest local-network family, `traffic-engine/shapes.ts:735-770`, **restates** the
  geometry in its own module and documents why; `ethernet` uses a lucide `NoticeTile`
  instead. The plan's own reference-implementation header also says "copy the values, not
  the module".
  RULING: mint a local `CONDITION` object in `system-settings/shapes.ts` restating the
  geometry (model: traffic-engine's `CONDITION`), render **lucide** glyphs, and import
  `ConditionTone` + `CONDITION_TONE` from `components/cellular/condition-screen.tsx` for
  the TONE only. That satisfies all three rules at once: no class-string tone map
  (CLAUDE.md > Shared Constants makes this compiler-enforced), no cross-family geometry
  import, no Material glyph on a lucide route.

- **C4 — `EYEBROW` and the `uppercase` step.** ethernet:152 ships no `uppercase`; the
  freshest refit (alerts) does. The plan writes band eyebrows in caps in its copy table.
  RULING: `uppercase` lives in the CSS class, never in the locale string — otherwise the
  Italian and both Chinese packs carry shouted or meaningless casing.

- **C5 — `card.tsx:51` hardcodes `text-muted-foreground` into `CardDescription`.** A
  tracked product-wide delta (DESIGN.md:273). The reference implementation takes the
  primitive bare; 4 of the 5 re-authored families follow it.
  RULING: take `CardDescription` bare, matching the reference. Record in the feature doc
  that a family-scoped grep for the retired ink cannot see the primitive.

- **C5 REVERSED.** The step-00 builder independently minted
  `CARD_DESC = "text-on-surface-variant text-sm"`. It is right and I was wrong: this pass's
  whole thesis is closing out the retired ink on the last unmigrated route, and
  `ip-passthrough-card.tsx:468` is the existing precedent for overriding at the call site.
  RULING: use `CARD_DESC` on every `CardDescription` here. Record the primitive as the
  product-wide delta it is.

- **C6 — the band and the SIM card would each mount `useSimRegistry`.** The hook fetches on
  mount with NO shared cache (`hooks/use-sim-registry.ts`), so two mounts = two GETs of
  `sim_registry.sh` per page load, with independent state — dismissing a SIM in the card
  would NOT update the count in the band directly above it. Not addressed by the plan.
  RULING: lift `useSimRegistry()` into the page shell (`system-settings.tsx`) and pass it
  to both consumers as props — the same shape the shell already uses for
  `useSystemSettings`. `useKnownSims()` stays in the card; its `count` is a different fact
  (known ICCIDs, not registry rows).

- **C7 — plan's finding "`useSystemSettings().refresh` is destructured by nothing" is
  CORRECT.** Scout R2 claimed it was called by `sim-registry-card`; it is not — that card
  uses `useSimRegistry().refresh`. `useSystemSettings()` is called only in
  `system-settings.tsx`, and neither card's `Pick<>` includes `refresh`. Verified.

- **C8 — all 34 candidate lucide names verified** against the installed lucide-react
  0.562.0 export list. All exist. Note `CardSimIcon`, NOT `SimCardIcon`.

## Attempts (append-only)
