"use client";

import * as React from "react";
import {
  LifeBuoy,
  Map,
  PieChart,
  Settings2,
  HomeIcon,
  RadioTowerIcon,
  LucideSignal,
  MailIcon,
  EthernetPortIcon,
  MonitorCloudIcon,
  LogsIcon,
  MessageCircleIcon,
  WorkflowIcon,
  DogIcon,
  RouterIcon,
  TimerIcon,
  User2Icon,
  HeartIcon,
  ScanIcon,
  SettingsIcon,
} from "lucide-react";

import QManagerLogo from "@/public/qmanager-logo.svg";

import { NavMain } from "@/components/nav-main";
import { NavLocalNetwork } from "@/components/nav-localNetwork";
import { NavSecondary } from "@/components/nav-secondary";
import { NavUser } from "@/components/nav-user";
import { NavMonitoring } from "@/components/nav-monitoring";
import { NavCellular } from "@/components/nav-cellular";
import DonateDialog from "@/components/donate-dialog";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import Image from "next/image";
import Link from "next/link";

const data = {
  user: {
    name: "user-test",
    avatar: QManagerLogo.src,
  },
  navMain: [
    {
      title: "Home",
      url: "/dashboard",
      icon: HomeIcon,
      isActive: true,
    },
  ],
  navSecondary: [
    {
      title: "System Settings",
      url: "/system-settings",
      icon: SettingsIcon,
    },
    {
      title: "About Device",
      url: "/about-device",
      icon: RouterIcon,
    },
    {
      title: "Support",
      url: "/support",
      icon: LifeBuoy,
    },
    {
      title: "Donate to the Project",
      url: "#",
      icon: HeartIcon,
    },
  ],
  cellular: [
    {
      title: "Cellular Information",
      url: "/cellular",
      icon: RadioTowerIcon,
    },
    {
      title: "SMS Center",
      url: "/cellular/sms",
      icon: MessageCircleIcon,
    },
    {
      title: "Custom Profiles",
      url: "/cellular/custom-profiles",
      icon: User2Icon,
      items: [
        {
          title: "Connection Scenarios",
          url: "/cellular/custom-profiles/connection-scenarios",
        },
      ],
    },
    {
      title: "Band Locking",
      url: "/cellular/cell-locking",
      icon: LucideSignal,
      items: [
        {
          title: "Tower Locking",
          url: "/cellular/cell-locking/tower-locking",
        },
        {
          title: "Frequency Locking",
          url: "/cellular/cell-locking/frequency-locking",
        },
      ],
    },
    {
      title: "Cell Scanner",
      url: "/cellular/cell-scanner",
      icon: ScanIcon,
      items: [
        {
          title: "Neighboring Cells",
          url: "/cellular/cell-scanner/neighbourcell-scanner",
        },
        {
          title: "Frequency Calculator",
          url: "/cellular/cell-scanner/frequency-calculator",
        },
      ],
    },
    {
      title: "Settings",
      url: "/cellular/settings",
      icon: Settings2,
      items: [
        {
          title: "APN Management",
          url: "/cellular/settings/apn-management",
        },
        {
          title: "Network Priority",
          url: "/cellular/settings/network-priority",
        },
        {
          title: "IMEI Settings",
          url: "/cellular/settings/imei-settings",
        },
        {
          title: "FPLMN Settings",
          url: "/cellular/settings/fplmn-settings",
        },
      ],
    },
  ],
  localNetwork: [
    {
      title: "Ethernet Status",
      url: "/local-network",
      icon: EthernetPortIcon,
    },
    {
      title: "IP Passthrough",
      url: "/local-network/ip-passthrough",
      icon: WorkflowIcon,
    },
    {
      title: "Custom DNS",
      url: "/local-network/custom-dns",
      icon: Map,
    },
    {
      title: "TTL & MTU Settings",
      url: "/local-network/ttl-settings",
      icon: TimerIcon,
    },
  ],
  monitoring: [
    {
      title: "Network Events",
      url: "/monitoring",
      icon: PieChart,
      items: [
        {
          title: "Latency Monitor",
          url: "/monitoring/latency",
        },
      ],
    },
    {
      title: "Email Alerts",
      url: "/monitoring/email-alerts",
      icon: MailIcon,
    },
    {
      title: "Tailscale",
      url: "/monitoring/tailscale",
      icon: MonitorCloudIcon,
    },
    {
      title: "Watchdog",
      url: "/monitoring/watchdog",
      icon: DogIcon,
    },
    {
      title: "Logs",
      url: "/monitoring/logs",
      icon: LogsIcon,
    },
  ],
};

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const [donateOpen, setDonateOpen] = React.useState(false);

  const navSecondaryItems = data.navSecondary.map((item) =>
    item.title === "Donate to the Project"
      ? { ...item, onClick: () => setDonateOpen(true) }
      : item,
  );

  return (
    <Sidebar variant="inset" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/dashboard">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg">
                  <Image
                    src={QManagerLogo}
                    alt="QManager Logo"
                    className="size-full"
                    priority
                  />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">QManager</span>
                  <span className="truncate text-xs">Admin</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
        <NavCellular cellular={data.cellular} />
        <NavLocalNetwork localNetwork={data.localNetwork} />
        <NavMonitoring monitoring={data.monitoring} />
        <NavSecondary items={navSecondaryItems} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={data.user} />
      </SidebarFooter>
      <DonateDialog open={donateOpen} onOpenChange={setDonateOpen} />
    </Sidebar>
  );
}
