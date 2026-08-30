#!/usr/bin/env bash
# Regression harness for two installer guards that use a "presence check"
# where a "behaves as required" check is needed — the same defect shape
# documented for the wget symlink guard (T2.5) and the `timeout` detector
# (F5): a probe that finds SOMETHING with the right name and concludes the
# real requirement is already satisfied.
#
# WHY THIS EXISTS
# ----------------
# [1] curl symlink guard (F1). install_backend()'s `/usr/bin/curl` symlink
#     step guarded the `ln -sf` with `! command -v curl`, evaluated while
#     PATH still carries /opt/bin from the Entware shim block earlier in the
#     same function. That resolves to /opt/bin/curl, so the guard concludes
#     curl is "already reachable" and skips the symlink — dormant only
#     because both known devices ship a factory /usr/bin/curl. A third
#     device missing it the way the RG501Q is missing wget/mountpoint would
#     hit this immediately, and CGI scripts (no /opt/bin on PATH) would have
#     no working curl. The wget symlink two hundred lines below this one
#     already carries the fix (`[ ! -e /usr/bin/wget ]`, see the comment at
#     :1291-1297) — this pins the curl guard to the same shape.
#
# [2] install_speedtest_cli() mountpoint guard (F6). `mountpoint` does not
#     exist as a BusyBox applet on the RG501Q-EU at all. `! mountpoint -q
#     /usrdata 2>/dev/null` reads command-not-found (exit 127) as "not a
#     mountpoint", so the function warns and returns 0 on every RG501Q —
#     silently skipping not just the speedtest download but the `install -d
#     -m 0755` remediation immediately below the guard, which the comment
#     there documents as load-bearing: it re-asserts a safe directory mode
#     on every run, including for devices that reached a bad 0777 mode under
#     old `mkdir -p` code. A device number comparison (`stat -c %d`) cannot
#     confuse "command missing" with "false" the way a `!`-inverted 127 can,
#     and both `stat -c` forms are already verified working on both devices.
#
# Anchors are matched by TEXT, never by line number — F6's own tracker entry
# notes the guard moved from :610 to :705 within one session.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INSTALLER="$REPO_ROOT/scripts/install_rm520n.sh"

pass_count=0
fail_count=0

ok()  { pass_count=$((pass_count + 1)); printf '  ok   %s\n' "$1"; }
bad() { fail_count=$((fail_count + 1)); printf '  FAIL %s\n' "$1"; }

[ -f "$INSTALLER" ] || { echo "installer not found at $INSTALLER" >&2; exit 1; }

printf '\n[1] curl symlink guard is PATH-immune (F1)\n'

# Same regression shape as the wget symlink pin in
# installer-entware-bootstrap.sh [4]: a `command -v curl` guard here would
# resolve to /opt/bin/curl (still on PATH from the Entware shim block) and
# silently skip the symlink on exactly the devices that need it.
CURL_LINE=$(grep -F 'ln -sf /opt/bin/curl /usr/bin/curl' "$INSTALLER" -B2 || true)
if [ -z "$CURL_LINE" ]; then
    bad "curl symlink call site not found in $INSTALLER"
elif printf '%s' "$CURL_LINE" | grep -qF 'command -v curl'; then
    bad "curl symlink guard uses command -v (PATH-polluted by /opt/bin from the Entware shim block)"
else
    ok "curl symlink guard does not depend on PATH"
fi

if printf '%s' "$CURL_LINE" | grep -qF '[ ! -e /usr/bin/curl ]'; then
    ok "curl symlink guard tests the target directly, matching the wget guard's fix"
else
    bad "curl symlink guard does not test /usr/bin/curl directly"
fi

printf '\n[2] install_speedtest_cli() mount guard survives a missing mountpoint applet (F6)\n'

SPEEDTEST_FN=$(awk '/^install_speedtest_cli\(\) \{$/,/^\}$/' "$INSTALLER")
if [ -z "$SPEEDTEST_FN" ]; then
    bad "install_speedtest_cli() not found in $INSTALLER"
else
    if printf '%s' "$SPEEDTEST_FN" | grep -qF 'mountpoint -q'; then
        bad "install_speedtest_cli() still invokes 'mountpoint -q', which is a 127-returning command-not-found on the RG501Q — '!' inverts that to a false 'not mounted', silently skipping the whole function including its world-writable-directory remediation"
    else
        ok "install_speedtest_cli() does not invoke the mountpoint applet"
    fi

    if printf '%s' "$SPEEDTEST_FN" | grep -qF 'stat -c %d /usrdata' \
       && printf '%s' "$SPEEDTEST_FN" | grep -qF 'stat -c %d /'; then
        ok "install_speedtest_cli() detects the mount via a stat -c %d device-number comparison"
    else
        bad "install_speedtest_cli() has no stat -c %d device-number comparison for /usrdata vs /"
    fi

    # The remediation this guard gates (install -d -m 0755, per the comment
    # at :794-805 in the source) must still be the load-bearing statement it
    # was before the fix — this harness pins the guard, not the ordering,
    # but a guard fix that also lost the remediation call would be worse.
    if printf '%s' "$SPEEDTEST_FN" | grep -qF 'install -d -o root -g root -m 0755 "$speedtest_dir"'; then
        ok "world-writable-directory remediation (install -d -m 0755) is still present"
    else
        bad "install -d -m 0755 remediation missing from install_speedtest_cli()"
    fi
fi

printf '\n[3] syntax sanity\n'

if "${BASH:-bash}" -n "$INSTALLER" 2>/dev/null; then
    ok "bash -n clean: $(basename "$INSTALLER")"
else
    bad "bash -n FAILED: $(basename "$INSTALLER")"
fi

printf '\n[installer-guard-inversions] %d passed, %d failed\n' "$pass_count" "$fail_count"
[ "$fail_count" -eq 0 ] || exit 1
