"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { motion } from "motion/react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import ConditionScreen from "@/components/cellular/condition-screen";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { useSaveFlash } from "@/components/ui/save-button";
import { Skeleton } from "@/components/ui/skeleton";
import { useModemStatus } from "@/hooks/use-modem-status";
import type { ApplyPhase } from "@/hooks/use-cellular-settings";
import { authFetch } from "@/lib/auth-fetch";
import { SORTABLE_TRANSITION, staggerRowItem, staggerRows } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { NetworkType } from "@/types/modem-status";

import PendingSaveBar from "../pending-save-bar";
import {
  BADGE_GLYPH_SIZE,
  CARD_PAD,
  CARD_SHELL,
  RANK_PILL,
  RAT_RANK_TONE,
  REORDER_ROW,
  ROW_GROUP,
} from "../shapes";

// =============================================================================
// Network Priority — the RAT acquisition order
// =============================================================================
// One writable value: `AT+QNWPREFCFG="rat_acq_order"`, a colon-joined list where
// index 0 is the technology the modem tries first. The order string is the
// contract in both directions — `ids.join(":")` on write, `split(":")` on read.
//
// WHAT CHANGED, AND WHY
//
// 1. THE RANK PILL WEARS THE RADIO FAMILY'S HUE, and WCDMA wears a neutral.
//    The shipped card carried a `RAT_COLORS` map painting LTE `bg-success` and
//    WCDMA `bg-destructive` — a healthy 4G row rendered green-for-good and a
//    working 3G fallback rendered red-for-broken, purely as identity. That
//    spends the functional roles on identity, which is what The Functional-Color
//    Promise forbids: a user who learned red means failure on the dashboard
//    found it meaning "3G" here. The map is gone; `RAT_RANK_TONE` replaces it.
//    The coloured RAT icon tile went with it — the rank pill plus the name
//    already carry the row.
//
// 2. DIRTY TRACKING EXISTS NOW. There was none: Save was disabled only when the
//    list was empty, Discard was always live, and a no-op save was caught AFTER
//    the round trip with `toast.info("No changes to save")` — the UI could not
//    tell you whether you had changed anything, so it waited for you to ask and
//    then said no. The order is now diffed against `fetchedOrder` and the save
//    bar only exists while that diff is non-empty.
//
//    A reorder is ONE change, not N. The user is staging a single write of a
//    single AT parameter, so an adjacent swap is "1 change pending" rather than
//    the two-rows-moved count a positional diff would report.
//
// 3. A GET FAILURE IS VISIBLE. It used to land in a bare `catch {}` commented
//    "silently fail — keep current state", leaving a permanently blank card with
//    no message and no retry — indistinguishable from a modem that genuinely
//    reported no technologies. Both conditions now REPLACE the card body, with
//    different tones and different glyphs.
//
// 4. THE DRAG SHADOW WORKS. The old one was `hsl(var(--foreground) / 0.12)` —
//    an `hsl()` wrapper around an OKLCH token, which resolves to nothing at all.
//    `REORDER_ROW.DRAGGING` is the real treatment.
//
// KEYBOARD REORDER IS A FIRST-CLASS PATH. The `KeyboardSensor` now carries
// `sortableKeyboardCoordinates` (without it the sensor is wired but cannot
// compute a drop target), the handle is a real focusable `<button>` with an
// `sr-only` label naming the row and its position, and `REORDER_ROW.HANDLE`
// carries the focus ring. A rank list reorderable only by pointer is unusable to
// exactly the technician most likely to be on a tablet with a keyboard case.
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/cellular/network_priority.sh";

/**
 * How long the modem spends off the network after a `rat_acq_order` write.
 * The order takes effect on the next registration, so the radio drops and
 * re-attaches; the client waits it out before reading the value back.
 */
const RECOVERY_WAIT_MS = 3000;

const K = "core_settings.network_priority";

/** `"NR5G:LTE:WCDMA"` -> `["NR5G", "LTE", "WCDMA"]`. */
function orderToIds(order: string): string[] {
  return order
    .split(":")
    .map((rat) => rat.trim())
    .filter((rat) => rat.length > 0);
}

/**
 * Which rows the modem is actually using right now, from the poller's serving
 * access technology.
 *
 * EN-DC (`5G-NSA`) marks BOTH legs, and that is the honest answer rather than a
 * rounding: in non-standalone 5G the LTE anchor carries the registration while
 * the NR leg carries data, so claiming only one of them is serving would be
 * false either way round. `""` marks nothing — the poller emits it for "could
 * not determine", and it is explicitly NOT a synonym for LTE.
 */
function servingIds(type: NetworkType): ReadonlySet<string> {
  switch (type) {
    case "LTE":
      return new Set(["LTE"]);
    case "5G-SA":
      return new Set(["NR5G"]);
    case "5G-NSA":
      return new Set(["NR5G", "LTE"]);
    default:
      return new Set();
  }
}

// -----------------------------------------------------------------------------
// One draggable priority row
// -----------------------------------------------------------------------------

interface PriorityRowProps {
  id: string;
  /** 1-based, as shown. */
  rank: number;
  total: number;
  serving: boolean;
  disabled: boolean;
}

function PriorityRow({ id, rank, total, serving, disabled }: PriorityRowProps) {
  const { t } = useTranslation("cellular");
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id,
    disabled,
    // Without this, `useSortable` defaults to `transform 200ms ease` and writes
    // it straight into `style.transition` below — an authored duration off the
    // scale on a curve outside the three-curve vocabulary. The token does the
    // ms/CSS-string conversion once; see `SORTABLE_TRANSITION` in lib/motion.
    transition: SORTABLE_TRANSITION,
  });

  // A row's consequence is a function of its POSITION, not of its technology —
  // which is the whole point of the surface. It re-reads as the user drags,
  // so the sentence explaining "tried first" follows whichever row is first.
  const position =
    total === 1 ? "only" : rank === 1 ? "first" : rank === total ? "last" : "middle";

  const name = t(`${K}.rats.${id}`, { defaultValue: id });
  // Only WCDMA carries one, and it is a fact about the technology rather than
  // about its rank, so it is a second sentence rather than a rewritten first.
  const hint = t(`${K}.hints.${id}`, { defaultValue: "" });
  const consequence = [t(`${K}.position.${position}`), hint]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(REORDER_ROW.ROOT, isDragging && REORDER_ROW.DRAGGING)}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        disabled={disabled}
        // `touch-none` is required by the TouchSensor: without it the browser
        // claims the gesture as a scroll and the drag never starts on a tablet.
        // It is a gesture-routing concern, so it lives here rather than in the
        // shape contract — the coarse-pointer touch-floor bump does not, and
        // now ships inside `REORDER_ROW.HANDLE`.
        className={cn(
          REORDER_ROW.HANDLE,
          "touch-none disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        <MaterialSymbol name="drag_indicator" size={REORDER_ROW.HANDLE_GLYPH} />
        <span className="sr-only">
          {t(`${K}.handle_aria`, { name, rank, total })}
        </span>
      </button>

      {/* The numeral is decorative to a screen reader — the handle's label
          already states the position, and announcing a bare "2" beside it would
          double up. `tabular-nums` in font-sans, not mono: it changes while the
          user drags it, which is the interface voice. */}
      <span
        aria-hidden="true"
        className={cn(RANK_PILL.ROOT, RAT_RANK_TONE[id] ?? RANK_PILL.NEUTRAL)}
      >
        {rank}
      </span>

      <div className={REORDER_ROW.TEXT}>
        <span className={REORDER_ROW.LABEL}>{name}</span>
        <span className={REORDER_ROW.CONSEQUENCE}>{consequence}</span>
      </div>

      {serving ? (
        <div className={REORDER_ROW.META}>
          {/* `success`, not the LTE violet the comp drew. Violet is the LTE
              IDENTITY and must never be read as "healthy" — and this chip is
              exactly a healthy/active state, so it takes the functional role.
              (DESIGN.md > The Identity-Never-Acts Rule.) */}
          <Badge variant="success">
            <MaterialSymbol name="check_circle" size={BADGE_GLYPH_SIZE} />
            {t(`${K}.serving_now`)}
          </Badge>
        </div>
      ) : null}
    </div>
  );
}

// -----------------------------------------------------------------------------
// The card
// -----------------------------------------------------------------------------

const NetworkPriorityCard = () => {
  const { t } = useTranslation("cellular");
  const { t: tCommon } = useTranslation("common");
  const { saved, markSaved } = useSaveFlash();
  const { data: status } = useModemStatus();

  const [networks, setNetworks] = React.useState<string[]>([]);
  const [fetchedOrder, setFetchedOrder] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [applyPhase, setApplyPhase] = React.useState<ApplyPhase>("idle");
  const [hasError, setHasError] = React.useState(false);

  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // --- Read ------------------------------------------------------------------
  // `silent` is the post-save read-back. It must never surface an error: a
  // `rat_acq_order` write drops the link while the modem re-registers, so a
  // failed read there means "still coming back", not "the card is broken".

  const fetchOrder = React.useCallback(async (silent = false) => {
    if (!silent) {
      setIsLoading(true);
      setHasError(false);
    }

    try {
      const resp = await authFetch(CGI_ENDPOINT);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const data = await resp.json();
      if (!mountedRef.current) return;

      if (!data.success || typeof data.order !== "string") {
        throw new Error("unsuccessful");
      }

      setFetchedOrder(data.order);
      setNetworks(orderToIds(data.order));
    } catch {
      if (mountedRef.current && !silent) setHasError(true);
    } finally {
      if (mountedRef.current && !silent) setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchOrder();
  }, [fetchOrder]);

  // --- Dirty state -----------------------------------------------------------

  const currentOrder = React.useMemo(() => networks.join(":"), [networks]);
  const changeCount =
    fetchedOrder.length > 0 && currentOrder !== fetchedOrder ? 1 : 0;

  // --- Reorder ---------------------------------------------------------------

  const sensors = useSensors(
    useSensor(MouseSensor),
    useSensor(TouchSensor),
    // Without a coordinate getter the KeyboardSensor is mounted but inert — it
    // never resolves a drop target, so Space picks a row up and the arrow keys
    // do nothing.
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setNetworks((prev) => {
      const from = prev.indexOf(String(active.id));
      const to = prev.indexOf(String(over.id));
      if (from < 0 || to < 0) return prev;
      return arrayMove(prev, from, to);
    });
  };

  // --- Write -----------------------------------------------------------------

  const handleSave = async () => {
    const newOrder = networks.join(":");
    if (newOrder === fetchedOrder) return;

    setIsSaving(true);
    setApplyPhase("writing");

    try {
      const resp = await authFetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: newOrder }),
      });

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const data = await resp.json();
      if (!mountedRef.current) return;

      if (!data.success) {
        toast.error(t(`${K}.toast.save_error`), {
          description: typeof data.detail === "string" ? data.detail : undefined,
        });
        return;
      }

      // Adopt the written order as the baseline immediately, so the save bar
      // retires on the frame the write succeeded rather than waiting on a
      // read-back that happens across a re-registration.
      setFetchedOrder(newOrder);
      markSaved();
      toast.success(t(`${K}.toast.saved`));

      setApplyPhase("recovering");
      await new Promise((resolve) => setTimeout(resolve, RECOVERY_WAIT_MS));
      if (!mountedRef.current) return;

      setApplyPhase("verifying");
      await fetchOrder(true);
    } catch {
      if (mountedRef.current) toast.error(t(`${K}.toast.save_error`));
    } finally {
      if (mountedRef.current) {
        setIsSaving(false);
        setApplyPhase("idle");
      }
    }
  };

  const handleDiscard = () => {
    setNetworks(orderToIds(fetchedOrder));
  };

  // --- Render ----------------------------------------------------------------
  // The header is real in every state. The card this replaces titled its
  // skeleton and its loaded body from two different string literals, and the
  // title visibly swapped on every load.

  const header = (
    <CardHeader className={CARD_PAD}>
      <CardTitle>{t(`${K}.card.title`)}</CardTitle>
      <CardDescription>{t(`${K}.card.description`)}</CardDescription>
    </CardHeader>
  );

  if (isLoading) {
    return (
      <Card className={cn(CARD_SHELL)}>
        {header}
        <CardContent className={cn(CARD_PAD, "flex flex-col gap-4")}>
          <div className={ROW_GROUP.ROOT}>
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton
                key={index}
                className={cn(REORDER_ROW.HEIGHT, "rounded-field")}
              />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // A condition REPLACES the body. Rendering the group empty beside a live Save
  // button is the bug this page shipped with.
  if (hasError || networks.length === 0) {
    return (
      <Card className={cn(CARD_SHELL)}>
        {header}
        <CardContent className={CARD_PAD}>
          {hasError ? (
            <ConditionScreen
              tone="destructive"
              glyph="error"
              ariaRole="alert"
              title={t(`${K}.states.error.title`)}
              description={t(`${K}.states.error.description`)}
              onRetry={() => fetchOrder()}
              retryLabel={tCommon("actions.retry")}
            />
          ) : (
            // Neutral, not warning: an empty acquisition order is "we do not
            // know what this modem will try", and asserting a fault we cannot
            // see would be the actual bug.
            <ConditionScreen
              tone="neutral"
              glyph="signal_disconnected"
              ariaRole="status"
              title={t(`${K}.states.empty.title`)}
              description={t(`${K}.states.empty.description`)}
              onRetry={() => fetchOrder()}
              retryLabel={tCommon("actions.retry")}
            />
          )}
        </CardContent>
      </Card>
    );
  }

  const serving = servingIds(status?.network.type ?? "");

  return (
    <Card className={cn(CARD_SHELL)}>
      {header}

      <CardContent className={cn(CARD_PAD, "flex flex-col gap-4")}>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={networks}
            strategy={verticalListSortingStrategy}
          >
            {/* No hairline dividers between these rows, unlike the settings
                group next door: a divider belongs to the gap between two rows,
                and during a drag that gap is in motion — the rule would detach
                and float over whichever row passed under it. The rank pills
                already separate the rows. */}
            <motion.div
              className={ROW_GROUP.ROOT}
              initial="hidden"
              animate="visible"
              variants={staggerRows}
            >
              {networks.map((id, index) => (
                <motion.div key={id} variants={staggerRowItem}>
                  <PriorityRow
                    id={id}
                    rank={index + 1}
                    total={networks.length}
                    serving={serving.has(id)}
                    disabled={isSaving}
                  />
                </motion.div>
              ))}
            </motion.div>
          </SortableContext>
        </DndContext>

        <PendingSaveBar
          changeCount={changeCount}
          isSaving={isSaving}
          applyPhase={applyPhase}
          onDiscard={handleDiscard}
          onSave={handleSave}
          saved={saved}
          copy={{
            count: t(`${K}.save_bar.count`, { count: changeCount }),
            note: t(`${K}.save_bar.note`),
            discard: t(`${K}.save_bar.discard`),
            save: t(`${K}.save_bar.save`),
            // Unreachable on this surface, and deliberately not given a key of
            // its own: the write is one AT parameter, so it succeeds or fails
            // whole — there is no per-field failure list to name.
            failed: t(`${K}.save_bar.note`),
            steps: {
              writing: t(`${K}.apply.writing`),
              recovering: t(`${K}.apply.recovering`),
              verifying: t(`${K}.apply.verifying`),
            },
          }}
        />
      </CardContent>
    </Card>
  );
};

export default NetworkPriorityCard;
