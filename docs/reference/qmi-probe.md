# QMI probe (`native/qmi_probe`)

> **Applies to:** RM520N-GL (SDX65) · verified 2026-10-26 on serial 61368cd2, firmware RM520NGLAAR03A03M4G
> **RG501Q-EU (SDX55):** not run

A developer tool, not shipped in the tarball. It talks QMI to the modem (QRTR node 3) over a raw `AF_QIPCRTR` socket, with no libqmi or `qmicli` (neither exists on the device). It is ported from the RM551E repo's `native/qmi_probe` and adds WMS reads and a `supported` command.

## Build and run

```bash
cd native/qmi_probe && cargo build --release
```

`.cargo/config.toml` defaults to `armv7-unknown-linux-musleabihf` and links statically with `rust-lld`. The output is `target/armv7-unknown-linux-musleabihf/release/qmi_probe` (~440 KB).

Deploy with `scp -O` (or Posh-SSH `Set-SCPItem`) to `/tmp`. `modem_write` strips CRLF, so it cannot carry a binary. Then run it as root through `modem_exec`:

- `qmi_probe json serving sig cell rf ca sysinfo syssel ids rev model opmode time card slots wds-profiles dsd-status`
- `qmi_probe get <svc>:<msg> [tt=hex ..]`: raw request; only (service, message) pairs in `WHITELIST` are sent
- `qmi_probe supported`: Get Supported Messages (0x001E) for each service in `DISCOVER`
- `qmi_probe --allow-config wds-bound <mux> <family> <n> <gap>`: client-local binds, then current settings and packet stats

**Rules**
- Requests are reads, except the `--allow-config` binds and NAS 0x006C, which apply only to the probe's own socket and are released on exit.
- Never add scans (NAS 0x0021), sets or call control to the whitelist without the user's OK.
- Don't print SMS bodies into transcripts.

## Results (2026-10-26)

| Request | Result |
| --- | --- |
| NAS serving / signal / cell / RF band / CA / sys info / sys-sel; DMS IDs / rev / model / op mode / time; UIM card / slots; WDS profile list; DSD status | All OK, 17 reads in ~15 ms |
| NAS 0x005A Tx/Rx info (LTE and NR) | `0x005E` not supported, same as the RM551E |
| WMS 0x0031 List Messages, `01=01 11=01` (NV/ME storage, GW mode) | OK, ~1 ms; count matches `AT+CPMS` |
| WMS 0x0031, `01=00` (UIM storage) | OK |
| WMS 0x0022 Raw Read, `01=01<idx u32 LE> 10=01` | OK, ~4 ms; the read/unread tag is unchanged |
| WMS 0x0034 | Returns the SMSC address |
| WDS 0x002D current settings / 0x0024 packet stats, unbound | `0x000F` / `0x0046` |
| The same, after `wds-bound 1 4` (mux 1 = `rmnet_data0`, IPv4) | OK: IP, DNS ×2, gateway, netmask and MTU match `AT+CGCONTRDP`; rx bytes match `/proc/net/dev` |
| 0x001E Get Supported Messages | Answers on VOICE 9, LOC 16, SAR 17, TMD 24 and PDC 36; NAS, WDS, WMS and UIM reject it (`0x0047`) |

Published but not exercised: LOC (GNSS needs the engine started) and NAS network scan (it uses the radio).
