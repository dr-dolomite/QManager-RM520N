"use client";

import { useTranslation } from "react-i18next";

import { MaterialSymbol } from "@/components/ui/material-symbol";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TonalBanner } from "@/components/ui/tonal-banner";
import { cn } from "@/lib/utils";

import { TILE_SHAPE } from "@/components/cellular/radio/summary-tiles";
import { SMS_TILE_GRID } from "./summary-tiles";
import { TABLE_SHAPE } from "./inbox-table";

// =============================================================================
// SMS Center non-loaded states — skeletons, the read-failure notice, empty inbox
// =============================================================================
// Every shape here is IMPORTED, never restated: `TILE_SHAPE` from the Radio
// Information strip, `SMS_TILE_GRID` from this page's own tile strip, and
// `TABLE_SHAPE` from the table beside it. That is the Skeleton-Mirror Rule
// working as intended — the incumbent skeleton hardcoded `h-8 w-9`, `size-4` and
// `h-4 w-28`, none of which corresponded to anything in the loaded view, so the
// handoff visibly jumped.
//
// THE ERROR STATE IS NOT A REPLACEMENT. The mock hides the table on a read
// failure and says so in its own copy. That is the State-Honesty Rule read
// backwards. A failed inbox GET is usually transient `modem_busy` lock
// contention — another AT consumer holding `/tmp/qmanager_at.lock` for a cycle —
// and blanking an inbox for that is a functional regression, not honesty. The
// Carrier Aggregation precedent is explicit about the correct behaviour: the
// list *freezes* while data is stale rather than announcing changes that never
// happened. So the rows stay, a destructive banner explains, and a `warning`
// staleness chip dates what is on screen.
// =============================================================================

/**
 * The Inbox card shell. This is the page's anchor surface, so it takes the hero
 * radius, no border, and the whisper lift (`shadow-whisper` as a bare utility
 * does NOT resolve — it must go through the custom property).
 */
export const INBOX_CARD =
  "@container/card gap-5 rounded-hero border-0 bg-surface py-6 shadow-[var(--shadow-whisper)]";

/** Hero-card padding: 28px, against the standard card's 24px. */
export const INBOX_PAD = "px-7";

/** The card title's own step: Title, 18px/600. The mock's 22px is not a step. */
export const INBOX_TITLE = "text-lg";

// -----------------------------------------------------------------------------
// Tile strip skeleton
// -----------------------------------------------------------------------------

export function SmsTilesSkeleton({ label }: { label?: string }) {
  return (
    <div className={SMS_TILE_GRID}>
      {label && <span className="sr-only">{label}</span>}
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className={cn(TILE_SHAPE.HEIGHT, "rounded-tile")} />
      ))}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Inbox card skeleton
// -----------------------------------------------------------------------------
// The header is REAL text, never skeletonised: the card's identity is known
// before its rows are, and greying out a heading we can already render only adds
// a flash. Only the toolbar and the rows are placeholders.

export function InboxLoadingState() {
  const { t } = useTranslation("cellular");

  return (
    <Card className={INBOX_CARD}>
      <CardHeader className={INBOX_PAD}>
        <CardTitle className={INBOX_TITLE}>{t("sms.inbox.title")}</CardTitle>
        <CardDescription>{t("sms.inbox.description_loading")}</CardDescription>
      </CardHeader>
      <CardContent className={cn(INBOX_PAD, "flex flex-col gap-3.5")}>
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="rounded-pill h-11 w-[17rem]" />
          <div className="flex flex-1 items-center justify-end gap-2">
            <Skeleton className="rounded-field h-9 w-full max-w-[15rem]" />
            <Skeleton className="rounded-pill h-9 w-28" />
          </div>
        </div>

        <div className={TABLE_SHAPE.SHELL}>
          <div className={cn(TABLE_SHAPE.HEAD, "flex h-10 items-center gap-3 px-3")}>
            <Skeleton className="size-4 rounded-inline" />
            <Skeleton className="h-3 w-12" />
            <Skeleton className="hidden h-3 w-16 @md/card:block" />
            <Skeleton className="ml-auto hidden h-3 w-12 @sm/card:block" />
          </div>
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className={cn(
                TABLE_SHAPE.ROW,
                TABLE_SHAPE.ROW_HEIGHT,
                "flex items-center gap-3 px-3",
              )}
            >
              <Skeleton className="size-4 rounded-inline" />
              <Skeleton className={cn(TABLE_SHAPE.FLAG, "rounded-pill")} />
              <Skeleton className="h-4 w-28" />
              <Skeleton className="hidden h-4 w-48 @md/card:block" />
              <Skeleton className="ml-auto hidden h-4 w-32 @sm/card:block" />
              <Skeleton className="size-9 rounded-pill" />
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between px-1">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="rounded-pill h-9 w-40" />
        </div>
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// Read-failure notice
// -----------------------------------------------------------------------------

interface InboxErrorNoticeProps {
  /** Error from the hook (fetch or mutation failure) */
  error: string;
  /** True when there is nothing on screen behind the notice. */
  hasStaleRows: boolean;
  onRetry: () => void;
  isRetrying: boolean;
}

export function InboxErrorNotice({
  error,
  hasStaleRows,
  onRetry,
  isRetrying,
}: InboxErrorNoticeProps) {
  const { t } = useTranslation("cellular");

  return (
    <div className="flex flex-col gap-3">
      <TonalBanner
        tone="destructive"
        icon="error"
        title={t("sms.inbox.error.title")}
        role="alert"
      >
        <span className="flex flex-col gap-1">
          {/* Raw device output is machine voice. */}
          <span className="font-mono text-xs leading-relaxed break-words">
            {error}
          </span>
          <span>
            {hasStaleRows
              ? t("sms.inbox.error.body_stale")
              : t("sms.inbox.error.body_empty")}
          </span>
        </span>
      </TonalBanner>
      <div>
        <Button
          variant="destructive"
          onClick={onRetry}
          disabled={isRetrying}
          className="h-[2.625rem] gap-2 rounded-pill px-5 text-sm font-semibold"
        >
          <MaterialSymbol
            name={isRetrying ? "progress_activity" : "refresh"}
            size={18}
            className={isRetrying ? "animate-spin motion-reduce:animate-none" : undefined}
          />
          {t("actions.retry", { ns: "common" })}
        </Button>
      </div>
    </div>
  );
}

/**
 * Dates the rows behind a failed read. `warning`, not `destructive`: the data is
 * old, which is a degraded state, while the *failure* is what the banner above
 * already reports in destructive. Two states in one region, two glyphs.
 */
export function InboxStaleChip({ atMs }: { atMs: number }) {
  const { t } = useTranslation("cellular");

  // Derived from a STORED stamp, never from `Date.now()` during render — a
  // render-time clock read is a `react-hooks/purity` violation, and one purity
  // error suppresses every later diagnostic in the same component.
  const clock = new Date(atMs).toLocaleTimeString(undefined, {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <Badge variant="warning">
      <MaterialSymbol name="warning" filled size={12} aria-hidden="true" />
      <span className="font-mono tabular-nums">
        {t("sms.inbox.stale_chip", { time: clock })}
      </span>
    </Badge>
  );
}

// -----------------------------------------------------------------------------
// Empty inbox
// -----------------------------------------------------------------------------

interface InboxEmptyStateProps {
  isSaving: boolean;
  onCompose: () => void;
}

export function InboxEmptyState({ isSaving, onCompose }: InboxEmptyStateProps) {
  const { t } = useTranslation("cellular");

  return (
    <div className="flex flex-col items-center gap-4 py-12 text-center">
      {/* Glyph-Disc Rule: a state icon sits in a filled circle on the role's
          strong fill, which is what survives when a container washes out. An
          empty inbox is not a fault, so the tone is the brand's own container. */}
      <span
        aria-hidden="true"
        className="bg-primary-container text-on-primary-container grid size-[4.75rem] place-items-center rounded-pill"
      >
        <MaterialSymbol name="sms" filled size={38} />
      </span>
      <div className="flex max-w-[26rem] flex-col gap-1.5">
        <p className="text-xl font-semibold tracking-[-0.01em]">
          {t("sms.inbox.empty_state.title")}
        </p>
        <p className="text-on-surface-variant text-sm leading-relaxed text-pretty">
          {t("sms.inbox.empty_state.description")}
        </p>
      </div>
      <Button
        onClick={onCompose}
        disabled={isSaving}
        className="h-[2.625rem] gap-2 rounded-pill px-5 text-sm font-semibold"
      >
        <MaterialSymbol name="edit" size={18} />
        {t("sms.inbox.buttons.new_message")}
      </Button>
    </div>
  );
}
