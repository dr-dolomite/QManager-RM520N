"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { networkTypeLabel } from "@/types/modem-status";
import type { ModemStatus } from "@/types/modem-status";

import {
  BADGE_GLYPH_SIZE,
  CARD_PAD,
  CARD_SHELL,
  READOUT_ROW,
  SIM_STATUS_BADGE,
} from "./shapes";

// =============================================================================
// What the modem reports now — read-only, poller-backed
// =============================================================================
// This card is a new DATA DEPENDENCY, not just a new layout. The settings page
// has never consumed the poller snapshot; it read one CGI endpoint and nothing
// else. Everything here comes from `/tmp/qmanager_status.json`.
//
// -----------------------------------------------------------------------------
// THE STATE-HONESTY BURDEN THIS CARD CARRIES
// -----------------------------------------------------------------------------
// Every value here can legitimately be absent, and each absence is rendered as
// an explicit unknown rather than as a plausible-looking default:
//
//   `.sim`          absent on any device OTA-upgraded from an older poller.
//                   Typed optional; falls back to the `unknown` tone, never to
//                   "Ready".
//   `network.type`  now empty when the serving-cell parse fails. It used to be
//                   published as "LTE" regardless, so this row would previously
//                   have asserted LTE on a technology it never identified.
//                   `networkTypeLabel("")` returns "Unknown" and CANNOT return
//                   "LTE" — that is the whole reason the helper exists.
//   `carrier`       empty before first registration.
//
// SERVING TECHNOLOGY IS THE TECHNOLOGY. The comp rendered this row as
// "LTE B3 · -84 dBm" — a band and a signal reading, which are neither the
// serving technology nor this card's job, and which the Radio Information page
// already owns. It reports LTE / 5G NSA / 5G SA / Unknown and nothing else.
//
// NO DOT SEPARATORS anywhere in here. The comp glued facts with `·`; the
// No-Dot-Separator Rule gives them a real gap instead.
//
// THREE MORE ROWS, AND WHY THESE THREE. This card sits beside the settings
// card in the right column and is the one that GROWS to match its height
// (see `CARD_CELL` in `cellular-settings.tsx`) — three extra facts turn that
// growth into more signal instead of dead space, and each was picked because
// it answers a question the settings card raises rather than duplicating a
// page that already owns the number:
//   Radio power  → the modem's OWN read of `AT+CFUN?`, next to the Radio
//                  Power row above it in the settings card. A pending draft
//                  edit and this value can legitimately disagree until saved.
//   Active APN   → which bearer is actually up, not configured — APN
//                  Management owns editing it, this card only reports it.
//   Carrier      → whether the current Network Type / 5G Architecture
//   aggregation    choice is actually bearing more than one carrier right
//                  now, tying back to `mode_pref` / `nr5g_mode` above.
// =============================================================================

export interface ModemReportsCardProps {
  status: ModemStatus | null;
  isLoading: boolean;
}

export function ModemReportsCard({ status, isLoading }: ModemReportsCardProps) {
  const { t } = useTranslation("cellular");
  const K = "core_settings.basic.readout";

  if (isLoading || !status) {
    return (
      <Card className={cn(CARD_SHELL)}>
        <CardHeader className={CARD_PAD}>
          <CardTitle className="text-base">{t(`${K}.title`)}</CardTitle>
        </CardHeader>
        <CardContent
          className={cn(CARD_PAD, "flex flex-1 flex-col justify-center")}
        >
          <div className={READOUT_ROW.LIST}>
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton
                key={index}
                className={cn(READOUT_ROW.HEIGHT, "rounded-pill")}
              />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const unknown = t(`${K}.unknown`);
  const carrier = status.network.carrier?.trim() || unknown;
  const slot = status.network.sim_slot;

  // `.sim` is optional — an older poller simply does not emit it. Absent is
  // "unknown", which is a real state with its own tone and glyph, not an
  // excuse to render nothing.
  const simStatus = status.sim?.status ?? "unknown";
  const simTone = SIM_STATUS_BADGE[simStatus] ?? SIM_STATUS_BADGE.unknown;

  const techLabel = networkTypeLabel(status.network.type);
  const techIsKnown = techLabel !== "Unknown";

  // Radio power reuses the SETTINGS card's own option labels
  // (`core_settings.basic.rows.cfun.options.*`) rather than a second copy of
  // "Normal" / "Radio off" / "Airplane" — one string, one place it can drift.
  // `cfun` is optional (older poller), same absence contract as `.sim`.
  const cfunKey =
    status.network.cfun === 1
      ? "normal"
      : status.network.cfun === 0
        ? "radio_off"
        : status.network.cfun === 4
          ? "airplane"
          : null;
  const radioPowerLabel = cfunKey
    ? t(`core_settings.basic.rows.cfun.options.${cfunKey}`)
    : unknown;

  const apn = status.network.apn?.trim() || null;

  const caCount =
    (status.network.ca_count ?? 0) + (status.network.nr_ca_count ?? 0);
  const caActive =
    (status.network.ca_active || status.network.nr_ca_active) && caCount > 0;

  return (
    <Card className={cn(CARD_SHELL)}>
      <CardHeader className={CARD_PAD}>
        <CardTitle className="text-base">{t(`${K}.title`)}</CardTitle>
      </CardHeader>

      <CardContent
        className={cn(CARD_PAD, "flex flex-1 flex-col justify-center")}
      >
        <div className={READOUT_ROW.LIST}>
          {/* Registered on — a carrier name is human-authored, so it is NOT
              set in mono (The Machine-Voice Rule). */}
          <div className={READOUT_ROW.ROOT}>
            <span className={READOUT_ROW.LABEL}>{t(`${K}.registered_on`)}</span>
            <div className={READOUT_ROW.VALUE_GROUP}>
              <span className={READOUT_ROW.VALUE_TEXT}>{carrier}</span>
            </div>
          </div>

          {/* Active slot — slot identifier plus the SIM's readiness as a
              status chip. Two facts, spaced, never joined by a dot. */}
          <div className={READOUT_ROW.ROOT}>
            <span className={READOUT_ROW.LABEL}>{t(`${K}.active_slot`)}</span>
            <div className={READOUT_ROW.VALUE_GROUP}>
              <span className={READOUT_ROW.VALUE_MONO}>
                {t(`${K}.slot_n`, { slot })}
              </span>
              <Badge variant={simTone.variant}>
                <MaterialSymbol
                  name={simTone.glyph}
                  filled
                  size={BADGE_GLYPH_SIZE}
                />
                {t(`core_settings.basic.sim_status.${simStatus}`)}
              </Badge>
            </div>
          </div>

          {/* Serving technology — the access technology alone. */}
          <div className={READOUT_ROW.ROOT}>
            <span className={READOUT_ROW.LABEL}>{t(`${K}.serving_tech`)}</span>
            <div className={READOUT_ROW.VALUE_GROUP}>
              <span
                className={cn(
                  READOUT_ROW.VALUE_MONO,
                  !techIsKnown && "text-on-surface-variant",
                )}
              >
                {techIsKnown ? techLabel : unknown}
              </span>
            </div>
          </div>

          {/* Radio power — the modem's OWN read-back of AT+CFUN?, not the
              settings card's draft. A human-authored label ("Normal" /
              "Radio off" / "Airplane"), so it is NOT mono. */}
          <div className={READOUT_ROW.ROOT}>
            <span className={READOUT_ROW.LABEL}>
              {t(`${K}.radio_power`)}
            </span>
            <div className={READOUT_ROW.VALUE_GROUP}>
              <span
                className={cn(
                  READOUT_ROW.VALUE_TEXT,
                  !cfunKey && "text-on-surface-variant",
                )}
              >
                {radioPowerLabel}
              </span>
            </div>
          </div>

          {/* Active APN — the bearer actually up, reported by the modem.
              APN Management owns editing it; this row only reports it, so
              it is a machine string (mono) like the other identifiers here. */}
          <div className={READOUT_ROW.ROOT}>
            <span className={READOUT_ROW.LABEL}>{t(`${K}.active_apn`)}</span>
            <div className={READOUT_ROW.VALUE_GROUP}>
              <span
                className={cn(
                  READOUT_ROW.VALUE_MONO,
                  !apn && "text-on-surface-variant",
                )}
              >
                {apn ?? t(`${K}.no_apn`)}
              </span>
            </div>
          </div>

          {/* Carrier aggregation — whether the current Network Type / 5G
              Architecture choice is actually bearing more than one carrier
              right now. Ties back to `mode_pref` / `nr5g_mode` above. */}
          <div className={READOUT_ROW.ROOT}>
            <span className={READOUT_ROW.LABEL}>
              {t(`${K}.carrier_aggregation`)}
            </span>
            <div className={READOUT_ROW.VALUE_GROUP}>
              <span
                className={cn(
                  READOUT_ROW.VALUE_TEXT,
                  !caActive && "text-on-surface-variant",
                )}
              >
                {caActive
                  ? t(`${K}.ca_count`, { count: caCount })
                  : t(`${K}.ca_inactive`)}
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default ModemReportsCard;
