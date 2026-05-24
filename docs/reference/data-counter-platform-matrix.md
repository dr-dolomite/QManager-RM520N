# Data Counter Platform Matrix

> Cross-platform investigation of how Quectel 5G modems expose cellular byte counters. Companion to [`data-usage-counter.md`](./data-usage-counter.md) (which documents the current Schema v3 implementation).
>
> **Status:** Investigation phase complete for RM502Q-AE (SDX55) and RM520N-GL (SDX65). Findings differ enough between SoCs that a per-firmware lookup table is required if AT counters are ever brought back into the design.

---

## TL;DR

Both probed Quectel 5G modems show **the kernel `rmnet_ipa0` counter is accurate and per-second responsive** — the existing Schema v3 design (kernel-sourced, no AT counter) is mechanically correct on both platforms. The "kernel under-reports because IPA bypasses it" theory is fully disproven.

However, the two SoCs disagree on **AT counter semantics** in ways that would break any naive "use AT counter for cumulative" alternative:

| Question | SDX55 (RM502Q-AE) | SDX65/SDX6X (RM520N-GL) |
|---|---|---|
| Are `QGDCNT` and `QGDNRCNT` independent? | **Yes** — QGDCNT=0 in SA mode | **No — they mirror each other** |
| `QGDNRCNT` field order | `<RX>,<TX>` (opposite of docs) | `<TX>,<RX>` (matches docs) |
| `Branch Name` string in `/etc/quectel-project-version` | `SDX55` | `SDX6X` |

Practical consequence: **the earlier recommendation to "always sum `QGDCNT + QGDNRCNT`" is wrong on SDX65** — it would double-count every byte. AT-based cumulative counters need a per-firmware behavior table, not a one-size-fits-all formula.

---

## The two counters in play

| Counter | Source | Time scope | Survives modem reboot? | Updates on what cadence? |
|---|---|---|---|---|
| Kernel netdev (`/proc/net/dev`, `/sys/class/net/.../statistics/`) | Linux netdev stack, fed by the IPA driver | Per-boot (zeros on interface re-creation) | **No** | Per-second (sub-second on busy flows) |
| AT command (`AT+QGDCNT`, `AT+QGDNRCNT`) | Modem firmware internal | Lifetime (until explicit `=0` reset) | **Yes** | Updates as PS data flows; query whenever |

Neither is universally "right":
- **Cumulative "data used since user reset"** → AT counter is more resilient (no rebase losses when the modem reboots or the rmnet interface flaps), *but* per-firmware quirks mean you can't write portable AT-counter code without a lookup table.
- **Live throughput (bytes/sec)** → kernel counter is the cheap, latency-free choice. Confirmed portable across SDX55 and SDX65.
- **Cross-mode portability** (LTE / NSA / SA) → on SDX55, sum the two AT counters; on SDX65, they're aliases — read either one. Different mental model per platform.

---

## Kernel netdev counter (`rmnet_ipa0`)

On both probed devices, the cellular data plane terminates at the `rmnet_ipa0` netdev. Underneath sit `rmnet_data0..N` — L3-demultiplexed children, one per active PDN context. The `@rmnet_ipa0` notation in `ip link show` exposes the parent/child relationship:

```text
14: rmnet_data0@rmnet_ipa0: <UP,LOWER_UP> mtu 1500 qdisc htb ...
```

**For aggregate WAN accounting, read `rmnet_ipa0`** — not the per-PDN children. The children only count IP-layer payload for one specific PDN; `rmnet_ipa0` is the sum across all PDNs plus signaling/control bytes.

The counter file format is the standard kernel one:
- `/proc/net/dev` columns: after `iface:`, field 2 = `rx_bytes`, field 10 = `tx_bytes`
- `/sys/class/net/$IFACE/statistics/rx_bytes` and `.../tx_bytes` — same numbers, individual files, no field counting needed

**Critical behaviors (confirmed identical on SDX55 and SDX65):**
- **Zeros on interface re-creation** — modem reboot, PDN re-establishment, `cfun=0/1` cycle, mode switch can all destroy and recreate the netdev. The accumulator in `qmanager_poller` handles this via negative-delta rebase logic (`qmanager_poller:728-734`), but bytes that flowed between the last sample and the reset are **lost** — the rebase counts forward from zero, not backward from the missing delta.
- **Real-time updates** — no batching observed on either firmware. Per-second deltas are honest.
- **The IPA hardware path does NOT bypass it** — controlled tests on both devices show full capture of 50 MiB downloads.

### Sub-interface inventory differs slightly

| Sub-interfaces present | SDX55 | SDX65 |
|---|---|---|
| `rmnet_data0` | yes | yes |
| `rmnet_data1..5` | yes | yes (down) |
| `rmnet_data15`, `rmnet_data16` | no | yes (down) |

The extra slots on SDX65 are likely reserved for MHI (Modem Host Interface) channels or additional PDN contexts. They were `state DOWN` in our probe — no impact on the aggregate counter.

---

## AT data counters (`QGDCNT`, `QGDNRCNT`)

These live in modem firmware, surviving every Linux-side event short of an explicit `AT+QGDCNT=0` / `AT+QGDNRCNT=0` reset.

| Command | Counts | Reset method | Format |
|---|---|---|---|
| `AT+QGDCNT?` | LTE PS bearer bytes (per spec) | `AT+QGDCNT=0` | `+QGDCNT: <field1>,<field2>` |
| `AT+QGDNRCNT?` | NR (5G) bearer bytes (per spec) | `AT+QGDNRCNT=0` | `+QGDNRCNT: <field1>,<field2>` |

**Per spec they should be independent and RAT-scoped.** Empirically, this is true on SDX55 but **not** on SDX65 firmware `_A0.303`, where both AT commands return identical values regardless of which RAT carried the bytes.

### Per-firmware field order

| Firmware | `QGDNRCNT` field order | Source of truth |
|---|---|---|
| `RM502QAEAAR13A04M4G_01.200` (SDX55) | `<RX>,<TX>` | Observed: 18:1 ratio with field1=large value (downloads dominate) |
| `RM520NGLAAR03A03M4G_A0.303` (SDX65) | `<TX>,<RX>` | Observed: field1 grew by 6.16 MB during 5 MiB upload, field2 grew by 54.7 MB during 50 MiB download |

Quectel public documentation generally claims `<TX>,<RX>`. **SDX65 matches the docs; SDX55 does not.** Any AT-counter code must either:
- Carry a per-firmware lookup table, or
- Auto-detect orientation at runtime via known-direction probe traffic (more code, network cost)

### QGDCNT/QGDNRCNT independence

| Firmware | `QGDCNT` and `QGDNRCNT` independent? | Implication |
|---|---|---|
| `RM502QAEAAR13A04M4G_01.200` (SDX55) | **Yes.** In SA n41 mode, `QGDCNT: 0,0` while `QGDNRCNT` carried 36.4 GB | Sum is correct: `total = QGDCNT + QGDNRCNT` |
| `RM520NGLAAR03A03M4G_A0.303` (SDX65) | **No.** Both return identical bytes regardless of mode (verified during pure LTE traffic; both showed `54951394` for the same payload). | **Sum would double-count.** Read either one. |

This is the most surprising finding of the investigation. It means there is no portable "always sum both AT counters" formula — every firmware revision needs a behavior fingerprint before its counters can be trusted in code.

---

## Mode-dependent AT counter activity (with per-firmware caveat)

On firmwares where `QGDCNT` and `QGDNRCNT` are independent (like SDX55), the two AT counters are **RAT-scoped, not mode-scoped**. They populate based on which radio access technology actually carried the bytes:

| Current mode | `QGDCNT` (LTE) | `QGDNRCNT` (NR) | Truth on independent-counter firmware (SDX55) |
|---|---|---|---|
| LTE-only (no 5G) | active | 0 | `QGDCNT` alone |
| NSA EN-DC (LTE anchor + NR add-on) | active (LTE leg) | active (NR leg) | `QGDCNT + QGDNRCNT` |
| SA 5G (NR only) | 0 | active | `QGDNRCNT` alone |

On mirrored-counter firmware (like SDX65 `_A0.303`), the table collapses: **either counter shows the total**, regardless of mode. Summing would double-count.

Evidence from the SDX55 probe (camped on T-Mobile n41 SA):
```text
+QNWINFO: "TDD NR5G","310260","NR5G BAND 41",520110   # SA confirmed
+QGDCNT:   0,0                                         # LTE leg untouched
+QGDNRCNT: 36418574616, 2002334752                     # all bytes here (field1=RX)
```

Evidence from the SDX65 probe (camped on FDD LTE B3 + B28 CA, no 5G):
```text
+QNWINFO:   "FDD LTE","51503","LTE BAND 3",1350
+QGDCNT:    771352,54951394                            # field1=TX, field2=RX
+QGDNRCNT:  771352,54951394                            # IDENTICAL to QGDCNT — mirror behavior
```

Note how the SDX65 device is in **pure LTE** mode and `QGDNRCNT` still mirrors `QGDCNT`. Per spec, `QGDNRCNT` should be `0,0` since no NR traffic exists — but on this firmware, the spec is not what's implemented.

---

## SoC × counter matrix (full)

| Property | SDX55 (RM502Q-AE) | SDX65 / SDX6X (RM520N-GL) |
|---|---|---|
| Linux kernel | 4.14.206 ARMv7l | 5.4.210-perf ARMv7l |
| Distro | `mdm 202305251148` | `QTI Linux reference nogplv3 distro LE.UM.6.3.6.r1-02600-SDX65.0` |
| Hostname convention | `sdxprairie` | `sdxlemur` |
| `/etc/quectel-project-version` Branch Name | `SDX55` | `SDX6X` |
| `rmnet_ipa0` orientation | **Normal** — field 2 = download, field 10 = upload | **Normal** — same |
| Sub-interfaces visible | `rmnet_data0..5` | `rmnet_data0..5, 15, 16` |
| `lsmod` IPA module | `aqc_ipa_offload` | _(no output — modules unavailable to query, but `/sys/kernel/debug/ipa` exists)_ |
| Live counter cadence | Per-second, no batch flush | Per-second, no batch flush |
| Captures all bulk traffic? | **Yes** — 50 MiB curl → 55.6 MB rx growth | **Yes** — 50 MiB curl → 54.9 MB rx growth |
| `QGDNRCNT` field order | `<RX>,<TX>` (contra docs) | `<TX>,<RX>` (per docs) |
| `QGDCNT` and `QGDNRCNT` independent? | Yes (different in SA mode) | **No — mirror each other** |
| Behavior in tested mode | SA n41 — `QGDCNT=0`, `QGDNRCNT` carries all | LTE-only CA (B3+B28) — both AT counters show same value |
| rmnet vs AT counter drift | rmnet much higher (rmnet=377MB vs AT 36GB across very different reset windows — not directly comparable) | rmnet_ipa0 ≈ AT counter + ~322 KB signaling overhead (closely tracked over 7-min uptime) |

---

## What this debunks

Several plausible-sounding hypotheses turned out to be false:

| Hypothesis | Verdict | Evidence |
|---|---|---|
| IPA hardware path bypasses `/proc/net/dev` on SDX55 | ❌ False | Controlled 50 MiB download grew rx_bytes by 55.6 MB on SDX55, 54.9 MB on SDX65 |
| Kernel rx/tx labels are reversed on SDX55 firmware | ❌ False | Same controlled test on both — rx grew during download, tx grew during upload, exactly as labeled |
| IPA batches updates and only flushes during sustained flows | ❌ False | 60-second per-second sampling on both devices showed continuous tiny deltas during idle keepalive |
| `QGDNRCNT` field order matches Quectel docs (`TX,RX`) on all firmware | ❌ False | SDX55 firmware reverses it; SDX65 matches docs. Per-firmware lookup is mandatory. |
| "Always sum `QGDCNT + QGDNRCNT`" is a portable formula | ❌ False | Works on SDX55 (independent counters). Double-counts on SDX65 (mirrored counters). |

---

## What's confirmed

1. **`rmnet_ipa0` is the correct aggregate WAN counter** on Quectel internal-Linux builds across both SoC generations. The `rmnet_dataN` children are per-PDN demuxed views that should not be used for whole-WAN totals.
2. **Kernel rx/tx labels match user-facing semantics on both probed firmwares.** Field 2 = download, field 10 = upload — universal so far.
3. **Per-second live updates work on both SoCs.** No batch-flush latency.
4. **Schema v3's kernel-only approach is mechanically sound** on the probed devices. The known weakness (counter zeroing on interface re-creation) is unchanged, but is not a per-SoC issue.
5. **The kernel counter and AT counter agree closely on SDX65** when measured over the same window (~322 KB drift over ~55 MB, attributable to signaling/control bytes that rmnet_ipa0 sees but the PS-data AT counter doesn't).

---

## Implications for QManager schema design

The current Schema v3 design (kernel-only, no AT counter) is appropriate for **both live throughput and cumulative**, with one known weakness:

- **Cumulative loss on interface re-creation** — every rmnet counter zeroing event silently loses the bytes that flowed since the last 2-second Tier 1 tick. The poller marks these via `modem_reset_count` but doesn't recover the in-flight bytes.

A hybrid design that addresses this weakness would need to handle the per-firmware AT counter quirks documented above. Sketch:

| Concern | Approach |
|---|---|
| Live rate | Keep reading rmnet (cheap, fast, portable) |
| Cumulative total | Per-firmware AT counter strategy: SDX55 sums independent counters with `<RX>,<TX>` orientation; SDX65 reads either counter with `<TX>,<RX>` orientation; unknown firmware falls back to rmnet |
| User-triggered reset | Issue both `AT+QGDCNT=0` and `AT+QGDNRCNT=0` to keep them synchronized; rebase rmnet to current value |
| Per-firmware lookup key | Match on `Project Rev` (e.g. `RM502QAEAAR13A04M4G_01.200`), not just Branch Name — different firmware revisions of the same SoC may behave differently |

**This is not a recommendation to change Schema v3 today** — it's the design space the investigation maps out. A real fix should follow the standard Change Workflow (Phase 2 plan, approval gate, etc.).

---

## Open questions

1. **Is the SDX65 "mirror" behavior consistent across all `RM520NGL...` firmware revisions, or specific to `_A0.303`?** Earlier revisions might have independent counters; later ones might too. We've only probed one firmware per SoC.
2. **What zeroing events does rmnet_ipa0 experience in practice on each platform?** Needs longer-running logging on a device with frequent radio events. Candidates: handover, attach/re-attach, PDN re-establish, `cfun` cycle, IPv6 RA refresh.
3. **The user's "broken" RM502Q-AE report doesn't match the patterns this investigation reveals.** Their device showed ~12 MB / 4 MB accumulated when they believed they'd moved 2 GB / 150 MB. Both probed devices show orientation is correct and IPA captures everything. Hypotheses for the user's device:
   - Different firmware revision with a real driver bug
   - Frequent PDN re-establishment causing repeated rebase losses
   - Misidentified device (not actually RM502Q-AE)
   - Different bug entirely; the "reversed" perception was pattern-matched to swap labels because the absolute numbers were wrong

   **A follow-up controlled-download test on the user's actual device is the only way to settle which.**
4. **How does SDX65 firmware `_A0.303` populate AT counters under actual NR/NSA traffic?** Our SDX65 probe was on LTE-only, so we couldn't verify whether the mirror behavior holds in NSA EN-DC or SA. Needs re-probing when the test device can be steered onto 5G.

---

## Probe methodology (reproducible)

A self-contained read-only probe lives at `scratch/rm520_probe.sh`. Key sections:

1. Identity & SoC (uname, project-version, IPA modules)
2. Interface inventory (all `rmnet*`, `wwan*`, `ecm*`)
3. Initial counter snapshot (sysfs + `/proc/net/dev`)
4. AT counter cross-check (`QGDCNT?`, `QGDNRCNT?`, `QNWINFO`, `QCAINFO`)
5. **Controlled orientation test** — 50 MiB Cloudflare download + 5 MiB upload; reveals true orientation
6. 60-second per-second live sampling — reveals flush cadence
7. Post-test AT counter snapshot — cross-validates against rmnet delta
8. IPA driver introspection (`/sys/module/ipa*`, `/sys/kernel/debug/ipa`)

Network cost: ~55 MB per run. Read-only — no AT writes, no service touches.

**Probe artifacts (gitignored):**
- `scratch/rm520_probe.sh` — the probe script
- `scratch/rm520_probe.log` — most recent RM520N-GL run output

Add new firmware revisions to this matrix by running the probe and updating both the SoC × counter table and the field-order / independence tables above.
