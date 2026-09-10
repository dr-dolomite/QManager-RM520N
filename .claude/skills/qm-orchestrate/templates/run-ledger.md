<!-- Copy to .orchestra/runs/<YYYY-MM-DD>-<slug>.md and commit with the change.
     HARD CAP 150 LINES — overflow goes to a committed .orchestra/runs/<run>-<topic>.md
     with one pointer line left here.
     Task state ∈ PENDING → DISPATCHED → REPORTED(status) → VERIFYING → VERIFIED | ACCEPTED | FAILED | LOST
     Status ∈ DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED
     Verdict ∈ PASS | FAIL | PASS_WITH_NOTES -->

# Run: <title>
status: active | paused | closed
lane: direct | lite | full
base: <sha>   branch: <name or worktree path>   opened: <date>   lead: <model class>

## Request
<the user's words, verbatim, once>

## Decisions taken — do not re-ask
<one line each: gate answers, scope calls, device policy with the user's "yes" quoted for
any disruptive action, routing overrides with their reason>

## Plan
| id | task | class | seat (model/effort) | write set | state |
|---|---|---|---|---|---|
|  |  |  |  |  | PENDING |

## Attempts   (append-only)
| task | # | seat | ticket rev | outcome | checks run | evidence path |
|---|---|---|---|---|---|---|
|  |  |  |  |  |  |  |

## Findings that survive
<facts a FUTURE task needs, one line each with path:line; invalidation warnings;
"do not redo" notes. Not a narrative of what happened — that goes in the commit body>

## Device state
<which device(s), reachable?, deployed md5 vs HEAD vs working copy, anything left in /tmp,
anything the run changed on the device and the approval that authorised it>

## Handoff — NEXT ACTION
<rewritten at every checkpoint, never appended: the exact next step, the open items, what
NOT to redo, which scratch artifacts still matter. A fresh session must be able to continue
from this section alone.>
