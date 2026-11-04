# IP Passthrough

> **Applies to:** RM520N-GL (SDX65) · verified 2026-08, page re-authored and boot parsers re-verified 2026-10-12
> **RG501Q-EU (SDX55):** unverified — see [`platform-matrix.md`](./platform-matrix.md)

> The `/local-network/ip-passthrough` page: hand the carrier's WAN IP address straight to **one** downstream device over Ethernet or USB, instead of the modem keeping it and NATing a private LAN behind it.

**Short version:** normally the modem holds the public IP and gives your LAN devices private addresses behind NAT (Network Address Translation — a router rewriting addresses so many devices share one public address). IP Passthrough turns that off for a single nominated device: the modem hands *that* device the WAN address and steps out of the way. The price is that the modem stops answering at its own LAN gateway address, which is usually the address you are reading this page on.

> ⚠️ **This feature can lock you out of the device you are configuring.** QManager runs *on* the modem. Once passthrough is active the LAN gateway stops being served, so the way back in is Tailscale, the passthrough device itself, or a serial console. The page says this on the Mode control, before you decide — not only inside the confirm dialog.

## Quick Reference

| Item | Value |
| ---- | ----- |
| Route | `app/local-network/ip-passthrough/page.tsx` (thin re-export) |
| Components | `components/local-network/ip-passthrough/` — `shapes.ts`, `status-strip.tsx`, `ip-passthrough-card.tsx`, `ip-passthrough.tsx` (shell) |
| Hook | `hooks/use-ip-passthrough.ts`; `hooks/use-lan-devices.ts` (device picker) |
| Types | `types/ip-passthrough.ts`, `types/lan-devices.ts` |
| CGI | `scripts/www/cgi-bin/quecmanager/network/ip_passthrough.sh`; `network/lan_devices.sh` (read-only device list) |
| Persisted config | `/etc/qmanager/ippt_config.json` (written by our own POST) |
| Poller fallback | `/tmp/qmanager_status.json` → `.device.ippt_*`, set once at boot by `parse_ippt_*` in `scripts/usr/lib/qmanager/parse_at.sh` |
| i18n root | `ipPassthrough.*` (71 leaves × 5 locales) |
| Apply semantics | **write all five settings, then reboot immediately** — there is no separate reboot action |

## The AT contract

`AT+QMAP` is Quectel's LAN/WAN mapping command family. Passthrough is rule 0 of the **MPDN** (Multi-PDN) rule table.

### GET (documented, but see the honesty note below)

| Command | Reads |
| ------- | ----- |
| `AT+QMAP="MPDN_RULE"` | passthrough mode + `IPPT_info` (the target MAC) for rule 0 |
| `AT+QMAP="IPPT_NAT"` | NAT mode (`0` = WithoutNAT, `1` = WithNAT) |
| `AT+QCFG="usbnet"` | USB modem protocol (`0` rmnet, `1` ecm, `2` mbim, `3` rndis) |
| `AT+QMAP="DHCPV4DNS"` | whether the modem offers itself as the DNS server over DHCP |

`MPDN_RULE` field layout, comma-separated after the `+QMAP:` prefix:
`$1="MPDN_rule"  $2=rule_num  $3=profileID  $4=VLAN_ID  $5=IPPT_mode  $6=auto_connect  [$7=IPPT_info]`
`IPPT_mode`: `0` disabled, `1` ETH, `2` WiFi, `3` USB-ECM/RNDIS, `4` Any.

### POST (`action=apply`) — five writes in fixed order

```
1. AT+QMAP="MPDN_rule",0                          # disabled: reset rule 0
   AT+QMAPWAC=1                                   #   … then WAC reset (non-fatal)
   AT+QMAP="MPDN_rule",0,1,0,1,1,"<mac>"          # eth
   AT+QMAP="MPDN_rule",0,1,0,3,1,"<mac>"          # usb
2. AT+QMAP="IPPT_NAT",<0|1>
3. AT+QCFG="usbnet",<0-3>
4. AT+QMAP="DHCPV4DNS","enable"|"disable"
5. write /etc/qmanager/ippt_config.json (temp + mv), then cgi_reboot_response
```

`CMD_GAP=0.2` between steps. Every write goes through the script's local `at_write` helper, which checks `qcmd`'s **exit status** and then asserts a line-exact `OK` in the response.

> ℹ️ NOTE: the `OK` assertion is line-exact (`grep -qx 'OK'`), not a `*OK*` substring glob, because a `qcmd` response echoes the issued command back — so any AT argument containing the two characters `OK` would match itself and mask a real failure. Today's validators (hex MAC, fixed enums) cannot produce one, which makes this a latent landmine rather than a live bug. The broader rule — `qcmd` never writes `ERROR` to stdout, so `case "$result" in *ERROR*)` is dead code — is in [`at-command-transport.md`](./at-command-transport.md).

The MAC is validated as `XX:XX:XX:XX:XX:XX` hex and is **required** whenever the mode is not `disabled`.

Because every Apply writes all five, the page's baseline for the four settings the user did not touch is written straight back to the modem. A wrong baseline is therefore not a display bug: it is a config write. See the parser note below.

## Page anatomy (re-authored 2026-10-12)

**page header + Refresh pill → Last applied strip (the anchor card) → Passthrough configuration card** — the compact bento grammar of Watchdog and Latency Monitor. It replaced the 2026-08-31 band of four 104px tiles, the band's state chip and both page Banners.

Geometry, tones, control heights and skeleton line boxes all come from `components/local-network/ip-passthrough/shapes.ts`.

> ⚠️ **`shapes.ts` is this family's own module. Restate geometry in it; never import a shape from `components/cellular/` or from a sibling family.** The values are restated from the Watchdog and Latency Monitor families, not imported.

The route is **lucide**, per the Icon-Boundary Rule. The two `HintIcon` toggletips render a Material glyph, as `HintIcon` does on every route.

### The strip is NOT live state, and must never be captioned as such

This is the most important thing on the page.

```sh
# ip_passthrough.sh:64-76
if [ -f "$IPPT_CONFIG" ]; then            # /etc/qmanager/ippt_config.json
    passthrough_mode=$(jq -r '.mode // "disabled"' "$IPPT_CONFIG" …)
    …
else
    passthrough_mode=$(jq -r '.device.ippt_mode // "disabled"' "$POLLER_CACHE" …)
    …
fi
```

The GET reads **our own POST's config file** first, falling back to poller fields captured once at boot. **No AT command is issued on GET.** So the strip reports what QManager last wrote, not what the modem is currently doing — and if the modem's rule were changed by anything else, or a write partially succeeded, the strip would not know.

The strip's eyebrow therefore says **"Last applied"**, never "In force", and the mode blurbs are written as configuration ("Set to hand the WAN IP to the Ethernet device"). `status-strip.tsx` carries a two-line comment holding the same rule.

> ⚠️ **Do not re-caption the strip as live.** Making it genuinely live requires an `AT+QMAP="MPDN_RULE"` (and siblings) read on GET — a backend change on the AT mutex. Until that exists, "last applied" is the strongest honest claim.

### The poller fallback reads the reply line, not the echo (fixed 2026-10-12)

The fallback matters on any device where QManager has never applied passthrough, because `/etc/qmanager/ippt_config.json` does not exist there. The poller's boot pass runs `AT+QMAP="MPDN_RULE";+QMAP="IPPT_NAT"`, `AT+QCFG="usbnet"` and `AT+QMAP="DHCPV4DNS"` once, and `parse_ippt_nat`, `parse_ippt_usbnet` and `parse_ippt_dhcpv4dns` turn the replies into `boot_ippt_*`.

A `qcmd` response begins with the echoed command line, and that line names the same key as the reply (`IPPT_NAT`, `usbnet`, `DHCPV4DNS`). The three parsers matched the key anywhere, so they parsed the echo and fell back to `0` / `0` / `disabled`. Each now accepts only a line that **starts** with `+QMAP:` or `+QCFG:` and names its key:

```sh
awk -F',' 'index($0,"+QMAP:")==1 && index($0,"\"IPPT_NAT\"") {print $2+0; exit}'
```

Measured on the RM520N-GL (serial `61368cd2`, 2026-10-12, no `ippt_config.json`): the modem answered `IPPT_NAT` `1`, `usbnet` `1` (ECM), `DHCPV4DNS` `enable`. The old parsers reported `0` / `0` (RMNET) / `disabled` from the same captured text; the new ones report `1` / `1` / `enabled`. The RG501Q-EU was not run.

- **Config-file-first is unchanged.** Once a POST has written `ippt_config.json`, the poller values are never read.
- **The fix takes effect at the next boot after the update ships**, because the values are captured once at boot.
- **`parse_ippt_mpdn_rule` is anchored on `+QMAP:` too** (2026-10-12). Before that it was safe only because the key is case-sensitive: the reply says `MPDN_rule` and the echo `MPDN_RULE`.
- **A new boot parser must anchor on the reply prefix.** Any unanchored match on a key that also appears in the issued command reads the echo.

### The Last applied strip

`status-strip.tsx` — one `HERO_SHELL` card (`rounded-hero`). On the left: a 44px mode disc, the "Last applied" eyebrow, a title and a one-line blurb. On the right: five figures. Below a 48rem card each figure becomes a 42px receipt pill (key left, value right); from 48rem they sit in one wrapping row as stacked figures, each at least its own content width, so a long MAC wraps the row rather than overlapping its neighbour.

| Figure | Value | Notes |
| ------ | ----- | ----- |
| Mode disc (`RouterIcon` / `EthernetPortIcon` / `UsbIcon`) | Router mode / Ethernet passthrough / USB passthrough | **the only element that takes a tone** — `DISC_TONE.info` (`bg-primary`) when a passthrough mode is saved, `DISC_TONE.neutral` otherwise |
| Target device | the MAC in `font-mono`, "Automatic", or "No device selected" | the MAC prints **only** when a mode is set and it is neither empty nor `AUTOMATIC_MAC`. In router mode the backend keeps whatever string was there last, so printing it would present a stale identifier as the current target |
| NAT | With NAT / Without NAT | |
| USB connection | RMNET / ECM / MBIM / RNDIS | `USB_SHORT` in `status-strip.tsx`; protocol names, identical in every locale, shared with the card's options |
| DNS proxy | On / Off | see the open question below |
| LAN gateway | Served / Not served + `TriangleAlertIcon` | **derived from the saved mode**, not probed: "Not served" whenever the saved mode is not `disabled`. The value stays plain ink; the amber glyph beside it carries the warning |

A failed read that left nothing behind replaces the strip's body with one `CONDITION` block carrying a Retry action. While the first read is in flight, `StatusStripSkeleton` mirrors the strip from the same `STATUS` / `FIGS` constants.

The automatic-target sentinel is `AUTOMATIC_MAC = "FF:FF:FF:FF:FF:FF"`, exported from `shapes.ts` and read by both the strip and the card, so "automatic" is one value in one place.

The MAC is one of the few genuine `font-mono` cases under the Machine-Voice Rule — it is an identifier the modem matches byte-for-byte. It is never truncated.

### The settings card

`ip-passthrough-card.tsx` — one `CARD_SHELL` card titled "Passthrough configuration", committed from `CardFoot` (status left; **Discard changes** then **Apply and reboot**). Two groups, side by side from a 56rem card and stacked below it:

| Group | Row | Control |
| ----- | --- | ------- |
| Passthrough | Mode | `SegmentedField`: Router / Ethernet / USB |
| Passthrough | Target device | `SegmentedField` (`breakpoint="lg"`): Automatic / From LAN / By MAC. From LAN shows the device picker (a `Select` over `useLanDevices`, GET `network/lan_devices.sh`, rescanned on every switch to From LAN, with a rescan button). Scanning shows a status line only; empty offers Rescan and Enter manually, failed offers Retry and Enter manually. The pick is written into the same MAC draft as a typed one, and Apply is blocked unless that MAC is in the latest successful scan. By MAC reveals the MAC input. Held (key dimmed, control disabled, "Pick a mode first.") while the draft mode is `disabled` |
| Network | NAT | `SegmentedField`: With NAT / Without NAT, `HintIcon` |
| Network | USB connection | `SegmentedField` (RMNET / ECM / MBIM / RNDIS) from a 32rem card; a `Select` on its own line below it (`breakpoint="lg"`) |
| Network | DNS proxy | `SegmentedField`: Off / On, `HintIcon` |

Every `SegmentedField` passes `glyph={NO_GLYPH}` (a function returning `null`): the fill marks the pick, with no check glyph. Rows are 14px apart within a group (`gap-3.5`), groups 28px apart when stacked (`gap-y-7`), columns 40px apart (`gap-x-10`).

A changed row shows a 7px `bg-primary` dot after its key. The dot is reserved on every row and fades in, so marking a row moves nothing. The footer status reads "N unsaved changes" with the same dot.

**The Mode note.** Directly under the Mode row sits an always-visible note (`MODE_NOTE`) with an amber `TriangleAlertIcon`: passthrough stops the modem answering at its LAN gateway, keep Tailscale or another way in. When Mode is dirty the note promotes in place to `destructive-container` with a `RotateCcwIcon`, and its copy depends on the direction:

| Draft mode | Key | Says |
| ---------- | --- | ---- |
| unchanged | `mode_note.rest` | the lockout warning above |
| Ethernet or USB | `mode_note.to_passthrough` | Apply reboots and this tab loses the modem; afterwards the LAN gateway stops answering |
| Router | `mode_note.to_router` | Apply reboots and this tab loses the modem; the LAN gateway answers again after the reboot |

The note sits on the control, before the decision (Product Principle 6). It replaced the two page Banners (`active` and `reboot`), and because it is always mounted, changing Mode no longer pushes the card down. While Mode is dirty, **Apply and reboot** takes the `destructive` variant.

The manual MAC entry is a raw `<input>` on `fieldVariants()` with `MAC_FIELD.INPUT` adding the 42px height and mono type. It does not use the `Input` primitive because `Input` carries `md:text-sm`, a **viewport** breakpoint that would override the row's type on a container-query surface. Typing strips non-hex characters, uppercases and re-inserts colons.

Draft state is `Partial<Draft>` edits over a memoised baseline, never a `useEffect` sync — see the same section in [`ttl-mtu.md`](./ttl-mtu.md) for why. `resolveMac()` is the single path for both the dirty check and the payload, so Router mode always sends an empty MAC.

The card's copy carries no em dashes and no config paths, script or AT-command names.

### The reboot handoff is load-bearing

```tsx
// ip-passthrough-card.tsx, handleConfirmedApply
markSaved();
enterRebootFlow("ip_passthrough");
```

The card no longer writes the handoff itself (RM551E v0.1.34 parity). `enterRebootFlow` (`lib/reboot/index.ts`) waits `REBOOT_NAV_DELAY_MS` (2000 ms), then performs the three steps below; all three are required, and here is why each one exists.

`cgi_base.sh:209-229` (`cgi_reboot_response`, `scripts/usr/lib/qmanager/`) returns `{"success":true}` **immediately** and then, in a backgrounded subshell, polls for `/tmp/qmanager_reboot_ack` before actually rebooting — up to `QM_REBOOT_ACK_TIMEOUT` (default 20 s), then a `QM_REBOOT_POST_ACK_DELAY` (default 1 s) grace, then `reboot`. The `/reboot/` page writes that marker on mount (via `update.sh action=reboot_ack`).

The reason the CGI does not just reboot is that QManager runs on the modem it is rebooting: killing the box mid-response would kill lighttpd mid-serve and the browser would get a dead socket instead of a page.

So:

| Line | Drop it and you get |
| ---- | ------------------- |
| `sessionStorage["qm_rebooting"] = "ip_passthrough"` | the countdown page does not know why it was opened |
| clearing `qm_logged_in` | a stale login cookie survives a device that is about to come back with a fresh session |
| `window.location.href = "/reboot/"` | nothing ever writes the ack marker, so the reboot is **delayed to the full `QM_REBOOT_ACK_TIMEOUT`** — silently. Everything reports success; the modem just sits there for 20 seconds |

Each failure is quiet. A re-author that keeps the confirm dialog and drops the `enterRebootFlow` call (or hand-rolls a partial copy of it) ships green with a broken reboot — which is why the review rule on this surface is **the handoff, not the dialog**. Nothing checks it automatically.

A failed apply fires `toast.error` and stays on the page. A successful one fires no toast: the navigation to `/reboot/` is its success signal (the navigation exception in [`toast-confirmation.md`](./toast-confirmation.md)).

### The confirm dialog stays (approved veto A)

A reboot is a deferred, deliberate act, so the `AlertDialog` survives. It states that the modem reboots immediately and signs you out, adds the gateway warning (`dialog.body_gateway`) only when the draft mode is not `disabled`, and notes that the setting persists. The same warning is readable before Apply, in the Mode note.

## Open question: the DNS-proxy figure asserts nothing about Custom DNS

The DNS proxy figure and row report `dns_proxy`, which is `AT+QMAP="DHCPV4DNS"` — **what the modem's DHCP server hands LAN clients as their DNS server**. That is all it is documented to do in this tree, and the row's hint says only that.

Whether either polarity causes clients to bypass the modem's `dnsmasq` proxy (and therefore bypass Custom DNS) is **undocumented and unverified here**. The page deliberately makes no claim about it, and neither page links to the other on this basis.

**The probe that would settle it:** on a live RM520N-GL, set `dns_proxy` each way and read the DNS option a LAN client actually receives (`nmcli dev show` / `resolvectl status` on the client, or a DHCP `OFFER` capture), while watching whether queries still reach `dnsmasq` on `192.168.225.1:53`.

Related, and separately unfinished: `custom_dns.sh`'s own `get_passthrough_bypass` is a stub returning literal `"false"` with a TODO — see [`custom-dns.md`](./custom-dns.md).

## Related

- [`custom-dns.md`](./custom-dns.md) — the sibling surface; the `passthroughBypass` stub and the `<DNSMode>` read-time gate
- [`ttl-mtu.md`](./ttl-mtu.md) — the `Partial<Draft>` baseline pattern
- [`at-command-transport.md`](./at-command-transport.md) — `qcmd` failure detection, the echoed command line, `flock` serialization
- [`toast-confirmation.md`](./toast-confirmation.md) — the navigation exception the Apply path uses
- [`qmanager-independence.md`](./qmanager-independence.md) — Tailscale, the way back in when the LAN gateway is gone
