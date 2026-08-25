#!/usr/bin/env bash
# Regression harness for the lighttpd port-80 boot race fix.
#
# WHY THIS EXISTS
# ----------------
# Measured live on an RG501Q-EU on 2026-08-25: two lighttpd instances can
# exist on the device — QManager's own (lighttpd.service, ports 80/443, real
# docroot) and Entware's (S80lighttpd, port 80 only, empty docroot, no TLS).
# They never both bind; the outcome is decided by whether a process literally
# named `lighttpd` exists at the instant rc.unslung.service runs `pidof
# lighttpd` (S80lighttpd's rc.func start() treats a name match as "already
# running" and no-ops). On the observed winning boot, QManager's own
# ExecStartPre config-test child won by a margin of only 1.18 seconds; on an
# earlier boot the same day, with byte-identical config, it lost. The fix
# makes the outcome deterministic instead of probabilistic:
#
#   1. Disable S80lighttpd's executable bit during install/OTA so it can
#      never win the race (rc.unslung selects scripts by `-perm -u+x`, no
#      allowlist, so chmod -x is sufficient) — and this must run
#      UNCONDITIONALLY in main(), never gated inside install_dependencies(),
#      because the OTA updater always invokes the installer with
#      --skip-packages and that gate would make the fix reach fresh installs
#      only, never already-installed devices.
#   2. Run that disable AFTER install_dependencies(), because that step's
#      `opkg upgrade/install lighttpd` re-extracts S80lighttpd with its
#      executable bit restored — disabling before that point would be
#      silently undone in the same run.
#   3. Properly enable opt.mount (symlink into multi-user.target.wants/),
#      because the previously-only mount path (start-opt-mount.service's
#      `systemctl start opt.mount` wrapper) self-deadlocks on systemd's job
#      queue and burns ~3.7s getting /opt mounted — the delay that ate the
#      1.18s margin above.
#   4. Drop the stale PIDFile= line QManager's lighttpd.service carried —
#      it named Entware's default pidfile path, not ours.
#   5. Restore S80lighttpd on uninstall so a device isn't left with no web
#      server at all after QManager's override is removed.
#
# Anchors are matched by TEXT, never by line number — line numbers drift and
# a harness that pins them fails for the wrong reason. Assertion [2] is the
# one that pins the actual historical defect shape (a fix silently placed
# inside install_dependencies() and therefore invisible on OTA), so it is
# deliberately the most paranoid of the set.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INSTALLER="$REPO_ROOT/scripts/install_rm520n.sh"
UNINSTALLER="$REPO_ROOT/scripts/uninstall_rm520n.sh"
LIGHTTPD_UNIT="$REPO_ROOT/scripts/etc/systemd/system/lighttpd.service"

pass_count=0
fail_count=0

ok()   { pass_count=$((pass_count + 1)); printf '  ok   %s\n' "$1"; }
bad()  { fail_count=$((fail_count + 1)); printf '  FAIL %s\n' "$1"; }

# assert_has <description> <file> <fixed-string>
assert_has() {
    if grep -qF -- "$3" "$2"; then ok "$1"; else bad "$1 (missing: $3)"; fi
}

# assert_lacks <description> <file> <fixed-string>
assert_lacks() {
    if grep -qF -- "$3" "$2"; then bad "$1 (still present: $3)"; else ok "$1"; fi
}

[ -f "$INSTALLER" ]   || { echo "installer not found at $INSTALLER" >&2; exit 1; }
[ -f "$UNINSTALLER" ] || { echo "uninstaller not found at $UNINSTALLER" >&2; exit 1; }
[ -f "$LIGHTTPD_UNIT" ] || { echo "lighttpd unit not found at $LIGHTTPD_UNIT" >&2; exit 1; }

# Locate the disable function by name, tolerant of the exact chosen name as
# long as it is the function that chmod -x's S80lighttpd. We look it up by
# scanning for a function definition whose body references S80lighttpd.
FN_NAME=$(awk '
    /^[A-Za-z_][A-Za-z0-9_]*\(\)[ \t]*\{[ \t]*$/ { name = $1; sub(/\(\).*/, "", name); buf = ""; depth = 1; next }
    name != "" {
        buf = buf "\n" $0
        if ($0 ~ /^\}[ \t]*$/) {
            if (buf ~ /S80lighttpd/) { print name; exit }
            name = ""
        }
    }
' "$INSTALLER")

printf '\n[1] disable function exists and targets S80lighttpd\n'

if [ -n "$FN_NAME" ]; then
    ok "found lighttpd-disable function: $FN_NAME()"
else
    bad "no function body referencing S80lighttpd found in $INSTALLER"
fi

FN_BODY=""
if [ -n "$FN_NAME" ]; then
    FN_BODY=$(awk -v fn="$FN_NAME" '
        $0 ~ "^" fn "\\(\\)[ \t]*\\{[ \t]*$" { f = 1 }
        f { print }
        f && /^\}[ \t]*$/ { exit }
    ' "$INSTALLER")
fi

if printf '%s' "$FN_BODY" | grep -qF 'chmod a-x'; then
    ok "function body uses chmod a-x"
else
    bad "function body does not call chmod a-x"
fi

# Pins a real defect caught in Phase 5 validation. With no "who" prefix, POSIX
# chmod acts as if `a` were given BUT skips bits set in the umask. rc.unslung
# selects with `find -perm '-u+x'`, so a masked u+x would leave S80lighttpd
# armed while the installer logs success. The "who" must be explicit.
if printf '%s' "$FN_BODY" | grep -qE 'chmod[ \t]+-x'; then
    bad "function body uses a bare 'chmod -x' — umask can mask u+x; use 'chmod a-x'"
else
    ok "function body does not use a umask-sensitive bare 'chmod -x'"
fi

if printf '%s' "$FN_BODY" | grep -qF '/opt/etc/init.d/S80lighttpd'; then
    ok "function body references /opt/etc/init.d/S80lighttpd"
else
    bad "function body does not reference /opt/etc/init.d/S80lighttpd"
fi

printf '\n[2] failure must degrade gracefully, never abort the install\n'

if printf '%s' "$FN_BODY" | grep -qF 'die'; then
    bad "function calls die() — a failure here must not abort the install"
else
    ok "function never calls die()"
fi

printf '\n[3] call site is in main(), NOT inside install_dependencies()\n'

# This is the assertion that pins the actual historical defect: a fix placed
# inside install_dependencies() only ever reaches fresh installs, because the
# OTA updater always invokes the installer with --skip-packages (which gates
# that whole function) — see qmanager_update's fixed invocation.
MAIN_BODY=$(awk '/^main\(\) \{$/,/^\}$/' "$INSTALLER")
DEPS_BODY=$(awk '/^install_dependencies\(\) \{$/,/^\}$/' "$INSTALLER")

if [ -z "$FN_NAME" ]; then
    bad "cannot check call site — disable function was not found"
else
    if printf '%s' "$MAIN_BODY" | grep -qF "${FN_NAME}"; then
        ok "main() calls ${FN_NAME}"
    else
        bad "main() does not call ${FN_NAME}"
    fi

    if printf '%s' "$DEPS_BODY" | grep -qF "${FN_NAME}"; then
        bad "install_dependencies() calls ${FN_NAME} — this makes the fix invisible on OTA (--skip-packages gates this whole function)"
    else
        ok "install_dependencies() does not call ${FN_NAME} (OTA-reachable)"
    fi
fi

printf '\n[4] call site runs AFTER install_dependencies() in main()\n'

if [ -z "$FN_NAME" ]; then
    bad "cannot check ordering — disable function was not found"
else
    DEPS_CALL_LINE=$(grep -n 'install_dependencies$' "$INSTALLER" | grep -F '&& install_dependencies' -m1 | cut -d: -f1 || true)
    if [ -z "$DEPS_CALL_LINE" ]; then
        DEPS_CALL_LINE=$(grep -n -- '&& install_dependencies' "$INSTALLER" | head -n1 | cut -d: -f1 || true)
    fi
    FN_CALL_LINE=$(grep -n "^[[:space:]]*${FN_NAME}[[:space:]]*\$" "$INSTALLER" | head -n1 | cut -d: -f1 || true)

    if [ -z "$DEPS_CALL_LINE" ]; then
        bad "could not locate the install_dependencies() call site in main()"
    elif [ -z "$FN_CALL_LINE" ]; then
        bad "could not locate a bare ${FN_NAME} call site (expected on its own line in main())"
    elif [ "$FN_CALL_LINE" -gt "$DEPS_CALL_LINE" ]; then
        ok "${FN_NAME} (line $FN_CALL_LINE) runs after install_dependencies (line $DEPS_CALL_LINE)"
    else
        bad "${FN_NAME} (line $FN_CALL_LINE) runs BEFORE install_dependencies (line $DEPS_CALL_LINE) — opkg upgrade/install lighttpd would silently re-enable S80lighttpd afterward"
    fi
fi

printf '\n[5] lighttpd.service unit carries no PIDFile= line\n'

assert_lacks "no PIDFile= in shipped lighttpd.service" "$LIGHTTPD_UNIT" 'PIDFile='

printf '\n[6] opt.mount is symlinked into wants/, guarded by an existence test\n'

ENABLE_BODY=$(awk '/^enable_services\(\) \{$/,/^\}$/' "$INSTALLER")

if printf '%s' "$ENABLE_BODY" | grep -qF 'WANTS_DIR/opt.mount'; then
    ok "enable_services() symlinks opt.mount into WANTS_DIR"
else
    bad "enable_services() does not symlink opt.mount into WANTS_DIR"
fi

OPT_MOUNT_BLOCK=$(printf '%s\n' "$ENABLE_BODY" | grep -B2 -F 'WANTS_DIR/opt.mount' || true)
if printf '%s' "$OPT_MOUNT_BLOCK" | grep -qF '[ -f "$SYSTEMD_DIR/opt.mount" ]'; then
    ok "opt.mount symlink is guarded by [ -f ] (avoids a dangling symlink on Entware-preexisting devices)"
else
    bad "opt.mount symlink is not guarded by an [ -f ] existence test"
fi

printf '\n[7] uninstaller restores S80lighttpd as EXECUTED code, not just usage() text\n'

USAGE_BODY=$(awk '/^usage\(\) \{$/,/^\}$/' "$UNINSTALLER")
if printf '%s' "$USAGE_BODY" | grep -qE 'chmod[ \t]+a?\+x[ \t]+/opt/etc/init\.d/S80lighttpd'; then
    bad "chmod +x S80lighttpd found only inside usage() — that is help text, not code that runs"
fi

FULL_MINUS_USAGE=$(awk '
    /^usage\(\) \{$/ { skip = 1 }
    skip && /^\}$/ { skip = 0; next }
    !skip { print }
' "$UNINSTALLER")

if printf '%s' "$FULL_MINUS_USAGE" | grep -qE 'chmod[ \t]+a\+x[ \t]+/opt/etc/init\.d/S80lighttpd'; then
    ok "uninstaller executes chmod a+x on S80lighttpd outside usage()"
else
    bad "no executed 'chmod a+x' of S80lighttpd found outside usage()"
fi

# Same umask trap as the installer side: a bare '+x' here would silently leave
# the device with no web server after uninstall.
if printf '%s' "$FULL_MINUS_USAGE" | grep -qE 'chmod[ \t]+\+x[ \t]+/opt/etc/init\.d/S80lighttpd'; then
    bad "uninstaller uses a bare 'chmod +x' — umask can mask u+x; use 'chmod a+x'"
else
    ok "uninstaller does not use a umask-sensitive bare 'chmod +x'"
fi

assert_has "uninstaller guards the restore with an existence + non-executable test" "$UNINSTALLER" \
    '[ -f /opt/etc/init.d/S80lighttpd ] && [ ! -x /opt/etc/init.d/S80lighttpd ]'

printf '\n[8] syntax sanity\n'

for f in "$INSTALLER" "$UNINSTALLER"; do
    if "$BASH" -n "$f" 2>/dev/null; then
        ok "bash -n clean: $(basename "$f")"
    else
        bad "bash -n FAILED: $(basename "$f")"
    fi
done

printf '\n[installer-lighttpd-collision] %d passed, %d failed\n' "$pass_count" "$fail_count"
[ "$fail_count" -eq 0 ] || exit 1
