---
name: write-set-rewritten-by-a-consolidation-pass
description: In a shared worktree another agent rewrote files inside MY write set mid-run — split files inlined, hover hexes retuned, a key call replaced by a constant; re-read from disk before reporting
metadata:
  type: reference
---

During the `/support` + Donate re-authoring, files I had just written were **edited by something other than me**, ~5 minutes after each write, with no hook configured in `.claude/settings.json`:

- `action-row.tsx`, `brand-icons.tsx` and `links.ts` were **inlined back into** `support.tsx` and `donate-links.tsx`, orphaning all three (I had to delete them).
- Brand hover steps in `shapes.ts` were retuned (`#8FDC5C`→`#8FD75E`, `#A62F76`→`#A32F75`, `#002070`→`#00246B`). The five *mandated* values were untouched.
- Geometry was nudged (`pr-4 pl-3`→`px-4`, `size-8`→`size-[1.875rem]`).
- A `t()` call became a constant: `support.help.community.dest` → `LINKS.DISCORD_NAME`, which silently made one entry in my locale key-tree contract an unused key.

The harness announces this as "changed on disk since you last read it" and tells you to keep the new state, which is right — the edits were all defensible. But the consequences are yours:

- **Your report will be wrong** if you describe the code you wrote rather than the code on disk. Re-read every file in the write set before writing the file list.
- **An i18n contract file goes stale**, because a call site can disappear. Re-derive the key list from the *current* sources and diff it against the JSON — do not trust the list you wrote by hand.
- **Orphans are yours to clean.** `grep -rn` for each file you created; anything with no importer left is dead code you introduced.
- **Re-run every gate afterwards**, including the CSS check — a retuned hex is a different Tailwind class.

**Why:** several agents share one worktree in a family refit, and a simplify/consolidate pass legitimately touches the same files a builder is still verifying.

**How to apply:** treat "I wrote it" as a claim about the past. Before the final report: re-read the write set, re-derive any generated contract from it, `grep` for orphans, and re-run tsc / lint / build. Related: [[reference-parallel-sessions-share-browser-and-devserver]], [[reference-family-refit-shell-blocks-verification]], [[feedback-verify-agent-cleanup-claims-with-git]].
