// Sites monitor: the GET/POST contract of the sites CGI (docs/reference/sites-monitor.md).

/** The ranges the Latency Monitor page reads; "now" is live latest-only with an empty series. */
export type SitesRange = "now" | "1h" | "24h" | "7d";

export interface SiteLatest {
  ts: number;
  /** TCP connect time in ms; null when the site did not answer. */
  ms: number | null;
  ok: boolean;
  wan: string;
}

export interface SiteBucket {
  ts: number;
  /** Mean of ANSWERED samples in the bucket; null when none answered. */
  ms: number | null;
  min: number | null;
  max: number | null;
  /** Samples taken. */
  n: number;
  /** Samples answered (a count, not a flag). */
  ok: number;
}

export interface SiteEntry {
  host: string;
  label: string;
  kind: "site" | "gateway";
  /** null until the site has been checked once. */
  latest: SiteLatest | null;
  series: SiteBucket[];
}

export interface SitesResponse {
  success: true;
  enabled: boolean;
  interval_sec: number;
  checked_at: number | null;
  /** Epoch of the live sample behind `latest`; null outside "now" or before one lands. */
  live_at: number | null;
  next_check_at: number | null;
  /** A sweep is running or a check-now flag is pending. */
  checking: boolean;
  wans: string[];
  summary: { answered: number; total: number };
  sites: SiteEntry[];
}

export interface SitesFailure {
  success: false;
  error: string;
  detail?: string;
  field?: string;
  reason?: string;
}

export interface SiteConfigEntry {
  host: string;
  label: string;
}

export interface SitesConfig {
  enabled: boolean;
  interval_sec: number;
  sites: SiteConfigEntry[];
}
