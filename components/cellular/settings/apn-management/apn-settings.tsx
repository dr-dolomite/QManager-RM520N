"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";

import { ProfileOverrideAlert } from "@/components/cellular/custom-profiles/profile-override-alert";
import CellularPageHeader from "@/components/cellular/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { Skeleton } from "@/components/ui/skeleton";
import { TonalBanner } from "@/components/ui/tonal-banner";
import { useApnSettings } from "@/hooks/use-apn-settings";
import { useMbnSettings } from "@/hooks/use-mbn-settings";
import { useModemStatus } from "@/hooks/use-modem-status";
import { useSimProfiles } from "@/hooks/use-sim-profiles";
import { compressIPv6 } from "@/lib/ipv6";
import { cn } from "@/lib/utils";
import type { ModemStatus } from "@/types/modem-status";

import ApnSettingsCard from "./apn-settings-card";
import MBNCard from "./mbn-card";
import {
  CARD_PAD,
  CARD_SHELL,
  PAGE_ROOT,
  PILL_ACTION,
  READOUT_ROW,
} from "../shapes";

/**
 * Band B and Band C as desktop peers, by explicit product request.
 *
 * This reopens a call the same re-authoring closed a few commits earlier (see
 * the header note above): the two-column `PAGE_GRID` was removed because it
 * force-fit two cards on unrelated clocks into one row, per DESIGN.md's
 * Grid-Step-Costing / "split a page by cadence, not by symmetry". That
 * argument was about the OLD pairing — APN config beside a right-column AMBR
 * reference block with nothing in common. APN config and MBN are a closer
 * match for it: both are write surfaces of comparable weight (a handful of
 * rows plus a save bar), and MBN's own bundle list is height-capped at
 * `CHOICE_ROW.SCROLL_CAP` (17rem) rather than growing unbounded, so the
 * "dead space in whichever card has less to say" failure mode the rule warns
 * about does not reproduce here the way it did for AMBR. Kept page-local
 * rather than promoted to `../shapes` — nothing else on this surface pairs a
 * fieldset-wrapped card with a plain one.
 */
const WRITE_GRID = "grid grid-cols-1 gap-4 @4xl/main:grid-cols-2";

/**
 * Carries the grid row's stretch down into each `Card`, same job as the
 * family's own `CARD_CELL` — but the APN card sits one box deeper, behind the
 * profile-override `<fieldset>`, so `CARD_CELL`'s direct-child selector can't
 * reach it. A descendant selector clears both cells in one class: the
 * `[&>fieldset]` rule is a no-op on the MBN cell, which has no fieldset.
 */
const WRITE_CELL = "h-full [&>fieldset]:h-full [&_[data-slot=card]]:h-full";

// =============================================================================
// APN Management — the route shell
// =============================================================================
// Three full-width bands under the page header. The page arranges bands; it
// never becomes the canvas.
//
// THE ORDER IS THE FAMILY'S GRAMMAR: live state -> what you can change -> the
// commit. It used to run backwards — header, then the write card and MBN side
// by side, then "What the network granted" LAST, so the negotiated truth (the
// only thing here that can answer "is my connection actually dialling the APN I
// think it is") was filed at the bottom behind the heaviest card on the
// surface. `/cellular/settings` ships the correct order and is the reference.
//
//   Band A  What the network granted   poller clock, isStale, the comparison
//   Band B  APN configuration          settings GET, inside the override gate
//   Band C  Carrier bundle (MBN)       its own GET, outside the gate
//
// BAND B AND BAND C SIT SIDE BY SIDE ON DESKTOP, matched to one height by the
// page-local `WRITE_CELL`. `PAGE_GRID` — the OLD two-column grid inherited
// from `/cellular/settings`, whose 1.35fr/1fr ratio was justified by a right
// column ("AMBR + modem reports") this page never had — is still gone, and
// for the reason DESIGN.md gives: SPLIT A PAGE BY CADENCE, NOT BY SYMMETRY.
// That argument was against pairing a write card with a read-only reference
// block on an unrelated clock. B and C are a different pairing: two write
// surfaces of comparable weight, each with its own save bar, and MBN's own
// list is height-capped (`CHOICE_ROW.SCROLL_CAP`) rather than open-ended — so
// side by side does not strand the dead space the rule warns about. See
// `WRITE_GRID` / `WRITE_CELL` below for the mechanics. `PAGE_GRID` itself
// stays exported — `imei-settings.tsx` still consumes it for its own pairing.
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
// THE OVERRIDE GATE STAYS, AND NOW COVERS ONLY WHAT IT GOVERNS. When a Custom
// SIM Profile owns the APN, the APN write surface is read-only — the profile is
// the source of truth. The gate is a disabled <fieldset> rather than a
// `disabled` prop threaded through every child, and `overrideUndetermined`
// holds that card in its loading state until the verdict resolves, closing the
// window where every button is live before the lock engages.
//
// It used to wrap MBN as well. The gate fires on `profile.settings.apn.name`
// being non-empty, so a profile owning the APN disabled the carrier-bundle
// picker — a control no profile manages and which the profile system has
// nothing to say about. MBN is now outside it.
//
// Band A sits outside it too, and always did, on purpose. A profile owning the
// APN does not make the network's answer less true, and dimming live truth to
// 60% opacity would be the page hiding the one thing still worth reading.
// =============================================================================

const K = "core_settings.apn";

/** No value to show. Punctuation, not copy — never a plausible-looking default. */
const EM_DASH = "—";

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

/**
 * The configured-vs-granted pair — the one comparison this page exists to draw,
 * finally drawn where both halves are visible at once.
 *
 * TWO BLOCKS, NOT FIVE TILES, for the same reason `READOUT_ROW.GRID` is not a
 * tile grid: the values are IDENTIFIERS. A block gives an APN the whole width
 * of its half rather than a fifth of a card, and wraps rather than truncating
 * when it still does not fit.
 *
 * THE TINT IS ON THE GRANTED SIDE ONLY. "What you asked for" cannot be right or
 * wrong — it is simply what is stored — so tinting it would spend a functional
 * role on a fact with no verdict attached. The granted block carries the
 * verdict because the granted block IS the verdict.
 *
 * EYEBROW AND PROVENANCE SET NO INK. They sit on three different fills
 * (`surface-container` neutral, `success-container` on agreement,
 * `destructive-container` on disagreement) and dim whatever the block already
 * carries, which is the only spelling that stays correct on all three — the
 * cross-pair (one role's ink on another role's container) is what this family
 * names as its most common contrast failure. Same mechanism as
 * `CHOICE_ROW.CAPTION`.
 *
 * THE VERDICT GLYPH RIDES THE VALUE LINE, not a row of its own below it — the
 * word ("Matches" / "Does not match") was redundant with the block's own fill
 * (`MATCH` / `DRIFT`) once both are visible at once, and dropping that row is
 * what lets `BLOCK` slim down. The glyph alone would fail the fill-is-not-the-
 * only-channel rule (`success-container` and `destructive-container` measure
 * close together and collapse under deuteranopia), so it stays a real glyph —
 * distinct per verdict — beside the value it is a verdict ABOUT, not a second
 * label restating the fill.
 */
const COMPARE = {
  GRID: "grid grid-cols-1 gap-2.5 @2xl/card:grid-cols-2",
  BLOCK: "flex min-w-0 flex-col gap-1 rounded-field p-3.5",
  NEUTRAL: "bg-surface-container text-on-surface",
  MATCH: "bg-success-container text-on-success-container",
  DRIFT: "bg-destructive-container text-on-destructive-container",
  EYEBROW:
    "truncate text-[0.6875rem] font-semibold tracking-[0.02em] opacity-90",
  /** The value line: an optional verdict glyph beside the APN itself. */
  VALUE_ROW: "flex min-w-0 items-center gap-1.5",
  /**
   * An APN is a machine string the device emits verbatim, so `font-mono` (The
   * Machine-Voice Rule). `break-all` rather than `truncate`: a browser will not
   * break at the dots in `internet.talkntext.ph`, and a block with vertical
   * room to spare should spend a second line before it loses characters.
   */
  VALUE:
    "min-w-0 font-mono text-[0.9375rem] font-semibold leading-[1.25] break-all",
  /** No reading. The em-dash is punctuation, so it is dimmed, not coloured. */
  VALUE_UNKNOWN: "opacity-70",
  /** The verdict glyph, sized to sit on the value's own line. */
  MARK_GLYPH: "flex-none",
  MARK_GLYPH_SIZE: 15,
  PROVENANCE: "text-[0.71875rem] leading-relaxed text-pretty opacity-90",
  /**
   * Mirrors BLOCK's resting height for the skeleton: `p-3.5` either side (28) +
   * eyebrow 16 + value 19 + provenance 19 + two `gap-1` (8) = 90px. The glyph
   * rides the value's own line, so it adds no height in either state.
   *
   * THE `!` IS LOAD-BEARING. `cn()` is bare `tailwind-merge`, which does not
   * know this repo's custom radius names and therefore cannot dedupe
   * `rounded-field` against `Skeleton`'s own `rounded-md` — both survive into
   * the class list and the CASCADE decides, alphabetically: `field` sorts
   * before `md`, so the primitive's 6px silently wins and the skeleton stops
   * mirroring the 20px block it stands in for. The important modifier is what
   * takes the radius back. (Product-wide hazard, ~20 call sites; this one is
   * spelled correctly rather than adding a twenty-first.)
   */
  HEIGHT: "h-[5.625rem] rounded-field!",
} as const;

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
  configuredApn,
  isLoading,
  isStale,
  error,
}: {
  status: ModemStatus | null;
  /**
   * The stored APN, from `apn_setting.json` via the settings GET — the left
   * half of the comparison. `null` before the first read, which renders an
   * em-dash and suppresses the verdict rather than comparing against "".
   */
  configuredApn: string | null;
  isLoading: boolean;
  /**
   * The poller has not reported inside its 10 s threshold.
   *
   * THIS BAND WAS THE ONLY POLLER-FED SURFACE IN THE FAMILY THAT COULD NOT SAY
   * IT HAD STALLED. `useModemStatus` has always exported `isStale`; this card
   * took `{ status, isLoading, error }` and never received it, so a frozen
   * poller rendered identically to a live one. The family's own poller band
   * (`live-state-strip.tsx`) names why that matters: "Staleness means the
   * figures below are FROZEN while still looking current, which is the one
   * moment this band can mislead."
   *
   * Only the WARNING half. There is no "live" chip and no elapsed-seconds
   * counter — the counter was refuted, and a pill saying "live" over values
   * that are simply correct reports nothing.
   */
  isStale: boolean;
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
        <CardContent className={cn(CARD_PAD, "flex flex-col gap-4")}>
          {/* Geometry MIRRORED from the shape constants, comparison pair
              included — the skeleton and the loaded band read the same
              numbers, never two copies of them. */}
          <div className={COMPARE.GRID}>
            {Array.from({ length: 2 }).map((_, index) => (
              <Skeleton key={index} className={COMPARE.HEIGHT} />
            ))}
          </div>
          <div className={READOUT_ROW.GRID}>
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className={READOUT_ROW.HEIGHT} />
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

  // The comparison. Case-folded, matching the backend's own `tr 'A-Z' 'a-z'`:
  // APNs are DNS-style labels and case-insensitive per 3GPP, and a live device
  // negotiated `INTERNET.GLOBE.COM.PH` for a stored `internet`.
  //
  // A verdict needs BOTH halves. With either side missing the granted block
  // stays neutral and shows no mark — "we could not compare" is a third answer,
  // not a quiet failure of the comparison.
  const configured = configuredApn?.trim() || null;
  const comparable = configured !== null && servingApn !== null;
  const grantedMatches =
    comparable && configured.toLowerCase() === servingApn.toLowerCase();

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

        {/* Frozen, not absent. A failed read has no values at all and takes the
            banner above; this is the harder case — every figure below is still
            drawn, still looks current, and may no longer be true. The `warning`
            role and the `schedule` glyph match the family's poller band so a
            user meets one signal, not two. */}
        {isStale && status ? (
          <TonalBanner
            tone="warning"
            icon="schedule"
            title={t(`${R}.stale`)}
          >
            {t(`${R}.stale_body`)}
          </TonalBanner>
        ) : null}

        {/* The comparison pair. The APN no longer appears as a readout row
            below — it is one fact, and stating it twice on one band is what
            this re-authoring set out to stop. */}
        <div className={COMPARE.GRID}>
          <div className={cn(COMPARE.BLOCK, COMPARE.NEUTRAL)}>
            <span className={COMPARE.EYEBROW}>
              {t(`${R}.configured_label`)}
            </span>
            <span className={COMPARE.VALUE_ROW}>
              <span
                className={cn(COMPARE.VALUE, !configured && COMPARE.VALUE_UNKNOWN)}
              >
                {configured ?? EM_DASH}
              </span>
            </span>
            <span className={COMPARE.PROVENANCE}>{t(`${R}.source_stored`)}</span>
          </div>

          <div
            className={cn(
              COMPARE.BLOCK,
              !comparable
                ? COMPARE.NEUTRAL
                : grantedMatches
                  ? COMPARE.MATCH
                  : COMPARE.DRIFT,
            )}
          >
            <span className={COMPARE.EYEBROW}>{t(`${R}.granted_label`)}</span>
            <span className={COMPARE.VALUE_ROW}>
              {comparable ? (
                <MaterialSymbol
                  name={grantedMatches ? "check_circle" : "warning"}
                  filled
                  size={COMPARE.MARK_GLYPH_SIZE}
                  className={COMPARE.MARK_GLYPH}
                />
              ) : null}
              <span
                className={cn(COMPARE.VALUE, !servingApn && COMPARE.VALUE_UNKNOWN)}
              >
                {servingApn ?? EM_DASH}
              </span>
            </span>
            <span className={COMPARE.PROVENANCE}>
              {t(`${R}.source_negotiated`)}
            </span>
          </div>
        </div>

        <div className={READOUT_ROW.GRID}>
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
          {/* Beside IPv4, not full width. A RAW IPv6 reaches 39 characters, but
              `compressIPv6` (RFC 5952) has already run by the time this value
              arrives — a real granted address compresses to roughly half that,
              and fits the half-card column the same way IPv4 does. `title`
              keeps the untruncated address recoverable on the rare address
              that still doesn't. */}
          <ReadoutRow
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
    isReconciling,
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
    isStale: statusStale,
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

  return (
    <div className={PAGE_ROOT}>
      <CellularPageHeader
        title={t(`${K}.page.title`)}
        description={t(`${K}.page.description`)}
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

      {/* Band A — what the network GRANTED, on the poller's clock. It leads the
          page because it is the only thing on the surface that can answer "is
          my connection actually dialling the APN I think it is", and it used to
          be filed last, behind the heaviest card here. It also sits outside the
          fieldset below: a profile owning the APN does not make the network's
          answer less true, and dimming live truth to 60% would be the page
          hiding the one thing still worth reading. */}
      <NetworkGrantedCard status={status} isStale={statusStale} isLoading={statusLoading} error={statusError} configuredApn={apn?.apn ?? null} />

      <div className={WRITE_GRID}>
        {/* Band B — what you can CHANGE, on the settings GET's clock. The only
            thing a SIM profile can own, and therefore the only thing inside
            the override fieldset. `pointer-events-none opacity-60` makes the
            locked state obvious while leaving the values readable. */}
        <div className={WRITE_CELL}>
          <fieldset
            disabled={isProfileControlled || overrideUndetermined}
            className={cn(
              "m-0 border-0 p-0",
              isProfileControlled && "pointer-events-none opacity-60",
            )}
          >
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
          </fieldset>
        </div>

        {/* Band C — the carrier bundle, on its own GET's clock and behind a
            reboot. OUTSIDE the fieldset: the gate fires on
            `profile.settings.apn.name`, and no SIM profile manages MBN bundle
            selection, so a profile owning the APN was locking a control it
            has nothing to say about. */}
        <div className={WRITE_CELL}>
          <MBNCard
            profiles={mbnProfiles}
            autoSel={autoSel}
            isLoading={mbnLoading}
            isSaving={mbnSaving}
            error={mbnError}
            onSave={saveMbn}
            onRetry={refreshMbn}
          />
        </div>
      </div>

      {/* The resting re-read. `refresh` was wired but reachable ONLY from
          inside the error banner, so the affordance existed exactly when the
          page had already failed. Hidden while a write is in flight — the
          card's own save bar owns that moment, and two status lines would
          contradict each other. The poller feeding Band A re-reads itself. */}
      {!isLoading && !isSaving && !isReconciling ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              refresh();
              refreshMbn();
            }}
            className={PILL_ACTION}
          >
            <MaterialSymbol name="refresh" size={17} />
            {t(`${K}.readout.reread`)}
          </Button>
        </div>
      ) : null}
    </div>
  );
};

export default APNSettingsComponent;
