"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { RefreshCcwIcon } from "lucide-react";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { useMtuSettings } from "@/hooks/use-mtu-settings";
import { useSimProfiles } from "@/hooks/use-sim-profiles";
import { useTtlSettings } from "@/hooks/use-ttl-settings";

import { MtuSettingsCard } from "./mtu-settings-card";
import { TtlMtuStrip } from "./ttl-mtu-strip";
import { TtlSettingsCard } from "./ttl-settings-card";
import {
  PAGE_HEAD,
  PAGE_ROOT,
  PILL_ACTION,
  STATE_BADGE,
  type TtlMtuState,
} from "./shapes";

// =============================================================================
// TTL & MTU — page shell
// =============================================================================
// The shell owns ALL the data and the composition: page header with a Refresh
// pill, then a `staggerContainer` cascade over one live band and two peer write
// cards.
//
// -----------------------------------------------------------------------------
// WHY THE HOOKS LIVE HERE AND NOT IN THE CARDS
// -----------------------------------------------------------------------------
// Band A spans BOTH endpoints — `ttl.sh` and `mtu.sh` — so the reading it draws
// cannot be assembled inside either card. This is also the shape the sibling
// reference landed on: `ethernet-status.tsx` owns the fetch and wires the
// Refresh pill, and `speed-limit-card.tsx` owns no hook at all.
//
// Hoisting them fixes finding 6 as a side effect. Both hooks have always
// exported `refresh`, and neither card ever destructured it, so a failed GET
// left a permanent skeleton with no way out of it. The pill in this header and
// the Retry inside the band's notice tile are both wired to the same call.
//
// `refresh` is invoked through an arrow, never passed bare. Both hooks return
// `useCallback(async (silent = false) => ...)`, so `onClick={refreshTtl}` would
// hand a `MouseEvent` in as `silent` — a truthy value — and suppress the very
// loading state the button exists to show.
//
// -----------------------------------------------------------------------------
// THE PROFILE OVERRIDE IS A PAGE-LEVEL CONDITION, SO IT IS A PAGE-LEVEL BANNER
// -----------------------------------------------------------------------------
// A Custom SIM Profile that carries a TTL or HL writes both values whenever it
// is activated, so leaving this page's TTL card writable would put two writers
// on one setting. The retired card stated that inside itself, in a stock
// `Alert`, below the card title — i.e. after the reader had already started
// reading the control. It states it above both cards now, because the reason the
// control is held is a fact about the SYSTEM, not about the row.
//
// `role="override"` is the Banner's neutral, page-scoped note — the one role in
// the set that is explicitly not a system condition. An `info` banner would
// resolve to `primary-container` under the Info-Is-Brand Rule, which is the
// tone reserved for something the product is telling you about itself, and this
// is the page explaining its own state.
//
// MTU is NOT profile-managed: no profile field writes it, so card 2 stays
// writable while card 1 is held. Holding both would be the interface claiming a
// constraint the device does not have.
// =============================================================================

const K = "ttlMtu";

const TTLandMTUSettingsComponent = () => {
  const { t } = useTranslation("common");

  const {
    data: ttlData,
    isLoading: ttlLoading,
    isSaving: ttlSaving,
    error: ttlError,
    saveTtlHl,
    refresh: refreshTtl,
  } = useTtlSettings();

  const {
    data: mtuData,
    isLoading: mtuLoading,
    isSaving: mtuSaving,
    error: mtuError,
    saveMtu,
    disableMtu,
    refresh: refreshMtu,
  } = useMtuSettings();

  const {
    activeProfileId,
    getProfile,
    isLoading: profilesLoading,
  } = useSimProfiles();

  // ---------------------------------------------------------------------------
  // Which profile, if any, owns TTL and hop limit
  // ---------------------------------------------------------------------------
  // `getProfile` is an async read, so this cannot be derived during render. The
  // cancelled flag is what keeps a slow read for a profile the user has already
  // switched away from out of the banner.
  const [profileOverride, setProfileOverride] = useState<{
    profileId: string;
    name: string;
  } | null>(null);

  useEffect(() => {
    if (!activeProfileId) return;

    let cancelled = false;
    (async () => {
      const profile = await getProfile(activeProfileId);
      if (cancelled) return;

      if (profile && (profile.settings.ttl > 0 || profile.settings.hl > 0)) {
        setProfileOverride({ profileId: activeProfileId, name: profile.name });
      } else {
        setProfileOverride(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeProfileId, getProfile]);

  const isProfileControlled =
    !!activeProfileId && profileOverride?.profileId === activeProfileId;
  const profileName = isProfileControlled ? profileOverride.name : "";

  // ---------------------------------------------------------------------------
  // The band's derived state
  // ---------------------------------------------------------------------------
  // "Is anything overriding the carrier" is the one question that spans both
  // endpoints, so it is answered here and handed down resolved. `STATE_BADGE` is
  // keyed onto `BadgeVariant`, so a state without a matching chip role fails the
  // build rather than shipping an untinted chip.
  const bandState: TtlMtuState =
    (ttlData !== null && (ttlData.ttl > 0 || ttlData.hl > 0)) ||
    (mtuData !== null && mtuData.isEnabled)
      ? "custom"
      : "default";

  const isBusy = ttlSaving || mtuSaving;

  const refreshBoth = useCallback(() => {
    refreshTtl();
    refreshMtu();
  }, [refreshTtl, refreshMtu]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  // The cascade root declares `initial`/`animate` ONCE. Every child is a
  // `staggerItem` and must NOT declare its own, or it detaches from the parent's
  // clock and renders at `hidden` forever. The retired page had no motion at all
  // (finding 9) — it snapped in.
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
            <Button
              type="button"
              variant="outline"
              onClick={() => refreshBoth()}
              disabled={isBusy}
              className={PILL_ACTION}
            >
              <RefreshCcwIcon className="size-4" />
              {t(`${K}.header.refresh`)}
            </Button>
          </div>
        </div>
      </motion.div>

      <motion.div variants={staggerItem}>
        <TtlMtuStrip
          ttl={
            ttlData
              ? {
                  isEnabled: ttlData.isEnabled,
                  ttl: ttlData.ttl,
                  hl: ttlData.hl,
                }
              : null
          }
          mtu={
            mtuData
              ? {
                  isEnabled: mtuData.isEnabled,
                  currentValue: mtuData.currentValue,
                }
              : null
          }
          ttlPending={ttlLoading}
          mtuPending={mtuLoading}
          state={bandState}
          stateBadge={STATE_BADGE[bandState]}
          onRetry={() => refreshBoth()}
        />
      </motion.div>

      {isProfileControlled ? (
        <motion.div variants={staggerItem}>
          <Banner
            role="override"
            title={t(`${K}.banner.title`, { profile: profileName })}
            description={t(`${K}.banner.body`)}
          />
        </motion.div>
      ) : null}

      <motion.div variants={staggerItem}>
        <div className="grid grid-cols-1 gap-5 @4xl/main:grid-cols-2">
          <TtlSettingsCard
            value={
              ttlData
                ? {
                    isEnabled: ttlData.isEnabled,
                    ttl: ttlData.ttl,
                    hl: ttlData.hl,
                  }
                : null
            }
            // The profile read gates this card too, and only this one. Until it
            // lands we do not know whether a profile owns TTL, and a card that
            // renders writable and then goes held a beat later has invited a
            // write it is about to refuse.
            isLoading={ttlLoading || profilesLoading}
            isSaving={ttlSaving}
            error={ttlError}
            isProfileControlled={isProfileControlled}
            onApply={saveTtlHl}
          />

          <MtuSettingsCard
            value={
              mtuData
                ? {
                    isEnabled: mtuData.isEnabled,
                    currentValue: mtuData.currentValue,
                  }
                : null
            }
            isLoading={mtuLoading}
            isSaving={mtuSaving}
            error={mtuError}
            onApply={saveMtu}
            onDisable={disableMtu}
          />
        </div>
      </motion.div>
    </motion.div>
  );
};

export default TTLandMTUSettingsComponent;
