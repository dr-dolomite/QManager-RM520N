#!/usr/bin/env bash
# Regression harness for F13: world-writable Entware bootstrap units.
#
# WHY THIS EXISTS
# ----------------
# Measured live on both RM520N-GL and RG501Q-EU on 2026-08-26:
# /lib/systemd/system/{opt.mount,start-opt-mount.service,rc.unslung.service}
# were all mode 0666. They are written by `cat > ... << EOF` heredocs, which
# create a file with 0666 & ~umask, and the install shell's umask is 0000 —
# so the units inherited world-write with no chmod anywhere to correct it.
#
# The natural objection is "but / is read-only, so who cares" — the installer
# remounts / rw and deliberately never restores ro (see the rootfs contract in
# docs/BACKEND.md §2.1), so the file mode is the only barrier left on a unit
# systemd executes as root at every boot. /lib/systemd/system itself is 0755,
# which bounds the exposure to exactly these three files but does nothing to
# protect them.
#
# The fix is harden_entware_unit_modes(), which must:
#   1. chmod the three units to a NUMERIC 0644 (idempotent regardless of the
#      mode already on disk, and immune to the umask-sensitivity that bites a
#      symbolic mode with no "who" prefix — the same trap assertion [1] of
#      installer-lighttpd-collision.sh pins on the S80lighttpd side).
#   2. Be called UNCONDITIONALLY from main(), never from inside
#      install_dependencies(): the OTA updater always invokes this installer
#      with --skip-packages, which gates install_dependencies(), so a fix
#      placed there would reach fresh installs only and leave every existing
#      device world-writable forever. This is the same historical defect shape
#      as F8 and is the assertion to keep paranoid.
#   3. Never die() — a failed chmod degrades to today's behavior, it must not
#      abort an install.
#
# Anchors are matched by TEXT, never by line number.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INSTALLER="$REPO_ROOT/scripts/install_rm520n.sh"

pass_count=0
fail_count=0

ok()  { pass_count=$((pass_count + 1)); printf '  ok   %s\n' "$1"; }
bad() { fail_count=$((fail_count + 1)); printf '  FAIL %s\n' "$1"; }

FN_BODY=$(awk '/^harden_entware_unit_modes\(\) \{$/,/^\}$/' "$INSTALLER")
MAIN_BODY=$(awk '/^main\(\) \{$/,/^\}$/' "$INSTALLER")
DEPS_BODY=$(awk '/^install_dependencies\(\) \{$/,/^\}$/' "$INSTALLER")

printf '\n[1] harden_entware_unit_modes() exists and covers all three units\n'

if [ -n "$FN_BODY" ]; then
    ok "harden_entware_unit_modes() is defined"
else
    bad "harden_entware_unit_modes() is not defined"
fi

for unit in opt.mount start-opt-mount.service rc.unslung.service; do
    if printf '%s' "$FN_BODY" | grep -qF "/lib/systemd/system/$unit"; then
        ok "covers $unit"
    else
        bad "does not cover $unit"
    fi
done

printf '\n[2] the mode is numeric 0644, not a umask-sensitive symbolic mode\n'

if printf '%s' "$FN_BODY" | grep -qE 'chmod[ \t]+0?644[ \t]'; then
    ok "uses a numeric 644 mode"
else
    bad "no numeric 'chmod 644' found in harden_entware_unit_modes()"
fi

if printf '%s' "$FN_BODY" | grep -qE 'chmod[ \t]+[goau]*[-+=][rwx]'; then
    bad "uses a symbolic chmod — a bare mode is umask-sensitive and not idempotent"
else
    ok "does not use a symbolic chmod"
fi

printf '\n[3] it is called unconditionally from main(), NOT from install_dependencies()\n'

if printf '%s' "$MAIN_BODY" | grep -qE '^[ \t]*harden_entware_unit_modes[ \t]*$'; then
    ok "main() calls harden_entware_unit_modes"
else
    bad "main() does not call harden_entware_unit_modes on its own line"
fi

# The OTA killer: any DO_PACKAGES / --skip-packages gate on the call site, or
# the call living inside install_dependencies(), makes the fix invisible to
# every already-installed device.
if printf '%s' "$MAIN_BODY" | grep -E 'harden_entware_unit_modes' | grep -qE 'DO_PACKAGES|&&|\|\||if '; then
    bad "the main() call site is gated (DO_PACKAGES / conditional) — OTA devices would never be hardened"
else
    ok "the main() call site is unconditional"
fi

if printf '%s' "$DEPS_BODY" | grep -qF 'harden_entware_unit_modes'; then
    bad "called from inside install_dependencies() — that function is skipped on every OTA run"
else
    ok "not called from inside install_dependencies()"
fi

printf '\n[4] it cannot abort an install\n'

if printf '%s' "$FN_BODY" | grep -qF 'die '; then
    bad "harden_entware_unit_modes() calls die — a failed chmod must not abort the install"
else
    ok "does not call die"
fi

if printf '%s' "$FN_BODY" | grep -qE '^[ \t]*return 0[ \t]*$'; then
    ok "returns 0 explicitly"
else
    bad "does not explicitly return 0"
fi

if printf '%s' "$FN_BODY" | grep -qF '|| warn'; then
    ok "chmod failure is warn-only"
else
    bad "chmod failure is not routed through warn"
fi

printf '\n[5] syntax sanity\n'

if "${BASH:-bash}" -n "$INSTALLER" 2>/dev/null; then
    ok "bash -n clean: $(basename "$INSTALLER")"
else
    bad "bash -n FAILED: $(basename "$INSTALLER")"
fi

printf '\n[installer-unit-modes] %d passed, %d failed\n' "$pass_count" "$fail_count"
[ "$fail_count" -eq 0 ] || exit 1
