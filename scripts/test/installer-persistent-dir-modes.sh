#!/usr/bin/env bash
# Regression harness for the persistent-dir-mode defect: a directory create
# targeting a path that survives reboot (/etc, /usrdata, /usr, or the
# systemd unit dirs under /lib that this tree treats as part of the same
# rw-remounted, never-restored-to-ro rootfs contract) must use
# `install -d ... -m <mode>` — which re-applies its mode on EVERY run — and
# never a bare `mkdir -p`, which honours the ambient umask and silently
# no-ops on an already-existing directory. A bad mode created once (e.g. an
# install run under a permissive umask) then persists across every future
# OTA forever, because nothing ever revisits it.
#
# WHY THIS EXISTS
# ----------------
# install_rm520n.sh:1634 creates $SUDOERS_DIR with a bare `mkdir -p`, then
# never chmods the directory itself — only the FILE it drops inside it
# ($SUDOERS_DIR/qmanager gets `chmod 440` at :1691-1692). The directory's
# own mode is whatever `mkdir -p` produced from the umask in effect that
# run. This file already gets it right twice, at :1474 and :1483:
#   install -d -o root -g root -m 0755 "$QMANAGER_ROOT"
#   install -d -o root -g root -m 0755 "$QMANAGER_ROOT/bin"
# SUDOERS_DIR is the outlier.
#
# SCOPE
# -----
# This harness scans scripts/install_rm520n.sh exhaustively (every literal
# /etc, /usrdata, /usr target, and every one of the known-persistent
# variables: SUDOERS_DIR, CONF_DIR, QMANAGER_ROOT, BIN_DIR, SYSTEMD_DIR,
# WANTS_DIR, TIMERS_WANTS_DIR, WWW_ROOT, TAILSCALE_DIR, BACKUP_DIR — all
# confirmed by grepping their assignments) and asserts the ONE known,
# assigned defect: SUDOERS_DIR. It does NOT turn every other bare mkdir -p
# this census also turned up into a hard pass/fail gate — several other
# sites in this file and in scripts/usr/bin/qmanager_* share the identical
# shape (no install -d, no directory-level chmod/chown following) and were
# NOT part of the defect this harness was commissioned to pin. Section [6]
# below lists them for visibility without failing the run; see the commit
# message / session report for the full list. Baking untriaged sites into
# a hard assertion risks a harness that is wrong in the OTHER direction —
# asserting a "fix" for something that may have a self-heal this census
# missed.
#
# Anchors are matched by TEXT, never by line number.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INSTALLER="$REPO_ROOT/scripts/install_rm520n.sh"

pass_count=0
fail_count=0

ok()  { pass_count=$((pass_count + 1)); printf '  ok   %s\n' "$1"; }
bad() { fail_count=$((fail_count + 1)); printf '  FAIL %s\n' "$1"; }

# ---------------------------------------------------------------------------
# [1] Control: the two known-good sites still use install -d with an
#     explicit numeric -m. This is what proves the harness can tell good
#     from bad, not just detect the presence of the string "mkdir".
# ---------------------------------------------------------------------------
printf '\n[1] Known-good sites: install -d with an explicit -m mode\n'

if grep -qF 'install -d -o root -g root -m 0755 "$QMANAGER_ROOT"' "$INSTALLER"; then
    ok 'QMANAGER_ROOT is created with install -d -o root -g root -m 0755'
else
    bad 'QMANAGER_ROOT is NOT created with the expected install -d -m 0755 call'
fi

if grep -qF 'install -d -o root -g root -m 0755 "$QMANAGER_ROOT/bin"' "$INSTALLER"; then
    ok 'QMANAGER_ROOT/bin is created with install -d -o root -g root -m 0755'
else
    bad 'QMANAGER_ROOT/bin is NOT created with the expected install -d -m 0755 call'
fi

# ---------------------------------------------------------------------------
# [2] Allowlist — bare `mkdir -p` sites that are NOT the persistent-mode
#     defect class, each with an inline justification. These are asserted
#     (not just skipped) so the harness still fails loudly if the premise
#     of an exemption goes stale (e.g. the SESSION_DIR self-heal chmod is
#     later removed without anyone revisiting this harness).
# ---------------------------------------------------------------------------
printf '\n[2] Allowlist — verified exemptions, not silently skipped\n'

# /tmp/** and /var/lock: ephemeral, wiped every boot/reboot — not the
# persistent-mode class this harness targets. Spot-checked representative
# call sites rather than enumerated exhaustively (there are many, e.g.
# qmanager_setup's `mkdir -p /var/lock /etc/qmanager /tmp/quecmanager` and
# qmanager_dpi_install:197 `mkdir -p "$extract_dir"`); the /etc/qmanager
# portion of that qmanager_setup line is covered by the design-decision
# exemption below, not this one.
if grep -qF 'mkdir -p /var/lock' "$INSTALLER"; then
    ok 'representative /var/lock mkdir -p site still present (ephemeral, exempt)'
else
    bad 'expected /var/lock mkdir -p site not found — allowlist premise may be stale'
fi

# install_rm520n.sh:1857 mkdir -p "$SESSION_DIR" — self-healing. Detected
# by TEXT proximity (chown then chmod of the EXACT "$SESSION_DIR" token,
# not a longer path built from it) rather than a hardcoded line number.
# The exact-token requirement matters: naively checking "does a later line
# merely CONTAIN the string $SESSION_DIR" would also match something like
# "$SESSION_DIR/sub", which is a DIFFERENT path and proves nothing about
# the directory itself — this is exactly the trap that would make section
# [3] below give a false pass on $SUDOERS_DIR (whose only nearby chmod/
# chown targets "$SUDOERS_DIR/qmanager", the FILE inside it, never the
# directory).
session_block=$(awk '/mkdir -p "\$SESSION_DIR"/{print; c=3; next} c>0{print; c--}' "$INSTALLER")
if printf '%s\n' "$session_block" | grep -qF 'chown www-data:www-data "$SESSION_DIR"' \
   && printf '%s\n' "$session_block" | grep -qF 'chmod 700 "$SESSION_DIR"'; then
    ok 'SESSION_DIR mkdir -p is immediately self-healed by chown+chmod on the exact same path'
else
    bad 'SESSION_DIR self-heal (chown+chmod of the exact "$SESSION_DIR" token) not found within 3 lines — allowlist premise is stale'
fi

# install_rm520n.sh:1959 mkdir -p /etc/qmanager (install_ping_profile) —
# documented design decision: /etc/qmanager is www-data-owned and nothing
# root-pinned survives there (qmanager_setup re-chowns it every boot), so
# a directory-level chmod would be decorative. See
# docs/reference/etc-qmanager... (see also reference_etc_qmanager_cannot_hold_root_pinned_files
# in agent memory). The identical mkdir -p /etc/qmanager in
# scripts/usr/bin/qmanager_setup:18 and qmanager_crash_log_append:43 share
# this exact rationale and are not treated as separate findings.
if grep -qF 'mkdir -p /etc/qmanager' "$INSTALLER"; then
    ok 'install_ping_profile mkdir -p /etc/qmanager site still present (documented design decision, exempt)'
else
    bad 'expected mkdir -p /etc/qmanager site not found — allowlist premise may be stale'
fi

# qmanager_dpi_install:197 mkdir -p "$extract_dir" — extract_dir is
# literally "/tmp/zapret_extract.$$", ephemeral per-invocation scratch
# space for one tarball extraction, cleaned up on every exit path.
DPI_INSTALL="$REPO_ROOT/scripts/usr/bin/qmanager_dpi_install"
if grep -qF 'extract_dir="/tmp/zapret_extract.$$"' "$DPI_INSTALL"; then
    ok 'qmanager_dpi_install extract_dir resolves under /tmp (ephemeral, exempt)'
else
    bad 'qmanager_dpi_install extract_dir no longer resolves under /tmp — allowlist premise is stale'
fi

# ---------------------------------------------------------------------------
# [3] The assigned defect: SUDOERS_DIR is created with a bare mkdir -p and
#     never gets an install -d -m call anywhere in the file.
# ---------------------------------------------------------------------------
printf '\n[3] SUDOERS_DIR must use install -d with an explicit -m mode\n'

if grep -qF 'mkdir -p "$SUDOERS_DIR"' "$INSTALLER"; then
    bad 'SUDOERS_DIR is created with a bare "mkdir -p" — honours the ambient umask and no-ops on an existing dir, so a bad mode persists across every OTA; the nearby chmod 440 at :1691-1692 targets "$SUDOERS_DIR/qmanager" (the FILE inside it), never the directory itself'
else
    ok 'SUDOERS_DIR is not created via a bare mkdir -p'
fi

if grep -qE 'install[[:space:]]+-d[[:space:]].*-m[[:space:]]+[0-7]+.*"\$SUDOERS_DIR"([^/]|$)' "$INSTALLER"; then
    ok 'SUDOERS_DIR has an install -d -m call somewhere in the file'
else
    bad 'SUDOERS_DIR has no install -d -m call anywhere in the file — the directory mode is never pinned'
fi

# ---------------------------------------------------------------------------
# [4] F15 — the three persistent dirs whose bare `mkdir -p` produced a
#     WORLD-WRITABLE mode on BOTH shipped devices. Measured read-only over
#     SSH 2026-08-31, identity proved by serial: /etc/profile.d,
#     /etc/qmanager/backups and /usrdata/qmanager/locales-packs were all
#     777 on the RM520N-GL (61368cd2) AND the RG501Q-EU (b7e3d6f1).
#
#     ⚠ $BACKUP_DIR HAS SINCE MOVED. F22 relocated it from
#     /etc/qmanager/backups to /etc/qmanager-backups — the measurement above
#     is a historical record of the OLD path and is left as written rather
#     than rewritten, because it is what motivated both fixes. The
#     assertions below match on the "$BACKUP_DIR" VARIABLE rather than any
#     literal path, so they follow the relocation unchanged and still pin
#     exactly what F15 pinned. The relocation itself is covered by
#     installer-backup-store-relocation.sh, which also asserts that this
#     harness's `install -d -o root -g root -m 0700` requirement survives.
#
#     Mechanism: install_rm520n.sh:624 records that the install shell runs
#     at umask 0000, so a bare `mkdir -p` yields 0777 — and because
#     `mkdir -p` no-ops on an existing directory, that mode then survives
#     every future OTA. The live PROCESS umask is a healthy 0022 on both
#     devices, which is why inspecting the running system never revealed
#     it. Identical defect class to SUDOERS_DIR in [3]; T3.5 fixed only
#     that one site and left these enumerated-but-unasserted in [6].
#
#     /etc/profile.d is the severe one: /etc/profile:15 sources
#     /etc/profile.d/*.sh, the directory carries no sticky bit, and
#     www-data is the CGI user — so a web-reachable uid can drop OR
#     REPLACE a snippet there and have it execute as root at the next root
#     login. The existing qmanager-path.sh being 0644 is irrelevant:
#     unlink permission comes from the directory, not the file.
#
#     The three modes are deliberately NOT uniform. Each is load-bearing:
#
#       /etc/profile.d                   0755  ordinary system directory
#       $BACKUP_DIR                      0700  auth.json snapshots; the
#                                              installer is its only reader
#                                              and only writer. Since F22
#                                              this is /etc/qmanager-backups,
#                                              outside the tree qmanager_setup
#                                              chowns to www-data every boot —
#                                              so the -o root -g root half of
#                                              the pin is now durable too,
#                                              which it was not when F15
#                                              landed
#       /usrdata/qmanager/locales-packs  0755  root-writable ONLY, but it
#                                              MUST stay world-READABLE —
#                                              language-packs/list.sh is a
#                                              www-data CGI that reads
#                                              <code>/_pack.json straight
#                                              out of this store. 0700 here
#                                              would break the language-pack
#                                              list endpoint, so do not
#                                              "harden" this one further.
# ---------------------------------------------------------------------------
printf '\n[4] F15 — persistent dirs measured 0777 on both live devices\n'

if grep -qE '^[[:space:]]*mkdir -p /etc/profile\.d' "$INSTALLER"; then
    bad '/etc/profile.d is created with a bare "mkdir -p" — measured 777 root:root on BOTH devices; /etc/profile sources *.sh from it, so a www-data write there runs as root'
else
    ok '/etc/profile.d is not created via a bare mkdir -p'
fi

if grep -qE 'install[[:space:]]+-d[[:space:]].*-m[[:space:]]+0755[[:space:]]+/etc/profile\.d([^/[:alnum:]]|$)' "$INSTALLER"; then
    ok '/etc/profile.d is pinned with install -d -m 0755'
else
    bad '/etc/profile.d has no install -d -m 0755 call — the directory mode is never pinned'
fi

if grep -qF 'mkdir -p "$BACKUP_DIR"' "$INSTALLER"; then
    bad 'BACKUP_DIR is created with a bare "mkdir -p" — measured 777 www-data:www-data on BOTH devices; it holds auth.json snapshots whose own 0600 is defeated by a world-writable, non-sticky parent'
else
    ok 'BACKUP_DIR is not created via a bare mkdir -p'
fi

if grep -qE 'install[[:space:]]+-d[[:space:]].*-m[[:space:]]+0700[[:space:]]+"\$BACKUP_DIR"([^/]|$)' "$INSTALLER"; then
    ok 'BACKUP_DIR is pinned with install -d -m 0700'
else
    bad 'BACKUP_DIR has no install -d -m 0700 call — the directory mode is never pinned'
fi

if grep -qE '^[[:space:]]*mkdir -p /usrdata/qmanager/locales-packs' "$INSTALLER"; then
    bad 'the persistent locales-packs store is created with a bare "mkdir -p" — measured 777 root:root on BOTH devices, defeating the root-only-writer boundary its own adjacent comment claims'
else
    ok 'the persistent locales-packs store is not created via a bare mkdir -p'
fi

if grep -qE 'install[[:space:]]+-d[[:space:]].*-m[[:space:]]+0755[[:space:]]+/usrdata/qmanager/locales-packs([^/[:alnum:]-]|$)' "$INSTALLER"; then
    ok 'the persistent locales-packs store is pinned with install -d -m 0755 (world-readable on purpose: list.sh reads it as www-data)'
else
    bad 'the persistent locales-packs store has no install -d -m 0755 call — the directory mode is never pinned'
fi

# ---------------------------------------------------------------------------
# [5] syntax sanity
# ---------------------------------------------------------------------------
printf '\n[5] syntax sanity\n'

if "${BASH:-bash}" -n "$INSTALLER" 2>/dev/null; then
    ok "bash -n clean: $(basename "$INSTALLER")"
else
    bad "bash -n FAILED: $(basename "$INSTALLER")"
fi

# ---------------------------------------------------------------------------
# [6] Informational census — additional bare `mkdir -p` sites on a
#     persistent path found while building this harness. NOT asserted
#     (printed only; does not affect pass/fail) — each is a real candidate
#     for the same defect class but was not part of what this harness was
#     commissioned to pin. See the commit message / session report.
# ---------------------------------------------------------------------------
printf '\n[6] Informational — remaining bare mkdir -p sites on a persistent path (not asserted)\n'
printf '  Each was assessed on BOTH live devices 2026-08-31 (read-only, identity proved by\n'
printf '  serial) and the CURRENT on-device mode is recorded. The three that measured 0777\n'
printf '  were promoted out of this list into section [4]; these eight did not.\n'
printf '  info install_rm520n.sh:1447  mkdir -p "$WWW_ROOT/locales-packs" — HARMLESS: live 755 both devices, web-served content, no secret and no elevated trust\n'
printf '  info install_rm520n.sh:1526  mkdir -p "$TAILSCALE_DIR/systemd" — HARMLESS: staged (non-executing) unit copy; Tailscale absent from both test devices so mode unmeasured, but nothing is consumed from here until a later step re-copies it\n'
printf '  info install_rm520n.sh:2970  mkdir -p /etc/udev/rules.d — HARMLESS: live 755 root:root both devices\n'
printf '  info install_rm520n.sh:3031  mkdir -p "$WANTS_DIR" (multi-user.target.wants) — HARMLESS: live 755 both; pre-existing systemd dir, so the mkdir is a guaranteed no-op\n'
printf '  info install_rm520n.sh:3136  mkdir -p "$TIMERS_WANTS_DIR" (timers.target.wants) — HARMLESS: live 755 both, same reasoning\n'
printf '  info install_rm520n.sh:315   install_tree() mkdir -p "$dst" — NEEDS A DECISION: live 755 only because cp -r inherits the SOURCE tree mode; nothing in the code pins it, and unlike the others this call re-creates the dir fresh on every OTA rather than no-opping, so the umask genuinely bites every run\n'
printf '  info qmanager_poller:714,788  mkdir -p /usrdata/qmanager (write_data_used_state / update_data_used) — HARMLESS in practice: target already exists at 755 from the installer'"'"'s install -d, so this is a no-op at every normal boot; only reachable on a corrupted-install recovery path\n'
printf '  info qmanager_tailscale_mgr:145,272  mkdir -p /usrdata/root/bin — NEEDS A DECISION: live 755 both, but plausibly only because something else pre-creates the path; nothing in this script guarantees it\n'

printf '\n[installer-persistent-dir-modes] %d passed, %d failed\n' "$pass_count" "$fail_count"
[ "$fail_count" -eq 0 ] || exit 1
