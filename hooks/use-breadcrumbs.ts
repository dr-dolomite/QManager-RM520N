'use client';

import { usePathname } from 'next/navigation';
import { useMemo } from 'react';

export interface BreadcrumbItem {
  label: string;
  href: string;
  isCurrentPage: boolean;
}

// Map route segments to display names
const routeNameMap: Record<string, string> = {
  dashboard: 'Dashboard',
  home: 'Home',
  cellular: 'Cellular',
  sms: 'SMS Center',
  'custom-profiles': 'Custom Profiles',
  'connection-scenarios': 'Connection Scenarios',
  'cell-locking': 'Band Locking',
  'tower-locking': 'Tower Locking',
  'frequency-locking': 'Frequency Locking',
  'cell-scanner': 'Cell Scanner',
  'neighbourcell-scanner': 'Neighboring Cells',
  'frequency-calculator': 'Frequency Calculator',
  settings: 'Settings',
  'apn-management': 'APN Management',
  'network-priority': 'Network Priority',
  'imei-settings': 'IMEI Settings',
  'fplmn-settings': 'FPLMN Settings',
  'local-network': 'Local Network',
  'ip-passthrough': 'IP Passthrough',
  'custom-dns': 'Custom DNS',
  'ttl-settings': 'TTL & MTU Settings',
  monitoring: 'Monitoring',
  latency: 'Latency Monitor',
  logs: 'Logs',
  'email-alerts': 'Email Alerts',
  watchdog: 'Watchdog',
  'video-optimizer': 'Video Optimizer',
  'traffic-masquerade': 'Traffic Masquerade',
  tailscale: 'Tailscale',
  'system-settings': 'System Settings',
  'about-device': 'About Device',
  support: 'Support',
};

export function useBreadcrumbs(): BreadcrumbItem[] {
  const pathname = usePathname();

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
      
      // Get display name from map or capitalize the segment
      const label = routeNameMap[segment] || 
        segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, ' ');
      
      // Last segment is the current page
      const isCurrentPage = index === segments.length - 1;

      return {
        label,
        href,
        isCurrentPage,
      };
    });

    return breadcrumbs;
  }, [pathname]);
}
