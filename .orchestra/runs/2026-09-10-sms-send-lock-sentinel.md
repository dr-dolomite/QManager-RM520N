# Run: SMS send mislabels every real failure as "Could not acquire AT lock"
status: closed (committed 2c468f3; wedged AT lock on 61368cd2 cleared with user consent)
lane: lite
base: 14dcebe   branch: development   opened: 2026-09-10   lead: opus

## Request
User reports (relayed outside GitHub, referencing but NOT the same as issue #8) that on
v0.1.14 SMS *send* intermittently fails with QManager's own error "Could not acquire AT
lock", while SMS receive/alerts work fine, and sending works on the maintainer's device.
Fix the mislabeling. GitHub issue #8 is a stale, unrelated v0.1.13 `sms_tool` segfault
(rc=139, `open(/dev/ttyUSB0)`) already fixed by the `/dev/smd11` default patch — do not
conflate the two.

## Decisions taken — do not re-ask
- Lane = **Lite**: one file, one layer (CGI shell), mechanism measured on device, no
  installer / systemd / timer / new-backend-field flag fires.
- `modem-investigator` NOT dispatched: the mechanism was settled directly by a device
  probe (below), so there is no unknown flow left to map.
- `qm-advocate` NOT re-dispatched: an adversarial pass already ran in the originating
  session, and the fix is correct independent of any unproven hypothesis (it removes an
  ambiguity that exists whatever `sms_tool` returns). The hypothesis was then *measured*
  true anyway.
- **Scope = `sms.sh` only.** `sms_forwarding.sh:81` and `qmanager_sms_forward:113` use the
  identical `exit 2` lock-timeout idiom, but neither has an `-eq 2` consumer, so neither
  mislabels anything today. Pulling the daemon in would add a systemd service surface and
  a restart (disruptive, needs user consent) for zero user-visible gain. Logged as a
  latent-consistency follow-up instead.
- `normalize_phone()`'s extra `AT+CIMI` (sms.sh:321-347, fires only for numbers typed with
  a leading `0`) left alone — adds contention but does not produce the wrong error.
- Device policy: read-only probes + non-delivering `sms_tool` calls only. No reboot, no
  CFUN, no service restart, no config write. No SMS delivered to any real recipient.

## Plan
| id | task | class | seat (model/effort) | write set | state |
|---|---|---|---|---|---|
| T1 | Disambiguate the lock-timeout sentinel in `sms_locked()`; update both `-eq 2` call sites | build | cgi-endpoint-builder (sonnet/med) | `scripts/www/cgi-bin/quecmanager/cellular/sms.sh` | ACCEPTED |
| T2 | Blind verify: gates + device proof of all rc paths | verify | qm-verifier (opus/high) | none (read-only) | DISPATCHED |
| T3 | Docs row — correct the stale "return code `2`" sentence | docs | conductor inline (Lite) | `docs/reference/sms.md:69` | ACCEPTED |

## Attempts   (append-only)
| task | # | seat | ticket rev | outcome | checks run | evidence path |
|---|---|---|---|---|---|---|
| T1 | 1 | cgi-endpoint-builder | r1 | DONE | `sh -n` clean; no bare `-eq 2` remains; diff stat 5+/3- 1 file; device untouched | diff verified by conductor |
| T1 | — | conductor | device proof | PASS | 5 scenarios on 61368cd2 as `www-data` from `/tmp` | see Findings |
| T3 | 1 | conductor | r1 | DONE | doc line 69 corrected | — |
| T2 | 1 | qm-verifier | — | PASS_WITH_NOTES | 8 acceptance criteria (7 PASS, 1 PARTIAL — scope), stub + real-binary rc coverage, forced-timeout, md5 triple, `/proc/locks` | see Findings and Open items below |

## Findings that survive
- **MEASURED ON DEVICE (61368cd2), the root cause, not a suspicion:**
  `sms_tool send "notanumber" "qmtest"` → **rc=2**, stderr `sms not sent, code:  350`.
  A genuine send failure exits with *exactly* the value `sms.sh` uses as its
  lock-timeout sentinel. Every real send failure is therefore reported to the user as
  "Could not acquire AT lock".
- `sms.sh:86` — `flock_wait 9 10 || exit 2` is the lock-timeout sentinel.
- `sms.sh:102` — `exit "$_sms_rc"` propagates `sms_tool`'s own rc when the lock WAS taken.
  These two exit paths are indistinguishable at rc=2.
- Consumers: `sms.sh:363` (GET, ME read) and `sms.sh:520` (POST send). The string
  "Could not acquire AT lock" exists ONLY at `sms.sh:365` and `sms.sh:522` (repo-wide grep).
- Sentinel must avoid 0, 1, 2 (real `sms_tool` codes), 126/127 (exec failures) and
  128-165 (signals — issue #8's segfault was rc=139 and must keep reporting as
  `send_failed`). **99** is clear of all of them.
- Separate latent defect, NOT in scope, NOT reachable: `sms_tool send "" "qmtest"` → **rc=0**
  while stderr says `sms not sent, code:  350` — a false success on an empty number.
  `sms.sh` rejects empty phone upstream (`missing_phone`), so no user can reach it.
- Secondary contention factor (confirmed, no code change): `qmanager_sms_forward` reads the
  full inbox under `/tmp/qmanager_at.lock` every 15s (4 lock acquisitions/cycle) when
  forwarding is enabled. On 61368cd2 it is **inactive** and `/etc/qmanager/sms_forwarding.json`
  is absent — consistent with sends working there. Once T1 lands, a forced timeout will
  correctly say "Could not acquire AT lock", which is honest; no mitigation needed.

## Device proof (conductor, on 61368cd2, as `www-data`, run from `/tmp` — installed tree NOT modified)
Before = `git show 14dcebe:<path>` (md5 `2d370fe…`), after = working copy (md5 `637f666…`).
Both LF-normalized, `sh -n` clean under the device's own shell.

| # | scenario | script | result |
|---|---|---|---|
| A | real send failure (`phone:"notanumber"`) | BEFORE | `modem_busy` / "Could not acquire AT lock" — **the reported bug, reproduced** |
| B | real send failure (same input) | AFTER | `send_failed` / `sms not sent, code:  350\r\n\nNo response from modem.` — **fixed** |
| C | forced lock timeout (lock held 22s), send | AFTER | `modem_busy` / "Could not acquire AT lock" — sentinel preserved |
| D | GET inbox, no contention | AFTER | `success:true`, output equivalent to BEFORE — success path of line 365 intact |
| E | GET inbox, lock held 22s | AFTER | `modem_busy` — timeout path of line 365 intact |

**Not device-proven:** the rc=0 *send* success path, because proving it would deliver a real
SMS. Logically unreachable as a regression — rc 0 fails both `-eq 2` and `-eq 99` identically
and falls to the same `-eq 0` success branch — and the rc=0 GET path IS proven identical
before/after (D). Offered to the user as an optional live self-send; not blocking.

## Device state
- RM520N-GL `61368cd2` reachable (`RM520NGLAAR03A03M4G_A0.304`, SDX6X). RG501Q not probed —
  no portability surface (no new applet, no new syntax, no arithmetic).
- `qmanager-sms-forward.service` inactive; `/etc/qmanager/sms_forwarding.json` absent.
- Conductor created and then deleted `/tmp/qmtest_old.sh`, `/tmp/qmtest_new.sh`,
  `/tmp/sms.sh.orig`. Nothing of this run's left behind. Services still active.
- ⚠️ **The device is contended by an actor outside this run.** `/usrdata/.../sms.sh` changed
  three times during the run: `2d370fe…` (== HEAD) → `4c12f09…` (a 610-line OLDER build,
  after an unexplained reboot ~16:17) → `637f666…` (this run's patched file) at 16:22:44,
  written by someone else — the conductor never deployed to `/usrdata`. See Parallel actor.

## Parallel actor — read before trusting any device or tree state
A second session (or the user) is working in **this same worktree** and on **this same
device**, concurrently:
- `package.json` went `v0.1.14` → `v0.1.14-draft` in the working tree between this run's
  first and third tool calls. Not this run's change; deliberately left unstaged and uncommitted.
- The device reboot at ~16:17 and the 610-line build that briefly replaced the installed
  `sms.sh` were not this run's doing.
- This run's patched file reached `/usrdata` at 16:22:44 without this run deploying it.
Consequence: `git worktree list` shows ONE worktree, so the index is shared — commit by
explicit path only, never `git add -A`, or a parallel commit will steal unrelated files.

## T2 verifier findings (PASS_WITH_NOTES) — two material items outside the code itself
1. **The uncommitted patch was already deployed to `61368cd2` before verification started.**
   `/tmp/qmanager_install.log`: a full install finished "Version v0.1.14-draft finalized" at
   16:22:53, from a tarball built 16:21 — by the parallel actor's software-update work, not
   by this run. md5 triple: HEAD `2d370fe…` / working `637f666…` / **deployed `637f666…`**
   (matches the working copy, not HEAD). This run's own ticket and an earlier ledger note
   both said the device was untouched — both were wrong; the parallel actor's tarball build
   evidently bundles the working tree, uncommitted changes included. The patched CGI has
   therefore been live in production ahead of any commit. Not a defect in the fix itself.
2. **Separate, pre-existing, currently-live defect — SMS is fully down on `61368cd2` right
   now, unrelated to this fix.** `/proc/locks` held on 600/600 samples over 13+ minutes;
   every `www-data` lock acquisition times out at the full 10s budget. Holder: a wedged
   `atcli_smd11` (pid 579, mid `AT+QCAINFO`) sitting on fd 9 of `/tmp/qmanager_at.lock`.
   Consequence: every send and every inbox GET returns `modem_busy` on this device regardless
   of the sentinel fix — the exact string the original report complained about, now genuinely
   true. Pre-dated the verifier's probing. **Clearing it (killing pid 579) is a live-device
   write and needs the user's go-ahead per the skill's hard rails — not done.**

All 7 other acceptance criteria PASS outright (sentinel value, both consumers, real-failure
routing, lock-timeout routing on both consumers, rc=0 paths unchanged, stderr-capture design
intact, comment discipline). The one PARTIAL is "exactly one file changed" — true for this
run's own diff; false for the tree as a whole because of the parallel actor's unrelated
concurrent edits (accounted for above, not this run's doing).

## Handoff — NEXT ACTION
Code fix is verified correct. Two decisions are the user's, not this run's, to make:
1. Whether to clear the wedged `atcli_smd11` (pid 579) on `61368cd2` so SMS works again —
   disruptive, asked, not yet actioned.
2. Whether to commit now. Per the standing git policy, commits require explicit user request
   even though this run's own plan called for committing at this point — **do not commit
   without that request.** When authorized, commit **by explicit path only**:
   `scripts/www/cgi-bin/quecmanager/cellular/sms.sh`, `docs/reference/sms.md`,
   `RELEASE_NOTES.md` (now a full v0.1.15 rewrite, see below), and this ledger.
   **Do NOT stage `package.json`** or the `components/system-settings/software-update/**`
   files — both belong to the parallel actor.
DO NOT redo: the device probe of `sms_tool` exit codes, the 5-scenario device proof, the
lane classification, the scope call on the two sibling files, or the T2 verification above.
Open follow-ups (not blocking, not in scope): (1) the same `exit 2` idiom in
`sms_forwarding.sh:81` and `qmanager_sms_forward:113` — latent, no `-eq 2` consumer today;
(2) `sms_tool send "" "x"` returns rc 0 while stderr says it failed — unreachable through
the CGI, which rejects an empty phone upstream; (3) the `send_failed` detail now carries raw
`\r\n` from `sms_tool` stderr — cosmetic, renders as a stray newline in the inbox card;
(4) `delete`/`delete_all` still test only `-ne 0`, so a lock timeout there surfaces as
`partial_failure`/`delete_all_failed` with empty detail rather than `modem_busy` — same
latent shape as the two sibling scripts, pre-existing, not introduced by this run;
(5) `RELEASE_NOTES.md` was rewritten to a fresh v0.1.15 entry (not this run's doing beyond
the SMS bullet) and now also carries a parallel-actor Software Update bullet — review before
commit that it still reads as one coherent release note.
