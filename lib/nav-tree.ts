import type { MaterialSymbolName } from "@/components/ui/material-symbol";

// Nav tree types and the pure route logic shared by the sidebar and the header breadcrumb.
// Labels never live here; `t_key` resolves through the "sidebar" namespace.

/**
 * A live condition shown on the nav row. The tone describes what the device is doing:
 * `recovery` is the modem being acted on (destructive), `cooldown` is it being watched (warning).
 */
export interface NavStatus {
  tone: "destructive" | "warning";
  /** Short machine-voice tag rendered in the pill, e.g. "acting". */
  label: string;
  /** Sentence a screen reader and tooltip get instead of the terse tag. */
  description: string;
}

export interface NavSubItem {
  t_key: string;
  url: string;
  /** Active only on an exact route match (the derived first sub-row shares the parent URL). */
  exact?: boolean;
}

export interface NavItem {
  t_key: string;
  url: string;
  icon: MaterialSymbolName;
  items?: NavSubItem[];
  /** Renders a button instead of a link (the donate dialog). */
  onClick?: () => void;
  status?: NavStatus;
}

export interface NavGroup {
  /** i18n key under "groups". Omitted for the unlabelled footer group. */
  groupKey?: string;
  items: NavItem[];
  /** "sm" is the quieter footer group (About / Support / Donate). */
  size?: "default" | "sm";
}

/**
 * A parent with sub-items is a pure expander; its old page becomes the first sub-row
 * (same URL, new label kept here so the nav arrays do not change).
 */
export const FIRST_SUB_T_KEY: Readonly<Record<string, string>> = {
  cellular_information: "cellular_overview",
  sms_center: "sms_inbox",
  band_locking: "band_locking_bands",
  cell_scanner: "cell_scanner_full_scan",
  settings: "cellular_settings_general",
  local_network_settings: "ip_passthrough",
  connection_quality: "connection_quality_overview",
  system_settings: "system_settings_general",
  terminals: "at_terminal",
};

/** Trailing slashes come and go with the static export; normalise once. */
export function normalizePath(pathname: string) {
  return pathname.endsWith("/") && pathname !== "/"
    ? pathname.slice(0, -1)
    : pathname;
}

/** The rows a parent expands to: its own page first, then its declared rows. */
export function subRowsOf(item: NavItem): NavSubItem[] {
  if (!item.items?.length) return [];
  return [
    {
      t_key: FIRST_SUB_T_KEY[item.t_key] ?? item.t_key,
      url: item.url,
      exact: true,
    },
    ...item.items,
  ];
}

export function isSubActive(pathname: string, sub: NavSubItem) {
  if (pathname === sub.url) return true;
  return !sub.exact && pathname.startsWith(sub.url + "/");
}

/**
 * A row is active on its own route, on a route below it (leaf rows only, so
 * /cellular does not claim /cellular/settings), or when a sub-row is current.
 */
export function isItemActive(pathname: string, item: NavItem) {
  if (item.onClick) return false;
  const subs = subRowsOf(item);
  if (subs.length) return subs.some((sub) => isSubActive(pathname, sub));
  return pathname === item.url || pathname.startsWith(item.url + "/");
}

export interface NavCrumb {
  /** Translation key inside the "sidebar" namespace. */
  key: string;
  /** Only the current page carries one; groups and parents have no page. */
  href?: string;
}

function matchLength(pathname: string, url: string) {
  if (pathname === url) return url.length;
  return pathname.startsWith(url + "/") ? url.length : -1;
}

/**
 * The breadcrumb for a route, derived from the nav tree so it names pages as the
 * sidebar does. The longest matching URL wins; an unmatched route gives an empty trail.
 */
export function resolveNavCrumbs(
  pathname: string,
  groups: readonly NavGroup[],
): NavCrumb[] {
  const path = normalizePath(pathname);
  let best: { length: number; crumbs: NavCrumb[] } | null = null;

  const consider = (url: string, crumbs: NavCrumb[]) => {
    if (url === "#") return;
    const length = matchLength(path, url);
    if (length >= 0 && (!best || length > best.length)) {
      best = { length, crumbs };
    }
  };

  for (const group of groups) {
    const groupCrumb: NavCrumb[] =
      group.groupKey && group.items.length > 1
        ? [{ key: `groups.${group.groupKey}` }]
        : [];

    for (const item of group.items) {
      const subs = subRowsOf(item);
      if (!subs.length) {
        consider(item.url, [
          ...groupCrumb,
          { key: `items.${item.t_key}`, href: item.url },
        ]);
        continue;
      }
      for (const sub of subs) {
        consider(sub.url, [
          ...groupCrumb,
          { key: `items.${item.t_key}` },
          { key: `items.${sub.t_key}`, href: sub.url },
        ]);
      }
    }
  }

  return (best as { crumbs: NavCrumb[] } | null)?.crumbs ?? [];
}
