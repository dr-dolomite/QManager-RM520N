"use client";

import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { RefreshCcwIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { useSaveFlash } from "@/components/ui/save-button";
import { useCustomDns } from "@/hooks/use-custom-dns";
import { staggerContainer, staggerItem } from "@/lib/motion";

import { CustomDnsCard, CustomDnsCardSkeleton } from "./custom-dns-card";
import { DnsStrip, STATE_GLYPH } from "./dns-strip";
import {
  BAND,
  PAGE_HEAD,
  PAGE_ROOT,
  PILL_ACTION,
  STATE_BADGE,
  type DnsState,
} from "./shapes";

// =============================================================================
// Custom DNS — page shell
// =============================================================================
// The shell owns the hook, the ONE derived page state, the page header with its
// Refresh pill, the band header and its status chip, and the `staggerContainer`
// cascade over the live strip and the write card.
//
// It is NEW. The route used to inline its header in
// `app/local-network/custom-dns/page.tsx`, which is a SERVER component and
// therefore cannot own a motion cascade — so the page snapped in while its two
// sibling routes under `/local-network/` faded. All three routes are now
// structurally identical: `page.tsx` re-exports a shell, and the shell holds
// everything.
//
// -----------------------------------------------------------------------------
// ONE DERIVED STATE, READ BY EVERYTHING
// -----------------------------------------------------------------------------
// Four things can be true of this page, and exactly one of them is true at a
// time. The shell computes which, and the strip, the chip and the banner all
// read that single value rather than each re-deriving it from the payload's
// shape. Three components independently asking "is `currentSource` custom?" is
// how two of them end up disagreeing after a copy edit.
//
//   unavailable  dnsmasq is not in the path. `<DNSMode>` in mobileap_cfg.xml is
//                something other than PROXY, so LAN clients resolve directly
//                against the carrier and nothing on this page reaches them.
//   corrupt      the sentinel block in dnsmasq.conf is malformed.
//   custom       QManager's block is active and dnsmasq is forwarding to it.
//   carrier      the resting state: whatever the carrier handed out on the last
//                attach. NOT a fault, which is why its chip is `muted`.
//
// -----------------------------------------------------------------------------
// THE UNAVAILABLE NOTICE POINTS AT SSH, NOT AT ANOTHER PAGE
// -----------------------------------------------------------------------------
// The obvious thing to write here is a link to the passthrough settings offering
// to change the DNS mode. That link would be a lie. A tree-wide grep finds
// exactly ONE file that mentions `mobileap_cfg` at all — the Custom DNS CGI
// itself — and it only READS `<DNSMode>`, via `xmlstarlet sel` with a `grep`
// fallback. Nothing in QManager writes that field, on any page. The reference
// docs describe it as a read-time availability gate, which is precisely what it
// is.
//
// So the notice names the file and says the change has to happen outside the
// product. A button that leads somewhere with no such control is worse than no
// button.
//
// -----------------------------------------------------------------------------
// A DAMAGED BLOCK WARNS. IT DOES NOT BLOCK, AND IT OFFERS NO REPAIR.
// -----------------------------------------------------------------------------
// The banner is `degraded` (warning), not `stale` (destructive), it carries no
// action, and it does NOT disable the card below it. Two independent reasons,
// and either alone would be enough:
//
//   1. The only repair verb the backend has would make it worse. `action=clear`
//      maps onto save-with-`enabled=false`, which runs the sentinel stripper —
//      and that function raises its in-block flag on BEGIN and lowers it only on
//      END. A block that is damaged BY having a BEGIN with no END therefore
//      swallows every remaining line of `dnsmasq.conf`: `listen-address`,
//      `dhcp-authoritative`, `conf-dir`. `dnsmasq --test` passes it (the
//      truncated file is valid, just missing directives), `sudo mv` installs it
//      and `killall -HUP` makes it live, on a device reached over that LAN.
//   2. The flag has a false-positive path. The block parser reads with
//      `while IFS= read -r line`, whose body never runs for a final line with no
//      trailing newline, so a perfectly healthy file that ends exactly at the
//      END marker reports damage. Locking a user out of their own DNS settings
//      on a false positive is not an acceptable failure mode for a page that is
//      reached over the network it configures.
//
// What the warning is FOR is the reading above it: with a malformed block, the
// upstream list is not reliably what dnsmasq is resolving against, and the two
// upstream tiles say so in their own captions rather than presenting a confident
// figure the page cannot stand behind.
// =============================================================================

const K = "customDns";

const CustomDnsComponent = () => {
  const { t } = useTranslation("common");
  const {
    settings,
    isLoading,
    isSaving,
    error,
    fieldError,
    saveSettings,
    refresh,
  } = useCustomDns();
  const { saved, markSaved } = useSaveFlash();

  const available = settings?.available ?? true;
  const blockCorrupt = settings?.blockCorrupt === true;

  // A read that failed and left NOTHING behind. Distinct from a read that failed
  // over data we already have: the skeleton is a promise that data is coming,
  // and this is the one case where the promise is broken and has to be said out
  // loud instead of shimmering forever.
  const readFailed = !settings && !isLoading && error !== null;

  const state: DnsState = !available
    ? "unavailable"
    : blockCorrupt
      ? "corrupt"
      : settings?.currentSource === "custom"
        ? "custom"
        : "carrier";

  const StateGlyph = STATE_GLYPH[state];

  // The cascade root declares `initial`/`animate` ONCE. The header, the band and
  // the card are `staggerItem` children and must NOT declare their own, or they
  // detach from the parent's clock and render at `hidden` forever.
  return (
    <motion.div
      className={PAGE_ROOT}
      aria-live="polite"
      aria-atomic="false"
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
    >
      <motion.div variants={staggerItem}>
        <div className={PAGE_HEAD.ROOT}>
          <div className={PAGE_HEAD.TITLES}>
            <h1 className={PAGE_HEAD.TITLE}>{t(`${K}.page.title`)}</h1>
            <p className={PAGE_HEAD.DESC}>{t(`${K}.page.description`)}</p>
          </div>

          <div className={PAGE_HEAD.ACTIONS}>
            {/* Wrapped, never `onClick={refresh}`. `refresh` takes a `silent`
                flag as its first argument, so handing it the handler slot passes
                a MouseEvent as `silent` — truthy — and the read runs with its
                loading state suppressed. The button then looks inert for the
                whole request. */}
            <Button
              type="button"
              variant="outline"
              onClick={() => refresh()}
              disabled={isSaving}
              className={PILL_ACTION}
            >
              <RefreshCcwIcon className="size-4" />
              {t(`${K}.header.refresh`)}
            </Button>
          </div>
        </div>
      </motion.div>

      {state === "unavailable" ? (
        <motion.div variants={staggerItem}>
          <Banner
            role="degraded"
            title={t(`${K}.unavailable.title`, {
              mode: settings?.dnsMode || "?",
            })}
            description={t(`${K}.unavailable.body`)}
          />
        </motion.div>
      ) : state === "corrupt" ? (
        <motion.div variants={staggerItem}>
          <Banner
            role="degraded"
            title={t(`${K}.corrupt.title`)}
            description={t(`${K}.corrupt.body`)}
          />
        </motion.div>
      ) : null}

      <motion.div variants={staggerItem}>
        <section
          aria-label={t(`${K}.strip.label`)}
          className="flex flex-col gap-2"
        >
          <div className={BAND.HEAD}>
            <span className={BAND.LABEL}>{t(`${K}.strip.label`)}</span>
            {/* The chip is gated on a landed read: it is a property OF the
                reading, so on a failed first read there is nothing for it to be
                a property of. Its four roles never share a glyph — the
                success and warning fills measure 1.03:1 apart and are identical
                under deuteranopia. */}
            {settings ? (
              <Badge variant={STATE_BADGE[state]}>
                <StateGlyph className={BAND.GLYPH} aria-hidden="true" />
                {t(`${K}.strip.state_${state}`)}
              </Badge>
            ) : null}
          </div>

          <DnsStrip
            settings={settings}
            isLoading={isLoading}
            readFailed={readFailed}
            state={state}
          />
        </section>
      </motion.div>

      {/* No write surface over a read that never landed. A form filled with
          defaults, above a band that just said it could not read the device, is
          the interface inventing state. The header's Refresh pill is the way
          back.

          The card MOUNTS on the payload rather than receiving a nullable one.
          That is what lets it seed every field from the device exactly once, at
          mount, instead of synchronising from an effect on every poll — see its
          own header. The skeleton is the same card with the same rows, so the
          handoff moves nothing. */}
      {readFailed ? null : (
        <motion.div variants={staggerItem}>
          {settings ? (
            <CustomDnsCard
              settings={settings}
              isSaving={isSaving}
              saved={saved}
              error={error}
              fieldError={fieldError}
              available={available}
              blockCorrupt={blockCorrupt}
              onSave={saveSettings}
              onSaved={markSaved}
            />
          ) : (
            <CustomDnsCardSkeleton />
          )}
        </motion.div>
      )}
    </motion.div>
  );
};

export default CustomDnsComponent;
