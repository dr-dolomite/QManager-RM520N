"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { SaveButton } from "@/components/ui/save-button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ActivityIcon,
  CheckIcon,
  PowerIcon,
  RadioIcon,
  RefreshCwIcon,
  RotateCcwIcon,
} from "lucide-react";
import { TbInfoCircleFilled } from "react-icons/tb";
import { cn } from "@/lib/utils";
import { PROBE_INTERVAL_OPTIONS, type WatchdogForm } from "./use-watchdog-form";

type SettingsTab = "detection" | "recovery";

// -----------------------------------------------------------------------------
// Watchdog settings — one card, two tabs (Detection / Recovery), one atomic
// Save. Because the backend save carries every field in a single POST, the
// sticky save bar at the card foot commits the whole form, not just the visible
// tab. Each tab label carries a destructive error dot when a field on it is
// invalid; a blocked Save jumps to the first offending tab and focuses the
// field.
// -----------------------------------------------------------------------------
export function WatchdogSettingsCard({ form }: { form: WatchdogForm }) {
  const reduceMotion = useReducedMotion();
  const [tab, setTab] = useState<SettingsTab>("detection");
  const masterOff = !form.isEnabled;

  // Empty-while-required blockers the hook folds into canSave but doesn't expose
  // as named errors — recomputed here so the tab dots + jump logic see them.
  const failThresholdMissing = form.failThreshold.trim() === "";
  const probeIntervalMissing = form.probeInterval.trim() === "";
  const cooldownMissing = form.cooldown.trim() === "";
  const maxRebootsMissing =
    form.tier4Enabled && form.maxRebootsPerHour.trim() === "";

  const e = form.errors;
  const tabErrors: Record<SettingsTab, boolean> = {
    detection:
      !!e.failThreshold ||
      !!e.probeInterval ||
      !!e.cooldown ||
      failThresholdMissing ||
      probeIntervalMissing ||
      cooldownMissing,
    recovery: !!e.backupSim || !!e.maxReboots || maxRebootsMissing,
  };

  const blocked =
    form.hasValidationErrors ||
    failThresholdMissing ||
    probeIntervalMissing ||
    cooldownMissing ||
    maxRebootsMissing;

  // --- Focus-first-invalid on a blocked save --------------------------------
  const fieldRefs = useRef<Record<string, HTMLElement | null>>({});
  const registerField = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      fieldRefs.current[id] = el;
    },
    [],
  );
  const [focusReq, setFocusReq] = useState<{ id: string; n: number } | null>(
    null,
  );
  // Focus runs after the tab switch has mounted the target field. This is a DOM
  // side effect (focus/scroll), never a setState-in-effect.
  useEffect(() => {
    if (!focusReq) return;
    const raf = requestAnimationFrame(() => {
      const el = fieldRefs.current[focusReq.id];
      if (el) {
        el.focus({ preventScroll: true });
        el.scrollIntoView({
          block: "center",
          behavior: reduceMotion ? "auto" : "smooth",
        });
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [focusReq, reduceMotion]);

  const orderedErrors: { tab: SettingsTab; id: string; present: boolean }[] = [
    {
      tab: "detection",
      id: "probe-interval",
      present: !!e.probeInterval || probeIntervalMissing,
    },
    {
      tab: "detection",
      id: "fail-threshold",
      present: !!e.failThreshold || failThresholdMissing,
    },
    {
      tab: "detection",
      id: "cooldown",
      present: !!e.cooldown || cooldownMissing,
    },
    { tab: "recovery", id: "backup-sim-slot", present: !!e.backupSim },
    {
      tab: "recovery",
      id: "max-reboots",
      present: !!e.maxReboots || maxRebootsMissing,
    },
  ];

  const handleSave = () => {
    if (blocked) {
      const first = orderedErrors.find((f) => f.present);
      if (first) {
        setTab(first.tab);
        setFocusReq((prev) => ({ id: first.id, n: (prev?.n ?? 0) + 1 }));
      }
      return;
    }
    void form.submit();
  };

  // Human-readable list of the tabs that currently hold an error.
  const TAB_NAMES: Record<SettingsTab, string> = {
    detection: "Detection",
    recovery: "Recovery",
  };
  const erroredTabNames = (["detection", "recovery"] as const)
    .filter((tk) => tabErrors[tk])
    .map((tk) => TAB_NAMES[tk]);

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Watchdog Settings</CardTitle>
        <CardDescription>
          Configure connection health monitoring and recovery.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col">
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as SettingsTab)}
          className="min-h-0 flex-1"
        >
          <TabsList className="w-full">
            {(["detection", "recovery"] as const).map((tk) => (
              <TabsTrigger key={tk} value={tk} className="gap-1.5">
                {TAB_NAMES[tk]}
                {tabErrors[tk] && (
                  <span
                    aria-label="Has errors"
                    className="bg-destructive size-1.5 rounded-full"
                  />
                )}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* ================= DETECTION ================= */}
          <TabsContent
            value="detection"
            className="mt-5 animate-in fade-in-0 duration-200 motion-reduce:animate-none"
          >
            <FieldSet>
              <FieldGroup>
                <div className="grid grid-cols-1 gap-4 @sm/card:grid-cols-2">
                  {/* Probe interval — how often the modem probes the internet */}
                  <Field>
                    <FieldLabel htmlFor="probe-interval">
                      Probe Interval
                    </FieldLabel>
                    <Select
                      value={form.probeInterval}
                      onValueChange={form.setProbeInterval}
                      disabled={masterOff}
                    >
                      <SelectTrigger
                        id="probe-interval"
                        ref={registerField("probe-interval")}
                        aria-invalid={!!e.probeInterval}
                        aria-describedby={
                          e.probeInterval
                            ? "probe-interval-error"
                            : "probe-interval-desc"
                        }
                      >
                        <SelectValue placeholder="Select interval" />
                      </SelectTrigger>
                      <SelectContent>
                        {PROBE_INTERVAL_OPTIONS.map((secs) => (
                          <SelectItem key={secs} value={String(secs)}>
                            {secs === 1 ? "1 second" : `${secs} seconds`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {e.probeInterval ? (
                      <FieldError id="probe-interval-error">
                        {e.probeInterval}
                      </FieldError>
                    ) : (
                      <FieldDescription id="probe-interval-desc">
                        How often the modem probes the internet to confirm it&apos;s
                        reachable.
                      </FieldDescription>
                    )}
                  </Field>

                  {/* Failure threshold — consecutive failed probes before recovery */}
                  <Field>
                    <FieldLabel htmlFor="fail-threshold">
                      Failure Threshold
                    </FieldLabel>
                    <Input
                      ref={registerField("fail-threshold")}
                      id="fail-threshold"
                      type="number"
                      inputMode="numeric"
                      min="1"
                      max="20"
                      placeholder="5"
                      className="tabular-nums"
                      value={form.failThreshold}
                      onChange={(ev) => form.setFailThreshold(ev.target.value)}
                      disabled={masterOff}
                      aria-invalid={!!e.failThreshold}
                      aria-describedby={
                        e.failThreshold
                          ? "fail-threshold-error"
                          : "fail-threshold-desc"
                      }
                    />
                    {e.failThreshold ? (
                      <FieldError id="fail-threshold-error">
                        {e.failThreshold}
                      </FieldError>
                    ) : (
                      <FieldDescription id="fail-threshold-desc">
                        How many consecutive failed probes before recovery begins.
                      </FieldDescription>
                    )}
                  </Field>
                </div>

                {/* Cooldown */}
                <Field className="@sm/card:max-w-[18rem]">
                  <FieldLabel htmlFor="cooldown">
                    Cooldown Period (seconds)
                  </FieldLabel>
                  <Input
                    ref={registerField("cooldown")}
                    id="cooldown"
                    type="number"
                    inputMode="numeric"
                    min="10"
                    max="300"
                    placeholder="60"
                    className="tabular-nums"
                    value={form.cooldown}
                    onChange={(ev) => form.setCooldown(ev.target.value)}
                    disabled={masterOff}
                    aria-invalid={!!e.cooldown}
                    aria-describedby={
                      e.cooldown ? "cooldown-error" : "cooldown-desc"
                    }
                  />
                  {e.cooldown ? (
                    <FieldError id="cooldown-error">{e.cooldown}</FieldError>
                  ) : (
                    <FieldDescription id="cooldown-desc">
                      Wait time after each recovery step before checking
                      connectivity again.
                    </FieldDescription>
                  )}
                </Field>

                {/* Live "declares down after ~Ns" derivation. */}
                <div className="bg-muted/30 text-muted-foreground flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                  <ActivityIcon className="text-foreground/70 size-4 shrink-0" />
                  {form.estimatedDownSecs != null ? (
                    <span>
                      Declares the connection down after about{" "}
                      <span className="text-foreground font-semibold tabular-nums">
                        {form.estimatedDownSecs}s
                      </span>{" "}
                      of failed probes.
                    </span>
                  ) : (
                    <span>
                      Enter valid detection values to preview when the connection
                      is declared down.
                    </span>
                  )}
                </div>
              </FieldGroup>
            </FieldSet>
          </TabsContent>

          {/* ================= RECOVERY ================= */}
          <TabsContent
            value="recovery"
            className="mt-5 animate-in fade-in-0 duration-200 motion-reduce:animate-none"
          >
            <div className="mb-4 grid gap-1">
              <p className="text-sm font-medium">Recovery Ladder</p>
              <p className="text-muted-foreground text-xs">
                Tried in order, from gentlest to most disruptive.
              </p>
            </div>

            <ol>
              {/* Tier 1 — Network re-registration */}
              <LadderStep
                index={1}
                icon={<RefreshCwIcon className="size-4" />}
                name="Re-register to Network"
                description="Detach and reattach to the cellular network."
                atCommand="AT+COPS=2 → AT+COPS=0"
                enabled={form.tier1Enabled}
                onToggle={form.setTier1Enabled}
                masterOff={masterOff}
              />

              {/* Tier 2 — Radio toggle (skipped under tower lock) */}
              <LadderStep
                index={2}
                icon={<RadioIcon className="size-4" />}
                name="Restart Modem Radio"
                description="Power-cycle the radio (airplane mode off then on)."
                atCommand="AT+CFUN=0 → AT+CFUN=1"
                enabled={form.tier2Enabled}
                onToggle={form.setTier2Enabled}
                masterOff={masterOff}
                info="Automatically skipped when tower lock is active, to preserve your locked cells."
                infoAria="More info about the radio restart step"
              />

              {/* Tier 3 — SIM failover (backup slot lives here) */}
              <LadderStep
                index={3}
                icon={<RotateCcwIcon className="size-4" />}
                name="Switch to Backup SIM"
                description="Fail over to the backup SIM slot."
                atCommand="AT+QUIMSLOT=N"
                enabled={form.tier3Enabled}
                onToggle={form.setTier3Enabled}
                masterOff={masterOff}
              >
                {form.tier3Enabled && (
                  <Field className="@sm/card:max-w-[18rem]">
                    <FieldLabel htmlFor="backup-sim-slot">
                      Backup SIM Slot
                    </FieldLabel>
                    <Select
                      value={form.backupSimSlot}
                      onValueChange={form.setBackupSimSlot}
                      disabled={masterOff}
                    >
                      <SelectTrigger
                        id="backup-sim-slot"
                        ref={registerField("backup-sim-slot")}
                        aria-invalid={!!e.backupSim}
                        aria-describedby={
                          e.backupSim
                            ? "backup-sim-error"
                            : "backup-sim-desc backup-sim-note"
                        }
                      >
                        <SelectValue placeholder="Select slot" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">Slot 1</SelectItem>
                        <SelectItem value="2">Slot 2</SelectItem>
                      </SelectContent>
                    </Select>
                    {e.backupSim ? (
                      <FieldError id="backup-sim-error">
                        {e.backupSim}
                      </FieldError>
                    ) : (
                      <FieldDescription id="backup-sim-desc">
                        The SIM slot to switch to when the primary SIM loses
                        connectivity. Must differ from the current active slot.
                      </FieldDescription>
                    )}
                    <FieldDescription id="backup-sim-note">
                      If no backup slot is set, the ladder stops here for that
                      failure and won&apos;t continue to reboot until a slot is
                      chosen.
                    </FieldDescription>
                  </Field>
                )}
              </LadderStep>

              {/* Tier 4 — Reboot (reboot cap lives here) */}
              <LadderStep
                index={4}
                icon={<PowerIcon className="size-4" />}
                name="Reboot Device"
                description="Restart the modem as a last resort."
                atCommand="reboot"
                tone="caution"
                enabled={form.tier4Enabled}
                onToggle={form.setTier4Enabled}
                masterOff={masterOff}
                isLast
              >
                {form.tier4Enabled && (
                  <Field className="@sm/card:max-w-[18rem]">
                    <FieldLabel htmlFor="max-reboots">
                      Max Reboots Per Hour
                    </FieldLabel>
                    <Input
                      ref={registerField("max-reboots")}
                      id="max-reboots"
                      type="number"
                      inputMode="numeric"
                      min="1"
                      max="10"
                      placeholder="3"
                      className="tabular-nums"
                      value={form.maxRebootsPerHour}
                      onChange={(ev) =>
                        form.setMaxRebootsPerHour(ev.target.value)
                      }
                      disabled={masterOff}
                      aria-invalid={!!e.maxReboots}
                      aria-describedby={
                        e.maxReboots ? "max-reboots-error" : "max-reboots-desc"
                      }
                    />
                    {e.maxReboots ? (
                      <FieldError id="max-reboots-error">
                        {e.maxReboots}
                      </FieldError>
                    ) : (
                      <FieldDescription id="max-reboots-desc">
                        Safety limit. The watchdog disables itself if this many
                        reboots happen in one hour.
                      </FieldDescription>
                    )}
                  </Field>
                )}
              </LadderStep>
            </ol>
          </TabsContent>
        </Tabs>

        {/* ---- Sticky save bar — commits every pending change on the page. ---- */}
        <div className="bg-card/95 supports-[backdrop-filter]:bg-card/80 sticky bottom-0 z-10 -mx-6 -mb-6 mt-6 flex shrink-0 items-center justify-between gap-3 rounded-b-xl border-t px-6 py-4 backdrop-blur">
          <SaveStatus
            isDirty={form.isDirty}
            blocked={blocked}
            saved={form.saved}
            erroredTabNames={erroredTabNames}
          />
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={form.discard}
              disabled={!form.isDirty || form.isSaving}
            >
              Discard
            </Button>
            <SaveButton
              type="button"
              size="sm"
              isSaving={form.isSaving}
              saved={form.saved}
              disabled={!form.isDirty || form.isSaving}
              onClick={handleSave}
              label="Save"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// SaveStatus — the four-state truthful save line.
// -----------------------------------------------------------------------------
function SaveStatus({
  isDirty,
  blocked,
  saved,
  erroredTabNames,
}: {
  isDirty: boolean;
  blocked: boolean;
  saved: boolean;
  erroredTabNames: string[];
}) {
  if (isDirty && blocked) {
    return (
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          className="bg-destructive size-2 shrink-0 rounded-full"
          aria-hidden
        />
        <p className="text-destructive truncate text-xs font-medium">
          Fix errors in {erroredTabNames.join(", ")}
        </p>
      </div>
    );
  }
  if (isDirty) {
    return (
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="relative flex size-2 shrink-0" aria-hidden>
          <span className="bg-primary/50 absolute inline-flex size-full animate-ping rounded-full motion-reduce:hidden" />
          <span className="bg-primary relative inline-flex size-2 rounded-full" />
        </span>
        <p className="truncate text-xs font-medium">You have unsaved changes</p>
      </div>
    );
  }
  if (saved) {
    return (
      <div className="text-success flex min-w-0 items-center gap-1.5">
        <CheckIcon className="size-3.5 shrink-0" aria-hidden />
        <p className="truncate text-xs font-medium">Saved!</p>
      </div>
    );
  }
  return (
    <p className="text-muted-foreground truncate text-xs">All changes saved</p>
  );
}

// -----------------------------------------------------------------------------
// InfoTip — keyboard-focusable info tooltip trigger.
// -----------------------------------------------------------------------------
function InfoTip({ text, aria }: { text: string; aria: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="text-info inline-flex shrink-0"
          aria-label={aria}
        >
          <TbInfoCircleFilled className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <p>{text}</p>
      </TooltipContent>
    </Tooltip>
  );
}

// -----------------------------------------------------------------------------
// LadderStep — one rung of the recovery ladder: numbered node in a left rail
// with a connector to the next rung, lucide icon, enable switch, AT-command
// chip, and inline sub-config.
// -----------------------------------------------------------------------------
function LadderStep({
  index,
  icon,
  name,
  description,
  atCommand,
  enabled,
  onToggle,
  masterOff,
  info,
  infoAria,
  tone = "neutral",
  isLast = false,
  children,
}: {
  index: number;
  icon: React.ReactNode;
  name: string;
  description: string;
  atCommand: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  masterOff: boolean;
  info?: string;
  infoAria?: string;
  tone?: "neutral" | "caution";
  isLast?: boolean;
  children?: React.ReactNode;
}) {
  const active = enabled && !masterOff;
  const switchId = `tier${index}-enabled`;

  return (
    <li className={cn("flex gap-3", !isLast && "pb-6")}>
      {/* Left rail: numbered node + connector */}
      <div className="flex flex-col items-center">
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums transition-colors duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
            active
              ? "bg-secondary text-secondary-foreground border-transparent"
              : "bg-muted/40 text-muted-foreground border-border",
          )}
        >
          {index}
        </span>
        {!isLast && (
          <span
            aria-hidden
            className={cn(
              "mt-1.5 w-px flex-1 transition-colors duration-300",
              active ? "bg-secondary" : "bg-border",
            )}
          />
        )}
      </div>

      {/* Body */}
      <div className="min-w-0 flex-1 pb-0.5">
        <div className="flex items-start justify-between gap-3">
          <div className="grid min-w-0 gap-1">
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
                aria-hidden
              >
                {icon}
              </span>
              <span
                className={cn(
                  "truncate text-sm font-semibold",
                  !active && "text-muted-foreground",
                )}
              >
                {name}
              </span>
              {info && <InfoTip text={info} aria={infoAria ?? ""} />}
            </div>
            <p className="text-muted-foreground text-xs">{description}</p>
            <code
              className={cn(
                "mt-0.5 w-fit rounded border px-1.5 py-0.5 font-mono text-[11px] leading-tight",
                tone === "caution"
                  ? "border-warning/30 bg-warning/10 text-warning"
                  : "border-border bg-muted/40 text-muted-foreground",
              )}
            >
              {atCommand}
            </code>
          </div>

          <Switch
            id={switchId}
            checked={enabled}
            onCheckedChange={onToggle}
            disabled={masterOff}
            aria-label={name}
          />
        </div>

        {children && <div className="mt-3">{children}</div>}
      </div>
    </li>
  );
}
