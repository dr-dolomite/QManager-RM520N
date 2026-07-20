"use client";

import React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2Icon,
  MinusCircleIcon,
  TriangleAlertIcon,
  PackageXIcon,
  PlugZapIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ALERT_EVENT_ORDER,
  ALERT_CHANNEL_ORDER,
  type AlertsState,
  type AlertChannel,
  type AlertEventKey,
} from "@/types/alerts";
import {
  CHANNEL_META,
  EVENT_META,
  maskPhone,
  maskEmail,
  maskDiscordId,
} from "./constants";

type Tone = "success" | "warning" | "muted";

const TONE_RING: Record<Tone, string> = {
  success: "bg-success/15 text-success border-success/30",
  warning: "bg-warning/15 text-warning border-warning/30",
  muted: "bg-muted/50 text-muted-foreground border-muted-foreground/25",
};

const TONE_TILE: Record<Tone, string> = {
  success: "border-success/25 bg-success/5",
  warning: "border-warning/25 bg-warning/5",
  muted: "border-border bg-muted/20",
};

const TONE_BADGE: Record<Tone, string> = {
  success: "bg-success/15 text-success border-success/30",
  warning: "bg-warning/15 text-warning border-warning/30",
  muted: "bg-muted/50 text-muted-foreground border-muted-foreground/30",
};

interface Readiness {
  tone: Tone;
  icon: React.ReactNode;
  label: string;
  /** Masked recipient or a short hint about what's missing. */
  detail: string;
  /** True when the detail is a real (masked) contact — render it as machine voice. */
  isContact: boolean;
}

function readinessFor(channel: AlertChannel, state: AlertsState): Readiness {
  if (channel === "sms") {
    const c = state.channels.sms;
    if (!c.enabled)
      return {
        tone: "muted",
        icon: <MinusCircleIcon className="size-3" />,
        label: "Off",
        detail: "This channel is turned off.",
        isContact: false,
      };
    if (!c.configured)
      return {
        tone: "warning",
        icon: <TriangleAlertIcon className="size-3" />,
        label: "Needs setup",
        detail: "Add a recipient phone number to arm this channel.",
        isContact: false,
      };
    return {
      tone: "success",
      icon: <CheckCircle2Icon className="size-3" />,
      label: "Ready",
      detail: maskPhone(c.recipient_phone),
      isContact: true,
    };
  }

  if (channel === "email") {
    const c = state.channels.email;
    if (!c.enabled)
      return {
        tone: "muted",
        icon: <MinusCircleIcon className="size-3" />,
        label: "Off",
        detail: "This channel is turned off.",
        isContact: false,
      };
    if (!c.msmtp_installed)
      return {
        tone: "warning",
        icon: <PackageXIcon className="size-3" />,
        label: "Mailer not installed",
        detail: "Install the msmtp mailer to send email alerts.",
        isContact: false,
      };
    if (!c.configured)
      return {
        tone: "warning",
        icon: <TriangleAlertIcon className="size-3" />,
        label: "Needs setup",
        detail: "Finish the email fields to arm this channel.",
        isContact: false,
      };
    return {
      tone: "success",
      icon: <CheckCircle2Icon className="size-3" />,
      label: "Ready",
      detail: maskEmail(c.recipient_email),
      isContact: true,
    };
  }

  // discord
  const c = state.channels.discord;
  if (!c.enabled)
    return {
      tone: "muted",
      icon: <MinusCircleIcon className="size-3" />,
      label: "Off",
      detail: "This channel is turned off.",
      isContact: false,
    };
  if (!c.configured)
    return {
      tone: "warning",
      icon: <TriangleAlertIcon className="size-3" />,
      label: "Needs setup",
      detail: "Add your Discord ID and bot token to arm this channel.",
      isContact: false,
    };
  if (!c.connected)
    return {
      tone: "warning",
      icon: <PlugZapIcon className="size-3" />,
      label: "Not connected",
      detail: "The bot isn't reachable — check the bot token.",
      isContact: false,
    };
  return {
    tone: "success",
    icon: <CheckCircle2Icon className="size-3" />,
    label: "Ready",
    detail: maskDiscordId(c.owner_discord_id),
    isContact: true,
  };
}

export function AlertsStatusCard({ state }: { state: AlertsState }) {
  // What actually fires per event, from SAVED truth: routed ∩ capable ∩ enabled.
  const firesFor = (event: AlertEventKey): AlertChannel[] =>
    ALERT_CHANNEL_ORDER.filter(
      (ch) =>
        (state.capabilities[event]?.[ch] ?? false) &&
        (state.routing.events[event]?.[ch] ?? false) &&
        state.channels[ch].enabled,
    );

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Alert channels</CardTitle>
        <CardDescription>
          Where QManager will reach you when the connection changes.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        {/* Channel readiness tiles */}
        <div className="grid gap-3 @md/card:grid-cols-2 @2xl/card:grid-cols-3">
          {ALERT_CHANNEL_ORDER.map((ch) => {
            const r = readinessFor(ch, state);
            const Icon = CHANNEL_META[ch].icon;
            return (
              <div
                key={ch}
                className={cn(
                  "flex items-center gap-3 rounded-xl border p-3.5",
                  TONE_TILE[r.tone],
                )}
              >
                <span
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-full border",
                    TONE_RING[r.tone],
                  )}
                  aria-hidden
                >
                  <Icon className="size-5" />
                </span>
                <div className="grid min-w-0 gap-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">
                      {CHANNEL_META[ch].name}
                    </span>
                    <Badge
                      variant="outline"
                      className={cn("gap-1", TONE_BADGE[r.tone])}
                    >
                      {r.icon}
                      {r.label}
                    </Badge>
                  </div>
                  <span
                    className={cn(
                      "text-muted-foreground truncate text-xs",
                      r.isContact && "font-mono",
                    )}
                  >
                    {r.detail}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Routing summary — what fires where, from saved state. */}
        <div className="border-t pt-5">
          <span className="text-muted-foreground text-xs font-medium">
            What fires where
          </span>
          <dl className="mt-3 grid gap-3">
            {ALERT_EVENT_ORDER.map((ev) => {
              const fires = firesFor(ev);
              const EventIcon = EVENT_META[ev].icon;
              return (
                <div
                  key={ev}
                  className="flex items-center justify-between gap-3"
                >
                  <dt className="text-muted-foreground flex min-w-0 items-center gap-2 text-sm">
                    <EventIcon className="size-4 shrink-0" aria-hidden />
                    <span className="truncate">{EVENT_META[ev].name}</span>
                  </dt>
                  <dd className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                    {fires.length === 0 ? (
                      <span className="text-muted-foreground/70 text-xs">
                        Not alerting
                      </span>
                    ) : (
                      fires.map((ch) => {
                        const Icon = CHANNEL_META[ch].icon;
                        return (
                          <Badge
                            key={ch}
                            variant="outline"
                            className="border-primary/30 bg-primary/10 text-primary gap-1"
                          >
                            <Icon className="size-3" />
                            {CHANNEL_META[ch].short}
                          </Badge>
                        );
                      })
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      </CardContent>
    </Card>
  );
}
