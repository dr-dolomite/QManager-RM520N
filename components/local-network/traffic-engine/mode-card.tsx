"use client";

import * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeftRightIcon,
  CheckCircle2Icon,
  Loader2Icon,
  MinusCircleIcon,
  TriangleAlertIcon,
  VideoIcon,
  XCircleIcon,
  type LucideIcon,
} from "lucide-react";

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
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { staggerRowItem, staggerRows } from "@/lib/motion";

import {
  CARD_HEAD,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  CHIP_GLYPH,
  CHOICE_ROW,
  ENGINE_BADGE,
  SKELETON,
} from "./shapes";
import type { DpiEngineStatus, DpiMode } from "@/types/traffic-engine";

// =============================================================================
// ModeCard — the three-way bypass-mode selector
// =============================================================================
// This is Call A of the approved proposal, and it replaces both
// `engine-enable-row.tsx` and the `Tabs` that framed it.
//
// The two modes are backend-enforced MUTUALLY EXCLUSIVE — the CGI disables one
// when it enables the other (docs/reference/dpi.md > Modes) — and the page drew
// them as tabs. Tabs say "two independent panes you may browse", so the
// exclusivity surfaced only as a surprise `AlertDialog` at the instant a switch
// was flipped. Worse, because the page had no single answer to "which mode is
// active", the status card derived its own from a `??` chain and got it wrong
// (see `live-strip.tsx`).
//
// A radiogroup says the true thing in its shape: one of three, always exactly
// one. The takeover confirm survives but changes job — it now guards "this
// restarts the engine", which is a real consequence, rather than "this silently
// disables the other mode", which the shape now states on its own.
//
// -----------------------------------------------------------------------------
// KEYBOARD, AND ONE DELIBERATE DEPARTURE FROM THE STOCK RADIOGROUP
// -----------------------------------------------------------------------------
// A radiogroup is one tab stop with arrow keys inside it, not three tab stops.
// The roving `tabIndex` is what makes that true; without it the group is
// keyboard-reachable but does not behave like the widget its ARIA role claims,
// which is worse than no role at all.
//
// The stock pattern also SELECTS on arrow, and this group does not. The
// convention is sound because it assumes selection is cheap and instantly
// reversible — a form field you can arrow back off. Here "select" means a
// `systemctl start` and an iptables REDIRECT insert: arrowing from Off to
// Full Bypass committed Video Optimizer on the way past, dropping every
// connection through the engine. This app is SERVED BY the device being
// reconfigured, so one of those connections is the user's own browser session.
//
// So arrows move focus only, and commitment needs an explicit activation:
// Space, Enter, or a click. Space and Enter are not handled here because a
// native `<button>` already turns both into a click — adding key cases for
// them would be a second implementation of the thing that already works, and
// the two would drift.
// =============================================================================

const MODES: { mode: DpiMode; nameKey: string; hintKey: string; glyph?: LucideIcon }[] = [
  {
    mode: "none",
    nameKey: "trafficEngine.mode.off",
    hintKey: "trafficEngine.mode.off_hint",
  },
  {
    mode: "video_optimizer",
    nameKey: "trafficEngine.mode.video_optimizer",
    hintKey: "trafficEngine.mode.video_optimizer_hint",
    glyph: VideoIcon,
  },
  {
    mode: "full_bypass",
    nameKey: "trafficEngine.mode.full_bypass",
    hintKey: "trafficEngine.mode.full_bypass_hint",
    glyph: ArrowLeftRightIcon,
  },
];

/** Status chip glyphs. No two states in this slot share one. */
const ENGINE_GLYPH: Record<DpiEngineStatus, LucideIcon> = {
  running: CheckCircle2Icon,
  restarting: TriangleAlertIcon,
  error: XCircleIcon,
  stopped: MinusCircleIcon,
};

export interface ModeCardProps {
  /** The single derived answer. The card never infers it. */
  mode: DpiMode;
  status: DpiEngineStatus;
  isSaving: boolean;
  /**
   * Which mode the shell is currently writing, or `null` when nothing is in
   * flight. Distinct from `mode`, and the distinction is the point: `mode` is
   * what the modem confirmed, `pendingMode` is what it has been asked for.
   */
  pendingMode: DpiMode | null;
  onSelect: (mode: DpiMode) => void;
}

export function ModeCard({
  mode,
  status,
  isSaving,
  pendingMode,
  onSelect,
}: ModeCardProps) {
  const { t } = useTranslation("common");

  // Held while a mode->mode switch is waiting on the takeover confirm. `null`
  // means no dialog; the dialog is open exactly when this is set.
  const [pending, setPending] = React.useState<DpiMode | null>(null);
  // The dialog's LABEL, deliberately kept separate from whether it is open, and
  // deliberately never cleared.
  //
  // The dialog leaves on an exit animation, so it renders for several frames
  // after `pending` goes null. Interpolating `pending` straight into the title
  // made it read "Switch to ?" for the whole of that animation, every time —
  // observed on screen, which is the only way this kind of defect shows up.
  // Overwriting on the next open (rather than clearing on close) means the
  // title always says what the dialog was actually about, including on its way
  // out. Two states, one sticky, and no ref written during render.
  const [dialogMode, setDialogMode] = React.useState<DpiMode>("none");
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);

  const commit = (next: DpiMode) => {
    if (next === mode || isSaving) return;
    // Switching BETWEEN two active modes restarts the engine, and a restart
    // drops every connection currently going through it. Turning the engine off
    // or on from off does not need a confirm: one is plainly reversible and the
    // other is what the user came here to do.
    if (mode !== "none" && next !== "none") {
      setDialogMode(next);
      setPending(next);
      return;
    }
    onSelect(next);
  };

  // Focus only. See the KEYBOARD note in this file's header for why this
  // departs from the stock select-on-arrow radiogroup: here a selection is a
  // service restart, not a form value.
  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const forward = event.key === "ArrowDown" || event.key === "ArrowRight";
    const back = event.key === "ArrowUp" || event.key === "ArrowLeft";
    if (!forward && !back) return;
    event.preventDefault();
    const next = (index + (forward ? 1 : MODES.length - 1)) % MODES.length;
    refs.current[next]?.focus();
  };

  const StatusGlyph = ENGINE_GLYPH[status] ?? MinusCircleIcon;

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={cn(CARD_PAD, CARD_HEAD.ROOT)}>
        <div className={CARD_HEAD.TITLES}>
          <span className={CARD_TITLE}>{t("trafficEngine.mode.title")}</span>
          <span className={CARD_HEAD.DESC}>{t("trafficEngine.mode.description")}</span>
        </div>
        <div className={CARD_HEAD.ACTIONS}>
          <Badge variant={ENGINE_BADGE[status] ?? "muted"}>
            <StatusGlyph className={CHIP_GLYPH} aria-hidden="true" />
            {t(`trafficEngine.status.${status}`)}
          </Badge>
        </div>
      </CardHeader>

      {/* `flex flex-1 flex-col` so the card's share of the pair's height
          reaches the rows instead of pooling below them.

          IN THE COMMON CASE THIS CHANGES NOTHING: three mode rows are the taller
          of the two cards, so this card sets the row height and has no spare
          space to hand anywhere. It matters in exactly one state -- a completed
          test, where the verify card grows past it -- and there the three rows
          sit centred in the taller card rather than hanging from its top edge
          above a band of empty surface. `justify-center` is a no-op at every
          other moment, which is why it is safe to state unconditionally. */}
      <CardContent className={cn(CARD_PAD, "flex flex-1 flex-col justify-center")}>
        <motion.div
          className={CHOICE_ROW.GROUP}
          role="radiogroup"
          aria-label={t("trafficEngine.mode.aria")}
          variants={staggerRows}
          initial="hidden"
          animate="visible"
          aria-busy={pendingMode !== null}
        >
          {MODES.map((entry, index) => {
            const selected = entry.mode === mode;
            // NOT folded into `selected`. A row drawn as chosen before the CGI
            // answers is the half-edited form DESIGN.md forbids a status
            // surface from showing ("a status surface reports what is actually
            // running — saved settings, live service state — never the
            // half-edited form"). Painting the pending row as selected was
            // considered and REJECTED for that reason: the spinner says "this
            // is being applied", the mark says "this is on", and only one of
            // those is true yet.
            const isPending = entry.mode === pendingMode;
            const Glyph = entry.glyph;
            return (
              <motion.button
                key={entry.mode}
                ref={(node) => {
                  refs.current[index] = node;
                }}
                type="button"
                role="radio"
                aria-checked={selected}
                // The group keeps exactly one tab stop. While a write is in
                // flight that stop moves to the pending row, because the other
                // two carry the `disabled` attribute and cannot hold focus.
                tabIndex={
                  pendingMode !== null ? (isPending ? 0 : -1) : selected ? 0 : -1
                }
                // SELECTIVE DIMMING, and the mechanism is split on purpose.
                //
                // `CHOICE_ROW.ROOT` carries `disabled:opacity-60`, which is
                // correct for a row that is unavailable — and wrong for the one
                // row that is the whole answer to "what is happening". Dimming
                // all three equally is what erased the signal in the first
                // place.
                //
                // So the two rows that are NOT pending take the real `disabled`
                // attribute and the primitive's dim comes along with it, no
                // call-site opacity restated. The pending row takes
                // `aria-disabled` instead: it stays at full strength, keeps its
                // focus, and is held inert by `commit`'s own `isSaving` guard
                // rather than by the attribute. Fighting the primitive with an
                // opacity override at the call site was the alternative and
                // would have put a second dim value in a second place.
                disabled={isSaving && !isPending}
                aria-disabled={isSaving && isPending ? true : undefined}
                variants={staggerRowItem}
                className={cn(
                  CHOICE_ROW.ROOT,
                  selected ? CHOICE_ROW.SELECTED : CHOICE_ROW.UNSELECTED,
                )}
                onClick={() => commit(entry.mode)}
                onKeyDown={(event) => onKeyDown(event, index)}
              >
                <span
                  className={cn(
                    CHOICE_ROW.MARK,
                    selected ? CHOICE_ROW.MARK_ON : CHOICE_ROW.MARK_IDLE,
                  )}
                  aria-hidden="true"
                >
                  {selected ? <span className={CHOICE_ROW.MARK_DOT} /> : null}
                </span>
                <span className={CHOICE_ROW.TEXT}>
                  <span className={CHOICE_ROW.NAME}>{t(entry.nameKey)}</span>
                  <span
                    className={cn(CHOICE_ROW.HINT, !selected && CHOICE_ROW.HINT_IDLE)}
                  >
                    {t(entry.hintKey)}
                  </span>
                </span>
                {/* The right-hand slot is the in-progress channel, and it is a
                    SPINNER SWAPPED INTO THE CONTROL THAT IS ACTING — the same
                    idiom as this family's Add button, Run test button and
                    Uninstall pill.

                    A "Switching" chip in the card header was considered and
                    rejected: `restarting` is already a real member of
                    `DpiEngineStatus`, rendered by `ENGINE_BADGE`/`ENGINE_GLYPH`
                    here and by `ENGINE_SPEC` in `live-strip.tsx`, so a
                    synthetic chip would put the header and the engine tile on
                    two different answers to one question for the duration of
                    the switch. That is finding 01 — the exact class of defect
                    this surface was re-authored to eliminate.

                    The Off row has no resting glyph, so it borrows the slot
                    only while it is the pending one. */}
                {isPending ? (
                  <span className={CHOICE_ROW.RIGHT}>
                    <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
                    {/* The spinner is `aria-hidden`, so without this line the
                        two audiences get different interfaces: a sighted user
                        sees WHICH row is being applied, and a screen-reader
                        user hears only that the group is busy. `aria-busy` says
                        something is happening; it cannot say which of three
                        rows it is happening to.

                        `state.applying` is reused rather than minting a key —
                        it already ships translated in all five packs, and the
                        sr-only-beside-an-aria-hidden-visual idiom is the same
                        one `login-device-name.tsx` uses. */}
                    <span className="sr-only">{t("state.applying")}</span>
                  </span>
                ) : Glyph ? (
                  <span className={CHOICE_ROW.RIGHT}>
                    <Glyph className={CHOICE_ROW.GLYPH} aria-hidden="true" />
                  </span>
                ) : null}
              </motion.button>
            );
          })}
        </motion.div>
      </CardContent>

      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("trafficEngine.takeover.title", {
                mode: t(MODES.find((m) => m.mode === dialogMode)?.nameKey ?? ""),
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("trafficEngine.takeover.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("trafficEngine.takeover.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              // The `isSaving` re-check is not redundant with `commit`'s. The
              // dialog can sit open across an arbitrary gap — the user reads
              // it, and a write can start in that window (this page polls every
              // 2s and the takeover confirm is the one place a decision waits
              // on a human). Confirming into an in-flight write would queue a
              // second engine restart behind the first.
              onClick={() => {
                if (pending && !isSaving) onSelect(pending);
                setPending(null);
              }}
            >
              {t("trafficEngine.takeover.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

/**
 * The loading mirror.
 *
 * THE ROWS MIRROR BY CONSTRUCTION, WHICH IS THE ONLY WAY THEY CAN. A choice row
 * is deliberately NOT height-pinned (`shapes.ts` > CHOICE_ROW: the hint wraps
 * to two lines on a narrow container, and a fixed height would clip it), so
 * there is no number for a skeleton to copy -- and a guessed one is finding 08
 * all over again. Instead the skeleton renders `CHOICE_ROW.ROOT` itself with
 * line boxes inside it: same padding, same gaps, same mark, so the same height
 * falls out of the same arithmetic. Change the row and the mirror follows
 * without anyone remembering to.
 *
 * `MODES.length` rather than a literal 3, for the same reason.
 */
export function ModeCardSkeleton() {
  return (
    <Card className={CARD_SHELL} aria-hidden="true">
      <CardHeader className={cn(CARD_PAD, CARD_HEAD.ROOT)}>
        <div className={cn(CARD_HEAD.TITLES, "w-full")}>
          <Skeleton className={cn(SKELETON.LINE, "w-32")} />
          <Skeleton className={cn(SKELETON.LINE_SM, "w-full max-w-[22rem]")} />
        </div>
      </CardHeader>
      <CardContent className={cn(CARD_PAD, "flex flex-1 flex-col justify-center")}>
        <div className={CHOICE_ROW.GROUP}>
          {MODES.map((entry) => (
            <div
              key={entry.mode}
              className={cn(CHOICE_ROW.ROOT, CHOICE_ROW.UNSELECTED)}
            >
              <Skeleton className={SKELETON.MARK} />
              <span className={CHOICE_ROW.TEXT}>
                <Skeleton className={cn(SKELETON.LINE, "w-28")} />
                <Skeleton className={cn(SKELETON.LINE_SM, "w-4/5")} />
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default ModeCard;
