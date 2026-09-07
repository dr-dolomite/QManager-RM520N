"use client";

import * as React from "react";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import {
  MaximizeIcon,
  MinimizeIcon,
  Trash2Icon,
} from "lucide-react";
import { AnimatePresence, motion, useAnimationControls } from "motion/react";
import { useTheme } from "next-themes";
import { useTranslation } from "react-i18next";

import { ConditionBlock } from "@/components/system-settings/condition-block";
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
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { useWebConsole } from "@/hooks/use-web-console";
import { DUR, EASE_QUICK, EASE_STANDARD } from "@/lib/motion";
import { cn } from "@/lib/utils";

import { FAILURE_ACTION, chipCopyKey, closeDetail, resolveView } from "./derive";
import {
  CARD_BODY,
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  CHIP_GLYPH,
  CONSOLE,
  FAILURE_FACE,
  PILL_ACTION,
  PILL_GLYPH,
  SKELETON,
  SPIN,
  STATE_CHIP,
} from "./shapes";
import { readTerminalFont, readTerminalTheme } from "./terminal-theme";

const K = "web_console";

/** xterm's own defaults, kept for everything the theme does not name. */
const TERMINAL_FONT_SIZE = 14;
const TERMINAL_SCROLLBACK = 5000;

export function WebConsoleCard(): React.JSX.Element {
  const { t } = useTranslation("system-settings");
  const { resolvedTheme } = useTheme();
  const [isFullscreen, setIsFullscreen] = React.useState(false);

  // xterm refs — passed to the hook
  const terminalRef = React.useRef<Terminal | null>(null);
  const fitAddonRef = React.useRef<FitAddon | null>(null);

  // DOM container ref for xterm to mount into
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const overlayRef = React.useRef<HTMLDivElement | null>(null);
  const fullscreenButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const focusReturnRef = React.useRef<HTMLElement | null>(null);
  const wasFullscreenRef = React.useRef(false);

  const { connectionState, failure, hasOpened, reconnect } = useWebConsole({
    terminalRef,
    fitAddonRef,
  });

  const view = resolveView(connectionState, failure, hasOpened);
  // One key drives the chip's label AND its face, so the two cannot disagree.
  const chipKey = chipCopyKey(connectionState, failure);
  const chip = STATE_CHIP[chipKey];
  const ChipGlyph = chip.glyph;

  // ── xterm initialization ─────────────────────────────────────────────────

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const terminal = new Terminal({
      // Both read off the host: xterm measures glyphs through a canvas, which
      // resolves neither `oklch()` nor a custom property.
      theme: readTerminalTheme(container),
      allowTransparency: true,
      fontSize: TERMINAL_FONT_SIZE,
      fontFamily: readTerminalFont(container),
      cursorBlink: true,
      scrollback: TERMINAL_SCROLLBACK,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.open(container);

    try {
      fitAddon.fit();
    } catch {
      // Non-fatal — terminal may not be visible yet
    }

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

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

  // ── Theme ────────────────────────────────────────────────────────────────

  React.useEffect(() => {
    // `resolvedTheme` is the trigger, not the source: it changes one tick after
    // the class lands on the root, and the tokens are read off the root itself.
    void resolvedTheme;
    const frame = requestAnimationFrame(() => {
      const container = containerRef.current;
      if (container && terminalRef.current) {
        terminalRef.current.options.theme = readTerminalTheme(container);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [resolvedTheme]);

  // ── Full screen ──────────────────────────────────────────────────────────

  const controls = useAnimationControls();
  const firstModeRef = React.useRef(true);

  const toggleFullscreen = React.useCallback(() => {
    if (!isFullscreen) {
      focusReturnRef.current = document.activeElement as HTMLElement | null;
    }
    setIsFullscreen((prev) => !prev);
  }, [isFullscreen]);

  React.useEffect(() => {
    requestAnimationFrame(() => {
      try {
        fitAddonRef.current?.fit();
      } catch {
        // Non-fatal
      }
    });
  }, [isFullscreen]);

  // The box changes shape rather than moving, so the console crossfades through
  // its own opacity instead of snapping between two positions.
  React.useEffect(() => {
    if (firstModeRef.current) {
      firstModeRef.current = false;
      return;
    }
    void controls.start({
      opacity: [0.3, 1],
      transition: { duration: DUR.quick, ease: EASE_STANDARD },
    });
  }, [isFullscreen, controls]);

  React.useEffect(() => {
    if (!isFullscreen) return;
    // xterm swallows Escape while the terminal itself has focus, so a shell
    // editor still receives it; this only fires from the chrome around it.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsFullscreen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isFullscreen]);

  React.useEffect(() => {
    if (isFullscreen) {
      wasFullscreenRef.current = true;
      return;
    }
    if (!wasFullscreenRef.current) return;
    wasFullscreenRef.current = false;
    const target = focusReturnRef.current;
    focusReturnRef.current = null;
    if (target && document.contains(target)) target.focus();
    else fullscreenButtonRef.current?.focus();
  }, [isFullscreen]);

  // The sheet has no scrim by design, so nothing else stops Tab walking into a
  // sidebar the user cannot see. Everything outside the sheet goes inert.
  React.useEffect(() => {
    const node = overlayRef.current;
    if (!isFullscreen || !node) return;
    const marked: HTMLElement[] = [];
    for (
      let el: HTMLElement | null = node;
      el && el !== document.body;
      el = el.parentElement
    ) {
      for (const sibling of Array.from(el.parentElement?.children ?? [])) {
        if (sibling === el || !(sibling instanceof HTMLElement)) continue;
        if (sibling.hasAttribute("inert")) continue;
        sibling.setAttribute("inert", "");
        marked.push(sibling);
      }
    }
    return () => {
      for (const el of marked) el.removeAttribute("inert");
    };
  }, [isFullscreen]);

  // ── Clear ────────────────────────────────────────────────────────────────

  const handleClear = React.useCallback(() => {
    terminalRef.current?.clear();
  }, []);

  const failed = view === "failed" && failure !== null;
  const face = failure ? FAILURE_FACE[failure.kind] : null;
  const detail = failure ? closeDetail(failure) : null;
  const FaceGlyph = face?.glyph;

  return (
    <motion.div
      ref={overlayRef}
      animate={controls}
      className={isFullscreen ? CONSOLE.OVERLAY : CONSOLE.SLOT}
    >
      <Card
        className={cn(
          CARD_SHELL,
          isFullscreen ? CONSOLE.HEIGHT_FULL : CONSOLE.HEIGHT,
        )}
      >
        <CardHeader className={CARD_PAD}>
          <CardTitle className={CARD_TITLE}>{t(`${K}.card.title`)}</CardTitle>
          <CardDescription className={CARD_DESC}>
            {t(`${K}.card.description`)}
          </CardDescription>
          <CardAction>
            <Badge variant={chip.variant} aria-live="polite">
              <ChipGlyph
                className={cn(CHIP_GLYPH, chip.spin && SPIN)}
                aria-hidden="true"
              />
              {t(`${K}.chip.${chipKey}`)}
            </Badge>
          </CardAction>

          <div className={CONSOLE.TOOLS}>
            {/* The hints ride at every width: a narrow screen is exactly where
                pasting a command by hand is hardest. */}
            <div className={CONSOLE.HINTS}>
              <span className={CONSOLE.HINT}>
                {t(`${K}.hints.copy`)}
                <KbdGroup>
                  <Kbd className={CONSOLE.KEY}>{t(`${K}.keys.ctrl`)}</Kbd>
                  <Kbd className={CONSOLE.KEY}>{t(`${K}.keys.shift`)}</Kbd>
                  <Kbd className={CONSOLE.KEY}>C</Kbd>
                </KbdGroup>
              </span>
              <span className={CONSOLE.HINT}>
                {t(`${K}.hints.paste`)}
                <KbdGroup>
                  <Kbd className={CONSOLE.KEY}>{t(`${K}.keys.ctrl`)}</Kbd>
                  <Kbd className={CONSOLE.KEY}>{t(`${K}.keys.shift`)}</Kbd>
                  <Kbd className={CONSOLE.KEY}>V</Kbd>
                </KbdGroup>
              </span>
              {isFullscreen && (
                <span className={CONSOLE.HINT}>
                  {t(`${K}.hints.leave`)}
                  <KbdGroup>
                    <Kbd className={CONSOLE.KEY}>{t(`${K}.keys.esc`)}</Kbd>
                  </KbdGroup>
                </span>
              )}
            </div>

            <div className={CONSOLE.ACTIONS}>
              <Button
                type="button"
                variant="outline"
                className={PILL_ACTION}
                onClick={handleClear}
                disabled={failed}
              >
                <Trash2Icon className={PILL_GLYPH} aria-hidden="true" />
                {t(`${K}.actions.clear`)}
              </Button>
              <Button
                ref={fullscreenButtonRef}
                type="button"
                variant="outline"
                className={PILL_ACTION}
                onClick={toggleFullscreen}
              >
                {isFullscreen ? (
                  <MinimizeIcon className={PILL_GLYPH} aria-hidden="true" />
                ) : (
                  <MaximizeIcon className={PILL_GLYPH} aria-hidden="true" />
                )}
                {isFullscreen
                  ? t(`${K}.actions.exit_fullscreen`)
                  : t(`${K}.actions.fullscreen`)}
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className={cn(CARD_PAD, CARD_BODY)}>
          <div className={CONSOLE.PANE}>
            {/* Hidden, never unmounted: removing the host disposes the session. */}
            <div
              ref={containerRef}
              className={CONSOLE.TERMINAL}
              role="group"
              aria-label={t(`${K}.terminal.label`)}
              hidden={failed}
            />

            {/* The handoff crossfades rather than cutting: the skeleton stands
                on the terminal's own rectangle, so an unmount is a flash. */}
            <AnimatePresence>
              {view === "loading" && (
                <motion.div
                  key="console-skeleton"
                  className={SKELETON.PANE}
                  initial={{ opacity: 1 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: DUR.quick, ease: EASE_QUICK }}
                  aria-hidden="true"
                >
                  <Skeleton className={SKELETON.FILL} />
                </motion.div>
              )}
            </AnimatePresence>

            {failed && failure && face && FaceGlyph && detail && (
              <div className={CONSOLE.COVER}>
                <ConditionBlock
                  tone={face.tone}
                  glyph={FaceGlyph}
                  ariaRole={failure.kind === "ended" ? "status" : "alert"}
                  title={t(`${K}.states.${failure.kind}.title`)}
                  description={t(`${K}.states.${failure.kind}.description`)}
                  detail={
                    <p className={CONSOLE.DETAIL}>
                      {t(`${K}.states.${detail.key}`, detail.params)}
                    </p>
                  }
                  onRetry={reconnect}
                  retryLabel={t(`${K}.actions.${FAILURE_ACTION[failure.kind]}`)}
                  className={CONSOLE.BLOCK}
                />
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export default WebConsoleCard;
