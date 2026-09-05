"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { motion, type Variants } from "motion/react";
import { useTranslation } from "react-i18next";
import {
  BellIcon,
  CardSimIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  InfoIcon,
  Loader2Icon,
  MinusCircleIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";

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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { rowCascadeDelay, transitionStandard } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { ClearKnownSimsResult } from "@/hooks/use-known-sims";
import type { UseSimRegistryReturn } from "@/hooks/use-sim-registry";
import type { SimRegistryEntry } from "@/types/sim-registry";

import { ConditionBlock } from "./condition-block";
import {
  CARD_BODY,
  CARD_DESC,
  CARD_PAD,
  CHIP_ON_TONAL,
  META_INK_ON_TONAL,
  CARD_SHELL,
  CARD_TITLE,
  CONDITION_PANEL,
  FOCUS_RING,
  NOTICE,
  PILL_ACTION,
  PILL_GLYPH,
  ROW_GROUP,
  SIM_LIST,
  SIM_ROW,
  SKELETON,
} from "./shapes";

// The read side of the persistent SIM registry — the SIM-swap banner silences a
// SIM, and this card is where a user takes that back. Dismissing is deliberately
// not offered here: silencing an alert belongs to the alert itself.
//
// Clear acts on the known-SIMs SET while the list renders the registry SIDECAR,
// two separate stores. One owner means a clear necessarily refreshes the list,
// so the count and the list cannot drift apart.

/** Row cascade, capped by `rowCascadeDelay` so a long registry does not
 *  choreograph for seconds. */
const rowItem: Variants = {
  hidden: { opacity: 0, y: 5 },
  visible: (index: number) => ({
    opacity: 1,
    y: 0,
    transition: { ...transitionStandard, delay: rowCascadeDelay(index) },
  }),
};

// Supporting ink inside a row. On the promoted row it INHERITS the container's
// `on-primary-container` and steps back by opacity — a token measured for the
// card ground is not legible on a `primary-container` fill.
const META = "text-xs leading-relaxed";
const META_INK = "text-on-surface-variant";
// The in-row affordance: pill geometry at row scale, not the 42px page action.
const ROW_ACTION = `inline-flex h-9 flex-none items-center gap-1.5 rounded-pill px-3.5 text-[0.8125rem] font-semibold transition-colors duration-[var(--duration-quick)] ease-out ${FOCUS_RING} disabled:cursor-not-allowed disabled:opacity-50`;
// Hover steps the fill UP the neutral ramp. The `/70` it replaces stepped it
// DOWN — an alpha over `surface-container` resolves lighter than the resting
// `-high`, so pointing at the control made it recede.
const ROW_ACTION_TONE =
  "bg-surface-container-high text-on-surface hover:bg-on-surface/10";
const ROW_ACTION_ON_TONAL =
  "bg-on-primary-container/10 text-on-primary-container hover:bg-on-primary-container/20";

function formatFirstSeen(iso: string | null, locale: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(locale || undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function SimRegistryRow({
  sim,
  index,
  isPending,
  onShowAlert,
}: {
  sim: SimRegistryEntry;
  index: number;
  isPending: boolean;
  onShowAlert: (sim: SimRegistryEntry) => void;
}) {
  const { t, i18n } = useTranslation("system-settings");
  const addedOn = formatFirstSeen(sim.first_seen, i18n.language);
  const dim = sim.active ? META_INK_ON_TONAL : META_INK;

  return (
    <motion.div
      variants={rowItem}
      custom={index}
      className={cn(
        SIM_ROW.ROOT,
        SIM_ROW.TRANSITION,
        sim.active && SIM_ROW.ACTIVE,
      )}
    >
      <div className={SIM_ROW.TEXT}>
        <div className="flex flex-wrap items-center gap-2">
          <span className={SIM_ROW.LABEL}>
            {sim.carrier || t("sim_registry.carrier_unknown")}
          </span>
          {sim.active && (
            <Badge variant="success">
              <CheckCircle2Icon className="size-3" aria-hidden="true" />
              {t("sim_registry.badge_active")}
            </Badge>
          )}
        </div>

        {sim.phone_number ? (
          <span className={SIM_ROW.ID}>{sim.phone_number}</span>
        ) : (
          <span className={cn(META, dim)}>
            {t("sim_registry.no_phone_number")}
          </span>
        )}

        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
          {/* `min-w-0` is what lets `SIM_ROW.ID`'s truncate fire; without a
              `flex-1` the date stays beside the ICCID rather than floating. */}
          <span className={cn(SIM_ROW.ID, dim, "min-w-0")}>{sim.iccid}</span>
          <span className={cn(META, dim, "shrink-0")}>
            {addedOn
              ? t("sim_registry.added_on", { date: addedOn })
              : t("sim_registry.added_unknown")}
          </span>
        </div>
      </div>

      <div className="flex flex-none flex-wrap items-center gap-2">
        {sim.dismissed ? (
          <Badge variant="muted">
            <MinusCircleIcon className="size-3" aria-hidden="true" />
            {t("sim_registry.badge_alerts_off")}
          </Badge>
        ) : (
          <Badge variant="info" className={cn(sim.active && CHIP_ON_TONAL)}>
            <BellIcon className="size-3" aria-hidden="true" />
            {t("sim_registry.badge_alerts_on")}
          </Badge>
        )}

        {sim.dismissed && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => onShowAlert(sim)}
            className={cn(
              ROW_ACTION,
              sim.active ? ROW_ACTION_ON_TONAL : ROW_ACTION_TONE,
            )}
          >
            {isPending ? (
              <>
                <Loader2Icon
                  className="size-4 animate-spin"
                  aria-hidden="true"
                />
                {t("sim_registry.restoring")}
              </>
            ) : (
              <>
                <BellIcon className="size-4" aria-hidden="true" />
                {t("sim_registry.show_alert")}
              </>
            )}
          </button>
        )}
      </div>
    </motion.div>
  );
}

// How many SIMs are remembered, and the control that forgets them. Rendered
// whenever EITHER store has something in it, so a divergence between them
// still leaves the user a way to reset.
function ClearKnownSimsFooter({
  count,
  isLoading,
  isClearing,
  onConfirm,
}: {
  /** `null` = the count was never read. Rendering it as 0 asserts a fact. */
  count: number | null;
  isLoading: boolean;
  isClearing: boolean;
  onConfirm: () => Promise<void>;
}) {
  const { t } = useTranslation("system-settings");
  const [open, setOpen] = useState(false);

  const handleConfirm = useCallback(async () => {
    await onConfirm();
    setOpen(false);
  }, [onConfirm]);

  return (
    <>
      <CardFooter
        className={cn(
          CARD_PAD,
          "flex flex-wrap items-center justify-between gap-x-4 gap-y-3",
        )}
      >
        <div className="text-on-surface-variant flex items-center gap-1.5 text-sm">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                // -ml-1.5 cancels the icon button's own box inset so the glyph
                // sits on the card's content column, flush with the title above.
                className="text-on-surface-variant hover:text-on-surface -ml-1.5 rounded-pill"
                aria-label={t("known_sims.info_aria")}
              >
                <InfoIcon className="size-4" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p className="max-w-sm text-balance">{t("known_sims.tooltip")}</p>
            </TooltipContent>
          </Tooltip>

          {isLoading ? (
            <Skeleton className={cn(SKELETON.SIMS.LABEL, "w-28")} />
          ) : (
            <span className="tabular-nums">
              {count === null
                ? t("known_sims.remembered_unknown")
                : t("sim_registry.remembered_count", { count })}
            </span>
          )}
        </div>

        <Button
          variant="destructive"
          className={PILL_ACTION}
          onClick={() => setOpen(true)}
          disabled={isLoading || isClearing}
        >
          <Trash2Icon className={PILL_GLYPH} aria-hidden="true" />
          {t("known_sims.clear_button")}
        </Button>
      </CardFooter>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("known_sims.clear_dialog_title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("known_sims.clear_dialog_description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isClearing} className={PILL_ACTION}>
              {t("actions.cancel", { ns: "common" })}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              className={PILL_ACTION}
              disabled={isClearing}
              onClick={(e) => {
                // Keep the dialog mounted through the request so the button can
                // show its own in-flight state; Radix would close it otherwise.
                e.preventDefault();
                void handleConfirm();
              }}
            >
              {isClearing ? (
                <>
                  <Loader2Icon
                    className="size-4 animate-spin"
                    aria-hidden="true"
                  />
                  {t("known_sims.clear_dialog_clearing")}
                </>
              ) : (
                t("known_sims.clear_dialog_confirm")
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// The shell owns the registry fetch, so the status band above can read the same
// rows. One `useSimRegistry` instance on the page, never two.
export type SimRegistryCardProps = Pick<
  UseSimRegistryReturn,
  "sims" | "isLoading" | "error" | "pendingIccid" | "refresh" | "setDismissed"
> & {
  /** `null` when the known-SIMs read produced no answer. Never render it as 0. */
  knownCount: number | null;
  knownIsLoading: boolean;
  isClearingKnown: boolean;
  clearKnownSims: () => Promise<ClearKnownSimsResult>;
};

export default function SimRegistryCard({
  sims,
  isLoading,
  error,
  pendingIccid,
  refresh,
  setDismissed,
  knownCount,
  knownIsLoading,
  isClearingKnown,
  clearKnownSims,
}: SimRegistryCardProps) {
  const { t } = useTranslation("system-settings");

  const handleShowAlert = useCallback(
    async (sim: SimRegistryEntry) => {
      const ok = await setDismissed(sim.iccid, false);
      if (ok) {
        toast.success(t("sim_registry.toast_restored"), {
          description: t("sim_registry.toast_restored_detail", {
            carrier: sim.carrier || t("sim_registry.carrier_unknown"),
          }),
        });
      } else {
        toast.error(t("sim_registry.toast_restore_failed"));
      }
    },
    [setDismissed, t],
  );

  const handleClear = useCallback(async () => {
    const result = await clearKnownSims();

    if (!result.ok) {
      // The backend detail is machine text: it rides the description slot,
      // never the sentence, so a non-English device still gets its own words.
      toast.error(t("known_sims.toast_clear_failed"), {
        description: result.detail || undefined,
      });
      return;
    }

    // The device clears both stores, so the list this card renders has changed
    // underneath us. Refetch rather than trusting a local prediction of it.
    await refresh();

    if (result.registryCleared) {
      toast.success(t("known_sims.toast_cleared"));
    } else {
      // The set was cleared but the registry sidecar was not. Say so instead
      // of reporting a clean sweep the device did not perform.
      toast.warning(t("sim_registry.toast_cleared_partial"), {
        description: t("sim_registry.toast_cleared_partial_detail"),
      });
    }
  }, [clearKnownSims, refresh, t]);

  const header = (
    <CardHeader className={CARD_PAD}>
      <CardTitle className={CARD_TITLE}>{t("sim_registry.title")}</CardTitle>
      <CardDescription className={CARD_DESC}>
        {t("sim_registry.description")}
      </CardDescription>
    </CardHeader>
  );

  // Only offer Clear when there is something to forget. Either store counts:
  // if they ever disagree, the reset is exactly what resolves it.
  const footer =
    knownCount === null || knownCount > 0 || sims.length > 0 ? (
      <ClearKnownSimsFooter
        count={knownCount}
        isLoading={knownIsLoading}
        isClearing={isClearingKnown}
        onConfirm={handleClear}
      />
    ) : null;

  // --- Loading: three rows wearing the real row box, so the height resolves ---
  if (isLoading) {
    return (
      <Card className={CARD_SHELL}>
        {header}
        <CardContent className={cn(CARD_PAD, CARD_BODY)}>
          <div className={cn(ROW_GROUP, SIM_LIST)}>
            {[0, 1, 2].map((i) => (
              <div key={i} className={SIM_ROW.ROOT}>
                <div className={SIM_ROW.TEXT}>
                  <Skeleton className={cn(SKELETON.SIMS.LABEL, "w-32")} />
                  <Skeleton className={cn(SKELETON.SIMS.ID, "w-28")} />
                  <Skeleton className={cn(SKELETON.SIMS.ID, "w-48")} />
                </div>
                <Skeleton className={SKELETON.SIMS.CHIP} />
              </div>
            ))}
          </div>
        </CardContent>
        <CardFooter
          className={cn(CARD_PAD, "flex items-center justify-between gap-4")}
        >
          <Skeleton className={cn(SKELETON.SIMS.LABEL, "w-36")} />
          <Skeleton className={cn(PILL_ACTION, "w-28")} />
        </CardFooter>
      </Card>
    );
  }

  // --- Read failure with nothing cached to fall back on ---
  if (error && sims.length === 0) {
    return (
      <Card className={CARD_SHELL}>
        {header}
        <CardContent className={cn(CARD_PAD, CARD_BODY)}>
          <ConditionBlock
            tone="destructive"
            glyph={CircleAlertIcon}
            ariaRole="alert"
            title={t("sim_registry.error_title")}
            description={t("sim_registry.error_description")}
            onRetry={() => void refresh()}
            retryLabel={t("sim_registry.retry")}
            className={CONDITION_PANEL.SCREEN}
          />
        </CardContent>
        {footer}
      </Card>
    );
  }

  // --- Empty ---
  if (sims.length === 0) {
    return (
      <Card className={CARD_SHELL}>
        {header}
        <CardContent className={cn(CARD_PAD, CARD_BODY)}>
          <ConditionBlock
            tone="neutral"
            glyph={CardSimIcon}
            ariaRole="status"
            title={t("sim_registry.empty_title")}
            description={t("sim_registry.empty_description")}
            className={CONDITION_PANEL.SCREEN}
          />
        </CardContent>
        {footer}
      </Card>
    );
  }

  // --- Data ---
  return (
    <Card className={CARD_SHELL}>
      {header}
      <CardContent className={cn(CARD_PAD, CARD_BODY, "gap-3")}>
        <motion.div
          tabIndex={0}
          role="region"
          aria-label={t("sim_registry.title")}
          className={cn(ROW_GROUP, SIM_LIST, FOCUS_RING)}
        >
          {sims.map((sim, index) => (
            <SimRegistryRow
              key={sim.iccid}
              sim={sim}
              index={index}
              isPending={pendingIccid === sim.iccid}
              onShowAlert={handleShowAlert}
            />
          ))}
        </motion.div>

        {/* A stale read shouldn't blank the list; say so instead. */}
        {error && (
          <div role="status" className={cn(NOTICE.BOX, NOTICE.STALE)}>
            <TriangleAlertIcon className={NOTICE.GLYPH} aria-hidden="true" />
            <span className={NOTICE.TEXT}>{t("sim_registry.stale_notice")}</span>
          </div>
        )}
      </CardContent>
      {footer}
    </Card>
  );
}
