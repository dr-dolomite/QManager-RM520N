---
name: project_shared_tmp_flag_sticky_bit_hazard
description: chmod 0666 on a /tmp flag file does not grant cross-UID delete rights under the sticky bit; a root-created flag can orphan and stick "true" forever if a non-root cleanup tries to remove it
type: project
---

`/tmp` is mode 1777 (sticky). Under POSIX, unlinking an entry in a sticky
directory requires being the file's owner, the directory's owner, or root —
independent of the file's own mode bits. `chmod 0666` after `touch` fixes
read/write access to content, but NOT delete/rename rights. It is a common
false-confidence fix that looks like it solves a cross-user shared-flag
problem and does not.

**Confirmed live case (2026-08-03, Phase 1 audit, apn-attach-cycle change):**
`/tmp/qmanager_recovery_active` is touched/removed by root
(`qmanager_watchcat`, `scripts/usr/bin/qmanager_watchcat:68,309,336,378,582,785`)
and read by root (`qmanager_ping`, `scripts/usr/bin/qmanager_ping:103,316`).
A proposed change had a new shared lib (`apn_apply.sh`) touch/remove the SAME
flag from BOTH a root worker and a www-data CGI path, with `chmod 0666`
"fixing" the cross-user aspect. It doesn't: whichever UID didn't create the
file can't unlink it; `rm -f` swallows the resulting EPERM silently, so an
interrupted request/process leaves an orphaned, wrong-owner flag stuck
`true` forever (no TTL, no self-heal seen in watchcat's loop).

**Why this flag specifically is high-severity:** `conn_during_recovery=true`
is read by `scripts/usr/lib/qmanager/alert_engine.sh:476` (bails before any
alert dispatch — email/SMS/Discord all go silent) and
`scripts/usr/lib/qmanager/events.sh:495` (suppresses "connection down" event
logging). A stuck flag silently mutes the entire alerting/event pipeline
with no operator-visible symptom other than "alerts stopped working."

**How to apply:** whenever a change proposes touching/removing a shared
`/tmp` flag file from more than one UID (root worker + www-data CGI is the
recurring pattern on this project — see [[project_two_writer_rename_vs_truncate_semantics]]),
check whether the create/remove pair can ever cross UIDs within one logical
operation. If yes: recommend (a) a dedicated flag scoped to the new
feature instead of reusing a cross-daemon signal flag, or (b) routing the
non-root caller's touch/rm through the existing root-worker/sudoers path so
the pair is always same-UID. Do not accept `chmod 0666` as the fix for a
sticky-`/tmp` cross-UID delete problem — it doesn't address it.
