"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { motion, useReducedMotion } from "motion/react";
import {
  CheckCircle2Icon,
  Loader2Icon,
  MinusCircleIcon,
  TriangleAlertIcon,
  XCircleIcon,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

import { ModeToggle } from "@/components/public/mode-toggle";
import { usePublicOverview } from "@/hooks/use-public-overview";
import { usePublicUnitPreferences } from "@/hooks/use-public-unit-preferences";
import { deriveConnectionLabel } from "@/lib/public-overview/format";
import {
  formatTemperature,
  getSignalQuality,
  RSRP_THRESHOLDS,
  RSRQ_THRESHOLDS,
  SINR_THRESHOLDS,
  signalToProgress,
  worstSignalQuality,
  type SignalQuality,
  type SignalThresholds,
} from "@/types/modem-status";
import type { ConnectionState } from "@/types/modem-status";
import type { PublicOverviewBand } from "@/types/public-overview";
import { useEffect, useRef, useState } from "react";
import { LoginDeviceName } from "../auth/login-device-name";

// Temperature warning thresholds — kept in sync with device-metrics.tsx
const TEMP_WARN = 60; // °C
const TEMP_DANGER = 75; // °C

type TempBand = "unknown" | "normal" | "warn" | "danger";

function temperatureBand(temp: number | null): TempBand {
  if (temp == null) return "unknown";
  if (temp >= TEMP_DANGER) return "danger";
  if (temp >= TEMP_WARN) return "warn";
  return "normal";
}

type Tone = "success" | "warning" | "info" | "destructive" | "muted";

function qualityVisual(
  quality: SignalQuality,
  reachable: boolean,
): {
  tone: Tone;
  Icon: LucideIcon;
} {
  if (!reachable || quality === "none")
    return { tone: "muted", Icon: MinusCircleIcon };
  if (quality === "excellent" || quality === "good")
    return { tone: "success", Icon: CheckCircle2Icon };
  if (quality === "fair") return { tone: "warning", Icon: TriangleAlertIcon };
  return { tone: "destructive", Icon: XCircleIcon };
}

// Eyebrow type style — the small uppercase label above each header / status
// cell. Centralized so the scale tunes in one place. 0.6875rem = 11px.
const EYEBROW_CLASS =
  "text-muted-foreground/80 text-[0.6875rem] font-semibold uppercase leading-none tracking-widest";

// Per-tone class strings: status cells consume `text`, signal bars consume
// `bar`. Text uses the *-on-surface variants (darker in light theme, lighter
// in dark) so functional-color values clear WCAG AA 4.5:1 against the card
// surface in both themes. The fill tokens stay tuned for 3:1 non-text.
const TONE_CLASSES: Record<Tone, { text: string; bar: string }> = {
  success: { text: "text-success-on-surface", bar: "bg-success" },
  warning: { text: "text-warning-on-surface", bar: "bg-warning" },
  info: { text: "text-info-on-surface", bar: "bg-info" },
  destructive: {
    text: "text-destructive-on-surface",
    bar: "bg-destructive",
  },
  muted: { text: "text-muted-foreground", bar: "bg-muted-foreground/40" },
};

// ---------- Signal bars ---------------------------------------------------

interface SignalBarProps {
  metric: string;
  value: number | null;
  unit: string;
  thresholds: SignalThresholds;
  reachable: boolean;
}

function SignalBar({
  metric,
  value,
  unit,
  thresholds,
  reachable,
}: SignalBarProps) {
  const reduceMotion = useReducedMotion();
  const quality: SignalQuality = reachable
    ? getSignalQuality(value, thresholds)
    : "none";
  const percent = reachable ? signalToProgress(value, thresholds) : 0;
  const { tone } = qualityVisual(quality, reachable);
  const { text: textClass, bar: barClass } = TONE_CLASSES[tone];

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-muted-foreground font-medium">{metric}</span>
        <span
          className={cn(
            "font-semibold tabular-nums transition-colors duration-200",
            textClass,
          )}
        >
          {value != null ? `${value} ${unit}` : "—"}
        </span>
      </div>
      <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
        <motion.div
          className={cn(
            "h-full origin-left rounded-full transition-colors duration-200",
            barClass,
          )}
          initial={reduceMotion ? false : { scaleX: 0 }}
          animate={{ scaleX: percent / 100 }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : { duration: 0.4, ease: [0.16, 1, 0.3, 1] }
          }
        />
      </div>
    </div>
  );
}

// ---------- Per-band rows --------------------------------------------------
//
// One dense line per aggregated carrier: band label · bandwidth pill · signal
// fill bar · signal value. The metric (RSRP or SINR) is chosen by the header
// toggle and applies to every row. RSRQ is intentionally not a per-band view
// (it still feeds the Overall verdict) so the toggle stays binary. Reuses
// SignalBar's growth motion and the shared qualityVisual / TONE_CLASSES tonal
// map so no new visual vocabulary enters the system.

type TranslateFn = (key: string, opts?: Record<string, unknown>) => string;

// Per-band readout can show RSRP or SINR; thresholds switch with the metric so
// quality tinting stays correct under either view.
type BandMetric = "rsrp" | "sinr";

const BAND_METRIC_THRESHOLDS: Record<BandMetric, SignalThresholds> = {
  rsrp: RSRP_THRESHOLDS,
  sinr: SINR_THRESHOLDS,
};

function BandRow({
  band,
  reachable,
  metric,
  t,
}: {
  band: PublicOverviewBand;
  reachable: boolean;
  metric: BandMetric;
  t: TranslateFn;
}) {
  const reduceMotion = useReducedMotion();
  const value = metric === "rsrp" ? band.rsrp : band.sinr;
  const thresholds = BAND_METRIC_THRESHOLDS[metric];
  const quality: SignalQuality = reachable
    ? getSignalQuality(value, thresholds)
    : "none";
  const percent = reachable ? signalToProgress(value, thresholds) : 0;
  const { tone } = qualityVisual(quality, reachable);
  const { text: textClass, bar: barClass } = TONE_CLASSES[tone];

  return (
    <div className="flex items-center gap-3 text-sm">
      {/* Band label — fixed, snug, left-aligned column. The fixed width is what
          keeps every RSRP/SINR bar the same length (the bar starts at a constant
          x, so fills are comparable across carriers); left alignment keeps the
          label flush at the row edge. Per-band bandwidth now lives in the header
          total, so the row is simply band -> bar -> value. */}
      <span className="text-foreground w-10 shrink-0 truncate font-semibold tabular-nums">
        {band.band}
      </span>
      {/* Signal fill bar — same growth + tonal tint as the aggregate SignalBar. */}
      <div className="bg-muted h-1.5 min-w-0 flex-1 overflow-hidden rounded-full">
        <motion.div
          className={cn(
            "h-full origin-left rounded-full transition-colors duration-200",
            barClass,
          )}
          initial={reduceMotion ? false : { scaleX: 0 }}
          animate={{ scaleX: percent / 100 }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : { duration: 0.4, ease: [0.16, 1, 0.3, 1] }
          }
        />
      </div>
      {/* Signal value — tinted by this carrier's own quality, not the aggregate. */}
      <span
        className={cn(
          "w-[4.25rem] shrink-0 text-right font-semibold tabular-nums transition-colors duration-200",
          textClass,
        )}
      >
        {value != null
          ? t(`overview.metrics.${metric}_value`, { [metric]: value })
          : t("overview.field.empty")}
      </span>
    </div>
  );
}

// ---------- Metric toggle --------------------------------------------------
//
// Small segmented control that flips the per-band readout between RSRP and
// SINR. Sits in the signal-section header where the static metric label used
// to be, so it both labels the value column and switches it. Outline + joined
// segments echo the UniFi dense-pill vocabulary. The selected segment uses the
// shared Toggle on-state (a faint primary/10 tint, the same selected treatment
// as the active sidebar item), not a solid fill, so it stays within the
// Signal-Indigo Reserve rather than reading as a second primary CTA.

function MetricToggle({
  value,
  onChange,
  t,
}: {
  value: BandMetric;
  onChange: (metric: BandMetric) => void;
  t: TranslateFn;
}) {
  return (
    <ToggleGroup
      type="single"
      size="sm"
      variant="outline"
      value={value}
      onValueChange={(next) => {
        // Radix emits "" when the active item is re-pressed; ignore it so one
        // metric is always selected.
        if (next) onChange(next as BandMetric);
      }}
      aria-label={t("overview.metrics.toggle_aria")}
      className="h-6"
    >
      {(["rsrp", "sinr"] as const).map((m) => (
        <ToggleGroupItem
          key={m}
          value={m}
          className="text-muted-foreground data-[state=on]:text-foreground h-6 px-2.5 text-[0.6875rem] font-semibold uppercase tracking-wide"
        >
          {t(`overview.metrics.${m}`)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

// ---------- Header trio (Carrier / Network / Bands) ------------------------

function HeaderCell({
  label,
  value,
  title,
}: {
  label: string;
  value: string;
  title?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col items-start gap-1.5">
      <span className={EYEBROW_CLASS}>{label}</span>
      <span
        className="text-foreground w-full truncate text-sm font-semibold leading-none tracking-tight"
        title={title ?? value}
      >
        {value}
      </span>
    </div>
  );
}

// ---------- Status trio (Overall / Internet / Temperature) -----------------
//
// Eyebrow + value, value tinted by functional-color tone. Card-less by design:
// the surrounding overview card already provides the container, so wrapping
// each cell in its own panel would create nested-card chrome. Inline icon at
// label size keeps the meaning carried by more than colour alone (WCAG 1.4.1).

function StatusCell({
  label,
  value,
  tone,
  Icon,
  iconClassName,
  spin = false,
  stale = false,
  numeric = false,
}: {
  label: string;
  value: string;
  tone?: Tone;
  Icon?: LucideIcon;
  // Lets a cell tint only its icon (e.g. the temperature warning triangle)
  // without recoloring the numeric value, so the digits stay neutral while
  // the icon carries the state. Falls through to the inherited text color.
  iconClassName?: string;
  spin?: boolean;
  stale?: boolean;
  // Temperature shows digits ("48 °C") that benefit from tabular-nums so
  // each poll's value swap doesn't jitter the baseline. Overall/Connectivity
  // are alphabetic ("Good", "Connected") and don't need the feature.
  numeric?: boolean;
}) {
  const textClass = tone ? TONE_CLASSES[tone].text : "text-foreground";
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className={EYEBROW_CLASS}>{label}</span>
      <span
        className={cn(
          "flex items-center gap-1.5 text-base font-semibold leading-none tracking-tight transition-colors duration-200",
          textClass,
          numeric && "tabular-nums",
          stale && "opacity-70",
        )}
      >
        {Icon && (
          <Icon
            aria-hidden
            className={cn(
              "size-4 shrink-0",
              spin && "motion-safe:animate-spin",
              iconClassName,
            )}
          />
        )}
        <span className="truncate">{value}</span>
      </span>
    </div>
  );
}

// ---------- Component ------------------------------------------------------

export default function OverviewCard() {
  const { t } = useTranslation("common");
  const { data, isLoading, isStale, error, refresh, consecutiveFailures } =
    usePublicOverview();
  const unitPrefs = usePublicUnitPreferences();

  // Verdict announcer: a single sr-only aria-live region that fires only when
  // a meaningful band changes (signal quality, connection state, temperature
  // band). Without this gate the 5 s poll would re-announce the entire status
  // trio on every tick.
  const [announcement, setAnnouncement] = useState("");
  const prevVerdictRef = useRef<string>("");

  // Per-band signal metric shown by the band rows (RSRP or SINR), driven by the
  // header toggle. Pre-login read-only view state; not persisted.
  const [bandMetric, setBandMetric] = useState<BandMetric>("rsrp");

  // Setup gate: bounce to /setup/ on a fresh-install device.
  useEffect(() => {
    if (data?.state === "setup_required") {
      window.location.href = "/setup/";
    }
  }, [data]);

  useEffect(() => {
    if (!data || data.state !== "ok") return;
    const reachable = data.modem_reachable;
    const connectionLabel: ConnectionState | "modem_unreachable" = reachable
      ? deriveConnectionLabel(data.network.lte_state, data.network.nr_state)
      : "modem_unreachable";
    const quality = worstSignalQuality(
      getSignalQuality(data.signal.rsrp, RSRP_THRESHOLDS),
      getSignalQuality(data.signal.rsrq, RSRQ_THRESHOLDS),
      getSignalQuality(data.signal.sinr, SINR_THRESHOLDS),
    );
    const tempBand = temperatureBand(data.temperature);
    const verdict = `${quality}|${connectionLabel}|${tempBand}`;

    // First reading: seed the ref but don't announce.
    if (prevVerdictRef.current === "") {
      prevVerdictRef.current = verdict;
      return;
    }
    if (prevVerdictRef.current === verdict) return;

    const [prevQ, prevC, prevT] = prevVerdictRef.current.split("|");
    const parts: string[] = [];
    if (prevQ !== quality) {
      parts.push(
        `${t("overview.status.overall")}: ${t(`overview.quality.${quality}`)}`,
      );
    }
    if (prevC !== connectionLabel) {
      parts.push(
        `${t("overview.status.connectivity")}: ${t(`overview.connection.${connectionLabel}`)}`,
      );
    }
    if (prevT !== tempBand) {
      parts.push(
        `${t("overview.status.temperature")}: ${formatTemperature(data.temperature, unitPrefs?.tempUnit)}`,
      );
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a11y live-region text is intentionally derived from change-over-time (verdict vs prevVerdictRef), which a render-phase value cannot express
    if (parts.length > 0) setAnnouncement(parts.join(". "));
    prevVerdictRef.current = verdict;
  }, [data, t]);

  // No card-level entrance animation: product surfaces load into a task,
  // not into a choreographed reveal. SignalBar fills still animate because
  // there the motion carries meaning (signal growing into place).
  return (
    <Card className="@container/overview w-full">
      <CardHeader className="items-center">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center">
            {/* Decorative: the adjacent CardTitle already names the product
                  for screen readers. */}
            <img
              src="/qmanager-logo.svg"
              alt=""
              aria-hidden="true"
              width={40}
              height={40}
              className="size-full"
            />
          </div>
          <div className="grid gap-0">
            <CardTitle as="h1" className="text-base">
              {t("overview.title")}
            </CardTitle>
            <CardDescription>
              <LoginDeviceName />
            </CardDescription>
          </div>
        </div>

        {/* Top-right action cluster: the theme switcher. It lives in CardAction
              so the header keeps the No-Header-Icon contract — icons appear in
              the action slot, not alongside the title. */}
        <CardAction className="flex items-center gap-1.5">
          <ModeToggle />
        </CardAction>
      </CardHeader>

      <CardContent>
        {renderBody({
          data,
          isLoading,
          isStale,
          error,
          consecutiveFailures,
          t,
          refresh,
          bandMetric,
          onBandMetricChange: setBandMetric,
          unitPrefs,
        })}
        {/* Single visually-hidden announcer for verdict transitions. Lives
              outside the polled UI surfaces so SR users hear deltas
              ("Internet: Searching") instead of the full trio every tick. */}
        <span className="sr-only" aria-live="polite" aria-atomic="true">
          {announcement}
        </span>
      </CardContent>

      <CardFooter className="flex flex-col gap-3">
        <Button asChild className="w-full">
          <Link href="/login/">{t("overview.actions.login")}</Link>
        </Button>
        <p className="text-muted-foreground text-xs">
          {t("overview.copyright", { year: new Date().getFullYear() })}
        </p>
      </CardFooter>
    </Card>
  );
}

// ---------- Body renderer --------------------------------------------------

interface BodyProps {
  data: ReturnType<typeof usePublicOverview>["data"];
  isLoading: boolean;
  isStale: boolean;
  error: string | null;
  consecutiveFailures: number;
  t: (key: string, opts?: Record<string, unknown>) => string;
  refresh: () => void;
  bandMetric: BandMetric;
  onBandMetricChange: (metric: BandMetric) => void;
  unitPrefs: ReturnType<typeof usePublicUnitPreferences>;
}

// After this many consecutive fetch failures, swap from "stale data + chip"
// to a full EmptyState so the user gets an obvious retry affordance instead
// of staring at indefinitely stale numbers.
const FAILURE_EMPTY_STATE_THRESHOLD = 3;

function renderBody({
  data,
  isLoading,
  isStale,
  error,
  consecutiveFailures,
  t,
  refresh,
  bandMetric,
  onBandMetricChange,
  unitPrefs,
}: BodyProps) {
  if (isLoading && !data) {
    return <SkeletonBody loadingLabel={t("overview.loading_status")} />;
  }
  if (data?.state === "setup_required") {
    return (
      <div
        className="text-muted-foreground flex items-center justify-center gap-2 py-8 text-sm"
        role="status"
      >
        <Loader2Icon className="size-4 motion-safe:animate-spin" aria-hidden />
        {t("overview.redirecting_setup")}
      </div>
    );
  }

  if (error && !data) {
    return (
      <EmptyState
        title={t("overview.empty.title")}
        subtitle={t("overview.empty.fetch_error")}
        retryLabel={t("overview.empty.retry")}
        onRetry={refresh}
      />
    );
  }
  // Repeated fetch failures with prior data: stop pretending the screen is
  // live and surface the recovery affordance.
  if (error && consecutiveFailures >= FAILURE_EMPTY_STATE_THRESHOLD) {
    return (
      <EmptyState
        title={t("overview.empty.title")}
        subtitle={t("overview.empty.fetch_error")}
        retryLabel={t("overview.empty.retry")}
        onRetry={refresh}
      />
    );
  }
  if (data?.state === "unavailable") {
    return (
      <EmptyState
        title={t("overview.empty.title")}
        subtitle={t("overview.empty.subtitle")}
        retryLabel={t("overview.empty.retry")}
        onRetry={refresh}
      />
    );
  }
  if (!data || data.state !== "ok") return <SkeletonBody />;

  const reachable = data.modem_reachable;
  const connectionLabel: ConnectionState | "modem_unreachable" = reachable
    ? deriveConnectionLabel(data.network.lte_state, data.network.nr_state)
    : "modem_unreachable";

  const carrier = data.network.carrier || t("overview.field.empty");
  const networkType = data.network.type || t("overview.field.empty");
  // Per-carrier band readout. The header-trio cell shows aggregate channel
  // bandwidth ("95 MHz") summed across carriers; the per-band detail lives in
  // the signal section below. The joined "B1, N41" list survives as the cell's
  // tooltip so the individual bands stay one hover away.
  const bands = data.network.bands ?? [];
  const bandList = bands
    .map((b) => b.band)
    .filter(Boolean)
    .join(", ");
  // Round to one decimal so float channel widths (e.g. 1.4 MHz LTE) don't
  // surface FP noise like "46.40000001 MHz" once summed.
  const totalBandwidth =
    Math.round(bands.reduce((sum, b) => sum + (b.bandwidth_mhz || 0), 0) * 10) /
    10;
  const bandsHeaderValue =
    totalBandwidth > 0
      ? t("overview.bands.bandwidth", { bandwidth: totalBandwidth })
      : t("overview.field.empty");

  // Overall = worst of RSRP/RSRQ/SINR. RSRP-alone would mask a strong-signal /
  // poor-SINR scene (interference-bound link).
  const quality = worstSignalQuality(
    getSignalQuality(data.signal.rsrp, RSRP_THRESHOLDS),
    getSignalQuality(data.signal.rsrq, RSRQ_THRESHOLDS),
    getSignalQuality(data.signal.sinr, SINR_THRESHOLDS),
  );
  const qualityLabel = t(`overview.quality.${quality}`);
  const connectionText = t(`overview.connection.${connectionLabel}`);
  const tempText = formatTemperature(data.temperature, unitPrefs?.tempUnit);
  // Thermal state shown visually, not just announced: warn/danger surface a
  // tinted TriangleAlertIcon beside the value so a sighted tech (often beside
  // a hot device in sunlight) sees the rise. The digits stay neutral; the icon
  // carries the state. warn -> amber, danger -> red, normal/unknown -> none.
  const tempTone: Tone | undefined =
    temperatureBand(data.temperature) === "danger"
      ? "destructive"
      : temperatureBand(data.temperature) === "warn"
        ? "warning"
        : undefined;

  return (
    <div className="flex flex-col gap-6">
      {/* Stale indicator stays as a chip above the header trio so screen
          readers (aria-live) catch the warning without re-announcing every
          poll tick from the cells themselves. */}
      {isStale && (
        <div aria-live="polite" className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className="bg-warning/15 text-warning-on-surface hover:bg-warning/20 border-warning/30"
          >
            <TriangleAlertIcon className="size-3" aria-hidden />
            {t("overview.stale_indicator")}
          </Badge>
        </div>
      )}

      {/* Header trio — Carrier · Network · Bands. Bare, left-aligned metadata
          row that shares its left edge with the signal bars and status trio
          below. The previous tonal inset competed with the status trio for
          "contained zone"; dropping the surface lets state (the verdict) be
          the visual hero, with identity playing a calm supporting role. */}
      <div
        className={cn(
          "grid grid-cols-3 gap-3 transition-opacity duration-200",
          isStale && "opacity-80",
        )}
      >
        <HeaderCell
          label={t("overview.header.carrier")}
          value={carrier}
          title={data.network.carrier}
        />
        <HeaderCell label={t("overview.header.network")} value={networkType} />
        {/* Legacy key id `header.bands` now reads "Bandwidth" — the cell shows
            aggregate channel bandwidth, with the band list kept in the tooltip.
            Key kept (not renamed to .bandwidth) so installed language packs that
            mirror this id don't lose their translation. */}
        <HeaderCell
          label={t("overview.header.bands")}
          value={bandsHeaderValue}
          title={bandList || undefined}
        />
      </div>

      {/* Signal section — per-band rows carry the per-carrier read for the
          metric chosen by the header toggle (RSRP or SINR). The aggregate
          RSRQ/SINR bars were removed to give the band rows room; RSRQ still
          feeds the Overall verdict below. Each fill is tinted by its own
          quality so a weak carrier stands out immediately. */}
      <div
        className={cn(
          "flex flex-col gap-3 transition-opacity duration-200",
          isStale && "opacity-70",
        )}
      >
        {/* Eyebrow + metric toggle. The active segment labels the value column
            and flips every band row (and the fallback bar) between RSRP/SINR. */}
        <div className="flex items-center justify-between gap-3">
          <span className={EYEBROW_CLASS}>{t("overview.bands.section")}</span>
          <MetricToggle
            value={bandMetric}
            onChange={onBandMetricChange}
            t={t}
          />
        </div>
        {bands.length > 0 ? (
          <div className="flex flex-col gap-3">
            {bands.map((b, i) => (
              <BandRow
                key={`${b.band}-${b.pci ?? "x"}-${i}`}
                band={b}
                reachable={reachable}
                metric={bandMetric}
                t={t}
              />
            ))}
          </div>
        ) : (
          // No carrier components reported (e.g. attach in progress): fall back
          // to a single aggregate bar for the selected metric so it's never
          // simply dropped.
          <SignalBar
            metric={t(`overview.metrics.${bandMetric}`)}
            value={bandMetric === "rsrp" ? data.signal.rsrp : data.signal.sinr}
            unit={bandMetric === "rsrp" ? "dBm" : "dB"}
            thresholds={BAND_METRIC_THRESHOLDS[bandMetric]}
            reachable={reachable}
          />
        )}
      </div>

      {/* Status trio — Overall · Internet · Temperature. No aria-live here —
          per-poll numeric ticks would flood screen readers. Verdict
          transitions are announced by the dedicated sr-only region in
          OverviewCard, gated on band changes only. */}
      <div className="grid grid-cols-1 gap-4 @[18rem]/overview:grid-cols-3 @[18rem]/overview:gap-3">
        <StatusCell
          label={t("overview.status.overall")}
          value={qualityLabel}
          stale={isStale}
        />
        <StatusCell
          label={t("overview.status.connectivity")}
          value={connectionText}
          stale={isStale}
        />
        <StatusCell
          label={t("overview.status.temperature")}
          value={tempText}
          Icon={tempTone ? TriangleAlertIcon : undefined}
          iconClassName={tempTone ? TONE_CLASSES[tempTone].text : undefined}
          stale={isStale}
          numeric
        />
      </div>
    </div>
  );
}

// ---------- Sub-components -------------------------------------------------

function SkeletonBody({ loadingLabel }: { loadingLabel?: string } = {}) {
  // Mirrors the rendered layout (header trio → 3 bars → status trio) so the
  // first paint → data arrival transition does not shift.
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      {loadingLabel && <span className="sr-only">{loadingLabel}</span>}
      {/* Header trio skeleton — heights mirror the rendered cell so first
          paint → data arrival doesn't shift. Eyebrow h-2.5 ≈ 11px text;
          value h-3.5 ≈ 14px text-sm. */}
      <div className="grid grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col items-start gap-1.5">
            <Skeleton className="h-2.5 w-12" />
            <Skeleton className="h-3.5 w-16" />
          </div>
        ))}
      </div>

      {/* Signal section skeleton — mirrors the live shape (eyebrow + metric
          toggle, then per-band rows) so the first paint → data arrival doesn't
          shift. Three band rows is the typical NSA/CA case; fewer real bands
          settle shorter. */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-2.5 w-12" />
          {/* Metric toggle placeholder. */}
          <Skeleton className="h-6 w-[5.5rem] rounded-md" />
        </div>
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3">
              {/* Label mirrors the live fixed-width band column so the bar
                  start lines up; no pill placeholder anymore. */}
              <Skeleton className="h-3.5 w-10" />
              <Skeleton className="h-1.5 min-w-0 flex-1 rounded-full" />
              <Skeleton className="h-3.5 w-[4.25rem]" />
            </div>
          ))}
        </div>
      </div>

      {/* Status trio skeleton — eyebrow h-2.5 ≈ 11px; value h-4 matches the
          rendered cell's effective height (16px icon + 16px text-base text). */}
      <div className="grid grid-cols-1 gap-4 @[18rem]/overview:grid-cols-3 @[18rem]/overview:gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <Skeleton className="h-2.5 w-20" />
            <Skeleton className="h-4 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyState({
  title,
  subtitle,
  retryLabel,
  onRetry,
}: {
  title: string;
  subtitle: string;
  retryLabel?: string;
  onRetry?: () => void;
}) {
  // Warning amber, not destructive: this surface appears on transient fetch
  // failure or poller "unavailable" — degraded, recoverable, not failed.
  return (
    <div className="flex flex-col items-center gap-3 py-6 text-center">
      <TriangleAlertIcon
        className="text-warning-on-surface size-8"
        aria-hidden
      />
      <div className="flex flex-col gap-1">
        <div className="text-base font-medium">{title}</div>
        <p className="text-muted-foreground text-sm">{subtitle}</p>
      </div>
      {onRetry && retryLabel && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
