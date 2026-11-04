---
name: parallel-session-rewrites-your-write-set
description: In a multi-agent refit a sibling session rewrote files inside MY declared write set mid-run — poll mtimes until stable before running any gate or reading a key contract
metadata:
  type: reference
---

A brief that says "a second builder is working in the same worktree on X and Y" does **not** guarantee the split holds. During the `/about-device` refit a sibling session rewrote files inside my *own* declared write set while I was mid-gate: it renamed `about-qmanager-card.tsx` → `qmanager-band.tsx`, inlined `page-header.tsx` into the shell and deleted it, deleted `github-mark.tsx`, added `isRefreshing` to the hook, and added a `text()` normalizer plus `identityFigures()` to `derive.ts`.

**The tells, in the order they appear:**

1. The harness `changed on disk since you last read it` notice on a file *you* just wrote. That notice reads like a formatter ran; a rename or a new exported function means it was an agent.
2. A moment of **broken tree**: the shell imported `./qmanager-band` a full minute before that file existed. A gate run in that window fails for a reason that is not yours and evaporates on its own.
3. `ls` disagreeing with the imports in the file you just read.

**Never revert it** (the harness says so, and the sibling's version was the better one here). **Never fight it** either — a re-write of your version restarts the collision.

**Wait for quiescence first.** Poll until the directory hashes the same N times in a row, then gate:

```bash
prev=""; stable=0
for i in $(seq 1 40); do
  cur=$(find components/<family> -type f -printf '%T@ %p\n' | sort | md5sum)
  [ "$cur" = "$prev" ] && stable=$((stable+1)) || stable=0
  prev="$cur"; [ $stable -ge 8 ] && break; sleep 3
done
```

**Then re-derive every artifact that mirrors the source.** The i18n key contract was the trap: the settled version moved the licence string to a local const and dropped the Refresh `aria-label`, so two keys in my finished `keys-*.json` had no call site left. Extract the keys from the *settled* files programmatically and diff both directions — called-but-undeclared is a runtime hole, declared-but-uncalled is dead weight the locale worker translates five times.

**Why:** the worktree model puts several agents on one tree, and write-set boundaries in a brief are a plan, not a lock.

**How to apply:** after your last write in a shared worktree, poll for quiescence, re-read your own files, re-extract any generated contract, and only then run `tsc` / `lint` / `build`. Related: [[reference-parallel-sessions-share-browser-and-devserver]], [[reference-shared-index-parallel-session-steals-staged-files]].
