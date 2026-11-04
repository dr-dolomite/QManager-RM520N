"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { DUR, EASE_QUICK } from "@/lib/motion";
import { cn } from "@/lib/utils";

import { segmentInfo } from "./sms-format";

// =============================================================================
// SmsComposer — the reply field at the foot of the conversation pane
// =============================================================================
// Sits back down on `surface`, so the conversation between the header and the
// composer reads as a recessed well (DESIGN.md > The Tonal-Elevation Rule).
//
// The segment counter appears at the FIRST boundary only, the moment the body
// stops being one plain GSM-7 part, and fades in on `quick`. Before that it is
// noise beside an empty field; after it, the cost of the message is a fact the
// user is entitled to before they commit to it.
// =============================================================================

/** Ceiling on the auto-grow, in px. Past this the field scrolls. */
const MAX_FIELD_HEIGHT = 132;

export interface SmsComposerProps {
  /** Resolved title of the thread, for the field's accessible name only. */
  destinationLabel: string;
  disabled?: boolean;
  onSend: (text: string) => void;
  className?: string;
}

export function SmsComposer({
  destinationLabel,
  disabled = false,
  onSend,
  className,
}: SmsComposerProps) {
  const { t } = useTranslation("cellular");
  const [text, setText] = React.useState("");
  const fieldRef = React.useRef<HTMLTextAreaElement | null>(null);
  const fieldId = React.useId();

  const seg = segmentInfo(text);
  const canSend = text.trim().length > 0 && !disabled;

  // Auto-grow. Height is reset to `auto` first so the field can shrink again
  // when text is deleted, then pinned to the content height under the ceiling.
  const resize = React.useCallback(() => {
    const el = fieldRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_FIELD_HEIGHT)}px`;
  }, []);

  React.useEffect(() => {
    resize();
  }, [text, resize]);

  const submit = () => {
    const body = text.trim();
    if (!body || disabled) return;
    onSend(body);
    setText("");
  };

  return (
    <div
      className={cn(
        "bg-surface flex flex-none items-end gap-2.5 px-4 pt-3.5 pb-4 @2xl/pane:px-5",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <label htmlFor={fieldId} className="sr-only">
          {t("sms.center.composer.aria", { contact: destinationLabel })}
        </label>
        <textarea
          id={fieldId}
          ref={fieldRef}
          rows={1}
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter is a newline. IME composition is left
            // alone so a candidate-selection Enter never sends a half-typed
            // message.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={t("sms.center.composer.placeholder")}
          className="bg-surface-container placeholder:text-on-surface-variant focus-visible:ring-ring focus-visible:ring-offset-surface min-h-11 w-full resize-none rounded-[1.375rem] px-4.5 py-3 text-[0.84375rem] leading-[1.45] outline-none focus-visible:ring-[3px] focus-visible:ring-offset-2 disabled:opacity-50"
        />

        <AnimatePresence initial={false}>
          {seg.visible ? (
            <motion.div
              key="segments"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: DUR.quick, ease: EASE_QUICK }}
              aria-live="polite"
              className="text-on-surface-variant flex items-center gap-1.5 pl-4.5 text-[0.6875rem] font-semibold"
            >
              <span className="tabular-nums">
                {t("sms.center.composer.remaining", { count: seg.remaining })}
              </span>
              <span
                aria-hidden="true"
                className="bg-outline size-[3px] rounded-full"
              />
              <span className="tabular-nums">
                {t("sms.center.composer.segments", { count: seg.segments })}
              </span>
              <span
                aria-hidden="true"
                className="bg-outline size-[3px] rounded-full"
              />
              <span>
                {seg.ucs2
                  ? t("sms.compose.encoding.ucs2")
                  : t("sms.compose.encoding.gsm7")}
              </span>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      <Button
        type="button"
        size="icon"
        aria-label={t("sms.center.composer.send")}
        disabled={!canSend}
        onClick={submit}
        className={cn(
          "size-11 flex-none",
          !canSend && "bg-surface-container-high text-on-surface-variant",
        )}
      >
        <MaterialSymbol name="send" size={19} />
      </Button>
    </div>
  );
}
