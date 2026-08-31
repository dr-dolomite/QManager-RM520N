# IP Passthrough

> **Applies to:** RM520N-GL (SDX65) · verified 2026-08
> **RG501Q-EU (SDX55):** unverified — see [`platform-matrix.md`](./platform-matrix.md)

> The `/local-network/ip-passthrough` page: hand the carrier's WAN IP address straight to **one** downstream device over Ethernet or USB, instead of the modem keeping it and NATing a private LAN behind it.

**Short version:** normally the modem holds the public IP and gives your LAN devices private addresses behind NAT (Network Address Translation — a router rewriting addresses so many devices share one public address). IP Passthrough turns that off for a single nominated device: the modem hands *that* device the WAN address and steps out of the way. The price is that the modem stops answering at its own LAN gateway address, which is usually the address you are reading this page on.

> ⚠️ **This feature can lock you out of the device you are configuring.** QManager runs *on* the modem. Once passthrough is active the LAN gateway stops being served, so the way back in is Tailscale, the passthrough device itself, or a serial console. The page says this on the control, before you decide — not only inside the confirm dialog.

## Quick Reference

| Item | Value |
| ---- | ----- |
| Route | `app/local-network/ip-passthrough/page.tsx` (thin re-export) |
| Components | `components/local-network/ip-passthrough/` — `shapes.ts`, `ippt-strip.tsx`, `ip-passthrough-card.tsx`, `ip-passthrough.tsx` (shell) |
| Hook | `hooks/use-ip-passthrough.ts` |
| Types | `types/ip-passthrough.ts` |
| CGI | `scripts/www/cgi-bin/quecmanager/network/ip_passthrough.sh` |
| Persisted config | `/etc/qmanager/ippt_config.json` (written by our own POST) |
| Poller fallback | `/tmp/qmanager_status.json` → `.device.ippt_*` |
| i18n root | `ipPassthrough.*` (79 leaves × 5 locales) |
| Harness | `scripts/test/local-network-settings-design-language.sh` |
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

## Page anatomy (re-authored 2026-08-31)

**page header + Refresh pill → Band A (read-only tiles) → Band B (write card)** — the grammar `/local-network/ethernet` landed on (`2511953`) and `/local-network/traffic-engine` adopted (`0fdfc65`).

Before this pass the page showed **no state at all**: it opened directly on the fields you can write, on a surface where the single most important question is "is passthrough on right now, and to which device". `ip-passthrough-card.tsx` also imported `useTranslation` **zero** times — 47 hardcoded English literals, and a `SaveButton` with no `label` prop.

Geometry, tones, control heights and skeleton line boxes all come from `components/local-network/ip-passthrough/shapes.ts`.

> ⚠️ **`shapes.ts` is this family's own module. Restate geometry in it; never import a shape from `components/cellular/` or from a sibling `/local-network/` family.**

The route is **lucide**, per the Icon-Boundary Rule.

### Band A is NOT live state, and must never be captioned as such

This is the most important thing on the page.

```sh
# ip_passthrough.sh:64-78
if [ -f "$IPPT_CONFIG" ]; then            # /etc/qmanager/ippt_config.json
    passthrough_mode=$(jq -r '.mode // "disabled"' "$IPPT_CONFIG" …)
    …
else
    passthrough_mode=$(jq -r '.device.ippt_mode // "disabled"' "$POLLER_CACHE" …)
    …
fi
```

The GET reads **our own POST's config file** first, falling back to poller fields captured once at boot. **No AT command is issued on GET.** So the band reports what QManager last wrote, not what the modem is currently doing — and if the modem's rule were changed by anything else, or a write partially succeeded, the band would not know.

The band therefore says **"Last applied"**, never "In force". Every caption on it is written to that standard, and the card's provenance line reads *"Read back from:"* rather than claiming a measurement.

> ⚠️ **Do not re-caption these tiles as live.** Making the band genuinely live requires an `AT+QMAP="MPDN_RULE"` (and siblings) read on GET — a backend change on the AT mutex, Tier 3, out of scope for a frontend pass. Until that exists, "last applied" is the strongest honest claim.

This is still strictly better than what it replaced, which was nothing.

### The four tiles

| Tile | Value | Notes |
| ---- | ----- | ----- |
| Mode (`EthernetPortIcon` / `UsbIcon` / `RouterIcon`) | Ethernet / USB / Router | **the only tile that takes a tone** — `primary` disc when passthrough is set, neutral otherwise, each state with its own glyph |
| Target device (`MonitorSmartphoneIcon`) | the MAC in `font-mono`, or `—` | printed **only** when a mode is set and the MAC is neither empty nor the automatic sentinel. In router mode the backend keeps whatever string was there last, so printing it would present a stale identifier as the current target |
| NAT (`ArrowLeftRightIcon`) | On / Off | |
| DNS proxy (`GlobeIcon`) | On / Off | see the open question below |

Tile bodies are neutral (`bg-surface-container`); colour lives on the 52 px disc only. A failed read that left nothing behind replaces the whole grid with one spanning `NoticeTile` carrying a Retry action, rather than four identical "couldn't read" tiles. The band header carries a two-state chip: `router` / `passthrough`.

The MAC is one of the few genuine `font-mono` cases under the Machine-Voice Rule — it is an identifier the modem matches byte-for-byte. The em dash is not an identifier and stays in the UI face.

### The three-line reboot handoff is load-bearing

```tsx
// ip-passthrough-card.tsx:417-419
sessionStorage.setItem("qm_rebooting", "1");
document.cookie = "qm_logged_in=; Path=/; Max-Age=0";
window.location.href = "/reboot/";
```

The harness asserts all three tokens, and here is why each one exists.

`cgi_base.sh:216-235` (`cgi_reboot_response`) returns `{"success":true}` **immediately** and then, in a backgrounded subshell, polls for `/tmp/qmanager_reboot_ack` before actually rebooting — up to `QM_REBOOT_ACK_TIMEOUT` (default 20 s), then a `QM_REBOOT_POST_ACK_DELAY` (default 1 s) grace, then `reboot`. The `/reboot/` page writes that marker on mount (via `update.sh action=reboot_ack`).

The reason the CGI does not just reboot is that QManager runs on the modem it is rebooting: killing the box mid-response would kill lighttpd mid-serve and the browser would get a dead socket instead of a page.

So:

| Line | Drop it and you get |
| ---- | ------------------- |
| `sessionStorage.setItem("qm_rebooting","1")` | the countdown page does not know why it was opened |
| clearing `qm_logged_in` | a stale login cookie survives a device that is about to come back with a fresh session |
| `window.location.href = "/reboot/"` | nothing ever writes the ack marker, so the reboot is **delayed to the full `QM_REBOOT_ACK_TIMEOUT`** — silently. Everything reports success; the modem just sits there for 20 seconds |

Each failure is quiet. A re-author that keeps the confirm dialog and drops one of these ships green with a broken reboot, which is exactly why the harness pins the tokens rather than the dialog.

### The confirm dialog stays (approved veto A)

A reboot is a deferred, deliberate act, so the `AlertDialog` survives. **What changed is where the consequence is readable.** The riskiest sentence on the surface — *"the device's local gateway will no longer be reachable"* — used to exist only *inside* the dialog, visible after Apply had already been pressed.

It now sits on the control, in the Mode row's required consequence sentence, before the decision:

> *"Ethernet or USB hands the WAN IP to one device. In either, the modem stops being reachable at its LAN gateway address — keep Tailscale or another way in."*

Product Principle 6: make the dangerous obvious. Two conditional banners sit above the card, each about the **system** rather than about one field, and each leaving when its condition leaves (so neither carries a dismiss):

| Banner | Renders when | Says |
| ------ | ------------ | ---- |
| `active` (`role="degraded"`) | the **baseline** mode is not `disabled` | you can read this page precisely because you are *not* the passthrough device, and names the MAC that took the WAN IP |
| `reboot` (`role="stale"`, `RotateCcwIcon`) | the mode row is **dirty** | pressing Apply reboots the modem and this tab loses it |

The reboot banner takes an explicit `RotateCcwIcon` rather than its role's default triangle, so the two never share a glyph when both are on screen — the Every-Chip-Has-A-Glyph reasoning applied to banners.

The automatic-target sentinel is `AUTOMATIC_MAC = "FF:FF:FF:FF:FF:FF"` (`ippt-strip.tsx:79`), shared by the strip and the card so "automatic" is one value in one place rather than two spellings that can drift.

### Band B — the write card

One peer card, five rows, each with a required consequence sentence that changes with the row's condition (`target` reads *"Pick a mode first"* while the mode is `disabled`). The action is **Apply and reboot**; the delta chip reserves its line (`invisible` when clean) so promoting a row moves nothing.

Draft state is `Partial<Draft>` edits over a memoised baseline, never a `useEffect` sync — see the same section in [`ttl-mtu.md`](./ttl-mtu.md) for why.

### All five Select triggers were rendering at 36 px on a 42 px system

`select.tsx:40` ships `data-[size=default]:h-9`. That is an attribute selector plus a class — specificity **(0,2,0)** — and it beats a bare `h-[2.625rem]` at (0,1,0). `tailwind-merge` keeps both, because they sit in different modifier groups, so the primitive simply wins and the control renders 36 px against a call site asking for 42.

It looks approximately right, which is why it survived review on this page for its whole life. `shapes.ts` now writes `h-[2.625rem]!` and the trigger measures **42 px**.

The dark fill has the same shape of problem, one step worse: `select.tsx`'s own `dark:bg-input/30` is also (0,2,0), so an unprefixed fill loses outright; once *both* halves are `dark:`-prefixed they **tie**, and a tie is decided by Tailwind's deterministic name sort (`bg-input…` before `bg-surface-…` only because *i* precedes *s*). `FIELD` therefore writes `dark:bg-surface-container-high!` and wins by construction rather than by alphabet.

The manual MAC entry uses a raw `<input>` rather than the `Input` primitive, for the same reason plus one more: `Input` carries `md:text-sm`, a **viewport** breakpoint leaking into a container-query surface.

> ℹ️ NOTE: these are local corrections. `input.tsx` / `select.tsx` / `textarea.tsx` remain an open product-wide Migration Delta in `DESIGN.md`; migrating the primitives retires every marker here.

## Open question: the DNS-proxy tile asserts nothing about Custom DNS

The DNS tile reports `dns_proxy`, which is `AT+QMAP="DHCPV4DNS"` — **what the modem's DHCP server hands LAN clients as their DNS server**. That is all it is documented to do in this tree.

Whether either polarity causes clients to bypass the modem's `dnsmasq` proxy (and therefore bypass Custom DNS) is **undocumented and unverified here**. The tile deliberately makes no claim about it, and neither page links to the other on this basis.

**The probe that would settle it:** on a live RM520N-GL, set `dns_proxy` each way and read the DNS option a LAN client actually receives (`nmcli dev show` / `resolvectl status` on the client, or a DHCP `OFFER` capture), while watching whether queries still reach `dnsmasq` on `192.168.225.1:53`.

Related, and separately unfinished: `custom_dns.sh`'s own `get_passthrough_bypass` is a stub returning literal `"false"` with a TODO — see [`custom-dns.md`](./custom-dns.md).

## Related

- [`custom-dns.md`](./custom-dns.md) — the sibling surface; the `passthroughBypass` stub and the `<DNSMode>` read-time gate
- [`ttl-mtu.md`](./ttl-mtu.md) — the third surface re-authored in the same pass
- [`ethernet.md`](./ethernet.md) — the reference implementation for this page grammar
- [`at-command-transport.md`](./at-command-transport.md) — `qcmd` failure detection, `flock` serialization
- [`qmanager-independence.md`](./qmanager-independence.md) — Tailscale, the way back in when the LAN gateway is gone
