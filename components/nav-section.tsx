"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslation } from "react-i18next";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  MaterialSymbol,
  type MaterialSymbolName,
} from "@/components/ui/material-symbol";
import { NavMenu } from "@/components/nav-menu";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

// =============================================================================
// NavSection — the one nav group implementation
// =============================================================================
// Replaces nav-main / nav-cellular / nav-localNetwork / nav-monitoring /
// nav-system / nav-secondary, which were six near-copies of this file. They had
// already drifted apart in a way that mattered: nav-main decided "is this row
// active" by URL prefix, which makes /cellular light up while you are on
// /cellular/settings, and nav-cellular carried a comment-documented fix for
// exactly that. Consolidating adopts the fixed logic everywhere.
//
// Labels never live here. `t_key` resolves through the "sidebar" namespace.
// =============================================================================

/**
 * A live condition worth surfacing on the nav row itself, so a user who is not
 * on the Monitoring page still learns the watchdog is intervening.
 *
 * The tone must describe what the device is doing, not how alarming it sounds:
 * `recovery` is the modem being acted on (destructive), `cooldown` is the
 * modem being watched to see whether the action held (warning). Anything that
 * cannot be read off live state does not belong here at all.
 */
export interface NavStatus {
  tone: "destructive" | "warning";
  /** Short machine-voice tag rendered in the pill, e.g. "acting". */
  label: string;
  /** Sentence a screen reader and tooltip get instead of the terse tag. */
  description: string;
}

export interface NavSubItem {
  t_key: string;
  url: string;
}

export interface NavItem {
  t_key: string;
  url: string;
  icon: MaterialSymbolName;
  items?: NavSubItem[];
  /** Renders a button instead of a link (the donate dialog). */
  onClick?: () => void;
  status?: NavStatus;
}

export interface NavSectionProps
  extends React.ComponentPropsWithoutRef<typeof SidebarGroup> {
  /** i18n key under "groups". Omitted for the unlabelled footer group. */
  groupKey?: string;
  items: NavItem[];
  /** "sm" is the quieter footer group (About / Support / Donate). */
  size?: "default" | "sm";
}

/** Trailing slashes come and go with the static export; normalise once. */
function normalize(pathname: string) {
  return pathname.endsWith("/") && pathname !== "/"
    ? pathname.slice(0, -1)
    : pathname;
}

const STATUS_TONE: Record<NavStatus["tone"], string> = {
  // Filled tonal containers, per DESIGN.md. These sit above the sliding
  // indicator in stacking order, so an alerting row that is also the active row
  // reads as the alert — which is the correct priority.
  destructive:
    "bg-destructive-container text-on-destructive-container hover:bg-destructive-container data-[active=true]:bg-destructive-container data-[active=true]:text-on-destructive-container",
  warning:
    "bg-warning-container text-on-warning-container hover:bg-warning-container data-[active=true]:bg-warning-container data-[active=true]:text-on-warning-container",
};

export function NavSection({
  groupKey,
  items,
  size = "default",
  className,
  ...props
}: NavSectionProps) {
  const { t } = useTranslation("sidebar");
  const pathname = normalize(usePathname());

  // A row is active when the route IS it, when a route below it belongs to it
  // (leaf rows only), or when one of its DECLARED sub-routes is current. The
  // leaf clause is what stops /cellular from claiming /cellular/settings, which
  // is a different nav row entirely.
  const isItemActive = React.useCallback(
    (item: NavItem) => {
      if (item.onClick) return false;
      if (pathname === item.url) return true;
      if (item.items?.length) {
        return item.items.some(
          (sub) => pathname === sub.url || pathname.startsWith(sub.url + "/"),
        );
      }
      return pathname.startsWith(item.url + "/");
    },
    [pathname],
  );

  // Sections auto-open to reveal where you are, and stay user-controllable
  // after that. Keyed by route so a navigation re-opens the right one.
  const [openItems, setOpenItems] = React.useState<Record<string, boolean>>({});

  React.useEffect(() => {
    const next: Record<string, boolean> = {};
    items.forEach((item) => {
      next[item.t_key] = isItemActive(item);
    });
    setOpenItems(next);
  }, [pathname, items, isItemActive]);

  return (
    <SidebarGroup className={className} {...props}>
      {groupKey ? (
        <SidebarGroupLabel>{t(`groups.${groupKey}`)}</SidebarGroupLabel>
      ) : null}
      <NavMenu>
        {items.map((item) => {
          const label = t(`items.${item.t_key}`);
          const isActive = isItemActive(item);
          const hasChildren = Boolean(item.items?.length);
          const isOpen = openItems[item.t_key] ?? false;

          const row = (
            <>
              <MaterialSymbol
                name={item.icon}
                // Fill is the grayscale-safe half of the active state, and the
                // donate heart is the one row that is always filled because its
                // meaning is the glyph, not its selection state.
                filled={isActive || item.t_key === "donate"}
                size={size === "sm" ? 18 : 20}
                className={cn(
                  item.t_key === "donate" && !isActive && "text-uplink",
                )}
              />
              <span className="min-w-0 flex-1 truncate">{label}</span>
              {item.status ? (
                <span className="font-mono shrink-0 text-xs font-medium tracking-tight tabular-nums">
                  {item.status.label}
                </span>
              ) : null}
            </>
          );

          const button = (
            <SidebarMenuButton
              asChild={!item.onClick}
              size={size}
              tooltip={item.status?.description ?? label}
              isActive={isActive}
              onClick={item.onClick}
              className={cn(item.status && STATUS_TONE[item.status.tone])}
            >
              {item.onClick ? row : <Link href={item.url}>{row}</Link>}
            </SidebarMenuButton>
          );

          if (!hasChildren) {
            return (
              <SidebarMenuItem key={item.t_key}>
                {button}
                {item.status ? (
                  <span className="sr-only" role="status">
                    {item.status.description}
                  </span>
                ) : null}
              </SidebarMenuItem>
            );
          }

          return (
            <Collapsible
              key={item.t_key}
              asChild
              open={isOpen}
              onOpenChange={(open) =>
                setOpenItems((prev) => ({ ...prev, [item.t_key]: open }))
              }
            >
              <SidebarMenuItem>
                {button}
                <CollapsibleTrigger asChild>
                  <SidebarMenuAction className="data-[state=open]:rotate-90">
                    <MaterialSymbol name="chevron_right" size={18} />
                    <span className="sr-only">
                      {t("actions.toggle_section", { section: label })}
                    </span>
                  </SidebarMenuAction>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {item.items?.map((sub) => (
                      <SidebarMenuSubItem key={sub.t_key}>
                        <SidebarMenuSubButton
                          asChild
                          isActive={
                            pathname === sub.url ||
                            pathname.startsWith(sub.url + "/")
                          }
                        >
                          <Link href={sub.url}>
                            <span>{t(`items.${sub.t_key}`)}</span>
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </SidebarMenuItem>
            </Collapsible>
          );
        })}
      </NavMenu>
    </SidebarGroup>
  );
}
