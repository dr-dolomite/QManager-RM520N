// =============================================================================
// material-symbol-names — the canonical Material Symbols ligature list
// =============================================================================
// This array is the SINGLE SOURCE OF TRUTH for which glyphs QManager ships.
// Two consumers read it and must never diverge:
//
//   1. components/ui/material-symbol.tsx derives `MaterialSymbolName` from it,
//      so the compiler rejects a call site asking for a glyph we do not carry.
//   2. scripts-dev/subset-icons.ts passes it to Google Fonts' `icon_names=`
//      parameter to cut app/fonts/MaterialSymbolsRounded-subset.woff2.
//
// It used to be two hand-maintained copies — this union and a parallel `ICONS`
// array in the subset script — with nothing checking that they agreed. A name
// present in only one of them fails silently and asymmetrically: extra in the
// script is dead weight in the font, extra in the union renders the literal
// text "signal_cellular_4_bar" on a modem in the field. Deriving both from one
// array removes that failure mode by construction rather than by review.
//
// The remaining hazard is the .woff2 itself going stale — the list is a text
// edit, regenerating the font is a network round-trip plus a binary commit that
// is easy to skip. `bun run icons:check` closes that gap by comparing the file
// against the manifest the generator writes. Run it after ANY edit here:
//
//   bun run icons:subset && bun run icons:check
//
// KEEP SORTED. `icons:check` enforces it so diffs stay reviewable and two
// people adding a glyph in the same week do not collide at the end of the list.
//
// This module deliberately has NO imports. subset-icons.ts is run by bun from
// scripts-dev/, which tsconfig excludes, so pulling in React or the `@/` path
// alias here would couple font generation to the app's module graph.
// =============================================================================

/**
 * The variable-axis string the subset is cut with, shared so `icons:check` can
 * detect an axis change the glyph list cannot show.
 *
 * FILL must stay a RANGE (`0..1`), never a pinned value. Pinning it collapses
 * the axis, and the sidebar's active row silently stops rendering filled — a
 * failure that survives an identical glyph list and an identical file size.
 */
export const MATERIAL_SYMBOL_AXES = "opsz,wght,FILL,GRAD@20..48,400,0..1,0";

export const MATERIAL_SYMBOL_NAMES = [
  "account_circle",
  "add",
  "airplanemode_active",
  // Active MIMO. `settings_input_antenna` drew a rabbit-ear aerial AND is
  // already worn by both surfaces that tile links to (antenna-statistics,
  // antenna-alignment), so the tile had no mark of its own. `alt_route` draws
  // one path splitting into parallel legs, which is what MIMO physically is.
  "alt_route",
  "arrow_circle_down",
  "arrow_circle_up",
  "arrow_downward",
  "arrow_upward",
  "auto_awesome",
  "badge",
  "block",
  "bolt",
  "call",
  "cancel",
  "cell_tower",
  "check",
  "check_circle",
  "chevron_right",
  "close",
  "cloud_off",
  "content_copy",
  "dark_mode",
  "delete",
  "delete_sweep",
  "dns",
  "do_not_disturb_on",
  "done_all",
  "donut_small",
  "download",
  "drag_indicator",
  "edit",
  "edit_calendar",
  "energy_savings_leaf",
  "error",
  "event_busy",
  "expand_more",
  "explore",
  "favorite",
  "fingerprint",
  "first_page",
  "graphic_eq",
  "help",
  "home",
  "info",
  "layers",
  "light_mode",
  "location_on",
  "lock",
  "lock_clock",
  "lock_open",
  "mark_email_unread",
  "memory",
  "monitor",
  "more_horiz",
  "more_vert",
  "my_location",
  "network_ping",
  "open_in_new",
  "percent",
  "pets",
  "play_arrow",
  "playlist_add",
  "power_settings_new",
  "priority_high",
  "progress_activity",
  "public",
  "radar",
  "refresh",
  "restart_alt",
  "rocket_launch",
  "route",
  "router",
  "schedule",
  "science",
  "search",
  "send",
  "settings",
  "settings_ethernet",
  "settings_input_antenna",
  "shield",
  // The 0-bar member completes the wedge ladder for the fifth quality stop.
  // `bad` cannot borrow `signal_cellular_off` — that is `none`, "we have no
  // reading" — and it cannot share `1_bar` with `poor`, because no two states
  // in one slot may share a glyph (DESIGN.md > The Glyph-Carries-The-State
  // Rule). With adjacent ramp stops deliberately below the colour separation
  // floor, bar count is the only channel that actually separates them.
  "signal_cellular_0_bar",
  "signal_cellular_1_bar",
  "signal_cellular_2_bar",
  "signal_cellular_3_bar",
  "signal_cellular_4_bar",
  "signal_cellular_alt",
  "signal_cellular_alt_1_bar",
  "signal_cellular_alt_2_bar",
  "signal_cellular_off",
  "signal_disconnected",
  "sim_card",
  "sim_card_alert",
  "sms",
  "sos",
  "sports_esports",
  "support",
  "swap_horiz",
  "terminal",
  "timeline",
  "translate",
  "trophy",
  "tune",
  "unfold_more",
  "videocam",
  "visibility",
  "visibility_off",
  "vpn_lock",
  "warning",
  "wifi_off",
  "wifi_tethering_off",
  "work",
] as const;

/**
 * Ligature names present in the build-time subset (app/fonts/…-subset.woff2).
 *
 * Derived from the array above, so adding a glyph is one edit, not two that a
 * reviewer has to diff against each other.
 */
export type MaterialSymbolName = (typeof MATERIAL_SYMBOL_NAMES)[number];
