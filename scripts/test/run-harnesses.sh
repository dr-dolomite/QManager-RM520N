#!/usr/bin/env bash
# Functional harness runner. Discovers and runs every scripts/test/*.sh
# (excluding self and run-all.sh). Most assertions depend on jq.
#
# Run from repo root via `bash scripts/test/run-harnesses.sh` or
# `bun run test:harness`.
#
# This is the deeper test pass — run-all.sh only does syntax + CRLF and
# stays cheap enough to gate every `bun run package`.
set -euo pipefail

# When invoked from bun on Windows (e.g. `bun run test:harness` from
# PowerShell), `bash` resolves to C:\Windows\system32\bash.exe — WSL bash.
# WSL Ubuntu typically lacks `jq`, which makes the harnesses report
# misleading "did not produce valid JSON" failures. Mirror build.sh:
# detect WSL and re-exec under Git Bash so the harnesses see the same
# toolchain the tarball will rely on. No-op on real Linux/macOS (the
# /proc/version check fails) and on Git Bash directly (no "microsoft"
# string). See feedback_bun_bash_is_wsl.md.
if [ -z "${QMANAGER_GIT_BASH_REEXEC:-}" ] \
    && [ -r /proc/version ] \
    && grep -qiE 'microsoft|wsl' /proc/version 2>/dev/null; then
    GIT_BASH="/mnt/c/Program Files/Git/usr/bin/bash.exe"
    if [ -x "$GIT_BASH" ]; then
        echo "[run-harnesses] Detected WSL bash — re-execing under Git Bash for jq access" >&2
        export QMANAGER_GIT_BASH_REEXEC=1
        exec "$GIT_BASH" "$0" "$@"
    fi
    echo "[run-harnesses] ERROR: Detected WSL bash but Git Bash not found at $GIT_BASH" >&2
    echo "[run-harnesses] Install 'Git for Windows' (https://git-scm.com/download/win), or run from a Git Bash shell." >&2
    exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

START=$(date +%s)
fail() { printf '\n[run-harnesses] FAIL: %s (%ds)\n\n' "$1" "$(($(date +%s) - START))" >&2; exit 1; }

if ! command -v jq >/dev/null 2>&1; then
    echo "[run-harnesses] WARN: jq not on PATH — jq-dependent assertions will be skipped where guarded" >&2
fi

printf '\n== harnesses ==\n'
harness_count=0
for h in scripts/test/*.sh; do
    [ -f "$h" ] || continue
    name=$(basename "$h")
    # build-css-gate.sh is excluded on purpose: it runs a full production
    # build, so it belongs to `bun run package` (where the build happens
    # anyway) rather than to this suite, which is meant to stay text-only.
    # qm_fork_probe.sh is excluded for a different reason: it is not a harness
    # at all, it is the CPU/fork profiler from docs/reference/poller-cpu-profile.md.
    # Running it takes an hour by default and, on a device, drives the real
    # modem through a recording qcmd stub. It lives here so the profile doc's
    # "gate the launch on device_md5 == local_md5" rule has something to
    # compare against. Launch it deliberately, never as part of a test sweep.
    case "$name" in run-all.sh|run-harnesses.sh|build-css-gate.sh|qm_fork_probe.sh) continue ;; esac
    harness_count=$((harness_count + 1))
    printf '\n-- %s --\n' "$name"
    "$BASH" "$h" || fail "harness $name failed"
done

printf '\n[run-harnesses] PASS: %d harnesses (%ds)\n\n' \
    "$harness_count" "$(($(date +%s) - START))"
