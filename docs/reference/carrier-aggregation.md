# Carrier Aggregation

> **Applies to:** RM520N-GL (SDX65) · verified 2026-08
> **RG501Q-EU (SDX55):** unverified — see [`platform-matrix.md`](./platform-matrix.md)

Carrier aggregation (CA) is the radio combining several frequency blocks, called *component carriers*, into one wider pipe. QManager reads the modem's aggregation state from a single AT command, `AT+QCAINFO`, turns each reported carrier into a JSON object in `/tmp/qmanager_status.json`, and renders the set as the dashboard's full-width **Carrier Aggregation strip**. This doc covers the three shapes `AT+QCAINFO` can emit, the two different bandwidth encodings hiding behind similar-looking field names, the NSA one-PCC rule and the "NR Anchor" role the frontend derives from it, and the pure view-model helpers in `lib/carrier-aggregation.ts`.

## Quick Reference

| Thing | Where |
| ----- | ----- |
| AT command | `AT+QCAINFO` (**Tier 1, every cycle**, enabled at boot in the poller's Group B) |
| Parser | `scripts/usr/lib/qmanager/parse_at.sh` > `parse_ca_info()` (field-order comment block at lines 475-501) |
| Bandwidth maps | `_lte_rb_to_mhz()` (`parse_at.sh:437`), `_nr_bw_to_mhz()` (`parse_at.sh:452`) |
| Poller call site | `scripts/usr/bin/qmanager_poller:2093-2106`, **Tier 1**, `qcmd_exec 'AT+QCAINFO'` |
| Status JSON | `/tmp/qmanager_status.json` > `network.carrier_components[]`, plus `network.ca_active`, `ca_count`, `nr_ca_active`, `nr_ca_count`, `total_bandwidth_mhz`, `bandwidth_details` |
| TypeScript types | `types/modem-status.ts` > `CarrierComponent`, `NetworkStatus` |
| View model | `lib/carrier-aggregation.ts` (pure, no React) |
| Widget | `components/dashboard/carrier-aggregation.tsx`, mounted `col-span-full` by `components/dashboard/home-component.tsx` |
| i18n | `ca.*` in `public/locales/{en,zh-CN,zh-TW,it,id}/dashboard.json` |
| CSS | `.ca-segment` / `.ca-meter` transitions in `app/globals.css` |
| Event hooks | `scripts/usr/lib/qmanager/events.sh` (`_ev_bands`, `_ev_band_summary`, `_ev_ca_diff`) |

> ℹ️ NOTE: There is no CGI endpoint for CA. Everything comes through the ordinary poller snapshot that the dashboard already reads, so the widget adds zero backend load.

> ⚠️ CORRECTION (verified against the live device). Earlier revisions of this doc, and the poller's own header comment, classified `AT+QCAINFO` as a **Tier 2 / every-15-cycles** read. **It is not, and never was.** The read sits at `qmanager_poller:2093-2106`, in the cycle body **above** the Tier 2 gate at `:2131`, and is unconditional: it runs on every cycle. Measured refresh on the live device is **3.7 to 4.0 seconds** across 103 consecutive polls. That figure is the *cycle* period, not `POLL_INTERVAL`: the poller sleeps **after** the body, so the real period is the body's duration plus the sleep, and any interval derived from `POLL_INTERVAL` alone is roughly 50% short. Both this doc and the poller comment have been corrected.

## The three `+QCAINFO` line shapes

Every line is stripped of its `+QCAINFO: ` prefix, its quotes, its spaces, and its carriage returns, then split on commas. Field counts differ per shape, which is why the parser branches on the band string in position 4 rather than on the field count alone.

### LTE (PCC or SCC)

```
+QCAINFO: "PCC",1350,75,"LTE BAND 3",1,295,-93,-8,-66,23
```

| Pos | Field | Notes |
| --- | ----- | ----- |
| 1 | type | `PCC` or `SCC` |
| 2 | EARFCN | stored as `earfcn` |
| 3 | bandwidth | **resource blocks**, not MHz, not an enum |
| 4 | band | `LTE BAND <n>` to `B<n>` |
| 5 | state | not stored |
| 6 | PCI | |
| 7 | RSRP | dBm |
| 8 | RSRQ | dB |
| 9 | RSSI | dBm |
| 10 | RSSNR | stored as `sinr` |

### NR short form (PCC, or an older SCC)

```
+QCAINFO: "PCC",620000,12,"NR5G BAND 78",334,-72,-11,180
```

| Pos | Field | Notes |
| --- | ----- | ----- |
| 1 | type | |
| 2 | NR-ARFCN | stored as `earfcn` (see the naming gotcha below) |
| 3 | bandwidth | **enum**, not resource blocks |
| 4 | band | `NR5G BAND <n>` or `NRDC BAND <n>` to `N<n>` |
| 5 | PCI | |
| 6-8 | RSRP, RSRQ, SNR | optional; 5 to 8 fields total |

### NR long form (SCC carrying uplink config)

```
+QCAINFO: "SCC",528030,8,"NR5G BAND 41",1,262,0,0,528030,-79,-11,2244
```

Positions 1-4 are the same. Then: 5 state, 6 PCI, 7 UL config, 8 UL bandwidth, 9 UL ARFCN, 10 RSRP, 11 RSRQ, 12 SNR. 9 to 12 fields total. The parser picks this branch when the line has 9 or more fields.

> ⚠️ WARNING: NR SNR is reported at 100x scale. The parser divides by 100 (`awk '{printf "%.1f", $1/100}'`) and maps the sentinel `-32768` to `null`. LTE `RSSNR` is already in dB and is stored as-is.

Any line whose band string is neither `LTEBAND*` nor `NR5GBAND*`/`NRDCBAND*` is skipped outright. Non-numeric, empty, or `-` values in the numeric positions become `null` rather than `0`, so "the modem did not report this" never renders as a real reading.

## The two bandwidth encodings (the field-name trap)

This is the single easiest thing to get wrong in this subsystem, because the modem uses three different encodings for "bandwidth" and two of them land in fields with nearly identical names.

| Value | Source | Encoding | In MHz? |
| ----- | ------ | -------- | ------- |
| `network.carrier_components[].bandwidth_mhz` | `AT+QCAINFO` field 3 | LTE = resource blocks, NR = enum; **both decoded by the parser** | **Yes** |
| `lte.bandwidth` | `AT+QENG="servingcell"` DL bandwidth | raw QENG **enum**, passed through undecoded | **No** |
| `network.total_bandwidth_mhz` | sum of `bandwidth_mhz` over all carriers | integer MHz | **Yes** |

> ⚠️ WARNING: `types/modem-status.ts` documents `LteStatus.bandwidth` as "Downlink bandwidth in MHz". That comment is wrong: the poller stores QENG field 10 (or field 12 on the NSA line) verbatim and nothing decodes it. Only `carrier_components[].bandwidth_mhz` and `total_bandwidth_mhz` are real MHz. If you need the serving cell's width in MHz, take it from the PCC entry in `carrier_components`, not from `lte.bandwidth`.

### LTE: resource blocks to MHz

`AT+QCAINFO` reports LTE bandwidth as a resource-block count, per 3GPP 36.101 Table 5.6-1. `_lte_rb_to_mhz()` maps it:

| RB | MHz |
| -- | --- |
| 6 | 1 (really 1.4, rounded down for the shell's integer math) |
| 15 | 3 |
| 25 | 5 |
| 50 | 10 |
| 75 | 15 |
| 100 | 20 |
| anything else | 0 |

### NR: enum to MHz

Same enum `AT+QENG` uses for NR DL bandwidth, per 3GPP 38.101. `_nr_bw_to_mhz()`:

| Enum | MHz | Enum | MHz |
| ---- | --- | ---- | --- |
| 0 | 5 | 9 | 70 |
| 1 | 10 | 10 | 80 |
| 2 | 15 | 11 | 90 |
| 3 | 20 | 12 | 100 |
| 4 | 25 | 13 | 200 |
| 5 | 30 | 14 | 400 |
| 6 | 40 | 15 | 35 |
| 7 | 50 | 16 | 45 |
| 8 | 60 | other | 0 |

Two values decode to something the UI has to survive: the 1.4 MHz LTE case rounds to `1`, and an unrecognised enum decodes to `0`. Both are handled by the segment-width floor described below. A carrier that decodes to `0` MHz is still emitted as a `carrier_components` entry (it exists, we just could not measure it); it only stops contributing to `total_bandwidth_mhz` and `bandwidth_details`.

## `earfcn` carries the NR-ARFCN too

`CarrierComponent.earfcn` holds `+QCAINFO` field 2 regardless of technology. For LTE that is an E-UTRA ARFCN; for NR it is an NR-ARFCN, which is a different numbering scheme entirely (528030 is an n41 NR-ARFCN, not an EARFCN). The field was named before NR components were parsed and renaming it now would break `status.json` consumers, so the UI compensates at the label: `carrier-aggregation.tsx` prints `ARFCN` for NR tiles and `EARFCN` for LTE tiles off the same field.

## CA counts and the NSA one-PCC rule

In EN-DC (NSA 5G, where an LTE anchor cell carries the control plane and NR adds capacity) the **LTE cell holds the PCC and the NR leg reports as an ordinary SCC**. The radio only ever reports one `PCC` line.

`parse_ca_info()` accounts for this when counting:

- `ca_count` = number of SCC lines whose band string contains `LTE BAND`. `ca_active` is true when that is greater than zero.
- `nr_ca_count` = number of SCC lines containing `NR`, **minus one** when `network_type` is `5G-NSA`, because the first NR SCC is the NR leg itself and not aggregation. `nr_ca_active` is therefore false on a plain NSA connection with a single NR carrier, and only true from the second NR carrier onward. Outside NSA (SA, where NR holds the PCC), every NR SCC counts.

Both counts are **secondary-carrier counts**, not totals. The total number of carriers on a leg is the count plus one, which is why `events.sh` writes `$((t2_ca_count + 1)) carriers` in its alert copy.

### Live verification (2026-07-28, Smart PH, PLMN 515-03, NSA)

Three samples 3 seconds apart, stable ordering:

```
+QCAINFO: "PCC",1350,75,"LTE BAND 3",1,295,-93,-8,-66,23
+QCAINFO: "SCC",150,100,"LTE BAND 1",1,295,-88,-9,-69,0,0,-,-
+QCAINFO: "SCC",528030,8,"NR5G BAND 41",262,-79,-11,2244
```

Exactly one PCC, held by LTE. Derived values: `total_bandwidth_mhz: 95` (15 + 20 + 60), `ca_count: 1`, `nr_ca_active: false`. NR bandwidth enum `8` decoded to 60 MHz through `_nr_bw_to_mhz`, its first live exercise. Note that both LTE carriers report **PCI 295**: normal intra-site aggregation, and the reason list keys are built from `earfcn` rather than `pci` (see `carrierKey`).

**Still unverified against live hardware:** the `nr_scc_count > 1` "true NR CA" branch, and SA mode where NR itself would hold the PCC. Both are implemented; neither has been observed. Treat behavior on those paths as designed-but-untested.

## Empty array on any failed AT read

The poller wraps the CA read in a plain success check:

```sh
ca_result=$(qcmd_exec 'AT+QCAINFO')
if [ $? -eq 0 ] && [ -n "$ca_result" ]; then
    parse_ca_info "$ca_result"
else
    t2_ca_active=false; t2_ca_count=0
    t2_nr_ca_active=false; t2_nr_ca_count=0
    t2_total_bandwidth_mhz=0; t2_bandwidth_details=""
    t2_carrier_components="[]"
fi
```

`parse_ca_info()` does the same thing internally when the response contains no `+QCAINFO:` lines at all.

The consequence matters for anything downstream: **a single failed or timed-out AT read wipes `carrier_components` to `[]` wholesale**, and the next successful poll repopulates it. On the poller's real 3.7 to 4.0 second cadence, a consumer that treats "absent from the snapshot" as "the carrier was released" will flicker its entire display grey and back. This is the whole reason the frontend has a grace period (below), and it is worth remembering before adding any other consumer of this field.

## Frontend view model (`lib/carrier-aggregation.ts`)

Pure functions, no React, no fetching. The widget is the only caller today; keeping the logic here means the rules are testable and the component stays a renderer.

| Export | Does |
| ------ | ---- |
| `CarrierRole` | `"pcc" \| "nr-anchor" \| "scc"` |
| `ResolvedCarrier` | `CarrierComponent` plus `key`, `role`, `released`, `lastSeenMs` |
| `carrierKey(c)` | `"<technology>-<band>-<earfcn>"`. Uses `earfcn`, not `pci`, because a PCC and an SCC on the same site legitimately share a PCI and a PCI-keyed list would collapse two real carriers into one row |
| `assignRoles(carriers, networkType)` | Derives the role array |
| `isLeadRole(role)` | True for `pcc` and `nr-anchor`, the roles that take the strong tone rather than the container tone |
| `computeSegmentShares(bandwidths)` | Segment widths as percentages summing to 100 |
| `rsrpToPercent(rsrp)` | RSRP to a 0-100 meter fill, clamped to -125..-65 dBm, floored at 2% |
| `reconcileCarriers(previous, snapshot, networkType, nowMs)` | Folds a fresh snapshot into the previously rendered set |
| `releasedForMs(c, nowMs)` | Milliseconds since last seen, for the release copy |
| `summarise(carriers, networkType)` | `{ activeCount, totalMhz, lteCa, nrCa, endc }` |

### The NR Anchor role

`assignRoles` derives a third role that the device never reports. When `networkType === "5G-NSA"`, the first component with `technology === "NR"` that is not already a PCC becomes `"nr-anchor"`. Everything else follows the device: `type === "PCC"` maps to `pcc`, everything else to `scc`.

The reason is descriptive honesty. Rendering the NR leg as a plain secondary would tell a 5G user that the carrier doing most of the throughput work is supplementary. The derivation is **frontend-only and additive**: `status.json` stays a faithful transcript of what `AT+QCAINFO` said, and no second `"PCC"` is ever synthesized anywhere in the stack. `assignRoles` also tolerates zero PCCs or multiple PCCs rather than asserting the invariant, since the SA path has not been observed live.

`summarise` mirrors the poller's rule rather than inventing a second one: `nrCa` is true only when more than one NR carrier is active, so the anchor alone never counts as NR aggregation. `endc` is true when the network type is `5G-NSA` and both legs have at least one active carrier.

### Segment width floor

`MIN_SEGMENT_SHARE = 0.07`. Every segment is lifted to that share **first**, then the whole set is renormalised to sum to 100. Two degenerate inputs make this necessary rather than cosmetic:

- 1.4 MHz LTE rounds to `1` MHz in the parser. Against a 100 MHz n78 that is a roughly 2px sliver.
- An unrecognised bandwidth enum decodes to `0`, which would render as a zero-width segment that vanishes from the chain while still appearing in the tile row below, so the two halves of the widget would disagree about how many carriers exist.

Two escape hatches: when `n * MIN_SEGMENT_SHARE >= 1` (roughly 15 or more carriers, where the floor cannot be honoured for everyone) and when the bandwidth total is zero or negative, the function falls back to equal widths. Equal widths are at least not a lie about which carrier is wider.

### Client-side release retention

The backend keeps no release history. A dropped SCC simply stops appearing, and as noted above a failed AT read empties the array entirely. `reconcileCarriers` therefore holds last-seen carriers in the component's own ref:

| Constant | Value | Why |
| -------- | ----- | --- |
| `RELEASE_GRACE_MS` | 6000 | A carrier missing for less than this is still drawn normally. Debounces the empty-array blip. **At the real 3.7 s cadence this survives ONE consecutive failed read, not two** (an earlier revision claimed two, from the incorrect 2 s figure). Raising it to survive two would mean roughly 8000 ms; that has not been changed, because the frozen-list behaviour on the `/cellular/` page covers the sustained case and a longer grace delays every genuine release |
| `RELEASE_RETAIN_MS` | 120000 | After this the carrier is dropped from the list entirely. Long enough to explain a drop, short enough that the chain reflects the present |

This is the client's own observation, not a fabricated timestamp, and it resets on page reload. No release history is persisted anywhere.

## The dashboard widget

`components/dashboard/carrier-aggregation.tsx`, mounted `col-span-full` on the dashboard. It **replaces** the old `components/dashboard/scc-status.tsx` Secondary Carriers card, which is deleted; the SCC card rendered a strict subset of these tiles. DESIGN.md names this a signature component under "Carrier Aggregation strip".

Anatomy, top to bottom:

1. **Header** with title, an aggregation status chip (`ca.status.*`: `both` / `nr_ca` / `lte_ca` / `endc_lte_ca` / `endc` / `none`), and the aggregate figure. The figure's label switches between `ca.aggregated` and `ca.bandwidth` because a lone carrier has a bandwidth, not an aggregate.
2. **Proportional chain**: one segment per carrier, width from `computeSegmentShares`, tone by radio family (`primary` for NR, `lte` for LTE) with fill strength carrying primacy. Released carriers drop to `surface-container-high` and keep their place, so a drop reads as a gap rather than a redraw.
3. **Tile row**: band, role chip, PCI, ARFCN/EARFCN, and an RSRP quality meter per carrier, or the release copy in place of the meter.

Behavioral notes worth keeping:

- **Role is always text, never colour alone.** The role chip carries the words so the information survives glare, greyscale, and the tile row scrolling out of view.
- **Quality chips use the functional four**, not the radio family's hue. A chip whose fill encoded RAT while its label said "Excellent" would contradict itself. The band pill keeps the identity hue.
- **Narrow containers drop the chain to a bare proportion bar** (`@md/ca`), because at phone width a 10% segment is narrower than its own horizontal padding and the labels would clip to nothing. The stacked tiles below carry every label the segments give up. Tiles go `grid-cols-1` to `@md/ca:2` to `@3xl/ca:4`.

### Motion

Both rules live in `app/globals.css`.

- `.ca-segment` animates real `width` on `emphasized`. This is the **single sanctioned width animation in the product**, permitted because on this surface the width *is* the data and a `scaleX` would distort the band and bandwidth labels riding inside each segment.
- `.ca-meter` animates `transform` on `standard` / 300ms. Never width, or every meter on the dashboard would trigger layout on each poll, on a CPU that is also carrying the user's traffic.
- Both have explicit `prefers-reduced-motion: reduce` entries. The repo kills motion per-class and has no global catch-all, so a new animated class without its own reduced-motion entry is a real accessibility gap.

### i18n

The `scc.*` namespace in `public/locales/*/dashboard.json` is **replaced** by `ca.*` across all five locales. `ca.released_minutes` uses native `_one` / `_other` plurals. `bun run i18n:check` passes at 823/823 in every locale.

## Related

- The `/cellular/` Radio Information page, the second consumer of this view model: [radio-information.md](radio-information.md). It reuses `carrierKey`, `reconcileCarriers` and `releasedForMs`, and adds the stale freeze that the dashboard strip does not have. It stopped reusing `rsrpToPercent` on 2026-08-23 and now lengths its RSRP bar on the shared `signalToProgress()` window like its RSRQ and SINR siblings, which leaves the dashboard strip as `rsrpToPercent`'s only caller
- Backend AT plumbing and `qcmd` serialization: [at-command-transport.md](at-command-transport.md)
- Band locking reads active bands from the same `carrier_components` array (`types/band-locking.ts`): see [sim-profiles.md](sim-profiles.md) for how scenario-bound band locks interact
- CA change alerts (`LTE CA activated`, band add/remove diffs): `scripts/usr/lib/qmanager/events.sh`, routed per [alerts.md](alerts.md)
- Design canon for the strip: `DESIGN.md` > Carrier Aggregation strip (signature component)
