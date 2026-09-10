# Roster and routing

Ten project agents, all defined in `.claude/agents/`. Every one pins its own model and effort — the decision is already made in the frontmatter, and **a `model` argument on the Agent call silently outranks the pin**, so the safe habit is not to send one.

| Agent | Seat | Class | Read-only? | Dispatched for | Reports |
|---|---|---|---|---|---|
| `qm-scout` | sonnet / low | FAST | yes | Locate files and symbols, census call sites, trace a KNOWN path A→B, extract facts | status |
| `modem-investigator` | opus / medium | diagnostic | source yes; device read-only | Reproduce a bug live, interpret on-device state, map an UNKNOWN flow. Not a census — that is the scout | status |
| `qm-advocate` | opus / high | FRONTIER | yes | Attack the leading hypothesis or plan before the gate; each challenge names the evidence it rests on and what would settle it | status, then ranked challenges |
| `cgi-endpoint-builder` | sonnet / medium | WORKHORSE | no | CGI endpoints, libs, daemons, AT and `qcmd` flows, apply pipelines | status |
| `ui-builder` | opus / medium | WORKHORSE + design judgment | no | Pages, cards, hooks, types, `shapes.ts` / `derive.ts`, i18n keys | status |
| `qm-worker` | sonnet / medium | WORKHORSE generic | no | Anything neither CGI nor UI: installer edits under an auditor gate, i18n merges, docs prose under a spec, scripts-dev tooling, mechanical multi-file edits | status |
| `installer-safety-auditor` | sonnet / medium | gate + validator | yes; device read-only | Pre-gate before installer code is written, and post-verify after | `CLEAR` / `BLOCKED — N must-fix` |
| `busybox-portability-checker` | sonnet / medium | validator | source yes; may `scp` to `/tmp/` and run | The residue after the conductor's own run; both devices diffed | `SAFE TO SHIP` / `BLOCKED — N fixes` |
| `qm-verifier` | opus / high | blind verifier | yes; Bash check-only, MCP read-only | Every accepted change except a single file with no logic content | `PASS` / `FAIL` / `PASS_WITH_NOTES` |
| `docs-writer` | opus / medium | closer | writes docs, `CLAUDE.md` rows and `RELEASE_NOTES.md` only | Full-lane close. Lite and Direct get the one docs row from the conductor | status |

## Routing rules

- **A LIST is Sonnet, a JUDGMENT is Opus.** The failure mode picks the seat. "Missing an item" is diligence, bought with an exhaustive brief. "Concluding something wrong" is depth, and a confident wrong conclusion costs more than the whole run. If the brief can be written as "find every X and put each in one of these buckets", it is Sonnet; if it says "work out whether…", it is Opus.
- **Volume is not complexity.** An exhaustive census is legwork no matter how many files it spans. Reach for Opus when the work is ambiguous, not when it is long.
- **Effort before tier** within a class. The `effort` frontmatter is the default; the ticket steers it — "mechanical, do not deliberate" or "reason carefully about X".
- **Overrides are per dispatch and need a one-line reason in the ledger**: down to `sonnet` for a fully specified mechanical ticket to an Opus agent, up to `opus` for a Sonnet agent whose ticket needs sub-architecting. **Never override to `fable`** — a worker on the lead's own weekly cap is the most expensive way to type.
- **Never re-tier a running agent.** Killing a near-complete Opus agent to re-run it cheaper spends the tokens twice and delays the gate. Let it land; apply the routing to the next dispatch.
- **Only these ten are dispatch targets.** The built-in and global agents named in `SKILL.md` rail 1 inherit the lead seat and carry no project contract; `qm-scout` and `qm-worker` exist so there is never a reason to reach for one. On one measured run, 91% of subagent tokens were Opus for exactly that reason.
- **Sequential by default.** Parallel only for provably disjoint WRITE SETs; announce every fan-out — size, seats, why — before it happens. A multi-agent run costs roughly an order of magnitude more than solo work, and an adoption pass runs 250–500M tokens.
- **Big documents are read inside agents.** `DESIGN.md` is 161 KB and the reference docs are large. The conductor reads only what it must decide with, and briefs by path.
- **The advocate is never trimmed** and is always Opus. See `references/lanes.md`.

## What the conductor does not delegate

Planning, routing, the gate, synthesis, and the Layer 0 device run or page load. While agents work, you conduct — review, route, decide. You pick up an instrument only through the takeover row of the precedence table in `references/tickets.md`.

Synthesize agent output; never paste it through raw. Judge reports rather than rubber-stamping them, but scoped: re-check the specific claims a validator flagged or a report left ambiguous, not the ones it passed.
