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
| T0 | Commit the Phase-A input documents | **NOT STARTED** | — | — |
| T1 | `hw_profile.sh` — parser, tier table, generator | NOT STARTED | — | — |
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

**T0 is a precondition.** It must land before any worktree is created — three of this plan's four input documents are currently uncommitted and one is untracked.

**T4 is the cut line.** Everything before it is dead code, a new unread file, or an install-time write nothing consumes. T4 is the first task where a device *acts* on the profile. **If Phase A must stop early, stop before T4, not after.**

---

## Log

Newest entry first. Every entry records: what was done, the gate evidence, and **what a later task might invalidate**.

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

### Still `*unverified*` on RG501Q-EU

Live `ATI` / `AT+CGMM` output (blocked on the `/dev/smd11` contention above); counter orientation on this firmware; udev subsystem for `smd11` and whether the PRAIRIE boot-ordering deviation reproduces; whether `/etc/hostname` exists; the 1970 boot window and journald behavior (observed consistent, **not proven**).

---

## Open questions

### Raised at the Phase 3 approval gate — awaiting the user's decision

| # | Question | Status |
| --- | --- | --- |
| Q1 | Fold the `qcmd_test` `RM520` literals (`:50`, `:75`) into Phase A? **Measured:** both greps **PASS** on the RM520N-GL, and both `fail` branches fire only on *empty* output — `:50` also accepts `OK`, `:75` also accepts a 15-digit IMEI. The spec §6.1 claim that it "reports failure on a working device" is **false**. It is a one-line regex widening (`RM5\|RG5\|EG\|EC`, mirroring `qmanager_health_check:354`), and it matches **AT response text**, not the version file — so it is not a profile consumer and does not belong in any migration task. | **OPEN** |
| Q2 | How do agents select a transport per device — RM520N-GL over SSH, RG501Q-EU over adb? This supersedes the `.env` credential-scheme question A0 deferred. `platform-matrix.md` names the four files hardcoding the single-SSH assumption. | **OPEN** |
| Q3 | Does the RG501Q's broken v0.1.12 install stay **frozen** for Phase A, or may it be wiped once its evidence is recorded in `rg501q-bringup.md`? | **OPEN** |
| Q4 | Sequencing against Phase D (China/GFW delivery). D has not run — no plan doc exists. §9.3: "A and D are independent and may run in either order. If the goal is *Lae can install*, D outranks A." | **OPEN** |
| Q5 | Authorize a read-only AT probe (`ATI`, `AT+CGMM`) on the RG501Q? Blocked on `simpleadmin-go`'s two persistent fds outside QManager's `flock` — an interleave would corrupt *its* response. | **OPEN** |

### Deferred to a later phase — recorded so they are not rediscovered

| # | Question | Owner |
| --- | --- | --- |
| D1 | **Rollback is left on the compatibility floor** (T9). Harmless in Phase A — the overlays are empty, so the floor build and the RG501Q build are identical. **From Phase C onward an RG501Q rolls back onto the RM520N build.** Older tags never published variant assets, so a variant-aware rollback would 404. | **Phase C blocker** |
| D2 | Activating the `SDX55 → reversed` orientation map. It is a hypothesis established on a *different model*, with a contradicting slow-path test on the same part. | Phase B |
| D3 | Promoting the RG501Q tier from `community` to `official`. | Phase C |
| D4 | `qmanager-setup.service` declares **no `After=` at all**; `lighttpd.service` is `After=network.target opt.mount`; `qmanager-auto-update.service` is `After=network-online.target`. Phase A works around this with per-consumer fallbacks. Whether the units should be *ordered* properly is a separate change. | unassigned |
| D5 | `data_used.json.orientation` is **write-only** — nothing reads it back and no CGI surfaces it, so an orientation regression has no HTTP-observable surface. | T10 fixes the doc; the design gap is unassigned |
