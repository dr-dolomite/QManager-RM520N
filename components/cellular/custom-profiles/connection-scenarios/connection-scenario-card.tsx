"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { Gamepad2, Play, Zap } from "lucide-react";
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
import { Separator } from "@/components/ui/separator";
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
import { staggerContainer } from "@/lib/motion";
import {
  NETWORK_MODE_OPTIONS,
  modeValueToLabel,
  inputToBands,
  bandsToInput,
} from "@/types/connection-scenario";

// =============================================================================
// Constants
// =============================================================================

// Default (built-in) scenarios — icons are UI-only, not stored in backend
const DEFAULT_SCENARIOS: Scenario[] = [
  {
    id: "balanced",
    name: "Balanced",
    description: "Auto band selection",
    icon: Zap,
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
    name: "Gaming",
    description: "Low latency, SA priority",
    icon: Gamepad2,
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
    name: "Streaming",
    description: "High bandwidth, stable connection",
    icon: Play,
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
];

// =============================================================================
// Main Component
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
    activateScenario,
    saveCustomScenario,
    deleteCustomScenario,
  } = useConnectionScenarios();

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

  // Sync selection to active when active changes (e.g., on initial load)
  useEffect(() => {
    setSelectedId(activeScenarioId);
  }, [activeScenarioId]);

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
    () => [...DEFAULT_SCENARIOS, ...customScenarios],
    [customScenarios],
  );
  const selectedScenario = scenarios.find((s) => s.id === selectedId);
  const isSelectedActive = selectedId === activeScenarioId;

  // Fall back to first default if selected scenario isn't found
  // (e.g., active custom scenario ID from backend doesn't match any local scenario)
  useEffect(() => {
    if (!isLoading && selectedId && !scenarios.find((s) => s.id === selectedId)) {
      setSelectedId(DEFAULT_SCENARIOS[0].id);
    }
  }, [isLoading, selectedId, scenarios]);

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
      toast.success(`Switched to ${selectedScenario.name} scenario.`);
    } else {
      toast.error(
        `Failed to activate ${selectedScenario.name} scenario.`,
      );
    }
  }, [
    selectedScenario,
    selectedId,
    activeScenarioId,
    isActivating,
    activateScenario,
    isProfileControlled,
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
      description: addDescription || "Custom configuration",
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
        toast.success(
          "Scenario created. Return to your profile and select it.",
        );
        // One-shot — subsequent creates show the normal toast.
        setArrivedFromProfileForm(false);
      } else {
        toast.success("Scenario created successfully.");
      }
    } else {
      toast.error("Failed to create scenario.");
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
        setSelectedId(activeScenarioId === id ? DEFAULT_SCENARIOS[0].id : activeScenarioId);
      }
      toast.success("Scenario deleted.");
    } else {
      toast.error("Failed to delete scenario.");
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
      toast.success("Scenario updated.");
    } else {
      toast.error("Failed to update scenario.");
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

      {/* Row 1: Scenario Profile Cards */}
      <div className="col-span-full grid grid-cols-2 @3xl/main:grid-cols-4 gap-4">
        {isLoading ? (
          <>
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="rounded-xl h-36" />
            ))}
            <Skeleton className="rounded-xl h-36 opacity-50" />
          </>
        ) : (
          <>
            <motion.div
              className="contents"
              initial="hidden"
              animate="visible"
              variants={staggerContainer}
            >
              {scenarios.map((scenario) => (
                <motion.div
                  key={scenario.id}
                  variants={{ hidden: { opacity: 0, y: 12 }, visible: { opacity: 1, y: 0 } }}
                  transition={{ duration: 0.25, ease: "easeOut" }}
                >
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
          </>
        )}
      </div>

      {/* Row 2: Selected Scenario Configuration */}
      <div className="grid grid-cols-1 @3xl/main:grid-cols-2 grid-flow-row">
        {isLoading ? (
          <Card className="@container/card">
            <CardContent className="px-6">
              <div className="flex items-center gap-3 mb-5">
                <Skeleton className="h-11 w-11 rounded-xl" />
                <div className="grid gap-1.5">
                  <Skeleton className="h-5 w-44" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
              </div>
              <div className="grid gap-2">
                {[1, 2, 3, 4, 5].map((i) => (
                  <React.Fragment key={i}>
                    <Separator />
                    <div className="flex items-center justify-between">
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-4 w-20" />
                    </div>
                  </React.Fragment>
                ))}
                <Separator />
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
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New Connection Scenario</DialogTitle>
          </DialogHeader>

          <div className="space-y-5 py-4">
            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="add-name">Scenario Name</Label>
              <Input
                id="add-name"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                placeholder="e.g., Work from Home"
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="add-description">Description</Label>
              <Input
                id="add-description"
                value={addDescription}
                onChange={(e) => setAddDescription(e.target.value)}
                placeholder="e.g., Optimized for video calls"
              />
            </div>

            {/* Network Mode */}
            <div className="space-y-2">
              <Label>Network Mode</Label>
              <Select value={addMode} onValueChange={setAddMode}>
                <SelectTrigger aria-label="Network Mode">
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
              <Label htmlFor="add-lte-bands">LTE Band Lock</Label>
              <Input
                id="add-lte-bands"
                value={addLteBands}
                onChange={(e) => setAddLteBands(e.target.value)}
                placeholder="e.g., 1, 3, 7, 28 (empty = Auto)"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="add-sa-bands">NR5G-SA Band Lock</Label>
                <Input
                  id="add-sa-bands"
                  value={addSaNrBands}
                  onChange={(e) => setAddSaNrBands(e.target.value)}
                  placeholder="e.g., 41, 78"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="add-nsa-bands">NR5G-NSA Band Lock</Label>
                <Input
                  id="add-nsa-bands"
                  value={addNsaNrBands}
                  onChange={(e) => setAddNsaNrBands(e.target.value)}
                  placeholder="e.g., 41, 78"
                />
              </div>
            </div>

            {/* Identity glyph */}
            <div className="space-y-2">
              <Label id="add-icon-label">Icon</Label>
              <div
                role="group"
                aria-labelledby="add-icon-label"
                className="grid grid-cols-6 gap-2"
              >
                {SCENARIO_ICONS.map(({ id, Icon, label }) => {
                  const selected = addIcon === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setAddIcon(id)}
                      aria-pressed={selected}
                      aria-label={label}
                      title={label}
                      className={cn(
                        "grid h-9 place-items-center rounded-inline transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                        selected
                          ? "bg-primary text-primary-foreground"
                          // Hover previews the selected treatment in a lighter
                          // tone, so the affordance reads without implying the
                          // choice has already been made.
                          : "bg-surface-container-high text-on-surface-variant hover:bg-primary-container hover:text-on-primary-container",
                      )}
                    >
                      <Icon className="size-4" />
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Preview */}
            <div className="space-y-2">
              <Label>Preview</Label>
              <div className="bg-surface-container text-on-surface rounded-card relative h-20 overflow-hidden">
                <AbstractPattern
                  type="custom"
                  className="text-on-surface-variant absolute inset-0 h-full w-full"
                />
                <div className="relative flex items-center gap-3 p-4">
                  <span className="bg-primary text-primary-foreground grid size-9 flex-none place-items-center rounded-full">
                    {React.createElement(resolveScenarioIcon(addIcon), {
                      className: "size-5",
                    })}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {addName || "Scenario Name"}
                    </p>
                    <p className="text-on-surface-variant truncate text-sm">
                      {addDescription || "Custom configuration"}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              onClick={handleAddScenario}
              disabled={!addName.trim() || isSaving}
            >
              {isSaving ? "Creating…" : "Create Scenario"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Edit Scenario Dialog ===== */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Configuration</DialogTitle>
          </DialogHeader>

          <div className="space-y-5 py-4">
            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="edit-name">Scenario Name</Label>
              <Input
                id="edit-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Scenario name"
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="edit-description">Description</Label>
              <Input
                id="edit-description"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Scenario description"
              />
            </div>

            {/* Network Mode */}
            <div className="space-y-2">
              <Label>Network Mode</Label>
              <Select value={editMode} onValueChange={setEditMode}>
                <SelectTrigger aria-label="Network Mode">
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
              <Label htmlFor="edit-optimization">Optimization Label</Label>
              <Input
                id="edit-optimization"
                value={editOptimization}
                onChange={(e) => setEditOptimization(e.target.value)}
                placeholder="e.g., Latency, Throughput, Custom"
              />
            </div>

            {/* Band Locks */}
            <div className="space-y-2">
              <Label htmlFor="edit-lte-bands">LTE Band Lock</Label>
              <Input
                id="edit-lte-bands"
                value={editLteBands}
                onChange={(e) => setEditLteBands(e.target.value)}
                placeholder="e.g., 1, 3, 7, 28 (empty = Auto)"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-sa-bands">NR5G-SA Band Lock</Label>
                <Input
                  id="edit-sa-bands"
                  value={editSaNrBands}
                  onChange={(e) => setEditSaNrBands(e.target.value)}
                  placeholder="e.g., 41, 78"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-nsa-bands">NR5G-NSA Band Lock</Label>
                <Input
                  id="edit-nsa-bands"
                  value={editNsaNrBands}
                  onChange={(e) => setEditNsaNrBands(e.target.value)}
                  placeholder="e.g., 41, 78"
                />
              </div>
            </div>

            {/* Identity glyph */}
            <div className="space-y-2">
              <Label id="edit-icon-label">Icon</Label>
              <div
                role="group"
                aria-labelledby="edit-icon-label"
                className="grid grid-cols-6 gap-2"
              >
                {SCENARIO_ICONS.map(({ id, Icon, label }) => {
                  const selected = editIcon === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setEditIcon(id)}
                      aria-pressed={selected}
                      aria-label={label}
                      title={label}
                      className={cn(
                        "grid h-9 place-items-center rounded-inline transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                        selected
                          ? "bg-primary text-primary-foreground"
                          // Hover previews the selected treatment in a lighter
                          // tone, so the affordance reads without implying the
                          // choice has already been made.
                          : "bg-surface-container-high text-on-surface-variant hover:bg-primary-container hover:text-on-primary-container",
                      )}
                    >
                      <Icon className="size-4" />
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Preview */}
            <div className="space-y-2">
              <Label>Preview</Label>
              <div className="bg-surface-container text-on-surface rounded-card relative h-20 overflow-hidden">
                <AbstractPattern
                  type="custom"
                  className="text-on-surface-variant absolute inset-0 h-full w-full"
                />
                <div className="relative flex items-center gap-3 p-4">
                  <span className="bg-primary text-primary-foreground grid size-9 flex-none place-items-center rounded-full">
                    {React.createElement(resolveScenarioIcon(editIcon), {
                      className: "size-5",
                    })}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {editName || "Scenario Name"}
                    </p>
                    <p className="text-on-surface-variant truncate text-sm">
                      {editDescription || "Custom configuration"}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button onClick={handleSaveEdit} disabled={!editName.trim() || isSaving}>
              {isSaving ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ConnectionScenariosCard;
