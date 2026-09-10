"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";

// =============================================================================
// useWebConsole — WebSocket + ttyd Protocol Hook
// =============================================================================
// Manages the WebSocket connection to the ttyd console backend at /console/ws.
// Handles the ttyd binary protocol for I/O, implements exponential backoff
// reconnection, and bridges xterm.js terminal events to the WebSocket.
//
// ttyd uses ASCII character codes as message type bytes (NOT raw integers).
//
// Server → Client (receive):
//   '0' (0x30) = OUTPUT         — terminal data to write
//   '1' (0x31) = SET_WINDOW_TITLE — ignored
//   '2' (0x32) = SET_PREFERENCES  — ignored
//
// Client → Server (send):
//   '0' (0x30) = INPUT  — keyboard/paste data from terminal
//   '1' (0x31) = RESIZE — terminal resize event
//   '{'  (0x7B) = JSON_DATA — initial handshake (AuthToken + dimensions)
//
// The client MUST send a JSON_DATA message immediately on connect before
// ttyd will start the shell. The opening '{' of the JSON IS the command byte.
//
// The WebSocket MUST use the 'tty' subprotocol.
//
// The hook surfaces a discriminated FAILURE KIND rather than a sentence: the
// close code is machine voice, and the copy for it belongs to the component.
// =============================================================================

// ─── Protocol constants (ASCII character codes) ────────────────────────────

const RECV_OUTPUT = 0x30; // '0'

const SEND_INPUT = 0x30; // '0'
const SEND_RESIZE = 0x31; // '1'

// ─── Reconnect config ──────────────────────────────────────────────────────

const BACKOFF_INITIAL_MS = 1_000;
const BACKOFF_MAX_MS = 10_000;
const BACKOFF_MULTIPLIER = 2;

/** Number of rapid consecutive failures before giving up auto-retry */
const MAX_RAPID_FAILURES = 3;
/** A close within this many ms of opening is considered "rapid" */
const RAPID_CLOSE_WINDOW_MS = 2_000;

// ─── Close-code classification ─────────────────────────────────────────────
// 1000 is a normal close; 1005 is the code the browser reports when the peer
// closed without sending one at all. From a session that actually ran, both
// mean the shell exited.
const CLEAN_CLOSE_CODES = new Set([1000, 1005]);

// A status the server chose to send: protocol error, policy, internal fault,
// or "try again later". Retrying on a schedule cannot clear any of them.
const REFUSAL_CODES = new Set([1002, 1003, 1008, 1011, 1013]);
/** Application-defined statuses start here; ttyd's own refusals land in range. */
const APP_STATUS_FLOOR = 4000;

// ─── Types ─────────────────────────────────────────────────────────────────

export type ConnectionState =
  | "connecting"
  | "connected"
  | "disconnected"
  | "reconnecting"
  | "unavailable";

/**
 * Why the console is not connected.
 *
 *   unreachable — the handshake never completed on any attempt: ttyd is an
 *                 optional component, so it may not be installed or running.
 *   refused     — the server closed with a status of its own choosing.
 *   dropped     — a session was running and the link went away.
 *   ended       — a clean close after a real session: the shell exited.
 */
export type ConsoleFailureKind =
  | "unreachable"
  | "refused"
  | "dropped"
  | "ended";

export interface ConsoleFailure {
  kind: ConsoleFailureKind;
  /** The raw close code, machine voice. Null when none was reported. */
  code: number | null;
  /** The server's own close reason, verbatim. Usually empty. */
  reason: string;
}

interface UseWebConsoleOptions {
  terminalRef: React.RefObject<Terminal | null>;
  fitAddonRef: React.RefObject<FitAddon | null>;
}

interface UseWebConsoleReturn {
  connectionState: ConnectionState;
  /** Non-null only while the console is disconnected or unavailable. */
  failure: ConsoleFailure | null;
  /** True once any attempt has reached an open socket. */
  hasOpened: boolean;
  reconnect: () => void;
  disconnect: () => void;
}

// ─── URL helper ────────────────────────────────────────────────────────────

function getWsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/console/ws`;
}

/** The browser's own view of the link, used only to sharpen a give-up verdict. */
function linkIsDown(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

// ─── Hook ──────────────────────────────────────────────────────────────────

export function useWebConsole({
  terminalRef,
  fitAddonRef,
}: UseWebConsoleOptions): UseWebConsoleReturn {
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("connecting");
  const [failure, setFailure] = useState<ConsoleFailure | null>(null);
  const [hasOpened, setHasOpened] = useState(false);

  // Stable refs — never cause re-renders, safe in closures
  const wsRef = useRef<WebSocket | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const encoderRef = useRef(new TextEncoder());
  const mountedRef = useRef(true);

  // Reconnect bookkeeping
  const backoffMsRef = useRef(BACKOFF_INITIAL_MS);
  const rapidFailCountRef = useRef(0);
  const openedAtRef = useRef<number | null>(null);
  /** Whether ANY attempt since the last manual reconnect reached an open socket. */
  const everOpenedRef = useRef(false);

  // Xterm disposable refs — cleaned up on reconnect / unmount
  const onDataDisposableRef = useRef<{ dispose(): void } | null>(null);
  const onResizeDisposableRef = useRef<{ dispose(): void } | null>(null);

  // ── Helpers ──────────────────────────────────────────────────────────────

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const disposeTerminalListeners = useCallback(() => {
    onDataDisposableRef.current?.dispose();
    onDataDisposableRef.current = null;
    onResizeDisposableRef.current?.dispose();
    onResizeDisposableRef.current = null;
  }, []);

  const closeSocket = useCallback((ws: WebSocket) => {
    // Remove all listeners before closing to prevent triggering reconnect
    ws.onopen = null;
    ws.onmessage = null;
    ws.onclose = null;
    ws.onerror = null;
    if (
      ws.readyState === WebSocket.OPEN ||
      ws.readyState === WebSocket.CONNECTING
    ) {
      ws.close();
    }
  }, []);

  // ── Send helpers ─────────────────────────────────────────────────────────

  const sendInput = useCallback((data: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const encoded = encoderRef.current.encode(data);
    const msg = new Uint8Array(1 + encoded.byteLength);
    msg[0] = SEND_INPUT;
    msg.set(encoded, 1);
    ws.send(msg);
  }, []);

  const sendResize = useCallback((cols: number, rows: number) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const payload = encoderRef.current.encode(
      JSON.stringify({ columns: cols, rows })
    );
    const msg = new Uint8Array(1 + payload.byteLength);
    msg[0] = SEND_RESIZE;
    msg.set(payload, 1);
    ws.send(msg);
  }, []);

  // ── Connect ──────────────────────────────────────────────────────────────

  // Forward-declare so scheduleReconnect can reference connect
  const connectRef = useRef<() => void>(() => {});

  const scheduleReconnect = useCallback(() => {
    if (!mountedRef.current) return;

    clearRetryTimer();
    setConnectionState("reconnecting");

    retryTimerRef.current = setTimeout(() => {
      if (mountedRef.current) {
        connectRef.current();
      }
    }, backoffMsRef.current);

    // Advance backoff, capped at max
    backoffMsRef.current = Math.min(
      backoffMsRef.current * BACKOFF_MULTIPLIER,
      BACKOFF_MAX_MS
    );
  }, [clearRetryTimer]);

  /** Land on a terminal state: no further auto-retry, and say why. */
  const settleFailed = useCallback(
    (
      kind: ConsoleFailureKind,
      state: "disconnected" | "unavailable",
      code: number | null,
      reason: string
    ) => {
      setFailure({ kind, code, reason });
      setConnectionState(state);
    },
    []
  );

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    // Tear down any existing socket
    if (wsRef.current) {
      closeSocket(wsRef.current);
      wsRef.current = null;
    }
    disposeTerminalListeners();

    setConnectionState("connecting");
    setFailure(null);
    openedAtRef.current = null;

    const ws = new WebSocket(getWsUrl(), ["tty"]);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;

      openedAtRef.current = Date.now();
      everOpenedRef.current = true;
      rapidFailCountRef.current = 0;
      backoffMsRef.current = BACKOFF_INITIAL_MS;
      setHasOpened(true);
      setConnectionState("connected");

      // Wire up terminal → WebSocket
      const terminal = terminalRef.current;
      if (terminal) {
        disposeTerminalListeners();

        onDataDisposableRef.current = terminal.onData(sendInput);
        onResizeDisposableRef.current = terminal.onResize(({ cols, rows }) => {
          sendResize(cols, rows);
        });

        // Fit terminal to container first
        const fit = fitAddonRef.current;
        if (fit) {
          try {
            fit.fit();
          } catch {
            // fit may throw if terminal is not yet visible — non-fatal
          }
        }

        // Send JSON_DATA handshake — ttyd requires this before starting the shell.
        // The opening '{' of the JSON IS the command byte (0x7B = JSON_DATA).
        // No separate prefix byte — send the raw JSON string.
        const handshake = JSON.stringify({
          AuthToken: "",
          columns: terminal.cols,
          rows: terminal.rows,
        });
        ws.send(encoderRef.current.encode(handshake));
      }
    };

    ws.onmessage = (event: MessageEvent) => {
      if (!mountedRef.current) return;

      const data = new Uint8Array(event.data as ArrayBuffer);
      if (data.length < 1) return;
      const msgType = data[0];
      switch (msgType) {
        case RECV_OUTPUT:
          terminalRef.current?.write(data.subarray(1));
          break;
        // types 1, 2 intentionally ignored
      }
    };

    ws.onclose = (event: CloseEvent) => {
      if (!mountedRef.current) return;

      disposeTerminalListeners();
      wsRef.current = null;

      const code = event.code;
      const reason = event.reason;
      const openedAt = openedAtRef.current;
      const attemptOpened = openedAt !== null;
      const wasRapid =
        !attemptOpened || Date.now() - openedAt < RAPID_CLOSE_WINDOW_MS;

      // A clean close from a session that actually ran is the shell exiting,
      // not a fault — reconnecting on a timer would restart it behind the user.
      if (attemptOpened && CLEAN_CLOSE_CODES.has(code)) {
        settleFailed("ended", "unavailable", code, reason);
        return;
      }

      // A status the server chose to send is a refusal; a schedule cannot fix it.
      if (REFUSAL_CODES.has(code) || code >= APP_STATUS_FLOOR) {
        settleFailed("refused", "disconnected", code, reason);
        return;
      }

      if (wasRapid) {
        rapidFailCountRef.current += 1;
      } else {
        rapidFailCountRef.current = 0;
      }

      if (rapidFailCountRef.current >= MAX_RAPID_FAILURES) {
        // Never having reached an open socket is the signal that separates
        // "ttyd is not there" from "the console was running and the link went".
        if (everOpenedRef.current || linkIsDown()) {
          settleFailed("dropped", "disconnected", code, reason);
        } else {
          settleFailed("unreachable", "unavailable", code, reason);
        }
        return;
      }

      scheduleReconnect();
    };

    ws.onerror = () => {
      // onerror is always followed by onclose — let onclose handle reconnect
      // Just ensure we don't stay "connecting" indefinitely if open never fired
    };
  }, [
    closeSocket,
    disposeTerminalListeners,
    sendInput,
    sendResize,
    scheduleReconnect,
    settleFailed,
    terminalRef,
    fitAddonRef,
  ]);

  // Keep the ref in sync so scheduleReconnect can always call the latest connect
  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  // ── Public API ───────────────────────────────────────────────────────────

  const reconnect = useCallback(() => {
    clearRetryTimer();
    rapidFailCountRef.current = 0;
    backoffMsRef.current = BACKOFF_INITIAL_MS;
    everOpenedRef.current = false;
    connect();
  }, [clearRetryTimer, connect]);

  const disconnect = useCallback(() => {
    clearRetryTimer();
    disposeTerminalListeners();
    if (wsRef.current) {
      closeSocket(wsRef.current);
      wsRef.current = null;
    }
    if (mountedRef.current) {
      settleFailed("ended", "unavailable", null, "");
    }
  }, [clearRetryTimer, disposeTerminalListeners, closeSocket, settleFailed]);

  // ── Lifecycle ────────────────────────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true;
    // Defer connect to avoid synchronous setState inside effect body
    const id = setTimeout(connect, 0);

    return () => {
      clearTimeout(id);
      mountedRef.current = false;
      clearRetryTimer();
      disposeTerminalListeners();
      if (wsRef.current) {
        closeSocket(wsRef.current);
        wsRef.current = null;
      }
    };
  }, [connect, clearRetryTimer, closeSocket, disposeTerminalListeners]);

  return { connectionState, failure, hasOpened, reconnect, disconnect };
}
