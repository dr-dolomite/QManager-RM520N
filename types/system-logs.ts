// =============================================================================
// System Logs — the shape `system/logs.sh` actually serves
// =============================================================================

/**
 * The four levels `logs.sh` recognises. Its awk pass drops any line whose level
 * is not in this set, so the union is exhaustive by construction — a widened
 * union here would be a lie until the backend widens too.
 */
export const LOG_LEVELS = ["DEBUG", "INFO", "WARN", "ERROR"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

/** The rail's selection: an exact level, or every level. */
export type LevelFilter = LogLevel | "all";

export function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value);
}

export interface LogEntry {
  /** `YYYY-MM-DD HH:MM:SS`, in the device's local time. */
  timestamp: string;
  level: LogLevel;
  component: string;
  /** Present but empty when the log line carried no PID. */
  pid: string;
  message: string;
}

export interface LogStats {
  current_size_kb: number;
  current_lines: number;
  rotated_files: number;
}

export interface LogsResponse {
  success: boolean;
  entries: LogEntry[];
  /**
   * Line-counted from the very string the CGI serialises into `entries`, so it
   * is equal to `entries.length` by construction. Kept in the payload and
   * deliberately unread — "N of N" is not a fact about the log.
   */
  total: number;
  stats: LogStats;
  available_components: string[];
  error?: string;
  detail?: string;
}
