# Lanes: classifying a request and trimming a gate

Three lanes replace the old Tier 0–4 scale. Ceremony scales with the lane; **which agent fires is decided by the flag table in `SKILL.md`**. A flag forces the lane upward, never downward.

## Deciding the lane

1. Run the dispatch gate — multiple stages/files/surfaces? would inline work burn lead quota on non-judgment typing? Both no → **Direct**.
2. Check the flag table. Any installer/timer flag → **Full**. Any unknown mechanism → **Full** until recon measures it.
3. Otherwise size it: one layer and ≤ ~3 files → **Lite**; cross-layer, a new backend field, or > 3 files → **Full**.
4. Name the lane in the first header. A lane is decided once; if you are tempted to skip a gate mid-flow, re-lane instead.

Bug fixes take the lane of the *fix*. A bug with an unknown cause is Full until recon measures the mechanism — a frontend symptom suspected to originate in the backend is a Full-lane investigation wearing a Lite costume, and recon tells those apart. Pure refactors with no behaviour change drop one lane; validators still run.

## What each lane skips

**Direct** — no ledger, no agents, no approval. The commit body carries the mechanism and the proof output.

**Lite** — keeps the approval gate in its one-line form ("here is the fix and the probe that proves it, ok?"), keeps every deterministic gate, keeps the on-device run or page load, and keeps `qm-verifier` when the change has logic content. It skips recon, builder pre-flight, and `docs-writer`: dispatching a closer to append one docs row costs more than the row, so the conductor writes it.

**Full** — everything, in order: recon fan-out → plan → `AskUserQuestion` gate → worktree → build waves → verify → `docs-writer` → close-out.

## Frontend-only qualification

A change is frontend-only when every file it touches lives in `components/`, `hooks/`, `lib/`, `app/`, `types/`, `constants/` or `public/locales/`, **and** it reads no field that does not already exist in the poller snapshot. `modem-investigator` does not run — it would probe a layer nobody is editing. The moment it needs a *new* backend field it stops qualifying: re-lane to Full and run recon then.

It does **not** qualify if the change touches a CGI script, a poller field, a systemd unit, the installer, sudoers, `/usrdata/`, or the OTA path.

## Backend Lite qualification

All four must hold:

1. **One shell file.**
2. **The mechanism is already measured**, not hypothesized — a captured exit code, an observed output difference, a documented version divergence. A theory does not qualify; a probe transcript does.
3. **Nothing new lands on the device** that the uninstaller or OTA path would need to know about. This is the sharp form of the lockstep rule and the real test for whether `installer-safety-auditor` has anything to audit.
4. **No sudoers, systemd unit, `/usrdata/` layout, or install-ordering change.**

## Worked examples, from real changes

| Change | Lane | Why |
|---|---|---|
| Entware / `wget` bootstrap | **Full** | +163 lines, a new shim, a new bootstrap function, 44 packages landing. Criteria 1 and 3 both fail |
| `qm_timeout` wrapper | **Full, but skip recon** | Mechanism was measured, so no `modem-investigator`. The detector fix makes `coreutils-timeout` install for the first time — criterion 3 fails, so the auditor still fires |
| curl-guard one-liner | **Full, keep the auditor** | The guard controls a `/usr/bin/curl` symlink, which is exactly an uninstaller-lockstep question. Recon still skipped |
| A `timeout` call site routed through an existing wrapper | **Lite** | One file, mechanism already measured on both devices, nothing new installed |

**Trimming one gate is the common case; trimming both is rare.** Routing by competency stops a guaranteed-empty dispatch: `modem-investigator` once fired on a `timeout` fix whose transport does not use `timeout` at all.

## Run it before you dispatch

The first move on any portability or behaviour question is running the candidate command on the device — both devices, diffed, for a multi-target question. That costs no dispatch and returns ground truth. Every cross-device defect found so far came from running a command on a second device; none from an agent reading code. Reach for an agent when the mechanism is *unknown* or the surface is too wide to run, never to re-confirm a measurement.

## The advocate is exempt from every trim on this page

Everything above cuts dispatches whose *subject matter* is not at risk. `qm-advocate` is not scoped to a subject — its job is to attack the conclusion, and that is at risk on every investigation by definition. It once caught a plan whose prescribed placement wrote no `platform.json` at all on a fresh install — a feature shipping silently non-functional — and on another run overturned or re-scoped four of six tracked items. When trimming further, trim gates, never the advocate.

## Redesigns

A request of the shape "apply our finalized design language to surface X" or "redesign the Y page" runs `docs/reference/redesign-proposal-playbook.md` for recon and plan instead of the default triage. It adds one deliverable the standard flow has no slot for: a published sample-design Artifact the user approves before any component is written. Everything after the gate is a normal Full-lane run. It does not cover a UI bug fix, a copy change, or one added card — those are Lite.
