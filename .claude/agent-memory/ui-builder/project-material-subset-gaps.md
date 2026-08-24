---
name: project-material-subset-gaps
description: Adding a Material glyph is a two-part change a component-scoped builder cannot finish — grep the sorted allowlist before promising one; the specific 2026-08-02 gap list is CLOSED
metadata:
  type: project
---

`components/ui/material-symbol-names.ts` is a 99-name allowlist and the `.woff2`
is cut from it. A name not in the array fails the TYPE, so it cannot ship
silently — but it does mean a mock glyph may simply be unavailable to a builder
who is scoped to component files only.

Confirmed **present** as of 2026-08-02 (an earlier memory claimed otherwise and
was wrong): `content_copy`, `layers`, `sim_card`, `badge`, `power_settings_new`,
`do_not_disturb_on`, `progress_activity`, `schedule`, `dark_mode`,
`sports_esports`, `bolt`.

**The 2026-08-02 gap list is CLOSED — re-verified 2026-08-17.** `fingerprint`,
`edit_calendar` and `sim_card_alert` are all in the array now, as is
`signal_cellular_0_bar` (the quality ramp's `bad` stop). The list is 107 glyphs
and `bun run icons:check` reports the font matching the manifest. Do not quote
the old substitutions — grep instead; this list churns.

**Adding a glyph IS completable in-session — this memory used to say otherwise.**
Done on 2026-08-24 (`signal_cellular_alt_1_bar`, `signal_cellular_alt_2_bar`,
list now 109): insert into the array KEEPING IT SORTED, then
`bun run icons:subset && bun run icons:check`. `icons:subset` reaches
fonts.googleapis.com from this environment and rewrites
`app/fonts/MaterialSymbolsRounded-subset.woff2` + its `.json` manifest, so the
change carries a small binary diff (~40KB file, ~100 bytes per glyph).

`icons:check` then warns `N glyph(s) have no literal call site` until the
component actually renders the new name — that warning is the round trip closing,
not a failure, and it exits 0 either way.

**How to apply:** before promising a mock glyph, grep the array. If it is
missing, add it and regenerate rather than substituting — the substitution is
the fallback for when the network is unavailable, not the default. Say in the
handoff that the change includes a regenerated font binary.

See [[project-icon-boundary-cellular-subset-gap]] for the older, now-corrected
version of this claim.
