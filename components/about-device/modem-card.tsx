"use client";

import type * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tag } from "@/components/ui/tag";
import { staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { AboutDeviceData } from "@/types/about-device";

import { modemGroups } from "./derive";
import { CardEmpty, Group, GroupStack, RowSkeletons, SlotRow, ValueRow } from "./metric-rows";
import {
  CARD_BODY,
  CARD_CELL,
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  SKELETON,
  VALUE_NONE,
  type AboutView,
} from "./shapes";

const K = "aboutDevice";

export interface ModemCardProps {
  view: AboutView;
  data: AboutDeviceData | null;
}

/**
 * Hardware identity. The 3GPP releases are the one place a hue is earned on
 * this page: R16 on the LTE leg and R16 on the NR leg are IDENTITY, so they
 * take outline tags rather than a status chip.
 */
export function ModemCard({ view, data }: ModemCardProps): React.JSX.Element {
  const { t } = useTranslation("common");

  return (
    <motion.div variants={staggerItem} className={CARD_CELL}>
      <Card className={CARD_SHELL}>
        <CardHeader className={CARD_PAD}>
          <CardTitle className={CARD_TITLE}>{t(`${K}.modem.title`)}</CardTitle>
          <CardDescription className={CARD_DESC}>
            {t(`${K}.modem.description`)}
          </CardDescription>
        </CardHeader>

        <CardContent className={cn(CARD_PAD, CARD_BODY)} aria-live="polite">
          {view === "loading" ? (
            <RowSkeletons count={SKELETON.MODEM_ROWS} />
          ) : view === "unreachable" || !data ? (
            <CardEmpty
              title={t(`${K}.empty.title`)}
              body={t(`${K}.empty.modem`)}
            />
          ) : (
            <GroupStack>
              {modemGroups(data).map((group) => (
                <Group
                  key={group.id}
                  label={
                    group.labelKey ? t(`${K}.${group.labelKey}`) : undefined
                  }
                >
                  {group.rows.map((row) => (
                    <ValueRow
                      key={row.id}
                      label={t(`${K}.${row.labelKey}`)}
                      value={row.value}
                      mono={row.mono}
                    />
                  ))}
                </Group>
              ))}

              <Group label={t(`${K}.groups.three_gpp`)}>
                <SlotRow label={t(`${K}.rows.lte`)}>
                  <Tag variant="lte">
                    {data.threeGppRelease.lte || VALUE_NONE}
                  </Tag>
                </SlotRow>
                <SlotRow label={t(`${K}.rows.nr5g`)}>
                  <Tag variant="nr">
                    {data.threeGppRelease.nr5g || VALUE_NONE}
                  </Tag>
                </SlotRow>
              </Group>
            </GroupStack>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

export default ModemCard;
