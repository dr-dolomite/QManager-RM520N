"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { motion, useReducedMotion } from "motion/react";

import { MaterialSymbol } from "@/components/ui/material-symbol";
import { TonalBanner } from "@/components/ui/tonal-banner";
import { cn } from "@/lib/utils";
import {
  DUR,
  EASE_STANDARD,
  staggerContainer,
  staggerItem,
} from "@/lib/motion";
import { CARD_TITLE } from "@/components/pre-auth-type";

import { ModeToggle } from "@/components/public/mode-toggle";
import {
  AggregateBandRow,
  BandRow,
  ROW_STACK_GAP,
  SegmentedMetricToggle,
} from "@/components/public/overview/band-rows";
import {
  ReadingChip,
  SkeletonBody,
  UnreachableState,
} from "@/components/public/overview/states";
import { StatusTile, TonalTile } from "@/components/public/overview/tiles";
import {
  CONNECTION_TILE,
  EYEBROW_CLASS,
  formatAge,
  TEMPERATURE_TILE,
  temperatureBand,
  type BandMetric,
  type ConnectionLabel,
  type TranslateFn,
} from "@/components/public/overview/tone";
import { usePublicOverview } from "@/hooks/use-public-overview";
import { usePublicUnitPreferences } from "@/hooks/use-public-unit-preferences";
import { deriveConnectionLabel } from "@/lib/public-overview/format";
import { formatTemperature } from "@/types/modem-status";
import { LoginDeviceName } from "../auth/login-device-name";

// =============================================================================
// OverviewCard — the public, unauthenticated splash at "/".
// =============================================================================
// Retargeted to the Material-3 tonal language. The presentational units live in
// ./overview/ so this file stays the orchestrator: data in, state resolved,
// tiles out.
//
// Icons here are Material Symbols — the Icon-Boundary Rule now covers the
// sidebar, /dashboard, "/" and "/login/". `size` is passed at EVERY call site
// because the component emits an inline `fontSize` that outranks `size-*`.
// =============================================================================

/** Poll cadence echoed in the footer caption. Mirrors POLL_INTERVAL in the hook. */
const RETRY_SECONDS = 5;

/**
 * Unix-seconds now, on its own clock rather than read at render.
 *
 * Two reasons it is a hook and not a bare `Date.now()`. First, purity: a value
 * read during render updates unpredictably whenever the component happens to
 * re-render. Second, and the one that matters here — the hook's error path
 * never calls `setData`, so a sustained fetch failure stops re-rendering
 * entirely. Without an independent clock the age would freeze under a still-
 * rendering stale card, which is exactly the Saved-State Honesty failure the
 * stale banner exists to prevent.
 *
 * The tick matches the poll cadence: a splash page has no reason to wake more
 * often than the data it is describing.
 */
function useNowSec(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      RETRY_SECONDS * 1000,
    );
    return () => clearInterval(id);
  }, []);
  return now;
}

/**
 * After this many consecutive fetch failures, swap from "stale banner + dimmed
 * data" to the full unreachable state, so the user gets an obvious retry
 * affordance instead of staring at indefinitely stale numbers.
 */
const FAILURE_EMPTY_STATE_THRESHOLD = 3;

// ---------- Body mode ------------------------------------------------------
//
// The seven-branch decision order, extracted to ONE place so the footer caption
// and the body can never disagree about which state the card is in. The order
// itself is unchanged and load-bearing: re-ordering it changes which state a
// flapping modem shows.

type BodyMode =
  | "skeleton" // 1. first paint, no data yet
  | "redirecting" // 2. setup_required → /setup/
  | "empty_fetch" // 3 & 4. fetch error, with or without prior data
  | "empty_unavailable" // 5. the poller itself reports unavailable
  | "bare_skeleton" // 6. no usable payload, but no error either
  | "live"; // 7. the real thing

function resolveBodyMode({
  data,
  isLoading,
  error,
  consecutiveFailures,
}: {
  data: ReturnType<typeof usePublicOverview>["data"];
  isLoading: boolean;
  error: string | null;
  consecutiveFailures: number;
}): BodyMode {
  if (isLoading && !data) return "skeleton";
  if (data?.state === "setup_required") return "redirecting";
  if (error && !data) return "empty_fetch";
  if (error && consecutiveFailures >= FAILURE_EMPTY_STATE_THRESHOLD)
    return "empty_fetch";
  if (data?.state === "unavailable") return "empty_unavailable";
  if (!data || data.state !== "ok") return "bare_skeleton";
  return "live";
}

// ---------- Component ------------------------------------------------------

export default function OverviewCard() {
  const { t } = useTranslation("common");
  const { data, isLoading, isStale, error, refresh, consecutiveFailures } =
    usePublicOverview();
  const unitPrefs = usePublicUnitPreferences();
  const reduceMotion = useReducedMotion();
  const nowSec = useNowSec();

  // Verdict announcer: a single sr-only aria-live region that fires only when a
  // meaningful band changes (signal quality, connection state, temperature
  // band). Without this gate the 5 s poll would re-announce the entire status
  // trio on every tick.
  const [announcement, setAnnouncement] = useState("");
  const prevVerdictRef = useRef<string>("");

  // Per-band metric shown by the band rows, driven by the section toggle.
  // Pre-login read-only view state; not persisted.
  const [bandMetric, setBandMetric] = useState<BandMetric>("rsrp");

  // Recipe 07's "first paint only" gate. Flipped one frame after the first live
  // render: rows mounted before the flip keep their 0→full growth; rows that
  // appear later (a carrier added mid-poll) settle in without re-growing, and
  // the 5 s poll never re-runs the entrance.
  const [metersPainted, setMetersPainted] = useState(false);

  const mode = resolveBodyMode({ data, isLoading, error, consecutiveFailures });

  useEffect(() => {
    if (mode !== "live" || metersPainted) return;
    const frame = requestAnimationFrame(() => setMetersPainted(true));
    return () => cancelAnimationFrame(frame);
  }, [mode, metersPainted]);

  // Setup gate: bounce to /setup/ on a fresh-install device.
  useEffect(() => {
    if (data?.state === "setup_required") {
      window.location.href = "/setup/";
    }
  }, [data]);

  useEffect(() => {
    if (!data || data.state !== "ok") return;
    const reachable = data.modem_reachable;
    const connectionLabel: ConnectionLabel = reachable
      ? deriveConnectionLabel(data.network.lte_state, data.network.nr_state)
      : "modem_unreachable";
    const tempBand = temperatureBand(data.temperature);
    // Two axes, not three. The retired Overall tile was the quality axis's only
    // home on this card, and the per-carrier rows that replaced it announce
    // their own ramp stop in an sr-only word beside each figure — so keeping it
    // here would announce the same verdict twice, once summed and once per row.
    const verdict = `${connectionLabel}|${tempBand}`;

    // First reading: seed the ref but don't announce.
    if (prevVerdictRef.current === "") {
      prevVerdictRef.current = verdict;
      return;
    }
    if (prevVerdictRef.current === verdict) return;

    const [prevC, prevT] = prevVerdictRef.current.split("|");
    const parts: string[] = [];
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
  }, [data, t, unitPrefs?.tempUnit]);

  // Reading age, for the stale banner. Clamped: a modem clock a second ahead
  // of the browser must not render a negative age.
  const ageSeconds =
    data?.state === "ok" ? Math.max(0, nowSec - data.timestamp) : null;

  const isEmpty = mode === "empty_fetch" || mode === "empty_unavailable";
  const busy = mode === "skeleton" || mode === "bare_skeleton";

  // Footer caption suffix — one derivation, sharing the body's mode so the two
  // can never contradict each other.
  const footerSuffix = isEmpty ? t("overview.footer.signin_works") : null;

  // The comp overrides this surface's previous "no card entrance" ruling. That
  // ruling is right for product surfaces you load INTO a task — but the splash
  // IS the arrival, and it is the first thing a visitor ever sees of QManager.
  return (
    <motion.section
      aria-busy={busy || undefined}
      initial={reduceMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={
        reduceMotion
          ? { duration: 0 }
          : { duration: DUR.standard, ease: EASE_STANDARD }
      }
      className="@container/overview bg-card text-foreground mx-auto flex w-full max-w-[34rem] flex-col gap-6 rounded-hero px-8 py-7.5 shadow-[var(--shadow-whisper)] dark:shadow-none"
    >
      {/* (a) Header ------------------------------------------------------- */}
      <div className="flex items-center gap-3.5">
        {/* The mark ships BARE -- the `primary-container` fill is gone. It
            sat in that disc here and in an identical one on /login/, and
            measured against the fill the mark's own tail renders 1.54:1 in dark
            mode: the brand's logo was the least legible element on both
            pre-auth screens. DESIGN.md requires the pre-auth pair to move
            together, so both discs went in one commit rather than leaving the
            two surfaces re-forked the week after pre-auth-type.ts joined them.

            The BOX is deliberately unchanged -- same 52px, same inset, so the
            mark keeps its drawn size and the header rhythm beside the h1 does
            not shift. Only the tint was ever the problem. */}
        <div className="grid size-13 flex-none place-items-center p-[0.6875rem]">
          {/* Decorative: the adjacent heading already names the product. */}
          <img
            src="/qmanager-mark.svg"
            alt=""
            aria-hidden="true"
            width={30}
            height={30}
            className="size-full object-contain"
          />
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className={cn(CARD_TITLE, "truncate")}>
            {t("overview.title")}
          </h1>
          {/* Self-skeletoning, and silent when the device has no hostname. */}
          <LoginDeviceName />
        </div>
        <div className="ml-auto flex-none">
          {busy ? (
            <ReadingChip label={t("overview.loading_chip")} />
          ) : (
            <ModeToggle />
          )}
        </div>
      </div>

      {renderBody({
        mode,
        data,
        isStale,
        ageSeconds,
        t,
        refresh,
        bandMetric,
        onBandMetricChange: setBandMetric,
        unitPrefs,
        metersPainted,
      })}

      {/* Single visually-hidden announcer for verdict transitions. Lives
          outside the polled surfaces so SR users hear deltas ("Internet:
          Searching") instead of the full trio every tick. */}
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>

      {/* (e) Footer ------------------------------------------------------- */}
      <div className="flex flex-col gap-3 pt-0.5">
        {/* The CTA names its consequence: the splash is already a complete
            read-only answer for most visits, so the button's job is to say what
            you get by going further, not merely where the link goes. */}
        <Link
          href="/login/"
          className="bg-primary text-primary-foreground focus-visible:ring-primary grid h-12 w-full place-items-center rounded-pill text-[0.9375rem] font-semibold transition-[filter] duration-[var(--duration-quick)] ease-out hover:brightness-110 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          {t("overview.actions.login")}
        </Link>
        {/* Two facts, given room rather than punctuated between (DESIGN.md >
            The No-Dot-Separator Rule). The suffix only appears in an empty
            state, so on a healthy card this is a single line either way. */}
        <p className="text-on-surface-variant flex flex-wrap justify-center gap-x-2 text-center text-xs">
          <span>{t("overview.copyright", { year: new Date().getFullYear() })}</span>
          {footerSuffix ? <span>{footerSuffix}</span> : null}
        </p>
      </div>
    </motion.section>
  );
}

// ---------- Body renderer --------------------------------------------------

interface BodyProps {
  mode: BodyMode;
  data: ReturnType<typeof usePublicOverview>["data"];
  isStale: boolean;
  ageSeconds: number | null;
  t: TranslateFn;
  refresh: () => void;
  bandMetric: BandMetric;
  onBandMetricChange: (metric: BandMetric) => void;
  unitPrefs: ReturnType<typeof usePublicUnitPreferences>;
  metersPainted: boolean;
}

function renderBody({
  mode,
  data,
  isStale,
  ageSeconds,
  t,
  refresh,
  bandMetric,
  onBandMetricChange,
  unitPrefs,
  metersPainted,
}: BodyProps) {
  // 1. First paint, nothing to draw yet.
  if (mode === "skeleton") {
    return <SkeletonBody loadingLabel={t("overview.loading_status")} />;
  }
  // 2. Fresh-install device: the effect above is already navigating to /setup/.
  if (mode === "redirecting") {
    return (
      <div
        className="text-on-surface-variant flex items-center justify-center gap-2 py-8 text-sm"
        role="status"
      >
        <MaterialSymbol
          name="progress_activity"
          size={16}
          className="motion-safe:animate-spin"
        />
        {t("overview.redirecting_setup")}
      </div>
    );
  }
  // 3 & 4. Fetch failure, with or without prior data.
  if (mode === "empty_fetch") {
    return (
      <UnreachableState
        title={t("overview.empty.title")}
        subtitle={t("overview.empty.fetch_error")}
        retryLabel={t("overview.empty.retry")}
        onRetry={refresh}
      />
    );
  }
  // 5. The poller itself reports unavailable.
  if (mode === "empty_unavailable") {
    return (
      <UnreachableState
        title={t("overview.empty.title")}
        subtitle={t("overview.empty.subtitle")}
        retryLabel={t("overview.empty.retry")}
        onRetry={refresh}
      />
    );
  }
  // 6. No usable payload, but no error either.
  if (mode === "bare_skeleton" || !data || data.state !== "ok") {
    return <SkeletonBody />;
  }

  // 7. Live.
  const reachable = data.modem_reachable;
  const connectionLabel: ConnectionLabel = reachable
    ? deriveConnectionLabel(data.network.lte_state, data.network.nr_state)
    : "modem_unreachable";

  const carrier = data.network.carrier || t("overview.field.empty");
  const networkType = data.network.type || t("overview.field.empty");

  // The BANDWIDTH tile shows aggregate channel bandwidth summed across
  // carriers; the per-band detail lives in the signal section below. The joined
  // "B1, N41" list survives as the tile's tooltip, so the individual bands stay
  // one hover away.
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
  const bandwidthValue =
    totalBandwidth > 0
      ? t("overview.bands.bandwidth", { bandwidth: totalBandwidth })
      : t("overview.field.empty");

  const connection = CONNECTION_TILE[connectionLabel];
  const temperature = TEMPERATURE_TILE[temperatureBand(data.temperature)];

  const entrance = (i: number) => (metersPainted ? null : i);
  const dimmed =
    "transition-opacity duration-[var(--duration-standard)] ease-[var(--ease-standard)]";

  return (
    <>
      {/* Unreachable banner — the poller itself couldn't reach the modem's AT
          layer (lte_state/nr_state come back "unknown" in this state), which
          is a harder failure than a merely-stale HTTP fetch. role="alert",
          and it takes the one-word "Offline" INTERNET tile's place explaining
          why, rather than cramming the explanation into that tile. */}
      {!reachable && (
        <TonalBanner
          tone="destructive"
          icon="signal_cellular_off"
          size="compact"
          role="alert"
        >
          {t("overview.unreachable.banner")}
        </TonalBanner>
      )}

      {/* Stale banner — a sentence, not a badge. A lone amber "Stale" chip
          states a fact you cannot act on; this says how old the reading is and
          offers a likely reason, and the zones beneath drop in opacity so the
          whole card reads as provisional. role="status", never "alert": stale
          data is not an emergency.
          Gated on `reachable`: an unreachable modem's timestamp is stale by
          definition (the poller can't get a fresh one either), so pairing it
          with the unreachable banner above would just repeat the same fact
          in two colours. The unreachable banner alone already covers it. */}
      {reachable && isStale && ageSeconds != null && (
        <TonalBanner tone="warning" icon="schedule" size="compact" role="status">
          <Trans
            i18nKey="overview.stale.banner"
            ns="common"
            values={{ age: formatAge(ageSeconds) }}
            components={{
              age: <span className="font-semibold tabular-nums" />,
            }}
          />
        </TonalBanner>
      )}

      {/* The zone cascade — 120ms, the CARD step, because these three zones are
          cards' worth of content stacked in a 24px gutter rather than rows
          sharing one border. `display: contents` so the container choreographs
          without becoming a box: the section's own flex gap still spaces the
          zones, and the container carries no visual props of its own.

          The banners sit OUTSIDE it deliberately. A banner is an arrival, not a
          member of the sequence — waiting its turn behind two zones is exactly
          the wrong behaviour for the element saying the modem is unreachable. */}
      <motion.div
        className="contents"
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
      >
        {/* (b) Status pair -------------------------------------------------- */}
        {/* FIRST, and that is the whole point of the reordering: status →
            evidence → identity. A visitor arriving at this card is asking "is it
            working", and the answer used to be the third thing on the page,
            underneath the carrier's name and a list of band numbers.

            No aria-live here — per-poll numeric ticks would flood screen
            readers. Verdict transitions go through the dedicated sr-only region
            above.

            THE 22rem CLIFF IS MEASURED. The plan proposed 18rem (288px) from
            arithmetic, which a 390px phone clears by 6px — so the pair would go
            2-up there. Measured in the browser, a 143px column minus the shape's
            30px of padding, the 40px disc and its 12px gap leaves 61px of
            eyebrow, and English "Temperature" needs 88px. The disc is new on
            this tile, so this clipping is new too: the tinted tile it replaced
            had the full column for its label. 22rem (352px) is the first step
            where every eyebrow fits in every locale — a 172px column, 90px of
            eyebrow, against Italian's 89px "Temperatura". Below it the pair
            stacks and each tile gets the whole width. */}
        <motion.div
          variants={staggerItem}
          className={cn(
            "grid grid-cols-1 gap-2 @[22rem]/overview:grid-cols-2",
            dimmed,
            isStale && "opacity-80",
          )}
        >
          <StatusTile
            eyebrow={t("overview.status.connectivity")}
            value={t(`overview.connection.${connectionLabel}`)}
            tone={connection.tone}
            icon={connection.icon}
          />
          <StatusTile
            eyebrow={t("overview.status.temperature")}
            value={formatTemperature(data.temperature, unitPrefs?.tempUnit)}
            tone={temperature.tone}
            icon={temperature.icon}
            mono
          />
        </motion.div>

        {/* (c) Carriers ----------------------------------------------------- */}
        {/* The evidence. These rows are what the retired Overall tile was
            summarising, and they say it per carrier, on the ramp, with a toggle
            to switch metric — strictly more than one word in a tile could. */}
        <motion.div
          variants={staggerItem}
          className={cn("flex flex-col gap-3", dimmed, isStale && "opacity-70")}
        >
          <div className="flex items-center justify-between gap-3">
            <span
              className={cn(
                EYEBROW_CLASS,
                "text-on-surface-variant min-w-0 truncate",
              )}
            >
              {t("overview.bands.section_count", { count: bands.length })}
            </span>
            <SegmentedMetricToggle
              value={bandMetric}
              onChange={onBandMetricChange}
              t={t}
            />
          </div>
          {bands.length > 0 ? (
            <div className={cn("flex flex-col", ROW_STACK_GAP)}>
              {bands.map((b, i) => (
                <BandRow
                  key={`${b.band}-${b.pci ?? "x"}-${i}`}
                  band={b}
                  reachable={reachable}
                  metric={bandMetric}
                  t={t}
                  entranceIndex={entrance(i)}
                />
              ))}
            </div>
          ) : (
            <AggregateBandRow
              metric={bandMetric}
              value={bandMetric === "rsrp" ? data.signal.rsrp : data.signal.sinr}
              reachable={reachable}
              entranceIndex={entrance(0)}
              t={t}
            />
          )}
        </motion.div>

        {/* (d) Identity trio ------------------------------------------------ */}
        {/* Last. Who you are attached to and how wide the pipe is are facts you
            look up once and then stop reading; they do not move between polls
            the way the two zones above do.

            The 22rem cliff is MEASURED, not chosen (see the status pair above).
            At 352px of content box a column is 112px, leaving 82px of eyebrow —
            enough for "Bandwidth" at 75px. Italian's "Larghezza di banda" wants
            136px and fits in NO 3-up at any card width: the card caps at 544px,
            which is a 144px column and 114px of eyebrow. That one truncates on
            purpose, with the full string on the tile's `title`. */}
        <motion.div
          variants={staggerItem}
          className={cn(
            "grid grid-cols-1 gap-2 @[22rem]/overview:grid-cols-3",
            dimmed,
            isStale && "opacity-80",
          )}
        >
          <TonalTile
            eyebrow={t("overview.header.carrier")}
            value={carrier}
            title={data.network.carrier}
            truncate
          />
          <TonalTile
            eyebrow={t("overview.header.network")}
            value={networkType}
          />
          {/* Legacy key id `header.bands` now reads "Bandwidth" — kept (not
              renamed to .bandwidth) so installed language packs that mirror this
              id don't lose their translation. */}
          <TonalTile
            eyebrow={t("overview.header.bands")}
            value={bandwidthValue}
            title={bandList || undefined}
            mono
          />
        </motion.div>
      </motion.div>
    </>
  );
}
