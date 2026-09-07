"use client";

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  useId,
  type FormEvent,
} from "react";
import {
  TerminalIcon,
  TriangleAlertIcon,
  DownloadIcon,
  Trash2Icon,
  LoaderCircleIcon,
  ChevronRightIcon,
  Gamepad2Icon,
} from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Kbd } from "@/components/ui/kbd";
import { ConditionBlock } from "@/components/system-settings/condition-block";
import { authFetch } from "@/lib/auth-fetch";
import { transitionStandard } from "@/lib/motion";
import { cn } from "@/lib/utils";
import CommandsPopover from "@/components/system-settings/at-terminal/commands-popover";
import SignalStormGame from "@/components/system-settings/at-terminal/signal-storm-game";

import { TranscriptRow } from "./transcript-row";
import {
  CGI_ENDPOINT,
  GAME_COMMAND,
  MAX_HISTORY,
  STORAGE_KEY,
  formatExport,
  generateId,
  isNearBottom,
  loadHistory,
  matchBlocked,
  matchWarning,
  prefersReducedMotion,
  saveHistory,
  type HistoryEntry,
  type PendingGate,
} from "./derive";
import {
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  CHIP_GLYPH,
  CONSOLE_BODY,
  FOCUS_RING,
  GATE,
  HEAD_ACTION,
  HEAD_ACTIONS,
  HEAD_GLYPH,
  HINT,
  PROMPT,
  TRANSCRIPT,
} from "./shapes";

const K = "at_terminal";

export default function ATTerminalCard() {
  const { t } = useTranslation("system-settings");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [gate, setGate] = useState<PendingGate | null>(null);
  const [lastCommand, setLastCommand] = useState("");
  const [gameActive, setGameActive] = useState(false);
  const [suggestionIndex, setSuggestionIndex] = useState(0);

  const inputId = useId();

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
  const viewportRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Whether the reader was at the foot BEFORE the new row landed. Sampled in
  // the submit path, because by the time the effect runs the row is already in.
  const followRef = useRef(true);

  // Load history from localStorage on mount
  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  // Sync history to localStorage, and follow the foot only when the reader was
  // already there — an unconditional scroll yanks the view mid-read.
  useEffect(() => {
    if (history.length === 0) return;
    saveHistory(history);
    if (!followRef.current) return;
    historyEndRef.current?.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "end",
    });
  }, [history]);

  const appendEntry = useCallback(
    (entry: Omit<HistoryEntry, "id" | "timestamp">) => {
      followRef.current = isNearBottom(viewportRef.current);
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
            response: json.detail ?? json.error ?? t(`${K}.responses.failed`),
            status: "error",
          });
        }
      } catch (err) {
        appendEntry({
          command,
          response:
            err instanceof TypeError
              ? t(`${K}.responses.unreachable`)
              : t(`${K}.responses.unexpected`),
          status: "error",
        });
      } finally {
        setIsLoading(false);
        setInput("");
        inputRef.current?.focus();
      }
    },
    [appendEntry, t],
  );

  const handleSubmit = useCallback(
    (e?: FormEvent) => {
      e?.preventDefault();
      const trimmed = input.trim();
      if (!trimmed || isLoading) return;

      // Easter egg
      if (trimmed.toUpperCase() === GAME_COMMAND) {
        appendEntry({
          command: trimmed,
          response: t(`${K}.responses.game`),
          status: "success",
        });
        setInput("");
        setTimeout(() => setGameActive(true), 500);
        return;
      }

      const blocked = matchBlocked(trimmed);
      if (blocked) {
        appendEntry({
          command: trimmed,
          response: t(`${K}.rules.${blocked}`),
          status: "blocked",
        });
        setInput("");
        setLastCommand(trimmed);
        return;
      }

      const warned = matchWarning(trimmed);
      if (warned) {
        setGate({ command: trimmed, rule: warned });
        return;
      }

      setLastCommand(trimmed);
      sendCommand(trimmed);
    },
    [input, isLoading, appendEntry, sendCommand, t],
  );

  const handleSendAnyway = useCallback(() => {
    if (!gate) return;
    const cmd = gate.command;
    setLastCommand(cmd);
    setGate(null);
    setInput("");
    sendCommand(cmd);
  }, [gate, sendCommand]);

  const handleCancelGate = useCallback(() => {
    setGate(null);
    inputRef.current?.focus();
  }, []);

  const handleClear = useCallback(() => {
    setHistory([]);
    localStorage.removeItem(STORAGE_KEY);
    setGate(null);
    followRef.current = true;
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
  const inputDisabled = isLoading || gate !== null || gameActive;

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={CARD_PAD}>
        <CardTitle className={CARD_TITLE}>{t(`${K}.card.title`)}</CardTitle>
        <CardDescription className={CARD_DESC}>
          {t(`${K}.card.description`)}
        </CardDescription>
        <CardAction className={HEAD_ACTIONS}>
          {gameActive ? (
            <Badge variant="info">
              <Gamepad2Icon className={CHIP_GLYPH} />
              {t(`${K}.game.playing`)}
            </Badge>
          ) : (
            <>
              <CommandsPopover onSelect={setInput} inputRef={inputRef} />
              <Button
                type="button"
                variant="ghost"
                onClick={handleClear}
                disabled={isEmpty}
                className={HEAD_ACTION}
              >
                <Trash2Icon className={HEAD_GLYPH} />
                {t(`${K}.actions.clear`)}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={handleExport}
                disabled={isEmpty}
                className={HEAD_ACTION}
              >
                <DownloadIcon className={HEAD_GLYPH} />
                {t(`${K}.actions.export`)}
              </Button>
            </>
          )}
        </CardAction>
      </CardHeader>

      {/* The game keeps the full-bleed slot it has always had — it is a direct
          Card child, not a padded content box. */}
      {gameActive ? (
        <SignalStormGame onExit={() => setGameActive(false)} />
      ) : (
        <CardContent className={cn(CARD_PAD, CONSOLE_BODY)}>
          <div
            ref={viewportRef}
            className={TRANSCRIPT.ROOT}
            role="log"
            aria-live="polite"
            aria-label={t(`${K}.transcript.label`)}
          >
            {isEmpty ? (
              <div className={TRANSCRIPT.EMPTY}>
                <ConditionBlock
                  tone="neutral"
                  glyph={TerminalIcon}
                  ariaRole="status"
                  title={t(`${K}.empty.title`)}
                  description={t(`${K}.empty.description`)}
                  className={TRANSCRIPT.EMPTY_BLOCK}
                />
              </div>
            ) : (
              <div className={TRANSCRIPT.LIST}>
                {history.map((entry) => (
                  // Each row declares its own initial/animate: a row mounts long
                  // after the page cascade settled, and a variants-only child
                  // that mounts late renders blank.
                  <motion.div
                    key={entry.id}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={transitionStandard}
                  >
                    <TranscriptRow
                      entry={entry}
                      statusWord={t(`${K}.transcript.status.${entry.status}`)}
                      copyLabel={t(`${K}.transcript.copy`)}
                      copiedLabel={t(`${K}.transcript.copied`)}
                    />
                  </motion.div>
                ))}
                <div ref={historyEndRef} />
              </div>
            )}
          </div>

          {suggestions.length > 0 && !gate && (
            <div className={HINT.ROOT}>
              <span className={HINT.TEXT}>
                {suggestions[suggestionIndex % suggestions.length]}
              </span>
              <Kbd className={HINT.KEY}>{t(`${K}.hint.key`)}</Kbd>
              <span className="sr-only">{t(`${K}.hint.label`)}</span>
            </div>
          )}

          {gate && (
            <div className={GATE.ROOT} role="alert">
              <span aria-hidden="true" className={GATE.DISC}>
                <TriangleAlertIcon className={GATE.DISC_GLYPH} />
              </span>
              <div className={GATE.BODY}>
                <span className={GATE.TITLE}>{t(`${K}.gate.title`)}</span>
                <p className={GATE.TEXT}>{t(`${K}.rules.${gate.rule}`)}</p>
                <span className={GATE.COMMAND}>{gate.command}</span>
                <div className={GATE.ACTIONS}>
                  <button
                    type="button"
                    onClick={handleSendAnyway}
                    className={cn(GATE.ACTION_BASE, FOCUS_RING, GATE.CONFIRM)}
                  >
                    {t(`${K}.gate.confirm`)}
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelGate}
                    className={cn(GATE.ACTION_BASE, FOCUS_RING, GATE.DISMISS)}
                  >
                    {t(`${K}.gate.cancel`)}
                  </button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      )}

      <CardContent className={CARD_PAD}>
        <form onSubmit={handleSubmit}>
          <label htmlFor={inputId} className="sr-only">
            {t(`${K}.input.label`)}
          </label>
          <div className={PROMPT.ROOT}>
            <span aria-hidden="true" className={PROMPT.GLYPH}>
              ❯
            </span>
            <input
              id={inputId}
              ref={inputRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setSuggestionIndex(0);
              }}
              onKeyDown={handleKeyDown}
              placeholder={t(`${K}.input.placeholder`)}
              disabled={inputDisabled}
              className={PROMPT.INPUT}
              autoComplete="off"
              spellCheck={false}
              maxLength={4096}
            />
            <Button
              type="submit"
              disabled={inputDisabled || input.trim() === ""}
              className={PROMPT.SEND}
            >
              {isLoading ? (
                <LoaderCircleIcon
                  className={cn(PROMPT.SEND_GLYPH, "animate-spin")}
                />
              ) : (
                <ChevronRightIcon className={PROMPT.SEND_GLYPH} />
              )}
              {t(`${K}.input.send`)}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
