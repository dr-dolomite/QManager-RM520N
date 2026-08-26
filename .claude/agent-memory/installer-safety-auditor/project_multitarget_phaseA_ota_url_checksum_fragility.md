---
name: project_multitarget_phaseA_ota_url_checksum_fragility
description: OTA tarball-filename URL construction and checksum verification are far more fragile/scattered than the multi-target design spec assumed — load-bearing for any future work touching qmanager_update, update.sh, or qmanager_auto_update
type: project
---

Found during the Phase 1 gate audit of the multi-target modem support design
(`docs/superpowers/specs/2026-08-23-multi-target-modem-support-design.md`,
2026-08-24), specifically its Phase A (variant-overlay build + OTA variant
selection). Applies to any future change to the OTA pipeline, not just Phase A.

**Fact 1 — three URL-construction sites in update.sh, not one.**
`scripts/www/cgi-bin/quecmanager/system/update.sh` builds the literal string
`.../releases/download/<tag>/qmanager.tar.gz` in THREE places, not the one the
design doc cited: line 244 (status-check/display), line 366 (POST-triggered
one-step install), line 416 (rollback). `scripts/usr/bin/qmanager_auto_update:162`
has a fourth. All four must move to variant-aware interpolation together, or
some paths (e.g. rollback) silently keep requesting the old filename forever.

**Fact 2 — verify_checksum() in qmanager_update breaks on a multi-line
sha256sum.txt.** `scripts/usr/bin/qmanager_update:230` does
`expected_sha=$(awk '{print $1}' "$checksum_file")` with no `head -1` and no
filename match. If a build ever publishes one `sha256sum.txt` covering
multiple tarballs (the natural thing to do for 3 release assets), `awk`
prints one line per file, and `expected_sha` becomes a multi-line string that
can never equal the single-line `actual_sha`. Checksum mismatch
(`checksum_rc -eq 2`) is **always fatal, regardless of strict mode**
(`qmanager_update:436-441` area) — this would break OTA for the ENTIRE FLEET,
including the compatibility-floor asset every already-shipped device still
requests, not just new variant-aware clients. `derive_checksum_url()`
(`qmanager_update:175-183`) is equally brittle: it does an exact literal-suffix
match on `.../qmanager.tar.gz` and returns empty for any other filename; an
empty checksum_url under `strict` (unattended auto-update) is *also* always
fatal (`[ "$strict" = "strict" ] && return 1`). **Both functions must change in
the same commit as any build.sh asset-list change** — either keep one
checksum file per tarball, or teach both functions to select by filename.

**How to apply:** any plan touching the OTA asset list (new variant, renamed
asset, additional checksum granularity) must grep all of: update.sh's three
sites, qmanager_auto_update's site, qmanager_update's `validate_url()`,
`derive_checksum_url()`, and `verify_checksum()`, before assuming "add an
asset" is a build.sh-only change. See also [[project_multitarget_phaseA_installer_ordering_gaps]].
