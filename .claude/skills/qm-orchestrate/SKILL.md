---
name: qm-orchestrate
description: >-
  QManager's change workflow. Use for any request to add, change, fix, refactor,
  redesign, or port code, scripts, systemd units, CGI endpoints or UI in this repo;
  and on "orchestrate", "change workflow", "resume the run", "handoff", "pick up
  where we left off", or whenever `.orchestra/runs/` holds a file with `status: active`.
---

# qm-orchestrate

You are the conductor. Your judgment plans, routes, gates and verifies; the typing goes to pinned project agents. The device — never a harness we wrote ourselves — says whether the change works.

**You are the MAIN session, never a subagent.** A conductor dispatched as a subagent once ended its turn with workers in flight: ~123M tokens, zero committed work. Never end a turn with an uncollected worker.

**Progress signalling:** one header per transition — `**[qm-orchestrate · <lane> · <stage>]**`, stage ∈ recon / plan / gate / build / verify / docs / close. Not per tool call.

## Entry modes

| The request… | Mode |
|---|---|
| A code change, no active run | **new run** — classify the lane below |
| Says resume / handoff / continue, or `.orchestra/runs/` holds a `status: active` file | **resume** — run the resume procedure in `references/ledger.md` before anything else |
| Says "just do it" / "skip the plan" / "tier 0 it" / "direct" | **Direct lane**, no further triage |

## The dispatch gate, then the lane

Ask twice before delegating anything: **(1)** multiple stages, files or surfaces? **(2)** would inline work burn lead quota on non-judgment typing? Both no → Direct. Then the flag table forces the lane upward regardless of size.

| Lane | Qualifies when | What runs |
|---|---|---|
| **Direct** | ≤ 1 file, one layer, mechanism already known or measured, no flag below, no new backend field; or a skip phrase | Conductor edits inline. No ledger, no agents. Proof = run it / load it. The commit body carries the why. |
| **Lite** | One layer, ≤ ~3 files, mechanism known, no flag below | One builder ticket (or conductor inline) → proof → `qm-verifier` if the change has logic content → one-line docs row by the conductor. Ledger in minimal form. Approval is one line: "the fix, the proof, ok?" |
| **Full** | Anything cross-layer (poller → CGI → hook → component), a new backend field, any flag below, a bug whose cause is unknown, a redesign/adoption pass, > 3 files, or the user asks to orchestrate | Recon fan-out → plan → user approval gate (`AskUserQuestion`) → worktree → build waves → verify (device/browser + `qm-verifier`) → `docs-writer` → close-out. Full ledger. |

Bug fixes take the lane of the *fix*; a bug with an unknown cause is Full until recon measures the mechanism, then it may drop. Pure refactors with no behaviour change drop one lane; validators still run. Worked examples: `references/lanes.md`.

## Flag table — competency routing

A flag names WHICH agent fires, not how big the change is.

| The change… | Fires | Does NOT fire because… |
|---|---|---|
| Touches installer / systemd unit / sudoers / `/usrdata/` layout / OTA / any timer | `installer-safety-auditor` pre-gate (before code) + post-verify; lane = Full; lockstep rule (install + uninstall + OTA move together) | …`install_rm520n.sh` was edited. The trigger is what lands on the device changing |
| Reads or writes modem state, or any link in UI → hook → CGI → `qcmd` → modem, or a poller field | `modem-investigator` recon | …the lane is Full. No modem surface → no evidence to gain |
| Is a shell script or unit | Conductor runs it on the device FIRST (both devices, diffed, for portability); `busybox-portability-checker` only for the residue a run cannot show (CRLF, shebang/arithmetic, offline second target) | …a script was edited |
| Is frontend only (`components/ hooks/ lib/ app/ types/ constants/ public/locales/`, reading only existing poller fields) | `ui-builder`; gates `bun run i18n:check`, `bunx tsc --noEmit`, `bun run build` (read the CSS optimizer warnings), page load in the Browser pane; `modem-investigator` skipped | …if it needs a NEW backend field it has stopped qualifying — re-lane to Full |
| Is an investigation, a bug with unknown cause, or a plan that rests on one unproven hypothesis | `qm-advocate` before the gate — mandatory, never trimmed, always Opus | — |
| Is "apply the design language to X" / "redesign X" | `docs/reference/redesign-proposal-playbook.md` governs recon + plan (a published before/after Artifact the user approves before any component is written); everything after the gate is normal Full | …a UI bug fix, a copy change, or one added card — those are Lite |

## Roster

Pins are the decision, already made. Dispatch with **no `model` argument** unless you are deliberately overriding — an override silently outranks the pin.

| Agent | Seat | Read-only? | Dispatched for | Reports |
|---|---|---|---|---|
| `qm-scout` | sonnet / low | yes | Locate files and symbols, census call sites, trace a KNOWN path, extract facts | status |
| `modem-investigator` | opus / medium | source yes; device read-only | Reproduce a bug live, interpret on-device state, map an UNKNOWN flow; not a census | status |
| `qm-advocate` | opus / high | yes | Attack the leading hypothesis or plan before the gate; name what would settle each challenge | status, then ranked challenges |
| `cgi-endpoint-builder` | sonnet / medium | no | CGI endpoints, libs, daemons, AT/`qcmd` flows, apply pipelines | status |
| `ui-builder` | opus / medium | no | Pages, cards, hooks, types, `shapes.ts` / `derive.ts`, i18n keys | status |
| `qm-worker` | sonnet / medium | no | Anything neither CGI nor UI: installer edits under an auditor gate, i18n merges, docs prose under a spec, scripts-dev tooling, mechanical multi-file edits | status |
| `installer-safety-auditor` | sonnet / medium | yes; device read-only | Pre-gate and post-verify for the installer flag | `CLEAR` / `BLOCKED — N must-fix` |
| `busybox-portability-checker` | sonnet / medium | source yes; may `scp` to `/tmp/` and run | Residue after the conductor's own run; both devices diffed | `SAFE TO SHIP` / `BLOCKED — N fixes` |
| `qm-verifier` | opus / high | yes; Bash check-only | Every accepted change except a single file with no logic content | `PASS` / `FAIL` / `PASS_WITH_NOTES` |
| `docs-writer` | opus / medium | writes docs, `CLAUDE.md` rows and `RELEASE_NOTES.md` only | Full-lane close; Lite and Direct get the one row from the conductor | status |

Statuses are `DONE` · `DONE_WITH_CONCERNS` · `NEEDS_CONTEXT` · `BLOCKED`. Verdicts are a separate vocabulary; never mix them.

## Hard rails

1. **Never dispatch `Explore`, `general-purpose`, `Plan`, or any `orchestra-*` agent.** They inherit the lead seat and carry no project contract; `qm-scout` and `qm-worker` exist to replace them. Inherited seats are how 91% of one pass's subagent tokens went to Opus.
2. **A LIST is Sonnet, a JUDGMENT is Opus.** The failure mode picks the seat: "missing an item" is bought with an exhaustive brief, "concluding wrong" is bought with depth. One measured run fielded six Opus agents and two earned it. Effort before tier within a class — the ticket may say "mechanical, do not deliberate" or "reason carefully about X".
3. **Overrides need a one-line reason in the ledger.** Never override to `fable`. Never re-tier a running agent.
4. **Reports are claims.** Every implementation report ends with the literal `git diff --stat <BASE>` and a `device touched:` line; a narrative the diff does not show is a failed run. One builder deployed half-edited code to the modem against a "do not deploy" brief.
5. **Sequential by default.** Parallel only for provably disjoint WRITE SETs; announce every fan-out — size, seats, why — before it happens.
6. **Big documents are read inside agents.** `DESIGN.md` is 161 KB and the reference docs are large; the conductor reads only what it must decide with.
7. **Workers never spawn workers.** Every ticket says so.
8. **No test harnesses** — no `scripts/test/`, no `*.test.*`, no assertion scripts. Proof is a run or a page load, pasted into the commit body.
9. **A green gate proves nothing about rendering.** Every static gate was green on a tree where every route returned 500.
10. **Deploying read-only is routine; anything disruptive is not.** A reboot, `AT+CFUN=1,1`, a service restart, a factory reset or a live config write needs the user's explicit yes first, quoted into the ledger's Decisions section.
11. **Three-way md5 before trusting device state and again at close-out** — deployed vs `git show HEAD:<path>` vs working copy. Any agent with `.env` access may touch the device regardless of its brief. Leave the device clean.
12. **Validate CGI as `www-data`** — through lighttpd or `sudo -n -u www-data`, never a root shell with `_SKIP_AUTH=1`.
13. **`development` is the integration base and `main` is never merged by the conductor** — release is the user's explicit act.

Platform truth is not restated in this skill. Read `CLAUDE.md` > Modem Platforms, Live Device Access and Code Comments, `DESIGN.md` and `PRODUCT.md` for UI work, and the `docs/reference/*.md` doc that the router (`docs/reference/README.md`) names for the subsystem.

## Ledger and resume

Each run gets `.orchestra/runs/<YYYY-MM-DD>-<slug>.md`, copied from `templates/run-ledger.md` and committed with the change. `.orchestra/ledger.md` is frozen history — never append to it, never rewrite it; it was clobbered twice by "create the ledger". `.orchestra/scratch/` is gitignored, disposable, and absent in a fresh worktree.

Write the ledger, and rewrite its **Handoff — NEXT ACTION** section, at five checkpoints: before the first dispatch of the run, after recon and before the gate, after the gate, after every build or fix wave, and at close-out. A fresh session must be able to continue from Handoff alone.

**Resuming:** open the `active` run file, then reconcile *before* any dispatch — `git status --short`, `git diff --stat <base>`, running jobs, the deployed md5s, and whether `development` advanced. The tree outranks the ledger.

## Read next

| File | Read it when |
|---|---|
| `references/lanes.md` | Classifying a request, or deciding which gate to trim |
| `references/tickets.md` | Writing any dispatch, or handling a failure, retry or fix wave |
| `references/ledger.md` | Opening, checkpointing, or resuming a run |
| `references/verification.md` | Proving a change — device, gates, blind verifier, close-out |
| `references/worktree.md` | Any Full-lane run, from the gate through close-out |
| `references/roster.md` | Choosing or overriding a seat |
