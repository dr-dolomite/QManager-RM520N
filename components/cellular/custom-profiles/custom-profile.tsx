"use client";

import React, {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";

import CustomProfileViewComponent from "@/components/cellular/custom-profiles/custom-profile-view";
import { ProfileFormDialog } from "@/components/cellular/custom-profiles/profile-form-dialog";
import type { WizardTab } from "@/components/cellular/custom-profiles/custom-profile-form";
import { ApplyProgressDialog } from "@/components/cellular/custom-profiles/apply-progress-dialog";
import {
  DeactivateProgressDialog,
  type DeactivatePhase,
} from "@/components/cellular/custom-profiles/deactivate-progress-dialog";
import {
  ActiveProfileHero,
  ActiveProfileHeroSkeleton,
} from "@/components/cellular/custom-profiles/active-profile-hero";
// The 24-hour strip is a PEER card now, not a band inside the hero — see the
// header of `schedule-ribbon.tsx` for why it left. The page composes the two as
// siblings, which is the whole of this file's involvement in the move.
import {
  ScheduleTodayCard,
  ScheduleTodayCardSkeleton,
} from "@/components/cellular/custom-profiles/schedule-ribbon";
// `SCENARIO_CREATE_ACTION` is the literal the retired Connection Scenarios route
// rewrites its old `?action=create` into. Imported rather than restated so the
// page, the card and the redirect cannot drift on the string.
import ConnectionScenariosCard, {
  SCENARIO_CREATE_ACTION,
} from "@/components/cellular/custom-profiles/connection-scenarios/connection-scenario-card";
import {
  useSimProfiles,
  SimProfilesProvider,
  type ProfileFormData,
} from "@/hooks/use-sim-profiles";
import { useProfileApply } from "@/hooks/use-profile-apply";
import { useCurrentSettings } from "@/hooks/use-current-settings";
import { useProfileSuggestions } from "@/hooks/use-profile-suggestions";
import { useModemStatus } from "@/hooks/use-modem-status";
import {
  useConnectionScenarios,
  ConnectionScenariosProvider,
} from "@/hooks/use-connection-scenarios";
import type { SimProfile } from "@/types/sim-profile";
import {
  DEFAULT_SCENARIOS,
  type ConnectionScenario,
} from "@/types/connection-scenario";
import { buildDayTimeline, formatMinute } from "@/lib/schedule-timeline";
import {
  PILL_ACTION,
  PILL_ACTION_PLAIN,
  HERO_CARD,
  HERO_DISC,
  HERO_DISC_TONE,
  HERO_STATE,
  MACHINE_VALUE,
  SAVED_PROFILES_ANCHOR,
} from "@/components/cellular/custom-profiles/shapes";
import {
  DUR,
  EASE_STANDARD,
  staggerContainer,
  staggerItem,
} from "@/lib/motion";
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
import { CellularPageHeader } from "@/components/cellular/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { cn } from "@/lib/utils";

// The pill dialog-action pair, matching `sms/delete-dialogs.tsx`'s
// `DESTRUCTIVE_ACTION`/`CANCEL_ACTION` constants: both Activate and
// Deactivate here are non-destructive confirmations, so the action side
// composes the `default` variant rather than `destructive`.
const CONFIRM_ACTION = cn(buttonVariants({ variant: "default" }), PILL_ACTION);
const CANCEL_ACTION = PILL_ACTION_PLAIN;

/**
 * The hero <-> NoActiveProfile cross-fade.
 *
 * TODO(shapes): promote to shapes.ts if a second surface wants it. Kept local
 * for now — WS1 owns that file concurrently and this has exactly one consumer.
 *
 * WHY THIS HAS AN EXIT AT ALL, given the Enter-Only Rule. That rule governs
 * CONDITIONS and NAVIGATION: a banner leaving means the condition cleared and
 * that should feel immediate. This is neither. The hero is the page's permanent
 * anchor SLOT — it is never empty, it always renders one of two full states, and
 * a deactivate swaps which one. `mode="wait"` needs an exit by construction, and
 * without one the two full-height cards co-mount for a frame and shove the
 * entire page down and back. This is the same shape
 * `components/local-network/ip-passthrough/ip-passthrough-card.tsx:295-372`
 * already establishes for two mutually-exclusive full states.
 *
 * `quick` (360ms) each way rather than `standard`: the swap follows a mutation
 * the user just waited 8-12 seconds for, so the result must land, not saunter.
 * Transform + opacity only — this runs on the modem's own CPU while it carries
 * the user's traffic.
 */
const HERO_SWAP = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0 },
  transition: { duration: DUR.quick, ease: EASE_STANDARD },
} as const;

// =============================================================================
// CustomProfileComponent — the merged SIM Profiles surface
// =============================================================================
// This page absorbed Connection Scenarios, which used to be its own route. The
// two were always one feature wearing two URLs: a profile's whole purpose is to
// bind a scenario, and the scenario is what owns the radio once it does. Split
// across two pages, the user had to hold that relationship in their head; here
// the hero states it outright.
//
// ANATOMY — answer first, then the things you can change:
//
//   1. Page header + the two creation actions
//   2. The "in force now" HERO — what the modem is running this second
//   3. A two-column grid: saved profiles (wider) beside connection scenarios
//
// The hero is the one place `rounded-hero` is spent on this surface, and it is
// the Consistent-Layout Rule's sanctioned exception ("a genuine glance surface
// may earn a hero card"), not a breach of it. Everything under it is still the
// uniform card grid every other feature page uses.
//
// WHY THE WIZARD IS A DIALOG NOW. It used to be a permanently-mounted left
// column, which meant half the page was a form nobody was filling in 95% of the
// time — and it pushed the thing users actually came for (what is running) below
// the fold. It is the same component, unmodified, in a dialog.
// =============================================================================

/**
 * One clock for the whole page.
 *
 * The hero's ribbon needle, its "next change at HH:MM" caption, and every row's
 * mini-bar all derive from this single `Date`. Reading `new Date()` at each call
 * site would let the needle and the caption disagree across a minute boundary —
 * and a bare `new Date()` in render is also a react-compiler purity violation.
 * It ticks on the minute because nothing on this surface is finer-grained than
 * that; a per-second tick would re-render the list sixty times more often for no
 * visible change.
 */
function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/**
 * The page body. Everything here runs INSIDE both providers, so every
 * `useSimProfiles` / `useConnectionScenarios` / `useScenarioList` /
 * `useActiveProfile` call on this surface — including the ones inside the
 * scenarios card, the profile list and the wizard dialog — reads the two shared
 * instances rather than fetching for itself.
 */
const CustomProfilePageBody = () => {
  const { t } = useTranslation("cellular");
  const { t: tc } = useTranslation("common");
  const now = useMinuteClock();

  const {
    profiles,
    activeProfileId,
    isLoading,
    error,
    createProfile,
    updateProfile,
    deleteProfile,
    deactivateProfile,
    getProfile,
    refresh,
  } = useSimProfiles();

  const { applyState, applyProfile, error: applyError } = useProfileApply();

  // fetchOnMount = true: the create form pre-fills from the SIM automatically on
  // page load. Measured on hardware at ~0.2s (NOT the 2-3s this comment used to
  // claim — see the recon note in docs/reference/sim-profiles.md), and the form
  // treats a mount-sourced settings object as fill-empty-only, so nothing on the
  // page waits for it.
  const { settings: currentSettings, refresh: refreshCurrentSettings } =
    useCurrentSettings(true);

  const { data: modemStatus } = useModemStatus();
  const currentIccid = modemStatus?.device?.iccid ?? null;

  // Full scenario records, for the hero's identity glyph + radio read-out and
  // for each profile row's bound-scenario line. Read-only here — the card below
  // owns the mutations, but under `ConnectionScenariosProvider` it now mutates
  // the SAME instance this reads, so a rename in the card lands in the hero.
  const { customScenarios } = useConnectionScenarios();

  const scenarios: ConnectionScenario[] = useMemo(
    () => [
      ...DEFAULT_SCENARIOS,
      ...customScenarios.map((s) => ({
        ...s,
        pattern: "custom" as const,
        isDefault: false,
      })),
    ],
    [customScenarios],
  );

  // ---------------------------------------------------------------------------
  // The active profile, in full
  // ---------------------------------------------------------------------------
  // `profiles/list.sh` returns a SUMMARY — it carries the scenario binding (so
  // the ribbon and every row's mini-bar are already satisfied) but deliberately
  // omits `settings`. The hero renders APN / CID / PDP / TTL / HL / IMEI, so it
  // needs the full record and has to ask for it by id.
  const [activeProfile, setActiveProfile] = useState<SimProfile | null>(null);

  // -------------------------------------------------------------------------
  // THE DETAIL NONCE — the only thing that can re-run the fetch below
  // -------------------------------------------------------------------------
  // The effect's two natural dependencies BOTH refuse to change on the one
  // event that most needs to invalidate this record: editing the profile that
  // is already active. `activeProfileId` is the same id before and after, and
  // `getProfile` is a `useCallback(…, [])` in `use-sim-profiles.ts` — stable for
  // the lifetime of the hook. So the effect never re-ran and the hero showed the
  // pre-edit record INDEFINITELY. Not "until the next poll": `useActiveProfile`'s
  // 30s poll is disabled under `SimProfilesProvider`, and there is no other
  // background refresh on this surface. Everything derived from `activeProfile`
  // went stale with it — `activeScenario`, `nextFireByScenarioId`,
  // `radioOwnedByProfile`, and the hero's whole `ScheduleRibbon`.
  //
  // Calling the hook's `refresh()` does NOT fix it. `refresh()` re-runs
  // `fetchProfiles()`, which repopulates the SUMMARY list — and `list.sh`
  // deliberately omits the `settings` object the hero renders. It also cannot
  // change `activeProfileId` when the same profile is still active, so the
  // effect below still would not fire.
  //
  // A monotonically-incrementing counter is the mechanism because it is the one
  // signal that is unequal to its predecessor BY CONSTRUCTION — no value
  // equality, no reference identity, nothing about the profile itself. Bump it
  // and the fetch re-runs, whether or not anything else moved.
  const [detailNonce, setDetailNonce] = useState(0);
  const invalidateActiveProfile = useCallback(
    () => setDetailNonce((n) => n + 1),
    [],
  );

  // -------------------------------------------------------------------------
  // SETTLEMENT, held separately from SUCCESS
  // -------------------------------------------------------------------------
  // `getProfile` NEVER rejects (`use-sim-profiles.ts:353-379` catches
  // internally) and returns null for a dropped request AND for a genuinely
  // missing record alike. So "did the detail GET finish?" and "did it produce a
  // record?" are two different questions, and the page's readiness gate must
  // ask the FIRST one. Conflating them is what bricked this surface: readiness
  // read `activeProfile !== null`, so one failed GET at mount left
  // `heroLocallyReady` false forever, `pageReady` never latched, and all three
  // surfaces sat on skeletons with no error, no retry and no way out but a
  // reload the UI never suggested. `list.sh` naming an `active_profile_id`
  // whose JSON file is gone reproduces that on EVERY load, not transiently.
  //
  // Settlement is stored as the ID THAT SETTLED rather than as a boolean, which
  // is what makes the two invalidation paths behave differently without a
  // second flag:
  //
  //   nonce bump (same id)  — `settledDetailId` still equals `activeProfileId`,
  //                           so the page stays settled and a failed REFRESH
  //                           never tears a revealed page back down. That is the
  //                           same reasoning the `pageReady` latch and
  //                           `showHeroSkeleton` already carry.
  //   id change             — the new id has not settled, so readiness drops
  //                           back to false. Note the hero does NOT flash the
  //                           error card in that window: `activeProfile` still
  //                           holds the PREVIOUS record (the null-guard below
  //                           keeps it), and the error card only renders once
  //                           `activeProfile` is null AND this id has settled.
  const [settledDetailId, setSettledDetailId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!activeProfileId) {
      setActiveProfile(null);
      setSettledDetailId(null);
      return;
    }
    // Keep the previous hero mounted while the detail lands, rather than
    // blanking it — a hero that flickers on every refresh reads as the page
    // reloading.
    void getProfile(activeProfileId).then((p) => {
      if (cancelled) return;
      // BOTH branches settle. A failed GET is a finished GET; what it is not is
      // a successful one, and the render path below is what tells those apart.
      setSettledDetailId(activeProfileId);
      if (p) {
        setActiveProfile(p);
        return;
      }
      // A detail GET that came back empty is NOT evidence that nothing is
      // active — `getProfile` returns null for a network failure and for a
      // missing record alike, and the LIST is the authority on what is in force
      // (it still names this id). Blanking here would flash `NoActiveProfile`
      // on a dropped request, which matters more now that the nonce re-runs
      // this after every mutation rather than once per id change.
      setActiveProfile((prev) => (prev?.id === activeProfileId ? prev : null));
    });
    return () => {
      cancelled = true;
    };
    // `detailNonce` is the invalidation channel — see the block above.
  }, [activeProfileId, getProfile, detailNonce]);

  const heroDetailSettled = Boolean(
    activeProfileId && settledDetailId === activeProfileId,
  );

  // The hero's THIRD state: the list says a profile is in force, the detail GET
  // has finished, and it produced nothing. Rendering `NoActiveProfile` here —
  // which is what "just report ready on error" amounts to — would assert to the
  // user that their modem is on the stock APN and the default scenario. That is
  // a claim about HARDWARE we have no evidence for, and it is the exact flash
  // the null-guard above exists to prevent, made permanent instead of momentary.
  const heroDetailFailed = heroDetailSettled && activeProfile === null;

  const activeScenario = useMemo(() => {
    if (!activeProfile) return null;
    const { segments } = buildDayTimeline(
      activeProfile.scenario.schedule,
      activeProfile.scenario.default,
      now,
    );
    // The live segment IS the answer — `buildDayTimeline` already applied the
    // schedule's day filter, midnight wraps and first-match-wins overlap rule,
    // so reading the binding's `default` directly here would disagree with the
    // ribbon drawn from the same call whenever a block is in force.
    const live = segments.find((s) => s.isLive);
    const id = live?.scenarioId ?? activeProfile.scenario.default;
    return scenarios.find((s) => s.id === id) ?? null;
  }, [activeProfile, scenarios, now]);

  // ---------------------------------------------------------------------------
  // Per-scenario next-fire times, for the scenario tiles' schedule chips
  // ---------------------------------------------------------------------------
  // A tile may only claim "next at 18:00" when the ACTIVE profile's schedule
  // actually names that scenario. The card cannot derive this — it holds one
  // aggregate "next change" that says when the radio changes but not to what —
  // so the page, which owns the active profile, computes it and hands it down.
  // No active profile, or no enabled schedule, means no chips at all rather than
  // a plausible-looking time nothing will honor.
  const nextFireByScenarioId = useMemo<Record<string, string>>(() => {
    if (!activeProfile?.scenario.schedule.enabled) return {};
    const { segments, nowMinute } = buildDayTimeline(
      activeProfile.scenario.schedule,
      activeProfile.scenario.default,
      now,
    );
    const out: Record<string, string> = {};
    for (const seg of segments) {
      if (seg.startMinute <= nowMinute) continue;
      if (out[seg.scenarioId]) continue;
      out[seg.scenarioId] = formatMinute(seg.startMinute);
    }
    return out;
  }, [activeProfile, now]);

  const radioOwnedByProfile = Boolean(
    activeProfile && activeProfile.scenario.schedule.enabled,
  );

  // ---------------------------------------------------------------------------
  // Coordinated first reveal — hero, Saved Profiles, and Connection Scenarios
  // together
  // ---------------------------------------------------------------------------
  // Three independent fetches back these three surfaces (the active profile's
  // detail GET, `profiles/list.sh` plus its per-profile detail prefetch, and
  // `scenarios/list.sh`), and they never land in the same frame. Left alone,
  // each pops in the moment ITS OWN data arrives — a staggered reveal that
  // reads as the page loading three times, and worse for the hero: with no
  // active profile yet confirmed, an unset `activeProfileId` looks identical
  // to "confirmed no active profile" until the list actually answers, so it
  // would flash "No Profile" before correcting itself.
  //
  // Each surface reports its OWN readiness — a plain, one-directional signal,
  // never influenced by whether the OTHER surfaces are ready — and this page
  // ANDs the three together into `allLocallyReady`. `pageReady` latches the
  // first time that AND is true and never resets, so a later background
  // refresh on any one surface freezes on stale data instead of re-triggering
  // a shared skeleton. Because no surface's own readiness report is gated by
  // `pageReady` (that would make each wait on the others waiting on it), the
  // three can never deadlock waiting on each other.
  const [profilesLocallyReady, setProfilesLocallyReady] = useState(false);
  const [scenariosLocallyReady, setScenariosLocallyReady] = useState(false);
  // SETTLEMENT, not success — see the block above the detail effect. A hero that
  // reports "not ready" because its fetch FAILED can never become ready, and it
  // takes the whole page's skeleton down with it.
  const heroLocallyReady =
    !isLoading && (!activeProfileId || heroDetailSettled);

  const allLocallyReady =
    profilesLocallyReady && scenariosLocallyReady && heroLocallyReady;
  const [pageReady, setPageReady] = useState(false);
  useEffect(() => {
    if (allLocallyReady) setPageReady(true);
  }, [allLocallyReady]);

  const handleProfilesLocalReadyChange = useCallback((ready: boolean) => {
    setProfilesLocallyReady(ready);
  }, []);
  const handleScenariosLocalReadyChange = useCallback((ready: boolean) => {
    setScenariosLocallyReady(ready);
  }, []);

  // `!pageReady` ALONE, deliberately. `pageReady` already ANDs `heroLocallyReady`
  // into its latch, so the first reveal is unchanged — but keeping
  // `!heroLocallyReady` in this expression as well made every LATER refresh
  // (`refresh()` sets `isLoading` back to true) tear the hero down to a skeleton
  // and build it again, which is exactly the re-triggered shared skeleton the
  // latch comment above says it exists to prevent. Auto-reapply-on-save makes
  // that refresh routine rather than rare, so the contradiction had to go.
  const showHeroSkeleton = !pageReady;

  // ---------------------------------------------------------------------------
  // "Recommended for your SIM" — carrier-matched suggestions
  // ---------------------------------------------------------------------------
  // Pure decision layer over data this page already holds: the PLMN + ICCID from
  // current_settings.sh, the saved-profile list, and the modem's supported band
  // lists. No extra endpoint, no second poller.
  const {
    suggestions,
    creatingId,
    error: suggestionsError,
    createFromSuggestion,
  } = useProfileSuggestions({
    mcc: currentSettings?.mcc,
    mnc: currentSettings?.mnc,
    spn: currentSettings?.spn,
    networkName: currentSettings?.network_name,
    currentIccid: currentSettings?.iccid ?? currentIccid,
    profiles,
    supportedNsaBands: modemStatus?.device?.supported_nsa_nr5g_bands,
    supportedSaBands: modemStatus?.device?.supported_sa_nr5g_bands,
    createProfile,
  });

  const handleCreateFromSuggestion = useCallback(
    async (suggestionId: string) => {
      const newId = await createFromSuggestion(suggestionId);
      if (newId) refresh();
    },
    [createFromSuggestion, refresh],
  );

  // ---------------------------------------------------------------------------
  // The wizard dialog
  // ---------------------------------------------------------------------------
  const [editingProfile, setEditingProfile] = useState<SimProfile | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  // Which wizard step the dialog opens on. "Edit schedule" is the one entry
  // point that wants "scenario" instead of the default "identity" — see
  // `handleEditSchedule` below.
  const [formInitialTab, setFormInitialTab] = useState<WizardTab>("identity");

  // Deep links, latched once at mount.
  // ---------------------------------------------------------------------------
  // `?action=create` opens the profile wizard; `?action=create-scenario` (which
  // the retired Connection Scenarios route rewrites its own `?action=create`
  // into) opens the scenario dialog inside the card below.
  //
  // Latched rather than derived so no later re-render or prop change can pull
  // the user back into a dialog they have already dismissed. This preserved the
  // pre-merge behavior, where the same link scrolled the always-mounted form
  // into view; only the mechanism changed.
  const searchParams = useSearchParams();
  const [arrivedFromCreateLink] = useState(
    () => searchParams.get("action") === "create",
  );
  const [arrivedFromScenarioLink] = useState(
    () => searchParams.get("action") === SCENARIO_CREATE_ACTION,
  );

  // Bumped by the header's "New scenario" button. The card opens its dialog on
  // each increment — see `openAddSignal` there for why a boolean cannot work.
  const [scenarioCreateSignal, setScenarioCreateSignal] = useState(0);

  useEffect(() => {
    if (arrivedFromCreateLink) {
      setEditingProfile(null);
      setFormOpen(true);
    }
    // Mount only; ignore later search-param changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleNewProfile = useCallback(() => {
    setEditingProfile(null);
    setFormInitialTab("identity");
    setFormOpen(true);
  }, []);

  const handleEdit = useCallback(
    async (id: string) => {
      const profile = await getProfile(id);
      if (profile) {
        setEditingProfile(profile);
        setFormInitialTab("identity");
        setFormOpen(true);
      }
    },
    [getProfile],
  );

  const handleEditActive = useCallback(() => {
    if (activeProfile) {
      setEditingProfile(activeProfile);
      setFormInitialTab("identity");
      setFormOpen(true);
    }
  }, [activeProfile]);

  // ---------------------------------------------------------------------------
  // Auto-reapply on save
  // ---------------------------------------------------------------------------
  // `save.sh` is a pure disk write (<400ms). It issues NO AT commands and — the
  // part that actually bites — never calls `scenario_install_schedule`, which is
  // reached from exactly one place in the whole tree:
  // `qmanager_profile_apply:1112`. So editing the ACTIVE profile's schedule from
  // 18:00 to 20:00 left the record saying 20:00 while the armed systemd timer
  // still fired at 18:00, and any APN/TTL/IMEI edit never reached the modem at
  // all. Saving an active profile therefore re-runs the apply pipeline, which is
  // the only thing that brings BOTH the modem and the timer in line.
  //
  // It is cheap: three of the four apply steps are self-comparing, and the APN
  // step compares against `AT+CGCONTRDP` (the NEGOTIATED view) and marks itself
  // `skipped` WITHOUT detaching when it already matches. A rename-only save
  // therefore re-applies in ~3s with no WAN drop; only a genuine APN change pays
  // the attach cycle. `apply.sh` has no "already active" rejection — its only
  // block is the `apply_in_progress` PID lock, which `useProfileApply` already
  // handles by following along.
  //
  // THE RISK, STATED PLAINLY: `qmanager_profile_apply:1113-1117` calls
  // `clear_active_profile` + `scenario_teardown_schedule` +
  // `scenario_reset_to_default` when a run's terminal status is `failed` (ALL
  // steps failed). So a totally-failed auto-reapply DEACTIVATES the profile the
  // user just edited. That is pre-existing behavior on the Activate and Reapply
  // buttons — this adds a trigger, not a new failure mode — and the UI's job is
  // to report it truthfully: the dialog shows the `failed` verdict with its
  // destructive banner, and `handleApplyProgressClose` refreshes the list so the
  // hero swaps to `NoActiveProfile` instead of continuing to claim the profile
  // is in force. Nothing anywhere calls this outcome a success.
  //
  // ORDERING. The wizard's `onSave` contract (`profile-form-dialog.tsx:59`) is
  // preserved exactly: a non-null id means SAVED, and the form dialog closes on
  // it. The apply is not awaited inside `onSave` — it is latched here and fired
  // by `handleFormOpenChange` once the wizard has actually closed, so the two
  // modals never overlap.
  const [pendingReapplyId, setPendingReapplyId] = useState<string | null>(null);

  const handleSave = useCallback(
    async (data: ProfileFormData): Promise<string | null> => {
      if (!editingProfile) return await createProfile(data);

      const editedId = editingProfile.id;
      const wasActive = editedId === activeProfileId;

      const success = await updateProfile(editedId, data);
      if (!success) return null;

      setEditingProfile(null);
      // Bug 1's fix, at the site that most needed it: the id did not change, so
      // nothing else in the detail effect's dep array moved.
      invalidateActiveProfile();
      if (wasActive) setPendingReapplyId(editedId);
      return editedId;
    },
    [
      editingProfile,
      activeProfileId,
      createProfile,
      updateProfile,
      invalidateActiveProfile,
    ],
  );

  const handleDelete = useCallback(
    async (id: string): Promise<boolean> => {
      const success = await deleteProfile(id);
      if (success && editingProfile?.id === id) {
        setEditingProfile(null);
        setFormOpen(false);
      }
      return success;
    },
    [deleteProfile, editingProfile],
  );

  // ---------------------------------------------------------------------------
  // Activate / deactivate / reapply
  // ---------------------------------------------------------------------------
  const [activateTarget, setActivateTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [showApplyProgress, setShowApplyProgress] = useState(false);
  const [showDeactivateDialog, setShowDeactivateDialog] = useState(false);
  const [deactivatePhase, setDeactivatePhase] =
    useState<DeactivatePhase>("confirm");
  // Both non-confirm phases hold the modem: `working` is the request itself,
  // `verifying` is the reconcile poll that follows a lost response. Every
  // action on the page stays dead through both.
  const isDeactivating = showDeactivateDialog && deactivatePhase !== "confirm";

  // ---------------------------------------------------------------------------
  // ADOPTING AN APPLY NOBODY ON THIS PAGE STARTED
  // ---------------------------------------------------------------------------
  // `useProfileApply` already picks up an in-flight run on mount
  // (`use-profile-apply.ts:160-185` — `checkExisting`, correct, keep it): a
  // second browser tab, a boot-time apply, or this user navigating away and
  // back inside the 8-12s window all leave `applyState.status === "applying"`
  // with no dialog behind it, because the only three things that set
  // `showApplyProgress` are direct user actions.
  //
  // That is not merely a missing spinner. `handleApplyProgressClose` is the ONLY
  // caller of `refresh()` + `invalidateActiveProfile()` on this path, and a
  // dialog that never opened never closes. So an adopted run that ends `failed`
  // — the `clear_active_profile` path documented under Auto-reapply above —
  // DEACTIVATES the profile on the device while this page goes on rendering it
  // as in force, indefinitely: `useActiveProfile`'s 30s poll is disabled under
  // `SimProfilesProvider` and nothing else re-reads it.
  //
  // THE RE-OPEN GUARD. `handleApplyProgressClose` deliberately leaves
  // `applyState` in memory after closing (the row shows "Applied at HH:MM"), so
  // an effect keyed on `applyState` alone would re-open the dialog on the very
  // next render and every render after — the user could never dismiss it. Two
  // things prevent that here, and both are needed:
  //
  //   1. It only fires on `status === "applying"`. Every state the user can
  //      close on is terminal, so the close itself can never be undone by this.
  //   2. A ref remembers WHICH RUN has been adopted, keyed on
  //      `profile_id:started_at` — the backend's own run identity, unequal
  //      across runs by construction. So it is one-shot per run even if a run
  //      somehow re-enters `applying` after a dismissal, and it cannot fight the
  //      three user-action set-sites: for those the dialog is already open and
  //      marking the run adopted is a no-op.
  //
  // It only ever sets `true`; closing stays entirely the close handler's job.
  const adoptedApplyRunRef = useRef<string | null>(null);
  useEffect(() => {
    if (applyState?.status !== "applying") return;
    const runKey = `${applyState.profile_id}:${applyState.started_at}`;
    if (adoptedApplyRunRef.current === runKey) return;
    adoptedApplyRunRef.current = runKey;
    setShowApplyProgress(true);
  }, [applyState]);

  const handleActivateRequest = useCallback(
    (id: string) => {
      const profile = profiles.find((p) => p.id === id);
      if (profile) setActivateTarget({ id: profile.id, name: profile.name });
    },
    [profiles],
  );

  const handleActivateConfirm = useCallback(async () => {
    if (!activateTarget) return;
    setActivateTarget(null);
    setShowApplyProgress(true);
    await applyProfile(activateTarget.id);
  }, [activateTarget, applyProfile]);

  const handleApplyProgressClose = useCallback(() => {
    setShowApplyProgress(false);
    // Intentionally NOT calling resetApply() — leaving applyState in memory so
    // the row can show "Applied at HH:MM" until the next activation.
    //
    // BOTH refreshes are load-bearing, and they answer different questions.
    // `refresh()` re-reads the LIST, which is the only thing that can tell us
    // the worker cleared the active marker on a `failed` run — without it the
    // hero would keep claiming a deactivated profile is in force. The nonce
    // re-reads the active profile's FULL record, which `list.sh` omits and which
    // a completed apply may have changed (the reboot flag, a rewritten IMEI).
    refresh();
    invalidateActiveProfile();
  }, [refresh, invalidateActiveProfile]);

  /**
   * Re-run the apply pipeline.
   *
   * This is a FULL four-step re-run, and it is the only shape the backend
   * offers: `apply.sh` wipes the state file and the worker's finalize block
   * computes its terminal status from per-run counters, so a scoped single-step
   * run would report "step 1 of 4, three queued" and — on failure — would call
   * `clear_active_profile` + `scenario_teardown_schedule`, deactivating a
   * healthy profile and destroying its schedule timer.
   *
   * It costs almost nothing to re-run everything: three of the four steps are
   * self-comparing and skip on match, so a retry after a failed IMEI write does
   * one `AT+CGDCONT?` read, one iptables read, one redundant `QNWPREFCFG` write,
   * and then the step that actually failed. Hence the UI says "Reapply profile"
   * rather than the mock's "Retry IMEI" — the label describes what happens.
   */
  const handleReapply = useCallback(
    async (id: string) => {
      setShowApplyProgress(true);
      await applyProfile(id);
    },
    [applyProfile],
  );

  /**
   * The hero's own Reapply, bound to whatever is currently in force.
   *
   * It routes through `handleReapply` and NOT through `handleRetry`, which is
   * the near-identical-looking callback directly below. The difference is the
   * one that matters: `handleReapply` sets `showApplyProgress(true)` before it
   * fires, `handleRetry` does not — it is the apply DIALOG's own retry, called
   * from inside a dialog that is already open. Wiring the hero to `handleRetry`
   * would send four AT-writing steps at the modem with no ledger, no progress
   * and no verdict on screen, which is the exact silent-mutation shape the
   * State-Honesty Rule forbids.
   */
  const handleReapplyActive = useCallback(() => {
    if (!activeProfile) return;
    void handleReapply(activeProfile.id);
  }, [activeProfile, handleReapply]);

  const handleRetry = useCallback(async () => {
    if (!applyState?.profile_id) return;
    await applyProfile(applyState.profile_id);
  }, [applyState, applyProfile]);

  /**
   * The wizard's open/close.
   *
   * This used to also be the launch point for auto-reapply: it read
   * `pendingReapplyId` directly and fired `applyProfile` inline. That read a
   * STALE closure. `handleSave` calls `setPendingReapplyId(editedId)` and
   * `ProfileFormDialog.handleSave` calls this handler (as `onOpenChange(false)`)
   * in the very same synchronous continuation, before React has re-rendered —
   * so `handleFormOpenChange`'s closure still had `pendingReapplyId` from the
   * PREVIOUS render (null) and its `if (!pendingReapplyId) return;` guard
   * exited without ever calling `applyProfile`. The apply only ever fired once
   * something ELSE later happened to re-invoke this same stale-free callback
   * (a second `onOpenChange` from Radix, a re-render racing the close
   * animation) — which is exactly the several-second, inconsistent gap this
   * page was showing instead of an instant dialog.
   *
   * The fix is to stop relying on a closure racing a state update at all:
   * this handler only ever WRITES `formOpen`, and the effect below reads the
   * COMMITTED value of both `formOpen` and `pendingReapplyId` once React has
   * actually applied them — no ordering assumption, no race.
   */
  const handleFormOpenChange = useCallback((open: boolean) => {
    setFormOpen(open);
    if (!open) setEditingProfile(null);
  }, []);

  // Fires the moment BOTH the wizard has actually closed and a save latched a
  // reapply — i.e. as soon as React commits those two facts, not on whatever
  // stale snapshot `handleFormOpenChange` happened to close over. This is what
  // makes the apply dialog appear instantly instead of several seconds late.
  useEffect(() => {
    if (formOpen || !pendingReapplyId) return;
    // Cleared before firing so a cancelled-then-reopened wizard can never
    // replay someone else's apply.
    const id = pendingReapplyId;
    setPendingReapplyId(null);
    setShowApplyProgress(true);
    void applyProfile(id);
  }, [formOpen, pendingReapplyId, applyProfile]);

  const handleDeactivateRequest = useCallback(() => {
    setDeactivatePhase("confirm");
    setShowDeactivateDialog(true);
  }, []);

  const handleDeactivateOpenChange = useCallback((open: boolean) => {
    if (!open) setShowDeactivateDialog(false);
  }, []);

  /**
   * Deactivate, from click to terminal toast.
   *
   * The dialog STAYS OPEN for the whole request — that is the entire point of
   * replacing the old `AlertDialogAction`, which closed synchronously on click
   * and left the 8-12s attach cycle running behind a dismissed dialog with no
   * feedback whatsoever. There is no status endpoint to poll here; it is one
   * blocking HTTP request, so the dialog reports "in flight" and this function
   * owns the verdict.
   *
   * THE FIVE BACKEND CODES GET FOUR DIFFERENT READINGS, because they describe
   * four different modem states (see `DeactivateResult` in `use-sim-profiles.ts`
   * for the rc-to-code mapping):
   *
   *   apn_busy            nothing was touched — the APN lock was held and not a
   *                       single AT command went out. Retryable, and it must not
   *                       look alarming, or the user will hesitate to retry the
   *                       one action that is guaranteed safe.
   *   cops_attach_failed  TWO different outcomes behind one code, told apart by
   *     + "DEREGISTERED"  the detail string. rc=3 means `AT+COPS=0` failed all
   *                       three retries and the modem may be off the network —
   *                       the ONLY case here that earns a destructive tone.
   *     + anything else   rc=5 means it re-attached but `AT+CGCONTRDP` never
   *                       confirmed. Attached, unconfirmed: ambiguous, so
   *                       warning. Any future rc under this code defaults here
   *                       too, which is the safer of the two mistakes.
   *   everything else     `cgdcont_failed` / `cops_detach_failed` /
   *                       `apn_revert_failed` / `network_error`. The modem is
   *                       untouched and still registered — a plain failure.
   *
   * On EVERY failure the profile is still active: `deactivate.sh:91-102` exits 0
   * before `clear_active_profile`, and the hook returns before `fetchProfiles()`
   * to preserve that. So the hero correctly keeps showing the profile, and none
   * of the copy below implies otherwise.
   */
  const handleDeactivateConfirm = useCallback(async () => {
    const name = activeProfile?.name ?? "";
    setDeactivatePhase("working");

    const result = await deactivateProfile({
      // The response was lost in the modem's own LAN link drop and the hook is
      // now reading the device back. Name that, rather than leaving the
      // spinner on a request that has, from the browser's side, already died.
      onReconcile: () => setDeactivatePhase("verifying"),
    });

    setShowDeactivateDialog(false);
    setDeactivatePhase("confirm");

    if (result.ok) {
      // No nonce bump needed: a successful deactivate cleared the marker, so
      // `activeProfileId` genuinely changed and the detail effect re-runs on
      // its own.
      toast.success(
        t("custom_profiles.deactivate_dialog.toast.success", { name }),
      );
      return;
    }

    const detail = result.detail ?? "";

    if (result.error === "apn_busy") {
      toast.warning(t("custom_profiles.deactivate_dialog.toast.busy_title"), {
        description: t("custom_profiles.deactivate_dialog.toast.busy_body"),
      });
      return;
    }

    // The response never arrived AND the marker was still set when the hook
    // stopped asking. Genuinely unknown — a failed APN revert and an
    // unreachable device look identical from here — so the copy asks the user
    // to look rather than asserting either one. `warning`, per the same split
    // the rc=3/rc=5 branch below makes: ambiguity is warning, confirmed
    // failure is destructive.
    if (result.error === "link_lost") {
      toast.warning(
        t("custom_profiles.deactivate_dialog.toast.link_lost_title"),
        {
          description: t(
            "custom_profiles.deactivate_dialog.toast.link_lost_body",
          ),
        },
      );
      return;
    }

    if (result.error === "cops_attach_failed") {
      if (detail.includes("may be DEREGISTERED")) {
        toast.error(
          t("custom_profiles.deactivate_dialog.toast.deregistered_title"),
          {
            description: t(
              "custom_profiles.deactivate_dialog.toast.deregistered_body",
            ),
          },
        );
      } else {
        toast.warning(
          t("custom_profiles.deactivate_dialog.toast.unconfirmed_title"),
          {
            description: t(
              "custom_profiles.deactivate_dialog.toast.unconfirmed_body",
            ),
          },
        );
      }
      return;
    }

    toast.error(t("custom_profiles.deactivate_dialog.toast.failed_title"), {
      // The backend's own `detail` verbatim when there is one — it names the AT
      // command that failed, which is the only actionable thing we have.
      description:
        detail || t("custom_profiles.deactivate_dialog.toast.failed_body"),
    });
  }, [activeProfile, deactivateProfile, t]);

  const handleLoadCurrentSettings = useCallback(() => {
    refreshCurrentSettings();
  }, [refreshCurrentSettings]);

  // The schedule lives inside the wizard's Scenario step, so "edit the
  // schedule" is "open this profile in the wizard" — landed on that step
  // directly, since the whole point of clicking here is the schedule, not
  // the profile's identity fields three steps earlier.
  const handleEditSchedule = useCallback(() => {
    if (activeProfile) {
      setEditingProfile(activeProfile);
      setFormInitialTab("scenario");
      setFormOpen(true);
    }
  }, [activeProfile]);

  // ---------------------------------------------------------------------------
  // "Activate a profile" — the hero-empty state's jump to the saved list
  // ---------------------------------------------------------------------------
  // With a populated roster, "nothing is in force" is not a create prompt: the
  // thing to do is activate one of the profiles that already exist, and they are
  // in the card directly below. The button therefore MOVES the user to that card
  // rather than doing anything on its own — activation itself keeps its single
  // home, the row's own Activate + its confirm dialog, so there is exactly one
  // path to a modem mutation and one place that explains it.
  //
  // Focus moves with the scroll, and that is the half that is easy to skip. A
  // pure scroll leaves a keyboard user's focus back on a button that has just
  // scrolled off screen, so their next Tab lands somewhere they cannot see —
  // the jump would be sighted-only. `preventScroll: true` because the
  // `scrollIntoView` above already positioned the card; letting focus scroll
  // too would double-jump past the `scroll-mt` offset.
  const savedProfilesRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const handleJumpToSavedProfiles = useCallback(() => {
    const el = savedProfilesRef.current;
    if (!el) return;
    el.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "start",
    });
    el.focus({ preventScroll: true });
  }, [reduceMotion]);

  // Anything that has the modem mid-mutation. Both hero actions go dead while
  // it holds: Edit as well as Deactivate, because saving an active profile now
  // auto-reapplies and is therefore a modem mutation too.
  const heroBusy =
    isDeactivating || showApplyProgress || applyState?.status === "applying";

  return (
    <motion.div
      className="@container/main mx-auto flex flex-col gap-5 p-2"
      aria-live="polite"
      aria-atomic="false"
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
    >
      {/* Cascade children must be block boxes — a bare span silently drops the
          10px rise. */}
      <motion.div variants={staggerItem}>
        {/* The shared `/cellular/` header rather than a local `<h1>`: it owns
            the Display step's `tracking-[-0.02em]`, which the hand-written
            heading this replaced carried only because `PAGE_TITLE` happened to
            include it. Toolbars wrap rather than overflow — field ergonomics. */}
        <CellularPageHeader
          title={t("custom_profiles.page.title")}
          description={t("custom_profiles.page.description")}
          actions={
            <>
              <Button
                variant="tonal"
                className={PILL_ACTION}
                onClick={() => setScenarioCreateSignal((n) => n + 1)}
              >
                <MaterialSymbol name="auto_awesome" size={18} aria-hidden />
                {t("custom_profiles.page.new_scenario")}
              </Button>
              <Button className={PILL_ACTION} onClick={handleNewProfile}>
                <MaterialSymbol name="add" size={18} aria-hidden />
                {t("custom_profiles.page.new_profile")}
              </Button>
            </>
          }
        />
      </motion.div>

      {/* --- What is in force right now ------------------------------------ */}
      {/* The skeleton stays OUTSIDE the AnimatePresence on purpose. The page
          already runs a stagger cascade on mount, and putting the skeleton in
          the presence would cross-fade skeleton -> hero on top of it — the same
          content animating twice. `initial={false}` then means whichever state
          mounts first when the skeleton clears simply appears, and only a later
          SWAP between the two animates. */}
      <motion.div variants={staggerItem}>
        {showHeroSkeleton ? (
          <ActiveProfileHeroSkeleton />
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            {activeProfile ? (
              <motion.div key="hero-active" {...HERO_SWAP}>
                <ActiveProfileHero
                  profile={activeProfile}
                  activeScenario={activeScenario}
                  applyState={applyState}
                  currentIccid={currentIccid}
                  busy={heroBusy}
                  onEdit={handleEditActive}
                  onDeactivate={handleDeactivateRequest}
                  onReapply={handleReapplyActive}
                />
              </motion.div>
            ) : heroDetailFailed ? (
              <motion.div key="hero-error" {...HERO_SWAP}>
                <ActiveProfileUnavailable
                  detail={error}
                  onRetry={invalidateActiveProfile}
                />
              </motion.div>
            ) : (
              <motion.div key="hero-empty" {...HERO_SWAP}>
                {/* One key, two situations — see the branch inside. The roster
                    is read from `profiles`, the SUMMARY list, which is the only
                    thing here that knows whether there is anything to activate;
                    `activeProfileId` being null says nothing about it. */}
                <NoActiveProfile
                  hasSavedProfiles={profiles.length > 0}
                  onCreate={handleNewProfile}
                  onActivateExisting={handleJumpToSavedProfiles}
                />
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </motion.div>

      {/* --- The shape of today --------------------------------------------- */}
      {/* A PEER card under the anchor, not a second hero. It renders only when
          a profile is in force: an unscheduled profile still has a true strip
          to draw (one scenario, all day), but a page with nothing active has no
          schedule to be the shape of, and the hero's empty state has already
          said so in words. */}
      {showHeroSkeleton ? (
        <motion.div variants={staggerItem}>
          <ScheduleTodayCardSkeleton />
        </motion.div>
      ) : activeProfile ? (
        <motion.div variants={staggerItem}>
          <ScheduleTodayCard
            profile={activeProfile}
            scenarios={scenarios}
            now={now}
            onEditSchedule={handleEditSchedule}
          />
        </motion.div>
      ) : null}

      {/* --- Saved profiles beside connection scenarios --------------------- */}
      <motion.div variants={staggerItem}>
        <div className="grid grid-flow-row grid-cols-1 items-start gap-4 @4xl/main:grid-cols-[1.15fr_1fr]">
          {/* The scroll/focus target of the hero-empty state's "Activate a
              profile". A wrapper rather than an id on the card because the page
              owns the jump and the card is not ours to annotate — and because
              the focus stop has to be a box that is not itself interactive.
              `SAVED_PROFILES_ANCHOR` carries the `h-full` that keeps the card
              stretching now that it is no longer the direct grid item. */}
          <div
            ref={savedProfilesRef}
            tabIndex={-1}
            className={SAVED_PROFILES_ANCHOR}
          >
            <CustomProfileViewComponent
              profiles={profiles}
              activeProfileId={activeProfileId}
              isLoading={isLoading}
              error={error}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onActivate={handleActivateRequest}
              onDeactivate={handleDeactivateRequest}
              onRefresh={refresh}
              currentIccid={currentIccid}
              lastApplyState={applyState}
              scenarios={scenarios}
              onReapply={handleReapply}
              now={now}
              // Recommended for your SIM — rendered as rows INSIDE the saved list,
              // not as a separate card. They stay a sibling prop rather than being
              // merged into `profiles`, which is what keeps the count badge, the
              // detail prefetch, and the activate/delete wiring honest.
              suggestions={suggestions}
              creatingSuggestionId={creatingId}
              suggestionError={suggestionsError ?? error}
              onCreateSuggestion={handleCreateFromSuggestion}
              // The card's own empty state needs the same create action the page
              // header carries. It is the SAME handler, so the wizard opens on
              // `identity` from all three entry points and no second create path
              // can drift away from this one.
              onNewProfile={handleNewProfile}
              // The same "modem is mid-mutation" signal the hero's actions take.
              // Until the adoption effect above existed this was unreachable —
              // both progress dialogs are modal and non-dismissable while a
              // mutation runs, so the list was never clickable during one. An
              // ADOPTED apply has no dialog until it opens, and the list's own
              // `busy` is scoped to the profile being applied, so every OTHER
              // row's Activate stayed live. The two fixes are one fix.
              pageBusy={heroBusy}
              holdSkeleton={!pageReady}
              onLocalReadyChange={handleProfilesLocalReadyChange}
            />
          </div>
          <ConnectionScenariosCard
            autoOpenAddDialog={arrivedFromScenarioLink}
            openAddSignal={scenarioCreateSignal}
            nextFireByScenarioId={nextFireByScenarioId}
            radioOwnedByProfile={radioOwnedByProfile}
            holdSkeleton={!pageReady}
            onLocalReadyChange={handleScenariosLocalReadyChange}
          />
        </div>
      </motion.div>

      {/* --- Dialogs -------------------------------------------------------- */}
      <ProfileFormDialog
        open={formOpen}
        onOpenChange={handleFormOpenChange}
        editingProfile={editingProfile}
        currentSettings={currentSettings}
        onLoadCurrentSettings={handleLoadCurrentSettings}
        onSave={handleSave}
        initialTab={formInitialTab}
        // Saving the ACTIVE profile queues an auto-reapply (see "Auto-reapply
        // on save" above) that opens `ApplyProgressDialog` the instant this
        // wizard closes. That dialog is the honest verdict for THIS save — a
        // save toast firing first claimed success seconds before the modem
        // was actually reconciled. Suppress it here; the reapply's own ledger
        // reports the outcome once, same as the rest of this page's actions.
        willAutoReapply={editingProfile?.id === activeProfileId}
      />

      <AlertDialog
        open={!!activateTarget}
        onOpenChange={(open) => !open && setActivateTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("custom_profiles.activate_dialog.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("custom_profiles.activate_dialog.description", {
                name: activateTarget?.name ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="tonal" className={CANCEL_ACTION}>
              {tc("actions.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleActivateConfirm}
              className={CONFIRM_ACTION}
            >
              {t("custom_profiles.activate_dialog.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Not an AlertDialog: `AlertDialogAction` closes synchronously on click,
          so the pending state rendered into an unmounted dialog and the user
          watched nothing at all for the 8-12s the backend actually takes. */}
      <DeactivateProgressDialog
        open={showDeactivateDialog}
        phase={deactivatePhase}
        profileName={activeProfile?.name}
        onConfirm={handleDeactivateConfirm}
        onOpenChange={handleDeactivateOpenChange}
      />

      <ApplyProgressDialog
        open={showApplyProgress}
        onClose={handleApplyProgressClose}
        applyState={applyState}
        error={applyError}
        onRetry={handleRetry}
      />
    </motion.div>
  );
};

/**
 * The hero's empty counterpart: no profile is active.
 *
 * This is a STATE SCREEN, not a blank slot — it says what the modem is doing
 * instead (stock APN, default scenario), because "nothing is active" is a fact
 * about the device, not an absence of data. Neutral tone: no profile active is
 * a resting state, not a fault, so it takes no functional role.
 *
 * TWO SITUATIONS, ONE SLOT — and they want opposite verbs. This component
 * renders whenever `activeProfileId` is null, which says nothing whatever about
 * whether anything is SAVED, so it covers both:
 *
 *   roster populated  the common arrival, straight out of a deactivate. The
 *                     thing to do is put one of the existing profiles back in
 *                     force, so the action jumps to the list that holds them.
 *                     It also stops the page rendering "New profile" TWICE — the
 *                     header's primary already spends that exact key three
 *                     inches above, and two identical primaries on one screen
 *                     make the second one read as a mistake rather than a
 *                     choice.
 *   roster empty      "Activate a profile" would be a lie: there is nothing to
 *                     activate. Create is the only honest route out.
 *
 * `role="status"` rather than the sibling error card's `role="alert"`. Both live
 * inside the page root's `aria-live="polite"` region, but the roles are not
 * interchangeable: `alert` is assertive and interrupts whatever the screen
 * reader is saying, which is right for "a profile is in force and we cannot read
 * it" and wrong for a resting state the user themselves just caused by pressing
 * Deactivate. Severity picks the role; the empty state is not an error and must
 * not announce like one. Having NO role at all — which is what shipped — meant
 * the swap out of the loaded hero went unannounced entirely.
 */
function NoActiveProfile({
  hasSavedProfiles,
  onCreate,
  onActivateExisting,
}: {
  /** Does the roster hold anything at all? Decides the verb — see above. */
  hasSavedProfiles: boolean;
  /** Open the wizard on a blank profile. */
  onCreate: () => void;
  /** Scroll + focus the Saved Profiles card. Never mutates the modem. */
  onActivateExisting: () => void;
}) {
  const { t } = useTranslation("cellular");
  return (
    <div role="status" className={cn(HERO_CARD, HERO_STATE.SHELL)}>
      {/* The same disc the loaded hero wears, on the `empty` step of its own
          tone map. BOTH halves are imported now — `HERO_DISC` for the geometry
          and `HERO_DISC_TONE` for the fill. The previous version imported only
          the fill and hand-wrote `size-14`, so the disc grew 4px and the glyph
          3px across a cross-fade that is meant to be a swap in place. */}
      <span className={cn(HERO_DISC, HERO_DISC_TONE.empty)}>
        <MaterialSymbol
          name="sim_card_alert"
          size={HERO_STATE.GLYPH_SIZE}
          filled
          aria-hidden
        />
      </span>
      <span className={HERO_STATE.TITLE}>
        {t("custom_profiles.hero_empty.title")}
      </span>
      <span className={HERO_STATE.BODY}>
        {hasSavedProfiles
          ? t("custom_profiles.hero_empty.description_saved")
          : t("custom_profiles.hero_empty.description")}
      </span>
      {/* A default-variant primary action either way: this is the one thing to
          DO from an empty anchor, and an empty state whose only affordance is a
          sentence leaves the user hunting the toolbar for it.

          The activate branch MOVES rather than acts. Activation is a modem
          mutation that costs an attach cycle and it already has exactly one
          home — the row's Activate plus its confirm dialog. Firing it from here
          would need a profile to pick, and picking one for the user is the one
          thing an empty state must not do. */}
      {hasSavedProfiles ? (
        <Button className={PILL_ACTION} onClick={onActivateExisting}>
          <MaterialSymbol name="play_arrow" size={18} aria-hidden />
          {t("custom_profiles.hero_empty.activate_action")}
        </Button>
      ) : (
        <Button className={PILL_ACTION} onClick={onCreate}>
          <MaterialSymbol name="add" size={18} aria-hidden />
          {t("custom_profiles.page.new_profile")}
        </Button>
      )}
    </div>
  );
}

/**
 * The hero's THIRD state: a profile IS active, and we could not read it.
 *
 * WHY THIS EXISTS RATHER THAN A LATCHED SKELETON OR A REUSED `NoActiveProfile`.
 * Those are the two shapes this slot has worn before and both lie in a
 * different direction. A skeleton that never clears says "still loading" about
 * a request that finished; `NoActiveProfile` says "your modem is on the stock
 * APN and the default scenario", which is a claim about hardware nothing here
 * can support — the LIST still names an active id. This card says only what is
 * actually known: something is in force, and its record did not load.
 *
 * TONE: `warning`, not `destructive`. Nothing on the modem failed — the profile
 * is running exactly as it was a second ago; what failed is our READ of it.
 * `destructive` is this system's failure role (a deregistered modem, a failed
 * apply step) and spending it on an unreadable record trains the user to
 * discount the tone that has to mean something the next time. This is the same
 * split `handleDeactivateConfirm` already makes below between rc=3
 * (deregistered -> error) and rc=5 (attached but unconfirmed -> warning):
 * ambiguity is warning, confirmed failure is destructive.
 *
 * GLYPH: `cloud_off`, distinct from `sim_card_alert` on `NoActiveProfile` — the
 * two share this slot, `warning-container` and the neutral disc are near enough
 * in lightness to be one surface at a glance, and the glyph is the only channel
 * that separates them for a deuteranopic user.
 *
 * The retry goes through `invalidateActiveProfile` — the existing nonce channel
 * — because it is the only thing that can re-run the detail GET when the id has
 * not moved. `refresh()` would re-read the SUMMARY list, which omits the very
 * `settings` object this card is missing.
 */
function ActiveProfileUnavailable({
  detail,
  onRetry,
}: {
  /** The hook's shared error string, when the failed GET set one. */
  detail: string | null;
  onRetry: () => void;
}) {
  const { t } = useTranslation("cellular");
  return (
    <div role="alert" className={cn(HERO_CARD, HERO_STATE.SHELL)}>
      {/* Fill pair, not the container pair: the disc sits on the hero's plain
          `bg-surface` shell, which is the same reasoning `HERO_DISC` carries.
          Both the geometry AND the fill now resolve through shapes.ts — the
          fill used to be `bg-warning text-warning-foreground` hand-written
          here, which is a tone keyed onto a class string and therefore
          invisible to the compiler. `HERO_DISC_TONE.error` is the same two
          classes, reachable only through the map. */}
      <span className={cn(HERO_DISC, HERO_DISC_TONE.error)}>
        <MaterialSymbol
          name="cloud_off"
          size={HERO_STATE.GLYPH_SIZE}
          filled
          aria-hidden
        />
      </span>
      <span className={HERO_STATE.TITLE}>
        {t("custom_profiles.hero_error.title")}
      </span>
      <span className={HERO_STATE.BODY}>
        {t("custom_profiles.hero_error.description")}
      </span>
      {/* The backend's own words, verbatim and in machine voice. `break-words`
          because a `+CME ERROR:` payload has no break opportunity of its own. */}
      {detail ? (
        <span className={cn(MACHINE_VALUE, HERO_STATE.DETAIL)}>{detail}</span>
      ) : null}
      <Button variant="tonal" className={PILL_ACTION} onClick={onRetry}>
        <MaterialSymbol name="refresh" size={17} aria-hidden />
        {t("custom_profiles.hero_error.retry")}
      </Button>
    </div>
  );
}

/**
 * The merged surface, wrapped in its two shared-fetch providers.
 *
 * WHY THIS WRAPPER EXISTS. The merge put four readers of `scenarios/list.sh`
 * and two of `profiles/list.sh` on one page, each fetching for itself — six
 * requests where two would do. These providers hoist one instance of each hook
 * above the whole tree; every consumer inside reads it instead. Both providers
 * are opt-in by design, so callers elsewhere (band locking, the APN page, the
 * TTL card) are untouched and still own their own fetch.
 *
 * They must sit ABOVE both the hero and the scenarios card — that shared
 * instance is what keeps a scenario saved in the card from leaving the hero
 * displaying the old name.
 */
const CustomProfileComponent = () => (
  <SimProfilesProvider>
    <ConnectionScenariosProvider>
      <CustomProfilePageBody />
    </ConnectionScenariosProvider>
  </SimProfilesProvider>
);

export default CustomProfileComponent;
