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

**Why:** adding a glyph is a two-part change (edit the sorted array, then
`bun run icons:subset && bun run icons:check`, which produces a binary commit).
A component-scoped builder cannot do the second half, so it substitutes and
reports.

**How to apply:** before promising a mock glyph, grep the array. If it is
missing, either request the subset regeneration as its own step or pick a
substitute and say so in the handoff — never assume the ligature will render.

See [[project-icon-boundary-cellular-subset-gap]] for the older, now-corrected
version of this claim.
