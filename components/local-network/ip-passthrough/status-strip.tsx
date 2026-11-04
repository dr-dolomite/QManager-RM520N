"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  CircleAlertIcon,
  EthernetPortIcon,
  RefreshCcwIcon,
  RouterIcon,
  TriangleAlertIcon,
  UsbIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type {
  DnsProxy,
  IpptNat,
  PassthroughMode,
  UsbMode,
} from "@/types/ip-passthrough";

import {
  AUTOMATIC_MAC,
  CONDITION,
  DISC_TONE,
  DISC_TRANSITION,
  EYEBROW,
  FIGS,
  HERO_PAD,
  HERO_SHELL,
  PILL_GLYPH,
  SKELETON,
  STATUS,
} from "./shapes";

// The saved configuration, not a measurement: the GET reads our own config file,
// so every word here stays "Last applied" / "Set to", never "currently" or "live".

const K = "ipPassthrough";

/** Protocol names the device round-trips; identical in every locale. */
export const USB_SHORT: Record<UsbMode, string> = {
  "0": "RMNET",
  "1": "ECM",
  "2": "MBIM",
  "3": "RNDIS",
};

const MODE_TITLE_KEY: Record<PassthroughMode, string> = {
  disabled: `${K}.status.mode_title.disabled`,
  eth: `${K}.status.mode_title.eth`,
  usb: `${K}.status.mode_title.usb`,
};

const MODE_BLURB_KEY: Record<PassthroughMode, string> = {
  disabled: `${K}.status.blurb.disabled`,
  eth: `${K}.status.blurb.eth`,
  usb: `${K}.status.blurb.usb`,
};

const MODE_GLYPH = {
  disabled: RouterIcon,
  eth: EthernetPortIcon,
  usb: UsbIcon,
} as const;

function Figure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={FIGS.FIG}>
      <span className={FIGS.KEY}>{label}</span>
      {children}
    </div>
  );
}

export interface StatusStripProps {
  /** `null` until the first successful read. */
  mode: PassthroughMode | null;
  targetMac: string | null;
  ipptNat: IpptNat | null;
  usbMode: UsbMode | null;
  dnsProxy: DnsProxy | null;
  /** True when a read failed and left nothing behind. */
  failed: boolean;
  onRetry: () => void;
}

export function StatusStrip({
  mode,
  targetMac,
  ipptNat,
  usbMode,
  dnsProxy,
  failed,
  onRetry,
}: StatusStripProps) {
  const { t } = useTranslation("common");

  if (mode === null) {
    return failed ? (
      <Card className={HERO_SHELL} role="region" aria-label={t(`${K}.status.label`)}>
        <CardContent className={HERO_PAD}>
          <div role="status" className={CONDITION.ROOT}>
            <span aria-hidden className={CONDITION.DISC}>
              <CircleAlertIcon className={CONDITION.GLYPH} />
            </span>
            <div className={CONDITION.TEXT}>
              <p className={CONDITION.TITLE}>{t(`${K}.errors.read_title`)}</p>
              <p className={CONDITION.BODY}>{t(`${K}.errors.read_body`)}</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              onClick={onRetry}
              className={CONDITION.ACTION}
            >
              <RefreshCcwIcon className={PILL_GLYPH} aria-hidden />
              {t(`${K}.errors.retry`)}
            </Button>
          </div>
        </CardContent>
      </Card>
    ) : (
      <StatusStripSkeleton />
    );
  }

  const passing = mode !== "disabled";
  const Glyph = MODE_GLYPH[mode];
  const mac = (targetMac ?? "").toUpperCase();
  const automatic = mac === "" || mac === AUTOMATIC_MAC;

  return (
    <Card className={HERO_SHELL} role="region" aria-label={t(`${K}.status.label`)}>
      <CardContent className={cn(HERO_PAD, STATUS.BODY)}>
        <div className={STATUS.PHASE}>
          <span
            aria-hidden
            className={cn(
              STATUS.DISC,
              DISC_TRANSITION,
              passing ? DISC_TONE.info : DISC_TONE.neutral,
            )}
          >
            <Glyph className={STATUS.GLYPH} />
          </span>
          <div className={STATUS.TEXT}>
            <span className={EYEBROW}>{t(`${K}.status.label`)}</span>
            <p className={STATUS.TITLE}>{t(MODE_TITLE_KEY[mode])}</p>
            <p className={STATUS.BLURB}>{t(MODE_BLURB_KEY[mode])}</p>
          </div>
        </div>

        <div className={FIGS.ROOT}>
          <Figure label={t(`${K}.rows.target.label`)}>
            {!passing ? (
              <span className={cn(FIGS.VALUE, FIGS.QUIET)}>
                {t(`${K}.status.no_target`)}
              </span>
            ) : automatic ? (
              <span className={FIGS.VALUE}>{t(`${K}.options.target_automatic`)}</span>
            ) : (
              <span className={cn(FIGS.VALUE, FIGS.MONO)}>{mac}</span>
            )}
          </Figure>
          <Figure label={t(`${K}.rows.nat.label`)}>
            <span className={FIGS.VALUE}>
              {t(ipptNat === "1" ? `${K}.options.nat_on` : `${K}.options.nat_off`)}
            </span>
          </Figure>
          <Figure label={t(`${K}.rows.usb.label`)}>
            <span className={FIGS.VALUE}>{usbMode ? USB_SHORT[usbMode] : ""}</span>
          </Figure>
          <Figure label={t(`${K}.rows.dns.label`)}>
            <span className={FIGS.VALUE}>
              {t(dnsProxy === "enabled" ? `${K}.options.dns_on` : `${K}.options.dns_off`)}
            </span>
          </Figure>
          <Figure label={t(`${K}.status.gateway`)}>
            {passing ? (
              <span className={FIGS.VALUE}>
                {t(`${K}.status.gateway_not_served`)}
                <TriangleAlertIcon className={FIGS.ALERT} aria-hidden />
              </span>
            ) : (
              <span className={FIGS.VALUE}>{t(`${K}.status.gateway_served`)}</span>
            )}
          </Figure>
        </div>
      </CardContent>
    </Card>
  );
}

/** Mirrors the strip from the same constants. */
export function StatusStripSkeleton() {
  return (
    <Card className={HERO_SHELL} aria-hidden>
      <CardContent className={cn(HERO_PAD, STATUS.BODY)}>
        <div className={STATUS.PHASE}>
          <Skeleton className={STATUS.DISC} />
          <div className={cn(STATUS.TEXT, "flex-1")}>
            <Skeleton className={SKELETON.EYEBROW} />
            <Skeleton className={SKELETON.TITLE} />
            <Skeleton className={SKELETON.BLURB} />
          </div>
        </div>
        <div className={FIGS.ROOT}>
          {Array.from({ length: FIGS.COUNT }, (_, i) => (
            <div key={i} className={FIGS.FIG}>
              <Skeleton className={SKELETON.FIG_KEY} />
              <Skeleton className={SKELETON.FIG_VALUE} />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default StatusStrip;
