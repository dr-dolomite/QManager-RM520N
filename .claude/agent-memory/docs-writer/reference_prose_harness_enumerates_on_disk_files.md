---
name: prose-harness-enumerates-on-disk-files
description: tailwind-prose-candidates.sh once listed only TRACKED files and went green against a brand-new untracked doc; it now uses --cached --others --exclude-standard, so check a harness's file-list source before trusting its green
metadata:
  type: reference
---

`scripts/test/tailwind-prose-candidates.sh` builds its file list with `git ls-files --cached --others --exclude-standard`, then drops `node_modules/`, `out/`, `.claude/` and the lockfiles. That set is deliberately **what Tailwind actually reads**: everything on disk that `.gitignore` does not exclude, tracked or not.

It did not start that way. The first version used a plain `git ls-files`, which lists only **tracked** files — so a document that had just been written and not staged was outside the check entirely, and the harness reported "4 passed, 0 failed" about a file it had never opened. The document in question was the reference doc *for the arbitrary-value hazard itself*, which is the single likeliest file in the repo to contain a fatal spelling: whoever is writing fresh prose about arbitrary values is the person most likely to write one. Fixed the same day it was found.

**Why:** this is the [[harness-green-is-family-scoped]] failure wearing different clothes. That memory covers a harness whose file list is **hand-written**, so a class inside a `components/ui/**` primitive is invisible to it. This one covers a harness whose file list is **derived from git**, so anything git does not yet know about is invisible to it. Both produce the same sentence in a close-out — "pinned by `<harness>`, GREEN at N/0" — and in both cases the sentence is true about the harness and false about the thing the reader will take it to mean.

**How to apply:** before writing "the harness pins X", read the ten lines where that harness builds its input set, and confirm the file you just created or changed is in it. Two specific traps: a `git ls-files` with no `--others` misses anything unstaged, and any hand-listed `for f in ...` misses everything not named. `git add -N` is **not** the workaround — the git index is per-worktree, not per-session, so a concurrent session's `git add`/`commit` can sweep up whatever you stage.

Do not cite a commit SHA for this fix in a doc: this history has been rewritten at least once, so name the flags and the behaviour instead.

Related: [[harness-green-is-family-scoped]], [[commit-is-archive-doc-is-forward-looking]].
