# Web Console Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the raw ttyd proxy page with a React-wrapped Web Console that embeds xterm.js inside the AT Terminal card design, keeping the sidebar visible and surfacing connection state.

**Architecture:** A new Next.js page at `/system-settings/web-console/` renders a card component containing xterm.js connected to ttyd's WebSocket via the existing lighttpd `/console` proxy. A custom hook manages the WebSocket lifecycle, ttyd binary protocol, and reconnect logic with exponential backoff.

**Tech Stack:** React 19, Next.js 16 (static export), @xterm/xterm v5, @xterm/addon-fit, @xterm/addon-web-links, Tailwind CSS v4, shadcn/ui, lucide-react

---

### Task 1: Install xterm.js Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install packages**

Run:
```bash
bun add @xterm/xterm @xterm/addon-fit @xterm/addon-web-links
```

- [ ] **Step 2: Verify installation**

Run:
```bash
bun pm ls | grep xterm
```

Expected: Three `@xterm/` packages listed.

- [ ] **Step 3: Commit**

```bash
git add package.json bun.lock
git commit -m "deps: add @xterm/xterm, addon-fit, addon-web-links for Web Console"
```

---

### Task 2: Create the WebSocket + ttyd Protocol Hook

**Files:**
- Create: `hooks/use-web-console.ts`

- [ ] **Step 1: Create the hook file**

Create `hooks/use-web-console.ts` with the full implementation:

```typescript
"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";

// ttyd binary protocol message types
const TTYD_OUTPUT = 0;
const TTYD_SET_WINDOW_TITLE = 1;
const TTYD_SET_PREFERENCES = 2;

// ttyd client-to-server message types
const TTYD_INPUT = 0;
const TTYD_RESIZE = 1;

export type ConnectionState =
  | "connecting"
  | "connected"
  | "disconnected"
  | "reconnecting"
  | "unavailable";

interface UseWebConsoleOptions {
  terminalRef: React.RefObject<Terminal | null>;
  fitAddonRef: React.RefObject<FitAddon | null>;
}

interface UseWebConsoleReturn {
  connectionState: ConnectionState;
  reconnect: () => void;
  disconnect: () => void;
}

const MAX_BACKOFF = 10_000;
const INITIAL_BACKOFF = 1_000;
const RAPID_FAIL_THRESHOLD = 2_000; // if WS closes within 2s, it's a rapid failure
const MAX_RAPID_FAILURES = 3;

function buildWsUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/console/ws`;
}

export function useWebConsole({
  terminalRef,
  fitAddonRef,
}: UseWebConsoleOptions): UseWebConsoleReturn {
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("connecting");

  const wsRef = useRef<WebSocket | null>(null);
  const backoffRef = useRef(INITIAL_BACKOFF);
  const rapidFailCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openedAtRef = useRef(0);
  const encoderRef = useRef(new TextEncoder());
  const mountedRef = useRef(true);
  const inputListenerRef = useRef<{ dispose: () => void } | null>(null);
  const resizeListenerRef = useRef<{ dispose: () => void } | null>(null);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const sendToWs = useCallback((type: number, payload: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const encoded = encoderRef.current.encode(payload);
    const buf = new Uint8Array(encoded.length + 1);
    buf[0] = type;
    buf.set(encoded, 1);
    ws.send(buf);
  }, []);

  const attachTerminalListeners = useCallback(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    // Clean up previous listeners
    inputListenerRef.current?.dispose();
    resizeListenerRef.current?.dispose();

    inputListenerRef.current = terminal.onData((data: string) => {
      sendToWs(TTYD_INPUT, data);
    });

    resizeListenerRef.current = terminal.onResize(
      ({ cols, rows }: { cols: number; rows: number }) => {
        sendToWs(TTYD_RESIZE, JSON.stringify({ columns: cols, rows: rows }));
      }
    );
  }, [terminalRef, sendToWs]);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    // Clean up existing connection
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      if (
        wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING
      ) {
        wsRef.current.close();
      }
    }

    setConnectionState("connecting");
    const ws = new WebSocket(buildWsUrl());
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;
    openedAtRef.current = Date.now();

    ws.onopen = () => {
      if (!mountedRef.current) return;
      setConnectionState("connected");
      backoffRef.current = INITIAL_BACKOFF;
      rapidFailCountRef.current = 0;
      attachTerminalListeners();

      // Send initial resize after connection
      const terminal = terminalRef.current;
      if (terminal) {
        sendToWs(
          TTYD_RESIZE,
          JSON.stringify({ columns: terminal.cols, rows: terminal.rows })
        );
      }
    };

    ws.onmessage = (ev: MessageEvent) => {
      if (!mountedRef.current) return;
      const terminal = terminalRef.current;
      if (!terminal || !(ev.data instanceof ArrayBuffer)) return;

      const data = new Uint8Array(ev.data);
      if (data.length === 0) return;

      const msgType = data[0];
      switch (msgType) {
        case TTYD_OUTPUT:
          terminal.write(data.subarray(1));
          break;
        case TTYD_SET_WINDOW_TITLE:
          // Ignore — we manage our own page title
          break;
        case TTYD_SET_PREFERENCES:
          // Ignore — we configure xterm ourselves
          break;
      }
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;

      const duration = Date.now() - openedAtRef.current;
      if (duration < RAPID_FAIL_THRESHOLD) {
        rapidFailCountRef.current++;
      } else {
        rapidFailCountRef.current = 0;
      }

      if (rapidFailCountRef.current >= MAX_RAPID_FAILURES) {
        setConnectionState("unavailable");
        return;
      }

      setConnectionState("reconnecting");
      clearRetryTimer();
      retryTimerRef.current = setTimeout(() => {
        if (mountedRef.current) connect();
      }, backoffRef.current);
      backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF);
    };

    ws.onerror = () => {
      // onclose fires after onerror — let onclose handle state
    };
  }, [
    terminalRef,
    attachTerminalListeners,
    sendToWs,
    clearRetryTimer,
  ]);

  const disconnect = useCallback(() => {
    clearRetryTimer();
    inputListenerRef.current?.dispose();
    resizeListenerRef.current?.dispose();
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnectionState("disconnected");
  }, [clearRetryTimer]);

  const reconnect = useCallback(() => {
    clearRetryTimer();
    backoffRef.current = INITIAL_BACKOFF;
    rapidFailCountRef.current = 0;
    connect();
  }, [clearRetryTimer, connect]);

  // Auto-connect on mount, cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      clearRetryTimer();
      inputListenerRef.current?.dispose();
      resizeListenerRef.current?.dispose();
      if (wsRef.current) {
        wsRef.current.onopen = null;
        wsRef.current.onmessage = null;
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect, clearRetryTimer]);

  return { connectionState, reconnect, disconnect };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run:
```bash
bunx tsc --noEmit hooks/use-web-console.ts 2>&1 | head -20
```

Expected: No errors (or only unrelated project-wide errors).

- [ ] **Step 3: Commit**

```bash
git add hooks/use-web-console.ts
git commit -m "feat: add useWebConsole hook with ttyd WebSocket protocol and reconnect logic"
```

---

### Task 3: Create the Web Console Card Component

**Files:**
- Create: `components/system-settings/web-console/web-console-card.tsx`

- [ ] **Step 1: Create the component**

Create `components/system-settings/web-console/web-console-card.tsx`:

```tsx
"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import {
  TerminalSquareIcon,
  Trash2Icon,
  MaximizeIcon,
  MinimizeIcon,
  LoaderCircleIcon,
  WifiOffIcon,
  RefreshCwIcon,
} from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  useWebConsole,
  type ConnectionState,
} from "@/hooks/use-web-console";

const XTERM_THEME = {
  foreground: "#e4e4e7",
  background: "#09090b",
  cursor: "#e4e4e7",
  selectionBackground: "#e4e4e740",
};

export default function WebConsoleCard() {
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const { connectionState, reconnect, disconnect } = useWebConsole({
    terminalRef,
    fitAddonRef,
  });

  // Initialize xterm on mount
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const terminal = new Terminal({
      theme: XTERM_THEME,
      fontSize: 14,
      fontFamily: "monospace",
      cursorBlink: true,
      allowTransparency: true,
      scrollback: 5000,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.open(container);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Initial fit
    requestAnimationFrame(() => {
      fitAddon.fit();
    });

    // Resize observer to keep terminal fitted
    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        fitAddon.fit();
      });
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  const handleClear = useCallback(() => {
    terminalRef.current?.clear();
  }, []);

  const handleToggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => !prev);
  }, []);

  // Re-fit terminal when fullscreen changes
  useEffect(() => {
    requestAnimationFrame(() => {
      fitAddonRef.current?.fit();
    });
  }, [isFullscreen]);

  const isUnavailable = connectionState === "unavailable";

  return (
    <Card
      className={`flex flex-col overflow-hidden gap-0 py-0 ${
        isFullscreen
          ? "fixed inset-0 z-50 rounded-none"
          : "h-[calc(100vh-theme(spacing.16))]"
      }`}
    >
      {/* Header bar */}
      <div className="bg-muted flex items-center gap-2 border-b px-3 py-2">
        <TerminalSquareIcon className="text-muted-foreground size-4" />
        <span className="text-muted-foreground text-sm font-medium">
          Web Console
        </span>
        <div className="ml-auto flex gap-1">
          <Button
            variant="ghost"
            size="xs"
            onClick={handleClear}
            disabled={isUnavailable}
          >
            <Trash2Icon />
            Clear
          </Button>
          <Button variant="ghost" size="xs" onClick={handleToggleFullscreen}>
            {isFullscreen ? <MinimizeIcon /> : <MaximizeIcon />}
            {isFullscreen ? "Exit" : "Fullscreen"}
          </Button>
        </div>
      </div>

      {/* Terminal area */}
      <div className="relative flex-1 min-h-0">
        <div
          ref={containerRef}
          className={`h-full w-full ${isUnavailable ? "hidden" : ""}`}
          style={{ backgroundColor: "#09090b" }}
        />

        {/* Unavailable empty state */}
        {isUnavailable && (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-4">
            <WifiOffIcon className="text-muted-foreground size-10 opacity-50" />
            <div className="text-center">
              <p className="text-muted-foreground text-sm font-medium">
                Web Console is not available
              </p>
              <p className="text-muted-foreground/60 mt-1 text-xs">
                ttyd is not installed or not running.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={reconnect}>
              <RefreshCwIcon />
              Retry
            </Button>
          </div>
        )}
      </div>

      {/* Status bar */}
      {!isUnavailable && (
        <StatusBar
          connectionState={connectionState}
          onReconnect={reconnect}
        />
      )}
    </Card>
  );
}

function StatusBar({
  connectionState,
  onReconnect,
}: {
  connectionState: ConnectionState;
  onReconnect: () => void;
}) {
  const dotColor =
    connectionState === "connected"
      ? "bg-success"
      : connectionState === "disconnected"
        ? "bg-destructive"
        : "bg-warning";

  const label =
    connectionState === "connected"
      ? "Connected"
      : connectionState === "disconnected"
        ? "Disconnected"
        : connectionState === "reconnecting"
          ? "Reconnecting..."
          : "Connecting...";

  const showSpinner =
    connectionState === "connecting" || connectionState === "reconnecting";

  return (
    <div className="bg-muted/50 flex items-center gap-2 border-t px-3 py-1.5">
      <div className="flex items-center gap-1.5">
        {showSpinner ? (
          <LoaderCircleIcon className="text-warning size-3 animate-spin" />
        ) : (
          <span className={`size-2 rounded-full ${dotColor}`} />
        )}
        <span className="text-muted-foreground text-xs">{label}</span>
      </div>
      {connectionState === "disconnected" && (
        <Button
          variant="ghost"
          size="xs"
          onClick={onReconnect}
          className="ml-auto h-5 text-xs"
        >
          <RefreshCwIcon />
          Reconnect
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run:
```bash
bunx tsc --noEmit 2>&1 | head -20
```

Expected: No errors related to `web-console-card.tsx`.

- [ ] **Step 3: Commit**

```bash
git add components/system-settings/web-console/web-console-card.tsx
git commit -m "feat: add WebConsoleCard component with xterm.js and status bar"
```

---

### Task 4: Create the Route Page and Update Sidebar

**Files:**
- Create: `app/system-settings/web-console/page.tsx`
- Modify: `components/app-sidebar.tsx:83`

- [ ] **Step 1: Create the route page**

Create `app/system-settings/web-console/page.tsx`:

```tsx
import WebConsoleCard from "@/components/system-settings/web-console/web-console-card";

const WebConsolePage = () => {
  return (
    <div className="@container/main mx-auto h-full p-2">
      <WebConsoleCard />
    </div>
  );
};

export default WebConsolePage;
```

- [ ] **Step 2: Update sidebar link**

In `components/app-sidebar.tsx`, change line 83:

```typescript
// Before
url: "/console",

// After
url: "/system-settings/web-console",
```

- [ ] **Step 3: Verify build compiles**

Run:
```bash
bun run build 2>&1 | tail -30
```

Expected: Build succeeds. The `/system-settings/web-console/` route is listed in output.

- [ ] **Step 4: Commit**

```bash
git add app/system-settings/web-console/page.tsx components/app-sidebar.tsx
git commit -m "feat: add Web Console route and update sidebar navigation"
```

---

### Task 5: Verify Full Build and Manual Test

**Files:** None (verification only)

- [ ] **Step 1: Run full build**

Run:
```bash
bun run build
```

Expected: Clean build with no errors. Route `/system-settings/web-console` appears in output.

- [ ] **Step 2: Run lint**

Run:
```bash
bun run lint
```

Expected: No new lint errors from the added files.

- [ ] **Step 3: Manual test checklist**

After deploying to the device or running dev server:

1. Navigate to Web Console via sidebar — sidebar stays visible
2. If ttyd is running: terminal connects, shows bash prompt, accepts input
3. Type a command (e.g., `ls /usrdata/`) — output appears
4. Click Clear — terminal buffer clears
5. Click Fullscreen — card fills viewport; click Exit — returns to normal
6. Kill ttyd on device (`systemctl stop qmanager-console`) — status bar shows Disconnected → Reconnecting
7. After 3 rapid failures — shows "Web Console is not available" with Retry button
8. Restart ttyd → click Retry — reconnects
