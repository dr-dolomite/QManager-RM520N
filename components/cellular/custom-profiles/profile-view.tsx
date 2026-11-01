"use client";

import React from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import {
  CONDITION_TONE,
  ConditionScreen,
} from "@/components/cellular/condition-screen";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MaterialSymbol,
  type MaterialSymbolName,
} from "@/components/ui/material-symbol";
import { Skeleton } from "@/components/ui/skeleton";
import { Tag } from "@/components/ui/tag";
import { TonalBanner } from "@/components/ui/tonal-banner";
import { staggerRowItem, staggerRows } from "@/lib/motion";
import { cn } from "@/lib/utils";
import EmptyProfileComponent from "./empty-profile";
import { iccidMismatch } from "./sim-match";
import { ScheduleMiniBar } from "./schedule-ribbon";
import {
  BADGE_GLYPH_SIZE,
  MACHINE_VALUE,
  SUGGESTION_ROW,
  SUGGESTION_DISC,
} from "./shapes";
import type { UseSimProfilesReturn } from "@/hooks/use-sim-profiles";
import type { SuggestionView } from "@/hooks/use-profile-suggestions";
import { useScenarioList } from "@/hooks/use-scenario-list";
import {
  formatProfileDate,
  type ProfileSummary,
  type SimProfile,
  type PdpType,
} from "@/types/sim-profile";

// Registry of saved SIM profiles, active first. list.sh returns summaries, so full configs prefetch behind ONE
// skeleton. RM520N's dashed "Recommended" rows stay out of `profiles`; Activate lives in `custom-profile.tsx`.

type ProfileStatus = "active" | "mismatch" | "inactive";

function deriveStatus(
  isActive: boolean,
  profileIccid: string,
  currentIccid: string | null,
): ProfileStatus {
  if (!isActive) return "inactive";
  if (iccidMismatch(profileIccid, currentIccid)) return "mismatch";
  return "active";
}

/** No two states share a glyph (success and warning containers are 1.03:1). */
const STATUS_CHIP: Record<
  ProfileStatus,
  { variant: BadgeVariant; glyph: MaterialSymbolName; key: string }
> = {
  active: {
    variant: "success",
    glyph: "check_circle",
    key: "custom_profiles.table.status_badge.active",
  },
  mismatch: {
    variant: "warning",
    glyph: "warning",
    key: "custom_profiles.table.status_badge.sim_mismatch",
  },
  inactive: {
    variant: "muted",
    glyph: "do_not_disturb_on",
    key: "custom_profiles.table.status_badge.inactive",
  },
};

const ROW =
  "flex flex-col gap-3 rounded-tile bg-surface-container px-4 py-3.5 @3xl/card:px-5";

/** A band chip shows at most this many before collapsing the tail into +N. */
const MAX_BAND_TAGS = 4;

const PDP_PILL_KEY: Record<PdpType, string> = {
  IP: "custom_profiles.pills.ip_v4",
  IPV6: "custom_profiles.pills.ip_v6",
  IPV4V6: "custom_profiles.pills.ip_dual",
};

interface ProfileViewProps {
  sim: UseSimProfilesReturn;
  /** Live SIM ICCID, for mismatch detection. */
  currentIccid: string | null;
  /** Open the wizard on a saved profile. */
  onEdit: (id: string) => void;
  /** Open the wizard on a new profile (the empty state's action). */
  onAdd: () => void;
  /** Activate a row; the page confirms a SIM mismatch and runs the apply. */
  onActivate: (profile: ProfileSummary) => void;
  /** Deactivate the active row; the page owns the dialog and its toast. */
  onDeactivate: () => void;
  /** The profile an apply is running for, if any. */
  applyingProfileId: string | null;
  /** The modem is mid-mutation: every row's Activate goes dead. */
  pageBusy?: boolean;
  /** One clock for the page, shared with the Today card. */
  now: Date;
  /** Carrier-matched suggestions, already band-intersected. */
  suggestions?: SuggestionView[];
  /** Suggestion id currently being created, or null. */
  creatingSuggestionId?: string | null;
  /** Error from the last suggestion-create attempt. */
  suggestionError?: string | null;
  /** Materialize a suggestion as a real profile. */
  onCreateSuggestion?: (suggestionId: string) => void;
  /** The page holds every card in skeleton until all are ready. */
  holdSkeleton?: boolean;
  onLocalReadyChange?: (ready: boolean) => void;
}

const ProfileViewComponent = ({
  sim,
  currentIccid,
  onEdit,
  onAdd,
  onActivate,
  onDeactivate,
  applyingProfileId,
  pageBusy = false,
  now,
  suggestions = [],
  creatingSuggestionId = null,
  suggestionError = null,
  onCreateSuggestion,
  holdSkeleton = false,
  onLocalReadyChange,
}: ProfileViewProps) => {
  const { t } = useTranslation("cellular");
  const { profiles, activeProfileId, isLoading, error, getProfile } = sim;
  const { deleteProfile, refresh } = sim;
  const { nameForId } = useScenarioList();

  const [pendingDelete, setPendingDelete] =
    React.useState<ProfileSummary | null>(null);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    const result = await deleteProfile(target.id);
    if (result.ok) {
      toast.success(
        t("custom_profiles.view.toast.deleted", { name: target.name }),
      );
    } else {
      toast.error(result.error || t("custom_profiles.view.toast.delete_error"));
    }
  };

  // One skeleton for the summary fetch AND the detail prefetch; later runs refresh in the background
  // (`detailsHydrated` only turns true).
  const [details, setDetails] = React.useState<Record<string, SimProfile>>({});
  const [detailsHydrated, setDetailsHydrated] = React.useState(false);

  React.useEffect(() => {
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

  const localSkeleton =
    (isLoading && profiles.length === 0) ||
    (profiles.length > 0 && !detailsHydrated);

  // Report readiness up; the page ANDs it with the hero and scenarios card.
  React.useEffect(() => {
    onLocalReadyChange?.(!localSkeleton);
  }, [localSkeleton, onLocalReadyChange]);

  const showSkeleton = holdSkeleton || localSkeleton;
  // A failed list read with nothing to show: say so, never "no profiles yet".
  const showError = !isLoading && profiles.length === 0 && error !== null;

  const ordered = React.useMemo(
    () =>
      [...profiles].sort(
        (a, b) =>
          (a.id === activeProfileId ? 0 : 1) -
          (b.id === activeProfileId ? 0 : 1),
      ),
    [profiles, activeProfileId],
  );

  const hasBandRecipe = suggestions.some(
    (v) =>
      v.suggestion.nsa_nr_bands.length > 0 || v.suggestion.sa_nr_bands.length > 0,
  );

  return (
    <Card className="@container/card h-full">
      <CardHeader>
        <CardTitle>{t("custom_profiles.view.title")}</CardTitle>
        <CardDescription>
          {profiles.length > 0
            ? t("custom_profiles.view.count", { count: profiles.length })
            : t("custom_profiles.view.subtitle")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {showSkeleton ? (
          <ListSkeleton />
        ) : showError ? (
          <ConditionScreen
            tone="destructive"
            glyph="error"
            ariaRole="alert"
            title={t("custom_profiles.registry.error_title")}
            description={error ?? ""}
            onRetry={refresh}
            retryLabel={t("actions.retry", { ns: "common" })}
            className="rounded-tile py-10"
          />
        ) : profiles.length === 0 && suggestions.length === 0 ? (
          <EmptyProfileComponent onAdd={onAdd} />
        ) : (
          <div className="flex flex-col gap-2.5">
            {profiles.length === 0 ? (
              <p className="text-on-surface-variant text-xs">
                {t("custom_profiles.view.none_saved_yet")}
              </p>
            ) : (
              <motion.div
                className="flex flex-col gap-2.5"
                variants={staggerRows}
                initial="hidden"
                animate="visible"
              >
                {ordered.map((profile) => (
                  <ProfileRow
                    key={profile.id}
                    summary={profile}
                    status={deriveStatus(
                      profile.id === activeProfileId,
                      profile.sim_iccid,
                      currentIccid,
                    )}
                    scenarioName={nameForId(profile.scenario.default)}
                    applying={applyingProfileId === profile.id}
                    pageBusy={pageBusy}
                    otherSim={iccidMismatch(profile.sim_iccid, currentIccid)}
                    full={details[profile.id] ?? null}
                    now={now}
                    onActivate={() => onActivate(profile)}
                    onDeactivate={onDeactivate}
                    onEdit={() => onEdit(profile.id)}
                    onDelete={() => setPendingDelete(profile)}
                  />
                ))}
              </motion.div>
            )}

            {suggestions.length > 0 ? (
              <>
                {suggestionError ? (
                  <TonalBanner tone="destructive" icon="error" size="compact">
                    {suggestionError}
                  </TonalBanner>
                ) : null}
                <motion.div
                  className="flex flex-col gap-2.5"
                  variants={staggerRows}
                  initial="hidden"
                  animate="visible"
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
                <div className="text-on-surface-variant flex flex-col gap-1.5 pt-1 text-xs">
                  {hasBandRecipe ? (
                    <p className="flex items-start gap-2">
                      <MaterialSymbol name="info" size={14} aria-hidden className="mt-px shrink-0" />
                      <span>{t("custom_profiles.suggestions.rationale_bands")}</span>
                    </p>
                  ) : null}
                  <p className="flex items-start gap-2">
                    <MaterialSymbol name="info" size={14} aria-hidden className="mt-px shrink-0" />
                    <span>{t("custom_profiles.suggestions.rationale_ttl")}</span>
                  </p>
                </div>
              </>
            ) : null}
          </div>
        )}
      </CardContent>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
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
            <AlertDialogCancel variant="tonal" size="action">
              {t("custom_profiles.view.delete_keep")}
            </AlertDialogCancel>
            <AlertDialogAction variant="destructive" size="action" onClick={confirmDelete}>
              {t("custom_profiles.table.actions_menu.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};

// One profile row: stacked when narrow; identity and config left, status and action right when wide.
const ProfileRow = ({
  summary,
  status,
  scenarioName,
  applying,
  pageBusy,
  otherSim,
  full,
  now,
  onActivate,
  onDeactivate,
  onEdit,
  onDelete,
}: {
  summary: ProfileSummary;
  status: ProfileStatus;
  scenarioName: string;
  /** An apply is running for this profile. */
  applying: boolean;
  /** Some mutation holds the modem. */
  pageBusy: boolean;
  /** Bound to a SIM other than the one in the modem. */
  otherSim: boolean;
  full: SimProfile | null;
  now: Date;
  onActivate: () => void;
  onDeactivate: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) => {
  const { t } = useTranslation("cellular");
  const isActive = status !== "inactive";
  const scheduled = summary.scenario.schedule.enabled;
  const chip = STATUS_CHIP[status];
  const warning = CONDITION_TONE.warning;

  return (
    <motion.div variants={staggerRowItem} className={ROW}>
      <div className="flex flex-col gap-3 @3xl/card:flex-row @3xl/card:items-start @3xl/card:justify-between">
        {/* Identity, scenario binding and config */}
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold">{summary.name}</span>
            {summary.mno ? <Tag variant="neutral">{summary.mno}</Tag> : null}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-on-surface-variant">
            <MaterialSymbol
              name={scheduled ? "schedule" : "route"}
              size={14}
              className="flex-none"
            />
            <span className="truncate">
              {scheduled
                ? t("custom_profiles.view.scenario_scheduled", { scenario: scenarioName })
                : t("custom_profiles.view.scenario_always_on", { scenario: scenarioName })}
            </span>
          </div>
          {scheduled ? (
            <ScheduleMiniBar
              schedule={summary.scenario.schedule}
              fallbackScenarioId={summary.scenario.default}
              now={now}
              className="max-w-80"
            />
          ) : null}
          {full ? <ConfigPills profile={full} otherSim={otherSim && !isActive} /> : null}
        </div>

        {/* Status, the one action, the overflow menu */}
        <div className="flex flex-none flex-wrap items-center gap-2 @3xl/card:justify-end">
          <Badge variant={chip.variant}>
            <MaterialSymbol name={chip.glyph} size={BADGE_GLYPH_SIZE} />
            {t(chip.key)}
          </Badge>
          {isActive ? (
            <Button
              variant="tonal-neutral"
              size="sm"
              onClick={onDeactivate}
              disabled={pageBusy}
            >
              <MaterialSymbol name="power_settings_new" size={16} />
              {t("custom_profiles.table.actions_menu.deactivate")}
            </Button>
          ) : (
            <Button size="sm" onClick={onActivate} disabled={pageBusy}>
              <MaterialSymbol
                name={applying ? "progress_activity" : "play_arrow"}
                size={16}
                className={applying ? "motion-safe:animate-spin" : undefined}
              />
              {applying
                ? t("custom_profiles.view.activating")
                : t("custom_profiles.table.actions_menu.activate")}
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-on-surface-variant"
                aria-label={t("custom_profiles.view.row_menu_aria", { name: summary.name })}
              >
                <MaterialSymbol name="more_vert" size={18} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onClick={onEdit} disabled={isActive && pageBusy}>
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

      {status === "mismatch" ? (
        <div
          role="status"
          className={cn(
            "flex items-start gap-2 rounded-field px-3 py-2 text-xs",
            warning.container,
          )}
        >
          <MaterialSymbol name="sim_card" size={16} className="flex-none" />
          <span>{t("custom_profiles.view.mismatch_note")}</span>
        </div>
      ) : null}

      <span className="text-[11px] text-on-surface-variant tabular-nums">
        {t("custom_profiles.card.label_updated")} {formatProfileDate(summary.updated_at)}
      </span>
    </motion.div>
  );
};

// Config readout: identity is Tags; facts that change modem behaviour are Fact-Is-Info badges, shown only when they
// apply.
const ConfigPills = ({
  profile,
  otherSim,
}: {
  profile: SimProfile;
  /** Inactive and bound to another SIM (the active row has its own chip). */
  otherSim: boolean;
}) => {
  const { t } = useTranslation("cellular");
  const { apn, imei, ttl, hl } = profile.settings;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Tag variant="neutral">
        {apn.name.trim() ? (
          <>
            {t("custom_profiles.pills.apn_prefix")}
            <span className={cn(MACHINE_VALUE, "break-all")}>{apn.name}</span>
          </>
        ) : (
          t("custom_profiles.pills.apn_default")
        )}
      </Tag>
      <Tag variant="neutral" className="tabular-nums">
        {t("custom_profiles.pills.cid", { cid: apn.cid })}
      </Tag>
      <Tag variant="neutral">
        {PDP_PILL_KEY[apn.pdp_type] ? t(PDP_PILL_KEY[apn.pdp_type]) : apn.pdp_type}
      </Tag>
      {ttl > 0 ? (
        <Tag variant="neutral" className="tabular-nums">
          {t("custom_profiles.pills.ttl", { value: ttl })}
        </Tag>
      ) : null}
      {hl > 0 ? (
        <Tag variant="neutral" className="tabular-nums">
          {t("custom_profiles.pills.hl", { value: hl })}
        </Tag>
      ) : null}
      {imei.trim() !== "" ? (
        <Badge variant="info">
          <MaterialSymbol name="fingerprint" size={BADGE_GLYPH_SIZE} />
          {t("custom_profiles.pills.imei_override")}
        </Badge>
      ) : null}
      {otherSim ? (
        <Badge variant="info">
          <MaterialSymbol name="sim_card_alert" size={BADGE_GLYPH_SIZE} />
          {t("custom_profiles.pills.other_sim")}
        </Badge>
      ) : null}
    </div>
  );
};

// Suggestion row (RM520N): a dashed, unfilled offer that shows what it would write before Create.
const SuggestionRow = ({
  view,
  isCreating,
  disabled,
  onCreate,
}: {
  view: SuggestionView;
  isCreating: boolean;
  /** True while ANY suggestion is being created; the create path is serial. */
  disabled: boolean;
  onCreate: () => void;
}) => {
  const { t } = useTranslation("cellular");
  const { suggestion } = view;
  const bands = Array.from(new Set([...view.nsaBands, ...view.saBands])).sort(
    (a, b) => a - b,
  );
  const shown = bands.length - MAX_BAND_TAGS > 1 ? bands.slice(0, MAX_BAND_TAGS) : bands;
  const hidden = bands.length - shown.length;

  return (
    <motion.div variants={staggerRowItem} className={cn(ROW, SUGGESTION_ROW)}>
      <div className="flex flex-col gap-3 @3xl/card:flex-row @3xl/card:items-start @3xl/card:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={cn(
              "grid size-9 flex-none place-items-center rounded-pill",
              SUGGESTION_DISC,
            )}
          >
            <MaterialSymbol name="auto_awesome" size={18} aria-hidden />
          </span>
          <div className="flex min-w-0 flex-col gap-2">
            <span className="truncate text-sm font-semibold">{suggestion.label}</span>
            <div className="flex flex-wrap items-center gap-1.5">
              <Tag variant="neutral">
                <MaterialSymbol name="auto_awesome" size={BADGE_GLYPH_SIZE} aria-hidden />
                {t("profiles.list.suggestion_meta")}
              </Tag>
              <Tag variant="neutral" className={MACHINE_VALUE}>
                {suggestion.apn_name}
              </Tag>
              <Tag variant="neutral">
                {PDP_PILL_KEY[suggestion.pdp_type]
                  ? t(PDP_PILL_KEY[suggestion.pdp_type])
                  : suggestion.pdp_type}
              </Tag>
              {suggestion.cid > 0 ? (
                <Tag variant="neutral" className="tabular-nums">
                  {t("custom_profiles.pills.cid", { cid: suggestion.cid })}
                </Tag>
              ) : null}
              {suggestion.ttl > 0 ? (
                <Tag variant="neutral" className="tabular-nums">
                  {t("custom_profiles.pills.ttl", { value: suggestion.ttl })}
                </Tag>
              ) : null}
              {suggestion.hl > 0 ? (
                <Tag variant="neutral" className="tabular-nums">
                  {t("custom_profiles.pills.hl", { value: suggestion.hl })}
                </Tag>
              ) : null}
              {shown.map((b) => (
                <Tag key={b} variant="nr" className={MACHINE_VALUE}>
                  n{b}
                </Tag>
              ))}
              {hidden > 0 ? (
                <Tag
                  variant="neutral"
                  className={MACHINE_VALUE}
                  aria-label={t("profiles.list.bands_more_aria", { n: hidden })}
                >
                  {t("profiles.list.bands_more", { n: hidden })}
                </Tag>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex flex-none items-center @3xl/card:justify-end">
          <Button
            variant="tonal"
            size="sm"
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
              className={cn(isCreating && "motion-safe:animate-spin")}
            />
            {isCreating
              ? t("custom_profiles.suggestions.creating")
              : t("custom_profiles.suggestions.create")}
          </Button>
        </div>
      </div>
    </motion.div>
  );
};

// Skeleton: the row shape, imported from `ROW` so the two cannot drift.
const SkeletonRow = () => (
  <div className={ROW}>
    <div className="flex flex-col gap-3 @3xl/card:flex-row @3xl/card:justify-between">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-3 w-44" />
        <div className="flex gap-1.5">
          <Skeleton className="h-5 w-24 rounded-pill" />
          <Skeleton className="h-5 w-12 rounded-pill" />
          <Skeleton className="h-5 w-16 rounded-pill" />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Skeleton className="h-5 w-16 rounded-pill" />
        <Skeleton className="h-8 w-24 rounded-pill" />
      </div>
    </div>
    <Skeleton className="h-3 w-28" />
  </div>
);

const ListSkeleton = () => (
  <div className="flex flex-col gap-2.5">
    <SkeletonRow />
    <SkeletonRow />
  </div>
);

export default ProfileViewComponent;
