# Session prompts — Phase A and Phase D

**Rewritten 2026-08-24** after the RG501Q-EU was probed over adb. The earlier
version of this file was built on three premises that turned out to be wrong; see
[the spec's Amendment §9](../specs/2026-08-23-multi-target-modem-support-design.md)
and [`rg501q-bringup.md`](../../reference/rg501q-bringup.md).

**Pick a track first.** Phase A and Phase D are independent and either can run
first:

| Track | What it buys | Run it first if… |
| --- | --- | --- |
| **Phase A** — multi-target platform | Profile generation, tier table, `hw_profile.sh`, variant overlays, OTA variant selection. Ships as a no-op on RM520N-GL. | the goal is to stop the tree being *accidentally* multi-target |
| **Phase D** — China / GFW delivery | Mirror-base configurability, OTA source selection, offline install bundle | the goal is **"Lae can actually install QManager"** |

Each track is: one kickoff session (planning, ends at an approval gate), then one
fresh agent per task using that track's Prompt 2.

**Both tracks are unblocked.** The problem is **GitHub, not Entware** — see
below — so Phase D is a delivery/mirror job, not an offline-package-manager job.

---

## What the probe established (context both tracks need)

Device: RG501Q-EU, adb serial `b7e3d6f1`, uid=0 root shell.

- `Project Name: RG501QEU_VD` — **not** the literal `RG501Q-EU` the spec's
  profile example assumes. Glob `RG501Q*` still matches.
- `Project Rev : RG501QEUAAR12A11M4G_04.202`; `Branch Name: SDX55`; host
  `sdxprairie`.
- Kernel **4.14.206**, glibc **2.28**, BusyBox **1.29.3**, bash **4.4.23**,
  systemd **239**, 225 MB RAM, single Cortex-A7, hard-float.
  (RM520N-GL: 5.4.210, 2.31, 1.31.1, bash 3.2.57, 178 MB.)
- `ro` + `root=ubi0:rootfs` in cmdline — same contract as RM520N-GL.
  `/etc`, `/usrdata`, **and `/opt`** all share `ubi2_0`; 112.9 MB free.
  `/opt` is **not** a dedicated volume here. `fs.protected_regular = 0` (RM520N: 1).
- **Stock in firmware:** `lighttpd`, `curl`, `openssl`, `timeout`, `flock`,
  `setsid`, `unzip`. **Missing:** `jq`, `sudo`, `wget`, `ttyd`, `ssh`/`dropbear`,
  `python3`, `stdbuf`.
- `eth0` **exists** (NO-CARRIER). No WAN at all right now — no default route, no
  DNS, all `rmnet_data*` down.
- **A previous owner's failed install is on the device**: QManager v0.1.12,
  2026-06-22, died at `opkg update`. Only `qmanager-ping` (Rust, no Entware dep)
  works; the poller runs but emits nothing without `jq`; lighttpd is not running.
  This is **wreckage, not a deployment** — evidence to read, then a baseline to
  clear. Do not preserve it.
- **The blocker is GitHub, and only GitHub.** The GFW blocks github.com; the
  owner already ships around it with a **Gitee** mirror. Entware is **not** a
  blocker: `simpleadmin-source/installentware.sh` bootstraps Entware from
  bin.entware.net, and the owner runs SimpleAdmin through Gitee — so that chain
  completes on their network. This device carries `simpleadmin-go` and generated
  TLS keys, so SimpleAdmin ran here too.
- The RG501Q's `/opt` has `opkg` but zero packages and an empty
  `/opt/var/opkg-lists`. Most likely **no WAN at install time** — the device has
  no default route or DNS today and `curl` resolves nothing at all. An ordinary
  offline failure, not a block.

---

## Phase D — Prompt 1 (kickoff, planning only)

```text
Orchestrate Phase D of the multi-target modem support work: China / GFW delivery.

Read first: docs/superpowers/specs/2026-08-23-multi-target-modem-support-design.md
— §9 (Amendment) in full, then §4.6 (release assets and the OTA compatibility
floor). Then docs/reference/rg501q-bringup.md in full, and
docs/reference/change-workflow.md.

THE PROBLEM. QManager fetches its installer, its OTA updates, and its language
packs from GitHub. Behind China's GFW, github.com is unreachable, so a user there
can neither install nor update. The device owner already works around this for a
different project with a Gitee mirror. A previous owner's install attempt on the
attached RG501Q-EU died partway and left the device broken.

SCOPE DISCIPLINE — this is a GitHub delivery problem, NOT an offline-package-
manager problem. Entware is reachable from the owner's network:
simpleadmin-source/installentware.sh bootstraps Entware from bin.entware.net,
and the owner runs SimpleAdmin through Gitee, so that chain completes for them.
Do NOT design a bundled offline Entware repo. If you find yourself pricing
`file://` opkg sources or `entware-opt` dependency closures, you have drifted —
stop and say so. (The RG501Q's empty opkg database is explained by the device
having no WAN at install time, which is still true today: no default route, no
DNS, `curl` resolves nothing. Ordinary offline failure, not a block.)

THIS SESSION IS PLANNING ONLY. Phases 1-3, stop at the approval gate. Tier this
as 4 (installer / OTA pipeline), so installer-safety-auditor is a hard Phase 1
gate before the plan is finalized.

Scope, in priority order:
1. Mirror-base configurability for every GitHub-facing path — install_rm520n.sh,
   qmanager_update:147, qmanager_auto_update:61, update.sh:245, and the
   language-packs release. Recommend generic-configurable-base vs
   Gitee-specific, with reasoning; a generic base costs little more, does not
   bind the project to one Chinese host, and would also cover Entware's URL if
   that ever became necessary.
2. How a device LEARNS its mirror base: install-time flag, config key, or
   detection. Note that config.sh has no key-migration primitive, so a new key
   never reaches OTA-upgraded devices unless you add a migration step.
3. An offline install bundle: a tarball installable with no network at all,
   delivered out-of-band (USB / adb / local file). This is the fallback for a
   device with no WAN — which is exactly the state the attached RG501Q is in.
4. Whether the RG501Q's stock lighttpd/curl/timeout/flock let the installer skip
   Entware packages it currently requires, leaving entware-opt + sudo (jq and
   dropbear already ship as .ipk in dependencies/). This shrinks what an offline
   bundle must carry; it is NOT a rebuild of Entware.

HARD CONSTRAINTS — each is a way to break shipped devices:

- OTA COMPATIBILITY FLOOR. update.sh:245 builds its download URL by string
  interpolation and never reads .assets[]. Every already-shipped device requests
  the literal filename qmanager.tar.gz forever. Any mirror or variant work must
  keep publishing that exact asset or OTA 404s across the field.
- TAR SENTINEL. qmanager_update:165 validates a tarball with
  `tar tzf ... | grep -q "install_rm520n.sh"`. That filename must survive in every
  bundle you produce, offline ones included.
- URL WHITELIST IS A SECURITY CONTROL, NOT AN OBSTACLE. qmanager_update's
  validate_url() whitelists release-download paths and rejects arbitrary refs in
  strict mode. Adding a mirror means widening it deliberately and minimally —
  never disabling it. Say exactly which patterns you add and why each is safe.
  A mirror base that a hijacked update pointer could redirect is a remote code
  execution path onto every device.
- HEADLESS AUTO-PROCEED at install_rm520n.sh:399-409 must survive any installer
  refactor. Pre-v0.1.8 OTA workers do not pass --force.
- Installer changes move in lockstep across install_rm520n.sh,
  uninstall_rm520n.sh, and the OTA path.
- /etc/qmanager cannot hold a root-pinned file — www-data owns it and
  qmanager_setup re-chowns every boot. Confirmed on the RG501Q too.

SAFETY — the RG501Q is reachable over adb as uid=0, with no www-data speed bump.
Treat every adb command as root-on-production. For THIS session everything is
read-only: no installs, reinstalls, service starts, config writes or reboots.
The broken v0.1.12 install is evidence; do not repair it in passing. If a
question can only be answered by a write, stop and ask.

Deliver: a plan at docs/superpowers/plans/2026-08-24-phase-d-gfw-delivery.md and
a tracker at docs/superpowers/plans/2026-08-24-phase-d-tracker.md, both committed
with `git add -f`. Tasks sized to ONE session each, ordered so each leaves the
tree shippable. Tracker schema is in the shared section at the bottom of
docs/superpowers/plans/2026-08-24-phase-a-session-prompts.md.

GITIGNORE TRAP — OBSOLETE as of 2026-08-25, kept for context. `/docs/superpowers`
WAS gitignored, which made every file written there invisible to `git status` and
to the next session unless force-added. That is exactly why the rule was removed:
the trap this paragraph warns about was real and kept catching people. A plain
`git add` now works, and `git add -f` is merely redundant rather than required.
`/.claude` IS still gitignored and does still need `git add -f`.

At the gate, use AskUserQuestion for: generic mirror base vs Gitee-specific;
how a device learns its mirror base; and whether the RG501Q's broken install may
be wiped so we can test a clean install against it. Do not start Phase 4.
```

---

## Phase A — Prompt 1 (kickoff, planning only)

```text
Orchestrate Phase A of the multi-target modem support work.

Read first: docs/superpowers/specs/2026-08-23-multi-target-modem-support-design.md
— §4 Architecture and §6 Phases, THEN §9 (Amendment 2026-08-24), which overrides
§6 where they conflict. Then docs/reference/platform-matrix.md,
docs/reference/rg501q-bringup.md, and docs/reference/change-workflow.md.
Phase A0 is merged and closed (f827b3c); its plan is at
docs/superpowers/plans/2026-08-23-phase-a0-context-scoping.md.

Phase A scope is UNCHANGED by the amendment: platform profile generation +
self-heal, the support-tier table, hw_profile.sh, migrating consumers off ad-hoc
/etc/quectel-project-version parsing, variant-overlay build, and OTA variant
selection + whitelist widening. China/GFW delivery is Phase D and is NOT in
scope here — if a task starts drifting toward mirrors or offline bundles, stop
and say so.

WHAT THE AMENDMENT CHANGES FOR YOU. An RG501Q-EU is now attached over adb and has
been probed, so Phase A designs against measurements instead of guesses. Read
rg501q-bringup.md for the full set; the ones that bite this phase:
- Project Name is `RG501QEU_VD`, NOT the literal `RG501Q-EU` the spec's profile
  JSON example uses. The tier glob `RG501Q*` matches, but model normalization
  must handle the real string. Do not hardcode the spec's example value.
- Branch Name `SDX55`, Project Rev `RG501QEUAAR12A11M4G_04.202` — that Rev is
  what fw_fingerprint must capture.
- The device carries a PREVIOUS OWNER'S FAILED v0.1.12 INSTALL with an
  /etc/qmanager that has no platform.json. That makes it a real, live test case
  for the profile's self-heal-on-missing-schema path — the best fixture this
  phase could ask for.
- Factory opkg existed here and our installer renamed it to /usr/bin/opkg_old.
  The rename path at install_rm520n.sh:729-733 is exercised, not theoretical.

THIS SESSION IS PLANNING ONLY. Phases 1-3, stop at the approval gate. Write no
production code, create no worktree. Tier this as 4 (installer / systemd / OTA),
so installer-safety-auditor is a hard Phase 1 gate before the plan is finalized,
and modem-investigator runs recon. Include a devil's advocate whose job is to
attack the task decomposition — to find the tasks that only LOOK independent.

HARD CONSTRAINTS — carry verbatim into the plan:

- ZERO BEHAVIOR CHANGE ON RM520N-GL. That is the phase's validation gate: if
  RM520N behavior changes at all, the refactor is wrong.
- The RG501Q half of that gate is DIFFERENT, because the device is already
  broken. You cannot regress a poller that emits nothing. The rule there is: do
  not make the broken install harder to recover, and do not repair it as a side
  effect — repairing is Phase C/D. Judge each task against that, not against
  "nothing changed".
- STATE ONLY MEASURED VALUES. Every RG501Q fact carries the probe command and
  date. Unprobed stays *unverified* in platform-matrix.md. Never write an
  inference as a measurement.
- NAME COLLISION: scripts/usr/lib/qmanager/platform.sh is the INIT-SYSTEM
  abstraction (svc_start / svc_enable / run_iptables), not hardware. SoC/model
  logic goes in a distinctly named lib (hw_profile.sh).
- TWO IDENTITY AXES, NEVER COLLAPSED: model (`Project Name:`) governs form factor
  and peripherals; SoC (`Branch Name:`) governs counter orientation, IPA quirks,
  udev subsystem. Never merge them into one "platform" string.
- SCHEMA-VERSIONED REGENERATION IS THE MIGRATION PATH. config.sh has no
  key-migration primitive — qm_config_init only seeds an empty file, so a key
  added later never reaches OTA-upgraded devices. The profile self-heals on
  schema bump or fw_fingerprint mismatch.
- THE PROFILE IS ADVISORY, NEVER A SECURITY BOUNDARY. /etc/qmanager cannot hold a
  root-pinned file — www-data owns it and qmanager_setup re-chowns it every boot.
  Confirmed on both devices.
- OTA COMPATIBILITY FLOOR: update.sh:245 interpolates its URL and never reads
  .assets[]. qmanager.tar.gz must keep being published forever.
- TAR SENTINEL: qmanager_update:165 greps a tarball for "install_rm520n.sh". That
  filename must remain in BOTH variant tarballs. Renaming the installer is out of
  scope.
- HEADLESS AUTO-PROCEED at install_rm520n.sh:399-409 must survive. Pre-v0.1.8 OTA
  workers do not pass --force — and the RG501Q is proof that path is load-bearing,
  since it is how an undetected device got installed at all.
- Support tiers are NOT surfaced in the UI in this phase (D7).
- Installer changes move in lockstep across install, uninstall, and OTA.

SAFETY — two live devices. RM520N-GL over SSH (.env triad, never printed);
RG501Q-EU over adb as uid=0 with no www-data speed bump. Both READ-ONLY this
session. Validate CGI as www-data, never as root.

Deliver: a plan at
docs/superpowers/plans/2026-08-24-phase-a-multi-target-platform.md and a tracker
at docs/superpowers/plans/2026-08-24-phase-a-tracker.md, both committed with
`git add -f`. Same shape as the A0 plan (Global Constraints, Conventions, numbered tasks,
per-task Files / Interfaces / checkbox Steps / verification / commit). Tasks
sized to ONE session each, ordered so each leaves the tree shippable. Tracker
schema is in the shared section below.

Raise at the approval gate, do NOT decide yourself:
- Whether the qcmd_test literal `RM520` grep (:50, :75) is folded into Phase A.
  It is a hardware-independent one-liner and the device is attached — bring the
  test RESULT, not a prediction.
- How agents select a transport per device: RM520N-GL over SSH, RG501Q-EU over
  adb. This supersedes the ".env credential scheme" question A0 deferred;
  platform-matrix.md names the files hardcoding the single-SSH assumption.
- Whether the RG501Q's broken v0.1.12 install stays frozen for Phase A, or may be
  wiped once its evidence is recorded in rg501q-bringup.md.
- Sequencing against Phase D, if D has not run yet.

GITIGNORE TRAP — OBSOLETE as of 2026-08-25, kept for context. `/docs/superpowers`
WAS gitignored, which made every file written there invisible to `git status` and
to the next session unless force-added. That is exactly why the rule was removed:
the trap this paragraph warns about was real and kept catching people. A plain
`git add` now works, and `git add -f` is merely redundant rather than required.
`/.claude` IS still gitignored and does still need `git add -f`.

Do not start Phase 4.
```

---

## Prompt 2 — one task, one fresh agent (BOTH tracks; substitute the track name)

```text
Continue Phase <A|D>. Orchestrated, ONE task this session.

You are a fresh agent with NO memory of any previous session. Everything you need
is on disk. Do not infer progress from the plan — a task's checkboxes tell you
what the task INVOLVES, only the tracker tells you what has actually HAPPENED. If
the tracker and the plan disagree about state, the tracker wins.

Read first, in this order:
1. docs/superpowers/plans/2026-08-24-phase-<a|d>-tracker.md — Status table, the
   Log's most recent entry, Device facts learned this phase, Open questions.
2. The matching plan doc — Global Constraints, and the task you are about to run.
3. docs/superpowers/specs/2026-08-23-multi-target-modem-support-design.md — §9
   (Amendment) always, plus only the §4 subsection your task touches. Sections
   1-8 predate adb access to the RG501Q; where §9, the tracker, or
   docs/reference/rg501q-bringup.md contradict them, the MEASUREMENT wins and you
   say so out loud.

Then:
- Confirm which task is next from the tracker and tell me which one and why,
  BEFORE doing anything else. If the previous entry's "what a later task might
  invalidate" note touches this task, say so.
- Verify the worktree precondition: the session must be on `development` and
  `git merge-base HEAD development` must equal `git rev-parse HEAD`. Then create
  the run worktree per Worktree Discipline, copy .env in (gitignored — agents
  lose SSH access to the RM520N without it), and run `bun install` only if this
  task needs a frontend build.
- Execute exactly that one task. Builders in parallel where file sets are
  provably disjoint; validators in a single parallel message, never serially.
  busybox-portability-checker on every shell/systemd change,
  installer-safety-auditor on anything touching the installer, units, sudoers,
  /usrdata layout, or OTA. Validate CGI as www-data, never as root.

- TWO LIVE DEVICES. RM520N-GL over SSH (.env triad, never print a value);
  RG501Q-EU over adb serial b7e3d6f1, a uid=0 root shell with no www-data speed
  bump. Read-only unless the tracker records that I approved a specific write.
  The RG501Q carries a previous owner's FAILED v0.1.12 install: only the Rust
  ping daemon works, the poller emits nothing without jq, lighttpd is not
  running. That is evidence, not a bug to fix in passing.
- Prove the gate before claiming done: RM520N behavior unchanged (show the
  command and its output — an assertion is not evidence), and the RG501Q's
  broken install not made harder to recover.
- Any RG501Q fact you learn goes in the tracker's "Device facts learned this
  phase" with its probe command and date, AND into
  docs/reference/platform-matrix.md. Unprobed stays *unverified*.
- Close out: update the tracker (Status row, Log entry, Invariants checklist,
  Device facts, Open questions), then commit. `/docs/superpowers` is GITIGNORED
  (.gitignore:53), so the tracker needs `git add -f` or your update is invisible
  to the next session; verify with `git ls-files --error-unmatch <tracker>`.
  Then ask me — merge into development,
  keep the branch, or discard. Never auto-merge.

If the task is bigger than one session, STOP at a shippable point, record exactly
where in the tracker, and tell me. Do not run over into the next task.
```

---

## Shared tracker schema (both tracks)

```markdown
## Status
| # | Task | Tier | Owner agents | State | Session | Commit | Notes |
States: `blocked` / `ready` / `in progress` / `done` / `deferred`.

## Invariants re-verified each task
Re-run at EVERY task close-out, not just at the end:
RM520N no-op holds; RG501Q's broken install not made harder to recover;
qmanager.tar.gz still published; install_rm520n.sh still in the tarball;
headless auto-proceed intact; validate_url() still rejects arbitrary refs;
no SoC logic in platform.sh; no unprobed RG501Q value written as measured.

## Device facts learned this phase
Every measurement with its probe command and date. Staging area for
platform-matrix.md — if a fact is here it must also be in the matrix, or say
why not.

## Log
One section per completed task: what shipped, what was verified and HOW (the
command and its output), what was deferred and why, and what the NEXT session
must know. A0's final review found a defect no per-task review could see —
citations drifting because two tasks each edited a file the other did not touch
— so every entry must also name what it changed that a LATER task might
invalidate.

## Open questions
Carried forward between sessions, with who must answer.
```

### Kickoff close-out (both tracks)

The next session is a FRESH agent that can only read what is on disk. Before
ending a kickoff session:

- Commit the plan, the tracker, and any `platform-matrix.md` rows the probe filled.
  An uncommitted tracker is invisible to the next session — and because
  `/docs/superpowers` is gitignored, "uncommitted" is the DEFAULT there. Use
  `git add -f`, then verify with `git ls-files --error-unmatch <file>`.
- Seed the Status table with EVERY task at `ready` or `blocked` (with what blocks
  it). An empty table reads as "nothing to do".
- Record the gate answers in Open questions, marked resolved, with the reasoning —
  otherwise the next agent re-litigates decisions already made.
- Record probe results in "Device facts learned this phase" with the exact adb
  command and date, including the ones that merely confirmed expectations.
- State explicitly that planning is done and the next step is a fresh session with
  Prompt 2.

---

## The gitignore trap, and why it matters twice

**Both** superpowers directories are gitignored: `.superpowers/` at
`.gitignore:52` and `/docs/superpowers` at `.gitignore:53`.

A0's run record lived in `.superpowers/sdd/`. It was never committed, and removing
the A0 worktree would have destroyed the entire review chain — it survived only
because it was copied out by hand first.

Moving the trackers to `docs/superpowers/plans/` does **not** fix that by itself,
because that path is ignored too. The A0 plan and the design spec are tracked
there only because someone ran `git add -f`. That is the repo's existing
convention and these prompts follow it — but it means **every** plan and tracker
write needs an explicit force-add, and `git status` stays silent when you forget.
Verify with `git ls-files --error-unmatch <file>`, never with `git status`.
