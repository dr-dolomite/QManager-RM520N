# Web Console Redesign — xterm.js in AT Terminal Card Design

**Date:** 2026-04-09
**Status:** Approved

## Summary

Replace the current Web Console (raw ttyd proxy at `/console` that navigates away from QManager) with a React-wrapped page that embeds xterm.js inside the same card design as the AT Terminal. The sidebar stays visible, connection state is surfaced clearly, and the terminal fills the full viewport height.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Access method | Replace sidebar `/console` link with new Next.js page | Users stay inside QManager; sidebar remains visible |
| Route | `/system-settings/web-console/` | Groups with AT Terminal under system-settings |
| Card layout | Full height, no page title, status bar | Maximizes terminal real estate; header bar identifies the page |
| Terminal sizing | `calc(100vh - chrome)` fills viewport | Matches real terminal app behavior; xterm scrollback handles overflow |
| Error handling | Distinct states: not-available, disconnected, reconnecting | Graceful UX on cellular connections where drops are common |
| ttyd backend | No changes | xterm.js connects to existing WebSocket proxy |

## Architecture

```
Browser (React page)
  └─ WebConsoleCard
       ├─ Header bar (icon + "Web Console" + Clear/Fullscreen buttons)
       ├─ xterm.js canvas (fills available height)
       └─ Status bar (connection dot + state label + Reconnect)
              │
              │ WebSocket (wss://device/console/ws)
              ▼
         lighttpd proxy (existing, unchanged)
              │
              ▼
         ttyd on localhost:8080 (existing, unchanged)
              │
              ▼
         console.sh → bash --login
```

## Files to Create

### `app/system-settings/web-console/page.tsx`

Route page. Renders `WebConsoleCard` with no page-level heading (full-height layout).

### `components/system-settings/web-console/web-console-card.tsx`

Main component. Structure:

1. **Header bar** — `bg-muted` strip matching AT Terminal pattern:
   - `TerminalSquareIcon` + "Web Console" label (left)
   - Clear button + Fullscreen toggle button (right)
2. **Terminal container** — `div` ref that xterm.js mounts into. Background `#09090b`. Fills remaining viewport height via flex layout.
3. **Status bar** — Thin bottom strip:
   - Colored dot (green/amber/red) + state label
   - Reconnect button (visible when disconnected)

State management:
- `connectionState`: `"connecting" | "connected" | "disconnected" | "reconnecting" | "unavailable"`
- xterm `Terminal` instance stored in ref
- `FitAddon` attached, triggered on container resize via `ResizeObserver`

### `hooks/use-web-console.ts`

Hook encapsulating WebSocket lifecycle and ttyd protocol.

**Parameters:**
- `terminalRef: RefObject<Terminal | null>` — xterm instance to write to
- `containerRef: RefObject<HTMLDivElement | null>` — for fit addon sizing

**Returns:**
- `connectionState` — current connection state string
- `reconnect()` — manual reconnect trigger
- `disconnect()` — clean close

**WebSocket URL derivation:**
```typescript
const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const wsUrl = `${protocol}//${window.location.host}/console/ws`;
```

**ttyd binary protocol — receiving:**
- Messages arrive as `ArrayBuffer`
- First byte = message type:
  - `0` (OUTPUT): remaining bytes → `terminal.write(new Uint8Array(data, 1))`
  - `1` (SET_WINDOW_TITLE): ignore (or optionally update document title)
  - `2` (SET_PREFERENCES): JSON preferences from ttyd, ignore

**ttyd binary protocol — sending:**
- **Input**: on xterm `onData(data)` → send `Uint8Array([0, ...encoder.encode(data)])`
- **Resize**: on xterm `onResize({cols, rows})` → send `Uint8Array([1, ...encoder.encode(JSON.stringify({columns: cols, rows: rows}))])`

**Reconnect logic:**
- On WebSocket `close`/`error`: set state to `"reconnecting"`, schedule retry
- Backoff: 1s → 2s → 4s → 8s → cap at 10s
- Reset backoff to 1s on successful `open`
- After 3 consecutive immediate failures (WebSocket closes within 2s of opening), switch to `"unavailable"` state — stops auto-retry, shows empty state
- Manual `reconnect()` resets failure count and restarts the cycle

**Cleanup:** Close WebSocket and dispose xterm on unmount.

## Files to Modify

### `components/app-sidebar.tsx`

Change Web Console sidebar entry:
```typescript
// Before
{ title: "Web Console", url: "/console", icon: TerminalSquareIcon }

// After
{ title: "Web Console", url: "/system-settings/web-console", icon: TerminalSquareIcon }
```

## Connection States

| State | Status bar dot | Label | Actions | Terminal area |
|-------|---------------|-------|---------|---------------|
| Connecting | Amber | "Connecting..." | None | Empty xterm canvas |
| Connected | Green | "Connected" | None | Live terminal session |
| Disconnected | Red | "Disconnected" | Reconnect button | Last buffer preserved |
| Reconnecting | Amber (pulse) | "Reconnecting..." | None | Last buffer preserved |
| Unavailable | Hidden | Hidden | Hidden | Centered empty state: "Web Console is not available" / "ttyd is not installed or not running." / Retry button |

## Dependencies to Add

```
@xterm/xterm        — Terminal emulator core (canvas renderer)
@xterm/addon-fit    — Auto-fit terminal dimensions to container
@xterm/addon-web-links — Clickable URLs in terminal output
```

~250KB gzipped total. Only loaded on the web-console page (dynamic import or Next.js code splitting handles this automatically since it's a separate route).

## xterm.js Theme

Match existing ttyd service configuration:
```typescript
const theme = {
  foreground: "#e4e4e7",  // zinc-200
  background: "#09090b",  // zinc-950
  cursor: "#e4e4e7",      // zinc-200
  selectionBackground: "#e4e4e740",
};
```
Font size: 14. Font family: monospace (xterm.js default).

## What Stays Unchanged

- `scripts/etc/systemd/system/qmanager-console.service` — ttyd service unit
- `scripts/usrdata/qmanager/lighttpd.conf` — proxy config for `/console`
- `scripts/usrdata/qmanager/console/console.sh` — shell startup script
- `scripts/usr/bin/qmanager_console_mgr` — install/uninstall helper

The `/console` path in lighttpd remains — it serves as the WebSocket endpoint that the new React page connects to. Users just no longer navigate to it directly.
