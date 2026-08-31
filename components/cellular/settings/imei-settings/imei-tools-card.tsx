"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
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
import { staggerRowItem } from "@/lib/motion";
import { cn } from "@/lib/utils";

import SettingRow from "../setting-row";
import {
  BADGE_GLYPH_SIZE,
  BREAKDOWN,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  FIELD_SHELL,
  ICON_ACTION,
  ICON_ACTION_GLYPH,
  INLINE_ERROR,
  PILL_ACTION,
  PILL_ACTION_GLYPH,
  READOUT_ROW,
  ROW_GROUP,
  SECTION_DIVIDER,
  SECTION_LABEL,
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
//
// THE BREAKDOWN'S GEOMETRY MOVED TO `../shapes`. It was a module-local constant
// here, which is the shape of drift this family's shapes module exists to
// prevent — and it was hiding a real bug in the same line: its 3-up step was
// `@2xl/card` (672px), while this card lives in the NARROW half of the split and
// never gets there, so the three cells shipped stacked at every real width. See
// `BREAKDOWN` and DESIGN.md > The Grid-Step-Costing Rule.

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
        <CardTitle className={CARD_TITLE}>{t(`${K}.title`)}</CardTitle>
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
              {t(`${K}.generate.prefix_error`, {
                entered: customPrefix.length,
              })}
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
            <span className={SECTION_LABEL}>{t(`${K}.check.label`)}</span>
            {isComplete ? (
              <Badge variant={isLuhnValid ? "success" : "destructive"}>
                <MaterialSymbol
                  name={isLuhnValid ? "check_circle" : "cancel"}
                  size={BADGE_GLYPH_SIZE}
                />
                {isLuhnValid ? t(`${K}.check.valid`) : t(`${K}.check.invalid`)}
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
                className={ICON_ACTION}
              >
                <MaterialSymbol name="content_copy" size={ICON_ACTION_GLYPH} />
              </Button>
              {/* A REAL ANCHOR, not a Button running `window.open`. This
                  navigates to somebody else's website, and a button cannot be
                  opened in a new tab, middle-clicked, copied as a link, or read
                  as a link by assistive tech. `asChild` keeps the ghost pill's
                  own geometry. While there is nothing to look up the anchor
                  would have no destination, so the disabled state renders as a
                  real disabled `button` rather than as a dead `href`. */}
              {isComplete ? (
                <Button asChild variant="ghost" className={PILL_ACTION}>
                  <a
                    href={`https://www.imei.info/?imei=${candidate}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <MaterialSymbol
                      name="open_in_new"
                      size={PILL_ACTION_GLYPH}
                    />
                    {t(`${K}.check.lookup`)}
                  </a>
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  disabled
                  className={PILL_ACTION}
                >
                  <MaterialSymbol name="open_in_new" size={PILL_ACTION_GLYPH} />
                  {t(`${K}.check.lookup`)}
                </Button>
              )}
            </div>
          </div>

          {/* The breakdown and the line that stands in for it are ONE slot, so
              they swap through one `AnimatePresence` rather than each appearing
              on its own terms. Enter-only and `initial={false}`: the empty line
              is what the card rests at, and it must not animate itself in on
              first paint behind the page's card cascade. `initial`/`animate` are
              on the keyed child because that node remounts on every swap and has
              no parent clock left to inherit — a variants-only child there
              renders blank. */}
          <AnimatePresence initial={false}>
            <motion.div
              key={breakdown ? "breakdown" : "empty"}
              variants={staggerRowItem}
              initial="hidden"
              animate="visible"
            >
              {breakdown ? (
                <div className={BREAKDOWN.GRID}>
                  <div className={cn(BREAKDOWN.CELL, BREAKDOWN.CELL_NEUTRAL)}>
                    <span className={SETTING_ROW.CONSEQUENCE}>
                      {t(`${K}.breakdown.tac`)}
                    </span>
                    <span className={READOUT_ROW.VALUE_MONO}>
                      {breakdown.tac}
                    </span>
                  </div>
                  <div className={cn(BREAKDOWN.CELL, BREAKDOWN.CELL_NEUTRAL)}>
                    <span className={SETTING_ROW.CONSEQUENCE}>
                      {t(`${K}.breakdown.serial`)}
                    </span>
                    <span className={READOUT_ROW.VALUE_MONO}>
                      {breakdown.snr}
                    </span>
                  </div>
                  {/* The accent cell — see `BREAKDOWN.CELL_ACCENT` for why the
                      check digit is the one that gets promoted. */}
                  <div className={cn(BREAKDOWN.CELL, BREAKDOWN.CELL_ACCENT)}>
                    <span className={SETTING_ROW_DIRTY.CONSEQUENCE_ON_FILL}>
                      {t(`${K}.breakdown.check`)}
                    </span>
                    <span className={READOUT_ROW.VALUE_MONO}>
                      {breakdown.checkDigit}
                    </span>
                  </div>
                </div>
              ) : (
                <p className={SETTING_ROW.CONSEQUENCE}>
                  {t(`${K}.check.empty`)}
                </p>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        <p className={SETTING_ROW.CONSEQUENCE}>{t(`${K}.footnote`)}</p>
      </CardContent>
    </Card>
  );
};

export default IMEIToolsCard;
