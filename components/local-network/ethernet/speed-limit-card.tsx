"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import { CheckIcon, Loader2Icon } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  PROVENANCE,
  ROW,
  ROW_GROUP,
} from "./shapes";

// =============================================================================
// SpeedLimitCard — Band B of /local-network/ethernet
// =============================================================================
// The one thing this page can WRITE, in one row of one group, under a band that
// reports what the link is actually doing. Same grammar `/cellular/settings`
// landed on: a live band with its own clock above a writable band with its own.
//
// -----------------------------------------------------------------------------
// IT APPLIES ON CHANGE, AND THE TRIGGER IS THE CONFIRMATION
// -----------------------------------------------------------------------------
// The backend contract is POST `speed_limit` -> PHY bounce -> confirm-poll, so
// there is no moment between "chosen" and "applied" for a Save button to occupy.
// The trigger carries the three states instead — spinner "Applying…" -> check
// "Saved" -> the value. This is the interaction the retired card had, and it is
// kept deliberately; only the shape and the copy are new.
//
// -----------------------------------------------------------------------------
// THE CONSEQUENCE LINE IS REQUIRED, AND IT NAMES THE RISK
// -----------------------------------------------------------------------------
// Applying drops the link for about 8 seconds while the PHY renegotiates, and
// the person reading this is almost certainly ON that link — the app runs on the
// modem. A settings row that does not say so is a field rather than a decision
// (Product Principle 6: make the dangerous obvious).
//
// It changes with the row's condition rather than staying constant, because a
// sentence that is true in every state is decoration. While applying it says
// what is happening now; while the poll is failing or there is no controller it
// says why the control is held — a control that cannot currently work explains
// itself instead of sitting there dead (The State-Honesty Rule).
//
// -----------------------------------------------------------------------------
// THE CARD IS A PEER
// -----------------------------------------------------------------------------
// `rounded-card` on the whisper shadow, not `rounded-hero` on `shadow-sm`. Hero
// radius belongs to the one card that anchors a surface; the anchor here is the
// strip above, and `shadow-sm` is outside the shadow vocabulary entirely. The
// header is a plain `CardTitle` + `CardDescription` with no icon.
// =============================================================================

const K = "ethernet";

/** Where the value is read back from. A literal the device holds, never prose. */
const CONFIG_PATH = "/etc/qmanager/ethernet_speed";

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
  saved: boolean;
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
  onSpeedChange: (value: string) => void;
}

export function SpeedLimitCard({
  speedLimit,
  supports2500,
  isSaving,
  saved,
  hasStatus,
  pollFailed,
  interfacePresent,
  onSpeedChange,
}: SpeedLimitCardProps) {
  const { t } = useTranslation("common");

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
                value={speedLimit}
                onValueChange={onSpeedChange}
                disabled={isSaving || held}
              >
                <SelectTrigger
                  aria-labelledby={SPEED_LIMIT_LABEL_ID}
                  className={FIELD}
                >
                  {isSaving ? (
                    <span className="flex items-center gap-2">
                      <Loader2Icon
                        className={cn(
                          FIELD_GLYPH,
                          "animate-spin motion-reduce:animate-none",
                        )}
                      />
                      {t(`${K}.settings.applying`)}
                    </span>
                  ) : saved ? (
                    <span className="flex items-center gap-2">
                      <CheckIcon className={FIELD_GLYPH} />
                      {t(`${K}.settings.saved`)}
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

        {/* The path is a machine string, so it takes the machine voice. It sits
            after a colon rather than inside the sentence: a path spliced
            mid-sentence would force every locale to keep it at the English word
            position, which is the one thing a translator must be free to move. */}
        <span className={PROVENANCE}>
          {t(`${K}.settings.provenance`)}{" "}
          <span className="font-mono">{CONFIG_PATH}</span>
        </span>
      </CardContent>
    </Card>
  );
}

export default SpeedLimitCard;
