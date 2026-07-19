"use client"

import * as React from "react"
import { ChevronRight, type LucideIcon } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useTranslation } from "react-i18next"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"

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
} from "@/components/ui/sidebar"

type CellularItem = {
  t_key: string
  url: string
  icon: LucideIcon
  isActive?: boolean
  items?: { t_key: string; url: string }[]
}

export function NavCellular({ cellular }: { cellular: CellularItem[] }) {
  const { t } = useTranslation("sidebar")
  const rawPathname = usePathname()
  const pathname = rawPathname.endsWith('/') && rawPathname !== '/' ? rawPathname.slice(0, -1) : rawPathname
  const [openItems, setOpenItems] = React.useState<Record<string, boolean>>({})

  // Check if the current path matches the item or any of its declared sub-items.
  // Uses sub-item URLs instead of prefix matching to avoid false positives
  // (e.g., "/cellular" matching "/cellular/settings" which belongs to a different nav item).
  const isItemActive = React.useCallback((item: CellularItem) => {
    if (pathname === item.url) return true
    if (item.items?.some((sub) => pathname === sub.url || pathname.startsWith(sub.url + "/"))) return true
    return false
  }, [pathname])

  React.useEffect(() => {
    const states: Record<string, boolean> = {}
    cellular.forEach((item) => {
      states[item.t_key] = isItemActive(item)
    })
    setOpenItems(states)
  }, [pathname, cellular, isItemActive])

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{t("groups.cellular")}</SidebarGroupLabel>
      <SidebarMenu>
        {cellular.map((item) => {
          const isParentOrChildActive = isItemActive(item)
          const label = t(`items.${item.t_key}`)

          return (
          <Collapsible
            key={item.t_key}
            asChild
            open={openItems[item.t_key] ?? false}
            onOpenChange={(isOpen) => setOpenItems((prev) => ({ ...prev, [item.t_key]: isOpen }))}
          >
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip={label} isActive={isParentOrChildActive}>
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
                      {item.items?.map((subItem) => {
                        const isSubItemActive = pathname === subItem.url || pathname.startsWith(subItem.url + "/")
                        return (
                        <SidebarMenuSubItem key={subItem.t_key}>
                          <SidebarMenuSubButton asChild isActive={isSubItemActive}>
                            <Link href={subItem.url}>
                              <span>{t(`items.${subItem.t_key}`)}</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      )})}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </>
              ) : null}
            </SidebarMenuItem>
          </Collapsible>
        )})}
      </SidebarMenu>
    </SidebarGroup>
  )
}
