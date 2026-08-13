"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";

import { ProfileOverrideAlert } from "@/components/cellular/custom-profiles/profile-override-alert";
import CellularPageHeader from "@/components/cellular/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import type { MaterialSymbolName } from "@/components/ui/material-symbol";
import type { BadgeVariant } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TonalBanner } from "@/components/ui/tonal-banner";
import { useApnSettings } from "@/hooks/use-apn-settings";
import { useMbnSettings } from "@/hooks/use-mbn-settings";
import { useModemStatus } from "@/hooks/use-modem-status";
import { useSimProfiles } from "@/hooks/use-sim-profiles";
import { compressIPv6 } from "@/lib/ipv6";
import { cn } from "@/lib/utils";
import type { ModemStatus } from "@/types/modem-status";
import type { CidContext } from "@/types/apn-settings";

import ApnSettingsCard from "./apn-settings-card";
import MBNCard from "./mbn-card";
import {
  BADGE_GLYPH_SIZE,
  CARD_CELL,
  CARD_PAD,
  CARD_SHELL,
  PAGE_GRID,
  PAGE_ROOT,
  READOUT_ROW,
} from "../shapes";

// =============================================================================
// APN Management — the route shell
// =============================================================================
// Page header, a two-column grid of write surfaces, and one full-width read-only
// strip beneath them. The page arranges cards; it never becomes the canvas.
//
// THREE DATA SOURCES, DELIBERATELY SEPARATE:
//   useApnSettings   the writable APN CGI surface (one read on mount, re-read
//                    around a save)
//   useMbnSettings   the carrier-bundle CGI surface, on its own clock
//   useModemStatus   the read-only poller snapshot (~2s), and the ONLY source
//                    the "What the network granted" strip is allowed to use
//
// The last one is a new dependency for this route. It matters that it is
// separate: the APN card reports what was CONFIGURED, the strip reports what
// the network actually GRANTED, and collapsing them would let a stored value
// masquerade as a negotiated one.
//
// THE OVERRIDE GATE STAYS. When a Custom SIM Profile owns the APN, every
// control on this page is read-only — the profile is the source of truth. The
// gate is a disabled <fieldset> rather than a `disabled` prop threaded through
// every child, and `overrideUndetermined` holds the cards in their loading
// state until the verdict resolves, closing the window where every button is
// live before the lock engages.
//
// The read-only strip sits OUTSIDE that fieldset on purpose. A profile owning
// the APN does not make the network's answer less true, and dimming live truth
// to 60% opacity would be the page hiding the one thing still worth reading.
// =============================================================================

const K = "core_settings.apn";

/** No value to show. Punctuation, not copy — never a plausible-looking default. */
const EM_DASH = "—";

// -----------------------------------------------------------------------------
// The page-header status chip
// -----------------------------------------------------------------------------
// Three states, three glyphs. `success-container` and `warning-container`
// measure 1.03:1 apart and are the same surface under deuteranopia, so the
// glyph is what actually separates "live" from "not live" — they may never
// share one.
//
// The comp also drew a "Read from modem 6 s ago" freshness chip here. It is
// gone by product decision: this page's writable half is not polled, so the
// number would have been counting since a fetch the user cannot see, and a
// freshness claim nobody can act on is noise wearing precision's clothes.

type StatusChip = { variant: BadgeVariant; glyph: MaterialSymbolName; label: string };

function useApnStatusChip(
  active: number | null,
  activeCid: number | null,
  cids: CidContext[] | null,
  storedApn: string,
  isSaving: boolean,
): StatusChip | null {
  const { t } = useTranslation("cellular");

  if (active === null || cids === null) return null;

  if (active === 0) {
    return {
      variant: "muted",
      glyph: "do_not_disturb_on",
      label: t(`${K}.status.carrier_default`),
    };
  }

  const liveCtx =
    activeCid !== null ? cids.find((c) => c.cid === activeCid) : null;
  // An empty live APN is the backend's "couldn't read it" sentinel, not a
  // confirmed value — the compound AT read fails transiently, notably during
  // the COPS settle window right after a save. `||` (not `??`) collapses "" to
  // null so an unreadable APN falls through to "Active" rather than asserting a
  // mismatch the modem never reported.
  const liveApn = liveCtx?.apn || null;
  const matches =
    liveApn !== null &&
    storedApn.trim().toLowerCase() === liveApn.trim().toLowerCase();

  if (!isSaving && liveApn !== null && !matches) {
    return {
      variant: "warning",
      glyph: "warning",
      label: t(`${K}.status.not_live`),
    };
  }

  // `check_circle` is success's glyph in DESIGN.md's functional-four table, and
  // every other success chip in this family already uses it. The Functional-Color
  // Promise is about a user learning one meaning once, so the glyph is not a
  // per-surface choice — an APN-flavoured `public` here would have been the only
  // success chip in the change speaking a different word for the same state.
  // The other two states in this slot keep their own distinct glyphs
  // (`do_not_disturb_on` / `warning`), which is the separation that actually
  // carries meaning: `success-container` and `warning-container` are 1.03:1 apart.
  return {
    variant: "success",
    glyph: "check_circle",
    label: t(`${K}.status.active`),
  };
}

// -----------------------------------------------------------------------------
// What the network granted — the live-truth strip
// -----------------------------------------------------------------------------
// ROWS, NOT TILES. The comp drew this as five `1fr` stat tiles. Two of those
// cells hold a full APN and a full IPv6 (39 chars even after RFC 5952
// compression) — at a fifth of a card each, the two values a technician opened
// this page to read are exactly the two that truncate to noise. A
// label-left/value-right row gives the value the remaining width; see
// `READOUT_ROW.GRID` for the full reasoning.
//
// WHAT WAS REMOVED, AND WHY:
//   "Matches stored"      a badge asserting agreement between a stored value and
//                         a negotiated one. The page header's chip already
//                         reports exactly that, once.
//   "The context asked
//    for IPv4v6 and the
//    network answered…"   a sentence the page cannot derive without knowing
//                         which request produced this answer.
//   "Last APN write"      no such timestamp exists anywhere in the backend — the
//                         sidecar stores {apn, pdp_type, cid, active} and
//                         nothing else. Replaced by the IPv6 row, which is real.
//   "attached · LTE B3"   the band is Radio Information's job, and the dot is a
//                         glue character the No-Dot-Separator Rule forbids.

interface ReadoutRowProps {
  label: string;
  value: string;
  /** Machine string (identifier / address) vs. human-authored label. */
  mono?: boolean;
  /** True when the value is a real reading rather than an em-dash. */
  known: boolean;
  /** Full, untruncated text for the hover/focus tooltip. */
  title?: string;
  className?: string;
}

function ReadoutRow({
  label,
  value,
  mono = false,
  known,
  title,
  className,
}: ReadoutRowProps) {
  return (
    <div className={cn(READOUT_ROW.ROOT, className)}>
      <span className={READOUT_ROW.LABEL}>{label}</span>
      <div className={READOUT_ROW.VALUE_GROUP}>
        <span
          title={title}
          className={cn(
            mono ? READOUT_ROW.VALUE_MONO : READOUT_ROW.VALUE_TEXT,
            !known && "text-on-surface-variant",
          )}
        >
          {value}
        </span>
      </div>
    </div>
  );
}

function NetworkGrantedCard({
  status,
  isLoading,
  error,
}: {
  status: ModemStatus | null;
  isLoading: boolean;
  error: string | null;
}) {
  const { t } = useTranslation("cellular");
  const R = `${K}.readout`;

  if (isLoading && !status) {
    return (
      <Card className={cn(CARD_SHELL)}>
        <CardHeader className={CARD_PAD}>
          <CardTitle>{t(`${R}.title`)}</CardTitle>
          <CardDescription>{t(`${R}.description`)}</CardDescription>
        </CardHeader>
        <CardContent className={CARD_PAD}>
          <div className={READOUT_ROW.GRID}>
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton
                key={index}
                className={cn(
                  READOUT_ROW.HEIGHT,
                  "rounded-pill",
                  index === 4 && "@2xl/card:col-span-2",
                )}
              />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Every value degrades to an em-dash rather than to a plausible default. An
  // empty string from the poller is "we do not know", never "none".
  const network = status?.network;
  const servingApn = network?.apn?.trim() || null;
  const v4 = network?.wan_ipv4?.trim() || null;
  const v6Raw = network?.wan_ipv6?.trim() || null;
  // The modem reports IPv6 as sixteen dot-separated DECIMAL octets via
  // AT+CGCONTRDP. `compressIPv6` pairs them into hex groups and compresses per
  // RFC 5952 — battle-tested, imported, never reimplemented.
  const v6 = v6Raw ? compressIPv6(v6Raw) : null;

  const attached = !!v4 || !!v6;

  const grantedIp = !status
    ? null
    : v4 && v6
      ? t(`${R}.ip_both`)
      : v4
        ? t(`${R}.ip_v4_only`)
        : v6
          ? t(`${R}.ip_v6_only`)
          : t(`${R}.ip_none`);

  return (
    <Card className={cn(CARD_SHELL)}>
      <CardHeader className={CARD_PAD}>
        <CardTitle>{t(`${R}.title`)}</CardTitle>
        <CardDescription>{t(`${R}.description`)}</CardDescription>
      </CardHeader>

      <CardContent className={cn(CARD_PAD, "flex flex-col gap-4")}>
        {error && !status ? (
          <TonalBanner
            tone="destructive"
            icon="error"
            title={t(`${R}.error_title`)}
          >
            {t(`${R}.error_body`)}
          </TonalBanner>
        ) : null}

        <div className={READOUT_ROW.GRID}>
          <ReadoutRow
            label={t(`${R}.serving_apn`)}
            value={servingApn ?? EM_DASH}
            title={servingApn ?? undefined}
            known={!!servingApn}
            mono
          />
          <ReadoutRow
            label={t(`${R}.granted_ip`)}
            value={grantedIp ?? EM_DASH}
            known={!!grantedIp}
          />
          {/* One word. Never "Attached" unconditionally — the state is derived
              from whether an address was actually granted. */}
          <ReadoutRow
            label={t(`${R}.bearer_state`)}
            value={
              status
                ? attached
                  ? t(`${R}.attached`)
                  : t(`${R}.not_attached`)
                : EM_DASH
            }
            known={!!status}
          />
          <ReadoutRow
            label={t(`${R}.ipv4`)}
            value={v4 ?? EM_DASH}
            title={v4 ?? undefined}
            known={!!v4}
            mono
          />
          {/* Full width: a compressed IPv6 still reaches 39 characters, which
              is more than half a card column can hold. `title` keeps the whole
              address recoverable even when the cell truncates. */}
          <ReadoutRow
            className="@2xl/card:col-span-2"
            label={t(`${R}.ipv6`)}
            value={v6 ?? EM_DASH}
            title={v6 ?? undefined}
            known={!!v6}
            mono
          />
        </div>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// The route
// =============================================================================

const APNSettingsComponent = () => {
  const { t } = useTranslation("cellular");

  const {
    apn,
    cids,
    active,
    activeCid,
    isLoading,
    isSaving,
    error,
    save,
    deactivate,
    refresh,
  } = useApnSettings();

  const {
    profiles: mbnProfiles,
    autoSel,
    isLoading: mbnLoading,
    isSaving: mbnSaving,
    error: mbnError,
    saveMbn,
    refresh: refreshMbn,
  } = useMbnSettings();

  const {
    data: status,
    isLoading: statusLoading,
    error: statusError,
  } = useModemStatus();

  const { activeProfileId, isLoading: simLoading, getProfile } = useSimProfiles();

  // --- SIM Profile override check (async) ------------------------------------
  // Gate iff the active profile has a non-empty APN name. An empty APN means
  // the profile does not manage the APN, so the page stays editable.
  const [profileOverride, setProfileOverride] = React.useState<{
    profileId: string;
    name: string;
  } | null>(null);

  // The verdict arrives over TWO sequential fetches: `useSimProfiles` first
  // learns `activeProfileId`, then the effect below fetches that profile's APN.
  // `checkedId` records the profile whose fetch has completed, so render can
  // tell a settled verdict from one still in flight.
  const [checkedId, setCheckedId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (simLoading || !activeProfileId) return;

    let cancelled = false;
    (async () => {
      const profile = await getProfile(activeProfileId);
      if (cancelled) return;

      if (profile && profile.settings.apn.name) {
        setProfileOverride({ profileId: activeProfileId, name: profile.name });
      } else {
        setProfileOverride(null);
      }
      setCheckedId(activeProfileId);
    })();

    return () => {
      cancelled = true;
    };
  }, [activeProfileId, simLoading, getProfile]);

  const isProfileControlled =
    !!activeProfileId && profileOverride?.profileId === activeProfileId;

  const overrideUndetermined =
    simLoading || (!!activeProfileId && checkedId !== activeProfileId);

  const profileName = isProfileControlled
    ? profileOverride.name
    : t(`${K}.managed_by_profile_fallback`);

  const statusChip = useApnStatusChip(
    active,
    activeCid,
    cids,
    apn?.apn ?? "",
    isSaving,
  );

  return (
    <div className={PAGE_ROOT}>
      <CellularPageHeader
        title={t(`${K}.page.title`)}
        description={t(`${K}.page.description`)}
        actions={
          statusChip ? (
            <Badge variant={statusChip.variant}>
              <MaterialSymbol
                name={statusChip.glyph}
                filled
                size={BADGE_GLYPH_SIZE}
              />
              {statusChip.label}
            </Badge>
          ) : null
        }
      />

      {error && !isLoading ? (
        <TonalBanner
          tone="destructive"
          icon="error"
          title={t(`${K}.page.error_load_title`)}
        >
          <span className="flex flex-wrap items-center gap-2">
            {t(`${K}.page.error_load_description`)}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => refresh()}
              className="h-8 rounded-pill px-3 text-xs font-semibold"
            >
              {t("actions.retry", { ns: "common" })}
            </Button>
          </span>
        </TonalBanner>
      ) : null}

      {isProfileControlled ? (
        <ProfileOverrideAlert
          profileName={profileName}
          controls={t(`${K}.controls_label`)}
        />
      ) : null}

      {/* The write surfaces. `pointer-events-none opacity-60` makes the locked
          state obvious while leaving the values readable. */}
      <fieldset
        disabled={isProfileControlled || overrideUndetermined}
        className={cn(
          PAGE_GRID,
          "m-0 border-0 p-0",
          isProfileControlled && "pointer-events-none opacity-60",
        )}
      >
        <div className={CARD_CELL}>
          <ApnSettingsCard
            apn={apn}
            cids={cids}
            active={active}
            activeCid={activeCid}
            isLoading={isLoading || overrideUndetermined}
            isSaving={isSaving}
            onSave={save}
            onDeactivate={deactivate}
          />
        </div>

        <div className={CARD_CELL}>
          <MBNCard
            profiles={mbnProfiles}
            autoSel={autoSel}
            isLoading={mbnLoading || overrideUndetermined}
            isSaving={mbnSaving}
            error={mbnError}
            onSave={saveMbn}
            onRetry={refreshMbn}
          />
        </div>
      </fieldset>

      <NetworkGrantedCard
        status={status}
        isLoading={statusLoading}
        error={statusError}
      />
    </div>
  );
};

export default APNSettingsComponent;
