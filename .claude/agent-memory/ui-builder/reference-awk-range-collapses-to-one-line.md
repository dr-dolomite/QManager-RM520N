---
name: awk-range-collapses-to-one-line
description: A `scripts/test/*.sh` harness that extracts a code block with awk '/start/,/end/' collapses to ONE line when the start line also matches the end pattern — which dictates how you must indent the code being tested
metadata:
  type: reference
---

The design-language harnesses in `scripts/test/` extract a function or block
with an awk range before grepping inside it, e.g.

```sh
awk '/} catch \(err\) \{/,/^      \}/' hook.code > save-catch.code
grep -q 'scheduleReconcile' save-catch.code
```

**In awk, if a record matches the start pattern AND the end pattern, the range
is that single record.** A `catch` indented six spaces is `      } catch (err) {`
— which matches `^      \}` — so the extraction returns one line and the assertion
can never pass no matter what the block contains.

The same trap fires one level in: the range ends at the FIRST end-match *after*
the start, so a nested `if (…) { … }` closing at that indent truncates the
extract before the symbol being asserted on.

**How to apply:** when a committed-red harness assertion looks unsatisfiable,
run the harness's own awk line by hand before concluding the assertion is wrong.
Then satisfy it by CODE SHAPE, not by weakening the test (editing a
committed-red harness is a protocol violation):

- move the block's indent off the end pattern — e.g. `useCallback(async (x) => {`
  (body at 4) instead of `useCallback(\n  async (x) => {` (body at 6). Prefer a
  shape the file already uses elsewhere so it reads as consistency, not as
  grep-driven formatting.
- order the block so the asserted symbol precedes any nested closer at the end
  pattern's indent — inverting a branch (`if (!(err instanceof X)) { …call…; }`)
  usually does it naturally.

Verified 2026-08-31 on `scripts/test/apn-management-design-language.sh`
assertion [12].

Related: [[verify-a-briefs-already-done-at-n-sites-against-git-show-head]] — the
general rule that a claim about the tree is checked against the tree.
