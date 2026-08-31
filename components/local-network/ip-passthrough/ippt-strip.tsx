"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeftRightIcon,
  CircleAlertIcon,
  EthernetPortIcon,
  GlobeIcon,
  MonitorSmartphoneIcon,
  RefreshCcwIcon,
  RouterIcon,
  UsbIcon,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { DnsProxy, IpptNat, PassthroughMode } from "@/types/ip-passthrough";

import {
  DISC_TONE,
  DISC_TRANSITION,
  FIELD_GLYPH,
  NOTICE_ACTION,
  NOTICE_SPAN,
  NOTICE_TITLE,
  TILE,
} from "./shapes";

// =============================================================================
// IpptStrip — the tile grid of Band A on /local-network/ip-passthrough
// =============================================================================
// Four tiles under the band header: mode, target device, NAT and DNS proxy.
// The page had NO state display at all before this — it opened directly on five
// dropdowns, so the first question a technician asks ("what is this modem set to
// right now?") could only be answered by reading the controls that change it.
//
// -----------------------------------------------------------------------------
// THIS BAND IS "LAST APPLIED", AND EVERY WORD ON IT IS WRITTEN THAT WAY
// -----------------------------------------------------------------------------
// `ip_passthrough.sh` (GET) reads `/etc/qmanager/ippt_config.json` first — a
// file written by our own POST — and falls back to poller fields captured once
// at boot. No AT command is issued on GET. So these four figures report what
// QManager last APPLIED, not what the modem is doing at this instant, and the
// band says so: its label is "Last applied", its captions are "Set to…",
// "Pinned by…", "Saved as…", and no caption on this surface may say
// "currently", "live", "on the wire" or "verified".
//
// The alternative was to drop the band entirely. It is kept because a
// last-applied reading correctly captioned is strictly more than nothing, and
// because the ONE thing a user needs before touching this page — am I in router
// mode or passthrough mode — is exactly the thing the config file does know.
//
// The DNS-proxy caption is the sharpest case. The original design had it read
// "Custom DNS is bypassed". That claim is not supportable from this tree:
// `AT+QMAP="DHCPV4DNS"` controls what the modem's DHCP server hands to clients,
// and which polarity of it bypasses dnsmasq is undocumented and unverified
// here. So the caption describes the mechanism it actually knows about and
// stops there, and the tile does not link anywhere.
//
// -----------------------------------------------------------------------------
// COLOUR
// -----------------------------------------------------------------------------
// Every body is `TILE.BODY` and there is no `tone` prop to make an exception.
// ONE disc changes at runtime — the mode tile's — because router-vs-passthrough
// is the only thing here with a functional state. NAT and DNS proxy are saved
// choices and the MAC is an identifier; a colour that never changes encodes
// nothing (The Neutral-Default Rule).
//
// The mode disc also changes its GLYPH with its tone (router / ethernet port /
// USB), so the state is carried non-chromatically as well as by fill.
// =============================================================================

const K = "ipPassthrough";

/** `FF:FF:FF:FF:FF:FF` is the backend's sentinel for "first device to connect". */
export const AUTOMATIC_MAC = "FF:FF:FF:FF:FF:FF";

/**
 * One tile. There is deliberately no body-tone prop: every body on this band is
 * neutral, so a caller cannot tint one back. Making the wrong thing unreachable
 * is cheaper than a comment asking nobody to do it.
 */
function Tile({
  glyph: Glyph,
  disc = DISC_TONE.neutral,
  animate = false,
  eyebrow,
  children,
  caption,
}: {
  glyph: LucideIcon;
  /** The disc's fill pair — the only colour a tile is allowed to carry. */
  disc?: string;
  /**
   * True only for the mode tile, whose disc genuinely changes at runtime. A
   * transition on a disc that never moves is a declaration that never fires.
   */
  animate?: boolean;
  eyebrow: string;
  children: React.ReactNode;
  caption: React.ReactNode;
}) {
  return (
    <div className={cn(TILE.ROOT, TILE.BODY)}>
      <span className={cn(TILE.DISC, animate && DISC_TRANSITION, disc)}>
        <Glyph className={TILE.GLYPH} aria-hidden="true" />
      </span>
      <div className={TILE.TEXT}>
        <span className={TILE.EYEBROW}>{eyebrow}</span>
        <span className={TILE.VALUE}>{children}</span>
        <span className={TILE.CAPTION}>{caption}</span>
      </div>
    </div>
  );
}

/**
 * The band's failure state: one tile spanning the grid, carrying the retry.
 *
 * Four identical "couldn't read" tiles would be one message repeated four
 * times. It is NOT a skeleton: a skeleton is a promise that data is on its way,
 * and holding one over a dead read is the misstatement this re-authoring exists
 * to remove. The retry lives here rather than only in the page header because
 * this is the element that is actually reporting the failure.
 */
function NoticeTile({
  title,
  body,
  actionLabel,
  onRetry,
}: {
  title: string;
  body: string;
  actionLabel: string;
  onRetry: () => void;
}) {
  return (
    <div className={cn(TILE.ROOT, TILE.BODY, NOTICE_SPAN)} role="status">
      <span className={cn(TILE.DISC, DISC_TONE.neutral)}>
        <CircleAlertIcon className={TILE.GLYPH} aria-hidden="true" />
      </span>
      <div className={TILE.TEXT}>
        <span className={NOTICE_TITLE}>{title}</span>
        <span className={TILE.CAPTION}>{body}</span>
      </div>
      <Button
        type="button"
        variant="outline"
        onClick={onRetry}
        className={NOTICE_ACTION}
      >
        <RefreshCcwIcon className={FIELD_GLYPH} aria-hidden="true" />
        {actionLabel}
      </Button>
    </div>
  );
}

export interface IpptStripProps {
  /** `null` until the first successful read. */
  mode: PassthroughMode | null;
  targetMac: string | null;
  ipptNat: IpptNat | null;
  dnsProxy: DnsProxy | null;
  /** True until the first read resolves, either way. */
  isLoading: boolean;
  /** True when a read failed and left nothing behind. */
  failed: boolean;
  onRetry: () => void;
}

export function IpptStrip({
  mode,
  targetMac,
  ipptNat,
  dnsProxy,
  isLoading,
  failed,
  onRetry,
}: IpptStripProps) {
  const { t } = useTranslation("common");

  const ready = mode !== null;

  // The mode tile is the only one that picks a tone, and it picks a glyph with
  // it so the state survives a greyscale print and a deuteranopic reader.
  const modeSpec =
    mode === "eth"
      ? {
          disc: DISC_TONE.primary,
          glyph: EthernetPortIcon,
          value: t(`${K}.tiles.mode.value_eth`),
          caption: t(`${K}.tiles.mode.caption_eth`),
        }
      : mode === "usb"
        ? {
            disc: DISC_TONE.primary,
            glyph: UsbIcon,
            value: t(`${K}.tiles.mode.value_usb`),
            caption: t(`${K}.tiles.mode.caption_usb`),
          }
        : {
            disc: DISC_TONE.neutral,
            glyph: RouterIcon,
            value: t(`${K}.tiles.mode.value_disabled`),
            caption: t(`${K}.tiles.mode.caption_disabled`),
          };

  // A MAC is only meaningful once a mode is set. In router mode the backend
  // keeps whatever string was there last, so printing it would present a stale
  // identifier as the current target.
  const macRaw = (targetMac ?? "").toUpperCase();
  const macActive = mode !== null && mode !== "disabled";
  const macAutomatic = macRaw === "" || macRaw === AUTOMATIC_MAC;
  const macCaption = !macActive
    ? t(`${K}.tiles.target.caption_none`)
    : macAutomatic
      ? t(`${K}.tiles.target.caption_automatic`)
      : t(`${K}.tiles.target.caption_manual`);

  const natOn = ipptNat === "1";
  const dnsOn = dnsProxy === "enabled";

  return (
    <div className={TILE.GRID}>
      {ready ? (
        <>
          <Tile
            glyph={modeSpec.glyph}
            disc={modeSpec.disc}
            animate
            eyebrow={t(`${K}.tiles.mode.label`)}
            caption={modeSpec.caption}
          >
            <span className={TILE.VALUE_TEXT}>{modeSpec.value}</span>
          </Tile>

          <Tile
            glyph={MonitorSmartphoneIcon}
            eyebrow={t(`${K}.tiles.target.label`)}
            caption={macCaption}
          >
            {/* The MAC is an identifier the modem matches byte-for-byte, so it
                takes the machine voice — the one value on this band that does.
                The em dash is not an identifier, so it stays in the UI face. */}
            {macActive && !macAutomatic ? (
              <span className={TILE.VALUE_MONO}>{macRaw}</span>
            ) : (
              <span className={TILE.VALUE_TEXT}>{TILE.NONE}</span>
            )}
          </Tile>

          <Tile
            glyph={ArrowLeftRightIcon}
            eyebrow={t(`${K}.tiles.nat.label`)}
            caption={t(
              natOn ? `${K}.tiles.nat.caption_on` : `${K}.tiles.nat.caption_off`,
            )}
          >
            <span className={TILE.VALUE_TEXT}>
              {t(natOn ? `${K}.tiles.nat.value_on` : `${K}.tiles.nat.value_off`)}
            </span>
          </Tile>

          <Tile
            glyph={GlobeIcon}
            eyebrow={t(`${K}.tiles.dns.label`)}
            caption={t(
              dnsOn ? `${K}.tiles.dns.caption_on` : `${K}.tiles.dns.caption_off`,
            )}
          >
            <span className={TILE.VALUE_TEXT}>
              {t(dnsOn ? `${K}.tiles.dns.value_on` : `${K}.tiles.dns.value_off`)}
            </span>
          </Tile>
        </>
      ) : failed && !isLoading ? (
        <NoticeTile
          title={t(`${K}.errors.read_title`)}
          body={t(`${K}.errors.read_body`)}
          actionLabel={t(`${K}.errors.retry`)}
          onRetry={onRetry}
        />
      ) : (
        // Four skeletons in the SAME grid, mirroring the pin BY IMPORT rather
        // than by a restated number (The Skeleton-Mirror Rule).
        Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className={cn(TILE.HEIGHT, "rounded-tile")} />
        ))
      )}
    </div>
  );
}

export default IpptStrip;
