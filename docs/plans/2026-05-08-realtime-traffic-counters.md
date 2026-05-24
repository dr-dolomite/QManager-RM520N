# Real-Time Cellular Traffic Counters Implementation Plan

> **Status: Superseded — Live Traffic feature removed in the 2026-05-24 release.** Kept as a historical record of the implementation that shipped and was later removed. The `qmanager_traffic` daemon, `fetch_traffic.sh` CGI, and `useTrafficStream` hook no longer exist. See [`../reference/data-counter-platform-matrix.md`](../reference/data-counter-platform-matrix.md) for why per-second `/proc/net/dev` reads cannot see IPA fast-path forwarded traffic.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Data Used" cumulative-totals row above "Live Traffic" in the Device Metrics card, and make the live speed update at 1 Hz end-to-end via a new `/proc/net/dev` side-channel daemon.

**Architecture:** Dedicated `qmanager_traffic` systemd daemon (modeled on `qmanager_ping`) reads `/proc/net/dev` every 1 s, atomically writes `/tmp/qmanager_traffic.json`. New `fetch_traffic.sh` CGI exposes that file. New `useTrafficStream` hook polls the CGI at 1 s. The Device Metrics card consumes both the existing `useModemStatus` cache (slow fallback) and the new stream (fast path).

**Tech Stack:** POSIX shell (BusyBox-compatible), `awk`, `jq`, lighttpd CGI, React 19 + TypeScript, Next.js 15, shadcn/ui, Tabler icons.

**Spec:** `docs/specs/realtime-traffic-counters.md`

---

## File Map

**Create:**
- `scripts/usr/bin/qmanager_traffic` — daemon (POSIX sh, executable)
- `scripts/etc/systemd/system/qmanager-traffic.service` — systemd unit
- `scripts/www/cgi-bin/quecmanager/at_cmd/fetch_traffic.sh` — CGI endpoint
- `hooks/use-traffic-stream.ts` — React hook

**Modify:**
- `types/modem-status.ts` — add `TrafficStream` interface
- `components/dashboard/device-metrics.tsx` — add Data Used row, route Live Traffic speed through stream with cache fallback, add `trafficStream` prop
- `components/dashboard/home-component.tsx` — call `useTrafficStream`, pass `trafficStream` to `DeviceMetricsComponent`

**Untouched (verified):**
- `scripts/install_rm520n.sh` — already iterates `$SRC_SCRIPTS/etc/systemd/system/qmanager*.service` (line 849) and `$SRC_SCRIPTS/usr/bin/*` (line 805) and globs `qmanager-*.service` for enable (line 1113). Dropping new files into the right source dirs is sufficient.
- `scripts/usr/bin/qmanager_poller` — keeps doing its own `/proc/net/dev` read as a slow-cache fallback path. Unrelated to this work.

---

## Conventions

- **Line endings:** All files written from Windows must end up LF, never CRLF. The installer strips `\r` from shell scripts (per CLAUDE.md), but commit them clean. The repo's `.gitattributes` already handles `eol=lf` for shell scripts.
- **Atomic writes:** Daemon writes to `/tmp/qmanager_traffic.json.tmp` then `mv` — same as `qmanager_ping` (`scripts/usr/bin/qmanager_ping:130`-ish region).
- **Logging:** Source `/usr/lib/qmanager/qlog.sh` for `qlog_init`/`qlog_info`/`qlog_warn`/`qlog_error` — same defensive sourcing block as `qmanager_ping:25-32`.
- **Lock-freedom:** No `flock`, no AT calls. Daemon must never touch `/dev/smd11` or `/tmp/qmanager_at.lock`.
- **Tools:** `awk`, `cat`, `date`, `mv`, `jq`. All available on BusyBox + Entware.

---

## Task 1: Add `TrafficStream` type to types

**Files:**
- Modify: `types/modem-status.ts` (insert near existing `TrafficStatus` interface around line 244-254)

- [ ] **Step 1: Locate insertion point**

Run: `grep -n "TrafficStatus" types/modem-status.ts`
Expected: a line like `246:export interface TrafficStatus {` and references to its fields. Note the line range so the new interface is placed adjacent.

- [ ] **Step 2: Add `TrafficStream` interface immediately below `TrafficStatus`**

Open `types/modem-status.ts`. Locate the closing `}` of `export interface TrafficStatus`. Insert immediately after it:

```ts
/**
 * Live cellular traffic stream from `qmanager_traffic` daemon.
 * Sourced from `/proc/net/dev` at 1 Hz, independent of the 2 s poller cache.
 * `iface` is `null` when neither rmnet candidate is up.
 * `stale` is set by the CGI when the on-disk file is older than 5 s.
 */
export interface TrafficStream {
  /** Unix epoch seconds when the daemon wrote this snapshot */
  ts: number;
  /** Active cellular interface name, or null when none is up */
  iface: string | null;
  /** Cumulative RX bytes since interface bringup (modem boot) */
  total_rx_bytes: number;
  /** Cumulative TX bytes since interface bringup (modem boot) */
  total_tx_bytes: number;
  /** Current download speed in bytes/sec, computed from a 1 s delta */
  rx_bytes_per_sec: number;
  /** Current upload speed in bytes/sec, computed from a 1 s delta */
  tx_bytes_per_sec: number;
  /** True when the on-disk file is older than 5 s (daemon stuck or stopped) */
  stale?: boolean;
}
```

- [ ] **Step 3: Type-check**

Run: `bunx tsc --noEmit`
Expected: PASS (no errors). The new exported type has no consumers yet, so no diagnostics about unused types should fire (tsc doesn't warn on unused exports).

- [ ] **Step 4: Commit**

```bash
git add types/modem-status.ts
git commit -m "types: add TrafficStream interface for live cellular counters"
```

---

## Task 2: Implement `qmanager_traffic` daemon

**Files:**
- Create: `scripts/usr/bin/qmanager_traffic`

- [ ] **Step 1: Write the daemon**

Create `scripts/usr/bin/qmanager_traffic` with the following content. **POSIX `sh` only** (no bashisms — runs under BusyBox `/bin/sh`):

```sh
#!/bin/sh
# =============================================================================
# qmanager_traffic — QManager Live Traffic Counter Daemon
# =============================================================================
# Reads /proc/net/dev every 1 s for the active cellular rmnet interface and
# writes a slim JSON snapshot to /tmp/qmanager_traffic.json. Decoupled from
# qmanager_poller so the dashboard can render speed at 1 Hz without waiting on
# the AT-bound 2 s tier.
#
# Active-interface selection (per tick):
#   1. Prefer $NETWORK_IFACE (rmnet_ipa0 on RM520N-GL).
#   2. If operstate != up, try rmnet_data0.
#   3. If neither up, emit iface=null with zeroed counters.
#
# Counter-reset handling: a negative delta (modem SSR re-created the iface)
# causes one zero tick and reseeds the baseline.
#
# Install location: /usr/bin/qmanager_traffic
# Dependencies: awk, cat, date, mv, jq
# =============================================================================

# --- Logging -----------------------------------------------------------------
. /usr/lib/qmanager/qlog.sh 2>/dev/null || {
    qlog_init() { :; }
    qlog_debug() { :; }
    qlog_info() { :; }
    qlog_warn() { :; }
    qlog_error() { :; }
}
qlog_init "traffic"

# --- Configuration -----------------------------------------------------------
INTERVAL=1
PRIMARY_IFACE="${NETWORK_IFACE:-rmnet_ipa0}"
FALLBACK_IFACE="rmnet_data0"
CACHE_FILE="/tmp/qmanager_traffic.json"
CACHE_TMP="/tmp/qmanager_traffic.json.tmp"

# Platform gate: on non-Quectel hosts (e.g. dev OpenWRT), default the fallback
# off so we don't churn looking for non-existent rmnets.
if [ ! -f /etc/quectel-project-version ]; then
    PRIMARY_IFACE="${NETWORK_IFACE:-wwan0}"
    FALLBACK_IFACE=""
fi

# --- State -------------------------------------------------------------------
prev_iface=""
prev_rx=0
prev_tx=0
prev_ts=0

# --- Helpers -----------------------------------------------------------------

# pick_iface — echo the iface to read this tick, or empty if none up
pick_iface() {
    if [ -r "/sys/class/net/$PRIMARY_IFACE/operstate" ]; then
        if [ "$(cat "/sys/class/net/$PRIMARY_IFACE/operstate" 2>/dev/null)" = "up" ]; then
            echo "$PRIMARY_IFACE"
            return
        fi
    fi
    if [ -n "$FALLBACK_IFACE" ] && [ -r "/sys/class/net/$FALLBACK_IFACE/operstate" ]; then
        if [ "$(cat "/sys/class/net/$FALLBACK_IFACE/operstate" 2>/dev/null)" = "up" ]; then
            echo "$FALLBACK_IFACE"
            return
        fi
    fi
    echo ""
}

# read_counters <iface> — echo "rx tx" or "0 0" on miss
read_counters() {
    local iface="$1"
    awk -v ifn="${iface}:" '$1 == ifn { print $2, $10; found=1; exit }
                            END { if (!found) print "0 0" }' /proc/net/dev 2>/dev/null
}

# write_cache <iface_or_empty> <rx> <tx> <rx_per_sec> <tx_per_sec>
write_cache() {
    local iface="$1" rx="$2" tx="$3" rxps="$4" txps="$5"
    local ts iface_arg
    ts=$(date +%s)
    if [ -z "$iface" ]; then
        iface_arg="null"
        # jq null-arg pattern
        jq -n \
            --argjson ts "$ts" \
            --argjson trx "$rx" --argjson ttx "$tx" \
            --argjson rxps "$rxps" --argjson txps "$txps" \
            '{ ts: $ts, iface: null,
               total_rx_bytes: $trx, total_tx_bytes: $ttx,
               rx_bytes_per_sec: $rxps, tx_bytes_per_sec: $txps }' \
            > "$CACHE_TMP" && mv "$CACHE_TMP" "$CACHE_FILE"
    else
        jq -n \
            --argjson ts "$ts" \
            --arg iface "$iface" \
            --argjson trx "$rx" --argjson ttx "$tx" \
            --argjson rxps "$rxps" --argjson txps "$txps" \
            '{ ts: $ts, iface: $iface,
               total_rx_bytes: $trx, total_tx_bytes: $ttx,
               rx_bytes_per_sec: $rxps, tx_bytes_per_sec: $txps }' \
            > "$CACHE_TMP" && mv "$CACHE_TMP" "$CACHE_FILE"
    fi
}

# --- Main loop ---------------------------------------------------------------
qlog_info "traffic daemon started (primary=$PRIMARY_IFACE fallback=${FALLBACK_IFACE:-none} interval=${INTERVAL}s)"

while :; do
    iface=$(pick_iface)

    if [ -z "$iface" ]; then
        write_cache "" 0 0 0 0
        prev_iface=""
        prev_rx=0
        prev_tx=0
        prev_ts=0
        sleep "$INTERVAL"
        continue
    fi

    set -- $(read_counters "$iface")
    rx="$1"
    tx="$2"
    now_ts=$(date +%s)

    rxps=0
    txps=0

    # Compute deltas only when iface is unchanged AND we have a prior baseline.
    # On iface change or first run, just seed the baseline.
    if [ "$iface" = "$prev_iface" ] && [ "$prev_ts" -gt 0 ]; then
        elapsed=$((now_ts - prev_ts))
        [ "$elapsed" -lt 1 ] && elapsed=1

        d_rx=$((rx - prev_rx))
        d_tx=$((tx - prev_tx))

        # Negative delta = counter reset (SSR / iface bounce). Emit 0 this tick.
        [ "$d_rx" -lt 0 ] && d_rx=0
        [ "$d_tx" -lt 0 ] && d_tx=0

        rxps=$((d_rx / elapsed))
        txps=$((d_tx / elapsed))
    fi

    write_cache "$iface" "$rx" "$tx" "$rxps" "$txps"

    prev_iface="$iface"
    prev_rx="$rx"
    prev_tx="$tx"
    prev_ts="$now_ts"

    sleep "$INTERVAL"
done
```

- [ ] **Step 2: Make executable**

Run: `chmod +x scripts/usr/bin/qmanager_traffic`
Expected: no output; `ls -l` shows `-rwxr-xr-x`.

- [ ] **Step 3: Lint with shellcheck (if available)**

Run: `shellcheck -s sh scripts/usr/bin/qmanager_traffic`
Expected: no errors. (If shellcheck isn't installed, skip — the installer/runtime is the authority on this platform.)

- [ ] **Step 4: Smoke-test on a Linux host (dev box, not necessarily target)**

This validates the script parses and runs. The iface won't exist on a dev laptop, so it should pick `iface=""` and emit zeros every second.

Run: `INTERVAL=1 NETWORK_IFACE=lo /bin/sh scripts/usr/bin/qmanager_traffic &`
Wait 3 s.
Run: `cat /tmp/qmanager_traffic.json | jq .`
Expected output shape (numbers may differ for `lo` if it's actually up):
```json
{
  "ts": 1715200123,
  "iface": "lo",
  "total_rx_bytes": <number>,
  "total_tx_bytes": <number>,
  "rx_bytes_per_sec": 0,
  "tx_bytes_per_sec": 0
}
```
Run: `kill %1` and `rm /tmp/qmanager_traffic.json /tmp/qmanager_traffic.json.tmp 2>/dev/null` to clean up.

- [ ] **Step 5: Commit**

```bash
git add scripts/usr/bin/qmanager_traffic
git commit -m "feat(traffic): add qmanager_traffic 1Hz /proc/net/dev daemon"
```

---

## Task 3: Add systemd unit

**Files:**
- Create: `scripts/etc/systemd/system/qmanager-traffic.service`

- [ ] **Step 1: Write the unit**

Create `scripts/etc/systemd/system/qmanager-traffic.service` with **LF line endings**:

```ini
# /lib/systemd/system/qmanager-traffic.service
[Unit]
Description=QManager Live Traffic Counter Daemon
After=network.target qmanager-setup.service

[Service]
Type=simple
ExecStart=/usr/bin/qmanager_traffic
EnvironmentFile=-/etc/qmanager/environment
TimeoutStopSec=10
Restart=on-failure
RestartSec=5s
StartLimitIntervalSec=3600
StartLimitBurst=5

[Install]
WantedBy=multi-user.target
```

This intentionally mirrors `qmanager-ping.service` line-for-line (other than the names) so the operations characteristics are identical.

- [ ] **Step 2: Verify it parses cleanly with `systemd-analyze` (if available locally)**

Run: `systemd-analyze verify scripts/etc/systemd/system/qmanager-traffic.service`
Expected: empty output (no warnings) on a Linux host with systemd. Skip on Windows or macOS — installer + target validation will catch any issues.

- [ ] **Step 3: Confirm installer auto-discovery**

Run: `grep -n "qmanager.*\.service" scripts/install_rm520n.sh | head -5`
Expected: confirms the loop at line ~849 (`for f in "$SRC_SCRIPTS/etc/systemd/system"/qmanager*.service`) will pick up the new unit. No installer edit is required.

- [ ] **Step 4: Commit**

```bash
git add scripts/etc/systemd/system/qmanager-traffic.service
git commit -m "feat(traffic): add qmanager-traffic systemd unit"
```

---

## Task 4: Implement `fetch_traffic.sh` CGI

**Files:**
- Create: `scripts/www/cgi-bin/quecmanager/at_cmd/fetch_traffic.sh`

- [ ] **Step 1: Write the CGI**

Create `scripts/www/cgi-bin/quecmanager/at_cmd/fetch_traffic.sh`:

```sh
#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# fetch_traffic.sh — CGI Endpoint for Live Cellular Traffic Stream
# =============================================================================
# Serves /tmp/qmanager_traffic.json (written by qmanager_traffic daemon).
# Adds a "stale" boolean if the file mtime is older than STALE_SECONDS.
# Emits a zeroed payload with stale=true if the file is missing entirely.
#
# Endpoint: GET /cgi-bin/quecmanager/at_cmd/fetch_traffic.sh
# Response: application/json
# Install location: /www/cgi-bin/quecmanager/at_cmd/fetch_traffic.sh
# =============================================================================

qlog_init "cgi_traffic"
cgi_headers
cgi_handle_options

CACHE_FILE="/tmp/qmanager_traffic.json"
STALE_SECONDS=5

now=$(date +%s)

if [ ! -f "$CACHE_FILE" ]; then
    cat << 'FALLBACK'
{
  "ts": 0,
  "iface": null,
  "total_rx_bytes": 0,
  "total_tx_bytes": 0,
  "rx_bytes_per_sec": 0,
  "tx_bytes_per_sec": 0,
  "stale": true
}
FALLBACK
    exit 0
fi

mtime=$(stat -c %Y "$CACHE_FILE" 2>/dev/null || echo 0)
age=$((now - mtime))

if [ "$age" -gt "$STALE_SECONDS" ]; then
    # Inject stale=true into the existing payload
    jq --argjson stale true '. + { stale: $stale }' < "$CACHE_FILE"
else
    cat "$CACHE_FILE"
fi
```

- [ ] **Step 2: Make executable**

Run: `chmod +x scripts/www/cgi-bin/quecmanager/at_cmd/fetch_traffic.sh`
Expected: no output.

- [ ] **Step 3: Verify locally with a fake cache file**

Run:
```bash
echo '{"ts":1234,"iface":"rmnet_ipa0","total_rx_bytes":100,"total_tx_bytes":50,"rx_bytes_per_sec":10,"tx_bytes_per_sec":5}' > /tmp/qmanager_traffic.json
touch -d "now" /tmp/qmanager_traffic.json
# Simulate the CGI without auth (skip the cgi_base.sh sourcing — manually emulate the read+jq flow)
jq . < /tmp/qmanager_traffic.json
```
Expected: emits the JSON unmodified. Then:
```bash
touch -d "10 seconds ago" /tmp/qmanager_traffic.json
# Re-run the staleness branch manually:
jq --argjson stale true '. + { stale: $stale }' < /tmp/qmanager_traffic.json
```
Expected: same JSON with `"stale": true` appended.
Cleanup: `rm /tmp/qmanager_traffic.json`.

- [ ] **Step 4: Commit**

```bash
git add scripts/www/cgi-bin/quecmanager/at_cmd/fetch_traffic.sh
git commit -m "feat(traffic): add fetch_traffic.sh CGI endpoint"
```

---

## Task 5: Implement `useTrafficStream` hook

**Files:**
- Create: `hooks/use-traffic-stream.ts`

- [ ] **Step 1: Write the hook**

Create `hooks/use-traffic-stream.ts`. Modeled on `hooks/use-modem-status.ts` (read it once before writing if you haven't):

```ts
"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { authFetch } from "@/lib/auth-fetch";
import type { TrafficStream } from "@/types/modem-status";

// =============================================================================
// useTrafficStream — 1 Hz Cellular Traffic Counter Hook
// =============================================================================
// Polls the qmanager_traffic side-channel CGI at 1 Hz. Decoupled from the 2 s
// useModemStatus path so live speed and cumulative totals can update faster.
// The hook does NOT touch the modem.
// =============================================================================

const DEFAULT_POLL_INTERVAL = 1000;
const STALE_THRESHOLD_SECONDS = 5;
const FETCH_ENDPOINT = "/cgi-bin/quecmanager/at_cmd/fetch_traffic.sh";

export interface UseTrafficStreamOptions {
  /** Polling interval in ms (default: 1000) */
  pollInterval?: number;
  /** Whether polling is active (default: true) */
  enabled?: boolean;
}

export interface UseTrafficStreamReturn {
  data: TrafficStream | null;
  isLoading: boolean;
  isStale: boolean;
  error: string | null;
  refresh: () => void;
}

export function useTrafficStream(
  options: UseTrafficStreamOptions = {},
): UseTrafficStreamReturn {
  const { pollInterval = DEFAULT_POLL_INTERVAL, enabled = true } = options;

  const [data, setData] = useState<TrafficStream | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);

  const mountedRef = useRef(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const response = await authFetch(FETCH_ENDPOINT);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const json: TrafficStream = await response.json();
      if (!mountedRef.current) return;

      setData(json);
      setError(null);

      // Trust the CGI's stale flag first (file mtime > 5 s).
      // Also independently check by ts: if ts is too old, mark stale.
      if (json.stale) {
        setIsStale(true);
      } else {
        const now = Math.floor(Date.now() / 1000);
        const age = now - json.ts;
        setIsStale(age > STALE_THRESHOLD_SECONDS);
      }

      setIsLoading(false);
    } catch (err) {
      if (!mountedRef.current) return;
      const message =
        err instanceof Error ? err.message : "Failed to fetch traffic stream";
      setError(message);
      setIsStale(true);
      setIsLoading(false);
    }
  }, []);

  const refresh = useCallback(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    mountedRef.current = true;

    if (!enabled) {
      return () => {
        mountedRef.current = false;
      };
    }

    fetchData();
    intervalRef.current = setInterval(fetchData, pollInterval);

    return () => {
      mountedRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [fetchData, pollInterval, enabled]);

  return { data, isLoading, isStale, error, refresh };
}
```

- [ ] **Step 2: Type-check**

Run: `bunx tsc --noEmit`
Expected: PASS (no errors). The hook is exported but not consumed yet — that's fine.

- [ ] **Step 3: Commit**

```bash
git add hooks/use-traffic-stream.ts
git commit -m "feat(traffic): add useTrafficStream 1Hz polling hook"
```

---

## Task 6: Wire the Device Metrics card

**Files:**
- Modify: `components/dashboard/device-metrics.tsx`

- [ ] **Step 1: Read the current card**

Run: `wc -l components/dashboard/device-metrics.tsx`
Note the file length (~290 lines per Task 0 exploration). Open it.

- [ ] **Step 2: Add `TrafficStream` to the type imports**

Locate the existing import block:
```ts
import type {
  DeviceStatus,
  TrafficStatus,
  LteStatus,
  NrStatus,
} from "@/types/modem-status";
```
Replace with:
```ts
import type {
  DeviceStatus,
  TrafficStatus,
  TrafficStream,
  LteStatus,
  NrStatus,
} from "@/types/modem-status";
```

- [ ] **Step 3: Add `formatBytes` to the formatter imports**

Locate:
```ts
import {
  formatBytesPerSec,
  formatUptime,
  calculateLteDistance,
  calculateNrDistance,
  formatDistance,
  formatTemperature,
} from "@/types/modem-status";
```
Replace with:
```ts
import {
  formatBytes,
  formatBytesPerSec,
  formatUptime,
  calculateLteDistance,
  calculateNrDistance,
  formatDistance,
  formatTemperature,
} from "@/types/modem-status";
```

- [ ] **Step 4: Add `trafficStream` prop to the interface**

Locate:
```ts
interface DeviceMetricsComponentProps {
  deviceData: DeviceStatus | null;
  trafficData: TrafficStatus | null;
  lteData: LteStatus | null;
  nrData: NrStatus | null;
  isLoading: boolean;
}
```
Replace with:
```ts
interface DeviceMetricsComponentProps {
  deviceData: DeviceStatus | null;
  trafficData: TrafficStatus | null;
  trafficStream: TrafficStream | null;
  lteData: LteStatus | null;
  nrData: NrStatus | null;
  isLoading: boolean;
}
```

- [ ] **Step 5: Destructure the new prop**

Locate:
```ts
const DeviceMetricsComponent = ({
  deviceData,
  trafficData,
  lteData,
  nrData,
  isLoading,
}: DeviceMetricsComponentProps) => {
```
Replace with:
```ts
const DeviceMetricsComponent = ({
  deviceData,
  trafficData,
  trafficStream,
  lteData,
  nrData,
  isLoading,
}: DeviceMetricsComponentProps) => {
```

- [ ] **Step 6: Compute speed values with stream-first fallback to slow cache**

Locate:
```ts
const rxSpeed = trafficData?.rx_bytes_per_sec ?? 0;
const txSpeed = trafficData?.tx_bytes_per_sec ?? 0;
```
Replace with:
```ts
// Prefer the 1 Hz stream daemon; fall back to the 2 s poller cache when
// the stream daemon is starting, stopped, or stale.
const rxSpeed =
  trafficStream?.rx_bytes_per_sec ?? trafficData?.rx_bytes_per_sec ?? 0;
const txSpeed =
  trafficStream?.tx_bytes_per_sec ?? trafficData?.tx_bytes_per_sec ?? 0;

// Cumulative totals — same fallback pattern.
const totalRx =
  trafficStream?.total_rx_bytes ?? trafficData?.total_rx_bytes ?? 0;
const totalTx =
  trafficStream?.total_tx_bytes ?? trafficData?.total_tx_bytes ?? 0;
```

- [ ] **Step 7: Insert the "Data Used" row above "Live Traffic"**

Locate the existing block:
```tsx
{/* Live Traffic */}
<Separator />
<div className="flex items-center justify-between">
  <p className="font-semibold text-muted-foreground text-sm">
    Live Traffic
  </p>
  <div className="flex items-center gap-x-2">
    <div className="flex items-center gap-1">
      <TbCircleArrowDownFilled className="text-info size-5" />
      <p className="font-semibold text-sm tabular-nums">
        {formatBytesPerSec(rxSpeed)}
      </p>
    </div>
    <div className="flex items-center gap-1">
      <TbCircleArrowUpFilled className="text-purple-500 size-5" />
      <p className="font-semibold text-sm tabular-nums">
        {formatBytesPerSec(txSpeed)}
      </p>
    </div>
  </div>
</div>
```

Insert the following IMMEDIATELY ABOVE the `{/* Live Traffic */}` comment (so the new row sits between Memory Usage and Live Traffic):

```tsx
{/* Data Used (cumulative since modem boot) */}
<Separator />
<div className="flex items-center justify-between">
  <p className="font-semibold text-muted-foreground text-sm">
    Data Used
  </p>
  <div className="flex items-center gap-x-2">
    <div className="flex items-center gap-1">
      <TbCircleArrowDownFilled className="text-info size-5" />
      <p className="font-semibold text-sm tabular-nums">
        {formatBytes(totalRx)}
      </p>
    </div>
    <div className="flex items-center gap-1">
      <TbCircleArrowUpFilled className="text-purple-500 size-5" />
      <p className="font-semibold text-sm tabular-nums">
        {formatBytes(totalTx)}
      </p>
    </div>
  </div>
</div>
```

- [ ] **Step 8: Type-check**

Run: `bunx tsc --noEmit`
Expected: ONE expected error in `home-component.tsx` complaining about a missing `trafficStream` prop on `DeviceMetricsComponent`. That gets fixed in Task 7. No other errors.

- [ ] **Step 9: Commit**

```bash
git add components/dashboard/device-metrics.tsx
git commit -m "feat(traffic): add Data Used row to Device Metrics card with stream fallback"
```

(The intermediate type error is fine — it'll resolve at the end of Task 7. The commit is atomic in scope: the card now consumes `trafficStream`. Wiring the call site is its own concern.)

---

## Task 7: Wire `home-component.tsx` to call the new hook

**Files:**
- Modify: `components/dashboard/home-component.tsx`

- [ ] **Step 1: Read the relevant call site**

Run: `grep -n "useModemStatus\|DeviceMetricsComponent\|trafficData" components/dashboard/home-component.tsx`
Note the import line for `useModemStatus`, the call site, and where `DeviceMetricsComponent` is rendered.

- [ ] **Step 2: Add the hook import**

Locate the existing import for `useModemStatus`. Add a sibling line directly below it:

```ts
import { useTrafficStream } from "@/hooks/use-traffic-stream";
```

- [ ] **Step 3: Call the hook alongside `useModemStatus`**

Locate the existing call (likely something like `const { data, isLoading, isStale, error } = useModemStatus();`). Add immediately after it:

```ts
const { data: trafficStream } = useTrafficStream();
```

- [ ] **Step 4: Pass `trafficStream` to `DeviceMetricsComponent`**

Locate the existing JSX usage:
```tsx
<DeviceMetricsComponent
  deviceData={data?.device ?? null}
  trafficData={data?.traffic ?? null}
  lteData={data?.lte ?? null}
  nrData={data?.nr ?? null}
  isLoading={isLoading}
/>
```
Replace with:
```tsx
<DeviceMetricsComponent
  deviceData={data?.device ?? null}
  trafficData={data?.traffic ?? null}
  trafficStream={trafficStream}
  lteData={data?.lte ?? null}
  nrData={data?.nr ?? null}
  isLoading={isLoading}
/>
```

- [ ] **Step 5: Type-check**

Run: `bunx tsc --noEmit`
Expected: PASS (no errors).

- [ ] **Step 6: Commit**

```bash
git add components/dashboard/home-component.tsx
git commit -m "feat(traffic): wire useTrafficStream into Device Metrics card"
```

---

## Task 8: End-to-end verification on target device

These steps run on a deployed RM520N-GL after a build + install. They are NOT TDD — they are the post-merge verification gate.

- [ ] **Step 1: Build the frontend bundle**

Run: `bun run build`
Expected: Next.js build completes; no type errors; dist artifacts written to `out/`.

- [ ] **Step 2: Build the installer tarball**

Run: `bun run build:installer` (or whatever the project's installer-build command is — check `package.json` if uncertain).
Expected: tarball ready under `dist/` (per repo convention).

- [ ] **Step 3: Deploy to the target**

Use the project's standard SCP-and-run flow (see CLAUDE.md memory entry: SCP legacy mode `scp -O`). After installer completes on device:

Run on device: `systemctl status qmanager-traffic --no-pager`
Expected: `active (running)`, started within the last few seconds.

- [ ] **Step 4: Verify the daemon is writing the cache**

Run on device: `cat /tmp/qmanager_traffic.json | jq .`
Expected: a JSON object with `iface: "rmnet_ipa0"` (assuming cellular is up), non-zero `total_rx_bytes`/`total_tx_bytes`, and `rx_bytes_per_sec`/`tx_bytes_per_sec` reflecting current usage.

Run on device: `for i in 1 2 3; do stat -c "%Y" /tmp/qmanager_traffic.json; sleep 1; done`
Expected: three increasing timestamps, each one second apart.

- [ ] **Step 5: Verify the CGI endpoint**

Run on device: `curl -sk https://127.0.0.1/cgi-bin/quecmanager/at_cmd/fetch_traffic.sh -H "Cookie: <session-cookie>" | jq .`
(Substitute the actual session cookie or curl the LAN IP from a host with a logged-in browser session.)
Expected: same JSON shape as the daemon's output, no `stale` flag.

Run on device: `systemctl stop qmanager-traffic && sleep 6 && curl -sk ... | jq .stale`
Expected: `true`.
Run on device: `systemctl start qmanager-traffic && sleep 2 && curl -sk ... | jq .stale`
Expected: `false` or `null` (the field may not be present when fresh — `jq .stale` returns `null` when absent, that's fine).

- [ ] **Step 6: Verify in the dashboard**

Open the dashboard in a browser. Look at the Device Metrics card.
- "Data Used" row appears above "Live Traffic".
- Both values render (not `0 B` if cellular has been up a while).
- Speed numbers update visibly faster than before — start `iperf3 -c <server>` on a host behind the modem and watch the speed climb at 1 Hz cadence.

- [ ] **Step 7: Verify SSR / counter-reset handling (optional, destructive)**

This forces a modem subsystem restart. Skip if not in a lab environment.
Run on device: `echo restart > /sys/devices/platform/4080000.qcom,mss/subsys0/restart`
Watch: `watch -n 0.5 'cat /tmp/qmanager_traffic.json | jq "{iface, rx_per_sec: .rx_bytes_per_sec, total_rx: .total_rx_bytes}"'`
Expected: during the SSR window `iface` may flip to `rmnet_data0` or `null`; once the modem comes back, `total_rx_bytes` resets to a small number; `rx_bytes_per_sec` stays ≥ 0 throughout (no negative values surfaced to UI).

- [ ] **Step 8: Verify interface fallback**

Run on device: `ip link set rmnet_ipa0 down && sleep 2 && cat /tmp/qmanager_traffic.json | jq .iface`
Expected: `"rmnet_data0"` (if up) or `null` (if both are down).
Run on device: `ip link set rmnet_ipa0 up && sleep 2 && cat /tmp/qmanager_traffic.json | jq .iface`
Expected: `"rmnet_ipa0"`.

- [ ] **Step 9: Final commit (if any verification revealed missing edits)**

If Steps 1-8 surfaced issues that needed code fixes, commit them with descriptive messages. Otherwise no commit needed.

---

## Self-Review Notes

**Spec coverage check:**
- ✅ Counter semantics locked (Task 0 inspection + spec).
- ✅ Active-iface selection — Task 2 implements `pick_iface` with primary/fallback/null.
- ✅ Counter-reset handling — Task 2 main loop has the negative-delta guard.
- ✅ 1 Hz cadence — Task 2 (`INTERVAL=1`) and Task 5 (`DEFAULT_POLL_INTERVAL = 1000`).
- ✅ Daemon writes atomic JSON — Task 2 uses `.tmp` + `mv`.
- ✅ Systemd unit added — Task 3.
- ✅ CGI emits stale flag — Task 4.
- ✅ Hook reads stream — Task 5.
- ✅ Data Used row above Live Traffic — Task 6.
- ✅ Live Traffic falls back to slow cache — Task 6 step 6.
- ✅ Hook called from home-component — Task 7.
- ✅ Installer auto-discovery confirmed — Task 3 step 3.
- ✅ End-to-end verification on device — Task 8.

**Type consistency check:**
- `TrafficStream` field names match between Task 1 (definition), Task 2 (jq output), Task 4 (CGI fallback JSON), Task 5 (hook), and Task 6 (component access). All use `total_rx_bytes`, `total_tx_bytes`, `rx_bytes_per_sec`, `tx_bytes_per_sec`, `iface`, `ts`, `stale`.

**Placeholder scan:**
- No "TODO", "TBD", or "fill in" left in any task.
- Every code-touching step has explicit code.
- Every command-running step states the expected output.
