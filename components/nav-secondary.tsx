"use client"

import * as React from "react"
import { type LucideIcon } from "lucide-react"
import Link from "next/link"
import { useTranslation } from "react-i18next"

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

export function NavSecondary({
  items,
  ...props
}: {
  items: {
    t_key: string
    url: string
    icon: LucideIcon
    disabled?: boolean
    onClick?: () => void
  }[]
} & React.ComponentPropsWithoutRef<typeof SidebarGroup>) {
  const { t } = useTranslation("sidebar")

  return (
    <SidebarGroup {...props}>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            const label = t(`items.${item.t_key}`)
            return (
              <SidebarMenuItem key={item.t_key}>
                {item.disabled ? (
                  <SidebarMenuButton size="sm" disabled className="opacity-50 pointer-events-none">
                    <item.icon />
                    <span>{label}</span>
                  </SidebarMenuButton>
                ) : item.onClick ? (
                  <SidebarMenuButton size="sm" onClick={item.onClick}>
                    <item.icon />
                    <span>{label}</span>
                  </SidebarMenuButton>
                ) : (
                  <SidebarMenuButton asChild size="sm">
                    <Link href={item.url}>
                      <item.icon />
                      <span>{label}</span>
                    </Link>
                  </SidebarMenuButton>
                )}
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
