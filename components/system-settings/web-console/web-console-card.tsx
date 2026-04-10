"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import {
  TerminalSquareIcon,
  Trash2Icon,
  MaximizeIcon,
  MinimizeIcon,
  LoaderCircleIcon,
  WifiOffIcon,
  RefreshCwIcon,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { useWebConsole, type ConnectionState } from "@/hooks/use-web-console";

// =============================================================================
// Constants
// =============================================================================

const XTERM_THEME = {
  foreground: "#e4e4e7",
  background: "#09090b",
  cursor: "#e4e4e7",
  selectionBackground: "#e4e4e740",
};

// =============================================================================
// StatusBar — bottom strip showing connection state
// =============================================================================

interface StatusBarProps {
  connectionState: ConnectionState;
  onReconnect: () => void;
}

function StatusBar({ connectionState, onReconnect }: StatusBarProps) {
  const isConnecting =
    connectionState === "connecting" || connectionState === "reconnecting";
  const isConnected = connectionState === "connected";
  const isDisconnected = connectionState === "disconnected";

  return (
    <div className="bg-muted/50 flex items-center gap-2 border-t px-3 py-1.5">
      {/* State indicator */}
      {isConnecting && (
        <>
          <LoaderCircleIcon className="size-3 animate-spin text-warning" />
          <span className="text-muted-foreground text-xs">
            {connectionState === "reconnecting" ? "Reconnecting..." : "Connecting..."}
          </span>
        </>
      )}
      {isConnected && (
        <>
          <span className="bg-success size-2 rounded-full" />
          <span className="text-muted-foreground text-xs">Connected</span>
        </>
      )}
      {isDisconnected && (
        <>
          <span className="bg-destructive size-2 rounded-full" />
          <span className="text-muted-foreground text-xs">Disconnected</span>
          <div className="ml-auto">
            <Button
              variant="ghost"
              size="xs"
              className="h-5 text-xs"
              onClick={onReconnect}
            >
              <RefreshCwIcon />
              Reconnect
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

// =============================================================================
// WebConsoleCard
// =============================================================================

export default function WebConsoleCard() {
  const [isFullscreen, setIsFullscreen] = useState(false);

  // xterm refs — passed to the hook
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  // DOM container ref for xterm to mount into
  const containerRef = useRef<HTMLDivElement | null>(null);

  const { connectionState, reconnect } = useWebConsole({
    terminalRef,
    fitAddonRef,
  });

  const isUnavailable = connectionState === "unavailable";

  // ── xterm initialization ─────────────────────────────────────────────────

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Create terminal
    const terminal = new Terminal({
      theme: XTERM_THEME,
      allowTransparency: true,
      fontSize: 14,
      fontFamily: "monospace",
      cursorBlink: true,
      scrollback: 5000,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.open(container);

    // Initial fit
    try {
      fitAddon.fit();
    } catch {
      // Non-fatal — terminal may not be visible yet
    }

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // ResizeObserver to refit on container size changes
    const observer = new ResizeObserver(() => {
      try {
        fitAddon.fit();
      } catch {
        // Non-fatal
      }
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  // ── Fullscreen toggle ────────────────────────────────────────────────────

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => !prev);
  }, []);

  useEffect(() => {
    requestAnimationFrame(() => {
      try {
        fitAddonRef.current?.fit();
      } catch {
        // Non-fatal
      }
    });
  }, [isFullscreen]);

  // ── Clear ────────────────────────────────────────────────────────────────

  const handleClear = useCallback(() => {
    terminalRef.current?.clear();
  }, []);

  // ── Layout classes ───────────────────────────────────────────────────────

  const cardClasses = isFullscreen
    ? "fixed inset-0 z-50 rounded-none overflow-hidden gap-0 py-0 flex flex-col"
    : "overflow-hidden gap-0 py-0 flex flex-col h-[calc(100vh-theme(spacing.16))]";

  return (
    <Card className={cardClasses}>
      {/* ── Header bar ────────────────────────────────────────────────────── */}
      <div className="bg-muted flex items-center gap-2 border-b px-3 py-2">
        <TerminalSquareIcon className="text-muted-foreground size-4" />
        <span className="text-muted-foreground text-sm font-medium">
          Web Console
        </span>

        {/* Keyboard shortcut hints — hidden on narrow viewports */}
        <div className="ml-4 hidden items-center gap-3 lg:flex">
          <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
            Copy
            <KbdGroup>
              <Kbd>Ctrl</Kbd>
              <Kbd>Shift</Kbd>
              <Kbd>C</Kbd>
            </KbdGroup>
          </span>
          <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
            Paste
            <KbdGroup>
              <Kbd>Ctrl</Kbd>
              <Kbd>Shift</Kbd>
              <Kbd>V</Kbd>
            </KbdGroup>
          </span>
        </div>

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
          <Button variant="ghost" size="xs" onClick={toggleFullscreen}>
            {isFullscreen ? <MinimizeIcon /> : <MaximizeIcon />}
            {isFullscreen ? "Exit" : "Fullscreen"}
          </Button>
        </div>
      </div>

      {/* ── Terminal area ──────────────────────────────────────────────────── */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {/* xterm container — hidden (not removed) when unavailable */}
        <div
          ref={containerRef}
          className="flex-1 min-h-0"
          style={{
            background: XTERM_THEME.background,
            display: isUnavailable ? "none" : undefined,
          }}
        />

        {/* Unavailable empty state */}
        {isUnavailable && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-12">
            <WifiOffIcon className="text-muted-foreground size-10 opacity-50" />
            <div className="text-center">
              <p className="text-sm font-medium">Web Console is not available</p>
              <p className="text-muted-foreground text-xs">
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

      {/* ── Status bar ────────────────────────────────────────────────────── */}
      {!isUnavailable && (
        <StatusBar connectionState={connectionState} onReconnect={reconnect} />
      )}
    </Card>
  );
}
