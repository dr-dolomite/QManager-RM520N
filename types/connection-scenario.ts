// =============================================================================
// connection-scenario.ts — QManager Connection Scenario Types
// =============================================================================
// TypeScript interfaces and default scenario constants for the Connection
// Scenarios feature. Connection Scenarios control radio/RF configuration
// (network mode, band locks) and sit above SIM Profiles in the hierarchy.
//
// SIM Profiles = identity/connectivity (APN, IMEI, TTL/HL)
// Connection Scenarios = radio/RF config (network mode, bands)
//
// Backend contract:
//   Active scenario: /etc/qmanager/active_scenario
//   Activate endpoint: POST /cgi-bin/quecmanager/scenarios/activate.sh
//   Status endpoint:   GET  /cgi-bin/quecmanager/scenarios/active.sh
// =============================================================================

// --- Network Mode Options ----------------------------------------------------
//
// THIS MODULE RETURNS KEYS, NEVER ENGLISH.
//
// It is a plain `.ts` constant module with no React and no `t()` in scope, so
// anything it returns as a finished string ships to an Italian or Chinese user
// in English no matter how well the surface around it is translated. Every
// display helper below therefore hands the caller an i18n KEY, or `null` when
// there is nothing to say and the caller owns the word.
//
// `null` rather than a fallback key is deliberate: a helper that quietly
// substitutes a default cannot be told apart from one that found a real value,
// and "Auto" means different things in the two places this used to return it
// (an unrecognised AT mode versus an empty band lock).

export const NETWORK_MODE_OPTIONS = [
  { labelKey: "scenarios.network_mode.auto", value: "AUTO" },
  { labelKey: "scenarios.network_mode.lte_only", value: "LTE" },
  { labelKey: "scenarios.network_mode.nr5g_only", value: "NR5G" },
  { labelKey: "scenarios.network_mode.lte_nr5g", value: "LTE:NR5G" },
] as const;

/**
 * AT `mode_pref` value → the i18n key that names it, or `null` when the device
 * reported a combination this build does not know.
 *
 * On `null` the caller prints the RAW AT value in machine voice — that is an
 * honest "the modem said `LTE:NR5G:NBIOT` and we have no word for it", where
 * the old fallback silently rendered the same raw token as if it were a label.
 */
export function modeValueToLabelKey(atValue: string): string | null {
  return NETWORK_MODE_OPTIONS.find((o) => o.value === atValue)?.labelKey ?? null;
}

/**
 * The four optimization values THIS APP writes → their i18n keys.
 *
 * `optimization` is a free-text field in the edit dialog, so a user's own word
 * ("Rural", "Nonna's house") must survive verbatim — but the three built-in
 * scenarios and the create dialog write fixed English tokens, and those are
 * ours to translate. The stored string stays the stable machine token so no
 * data migration is needed; only the DISPLAY resolves through this map.
 */
const OPTIMIZATION_LABEL_KEY: Record<string, string> = {
  Balanced: "scenarios.optimization.balanced",
  Latency: "scenarios.optimization.latency",
  Throughput: "scenarios.optimization.throughput",
  Custom: "scenarios.optimization.custom",
};

/**
 * A stored `optimization` value → its i18n key, or `null` when the user typed
 * their own word and the caller should print it unchanged.
 */
export function optimizationLabelKey(value: string): string | null {
  return OPTIMIZATION_LABEL_KEY[value.trim()] ?? null;
}

// --- Band Format Helpers -----------------------------------------------------

/**
 * Colon-delimited storage → comma-separated display ("1:3:7" → "1, 3, 7").
 *
 * Returns `null` for an empty lock. The word for "no bands are locked" is
 * "Auto" in English and this module has no way to say it in Indonesian, so the
 * caller supplies it — see the module note above.
 */
export function bandsToDisplay(colonDelimited: string): string | null {
  if (!colonDelimited) return null;
  return colonDelimited.split(":").join(", ");
}

/** Comma-separated input → colon-delimited storage ("1, 3, 7" → "1:3:7") */
export function inputToBands(commaInput: string): string {
  if (!commaInput.trim()) return "";
  return commaInput
    .split(",")
    .map((b) => b.trim())
    .filter(Boolean)
    .join(":");
}

/** Colon-delimited storage → comma-separated input ("1:3:7" → "1, 3, 7") */
export function bandsToInput(colonDelimited: string): string {
  if (!colonDelimited) return "";
  return colonDelimited.split(":").join(", ");
}

// --- Scenario Data Model -----------------------------------------------------

/** Configuration settings for a connection scenario */
export interface ScenarioConfig {
  /** AT command value for mode_pref: "AUTO" | "LTE" | "NR5G" | "LTE:NR5G" */
  atModeValue: string;
  /**
   * DERIVED, PERSISTED, AND NEVER TO BE RENDERED. A redundant copy of
   * `atModeValue`, kept beside it.
   *
   * It used to hold an ENGLISH LABEL ("5G SA Only"), written before this
   * surface was translated, and reading it is why an Italian user saw English
   * here. Everything this build writes — the create and edit dialogs, and the
   * three `DEFAULT_SCENARIOS` — now puts the AT value in it, so the copy is at
   * least self-describing to anyone reading the JSON on the device. **Records
   * already saved on a device still hold the old English label**, which is
   * harmless only because nothing renders this field: every display site goes
   * through `modeValueToLabelKey(config.atModeValue)` instead.
   *
   * The field stays in the shape because it is already written into every
   * stored scenario on every device and the config store has no key-migration
   * primitive — dropping it here would strand it there.
   *
   * NOT the `mode` field `scenarios/activate.sh` parses out of the POST body.
   * That one is built separately in `use-connection-scenarios.ts` as
   * `body.mode = config.atModeValue`, and is unrelated to this.
   */
  mode: string;
  /**
   * Optimization, as a stored token. FREE TEXT in the edit dialog, so it may be
   * anything the user typed; the four values this app writes itself
   * ("Balanced", "Latency", "Throughput", "Custom") are translated at display
   * time via `optimizationLabelKey()`, and anything else prints verbatim.
   */
  optimization: string;
  /** LTE bands, colon-delimited (e.g., "1:3:7:28"). Empty = Auto. */
  lte_bands: string;
  /** NR5G NSA bands, colon-delimited (e.g., "41:78"). Empty = Auto. */
  nsa_nr_bands: string;
  /** NR5G SA bands, colon-delimited (e.g., "41:78"). Empty = Auto. */
  sa_nr_bands: string;
}

/** Full connection scenario definition */
export interface ConnectionScenario {
  /** Unique scenario ID (default: "balanced"|"gaming"|"streaming", custom: "custom-<ts>") */
  id: string;
  /** Display name */
  name: string;
  /** Short description */
  description: string;
  /**
   * Identity glyph KEY — one of `SCENARIO_ICONS[].id`, never a ligature.
   * Absent on pre-icon records, which resolve to the default glyph.
   *
   * THE ID/LIGATURE BOUNDARY IS AT THE RENDER SITE. This field holds the
   * persisted key everywhere it travels — through `StoredScenario`, through the
   * UI's `Scenario` view type, into the hero, the schedule ribbon and the
   * scenario tile — and each render site calls `resolveScenarioIcon()` itself.
   * Resolving early, so that a downstream consumer can render the field
   * directly, is what produced the shipped defect this contract now prevents: a
   * second inline copy of `DEFAULT_SCENARIOS` was written with ligature names
   * ("bolt", "sports_esports", "play_arrow") in this id-shaped field, no option
   * matched them, and all three built-in tiles fell back to the sparkle while
   * the hero — reading THIS constant — rendered the right glyphs.
   */
  icon?: string;
  /** SVG pattern type for the card overlay */
  pattern: "balanced" | "gaming" | "streaming" | "custom";
  /** Scenario configuration */
  config: ScenarioConfig;
  /** Whether this is a built-in default (cannot be deleted/edited) */
  isDefault: boolean;
}

// --- Default Scenarios -------------------------------------------------------

/**
 * The three built-in scenarios. THE ONE DEFINITION — do not write a second copy
 * beside a consumer. `connection-scenario-card.tsx` held an inline duplicate
 * until 2026-08-21 and the two had drifted on `icon` (ids here, ligatures
 * there), which is the whole reason every built-in tile rendered the fallback
 * sparkle. A consumer that needs translated labels overlays `name` and
 * `description` on top of these records via `t()` at render time — see that
 * file's `defaultScenarios` memo — rather than restating the objects.
 *
 * `name` / `description` are ENGLISH FALLBACKS, deliberately. This is a
 * module-level constant, so it cannot call `t()`; any surface that shows these
 * strings to a user must translate them, and any surface that only needs the
 * `id` / `config` / `icon` (e.g. `band-locking.tsx`) may read them as-is.
 */
export const DEFAULT_SCENARIOS: ConnectionScenario[] = [
  {
    id: "balanced",
    name: "Balanced",
    description: "Auto band selection",
    icon: "zap",
    pattern: "balanced",
    config: {
      atModeValue: "AUTO",
      mode: "AUTO",
      optimization: "Balanced",
      lte_bands: "",
      nsa_nr_bands: "",
      sa_nr_bands: "",
    },
    isDefault: true,
  },
  {
    id: "gaming",
    name: "Gaming",
    description: "Low latency, SA priority",
    icon: "gamepad",
    pattern: "gaming",
    config: {
      atModeValue: "NR5G",
      mode: "NR5G",
      optimization: "Latency",
      lte_bands: "",
      nsa_nr_bands: "",
      sa_nr_bands: "",
    },
    isDefault: true,
  },
  {
    id: "streaming",
    name: "Streaming",
    description: "High bandwidth, stable connection",
    icon: "play",
    pattern: "streaming",
    config: {
      atModeValue: "LTE:NR5G",
      mode: "LTE:NR5G",
      optimization: "Throughput",
      lte_bands: "",
      nsa_nr_bands: "",
      sa_nr_bands: "",
    },
    isDefault: true,
  },
];

// --- API Types ---------------------------------------------------------------

/** Response from GET /cgi-bin/quecmanager/scenarios/active.sh */
export interface ScenarioActiveResponse {
  active_scenario_id: string;
}

/** Response from GET /cgi-bin/quecmanager/scenarios/list.sh */
export interface ScenarioListResponse {
  scenarios: StoredScenario[];
  active_scenario_id: string;
}

/** Stored custom scenario definition (as saved on the backend) */
export interface StoredScenario {
  id: string;
  name: string;
  description: string;
  /** Identity glyph key. Optional: records saved before the icon field existed
   *  have no value here, and resolve to the default glyph. `save.sh` stores the
   *  POST body verbatim, so dropping the old `gradient` key needed no backend
   *  change — pre-existing records simply carry an ignored extra field. */
  icon?: string;
  config: ScenarioConfig;
}

/** Response from POST /cgi-bin/quecmanager/scenarios/activate.sh */
export interface ScenarioActivateResponse {
  success: boolean;
  id?: string;
  error?: string;
  detail?: string;
}

/** Generic success/error response for save/delete */
export interface ScenarioApiResponse {
  success: boolean;
  id?: string;
  error?: string;
  detail?: string;
}

/**
 * POST body for activation.
 * Default scenarios: only `id` is needed (backend knows the config).
 * Custom scenarios: full config is sent in the body.
 */
export interface ScenarioActivateRequest {
  id: string;
  /** AT mode_pref value — required for custom scenarios */
  mode?: string;
  /** Colon-delimited LTE bands — omit to leave unchanged */
  lte_bands?: string;
  /** Colon-delimited NR NSA bands — omit to leave unchanged */
  nsa_nr_bands?: string;
  /** Colon-delimited NR SA bands — omit to leave unchanged */
  sa_nr_bands?: string;
}
