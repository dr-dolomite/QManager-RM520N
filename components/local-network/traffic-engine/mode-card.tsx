"use client";

import * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeftRightIcon,
  CheckCircle2Icon,
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
// KEYBOARD
// -----------------------------------------------------------------------------
// A radiogroup is one tab stop with arrow keys inside it, not three tab stops.
// The roving `tabIndex` is what makes that true; without it the group is
// keyboard-reachable but does not behave like the widget its ARIA role claims,
// which is worse than no role at all.
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
    mode: "masquerade",
    nameKey: "trafficEngine.mode.masquerade",
    hintKey: "trafficEngine.mode.masquerade_hint",
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
  onSelect: (mode: DpiMode) => void;
}

export function ModeCard({ mode, status, isSaving, onSelect }: ModeCardProps) {
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

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const forward = event.key === "ArrowDown" || event.key === "ArrowRight";
    const back = event.key === "ArrowUp" || event.key === "ArrowLeft";
    if (!forward && !back) return;
    event.preventDefault();
    const next = (index + (forward ? 1 : MODES.length - 1)) % MODES.length;
    refs.current[next]?.focus();
    commit(MODES[next].mode);
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

      <CardContent className={CARD_PAD}>
        <motion.div
          className={CHOICE_ROW.GROUP}
          role="radiogroup"
          aria-label={t("trafficEngine.mode.aria")}
          variants={staggerRows}
          initial="hidden"
          animate="visible"
        >
          {MODES.map((entry, index) => {
            const selected = entry.mode === mode;
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
                tabIndex={selected ? 0 : -1}
                disabled={isSaving}
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
                {Glyph ? (
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
              onClick={() => {
                if (pending) onSelect(pending);
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

export default ModeCard;
