"use client";

import Image from "next/image";
import Link from "next/link";

import QManagerMark from "@/public/qmanager-mark.svg";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { APP_VERSION } from "@/lib/i18n/app-version";

// Sidebar header: a plain link home that shrinks to the mark on the icon rail.
export function SidebarBrand() {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton size="lg" className="gap-2.5 px-2.5" asChild>
          <Link href="/dashboard">
            <Image
              src={QManagerMark}
              alt=""
              aria-hidden="true"
              className="size-[1.875rem] shrink-0"
              priority
            />
            <div className="grid flex-1 text-left leading-tight">
              <span className="truncate text-sm font-semibold">QManager</span>
              <span className="text-sidebar-foreground/70 truncate text-xs tabular-nums">
                {APP_VERSION}
              </span>
            </div>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
