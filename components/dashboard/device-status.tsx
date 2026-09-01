"use client";

import React, { useState } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { cn } from "@/lib/utils";
import { TickingValue } from "@/components/ui/ticking-value";
import { TickGroup } from "@/components/ui/tick-group";
import { staggerRows, staggerRowItem } from "@/lib/motion";

import { formatUptime, type DeviceStatus } from "@/types/modem-status";
import packageJson from "@/package.json";

import {
  ABSENT,
  CARD_DESC,
  CARD_TITLE,
  DISC_MUTED,
  DISC_SUCCESS,
  ROW,
  SIDE_SHELL,
  TILE,
} from "./shapes";

const MASK = "••••••••••••";

/** The disc glyph is half its 52px disc, matching every other tile in the product. */
const DISC_GLYPH_SIZE = 26;

interface DeviceStatusComponentProps {
  data: DeviceStatus | null;
  isLoading: boolean;
  /**
   * Whether the last poll actually reached the modem.
   *
   * The card cannot derive this from `data`: the status hook deliberately keeps
   * the previous snapshot on a failed fetch rather than clearing it, so a card
   * reading only `data` sees a full, plausible payload during an outage and has
   * no way to know it is looking at a photograph.
   */
  modemReachable: boolean;
  lanGateway?: string;
}

/**
 * The card heading, shared by the loading branch and the loaded one.
 *
 * Both lines are constants, so neither was ever unknown and neither is
 * skeletoned. The two branches read one definition because a title that
 * disagrees with itself across the handoff is the classic skeleton defect and
 * nothing renders both at once to reveal it.
 */
function DeviceCardHeader({ action }: { action?: React.ReactNode }) {
  const { t } = useTranslation("dashboard");
  return (
    <CardHeader>
      <CardTitle className={CARD_TITLE}>{t("device_status.title")}</CardTitle>
      <CardDescription className={CARD_DESC}>
        {t("device_status.description")}
      </CardDescription>
      {action ? <CardAction>{action}</CardAction> : null}
    </CardHeader>
  );
}

/**
 * One uptime tile: a 52px glyph disc beside an eyebrow → value → caption column.
 *
 * THE COLOUR LIVES ON THE DISC, NEVER ON THE BODY. Shipped, the connection tile
 * was a `success-container` slab with no mark at all, sitting beside an
 * identically shaped neutral one — colour as the sole channel, in the pairing
 * where that fails hardest. Two tiles of the same size and shape, adjacent,
 * offer a reader who cannot resolve the two fills nothing else to read.
 *
 * So the fill concentrates into the disc and the disc carries a glyph, and the
 * caption underneath says the same thing a third time in words. Three channels,
 * none of which is load-bearing alone.
 */
function UptimeTile({
  mark,
  disc,
  eyebrow,
  value,
  caption,
}: {
  mark: React.ReactNode;
  disc: string;
  eyebrow: string;
  value: string;
  caption: string;
}) {
  return (
    <div className={cn(TILE.ROOT, "bg-surface-container")}>
      <span
        className={cn(
          TILE.DISC,
          disc,
          "transition-colors duration-(--duration-standard) ease-standard",
        )}
      >
        {mark}
      </span>
      <div className={TILE.TEXT}>
        <span className={TILE.EYEBROW}>{eyebrow}</span>
        {/* The tick keys on the RENDERED string. An uptime that ticks past a
            minute boundary formats to a new string and dips; one that moves by
            four seconds inside the same minute does not, and announcing a
            change the user cannot see is worse than staying still. */}
        {/* `truncate` at the CALL SITE, not in the shape — the sibling tile
            strips do the same, because whether a value may be cut is a
            property of the value, not of the box. `formatUptime` is unbounded
            ("365d 23h 59m" on a modem that has been up a year), and measured
            at the 2-across step that wraps to two 24px lines against 72px of
            content inside a PINNED 104px tile — i.e. it clips. An ellipsis
            after the hours is strictly better than a silently cut second
            line, and the minute of a year-long uptime is not the reading. */}
        <TickingValue className={cn(TILE.VALUE, "truncate")} value={value}>
          {value}
        </TickingValue>
        <span className={TILE.CAPTION}>{caption}</span>
      </div>
    </div>
  );
}

const DeviceStatusComponent = ({
  data,
  isLoading,
  modemReachable,
  lanGateway,
}: DeviceStatusComponentProps) => {
  const { t } = useTranslation("dashboard");
  const [hidePrivate, setHidePrivate] = useState(false);

  // Same spelling as network-status.tsx, so the two cards in this band cannot
  // disagree about what "unreachable" means.
  const unreachable = !modemReachable;

  // AN IDENTIFIER DOES NOT GO STALE, and that is why these nine rows take their
  // value with no reachability gate on them at all.
  //
  // A firmware version read four seconds ago is still this modem's firmware
  // version when the next poll fails. So is its IMEI, its ICCID, and the
  // QManager build serving the page — which is not even device data. Blanking
  // them during an outage would throw away nine facts that are still true in
  // order to report one thing we do not know, and the thing we do not know is
  // reported below, where it actually applies.
  const rows = [
    { label: t("device_status.manufacturer"), value: data?.manufacturer || ABSENT },
    {
      label: t("device_status.firmware_version"),
      value: data?.firmware || ABSENT,
      mono: true,
    },
    { label: t("device_status.build_date"), value: data?.build_date || ABSENT },
    {
      label: t("device_status.phone_number"),
      value: data?.phone_number || ABSENT,
      mono: true,
      private: true,
    },
    {
      label: t("device_status.imsi"),
      value: data?.imsi || ABSENT,
      mono: true,
      private: true,
    },
    {
      label: t("device_status.iccid"),
      value: data?.iccid || ABSENT,
      mono: true,
      private: true,
    },
    {
      label: t("device_status.device_imei"),
      value: data?.imei || ABSENT,
      mono: true,
      private: true,
    },
    { label: t("device_status.lan_gateway"), value: lanGateway || ABSENT, mono: true },
    {
      label: t("device_status.qmanager_version"),
      value: packageJson.version,
      mono: true,
    },
  ];

  // THE TWO UPTIMES ARE THE OPPOSITE CASE. They measure a clock that is still
  // running while we cannot see it, so the number we hold goes wrong at one
  // second per second the moment the poll fails. Those go to the sentinel.
  const connUptime = data?.conn_uptime_seconds ?? 0;
  const deviceUptime = data?.uptime_seconds ?? 0;
  const connUp = !unreachable && connUptime > 0;


  return (
    <Card className={SIDE_SHELL}>
      <DeviceCardHeader
        action={
          isLoading ? undefined : (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setHidePrivate((prev) => !prev)}
              aria-pressed={hidePrivate}
              className="size-9 rounded-pill bg-surface-container text-on-surface-variant transition-colors duration-(--duration-quick) ease-quick hover:bg-surface-container-high"
              aria-label={
                hidePrivate
                  ? t("device_status.show_private")
                  : t("device_status.hide_private")
              }
            >
              {hidePrivate ? (
                <MaterialSymbol name="visibility_off" size={20} />
              ) : (
                <MaterialSymbol name="visibility" size={20} />
              )}
            </Button>
          )
        }
      />

      <CardContent className="flex flex-1 flex-col gap-4">
        {/* Hero: the module itself. Deliberately still — the One-Loop Rule
            reserves ambient motion for surfaces where something is genuinely
            live, and a photo of a modem is not.

            THE SLAB IS NEUTRAL (Call C). A `primary-container` disc 188px
            across was the largest single area of role colour on the route, and
            what it encoded was "a picture goes here". The Data-Ink Rule spends
            colour on things that report; this reports nothing, so the hue goes
            back to the cards that are measuring something.

            IT IS STILL 188px. Shrinking it was considered and rejected on
            measurement: this card is `h-full`-locked to a left column carrying
            the hero PLUS the carrier pair, so it has slack, and the mark is
            part of what fills it. */}
        <div className="flex justify-center pt-1.5 pb-2.5">
          {isLoading ? (
            <Skeleton className="aspect-square w-[188px] max-w-full rounded-pill" />
          ) : (
            <div className="grid aspect-square w-[188px] max-w-full place-items-center rounded-pill bg-surface-container p-[18px]">
              <img
                src="/device-icon.svg"
                alt={t("device_status.icon_alt")}
                className="size-full object-contain drop-shadow-[0_4px_6px_oklch(0.15_0.03_262_/_0.35)] dark:drop-shadow-[0_4px_8px_oklch(0.05_0.02_262_/_0.6)]"
              />
            </div>
          )}
        </div>

        {isLoading ? (
          <>
            <dl className="flex flex-col gap-1.5">
              {rows.map((row) => (
                <Skeleton
                  key={row.label}
                  className={cn(ROW.HEIGHT, "rounded-pill")}
                />
              ))}
            </dl>
            <div className={cn(TILE.PAIR, "mt-auto pt-2")}>
              <Skeleton className={cn(TILE.HEIGHT, "rounded-tile")} />
              <Skeleton className={cn(TILE.HEIGHT, "rounded-tile")} />
            </div>
          </>
        ) : (
          /* One tick cascade spanning both halves of the card, so a poll reads
             as a single top-to-bottom sweep: the identity rows, then the two
             uptime tiles side by side at the floor, which read left-to-right.
             The group covers eleven figures, past the ~8-item cascade ceiling,
             and that is fine here precisely because rank is assigned over the
             values that MOVED rather than over every value present. The nine
             identity rows (manufacturer, firmware, IMEI, ICCID…) change
             approximately never, so they do not enter the ranking and the two
             live tiles land at ranks 0 and 1. Ordinal indexing would instead
             have spent nine silent slots and dipped at 540ms and 600ms — not a
             cascade, just unexplained latency. */
          <TickGroup>
            {/* `staggerRows`, not `staggerContainer`. These are nine rows sharing
                one card's border, which the eye groups as a single object, so they
                take the 40ms row step: 9 x 40ms lands the last row at 360ms. On the
                60ms card step this card ran 540ms — long enough past the ~2s poll's
                first paint that the tail read as the card still loading rather than
                as choreography, which is precisely the pre-migration feel. Paired
                with `staggerRowItem`'s 5px rise for the same reason: at the 6px row
                gap, the card variant's 10px lift carried each row past its
                neighbour's resting position and the group read as a reflow. */}
            <motion.dl
              className="flex flex-col gap-1.5"
              // Variants only, no initial/animate: this cascade INHERITS the
              // page-wide clock in home-component.tsx. Declaring its own would
              // detach it and start a second clock, which is the defect the
              // single-cascade step retired.
              variants={staggerRows}
            >
              {rows.map((row) => {
                const masked = hidePrivate && row.private;
                const display = masked ? MASK : row.value;
                return (
                  <motion.div
                    key={row.label}
                    variants={staggerRowItem}
                    className={ROW.ROOT}
                  >
                    <dt className={cn(ROW.KEY, "text-on-surface-variant")}>
                      {row.label}
                    </dt>
                    {/* The mask swap rides the same 180ms tick as a live value —
                        the label changes, the row does not move.
                        `shrink-0`: when the pill runs out of room on a phone the
                        label wraps and the row grows taller. The value is what the
                        user opened this card to read, so it is never the thing
                        that gets clipped — a half-printed IMEI is worse than a
                        two-line label. */}
                    {/* The tick keys on the RENDERED string, not on a raw datum.
                        `TickingValue`'s guidance prefers the raw value so a
                        re-render of an unchanged number stays silent — an equal
                        string satisfies that identically (`Object.is` on two equal
                        strings is true), and it additionally suppresses the
                        inverse case, where a raw value moves but formats to the
                        same text and the dip would announce a change the user
                        cannot see. Here it is also the only correct key: masking
                        swaps the text without the underlying datum moving at all. */}
                    <dd
                      className={cn(
                        ROW.VALUE,
                        "shrink-0 text-right",
                        row.mono && "font-mono",
                      )}
                    >
                      <TickingValue value={display}>{display}</TickingValue>
                    </dd>
                  </motion.div>
                );
              })}
            </motion.dl>

            {/* Uptime tiles. `mt-auto` pins them to the floor of the stretched
                panel so the card never ends in dead space.

                They go 2-across only once the CARD has room for two full text
                columns beside two 52px discs — `@md/card`, measured, not
                guessed. Below that they stack: a 22px uptime figure truncating
                to "1d 4h…" in a squeezed column would give back exactly the
                legibility the pinned tile was adopted for. */}
            <div className={cn(TILE.PAIR, "mt-auto pt-2")}>
              {/* THE LIGATURE NAMES ARE WRITTEN AS LITERALS, and the mark is
                  rendered here rather than named and passed down, because two
                  tools read this file by grep and neither can follow a
                  variable. `icons:check` scans for literal call sites to tell
                  a live glyph from dead weight in the subset, and the design
                  harness checks that every ligature this card asks for is
                  actually IN that subset. A glyph we do not ship renders as
                  its own name in 13px semibold on a modem in the field — no
                  typecheck catches it, and no screenshot of a dev machine
                  reproduces it, because the dev machine has the full font.

                  `cloud_off` rather than `link_off` for the unreachable case,
                  on BOTH tiles. A link that is down and a link we cannot ask
                  about are different facts, and `link_off` asserts the first
                  one. During an outage we know only that we lost contact. */}
              <UptimeTile
                mark={
                  unreachable ? (
                    <MaterialSymbol name="cloud_off" size={DISC_GLYPH_SIZE} />
                  ) : connUp ? (
                    <MaterialSymbol name="link" size={DISC_GLYPH_SIZE} />
                  ) : (
                    <MaterialSymbol name="link_off" size={DISC_GLYPH_SIZE} />
                  )
                }
                disc={connUp ? DISC_SUCCESS : DISC_MUTED}
                eyebrow={t("device_status.conn_uptime_short")}
                value={connUp ? formatUptime(connUptime) : ABSENT}
                caption={
                  unreachable
                    ? t("device_status.uptime_unknown")
                    : connUp
                      ? t("device_status.conn_uptime_caption_up")
                      : t("device_status.conn_uptime_caption_down")
                }
              />
              <UptimeTile
                mark={
                  unreachable ? (
                    <MaterialSymbol name="cloud_off" size={DISC_GLYPH_SIZE} />
                  ) : (
                    <MaterialSymbol name="schedule" size={DISC_GLYPH_SIZE} />
                  )
                }
                disc={DISC_MUTED}
                eyebrow={t("device_status.device_uptime_short")}
                value={
                  !unreachable && deviceUptime > 0
                    ? formatUptime(deviceUptime)
                    : ABSENT
                }
                caption={
                  unreachable
                    ? t("device_status.uptime_unknown")
                    : t("device_status.device_uptime_caption")
                }
              />
            </div>
          </TickGroup>
        )}
      </CardContent>
    </Card>
  );
};

export default DeviceStatusComponent;
