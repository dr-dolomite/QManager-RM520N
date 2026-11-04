# Run: Traffic Engine hotpatch — F1 / F2 / F8 (engine-down LAN blackhole)
status: closed (committed 3cb6b93 c37bd60 089fb74 c4b5230 bc7b691; device restored)
lane: full
base: 26f1d19   branch: development   opened: 2026-09-10   lead: opus
(base moved 14dcebe -> 26f1d19 mid-run: `development` advanced while recon ran. Diff against
26f1d19, never against the branch name.)

## Request
Hotpatch three Traffic Engine defects, all CONFIRMED on hardware 2026-09-10 against
RM520N-GL `61368cd2` (tpws v72.13 `87e0586`, md5 `264b9478abb6ff3d86952861d552db10`):
- **F1** REDIRECT rule asserted from config intent alone, never from proof tpws is
  listening; no code path removes it on engine death → LAN blackhole with no recovery.
- **F2** A mode switch never re-execs tpws (`svc_start` no-ops on an active unit;
  `svc_restart` is called on this unit nowhere in the tree) → stale argv.
- **F8** The REDIRECT carries no destination exclusion, so it captures LAN traffic to the
  modem's own address → the QManager UI is blackholed too; recovery needs SSH or reboot.
Mechanism is measured, NOT hypothesised — do not re-run the investigation.
User addendum (mid-turn, twice): RELEASE_NOTES entry is a **v0.1.15-draft** fold, and the
uncommitted `components/system-settings/software-update/**` UI changes in the working tree
go into the same v0.1.15-draft entry.

## Decisions taken — do not re-ask
- Lane = **Full**: cross-layer (lib + root runner + systemd unit + CGI + docs), and the
  systemd-unit change fires the `installer-safety-auditor` flag.
- **F3 is RETRACTED.** The split recipe was tested and did not reproduce a general-
  destination break. Do NOT "fix" the recipe.
- `modem-investigator` NOT dispatched: the handoff carries the measured mechanism for all
  three defects; the conductor's own probes settled the remaining design questions.
- No installer edit needed: `install_rm520n.sh` deploys `$SYSTEMD_DIR` units generically
  and no new file is added. Sudoers needs no change — `/bin/systemctl restart qmanager-*`
  is already granted (`scripts/etc/sudoers.d/qmanager:13`); `reset-failed` is NOT granted
  and deliberately stays root-side only.

## Conductor probes (read-only, RM520N-GL `61368cd2`, RM520NGLAAR03A03M4G_A0.304 SDX6X)
| Question | Answer | Consequence |
|---|---|---|
| `xt_addrtype` present? | **YES** — `-m addrtype ! --dst-type LOCAL` inserts clean (rc 0) | F8 fixed with ONE rule, no dynamic IP; covers bridge0's addr and every other local addr |
| listener probe applet | `ss` **MISSING**; `netstat` only at **`/opt/bin/netstat`**; `nc`, `fuser` in base image | netstat is UNUSABLE for liveness — `/opt` mounts ~30s into boot. Use `/proc/net/tcp` |
| `/proc/net/tcp` form | `$2` = `ADDR:PORT` hex, `$4` = `st`, `0A` = LISTEN. 989 = `03DD` | pure procfs probe, no applet, no boot-window dependency, works on both devices |
| `systemctl reset-failed` as root | rc 0 | start-limit lockout is clearable — from the ROOT ensure pass, not the CGI |
| QMANAGER_FW covers 989? | **NO** — only tcp/80 and tcp/443 matched | F5 confirmed: tpws on 0.0.0.0:989 is carrier-reachable while the engine is on |
| tpws installed? | YES, v72.13 `87e058624c72863db53bdaf7fb6f16576dddb6ab`, 107276 bytes | device proof is possible |
| baseline engine state | rule **absent**, tpws **not running**, unit `inactive` / `success` / `NRestarts=0`, timer `active` | clean starting state for the proof |
| config keys | `video_optimizer`: null, `quic`: null, `full_bypass`: {enabled: 0, sni_domain: "speedtest.net"} | absent keys resolve to 0 via `qm_config_get`; enabling VO will create the key |
| RG501Q-EU | **UNREACHABLE** (no ping to 192.168.120.1) | portability residue goes to `busybox-portability-checker`; design deliberately adds NO new applet |

## Three-way md5 (rail 11) — baseline, all in sync
| file | deployed | `git show HEAD` | working copy |
|---|---|---|---|
| `dpi_state.sh` | `8ff1e792…` | `8ff1e792…` | same |
| `qmanager_dpi_run` | `88578ab9…` | `88578ab9…` | same |
| `qmanager_dpi_install` | `0cf11be5…` | `0cf11be5…` | same |
| `qmanager-dpi.service` | `bfc9a038…` | `bfc9a038…` | same |
| `video_optimizer.sh` (CGI) | `83cd2cb2…` | `83cd2cb2…` | same |

## User decisions at the gate — quoted, do not re-ask
- **F5 IN SCOPE, "Bind tpws to the LAN address (Recommended)"** — derive bridge0's address at
  argv-build time instead of `0.0.0.0`. No firewall edit, no installer surface. The new failure
  mode (bridge0 has no address yet at engine start -> tpws cannot bind) is now SAFE rather than
  a blackhole, because the liveness gate keeps the rule off. `qm-advocate` is attacking exactly
  this; if it comes back with a confirmed defect, re-put the choice to the user.
- **F4 IN SCOPE, "Reword the card only (Recommended)"** — copy + i18n so the Test-bypass card
  stops implying it validates the live engine. NO new backend field, so the frontend flag's
  qualification holds and this stays a `ui-builder` ticket.
- **Disruptive device proof AUTHORISED — "Yes, run the disruptive proof"**, with the outage
  disclosed up front: `kill -9` loop to trip the start limit plus a bridge0-client curl, cutting
  web access for the live client at `192.168.225.86` for ~60-90s (SSH, DNS, QUIC unaffected).
  Restore is mandatory: both modes off, rule drained, tpws stopped, `reset-failed`, config back
  from backup, confirmed rule=0 / tpws=0 / unit `inactive`/`success`.
- **SMS run — "Already done and committed."** Verified against the tree, not taken on trust:
  closed at `26f1d19`, fix at `2c468f3`, its ledger `status: closed`.
- **F6 DEFERRED** by the conductor (feature gap, new engine surface, not a hotpatch).

## Tree state — verified after the gate, supersedes the stale start-of-session snapshot
`development` advanced during recon: `557ce8f` (software-update UI), `2c468f3` (SMS fix),
`26f1d19` (SMS ledger close-out). The worktree is now CLEAN except `package.json` (already at
`v0.1.15-draft`, not this run's edit) and this ledger. The earlier "parallel actor" warning is
RESOLVED — nothing of another run is uncommitted any more. `git worktree list` still shows ONE
worktree, so the index is SHARED: commit by explicit path only, never `git add -A`.

## RELEASE_NOTES — the entry ALREADY EXISTS, do not create one
`RELEASE_NOTES.md` is already a `v0.1.15` entry (`# 🚀 QManager RM520N BETA v0.1.15`,
`### Upgrading from v0.1.14`) and already carries the user's two mid-turn asks: the
software-update UI change under Improvements, and the SMS fix plus the Cell Scanner fix under
Fixes. This run's docs job is therefore ADDITIVE only:
- add the DPI fixes to the existing `## 🐛 Fixes` section, and
- rewrite the one-line summary paragraph so it hooks on the headline change — the LAN-blackhole
  fix outranks the SMS and Software Update items and becomes the lead.
Keep every fixed template element verbatim (OTA blockquote, Installation blocks, Thank You,
the MIT + Commons Clause line). The `v0.1.14` upgrade anchor and the `v0.1.5` OTA anchor both
stay as they are.

## Candidate design (pre-gate — being attacked by qm-advocate)
1. **`dpi_listener_present`** (new, `dpi_state.sh`) — `/proc/net/tcp`, `$4=="0A"` and the port
   half of `$2` equal to `printf '%04X' $DPI_PORT`. Never restates the port (rail: DPI_RULE_SIG).
2. **`ExecStopPost=/usr/bin/qmanager_dpi_run --rule-down`** (unit) plus a new `--rule-down` verb
   calling `dpi_remove_rule`. Fires on crash, on stop, and on the attempt that trips the start
   limit — so the rule is drained the instant the engine dies, not up to 60s later.
3. **`ExecStartPost`** waits (bounded, whole-second `sleep`) for the listener then applies the
   rule; `dpi_apply_rule` leaves the `run` verb. Closes the cold-boot window where the rule is
   live before tpws has bound.
4. **`--ensure`** gates the assert on `dpi_listener_present`, not config alone. Enabled + no
   listener → `dpi_remove_rule` FIRST, then attempt recovery (root-side `reset-failed` + start).
   Never re-asserts over a dead listener. `dpi_reconcile_force_tcp` stays OUTSIDE the gate.
5. **F8** — fold `-m addrtype ! --dst-type LOCAL` into the rule spec (apply + remove + drain
   loop). Needs a **legacy drain** for the old no-addrtype spec on OTA'd devices, same shape as
   the F16 note in `dpi.md`, or an old rule reads as present and never gets upgraded.
6. **F2** — `svc_start` → `svc_restart` at `video_optimizer.sh:264` and `:310`. Already in sudoers.
7. **F7** — drop the stale `--oob=tls` from `dpi.md`'s recipe.
8. **Deferred:** F6 (no `ip6tables` counterpart) — a feature gap, new engine surface, not a
   hotpatch. F5 and F4 are scope QUESTIONS for the user at the gate.

## A2 — installer-safety-auditor verdict: BLOCKED, 2 must-fix
(Its header line said "CLEAR to proceed" and then "BLOCKED — 2 must-fix items"; the body is
unambiguous. Treated as BLOCKED. Both items are design amendments, not stop-work.)

**PASSED clean, do not re-audit:** unit deployment is generic (`install_rm520n.sh:1697`, `1650`)
so no installer edit is needed; OTA ordering is safe — `stop_services()` runs before the new unit
is written and before `daemon-reload` (`4531` -> `1697-1724` -> `4551`/`4554`), and
`qmanager-dpi` starts only after both (`3846`), so `ExecStartPost`/`ExecStopPost` never fire
against a mismatched unit definition mid-OTA; uninstall lockstep holds — both `qmanager-dpi`
stops (`uninstall_rm520n.sh:~215` glob stop, `279-280` `--clear`) precede Step 3's removal of
the runner and the lib, so `ExecStopPost` still has both files when it fires; sudoers needs no
new line; `StartLimit*` correctly stays in `[Unit]`.

**MUST-FIX 1 — the legacy drain must be exact-spec, unconditional, and ahead of every insert.**
`dpi_rule_present()` (`dpi_state.sh:134-137`) matches the substring `--to-ports $DPI_PORT`, which
the OLD rule and the new addrtype rule BOTH end with. So `dpi_apply_rule`'s idempotence check
(`:169-171`) returns true against a pre-migration rule and never inserts the addrtype-qualified
one — the F8 exclusion silently never takes effect on any already-deployed device, with no error
and no log line. The drain must match the EXACT old full spec with `-D` (not the loose
signature), run UNCONDITIONALLY (not behind `dpi_is_enabled` — a device can carry the old rule
while config reads disabled), and run BEFORE `dpi_apply_rule` in every inserting path, mirroring
`dpi_purge_legacy_dscp_rule`'s placement at `qmanager_dpi_run:54`. Also call it from `--clear`
(beside `:90`) so a device that uninstalls without ever taking an `--ensure` pass still drains.

**MUST-FIX 2 — the drain belongs INSIDE the shared primitive, not in the callers.**
`video_optimizer.sh:266` and `:312` call `dpi_remove_rule()` directly on the DISABLE path, and
that file was NOT in the proposed change set. If the drain loop matches only the new spec, then
on a device still carrying the pre-migration rule, turning the mode off from the UI does NOT
remove the REDIRECT — the rule survives with the engine reported off, which is the LAN-outage
class `dpi.md` warns about. Fold the old-spec `-D` loop INTO `dpi_remove_rule()` (or have it call
the legacy purge internally) so every existing caller is covered with no out-of-scope caller
edit. Do not rely on `--ensure`/`--clear` alone — the CGI disable path is hit far more often and
on a much shorter timeline.

**Conductor's resolution (to be attacked by A1 if it lands in time):** `dpi_remove_rule` drains
BOTH specs, and `dpi_apply_rule` runs the legacy purge BEFORE its idempotence check so the check
becomes honest. That covers `--ensure`, `--clear`, `run`/`--rule-up`, both CGI disable sites and
`_dpi_uninstall_run` with zero caller edits — and it keeps constraint 2 intact, because
`_dpi_uninstall_run` still reaches only `dpi_remove_rule`, never `--clear`.

## A1 — qm-advocate: DONE_WITH_CONCERNS, 5 confirmed defects IN THE PLAN
Two of them would have made the product WORSE than the bug. The design below is the revision.

1. **CONFIRMED — `ExecStartPost` has no config gate, so the DISABLED path fails the unit and
   burns the start limit.** `qmanager_dpi_run:96-99` exits 0 when no mode is enabled, and under
   `Type=simple` systemd runs `ExecStartPost` after ExecStart *forks*, enabled or not. A bounded
   wait for a listener that will never appear either exits non-zero (unit `failed` -> UI `error`
   via `dpi_state.sh:313`, contradicting the unit's own contract at `qmanager-dpi.service:4-5`)
   or applies the rule anyway (the exact F1 breakage). Five disable/enable cycles trip
   `StartLimitBurst=5` and www-data has no `reset-failed` grant, so the UI cannot recover for an
   hour. **RESOLUTION: `--rule-up` gates on `dpi_is_enabled` and ALWAYS exits 0** — on a missing
   listener it drains the rule and logs. `ExecStartPost` can then never fail the unit.
2. **CONFIRMED — same finding as the auditor's must-fix 2**, reached independently: the apply
   path never runs while disabled (`qmanager_dpi_run:55`), so a legacy drain living only in
   `dpi_apply_rule` is unreachable from `video_optimizer.sh:266,312` and `_dpi_uninstall_run`.
   `dpi.md:111` classes a stranded REDIRECT-to-989 as "a LAN outage, not a leak". **RESOLUTION:
   the legacy drain lives INSIDE `dpi_remove_rule`, unconditional, both specs.**
3. **CONFIRMED — `reset-failed` every 60s voids `StartLimitBurst` and erases the only fault
   signal.** The hour backoff is deliberate (`qmanager-dpi.service:12-15`) and with journald
   masked `NRestarts` is the sole telemetry; a once-a-minute reset means the limit never latches
   and `NRestarts` is permanently 0. **RESOLUTION: ensure does NOT call `reset-failed` at all.**
   The acceptance criterion is "either restores the engine OR removes the rule" — removing is
   sufficient, the LAN is safe, the backoff stays honest and `NRestarts` stays readable. Human
   recovery moves to an explicit user-initiated reset on the CGI ENABLE path (new sudoers line).
4. **CONFIRMED — an `ExecStartPost` failure kills a LISTENING tpws, strictly worse than today.**
   Today an iptables failure costs an unstarted engine; under the plan a transient xtables-lock
   loss (QCMAP re-dial exceeding `-w 5`) would kill a healthy engine and count toward the limit.
   **RESOLUTION: same as 1 — `--rule-up` always exits 0.**
5. **CONFIRMED — an unreadable `/proc/net/tcp` reads as "no listener"**, so a false negative
   removes a working rule and restarts a healthy engine. The file ALWAYS carries a header row,
   so zero lines is provably a read failure, not an empty table. **RESOLUTION:
   `dpi_listener_present` is THREE-state — 0 present, 1 absent, 2 unknown; ensure treats
   unknown as "do nothing" and leaves the rule alone.**
6. **CONFIRMED — port-half-only matching accepts a wrong-address listener.** Now decisive
   because F5 is IN SCOPE and changes the bind address. `qmanager_dpi_verify:195` proves
   loopback-bound tpws instances exist in-tree (127.0.0.1:19890 — no 989 collision today). A 989
   listener on 127.0.0.1 would pass the gate while REDIRECT hands it the bridge0 address ->
   refused, F1 unchanged but harder to see. **RESOLUTION: match BOTH halves of `$2` — the
   address half must equal `00000000` or the bind-address-derived hex** (192.168.225.1 is
   little-endian `01E1A8C0`, confirmed in the conductor's probe output).
7. **`svc_restart` alone closes neither half of F2's reporting.** `platform.sh:56-58` discards
   rc and `cgi_success` fires unconditionally (`video_optimizer.sh:269,315`), so a restart
   refused by the start limit still reports SUCCESS; and `dpi_service_status` (`dpi_state.sh:306`)
   is still a bare pgrep with no argv compare, so the "running with stale argv" lie survives.
   **RESOLUTION: check `svc_restart`'s rc and return a real CGI error; make `dpi_service_status`
   require a LISTENER, not just a process; add a defensive argv reconcile to ensure.**
8. **`ExecStopPost` does not fire on a `ConditionPathExists` failure, and the OTA window is
   unprotected.** `install_rm520n.sh:4531` runs `stop_services` BEFORE the unit deploy and the
   `daemon-reload` at `:3768`, so at OTA-stop time the OLD unit (no `ExecStopPost`) is loaded and
   the rule stays live with tpws dead for the whole install. Ensure is the real backstop; item 2
   is latency only. **Separately `install_rm520n.sh:3843` gates the post-install engine start on
   `video_optimizer.enabled` ALONE — a Full Bypass device's engine never restarts after an
   install.** That is a genuine bug in the same family and is proposed as new scope.
9. **Match-module ordering for `-D` and packet-level addrtype behaviour are both unproven.** An
   insert rc of 0 proves nothing about evaluation, and `-D` needs the module order byte-identical
   across four sites. BOTH go into the PROOF spec, not the design.
10. **SPECULATIVE — concurrent jobs can interleave**: a CGI `svc_restart`'s `ExecStopPost` can
   land after an ensure-driven start's `ExecStartPost`, leaving engine up / rule down until the
   next 60s pass. Self-healing, bounded, documented — not designed around.
11. **`dpi.md` is far more wrong than F7 alone.** `:14` names a nonexistent `dpi_ensure_rule`;
   `:15` documents the pre-addrtype spec; `:18` falsely claims `--ensure` removes the rule when
   both modes are off (false at `qmanager_dpi_run:55-64`); `:131` still frames `--oob=tls` as an
   engine-vs-socks deviation; `:251` lists nonexistent `--start`/`--stop` verbs. Docs ticket grows.

**Could not fault:** constraint 1 (the healthy-engine QCMAP-flush self-heal is preserved),
constraints 2/3/4/7 (uninstall seam, `DPI_RULE_SIG` interpolation, Force-TCP staying outside the
gate, `StartLimit*` in `[Unit]` — all untouched), and the F3 retraction / F6 deferral.
**Unverifiable there:** `printf '%04X'` in BusyBox ash (RG501Q offline) -> goes to the proof.

## Plan
| id | task | class | seat (model/effort) | write set | state |
|---|---|---|---|---|---|
| A1 | Attack the liveness gate: cold-boot slow bind, ordering vs QCMAP flush | recon | qm-advocate (opus/high) | none | **DONE_WITH_CONCERNS — 5 confirmed, folded in above** |
| A2 | Pre-gate audit of the unit change + rule-spec migration | recon | installer-safety-auditor (sonnet/med) | none | **BLOCKED — 2 must-fix, folded into the design above** |
| — | user approval gate (F5 / F4 scope, disruptive-device consent) | gate | conductor | — | **DONE — answers quoted above** |

## Attempts   (append-only)
| task | # | seat | ticket rev | outcome | checks run | evidence path |
|---|---|---|---|---|---|---|
| — | — | conductor | recon | DONE | 5 source files read; 2 device probe batches; md5 three-way | this ledger |

## DEVICE PROOF — RM520N-GL `61368cd2`, all of it on hardware, no harness
Deployed by hand (LF-normalized, `scp` per file, md5 verified equal at every hop). CGI driven as
`www-data` through a **real minted session** (`/tmp/qmanager_sessions/<64-hex>`), never
`_SKIP_AUTH=1` — the first attempt correctly returned `unauthorized`, which is how we know the
authenticated path is the one that ran. Client probes are `curl.exe` from the conductor's host,
whose packets **ingress on `bridge0`** (proven below), so they are genuine LAN-client traffic.

### The platform fact that only a device run could find
`awk '$4=="0A"'` on `/proc/net/tcp` reads a HEALTHY tpws as dead. tpws's transparent-mode
listener reports state **`8A`** (`0x80 | TCP_LISTEN`):
```
   3: 01E1A8C0:03DD 00000000:0000 8A ...        <- tpws, LISTENING
   0: 01E1A8C0:0035 00000000:0000 0A ...        <- dnsmasq :53
   1: 00000000:0016 00000000:0000 0A ...        <- sshd :22
   2: 00000000:01BB / 5: 00000000:0050  0A      <- lighttpd :443 / :80
```
`/opt/bin/netstat` cannot name `8A` either and prints `(null)` in its State column for that row
while naming every other listener `LISTEN`. The first build of the probe matched `0A` only and
consequently refused to install the rule over a working engine. Probe now accepts `0A` or `8A`.
`printf '%04X' 989` -> `03DD` and `_dpi_hex_addr 192.168.225.1` -> `01E1A8C0` both confirmed under
the device's own shell (this was the RG501Q-offline unknown the advocate flagged).

### F2 — a mode switch re-execs tpws (CGI, as www-data)
| step | pid | `--hostlist=` in argv |
|---|---|---|
| enable Video Optimizer | 23132 | **present** |
| switch to Full Bypass | **24914** | **absent** |
| switch back to Video Optimizer | **26505** | **present** |

pid changes every time and argv follows config in BOTH directions — including
Full Bypass -> Video Optimizer, the transition the handoff said never lifted.

### F8 — the exclusion discriminates, measured with a real packet
Isolated `QMTEST` nat chain, six counters ({bridge0,eth0,rmnet_data0} x {LOCAL,!LOCAL}), one
`curl http://192.168.225.1/` from the LAN client:
```
  1  52  RETURN  tcp -- bridge0 ... dpt:80 ADDRTYPE match dst-type LOCAL     <- matched
  0   0  RETURN  tcp -- bridge0 ... dpt:80 ADDRTYPE match dst-type !LOCAL
  0   0  (eth0 and rmnet_data0, both branches)
```
Traffic to the modem's own address ingresses on `bridge0` and classifies **LOCAL**, so the new
rule does not redirect it. Chain removed afterwards (`grep -c QMTEST` = 0). The `!LOCAL` half was
NOT provable from here — this host is not routed through the modem for WAN traffic — but that
half is the pre-existing behaviour; the change only SUBTRACTS local destinations.

### F1 — the rule can no longer outlive the engine
| # | state | tpws | listener | rules | LAN client `http://192.168.225.1/` |
|---|---|---|---|---|---|
| 1 | `systemctl stop` (ExecStopPost) | 0 | 1 absent | **0** | HTTP 301 |
| 2 | old-spec rule hand-installed, engine dead | 0 | 1 absent | 1 | **`curl: (7) Failed to connect … after 2214 ms`** |
| 3 | `--ensure` | 1 (8181) | **0 listening** | **1, addrtype form** | HTTP 301 |
| 4 | engine made unable to listen, rule stranded | 0 | 1 absent | 1 | — |
| 5 | `--ensure` (rc 0) | 0 | 1 absent | **0** | HTTP 301 |
| 6 | `--ensure` again | 0 | 1 absent | **0** | no flap, no re-assert |

**Row 2 IS the reported bug, reproduced from a real bridge0 client** — the QManager UI itself
refused, which is F8 and F1 together. Row 3 proves the legacy drain: the old-spec rule went in,
exactly ONE addrtype-form rule came out (no stacking), and the engine recovered. Rows 5-6 are the
acceptance criterion verbatim: *never re-asserts a rule over a dead listener*, and idempotent.

### The disabled path does not fail the unit (advocate #1)
5 start/stop cycles with both modes off: every cycle `Result=success NRestarts=0 inactive`,
`rule_count=0`. `ExecStartPost` never failed the unit and never burned a restart.
The **6th** start was refused — `Active: failed (Result: start-limit-hit)`. That is systemd's
start-RATE limit on 5 rapid starts, **pre-existing** (`StartLimit*` are unchanged from HEAD) and
not introduced here. It is exactly what the new grant clears:

### The recovery path, end to end
With the unit genuinely in `failed (Result: start-limit-hit)`, one CGI `save_full_bypass` as
`www-data` -> `{"success": true}` -> tpws 24985 listening, `rule_count=1`, `status=running`,
`Result=success NRestarts=0 active`, client HTTP 301. The `reset-failed qmanager-*` sudoers line
is what makes that possible; `visudo -cf` parsed the new file OK **before** it was installed.

### Restored to the pre-run baseline — verified, not assumed
`mode=none`, tpws 0, `rule_count=0`, no `multiport --dports 80,443` nat rule at all, Force-TCP
rule 0 with config 0 (untouched all run), unit `success 0 inactive`, ensure timer `active`,
config keys byte-identical to the opening probe, zero `QMPROBE`/`QMTEST` chains, client HTTP 301.
tpws md5 `264b9478abb6ff3d86952861d552db10` — matches the handoff. `/tmp/qmbak/` KEPT for rollback.

### NOT proven on hardware — stated plainly
- The `!LOCAL` (WAN-destined) half of the exclusion, for the routing reason above.
- A real cold boot through the 1970 clock step with `/opt` unmounted. The design avoids the
  hazard by construction (procfs only, no Entware binary, `--rule-up` always exits 0) but no
  reboot was taken — a reboot needs its own consent.
- The RG501Q-EU: offline all run. No new applet or syntax was introduced, so the residue is
  CRLF/shebang class only.

## Device state
RM520N-GL `61368cd2` reachable and CLEAN — no REDIRECT rule, no tpws, unit inactive/success,
`NRestarts=0`, ensure timer active. Conductor created and destroyed nat chain `QMPROBE` only
(flushed and deleted in the same command). Nothing else written. RG501Q-EU offline.
⚠️ Live LAN client at `192.168.225.86`. Proof steps 2–4 cut its web access ~60–90s and need
the user's explicit yes, quoted into Decisions.

## Commits (base 26f1d19)
| sha | what |
|---|---|
| `3cb6b93` | backend: liveness contract, F1/F2/F5/F8, sudoers grant, installer both-modes gate |
| `c37bd60` | UI: "Bypass benefit test" copy + all 5 locale packs (F4) |
| `089fb74` | `dpi_uptime_str` consistency — flagged by docs-writer, not by a gate |
| `c4b5230` | docs: `dpi.md` liveness contract + drift fixes, router row, RELEASE_NOTES v0.1.15 |

`package.json` (`v0.1.15-draft`) deliberately LEFT UNSTAGED — not this run's change.

## A2 post-verify — installer-safety-auditor: **CLEAR to proceed**
Both pre-gate must-fixes resolved; 7/7 PASS. Confirmed independently: `_dpi_purge_legacy_rule` is
`dpi_apply_rule`'s FIRST statement (ahead of the idempotence check) and is also called from
`dpi_remove_rule`, so the CGI disable path, `_dpi_uninstall_run` and `--clear` are all covered
with **zero caller-side change**; the 16-pass loop breaks on the first failed `-D` so it cannot
loop or stack. Sudoers grant scoped identically to the existing lines, no `tailscaled`, no
wildcard; `/opt/etc/sudoers.d/qmanager` 0440 root:root matches the installer's existing
`install_file … 440` path. The installer's two-mode gate sits inside `start_services()` (line
~4562), after `/opt` is mounted, following the established `qm_config_get` guard — so the
dangling-jq-symlink hazard does not apply there. `--clear` runs at `uninstall_rm520n.sh:280`
while the runner and lib are still on disk (removed at ~373), so `ExecStopPost` never fires
after its own dependencies are gone. `StartLimit*` still in `[Unit]`. Rootfs logic untouched.

## Close-out three-way md5 (rail 11) — deployed == HEAD == working copy
`dpi_state.sh` `4d22567cef8d6e617adc062e4932f641` (redeployed after `089fb74`), `platform.sh`
`275906e0…`, `qmanager_dpi_run` `88db983f…`, `qmanager-dpi.service` `f7b38c5d…`, sudoers
`c674ac98…`, CGI `6ce173a5…`. `sh -n` clean under the device's own shell. Device left at the
restored baseline: `mode=none status=stopped uptime=— rule_count=0 unit=success 0 inactive`.

## qm-verifier: **PASS_WITH_NOTES** — and it found a real bug in the fix
5/5 acceptance criteria and 8/8 invariants PASS (the disruptive halves marked NOT INDEPENDENTLY
REPRODUCED, correctly, since its window was closed). Independent corroboration worth keeping:
`-C` on the new spec returns rc **1** ("no chain/target/match by that name") vs rc **2**
("Couldn't load match") for a genuinely absent module, and `/proc/net/ip_tables_matches` lists
`addrtype` — so the spec parses and is installable. `busybox sh` confirmed `local IFS=.` does not
leak (`IFS_restored=[a b c]`). systemd's recorded exec history showed `--rule-up` exiting 0 in
**1 second**, which is on-device corroboration that the probe accepted tpws's listener first try —
a `0A`-only probe would have burned the full 10s loop.

**F-1 (MEDIUM) — FIXED in `bc7b691`.** `--ensure`'s listener-absent branch called `svc_start`,
*the exact no-op this whole change set out to fix*. tpws can be ALIVE but bound to the wrong
address (LAN subnet / IP-passthrough change): probe correctly says absent, rule correctly drained,
then `svc_start` returns 0 without re-exec'ing because the unit is active — logging a recovery it
never attempted, every 60s, forever. Proven on device by leaving a tpws on `127.0.0.1` with the
unit active: `svc_restart` moves systemd's MainPID to a fresh instance on `192.168.225.1`,
listener goes 1 -> 0, rule lands. **Measurement trap to remember:** `pgrep … | head -n1` returns
the OLDEST pid, so it reported "pid unchanged" while systemd's MainPID had already moved. Count
every instance, or read `MainPID`. The loopback listener (`0100007F:03DD`, also state `8A`) is
independent proof the probe's ADDRESS-half check earns its keep.
Also corrected: the failure log guessed "start limit?", which was wrong — a `ConditionPathExists`
failure exits 0, so a missing binary read as success. It now prints the real `Result`/`NRestarts`.

**F-2 (LOW) — MITIGATED in `bc7b691`.** `svc_reset_failed` erases `Result`/`NRestarts`, the only
crash record with journald masked. The CGI now writes that state to `qlog` (a real file,
`/tmp/qmanager.log`) BEFORE clearing it. The grant itself stays — the user chose it knowingly.

**F-3 (LOW) — acknowledged, no action.** `.claude/agent-memory/ui-builder/MEMORY.md` rode along in
`c37bd60`; it is the ui-builder's own memory note, outside the declared write set. Staged
deliberately by the conductor, harmless, recorded here rather than silently.

**F-5 — pre-existing.** `bun run lint` rc 1, 61 errors, none in this diff's files;
`bunx eslint verify-card.tsx` rc 0. The gate cannot serve as a green signal for anything else.

## Close-out three-way md5 — deployed == HEAD (`bc7b691`) == working copy, all six
`dpi_state.sh 4d22567c…` · `platform.sh 275906e0…` · `qmanager_dpi_run 502ff30a…` ·
`qmanager-dpi.service f7b38c5d…` · sudoers `c674ac98…` · CGI `e2454afe…`
Device left at baseline: `mode=none status=stopped uptime=— tpws=0 rule_count=0`, no
`multiport --dports 80,443` rule at all, Force-TCP 0/config 0, `unit=success 0 inactive`,
timer active, config keys byte-identical to the opening probe, `03DD` listeners 0, client HTTP 301.

## Open follow-ups — NOT done, deliberately
1. **F6 — no `ip6tables` counterpart.** A dual-stack client's IPv6 bypasses the engine entirely.
   Deferred as new engine surface, not a hotpatch. Still open.
2. **RG501Q-EU unverified.** Offline the whole run. `ip`, `printf '%04X'`, `xt_addrtype`, and above
   all whether tpws reports `8A` there too, are UNKNOWN on the community tier. If `8A` is
   RM520N-specific and the RG501Q reports something else, `dpi_listener_present` reads a healthy
   engine as dead there — the probe would drain the rule and restart in a loop. **Check this before
   claiming RG501Q support.** No new applet or syntax was introduced, so CRLF/shebang residue is nil.
3. **Cold boot not measured.** No reboot taken (needs its own consent). The design avoids the 1970 /
   `/opt`-unmounted hazards by construction — procfs only, no Entware binary, `--rule-up` always
   exits 0 — but it is reasoned, not observed.
4. **The `!LOCAL` half of the exclusion** is unproven: the conductor's host is not routed through
   the modem for WAN traffic. Only the LOCAL half was measured. The change only SUBTRACTS local
   destinations, so this is a coverage gap, not a suspected defect.
5. **Device scratch left in `/tmp`** — the sandbox blocked every deletion targeting `/tmp`.
   Remaining: `/tmp/qmdpi{,2,3,4}`, `/tmp/qmtok`, `/tmp/qmpost.json`, and **one minted session
   token in `/tmp/qmanager_sessions/`** (valid ≤3600s from ~17:05). `/tmp/qmbak/` is KEPT
   deliberately for rollback. All cleared by a reboot; the user was given the one-liner.
6. `dpi_uptime_str` / `dpi_service_status` asymmetry closed in `089fb74`.

## Handoff — NEXT ACTION
**Run is COMPLETE.** F1, F2, F4, F5, F7 and F8 landed and are device-proven; F3 untouched
(retracted); F6 deferred. Both gate agents cleared: `installer-safety-auditor` = CLEAR,
`qm-verifier` = PASS_WITH_NOTES with its one medium finding fixed in `bc7b691` and re-proved.

If anything picks this up next, the only live items are the six numbered follow-ups above.
**The one that matters is #2:** the RG501Q-EU was offline all run, so it is unknown whether tpws
reports listener state `8A` there. If it does not, `dpi_listener_present` reads a healthy engine as
dead on that device and will drain the rule and restart in a loop. Verify before claiming
community-tier support.

`package.json` stays UNSTAGED at `v0.1.15-draft` — not this run's change, do not commit it.

DO NOT REDO: the recon reads, any device probe in this ledger, the lane call, the F-1 device
re-proof, or the addrtype/LOCAL measurement. DO NOT act on F3.
