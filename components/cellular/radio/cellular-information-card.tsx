"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SwapLabel } from "@/components/ui/swap-label";
import { TickGroup } from "@/components/ui/tick-group";
import { TickingValue } from "@/components/ui/ticking-value";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { compressIPv6, decToHex } from "@/lib/ipv6";
import { staggerRowItem, staggerRows } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { ModemStatus } from "@/types/modem-status";
import {
  calculateLteDistance,
  calculateNrDistance,
  formatDistance,
  formatUptime,
} from "@/types/modem-status";
import { useUnitPreferences } from "@/hooks/use-system-settings";

// =============================================================================
// Connection details — the HANDOVER-cadence half of /cellular/ Radio Information
// =============================================================================
// Everything here changes on attach or handover; nothing here changes per poll.
// That is why it is no longer a column beside the live card, height-locked to
// it: the page is split by cadence now, and this half lays its three groups out
// side by side so a static reference card cannot dictate the page's height.
//
// Two rows were DELETED rather than moved. `Network type` and `Carrier
// aggregation` each restated a summary tile sitting ~200px above them on the
// same screen, and the CA row additionally re-derived a count that
// `summariseRadio` already owned — a second derivation of one fact is a
// contradiction waiting for the poll where the two sources disagree.
//
// Three rows were ADDED from data the poller already returned and this page
// threw away: link uptime, the address family actually carrying traffic, and
// the timing-advance distance estimate.
//
// Re-skin of the outgoing `components/cellular/cell-data.tsx`. The domain logic
// (which RAT owns Cell ID, why eNodeB/Sector are never computed here, the IPv6
// compression) is carried over unchanged; only the vocabulary is new.
//
// The vocabulary IS the change: hairline `Separator` rows are replaced by
// filled pill rows on `surface-container`, grouped under three eyebrows. Pills
// are right for this card because it is a ~12-row glance surface, not a data
// table — hairlines stay reserved for genuine tables (DESIGN.md).
//
// Two things in the approved comp are deliberately NOT built:
//
//   1. The `advanced` two-tier split. It reads like a user control but it is a
//      design-tool editor boolean — there is no toggle anywhere in the comp. So
//      eNodeB, Sector and the hex TAC render unconditionally, at ONE detail
//      level.
//   2. The "nothing here is derived except the frequencies" footnote, which is
//      false on six counts (quality words, bar widths, the ANCHOR role, the
//      bandwidth sum, the TAC hex, and duplex mode are all derived).
// =============================================================================

// -----------------------------------------------------------------------------
// Geometry — exported so the skeleton cannot drift from the real rows
// -----------------------------------------------------------------------------

/**
 * The Skeleton-Mirror Rule made mechanical: the loading state and the loaded
 * state read these same constants, so the handoff is a crossfade rather than a
 * reflow. Change a pad here and both sides move together.
 */
export const ROW_SHAPE =
  "flex items-center justify-between gap-4 rounded-pill bg-surface-container px-4 py-[0.6875rem]";

/**
 * The half-width eNodeB / Sector pair. Same vertical padding and type size as
 * `ROW_SHAPE` — the comp drew this pair a notch tighter with 12px text, but
 * that reads as a demotion sitting inside a card where every other row is
 * 13px, and nothing about eNodeB/Sector is less important than the rows
 * around it. Only the horizontal gap and padding are tuned for the half
 * width, so the pair matches its neighbors' height exactly.
 */
export const ROW_SHAPE_COMPACT =
  "flex min-w-0 flex-1 items-center justify-between gap-2.5 rounded-pill bg-surface-container px-4 py-[0.6875rem]";

/** Vertical rhythm: 5px between rows, 9px between an eyebrow and its rows. */
export const ROW_STACK = "flex flex-col gap-[0.3125rem]";
export const GROUP_STACK = "flex flex-col gap-[0.5625rem]";

/**
 * Label and value share one line box so a Skeleton bar and a glyph of text
 * occupy identical height. 13px is an approved off-ramp size for dense radio
 * rows; the explicit `leading-5` is what makes it safe.
 */
export const ROW_LINE = "flex h-5 items-center";
export const ROW_LABEL =
  "text-[0.8125rem] font-semibold leading-5 text-on-surface-variant";
export const ROW_VALUE = "text-[0.8125rem] font-semibold leading-5";

export const EYEBROW_CLASS =
  "px-1.5 text-[0.6875rem] font-semibold uppercase leading-none tracking-[0.09em] text-on-surface-variant";

/**
 * The literal row sequence of each group, so the skeleton renders the true
 * shape of the card rather than an approximation of it. `split` is the
 * half-width eNodeB / Sector pair.
 */
export const GROUP_SHAPES = {
  connection: ["row", "row", "row", "row"],
  identity: ["row", "split", "row", "row"],
  addressing: ["row", "row", "row", "row"],
} as const satisfies Record<string, readonly ("row" | "split")[]>;

/**
 * The three groups sit side by side rather than stacked. Container queries
 * against the card's own `@container/cellinfo`, not the viewport — this card is
 * now full-width on the page, so its width is the page's width and a viewport
 * breakpoint would be measuring the wrong box.
 */
export const GROUP_GRID =
  "grid grid-cols-1 items-start gap-x-6 gap-y-5 @2xl/cellinfo:grid-cols-2 @4xl/cellinfo:grid-cols-3";

// -----------------------------------------------------------------------------
// Props
// -----------------------------------------------------------------------------

export interface CellularInformationCardProps {
  /** The full poller snapshot; `null` before the first successful fetch. */
  data: ModemStatus | null;
  /** True during the very first fetch, before any data exists. */
  isLoading: boolean;
}

// -----------------------------------------------------------------------------
// Row primitives
// -----------------------------------------------------------------------------

function Row({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div variants={staggerRowItem} className={cn(ROW_SHAPE, className)}>
      <span className={cn(ROW_LABEL, "shrink-0")}>{label}</span>
      <div className="flex min-w-0 items-center justify-end gap-2">
        {children}
      </div>
    </motion.div>
  );
}

/**
 * A value that is present, or a quiet statement that it is not. Deliberately
 * not a bare "-": a dash reads as a rendering failure inside a filled pill,
 * where there is no column rule to tell the eye the slot is simply empty.
 */
function Value({
  value,
  fallback,
  mono = false,
  className,
}: {
  value: string | number | null | undefined;
  fallback: string;
  mono?: boolean;
  className?: string;
}) {
  const empty = value === null || value === undefined || value === "";
  if (empty) {
    return (
      <span className={cn(ROW_VALUE, "font-normal text-on-surface-variant")}>
        {fallback}
      </span>
    );
  }
  return (
    <span
      className={cn(ROW_VALUE, mono && "font-mono tabular-nums", className)}
    >
      {value}
    </span>
  );
}

/**
 * Copy affordance. The comp draws this as a bare glyph `<span>` — not
 * focusable and with no accessible name, which is not shippable. It is a real
 * button here, and it confirms visibly (glyph swap) as well as through the
 * toast, because a toast can be missed on a wide monitor.
 */
function CopyButton({ value, label }: { value: string; label: string }) {
  const { t } = useTranslation("cellular");
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const confirm = () => {
    setCopied(true);
    toast.success(t("radio_info.copy.success", { label }));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      confirm();
    } catch {
      toast.error(t("radio_info.copy.error"));
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={t("radio_info.copy.aria", { label })}
      className={cn(
        "inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-pill",
        "text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface",
        "focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-[3px]",
        copied && "text-success",
      )}
    >
      <MaterialSymbol name={copied ? "check" : "content_copy"} size={16} />
      <span aria-live="polite" className="sr-only">
        {copied ? t("radio_info.copy.copied") : ""}
      </span>
    </button>
  );
}

/**
 * An address row. IPv6 arrives from the modem as sixteen dotted decimal octets
 * (AT+CGCONTRDP) and is compressed to RFC 5952 for reading; the uncompressed
 * form stays reachable through a tooltip whose trigger is the value itself, so
 * there is no extra glyph and the trigger is keyboard-reachable by construction.
 */
function AddressRow({
  label,
  raw,
  fallback,
  copyable = false,
  tick = false,
}: {
  label: string;
  raw: string | null | undefined;
  fallback: string;
  copyable?: boolean;
  tick?: boolean;
}) {
  const { t } = useTranslation("cellular");
  const compressed = raw ? compressIPv6(raw) : "";
  const hasValue = !!raw && compressed !== "-";
  const showTooltip = hasValue && compressed !== raw;

  const valueClass = cn(
    ROW_VALUE,
    "min-w-0 break-all text-right font-mono tabular-nums",
  );

  let valueNode: React.ReactNode;
  if (!hasValue) {
    valueNode = <Value value={null} fallback={fallback} />;
  } else if (showTooltip) {
    valueNode = (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={t("radio_info.a11y.show_full_address", { label })}
            className={cn(
              valueClass,
              "cursor-help rounded-inline text-left",
              "focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-[3px]",
            )}
          >
            {compressed}
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <p className="max-w-56 break-all font-mono">{raw}</p>
        </TooltipContent>
      </Tooltip>
    );
  } else {
    valueNode = <span className={valueClass}>{compressed}</span>;
  }

  return (
    <Row label={label}>
      {tick && hasValue ? (
        <TickingValue value={raw} className="flex min-w-0 justify-end">
          {valueNode}
        </TickingValue>
      ) : (
        valueNode
      )}
      {copyable && hasValue ? <CopyButton value={raw!} label={label} /> : null}
    </Row>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <motion.div variants={staggerRowItem} className={EYEBROW_CLASS}>
      {children}
    </motion.div>
  );
}

// -----------------------------------------------------------------------------
// Skeleton — mirrors the loaded geometry exactly
// -----------------------------------------------------------------------------

function SkeletonRow({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? ROW_SHAPE_COMPACT : ROW_SHAPE}>
      <div className={ROW_LINE}>
        <Skeleton className="h-[0.8125rem] w-24 rounded-inline" />
      </div>
      <div className={ROW_LINE}>
        <Skeleton className="h-[0.8125rem] w-28 rounded-inline" />
      </div>
    </div>
  );
}

/**
 * `shape` is the group's real row sequence, not a count, so the skeleton puts
 * the eNodeB/Sector split pair at the same index the loaded card does.
 */
function SkeletonGroup({ shape }: { shape: readonly ("row" | "split")[] }) {
  return (
    <div className={GROUP_STACK}>
      <div className="px-1.5">
        <Skeleton className="h-[0.6875rem] w-24 rounded-inline" />
      </div>
      <div className={ROW_STACK}>
        {shape.map((kind, i) =>
          kind === "split" ? (
            <div key={i} className="flex gap-[0.3125rem]">
              <SkeletonRow compact />
              <SkeletonRow compact />
            </div>
          ) : (
            <SkeletonRow key={i} />
          ),
        )}
      </div>
    </div>
  );
}

function CellularInformationSkeleton({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <CardShell title={title} description={description}>
      <div className={GROUP_GRID}>
        <SkeletonGroup shape={GROUP_SHAPES.connection} />
        <SkeletonGroup shape={GROUP_SHAPES.identity} />
        <SkeletonGroup shape={GROUP_SHAPES.addressing} />
      </div>
    </CardShell>
  );
}

// -----------------------------------------------------------------------------
// Card shell — one definition, so loaded and loading states cannot diverge
// -----------------------------------------------------------------------------

function CardShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    // No border: the card already carries a tonal fill, and a hairline on top of
    // a fill is the doubled-container the migration removes.
    // `h-full` is gone with the page's height lock: this card is reference
    // material and now ends where its content ends.
    <Card className="@container/cellinfo gap-5 rounded-hero border-0 bg-surface py-[1.625rem] shadow-sm">
      <CardHeader className="gap-1 px-7">
        {/* The comp draws 22px; the product's Headline step is `text-xl` (20px)
            and 22px is not on the ramp. Fidelity to the comp is not worth a new
            product-wide type step for one card title. */}
        <CardTitle className="text-xl font-semibold">{title}</CardTitle>
        <CardDescription className="text-[0.8125rem]">
          {description}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-7">{children}</CardContent>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export function CellularInformationCard({
  data,
  isLoading,
}: CellularInformationCardProps) {
  const { t } = useTranslation("cellular");
  // Returns the prefs object directly (or null while it loads), not a query
  // envelope — `formatDistance` already treats an undefined unit as "km".
  const unitPrefs = useUnitPreferences();

  const title = t("radio_info.cellular_card.title");
  const description = t("radio_info.cellular_card.description");

  if (isLoading) {
    return (
      <CellularInformationSkeleton title={title} description={description} />
    );
  }

  const network = data?.network ?? null;
  const lte = data?.lte ?? null;
  const nr = data?.nr ?? null;

  // Which RAT owns the identity fields. SA reads the NR block and the node is a
  // gNodeB; NSA and LTE read the LTE block and the node is an eNodeB.
  const isSA = network?.type === "5G-SA";
  const cellId = isSA ? nr?.cell_id : lte?.cell_id;
  const tac = isSA ? nr?.tac : lte?.tac;
  // NEVER computed here. The backend pre-splits both, and the arithmetic
  // differs by RAT: LTE's 28-bit ECI splits /256 and %256, NR's 36-bit NCI
  // splits /16384 and %16384. Deriving them in the UI would silently produce
  // LTE-shaped numbers for an SA cell.
  const enodebId = isSA ? nr?.enodeb_id : lte?.enodeb_id;
  const sectorId = isSA ? nr?.sector_id : lte?.sector_id;
  const nodeLabel = isSA
    ? t("radio_info.rows.gnodeb")
    : t("radio_info.rows.enodeb");

  const unknown = t("radio_info.value.unknown");
  const notAssigned = t("radio_info.value.not_assigned");

  const ipv4Label = t("radio_info.rows.wan_ipv4");
  const ipv6Label = t("radio_info.rows.wan_ipv6");

  // How long THIS attach has been up — not device uptime. A link that has been
  // up four minutes on a modem that has been up four days is the single most
  // useful thing this card can say about an intermittent connection, and the
  // poller has been reporting it all along with nobody reading it here.
  const connUptime = data?.device?.conn_uptime_seconds ?? 0;

  // Which address family actually carried the last successful probe. `ipv6`
  // means the IPv4 leg failed and the fallback took over — a real finding on a
  // page two rows below "WAN IPv4", and invisible until now.
  const lastFamily = data?.connectivity?.last_family ?? null;

  // Timing-advance distance. Same RAT branch as the identity rows above, so the
  // estimate always describes the cell whose ID is printed beside it. The value
  // is DERIVED — TA is quantised in ~78m steps on LTE — so it carries the same
  // focusable marker the inferred-SCS field uses rather than being printed as
  // though the modem measured it.
  const distanceKm = isSA
    ? calculateNrDistance(nr?.ta ?? null)
    : calculateLteDistance(lte?.ta ?? null);
  const distance =
    distanceKm === null
      ? null
      : formatDistance(distanceKm, unitPrefs?.distanceUnit);

  return (
    <CardShell title={title} description={description}>
      {/* One group per card body: the tick cascade must be scoped to the values
          a user perceives together, never to a page. */}
      <TickGroup>
        <motion.div
          className={GROUP_GRID}
          initial="hidden"
          animate="visible"
          variants={staggerRows}
        >
          {/* ── CONNECTION ─────────────────────────────────────────────── */}
          <div className={GROUP_STACK}>
            <Eyebrow>{t("radio_info.groups.connection")}</Eyebrow>
            <div className={ROW_STACK}>
              <Row label={t("radio_info.rows.operator")}>
                {network?.carrier ? (
                  <TickingValue value={network.carrier} className={ROW_VALUE}>
                    {network.carrier}
                  </TickingValue>
                ) : (
                  <Value value={null} fallback={unknown} />
                )}
              </Row>

              <Row label={t("radio_info.rows.apn")}>
                <Value value={network?.apn} fallback={notAssigned} mono />
                <Link
                  href="/cellular/settings/apn-management"
                  className="text-xs font-semibold text-primary underline-offset-2 hover:underline"
                >
                  {t("radio_info.actions.edit_apn")}
                </Link>
              </Row>

              {/* `Network type` and `Carrier aggregation` used to sit here.
                  Both restated a summary tile on the same screen, so they were
                  deleted rather than moved — see the file header. */}

              <Row label={t("radio_info.rows.link_uptime")}>
                {connUptime > 0 ? (
                  <TickingValue
                    value={formatUptime(connUptime)}
                    className={cn(ROW_VALUE, "tabular-nums")}
                  >
                    {formatUptime(connUptime)}
                  </TickingValue>
                ) : (
                  <Value value={null} fallback={unknown} />
                )}
              </Row>

              <Row label={t("radio_info.rows.traffic_family")}>
                {lastFamily === null ? (
                  <Value value={null} fallback={unknown} />
                ) : (
                  <SwapLabel swapKey={lastFamily} className={ROW_VALUE}>
                    {t(`radio_info.value.family_${lastFamily}`)}
                  </SwapLabel>
                )}
              </Row>
            </div>
          </div>

          {/* ── CELL IDENTITY ──────────────────────────────────────────── */}
          <div className={GROUP_STACK}>
            <Eyebrow>{t("radio_info.groups.cell_identity")}</Eyebrow>
            <div className={ROW_STACK}>
              <Row label={t("radio_info.rows.cell_id")}>
                <Value value={cellId} fallback={unknown} mono />
              </Row>

              <motion.div
                variants={staggerRowItem}
                className="flex gap-[0.3125rem]"
              >
                <div className={ROW_SHAPE_COMPACT}>
                  <span className={cn(ROW_LABEL, "shrink-0")}>
                    {nodeLabel}
                  </span>
                  <Value value={enodebId} fallback={unknown} mono />
                </div>
                <div className={ROW_SHAPE_COMPACT}>
                  <span className={cn(ROW_LABEL, "shrink-0")}>
                    {t("radio_info.rows.sector")}
                  </span>
                  <Value value={sectorId} fallback={unknown} mono />
                </div>
              </motion.div>

              <Row label={t("radio_info.rows.tac")}>
                <Value value={tac} fallback={unknown} mono />
                {tac != null ? (
                  <span className="rounded-pill bg-surface-container-high px-2.5 py-[0.1875rem] font-mono text-xs font-semibold text-on-surface-variant">
                    0x{decToHex(tac)}
                  </span>
                ) : null}
              </Row>

              <Row label={t("radio_info.rows.distance")}>
                {distance === null ? (
                  <Value value={null} fallback={unknown} />
                ) : (
                  <>
                    {/* The marker is FIRST and focusable, so the caveat is read
                        before the number rather than after it, and is reachable
                        by keyboard. Same construction as the derived-SCS field
                        on the spectrum card — one pattern for "this is our
                        arithmetic, not the modem's reading". */}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex shrink-0 items-center gap-1 rounded-pill text-on-surface-variant outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                        >
                          <span className="text-xs font-semibold tracking-wide uppercase">
                            {t("radio_info.value.estimated")}
                          </span>
                          <MaterialSymbol name="help" size={14} />
                          <span className="sr-only">
                            {t("radio_info.value.distance_hint")}
                          </span>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-64">
                        {t("radio_info.value.distance_hint")}
                      </TooltipContent>
                    </Tooltip>
                    <TickingValue
                      value={distance}
                      className={cn(ROW_VALUE, "tabular-nums")}
                    >
                      {distance}
                    </TickingValue>
                  </>
                )}
              </Row>
            </div>
          </div>

          {/* ── ADDRESSING ─────────────────────────────────────────────── */}
          <div className={GROUP_STACK}>
            <Eyebrow>{t("radio_info.groups.addressing")}</Eyebrow>
            <div className={ROW_STACK}>
              <AddressRow
                label={ipv4Label}
                raw={network?.wan_ipv4}
                fallback={notAssigned}
                copyable
                tick
              />
              {/* Empty on carriers that issue no v6 — the live test SIM is one.
                  It reports "not assigned" rather than a dash, because absence
                  is the answer here, not a missing reading. */}
              <AddressRow
                label={ipv6Label}
                raw={network?.wan_ipv6}
                fallback={notAssigned}
                copyable
                tick
              />
              <AddressRow
                label={t("radio_info.rows.primary_dns")}
                raw={network?.primary_dns}
                fallback={unknown}
              />
              <AddressRow
                label={t("radio_info.rows.secondary_dns")}
                raw={network?.secondary_dns}
                fallback={unknown}
              />
            </div>
          </div>
        </motion.div>
      </TickGroup>
    </CardShell>
  );
}

// -----------------------------------------------------------------------------
// Retired formatters
// -----------------------------------------------------------------------------
// `formatNetworkType` and `formatCarrierAggregation` lived here and are gone
// with the two rows that consumed them. The CA formatter carried a long note
// about why its counts had to come from `summariseRadio` rather than
// `ca_count` / `nr_ca_count` — that argument now survives where it is still
// load-bearing, on `summariseRadio` itself in `lib/radio-info.ts` and on the
// carrier tile in `summary-tiles.tsx`. Their i18n keys
// (`radio_info.rows.network_type`, `radio_info.rows.carrier_aggregation`,
// `radio_info.ca.*`) are left in the locale files: `network_type.*` is still
// read by the tiles, and pruning the rest across five locales is churn with no
// user-visible effect.

export default CellularInformationCard;
