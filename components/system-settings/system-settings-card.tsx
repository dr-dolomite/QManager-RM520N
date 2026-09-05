"use client";

import { useCallback, useMemo, useState } from "react";
import type * as React from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  CheckIcon,
  ChevronsUpDownIcon,
  CircleAlertIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { Skeleton } from "@/components/ui/skeleton";
import { staggerRowItem, staggerRows } from "@/lib/motion";
import { cn } from "@/lib/utils";

import type {
  SaveSettingsPayload,
  UseSystemSettingsReturn,
} from "@/hooks/use-system-settings";
import { TIMEZONES } from "@/types/system-settings";

import { ConditionBlock } from "./condition-block";
import { formatOffset } from "./derive";
import {
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  CONDITION_PANEL,
  DELTA,
  FIELD,
  FIELD_GLYPH,
  NOTICE,
  PILL_ACTION,
  ROW,
  ROW_GROUP,
  SKELETON,
  VALUE_NONE,
} from "./shapes";

// =============================================================================
// Time & Units — the writable half of /system-settings' preferences
// =============================================================================
// Three decisions in one tonal group: the zone the whole device measures time
// against, and the two units every reading is rendered in. The zone leads
// because it is the only one of the three with a consequence beyond display.
//
// The always-visible clock readout lives on the page's status band, not here.
// What this card keeps is the FAILURE case — the zone was saved but never
// reached the live clock — which is a fact about this card's own write.
// =============================================================================

const K = "preferences";

const TZ_LABEL_ID = "preferences-timezone-label";
const TEMP_LABEL_ID = "preferences-temperature-label";
const DISTANCE_LABEL_ID = "preferences-distance-label";

/** Label and its unsaved marker, paired tighter than the row's own gap. */
const LABEL_LINE = "flex items-center gap-2";

/** The timezone-apply warning, hanging under the row that caused it. */
const TZ_NOTICE = "flex flex-col items-start gap-2 rounded-field px-4 pb-4";

/** The group is this card's slack absorber; the page grid locks the cell. */
const GROUP_FILL = "min-h-0 flex-1";

// -----------------------------------------------------------------------------

type SystemSettingsCardProps = Pick<
  UseSystemSettingsReturn,
  "settings" | "isLoading" | "isSaving" | "error" | "saveSettings" | "refresh"
>;

export default function SystemSettingsCard({
  settings,
  isLoading,
  isSaving,
  error,
  saveSettings,
  refresh,
}: SystemSettingsCardProps) {
  const { t } = useTranslation("system-settings");

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={CARD_PAD}>
        <CardTitle className={CARD_TITLE}>{t(`${K}.card.title`)}</CardTitle>
        <CardDescription className={CARD_DESC}>
          {t(`${K}.card.description`)}
        </CardDescription>
      </CardHeader>

      <CardContent className={cn(CARD_PAD, CONDITION_PANEL.CONTENT, "gap-4")}>
        {isLoading ? (
          <PreferencesSkeleton />
        ) : !settings ? (
          // No settings to show — a failed read, or an envelope carrying none.
          // The form would otherwise fill itself with its own fallbacks.
          <ConditionBlock
            tone="destructive"
            glyph={CircleAlertIcon}
            ariaRole="alert"
            title={t(`${K}.states.error_title`)}
            description={t(`${K}.states.error_body`, { detail: error ?? "" })}
            onRetry={() => refresh()}
            retryLabel={t("actions.retry", { ns: "common" })}
            className={CONDITION_PANEL.SCREEN}
          />
        ) : (
          <PreferencesForm
            settings={settings}
            isSaving={isSaving}
            error={error}
            saveSettings={saveSettings}
          />
        )}
      </CardContent>
    </Card>
  );
}

// ─── Loading ────────────────────────────────────────────────────────────────

/**
 * Real `ROW_GROUP` / `ROW.ROOT` boxes wearing slivers, so the skeleton's height
 * RESOLVES to the loaded row's rather than being asserted against it.
 */
function PreferencesSkeleton(): React.JSX.Element {
  return (
    <>
      <div className={cn(ROW_GROUP, GROUP_FILL)}>
        {[0, 1, 2].map((i) => (
          <div key={i} className={ROW.ROOT}>
            <div className={ROW.TEXT}>
              <Skeleton className={cn(SKELETON.TIME.LABEL, "w-28")} />
              <Skeleton className={cn(SKELETON.TIME.CONSEQUENCE, "w-full")} />
              {/* The zone row's consequence wraps to two lines at real widths. */}
              {i === 0 ? (
                <Skeleton className={cn(SKELETON.TIME.CONSEQUENCE_2, "w-2/3")} />
              ) : null}
            </div>
            <div className={cn(ROW.CONTROL, "w-full @2xl/card:w-auto")}>
              <Skeleton className={SKELETON.TIME.FIELD} />
            </div>
          </div>
        ))}
      </div>
      {/* The Save row. Absent, the card grows by its height plus the gap. */}
      <div className="flex justify-end">
        <Skeleton className={SKELETON.TIME.ACTION} />
      </div>
    </>
  );
}

// ─── Form ───────────────────────────────────────────────────────────────────

interface PreferencesFormProps {
  settings: UseSystemSettingsReturn["settings"];
  isSaving: boolean;
  error: string | null;
  saveSettings: (payload: SaveSettingsPayload) => Promise<boolean>;
}

function PreferencesForm({
  settings,
  isSaving,
  error,
  saveSettings,
}: PreferencesFormProps): React.JSX.Element {
  const { t } = useTranslation("system-settings");
  const { saved, markSaved } = useSaveFlash();

  const [prevSettings, setPrevSettings] = useState(settings);
  const [tempUnit, setTempUnit] = useState<"celsius" | "fahrenheit">(
    settings?.temp_unit ?? "celsius",
  );
  const [distanceUnit, setDistanceUnit] = useState<"km" | "miles">(
    settings?.distance_unit ?? "km",
  );
  const [zonename, setZonename] = useState(settings?.zonename ?? "UTC");
  const [timezone, setTimezone] = useState(settings?.timezone ?? "UTC0");
  const [tzOpen, setTzOpen] = useState(false);

  // Server → local during render, never in an effect: a data-derived remount
  // would kill the pending `saved` flash, since the refetch and markSaved()
  // land in one React batch. `tzOpen` is popover state, deliberately not synced.
  if (settings !== prevSettings) {
    setPrevSettings(settings);
    setTempUnit(settings?.temp_unit ?? "celsius");
    setDistanceUnit(settings?.distance_unit ?? "km");
    setZonename(settings?.zonename ?? "UTC");
    setTimezone(settings?.timezone ?? "UTC0");
  }

  const tzDirty = Boolean(
    settings &&
      (zonename !== settings.zonename || timezone !== settings.timezone),
  );
  const tempDirty = Boolean(settings && tempUnit !== settings.temp_unit);
  const distanceDirty = Boolean(
    settings && distanceUnit !== settings.distance_unit,
  );
  const canSave = (tzDirty || tempDirty || distanceDirty) && !isSaving;

  const tzLabel = useMemo(
    () => TIMEZONES.find((tz) => tz.zonename === zonename)?.label,
    [zonename],
  );

  const handleTimezoneChange = useCallback((selected: string) => {
    const entry = TIMEZONES.find((tz) => tz.zonename === selected);
    if (!entry) return;
    setZonename(entry.zonename);
    setTimezone(entry.timezone);
  }, []);

  const handleSave = useCallback(async () => {
    if (!canSave) return;

    const success = await saveSettings({
      action: "save_settings",
      temp_unit: tempUnit,
      distance_unit: distanceUnit,
      timezone,
      zonename,
    });

    if (success) {
      markSaved();
      toast.success(t(`${K}.toast.saved`));
    } else {
      toast.error(t(`${K}.toast.failed`));
    }
  }, [
    canSave,
    saveSettings,
    tempUnit,
    distanceUnit,
    timezone,
    zonename,
    markSaved,
    t,
  ]);

  const unsaved = t(`${K}.rows.unsaved`);

  return (
    <>
      {/* A failed refresh over live data says so and steps aside; it does not
          take the card down. */}
      {error ? (
        <div role="status" className={cn(NOTICE.BOX, NOTICE.STALE)}>
          <TriangleAlertIcon className={NOTICE.GLYPH} aria-hidden="true" />
          <span className={NOTICE.TEXT}>{t(`${K}.states.stale`)}</span>
        </div>
      ) : null}

      {/* No `initial`/`animate`: this container is a child of the page cascade
          and must stay on the parent's clock. */}
      <motion.div
        className={cn(ROW_GROUP, GROUP_FILL)}
        variants={staggerRows}
      >
        {/* ── Time zone ───────────────────────────────────────────────── */}
        <motion.div variants={staggerRowItem} className={ROW.ROOT}>
          <div className={ROW.TEXT}>
            <span className={LABEL_LINE}>
              <span id={TZ_LABEL_ID} className={ROW.LABEL}>
                {t(`${K}.rows.timezone.label`)}
              </span>
              <span className={cn(DELTA.ROOT, !tzDirty && DELTA.CLEAN)}>
                {unsaved}
              </span>
            </span>
            <span className={ROW.CONSEQUENCE}>
              {t(`${K}.rows.timezone.consequence`)}
            </span>
          </div>
          <div className={ROW.CONTROL}>
            <Popover open={tzOpen} onOpenChange={setTzOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  role="combobox"
                  aria-expanded={tzOpen}
                  aria-labelledby={TZ_LABEL_ID}
                  className={cn(FIELD, "flex items-center justify-between gap-2")}
                >
                  <span className="truncate">
                    {tzLabel ?? t(`${K}.rows.timezone.placeholder`)}
                  </span>
                  <ChevronsUpDownIcon
                    className={cn(FIELD_GLYPH, "flex-none opacity-60")}
                    aria-hidden="true"
                  />
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="w-(--radix-popover-trigger-width) min-w-64 rounded-field p-0"
              >
                <Command>
                  <CommandInput
                    placeholder={t(`${K}.rows.timezone.search`)}
                  />
                  <CommandList>
                    <CommandEmpty>
                      {t(`${K}.rows.timezone.empty`)}
                    </CommandEmpty>
                    <CommandGroup>
                      {TIMEZONES.map((tz) => (
                        <CommandItem
                          key={tz.zonename}
                          value={tz.label}
                          onSelect={() => {
                            handleTimezoneChange(tz.zonename);
                            setTzOpen(false);
                          }}
                        >
                          <CheckIcon
                            className={cn(
                              "mr-2 size-4",
                              zonename === tz.zonename
                                ? "opacity-100"
                                : "opacity-0",
                            )}
                            aria-hidden="true"
                          />
                          {tz.label}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
        </motion.div>

        {/* The field is tri-state: an older backend omits it, and absent means
            applied. Only an explicit `false` is a failure. */}
        {settings?.timezone_applied === false ? (
          <motion.div variants={staggerRowItem} className={TZ_NOTICE}>
            <Badge variant="warning">
              <TriangleAlertIcon className="size-3" aria-hidden="true" />
              {t(`${K}.states.tz_not_applied_chip`)}
            </Badge>
            <span className={ROW.CONSEQUENCE}>
              {t(`${K}.states.tz_not_applied_body`, {
                zone: settings.zonename,
                // `effective_offset` is optional and nothing couples it to
                // `timezone_applied`, so this branch is reachable with no
                // offset — and i18next substitutes an EMPTY string, leaving
                // "…still running at ." on screen.
                offset: formatOffset(settings.effective_offset) || VALUE_NONE,
              })}
            </span>
          </motion.div>
        ) : null}

        {/* ── Temperature ─────────────────────────────────────────────── */}
        <motion.div variants={staggerRowItem} className={ROW.ROOT}>
          <div className={ROW.TEXT}>
            <span className={LABEL_LINE}>
              <span id={TEMP_LABEL_ID} className={ROW.LABEL}>
                {t(`${K}.rows.temperature.label`)}
              </span>
              <span className={cn(DELTA.ROOT, !tempDirty && DELTA.CLEAN)}>
                {unsaved}
              </span>
            </span>
            <span className={ROW.CONSEQUENCE}>
              {t(`${K}.rows.temperature.consequence`)}
            </span>
          </div>
          <div className={ROW.CONTROL}>
            <Select
              value={tempUnit}
              onValueChange={(v) => setTempUnit(v as "celsius" | "fahrenheit")}
            >
              <SelectTrigger aria-labelledby={TEMP_LABEL_ID} className={FIELD}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="celsius">
                  {t(`${K}.rows.temperature.celsius`)}
                </SelectItem>
                <SelectItem value="fahrenheit">
                  {t(`${K}.rows.temperature.fahrenheit`)}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </motion.div>

        {/* ── Distance ────────────────────────────────────────────────── */}
        <motion.div variants={staggerRowItem} className={ROW.ROOT}>
          <div className={ROW.TEXT}>
            <span className={LABEL_LINE}>
              <span id={DISTANCE_LABEL_ID} className={ROW.LABEL}>
                {t(`${K}.rows.distance.label`)}
              </span>
              <span className={cn(DELTA.ROOT, !distanceDirty && DELTA.CLEAN)}>
                {unsaved}
              </span>
            </span>
            <span className={ROW.CONSEQUENCE}>
              {t(`${K}.rows.distance.consequence`)}
            </span>
          </div>
          <div className={ROW.CONTROL}>
            <Select
              value={distanceUnit}
              onValueChange={(v) => setDistanceUnit(v as "km" | "miles")}
            >
              <SelectTrigger
                aria-labelledby={DISTANCE_LABEL_ID}
                className={FIELD}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="km">
                  {t(`${K}.rows.distance.km`)}
                </SelectItem>
                <SelectItem value="miles">
                  {t(`${K}.rows.distance.miles`)}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </motion.div>
      </motion.div>

      <div className="flex justify-end">
        <SaveButton
          onClick={handleSave}
          isSaving={isSaving}
          saved={saved}
          label={t(`${K}.card.save`)}
          disabled={!canSave}
          className={PILL_ACTION}
        />
      </div>
    </>
  );
}
