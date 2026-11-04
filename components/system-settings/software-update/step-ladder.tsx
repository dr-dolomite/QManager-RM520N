"use client";

import type * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { staggerRowItem, staggerRows } from "@/lib/motion";
import { cn } from "@/lib/utils";

import { stepStates, type UpdateView } from "./derive";
import {
  CHIP_GLYPH,
  DISC_TRANSITION,
  LADDER,
  SPIN,
  STEP_BADGE,
  STEP_DISC,
  STEP_GLYPH,
  STEP_ORDER,
  STEP_PENDING_GLYPH,
} from "./shapes";

const K = "software_update.steps";

export interface StepLadderProps {
  view: UpdateView;
  /** A verified package survives a failed install, so its rows stay done. */
  packageStaged?: boolean;
}

/**
 * The four steps an update takes, ALWAYS rendered. At rest every row is
 * pending, which is how the reboot is visible before the user commits; a run
 * recolours these same rows in place rather than mounting anything.
 */
export function StepLadder({
  view,
  packageStaged = false,
}: StepLadderProps): React.JSX.Element {
  const { t } = useTranslation("system-settings");
  const states = stepStates(view, packageStaged);

  return (
    <motion.div
      className={LADDER.GROUP}
      variants={staggerRows}
      initial="hidden"
      animate="visible"
      role="list"
      aria-label={t(`${K}.aria_label`)}
      aria-live="polite"
    >
      {STEP_ORDER.map((key) => {
        const state = states[key];
        const active = state === "active";
        // A state glyph when the row has one, else the step's own subject.
        const Glyph = STEP_GLYPH[state] ?? STEP_PENDING_GLYPH[key];

        return (
          <motion.div
            key={key}
            variants={staggerRowItem}
            role="listitem"
            aria-current={active ? "step" : undefined}
            className={cn(LADDER.ROW, active && LADDER.ROW_ACTIVE)}
          >
            <span
              className={cn(LADDER.DISC, DISC_TRANSITION, STEP_DISC[state])}
            >
              <Glyph
                className={cn(LADDER.GLYPH, active && SPIN)}
                aria-hidden="true"
              />
            </span>

            <span className={LADDER.TEXT}>
              <span className={LADDER.LABEL}>{t(`${K}.${key}.label`)}</span>
              <span className={LADDER.DETAIL}>{t(`${K}.${key}.detail`)}</span>
            </span>

            <span className={LADDER.META}>
              {state !== "pending" && (
                <Badge variant={STEP_BADGE[state]}>
                  <Glyph
                    className={cn(CHIP_GLYPH, active && SPIN)}
                    aria-hidden="true"
                  />
                  {t(`${K}.state.${state}`)}
                </Badge>
              )}
            </span>
          </motion.div>
        );
      })}
    </motion.div>
  );
}

export default StepLadder;
