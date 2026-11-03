"use client";

import { useTranslation } from "react-i18next";

import { MaterialSymbol, type MaterialSymbolName } from "@/components/ui/material-symbol";
import { MetricBar } from "@/components/ui/metric-bar";
import { cn } from "@/lib/utils";
import type { SmsStorage } from "@/types/sms";

// =============================================================================
// SmsStorageMeter — how full each message store is, at the foot of the list
// =============================================================================
// ME and SM are separate memories and a message never spills from one into the
// other, so each gets its own bar. A backend without the per-memory split sends
// only the sum: then one combined row, captioned so the sum is not read as a
// capacity (docs/reference/sms.md > Per-memory storage breakdown).
// =============================================================================

/** One meter row: glyph and label left, count right, bar beneath. */
export const STORAGE_ROW = "grid gap-1.5";
/** The strip's own padding; the skeleton reads it too. */
export const STORAGE_STRIP = "flex flex-none flex-col gap-3 px-5 pt-3 pb-4";

function MeterRow({
  glyph,
  label,
  used,
  total,
  caption,
}: {
  glyph: MaterialSymbolName;
  label: string;
  used: number;
  total: number;
  caption?: string;
}) {
  const { t } = useTranslation("cellular");
  const known = Number.isFinite(total) && total > 0;
  const safeUsed = Number.isFinite(used) ? used : 0;
  return (
    <div className={STORAGE_ROW}>
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="text-on-surface-variant flex min-w-0 items-center gap-1.5 font-medium">
          <MaterialSymbol name={glyph} size={15} className="flex-none" />
          <span className="truncate">{label}</span>
        </span>
        <span className="text-on-surface flex-none font-semibold tabular-nums">
          {known
            ? t("sms.storage.used_of_total", { used: safeUsed, total })
            : t("sms.center.storage.unknown")}
        </span>
      </div>
      {/* An absent capacity is an empty track, never a guessed bar. */}
      <MetricBar
        value={known ? safeUsed : null}
        max={known ? total : 1}
        warnAt={known ? total * 0.8 : 1}
        dangerAt={known ? total * 0.95 : 1}
        baseTone="primary"
        track="surface-container-high"
        index={0}
      />
      {caption ? (
        <span className="text-on-surface-variant text-[0.6875rem]">{caption}</span>
      ) : null}
    </div>
  );
}

export function SmsStorageMeter({
  storage,
  className,
}: {
  storage: SmsStorage;
  className?: string;
}) {
  const { t } = useTranslation("cellular");
  const { me, sm } = storage;
  // Half a breakdown is not a breakdown.
  const hasSplit = !!me && !!sm;

  return (
    <section
      aria-label={t("sms.center.storage.label")}
      className={cn(STORAGE_STRIP, className)}
    >
      {hasSplit ? (
        <>
          <MeterRow
            glyph="memory"
            label={t("sms.center.storage.modem")}
            used={me.used}
            total={me.total}
          />
          <MeterRow
            glyph="sim_card"
            label={t("sms.center.storage.sim")}
            used={sm.used}
            total={sm.total}
          />
        </>
      ) : (
        <MeterRow
          glyph="memory"
          label={t("sms.center.storage.label")}
          used={storage.used}
          total={storage.total}
          caption={t("sms.center.storage.combined_caption")}
        />
      )}
    </section>
  );
}
