"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { TonalBanner } from "@/components/ui/tonal-banner";
import { AbstractPattern } from "./abstract-pattern";
import { AddScenarioItem } from "./add-scenario-item";
import { ActiveConfigCard } from "./active-config-card";
import { ScenarioItem, Scenario } from "./scenario-item";
import {
  SCENARIO_ICONS,
  DEFAULT_SCENARIO_ICON_ID,
  resolveScenarioIcon,
} from "./scenario-icons";
import { useConnectionScenarios } from "@/hooks/use-connection-scenarios";
import { useActiveProfile } from "@/hooks/use-active-profile";
import { ProfileOverrideAlert } from "@/components/cellular/custom-profiles/profile-override-alert";
import { staggerContainer, staggerItem } from "@/lib/motion";
import {
  NETWORK_MODE_OPTIONS,
  modeValueToLabel,
  inputToBands,
  bandsToInput,
} from "@/types/connection-scenario";
import {
  PROFILE_CARD_PEER,
  PROFILE_PAD,
  SCENARIO_TILE_SHAPE,
  CONFIG_CARD_SHAPE,
} from "../shapes";

// =============================================================================
// ConnectionScenariosCard — tile grid + active config + create/edit dialogs
// =============================================================================
// Every shape here is imported from `../shapes.ts` rather than restated: the
// tile grid/height come from `SCENARIO_TILE_SHAPE`, the config-card skeleton's
// disc/title/chip come from `CONFIG_CARD_SHAPE`. That is the Skeleton-Mirror
// Rule working as intended — the incumbent skeleton hardcoded `rounded-xl`,
// `h-11 w-11`, `h-5 w-44` etc., none of which matched what `ScenarioItem` /
// `ActiveConfigCard` (owned by a parallel builder) actually render, so the
// loading → loaded handoff visibly jumped.
//
// THE ERROR STATE IS NOT A REPLACEMENT. A failed `list.sh` GET is usually
// transient AT-lock contention (`modem_busy`), and the previous request's data
// is still perfectly good to look at. So on a read failure the tiles and the
// config card FREEZE on whatever was last loaded — `hasLoadedOnceRef` is what
// tells the skeleton not to come back on a background retry — while a
// destructive `TonalBanner` explains and offers Retry. Only the very first
// load (nothing on screen yet) shows the skeleton.
// =============================================================================

interface ConnectionScenariosCardProps {
  /** If true on mount, open the "New Scenario" dialog automatically. Used by
   *  the deep-link from the SIM Profile form's "Create new custom scenario…"
   *  Select item. After successful create, a special toast prompts the user
   *  to return to their profile and select the new scenario. */
  autoOpenAddDialog?: boolean;
}

const ConnectionScenariosCard = ({
  autoOpenAddDialog,
}: ConnectionScenariosCardProps = {}) => {
  const { t } = useTranslation("cellular");
  const {
    activeScenarioId,
    customScenarios: storedScenarios,
    isLoading,
    isActivating,
    error,
    activateScenario,
    saveCustomScenario,
    deleteCustomScenario,
    refresh,
  } = useConnectionScenarios();

  // Default (built-in) scenarios — icons are UI-only, not stored in backend.
  // Names/descriptions are translated at render time (module-level constants
  // can't call `t()`), keyed off each scenario's stable `id` so an existing
  // `scenarios.default_*_name` key set already shipped keeps working.
  const defaultScenarios: Scenario[] = useMemo(
    () => [
      {
        id: "balanced",
        name: t("scenarios.default_balanced_name"),
        description: t("scenarios.default_balanced_description"),
        icon: "bolt",
        pattern: "balanced",
        isDefault: true,
        config: {
          atModeValue: "AUTO",
          mode: "Auto",
          optimization: "Balanced",
          lte_bands: "",
          nsa_nr_bands: "",
          sa_nr_bands: "",
        },
      },
      {
        id: "gaming",
        name: t("scenarios.default_gaming_name"),
        description: t("scenarios.default_gaming_description"),
        icon: "sports_esports",
        pattern: "gaming",
        isDefault: true,
        config: {
          atModeValue: "NR5G",
          mode: "5G SA Only",
          optimization: "Latency",
          lte_bands: "",
          nsa_nr_bands: "",
          sa_nr_bands: "",
        },
      },
      {
        id: "streaming",
        name: t("scenarios.default_streaming_name"),
        description: t("scenarios.default_streaming_description"),
        icon: "play_arrow",
        pattern: "streaming",
        isDefault: true,
        config: {
          atModeValue: "LTE:NR5G",
          mode: "5G SA / NSA",
          optimization: "Throughput",
          lte_bands: "",
          nsa_nr_bands: "",
          sa_nr_bands: "",
        },
      },
    ],
    [t],
  );

  // --- SIM Profile override check ------------------------------------------
  // When an active Custom SIM Profile binds a NON-Balanced scenario, OR its
  // schedule is enabled (so it may switch away from Balanced at any moment),
  // that profile owns scenario activation: the Activate button is disabled on
  // every card and a banner explains why. A static Balanced binding with no
  // schedule is treated as "no opinion" and doesn't gate anything. Edit/Delete
  // of *custom* scenarios is intentionally NOT gated.
  //
  // scheduleLocked is display-only here too — the backend independently
  // rejects a locked activation via `scenario_locked_by_schedule`; this is
  // just so the button reads disabled before the user tries.
  const { activeProfile, scheduleLocked, nextChangeAt } = useActiveProfile();

  const profileGate = useMemo(() => {
    if (!activeProfile) return null;
    const boundId = activeProfile.scenario?.default || "";
    const staticBinding = boundId && boundId !== "balanced";
    if (staticBinding || scheduleLocked) {
      return { profileName: activeProfile.name };
    }
    return null;
  }, [activeProfile, scheduleLocked]);

  const isProfileControlled = profileGate !== null;

  // Tracks whether the list has EVER finished loading. `isLoading` flips back
  // to true on every `refresh()` call — including the Retry button after a
  // read failure — so keying the skeleton off it directly would blank a
  // perfectly good list every time a background refresh happens to fail.
  // Only the very first load (nothing on screen yet) should show a skeleton;
  // every load after that freezes the last known tiles/config in place while
  // the error banner above explains what's stale. Written in an effect
  // (never during render) so it stays a plain ref mutation, not a state sync.
  const hasLoadedOnceRef = useRef(false);
  useEffect(() => {
    if (!isLoading) {
      hasLoadedOnceRef.current = true;
    }
  }, [isLoading]);
  const showSkeleton = isLoading && !hasLoadedOnceRef.current;

  // Convert backend StoredScenario[] → UI Scenario[] (add icon, pattern, isDefault)
  const customScenarios: Scenario[] = useMemo(
    () =>
      storedScenarios.map((s) => ({
        ...s,
        // Resolve the persisted glyph key to a component, but keep the key too:
        // the edit dialog pre-selects by key, and a component reference cannot
        // be compared back to a picker option. Records saved before the icon
        // field existed have no key and resolve to the default glyph.
        icon: resolveScenarioIcon(s.icon),
        iconId: s.icon ?? DEFAULT_SCENARIO_ICON_ID,
        pattern: "custom" as const,
        isDefault: false,
      })),
    [storedScenarios],
  );

  // --- Selection state (view config without activating) ----------------------
  const [selectedId, setSelectedId] = useState<string>(activeScenarioId);

  // Sync selection to active when active changes (e.g., on initial load).
  // Compared during render instead of via an effect (React-recommended
  // pattern, same as `prevEditingId` in custom-profile-form.tsx): a plain
  // `selectedId !== activeScenarioId` check would also fire every time the
  // USER manually selects a different scenario (selectedId diverges from
  // activeScenarioId on purpose in that case), fighting their click. Tracking
  // `prevActiveScenarioId` lets this only react to activeScenarioId itself
  // changing, matching the effect's original `[activeScenarioId]` deps array.
  const [prevActiveScenarioId, setPrevActiveScenarioId] = useState(activeScenarioId);
  if (activeScenarioId !== prevActiveScenarioId) {
    setPrevActiveScenarioId(activeScenarioId);
    setSelectedId(activeScenarioId);
  }

  // --- Dialog state ----------------------------------------------------------
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);

  // Deep-link flag — remembers if the user arrived via ?action=create so we
  // can show a tailored toast after the scenario is created. Latches once at
  // mount; we don't re-open the dialog if the user dismisses it.
  const [arrivedFromProfileForm, setArrivedFromProfileForm] = useState(
    !!autoOpenAddDialog,
  );

  useEffect(() => {
    if (autoOpenAddDialog) {
      setShowAddDialog(true);
    }
    // Only auto-open on mount; ignore subsequent prop changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Add form state
  const [addName, setAddName] = useState("");
  const [addDescription, setAddDescription] = useState("");
  const [addIcon, setAddIcon] = useState(DEFAULT_SCENARIO_ICON_ID);
  const [addMode, setAddMode] = useState("AUTO");
  const [addLteBands, setAddLteBands] = useState("");
  const [addNsaNrBands, setAddNsaNrBands] = useState("");
  const [addSaNrBands, setAddSaNrBands] = useState("");

  // Edit form state
  const [editId, setEditId] = useState("");
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editIcon, setEditIcon] = useState(DEFAULT_SCENARIO_ICON_ID);
  const [editMode, setEditMode] = useState("AUTO");
  const [editOptimization, setEditOptimization] = useState("");
  const [editLteBands, setEditLteBands] = useState("");
  const [editNsaNrBands, setEditNsaNrBands] = useState("");
  const [editSaNrBands, setEditSaNrBands] = useState("");

  // --- Derived ---------------------------------------------------------------
  const scenarios = useMemo(
    () => [...defaultScenarios, ...customScenarios],
    [defaultScenarios, customScenarios],
  );
  const selectedScenario = scenarios.find((s) => s.id === selectedId);
  const isSelectedActive = selectedId === activeScenarioId;

  // Fall back to first default if selected scenario isn't found
  // (e.g., active custom scenario ID from backend doesn't match any local scenario).
  // Compared during render instead of via an effect. Unlike the sync above,
  // this check is not "did something change" — it validates whether the
  // CURRENT selectedId is still valid, so re-checking it on every render
  // (including ones caused by selectedId itself changing) is exactly the
  // original `[isLoading, selectedId, scenarios, defaultScenarios]` semantics.
  // It's self-terminating: once corrected, the condition evaluates false on
  // the very next render, and setting the same id again is a no-op bail in
  // React.
  if (!isLoading && selectedId && !scenarios.find((s) => s.id === selectedId)) {
    setSelectedId(defaultScenarios[0].id);
  }

  // ---------------------------------------------------------------------------
  // Handle selection (click card = view config)
  // ---------------------------------------------------------------------------
  const handleSelect = (id: string) => {
    setSelectedId(id);
  };

  // ---------------------------------------------------------------------------
  // Handle activation (explicit button press)
  // ---------------------------------------------------------------------------
  const handleActivate = useCallback(async () => {
    if (!selectedScenario || isActivating) return;
    if (selectedId === activeScenarioId) return;
    // Belt-and-braces: even though the button is disabled, never let an
    // activation through while the profile owns radio config.
    if (isProfileControlled) return;

    const success = await activateScenario(selectedId, selectedScenario.config);

    if (success) {
      toast.success(t("scenarios.toast.activate_success", { name: selectedScenario.name }));
    } else {
      toast.error(t("scenarios.toast.activate_error", { name: selectedScenario.name }));
    }
  }, [
    selectedScenario,
    selectedId,
    activeScenarioId,
    isActivating,
    activateScenario,
    isProfileControlled,
    t,
  ]);

  // ---------------------------------------------------------------------------
  // Add custom scenario
  // ---------------------------------------------------------------------------
  const [isSaving, setIsSaving] = useState(false);

  const handleAddScenario = async () => {
    if (!addName.trim() || isSaving) return;

    setIsSaving(true);
    const scenarioData = {
      name: addName,
      description: addDescription || t("scenarios.dialog.fields.preview_description_fallback"),
      icon: addIcon,
      config: {
        atModeValue: addMode,
        mode: modeValueToLabel(addMode),
        optimization: "Custom",
        lte_bands: inputToBands(addLteBands),
        nsa_nr_bands: inputToBands(addNsaNrBands),
        sa_nr_bands: inputToBands(addSaNrBands),
      },
    };

    const newId = await saveCustomScenario(scenarioData);
    setIsSaving(false);

    if (newId) {
      setSelectedId(newId);
      setShowAddDialog(false);
      resetAddForm();
      if (arrivedFromProfileForm) {
        toast.success(t("scenarios.toast.create_success_from_profile"));
        // One-shot — subsequent creates show the normal toast.
        setArrivedFromProfileForm(false);
      } else {
        toast.success(t("scenarios.toast.create_success"));
      }
    } else {
      toast.error(t("scenarios.toast.create_error"));
    }
  };

  const resetAddForm = () => {
    setAddName("");
    setAddDescription("");
    setAddIcon(DEFAULT_SCENARIO_ICON_ID);
    setAddMode("AUTO");
    setAddLteBands("");
    setAddNsaNrBands("");
    setAddSaNrBands("");
  };

  // ---------------------------------------------------------------------------
  // Delete custom scenario
  // ---------------------------------------------------------------------------
  const handleDeleteScenario = async (id: string) => {
    const success = await deleteCustomScenario(id);
    if (success) {
      // If the deleted scenario was selected, fall back to active or default
      if (selectedId === id) {
        setSelectedId(activeScenarioId === id ? defaultScenarios[0].id : activeScenarioId);
      }
      toast.success(t("scenarios.toast.delete_success"));
    } else {
      toast.error(t("scenarios.toast.delete_error"));
    }
  };

  // ---------------------------------------------------------------------------
  // Edit custom scenario
  // ---------------------------------------------------------------------------
  const handleOpenEditDialog = () => {
    if (!selectedScenario || selectedScenario.isDefault) return;

    setEditId(selectedScenario.id);
    setEditName(selectedScenario.name);
    setEditDescription(selectedScenario.description);
    setEditIcon(selectedScenario.iconId ?? DEFAULT_SCENARIO_ICON_ID);
    setEditMode(selectedScenario.config.atModeValue);
    setEditOptimization(selectedScenario.config.optimization);
    setEditLteBands(bandsToInput(selectedScenario.config.lte_bands));
    setEditNsaNrBands(bandsToInput(selectedScenario.config.nsa_nr_bands));
    setEditSaNrBands(bandsToInput(selectedScenario.config.sa_nr_bands));
    setShowEditDialog(true);
  };

  const handleSaveEdit = async () => {
    if (!editName.trim() || isSaving) return;

    setIsSaving(true);
    const updatedId = await saveCustomScenario({
      id: editId,
      name: editName,
      description: editDescription,
      icon: editIcon,
      config: {
        atModeValue: editMode,
        mode: modeValueToLabel(editMode),
        optimization: editOptimization,
        lte_bands: inputToBands(editLteBands),
        nsa_nr_bands: inputToBands(editNsaNrBands),
        sa_nr_bands: inputToBands(editSaNrBands),
      },
    });
    setIsSaving(false);

    if (updatedId) {
      setShowEditDialog(false);
      toast.success(t("scenarios.toast.update_success"));
    } else {
      toast.error(t("scenarios.toast.update_error"));
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="grid gap-y-6">
      {/* Profile override banner — shown when a Custom SIM Profile owns
          scenario activation. Edit/Delete remain enabled; only Activate
          is restricted. */}
      {isProfileControlled && profileGate && !isLoading && (
        <ProfileOverrideAlert
          profileName={profileGate.profileName}
          controls={t("scenarios.controls_label")}
        />
      )}

      {/* Read-failure notice. The tiles and config card below FREEZE on
          whatever was last loaded — the State-Honesty Rule cuts both ways: a
          transient `modem_busy` lock contention on a background refresh is
          not a reason to blank a perfectly good list. */}
      {error && (
        <div className="flex flex-col gap-3">
          <TonalBanner
            tone="destructive"
            icon="error"
            title={t("scenarios.error.title")}
            role="alert"
          >
            <span className="flex flex-col gap-1">
              <span className="font-mono text-xs leading-relaxed break-words">
                {error}
              </span>
              <span>{t("scenarios.error.body")}</span>
            </span>
          </TonalBanner>
          <div>
            <Button
              variant="destructive"
              onClick={refresh}
              disabled={isLoading}
              className="h-[2.625rem] gap-2 rounded-pill px-5 text-sm font-semibold"
            >
              <MaterialSymbol
                name={isLoading ? "progress_activity" : "refresh"}
                size={18}
                className={isLoading ? "animate-spin motion-reduce:animate-none" : undefined}
              />
              {t("actions.retry", { ns: "common" })}
            </Button>
          </div>
        </div>
      )}

      {/* Row 1: Scenario Profile Cards */}
      <div className="@container/card">
        {showSkeleton ? (
          <div className={SCENARIO_TILE_SHAPE.GRID}>
            {[1, 2, 3].map((i) => (
              <Skeleton
                key={i}
                className={cn(SCENARIO_TILE_SHAPE.HEIGHT, "rounded-card")}
              />
            ))}
            <Skeleton
              className={cn(SCENARIO_TILE_SHAPE.HEIGHT, "rounded-card opacity-50")}
            />
          </div>
        ) : (
          <div className={SCENARIO_TILE_SHAPE.GRID}>
            <motion.div
              className="contents"
              variants={staggerContainer}
            >
              {scenarios.map((scenario) => (
                <motion.div key={scenario.id} variants={staggerItem}>
                  <ScenarioItem
                    scenario={scenario}
                    isActive={activeScenarioId === scenario.id}
                    isSelected={selectedId === scenario.id}
                    onSelect={handleSelect}
                    onDelete={handleDeleteScenario}
                  />
                </motion.div>
              ))}
            </motion.div>
            <AddScenarioItem onClick={() => setShowAddDialog(true)} />
          </div>
        )}
      </div>

      {/* Row 2: Selected Scenario Configuration */}
      <div className="grid grid-cols-1 @3xl/main:grid-cols-2 grid-flow-row">
        {showSkeleton ? (
          <Card className={PROFILE_CARD_PEER}>
            <CardContent className={cn(PROFILE_PAD, "flex flex-col gap-5")}>
              <div className="flex items-center gap-3">
                <Skeleton className={CONFIG_CARD_SHAPE.DISC} />
                <div className="grid gap-1.5">
                  <Skeleton className={CONFIG_CARD_SHAPE.HEAD_TITLE} />
                  <Skeleton className={cn(CONFIG_CARD_SHAPE.HEAD_CHIP, "rounded-pill")} />
                </div>
              </div>
              <div className="flex flex-col gap-2">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div
                    key={i}
                    className={cn(CONFIG_CARD_SHAPE.ROW, CONFIG_CARD_SHAPE.ROW_FILL)}
                  >
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-20" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : (
          <ActiveConfigCard
            scenario={selectedScenario}
            isActive={isSelectedActive}
            isActivating={isActivating}
            onEdit={handleOpenEditDialog}
            onActivate={handleActivate}
            activateDisabled={isProfileControlled}
            activeProfileName={profileGate?.profileName}
            nextChangeAt={scheduleLocked ? nextChangeAt : null}
          />
        )}
      </div>

      {/* ===== Add Scenario Dialog ===== */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="rounded-card border-0 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("scenarios.dialog.add.title")}</DialogTitle>
          </DialogHeader>

          <div className="space-y-5 py-4">
            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="add-name">{t("scenarios.dialog.fields.name_label")}</Label>
              <Input
                id="add-name"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                placeholder={t("scenarios.dialog.fields.name_placeholder_add")}
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="add-description">
                {t("scenarios.dialog.fields.description_label")}
              </Label>
              <Input
                id="add-description"
                value={addDescription}
                onChange={(e) => setAddDescription(e.target.value)}
                placeholder={t("scenarios.dialog.fields.description_placeholder_add")}
              />
            </div>

            {/* Network Mode */}
            <div className="space-y-2">
              <Label>{t("scenarios.dialog.fields.network_mode_label")}</Label>
              <Select value={addMode} onValueChange={setAddMode}>
                <SelectTrigger aria-label={t("scenarios.dialog.fields.network_mode_label")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NETWORK_MODE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Band Locks */}
            <div className="space-y-2">
              <Label htmlFor="add-lte-bands">
                {t("scenarios.dialog.fields.lte_band_label")}
              </Label>
              <Input
                id="add-lte-bands"
                value={addLteBands}
                onChange={(e) => setAddLteBands(e.target.value)}
                placeholder={t("scenarios.dialog.fields.lte_band_placeholder")}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="add-sa-bands">
                  {t("scenarios.dialog.fields.sa_band_label")}
                </Label>
                <Input
                  id="add-sa-bands"
                  value={addSaNrBands}
                  onChange={(e) => setAddSaNrBands(e.target.value)}
                  placeholder={t("scenarios.dialog.fields.band_placeholder")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="add-nsa-bands">
                  {t("scenarios.dialog.fields.nsa_band_label")}
                </Label>
                <Input
                  id="add-nsa-bands"
                  value={addNsaNrBands}
                  onChange={(e) => setAddNsaNrBands(e.target.value)}
                  placeholder={t("scenarios.dialog.fields.band_placeholder")}
                />
              </div>
            </div>

            {/* Identity glyph */}
            <div className="space-y-2">
              <Label id="add-icon-label">{t("scenarios.dialog.fields.icon_label")}</Label>
              <div
                role="group"
                aria-labelledby="add-icon-label"
                className="grid grid-cols-6 gap-2"
              >
                {SCENARIO_ICONS.map(({ id, icon, labelKey }) => {
                  const selected = addIcon === id;
                  const label = t(labelKey);
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setAddIcon(id)}
                      aria-pressed={selected}
                      aria-label={label}
                      title={label}
                      className={cn(
                        "grid h-9 place-items-center rounded-inline transition-colors duration-[var(--duration-quick)] ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                        selected
                          ? "bg-primary text-primary-foreground"
                          // Hover previews the selected treatment in a lighter
                          // tone, so the affordance reads without implying the
                          // choice has already been made.
                          : "bg-surface-container-high text-on-surface-variant hover:bg-primary-container hover:text-on-primary-container",
                      )}
                    >
                      <MaterialSymbol name={icon} size={16} />
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Preview */}
            <div className="space-y-2">
              <Label>{t("scenarios.dialog.fields.preview_label")}</Label>
              <div className="bg-surface-container text-on-surface rounded-card relative h-20 overflow-hidden">
                <AbstractPattern
                  type="custom"
                  className="text-on-surface-variant absolute inset-0 h-full w-full"
                />
                <div className="relative flex items-center gap-3 p-4">
                  <span className="bg-primary text-primary-foreground grid size-9 flex-none place-items-center rounded-pill">
                    <MaterialSymbol name={resolveScenarioIcon(addIcon)} size={20} />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {addName || t("scenarios.dialog.fields.preview_name_fallback")}
                    </p>
                    <p className="text-on-surface-variant truncate text-sm">
                      {addDescription || t("scenarios.dialog.fields.preview_description_fallback")}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button
                variant="tonal"
                className="h-[2.625rem] rounded-pill px-5 text-sm font-semibold"
              >
                {t("actions.cancel", { ns: "common" })}
              </Button>
            </DialogClose>
            <Button
              onClick={handleAddScenario}
              disabled={!addName.trim() || isSaving}
              className="h-[2.625rem] gap-2 rounded-pill px-5 text-sm font-semibold"
            >
              {isSaving ? (
                <>
                  <MaterialSymbol
                    name="progress_activity"
                    size={18}
                    className="animate-spin motion-reduce:animate-none"
                  />
                  {t("scenarios.dialog.buttons.creating")}
                </>
              ) : (
                <>
                  <MaterialSymbol name="add" size={18} />
                  {t("scenarios.dialog.buttons.create")}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Edit Scenario Dialog ===== */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="rounded-card border-0 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("scenarios.dialog.edit.title")}</DialogTitle>
          </DialogHeader>

          <div className="space-y-5 py-4">
            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="edit-name">{t("scenarios.dialog.fields.name_label")}</Label>
              <Input
                id="edit-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder={t("scenarios.dialog.fields.name_placeholder_edit")}
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="edit-description">
                {t("scenarios.dialog.fields.description_label")}
              </Label>
              <Input
                id="edit-description"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder={t("scenarios.dialog.fields.description_placeholder_edit")}
              />
            </div>

            {/* Network Mode */}
            <div className="space-y-2">
              <Label>{t("scenarios.dialog.fields.network_mode_label")}</Label>
              <Select value={editMode} onValueChange={setEditMode}>
                <SelectTrigger aria-label={t("scenarios.dialog.fields.network_mode_label")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NETWORK_MODE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Optimization */}
            <div className="space-y-2">
              <Label htmlFor="edit-optimization">
                {t("scenarios.dialog.fields.optimization_label")}
              </Label>
              <Input
                id="edit-optimization"
                value={editOptimization}
                onChange={(e) => setEditOptimization(e.target.value)}
                placeholder={t("scenarios.dialog.fields.optimization_placeholder")}
              />
            </div>

            {/* Band Locks */}
            <div className="space-y-2">
              <Label htmlFor="edit-lte-bands">
                {t("scenarios.dialog.fields.lte_band_label")}
              </Label>
              <Input
                id="edit-lte-bands"
                value={editLteBands}
                onChange={(e) => setEditLteBands(e.target.value)}
                placeholder={t("scenarios.dialog.fields.lte_band_placeholder")}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-sa-bands">
                  {t("scenarios.dialog.fields.sa_band_label")}
                </Label>
                <Input
                  id="edit-sa-bands"
                  value={editSaNrBands}
                  onChange={(e) => setEditSaNrBands(e.target.value)}
                  placeholder={t("scenarios.dialog.fields.band_placeholder")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-nsa-bands">
                  {t("scenarios.dialog.fields.nsa_band_label")}
                </Label>
                <Input
                  id="edit-nsa-bands"
                  value={editNsaNrBands}
                  onChange={(e) => setEditNsaNrBands(e.target.value)}
                  placeholder={t("scenarios.dialog.fields.band_placeholder")}
                />
              </div>
            </div>

            {/* Identity glyph */}
            <div className="space-y-2">
              <Label id="edit-icon-label">{t("scenarios.dialog.fields.icon_label")}</Label>
              <div
                role="group"
                aria-labelledby="edit-icon-label"
                className="grid grid-cols-6 gap-2"
              >
                {SCENARIO_ICONS.map(({ id, icon, labelKey }) => {
                  const selected = editIcon === id;
                  const label = t(labelKey);
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setEditIcon(id)}
                      aria-pressed={selected}
                      aria-label={label}
                      title={label}
                      className={cn(
                        "grid h-9 place-items-center rounded-inline transition-colors duration-[var(--duration-quick)] ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                        selected
                          ? "bg-primary text-primary-foreground"
                          // Hover previews the selected treatment in a lighter
                          // tone, so the affordance reads without implying the
                          // choice has already been made.
                          : "bg-surface-container-high text-on-surface-variant hover:bg-primary-container hover:text-on-primary-container",
                      )}
                    >
                      <MaterialSymbol name={icon} size={16} />
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Preview */}
            <div className="space-y-2">
              <Label>{t("scenarios.dialog.fields.preview_label")}</Label>
              <div className="bg-surface-container text-on-surface rounded-card relative h-20 overflow-hidden">
                <AbstractPattern
                  type="custom"
                  className="text-on-surface-variant absolute inset-0 h-full w-full"
                />
                <div className="relative flex items-center gap-3 p-4">
                  <span className="bg-primary text-primary-foreground grid size-9 flex-none place-items-center rounded-pill">
                    <MaterialSymbol name={resolveScenarioIcon(editIcon)} size={20} />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {editName || t("scenarios.dialog.fields.preview_name_fallback")}
                    </p>
                    <p className="text-on-surface-variant truncate text-sm">
                      {editDescription || t("scenarios.dialog.fields.preview_description_fallback")}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button
                variant="tonal"
                className="h-[2.625rem] rounded-pill px-5 text-sm font-semibold"
              >
                {t("actions.cancel", { ns: "common" })}
              </Button>
            </DialogClose>
            <Button
              onClick={handleSaveEdit}
              disabled={!editName.trim() || isSaving}
              className="h-[2.625rem] gap-2 rounded-pill px-5 text-sm font-semibold"
            >
              {isSaving ? (
                <>
                  <MaterialSymbol
                    name="progress_activity"
                    size={18}
                    className="animate-spin motion-reduce:animate-none"
                  />
                  {t("scenarios.dialog.buttons.saving")}
                </>
              ) : (
                <>
                  <MaterialSymbol name="check" size={18} />
                  {t("scenarios.dialog.buttons.save_changes")}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ConnectionScenariosCard;
