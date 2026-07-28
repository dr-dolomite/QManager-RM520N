"use client";

import * as React from "react";
import { motion, type Variants } from "motion/react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeftRightIcon,
  CalendarX2Icon,
  CheckCircle2Icon,
  IdCardIcon,
  InfoIcon,
  MicrochipIcon,
  RadioTowerIcon,
  TriangleAlertIcon,
  XCircleIcon,
  type LucideIcon,
} from "lucide-react";

import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useRecentActivities } from "@/hooks/use-recent-activities";
import { EVENT_LABELS } from "@/constants/network-events";
import {
  computeUnresolved,
  eventKey,
  presentEvent,
  type EventGlyph,
  type EventPresentation,
} from "@/lib/event-presentation";
import {
  DUR,
  EASE_QUICK,
  STAGGER_STEP_ROWS,
  staggerRowItem,
  transitionEmphasized,
  transitionStandard,
} from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { NetworkEvent } from "@/types/modem-status";

// =============================================================================
// Recent Activities: the dashboard's event log.
// =============================================================================
// Two jobs, and the second one is the reason the card was rewritten. The first
// is the transcript: what the radio did, newest first. The second is the
// verdict: is anything on that list still wrong. Only the still-wrong rows wear
// a tonal container, so the card answers "am I fine" from across the room and
// only then invites reading. See lib/event-presentation.ts for the pairing that
// decides which rows those are.
// =============================================================================

// --- Row geometry ------------------------------------------------------------
// The clip height is arithmetic, not a guess, so hard-code it and show the work.
// A row is: py-[11px] (22) + label leading-4 (16) + gap-0.5 (2)
//           + message leading-5 (20) = 60px.
// The glyph is size-5 (20px), comfortably inside the 38px text column, so it
// never sets the height.
//
// The type is text-xs / text-sm, straight off the documented ramp. An earlier
// pass used 11px and 13px, which buy 4px per row and keep this card flush with
// its two grid siblings, and DESIGN.md does name both sizes. But it names them
// as surface-scoped exceptions (11px is the sidebar's uppercase section label,
// 13px is one of the SIM-swap banner's own two steps), so spending them here
// would have extended a scoped exception to a third surface for 24px of
// height. Not worth a standing waiver.
//
// Line heights are still pinned rather than left implicit because this
// arithmetic has to be exact and a clip edge computed from a ratio drifts.
// leading-4 and leading-5 are the ramp's own defaults for these two sizes, so
// pinning them changes nothing visually; it just makes the sum above checkable.
const ROW_H = 60;
const ROW_GAP = 8; // gap-2
/** How far the history travels when a new head pushes it down. */
const ROW_ADVANCE = ROW_H + ROW_GAP; // 68
/** Six rows and the five gaps between them. The seventh row rendered below
 *  sits under this edge on purpose. */
const LIST_MAX_H = 6 * ROW_H + 5 * ROW_GAP; // 400
/** Six visible plus one that exists only to be pushed into the clip. */
const RENDER_COUNT = 7;

const GLYPHS: Record<EventGlyph, LucideIcon> = {
  success: CheckCircle2Icon,
  warning: TriangleAlertIcon,
  error: XCircleIcon,
  handoff: ArrowLeftRightIcon,
  // A SIM is a chip. A credit-card glyph on a modem dashboard reads as billing.
  sim: MicrochipIcon,
  radio: RadioTowerIcon,
  profile: IdCardIcon,
  neutral: InfoIcon,
};

/**
 * The history group carries BOTH the push and the mount cascade, because a
 * motion child that declares its own `initial`/`animate` object stops variant
 * propagation dead, so the push cannot be a wrapper around the cascade, it has
 * to be the same element.
 *
 * Three named states rather than two: "settled" is the mount entry point (no
 * push, children cascade in) and "pushed" is the arrival entry point (group
 * starts one row high, children do NOT cascade because they define no "pushed"
 * variant and so simply sit at rest). One element, two lifecycles, and they
 * never fire at the same time.
 */
const historyGroup: Variants = {
  settled: { y: 0 },
  pushed: { y: -ROW_ADVANCE },
  visible: {
    y: 0,
    transition: {
      ...transitionEmphasized,
      staggerChildren: STAGGER_STEP_ROWS,
      // The head row is item 0 of the mount cascade but lives outside this
      // group, so the group's children start one step late to keep the
      // rhythm even. Without it the head and the second row arrive together.
      delayChildren: STAGGER_STEP_ROWS,
    },
  },
};

/** Locale-aware relative time.
 *
 *  Deliberately local rather than a change to `formatTimeAgo` in
 *  types/modem-status.ts: that helper has three live call sites in the watchdog
 *  cards and returns a hard-coded English string by design. The thresholds here
 *  mirror it exactly so the two never disagree about when "1h ago" starts. */
function useTimeAgo() {
  const { t } = useTranslation("dashboard");
  return React.useCallback(
    (timestamp: number): string => {
      const diff = Math.floor(Date.now() / 1000) - timestamp;
      if (diff < 60) return t("activities.time.just_now");
      if (diff < 3600)
        return t("activities.time.minutes", { count: Math.floor(diff / 60) });
      if (diff < 86400)
        return t("activities.time.hours", { count: Math.floor(diff / 3600) });
      return t("activities.time.days", { count: Math.floor(diff / 86400) });
    },
    [t],
  );
}

// --- Row ---------------------------------------------------------------------

interface EventRowProps {
  event: NetworkEvent;
  presentation: EventPresentation;
  label: string;
  timeAgo: string;
  severityWord: string;
}

function EventRow({
  event,
  presentation,
  label,
  timeAgo,
  severityWord,
}: EventRowProps) {
  const Glyph = GLYPHS[presentation.glyph];
  const unresolvedError = presentation.unresolved && event.severity === "error";

  return (
    <div
      className={cn(
        "flex items-start gap-[11px] rounded-tile px-3.5 py-[11px]",
        "transition-colors duration-(--duration-standard) ease-standard",
        presentation.unresolved
          ? unresolvedError
            ? "bg-destructive-container text-on-destructive-container"
            : "bg-warning-container text-on-warning-container"
          : "bg-surface-container",
      )}
    >
      {/* An unresolved row drops the per-glyph ink and inherits the
          container's `on-` colour: the fill has already said "this is a
          problem", and a second, differently-toned voice inside it would read
          as two statements rather than one. */}
      <Glyph
        aria-hidden
        className={cn(
          "size-5 shrink-0",
          !presentation.unresolved && presentation.glyphTone,
        )}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {/* The severity is carried visually by the glyph alone. Dark-mode
            success-container and destructive-container are near-equiluminant,
            and the glyph is a shape a screen reader cannot see. So it is
            spoken here, first, before the label. */}
        <span className="sr-only">{severityWord}</span>
        <span
          className={cn(
            "text-xs leading-4 font-medium",
            !presentation.unresolved && "text-on-surface-variant",
          )}
        >
          {label} · {timeAgo}
        </span>
        <span
          className={cn(
            "text-sm leading-5 font-medium",
            !presentation.unresolved && "text-on-surface",
          )}
        >
          {event.message}
        </span>
      </div>
    </div>
  );
}

// --- Card shell --------------------------------------------------------------

const CARD_SHELL =
  "@container/card h-full gap-4 rounded-card border-0 px-6 py-6 shadow-[var(--shadow-whisper)]";

/** Skeleton rows are the EXACT height of a real row, so the skeleton-to-data
 *  handoff moves nothing on the page. */
function ActivitiesSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton
          key={i}
          className="rounded-tile"
          style={{ height: ROW_H }}
        />
      ))}
    </div>
  );
}

// --- Main --------------------------------------------------------------------

const RecentActivitiesComponent = () => {
  const { t } = useTranslation("dashboard");
  const { events, isLoading, error } = useRecentActivities();
  const timeAgo = useTimeAgo();

  // Computed over the FULL array, never the sliced six: a recovery that has
  // already scrolled past the clip edge still resolves the failure below it.
  const unresolved = React.useMemo(() => computeUnresolved(events), [events]);

  const unresolvedCount = unresolved.size;
  const worstIsError = React.useMemo(() => {
    for (const i of unresolved) {
      if (events[i]?.severity === "error") return true;
    }
    return false;
  }, [unresolved, events]);

  // "Genuinely new head" is read off a ref committed AFTER render, so a render
  // React throws away can never arm the arrival animation. Same discipline as
  // the carrier-aggregation release clock.
  const head = events[0];
  const headKey = head ? eventKey(head) : null;
  const previousHeadKey = React.useRef<string | null>(null);
  const hasArrival =
    previousHeadKey.current !== null &&
    headKey !== null &&
    headKey !== previousHeadKey.current;

  React.useEffect(() => {
    previousHeadKey.current = headKey;
  });

  const chipTone = unresolvedCount === 0 ? "quiet" : worstIsError ? "error" : "warning";
  const ChipGlyph =
    chipTone === "quiet"
      ? CheckCircle2Icon
      : chipTone === "error"
        ? XCircleIcon
        : TriangleAlertIcon;

  // The chip reports a verdict, so it may only appear once there is something
  // to have a verdict ABOUT. Rendering it while loading or while the fetch is
  // failing would announce "All clear" on the strength of an empty array, which
  // is the Saved-State Honesty Rule's exact failure case: a surface claiming a
  // state the device never reported. Loading gets a skeleton at the chip's own
  // geometry so the header does not reflow; the error path gets nothing,
  // because the alert below is already saying the true thing.
  const renderHeader = (action: React.ReactNode) => (
    <CardHeader className="px-0">
      <CardTitle className="text-lg font-semibold">
        {t("activities.title")}
      </CardTitle>
      {action ? <CardAction>{action}</CardAction> : null}
    </CardHeader>
  );

  const chip = (
    <Badge
      variant={
        chipTone === "quiet"
          ? "muted"
          : chipTone === "error"
            ? "destructive"
            : "warning"
      }
      className="px-3 py-1.5"
    >
      {/* Two clocks: the Badge's own cva morphs the fill over `standard`, the
          glyph and label crossfade over `quick` on the key below. Keyed on what
          the chip SAYS, not on its variant. Two different unresolved counts
          share the amber fill but are not the same statement. */}
      <motion.span
        key={`${chipTone}-${unresolvedCount}`}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: DUR.quick, ease: EASE_QUICK }}
        className="inline-flex items-center gap-1"
      >
        {/* Explicit `size-3`: Badge's base sizes `[&>svg]`, a DIRECT child, and
            the crossfade wrapper puts the glyph a level deeper than that
            selector reaches. */}
        <ChipGlyph className="size-3" aria-hidden />
        {chipTone === "quiet"
          ? t("activities.chip.quiet")
          : t("activities.chip.unresolved", { count: unresolvedCount })}
      </motion.span>
    </Badge>
  );

  // ── Loading ──
  // A separate returned subtree rather than a per-row ternary, so the cascade
  // parent genuinely MOUNTS at the skeleton-to-data handoff and the rows
  // arrive rather than blink.
  if (isLoading) {
    return (
      <Card className={CARD_SHELL}>
        {renderHeader(<Skeleton className="h-[26px] w-24 rounded-pill" />)}
        <CardContent className="px-0">
          <ActivitiesSkeleton />
        </CardContent>
      </Card>
    );
  }

  // ── Error with nothing to fall back on ──
  // The card used to drop the hook's error entirely, so a failed poll rendered
  // as the reassuring "No Events" empty state. Never again, and never a
  // generic message: the HTTP status is the only thing that tells the user
  // whether this is a dead service or an expired session.
  if (error && events.length === 0) {
    return (
      <Card className={CARD_SHELL}>
        {renderHeader(null)}
        <CardContent className="px-0">
          <div
            role="alert"
            className="flex flex-col gap-1 rounded-tile bg-destructive-container px-4 py-3.5 text-on-destructive-container"
          >
            <span className="text-sm font-semibold">
              {t("activities.error_title")}
            </span>
            <span className="text-sm leading-5 font-medium">
              {t("activities.error_description", { message: error })}
            </span>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Empty ──
  if (events.length === 0) {
    return (
      <Card className={CARD_SHELL}>
        {renderHeader(chip)}
        <CardContent className="px-0">
          <Empty className="h-full">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CalendarX2Icon />
              </EmptyMedia>
              <EmptyTitle>{t("activities.empty_title")}</EmptyTitle>
              <EmptyDescription className="max-w-xs text-pretty">
                {t("activities.empty_description")}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </CardContent>
      </Card>
    );
  }

  const visible = events.slice(0, RENDER_COUNT);

  const renderRow = (event: NetworkEvent, absoluteIndex: number) => {
    const presentation = presentEvent(event, unresolved.has(absoluteIndex));
    return (
      <EventRow
        event={event}
        presentation={presentation}
        label={t(`activities.events.${event.type}`, {
          defaultValue: EVENT_LABELS[event.type] ?? event.type,
        })}
        timeAgo={timeAgo(event.timestamp)}
        severityWord={t(presentation.srSeverityKey)}
      />
    );
  };

  return (
    <Card className={CARD_SHELL}>
      {renderHeader(chip)}
      <CardContent className="px-0">
        {/* A stale list beats a blank card: when we still have events, the
            error is a notice ABOVE the transcript, not a replacement for it. */}
        {error && (
          <div
            role="alert"
            className="mb-2 rounded-tile bg-destructive-container px-3.5 py-2 text-xs leading-4 font-medium text-on-destructive-container"
          >
            {t("activities.error_description", { message: error })}
          </div>
        )}

        {/* The clip. History does not retreat, it scrolls off the bottom, so
            the seventh row exists purely to carry row six under this edge
            instead of letting it vanish. */}
        <div className="overflow-hidden" style={{ maxHeight: LIST_MAX_H }}>
          <div className="flex flex-col gap-2">
            {/* ── Head row ──
                One animation: the arrival slide, on the emphasized curve. On
                first load there is no previous head, so nothing slides and the
                mount cascade below covers the whole list. */}
            <motion.div
              key={headKey ?? "head"}
              // Two entrances, never both. On arrival it is recipe 04's slide
              // from the trailing edge on the emphasized curve. On first load
              // there is no arrival, and the head still has to join the mount
              // cascade as its item 0, or it pops in while the six rows under
              // it rise. Same shape and curve as `staggerRowItem`.
              initial={hasArrival ? { opacity: 0, x: 24 } : { opacity: 0, y: 5 }}
              animate={{ opacity: 1, x: 0, y: 0 }}
              transition={hasArrival ? transitionEmphasized : transitionStandard}
            >
              {renderRow(visible[0], 0)}
            </motion.div>

            {/* ── History ──
                The second and last animation: ONE transform on the whole
                group. Six per-row FLIP projections via `layout` would be six
                concurrent animations on an ARM32 SoC rendering its own UI, and
                the budget is three. Keyed on the head so the push replays only
                when a new event actually arrived. */}
            {visible.length > 1 && (
              <motion.div
                key={`history-${headKey ?? "none"}`}
                className="flex flex-col gap-2"
                variants={historyGroup}
                initial={hasArrival ? "pushed" : "settled"}
                animate="visible"
              >
                {visible.slice(1).map((event, i) => (
                  // Children carry ONLY `variants`; the parent propagates.
                  // On the arrival path their initial state is "pushed", which
                  // they do not define, so they sit at rest and the cascade
                  // stays a mount-only event.
                  <motion.div key={eventKey(event)} variants={staggerRowItem}>
                    {renderRow(event, i + 1)}
                  </motion.div>
                ))}
              </motion.div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default RecentActivitiesComponent;
