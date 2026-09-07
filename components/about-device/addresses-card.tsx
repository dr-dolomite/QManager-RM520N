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
import { staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { AboutDeviceData } from "@/types/about-device";

import { PUBLIC_IP_PROBE, addressGroups } from "./derive";
import { CardEmpty, Group, GroupStack, RowSkeletons, ValueRow } from "./metric-rows";
import {
  CARD_BODY,
  CARD_CELL,
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  PROVENANCE,
  SKELETON,
  type AboutView,
} from "./shapes";

const K = "aboutDevice";

export interface AddressesCardProps {
  view: AboutView;
  data: AboutDeviceData | null;
}

/**
 * Where the device sits on the LAN and on the carrier. Grouping Local / WWAN /
 * Public is what lets an empty IPv6 row read as "not assigned" rather than as
 * "not read" — the provenance line under the groups says which is which.
 */
export function AddressesCard({
  view,
  data,
}: AddressesCardProps): React.JSX.Element {
  const { t } = useTranslation("common");

  return (
    <motion.div variants={staggerItem} className={CARD_CELL}>
      <Card className={CARD_SHELL}>
        <CardHeader className={CARD_PAD}>
          <CardTitle className={CARD_TITLE}>
            {t(`${K}.addresses.title`)}
          </CardTitle>
          <CardDescription className={CARD_DESC}>
            {t(`${K}.addresses.description`)}
          </CardDescription>
        </CardHeader>

        <CardContent className={cn(CARD_PAD, CARD_BODY)} aria-live="polite">
          {view === "loading" ? (
            <RowSkeletons count={SKELETON.ADDRESS_ROWS} />
          ) : view === "unreachable" || !data ? (
            <CardEmpty
              title={t(`${K}.empty.title`)}
              body={t(`${K}.empty.addresses`)}
            />
          ) : (
            <GroupStack>
              {addressGroups(data).map((group) => (
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
              <p className={PROVENANCE}>
                {t(`${K}.addresses.provenance`, { probe: PUBLIC_IP_PROBE })}
              </p>
            </GroupStack>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

export default AddressesCard;
