---
name: python-heredoc-mangles-utf8-on-windows
description: A python script piped through a Bash heredoc on this Windows host reads non-ASCII (em dash) as cp1252, so exact-match doc splices silently fail; also docs/*.md are CRLF in the worktree
metadata:
  type: reference
---

Splicing docs with Python: write the script to a file in the scratchpad and run `python -X utf8 <file>`. A `python - <<'EOF'` heredoc decodes the source as cp1252, so any `—` in an `old` string never matches.

Docs are CRLF in the working tree (autocrlf=true) even when Git Bash `grep -c $'\r$'` reports 0. Load with `newline=''`, normalise `\r\n`→`\n`, edit, write back with `\r\n`, then count `b'\r\n'` vs `b'\n'` to prove no mixed endings. See [[locale-packs-are-crlf]].

**Why:** cost two failed splice runs on 2026-10-28 and one mixed-ending file that had to be re-normalised.
**How to apply:** any multi-section doc rewrite done by script rather than Edit.
