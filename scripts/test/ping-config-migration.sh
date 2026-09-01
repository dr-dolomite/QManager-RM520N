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

# =============================================================================
printf '\n[10] an EMPTY legacy value falls through to the default\n'
# =============================================================================
# ADDED 2026-09-02. jq's `//` substitutes on null and false only, NEVER on "",
# so `.target_ip_1 = (.target_ip_1 // .target_ipv4 // $i1)` persisted an empty
# string straight to disk when the legacy config carried one. Every runtime
# reader tests with -n so the daemon still probed correctly, which is exactly
# what made it silent: the on-disk file was wrong and nothing said so.
seed_cfg '{"profile":"relaxed","interval_sec":5,"target_ipv4":"","target_ipv6":""}'
run_migration
got=$(q '.target_ip_1')
if [ "$got" = "1.1.1.1" ]; then
    ok 'an empty legacy target_ipv4 falls through to the 1.1.1.1 default'
else
    bad "target_ip_1 = '$got' -- an empty string was carried through as if it were a chosen value"
fi
for pair in "target_host_1:cloudflare.com" "target_host_2:google.com" "target_ip_2:8.8.8.8"; do
    key="${pair%%:*}"; want="${pair#*:}"
    got=$(q ".$key")
    if [ "$got" = "$want" ]; then
        ok "$key = $want alongside the empty legacy value"
    else
        bad "$key = '$got', expected '$want'"
    fi
done

# The same hole in the GATE: a config whose target_host_1 is empty is not
# migrated, it is broken, and has() cannot tell the two apart.
seed_cfg '{"profile":"relaxed","interval_sec":5,"target_host_1":"","target_ipv4":"9.9.9.9"}'
run_migration
got=$(q '.target_host_1')
if [ "$got" = "cloudflare.com" ]; then
    ok 'an empty target_host_1 is treated as unmigrated and reseeded'
else
    bad "target_host_1 = '$got' -- the gate accepted an empty slot as already migrated"
fi
got=$(q '.target_ip_1')
if [ "$got" = "9.9.9.9" ]; then
    ok 'the legacy target_ipv4 still carried across on that same run'
else
    bad "target_ip_1 = '$got', expected the legacy 9.9.9.9"
fi

# =============================================================================
printf '\n[11] the seeded debounce triple is retired from deployed configs\n'
# =============================================================================
# ADDED 2026-09-02. resolve_profile() lets a per-field JSON value override the
# profile table, so the fail_secs/recover_secs/history_secs the old seed wrote
# shadowed that table on every device: all four profiles shared one debounce
# window and differed only in cadence. The seed no longer writes them; this
# migration retires them from configs that already have them.
SHADOW_FN="migrate_ping_debounce_shadow"
SHADOW_SRC=$(awk "/^${SHADOW_FN}\(\) \{\$/,/^\}\$/" "$INSTALLER" \
    | sed -e "s#/etc/qmanager/ping_profile.json#${CFG}#g" \
          -e "s#/etc/qmanager/#${TMPD}/#g")
if [ -n "$SHADOW_SRC" ]; then
    # shellcheck disable=SC1090
    eval "$SHADOW_SRC"
fi
run_shadow() { "$SHADOW_FN" >/dev/null 2>&1 || true; }

if [ -n "$SHADOW_SRC" ] && command -v "$SHADOW_FN" >/dev/null 2>&1; then
    ok "$SHADOW_FN extracted from install_rm520n.sh"
else
    bad "$SHADOW_FN could not be extracted from install_rm520n.sh"
fi

# The untouched seeded triple goes.
seed_cfg "$LEGACY"
run_migration
run_shadow
gone=true
for key in fail_secs recover_secs history_secs; do
    has "$key" && gone=false
done
if [ "$gone" = true ]; then
    ok "the untouched 15/10/300 triple is deleted, so the profile table governs"
else
    bad "a debounce key survived (fail_secs=$(q '.fail_secs') recover_secs=$(q '.recover_secs') history_secs=$(q '.history_secs'))"
fi
# ...and the targets it was NOT asked to touch are still there.
if [ "$(q '.target_ip_1')" = "1.1.1.1" ] && [ "$(q '.profile')" = "relaxed" ]; then
    ok "the debounce migration left the targets and the profile name alone"
else
    bad "the debounce migration disturbed other keys (target_ip_1=$(q '.target_ip_1') profile=$(q '.profile'))"
fi
# Idempotent.
first=$(cat "$CFG"); run_shadow; second=$(cat "$CFG")
if [ "$first" = "$second" ]; then
    ok "a second run of $SHADOW_FN is a byte-for-byte no-op"
else
    bad "$SHADOW_FN rewrote an already-migrated config"
fi

# A HAND-EDITED triple is a chosen value and must survive, exactly as
# migrate_ping_targets refuses to reseed a chosen target.
seed_cfg '{"profile":"relaxed","interval_sec":5,"fail_secs":45,"recover_secs":10,"history_secs":300,"target_host_1":"cloudflare.com","target_host_2":"google.com","target_ip_1":"1.1.1.1","target_ip_2":"8.8.8.8"}'
run_shadow
if [ "$(q '.fail_secs')" = "45" ]; then
    ok "a hand-edited fail_secs is not deleted"
else
    bad "fail_secs = $(q '.fail_secs') -- a customised debounce window was discarded"
fi

# =============================================================================
printf '\n[12] STATIC: the debounce migration is CALLED from install_backend\n'
# =============================================================================
shadow_calls=$(grep -cE "^[[:space:]]+${SHADOW_FN}[[:space:]]*$" "$INSTALLER" || true)
if [ "${shadow_calls:-0}" -ge 1 ]; then
    ok "$SHADOW_FN is invoked from the installer body ($shadow_calls call site)"
else
    bad "$SHADOW_FN is defined but never invoked -- deployed devices keep the shadow forever"
fi

# =============================================================================
printf '\n[13] STATIC: the seed ships no debounce override\n'
# =============================================================================
for key in fail_secs recover_secs history_secs; do
    if jq -e "has(\"$key\")" "$SEED" >/dev/null 2>&1; then
        bad "seed ping_profile.json still declares $key -- it shadows resolve_profile's table"
    else
        ok "seed ping_profile.json no longer declares $key"
    fi
done

# =============================================================================
printf '\n[14] STATIC: no profile row promises a fail window shorter than one cycle\n'
# =============================================================================
# fail_elapsed_sec is 0 on the first failing cycle, so the earliest possible
# down-verdict is one whole cycle period after the outage starts. The failing
# chain is capped at 4 legs x PROBE_DEADLINE, plus forks, plus the floored
# 1s sleep -- about 13.4s. A fail_secs below that is not aggressive, it is a
# promise the chain cannot keep, and the table shipped two of them (6 and 10).
FAIL_FLOOR=14
# Only the LITERAL table rows. The per-field override line further down the
# same function assigns from a variable, not a number, and is not a promise.
table_rows=$(sed -n '/^resolve_profile() {/,/^}/p' "$DAEMON" \
    | grep -oE '_fail_secs=[0-9]+' | sed 's/.*=//')
table_ok=true
for secs in $table_rows; do
    if [ "$secs" -lt "$FAIL_FLOOR" ]; then
        bad "a profile row promises fail_secs=${secs}s, below the ${FAIL_FLOOR}s one-cycle floor"
        table_ok=false
    fi
done
if [ "$table_ok" = true ] && [ -n "$table_rows" ]; then
    ok "every resolve_profile row promises a fail window of at least ${FAIL_FLOOR}s ($(printf '%s' "$table_rows" | tr '\n' ' '))"
elif [ -z "$table_rows" ]; then
    bad "no literal fail windows found in resolve_profile -- the table moved or the assertion is looking in the wrong place"
fi
# Four rows, four DISTINCT windows -- a floor that collapses two profiles into
# one is not a fix, it is a silently duplicated row.
row_count=$(printf '%s\n' "$table_rows" | grep -c '[0-9]')
uniq_count=$(printf '%s\n' "$table_rows" | sort -u | grep -c '[0-9]')
if [ "$row_count" -eq 4 ] && [ "$uniq_count" -eq 4 ]; then
    ok "all four profile rows still carry a distinct fail window"
else
    bad "resolve_profile has $row_count literal rows but only $uniq_count distinct fail windows"
fi

printf '\n---------------------------------------------\n'
printf 'ping-config-migration: %d passed, %d failed\n\n' "$pass_count" "$fail_count"
[ "$fail_count" -eq 0 ]
