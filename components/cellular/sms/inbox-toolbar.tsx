"use client";

import { useTranslation } from "react-i18next";

import { MaterialSymbol } from "@/components/ui/material-symbol";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import { TOOLBAR_PILL } from "./shapes";

// =============================================================================
// InboxToolbar — tab filter, search, sort direction, and "mark all read"
// =============================================================================
// The mock's sort control is `border:1px solid var(--out)`. `--outline` is for
// input strokes and genuine table rules only, so both trailing actions are a
// FILL on `surface-container` rather than a stroke (the Fill-Over-Stroke Rule).
//
// The toolbar wraps and every control clears 44px on a coarse pointer, because
// this page is used on a tablet in the field.
// =============================================================================

export type SmsTab = "all" | "unread" | "read";

export type SmsSortDir = "newest" | "oldest";

interface InboxToolbarProps {
  tab: SmsTab;
  onTabChange: (tab: SmsTab) => void;
  search: string;
  onSearchChange: (search: string) => void;
  sortDir: SmsSortDir;
  onSortDirChange: (sortDir: SmsSortDir) => void;
  unreadCount: number;
  onMarkAllRead: () => void;
}

export function InboxToolbar({
  tab,
  onTabChange,
  search,
  onSearchChange,
  sortDir,
  onSortDirChange,
  unreadCount,
  onMarkAllRead,
}: InboxToolbarProps) {
  const { t } = useTranslation("cellular");

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Tabs value={tab} onValueChange={(v) => onTabChange(v as SmsTab)}>
        {/* The indicator is the filled pill sliding between the three triggers,
            on the standard clock. `TabsList`/`TabsTrigger` default to the legacy
            `rounded-lg` + a white `bg-background` active chip with a shadow, so
            the pill shape and the tonal fill are applied at the call site — the
            Migration Delta for shape living at the call site rather than in the
            primitive. */}
        <TabsList className="rounded-pill bg-surface-container h-auto gap-1 p-1">
          {(["all", "unread", "read"] as const).map((value) => (
            <TabsTrigger
              key={value}
              value={value}
              className={cn(
                "rounded-pill h-9 gap-2 border-0 px-4 text-sm font-medium",
                "text-on-surface-variant data-[state=active]:text-primary-foreground",
                "dark:data-[state=active]:text-primary-foreground",
                "data-[state=active]:bg-primary dark:data-[state=active]:bg-primary",
                "data-[state=active]:shadow-none",
                "pointer-coarse:h-11",
                // `components/ui/tabs.tsx` transitions `[color,box-shadow]` and
                // nothing else — `background-color` is not in that list at all,
                // so the active pill's fill CUT in with no transition while its
                // ink faded. The two-clock longhand below is the same spelling
                // `components/ui/badge.tsx` uses, and it is written here rather
                // than in the primitive because Tabs is shared with other
                // routes (The One-Scale Rule).
                "[transition:color_var(--duration-standard)_var(--ease-standard),background-color_var(--duration-standard)_var(--ease-standard),box-shadow_var(--duration-quick)_ease-out]",
              )}
            >
              {t(`sms.inbox.tabs.${value}`)}
              {value === "unread" && unreadCount > 0 && (
                // A count, not a status — and it INHERITS the trigger's ink
                // rather than taking a chip role of its own. A `default` badge
                // here would be `bg-primary` on a `bg-primary` active pill
                // (invisible), and a status role would claim a meaning this
                // number does not carry. A count is a changing figure, so it
                // stays tabular-nums.
                <span className="text-xs tabular-nums opacity-80">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
        <div className="relative min-w-[12rem] flex-1 @lg/card:max-w-[15rem] @lg/card:flex-initial">
          <MaterialSymbol
            name="search"
            size={18}
            className="text-on-surface-variant pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t("sms.inbox.search.placeholder")}
            aria-label={t("sms.inbox.search.aria")}
            className="rounded-field bg-surface-container h-9 w-full border-0 pl-10 pointer-coarse:h-11"
          />
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="tonal-neutral"
              className={TOOLBAR_PILL}
              aria-label={t("sms.inbox.sort.aria")}
            >
              <MaterialSymbol name="unfold_more" size={17} />
              <span className="hidden @sm/card:inline">
                {sortDir === "newest"
                  ? t("sms.inbox.sort.newest")
                  : t("sms.inbox.sort.oldest")}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{t("sms.inbox.sort.label")}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup
              value={sortDir}
              onValueChange={(v) => onSortDirChange(v as SmsSortDir)}
            >
              <DropdownMenuRadioItem value="newest">
                {t("sms.inbox.sort.newest")}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="oldest">
                {t("sms.inbox.sort.oldest")}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {unreadCount > 0 && (
          <Button
            variant="tonal-neutral"
            onClick={onMarkAllRead}
            className={TOOLBAR_PILL}
            aria-label={t("sms.inbox.buttons.mark_all_read_aria")}
          >
            <MaterialSymbol name="done_all" size={17} />
            <span className="hidden @sm/card:inline">
              {t("sms.inbox.buttons.mark_all_read")}
            </span>
          </Button>
        )}
      </div>
    </div>
  );
}
