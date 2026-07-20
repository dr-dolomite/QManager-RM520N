"use client";

import { MinusCircleIcon } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  ALERT_EVENT_ORDER,
  ALERT_CHANNEL_ORDER,
  type AlertCapabilities,
  type AlertCapabilityCell,
  type AlertChannel,
} from "@/types/alerts";
import { EVENT_META, CHANNEL_META, reasonText } from "./constants";
import { InfoTip } from "./info-tip";
import type { AlertsForm } from "./use-alerts-form";

// -----------------------------------------------------------------------------
// AlertRoutingGrid — the trigger × channel matrix.
// Rows are events, columns are channels (SMS / Email / Discord). A capable cell
// is a Switch; an INCAPABLE cell (e.g. email or Discord during an outage) is
// never a dead toggle — it renders an explained "Unavailable" chip so color is
// always paired with an icon + text (WCAG 2.2). Capability is read from the
// backend, never hard-coded.
// -----------------------------------------------------------------------------
export function AlertRoutingGrid({
  form,
  capabilities,
}: {
  form: AlertsForm;
  capabilities: AlertCapabilities;
}) {
  const channelEnabled: Record<AlertChannel, boolean> = {
    sms: form.smsEnabled,
    email: form.emailEnabled,
    discord: form.discordEnabled,
  };

  const anyChannelOff = ALERT_CHANNEL_ORDER.some((ch) => !channelEnabled[ch]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0">
        <caption className="sr-only">Alert routing by event and channel</caption>
        <thead>
          <tr>
            <th scope="col" className="w-full p-0" />
            {ALERT_CHANNEL_ORDER.map((ch) => {
              const Icon = CHANNEL_META[ch].icon;
              return (
                <th
                  key={ch}
                  scope="col"
                  className="text-muted-foreground w-20 px-1 pb-3 text-center align-bottom text-xs font-medium"
                >
                  <span className="inline-flex flex-col items-center gap-1">
                    <Icon className="size-4" aria-hidden />
                    {CHANNEL_META[ch].short}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {ALERT_EVENT_ORDER.map((ev, rowIdx) => {
            const EventIcon = EVENT_META[ev].icon;
            const isLast = rowIdx === ALERT_EVENT_ORDER.length - 1;
            return (
              <tr key={ev} className="group">
                <th
                  scope="row"
                  className={cn(
                    "py-3.5 pr-3 text-left align-middle font-normal",
                    !isLast && "border-b",
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    <span
                      className="text-muted-foreground mt-0.5 flex size-5 shrink-0 items-center justify-center"
                      aria-hidden
                    >
                      <EventIcon className="size-4" />
                    </span>
                    <span className="grid min-w-0 gap-0.5">
                      <span className="text-sm font-medium">
                        {EVENT_META[ev].name}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {EVENT_META[ev].desc}
                      </span>
                    </span>
                  </div>
                </th>

                {ALERT_CHANNEL_ORDER.map((ch) => {
                  const cell = capabilities[ev]?.[ch] ?? false;
                  const reasonKey = capabilities[ev]?.[
                    `${ch}_reason` as keyof AlertCapabilityCell
                  ] as string | undefined;
                  const masterOff = !channelEnabled[ch];
                  return (
                    <td
                      key={ch}
                      className={cn(
                        "px-1 py-3.5 text-center align-middle",
                        !isLast && "border-b",
                      )}
                    >
                      {cell ? (
                        <span className="inline-flex items-center justify-center">
                          <Switch
                            checked={form.getRoute(ev, ch)}
                            onCheckedChange={(v) => form.setRoute(ev, ch, v)}
                            disabled={masterOff}
                            aria-label={`Send ${EVENT_META[ev].name} alerts via ${CHANNEL_META[ch].name}`}
                          />
                        </span>
                      ) : (
                        <span className="inline-flex items-center justify-center gap-1">
                          <span className="text-muted-foreground/70 inline-flex items-center gap-1 text-xs">
                            <MinusCircleIcon className="size-3.5" aria-hidden />
                            <span className="hidden @xs/card:inline">
                              Unavailable
                            </span>
                          </span>
                          <InfoTip
                            text={reasonText(reasonKey)}
                            aria={`Why ${CHANNEL_META[ch].name} can't send ${EVENT_META[ev].name}`}
                          />
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>

      {anyChannelOff && (
        <p className="text-muted-foreground mt-3 text-xs">
          Turn a channel on in its tab to route events to it.
        </p>
      )}
    </div>
  );
}
