---
name: reference-never-hand-escape-cjk-locale-strings
description: Hand-written \uXXXX escapes for zh-CN/zh-TW locale strings silently produced wrong glyphs (繯 for 繞, 状 for 狀) and every gate stayed green
metadata:
  type: reference
---

Never hand-write `\uXXXX` escapes for CJK locale copy. Write the characters
literally into a UTF-8 file (Write tool, or a scratch JSON the patch script
reads) and take OLD values by parsing the pack itself, never by retyping them.

**Why:** patching `public/locales/zh-*/common.json` with hand-built escapes put
繯 where 繞 belonged and simplified 状 into a zh-TW string; two other
replacements also silently matched nothing. `i18n:check`, `tsc` and `build` all
stay green — parity counts keys, not glyphs, so nothing catches it. Only a
read-back of the parsed value showed the damage.

**How to apply:** patch scripts do line surgery with
`json.dumps(value, ensure_ascii=False)` built from the file's own parsed value
for the old side and from a literal-character source for the new side, then
assert the re-parsed result equals the intended string before writing. Keep
`newline=''` on both read and write so the CRLF packs round-trip
([[reference-locale-numstat-proof-is-the-deletions-column]] — 5 added / 4
deleted per file is the shape of four replacements plus one insertion).
Also: the Windows console is cp1252, so printing CJK from python crashes the
script; set `PYTHONIOENCODING=utf-8` or print nothing but ASCII.
