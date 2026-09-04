"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";

// =============================================================================
// Network Events — the surface's string contract.
// =============================================================================
// Every key this surface renders, with its English value, keyed under
// `networkEvents.*` in the `common` namespace. The values ride as i18next
// `defaultValue`s so the page renders real English before the locale files
// carry them, and never a raw key. Adding them to `public/locales/**` later
// changes nothing here.
// =============================================================================

export const NETWORK_EVENTS_EN = {
  "networkEvents.page.title": "Network Events",
  "networkEvents.page.description":
    "Everything the poller noticed about the radio and the link, newest first.",

  "networkEvents.actions.auto_refresh_on": "Auto refresh on",
  "networkEvents.actions.auto_refresh_off": "Auto refresh off",
  "networkEvents.actions.refresh": "Refresh",

  "networkEvents.band.ongoing.eyebrow": "Ongoing",
  "networkEvents.band.ongoing.caption_clear": "Nothing is still standing",
  "networkEvents.band.ongoing.caption_oldest": "Oldest {{label}}, {{age}}",
  "networkEvents.band.last24.eyebrow": "Last 24 h",
  "networkEvents.band.last24.caption": "{{loud}} needed attention",
  "networkEvents.band.retained.eyebrow": "Retained",
  "networkEvents.band.retained.caption": "Oldest {{age}}, device keeps {{cap}}",
  "networkEvents.band.retained.caption_empty": "Device keeps up to {{cap}}",

  "networkEvents.log.title": "Event log",
  "networkEvents.log.description_loading": "Reading the modem's event ring.",
  "networkEvents.log.description_unreadable":
    "No counts to show while the log cannot be read.",
  "networkEvents.log.description":
    "Showing {{shown}} of the {{held}} events served, out of the {{cap}} the modem holds in memory.",

  "networkEvents.filters.all": "All",
  "networkEvents.filters.radio": "Radio",
  "networkEvents.filters.connectivity": "Connectivity",
  "networkEvents.filters.mode": "Mode",

  "networkEvents.sort.label": "Sort by",
  "networkEvents.sort.newest": "Newest first",
  "networkEvents.sort.oldest": "Oldest first",

  "networkEvents.row.ongoing": "Ongoing",
  "networkEvents.day.today": "Today",
  "networkEvents.day.yesterday": "Yesterday",

  "networkEvents.empty.title": "No events yet",
  "networkEvents.empty.description":
    "The log lives in memory and starts over when the modem reboots. Entries appear here as the poller notices them.",
  "networkEvents.empty.filtered_title": "Nothing in this view",
  "networkEvents.empty.filtered_description":
    "No events of this kind are in the log right now. Pick All to see everything the poller recorded.",

  "networkEvents.error.title": "Could not load events",
  "networkEvents.error.description": "{{message}}",
  "networkEvents.error.retry": "Try again",
  "networkEvents.notice.stale":
    "Showing the last events we managed to read. {{message}}",
} as const;

export type NetworkEventsKey = keyof typeof NETWORK_EVENTS_EN;

/** Translate a `networkEvents.*` key, falling back to its English value. */
export function useEventsCopy() {
  const { t } = useTranslation("common");
  return React.useCallback(
    (key: NetworkEventsKey, vars?: Record<string, unknown>): string =>
      t(key, { defaultValue: NETWORK_EVENTS_EN[key], ...vars }),
    [t],
  );
}
