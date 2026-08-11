# ui-builder memory index

- [Signal chip = identity, not quality](feedback-signal-chip-identity-not-quality.md) — NR blue / LTE violet fill, quality moved to the Material glyph's bar count; metric value tints stay green/amber/red for both radios
- [Approved off-ramp font sizes on the dashboard](feedback-signal-card-13px-off-ramp.md) — 13px signal rows, 44/52/26px speedtest numerals, 11/17px latency tile; the impeccable hook flags them every edit, keep them, don't add a suppression
- [Icon-Boundary Rule now covers `/` and `/login/`](project-icon-boundary-extended-preauth.md) — pre-auth routes are Material Symbols; `material-symbol-names.ts` is a multi-agent contention point, re-read before editing
- [Icon-Boundary Rule now covers `/cellular/` too, and the subset is short](project-icon-boundary-cellular-subset-gap.md) — SUPERSEDED on the glyph list; the boundary claim still holds
- [Current Material subset gaps (verified 2026-08-02)](project-material-subset-gaps.md) — `fingerprint`/`edit_calendar`/`sim_card_alert` are absent; `content_copy`/`layers`/`sim_card` ARE present; grep the array before promising a mock glyph
- [No prettier in this repo](reference-no-prettier-in-repo.md) — `bunx prettier --check` downloads a stock-default prettier that fails on untouched files too; gate is `eslint` + `tsc --noEmit`
- [Agent definition names the WRONG fonts](feedback-fonts-rethink-sans-jetbrains.md) — it's Rethink Sans + JetBrains Mono, not Euclid/Geist; sans+`tabular-nums` for values that change unprompted, mono only for identifiers
- [Middot survives only in machine-voice runs](feedback-middot-only-in-machine-voice-runs.md) — `·` as generic glue was called out; label the value and let layout separate. Watch for shared keys whose call sites pre-prefix a param
