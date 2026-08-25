# Static SoC-Based Data Counter Orientation (Schema v5)

> Replaces Schema v4's per-boot dynamic orientation probe with a static SoC-to-orientation map derived from `/etc/quectel-project-version`. Simpler, deterministic, and removes a class of probe-misclassification bugs observed under live traffic on RM520N-GL.

**Status:** Approved design — ready for implementation plan.
**Tier:** 2 (single layer — backend poller only).
**Date:** 2026-05-24.

---

## Motivation

Schema v4 (shipped in v0.1.12) ran an asynchronous 5 MB Cloudflare download probe at first WAN-up to empirically classify whether `/proc/net/dev` field 2 carries downloads or uploads on the live IPA driver build. The probe was meant to handle the case where some SDX55 IPA builds attribute fast-path bytes to the swapped column.

**The probe is unreliable in practice.** On at least one RM520N-GL (SDX65) device, the dynamic verdict mislabels orientation under real traffic conditions, producing reversed Data Used TX/RX values. Causes can include:

- Concurrent background traffic during the probe window distorting the field deltas
- Captive portals or proxies altering the 5 MB payload size
- IPA flush cadence happening to favor one direction during the brief sampling window
- The 5:1 ratio threshold failing on networks where upload-direction signaling is unusually heavy

Per the [data-counter platform matrix](../../reference/data-counter-platform-matrix.md), the **SoC alone is a reliable predictor** of orientation:

- SDX6X (SDX65 / x62 — RM520N-GL) → normal orientation, field 2 = RX, field 10 = TX
- SDX55 (RM502Q-AE) → reversed orientation under fast-path traffic, field 2 = TX, field 10 = RX

A static SoC-keyed mapping removes the probe entirely. The verdict is computed once from `/etc/quectel-project-version` and cached inside `data_used.json`.

---

## Design

### SoC-to-orientation map

| `Branch Name` in `/etc/quectel-project-version` | Orientation | DL field | UL field |
|---|---|---|---|
| `SDX6X` | `normal` | 2 | 10 |
| `SDX55` | `reversed` | 10 | 2 |
| anything else / missing / blank | `normal` | 2 | 10 |

Unknown SoCs default to `normal` (Quectel spec). No warning log — the design assumes any future Quectel modem is more likely to match the spec than to follow SDX55's quirk.

### Schema v5 `data_used.json` fields

| Field | Description |
|---|---|
| `schema` | `5` — version guard |
| `accumulated_rx_bytes` | Running total of RX bytes since last reset |
| `accumulated_tx_bytes` | Running total of TX bytes since last reset |
| `selected_counter` | Kernel interface name used as source (e.g. `rmnet_ipa0`) |
| `orientation` | `normal` \| `reversed` — replaces `orientation_state` |
| `last_update_ts` | Unix timestamp of last successful counter update |
| `last_reset_ts` | Unix timestamp of last user-triggered reset |
| `modem_reset_count` | Count of negative-kernel-delta events (modem reboots) |
| `prev_ipa_rx` | Baseline raw kernel value for next delta computation |
| `prev_ipa_tx` | Baseline raw kernel value for next delta computation |

**Removed in v5:** `orientation_state`, `orientation_history_swapped`.

### Schema migration policy

| On-disk schema | Action |
|---|---|
| `< 3` | Discard file (existing behavior — pre-Schema-3 AT-counter state is incompatible) |
| `3` or `4` | **Reset `accumulated_rx_bytes` and `accumulated_tx_bytes` to 0.** Set `last_reset_ts = now`. Drop the obsolete fields. Compute `orientation` from SoC. Rewrite as v5. Log one info line: `data_used: schema vN → v5 migration; counters reset (orientation now static)` |
| `5` | Load as-is. Re-derive `orientation` from SoC and overwrite the on-disk value if it disagrees (handles devices flashed with a different SoC firmware after install — extremely rare but cheap to cover) |

Resetting accumulators on v3/v4 upgrade is deliberate: historic totals on those installs may have been recorded against a misverdict and mixing them with a correct-orientation present would be dishonest accounting.

### Code-level changes in `scripts/usr/bin/qmanager_poller`

**Add** one function near the existing Configuration section:

```bash
detect_orientation_from_soc() {
    # Returns "normal" or "reversed" on stdout. Maps SoC Branch Name from
    # /etc/quectel-project-version to a /proc/net/dev field orientation.
    # SDX55 reverses (IPA fast-path attributes bytes to the swapped column);
    # everything else uses spec orientation (field 2 = DL, field 10 = UL).
    local _branch="normal"
    if [ -f /etc/quectel-project-version ]; then
        _branch=$(awk -F': *' '/^Branch Name/ {print $2; exit}' \
                  /etc/quectel-project-version 2>/dev/null | tr -d '\r\n')
    fi
    case "$_branch" in
        SDX55) printf 'reversed\n' ;;
        *)     printf 'normal\n' ;;
    esac
}
```

**Replace** the probe constants block (lines 78–87) with a single sentence comment:

```bash
# --- Counter orientation (Tier 1) -------------------------------------------
# Static SoC-based mapping; see detect_orientation_from_soc() and
# docs/reference/data-usage-counter.md for the SoC × orientation table.
```

**Delete entirely:**

- `start_orientation_probe()` function (lines 593–660)
- `apply_orientation_result()` function (lines 662–704)
- Step 0.5 orchestration block in `update_data_used` (lines 795–803)
- The `orientation_state="pending"` / `orientation_probe_attempted=false` reset inside the counter-reset path (lines 866–870, Option-B retry comment included)
- The Schema-v4 swap-history migration block inside `apply_orientation_result` (lines 686–697)

**Rename / consolidate state variables:**

- Replace `orientation_state` with a single `orientation` (`normal` | `reversed`)
- Keep `orientation_dl_field` and `orientation_ul_field` — they're set once at startup from `orientation`
- Remove `orientation_probe_attempted` and `orientation_history_swapped`

**Startup wiring:** Call `detect_orientation_from_soc()` once at poller startup (before the first `update_data_used` tick) and set `orientation`, `orientation_dl_field`, `orientation_ul_field` accordingly. The Step 2 awk reads on `$orientation_dl_field` / `$orientation_ul_field` stay as-is.

**Counter-reset behavior:** On negative-delta detection, increment `modem_reset_count` and rebase. Do NOT re-evaluate orientation — the SoC doesn't change across a modem reattach.

**CGI emission:** `cache_block_emit` currently emits `orientation_state` (lines 1920 and 1993). Rename to `orientation` and emit the static string. Frontend does not consume this field today; no downstream impact.

**Schema bump:** `DATA_USED_SCHEMA=5`.

### What does not change

- `/proc/net/dev` remains the source of truth.
- Network interface selection logic (`rmnet_ipa0` on RM520N-GL, `wwan0` on RM551E) remains in the existing `if [ -f /etc/quectel-project-version ]` block.
- Counter-reset detection on negative deltas — unchanged.
- `modem_reset_count` — unchanged.
- Shebang stays `#!/bin/bash` — the 32-bit arithmetic warning still applies to the accumulators.
- User-triggered reset path (`DATA_USED_RESET_FLAG`) — unchanged.

---

## Out of scope

- **User override of the SoC default.** Not implemented. If a future device disagrees with the table, we update the static map in code, not via a config file. This avoids creating a footgun where a user-edited file silently corrupts accounting.
- **Frontend UI for `orientation`.** The new field is emitted in the CGI cache block for diagnostics but no card consumes it. A future card showing "Data counter orientation: normal / reversed (auto-detected from SDX6X)" is a separate Tier 2 change.
- **Retroactive correction of mislabeled historic data on v3/v4 installs.** We reset accumulators on upgrade. We do not attempt to swap historic bytes back.

---

## Risk & validation

- **Blast radius:** poller only — single layer. No CGI/hook/component changes beyond a field rename in CGI output (which has no current consumers).
- **Phase 5 validators:** `busybox-portability-checker` on `qmanager_poller`. No `installer-safety-auditor` needed (no installer/systemd/sudoers/OTA touch).
- **Phase 6 docs:** `docs/reference/data-usage-counter.md` (rewrite Schema and Orientation sections), `docs/reference/data-counter-platform-matrix.md` (replace the "Dynamic orientation detection" section with a brief "Static SoC orientation mapping" note), `CLAUDE.md` (update the Data Usage Counter bullet).
- **Compatibility:** v3, v4, v5 file shapes are all handled. v3/v4 upgrade resets accumulators; the user is informed via journald.

---

## Open questions

None at design time. Implementation plan can proceed.
