"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ConditionScreen } from "@/components/cellular/condition-screen";
import { ProfileOverrideAlert } from "@/components/cellular/custom-profiles/profile-override-alert";
import { modeLabel } from "@/components/cellular/custom-profiles/scenario-labels";
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
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ExpandButton } from "@/components/ui/expand-button";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveProfile } from "@/hooks/use-active-profile";
import { useConnectionScenarios } from "@/hooks/use-connection-scenarios";
import { staggerRows } from "@/lib/motion";
import { cn } from "@/lib/utils";
import {
  DEFAULT_SCENARIOS,
  bandsToInput,
  inputToBands,
  optimizationLabelKey,
} from "@/types/connection-scenario";
import { ActiveConfigCard } from "./active-config-card";
import {
  EMPTY_SCENARIO_DRAFT,
  ScenarioDialog,
  type ScenarioDraft,
} from "./scenario-dialog";
import { DEFAULT_SCENARIO_ICON_ID } from "./scenario-icons";
import {
  SCENARIO_TILE,
  SCENARIO_TILE_GRID,
  ScenarioItem,
  type Scenario,
} from "./scenario-item";

// =============================================================================
// ConnectionScenariosCard — Scenarios card + Selected-scenario card
// =============================================================================
// Scenarios card lists tiles (built-ins, then customs); selecting only views. The Selected-scenario card commits
// (Activate, Edit/Delete for customs).
//
// RM520N: an active profile owns activation (non-Balanced binding or enabled schedule), so Activate is withheld; the
// backend also refuses with `scenario_locked_by_schedule`. Request bodies keep the legacy `config.mode` mirror.
// =============================================================================

/** Deep-link action (`?action=create-scenario`) the page maps to Add. */
export const SCENARIO_CREATE_ACTION = "create-scenario";

interface ConnectionScenariosCardProps {
  /** Open the Add dialog once on mount (deep link). */
  autoOpenAddDialog?: boolean;
  /** Each increment opens the Add dialog. */
  openAddSignal?: number;
  /** Scenario id -> "HH:MM" of its next scheduled start (supplied, never derived). */
  nextFireByScenarioId?: Readonly<Record<string, string>>;
  /** Override for "a profile owns the radio"; defaults to this card's gate. */
  radioOwnedByProfile?: boolean;
  /** Name of the profile that owns the radio; defaults to the active profile. */
  ownerProfileName?: string | null;
  /** The page holds every card in skeleton until all are ready. */
  holdSkeleton?: boolean;
  onLocalReadyChange?: (ready: boolean) => void;
}

const ConnectionScenariosCard = ({
  autoOpenAddDialog = false,
  openAddSignal,
  nextFireByScenarioId,
  radioOwnedByProfile,
  ownerProfileName,
  holdSkeleton = false,
  onLocalReadyChange,
}: ConnectionScenariosCardProps = {}) => {
  const { t } = useTranslation("cellular");

  const {
    activeScenarioId,
    customScenarios: stored,
    isLoading: hookLoading,
    isActivating,
    error,
    activateScenario,
    saveCustomScenario,
    deleteCustomScenario,
    refresh,
  } = useConnectionScenarios();

  // Built-ins overlay translated name/description on the shared constant.
  const defaultScenarios: Scenario[] = useMemo(
    () =>
      DEFAULT_SCENARIOS.map((scenario) => ({
        ...scenario,
        name: t(`scenarios.default_${scenario.id}_name`),
        description: t(`scenarios.default_${scenario.id}_description`),
      })),
    [t],
  );

  // --- Profile ownership (display only; the backend enforces it too) --------
  const { activeProfile, scheduleLocked, nextChangeAt } = useActiveProfile();
  const profileGate = useMemo(() => {
    if (!activeProfile) return null;
    const boundId = activeProfile.scenario?.default || "";
    if ((boundId && boundId !== "balanced") || scheduleLocked) {
      return { profileName: activeProfile.name };
    }
    return null;
  }, [activeProfile, scheduleLocked]);
  const locked = radioOwnedByProfile ?? profileGate !== null;
  const lockProfileName =
    ownerProfileName !== undefined ? ownerProfileName : (profileGate?.profileName ?? null);

  const isLoading = hookLoading || holdSkeleton;

  useEffect(() => {
    onLocalReadyChange?.(!hookLoading);
  }, [hookLoading, onLocalReadyChange]);

  const scenarios = useMemo<Scenario[]>(
    () => [
      ...defaultScenarios,
      ...stored.map((s) => ({ ...s, pattern: "custom" as const, isDefault: false })),
    ],
    [defaultScenarios, stored],
  );

  // A token the app wrote is translated; the user's own words print verbatim.
  const optimizationText = (value: string) => {
    const key = optimizationLabelKey(value);
    return key ? t(key) : value;
  };

  // --- Selection (view only) -------------------------------------------------
  // Follows the active scenario when it changes, adjusted during render.
  const [selectedId, setSelectedId] = useState(activeScenarioId);
  const [prevActive, setPrevActive] = useState(activeScenarioId);
  if (prevActive !== activeScenarioId) {
    setPrevActive(activeScenarioId);
    setSelectedId(activeScenarioId);
  }
  const selected =
    scenarios.find((s) => s.id === selectedId) ?? (isLoading ? undefined : scenarios[0]);
  const isSelectedActive = selected?.id === activeScenarioId;

  // --- Dialogs ---------------------------------------------------------------
  const [dialog, setDialog] = useState<{ mode: "add" } | { mode: "edit"; id: string } | null>(
    autoOpenAddDialog ? { mode: "add" } : null,
  );
  const [dialogSeq, setDialogSeq] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Scenario | null>(null);
  // Arrived from the wizard's "+ Create scenario": the first create says to go back.
  const [arrivedFromProfileForm, setArrivedFromProfileForm] = useState(autoOpenAddDialog);

  const openAdd = () => {
    setDialogSeq((n) => n + 1);
    setDialog({ mode: "add" });
  };

  // Each increment of `openAddSignal` opens Add, adjusted during render.
  const [seenSignal, setSeenSignal] = useState(openAddSignal ?? 0);
  if ((openAddSignal ?? 0) !== seenSignal) {
    setSeenSignal(openAddSignal ?? 0);
    setDialogSeq((n) => n + 1);
    setDialog({ mode: "add" });
  }

  const editing = dialog?.mode === "edit" && selected && !selected.isDefault ? selected : null;

  const dialogInitial: ScenarioDraft = editing
    ? {
        name: editing.name,
        description: editing.description,
        mode: editing.config.atModeValue,
        optimization: optimizationText(editing.config.optimization),
        icon: editing.icon ?? DEFAULT_SCENARIO_ICON_ID,
        lteBands: bandsToInput(editing.config.lte_bands),
        saBands: bandsToInput(editing.config.sa_nr_bands),
        nsaBands: bandsToInput(editing.config.nsa_nr_bands),
      }
    : EMPTY_SCENARIO_DRAFT;

  // --- Mutations: one toast each, the failure reason from the result ---------
  const handleActivate = async () => {
    if (!selected || isActivating || isSelectedActive || locked) return;
    const result = await activateScenario(selected.id, selected.config);
    if (result.ok) {
      toast.success(t("scenarios.toast.activate_success", { name: selected.name }));
    } else {
      toast.error(result.error);
    }
  };

  const handleSubmit = async (draft: ScenarioDraft) => {
    setIsSaving(true);
    // Key order and values match the retired inline dialogs byte for byte.
    const result = editing
      ? await saveCustomScenario({
          id: editing.id,
          name: draft.name,
          description: draft.description,
          icon: draft.icon,
          config: {
            atModeValue: draft.mode,
            mode: draft.mode,
            // An untouched field keeps its stored token, never the shown label.
            optimization:
              draft.optimization === optimizationText(editing.config.optimization)
                ? editing.config.optimization
                : draft.optimization,
            lte_bands: inputToBands(draft.lteBands),
            nsa_nr_bands: inputToBands(draft.nsaBands),
            sa_nr_bands: inputToBands(draft.saBands),
          },
        })
      : await saveCustomScenario({
          name: draft.name,
          description:
            draft.description || t("scenarios.dialog.fields.preview_description_fallback"),
          icon: draft.icon,
          config: {
            atModeValue: draft.mode,
            mode: draft.mode,
            // A stable token, translated at display time.
            optimization: "Custom",
            lte_bands: inputToBands(draft.lteBands),
            nsa_nr_bands: inputToBands(draft.nsaBands),
            sa_nr_bands: inputToBands(draft.saBands),
          },
        });
    setIsSaving(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setDialog(null);
    if (editing) {
      toast.success(t("scenarios.toast.update_success"));
      return;
    }
    if (result.id) setSelectedId(result.id);
    if (arrivedFromProfileForm) {
      setArrivedFromProfileForm(false);
      toast.success(t("scenarios.toast.create_success_from_profile"));
    } else {
      toast.success(t("scenarios.toast.create_success"));
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    const result = await deleteCustomScenario(target.id);
    if (result.ok) {
      if (selectedId === target.id) {
        setSelectedId(activeScenarioId === target.id ? defaultScenarios[0].id : activeScenarioId);
      }
      toast.success(t("scenarios.toast.delete_success"));
    } else {
      toast.error(result.error);
    }
  };

  const readFailed = !isLoading && error !== null;

  return (
    <div className="flex flex-col gap-4">
      {/* --- Scenarios ------------------------------------------------------ */}
      <Card className="@container/card">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-48 flex-1 flex-col gap-1.5">
              <CardTitle>{t("scenarios.card.title")}</CardTitle>
              <CardDescription>{t("scenarios.card.description")}</CardDescription>
            </div>
            <ExpandButton
              variant="tonal"
              onClick={openAdd}
              disabled={isLoading}
              icon={<MaterialSymbol name="add" size={18} />}
              label={t("scenarios.tile.add.title")}
            />
          </div>
        </CardHeader>
        <CardContent>
          {locked && lockProfileName && !isLoading ? (
            <ProfileOverrideAlert
              profileName={lockProfileName}
              controls={t("scenarios.controls_label")}
            />
          ) : null}
          {isLoading ? (
            <div className={SCENARIO_TILE_GRID}>
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className={cn(SCENARIO_TILE, "bg-surface-container")} />
              ))}
            </div>
          ) : readFailed ? (
            <ConditionScreen
              tone="destructive"
              glyph="error"
              ariaRole="alert"
              title={t("scenarios.error.title")}
              description={error ?? ""}
              onRetry={refresh}
              retryLabel={t("actions.retry", { ns: "common" })}
              className="rounded-tile py-10"
            />
          ) : (
            <motion.div
              className={SCENARIO_TILE_GRID}
              variants={staggerRows}
              initial="hidden"
              animate="visible"
            >
              {scenarios.map((scenario) => (
                <ScenarioItem
                  key={scenario.id}
                  scenario={scenario}
                  isActive={activeScenarioId === scenario.id}
                  isSelected={selected?.id === scenario.id}
                  modeLabel={modeLabel(t, scenario.config.atModeValue)}
                  onSelect={setSelectedId}
                  nextAt={nextFireByScenarioId?.[scenario.id] ?? null}
                />
              ))}
            </motion.div>
          )}
        </CardContent>
      </Card>

      {/* --- Selected scenario ---------------------------------------------- */}
      {readFailed ? null : (
        <ActiveConfigCard
          scenario={selected}
          isActive={isSelectedActive}
          isActivating={isActivating}
          isLoading={isLoading}
          onEdit={() => {
            if (!selected || selected.isDefault) return;
            setDialogSeq((n) => n + 1);
            setDialog({ mode: "edit", id: selected.id });
          }}
          onDelete={() => selected && !selected.isDefault && setPendingDelete(selected)}
          onActivate={handleActivate}
          locked={locked}
          scheduleLocked={scheduleLocked}
          nextChangeAt={scheduleLocked ? nextChangeAt : null}
          ownerProfileName={lockProfileName}
        />
      )}

      <ScenarioDialog
        key={dialogSeq}
        open={dialog !== null}
        onOpenChange={(open) => !open && setDialog(null)}
        mode={editing ? "edit" : "add"}
        initial={dialogInitial}
        isSaving={isSaving}
        onSubmit={handleSubmit}
      />

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("scenarios.tile.delete_dialog.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("scenarios.tile.delete_dialog.description", {
                name: pendingDelete?.name ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="tonal" size="action">
              {t("actions.cancel", { ns: "common" })}
            </AlertDialogCancel>
            <AlertDialogAction variant="destructive" size="action" onClick={confirmDelete}>
              {t("scenarios.tile.delete_dialog.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ConnectionScenariosCard;
