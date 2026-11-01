"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { useMotionReduced } from "@/components/motion-preference";
import { DUR, EASE_STANDARD, rowCascadeDelay } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { EngineMode } from "./engine-card";
import { STRIP } from "./shapes";

/** The hostname the diagram splits. Illustrative: the strip draws one flow. */
const SAMPLE_HOST: Record<EngineMode, readonly [string, string]> = {
  video: ["googlevi", "deo.com"],
  full_bypass: ["exam", "ple.com"],
};

interface Block {
  key: string;
  kind: "fragment" | "part" | "rest";
  /** A piece carrying part of the hostname. Promoted while the mode runs. */
  read: boolean;
  title: string;
  mono?: string;
}

interface HandshakeStripProps {
  mode: EngineMode;
  /** The mode owns the engine: the hostname pieces light up. */
  active: boolean;
  /** The eyebrow's HintIcon. */
  hint: ReactNode;
}

/**
 * One tpws handshake as the carrier's DPI sees it: the hostname split and sent out of order.
 * Both modes use the same split; they differ in which connections get it.
 */
export function HandshakeStrip({ mode, active, hint }: HandshakeStripProps) {
  const { t } = useTranslation("local-network");
  const reduce = useMotionReduced();
  const [head, tail] = SAMPLE_HOST[mode];

  const blocks: Block[] = [
    { key: "f", kind: "fragment", read: true, title: t("traffic_engine.strip_fragment") },
    {
      key: "a",
      kind: "part",
      read: true,
      title: t("traffic_engine.strip_part"),
      mono: `${head}…`,
    },
    {
      key: "b",
      kind: "part",
      read: true,
      title: t("traffic_engine.strip_part"),
      mono: `…${tail}`,
    },
    { key: "r", kind: "rest", read: false, title: t("traffic_engine.strip_rest") },
  ];

  return (
    <div className={STRIP.TILE}>
      <div className={STRIP.HEAD}>
        <span className={STRIP.EYEBROW}>
          {t("traffic_engine.strip_eyebrow")}
          {hint}
        </span>
        <span className={STRIP.SCOPE}>
          {mode === "video"
            ? t("traffic_engine.strip_scope_video")
            : t("traffic_engine.strip_scope_all")}
        </span>
      </div>
      {/* Keyed on the running state so the blocks grow in again when the mode takes over. */}
      <div
        key={active ? "on" : "off"}
        role="img"
        aria-label={t("traffic_engine.strip_aria")}
        className={STRIP.ROW}
      >
        {blocks.map((b, i) => (
          <motion.div
            key={b.key}
            initial={reduce ? { opacity: 0 } : { opacity: 0, scaleX: 0.4 }}
            animate={{ opacity: 1, scaleX: 1 }}
            transition={{ duration: DUR.standard, ease: EASE_STANDARD, delay: rowCascadeDelay(i) }}
            className={cn(
              STRIP.BLOCK,
              b.kind === "fragment" ? STRIP.FRAGMENT : b.kind === "part" ? STRIP.PART : STRIP.REST,
              active && b.read ? STRIP.BLOCK_READ : STRIP.BLOCK_REST,
            )}
          >
            <span
              className={
                b.kind === "fragment" ? STRIP.FRAGMENT_TITLE : b.kind === "part" ? STRIP.PART_TITLE : STRIP.TITLE
              }
            >
              {b.title}
            </span>
            {b.mono ? <span className={STRIP.MONO}>{b.mono}</span> : null}
          </motion.div>
        ))}
      </div>
      <div className={STRIP.AXIS} aria-hidden="true">
        <span>{t("traffic_engine.strip_axis_first")}</span>
        <span className={STRIP.AXIS_RULE}>
          <span className={STRIP.AXIS_HEAD} />
        </span>
        <span>{t("traffic_engine.strip_axis_last")}</span>
      </div>
    </div>
  );
}
