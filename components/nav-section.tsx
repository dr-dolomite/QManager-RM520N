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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { NavMenu } from "@/components/nav-menu";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  isItemActive,
  isSubActive,
  normalizePath,
  subRowsOf,
  type NavItem,
  type NavStatus,
} from "@/lib/nav-tree";
import { cn } from "@/lib/utils";

export type { NavItem, NavStatus, NavSubItem } from "@/lib/nav-tree";

// =============================================================================
// NavSection — the one nav group implementation
// =============================================================================
// Replaces nav-main / nav-cellular / nav-localNetwork / nav-monitoring /
//
// A row with sub-items is a pure expander (its page is the first sub-row); leaf rows are links.
// On the icon rail an expander opens a flyout.
//
// Labels never live here. `t_key` resolves through the "sidebar" namespace.
// =============================================================================

export interface NavSectionProps
  extends React.ComponentPropsWithoutRef<typeof SidebarGroup> {
  /** i18n key under "groups". Omitted for the unlabelled footer group. */
  groupKey?: string;
  items: NavItem[];
  /** "sm" is the quieter footer group (About / Support / Donate). */
  size?: "default" | "sm";
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

/** Which expanders should be open for a route: exactly the one holding it. */
function openStateFor(pathname: string, items: NavItem[]) {
  const next: Record<string, boolean> = {};
  items.forEach((item) => {
    if (item.items?.length) next[item.t_key] = isItemActive(pathname, item);
  });
  return next;
}

export function NavSection({
  groupKey,
  items,
  size = "default",
  className,
  ...props
}: NavSectionProps) {
  const { t } = useTranslation("sidebar");
  const pathname = normalizePath(usePathname());
  const { state, isMobile, setOpenMobile } = useSidebar();
  const iconRail = state === "collapsed" && !isMobile;
  // Below the desktop breakpoint the sidebar is a sheet: leaving rows dismiss it,
  // expanders never do.
  const dismissSheet = React.useCallback(() => {
    if (isMobile) setOpenMobile(false);
  }, [isMobile, setOpenMobile]);

  // Sections auto-open to reveal where you are, and stay user-controllable
  // after that. A navigation re-derives them during render (not in an effect),
  // so the right section is already open in the frame the route lands.
  const [openItems, setOpenItems] = React.useState(() =>
    openStateFor(pathname, items),
  );
  const [openFor, setOpenFor] = React.useState(pathname);
  if (openFor !== pathname) {
    setOpenFor(pathname);
    setOpenItems(openStateFor(pathname, items));
  }

  return (
    <SidebarGroup className={className} {...props}>
      {groupKey ? (
        <SidebarGroupLabel>{t(`groups.${groupKey}`)}</SidebarGroupLabel>
      ) : null}
      <NavMenu>
        {items.map((item) => {
          const label = t(`items.${item.t_key}`);
          const isActive = isItemActive(pathname, item);
          const subs = subRowsOf(item);

          const glyph = (
            <MaterialSymbol
              name={item.icon}
              // The donate heart is always filled: its meaning is the glyph, not selection.
              filled={isActive || item.t_key === "donate"}
              size={size === "sm" ? 18 : 20}
              className={cn(
                item.t_key === "donate" && !isActive && "text-uplink",
              )}
            />
          );

          if (!subs.length) {
            const row = (
              <>
                {glyph}
                <span className="min-w-0 flex-1 truncate">{label}</span>
                {item.status ? (
                  <span className="shrink-0 text-xs font-medium tracking-tight tabular-nums">
                    {item.status.label}
                  </span>
                ) : null}
              </>
            );

            return (
              <SidebarMenuItem key={item.t_key}>
                <SidebarMenuButton
                  asChild={!item.onClick}
                  size={size}
                  tooltip={item.status?.description ?? label}
                  isActive={isActive}
                  onClick={() => {
                    dismissSheet();
                    item.onClick?.();
                  }}
                  className={cn(item.status && STATUS_TONE[item.status.tone])}
                >
                  {item.onClick ? row : <Link href={item.url}>{row}</Link>}
                </SidebarMenuButton>
                {item.status ? (
                  <span className="sr-only" role="status">
                    {item.status.description}
                  </span>
                ) : null}
              </SidebarMenuItem>
            );
          }

          // Collapsed rail: the glyph opens the section's rows beside it.
          if (iconRail) {
            return (
              <SidebarMenuItem key={item.t_key}>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <SidebarMenuButton
                      size={size}
                      tooltip={label}
                      isActive={isActive}
                    >
                      {glyph}
                      <span>{label}</span>
                    </SidebarMenuButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    side="right"
                    align="start"
                    sideOffset={8}
                    className="min-w-52"
                  >
                    <DropdownMenuLabel className="text-muted-foreground text-xs">
                      {label}
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {subs.map((sub) => {
                      const current = isSubActive(pathname, sub);
                      return (
                        <DropdownMenuItem key={sub.t_key} asChild>
                          <Link
                            href={sub.url}
                            aria-current={current ? "page" : undefined}
                            className={cn(current && "font-medium")}
                          >
                            <span className="min-w-0 flex-1 truncate">
                              {t(`items.${sub.t_key}`)}
                            </span>
                            {current ? (
                              <MaterialSymbol
                                name="check"
                                size={16}
                                className="text-primary"
                              />
                            ) : null}
                          </Link>
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              </SidebarMenuItem>
            );
          }

          return (
            <Collapsible
              key={item.t_key}
              asChild
              open={openItems[item.t_key] ?? false}
              onOpenChange={(open) =>
                setOpenItems((prev) => ({ ...prev, [item.t_key]: open }))
              }
              className="group/collapsible"
            >
              <SidebarMenuItem>
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton
                    size={size}
                    tooltip={label}
                    isActive={isActive}
                  >
                    {glyph}
                    <span className="min-w-0 flex-1 truncate">{label}</span>
                    <MaterialSymbol
                      name="chevron_right"
                      size={18}
                      className="text-sidebar-foreground/60 ease-standard shrink-0 transition-transform duration-[var(--duration-standard)] group-data-[state=open]/collapsible:rotate-90 motion-reduce:transition-none"
                    />
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {subs.map((sub) => (
                      <SidebarMenuSubItem key={sub.t_key}>
                        <SidebarMenuSubButton
                          asChild
                          isActive={isSubActive(pathname, sub)}
                        >
                          <Link href={sub.url} onClick={dismissSheet}>
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
