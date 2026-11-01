"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { ChevronLeftIcon } from "lucide-react";
import { useMotionReduced } from "@/components/motion-preference";
import { Button } from "@/components/ui/button";
import {
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DUR, EASE_QUICK, transitionStandard } from "@/lib/motion";
import { cn } from "@/lib/utils";
import {
  BACK_BUTTON,
  CARD_ACTION,
  CARD_DESC,
  CARD_HEAD,
  CARD_TITLE,
  VIEW,
} from "./shapes";

// In-card views: a card swaps its body for a sub-view and keeps its place in
// the grid. A row with a chevron opens the view; Back in `CardAction` closes it.

const fade = { duration: DUR.quick, ease: EASE_QUICK } as const;

interface ViewHeaderProps {
  /** Changes with the view, so the title and description fade on a swap. */
  viewKey: string;
  title: string;
  description: string;
  padClassName: string;
  /** Chips and Back, on the header's right edge. Omitted when empty. */
  action?: ReactNode;
}

export function ViewHeader({ viewKey, title, description, padClassName, action }: ViewHeaderProps) {
  return (
    <CardHeader className={cn(padClassName, CARD_HEAD)}>
      <CardTitle className={CARD_TITLE}>
        <motion.span key={viewKey} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={fade}>
          {title}
        </motion.span>
      </CardTitle>
      <CardDescription className={CARD_DESC}>
        <motion.span key={viewKey} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={fade}>
          {description}
        </motion.span>
      </CardDescription>
      {action ? <CardAction className={CARD_ACTION}>{action}</CardAction> : null}
    </CardHeader>
  );
}

/** Closes a view. Takes focus when it mounts, so a keyboard user lands in the view. */
export function BackButton({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation("local-network");
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  return (
    <Button ref={ref} type="button" variant="ghost" size="sm" onClick={onBack} className={BACK_BUTTON}>
      <ChevronLeftIcon aria-hidden="true" />
      {t("traffic_engine.back")}
    </Button>
  );
}

interface ViewBodyProps {
  viewKey: string;
  /** +1 entering a sub-view, -1 coming back: the view slides in from that side. */
  direction: 1 | -1;
  className?: string;
  children: ReactNode;
}

/** The swapped body: a 10px slide and fade on the standard curve; fade only under Reduced. */
export function ViewBody({ viewKey, direction, className, children }: ViewBodyProps) {
  const reduce = useMotionReduced();
  return (
    <motion.div
      key={viewKey}
      initial={{ opacity: 0, x: reduce ? 0 : direction * 10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={transitionStandard}
      className={cn(VIEW, className)}
    >
      {children}
    </motion.div>
  );
}
