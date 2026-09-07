import type { AboutDeviceData } from "@/types/about-device";

import type { AboutView, DiscTone } from "./shapes";

// =============================================================================
// About Device — the surface's derived view state and its pure row builders
// =============================================================================
// The page shell calls `aboutView` ONCE and hands the answer down. No component
// on this surface may re-derive the condition from a payload's shape — that is
// how the retired page rendered a destructive alert in one card and six
// confident rows of "-" in the other, for a single failed request.
// =============================================================================

/**
 * The host `about.sh` asks for the public addresses. Named in the UI so the
 * internet tile never claims more than it knows: an unanswered probe is a fact
 * about this lookup, not about the connection.
 */
export const PUBLIC_IP_PROBE = "api.ipify.org";

/** The endpoint whose failure the band's notice quotes, in the machine voice. */
export const ABOUT_ENDPOINT_LABEL = "device/about.sh";

/** A field the device omitted arrives as `undefined`, not as an empty string. */
function text(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Everything the condition is derived FROM, as one argument. */
export interface AboutViewInput {
  data: AboutDeviceData | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * The page's one condition. A failed re-read drops both cards to empty even
 * though stale figures are still in state, because the last thing the device
 * said is nothing.
 */
export function aboutView(input: AboutViewInput): AboutView {
  if (input.error) return "unreachable";
  if (input.data) return "loaded";
  if (input.isLoading) return "loading";
  return "unreachable";
}

/** True when the public-address probe returned an address. */
export function isInternetReachable(data: AboutDeviceData): boolean {
  return text(data.network?.public_ipv4).length > 0;
}

/**
 * The ONE disc on this page that changes tone at runtime. A failed probe is
 * `warning`, never `destructive`: it proves this lookup did not answer, not
 * that the device is offline, and the tile's caption says which lookup.
 */
export function internetTone(data: AboutDeviceData): DiscTone {
  return isInternetReachable(data) ? "success" : "warning";
}

/** The public address itself, or an empty string when the probe went unanswered. */
export function publicAddress(data: AboutDeviceData): string {
  return text(data.network?.public_ipv4);
}

// -----------------------------------------------------------------------------
// Tile figures
// -----------------------------------------------------------------------------

/** The four band figures, normalized once so no tile re-reads the payload. */
export function identityFigures(data: AboutDeviceData) {
  return {
    model: text(data.device?.model),
    manufacturer: text(data.device?.manufacturer),
    firmware: text(data.device?.firmware),
    buildDate: text(data.device?.build_date),
    hostname: text(data.system?.hostname),
    kernel: text(data.system?.kernel_version),
  };
}

// -----------------------------------------------------------------------------
// Rows
// -----------------------------------------------------------------------------

/**
 * One metric row. `labelKey` is a leaf under the surface's `aboutDevice`
 * section, so the builder stays free of `t()` and the component free of field
 * names.
 */
export interface MetricRow {
  id: string;
  labelKey: string;
  value: string;
  /** An identifier the device emits verbatim rides the mono face. */
  mono?: boolean;
}

/** A labelled cluster of rows. An absent `labelKey` means an unlabelled cluster. */
export interface MetricGroup {
  id: string;
  labelKey?: string;
  rows: MetricRow[];
}

/**
 * The Modem card. "Firmware revision" is `system.openwrt_version` — the Quectel
 * Project Rev out of `/etc/quectel-project-version`, not a host OS version,
 * which is why it reads as a revision and sits beside Firmware.
 */
export function modemGroups(data: AboutDeviceData): MetricGroup[] {
  return [
    {
      id: "identity",
      rows: [
        {
          id: "manufacturer",
          labelKey: "rows.manufacturer",
          value: text(data.device?.manufacturer),
        },
        { id: "model", labelKey: "rows.model", value: text(data.device?.model) },
        {
          id: "firmware",
          labelKey: "rows.firmware",
          value: text(data.device?.firmware),
          mono: true,
        },
        {
          id: "revision",
          labelKey: "rows.firmware_revision",
          value: text(data.system?.openwrt_version),
          mono: true,
        },
        {
          id: "build_date",
          labelKey: "rows.build_date",
          value: text(data.device?.build_date),
        },
        {
          id: "imei",
          labelKey: "rows.imei",
          value: text(data.device?.imei),
          mono: true,
        },
      ],
    },
  ];
}

/** The Addresses card: where the device sits on the LAN and on the carrier. */
export function addressGroups(data: AboutDeviceData): MetricGroup[] {
  return [
    {
      id: "local",
      labelKey: "groups.local",
      rows: [
        {
          id: "device_ip",
          labelKey: "rows.device_ip",
          value: text(data.network?.device_ip),
          mono: true,
        },
        {
          id: "lan_gateway",
          labelKey: "rows.lan_gateway",
          value: text(data.network?.lan_gateway),
          mono: true,
        },
      ],
    },
    {
      id: "wwan",
      labelKey: "groups.wwan",
      rows: [
        {
          id: "wan_ipv4",
          labelKey: "rows.ipv4",
          value: text(data.network?.wan_ipv4),
          mono: true,
        },
        {
          id: "wan_ipv6",
          labelKey: "rows.ipv6",
          value: text(data.network?.wan_ipv6),
          mono: true,
        },
      ],
    },
    {
      id: "public",
      labelKey: "groups.public",
      rows: [
        {
          id: "public_ipv4",
          labelKey: "rows.ipv4",
          value: text(data.network?.public_ipv4),
          mono: true,
        },
        {
          id: "public_ipv6",
          labelKey: "rows.ipv6",
          value: text(data.network?.public_ipv6),
          mono: true,
        },
      ],
    },
  ];
}
