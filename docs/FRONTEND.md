# QManager Frontend Guide

This document covers the frontend architecture, component patterns, hooks, routing, and development conventions.

---

## Tech Stack

| Technology | Version | Purpose |
|-----------|---------|---------|
| Next.js | 16.0.7 | App Router, static export (`output: "export"`) |
| React | 19.2.1 | Component framework |
| TypeScript | 5.x | Type safety |
| Tailwind CSS | v4 | Utility-first styling |
| shadcn/ui | Latest | Headless UI components (Radix UI) |
| Recharts | 2.15.4 | Signal and latency charting |
| React Hook Form | 7.71.2 | Form state management |
| Zod | 4.3.6 | Schema validation |
| Motion | 12.38.0 | Animations |
| @dnd-kit | 6.3/10.0 | Drag-and-drop (sortable lists) |
| @tanstack/react-table | 8.21.3 | Data tables |
| Lucide React | 0.562.0 | Icons |
| next-themes | 0.4.6 | Dark/light mode |
| sonner | 2.0.7 | Toast notifications |

---

## Directory Structure

```
app/                            # Next.js App Router
├── layout.tsx                  # Root layout (fonts, ThemeProvider, Toaster)
├── page.tsx                    # Redirect → /dashboard
├── globals.css                 # Tailwind + OKLCH theme variables
├── fonts/                      # Rethink Sans + JetBrains Mono (vendored) + Material Symbols WOFF2 files
├── login/page.tsx              # Authentication page
├── dashboard/                  # Home dashboard
├── cellular/                   # Cellular management
│   ├── page.tsx                # Cellular info hub
│   ├── settings/               # APN, IMEI, network priority, FPLMN
│   ├── cell-locking/           # Band, frequency, tower locking
│   ├── cell-scanner/           # Cell scanner + frequency calculator
│   ├── custom-profiles/        # SIM profile management
│   └── sms/                    # SMS management
├── local-network/              # Network settings
│   ├── page.tsx                # Ethernet status hub
│   ├── ethernet/               # Ethernet link speed
│   ├── ttl-settings/           # TTL/HL + MTU
│   ├── ip-passthrough/         # IP passthrough
│   └── custom-dns/             # DNS settings
├── monitoring/                 # Monitoring & alerts
│   ├── page.tsx                # Redirect → /monitoring/events
│   ├── events/                 # Network events hub
│   ├── connection-quality/     # Probe targets + quality limits (sidebar group head)
│   ├── latency/                # Latency monitoring
│   ├── alerts/                 # Centralized Alerts (SMS + email + Discord)
│   ├── email-alerts/           # Redirect → /monitoring/alerts (legacy bookmark)
│   ├── sms-alerts/             # Redirect → /monitoring/alerts (legacy bookmark)
│   ├── discord-bot/            # Redirect → /monitoring/alerts (legacy bookmark)
│   ├── watchdog/               # Watchdog settings
│   ├── logs/                   # System logs
│   └── tailscale/              # Tailscale VPN
├── system-settings/            # System settings & scheduled ops
├── about-device/               # Device information
└── support/                    # Support & links

components/
├── ui/                         # shadcn/ui primitives (42 components)
├── app-layout.tsx              # Main layout (sidebar + breadcrumbs)
├── app-sidebar.tsx             # Navigation sidebar
├── theme-provider.tsx          # next-themes wrapper
├── nav-main.tsx                # Home navigation
├── nav-cellular.tsx            # Cellular nav section
├── nav-localNetwork.tsx        # Local network nav section
├── nav-monitoring.tsx          # Monitoring nav section
├── nav-secondary.tsx           # Secondary nav (About, Support, Donate)
├── nav-system.tsx              # System nav section
├── nav-user.tsx                # User menu (change password, theme, reboot, logout)
├── donate-dialog.tsx           # Ko-fi/PayPal donation dialog
├── auth/                       # Login form, setup form
├── cellular/                   # Cellular components (57 files)
├── dashboard/                  # Dashboard cards
├── local-network/              # Network components
├── monitoring/                 # Monitoring components
├── system-settings/            # System settings & scheduled ops
├── about-device/               # About page components
└── support/                    # Support page components

hooks/                          # Custom React hooks (30 files)
types/                          # TypeScript interfaces (14 files)
lib/                            # Utility functions
constants/                      # Static configuration data
```

---

## Routing & Pages

### Route Map

| Route | Component | Description |
|-------|-----------|-------------|
| `/` | Redirect | → `/dashboard` |
| `/login` | LoginForm | Authentication (login or first-time setup) |
| `/dashboard` | HomeComponent | Real-time signal and device status |
| `/cellular` | CellularInformation | Cellular info cards |
| `/cellular/settings` | CellularSettings | Mode, roaming, AMBR settings |
| `/cellular/settings/apn-management` | APNSettings | APN profile CRUD |
| `/cellular/settings/imei-settings` | IMEISettings | IMEI read/write/backup |
| `/cellular/settings/network-priority` | NetworkPriority | RAT acquisition order (`AT+QNWPREFCFG="rat_acq_order"`), reorderable |
| `/cellular/settings/fplmn-settings` | FPLMNSettings | **Blocked Networks** — forbidden-PLMN (FPLMN) list read + clear |
| `/cellular/cell-locking` | BandLocking | LTE/NR band selection |
| `/cellular/cell-locking/tower-locking` | TowerLocking | PCI-based tower lock (with Simple Mode dropdowns sourced from live QCAINFO) |
| `/cellular/cell-locking/frequency-locking` | FrequencyLocking | EARFCN/ARFCN lock |
| `/cellular/cell-scanner` | CellScanner | Active cell scanning |
| `/cellular/cell-scanner/neighbourcell-scanner` | NeighbourScanner | Neighbor cells |
| `/cellular/cell-scanner/frequency-calculator` | FrequencyCalculator | EARFCN ↔ freq |
| `/cellular/custom-profiles` | CustomProfile | SIM profile CRUD + apply, **and** Connection Scenarios — one merged page |
| `/cellular/custom-profiles/connection-scenarios` | *(retired)* | Client-side `router.replace` redirect to `/cellular/custom-profiles`; kept only for old bookmarks and deep links |
| `/cellular/sms` | SMS | SMS inbox/send |
| `/local-network` | EthernetStatus | Ethernet hub |
| `/local-network/ethernet` | EthernetSettings | Link speed/duplex |
| `/local-network/ttl-settings` | TTLSettings | IPv4 TTL / IPv6 HL |
| `/local-network/mtu` | MTUSettings | MTU configuration |
| `/local-network/ip-passthrough` | IPPassthrough | IP passthrough mode |
| `/local-network/custom-dns` | CustomDNS | DNS override |
| `/monitoring/connection-quality` | ConnectionQualitySettings | Probe targets and latency / loss limits; sidebar group over Latency Monitor and Network Events (`/system-settings/connection-quality` redirects here) |
| `/monitoring/events` | NetworkEvents | Event log hub (`/monitoring` redirects here) |
| `/monitoring/latency` | LatencyMonitoring | Right now (live 60-probe strip), History (1 h / 6 h / 24 h average line) and Sites (per-site connect time) — see `docs/reference/latency-monitor.md` |
| `/monitoring/alerts` | Alerts | Centralized SMS + email + Discord downtime/reboot alerts |
| `/monitoring/email-alerts` | Redirect | → `/monitoring/alerts` (legacy bookmark) |
| `/monitoring/sms-alerts` | Redirect | → `/monitoring/alerts` (legacy bookmark) |
| `/monitoring/discord-bot` | Redirect | → `/monitoring/alerts` (legacy bookmark) |
| `/monitoring/watchdog` | Watchdog | Connection health |
| `/monitoring/logs` | SystemLogs | Log viewer |
| `/monitoring/tailscale` | Tailscale | VPN status |
| `/system-settings` | SystemSettings | System preferences, scheduled ops |
| `/about-device` | AboutDevice | Device info |
| `/support` | Support | Project info & links |

### Layout Structure

```
RootLayout (app/layout.tsx)
├── ThemeProvider (dark/light mode)
├── Toaster (sonner notifications)
└── Page Content
    ├── /login → LoginPage (no sidebar)
    └── /* → AppLayout
         ├── AppSidebar (navigation)
         ├── Breadcrumbs (auto-generated from route)
         └── Page Content
```

---

## Custom Hooks

### Polling Hooks

These hooks automatically fetch data at a configurable interval:

#### `useModemStatus(options?)`

The primary polling hook — fetches the cached modem status JSON.

```typescript
const { data, isLoading, isStale, error, refresh } = useModemStatus({
  pollInterval: 2000,  // default: 2000ms
  enabled: true,       // default: true
});
```

- **Endpoint**: `GET /cgi-bin/quecmanager/at_cmd/fetch_data.sh`
- **Shared store**: every caller reads one module-level snapshot fetched by one timer, at the shortest interval any mounted caller asks for, capped at 10 s; a new caller fetches at once; no polling while the tab is hidden. See `docs/reference/adaptive-polling.md`
- **Returns**: `ModemStatus | null` (null before first fetch)
- **Staleness**: Data marked stale if timestamp > 10 seconds old
- **Error handling**: Preserves last good data on error, sets `isStale: true`

#### `useSignalHistory(options?)`

Fetches per-antenna signal history for charting.

- **Endpoint**: `GET /cgi-bin/quecmanager/at_cmd/fetch_signal_history.sh`
- **Returns**: `SignalHistoryEntry[]`

#### `useLatencyHistory(options?)`

Fetches ping history for latency charts.

- **Endpoint**: `GET /cgi-bin/quecmanager/at_cmd/fetch_ping_history.sh` (`last` option → `?last=N`; the dashboard asks for 400)
- **Returns**: `PingHistoryEntry[]`
- **Consumers**: the dashboard Connection Quality card and the Latency Monitor's History card (1 h / 6 h / 24 h)

#### `useDataUsedReset()`

Reset mutation for the persistent data-usage counter. It does not poll: the counter itself comes from `.data_used` in `useModemStatus`'s payload.

- **Reset endpoint**: `POST /cgi-bin/quecmanager/network/data_used_reset.sh`
- **Returns**: `{ isResetting, resetCounter }` (`resetCounter()` resolves `true` on a 2xx)

### One-Shot Hooks (Fetch + Save)

These hooks fetch settings on mount and provide a `saveSettings()` function:

```typescript
// General pattern
const { settings, isLoading, isSaving, error, saveSettings, refresh } = useFeatureSettings();

// Save changes
const result = await saveSettings({ field: "value" });
if (result.success) {
  markSaved();
  toast.success(t("feature.toast.saved"));
} else {
  toast.error(t("feature.toast.save_failed"), { description: result.error });
}
```

Every finished user action is confirmed by exactly one `sonner` toast, success or failure, fired from the component handler that owns the action (**The Toast-Confirms Rule**). The failure reason comes from the call's returned result, never from the hook's `error` state read after an `await` (a stale closure); a fading Applied/Saved chip is retired. Many hooks in this tree still return a bare `Promise<boolean>` from `saveSettings`, which carries no reason, so the handler shows a fixed translated title; changing a mutator to return `{ success, error? }` means updating every caller in the same commit, because an unchanged `if (await save())` is truthy for every outcome. See [reference/toast-confirmation.md](reference/toast-confirmation.md).

| Hook | CGI Endpoint | Types File |
|------|-------------|------------|
| `useCellularSettings` | `/cellular/settings.sh` | `cellular-settings.ts` |
| `useAPNSettings` | `/cellular/apn.sh` | `apn-settings.ts` |
| `useMBNSettings` | `/cellular/mbn.sh` | `mbn-settings.ts` |
| `useIMEISettings` | `/cellular/imei.sh` | `imei-settings.ts` |
| `useBandLocking` | `/bands/lock.sh` | `band-locking.ts` |
| `useFrequencyLocking` | `/frequency/lock.sh` | `frequency-locking.ts` |
| `useTowerLocking` | `/tower/lock.sh` | `tower-locking.ts` |
| `useTTLSettings` | `/network/ttl.sh` | — |
| `useMTUSettings` | `/network/mtu.sh` | — |
| `useDNSSettings` | `/network/dns.sh` | — |
| `useIPPassthrough` | `/network/ip_passthrough.sh` | `ip-passthrough.ts` |
| `useAlerts` | `/monitoring/alerts.sh` | `alerts.ts` |
| `useAlertsLog` | `/monitoring/alerts.sh` (`action=get_log`) | `alerts.ts` |
| `useWatchdogSettings` | `/monitoring/watchdog.sh` | In hook file |
| `useSystemSettings` | `/system/settings.sh` | `system-settings.ts` |
| `useTailscale` | `/vpn/tailscale.sh` | — |

### Async Process Hooks

For long-running operations that run in the background:

| Hook | Start Endpoint | Status Endpoint |
|------|---------------|-----------------|
| `useProfileApply` | `POST /profiles/apply.sh` | `GET /profiles/apply_status.sh` |
| `useCellScanner` | `POST /at_cmd/cell_scan_start.sh` | `GET /at_cmd/cell_scan_status.sh` |
| `useNeighbourScanner` | `POST /at_cmd/neighbour_scan_start.sh` | `GET /at_cmd/neighbour_scan_status.sh` |
| `useSpeedtest` | `POST /at_cmd/speedtest_start.sh` | `GET /at_cmd/speedtest_status.sh` |

### Utility Hooks

| Hook | Purpose |
|------|---------|
| `useLogin` | Login page (setup detection + login/setup actions) |
| `useAuth` | Sidebar auth (change password, logout) |
| `useBreadcrumbs` | Auto-generates breadcrumb trail from current route |
| `useUnitPreferences` | Cached unit preferences (temp/distance) for dashboard display |
| `useMobile` | Responsive breakpoint detection |
| `useRecentActivities` | Fetches network events for the dashboard |
| `useCurrentSettings` | Fetches current modem settings for profile creation |
| `useConnectionScenarios` | CRUD for connection scenario templates |
| `useSimProfiles` | CRUD for custom SIM profiles |
| `useAboutDevice` | Fetches device information |
| `useSMS` | SMS inbox and send |

---

## Type System

All TypeScript interfaces are in `types/`. The main data contract is `modem-status.ts`.

### Key Types

| File | Primary Types | Used By |
|------|--------------|---------|
| `modem-status.ts` | `ModemStatus`, `LteStatus`, `NrStatus`, `NetworkStatus`, `DeviceStatus`, `TrafficStatus`, `ConnectivityStatus`, `WatchcatStatus`, `SignalPerAntenna`, `NetworkEvent`, `PingHistoryEntry`, `SignalHistoryEntry` | Dashboard, monitoring |
| `cellular-settings.ts` | `CellularSettings`, `CellularSettingsPayload` | Cellular settings page |
| `apn-settings.ts` | `APNProfile`, `APNSettings`, `APNSavePayload` | APN management |
| `mbn-settings.ts` | `MBNProfile`, `MBNSettings` | MBN configuration |
| `imei-settings.ts` | `IMEISettings`, `IMEISavePayload` | IMEI management |
| `band-locking.ts` | `BandLockingState`, `BandLockPayload` | Band locking |
| `frequency-locking.ts` | `FrequencyLockState`, `FrequencyLockPayload` | Frequency locking |
| `tower-locking.ts` | `TowerLockState`, `TowerLockPayload`, `TowerSchedule` | Tower locking |
| `sim-profile.ts` | `SimProfile`, `SimProfileSavePayload` | Custom profiles |
| `connection-scenario.ts` | `ConnectionScenario` | Connection scenarios |
| `ip-passthrough.ts` | `IPPassthroughSettings` | IP passthrough |
| `about-device.ts` | `AboutDeviceInfo` | About device page |
| `sms.ts` | `SMSMessage`, `SMSSendPayload` | SMS feature |
| `system-settings.ts` | `SystemSettings`, `ScheduleConfig`, `LowPowerConfig`, `SystemSettingsResponse`, `TimezoneEntry`, `DAY_LABELS`, `TIMEZONES` | System settings page |
| `speedtest.ts` | `SpeedtestResult`, `SpeedtestStatus` | Speed test |

### Utility Types & Functions (modem-status.ts)

The main types file also exports signal quality utilities:

```typescript
// Signal quality thresholds
RSRP_THRESHOLDS  // dBm: excellent=-80, good=-100, fair=-110, poor=-140
RSRQ_THRESHOLDS  // dB:  excellent=-5,  good=-10,  fair=-15,  poor=-20
SINR_THRESHOLDS  // dB:  excellent=20,  good=13,   fair=0,    poor=-20
LATENCY_THRESHOLDS // ms: excellent=30, good=60,   fair=100,  poor=Inf

// Quality categorization
getSignalQuality(value, thresholds)  → "excellent" | "good" | "fair" | "poor" | "none"
getLatencyQuality(latencyMs)         → same

// Formatting
formatBytesPerSec(bytes)   → "12.5 Mbps"
formatBytes(bytes)         → "1.0 GB"
formatLatency(ms)          → "34ms"
formatJitter(ms)           → "4.8ms"
formatUptime(seconds)      → "1d 12h 45m"
formatTimeAgo(timestamp)   → "2m ago"
formatNumericField(value)  → "12345" or "-"
formatDistance(km, unit?)   → "156 m" or "1.23 km" (or "512 ft" / "1.23 mi" when unit="miles")
formatTemperature(c, unit?) → "45°C" (or "113°F" when unit="fahrenheit")

// Cell distance calculations (3GPP)
calculateLteDistance(ta)   → km (from LTE Timing Advance)
calculateNrDistance(nta)   → km (from NR NTA value)

// Progress bar mapping
signalToProgress(value, thresholds) → 0-100
```

---

## API Communication

### authFetch()

All authenticated API calls use the `authFetch()` wrapper from `lib/auth-fetch.ts`:

```typescript
import { authFetch } from "@/lib/auth-fetch";

const response = await authFetch("/cgi-bin/quecmanager/cellular/settings.sh");
```

It's a thin wrapper around `fetch()` that:
1. Lets the browser auto-send cookies (no manual token injection)
2. Catches 401 responses → clears indicator cookie → redirects to `/login`

### Development Proxy

In development, `next.config.ts` proxies `/cgi-bin/*` to the modem at `192.168.225.1`:

```typescript
// next.config.ts
async rewrites() {
  return [{
    source: "/cgi-bin/:path*",
    destination: "http://192.168.225.1/cgi-bin/:path*",
  }];
}
```

In production, the static export makes direct client-side requests to the device.

---

## Utility Libraries

### `lib/utils.ts`

```typescript
cn(...inputs)  // Tailwind class merging (clsx + tailwind-merge)
```

### `lib/earfcn.ts`

EARFCN ↔ frequency conversion utilities for the frequency calculator.

### `lib/download-csv.ts`

CSV export helper for data tables.

### `constants/mno-presets.ts`

Carrier-specific APN and TTL/HL preset configurations.

### `constants/network-events.ts`

Event type labels, descriptions, and severity mappings for the events UI.

---

## Component Patterns

### Card Pattern

Settings pages use one card shape: plain header, content, and an editable card commits from its own footer (**The Card-Foot Apply Rule**, `DESIGN.md` > Layout > Named Rules).

```tsx
const { saved, markSaved } = useSaveFlash();

<Card className="@container/card">
  <CardHeader>
    <CardTitle>{t("feature.title")}</CardTitle>
    <CardDescription>{t("feature.description")}</CardDescription>
  </CardHeader>
  <CardContent>
    {/* Form fields or data display */}
  </CardContent>
  <CardFoot
    status={isDirty ? t("feature.unsaved", { count: changeCount }) : undefined}
    actions={
      <>
        <Button variant="ghost" onClick={discard} disabled={!isDirty || isSaving}>
          {t("feature.discard")}
        </Button>
        <SaveButton
          isSaving={isSaving}
          saved={saved}
          label={t("feature.save")}
          disabled={!isDirty}
          onClick={handleSave}
        />
      </>
    }
  />
</Card>
```

- `CardFoot` (`components/ui/card-foot.tsx`) is layout only: status on the left edge, actions on the right, `SaveButton` last, a borderless persistent row with a fixed minimum height. It takes translated content from the caller and imports neither icon set. Use it instead of shadcn `CardFooter`, whose `[.border-t]:pt-6` fights the row's padding.
- Discard and any secondary action beside Save are ghost or `tonal-neutral`, never a stroked `outline` button. Never wrap `SaveButton` in `AnimatePresence`.
- The `feature.*` keys above are illustrative: a real card adds its own keys to **all five** catalogs (`en id it zh-CN zh-TW`).
- Exempt: dialogs and wizards (their own `DialogFooter`), per-row and inline actions, and operational actions that are not a draft commit.
- **Swept 2026-10-06:** every non-exempt `SaveButton` now commits from a `CardFoot` or the `CARD_FOOT` + `CARD_FOOT_ACTIONS` constants. A page whose one apply spans several cards puts one footer on the card it belongs to most: Cellular Settings on the Network card (`cellular/settings/apply-foot.tsx`). Watchdog splits its apply instead: Ladder and Detection each commit their own fields (`monitoring/watchdog/watchdog-foot.tsx`). There is no page-level save bar anywhere; don't add one.

### Loading / Error / Empty States

Every data-driven component handles three states:

```tsx
if (isLoading) return <Skeleton />;
if (error) return <Alert variant="destructive">{error}</Alert>;
if (!data) return <Empty icon={Icon} message="No data available" />;
```

### Reboot Navigation Pattern

Features that require a device reboot (MBN, IMEI, IP Passthrough, Tailscale resync, manual reboot from `nav-user`) hand off to the static `/reboot/` countdown page on save success. **Do not use an in-card dialog** and do not call `reboot` yourself — the backend's `cgi_reboot_response` is waiting on a handshake file, and the `/reboot/` page is what touches that file. See [Reboot Ack Handshake](BACKEND.md#431-reboot-ack-handshake) in BACKEND.md for the backend contract.

```tsx
const success = await saveSettings(payload);
if (!success) {
  toast.error(t("feature.toast.save_failed"));
  return;
}

markSaved();
// Hand off to the countdown page. The backend (cgi_reboot_response) is
// waiting on /tmp/qmanager_reboot_ack — the /reboot/ page touches it on
// mount, so the device reboots only after the page is in browser memory.
sessionStorage.setItem("qm_rebooting", "1");
document.cookie = "qm_logged_in=; Path=/; Max-Age=0";
window.location.href = "/reboot/";
```

Reference implementations: `components/nav-user.tsx` (manual reboot), `components/cellular/settings/apn-management/mbn-card.tsx` (MBN apply), `components/local-network/ip-passthrough/ip-passthrough-card.tsx` (IPPT save), `hooks/use-imei-settings.ts` (`rebootDevice`, which returns `void` — a reboot is never awaitable; see [reference/cellular-settings-family.md](reference/cellular-settings-family.md)). The countdown page itself lives at `components/reboot/reboot-countdown.tsx` and fires the `reboot_ack` request on mount.

### Self-Contained Cards

Some features (Network Priority, FPLMN, Ethernet Status) are self-contained cards that don't use a separate hook or types file. They handle fetch/save/display within the component file itself. `components/local-network/ethernet-card.tsx` polls `network/ethernet.sh` every 10 s and implements its own optimistic speed-change + post-save link confirmation loop.

---

## Sidebar Navigation

The sidebar (`app-sidebar.tsx`) defines the full navigation structure:

| Section | Items |
|---------|-------|
| **Main** | Home (Dashboard) |
| **Cellular** | Cellular Info, SMS, Custom Profiles (+ Connection Scenarios), Band Locking (+ Tower, Frequency), Cell Scanner (+ Neighbor, Calculator), Settings (+ APN, Network Priority, IMEI, FPLMN) |
| **Local Network** | Ethernet Status, IP Passthrough, Custom DNS, TTL & MTU Settings |
| **Monitoring** | Network Events (+ Latency), Email Alerts, Tailscale, Watchdog, Logs |
| **System** | System Settings |
| **Secondary** | About Device, Support, Donate |
| **Footer** | User menu (Change Password, Toggle Theme, Reboot Device, Logout) |

---

## Build & Configuration

### Scripts

```bash
bun run dev     # Development server with hot reload + API proxy
bun run build   # Static export to out/ directory
bun run start   # Serve the built app locally
bun run lint    # ESLint check
```

### Key Config Files

| File | Purpose |
|------|---------|
| `next.config.ts` | Static export, trailing slash, dev API proxy |
| `tsconfig.json` | Strict mode, `@/*` path alias → `./*` |
| `postcss.config.mjs` | Tailwind CSS v4 PostCSS plugin |
| `eslint.config.mjs` | next/core-web-vitals + next/typescript rules |
| `components.json` | shadcn/ui configuration |
| `app/globals.css` | Tailwind imports + OKLCH theme variables |

### Path Aliases

TypeScript and Next.js are configured with `@/*` → `./*`:

```typescript
import { Button } from "@/components/ui/button";
import { useModemStatus } from "@/hooks/use-modem-status";
import type { ModemStatus } from "@/types/modem-status";
```
