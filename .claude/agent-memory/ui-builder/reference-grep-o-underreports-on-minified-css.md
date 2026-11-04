---
name: grep-o-underreports-on-minified-css
description: Git Bash `grep -o ... | wc -l` returns 0 on the minified one-line CSS bundle while `grep -c` returns 1 — so an emitted-rule check can say "Tailwind never compiled this" when it did
metadata:
  type: reference
---

Verifying that a class actually reached the stylesheet means grepping `out/_next/static/chunks/*.css`. That file is **one line, ~226KB**. On MSYS/Git Bash, `grep -o` against a line that long silently emits nothing:

```
grep -c  -- "163300" chunk.css   ->  1      # found
grep -oiF -- "163300" chunk.css | wc -l  ->  0      # LIES
```

Every hex in a set came back `0` this way, which reads exactly like "Tailwind did not generate the brand fills" — a fabricated defect. `grep -rl` and `grep -c` were correct throughout.

Two more traps in the same check:
- `grep 'shadow-\[var(--shadow-whisper)\]'` never matches: Tailwind escapes the **parens** too, so the selector on disk is `.shadow-\[var\(--shadow-whisper\)\]`. Grep for the bare token (`shadow-whisper`, `min(34rem`) and print surrounding context instead of trying to spell the escaped selector.
- `cat out/.../*.css > tmp` then grepping `tmp` can read a chunk a **sibling session's concurrent build** is mid-rewrite of, so hashes change and the file goes empty of your rules.

**The reliable form** is a node pass over the single real chunk, splitting on `/([^{}@]{1,250})\{([^{}]{0,400})\}/g` and substring-matching each token — it prints the whole emitted rule, which is the actual evidence (e.g. `--tw-shadow:var(--shadow-whisper)!important` proves the important marker beat `card.tsx`'s `shadow-sm`).

**Why:** the check exists because a mis-spelled arbitrary class compiles to nothing while tsc, eslint and `next build` all stay green — so the grep is the *only* gate, and a grep that under-reports is worse than none.

**How to apply:** never conclude "the class was not generated" from a `grep -o` count. Confirm with `grep -c` or the node rule-dump, then read the emitted declaration. Related: [[reference-tailwind-scanner-needs-literal-bang]], [[reference-custom-radius-overrides-lose-alphabetically]], [[reference-msys-grep-treats-crlf-as-line-terminator]].
