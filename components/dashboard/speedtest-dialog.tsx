"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslation } from "react-i18next";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TonalBanner } from "@/components/ui/tonal-banner";
import {
  MaterialSymbol,
  type MaterialSymbolName,
} from "@/components/ui/material-symbol";
import {
  DUR,
  EASE_EMPHASIZED,
  staggerContainer,
  staggerItem,
  transitionEmphasized,
} from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useSpeedtest, type SpeedtestPhase } from "@/hooks/use-speedtest";
import {
  SPEEDTEST_STEPS,
  resolveStepStates,
  type SpeedtestStep,
  type SpeedtestStepState,
} from "@/lib/speedtest-phases";
import {
  bytesToMbps,
  formatBytes,
  type SpeedtestFinalResult,
} from "@/types/speedtest";

// =============================================================================
// SpeedtestDialog — the "Candy Console", in the M3 tonal system
// =============================================================================
// Eleven states in one panel, and the thing that holds them together is a
// COLOUR CONTRACT: one hue per measurement, held from the step chip to the live
// meter to the result tile.
//
//   Download → Downlink Rose (`--downlink-*`)
//   Upload   → Uplink Cyan  (`--uplink-*`)
//   Latency  → neutral, because latency has no direction
//
// A download figure is never cyan and an upload figure is never rose, in any
// state. That is what lets someone glance at a finished run and know which
// number is which without reading the labels — and it is why the active step
// chip's fill is a DIRECTION role rather than a status role (DESIGN.md >
// Identity-Chip Rule).
//
// 2026-08-16: this contract used to read `download -> primary blue`,
// `upload -> Carrier Violet`, `latency -> Uplink Cyan`, and it was wrong in a
// way that only shows up across pages. Blue is the 5G NR identity AND the brand
// AND "in progress"; violet is the 4G LTE identity. So a user learned
// blue = download here and met blue = NR two clicks later on the radio page,
// and an LTE speedtest painted its upload figure in the LTE hue for reasons
// that had nothing to do with LTE. Direction and radio are orthogonal facts and
// they now hold orthogonal hues — see DESIGN.md > The Direction-Is-Not-A-Radio
// Rule. Latency gave up cyan because cyan now means upload; a three-way readout
// does not need three hues when one of the three is directionless.
//
// FOUR DECISIONS WORTH KEEPING
// ----------------------------
//  1. THE DIALOG CAN ALWAYS BE CLOSED. The previous implementation swallowed
//     the X, Escape and outside-click while a test ran. The run is a detached
//     background process that outlives the dialog and `refreshStatus()`
//     re-attaches to it on reopen, so blocking the close protected nothing and
//     trapped the user for the ~40s a full run takes. `onOpenChange` now passes
//     straight through.
//
//  2. THE NUMBER NEVER EASES. Live Mbps/ms are JetBrains Mono + `tabular-nums`,
//     repainted on the 500ms poll tick with no tween. A tweened figure is a lie
//     about what the modem reported. This is also why `TickGroup`/`useValueTick`
//     is deliberately absent: that primitive is a 700ms dip staggered at 100ms,
//     tuned for the ~3s dashboard poll, and at 500ms it would strobe.
//
//  3. THE PROGRESS BAR IS DATA, NOT DECORATION. It transitions `width`
//     LINEARLY at the poll cadence — see `TrackBar`, which is local rather than
//     `components/ui/progress.tsx` precisely so retiming it cannot retime every
//     other consumer of the shared primitive.
//
//  4. THE STEP CHIPS SURVIVE FAILURE. The comp discards them on error; we keep
//     them, driven by `resolveStepStates(phase, failedAt)`. "Failed during
//     upload, download finished" is diagnostic; "something went wrong" is not.
//
// DISPLAY NUMERALS (44px ping / 52px live throughput / 26px result tile) are
// the one type decision here that sits off DESIGN.md's ramp, which tops out at
// the 30px Display step. They are deliberate and comp-authoritative: this is
// the product's only surface whose entire job, for ~40 seconds, is one number
// changing, and at the 30px Display step that number competes with the dialog
// title instead of dominating it. They are also the only such numerals in the
// product, so they are scoped to this file rather than proposed as new ramp
// steps — every other size here is a documented step (14/13/12px), including
// the ones the first draft took from the comp at 15px and 11px, which had no
// such justification and were pulled back onto the ramp.
//
// STEP CHIPS ARE A STEPPER, NOT STATUS BADGES — a deliberate, documented
// departure from the Filled-Chip Rule's "always use a `Badge` variant". Three
// of the four chip states would map cleanly (`success`/`destructive`/`muted`),
// but the ACTIVE state carries the measurement's identity hue and `Badge` has
// no `uplink` role, so latency could not be cyan. Splitting one three-chip row
// between `Badge` and hand-composed containers would be worse than composing
// all four consistently here. Everything the rule protects is still paid for:
// each state carries a distinct non-chromatic mark (a `check`, a filled
// breathing dot, a filled `error`, a hollow ring) AND an `sr-only` status word,
// so none of the four depends on hue.
// =============================================================================

interface SpeedtestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// -----------------------------------------------------------------------------
// The colour contract, as tokens
// -----------------------------------------------------------------------------

interface RoleTokens {
  /** Tonal container fill + its measured ink. Solid-Container Rule: never a wash. */
  container: string;
  /** The role's strong fill — dots, bar fills, glyph discs. */
  strong: string;
  /** The role's strong fill as ink. */
  ink: string;
  /** Direction glyph for the measurement. */
  glyph: MaterialSymbolName;
}

const ROLE: Record<SpeedtestStep, RoleTokens> = {
  ping: {
    container: "bg-surface-container-high text-on-surface",
    strong: "bg-on-surface-variant",
    ink: "text-on-surface-variant",
    glyph: "network_ping",
  },
  download: {
    container: "bg-downlink-container text-on-downlink-container",
    strong: "bg-downlink",
    ink: "text-downlink-on-surface",
    glyph: "arrow_downward",
  },
  upload: {
    container: "bg-uplink-container text-on-uplink-container",
    strong: "bg-uplink",
    ink: "text-uplink-on-surface",
    glyph: "arrow_upward",
  },
};

/** Label key per step. `ping` is presented as "Latency" — that is what is measured. */
const STEP_LABEL_KEY: Record<SpeedtestStep, string> = {
  ping: "speedtest.step_latency",
  download: "speedtest.step_download",
  upload: "speedtest.step_upload",
};

/** The `sr-only` word that carries each chip state without relying on colour. */
const STEP_STATUS_KEY: Record<SpeedtestStepState, string> = {
  past: "speedtest.step_status_done",
  active: "speedtest.step_status_active",
  failed: "speedtest.step_status_failed",
  future: "speedtest.step_status_pending",
};

// -----------------------------------------------------------------------------
// Formatting — machine voice
// -----------------------------------------------------------------------------

/**
 * Two decimals under 100 Mbps, one above. The width of the figure is what is
 * being controlled: at 342.18 the third significant digit is noise the user
 * cannot act on, and a 6-character number in a 52px face is already the widest
 * thing in the dialog.
 */
function mbpsText(bytesPerSec: number): string {
  const mbps = bytesToMbps(bytesPerSec);
  return mbps >= 100 ? mbps.toFixed(1) : mbps.toFixed(2);
}

// -----------------------------------------------------------------------------
// TrackBar — the progress bar, local by design
// -----------------------------------------------------------------------------
// NOT `components/ui/progress.tsx`. That primitive ships `transition-all` at
// Tailwind's 150ms default and is consumed across the product, so overriding
// its timing here would silently retime every other bar. This one exists to
// carry exactly one rule: the fill moves LINEARLY at the 500ms poll cadence, so
// its travel is the data arriving rather than an eased flourish laid over it.
// -----------------------------------------------------------------------------

function TrackBar({
  value,
  trackClassName,
  fillClassName,
}: {
  /** 0–1. */
  value: number;
  trackClassName: string;
  fillClassName: string;
}) {
  const pct = Math.max(0, Math.min(100, value * 100));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      className={cn("rounded-pill h-2 w-full overflow-hidden", trackClassName)}
    >
      <span
        className={cn(
          "rounded-pill block h-full",
          // A sanctioned exception to The One-Scale Rule (DESIGN.md > Motion):
          // this bar tracks a real throughput sample arriving on its own clock,
          // so the transition's job is to bridge one sample to the next, not to
          // express a state change. That makes `linear` correct where the
          // system's curves would read as easing the DATA, and pins the duration
          // to the sample cadence rather than to the duration scale.
          // `motion-reduce` drops it entirely — a bar that jumps is honest; a
          // bar that slides is a preference.
          "transition-[width] duration-500 ease-linear motion-reduce:transition-none",
          fillClassName,
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// -----------------------------------------------------------------------------
// StepChips — Latency · Download · Upload
// -----------------------------------------------------------------------------

function StepChips({
  phase,
  failedAt,
}: {
  phase: SpeedtestPhase;
  failedAt: SpeedtestStep | null;
}) {
  const { t } = useTranslation("dashboard");
  const states = resolveStepStates(phase, failedAt);

  return (
    <div className="flex items-center justify-center gap-2">
      {SPEEDTEST_STEPS.map((step, i) => {
        const state = states[step];
        const role = ROLE[step];
        // The connector leading INTO a chip lights in that chip's own hue once
        // the sequence has reached it, so the row reads as a track being filled
        // rather than as three unrelated pills.
        const reached = state === "past" || state === "active";

        return (
          <React.Fragment key={step}>
            {i > 0 && (
              <span
                aria-hidden="true"
                className={cn(
                  "h-px w-[22px] flex-none",
                  "transition-colors duration-[var(--duration-standard)] ease-standard",
                  reached ? role.strong : "bg-outline",
                )}
              />
            )}
            <span
              className={cn(
                "rounded-pill inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold whitespace-nowrap",
                // Container morph on the standard clock — the completing step
                // should be felt peripherally before it is read.
                "transition-colors duration-[var(--duration-standard)] ease-standard",
                state === "past" &&
                  "bg-success-container text-on-success-container",
                state === "failed" &&
                  "bg-destructive-container text-on-destructive-container",
                state === "active" && role.container,
                state === "future" && "bg-surface-container text-on-surface-variant",
              )}
            >
              <StepMark state={state} strong={role.strong} />
              {t(STEP_LABEL_KEY[step])}
              <span className="sr-only"> — {t(STEP_STATUS_KEY[state])}</span>
            </span>
          </React.Fragment>
        );
      })}
    </div>
  );
}

/**
 * The non-chromatic half of a step chip. Four states, four distinct marks — no
 * two states in this slot share a shape, because `success-container` and
 * `warning-container` measure ~1.03:1 apart and the chip row would otherwise be
 * unreadable in grayscale.
 */
function StepMark({
  state,
  strong,
}: {
  state: SpeedtestStepState;
  strong: string;
}) {
  if (state === "past") {
    return <MaterialSymbol name="check" filled size={14} className="flex-none" />;
  }
  if (state === "failed") {
    return <MaterialSymbol name="error" filled size={14} className="flex-none" />;
  }
  if (state === "active") {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "size-[7px] flex-none rounded-full",
          // Ambient, and gated on real state: this breathes only while the
          // measurement it names is actually in flight.
          "animate-pulse motion-reduce:animate-none",
          strong,
        )}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="border-outline size-[7px] flex-none rounded-full border"
    />
  );
}

// -----------------------------------------------------------------------------
// IdleBody — description, server picker, CTA
// -----------------------------------------------------------------------------

function IdleBody({
  t,
  isAvailable,
  servers,
  selectedServer,
  isLoadingServers,
  serversError,
  onSelectServer,
  onRefreshServers,
  onStart,
}: {
  t: (key: string, opts?: Record<string, unknown>) => string;
  isAvailable: boolean | null;
  servers: ReturnType<typeof useSpeedtest>["servers"];
  selectedServer: number | null;
  isLoadingServers: boolean;
  serversError: boolean;
  onSelectServer: (id: number | null) => void;
  onRefreshServers: () => void;
  onStart: () => void;
}) {
  // `isAvailable === null` is the availability check still in flight. The CTA
  // is held, but NOT with an orphan error line under it — the previous version
  // disabled the button during this window and explained nothing, which reads
  // as the feature being broken rather than as it still loading.
  const ctaHeld = isAvailable !== true;

  const selectedLabel = React.useMemo(() => {
    if (selectedServer === null) return t("speedtest.server_automatic");
    const match = servers.find((s) => s.id === selectedServer);
    if (!match) return `#${selectedServer}`;
    return t("speedtest.server_option", {
      name: match.name,
      location: match.location,
      country: match.country,
    });
  }, [selectedServer, servers, t]);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-on-surface-variant text-sm leading-[1.55]">
        {t("speedtest.dialog_idle_description")}
      </p>

      {/* A failed server list must never block the test: "Automatic" is still
          selectable and the CTA is still live, because the CLI picks the
          nearest server itself when it is given no id. */}
      {serversError ? (
        <div className="flex flex-col gap-2.5">
          <TonalBanner
            tone="warning"
            icon="cloud_off"
            title={t("speedtest.servers_error_title")}
          >
            {t("speedtest.servers_error_body")}
          </TonalBanner>
          <button
            type="button"
            onClick={onRefreshServers}
            disabled={isLoadingServers}
            className="bg-surface-container text-on-surface-variant hover:bg-surface-container-high rounded-pill inline-flex h-9 items-center gap-2 self-start px-4 text-[13px] font-semibold transition-colors duration-[var(--duration-quick)] ease-out disabled:opacity-60"
          >
            <MaterialSymbol
              name="refresh"
              size={16}
              className={cn(
                "flex-none",
                isLoadingServers && "animate-spin motion-reduce:animate-none",
              )}
            />
            {t("speedtest.servers_retry_button")}
          </button>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <div className="flex items-center">
          <span className="text-[13px] font-semibold">
            {t("speedtest.server_label")}
          </span>
          <button
            type="button"
            onClick={onRefreshServers}
            disabled={isLoadingServers}
            aria-label={t("speedtest.refresh_aria")}
            className="bg-surface-container text-on-surface-variant hover:bg-surface-container-high ml-auto grid size-[30px] place-items-center rounded-full transition-colors duration-[var(--duration-quick)] ease-out disabled:opacity-60"
          >
            <MaterialSymbol
              name="refresh"
              size={17}
              className={cn(
                isLoadingServers && "animate-spin motion-reduce:animate-none",
              )}
            />
          </button>
        </div>

        {isLoadingServers && servers.length === 0 ? (
          <Skeleton className="rounded-pill bg-surface-container h-[46px] w-full" />
        ) : (
          // A DropdownMenu rather than `Select`: the shared select trigger bakes
          // in a lucide chevron, and this component sits inside the Icon-Boundary
          // Rule's Material-Symbols scope (/dashboard). Composing the trigger by
          // hand is what keeps the pill's 46px geometry and its glyphs Material.
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t("speedtest.server_select_aria")}
                className="bg-surface-container hover:bg-surface-container-high rounded-pill flex h-[46px] w-full items-center gap-2.5 px-4 text-left transition-colors duration-[var(--duration-quick)] ease-out"
              >
                <MaterialSymbol
                  name="dns"
                  size={18}
                  className="text-on-surface-variant flex-none"
                />
                <span className="min-w-0 truncate text-[13px] font-medium">
                  {selectedLabel}
                </span>
                <MaterialSymbol
                  name="unfold_more"
                  size={18}
                  className="text-on-surface-variant ml-auto flex-none"
                />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="rounded-field max-h-64 w-(--radix-dropdown-menu-trigger-width)"
            >
              <ServerOption
                selected={selectedServer === null}
                label={t("speedtest.server_automatic")}
                onSelect={() => onSelectServer(null)}
              />
              {servers.map((s) => (
                <ServerOption
                  key={s.id}
                  selected={selectedServer === s.id}
                  label={t("speedtest.server_option", {
                    name: s.name,
                    location: s.location,
                    country: s.country,
                  })}
                  onSelect={() => onSelectServer(s.id)}
                />
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div className="flex flex-col items-center gap-2 pt-1">
        <button
          type="button"
          onClick={onStart}
          disabled={ctaHeld}
          className={cn(
            "rounded-pill inline-flex h-[46px] items-center gap-2 px-[26px] text-sm font-semibold",
            "transition-colors duration-[var(--duration-standard)] ease-standard",
            // The held state is a designed state, not a broken one — the stock
            // 50% disabled wash reads as failure on a primary CTA.
            "disabled:opacity-100",
            ctaHeld
              ? "bg-surface-container-high text-on-surface-variant"
              : "bg-primary text-primary-foreground hover:bg-primary/90",
          )}
        >
          <MaterialSymbol
            name="play_arrow"
            filled
            size={19}
            className="flex-none"
          />
          {t("speedtest.run_button")}
        </button>
        {/* A run costs real cellular data. On a metered SIM that is not a
            footnote, so it sits with the button that spends it. */}
        <p className="text-on-surface-variant text-center text-xs">
          {t("speedtest.data_cost_notice")}
        </p>
      </div>
    </div>
  );
}

function ServerOption({
  selected,
  label,
  onSelect,
}: {
  selected: boolean;
  label: string;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem
      onSelect={onSelect}
      className="rounded-field gap-2 px-3 py-2 text-[13px]"
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {selected ? (
        <MaterialSymbol
          name="check"
          size={16}
          className="text-primary flex-none"
        />
      ) : null}
    </DropdownMenuItem>
  );
}

// -----------------------------------------------------------------------------
// Running bodies
// -----------------------------------------------------------------------------

function InitializingBody({
  t,
  serverLine,
}: {
  t: (key: string) => string;
  serverLine: string | null;
}) {
  return (
    <div className="flex flex-col items-center gap-3.5 pt-7 pb-5.5">
      <MaterialSymbol
        name="progress_activity"
        size={38}
        className="text-primary animate-spin motion-reduce:animate-none"
      />
      <span className="text-base font-semibold">
        {t("speedtest.connecting_message")}
      </span>
      {serverLine ? (
        <span className="text-on-surface-variant font-mono text-[13px]">
          {serverLine}
        </span>
      ) : null}
    </div>
  );
}

function PingBody({
  t,
  latency,
  progress,
}: {
  t: (key: string) => string;
  latency: number | null;
  progress: number;
}) {
  const role = ROLE.ping;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col items-center gap-2 pt-2.5 pb-1">
        <MaterialSymbol
          name="network_ping"
          filled
          size={26}
          className={cn(
            role.ink,
            "animate-pulse motion-reduce:animate-none",
          )}
        />
        <span
          className="flex items-baseline gap-1.5"
          aria-live="polite"
          aria-atomic="true"
        >
          <span className="text-[44px] leading-none font-semibold tracking-[-0.02em] tabular-nums">
            {latency === null ? "—" : latency.toFixed(1)}
          </span>
          <span className="text-on-surface-variant text-sm">
            {t("speedtest.unit_ms")}
          </span>
        </span>
        <span className="text-on-surface-variant text-[13px]">
          {t("speedtest.testing_latency_message")}
        </span>
      </div>
      <TrackBar
        value={progress}
        trackClassName="bg-surface-container"
        fillClassName={role.strong}
      />
    </div>
  );
}

function TransferBody({
  t,
  step,
  bandwidth,
  bytes,
  progress,
}: {
  t: (key: string, opts?: Record<string, unknown>) => string;
  step: "download" | "upload";
  /**
   * `null` until the first progress line of this phase lands — which is a real
   * window, because Ookla emits nothing for the first fraction of a second and
   * the phase flips on the status endpoint's word, not on a reading. Rendering
   * `0.00` there would be a false claim about the connection, so it renders an
   * em-dash instead. The dashboard tile makes the same call.
   */
  bandwidth: number | null;
  bytes: number | null;
  progress: number;
}) {
  const role = ROLE[step];
  const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100);

  return (
    <div className={cn("rounded-tile flex flex-col gap-2.5 px-4.5 py-3.5", role.container)}>
      <div className="flex items-center gap-2">
        <MaterialSymbol name={role.glyph} size={18} className="flex-none" />
        <span className="text-[13px] font-semibold">
          {t(STEP_LABEL_KEY[step])}
        </span>
        {bytes !== null ? (
          <span className="ml-auto text-xs tabular-nums opacity-80">
            {t("speedtest.bytes_transferred", { bytes: formatBytes(bytes) })}
          </span>
        ) : null}
      </div>

      {/* The figure repaints on the poll tick with no tween — see the header. */}
      <div
        className="flex items-baseline gap-[7px]"
        aria-live="polite"
        aria-atomic="true"
      >
        <span className="text-[52px] leading-none font-semibold tracking-[-0.03em] tabular-nums">
          {bandwidth === null ? "—" : mbpsText(bandwidth)}
        </span>
        <span className="text-base font-semibold opacity-75">
          {t("speedtest.unit_mbps")}
        </span>
      </div>

      {/* Inside a coloured container the neutral track token would fight the
          fill, so the track is a white veil ON the container — the one place
          the Solid-Container Rule's "no alpha" does not apply, because this is
          a shadow within a solid block rather than a container in its own right. */}
      <TrackBar
        value={progress}
        trackClassName="bg-white/45"
        fillClassName={role.strong}
      />
      <span className="text-xs tabular-nums opacity-80">{pct}%</span>
    </div>
  );
}

// -----------------------------------------------------------------------------
// CompleteBody
// -----------------------------------------------------------------------------

function ResultTile({
  step,
  label,
  value,
  unit,
}: {
  step: SpeedtestStep;
  label: string;
  value: string;
  unit: string;
}) {
  const role = ROLE[step];
  return (
    <motion.div
      variants={staggerItem}
      className={cn(
        "rounded-tile flex flex-col items-center gap-1.5 px-2 py-3.5 text-center",
        role.container,
      )}
    >
      <span className="inline-flex items-center gap-1 text-xs font-semibold">
        <MaterialSymbol name={role.glyph} size={14} className="flex-none" />
        {label}
      </span>
      <span className="flex items-baseline gap-1">
        {/* Display numeral — see the DISPLAY NUMERALS note in the header. */}
        <span className="text-[26px] leading-none font-semibold tabular-nums">
          {value}
        </span>
        <span className="text-xs opacity-75">{unit}</span>
      </span>
    </motion.div>
  );
}

function MetricPill({
  label,
  value,
  good,
}: {
  label: string;
  value: string;
  /** Renders the value in the success ink — used for a zero packet loss. */
  good?: boolean;
}) {
  return (
    <div className="bg-surface-container rounded-pill flex items-center justify-between gap-2 px-3.5 py-2.5">
      <dt className="text-on-surface-variant text-xs font-semibold">{label}</dt>
      <dd
        className={cn(
          "text-xs font-semibold tabular-nums",
          good && "text-success",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function CompleteBody({
  t,
  result,
  onStart,
}: {
  t: (key: string, opts?: Record<string, unknown>) => string;
  result: SpeedtestFinalResult;
  onStart: () => void;
}) {
  const absent = t("speedtest.metric_absent");
  const ms = t("speedtest.unit_ms");

  // Every optional read renders an explicit absent state. A blank cell in a
  // 2-up grid is indistinguishable from a layout bug, and "Not reported" is a
  // fact the user can act on ("this server does not measure loss").
  const packetLoss =
    result.packetLoss !== undefined
      ? `${result.packetLoss.toFixed(2)}%`
      : absent;
  const dlLatency =
    result.download.latency?.iqm !== undefined
      ? `${result.download.latency.iqm.toFixed(1)} ${ms}`
      : absent;
  const ulLatency =
    result.upload.latency?.iqm !== undefined
      ? `${result.upload.latency.iqm.toFixed(1)} ${ms}`
      : absent;

  return (
    <div className="flex flex-col gap-4">
      {/* Recipe 02: the three headline figures cascade in 60ms apart, so the
          result assembles itself rather than appearing whole. */}
      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="grid grid-cols-3 gap-2.5"
      >
        <ResultTile
          step="download"
          label={t("speedtest.result_download")}
          value={mbpsText(result.download.bandwidth)}
          unit={t("speedtest.unit_mbps")}
        />
        <ResultTile
          step="upload"
          label={t("speedtest.result_upload")}
          value={mbpsText(result.upload.bandwidth)}
          unit={t("speedtest.unit_mbps")}
        />
        <ResultTile
          step="ping"
          label={t("speedtest.result_ping")}
          value={result.ping.latency.toFixed(1)}
          unit={ms}
        />
      </motion.div>

      <dl className="grid grid-cols-2 gap-1.5">
        <MetricPill
          label={t("speedtest.metric_jitter")}
          value={`${result.ping.jitter.toFixed(1)} ${ms}`}
        />
        <MetricPill
          label={t("speedtest.metric_packet_loss")}
          value={packetLoss}
          good={result.packetLoss === 0}
        />
        <MetricPill label={t("speedtest.metric_dl_latency")} value={dlLatency} />
        <MetricPill label={t("speedtest.metric_ul_latency")} value={ulLatency} />
      </dl>

      <div className="bg-surface-container rounded-tile flex items-center gap-2.5 px-4 py-3">
        <MaterialSymbol
          name="dns"
          size={18}
          className="text-primary flex-none"
        />
        <span className="text-on-surface-variant min-w-0 truncate text-xs font-semibold">
          {result.server.name} · {result.server.location},{" "}
          {result.server.country}
        </span>
        <span className="ml-auto flex-none text-xs font-semibold tabular-nums">
          <span className="sr-only">{t("speedtest.metric_dl_data")}: </span>
          {formatBytes(result.download.bytes)}
          <span aria-hidden="true"> · </span>
          <span className="sr-only">{t("speedtest.metric_ul_data")}: </span>
          {formatBytes(result.upload.bytes)}
        </span>
      </div>

      <p className="text-on-surface-variant truncate text-center text-xs">
        {t("speedtest.result_isp")}: {result.isp}
      </p>

      {/* `flex-wrap` + a centred row rather than a fixed two-column layout:
          Ookla emits an empty `url` when the result upload fails (common on a
          flaky uplink), and the button must stay centred when the link is gone
          rather than sit beside a hole. */}
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={onStart}
          className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-pill inline-flex h-[42px] items-center gap-2 px-[22px] text-sm font-semibold transition-colors duration-[var(--duration-standard)] ease-standard"
        >
          <MaterialSymbol
            name="play_arrow"
            filled
            size={18}
            className="flex-none"
          />
          {t("speedtest.run_again_button")}
        </button>
        {result.result?.url ? (
          <a
            href={result.result.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-on-surface-variant hover:text-foreground inline-flex items-center gap-1.5 text-[13px] underline underline-offset-[3px] transition-colors duration-[var(--duration-quick)] ease-out"
          >
            <MaterialSymbol
              name="open_in_new"
              size={15}
              className="flex-none"
            />
            {t("speedtest.view_result_link")}
          </a>
        ) : null}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// ErrorBody
// -----------------------------------------------------------------------------

function ErrorBody({
  t,
  error,
  failedAt,
  phaseFigures,
  onStart,
}: {
  t: (key: string, opts?: Record<string, unknown>) => string;
  error: string | null;
  failedAt: SpeedtestStep | null;
  phaseFigures: ReturnType<typeof useSpeedtest>["phaseFigures"];
  onStart: () => void;
}) {
  const headline = failedAt
    ? t("speedtest.failed_during", { step: t(STEP_LABEL_KEY[failedAt]) })
    : t("speedtest.try_again_button");

  // Anything a completed step managed to measure before the run died is worth
  // more than the failure alone: "download reached 340 Mbps, upload failed" is
  // a different problem from "nothing worked".
  const salvaged: { step: SpeedtestStep; value: number }[] = [];
  if (phaseFigures.download !== undefined && failedAt !== "download") {
    salvaged.push({ step: "download", value: phaseFigures.download });
  }
  if (phaseFigures.upload !== undefined && failedAt !== "upload") {
    salvaged.push({ step: "upload", value: phaseFigures.upload });
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        role="alert"
        className="bg-destructive-container text-on-destructive-container rounded-tile flex flex-col items-center gap-3 px-4 py-4.5"
      >
        <MaterialSymbol name="error" filled size={30} className="flex-none" />
        <span className="text-center text-sm font-semibold">{headline}</span>
        {error ? (
          // Raw backend detail is machine voice — it is a string the device
          // produced, not a sentence we wrote.
          <span className="text-center font-mono text-xs leading-[1.5] break-words">
            {error}
          </span>
        ) : null}
      </div>

      {salvaged.length > 0 ? (
        <dl className="grid grid-cols-2 gap-1.5">
          {salvaged.map(({ step, value }) => (
            <MetricPill
              key={step}
              label={t(STEP_LABEL_KEY[step])}
              value={`${mbpsText(value)} ${t("speedtest.unit_mbps")}`}
            />
          ))}
        </dl>
      ) : null}

      <button
        type="button"
        onClick={onStart}
        className="border-outline hover:bg-surface-container rounded-pill mx-auto inline-flex h-[42px] items-center gap-2 border bg-transparent px-[22px] text-sm font-semibold transition-colors duration-[var(--duration-quick)] ease-out"
      >
        <MaterialSymbol
          name="play_arrow"
          filled
          size={18}
          className="flex-none"
        />
        {t("speedtest.try_again_button")}
      </button>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Body mode resolution
// -----------------------------------------------------------------------------

type BodyMode =
  | "unavailable"
  | "idle"
  | "initializing"
  | "ping"
  | "download"
  | "upload"
  | "complete"
  | "error";

/**
 * One pure function decides what the panel shows, so the header, the step chips
 * and the body can never disagree — and so no combination of inputs can render
 * a blank dialog.
 *
 * The two guards that are not obvious:
 *
 *  - `complete` WITHOUT a result falls back to `idle`. The previous
 *    implementation gated the complete branch on `phase === "complete" && result`
 *    and had no other branch that matched, so that combination rendered an empty
 *    body. It is reachable: `refreshStatus()` can report `complete` while the
 *    result payload is still being read off disk.
 *  - `unavailable` is checked LAST, not first. A cached result or a run already
 *    in flight is real information, and hiding it behind "the CLI is missing"
 *    would throw away the only thing the dialog still had to say.
 */
function resolveBodyMode(
  phase: SpeedtestPhase,
  result: SpeedtestFinalResult | null,
  isAvailable: boolean | null,
): BodyMode {
  if (phase === "complete") return result ? "complete" : "idle";
  if (phase !== "idle") return phase;
  return isAvailable === false ? "unavailable" : "idle";
}

// =============================================================================
// SpeedtestDialog
// =============================================================================

export function SpeedtestDialog({ open, onOpenChange }: SpeedtestDialogProps) {
  const { t } = useTranslation("dashboard");
  const {
    isAvailable,
    phase,
    progress,
    currentProgress,
    result,
    error,
    failedAt,
    phaseFigures,
    isRunning,
    servers,
    selectedServer,
    isLoadingServers,
    serversError,
    start,
    refreshStatus,
    fetchServers,
    setSelectedServer,
  } = useSpeedtest();

  // On open: re-attach to any run already in flight, and refresh the list.
  React.useEffect(() => {
    if (open) {
      refreshStatus();
      fetchServers();
    }
  }, [open, refreshStatus, fetchServers]);

  const mode = resolveBodyMode(phase, result, isAvailable);

  // `null`, not 0, when no progress line for the current phase has arrived —
  // see the note on TransferBody's props. A zero here would be a reading the
  // modem never took.
  const liveBandwidth =
    currentProgress?.type === "download"
      ? currentProgress.download.bandwidth
      : currentProgress?.type === "upload"
        ? currentProgress.upload.bandwidth
        : null;

  const liveBytes =
    currentProgress?.type === "download"
      ? currentProgress.download.bytes
      : currentProgress?.type === "upload"
        ? currentProgress.upload.bytes
        : null;

  const liveLatency =
    currentProgress?.type === "ping" ? currentProgress.ping.latency : null;

  const serverLine =
    currentProgress?.type === "testStart"
      ? `${currentProgress.server.name} — ${currentProgress.server.location}`
      : null;

  // The chips belong to the running sequence and to the post-mortem, and to
  // nothing else: on idle they would be three grey pills promising a test that
  // has not started, and on a finished run the result tiles already say it.
  const showChips =
    mode === "ping" ||
    mode === "download" ||
    mode === "upload" ||
    mode === "error";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className={cn(
          "rounded-card gap-5 p-6 sm:max-w-md",
          "max-h-[85vh] overflow-y-auto",
          // The panel is changing size and shape, so it arrives on the
          // emphasized clock rather than the primitive's stock 200ms.
          "duration-[var(--duration-emphasized)] ease-emphasized",
        )}
      >
        <DialogHeader className="flex-row items-center gap-2 space-y-0 text-left">
          <DialogTitle className="text-base font-semibold">
            {t("speedtest.title")}
          </DialogTitle>
          {isRunning ? (
            <Badge variant="info" className="gap-1.5">
              <MaterialSymbol
                name="progress_activity"
                size={12}
                className="animate-spin motion-reduce:animate-none"
              />
              {t("speedtest.running_badge")}
            </Badge>
          ) : null}
          <DialogClose asChild>
            <button
              type="button"
              aria-label={t("speedtest.close_aria")}
              className="text-on-surface-variant hover:bg-surface-container ml-auto grid size-8 flex-none place-items-center rounded-full transition-colors duration-[var(--duration-quick)] ease-out"
            >
              <MaterialSymbol name="close" size={20} />
            </button>
          </DialogClose>
        </DialogHeader>

        {showChips ? <StepChips phase={phase} failedAt={failedAt} /> : null}

        {/* Phase swaps ride the emphasized curve. `mode="wait"` keeps the two
            panels from overlapping in a box whose height is changing under
            them; the exit is `quick` so the wait does not read as a stall. */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={mode}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0, transition: transitionEmphasized }}
            exit={{
              opacity: 0,
              transition: { duration: DUR.quick, ease: EASE_EMPHASIZED },
            }}
          >
            {mode === "unavailable" ? (
              <div className="bg-warning-container text-on-warning-container rounded-tile flex flex-col items-center gap-2.5 px-4 py-4.5 text-center">
                <MaterialSymbol
                  name="cloud_off"
                  filled
                  size={30}
                  className="flex-none"
                />
                <span className="text-sm font-semibold">
                  {t("speedtest.unavailable_title")}
                </span>
                <span className="text-[13px] leading-[1.5]">
                  {t("speedtest.unavailable_body")}
                </span>
              </div>
            ) : null}

            {mode === "idle" ? (
              <IdleBody
                t={t}
                isAvailable={isAvailable}
                servers={servers}
                selectedServer={selectedServer}
                isLoadingServers={isLoadingServers}
                serversError={serversError}
                onSelectServer={setSelectedServer}
                onRefreshServers={fetchServers}
                onStart={start}
              />
            ) : null}

            {mode === "initializing" ? (
              <InitializingBody t={t} serverLine={serverLine} />
            ) : null}

            {mode === "ping" ? (
              <PingBody t={t} latency={liveLatency} progress={progress} />
            ) : null}

            {mode === "download" || mode === "upload" ? (
              <TransferBody
                t={t}
                step={mode}
                bandwidth={liveBandwidth}
                bytes={liveBytes}
                progress={progress}
              />
            ) : null}

            {mode === "complete" && result ? (
              <CompleteBody t={t} result={result} onStart={start} />
            ) : null}

            {mode === "error" ? (
              <ErrorBody
                t={t}
                error={error}
                failedAt={failedAt}
                phaseFigures={phaseFigures}
                onStart={start}
              />
            ) : null}
          </motion.div>
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
