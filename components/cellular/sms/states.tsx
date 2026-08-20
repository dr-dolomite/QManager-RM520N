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

import { TILE_SHAPE } from "@/components/cellular/tile-shape";
import {
  INBOX_CARD,
  INBOX_PAD,
  INBOX_TITLE,
  PAGINATION_SKELETON,
  PILL_ACTION,
  ROWS_PER_PAGE,
  SKELETON_CHECKBOX,
  SKELETON_LINE,
  TABLE_SHAPE,
  TILE_GRID,
  TOOLBAR_SKELETON,
} from "./shapes";

// =============================================================================
// SMS Center non-loaded states — skeletons, the read-failure notice, empty inbox
// =============================================================================
// Every shape here is IMPORTED, never restated: `TILE_SHAPE` from the family's
// shared tile geometry and everything else from `./shapes.ts`, which the loaded
// views read too. That is the Skeleton-Mirror Rule working as intended.
//
// It had stopped working. The previous skeletons were a set of plausible-looking
// numbers rather than a mirror, and every one of them was wrong against the view
// it hands off to:
//
//   - a 44px tab strip against a real 38px one (`TabsList` is `h-auto gap-1 p-1`
//     around `h-9` triggers, which resolves to 38, not 44);
//   - ONE trailing pill where the loaded toolbar renders TWO (sort, and
//     mark-all-read);
//   - rows inset `px-3` against the loaded `px-4`;
//   - FIVE rows against a real `pageSize` of ten, so the card grew by half its
//     height at the handoff;
//   - a checkbox at the 12px inline radius where the real Radix control is 4px —
//     at 16px square that is a near-circle standing in for a near-square;
//   - no pagination footer at all, against a loaded footer carrying a select, a
//     page label and four icon buttons.
//
// None of those can recur now: the numbers live in one module and both ends
// import them.
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

// -----------------------------------------------------------------------------
// Tile strip skeleton
// -----------------------------------------------------------------------------

export function SmsTilesSkeleton({ label }: { label?: string }) {
  return (
    <div className={TILE_GRID}>
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
// a flash. Only the toolbar, the rows and the footer are placeholders.

export function InboxLoadingState() {
  const { t } = useTranslation("cellular");

  return (
    <Card className={INBOX_CARD}>
      <CardHeader className={INBOX_PAD}>
        <CardTitle className={INBOX_TITLE}>{t("sms.inbox.title")}</CardTitle>
        <CardDescription>{t("sms.inbox.description_loading")}</CardDescription>
      </CardHeader>
      <CardContent className={cn(INBOX_PAD, "flex flex-col gap-3.5")}>
        {/* Toolbar: tab strip, bounded search field, and BOTH trailing pills. */}
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className={TOOLBAR_SKELETON.TABS} />
          <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
            <Skeleton className={TOOLBAR_SKELETON.SEARCH} />
            {Array.from({ length: TOOLBAR_SKELETON.PILL_COUNT }).map((_, i) => (
              <Skeleton key={i} className={TOOLBAR_SKELETON.PILL} />
            ))}
          </div>
        </div>

        <div className={TABLE_SHAPE.SHELL}>
          <div
            className={cn(TABLE_SHAPE.HEAD, "flex h-10 items-center gap-3 px-4")}
          >
            <Skeleton className={SKELETON_CHECKBOX} />
            <Skeleton className={cn("h-3 w-12", SKELETON_LINE)} />
            <Skeleton className={cn("hidden h-3 w-16 @md/card:block", SKELETON_LINE)} />
            <Skeleton
              className={cn("ml-auto hidden h-3 w-12 @sm/card:block", SKELETON_LINE)}
            />
          </div>
          {Array.from({ length: ROWS_PER_PAGE }).map((_, i) => (
            <div
              key={i}
              className={cn(
                TABLE_SHAPE.ROW,
                TABLE_SHAPE.ROW_HEIGHT,
                "flex items-center gap-3 px-4",
              )}
            >
              <Skeleton className={SKELETON_CHECKBOX} />
              <Skeleton className={cn(TABLE_SHAPE.FLAG, "rounded-pill")} />
              <Skeleton className={cn("h-4 w-28", SKELETON_LINE)} />
              <Skeleton className={cn("hidden h-4 w-48 @md/card:block", SKELETON_LINE)} />
              <Skeleton
                className={cn("ml-auto hidden h-4 w-32 @sm/card:block", SKELETON_LINE)}
              />
              <Skeleton className="size-9 rounded-pill" />
            </div>
          ))}
        </div>

        {/* Pagination footer: the total label on the left, then the rows-per-page
            select, the page label and four icon buttons on the right. */}
        <div className="flex flex-col gap-3 px-1 @lg/card:flex-row @lg/card:items-center @lg/card:justify-between">
          <Skeleton className={PAGINATION_SKELETON.LABEL} />
          <div className="flex flex-wrap items-center justify-between gap-4 @lg/card:justify-end @lg/card:gap-6">
            <Skeleton
              className={cn(PAGINATION_SKELETON.SELECT, "hidden @sm/card:block")}
            />
            <Skeleton className={PAGINATION_SKELETON.LABEL} />
            <div className="flex items-center gap-1.5">
              {Array.from({ length: PAGINATION_SKELETON.BUTTON_COUNT }).map(
                (_, i) => (
                  <Skeleton key={i} className={PAGINATION_SKELETON.BUTTON} />
                ),
              )}
            </div>
          </div>
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
          className={PILL_ACTION}
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
      <span className="tabular-nums">
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
      {/* The Glyph-Disc Rule: a state icon sits in a filled circle on the role's
          STRONG FILL, never on its pale container — in light mode the containers
          collapse under CVD simulation and the fills do not, so the disc is the
          one place a role colour is reliably legible. The comment here used to
          cite that rule and then render `primary-container` anyway. An empty
          inbox is not a fault, so the role is the brand's own. */}
      <span
        aria-hidden="true"
        className="bg-primary text-primary-foreground grid size-[4.75rem] place-items-center rounded-pill"
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
      <Button onClick={onCompose} disabled={isSaving} className={PILL_ACTION}>
        <MaterialSymbol name="edit" size={18} />
        {t("sms.inbox.buttons.new_message")}
      </Button>
    </div>
  );
}
