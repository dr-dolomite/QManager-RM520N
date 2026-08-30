#!/usr/bin/env bash
# Fast pre-build gate for QManager. Two checks only:
#   1. bash -n syntax check across daemons, libraries, CGI handlers, harnesses
#   2. CRLF detector (warn-only — installer normalizes on-device)
#
# Exits non-zero on first syntax failure. CRLF section never fails.
# Run from repo root via `bash scripts/test/run-all.sh` or `bun run package`.
#
# Functional harnesses (jq-dependent) live in scripts/test/*.sh and run via
# `bash scripts/test/run-harnesses.sh` (or `bun run test:harness`).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

START=$(date +%s)
fail() { printf '\n[run-all] FAIL: %s (%ds)\n\n' "$1" "$(($(date +%s) - START))" >&2; exit 1; }

# --- 1. bash -n syntax check ---------------------------------------------
printf '\n== bash -n syntax check ==\n'
syntax_total=0
syntax_failed=0

# Emit one path per line: shell scripts in well-known dirs, plus extension-less
# daemons in scripts/usr/bin/ that start with a shebang (skips compiled
# binaries like qmanager_discord).
emit_scripts() {
    for f in scripts/usr/bin/*; do
        [ -f "$f" ] || continue
        head -c 2 "$f" 2>/dev/null | grep -q '^#!' && printf '%s\n' "$f"
    done
    ls scripts/usr/lib/qmanager/*.sh 2>/dev/null || true
    find scripts/www/cgi-bin/quecmanager -type f -name '*.sh' 2>/dev/null || true
    ls scripts/test/*.sh 2>/dev/null || true
}

while IFS= read -r f; do
    [ -n "$f" ] || continue
    syntax_total=$((syntax_total + 1))
    if ! err=$("$BASH" -n "$f" 2>&1); then
        printf '  FAIL %s\n' "$f"
        printf '%s\n' "$err" | sed 's/^/       /'
        syntax_failed=$((syntax_failed + 1))
    fi
done < <(emit_scripts)

if [ "$syntax_failed" -gt 0 ]; then
    fail "$syntax_failed of $syntax_total scripts have syntax errors"
fi
printf '  OK   %d scripts parsed cleanly\n' "$syntax_total"

# --- 2. CRLF detector (warn-only) ----------------------------------------
printf '\n== CRLF check (warn-only) ==\n'

# -U: read in binary mode so MSYS/Windows grep doesn't strip \r before matching.
# -I: skip binary files. Both flags are no-ops on Linux.

# CR is built at RUNTIME and passed through a variable, never written as
# $'\r' inline. Bash re-parses the body of a command substitution, and a
# raw CR in that body is consumed as line whitespace during the re-parse -
# so $'\r' inside the $( ... ) below expands to the EMPTY STRING, and an
# empty grep pattern matches every line of every file. That is exactly what
# this detector did: it reported CRLF on ~211 files holding zero CR bytes,
# which made a genuinely CRLF file indistinguishable from the noise. A CR
# carried in by variable expansion survives, because expansion happens after
# parsing. .claude/check-crlf.sh counts CR bytes rather than matching a
# pattern, which is why it gave the correct answer on the same tree.
# Pinned by scripts/test/crlf-detector-accuracy.sh (tracker F18).
#
#   printf '[%s]' $'\r'             -> [ \r ]   a real CR
#   echo "$( printf '[%s]' $'\r' )" -> [    ]   empty
CR=$(printf '\r')

crlf_files=$(
    {
        grep -rUIl "$CR" scripts \
            --include='*.sh' --include='*.service' --include='*.rules' \
            2>/dev/null || true
        # If/then form rather than `&&` chain — under `set -e`, a chain whose
        # last command fails (grep finding no CRLF, the common case) would
        # propagate a non-zero exit out of this command substitution and kill
        # the whole script silently. See feedback_set_e_traps.md.
        for f in scripts/usr/bin/*; do
            if [ -f "$f" ] && grep -qUI "$CR" "$f" 2>/dev/null; then
                printf '%s\n' "$f"
            fi
        done
        find scripts -path '*/sudoers.d/*' -type f 2>/dev/null | while IFS= read -r f; do
            if [ -f "$f" ] && grep -qUI "$CR" "$f" 2>/dev/null; then
                printf '%s\n' "$f"
            fi
        done
    } | sort -u
)

if [ -n "$crlf_files" ]; then
    count=$(printf '%s\n' "$crlf_files" | wc -l | tr -d ' ')
    printf '  WARN %d file(s) have CRLF line endings:\n' "$count"
    printf '%s\n' "$crlf_files" | sed 's/^/       /'
    printf '       Installer normalizes on-device, but fix your editor.\n'
else
    printf '  OK   no CRLF detected\n'
fi

printf '\n[run-all] PASS: %d scripts (%ds)\n\n' \
    "$syntax_total" "$(($(date +%s) - START))"
