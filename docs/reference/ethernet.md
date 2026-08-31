# Ethernet Status & Link Speed

> **Applies to:** RM520N-GL (SDX65) · verified 2026-08
> **RG501Q-EU (SDX55):** unverified — see [`platform-matrix.md`](./platform-matrix.md)

> The `/local-network/ethernet` page: link state, negotiated speed/duplex, and an optional forced speed limit for the on-board 2.5 GbE port.

## Hardware

The RM520N-GL carries a **Realtek RTL8125B 2.5GbE** controller exposed as `eth0`, driven by the out-of-tree `r8125` module. This is a real PHY with real autonegotiation — link state and speed can change under the app at any time, so both are read live rather than cached.

## Where each value comes from

| Value | Source | Notes |
| ----- | ------ | ----- |
| Link up/down | **sysfs** (`/sys/class/net/eth0/…`) | Cheap, always readable, no external binary |
| Speed / duplex | **`ethtool`** | Only meaningful while the link is up; an unplugged port reports nothing usable |
| Controller present | **sysfs** (`[ -d /sys/class/net/eth0 ]`) | Added 2026-08-31 as `interface_present`. See below — a **missing** field means `true` |

The split is deliberate: sysfs answers "is there a cable" without paying for an `ethtool` fork, and `ethtool` is only consulted once sysfs says the link is up.

## Files

| Layer | Path |
| ----- | ---- |
| Page | `app/local-network/ethernet/` |
| Components | `components/local-network/ethernet/` — `shapes.ts`, `link-state-strip.tsx`, `speed-limit-card.tsx`, `ethernet-status.tsx`, `types.ts` |
| CGI | `scripts/www/cgi-bin/quecmanager/network/ethernet.sh` |
| Shared lib | `scripts/usr/lib/qmanager/ethtool_helper.sh` |
| Root helper | `scripts/usr/bin/qmanager_ethernet_apply` |
| Unit | `scripts/etc/systemd/system/qmanager-ethernet.service` |

## Page anatomy (frontend)

Re-authored on 2026-08-31 onto the finalized design language. The composition is the one `/cellular/settings` landed on the day before: **one band that reports the link, one card that governs it.**

`ethernet-status.tsx` is the data shell — the fetch, the 10 s poll, the speed-limit apply with its confirm-poll, and the page header with its Refresh pill. `link-state-strip.tsx` is Band A, `speed-limit-card.tsx` is Band B, and every geometry string, tone and control height they use comes from `shapes.ts`, the family's first shapes module. All copy lives in `common.json` under `ethernet.*`, keyed across all five locales. The route stays on **lucide** per the Icon-Boundary Rule.

`scripts/test/ethernet-design-language.sh` pins the whole contract and was committed red before the fix.

### What the old page was, and why this is a re-author

It rendered the CGI payload: one tile each for link, speed, duplex and negotiation. That is the shape of `ethernet.sh`'s JSON, not the shape of the question. Speed and duplex are properties of **one** negotiated link, and the code already knew it — it printed "N/A" into both when the link was down. The tile labelled *Negotiation* reported `speed_limit`, the **saved setting**, while the PHY's real `auto_negotiation` was fetched, typed, stored and rendered nowhere.

### Band A — the link strip

Four tiles at the canon **104 px pin** (`TILE.ROOT`), mirrored by the skeleton through `TILE.HEIGHT`. The band header carries the label and, **only when the last poll failed**, a `warning` Badge reading "Not responding". There is no healthy/"live" counterpart: every figure here is a poll read, so "live" is the band's resting state rather than news — the same request retired that chip on `/cellular/` and `/cellular/settings`. Staleness is the one moment the band can mislead, because the figures freeze while still looking current, so the warning half stays. It renders only when there IS a reading for it to be a property of.

| Tile | Disc | Value | Caption |
| ---- | ---- | ----- | ------- |
| Link state | `DISC_UP` / `DISC_DOWN` / `DISC_NEUTRAL` — the **only** disc that changes at runtime | Connected / Disconnected / Unknown | cable state |
| Negotiated rate | `DISC_NEUTRAL` | `2.5 Gbps`, `tabular-nums` | the PHY ceiling when `supports_2500`, else "Negotiated with the peer"; "Needs an active link" when down |
| Duplex | `DISC_NEUTRAL` | Full / Half / — | "Transmit and receive at once" |
| Negotiation | `DISC_NEUTRAL` | **live `auto_negotiation`** — Automatic / Forced / Unknown | the **saved** limit — "No speed limit set" / "Limited to 100 Mbps" |

**Every tile body is `TILE.BODY` (`bg-surface-container`), and the `Tile` component has no `tone` prop to make an exception.** Colour lives on the 52 px disc and nowhere else — The Data-Ink Rule at tile scale. The three link states never share a glyph: `success-container` and `warning-container` measure 1.03:1 apart and are identical under deuteranopia, so the glyph is the channel that actually carries the state.

The negotiation tile shows **both** facts on purpose. The value is what the PHY is doing; the caption is what it was told to do. On a healthy device they agree — and when they disagree, that is what a technician opened the page to see.

> ⚠️ **The rate tile is NEUTRAL, and this overturns a rule that used to be documented here.** The old table gave it `downlink-container` and justified it as "capacity, which is Downlink Rose's second meaning". `DESIGN.md` retired that second meaning on 2026-08-16 — a rate is not a direction, not a radio and not a signal quality, so no hue in the system is honest for it (The Neutral-Default Rule). The four `opacity-85` ink washes that existed only to soften the `on-*-container` inks went with the tints.

### The five states

| State | Band | Write control |
| ----- | ---- | ------------- |
| Loading | four skeletons in the same grid, mirroring `TILE.HEIGHT` **by import** | held, "hasn't answered yet" |
| Loaded | four tiles | live |
| Failed refresh (had data) | values **held**, "Not responding" chip | held, "stopped answering" |
| Failed read (never had data) | ONE spanning `NOTICE_SPAN` tile | held, "hasn't answered yet" |
| No controller (`interface_present: false`) | ONE spanning `NOTICE_SPAN` tile | held, "no ethernet port to configure" |

The band keeps the family box and goes neutral on the last two rather than shimmering — a skeleton is a promise that data is on its way. It **spans** rather than repeating: four identical "couldn't read" tiles would be one message said four times, and the bespoke centred error card this replaces (`EthernetErrorState`, deleted) was a second vocabulary for the same event.

> ⚠️ **A failed refresh used to be invisible.** The old shell gated its error state on `!hasDataRef.current` — "only surface errors when we have no data to show" — and after one successful load that condition can never be true again. A dead 10 s poll and a healthy one rendered identically, forever. The flag is now `pollFailed`, set on every failure and cleared on every success.

The background poll **stands down while a write is in flight** (`savingRef`). Applying deliberately drops the link for ~8 s, so without the guard the poll would fail inside a window the app itself caused and raise "Not responding" over a working device.

### Band B — the write card

A peer card (`rounded-card` + `shadow-[var(--shadow-whisper)]`; the anchor on this surface is the strip), plain `CardTitle` + `CardDescription` with no icon, holding one `ROW_GROUP` with one `ROW`. The Select **applies on change** — the backend contract is POST → PHY bounce → confirm-poll, so there is no moment between "chosen" and "applied" for a Save button to occupy — and the trigger itself carries the confirmation: spinner *Applying…* → check *Saved*.

The row's **consequence sentence is required**, and it names the risk in plain language: *"Applying drops the link for about 8 seconds while the PHY renegotiates. You are on that link."* The app runs on the modem, so that is literally true (Product Principle 6 — make the dangerous obvious). It changes with the row's condition rather than staying constant; a control that cannot currently work explains why instead of sitting there dead. A provenance line under the card names `/etc/qmanager/ethernet_speed` in `font-mono`.

`speedLimit` is `""`, never `"auto"`, when nothing has been read — a defaulted value would render the most common setting as a confirmed selection on a page that has never reached the modem.

### Two collisions the primitives win unless you mark them

Both were found by **measuring the rendered node**, not by reading the class strings, and both look approximately right — which is why they survive review.

| Collision | Measured | Why the call site loses |
| --------- | -------- | ----------------------- |
| `FIELD` height | rendered **36 px** against a call site asking for 42 | `select.tsx:40` ships `data-[size=default]:h-9`, specificity (0,2,0) vs a bare `h-[2.625rem]`'s (0,1,0) |
| `CARD_SHELL` shadow | rendered Tailwind's `shadow-sm`, not the whisper | `cn()` cannot dedupe them — `tailwind-merge` reads an arbitrary shadow value as a shadow *colour*, so both survive, and the winner is Tailwind's name sort (`shadow-[` emits before `shadow-s`) |

Both are fixed with the important modifier at this one call site. The same mechanism covers the **dark** field fill: `select.tsx`'s own `dark:bg-input/30` is (0,2,0), so a light-only override loses outright, and once both are `dark:`-prefixed they *tie* and are decided by alphabet. `FIELD` writes `dark:bg-surface-container-high!`. Verified in the browser: the trigger paints exactly `--surface-container-high` in dark, one step above its `--surface-container` host (The Field-Step Rule — and note the host is the row group, not the card).

These are local corrections. `input.tsx` / `select.tsx` / `textarea.tsx` remain an **open product-wide Migration Delta**; migrating them retires every marker here.

## `interface_present`, and why `link_status` could not answer it

`ethernet.sh` returns `success: true` with `link_status: "down"` whether the cable is out **or** `eth0` does not exist, so the frontend could not tell "unplugged" from "no NIC" — and a missing `eth0` is a *designed* outcome (see the `ConditionPathExists` note below), not a fault. The GET therefore also reports:

```sh
if [ -d "/sys/class/net/$ETH_INTERFACE" ]; then interface_present=true; else interface_present=false; fi
```

emitted with **`--argjson`**, never `--arg`: a quoted `"false"` is a non-empty string and every non-empty string is truthy in JavaScript, so a stringly typed field would report every device as having a port.

**Backward-compatible in both directions.** An older frontend ignores the extra field; a current frontend meeting an older backend must read a *missing* field as `true` (`interface_present !== false`), or it would blank a working page on every un-updated device. This is the only backend change the 2026-08-31 re-authoring made.

Probed read-only on both reference devices before the field was written — `eth0` is present on each, so **neither can reach the `false` branch**:

| Device | Serial | Project rev | BusyBox | `/sys/class/net/eth0` |
| ------ | ------ | ----------- | ------- | --------------------- |
| RM520N-GL | `61368cd2` | `RM520NGLAAR03A03M4G_A0.304` | 1.31.1 | present, `operstate: up` |
| RG501Q-EU | `b7e3d6f1` | `RG501QEUAAR12A11M4G_04.202` | 1.29.3 | present, `operstate: up` |

`[ -d ... ]` is a shell builtin on both, so there is no applet-availability question.

## Applying a speed limit

Forcing a link speed requires privileges `www-data` does not have, so the CGI never calls `ethtool` to *write*. It goes through the **`qmanager_ethernet_apply` root helper** (bare-path sudoers line, all validation inside the helper) — the same pattern used by `qmanager_timezone_apply`, `qmanager_scenario_schedule_arm`, and the other privileged appliers.

## The `ConditionPathExists` placement (non-obvious)

`qmanager-ethernet.service` puts its `ConditionPathExists` in the **`[Unit]`** section, not `[Service]`.

**Why it matters:** a systemd condition that fails in `[Unit]` causes the unit to be *skipped* — it reports `inactive`. The same check expressed as a failing `ExecStartPre` would report `failed`. On a device with no Ethernet cable or no `eth0`, the second reading is alarming and wrong: nothing is broken, there is simply nothing to configure.

> ⚠️ Do not "fix" an `inactive` `qmanager-ethernet.service` on an idle device. That is the designed outcome.
