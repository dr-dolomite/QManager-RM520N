"use client";

import * as React from "react";
import { Loader2Icon, Trash2Icon } from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import { DUR, EASE_EMPHASIZED, staggerRowItem } from "@/lib/motion";
import { cn } from "@/lib/utils";

import type { LanguageRow as LanguageRowData } from "./derive";
import {
  COARSE_TARGET,
  FOCUS_RING,
  LANG_ROW,
  META_INK_ON_TONAL,
  MONO_TAG,
  PILL_ACTION,
  PILL_GLYPH,
  SPIN,
  TAG_ON_TONAL,
} from "./shapes";

const K = "languages";

export interface LanguageRowProps {
  row: LanguageRowData;
  isActive: boolean;
  /** True while `switchLanguage` is resolving THIS row's pack. */
  switching: boolean;
  tabIndex: number;
  onSelect: (code: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onRemove: (code: string, isActive: boolean) => Promise<void>;
  registerRef: (element: HTMLDivElement | null) => void;
}

/**
 * One language, and the control that selects it. The whole row is the radio —
 * a `div` rather than a `button`, because the downloaded rows nest a Remove
 * button and a button inside a button is not a tree a browser will render.
 */
export function LanguageRow({
  row,
  isActive,
  switching,
  tabIndex,
  onSelect,
  onKeyDown,
  onRemove,
  registerRef,
}: LanguageRowProps): React.JSX.Element {
  const { t } = useTranslation("system-settings");
  const [removeOpen, setRemoveOpen] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);

  const handleRemove = async () => {
    setRemoving(true);
    try {
      await onRemove(row.code, isActive);
    } finally {
      setRemoving(false);
      setRemoveOpen(false);
    }
  };

  // A nested control must not also flip the radio it sits inside.
  const swallow = (event: React.SyntheticEvent) => event.stopPropagation();

  // Only the two keys the button itself consumes stop here; everything else
  // must reach the row, or the group's arrow navigation dies on this button.
  const swallowActivationKeys = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") event.stopPropagation();
  };

  return (
    <motion.div variants={staggerRowItem} className="min-w-0">
      <div
        ref={registerRef}
        role="radio"
        aria-checked={isActive}
        aria-busy={switching || undefined}
        tabIndex={tabIndex}
        onClick={() => onSelect(row.code)}
        onKeyDown={onKeyDown}
        className={cn(
          LANG_ROW.ROOT,
          LANG_ROW.TRANSITION,
          FOCUS_RING,
          "cursor-pointer",
          isActive && LANG_ROW.ACTIVE,
        )}
      >
        <span
          className={cn(LANG_ROW.MARK, !isActive && LANG_ROW.MARK_REST)}
          aria-hidden="true"
        >
          {switching ? (
            <Loader2Icon className={cn(LANG_ROW.MARK_GLYPH, SPIN)} />
          ) : isActive ? (
            <motion.span
              className={LANG_ROW.MARK_DOT}
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ duration: DUR.emphasized, ease: EASE_EMPHASIZED }}
            />
          ) : null}
        </span>

        <span className={LANG_ROW.TEXT}>
          <span className={LANG_ROW.NATIVE}>{row.nativeName}</span>
          <span
            className={cn(
              LANG_ROW.ENGLISH,
              isActive ? META_INK_ON_TONAL : "text-on-surface-variant",
            )}
          >
            {row.englishName}
          </span>
        </span>

        <span className={LANG_ROW.META}>
          {row.provenance === "built_in" ? (
            <Tag variant="neutral" className={cn(isActive && TAG_ON_TONAL)}>
              {t(`${K}.display.built_in`)}
            </Tag>
          ) : (
            <>
              {row.version ? (
                <Tag
                  variant="neutral"
                  className={cn(MONO_TAG, isActive && TAG_ON_TONAL)}
                >
                  {t(`${K}.display.version`, { version: row.version })}
                </Tag>
              ) : null}
              <button
                type="button"
                onClick={(event) => {
                  swallow(event);
                  setRemoveOpen(true);
                }}
                onKeyDown={swallowActivationKeys}
                aria-label={t(`${K}.actions.remove_aria`, {
                  language: row.englishName,
                })}
                className={cn(
                  LANG_ROW.REMOVE,
                  LANG_ROW.TRANSITION,
                  COARSE_TARGET,
                  FOCUS_RING,
                  isActive ? LANG_ROW.REMOVE_ACTIVE : LANG_ROW.REMOVE_REST,
                )}
              >
                <Trash2Icon
                  className={LANG_ROW.REMOVE_GLYPH}
                  aria-hidden="true"
                />
              </button>
            </>
          )}
        </span>
      </div>

      <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(`${K}.remove.title`, { language: row.englishName })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isActive
                ? t(`${K}.remove.description_active`, {
                    language: row.englishName,
                  })
                : t(`${K}.remove.description`, { language: row.englishName })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing} className={PILL_ACTION}>
              {t(`${K}.remove.cancel`)}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleRemove();
              }}
              disabled={removing}
              className={cn(
                buttonVariants({ variant: "destructive" }),
                PILL_ACTION,
              )}
            >
              {removing ? (
                <Loader2Icon className={cn(PILL_GLYPH, SPIN)} aria-hidden="true" />
              ) : null}
              {removing ? t(`${K}.remove.removing`) : t(`${K}.remove.confirm`)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}

export default LanguageRow;
