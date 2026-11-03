"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { useMotionReduced } from "@/components/motion-preference";
import { Button } from "@/components/ui/button";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import {
  DUR,
  EASE_QUICK,
  EASE_STANDARD,
  rowCascadeDelay,
  staggerRowItem,
} from "@/lib/motion";
import { cn } from "@/lib/utils";

import { dayRelation, formatClock, formatDay } from "./sms-format";
import { SmsIdentityDisc } from "./sms-identity-disc";
import {
  THREAD_DISC_SIZE,
  THREAD_LIST_GAP,
  THREAD_ROW_FRAME,
  type SmsThreadView,
} from "./sms-threads";
import { SmsStatePanel, SmsThreadListSkeleton } from "./sms-states";
import { SmsStorageMeter } from "./sms-storage-meter";
import type { SmsStorage } from "@/types/sms";

// =============================================================================
// SmsThreadList — the left pane of the two-pane card
// =============================================================================
// Sits on `surface`; the conversation beside it sits one tonal step up on
// `surface-container`. There is deliberately NO divider between them: the
// tonal step is the separation (DESIGN.md > The Tonal-Elevation Rule and The
// No-Hairline-On-Fill Rule).
//
// Every row is a real `<button>`, so Enter/Space and focus order come from the
// platform rather than from a keydown handler. The parent registers each row's
// element so focus can return to the originating row when the user backs out
// of a thread at phone width.
// =============================================================================

export type SmsThreadFilter = "all" | "unread";

export interface SmsThreadListProps {
  threads: SmsThreadView[];
  /** The RAW stored address of the open thread, or null. */
  selectedAddr: string | null;
  onSelect: (addr: string) => void;
  search: string;
  onSearchChange: (value: string) => void;
  filter: SmsThreadFilter;
  onFilterChange: (filter: SmsThreadFilter) => void;
  sortNewestFirst: boolean;
  onToggleSort: () => void;
  onCompose: () => void;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  /** Store fill for the meter at the foot of the list; null before the first read. */
  storage: SmsStorage | null;
  /** Focus-return registry, keyed by raw address. */
  registerRowRef: (addr: string, el: HTMLButtonElement | null) => void;
  className?: string;
}

export function SmsThreadList({
  threads,
  selectedAddr,
  onSelect,
  search,
  onSearchChange,
  filter,
  onFilterChange,
  sortNewestFirst,
  onToggleSort,
  onCompose,
  isLoading,
  error,
  onRetry,
  storage,
  registerRowRef,
  className,
}: SmsThreadListProps) {
  const { t, i18n } = useTranslation("cellular");

  const searchId = React.useId();

  return (
    <div
      className={cn(
        "bg-surface @container/list flex min-h-0 flex-col",
        className,
      )}
    >
      {/* ---- search + compose ------------------------------------------- */}
      <div className="flex items-center gap-2 px-4 pt-4 pb-3">
        {/*
          `min-w-0` is load-bearing, not tidiness. A flex item's default
          `min-width: auto` floors it at its own min-content width, so
          `flex-1` could grow this wrapper but never shrink it, and the
          overflow landed on the compose button (clipped by the Card's
          `overflow-hidden`). No `min-w-*` floor here on purpose: any floor
          puts the overflow straight back.
        */}
        <div className="bg-surface-container focus-within:ring-ring focus-within:ring-offset-surface rounded-pill flex h-10 min-w-0 flex-1 items-center gap-2.5 px-3.5 focus-within:ring-[3px] focus-within:ring-offset-2">
          <MaterialSymbol
            name="search"
            size={16}
            className="text-on-surface-variant flex-none"
          />
          <label htmlFor={searchId} className="sr-only">
            {t("sms.center.search.aria")}
          </label>
          <input
            id={searchId}
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t("sms.center.search.placeholder")}
            className="placeholder:text-on-surface-variant min-w-0 flex-1 bg-transparent text-[0.8125rem] outline-none"
          />
        </div>
        <Button
          type="button"
          size="icon"
          aria-label={t("sms.center.actions.compose")}
          onClick={onCompose}
          className="size-10 flex-none"
        >
          <MaterialSymbol name="edit" size={18} />
        </Button>
      </div>

      {/* ---- filter chips + sort ---------------------------------------- */}
      <div className="flex items-center gap-1.5 px-4 pb-3">
        <FilterChip
          active={filter === "all"}
          label={t("sms.center.filters.all")}
          onClick={() => onFilterChange("all")}
        />
        <FilterChip
          active={filter === "unread"}
          label={t("sms.center.filters.unread")}
          onClick={() => onFilterChange("unread")}
        />
        <div className="flex-1" />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={
            sortNewestFirst
              ? t("sms.center.sort.to_oldest")
              : t("sms.center.sort.to_newest")
          }
          onClick={onToggleSort}
          className="text-on-surface-variant size-7 pointer-coarse:size-11"
        >
          <MaterialSymbol name={sortNewestFirst ? "arrow_downward" : "arrow_upward"} size={16} />
        </Button>
      </div>

      {/* ---- the list ---------------------------------------------------- */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <>
            <span className="sr-only" role="status">
              {t("sms.center.states.loading_sr")}
            </span>
            <SmsThreadListSkeleton />
          </>
        ) : error ? (
          <SmsStatePanel
            role="alert"
            icon="error"
            tone="destructive"
            title={t("sms.center.states.error.title")}
            description={t("sms.center.states.error.description")}
            detail={error}
            action={
              <Button variant="tonal-neutral" size="sm" onClick={onRetry}>
                <MaterialSymbol name="refresh" size={16} />
                {t("sms.center.states.error.retry")}
              </Button>
            }
          />
        ) : threads.length === 0 ? (
          search.trim() ? (
            <SmsStatePanel
              icon="search"
              title={t("sms.center.states.no_matches.title")}
              description={t("sms.center.states.no_matches.description")}
            />
          ) : filter === "unread" ? (
            <SmsStatePanel
              icon="mark_email_read"
              title={t("sms.center.states.no_unread.title")}
              description={t("sms.center.states.no_unread.description")}
            />
          ) : (
            <SmsStatePanel
              icon="edit"
              tone="primary"
              title={t("sms.center.states.empty.title")}
              description={t("sms.center.states.empty.description")}
              action={
                <Button variant="tonal" size="sm" onClick={onCompose}>
                  {t("sms.center.states.empty.action")}
                </Button>
              }
            />
          )
        ) : (
          <ul className={cn("flex flex-col px-2.5 pb-3", THREAD_LIST_GAP)}>
            {/* Default AnimatePresence (initial: true) so the list cascades on
                first paint. Keys are the raw address and therefore stable, so a
                refresh re-render mounts nothing and nothing re-cascades. */}
            <AnimatePresence>
              {threads.map((view, index) => (
                <motion.li
                  key={view.addr}
                  variants={staggerRowItem}
                  initial="hidden"
                  animate="visible"
                  // Removal collapses height as well as fading. The
                  // Transform-Only Rule's own precedent (metric-bar) is that a
                  // geometric property is legal where a transform would lie
                  // about the layout: a scaled-out row would leave its gap
                  // behind and the list would jump after the fact.
                  exit={{ opacity: 0, height: 0 }}
                  transition={{
                    duration: DUR.standard,
                    ease: EASE_STANDARD,
                    delay: rowCascadeDelay(index),
                  }}
                  className="overflow-hidden"
                >
                  <SmsThreadRow
                    view={view}
                    selected={view.addr === selectedAddr}
                    locale={i18n.language}
                    onSelect={onSelect}
                    registerRowRef={registerRowRef}
                  />
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>

      {storage && !isLoading ? <SmsStorageMeter storage={storage} /> : null}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Filter chip
// -----------------------------------------------------------------------------

function FilterChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-pill focus-visible:ring-ring focus-visible:ring-offset-surface inline-flex h-7 items-center gap-1.5 px-3 text-xs font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-offset-2 pointer-coarse:h-11",
        "[transition:color_var(--duration-standard)_var(--ease-standard),background-color_var(--duration-standard)_var(--ease-standard)]",
        active
          ? "bg-primary-container text-on-primary-container"
          : "text-on-surface-variant hover:bg-surface-container",
      )}
    >
      {label}
    </button>
  );
}

// -----------------------------------------------------------------------------
// Row
// -----------------------------------------------------------------------------

function SmsThreadRow({
  view,
  selected,
  locale,
  onSelect,
  registerRowRef,
}: {
  view: SmsThreadView;
  selected: boolean;
  locale: string;
  onSelect: (addr: string) => void;
  registerRowRef: (addr: string, el: HTMLButtonElement | null) => void;
}) {
  const { t } = useTranslation("cellular");
  const reduceMotion = useMotionReduced();
  const { identity } = view;
  const unread = view.unread > 0;

  const relation = dayRelation(view.epochMs);
  const stamp = !view.epochMs
    ? ""
    : relation === "today"
      ? formatClock(view.epochMs, locale)
      : relation === "yesterday"
        ? t("sms.center.time.yesterday")
        : formatDay(view.epochMs, locale);

  return (
    <button
      type="button"
      ref={(el) => registerRowRef(view.addr, el)}
      onClick={() => onSelect(view.addr)}
      aria-current={selected ? "true" : undefined}
      className={cn(
        THREAD_ROW_FRAME,
        "focus-visible:ring-ring focus-visible:ring-offset-surface w-full text-left outline-none focus-visible:ring-[3px] focus-visible:ring-offset-2",
        "[transition:background-color_var(--duration-standard)_var(--ease-standard)]",
        selected ? "bg-surface-container-high" : "hover:bg-surface-container",
      )}
    >
      {/* Identity disc: tone hashed from the RAW address across this system's
          own container roles, never a carrier's brand colour. The disc itself
          shows the sender's logo when one resolves; see sms-identity-disc.tsx. */}
      <SmsIdentityDisc
        identity={identity}
        sizeClassName={THREAD_DISC_SIZE}
        textClassName="text-sm"
        glyphSize={19}
      />

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-sm font-bold tracking-[-0.005em]",
              identity.kind === "msisdn" && "font-mono tabular-nums",
            )}
          >
            {identity.title}
          </span>
          <span
            className={cn(
              "flex-none text-[0.6875rem] font-semibold tabular-nums",
              unread ? "text-on-surface" : "text-on-surface-variant",
            )}
          >
            {stamp}
          </span>
        </span>

        <span className="mt-1.5 flex items-center gap-2">
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-[0.78125rem] leading-[1.35]",
              unread
                ? "text-on-surface font-semibold"
                : "text-on-surface-variant",
            )}
          >
            {view.previewOutbound ? (
              <span className="text-on-surface-variant font-normal">
                {t("sms.center.preview.you")}{" "}
              </span>
            ) : null}
            {view.preview}
          </span>

          <AnimatePresence initial={false}>
            {unread ? (
              <motion.span
                key="unread"
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: reduceMotion ? 1 : 0 }}
                transition={{ duration: DUR.quick, ease: EASE_QUICK }}
                className="bg-primary text-primary-foreground rounded-pill flex h-5 min-w-5 flex-none items-center justify-center px-1.5 text-[0.6875rem] font-bold tabular-nums"
              >
                {view.unread}
                <span className="sr-only">
                  {" "}
                  {t("sms.center.a11y.unread_count", { count: view.unread })}
                </span>
              </motion.span>
            ) : null}
          </AnimatePresence>
        </span>
      </span>
    </button>
  );
}
