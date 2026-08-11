# ui-builder memory index

- [Signal chip = identity, not quality](feedback-signal-chip-identity-not-quality.md) — NR blue / LTE violet fill, quality moved to the Material glyph's bar count; metric value tints stay green/amber/red for both radios
- [13px signal-card rows are an approved off-ramp size](feedback-signal-card-13px-off-ramp.md) — the impeccable hook flags it every edit; keep it, keep the explicit `/5` leading, don't add a suppression
- [Icon-Boundary Rule now covers `/` and `/login/`](project-icon-boundary-extended-preauth.md) — pre-auth routes are Material Symbols; `material-symbol-names.ts` is a multi-agent contention point, re-read before editing
- [Icon-Boundary Rule now covers `/cellular/` too, and the subset is short](project-icon-boundary-cellular-subset-gap.md) — SUPERSEDED on the glyph list; the boundary claim still holds
- [Current Material subset gaps (verified 2026-08-02)](project-material-subset-gaps.md) — `fingerprint`/`edit_calendar`/`sim_card_alert` are absent; `content_copy`/`layers`/`sim_card` ARE present; grep the array before promising a mock glyph
- [No prettier in this repo](reference-no-prettier-in-repo.md) — `bunx prettier --check` downloads a stock-default prettier that fails on untouched files too; gate is `eslint` + `tsc --noEmit`
- [Middot survives only in machine-voice runs](feedback-middot-only-in-machine-voice-runs.md) — `·` as generic glue was called out; label the value and let layout separate. Watch for shared keys whose call sites pre-prefix a param
