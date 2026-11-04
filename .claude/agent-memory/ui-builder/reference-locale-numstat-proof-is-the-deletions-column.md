---
name: locale-numstat-proof-is-the-deletions-column
description: On an uncommitted worktree a locale pack's `git diff --numstat` shows the WHOLE subtree as added, so CRLF preservation is proved by the deletions column being 0 — never by a small additions count
metadata:
  type: reference
---

`git diff --numstat public/locales/` is the standard proof that a JSON round-trip kept the
packs' CRLF endings. The usual brief says "the additions/deletions must be small". That test
is wrong whenever the feature's earlier work is still **uncommitted** in the worktree: git
diffs against HEAD, so the entire new subtree (here `software_update`, 220 lines) reads as
added and the number is large and alarming for no reason.

**Why:** an eight-key edit inside a 680-line pack reported `220  0` on all five packs. It
looked like a whole-file rewrite. It was not — the 220 was the pre-existing, uncommitted
subtree; the 0 was the real signal.

**How to apply:** read the **deletions column**. `0` deletions means not one pre-existing line
was re-emitted, which is exactly what a line-ending rewrite would blow up. Back it with a byte
check rather than `grep` (Git Bash strips CR):

```js
const b = require("fs").readFileSync(p).toString("latin1");
// crlf count must equal lf count, and the file must end "\r\n"
```

Run `git status --short` first: if the surface's own files are still `??` / ` M`, expect the
large additions number and do not chase it. See [[reference-locale-packs-are-crlf]].
