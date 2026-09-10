# Change Workflow

> **Applies to:** RM520N-GL (SDX65) · verified 2026-08
> **RG501Q-EU (SDX55):** unverified — see [`platform-matrix.md`](./platform-matrix.md)

**Superseded 2026-09-10 by the `qm-orchestrate` skill at `.claude/skills/qm-orchestrate/SKILL.md`.**
The tier-routed 6-phase flow this file described is retired; three lanes replace it. Invoke the
skill before triaging any code-change request, and on "resume", "handoff", or "pick up where we
left off".

Where each section went:

- Phases, tiers, gate routing and both Lite Paths → `references/lanes.md` (lanes and the flag table live in `SKILL.md`)
- Verification, the device-first rule, the deterministic gates → `references/verification.md`
- Agent roster and model tiering → `references/roster.md`
- Branch model and worktree discipline → `references/worktree.md`
- The recording rule and Orchestration Mode's durable state → `references/ledger.md`

[`redesign-proposal-playbook.md`](redesign-proposal-playbook.md) still stands unchanged and is
referenced from `references/lanes.md`: it governs recon and plan for a "redesign surface X" request.
