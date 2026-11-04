---
name: locale-parity-baseline-is-100
description: All five locales sit at 100% parity, so ANY en-only key addition turns bun run i18n:check red — budget for translating or for shipping a knowingly-red gate
type: reference
---

`bun run i18n:check` baseline (verified 2026-08-12, before any of my edits) is **0 errors, 11 warnings**, with `id`/`it`/`zh-CN`/`zh-TW` each at **100% (1933/1933)**.

That baseline is the trap: strict mode promotes `missing_key` to an ERROR, so adding N keys to `public/locales/en/**` alone produces exactly **N × 4 errors** and a red gate. There is no "en is the superset, others catch up later" tolerance in this repo — the superset and the packs are always equal.

**How to apply:** before adding user-visible strings, decide up front which of three you are doing, and say so in the report:
1. translate the new keys into all five locales in the same pass (keeps the gate green);
2. ship en-only *because the brief scoped translation to a separate pass* — then report the exact error count and confirm with `--warn-only` that **0 structural errors** remain (extra key / placeholder / HTML mismatches all still fail in warn-only, so a clean `--warn-only` run proves the only debt is untranslated text);
3. don't add the string.

Never paper over it by copying the English value into the other four packs: that is the "98 keys English-only through a green run" regression the gate was hardened to catch, and it downgrades a hard error into a soft passthrough warning nobody reads.

Deleting a retired key is the mirror case and must touch **all five** packs, or the four non-en ones fail as `extra_key` — which is an error even in `--warn-only`.

**The round-trip guard needs CRLF, or it always aborts.** `public/locales/**/*.json` are checked in with **CRLF** line endings (no `.gitattributes` rule covers them, no BOM). So the canonical guard —
`json.dumps(d, ensure_ascii=False, indent=2) + "\n" == original` — fails on every pack by exactly one char per line and reads as "this file is hand-formatted, abort". Normalise before comparing and before writing: `render = (dumps(...) + "\n").replace("\n", "\r\n")`, and read/write with `newline=""` so Python does not translate underneath you. With that, all five packs round-trip byte-identical and a 3-add/6-delete edit lands as a **5-insertion / 17-deletion** diff per pack instead of reformatting 3000 lines.

*(Verified 2026-08-21; baseline had moved to 2309/2309 per locale by then, so treat the count above as the shape, not the number.)*

Related: [[i18n-check-missing-keys-are-warnings]]
