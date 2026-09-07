"use client";

import type * as React from "react";
import {
  DownloadIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
  XCircleIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import { isPackCompatible } from "@/lib/i18n/app-version";
import { installErrorKey } from "@/lib/i18n/resolve-error";
import { staggerRowItem, transitionMeterFill } from "@/lib/motion";
import type { LanguagePackInstallState } from "@/types/i18n";
import { cn } from "@/lib/utils";

import type { PackRow as PackRowData } from "./derive";
import {
  formatBytes,
  formatCompleteness,
  installStepKey,
  isInstallActive,
} from "./derive";
import {
  CHIP_GLYPH,
  CMD,
  FAILURE,
  FOCUS_RING_ON_GROUP,
  METER,
  MONO_TAG,
  NOTICE,
  PACK_ROW,
  PILL_ACTION,
  PILL_GLYPH,
} from "./shapes";

const K = "languages";

export interface PackRowProps {
  pack: PackRowData;
  install: LanguagePackInstallState;
  onInstall: (code: string) => void;
  onCancel: () => void;
}

/**
 * One community pack, and the only place an install-shaped action lives. While
 * the worker runs, the action slot becomes the meter — the device has always
 * reported `progress`, and this is where it is finally rendered.
 */
export function PackRow({
  pack,
  install,
  onInstall,
  onCancel,
}: PackRowProps): React.JSX.Element {
  const { t } = useTranslation("system-settings");

  const isThisRow = install.code === pack.code;
  const installing = isThisRow && isInstallActive(install.state);
  const failed = isThisRow && install.state === "failed";
  const compatible = isPackCompatible(pack.entry.app_min_version);

  const size = formatBytes(pack.entry.size_bytes);
  const contributors = pack.entry.contributors.length;

  const progress = Math.max(0, Math.min(100, install.progress));

  const errorKey = failed ? installErrorKey(install.error_code) : null;
  const errorMessage = errorKey ? t(errorKey) : t(`${K}.errors.generic`);
  // The device's own words are quoted beneath the sentence, never spliced into
  // it — an unmapped code is machine voice and does not translate.
  const errorDetail = errorKey ? null : install.message?.trim() || null;

  const command = `qmanager_language_install ${pack.code} ${pack.entry.url} ${pack.entry.sha256}`;

  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(command);
      toast.success(t(`${K}.toast.copied`));
    } catch {
      toast.error(t(`${K}.toast.copy_failed`));
    }
  };

  return (
    <motion.div variants={staggerRowItem} role="listitem" className="min-w-0">
      <div className={PACK_ROW.ROOT}>
        <div className={PACK_ROW.TEXT}>
          <div className={PACK_ROW.NAMES}>
            <span className={PACK_ROW.NATIVE}>{pack.nativeName}</span>
            <span className={PACK_ROW.ENGLISH}>{pack.englishName}</span>
          </div>
          <div className={PACK_ROW.META}>
            <Tag variant="neutral" className={MONO_TAG}>
              {t(`${K}.display.version`, { version: pack.entry.version })}
            </Tag>
            <Tag variant="neutral">
              {t(`${K}.community.completeness`, {
                pct: formatCompleteness(pack.entry.completeness),
              })}
            </Tag>
            <Tag variant="neutral">
              {t(`${K}.community.size.${size.unit}`, { value: size.value })}
            </Tag>
            <Tag variant="neutral">
              {contributors > 0
                ? t(`${K}.community.contributors`, { count: contributors })
                : t(`${K}.community.contributors_none`)}
            </Tag>
            {!compatible && (
              <Badge variant="warning">
                <TriangleAlertIcon className={CHIP_GLYPH} aria-hidden="true" />
                {t(`${K}.community.incompatible`)}
              </Badge>
            )}
          </div>
        </div>

        <div className={PACK_ROW.ACTION}>
          {installing ? (
            <>
              <div className={METER.ROOT}>
                <div className={METER.HEAD}>
                  <span className={METER.STEP} aria-live="polite">
                    {t(installStepKey(install))}
                  </span>
                  <span className={METER.PCT}>
                    {t(`${K}.install.percent`, { pct: progress })}
                  </span>
                </div>
                <div
                  className={METER.TRACK}
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progress}
                  aria-label={t(`${K}.install.progress_aria`, {
                    language: pack.englishName,
                  })}
                >
                  {/* `initial` is load-bearing: the fill carries no width class,
                      so an unstyled one resolves to a FULL track. */}
                  <motion.div
                    className={METER.FILL}
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    transition={transitionMeterFill}
                  />
                </div>
              </div>
              {install.state !== "cancelling" && (
                <Button
                  type="button"
                  variant="ghost"
                  className={PILL_ACTION}
                  onClick={onCancel}
                  aria-label={t(`${K}.actions.cancel_aria`, {
                    language: pack.englishName,
                  })}
                >
                  {t(`${K}.actions.cancel`)}
                </Button>
              )}
            </>
          ) : (
            <Button
              type="button"
              className={PILL_ACTION}
              onClick={() => onInstall(pack.code)}
              disabled={!compatible}
              aria-label={t(
                pack.kind === "update"
                  ? `${K}.actions.update_aria`
                  : `${K}.actions.install_aria`,
                { language: pack.englishName },
              )}
            >
              {pack.kind === "update" ? (
                <RefreshCwIcon className={PILL_GLYPH} aria-hidden="true" />
              ) : (
                <DownloadIcon className={PILL_GLYPH} aria-hidden="true" />
              )}
              {pack.kind === "update"
                ? t(`${K}.actions.update`)
                : t(`${K}.actions.install`)}
            </Button>
          )}
        </div>
      </div>

      {failed && (
        <div className={cn(PACK_ROW.SLOT, FAILURE.ROOT)}>
          <div className={cn(NOTICE.BOX, NOTICE.FAILED)} role="alert">
            <XCircleIcon className={NOTICE.GLYPH} aria-hidden="true" />
            <div className={NOTICE.STACK}>
              <p className={NOTICE.TEXT}>{errorMessage}</p>
              {errorDetail && <p className={NOTICE.DETAIL}>{errorDetail}</p>}
            </div>
          </div>
          <div className={FAILURE.MANUAL}>
            <p className={FAILURE.HINT}>{t(`${K}.failure.manual`)}</p>
            <button
              type="button"
              onClick={() => void copyCommand()}
              // The command IS the button's content, so a bare label would
              // hide it: a screen reader would announce "copy" and never the
              // line it copies. Name the button, then read the line out.
              aria-label={`${t(`${K}.actions.copy_command`)}: ${command}`}
              className={cn(CMD, FOCUS_RING_ON_GROUP)}
            >
              {command}
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
}

export default PackRow;
