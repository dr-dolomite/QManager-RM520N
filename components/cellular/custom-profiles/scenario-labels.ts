import type { TFunction } from "i18next";

import {
  bandsToDisplay,
  modeValueToLabelKey,
  optimizationLabelKey,
} from "@/types/connection-scenario";

// =============================================================================
// scenario-labels.ts — the one place a stored scenario token becomes a word
// =============================================================================
// `types/connection-scenario.ts` is a plain constant module with no `t()` in
// scope, so its display helpers return i18n KEYS or `null` and refuse to guess
// (see the module note there). These three functions are the other half of that
// contract: they take the reader's `t` and finish the job.
//
// WHY THEY LIVE HERE AND NOT IN THE TYPE MODULE. A `types/` module that
// imported `i18next` would drag the whole i18n runtime into `band-locking.tsx`,
// which reads `DEFAULT_SCENARIOS` purely for its `config` values and shows none
// of these strings to anyone.
//
// WHY THEY ARE SHARED AND NOT LOCAL TO ONE CARD. Before this, the network mode
// was rendered from `config.mode` in the active-config card and from
// `modeValueToLabel(config.atModeValue)` in the hero — two paths to the same
// fact, one of them reading a stale persisted copy. Two renderings of one value
// is the drift this file exists to make impossible.
//
// WHERE THE KEYS THEMSELVES LIVE. Every `t()` below is called with a VARIABLE,
// so none of these keys appears as a literal anywhere in the tree. `bun run
// i18n:check` is unaffected — it compares each locale pack against the English
// superset and never reads source — but a human grepping for
// `scenarios.network_mode.auto` will find only the JSON. The two maps in
// `types/connection-scenario.ts` (`NETWORK_MODE_OPTIONS` and
// `OPTIMIZATION_LABEL_KEY`) are the index; adding a key means adding it there,
// not here.
// =============================================================================

/**
 * An AT `mode_pref` value → the reader's word for it.
 *
 * An unrecognised combination falls back to the RAW AT VALUE. That is not a
 * failure to translate — there is no word for a mode this build does not know,
 * and showing what the modem actually reported is more useful than a guess.
 * Callers that render this in machine voice should keep doing so.
 */
export function modeLabel(t: TFunction, atModeValue: string): string {
  const key = modeValueToLabelKey(atModeValue);
  return key ? t(key) : atModeValue;
}

/**
 * A stored `optimization` token → the reader's word for it.
 *
 * Falls back to the stored string VERBATIM, which is the correct behaviour and
 * not a gap: the edit dialog's optimization field is free text, so anything
 * outside the four tokens this app writes is the user's own word and must not
 * be translated, trimmed or title-cased.
 */
export function optimizationLabel(t: TFunction, value: string): string {
  const key = optimizationLabelKey(value);
  return key ? t(key) : value;
}

/** A colon-delimited band lock → "1, 3, 7", or the reader's word for "Auto". */
export function bandsLabel(t: TFunction, colonDelimited: string): string {
  return bandsToDisplay(colonDelimited) ?? t("scenarios.bands_auto");
}
