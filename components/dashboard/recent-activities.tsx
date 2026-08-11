"use client";

import * as React from "react";
import { motion, type Variants } from "motion/react";
import { useTranslation } from "react-i18next";

import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  MaterialSymbol,
  type MaterialSymbolName,
} from "@/components/ui/material-symbol";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { SwapLabel } from "@/components/ui/swap-label";
import { useRecentActivities } from "@/hooks/use-recent-activities";
import {
  computeUnresolved,
  eventKey,
  isFresh,
  presentEvent,
  type EventGlyph,
  type EventPresentation,
} from "@/lib/event-presentation";
import {
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
// Two jobs. The first is the transcript: what the radio did, newest first. The
// second is the verdict: is anything on that list still wrong.
//
// The rows answer the first question and the header chip answers the second,
// and they are allowed to disagree. A recovered failure from ten minutes ago
// still shows a red row, because it did happen and it is recent, while the chip
// reads "All clear", because it is over. That pair reads as a story rather than
// a contradiction: the recovery sits directly above the failure it cancelled.
//
// Row weight is age, with one exception. A row is drawn in its tonal container
// for its first hour and then settles onto the plain surface keeping only its
// coloured icon disc, EXCEPT when the condition it reports is still unresolved,
// in which case it stays lit however old it is. Age retires history; it does not
// retire a problem. See lib/event-presentation.ts.
//
// The row anatomy is the Motion Guide's recipe 04 (Alert arrival): a filled
// circular disc in the solid role colour, the message as the primary line, and
// a machine-voice timestamp caption under it. The event-type label the earlier
// Recommended Hybrid pass drew above the message is gone by decision — the
// message already names what happened, and the disc already names its kind, so
// "Carrier Aggregation" above "NR-CA active: n78 + n41" was the row saying the
// same thing twice at two type sizes. The `activities.events.*` keys stay in
// the locale files: they are parity-clean, unreferenced here, and the natural
// home for them is the Monitoring events page, which still renders the
// untranslated EVENT_LABELS map.
// =============================================================================

// --- Row geometry ------------------------------------------------------------
// The clip height is arithmetic, not a guess, so hard-code it and show the work.
// A row is: py-[11px] (22) + message leading-5 (20) + gap-0.5 (2)
//           + caption leading-4 (16) = 60px.
// The disc is size-7 (28px), comfortably inside the 38px text column, so it
// never sets the height.
//
// 60px is the SAME total the previous anatomy came to, which is deliberate
// rather than lucky: the two lines swapped roles but kept their sizes, so the
// clip edge, LIST_MAX_H, ROW_ADVANCE and the skeleton all stay valid and this
// card does not change height against its two grid siblings.
//
// The type is text-xs / text-sm, straight off the documented ramp. The
// reference draws 12px over 10px, but the Motion Guide's demo tiles run a
// smaller scale than the dashboard mock throughout (its cards are 26px radius
// against the dashboard's 36px), so those are tile-scale figures, not a spec.
// Taking them literally would put a 10px size into the product, two steps below
// the sidebar's already-scoped 11px exception, to render the one line a user
// squints at. The ramp keeps the reference's HIERARCHY — message dominant,
// caption subordinate and in the machine voice — at sizes the product already
// owns.
//
// Line heights are still pinned rather than left implicit because this
// arithmetic has to be exact and a clip edge computed from a ratio drifts.
// leading-4 and leading-5 are the ramp's own defaults for these two sizes, so
// pinning them changes nothing visually; it just makes the sum above checkable.
const ROW_H = 60;
const ROW_GAP = 8; // gap-2
/** How far the history travels when a new head pushes it down. */
const ROW_ADVANCE = ROW_H + ROW_GAP; // 68

/** How many rows the card actually shows. Everything below derives from it, so
 *  this is the only number to change if the count moves again. */
const VISIBLE_ROWS = 5;
/** Five rows and the four gaps between them. The sixth row rendered below sits
 *  under this edge on purpose. */
const LIST_MAX_H = VISIBLE_ROWS * ROW_H + (VISIBLE_ROWS - 1) * ROW_GAP; // 332
/** The visible rows plus one that exists only to be pushed into the clip.
 *  Must stay exactly VISIBLE_ROWS + 1: with no spare row the bottom row is
 *  pulled into view at the start of the push and then vanishes at the end
 *  instead of sliding under the edge. */
const RENDER_COUNT = VISIBLE_ROWS + 1;

/** Ligature names, not components: `MaterialSymbol` takes the glyph's NAME as a
 *  prop and the font substitutes it, so the map holds strings. The closed
 *  `MaterialSymbolName` union is what keeps that honest — a name absent from the
 *  build-time subset would otherwise render as the literal word. */
const GLYPHS: Record<EventGlyph, MaterialSymbolName> = {
  success: "check_circle",
  warning: "warning",
  error: "cancel",
  handoff: "swap_horiz",
  // A SIM is a chip. A credit-card glyph on a modem dashboard reads as billing.
  // `memory` is Material's chip glyph, so the reasoning carries over intact.
  sim: "memory",
  radio: "cell_tower",
  profile: "badge",
  neutral: "info",
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

/**
 * How often the card re-reads the wall clock, independent of the data fetch.
 *
 * Both the "12 min ago" label and the freshness gate are functions of time
 * rather than of the payload, so they cannot be left to re-evaluate only when a
 * poll succeeds. The hook's error path calls `setError` and deliberately never
 * calls `setEvents` (use-recent-activities.ts:85-90), and on a sustained
 * failure the message string is identical every time, so React bails out of the
 * re-render entirely. Without this ticker the card would go on rendering its
 * stale list with a frozen age classification: rows asserting "just now" about
 * data that has not refreshed in an hour. That is the Saved-State Honesty Rule
 * failure the header chip is already careful to avoid.
 *
 * 30s rather than the 10s poll: nothing here changes faster than a minute, and
 * an idle dashboard should not wake up three times as often as it needs to.
 */
const CLOCK_TICK_MS = 30_000;

/** Unix-seconds now, refreshed on its own clock. */
function useNowSec(): number {
  const [now, setNow] = React.useState(() => Math.floor(Date.now() / 1000));
  React.useEffect(() => {
    const id = setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      CLOCK_TICK_MS,
    );
    return () => clearInterval(id);
  }, []);
  return now;
}

/** Locale-aware relative time.
 *
 *  Deliberately local rather than a change to `formatTimeAgo` in
 *  types/modem-status.ts: that helper has three live call sites in the watchdog
 *  cards and returns a hard-coded English string by design. The thresholds here
 *  mirror it exactly so the two never disagree about when "1h ago" starts.
 *
 *  `now` is passed in rather than read here so that this and the freshness gate
 *  are computed from ONE clock reading. Two `Date.now()` calls in one render
 *  can straddle the hour boundary and print "1h ago" on a row still drawn as
 *  fresh. */
function useTimeAgo() {
  const { t } = useTranslation("dashboard");
  return React.useCallback(
    (timestamp: number, nowSec: number): string => {
      // The modem writes the timestamp with its own `date +%s` and the browser
      // supplies `now`, so this subtracts two different machines' clocks. On a
      // device whose RTC is unset and which runs neither NTP nor NITZ, that can
      // legitimately come out negative. types/modem-status.ts:769 carries the
      // same clamp, and this one used to claim it mirrored those thresholds
      // "exactly" while missing precisely this branch.
      const diff = Math.max(0, nowSec - timestamp);
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
  timeAgo: string;
  severityWord: string;
}

function EventRow({
  event,
  presentation,
  timeAgo,
  severityWord,
}: EventRowProps) {
  const glyphName = GLYPHS[presentation.glyph];
  // Fill tracks the DISC, not the row's age. `presentEvent` splits its disc on
  // exactly this predicate — a solid role colour for the three chromatic tones,
  // a surface step for routine — so the glyph inherits the same discriminator:
  // solid disc gets the filled axis, the recessed routine well gets the outline
  // weight the reference draws on its handoff row. Keying on `tone` rather than
  // on freshness is what keeps an aged warning's full-strength amber disc
  // carrying a filled glyph, matching `DISC_FILL`, which never expires either.
  const glyphFilled = presentation.tone !== "routine";

  return (
    <div
      className={cn(
        // items-center, not items-start: the disc is a self-contained object
        // rather than a mark that belongs to the first line, so it centres
        // against the whole text column. At items-start it reads as a bullet.
        "flex items-center gap-3 rounded-tile px-3.5 py-[11px]",
        // The settle from tonal to neutral is the only thing on this card that
        // happens without the user or the radio doing anything, so it gets the
        // everyday curve and no more. It must read as a row going quiet, never
        // as an event arriving.
        "transition-colors duration-(--duration-standard) ease-standard",
        presentation.containerClass,
      )}
    >
      {/* Recipe 04's icon disc. The disc carries both the fill and the glyph
          ink as one paired decision from `discClass`, so this element never
          picks a colour of its own — and unlike the container, the disc does
          not expire, which is what lets an aged row stay legible by KIND after
          it has gone quiet by weight. 16px glyph in a 28px disc holds the
          reference's 0.58 ratio on values the spacing scale already owns. */}
      <span
        aria-hidden
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-full",
          "transition-colors duration-(--duration-standard) ease-standard",
          presentation.discClass,
        )}
      >
        <MaterialSymbol name={glyphName} size={16} filled={glyphFilled} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {/* Tone is carried visually by the disc and the fill, and a screen
            reader can see neither a shape nor a background. Dark-mode
            success-container and destructive-container measure about 1.00:1
            apart, so this is not a nicety even for sighted users on the
            colour channel alone. Spoken first, before the message. */}
        <span className="sr-only">{severityWord}</span>
        <span
          className={cn(
            "truncate text-sm leading-5 font-medium",
            presentation.messageClass,
          )}
        >
          {event.message}
        </span>
        {/* The machine voice, per the reference. A modem-written relative time
            sits at the edge of the Machine-Voice Rule — it is device-clock
            output, but "2 min ago" is also prose — and it is spent here
            because it is the cheapest way to make the caption unmistakably a
            different KIND of line from the message above it without another
            colour or another size step. */}
        <span
          className={cn(
            "text-xs leading-4 tabular-nums",
            presentation.metaClass,
          )}
        >
          {timeAgo}
        </span>
      </div>
    </div>
  );
}

// --- Card shell --------------------------------------------------------------

const CARD_SHELL =
  "@container/card h-full gap-4 rounded-card border-0 px-6 py-6 shadow-[var(--shadow-whisper)]";

/** Skeleton rows are the EXACT height of a real row, and there are exactly as
 *  many as the list will show, so the skeleton-to-data handoff moves nothing on
 *  the page.
 *
 *  The count is derived from VISIBLE_ROWS rather than written out, because as a
 *  literal it silently outlived a change to the row count once already: a
 *  six-row skeleton handing off to a five-row list drops the card 68px and
 *  drags every grid sibling below it up with it. */
function ActivitiesSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: VISIBLE_ROWS }).map((_, i) => (
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
  // ONE clock reading per render, shared by the label and the freshness gate,
  // so a row can never print "1h ago" while still being drawn as fresh.
  const nowSec = useNowSec();

  // Computed over the FULL array, never the sliced five: a recovery that has
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
  const chipGlyph: MaterialSymbolName =
    chipTone === "quiet"
      ? "check_circle"
      : chipTone === "error"
        ? "cancel"
        : "warning";

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
          glyph and label crossfade over `quick` through `SwapLabel`. Keyed on
          what the chip SAYS, not on its variant. Two different unresolved
          counts share the amber fill but are not the same statement.

          This was a keyed `motion.span` with an `initial`/`animate` pair and NO
          `AnimatePresence` around it — the exact half-a-crossfade `SwapLabel`
          was extracted to fix. React drops the outgoing node in a single
          commit, so only the incoming label ever animated and the old one
          blinked out in one frame; there was no `exit` leg for it to run, and
          the travel was 4px rather than the recipe's 7px. */}
      <SwapLabel swapKey={`${chipTone}-${unresolvedCount}`} className="gap-1">
        {/* Explicit `size={12}`, doubly required: Badge's base sizes `[&>svg]`,
            a DIRECT child, and the crossfade wrapper puts the glyph a level
            deeper than that selector reaches — and MaterialSymbol carries its
            size as an inline fontSize, which no class utility can override.
            Filled to match the chip's own solid-tone reading. */}
        <MaterialSymbol name={chipGlyph} size={12} filled />
        {chipTone === "quiet"
          ? t("activities.chip.quiet")
          : t("activities.chip.unresolved", { count: unresolvedCount })}
      </SwapLabel>
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
                {/* Explicit 24px: `empty.tsx`'s icon variant sizes `svg` with a
                    class, which cannot reach an inline fontSize. */}
                <MaterialSymbol name="event_busy" size={24} />
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
    const presentation = presentEvent(
      event,
      unresolved.has(absoluteIndex),
      isFresh(event, nowSec),
    );
    return (
      <EventRow
        event={event}
        presentation={presentation}
        timeAgo={timeAgo(event.timestamp, nowSec)}
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
            the sixth row exists purely to carry row five under this edge
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
              // cascade as its item 0, or it pops in while the rows under
              // it rise. Same shape and curve as `staggerRowItem`.
              //
              // "100%" of the row's own width, i.e. the row genuinely enters
              // from off the trailing edge, which is what the reference draws
              // and what the recipe is named for. An earlier pass used a 24px
              // nudge: safe, and wrong. At 24px the row does not arrive from
              // anywhere, it just twitches, and this is the one moment on the
              // dashboard that is allowed to be felt before it is read. The
              // clip below is `overflow-hidden` on both axes, so the offscreen
              // half never widens the card. Percent rather than pixels so it
              // stays a full entrance at every breakpoint.
              initial={
                hasArrival ? { opacity: 0, x: "100%" } : { opacity: 0, y: 5 }
              }
              animate={{ opacity: 1, x: 0, y: 0 }}
              transition={hasArrival ? transitionEmphasized : transitionStandard}
            >
              {renderRow(visible[0], 0)}
            </motion.div>

            {/* ── History ──
                The second and last animation: ONE transform on the whole
                group. Five per-row FLIP projections via `layout` would be five
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
