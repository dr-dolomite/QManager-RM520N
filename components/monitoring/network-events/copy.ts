"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";

// Network Events — the surface's string contract, keyed under `networkEvents.*`
// in `common`. The English values ride as `defaultValue`s so a missing key never
// renders as its dotted path.

export const NETWORK_EVENTS_EN = {
  "networkEvents.page.title": "Network Events",
  "networkEvents.page.description":
    "Changes to the radio and the connection, newest first.",

  "networkEvents.actions.updates_aria": "Updates",
  "networkEvents.actions.live": "Live",
  "networkEvents.actions.paused": "Paused",
  "networkEvents.actions.refresh": "Refresh",

  "networkEvents.now.title": "Right Now",
  "networkEvents.now.description":
    "What is still standing, and what keeps repeating.",
  "networkEvents.now.ongoing_one": "{{count}} problem ongoing",
  "networkEvents.now.ongoing_other": "{{count}} problems ongoing",
  "networkEvents.now.oldest_started": "The oldest started {{age}}",
  "networkEvents.now.clear": "Nothing ongoing",
  "networkEvents.now.last_problem": "Last problem {{age}}",
  "networkEvents.now.no_problems": "No problems recorded",
  "networkEvents.now.no_events": "No events recorded yet",
  "networkEvents.now.repeating": "Repeating",
  "networkEvents.now.repeat_meta_one": "{{count}} change in {{span}}",
  "networkEvents.now.repeat_meta_other": "{{count}} changes in {{span}}",
  "networkEvents.now.nothing_repeating": "Nothing is repeating.",

  "networkEvents.activity.title": "Activity",
  "networkEvents.activity.window_last_one": "Last {{count}} event, over {{span}}.",
  "networkEvents.activity.window_last_other":
    "Last {{count}} events, over {{span}}.",
  "networkEvents.activity.window_all_one":
    "{{count}} event since the modem started.",
  "networkEvents.activity.window_all_other":
    "All {{count}} events since the modem started.",
  "networkEvents.activity.window_empty": "No events since the modem started.",
  "networkEvents.activity.chart_aria": "Events over time",
  "networkEvents.activity.column_one": "{{from}} to {{to}}: {{count}} event",
  "networkEvents.activity.column_other": "{{from}} to {{to}}: {{count}} events",
  "networkEvents.activity.now": "Now",
  "networkEvents.activity.problems": "Problems",
  "networkEvents.activity.recoveries": "Recoveries",
  "networkEvents.activity.routine": "Routine",

  "networkEvents.span.minutes_one": "{{count}} min",
  "networkEvents.span.minutes_other": "{{count}} min",
  "networkEvents.span.hours_one": "{{count}} hour",
  "networkEvents.span.hours_other": "{{count}} hours",

  "networkEvents.log.title": "Event Log",
  "networkEvents.log.description_loading": "Loading events.",
  "networkEvents.log.description_unreadable":
    "No counts to show while the log cannot be read.",
  "networkEvents.log.description":
    "Repeats are grouped; open one to see each event.",
  "networkEvents.log.scroll_aria": "Events",

  "networkEvents.run.title": "{{label}} kept changing",
  "networkEvents.run.meta_one": "{{count}} event in {{span}}",
  "networkEvents.run.meta_other": "{{count}} events in {{span}}",
  "networkEvents.run.show": "Show {{count}}",
  "networkEvents.run.hide": "Hide",

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
    "The log starts over when the modem restarts. Events appear here as they happen.",
  "networkEvents.empty.filtered_title": "Nothing in this view",
  "networkEvents.empty.filtered_description":
    "No events of this kind are in the log right now.",

  "networkEvents.error.title": "Could not load events",
  "networkEvents.error.description": "{{message}}",
  "networkEvents.error.retry": "Try again",
  "networkEvents.notice.stale":
    "Showing the last events we managed to read. {{message}}",
} as const;

export type NetworkEventsKey = keyof typeof NETWORK_EVENTS_EN;

/** A key that exists as a `_one` / `_other` pair, named without its suffix. */
export type NetworkEventsPluralKey = {
  [K in NetworkEventsKey]: K extends `${infer B}_other` ? B : never;
}[NetworkEventsKey];

/** Translate a `networkEvents.*` key, falling back to its English value. */
export function useEventsCopy() {
  const { t } = useTranslation("common");
  return React.useCallback(
    (key: NetworkEventsKey, vars?: Record<string, unknown>): string =>
      t(key, { defaultValue: NETWORK_EVENTS_EN[key], ...vars }),
    [t],
  );
}

/** Translate a plural pair by `count`, falling back to the English pair. */
export function useEventsPlural() {
  const { t } = useTranslation("common");
  return React.useCallback(
    (
      base: NetworkEventsPluralKey,
      count: number,
      vars?: Record<string, unknown>,
    ): string => {
      const one = NETWORK_EVENTS_EN[`${base}_one` as NetworkEventsKey];
      const other = NETWORK_EVENTS_EN[`${base}_other` as NetworkEventsKey];
      return t(base, {
        count,
        defaultValue: count === 1 ? one : other,
        ...vars,
      });
    },
    [t],
  );
}

/** "16 min" under an hour, else whole hours. */
export function useSpanText() {
  const p = useEventsPlural();
  return React.useCallback(
    (spanSec: number): string =>
      spanSec < 3600
        ? p("networkEvents.span.minutes", Math.max(1, Math.round(spanSec / 60)))
        : p("networkEvents.span.hours", Math.round(spanSec / 3600)),
    [p],
  );
}
