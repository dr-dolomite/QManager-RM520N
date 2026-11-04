---
name: project_ota_skips_packages
description: qmanager_update (OTA) always runs install_rm520n.sh --skip-packages, so install_dependencies()/opkg installs never run on OTA upgrades — new package requirements must be added as an unconditional step
metadata:
  type: project
---

`scripts/usr/bin/qmanager_update` calls `install_rm520n.sh --force --skip-packages --no-reboot` for every mode (`install`, `install_staged`, `rollback`). `--skip-packages` sets `DO_PACKAGES=0`, which gates the entire `install_dependencies()` function (all `opkg install ...` calls: lighttpd, sudo, jq, dropbear, msmtp, and any future package). That function **never runs on an OTA upgrade** — only on a manual fresh install (`bash install_rm520n.sh` without the flag).

`remove_conflicts()` is the one function deliberately carved out to run unconditionally regardless of `--skip-packages` (see the comment right above its call in `main()`: "runs even with --skip-packages ... must be gone before atcli_smd11 can open /dev/smd11"), specifically because its effect is needed on every update, not just fresh installs.

**Why:** Any fix that depends on a NEW Entware package being present (confirmed live example: Entware `zoneinfo-*` packages for the timezone fix — this test device only had `zoneinfo-asia/core/europe` installed, clearly from ad hoc manual testing, NOT from the installer) will silently no-op for every existing user who upgrades via the in-app OTA "Software Update" button, even after the code fix ships — because `install_dependencies()` (where a naive implementation would place the new `opkg install` call) is skipped on that exact path.

**How to apply:** Any Phase-1 audit or Phase-4 build that adds a new Entware package dependency must place the guarantee/install step OUTSIDE the `[ "$DO_PACKAGES" = "1" ] && install_dependencies` gate — either as its own unconditional function call in `main()` (mirroring `remove_conflicts()`), or verify the package is already bundled/vendored so no runtime opkg call is needed at all. Flag any installer change that only adds a package install inside `install_dependencies()` as incomplete for OTA correctness.
