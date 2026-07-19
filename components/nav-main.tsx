"use client";

import * as React from "react";
import { ChevronRight, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslation } from "react-i18next";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";

type NavItem = {
  t_key: string;
  url: string;
  icon: LucideIcon;
  isActive?: boolean;
  items?: {
    t_key: string;
    url: string;
  }[];
};

export function NavMain({ items }: { items: NavItem[] }) {
  const { t } = useTranslation("sidebar");
  const rawPathname = usePathname();
  const pathname = rawPathname.endsWith('/') && rawPathname !== '/' ? rawPathname.slice(0, -1) : rawPathname;
  const [openItems, setOpenItems] = React.useState<Record<string, boolean>>({});

  React.useEffect(() => {
    const states: Record<string, boolean> = {};
    items.forEach((item) => {
      states[item.t_key] = pathname === item.url || pathname.startsWith(item.url + "/");
    });
    setOpenItems(states);
  }, [pathname, items]);

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{t("groups.dashboard")}</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => {
          const isActive = pathname === item.url || pathname.startsWith(item.url + "/");
          const label = t(`items.${item.t_key}`);
          return (
            <Collapsible
              key={item.t_key}
              asChild
              open={openItems[item.t_key] ?? false}
              onOpenChange={(isOpen) =>
                setOpenItems((prev) => ({ ...prev, [item.t_key]: isOpen }))
              }
            >
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  tooltip={label}
                  isActive={isActive}
                >
                  <Link href={item.url}>
                    <item.icon />
                    <span>{label}</span>
                  </Link>
                </SidebarMenuButton>
                {item.items?.length ? (
                  <>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuAction className="data-[state=open]:rotate-90">
                        <ChevronRight />
                        <span className="sr-only">Toggle</span>
                      </SidebarMenuAction>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {item.items?.map((subItem) => (
                          <SidebarMenuSubItem key={subItem.t_key}>
                            <SidebarMenuSubButton asChild>
                              <Link href={subItem.url}>
                                <span>{t(`items.${subItem.t_key}`)}</span>
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </>
                ) : null}
              </SidebarMenuItem>
            </Collapsible>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}
