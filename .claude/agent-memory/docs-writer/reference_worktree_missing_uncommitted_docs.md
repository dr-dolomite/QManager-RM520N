---
name: worktree-missing-uncommitted-docs
description: A doc-close brief citing "file.md:NNN" can point at text that exists only as uncommitted/untracked work in the shared checkout — the worktree has neither the file nor the line
metadata:
  type: reference
---

A worktree carries **committed** state only. Doc work in this project is routinely
left uncommitted in the shared checkout for days, so a Phase 6 brief that names a
file and a line number can point at prose the worktree has never seen.

**Why:** on the 2026-08-25 F8 close the brief said "F8 was filed in
`docs/reference/platform-matrix.md:343`". In the worktree line 343 was a table
header, the string `F8` appeared nowhere in `docs/`, and
`docs/reference/lan-gateway-ip.md` — a second file the brief asked me to edit —
did not exist at all. Both lived in the shared checkout as `M` / `??`. Same family
as the known `.env` / `node_modules` / `/reimagine/` worktree gaps, but it looks
like a wrong brief rather than a missing file.

**How to apply:** before concluding a brief is wrong, `diff` the named file against
the shared checkout's copy and check whether the file is untracked there. Recovery
is `cp` the shared copy into the worktree, edit there, and tell the user to discard
the shared checkout's now-superseded uncommitted copy before merging — otherwise
git refuses the checkout with "local changes would be overwritten". Never edit the
shared checkout directly from a worktree-isolated session.
