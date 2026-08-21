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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TonalBanner } from "@/components/ui/tonal-banner";
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
  DEFAULT_SCENARIOS,
  NETWORK_MODE_OPTIONS,
  inputToBands,
  bandsToInput,
} from "@/types/connection-scenario";
import {
  PROFILE_CARD_PEER,
  PROFILE_PAD,
  SCENARIO_DISC_ACTIVE,
  SCENARIO_TILE_IDLE,
  SCENARIO_TILE_SHAPE,
  CONFIG_CARD_SHAPE,
  PILL_ACTION,
  PILL_ACTION_PLAIN,
  TILE_CAPTION,
} from "../shapes";

// =============================================================================
// ConnectionScenariosCard — tile grid + active config + create/edit dialogs
// =============================================================================
// SELF-CONTAINED CARD. Connection Scenarios stopped being its own destination:
// this now mounts inside the Custom SIM Profiles page's right-hand column, so it
// owns its own `CardHeader` and renders NO page chrome. The `h1`/description it
// used to sit under belonged to a route that no longer exists — two `h1`s on the
// merged page would have been an accessibility defect, not a styling one.
//
// It is also narrower than it was. `SCENARIO_TILE_SHAPE.GRID` is queried against
// `@container/card` (declared by `PROFILE_CARD_PEER` on the shell), so the grid
// lands at 2-up in the column and collapses to 1-up on its own — no viewport
// breakpoint is involved and none should be added.
//
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

/**
 * The `?action=` value that opens this card's "New scenario" dialog on mount.
 *
 * It lives HERE, beside the dialog it opens, rather than in a separate adapter
 * module. There used to be a `connection-scenario.tsx` shell whose whole job was
 * to read this param and pass `autoOpenAddDialog` down; the merged page shell
 * absorbed that job and the shell was left exporting nothing anyone rendered.
 * Two consumers remain — the page shell at `custom-profile.tsx`, and the retired
 * `/connection-scenarios` route, which rewrites the old bare `?action=create`
 * into this value on its way through.
 */
export const SCENARIO_CREATE_ACTION = "create-scenario";

interface ConnectionScenariosCardProps {
  /** If true on mount, open the "New Scenario" dialog automatically. Used by
   *  the deep-link from the SIM Profile form's "Create new custom scenario…"
   *  Select item. After successful create, a special toast prompts the user
   *  to return to their profile and select the new scenario. */
  autoOpenAddDialog?: boolean;
  /**
   * Monotonic counter the page shell increments to open the "New scenario"
   * dialog from its own header button. Every increment opens it once; the
   * initial 0 does nothing. See the effect that consumes it for why this is not
   * a boolean.
   */
  openAddSignal?: number;
  /**
   * Scenario id → "HH:MM" of that scenario's next scheduled activation, for the
   * per-tile schedule chip.
   *
   * SUPPLIED, NEVER DERIVED. A next-fire time is only knowable when an active
   * profile's `scenario.schedule` actually names the scenario, and that mapping
   * is the page shell's to compute — this card sees one profile's *aggregate*
   * `nextChangeAt`, which says when the radio changes but not to what. Omit the
   * prop and every tile simply renders no schedule chip. Printing a plausible
   * time the schedule does not contain is the State-Honesty violation the mock's
   * hardcoded "18:00" would otherwise have shipped.
   */
  nextFireByScenarioId?: Readonly<Record<string, string>>;
  /**
   * Whether a profile currently owns the radio, gating the foot notice about
   * schedule-owned activation and disabled manual band locking.
   *
   * Defaults to this card's OWN derivation from `useActiveProfile` (the same
   * condition that gates the Activate button), so the notice is never a standing
   * claim. Pass it explicitly only when the page shell has already resolved
   * ownership and wants the two surfaces to agree byte-for-byte.
   */
  radioOwnedByProfile?: boolean;
  /**
   * ADDED. Keeps this card's skeleton up past its own `list.sh` GET landing,
   * so it reveals on the same frame as the (slower) sibling cards rather
   * than popping in first every time — `scenarios/list.sh` is one request,
   * `profiles/list.sh` is one request PLUS a per-profile detail prefetch, so
   * this card is reliably the fast one. Only matters before the first
   * reveal; `hasLoadedOnceRef` below still governs every load after that,
   * unaffected by this prop.
   */
  holdSkeleton?: boolean;
  /**
   * ADDED. Fires whenever this card's OWN data-readiness changes, so the
   * page shell can AND it together with the sibling cards' own reports and
   * decide, in one place, when `holdSkeleton` can drop for all of them.
   */
  onLocalReadyChange?: (ready: boolean) => void;
}

const ConnectionScenariosCard = ({
  autoOpenAddDialog,
  openAddSignal,
  nextFireByScenarioId,
  radioOwnedByProfile,
  holdSkeleton = false,
  onLocalReadyChange,
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

  // The three built-in scenarios.
  // ---------------------------------------------------------------------------
  // DERIVED from the shared `DEFAULT_SCENARIOS`, never restated. This block used
  // to be a second, inline copy of that constant, and the two had drifted in the
  // one field that matters: the shared copy holds the PERSISTED icon ids
  // ("zap" / "gamepad" / "play"), while the inline copy held already-resolved
  // LIGATURES ("bolt" / "sports_esports" / "play_arrow"). Every render site goes
  // through `resolveScenarioIcon()`, which finds no option whose id is "bolt"
  // and falls back to the sparkle — so all three built-in tiles rendered the
  // same fallback glyph while the hero and the schedule ribbon, reading the
  // shared copy, rendered the right ones. Overlaying only `name`/`description`
  // is what keeps that impossible.
  //
  // Those two fields MUST stay `t()` calls at render time: `DEFAULT_SCENARIOS`
  // is a module-level constant carrying English, and sourcing the labels from it
  // directly would silently un-translate every locale. They are keyed off each
  // scenario's stable `id`, so the `scenarios.default_*_name` key set that
  // already shipped keeps working.
  const defaultScenarios: Scenario[] = useMemo(
    () =>
      DEFAULT_SCENARIOS.map((scenario) => ({
        ...scenario,
        name: t(`scenarios.default_${scenario.id}_name`),
        description: t(`scenarios.default_${scenario.id}_description`),
      })),
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

  // The foot notice describes a CONDITION, not a rule of the page: it is only
  // true while something actually owns the radio. Caller override wins; the
  // local gate is the default so the notice can never contradict the disabled
  // Activate button sitting a few rows above it.
  const showOwnershipNotice = radioOwnedByProfile ?? isProfileControlled;

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
  const locallyReady = !isLoading || hasLoadedOnceRef.current;
  // `holdSkeleton` is a one-way latch owned by the page shell (it only ever
  // flips true→false, never back), so reading it directly here is safe — it
  // cannot re-arm on a later background refresh the way a local escape ref
  // would need to guard against.
  const showSkeleton = !locallyReady || holdSkeleton;

  useEffect(() => {
    onLocalReadyChange?.(locallyReady);
    // See the matching effect in custom-profile-view.tsx — same rationale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locallyReady]);

  // Convert backend StoredScenario[] → UI Scenario[] (add pattern, isDefault).
  //
  // `icon` PASSES THROUGH UNTOUCHED. It is the persisted key and it stays a key
  // all the way to the render sites, each of which crosses the id→ligature
  // boundary itself. Resolving it here — and carrying a second `iconId` field
  // beside it so the edit dialog could still pre-select the picker — is exactly
  // what allowed a ligature to end up in an id-shaped field. Records saved
  // before the icon field existed carry no key at all and resolve to the
  // default glyph downstream.
  const customScenarios: Scenario[] = useMemo(
    () =>
      storedScenarios.map((s) => ({
        ...s,
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

  // The page header's "New scenario" button.
  // ---------------------------------------------------------------------------
  // A COUNTER, not a boolean, because the user can press that button any number
  // of times and a boolean that is already `true` produces no change for an
  // effect to observe — the dialog would open once and never again. The
  // alternative, remounting this card with a `key`, would refetch the scenario
  // list and throw away the selected tile on every press.
  //
  // Guarded on `> 0` so the initial render does not count as a press.
  useEffect(() => {
    if (openAddSignal && openAddSignal > 0) {
      setShowAddDialog(true);
    }
  }, [openAddSignal]);

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
        // Legacy mirror of `atModeValue`, still written because every stored
        // scenario on every device already carries the field and the config
        // store has no key-migration primitive. It used to hold an English
        // LABEL ("5G SA Only"), which is why an Italian user read English here;
        // it now holds the AT value, so the copy is at least self-describing to
        // anyone reading the JSON on the device. It is never rendered — display
        // goes through `modeLabel(t, config.atModeValue)`. Note this is NOT the
        // `mode` field `activate.sh` parses: that one is built separately in
        // `use-connection-scenarios.ts` from `atModeValue`.
        mode: addMode,
        // A STABLE ENGLISH TOKEN, not a translated word, and that is the fix
        // rather than the bug. The create dialog has no optimization field, so
        // every scenario made here gets this value — writing `t(…)` would burn
        // the author's language into the user's saved data permanently, and the
        // scenario would still read "Personalizzato" after they switched the UI
        // back to English. `optimizationLabel()` translates it at display time.
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
    setEditIcon(selectedScenario.icon ?? DEFAULT_SCENARIO_ICON_ID);
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
        mode: editMode,
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
    <Card className={PROFILE_CARD_PEER}>
      <CardHeader className={PROFILE_PAD}>
        <CardTitle className="text-xl">{t("scenarios.card.title")}</CardTitle>
        <CardDescription className="text-pretty">
          {t("scenarios.card.description")}
        </CardDescription>
      </CardHeader>

      <CardContent className={cn(PROFILE_PAD, "flex flex-col gap-4")}>
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
              className={PILL_ACTION}
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

      {/* The tile grid. NOTE ON THE MISSING EMPTY STATE: there is none, and
          that is correct rather than an omission — three built-in scenarios
          always exist, so the grid can never render zero tiles. Loading and
          error are the only other reachable states. */}
      {showSkeleton ? (
        // THE SKELETON MIRRORS BY RENDERING THE TILE, not by restating a
        // height. `SCENARIO_TILE_SHAPE.ROOT` floors at 6.5rem and grows when a
        // tag strip wraps, so a pinned `h-36` placeholder — what the previous
        // generation used against a `min-h-[9rem]` tile — guaranteed a jump at
        // the loading→loaded handoff for exactly the tiles that wrapped.
        <div className={SCENARIO_TILE_SHAPE.GRID}>
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className={cn(SCENARIO_TILE_SHAPE.ROOT, SCENARIO_TILE_IDLE)}
            >
              <Skeleton className={SCENARIO_TILE_SHAPE.DISC} />
              <div className={SCENARIO_TILE_SHAPE.COL}>
                <Skeleton className="h-[1.125rem] w-28" />
                <Skeleton className="h-5 w-36 rounded-pill" />
                <Skeleton className="h-3.5 w-20" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className={SCENARIO_TILE_SHAPE.GRID}>
          {/* The 120ms CARD step: these are tiles in a grid, the same cascade
              the hero's tile strip and the Radio summary strip run, so the two
              grids on this page reveal on one clock. The container is
              `display:contents` so the grid still sees the tiles as its own
              children; each child is a real block box, which is what the
              cascade needs to animate. Children carry ONLY `variants` — an
              `initial`/`animate` of their own would detach them from the
              page shell's clock. */}
          <motion.div className="contents" variants={staggerContainer}>
            {scenarios.map((scenario) => (
              <motion.div key={scenario.id} variants={staggerItem}>
                <ScenarioItem
                  scenario={scenario}
                  isActive={activeScenarioId === scenario.id}
                  isSelected={selectedId === scenario.id}
                  onSelect={handleSelect}
                  onDelete={handleDeleteScenario}
                  nextFireAt={nextFireByScenarioId?.[scenario.id] ?? null}
                />
              </motion.div>
            ))}
            <motion.div variants={staggerItem}>
              <AddScenarioItem onClick={() => setShowAddDialog(true)} />
            </motion.div>
          </motion.div>
        </div>
      )}

      {/* Selected Scenario Configuration. An inner block now, not a nested
          card — see the header of `active-config-card.tsx`. The skeleton
          mirrors it by importing the same `CONFIG_CARD_SHAPE` members rather
          than restating `h-11 w-11` / `h-5 w-44`. */}
      {showSkeleton ? (
        <div className="bg-surface-container rounded-tile flex flex-col gap-5 p-5">
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
                className={cn(
                  CONFIG_CARD_SHAPE.ROW,
                  CONFIG_CARD_SHAPE.ROW_FILL,
                  "bg-surface-container-high",
                )}
              >
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>
        </div>
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

      {/* Ownership notice. Conditional on the radio actually being owned — a
          notice printed unconditionally would be describing a state the page
          is not in. `rounded-field` (20px) so it never out-rounds the
          `rounded-card` shell hosting it. */}
      {showOwnershipNotice && !showSkeleton && (
        <p className="bg-surface-container text-on-surface-variant rounded-field flex items-start gap-2.5 px-4 py-3.5 text-xs leading-relaxed text-pretty">
          <MaterialSymbol name="info" size={16} className="mt-px flex-none" />
          <span>{t("scenarios.ownership_notice")}</span>
        </p>
      )}

      </CardContent>

      {/* ===== Add Scenario Dialog ===== */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="rounded-card sm:max-w-md">
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
                      {t(opt.labelKey)}
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
              {/* The preview IS a scenario tile — same ROOT / DISC / COL /
                  NAME the grid renders, so what the dialog shows is what the
                  grid will show. It carried a decorative `AbstractPattern`
                  wash behind it before; colour belongs to the data, not to the
                  furniture, and a texture layer is the definition of furniture. */}
              <div className={cn(SCENARIO_TILE_SHAPE.ROOT, SCENARIO_TILE_IDLE)}>
                <span
                  className={cn(SCENARIO_TILE_SHAPE.DISC, SCENARIO_DISC_ACTIVE)}
                >
                  <MaterialSymbol
                    name={resolveScenarioIcon(addIcon)}
                    size={21}
                    filled
                  />
                </span>
                <div className={SCENARIO_TILE_SHAPE.COL}>
                  <p className={SCENARIO_TILE_SHAPE.NAME}>
                    {addName || t("scenarios.dialog.fields.preview_name_fallback")}
                  </p>
                  <p className={cn(TILE_CAPTION, "truncate")}>
                    {addDescription ||
                      t("scenarios.dialog.fields.preview_description_fallback")}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button
                variant="tonal"
                className={PILL_ACTION_PLAIN}
              >
                {t("actions.cancel", { ns: "common" })}
              </Button>
            </DialogClose>
            <Button
              onClick={handleAddScenario}
              disabled={!addName.trim() || isSaving}
              className={PILL_ACTION}
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
        <DialogContent className="rounded-card sm:max-w-md">
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
                      {t(opt.labelKey)}
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
              {/* Same tile geometry as the add dialog's preview and the grid
                  itself — see the note there. */}
              <div className={cn(SCENARIO_TILE_SHAPE.ROOT, SCENARIO_TILE_IDLE)}>
                <span
                  className={cn(SCENARIO_TILE_SHAPE.DISC, SCENARIO_DISC_ACTIVE)}
                >
                  <MaterialSymbol
                    name={resolveScenarioIcon(editIcon)}
                    size={21}
                    filled
                  />
                </span>
                <div className={SCENARIO_TILE_SHAPE.COL}>
                  <p className={SCENARIO_TILE_SHAPE.NAME}>
                    {editName || t("scenarios.dialog.fields.preview_name_fallback")}
                  </p>
                  <p className={cn(TILE_CAPTION, "truncate")}>
                    {editDescription ||
                      t("scenarios.dialog.fields.preview_description_fallback")}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button
                variant="tonal"
                className={PILL_ACTION_PLAIN}
              >
                {t("actions.cancel", { ns: "common" })}
              </Button>
            </DialogClose>
            <Button
              onClick={handleSaveEdit}
              disabled={!editName.trim() || isSaving}
              className={PILL_ACTION}
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
    </Card>
  );
};

export default ConnectionScenariosCard;
