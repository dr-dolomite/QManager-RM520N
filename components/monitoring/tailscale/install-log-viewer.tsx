"use client";

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Loader2Icon } from "lucide-react";

import { LOG_PANEL } from "./shapes";

interface InstallLogViewerProps {
  log: string;
  isRunning: boolean;
  /** Overrides the default "Install log" heading (an update has its own). */
  title?: string;
}

export function InstallLogViewer({
  log,
  isRunning,
  title,
}: InstallLogViewerProps) {
  const { t } = useTranslation("common");
  const heading = title ?? t("tailscale.install.logTitle");
  const preRef = useRef<HTMLPreElement>(null);

  // The transcript is read from the bottom while it grows.
  useEffect(() => {
    const el = preRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);

  const showPlaceholder = isRunning && log.trim().length === 0;

  return (
    <div className={LOG_PANEL.ROOT}>
      <div className={LOG_PANEL.HEAD}>
        <span className={LOG_PANEL.TITLE}>{heading}</span>
        {isRunning ? (
          <Loader2Icon
            className={`${LOG_PANEL.GLYPH} motion-safe:animate-spin`}
            aria-hidden
          />
        ) : null}
      </div>
      {/* A scroll container is a tab stop, and `additions` keeps the reader on
          the new lines instead of re-reading the whole transcript each poll. */}
      <pre
        ref={preRef}
        tabIndex={0}
        role="region"
        aria-label={heading}
        aria-live="polite"
        aria-relevant="additions"
        className={LOG_PANEL.BODY}
      >
        {showPlaceholder ? (
          <span className={LOG_PANEL.PLACEHOLDER}>
            {t("tailscale.install.logWaiting")}
          </span>
        ) : (
          log
        )}
      </pre>
    </div>
  );
}
