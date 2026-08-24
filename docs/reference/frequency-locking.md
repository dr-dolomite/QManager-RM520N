# Frequency Locking (`/cellular/cell-locking/frequency-locking`)

> **Applies to:** RM520N-GL (SDX65) · verified 2026-08
> **RG501Q-EU (SDX55):** unverified — see [`platform-matrix.md`](./platform-matrix.md)

**Frequency Locking is an allow list of radio channels.** It tells the modem "you may only use these channels" — an EARFCN or two on LTE, up to 32 (ARFCN, SCS) pairs on 5G NR — and then leaves every other decision to the network. It does **not** pin a cell: unlike [Tower Locking](tower-locking.md), which names an exact (EARFCN, PCI) pair, a frequency lock takes no PCI at all, so the modem keeps reselecting freely *inside* the channels you allowed. It sits between its two siblings in sharpness: [Band Locking](band-locking.md) narrows the radio to whole bands, this narrows it to individual channels, tower locking names one physical cell.

> ℹ️ NOTE — jargon, once: **EARFCN** (E-UTRA Absolute Radio Frequency Channel Number) is LTE's channel index; **ARFCN** (sometimes NR-ARFCN) is 5G's. **SCS** is subcarrier spacing, the 5G channel's carrier grid in kHz — 15, 30, 60, 120 or 240. **PCI** is Physical Cell ID, a tower's identity on a channel. **CGI** (Common Gateway Interface) is how lighttpd runs QManager's shell scripts as HTTP endpoints. A **mutex** is a lock that lets only one process talk to the modem at a time.

Three properties make this the most dangerous surface under `/cellular/cell-locking/`, and everything below follows from them:

1. **There is no failover watcher.** Band locking self-heals in ~30 seconds and tower locking in ~80; frequency locking never does. Verified live: no systemd unit, no running process, no config file. If the channels you allowed have no coverage, the modem stays without service until a human clears the lock.
2. **Locking LTE to a band the modem does not support may crash-dump it** (`scripts/www/cgi-bin/quecmanager/frequency/lock.sh:10`), and per (1) nothing recovers it.
3. **There is no persistence mechanism, and whether a lock survives a reboot is unverified.** See [No persistence, and no timestamp](#no-persistence-and-no-timestamp).

The 2026-08 rebuild is **frontend-only**. Both CGI scripts, the poller, every systemd unit and the installer are untouched; `types/frequency-locking.ts` is unchanged. What changed is the page shape (an allow list built on the Material canon), the number of input paths (the carriers on air are now a picker), the control that writes (a button, never a `Switch`), the copy (**0 i18n keys → 134 per locale**, in all five), and a hook header comment that had been asserting a persistence mechanism this modem does not have.

## Quick Reference

| Thing | Where |
| ----- | ----- |
| Route | `/cellular/cell-locking/frequency-locking` (`app/cellular/cell-locking/frequency-locking/page.tsx`) |
| Page coordinator (owns both drafts) | `components/cellular/frequency-locking/frequency-locking.tsx` |
| Geometry + tone contract | `components/cellular/frequency-locking/shapes.ts` |
| Live strip ("Right now") | `components/cellular/frequency-locking/freq-lock-hero.tsx` |
| LTE leg card | `components/cellular/frequency-locking/lte-freq-card.tsx` |
| 5G NR leg card | `components/cellular/frequency-locking/nr-freq-card.tsx` |
| Apply bar (read-back + Clear all) | `components/cellular/frequency-locking/apply-bar.tsx` |
| Band-match line under a channel | `components/cellular/frequency-locking/band-match-display.tsx` |
| Data + actions hook | `hooks/use-frequency-locking.ts` |
| Types (**unchanged** by this work) | `types/frequency-locking.ts` |
| Channel → frequency maths | `lib/earfcn.ts` (`getDLFrequency`, `formatFrequency`, `findAllMatchingLTEBands`, `findAllMatchingNRBands`, `suggestNRSCS`) |
| Read lock state | `GET /cgi-bin/quecmanager/frequency/status.sh` (**3** AT round-trips) |
| Apply / clear a lock | `POST …/frequency/lock.sh` (**1** AT write) |
| Live carriers (the ACTUAL view) | `hooks/use-modem-status.ts` → `network.carrier_components[]` |
| Shared `/cellular/` page header | `components/cellular/page-header.tsx` |
| SCS option list (cross-route import) | `SCS_OPTIONS` in `types/tower-locking.ts` |
| Config file | **None.** State lives only in the modem |
| Failover watcher | **None.** See [There is no failover watcher](#there-is-no-failover-watcher) |
| i18n | `frequency_locking.*` in `public/locales/{en,zh-CN,zh-TW,it,id}/cellular.json` (**134 keys per locale**, identical key paths across all five) |

### AT commands this surface issues

Every one is a `AT+QNWCFG` parameter. **The key is `lte_earfcn_lock` / `nr5g_earfcn_lock`** — `lte_freq_lock` does not exist on this modem and returns `ERROR`.

| Operation | Command | Sent by |
| --------- | ------- | ------- |
| Read both lock states | `AT+QNWCFG="lte_earfcn_lock";+QNWCFG="nr5g_earfcn_lock"` | `status.sh:31` (one compound round-trip) |
| Lock LTE (1–2 channels) | `AT+QNWCFG="lte_earfcn_lock",<n>,<earfcn1>[:<earfcn2>]` | `lock.sh:101` |
| Clear LTE | `AT+QNWCFG="lte_earfcn_lock",0` | `lock.sh:123` |
| Lock NR (1–32 entries) | `AT+QNWCFG="nr5g_earfcn_lock",<n>,<arfcn1>:<scs1>[:<arfcn2>:<scs2>…]` | `lock.sh:205` |
| Clear NR | `AT+QNWCFG="nr5g_earfcn_lock",0` | `lock.sh:227` |
| Tower-lock gate read (both legs) | `AT+QNWLOCK="common/4g"` / `="common/5g"` via `tower_read_lte_lock` / `tower_read_nr_lock` | `status.sh` (tri-state, publishes `null` on a failed read); `lock.sh` (fails closed with `tower_state_unknown`) |

Three things about that syntax are load-bearing and have each cost a recon round:

- **Values are COLON-separated, not comma-separated.** `lock.sh:93` builds `1300:3400` for LTE and `lock.sh:197` builds `504990:30:506000:30` for NR — the NR list is a flat alternating `arfcn:scs` sequence, not a list of pairs.
- **The count field must equal the entry count.** It is the `<n>` before the list, and `status.sh` reads it back as the truth about whether the leg is locked at all (`count > 0` → locked).
- **`AT+QNWCFG` has no save/persist key.** A live enumeration of all 90 `AT+QNWCFG` keys contains none. `save_ctrl` belongs to `AT+QNWLOCK` — the *tower* lock — and `frequency/lock.sh` never calls it.

## Component tree

```
FrequencyLockingComponent                 ← owns both drafts and every hook
├── CellularPageHeader                     title + the "Experimental" chip
├── FreqLockHero            HERO           "Right now": verdict rail | carriers on air
│   ├── verdict panel       VERDICT        posture + consequence + fact chips
│   └── carrier rail        CAMPED         one CarrierTile per on-air carrier,
│                                            each with Add; + a dashed note tile
├── grid (1 col → 2 at @3xl/main)
│   ├── LteFreqCard         2 fixed slots, Apply LTE / Clear LTE / Clear fields
│   └── NrFreqCard          dynamic list ≤32, add row, Apply NR / Clear NR / Clear fields
└── FreqApplyBar            APPLY_BAR      reconnect disclaimer · MODEM READ-BACK ·
                                             no-recovery note · Clear all
```

The order is an argument read top to bottom: **what the radio is on right now**, then **the two lists you are allowed to keep**, then **one bar owning the cost of applying them**.

The coordinator is the only component that calls a hook. It reads `useFrequencyLocking` and `useModemStatus` and hands everything down as props.

### The shell owns the drafts

Both cards are controlled (`draft` / `onDraftChange`), and that is structural rather than stylistic: the live strip's carrier tiles each carry an **Add** button that pushes a channel into whichever list matches its radio, so the drafts have to live above both the strip and the cards. Two owners would need an effect-based back-channel; one owner needs nothing.

It also puts the seeding of a draft from the modem's read-back in **one** place instead of two mirrored effects — which is exactly where the incumbent had a bug. See [The stale-slot-2 bug](#the-stale-slot-2-bug).

Seeding runs **during render** (`frequency-locking.tsx:112`), React's documented "adjusting state when a prop changes" pattern, compared against a `seededFrom` sentinel. The effect version it replaces tripped `react-hooks/set-state-in-effect` — and that rule is compiler-backed and **bails per component**, so leaving it would have suppressed every later diagnostic in the file (see [radio-information.md](radio-information.md)).

### Why each card keeps its own Apply

The design comp put a single Apply in the footer bar whose label changed with whichever leg happened to be dirty. LTE and NR are **two independent AT writes**, gated independently, each costing its own reconnect — so one button that fires one *or* two of them depending on hidden state is precisely the ambiguity the read-back line exists to remove. Per-leg apply also matches Tower Locking next door, which is the page users arrive from.

The bar keeps what it is uniquely good at: the reconnect disclaimer, the standing no-failover risk, the modem's read-back, and **Clear all**.

## The two clocks

**Short version: two readings on this page sit inches apart and refresh at completely different rates, and pretending otherwise would be the surface's biggest lie.**

| Reading | Source | Freshness |
| ------- | ------ | --------- |
| **The lock state** — the verdict, both card chips, the apply bar's read-back | `status.sh`, i.e. `AT+QNWCFG` read back from the modem | Fetched **once on mount** and once after each write. Never polled |
| **Carriers on air** — the strip's right column, "Use current", the serving channel in the read-back | `network.carrier_components[]` from the poller snapshot | Live, ~4s (see [poller cadence](radio-information.md)). Free — a cached JSON file read that never touches the modem |

The lock state is not on an interval because **it costs three AT round-trips on the shared `/tmp/qmanager_at.lock` mutex the poller already contends for** (~0.62s measured end to end). Every poll of `status.sh` would be three more serialized round-trips competing with the status cycle that feeds the entire app. That is a backend cost decision, not a frontend preference.

So the strip's head carries an explicit `as of HH:MM` chip and a **Refresh** control rather than a "live" badge over the whole strip: only the right half is live.

> ⚠️ WARNING: do not add a poll interval to `status.sh`. If a future change genuinely needs live lock state, the right shape is a **poller-side** field — parsed once per status cycle by the daemon that already holds the mutex — never a second client on the same lock. This is the identical constraint [tower-locking.md](tower-locking.md) records for its own read-back.

`useFrequencyLocking` therefore exposes:

- **`lastSyncedAt`** — `Date.now()` of the last *successful* read, `null` before the first one. Stamped only on success, so a failed fetch leaves the old stamp alone and the age on screen keeps counting up from the reading that actually happened rather than resetting on every retry (`use-frequency-locking.ts:143`).
- **`isRefreshing`** — raised by `refresh()` **instead of** `isLoading`. The old code raised the initial-load flag, which collapsed a fully-rendered page back to skeletons on every manual refresh — the one moment the user is looking at a value and wants to watch it change.

`fetchStatus` auto-retries three times with 2s/4s/8s backoff before the error notice appears.

It also exposes **`errorCode`**, the backend's machine-readable `error` field from the last *structured* failure (an HTTP 200 body with `success !== true`), alongside the human `error` string. It is a **code, not a sentence**, following `use-tower-locking.ts`: rendered copy belongs in the components, where `useTranslation` is, so a message cannot ship as an English literal out of a hook that has no namespace. `frequency-locking.tsx` translates exactly one code today, `tower_state_unknown`. Note that `cgi_error` answers with HTTP 200, so `resp.ok` structurally cannot see any of this; `data.success` is the only honest signal on both the read and the write path.

## No persistence, and no timestamp

**Short version: nobody knows whether a frequency lock survives a reboot, and until somebody tests it on hardware no copy on this surface may claim that it does.**

The hook's header used to read *"LTE auto-saves, NR5G via `save_ctrl`"*. That is wrong on both halves and has been corrected in this change:

- A live enumeration of **all 90 `AT+QNWCFG` keys** contains no `save`, `persist` or `store` key of any kind.
- `save_ctrl` is an `AT+QNWLOCK` parameter — the tower lock — and `scripts/usr/lib/qmanager/tower_lock_mgr.sh` is its only caller anywhere in the tree.
- `frequency/lock.sh` issues **exactly one** AT write per action and nothing else.

Two consequences the UI is built around:

- **There is no config file**, so nothing on the device knows *when* a lock was applied. Any "stored on modem" chip or "held 3 h 06 min" readout would be inventing state this feature does not have. The design comp had both; neither shipped.
- **The verdict, the card chips and the apply bar all report the modem's read-back only.** There is no "intention" layer to disagree with, which is why this surface has no equivalent of Tower Locking's config-vs-modem `split` posture.

Recorded as an [open question](#known-gaps): reboot survival is untested.

## The tower-lock gate is one-directional — and it is QManager's, not the modem's

`frequency/lock.sh` sources `tower_lock_mgr.sh` and refuses to run while a tower lock is active, **before any `qcmd` runs**:

```sh
# lock.sh (LTE); the NR branch is identical against tower_read_nr_lock
lte_tower_state=$(tower_read_lte_lock 2>/dev/null)
tower_rc=$?                       # captured on the NEXT line - a `[` test clobbers $?

# One failed AT read is a transient hiccup, not proof of a lock we cannot see.
# Retry exactly once, at the same 0.1s spacing tower/status.sh uses between reads.
if [ "$tower_rc" -ne 0 ] || [ -z "$lte_tower_state" ] || [ "$lte_tower_state" = "error" ]; then
    sleep 0.1
    lte_tower_state=$(tower_read_lte_lock 2>/dev/null)
    tower_rc=$?
fi

# Normalise every failure signal to the one token the case below refuses on,
# so no failure can reach a catch-all and be read as "no tower lock".
if [ "$tower_rc" -ne 0 ] || [ -z "$lte_tower_state" ]; then
    lte_tower_state="error"
fi
case "$lte_tower_state" in
    error)
        cgi_error "tower_state_unknown" "Cannot confirm whether an LTE tower lock is active, so the frequency lock was not applied. Try again in a moment."
        exit 0 ;;
    locked*)
        cgi_error "tower_lock_active" "Cannot use frequency lock while LTE tower lock is active. Disable tower lock first."
        exit 0 ;;
esac
```

Three details in that block are each load-bearing:

- **`tower_rc=$?` sits on the line immediately after the assignment.** `$?` is clobbered by *any* intervening command, including a `[` test. Reordering those two lines re-opens the gate.
- **The retry is exactly one, not a loop.** It converts a lost AT mutex into a 100ms delay rather than a refusal the user has to understand, while still refusing on a modem that is genuinely not answering. `tower_state_unknown` is documented as retryable for the same reason.
- **The `rc`, `-z` and `error` tests are all three there, and none is redundant.** `tower_read_lte_lock`'s contract guarantees it prints `error` **and** returns 1 on any failed read, which makes the string and the rc equivalent for every path *inside* the reader. They are not equivalent for the case where the reader never ran at all — the library failed to source, or the fork failed. The variable is then **empty**, which matches neither `error` nor a non-zero rc from the reader, and would fall through as permission. Do not simplify them away on the strength of the equivalence.

### The gate failed OPEN until 2026-08-23, and that is why the `rc` capture is not optional

**Short version: an unreadable tower state used to pass the gate, and the write went out anyway.** `tower_read_lte_lock` and `tower_read_nr_lock` print the literal string `error` and return 1 when the read fails. `error` does not match the `locked*` arm, and the `case` had no default, so the script fell straight through and sent the frequency lock. That is precisely the stacked-lock path `lock.sh`'s own file header warns can **crash-dump the modem**: the one outcome the gate exists to prevent was the outcome an unlucky read produced.

It now **fails closed** on both legs, with a new machine code `tower_state_unknown`. Failure is `rc != 0`, empty output, or the `error` sentinel; any of the three refuses the write. Note that the sentinel check alone would not be enough, and neither would `rc` alone: `qcmd` reports failure by exit status and stderr and never writes `ERROR` to stdout ([at-command-transport.md](at-command-transport.md)), so all three tests are there because each catches a case the others do not.

`status.sh` reports `tower_lock_lte_active` / `tower_lock_nr_active` so the page can explain itself before the user tries. Those fields are **tri-state** and the frontend gate is fail-safe in the same direction; see [The tri-state tower-lock contract](#the-tri-state-tower-lock-contract).

Two facts about that gate must not drift:

- **QManager's CGI refuses; the modem never sees the command.** Do not write copy saying "the modem refuses". Quectel documents the mutual exclusion for **NR only** (`AT+QNWCFG="nr5g_earfcn_lock"` cannot be used together with `AT+QNWLOCK="common/5g"`); the LTE half of the gate is QManager generalising it, conservatively.
- **The reverse direction has NO guard.** `scripts/www/cgi-bin/quecmanager/tower/lock.sh` contains no frequency check at all, so **applying a tower lock silently wipes a live frequency lock.** The modem takes the `QNWLOCK` write; this page discovers the change only on its next read.

That asymmetry is why `LOCK_BADGE` carries a **`blocked`** posture, and it is the second of the two reasons the apply bar reports the modem's read-back rather than the command QManager sent — a read-back is the only thing on this page that can show a lock that vanished underneath the user.

> ℹ️ NOTE: closing the gap means a symmetrical guard in `tower/lock.sh` (read the frequency state, refuse or warn). That is a **backend** change and was explicitly scoped **out** of this frontend rebuild by choice, with the decision to warn in the UI instead. See [Known gaps](#known-gaps) and [tower-locking.md](tower-locking.md#frequency-locking-is-hard-gated-on-tower-lock--one-directionally).

**The gate disables writes, never the card.** A `towerLockActive` card renders a neutral (`info`-glyph, `surface-container`) notice, its inputs go read-only and Apply/Clear go dead — but the whole card is never dimmed with an opacity wash, and **"Use current" stays live**. Prefilling is exactly how a user captures the channel they already validated under the tower lock in order to migrate to the looser one; greying it would disable the single control that helps them.

### The tri-state tower-lock contract

**Short version: "no tower lock is active" and "we could not read whether one is" are different facts, they now stay different all the way from the AT read to the copy on screen, and the gate treats the second one exactly like the first.** Shipped 2026-08-23.

End to end, one field at a time:

| Layer | Shape | Rule |
| ----- | ----- | ---- |
| `status.sh` | `true` / `false` / JSON `null` | `null` when `tower_read_*_lock` returns non-zero, empty, or the `error` sentinel. The jq-failure `printf` fallback also emits `null` |
| `types/frequency-locking.ts` | `boolean \| null` | Both `tower_lock_lte_active` and `tower_lock_nr_active` |
| `use-frequency-locking.ts` | `boolean` | `modemState?.tower_lock_*_active ?? true`. **Unknown blocks.** A null `modemState` (the read never answered at all) blocks for the same reason |
| `use-frequency-locking.ts` | `towerLockStateKnown: boolean` | False when `modemState` is null or either leg is `null`. Keeps the *copy* honest, separately from the gate |
| `lock.sh` | `tower_state_unknown` | Refuses the write independently, on its own fresh read |

Three things about that table are load-bearing.

**`?? true`, not `?? false`.** The old default turned an unread state into "no tower lock", so `heroPosture` never reached `blocked` and Apply stayed live over a state nobody had read. Given what a stacked lock can do to the modem, the safe default is the restrictive one.

**The gate and the copy are separate questions.** Blocking on an unknown state is correct. Printing "a tower lock is active" when nothing was read would be the UI asserting a device fact it does not have, which is the State-Honesty Rule. So `towerLockStateKnown` is a separate derived value, and **only the two surfaces that explain the block read it**: the hero verdict (`freq-lock-hero.tsx`) and the apply bar (`apply-bar.tsx`). The per-leg cards keep a plain boolean gate deliberately, because a card that merely goes read-only does not need to say which of the two reasons applied. The unread branch also swaps the mark from `block` to `visibility_off` while keeping the `blocked` panel tone: the consequence is the same, the fact is not, and two states in one slot may never share a glyph.

**Both layers enforce it, and neither is redundant.** The CGI gate is the real one, because it is the only thing standing between a bad state and the modem, and it runs on its own read rather than trusting anything the client sends. The UI gate exists so the user is told **before** they try, rather than pressing Apply and being refused. Removing either one leaves a real hole: without the CGI gate a stale page can still send the write, and without the UI gate the page invites an action it knows will fail.

#### Why this surface is tri-state and Tower Locking is not

The two surfaces reached read honesty independently and landed on different shapes, and the difference is deliberate rather than an inconsistency to tidy away.

| | This surface | [Tower Locking](tower-locking.md#the-read_ok-contract-absent-means-true) |
| --- | --- | --- |
| Shape | `boolean \| null` on the field itself | `boolean` + a sibling `*_read_ok` flag |
| Question answered | "Is a tower lock active, as far as anyone knows?" | "Is *this particular read* trustworthy?" |
| Default on unknown | `?? true` — **blocks** | `=== false` — repaints the affected card `unknown` |

A `boolean` + sidecar pair only stays safe if **every** consumer honours the sidecar, which makes it fail **open** by default: the frequency surface's own `?? false` turned an unreadable state into "not active", and two of its four consumers (`apply-bar.tsx`, `freq-lock-hero.tsx`) gate on `*_active` and never read a sidecar at all. On the path whose file header warns about a stacked-lock crash dump, that is the wrong direction to fail. Folding the third value into the field itself puts the fail-safe in the one gate every consumer already reads.

Tower Locking keeps the sidecar shape because its question is genuinely per-read — three independent AT commands feeding three independent cards — and because its consumers are written against it. Its compatibility story is the same one that survives here for free: an un-upgraded CGI emits `false`, never `null`, so absent still means safe.

## There is no failover watcher

Verified live on hardware: **no systemd unit, no running process, no config file.** Nothing watches a frequency lock, and nothing restores service if the channels you allowed lose coverage.

| Surface | Watcher | Reacts after | Remedy |
| ------- | ------- | ------------ | ------ |
| Band Locking | `qmanager_band_failover` (bounded) | ~30s | Restores all supported bands |
| Tower Locking | `qmanager_tower_failover` (unbounded) | ~80s | Clears both tower locks |
| **Frequency Locking** | **none** | **never** | **none** |

This is stated **on screen**, in three places, each chosen for when it can actually be acted on:

1. A `muted` **"No automatic recovery"** chip on the verdict panel — rendered only while a lock is in force, because that is the only state where it can cost anything.
2. A standing note in the apply bar under the live read-back (`apply.no_recovery`).
3. The unsupported-band confirmation dialog, which is `destructive`-toned for this reason alone.

The verdict chip is `muted`, **not `warning`** — it only ever renders *on* the amber `locked` panel, and an amber chip on an amber container is the one place the `warning` role cannot separate itself from its own background (it washed out in light mode). The panel carries the amber; the chip carries the fact, told apart from its neighbour by glyph.

### The crash-dump risk and its two guards

`lock.sh:10` warns that an LTE `earfcn_lock` on an unsupported band **may cause a modem crash dump**. With no watcher, nothing brings it back. The surface guards it twice, before the write:

1. **`BandMatchDisplay`**, rendered directly under every channel the user typed or staged, names the bands that channel maps to and marks any the modem does not report as supported (`text-destructive-on-surface`, plus a translated "not supported" suffix).
2. **A `destructive` confirmation dialog** that lists the matched bands and the modem's supported list side by side, and whose confirm button reads "Lock anyway".

`anySupported` decides which dialog opens. Two guards against false alarms are built into it:

- **An empty supported list means *unknown*, not *unsupported*.** `device.supported_lte_bands` (and the SA/NSA NR pair) is a colon-separated string; when the modem has not reported it, the stern dialog is withheld rather than guessed — a false alarm on the one page where a false alarm is expensive would train the user to click through the real one.
- **A channel that matches no band at all also withholds it** (`matched.length === 0 → true`), for the same reason.

## Never render the AT command — render the read-back

The design comp printed `AT+QNWCFG="lte_freq_lock",1,1300,3350` in the apply bar, in a mono face, which reads as *"this is literally what the device was told"*. **Every token of it was wrong**: the key does not exist, the count must equal the entry count, and the values join with colons. It was wrong precisely *because* it was hand-written in JSX — a literal in markup cannot track `lock.sh`.

The substitution is not a downgrade. An echoed command states what QManager **tried**; a read-back states what the modem **did**, and on this page those can disagree in two ways a command string structurally cannot express:

- an entry the modem rejected, so the list on screen and the list in force are different;
- a tower lock applied from the sibling page, which replaces a frequency lock with no warning.

So the bar's second line is assembled from `status.sh`'s entry arrays and cross-referenced against the live carrier list:

```
LTE 9485, 1350 · serving 9485
```

`serving` comes from the poller's PCC carrier, not from the lock state, so it stays true even when the two have drifted apart. It is `font-mono tabular-nums` under DESIGN.md's Machine-Voice Rule — it is the machine's answer, in the machine's typeface.

> ⚠️ WARNING: do not "restore" the AT string as a power-user affordance. It has been wrong once already, in three tokens at once, and the failure mode is that it looks authoritative while being fiction.

### No number on the reconnect cost

The comp said "about five seconds". That figure is borrowed from `AT+QNWLOCK` — a different command family — and has never been measured for `AT+QNWCFG`. [band-locking.md](band-locking.md) records a copied-without-checking "15 seconds" that shipped wrong, with the lesson that **a number in user-facing copy is a claim about the device**. The copy says "briefly" until someone measures it.

> ℹ️ NOTE: the *hook* does carry a number — `sendLockRequest` waits a flat 5000 ms after a successful write before re-reading (`use-frequency-locking.ts:210`). That is an internal settle delay, not a measurement, and it is deliberately not surfaced as a claim. Because `handleClearAll` runs the two unlocks sequentially, "Clear all" on a doubly-locked modem takes ~10s plus two status reads.

## Channel frequency, not band centre

`channelFrequencyLabel()` in `shapes.ts` computes the **real per-channel downlink frequency** via `lib/earfcn.ts` (`getDLFrequency`, per TS 36.101 §5.7 for LTE and TS 38.104 §5.4.2.1 for NR). EARFCN 1300 is **1815.0 MHz**, not the "1800 MHz" marketing name of B3.

This is load-bearing rather than pedantic: the whole point of showing a frequency beside a channel number is that **a wrong digit becomes visible**, and a band-level figure *does not change* when a digit changes — 1300 and 1301 would both read "1800 MHz".

> ⚠️ WARNING: never reach for `lib/band-frequency.ts` on this surface. It answers a different question (where a *band* sits), and substituting it silently defeats the check.

The helper returns `null` when the channel is not on a known raster, so callers omit the clause rather than printing a placeholder that looks like data.

## "Use current" needs no backend

Both cards' **Use current** control is free: it reads the poller snapshot through `useModemStatus`, which is a cached file read at zero AT cost. Nothing is sent to the modem.

| Card | Source, in order | Behaviour |
| ---- | ---------------- | --------- |
| LTE | `network.carrier_components[]` filtered to `technology === "LTE"`, **PCC first**, deduped, capped at 2 → else `lte.earfcn` | Fills **both** slots. The incumbent copied `lte.earfcn` into slot 1 only, discarding the aggregated carrier the user is actually on |
| NR | `nr.arfcn` + `nr.scs`; if `nr.scs` is absent, `suggestNRSCS()` on the first matching band | Fills the **add row**, not the list — see below |

Two rules the control encodes:

- **The modem's own SCS outranks the inference.** `suggestNRSCS()` is a heuristic (FDD→15, TDD→30, FR2→60) and is simply wrong on any TDD band an operator runs at 15 kHz. When `nr.scs` is reported it is ground truth and wins, and `scsManual` is pinned so the next ARFCN keystroke cannot overwrite it with the guess.
- **A control that cannot act says so before it is pressed.** With no carrier to copy, the button is **disabled with the reason on it** ("No carrier on air"). The incumbent left it live and fired a toast *after* the click to say nothing had happened.

The NR path prefills the add row rather than committing straight into the list because **an NR entry is a pair**: when the modem reports no spacing and no band matches, committing would mean inventing the one value that fails silently. Prefilling puts the question in front of the user instead.

### Per-carrier SCS does not exist

`AT+QCAINFO` reports ten fields per carrier and **SCS is not among them**. The only spacing the device publishes is `nr.scs`, for the **serving** NR cell, singular.

So `carrierScs()` in `freq-lock-hero.tsx:99` shows a spacing on a carrier tile **only when that tile is the serving cell** (`carrier.earfcn === modemData.nr.arfcn`). An NR secondary carrier genuinely has no spacing available, and printing the serving cell's value there would be a fabrication rather than an approximation. When the strip's **Add** stages such a carrier, the coordinator falls back to 30 kHz — the most common SA/NSA spacing — rather than blocking the add, and the card's permanent spacing notice says why that matters.

**A wrong SCS is the quietest failure this page can produce.** The entry looks valid, the modem accepts the write, and then never camps. That is why `card.scs_warning` is permanent, and why it is a **block** rather than a chip: there is no failure to report after the fact, only this, before it. It sits directly under the spacing control it is about — it started at the top of the card, where it was the loudest object on an empty page and warned about a control the reader had not reached yet.

## Geometry and tone

Everything shape- or tone-bearing lives in `components/cellular/frequency-locking/shapes.ts`, mirroring the tower- and band-locking convention and for the same reason: the incumbent restated its card shell in two mirrored files that had drifted apart, declared its skeleton geometry in a different branch from its loaded geometry, and carried no status chip at all.

> ℹ️ NOTE: **restated, not imported.** Several strings here are byte-identical to `tower-locking/shapes.ts`. That is the house convention — a surface takes no dependency on a sibling route's module graph, so tower locking can be re-shaped without silently re-shaping this page.

| Constant | Purpose |
| -------- | ------- |
| `PAGE_SHELL` | Page root, declaring `@container/main`. Every query on this surface is a container query, never a viewport breakpoint |
| `CARD_GRID`, `CARD_CELL` | The 2-up lock-card grid. `CARD_CELL` forces equal height so a card whose data has not landed matches its row-mate; the `Card` itself stays height-free |
| `CARD_SHELL`, `CARD_PAD`, `CARD_FOOT` | Peer card at `rounded-card`, no border, no shadow. `CARD_FOOT` carries `mt-auto` so the LTE/NR length asymmetry collects behind the actions instead of as a gap mid-card |
| `HERO` | The anchor surface, `rounded-hero` per Radius-Follows-Size. `SPLIT` is a fixed `19rem` verdict rail beside a flexible carrier grid |
| `VERDICT`, `VERDICT_TONE` | The verdict panel and its four tones, keyed on `LockPosture` |
| `CAMPED`, `CARRIER_TILE`, `CARRIER_NOTE_TILE` | The carriers-on-air rail, its tiles, and the dashed explainer that fills the spare cell |
| `SLOT`, `SLOT_INPUT`, `PILL_USE_CURRENT` | The list rows (filled and dashed-empty at the same height so the list never jumps), the 42px input, the Use-current pill |
| `EMPTY` | The NR card's empty-list block |
| `NOTICE`, `NOTICE_TONE` | Card-scoped notices: `warning` / `neutral` / `info`, three glyphs, no shared marks |
| `APPLY_BAR` | The bar. `READBACK` is mono per the Machine-Voice Rule |
| `PILL_ACTION`, `PILL_ACTION_PLAIN`, `PILL_QUIET` | Action sizing, matched to tower locking's scale so the two pages feel like one |
| `LOCK_BADGE`, `EXPERIMENTAL_BADGE`, `BADGE_GLYPH_SIZE` | Tone + glyph maps, keyed onto the exported `BadgeVariant` type so an unmapped state fails the build |
| `lockPosture`, `channelFrequencyLabel`, `isChannelAllowed` | The three pure helpers the components read |
| `SKELETON_SHAPE` | Loaded geometry restated once so skeletons mirror by **import**, not by estimate |

### The tonal ramp has exactly four steps

`globals.css` defines `surface`, `surface-container` and `surface-container-high` and nothing else — there is **no** `-low`, **no** `-highest`, and the outline token is `outline`, not `outline-variant`. Tailwind silently drops a class naming a token that does not exist, so an invented step does not fail the build; it renders as a transparent panel that looks almost right in dark mode and wrong in light.

Nesting, outermost first, which is what this file's fills encode:

```
background              the page
surface                 a section card (the hero, the apply bar)
surface-container       a panel inside one (the verdict, the carrier rail)
surface-container-high  a tile inside a panel (a carrier, an input)
```

### `LOCK_BADGE`: locked is amber, unlocked is green

| Posture | Variant | Glyph | Renders when |
| ------- | ------- | ----- | ------------ |
| `locked` | `warning` | `lock` (filled) | The modem reports the leg locked |
| `unlocked` | `success` | `lock_open` | The modem reports it free |
| `blocked` | `muted` | `block` | A tower lock is active on that leg |
| `unknown` | `muted` | `schedule` | `modemState === null` — nobody has read the modem |

This reads the **functional contract**, not a value judgement: narrowing the radio to a short list of channels is the state that can cost you the connection, so `warning` means *constrained*, not *you did something wrong*. Band Locking and Tower Locking apply the same inversion, and matching them is the point — a user who learns "amber = the radio is constrained" on two sibling routes must not find a different colour on the third.

**`blocked` outranks `locked`** in `lockPosture()`. While a tower lock is active this page cannot write at all, so reporting "Locked" would offer an edit that `lock.sh` will refuse.

**`blocked` is `muted`, never `destructive`.** Nothing failed — the user set a tower lock on purpose — and painting it red would also encode the two locks as different severities when they are the same kind of thing.

**`unknown` is a real state, not a loading placeholder.** A null `modemState` means `status.sh` has not answered; rendering that as a confident "Unlocked" asserts something nobody read back.

**Every posture carries a distinct glyph**, and that is load-bearing rather than decorative: `success-container` and `warning-container` measure **1.03:1** apart, so they are the same surface under deuteranopia and very nearly the same surface to everyone else. The glyph is what separates locked from unlocked; `blocked` and `unknown` share `muted` and are told apart the same way.

### The "in list" marker is an inset primary ring, never amber

A carrier tile whose channel is already inside the allow list gets `CARRIER_TILE.MATCH` — `shadow-[inset_0_0_0_2px_var(--primary)]`.

The comp drew a 2px `--success` outline. Two rules forbid that: **Fill-Over-Stroke** bans a coloured stroke on a tonal container, and a functional role token is never a legal stroke colour in the first place. Band Locking's live-band ring and Tower Locking's `CARRIER_TILE.MATCH` both resolve it the same way — an inset primary ring reads as "this one is spoken for" without claiming a health role.

Amber stays on the **chip** and the **verdict**, which is where the user's mental model for "constrained" is being built.

The tile's action slot follows the same logic: `ACTION_FREE` (primary container, an `add` glyph) when the carrier can be staged, `ACTION_HELD` (warning container, a filled `lock`) when it is already in the list, and `ACTION_OFF` (inert, 60% opacity) while a tower lock blocks the page — because a disabled control must not wear the affordance of an enabled one.

### "Experimental" is a non-status label

`EXPERIMENTAL_BADGE` is `variant="secondary"` with a `science` glyph, sitting in the page title row.

It was amber in the comp, which put a permanently-lit `warning` chip at the top of a page whose whole state system is about to use amber for "locked". Amber would have meant three things at once here, and the topmost one never changes.

Quiet is also the honest register. "Experimental" is a permanent property of the feature, and a warning chip that is always on is a warning nobody reads after the first visit. The risk this page actually carries is communicated where it can be acted on — in the apply bar and in the confirmation dialogs, contextually and unavoidably.

### The verdict panel

`heroPosture()` in `freq-lock-hero.tsx:80` computes the **page-level** posture as the union of the two legs, with `blocked` outranking everything. `VERDICT_TONE` keys the panel fill, the disc fill and the glyph off it.

`blocked` is `surface-container-high`, **not** a destructive red, for the same reason `LOCK_BADGE.blocked` is `muted`.

Beneath the sentence sits a chip row (`VERDICT.FOOT`, pinned with `mt-auto` so panels of unequal copy still align):

| Chip | Renders when | Variant |
| ---- | ------------ | ------- |
| "Tower lock off, so this is available" | `posture === "unlocked"` | `muted` + `check` |
| "Serving channel is in / outside the list" | `servingInList !== null` | `muted` + `check` / `warning` + filled `warning` |
| "No automatic recovery" | `posture === "locked"` | `muted` + `block` |

`servingInList` is deliberately `null` unless something is actually locked **and** at least one on-air carrier belongs to a locked technology: with an empty list every channel is trivially allowed, so the chip would tell the user nothing.

### Skeletons mirror by import

Every loading measurement comes from `SKELETON_SHAPE`, so the placeholder mirrors the loaded geometry rather than estimating it. The incumbent guessed `h-9 w-full rounded-md` for inputs that render at 42px with a 20px radius. Sizes are the loaded element's **line box**, not its font size — a skeleton sized to the glyph reflows the moment real text lands.

## No enable switch, on either card

Both incumbent cards carried a per-leg `Switch`. It is gone, and it must not come back. It failed on the same three counts [tower-locking.md](tower-locking.md#one-way-to-lock) records for its own leg cards:

- **It was a state display and a write in the same control.** Its `checked` came from the modem read-back, so it reported; its `onCheckedChange` wrote. A control that both reports and acts has no resting truth.
- **Its ON action wrote whatever sat UNSAVED in the fields below it**, with no confirmation of *what* was about to be sent, from a control whose whole affordance says "this is instant".
- **A switch promises instant, cheap and reversible.** `AT+QNWCFG="lte_earfcn_lock"` bounces the link on the device serving this page and has **no failover watcher** behind it.

The footer button is now the only write path, and it is always behind an `AlertDialog`. There is no `Switch` anywhere on this surface.

Each footer reads: **Apply LTE/NR lock** (a `SaveButton` on `PILL_ACTION_PLAIN`), **Clear LTE/NR lock** (`variant="outline"` with a `lock_open` glyph), and **Clear fields** (`PILL_QUIET` + `variant="tonal-neutral"`, pushed to the far edge by `justify-between`). Two writes grouped together, then a form reset that touches nothing on the modem — the same construction Band Locking and Tower Locking already settled on.

### Both cards gate Apply on a real change

Re-sending an identical list is not free: it still runs the AT write and still bounces the link for a guaranteed no-op. So Apply is disabled when `posture === "locked" && !hasChanges`.

**The comparison is order-insensitive on both legs.** The slots are a **set** of acceptable channels, not a sequence, so slot 1 and slot 2 swapping places is not a change worth a link bounce. `channelKey()` sorts before joining on LTE; `entryKey()` sorts the `arfcn:scs` strings on NR.

**`hasChanges` compares against a `*_locked`-guarded list.** `lte_entries` / `nr_entries` can outlive a release, so `lockedChannels` / `lockedEntries` read them only while the modem *also* reports the leg locked. Tower Locking hit the inverse of this as a live bug, where a stale cell made the Lock button permanently dead.

**Clear is gated on the posture, never on the draft** (`posture !== "locked"` disables it). Offering to clear a lock the modem does not report is offering an action with no effect, and `unknown` means nobody has read the modem successfully.

### Input validation is deliberately strict

`parseChannel()` accepts `^\d+$` only. `Number.parseInt("12abc")` is `12`, which would silently lock the radio to a channel the user did not type; a rejected string raises `error.invalid_channel` inline instead, beside the field.

The LTE card dedupes staged channels — two identical EARFCNs are one channel and a wasted slot. The NR card refuses a duplicate `(arfcn, scs)` pair and **says so on the add row** rather than in a toast after the click.

### The two cards' list shapes differ, on purpose

| | LTE | NR |
| --- | --- | --- |
| Capacity | **2**, fixed (`lock.sh:71`) | **32**, dynamic (`lock.sh:165`) |
| Rendering | Two rows always present; slot 2 is dashed and captioned "Optional" while empty | A list plus a dashed **add row**, hidden once 32 is reached |
| Empty state | **None** | `EMPTY` block with a `playlist_add` glyph |

The LTE card has **no empty state deliberately**. An empty state explains a container with no items; this container always has exactly two rows, because `lte_earfcn_lock` takes at most two EARFCNs and both render unconditionally. An empty block above them was a third telling of what the placeholder and slot 2's "Optional" hint already say, and it pushed the actual controls down the card. The NR card *does* have one, because its list is genuinely variable-length and can hold nothing at all.

The NR draft holds **committed pairs only**. A half-typed ARFCN is not a pair, so it cannot live in the shell's draft; the add row keeps its own two strings and commits a whole entry at once. That removes the incumbent's worst failure mode, where a slot carrying an ARFCN with no SCS was silently dropped on write.

> ℹ️ NOTE: the incumbent hard-coded `NUM_SLOTS = 4` for NR and then told the user so in its own description — a 32-entry feature capped at four by a constant nobody meant as a limit.

## Bugs fixed in this rebuild

### The stale-slot-2 bug

The incumbent's LTE seeding effect only ever wrote slots it had data for. So a two-channel lock that was later narrowed to one left the **second channel still on screen** — and, because the form is what Apply reads, silently rejoined it to the next write. The form disagreed with the modem while looking authoritative.

The fix is structural rather than a patch: the shell rebuilds the LTE draft from a **fixed-length array** on every seed (`frequency-locking.tsx:115`), so a slot the modem no longer reports is cleared rather than left behind.

### `refresh()` collapsed the page to skeletons

`refresh()` used to raise `isLoading`, the page's first-paint gate, which discarded every number already on screen in response to a single button press. It now raises `isRefreshing`, which spins the control and leaves the loaded layout intact. `lastSyncedAt` was added at the same time so the surface can say how old the reading it is showing actually is.

### Every string is a key now

The page previously had **zero** i18n keys — every string was an English literal, so no locale could reach any of it. The `frequency_locking` namespace is now 134 keys in each of the five locales, with identical key paths.

Two conventions from [i18n.md](i18n.md) are applied throughout:

- **Status labels are written out per branch** (`status_locked` / `status_unlocked` / `status_blocked` / `status_unknown`) rather than interpolated as `` status_${posture} ``. The reason survives the gate getting stricter: `i18n:check` compares the **key sets** of the locale files, so it can only ever grade a key that is written down somewhere. An interpolated key exists in no file, so no gate — however strict — can report it missing.
- **No `defaultValue` anywhere.** A `defaultValue` means the key is never "missing", which is how an untranslated English literal hides in plain sight.

`BandMatchDisplay`'s `noMatchLabel` prop stays a plain string rather than a key, because the caller knows whether it is describing an EARFCN or an ARFCN — but it must arrive **already translated**, never as a key name for the component to interpolate.

`SCS_OPTIONS.label` is an English literal in the shared type module, so the NR card renders the unit from the locale (`slots.scs_unit`) and takes only the numeric value from the constant.

### Icons

Five Material Symbols glyphs were added to the subset for this surface: `my_location`, `playlist_add`, `science`, `block`, `signal_disconnected`. `/cellular/` is a Material Symbols route — see [icon-system.md](icon-system.md), and run `bun run icons:check` after any glyph change.

## Backend contract

The 2026-08-22 frontend rebuild touched neither script. Both were changed on **2026-08-23**, for the read-honesty reasons under [The gate failed OPEN](#the-gate-failed-open-until-2026-08-23-and-that-is-why-the-rc-capture-is-not-optional) and [The tri-state tower-lock contract](#the-tri-state-tower-lock-contract).

### `GET /frequency/status.sh`

Three AT round-trips (one compound `QNWCFG` read plus the two `QNWLOCK` gate reads, with a `sleep 0.1` between the gate reads — the "sip, don't gulp" convention for the shared mutex, see [at-command-transport.md](at-command-transport.md)).

```json
{
  "success": true,
  "modem_state": {
    "lte_locked": true,
    "lte_entries": [{ "earfcn": 9485 }, { "earfcn": 1350 }],
    "nr_locked": false,
    "nr_entries": [],
    "tower_lock_lte_active": false,
    "tower_lock_nr_active": null
  }
}
```

`nr_entries` elements are `{ "arfcn": 504990, "scs": 30 }`. `tower_lock_lte_active` and `tower_lock_nr_active` are **tri-state**: `true`, `false`, or `null` meaning the tower read failed. See [The tri-state tower-lock contract](#the-tri-state-tower-lock-contract).

**A failed transport read is an error envelope, not a data object.** If the compound `AT+QNWCFG` read returns non-zero or empty, the script logs and answers `{"success":false,"error":"read_failed","detail":"Unable to read frequency lock state from modem"}` with **no `modem_state` at all**, following the guard-the-transport-result rule in [at-command-transport.md](at-command-transport.md). Absence is the honest signal: the parses below that read are all `grep`-and-default, so on an empty `raw` every one of them would have produced `lte_locked:false` / `nr_locked:false` and published "not locked" as a fact about the modem. That fabrication also fed `lock.sh`'s gate, which is how the gate came to fail open.

The jq-failure fallback `printf` (near the end of the script) still exists for the case where the response cannot be assembled, and it now emits `null` for both tower fields rather than `false`. The client treats a null `modemState` as the `unknown` posture, and as blocking.

> ℹ️ NOTE: `status.sh`'s own header comment says it "Queries 4 AT commands (with sleep between each)". That is stale: the two `QNWCFG` reads were merged into one compound command at `status.sh:31`, and there is a single `sleep 0.1`. Three round-trips, not four.

### `POST /frequency/lock.sh`

| Request | Body |
| ------- | ---- |
| LTE lock | `{"type":"lte","action":"lock","earfcns":[1300,3400]}` |
| LTE unlock | `{"type":"lte","action":"unlock"}` |
| NR lock | `{"type":"nr","action":"lock","entries":[{"arfcn":504990,"scs":30}]}` |
| NR unlock | `{"type":"nr","action":"unlock"}` |

Success: `{"success":true,"type":"lte","action":"lock","count":2}`. Errors carry a machine `error` code plus a human `detail`:

| Code | Meaning |
| ---- | ------- |
| `tower_lock_active` | The one-directional gate refused. **QManager's refusal — the modem never saw the command** |
| `tower_state_unknown` | The gate could not **read** the tower lock state **twice**, 0.1s apart, so it failed closed. Also QManager's refusal, and also before any `qcmd` write. Retryable: it usually means the AT mutex was lost. This is the one code the surface translates, via `errorCode` |
| `invalid_count` | LTE outside 1–2, or NR outside 1–32 |
| `invalid_earfcn` / `invalid_arfcn` | Not a positive integer |
| `invalid_scs` | Not one of 15, 30, 60, 120, 240 |
| `at_error` | The modem answered `ERROR` |
| `modem_error` | `qcmd` failed or returned nothing |
| `no_type` / `no_action` / `invalid_type` / `invalid_action` | Malformed request |

## Props contracts

### `FreqLockHeroProps`

Read-only except for one outbound edge — `onAddChannel` — which is the whole point of the split: the strip reports, the cards change.

| Prop | Type | Notes |
| ---- | ---- | ----- |
| `modemState` | `FreqLockModemState \| null` | The AT read-back. `null` → the verdict is `unknown` |
| `modemData` | `ModemStatus \| null` | The poller snapshot; source of the carriers and of `nr.scs` |
| `isLoading` / `isRefreshing` | `boolean` | First paint / quiet re-read |
| `lastSyncedAt` | `number \| null` | Drives the `as of HH:MM` chip |
| `towerLockActive` | `boolean` | The **union** of both legs — the verdict it renders is page-level. Already fail-safe: an unread state arrives here as `true` |
| `towerLockStateKnown` | `boolean` | False when either leg's tower state is `null`. Switches the verdict copy and the disc mark to the "we could not read this" wording. One of only two components that takes it |
| `onRefresh` | `() => void` | |
| `onAddChannel` | `(technology, channel, scs \| null) => void` | `scs` is non-null only for an NR carrier whose spacing the modem actually reported |

### `LteFreqCardProps` / `NrFreqCardProps`

| Prop | Type | Notes |
| ---- | ---- | ----- |
| `draft` | `string[]` (length 2) / `NrFreqLockEntry[]` (0–32) | **Owned by the shell**, with `onDraftChange` |
| `modemState` / `modemData` | as above | Modem drives the chip and the dirty gate; poller drives Use-current and the supported-band list |
| `isLoading` / `isLocking` | `boolean` | |
| `error` | `string \| null` | Shared across both cards — see [Known gaps](#known-gaps) |
| `towerLockActive` | `boolean` | **Per leg** here, not the union |
| `onLock` / `onUnlock` | `(earfcns) => Promise<boolean>` / `(entries) => Promise<boolean>` / `() => Promise<boolean>` | |

### `FreqApplyBarProps`

`{ modemState, modemData, isLoading, isBusy, towerLockActive, towerLockStateKnown, onClearAll }`. It renders four mutually exclusive branches: loading, applying (`isBusy`), blocked, and locked-or-free. The blocked branch splits its copy and its glyph on `towerLockStateKnown`; it is the second and last consumer of that prop.

## Card states

Both leg cards render `CARD_SHELL` + `CARD_PAD` in **every** branch, so the shell cannot drift.

- **Loading** — every measurement from `SKELETON_SHAPE`.
- **Blocked** — a neutral notice above the list; inputs read-only, writes disabled, Use-current still live. Never an opacity wash.
- **Empty** — NR only (`EMPTY`); the LTE card has none by design.
- **Loaded** — header chip, list, conditional notices, an `sr-only` `aria-live` applying announcement, footer pinned with `mt-auto`.
- **Error** — a `warning` notice inside the card. The form deliberately **stays usable**: a write is a legitimate way out of a failed read, and the card has no refresh of its own (the strip owns that control).

## Known gaps

- **Reboot persistence is UNVERIFIED.** There is no `AT+QNWCFG` save key, no config file, and no test on hardware. No UI copy claims a lock survives a reboot, and none may until someone measures it. If it turns out locks *are* volatile, this surface needs a re-apply-at-boot story that does not currently exist anywhere.
- **`tower/lock.sh` has no reciprocal frequency-lock check** — applying a tower lock silently wipes a live frequency lock. **Deliberately deferred**: the fix is a backend change and was scoped out of this frontend rebuild by choice, with the decision to warn in the UI (the read-back line, the `blocked` posture, the `compare_hint` note) instead. Closing it means reading the `QNWCFG` state in `tower/lock.sh` and refusing or warning.
- **No failover watcher exists, and adding one is not a frontend change.** The three on-screen warnings are mitigation, not a fix. A bounded watcher modelled on `qmanager_band_failover` (which exits on its own in ~30s) would be the right shape; `qmanager_tower_failover`'s unbounded `while true` loop would not — see [tower-locking.md](tower-locking.md#the-failover-watcher-is-unbounded--and-that-is-the-whole-design-constraint).
- **The `error` string is shared by both cards.** `useFrequencyLocking` exposes one error, and the coordinator hands it to LTE **and** NR — so a failed NR write paints an identical notice under both, and the user has to guess which leg failed. [band-locking.md](band-locking.md#error-scoping) already documents the fix (`lastAttempted` state scoping the prop at the call site); it has not been applied here.
- **`FreqLockStatusResponse.modem_state` is typed non-nullable but the hook guards for null** (`use-frequency-locking.ts:139`). The guard is correct — a malformed response is real — so the *type* is the half that is wrong. Tidying it is a `types/frequency-locking.ts` change and was not attempted.
- **~28 of the 134 i18n keys have no call site.** A whole `progress.*` subtree (a staged writing/re-registering/verifying screen), `apply.clobbered_*` (a "your lock vanished" notice for the tower-clobber case), `card.no_pci_note`, `slots.serving` / `aggregated` / `staged`, `verdict.open_tower_locking` and `error.retry` were authored ahead of surfaces that were not built. They are harmless — `i18n:check` grades unused keys as nothing at all — but they describe features a future contributor may reasonably assume exist.
- **The apply bar has no Apply.** It owns the disclaimer, the read-back and **Clear all** only; applying is per-leg on the cards. The name is a fossil of the comp it was built from.
- **Nothing on this page can observe a clobbered lock as it happens.** The hook only sees the aftermath on the next `refresh()`, which is why `lastSyncedAt` exists. A poller-side `QNWCFG` field would close both this and the staleness gap at once, and is the only correct place to add one.
- **`types/tower-locking.ts` is imported here** for `SCS_OPTIONS`. "Tidying" those types while working on Tower Locking breaks this route, and TypeScript will not tell you until the build.

## Related

- [tower-locking.md](tower-locking.md) — the sibling route this page is gated on, its `save_ctrl` persistence (which this feature does **not** have), the unbounded failover watcher, the same no-`Switch` decision, and its own read-honesty contract: **per-field `*_read_ok` booleans**, deliberately a different shape from the tri-state here (see [Why this surface is tri-state and Tower Locking is not](#why-this-surface-is-tri-state-and-tower-locking-is-not))
- [band-locking.md](band-locking.md) — the looser sibling, the bounded failover watcher, the error-scoping fix this surface still needs, and the "a number in copy is a claim about the device" lesson
- [carrier-aggregation.md](carrier-aggregation.md) — `carrier_components[]`, the source of the carriers on air and of the ten per-carrier fields that do **not** include SCS
- [radio-information.md](radio-information.md) — the poller cadence behind the ~4s clock, the serving-cell-only `nr.scs`, and the compiler-backed `react-hooks` bail-on-first-violation behaviour
- [at-command-transport.md](at-command-transport.md) — the `/tmp/qmanager_at.lock` mutex that makes polling `status.sh` expensive
- [i18n.md](i18n.md) — the two severity policies over one engine, and why keys are never interpolated on this surface
- [icon-system.md](icon-system.md) — `/cellular/` is a Material Symbols route; the five new glyphs are in the subset
- `DESIGN.md` > Named Rules (Fill-Over-Stroke, Filled-Chip, Glyph-Disc, Skeleton-Mirror, Machine-Voice, Radius-Follows-Size, Identity-Chip, One-Scale)
