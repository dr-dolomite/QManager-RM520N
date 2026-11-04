---
name: worktree-bash-guard-refuses-variables
description: In a worktree-isolated session the Bash guard refuses sed/xargs with a computed argument and any git inside a compound command
metadata:
  type: reference
---

In a worktree-isolated session, Bash refuses a command when a runtime-computed value (`$f`, `xargs` output) sits where an option could go, and refuses `git` inside a long compound chain. Seen 2026-10-11.

**Why:** the guard cannot prove the command is not git targeting another tree, so it blocks it outright and the turn is wasted.

**How to apply:** spell paths out literally with `--` before them (`sed -i -e 's/$/\r/' -- docs/x.md`), use Edit for text changes, and run each `git` command as its own plain call. CRLF conversion of a new doc works that way (see [[locale-packs-are-crlf]]).
