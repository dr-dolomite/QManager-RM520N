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
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
  DEFAULT_SCENARIO_BINDING,
  formatProfileDate,
  type ProfileApplyState,
  type ProfileSummary,
  type SimProfile,
  type PdpType,
} from "@/types/sim-profile";
import { staggerRows, staggerRowItem } from "@/lib/motion";
import {
  PROFILE_ROW_SHAPE,
  PROFILE_STATUS_BADGE,
  BADGE_GLYPH_SIZE,
  SUGGESTION_ROW,
  CONFIG_PILL,
  CONFIG_PILL_NEUTRAL,
  CONFIG_PILL_BRAND,
  MACHINE_VALUE,
  PILL_ACTION,
  PILL_ACTION_PLAIN,
  RIBBON_MINI,
  LIVE_DOT,
  SCENARIO_META_CHIP,
  profileRowTone,
} from "@/components/cellular/custom-profiles/shapes";

// =============================================================================
// CustomProfileViewComponent — Saved Profiles list (stacked-row design)
// =============================================================================
// Rebuilt onto the approved mock (`reimagine/SIM Profiles and Scenarios.dc.html`
// lines 238–387). Every geometry and tone value comes from `shapes.ts`; the
// mock's raw figures (28px radii, 300ms, 60ms stagger, oklch literals) are its
// inspection baseline and are deliberately NOT copied.
//
// Data-shape note: list.sh returns summaries only (no APN/CID/PDP/TTL/HL/IMEI),
// so each row's ConfigPills need the full profile. We prefetch every profile's
// detail up front via the hook's getProfile() and hold ONE list skeleton until
// they all land, so rows arrive fully populated instead of double-shimmering.
// SIM-mismatch is a best-effort naive string compare of profile.sim_iccid vs
// the live ICCID — never canonicalized client-side, WARNING only, never blocks.
//
// Suggestions ("Recommended for your SIM") render as ROWS IN THIS LIST but are
// never merged into `profiles`. That separation is load-bearing:
//   - the header count chip reads `profiles.length`, so it never claims a
//     suggestion is stored;
//   - the detail prefetch below maps over `profiles`, so it never fires a CGI
//     GET for an id that resolves to nothing;
//   - activate/edit/delete are wired per row variant, so a synthetic id is
//     never handed to an endpoint that only accepts real ones.
// Keep suggestions a sibling prop. Merging the arrays breaks all three at once.
//
// THE ONE-LOOP BUDGET for this surface is spent on `LIVE_DOT` (see shapes.ts).
// The spinners on Applying / Activating / Creating are transient progress, not
// ambient loops, and end with their operation.
//
// The row cascade is `staggerRows`/`staggerRowItem` from lib/motion.ts (80ms
// row step — NOT the 120ms card step, and not the mock's literal 60ms), nested
// under this card's own `staggerItem` in the page-level cascade: variants only,
// no local `initial`/`animate`, so the sequence inherits the parent clock.
// Reduced motion is handled globally by `<MotionConfig reducedMotion="user">`.

/** The destructive pill, from the button variant — matches
 *  `sms/delete-dialogs.tsx`'s `DESTRUCTIVE_ACTION`/`CANCEL_ACTION` constants. */
const DESTRUCTIVE_ACTION = cn(
  buttonVariants({ variant: "destructive" }),
  PILL_ACTION,
);
const CANCEL_ACTION = PILL_ACTION_PLAIN;

/** The row's own action pill. Shorter than the page-header `PILL_ACTION`
 *  because it sits inside a row footer rather than a page header — the mock
 *  draws it at 36px. Height is the only thing that differs. */
const ROW_ACTION = "h-9 gap-2 rounded-pill px-4 text-[0.8125rem] font-medium";

/**
 * The overflow trigger. 28px visually (the mock's figure translates onto the
 * existing `size-7` step), expanded to a 44px target on a coarse pointer so a
 * tablet in the field can actually hit it. `pointer:coarse` rather than a
 * viewport breakpoint: it is the input device that decides the target size.
 */
const ROW_MENU_TRIGGER =
  "text-on-surface-variant size-7 rounded-pill [@media(pointer:coarse)]:size-11";

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
 * A minute-resolution clock for the schedule sentence and the mini-bar.
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

/** True when a scenario writes a band lock of any kind. */
function scenarioLocksBands(scenario: ConnectionScenario | null): boolean {
  if (!scenario) return false;
  const { lte_bands, nsa_nr_bands, sa_nr_bands } = scenario.config;
  return Boolean(lte_bands || nsa_nr_bands || sa_nr_bands);
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
   * ADDED. Full scenario records, used only to resolve a bound scenario's
   * identity glyph and whether it locks bands. Optional and degrades cleanly:
   * without it the row still names the scenario (via `useScenarioList`), it
   * just shows the generic `route` glyph and no "Locks bands" chip.
   */
  scenarios?: ConnectionScenario[];
  /**
   * ADDED. Re-run the apply sequence for a profile whose last apply came back
   * `partial`. The backend can only re-run ALL FOUR steps, so the affordance is
   * "Reapply profile", never a per-step retry.
   */
  onReapply?: (id: string) => void;
  /**
   * ADDED, test seam only. Freezes the schedule clock. Omit in the app and the
   * component ticks its own minute clock.
   */
  now?: Date;
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
  currentIccid = null,
  lastApplyState = null,
  suggestions = [],
  creatingSuggestionId = null,
  suggestionError = null,
  onCreateSuggestion,
  scenarios,
  onReapply,
  now,
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
    // skeleton early and let pills pop in a beat after the rows.
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

  // One skeleton, gated on BOTH the summary fetch and the detail prefetch.
  const showSkeleton =
    (isLoading && profiles.length === 0) ||
    (profiles.length > 0 && !detailsHydrated);

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

  // Which scenario a suggestion WILL bind, resolved the same way the create
  // path resolves it (see useProfileSuggestions): a `custom-*` scenario named
  // by the recipe only when a band lock actually survives intersection with
  // the modem's supported bands, otherwise the built-in default. Showing this
  // on the row is the honest disclosure — binding a `custom-*` scenario is what
  // disables the manual Band Locking page.
  const suggestionScenarioName = React.useCallback(
    (view: SuggestionView) => {
      const hasBandLock = view.nsaBands.length > 0 || view.saBands.length > 0;
      return hasBandLock && view.suggestion.scenario_name
        ? view.suggestion.scenario_name
        : nameForId(DEFAULT_SCENARIO_BINDING.default);
    },
    [nameForId],
  );

  // The band rationale keys off the RECIPE, not the intersected result: a
  // suggestion that recommends bands still deserves the explanation even when
  // none survived, because the "Auto" pills it renders are that outcome.
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
    return <EmptyProfileViewComponent onRefresh={onRefresh} />;
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
            {/* A COUNT, not a status — `secondary`, never one of the five
                status roles, and no glyph (the Every-Chip-Has-A-Glyph rule
                governs status chips). */}
            <Badge variant="secondary" className={cn("px-2.5", MACHINE_VALUE)}>
              {profiles.length}
            </Badge>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {/* A failed GET here is usually transient AT-lock contention (another
            poller/CGI call holding the shared lock for a cycle), never a
            reason to blank an already-populated list — the list below FREEZES
            on whatever it last had, and this banner explains why it stopped
            moving. Mirrors the Carrier Aggregation precedent and
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
                  // the hero ribbon read, so the row can never disagree with
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

                  {/* Suggestions pair up side by side once the card is wide
                      enough; a lone suggestion takes the full width and is
                      indistinguishable in footprint from a saved row. The
                      dashed border is what identifies them — no section label,
                      no preamble. Container query, not viewport: this card
                      sits in a two-column page grid, so `md:` would lie about
                      how much room it actually has. */}
                  <motion.div
                    variants={staggerRows}
                    className={cn(
                      "grid items-stretch gap-3",
                      // @xl (576px) not @md: at 448px each column would be
                      // ~215px, narrower than a single APN pill, and the
                      // footer's label + Create button would collide.
                      suggestions.length > 1 && "@xl/card:grid-cols-2",
                    )}
                  >
                    {suggestions.map((view) => (
                      <SuggestionRow
                        key={view.suggestion.id}
                        view={view}
                        scenarioName={suggestionScenarioName(view)}
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
          trigger now lives in each row's overflow menu; the dialog itself is
          unchanged and still owned here, keyed off `pendingDelete`. */}
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
// Profile row — one self-contained panel in the stacked list.
// -----------------------------------------------------------------------------
// Sections, top to bottom (mock 258–301): identity + status + overflow, the
// schedule sentence, the condensed schedule bar, the config pills, the mismatch
// notice, and the footer (updated date + apply breadcrumb, then the actions).
const ProfileRow = ({
  summary,
  status,
  liveScenarioName,
  liveScenario,
  now,
  busy,
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
   *  generic `route` glyph and hides the band-lock chip. */
  liveScenario: ConnectionScenario | null;
  now: Date;
  busy: boolean;
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
  const tone = profileRowTone(status);
  const locksBands = scenarioLocksBands(liveScenario);

  return (
    <motion.div
      variants={staggerRowItem}
      className={cn(
        PROFILE_ROW_SHAPE.ROOT,
        "transition-colors duration-[var(--duration-standard)] ease-standard motion-reduce:transition-none",
        tone,
      )}
    >
      {/* --- 1. Identity + status + overflow ---------------------------- */}
      <div className="flex items-start justify-between gap-3">
        <div className="grid min-w-0 gap-0.5">
          <div className="flex min-w-0 items-center gap-2">
            {status === "active" && (
              // The surface's ONLY ambient loop (shapes.ts > LIVE_DOT).
              <span className={LIVE_DOT.ROOT} aria-hidden>
                <span className={LIVE_DOT.RING} />
                <span className={LIVE_DOT.CORE} />
              </span>
            )}
            {/* User-supplied name: min-w-0 + truncate at every level. */}
            <span className="min-w-0 truncate text-[0.9375rem] font-semibold">
              {summary.name}
            </span>
          </div>
          {summary.mno && (
            <span className="text-on-surface-variant min-w-0 truncate text-xs">
              {summary.mno}
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <StatusBadge status={busy ? "applying" : status} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={ROW_MENU_TRIGGER}
                aria-label={t("custom_profiles.view.row_menu_aria", {
                  name: summary.name,
                })}
              >
                <MaterialSymbol name="more_vert" size={18} aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onClick={onEdit}>
                <MaterialSymbol name="edit" size={16} aria-hidden />
                {t("custom_profiles.table.actions_menu.edit")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                <MaterialSymbol name="delete" size={16} aria-hidden />
                {t("custom_profiles.table.actions_menu.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* --- 2. Schedule sentence --------------------------------------- */}
      {/* A scheduled profile says which scenario is live NOW and how many
          blocks it has; an unscheduled one says the scenario is simply always
          on. The scenario's own identity glyph leads when the page supplied
          the scenario records, since that is the same glyph the scenario tile
          carries — otherwise the generic schedule/route pair. */}
      <div className="text-on-surface-variant flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 text-xs">
        <MaterialSymbol
          name={
            liveScenario
              ? resolveScenarioIcon(liveScenario.icon)
              : scheduled
                ? "schedule"
                : "route"
          }
          size={15}
          aria-hidden
          className="shrink-0"
        />
        <span className="min-w-0 truncate">
          {scheduled
            ? t("custom_profiles.view.schedule_live", {
                scenario: liveScenarioName,
                count: blocks,
              })
            : t("custom_profiles.view.scenario_always_on", {
                scenario: liveScenarioName,
              })}
        </span>
        {locksBands && (
          <span
            className={cn(SCENARIO_META_CHIP, CONFIG_PILL_NEUTRAL, "shrink-0")}
          >
            <MaterialSymbol name="lock" size={13} aria-hidden />
            {t("custom_profiles.view.locks_bands")}
          </span>
        )}
      </div>

      {/* --- 3. Condensed schedule bar ---------------------------------- */}
      {/* Shared timeline math with the hero ribbon — one function, so the two
          can never disagree about where a block starts. */}
      {scheduled && (
        <ScheduleMiniBar
          schedule={schedule}
          fallbackScenarioId={summary.scenario.default}
          now={now}
        />
      )}

      {/* --- 4. Config pills -------------------------------------------- */}
      {/* Prefetched by the view, so the pills arrive with the row as part of
          its entrance rather than as a second loading state. */}
      {full && <ConfigPills profile={full} />}

      {/* --- 5. SIM mismatch note --------------------------------------- */}
      {status === "mismatch" && (
        <TonalBanner tone="warning" icon="warning" size="compact">
          {t("custom_profiles.view.mismatch_note")}
        </TonalBanner>
      )}

      {/* --- 6. Footer: audit breadcrumb + actions ---------------------- */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-0.5">
        <div className="grid min-w-0 gap-0.5">
          <span className="text-on-surface-variant text-xs">
            {t("custom_profiles.card.label_updated")}{" "}
            {formatProfileDate(summary.updated_at)}
          </span>
          {auditStatus && (
            // `text-{role}-on-surface`, never bare `text-{role}` — the bare
            // token is a FILL tuned to sit under `-foreground` ink. The mock
            // reaches for `var(--wa)` here and that is the exact mistake.
            <span
              className={cn(
                "text-xs",
                auditStatus === "failed"
                  ? "text-destructive-on-surface font-medium"
                  : auditStatus === "partial"
                    ? "text-warning-on-surface font-medium"
                    : "text-on-surface-variant",
              )}
            >
              {auditStatus === "complete"
                ? t("custom_profiles.view.audit.applied", { time: auditTime })
                : auditStatus === "partial"
                  ? t("custom_profiles.view.audit.partial", { time: auditTime })
                  : t("custom_profiles.view.audit.failed", { time: auditTime })}
            </span>
          )}
          {/* State honesty: the backend re-runs the WHOLE four-step sequence,
              so the copy says so rather than implying a per-step retry. */}
          {auditStatus === "partial" && onReapply && (
            <span className="text-on-surface-variant text-xs">
              {t("custom_profiles.view.reapply_hint")}
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {auditStatus === "partial" && onReapply && (
            <Button
              variant="tonal"
              className={ROW_ACTION}
              onClick={onReapply}
              disabled={busy}
            >
              <MaterialSymbol name="restart_alt" size={16} aria-hidden />
              {t("custom_profiles.view.reapply")}
            </Button>
          )}
          {isActive ? (
            <Button
              variant="secondary"
              className={ROW_ACTION}
              onClick={onDeactivate}
            >
              <MaterialSymbol
                name="power_settings_new"
                size={16}
                aria-hidden
              />
              {t("custom_profiles.table.actions_menu.deactivate")}
            </Button>
          ) : (
            <Button
              className={ROW_ACTION}
              onClick={onActivate}
              disabled={busy}
            >
              <MaterialSymbol
                name={busy ? "progress_activity" : "play_arrow"}
                size={16}
                aria-hidden
                className={cn(
                  busy && "animate-spin motion-reduce:animate-none",
                )}
              />
              {busy
                ? t("custom_profiles.view.activating")
                : t("custom_profiles.table.actions_menu.activate")}
            </Button>
          )}
        </div>
      </div>
    </motion.div>
  );
};

// -----------------------------------------------------------------------------
// Status badge — filled tonal chip via PROFILE_STATUS_BADGE (shapes.ts). Tone
// keys onto `BadgeVariant`, so a status without a matching role fails the
// build instead of shipping untinted. Every state in this one slot carries a
// DISTINCT glyph.
// -----------------------------------------------------------------------------
type RowBadgeStatus = ProfileStatus | "applying";

const STATUS_LABEL_KEY: Record<RowBadgeStatus, string> = {
  active: "custom_profiles.table.status_badge.active",
  mismatch: "custom_profiles.table.status_badge.sim_mismatch",
  inactive: "custom_profiles.table.status_badge.inactive",
  // Reuses the apply dialog's own label rather than minting a second
  // "Applying…" string that could drift from it in translation.
  applying: "custom_profiles.apply_dialog.status_badge.applying",
};

const StatusBadge = ({ status }: { status: RowBadgeStatus }) => {
  const { t } = useTranslation("cellular");
  const meta = PROFILE_STATUS_BADGE[status];
  return (
    <Badge variant={meta.variant}>
      <MaterialSymbol
        name={meta.glyph}
        size={BADGE_GLYPH_SIZE}
        aria-hidden
        className={cn(meta.spin && "animate-spin motion-reduce:animate-none")}
      />
      {t(STATUS_LABEL_KEY[status])}
    </Badge>
  );
};

// -----------------------------------------------------------------------------
// Suggestion row — a carrier recommendation, shaped as a peer of ProfileRow.
// -----------------------------------------------------------------------------
// Structurally identical to a saved row (same radius, padding, motion, and the
// same content bands) so it reads as an ordinary entry. Four differences carry
// the honesty, and none of them rely on colour alone:
//   - the border is DASHED, this codebase's existing vocabulary for a thing
//     that does not exist yet;
//   - the status slot reads "Suggested" where a saved row reads Active/Inactive;
//   - there is no overflow menu, because there is nothing yet to edit or delete;
//   - the footer verb is Create, not Activate, and it says "Not saved yet".
const SuggestionRow = ({
  view,
  scenarioName,
  isCreating,
  disabled,
  onCreate,
}: {
  view: SuggestionView;
  /** Scenario this suggestion will bind once created. */
  scenarioName: string;
  isCreating: boolean;
  /** True while ANY suggestion is being created — the create path is serial. */
  disabled: boolean;
  onCreate: () => void;
}) => {
  const { t } = useTranslation("cellular");
  const { suggestion, nsaBands, saBands } = view;
  const recommendsBands =
    suggestion.nsa_nr_bands.length > 0 || suggestion.sa_nr_bands.length > 0;

  return (
    <motion.div
      variants={staggerRowItem}
      className={cn(
        PROFILE_ROW_SHAPE.ROOT,
        "h-full",
        "transition-colors duration-[var(--duration-standard)] ease-standard motion-reduce:transition-none",
        SUGGESTION_ROW,
      )}
    >
      {/* Identity + status */}
      <div className="flex items-start justify-between gap-3">
        <div className="grid min-w-0 gap-0.5">
          <span className="min-w-0 truncate text-[0.9375rem] font-semibold">
            {suggestion.label}
          </span>
          <span className="text-on-surface-variant min-w-0 truncate text-xs">
            {suggestion.mno}
          </span>
        </div>
        <Badge variant="info" className="shrink-0">
          <MaterialSymbol
            name="auto_awesome"
            size={BADGE_GLYPH_SIZE}
            aria-hidden
          />
          {t("custom_profiles.suggestions.badge")}
        </Badge>
      </div>

      {/* What WILL be bound on create. A suggestion never schedules. */}
      <div className="text-on-surface-variant flex min-w-0 items-center gap-2 text-xs">
        <MaterialSymbol name="route" size={15} aria-hidden className="shrink-0" />
        <span className="min-w-0 truncate">
          {t("custom_profiles.suggestions.will_bind", {
            scenario: scenarioName,
          })}
        </span>
      </div>

      {/* Config readout — same pill vocabulary as a saved row. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Pill mono>
          {t("custom_profiles.pills.apn", { name: suggestion.apn_name })}
        </Pill>
        <Pill mono>{t("custom_profiles.pills.cid", { cid: suggestion.cid })}</Pill>
        <Pill mono>
          {PDP_PILL_KEY[suggestion.pdp_type]
            ? t(PDP_PILL_KEY[suggestion.pdp_type])
            : suggestion.pdp_type}
        </Pill>
        {suggestion.ttl > 0 && (
          <Pill mono>{t("custom_profiles.pills.ttl", { value: suggestion.ttl })}</Pill>
        )}
        {suggestion.hl > 0 && (
          <Pill mono>{t("custom_profiles.pills.hl", { value: suggestion.hl })}</Pill>
        )}
      </div>

      {/* Band lock — rendered only when this recipe actually recommends bands.
          Most carriers here are APN + TTL/HL only, and a row of "Auto / Auto"
          pills on those would imply a band decision was made when none was. */}
      {recommendsBands && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Pill tone="brand" mono>
            {nsaBands.length > 0
              ? t("custom_profiles.suggestions.bands_nsa", {
                  bands: nsaBands.join(", "),
                })
              : t("custom_profiles.suggestions.bands_nsa_auto")}
          </Pill>
          <Pill tone="brand" mono>
            {saBands.length > 0
              ? t("custom_profiles.suggestions.bands_sa", {
                  bands: saBands.join(", "),
                })
              : t("custom_profiles.suggestions.bands_sa_auto")}
          </Pill>
        </div>
      )}

      {/* `mt-auto` pushes the footer down so paired suggestions of unequal
          height still line their Create buttons up. */}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-0.5">
        <span className="text-on-surface-variant text-xs">
          {t("custom_profiles.suggestions.not_saved_yet")}
        </span>
        <Button
          className={cn(ROW_ACTION, "shrink-0")}
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
// Config pills — dense tonal tags describing what a profile does.
// -----------------------------------------------------------------------------
// neutral = routine identity labels; brand = a setting that carries consequence
// (an IMEI rewrite reboots the modem on activation) or one the recipe actively
// recommends (band locks). These are IDENTITY pills, never a status role — a
// `success` pill here would claim a health the value does not report. `mono`
// marks a machine-voice value; a human-written label stays proportional.
const Pill = ({
  children,
  tone = "neutral",
  mono = false,
  glyph,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "brand";
  mono?: boolean;
  glyph?: React.ReactNode;
}) => (
  <span
    className={cn(
      CONFIG_PILL,
      tone === "brand" ? CONFIG_PILL_BRAND : CONFIG_PILL_NEUTRAL,
      mono && MACHINE_VALUE,
    )}
  >
    {glyph}
    {children}
  </span>
);

const PDP_PILL_KEY: Record<PdpType, string> = {
  IP: "custom_profiles.pills.ip_v4",
  IPV6: "custom_profiles.pills.ip_v6",
  IPV4V6: "custom_profiles.pills.ip_dual",
};

const ConfigPills = ({ profile }: { profile: SimProfile }) => {
  const { t } = useTranslation("cellular");
  const { apn, imei, ttl, hl } = profile.settings;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Pill mono>
        {apn.name.trim()
          ? t("custom_profiles.pills.apn", { name: apn.name })
          : t("custom_profiles.pills.apn_default")}
      </Pill>
      {/* A 0 or empty value means "don't set" — printing "TTL 0" would be a
          claim about the config that is simply untrue, so the pill is omitted
          instead. Same rule for CID, which is never 0 in practice but is
          guarded for symmetry. */}
      {apn.cid > 0 && (
        <Pill mono>{t("custom_profiles.pills.cid", { cid: apn.cid })}</Pill>
      )}
      <Pill mono>
        {PDP_PILL_KEY[apn.pdp_type]
          ? t(PDP_PILL_KEY[apn.pdp_type])
          : apn.pdp_type}
      </Pill>
      {ttl > 0 && <Pill mono>{t("custom_profiles.pills.ttl", { value: ttl })}</Pill>}
      {hl > 0 && <Pill mono>{t("custom_profiles.pills.hl", { value: hl })}</Pill>}
      {imei.trim() !== "" && (
        <Pill
          tone="brand"
          glyph={<MaterialSymbol name="fingerprint" size={13} aria-hidden />}
        >
          {t("custom_profiles.pills.imei_override")}
        </Pill>
      )}
    </div>
  );
};

// -----------------------------------------------------------------------------
// Loading affordance — shaped to the populated row BY IMPORTING ITS SHAPES.
// -----------------------------------------------------------------------------
// The previous skeleton restated `h-3.5 w-32` / `size-7` / `h-5 w-24` as
// literals, which is precisely the drift `shapes.ts` exists to prevent: a
// change to `CONFIG_PILL`'s height or `RIBBON_MINI`'s track silently left the
// skeleton behind. Every structural value here now comes from the same
// constant the loaded row reads — `PROFILE_ROW_SHAPE.ROOT`, `LIVE_DOT.ROOT`,
// `CONFIG_PILL`, `RIBBON_MINI.ROOT`/`SEGMENT`, `ROW_ACTION` — and only the
// horizontal RUN LENGTHS (how much text a placeholder stands in for) are
// stated locally, because a run length mirrors content, not geometry.
//
// There is deliberately no single pinned height: the row's rendered height
// varies with content, so one figure would mirror nothing and make the
// handoff jump worse than mirroring section-by-section does.
// -----------------------------------------------------------------------------

/**
 * A placeholder shaped exactly like a config pill: it takes `CONFIG_PILL`
 * itself and holds an invisible space, so its height is derived from the pill's
 * own padding and text size rather than from a restated `h-5`.
 */
const PillSkeleton = ({ w }: { w: string }) => (
  <Skeleton className={cn(CONFIG_PILL, w)}>
    <span className="invisible">&nbsp;</span>
  </Skeleton>
);

const SkeletonRow = () => (
  <div className={cn(PROFILE_ROW_SHAPE.ROOT, "bg-surface-container")}>
    {/* Identity + status + overflow */}
    <div className="flex items-start justify-between gap-3">
      <div className="grid gap-1.5">
        <div className="flex items-center gap-2">
          <Skeleton className={cn(LIVE_DOT.ROOT, "rounded-pill")} />
          <Skeleton className="h-3.5 w-32" />
        </div>
        <Skeleton className="h-3 w-16" />
      </div>
      <div className="flex items-center gap-2">
        <Skeleton className="h-5 w-16 rounded-pill" />
        <Skeleton className={ROW_MENU_TRIGGER} />
      </div>
    </div>

    {/* Schedule sentence */}
    <div className="flex items-center gap-2">
      <Skeleton className="size-[0.9375rem] shrink-0 rounded-pill" />
      <Skeleton className="h-3 w-44" />
    </div>

    {/* Condensed schedule bar — same track and segment shapes the real one
        uses, so the two can never drift on height or gap. */}
    <div className={RIBBON_MINI.ROOT}>
      {[7, 11, 5, 1].map((flex, i) => (
        <Skeleton
          key={i}
          className={cn(RIBBON_MINI.SEGMENT, "h-full")}
          style={{ flex }}
        />
      ))}
    </div>

    {/* Config pills */}
    <div className="flex flex-wrap items-center gap-1.5">
      <PillSkeleton w="w-32" />
      <PillSkeleton w="w-16" />
      <PillSkeleton w="w-20" />
      <PillSkeleton w="w-16" />
    </div>

    {/* Footer */}
    <div className="flex items-center justify-between gap-3 pt-0.5">
      <Skeleton className="h-3 w-28" />
      <Skeleton className={cn(ROW_ACTION, "w-28")} />
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
