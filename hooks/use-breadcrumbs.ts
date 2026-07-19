'use client';

import { usePathname } from 'next/navigation';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

export interface BreadcrumbItem {
  label: string;
  href: string;
  isCurrentPage: boolean;
}

// Map each route segment to a key in the "sidebar" namespace (groups.* or
// items.*), so breadcrumbs read exactly like the sidebar they mirror and pick up
// translations for free. Segments not listed here fall back to a capitalized
// version of the raw segment.
const routeKeyMap: Record<string, string> = {
  dashboard: 'groups.dashboard',
  home: 'items.home',
  cellular: 'groups.cellular',
  sms: 'items.sms_center',
  'custom-profiles': 'items.custom_profiles',
  'connection-scenarios': 'items.connection_scenarios',
  'cell-locking': 'items.band_locking',
  'tower-locking': 'items.tower_locking',
  'frequency-locking': 'items.frequency_locking',
  'cell-scanner': 'items.cell_scanner',
  'neighbourcell-scanner': 'items.neighboring_cells',
  'frequency-calculator': 'items.frequency_calculator',
  settings: 'items.settings',
  'apn-management': 'items.apn_management',
  'network-priority': 'items.network_priority',
  'imei-settings': 'items.imei_settings',
  'fplmn-settings': 'items.fplmn_settings',
  'local-network': 'groups.local_network',
  'ip-passthrough': 'items.ip_passthrough',
  ethernet: 'items.ethernet_status',
  'ttl-settings': 'items.ttl_mtu_settings',
  'custom-dns': 'items.custom_dns',
  monitoring: 'groups.monitoring',
  latency: 'items.latency_monitor',
  'email-alerts': 'items.email_alerts',
  'sms-alerts': 'items.sms_alerts',
  'discord-bot': 'items.discord_bot',
  logs: 'items.logs',
  watchdog: 'items.watchdog',
  tailscale: 'items.tailscale',
  'system-settings': 'items.system_settings',
  'system-health-check': 'items.system_health_check',
  'connection-quality': 'items.connection_quality',
  'software-update': 'items.software_update',
  'at-terminal': 'items.at_terminal',
  'web-console': 'items.web_console',
  languages: 'items.languages',
  'about-device': 'items.about_device',
  support: 'items.support',
};

export function useBreadcrumbs(): BreadcrumbItem[] {
  const pathname = usePathname();
  const { t, i18n } = useTranslation('sidebar');

  return useMemo(() => {
    // Remove leading/trailing slashes and split by '/'
    const segments = pathname.split('/').filter(Boolean);

    if (segments.length === 0) {
      return [];
    }

    // Build breadcrumb items
    const breadcrumbs: BreadcrumbItem[] = segments.map((segment, index) => {
      // Build the href by joining all segments up to current index
      const href = '/' + segments.slice(0, index + 1).join('/');

      // Translate via the sidebar namespace when the segment is known;
      // otherwise capitalize the raw segment.
      const key = routeKeyMap[segment];
      const label = key
        ? t(key)
        : segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, ' ');

      // Last segment is the current page
      const isCurrentPage = index === segments.length - 1;

      return {
        label,
        href,
        isCurrentPage,
      };
    });

    return breadcrumbs;
    // i18n.language is in deps so labels re-render on language change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, t, i18n.language]);
}
