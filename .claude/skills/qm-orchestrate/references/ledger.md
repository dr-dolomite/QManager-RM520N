# The run ledger: durable state, checkpoints, handoff

## Three locations, three rules

| Path | Rule |
|---|---|
| `.orchestra/runs/<YYYY-MM-DD>-<slug>.md` | The live ledger for one run. Copied from `templates/run-ledger.md`. **Tracked in git** and committed with the change, so it travels with a worktree and survives a fresh session on another checkout |
| `.orchestra/ledger.md` | **Frozen history.** Never appended, never rewritten, never deleted. It was clobbered twice by an agent told to "create the ledger" |
| `.orchestra/scratch/` | Gitignored and disposable: bulk agent output, probe transcripts, generated artifacts. It does not exist in a fresh worktree. Anything a future session needs must be in the run file or committed — never only in scratch |

Direct lane writes no ledger. Lite lane uses the same file with Plan and Attempts collapsed to one row each.

## Schema

The template carries the full schema. Its shape, and the hard rules attached to each section:

- **Header** — `status: active | paused | closed`, `lane`, `base` SHA, branch or worktree path, opened date, lead model class.
- **Request** — the user's words, verbatim, once.
- **Decisions taken — do not re-ask** — gate answers, scope calls, device policy with the user's "yes" quoted for any disruptive action, and every routing override with its one-line reason.
- **Plan** — `id | task | class | seat | write set | state`.
- **Attempts** — append-only: `task | # | seat | ticket rev | outcome | checks run | evidence path`. This table is what makes "second real failure at this seat" and "two consecutive failed fix waves" provable after compaction, rather than reconstructed from memory.
- **Findings that survive** — facts a FUTURE task needs, one line each with `path:line`; invalidation warnings; "do not redo" notes.
- **Device state** — which devices, reachable, deployed md5 vs HEAD vs working copy, anything left in `/tmp`, and what the run changed on the device with the approval that authorised it.
- **Handoff — NEXT ACTION** — rewritten, never appended.

**Hard cap: 150 lines.** If a section outgrows it, move the overflow to a committed `.orchestra/runs/<run>-<topic>.md` and leave one pointer line. A tracker that reached 872 lines cost two reads before any work could start, and had silently drifted out of true.

## Checkpoints

Write or update the ledger, and **rewrite the Handoff section**, at each of these:

1. Before the first dispatch of the run — including a single-agent run.
2. After recon, before the gate.
3. After the gate (record the approved plan and the worktree BASE).
4. After every build wave and every fix wave.
5. At close-out — `status: closed`, plus one line with the main/subagent token split from `node .claude/token-meter.mjs`.

## Resume procedure

A fresh session, or this session after compaction:

1. List `.orchestra/runs/` and open the file whose `status` is `active`.
2. **Reconcile before dispatching anything.** `git status --short`; `git diff --stat <base>`; check for still-running jobs; compare the deployed md5s in Device state against `git show HEAD:<path>`; check whether `development` advanced with `git merge-base --is-ancestor <base> development`.
3. **The tree outranks the ledger.** A stale `DONE` is accepted-but-missing work; a stale `DISPATCHED` is duplicate work about to happen.
4. Continue from **Handoff — NEXT ACTION**. If that section cannot carry a fresh session on its own, fix it before doing anything else — that is the section's entire purpose.

## The recording rule

The **commit body is the archive**; the ledger holds only what a future task needs.

| Goes in the commit body | Goes in the ledger |
|---|---|
| The mechanism, the root cause, the evidence tables | One status row per task: state, seat, commit SHA |
| Probe transcripts and before/after captures | Open items — anything still unresolved |
| Post-mortems and corrections to earlier work | Invalidation warnings — "a later task might break X" |
| Which hypotheses were refuted and why | "Do not re-do this" — closed censuses, discharged questions |

The test for a ledger line: **does a FUTURE task need it?** If it only explains work already merged, it belongs in the commit that merged it — git stores it attached to the diff it describes, at zero cost until someone asks. A Lite-lane change gets one row and no prose entry.
