# LAN Gateway IP (planned feature — feasibility notes)

> **Status: not built.** No CGI endpoint, hook, or UI exists yet. This doc
> records what was learned while manually validating the mechanism on both
> reference devices, so a future implementation doesn't have to re-derive it.
> **Applies to:** RM520N-GL and RG501Q-EU — confirmed live on both, 2026-08-25.

> The idea: let the user change the modem's LAN gateway IP (default
> `192.168.225.1` on both platforms) from the QManager UI — the same use case
> as the SimpleAdmin-era `LAN_settings.sh` console menu, but as a proper CGI +
> frontend feature. Motivating case: running an RM520N-GL and an RG501Q-EU on
> the same Ethernet segment, where both defaulting to `192.168.225.1` collide.

> ### ✅ The motivating case has been resolved by hand — and it paid off immediately
>
> **2026-08-25:** the RG501Q-EU's `bridge0` was moved to **`192.168.120.1/24`**
> using the mechanism documented below, and the RM520N-GL was left on
> `192.168.225.1`. SSH to the RG501Q at its new address is **verified working**.
> Recorded in [`platform-matrix.md`](./platform-matrix.md) > Device access.
>
> **Simultaneous reachability is proven as of 2026-08-25** — both devices answered
> from the same host minutes apart, each identity-proven from `/proc/cmdline`
> (`61368cd2` and `b7e3d6f1`). The earlier reading (host holding only
> `192.168.120.34`, RM520N-GL offline) was a transient host-addressing state.
> ⚠️ Still **check** it rather than assuming it: the host must hold an address on
> *both* subnets and does not do so automatically, and either device may be
> powered down.
>
> This is worth more than convenience. Every cross-device defect found so far
> (`wget`, `timeout`, `mountpoint`) was found by running one command on both
> devices and comparing — and none was found by reading code. While the two
> collided on one address they could not be compared without physically swapping
> cables, which is precisely why the divergences went unnoticed until a second
> device existed. `change-workflow.md`'s *device-diff before agents* rule depends
> on this state holding.
>
> **It also means this feature now has a validated end-to-end precedent**: the
> edit, the `AT+CFUN=1,1` apply, and the post-reboot recovery (blocker **F8**)
> have all been exercised on real hardware rather than reasoned about.
>
> **F8 is fixed as of 2026-08-25 (`952309e`) — the blocker is lifted for the
> RG501Q-EU**, validated on that device across three reboots. The **RM520N-GL was
> measured the same day and is confirmed exposed too** (all four preconditions
> present; the defect was observed firing on the captured boot and won only by an
> accidental timing shield). The fix has since been applied to that device and
> **reboot-validated 2026-08-25** — guard persisted, `rc.unslung`'s selector no
> longer matches `S80lighttpd`, QManager healthy on 80 and 443. **The blocker is
> lifted on both platforms.** Note the RM520N-GL was fixed by hand rather than by an
> installer run, so the installer's own end-to-end path is still unexercised on it
> (F8 follow-up 3).

---

## Quick Reference

| Item | Value |
|------|-------|
| Config file | `/etc/data/mobileap_cfg.xml` (same file Custom DNS reads — see [`custom-dns.md`](./custom-dns.md)) |
| Gateway IP field | `//MobileAPLanCfg/APIPAddr` |
| Companion fields that must move with it | `//MobileAPLanCfg/DHCPCfg/StartIP`, `.../EndIP` (must stay inside the new subnet) |
| Unrelated but adjacent field | `//MobileAPLanCfg/GatewayURL` (a hostname alias, e.g. `mobileap.qualcomm.com` — cosmetic, not the IP) |
| Editing tool, RM520N-GL | `/usr/bin/xmllint` is system-bundled; `xmlstarlet` is **not** installed by default (see `docs/BACKEND.md`) |
| Editing tool, RG501Q-EU | **Neither** `xmllint` nor `xmlstarlet` present (checked directly, 2026-08-25) — use `sed -i` on the known-format lines, same as this investigation did |
| Apply mechanism | Full modem reboot (`AT+CFUN=1,1`) — the live `bridge0`/LAN interface does not pick up the new IP until then; no live-reload path exists |
| Former blocker (now fixed) | **F8** in [`platform-matrix.md`](./platform-matrix.md) — a reboot could leave QManager's web UI unreachable regardless of the IP change, because Entware's own `lighttpd` sometimes took port 80 first. **Fixed 2026-08-25 in `952309e`; boot-validated on the RG501Q-EU over 3 reboots and on the RM520N-GL over 1. Lifted on both platforms.** |

---

## What was verified live (2026-08-25)

Both devices carry the identical XML schema for this file — this is Quectel
vendor format, not something either platform's QManager port introduced:

```
/etc/data/mobileap_cfg.xml
  <APIPAddr>192.168.225.1</APIPAddr>      <!-- gateway IP, both devices, stock default -->
  <GatewayURL>mobileap.qualcomm.com</GatewayURL>
  <SubNetMask>255.255.255.0</SubNetMask>
  <StartIP>192.168.225.20</StartIP>
  <EndIP>192.168.225.60</EndIP>
```

The RG501Q-EU was moved from `192.168.225.1` to `192.168.120.1` (chosen to
stop colliding with the RM520N-GL, which stays at its default) using:

```sh
sed -i 's|<APIPAddr>192.168.225.1</APIPAddr>|<APIPAddr>192.168.120.1</APIPAddr>|' /etc/data/mobileap_cfg.xml
sed -i 's|<StartIP>192.168.225.20</StartIP>|<StartIP>192.168.120.20</StartIP>|'   /etc/data/mobileap_cfg.xml
sed -i 's|<EndIP>192.168.225.60</EndIP>|<EndIP>192.168.120.60</EndIP>|'         /etc/data/mobileap_cfg.xml
atcli_smd11 'AT+CFUN=1,1'   # full reboot — required to apply
```

Post-reboot, `bridge0` came up as `192.168.120.1/24` (confirmed via
`ip addr show bridge0`), and the edited XML file survived the reboot
unchanged — `/etc` is a persistent UBIFS volume on both platforms (see the
Filesystem & partitions table in `platform-matrix.md`), so no remount step
was needed before the edit.

**A backup of the pre-edit file was left on-device** at
`/etc/data/mobileap_cfg.xml.bak-1787634825` (RG501Q-EU only, from this
session) — delete it once a real implementation lands, or fold it into
whatever backup convention that implementation adopts.

## Why the DHCP range has to move too

`StartIP`/`EndIP` are absolute addresses, not offsets from `APIPAddr`. If a
future implementation only rewrites `APIPAddr`, the modem hands out DHCP
leases (`192.168.225.20`–`.60`) that are unreachable from a gateway now
sitting on a different subnet (`192.168.120.1/24`). Any real feature must
compute new `StartIP`/`EndIP` values inside the new subnet (this investigation
mirrored the existing offset: `.20` and `.60` on the new /24) rather than
exposing a single "gateway IP" field that silently leaves DHCP broken.

## The `GatewayURL` field is a decoy

`//MobileAPLanCfg/GatewayURL` (`mobileap.qualcomm.com` on both devices,
stock) is a separate, cosmetic hostname alias — not the mechanism for
changing the actual gateway address. Don't let a future implementation
conflate the two nodes; they're siblings in the same `MobileAPLanCfg` block,
which is exactly how the older SimpleAdmin console menu
(`simpleadmin-source/simpleadmin/console/menu/LAN_settings.sh`) exposed them
as two separate options ("Edit Gateway IPV4 Address" vs. "Edit Gateway URL").

## Former blocker: the reboot itself was unreliable on the RG501Q-EU

> ✅ **Status: fixed 2026-08-25 in commit `952309e`, validated on the RG501Q-EU
> across three reboot cycles. The blocker is lifted for that platform.**
> **RM520N-GL re-verification is still outstanding** — that device was offline
> during the fix work, and repo evidence says it is exposed rather than immune.
> Confirm there before calling this prerequisite closed on both platforms.

This was the more important finding from the session that produced this doc, and it
is **independent of the gateway-IP change** — it would surface on any reboot of the
device. See **F8** in [`platform-matrix.md`](./platform-matrix.md) for the corrected
writeup. In brief: Entware's `rc.unslung.service` starts `S80lighttpd`, the
vendor-default empty-docroot Entware lighttpd, which decides whether to run by asking
`pidof lighttpd` — a process-**name** check. On a boot where no process happens to
carry that name at the moment it looks, it starts and takes port 80 ahead of
QManager's own `lighttpd.service`. QManager's UI is then unreachable on **both** HTTP
(403, empty docroot) and HTTPS (connection refused, nothing bound to 443) until
someone intervenes over SSH.

> ⚠️ Note the correction: this is **not** a port race between two servers, and it is
> **not** every boot. Measured `n=2` — one loss, one win, identical config. The
> original framing in this doc and in F8 was wrong on both counts.

**The reasoning that made this a prerequisite still stands, and should be re-applied
per platform.** Any UI-driven gateway-IP change requires a reboot to apply, and a
feature that sometimes reboots the user out of their own management UI — on the very
platform this feature is meant to help — is a regression, not a convenience. That
argument is now satisfied on the RG501Q-EU and unsatisfied on the RM520N-GL.

## Open questions for a real implementation

- Should the CGI validate the new IP doesn't collide with the WAN-side
  address space, or with well-known ranges the user's upstream router might
  already use?
- Confirm whether `xmllint` can *write* (not just query) on the RM520N-GL —
  it was only ever used for reads elsewhere in QManager (Custom DNS reads
  `<DNSMode>` with it). If not, both platforms end up on the same `sed`-based
  write path, which simplifies the implementation (one code path instead of
  an per-platform branch).
- Does changing the gateway IP need to also update anything under
  `/etc/data/mobileap_cfg.xml`'s NAT or DHCPv6 sibling blocks (`IPv4NATDisable`,
  `ULAIPv6BaseAddr`), or are those independent enough to leave alone? Not
  investigated this session — scoped out.
- A reboot triggered from the QManager UI already has an established pattern
  (deferred via dialog + persistent banner, per `CLAUDE.md`'s modem-platform
  section) — reuse it rather than inventing a new reboot flow for this
  feature.
