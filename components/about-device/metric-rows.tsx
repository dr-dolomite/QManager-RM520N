"use client";

import type * as React from "react";
import { CircleAlertIcon } from "lucide-react";
import { motion } from "motion/react";

import { Skeleton } from "@/components/ui/skeleton";
import { staggerRowItem, staggerRows } from "@/lib/motion";
import { cn } from "@/lib/utils";

import {
  EMPTY,
  GROUP,
  GROUP_LABEL,
  GROUPS,
  ROW,
  ROW_LIST,
  SKELETON,
  VALUE_NONE,
} from "./shapes";

/**
 * The stack of labelled groups, and the ONE region in a card that absorbs the
 * grid's height lock. It is also the row cascade's root — the only place on
 * this surface besides the page shell that declares `initial`/`animate`, since
 * a variants-only child renders blank when its card swaps out of a skeleton.
 */
export function GroupStack({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <motion.div
      className={GROUPS}
      initial="hidden"
      animate="visible"
      variants={staggerRows}
    >
      {children}
    </motion.div>
  );
}

/** One labelled cluster. An unlabelled cluster is the card's primary block. */
export function Group({
  label,
  children,
}: {
  label?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <motion.div className={GROUP} variants={staggerRows}>
      {label ? (
        <motion.span className={GROUP_LABEL} variants={staggerRowItem}>
          {label}
        </motion.span>
      ) : null}
      <div className={ROW_LIST}>{children}</div>
    </motion.div>
  );
}

function RowShell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <motion.div className={ROW.ROOT} variants={staggerRowItem}>
      <span className={ROW.KEY}>{label}</span>
      {children}
    </motion.div>
  );
}

/**
 * A metric row whose value is text. An absent value is an em dash in the
 * quieter ink — the retired card printed a hyphen, which reads as a value.
 */
export function ValueRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): React.JSX.Element {
  const present = value.trim().length > 0;
  return (
    <RowShell label={label}>
      <span
        className={cn(
          ROW.VALUE,
          mono && present && ROW.VALUE_MONO,
          !present && ROW.VALUE_NONE,
        )}
        title={present ? value : undefined}
      >
        {present ? value : VALUE_NONE}
      </span>
    </RowShell>
  );
}

/** A metric row whose value is a component — a `Tag`, not a string. */
export function SlotRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return <RowShell label={label}>{children}</RowShell>;
}

/**
 * A card with nothing to show, built to FILL so the height-locked pair does not
 * become a symmetric void. Both cards reach this from the SAME page condition.
 */
export function CardEmpty({
  title,
  body,
}: {
  title: string;
  body: string;
}): React.JSX.Element {
  return (
    <div className={EMPTY.ROOT}>
      <div className={EMPTY.DISC}>
        <CircleAlertIcon className={EMPTY.GLYPH} aria-hidden="true" />
      </div>
      <span className={EMPTY.TITLE}>{title}</span>
      <span className={EMPTY.BODY}>{body}</span>
    </div>
  );
}

/** Placeholder rows, wearing the row's own pin rather than a restated number. */
export function RowSkeletons({ count }: { count: number }): React.JSX.Element {
  return (
    <div className={cn(GROUPS, ROW_LIST)}>
      {Array.from({ length: count }).map((_, index) => (
        <Skeleton key={index} className={SKELETON.ROW} />
      ))}
    </div>
  );
}
