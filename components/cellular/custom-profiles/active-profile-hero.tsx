"use client";

import * as React from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import type { MaterialSymbolName } from "@/components/ui/material-symbol";
import { Skeleton } from "@/components/ui/skeleton";
import { Tag } from "@/components/ui/tag";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { ConnectionScenario } from "@/types/connection-scenario";
import type { ProfileApplyState, SimProfile } from "@/types/sim-profile";

import { resolveScenarioIcon } from "./connection-scenarios/scenario-icons";
import { modeLabel } from "./scenario-labels";
import {
  BADGE_GLYPH_SIZE,
  HERO_CARD,
  HERO_DISC,
  HERO_DISC_TONE,
  HERO_EYEBROW,
  HERO_NAME,
  HERO_NOTICE,
  HERO_NOTICE_BODY,
  HERO_NOTICE_DISC,
  HERO_NOTICE_TITLE,
  HERO_NOTICE_TONE,
  HERO_TILE_BODY,
  HERO_TILE_DISC_BRAND,
  HERO_TILE_DISC_NEUTRAL,
  HERO_TILE_SHAPE,
  HERO_TOP,
  MACHINE_VALUE,
  PILL_ACTION_SM,
  PROFILE_STATUS_BADGE,
} from "./shapes";

// =============================================================================
// The "in force now" hero
// =============================================================================
// The page's anchor card, and the only `rounded-hero` on this surface. It
// answers the question the user arrived with — WHAT IS RUNNING ON MY MODEM
// RIGHT NOW — before the list of things they could run instead. Everything it
// renders is DERIVED from real state; there is no `showMismatchNotice` prop,
// because a notice driven by a boolean the caller passes in is a notice that
// can be wrong while looking right.
//
// -----------------------------------------------------------------------------
// WHAT THE 2026-08-21 REDESIGN CHANGED HERE
// -----------------------------------------------------------------------------
// 1. THE SCHEDULE LEFT. The 24-hour ribbon used to be a band at the bottom of
//    this card, competing with three tiles and two buttons for the same ~400px,
//    where a 20-minute block resolved to about eight pixels. It is now its own
//    PEER card directly below (`ScheduleTodayCard` in `schedule-ribbon.tsx`),
//    given the full page width. This card therefore no longer builds a
//    timeline, and no longer takes `now` or the scenario list for one.
//
// 2. THE TILE BODIES WENT NEUTRAL. The scenario tile used to paint 104px of
//    `--primary-container` — the Container layer at four times its sanctioned
//    size — to say "this profile owns a scenario". All three bodies are now
//    `HERO_TILE_BODY`, and the scenario tile marks itself with a `bg-primary`
//    DISC instead: the smaller claim and the more legible one.
//
// 3. THE FILLED CONFIG PILLS BECAME OUTLINE TAGS. An APN, a PDP type, a CID, a
//    band number are IDENTITY, not status, so under the Two-Form Rule they are
//    `Tag`s and never `Badge`s. `CONFIG_PILL*` is gone from `shapes.ts`.
//
// 4. THE NOTICE GREW A GLYPH DISC. A glyph floating loose on a pale container
//    is the construction the Glyph-Disc Rule replaces: the icon now sits in a
//    32px disc painted with the role's STRONG fill, which is what makes a
//    degraded state findable at a glance and legible under deuteranopia, where
//    `warning-container` and `primary-container` are near-identical surfaces.
//
// NOTICE PRIORITY IS UNCHANGED, deliberately: applying → partial → mismatch, at
// most one. An apply in flight is the most current fact on the card and the
// only one still changing; a partial apply is a finished event the user must
// act on; a SIM mismatch is a standing condition the identity line's own badge
// already announces. Stacking all three would push the tiles — the card's
// actual subject — below the fold on a tablet.
//
// GLYPHS. Every name below is already in `MATERIAL_SYMBOL_NAMES`; nothing here
// needed the subset regenerated. The disc, the notice and the status chip each
// carry a DISTINCT glyph per condition, because those three slots each show one
// of several states and colour alone cannot separate them.
// =============================================================================

/**
 * What the hero is reporting. Keyed onto `HERO_DISC_TONE`, so a sixth condition
 * without a matching disc fill fails the build rather than rendering untinted.
 */
type HeroCondition = "live" | "applying" | "partial" | "mismatch";

/**
 * The leading disc's glyph, per condition. NOT one `sim_card` re-tinted four
 * ways: the disc is the largest coloured object on the card, so it is the first
 * thing read, and a colour-only difference is exactly the signal a colourblind
 * user cannot recover.
 */
const HERO_DISC_GLYPH: Record<HeroCondition, MaterialSymbolName> = {
  live: "sim_card",
  applying: "progress_activity",
  partial: "warning",
  mismatch: "swap_horiz",
};

/**
 * Which status chip names the condition in words, beside the disc's colour, and
 * the i18n key that labels it.
 *
 * The label key is written out LITERALLY rather than assembled as
 * `` t(`…badge.${condition}`) ``: `bun run i18n:check` walks the source for
 * `t("…")` string literals, so a template key is invisible to it and a locale
 * that dropped one of these four would ship as a raw key on a modem in the
 * field instead of failing the gate.
 */
const HERO_CONDITION_BADGE: Record<
  HeroCondition,
  { status: keyof typeof PROFILE_STATUS_BADGE; labelKey: string }
> = {
  live: { status: "active", labelKey: "custom_profiles.hero.badge.live" },
  applying: {
    status: "applying",
    labelKey: "custom_profiles.hero.badge.applying",
  },
  // `partial` is its own member of `PROFILE_STATUS_BADGE` rather than borrowing
  // `failed`: a partial apply is degraded, not dead, and the notice rendered
  // directly beneath this chip is `warning`-toned — a `destructive` chip over a
  // `warning` banner reads as two different verdicts on one condition. It shares
  // `warning` with `mismatch` and is separated from it by glyph (`warning` vs
  // `swap_horiz`), which is the only channel a deuteranopic user has.
  partial: { status: "partial", labelKey: "custom_profiles.hero.badge.partial" },
  mismatch: {
    status: "mismatch",
    labelKey: "custom_profiles.hero.badge.mismatch",
  },
};

/**
 * PDP type → an existing human label. The device emits `IPV4V6`; the product
 * has said `IPv4v6` since the pills existed, and re-typing the raw token in
 * mono beside a friendly APN reads as an unformatted leak rather than as
 * machine voice.
 */
const PDP_LABEL_KEY: Record<string, string> = {
  IPV4: "custom_profiles.pills.ip_v4",
  IPV6: "custom_profiles.pills.ip_v6",
  IPV4V6: "custom_profiles.pills.ip_dual",
};

/**
 * How many band tags the Radio tile shows before it collapses the rest into a
 * `+N` overflow tag. Six is two rows at the tile's width; past that the strip
 * stops being a glance and starts being a list, which is what the scenario's
 * own card is for.
 */
const BAND_TAG_CAP = 6;

/** Colon-delimited storage → a de-duplicated, numerically sorted band list. */
function splitBands(...lists: string[]): string[] {
  const merged = lists
    .flatMap((l) => l.split(":"))
    .map((b) => b.trim())
    .filter(Boolean);
  return Array.from(new Set(merged)).sort((a, b) => Number(a) - Number(b));
}

export interface ActiveProfileHeroProps {
  /** The profile currently in force. */
  profile: SimProfile;
  /** The scenario actually in force, when it is known. */
  activeScenario: ConnectionScenario | null;
  /** Live apply lifecycle, or null when nothing has been applied this boot. */
  applyState: ProfileApplyState | null;
  /** ICCID read off the inserted SIM. Null while unknown — never a mismatch. */
  currentIccid: string | null;
  /**
   * A mutation the modem is still working through — a deactivate round trip or
   * an apply in flight. Both of the card's actions go dead while it is true.
   *
   * This is not cosmetic. Deactivate is a blocking 8-12s attach cycle and apply
   * is a four-step worker; firing a second mutation into a modem that is
   * mid-`AT+COPS` either collides with the APN lock (a wasted `apn_busy`) or
   * queues a second detach behind the first. The card cannot know this on its
   * own — it is 100% props and fetches nothing — so the coordinator tells it.
   */
  busy?: boolean;
  onEdit: () => void;
  onDeactivate: () => void;
  /**
   * Re-run the whole four-step apply for THIS profile. Optional: omit it and the
   * partial notice renders with no action, exactly as before.
   *
   * The backend can only re-run all four steps or none — there is no per-step
   * endpoint — so this is "Reapply profile", never a per-step retry.
   *
   * It exists because closing the apply-progress dialog on a `partial` verdict
   * used to STRAND the recovery: `showApplyProgress` cannot be re-set from here,
   * so the hero was left naming a failed step with the only route back to it
   * buried in a row's overflow menu, one card further down the page.
   */
  onReapply?: () => void;
}

export function ActiveProfileHero({
  profile,
  activeScenario,
  applyState,
  currentIccid,
  busy = false,
  onEdit,
  onDeactivate,
  onReapply,
}: ActiveProfileHeroProps) {
  const { t } = useTranslation("cellular");

  const { settings, scenario: binding } = profile;
  const schedule = binding.schedule;

  // --- Derived state --------------------------------------------------------
  // A mismatch needs BOTH sides known. A profile saved without an ICCID, or a
  // SIM whose ICCID has not been read yet, is not a mismatch — it is an absence
  // of evidence, and warning on it would train the user to ignore the notice.
  const isMismatch =
    Boolean(profile.sim_iccid) &&
    Boolean(currentIccid) &&
    profile.sim_iccid !== currentIccid;

  // THE APPLY STATE IS SCOPED TO *THIS* PROFILE BEFORE ANYTHING READS IT.
  //
  // `applyState` is the coordinator's ONE in-flight apply, whichever profile it
  // belongs to — it is not this card's apply. Activate B while A is in force and
  // the hero is still showing A (the list is not refreshed until
  // `handleApplyProgressClose` runs), so an unscoped read painted A's identity
  // line with the "Applying" chip and the spinning disc while the notice
  // directly beneath it interpolated B's NAME: one card, two disagreeing claims
  // about what the modem is doing. The `partial` case did not even expire —
  // `handleApplyProgressClose` deliberately never resets `applyState`, so if the
  // follow-up `refresh()` lost a race with AT-lock contention, a warning about
  // B's failed step stayed pinned to A's name until the next activation.
  //
  // This is the guard every other consumer on the page already applies: the list
  // row scopes the identical read on `profile_id` before deriving its own
  // `audit` / `busy`. It is also this file's stated principle enforced one level
  // deeper. The header above refuses a `showMismatchNotice` prop because "a
  // notice driven by a boolean the caller passes in is a notice that can be
  // wrong while looking right" — an UNSCOPED `applyState` is that same boolean
  // wearing a struct's clothes, since the caller's choice of WHICH apply to pass
  // silently decides whose verdict this card announces. Narrowing it once, here,
  // and reading only `selfApply` below is what makes a borrowed verdict
  // unrepresentable rather than merely unlikely.
  const selfApply =
    applyState && applyState.profile_id === profile.id ? applyState : null;

  const isApplying = selfApply?.status === "applying";
  const isPartial = selfApply?.status === "partial";

  const condition: HeroCondition = isApplying
    ? "applying"
    : isPartial
      ? "partial"
      : isMismatch
        ? "mismatch"
        : "live";

  const applyingStep = isApplying
    ? selfApply?.steps[(selfApply.current_step ?? 1) - 1]
    : undefined;
  const failedStep = isPartial
    ? selfApply?.steps.find((s) => s.status === "failed")
    : undefined;

  const badgeSpec = HERO_CONDITION_BADGE[condition];
  const badge = PROFILE_STATUS_BADGE[badgeSpec.status];
  const badgeLabel = t(badgeSpec.labelKey);

  const scenarioLabel =
    activeScenario?.name ?? t("custom_profiles.hero.scenario.unknown");
  const scenarioGlyph = resolveScenarioIcon(activeScenario?.icon);

  const apnLabel =
    settings.apn.name || t("custom_profiles.pills.apn_default");
  const pdpKey = PDP_LABEL_KEY[settings.apn.pdp_type];
  const pdpLabel = pdpKey ? t(pdpKey) : settings.apn.pdp_type;

  // The Radio tile reports ONE band strip, but a scenario stores LTE, NSA-NR
  // and SA-NR lists separately. NSA and SA are merged rather than one being
  // picked: showing only `sa_nr_bands` would silently under-report a profile
  // that locks NSA.
  const { lteBands, nrBands } = React.useMemo(() => {
    const cfg = activeScenario?.config;
    if (!cfg) return { lteBands: [], nrBands: [] };
    return {
      lteBands: splitBands(cfg.lte_bands),
      nrBands: splitBands(cfg.nsa_nr_bands, cfg.sa_nr_bands),
    };
  }, [activeScenario]);

  const totalBands = lteBands.length + nrBands.length;
  const lteShown = lteBands.slice(0, BAND_TAG_CAP);
  const nrShown = nrBands.slice(0, Math.max(0, BAND_TAG_CAP - lteShown.length));
  const overflowBands = totalBands - lteShown.length - nrShown.length;

  return (
    // `initial`/`animate` are stated EXPLICITLY here rather than inherited, and
    // that is load-bearing — without them this card renders completely blank
    // every time it mounts on a SWAP rather than on first paint.
    //
    // Why. A motion element with only `variants` is a passive variant CHILD: it
    // waits for its parent's cascade to propagate instead of animating itself.
    // Motion decides which of the two it is from `manuallyAnimateOnMount =
    // Boolean(parent && parent.current)` — i.e. "was my parent already in the
    // DOM when I was constructed?". This card's parent is the `key="hero-active"`
    // swap wrapper in `custom-profile.tsx`, which is created in the SAME render
    // pass, so its `current` is still null and the answer is no. The card
    // therefore waited on the page-level cascade — which ran once, on page load,
    // and never runs again — and every `staggerItem` below sat at `hidden`
    // (`opacity: 0`) indefinitely. Opacity-0 children still occupy layout, so the
    // symptom was a full-height hero-shaped hole, not a missing card.
    //
    // Declaring the labels makes this a variant-CONTROLLING node: it animates
    // itself on every mount and orchestrates its own children's stagger. First
    // paint is unchanged — the page's `<AnimatePresence initial={false}>` still
    // blocks the initial animation there.
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      className={HERO_CARD}
    >
      {/* --- Identity line ---------------------------------------------- */}
      <motion.div variants={staggerItem} className={HERO_TOP}>
        <span className={cn(HERO_DISC, HERO_DISC_TONE[condition])}>
          <MaterialSymbol
            name={HERO_DISC_GLYPH[condition]}
            size={26}
            filled={condition !== "applying"}
            className={
              condition === "applying"
                ? "motion-safe:animate-spin"
                : undefined
            }
            aria-hidden
          />
        </span>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className={HERO_EYEBROW}>
            {t("custom_profiles.hero.eyebrow")}
          </span>
          <span className={HERO_NAME}>{profile.name}</span>
          {/* The carrier and the ICCID: the two facts the name alone cannot
              carry. Separated by layout, never by a middot — a glue character
              belongs to a machine-voice run, and this line is half prose. */}
          <span className="text-on-surface-variant flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[0.8125rem]">
            <span className="min-w-0 truncate">
              {profile.mno || t("custom_profiles.hero.unknown_operator")}
            </span>
            {profile.sim_iccid ? (
              <span className={cn(MACHINE_VALUE, "min-w-0 truncate text-xs")}>
                {t("custom_profiles.hero.iccid", { value: profile.sim_iccid })}
              </span>
            ) : null}
          </span>
        </div>

        <div className="ms-auto flex flex-none flex-wrap items-center gap-2">
          <Badge variant={badge.variant}>
            <MaterialSymbol
              name={badge.glyph}
              size={BADGE_GLYPH_SIZE}
              filled={!badge.spin}
              className={badge.spin ? "motion-safe:animate-spin" : undefined}
              aria-hidden
            />
            {badgeLabel}
          </Badge>
          {/* Both actions go dead while the modem is mid-mutation. Editing is
              disabled too, not just Deactivate: saving an ACTIVE profile now
              auto-reapplies it, so Edit is a modem mutation as well. */}
          <Button
            variant="ghost"
            className={PILL_ACTION_SM}
            onClick={onEdit}
            disabled={busy}
          >
            <MaterialSymbol name="edit" size={16} aria-hidden />
            {t("custom_profiles.hero.edit")}
          </Button>
          <Button
            variant="ghost"
            className={PILL_ACTION_SM}
            onClick={onDeactivate}
            disabled={busy}
          >
            <MaterialSymbol name="power_settings_new" size={16} aria-hidden />
            {t("custom_profiles.hero.deactivate")}
          </Button>
        </div>
      </motion.div>

      {/* --- One notice, at most ---------------------------------------- */}
      {condition === "applying" ? (
        <HeroNotice
          kind="applying"
          live
          title={t("custom_profiles.hero.notice.applying_title", {
            name: selfApply?.profile_name || profile.name,
          })}
          body={t("custom_profiles.hero.notice.applying_body", {
            step: selfApply?.current_step ?? 1,
            total: selfApply?.total_steps ?? 1,
          })}
          machine={applyingStep?.name}
        />
      ) : condition === "partial" ? (
        <HeroNotice
          kind="partial"
          title={t("custom_profiles.hero.notice.partial_title")}
          body={t("custom_profiles.hero.notice.partial_body", {
            step:
              failedStep?.name ??
              t("custom_profiles.hero.notice.unknown_step"),
          })}
          machine={failedStep?.detail || selfApply?.error || undefined}
          // The action lives WITH its explanation, not in the identity line's
          // button row. That row is Edit + Deactivate at `gap-2`, and Deactivate
          // drops the data link for 8-12s; a third identically-weighted pill
          // beside it that also fires a full four-step modem mutation would read
          // as one more routine control rather than as the answer to the
          // sentence above it. Rendered only when a caller actually supplied a
          // handler — see `onReapply`.
          action={
            onReapply ? (
              <Button
                variant="tonal-neutral"
                className={PILL_ACTION_SM}
                onClick={onReapply}
                disabled={busy}
              >
                <MaterialSymbol name="restart_alt" size={16} aria-hidden />
                {t("custom_profiles.hero.reapply")}
              </Button>
            ) : undefined
          }
        />
      ) : condition === "mismatch" ? (
        <HeroNotice
          kind="mismatch"
          title={t("custom_profiles.hero.notice.mismatch_title")}
          body={t("custom_profiles.hero.notice.mismatch_body")}
          machine={currentIccid ?? undefined}
        />
      ) : null}

      {/* --- The three tiles -------------------------------------------- */}
      {/* THE BODY IS NEUTRAL, THE DISC CARRIES THE COLOUR. All three read
          `HERO_TILE_BODY`; only the scenario tile's disc goes brand. */}
      <motion.div variants={staggerItem} className={HERO_TILE_SHAPE.GRID}>
        {/* Identity — what this profile pins to the SIM. */}
        <div className={cn(HERO_TILE_SHAPE.ROOT, HERO_TILE_BODY)}>
          <span className={cn(HERO_TILE_SHAPE.DISC, HERO_TILE_DISC_NEUTRAL)}>
            <MaterialSymbol name="dns" size={25} aria-hidden />
          </span>
          <span className={HERO_TILE_SHAPE.COL}>
            <span className={HERO_EYEBROW}>
              {t("custom_profiles.hero.tiles.identity")}
            </span>
            <span className={cn(HERO_TILE_SHAPE.VALUE, MACHINE_VALUE)}>
              {apnLabel}
            </span>
            <span className={HERO_TILE_SHAPE.TAGS}>
              <Tag variant="neutral">{pdpLabel}</Tag>
              {settings.apn.cid > 0 ? (
                <Tag variant="neutral" className={MACHINE_VALUE}>
                  {t("custom_profiles.pills.cid", { cid: settings.apn.cid })}
                </Tag>
              ) : null}
              {/* A 0 TTL/HL means "don't set", so the tag is omitted rather
                  than printing "TTL 0", which reads as a configured zero. */}
              {settings.ttl > 0 ? (
                <Tag variant="neutral" className={MACHINE_VALUE}>
                  {t("custom_profiles.pills.ttl", { value: settings.ttl })}
                </Tag>
              ) : null}
              {settings.hl > 0 ? (
                <Tag variant="neutral" className={MACHINE_VALUE}>
                  {t("custom_profiles.pills.hl", { value: settings.hl })}
                </Tag>
              ) : null}
              {/* An IMEI override changes the identity the NETWORK sees, which
                  is the single most consequential thing a profile can carry and
                  the one a user is most likely to have forgotten is set. It is
                  a `Tag`, not a `Badge`: it says what this profile IS, not
                  whether it is healthy (the Two-Form Rule). */}
              {settings.imei.trim() !== "" ? (
                <Tag variant="neutral">
                  <MaterialSymbol
                    name="fingerprint"
                    size={BADGE_GLYPH_SIZE}
                    aria-hidden
                  />
                  {t("custom_profiles.hero.tiles.imei_override")}
                </Tag>
              ) : null}
            </span>
          </span>
        </div>

        {/* Scenario in force — the one brand disc on the strip. */}
        <div className={cn(HERO_TILE_SHAPE.ROOT, HERO_TILE_BODY)}>
          <span className={cn(HERO_TILE_SHAPE.DISC, HERO_TILE_DISC_BRAND)}>
            <MaterialSymbol name={scenarioGlyph} size={25} filled aria-hidden />
          </span>
          <span className={HERO_TILE_SHAPE.COL}>
            <span className={HERO_EYEBROW}>
              {t("custom_profiles.hero.tiles.scenario")}
            </span>
            <span className={HERO_TILE_SHAPE.VALUE}>{scenarioLabel}</span>
            {schedule.enabled && schedule.blocks.length > 0 ? (
              <span className={HERO_TILE_SHAPE.TAGS}>
                <Tag variant="neutral">
                  <MaterialSymbol
                    name="schedule"
                    size={BADGE_GLYPH_SIZE}
                    aria-hidden
                  />
                  {t("custom_profiles.hero.tiles.scheduled")}
                </Tag>
              </span>
            ) : null}
          </span>
        </div>

        {/* Radio, owned by the scenario. */}
        <div className={cn(HERO_TILE_SHAPE.ROOT, HERO_TILE_BODY)}>
          <span className={cn(HERO_TILE_SHAPE.DISC, HERO_TILE_DISC_NEUTRAL)}>
            <MaterialSymbol name="cell_tower" size={25} aria-hidden />
          </span>
          <span className={HERO_TILE_SHAPE.COL}>
            {/* The one tile whose eyebrow carries an affordance: it reports a
                lock the user cannot change from here, and the page it changes
                it on is two clicks away in the sidebar.

                THE HREF IS `cell-locking`, NOT `band-locking`. The pre-redesign
                hero linked `/cellular/band-locking`, which is not a route —
                `app/cellular/` has `cell-locking/`, and on a STATIC EXPORT a
                missing route is a hard 404 off the modem's lighttpd, not a
                soft client-side miss. The label key is unchanged; only the
                destination is corrected. */}
            <span className="flex min-w-0 items-baseline gap-2">
              <span className={cn(HERO_EYEBROW, "min-w-0 truncate")}>
                {t("custom_profiles.hero.tiles.radio")}
              </span>
              <Link
                href="/cellular/cell-locking"
                className="text-primary flex-none text-xs font-medium hover:underline"
              >
                {t("custom_profiles.hero.tiles.band_locking")}
              </Link>
            </span>
            <span className={HERO_TILE_SHAPE.TAGS}>
              {/* The network mode names both radios in one string, so it has no
                  honest identity hue of its own — the Neutral-Default Rule. */}
              <Tag variant="neutral">
                {activeScenario
                  ? modeLabel(t, activeScenario.config.atModeValue)
                  : "—"}
              </Tag>
              {lteShown.map((b) => (
                <Tag key={`lte-${b}`} variant="lte" className={MACHINE_VALUE}>
                  B{b}
                </Tag>
              ))}
              {nrShown.map((b) => (
                <Tag key={`nr-${b}`} variant="nr" className={MACHINE_VALUE}>
                  n{b}
                </Tag>
              ))}
              {overflowBands > 0 ? (
                <Tag variant="neutral" className={MACHINE_VALUE}>
                  +{overflowBands}
                </Tag>
              ) : null}
              {activeScenario && totalBands === 0 ? (
                <Tag variant="neutral">
                  {t("custom_profiles.hero.tiles.bands_auto")}
                </Tag>
              ) : null}
            </span>
          </span>
        </div>
      </motion.div>
    </motion.div>
  );
}

/**
 * One hero notice.
 *
 * The glyph sits in a 32px disc painted with the role's STRONG fill rather than
 * floating loose on the pale container — the Glyph-Disc Rule. On
 * `warning-container` a `text-on-warning-container` glyph is the same weight as
 * the sentence beside it, so the notice reads as a paragraph; the filled disc
 * is what makes it read as a state.
 *
 * `machine` is the backend's own words — the AT step name, the `+CME ERROR:`
 * payload, the ICCID actually in the tray — and gets its own line in the mono
 * face rather than being interpolated into the prose. That keeps the sentence a
 * single translatable unit AND keeps the identifier in machine voice, which no
 * flat `{{value}}` interpolation can do at once.
 *
 * `action` is the one affordance a notice may carry, and it sits at the FOOT OF
 * THE TEXT COLUMN rather than as a trailing flex sibling. A right-aligned button
 * on a `items-start` row would sit level with the title and read as a control
 * for the whole card; under the sentence it reads as the answer to it. It also
 * survives the narrow container, where a trailing sibling would squeeze the
 * prose it is supposed to be secondary to.
 */
function HeroNotice({
  kind,
  title,
  body,
  machine,
  action,
  live = false,
}: {
  kind: keyof typeof HERO_NOTICE_TONE;
  title: string;
  body: string;
  machine?: string;
  /**
   * An optional recovery affordance. Deliberately `tonal-neutral` at the call
   * site: the notice is already a container pair, so a second ROLE container
   * inside it would put two tonal fills on one banner, and a `default` (brand
   * fill) button would out-weigh the hero's own actions from inside a warning.
   * A neutral raised pill is legibly an affordance and legibly not the primary.
   */
  action?: React.ReactNode;
  /** Only the in-flight apply announces itself; a standing condition does not. */
  live?: boolean;
}) {
  const tone = HERO_NOTICE_TONE[kind];
  return (
    <motion.div
      variants={staggerItem}
      role="status"
      aria-live={live ? "polite" : "off"}
      className={cn(HERO_NOTICE, tone.fill)}
    >
      <span className={cn(HERO_NOTICE_DISC, tone.disc)}>
        <MaterialSymbol
          name={tone.glyph}
          size={17}
          filled={!tone.spin}
          className={tone.spin ? "motion-safe:animate-spin" : undefined}
          aria-hidden
        />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className={HERO_NOTICE_TITLE}>{title}</span>
        <span className={HERO_NOTICE_BODY}>{body}</span>
        {machine ? (
          <span className={cn(MACHINE_VALUE, "mt-1 text-xs break-words")}>
            {machine}
          </span>
        ) : null}
        {action ? <div className="mt-2.5 flex">{action}</div> : null}
      </div>
    </motion.div>
  );
}

/**
 * The hero's loading state.
 *
 * Every geometry it mirrors is IMPORTED — `HERO_CARD`, `HERO_TOP`, `HERO_DISC`,
 * `HERO_TILE_SHAPE.GRID`/`.ROOT`/`.COL`/`.DISC` — so retuning the hero retunes
 * its skeleton in the same edit (the Skeleton-Mirror Rule). Only the placeholder
 * BAR lengths are literal, because a bar length mirrors a string that does not
 * exist yet and has no constant to import.
 *
 * All three tiles render `HERO_TILE_SHAPE.ROOT`, which is a 104px FLOOR rather
 * than a pin (see the constant). A skeleton carries no wrapping tag rows, so it
 * sits exactly at that floor — which is the honest mirror: the loaded strip is
 * at least this tall, and the skeleton says so without pretending to know how
 * many tags are about to arrive.
 *
 * `bg-accent` is appended after each imported constant on purpose: `cn` is
 * tailwind-merge, so the later background wins over the constant's own fill
 * while every dimension in it survives.
 */
export function ActiveProfileHeroSkeleton() {
  return (
    <div className={HERO_CARD}>
      <div className={HERO_TOP}>
        <Skeleton className={cn(HERO_DISC, "bg-accent")} />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Skeleton className="h-3 w-24 rounded-pill" />
          <Skeleton className="h-6 w-56 rounded-pill" />
          <Skeleton className="h-3.5 w-72 rounded-pill" />
        </div>
        <div className="ms-auto flex flex-none items-center gap-2">
          <Skeleton className="h-5 w-20 rounded-pill" />
          <Skeleton className={cn(PILL_ACTION_SM, "w-20")} />
          <Skeleton className={cn(PILL_ACTION_SM, "w-28")} />
        </div>
      </div>

      <div className={HERO_TILE_SHAPE.GRID}>
        {[0, 1].map((i) => (
          <div key={i} className={cn(HERO_TILE_SHAPE.ROOT, HERO_TILE_BODY)}>
            <Skeleton className={cn(HERO_TILE_SHAPE.DISC, "bg-accent")} />
            <div className={HERO_TILE_SHAPE.COL}>
              <Skeleton className="h-3 w-20 rounded-pill" />
              <Skeleton className="h-4 w-32 rounded-pill" />
              <Skeleton className="h-4 w-24 rounded-pill" />
            </div>
          </div>
        ))}
        <div className={cn(HERO_TILE_SHAPE.ROOT, HERO_TILE_BODY)}>
          <Skeleton className={cn(HERO_TILE_SHAPE.DISC, "bg-accent")} />
          <div className={HERO_TILE_SHAPE.COL}>
            <Skeleton className="h-3 w-28 rounded-pill" />
            <Skeleton className="h-4 w-full rounded-pill" />
            <Skeleton className="h-4 w-2/3 rounded-pill" />
          </div>
        </div>
      </div>
    </div>
  );
}
