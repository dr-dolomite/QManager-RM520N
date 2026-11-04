"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import { Loader2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CardFoot } from "@/components/ui/card-foot";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import {
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  FIELD,
  FIELD_GLYPH,
  ROW,
  ROW_GROUP,
} from "./shapes";

// =============================================================================
// SpeedLimitCard — Band B of /local-network/ethernet
// =============================================================================
// The Select edits a draft and `CardFoot` commits it (Card-Foot Apply Rule):
// applying drops the link the person is on for ~8s, so a stray pick must not cut
// the session. The consequence line changes with the row's condition and says why
// the control is held when it cannot work (State-Honesty Rule).
// =============================================================================

const K = "ethernet";

const SPEED_LIMIT_LABEL_ID = "ethernet-speed-limit-label";

export interface SpeedLimitCardProps {
  /**
   * The saved limit, or `""` when nothing has been read yet.
   *
   * The empty string is load-bearing, not a placeholder for laziness: it makes
   * the trigger fall back to its own placeholder instead of rendering "Auto
   * (max)" as a confirmed-looking selection over a modem that has never
   * answered. That defect — a never-read card presenting a default as a setting
   * — is the one APN Management closed on 2026-08-31.
   */
  speedLimit: string;
  supports2500: boolean;
  isSaving: boolean;
  /** False until the first successful read lands. */
  hasStatus: boolean;
  /**
   * True when the most recent poll failed. The control is HELD rather than
   * hidden: the value on screen is still the last thing the modem confirmed, and
   * writing against a modem that has stopped answering would leave the page
   * unable to say whether the write landed.
   */
  pollFailed: boolean;
  /** False when the device has no `eth0` at all. There is nothing to configure. */
  interfacePresent: boolean;
  /** Resolves true once the new speed is confirmed on the link. */
  onApply: (value: string) => Promise<boolean>;
}

export function SpeedLimitCard({
  speedLimit,
  supports2500,
  isSaving,
  hasStatus,
  pollFailed,
  interfacePresent,
  onApply,
}: SpeedLimitCardProps) {
  const { t } = useTranslation("common");

  const { saved, markSaved } = useSaveFlash();
  const [draft, setDraft] = React.useState<string | null>(null);

  const value = draft ?? speedLimit;
  const isDirty = draft !== null && draft !== speedLimit;
  const held = !interfacePresent || !hasStatus || (pollFailed && !isSaving);
  const consequence = !interfacePresent
    ? t(`${K}.settings.consequence_absent`)
    : isSaving
      ? t(`${K}.settings.consequence_applying`)
      : !hasStatus
        ? t(`${K}.settings.consequence_unread`)
        : pollFailed
          ? t(`${K}.settings.consequence_unresponsive`)
          : t(`${K}.settings.consequence`);

  const handleApply = async () => {
    if (draft === null || !isDirty) return;
    const ok = await onApply(draft);
    if (ok) {
      setDraft(null);
      markSaved();
    }
  };

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={CARD_PAD}>
        <CardTitle className={CARD_TITLE}>{t(`${K}.settings.title`)}</CardTitle>
        <CardDescription>{t(`${K}.settings.description`)}</CardDescription>
      </CardHeader>
      <CardContent className={cn(CARD_PAD, "flex flex-col gap-3")}>
        <div className={ROW_GROUP}>
          <div className={ROW.ROOT}>
            <div className={ROW.TEXT}>
              <span id={SPEED_LIMIT_LABEL_ID} className={ROW.LABEL}>
                {t(`${K}.settings.row_label`)}
              </span>
              <span className={ROW.CONSEQUENCE}>{consequence}</span>
            </div>
            <div className={ROW.CONTROL}>
              <Select
                value={value}
                onValueChange={setDraft}
                disabled={isSaving || held}
              >
                <SelectTrigger
                  host="container"
                  aria-labelledby={SPEED_LIMIT_LABEL_ID}
                  className={FIELD}
                >
                  {isSaving ? (
                    <span className="flex items-center gap-2">
                      <Loader2Icon
                        className={cn(
                          FIELD_GLYPH,
                          "motion-safe:animate-spin",
                        )}
                      />
                      {t(`${K}.settings.applying`)}
                    </span>
                  ) : (
                    <SelectValue placeholder={t(`${K}.settings.placeholder`)} />
                  )}
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>{t(`${K}.settings.group_label`)}</SelectLabel>
                    <SelectItem value="auto">
                      {t(`${K}.settings.option_auto`)}
                    </SelectItem>
                    <SelectItem value="10">
                      {t(`${K}.settings.option_10`)}
                    </SelectItem>
                    <SelectItem value="100">
                      {t(`${K}.settings.option_100`)}
                    </SelectItem>
                    <SelectItem value="1000">
                      {t(`${K}.settings.option_1000`)}
                    </SelectItem>
                    {/* The option is hidden rather than disabled when the PHY
                        cannot do 2.5G — offering a rate the hardware will refuse
                        is an interface lying about what the device can do. The
                        FACT still reaches the user, as the rate tile's ceiling
                        caption. */}
                    {supports2500 ? (
                      <SelectItem value="2500">
                        {t(`${K}.settings.option_2500`)}
                      </SelectItem>
                    ) : null}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </CardContent>
      <CardFoot
        className={CARD_PAD}
        actions={
          <>
            <Button
              type="button"
              variant="ghost"
              size="action"
              onClick={() => setDraft(null)}
              disabled={!isDirty || isSaving}
            >
              {t(`${K}.settings.discard`)}
            </Button>
            <SaveButton
              type="button"
              isSaving={isSaving}
              saved={saved}
              disabled={!isDirty || held}
              label={t(`${K}.settings.apply`)}
              size="action"
              onClick={handleApply}
            />
          </>
        }
      />
    </Card>
  );
}

export default SpeedLimitCard;
