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

type MonitoringItem = {
  t_key: string
  url: string
  icon: LucideIcon
  isActive?: boolean
  disabled?: boolean
  items?: { t_key: string; url: string }[]
}

export function NavMonitoring({
  monitoring,
}: {
  monitoring: MonitoringItem[]
}) {
  const { t } = useTranslation("sidebar")
  const rawPathname = usePathname()
  const pathname = rawPathname.endsWith('/') && rawPathname !== '/' ? rawPathname.slice(0, -1) : rawPathname
  const [openItems, setOpenItems] = React.useState<Record<string, boolean>>({})

  React.useEffect(() => {
    const states: Record<string, boolean> = {}
    monitoring.forEach((item) => {
      states[item.t_key] = pathname === item.url || (!!item.items?.length && item.items.some(sub => pathname === sub.url || pathname.startsWith(sub.url + "/")))
    })
    setOpenItems(states)
  }, [pathname, monitoring])

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{t("groups.monitoring")}</SidebarGroupLabel>
      <SidebarMenu>
        {monitoring.map((item) => {
          const isParentOrChildActive = pathname === item.url || (!!item.items?.length && item.items.some(sub => pathname === sub.url || pathname.startsWith(sub.url + "/")))
          const label = t(`items.${item.t_key}`)

          return (
          <Collapsible
            key={item.t_key}
            asChild
            open={openItems[item.t_key] ?? false}
            onOpenChange={(isOpen) => setOpenItems((prev) => ({ ...prev, [item.t_key]: isOpen }))}
          >
            <SidebarMenuItem>
              {item.disabled ? (
                <SidebarMenuButton tooltip={label} disabled className="opacity-50 pointer-events-none">
                  <item.icon />
                  <span>{label}</span>
                </SidebarMenuButton>
              ) : (
                <SidebarMenuButton asChild tooltip={label} isActive={isParentOrChildActive}>
                  <Link href={item.url}>
                    <item.icon />
                    <span>{label}</span>
                  </Link>
                </SidebarMenuButton>
              )}
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
