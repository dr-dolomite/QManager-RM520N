"use client";

import type * as React from "react";
import { CloudOffIcon, GlobeIcon } from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { staggerItem, staggerRows } from "@/lib/motion";
import type { LanguagePackInstallState } from "@/types/i18n";
import { cn } from "@/lib/utils";

import ConditionBlock from "./condition-block";
import PackRow from "./pack-row";
import type { PackRow as PackRowData } from "./derive";
import {
  CARD_BODY,
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  CONDITION_PANEL,
  ERROR_STATE,
  GROUP_FILL,
  ROW_GROUP,
} from "./shapes";

const K = "languages";

export interface CommunityPacksCardProps {
  packs: PackRowData[];
  /** Non-null when the list GET failed or the device couldn't reach GitHub. */
  catalogError: string | null;
  install: LanguagePackInstallState;
  onInstall: (code: string) => void;
  onCancel: () => void;
  onRetry: () => void;
}

/**
 * The peer card. Three mutually exclusive states, each built to FILL: an
 * unreachable catalog and an empty one are different facts, and a card that
 * conflates them tells the user their device is broken when it is not.
 */
export function CommunityPacksCard({
  packs,
  catalogError,
  install,
  onInstall,
  onCancel,
  onRetry,
}: CommunityPacksCardProps): React.JSX.Element {
  const { t } = useTranslation("system-settings");

  return (
    <motion.div variants={staggerItem}>
      <Card className={CARD_SHELL}>
        <CardHeader className={CARD_PAD}>
          <CardTitle className={CARD_TITLE}>
            {t(`${K}.community.title`)}
          </CardTitle>
          <CardDescription className={CARD_DESC}>
            {t(`${K}.community.description`)}
          </CardDescription>
        </CardHeader>

        <CardContent className={cn(CARD_PAD, CARD_BODY)}>
          {catalogError ? (
            <div className={ERROR_STATE.ROOT}>
              <ConditionBlock
                tone="warning"
                glyph={CloudOffIcon}
                ariaRole="alert"
                title={t(`${K}.states.unreachable.title`)}
                description={t(`${K}.states.unreachable.description`)}
                onRetry={onRetry}
                retryLabel={t(`${K}.actions.check_again`)}
                className={CONDITION_PANEL.SCREEN}
              />
              {/* The device's own words, quoted rather than folded into the
                  sentence above — an English fragment does not translate. */}
              <p className={ERROR_STATE.DETAIL}>{catalogError}</p>
            </div>
          ) : packs.length === 0 ? (
            <ConditionBlock
              tone="neutral"
              glyph={GlobeIcon}
              ariaRole="status"
              title={t(`${K}.states.none.title`)}
              description={t(`${K}.states.none.description`)}
              onRetry={onRetry}
              retryLabel={t(`${K}.actions.check_again`)}
              className={CONDITION_PANEL.SCREEN}
            />
          ) : (
            // The page clock has already run by the time this mounts, so this
            // cascade declares its own initial/animate rather than inheriting.
            <motion.div
              aria-label={t(`${K}.community.list_aria`)}
              className={cn(ROW_GROUP, GROUP_FILL)}
              initial="hidden"
              animate="visible"
              variants={staggerRows}
            >
              {packs.map((pack) => (
                <PackRow
                  key={pack.code}
                  pack={pack}
                  install={install}
                  onInstall={onInstall}
                  onCancel={onCancel}
                />
              ))}
            </motion.div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

export default CommunityPacksCard;
