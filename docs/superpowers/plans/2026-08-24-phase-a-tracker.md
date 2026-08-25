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
| T1 | `hw_profile.sh` — parser, tier table, generator | **DONE (merged)** — all 8 steps. Both validators clean. | `581123e`, `3436ea3`, `55d3b60`, `d626517` — fast-forwarded onto `development` 2026-08-24 | 2026-08-24 |
| T2 | Generate `platform.json` at install; recognize RG501Q | **IN PROGRESS — Phase 1 recon COMPLETE, build NOT started.** 4 agents reported. Gate = CONDITIONAL, 7 constraints, 0 blockers. **The plan's prescribed placement is WRONG — see the 2026-08-25 entry.** ✅ **RM520N-GL "before" baseline CAPTURED and clean — nothing blocks the build.** Resume at step 3 | — | 2026-08-25 |
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
| `/etc/qmanager` mode | `drwxr-xr-x www-data:www-data` (RM520N) vs `drwxrwxrwx www-data:www-data` (RG501Q) | both | `ls -la /etc/qmanager/` — ⚠ **RG501Q half VOID (2026-08-25 reset): the directory does not exist.** This is exactly the missing-parent case that breaks the plan's T2 placement |
| `platform.json` | **absent on both** | both | `ls -la /etc/qmanager/platform.json` — ⚠ **the RG501Q is now a missing-DIRECTORY fixture, not a missing-FILE one.** Different code path in `qm_hw_write_profile` (`return 1`, not "writes a fresh profile") |
| ~~RG501Q `/dev/smd11` has a **second, non-cooperating holder**~~ | ~~`simpleadmin-go` pid 759~~ | RG501Q | ⚠ **VOID — 2026-08-25 factory reset removed SimpleAdmin Go.** The modem answered AT cleanly with no contention. The "do not issue AT commands on that device" constraint is retired; **Q5 is unblocked.** Not proof the binary is gone from the filesystem — that is `*unverified*` |
| ~~RG501Q poller is **not inert**~~ | ~~caught in flight, pid 2107~~ | RG501Q | ⚠ **VOID — no QManager on the device at all after the reset** |
| ~~RG501Q `atcli_smd11` + `qcmd` present and executable, Jun 22 2026~~ | — | RG501Q | ⚠ **VOID and unverifiable.** Those were almost certainly artifacts of the previous owner's install, not stock firmware. **Do not carry this forward in either direction** — it already contradicted `rg501q-bringup.md:271` ("`qcmd` does not exist without a working install") |
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

### 2026-08-25 — measured during T2 recon

| Fact | Value | Device | Probe |
| --- | --- | --- | --- |
| **A THIRD TRANSPORT EXISTS and is in none of our docs** | The Quectel USB **AT port enumerated on the Windows host as a COM port** reaches the modem independently of SSH and adb. It is why the RG501Q looked dead when it was in fact answering | both (host-side) | `Get-PnpDevice -Status OK \| Where-Object { $_.FriendlyName -match 'Quectel' }` — **the `-Status OK` filter is mandatory**, stale entries otherwise masquerade as live |
| Mapping a COM port back to a specific device | PnP parent lookup: `(Get-PnpDeviceProperty -InstanceId '<MI_02 instance>' -KeyName 'DEVPKEY_Device_Parent').Data` → `USB\VID_2C7C&PID_0800\b7e3d6f1` | host | as shown |
| RG501Q-EU live identity | `ATI` → `Quectel` / `RG501Q-EU` / `Revision: RG501QEUAAR12A11M4G` · `AT+CGMM` → `RG501Q-EU` · `AT+CGSN` → `863436050940776` | RG501Q | `ATI` / `AT+CGMM` / `AT+CGSN` over COM24, read-only |
| RG501Q USB composition **after** the factory reset | `+QCFG: "usbcfg",0x2C7C,0x0800,1,1,1,1,1,0,0` — **no ADB interface** | RG501Q | `AT+QCFG="usbcfg"` (read form) |
| The adb-loss signature of an RG501Q factory reset | PID `0x0801` → `0x0800`; the `MI_06 ADB Interface` present before, absent after, same serial | RG501Q | live vs. stale PnP entries for serial `B7E3D6F1` |
| ⚠ **The COM-port transport does NOT pass through QManager's `flock`** | It is a direct modem channel. Harmless on the RG501Q today (nothing else running), but **it must never be used casually on a device with a live poller** — it is a second, non-cooperating holder, the very thing SimpleAdmin Go was | both | by construction |
| `qcmd_test:50` and `:75` vs **real RG501Q bytes** | both **`pass`** — `:50` matches `Quectel\|OK`; `:75` matches on `RG501Q-EU` (`^RG` branch) *and* independently on `863436050940776` (15-digit branch) | RG501Q | greps replayed against the verbatim §1c capture |
| `qcmd_test:50` hardcodes `/usr/bin/atcli_smd11` | So it will **not** exercise a binary staged at `/tmp/atcli_smd11` | — | source read |
| `dependencies/atcli_smd11` (for any future staging) | size **661616**, md5 **`2987e3d68af0ed0f363ad98d5f1c40b5`**, `ELF 32-bit LSB, ARM EABI5, statically linked, stripped` | repo | `md5sum` + `file` |
| RM520N-GL reachability, this session | **Unreachable — physically disconnected.** Host at APIPA `169.254.95.110` (no DHCP lease), no host interface on the modem's subnet, `arp -a` showing **zero dynamic neighbours**, 22/80/443 closed. User confirmed and has reconnected it | RM520N | `Test-NetConnection`, `Get-NetIPAddress`, `arp -a` |
| ⚠ The Posh-SSH failure mode **changed** | 2026-08-24 it was `Key exchange negotiation failed` (a cmdlet-wrapper defect). 2026-08-25 the SSH.NET path failed with a plain **connection timeout** — a dead network path, not the tooling bug. **Anyone following the documented workaround will see a different error and may misdiagnose it** | RM520N | `SshOperationTimeoutException` after 20 000 ms |

### Still `*unverified*` on RG501Q-EU

⚠ **The 2026-08-25 factory reset voided most of what was previously known and the device currently has NO SHELL TRANSPORT, so nothing filesystem-level is measurable.** Every item below needs adb (or another shell) restored first:

- **The entire fresh-state census:** presence of `jq`, `opkg`, `/opt`, `lighttpd`, `bash`, `curl`/`wget`; whether `atcli_smd11` / `qcmd` survived; any leftover QManager artifacts under `/etc/qmanager`, `/usrdata/qmanager`, `/usr/lib/qmanager`, `/lib/systemd/system`.
- **Platform basics:** `/proc/cmdline` `ro` status, `/proc/mounts` volume backing for `/`, `/etc`, `/usrdata`, `/opt`; whether `/tmp` is `noexec`; whether `/etc/hostname` exists.
- **Whether the SDX55 runs our hard-float static ARM binary.** The COM-port probe made the `atcli_smd11` staging unnecessary, so the float-ABI question was never answered.
- Counter orientation on this firmware; the udev subsystem for `smd11`; whether the PRAIRIE boot-ordering deviation reproduces; the 1970 boot window and journald behavior (observed consistent, **not proven**).
- Whether the reset also wiped `/usrdata` — **unknowable without a shell, and it materially changes any install plan.**
- Network reachability for the `opkg update` that killed the previous install. Pre-reset the device had **no internet at all** (`rg501q-bringup.md:80-82`).

**Flagged as inference, NOT measurement:** the host showed a `Cellular 4` interface at `10.185.112.166/30` (a carrier-assigned address). That *may* mean the reset RG501Q came up in passthrough/bridge rather than router mode. Plausible from the /30 and the 10.x address — **not verified.**

---

## Open questions

### Resolved at the Phase 3 approval gate — 2026-08-24

| # | Question | **Decision** |
| --- | --- | --- |
| Q1 | Fold the `qcmd_test` `RM520` literals (`:50`, `:75`) into Phase A? **Measured:** both greps **PASS** on the RM520N-GL, and both `fail` branches fire only on *empty* output — `:50` also accepts `OK`, `:75` also accepts a 15-digit IMEI. The spec §6.1 claim that it "reports failure on a working device" is **false**. | **Ship it now, standalone — DONE.** Landed outside Phase A's task list. `:50` → `Quectel\|OK`; `:75` → `^(RM\|RG\|EG\|EC)[0-9A-Za-z-]+\|[0-9]{15}`, reusing `qmanager_health_check:354`. Banner strings de-branded. **`§6.1 obstacle 3 in the spec is now retired and was wrong as written` — do not re-plan it.** |
| Q2 | How do agents select a transport per device? | **Per-device prefixed env vars** — and **the RG501Q gets no credential entry at all**, because SSH has never been installed on it (no `ssh`/`sshd`/`dropbear`/`scp`/`sftp` in its stock image; adb is the only path). Prefix the triad for the RM520N-GL, keep the bare names working as an alias, reach the RG501Q by adb serial. Implemented in **T10 Step 6**. |
| Q3 | Does the RG501Q's failed v0.1.12 install stay frozen? | **WIPEABLE — a write to the RG501Q is APPROVED.** See the authorization block below. |
| Q4 | Sequencing against Phase D. | **Phase A first** (this plan). D is not abandoned — it remains blocked on §9.4 Q1–Q3, which only the device owner can answer. |
| Q5 | Authorize a read-only AT probe (`ATI`, `AT+CGMM`) on the RG501Q? | ~~Not asked / not needed~~ → **RESOLVED 2026-08-25. Authorized, run, and the fact is now MEASURED.** The blocker (SimpleAdmin Go on `/dev/smd11`) is gone with the reset. Captured over the **host COM port**, not adb: `ATI` → `Quectel / RG501Q-EU / Revision: RG501QEUAAR12A11M4G`; `AT+CGMM` → `RG501Q-EU`; `AT+CGSN` → `863436050940776`. **No longer `*unverified*`.** These bytes also validated `qcmd_test:50` and `:75` against real RG501Q output for the first time — both `pass`, redundantly (the model line hits the `^RG` branch, the IMEI independently hits the 15-digit branch). |

### ⚠ Device write authorization — RG501Q-EU only

**Approved by the user, 2026-08-24, at the Phase 3 gate.** The RG501Q-EU's previous owner's failed v0.1.12 install **may be wiped**. Its evidence is already recorded in [`rg501q-bringup.md`](../../reference/rg501q-bringup.md).

**Scope and limits:**
- This authorizes wiping **the RG501Q-EU only** (adb serial `b7e3d6f1`). **It authorizes nothing on the RM520N-GL**, which remains strictly read-only.
- **No task in this plan requires a wipe.** Do not perform one as a side effect of testing. If you wipe, record the date and the exact command here — it retires the live missing-profile fixture for every later task.
- Standing invariant I2 changes meaning accordingly: "do not make it harder to recover" no longer applies to a deliberate, recorded wipe. It still applies to accidental damage.

**Wipe log:**

| Date | What | By whom | Command / method |
| --- | --- | --- | --- |
| 2026-08-24 | *(nothing — T1's only RG501Q access was a read-only `od -c` / `base64` of `/etc/quectel-project-version` over adb)* | — | — |
| **2026-08-25** | **FACTORY RESET of the RG501Q-EU.** Removed the pre-installed `simpleadmin-go` AND the previous owner's failed v0.1.12 QManager install. Device is now stock-fresh | **the user, directly** — not by any agent | Device-level factory reset (exact method not recorded by an agent). **Side effect the user did not intend: the USB composition reverted to stock, PID `0x0801` → `0x0800`, and the `MI_06 ADB Interface` vanished — costing all shell access to the device** |

**Consequences of the 2026-08-25 reset, in one place:**
- The **live missing-`platform.json` fixture is retired** and replaced by something stricter — a missing `/etc/qmanager` *directory*.
- The failed-v0.1.12-install evidence now survives **only** in [`rg501q-bringup.md`](../../reference/rg501q-bringup.md). Do not delete that file.
- **I2 is vacuous as written** — there is no broken install to protect. The risk inverted: this is now the project's only clean-slate device. See the 2026-08-25 log entry's invariant table for the proposed rewording.
- **No agent wrote anything to either device on 2026-08-25.** The reset was the user's own action, recorded here per this section's rule.

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
