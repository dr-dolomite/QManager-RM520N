---
name: i18n-check-now-hard-gate
description: Since 2026-08-12 `bun run i18n:check` exits 1 on a missing key or empty value — seven reference docs carried the old "warnings, exits 0" line and had to be corrected; know which i18n holes the flip did NOT close
metadata:
  type: reference
---

`bun run i18n:check` (`lib/i18n/check.ts`) **exits 1** on a missing key, a missing namespace, or an empty-string value (`emptyIsMissing: true`), and adds an untranslated-passthrough warning. `--warn-only` / `--no-strict` / `QM_I18N_WARN_ONLY=1` restores the old lenient behaviour for **deliberate, tracked** debt. CI is unchanged: `.github/workflows/i18n-parity.yml` runs `bun run lang check --all --ci` and gates on `pack.ts`'s `hard` flags, which stayed lenient so partial community packs can still merge. Two policies, one engine.

**Why this matters to docs:** the old lenient behaviour was quoted as a standing caveat in **seven** reference docs, usually phrased as "grades missing keys as warnings and exits 0, so a green run proves nothing" or "read the warning count, not the exit code". All of those were corrected on 2026-08-12 (sms.md, sms-forwarding.md, radio-information.md, band-locking.md, frequency-locking.md, tower-locking.md ×4, plus four "why `i18n:check` is not a gate" cross-reference lines). A behavioural caveat repeated across many docs becomes a maintenance liability the moment the behaviour changes.

**How to apply:** when a caveat like this changes, `grep` the phrasing across all of `docs/`, not just the files named in the brief — the wording drifts, so search the *claim* ("exits 0", "not a gate", "warning, not an error"), not an exact sentence. And do not over-correct: the flip did **not** close three holes, and docs that cite those reasons are still right —
1. **Hardcoded literals** — a string that never went through `t()` has no key to be missing.
2. **`defaultValue` on a user-visible string** — the key is absent from `en` too, so nothing compares it.
3. **Interpolated keys** (`` t(`status_${x}`) ``) — the key exists in no file, so no key-set comparison can see it.
