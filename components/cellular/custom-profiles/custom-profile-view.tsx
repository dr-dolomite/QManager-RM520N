"use client";

import React from "react";
import { toast } from "sonner";
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
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge, badgeVariants } from "@/components/ui/badge";
import { Tag, tagVariants } from "@/components/ui/tag";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import type { MaterialSymbolName } from "@/components/ui/material-symbol";

import { TonalBanner } from "@/components/ui/tonal-banner";
import { cn } from "@/lib/utils";
import EmptyProfileViewComponent from "@/components/cellular/custom-profiles/empty-profile";
import { ScheduleMiniBar } from "@/components/cellular/custom-profiles/schedule-ribbon";
import { useSimProfiles } from "@/hooks/use-sim-profiles";
import { useScenarioList } from "@/hooks/use-scenario-list";
import type { SuggestionView } from "@/hooks/use-profile-suggestions";
import { resolveScheduledScenario } from "@/lib/scenario-schedule";
import { resolveScenarioIcon } from "@/components/cellular/custom-profiles/connection-scenarios/scenario-icons";
import type { ConnectionScenario } from "@/types/connection-scenario";
import {
  type PdpType,
  type ProfileApplyState,
  type ProfileSummary,
  type SimProfile,
} from "@/types/sim-profile";
import { staggerRows, staggerRowItem } from "@/lib/motion";
import {
  PROFILE_ROW_SHAPE,
  PROFILE_ROW_DISC_TONE,
  PROFILE_STATUS_BADGE,
  BADGE_GLYPH_SIZE,
  SUGGESTION_ROW,
  SUGGESTION_DISC,
  MACHINE_VALUE,
  PILL_ACTION,
  PILL_ACTION_PLAIN,
  PILL_ACTION_SM,
  ICON_ACTION,
  RIBBON_MINI,
  profileRowTone,
} from "@/components/cellular/custom-profiles/shapes";

// =============================================================================
// CustomProfileViewComponent — Saved Profiles list
// =============================================================================
// THE ROW IS ONE LINE. Left to right:
//
//   [ 40px disc ] [ name over a wrapped strip of OUTLINE TAGS ] [ mini ribbon ]
//   [ status chip ] [ 36px overflow ]
//
// and every geometry/tone value in it comes from `shapes.ts`. The previous
// generation was a stacked card — identity line, scenario line, five FILLED
// config pills, a mismatch banner, a footer with two buttons — which put roughly
// twenty filled boxes in a four-row column and then had to colour the row's own
// fill to keep the row distinguishable from its own contents. `shapes.ts`
// records that argument in full on `PROFILE_ROW_SHAPE` and `profileRowTone`;
// the short version is that identity is now OUTLINE (`components/ui/tag.tsx`),
// so the row's neutral fill is the only fill in it and never has to compete.
//
// COLOUR. Every row body is neutral `surface-container` whatever its status.
// `active` adds a 2px inset primary ring (no layout box, so an active and an
// inactive row stay pixel-identical). `mismatch` no longer paints the row: the
// warning moved to the 40px disc (`PROFILE_ROW_DISC_TONE.mismatch`) and to the
// filled `warning` Badge that says the state IN WORDS, which is the only
// channel that survives deuteranopia.
//
// WHERE THE OLD ROW'S FOOTER WENT. Activate / Deactivate / Reapply were two
// footer buttons; they are overflow-menu items now, beside Edit and Delete.
// Every one of them still fires the identical callback with the identical
// `actionsLocked` guard, so the activate/deactivate flow is unchanged — only
// its affordance moved.
//
// Data-shape note: list.sh returns summaries only (no APN/CID/PDP/TTL/HL/IMEI),
// so each row's APN tag needs the full profile. We prefetch every profile's
// detail up front via the hook's getProfile() and hold ONE list skeleton until
// they all land, so rows arrive fully populated instead of double-shimmering.
// SIM-mismatch is a best-effort naive string compare of profile.sim_iccid vs
// the live ICCID — never canonicalized client-side, WARNING only, never blocks.
//
// Suggestions ("Recommended for your SIM") render as ROWS IN THIS LIST but are
// never merged into `profiles`. That separation is load-bearing:
//   - the header count reads `profiles.length`, so it never claims a suggestion
//     is stored;
//   - the detail prefetch below maps over `profiles`, so it never fires a CGI
//     GET for an id that resolves to nothing;
//   - activate/edit/delete are wired per row variant, so a synthetic id is
//     never handed to an endpoint that only accepts real ones.
// Keep suggestions a sibling prop. Merging the arrays breaks all three at once.
//
// NO AMBIENT LOOP LIVES HERE ANY MORE. The per-row `LIVE_DOT` was one loop per
// row; the One-Loop budget for this surface is spent on the Today strip's armed
// readout instead (see `shapes.ts` > LIVE_DOT). The spinners on Applying /
// Creating are transient progress, not ambient loops, and end with their
// operation.
//
// The row cascade is `staggerRows`/`staggerRowItem` from lib/motion.ts (80ms
// row step — NOT the 120ms card step), nested under this card's own
// `staggerItem` in the page-level cascade: variants only, no local
// `initial`/`animate`, so the sequence inherits the parent clock. Reduced
// motion is handled globally by `<MotionConfig reducedMotion="user">`.

/** The destructive pill, from the button variant — matches
 *  `sms/delete-dialogs.tsx`'s `DESTRUCTIVE_ACTION`/`CANCEL_ACTION` constants. */
const DESTRUCTIVE_ACTION = cn(
  buttonVariants({ variant: "destructive" }),
  PILL_ACTION,
);
const CANCEL_ACTION = PILL_ACTION_PLAIN;

/**
 * How many band tags a row shows before collapsing the tail into a `+N`.
 *
 * Four is where the strip stops paying for itself: at `@lg/card` the row's tag
 * strip has room for the APN, the carrier, the scenario and about four band
 * tags before it wraps to a second line, and a row that wraps has left the
 * single-line anatomy this redesign is built on. Below that the tags are the
 * only thing telling two profiles apart, so the cap is not lower.
 */
const MAX_BAND_TAGS = 4;

type ProfileStatus = "active" | "mismatch" | "inactive";

// Status is derived at render time, never stored. A profile is only "mismatch"
// while it is the active one AND carries an ICCID that no longer matches the
// inserted SIM. Empty ICCID is SIM-agnostic and never mismatches.
function deriveStatus(
  isActive: boolean,
  profileIccid: string,
  currentIccid: string | null,
): ProfileStatus {
  if (!isActive) return "inactive";
  if (profileIccid && currentIccid && profileIccid !== currentIccid) {
    return "mismatch";
  }
  return "active";
}

/** Short clock-time formatter for the per-row "Applied at HH:MM" audit line. */
const formatAppliedTime = (ts: number) =>
  new Date(ts * 1000).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

/** Terminal apply states that surface an audit breadcrumb on the matching row. */
type AuditStatus = "complete" | "partial" | "failed";
const TERMINAL_APPLY: AuditStatus[] = ["complete", "partial", "failed"];

/**
 * A minute-resolution clock for the schedule sentence and the mini ribbon.
 *
 * Lazily initialised and ticked once a minute — the only thing that reads it is
 * "which block is in force right now", which cannot change faster than that. A
 * bare `new Date()` in the render body would be an impurity the react-compiler
 * lint rejects, and a second-resolution interval would re-render every row 60x
 * more often than any of them can change.
 */
function useMinuteClock(override?: Date): Date {
  const [tick, setTick] = React.useState(() => new Date());
  React.useEffect(() => {
    if (override) return;
    const id = setInterval(() => setTick(new Date()), 60_000);
    return () => clearInterval(id);
  }, [override]);
  return override ?? tick;
}

/** One band tag's identity: which radio it belongs to and how it reads. */
type BandTag = { key: string; label: string; variant: "nr" | "lte" };

/** `"1:3:7"` -> `["1","3","7"]`. Empty and whitespace entries drop out. */
function parseBandList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(":")
    .map((b) => b.trim())
    .filter(Boolean);
}

/**
 * The band locks a bound scenario writes, as identity tags.
 *
 * NR leads LTE because a lock that names 5G bands is the one a user went
 * looking for. `B{n}` / `n{n}` are this codebase's existing band spellings
 * (`frequency-locking/*-freq-card.tsx`), not new ones. NSA and SA are merged
 * and de-duplicated: a band locked on both legs is still one band, and printing
 * `n78` twice in a four-tag strip would spend a quarter of the row on a
 * repetition.
 */
function scenarioBandTags(scenario: ConnectionScenario | null): BandTag[] {
  if (!scenario) return [];
  const { lte_bands, nsa_nr_bands, sa_nr_bands } = scenario.config;
  const nr = Array.from(
    new Set([...parseBandList(nsa_nr_bands), ...parseBandList(sa_nr_bands)]),
  ).map<BandTag>((b) => ({ key: `nr-${b}`, label: `n${b}`, variant: "nr" }));
  const lte = parseBandList(lte_bands).map<BandTag>((b) => ({
    key: `lte-${b}`,
    label: `B${b}`,
    variant: "lte",
  }));
  return [...nr, ...lte];
}

/**
 * The bands a SUGGESTION would lock, as identity tags.
 *
 * These are `SuggestionView`'s ALREADY-INTERSECTED lists, not the recipe's:
 * printing a band the modem does not support would be a promise the create
 * path cannot keep. Same de-duplication as the scenario path (a band on both
 * the NSA and SA leg is one band) and the same `n{n}` spelling. The recipes are
 * NR-only by construction — `ProfileSuggestion` has no LTE band field — so
 * nothing here can produce an `lte` tag, and the shared renderer below is what
 * guarantees the two paths stay identical if one ever does.
 */
function suggestionBandTags(view: SuggestionView): BandTag[] {
  return Array.from(new Set([...view.nsaBands, ...view.saBands]))
    .sort((a, b) => a - b)
    .map<BandTag>((b) => ({ key: `nr-${b}`, label: `n${b}`, variant: "nr" }));
}

export interface CustomProfileViewProps {
  profiles: ProfileSummary[];
  activeProfileId: string | null;
  isLoading: boolean;
  error: string | null;
  onEdit: (id: string) => void;
  onDelete: (id: string) => Promise<boolean>;
  onActivate: (id: string) => void;
  onDeactivate: () => void;
  onRefresh: () => void;
  /**
   * Open the profile editor on a blank profile.
   *
   * Only reaches the TRUE empty state (nothing saved AND no suggestion), which
   * is the one branch of this card that has no other create affordance — the
   * populated card's New button lives on the page header above it, and the
   * suggestion row carries its own create action. Optional so the card still
   * renders correctly in a caller that has no editor to open; the empty state
   * simply shows Refresh alone, as it did before.
   */
  onNewProfile?: () => void;
  currentIccid?: string | null;
  /** Most recent apply state — drives the per-row spinner AND "Applied at HH:MM". */
  lastApplyState?: ProfileApplyState | null;
  /** Carrier-matched suggestions, already band-intersected. Empty renders none. */
  suggestions?: SuggestionView[];
  /** Suggestion id currently being created, or null. */
  creatingSuggestionId?: string | null;
  /** Error from the last suggestion-create attempt. */
  suggestionError?: string | null;
  /** Materialize a suggestion as a real profile. */
  onCreateSuggestion?: (suggestionId: string) => void;
  /**
   * Full scenario records, used to resolve a bound scenario's identity glyph
   * and its band locks. Optional and degrades cleanly: without it the row still
   * names the scenario (via `useScenarioList`), it just shows the generic
   * `sim_card` glyph and no band tags.
   */
  scenarios?: ConnectionScenario[];
  /**
   * Re-run the apply sequence for a profile whose last apply came back
   * `partial`. The backend can only re-run ALL FOUR steps, so the affordance is
   * "Reapply profile", never a per-step retry.
   */
  onReapply?: (id: string) => void;
  /**
   * Test seam only. Freezes the schedule clock. Omit in the app and the
   * component ticks its own minute clock.
   */
  now?: Date;
  /**
   * The modem is mid-mutation somewhere on this PAGE — an apply in flight or a
   * deactivate round trip — regardless of which profile it belongs to. Every
   * row's actions go dead while it holds.
   *
   * The row's own `busy` cannot cover this: it is scoped to
   * `lastApplyState.profile_id`, so during an apply of profile A, profile B's
   * Activate stayed live and would fire a second apply into a modem mid-`AT+COPS`
   * — a wasted `apn_busy` at best, a queued second detach at worst.
   *
   * Deliberately kept SEPARATE from `busy` rather than OR-ed into it at the
   * source: `busy` also drives the row's "Applying" status chip, and a
   * page-wide busy flag flowing into that would make every idle row claim it
   * was being applied. State honesty — the page-wide signal disables, it does
   * not narrate.
   */
  pageBusy?: boolean;
  /**
   * Keeps this card's skeleton up even after ITS OWN data is ready, because the
   * page shell wants both this list and the Connection Scenarios card to reveal
   * on the same frame. Only ever true before the FIRST reveal; the page shell
   * latches its own readiness once and never re-arms it.
   */
  holdSkeleton?: boolean;
  /**
   * Fires whenever this card's OWN data-readiness changes — i.e. the summary
   * fetch plus the detail prefetch have settled, independent of `holdSkeleton`.
   * The page shell ANDs this with the sibling cards' reports to decide, in one
   * place, when `holdSkeleton` can drop for all of them at once.
   */
  onLocalReadyChange?: (ready: boolean) => void;
}

const CustomProfileViewComponent = ({
  profiles,
  activeProfileId,
  isLoading,
  error,
  onEdit,
  onDelete,
  onActivate,
  onDeactivate,
  onRefresh,
  onNewProfile,
  currentIccid = null,
  lastApplyState = null,
  suggestions = [],
  creatingSuggestionId = null,
  suggestionError = null,
  onCreateSuggestion,
  scenarios,
  onReapply,
  now,
  pageBusy = false,
  holdSkeleton = false,
  onLocalReadyChange,
}: CustomProfileViewProps) => {
  const { t } = useTranslation("cellular");
  const { nameForId } = useScenarioList();
  const clock = useMinuteClock(now);

  // getProfile is not part of the coordinator prop contract, so we source it
  // from the hook directly (a stable useCallback([]) — the extra instance does a
  // single one-time list fetch on mount and never polls). Only getProfile is
  // used; all mutations stay owned by the coordinator's shared instance.
  const { getProfile } = useSimProfiles();

  const [pendingDelete, setPendingDelete] =
    React.useState<ProfileSummary | null>(null);
  const [isDeleting, setIsDeleting] = React.useState(false);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setIsDeleting(true);
    const ok = await onDelete(target.id);
    setIsDeleting(false);
    setPendingDelete(null);
    if (ok) {
      toast.success(
        t("custom_profiles.view.toast.deleted", { name: target.name }),
      );
    } else {
      toast.error(error || t("custom_profiles.view.toast.delete_error"));
    }
  };

  // ---- Detail hydration -----------------------------------------------------
  // Prefetch every profile's full config up front and hold the single list
  // skeleton until they are all in — one loading state on page load, rows arrive
  // populated. The effect re-runs whenever the backend hands back a fresh
  // `profiles` array; since `detailsHydrated` is only ever set true, later runs
  // refresh in the background without re-flashing the skeleton.
  const [details, setDetails] = React.useState<Record<string, SimProfile>>({});
  const [detailsHydrated, setDetailsHydrated] = React.useState(false);

  React.useEffect(() => {
    // Don't hydrate until the summary fetch has settled. While loading,
    // `profiles` is transiently [] — treating that as hydrated would clear the
    // skeleton early and let tags pop in a beat after the rows.
    if (isLoading) return;

    if (profiles.length === 0) {
      setDetails({});
      setDetailsHydrated(true);
      return;
    }

    let cancelled = false;
    Promise.all(profiles.map((p) => getProfile(p.id))).then((results) => {
      if (cancelled) return;
      const next: Record<string, SimProfile> = {};
      profiles.forEach((p, i) => {
        if (results[i]) next[p.id] = results[i] as SimProfile;
      });
      setDetails(next);
      setDetailsHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, [profiles, getProfile, isLoading]);

  // One skeleton, gated on the summary fetch, the detail prefetch, AND —
  // before the first reveal only — the sibling cards via `holdSkeleton`.
  // `holdSkeleton` is a one-way latch owned by the page shell (it only ever
  // flips true→false, never back), so it needs no extra ref here to stop it
  // re-arming on a later background refresh — reading it directly is safe.
  const locallyReady =
    !(isLoading && profiles.length === 0) &&
    !(profiles.length > 0 && !detailsHydrated);
  const showSkeleton = !locallyReady || holdSkeleton;

  React.useEffect(() => {
    onLocalReadyChange?.(locallyReady);
    // Reporting an event, not syncing derived state — the callback identity
    // is expected to be stable (page shell wraps it in useCallback([])), so
    // omitting it here matches the sibling effect pattern elsewhere in this
    // file rather than re-firing on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locallyReady]);

  // Active profile leads; the rest keep backend order.
  const ordered = React.useMemo(() => {
    return [...profiles].sort((a, b) => {
      const aActive = a.id === activeProfileId ? 0 : 1;
      const bActive = b.id === activeProfileId ? 0 : 1;
      return aActive - bActive;
    });
  }, [profiles, activeProfileId]);

  const scenarioById = React.useCallback(
    (id: string): ConnectionScenario | null =>
      scenarios?.find((s) => s.id === id) ?? null,
    [scenarios],
  );

  // The band rationale keys off the RECIPE, not the intersected result: a
  // suggestion that recommends bands still deserves the explanation even when
  // none survived intersection with the modem's supported bands.
  const hasBandRecipe = suggestions.some(
    (v) =>
      v.suggestion.nsa_nr_bands.length > 0 || v.suggestion.sa_nr_bands.length > 0,
  );

  // Empty state is a full-card surface (owns its own header + refresh), so it
  // replaces this card entirely rather than nesting inside it.
  //
  // Gated on suggestions TOO. A user with no saved profiles but a matched
  // carrier is precisely the one a suggestion is for; letting the empty card
  // win here would hide the recommendation from its whole audience. When only
  // suggestions exist, the inline `none_saved_yet` line below carries the
  // "nothing stored yet" message instead.
  if (!showSkeleton && profiles.length === 0 && suggestions.length === 0) {
    return (
      <EmptyProfileViewComponent
        onRefresh={onRefresh}
        onNewProfile={onNewProfile}
      />
    );
  }

  return (
    <Card className="@container/card h-full">
      <CardHeader>
        <CardTitle>{t("custom_profiles.view.title")}</CardTitle>
        <CardDescription>
          {t("custom_profiles.view.subtitle")}
        </CardDescription>
        {profiles.length > 0 && (
          <CardAction>
            {/* A COUNT is metadata, not status — the outline `Tag` form, never
                one of the five filled status roles (The Two-Form Rule). */}
            <Tag variant="neutral" className={cn("px-2.5", MACHINE_VALUE)}>
              {profiles.length}
            </Tag>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {/* A failed GET here is usually transient AT-lock contention (another
            poller/CGI call holding the shared lock for a cycle), never a
            reason to blank an already-populated list — the list below FREEZES
            on whatever it last had, and this banner explains why it stopped
            moving. That is why this is NOT a `ConditionScreen`: a condition
            screen replaces the surface, and replacing a list that still holds
            good data with an error panel destroys the very thing the freeze
            was protecting. Mirrors the Carrier Aggregation precedent and
            `sms/states.tsx`'s `InboxErrorNotice`. */}
        {error && !showSkeleton && (
          <TonalBanner
            tone="destructive"
            icon="error"
            size="compact"
            className="mb-3"
          >
            {error}
          </TonalBanner>
        )}

        {showSkeleton ? (
          <ListSkeleton />
        ) : (
          // Cap the list height so a long roster scrolls instead of stretching
          // past its sibling card. The active profile is sorted to the top so it
          // stays in view; the -mr/pr pair gives the scrollbar a gutter without
          // nudging the rows.
          <div className="-mr-2 max-h-128 overflow-x-hidden overflow-y-auto pr-2 [scrollbar-width:thin]">
            <div className="flex flex-col gap-3">
              {/* Only reachable when suggestions kept the card alive. Keeps the
                  list honest about having nothing stored without spending the
                  full empty-state card on it. */}
              {profiles.length === 0 && (
                <p className="text-on-surface-variant text-xs">
                  {t("custom_profiles.view.none_saved_yet")}
                </p>
              )}

              {/* Row cascade: variants ONLY, no local initial/animate — it
                  inherits the "visible" state from this card's own
                  `staggerItem` wrapper in custom-profile.tsx, one level up
                  from the page's `staggerContainer`. */}
              <motion.div variants={staggerRows} className={PROFILE_ROW_SHAPE.LIST}>
                {ordered.map((profile) => {
                  const audit =
                    lastApplyState &&
                    lastApplyState.profile_id === profile.id &&
                    TERMINAL_APPLY.includes(lastApplyState.status as AuditStatus)
                      ? (lastApplyState.status as AuditStatus)
                      : null;
                  const busy =
                    lastApplyState?.profile_id === profile.id &&
                    lastApplyState?.status === "applying";
                  // Which scenario is in force for THIS profile right now.
                  // Resolved through the shared `lib/scenario-schedule.ts`
                  // resolver — the same function the device-side schedule and
                  // the Today strip read, so the row can never disagree with
                  // them about which block is live.
                  const liveScenarioId = resolveScheduledScenario(
                    clock,
                    profile.scenario.schedule,
                    profile.scenario.default,
                  );
                  return (
                    <ProfileRow
                      key={profile.id}
                      summary={profile}
                      status={deriveStatus(
                        profile.id === activeProfileId,
                        profile.sim_iccid,
                        currentIccid,
                      )}
                      liveScenarioName={nameForId(liveScenarioId)}
                      liveScenario={scenarioById(liveScenarioId)}
                      now={clock}
                      busy={!!busy}
                      pageBusy={pageBusy}
                      auditStatus={audit}
                      auditTime={
                        audit ? formatAppliedTime(lastApplyState!.started_at) : ""
                      }
                      full={details[profile.id] ?? null}
                      onActivate={() => onActivate(profile.id)}
                      onDeactivate={onDeactivate}
                      onReapply={
                        onReapply ? () => onReapply(profile.id) : undefined
                      }
                      onEdit={() => onEdit(profile.id)}
                      onDelete={() => setPendingDelete(profile)}
                    />
                  );
                })}
              </motion.div>

              {suggestions.length > 0 && (
                <>
                  {suggestionError && (
                    <TonalBanner tone="destructive" icon="error" size="compact">
                      {suggestionError}
                    </TonalBanner>
                  )}

                  {/* Suggestions stack as ordinary rows in the same list
                      geometry. The dashed, UNFILLED stroke is what identifies
                      them — no section label, no preamble — because a
                      suggestion is an offer and nothing has been applied. */}
                  <motion.div
                    variants={staggerRows}
                    className={PROFILE_ROW_SHAPE.LIST}
                  >
                    {suggestions.map((view) => (
                      <SuggestionRow
                        key={view.suggestion.id}
                        view={view}
                        isCreating={creatingSuggestionId === view.suggestion.id}
                        disabled={creatingSuggestionId !== null}
                        onCreate={() => onCreateSuggestion?.(view.suggestion.id)}
                      />
                    ))}
                  </motion.div>

                  {/* Honest rationale. Carries the safety note that a band lock
                      narrows the radio, and that both it and the TTL/HL change
                      are undone by deactivating. */}
                  <div className="text-on-surface-variant flex flex-col gap-1.5 pt-1 text-xs">
                    {hasBandRecipe && (
                      <p className="flex items-start gap-2">
                        <MaterialSymbol
                          name="info"
                          size={14}
                          aria-hidden
                          className="mt-px shrink-0"
                        />
                        <span>
                          {t("custom_profiles.suggestions.rationale_bands")}
                        </span>
                      </p>
                    )}
                    <p className="flex items-start gap-2">
                      <MaterialSymbol
                        name="info"
                        size={14}
                        aria-hidden
                        className="mt-px shrink-0"
                      />
                      <span>
                        {t("custom_profiles.suggestions.rationale_ttl")}
                      </span>
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </CardContent>

      {/* Delete confirmation — destructive, so it always asks first. The
          trigger lives in each row's overflow menu; the dialog itself is
          owned here and keyed off `pendingDelete`. */}
      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && !isDeleting && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("custom_profiles.view.delete_title", {
                name: pendingDelete?.name ?? "",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("custom_profiles.view.delete_description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              variant="tonal"
              disabled={isDeleting}
              className={CANCEL_ACTION}
            >
              {t("custom_profiles.view.delete_keep")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmDelete();
              }}
              disabled={isDeleting}
              className={DESTRUCTIVE_ACTION}
            >
              {isDeleting
                ? t("custom_profiles.table.delete_confirm.deleting")
                : t("custom_profiles.table.actions_menu.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};

// -----------------------------------------------------------------------------
// Profile row — one line.
// -----------------------------------------------------------------------------
const ProfileRow = ({
  summary,
  status,
  liveScenarioName,
  liveScenario,
  now,
  busy,
  pageBusy,
  auditStatus,
  auditTime,
  full,
  onActivate,
  onDeactivate,
  onReapply,
  onEdit,
  onDelete,
}: {
  summary: ProfileSummary;
  status: ProfileStatus;
  /** Name of the scenario in force RIGHT NOW for this profile. */
  liveScenarioName: string;
  /** Its full record, when the page supplied `scenarios`. Null degrades to the
   *  generic `sim_card` glyph and hides the band tags. */
  liveScenario: ConnectionScenario | null;
  now: Date;
  /** THIS profile is the one being applied. Drives the chip and the disc too. */
  busy: boolean;
  /** SOMETHING on the page is mutating the modem. Disables only — never narrates. */
  pageBusy: boolean;
  auditStatus: AuditStatus | null;
  auditTime: string;
  /** Full config, prefetched by the view so the row arrives populated. */
  full: SimProfile | null;
  onActivate: () => void;
  onDeactivate: () => void;
  onReapply?: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) => {
  const { t } = useTranslation("cellular");
  const isActive = status !== "inactive";
  const schedule = summary.scenario.schedule;
  const blocks = schedule.blocks?.length ?? 0;
  const scheduled = schedule.enabled && blocks > 0;
  const discStatus = busy ? "applying" : status;
  const apnName = full?.settings.apn.name.trim() ?? "";
  // Reads through the SAME prefetched detail the APN tag does, so the two tags
  // appear together or not at all — never an APN with the IMEI silently absent
  // because the detail had not landed.
  const imeiOverridden = (full?.settings.imei.trim() ?? "") !== "";

  // Every action on this row fires a modem mutation, so all of them go dead
  // while ANY mutation is in flight — this row's own apply or one belonging to
  // another row.
  const actionsLocked = busy || pageBusy;

  // The schedule, in words, for anyone who cannot see the ribbon. The ribbon
  // itself is `aria-hidden` (a proportional band of colour is not information a
  // screen reader can recover), so this sentence is the whole accessible
  // rendering of it — and it keeps the block count the old stacked row printed.
  const scheduleSentence = scheduled
    ? t("custom_profiles.view.schedule_live", {
        scenario: liveScenarioName,
        count: blocks,
      })
    : t("custom_profiles.view.scenario_always_on", {
        scenario: liveScenarioName,
      });

  return (
    <motion.div
      variants={staggerRowItem}
      className={cn(
        PROFILE_ROW_SHAPE.ROOT,
        "motion-reduce:transition-none",
        profileRowTone(status),
      )}
    >
      {/* --- The row's ONE coloured object ------------------------------- */}
      {/* FILL layer per the Glyph-Disc Rule. `mismatch` is warning HERE and
          nowhere else on the row — the substitution this redesign is for. */}
      <span
        className={cn(
          PROFILE_ROW_SHAPE.DISC,
          PROFILE_ROW_DISC_TONE[discStatus],
        )}
      >
        <MaterialSymbol
          name={
            liveScenario ? resolveScenarioIcon(liveScenario.icon) : "sim_card"
          }
          size={20}
          aria-hidden
        />
      </span>

      {/* --- Name over a wrapped strip of OUTLINE tags -------------------- */}
      <div className={PROFILE_ROW_SHAPE.COL}>
        <span className={PROFILE_ROW_SHAPE.NAME}>{summary.name}</span>
        <span className="sr-only">{scheduleSentence}</span>
        <div className={PROFILE_ROW_SHAPE.META}>
          {/* APN: a machine string the device emits, so mono. An empty APN
              means "leave the attach APN alone", which is a human statement
              about the config and stays proportional. */}
          {full && (
            <Tag
              variant="neutral"
              className={apnName ? MACHINE_VALUE : undefined}
            >
              {apnName || t("custom_profiles.pills.apn_default")}
            </Tag>
          )}
          {/* IMEI override, and ONLY IMEI override, follows the APN down this
              strip. PDP type, CID, TTL and hop-limit are deliberately NOT here
              — a saved profile can be opened to read them, and nine tags per
              row would bury the name. An overridden IMEI is different in kind:
              it changes the identity the NETWORK sees, it is invisible
              everywhere else on the page, and a user who has forgotten one is
              set will misread every registration failure that follows. */}
          {imeiOverridden && (
            <Tag variant="neutral">
              <MaterialSymbol
                name="fingerprint"
                size={BADGE_GLYPH_SIZE}
                aria-hidden
              />
              {t("custom_profiles.pills.imei_override")}
            </Tag>
          )}
          {summary.mno && <Tag variant="neutral">{summary.mno}</Tag>}
          <Tag variant="neutral">
            <MaterialSymbol
              name={scheduled ? "schedule" : "route"}
              size={BADGE_GLYPH_SIZE}
              aria-hidden
            />
            {liveScenarioName}
          </Tag>
          <BandTags bands={scenarioBandTags(liveScenario)} />
          {auditStatus && (
            <AuditNote status={auditStatus} time={auditTime} />
          )}
        </div>
      </div>

      {/* --- The condensed schedule -------------------------------------- */}
      {/* Shared timeline math with the Today strip — one function, so the two
          can never disagree about where a block starts. `RIBBON_MINI.ROOT`
          hides itself below `@lg/card`, so no responsive classes belong here.
          An unscheduled profile renders the same box, empty, so the trailing
          cluster lands on one vertical line down the whole list. */}
      {scheduled ? (
        <ScheduleMiniBar
          schedule={schedule}
          fallbackScenarioId={summary.scenario.default}
          now={now}
        />
      ) : (
        <span className={cn(RIBBON_MINI.ROOT, "invisible")} aria-hidden />
      )}

      {/* --- Status chip + overflow -------------------------------------- */}
      <div className={PROFILE_ROW_SHAPE.ACTIONS}>
        <StatusBadge status={busy ? "applying" : status} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(ICON_ACTION, "text-on-surface-variant")}
              aria-label={t("custom_profiles.view.row_menu_aria", {
                name: summary.name,
              })}
            >
              <MaterialSymbol name="more_vert" size={18} aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          {/* Scoped override, not a `dropdown-menu.tsx` primitive change —
              that shared component also backs the SMS Inbox row menu, which
              this pass does not touch. `rounded-field` (20px) is the shape
              scale's own answer for "small popovers"; `border-0` +
              `shadow-lg` follows the Popover Float rule (a floating surface's
              detachment reads through elevation, not a hairline). */}
          <DropdownMenuContent
            align="end"
            className="w-52 rounded-field border-0 p-1.5 shadow-lg"
          >
            {/* The mismatch explanation's VISIBLE home. `sr-only` beside the
                chip covers assistive tech; this covers a touch user, who can
                reach a menu but can never reach a tooltip. `whitespace-normal`
                because `DropdownMenuLabel` is built for one-line labels and
                this is a sentence. */}
            {status === "mismatch" && (
              <>
                <DropdownMenuLabel className="text-on-surface-variant max-w-full px-3 py-2 text-xs font-normal whitespace-normal">
                  {t("custom_profiles.view.mismatch_note")}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
              </>
            )}
            {/* The activate/deactivate flow is UNCHANGED — same callbacks,
                same `actionsLocked` guard. Only the affordance moved off the
                row footer, which the single-line anatomy no longer has. */}
            {isActive ? (
              <DropdownMenuItem
                className="rounded-pill"
                disabled={actionsLocked}
                onClick={onDeactivate}
              >
                <MaterialSymbol name="power_settings_new" size={16} aria-hidden />
                {t("custom_profiles.table.actions_menu.deactivate")}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                className="rounded-pill"
                disabled={actionsLocked}
                onClick={onActivate}
              >
                <MaterialSymbol
                  name={busy ? "progress_activity" : "play_arrow"}
                  size={16}
                  aria-hidden
                  className={cn(busy && "animate-spin motion-reduce:animate-none")}
                />
                {busy
                  ? t("custom_profiles.view.activating")
                  : t("custom_profiles.table.actions_menu.activate")}
              </DropdownMenuItem>
            )}
            {/* State honesty: the backend re-runs the WHOLE four-step
                sequence, so the label says "profile", never "step". */}
            {auditStatus === "partial" && onReapply && (
              <DropdownMenuItem
                className="rounded-pill"
                disabled={actionsLocked}
                onClick={onReapply}
              >
                <MaterialSymbol name="restart_alt" size={16} aria-hidden />
                {t("custom_profiles.view.reapply")}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem className="rounded-pill" onClick={onEdit}>
              <MaterialSymbol name="edit" size={16} aria-hidden />
              {t("custom_profiles.table.actions_menu.edit")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              className="rounded-pill"
              onClick={onDelete}
            >
              <MaterialSymbol name="delete" size={16} aria-hidden />
              {t("custom_profiles.table.actions_menu.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </motion.div>
  );
};

/**
 * PDP type -> its existing label key. Restated as a map rather than inlined so
 * a fourth PDP type added to `PdpType` fails the build here instead of
 * rendering the raw AT token.
 */
const PDP_TAG_KEY: Record<PdpType, string> = {
  IP: "custom_profiles.pills.ip_v4",
  IPV6: "custom_profiles.pills.ip_v6",
  IPV4V6: "custom_profiles.pills.ip_dual",
};

// -----------------------------------------------------------------------------
// Band tags — ONE renderer, so a saved row and a suggestion can never disagree.
// -----------------------------------------------------------------------------
// `nr` / `lte` are IDENTITY variants: they say WHICH RADIO a lock names, never
// that the lock is healthy. That is why they live on `Tag` and not on `Badge` —
// `BadgeVariant` no longer contains them, so the split is compiler-enforced.
//
// The cap is shared rather than restated because the two call sites are exactly
// where a cap drifts: a saved row reads a scenario's colon-delimited config and
// a suggestion reads an already-intersected `number[]`, and nothing but a common
// renderer would keep "four, then +N" true for both.
const BandTags = ({ bands }: { bands: BandTag[] }) => {
  const { t } = useTranslation("cellular");

  // Collapse the tail only when it buys something. At an overflow of exactly
  // one, `+1` is as wide as the tag it replaced, so the cap would cost a band
  // number and save nothing.
  const overflow = bands.length - MAX_BAND_TAGS;
  const shown = overflow > 1 ? bands.slice(0, MAX_BAND_TAGS) : bands;
  const hidden = bands.length - shown.length;

  return (
    <>
      {shown.map((band) => (
        <Tag key={band.key} variant={band.variant} className={MACHINE_VALUE}>
          {band.label}
        </Tag>
      ))}
      {hidden > 0 && (
        <Tag
          variant="neutral"
          className={MACHINE_VALUE}
          // "+3" is not a sentence. The cap only fires at two or more, so the
          // label never needs a singular form — see the `{{n}}`-not-`{{count}}`
          // note on the locale keys.
          aria-label={t("profiles.list.bands_more_aria", { n: hidden })}
        >
          {t("profiles.list.bands_more", { n: hidden })}
        </Tag>
      )}
    </>
  );
};

// -----------------------------------------------------------------------------
// The apply breadcrumb — INK on neutral ground, never a second chip.
// -----------------------------------------------------------------------------
// `TODAY_ARMED` in shapes.ts states the rule this follows: a small true
// statement sitting beside a status chip takes ink, because a second filled
// chip in the same row puts two competing claims on one line. `text-{role}-on-
// surface`, never bare `text-{role}` — the bare token is a FILL tuned to sit
// under `-foreground` ink.
const AUDIT_SPEC: Record<
  AuditStatus,
  { glyph: MaterialSymbolName; ink: string; key: string }
> = {
  complete: {
    glyph: "check_circle",
    ink: "text-on-surface-variant",
    key: "custom_profiles.view.audit.applied",
  },
  partial: {
    glyph: "warning",
    ink: "text-warning-on-surface font-medium",
    key: "custom_profiles.view.audit.partial",
  },
  failed: {
    glyph: "error",
    ink: "text-destructive-on-surface font-medium",
    key: "custom_profiles.view.audit.failed",
  },
};

const AuditNote = ({
  status,
  time,
}: {
  status: AuditStatus;
  time: string;
}) => {
  const { t } = useTranslation("cellular");
  const spec = AUDIT_SPEC[status];
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs", spec.ink)}>
      <MaterialSymbol name={spec.glyph} size={BADGE_GLYPH_SIZE} aria-hidden />
      {t(spec.key, { time })}
    </span>
  );
};

// -----------------------------------------------------------------------------
// Status badge — filled tonal chip via PROFILE_STATUS_BADGE (shapes.ts). Tone
// keys onto `BadgeVariant`, so a status without a matching role fails the
// build instead of shipping untinted. Every state in this one slot carries a
// DISTINCT glyph, which is what makes `success` and `warning` — 1.03:1 apart,
// and identical under deuteranopia — actually tell each other apart.
// -----------------------------------------------------------------------------
type RowBadgeStatus = ProfileStatus | "applying";

const STATUS_LABEL_KEY: Record<RowBadgeStatus, string> = {
  active: "custom_profiles.table.status_badge.active",
  // "SIM changed" rather than "SIM Mismatch": this chip is now the ONLY thing
  // reporting the condition (the row no longer paints itself warning, and the
  // stacked banner is gone with the stacked row), so it says what happened in
  // plain words instead of naming a state.
  mismatch: "profiles.list.status.sim_changed",
  inactive: "custom_profiles.table.status_badge.inactive",
  // Reuses the apply dialog's own label rather than minting a second
  // "Applying…" string that could drift from it in translation.
  applying: "custom_profiles.apply_dialog.status_badge.applying",
};

const StatusBadge = ({ status }: { status: RowBadgeStatus }) => {
  const { t } = useTranslation("cellular");
  const meta = PROFILE_STATUS_BADGE[status];
  return (
    <>
      <Badge variant={meta.variant}>
        <MaterialSymbol
          name={meta.glyph}
          size={BADGE_GLYPH_SIZE}
          aria-hidden
          className={cn(meta.spin && "animate-spin motion-reduce:animate-none")}
        />
        {t(STATUS_LABEL_KEY[status])}
      </Badge>
      {/* The sentence the removed mismatch banner carried, announced with the
          chip itself. It was briefly a `title`, which was wrong: a tooltip is
          invisible to touch and to any keyboard user who never hovers, and this
          was the only surviving copy of the explanation. The visible home for
          it is the overflow menu (see `ProfileRow`); this is the accessible
          one. Same technique as the row's schedule sentence. */}
      {status === "mismatch" && (
        <span className="sr-only">
          {t("custom_profiles.view.mismatch_note")}
        </span>
      )}
    </>
  );
};

// -----------------------------------------------------------------------------
// Suggestion row — a carrier recommendation, shaped as a peer of ProfileRow.
// -----------------------------------------------------------------------------
// Same geometry AND the same disclosure as a saved row: the APN, PDP type, CID,
// any TTL/hop-limit override and any recommended bands all render as outline
// tags in the same `.META` strip, so the offer and the roster can be compared
// straight down the column. An earlier pass shipped this row with only
// "Recommended for your SIM" on it, which is an unfalsifiable claim — a row
// asking permission to configure the modem has to say what it would configure
// BEFORE the user presses Create.
//
// Three differences carry the honesty, none of them colour-only:
//   - the row and its disc are DASHED and UNFILLED — nothing has been applied,
//     so nothing is painted (`SUGGESTION_ROW` / `SUGGESTION_DISC`);
//   - the leading tag reads "Recommended for your SIM" in words;
//   - the trailing affordance is Create, not a status chip and not an overflow
//     menu, because there is nothing yet to edit, delete or activate.
//
// The extra tag line is absorbed by `PROFILE_ROW_SHAPE.ROOT`'s `min-h-` FLOOR.
// There is no height constant to keep in step, which is exactly why the shape
// is a floor.
const SuggestionRow = ({
  view,
  isCreating,
  disabled,
  onCreate,
}: {
  view: SuggestionView;
  isCreating: boolean;
  /** True while ANY suggestion is being created — the create path is serial. */
  disabled: boolean;
  onCreate: () => void;
}) => {
  const { t } = useTranslation("cellular");
  const { suggestion } = view;

  return (
    <motion.div
      variants={staggerRowItem}
      className={cn(
        PROFILE_ROW_SHAPE.ROOT,
        "motion-reduce:transition-none",
        SUGGESTION_ROW,
      )}
    >
      <span className={cn(PROFILE_ROW_SHAPE.DISC, SUGGESTION_DISC)}>
        <MaterialSymbol name="auto_awesome" size={20} aria-hidden />
      </span>

      <div className={PROFILE_ROW_SHAPE.COL}>
        <span className={PROFILE_ROW_SHAPE.NAME}>{suggestion.label}</span>
        <div className={PROFILE_ROW_SHAPE.META}>
          {/* The offer, first — so the row reads as a recommendation before it
              reads as a configuration. */}
          <Tag variant="neutral">
            <MaterialSymbol
              name="auto_awesome"
              size={BADGE_GLYPH_SIZE}
              aria-hidden
            />
            {t("profiles.list.suggestion_meta")}
          </Tag>
          {/* Then WHAT IT WOULD WRITE, in the same tag vocabulary and the same
              `.META` strip a saved row uses, so the two can be compared down
              the column. A row that offers to configure the modem and will not
              say what it would configure is an unfalsifiable claim. */}
          <Tag variant="neutral" className={MACHINE_VALUE}>
            {suggestion.apn_name}
          </Tag>
          <Tag variant="neutral">
            {PDP_TAG_KEY[suggestion.pdp_type]
              ? t(PDP_TAG_KEY[suggestion.pdp_type])
              : suggestion.pdp_type}
          </Tag>
          {suggestion.cid > 0 && (
            <Tag variant="neutral" className={MACHINE_VALUE}>
              {t("custom_profiles.pills.cid", { cid: suggestion.cid })}
            </Tag>
          )}
          {/* 0 means "leave unchanged", so the tag is omitted rather than
              printing a default the create path would never write. */}
          {suggestion.ttl > 0 && (
            <Tag variant="neutral" className={MACHINE_VALUE}>
              {t("custom_profiles.pills.ttl", { value: suggestion.ttl })}
            </Tag>
          )}
          {suggestion.hl > 0 && (
            <Tag variant="neutral" className={MACHINE_VALUE}>
              {t("custom_profiles.pills.hl", { value: suggestion.hl })}
            </Tag>
          )}
          <BandTags bands={suggestionBandTags(view)} />
        </div>
      </div>

      <div className={PROFILE_ROW_SHAPE.ACTIONS}>
        <Button
          variant="tonal"
          className={PILL_ACTION_SM}
          onClick={onCreate}
          disabled={disabled}
          aria-label={t("custom_profiles.suggestions.create_aria", {
            name: suggestion.label,
          })}
        >
          <MaterialSymbol
            name={isCreating ? "progress_activity" : "add"}
            size={16}
            aria-hidden
            className={cn(isCreating && "animate-spin motion-reduce:animate-none")}
          />
          {isCreating
            ? t("custom_profiles.suggestions.creating")
            : t("custom_profiles.suggestions.create")}
        </Button>
      </div>
    </motion.div>
  );
};

// -----------------------------------------------------------------------------
// Loading affordance — the row's own ROOT, with placeholders in its own slots.
// -----------------------------------------------------------------------------
// THE ROW IS VARIABLE HEIGHT. Its tag strip wraps, so `PROFILE_ROW_SHAPE` ships
// a `min-h-` FLOOR and deliberately no `HEIGHT` constant, and the only honest
// mirror for a box like that is to render the box. The previous generation
// floored at one value and mirrored another, and every row jumped at the
// handoff.
//
// So: `PROFILE_ROW_SHAPE.ROOT` itself, with `DISC`, `COL`/`NAME`/`META`,
// `RIBBON_MINI.ROOT` and `ACTIONS` in place. The tag and chip placeholders take
// `tagVariants()` / `badgeVariants()` — the components' own geometry — around
// an invisible space, so their height derives from the real thing rather than
// from a restated `h-5`. Only the RUN LENGTHS are local, because a run length
// mirrors content, not geometry.

/**
 * A placeholder shaped exactly like an outline `Tag`.
 *
 * `bg-accent` is restored explicitly and is NOT optional: `tagVariants` carries
 * `bg-transparent` (a tag has no fill, that is its whole construction), and
 * `cn` lets the caller's class win — so without this the placeholder would
 * merge away `Skeleton`'s own fill and shimmer as a rectangle of nothing.
 * `border-transparent` does the mirror job for the tag's stroke.
 */
const TagSkeleton = ({ w }: { w: string }) => (
  <Skeleton
    className={cn(
      tagVariants({ variant: "neutral" }),
      "border-transparent bg-accent",
      w,
    )}
  >
    <span className="invisible">&nbsp;</span>
  </Skeleton>
);

const SkeletonRow = () => (
  <div className={cn(PROFILE_ROW_SHAPE.ROOT, "bg-surface-container")}>
    <Skeleton className={PROFILE_ROW_SHAPE.DISC} />

    <div className={PROFILE_ROW_SHAPE.COL}>
      <Skeleton className="h-4 w-36 rounded-pill" />
      <div className={PROFILE_ROW_SHAPE.META}>
        <TagSkeleton w="w-24" />
        <TagSkeleton w="w-16" />
        <TagSkeleton w="w-20" />
      </div>
    </div>

    {/* Same track and segment shapes the real mini ribbon uses, so the two can
        never drift on height, width or gap. */}
    <div className={RIBBON_MINI.ROOT}>
      {[7, 11, 5, 1].map((flex, i) => (
        <Skeleton
          key={i}
          className={cn(RIBBON_MINI.SEGMENT, "h-full")}
          style={{ flex }}
        />
      ))}
    </div>

    <div className={PROFILE_ROW_SHAPE.ACTIONS}>
      {/* Same reasoning as `TagSkeleton`: `badgeVariants` brings its role's own
          fill, so the shimmer colour has to be put back deliberately. */}
      <Skeleton
        className={cn(
          badgeVariants({ variant: "muted" }),
          "w-20 border-transparent bg-accent",
        )}
      >
        <span className="invisible">&nbsp;</span>
      </Skeleton>
      <Skeleton className={ICON_ACTION} />
    </div>
  </div>
);

const ListSkeleton = () => (
  <div className={PROFILE_ROW_SHAPE.LIST}>
    {[0, 1, 2].map((i) => (
      <SkeletonRow key={i} />
    ))}
  </div>
);

export default CustomProfileViewComponent;
