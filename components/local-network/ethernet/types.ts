// =============================================================================
// The ethernet CGI's response shape
// =============================================================================
// `scripts/www/cgi-bin/quecmanager/network/ethernet.sh`, GET. Kept in its own
// module so the shell that fetches it and the two presentational components that
// render it agree on one declaration rather than three.
// =============================================================================

export interface EthernetStatus {
  /** `"up"` or `"down"`. Anything else is treated as an unknown link. */
  link_status: string;
  /** `"2500Mb/s"` from sysfs, or `"Unknown"`. Meaningless while the link is down. */
  speed: string;
  /** `"full"` / `"half"` / `"Unknown"`. Same caveat. */
  duplex: string;
  /**
   * The PHY's LIVE autonegotiation state — `"on"`, `"off"`, or `"Unknown"`.
   *
   * This was fetched, typed and stored by the retired components and rendered
   * NOWHERE: the tile labelled "Negotiation" printed `speed_limit` instead, so
   * the surface reported a configured value under a live fact's name while
   * discarding the live fact (The State-Honesty Rule).
   */
  auto_negotiation: string;
  /** The SAVED limit — `"auto" | "10" | "100" | "1000" | "2500"`. Valid with or without a link. */
  speed_limit: string;
  /** Whether the PHY can do 2.5G at all. Gates the dropdown option AND the rate tile's ceiling caption. */
  supports_2500?: boolean;
  /**
   * Whether there is an `eth0` at all.
   *
   * OPTIONAL, and a missing value means **true**. `link_status` cannot answer
   * this — an unplugged cable and an absent controller both read `"down"` — so
   * the field was added to the GET (2026-08-31) to let the UI say "there is no
   * port here" instead of "the cable is out". A missing `eth0` is a DESIGNED
   * outcome, which is why `qmanager-ethernet.service` puts its
   * `ConditionPathExists` in `[Unit]`.
   *
   * Treating absence as `true` is what keeps it backward-compatible in both
   * directions: an older frontend ignores the extra field, and this frontend
   * meeting an older backend renders a working page rather than blanking it.
   */
  interface_present?: boolean;
}
