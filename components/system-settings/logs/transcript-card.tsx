"use client";

import * as React from "react";
import { AnimatePresence, motion, type Variants } from "motion/react";
import { useTranslation } from "react-i18next";
import {
  FilterXIcon,
  RefreshCcwIcon,
  ScrollTextIcon,
  SearchIcon,
  SearchXIcon,
  TriangleAlertIcon,
  UnplugIcon,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  DUR,
  EASE_QUICK,
  rowCascadeDelay,
  transitionStandard,
} from "@/lib/motion";
import { cn } from "@/lib/utils";
import { LINE_BUDGETS, type UseSystemLogsReturn } from "@/hooks/use-system-logs";
import type { LevelFilter } from "@/types/system-logs";

import { ConditionBlock } from "./condition-block";
import { LogRow } from "./log-row";
import {
  clockTime,
  dayLabelKind,
  filterByLevel,
  formatDayDate,
  groupByDay,
  levelCounts,
  parseLogTimestamp,
  RAIL_OPTIONS,
  relativeAge,
  withRowKeys,
} from "./derive";
import {
  CARD_BODY,
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  COARSE_TARGET,
  CROSSFADE_STACK,
  DAY,
  FIELD_SEARCH,
  FIELD_SELECT,
  FIELD_SELECT_NARROW,
  FILTER_COUNT,
  FILTER_PILL,
  FILTER_PILL_ACTIVE,
  FILTER_PILL_REST,
  FILTER_ROW,
  LOG,
  LOG_STACK,
  NOTICE,
  NOTICE_GLYPH,
  RAIL,
  SEARCH_BOX,
  SEARCH_GLYPH,
  SKELETON_ROW,
  SWITCH_LABEL,
  SWITCH_ROW,
} from "./shapes";

const K = "logs";

const SEARCH_ID = "system-log-search";
const ARCHIVED_ID = "system-log-archived";

/** The row cascade, capped by `rowCascadeDelay` so a 500-line window does not
 *  choreograph for half a minute. */
const logRowItem: Variants = {
  hidden: { opacity: 0, y: 5 },
  visible: (index: number) => ({
    opacity: 1,
    y: 0,
    transition: { ...transitionStandard, delay: rowCascadeDelay(index) },
  }),
};

export interface TranscriptCardProps {
  logs: UseSystemLogsReturn;
}

export function TranscriptCard({ logs }: TranscriptCardProps): React.JSX.Element {
  const { t } = useTranslation("system-settings");
  const {
    entries,
    stats,
    availableComponents,
    isLoading,
    error,
    level,
    setLevel,
    component,
    setComponent,
    searchInput,
    setSearchInput,
    lines,
    setLines,
    includeRotated,
    setIncludeRotated,
    filtersActive,
    clearFilters,
    refresh,
  } = logs;

  // The cascade is a MOUNT event, not a filter event: touching a control
  // retires it for good rather than re-choreographing the whole window on
  // every press.
  const [cascade, setCascade] = React.useState(true);
  const touch = React.useCallback(() => setCascade(false), []);

  const counts = React.useMemo(() => levelCounts(entries), [entries]);

  // Newest first, which is what the day labels assume: Today at the top.
  const rows = React.useMemo(
    () => withRowKeys([...filterByLevel(entries, level)].reverse()),
    [entries, level],
  );

  const groups = React.useMemo(() => groupByDay(rows), [rows]);

  // The cascade delay keys off a row's FLAT position, which the day groups no
  // longer carry. Derived once rather than counted during render.
  const positionByKey = React.useMemo(
    () => new Map(rows.map((row, index) => [row.key, index])),
    [rows],
  );

  const [nowSec, setNowSec] = React.useState(() =>
    Math.floor(Date.now() / 1000),
  );
  React.useEffect(() => {
    const id = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const unreadable = error !== null && entries.length === 0;

  // Never "N of N": `total` is line-counted from the very string the CGI
  // serialises, so the two are equal by construction. What is true is how many
  // lines are on screen and how many the live log holds.
  const description = isLoading
    ? t(`${K}.card.description_loading`)
    : unreadable
      ? t(`${K}.card.description_unreadable`)
      : t(`${K}.card.description`, {
          shown: rows.length,
          held: stats?.current_lines ?? 0,
        });

  const dayLabel = (atSec: number | null): string => {
    if (atSec === null) return t(`${K}.day.unknown`);
    const kind = dayLabelKind(atSec, nowSec);
    if (kind === "today") return t(`${K}.day.today`);
    if (kind === "yesterday") return t(`${K}.day.yesterday`);
    return formatDayDate(atSec);
  };

  const railLabel = (option: LevelFilter): string =>
    option === "all" ? t(`${K}.rail.all`) : t(`${K}.rail.${option}`);

  let body: React.ReactNode;
  if (unreadable) {
    body = (
      <ConditionBlock
        tone="destructive"
        glyph={UnplugIcon}
        ariaRole="alert"
        title={t(`${K}.error.title`)}
        description={t(`${K}.error.description`)}
        onAction={() => void refresh()}
        actionLabel={t(`${K}.error.retry`)}
        actionGlyph={RefreshCcwIcon}
      />
    );
  } else if (rows.length === 0 && filtersActive) {
    body = (
      <ConditionBlock
        tone="neutral"
        glyph={SearchXIcon}
        ariaRole="status"
        title={t(`${K}.empty_filtered.title`)}
        description={t(`${K}.empty_filtered.description`)}
        onAction={() => {
          touch();
          clearFilters();
        }}
        actionLabel={t(`${K}.empty_filtered.action`)}
        actionGlyph={FilterXIcon}
      />
    );
  } else if (rows.length === 0) {
    body = (
      <ConditionBlock
        tone="neutral"
        glyph={ScrollTextIcon}
        ariaRole="status"
        title={t(`${K}.empty.title`)}
        description={t(`${K}.empty.description`)}
      />
    );
  } else {
    body = (
      <div className={cn(LOG_STACK, "overflow-hidden")}>
        {groups.map((group, groupIndex) => (
          <div key={group.key} className={LOG}>
            <div className={DAY.ROOT}>
              <span className={DAY.LABEL}>{dayLabel(group.atSec)}</span>
              {groupIndex > 0 ? <span aria-hidden className={DAY.RULE} /> : null}
            </div>
            {group.rows.map(({ entry, key }) => {
              const position = positionByKey.get(key) ?? 0;
              const atSec = parseLogTimestamp(entry.timestamp);
              const age =
                atSec === null ? null : relativeAge(nowSec - atSec);
              return (
                <motion.div
                  key={key}
                  custom={position}
                  variants={logRowItem}
                  initial={cascade ? "hidden" : false}
                  animate="visible"
                >
                  <LogRow
                    entry={entry}
                    severityWord={t(`${K}.severity.${entry.level}`)}
                    timeAgo={
                      age ? t(`${K}.time.${age.unit}`, { value: age.count }) : ""
                    }
                    clockTime={atSec === null ? entry.timestamp : clockTime(atSec)}
                  />
                </motion.div>
              );
            })}
          </div>
        ))}
      </div>
    );
  }

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={CARD_PAD}>
        <CardTitle className={CARD_TITLE}>{t(`${K}.card.title`)}</CardTitle>
        <CardDescription className={CARD_DESC}>{description}</CardDescription>
      </CardHeader>

      <CardContent className={cn(CARD_PAD, CARD_BODY)}>
        {/* Row 1 — the level rail. Fill carries selection, never a border, and
            every chip reports its live count off the window already in hand. */}
        <div className={RAIL} role="group" aria-label={t(`${K}.rail.label`)}>
          {RAIL_OPTIONS.map((option) => {
            const active = option === level;
            return (
              <Button
                key={option}
                type="button"
                variant="ghost"
                aria-pressed={active}
                onClick={() => {
                  touch();
                  setLevel(option);
                }}
                className={cn(
                  FILTER_PILL,
                  active ? FILTER_PILL_ACTIVE : FILTER_PILL_REST,
                )}
              >
                {railLabel(option)}
                {!isLoading && !unreadable ? (
                  <span className={FILTER_COUNT}>{counts[option]}</span>
                ) : null}
              </Button>
            );
          })}
        </div>

        {/* Row 2 — search, component, line budget, archived. */}
        <div className={FILTER_ROW}>
          <div className={SEARCH_BOX}>
            <label htmlFor={SEARCH_ID} className="sr-only">
              {t(`${K}.filters.search_label`)}
            </label>
            <SearchIcon className={SEARCH_GLYPH} aria-hidden="true" />
            <Input
              id={SEARCH_ID}
              value={searchInput}
              placeholder={t(`${K}.filters.search_placeholder`)}
              onChange={(e) => {
                touch();
                setSearchInput(e.target.value);
              }}
              className={cn(FIELD_SEARCH)}
            />
          </div>

          <Select
            value={component}
            onValueChange={(next) => {
              touch();
              setComponent(next);
            }}
          >
            <SelectTrigger
              aria-label={t(`${K}.filters.component_label`)}
              className={cn(FIELD_SELECT)}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                {t(`${K}.filters.component_all`)}
              </SelectItem>
              {/* The list is the LAST read's components, so a filtered-on name
                  can scroll out of the window. Without its item Radix renders
                  an empty trigger while the filter is still being sent. */}
              {!availableComponents.includes(component) && component !== "all" ? (
                <SelectItem value={component}>{component}</SelectItem>
              ) : null}
              {availableComponents.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={lines}
            onValueChange={(next) => {
              touch();
              setLines(next);
            }}
          >
            <SelectTrigger
              aria-label={t(`${K}.filters.lines_label`)}
              className={cn(FIELD_SELECT_NARROW)}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LINE_BUDGETS.map((budget) => (
                <SelectItem key={budget} value={budget}>
                  {t(`${K}.filters.lines_option`, { lines: budget })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className={SWITCH_ROW}>
            <Switch
              id={ARCHIVED_ID}
              checked={includeRotated}
              onCheckedChange={(next) => {
                touch();
                setIncludeRotated(next);
              }}
              className={COARSE_TARGET}
            />
            <label htmlFor={ARCHIVED_ID} className={SWITCH_LABEL}>
              {t(`${K}.filters.archived`)}
            </label>
          </div>
        </div>

        {/* A stale list beats a blank card: with data in hand the failed read is
            a notice above the log, never a replacement for it. */}
        {error && entries.length > 0 ? (
          <div role="status" className={NOTICE}>
            <TriangleAlertIcon className={NOTICE_GLYPH} aria-hidden="true" />
            {t(`${K}.notice.stale`)}
          </div>
        ) : null}

        {/* Skeleton and content share one grid cell, so the swap costs no
            layout shift. The filter swap is sync rather than `wait`, so nothing
            is gated on an exit finishing in a throttled background tab. */}
        <div className={CROSSFADE_STACK}>
          {isLoading ? (
            <LogSkeleton />
          ) : (
            <AnimatePresence>
              <motion.div
                key={`${level}-${component}-${lines}-${includeRotated}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: DUR.quick, ease: EASE_QUICK }}
              >
                {body}
              </motion.div>
            </AnimatePresence>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** Skeleton rows read the SAME pinned height constant the real rows do. */
export function LogSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className={LOG} aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className={cn(SKELETON_ROW)} />
      ))}
    </div>
  );
}

export default TranscriptCard;
