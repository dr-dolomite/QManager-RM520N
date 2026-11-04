"use client";

import * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { staggerRowItem, staggerRows } from "@/lib/motion";
import { cn } from "@/lib/utils";

import { BASE_SLOTS, type Family } from "./draft";
import {
  ADDRESS,
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  FIELD_ERROR,
  SETTING,
  SKELETON,
} from "./shapes";

// One address family's resolvers, no foot (the Resolver card applies). Off holds
// the rows disabled rather than hiding them, so turning DNS on moves nothing.

const K = "dns";

const ROW_CASCADE = { variants: staggerRows, initial: "hidden", animate: "visible" } as const;

/** Literal keys rather than an interpolated suffix, so the checker can resolve them. */
const SLOT_LABEL = [`${K}.rows.primary`, `${K}.rows.secondary`, `${K}.rows.tertiary`] as const;

const FAMILY = {
  v4: {
    title: `${K}.cards.ipv4.title`,
    description: `${K}.cards.ipv4.description`,
    error: `${K}.error_invalid_ipv4`,
    placeholders: [`${K}.placeholder_primary_dns`, `${K}.placeholder_secondary_dns`],
    width: ADDRESS.V4,
    inputMode: "decimal",
  },
  v6: {
    title: `${K}.cards.ipv6.title`,
    description: `${K}.cards.ipv6.description`,
    error: `${K}.error_invalid_ipv6`,
    placeholders: [`${K}.placeholder_primary_dns6`, `${K}.placeholder_secondary_dns6`],
    width: ADDRESS.V6,
    inputMode: "text",
  },
} as const;

export interface ServersCardProps {
  family: Family;
  /** One entry per slot; pending renders the default slot count. */
  values: string[];
  pending: boolean;
  /** The Resolver card's form, which these fields submit. */
  formId: string;
  invalid: boolean[];
  held: boolean;
  onChange: (family: Family, index: number, value: string) => void;
}

export function ServersCard({
  family,
  values,
  pending,
  formId,
  invalid,
  held,
  onChange,
}: ServersCardProps) {
  const { t } = useTranslation("local-network");
  const baseId = React.useId();
  const errorId = `${baseId}-error`;
  const spec = FAMILY[family];
  const familyInvalid = invalid.some(Boolean);

  // A slot past the third (only reachable from a hand-edited list) is numbered.
  const slotLabel = (index: number) =>
    index < SLOT_LABEL.length
      ? t(SLOT_LABEL[index])
      : t(`${K}.rows.slot_n`, { n: index + 1 });

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={CARD_PAD}>
        <CardTitle className={CARD_TITLE}>{t(spec.title)}</CardTitle>
        <CardDescription className={CARD_DESC}>{t(spec.description)}</CardDescription>
      </CardHeader>

      <CardContent className={CARD_PAD}>
        {pending ? (
          <div className={SETTING.GROUP} aria-hidden="true">
            {Array.from({ length: BASE_SLOTS }, (_, i) => (
              <div key={i} className={SETTING.ROW}>
                <Skeleton className={SKELETON.ROW_KEY} />
                <Skeleton className={cn(SKELETON.FIELD, "ml-auto", spec.width)} />
              </div>
            ))}
          </div>
        ) : (
          <motion.div className={SETTING.GROUP} {...ROW_CASCADE}>
            {values.map((value, index) => {
              const id = `${baseId}-${index}`;
              const bad = invalid[index] === true;
              const placeholder = spec.placeholders[index];
              return (
                <motion.div key={index} variants={staggerRowItem} className={SETTING.ROW}>
                  <div className={cn(SETTING.KEY_SLOT, held && SETTING.HELD)}>
                    <label htmlFor={id} className={SETTING.KEY_LINE}>
                      {slotLabel(index)}
                    </label>
                  </div>
                  <div className={cn(SETTING.CONTROL, spec.width)}>
                    <Input
                      id={id}
                      form={formId}
                      value={value}
                      onChange={(event) => onChange(family, index, event.target.value)}
                      disabled={held}
                      inputMode={spec.inputMode}
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      placeholder={placeholder ? t(placeholder) : undefined}
                      aria-invalid={bad || undefined}
                      aria-describedby={bad ? errorId : undefined}
                      className={cn(ADDRESS.INPUT, bad && ADDRESS.INVALID)}
                    />
                  </div>
                </motion.div>
              );
            })}
            {familyInvalid ? (
              <p id={errorId} role="alert" className={FIELD_ERROR}>
                {t(spec.error)}
              </p>
            ) : null}
          </motion.div>
        )}
      </CardContent>
    </Card>
  );
}

export default ServersCard;
