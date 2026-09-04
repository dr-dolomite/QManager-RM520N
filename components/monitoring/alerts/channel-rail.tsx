"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import type { AlertChannel } from "@/types/alerts";

import { CHANNEL_STATUS_DOT, type ChannelStatus } from "./derive";
import { RAIL, RAIL_DOT_TONE } from "./shapes";

// The channel selector: three pills, each carrying its own state dot. The dot
// is the second channel beside the label, never the only one — the status word
// travels in the accessible name so it survives grayscale and a screen reader.

export interface ChannelRailItem {
  channel: AlertChannel;
  label: string;
  status: ChannelStatus;
  /** "Ready" / "Needs setup" / "Off" — read out, not drawn. */
  statusLabel: string;
}

export interface ChannelRailProps {
  /** Names the tablist for assistive tech. */
  label: string;
  items: ChannelRailItem[];
  value: AlertChannel;
  onValueChange: (channel: AlertChannel) => void;
  /** Ties each tab to its panel: `${idBase}-tab-*` / `${idBase}-panel-*`. */
  idBase: string;
}

export function tabId(idBase: string, channel: AlertChannel) {
  return `${idBase}-tab-${channel}`;
}

export function panelId(idBase: string, channel: AlertChannel) {
  return `${idBase}-panel-${channel}`;
}

export function ChannelRail({
  label,
  items,
  value,
  onValueChange,
  idBase,
}: ChannelRailProps) {
  const refs = React.useRef<Partial<Record<AlertChannel, HTMLButtonElement>>>({});

  // Roving tabindex: one tab stop for the rail, arrows move within it.
  const move = (delta: number) => {
    const i = items.findIndex((it) => it.channel === value);
    const next = items[(i + delta + items.length) % items.length];
    if (!next) return;
    onValueChange(next.channel);
    refs.current[next.channel]?.focus();
  };

  const jump = (item: ChannelRailItem | undefined) => {
    if (!item) return;
    onValueChange(item.channel);
    refs.current[item.channel]?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        move(1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        move(-1);
        break;
      case "Home":
        event.preventDefault();
        jump(items[0]);
        break;
      case "End":
        event.preventDefault();
        jump(items[items.length - 1]);
        break;
    }
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      aria-orientation="horizontal"
      className={RAIL.ROOT}
      onKeyDown={onKeyDown}
    >
      {items.map((item) => {
        const active = item.channel === value;
        return (
          <button
            key={item.channel}
            ref={(el) => {
              if (el) refs.current[item.channel] = el;
            }}
            type="button"
            role="tab"
            id={tabId(idBase, item.channel)}
            aria-controls={panelId(idBase, item.channel)}
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onValueChange(item.channel)}
            className={cn(
              "inline-flex items-center justify-center whitespace-nowrap outline-none",
              "focus-visible:ring-ring/50 focus-visible:ring-[3px]",
              "transition-[background-color,color] duration-[var(--duration-quick)] ease-out motion-reduce:transition-none",
              RAIL.PILL,
              active ? RAIL.PILL_ACTIVE : RAIL.PILL_REST,
            )}
          >
            <span
              aria-hidden
              className={cn(
                RAIL.DOT,
                active
                  ? RAIL.DOT_ON_ACTIVE
                  : RAIL_DOT_TONE[CHANNEL_STATUS_DOT[item.status]],
              )}
            />
            {item.label}
            <span className="sr-only">{item.statusLabel}</span>
          </button>
        );
      })}
    </div>
  );
}
