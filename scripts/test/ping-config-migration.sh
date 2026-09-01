#!/usr/bin/env bash
# Regression harness for the ping_profile.json 2-target -> 4-target migration.
#
# WHY THIS EXISTS
# ----------------
# The connectivity probe moves from a two-leg chain (target_ipv4 tried first,
# target_ipv6 as fallback) to a four-leg chain in a fixed probe order:
#
#     target_host_1  target_host_2  target_ip_1  target_ip_2
#
# config.sh has no key-migration primitive and the ping profile is a plain
# JSON file the installer only ever SEEDS when absent, so an already-deployed
# device keeps its old two-key shape forever unless something rewrites it.
# migrate_ping_targets() in scripts/install_rm520n.sh already carries the exact
# precedent for that rewrite (same-filesystem mktemp inside /etc/qmanager,
# chmod+chown on the temp file BEFORE the rename, an idempotent gate), so it is
# EXTENDED rather than replaced.
#
# Two failure shapes are pinned here because both are silent on a live device:
#
#   M1  A migration that reseeds the defaults unconditionally throws away a
#       target the user deliberately chose. The old target_ipv4 is the one
#       legacy value that still means something in the new shape -- it is an
#       IPv4 literal and target_ip_1 is an IPv4 literal slot -- so it must
#       carry across.
#   M2  A migration that is not idempotent re-fires on every OTA. The gate is
#       the presence of target_host_1, not the absence of the legacy keys.
#
# The retired keys go too: target_ipv6 (the family is now chosen by the
# resolver, not by a config slot) and intercept_secs (pruned outright -- it has
# no reader in shipped code and none is possible under the settled binary
# verdict).
#
# HOW IT TESTS
# ------------
# install_rm520n.sh cannot be sourced -- it ends in a bare `main "$@"` with no
# BASH_SOURCE guard -- so the migration function is awk-extracted and eval'd,
# the technique full-bypass-config-migration.sh and dpi-uninstall-path-symmetry.sh
# both use. The function's hardcoded /etc/qmanager path is rewritten to a temp
# directory in the extracted text, so the real device config is never touched.
#
# Section [7] is the deliberately static one and it is the one that matters most
# on OTA: a migration that exists but is never CALLED is indistinguishable from
# no migration at all, and every behavioural section above it would still pass.
#
# This harness is COMMITTED RED, before the migration exists (change-workflow.md,
# Phase 4a). The builder who writes the migration does not edit this file.
#
# Run: bash scripts/test/ping-config-migration.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INSTALLER="$REPO_ROOT/scripts/install_rm520n.sh"
SEED="$REPO_ROOT/scripts/etc/qmanager/ping_profile.json"
DAEMON="$REPO_ROOT/scripts/usr/bin/qmanager_ping"

MIGRATION_FN="migrate_ping_targets"

pass_count=0
fail_count=0
ok()  { pass_count=$((pass_count + 1)); printf '  ok   %s\n' "$1"; }
bad() { fail_count=$((fail_count + 1)); printf '  FAIL %s\n' "$1"; }

for f in "$INSTALLER" "$SEED" "$DAEMON"; do
    [ -f "$f" ] || { echo "FAIL: missing $f" >&2; exit 1; }
done

if ! command -v jq >/dev/null 2>&1; then
    echo "SKIP: jq not on PATH -- this harness is entirely jq-driven" >&2
    exit 0
fi

TMPD=$(mktemp -d)
trap 'rm -rf "$TMPD"' EXIT

CFG="$TMPD/ping_profile.json"

# --- Lift the migration out of the installer and re-point it at the temp dir --
# The function hardcodes /etc/qmanager/ping_profile.json and mktemp's its
# scratch file inside /etc/qmanager (deliberately: mv is only atomic within one
# filesystem). Both paths are rewritten so the harness stays non-destructive.
MIGRATION_SRC=$(awk "/^${MIGRATION_FN}\(\) \{\$/,/^\}\$/" "$INSTALLER" \
    | sed -e "s#/etc/qmanager/ping_profile.json#${CFG}#g" \
          -e "s#/etc/qmanager/#${TMPD}/#g")

if [ -n "$MIGRATION_SRC" ]; then
    # shellcheck disable=SC1090
    eval "$MIGRATION_SRC"
fi

have_migration() { [ -n "$MIGRATION_SRC" ] && command -v "$MIGRATION_FN" >/dev/null 2>&1; }

# `|| true` mirrors how install_backend calls it: a non-zero return is a state
# assertion for us to observe, never this harness's own abort.
run_migration() { "$MIGRATION_FN" >/dev/null 2>&1 || true; }

seed_cfg() { printf '%s\n' "$1" > "$CFG"; }
q()   { jq -r "$1 // \"<absent>\"" "$CFG" 2>/dev/null || printf '<unreadable>'; }
has() { jq -e "has(\"$1\")" "$CFG" >/dev/null 2>&1; }

# The shape every already-deployed device is carrying right now.
LEGACY='{
  "profile": "relaxed",
  "interval_sec": 5,
  "fail_secs": 15,
  "recover_secs": 10,
  "intercept_secs": 8,
  "history_secs": 300,
  "target_ipv4": "1.1.1.1",
  "target_ipv6": "2606:4700:4700::1111"
}'

# =============================================================================
printf '\n[0] the migration function is still present and extractable\n'
# =============================================================================
if have_migration; then
    ok "$MIGRATION_FN extracted from install_rm520n.sh"
else
    bad "$MIGRATION_FN could not be extracted from install_rm520n.sh"
fi

# =============================================================================
printf '\n[1] a stock legacy config gains all four new target slots\n'
# =============================================================================
seed_cfg "$LEGACY"
run_migration
for pair in "target_host_1:cloudflare.com" "target_host_2:google.com" "target_ip_1:1.1.1.1" "target_ip_2:8.8.8.8"; do
    key="${pair%%:*}"; want="${pair#*:}"
    got=$(q ".$key")
    if [ "$got" = "$want" ]; then
        ok "$key = $want"
    else
        bad "$key = '$got', expected '$want'"
    fi
done

# =============================================================================
printf '\n[2] the retired keys are gone\n'
# =============================================================================
# target_ipv6 retires because the resolver, not a config slot, now chooses the
# address family. intercept_secs retires because the verdict is binary and no
# shipped code reads it.
for key in target_ipv6 intercept_secs target_1 target_2; do
    if has "$key"; then
        bad "$key survived the migration (value: $(q ".$key"))"
    else
        ok "$key is deleted"
    fi
done

# =============================================================================
printf '\n[3] the daemon debounce keys are NOT collateral damage\n'
# =============================================================================
# fail_secs / recover_secs / history_secs / interval_sec are the daemon's own
# runtime tuning and are written by a different owner. A migration that rebuilds
# the object instead of merging into it would silently reset every one of them.
for pair in "profile:relaxed" "interval_sec:5" "fail_secs:15" "recover_secs:10" "history_secs:300"; do
    key="${pair%%:*}"; want="${pair#*:}"
    got=$(q ".$key")
    if [ "$got" = "$want" ]; then
        ok "$key preserved ($want)"
    else
        bad "$key = '$got', expected the pre-migration '$want'"
    fi
done

# =============================================================================
printf '\n[4] a CUSTOMISED target_ipv4 carries into target_ip_1 (M1)\n'
# =============================================================================
# The one legacy value that still means something: an IPv4 literal moving into
# an IPv4-literal slot. Reseeding the default here silently reverts a target the
# user deliberately chose, with no log line and no way to notice.
seed_cfg '{"profile":"quiet","target_ipv4":"9.9.9.9","target_ipv6":"2606:4700:4700::1111","intercept_secs":8}'
run_migration
got=$(q '.target_ip_1')
if [ "$got" = "9.9.9.9" ]; then
    ok "customised target_ipv4 9.9.9.9 carried into target_ip_1"
else
    bad "target_ip_1 = '$got' -- the user's customised 9.9.9.9 was discarded"
fi
# The other three slots still take their defaults on the same device.
got=$(q '.target_ip_2')
if [ "$got" = "8.8.8.8" ]; then
    ok "target_ip_2 still seeded to the default alongside the preserved slot"
else
    bad "target_ip_2 = '$got', expected 8.8.8.8"
fi

# =============================================================================
printf '\n[5] the migration is idempotent (M2)\n'
# =============================================================================
seed_cfg "$LEGACY"
run_migration
first=$(cat "$CFG")
run_migration
second=$(cat "$CFG")
if [ "$first" = "$second" ]; then
    ok "a second run is a byte-for-byte no-op"
else
    bad "a second run rewrote the file -- the gate is not idempotent"
fi
# And it must not stomp a target the user changed AFTER migrating.
jq '.target_ip_1 = "9.9.9.9"' "$CFG" > "$CFG.x" && mv "$CFG.x" "$CFG"
run_migration
got=$(q '.target_ip_1')
if [ "$got" = "9.9.9.9" ]; then
    ok "a post-migration customisation survives the next OTA"
else
    bad "target_ip_1 = '$got' -- a re-fire reseeded a value the user set after migrating"
fi

# =============================================================================
printf '\n[6] an already-new config with NO legacy keys is left alone\n'
# =============================================================================
# The gate is the presence of target_host_1, not the presence of target_ipv4:
# a fresh install seeded from the new ping_profile.json has no legacy key at all
# and must not be treated as unmigrated.
seed_cfg '{"profile":"relaxed","interval_sec":5,"target_host_1":"example.net","target_host_2":"example.org","target_ip_1":"9.9.9.9","target_ip_2":"149.112.112.112"}'
before=$(cat "$CFG")
run_migration
after=$(cat "$CFG")
if [ "$before" = "$after" ]; then
    ok "a fully-migrated config is untouched"
else
    bad "a fully-migrated config was rewritten (target_host_1 is now '$(q '.target_host_1')')"
fi

# =============================================================================
printf '\n[7] STATIC: the migration is still CALLED from install_backend\n'
# =============================================================================
# A migration nothing invokes is indistinguishable from no migration, and every
# behavioural section above would still pass.
call_count=$(grep -cE "^[[:space:]]+${MIGRATION_FN}[[:space:]]*$" "$INSTALLER" || true)
if [ "${call_count:-0}" -ge 1 ]; then
    ok "$MIGRATION_FN is invoked from the installer body ($call_count call site)"
else
    bad "$MIGRATION_FN is defined but never invoked"
fi

# =============================================================================
printf '\n[8] STATIC: the shipped SEED carries the new shape, not the old one\n'
# =============================================================================
# A device installing fresh never runs the migration at all -- it gets this file
# verbatim -- so the seed and the migration must agree.
for key in target_host_1 target_host_2 target_ip_1 target_ip_2; do
    if jq -e "has(\"$key\")" "$SEED" >/dev/null 2>&1; then
        ok "seed ping_profile.json declares $key"
    else
        bad "seed ping_profile.json is missing $key"
    fi
done
for key in target_ipv4 target_ipv6 intercept_secs; do
    if jq -e "has(\"$key\")" "$SEED" >/dev/null 2>&1; then
        bad "seed ping_profile.json still declares the retired $key"
    else
        ok "seed ping_profile.json no longer declares $key"
    fi
done

# =============================================================================
printf '\n[9] STATIC: intercept_secs has no reader left anywhere in the daemon\n'
# =============================================================================
# Pruned, not merely unseeded. Comments are stripped first so this file's own
# prose about the retired key cannot satisfy or trip the assertion.
daemon_code=$(sed -e 's/#.*$//' "$DAEMON")
if printf '%s' "$daemon_code" | grep -q 'intercept_secs'; then
    bad "qmanager_ping still references intercept_secs"
else
    ok "qmanager_ping has no intercept_secs reference"
fi

printf '\n---------------------------------------------\n'
printf 'ping-config-migration: %d passed, %d failed\n\n' "$pass_count" "$fail_count"
[ "$fail_count" -eq 0 ]
