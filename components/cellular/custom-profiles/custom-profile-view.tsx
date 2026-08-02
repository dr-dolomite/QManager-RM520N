"use client";

import React from "react";
import { toast } from "sonner";
import { motion, useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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

import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import EmptyProfileViewComponent from "@/components/cellular/custom-profiles/empty-profile";
import { useSimProfiles } from "@/hooks/use-sim-profiles";
import { useScenarioList } from "@/hooks/use-scenario-list";
import type { SuggestionView } from "@/hooks/use-profile-suggestions";
import {
  DEFAULT_SCENARIO_BINDING,
  formatProfileDate,
  type ProfileApplyState,
  type ProfileSummary,
  type SimProfile,
  type PdpType,
} from "@/types/sim-profile";
import { DUR, EASE_STANDARD, rowCascadeDelay } from "@/lib/motion";

// =============================================================================
// CustomProfileViewComponent — Saved Profiles list (stacked-row design)
// =============================================================================
// Ported from the RM551E stacked-card row list and bound to RM520N's flat
// coordinator prop contract. The coordinator (custom-profile.tsx) owns the
// Activate/Deactivate CONFIRMATION dialogs and the ApplyProgressDialog — the
// row's primary action simply calls onActivate(id) / onDeactivate(). This view
// owns only the destructive delete-confirm dialog.
//
// Data-shape note: list.sh returns summaries only (no APN/CID/PDP/TTL/HL/IMEI),
// so each row's ConfigPills need the full profile. We prefetch every profile's
// detail up front via the hook's getProfile() and hold ONE list skeleton until
// they all land, so rows arrive fully populated instead of double-shimmering.
// SIM-mismatch is a best-effort naive string compare of profile.sim_iccid vs
// the live ICCID — never canonicalized client-side, WARNING only, never blocks.
//
// Suggestions ("Recommended for your SIM") render as ROWS IN THIS LIST but are
// never merged into `profiles`. That separation is load-bearing, and it is what
// makes an in-list suggestion safe at all:
//   - the header count badge reads `profiles.length`, so it never claims a
//     suggestion is stored;
//   - the detail prefetch below maps over `profiles`, so it never fires a CGI
//     GET for an id that resolves to nothing;
//   - activate/edit/delete are wired per row variant, so a synthetic id is
//     never handed to an endpoint that only accepts real ones.
// Keep suggestions a sibling prop. Merging the arrays breaks all three at once.

// The row cascade (step + cap) lives on `rowCascadeDelay` in lib/motion.ts, so
// a long roster never plays a long load cascade and the step stays on the scale.

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

interface CustomProfileViewProps {
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
}: CustomProfileViewProps) => {
  const { t } = useTranslation("cellular");
  const reduceMotion = useReducedMotion();
  const { nameForId } = useScenarioList();

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
            <Badge
              variant="outline"
              className="text-muted-foreground tabular-nums"
            >
              {profiles.length}
            </Badge>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
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
                <p className="text-muted-foreground text-xs">
                  {t("custom_profiles.view.none_saved_yet")}
                </p>
              )}

              {ordered.map((profile, i) => {
                const audit =
                  lastApplyState &&
                  lastApplyState.profile_id === profile.id &&
                  TERMINAL_APPLY.includes(lastApplyState.status as AuditStatus)
                    ? (lastApplyState.status as AuditStatus)
                    : null;
                const busy =
                  lastApplyState?.profile_id === profile.id &&
                  lastApplyState?.status === "applying";
                return (
                  <ProfileRow
                    key={profile.id}
                    summary={profile}
                    status={deriveStatus(
                      profile.id === activeProfileId,
                      profile.sim_iccid,
                      currentIccid,
                    )}
                    index={i}
                    reduceMotion={!!reduceMotion}
                    scenarioName={nameForId(profile.scenario.default)}
                    busy={!!busy}
                    auditStatus={audit}
                    auditTime={
                      audit ? formatAppliedTime(lastApplyState!.started_at) : ""
                    }
                    full={details[profile.id] ?? null}
                    onActivate={() => onActivate(profile.id)}
                    onDeactivate={onDeactivate}
                    onEdit={() => onEdit(profile.id)}
                    onDelete={() => setPendingDelete(profile)}
                  />
                );
              })}

              {suggestions.length > 0 && (
                <>
                  {suggestionError && (
                    <Alert variant="destructive">
                      <MaterialSymbol name="error" size={16} />
                      <AlertDescription>{suggestionError}</AlertDescription>
                    </Alert>
                  )}

                  {/* Suggestions pair up side by side once the card is wide
                      enough; a lone suggestion takes the full width and is
                      indistinguishable in footprint from a saved row. The
                      dashed border is what identifies them — no section label,
                      no preamble. Container query, not viewport: this card
                      sits in a two-column page grid, so `md:` would lie about
                      how much room it actually has. */}
                  <div
                    className={cn(
                      "grid items-stretch gap-3",
                      // @xl (576px) not @md: at 448px each column would be
                      // ~215px, narrower than a single APN pill, and the
                      // footer's label + Create button would collide.
                      suggestions.length > 1 && "@xl/card:grid-cols-2",
                    )}
                  >
                    {suggestions.map((view, i) => (
                      <SuggestionRow
                        key={view.suggestion.id}
                        view={view}
                        // Index continues the saved rows so the entrance plays
                        // as one cascade down a single list, not two.
                        index={ordered.length + i}
                        reduceMotion={!!reduceMotion}
                        scenarioName={suggestionScenarioName(view)}
                        isCreating={creatingSuggestionId === view.suggestion.id}
                        disabled={creatingSuggestionId !== null}
                        onCreate={() => onCreateSuggestion?.(view.suggestion.id)}
                      />
                    ))}
                  </div>

                  {/* Honest rationale. Carries the safety note that a band lock
                      narrows the radio, and that both it and the TTL/HL change
                      are undone by deactivating. */}
                  <div className="text-muted-foreground flex flex-col gap-1.5 pt-1 text-xs">
                    {hasBandRecipe && (
                      <p className="flex items-start gap-2">
                        <MaterialSymbol name="info" size={14} className="mt-px shrink-0" />
                        <span>
                          {t("custom_profiles.suggestions.rationale_bands")}
                        </span>
                      </p>
                    )}
                    <p className="flex items-start gap-2">
                      <MaterialSymbol name="info" size={14} className="mt-px shrink-0" />
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

        {error && !showSkeleton && (
          <p className="text-destructive mt-3 text-xs">{error}</p>
        )}
      </CardContent>

      {/* Delete confirmation — destructive, so it always asks first. */}
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
            <AlertDialogCancel disabled={isDeleting}>
              {t("custom_profiles.view.delete_keep")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmDelete();
              }}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive/20"
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
const ProfileRow = ({
  summary,
  status,
  index,
  reduceMotion,
  scenarioName,
  busy,
  auditStatus,
  auditTime,
  full,
  onActivate,
  onDeactivate,
  onEdit,
  onDelete,
}: {
  summary: ProfileSummary;
  status: ProfileStatus;
  index: number;
  reduceMotion: boolean;
  scenarioName: string;
  busy: boolean;
  auditStatus: AuditStatus | null;
  auditTime: string;
  /** Full config, prefetched by the view so the row arrives populated. */
  full: SimProfile | null;
  onActivate: () => void;
  onDeactivate: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) => {
  const { t } = useTranslation("cellular");
  const isActive = status !== "inactive";
  const scheduled = summary.scenario.schedule.enabled;

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: DUR.standard,
        delay: rowCascadeDelay(index),
        ease: EASE_STANDARD,
      }}
      className={cn(
        "flex flex-col gap-3 rounded-lg border p-3",
        "transition-colors duration-[var(--duration-standard)] ease-standard motion-reduce:transition-none",
        status === "active" && "border-success/40 bg-success/5",
        status === "mismatch" && "border-warning/40 bg-warning/5",
        status === "inactive" && "bg-muted/20",
      )}
    >
      {/* Identity + status + overflow */}
      <div className="flex items-start justify-between gap-3">
        <div className="grid min-w-0 gap-0.5">
          <div className="flex items-center gap-1.5">
            {status === "active" && (
              // Live-ping: a solid dot with a pulsing halo behind it (the system
              // pulse-ring keyframe, disabled under reduced motion via globals).
              <span className="relative flex size-1.5 shrink-0" aria-hidden>
                <span className="bg-success/50 animate-pulse-ring absolute inline-flex size-full rounded-full" />
                <span className="bg-success relative inline-flex size-1.5 rounded-full" />
              </span>
            )}
            <span className="truncate text-sm font-semibold">
              {summary.name}
            </span>
          </div>
          {summary.mno && (
            <span className="text-muted-foreground truncate text-xs">
              {summary.mno}
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <StatusBadge status={status} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground size-7"
                aria-label={t("custom_profiles.table.actions_menu.open_menu")}
              >
                <MaterialSymbol name="more_vert" size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onClick={onEdit}>
                <MaterialSymbol name="edit" size={16} />
                {t("custom_profiles.table.actions_menu.edit")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                <MaterialSymbol name="delete" size={16} />
                {t("custom_profiles.table.actions_menu.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Scenario binding line */}
      <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
        {scheduled ? (
          <MaterialSymbol name="schedule" size={14} className="shrink-0" />
        ) : (
          <MaterialSymbol name="route" size={14} className="shrink-0" />
        )}
        <span className="truncate">
          {scheduled
            ? t("custom_profiles.view.scenario_scheduled", {
                scenario: scenarioName,
              })
            : t("custom_profiles.view.scenario_always_on", {
                scenario: scenarioName,
              })}
        </span>
      </div>

      {/* Config readout — prefetched by the view, so the pills arrive with the
          row as part of its entrance rather than as a second loading state. */}
      {full && <ConfigPills profile={full} />}

      {/* SIM mismatch note — only when the active profile no longer matches SIM */}
      {status === "mismatch" && (
        <div className="text-warning bg-warning/10 flex items-start gap-2 rounded-md p-2 text-xs">
          <MaterialSymbol name="warning" size={14} className="mt-px shrink-0" />
          <span>{t("custom_profiles.view.mismatch_note")}</span>
        </div>
      )}

      {/* Action footer: updated date + per-row audit line + primary action */}
      <div className="flex items-center justify-between gap-3 pt-0.5">
        <div className="grid min-w-0 gap-0.5">
          <span className="text-muted-foreground text-xs">
            {t("custom_profiles.card.label_updated")}{" "}
            {formatProfileDate(summary.updated_at)}
          </span>
          {auditStatus && (
            <span
              className={cn(
                "text-xs",
                auditStatus === "failed"
                  ? "text-destructive"
                  : auditStatus === "partial"
                    ? "text-warning"
                    : "text-muted-foreground",
              )}
            >
              {auditStatus === "complete"
                ? t("custom_profiles.view.audit.applied", {
                    time: auditTime,
                    defaultValue: "Applied at {{time}}",
                  })
                : auditStatus === "partial"
                  ? t("custom_profiles.view.audit.partial", {
                      time: auditTime,
                      defaultValue: "Partial apply at {{time}}",
                    })
                  : t("custom_profiles.view.audit.failed", {
                      time: auditTime,
                      defaultValue: "Apply failed at {{time}}",
                    })}
            </span>
          )}
        </div>
        {isActive ? (
          <Button
            variant="secondary"
            size="sm"
            className="shrink-0"
            onClick={onDeactivate}
          >
            <MaterialSymbol name="power_settings_new" size={16} />
            {t("custom_profiles.table.actions_menu.deactivate")}
          </Button>
        ) : (
          <Button
            size="sm"
            className="shrink-0"
            onClick={onActivate}
            disabled={busy}
          >
            {busy ? (
              <MaterialSymbol
                name="progress_activity"
                size={16}
                className="animate-spin motion-reduce:animate-none"
              />
            ) : (
              <MaterialSymbol name="play_arrow" size={16} />
            )}
            {busy
              ? t("custom_profiles.view.activating")
              : t("custom_profiles.table.actions_menu.activate")}
          </Button>
        )}
      </div>
    </motion.div>
  );
};

// -----------------------------------------------------------------------------
// Status badge — outline pattern per DESIGN.md (bg/15 text border/30 + size-3).
// -----------------------------------------------------------------------------
const StatusBadge = ({ status }: { status: ProfileStatus }) => {
  const { t } = useTranslation("cellular");
  if (status === "active") {
    return (
      <Badge variant="success">
        <MaterialSymbol name="check_circle" size={12} />
        {t("custom_profiles.table.status_badge.active")}
      </Badge>
    );
  }
  if (status === "mismatch") {
    return (
      <Badge variant="warning">
        <MaterialSymbol name="warning" size={12} />
        {t("custom_profiles.table.status_badge.sim_mismatch")}
      </Badge>
    );
  }
  return (
    <Badge variant="muted">
      <MaterialSymbol name="do_not_disturb_on" size={12} />
      {t("custom_profiles.table.status_badge.inactive")}
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
//     that does not exist yet (add-scenario-item, the Empty primitive). It is
//     legible at a glance, survives greyscale, and costs no vertical space —
//     which is what lets the section label above it go away;
//   - the status slot reads "Suggested" where a saved row reads Active/Inactive;
//   - there is no overflow menu, because there is nothing yet to edit or delete;
//   - the footer verb is Create, not Activate, and it says "Not saved yet".
// `h-full` + `mt-auto` on the footer keep the Create buttons on one baseline
// when two suggestions sit side by side with unequal pill counts.
const SuggestionRow = ({
  view,
  index,
  reduceMotion,
  scenarioName,
  isCreating,
  disabled,
  onCreate,
}: {
  view: SuggestionView;
  index: number;
  reduceMotion: boolean;
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
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: DUR.standard,
        delay: rowCascadeDelay(index),
        ease: EASE_STANDARD,
      }}
      className={cn(
        "flex h-full flex-col gap-3 rounded-lg border border-dashed p-3",
        "transition-colors duration-[var(--duration-standard)] ease-standard motion-reduce:transition-none",
        "border-info/40 bg-info/5",
      )}
    >
      {/* Identity + status */}
      <div className="flex items-start justify-between gap-3">
        <div className="grid min-w-0 gap-0.5">
          <span className="truncate text-sm font-semibold">
            {suggestion.label}
          </span>
          <span className="text-muted-foreground truncate text-xs">
            {suggestion.mno}
          </span>
        </div>
        <Badge variant="info"
          className="shrink-0">
          <MaterialSymbol name="auto_awesome" size={12} />
          {t("custom_profiles.suggestions.badge")}
        </Badge>
      </div>

      {/* Scenario binding line — what WILL be bound on create. A suggestion
          never schedules, so this is always the always-on phrasing. */}
      <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
        <MaterialSymbol name="route" size={14} className="shrink-0" />
        <span className="truncate">
          {t("custom_profiles.view.scenario_always_on", {
            scenario: scenarioName,
          })}
        </span>
      </div>

      {/* Config readout — same pill vocabulary as a saved row. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Pill>
          {t("custom_profiles.pills.apn", { name: suggestion.apn_name })}
        </Pill>
        <Pill>{t("custom_profiles.pills.cid", { cid: suggestion.cid })}</Pill>
        <Pill>
          {PDP_PILL_KEY[suggestion.pdp_type]
            ? t(PDP_PILL_KEY[suggestion.pdp_type])
            : suggestion.pdp_type}
        </Pill>
        {suggestion.ttl > 0 && (
          <Pill>{t("custom_profiles.pills.ttl", { value: suggestion.ttl })}</Pill>
        )}
        {suggestion.hl > 0 && (
          <Pill>{t("custom_profiles.pills.hl", { value: suggestion.hl })}</Pill>
        )}
      </div>

      {/* Band lock — rendered only when this recipe actually recommends bands.
          Most carriers here are APN + TTL/HL only, and a row of "Auto / Auto"
          pills on those would imply a band decision was made when none was.
          Where a recipe DOES recommend bands, "Auto" is meaningful: it means
          the modem did not confirm support, so no lock will be written. */}
      {recommendsBands && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Pill tone="info">
            {nsaBands.length > 0
              ? t("custom_profiles.suggestions.bands_nsa", {
                  bands: nsaBands.join(", "),
                })
              : t("custom_profiles.suggestions.bands_nsa_auto")}
          </Pill>
          <Pill tone="info">
            {saBands.length > 0
              ? t("custom_profiles.suggestions.bands_sa", {
                  bands: saBands.join(", "),
                })
              : t("custom_profiles.suggestions.bands_sa_auto")}
          </Pill>
        </div>
      )}

      {/* Action footer — mirrors the saved row's metadata + primary action.
          `mt-auto` pushes it to the bottom so paired suggestions of unequal
          height still line their Create buttons up. */}
      <div className="mt-auto flex items-center justify-between gap-3 pt-0.5">
        <span className="text-muted-foreground text-xs">
          {t("custom_profiles.suggestions.not_saved_yet")}
        </span>
        <Button
          size="sm"
          className="shrink-0"
          onClick={onCreate}
          disabled={disabled}
          aria-label={t("custom_profiles.suggestions.create_aria", {
            name: suggestion.label,
          })}
        >
          {isCreating ? (
            <MaterialSymbol
              name="progress_activity"
              size={16}
              className="animate-spin motion-reduce:animate-none"
            />
          ) : (
            <MaterialSymbol name="add" size={16} />
          )}
          {isCreating
            ? t("custom_profiles.suggestions.creating")
            : t("custom_profiles.suggestions.create")}
        </Button>
      </div>
    </motion.div>
  );
};

// -----------------------------------------------------------------------------
// Config pills — dense outline tags describing what a profile does.
// -----------------------------------------------------------------------------
// neutral = routine settings; info = settings that carry consequence (an IMEI
// rewrite reboots the modem on activation).
const Pill = ({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "info";
}) => (
  <span
    className={cn(
      "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium tabular-nums",
      tone === "info"
        ? "border-info/30 bg-info/10 text-info"
        : "border-border bg-muted/40 text-muted-foreground",
    )}
  >
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
      <Pill>
        {apn.name.trim()
          ? t("custom_profiles.pills.apn", { name: apn.name })
          : t("custom_profiles.pills.apn_default")}
      </Pill>
      <Pill>{t("custom_profiles.pills.cid", { cid: apn.cid })}</Pill>
      <Pill>
        {PDP_PILL_KEY[apn.pdp_type]
          ? t(PDP_PILL_KEY[apn.pdp_type])
          : apn.pdp_type}
      </Pill>
      {ttl > 0 && <Pill>{t("custom_profiles.pills.ttl", { value: ttl })}</Pill>}
      {hl > 0 && <Pill>{t("custom_profiles.pills.hl", { value: hl })}</Pill>}
      {imei.trim() !== "" && (
        <Pill tone="info">{t("custom_profiles.pills.imei_override")}</Pill>
      )}
    </div>
  );
};

// -----------------------------------------------------------------------------
// Loading affordance — shaped to the populated row so there is no reflow when
// content lands. Reduced motion is handled by the Skeleton component itself.
// -----------------------------------------------------------------------------
const SkeletonRow = () => (
  <div className="flex flex-col gap-3 rounded-lg border p-3">
    <div className="flex items-start justify-between gap-3">
      <div className="grid gap-1.5">
        <Skeleton className="h-3.5 w-32" />
        <Skeleton className="h-3 w-16" />
      </div>
      <div className="flex items-center gap-1.5">
        <Skeleton className="h-5 w-16" />
        <Skeleton className="size-7" />
      </div>
    </div>
    <div className="flex items-center gap-1.5">
      <Skeleton className="size-3.5 shrink-0 rounded-full" />
      <Skeleton className="h-3 w-40" />
    </div>
    <div className="flex flex-wrap items-center gap-1.5">
      <Skeleton className="h-5 w-24" />
      <Skeleton className="h-5 w-12" />
      <Skeleton className="h-5 w-16" />
    </div>
    <div className="flex items-center justify-between pt-0.5">
      <Skeleton className="h-3 w-28" />
      <Skeleton className="h-8 w-24" />
    </div>
  </div>
);

const ListSkeleton = () => (
  <div className="flex flex-col gap-3">
    {[0, 1].map((i) => (
      <SkeletonRow key={i} />
    ))}
  </div>
);

export default CustomProfileViewComponent;
