---
name: project_multitarget_phaseA_gate_verdict
description: Phase 1 gate verdict and residual open items for multi-target modem support Phase A (profile generation, tier table, hw_profile.sh, variant build, OTA variant selection) — read before Phase 4/5 work on this feature lands
type: project
---

Full Phase 1 audit ran 2026-08-24 against
`docs/superpowers/specs/2026-08-23-multi-target-modem-support-design.md` §4/§9,
`docs/reference/rg501q-bringup.md`, `docs/reference/platform-matrix.md`.
Verdict: **CONDITIONAL** — no hard blocker, but the plan must carry several
constraints verbatim or it ships broken on either an already-shipped RM520N-GL
or the OTA pipeline as a whole. Full detail in
[[project_multitarget_phaseA_ota_url_checksum_fragility]] and
[[project_multitarget_phaseA_installer_ordering_gaps]]; this memory is the
index/verdict record.

**Confirmed-accurate constraints from the design doc** (all verified against
code, not taken on faith): the `qmanager.tar.gz` compatibility floor
(`update.sh:244`, `qmanager_auto_update:162`), the `install_rm520n.sh` tar
sentinel (`qmanager_update:165`, safe because the overlay mechanism only
touches `scripts/**` — `build.sh`'s `case "$name" in
install_rm520n.sh|uninstall_rm520n.sh) continue ;; esac` already carves out
the top-level installer/uninstaller copies), the headless auto-proceed
(`install_rm520n.sh:393-409`, `/dev/tty` probe confirmed), the `/etc/qmanager`
re-chown (`qmanager_setup:151`, unconditional every boot, confirmed live and
in source).

**Atomic-write precedent to reuse for platform.json:**
`scripts/usr/lib/qmanager/config.sh`'s `qm_config_set()` — a FIXED
same-directory tmp filename (`QM_CONFIG_TMP="/etc/qmanager/qmanager.conf.tmp"`,
not `mktemp`, not `/tmp`) plus a jq-exit-status-gated `mv`. This is already
the codebase's answer to the EXDEV hazard (`/tmp`→`/etc` crosses the tmpfs/
ubi2_0 filesystem boundary) — a new file must NOT be staged in `/tmp` and
`mv`'d into `/etc/qmanager`.

**Fail-safe precedent to reuse for reading platform.json:** `qm_config_get()`
returns a caller-supplied default on both "file missing" and "jq parse
failure" (2>/dev/null swallows the error, empty result triggers the default
branch). Any `hw_profile.sh` reader must mirror this — a truncated/corrupt
platform.json must resolve to the conservative fallback tier, not error, and
its `schema` field reading as empty/absent doubles as the self-heal trigger.

**Genuine open item not resolved by the design doc:** the tier table lists
`RG501Q*` → `official` annotated "(after Phase C)", but §6/§9.3 assign
"promote tier to official" as Phase C's own deliverable. Phase A code must
therefore classify `RG501Q*` as `community` (or another explicitly
non-official placeholder), not literally emit `"official"` — otherwise Phase C
has nothing left to promote, and an unverified device would carry a support
tier the design's own D7 caution argues against. The plan must state which
string Phase A actually writes.

**Privilege-boundary rule for any future consumer** (not violated by anything
in Phase A itself, since D7 keeps tier out of the UI and no new root helper is
proposed): `platform.json` is www-data-writable advisory config, same as
everything else under `/etc/qmanager`. A root-context privileged helper must
never gate a security-relevant decision on its `tier`/`model` value — re-derive
from `/etc/quectel-project-version` directly if a root helper ever needs to
branch on device identity.
