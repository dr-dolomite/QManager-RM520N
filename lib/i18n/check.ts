// lib/i18n/check.ts
// Run: bun run i18n:check
//
// Repo-wide i18n drift gate. Validates every locales/<lang>/<ns>.json against the
// English superset using the shared engine in lib/i18n/pack.ts (the SAME engine
// the contributor CLI `bun run lang check` and the CI parity gate use — one
// definition of "valid", no drift between surfaces).
//
// Semantics preserved from the original checker:
//   - missing keys / namespaces        -> warning (language falls back to English)
//   - extra keys / namespaces          -> ERROR (dead weight the app can't display)
//   - malformed JSON                   -> ERROR
// New (from pack.ts), all additive:
//   - {{placeholder}} mismatch         -> ERROR (renders broken text)
//   - HTML tag mismatch/imbalance      -> ERROR (escapeValue:false → layout/XSS hazard)
//   - unusual plural category          -> warning only (never regresses existing langs)
//
// Exit code 1 if any errors, else 0.

import { compareAll, pct, type Issue } from "./pack";

function describe(issue: Issue): string {
  const loc = issue.line ? `:${issue.line}` : "";
  const at = issue.key ? `${issue.lang}/${issue.ns}${loc} "${issue.key}"` : `${issue.lang}/${issue.ns}${loc}`;
  const suffix = issue.suggestion ? ` (did you mean "${issue.suggestion}"?)` : "";
  return `${at}: ${issue.message}${suffix}`;
}

function main(): number {
  // emptyIsMissing:false — the repo drift gate cares about key *structure*, not
  // whether a bundled language left a value blank. (The contributor CLI uses
  // emptyIsMissing:true to drive completeness.) This keeps i18n:check focused on
  // the same thing it always checked: are the key sets in parity?
  const reports = compareAll({ emptyIsMissing: false });

  let errors = 0;
  let warnings = 0;

  for (const r of reports) {
    const hard = r.issues.filter((i) => i.hard);
    const soft = r.issues.filter((i) => !i.hard);
    for (const i of hard) {
      console.error(`[err]  ${describe(i)}`);
      errors++;
    }
    for (const i of soft) {
      console.warn(`[warn] ${describe(i)}`);
      warnings++;
    }
    console.log(`       ${r.lang}: ${pct(r.completeness)} translated (${r.translatedKeys}/${r.totalKeys})`);
  }

  console.log(`\n[i18n:check] ${errors} error(s), ${warnings} warning(s)`);
  return errors > 0 ? 1 : 0;
}

process.exit(main());
