#!/usr/bin/env bash
# Regression harness for F22: the auth-backup store must not live inside
# /etc/qmanager.
#
# WHY THIS EXISTS
# ----------------
# $BACKUP_DIR holds timestamped auth.json snapshots — the QManager login
# password, once per install/OTA run, newest 5 kept. It used to sit at
# /etc/qmanager/backups, and nothing root-owned can survive in there:
#
#   1. Unlinking or renaming a directory entry requires write permission on
#      the PARENT directory, not on the entry. www-data OWNS /etc/qmanager
#      (the CGI genuinely writes auth.json, profiles/, ping_profile.json and
#      the *_alerts.json blobs there) and mode 0755 grants the owner rwx —
#      so www-data can unlink or replace anything inside, whatever that
#      thing's own owner and mode say.
#   2. qmanager_setup:177 runs `chown -R www-data:www-data /etc/qmanager`
#      unconditionally on EVERY boot with no exclusion list, so any
#      install-time root:root pin has a lifetime of exactly one boot cycle.
#
# F15 raised the directory from 0777 to 0700, which removed every OTHER
# local uid and was a real improvement — but 0700 owned by www-data means
# "www-data only", not "root only", so it could never close this. A chown
# exclusion list is not the fix either: qmanager_setup:144-156 forbids that
# pattern in its own comment, because it addresses (2) while leaving (1)
# untouched, and (1) alone is sufficient. This exact mistake already cost
# one privilege-escalation bug — the retired /etc/qmanager/environment
# EnvironmentFile, relocated to /etc/qmanager.env by
# migrate_environment_location().
#
# So the fix is relocation to a sibling under root-owned /etc, following the
# two relocations already shipped in this same installer:
# /etc/qmanager.env (migrate_environment_location) and /etc/qmanager-secrets
# (migrate_alert_secrets).
#
# WHY THIS MIGRATION IS NOT A COPY OF EITHER PRECEDENT
# -----------------------------------------------------
# Both precedents move ONE file. This moves a DIRECTORY OF N FILES, and two
# codings that are correct for a single file are actively wrong here:
#
#   - A directory-level `mv "$src" "$dst"` is unsafe. BusyBox `mv dir dir`
#     does not fail when the destination exists — it NESTS the source
#     inside it. The destination here is a live directory that
#     backup_originals() recreates on every run, so a bare mv would bury the
#     snapshots one level below where the prune reader
#     (`ls -1 "$BACKUP_DIR"/auth.json.*`) can ever see them again.
#   - `[ -f/-d "$dst" ] && treat as already-migrated` is invalid as the
#     completion signal, for the same reason: the destination exists on
#     essentially every run regardless of whether the old store was moved.
#     The gate must key on the OLD path's presence.
#
# ORDERING is load-bearing and is asserted below. backup_originals() creates
# the store, takes the fresh snapshot AND prunes to the newest 5, all in one
# call, and main() calls it BEFORE install_backend(). If the migration ran
# from install_backend()'s migration block (where both precedents live), the
# legacy snapshots would land in the store AFTER the prune had already run,
# leaving up to 10 files with no further prune pass — silently breaking the
# retention cap on every device's first post-fix OTA. And the call must sit
# OUTSIDE the `if [ "$DO_FRONTEND" = "1" ]` block, because backup_originals()
# is gated on that flag: a `--backend-only` run would otherwise never migrate,
# leaving the password snapshots in the swept directory exactly on the
# devices someone was repairing.
#
# WHAT THIS HARNESS ASSERTS
# --------------------------
# Sections [1]-[4] are TEXTUAL, over installer source. install_rm520n.sh
# ends in a bare `main "$@"` with no BASH_SOURCE guard, so a harness cannot
# source the file to call one function, and the Windows/Git Bash workstation
# cannot model POSIX modes (chmod 0666 then stat %a returns 644), so a
# "the directory ends up 0700" assertion would pass trivially here whether
# or not the fix exists. Ordering and wiring are therefore the only defense
# these sections can offer — which is exactly what stops a builder from
# renaming the function, re-gating the call, or substituting a weaker
# mechanism.
#
# Section [5] is BEHAVIOURAL. The migration function is extracted from the
# installer with awk into a scratch file and run for real against temp
# trees, so the directory-vs-file hazards above are exercised rather than
# asserted about. File modes are deliberately not checked there — see above.
#
# Anchors are matched by TEXT, never by line number.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INSTALLER="$REPO_ROOT/scripts/install_rm520n.sh"
UNINSTALLER="$REPO_ROOT/scripts/uninstall_rm520n.sh"

OLD_PATH="/etc/qmanager/backups"
NEW_PATH="/etc/qmanager-backups"
MIGRATE_FN="migrate_backup_location"

pass_count=0
fail_count=0

ok()  { pass_count=$((pass_count + 1)); printf '  ok   %s\n' "$1"; }
bad() { fail_count=$((fail_count + 1)); printf '  FAIL %s\n' "$1"; }

for f in "$INSTALLER" "$UNINSTALLER"; do
    [ -f "$f" ] || { printf 'missing required file: %s\n' "$f" >&2; exit 1; }
done

# ---------------------------------------------------------------------------
# [1] The store no longer lives inside the www-data-owned directory.
# ---------------------------------------------------------------------------
printf '\n[1] F22 — $BACKUP_DIR resolves outside /etc/qmanager\n'

backup_dir_value=$(sed -n 's/^BACKUP_DIR="\([^"]*\)".*/\1/p' "$INSTALLER" | head -n 1)

if [ -z "$backup_dir_value" ]; then
    bad 'BACKUP_DIR has no top-level assignment of the form BACKUP_DIR="..." in the installer'
elif [ "$backup_dir_value" = "$OLD_PATH" ]; then
    bad "BACKUP_DIR is still $OLD_PATH — inside the directory qmanager_setup chowns to www-data on every boot, so the auth.json snapshots are www-data-owned from the first boot after any install or OTA"
else
    case "$backup_dir_value" in
        /etc/qmanager/*)
            bad "BACKUP_DIR is $backup_dir_value — still a subtree of the www-data-owned /etc/qmanager, so relocating it there buys nothing; www-data owns the parent and can unlink or rename any entry regardless of mode"
            ;;
        "$NEW_PATH")
            ok "BACKUP_DIR is $NEW_PATH — a sibling under root-owned /etc, matching the /etc/qmanager.env and /etc/qmanager-secrets precedents"
            ;;
        *)
            ok "BACKUP_DIR is $backup_dir_value — outside /etc/qmanager (note: the shipped fix targets $NEW_PATH)"
            ;;
    esac
fi

# F15's mode pin must survive the relocation untouched. It is what makes the
# new path root-only rather than merely root-owned-for-one-boot.
if grep -qE 'install[[:space:]]+-d[[:space:]].*-m[[:space:]]+0700[[:space:]]+"\$BACKUP_DIR"([^/]|$)' "$INSTALLER"; then
    ok 'BACKUP_DIR is still pinned with install -d -m 0700 (F15 is not undone by the relocation)'
else
    bad 'BACKUP_DIR lost its install -d -m 0700 pin — F15 must survive this change'
fi

if grep -qE 'install[[:space:]]+-d[[:space:]]+-o[[:space:]]+root[[:space:]]+-g[[:space:]]+root[[:space:]]+-m[[:space:]]+0700[[:space:]]+"\$BACKUP_DIR"' "$INSTALLER"; then
    ok 'BACKUP_DIR is created root:root (now durable, since qmanager_setup no longer reaches the path)'
else
    bad 'BACKUP_DIR is not created with an explicit -o root -g root — the whole point of the relocation is that root ownership now persists'
fi

# ---------------------------------------------------------------------------
# [2] The migration function exists and honours the never-abort contract.
# ---------------------------------------------------------------------------
printf '\n[2] F22 — %s() exists and cannot abort an in-flight OTA\n' "$MIGRATE_FN"

if grep -qE "^${MIGRATE_FN}\(\)[[:space:]]*\{" "$INSTALLER"; then
    ok "$MIGRATE_FN() is defined"
    fn_body=$(awk "/^${MIGRATE_FN}\(\)[[:space:]]*\{/{f=1} f{print} f&&/^\}/{exit}" "$INSTALLER")
else
    bad "$MIGRATE_FN() is not defined — existing devices keep their snapshots in the swept directory forever"
    fn_body=""
fi

if [ -n "$fn_body" ]; then
    # Gate on the OLD path, never on destination existence. The destination
    # is recreated by backup_originals() on every run, so its existence
    # carries no information about whether the migration has happened.
    if printf '%s\n' "$fn_body" | grep -qE '\[[[:space:]]+-d[[:space:]]+"?'"$OLD_PATH"'"?[[:space:]]+\]'; then
        ok "gates on the presence of the OLD path ($OLD_PATH)"
    else
        bad "does not gate on [ -d $OLD_PATH ] — the only valid completion signal; the destination exists on every run and cannot serve as one"
    fi

    # A directory-level mv of the store nests on BusyBox instead of failing.
    if printf '%s\n' "$fn_body" | grep -qE '^[[:space:]]*mv[[:space:]]+"?\$(src|old)[a-z_]*"?[[:space:]]+"?\$(dst|new)[a-z_]*"?[[:space:]]*$'; then
        bad "moves the store with a directory-level mv — BusyBox mv nests into an existing destination instead of failing, which would bury every snapshot below the prune reader's ls glob"
    else
        ok 'does not move the store with a bare directory-level mv'
    fi

    # Never aborts the installer: it runs under set -e with services stopped.
    if printf '%s\n' "$fn_body" | grep -qE '^[[:space:]]*exit[[:space:]]+[0-9]'; then
        bad 'contains a bare `exit` — this runs under set -e with services already stopped, so a failure here must warn and return 0, never abort the OTA'
    else
        ok 'contains no bare `exit` (failure paths must warn and return 0)'
    fi

    if printf '%s\n' "$fn_body" | grep -qE '^[[:space:]]*return[[:space:]]+0[[:space:]]*$'; then
        ok 'has at least one explicit `return 0` early-out'
    else
        bad 'has no explicit `return 0` early-out — the never-abort contract needs one'
    fi
fi

# ---------------------------------------------------------------------------
# [3] Call-site wiring and ordering inside main().
# ---------------------------------------------------------------------------
printf '\n[3] F22 — %s() is wired unconditionally, before backup_originals\n' "$MIGRATE_FN"

main_body=$(awk '/^main\(\)[[:space:]]*\{/{f=1} f{print}' "$INSTALLER")

call_line=$(printf '%s\n' "$main_body" | grep -nE "^[[:space:]]*${MIGRATE_FN}[[:space:]]*$" | head -n 1 | cut -d: -f1 || true)
backup_line=$(printf '%s\n' "$main_body" | grep -nE '^[[:space:]]*backup_originals[[:space:]]*$' | head -n 1 | cut -d: -f1 || true)
frontend_gate_line=$(printf '%s\n' "$main_body" | grep -nE '^[[:space:]]*if \[ "\$DO_FRONTEND" = "1" \];' | head -n 1 | cut -d: -f1 || true)

if [ -z "$call_line" ]; then
    bad "$MIGRATE_FN is never called from main() — a defined-but-unwired migration is invisible on every install and every OTA"
else
    ok "$MIGRATE_FN is called from main()"

    if [ -n "$backup_line" ] && [ "$call_line" -lt "$backup_line" ]; then
        ok 'the call precedes backup_originals (so the legacy snapshots are in place before the prune-to-5 runs over the merged set)'
    else
        bad 'the call does not precede backup_originals — backup_originals creates the store, snapshots AND prunes in one call, so migrating afterwards leaves up to 10 files with no further prune pass'
    fi

    if [ -n "$frontend_gate_line" ] && [ "$call_line" -gt "$frontend_gate_line" ]; then
        bad 'the call sits inside (or after) the `if [ "$DO_FRONTEND" = "1" ]` block — a --backend-only run would then never migrate, leaving the password snapshots in the swept directory on exactly the devices being repaired'
    else
        ok 'the call is outside the DO_FRONTEND gate (reached by --backend-only runs too)'
    fi
fi

# The migration must not have been parked in install_backend()'s migration
# block alongside the two single-file precedents — that is after
# backup_originals has already pruned.
install_backend_body=$(awk '/^install_backend\(\)[[:space:]]*\{/{f=1} f{print} f&&/^\}/{exit}' "$INSTALLER")
if printf '%s\n' "$install_backend_body" | grep -qE "^[[:space:]]*${MIGRATE_FN}[[:space:]]*$"; then
    bad "$MIGRATE_FN is called from install_backend() — main() runs backup_originals BEFORE install_backend, so the prune has already happened by then"
else
    ok "$MIGRATE_FN is not called from install_backend() (which runs after backup_originals)"
fi

# ---------------------------------------------------------------------------
# [4] Uninstaller lockstep. Once the store is outside $CONF_DIR, the
#     `rm -rf "$CONF_DIR"` in the purge branch no longer reaches it — the
#     same orphan class as /etc/qmanager.env and /etc/qmanager-secrets,
#     which each get their own explicit line for exactly this reason.
# ---------------------------------------------------------------------------
printf '\n[4] F22 — uninstaller purges the relocated store explicitly\n'

if grep -qE "^[[:space:]]*rm -rf[[:space:]]+\"?${NEW_PATH}\"?[[:space:]]*$" "$UNINSTALLER"; then
    ok "uninstall_rm520n.sh purges $NEW_PATH on its own line"
else
    bad "uninstall_rm520n.sh has no explicit \`rm -rf $NEW_PATH\` — a purge uninstall would leave the operator's password-snapshot history on disk after they believe QManager is gone"
fi

# It belongs under --purge only: auth backups are user config, same
# "preserved unless --purge" contract as everything else in $CONF_DIR.
purge_branch=$(awk '/^if \[ "\$PURGE" = "1" \]/{f=1} f{print} f&&/^fi[[:space:]]*$/{exit}' "$UNINSTALLER")
if printf '%s\n' "$purge_branch" | grep -qE "rm -rf[[:space:]]+\"?${NEW_PATH}\"?"; then
    ok "the purge of $NEW_PATH is inside the --purge branch (preserved on a soft uninstall, matching both sibling precedents)"
else
    bad "the purge of $NEW_PATH is not inside the --purge branch — it must follow the same preserved-unless-purge contract as /etc/qmanager.env and /etc/qmanager-secrets"
fi

if grep -qE 'warn "Config preserved at' "$UNINSTALLER" && \
   grep -E 'warn "Config preserved at' "$UNINSTALLER" | grep -qF "$NEW_PATH"; then
    ok "the non-purge preserve warning names $NEW_PATH so an operator knows the password history is still on disk"
else
    bad "the non-purge preserve warning does not name $NEW_PATH — it lists the other two sibling paths and would silently omit this one"
fi

# ---------------------------------------------------------------------------
# [5] BEHAVIOURAL. Extract the migration function and run it for real.
#
#     Modes are NOT asserted here: Git Bash on Windows does not model POSIX
#     modes (chmod 0666 then stat %a returns 644), so any mode assertion
#     would pass trivially and be worse than none. What IS exercised is the
#     part that actually differs from both precedents — moving N files
#     rather than one, into a destination that already exists.
# ---------------------------------------------------------------------------
printf '\n[5] F22 — behavioural: %s() against real temp trees\n' "$MIGRATE_FN"

if [ -z "$fn_body" ]; then
    printf '  skip behavioural section — %s() is not defined yet\n' "$MIGRATE_FN"
else
    SCRATCH=$(mktemp -d)
    trap 'rm -rf "$SCRATCH"' EXIT

    # The function hardcodes absolute paths, so the harness rewrites them to
    # point inside the scratch tree. This is a text substitution on the
    # extracted body only — the installer itself is never modified.
    HARNESS_ROOT="$SCRATCH/root"
    stub="$SCRATCH/fn.sh"
    {
        printf '%s\n' '#!/usr/bin/env bash'
        printf '%s\n' 'set -e'
        # Stand-ins for the installer helpers the function may reach for.
        printf '%s\n' 'info() { printf "  [info] %s\n" "$*"; }'
        printf '%s\n' 'warn() { printf "  [warn] %s\n" "$*"; }'
        printf 'BACKUP_DIR="%s%s"\n' "$HARNESS_ROOT" "$NEW_PATH"
        printf '%s\n' "$fn_body" \
            | sed "s#\"$OLD_PATH#\"$HARNESS_ROOT$OLD_PATH#g; s#\"$NEW_PATH#\"$HARNESS_ROOT$NEW_PATH#g; s#'$OLD_PATH#'$HARNESS_ROOT$OLD_PATH#g" \
            | sed "s# $OLD_PATH# $HARNESS_ROOT$OLD_PATH#g; s# $NEW_PATH# $HARNESS_ROOT$NEW_PATH#g"
        printf '%s\n' "$MIGRATE_FN"
    } > "$stub"

    reset_tree() {
        rm -rf "$HARNESS_ROOT"
        mkdir -p "$HARNESS_ROOT/etc/qmanager"
    }

    run_fn() { bash "$stub" >"$SCRATCH/out.txt" 2>&1; printf '%s' "$?"; }

    # --- 5a: fresh device, no legacy store -> clean no-op, exit 0 ---------
    reset_tree
    rc=$(run_fn)
    if [ "$rc" = "0" ]; then
        ok '5a fresh device (no legacy store): returns 0'
    else
        bad "5a fresh device (no legacy store): returned $rc, must never abort the installer"
    fi

    # --- 5b: legacy store with 3 snapshots -> all move, old dir gone ------
    reset_tree
    mkdir -p "$HARNESS_ROOT$OLD_PATH"
    for ts in 20260101_010101 20260202_020202 20260303_030303; do
        printf 'snapshot-%s\n' "$ts" > "$HARNESS_ROOT$OLD_PATH/auth.json.$ts"
    done
    rc=$(run_fn)
    moved=$(ls -1 "$HARNESS_ROOT$NEW_PATH"/auth.json.* 2>/dev/null | wc -l | tr -d ' ')
    if [ "$rc" = "0" ] && [ "$moved" = "3" ]; then
        ok '5b legacy store with 3 snapshots: all 3 present at the new path'
    else
        bad "5b legacy store with 3 snapshots: returned $rc with $moved of 3 files at the new path"
    fi

    if [ "$(cat "$HARNESS_ROOT$NEW_PATH/auth.json.20260202_020202" 2>/dev/null)" = "snapshot-20260202_020202" ]; then
        ok '5b contents are preserved byte-for-byte'
    else
        bad '5b contents were not preserved byte-for-byte'
    fi

    if [ ! -d "$HARNESS_ROOT$OLD_PATH" ]; then
        ok '5b the legacy directory is removed (nothing left in the swept path)'
    else
        leftover=$(ls -1A "$HARNESS_ROOT$OLD_PATH" 2>/dev/null | wc -l | tr -d ' ')
        bad "5b the legacy directory still exists with $leftover entries — a www-data-owned copy of the password history would survive the fix"
    fi

    # --- 5c: idempotent re-run -------------------------------------------
    rc=$(run_fn)
    still=$(ls -1 "$HARNESS_ROOT$NEW_PATH"/auth.json.* 2>/dev/null | wc -l | tr -d ' ')
    if [ "$rc" = "0" ] && [ "$still" = "3" ]; then
        ok '5c re-run is idempotent: returns 0, still exactly 3 snapshots'
    else
        bad "5c re-run was not idempotent: returned $rc with $still snapshots"
    fi

    # --- 5d: destination already exists and is non-empty -> merge, no nest -
    #     This is the case a directory-level `mv` gets wrong on BusyBox.
    reset_tree
    mkdir -p "$HARNESS_ROOT$OLD_PATH" "$HARNESS_ROOT$NEW_PATH"
    printf 'legacy\n'  > "$HARNESS_ROOT$OLD_PATH/auth.json.20260101_010101"
    printf 'current\n' > "$HARNESS_ROOT$NEW_PATH/auth.json.20260505_050505"
    rc=$(run_fn)
    merged=$(ls -1 "$HARNESS_ROOT$NEW_PATH"/auth.json.* 2>/dev/null | wc -l | tr -d ' ')
    if [ "$rc" = "0" ] && [ "$merged" = "2" ]; then
        ok '5d non-empty destination: merged to 2 snapshots, neither lost'
    else
        bad "5d non-empty destination: returned $rc with $merged snapshots (expected 2)"
    fi

    if [ ! -e "$HARNESS_ROOT$NEW_PATH/backups" ]; then
        ok '5d nothing was nested into a backups/ subdirectory (the BusyBox `mv dir dir` trap)'
    else
        bad '5d a backups/ subdirectory appeared inside the destination — the store was moved with a directory-level mv, and the prune reader will never see those files again'
    fi

    # --- 5e: same-name collision -> existing file wins, nothing clobbered -
    reset_tree
    mkdir -p "$HARNESS_ROOT$OLD_PATH" "$HARNESS_ROOT$NEW_PATH"
    printf 'stale\n' > "$HARNESS_ROOT$OLD_PATH/auth.json.20260606_060606"
    printf 'fresh\n' > "$HARNESS_ROOT$NEW_PATH/auth.json.20260606_060606"
    rc=$(run_fn)
    if [ "$rc" = "0" ] && [ "$(cat "$HARNESS_ROOT$NEW_PATH/auth.json.20260606_060606")" = "fresh" ]; then
        ok '5e same-name collision: the existing (fresher) file is preserved, not overwritten by the stale one'
    else
        bad "5e same-name collision: returned $rc and the destination file is '$(cat "$HARNESS_ROOT$NEW_PATH/auth.json.20260606_060606" 2>/dev/null)' (expected 'fresh')"
    fi
fi

printf '\n[installer-backup-store-relocation] %d passed, %d failed\n' "$pass_count" "$fail_count"
[ "$fail_count" -eq 0 ] || exit 1
