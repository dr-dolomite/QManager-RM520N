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
import {
  CalendarClockIcon,
  CheckCircle2Icon,
  Loader2Icon,
  MinusCircleIcon,
  MoreVerticalIcon,
  PencilIcon,
  PlayIcon,
  PowerIcon,
  RouteIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import EmptyProfileViewComponent from "@/components/cellular/custom-profiles/empty-profile";
import { useSimProfiles } from "@/hooks/use-sim-profiles";
import { useScenarioList } from "@/hooks/use-scenario-list";
import {
  formatProfileDate,
  type ProfileApplyState,
  type ProfileSummary,
  type SimProfile,
  type PdpType,
} from "@/types/sim-profile";

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

// Cap how many rows stagger so a long roster never plays a long load cascade.
const STAGGER_STEP_S = 0.04;
const STAGGER_MAX_ROWS = 4;

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

  // Empty state is a full-card surface (owns its own header + refresh), so it
  // replaces this card entirely rather than nesting inside it.
  if (!showSkeleton && profiles.length === 0) {
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
              className="bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20"
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
        duration: 0.3,
        delay: Math.min(index, STAGGER_MAX_ROWS) * STAGGER_STEP_S,
        ease: [0.16, 1, 0.3, 1],
      }}
      className={cn(
        "flex flex-col gap-3 rounded-lg border p-3",
        "transition-colors duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
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
                <MoreVerticalIcon className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onClick={onEdit}>
                <PencilIcon className="size-4" />
                {t("custom_profiles.table.actions_menu.edit")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                <Trash2Icon className="size-4" />
                {t("custom_profiles.table.actions_menu.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Scenario binding line */}
      <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
        {scheduled ? (
          <CalendarClockIcon className="size-3.5 shrink-0" />
        ) : (
          <RouteIcon className="size-3.5 shrink-0" />
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
          <TriangleAlertIcon className="mt-px size-3.5 shrink-0" />
          <span>{t("custom_profiles.view.mismatch_note")}</span>
        </div>
      )}

      {/* Action footer: updated date + per-row audit line + primary action */}
      <div className="flex items-center justify-between gap-3 pt-0.5">
        <div className="grid min-w-0 gap-0.5">
          <span className="text-muted-foreground text-[11px]">
            {t("custom_profiles.card.label_updated")}{" "}
            {formatProfileDate(summary.updated_at)}
          </span>
          {auditStatus && (
            <span
              className={cn(
                "text-[11px]",
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
            <PowerIcon className="size-4" />
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
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <PlayIcon className="size-4" />
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
      <Badge
        variant="outline"
        className="border-success/30 bg-success/15 text-success hover:bg-success/20"
      >
        <CheckCircle2Icon className="size-3" />
        {t("custom_profiles.table.status_badge.active")}
      </Badge>
    );
  }
  if (status === "mismatch") {
    return (
      <Badge
        variant="outline"
        className="border-warning/30 bg-warning/15 text-warning hover:bg-warning/20"
      >
        <TriangleAlertIcon className="size-3" />
        {t("custom_profiles.table.status_badge.sim_mismatch")}
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="border-muted-foreground/30 bg-muted/50 text-muted-foreground"
    >
      <MinusCircleIcon className="size-3" />
      {t("custom_profiles.table.status_badge.inactive")}
    </Badge>
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
