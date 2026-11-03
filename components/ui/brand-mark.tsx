"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import type { IconType } from "react-icons";
import {
  SiCloudflare,
  SiDiscord,
  SiDota2,
  SiEpicgames,
  SiFacebook,
  SiFoodpanda,
  SiGithub,
  SiGoogle,
  SiGrab,
  SiInstagram,
  SiLine,
  SiMessenger,
  SiNetflix,
  SiPinterest,
  SiPlaystation,
  SiReddit,
  SiRiotgames,
  SiRoblox,
  SiShopee,
  SiSignal,
  SiSnapchat,
  SiSpeedtest,
  SiSpotify,
  SiSteam,
  SiTelegram,
  SiThreads,
  SiTiktok,
  SiTwitch,
  SiValorant,
  SiViber,
  SiWhatsapp,
  SiWikipedia,
  SiX,
  SiYoutube,
  SiZoom,
} from "react-icons/si";

import { faviconUrl, logoKey, useLogo } from "@/lib/logo-store";
import { cn } from "@/lib/utils";

// =============================================================================
// BrandMark — one registrable domain, drawn as its brand
// =============================================================================
// Shared by the Sites surface (`latency-monitoring/site-mark.tsx`) and the SMS
// sender discs (`cellular/sms/sms-identity-disc.tsx`). Ladder, in order:
//   1. A mapped `react-icons/si` glyph in its brand colour.
//   2. A fetched logo from `lib/logo-store.ts`: Hunter's logo, else the Google
//      s2 favicon, checked once by the BROWSER (never the device) and kept in
//      localStorage. A square one can fill the plate (`fillLogoClassName`).
//   3. The fallback: a monogram by default, or whatever the caller passes.
//
// Privacy: the only thing that ever reaches Hunter or Google is the `domain`
// the caller hands in. Callers pass a curated domain, never a sender ID or a
// number.
// =============================================================================

// Brand marks are content, like the RAT marks on the dashboard; the label carries identity.
// A null colour is a near-black brand, drawn in on-surface ink so it holds in both themes.
export type Mark = readonly [IconType, string | null];

const BRAND_MARKS: Record<string, Mark> = {
  "google.com": [SiGoogle, "#4285F4"],
  "facebook.com": [SiFacebook, "#0866FF"],
  "tiktok.com": [SiTiktok, null],
  "youtube.com": [SiYoutube, "#FF0000"],
  "roblox.com": [SiRoblox, null],
  "spotify.com": [SiSpotify, "#1ED760"],
  "x.com": [SiX, null],
  "twitter.com": [SiX, null],
  "reddit.com": [SiReddit, "#FF4500"],
  "github.com": [SiGithub, null],
  "discord.com": [SiDiscord, "#5865F2"],
  "instagram.com": [SiInstagram, "#FF0069"],
  "messenger.com": [SiMessenger, "#00B2FF"],
  "netflix.com": [SiNetflix, "#E50914"],
  "whatsapp.com": [SiWhatsapp, "#25D366"],
  "twitch.tv": [SiTwitch, "#9146FF"],
  "steampowered.com": [SiSteam, null],
  "cloudflare.com": [SiCloudflare, "#F38020"],
  "telegram.org": [SiTelegram, "#26A5E4"],
  "t.me": [SiTelegram, "#26A5E4"],
  "zoom.us": [SiZoom, "#0B5CFF"],
  "wikipedia.org": [SiWikipedia, null],
  "threads.net": [SiThreads, null],
  // Snapchat's yellow fails on a light tile, so it takes ink.
  "snapchat.com": [SiSnapchat, null],
  "pinterest.com": [SiPinterest, "#BD081C"],
  "signal.org": [SiSignal, "#3B45FD"],
  "viber.com": [SiViber, "#7360F2"],
  "line.me": [SiLine, "#00C300"],
  "playvalorant.com": [SiValorant, "#FA4454"],
  "riotgames.com": [SiRiotgames, "#EB0029"],
  "epicgames.com": [SiEpicgames, null],
  "playstation.com": [SiPlaystation, "#0070D1"],
  "speedtest.net": [SiSpeedtest, null],
  // Dota's #BF2E1A measures 2.88:1 on the dark tile (4.85:1 light), so it takes ink.
  "dota2.com": [SiDota2, null],
  // A key with no dot matches the first label: Shopee runs one storefront per country domain.
  shopee: [SiShopee, "#EE4D2D"],
  // SMS senders (curated in lib/sms-logos.ts): the PH brands react-icons/si carries.
  // Every other curated sender domain falls back to its favicon.
  "grab.com": [SiGrab, "#00B14F"],
  foodpanda: [SiFoodpanda, "#D70F64"],
};

/** Matches the exact host or any subdomain of a mapped registrable domain. */
export function markFor(host: string): Mark | null {
  const h = host.toLowerCase().replace(/^www\./, "");
  const first = h.split(".")[0];
  for (const [domain, mark] of Object.entries(BRAND_MARKS)) {
    if (domain.includes(".") ? h === domain || h.endsWith(`.${domain}`) : first === domain) return mark;
  }
  return null;
}

const STACK = "*:col-start-1 *:row-start-1";
const FADE = "transition-opacity duration-[var(--duration-standard)] ease-standard";

export interface BrandMarkProps {
  /** The registrable domain (or host) to draw. Curated by the caller. */
  domain: string;
  /** Names the brand; its first letter is the default monogram. */
  label: string;
  /** The plate: size, fill and shape. Always applied. */
  className?: string;
  /** Extra plate classes applied only while a real logo (glyph or loaded favicon) is showing. */
  logoClassName?: string;
  /** Size of the mapped glyph. Defaults to filling the plate. */
  glyphClassName?: string;
  /** Size and shape of a fetched logo image. Defaults to filling the plate. */
  faviconClassName?: string;
  /**
   * Plate classes for a SQUARE fetched logo, which then fills the plate edge to
   * edge (cover-fit, clipped round) instead of sitting inset. Omit to keep every
   * fetched logo fitted with `logoClassName` / `faviconClassName`.
   */
  fillLogoClassName?: string;
  /** Type for the default monogram. Ignored when `fallback` is passed. */
  monogramClassName?: string;
  /** Replaces the monogram: what shows when no glyph is mapped and no favicon (yet) loaded. */
  fallback?: ReactNode;
}

export function BrandMark({
  domain,
  label,
  className,
  logoClassName,
  glyphClassName = "size-full",
  faviconClassName = "size-full rounded-[2px] object-contain",
  fillLogoClassName,
  monogramClassName = "text-on-surface-variant leading-none font-bold",
  fallback,
}: BrandMarkProps) {
  const mark = markFor(domain);
  // A mapped glyph never fetches; an empty domain is a no-op in the store.
  const logo = useLogo(mark ? "" : domain);
  // Image results are per src, set from the image's own events.
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);

  if (!mark) {
    const src =
      logo?.s === "h" ? logo.d : logo?.s === "g" ? faviconUrl(logoKey(domain)) : null;
    const usable = src !== null && src !== brokenSrc;
    // A stored data URI paints at once; a verified favicon waits for its load.
    const ready = usable && (logo?.s === "h" || loadedSrc === src);
    const fill = ready && fillLogoClassName !== undefined && (logo?.s === "g" || (logo?.s === "h" && logo.sq));
    return (
      <span
        aria-hidden
        className={cn(
          className,
          STACK,
          logoClassName && "transition-colors duration-[var(--duration-standard)] ease-standard",
          ready && (fill ? fillLogoClassName : logoClassName),
        )}
      >
        {usable ? (
          <img
            key={src}
            src={src}
            alt=""
            referrerPolicy="no-referrer"
            decoding="async"
            onLoad={() => setLoadedSrc(src)}
            onError={() => setBrokenSrc(src)}
            className={cn(
              // Zoomed past the asset's own edge: many logos are a round mark on a
              // square (BDO), whose corners would otherwise ring the disc.
              fill ? "size-full scale-[1.15] rounded-full object-cover" : faviconClassName,
              FADE,
              ready ? "opacity-100" : "opacity-0",
            )}
          />
        ) : null}
        <span
          className={cn(
            fallback === undefined ? monogramClassName : "grid place-items-center",
            FADE,
            ready ? "opacity-0" : "opacity-100",
          )}
        >
          {fallback ?? (label || domain).charAt(0).toUpperCase()}
        </span>
      </span>
    );
  }

  const [Icon, color] = mark;
  return (
    <span aria-hidden className={cn(className, logoClassName)}>
      <Icon
        className={cn(glyphClassName, !color && "text-on-surface")}
        style={color ? { color } : undefined}
      />
    </span>
  );
}
