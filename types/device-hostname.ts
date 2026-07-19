// =============================================================================
// device-hostname.ts — Type contract for the unauthenticated hostname CGI.
// =============================================================================
// Mirrors scripts/www/cgi-bin/quecmanager/public/hostname.sh.
// The CGI always responds HTTP 200 with this shape; an empty string is the
// explicit "no name set" signal.
// =============================================================================

export interface DeviceHostnameResponse {
  hostname: string;
}
