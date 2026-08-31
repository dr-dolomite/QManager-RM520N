---
name: locale-packs-are-crlf
description: public/locales/*.json are CRLF with no .gitattributes rule, so the usual JSON.stringify round-trip guard aborts on every pack and reads canonical files as hand-formatted
metadata:
  type: reference
---

The five `public/locales/<lang>/*.json` packs are checked in with **CRLF**, and
`.gitattributes` covers only shell scripts / systemd units / installers — nothing
under `public/locales`.

**Why it matters:** the standard safety guard before mutating generated-looking
JSON is `JSON.stringify(json, null, 2) + "\n" === original`. `JSON.stringify`
emits `\n`; the file has `\r\n`. So the guard fails on **all five packs, always**,
and reports "hand-formatted, do not touch" about files that are perfectly
canonical. The two outcomes are both wrong: the script aborts and edits nothing,
or someone deletes the guard and the next write reformats ~3000 lines.

**How to apply:** when writing or reviewing any locale-editing script, normalise
before comparing — `(JSON.stringify(json, null, 2) + "\n").replace(/\n/g, "\r\n")`
— read/write with newline translation off, and **validate the guard in
report-only mode against the untouched tree first** (a correct guard reports zero
differences; five means the guard is broken, not the files). Do not drive-by add
`public/locales/**/*.json text eol=lf` to `.gitattributes` — that renormalisation
rewrites every pack in one commit and buries whatever real change rides with it.

Full mechanism documented at `docs/reference/i18n.md` § "Locale files are CRLF".
Related: [[i18n-check-now-hard-gate]].

**The same trap applies to `docs/reference/*.md` and the repo-root Markdown.**
They are CRLF in the working tree too, and an edit pass can silently rewrite a
whole file to LF (observed 2026-08-31 on `docs/reference/dpi.md`). `git diff`
does **not** show it, because `core.autocrlf=true` normalises on read, so the
stat line still reads as a handful of changed lines. Check after editing any
doc — count `\n` not preceded by `\r` with a node byte read, since `cat -A`,
`sed` and `awk` all strip the carriage return in this environment — and convert
back if the file came out all-LF while its siblings are CRLF.
