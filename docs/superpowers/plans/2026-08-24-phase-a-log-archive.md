# Phase A — Log Archive (T0 through T2.6)

> Split out of [`2026-08-24-phase-a-tracker.md`](./2026-08-24-phase-a-tracker.md) on 2026-08-25. This is the **narrative record of work already merged**: mechanisms, evidence tables, probe transcripts, refuted attacks, and corrections.
>
> **Nothing here is required reading.** Everything a future task still needs — open items, invalidation warnings, "do not re-do" notes — was distilled back into the tracker. Read this only when re-opening a specific completed task.
>
> Per `change-workflow.md` > Recording, new work of this kind belongs in the **commit body**, not here. This file is the backfill for entries written before that rule existed.

---

## Log

Newest entry first. Every entry records: what was done, the gate evidence, and **what a later task might invalidate**.

### 2026-08-25 — T2.6 (UNPLANNED). BusyBox `timeout` is incompatible across the two devices. Third defect of the same family.

**Triggered by the user disproving my own finding.** I had filed F4 claiming the RG501Q's AT stack was dead and "plausibly blocks every Phase A/B task that reads the modem". The user ran `atcli_smd11 ATI` by hand and got a clean `OK`. That one manual test redirected the whole investigation — see the F4 retraction in the follow-ups table.

**The mechanism.** BusyBox changed `timeout`'s CLI in 1.30: `SECS` became positional and `-t` was dropped. The two devices straddle it, so **no single literal invocation works on both**:

| | RG501Q-EU (v1.29.3) | RM520N-GL (v1.31.1) |
| --- | --- | --- |
| `timeout 2 echo hi` | `can't execute '2'` → **exit 127, zero output** | works |
| `timeout -t 2 echo hi` | works | `invalid option -- 't'` → exit 1 |

So `at_stack_check` **never executed its own command** — the modem was never involved. `qcmd:142` documents that `atcli_smd11` handles its own timeouts and therefore does *not* wrap in `timeout`, which is why live modem data was unaffected throughout and why the failure looked like a modem problem while the poller was demonstrably healthy.

**Root cause of the root cause:** `install_rm520n.sh:1056` guarded the `coreutils-timeout` install with `command -v timeout`. BusyBox ships the applet on both devices, so that guard always succeeded and **the package was never installed on either machine** — harmless on RM520N-GL, fatal on RG501Q.

**This is the third instance of one mistake.** T2.5's wget symlink guard, this, and F6's `mountpoint` guard are all the same error: **asking whether a NAME RESOLVES when what matters is whether the THING BEHAVES.** Two of the three additionally read a missing command's exit 127 as a meaningful boolean. On a single-device fleet all three questions happen to give the right answer, which is exactly why none surfaced until a second device existed.

| File | Change |
| --- | --- |
| `scripts/usr/lib/qmanager/platform.sh` | canonical `qm_timeout`; **load guard made `set -u` safe** |
| `scripts/usr/bin/qmanager_health_check` | local `qm_timeout` copy; `:221` laundering fixed; dead `getent` branch removed |
| `scripts/install_rm520n.sh` | local `qm_timeout` copy; 2 call sites routed; `:1056` detector fixed |
| `scripts/test/timeout-portability.sh` | **new** — 21 assertions incl. anti-drift and a negative control |

**Gate decisions (user):** `mountpoint` filed as F6 rather than bundled; fix the `:221` laundering; remove the dead `getent` branch.

**Three copies of `qm_timeout` exist on purpose.** The installer runs before libs are deployed (and `--frontend-only` never deploys them while still running the code that calls it); `qmanager_health_check` is redeployed by OTA independently of the lib, so a device mid-upgrade can have a `platform.sh` predating `qm_timeout`, and a source-with-fallback would need the fallback to be a full copy anyway. **Drift is pinned by `scripts/test/timeout-portability.sh`, which compares code with comments stripped** — comments legitimately abbreviate, logic must not.

**Findings that were not the assignment:**
- **`platform.sh` killed any `set -u` caller on its first line.** `[ -n "$_PLATFORM_LOADED" ]` is an unbound reference; a `. lib || { fallback; }` guard cannot rescue it because the shell is already gone. Now `${_PLATFORM_LOADED:-}`; the rest of the file measured clean. Latent hazard for all 19 sourcers, defused.
- **`t_net_dns`'s `rc = 124` branch has been dead on both devices forever.** GNU `timeout` returns 124; BusyBox sends `TERM` and the shell reports **143**. The wrapper's 143→124 normalisation makes that branch live for the first time. Nobody had filed this.
- **`getent` is absent on BOTH devices**, so `:491` was unreachable everywhere. A fix touching only `:491` would have reviewed as correct and changed nothing on hardware.
- A full applet census found **no further dependency-bearing divergence** — see the census note in the follow-ups table. Do not re-run it.

**Corrections I had to make to my own work:**
- My Phase 2 spec preferred sourcing `platform.sh` from `qmanager_health_check`. That was unsafe (`set -u`); the builder caught it and used a local copy.
- I told the user the installer PATH mutation stays "because opkg needs it to find wget". Wrong — the auditor traced it to `setup_ssh_early()`'s `command -v dropbear` probe (dropbear exists only at `/opt/sbin/dropbear`, no symlink). Comment corrected in T2.5.
- I split the deferred-questions table when inserting the follow-ups table, orphaning D4/D5 as 3-cell rows inside a 4-column table. Markdown renders that as garbage rather than erroring. Repaired.

**Evidence — RG501Q, as `www-data`:** version probe `timeout: can't execute '2'…` reported as `pass` → `rc=0 v=[jq-1.7.1]`; DNS `fail|resolution failed (rc=127)` on healthy DNS → `rc=0` with a real answer; overrun `143` → **`124`**. Form detection resolves `legacy` correctly.
**Evidence — RM520N-GL (read-only, never deployed to):** `/usr/bin/timeout 1 true` → rc 0, so the probe decides `positional`, correct for 1.31.1. No `/opt/bin/timeout`, no `qm_timeout` in its deployed `platform.sh`.

**Installer call sites — VERIFIED through the full packaged loop.** A mid-session reboot (uptime 11 min) wiped the tmpfs payload, so a hand-pushed re-run died at `Frontend source not found` — correct behaviour on a missing payload, not a regression. Re-verified properly via `bun run package` → `adb push` → extract → install, which is also the first end-to-end exercise of the shipped artifact rather than a hand-pushed script:

```
installer exit=0
✓  at_stack_check: AT stack responding
✓  BusyBox timeout uses the legacy -t form — installing GNU coreutils-timeout
   as defense-in-depth (qm_timeout wrapper is the actual portability fix)
✓  coreutils-timeout installed from Entware
```

That is the original symptom gone, and `coreutils-timeout` landing on a device for the first time — the old `command -v` guard had skipped it on every install ever run. The tarball also stamped `VERSION="v0.1.14-draft"` correctly, confirming the earlier on-device `v0.1.5` was purely a hand-push artifact of `build.sh:88` (which stamps at package time) and never a defect.

### 2026-08-25 — T2.5 (UNPLANNED). Entware bootstrap fixed. The RG501Q can now actually install QManager.

**Not in the plan.** The user ran a real QManager v0.1.13 install on the RG501Q-EU and reported "opkg seems to be not supported at all". Slotted ahead of T3 by explicit decision. Tier 4, full 6-phase flow, both Phase 1 gates run before any code was written.

**The user's conclusion was wrong, and the wrong conclusion was the installer's fault.** opkg works fine and the network was fine. Entware's `opkg` shells out to `wget`, hardcoded — no `option downloader` in `opkg.conf`, no such string in the binary. The RG501Q's **BusyBox v1.29.3 was built without the `wget` applet** (curl only); the RM520N-GL's v1.31.1 ships `/usr/bin/wget`. The installer reported `opkg update failed — no internet connection?` while `curl` fetched the identical URL with **HTTP 200 / 381792 bytes** seconds later. `opkg: not found` at the shell was a third red herring — just a missing `/bin/opkg` symlink created at `:855`, inside the branch that was being skipped.

**Second defect, worse: the bootstrap was a one-shot poison pill.** Guard was `[ ! -x "$OPKG" ]`; the binary is written at `:805` but the block `die`s at `:822`/`:824`. The first failed run left the binary behind, so every run after it printed "Entware already installed" and skipped ~120 lines. Measured signature: binary present, `/opt/lib` containing only `opkg`, `opkg list-installed` **empty**.

The upstream toolkit is **not** the answer here — `simpleadmin-source/installentware.sh:83,85` calls bare `wget` too and fails identically. QManager's port was faithful; the toolkit was simply only ever run on wget-having devices.

| File | Change |
| --- | --- |
| `scripts/install_rm520n.sh` | **+163/−10** — `/tmp`-scoped curl-backed wget shim (gated on `command -v wget` failing), `wget-ssl` handoff, `qm_entware_complete()`, cleanup-before-`die`, three approved drive-bys |
| `scripts/test/installer-entware-bootstrap.sh` | **new** — 22 assertions, anchors matched by text, shim executed against a stub curl |

**Gate decisions (user, at the Phase 3 approval gate):**
- **OTA reach → document-only.** `qmanager_update` always passes `--skip-packages` (`:260,464,576,651`) and `install_dependencies()` is gated behind `DO_PACKAGES` at `:3269`, so **a stranded device can never self-heal via Software Update — it needs a fresh full install.** Deliberate, not an oversight. The hoist-it-out-of-the-gate option was offered and declined.
- **lighttpd → keep Entware parity.** RG501Q ships a vendor `/usr/sbin/lighttpd`; `:878` only tests `/opt/sbin/lighttpd`, so the Entware build installs alongside it. No code change.
- **All three drive-bys approved:** `/opt/sbin` created in the folder loop, `install -d -m 0755` for `/usrdata/opt`, and the two misleading "no internet connection?" strings reworded.

**Why the shim is `/tmp`-scoped and not `/opt/bin/wget`.** `/opt/bin` precedes `/usr/bin` in the RM520N-GL's **vendor** default PATH, not just QManager's prepends — so a persistent shim would shadow the real system wget for CGI, `downloader.sh`, and every root helper. And `uninstall_rm520n.sh:7` states `/opt` is **never** removed, so it would outlive QManager. This is the single most important constraint on this change; do not "simplify" it into `/opt/bin`.

**The PATH mutation is deliberately NOT restored.** `setup_ssh_early()` runs after `install_dependencies()` and probes `command -v dropbear`; dropbear exists only at `/opt/sbin/dropbear` with no symlink anywhere, so dropping `/opt/sbin` would make it report "not installed" on every fresh install. (My first rationale for keeping it — that opkg needs PATH to find wget — was wrong and the auditor corrected it; the code comment now records the real reason.)

**Two bugs were caught mid-flight, both by adversarial checking rather than by reading:**
1. The first cut guarded the `/usr/bin/wget` symlink with `! command -v wget`. That silently no-ops: the shim's PATH still carries `/opt/bin`, so `command -v` finds the wget just installed, concludes it's "already reachable", and skips the symlink **on the exact devices that need it**. Confirmed on hardware — `/usr/bin/wget` did not exist after the first fixed run. Now tests the target directly: `[ ! -e /usr/bin/wget ]`.
2. The shim's `--version` disclaimer read `"… — not GNU Wget"`. `downloader.sh:115` does `grep -qi 'GNU Wget'` — a **substring** match that cannot read the word "not", so the shim would have been taken for GNU wget and handed `-S`/`-T`, which it drops. Caught by the new harness before either validator reported it.

**Evidence — RG501Q-EU, before → after:** Entware packages `0 → 44`; `wget` absent → `/usr/bin/wget` → GNU Wget 1.25.0; `jq`/`sudo`/`lighttpd`/`dropbear` missing → all installed; sudoers **skipped** → installed to `/opt/etc/sudoers.d` at 0440, visudo-checked; `VERSION` absent with `VERSION.pending` stranded → finalized; install stopped at Step 7 → **all 12 steps, exit 0**; CGI through lighttpd as `www-data` returns real JSON. A second run logs `Entware already bootstrapped` — poison pill gone, idempotent.

**Evidence — RM520N-GL (read-only throughout, never installed to):** confirmed no-op. `command -v wget` still `/usr/bin/wget`, `/opt/bin/wget` **does not exist**, no `/tmp/qm_wget_shim`, and `qm_entware_complete()` evaluates true (rc.unslung present, 43 packages) so a future install would not re-bootstrap.

**What a later task might invalidate:** nothing in T3–T10 touches `install_dependencies()`. The reverse is not true — if any later task makes OTA re-enter dependency installation, the document-only decision above must be revisited.

**Carried forward, NOT fixed here:**
- **`jq` is the real blast radius of a half-installed device.** 109 files reference it, essentially unguarded, including `cgi_base.sh:108,118,123,174,176` where `cgi_error`/`cgi_ok` are *themselves* `jq -n`. A jq-less device returns **empty bodies from all 81 CGI endpoints and cannot even report its own error**. Fixing the bootstrap fixes it in practice; the fragility remains.
- **Latent twin of the bug we just fixed:** the curl symlink at `install_rm520n.sh:1048` still gates on `command -v curl` with the same polluted PATH. Dormant only because both known devices ship a factory `/usr/bin/curl`. A future device missing curl the way the RG501Q is missing wget hits this identically.
- **`poller-phase-a.sh` is RED on `development`** — asserts a `prev_traffic_ts` symbol that does not exist in `qmanager_poller`. Pre-existing, unrelated, confirmed not caused by this change.
- **`at_stack_check: no OK from ATI after 3 attempts`** on the RG501Q. The AT transport may differ on SDX55. Phase A multi-target work, not a bootstrap issue.
- `zoneinfo-all` still fails at preflight because it runs before Entware exists; by design it "catches up on next run" (`:497-498`).
- `/etc/qmanager/qmanager.conf.tmp`, 0-byte root:root — fingerprint of a failed cross-UID atomic rename.

### 2026-08-25 — T2 BUILT. `platform.json` is written at preflight. Both validators clean.

**Done and MERGED.** Fast-forwarded onto `development` 2026-08-25 (`9998107..6bd70d4`, three commits: `19f2ee9` installer + harness, `76a0ea8` tracker, `6bd70d4` platform matrix). `development` had not moved from the base, so no merge commit and nothing rebased. **Re-verified ON `development` after the merge: `installer-platform-json.sh` 23/23, `hw-profile.sh` 21/21, `run-all.sh` 164** — a pre-merge pass is not evidence of the merged state. The worktree was removed; the branch ref was deleted. The one uncommitted file in the main checkout (`.claude/agent-memory/modem-investigator/MEMORY.md`, from a parallel session) was disjoint and left untouched.

Worktree cut from `development` at base `9998107b05fd61d3b0c6a4be374bdb1899e5cf38`; `merge-base HEAD development == HEAD` verified before any file was written. Diffed against that SHA throughout. Two files, +400 lines, nothing else touched.

| File | Change |
| --- | --- |
| `scripts/install_rm520n.sh` | **+49** — `RG501Q*` arm in the model `case`; profile generation after `mark_version_pending` |
| `scripts/test/installer-platform-json.sh` | **new** — 23 assertions, extracts the shipped code by anchor text |

**Built against the tracker's 10 constraints, NOT the plan's Steps as written.** The user re-approved this deviation explicitly at the gate this session. All ten verified by `installer-safety-auditor` in its per-constraint table.

#### 🔬 THE PLAN'S PLACEMENT BUG IS NOW PINNED BY A TEST, not just by prose

The harness contains a **negative control** that reproduces the plan's original placement (generator run with `$CONF_DIR` not yet created) against the same fixture. Measured:

- exit code **0** — the failure is completely silent
- **no `platform.json`** written
- the only log trace is a `warn` in `/tmp/qmanager_install.log`, never the console
- the only *console* trace is `…/platform.json.tmp: No such file or directory` — a shell redirect error that escapes `qm_hw_write_profile`'s own `2>/dev/null`, names a `.tmp` path, and **reads like a transient glitch rather than "no profile was written"**

That last detail is new and was not predicted by the recon. **If this control ever starts passing, either `qm_hw_write_profile` began creating its own parent (a real behavior change to review) or the control has stopped testing anything.**

#### Two harness failures on first run — both were MY errors, not the code's

Recorded because both are the kind of thing that silently becomes a wrong "fix":

1. **Expected `"model": "RG501Q-EU"`; the code emits `"RG501QEU_VD"`.** The code is right — `qm_hw_model` returns the raw suffixed `Project Name`, exactly as convention C2 states. Had I "fixed" the library to match my expectation I would have broken T1's contract.
2. **The "RG501Q arm must not prompt" check matched the phrase `proceed anyway` inside my own explanatory comment.** Fixed by stripping comment lines before matching. **A structural assertion over source text must assert against code, not comments** — otherwise a comment that *describes* the forbidden thing fails the test.

#### ✅ Q8 IS FULLY DISCHARGED — the generator ran on real RM520N-GL hardware

The tracker's resume step 4 sanctioned exactly this: a `/tmp` scratch probe, never an install. Run read-only against the live device, scratch file removed afterward, **`/etc/qmanager/platform.json` re-verified absent immediately after**:

```
$ printf 'a\001b\037c' | tr -d '\000-\037' | od -c
0000000   a   b   c

$ . /usr/lib/qmanager/hw_profile.sh
$ qm_hw_write_profile /tmp/qm_hw_probe_437.json     -> rc=0
{
  "schema": 1,
  "model": "RM520NGL_VC",
  "soc": "SDX6X",
  "form_factor": "m2",
  "tier": "official",
  "fw_fingerprint": "RM520NGLAAR03A03M4G_A0.304",
  "caps": {}
}
$ od -c … | tail    -> ends `{ }  \n  }  \n`  (LF-only, no stray control bytes)
$ /opt/bin/jq -e . … -> VALID   (device jq 1.7.1)
$ ls …json.tmp       -> No such file or directory   (nothing stranded)
```

**Both hardware targets are now covered:** RM520N-GL on live silicon (`official` / `SDX6X` / `m2`), RG501Q-EU byte-exactly in the harness from real device bytes (`community` / `SDX55` / `lga`). `_qm_hw_json_escape`'s `tr -d '\000-\037'` has now executed on hardware. **Q8 is closed.**

#### Gate evidence — RM520N-GL, read-only, NO install run

Device was disconnected twice this session and reconnected by the user. **Identity proven before trusting the capture** — `MODEM_IP` is `192.168.225.1` and the RG501Q's `bridge0` claims the *same address*, so the connection was verified to be the right device before anything was recorded: `Project Name: RM520NGL_VC` / `SDX6X`, `androidboot.serialno=61368cd2` (the RG501Q is `b7e3d6f1`).

| # | Item | Baseline 08:32 | Measured 01:32 UTC | Verdict |
| --- | --- | --- | --- | --- |
| 1 | `platform.json` | absent | **absent** | ✅ invariant held |
| 2 | `hw_profile.sh` md5 | `b89b7070f0f4224f32fef30316a2bb28` | **identical** | ✅ still present-and-dormant |
| 3 | `VERSION` | `v0.1.14-draft` | same | ✅ |
| 4 | units / poller | 11 loaded, active | 11 loaded, active | ✅ |
| 5 | `data_used.json` | schema 5 / `rmnet_ipa0` / `normal` | same, `last_reset_ts: 0` | ✅ |
| 6 | `/etc/qmanager` listing | `drwxr-xr-x www-data`, `active_scenario` lone `root:root` | same | ✅ |
| 7 | `jq` / `tr` | 1.7.1 / BusyBox 1.31.1 | same | ✅ |
| 8 | T2 change on device | — | **not present** | ✅ nothing deployed |

**Uptime `57848s` = 16h04m against 15h03m at the 08:32 baseline — the elapsed wall time matches, so the device never rebooted.** Both disconnections were cables, not faults, confirming the earlier diagnosis.

**G2 counter check — two samples 101 s apart, poller `active` at both:**

| | device UTC | `last_update_ts` | `accumulated_rx` | `accumulated_tx` |
| --- | --- | --- | --- | --- |
| A | 01:33:26 | 1787621605 | 218898 | 8771852 |
| B | 01:35:06 | 1787621706 | 219254 | 8787108 |

Δ accumulated **+356 rx / +15 256 tx**, and **Δ`prev_ipa` is exactly equal to Δ`accumulated` in both axes** — cross-validated against `/proc/net/dev rmnet_ipa0`. The frozen-but-plausible failure mode is excluded.

#### Validators — both clean, dispatched in ONE parallel message

- **`installer-safety-auditor` → CLEAN.** Per-constraint table for all 10, plus every invariant. It independently ran the **namespace-collision check** nobody had done: grepped `install_rm520n.sh` for every symbol `hw_profile.sh` defines (`QM_HW_SCHEMA`, `QM_HW_UNKNOWN`, `QUECTEL_VERSION_FILE`, `_HW_PROFILE_LOADED`, `qm_hw_*`, `_qm_hw_*`) outside the new hunk — **zero hits.** Sourcing a library into `preflight()` clobbers nothing. Confirmed `uninstall_rm520n.sh` diff is **empty** and the tar sentinels are untouched.
- **`busybox-portability-checker` → SAFE TO SHIP.** 13 checks. Verified the `[ -f x ] && . x && command -v y` chain under `dash` including the sourced file's early `return 0` mid-chain, and confirmed `if`-condition position exempts the whole list from `set -e`. It self-corrected once: its on-device `tr` re-check failed to load the SSH.NET assembly (`Cannot find type [Renci.SshNet.PasswordConnectionInfo]` — it omitted `Import-Module Posh-SSH`), so it flagged the item `*unverified*`. **That item is now closed independently by the hardware run above.**

#### 🆕 New finding from the portability audit — `scripts/test/` SHIPS TO THE DEVICE

`build.sh:58-62` copies every top-level entry of `scripts/` except `install_rm520n.sh` / `uninstall_rm520n.sh` by name, **with no exclusion for `test/`**. So all 14 workstation harnesses land in the tarball under `qmanager_install/scripts/test/`.

**This is NOT a regression from T2** — 13 harnesses already shipped this way at the base SHA; T2 adds a 14th to a long-standing pattern. Nothing on-device references them (`grep -rl "scripts/test"` across systemd units, `usr/`, `www/` and the installer → no hits), so they are inert dead weight, not a hazard. **For T10:** worth one line in the docs so a future contributor does not assume a file under `scripts/test/` never reaches a device.

#### Lockstep re-confirmed at HEAD — still no code needed (plan Step 5)

| Site | Plan cited | At HEAD `9998107` | State |
| --- | --- | --- | --- |
| `uninstall_rm520n.sh` `--purge` `rm -rf "$CONF_DIR"` | `:580` | **`:580`** | unchanged — purge removes `platform.json` |
| `uninstall_rm520n.sh` `rm -rf "$LIB_DIR"` | `:341` | **`:341`** | unchanged |
| `/usr/lib/qmanager` glob install | `:1125` (stale) | **`:1095`** | unchanged; `:1144` after T2's +49 |
| `qmanager_update` tar sentinels | — | unchanged | not in this diff |

#### Anchors re-verified at HEAD before editing

`set -e` `:42` · `LIB_DIR` `:57` · `CONF_DIR` `:82` · `SRC_SCRIPTS` `:95` · `mark_version_pending()` `:240`, its `install -d -m 0755 "$CONF_DIR"` `:249` · `preflight()` `:308` · `mark_version_pending` call `:402` · `info "Pre-flight checks passed"` `:403` · `$SRC_SCRIPTS` assertion `:405` (pre-change) · `--frontend-only) DO_BACKEND=0` `:3217` · `preflight` invoked bare `:3249`. **Every corrected line number in the 2026-08-25 recon entry held.**

#### Invariant re-assertion

| # | Result |
| --- | --- |
| I1 | ✅ **CAPTURED — no install run.** Full table above, command + output. G2 passed on two samples with the accumulator delta exactly equal to the kernel delta |
| I2 | ⚠ **See the RG501Q correction below — the device was NOT clean, and nothing was written to it by any agent this session.** One `/tmp` exec probe was made and cleaned up |
| I3–I6 | ✅ Confirmed by `installer-safety-auditor`: `build.sh` diff empty, `qmanager_install` staging name and the `install_rm520n.sh` sentinel intact, headless auto-proceed logic byte-identical (harness Test 3 exercises it live) |
| I7 | ✅ `qmanager_poller` untouched by this diff; the `reversed` arm remains unreachable |
| I8 | ✅ No `jq` / `/opt` introduced. **Note this now matters at runtime:** preflight executes BEFORE Entware is bootstrapped, so `/opt/bin/jq` does not exist at that point. `hw_profile.sh` is printf-only by design |
| I9 | ✅ `platform.sh` diff empty |
| I10 | ✅ Still advisory. Repo-wide, the only consumers of `platform.json` are the two test harnesses |
| I11 | ✅ `community`, asserted byte-exactly in the harness's emitted JSON |
| I12 | ✅ Every RG501Q fact below carries its probe command; unmeasurable items left `*unverified*` |
| I13 | ✅ Force-added — see the commit |

#### What a later task might invalidate

- **T2 is NOT merged.** The branch is kept. Merging is the user's call.
- **T3 must not repeat the missing-parent assumption.** `qmanager_setup` runs at boot when `/etc/qmanager` may or may not exist, and it is the caller that must own `install -d -m 0755`. Q6 still applies: guard the call.
- **T3 will mask T2 on-device.** Once `qmanager_setup` self-heals the profile, `systemctl restart qmanager-setup` in `start_services()` regenerates it seconds after preflight on every install. **After T3, `scripts/test/installer-platform-json.sh` is the ONLY observer of T2's correctness.** Do not delete or weaken it.
- **T3 is the first thing to source a library into `qmanager_setup`** — Q9's `set -u` load-guard hazard in the *other* `scripts/usr/lib/qmanager/*.sh` files becomes live if it sources more than `hw_profile.sh`.
- **`scripts/test/` ships to devices** (new finding above) — relevant to T7's variant overlay build if it ever prunes the tarball.

---

### 2026-08-25 — T2 Phase 1 recon COMPLETE. No code written. **CHECKPOINT — session paused for a host restart.**

**Status: T2 is planned but NOT built.** Four read-only agents ran in parallel (`modem-investigator`, `installer-safety-auditor`, `Explore` census, Opus devil's advocate). No worktree was created, no production file was touched, nothing was deployed. **Zero writes to either device.**

#### ⚠ THE DEVICE SITUATION CHANGED — read this before trusting any device row below

**The user factory-reset the RG501Q-EU** (not the RM520N-GL — proven, see below). Reason: it shipped with a pre-installed **`simpleadmin-go`** — a third-party fork of the user's own earlier SimpleAdmin project — which was holding `/dev/smd11` and corrupting our probes. The device is now stock-fresh: no SimpleAdmin Go, no QManager.

**Identity proven by measurement, not inference.** SSH and adb were both unavailable, so the investigator used a **third transport that is in none of our docs**: the Quectel USB AT port the Windows host enumerates as a COM port (`COM24`, matched to USB serial `B7E3D6F1` via a PnP parent lookup). Read-only probe, 2026-08-25 07:41:49:

```
ATI     -> Quectel / RG501Q-EU / Revision: RG501QEUAAR12A11M4G
AT+CGMM -> RG501Q-EU
AT+CGSN -> 863436050940776
AT+QCFG="usbcfg" -> +QCFG: "usbcfg",0x2C7C,0x0800,1,1,1,1,1,0,0
```

**Consequence 1 — the RG501Q has NO SHELL TRANSPORT.** The reset reverted the USB composition to stock: PID changed `0x0801` → `0x0800` and the `MI_06 ADB Interface` is gone (measured against the host's stale PnP entries for the same serial). SSH has never existed on that device, so adb was the only shell. **Any doc, brief, or tracker row that lists `adb -s b7e3d6f1 shell` as the access method for the RG501Q is now WRONG.** Restoring it needs an `AT+QCFG="usbcfg",...` **write**. The investigator refused it (correctly — unauthorized), and **the user has taken this on themselves**; as of this checkpoint they were still working through it and hit trouble.

**Consequence 2 — the whole RG501Q fresh-state census is `*unverified*`.** `jq`, `opkg`, `/opt`, `lighttpd`, leftover QManager artifacts, `/proc/cmdline` `ro` status, `/proc/mounts` volume backing, `/tmp` `noexec` — **none of it was measurable and none of it was guessed.**

**Consequence 3 — the RM520N-GL was unreachable this session.** Measured on the host: Ethernet at APIPA `169.254.95.110` (no DHCP lease), **no host interface on the modem's subnet at all**, `arp -a` showing **zero dynamic neighbours**, 22/80/443 all closed. **The user confirmed it was simply physically disconnected and has since reconnected it.** A re-dispatch to capture the baseline was in flight when this checkpoint was written — **its result is NOT recorded here. Assume the baseline is still uncaptured.**

**Note the failure-mode change:** the transport defect recorded on 2026-08-24 was `Key exchange negotiation failed` from Posh-SSH's cmdlet wrapper. This session the SSH.NET path failed with a plain **connection timeout** instead — a dead network path, not the tooling bug. Anyone following the documented workaround will see a different error and may misdiagnose it.

#### An `atcli_smd11` staging plan was authorized, then rendered unnecessary

The user instructed that since nothing is installed on the fresh RG501Q, `atcli_smd11` should be pushed over adb and chmod'd before AT commands could be tested. That was authorized with a deliberate constraint — **stage to `/tmp`, never `/usr/bin`**, because `/usr/bin` is on the rootfs which boots `ro`, and the project contract says a rootfs `remount,rw` must then never be restored, permanently mutating a device we want clean. `/tmp` is tmpfs, so a reboot is a full undo.

**It was never executed** — adb was already gone. And it turned out to be moot: the COM-port transport delivered the same three AT identity commands with **zero writes and no staged binary**. The float-ABI question (does the SDX55 run our hard-float static ARM binary?) never had to be answered and **remains `*unverified*`.** The plan is sound and can be run verbatim if a shell returns; the source md5 is confirmed below.

#### 🛑 THE PLAN'S PRESCRIBED PLACEMENT FOR T2 IS WRONG — it writes NO profile on a fresh install

Found by the devil's advocate, independently corroborated by `installer-safety-auditor`. **This is the single most important finding of the session.**

The plan (`…-multi-target-platform.md:303`) says to place the generator *"after the whole `if [ "$DO_FORCE" = "1" ] … fi` block closes"* — that `fi` is `install_rm520n.sh:386`. But `$CONF_DIR` (`/etc/qmanager`) **does not exist yet at that line.** It is created 16 lines later by `mark_version_pending` at `:402`, which calls `install -d -m 0755 "$CONF_DIR"` (`:249`) and is documented in-source as *"the FIRST thing that creates $CONF_DIR"*.

And T1's generator **deliberately refuses to create its own parent** (`hw_profile.sh:201-204`): *"The destination directory is NOT created here… A missing parent makes this return 1 with no side effect."* T1's own harness asserts it (`scripts/test/hw-profile.sh:180-182`).

**So on every device where QManager was never installed** — every fresh install, and the now-reset RG501Q — the plan's placement yields `return 1`, a `|| warn` buried in `/tmp/qmanager_install.log`, and **no `platform.json`.**

**Why it would have shipped:** on the RM520N-GL, `/etc/qmanager` already exists, so it works there. The only device we can gate against would show nothing wrong.

**CORRECTED PLACEMENT — place the generator after `mark_version_pending` at `:402`, immediately before `info "Pre-flight checks passed"` at `:403`.** This satisfies every constraint the plan actually cares about: outside the `--force` gate (closes `:386`), after the `RM551E` `die` (`:341-343`), after the remount `die` (`:390`), after the source-dir `die`s (`:395-400`) — and it is the only placement where the parent directory exists.

#### Every line number in the plan is stale — corrected table

T1's 30-line deletion shifted `preflight()` up by ~53 lines. **Re-located and verified at HEAD `664a02b` by two independent agents.**

| Site | Plan cited | **Actual** | Quote |
| --- | --- | --- | --- |
| `preflight()` body | `:361-432` | **`:308-404`** | `preflight() {` … `}` |
| `--force` gate opens | `:361-363` | **`:331`** | `if [ "$DO_FORCE" = "1" ]; then` |
| gate `else` / closing `fi` | — | **`:333` / `:386`** | |
| Tier `case` | inside 361-432 | **`:340-382`** | `case "$project_name" in` … `esac` |
| `RM551E*` hard die | — | **`:341-343`** | `die "Incompatible device: …"` |
| `RM520N*` arm | — | **`:344-346`** | `info "Detected: RM520N-GL ($ver)"` |
| `""` warn arm / `*` default arm | — | **`:347` / `:350`** | |
| `/dev/tty` probe | `:393-409` | **`:363`** | `if { true </dev/tty; } 2>/dev/null; then` |
| Headless auto-proceed | `:393-409` | **`:357-380`** (block `:372-376`) | `if [ -z "$answer" ]; then` … `answer="y"` |
| **`mark_version_pending` call** | not cited | **`:402`** | the new anchor — see above |
| `set -e` | not cited | **`:42`** | `set -e`. **No `set -u`, no `pipefail`** |
| `SRC_SCRIPTS` | not cited | **`:95`** | `SRC_SCRIPTS="$INSTALL_DIR/scripts"` |
| `CONF_DIR` / `LIB_DIR` | not cited | **`:82` / `:57`** | |
| `preflight` invoked | not cited | **`:3200`**, plain statement in `main()`, no subshell | |
| Glob install of `usr/lib/qmanager` | `:1125` | **`:1095`** (T1's `:1095` was right) | `install_dir_flat "$SRC_SCRIPTS/usr/lib/qmanager" "$LIB_DIR" 644` |
| Uninstaller lib removal | `:341` | **`:341` unchanged** | `rm -rf "$LIB_DIR"` |
| Uninstaller `--purge` | `:580` | **`:579-581` unchanged** | `rm -rf "$CONF_DIR"` |
| Tar sentinels #1 / #2 | `qmanager_update:165` / `:456,:568,:643` | **all unchanged** | |

**One plan text correction:** the plan describes `qmanager_update:260,464,576,651` as four sites each running `install_rm520n.sh --force …`. Only **`:260`** is the real invocation (inside `run_install_with_progress()`); the other three are `log` lines that funnel into it. All paths do pass `--force`, so the conclusion holds — but a builder grepping those four numbers will find only one command.

#### Constraints T2's builder MUST obey (7 from the gate + 3 from the devil's advocate)

1. **Placement: after `mark_version_pending` (`:402`), before `:403`.** Not after `:386` as the plan says.
2. **Source from the staging tree** — `. "$SRC_SCRIPTS/usr/lib/qmanager/hw_profile.sh"`, never the absolute `/usr/lib/qmanager/…`, which at preflight time is the *previous* version's library (OTA) or absent (fresh install).
3. **Guard the write** — `qm_hw_write_profile "$CONF_DIR/platform.json" || warn "…"`. `set -e` is live at `:42` with no enclosing subshell, so a bare call aborts the whole installer. `warn()` (`:153-156`) ends on a `printf` and returns 0, so the `||` genuinely neutralizes the trip.
4. **Do NOT add an `install -d` for `$CONF_DIR`** — constraint 1's placement guarantees it exists, mode 0755.
5. **`RG501Q*` arm** goes in the `case` as a sibling of `RM520N*` (`:344-346` shape): `info` line only, no prompt. It is unrelated to the generator's placement.
6. **Nothing inside the `--force` block may touch `platform.json`** — that block is skipped on every OTA.
7. **CRLF:** T2 introduces the installer's **first-ever source of a staging-tree file before the `tr -d '\r'` strip step** (every existing `.` call reads from the already-installed, already-stripped `$LIB_DIR`). Safety rests entirely on `.gitattributes`' `scripts/**/*.sh text eol=lf`, which was verified present and correctly scoped. Acknowledge it in a comment or the commit note.
8. **Guard the SOURCE too, not just the call (`--frontend-only` aborts the installer otherwise).** `$SRC_SCRIPTS` is only asserted to exist when `DO_BACKEND=1` (`:398-400`); `--frontend-only` sets `DO_BACKEND=0` (`:3170`). An unguarded `.` of a missing file returns non-zero and `set -e` kills preflight. Use `[ -f … ] && . …` and only call the generator when `command -v qm_hw_write_profile` resolves.
9. **Step 6's headless check must be a SYNTHETIC harness.** The plan says to reproduce it via "the RG501Q reaching the `*` arm under `adb shell` with no tty" — but **Step 4 adds `RG501Q*)` to the `case`, which removes the RG501Q from the `*` arm.** After T2 there is no known device that reaches the headless auto-proceed path, retiring the plan's own justification at `:51`. Build a fake `/etc/quectel-project-version` with a non-Quectel `Project Name`, close stdin and `/dev/tty`.
10. **Assert the profile exists at the END OF `preflight()`, not at the end of the install** — see the masking risk below.

#### 🔥 The biggest risk in T2, which nobody had named: **T3 masks every one of T2's failure modes**

`start_services()` runs `systemctl restart qmanager-setup` on every install (`install_rm520n.sh:2861`), using `restart` specifically so `ExecStart` always re-runs. Once T3 lands, that regenerates an absent `platform.json` seconds after preflight. **On the standard path — including every OTA — a device ends up with a correct profile whether or not T2 works at all.**

Combine that with T2's three silent failure modes (missing parent → `return 1`; the mandated `|| warn` logging to a file, not the console; the `--frontend-only` source abort) and **T2 can be completely non-functional on fresh installs while every check in its Step 8 passes.**

The team named this masking *shape* for a different cause (plan `:316`, the old-schema source-path bug) and missed it for the directory-existence bug the code actually has.

**Mitigation, now mandatory for T2's gate:** in the local harness, run `preflight` ALONE against a `$CONF_DIR` that does not exist, and assert `platform.json` is present, schema-1 shaped, and `platform.json.tmp` absent. **That same check discharges Q8** — it is the first execution of `_qm_hw_json_escape`'s `tr -d '\000-\037'` outside T1's sandbox.

#### T2 is NOT invisible on the RM520N-GL — it changes a UI-downloadable artifact

The tracker's cut-line claim (line ~34, *"everything before T4 is dead code… or an install-time write nothing consumes"*) is **false as stated.** `qmanager_health_check`'s `t_cfg_qmanager_dir()` (`:563-566`) runs `ls -la /etc/qmanager >> "$OUTPUT_FILE"`; the test is registered (`:891`) and `$OUTPUT_FILE` is bundled and served over HTTP by `scripts/www/cgi-bin/quecmanager/system/health-check/download.sh`.

So after T2 the RM520N-GL's downloadable health-check bundle gains a `platform.json` line. The **verdict string** (`pass|exists`) is unchanged, so this is a diagnostic-body diff, not a functional regression — but I1 says "behavior unchanged" and this is the one place the write is observable over HTTP. **T2's gate must record the pre/post `ls -la /etc/qmanager` and assert the `cfg.qmanager_dir` verdict is byte-identical.**

#### Two tier tables will exist after T2 — the exact drift the plan forbade for the generator

The plan justified putting the generator in the library because *"two implementations would drift"* (`:230`). T2 Step 4 then adds an `RG501Q*` arm to `install_rm520n.sh`'s `case` (`:341-380`) while `hw_profile.sh:138-153` already owns `qm_hw_tier()` — two model→behavior tables keyed off **two different parsers** (installer: `grep -m1 "^Project Name:" | tr -d '[:space:]'`; library: `_qm_hw_field` plus a Quectel shape regex returning `unknown`).

They **already disagree** on a non-Quectel string: the installer prompts via `*`, the library reports `unknown` → `fallback`. Nothing tests that they agree. **Cheapest fix: add an assertion to `scripts/test/hw-profile.sh` that the installer's `case` globs and `qm_hw_tier`'s globs enumerate the same set.**

#### The test gate T1 reported is weaker than it reads

`scripts/test/run-all.sh` **does not execute any harness** — it only `bash -n` syntax-checks and does a warn-only CRLF scan (its own header, `:9`, says so). The functional harnesses run through a **different** runner, `scripts/test/run-harnesses.sh:52`. So T1's recorded `run-all.sh → PASS: 163 scripts` means *163 files parse*, not *163 files behave*. T1's real functional evidence was its separate `hw-profile.sh` run (21 assertions), which did happen. **Correct the gate command in future entries; T10 should fix the docs.**

**Also: the installer has NO test harness.** No file in `scripts/test/` references `install_rm520n.sh` or `preflight`. T2's Step 6 harness is therefore a **build**, not a run — real scope the plan understates.

#### Refuted attacks — recorded so they are not re-raised

- **The reset invalidates T1's fixtures / the C1 parser measurements.** No. `/etc/quectel-project-version` is vendor firmware, restored identically by a factory reset, and the base64 fixtures are embedded in `scripts/test/hw-profile.sh` — no device needed. C1, C2 and the tier table are unaffected.
- **`preflight()` has an early `return` or a `--skip-*` flag that skips the generator.** No. `preflight()` has no `return`; every exit is a `die`. `main()` calls it unconditionally at `:3200` and none of the seven flags gate it. (Constraint 8 is about the *source*, not the call.)
- **`platform.json` is carried by a backup/restore or OTA-preserve routine.** No. `BACKUP_DIR` handling is `auth.json`-only (`:978-990`); `qmanager_update` touches only `VERSION`, `VERSION.pending`, `updates/`; the one `etc/qmanager/*` loop (`:1459`) walks the **staging** tree. The health-check listing above is the sole consumer and it does not parse the file.
- **A partial/corrupt profile could be written and read as valid.** No. Same-directory `${dest}.tmp`, `mv` only on success, cleanup on failure (`hw_profile.sh:208-219`), with no-stranded-tmp assertions in the harness. Only a full `ubi2_0` could truncate, and there the `>` fails and the `mv` never runs.
- **`qmanager_setup:151`'s `chown -R www-data:www-data /etc/qmanager` breaks the install-time write.** No. Ownership, not content — and `install_backend:1363` already does the same chown mid-install. Consequence is only that the profile is www-data-writable, which `hw_profile.sh:14-17` already declares and I10 already covers.
- **The load guard `[ -n "${_HW_PROFILE_LOADED:-}" ] && return 0` trips `set -e` when sourced.** No. Non-final command of an AND-OR list, which `set -e` exempts; verified under `dash` during T1.
- **`qm_hw_write_profile` violates the same-directory-tmp / EXDEV rule.** No — **already satisfied by T1's code.** `tmp="${dest}.tmp"` (`hw_profile.sh:208`), same idiom as `qm_config_set()`. Nothing for T2 to add.

#### ⚠ Out-of-scope hazard: reinstalling QManager on the fresh RG501Q will fail at the same place

The device has no internet (`rg501q-bringup.md:80-82`: `Could not resolve host`), and the Entware bootstrap dies unconditionally at `install_rm520n.sh:773-774` (`opkg update … || die`). That `die` is in `install_dependencies()`, which runs **after** `preflight` — so with the corrected placement, T2's write would land and survive even on a doomed install (a benefit). **But a reinstall is not a route to a working RG501Q fixture.** Network provisioning for that device is Phase C/D, not something T2 absorbs.

#### ✅ RM520N-GL "BEFORE" BASELINE — CAPTURED AND CLEAN. The build is unblocked.

Device reconnected by the user and re-probed 2026-08-25 08:32–08:36 (+08:00; device reports UTC). **Zero writes.** SSH.NET connected first try — neither the `Key exchange negotiation failed` cmdlet defect nor the earlier timeout recurred.

**Uptime `15h03m` proves the device was never rebooted** — it only lost its network path, corroborating "simply disconnected" exactly. The earlier APIPA/zero-ARP reading was diagnosing a cable, not a fault. (`PingSucceeded=False` alongside a working TCP/22 is ICMP filtering on the path, not a reachability problem.)

| # | Item | Expected | Measured | Verdict |
| --- | --- | --- | --- | --- |
| 1 | `qmanager*` units | 11 loaded, poller running | 11 loaded, `qmanager-poller.service active running` | ✅ match |
| 2 | `data_used.json` header | schema 5 / `rmnet_ipa0` / `normal` | schema 5 / `rmnet_ipa0` / `normal`, `last_reset_ts: 0` | ✅ match |
| 3 | `/tmp/qmanager_status.json` | `modem_reachable: true` | `true`, `errors: []`, LTE connected on SMART | ✅ match |
| 4 | `/etc/qmanager/VERSION` | `v0.1.14-draft` | `v0.1.14-draft` (matches `package.json`) | ✅ match |
| 5 | **`platform.json`** | **ABSENT** | **ABSENT — re-verified twice, 08:32 and 08:36** | ✅ **the gate's load-bearing pre-condition holds** |
| 6 | `hw_profile.sh` on device | absent | **PRESENT, dormant** — see below | ⚠ **the brief was wrong** |
| 7 | G2 counter advance | must move | **+1 792 rx / +64 524 tx over 424 s**, 4 monotonic samples | ✅ **live** |
| 8 | `jq` | — | `/opt/bin/jq`, **1.7.1** | ✅ present |
| 9 | `tr` | — | BusyBox **1.31.1**, `\000-\037` range class works | ✅ usable |

**G2 detail — the counter is provably following the kernel, not replaying a cache.** **Four samples over 424 s (7 m 04 s)** of device-clock time, strictly monotonic with no flat interval:

| # | device UTC | `last_update_ts` | `accumulated_rx` | `accumulated_tx` |
| --- | --- | --- | --- | --- |
| 1 | 00:32:24 | 1787617943 | 205162 | 8216984 |
| 2 | 00:35:27 | 1787618125 | 205810 | 8244612 |
| 3 | 00:36:19 | 1787618178 | 205994 | 8252600 |
| 4 | 00:39:28 | 1787618367 | 206954 | 8281508 |

Intervals: 1→2 (182 s) **+648 / +27 628** · 2→3 (53 s) **+184 / +7 988** · 3→4 (189 s) **+960 / +28 896** · **total 1→4 (424 s): +1 792 rx / +64 524 tx.**

Cross-validated against `/proc/net/dev rmnet_ipa0`: at sample 3 the kernel's rx `206518` / tx `8253772` are **byte-identical** to that sample's `prev_ipa_rx` / `prev_ipa_tx`, and `Δprev_ipa` equals `Δaccumulated` exactly in every interval. `last_reset_ts: 0` and `modem_reset_count: 0` held constant throughout; `qmanager-poller` was `active` at every sample. **The frozen-but-plausible failure mode is decisively excluded.** *(An earlier 3-sample / 235 s reading was superseded by this one; the investigator had flagged that window as short and extended it.)*

##### ⚠ BASELINE CORRECTION — `hw_profile.sh` IS on the device. T1's gate row is stale.

T1's evidence table records `ls /usr/lib/qmanager/hw_profile.sh` → *No such file or directory*. **That was true at 03:27 UTC on 2026-08-24 and is false now:**

```
-rw-r--r--  1 root root  10428 Aug 24 09:56 /usr/lib/qmanager/hw_profile.sh
```

**This is NOT a rogue deploy — verified three ways per the project's deploy-verification rule:**

| Source | md5 |
| --- | --- |
| Device `/usr/lib/qmanager/hw_profile.sh` | `b89b7070f0f4224f32fef30316a2bb28` |
| Working copy | `b89b7070f0f4224f32fef30316a2bb28` |
| `git show HEAD:` | `b89b7070f0f4224f32fef30316a2bb28` |

All three identical; `git status --porcelain -- scripts/usr/lib/qmanager/` empty. `platform.sh` likewise matches three ways (`f97c4f75994a6f389655e9bd96948b9c`).

**How it got there:** every file in `/usr/lib/qmanager/` shares mtime `Aug 24 09:56` UTC = `17:56 +0800`. T1 was committed at `11:35:30 +0800`; a normal install/OTA six hours later deployed the **whole library tree** and swept up the newly-committed file. **A library needs no caller and no unit to land on the device.**

**It is deployed but fully dormant.** `grep -rl "hw_profile" /usr/lib/qmanager /usr/bin /lib/systemd/system` matches only the file itself. `qm_hw_write_profile` is defined at `hw_profile.sh:205` and invoked nowhere. *That is precisely why `platform.json` does not exist.*

**Action for the builder:** record the BEFORE state for item 6 as **"present, md5 `b89b7070…`, identical to HEAD, deployed Aug 24 17:56 +0800, no caller"** — NOT "absent". Otherwise the post-change diff flags a pre-existing file as a regression and burns a cycle. The invariant that actually matters (`platform.json` absent) is untouched.

**Durable lesson:** "it's in the repo, not on the device" is never a safe assumption for anything under `scripts/usr/lib/qmanager/` — that directory deploys as a whole tree. **Deployed-but-dormant is a normal state and must be checked for explicitly.** Uniform mtimes across a directory date the *deploy*, not the files.

##### Two AFTER-comparison decisions — ANSWERED, do not re-litigate

The investigator raised both and flagged its own assumption. **Orchestrator's rulings:**

1. **Is a dormant `hw_profile.sh` on the device acceptable for the AFTER comparison, or does the gate want a device with T1 *not* deployed? → ACCEPTABLE. Do not attempt to remove it.** T1 is merged to `development`, so a device carrying HEAD's library is *correct* state, not contamination. The gate's observable invariant (`platform.json` absent) holds regardless, and the library has zero callers so it cannot influence behavior. Removing it would require a write to a device that is read-only for this entire phase — strictly worse than accepting it.
2. **Should the AFTER comparison of `ls -la /etc/qmanager/` be a raw text diff? → NO. Compare name + mode + owner only.** Mtimes drift naturally (`VERSION`, `active_profile`, `last_boot_id`, `ttl_state` and others move on their own schedules), so a raw text diff produces false positives on every run. **The single expected delta is one added line for `platform.json`.** Assert that, plus that the `cfg.qmanager_dir` verdict string stays byte-identical at `pass|exists`.

##### Q8 is now MOSTLY DISCHARGED — BusyBox `tr` handles the octal range class

The idiom that had never run on hardware was smoke-tested read-only (pipe only, no files created):

```
$ printf 'a\001b\037c\n' | tr -d '\000-\037' | od -c
0000000   a   b   c
```

**BusyBox 1.31.1 `tr` supports `\000-\037` correctly.** It also strips the trailing newline (`\012` is inside the range) — **not a defect at the real call site**, because `_qm_hw_json_escape` (`hw_profile.sh:191`) feeds it via `printf '%s'`, which emits no trailing newline.

Remaining for the fuller proof, whose inputs are now settled: BusyBox 1.31.1 `tr`, `jq 1.7.1` at `/opt/bin` available on-device for `jq -e .` validation, single call site at `hw_profile.sh:191`. **Still to do: run the generator to a scratch path and validate the emitted JSON. Do NOT run an installer to achieve this.**

##### The health-check observability claim — VERIFIED, and tightened

`qmanager_health_check:563-568` confirmed (`t_cfg_qmanager_dir()` → `ls -la /etc/qmanager >> "$OUTPUT_FILE"`, `echo "pass|exists"`), registered at `:891` as `cfg.qmanager_dir`, streamed by `…/system/health-check/download.sh` (auth-gated, `job_id` regex-validated).

**Tightening finding:** the bundle collector does **not** list `/usr/lib/qmanager` anywhere. So `ls -la /etc/qmanager` is the **sole** user-visible surface for this change — the full listing captured at 08:32:43 is the complete before-image (**use the verbatim listing, not an entry count** — successive reports counted it as both 23 and 24 depending on whether `.`/`..` were included), and the dormant `hw_profile.sh` is invisible to users. Directory mode measured `drwxr-xr-x www-data:www-data` (**755, not the `0777` in an older memory note**); `active_scenario` is the lone `root:root` file.

#### Invariant re-assertion

| # | Result |
| --- | --- |
| I1 | ✅ **CAPTURED AND CLEAN** — see the baseline table above. Command and verbatim output recorded for all nine items; G2 passed on three monotonic samples cross-validated against `/proc/net/dev`. **One correction: `hw_profile.sh` is present-and-dormant, not absent.** |
| I2 | ⚠ **NOW VACUOUS AS WRITTEN — must be REPLACED, not deleted.** There is no broken install to make harder to recover. The risk has inverted: the RG501Q is now the project's only clean-slate fixture. **Proposed rewording: "the RG501Q remains a stock-fresh, QManager-free device unless a write is recorded here."** Nothing was written to it this session. |
| I3–I6 | ✅ N/A (no build cut) · I4/I5/I6 re-confirmed intact by `installer-safety-auditor` |
| I7 | ✅ Untouched — no poller edit. The `SDX55) echo "reversed"` arm at `:73` remains unreachable |
| I8 | ✅ No change to `qmanager_setup` |
| I9 | ✅ No change to `platform.sh` |
| I10 | ⚠ **AMENDED — see the health-check finding above.** Still no privilege/auth consumer, but the profile IS now observable in a UI-downloadable diagnostic bundle |
| I11 | ✅ `hw_profile.sh:144` still emits `community` for `RG501Q*` |
| I12 | ✅ Every RG501Q fact this session carries its probe command. **Everything unmeasurable was left `*unverified*`, not inferred** |
| I13 | ✅ This file force-added — see the commit |

#### ▶ HOW TO RESUME — do these in order

1. **Confirm ADB is back on the RG501Q.** The user is restoring it via `AT+QCFG="usbcfg",...` themselves. Verify with `adb devices -l`; the serial should be `b7e3d6f1` and the USB PID should return to `0x0801`.
2. ~~Capture the RM520N-GL "before" baseline~~ — ✅ **DONE 2026-08-25 08:32–08:36.** See the baseline section above. G2 passed, `platform.json` absent, `jq`/`tr` censused, Q8 mostly discharged. **This no longer blocks anything.**
3. **Build T2** against the 10 constraints above — NOT against the plan's Steps as written. `EnterWorktree` from `development` (verify `git merge-base HEAD development == git rev-parse HEAD`), copy `.env` in, skip `bun install` (backend-only change). **Carry the item-6 correction into the gate: `hw_profile.sh` is present-and-dormant on the device, not absent.**
4. **Do NOT run the installer on the RM520N-GL to prove anything.** It is read-only for this entire phase and is the baseline the gate is measured against. The `tr`/JSON proof (Q8) needs a small scratch probe writing to `/tmp`, not an install.

#### What a later task might invalidate

- **The RM520N-GL baseline is uncaptured.** Every gate claim in T2's eventual commit depends on it. Do not accept a T2 commit whose `Gate:` line was written without it.
- **The RG501Q census is entirely `*unverified*`.** Any task that needs to know whether `jq`/`opkg`/`/opt` survived the reset must probe, not assume — and the pre-reset rows below are void.
- **T3 inherits the corrected placement reasoning.** `qmanager_setup` self-heal must not repeat the missing-parent assumption; it runs at boot when `/etc/qmanager` may or may not exist.
- **If ADB does not come back**, the COM-port AT transport is the only channel to that device, and it cannot read the filesystem — only the modem's own AT surface.

---

### 2026-08-24 — T1 DONE. `hw_profile.sh` exists; the dead detector is gone.

**Done and MERGED.** All 8 steps. Branch `feat/phase-a-t1-hw-profile`, cut from `development` at base SHA `c991b642a161d7245cab3fc9f259f7392de1cc51`. **Diffed against that SHA throughout, never against `development`** — a parallel session was advancing the branch with band-locking / locale work the whole time.

**Merge:** fast-forwarded onto `development` 2026-08-24 (`c991b64..55d3b60`), plus `d626517` for the agent memory. `development` had not moved from the base, so no merge commit was needed and nothing was rebased. The parallel session's uncommitted band-locking / locale files were disjoint from all five files this task touched and were left untouched in the working tree. **The branch ref `feat/phase-a-t1-hw-profile` was kept; its worktree was removed.**

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

