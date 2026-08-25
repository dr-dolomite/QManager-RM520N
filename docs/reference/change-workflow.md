# Change Workflow

> **Applies to:** RM520N-GL (SDX65) · verified 2026-08
> **RG501Q-EU (SDX55):** unverified — see [`platform-matrix.md`](./platform-matrix.md)

Every code-change request in this repo follows a tier-routed, 6-phase flow. The main session orchestrates; the specialist agents do the work. The user holds the approval gate. This flow is the project default for code changes and supersedes the generic brainstorming / writing-plans / verification skills; tests are written **before** the fix inside Phase 4 — see [Tests Come First](#tests-come-first-phase-4a).

**Signal each phase transition** with a header so the user always knows where we are: `**[Phase 1 — Triage]**`, `**[Phase 2 — Plan]**`, `**[Phase 3 — Approval]**`, `**[Phase 4 — Execute]**`, `**[Phase 5 — Validation]**`, `**[Phase 6 — Docs & Close]**`.

## The 6 Phases

1. **Triage & Recon (orchestrator):** Classify the request into Tier 0–4 by blast radius, then fire gates **by competency** (see Gate Routing below) — not by tier alone. Tier decides *ceremony*; competency decides *which gate agent runs*. Synthesize findings.
2. **Plan (orchestrator synthesizes, builders pre-flight):** For Tier 2+, dispatch builder agents in parallel — `cgi-endpoint-builder` (backend CGI / daemons / libs / AT flows) and/or `ui-builder` (pages / cards / hooks / types). They return scaffolding + design notes, NOT committed code. Synthesize into ONE plan: tier, agent roster, file list, build order, risks, post-flight validator list, **and a Test Contract** (see below) for any change that will land or touch a harness.
3. **Approval Gate (user):** Plan changes here are cheap; later changes are not.
4. **Execute (builders), in two steps.** **4a — harness first:** write the test from the Test Contract, run it, and commit it **red** with the failing output pasted into the commit body. **4b — then the fix:** bottom-up for cross-layer work (poller → CGI → hook → component → alerts), parallel where files are independent, sequential where there's a data dependency. The builder doing 4b may not edit the harness.
5. **Post-Flight Validation (parallel, ONE message):** Fire every applicable validator in a single message: `busybox-portability-checker` (static audit **and** scoped on-device verification of the deployed change), `installer-safety-auditor` (verify mode, for installer/systemd/OTA changes). Loop failures back to Phase 4 — but after **2 failed validation rounds**, stop and surface to the user instead of looping further.
6. **Docs & Close (`docs-writer`):** Update `docs/reference/`, the routing tables in `CLAUDE.md`, and `RELEASE_NOTES.md` as needed. Report summary + git status.

## Tests Come First (Phase 4a)

**The test is written from the plan, before the fix exists.** Not because red-green is a ritual, but because a test written after the fix can only agree with it. Measured on this repo: of the harnesses in `scripts/test/`, six were committed red first (`bd7ca4d` "fails against current impl", `7c21bec` "(red)", the two poller skeletons, the two fixture harnesses) and ten landed in the same commit as their feature or fix — including **all four installer harnesses**. The same-commit ones are not worthless, but every one of them was shaped around code that already existed.

### The Test Contract (written in Phase 2, approved in Phase 3)

The plan names, precisely enough to write a test against:

- **Exact symbol names** — the function, the config key, the CGI action, the JSON field.
- **The call site / wiring requirement** — where it is invoked from, and anywhere it must *not* be (a gate that would make the fix invisible on OTA, for instance).
- **The observable assertions** — what must be true afterward, and the specific defect shape being pinned.

This is what makes a text-anchored test independent. Grepping for a function name is not bias; grepping for a name the *builder invented while writing the fix* is. When the name comes from an approved plan, the test pins the spec, and a builder who renames it, re-gates it, or substitutes a weaker mechanism fails the test — which is the entire point.

### Behavioural where possible, textual where it isn't

Poller / CGI / parser harnesses run real fixtures through real code and are red-first **and** behavioural. Installer harnesses can only assert over source text, for two measured reasons:

- `install_rm520n.sh:3693` is a bare `main "$@"` with no `BASH_SOURCE` guard, so a harness cannot source the file to call one function — it can only read it.
- The Windows/Git Bash workstation cannot model POSIX modes: `chmod 0666 f` then `stat -c %a f` returns `644`. A "the file ends up `0644`" assertion would pass trivially here whether or not the fix exists — worse than no test.

Where behaviour cannot be executed, ordering is the *only* defense against a self-agreeing test, which makes Phase 4a more important for installer work, not less.

### The floor, for work that skips the plan

Lite Path, skip phrases, and opportunistic fixes still owe the weaker version: **prove the harness fails against the pre-fix tree** — `git show HEAD:<file> > scratch/...` and run it there — and say so in the commit body with the failure count. That rules out a vacuous test even though it cannot rule out a test shaped by the code (`d7f30fb`/F13 is the reference example, and stays as written rather than being retrofitted: rewriting it after the fact would hide that history, not repair it).

### A red commit blocks nothing

`bun run package` gates on `run-all.sh` only (syntax + CRLF). The deep harnesses run through `run-harnesses.sh` / `bun run test:harness`, which nothing gates on automatically — so a knowingly-red harness sitting on a feature branch for one commit cannot jam a build.

### Validation is still Phase 5

None of this moves the validators. `busybox-portability-checker` and `installer-safety-auditor` still run **after** the fix, on the finished change, in one parallel message.

## Tier Routing

| Tier | Scope | Flow |
|------|-------|------|
| 0 | Typos, comments, copy edits, version bumps | Direct edit, no agents, no plan |
| 1 | Single existing file in one layer | Skip Phase 2–3. Implement + the layer's validator + maybe docs |
| 2 | New feature, single layer | Full flow; pre-flight is the layer's builder only. **Frontend-only work takes the Lite Path below** |
| 3 | Cross-layer feature (CGI + hook + component, or a poller field consumed across layers) | Full flow; gates per Gate Routing |
| 4 | Installer / systemd / sudoers / `/usrdata/` layout / OTA pipeline | Full flow; gates per Gate Routing. **A change that only alters how the installer *decides* something takes the Backend Lite Path** |

Bug fixes match the tier of the *fix*, not the bug. Pure refactors with no behavior change drop one tier (validators still run; builders don't pre-flight).

## Gate Routing — fire a gate when its subject is at risk

A gate agent is worth its cost only when the change has surface inside that agent's competency. Tier alone is the wrong trigger: it is keyed on *which file* was edited, and a file can be edited in ways that put nothing the gate knows about at risk.

| Gate | Fires when the change… | Does NOT fire because… |
| --- | --- | --- |
| `modem-investigator` | reads or writes modem state, or touches any link in the UI→hook→CGI→`qcmd`→modem chain | …the tier is high. A change with no modem surface gets no evidence from it |
| `installer-safety-auditor` | adds or removes an installed artifact (binary, unit, config key, sudoers rule), changes install **ordering** or a gate controlling whether a step runs, or touches OTA / uninstall lockstep | …`install_rm520n.sh` was edited. Editing the file is not the trigger; changing what lands on the device is |
| `busybox-portability-checker` | touches any shell script or systemd unit | — always fires for shell/unit work. This is the gate that consistently earns its cost |

> **Measured 2026-08-25 (T2.6).** `modem-investigator` was dispatched on the `qm_timeout` fix under the old "Tier 4 → always recon" rule. `qcmd:142` documents that the AT transport does not use `timeout` at all, so the modem was provably outside that change's blast radius — the dispatch was guaranteed to return nothing useful *before it was made*. Route by competency and that dispatch never happens.

**Device-diff before agents.** For any multi-target or portability question, the first move is running the candidate command on **both** devices and comparing exit codes and output. That takes minutes and no dispatch. All three cross-device defects found so far (missing `wget` applet, the `timeout` flag form, missing `mountpoint`) came from **running code on a second device — none came from an agent reading code.** Reach for recon when the mechanism is *unknown*, not to re-confirm one already measured.

### 🛡️ The devil's advocate is NOT a gate and is exempt from every trim on this page

Everything above cuts dispatches whose *subject matter* is not at risk. The devil's advocate is not scoped to a subject — its job is to attack the conclusion, and the conclusion is at risk on every investigation by definition. **Nothing in Gate Routing or either Lite Path reduces it, and it stays Opus.**

It is the highest-yield dispatch this project has made. On T2 it found that the plan's prescribed placement for the profile generator wrote **no `platform.json` at all** on any fresh install — the parent directory does not exist at that line — and that the bug was invisible on the RM520N-GL, the only device available to gate against. That is a feature shipping silently non-functional, caught before a line was written. On the 2026-08-23 band-locking run it overturned or re-scoped **four of six** tracked items, including proving one reported defect was correct behaviour.

The economics are not close: an advocate dispatch costs a fraction of one wrong merged conclusion. **When trimming this workflow further, trim gates — never the advocate.**

## The Frontend-Only Lite Path (Tier 1–2)

A change qualifies as **frontend-only** when every file it touches lives in `components/`, `hooks/`, `lib/`, `app/`, `types/`, `constants/`, or `public/locales/`, **and** it reads no field that does not already exist in the poller snapshot.

Qualifying changes skip two things:

- **`modem-investigator` does not run.** It probes a live modem the change never touches; its report would be evidence about a layer nobody is editing. If the change turns out to need a *new* backend field, it has stopped qualifying — re-triage to Tier 3 and run the recon then.
- **`docs-writer` does not run for single-file changes.** The orchestrator updates the docs itself. Dispatching a closer agent to append one row to a reference doc costs more than writing the row.

Everything else still applies: the approval gate, `bun run i18n:check`, the typecheck/build, and the Icon-Boundary and status-chip rules. The Lite Path removes agents that cannot see the change, not the checks that verify it.

**It does NOT qualify — run the full flow — if the change touches** a CGI script, a poller field, a systemd unit, the installer, sudoers, `/usrdata/`, or the OTA path; or if the frontend symptom is *suspected to originate* in the backend. A frontend bug whose cause is an unknown backend value is a Tier 3 investigation wearing a Tier 2 costume, and the recon gate is exactly what tells those apart.

## The Backend Lite Path (shell fixes with a measured mechanism)

The backend sibling of the above. A change qualifies when **all four** hold:

1. **One shell file**, plus its test harness.
2. **The mechanism is already measured**, not hypothesized — a captured exit code, an observed output difference, a documented version divergence. A *theory* about why something fails does not qualify; a probe transcript does.
3. **Nothing new lands on the device that the uninstaller or OTA path would need to know about.** This is the sharp form of the lockstep rule and the real test for whether `installer-safety-auditor` has anything to audit.
4. **No sudoers, systemd unit, `/usrdata/` layout, or install-ordering change.**

Qualifying changes skip **Phase 1 recon**, **Phase 2 builder pre-flight**, and **`docs-writer`** (the orchestrator writes the one row itself).

They keep: the approval gate — lightweight, "here is the fix and the probe that proves it, ok?" rather than a full plan — `busybox-portability-checker`, and a harness assertion pinning the defect.

**Worked examples, from real changes:**

| Change | Qualifies? | Why |
| --- | --- | --- |
| T2.5 Entware/`wget` bootstrap | **No** — full Tier 4 | +163 lines, a new shim, a new bootstrap function, 44 packages landing. Criteria 1 and 3 both fail |
| T2.6 `qm_timeout` wrapper | **Partly** — skip recon, keep the auditor | Mechanism was measured, so no `modem-investigator`. But the `:1056` detector fix makes `coreutils-timeout` install for the first time — criterion 3 fails, so the auditor still fires |
| F1 curl-guard one-liner | **No** — keep the auditor | The guard controls a `/usr/bin/curl` symlink, which is exactly an uninstaller-lockstep question. Recon still skipped |
| A `timeout` call site routed through an existing wrapper | **Yes** | One file, mechanism already pinned by an existing harness, nothing new installed |

Note how often the answer is *"skip recon, keep the auditor"* rather than all-or-nothing. **Trimming one gate is the common case; trimming both is rare.**

## Design Redesigns Have Their Own Phase 1-2

A request of the shape *"apply our finalized design language to surface X"* or *"redesign the Y page"* runs [redesign-proposal-playbook.md](redesign-proposal-playbook.md) for Phases 1 and 2 instead of the default triage. It adds one deliverable the standard flow has no slot for: **a published sample-design Artifact that the user approves before any component is written.** Everything from Phase 3 onward is unchanged, at whatever tier recon establishes.

This does not cover a UI bug fix, a copy change, or adding one card to an existing page. Those are ordinary Tier 1-2 work.

## Agent Roster

All agents are defined in `.claude/agents/`. Models are pinned per agent — the orchestrator does not choose them.

- **Recon gate (Phase 1, read-only):** `modem-investigator` — traces the full stack statically and probes the live modem read-only via Posh-SSH; returns an evidence report and can halt work before code is written.
- **Safety gate (Phase 1 + Phase 5, read-only):** `installer-safety-auditor` — audits installer/systemd/sudoers/`/usrdata/`/OTA changes; can BLOCK before code is written; re-runs in verify mode post-change.
- **Builders (Phases 2 & 4):** `cgi-endpoint-builder` (backend CGI shell endpoints, AT/`qcmd` flows, daemons, apply pipelines), `ui-builder` (Next.js / shadcn / Tailwind frontend).
- **Validator (Phase 5):** `busybox-portability-checker` — static audit (shebang, CRLF, BusyBox applet limits, 32-bit arithmetic) **and** scoped on-device verification of the deployed change.
- **Closer (Phase 6):** `docs-writer`.

### Model Tiering — who gets Opus

**Project agents pin their own model. Dispatch them with NO `model` argument.** The frontmatter in `.claude/agents/*.md` is the decision, already made: `modem-investigator`, `ui-builder` and `docs-writer` are `opus`; `cgi-endpoint-builder`, `busybox-portability-checker` and `installer-safety-auditor` are `sonnet`. A `model` override on the Agent call **silently outranks the pin**, so the only safe habit is not to send one.

**The orchestrator chooses only for the built-ins** — `Explore`, `general-purpose`, `fork` — which carry no pin. The test is what the deliverable IS, not how large the task feels:

| The deliverable is... | Tier | Why |
| --- | --- | --- |
| A **list** — census every call site, classify into fixed buckets, trace a known path A→B, sweep for a pattern, apply an already-decided spec, run a build and grep the output | **Sonnet** | The failure mode is *missing an item*. That is diligence, and it is bought with an exhaustive brief, not with model depth. |
| A **judgment** — adversarial review, breaking a tie between contradictory constraints, sub-architecting a multi-file change, pricing design options, deciding whether a reported defect is real | **Opus** | The failure mode is *concluding something wrong*, and a confident wrong conclusion costs more than the whole run. |

One-line version: **legwork is Sonnet, deciding is Opus.** If the brief can be written as "find every X and put each in one of these buckets", it is Sonnet. If it says "work out whether...", it is Opus.

Three corollaries:

- **Volume is not complexity.** A big task is not automatically an Opus task — an exhaustive census is still legwork no matter how many files it spans. Reach for Opus when the work is *ambiguous*, not when it is *long*.
- **Never re-tier a running agent.** Killing a near-complete Opus agent to re-run it on Sonnet spends the tokens twice and delays the gate. Let it land; apply the tiering to the next dispatch.
- **Always pay for the devil's advocate.** Orchestration Mode requires one on every investigation, and it is the definitive judgment role — it is the one built-in dispatch that should be Opus by default, never trimmed for cost.

> ℹ️ NOTE: measured on the 2026-08-23 band-locking follow-up run, which dispatched **six** Opus agents. Only two earned it: the devil's advocate — which overturned or re-scoped four of the six tracked items, including proving one was correct behaviour reported as a defect — and the design-decision lead. Three were exhaustive censuses paying Opus rates for enumeration, and one was a pinned agent whose override was a no-op.


## Recording: the commit message is the archive

A tracker or plan document is read **at the start of every session that touches its phase**. A commit message is read only when someone runs `git show` on that commit. So the split is economic, not stylistic:

| Goes in the **commit body** | Goes in the **tracker** |
| --- | --- |
| The mechanism, the root cause, the evidence tables | One status row: task, state, commit SHAs |
| Probe transcripts and before/after captures | **Open** items — anything still unresolved |
| Post-mortems, corrections to your own earlier work | **Invalidation warnings** — "a later task might break X" |
| Which hypotheses were refuted and why | **"Do not re-do this"** notes — closed censuses, discharged questions |

**The test for a tracker line: does a FUTURE task need it?** If it only explains work already merged, it belongs in the commit that merged it. Git already stores it, attached to the diff it describes, at zero cost until someone asks.

> **Measured 2026-08-25.** The Phase A tracker reached **872 lines / ~45K tokens** — too large to read in one call, so orienting on it costs two reads before any work starts. It had also silently drifted (it recorded 14 test harnesses; there were 17). A document that expensive to read is also expensive to keep true, and it stops being trusted exactly when it is longest.

**Lite Path changes get one row and no prose entry.** The harness pins the defect; the commit body carries the why.

## Hard Rules

- **Tier is decided once, up-front.** If tempted to skip the recon or a validator mid-flow, re-triage rather than skip.
- **`modem-investigator` is read-only and fails loud.** If recon reveals the change needs a write action on live state, or surfaces a broken invariant, it halts and reports — the main thread re-routes through the builders + validators.
- **The Phase 1 `installer-safety-auditor` gate fails loud.** BLOCKED halts the work before code is written. This is cheap; rework is not.
- **The harness is committed red before the fix is written.** Phase 4a precedes 4b, the anchors come from the approved Test Contract, and the builder writing the fix does not edit the harness. Work that skipped the plan owes the floor instead: the harness proven failing against `git show HEAD:<file>`, with the failure count in the commit body.
- **Post-flight validators always go out in a single parallel message.** Never serially.
- **Validate CGI as `www-data`, never as root.** On-device CGI checks go through lighttpd (`curl http://127.0.0.1/cgi-bin/...`) or `sudo -u www-data` — root-shell testing with `_SKIP_AUTH=1` has masked real permission bugs before.
- **No in-flight reboot.** The app runs on the modem itself — `reboot` / `AT+CFUN=1,1` mid-request kills the in-flight HTTP response and the device. Reboots are deferred (dialog + persistent banner after the response is written); validators reject inline reboots in a CGI response path.
- **`docs-writer` is the closing bracket.** If it doesn't run on Tier 2+, the change isn't done — except on the Lite Path's single-file case, where the orchestrator writes the docs itself. The docs still get written either way; only the author changes.
- **Any new UI string or nav item is i18n-keyed, across all 5 locales.** Sidebar/nav sub-items use `t_key` (never a raw `title`), and every new key is added to all of `public/locales/{en,zh-CN,zh-TW,it,id}/*.json`; `bun run i18n:check` must pass (100% parity gate) before a frontend change is done. A builder branched before the i18n conversion will reach for `title` — convert it.
- **Installer changes move in lockstep across install + uninstall + OTA.** A feature that adds a binary, service, or config must touch `install_rm520n.sh`, `uninstall_rm520n.sh`, and the update/OTA path together — a service the uninstaller doesn't remove, or a config the updater doesn't preserve/seed, is an incomplete change. This is exactly what the `installer-safety-auditor` gate verifies.
- **Agents don't see the orchestrator's conversation.** Each dispatch is a self-contained brief with file paths, schemas, the live evidence from `modem-investigator`, and the relevant `CLAUDE.md` / `DESIGN.md` / `PRODUCT.md` sections inlined.

## Branch Model

- **`development` is the true integration base.** It is the branch the user works on day-to-day and the branch **all feature/worktree work must be based on and merged back into**. When in doubt about "the originating branch," it is `development`.
- **`main` is the stable-release branch.** A feature branch merges to `main` **only when the user explicitly decides** a version is stable and tested enough to release / keep for future reference. Never merge to `main` on your own initiative — it is a deliberate release act the user gates.
- **Fixed: `.claude/settings.json` sets `worktree.baseRef: "head"`, so `EnterWorktree` now branches from local HEAD instead of the stale `origin/<default-branch>` = `origin/main` default.** (This bit a real run: a worktree branched from `main` (v0.1.12) while `development` was 44 commits ahead (v0.1.31), forcing 6 diverged files to be re-applied at close-out.) **Standing precondition: the session must already be on `development` before calling `EnterWorktree`** — `head` mode inherits whatever branch is currently checked out, so switching first is what makes the setting correct. **Residual check anyway, since the failure mode is silent:** `git merge-base HEAD development` must equal `git rev-parse HEAD`.

## Worktree Discipline (Tier 2+)

Parallel branches and parallel builders must never cross-contaminate commits. Two layers of isolation, both harness-native:

1. **Run-level — every Tier 2+ run gets its own worktree, based on `development` (see Branch Model — verify the base is not stale `main`).** Immediately after the Phase 3 approval gate (before any builder writes a file), create an isolated checkout on a fresh branch named for the change (e.g. `wt/eth-link-alerts`) via `EnterWorktree`. The session CWD moves there and every subsequently spawned teammate inherits it. Phases 1–3 (recon/plan) stay in the main checkout — they're read-only and should see the branch the user actually asked about. Tier 0/1 edits stay in-place, no worktree.
2. **Agent-level — isolate builders only when file sets overlap.** If two builders would touch overlapping or uncertain file sets in parallel, spawn them isolated (`isolation: "worktree"`) and reconcile their results into the run worktree. When file sets are provably disjoint (the normal case — backend in `scripts/`, UI in `components/`), skip it; they share the run worktree.

**On entry, fix the three things a fresh worktree is missing:**
- **`.env` is gitignored** → copy it from the main checkout or `modem-investigator` / `busybox-portability-checker` silently lose SSH access to the live modem. Verify `git check-ignore .env` still holds in the worktree; never commit it.
- **`node_modules` is absent** → run `bun install` lazily, only if the change actually needs a frontend build/lint/tsc pass; backend-only changes skip it.
- **`/reimagine/` is gitignored** (`.gitignore:71`) → the design-mock bundle (`Recommended Hybrid`, the `Motion Guide`, the index deck) does not exist in any worktree. Same failure class as the `.env` gap, and quieter: a `ui-builder` briefed to "match the mock" finds nothing there and improvises without saying so. Copy the directory in from the main checkout before briefing any agent that must read a mock, or inline the relevant mock excerpt into the brief; never commit it.

**Close-out (Phase 6):** after validation passes and `docs-writer` closes, ask the user (`AskUserQuestion`) — merge back into the originating branch, keep the branch for a PR, or discard — then exit the worktree (`ExitWorktree`). Never auto-merge.

**After merging into a fast-moving branch, run the full build (`bun run package`, or at minimum `next build` + `bun run i18n:check`) — the pre-merge typecheck is not enough.** A clean auto-merge can still break the build: files that each pass in isolation can collectively violate a contract that advanced on the target branch (this session: a builder's `{ title }` nav item met a merged i18n change that now required `t_key`, and only the post-merge `next build` caught it). Resolve conflicts by integrating both sides — for shared index/notes files (`CLAUDE.md`, `RELEASE_NOTES.md`, `docs/reference/README.md`, the installer's gated-service list) keep the target branch's entries and graft the feature's rows in, never clobber.

## Skip Phrases

User can short-circuit by saying "just do it" / "skip the plan" / "tier 0 it" — drop to direct execution. Otherwise the flow is the default.

## Orchestration Mode ("orchestrate")

When the user says **"orchestrate"** (e.g. "orchestrate this", "orchestrate a team for…"), run the 6-phase flow above as a **multi-agent team**, not a solo pass. Tiers, gates, and the user approval gate all still apply. Default shape:

- **The orchestrator is the head architect, not a worker.** It plans, briefs teammates, synthesizes their evidence, holds the approval gate, and makes the calls. The legwork (recon, builds, validation, docs) goes to teammates. **The orchestrator judges teammate reports rather than rubber-stamping them, but scoped: re-check only the specific lines/claims a validator flagged FAIL or a report leaves ambiguous — not an open-ended re-read of files a validator already passed.** A validator's PASS on a check is trusted as-is; spend the extra read on the FAIL, not the PASS.
- **Teammates are spawned liberally and in parallel**, each with a **self-contained brief** (file paths, schemas, live evidence, the relevant CLAUDE.md/DESIGN.md/PRODUCT.md sections inlined) — they don't see the orchestrator's conversation. Use the project agents (`modem-investigator`, `cgi-endpoint-builder`, `ui-builder`, `busybox-portability-checker`, `installer-safety-auditor`, `docs-writer`) plus the built-in `Explore` subagent or a general-purpose agent for recon.
- **One teammate is always a dedicated devil's advocate** for any investigation — its job is to attack the leading hypotheses, surface what the team is underweighting, and stop the team from "fixing" accurate telemetry or chasing a phantom.
- **Phase 1 recon fans out.** Run several read-only agents at once on different leads (live `modem-investigator` probing, static `Explore`, a delta/compare angle, the devil's advocate). When new evidence lands mid-flight, redirect a running teammate (`SendMessage`) instead of re-spawning. If a backgrounded teammate goes idle without delivering its report, ping it for the report.
- **Synthesize, then gate.** Fold all reports into ONE plan and use `AskUserQuestion` at the Phase 3 approval gate and for any real scoping decision. Don't start Phase 4 builders until the user approves.
- **Worktree Discipline applies (see above).**
- **Execute → validate → docs, with a task board.** Builders run bottom-up (parallel where files are independent), validators gate every backend/shell change on-device, `docs-writer` closes. Track it with a task list (`TaskCreate`/`TaskUpdate`) — owners + blockers — so the user can follow progress.
- **UI craft stays with the orchestrator** via the Impeccable skill; `ui-builder`/`explore` may still recon the surfaces.

The same Skip Phrases still apply — "just do it" drops orchestration back to a solo direct pass.
