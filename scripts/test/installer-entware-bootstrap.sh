#!/usr/bin/env bash
# Regression harness for the Entware bootstrap fix in install_rm520n.sh.
#
# WHY THIS EXISTS
# ---------------
# Two defects shipped together and both are silent-failure shaped, which is
# exactly the kind that comes back:
#
#   1. Entware's opkg shells out to `wget`, hardcoded (there is no
#      "option downloader" in opkg.conf and no such string in the binary).
#      The RG501Q-EU's BusyBox v1.29.3 was built WITHOUT the wget applet, so
#      every opkg fetch failed and every Entware package — lighttpd, sudo,
#      jq, dropbear — was skipped. The installer still exited 0 and reported
#      "no internet connection?", which was an active misdiagnosis: curl
#      pulled the identical URL with HTTP 200 seconds later.
#
#   2. The bootstrap was a one-shot poison pill. The guard was
#      `[ ! -x "$OPKG" ]`, but the binary is written PART WAY THROUGH the
#      block and either opkg call after it could still `die`. A device that
#      died there saw "Entware already installed" on every subsequent run,
#      forever, and skipped ~120 lines of setup that never completed.
#
# The fix is mostly structural, so most assertions here are structural too:
# they read the shipped installer and prove the shape survived. The shim is
# additionally exercised for real against a stub curl, because its argument
# translation is the one part that can be wrong without looking wrong.
#
# Anchors are matched by TEXT, never by line number — line numbers drift and
# a harness that pins them fails for the wrong reason.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INSTALLER="$REPO_ROOT/scripts/install_rm520n.sh"

pass_count=0
fail_count=0

ok()   { pass_count=$((pass_count + 1)); printf '  ok   %s\n' "$1"; }
bad()  { fail_count=$((fail_count + 1)); printf '  FAIL %s\n' "$1"; }

# assert_has <description> <fixed-string>
assert_has() {
    if grep -qF -- "$2" "$INSTALLER"; then ok "$1"; else bad "$1 (missing: $2)"; fi
}

# assert_lacks <description> <fixed-string>
assert_lacks() {
    if grep -qF -- "$2" "$INSTALLER"; then bad "$1 (still present: $2)"; else ok "$1"; fi
}

[ -f "$INSTALLER" ] || { echo "installer not found at $INSTALLER" >&2; exit 1; }

printf '\n[1] poison-pill guard\n'

# The whole point of defect 2: presence of the binary is NOT proof the
# bootstrap finished, so the old guard must be gone.
# Scoped to the bootstrap block on purpose: `[ ! -x "$OPKG" ]` is still the
# correct guard in remove_conflicts() and ensure_zoneinfo_packages(), which
# legitimately mean "skip, Entware isn't up yet". Only the bootstrap's own
# guard was the poison pill.
BOOTSTRAP_GUARD=$(grep -B1 -F 'info "Entware not found — bootstrapping' "$INSTALLER" | head -n 1)
case "$BOOTSTRAP_GUARD" in
    *'qm_entware_complete'*) ok "bootstrap guarded by completeness check" ;;
    *'-x "$OPKG"'*)          bad "bootstrap still uses the existence-only guard" ;;
    *)                       bad "unrecognized bootstrap guard: $BOOTSTRAP_GUARD" ;;
esac

# All three conditions must survive. rc.unslung is written strictly AFTER
# entware-opt installs, so it proves the run crossed the line that used to
# kill it; an empty list-installed is the exact signature measured on the
# poisoned RG501Q-EU.
COMPLETE_FN=$(awk '/^qm_entware_complete\(\) \{$/,/^\}$/' "$INSTALLER")
for cond in '[ -x "$OPKG" ]' '/opt/etc/init.d/rc.unslung' 'list-installed'; do
    if printf '%s' "$COMPLETE_FN" | grep -qF -- "$cond"; then
        ok "completeness check asserts: $cond"
    else
        bad "completeness check missing: $cond"
    fi
done

printf '\n[2] failed bootstrap must not strand a poison-pill binary\n'

# Both die paths inside the bootstrap have to clean up the half-written
# binary, matching the ELF-sanity-check precedent already in the file.
# Counted, not just grepped: one of the two is easy to lose in a refactor.
cleanup_dies=$(grep -c 'rm -f /opt/bin/opkg; die' "$INSTALLER" || true)
if [ "$cleanup_dies" -ge 2 ]; then
    ok "both bootstrap die paths remove /opt/bin/opkg first ($cleanup_dies found)"
else
    bad "expected >=2 cleanup-before-die sites, found $cleanup_dies"
fi

printf '\n[3] wget shim is conditional and non-persistent\n'

# The guard IS the safety story: the RM520N-GL has a real /usr/bin/wget and
# must stay byte-identical in behaviour.
assert_has "shim gated on wget being absent" 'if ! command -v wget >/dev/null 2>&1; then'

# A persistent shim would be a live hazard: /opt/bin precedes /usr/bin in the
# RM520N-GL's VENDOR default PATH, so /opt/bin/wget would shadow the real
# system wget for CGI, the poller's downloader and every root helper — and
# uninstall_rm520n.sh deliberately never touches anything under /opt, so it
# would outlive QManager itself.
assert_has   "shim is written under /tmp"            'cat > /tmp/qm_wget_shim/wget'
assert_has   "shim is removed before returning"      'rm -rf /tmp/qm_wget_shim'
assert_lacks "shim never written to /opt/bin"        'cat > /opt/bin/wget'
assert_lacks "shim never written to /usr/bin"        'cat > /usr/bin/wget'

printf '\n[4] wget-ssl handoff symlink is PATH-immune\n'

# Regression pin. The first cut of this fix used `! command -v wget` here.
# That silently no-ops: the PATH set when the shim was created still carries
# /opt/bin, so command -v finds /opt/bin/wget, concludes wget is "already
# reachable", and skips the symlink on the exact devices that need it —
# leaving downloader.sh (which backs the OTA pipeline and probes with an
# unmutated PATH) blind to the wget just installed.
SYMLINK_LINE=$(grep -F 'ln -sf /opt/bin/wget /usr/bin/wget' "$INSTALLER" -B2 || true)
if printf '%s' "$SYMLINK_LINE" | grep -qF 'command -v wget'; then
    bad "wget symlink guard uses command -v (PATH-polluted; see comment above)"
else
    ok "wget symlink guard does not depend on PATH"
fi
assert_has "wget symlink guard tests the target directly" '[ ! -e /usr/bin/wget ]'

printf '\n[5] approved drive-by fixes\n'

assert_has "/opt/sbin created (dropbear.service hardcodes /opt/sbin/dropbear)" \
    'for folder in bin sbin etc lib/opkg tmp var/lock; do'
assert_has "install -d over mkdir -p for /usrdata/opt" 'install -d -m 0755 /usrdata/opt'
assert_lacks "misleading 'no internet connection?' message is gone" 'no internet connection?'

printf '\n[6] shim behaviour (executed against a stub curl)\n'

# Extract the shim exactly as shipped and run it. A stub curl on PATH echoes
# its own argv, so the assertions below test flag TRANSLATION rather than
# network behaviour.
TMPD=$(mktemp -d)
trap 'rm -rf "$TMPD"' EXIT

awk '/<< .SHIMEOF.$/{f=1;next} /^SHIMEOF$/{f=0} f' "$INSTALLER" > "$TMPD/wget"
chmod +x "$TMPD/wget"

if [ ! -s "$TMPD/wget" ]; then
    bad "could not extract shim from the SHIMEOF heredoc"
else
    ok "shim extracted from installer heredoc"

    mkdir -p "$TMPD/stub"
    cat > "$TMPD/stub/curl" <<'STUB'
#!/bin/sh
echo "CURL $*"
STUB
    chmod +x "$TMPD/stub/curl"

    run_shim() { PATH="$TMPD/stub:$PATH" sh "$TMPD/wget" "$@" 2>&1; }

    # opkg calls wget as: wget --no-check-certificate --timeout=N -O <file> <url>
    out=$(run_shim --no-check-certificate --timeout=30 -O /tmp/out.gz http://example.invalid/p.gz)
    case "$out" in
        *"-k"*"--max-time 30"*"-o /tmp/out.gz"*"http://example.invalid/p.gz"*)
            ok "translates opkg's real invocation (-k, --max-time, -o, url)" ;;
        *)  bad "opkg-style invocation mistranslated: $out" ;;
    esac

    # -O<file> (no space) is a legal wget form and must not be read as a URL.
    out=$(run_shim -O/tmp/joined.gz http://example.invalid/q.gz)
    case "$out" in
        *"-o /tmp/joined.gz"*"http://example.invalid/q.gz"*)
            ok "handles the joined -O<file> form" ;;
        *)  bad "joined -O form mistranslated: $out" ;;
    esac

    # --timeout N (space-separated) must consume its argument, not treat it
    # as the URL.
    out=$(run_shim --timeout 15 http://example.invalid/r.gz)
    case "$out" in
        *"--max-time 15"*"http://example.invalid/r.gz"*)
            ok "handles space-separated --timeout N" ;;
        *)  bad "space-separated --timeout mistranslated: $out" ;;
    esac

    # Unknown flags are dropped rather than forwarded to curl, where they
    # would be rejected.
    out=$(run_shim --some-future-wget-flag -q http://example.invalid/s.gz)
    case "$out" in
        *"--some-future-wget-flag"*) bad "unknown flag leaked to curl: $out" ;;
        *"http://example.invalid/s.gz"*) ok "drops unrecognized flags" ;;
        *) bad "unknown-flag case failed: $out" ;;
    esac

    # No URL must fail loudly instead of invoking curl with nothing.
    if run_shim --timeout=5 >/dev/null 2>&1; then
        bad "shim exited 0 with no URL given"
    else
        ok "shim fails when given no URL"
    fi

    # downloader.sh greps `wget --version` for 'GNU Wget' to pick a
    # header-dump strategy. The shim must never claim to be GNU wget or it
    # selects a code path it cannot satisfy.
    ver=$(run_shim --version || true)
    case "$ver" in
        *"GNU Wget"*) bad "shim --version claims to be GNU Wget: $ver" ;;
        "")           bad "shim --version printed nothing" ;;
        *)            ok "shim --version identifies as non-GNU" ;;
    esac
fi

printf '\n[installer-entware-bootstrap] %d passed, %d failed\n' "$pass_count" "$fail_count"
[ "$fail_count" -eq 0 ] || exit 1
