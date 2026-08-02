"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";

import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

import { Separator } from "@/components/ui/separator";
import { AppSidebar } from "@/components/app-sidebar";
import { useBreadcrumbs } from "@/hooks/use-breadcrumbs";
import { SimSwapBanner } from "@/components/monitoring/watchdog/sim-swap-banner";
import { isLoggedIn } from "@/hooks/use-auth";
import { useAutoLogout } from "@/hooks/use-auto-logout";
import { DUR, EASE_STANDARD } from "@/lib/motion";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const breadcrumbs = useBreadcrumbs();
  const pathname = usePathname();
  useAutoLogout();

  // Sync cookie check — no API call, no loading state.
  // `location.replace()` rather than assigning `location.href`: an auth bounce
  // should not leave a history entry, or Back returns to the gated route,
  // re-trips this guard and bounces again. It also keeps the redirect out of
  // react-hooks/immutability's way — the rule objects to assigning an outer
  // binding during render, not to calling a method on one.
  if (typeof document !== "undefined" && !isLoggedIn()) {
    window.location.replace("/login/");
    return null;
  }

  return (
    <SidebarProvider>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg focus:ring-2 focus:ring-ring"
      >
        Skip to main content
      </a>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator
              orientation="vertical"
              className="mr-2 data-[orientation=vertical]:h-4"
            />
            <Breadcrumb>
              <BreadcrumbList>
                {breadcrumbs.map((breadcrumb, index) => (
                  <React.Fragment key={breadcrumb.href}>
                    {index > 0 && (
                      <BreadcrumbSeparator className="hidden desktop:block" />
                    )}
                    <BreadcrumbItem
                      className={
                        breadcrumb.isCurrentPage ? "" : "hidden desktop:block"
                      }
                    >
                      {breadcrumb.isCurrentPage ? (
                        <BreadcrumbPage>{breadcrumb.label}</BreadcrumbPage>
                      ) : (
                        <BreadcrumbLink href={breadcrumb.href}>
                          {breadcrumb.label}
                        </BreadcrumbLink>
                      )}
                    </BreadcrumbItem>
                  </React.Fragment>
                ))}
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>
        <SimSwapBanner />
        <motion.div
          id="main-content"
          key={pathname}
          className="px-2 lg:px-6 py-4"
          // Motion Study spec 1: route content rises 10px and fades, on the
          // Material standard curve. Enter only, no exit — the outgoing page is
          // already gone, and animating it out would delay the incoming one.
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: DUR.standard, ease: EASE_STANDARD }}
        >
          {children}
        </motion.div>
      </SidebarInset>
    </SidebarProvider>
  );
}
