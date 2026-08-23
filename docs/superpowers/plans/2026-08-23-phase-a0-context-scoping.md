# Phase A0 — Context Re-Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every platform fact in the repo state which modem it was measured on, so that adding RG501Q-EU support cannot silently contaminate RM520N-GL knowledge or vice versa.

**Architecture:** Documentation only — no shell, no TypeScript, no shipped behavior changes. Three mechanisms: a two-line scope header on every platform-coupled doc; a single canonical `docs/reference/platform-matrix.md` holding all per-device deltas (generalizing the existing `data-counter-platform-matrix.md`, which already proves the pattern); and a scope column in `CLAUDE.md`'s routing table so device relevance is known *before* a doc is opened. Auto-memory and agent memory get device scope in their `description:` line.

**Tech Stack:** Markdown only. No build step. Verification is `grep`-based, not test-based.

**Spec:** `docs/superpowers/specs/2026-08-23-multi-target-modem-support-design.md` — read §5 (Context integrity) in full before starting. Decisions D9 and D10 govern this plan.

---

## Global Constraints

Copied verbatim from the spec and the project's standing rules. Every task's requirements implicitly include this section.

- **Docs only.** This phase changes no `.sh`, `.ts`, `.tsx`, `.json` (except memory frontmatter) or systemd unit. If a task appears to require a code change, STOP and report — it belongs to Phase A, not A0.
- **Zero behavior change.** Nothing in this phase may alter what ships to a device. The validation gate is that `git diff --stat` touches only `*.md` files plus `CLAUDE.md`.
- **The two reference devices, named exactly:**
  - `RM520N-GL` — M.2 form factor, Qualcomm `SDX65` / LEMUR. The reference device; everything currently documented was measured here.
  - `RG501Q-EU` — LGA form factor, Qualcomm `SDX55` / PRAIRIE. Not yet probed. **Every claim about it is `unverified` until Phase B.**
- **`unverified` is written, never implied.** Absence of a device column is what caused this problem. A fact with no RG501Q measurement says `unverified` explicitly.
- **Never invent a measurement.** No task in this phase may state a value for RG501Q-EU. If a source doc appears to already know one, flag it — it is either a genuine prior finding worth capturing or an assumption worth killing.
- **Community-tier devices are out of scope as columns.** RM502Q-AE and other X55 modems run these releases unsupported. They are mentioned in prose where relevant but do NOT get matrix columns; the matrix has exactly two device columns.
- **Do not "fix" the facts.** This phase adds provenance to existing claims. Correcting, updating, or re-verifying a claim is out of scope even if it looks wrong — flag it instead.
- **Preserve file identity.** `data-counter-platform-matrix.md` is referenced from `CLAUDE.md` and other docs. Renaming or removing it requires updating every inbound reference in the same task.
- **Line endings:** the repo is mixed; git reports `LF will be replaced by CRLF`. Do not bulk-reformat any file. Edit surgically — a whole-file rewrite that flips line endings makes the diff unreviewable.

---

## Conventions (the exact formats every task applies)

### C1 — Scope header

The first content in a platform-coupled doc's body, immediately after the `# Title` line and before any prose:

```markdown
> **Applies to:** RM520N-GL (SDX65) · verified 2026-08
> **RG501Q-EU (SDX55):** unverified — see [`platform-matrix.md`](./platform-matrix.md)
```

For a doc whose every claim is QManager-design (modem-independent):

```markdown
> **Applies to:** all supported modems — no device-measured claims in this document.
```

Rules:
- Two lines for coupled docs. One line for agnostic docs. Never omit it from a doc the census classified.
- The date is the month the claim set was last verified, not today's date, unless they coincide.
- Blockquote (`>`) so it renders as a distinct band and is greppable via `^> \*\*Applies to:`.

### C2 — `platform-matrix.md` row format

| Column | Content |
| --- | --- |
| `Fact` | The device-measured claim, phrased as a noun phrase, not a sentence |
| `RM520N-GL (SDX65)` | The measured value |
| `RG501Q-EU (SDX55)` | `*unverified*` in Phase A0 — Phase B fills these |
| `How established` | `on-device <YYYY-MM>` / `vendor doc` / `inferred` — plus the source doc |

Rules:
- One row per fact. A compound claim is split into separate rows.
- `*unverified*` is italicized so a filled cell is visually obvious.
- Grouped under `##` headings by subsystem (Boot & time, Filesystem, Shell & toolchain, AT transport, Network interfaces, Power & thermal).

### C3 — `CLAUDE.md` routing table scope column

The existing "Feature-Specific Notes" table gains one column, positioned **before** the doc link:

| Feature | Touch it when you're working on | Scope | Doc |

Values, exactly these three strings:
- `RM520N` — contains device-measured claims; unverified on RG501Q
- `Both` — QManager-design only; modem-independent
- `Matrix` — the doc's device facts live in `platform-matrix.md`

### C4 — Memory device scope

In each affected memory's frontmatter `description:` line, prefix the device in brackets:

```yaml
description: "[RM520N-GL] Device jq has NO regex — gsub/test/match abort at runtime"
```

Rules:
- Only `DEVICE-MEASURED` memories get the prefix. QManager-design and tooling memories are left alone.
- The matching one-line pointer in `MEMORY.md` gets the same prefix, so it is visible in the index too.
- Body text is not rewritten — only the `description:` and the index line change.

---

## Census results (the inventory these tasks act on)

Three read-only censuses ran 2026-08-23. Totals:

| Surface | Total | Needs work | Leave alone |
| --- | --- | --- | --- |
| `docs/reference/*.md` | 41 | 34 need a scope header | 7 (see T3) |
| Auto-memory | 60 | 15 device-measured | 22 design + 21 tooling + 1 ambiguous |
| Agent definitions | 6 | all 6 | — |
| `CLAUDE.md` routing table | 37 rows | all 37 get a scope cell | — |

**Highest-claim-density docs** (do these first — most likely to mislead):
`wan-profile-management.md` (~15), `qmanager-independence.md` (~14),
`cellular-basic-settings.md` (~14), `frequency-locking.md` (~13),
`tower-locking.md` (~13), `sim-profiles.md` (~12), `scheduled-timers.md` (~11).

**Two findings that change scope from the spec:**

1. `docs/BACKEND.md:3` does not merely omit a qualifier — it **asserts** single-target: *"QManager ships for a single target… There is no multi-SKU product matrix."* This must be retracted, not annotated (T2).
2. `docs/rm520n-gl-architecture.md:121` claims findings were *"cross-referenced with PRAIRIE deviations called out in CLAUDE.md"* — no such content exists in `CLAUDE.md`. Dangling reference (T2).

**Existing correct examples — copy their style, do not invent a new one:**
`data-counter-platform-matrix.md` (per-SoC columns throughout),
`rm520n-gl-architecture.md:69` (SDXLEMUR vs SDXPRAIRIE family map),
`qmanager-independence.md:270-278` and `docs/BACKEND.md:1025` (real PRAIRIE caveats),
`at-command-transport.md:9-12` (RM551E vs RM520N-GL comparison table).

---

## Task List

Tasks are ordered so that T1 exists before anything links to it. T3–T5 are
independent of each other and may run in parallel; T6 and T7 are independent of
all of them.

---

### Task 1: Create `platform-matrix.md`

**Files:**
- Create: `docs/reference/platform-matrix.md`
- Read (do not modify): `docs/reference/data-counter-platform-matrix.md`

**Interfaces:**
- Produces: the canonical anchor every scope header in T3 links to (`./platform-matrix.md`), and the fact rows T2/T4/T5 point at instead of restating.

- [ ] **Step 1: Read the pattern source**

Read `docs/reference/data-counter-platform-matrix.md` in full. It is the one doc that already does this correctly. Note specifically: one row per fact, one column per platform, and prose phrased conditionally (*"On firmwares where X (like SDX55)…"*) rather than as *"the modem does X."*

- [ ] **Step 2: Create the file with this exact skeleton**

```markdown
# Platform Matrix — per-device facts

> **Applies to:** all supported modems. This document is the single canonical
> home for facts that differ by device. Any doc asserting a device-measured fact
> should link here rather than restating it.

Two supported devices. Community-tier modems (RM502Q-AE and other SDX55 parts)
run these releases unsupported and deliberately get **no column** — see the
design spec, D7.

| | RM520N-GL | RG501Q-EU |
| --- | --- | --- |
| Form factor | M.2 | LGA |
| SoC | SDX65 / LEMUR | SDX55 / PRAIRIE |
| `Branch Name` in `/etc/quectel-project-version` | `SDX6X` | *unverified* |
| Status | reference device | onboarding — Phase B |

## Boot & time
## Filesystem & partitions
## Shell & toolchain
## AT transport
## Network interfaces
## CPU & ABI
```

- [ ] **Step 3: Populate rows from the census**

Under each heading, add rows in the C2 format. Seed with at minimum these
device-measured facts, all currently RM520N-GL-only:

| Heading | Facts to seed |
| --- | --- |
| Boot & time | no battery RTC / boots at Jan 1970; `ql_time_daemon` steps clock ~24s in; `OnCalendar` timers misfire twice per boot; no `crond` daemon running (binary present); `systemd-time-wait-sync` absent; journald disabled device-wide |
| Filesystem & partitions | rootfs `ubi0:rootfs` boots `ro` (proof: `ro` in `/proc/cmdline`); `/etc` + `/usrdata` share `ubi2_0`, always rw; `/tmp` is tmpfs `root:root 1777` ~89 MB; `fs.protected_regular=1` enabled |
| Shell & toolchain | BusyBox v1.31.1; `flock` lacks `-w`; bare-FD `flock` form works; fractional `sleep` supported; `/bin/bash` 3.2.57 present; Entware `jq` 1.7.1 without ONIGURUMA; no `sftp-server`; no `stdbuf`; `pid_max` 32768 |
| AT transport | `/dev/smd11` (Qualcomm SMD char device); udev subsystem `glinkpkt`; returns `ENOTTY` for `tcgetattr`; no resident URC listener, `smd11` not selectable via `AT+QURCCFG="urcport"`; `AT+CGAUTH` unsupported (returns `ERROR`); no per-context MTU write |
| Network interfaces | `eth0` is Realtek RTL8125B via out-of-tree `r8125`; TTL interface `rmnet+`; WAN data interface index migrates across attach cycles; attach cycle drops the eth0 PHY ~4s |
| CPU & ABI | single-core ARMv7-A Cortex-A7 ~1.2 GHz; 178 MB RAM; `vfp vfpv3 vfpv4 neon` present so armhf runs; `aarch64` will not run; glibc 2.31; kernel `5.4.210-perf` |

Every `RG501Q-EU` cell is `*unverified*`. **No exceptions** — per Global Constraints, this phase never states an RG501Q value.

- [ ] **Step 4: Carry over the two known PRAIRIE-family caveats, correctly hedged**

`qmanager-independence.md:276-278` and `docs/BACKEND.md:1025` already record that on PRAIRIE-derived platforms the modem re-creates `/dev/smd11` *after* `qmanager-setup.service` runs, and that the udev subsystem name differs. Add these as rows — but the RG501Q cell stays `*unverified*`, with a note: those caveats were established for **RG502Q/RM502Q**, not RG501Q-EU. Same family, different model. Record it as a Phase-B hypothesis, never as a measurement.

- [ ] **Step 5: Verify no invented values**

Run: `grep -n "RG501Q" docs/reference/platform-matrix.md | grep -v "unverified" | grep -v "LGA" | grep -v "SDX55" | grep -v "PRAIRIE" | grep -v "Phase B"`
Expected: no output. Any hit is an invented measurement — remove it.

- [ ] **Step 6: Commit**

```bash
git add docs/reference/platform-matrix.md
git commit -m "docs(platform): add canonical per-device fact matrix"
```

---

### Task 2: Retract the single-target assertions

**Files:**
- Modify: `docs/BACKEND.md:3-10`
- Modify: `docs/rm520n-gl-architecture.md:121`

**Interfaces:**
- Consumes: `docs/reference/platform-matrix.md` from T1 (links to it).

- [ ] **Step 1: Read the current text**

Run: `sed -n '1,12p' docs/BACKEND.md`

Confirm it contains *"QManager ships for a single target"* and *"There is no multi-SKU product matrix."*

- [ ] **Step 2: Replace the framing paragraph**

Replace the single-target assertion with:

```markdown
**Target platforms:** QManager supports two modems — the **RM520N-GL** (M.2,
X62 silicon on the SDXLEMUR SoC, ARMv7l Cortex-A7) as the reference device, and
the **RG501Q-EU** (LGA, SDXPRAIRIE/SDX55), onboarding as of 2026-08. Per-device
facts live in [`reference/platform-matrix.md`](./reference/platform-matrix.md).

Probe data in this document was collected on the **RM520N-GL** unless a passage
says otherwise. Where this doc says "the platform", read it as "the RM520N-GL's
on-modem Quectel userspace stack" — those claims are **unverified on RG501Q-EU**.
```

Keep the existing sentence about the OEM build string saying `SDX65` while the part is X62 — it is accurate and RM520N-GL-scoped.

- [ ] **Step 3: Fix the dangling cross-reference**

In `docs/rm520n-gl-architecture.md:121`, the phrase *"cross-referenced with PRAIRIE deviations called out in CLAUDE.md"* points at content that does not exist. Repoint it:

```markdown
cross-referenced with PRAIRIE deviations recorded in
[`reference/platform-matrix.md`](./reference/platform-matrix.md)
```

- [ ] **Step 4: Verify the assertion is gone**

Run: `grep -rn "single target\|no multi-SKU\|only one target" docs/ CLAUDE.md`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add docs/BACKEND.md docs/rm520n-gl-architecture.md
git commit -m "docs: retract single-target assertion, fix dangling PRAIRIE xref"
```

---

### Task 3: Scope headers on 34 reference docs

**Files:** Modify each of the 34 docs listed below. **Do NOT touch** these 7:
`color-system.md`, `dashboard-chart-cards.md`, `dashboard-state-motion.md`,
`data-counter-platform-matrix.md`, `i18n.md`, `icon-system.md`,
`redesign-proposal-playbook.md`.

**Interfaces:**
- Consumes: `platform-matrix.md` from T1 (every header links to it).

Batch A (highest density — 7 files): `wan-profile-management.md`,
`qmanager-independence.md`, `cellular-basic-settings.md`, `frequency-locking.md`,
`tower-locking.md`, `sim-profiles.md`, `scheduled-timers.md`

Batch B (14 files): `README.md`, `alerts.md`, `at-command-transport.md`,
`band-locking.md`, `carrier-aggregation.md`, `cell-scanner.md`,
`connection-watchdog.md`, `custom-dns.md`, `data-usage-counter.md`,
`recent-activities.md`, `sms.md`, `speedtest.md`, `timezone.md`,
`tmp-file-ownership.md`

Batch C (13 files): `antenna-alignment.md`, `antenna-statistics.md`,
`auth-rate-limiting.md`, `cellular-settings-family.md`, `change-workflow.md`,
`connection-quality.md`, `discord-bot.md`, `ethernet.md`,
`i18n-runtime-download-increment-b.md`, `overview-splash.md`,
`radio-information.md`, `sim-detection.md`, `sms-forwarding.md`

- [ ] **Step 1: Insert the header in each file**

Immediately after the `# Title` line, insert exactly (C1):

```markdown

> **Applies to:** RM520N-GL (SDX65) · verified 2026-08
> **RG501Q-EU (SDX55):** unverified — see [`platform-matrix.md`](./platform-matrix.md)
```

`README.md` links to `./platform-matrix.md` too — it is in the same directory.

- [ ] **Step 2: Do not rewrite the bodies**

This task adds headers ONLY. Do not requalify individual sentences, do not move facts into the matrix, do not correct anything. Body rewrites are deliberately deferred — a 2,743-line file like `sim-profiles.md` cannot be safely reworded in the same pass that adds a header.

- [ ] **Step 3: Verify coverage — exactly 34**

```bash
cd docs/reference
grep -L '^> \*\*Applies to:\*\*' *.md
```
Expected output: exactly the 7 excluded files above. Any other filename listed is a miss.

- [ ] **Step 4: Verify no body drift**

```bash
git diff --stat docs/reference/
```
Expected: each of the 34 files shows `2 ++` (or `3 ++` counting the blank line). A file showing more changed lines means a body was edited — revert it.

- [ ] **Step 5: Commit per batch**

```bash
git add docs/reference/
git commit -m "docs(reference): add device scope headers (batch A/B/C)"
```

---

### Task 4: `CLAUDE.md` scope column and platform-section qualification

**Files:**
- Modify: `CLAUDE.md` — routing table (37 rows), "RM520N-GL Platform" section, "System Differences" table

- [ ] **Step 1: Add the scope column to the routing table**

Current header, verbatim:
```
| Feature | Touch it when you're working on | Doc |
```
Becomes:
```
| Feature | Touch it when you're working on | Scope | Doc |
```

Fill each of the 37 rows using C3's three values. `Matrix` for rows whose doc is `data-counter-platform-matrix.md`; `Both` for rows pointing at `color-system.md`, `icon-system.md`, `i18n.md`, `dashboard-chart-cards.md`, `dashboard-state-motion.md`; `RM520N` for all others. Cross-check against T3's exclusion list — a doc that got a scope header is `RM520N`.

- [ ] **Step 2: Retitle and qualify the platform section**

`## RM520N-GL Platform` becomes `## Modem Platforms`, and its opening claim gains an explicit device scope plus a pointer to the matrix. The kernel version, SoC name, and ARMv7l claim are RM520N-GL measurements — say so.

- [ ] **Step 3: Fix the binary framing of the System Differences table**

The table is currently `RM551E (OpenWRT)` vs `RM520N-GL (Vanilla Linux)`. Its column header must become `RM520N-GL (SDX65)` and a sentence added beneath: RG501Q-EU values are unverified and live in `platform-matrix.md`. **Do not add an RG501Q column here** — the matrix owns that; two homes for the same fact is how drift starts.

- [ ] **Step 4: Qualify the embedded device fact in the routing table**

The Scheduled Reboot row states *"RM520N has no working `crond`"* inline. Leave the fact but ensure it names the device (it already does) — flag it as a matrix duplicate for a later pass rather than deleting it now.

- [ ] **Step 5: Verify**

```bash
grep -c '^| ' CLAUDE.md                        # table rows unchanged in count
grep -n 'Scope' CLAUDE.md | head               # column present
```
Expected: the routing table has the same row count as before (37 + header + separator).

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude-md): add device-scope column, qualify platform claims"
```

---

### Task 5: Scope the six agent definitions

**Files:** Modify all of `.claude/agents/modem-investigator.md`,
`busybox-portability-checker.md`, `installer-safety-auditor.md`,
`cgi-endpoint-builder.md`, `docs-writer.md`, `ui-builder.md`

**Note:** `.claude/` is gitignored — these need `git add -f`.

- [ ] **Step 1: Replace the repeated platform paragraph**

All six repeat a variant of *"the RM520N-GL runs vanilla Linux (SDXLEMUR, ARMv7l, kernel 5.4.210) — NOT OpenWRT."* In each, qualify it and add the second device.

- [ ] **Step 2: Add runtime detection to every agent that touches a device**

The census's sharpest finding: **no agent definition mentions `/etc/quectel-project-version`**, the detection sentinel the shipped code already uses. Add to `modem-investigator`, `busybox-portability-checker`, and `installer-safety-auditor`:

```markdown
**Identify the device before trusting any platform fact.** Read
`/etc/quectel-project-version`: `Project Name:` gives the model
(`RM520N…` / `RG501Q…`), `Branch Name:` gives the SoC (`SDX6X` / `SDX55`).
Facts in `docs/reference/*.md` are RM520N-GL measurements unless their scope
header says otherwise — check `docs/reference/platform-matrix.md` before
applying one to a different device.
```

- [ ] **Step 3: Fix the two-target framing**

`busybox-portability-checker.md:15` and `cgi-endpoint-builder.md:13` frame the world as "current vanilla-Linux target vs. legacy OpenWRT target we migrated FROM", leaving no slot for a second vanilla-Linux target we now ship TO. Reword to three: legacy RM551E (OpenWRT, not a target), RM520N-GL, RG501Q-EU.

- [ ] **Step 4: Record the credential gap — do not solve it here**

Three files (`CLAUDE.md`, `modem-investigator.md`, `busybox-portability-checker.md`) plus `.claude/agent-memory/modem-investigator/stale_env_ssh_password.md` hardcode the single triad `MODEM_IP` / `MODEM_SSH_USER` / `MODEM_SSH_PASSWORD`. A second device needs either a per-device prefix or a selector variable.

**This is a Phase-B prerequisite, not an A0 deliverable** — picking a scheme without a second device to test against is guesswork. Add a note to `platform-matrix.md` recording the gap and the three files that must change. **Never print a credential value.**

- [ ] **Step 5: Verify**

```bash
grep -rln "quectel-project-version" .claude/agents/
```
Expected: `modem-investigator.md`, `busybox-portability-checker.md`, `installer-safety-auditor.md`.

- [ ] **Step 6: Commit**

```bash
git add -f .claude/agents/
git commit -m "docs(agents): scope platform facts per device, add runtime detection"
```

---

### Task 6: Device-scope the 15 device-measured memories

**Files:** Modify the `description:` frontmatter line of these 15 files under
`C:\Users\RUS-LEGION5\.claude\projects\D--Projects-QM-PROJECT-QManager-RM520N\memory\`,
plus their matching pointer lines in `MEMORY.md`:

`feedback_apn_save_needs_attach_cycle.md`, `feedback_rootfs_remount_is_required_truth.md`,
`reference_attach_cycle_drops_eth0_link.md`, `reference_busybox_flock_fd_form_works.md`,
`reference_carrier_icmp_blocked_rmnet.md`, `reference_cgcontrdp_wire_format_quirks.md`,
`reference_deploying_web_assets_to_device.md`, `reference_etc_persistent_ubifs.md`,
`reference_euicc_lpa_feasibility_confirmed.md`, `reference_jq_no_oniguruma_regex.md`,
`reference_poller_cadence_3s_not_2s.md`, `reference_rm520n_1970_boot_window_breaks_oncalendar.md`,
`reference_rm520n_hardfloat_vfp_ok.md`, `reference_rm520n_no_crond_use_systemd_timers.md`,
`reference_tmp_protected_regular_blocks_root.md`

- [ ] **Step 1: Prefix each `description:` with the device (C4)**

Example — `reference_jq_no_oniguruma_regex.md`:
```yaml
description: "[RM520N-GL] Device jq has NO regex — gsub/test/match abort at runtime"
```

- [ ] **Step 2: Mirror the prefix into `MEMORY.md`**

Each of the 15 has a one-line pointer in `MEMORY.md`. Add the same `[RM520N-GL]` prefix so it is visible in the index, not only after the file is opened.

- [ ] **Step 3: Flag the one likely-inapplicable memory**

`reference_attach_cycle_drops_eth0_link.md` records a ~4s link drop caused by the **r8125 PHY on the M.2 carrier board**. RG501Q-EU is LGA — different carrier board, possibly no onboard Ethernet. Its body gets one added line:

```markdown
**RG501Q-EU:** likely inapplicable — this is an M.2-carrier-board PHY behavior,
not a modem behavior. Verify in Phase B before assuming it transfers.
```

- [ ] **Step 4: Leave the other 45 alone**

22 QManager-design and 21 tooling memories are modem-independent. The 1 ambiguous memory (`project_apn_attach_cycle_missing_in_profile_apply.md`) stays unmodified and is raised at the gate.

- [ ] **Step 5: Verify**

```bash
cd "C:/Users/RUS-LEGION5/.claude/projects/D--Projects-QM-PROJECT-QManager-RM520N/memory"
grep -l '\[RM520N-GL\]' *.md | wc -l      # expect 15
grep -c '\[RM520N-GL\]' MEMORY.md          # expect 15
```

- [ ] **Step 6: No commit**

This directory is outside the repo. Nothing to commit.

---

### Task 7: Final verification

- [ ] **Step 1: Confirm docs-only**

```bash
git diff --stat development -- . ':!docs' ':!CLAUDE.md'
```
Expected: empty. Any `.sh` / `.ts` / `.tsx` / `.json` change is a Global Constraints violation.

- [ ] **Step 2: Confirm no invented RG501Q measurements**

```bash
grep -rn "RG501Q" docs/ CLAUDE.md | grep -viE "unverified|LGA|SDX55|PRAIRIE|Phase B|onboarding|platform-matrix|RG501Q-EU\)" 
```
Review every hit by hand. A stated value is a bug.

- [ ] **Step 3: Confirm scope-header coverage**

```bash
cd docs/reference && grep -L '^> \*\*Applies to:\*\*' *.md
```
Expected: exactly the 7 excluded files.

- [ ] **Step 4: Confirm no line-ending churn**

```bash
git diff --stat | tail -1
```
A file showing hundreds of changed lines it shouldn't have means line endings flipped — revert and redo surgically.

