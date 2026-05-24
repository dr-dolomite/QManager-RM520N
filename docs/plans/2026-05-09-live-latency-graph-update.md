# Live Latency Graph Update — Implementation Plan

> **Status: Superseded — Live Traffic feature removed in the 2026-05-24 release.** This plan touches the same Device Metrics card surface that hosted the now-removed Live Traffic row. The latency-graph polish itself may still be partly relevant, but anything that depends on `useTrafficStream` or the `qmanager_traffic` daemon no longer applies. See [`../reference/data-counter-platform-matrix.md`](../reference/data-counter-platform-matrix.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the Live Latency card on the Home dashboard — remove the X-axis time labels, expand the chart from 5 to 10 plotted points, and tie the data refresh cadence to the user's Connection Sensitivity profile (daemon interval + small buffer).

**Architecture:**
- The chart is rendered by `components/dashboard/live-latency.tsx`. It receives `connectivity` as a prop from `components/dashboard/home-component.tsx`, which gets it from the polling `useModemStatus()` hook. No data-shape changes are required — `ConnectivityStatus.latency_history` is already a `(number | null)[]` ring buffer and `history_interval_sec` already reflects the active profile interval.
- Visual changes are isolated to `live-latency.tsx`: drop the `<XAxis>` element and bump `CHART_POINTS` from `5` to `10`. The existing rolling-loss math (`LOSS_WINDOW = 10`) continues to work because it slices from the full underlying history, not from the displayed window.
- Polling change is isolated to `home-component.tsx`: derive a `pollInterval` for `useModemStatus()` from `data.connectivity.history_interval_sec`. The hook already takes `pollInterval` as an option and re-arms its `setInterval` when the value changes — no hook-level changes needed. Until the first successful fetch we keep the existing 2000 ms default. After the first fetch we set `pollInterval = history_interval_sec * 1000 + BUFFER_MS` where `BUFFER_MS = 250`. This adapts the whole dashboard's poll rate to the daemon's write rate (matching user intent — Sensitive users get 1.25 s refresh, Quiet users get 10.25 s) and intentionally lags slightly behind each daemon write so we never read a half-written cache.

**Tech Stack:** Next.js (App Router), React 19, TypeScript, recharts, Tailwind, shadcn/ui. Build/test commands are run with `bun` (not npx). No unit-test framework is wired up for React components in this repo, so verification is visual on the dev server.

---

### Task 1: Live Latency component visual changes

**Files:**
- Modify: `components/dashboard/live-latency.tsx`

- [ ] **Step 1: Bump CHART_POINTS to 10**

In `components/dashboard/live-latency.tsx`, change line 49:

```tsx
// before
/** How many points to show on the chart */
const CHART_POINTS = 5;

// after
/** How many points to show on the chart */
const CHART_POINTS = 10;
```

- [ ] **Step 2: Remove the XAxis element**

In `components/dashboard/live-latency.tsx`, delete lines 195–200 (the `<XAxis>` element). The surrounding `<LineChart>` keeps its `<CartesianGrid vertical={false} />` and tooltip — only the X-axis labels go.

```tsx
// before
<CartesianGrid vertical={false} />
<XAxis
  dataKey="time"
  tickLine={false}
  axisLine={false}
  tickMargin={8}
/>
<ChartTooltip
  cursor={false}
  ...

// after
<CartesianGrid vertical={false} />
<ChartTooltip
  cursor={false}
  ...
```

- [ ] **Step 3: Drop the now-unused XAxis import**

In `components/dashboard/live-latency.tsx`, line 5:

```tsx
// before
import { CartesianGrid, Line, LineChart, XAxis } from "recharts";

// after
import { CartesianGrid, Line, LineChart } from "recharts";
```

The `time` field on each chart datum is still useful for the tooltip's series header in recharts default behavior; keep it built in `chartData` (line 144) untouched. No other code references the X-axis tick labels.

- [ ] **Step 4: Type-check the change**

Run: `bunx tsc --noEmit`
Expected: no errors. (If the build flags an unused `XAxis` import, the import is fully gone — re-check Step 3.)

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/live-latency.tsx
git commit -m "feat(ui): expand Live Latency chart to 10 points, remove X-axis"
```

---

### Task 2: Dynamic polling tied to Connection Sensitivity

**Files:**
- Modify: `components/dashboard/home-component.tsx`

- [ ] **Step 1: Add poll-interval derivation**

In `components/dashboard/home-component.tsx`, add a state + effect that tracks `connectivity.history_interval_sec` and updates `pollInterval`. Replace the existing `useModemStatus()` call (line 33) with the dynamic version:

```tsx
// near the top of the component, after imports stay as-is
const DEFAULT_POLL_MS = 2000;
const POLL_BUFFER_MS = 250; // Small lag past each daemon write to avoid catching a half-written cache

const HomeComponent = () => {
  const [pollInterval, setPollInterval] = React.useState<number>(DEFAULT_POLL_MS);
  const { data, isLoading, isStale, error } = useModemStatus({ pollInterval });
  const { data: trafficStream } = useTrafficStream();

  // Tie poll cadence to the ping daemon's write interval (Connection Sensitivity).
  // history_interval_sec comes straight from the active profile, so this adapts
  // automatically when the user changes Sensitivity in System Settings.
  const daemonIntervalSec = data?.connectivity?.history_interval_sec;
  React.useEffect(() => {
    if (!daemonIntervalSec || daemonIntervalSec <= 0) return;
    const next = daemonIntervalSec * 1000 + POLL_BUFFER_MS;
    setPollInterval((prev) => (prev === next ? prev : next));
  }, [daemonIntervalSec]);

  // ... rest of the component unchanged
```

The two constants live at module scope (above the component). The state is initialized to the prior fixed default so first-paint behavior is identical to today. After the first fetch lands, the effect re-arms the polling interval to match the user's profile.

- [ ] **Step 2: Type-check and lint**

Run: `bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/home-component.tsx
git commit -m "feat(home): poll modem status at Connection Sensitivity rate + 250ms buffer"
```

---

### Task 3: Manual verification

**Files:**
- None (runtime check)

- [ ] **Step 1: Start the dev server**

Run: `bun run dev`
Expected: Next.js dev server starts on the configured port (default 3000) with the CGI proxy active.

- [ ] **Step 2: Visit the Home dashboard**

Open the dashboard in a browser. Look at the Live Latency and Speed Test card.
Expected: the line chart shows up to 10 plotted points, no time labels (`-2s`, `-4s`, …) appear under the lines, and the two latency/packetloss series render normally.

- [ ] **Step 3: Confirm dynamic polling under each profile**

For each profile (Sensitive, Regular, Relaxed, Quiet):
1. Go to System Settings → Connection Quality → Connectivity Sensitivity.
2. Select the profile and Save.
3. Open browser DevTools → Network tab and filter to `fetch_data.sh`.
4. Watch the request cadence. Expected intervals (rounded):
   - Sensitive → ~1.25 s between fetches
   - Regular → ~2.25 s
   - Relaxed → ~5.25 s
   - Quiet → ~10.25 s
5. Confirm new daemon samples appear on the Live Latency chart at roughly the same cadence (one new point per fetch once the daemon catches up).

- [ ] **Step 4: Confirm tooltip still works**

Hover the chart. Expected: the recharts tooltip still appears and shows `Latency` (ms) and `Packetloss` (%) values for the hovered point. (The `time` field on each datum is still populated; we only removed the on-axis labels.)

- [ ] **Step 5: Confirm graceful behavior with no data**

If `connectivity` is null or `latency_history` is empty (e.g., before the daemon has produced its first sample), the chart renders empty without errors and pollInterval stays at the 2000 ms default. No console errors.

---

## Self-Review

1. **Spec coverage:**
   - "Remove horizontal timeline" → Task 1 Steps 2–3.
   - "Plot up to 10 points" → Task 1 Step 1.
   - "Polling rate depends on Connection Sensitivity + small buffer" → Task 2 Step 1.
   - "Avoid race with qmanager_ping daemon refresh" → buffer of 250 ms applied past each daemon interval.

2. **Placeholder scan:** No TBDs, no "similar to Task N", no missing code. All file paths and line references are concrete.

3. **Type consistency:** `pollInterval` is `number`, matches `UseModemStatusOptions.pollInterval` signature in `hooks/use-modem-status.ts:28-33`. `daemonIntervalSec` reads `ConnectivityStatus.history_interval_sec` (typed `number` at `types/modem-status.ts:387`).

4. **Open question (low risk):** Tying `useModemStatus`'s poll rate to the daemon means *all* dashboard cards (signal, traffic, device metrics) refresh at the same rate as the ping daemon. For Quiet (10 s) this slows other cards too. This is consistent with the user's intent for the Sensitivity profile (Quiet = battery/data conscious, slow updates everywhere) and avoids running two parallel fetch loops on the same CGI. Flag during review if a per-card cadence is preferred — the alternative would be a second `useModemStatus()` instance scoped to LiveLatency only (one extra fetch loop hitting the same endpoint).
