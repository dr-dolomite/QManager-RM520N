"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2Icon,
  CircleAlertIcon,
  CircleSlashIcon,
  LifeBuoyIcon,
  MinusCircleIcon,
  RouteIcon,
  ServerIcon,
  ShieldOffIcon,
  TriangleAlertIcon,
  XCircleIcon,
  type LucideIcon,
} from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { CustomDnsSettingsResponse } from "@/types/custom-dns";

import {
  CAPTION,
  DISC_TONE,
  DISC_TRANSITION,
  EYEBROW,
  NOTICE_SPAN,
  NOTICE_TITLE,
  TILE,
  VALUE,
  VALUE_MONO,
  VALUE_NONE,
  VALUE_TEXT,
  type DiscTone,
  type DnsState,
} from "./shapes";

// =============================================================================
// DnsStrip — Band A of /local-network/custom-dns
// =============================================================================
// Four tiles under the page header: the two live upstream resolvers, where they
// came from, and whether the carrier is still standing behind them.
//
// -----------------------------------------------------------------------------
// THE PROMOTION IS THE WHOLE POINT
// -----------------------------------------------------------------------------
// This readout is not new. It already existed as a `MetaPanel` titled
// "Currently forwarding" — buried INSIDE the form, BELOW the enable switch, so
// the page opened on the fields you can write and answered "what is the modem
// actually resolving against right now" three scroll-inches later, if at all.
//
// That ordering is backwards for this product specifically. QManager runs on the
// modem it is reconfiguring and the answer routes the reader's own session, so
// "what is true right now" is the first question on this surface, not a footnote
// under the controls.
//
// -----------------------------------------------------------------------------
// THE FOURTH TILE IS `ignoreCarrier`, NOT `passthroughBypass`
// -----------------------------------------------------------------------------
// `passthroughBypass` is on the wire and is deliberately NOT rendered anywhere
// on this surface. `get_passthrough_bypass()` in `custom_dns.sh` is a stub: it
// carries a TODO and prints the literal string "false", unconditionally. It is a
// compile-time constant, not a reading, and drawing a constant as though it were
// a measurement is worse than not drawing it at all.
//
// It was already unreachable in practice — the retired card gated a whole notice
// paragraph on it, so that paragraph could never render. Deleted rather than
// ported.
//
// `ignoreCarrier` is a real, user-set, consequential state and it takes the
// slot: with the fallback off, a lookup FAILS OUTRIGHT when the configured
// resolvers are unreachable, instead of quietly leaking to the carrier. That is
// the one setting on this page whose "off" is louder than its "on", which is why
// its disc — and only its disc — goes `warning`.
//
// -----------------------------------------------------------------------------
// THE FIGURES ARE ECHOED CONFIG WHEN CUSTOM DNS IS ON
// -----------------------------------------------------------------------------
// `build_get_payload` sets `currentUpstream` to the CONFIGURED server list
// whenever the sentinel block is active, and reads `/run/resolv.conf` only when
// it is not. So on the custom path this is what the block says, not what dnsmasq
// was observed doing — if the SIGHUP failed, the GET still reports the
// configured servers. No caption on this strip says "verified", "confirmed" or
// "live", because none of them would be true.
//
// -----------------------------------------------------------------------------
// COLOUR
// -----------------------------------------------------------------------------
// Every body is `TILE.BODY` and there is no `tone` prop to make an exception.
// Two discs move: carrier fallback (warning when off) and the two upstream tiles
// (destructive when the sentinel block is malformed, because in that state the
// printed list is not reliably what dnsmasq is resolving against). SOURCE never
// moves — "Custom" and "Carrier" are categories, and neither is healthier than
// the other.
//
// No two states in the same slot share a glyph. The state chip's four roles take
// four different glyphs for the same reason: `success-container` and
// `warning-container` measure 1.03:1 apart and are identical under deuteranopia.
// =============================================================================

const K = "customDns";

/**
 * Well-known public resolvers, so a bare address can say whose it is.
 *
 * The values are PROPER NOUNS and are deliberately not translation keys: an
 * operator's brand name is the same string in every locale, and routing it
 * through the locale packs would invite five spellings of "Cloudflare".
 *
 * Unrecognised is the common case and is handled without apology — the caption
 * falls back to the resolver's PROVENANCE ("From the last attach" / "You set
 * this one"), which is a more useful thing to know than a brand anyway.
 */
const PROVIDER_BY_ADDRESS: Record<string, string> = {
  "1.1.1.1": "Cloudflare",
  "1.0.0.1": "Cloudflare",
  "2606:4700:4700::1111": "Cloudflare",
  "2606:4700:4700::1001": "Cloudflare",
  "8.8.8.8": "Google",
  "8.8.4.4": "Google",
  "2001:4860:4860::8888": "Google",
  "2001:4860:4860::8844": "Google",
  "9.9.9.9": "Quad9",
  "149.112.112.112": "Quad9",
  "2620:fe::fe": "Quad9",
  "2620:fe::9": "Quad9",
  "208.67.222.222": "OpenDNS",
  "208.67.220.220": "OpenDNS",
  "94.140.14.14": "AdGuard",
  "94.140.15.15": "AdGuard",
  "76.76.2.0": "Control D",
  "76.76.10.0": "Control D",
  "185.228.168.9": "CleanBrowsing",
  "185.228.169.9": "CleanBrowsing",
};

function providerFor(address: string): string | undefined {
  return PROVIDER_BY_ADDRESS[address.trim().toLowerCase()];
}

/**
 * One tile. There is deliberately no body-tone prop: every body on this strip is
 * neutral, so a caller cannot tint one back. Making the wrong thing unreachable
 * is cheaper than a comment asking nobody to do it.
 */
function Tile({
  glyph: Glyph,
  tone = "neutral",
  animate = false,
  eyebrow,
  children,
  caption,
}: {
  glyph: LucideIcon;
  /** The disc's fill — the only colour a tile is allowed to carry. */
  tone?: DiscTone;
  /**
   * True for the two discs that genuinely change at runtime. A transition on a
   * disc that never moves is a declaration that never fires.
   */
  animate?: boolean;
  eyebrow: string;
  children: React.ReactNode;
  caption: React.ReactNode;
}) {
  return (
    <div className={cn(TILE.ROOT, TILE.BODY)}>
      <span
        className={cn(TILE.DISC, animate && DISC_TRANSITION, DISC_TONE[tone])}
      >
        <Glyph className={TILE.GLYPH} aria-hidden="true" />
      </span>
      <div className={TILE.TEXT}>
        <span className={EYEBROW}>{eyebrow}</span>
        <span className={VALUE}>{children}</span>
        <span className={CAPTION}>{caption}</span>
      </div>
    </div>
  );
}

/**
 * The band's third state: one tile SPANNING the grid.
 *
 * Four identical "couldn't read" tiles would be one message repeated four times,
 * and a bespoke centred error card is a second vocabulary for the same event.
 * The band keeps the family box and goes neutral rather than shimmering — a
 * skeleton is a promise that data is on its way, and holding one over a dead
 * poll is a misstatement.
 */
function NoticeTile({
  glyph: Glyph,
  title,
  body,
}: {
  glyph: LucideIcon;
  title: string;
  body: string;
}) {
  return (
    <div className={cn(TILE.ROOT, TILE.BODY, NOTICE_SPAN)} role="status">
      <span className={cn(TILE.DISC, DISC_TONE.neutral)}>
        <Glyph className={TILE.GLYPH} aria-hidden="true" />
      </span>
      <div className={TILE.TEXT}>
        <span className={NOTICE_TITLE}>{title}</span>
        <span className={CAPTION}>{body}</span>
      </div>
    </div>
  );
}

/**
 * The state chip's glyph. Four states, four glyphs, never shared — the chip
 * fills for `success` and `warning` are 1.03:1 apart and the glyph is what
 * actually separates them.
 *
 * Exported because the shell renders the band's header: the shell owns "which
 * of the four states is this page in", and this strip owns "what do the four
 * tiles say about it". The tone map and the glyph map therefore travel together
 * to the same consumer and cannot drift into disagreeing about a state.
 */
export const STATE_GLYPH: Record<DnsState, LucideIcon> = {
  custom: CheckCircle2Icon,
  carrier: MinusCircleIcon,
  corrupt: XCircleIcon,
  unavailable: TriangleAlertIcon,
};

export interface DnsStripProps {
  /** The GET's payload. `null` while the first read has not landed. */
  settings: CustomDnsSettingsResponse | null;
  /** True until the first read resolves, either way. */
  isLoading: boolean;
  /** True when the read failed and left nothing behind. */
  readFailed: boolean;
  /** The page's one derived state. Computed by the shell, read by everything. */
  state: DnsState;
}

export function DnsStrip({
  settings,
  isLoading,
  readFailed,
  state,
}: DnsStripProps) {
  const { t } = useTranslation("common");

  const ready = settings !== null;
  // A read that FAILED and left nothing behind. Distinct from "still loading":
  // the skeleton is a promise, and this is where the promise is broken.
  const failed = !ready && !isLoading && readFailed;

  const corrupt = state === "corrupt";
  const unavailable = state === "unavailable";

  const upstream = settings?.currentUpstream ?? [];
  const source = settings?.currentSource ?? "unknown";
  const dnsMode = settings?.dnsMode ?? "";
  // "ABSENT" means the XML carries no <DNSMode> element at all (SDX55 firmware);
  // dnsmasq is still proxying, so name the mode rather than print the sentinel.
  const sourceCaption =
    dnsMode === "ABSENT"
      ? t(`${K}.tiles.source.caption_implicit`)
      : t(`${K}.tiles.source.caption`, { mode: dnsMode || "?" });
  // `ignoreCarrier` is "do not fall back", so the tile's reading is its inverse.
  // Naming it here rather than at the call site keeps the double negative from
  // reaching the JSX, where it reads backwards every single time.
  const fallbackOn = !(settings?.ignoreCarrier ?? false);

  /** One upstream tile. Index 0 and 1 differ only in which address they read. */
  const upstreamTile = (index: number) => {
    const address = upstream[index];
    const provider = address ? providerFor(address) : undefined;

    const caption = corrupt
      ? t(`${K}.tiles.upstream.caption_untrusted`)
      : !address
        ? index === 0
          ? t(`${K}.tiles.upstream.caption_none`)
          : source === "carrier"
            ? t(`${K}.tiles.upstream.caption_absent_carrier`)
            : t(`${K}.tiles.upstream.caption_absent_custom`)
        : provider
          ? provider
          : source === "carrier"
            ? t(`${K}.tiles.upstream.caption_attach`)
            : t(`${K}.tiles.upstream.caption_yours`);

    const glyph: LucideIcon = corrupt
      ? TriangleAlertIcon
      : address
        ? ServerIcon
        : MinusCircleIcon;

    return (
      <Tile
        glyph={glyph}
        tone={corrupt ? "destructive" : "neutral"}
        animate
        eyebrow={t(
          index === 0
            ? `${K}.tiles.upstream.label_one`
            : `${K}.tiles.upstream.label_two`,
        )}
        caption={caption}
      >
        {address ? (
          <span className={VALUE_MONO}>{address}</span>
        ) : (
          <span className={VALUE_TEXT}>{VALUE_NONE}</span>
        )}
      </Tile>
    );
  };

  return (
    <div className={TILE.GRID}>
        {ready && unavailable ? (
          // A DESIGNED outcome on this device, not a fault — which is why the
          // copy states the configuration fact rather than apologising for a
          // failure, and offers no in-app remedy: there is none (see the shell).
          <NoticeTile
            glyph={CircleSlashIcon}
            title={t(`${K}.strip.unavailable_title`)}
            body={t(`${K}.strip.unavailable_body`, { mode: dnsMode || "?" })}
          />
        ) : ready ? (
          <>
            {upstreamTile(0)}
            {upstreamTile(1)}

            <Tile
              glyph={RouteIcon}
              eyebrow={t(`${K}.tiles.source.label`)}
              caption={sourceCaption}
            >
              <span className={VALUE_TEXT}>
                {t(`${K}.tiles.source.value_${source}`)}
              </span>
            </Tile>

            <Tile
              glyph={fallbackOn ? LifeBuoyIcon : ShieldOffIcon}
              tone={fallbackOn ? "neutral" : "warning"}
              animate
              eyebrow={t(`${K}.tiles.fallback.label`)}
              caption={t(
                fallbackOn
                  ? `${K}.tiles.fallback.caption_on`
                  : `${K}.tiles.fallback.caption_off`,
              )}
            >
              <span className={VALUE_TEXT}>
                {t(
                  fallbackOn
                    ? `${K}.tiles.fallback.value_on`
                    : `${K}.tiles.fallback.value_off`,
                )}
              </span>
            </Tile>
          </>
        ) : failed ? (
          <NoticeTile
            glyph={CircleAlertIcon}
            title={t(`${K}.strip.read_failed_title`)}
            body={t(`${K}.strip.read_failed_body`)}
          />
        ) : (
          // Four skeletons in the SAME grid, mirroring the pin BY IMPORT rather
          // than by number — a restated height is how a handoff jump ships
          // (The Skeleton-Mirror Rule).
          Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className={cn(TILE.HEIGHT, "rounded-tile")} />
          ))
        )}
    </div>
  );
}

export default DnsStrip;
