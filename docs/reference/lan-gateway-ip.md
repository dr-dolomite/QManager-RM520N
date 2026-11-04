# LAN Gateway IP and Subnet

QManager lets the user change the modem's own LAN address (the gateway LAN clients use) and its subnet from the **LAN Address** card on **Local Network → Ethernet** (`/local-network/ethernet/`). The address and mask live only in the Quectel vendor file `/etc/data/mobileap_cfg.xml`, which QCMAP reads once at boot, so every change is a file edit followed by a deferred reboot. The installer also fixes the firmware's factory /22 LAN mask down to a /24 once, because the /22 covers 192.168.224.0–227.255 and clashes with any router on 192.168.224.1 (for example a sibling RM551E), which made the RM520N-GL unreachable over a Tailscale subnet route.

> **Applies to:** RM520N-GL (measured on firmware `RM520NGLAAR03A03M4G_A0.304`, 2026-10-28). RG501Q-EU: reads verified 2026-10-31, apply not exercised; see [RG501Q-EU](#rg501q-eu).

## Quick Reference

| Item | Value |
| --- | --- |
| UI | **Local Network → Ethernet** → **LAN Address** card (`components/local-network/lan-config-card.tsx`, reconnect view `components/local-network/lan-reconnecting.tsx`, hook `hooks/use-lan-config.ts`, types `types/lan-config.ts`) |
| CGI | `GET` / `POST /cgi-bin/quecmanager/network/lan_config.sh` (source `scripts/www/cgi-bin/quecmanager/network/lan_config.sh`) |
| Root helper | `/usr/bin/qmanager_lan_apply <ipaddr> <prefix>` via `sudo -n` (source `scripts/usr/bin/qmanager_lan_apply`) |
| Sudoers rule | `www-data ALL=(root) NOPASSWD: /usr/bin/qmanager_lan_apply` in `scripts/etc/sudoers.d/qmanager` |
| Shared library | `/usr/lib/qmanager/lan_subnet.sh` — `qm_lan_read`, `qm_lan_write`, `qm_lan_subnet_normalize`, `qm_lan_split`, `qm_lan_prefix_to_mask`, `qm_lan_mask_to_prefix`, `qm_lan_is_private`, `qm_lan_calc`, `qm_lan_host_ok`, `qm_lan_dhcp_range` |
| Installer hook | `normalize_lan_subnet()` in `scripts/install_rm520n.sh`, called from `main()` on fresh install and OTA |
| Config file | `/etc/data/mobileap_cfg.xml` (owner `radio:radio`, mode `0755` on the reference device) |
| Edited fields | `//MobileAPLanCfg/APIPAddr`, `//MobileAPLanCfg/SubNetMask`, `//MobileAPLanCfg/DHCPCfg/StartIP`, `//MobileAPLanCfg/DHCPCfg/EndIP` |
| Factory copy (firmware) | `/etc/data/factory_mobileap_cfg.xml` |
| QManager backup | `/etc/data/mobileap_cfg.xml.qm-bak` — written once, never restored automatically |
| Lock | `/etc/data/.qm_lan_apply.lock` (`flock -n`) |
| Settled marker | `/usrdata/.qm_lan_subnet_set` (`QM_LAN_MARKER`) — set by the first normalize run or any UI apply; while present, install and OTA never touch the mask |
| Per-run copy | `/etc/data/mobileap_cfg.xml.qm-run.<pid>` (removed on every failure, renamed over the file on success) |
| Tooling | BusyBox `awk` reads, `sed` writes. `xmllint` is optional: absent on the RG501Q-EU, used only as an extra well-formedness check where present. `xmlstarlet` is not installed |

Read the live state:

```sh
grep -nE '<(APIPAddr|SubNetMask|StartIP|EndIP)>' /etc/data/mobileap_cfg.xml
ip -4 addr show bridge0
grep dhcp-range /var/run/data/dnsmasq.conf.bridge0
```

## Factory values (RM520N-GL)

Measured 2026-10-28 on serial `61368cd2`, firmware `RM520NGLAAR03A03M4G_A0.304`, before any QManager edit:

| Field | Factory value |
| --- | --- |
| `APIPAddr` | `192.168.225.1` |
| `SubNetMask` | `255.255.252.0` (/22, covers `192.168.224.0`–`192.168.227.255`) |
| `StartIP` / `EndIP` | `192.168.225.20` / `192.168.225.170` |
| `bridge0` | `inet 192.168.225.1/22 brd 192.168.227.255` |
| dnsmasq | `dhcp-range=bridge0,192.168.225.20,192.168.225.170,255.255.252.0,43200` |

The /22 is the firmware default, not something an earlier QManager wrote. `factory_mobileap_cfg.xml` carries the same four values.

> ℹ️ NOTE: An earlier version of this doc listed the stock values as `/24` and `.20`–`.60`. Those were never correct for the RM520N-GL.

## Why the XML is the only path

- `AT+QMAP="LANIP"` reports `+QMAP: "LANIP",<dhcp_start>,<dhcp_end>,<gateway>` and `AT+QMAP="LAN"` sets the gateway; neither has a mask field. The mask can only be set in the XML.
- QCMAP generates `/var/run/data/dnsmasq.conf.bridge0` (including `dhcp-range`) from the XML at boot. There is no live reload: `bridge0` keeps its old address until a reboot.
- `/etc` is the same persistent, always-`rw` UBIFS volume as `/usrdata`, so the edit needs no rootfs remount and survives the reboot.
- `/etc/data/ipa/IPACM_cfg.xml` carries `IPACMPrivateSubnet` `192.168.225.0` / `255.255.255.0` (factory copy too), so it matches the /24. QManager never edits it; a LAN moved off 192.168.225.x leaves it stale, effect on IPA offload unverified.

## CGI contract

`lan_config.sh`. "Gateway" in the UI is `APIPAddr`, the modem's own address on `bridge0`.

### GET

```json
{ "success": true, "device": "bridge0", "ipaddr": "192.168.225.1", "netmask": "255.255.255.0", "prefix": 24 }
```

`device` is a constant. `prefix` is derived from `SubNetMask` by `qm_lan_mask_to_prefix`; a non-contiguous mask fails the read.

### POST

Body:

```json
{ "ipaddr": "192.168.2.1", "prefix": 24 }
```

`ipaddr` must be a JSON string and `prefix` a JSON integer. Success when the value changed:

```json
{ "success": true, "apply_in_progress": true, "disconnect_window_seconds": 120, "carrier_bounce": true, "new_ipaddr": "192.168.2.1", "netmask": "255.255.255.0", "prefix": 24 }
```

Success when `ipaddr` and `prefix` both equal the stored values (no helper call, no write, no reboot):

```json
{ "success": true, "apply_in_progress": false, "disconnect_window_seconds": 0, "carrier_bounce": false, "new_ipaddr": "192.168.225.1", "netmask": "255.255.255.0", "prefix": 24 }
```

The no-change test compares only address and prefix. A stored DHCP range that differs from what `qm_lan_dhcp_range` would compute is not touched by a no-change save.

`carrier_bounce` is a constant `true` on an applied change. The CGI does not bounce the carrier itself; the reboot drops the link. The field keeps the response shape the RM551E card expects.

### Errors

Every error is `{ "success": false, "error": "<code>", "detail": "<text>" }` from `cgi_error`, HTTP 200 unless noted.

| `error` | Cause |
| --- | --- |
| `lan_read_failed` | GET: `lan_subnet.sh` missing, XML unreadable or incomplete, or a malformed stored mask |
| `no_body` | POST with an empty or missing `CONTENT_LENGTH` |
| `invalid_ipaddr` | `ipaddr` missing, not a string, or not a strict dotted quad (4 octets 0–255, no leading zeros) |
| `invalid_prefix` | `prefix` missing, not an integer, or outside 16–30 |
| `invalid_private_address` | Not in `10.0.0.0/8`, `172.16.0.0/12` or `192.168.0.0/16` (so `100.64/10` and `169.254/16` fail) |
| `invalid_host_in_subnet` | `ipaddr` is the network or broadcast address of the requested subnet |
| `update_in_progress` | HTTP **409**. A live `/tmp/qmanager_update.pid` (checked in the CGI, and again in the helper as exit 3) |
| `lan_busy` | Helper exit 4: another apply holds the lock |
| `lan_save_failed` | Any other helper failure (exit 2 or 5) |

The CGI validates everything the helper validates, so a helper exit 2 is not expected in practice; it maps to `lan_save_failed`.

### Deferred reboot

On a successful write the CGI:

1. Runs `sudo -n /usr/bin/qmanager_crash_log_append user`, so the coming reboot is classified as user-initiated (same as `system/reboot.sh`). A failure here never blocks the reboot.
2. Calls `cgi_reboot_response "<body>"`. The optional argument is new in `scripts/usr/lib/qmanager/cgi_base.sh`: it prints the given JSON body instead of `{"success":true}`, then a detached subshell waits for `/tmp/qmanager_reboot_ack` and reboots.

The reboot is released by `GET /cgi-bin/quecmanager/system/update.sh?action=reboot_ack` (which touches `/tmp/qmanager_reboot_ack`) or by the `QM_REBOOT_ACK_TIMEOUT` of 20 s, plus `QM_REBOOT_POST_ACK_DELAY` (1 s). The hook sends the ack itself as soon as the POST reply is parsed; a failed ack is harmless because of the timeout.

`disconnect_window_seconds: 120` covers the ack wait, the reboot and margin.

## Root helper: `qmanager_lan_apply`

```sh
sudo -n /usr/bin/qmanager_lan_apply 192.168.2.1 24
```

On success it prints one line and exits 0:

```json
{"success":true,"ipaddr":"192.168.2.1","netmask":"255.255.255.0","prefix":24,"dhcp_start":"192.168.2.20","dhcp_end":"192.168.2.170"}
```

The CGI discards this output and uses only the exit code.

| Exit | Meaning | `error` on stdout |
| --- | --- | --- |
| 0 | Written | — |
| 2 | Usage or validation failure | `usage`, `invalid_ipaddr`, `invalid_prefix`, `invalid_private_address`, `invalid_host_in_subnet` |
| 3 | An OTA update is running | `update_in_progress` |
| 4 | Lock held by another apply | `lan_busy` |
| 5 | Write failed; the original file is untouched | `lib_missing`, `lock_failed`, `write_failed` |

Order of checks: charset gates, strict dotted quad, prefix 16–30, RFC1918, host-in-subnet, then the OTA guard, then the lock, then the write. The OTA guard tests `/proc/<pid>` for the pid in `/tmp/qmanager_update.pid` rather than `kill -0`, because the helper runs as root and a stale pid file could name any process. BusyBox `flock` has no `-w`, so the lock is `flock -n` and fails fast.

The helper never reboots and never restarts anything. Running it by hand over SSH leaves the change pending until the next reboot.

## DHCP range rule

`StartIP` / `EndIP` are absolute addresses, so they must move with the gateway; a gateway on a new subnet with the old pool would hand out leases nobody can route to. `qm_lan_dhcp_range <gateway> <prefix>` computes them:

1. Keep `<gateway's /24>.20`–`.170` when that range is inside the usable hosts of the new subnet and does not contain the gateway.
2. Otherwise take the larger gap beside the gateway (above it on a tie), capped at 151 addresses.

| Request | DHCP range |
| --- | --- |
| `192.168.225.1/24` | `192.168.225.20`–`192.168.225.170` |
| `10.0.0.1/24` | `10.0.0.20`–`10.0.0.170` |
| `172.16.0.1/16` | `172.16.0.20`–`172.16.0.170` |
| `192.168.1.100/24` | `192.168.1.101`–`192.168.1.251` (gateway sits inside .20–.170) |
| `192.168.1.1/30` | `192.168.1.2`–`192.168.1.2` |

The math works on octets 3 and 4 only, because RFC1918 addresses exceed 2^31 and shell arithmetic is not safe there. That is why the prefix floor is 16: it makes octets 1 and 2 pure network bits and keeps the subnet inside its private block.

## Write invariants (`qm_lan_write`)

`qm_lan_write <file> <ip> <mask> <start> <end>` must run as root. Return codes: 0 written, 1 error (original untouched).

**Reading (`qm_lan_read`)** is one `awk` pass, not an XML parser: it takes the first one-line `<Tag>value</Tag>` for `APIPAddr` and `SubNetMask` directly inside `<MobileAPLanCfg>`, and for `StartIP` and `EndIP` inside its `<DHCPCfg>`. The section tags must sit on lines of their own. A value split across lines, or a missing tag, reads as incomplete (return 1). On the RM520N-GL its output equals `xmllint --xpath` on the live file, the factory file and `.qm-bak` (2026-10-31).

- **Exactly one line per tag.** The file must hold exactly one `<APIPAddr>`, `<SubNetMask>`, `<StartIP>` and `<EndIP>` line before the edit, or nothing is written.
- **`SubNetMask` is anchored.** The match is `^[[:space:]]*<SubNetMask>…` on a whole line, so `<WebServerSubNetMask>` (line 288 on the reference device, value `255.255.255.0`) is never touched. An unanchored `sed 's|<SubNetMask>…'` would also be unsafe if the vendor ever reflowed the file.
- **Per-run copy in the same directory.** `sed` writes `mobileap_cfg.xml.qm-run.<pid>` next to the original, so the final `mv -f` is a same-filesystem rename and atomic. The original is never edited in place.
- **The copy is verified before it replaces anything:** each new line appears exactly once, every other line is byte-identical (`cksum` of the file minus the four tags), `xmllint --noout` passes where `xmllint` exists, and `qm_lan_read` on the copy returns exactly the four requested values.
- **Owner and mode are re-pinned** from `ls -ln` of the original onto the copy before the `mv`. If that cannot be parsed, it falls back to `radio:radio` `0755`. QCMAP runs as `radio`, so a root-owned result would break it.
- **`.qm-bak` is a record, not a rollback.** The first write ever (installer normalize or UI apply) copies the file to `mobileap_cfg.xml.qm-bak` with `cp -p`. Later writes never overwrite it, and nothing restores it automatically. If the backup cannot be written, the edit is refused.
- `GatewayURL` (`mobileap.qualcomm.com`) is a sibling hostname alias, not the address. It is never edited.

## Installer normalize rule

`normalize_lan_subnet()` sources `lan_subnet.sh` from the staging tree (`$SRC_SCRIPTS/usr/lib/qmanager/lan_subnet.sh`) and calls `qm_lan_subnet_normalize /etc/data/mobileap_cfg.xml`. It runs in `main()` before `stop_services`, on fresh install and OTA alike. It is advisory: every failure path warns and returns 0, so it never aborts an install.

It runs once. If `/usrdata/.qm_lan_subnet_set` exists it does nothing. The helper sets that marker on every successful UI apply, and normalize sets it after a successful rewrite or when it finds a non-factory layout, so a user's choice (even a /22 that looks like the factory one) is never undone by a later install or OTA. A missing file or a read failure leaves no marker, so the next install retries.

It changes the file only when all four values match the exact factory layout:

| Field | Required value |
| --- | --- |
| `APIPAddr` | `192.168.225.1` |
| `SubNetMask` | `255.255.252.0` |
| `StartIP`, `EndIP` | both in `192.168.225.2`–`.254`, start ≤ end (valid /24 hosts) |

Then it rewrites **only** the mask to `255.255.255.0`; address and pool stay as they are. Any other layout (already /24, a user-chosen address, a different pool) is logged and left alone. A missing file is skipped with return 0. The new mask takes effect at the next reboot; the installer does not reboot for it.

> ⚠️ WARNING: After the /24 takes effect, a LAN device with a static address in `192.168.224.x`, `192.168.226.x` or `192.168.227.x` can no longer reach the modem. It must move into `192.168.225.x`.

## Frontend

The **LAN Address** card sits beside the speed-limit card on `/local-network/ethernet/` (rendered from `components/local-network/ethernet/ethernet-status.tsx`) and is a port of the RM551E card. The user edits the address and picks a prefix. Applying POSTs to `lan_config.sh`; on `apply_in_progress: true` the hook sends the `reboot_ack`, and the card switches to a reconnect view. That view waits out a reboot grace period, then polls the new address once a second with a `no-cors` fetch (any HTTP reply counts as reachable), and navigates to it, keeping the page's protocol and port because the web port is user-configurable. If the address never answers, it falls back to a manual link.

## Rolling back

Either of these works over SSH as root:

1. Restore the record copy and reboot (you approve the reboot; agents never run it):

   ```sh
   cp -p /etc/data/mobileap_cfg.xml.qm-bak /etc/data/mobileap_cfg.xml
   ```

   Then reboot the modem.

2. Without touching the modem, give the PC a static address in the subnet the modem is actually on (for example `192.168.225.10/24`, gateway `192.168.225.1`) and change the LAN back from the UI.

> ⚠️ WARNING: `.qm-bak` replaces the whole file, so any other QCMAP setting changed after QManager's first edit is lost. It holds the factory /22 layout; the settled marker keeps install and OTA from normalizing it again. Deleting the marker, or uninstalling, re-arms the one-time normalize.

`uninstall_rm520n.sh` leaves the LAN as it is. When `.qm-bak` exists it prints its path. It removes `/etc/data/.qm_lan_apply.lock` and the settled marker `/usrdata/.qm_lan_subnet_set`, so a later reinstall normalizes a factory /22 again.

> ℹ️ NOTE: Between an OTA that normalized the mask (`--no-reboot`) and the next reboot, the file says /24 while `bridge0` is still /22. GET reports the file, and a POST of the same address and /24 counts as unchanged, so nothing applies until the user reboots.

## RG501Q-EU

The vendor schema of `mobileap_cfg.xml` is the same on the RG501Q-EU. Its `bridge0` was moved by hand on 2026-08-25 to `192.168.120.1/24` with `sed -i` on `APIPAddr`, `StartIP` and `EndIP` plus `AT+CFUN=1,1`; see [`platform-matrix.md`](./platform-matrix.md) > Device access. A pre-edit copy was left at `/etc/data/mobileap_cfg.xml.bak-1787634825`.

The RG501Q-EU has no `xmllint`, which is why the library reads with `awk` (until 2026-10-31 every path here needed it and GET answered `lan_read_failed`). Measured on serial `b7e3d6f1`, 2026-10-31, with the library run from `/tmp`:

- `qm_lan_read` returns `192.168.120.1 255.255.255.0 192.168.120.20 192.168.120.60`, as root and as `www-data`.
- `qm_lan_write` on a copy changes only the three target lines and keeps `1001:1001` `0755`.
- `factory_mobileap_cfg.xml` there is already /24 (`192.168.225.1`, pool `.20`–`.60`), so the installer normalize leaves it alone and sets the marker.

A real apply (POST, reboot, reconnect) has not been run on this device.

## Related

- [`ethernet.md`](./ethernet.md) — the rest of the Ethernet page and `qmanager_ethernet_apply`.
- [`custom-dns.md`](./custom-dns.md) — reads the same file and the dnsmasq layering QCMAP generates from it.
- [`platform-matrix.md`](./platform-matrix.md) — per-device addresses and the `xmllint` row (now informational).
