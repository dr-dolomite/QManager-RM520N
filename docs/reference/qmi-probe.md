# QMI probe (`native/qmi_probe`)

> **Applies to:** RM520N-GL (SDX65) · verified 2026-10-26 / WMS 2026-10-27 on serial 61368cd2, firmware RM520NGLAAR03A03M4G
> **RG501Q-EU (SDX55):** run read-only 2026-10-28 on serial b7e3d6f1, firmware RG501QEUAAR12A11M4G_04.202 (scan, `.orchestra/runs/2026-10-28-rg501q-port-scan.md` §1). The read requests below answer the same (NAS, DMS, UIM and WMS also as `www-data`), except: NAS 0x005A Tx/Rx **works** for LTE there (per-chain TLVs 0x10–0x16; NR gives `0x005D`), DMS rejects 0x001E with `0x005E`, and WMS 0x0036 reports ME **127** (not 255) / SM 35. WMS writes and an incoming-message indication were not run

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
- `qmi_probe sms list|info|scan|limits|watch ...`: WMS reads (storage `me` = NV, `sm` = UIM). Metadata only: tag, encoding, char count, concat IE, masked sender
- `qmi_probe --allow-sms-write sms tag|del ...` and `qmi_probe --allow-sms-send sms send [dry] <number> <text..>`: store writes and Raw Send. `send` encodes with the broker's codec (`native/qmanager_atd/src/sms/pdu.rs`, included by path); `dry` prints the PDUs without sending

**Rules**
- Requests are reads, except the `--allow-config` binds and NAS 0x006C, which apply only to the probe's own socket and are released on exit.
- Never add scans (NAS 0x0021), sets or call control to the whitelist without the user's OK.
- Don't print SMS bodies into transcripts. Every send costs money and reaches a person: ask the user for the number and a yes first.
- Run `pgrep`/`kill` patterns that cannot match the calling shell's own command line (use `modem_kill`).

## Results (2026-10-26)

| Request | Result |
| --- | --- |
| NAS serving / signal / cell / RF band / CA / sys info / sys-sel; DMS IDs / rev / model / op mode / time; UIM card / slots; WDS profile list; DSD status | All OK, 17 reads in ~15 ms |
| NAS 0x005A Tx/Rx info (LTE and NR) | `0x005E` not supported, same as the RM551E |
| WMS 0x0031 List Messages, `01=01 11=01` (NV/ME storage, GW mode) | OK, ~1 ms; count matches `AT+CPMS` |
| WMS 0x0031, `01=00` (UIM storage) | OK |
| WMS 0x0022 Raw Read, `01=01<idx u32 LE> 10=01` | OK, ~4 ms; the read/unread tag is unchanged |
| WMS 0x0034 | Returns the SMSC address (an earlier whitelist mislabelled 0x0020 Raw Send and 0x0024 Delete as reads; fixed 2026-10-27) |
| WDS 0x002D current settings / 0x0024 packet stats, unbound | `0x000F` / `0x0046`. Both are now broker reads on the broker's own bound clients (`BROKER_READ`; 0x002D since broker 0.7.0, TLV ids re-confirmed by a raw dump 2026-10-29) and stay refused to socket clients: [`qmi-lane.md`](qmi-lane.md) |
| The same, after `wds-bound 1 4` (mux 1 = `rmnet_data0`, IPv4) | OK: IP, DNS ×2, gateway, netmask and MTU match `AT+CGCONTRDP`; rx bytes match `/proc/net/dev` |
| Same probe as `www-data` (`sudo -n -u www-data`) | OK for NAS, UIM and WMS; no root needed |
| 0x001E Get Supported Messages | Answers on VOICE 9, LOC 16, SAR 17, TMD 24 and PDC 36; NAS, WDS, WMS and UIM reject it (`0x0047`) |

Published but not exercised: LOC (GNSS needs the engine started) and NAS network scan (it uses the radio).

## WMS SMS results (T5.0, 2026-10-27)

Findings and the T5.1 design inputs: `.orchestra/runs/2026-10-26-atd-port-T5.0.md`.

| Request | Result |
| --- | --- |
| 0x0031 list + 0x0022 read + decode, all 145 ME (NV) messages | ~80–100 ms total, 0.4 ms per read; root and www-data alike; PDU starts with the SMSC octet, so `pdu::decode_deliver` reads it unchanged |
| Same for 31 SM (UIM) messages | ~1.6 s; ~50 ms per read (SIM I/O) |
| 0x0022 read of unread messages | Tag stays unread. `sms_tool recv` (AT+CMGL) marks every listed message read |
| 0x0036 store max size | ME 255 / SM 35, free count = `AT+CPMS` used/total |
| 0x0033 routes | Classes 1–3 and none: store and notify to NV (class 2 to UIM); class 0: transfer and ack. No route change needed |
| 0x0030 message protocol | `0x0019` (CDMA-only message) |
| 0x0020 Raw Send, 1 part, GW PDU with SMSC octet | OK, 896 ms, message ref returned in TLV 0x01 |
| 0x0020 when the network refuses | `0x0036` + TLV 0x12 RP cause 21, ~650 ms; seen for a 2-part send and a single-part retry (SIM had no send credit) |
| 0x0023 Modify Tag | OK, ~9 ms |
| 0x0024 Delete by index / by tag | OK, ~9 ms / ~104 ms for 3; reading a deleted index returns `0x0032`; `AT+CPMS` count follows |
| 0x0001 Set Event Report + 0x0001 indication | One indication per stored message (TLV 0x10 storage + index, 0x12 mode, 0x16), to two clients at once (root + www-data) while vendor daemons run; `AT+CPMS` sees the message too |
| Incoming 3-part message | Three indices, three indications ~0.6 s apart, 8-bit concat IE (ref, part, total) in each |
| WMS while `sms_tool` holds the AT lock | No WMS call takes the lock; ME scan unchanged during an ME `sms_tool` read, slowed to 1.3 s during an SM (UIM) `sms_tool` read |

## WMS follow-up probes (T5.1, 2026-10-28)

Run against the shipped `qsms` and a scratch probe build. Findings: `.orchestra/runs/2026-10-26-atd-port-T5.1.md`.

| Request | Result |
| --- | --- |
| 0x0031 list with a tag filter that matches nothing | Success, count 0 (TLV 0x01 = `00000000`), not error 0x32. `qsms` treats both as an empty storage |
| 0x0033 routes vs `AT+CPMS` mem3 | Same setting: `AT+CPMS="ME","ME","SM"` moves classes 0/1/3/none from NV to UIM; restoring ME restores the routes byte-identically. The CPMS write stays |
| 0x0021 Raw Write of one SMS-DELIVER to NV | Stored and decoded by `qsms list`; raises **no** 0x0001 indication. Used only to make a message to delete: 0x0021 is not in `WHITELIST`, and the scratch build that allowed it was not committed |
| 0x0024 delete of that message, then again | `deleted`, then `no such message` (0x0032) |
| 0x0020 Raw Send to the modem's own number, no SIM credit | RP cause 21 for GSM-7 and UCS-2; `sms_tool send` got `+CMS ERROR: 350` on the same SIM |
| 0x0020 Raw Send with credit | 2-part GSM-7 (185 chars) and a UCS-2 single delivered; `qsms watch` printed one line per stored part |
| 0x0023 Modify Tag, unread then read | `qsms list` `stat` 0 and `AT+CMGL=0` lists only that index; WMS tag 1 = AT stat 0 |
