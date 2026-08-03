---
name: project-material-subset-gaps
description: The Material Symbols subset does NOT carry fingerprint, edit_calendar, or sim_card_alert — mocks for /cellular/custom-profiles call for all three
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

Confirmed **absent**, and each is called for by the approved
`reimagine/SIM Profiles and Scenarios.dc.html` mock:

- `fingerprint` — the "IMEI override" pill. Substituted with `badge`.
- `edit_calendar` — the "Edit schedule" affordance. Substituted with `schedule`.
- `sim_card_alert` — the no-active-profile empty state. `sim_card` is the
  nearest available.

**Why:** adding a glyph is a two-part change (edit the sorted array, then
`bun run icons:subset && bun run icons:check`, which produces a binary commit).
A component-scoped builder cannot do the second half, so it substitutes and
reports.

**How to apply:** before promising a mock glyph, grep the array. If it is
missing, either request the subset regeneration as its own step or pick a
substitute and say so in the handoff — never assume the ligature will render.

See [[project-icon-boundary-cellular-subset-gap]] for the older, now-corrected
version of this claim.
