"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { DUR, EASE_STANDARD } from "@/lib/motion";

import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

import { Separator } from "@/components/ui/separator";
import { AppSidebar, NAV_GROUPS } from "@/components/app-sidebar";
import { resolveNavCrumbs } from "@/lib/nav-tree";
import { SimSwapBanner } from "@/components/monitoring/watchdog/sim-swap-banner";
import { isLoggedIn } from "@/hooks/use-auth";
import { useAutoLogout } from "@/hooks/use-auto-logout";
import { ReconnectingBanner } from "@/components/reboot/reconnecting-banner";
import { PendingRebootBanner } from "@/components/reboot/pending-reboot-banner";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation("sidebar");
  const pathname = usePathname();
  // Named the way the sidebar names it: group, then parent, then page.
  const crumbs = React.useMemo(
    () => resolveNavCrumbs(pathname, NAV_GROUPS),
    [pathname],
  );
  useAutoLogout();

  // Sync cookie check during render, so a logged-out user never sees the layout.
  // replace() leaves no history entry for Back to bounce on.
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
        {t("actions.skip_to_content")}
      </a>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger
              className="-ml-1"
              label={t("actions.toggle_sidebar")}
            />
            <Separator
              orientation="vertical"
              className="mr-2 data-[orientation=vertical]:h-4"
            />
            <Breadcrumb aria-label={t("breadcrumb")}>
              <BreadcrumbList>
                {crumbs.map((crumb, index) => {
                  const isCurrent = index === crumbs.length - 1;
                  return (
                    <React.Fragment key={crumb.key}>
                      {index > 0 && (
                        <BreadcrumbSeparator className="hidden desktop:block" />
                      )}
                      {/* Below desktop only the page itself shows. Group and
                          parent crumbs have no page of their own, so they are
                          text, not links. */}
                      <BreadcrumbItem
                        className={isCurrent ? "" : "hidden desktop:inline-flex"}
                      >
                        {isCurrent ? (
                          <BreadcrumbPage>{t(crumb.key)}</BreadcrumbPage>
                        ) : (
                          <span>{t(crumb.key)}</span>
                        )}
                      </BreadcrumbItem>
                    </React.Fragment>
                  );
                })}
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>
        <SimSwapBanner />
        <ReconnectingBanner />
        <PendingRebootBanner />
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
