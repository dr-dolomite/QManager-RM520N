"use client";

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Loader2Icon } from "lucide-react";

import { LOG_PANEL } from "./shapes";

interface InstallLogViewerProps {
  log: string;
  isRunning: boolean;
}

export function InstallLogViewer({ log, isRunning }: InstallLogViewerProps) {
  const { t } = useTranslation("common");
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
        <span className={LOG_PANEL.TITLE}>{t("tailscale.install.logTitle")}</span>
        {isRunning ? (
          <Loader2Icon
            className={`${LOG_PANEL.GLYPH} animate-spin motion-reduce:animate-none`}
            aria-hidden
          />
        ) : null}
      </div>
      <pre ref={preRef} className={LOG_PANEL.BODY} aria-live="polite">
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
