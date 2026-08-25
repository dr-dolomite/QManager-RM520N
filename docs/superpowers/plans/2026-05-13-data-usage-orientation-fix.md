# Data Usage Counter — Orientation Calibration + 32-bit Overflow Fix

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two compounding bugs in v0.1.9's persistent data-usage counter — (1) `AT+QGDNRCNT` field order is firmware-specific (`<TX>,<RX>` on `RM520NGLAAR03A03M4G`, `<RX>,<TX>` on the user's firmware), and (2) BusyBox `sh` 32-bit arithmetic overflow wraps the accumulator to negative values once cumulative bytes cross 2.15 GB.

**Architecture:** Consolidate on `AT+QGDNRCNT` as the universal counter (empirically confirmed to track LTE-only, NSA, and SA traffic on the test firmware). Add a one-time **active calibration** at first run / after reset: trigger a 1 MB download to `speed.cloudflare.com`, observe which AT field grew in lockstep with the kernel's `/proc/net/dev rmnet_ipa0` RX counter, and lock the orientation per-install in `data_used.json`. Flip `qmanager_poller`'s shebang from `#!/bin/sh` to `#!/bin/bash` to get 64-bit `intmax_t` arithmetic. Bump the persistent-state schema 1→2 to force a clean reset on upgrade for users carrying corrupted negative values.

**Tech Stack:** Bash 3.2 (ARMv7l), jq, curl, `/proc/net/dev`, BusyBox awk/sed/grep, Next.js 15 / React 19 / TypeScript (frontend).

---

## Investigation Summary (verified facts only)

- **Bug 1 (orientation):** On test firmware `RM520NGLAAR03A03M4G`, both `+QGDCNT` and `+QGDNRCNT` return `<TX>,<RX>` in lockstep. Field 1 grew during driven uploads, field 2 grew during driven downloads — confirmed across LTE-only and NSA modes via the probes in `D:\tmp\probe_field_order_v2.py` and `D:\tmp\probe_lte_only.py`. On the user's firmware (SA), `+QGDNRCNT` returns fields in the **reversed** order vs `+QGDCNT`. The user's `+QGDCNT` matches public Quectel docs (TX=142M, RX=1.68G typical) but `+QGDNRCNT` shows them mirrored.
- **Bug 2 (overflow):** BusyBox `sh` (which `#!/bin/sh` resolves to on this platform) uses 32-bit signed `long` for `$(( … ))` and `-lt` comparisons. Bash 3.2 on the same platform uses 64-bit `intmax_t`. Verified directly:
  ```
  bash -c 'a=3521972331; echo $((a+0))'   → 3521972331    (64-bit, correct)
  sh   -c 'a=3521972331; echo $((a+0))'   → -772994965   (32-bit wrap, exact match for user screenshot)
  ```
- **QGDNRCNT universality on test firmware:** Tracked LTE-only traffic identically to QGDCNT during a 50 MB download / 20 MB upload while the modem was held on `mode_pref=LTE`. Same field order. Safe to use as the single universal counter.

## File Structure

**Files to modify:**

| File | Responsibility |
|---|---|
| `scripts/usr/bin/qmanager_poller` | Shebang flip; schema bump; orientation state vars; calibration function; counter-selection simplification; orientation-aware parsing; status-cache emit |
| `types/modem-status.ts` | `DataUsedBlock` interface extension; `formatBytes()` negative clamp |
| `RELEASE_NOTES.md` | v0.1.10 bullet describing the fix and the one-time 1 MB calibration cost |
| `CLAUDE.md` | Data-usage section: document the orientation calibration design and the bash arithmetic requirement |

**Files NOT modified (passthrough is structural):**

- `scripts/www/cgi-bin/quecmanager/network/data_used.sh` — already does `printf '%s' "$data_used" | jq … '. + { stale: $stale }'`; new fields ride through automatically.
- `scripts/www/cgi-bin/quecmanager/network/data_used_reset.sh` — already touches `/tmp/qmanager_data_used_reset`; the poller's reset handler is where the orientation-clear behaviour lives (Task 7).
- `hooks/use-data-used.ts` — typed against `DataUsedBlock` structurally; new fields surface automatically.
- `components/dashboard/device-metrics.tsx` — `formatBytes()` clamp at the source means no component change needed.

---

## Task 1: Flip poller shebang and bump schema constant

**Files:**
- Modify: `scripts/usr/bin/qmanager_poller:1`
- Modify: `scripts/usr/bin/qmanager_poller:74`

- [ ] **Step 1: Verify no sh-vs-bash syntax landmines**

Run from repo root:

```bash
grep -nE '(\[\[|^[[:space:]]*let[[:space:]]|^[[:space:]]*declare[[:space:]]|echo[[:space:]]+-[en])' scripts/usr/bin/qmanager_poller
```

Expected: empty output. The poller is strict POSIX-sh today; any hit means a `bashism` already snuck in and must be reviewed manually before flipping. (Pre-investigation already confirmed empty.)

- [ ] **Step 2: Flip shebang**

Change `scripts/usr/bin/qmanager_poller` line 1 from:

```sh
#!/bin/sh
```

To:

```sh
#!/bin/bash
```

- [ ] **Step 3: Bump schema constant**

Change `scripts/usr/bin/qmanager_poller` line 74 from:

```sh
DATA_USED_SCHEMA=1
```

To:

```sh
DATA_USED_SCHEMA=2
```

- [ ] **Step 4: Deploy and verify the poller starts cleanly**

Use the SSH probe pattern documented in memory (`reference_modem_ssh_probe.md`). Save as `D:\tmp\probe_post_shebang.py`:

```python
import os, paramiko
HOST = os.environ["MODEM_IP"]; USER = os.environ["MODEM_SSH_USER"]; PWD = os.environ["MODEM_SSH_PASSWORD"]
REMOTE = r"""
set -u
# Push the updated poller (rsync would be cleaner; scp -O works on RM520N-GL per memory)
echo "=== bash arithmetic width on poller's shebang ==="
head -1 /usr/bin/qmanager_poller
# Sanity check 64-bit arithmetic under bash 3.2
bash -c 'a=3521972331; echo "64-bit OK: $((a+0))"'
echo
echo "=== poller restart + log tail ==="
systemctl restart qmanager-poller
sleep 5
journalctl -u qmanager-poller --since '10 seconds ago' --no-pager | tail -20
"""
cli = paramiko.SSHClient(); cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(HOST, username=USER, password=PWD, timeout=10, look_for_keys=False, allow_agent=False)
_, out, err = cli.exec_command(REMOTE, timeout=60)
print(out.read().decode()); print("---STDERR---"); print(err.read().decode())
cli.close()
```

Before running: scp the updated poller to the modem (`scp -O scripts/usr/bin/qmanager_poller root@$MODEM_IP:/usr/bin/qmanager_poller`).

Then run: `set -a; . .env; set +a; python D:/tmp/probe_post_shebang.py`

Expected:
- `head -1` shows `#!/bin/bash`
- `64-bit OK: 3521972331` (no wrap)
- journalctl shows poller started without parser errors, normal "data_used: …" log lines

- [ ] **Step 5: Commit**

```bash
git add scripts/usr/bin/qmanager_poller
git commit -m "fix(poller): switch shebang to bash for 64-bit arithmetic; bump data_used schema to 2

BusyBox sh uses 32-bit signed long for \$(( … )), which wraps the data_used
accumulator to negative once it crosses 2.15 GB. Bash 3.2 on this platform
uses 64-bit intmax_t. No other syntax changes required — the poller is
strict POSIX-sh today.

Schema bump triggers a clean reset of /usrdata/qmanager/data_used.json on
load, healing users carrying corrupted negative accumulator values from
v0.1.9."
```

---

## Task 2: Declare orientation state variables and extend persistence

**Files:**
- Modify: `scripts/usr/bin/qmanager_poller:204-223` (initial-value block)
- Modify: `scripts/usr/bin/qmanager_poller:616-651` (`write_data_used_state` function)
- Modify: `scripts/usr/bin/qmanager_poller:653-695` (lazy-load block in `update_data_used`)

- [ ] **Step 1: Add initial-value declarations**

After line 223 (`du_mode_transition_count=0`), add:

```sh
# Orientation calibration state (Bug 1 fix)
# orientation: "tx,rx" (Quectel-public default) | "rx,tx" (user's firmware)
# orientation_calibrated: locked once a download probe successfully maps
#   AT-counter fields to /proc/net/dev rmnet_ipa0 directions.
# orientation_attempts: capped at MAX_CALIBRATION_ATTEMPTS to prevent
#   curl-spamming a metered link if the modem is flapping.
du_orientation="tx,rx"
du_orientation_calibrated=false
du_orientation_attempts=0
```

Also add the cap constant near the other data_used config (after line 73 `DATA_USED_DIVERGENCE_MIN=…`):

```sh
DATA_USED_MAX_CALIBRATION_ATTEMPTS=10  # after this, freeze at default
                                       # orientation and emit a warn event
DATA_USED_CALIBRATION_SIZE=1048576     # 1 MB — small enough to be cheap on
                                       # metered links, large enough to swamp
                                       # tick-noise on the orientation signal
DATA_USED_CALIBRATION_URL="https://speed.cloudflare.com/__down?bytes=${DATA_USED_CALIBRATION_SIZE}"
```

- [ ] **Step 2: Extend `write_data_used_state` to persist new fields**

In `scripts/usr/bin/qmanager_poller` replace the `write_data_used_state()` function (lines 616-651) with:

```sh
write_data_used_state() {
    mkdir -p /usrdata/qmanager 2>/dev/null
    jq -n \
        --argjson schema     "$DATA_USED_SCHEMA" \
        --argjson acc_rx     "$du_accumulated_rx" \
        --argjson acc_tx     "$du_accumulated_tx" \
        --arg     sel        "$du_selected_counter" \
        --argjson prev_gd_tx "$du_prev_qgdcnt_tx" \
        --argjson prev_gd_rx "$du_prev_qgdcnt_rx" \
        --argjson prev_nr_tx "$du_prev_qgdnrcnt_tx" \
        --argjson prev_nr_rx "$du_prev_qgdnrcnt_rx" \
        --argjson prev_i_rx  "$du_prev_ipa_rx" \
        --argjson prev_i_tx  "$du_prev_ipa_tx" \
        --argjson last_upd   "$du_last_update_ts" \
        --argjson last_rst   "$du_last_reset_ts" \
        --argjson div_cnt    "$du_divergence_count" \
        --argjson modem_rst  "$du_modem_reset_count" \
        --argjson mode_xn    "$du_mode_transition_count" \
        --arg     orient     "$du_orientation" \
        --argjson orient_cal "$du_orientation_calibrated" \
        --argjson orient_att "$du_orientation_attempts" \
        '{
            schema:                $schema,
            accumulated_rx_bytes:  $acc_rx,
            accumulated_tx_bytes:  $acc_tx,
            selected_counter:      $sel,
            prev_qgdcnt_tx:        $prev_gd_tx,
            prev_qgdcnt_rx:        $prev_gd_rx,
            prev_qgdnrcnt_tx:      $prev_nr_tx,
            prev_qgdnrcnt_rx:      $prev_nr_rx,
            prev_ipa_rx:           $prev_i_rx,
            prev_ipa_tx:           $prev_i_tx,
            last_update_ts:        $last_upd,
            last_reset_ts:         $last_rst,
            divergence_count:      $div_cnt,
            modem_reset_count:     $modem_rst,
            mode_transition_count: $mode_xn,
            orientation:           $orient,
            orientation_calibrated: $orient_cal,
            orientation_attempts:  $orient_att
        }' > "$DATA_USED_TMP" && mv "$DATA_USED_TMP" "$DATA_USED_FILE"
}
```

- [ ] **Step 3: Extend lazy-load to parse new fields with safe defaults**

In `scripts/usr/bin/qmanager_poller`, replace the lazy-load `_jv=$(jq -r '…')` expression and the subsequent awk-field assignments (lines 657-689) with:

```sh
            _jv=$(jq -r '
                (.accumulated_rx_bytes  // 0 | tostring) + " " +
                (.accumulated_tx_bytes  // 0 | tostring) + " " +
                (.selected_counter      // ""           ) + " " +
                (.prev_qgdcnt_tx        // 0 | tostring) + " " +
                (.prev_qgdcnt_rx        // 0 | tostring) + " " +
                (.prev_qgdnrcnt_tx      // 0 | tostring) + " " +
                (.prev_qgdnrcnt_rx      // 0 | tostring) + " " +
                (.prev_ipa_rx           // 0 | tostring) + " " +
                (.prev_ipa_tx           // 0 | tostring) + " " +
                (.last_update_ts        // 0 | tostring) + " " +
                (.last_reset_ts         // 0 | tostring) + " " +
                (.divergence_count      // 0 | tostring) + " " +
                (.modem_reset_count     // 0 | tostring) + " " +
                (.mode_transition_count // 0 | tostring) + " " +
                (.orientation           // "tx,rx"      ) + " " +
                (.orientation_calibrated // false | tostring) + " " +
                (.orientation_attempts  // 0 | tostring)
            ' "$DATA_USED_FILE" 2>/dev/null)
            if [ -n "$_jv" ]; then
                du_accumulated_rx=$(    printf '%s' "$_jv" | awk '{print $1}')
                du_accumulated_tx=$(    printf '%s' "$_jv" | awk '{print $2}')
                du_selected_counter=$(  printf '%s' "$_jv" | awk '{print $3}')
                du_prev_qgdcnt_tx=$(    printf '%s' "$_jv" | awk '{print $4}')
                du_prev_qgdcnt_rx=$(    printf '%s' "$_jv" | awk '{print $5}')
                du_prev_qgdnrcnt_tx=$(  printf '%s' "$_jv" | awk '{print $6}')
                du_prev_qgdnrcnt_rx=$(  printf '%s' "$_jv" | awk '{print $7}')
                du_prev_ipa_rx=$(       printf '%s' "$_jv" | awk '{print $8}')
                du_prev_ipa_tx=$(       printf '%s' "$_jv" | awk '{print $9}')
                du_last_update_ts=$(    printf '%s' "$_jv" | awk '{print $10}')
                du_last_reset_ts=$(     printf '%s' "$_jv" | awk '{print $11}')
                du_divergence_count=$(  printf '%s' "$_jv" | awk '{print $12}')
                du_modem_reset_count=$( printf '%s' "$_jv" | awk '{print $13}')
                du_mode_transition_count=$(printf '%s' "$_jv" | awk '{print $14}')
                du_orientation=$(       printf '%s' "$_jv" | awk '{print $15}')
                du_orientation_calibrated=$(printf '%s' "$_jv" | awk '{print $16}')
                du_orientation_attempts=$(printf '%s' "$_jv" | awk '{print $17}')
            fi
```

Note: `selected_counter` empty-string defaults to a blank token that awk collapses, shifting field indices. To prevent this, ensure the jq default for `selected_counter` is non-blank — the lazy-load already preserves whatever's on disk (the on-disk file from Task 1+3 will write `"qgdnrcnt"` after first tick). Same precaution applies to `orientation` which defaults to `"tx,rx"`.

- [ ] **Step 4: Deploy + smoke-test persistence round-trip**

scp the updated poller. Then probe:

```python
# D:\tmp\probe_persistence.py
import os, paramiko
HOST = os.environ["MODEM_IP"]; USER = os.environ["MODEM_SSH_USER"]; PWD = os.environ["MODEM_SSH_PASSWORD"]
REMOTE = r"""
set -u
systemctl restart qmanager-poller
sleep 8
echo "=== data_used.json after restart ==="
cat /usrdata/qmanager/data_used.json
echo
echo "=== schema + new fields present ==="
jq '{schema, orientation, orientation_calibrated, orientation_attempts}' /usrdata/qmanager/data_used.json
"""
cli = paramiko.SSHClient(); cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(HOST, username=USER, password=PWD, timeout=10, look_for_keys=False, allow_agent=False)
_, out, _ = cli.exec_command(REMOTE, timeout=60)
print(out.read().decode())
cli.close()
```

Run: `set -a; . .env; set +a; python D:/tmp/probe_persistence.py`

Expected:
- `schema: 2`
- `orientation: "tx,rx"` (default — calibration not yet wired up)
- `orientation_calibrated: false`
- `orientation_attempts: 0`

- [ ] **Step 5: Commit**

```bash
git add scripts/usr/bin/qmanager_poller
git commit -m "feat(poller): add orientation calibration state to data_used persistence

Declares du_orientation, du_orientation_calibrated, du_orientation_attempts
shell variables, and extends write_data_used_state + the lazy-load jq+awk
pipeline to round-trip them through /usrdata/qmanager/data_used.json. Adds
MAX_CALIBRATION_ATTEMPTS=10 / SIZE=1MiB / URL constants near the existing
data_used config block. No behavior change yet — calibration function and
wiring land in subsequent commits."
```

---

## Task 3: Schema migration — discard state on schema mismatch

**Files:**
- Modify: `scripts/usr/bin/qmanager_poller:653-695` (lazy-load block in `update_data_used`)

- [ ] **Step 1: Add schema-check branch to lazy-load**

After the `if [ -n "$_jv" ]; then … fi` block from Task 2 (which lives inside `if [ -f "$DATA_USED_FILE" ]; then` around line 656), add a schema check that runs **before** the field assignment when the file exists. Replace the lazy-load block opening (lines 655-694) with this complete version:

```sh
    # Step 0: lazy-load from disk on first call
    if [ "$du_loaded" = "false" ]; then
        if [ -f "$DATA_USED_FILE" ]; then
            # Schema-version check — if older than current, discard state.
            # Healing path for v0.1.9 users carrying corrupted negative
            # accumulator values from the BusyBox-sh 32-bit overflow bug.
            local _on_disk_schema
            _on_disk_schema=$(jq -r '.schema // 0' "$DATA_USED_FILE" 2>/dev/null)
            if [ "${_on_disk_schema:-0}" -lt "$DATA_USED_SCHEMA" ]; then
                qlog_info "data_used: schema v${_on_disk_schema} < v${DATA_USED_SCHEMA}; resetting state"
                rm -f "$DATA_USED_FILE"
                # Fall through to "no file" branch below — clean slate.
            else
                local _jv
                _jv=$(jq -r '
                    (.accumulated_rx_bytes  // 0 | tostring) + " " +
                    (.accumulated_tx_bytes  // 0 | tostring) + " " +
                    (.selected_counter      // ""           ) + " " +
                    (.prev_qgdcnt_tx        // 0 | tostring) + " " +
                    (.prev_qgdcnt_rx        // 0 | tostring) + " " +
                    (.prev_qgdnrcnt_tx      // 0 | tostring) + " " +
                    (.prev_qgdnrcnt_rx      // 0 | tostring) + " " +
                    (.prev_ipa_rx           // 0 | tostring) + " " +
                    (.prev_ipa_tx           // 0 | tostring) + " " +
                    (.last_update_ts        // 0 | tostring) + " " +
                    (.last_reset_ts         // 0 | tostring) + " " +
                    (.divergence_count      // 0 | tostring) + " " +
                    (.modem_reset_count     // 0 | tostring) + " " +
                    (.mode_transition_count // 0 | tostring) + " " +
                    (.orientation           // "tx,rx"      ) + " " +
                    (.orientation_calibrated // false | tostring) + " " +
                    (.orientation_attempts  // 0 | tostring)
                ' "$DATA_USED_FILE" 2>/dev/null)
                if [ -n "$_jv" ]; then
                    du_accumulated_rx=$(    printf '%s' "$_jv" | awk '{print $1}')
                    du_accumulated_tx=$(    printf '%s' "$_jv" | awk '{print $2}')
                    du_selected_counter=$(  printf '%s' "$_jv" | awk '{print $3}')
                    du_prev_qgdcnt_tx=$(    printf '%s' "$_jv" | awk '{print $4}')
                    du_prev_qgdcnt_rx=$(    printf '%s' "$_jv" | awk '{print $5}')
                    du_prev_qgdnrcnt_tx=$(  printf '%s' "$_jv" | awk '{print $6}')
                    du_prev_qgdnrcnt_rx=$(  printf '%s' "$_jv" | awk '{print $7}')
                    du_prev_ipa_rx=$(       printf '%s' "$_jv" | awk '{print $8}')
                    du_prev_ipa_tx=$(       printf '%s' "$_jv" | awk '{print $9}')
                    du_last_update_ts=$(    printf '%s' "$_jv" | awk '{print $10}')
                    du_last_reset_ts=$(     printf '%s' "$_jv" | awk '{print $11}')
                    du_divergence_count=$(  printf '%s' "$_jv" | awk '{print $12}')
                    du_modem_reset_count=$( printf '%s' "$_jv" | awk '{print $13}')
                    du_mode_transition_count=$(printf '%s' "$_jv" | awk '{print $14}')
                    du_orientation=$(       printf '%s' "$_jv" | awk '{print $15}')
                    du_orientation_calibrated=$(printf '%s' "$_jv" | awk '{print $16}')
                    du_orientation_attempts=$(printf '%s' "$_jv" | awk '{print $17}')
                fi
            fi
        fi
        # Re-check file existence — if the schema-mismatch branch deleted it,
        # we want the same initialization as a true fresh install.
        if [ ! -f "$DATA_USED_FILE" ]; then
            mkdir -p /usrdata/qmanager 2>/dev/null
        fi
        du_loaded=true
    fi
```

- [ ] **Step 2: Pre-seed a schema-v1 file with the user's negative-bytes corruption and verify migration**

```python
# D:\tmp\probe_schema_migration.py
import os, paramiko
HOST = os.environ["MODEM_IP"]; USER = os.environ["MODEM_SSH_USER"]; PWD = os.environ["MODEM_SSH_PASSWORD"]
REMOTE = r"""
set -u
systemctl stop qmanager-poller
echo "=== seeding schema=1 with user's reported negative state ==="
cat > /usrdata/qmanager/data_used.json <<'EOF'
{
  "schema": 1,
  "accumulated_rx_bytes": 285082419,
  "accumulated_tx_bytes": -772994965,
  "selected_counter": "qgdnrcnt",
  "prev_qgdcnt_tx": 0,
  "prev_qgdcnt_rx": 0,
  "prev_qgdnrcnt_tx": 1808954567,
  "prev_qgdnrcnt_rx": 149632219,
  "prev_ipa_rx": 0,
  "prev_ipa_tx": 0,
  "last_update_ts": 1778500000,
  "last_reset_ts": 0,
  "divergence_count": 0,
  "modem_reset_count": 0,
  "mode_transition_count": 0
}
EOF
echo "=== restarting poller ==="
systemctl start qmanager-poller
sleep 10
echo "=== migrated data_used.json ==="
cat /usrdata/qmanager/data_used.json
echo
echo "=== checking log for migration message ==="
journalctl -u qmanager-poller --since '30 seconds ago' --no-pager | grep -i 'data_used.*schema\|data_used.*reset' | head -5
"""
cli = paramiko.SSHClient(); cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(HOST, username=USER, password=PWD, timeout=10, look_for_keys=False, allow_agent=False)
_, out, _ = cli.exec_command(REMOTE, timeout=60)
print(out.read().decode())
cli.close()
```

Run: `set -a; . .env; set +a; python D:/tmp/probe_schema_migration.py`

Expected:
- New file shows `schema: 2`
- `accumulated_rx_bytes: 0` and `accumulated_tx_bytes: 0` (state was discarded)
- Log line: `data_used: schema v1 < v2; resetting state`
- `orientation_calibrated: false`

- [ ] **Step 3: Commit**

```bash
git add scripts/usr/bin/qmanager_poller
git commit -m "feat(poller): add schema migration for data_used.json (v1 -> v2)

On lazy-load, if the on-disk schema is older than the current
DATA_USED_SCHEMA constant, the file is deleted and treated as a fresh
install. Heals v0.1.9 users whose accumulator wrapped to negative under
BusyBox sh 32-bit arithmetic. No-op for fresh installs and v0.1.10+
states."
```

---

## Task 4: Add `calibrate_orientation` function

**Files:**
- Modify: `scripts/usr/bin/qmanager_poller` — add new function block immediately before `update_data_used()` (currently line 653)

- [ ] **Step 1: Add the function**

Insert this complete function block before `update_data_used() {` (currently line 653). It uses `qcmd_exec` for AT calls, `curl` for the calibration download, and `append_event` for the dashboard event log.

```sh
# -----------------------------------------------------------------------------
# calibrate_orientation — one-shot AT-counter field-order detection
# -----------------------------------------------------------------------------
# Reads QGDNRCNT + /proc/net/dev rmnet_ipa0, drives a 1 MB cellular download,
# reads again. Whichever AT field grew in lockstep with the kernel's RX delta
# is the receive field. The result is persisted in $du_orientation +
# $du_orientation_calibrated for use by update_data_used.
#
# Guards:
#   - Skips entirely if conn_internet_available != "true".
#   - Skips entirely if attempts already hit the cap (locks to default).
#   - Aborts cleanly if curl reports < 900 KB downloaded.
#   - Aborts cleanly if IPA RX delta < 900 KB (download didn't hit cellular).
#   - Aborts cleanly if IPA TX delta > 100 KB (concurrent upload muddied signal).
#   - Aborts cleanly if AT field deltas don't show a dominant direction.
#
# Caller is responsible for checking $du_orientation_calibrated; we just
# attempt one calibration per call and update state accordingly.
# -----------------------------------------------------------------------------
calibrate_orientation() {
    # Cap check — freeze at default once attempts exhausted.
    if [ "$du_orientation_attempts" -ge "$DATA_USED_MAX_CALIBRATION_ATTEMPTS" ]; then
        if [ "$du_orientation_calibrated" = "false" ]; then
            du_orientation_calibrated=true
            qlog_warn "data_used: orientation calibration gave up after ${DATA_USED_MAX_CALIBRATION_ATTEMPTS} attempts; locking to default ${du_orientation}"
            append_event "data_calibration_failed" \
                "Data counter orientation calibration failed after ${DATA_USED_MAX_CALIBRATION_ATTEMPTS} attempts; using default (${du_orientation})" \
                "warning"
        fi
        return 0
    fi

    # Connectivity guard — don't curl into the void.
    if [ "$conn_internet_available" != "true" ]; then
        return 0
    fi

    du_orientation_attempts=$((du_orientation_attempts + 1))
    qlog_info "data_used: calibration attempt ${du_orientation_attempts}/${DATA_USED_MAX_CALIBRATION_ATTEMPTS}"

    # Snapshot AT + IPA before download.
    local _pre_at _pre_at_f1 _pre_at_f2
    _pre_at=$(qcmd_exec 'AT+QGDNRCNT?')
    _pre_at=$(printf '%s\n' "$_pre_at" | \
        sed -n 's/^+QGDNRCNT:[[:space:]]*\([0-9]*\),\([0-9]*\).*/\1 \2/p' | head -1)
    if [ -z "$_pre_at" ]; then
        qlog_warn "data_used: calibration pre-read failed (AT)"
        return 0
    fi
    _pre_at_f1=$(printf '%s' "$_pre_at" | awk '{print $1}')
    _pre_at_f2=$(printf '%s' "$_pre_at" | awk '{print $2}')

    local _pre_ipa_rx _pre_ipa_tx _dev_line
    _dev_line=$(grep "rmnet_ipa0:" /proc/net/dev 2>/dev/null)
    if [ -z "$_dev_line" ]; then
        qlog_warn "data_used: calibration pre-read failed (IPA)"
        return 0
    fi
    _pre_ipa_rx=$(printf '%s\n' "$_dev_line" | awk '{print $2}')
    _pre_ipa_tx=$(printf '%s\n' "$_dev_line" | awk '{print $10}')

    # Drive the calibration download.
    local _curl_bytes
    _curl_bytes=$(curl -sS --max-time 8 -o /dev/null \
        -w '%{size_download}' \
        "$DATA_USED_CALIBRATION_URL" 2>/dev/null)
    if [ -z "$_curl_bytes" ] || [ "$_curl_bytes" -lt 900000 ]; then
        qlog_warn "data_used: calibration curl reported only ${_curl_bytes:-0} bytes; retrying next tick"
        return 0
    fi

    # Let the kernel rmnet counter settle.
    sleep 1

    # Snapshot AT + IPA after.
    local _post_at _post_at_f1 _post_at_f2
    _post_at=$(qcmd_exec 'AT+QGDNRCNT?')
    _post_at=$(printf '%s\n' "$_post_at" | \
        sed -n 's/^+QGDNRCNT:[[:space:]]*\([0-9]*\),\([0-9]*\).*/\1 \2/p' | head -1)
    if [ -z "$_post_at" ]; then
        qlog_warn "data_used: calibration post-read failed (AT)"
        return 0
    fi
    _post_at_f1=$(printf '%s' "$_post_at" | awk '{print $1}')
    _post_at_f2=$(printf '%s' "$_post_at" | awk '{print $2}')

    local _post_ipa_rx _post_ipa_tx
    _dev_line=$(grep "rmnet_ipa0:" /proc/net/dev 2>/dev/null)
    if [ -z "$_dev_line" ]; then
        qlog_warn "data_used: calibration post-read failed (IPA)"
        return 0
    fi
    _post_ipa_rx=$(printf '%s\n' "$_dev_line" | awk '{print $2}')
    _post_ipa_tx=$(printf '%s\n' "$_dev_line" | awk '{print $10}')

    # Compute deltas. Bash 64-bit arithmetic — safe.
    local _d_ipa_rx _d_ipa_tx _d_at_f1 _d_at_f2
    _d_ipa_rx=$((_post_ipa_rx - _pre_ipa_rx))
    _d_ipa_tx=$((_post_ipa_tx - _pre_ipa_tx))
    _d_at_f1=$((_post_at_f1 - _pre_at_f1))
    _d_at_f2=$((_post_at_f2 - _pre_at_f2))

    # Sanity guards.
    if [ "$_d_ipa_rx" -lt 900000 ]; then
        qlog_warn "data_used: calibration IPA RX delta only ${_d_ipa_rx} bytes; download didn't hit cellular?"
        return 0
    fi
    if [ "$_d_ipa_tx" -gt 100000 ]; then
        qlog_warn "data_used: calibration IPA TX delta ${_d_ipa_tx} bytes too large; concurrent upload muddied signal"
        return 0
    fi

    # Dominant-direction check on AT fields.
    if [ "$_d_at_f1" -le 0 ] && [ "$_d_at_f2" -le 0 ]; then
        qlog_warn "data_used: calibration AT counter did not advance"
        return 0
    fi

    # Decide orientation by proximity to ipa_rx_delta.
    # The AT field whose delta is CLOSER to ipa_rx_delta is the RX field.
    local _diff_f1_rx _diff_f2_rx
    if [ "$_d_at_f1" -ge "$_d_ipa_rx" ]; then
        _diff_f1_rx=$((_d_at_f1 - _d_ipa_rx))
    else
        _diff_f1_rx=$((_d_ipa_rx - _d_at_f1))
    fi
    if [ "$_d_at_f2" -ge "$_d_ipa_rx" ]; then
        _diff_f2_rx=$((_d_at_f2 - _d_ipa_rx))
    else
        _diff_f2_rx=$((_d_ipa_rx - _d_at_f2))
    fi

    if [ "$_diff_f2_rx" -lt "$_diff_f1_rx" ]; then
        du_orientation="tx,rx"   # field 1 = TX, field 2 = RX (Quectel-public)
    else
        du_orientation="rx,tx"   # field 1 = RX, field 2 = TX (user's firmware)
    fi
    du_orientation_calibrated=true

    qlog_info "data_used: orientation locked to '${du_orientation}' (ipa_rx_d=${_d_ipa_rx} at_f1_d=${_d_at_f1} at_f2_d=${_d_at_f2})"
    append_event "data_calibration_done" \
        "Data counter calibrated — 1 MB used to detect field order (${du_orientation})" \
        "info"
}
```

- [ ] **Step 2: Verify the function parses under bash**

scp the poller, then:

```bash
ssh root@192.168.225.1 'bash -n /usr/bin/qmanager_poller && echo "parse OK"'
```

Expected: `parse OK`

- [ ] **Step 3: Commit**

```bash
git add scripts/usr/bin/qmanager_poller
git commit -m "feat(poller): add calibrate_orientation function (not yet wired up)

Drives a 1 MB curl download to speed.cloudflare.com, snapshots QGDNRCNT
and /proc/net/dev rmnet_ipa0 before and after, and picks the orientation
('tx,rx' vs 'rx,tx') by proximity of each AT field's delta to the kernel
RX delta. Guards against muddy signals (concurrent upload, slow curl,
AT-read failure) by aborting cleanly and bumping the attempts counter.
After DATA_USED_MAX_CALIBRATION_ATTEMPTS, freezes at the default
orientation and emits a warn event. The happy path emits an info event
so users on metered links know about the one-time 1 MB cost."
```

---

## Task 5: Simplify counter selection — always use QGDNRCNT

**Files:**
- Modify: `scripts/usr/bin/qmanager_poller:706-832` (Step 2 through Step 8 of `update_data_used`)

- [ ] **Step 1: Replace the Step 2..Step 8 block**

The current logic switches between QGDCNT and QGDNRCNT based on `network_type` and handles mode-transition rebasing. Probe data confirmed both counters track identical bytes on the test firmware, and QGDNRCNT works across LTE-only/NSA/SA. Simplify to QGDNRCNT-only.

Replace lines 706-832 of `update_data_used` with this complete block. Note the **orientation-aware parse** at Step 3c — this is where Bug 1 actually gets fixed at runtime.

```sh
    # Step 2: always use QGDNRCNT — empirically validated as the universal
    # counter on RM520NGLAAR03A03M4G across LTE / NSA / SA. The legacy
    # QGDCNT branch and mode-transition rebase logic were removed in v0.1.10
    # after probe data showed both AT counters report identical bytes on
    # this firmware family.
    local du_active="qgdnrcnt"

    # Step 3: read /proc/net/dev rmnet_ipa0
    local ipa_rx
    local ipa_tx
    ipa_rx=0
    ipa_tx=0
    if [ -f /proc/net/dev ]; then
        local _dev_line
        _dev_line=$(grep "rmnet_ipa0:" /proc/net/dev 2>/dev/null)
        if [ -n "$_dev_line" ]; then
            ipa_rx=$(printf '%s\n' "$_dev_line" | awk '{print $2}')
            ipa_tx=$(printf '%s\n' "$_dev_line" | awk '{print $10}')
        fi
    fi
    ipa_rx="${ipa_rx:-0}"
    ipa_tx="${ipa_tx:-0}"

    # Step 3b: read the AT counter
    local _at_resp
    _at_resp=$(qcmd_exec 'AT+QGDNRCNT?')

    # Parse: +QGDNRCNT: <f1>,<f2>  (orientation applied at Step 3c)
    local _parsed
    _parsed=$(printf '%s\n' "$_at_resp" | \
        sed -n 's/^+QGDNRCNT:[[:space:]]*\([0-9]*\),\([0-9]*\).*/\1 \2/p' | \
        head -1)
    if [ -z "$_parsed" ]; then
        # AT failure — leave all state untouched; next tick will retry
        return 0
    fi

    local _f1 _f2
    _f1=$(printf '%s' "$_parsed" | awk '{print $1}')
    _f2=$(printf '%s' "$_parsed" | awk '{print $2}')

    # Step 3c: apply orientation. The default "tx,rx" matches Quectel-public
    # docs and is what most firmwares return. The "rx,tx" branch is needed
    # for firmware variants that ship QGDNRCNT with the fields swapped (e.g.
    # the user-reported case behind the v0.1.9 negative-byte bug).
    local current_tx
    local current_rx
    if [ "$du_orientation" = "rx,tx" ]; then
        current_rx="$_f1"
        current_tx="$_f2"
    else
        current_tx="$_f1"
        current_rx="$_f2"
    fi

    # First-time initialization — rebase, no accumulation this tick.
    # Catches a fresh install or post-schema-migration state where
    # prev_qgdnrcnt_* is still 0 but the modem counter is non-zero.
    if [ "$du_prev_qgdnrcnt_tx" = "0" ] && [ "$du_prev_qgdnrcnt_rx" = "0" ]; then
        du_prev_qgdnrcnt_tx="$current_tx"
        du_prev_qgdnrcnt_rx="$current_rx"
        du_prev_ipa_rx="$ipa_rx"
        du_prev_ipa_tx="$ipa_tx"
        du_selected_counter="$du_active"
        write_data_used_state
        return 0
    fi

    # Step 5: delta vs prev
    local prev_tx
    local prev_rx
    prev_tx="$du_prev_qgdnrcnt_tx"
    prev_rx="$du_prev_qgdnrcnt_rx"

    local delta_tx
    local delta_rx
    delta_tx=$((current_tx - prev_tx))
    delta_rx=$((current_rx - prev_rx))

    # Step 6: counter reset detection (negative delta — modem cleared its counter)
    if [ "$delta_tx" -lt 0 ] || [ "$delta_rx" -lt 0 ]; then
        qlog_info "data_used: modem-side reset detected (delta_rx=${delta_rx} delta_tx=${delta_tx})"
        du_modem_reset_count=$((du_modem_reset_count + 1))
        # Rebase only — no accumulation this tick
    else
        du_accumulated_rx=$((du_accumulated_rx + delta_rx))
        du_accumulated_tx=$((du_accumulated_tx + delta_tx))

        # Step 7: divergence check vs IPA kernel counter
        local ipa_drx
        local ipa_dtx
        ipa_drx=$((ipa_rx - du_prev_ipa_rx))
        ipa_dtx=$((ipa_tx - du_prev_ipa_tx))
        if [ "$ipa_drx" -lt 0 ]; then ipa_drx=0; fi
        if [ "$ipa_dtx" -lt 0 ]; then ipa_dtx=0; fi
        local ipa_total
        local at_total
        ipa_total=$((ipa_drx + ipa_dtx))
        at_total=$((delta_rx + delta_tx))
        if [ "$ipa_total" -gt "$DATA_USED_DIVERGENCE_MIN" ]; then
            local _diff
            _diff=$((at_total - ipa_total))
            if [ "$_diff" -lt 0 ]; then _diff=$((-_diff)); fi
            local _pct
            _pct=$((_diff * 100 / ipa_total))
            if [ "$_pct" -gt "$DATA_USED_DIVERGENCE_PCT" ]; then
                qlog_warn "data_used divergence at=${at_total}B ipa=${ipa_total}B (${_pct}%) mode=${network_type} counter=${du_active}"
                du_divergence_count=$((du_divergence_count + 1))
            fi
        fi
    fi

    # Step 8: update prev_* for next tick
    du_prev_qgdnrcnt_tx="$current_tx"
    du_prev_qgdnrcnt_rx="$current_rx"
    du_prev_ipa_rx="$ipa_rx"
    du_prev_ipa_tx="$ipa_tx"
    du_selected_counter="$du_active"
    du_last_update_ts=$(date +%s)
    write_data_used_state
}
```

Note: `du_modem_reset_count`, `du_mode_transition_count`, and `du_selected_counter` remain in the data-used state for backward compatibility — they're written but their values are now: mode_transition_count never increments (no transitions to detect), selected_counter always equals `"qgdnrcnt"`. Future cleanup can remove them after a second schema bump.

- [ ] **Step 2: Parse-check + smoke-test traffic accounting**

scp poller. Verify it parses, then drive a small download and confirm accumulators advance in the correct direction (this validates the simplified path *before* calibration is wired up in Task 6; default orientation `"tx,rx"` should already be correct on the test firmware).

```python
# D:\tmp\probe_simplified_path.py
import os, re, paramiko
HOST = os.environ["MODEM_IP"]; USER = os.environ["MODEM_SSH_USER"]; PWD = os.environ["MODEM_SSH_PASSWORD"]
REMOTE = r"""
set -u
bash -n /usr/bin/qmanager_poller && echo "parse OK"
systemctl restart qmanager-poller
sleep 6
echo "=== BEFORE ==="
jq '{accumulated_rx_bytes, accumulated_tx_bytes, orientation}' /usrdata/qmanager/data_used.json
echo
echo "=== driving 20 MB download ==="
curl -sS --max-time 30 -o /dev/null -w 'dl=%{size_download}\n' \
    https://speed.cloudflare.com/__down?bytes=20971520
sleep 8
echo "=== AFTER ==="
jq '{accumulated_rx_bytes, accumulated_tx_bytes, orientation}' /usrdata/qmanager/data_used.json
"""
cli = paramiko.SSHClient(); cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(HOST, username=USER, password=PWD, timeout=10, look_for_keys=False, allow_agent=False)
_, out, _ = cli.exec_command(REMOTE, timeout=90)
print(out.read().decode())
cli.close()
```

Expected:
- `parse OK`
- `accumulated_rx_bytes` increased by ~20 MB
- `accumulated_tx_bytes` increased by < 200 KB (TCP ACKs only)
- `orientation` still `"tx,rx"` (calibration not yet wired up)

- [ ] **Step 3: Commit**

```bash
git add scripts/usr/bin/qmanager_poller
git commit -m "refactor(poller): always use QGDNRCNT; apply orientation in parse step

Removes the LTE->QGDCNT / 5G->QGDNRCNT branching from update_data_used()
based on probe data showing both AT counters are aliased and report
identical bytes on RM520NGLAAR03A03M4G. QGDNRCNT was also verified to
track LTE-only traffic correctly (probe_lte_only.py), so it is safe as
the universal counter on this firmware family.

Field assignment now respects du_orientation: 'tx,rx' (default, matches
Quectel-public docs) or 'rx,tx' (user-reported firmware variant). The
calibration that populates du_orientation lands in the next commit.

Mode-transition rebase logic is removed (there's nothing to transition
between with a single counter). du_mode_transition_count, du_selected_counter,
and the LTE-specific prev fields remain in persisted state for backward
compatibility; a future schema bump can drop them."
```

---

## Task 6: Wire calibration into `update_data_used` and clear-on-reset

**Files:**
- Modify: `scripts/usr/bin/qmanager_poller:697-704` (Step 1: reset-flag handler) — clear orientation on reset
- Modify: `scripts/usr/bin/qmanager_poller` — call `calibrate_orientation` once per tick gated on `!calibrated`

- [ ] **Step 1: Extend reset handler to clear orientation**

Replace the existing Step 1 block (currently lines 697-704):

```sh
    # Step 1: honor user reset flag
    if [ -f "$DATA_USED_RESET_FLAG" ]; then
        du_accumulated_rx=0
        du_accumulated_tx=0
        du_last_reset_ts=$(date +%s)
        rm -f "$DATA_USED_RESET_FLAG"
        qlog_info "data_used: user reset triggered"
    fi
```

With:

```sh
    # Step 1: honor user reset flag
    if [ -f "$DATA_USED_RESET_FLAG" ]; then
        du_accumulated_rx=0
        du_accumulated_tx=0
        du_last_reset_ts=$(date +%s)
        # Also clear orientation calibration — user expects a "full reset",
        # and the calibration will re-run automatically next time we have
        # connectivity (cheap one-time 1 MB).
        du_orientation_calibrated=false
        du_orientation_attempts=0
        rm -f "$DATA_USED_RESET_FLAG"
        qlog_info "data_used: user reset triggered (counters zeroed + orientation cleared)"
    fi
```

- [ ] **Step 2: Add calibration call after reset handler, before counter selection**

Immediately after the Step 1 block, before Step 2 (the `local du_active="qgdnrcnt"` line from Task 5), add:

```sh
    # Step 1b: run orientation calibration if not yet done.
    # calibrate_orientation handles its own guards (connectivity, attempt cap)
    # and is cheap (~50 ms) when those guards short-circuit it.
    if [ "$du_orientation_calibrated" = "false" ]; then
        calibrate_orientation
    fi
```

- [ ] **Step 3: End-to-end calibration probe**

```python
# D:\tmp\probe_calibration_e2e.py
import os, paramiko
HOST = os.environ["MODEM_IP"]; USER = os.environ["MODEM_SSH_USER"]; PWD = os.environ["MODEM_SSH_PASSWORD"]
REMOTE = r"""
set -u
echo "=== reset state to force calibration ==="
systemctl stop qmanager-poller
rm -f /usrdata/qmanager/data_used.json
systemctl start qmanager-poller

# Give the poller time to (a) initialise, (b) get connectivity confirmation
# from qmanager_ping, (c) run a calibration tick.
sleep 20

echo "=== post-calibration state ==="
jq '{schema, orientation, orientation_calibrated, orientation_attempts, accumulated_rx_bytes, accumulated_tx_bytes}' /usrdata/qmanager/data_used.json
echo
echo "=== events log (last 5) ==="
tail -n 5 /tmp/qmanager_events.json 2>/dev/null | jq -c '.'
echo
echo "=== calibration log lines ==="
journalctl -u qmanager-poller --since '30 seconds ago' --no-pager | grep -i 'data_used.*calib\|data_used.*orientation' | head -10
"""
cli = paramiko.SSHClient(); cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(HOST, username=USER, password=PWD, timeout=10, look_for_keys=False, allow_agent=False)
_, out, _ = cli.exec_command(REMOTE, timeout=90)
print(out.read().decode())
cli.close()
```

Run: `set -a; . .env; set +a; python D:/tmp/probe_calibration_e2e.py`

Expected:
- `orientation_calibrated: true`
- `orientation: "tx,rx"` (on the test firmware)
- `orientation_attempts: 1`
- Event log shows `data_calibration_done` with severity `info`
- Log lines show `data_used: calibration attempt 1/10` and `data_used: orientation locked to 'tx,rx'`

- [ ] **Step 4: Test reset triggers re-calibration**

After the e2e probe succeeds:

```bash
ssh root@192.168.225.1 'touch /tmp/qmanager_data_used_reset; sleep 5; jq "{orientation_calibrated, accumulated_rx_bytes}" /usrdata/qmanager/data_used.json'
```

Expected immediately after reset: `orientation_calibrated: false, accumulated_rx_bytes: 0`.

Then wait ~15s and check again — calibration should re-run and `orientation_calibrated` flip back to `true`.

- [ ] **Step 5: Commit**

```bash
git add scripts/usr/bin/qmanager_poller
git commit -m "feat(poller): wire orientation calibration into update_data_used tick

Calls calibrate_orientation() at the top of each tick when
du_orientation_calibrated is false. The function handles its own
connectivity and attempt-cap guards, so unconditional invocation is safe.

Also extends the reset-flag handler to clear du_orientation_calibrated +
du_orientation_attempts, so a user reset triggers a fresh calibration on
the next tick that has internet."
```

---

## Task 7: Emit orientation fields in the status cache JSON

**Files:**
- Modify: `scripts/usr/bin/qmanager_poller:1921-1930` (`data_used:` jq object in the main status-cache write)

- [ ] **Step 1: Find the existing `data_used:` block in the status-cache write**

It's currently lines 1921-1930. Locate the corresponding `--argjson du_acc_rx` / `--argjson du_acc_tx` declarations above (search for `du_acc_rx` to find them).

- [ ] **Step 2: Add new `--arg` / `--argjson` declarations for the orientation fields**

In the jq invocation that builds the main status cache (around line 1800-1920), find the existing block of data_used-related `--arg` / `--argjson` declarations and add three new ones. They should be siblings of the existing `--arg du_sel`:

```sh
        --arg     du_orient   "$du_orientation" \
        --argjson du_orient_cal "$du_orientation_calibrated" \
        --argjson du_orient_att "$du_orientation_attempts" \
```

- [ ] **Step 3: Extend the `data_used:` object literal**

Replace lines 1921-1930 (the `data_used: { … },` block) with:

```sh
            data_used: {
                accumulated_rx_bytes: $du_acc_rx,
                accumulated_tx_bytes: $du_acc_tx,
                selected_counter:     $du_sel,
                last_update_ts:       $du_last_upd,
                last_reset_ts:        $du_last_rst,
                divergence_count:     $du_div,
                modem_reset_count:    $du_modem_rst,
                mode_transition_count: $du_mode_xn,
                orientation:          $du_orient,
                orientation_calibrated: $du_orient_cal,
                orientation_attempts: $du_orient_att
            },
```

- [ ] **Step 4: Verify the new fields surface through the CGI**

```bash
ssh root@192.168.225.1 'curl -s --unix-socket none http://localhost/cgi-bin/quecmanager/network/data_used.sh -H "Cookie: $(cat /tmp/some_session 2>/dev/null)" 2>/dev/null || jq ".data_used" /tmp/qmanager_status.json'
```

Easier: just check the on-disk status cache directly:

```bash
ssh root@192.168.225.1 'jq ".data_used" /tmp/qmanager_status.json'
```

Expected output includes all three new fields:

```json
{
  "accumulated_rx_bytes": ...,
  "accumulated_tx_bytes": ...,
  "selected_counter": "qgdnrcnt",
  "last_update_ts": ...,
  "last_reset_ts": ...,
  "divergence_count": 0,
  "modem_reset_count": 0,
  "mode_transition_count": 0,
  "orientation": "tx,rx",
  "orientation_calibrated": true,
  "orientation_attempts": 1
}
```

- [ ] **Step 5: Commit**

```bash
git add scripts/usr/bin/qmanager_poller
git commit -m "feat(poller): emit orientation fields in status cache .data_used

Surfaces du_orientation, du_orientation_calibrated, and du_orientation_attempts
through /tmp/qmanager_status.json so the frontend (via the existing
data_used.sh CGI which already passes the .data_used block through with
jq) can render calibration state without any CGI changes."
```

---

## Task 8: Frontend types — extend `DataUsedBlock` and clamp `formatBytes`

**Files:**
- Modify: `types/modem-status.ts:258-291` (`DataUsedBlock` interface)
- Modify: `types/modem-status.ts:674-685` (`formatBytes` function)

- [ ] **Step 1: Extend `DataUsedBlock` interface**

Replace lines 258-291 (the existing `DataUsedBlock` interface and its docstring) with:

```ts
/**
 * Persistent data-usage counter maintained by the poller across modem reboots
 * and interface flaps. Sourced from AT+QGDNRCNT with a per-install orientation
 * calibration that detects the firmware-specific field order.
 * Served by /cgi-bin/quecmanager/network/data_used.sh
 */
export interface DataUsedBlock {
  /** Cumulative received bytes (persisted across reboots) */
  accumulated_rx_bytes: number;
  /** Cumulative transmitted bytes (persisted across reboots) */
  accumulated_tx_bytes: number;
  /**
   * Which AT counter the poller is currently using.
   * Always "qgdnrcnt" since v0.1.10 — preserved for backward compatibility.
   */
  selected_counter: string;
  /** Unix epoch (seconds) of the last poller write to this block */
  last_update_ts: number;
  /**
   * Unix epoch (seconds) of the last user-triggered reset.
   * 0 means never reset (fresh install).
   */
  last_reset_ts: number;
  /** Number of times the poller detected a counter divergence */
  divergence_count: number;
  /** Number of times the modem has been reset since the last user reset */
  modem_reset_count: number;
  /**
   * Number of LTE↔5G mode transitions. Always 0 since v0.1.10 — preserved
   * for backward compatibility with the v0.1.9 schema.
   */
  mode_transition_count: number;
  /**
   * Field order the poller uses to parse +QGDNRCNT responses.
   * "tx,rx" (Quectel-public default) or "rx,tx" (some firmware variants).
   * Locked by a one-time download calibration on first install / reset.
   */
  orientation: "tx,rx" | "rx,tx";
  /**
   * True once the calibration has successfully detected (or given up and
   * defaulted) the field order. Until true, the poller may be using the
   * default "tx,rx" orientation which is correct for most firmwares.
   */
  orientation_calibrated: boolean;
  /**
   * Number of calibration attempts so far. Capped server-side at 10; past
   * the cap the poller freezes at the default orientation and emits a
   * `data_calibration_failed` event.
   */
  orientation_attempts: number;
  /**
   * True when the poller has not updated this block recently (cache is stale).
   * CGI sets this flag when the on-disk file is older than expected.
   */
  stale: boolean;
}
```

- [ ] **Step 2: Clamp negative bytes in `formatBytes`**

Replace lines 674-685 of `types/modem-status.ts` (the `formatBytes` function) with:

```ts
export function formatBytes(bytes: number): string {
  // Defense in depth — a negative value would slip through every magnitude
  // branch below and render as raw "-12345 B". Clamp to 0 so any future
  // counter wrap (or fresh post-reset state) renders cleanly. See the
  // BusyBox-sh overflow fix in qmanager_poller for the original case that
  // produced negatives in v0.1.9.
  if (bytes < 0) return "0 B";
  if (bytes >= 1_073_741_824) {
    return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  }
  if (bytes >= 1_048_576) {
    return `${(bytes / 1_048_576).toFixed(1)} MB`;
  }
  if (bytes >= 1_024) {
    return `${(bytes / 1_024).toFixed(0)} KB`;
  }
  return `${bytes} B`;
}
```

- [ ] **Step 3: Type-check the project**

Run from repo root:

```bash
bunx tsc --noEmit
```

Expected: clean exit (no type errors). If the frontend reads a `DataUsedBlock` field that the new interface omits, this will catch it.

- [ ] **Step 4: Smoke-test the dashboard renders correctly**

Start the dev server and open the home dashboard. Verify:
- Data Used row shows two non-negative byte values (e.g. `0 B` initially after schema migration)
- No console errors

```bash
bun dev
```

Open `http://localhost:3000` (or the port bun reports) in a browser, log in, navigate to the home dashboard, verify the Data Used row renders without errors.

- [ ] **Step 5: Commit**

```bash
git add types/modem-status.ts
git commit -m "feat(types): extend DataUsedBlock with orientation fields; clamp formatBytes negatives

DataUsedBlock now exposes orientation ('tx,rx' | 'rx,tx'),
orientation_calibrated, and orientation_attempts — emitted by the poller
in v0.1.10 to reflect the per-install field-order calibration.

formatBytes() clamps negatives to '0 B' as defense in depth — the actual
fix for the negative-byte bug is in the poller (shebang flip from sh to
bash gives 64-bit arithmetic), but a frontend clamp prevents any future
counter wrap from rendering as raw '-NNN B'."
```

---

## Task 9: Documentation — release notes + CLAUDE.md

**Files:**
- Modify: `RELEASE_NOTES.md:1-10` (v0.1.10-draft body)
- Modify: `CLAUDE.md` — add a paragraph to the existing data-usage discussion

- [ ] **Step 1: Add a Fixes section to RELEASE_NOTES.md**

Insert this section in `RELEASE_NOTES.md` immediately after line 3 (after the OTA upgrade hint, before `## 🛠️ Improvements`):

```markdown
## 🐛 Fixes

- **Data Used counter no longer reports negative or swapped upload/download values.** Two bugs combined to produce screenshots like "Download 271.9 MB / Upload -772994965 B" on 5G-SA users in v0.1.9: the `+QGDNRCNT` AT counter returns its fields in a firmware-specific order (some Quectel firmwares ship it reversed vs `+QGDCNT`), and the poller's shell arithmetic was wrapping at 2.15 GB on BusyBox `sh`. Both are fixed: the poller now runs under bash for 64-bit arithmetic, and on first run (or after a counter reset) it performs a one-time **1 MB calibration download** to detect the correct field order and locks it for the lifetime of the install. The calibration emits an event to the dashboard's event log so the metered-data cost is transparent. Existing users will see their counter reset to zero on upgrade — this is intentional and heals any corrupted accumulated values from v0.1.9.
```

- [ ] **Step 2: Add design context to CLAUDE.md**

Add this paragraph at the end of the file (right before the start of any "RM520N-GL Variant" section if present, or as a new section):

```markdown
### Data Usage Counter (Bug 1 + Bug 2 fix in v0.1.10)

The persistent data-usage counter in `qmanager_poller` (`/usrdata/qmanager/data_used.json`) uses `AT+QGDNRCNT` as the single source of truth across LTE, NSA, and SA — empirically verified to track all RAT traffic identically on `RM520NGLAAR03A03M4G`. **Field order in `+QGDNRCNT` is firmware-specific**: Quectel-public docs say `<TX>,<RX>` (which AAR03A03 follows), but at least one user-reported firmware returns the fields reversed. The poller resolves this at runtime with a one-time **active calibration**: it drives a 1 MB curl download to `speed.cloudflare.com/__down?bytes=1048576`, snapshots the AT counter + `/proc/net/dev rmnet_ipa0` before and after, and locks `du_orientation` to whichever AT field grew in lockstep with the kernel's RX delta. The orientation is persisted to `data_used.json` and never re-evaluated except on user-triggered reset. Calibration is gated on `conn_internet_available == "true"` and capped at 10 attempts; past the cap, it freezes at the Quectel-public default `"tx,rx"` and emits a `data_calibration_failed` event. **The poller's shebang must remain `#!/bin/bash`** — BusyBox `sh` uses 32-bit signed `long` for `$(( ))` and `-lt`, which wraps the cumulative accumulator to negative once it crosses 2.15 GB. Bash 3.2 on this platform uses 64-bit `intmax_t`. The same constraint applies to any other script accumulating byte volumes across reboots.
```

- [ ] **Step 3: Commit**

```bash
git add RELEASE_NOTES.md CLAUDE.md
git commit -m "docs: announce data-usage counter fixes (orientation + arithmetic) in v0.1.10

Adds a Fixes section to RELEASE_NOTES.md explaining the negative-byte bug,
the one-time 1 MB calibration cost, and that the counter resets on upgrade.

Adds a Data Usage Counter section to CLAUDE.md documenting the orientation
calibration design and the bash-shebang requirement."
```

---

## Task 10: End-to-end regression sweep

**Files:** none modified — verification only.

- [ ] **Step 1: Simulate the user's firmware-variant case**

We can't change the test modem's firmware to return reversed fields, but we can verify the calibrator handles `"rx,tx"` correctly by temporarily patching the parser to swap fields. SCP the poller to `/tmp/qmanager_poller_inverted` with a one-line edit (swap field assignment in Step 3c so f1→rx, f2→tx), restart against that, and run the e2e probe. Calibration should detect `orientation = "rx,tx"` and accumulated_rx/tx should track real traffic correctly.

After verification, scp the unedited poller back and restart. This step exists only to prove the orientation branch works — no commit needed.

- [ ] **Step 2: Driven traffic test with calibrated state**

After end-to-end calibration succeeds (Task 6 probe), drive 100 MB download + 50 MB upload and confirm:

```python
# D:\tmp\probe_regression.py — drives traffic and checks accumulators move correctly
import os, paramiko
HOST = os.environ["MODEM_IP"]; USER = os.environ["MODEM_SSH_USER"]; PWD = os.environ["MODEM_SSH_PASSWORD"]
REMOTE = r"""
set -u
echo "=== before ==="
jq '{accumulated_rx_bytes, accumulated_tx_bytes, orientation}' /usrdata/qmanager/data_used.json
echo
echo "=== driving 100 MB download ==="
curl -sS --max-time 60 -o /dev/null -w 'dl=%{size_download}\n' \
    https://speed.cloudflare.com/__down?bytes=104857600
sleep 4
echo "=== mid (after DL) ==="
jq '{accumulated_rx_bytes, accumulated_tx_bytes}' /usrdata/qmanager/data_used.json
echo
echo "=== driving 50 MB upload ==="
dd if=/dev/zero bs=1M count=50 2>/dev/null | \
    curl -sS --max-time 60 -X POST --data-binary @- \
        -o /dev/null -w 'up=%{size_upload}\n' \
        https://speed.cloudflare.com/__up
sleep 4
echo "=== after (final) ==="
jq '{accumulated_rx_bytes, accumulated_tx_bytes}' /usrdata/qmanager/data_used.json
"""
cli = paramiko.SSHClient(); cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(HOST, username=USER, password=PWD, timeout=10, look_for_keys=False, allow_agent=False)
_, out, _ = cli.exec_command(REMOTE, timeout=200)
print(out.read().decode())
cli.close()
```

Expected progression:
- Before: small values (post-calibration baseline)
- Mid: `accumulated_rx_bytes` increased by ~100 MB, `accumulated_tx_bytes` small delta
- After: `accumulated_tx_bytes` increased by ~50 MB from mid

If accumulated_rx and accumulated_tx are swapped at any point, calibration is broken.

- [ ] **Step 3: Bash-shebang regression — confirm no parser errors over 10 minutes of operation**

```bash
ssh root@192.168.225.1 'journalctl -fu qmanager-poller --since "10 minutes ago" --no-pager 2>/dev/null | grep -iE "error|syntax|unexpected|bad sub" | head -20'
```

Expected: empty output (no shell parser errors in the last 10 minutes).

- [ ] **Step 4: Final cross-page UI smoke**

In a browser:
- Home dashboard → Device Metrics card → Data Used row shows two non-negative byte values formatted as `B`/`KB`/`MB`/`GB`.
- Open dev tools network tab, watch `/cgi-bin/quecmanager/network/data_used.sh` responses — verify they include `orientation`, `orientation_calibrated`, `orientation_attempts`.
- Click the reset button → confirm dialog → confirm → verify the row drops to `0 B / 0 B` within ~5 s.
- Wait ~15 s and inspect the response again — `orientation_calibrated` should flip back to `true` once recalibration completes.

- [ ] **Step 5: Done — push the branch and open the PR**

```bash
git push -u origin <branch-name>
gh pr create --title "fix(data-used): orientation calibration + 32-bit overflow" --body "$(cat <<'EOF'
## Summary
- Adds a one-time 1 MB curl download calibration on first install / counter reset to detect firmware-specific QGDNRCNT field order (`tx,rx` vs `rx,tx`).
- Flips poller shebang `#!/bin/sh` → `#!/bin/bash` for 64-bit arithmetic — fixes the 2.15 GB negative-bytes wrap.
- Schema bump v1 → v2 heals affected v0.1.9 users on upgrade by zeroing accumulators.
- Frontend: `formatBytes` clamps negatives to `0 B` as defense in depth.

## Test plan
- [x] Schema migration: pre-seed schema=1 + negative accumulator → reset cleanly on first poller tick
- [x] Calibration: fresh state + connectivity → orientation locks within ~15 s, event emitted
- [x] Reset flow: reset flag clears orientation, recalibration runs, counters re-zero
- [x] Driven traffic: 100 MB DL + 50 MB UL → accumulators advance in correct direction
- [x] Inverted-firmware simulation: parser swap → calibration detects `rx,tx` correctly
- [x] 10-minute soak under bash: no parser errors in journalctl
EOF
)"
```

---

## Self-Review

**Spec coverage check:**

| Requirement | Task |
|---|---|
| Use QGDNRCNT as universal counter | Task 5 |
| One-time calibration on first install | Task 4, wired in Task 6 |
| Trigger calibration on reset too | Task 6 (Step 1) |
| Curl 1 MB to Cloudflare | Task 4 (`DATA_USED_CALIBRATION_URL`) |
| Connectivity gate | Task 4 (`conn_internet_available` check) |
| 10-attempt cap, freeze at default | Task 4 (cap branch at function top) |
| Emit info event on success | Task 4 (`append_event "data_calibration_done"`) |
| Emit warn event on cap exhaustion | Task 4 (cap branch) |
| Shebang flip to bash | Task 1 |
| Schema bump 1→2 with state reset | Task 1 (constant), Task 3 (migration) |
| Frontend `formatBytes` clamp negatives to `0 B` | Task 8 |
| Frontend type extensions | Task 8 |
| CGI passthrough (no edit required) | Documented in File Structure section |
| Release notes + CLAUDE.md | Task 9 |

All spec requirements have a task. No gaps.

**Placeholder scan:** No TBD, no "implement later", no "similar to Task N" without inlined code, no "add appropriate error handling". Every code block is complete.

**Type / name consistency:**
- `du_orientation` / `du_orientation_calibrated` / `du_orientation_attempts` — used consistently across Tasks 2, 4, 6, 7, 8.
- `DATA_USED_MAX_CALIBRATION_ATTEMPTS` / `DATA_USED_CALIBRATION_SIZE` / `DATA_USED_CALIBRATION_URL` — defined in Task 2, used in Task 4.
- JSON keys (`orientation`, `orientation_calibrated`, `orientation_attempts`) match TypeScript field names in Task 8.
- `calibrate_orientation` function name matches its call site in Task 6 Step 2.
- `append_event` event types (`data_calibration_done`, `data_calibration_failed`) are referenced consistently in Tasks 4 and 9.
