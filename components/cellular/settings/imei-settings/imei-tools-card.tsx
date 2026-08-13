"use client";

import * as React from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FieldError } from "@/components/ui/field";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  IMEI_CUSTOM_ID,
  IMEI_TAC_PRESETS,
  getImeiTacPreset,
} from "@/constants/imei-presets";
import {
  generateImei,
  parseImeiBreakdown,
  validateImei,
} from "@/lib/imei-utils";
import { DUR, EASE_STANDARD } from "@/lib/motion";
import { cn } from "@/lib/utils";

import SettingRow from "../setting-row";
import {
  BADGE_GLYPH_SIZE,
  CARD_PAD,
  CARD_SHELL,
  FIELD_SHELL,
  INLINE_ERROR,
  PILL_ACTION,
  READOUT_ROW,
  ROW_GROUP,
  SECTION_DIVIDER,
  SELECT_TRIGGER,
  SETTING_ROW,
  SETTING_ROW_DIRTY,
} from "../shapes";

// =============================================================================
// IMEI Tools — the workbench
// =============================================================================
// Two jobs, in the order a user meets them: make a structurally valid number
// from a type allocation code, then inspect one. NOTHING on this card writes to
// the modem, which is why it lives in its own column away from the two write
// surfaces and says so in its own footnote.
//
// ON THE TWO BUTTONS. "Generate IMEI" and "Check IMEI Info" shipped as two
// default-variant buttons side by side — two equal primaries, so the card had no
// primary at all. Generate is the action this card exists for; the external
// lookup opens somebody else's website and is secondary by every measure.
//
// ON THE BREAKDOWN'S COLOUR. The validity readout used raw `text-green-500` /
// `text-red-500`. Those are not tokens: they do not move with the theme, they
// have no measured `on-` partner, and they are the exact hues the functional
// roles own. Validity is now a status chip on the `success`/`destructive` roles,
// each with its own glyph — the two containers are close enough in lightness
// that the glyph, not the fill, is what separates them.
// =============================================================================

// NOTE ON THE FIELD SHELL. This card's fields take the NEUTRAL `FIELD_SHELL`
// only, with no `_ON_FILL` sibling — nothing on this card writes to the modem,
// so no row here carries a `dirty` prop and none can promote to
// `primary-container`. The check field is not even inside a `SettingRow`.

/** One breakdown cell. The `accent` one is the check digit — the derived part. */
const BREAKDOWN_CELL = "flex flex-col gap-0.75 rounded-field px-4 py-3";

const IMEIToolsCard = () => {
  const { t } = useTranslation("cellular");
  const K = "core_settings.imei.tools";

  const [presetId, setPresetId] = React.useState(IMEI_TAC_PRESETS[0].id);
  const [customPrefix, setCustomPrefix] = React.useState("");
  const [candidate, setCandidate] = React.useState("");

  const isCustom = presetId === IMEI_CUSTOM_ID;
  const prefix = isCustom
    ? customPrefix
    : (getImeiTacPreset(presetId)?.tac ?? "");
  const isValidPrefix = /^\d{8,12}$/.test(prefix);
  const prefixError = isCustom && customPrefix.length > 0 && !isValidPrefix;

  const isComplete = /^\d{15}$/.test(candidate);
  const isLuhnValid = isComplete && validateImei(candidate);
  const breakdown = isComplete ? parseImeiBreakdown(candidate) : null;

  const handleGenerate = () => {
    if (!isValidPrefix) return;
    setCandidate(generateImei(prefix));
  };

  const handleCopy = async () => {
    if (!candidate) return;
    try {
      await navigator.clipboard.writeText(candidate);
      toast.success(t(`${K}.toasts.copied`));
    } catch {
      toast.error(t(`${K}.toasts.copy_failed`));
    }
  };

  return (
    <Card className={cn(CARD_SHELL)}>
      <CardHeader className={CARD_PAD}>
        <CardTitle>{t(`${K}.title`)}</CardTitle>
        <CardDescription>{t(`${K}.description`)}</CardDescription>
      </CardHeader>

      <CardContent className={cn(CARD_PAD, "flex flex-col gap-5")}>
        {/* --- Generate ------------------------------------------------------ */}
        <div className="flex flex-col gap-3">
          <div className={ROW_GROUP.ROOT}>
            <SettingRow
              label={t(`${K}.generate.tac_label`)}
              consequence={t(`${K}.generate.tac_consequence`)}
              labelId="imei-tac-label"
              control={
                <Select value={presetId} onValueChange={setPresetId}>
                  <SelectTrigger
                    className={cn(SELECT_TRIGGER, "@2xl/card:w-[13rem]")}
                    aria-labelledby="imei-tac-label"
                  >
                    <SelectValue
                      placeholder={t(`${K}.generate.tac_placeholder`)}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {IMEI_TAC_PRESETS.map((preset) => (
                      <SelectItem key={preset.id} value={preset.id}>
                        {preset.label}
                      </SelectItem>
                    ))}
                    <SelectSeparator />
                    <SelectItem value={IMEI_CUSTOM_ID}>
                      {t(`${K}.generate.custom`)}
                    </SelectItem>
                  </SelectContent>
                </Select>
              }
            />

            <div className={ROW_GROUP.DIVIDER} />

            <SettingRow
              label={t(`${K}.generate.prefix_label`)}
              consequence={t(`${K}.generate.prefix_consequence`)}
              labelId="imei-prefix-label"
              control={
                <input
                  id="imei-prefix-input"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={12}
                  value={prefix}
                  // A preset's TAC is a fact, not a draft: it is shown in the
                  // same field so the user can see what the Select resolved to,
                  // and only the Custom option makes it editable.
                  readOnly={!isCustom}
                  aria-readonly={!isCustom}
                  onChange={(event) =>
                    setCustomPrefix(
                      event.target.value.replace(/\D/g, "").slice(0, 12),
                    )
                  }
                  placeholder={t(`${K}.generate.prefix_placeholder`)}
                  aria-labelledby="imei-prefix-label"
                  aria-invalid={prefixError}
                  aria-describedby={
                    prefixError ? "imei-prefix-error" : undefined
                  }
                  className={cn(
                    FIELD_SHELL,
                    "@2xl/card:w-[13rem]",
                    !isCustom && "text-on-surface-variant",
                  )}
                />
              }
            />
          </div>

          {prefixError ? (
            <FieldError id="imei-prefix-error" className={INLINE_ERROR}>
              {t(`${K}.generate.prefix_error`, { entered: customPrefix.length })}
            </FieldError>
          ) : null}

          <div>
            <Button
              type="button"
              onClick={handleGenerate}
              disabled={!isValidPrefix}
              className={PILL_ACTION}
            >
              {t(`${K}.generate.action`)}
            </Button>
          </div>
        </div>

        <div className={SECTION_DIVIDER} />

        {/* --- Check --------------------------------------------------------- */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className={SETTING_ROW.LABEL}>{t(`${K}.check.label`)}</span>
            {isComplete ? (
              <Badge variant={isLuhnValid ? "success" : "destructive"}>
                <MaterialSymbol
                  name={isLuhnValid ? "check_circle" : "cancel"}
                  size={BADGE_GLYPH_SIZE}
                />
                {isLuhnValid
                  ? t(`${K}.check.valid`)
                  : t(`${K}.check.invalid`)}
              </Badge>
            ) : null}
          </div>

          <div className="flex flex-col gap-2.5 @2xl/card:flex-row @2xl/card:items-center">
            <input
              id="imei-check-input"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={15}
              value={candidate}
              onChange={(event) =>
                setCandidate(event.target.value.replace(/\D/g, "").slice(0, 15))
              }
              placeholder={t(`${K}.check.placeholder`)}
              aria-label={t(`${K}.check.label`)}
              className={cn(FIELD_SHELL, "@2xl/card:flex-1")}
            />

            <div className="flex flex-none items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={handleCopy}
                disabled={!candidate}
                aria-label={t(`${K}.actions.copy`)}
                className="rounded-pill"
              >
                <MaterialSymbol name="content_copy" size={18} />
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={!isComplete}
                onClick={() =>
                  window.open(
                    `https://www.imei.info/?imei=${candidate}`,
                    "_blank",
                    "noopener,noreferrer",
                  )
                }
                className={PILL_ACTION}
              >
                <MaterialSymbol name="open_in_new" size={17} />
                {t(`${K}.check.lookup`)}
              </Button>
            </div>
          </div>

          {breakdown ? (
            <motion.div
              // Declared initial AND animate on the cascade root: a
              // variants-only child that mounts on a state swap renders blank.
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: DUR.standard, ease: EASE_STANDARD }}
              className="grid grid-cols-1 gap-1.5 @2xl/card:grid-cols-3"
            >
              <div className={cn(BREAKDOWN_CELL, "bg-surface-container")}>
                <span className={SETTING_ROW.CONSEQUENCE}>
                  {t(`${K}.breakdown.tac`)}
                </span>
                <span className={READOUT_ROW.VALUE_MONO}>{breakdown.tac}</span>
              </div>
              <div className={cn(BREAKDOWN_CELL, "bg-surface-container")}>
                <span className={SETTING_ROW.CONSEQUENCE}>
                  {t(`${K}.breakdown.serial`)}
                </span>
                <span className={READOUT_ROW.VALUE_MONO}>{breakdown.snr}</span>
              </div>
              {/* The accent cell: the check digit is the only part of an IMEI
                  the machine derives rather than the manufacturer assigns, and
                  it is what the chip above is judging. `primary-container` is
                  emphasis here, never a health signal. */}
              <div
                className={cn(
                  BREAKDOWN_CELL,
                  "bg-primary-container text-on-primary-container",
                )}
              >
                <span className={SETTING_ROW_DIRTY.CONSEQUENCE_ON_FILL}>
                  {t(`${K}.breakdown.check`)}
                </span>
                <span className={READOUT_ROW.VALUE_MONO}>
                  {breakdown.checkDigit}
                </span>
              </div>
            </motion.div>
          ) : (
            <p className={SETTING_ROW.CONSEQUENCE}>{t(`${K}.check.empty`)}</p>
          )}
        </div>

        <p className={SETTING_ROW.CONSEQUENCE}>{t(`${K}.footnote`)}</p>
      </CardContent>
    </Card>
  );
};

export default IMEIToolsCard;
