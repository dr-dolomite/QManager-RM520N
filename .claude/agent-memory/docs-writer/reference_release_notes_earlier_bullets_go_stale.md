---
name: release-notes-earlier-bullets-go-stale
description: RELEASE_NOTES.md holds ONE active entry across many passes, so a later redesign in the same release can falsify a bullet an earlier pass wrote — re-read and correct, don't only append
metadata:
  type: reference
---

`RELEASE_NOTES.md` accumulates every pass of a release into a **single active
entry** (it was ~76 KB at v0.1.14-draft). Two or three passes over the same
surface therefore land as sibling bullets in the same release — and a later pass
can make an earlier bullet **false** while both still ship to the user.

Seen on 2026-08-21: the custom-profiles re-authoring made an existing
Improvements bullet ("…use the same filled tonal containers…") describe exactly
the construction the change had just removed, and another bullet still routed
users through `Custom SIM Profiles → Connection Scenarios`, a sub-page retired
earlier in the same release.

**Why:** the fixed template rotates the *version number*, not the *bullets*, so
nothing forces a re-read of what is already in the file.

**How to apply:** at every Phase 6 close, grep the whole of `RELEASE_NOTES.md`
for the surface you just changed and correct stale bullets **in place** before
adding new ones — the same rule as
[[replace-dont-append-on-ui-rewrites]], applied to user-facing copy.
