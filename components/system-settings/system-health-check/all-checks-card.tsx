"use client";

import * as React from "react";
import { ChevronRightIcon, type LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { Badge, type BadgeVariant } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { staggerItem, staggerRows } from "@/lib/motion";
import type { TestCategory } from "@/types/system-health-check";
import { cn } from "@/lib/utils";

import { isTerminal, type CategoryGroup } from "./derive";
import TestRow from "./test-row";
import {
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_STACK,
  CARD_TITLE,
  CHIP_GLYPH,
  FOCUS_RING,
  GROUP_HEAD,
  GROUP_ROWS,
  ROW_GROUP,
  TALLY_BADGE,
  TALLY_GLYPH,
  TEST_ROW,
} from "./shapes";

const K = "all_checks";

type OpenSet = { key: string; open: Record<TestCategory, boolean> };

type Tally =
  | { variant: BadgeVariant; glyph: LucideIcon; pending: true }
  | {
      variant: BadgeVariant;
      glyph: LucideIcon;
      pending: false;
      key: "failed" | "warnings" | "passed";
      count: number;
    };

/**
 * Fails outrank warnings outrank passes — one chip, in that precedence. A group
 * with nothing resolved yet gets its own muted chip: "0 passed" would be a
 * health claim about checks that have not run.
 */
function tallyOf(group: CategoryGroup): Tally {
  if (group.fail > 0) {
    return {
      variant: TALLY_BADGE.fail,
      glyph: TALLY_GLYPH.fail,
      pending: false,
      key: "failed",
      count: group.fail,
    };
  }
  if (group.warn > 0) {
    return {
      variant: TALLY_BADGE.warn,
      glyph: TALLY_GLYPH.warn,
      pending: false,
      key: "warnings",
      count: group.warn,
    };
  }
  if (!group.tests.some((test) => isTerminal(test.status))) {
    return {
      variant: TALLY_BADGE.pending,
      glyph: TALLY_GLYPH.pending,
      pending: true,
    };
  }
  return {
    variant: TALLY_BADGE.pass,
    glyph: TALLY_GLYPH.pass,
    pending: false,
    key: "passed",
    count: group.pass,
  };
}

function seedOpen(
  groups: CategoryGroup[],
  settled: boolean,
): Record<TestCategory, boolean> {
  const seeded = {} as Record<TestCategory, boolean>;
  for (const group of groups) {
    seeded[group.category] = settled ? group.fail + group.warn > 0 : true;
  }
  return seeded;
}

export interface AllChecksCardProps {
  jobId: string;
  /** False while the run is in flight, which is its own seeding phase. */
  settled: boolean;
  groups: CategoryGroup[];
}

export function AllChecksCard({
  jobId,
  settled,
  groups,
}: AllChecksCardProps): React.JSX.Element {
  const { t } = useTranslation("system-health-check");

  // Seeded once per job phase, then owned by the user: a chevron writes into
  // this set, so a failing group closes and stays closed.
  const seedKey = `${jobId}:${settled ? "settled" : "running"}`;
  const [openSet, setOpenSet] = React.useState<OpenSet>(() => ({
    key: seedKey,
    open: seedOpen(groups, settled),
  }));
  if (openSet.key !== seedKey) {
    setOpenSet({ key: seedKey, open: seedOpen(groups, settled) });
  }

  const toggle = (category: TestCategory) => {
    setOpenSet((prev) => ({
      key: prev.key,
      open: { ...prev.open, [category]: !prev.open[category] },
    }));
  };

  return (
    <motion.div variants={staggerItem}>
      <Card className={CARD_SHELL}>
        <CardHeader className={CARD_PAD}>
          <CardTitle className={CARD_TITLE}>{t(`${K}.title`)}</CardTitle>
          <CardDescription className={CARD_DESC}>
            {t(`${K}.description`)}
          </CardDescription>
        </CardHeader>

        <CardContent className={cn(CARD_PAD, CARD_STACK)}>
          {groups.map((group) => {
            const isOpen = openSet.open[group.category] ?? false;
            const tally = tallyOf(group);
            const TallyGlyph = tally.glyph;
            const listId = `health-group-${group.category}`;

            return (
              <div key={group.category} className={ROW_GROUP}>
                <button
                  type="button"
                  onClick={() => toggle(group.category)}
                  aria-expanded={isOpen}
                  aria-controls={listId}
                  className={cn(
                    GROUP_HEAD.ROOT,
                    TEST_ROW.EXPANDABLE,
                    FOCUS_RING,
                  )}
                >
                  <span className={GROUP_HEAD.TEXT}>
                    <span className={GROUP_HEAD.LABEL}>
                      {t(`category.${group.category}.label`)}
                    </span>
                    <span className={GROUP_HEAD.DESC}>
                      {t(`category.${group.category}.description`)}
                    </span>
                  </span>
                  <span className={GROUP_HEAD.META}>
                    <Badge variant={tally.variant}>
                      <TallyGlyph className={CHIP_GLYPH} aria-hidden="true" />
                      {tally.pending
                        ? t("status.pending")
                        : t(`tally.${tally.key}`, { count: tally.count })}
                    </Badge>
                    <ChevronRightIcon
                      className={cn(
                        TEST_ROW.CHEVRON,
                        isOpen && TEST_ROW.CHEVRON_OPEN,
                      )}
                      aria-hidden="true"
                    />
                  </span>
                </button>

                {isOpen && (
                  /* Mounts on a click, long after the page cascade settled, so
                     it starts its own rather than inheriting a spent clock. */
                  <motion.div
                    id={listId}
                    className={GROUP_ROWS}
                    variants={staggerRows}
                    initial="hidden"
                    animate="visible"
                  >
                    {group.tests.map((test) => (
                      <TestRow key={test.id} test={test} />
                    ))}
                  </motion.div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </motion.div>
  );
}

export default AllChecksCard;
