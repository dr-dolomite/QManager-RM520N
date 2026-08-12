// lib/i18n/check.ts
// Run: bun run i18n:check
//
// Repo-wide i18n drift gate. Validates every locales/<lang>/<ns>.json against the
// English superset using the shared engine in lib/i18n/pack.ts (the SAME engine
// the contributor CLI `bun run lang check` and the CI parity gate use — one
// definition of "valid", no drift between surfaces).
//
// ---------------------------------------------------------------------------
// SEVERITY POLICY (this file's, not pack.ts's)
// ---------------------------------------------------------------------------
// pack.ts tags each Issue with `hard` — the CONTRIBUTOR-facing severity, which
// CI reads via `report.ok` to decide whether an outside PR may merge. Partial
// translations are welcome from contributors, so a missing key is soft there and
// must stay soft: flipping `hard` in pack.ts would start failing the CI workflow.
//
// This gate answers a different question — "is the repo's own bundled i18n in
// parity right now?" — and applies a STRICTER policy on top of the same issues:
//
//   missing key / missing namespace  -> ERROR   (was a warning until 2026-08-12)
//   empty-string value               -> ERROR   (via emptyIsMissing:true)
//   extra key / extra namespace      -> ERROR
//   malformed JSON                   -> ERROR
//   {{placeholder}} mismatch         -> ERROR
//   HTML tag mismatch / imbalance    -> ERROR
//   unusual plural category          -> warning
//   untranslated passthrough         -> warning (see lib/i18n/passthrough.ts)
//
// The missing-key flip is the point of the gate. Before it, a run could print
// hundreds of missing keys and still exit 0 — and a real regression shipped 98
// keys English-only straight through a green run.
//
// ---------------------------------------------------------------------------
// ESCAPE HATCH
// ---------------------------------------------------------------------------
//   --warn-only  (alias --no-strict, or QM_I18N_WARN_ONLY=1)
//       Restore the old lenient severity: missing keys/namespaces become
//       warnings again and empty values count as translated. Structural errors
//       (extra/malformed/placeholder/HTML) still fail. Use this when you are
//       deliberately carrying tracked translation debt — see
//       docs/reference/sms-forwarding.md, which records 392 such warnings.
//   --no-passthrough
//       Skip the untranslated-passthrough scan.
//   --quiet
//       Totals only; suppress the per-issue lines.
//
// Zero arguments = the strict gate. Exit code 1 if any errors, else 0.

import { buildBaseIndex, compareAll, type Issue, type IssueKind } from "./pack";
import { scanLang, type PassthroughHit } from "./passthrough";

/** Kinds that pack.ts marks soft but this gate promotes to errors in strict mode. */
const PROMOTED: ReadonlySet<IssueKind> = new Set<IssueKind>(["missing_key", "missing_ns"]);

interface Options {
  strict: boolean;
  passthrough: boolean;
  quiet: boolean;
}

function parseArgs(argv: string[]): Options | null {
  const opts: Options = {
    strict: process.env.QM_I18N_WARN_ONLY !== "1",
    passthrough: true,
    quiet: false,
  };
  for (const arg of argv) {
    switch (arg) {
      case "--warn-only":
      case "--no-strict":
        opts.strict = false;
        break;
      case "--strict":
        opts.strict = true;
        break;
      case "--no-passthrough":
        opts.passthrough = false;
        break;
      case "--quiet":
        opts.quiet = true;
        break;
      case "-h":
      case "--help":
        return null;
      default:
        console.error(`[i18n:check] unknown flag: ${arg}\n`);
        return null;
    }
  }
  return opts;
}

function usage(): void {
  console.log(
    [
      "Usage: bun run i18n:check [flags]",
      "",
      "Validates public/locales/<lang>/**.json against the English superset.",
      "With no flags it is STRICT: a missing key, an empty value, an extra key,",
      "malformed JSON, or a {{placeholder}}/HTML mismatch all exit 1.",
      "",
      "  --warn-only, --no-strict   missing keys + empty values become warnings",
      "                             (also: QM_I18N_WARN_ONLY=1)",
      "  --strict                   force strict even if QM_I18N_WARN_ONLY=1",
      "  --no-passthrough           skip the untranslated-passthrough scan",
      "  --quiet                    totals only, no per-issue lines",
      "  -h, --help                 this text",
    ].join("\n"),
  );
}

/**
 * Percent for display. pack.ts's `pct()` rounds, so 1931/1933 prints as "100%" —
 * exactly the false all-clear this gate exists to remove. Reserve "100%" for a
 * genuinely complete pack and show a decimal otherwise.
 */
function completeness(done: number, total: number): string {
  if (total === 0) return "0%";
  if (done >= total) return "100%";
  const raw = (done / total) * 100;
  return `${raw >= 99.9 ? raw.toFixed(2) : raw.toFixed(1)}%`;
}

function describe(issue: Issue): string {
  const loc = issue.line ? `:${issue.line}` : "";
  const at = issue.key ? `${issue.lang}/${issue.ns}${loc} "${issue.key}"` : `${issue.lang}/${issue.ns}${loc}`;
  const suffix = issue.suggestion ? ` (did you mean "${issue.suggestion}"?)` : "";
  return `${at}: ${issue.message}${suffix}`;
}

function describeHit(hit: PassthroughHit): string {
  const loc = hit.line ? `:${hit.line}` : "";
  return (
    `${hit.lang}/${hit.ns}${loc} "${hit.key}": value is identical to English — ` +
    `${JSON.stringify(hit.value)} (untranslated? "${hit.words.join('", "')}"). ` +
    `If it is correct as-is, add the term to lib/i18n/passthrough-allowlist.json`
  );
}

function main(argv: string[]): number {
  const opts = parseArgs(argv);
  if (!opts) {
    usage();
    return 2;
  }

  // emptyIsMissing tracks strictness: in strict mode a key present with `""` is
  // NOT translated (it renders as blank UI, not as an English fallback). In
  // warn-only mode we keep the historical structure-only view.
  const reports = compareAll({ emptyIsMissing: opts.strict });

  let errors = 0;
  let warnings = 0;

  const base = opts.passthrough ? buildBaseIndex() : null;

  for (const r of reports) {
    const isError = (i: Issue) => i.hard || (opts.strict && PROMOTED.has(i.kind));
    const hard = r.issues.filter(isError);
    const soft = r.issues.filter((i) => !isError(i));
    for (const i of hard) {
      if (!opts.quiet) console.error(`[err]  ${describe(i)}`);
      errors++;
    }
    for (const i of soft) {
      if (!opts.quiet) console.warn(`[warn] ${describe(i)}`);
      warnings++;
    }

    let ptNote = "";
    if (base) {
      const pt = scanLang(r.lang, base);
      for (const h of pt.hits) {
        if (!opts.quiet) console.warn(`[warn] ${describeHit(h)}`);
        warnings++;
      }
      ptNote = `, ${pt.hits.length} suspect passthrough of ${pt.identical} identical`;
    }

    console.log(
      `       ${r.lang}: ${completeness(r.translatedKeys, r.totalKeys)} translated ` +
        `(${r.translatedKeys}/${r.totalKeys})${ptNote}`,
    );
  }

  const mode = opts.strict ? "strict" : "warn-only";
  console.log(`\n[i18n:check] ${errors} error(s), ${warnings} warning(s) [${mode}]`);
  if (errors > 0 && opts.strict) {
    console.log(
      `[i18n:check] Re-run with --warn-only if this is deliberate, tracked translation debt.`,
    );
  }
  return errors > 0 ? 1 : 0;
}

process.exit(main(process.argv.slice(2)));
