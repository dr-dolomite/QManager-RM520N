# Phase A Tracker — Multi-Target Platform Profile

> **This file is the record of what has HAPPENED.** The plan's checkboxes say what a task *involves*; only this tracker says what is *done*. **If the plan and this tracker disagree about state, the tracker wins.**
>
> ✅ **CORRECTED 2026-08-25 — `/docs/superpowers` is NO LONGER gitignored.** A plain `git add` works here now; **`git add -f` is no longer needed** (it still works, so old instructions are stale rather than harmful). The rule was removed because force-adding is a silent-failure path — `git status` never warns that a file is untracked, so documents were being force-added one at a time while their siblings quietly went missing. 46 previously-invisible files became visible when the rule came out.
>
> Scanned before un-ignoring: **no credentials.** The only hits were placeholder fixtures (a payload-less JWT header, `"app_password": "secret"`), and `MODEM_SSH_PASSWORD` appears only ever as a variable *name*. **This directory is public — keep it that way.**

**Plan:** [`2026-08-24-phase-a-multi-target-platform.md`](./2026-08-24-phase-a-multi-target-platform.md)
**Spec:** [`../specs/2026-08-23-multi-target-modem-support-design.md`](../specs/2026-08-23-multi-target-modem-support-design.md) — **§9 overrides §6.** Sections 1–8 predate adb access to the RG501Q; where §9, this tracker, or [`rg501q-bringup.md`](../../reference/rg501q-bringup.md) contradict them, **the measurement wins and you say so out loud.**
**Prior phase:** A0 — merged `f827b3c`, plan at [`2026-08-23-phase-a0-context-scoping.md`](./2026-08-23-phase-a0-context-scoping.md)
**Log archive:** [`2026-08-24-phase-a-log-archive.md`](./2026-08-24-phase-a-log-archive.md) — the T0–T2.6 narrative. **Not required reading**; everything still load-bearing was distilled into *Carried forward* below.

> **Keep this file short.** It was 872 lines on 2026-08-25 — too large to read in one call, so orienting on it cost two reads before any work started, and it had silently drifted (it claimed 14 test harnesses; there were 17). A tracker that expensive to read is also expensive to keep true.
>
> **The rule (`change-workflow.md` > Recording): a line earns its place here only if a FUTURE task needs it** — an open item, an invalidation warning, a "do not re-do" note. Mechanism, evidence and post-mortems go in the **commit body**, where git stores them attached to the diff at zero cost until someone asks.

---

## Status

| Task | Title | State | Branch / commit | Session |
| --- | --- | --- | --- | --- |
| T0 | Commit the Phase-A input documents | **DONE (merged)** — all 5 steps. Every input doc is tracked on `development`. | `3c34c4a`, `73cc424`, `fc30a50` | 2026-08-24 |
| T1 | `hw_profile.sh` — parser, tier table, generator | **DONE (merged)** — all 8 steps. Both validators clean. | `581123e`, `3436ea3`, `55d3b60`, `d626517` — fast-forwarded onto `development` 2026-08-24 | 2026-08-24 |
| T2 | Generate `platform.json` at install; recognize RG501Q | **DONE (merged).** Built against the 10 constraints, not the plan's Steps. Both validators clean. **Q8 fully discharged on live hardware.** | `19f2ee9`, `76a0ea8`, `6bd70d4` — fast-forwarded onto `development` 2026-08-25 (`9998107..6bd70d4`) | 2026-08-25 |
| **T2.5** | **Entware bootstrap fix — unplanned, slotted ahead of T3** | **DONE (merged).** User-reported from a real RG501Q install. Both validators PASS. Verified on both devices; RM520N-GL confirmed no-op. | `219f3e6`, `b4fb265`, `947d925`, `03bd426` — fast-forwarded onto `development` 2026-08-25 (`87b6f79..03bd426`) | 2026-08-25 |
| **T2.6** | **BusyBox `timeout` portability — unplanned, follows T2.5** | **DONE (merged).** `qm_timeout` wrapper + 21-assertion harness, behaviour detector, `:221` laundering fix, dead `getent` branch removed, 3 reference docs. Validator SAFE TO SHIP. **Both probe branches observed live on the same device** (legacy before `coreutils-timeout` landed, positional after); RM520N-GL read-only throughout. | `26f5c31`, `ae9ae7c`, `e818a23`, `2d275d6`, `95a6d1e` — merged into `development` 2026-08-25 (`9a92081`, a real merge: `development` had moved) | 2026-08-25 |
| T3 | Self-heal `platform.json` in `qmanager_setup` | **DONE (merged).** Both validators SAFE TO SHIP. Shipped as **two** commits: the self-heal, plus a symlink-hardening fix it made urgent (see C9). Deviates from the plan on one point by decision at the gate: a **higher** on-disk schema regenerates too, not just a lower one (C10). Four symlink assertions cannot run on Windows and were **executed against both live devices instead** — all four attack shapes refused on both. | `e079004`, `581a861`, `91fed57` — **cherry-picked** onto `development` 2026-08-26 (`development` had been rebased; `9288a44` is no longer on it — see C12) | 2026-08-26 |
| **T3.5** | **Installer/uninstaller lockstep — unplanned, follows T3** | **DONE (branch kept).** Two harnesses committed red, then two fixes: the uninstaller now calls `qmanager_dpi_run --clear` (a live REDIRECT rule survived uninstall — LAN web outage), and `SUDOERS_DIR` is created with `install -d -o root -g root -m 0750` instead of bare `mkdir -p`. `installer-safety-auditor` CLEAR (10/10); `busybox-portability-checker` all PASS, `install -d -o -g -m` behaviourally confirmed on BOTH devices. Open items → F15, F16. | `f3f0c43`, `a7ee043`, `baca73b` — branch `worktree-wt-dpi-teardown-lockstep` | 2026-08-26 |
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

> **T3 is done, so the cut line is now the next thing on the board.** What T4 inherits:
> - **A profile that maintains itself.** Both devices converge on their own from the next boot — the RM520N-GL by writing its first profile, the RG501Q by correctly leaving its existing one alone. T4 can assume a current profile exists rather than writing defensive "what if it is stale" code.
> - **`QM_HW_SCHEMA` is now a working migration lever** (C10). Adding a field for T4 to read means bumping it and letting the fleet regenerate; there is no longer any need for a bespoke migration step.
> - **The profile is still ADVISORY and still has zero readers.** T4 is what changes that, so it is also the task where invariant I10 stops being free — and note I10 is worded for *reads* only. C9 shows the write side was the exposed one. **Re-read I10 as a read+write invariant before wiring the first consumer.**
> - **A parse contract worth reusing rather than reinventing:** `platform.json` is line-oriented, one key per line, and the boot-time reader is a line matcher, not a JSON parser. The poller has `jq`; `qmanager_setup` does not. If T4 reads the profile from a `jq`-less context, use `_qm_hw_read_schema` / `_qm_hw_read_fw_fingerprint` rather than writing a third extractor — and if it changes `_qm_hw_json_escape`, the hostile-fixture round-trip assertion in `scripts/test/hw-profile.sh` is what stops that silently rewriting every fielded device on every boot.

---

## Carried forward from completed tasks

Distilled from T0–T2.6. These are the only parts of the merged narrative a *future* task still needs; the reasoning behind each lives in the [log archive](./2026-08-24-phase-a-log-archive.md) and in the commit that landed it.

| # | Carried-forward fact | Bites which task |
| --- | --- | --- |
| C1 | **T3 masks every one of T2's failure modes.** `start_services()` runs `systemctl restart qmanager-setup` on every install, so once T3 self-heals the profile it regenerates an absent `platform.json` seconds after preflight — on the standard path *and* every OTA. **After T3, `scripts/test/installer-platform-json.sh` is the ONLY observer of T2's correctness. Do not delete or weaken it.** | T3 |
| C2 | **The caller owns `install -d -m 0755`, not the generator.** `qm_hw_write_profile` deliberately refuses to create its own parent and returns 1 with no side effect. Under `set -e` an unguarded call aborts the caller — always `qm_hw_write_profile "$dest" \|\| warn …`. (Q6) | T3 |
| C3 | ~~**T3 is the first thing to source a library into `qmanager_setup`.**~~ **WRONG — refuted 2026-08-26 during T3.** `qmanager_setup` already sourced `config.sh` (whose guard is the unsafe `[ -n "$_CONFIG_LOADED" ]` form) long before T3; T3 is the **second** library it loads, and the safe one. The surviving true part: only `hw_profile.sh` and `platform.sh` use the `set -u`-safe `${…:-}` guard, so sourcing anything else into a `set -u` shell would still die. **The stronger consequence, and the reason this row stays:** nobody may "harden" `qmanager_setup` with `set -eu` on the strength of T3's guards — `config.sh:6` would kill the boot. Q6/Q9 were never live at this call site either; `qmanager_setup` sets neither `-e` nor `-u`. | anyone touching `qmanager_setup` |
| C4 | **Two tier tables exist and nothing tests that they agree.** `install_rm520n.sh`'s model `case` and `hw_profile.sh`'s `qm_hw_tier()` are keyed off **two different parsers**, and they already disagree on a non-Quectel string (installer prompts via `*`; library reports `unknown` → `fallback`). Cheapest fix: assert both enumerate the same glob set in `scripts/test/hw-profile.sh`. | T7 / T10 |
| C5 | **`run-all.sh` does not execute anything.** It `bash -n` syntax-checks and does a warn-only CRLF scan — so "PASS: 163 scripts" means *163 files parse*, not *163 files behave*. The functional runner is **`run-harnesses.sh`**. Cite the right one in gate evidence. | every task |
| C6 | **`installer-platform-json.sh` carries a negative control** reproducing the plan's original (broken) generator placement. **If that control ever starts passing**, either `qm_hw_write_profile` began creating its own parent — a real behaviour change to review — or the control has stopped testing anything. | T3+ |
| C7 | **The installer has no conventional test harness.** Its harnesses work by extracting shipped code by *anchor text*, so a reworded anchor silently stops testing the thing it names. Match against code, never comments. | any installer task |
| C8 | ~~`scripts/test/` ships to the device.~~ **FIXED 2026-08-25** — `build.sh` now skips `test` in the staging loop. The only repo reference to `scripts/test` outside the harnesses is a comment in `platform.sh:177`. | closed |
| C9 | **`/etc/qmanager` is www-data-owned, 0755 and NOT sticky — so `fs.protected_symlinks=1` does not protect anything written there by root.** That sysctl only engages in world-writable *sticky* directories. Any root helper that writes into that directory with a plain `>` can be redirected by a www-data-planted symlink; measured live on both devices, root's write landed in the attacker-chosen target. `[ -f ]` is not a guard (it follows the link) — use `[ -L ]`, and prefer `( set -C; … > "$tmp" )`, which gives `O_CREAT\|O_EXCL` and closes the check-then-write race. Verified honoured on BusyBox 1.31.1 **and** 1.29.3. `mv` onto a symlinked destination replaces the link rather than following it. **Fixed for `platform.json` only (`e079004`) — every other root writer into that directory is unaudited.** | any root helper writing to `/etc/qmanager` |
| C10 | **Self-heal regenerates on ANY schema mismatch, higher or lower** — a deliberate deviation from the plan's "absent or lower", decided at the T3 gate. `platform.json` is www-data-writable and the reader takes the FIRST matching line, so treating a higher number as "already migrated" would let one planted line freeze the profile permanently. **Consequence for T4+: bumping `QM_HW_SCHEMA` is now a working fleet-wide migration lever** — every device regenerates on its next boot, and the regen lands through `qm_hw_write_profile`'s unconditional `chmod 0644`. That is also the cheapest way to clean up the fielded world-writable profiles described in C11. | T4+, and any schema bump |
| C11 | **The generator's output mode used to follow the caller's umask, and fielded devices carry the result.** The live RG501Q's `platform.json` is **0666**, written by an installer shell at umask 0. `e079004` pins new writes to 0644, but self-heal compares **content only** — so a device whose profile already matches is never rewritten and keeps its old mode indefinitely. Cosmetic rather than exploitable (www-data owns the directory and can replace any file in it regardless of mode), so it was deliberately NOT given its own change; clean it up via a schema bump if ever wanted (C10). | T4+ |
| C12 | **`development` gets REBASED under you — the same content comes back with new SHAs.** During T3 it went from `9288a44` to a line where `9288a44` is not an ancestor at all; 14 commits (T2.6, F8, tracker/docs work) were absent by SHA while every one of their changes was present by content. A `git merge` therefore raised conflicts in files the branch never touched. **Check `git merge-base --is-ancestor <your-base> development` before merging; if it fails, verify the work survives by CONTENT and cherry-pick rather than merge.** Also: the git stash stack is shared across worktrees, so never `git stash` here — commit instead. | every worktree task |

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
| `/etc/qmanager` mode | `drwxr-xr-x www-data:www-data` on **both** | both | `ls -la /etc/qmanager/` — ⚠ the "RG501Q directory does not exist" note is **VOID (2026-08-25 later)**: it exists, recreated by `qmanager-setup` each boot, and is now `drwxr-xr-x` (the old `drwxrwxrwx` went with the wiped volume) |
| ~~`platform.json` — **absent on both**~~ | ⚠ **SUPERSEDED 2026-08-26**: present on the RG501Q, still absent on the RM520N-GL. See the 2026-08-26 table | both | `ls -la /etc/qmanager/platform.json` — the "RG501Q is a missing-DIRECTORY fixture" note remains **VOID**. No device we own exercises `qm_hw_write_profile`'s missing-parent `return 1` path; **the harness's negative control covers it instead** |
| ~~RG501Q `/dev/smd11` has a **second, non-cooperating holder**~~ | ~~`simpleadmin-go` pid 759~~ | RG501Q | ⚠ **VOID — 2026-08-25 factory reset removed SimpleAdmin Go.** The modem answered AT cleanly with no contention. The "do not issue AT commands on that device" constraint is retired; **Q5 is unblocked.** Not proof the binary is gone from the filesystem — that is `*unverified*` |
| RG501Q poller is **not inert** | caught in flight, pid 2107 | RG501Q | ~~⚠ VOID — no QManager on the device at all after the reset~~ → ✅ **REINSTATED 2026-08-25 (later).** The poller is running right now, pid 1694, alongside `qmanager_ping` pid 1484. The "no QManager after the reset" claim was wrong |
| RG501Q `atcli_smd11` + `qcmd` present and executable, Jun 22 2026 | both present, with `sms_tool` | RG501Q | ~~⚠ VOID and unverifiable~~ → ✅ **REINSTATED 2026-08-25 (later), measured over adb.** They live on the `ro` rootfs and survived the reset. **`rg501q-bringup.md:271` ("`qcmd` does not exist without a working install") is the statement that is wrong** — this device has a half-dead install, and its `/usr/bin` half is fully intact |
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

### 2026-08-25 (later) — 🛑 THE RG501Q IS **NOT** STOCK-FRESH. The previous entry is wrong.

**adb is back** (`adb devices -l` → `b7e3d6f1 device transport_id:1`, restored by the user via `AT+QCFG="usbcfg"`). The first thing it revealed is that **the "stock-fresh, no QManager" claim recorded earlier today is false.** All rows below measured 2026-08-25 01:13–01:19 UTC on a single boot (uptime 285 s → 618 s), read-only apart from one `/tmp` exec probe that was cleaned up.

**Why the earlier claim was wrong — the mechanism, because this will recur.** A Quectel factory reset wipes the **userdata volume only** (`/dev/ubi2_0`, which backs `/etc`, `/usrdata` **and** `/opt`). It does not touch the firmware image (`ubi0:rootfs`, mounted `ro`), and **QManager installs its binaries into `/usr/bin` and its units into `/lib/systemd/system` — both on the rootfs, specifically so they survive.** So the reset split the install in half rather than removing it.

| Fact | Value | Probe |
| --- | --- | --- |
| **QManager is INSTALLED AND RUNNING** | `qmanager_ping` pid 1484, `qmanager_poller` pid 1694 | `ps w` |
| Binaries survived | **25** `qmanager_*` in `/usr/bin`, all `Jun 22 12:16` | `ls /usr/bin \| grep -c qmanager` |
| Units survived | **13** in `/lib/systemd/system`, with start symlinks in `/lib/systemd/system/multi-user.target.wants/` | `ls /lib/systemd/system \| grep -c qmanager` |
| ⚠ `systemctl is-enabled` **LIES here** | reports `disabled` for poller/ping/setup, yet all start at boot — the install symlinks live under `/lib`, not `/etc/systemd/system`, so systemd's enablement view does not see them. **This is QManager's own ro-rootfs persistence trick; do not read `disabled` as "will not start."** | `systemctl is-enabled` vs the wants-dir listing |
| ~~`atcli_smd11` / `qcmd` are previous-owner artifacts~~ | ⚠ **VOID — both are PRESENT**, with `sms_tool`, all `Jun 22 12:16`. The 2026-08-24 row voiding these was itself wrong, and it contradicted `rg501q-bringup.md:271` | `ls /usr/bin` |
| ~~`/etc/qmanager` does not exist (missing-DIRECTORY fixture)~~ | ⚠ **VOID — it EXISTS**, `drwxr-xr-x www-data:www-data`, recreated `Aug 25 00:08` by `qmanager-setup` at boot, holding only `.modem_crash_count_last` + `last_iccid`. **The missing-directory fixture is retired; the device recreates it every boot.** | `ls -la /etc/qmanager` |
| `/etc/qmanager/VERSION` | **absent** — the config wipe took it | `cat` |
| **`platform.json`** | **ABSENT** | `ls -la` — ✅ the invariant that matters still holds |
| ~~`hw_profile.sh` on device: **absent**~~ | ⚠ **VOID 2026-08-26 — it is PRESENT.** See the 2026-08-26 table | `ls -la /usr/lib/qmanager/` |
| ~~Entware is GONE~~ | ⚠ **VOID 2026-08-26 — the install SUCCEEDED.** `/opt/bin/jq` is back. See the 2026-08-26 table | `command -v` |
| Stock firmware DOES provide | `/bin/bash`, `/usr/bin/curl` (7.61.0, GnuTLS 3.6.4), `/usr/bin/tr`, `/usr/sbin/lighttpd`, `/bin/sh` | `command -v` |
| The half-dead symptom | `/usrdata/qmanager/data_used.json.tmp` is **0 bytes** — the poller dies mid-write, almost certainly for want of `jq` | `ls -la /usrdata/qmanager` |
| **rootfs boots `ro` on SDX55 too** | `/proc/cmdline` carries `ro`, `root=ubi0:rootfs`, `rootfstype=ubifs` | `cat /proc/cmdline` |
| `/etc`, `/usrdata`, `/opt` volume backing | all `/dev/ubi2_0` `rw` — **same contract as the RM520N-GL** | `grep /proc/mounts` |
| `/tmp` is tmpfs and **exec-capable** | `EXEC_OK` from a chmod +x script — **the `atcli_smd11` staging plan is viable** | write/chmod/run/remove in `/tmp` |
| adb shell runs as **root** | `uid=0(root)` | `id` |
| `/dev/smd11` | `crw------- root root` — **no udev rule applied** (QManager's rule was wiped with `/etc`); the running poller as root is a live holder | `ls -la /dev/smd11` |
| ⚠ **`bridge0` is `192.168.225.1` — the SAME address as `MODEM_IP`** | The two devices collide if both are on the host's Ethernet at once. **Always prove device identity before recording a capture** (`cat /etc/quectel-project-version`, or `androidboot.serialno`: RM520N-GL `61368cd2`, RG501Q `b7e3d6f1`) | `ip route` |

#### RG501Q data path — online, but outbound TCP is reset

Not "no internet" as recorded on 2026-08-24. The device has a working bearer and DNS; **TCP payloads are killed upstream.**

| Probe | Result |
| --- | --- |
| default route | `default via 10.216.218.18 dev rmnet_data0`, `mtu 1500` |
| DNS | ✅ `nslookup github.com` → `20.205.243.166` (nameservers `10.151.151.44/.48`) |
| `ping 8.8.8.8` | 100% loss — **but ICMP is filtered on the RM520N path too, so this alone is not evidence** |
| TCP connect | ✅ **succeeds** — `1.1.1.1:443` connects in 88 ms |
| `http://example.com/` | ❌ `curl (56) Recv failure: Connection reset by peer` |
| `https://github.com` | ❌ `curl (35) gnutls_handshake() failed: Error in the pull function` |
| `http://neverssl.com/` | ❌ `curl (28) timed out at connect` |
| local firewall ruled out | `iptables` OUTPUT policy `ACCEPT`; the only `DROP`s are **inbound** 443/80 on `rmnet_data0` (0 packets); **no TTL mangle rule at all** |

**Consequence for any install attempt:** the installer dies at **`install_rm520n.sh:756`** — `dl_get "$ENTWARE_URL/opkg"` over plain HTTP → `die "Failed to download opkg"`. It never reaches the `opkg update || die` at `:773-774` that the 2026-08-25 recon predicted. `/opt` is empty and `wget` is gone, so there is no fallback downloader. **Note that failure lands AFTER `preflight`, so a doomed install would still write `platform.json` and leave it behind.**

**The user has been told and is attempting an install anyway** (their call, made with the failure mode stated). If it succeeds, **every RG501Q row above is superseded and the device must be re-baselined from scratch.**

### 2026-08-26 — measured during T3. **The RG501Q install SUCCEEDED; several rows above are now stale.**

Both devices answered **simultaneously** for the first time — the 2026-08-25 "dual access is expected but unconfirmed" caveat is discharged. Identity proven per capture (`androidboot.serialno`: RM520N-GL `61368cd2`, RG501Q `b7e3d6f1`).

| Fact | Value | Device | Probe |
| --- | --- | --- | --- |
| ⚠ **`platform.json` is NO LONGER absent on both** — supersedes the row at :103 | RG501Q: **present**, 173 bytes, `Aug 25 04:49`, LF-only, md5 `e480136d9d7d3c9f029f80124408af7c`, mode **0666** www-data. RM520N-GL: still **absent** | both | `ls -la` + `cat` |
| **T2's generator is confirmed correct on live community-tier hardware** | Byte-identical to `installer-platform-json.sh`'s expected fixture: `schema 1` / `RG501QEU_VD` / `SDX55` / `lga` / **`community`** / `RG501QEUAAR12A11M4G_04.202`. I11 holds in the field | RG501Q | `cat /etc/qmanager/platform.json` |
| ⚠ **"Entware is GONE" (:165) is VOID** — the install the user attempted **succeeded** | `/opt/bin/jq` present; QManager `v0.1.14-draft`; full `/etc/qmanager` config tree. The predicted `install_rm520n.sh:756` download failure did **not** end the story | RG501Q | `command -v jq`, `cat /etc/qmanager/VERSION` |
| ⚠ **"`hw_profile.sh` on device: absent" (:164) is VOID** | Present, `Aug 25 04:49`, same 10428 bytes as the RM520N-GL's copy | RG501Q | `ls -la /usr/lib/qmanager/` |
| **The live missing-file fixture is RETIRED** — exactly what plan Step 3 warned about | Only the RM520N-GL still lacks a profile. The two devices now happen to cover both arms: RM520N-GL exercises *regenerate*, RG501Q exercises *correctly no-op* | both | as above |
| ⚠ **`fs.protected_regular` DIVERGES between the devices** — `platform-matrix.md:203` listed the RG501Q as `*unverified*` | **1 on RM520N-GL, 0 on RG501Q.** So the whole cross-UID `/tmp` ownership contract in `tmp-file-ownership.md` (root being the party blocked) **does not engage at all on the RG501Q**. Harmless today — the `root:root 0666` seeding is merely redundant there — but any future code that *relies* on that block behaves differently per device | both | `cat /proc/sys/fs/protected_regular` |
| `fs.protected_symlinks` | **1 on both** — and irrelevant to `/etc/qmanager`, which is not sticky (C9) | both | `cat /proc/sys/fs/protected_symlinks` |
| BusyBox BRE support is **identical** across both generations | `[[:space:]]`, `\(…\)`, `\{0,1\}` all behave the same; `\r` falls inside `[[:space:]]`, so CRLF input is absorbed. `set -C` refuses live **and** dangling symlinks on both | both | direct probe, 1.31.1 vs 1.29.3 |
| Hostnames | RM520N-GL `sdxlemur`, RG501Q **`sdxprairie`** | both | `cat /etc/hostname` |

### Still `*unverified*` on RG501Q-EU

> ## ✅ 2026-08-25 (latest) — THE RG501Q IS NOW REACHABLE OVER SSH, AND BOTH DEVICES ARE UP AT ONCE
>
> The user changed the RG501Q's LAN gateway to **`192.168.120.1`** (mechanism in [`lan-gateway-ip.md`](../../reference/lan-gateway-ip.md)) and SSH now answers there with the **same user and password as the RM520N-GL**. Added to `.env` as `RG501Q_IP` / `RG501Q_SSH_USER` / `RG501Q_SSH_PASSWORD`, with `RM520N_*` added alongside and the bare `MODEM_*` triad kept as an RM520N-GL alias.
>
> **Verified live, identity proven:** `RG501QEU_VD` / `SDX55` / serial `b7e3d6f1` / BusyBox 1.29.3 / QManager `v0.1.14-draft` installed.
>
> **Three standing constraints are retired by this:**
> 1. **"adb is the only path to the RG501Q"** — obsolete. SSH exists because QManager's own installer supplies Entware `dropbear`; the T2.5 bootstrap fix is what created this transport.
> 2. **"Both devices answer on `192.168.225.1`, so they cannot share the host's Ethernet"** — the collision is gone, and **simultaneous reachability is now DEMONSTRATED**: both devices answered from the same host minutes apart on 2026-08-25, each with its identity proven from `/proc/cmdline` (`61368cd2` and `b7e3d6f1`). The earlier "host had only `192.168.120.34`, RM520N-GL offline" reading was a transient host-addressing state, not a standing limit. ⚠️ Still **check** reachability rather than assuming it: the host must hold an address on *both* subnets and does not do so automatically, and either device may be powered down.
> 3. **Q2's decision that "the RG501Q gets no credential entry at all"** (below) — its premise was that SSH had never been installed. It now has one.
>
> **Why this matters beyond convenience:** every cross-device defect found so far (`wget`, `timeout`, `mountpoint`) came from running a command on both devices and diffing, and **none came from an agent reading code**. While they collided on one address that comparison needed a cable swap — which is exactly why the divergences survived undetected until a second device existed. `change-workflow.md`'s *device-diff before agents* rule depends on this state holding.

✅ **adb is restored, and most of this list is now MEASURED** — see the 2026-08-25 (later) census above. The items below are what genuinely remains:

- **Whether the SDX55 runs our hard-float static ARM binary.** Never answered — the COM-port transport made the `atcli_smd11` staging unnecessary. **Now cheaply answerable:** `/tmp` is confirmed exec-capable, and `atcli_smd11` (md5 `2987e3d68af0ed0f363ad98d5f1c40b5`) can be pushed there and run. *Note the device already carries its own `/usr/bin/atcli_smd11` from the surviving install, so running THAT proves nothing about our repo binary.*
- **Counter orientation on this firmware** — the SDX55 `reversed` hypothesis (D2). Untestable while the poller cannot write (`data_used.json.tmp` is 0 bytes for want of `jq`).
- The udev subsystem for `smd11`; whether the PRAIRIE boot-ordering deviation reproduces; the 1970 boot window and journald behaviour (observed consistent, **not proven**).
- **Why outbound TCP is reset.** Established as upstream/carrier-side (local firewall ruled out), but the specific cause — plan restriction, captive portal, tethering DPI, MTU — is **`*unverified*`**.
- Whether `/etc/hostname` exists.

**RESOLVED from the old list, do not re-probe:** `jq`/`opkg`/`/opt`/`lighttpd`/`bash`/`curl`/`wget` presence · `atcli_smd11`/`qcmd` survival · leftover QManager artifacts in all four locations · `/proc/cmdline` `ro` · `/proc/mounts` volume backing · `/tmp` `noexec` · whether `/usrdata` was wiped (**it was** — recreated `Aug 25 00:08`) · network reachability (**online; TCP reset, not absent**).

**~~Flagged as inference:~~ the `Cellular 4` interface at `10.185.112.166/30` suggesting passthrough/bridge mode — now contradicted by measurement.** The device's own `bridge0` is `192.168.225.1/24` with `MASQUERADE` on `rmnet_data0` (`iptables -t nat`), i.e. **router mode, not passthrough.** The host's `Cellular 4` address came from somewhere else. Drop the inference.

---

## Open questions

### Resolved at the Phase 3 approval gate — 2026-08-24

| # | Question | **Decision** |
| --- | --- | --- |
| Q1 | Fold the `qcmd_test` `RM520` literals (`:50`, `:75`) into Phase A? **Measured:** both greps **PASS** on the RM520N-GL, and both `fail` branches fire only on *empty* output — `:50` also accepts `OK`, `:75` also accepts a 15-digit IMEI. The spec §6.1 claim that it "reports failure on a working device" is **false**. | **Ship it now, standalone — DONE.** Landed outside Phase A's task list. `:50` → `Quectel\|OK`; `:75` → `^(RM\|RG\|EG\|EC)[0-9A-Za-z-]+\|[0-9]{15}`, reusing `qmanager_health_check:354`. Banner strings de-branded. **`§6.1 obstacle 3 in the spec is now retired and was wrong as written` — do not re-plan it.** |
| Q2 | How do agents select a transport per device? | **RESOLVED and IMPLEMENTED 2026-08-25 — but not as originally decided.** The prefixed-env-var scheme stands and is now live in `.env` (`RM520N_*`, `RG501Q_*`, bare `MODEM_*` retained as the RM520N-GL alias). ~~The RG501Q gets no credential entry at all, because SSH has never been installed on it; reach it by adb serial.~~ **That premise is dead:** SSH now answers on `192.168.120.1` with the same user and password, supplied by Entware `dropbear` from QManager's own installer. **Both devices are SSH, no adb, no per-device transport branching** — which is simpler than the plan assumed. `CLAUDE.md`, both agent briefs, `platform-matrix.md` and `rg501q-bringup.md` are updated; **T10 Step 6 is therefore already done.** |
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

> ⚠ **CORRECTED 2026-08-25 (later), once adb returned.** The reset did NOT remove QManager. It wiped the userdata volume (`ubi2_0` → `/etc`, `/usrdata`, `/opt`) and left the `ro` rootfs untouched, so 25 binaries in `/usr/bin` and 13 units in `/lib/systemd/system` survived **and are still running.** It also removed SimpleAdmin Go and the whole Entware tree. **The bullets immediately below were written before that measurement; the first one is void.** See the "🛑 THE RG501Q IS NOT STOCK-FRESH" census above.

**Consequences of the 2026-08-25 reset, in one place:**
- ~~The **live missing-`platform.json` fixture is retired** and replaced by something stricter — a missing `/etc/qmanager` *directory*.~~ **VOID — `/etc/qmanager` exists and is recreated by `qmanager-setup` on every boot.** `platform.json` itself is still absent, so the missing-*file* fixture is intact; there is no missing-*directory* fixture on any device we own. **T2's corrected placement never depended on one** — it was derived from the installer's own ordering and is pinned by the harness's negative control instead.
- The failed-v0.1.12-install evidence now survives **only** in [`rg501q-bringup.md`](../../reference/rg501q-bringup.md). Do not delete that file.
- **I2 is vacuous as written** — there is no broken install to protect. The risk inverted: this is now the project's only clean-slate device. See the 2026-08-25 log entry's invariant table for the proposed rewording.
- **No agent wrote anything to either device on 2026-08-25.** The reset was the user's own action, recorded here per this section's rule.

### Raised during T1 — must be honoured by T2/T3

| # | Question / constraint | Owner |
| --- | --- | --- |
| Q6 | **`qm_hw_write_profile` must be guarded at every call site.** It returns 1 legitimately; under the caller's `set -e` an unguarded direct call aborts the caller — confirmed live under `dash`. Write `qm_hw_write_profile "$dest" \|\| …`. | **T2 and T3, both** |
| Q7 | The plan's `install_rm520n.sh:1125` glob-install line is stale — it is **`:1095`**, and T1's deletion shifted everything below line 261 up by 30. Re-locate, do not trust plan line numbers. | T2 |
| Q8 | ~~`_qm_hw_json_escape`'s `tr -d '\000-\037'` has never executed on-device.~~ → ✅ **RESOLVED 2026-08-25.** The generator was run to a `/tmp` scratch path on the live RM520N-GL: `tr` behaved, the emitted JSON was read (not assumed), `od -c` proved LF-only with no stray control bytes, device `jq 1.7.1` validated it, and nothing was stranded. Full output in the T2 log entry. **Do not re-open.** | T2 — **DONE** |
| Q9 | Every existing `scripts/usr/lib/qmanager/*.sh` uses the `[ -n "$_X_LOADED" ]` load guard, which **dies under `set -u`**. `hw_profile.sh` was fixed; the others were not. Not a Phase A bug — nothing sources them that way today — but T3 puts `qmanager_setup` in the business of sourcing libraries. | unassigned / T10 note |

### Deferred to a later phase — recorded so they are not rediscovered

| # | Question | Owner |
| --- | --- | --- |
| D1 | **Rollback is left on the compatibility floor** (T9). Harmless in Phase A — the overlays are empty, so the floor build and the RG501Q build are identical. **From Phase C onward an RG501Q rolls back onto the RM520N build.** Older tags never published variant assets, so a variant-aware rollback would 404. | **Phase C blocker** |
| D2 | Activating the `SDX55 → reversed` orientation map. It is a hypothesis established on a *different model*, with a contradicting slow-path test on the same part. | Phase B |
| D3 | Promoting the RG501Q tier from `community` to `official`. | Phase C |
| D4 | `qmanager-setup.service` declares **no `After=` at all**; `lighttpd.service` is `After=network.target opt.mount`; `qmanager-auto-update.service` is `After=network-online.target`. Phase A works around this with per-consumer fallbacks. Whether the units should be *ordered* properly is a separate change. | unassigned |
| D5 | `data_used.json.orientation` is **write-only** — nothing reads it back and no CGI surfaces it, so an orientation regression has no HTTP-observable surface. | T10 fixes the doc; the design gap is unassigned |

### Tracked follow-ups from T2.5 — all four accepted as real work (user, 2026-08-25)

These were found during the Entware bootstrap fix and deliberately left out of its scope. They are **work items, not open questions** — the decision to do them has already been made; only the scheduling is open.

| # | Item | Why it matters | Where |
| --- | --- | --- | --- |
| F1 | **The curl twin of the bug just fixed.** `install_rm520n.sh:1048` still guards `ln -sf /opt/bin/curl /usr/bin/curl` with `! command -v curl`, evaluated while PATH still carries `/opt/bin` from the shim block. | Structurally identical to the wget defect: the guard finds the Entware curl, concludes it is "already reachable", and skips the symlink. **Dormant only because both known devices ship a factory `/usr/bin/curl`.** A third device missing curl the way the RG501Q is missing wget hits this immediately. Fix is the same one-liner: test `[ ! -e /usr/bin/curl ]` instead. | `install_rm520n.sh:1048` |
| F2 | **A jq-less device cannot report its own errors.** `cgi_base.sh:108,118,123,174,176` — `cgi_error` and `cgi_ok` are *themselves* `jq -n` calls, and 109 files reference `jq` essentially unguarded. | All 81 CGI endpoints return **empty bodies** with no diagnosable error, which is why a broken bootstrap presents as a totally mute web UI rather than a failure anyone can trace. The error reporter depends on the thing that is missing. Fixing the bootstrap fixes it in practice; the fragility is untouched. Minimum viable fix: a jq-free fallback inside `cgi_error` only. | `scripts/usr/lib/qmanager/cgi_base.sh` |
| F3 | **PARTIALLY RESOLVED 2026-08-25 — 3 of 4 fixed; the suite is NOT green.** **First, a property of the runner that hid all of this: `run-harnesses.sh` halts at the first failing harness**, so the suite can only ever report ONE failure. "The suite has one failure" was never a true statement — each fix unmasks the next, and there is no way to see the depth of the queue without clearing it. **The finding is the PATTERN, not the instances.** Every failure was the same thing: **a harness encoding a poller contract that was refactored out from under it.** In all three the harness was wrong and the poller was right, and each fix unmasked the next — nothing surfaces until the one above it is cleared, so "the suite has one failure" was never true. ① `prev_traffic_ts` — assertion left behind when Live Traffic was deleted; removed. ② `check_email_alert` / `check_sms_alert` — replaced by unified `check_alerts` in `alert_engine.sh`; both sections **deleted by user decision**, see the coverage gap below. ③ `poller-phase-bcd.sh` / `read_sim_state` — SIM-swap truth moved from the `/tmp` flag to `SIM_REGISTRY_FILE` on 2026-07-27; fixture only set the old flag, so it tested the pre-migration contract. Fixed properly: added a registry fixture + `boot_iccid`, shimmed `sim_db_normalize` (called by the function but defined outside it, so the awk extraction cannot carry it), and raised the jq bound 2→3 because the invariant is *one call per file* and a third file was added. **⚠ ACCEPTED COVERAGE GAP: nothing now tests that alert dispatch is non-blocking** — a synchronous send would stall every poll cycle behind an SMTP/`sms_tool` timeout. Re-establish against `check_alerts` when alerting is next touched. **④ STILL RED — `qmanager-ping-smoke.sh`**, and it is a different shape: not a stale contract but an **environment** mismatch. Its header says to run it "on a dev machine (WSL2/Linux) or on a device"; this workstation is **Git Bash for Windows**. It runs the real ICMP daemon against the production `/tmp/qmanager_ping.json` path, and Windows `ping` takes different flags and prints different output, so the daemon never writes the file. **Its guard at `:21` is `command -v ping` — which passes on Windows, because a `ping` exists there. That is the SAME defect class this session documented three times over: a presence check that cannot tell "a thing named X" from "an X that behaves as required."** The harness suite contains the bug the workflow doc now warns about, inside its own guard. Fix is a behaviour probe (or an explicit non-Linux SKIP), not a chase. **⚠ Assume more harnesses lag the poller** — three of three poller-harness failures were stale contracts, and the runner reveals them one at a time. | *(original entry follows)* |
| ~~F3~~ | ~~**`poller-phase-a.sh` is RED on `development` — and it is a QUEUE of stale assertions, not one bug.**~~ Diagnosed 2026-08-25. **The harness is testing a poller architecture that was refactored out from under it**; in every case the harness is wrong and the poller is right. ① `prev_traffic_ts` — **FIXED**: removed with the Live Traffic feature; the harness's own adjacent NOTE documents that deletion, and the companion assertion was simply left behind. ② `check_email_alert` / `check_sms_alert` — **STILL RED**: both were replaced by a unified `check_alerts` in `alert_engine.sh` (`qmanager_poller:380-381` and `alert_engine.sh:465-466` both say so explicitly). The runner calls an undefined function → **exit 127** → `set -eu` at `:7` kills the harness. | **Fixing ① unmasked ②** — same shape as a linter that bails at the first violation, so assume more remain behind ②. **Why it looked silent:** the runner's stderr is redirected into `$work/email_run.out`, a temp file cleaned up on exit, so the 127 died with no message and the tracker recorded only the *first* FAIL line as "the" defect. `bad()` does not exit — it increments a counter — so the harness always ran past ① into ②. **Open decision (user's call): delete the two stale sections** (suite goes green, loses non-blocking-dispatch coverage) **or rewrite them against `check_alerts`** (real work; needs `alert_engine.sh`'s contract). Until then `run-harnesses.sh` cannot serve as a gate. | `scripts/test/poller-phase-a.sh` — the `check_email_alert` section at `:225` and the `check_sms_alert` section following it |
| ~~F4~~ | ~~**RG501Q AT stack does not answer.**~~ **WRONG — retracted 2026-08-25, same day it was filed.** The AT stack on the RG501Q is **healthy**. The user ran `atcli_smd11 ATI` by hand and got a clean `Quectel / RG501Q-EU / Revision: … / OK`; `qcmd 'ATI'` exits 0, and the poller publishes live data (`modem_reachable: true`, `5G-NSA`, carrier present, `ca_active: true`). My framing — *"plausibly blocks every Phase A/B task that reads the modem"* — was wrong and would have sent the next session hunting a non-existent transport bug. **The real defect is F5 below**; `at_stack_check` never executed its own command. **Do not re-open this as a modem problem.** | Retracted — superseded by F5 | — |
| **F5** | **BusyBox `timeout` is mutually incompatible between the two devices, and the guard that should fix it can't see the difference.** BusyBox made `SECS` positional in 1.30 and dropped `-t`, so: RG501Q (v1.29.3) needs `timeout -t 8 CMD` and answers `timeout 2 echo hi` with `can't execute '2'` (**exit 127, zero output**); RM520N-GL (v1.31.1) needs `timeout 8 CMD` and answers `-t` with `invalid option -- 't'`. **No single literal invocation works on both.** Root cause of the root cause: `install_rm520n.sh:1056` guards the `coreutils-timeout` install with `command -v timeout`, which always succeeds because BusyBox ships the applet — so the Entware package is **never installed on either device**. Harmless on RM520N-GL (its BusyBox is already coreutils-compatible), fatal on RG501Q. | **This is the same bug shape as T2.5's wget symlink guard: a presence check that cannot distinguish "a thing named X" from "an X that behaves as required".** That makes three version-divergence defects in one session (missing `wget` applet, this, and the dormant curl twin in F1) — the pattern, not the instance, is the finding. Blast radius is bounded: 5 call sites, **none in `qcmd` or `qmanager_poller`**, which is why live modem data is unaffected. Correct detector is a behaviour probe: `timeout 1 true; echo $?` → 0 on RM520N-GL, 127 on RG501Q. | `install_rm520n.sh:1056,3107,3150`; `qmanager_health_check:221,491,493` — **being fixed now as T2.6** |
| **F6** | **`mountpoint` does not exist on the RG501Q at all**, and `install_rm520n.sh:610` uses it as a guard: `if ! mountpoint -q /usrdata 2>/dev/null; then warn …; return 0; fi`. Command-not-found returns **127**, `!` inverts it to true, so the installer concludes "/usrdata is not a mounted filesystem", warns, and returns **success**. The `2>/dev/null` swallows the `not found` message that would have given it away. The guard's premise is factually inverted on that device — `/usrdata` genuinely *is* its own mount (`/dev/ubi2_0 on /usrdata type ubifs`). | **`install_speedtest_cli()` is a guaranteed no-op on every RG501Q.** Worse than the missing binary: the comment at `:615-625` records that the `install -d -m 0755` immediately below the guard is the **remediation for world-writable `0777` directories left by older `mkdir -p` code**, and that its position before the idempotence guard is load-bearing — so an RG501Q can never be remediated out of a bad directory mode either. Third member of the same family as the wget and `timeout` defects: **a missing command's 127 read as a meaningful boolean.** Fix: compare device numbers (`stat -c %d /usrdata` vs `stat -c %d /`), which cannot confuse "command missing" with "false"; both `stat -c` forms are verified working on both devices. **Open first:** `/usrdata/root/bin/speedtest` exists on the test RG501Q (2.2 MB, dated Jul 28 2022, uid 10000) even though the installer path is impossible there — stock image or a manual push? It masks the symptom on this one device; a fresh RG501Q would have no Speedtest CLI. | `install_rm520n.sh`, the guard at the top of **`install_speedtest_cli()`** — filed 2026-08-25, deliberately excluded from T2.6. **Anchor on the function name, not a line number:** this guard was at `:610` when filed and moved to `:705` within the same session, because T2.6 added a local `qm_timeout` copy above it. |
| **F7** | **`t_perm_tmp_writable` in `qmanager_health_check` hangs forever on the RG501Q when the health check runs as `www-data`.** The test invokes `su -s /bin/sh -c ... www-data`, which stalls indefinitely when it is called *recursively from inside www-data itself* — which is exactly how the health check runs in production (`run.sh:44` launches it via `setsid sudo -n`). | **This blocks any full end-to-end run of the health check on that device**, so the Health Check page cannot complete. Found by the T2.6 Phase 5 validator while trying to exercise `t_net_dns` end-to-end — it had to extract and run the single test function instead, which is why T2.6's DNS evidence is function-level rather than page-level. Pre-existing and **untouched by T2.6** (that diff does not go near `t_perm_tmp_writable`). Not yet checked on the RM520N-GL — do that first, since it determines whether this is a portability defect or a universal one. | `scripts/usr/bin/qmanager_health_check` — `t_perm_tmp_writable`; filed 2026-08-25 |

| **F15** | **~11 pre-existing bare `mkdir -p` sites on persistent paths are UNASSESSED.** T3.5 fixed only `SUDOERS_DIR`. The rest are enumerated, already, by `scripts/test/installer-persistent-dir-modes.sh` **section [5]**, which prints them as INFORMATIONAL and deliberately does not assert them — so the census exists and does not need repeating; only the per-site judgement is owed. | Same defect shape as the one just fixed: `mkdir -p` honours the ambient umask and **no-ops on an existing directory**, so a bad mode reached once persists across every future OTA forever. Two are notable. `install_rm520n.sh:1833` (anchor on the string `locales-packs`, not the number) — `mkdir -p /usrdata/qmanager/locales-packs`, whose adjacent comment claims `install -d` self-heals it, but only the **next** line (`locales-staging`) actually does; the comment is wrong about the line it sits on. `qmanager_poller:648,722` — bare-recreates `/usrdata/qmanager` **itself**, the directory the installer hardens with `install -d -m 0755`, so a poller running under a bad umask can undo the installer's mode after the fact. Scoped out of T3.5 by choice. | `scripts/test/installer-persistent-dir-modes.sh` section [5] is the worklist; sites in `install_rm520n.sh` and `scripts/usr/bin/qmanager_poller` — filed 2026-08-26 |
| **F16** | **`DPI_RULE_SIG` is a literal, so changing `DPI_PORT` would STACK a second REDIRECT rather than replace the first.** `dpi_state.sh:71` hardcodes `"--to-ports 989"` instead of interpolating `$DPI_PORT`. Non-blocking design note from the T3.5 auditor — nothing is wrong today. | `dpi_rule_present()` greps for the literal, so after a port change it stops recognising the rule already installed under the old signature: the idempotence check misses, `dpi_apply_rule`'s `-D` drain loop matches the **new** spec and removes nothing, and the `-I` inserts a second rule. The LAN then has two REDIRECTs, the older one pointing at a dead port. **Bites whoever changes `DPI_PORT` or reshapes the rule** — change the signature with the port, and add a one-shot drain for the old spec. Documented in [`dpi.md`](../../reference/dpi.md) > Teardown. | `scripts/usr/lib/qmanager/dpi_state.sh` — `DPI_RULE_SIG` (`:71`) and `dpi_rule_present()` — filed 2026-08-26 |

**Census note (2026-08-25, T2.6 recon).** A full `busybox --list` diff plus a behaviour battery over every applet flag QManager actually passes found **no further dependency-bearing divergence** between BusyBox 1.29.3 (RG501Q) and 1.31.1 (RM520N-GL). Availability differs by exactly four applets: `wget` and `mountpoint` (both defects above) and `i2ctransfer` / `ts`, which have zero call sites. Every flag QManager passes behaves identically on both builds. The speculative candidates are all clear: `printf %q` fails on **both** devices, and `grep -P` / `find -newermt` / `sort -V` / `readlink -f` have **zero** call sites. **Do not re-run this census** — three defects came out of it and the surface is now known.

Two facts worth keeping, discovered in passing and not divergences at all:
- **`getent` is absent on BOTH devices.** `qmanager_health_check:491` is therefore unreachable dead code everywhere, and `:493` (`nslookup`) is the only live DNS path. The dead branch is removed in T2.6. A fix that had touched only `:491` would have reviewed as correct and changed nothing on hardware.
- **`qcmd` deliberately does not use `timeout`** — `qcmd:142` records that `atcli_smd11` handles command timeouts natively. The AT transport is not exposed by the `timeout` defect, which is why live modem data on the RG501Q was unaffected throughout.
