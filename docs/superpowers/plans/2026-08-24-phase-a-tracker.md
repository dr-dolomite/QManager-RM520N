# Phase A Tracker — Multi-Target Platform Profile

> **This file is the record of what has HAPPENED.** The plan's checkboxes say what a task *involves*; only this tracker says what is *done*. **If the plan and this tracker disagree about state, the tracker wins.**
>
> **`/docs/superpowers` is GITIGNORED** (`.gitignore:53`). Every update to this file needs `git add -f`, and a plain `git status` will **not** warn you it is untracked. Prove it stuck:
> `git ls-files --error-unmatch docs/superpowers/plans/2026-08-24-phase-a-tracker.md`

**Plan:** [`2026-08-24-phase-a-multi-target-platform.md`](./2026-08-24-phase-a-multi-target-platform.md)
**Spec:** [`../specs/2026-08-23-multi-target-modem-support-design.md`](../specs/2026-08-23-multi-target-modem-support-design.md) — **§9 overrides §6.** Sections 1–8 predate adb access to the RG501Q; where §9, this tracker, or [`rg501q-bringup.md`](../../reference/rg501q-bringup.md) contradict them, **the measurement wins and you say so out loud.**
**Prior phase:** A0 — merged `f827b3c`, plan at [`2026-08-23-phase-a0-context-scoping.md`](./2026-08-23-phase-a0-context-scoping.md)

---

## Status

| Task | Title | State | Branch / commit | Session |
| --- | --- | --- | --- | --- |
| T0 | Commit the Phase-A input documents | **DONE (merged)** — all 5 steps. Every input doc is tracked on `development`. | `3c34c4a`, `73cc424`, `fc30a50` | 2026-08-24 |
| T1 | `hw_profile.sh` — parser, tier table, generator | **DONE (branch kept)** — all 8 steps. Both validators clean. Merge decision was still with the user when this row was written. | `581123e` on branch `feat/phase-a-t1-hw-profile`, base `c991b64` | 2026-08-24 |
| T2 | Generate `platform.json` at install; recognize RG501Q | NOT STARTED | — | — |
| T3 | Self-heal `platform.json` in `qmanager_setup` | NOT STARTED | — | — |
| **T4** | **Migrate the poller's identity reads — THE CUT LINE** | NOT STARTED | — | — |
| T5 | Migrate `about.sh`'s firmware-revision read | NOT STARTED | — | — |
| T6 | Harden `verify_checksum()` | NOT STARTED | — | — |
| T7 | Variant overlay build | NOT STARTED | — | — |
| T8 | Widen `validate_url()` / `derive_checksum_url()` | NOT STARTED | — | — |
| T9 | Variant selection at the five URL sites | NOT STARTED | — | — |
| T10 | Documentation sync | NOT STARTED | — | — |

States: `NOT STARTED` · `IN PROGRESS` · `BLOCKED` · `DONE (merged)` · `DONE (branch kept)`

**T0 was a precondition and is SATISFIED.** It had to land before any worktree was created, because three of this plan's four input documents were uncommitted and one was untracked. That is no longer true — all four are tracked on `development` as of `73cc424`. *This paragraph described the state on 2026-08-24 before T0 ran; it is kept for context, not as a live warning.* Any worktree cut at `fc30a50` or later carries every input document.

**T4 is the cut line.** Everything before it is dead code, a new unread file, or an install-time write nothing consumes. T4 is the first task where a device *acts* on the profile. **If Phase A must stop early, stop before T4, not after.**

---

## Log

Newest entry first. Every entry records: what was done, the gate evidence, and **what a later task might invalidate**.

### 2026-08-24 — T1 DONE. `hw_profile.sh` exists; the dead detector is gone.

**Done.** All 8 steps. Branch `feat/phase-a-t1-hw-profile`, cut from `development` at base SHA `c991b642a161d7245cab3fc9f259f7392de1cc51`. **Diffed against that SHA throughout, never against `development`** — a parallel session was advancing the branch with band-locking / locale work the whole time.

| File | Change |
| --- | --- |
| `scripts/usr/lib/qmanager/hw_profile.sh` | **new** — tolerant parser, tier table, `qm_hw_write_profile` generator |
| `scripts/test/hw-profile.sh` | **new** — 21 assertions, fixtures decoded from real device bytes |
| `scripts/install_rm520n.sh` | **-30 lines** — `detect_modem_firmware()` + its section header deleted. Nothing added |

**T0 was already done.** The session brief said T0 Steps 1–2 were outstanding and must land before any worktree was cut. They were not: `git ls-files --error-unmatch` printed all three input-document paths. The tracker was right and the brief was stale — **which is the rule working as designed.** No T0 work was performed.

#### Two defects the harness caught, both fixed in the library rather than the test

1. **The repo's standard load-guard idiom dies under `set -u`.** `[ -n "$_HW_PROFILE_LOADED" ]`, copied from `config.sh:6`, aborts any caller running `set -u`. Every existing library carries the same bug and gets away with it only because nothing sources them that way. `qmanager_setup` (T3) will source this one. Now `${_HW_PROFILE_LOADED:-}`. **Worth knowing before T3 sources anything else.**

2. **Memoization was inert AND a latent T3 bug — removed.** The first draft cached parsed values in module-level vars. Accessors print to stdout, so every caller writes `$(qm_hw_model)` — a command-substitution *subshell*. Proven directly: `_QM_HW_MODEL` is empty in the parent immediately after the call. It never cached anything. Worse, had it worked it would have broken T3: self-heal compares the **live** `fw_fingerprint` against the one in `platform.json`, and a cache holding a pre-reflash value is exactly the bug that path exists to catch. The library now re-reads on every call and the harness asserts memoization stays gone.

#### Decisions made inside T1 that later tasks are written against

- **`qm_hw_variant` returns `default`** (not empty) for any unrecognized model, documented as "no overlay applies — use the compatibility-floor asset `qmanager.tar.gz`". T9 must map `default` → the floor. `rm520n` / `rg501q` are the two real slugs, matching T7's `variants/<slug>/` directories.
- **`form_factor` is `m2` / `lga` / `unknown`**, keyed off the model glob. These are **vendor datasheet values, not device probes** — labelled as such in the source so nobody later mistakes them for measurements.
- **A model failing the Quectel shape regex reports `unknown`, but `fw_fingerprint` is still returned verbatim.** The fingerprint is a staleness key, not an identity claim; self-heal needs it even on hardware we cannot name.
- **The schema-1 field order in C3 is emitted exactly.** No `variant` field was added to the JSON even though `qm_hw_variant()` exists — adding one would change the schema the plan specifies. T9 derives it from `model`.

#### Gate evidence — RM520N-GL, captured live, read-only

Nothing was deployed to either device. The last two rows are the proof of that, not decoration.

| Check | 03:17:48 UTC (before) | 03:27:55 UTC (after) |
| --- | --- | --- |
| `cat /usrdata/qmanager/data_used.json` | `schema 5`, `rmnet_ipa0`, `orientation: normal` | identical |
| `accumulated_rx / tx` | `48218 / 1884447` | `50382 / 1976271` — **advancing** |
| `systemctl list-units 'qmanager*' --all` | 11 loaded, poller running | 11 loaded, poller running |
| `head -c 400 /tmp/qmanager_status.json` | `modem_reachable: true` | `modem_reachable: true` |
| `ls /usr/lib/qmanager/hw_profile.sh` | — | **No such file or directory** |
| `ls /etc/qmanager/platform.json` | No such file or directory | No such file or directory |

The advancing counter is also **the G2 blind-spot check in miniature**: the counter is genuinely moving over ~10 minutes, not frozen at a plausible value. T4 needs this same before/after pair, freshly taken.

Static gates: `bash scripts/test/hw-profile.sh` → **21 passed, 0 failed**. `bash scripts/test/run-all.sh` → **PASS: 163 scripts**. `grep -n "hw_profile\|Project Name\|Branch" scripts/usr/lib/qmanager/platform.sh` → no output. `grep -rn "detect_modem_firmware" scripts/` → no output.

#### Validators — both clean, run in one parallel message

- **`installer-safety-auditor` → CLEAN.** Independently re-verified the zero-callers claim across the whole tree including indirect invocation (no file sources `install_rm520n.sh` as a library; the one `"$fn"`-style dispatch table at `qmanager_health_check:113` is unrelated). All three lockstep findings hold. I4, I6 and the `--force` gate intact — the headless auto-proceed moved `398-408 → 368-378`, a uniform 30-line shift matching the deletion exactly, logic byte-identical.
- **`busybox-portability-checker` → SAFE TO SHIP.** No jq, no `/opt`, no arithmetic, LF clean, `local` form ash-safe. Verified live under `dash` (closest local proxy to BusyBox ash), and re-confirmed the parser against `od -c` on the live RM520N-GL.

#### Invariant re-assertion

| # | Result |
| --- | --- |
| I1 | ✅ Evidence table above — command and output, both captures |
| I2 | ✅ N/A — nothing written to the RG501Q. Read-only `od -c` / `base64` of the vendor file only. **No wipe performed**; the missing-profile fixture survives |
| I3–I6 | ✅ N/A for I3 (no build cut) · I4/I5/I6 confirmed by `installer-safety-auditor` |
| I7 | ✅ `git diff --stat <base> -- scripts/usr/bin/qmanager_poller` **empty**. The `SDX55) echo "reversed"` arm at `:73` is still unreachable — T1 did **not** repair the poller's one-space grep. That is T4's decision to make deliberately |
| I8 | ✅ `grep -c 'jq' scripts/usr/bin/qmanager_setup` → `0`; the library itself has no jq |
| I9 | ✅ `git diff --stat <base> -- scripts/usr/lib/qmanager/platform.sh` **empty** |
| I10 | ✅ Repo-wide grep for `platform.json` / `hw_profile` outside the two new files → no output. Ships as dead code |
| I11 | ✅ `hw_profile.sh:144` → `RG501Q*) printf '%s\n' "community"`. The harness also asserts the negative: a test fails if the string ever becomes `official` |
| I12 | ✅ Both device fixtures are base64 round-trips of real bytes, capture command recorded in the harness header. `form_factor` is explicitly labelled datasheet-derived, not probed |
| I13 | ✅ `git ls-files --error-unmatch` on this file — see the commit |

#### What a later task might invalidate

- **T2's plan line number is stale.** The plan cites the `/usr/lib/qmanager/*` glob install at `install_rm520n.sh:1125`; it is actually at **`:1095`** (`install_dir_flat "$SRC_SCRIPTS/usr/lib/qmanager" "$LIB_DIR" 644`). Uninstaller sites `:341` and `:580` match the plan exactly. **T2 must re-locate before editing, not trust the plan's numbers** — and note T1's own deletion shifted everything below line 261 up by 30.
- **`qm_hw_write_profile` returns 1 legitimately** (missing parent dir, empty `$dest`). Under the caller's `set -e`, a direct unguarded call **aborts the caller** — confirmed live under `dash`. **T2 and T3 must both guard it** (`qm_hw_write_profile "$dest" || …`). This is the single most likely way to turn a clean T1 into a boot-time regression in T3.
- **`_qm_hw_json_escape` uses `tr -d '\000-\037'`**, a valid BusyBox idiom that appears nowhere else in this repo (existing code uses `[[:cntrl:]]` or plain `\r` deletes). It was never executed on-device — T1 is read-only and the library has no consumer. **The first task that actually runs the generator on hardware should eyeball the emitted JSON**, not just assume.
- **Nothing else.** T1 adds no consumer, so the profile's *content* is not yet load-bearing anywhere.

---

### 2026-08-24 — T0 DONE. Every Phase-A input document is now tracked.

**Done.** T0 Steps 1–2 landed, closing the trap that would have broken the next session: `docs/reference/rg501q-bringup.md` was **untracked** and the spec's §9 amendment was uncommitted, so a worktree cut off `development` would have contained none of the RG501Q evidence and a builder would have silently fallen back to spec Sections 1–8.

| Commit | Contents |
| --- | --- |
| `73cc424` | `rg501q-bringup.md` (was untracked), `platform-matrix.md`, the §9 amendment |
| `fc30a50` | `modem-investigator` + `installer-safety-auditor` agent memories |

**Gate evidence.**
```
git ls-files --error-unmatch docs/reference/rg501q-bringup.md \
    docs/superpowers/specs/2026-08-23-multi-target-modem-support-design.md
=> both paths printed. OK
```

**Deliberately NOT committed** — unrelated in-flight frontend work from a parallel session, left in the working tree untouched: `components/cellular/band-locking/live-band-hero.tsx`, `components/cellular/band-locking/shapes.ts`, `docs/reference/band-locking.md`, and five `public/locales/*/cellular.json` files.

**What a later task might invalidate:** nothing. **T1 is now unblocked and may cut its worktree immediately** — the precondition is satisfied. A worktree branched off `development` at `fc30a50` or later contains every input document this plan depends on.

---

### 2026-08-24 — Gate decisions recorded; `qcmd_test` shipped standalone

**Done.** All four gate questions answered (see Open questions). One code change landed **outside Phase A's task list**, per the Q1 decision: `scripts/usr/bin/qcmd_test` model matching widened off the `RM520` literals. Four hunks, LF preserved, validated by `busybox-portability-checker`.

**Gate evidence.** The new patterns were tested against the *actual captured device output*, not a prediction:

| Fixture | `:50` pattern | `:75` pattern |
| --- | --- | --- |
| RM520N-GL live `ATI` / `AT+CGMM;+CGSN` | `rc=0` | `rc=0` |
| RG501Q-shaped response | `rc=0` | `rc=0` |
| Non-Quectel garbage | `rc=1` → `warn` (unchanged from before) | `rc=1` → `warn` |

`fail` still fires only on empty output and the exit code still gates on `$FAIL`, never `$WARN` — so no response that previously reached `pass` can now reach `fail`.

**Incidental finding for T10.** The two multi-vendor model regexes are now textually divergent: `qcmd_test:75` uses `[0-9A-Za-z-]+`, `qmanager_health_check:354` uses `[0-9A-Za-z\-]+`. POSIX bracket expressions give backslash no special meaning, so the latter class contains a **stray literal backslash** plus the hyphen. Functionally equivalent (no model string contains `\`), but if a future pass converges them, **converge on the backslash-free trailing-hyphen form** — it is the correct one.

**What a later task might invalidate:** nothing. This change is disjoint from every Phase A task — `qcmd_test` matches AT response text, not `/etc/quectel-project-version`, so it is not a profile consumer and T4/T5's migration does not touch it.

**Note for the next session:** the working tree had unrelated in-flight frontend work (band-locking components, five locale files) from a parallel session while this ran. **Diff against the base SHA, not `development`** — the branch moves under you.

---

### 2026-08-24 — Phase 1–3 (planning only). No code written.

**Done.** Tier-4 triage; `modem-investigator` recon on both devices; `installer-safety-auditor` hard gate (verdict **CONDITIONAL** — 6 constraints, 0 blockers); a static census; and a devil's advocate against the task decomposition. Plan and tracker written. **No worktree created, no production code written.** Stopped at the approval gate.

**The decomposition was reshaped by the devil's advocate**, not merely reviewed. Changes from the draft:
- Draft T1 (delete a dead function) folded into T1 — a 26-line deletion is not a session, and reviewing it alone shows "removed model detection" with no successor visible.
- Draft T4 + T9 **merged** into T2. The "advisory vs blocking" split was a fiction: they edit adjacent lines of one function and are order-coupled.
- `hw_profile.sh` grew to own the **generator**, not just the parser. Two callers write the profile (installer *and* `qmanager_setup`, which does run on the OTA path via `install_rm520n.sh:2891`); two implementations would drift.
- Draft T8 split into **T6 / T8 / T9** — only checksum hardening is verifiable without a published release.
- Two new tasks added: the release-asset guard (folded into T7) and the documentation sync (T10).
- Draft T3's SDX55 map activation **removed from Phase A entirely** — see Invariant I7.

**Gate evidence captured (the BEFORE baseline for the no-op gate):**
- RM520N-GL `/etc/qmanager/VERSION` = `v0.1.14-draft`; `platform.json` **absent**; 11 `qmanager*` units, poller healthy (`/tmp/qmanager_status.json` fresh, `modem_reachable: true`).
- `/usrdata/qmanager/data_used.json` → `"schema": 5, "selected_counter": "rmnet_ipa0", "orientation": "normal"`.
- RG501Q-EU `/etc/qmanager/` listed, `VERSION` = `v0.1.12`, `platform.json` **absent**. Nothing written to either device.

**What a later task might invalidate:**
- **T4 must re-capture `data_used.json` immediately before its change** — the baseline above is from 2026-08-24 and the counter advances continuously. Compare *shape and orientation*, plus a fresh before/after pair for the advance check.
- **T7's checksum-layout decision is an input to T8 and T9.** If T7 chooses differently from the plan's suggestion, T8 and T9's steps must be re-read, not assumed.
- **T2's lockstep re-confirmation (Step 5) may change the task's size.** The three "no code needed" findings were verified 2026-08-24; if `uninstall_rm520n.sh:580` or the `/usr/lib/qmanager` glob install has changed since, T2 grows.

---

## Invariants checklist

Re-assert every one of these at the end of every task. A task is not done until each is checked or explicitly marked N/A with a reason.

| # | Invariant | How to check |
| --- | --- | --- |
| I1 | **RM520N-GL behavior unchanged** | Run the command; paste the output. **An assertion is not evidence.** |
| I2 | **RG501Q's broken install not made harder to recover** | Nothing written to it, or the write was pre-approved in this tracker |
| I3 | Compatibility floor `qmanager.tar.gz` still published and byte-identical | `sha256sum` vs a pre-change build |
| I4 | Tar sentinel #1 — `install_rm520n.sh` present in every tarball | `tar tzf … \| grep -c install_rm520n.sh` ≥ 1 |
| I5 | Tar sentinel #2 — top-level dir is literally `qmanager_install` | `tar tzf … \| head -1` |
| I6 | Headless auto-proceed at `install_rm520n.sh:399-409` intact | Exercised with no controlling tty |
| I7 | **SDX55 orientation map still INERT** | `grep -n "reversed" scripts/usr/bin/qmanager_poller` — present but unreachable |
| I8 | No `jq` and no `/opt` dependency in `qmanager_setup` | `grep -c 'jq' scripts/usr/bin/qmanager_setup` → 0 |
| I9 | `platform.sh` (init-system abstraction) untouched | `git diff --stat scripts/usr/lib/qmanager/platform.sh` empty |
| I10 | Profile treated as advisory — no privilege/auth decision reads it | Grep the consumers |
| I11 | RG501Q tier is `community`, never `official`, in Phase A | Grep the tier table |
| I12 | Only measured values written; unprobed stays `*unverified*` | Hand-review the RG501Q grep |
| I13 | Tracker force-added and verified | `git ls-files --error-unmatch <tracker>` |

---

## Device facts learned this phase

Every row carries its probe command and date. **Unprobed stays `*unverified*`.** Anything added here must also go into [`../../reference/platform-matrix.md`](../../reference/platform-matrix.md).

### 2026-08-24 — measured

| Fact | Value | Device | Probe |
| --- | --- | --- | --- |
| Version-file labels are **column-aligned** | `Project Name:` (1 space), `Project Rev :` (space **before** the colon), `Branch  Name:` (**2 spaces**), `Custom  Name:` (2 spaces) | **BOTH** | `cat /etc/quectel-project-version` + `od -c` |
| `Project Name` | `RM520NGL_VC` / `RG501QEU_VD` — **suffixed**, not the marketing name | both | same |
| `Project Rev` (the `fw_fingerprint` value) | `RM520NGLAAR03A03M4G_A0.304` / `RG501QEUAAR12A11M4G_04.202` | both | same |
| `Branch Name` | `SDX6X` / `SDX55` | both | same |
| **`detect_orientation_from_soc()` has never matched** | `grep -m1 "^Branch Name"` (1 space) vs the device's 2 spaces → always falls through to `normal` | both | live grep + `data_used.json` |
| Live orientation state | `"schema": 5, "selected_counter": "rmnet_ipa0", "orientation": "normal"` | RM520N-GL | `cat /usrdata/qmanager/data_used.json` |
| `/opt` is **not** a dedicated volume | `/dev/ubi2_0` for `/etc`, `/usrdata` **and `/opt`** — on **both** devices | both | `cat /proc/mounts` (`df` is useless — BusyBox `df` resolves all three to an `/etc/machine-id` tmpfs bind) |
| `/etc/qmanager` mode | `drwxr-xr-x www-data:www-data` (RM520N) vs `drwxrwxrwx www-data:www-data` (RG501Q) | both | `ls -la /etc/qmanager/` |
| `platform.json` | **absent on both** — the RG501Q is a live missing-file fixture | both | `ls -la /etc/qmanager/platform.json` |
| RG501Q `/dev/smd11` has a **second, non-cooperating holder** | `simpleadmin-go` pid 759, two persistent fds, outside QManager's `flock` | RG501Q | `/proc/*/fd` scan |
| RG501Q poller is **not inert** | `atcli_smd11 AT+QENG="servingcell"` caught in flight (pid 2107); it drives the modem, it just cannot serialize output without `jq` | RG501Q | `/proc/*/fd` + `/proc/*/cmdline` |
| RG501Q `atcli_smd11` + `qcmd` | **present and executable**, dated Jun 22 2026 | RG501Q | `ls -la /usr/bin/atcli_smd11 /usr/bin/qcmd` |
| `qcmd_test` greps vs live output | `:50` → `rc=0`, `:75` → `rc=0` — **both PASS** | RM520N-GL | live `atcli_smd11 "ATI"` and `qcmd 'AT+CGMM;+CGSN'` |
| Hostname is **not** derived from model identity | Stock firmware value (`sdxlemur`); the installer never sets it; only the System Settings CGI writes it | RM520N-GL | `grep -rn hostname scripts/install_rm520n.sh` → none |

### 2026-08-24 — measured during T1

| Fact | Value | Device | Probe |
| --- | --- | --- | --- |
| `Package Time` | `2026-03-23,12:27` (RM520N-GL) / **`2025-02-21,13:43`** (RG501Q-EU) | both | `od -c /etc/quectel-project-version` |
| Full vendor file, byte-exact, both devices | RM520N-GL: `UHJvamVjdCBOYW1lOiBSTTUyME5HTF9WQwpQcm9qZWN0IFJldiA6IFJNNTIwTkdMQUFSMDNBMDNNNEdfQTAuMzA0CkJyYW5jaCAgTmFtZTogU0RYNlgKQ3VzdG9tICBOYW1lOiBTVEQKUGFja2FnZSBUaW1lOiAyMDI2LTAzLTIzLDEyOjI3Cg==` · RG501Q-EU: `UHJvamVjdCBOYW1lOiBSRzUwMVFFVV9WRApQcm9qZWN0IFJldiA6IFJHNTAxUUVVQUFSMTJBMTFNNEdfMDQuMjAyCkJyYW5jaCAgTmFtZTogU0RYNTUKQ3VzdG9tICBOYW1lOiBTVEQKUGFja2FnZSBUaW1lOiAyMDI1LTAyLTIxLDEzOjQzCg==` | both | `base64 /etc/quectel-project-version`, cross-checked with `od -c`. **Now the fixture source in `scripts/test/hw-profile.sh` — no later task needs to re-probe this.** |
| No CR bytes anywhere in the vendor file | LF-only on both | both | `od -c` |

#### ⚠ Tooling: `New-SSHSession` no longer reaches the RM520N-GL

`Posh-SSH 3.2.7`'s `New-SSHSession` fails with **`Key exchange negotiation failed`**, on a device that is up and answering. It is not a credential or reachability problem: `ssh.exe` negotiates `curve25519-sha256` fine, and dropbear's proposal (`curve25519-sha256`, `ecdh-*`, `diffie-hellman-group14-sha256`; MAC `hmac-sha2-256` only) overlaps SSH.NET's supported set completely. The Posh-SSH *cmdlet wrapper* prunes something; the bundled library does not.

**Working path — use the bundled SSH.NET directly:**
```powershell
Import-Module Posh-SSH   # only to load Renci.SshNet.dll
$ci = New-Object Renci.SshNet.PasswordConnectionInfo($env:MODEM_IP, 22, $env:MODEM_SSH_USER, $env:MODEM_SSH_PASSWORD)
$c  = New-Object Renci.SshNet.SshClient($ci); $c.Connect()
$c.RunCommand('…').Result
$c.Disconnect()
```
CLAUDE.md still tells agents to use `New-SSHSession`. **Fold this into T10's transport section (Q2).** Note the failure mode leaks `MODEM_IP` into the error text — avoid `-ErrorAction Stop` unguarded if transcripts matter.

### Still `*unverified*` on RG501Q-EU

Live `ATI` / `AT+CGMM` output (blocked on the `/dev/smd11` contention above); counter orientation on this firmware; udev subsystem for `smd11` and whether the PRAIRIE boot-ordering deviation reproduces; whether `/etc/hostname` exists; the 1970 boot window and journald behavior (observed consistent, **not proven**).

---

## Open questions

### Resolved at the Phase 3 approval gate — 2026-08-24

| # | Question | **Decision** |
| --- | --- | --- |
| Q1 | Fold the `qcmd_test` `RM520` literals (`:50`, `:75`) into Phase A? **Measured:** both greps **PASS** on the RM520N-GL, and both `fail` branches fire only on *empty* output — `:50` also accepts `OK`, `:75` also accepts a 15-digit IMEI. The spec §6.1 claim that it "reports failure on a working device" is **false**. | **Ship it now, standalone — DONE.** Landed outside Phase A's task list. `:50` → `Quectel\|OK`; `:75` → `^(RM\|RG\|EG\|EC)[0-9A-Za-z-]+\|[0-9]{15}`, reusing `qmanager_health_check:354`. Banner strings de-branded. **`§6.1 obstacle 3 in the spec is now retired and was wrong as written` — do not re-plan it.** |
| Q2 | How do agents select a transport per device? | **Per-device prefixed env vars** — and **the RG501Q gets no credential entry at all**, because SSH has never been installed on it (no `ssh`/`sshd`/`dropbear`/`scp`/`sftp` in its stock image; adb is the only path). Prefix the triad for the RM520N-GL, keep the bare names working as an alias, reach the RG501Q by adb serial. Implemented in **T10 Step 6**. |
| Q3 | Does the RG501Q's failed v0.1.12 install stay frozen? | **WIPEABLE — a write to the RG501Q is APPROVED.** See the authorization block below. |
| Q4 | Sequencing against Phase D. | **Phase A first** (this plan). D is not abandoned — it remains blocked on §9.4 Q1–Q3, which only the device owner can answer. |
| Q5 | Authorize a read-only AT probe (`ATI`, `AT+CGMM`) on the RG501Q? | **Not asked / not needed for Phase A.** Superseded in practice by Q3: once the device is wiped and reinstalled, `qcmd` serializes properly. Live `ATI`/`AT+CGMM` output stays `*unverified*` until then. |

### ⚠ Device write authorization — RG501Q-EU only

**Approved by the user, 2026-08-24, at the Phase 3 gate.** The RG501Q-EU's previous owner's failed v0.1.12 install **may be wiped**. Its evidence is already recorded in [`rg501q-bringup.md`](../../reference/rg501q-bringup.md).

**Scope and limits:**
- This authorizes wiping **the RG501Q-EU only** (adb serial `b7e3d6f1`). **It authorizes nothing on the RM520N-GL**, which remains strictly read-only.
- **No task in this plan requires a wipe.** Do not perform one as a side effect of testing. If you wipe, record the date and the exact command here — it retires the live missing-profile fixture for every later task.
- Standing invariant I2 changes meaning accordingly: "do not make it harder to recover" no longer applies to a deliberate, recorded wipe. It still applies to accidental damage.

**Wipe log:** *(none yet — device untouched as of 2026-08-24. T1 did not wipe: the only RG501Q access was a read-only `od -c` / `base64` of `/etc/quectel-project-version` over adb. The live missing-`platform.json` fixture is intact.)*

### Raised during T1 — must be honoured by T2/T3

| # | Question / constraint | Owner |
| --- | --- | --- |
| Q6 | **`qm_hw_write_profile` must be guarded at every call site.** It returns 1 legitimately; under the caller's `set -e` an unguarded direct call aborts the caller — confirmed live under `dash`. Write `qm_hw_write_profile "$dest" \|\| …`. | **T2 and T3, both** |
| Q7 | The plan's `install_rm520n.sh:1125` glob-install line is stale — it is **`:1095`**, and T1's deletion shifted everything below line 261 up by 30. Re-locate, do not trust plan line numbers. | T2 |
| Q8 | `_qm_hw_json_escape`'s `tr -d '\000-\037'` has never executed on-device. The first task that runs the generator on hardware should read the emitted JSON, not assume it. | T2 (first real caller) |
| Q9 | Every existing `scripts/usr/lib/qmanager/*.sh` uses the `[ -n "$_X_LOADED" ]` load guard, which **dies under `set -u`**. `hw_profile.sh` was fixed; the others were not. Not a Phase A bug — nothing sources them that way today — but T3 puts `qmanager_setup` in the business of sourcing libraries. | unassigned / T10 note |

### Deferred to a later phase — recorded so they are not rediscovered

| # | Question | Owner |
| --- | --- | --- |
| D1 | **Rollback is left on the compatibility floor** (T9). Harmless in Phase A — the overlays are empty, so the floor build and the RG501Q build are identical. **From Phase C onward an RG501Q rolls back onto the RM520N build.** Older tags never published variant assets, so a variant-aware rollback would 404. | **Phase C blocker** |
| D2 | Activating the `SDX55 → reversed` orientation map. It is a hypothesis established on a *different model*, with a contradicting slow-path test on the same part. | Phase B |
| D3 | Promoting the RG501Q tier from `community` to `official`. | Phase C |
| D4 | `qmanager-setup.service` declares **no `After=` at all**; `lighttpd.service` is `After=network.target opt.mount`; `qmanager-auto-update.service` is `After=network-online.target`. Phase A works around this with per-consumer fallbacks. Whether the units should be *ordered* properly is a separate change. | unassigned |
| D5 | `data_used.json.orientation` is **write-only** — nothing reads it back and no CGI surfaces it, so an orientation regression has no HTTP-observable surface. | T10 fixes the doc; the design gap is unassigned |
