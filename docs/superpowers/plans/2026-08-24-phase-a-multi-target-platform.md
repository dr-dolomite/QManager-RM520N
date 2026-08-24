# Phase A — Multi-Target Platform Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **The tracker, not this plan, is the record of what has HAPPENED.** A task's checkboxes tell you what the task *involves*. `docs/superpowers/plans/2026-08-24-phase-a-tracker.md` tells you what is *done*. If they disagree, the tracker wins.

**Goal:** Promote QManager from an accidentally-multi-target project into a declared one — a generated platform profile, a formal support-tier table, one tolerant identity parser, variant-overlay builds, and variant-aware OTA — while changing **nothing** about how an RM520N-GL behaves.

**Architecture:** One new shell library (`hw_profile.sh`) owns both halves of identity: the *parser* (tolerant of the vendor's column-aligned `/etc/quectel-project-version` format) and the *generator* (the single writer of `/etc/qmanager/platform.json`). The installer calls the generator unconditionally; `qmanager_setup` calls the same generator at boot when the profile is missing, schema-stale, or firmware-fingerprint-stale. Consumers migrate from ad-hoc `grep` calls onto the library. `build.sh` grows a variant loop; the OTA client learns to select a variant asset while an unchanged `qmanager.tar.gz` remains published forever.

**Tech Stack:** POSIX shell (BusyBox `sh` compatible), systemd units, `build.sh`. No TypeScript. No new runtime dependency — in particular **no `jq` in `qmanager_setup`**.

**Spec:** `docs/superpowers/specs/2026-08-23-multi-target-modem-support-design.md`. Read §4 (Architecture) and **§9 (Amendment 2026-08-24) — §9 overrides §6 where they conflict.** Sections 1–8 predate adb access to the RG501Q; where §9, this plan, the tracker, or `docs/reference/rg501q-bringup.md` contradict them, **the measurement wins and you say so out loud.**

**Phase 1 gate outcome:** `installer-safety-auditor` returned **CONDITIONAL** — 6 constraints, 0 hard blockers. All 6 are folded into Global Constraints or into individual tasks below.

---

## Global Constraints

Copied from the spec, the Phase 1 gates, and the project's standing rules. **Every task's requirements implicitly include this entire section.**

### The validation gate — and why it is asymmetric

- **ZERO BEHAVIOR CHANGE ON RM520N-GL.** This is the phase's validation gate. *If RM520N behavior changes at all, the refactor is wrong.* Prove it with a command and its output — **an assertion is not evidence.**
- **The RG501Q half of the gate is DIFFERENT, because the device is already broken.** You cannot regress a poller that emits nothing. The rule there is: **do not make the broken install harder to recover, and do not repair it as a side effect.** Repairing is Phase C/D. Judge every task against that rule, not against "nothing changed".
- **The gate has known blind spots. It is necessary, not sufficient.** Two changes in this phase are genuine behavior changes that produce byte-identical observable output on an RM520N-GL (see G1 and G2 below). For those, the gate cannot help you and a task-specific check is mandatory.

**G1 — The community-device blind spot.** `detect_orientation_from_soc()` has returned `normal` for *every device that has ever run QManager*, because its `grep` never matched (see "The parser defect" below). Repairing the parser activates the `SDX55 → reversed` map for the first time. RM520N-GL reports `SDX6X` and is unaffected, so the gate passes — but **RM502Q-AE / RG502Q community devices in the field report `SDX55` and would flip.** That map is documented as a **hypothesis, not a measurement** (`platform-matrix.md`, "On counter orientation"; `data-counter-platform-matrix.md:161`), established on a different model, with a contradicting slow-path test on the same part. **Phase A must not activate it.** See T4.

**G2 — The frozen-counter blind spot.** `qmanager_poller:54-58` picks `NETWORK_IFACE`. If a migrated reader falls through to `wwan0` on an RM520N-GL, `grep "${NETWORK_IFACE}:" /proc/net/dev` returns empty, `update_data_used()` bails at `:751-753`, and **Data Used silently stops accumulating forever** while `/tmp/qmanager_status.json` keeps emitting a plausible frozen `accumulated_rx_bytes`. A JSON shape-diff will not catch this. Only watching the counter *move* over minutes will.

### Evidence discipline

- **STATE ONLY MEASURED VALUES.** Every RG501Q fact carries its probe command and date. Unprobed stays `*unverified*` in `platform-matrix.md`. **Never write an inference as a measurement.**
- Any RG501Q fact learned during a task goes into **both** the tracker's "Device facts learned this phase" **and** `docs/reference/platform-matrix.md`.
- Where this plan cites a spec section that a measurement has since contradicted, the measurement governs — say so in the commit message.

### Architecture rules

- **NAME COLLISION.** `scripts/usr/lib/qmanager/platform.sh` is the **init-system** abstraction (`svc_start` / `svc_enable` / `run_iptables` / sudo-path detection) — a leftover of the OpenWRT→systemd port. **SoC/model logic must never go there.** It lands in `hw_profile.sh`.
- **TWO IDENTITY AXES, NEVER COLLAPSED.** **Model** (`Project Name:`) governs form factor and peripherals. **SoC** (`Branch Name:`) governs counter orientation, IPA quirks, udev subsystem. Never merge them into one "platform" string.
- **SCHEMA-VERSIONED REGENERATION IS THE MIGRATION PATH.** `config.sh` has no key-migration primitive — `qm_config_init` (`config.sh:13-14`) returns early on any non-empty file, so a key added later **never reaches an OTA-upgraded device**. The profile self-heals on schema bump or `fw_fingerprint` mismatch instead.
- **THE PROFILE IS ADVISORY, NEVER A SECURITY BOUNDARY.** `/etc/qmanager` cannot hold a root-pinned file: `www-data` owns it and `qmanager_setup:151` does an unconditional `chown -R www-data:www-data /etc/qmanager` every boot. Confirmed on both devices. No privilege, authentication, or tier-enforcement decision may consult the profile.

### Installer / OTA invariants

- **OTA COMPATIBILITY FLOOR.** `update.sh:244` interpolates its download URL and never reads `.assets[]` (that array is read only for the size display at `:234-236`). Every device on v0.1.14 or older will request the literal filename **`qmanager.tar.gz` forever**. That asset must keep being published, identical to the RM520N build. Dropping it silently 404s OTA on the entire fielded fleet.
- **TAR SENTINEL #1 — the filename.** `qmanager_update:165` validates a tarball with `tar tzf … | grep -q "install_rm520n.sh"`. That filename must remain in **both** variant tarballs. **Renaming the installer is out of scope.**
- **TAR SENTINEL #2 — the top-level directory.** `qmanager_update:456-458`, `:568-570` and `:643-645` all do `tar xzf … -C /tmp/` then `cd /tmp/qmanager_install || die`. **Every variant tarball must extract to a top-level directory named literally `qmanager_install`.** This sentinel is *not* named in the spec, and `verify_archive()` does **not** catch a violation — it only greps for the file. The `die` lives in the already-deployed updater on every fielded device, so it cannot be fixed forward.
- **HEADLESS AUTO-PROCEED MUST SURVIVE.** `install_rm520n.sh:399-409`: with no terminal available the unrecognized-device path auto-proceeds with a warning rather than aborting. Pre-v0.1.8 OTA workers do not pass `--force`, and **the RG501Q is proof this path is load-bearing — it is how an undetected device got installed at all.**
- **`--force` SKIPS THE ENTIRE DETECTION BLOCK.** `install_rm520n.sh:361-363` gates the whole version-file read *and* the tier `case` behind `if [ "$DO_FORCE" = "1" ]; then warn; else … fi`. **Every OTA install passes `--force`** (`qmanager_update:260,464,576,651` run `install_rm520n.sh --force --skip-packages --no-reboot`). Profile generation placed inside that `case` would never run on an OTA-upgraded device.
- **INSTALLER CHANGES MOVE IN LOCKSTEP** across install, uninstall, and OTA. *Verified for this phase:* `hw_profile.sh` needs no installer/uninstaller edit (`/usr/lib/qmanager/*` is glob-installed at `install_rm520n.sh:1125`, glob-removed at `uninstall_rm520n.sh:341`); `platform.json` needs none either (`uninstall_rm520n.sh:580` already does `rm -rf "$CONF_DIR"` under `--purge`); `variants/` exists only at build time and never reaches a device. **Confirm these three still hold — do not assume.**
- **Atomic writes use a SAME-DIRECTORY tmp file**, per `config.sh`'s `qm_config_set()`. Not `mktemp`, which defaults to `/tmp` — a different filesystem (tmpfs vs `ubi2_0`), so the `mv` would hit `EXDEV`.
- **`install -d -m 0755`, never `mkdir -p`.** `mkdir -p` no-ops on an existing directory, so a bad mode persists across every OTA.
- **No in-flight reboot.** The app runs on the modem; a reboot mid-request kills the HTTP response. Reboots are deferred via dialog + banner.

### Scope fences

- **China / GFW delivery is Phase D and is NOT in scope here.** If a task starts drifting toward mirrors, Gitee, or offline bundles — **stop and say so.**
- **Support tiers are NOT surfaced in the UI in this phase** (D7).
- Renaming the repo, renaming `install_rm520n.sh`, RG501Q-specific band/capability/peripheral work, and fast-forwarding `main` are all out of scope.
- **Phase A must not emit `official` as the RG501Q tier.** §4.4 lists `RG501Q* → official (after Phase C)`, but §9.3 makes that promotion Phase C's own deliverable. Phase A emits `community`.

### Safety — two live devices

- **RM520N-GL** over SSH: `.env` triad (`MODEM_IP`, `MODEM_SSH_USER`, `MODEM_SSH_PASSWORD`), POSH-SSH. **Never print a credential value — reference variable names only.**
- **RG501Q-EU** over `adb -s b7e3d6f1 shell`, uid=0 root, no `www-data` speed bump. It carries a previous owner's **failed v0.1.12 install** (died at `install_rm520n.sh:803-806` on `opkg update`). Only the Rust ping daemon works; the poller runs and *does* drive `/dev/smd11` but emits nothing without `jq`; lighttpd is not running. **That is evidence, not a bug to fix in passing.**
- **Both devices are READ-ONLY** unless the tracker records that the user approved a specific write.
- **`/dev/smd11` on the RG501Q has a second, non-cooperating holder:** `simpleadmin-go` (pid 759) keeps two persistent fds on it and does not participate in QManager's `flock`. Any AT command issued there risks corrupting *its* in-flight response. Do not issue AT commands on that device without explicit approval recorded in the tracker.
- **Validate CGI as `www-data`, never as root.** Root-shell `_SKIP_AUTH=1` testing has masked real permission bugs.

---

## Conventions

### C1 — The vendor version-file format

Measured `od -c` on **both** devices, 2026-08-24. The labels are **column-aligned**, and three of the five are not what a naive parser expects:

```
Project Name: RM520NGL_VC          <- one space, colon flush
Project Rev : RM520NGLAAR03A03M4G_A0.304   <- SPACE BEFORE THE COLON
Branch  Name: SDX6X                <- TWO SPACES between the words
Custom  Name: STD                  <- TWO SPACES between the words
Package Time: 2026-03-23,12:27
```

The RG501Q is byte-identically formatted: `Project Name: RG501QEU_VD`, `Project Rev : RG501QEUAAR12A11M4G_04.202`, `Branch  Name: SDX55`.

**The parser defect this exposes.** `qmanager_poller:70` reads `grep -m1 "^Branch Name"` — one space. **It matches nothing on either device.** `$branch` is empty, the `case` falls to its default, and `detect_orientation_from_soc()` has returned `normal` for every device, always. Live confirmation: `/usrdata/qmanager/data_used.json` reads `"orientation": "normal"` on the reference device.

**Why no test caught it.** `scripts/test/poller-data-used.sh:183,199` writes `Branch Name      : SDX6X` — one space *between the words*, padding *before* the colon. That is the opposite alignment convention from the device, and it exists on no hardware. Tests 7–10 pass green against fiction.

**Therefore the canonical matcher tolerates whitespace BETWEEN THE WORDS, not merely before the colon:**

```sh
# correct — handles device (`Branch  Name:`) and legacy fixture (`Branch Name      :`)
grep -m1 '^Branch[[:space:]]*Name[[:space:]]*:' "$f" | sed 's/^[^:]*:[[:space:]]*//'
```

Never hand-type a fixture. **Regenerate every test fixture from real device bytes** and record the capture command in the test file's header comment.

### C2 — Model strings carry a suffix

Measured: `RM520NGL_VC` and `RG501QEU_VD`. **Not** `RM520N-GL` / `RG501Q-EU`. Never hardcode the spec's example value `"RG501Q-EU"` — §4.2's JSON example is illustrative and is wrong about this. Glob patterns (`RM520N*`, `RG501Q*`) survive the suffix; exact-match comparisons do not.

The canonical model-shape regex is already correct in exactly one place — `qmanager_health_check:354`, `^(RM|RG|EG|EC)[0-9A-Za-z\-]+`. **Reuse it; do not invent a second one.**

### C3 — `platform.json` schema (schema 1)

```json
{
  "schema": 1,
  "model": "RG501QEU_VD",
  "soc": "SDX55",
  "form_factor": "lga",
  "tier": "community",
  "fw_fingerprint": "RG501QEUAAR12A11M4G_04.202",
  "caps": {}
}
```

- `model` / `soc` are the **verbatim parsed values**, never normalized to a marketing name.
- `fw_fingerprint` is the verbatim `Project Rev` value.
- `caps` stays `{}` in Phase A — it is populated in Phase C.
- **`tier` is advisory.** Nothing may gate a privilege or authentication decision on it.

### C4 — Support tiers

| Match on `Project Name:` | Tier | Installer behavior |
| --- | --- | --- |
| `RM551E*` | `incompatible` | Hard `die` — wrong architecture (OpenWRT). **Unchanged.** |
| `RM520N*` | `official` | Proceed, full profile |
| `RG501Q*` | `community` | Proceed, full profile. **Phase C promotes this to `official`, not Phase A.** |
| Known SoC, unknown model | `community` | Proceed, profile inferred from `Branch Name` |
| Unknown SoC / unparseable | `fallback` | Proceed, conservative defaults |

### C5 — Fail-closed is defined PER CONSUMER, never globally

"Fail closed" means opposite things at different call sites. A single helper returning empty-on-failure gives the wrong answer at one of them. **Every consumer states its own fallback explicitly:**

| Consumer | On absent/corrupt profile, fall back to | Why |
| --- | --- | --- |
| `qmanager_poller` interface pick | **`rmnet_ipa0`** | `wwan0` does not exist on either target; choosing it freezes Data Used forever (G2) |
| `qmanager_poller` orientation | **`normal`** | The only value ever actually shipped |
| OTA variant selection | **`qmanager.tar.gz`** (compat floor) | Behave exactly as a pre-Phase-A client |
| Installer tier | **`fallback`** | Conservative, never blocks |

### C6 — Per-task commit format

```
<type>(<scope>): <what changed>

<why, in one or two sentences>

Gate: RM520N-GL unchanged — <the command run> => <its output>
```

---

## Task List

Eleven tasks. **T0 is a precondition and must land before any worktree is created.** T1–T3 add code nothing reads yet. **T4 is the first task where a device *acts* on the profile — if Phase A is cut short, cut it BEFORE T4, not after.** T6–T9 are the OTA chain and are ordered so the fleet-fatal pairings land together.

---

### Task 0: Commit the Phase-A input documents — PRECONDITION

**Files:**
- Commit (currently uncommitted): `docs/superpowers/specs/2026-08-23-multi-target-modem-support-design.md` (the §9 amendment), `docs/reference/platform-matrix.md`, `.claude/agent-memory/modem-investigator/MEMORY.md`
- Commit (currently **untracked**): `docs/reference/rg501q-bringup.md`
- **Do NOT touch:** `components/cellular/band-locking/shapes.ts` — 117 uncommitted insertions of unrelated in-flight frontend work.

**Why this is a task and not an assumption:** every later task creates a worktree off `development`. `rg501q-bringup.md` is **untracked** and the §9 amendment is **uncommitted**, so a fresh worktree would contain *none* of the RG501Q evidence this plan is built on. A builder would silently fall back to Sections 1–8, which are wrong.

- [ ] **Step 1: Confirm the state before committing**

```bash
git status --short
git check-ignore -v docs/reference/rg501q-bringup.md || echo "not ignored — plain untracked"
```
`docs/reference/` is **not** gitignored, so a plain `git add` works there. `/docs/superpowers` **is** gitignored (`.gitignore:53`) and needs `git add -f`.

- [ ] **Step 2: Commit the reference docs and the amendment separately from the frontend work**

```bash
git add docs/reference/rg501q-bringup.md docs/reference/platform-matrix.md
git add -f docs/superpowers/specs/2026-08-23-multi-target-modem-support-design.md
git commit -m "docs(platform): record the RG501Q-EU bringup probe and spec amendment"
```

- [ ] **Step 3: Commit this plan and the tracker**

```bash
git add -f docs/superpowers/plans/2026-08-24-phase-a-multi-target-platform.md \
           docs/superpowers/plans/2026-08-24-phase-a-tracker.md
git commit -m "docs(plan): add the Phase A plan and tracker"
```

- [ ] **Step 4: PROVE the force-add stuck**

```bash
git ls-files --error-unmatch docs/superpowers/plans/2026-08-24-phase-a-tracker.md \
                             docs/superpowers/plans/2026-08-24-phase-a-multi-target-platform.md \
                             docs/superpowers/specs/2026-08-23-multi-target-modem-support-design.md
```
Every path must print. **A plain `git status` will NOT warn you** that a `/docs/superpowers` file is untracked — this command is the only check that means anything.

- [ ] **Step 5: Confirm the unrelated frontend work is still uncommitted and untouched**

```bash
git status --short components/cellular/band-locking/shapes.ts   # expect: " M"
```

---

### Task 1: `hw_profile.sh` — the tolerant parser, the tier table, and the generator

**Files:**
- Create: `scripts/usr/lib/qmanager/hw_profile.sh`
- Create: `scripts/test/hw-profile.sh` (test harness)
- Modify: `scripts/install_rm520n.sh` — delete `detect_modem_firmware()` (`:263-290`)
- Read (do not modify): `scripts/usr/lib/qmanager/config.sh` (atomic-write precedent), `scripts/usr/lib/qmanager/platform.sh` (the name collision — confirm you are NOT editing this)

**Interfaces:**
- Produces: `qm_hw_model`, `qm_hw_soc`, `qm_hw_fw_fingerprint`, `qm_hw_form_factor`, `qm_hw_tier`, `qm_hw_variant`, and **`qm_hw_write_profile <path>`** — the single writer of `platform.json`, consumed by T2 (installer) and T3 (self-heal).
- Consumes: nothing. Ships as dead code.

**Why the generator lives here and not in its two callers:** the profile is written by two different code paths — the installer at preflight, and `qmanager_setup` at boot (which **does** run on the OTA path: `install_rm520n.sh:2891` does `systemctl restart qmanager-setup`). Two implementations would drift on tier string, schema number, or field order, and the profile would flip-flop between install-time and boot-time content.

- [ ] **Step 1: Write the parser against the real format**

Use the C1 matcher. Tolerate whitespace **between the words**. Handle: file missing, file unreadable, label absent, value empty. Every accessor returns the C5 fallback for its consumer, never a bare empty string that a caller might mistake for a valid value.

- [ ] **Step 2: Implement the tier table from C4**

Glob matches on the **suffixed** model string (C2). `RG501Q*` emits **`community`**, not `official`.

- [ ] **Step 3: Implement `qm_hw_write_profile`**

Same-directory tmp + `mv`, copying `qm_config_set()`'s idiom:
```sh
tmp="${dest}.tmp"
{ ...emit JSON... } > "$tmp" && mv "$tmp" "$dest" || { rm -f "$tmp"; return 1; }
```
**No `jq`.** T3 runs this from `qmanager_setup`, which has no `jq` today and no guarantee `/opt` is mounted — and the RG501Q, the fixture device, **has no `jq` at all**. Emit the JSON with `printf`.

- [ ] **Step 4: Delete `detect_modem_firmware()`**

`install_rm520n.sh:263-290`. **Zero callers** anywhere in the tree — verified by repo-wide grep. It is a decoy that looks exactly like "where tier detection lives" and hardcodes `grep -i "RM520N"` three times. Deleting it in the same commit that adds its replacement keeps the diff reviewable.

```bash
grep -rn "detect_modem_firmware" .   # expect: no output after deletion
```

- [ ] **Step 5: Write the test harness with fixtures captured from real hardware**

Fixtures for: RM520N-GL bytes, RG501Q-EU bytes, the legacy single-space fixture format, a truncated file, an absent file, an unknown SoC. Record the capture command in a header comment. **Do not hand-type a fixture** (C1).

- [ ] **Step 6: Verify**

```bash
sh scripts/test/hw-profile.sh
bash scripts/test/run-all.sh
grep -n "hw_profile\|Project Name\|Branch" scripts/usr/lib/qmanager/platform.sh   # expect: no output
```
The last command proves the name collision was respected.

- [ ] **Step 7: Validators**

`busybox-portability-checker` (new shell file) **and** `installer-safety-auditor` (the installer edit), in ONE parallel message.

- [ ] **Step 8: Gate + commit**

Nothing consumes the library yet, so the RM520N gate is trivially satisfied — **but still run and record it**, because a later task will diff against this snapshot:
```bash
# over SSH
cat /usrdata/qmanager/data_used.json; head -c 400 /tmp/qmanager_status.json
systemctl list-units 'qmanager*' --no-pager --all
```

```
feat(platform): add hw_profile.sh — tolerant identity parser, tier table, profile generator
```

---

### Task 2: Generate `platform.json` at install, and teach the tier `case` about RG501Q

**Files:**
- Modify: `scripts/install_rm520n.sh` — `preflight()`, `:361-432`

**Interfaces:**
- Consumes: `qm_hw_write_profile` from T1.
- Produces: `/etc/qmanager/platform.json` on every install path, including OTA.

**Why T2 and the tier `case` are ONE task and not two:** the draft split them into "advisory generation" and "blocking control flow". That split is a fiction — they edit adjacent lines of one function and are order-coupled:

- Generation **before** the `case` means an `RM551E` device gets `platform.json` written and *then* hits the `die` at `:373` — the installer leaves config on a device it explicitly refused, and `uninstall_rm520n.sh:580` never runs there.
- Generation **after** the `case` puts it inside the `else` arm of the `--force` gate — the exact placement that breaks every OTA device.

**The correct placement is after the whole `if [ "$DO_FORCE" = "1" ] … fi` block closes**, which is a structural edit to the same region. One task, one reviewer.

- [ ] **Step 1: Read the region in full before touching it**

```bash
sed -n '355,435p' scripts/install_rm520n.sh
```
Identify exactly where the `--force` `if/else` closes.

- [ ] **Step 2: Source `hw_profile.sh` from the STAGING TREE, not the absolute path**

At preflight time `/usr/lib/qmanager/hw_profile.sh` holds either the **previous** version's library (OTA) or **nothing** (fresh install) — `install_backend` does not glob-install that directory until `:1125`, long after `preflight` runs at `:3230`. Source `"$SRC_SCRIPTS/usr/lib/qmanager/hw_profile.sh"` (`SRC_SCRIPTS="$INSTALL_DIR/scripts"`, `:95`).

**If a builder uses the absolute path instead:** a fresh install writes no profile at all, and an OTA writes an **old-schema** profile that then silently triggers T3's self-heal — masking the bug until someone bumps the schema.

- [ ] **Step 3: Call the generator unconditionally, outside the `--force` gate**

It must run on `--force` installs. **Every OTA install passes `--force`.**

- [ ] **Step 4: Add the `RG501Q*` arm to the tier `case`, and change NOTHING else about it**

Preserve exactly: the `RM551E*` hard `die` (`:372-373`), the `RM520N*` info line, the empty-string warn, and the headless auto-proceed block at `:393-409` including its `/dev/tty` redirect probe. The `RG501Q*` arm emits an info line — it does **not** prompt.

- [ ] **Step 5: Confirm the lockstep items still need no code**

```bash
sed -n '575,585p' scripts/uninstall_rm520n.sh   # rm -rf "$CONF_DIR" under --purge
sed -n '1120,1130p' scripts/install_rm520n.sh   # glob install of /usr/lib/qmanager
```
Record the finding in the tracker. If either has changed, this task grows.

- [ ] **Step 6: Verify the headless path did not regress**

Exercise the auto-proceed branch with no controlling terminal — the RG501Q reaching the `*` arm under `adb shell` with no tty is the real-world reproduction. **Do not run an actual install on either device.** Use a local harness with a fake version file and stdin/tty closed.

- [ ] **Step 7: Validators** — `installer-safety-auditor` + `busybox-portability-checker`, ONE parallel message.

- [ ] **Step 8: Gate + commit**

RM520N-GL: no install is run, so device state is unchanged by construction — record the unit table and `data_used.json` anyway.

```
feat(installer): generate platform.json unconditionally; recognize RG501Q
```

---

### Task 3: Self-heal `platform.json` in `qmanager_setup`

**Files:**
- Modify: `scripts/usr/bin/qmanager_setup`
- Modify: `scripts/test/hw-profile.sh` (add the drift fixtures)

**Interfaces:**
- Consumes: `qm_hw_write_profile` from T1.

**Hard constraints specific to this task:**

- **NO `jq`.** `qmanager_setup` is `#!/bin/sh`, contains zero `jq` calls today, and sets no `PATH`. `jq` lives at `/opt/bin/jq`. `qmanager-setup.service` has **no `After=` at all** — no `opt.mount` ordering, unlike `lighttpd.service` which carries `After=network.target opt.mount` precisely because it needs `/opt`. A `jq`-based guard would silently yield empty and either regenerate every boot or never regenerate, logging nothing. **And the RG501Q — the fixture device — has no `jq` at all.** Use `grep`/`sed`.
- **No fire guard needed.** The 1970 boot window does not apply: this runs synchronously inside the `qmanager-setup` oneshot (ordering-triggered, not `OnCalendar`), and the comparison is a string diff, not time-based. **Do not over-engineer this.**
- **Never fingerprint on mtime.** The RG501Q's `/etc/qmanager/last_iccid` is stamped `Jan 1 00:00` while its siblings read `Jun 22 2026` — something writes there under a 1970 clock every boot. An mtime-based staleness check reads that as ~56 years in the future. **Fingerprint on content.**

- [ ] **Step 1: Implement the three regeneration triggers**

Regenerate when: `platform.json` is absent; `schema` is absent or lower than current; `fw_fingerprint` differs from the live `Project Rev` value. A truncated or corrupt file reads `schema` as absent and therefore regenerates — **verify that rather than assuming it**, mirroring `qm_config_get()`'s swallow-and-default behavior.

- [ ] **Step 2: Add the two missing drift fixtures**

The RG501Q gives a real **missing-file** fixture. The **schema-downgrade** and **fingerprint-drift** arms — the two arms self-heal actually exists for — have no fixture anywhere. Write synthetic ones.

- [ ] **Step 3: Verify on the RG501Q fixture, READ-ONLY**

```bash
adb -s b7e3d6f1 shell 'ls -la /etc/qmanager/ && cat /etc/qmanager/VERSION'
```
Confirm `platform.json` is still absent and the directory is still `drwxrwxrwx www-data:www-data`. **Do not deploy, do not run the script there, do not restart a unit.** This step records the fixture's state; it does not exercise it on hardware.

- [ ] **Step 4: Confirm the RG501Q was not made harder to recover**

Nothing was written to it. State that explicitly in the tracker with the command that proves the directory listing is unchanged.

- [ ] **Step 5: Validators** — `busybox-portability-checker` (shell + unit ordering) + `installer-safety-auditor`, ONE parallel message.

- [ ] **Step 6: Gate + commit**

```
feat(setup): self-heal platform.json on schema bump or firmware change
```

---

### Task 4: Migrate the poller's two identity reads — THE CUT LINE

> **This is the first task where a device ACTS on the profile.** Everything before it is dead code, a new unread file, or an install-time write nothing consumes. **If Phase A is cut short, cut it before this task.**

**Files:**
- Modify: `scripts/usr/bin/qmanager_poller` — `:54-58` (interface pick) and `:68-77` (orientation)
- Modify: `scripts/test/poller-data-used.sh` — `:179-232`, fixtures rewritten from device bytes

**Why both reads are one task:** they are adjacent statements in the poller's config block, and migrating only one leaves the tree with **two** tolerant parsers — `hw_profile.sh`'s and a hand-written one in the poller — which undercuts the entire justification for T1.

**Hard constraint — DO NOT ACTIVATE THE SDX55 MAP (G1).** Repairing the parser makes `detect_orientation_from_soc()` work for the first time ever. RM520N-GL is unaffected (`SDX6X → normal` either way) so the gate passes — but **RM502Q-AE / RG502Q community devices in the field report `SDX55` and would flip to `reversed`.** That map is a documented *hypothesis*, established on a different model, with a contradicting slow-path test on the same part, and `rg501q-bringup.md` lists counter orientation as an **open Phase-B question**. Phase A must not ship an untested map into the field ahead of the phase whose job is to measure it.

**Therefore:** repair the parser, and keep orientation resolving to `normal` for every SoC, with the `SDX55` arm present but explicitly inert and commented as Phase-B-gated. The parser fix and the map activation are two different changes; only the first belongs to Phase A.

*For the record, the flip is a false alarm rather than corruption:* `du_prev_ipa_rx` (a large DL baseline) would be compared against the now-swapped small UL field, `delta_rx` goes negative, and the counter-reset rebase at `qmanager_poller:786-790` fires — one spurious `modem_reset_count++` and one lost tick, self-correcting. Accurate framing matters; "counters get corrupted" would be wrong.

- [ ] **Step 1: Migrate the interface pick with its fallback named explicitly**

`:54-58` currently uses `[ -f /etc/quectel-project-version ]` as an RM520N-vs-RM551E discriminator. Per C5 the fallback is **`rmnet_ipa0`**, never `wwan0`. **This is G2 — the worst blind spot in the whole phase.**

Note `:54-58` runs at **top level, before the poller sources any library** (~`:340`). Either move the logic below the sourcing block or source `hw_profile.sh` at the very top. **This is a structural change, not a line edit** — size the session accordingly.

- [ ] **Step 2: Migrate orientation onto the library parser, map still inert**

- [ ] **Step 3: Rewrite the test fixtures from real device bytes**

`scripts/test/poller-data-used.sh:183,199` currently write `Branch Name      : SDX6X` — an alignment convention that exists on no hardware. Replace with the captured bytes from both devices. Record the capture command in a header comment.

- [ ] **Step 4: Prove the counter still MOVES — not merely that the JSON has the right shape (G2)**

A shape-diff cannot see a frozen counter. Over SSH:
```bash
cat /usrdata/qmanager/data_used.json          # note accumulated_rx_bytes
# wait through several poll cycles (cadence is ~3.7-4.0s, not 2s)
cat /usrdata/qmanager/data_used.json          # accumulated_rx_bytes MUST have advanced
```
Record both readings and the elapsed time in the tracker. Also assert `"orientation": "normal"` is unchanged, and `modem_reset_count` did **not** increment.

- [ ] **Step 5: Note for the tracker's "what a later task might invalidate"**

`data_used.json.orientation` is **write-only** — written at `qmanager_poller:665`, emitted at `:1910`, but the load path at `:701-708` never reads it back, and zero CGI scripts reference it. **`docs/reference/data-usage-counter.md:41`'s claim that the CGI surfaces `orientation` is false.** So there is no HTTP-observable surface for an orientation regression; only the on-device file shows it. T10 fixes the doc.

- [ ] **Step 6: Validators** — `busybox-portability-checker` with scoped on-device verification, ONE message.

- [ ] **Step 7: Gate + commit**

```
refactor(poller): read identity through hw_profile.sh; repair the Branch Name parser

The SDX55 orientation map stays inert — activating it is Phase B's call,
after the map is measured rather than assumed.

Gate: RM520N-GL unchanged — data_used.json orientation=normal, accumulated_rx_bytes advanced <X> -> <Y> over <N>s
```

---

### Task 5: Migrate `about.sh`'s firmware-revision read

**Files:**
- Modify: `scripts/www/cgi-bin/quecmanager/device/about.sh:112-113`

Small and display-only — the value populates the About page's `sys_openwrt` field (`:160`), which the frontend only displays (`components/about-device/device-information-card.tsx`). Kept separate from T4 because the file sets are disjoint and the risk profiles are nothing alike.

- [ ] **Step 1: Migrate to `qm_hw_fw_fingerprint`,** preserving the exact output string.

- [ ] **Step 2: Handle profile-absence explicitly**

**There is a live window on every single install** where the CGI serves requests before the profile exists: `install_rm520n.sh:2866` restarts lighttpd, `:2891` restarts `qmanager-setup`. Plus `lighttpd.service` is `After=network.target opt.mount` and `qmanager-setup.service` declares no `After=` at all — so at boot there is no ordering guarantee either. Fall back to reading the version file directly.

- [ ] **Step 3: Validate as `www-data`, never as root**

```bash
curl -sS http://127.0.0.1/cgi-bin/quecmanager/device/about.sh
```
through lighttpd, and diff the `sys_openwrt` field against its pre-change value.

- [ ] **Step 4: Validators + commit**

```
refactor(about): read the firmware revision through hw_profile.sh
```

---

### Task 6: Harden `verify_checksum()` — standalone, and valuable even if Phase A stops here

**Files:**
- Modify: `scripts/usr/bin/qmanager_update` — `verify_checksum()`, `:203-246`

**Why this lands before anything touches build output:** `qmanager_update:229-230` does `expected_sha=$(awk '{print $1}' "$checksum_file")` — **no `head -1`, no filename match.** If a later task publishes one `sha256sum.txt` covering three tarballs, `expected_sha` becomes a multi-line blob that can **never** compare equal to a single hash. `checksum_rc -eq 2` is **fatal in every mode, strict or not** — so that breaks OTA for the **entire fielded fleet**, including the compatibility-floor asset every already-shipped device requests. And it is unfixable forward, because the broken comparison lives on those devices.

Hardening the parse *first* means the field is already tolerant before the asset layout ever changes. This is a strict improvement even if the rest of Phase A is abandoned.

- [ ] **Step 1: Parse the checksum file by filename, not by position**

Match the line whose filename field equals the downloaded tarball's basename; fall back to `head -1` when the file has exactly one line (the historical format).

- [ ] **Step 2: Unit-test against three checksum-file shapes**

Single-line legacy; multi-line with the target present; multi-line with the target absent (must fail cleanly, not match the wrong hash).

- [ ] **Step 3: Validators + commit**

```
fix(update): match the checksum line by filename instead of taking field 1
```

---

### Task 7: Variant overlay build

**Files:**
- Modify: `build.sh`
- Create: `variants/rm520n/.gitkeep`, `variants/rg501q/.gitkeep`

**Interfaces:**
- Produces: the release asset layout and the checksum-file layout that T8 and T9 are written against. **This task owns that decision.**

**Three hard constraints:**

1. **Every variant tarball must extract to a top-level directory named literally `qmanager_install`** (Tar Sentinel #2). `build.sh:202` currently gets that from `tar czf "$ARCHIVE" -C "$BUILD_DIR" qmanager_install`. The natural variant implementation — one staging dir per variant, `qmanager_install_rg501q/` — produces tarballs that **pass** `verify_archive()` and then **die at `cd /tmp/qmanager_install`** in the already-deployed updater. Stage each variant in a differently-named parent but keep the archived directory name constant.
2. **`qmanager.tar.gz` must remain byte-identical to today's RM520N build.** It is the compatibility floor.
3. **`install_rm520n.sh` and `uninstall_rm520n.sh` must remain at the staging root in every variant.** `build.sh:65-66` copies them there deliberately, outside the `scripts/*` loop at `:56-62`. That carve-out is what satisfies Tar Sentinel #1. Overlays apply to `scripts/**` only.

- [ ] **Step 1: Add the variant loop.** Stage shared → copy the overlay over it → stamp the variant → tar. Overlay files replace same-path shared files; the shared tree is never modified in place.

- [ ] **Step 2: Decide and implement the checksum-file layout**

Per-variant sibling checksum files are the safer shape, because `update.sh:367` hardcodes the sibling name `sha256sum.txt` and bypasses `derive_checksum_url()` entirely. Whatever you choose, **write the decision into this file and the tracker** — T8 and T9 are written against it.

- [ ] **Step 3: Add the release-asset guard**

`build.sh` must **refuse to complete** unless the compatibility-floor `qmanager.tar.gz` exists among its outputs, and must print a manifest of every emitted asset plus its SHA. Publishing three assets is now a permanent invariant of every future release, and the first person who cuts a release without the floor asset **silently 404s OTA on the entire existing fleet** with no code path able to warn them.

- [ ] **Step 4: Verify the sentinels mechanically**

```bash
for t in qmanager-build/qmanager*.tar.gz; do
  echo "== $t"
  tar tzf "$t" | head -1                      # MUST be qmanager_install/
  tar tzf "$t" | grep -c "install_rm520n.sh"  # MUST be >= 1
done
sha256sum qmanager-build/qmanager.tar.gz      # compare to a pre-change build
```

- [ ] **Step 5: Validators** — `installer-safety-auditor` (OTA/build) + `busybox-portability-checker`, ONE message.

- [ ] **Step 6: Commit**

```
build: emit per-variant tarballs behind a preserved compatibility floor
```

---

### Task 8: Widen `validate_url()` and `derive_checksum_url()`

**Files:**
- Modify: `scripts/usr/bin/qmanager_update` — `validate_url()` `:144-159`, `derive_checksum_url()` `:175-183`

`validate_url()` whitelists exactly two hardcoded patterns today, both bound to the single filename `qmanager.tar.gz`. `derive_checksum_url()` does a literal `case` suffix strip on that same filename and returns **empty** for any other name — and an empty checksum URL under `strict` (the unattended auto-update path) is fatal.

- [ ] **Step 1: Add exactly one pattern** — `releases/download/*/qmanager-*.tar.gz`. The `raw/` path stays install-mode-only. **No branch refs are ever admitted.**

- [ ] **Step 2: Generalize the checksum-URL derivation** against T7's chosen layout.

- [ ] **Step 3: Test positively AND negatively**

Positive: an unmodified pre-Phase-A `.../qmanager.tar.gz` URL still validates and still derives its checksum URL — **this proves the compatibility floor survives.** Negative: `.../qmanager-evil.tar.gz` at a foreign origin is refused; a `raw/<branch>/...` URL is still refused under `strict`.

- [ ] **Step 4: Validators + commit**

```
feat(update): accept variant release assets; keep branch refs out of the whitelist
```

---

### Task 9: Variant selection at the five URL construction sites

**Files:**
- Modify: `scripts/www/cgi-bin/quecmanager/system/update.sh` — `:244`, `:366`, `:367`, `:416`
- Modify: `scripts/usr/bin/qmanager_auto_update` — `:162`

**There are FIVE sites, not four.** `update.sh:367` is the checksum URL in download mode — a separate literal on its own line that does **not** route through `derive_checksum_url()`. Fixing four and shipping leaves one silently non-variant-aware.

**Rollback stays on the compatibility floor — a stated decision, not an oversight.** `update.sh:416` builds its URL from `$UPDATES_DIR/previous_version`, an **older tag**. Older tags only ever published `qmanager.tar.gz`, so a variant-aware rollback would 404 every rollback to a pre-variant release. Phase A therefore leaves rollback requesting the floor asset. That is harmless now — Phase A's overlays are empty, so the floor build and the RG501Q build are identical — but **from Phase C onward it means an RG501Q rolls back onto the RM520N build.** Record this in the tracker's open questions as a Phase C blocker.

- [ ] **Step 1: Select the variant from the profile,** falling back to `qmanager.tar.gz` per C5 when the profile is absent or corrupt — the CGI has no ordering guarantee against `qmanager-setup` and a live pre-profile window on every install.

- [ ] **Step 2: Change all five sites in one commit,** with rollback deliberately left on the floor asset and a comment saying why.

- [ ] **Step 3: Verify the compatibility floor end to end**

Run an install against an **unmodified pre-Phase-A** `.../qmanager.tar.gz` URL and prove the checksum still verifies. This is the fleet-safety check; the variant assets verifying proves nothing about already-shipped devices.

- [ ] **Step 4: Validators** — `installer-safety-auditor` mandatory, ONE message with `busybox-portability-checker`.

- [ ] **Step 5: Commit**

```
feat(update): select the variant release asset; rollback stays on the floor
```

---

### Task 10: Documentation sync

**Files:**
- Modify: `docs/reference/platform-matrix.md`, `docs/reference/rg501q-bringup.md`, `docs/reference/data-usage-counter.md`, `docs/reference/data-counter-platform-matrix.md`, `docs/BACKEND.md`, `CLAUDE.md`
- Create: `docs/reference/platform-profile.md`

Four statements in the docs are **already false or made false by this phase**, and no earlier task owns any of them.

- [ ] **Step 1: Correct the `/opt` claim on BOTH devices**

`/proc/mounts` shows `/dev/ubi2_0` for `/etc`, `/usrdata` **and `/opt`** on the RM520N-GL *and* the RG501Q. So `CLAUDE.md`'s "Entware opkg at `/opt` (dedicated UBIFS volume)" is wrong, and `rg501q-bringup.md`'s framing of this as an RG501Q *difference* is wrong. It is not a platform difference at all. (`df` is useless here — BusyBox `df` resolves all three to an `/etc/machine-id` tmpfs bind. Use `/proc/mounts`.)

- [ ] **Step 2: Correct the orientation-surfacing claim**

`data-usage-counter.md:41` says the CGI response surfaces `orientation`. **Zero CGI scripts reference it.** Also `data-counter-platform-matrix.md:207` and `data-usage-counter.md:55` both say "edit `detect_orientation_from_soc()` in the poller" — T4 relocates that.

- [ ] **Step 3: Correct the branching-contract claim**

`docs/BACKEND.md:11` states the sentinel's *presence* is the branch condition — T4 makes that false. `docs/BACKEND.md:923` still says "schema v4, with per-boot orientation detection", already wrong.

- [ ] **Step 4: Correct the RG501Q poller characterization**

`rg501q-bringup.md` reads as though the poller there is inert. It is **actively driving `/dev/smd11`** — an `atcli_smd11 AT+QENG="servingcell"` was caught in flight. It simply cannot serialize output without `jq`.

- [ ] **Step 5: Back-fill `platform-matrix.md` from the B0 probe**

Several cells still read `*unverified*` that `rg501q-bringup.md` measured on 2026-08-24 — BusyBox version, glibc, kernel, `fs.protected_regular`, rootfs layout, `eth0` existence. Fill them with `on-device 2026-08` provenance. **Add the C1 label-spacing table.** Anything the probe did not cover **stays `*unverified*`.**

- [ ] **Step 6: Write `docs/reference/platform-profile.md`** — the profile schema, the tier table, the self-heal triggers, the two-axes rule, and the release-asset invariant. Add **one row** to `CLAUDE.md`'s routing table. Do not summarize the doc in `CLAUDE.md`.

- [ ] **Step 7: Verify no invented measurements**

```bash
grep -rn "RG501Q" docs/ CLAUDE.md | grep -viE "unverified|LGA|SDX55|PRAIRIE|Phase B|Phase C|community|bringup|platform-matrix"
```
Review every hit by hand. A stated value with no probe behind it is a bug.

- [ ] **Step 8: Commit** — `docs-writer` is the closing bracket for this phase.

```
docs(platform): sync the multi-target contracts and back-fill measured RG501Q facts
```

---

## Verification Summary

| Task | The gate evidence it must produce |
| --- | --- |
| T0 | `git ls-files --error-unmatch` prints every force-added path |
| T1 | `scripts/test/hw-profile.sh` green; `platform.sh` untouched; `detect_modem_firmware` grep empty |
| T2 | Headless auto-proceed exercised with no tty; lockstep re-confirmed |
| T3 | RG501Q `/etc/qmanager` listing byte-identical to T3 Step 3's capture |
| **T4** | **`accumulated_rx_bytes` ADVANCED between two reads**; `orientation=normal`; `modem_reset_count` unchanged |
| T5 | `about.sh` `sys_openwrt` identical, fetched as `www-data` through lighttpd |
| T6 | Three checksum-file shapes tested |
| T7 | `tar tzf \| head -1` is `qmanager_install/` for every variant; floor SHA matches a pre-change build |
| T8 | Positive: pre-Phase-A URL validates. Negative: foreign origin and `raw/<branch>` refused under strict |
| T9 | Install from an unmodified pre-Phase-A URL verifies its checksum |
| T10 | Invented-measurement grep reviewed by hand |
