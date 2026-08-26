---
name: commit-is-archive-doc-is-forward-looking
description: Division of labour between a commit body and docs/reference/<x>.md — the commit archives what happened, the doc carries only what a FUTURE task needs
metadata:
  type: reference
---

On Tier 2+ closes, the **commit message is the archive** (defects found, evidence
captured, what was measured on which device, decisions taken at the approval
gate). The `docs/reference/<topic>.md` doc carries only what a **future
maintainer** needs to not re-derive something painfully.

**Why:** commit bodies in this repo are unusually long and complete — `git show`
is the post-mortem record. Restating them in `docs/` produces a doc that is 60%
history and hard to skim, and the history goes stale where the code moves.

**How to apply:**
- Mine `git show <sha>` for the *invariants* behind each defect, not the defect
  narrative. "SSH ignores the channel exit status because after wrapping the last
  command is always `echo`" belongs in the doc; "the plan's fixtures paired
  channel_rc=4 with sentinel 4" belongs there only as the one-line reason nobody
  should restore the guard.
- A "do not restore this" warning IS forward-looking and belongs in the doc —
  that is the one class of history that earns its place, because someone will
  otherwise reinvent the removed thing as a safety improvement.
- Cite line-pinned source anchors (`install_rm520n.sh:426`) so a reader can
  re-verify; cite commit SHAs once, as a pointer to the archive.
- Related: [[release-notes-earlier-bullets-go-stale]] — same split, different
  audience.
