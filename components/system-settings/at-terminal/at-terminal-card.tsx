"use client";

import { useState, useEffect, useRef, useCallback, useMemo, type FormEvent } from "react";
import {
  TerminalIcon,
  TriangleAlertIcon,
  DownloadIcon,
  Trash2Icon,
  LoaderCircleIcon,
  ChevronRightIcon,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupInput,
  InputGroupButton,
  InputGroupText,
} from "@/components/ui/input-group";
import { authFetch } from "@/lib/auth-fetch";
import CommandsPopover from "@/components/system-settings/at-terminal/commands-popover";

// --- Types ---

interface HistoryEntry {
  id: string;
  command: string;
  response: string;
  status: "success" | "error" | "blocked";
  timestamp: number;
}

interface Warning {
  message: string;
  command: string;
}

// --- Safety rules ---

const BLOCKED_COMMANDS = [
  {
    pattern: /\bQSCANFREQ\b/i,
    message: "Use the Cell Scanner page for frequency scanning.",
  },
  {
    pattern: /\bQSCAN\b/i,
    message: "Use the Cell Scanner page for network scanning.",
  },
  {
    pattern: /QCFG\s*=\s*"resetfactory"/i,
    message: "Factory reset is not allowed from the terminal.",
  },
];

const WARNING_COMMANDS = [
  {
    pattern: /CFUN\s*=\s*[04]\b/i,
    message:
      "This will disable the modem radio. If connected via Tailscale, you may lose access to this UI.",
  },
];

// --- Constants ---

const STORAGE_KEY = "qm_at_history";
const MAX_HISTORY = 100;
const CGI_ENDPOINT = "/cgi-bin/quecmanager/at_cmd/send_command.sh";

// --- Helpers ---

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistory(entries: HistoryEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Quota exceeded — degrade to in-memory only
  }
}

function formatExport(entries: HistoryEntry[]): string {
  return entries
    .map((e) => {
      const date = new Date(e.timestamp);
      const ts = date.toISOString().replace("T", " ").slice(0, 19);
      return `[${ts}] ❯ ${e.command}\n${e.response}`;
    })
    .join("\n\n");
}

// --- Component ---

export default function ATTerminalCard() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [warning, setWarning] = useState<Warning | null>(null);
  const [lastCommand, setLastCommand] = useState("");
  const [suggestionIndex, setSuggestionIndex] = useState(0);

  const suggestions = useMemo(() => {
    if (!input.trim()) return [];
    const seen = new Set<string>();
    return history
      .slice()
      .reverse()
      .filter((e) => {
        if (e.status === "blocked") return false;
        const cmd = e.command.toUpperCase();
        if (seen.has(cmd) || !cmd.startsWith(input.trim().toUpperCase()))
          return false;
        seen.add(cmd);
        return true;
      })
      .map((e) => e.command);
  }, [history, input]);

  const historyEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load history from localStorage on mount
  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  // Sync history to localStorage and auto-scroll
  useEffect(() => {
    if (history.length > 0) {
      saveHistory(history);
      historyEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [history]);

  const appendEntry = useCallback(
    (entry: Omit<HistoryEntry, "id" | "timestamp">) => {
      setHistory((prev) => {
        const next = [
          ...prev,
          { ...entry, id: generateId(), timestamp: Date.now() },
        ];
        return next.length > MAX_HISTORY ? next.slice(-MAX_HISTORY) : next;
      });
    },
    [],
  );

  const sendCommand = useCallback(
    async (command: string) => {
      setIsLoading(true);
      try {
        const resp = await authFetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command }),
        });
        const json = await resp.json();
        if (json.success) {
          appendEntry({
            command,
            response: json.response ?? "",
            status: "success",
          });
        } else {
          appendEntry({
            command,
            response: json.detail ?? json.error ?? "Command failed",
            status: "error",
          });
        }
      } catch {
        appendEntry({
          command,
          response: "Failed to reach modem",
          status: "error",
        });
      } finally {
        setIsLoading(false);
        setInput("");
        inputRef.current?.focus();
      }
    },
    [appendEntry],
  );

  const handleSubmit = useCallback(
    (e?: FormEvent) => {
      e?.preventDefault();
      const trimmed = input.trim();
      if (!trimmed || isLoading) return;

      // Check blocked commands
      for (const rule of BLOCKED_COMMANDS) {
        if (rule.pattern.test(trimmed)) {
          appendEntry({
            command: trimmed,
            response: rule.message,
            status: "blocked",
          });
          setInput("");
          setLastCommand(trimmed);
          return;
        }
      }

      // Check warning commands
      for (const rule of WARNING_COMMANDS) {
        if (rule.pattern.test(trimmed)) {
          setWarning({ message: rule.message, command: trimmed });
          return;
        }
      }

      setLastCommand(trimmed);
      sendCommand(trimmed);
    },
    [input, isLoading, appendEntry, sendCommand],
  );

  const handleSendAnyway = useCallback(() => {
    if (!warning) return;
    const cmd = warning.command;
    setLastCommand(cmd);
    setWarning(null);
    setInput("");
    sendCommand(cmd);
  }, [warning, sendCommand]);

  const handleCancelWarning = useCallback(() => {
    setWarning(null);
    inputRef.current?.focus();
  }, []);

  const handleClear = useCallback(() => {
    setHistory([]);
    localStorage.removeItem(STORAGE_KEY);
    setWarning(null);
    inputRef.current?.focus();
  }, []);

  const handleExport = useCallback(() => {
    const text = formatExport(history);
    const date = new Date().toISOString().slice(0, 10);
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `at-terminal-export-${date}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [history]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Tab") {
        if (suggestions.length > 0) {
          e.preventDefault();
          setInput(suggestions[suggestionIndex]);
          setSuggestionIndex((prev) => (prev + 1) % suggestions.length);
        }
        return;
      }

      if (
        e.key === "ArrowUp" &&
        (input === "" || e.currentTarget.selectionStart === 0)
      ) {
        e.preventDefault();
        if (lastCommand) {
          setInput(lastCommand);
        }
        return;
      }

      setSuggestionIndex(0);
    },
    [input, lastCommand, suggestions, suggestionIndex],
  );

  const isEmpty = history.length === 0;
  const inputDisabled = isLoading || warning !== null;

  return (
    <Card className="overflow-hidden gap-0 py-0">
      {/* Header bar */}
      <div className="bg-muted flex items-center gap-2 border-b px-3 py-2">
        <TerminalIcon className="text-muted-foreground size-4" />
        <span className="text-muted-foreground text-sm font-medium">
          AT Terminal
        </span>
        <div className="ml-auto flex gap-1">
          <CommandsPopover onSelect={setInput} inputRef={inputRef} />
          <Button
            variant="ghost"
            size="xs"
            onClick={handleClear}
            disabled={isEmpty}
          >
            <Trash2Icon />
            Clear
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={handleExport}
            disabled={isEmpty}
          >
            <DownloadIcon />
            Export
          </Button>
        </div>
      </div>

      {/* History area */}
      <div
        className="max-h-[60vh] min-h-48 overflow-y-auto px-4 py-3"
        aria-live="polite"
      >
        {isEmpty ? (
          <div className="text-muted-foreground flex h-40 items-center justify-center text-sm">
            No commands yet. Type an AT command below.
          </div>
        ) : (
          <div className="space-y-3">
            {history.map((entry) => (
              <HistoryEntryRow key={entry.id} entry={entry} />
            ))}
            <div ref={historyEndRef} />
          </div>
        )}
      </div>

      {/* Suggestion hint */}
      {suggestions.length > 0 && !warning && (
        <div className="flex items-center gap-1.5 px-4 pb-1.5">
          <span className="font-mono text-sm text-muted-foreground/40 italic">
            {suggestions[suggestionIndex % suggestions.length]}
          </span>
          <kbd className="rounded bg-muted px-1 py-0.5 text-[9px] text-muted-foreground/35">
            Tab
          </kbd>
        </div>
      )}

      {/* Warning banner */}
      {warning && (
        <div className="mx-3 mb-2 rounded-lg border border-warning/30 bg-warning/10 p-3">
          <div className="text-warning mb-1 flex items-center gap-1.5 text-sm font-semibold">
            <TriangleAlertIcon className="size-4" />
            Warning
          </div>
          <p className="text-muted-foreground mb-2 text-sm">
            <code className="bg-warning/10 rounded px-1 py-0.5 text-xs">
              {warning.command}
            </code>{" "}
            {warning.message}
          </p>
          <div className="flex gap-2">
            <Button
              size="xs"
              className="bg-warning text-warning-foreground hover:bg-warning/90"
              onClick={handleSendAnyway}
            >
              Send Anyway
            </Button>
            <Button variant="outline" size="xs" onClick={handleCancelWarning}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Input bar */}
      <form onSubmit={handleSubmit} className="border-t">
        <InputGroup className="rounded-none border-0 shadow-none">
          <InputGroupText className="font-mono pl-3">❯</InputGroupText>
          <InputGroupInput
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="AT+COPS?"
            disabled={inputDisabled}
            className="font-mono text-sm"
            autoComplete="off"
            spellCheck={false}
          />
          <InputGroupButton
            type="submit"
            variant="default"
            size="sm"
            disabled={inputDisabled || input.trim() === ""}
            className="mr-1.5"
          >
            {isLoading ? (
              <LoaderCircleIcon className="animate-spin" />
            ) : (
              <ChevronRightIcon />
            )}
            Send
          </InputGroupButton>
        </InputGroup>
      </form>
    </Card>
  );
}

// --- History entry row ---

function HistoryEntryRow({ entry }: { entry: HistoryEntry }) {
  const colorClass =
    entry.status === "blocked"
      ? "text-destructive"
      : entry.status === "error"
        ? "text-destructive"
        : "text-success";

  return (
    <div className="font-mono text-sm">
      <div className={`font-medium ${colorClass}`}>❯ {entry.command}</div>
      <div
        className={`mt-0.5 ml-4 whitespace-pre-wrap ${
          entry.status === "blocked" || entry.status === "error"
            ? "text-destructive/80 text-xs"
            : "text-muted-foreground"
        }`}
      >
        {entry.response}
      </div>
    </div>
  );
}
