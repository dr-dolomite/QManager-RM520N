"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";

import { SidebarBrand } from "@/components/sidebar-brand";
import {
  NavSection,
  type NavItem,
  type NavStatus,
} from "@/components/nav-section";
import { NavUser } from "@/components/nav-user";
import DonateDialog from "@/components/donate-dialog";
import { useWatchdogIndicator } from "@/hooks/use-watchdog-indicator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar";
import type { NavGroup } from "@/lib/nav-tree";

// Icons are Material Symbols Rounded ligature names, resolved against the
// build-time subset in app/fonts. Adding one here means adding it to the
// MaterialSymbolName union AND regenerating the subset — the type will tell you.
//
// t_key values are keys inside the "sidebar" namespace's "items" object;
// NavSection resolves them via t(`items.${t_key}`). Labels never live here.
//
// Old routes (/system-settings/connection-quality, /monitoring, /local-network) keep redirects.

const navMain: NavItem[] = [
  { t_key: "home", url: "/dashboard", icon: "home" },
];

const navCellular: NavItem[] = [
  {
    t_key: "cellular_information",
    url: "/cellular",
    icon: "cell_tower",
    items: [
      { t_key: "antenna_statistics", url: "/cellular/antenna-statistics" },
      { t_key: "antenna_alignment", url: "/cellular/antenna-alignment" },
    ],
  },
  {
    t_key: "sms_center",
    url: "/cellular/sms",
    icon: "sms",
    items: [{ t_key: "sms_forwarding", url: "/cellular/sms/forwarding" }],
  },
  {
    t_key: "custom_profiles",
    url: "/cellular/custom-profiles",
    icon: "account_circle",
  },
  {
    t_key: "band_locking",
    url: "/cellular/cell-locking",
    icon: "signal_cellular_alt",
    items: [
      { t_key: "tower_locking", url: "/cellular/cell-locking/tower-locking" },
      {
        t_key: "frequency_locking",
        url: "/cellular/cell-locking/frequency-locking",
      },
    ],
  },
  {
    t_key: "cell_scanner",
    url: "/cellular/cell-scanner",
    icon: "radar",
    items: [
      {
        t_key: "neighboring_cells",
        url: "/cellular/cell-scanner/neighbourcell-scanner",
      },
      {
        t_key: "frequency_calculator",
        url: "/cellular/cell-scanner/frequency-calculator",
      },
    ],
  },
  {
    t_key: "settings",
    url: "/cellular/settings",
    icon: "tune",
    items: [
      { t_key: "apn_management", url: "/cellular/settings/apn-management" },
      { t_key: "network_priority", url: "/cellular/settings/network-priority" },
      { t_key: "imei_settings", url: "/cellular/settings/imei-settings" },
      { t_key: "fplmn_settings", url: "/cellular/settings/fplmn-settings" },
    ],
  },
];

const navLocalNetwork: NavItem[] = [
  {
    t_key: "ethernet_status",
    url: "/local-network/ethernet",
    icon: "settings_ethernet",
  },
  {
    t_key: "traffic_engine",
    url: "/local-network/traffic-engine",
    icon: "monitor",
  },
  {
    t_key: "local_network_settings",
    url: "/local-network/ip-passthrough",
    icon: "tune",
    items: [
      { t_key: "ttl_mtu_settings", url: "/local-network/ttl-settings" },
      { t_key: "custom_dns", url: "/local-network/custom-dns" },
    ],
  },
];

// The Watchdog row's live status is injected at render (AppSidebar), so the
// array itself stays static and the breadcrumb can read it too.
const navMonitoring: NavItem[] = [
  {
    t_key: "connection_quality",
    url: "/monitoring/connection-quality",
    icon: "speed",
    items: [
      { t_key: "latency_monitor", url: "/monitoring/latency" },
      { t_key: "network_events", url: "/monitoring/events" },
    ],
  },
  { t_key: "alerts", url: "/monitoring/alerts", icon: "notifications" },
  { t_key: "watchdog", url: "/monitoring/watchdog", icon: "pets" },
  { t_key: "tailscale", url: "/monitoring/tailscale", icon: "vpn_lock" },
];

// Donate opens a dialog; its onClick is injected at render.
const navFooter: NavItem[] = [
  { t_key: "about_device", url: "/about-device", icon: "router" },
  { t_key: "support", url: "/support", icon: "support" },
  { t_key: "donate", url: "#", icon: "favorite" },
];

const navSystem: NavItem[] = [
  {
    t_key: "system_settings",
    url: "/system-settings",
    icon: "settings",
    items: [
      { t_key: "languages", url: "/system-settings/languages" },
      { t_key: "device_access", url: "/system-settings/device-access" },
      { t_key: "adaptive_polling", url: "/system-settings/adaptive-polling" },
      {
        t_key: "system_health_check",
        url: "/system-settings/system-health-check",
      },
      { t_key: "logs", url: "/system-settings/logs" },
      { t_key: "config_backup", url: "/system-settings/config-backup" },
    ],
  },
  {
    t_key: "software_update",
    url: "/system-settings/software-update",
    icon: "download",
  },
  {
    t_key: "terminals",
    url: "/system-settings/at-terminal",
    icon: "terminal",
    items: [{ t_key: "web_console", url: "/system-settings/web-console" }],
  },
];

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { t } = useTranslation("sidebar");
  const [donateOpen, setDonateOpen] = React.useState(false);
  const watchdog = useWatchdogIndicator();

  // The Watchdog row reports live state so a user on any page learns the modem
  // is being acted on. Tone follows what is happening to the device, not how
  // dramatic it sounds: recovery is intervention, cooldown is verification.
  const watchdogStatus: NavStatus | undefined = React.useMemo(
    () =>
      watchdog
        ? watchdog.activity === "recovery"
          ? {
              tone: "destructive",
              label: t("status.watchdog_acting"),
              description: t("status.watchdog_acting_detail", {
                tier: watchdog.tier,
              }),
            }
          : {
              tone: "warning",
              label: t("status.watchdog_settling"),
              description: t("status.watchdog_settling_detail"),
            }
        : undefined,
    [watchdog, t],
  );

  // Live and interactive bits joined onto the static tree. Identity is kept for
  // every group that does not change, so NavSection only re-renders for news.
  const groups: NavGroup[] = React.useMemo(
    () =>
      NAV_GROUPS.map((group) => {
        if (group.items === navMonitoring) {
          return {
            ...group,
            items: navMonitoring.map((item) =>
              item.t_key === "watchdog"
                ? { ...item, status: watchdogStatus }
                : item,
            ),
          };
        }
        if (group.items === navFooter) {
          return {
            ...group,
            items: navFooter.map((item) =>
              item.t_key === "donate"
                ? { ...item, onClick: () => setDonateOpen(true) }
                : item,
            ),
          };
        }
        return group;
      }),
    [watchdogStatus],
  );

  return (
    <>
      <Sidebar
        variant="inset"
        collapsible="icon"
        mobileTitle={t("mobile.title")}
        mobileDescription={t("mobile.description")}
        {...props}
      >
        <SidebarHeader>
          <SidebarBrand />
        </SidebarHeader>

        <SidebarContent>
          {groups.map((group) => (
            <NavSection
              key={group.groupKey ?? "footer"}
              groupKey={group.groupKey}
              items={group.items}
              size={group.size}
              // Unlabelled and pinned to the bottom: about the product, not the device.
              className={group.groupKey ? undefined : "mt-auto"}
            />
          ))}
        </SidebarContent>

        <SidebarFooter>
          <NavUser />
        </SidebarFooter>

        <SidebarRail label={t("actions.toggle_sidebar")} />
      </Sidebar>

      {/* Outside <Sidebar>: on a phone the sidebar is a sheet that unmounts its
        children when it closes, and Donate closes it as the dialog opens. */}
      <DonateDialog open={donateOpen} onOpenChange={setDonateOpen} />
    </>
  );
}

/** The whole tree in sidebar order; the header breadcrumb resolves routes against it. */
export const NAV_GROUPS: readonly NavGroup[] = [
  { groupKey: "dashboard", items: navMain },
  { groupKey: "cellular", items: navCellular },
  { groupKey: "local_network", items: navLocalNetwork },
  { groupKey: "monitoring", items: navMonitoring },
  { groupKey: "system", items: navSystem },
  { items: navFooter, size: "sm" },
];
