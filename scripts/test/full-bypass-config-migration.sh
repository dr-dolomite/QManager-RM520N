#!/usr/bin/env bash
# Regression harness for the traffic_masquerade -> full_bypass config rename.
#
# WHY THIS EXISTS
# ----------------
# "Traffic Masquerade" was renamed to "Full Bypass" because the name described
# a capability this platform does not have. On the RM551E, masquerade genuinely
# masqueraded: nfqws rewrote the outgoing ClientHello's SNI to a spoofed
# identity. The RM520N-GL runs tpws instead, which has no fake-SNI mode at all
# -- it only splits/reorders the connection's REAL ClientHello. So the mode
# never impersonated anything; it just ran the anti-DPI recipe unscoped.
#
# The rename moves the persisted config section too, and THAT is the dangerous
# half. config.sh's qm_config_init only SEEDS an empty config file -- it has no
# key-migration primitive and returns early the moment $QM_CONFIG is non-empty:
#
#     qm_config_init() { [ -s "$QM_CONFIG" ] && return 0; ... }
#
# Every already-deployed device has a non-empty /etc/qmanager/qmanager.conf
# carrying traffic_masquerade.{enabled,sni_domain}. Renaming the seed alone
# therefore does NOTHING to those devices: the reader looks up full_bypass,
# qm_config_get's `// empty` returns the caller's default, and a user who had
# the mode ON silently comes back from an OTA with it OFF. There is no error,
# no log line, and no way for the user to tell it happened.
#
# So the rename owes an explicit one-shot migration. This harness pins it.
#
# HOW IT TESTS (behavioural, not text-anchored)
# ----------------------------------------------
# jq is available on the workstation and config.sh is a real sourceable lib
# (double-source guard, no `main "$@"`), so sections [1]-[6] run the ACTUAL
# migration against ACTUAL config files in a temp dir rather than grepping
# source text. QM_CONFIG / QM_CONFIG_TMP are hardcoded at the top of config.sh
# with no ${:-} default, so they are overridden AFTER sourcing.
#
# install_rm520n.sh cannot be sourced -- :3693 is a bare `main "$@"` with no
# BASH_SOURCE guard (see change-workflow.md > "Behavioural where possible") --
# so the migration function is awk-extracted, the same technique
# dpi-uninstall-path-symmetry.sh section [4] uses on _dpi_uninstall_run.
#
# Section [8] is the one deliberately static assertion, and it is the one that
# matters most on OTA: a migration function that exists but is never CALLED is
# indistinguishable from no migration at all, and every behavioural section
# above it would still pass.
#
# This file is COMMITTED RED, before the rename exists (change-workflow.md,
# Phase 4a). The builder who writes the rename does not edit this file.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CONFIG_SH="$REPO_ROOT/scripts/usr/lib/qmanager/config.sh"
INSTALLER="$REPO_ROOT/scripts/install_rm520n.sh"

MIGRATION_FN="migrate_traffic_masquerade_to_full_bypass"

pass_count=0
fail_count=0

ok()  { pass_count=$((pass_count + 1)); printf '  ok   %s\n' "$1"; }
bad() { fail_count=$((fail_count + 1)); printf '  FAIL %s\n' "$1"; }

for f in "$CONFIG_SH" "$INSTALLER"; do
    [ -f "$f" ] || { echo "missing: $f" >&2; exit 1; }
done

command -v jq >/dev/null 2>&1 || { echo "jq not on PATH -- cannot run behavioural sections" >&2; exit 1; }

TMPD=$(mktemp -d)
trap 'rm -rf "$TMPD"' EXIT

# -----------------------------------------------------------------------------
# Harness plumbing
# -----------------------------------------------------------------------------
# Load config.sh once into this shell, then point its two path globals at the
# temp dir. Every helper below reads those globals at call time, so this is
# enough to isolate the whole thing from the real /etc/qmanager.
# config.sh's double-source guard tests $_CONFIG_LOADED unquoted-of-set, which
# is an unbound-variable error under this harness's `set -u`. It is not one on
# the device: BusyBox sh runs it without -u. Predefine rather than dropping -u,
# so the rest of the harness keeps the guard.
_CONFIG_LOADED=""
# shellcheck source=/dev/null
. "$CONFIG_SH"
QM_CONFIG="$TMPD/qmanager.conf"
QM_CONFIG_TMP="$TMPD/qmanager.conf.tmp"

# The migration under test, lifted out of the installer.
MIGRATION_SRC=$(awk "/^${MIGRATION_FN}\(\) \{\$/,/^\}\$/" "$INSTALLER")
if [ -n "$MIGRATION_SRC" ]; then
    # shellcheck disable=SC1090
    eval "$MIGRATION_SRC"
fi

have_migration() { [ -n "$MIGRATION_SRC" ] && command -v "$MIGRATION_FN" >/dev/null 2>&1; }

# Write a config fixture and run the migration over it, capturing nothing.
# `|| true` mirrors how install_backend calls it: this harness must observe a
# non-zero return as a state assertion, never as its own abort.
run_migration() { "$MIGRATION_FN" >/dev/null 2>&1 || true; }

seed() { printf '%s\n' "$1" > "$QM_CONFIG"; }

# jq read that distinguishes "absent" from "present and null".
q() { jq -r "$1 // \"<absent>\"" "$QM_CONFIG" 2>/dev/null || printf '<unreadable>'; }
has_section() { jq -e "has(\"$1\")" "$QM_CONFIG" >/dev/null 2>&1; }

LEGACY_ONLY='{
  "video_optimizer": { "enabled": 0, "strategy": "full" },
  "traffic_masquerade": { "enabled": 1, "sni_domain": "foo.example" }
}'

# =============================================================================
printf '\n[1] config.sh grows a SECTION-level delete primitive\n'
# =============================================================================
# qm_config_delete is key-scoped. Using it to retire the old section would
# leave `"traffic_masquerade": {}` behind -- an empty object named after the
# exact concept this rename exists to remove, sitting on every device forever.
# The primitive mirrors qm_config_delete's gated-mv pattern: jq's exit status
# gates the publish, so a corrupt config can never be clobbered by the empty
# temp the `>` redirect creates before jq runs.
if command -v qm_config_delete_section >/dev/null 2>&1; then
    ok "qm_config_delete_section is defined"

    seed '{"a":{"k":1},"traffic_masquerade":{"enabled":1}}'
    qm_config_delete_section traffic_masquerade >/dev/null 2>&1 || true
    if has_section traffic_masquerade; then
        bad "qm_config_delete_section left the section in place"
    else
        ok "qm_config_delete_section removes the whole section"
    fi
    if [ "$(q '.a.k')" = "1" ]; then
        ok "qm_config_delete_section leaves sibling sections untouched"
    else
        bad "qm_config_delete_section damaged a sibling section"
    fi

    # No-op cases must succeed, not fail: the migration calls this on devices
    # that may already be migrated, under `set -e`.
    seed '{"a":{"k":1}}'
    if qm_config_delete_section traffic_masquerade >/dev/null 2>&1; then
        ok "deleting an absent section returns success (no-op)"
    else
        bad "deleting an absent section returns non-zero -- would abort a set -e installer"
    fi
else
    bad "qm_config_delete_section is not defined in config.sh -- retiring the old section would strand an empty \"traffic_masquerade\": {}"
    bad "(skipped) qm_config_delete_section removes the whole section"
    bad "(skipped) qm_config_delete_section leaves sibling sections untouched"
    bad "(skipped) deleting an absent section returns success"
fi

# =============================================================================
printf '\n[2] an already-deployed device keeps its saved state\n'
# =============================================================================
# THE DEFECT THIS PINS. Without the migration, full_bypass.enabled reads back
# as the caller's default (0) on every device that had the mode switched on.
if ! have_migration; then
    bad "$MIGRATION_FN is not defined in install_rm520n.sh -- every deployed device silently loses its saved state on the first read after this ships"
    bad "(skipped) enabled survives the rename"
    bad "(skipped) sni_domain survives the rename"
    bad "(skipped) the legacy section is retired"
else
    seed "$LEGACY_ONLY"
    run_migration
    if [ "$(q '.full_bypass.enabled')" = "1" ]; then
        ok "full_bypass.enabled carried over from traffic_masquerade (1)"
    else
        bad "full_bypass.enabled is $(q '.full_bypass.enabled'), expected 1 -- the device's saved state was lost"
    fi
    if [ "$(q '.full_bypass.sni_domain')" = "foo.example" ]; then
        ok "full_bypass.sni_domain carried over (foo.example)"
    else
        bad "full_bypass.sni_domain is $(q '.full_bypass.sni_domain'), expected foo.example"
    fi
    if has_section traffic_masquerade; then
        bad "the traffic_masquerade section survived the migration -- two sources of truth"
    else
        ok "the traffic_masquerade section is retired"
    fi
fi

# =============================================================================
printf '\n[3] idempotent -- every install and every OTA runs it again\n'
# =============================================================================
if ! have_migration; then
    bad "(skipped) migration is idempotent"
else
    seed "$LEGACY_ONLY"
    run_migration
    first=$(cat "$QM_CONFIG")
    run_migration
    run_migration
    if [ "$first" = "$(cat "$QM_CONFIG")" ]; then
        ok "re-running the migration changes nothing"
    else
        bad "the migration is not idempotent -- it mutates an already-migrated config"
    fi
fi

# =============================================================================
printf '\n[4] a fresh install is not clobbered\n'
# =============================================================================
# qm_config_init seeds full_bypass directly. The migration runs immediately
# after it in install_backend(), on a config that has no legacy section at all.
if ! have_migration; then
    bad "(skipped) a freshly seeded config is left alone"
else
    rm -f "$QM_CONFIG"
    qm_config_init
    before=$(cat "$QM_CONFIG")
    run_migration
    if [ "$before" = "$(cat "$QM_CONFIG")" ]; then
        ok "a freshly seeded config is left byte-identical"
    else
        bad "the migration rewrote a fresh config that had nothing to migrate"
    fi
fi

# =============================================================================
printf '\n[5] a partial prior run: the NEW section wins\n'
# =============================================================================
# Reachable if an earlier OTA wrote full_bypass and then died before retiring
# the legacy section (a jq failure mid-migration, `|| true`, next boot retries).
# The stale legacy value must not overwrite the live one -- that would revert a
# change the user made between the two runs.
if ! have_migration; then
    bad "(skipped) full_bypass wins when both sections are present"
    bad "(skipped) the legacy section is still retired"
else
    seed '{
      "traffic_masquerade": { "enabled": 1, "sni_domain": "stale.example" },
      "full_bypass": { "enabled": 0, "sni_domain": "live.example" }
    }'
    run_migration
    if [ "$(q '.full_bypass.enabled')" = "0" ] && [ "$(q '.full_bypass.sni_domain')" = "live.example" ]; then
        ok "full_bypass wins -- the stale legacy values did not overwrite it"
    else
        bad "the stale traffic_masquerade values overwrote live full_bypass state"
    fi
    if has_section traffic_masquerade; then
        bad "the legacy section survived the both-present case"
    else
        ok "the legacy section is retired in the both-present case"
    fi
fi

# =============================================================================
printf '\n[6] a corrupt config must not abort the OTA, nor be truncated\n'
# =============================================================================
# install_backend() runs under `set -e` and calls this function bare. config.sh's
# writers return 1 on a jq failure, so every write in the migration needs
# `|| true` -- exactly as migrate_watchcat_fail_threshold documents at
# install_rm520n.sh:1988. Getting this wrong turns an unparseable config into a
# dead OTA on a device with no console.
if ! have_migration; then
    bad "(skipped) a corrupt config returns success"
    bad "(skipped) a corrupt config is not truncated"
else
    printf '%s' 'this is not json {{{' > "$QM_CONFIG"
    if "$MIGRATION_FN" >/dev/null 2>&1; then
        ok "a corrupt config returns success (the installer survives)"
    else
        bad "the migration returns non-zero on a corrupt config -- under set -e this aborts the whole install/OTA"
    fi
    if [ -s "$QM_CONFIG" ]; then
        ok "a corrupt config is left intact, not truncated"
    else
        bad "the migration truncated an unparseable config to empty"
    fi
fi

# =============================================================================
printf '\n[7] the seed itself is renamed\n'
# =============================================================================
# A migration without a renamed seed means fresh installs get the old section
# back, and the migration then has to run forever. A renamed seed without the
# migration is the silent-reset bug. Both halves, or neither.
rm -f "$QM_CONFIG"
qm_config_init
if has_section full_bypass; then
    ok "qm_config_init seeds full_bypass"
else
    bad "qm_config_init does not seed full_bypass"
fi
if has_section traffic_masquerade; then
    bad "qm_config_init still seeds traffic_masquerade -- fresh installs re-create the retired section"
else
    ok "qm_config_init no longer seeds traffic_masquerade"
fi
if [ "$(q '.full_bypass.sni_domain')" = "speedtest.net" ]; then
    ok "the seed keeps sni_domain (RM551 API-contract parity, inert on this platform)"
else
    bad "the seed lost sni_domain -- the CGI contract still publishes it"
fi

# =============================================================================
printf '\n[8] the migration is actually WIRED into the install path\n'
# =============================================================================
# The one static assertion here, and the one the behavioural sections cannot
# make: a migration nobody calls passes [1]-[7] and does nothing on any device.
# It must be invoked from install_backend(), inside the block that has already
# sourced the freshly-installed $LIB_DIR/config.sh -- which is what puts
# qm_config_delete_section in scope at all.
INSTALL_BACKEND=$(awk '/^install_backend\(\) \{$/,/^\}$/' "$INSTALLER")
if printf '%s' "$INSTALL_BACKEND" | grep -qE "^[[:space:]]*${MIGRATION_FN}([[:space:]]|$)"; then
    ok "install_backend() calls $MIGRATION_FN"
else
    bad "install_backend() never calls $MIGRATION_FN -- the migration is dead code and every OTA'd device still loses its state"
fi
# Ordering: it has to land after the `. "$LIB_DIR/config.sh"` that defines the
# primitives, otherwise the call resolves to nothing and fails silently.
src_line=$(printf '%s\n' "$INSTALL_BACKEND" | grep -n '\. "\$LIB_DIR/config\.sh"' | head -1 | cut -d: -f1 || true)
mig_line=$(printf '%s\n' "$INSTALL_BACKEND" | grep -nE "^[[:space:]]*${MIGRATION_FN}([[:space:]]|$)" | head -1 | cut -d: -f1 || true)
if [ -n "$src_line" ] && [ -n "$mig_line" ] && [ "$mig_line" -gt "$src_line" ]; then
    ok "the call sits after config.sh is sourced"
else
    bad "the migration call does not follow the config.sh source -- its helpers would not be in scope"
fi

# =============================================================================
printf '\n[9] syntax sanity\n'
# =============================================================================
for f in "$CONFIG_SH" "$INSTALLER"; do
    if "${BASH:-bash}" -n "$f" 2>/dev/null; then
        ok "bash -n clean: $(basename "$f")"
    else
        bad "bash -n FAILED: $(basename "$f")"
    fi
done

printf '\n[full-bypass-config-migration] %d passed, %d failed\n' "$pass_count" "$fail_count"
[ "$fail_count" -eq 0 ] || exit 1
