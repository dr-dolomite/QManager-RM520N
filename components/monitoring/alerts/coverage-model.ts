"use client";

import { useMemo } from "react";
import {
  ALERT_CHANNEL_ORDER,
  ALERT_EVENT_ORDER,
  type AlertChannel,
  type AlertEventKey,
  type AlertRouting,
  type AlertsState,
} from "@/types/alerts";
import { deriveCoverage, type AlertsCoverage, type CoverageInput } from "./derive";
import type { AlertsForm } from "./use-alerts-form";

// The ONE place the draft/confirmed split lives. The band reads `saved`, the
// matrix reads `draft`; a cell differing between the two is what `pending` is.

/** The device's last confirmed answer. Never touched by the form. */
export function confirmedInput(state: AlertsState): CoverageInput {
  return {
    channels: state.channels,
    routing: state.routing.events,
    capabilities: state.capabilities,
  };
}

/** The slice of the form the draft actually depends on. */
export interface DraftSlice {
  getRoute: (event: AlertEventKey, channel: AlertChannel) => boolean;
  smsEnabled: boolean;
  emailEnabled: boolean;
  discordEnabled: boolean;
}

/**
 * The user's working answer: draft ticks and draft master switches over server
 * truth. `configured` stays server-side — it depends on stored secrets, which
 * the client never holds.
 */
export function draftInput(
  state: AlertsState,
  slice: DraftSlice,
): CoverageInput {
  const routing = {} as AlertRouting["events"];
  for (const event of ALERT_EVENT_ORDER) {
    routing[event] = {} as Record<AlertChannel, boolean>;
    for (const channel of ALERT_CHANNEL_ORDER) {
      routing[event][channel] = slice.getRoute(event, channel);
    }
  }

  return {
    channels: {
      sms: { ...state.channels.sms, enabled: slice.smsEnabled },
      email: { ...state.channels.email, enabled: slice.emailEnabled },
      discord: { ...state.channels.discord, enabled: slice.discordEnabled },
    },
    routing,
    capabilities: state.capabilities,
  };
}

export interface CoverageModel {
  /** Saved truth. What the device will do right now. */
  saved: AlertsCoverage;
  /** Draft truth, with every cell that moved marked pending. */
  draft: AlertsCoverage;
}

export function useCoverageModel(
  state: AlertsState,
  form: AlertsForm,
): CoverageModel {
  // Depend on the form's VALUES: the hook returns a fresh literal every render,
  // so `[form]` would rebuild the whole model on every keystroke elsewhere.
  const { getRoute, smsEnabled, emailEnabled, discordEnabled } = form;

  const confirmed = useMemo(() => confirmedInput(state), [state]);
  const draft = useMemo(
    () =>
      draftInput(state, { getRoute, smsEnabled, emailEnabled, discordEnabled }),
    [state, getRoute, smsEnabled, emailEnabled, discordEnabled],
  );

  return useMemo(
    () => ({
      saved: deriveCoverage(confirmed),
      draft: deriveCoverage(draft, confirmed),
    }),
    [confirmed, draft],
  );
}

/** True when the device advertised no capable pair at all — a real empty. */
export function coverageIsEmpty(coverage: AlertsCoverage): boolean {
  return ALERT_CHANNEL_ORDER.every(
    (channel) => coverage.channels[channel].capable.length === 0,
  );
}
