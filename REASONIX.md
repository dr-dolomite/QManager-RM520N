# REASONIX.md — Reasonix-Native Project Wiring

**`CLAUDE.md` is the binding project canon.** Reasonix recognizes `CLAUDE.md` as an instruction doc and loads it into every session, so its Communication Style, Design Context, RM520N-GL platform truths, and feature routing table apply here verbatim. This file carries only the Reasonix-native deltas — read it for the wiring, read `CLAUDE.md` for everything else.

## Specialist Agents (subagent profiles)

The six specialist agents (defined in `.claude/agents/` for Claude Code) are mirrored as native Reasonix **subagent profiles** in `.reasonix/skills/` — same bodies, `runAs: subagent`:

| Profile | Model | read-only |
| --- | --- | --- |
| `modem-investigator` | `deepseek-v4-pro` | ✅ |
| `cgi-endpoint-builder` | `deepseek-v4-flash` | — |
| `ui-builder` | `deepseek-v4-pro` | — |
| `busybox-portability-checker` | `deepseek-v4-flash` | ✅ |
| `installer-safety-auditor` | `deepseek-v4-flash` | ✅ |
| `docs-writer` | `deepseek-v4-pro` | — |

**Model mapping:** the Claude Code originals pin `sonnet`/`opus`; this environment runs a deepseek provider, so profiles map `sonnet → deepseek-v4-flash` (workhorse) and `opus → deepseek-v4-pro` (heavy reasoning). Never write Claude model names (`sonnet`, `opus`) into profile frontmatter — profile resolution fails with `unknown model "<name>"`.

**Dispatch** (orchestrator → specialist, per the Change Workflow in `docs/reference/change-workflow.md`): invoke a profile via `run_skill` with the bare name, `task` with `profile: <name>`, `/name <task>`, or the CLI `reasonix subagent run|try <name> <task>`. The three read-only profiles enforce read-only tooling by construction. Builtin subagent skills (`explore`, `research`, `review`, `security-review`) remain available for investigation and review passes.

**Persistent memory** for each agent lives in `.claude/agent-memory/<name>/` (unchanged) — the profile bodies already point there.

## Skill authoring gotchas (learned the hard way)

- Keep the opening **and** closing `---` frontmatter delimiters intact — a transformation that drops the opener silently demotes the skill to "loads but no description / not a profile" (`has no description:` warnings, `unknown profile` on `task`).
- `description:` scalars containing double quotes or `\n` escapes must be **single-quoted** YAML (`description: '...'`); inner single quotes are doubled (`''`). Double-quoted scalars with unescaped inner `"` parse in some commands but not others.
- Project skill roots: `<workspace>/.reasonix/skills/` (flat `<name>.md` or `<name>/SKILL.md`). Verify with `reasonix subagent list` and `reasonix doctor capabilities --json`.

## Keeping the mirrors in sync

When an agent brief changes, update **both** `.claude/agents/<name>.md` (Claude Code) and `.reasonix/skills/<name>.md` (Reasonix) with the same body. Both locations are gitignored (`/.claude`, `/.reasonix`, `/reasonix.toml`, `/reasonix`) — agent definitions stay local tooling, like the project's `.claude` precedent. `REASONIX.md` itself is tracked.
