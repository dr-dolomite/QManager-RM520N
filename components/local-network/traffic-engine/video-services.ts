// The service each shipped hostlist domain belongs to, so the hostname list can group by
// service. Built from the default list `qmanager_setup` seeds: edit both together. Brands, so untranslated.

export const VIDEO_SERVICES: readonly (readonly [string, readonly string[]])[] = [
  ["YouTube", ["youtube.com", "googlevideo.com", "ytimg.com", "ggpht.com", "youtu.be"]],
  ["Meta", ["facebook.com", "fbcdn.net", "instagram.com", "cdninstagram.com"]],
  ["TikTok", ["tiktok.com", "tiktokcdn.com", "tiktokv.com"]],
  ["Snapchat", ["snapchat.com", "sc-cdn.net"]],
  ["Netflix", ["netflix.com", "nflxvideo.net"]],
  ["Disney+", ["disneyplus.com"]],
  ["CloudFront", ["cloudfront.net"]],
  ["Akamai", ["akamaized.net"]],
  ["Speedtest", ["speedtest.net", "ookla.com"]],
];

const SERVICE_OF = new Map<string, string>(
  VIDEO_SERVICES.flatMap(([service, domains]) => domains.map((d) => [d, service] as const)),
);

export interface DomainGroup {
  /** A service name, or `null` for the domains the map doesn't know. */
  service: string | null;
  domains: string[];
}

/** Groups a hostname list by service: custom domains first, then the default file's order. */
export function groupDomains(domains: readonly string[]): DomainGroup[] {
  const custom: string[] = [];
  const byService = new Map<string, string[]>();
  for (const d of domains) {
    const service = SERVICE_OF.get(d.toLowerCase());
    if (!service) {
      custom.push(d);
      continue;
    }
    const list = byService.get(service);
    if (list) list.push(d);
    else byService.set(service, [d]);
  }
  const groups: DomainGroup[] = [];
  if (custom.length) groups.push({ service: null, domains: custom });
  for (const [service] of VIDEO_SERVICES) {
    const list = byService.get(service);
    if (list) groups.push({ service, domains: list });
  }
  return groups;
}
