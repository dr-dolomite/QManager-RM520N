# Tickets, statuses, escalation

An agent starts with a fresh context and never sees this conversation. If the agent would need to ask a question, the ticket is incomplete. One task per ticket. Fill `templates/ticket.md`.

## The eleven sections

```
TASK:            one task, stated in the user's terms
EXPECTED OUTCOME: observable definition of done, gradeable before dispatch
CONTEXT:         file PATHS to read, current state, background
CONSTRAINTS:     stack, patterns, compatibility requirements
MUST DO:         non-negotiables, including the exact verify command
MUST NOT:        the fence — scope off limits; no subagent spawning
OUTPUT FORMAT:   the role's report contract (status-first or verdict-first)
WRITE SET:       every file or glob this agent may create or modify
READ FIRST:      the docs/reference/*.md row for the subsystem, the DESIGN.md
                 sections for UI work, the recon report path — paths, never content
DEVICE:          none | read-only | deploy:/tmp | deploy:live (user approved: "<quote>")
PROOF:           the exact command or route that proves the change, and what
                 output means done
```

`WRITE SET` is mandatory on every implementation ticket and omitted only for read-only roles. `READ FIRST`, `DEVICE` and `PROOF` are mandatory on **every** ticket. `DEVICE` defaults to `none`; any other value names the device by its `.env` prefix.

`PROOF` is never "n/a". When `DEVICE` is `none`, name the local check the agent runs itself — `bash -n` and `bash .claude/check-crlf.sh` for shell, the gate set for frontend — and state that the conductor runs the device or browser proof afterwards.

`PROOF` examples: "scp to `/tmp`, run as `www-data` via `sudo -n -u www-data`, expect `{…}`"; "curl the endpoint through lighttpd"; "load `/local-network/ttl-settings` in the Browser pane and read the console".

**Inline-vs-path rule.** The task text and the acceptance criteria go inline verbatim; everything bulky travels as a path. Recon reports go to `.orchestra/scratch/<run>-<agent>.md` and are referenced by path.

## Report contract

Every implementation report ends with the literal output of `git diff --stat <BASE>` — BASE comes from the ticket, never a branch name — and one line:

```
device touched: no | yes (<file> md5 <hash>)
```

A report whose narrative the diff does not show is a failed run. Implementation and recon reports are ≤ 25 lines; a verifier report is ≤ 40. Hedge language ("should work", "probably") is a failure to verify. Read-only roles end with a **Not checked** section; everything in it counts as not verified.

## The three vocabularies — never mixed

**Status** (execution roles: scout, builders, worker, investigator, docs-writer):

| Status | Conductor's move |
|---|---|
| `DONE` | Deterministic gates, then the verifier |
| `DONE_WITH_CONCERNS` | Resolve every concern before accepting; correctness concerns are fixed now |
| `NEEDS_CONTEXT` | Supply it, re-dispatch the same agent at the same seat |
| `BLOCKED` | Triage: bad ticket → fix and retry same seat; capability gap → precedence table; external blocker → surface to the user, never work around it |

**Verdict** — `PASS` / `FAIL` / `PASS_WITH_NOTES` for `qm-verifier`. `installer-safety-auditor` keeps `CLEAR` / `BLOCKED — N must-fix`; `busybox-portability-checker` keeps `SAFE TO SHIP` / `BLOCKED — N fixes`. `PASS_WITH_NOTES` is legal only when every required criterion passed; a required criterion under a note is a `FAIL`.

**Ledger lifecycle** — `PENDING → DISPATCHED → REPORTED(status) → VERIFYING → VERIFIED | ACCEPTED | FAILED | LOST`. Read-only tasks terminate at `ACCEPTED` once consumed; there is no diff to verify.

## LOST agents

`LOST` = dispatched, never reported. **Prove the process stopped first** — reconciling against a possibly-live agent creates exactly the concurrent-write race WRITE SETs exist to prevent. Then mark `LOST` in the ledger with what you know, take a fresh diff against BASE, and either complete the partial edits by inspection, revert them, or fold them into the retry ticket. Never re-dispatch onto an unreconciled tree. A LOST dispatch counts as a failure toward the precedence table.

## The precedence table — single authority for retries

Apply the first matching row.

| # | Condition | Action |
|---|---|---|
| 1 | Failure caused by the ticket (ambiguity, missing context) | Fix the ticket; retry the **same seat** — does not count against it |
| 2 | First real failure at this seat | Retry same seat with something changed: corrected ticket, added context, or raised effort |
| 3 | Second real failure at this seat | Escalate one seat, **or** the conductor takes over — whichever the task's class warrants |
| 4 | Failure at the top seat, or conductor takeover failed | Stop; report to the user with evidence |
| 5 | Two consecutive failed fix waves on the same findings | Stop; report with the verifier's evidence, regardless of seats remaining |

Never a third identical retry. Escalations are one-way per task. Rows 4–5 exist so "keep trying" never silently becomes the plan.

## Fix waves

Findings batch into **one** fix ticket carrying the complete findings list and the verifier's evidence verbatim — never one agent per finding, each rebuilding context. Fix output re-enters verification. Two consecutive failed waves → row 5.

## Standing fences on every ticket

- Workers never spawn workers.
- Do not create a test harness — no `scripts/test/`, no `*.test.*`, no assertion script.
- Auto-fix only inside the WRITE SET; anything outside it is `NEEDS_CONTEXT`, not a guess.
- Nothing disruptive on the device without the quoted approval in the `DEVICE` line.
- Code comments are one or two lines — see `CLAUDE.md` > Code Comments.
