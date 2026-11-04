---
name: windows-edit-encoding-traps
description: Scripted edits of repo shell files from Windows corrupt non-ASCII (em dashes) unless encoding is explicit; Write may flatten em-dash escapes
metadata:
  type: reference
---

Python `open()` on this Windows host defaults to cp1252: a read/write round trip of a shell file with em dashes (U+2014) produced U+FFFD in the diff. Always `io.open(p, encoding='utf-8', newline='')`.

Also: em dashes or `—` escapes typed inside a Write-tool Python script came back as a plain `-`, so `old` strings that contain em dashes never match. Anchor `cut(start, end)` on dash-free text, and build arrows with `chr(0x2192)`.

**How to apply:** after any scripted edit run `git diff <file>` and look for U+FFFD or collapsed `\` continuation lines before running `bash -n`. A worktree-isolated session also refuses `for` loops and `&&` chains that mix `git`-looking constructs; run `bash -n` and `check-crlf.sh` as separate plain commands.
