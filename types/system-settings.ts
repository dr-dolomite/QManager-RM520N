// =============================================================================
// System Settings Types & Constants
// =============================================================================

export interface SystemSettings {
  hostname: string; // Device hostname, used as display name
  temp_unit: "celsius" | "fahrenheit";
  distance_unit: "km" | "miles";
  timezone: string; // POSIX TZ string, e.g. "EST5EDT,M3.2.0,M11.1.0"
  zonename: string; // IANA zone name, e.g. "America/New_York"
  sms_tool_device: string; // "" = default (smd11), "/dev/smd7" = alternate
  session_max_age: number; // Session timeout in seconds; 0 = never expire
}

export interface ScheduleConfig {
  enabled: boolean;
  time: string; // HH:MM (reboot only)
  days: number[]; // 0=Sun, 6=Sat
}

export interface SystemSettingsResponse {
  success: boolean;
  settings: SystemSettings;
  scheduled_reboot: ScheduleConfig;
}

// --- Day Labels (shared with tower locking) --------------------------------

export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// --- OpenWRT Timezone Table ------------------------------------------------
// Standard OpenWRT/LuCI timezone table. Each entry has:
//   zonename: IANA timezone identifier
//   timezone: POSIX TZ string used by the system
//   label:    Human-readable display name

export interface TimezoneEntry {
  zonename: string;
  timezone: string;
  label: string;
}

export const TIMEZONES: TimezoneEntry[] = [
  // UTC
  { zonename: "UTC", timezone: "UTC0", label: "UTC" },

  // Africa
  { zonename: "Africa/Cairo", timezone: "EET-2", label: "Africa/Cairo (EET)" },
  { zonename: "Africa/Casablanca", timezone: "WET0", label: "Africa/Casablanca (WET)" },
  { zonename: "Africa/Johannesburg", timezone: "SAST-2", label: "Africa/Johannesburg (SAST)" },
  { zonename: "Africa/Lagos", timezone: "WAT-1", label: "Africa/Lagos (WAT)" },
  { zonename: "Africa/Nairobi", timezone: "EAT-3", label: "Africa/Nairobi (EAT)" },

  // Americas
  { zonename: "America/Anchorage", timezone: "AKST9AKDT,M3.2.0,M11.1.0", label: "America/Anchorage (AKST)" },
  { zonename: "America/Argentina/Buenos_Aires", timezone: "ART3", label: "America/Buenos Aires (ART)" },
  { zonename: "America/Bogota", timezone: "COT5", label: "America/Bogota (COT)" },
  { zonename: "America/Chicago", timezone: "CST6CDT,M3.2.0,M11.1.0", label: "America/Chicago (CST)" },
  { zonename: "America/Denver", timezone: "MST7MDT,M3.2.0,M11.1.0", label: "America/Denver (MST)" },
  { zonename: "America/Halifax", timezone: "AST4ADT,M3.2.0,M11.1.0", label: "America/Halifax (AST)" },
  { zonename: "America/Lima", timezone: "PET5", label: "America/Lima (PET)" },
  { zonename: "America/Los_Angeles", timezone: "PST8PDT,M3.2.0,M11.1.0", label: "America/Los Angeles (PST)" },
  { zonename: "America/Mexico_City", timezone: "CST6", label: "America/Mexico City (CST)" },
  { zonename: "America/New_York", timezone: "EST5EDT,M3.2.0,M11.1.0", label: "America/New York (EST)" },
  { zonename: "America/Phoenix", timezone: "MST7", label: "America/Phoenix (MST)" },
  { zonename: "America/Santiago", timezone: "CLT4CLST,M8.2.6/24,M5.2.6/24", label: "America/Santiago (CLT)" },
  { zonename: "America/Sao_Paulo", timezone: "BRT3", label: "America/Sao Paulo (BRT)" },
  { zonename: "America/St_Johns", timezone: "NST3:30NDT,M3.2.0,M11.1.0", label: "America/St. John's (NST)" },
  { zonename: "America/Toronto", timezone: "EST5EDT,M3.2.0,M11.1.0", label: "America/Toronto (EST)" },
  { zonename: "America/Vancouver", timezone: "PST8PDT,M3.2.0,M11.1.0", label: "America/Vancouver (PST)" },

  // Asia
  { zonename: "Asia/Bangkok", timezone: "ICT-7", label: "Asia/Bangkok (ICT)" },
  { zonename: "Asia/Colombo", timezone: "IST-5:30", label: "Asia/Colombo (IST)" },
  { zonename: "Asia/Dhaka", timezone: "BDT-6", label: "Asia/Dhaka (BDT)" },
  { zonename: "Asia/Dubai", timezone: "GST-4", label: "Asia/Dubai (GST)" },
  { zonename: "Asia/Hong_Kong", timezone: "HKT-8", label: "Asia/Hong Kong (HKT)" },
  { zonename: "Asia/Jakarta", timezone: "WIB-7", label: "Asia/Jakarta (WIB)" },
  { zonename: "Asia/Karachi", timezone: "PKT-5", label: "Asia/Karachi (PKT)" },
  { zonename: "Asia/Kolkata", timezone: "IST-5:30", label: "Asia/Kolkata (IST)" },
  { zonename: "Asia/Kuala_Lumpur", timezone: "MYT-8", label: "Asia/Kuala Lumpur (MYT)" },
  { zonename: "Asia/Manila", timezone: "PHT-8", label: "Asia/Manila (PHT)" },
  { zonename: "Asia/Riyadh", timezone: "AST-3", label: "Asia/Riyadh (AST)" },
  { zonename: "Asia/Seoul", timezone: "KST-9", label: "Asia/Seoul (KST)" },
  { zonename: "Asia/Shanghai", timezone: "CST-8", label: "Asia/Shanghai (CST)" },
  { zonename: "Asia/Singapore", timezone: "SGT-8", label: "Asia/Singapore (SGT)" },
  { zonename: "Asia/Taipei", timezone: "CST-8", label: "Asia/Taipei (CST)" },
  { zonename: "Asia/Tehran", timezone: "IRST-3:30IRDT,J79/24,J263/24", label: "Asia/Tehran (IRST)" },
  { zonename: "Asia/Tokyo", timezone: "JST-9", label: "Asia/Tokyo (JST)" },

  // Australia
  { zonename: "Australia/Adelaide", timezone: "ACST-9:30ACDT,M10.1.0,M4.1.0/3", label: "Australia/Adelaide (ACST)" },
  { zonename: "Australia/Brisbane", timezone: "AEST-10", label: "Australia/Brisbane (AEST)" },
  { zonename: "Australia/Darwin", timezone: "ACST-9:30", label: "Australia/Darwin (ACST)" },
  { zonename: "Australia/Hobart", timezone: "AEST-10AEDT,M10.1.0,M4.1.0/3", label: "Australia/Hobart (AEST)" },
  { zonename: "Australia/Melbourne", timezone: "AEST-10AEDT,M10.1.0,M4.1.0/3", label: "Australia/Melbourne (AEST)" },
  { zonename: "Australia/Perth", timezone: "AWST-8", label: "Australia/Perth (AWST)" },
  { zonename: "Australia/Sydney", timezone: "AEST-10AEDT,M10.1.0,M4.1.0/3", label: "Australia/Sydney (AEST)" },

  // Europe
  { zonename: "Europe/Amsterdam", timezone: "CET-1CEST,M3.5.0,M10.5.0/3", label: "Europe/Amsterdam (CET)" },
  { zonename: "Europe/Athens", timezone: "EET-2EEST,M3.5.0/3,M10.5.0/4", label: "Europe/Athens (EET)" },
  { zonename: "Europe/Berlin", timezone: "CET-1CEST,M3.5.0,M10.5.0/3", label: "Europe/Berlin (CET)" },
  { zonename: "Europe/Dublin", timezone: "GMT0IST,M3.5.0/1,M10.5.0", label: "Europe/Dublin (GMT)" },
  { zonename: "Europe/Helsinki", timezone: "EET-2EEST,M3.5.0/3,M10.5.0/4", label: "Europe/Helsinki (EET)" },
  { zonename: "Europe/Istanbul", timezone: "TRT-3", label: "Europe/Istanbul (TRT)" },
  { zonename: "Europe/Kyiv", timezone: "EET-2EEST,M3.5.0/3,M10.5.0/4", label: "Europe/Kyiv (EET)" },
  { zonename: "Europe/Lisbon", timezone: "WET0WEST,M3.5.0/1,M10.5.0", label: "Europe/Lisbon (WET)" },
  { zonename: "Europe/London", timezone: "GMT0BST,M3.5.0/1,M10.5.0", label: "Europe/London (GMT)" },
  { zonename: "Europe/Madrid", timezone: "CET-1CEST,M3.5.0,M10.5.0/3", label: "Europe/Madrid (CET)" },
  { zonename: "Europe/Moscow", timezone: "MSK-3", label: "Europe/Moscow (MSK)" },
  { zonename: "Europe/Oslo", timezone: "CET-1CEST,M3.5.0,M10.5.0/3", label: "Europe/Oslo (CET)" },
  { zonename: "Europe/Paris", timezone: "CET-1CEST,M3.5.0,M10.5.0/3", label: "Europe/Paris (CET)" },
  { zonename: "Europe/Rome", timezone: "CET-1CEST,M3.5.0,M10.5.0/3", label: "Europe/Rome (CET)" },
  { zonename: "Europe/Stockholm", timezone: "CET-1CEST,M3.5.0,M10.5.0/3", label: "Europe/Stockholm (CET)" },
  { zonename: "Europe/Warsaw", timezone: "CET-1CEST,M3.5.0,M10.5.0/3", label: "Europe/Warsaw (CET)" },
  { zonename: "Europe/Zurich", timezone: "CET-1CEST,M3.5.0,M10.5.0/3", label: "Europe/Zurich (CET)" },

  // Indian Ocean
  { zonename: "Indian/Maldives", timezone: "MVT-5", label: "Indian/Maldives (MVT)" },

  // Pacific
  { zonename: "Pacific/Auckland", timezone: "NZST-12NZDT,M9.5.0,M4.1.0/3", label: "Pacific/Auckland (NZST)" },
  { zonename: "Pacific/Fiji", timezone: "FJT-12", label: "Pacific/Fiji (FJT)" },
  { zonename: "Pacific/Guam", timezone: "ChST-10", label: "Pacific/Guam (ChST)" },
  { zonename: "Pacific/Honolulu", timezone: "HST10", label: "Pacific/Honolulu (HST)" },
];
