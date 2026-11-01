"use client";

import * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import {
  CheckIcon,
  CircleAlertIcon,
  CircleSlashIcon,
  RefreshCcwIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CardFoot } from "@/components/ui/card-foot";
import { SaveButton } from "@/components/ui/save-button";
import { SEGMENTED, SegmentedField, type SegmentedOption } from "@/components/ui/segmented-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { staggerRowItem, staggerRows } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { CustomDnsCurrentSource } from "@/types/custom-dns";

import { CUSTOM_PROVIDER_ID, DNS_PROVIDERS } from "./dns-providers";
import { MAX_SERVERS, type Draft } from "./draft";
import {
  ANSWER,
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  CONDITION,
  FOOT,
  PROVIDER_TRIGGER,
  SETTING,
  SKELETON,
} from "./shapes";

// The page anchor; its foot applies the draft the IPv4 and IPv6 cards also edit.

const K = "dns";

type OnOff = "on" | "off";

/** The lucide check that SegmentedField reserves on every segment. */
const renderCheckGlyph = (className: string) => (
  <CheckIcon size={SEGMENTED.GLYPH} className={className} aria-hidden="true" />
);

const ROW_CASCADE = { variants: staggerRows, initial: "hidden", animate: "visible" } as const;

/** Literal keys so the checker can resolve them. */
const SOURCE_SUB: Record<CustomDnsCurrentSource, string> = {
  custom: `${K}.rows.answering.source_custom`,
  carrier: `${K}.rows.answering.source_carrier`,
  unknown: `${K}.rows.answering.source_unknown`,
};

function SettingRow({
  label,
  labelFor,
  sub,
  held = false,
  children,
}: {
  label: string;
  labelFor?: string;
  sub: string;
  held?: boolean;
  children: React.ReactNode;
}) {
  return (
    <motion.div variants={staggerRowItem} className={SETTING.ROW}>
      <div className={cn(SETTING.KEY, held && SETTING.HELD)}>
        {labelFor ? (
          <label htmlFor={labelFor} className={SETTING.KEY_LINE}>
            {label}
          </label>
        ) : (
          <span className={SETTING.KEY_LINE}>{label}</span>
        )}
        <span className={SETTING.KEY_SUB}>{sub}</span>
      </div>
      <div className={SETTING.CONTROL}>{children}</div>
    </motion.div>
  );
}

function Condition({
  glyph: Glyph,
  title,
  body,
  action,
  onAction,
}: {
  glyph: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <div role="alert" className={CONDITION.ROOT}>
      <span aria-hidden="true" className={CONDITION.DISC}>
        <Glyph className={CONDITION.GLYPH} />
      </span>
      <div className={CONDITION.TEXT}>
        <p className={CONDITION.TITLE}>{title}</p>
        <p className={CONDITION.BODY}>{body}</p>
      </div>
      <Button variant="ghost" onClick={onAction} className={CONDITION.ACTION}>
        <RefreshCcwIcon className="size-4" aria-hidden="true" />
        {action}
      </Button>
    </div>
  );
}

export interface ResolverCardProps {
  status: "pending" | "ready" | "failed" | "unavailable";
  formId: string;
  draft: Draft;
  /** `<DNSMode>` as read, for the unavailable condition. */
  dnsMode: string;
  currentUpstream: string[];
  currentSource: CustomDnsCurrentSource;
  isSaving: boolean;
  saved: boolean;
  isDirty: boolean;
  canApply: boolean;
  /** Why Apply is blocked, as a translation key; null when it is not. */
  blockedKey: string | null;
  /** Translated reason for the last failed save; never the backend text. */
  saveError: string | null;
  onToggle: (enabled: boolean) => void;
  onIgnoreCarrier: (ignore: boolean) => void;
  onProvider: (id: string) => void;
  onDiscard: () => void;
  onSubmit: (event: React.FormEvent) => void;
  onRetry: () => void;
}

export function ResolverCard({
  status,
  formId,
  draft,
  dnsMode,
  currentUpstream,
  currentSource,
  isSaving,
  saved,
  isDirty,
  canApply,
  blockedKey,
  saveError,
  onToggle,
  onIgnoreCarrier,
  onProvider,
  onDiscard,
  onSubmit,
  onRetry,
}: ResolverCardProps) {
  const { t } = useTranslation("local-network");
  const providerId = React.useId();
  const modeKnown = dnsMode !== "" && dnsMode.toUpperCase() !== "UNKNOWN";

  const onOffOptions: SegmentedOption<OnOff>[] = [
    { value: "off", label: t("common:state.off") },
    { value: "on", label: t("common:state.on") },
  ];

  const header = (
    <CardHeader className={CARD_PAD}>
      <CardTitle className={CARD_TITLE}>{t(`${K}.cards.resolver.title`)}</CardTitle>
      <CardDescription className={CARD_DESC}>
        {t(`${K}.cards.resolver.description`)}
      </CardDescription>
    </CardHeader>
  );

  if (status === "failed" || status === "unavailable") {
    return (
      <Card className={CARD_SHELL}>
        {header}
        <CardContent className={CARD_PAD}>
          {status === "failed" ? (
            <Condition
              glyph={CircleAlertIcon}
              title={t(`${K}.error_load_title`)}
              body={t(`${K}.error_load_desc`)}
              action={t("common:actions.retry")}
              onAction={onRetry}
            />
          ) : (
            <Condition
              glyph={CircleSlashIcon}
              title={
                modeKnown
                  ? t(`${K}.unavailable_title`, { mode: dnsMode })
                  : t(`${K}.unavailable_title_unknown`)
              }
              body={t(modeKnown ? `${K}.unavailable_desc` : `${K}.unavailable_desc_unknown`)}
              action={t(`${K}.action_check_again`)}
              onAction={onRetry}
            />
          )}
        </CardContent>
      </Card>
    );
  }

  const pending = status === "pending";

  const footStatus = pending ? null : saveError ? (
    // A failed save stays visible here until the next save.
    <span className={FOOT.FAILED}>
      <TriangleAlertIcon className={FOOT.GLYPH} aria-hidden="true" />
      {saveError}
    </span>
  ) : blockedKey !== null ? (
    <span className={FOOT.BLOCKED}>{t(blockedKey, { max: MAX_SERVERS })}</span>
  ) : null;

  return (
    <Card className={CARD_SHELL}>
      {header}
      <CardContent className={CARD_PAD}>
        {pending ? (
          <div className={SETTING.GROUP_WIDE} aria-hidden="true">
            {["w-[8.5rem]", "w-56", "w-[8.5rem]", "w-40"].map((pill, i) => (
              <div key={i} className={SETTING.ROW}>
                <div className="flex flex-col gap-1">
                  <Skeleton className={SKELETON.ROW_KEY} />
                  <Skeleton className={SKELETON.ROW_SUB} />
                </div>
                <Skeleton className={cn(SKELETON.PILL, "ml-auto", pill)} />
              </div>
            ))}
          </div>
        ) : (
          <form id={formId} onSubmit={onSubmit}>
            <motion.div className={SETTING.GROUP_WIDE} {...ROW_CASCADE}>
              <SettingRow
                label={t(`${K}.rows.mode.label`)}
                sub={t(
                  draft.enabled
                    ? `${K}.rows.mode.consequence_on`
                    : `${K}.rows.mode.consequence_off`,
                )}
              >
                <SegmentedField
                  value={draft.enabled ? "on" : "off"}
                  onValueChange={(next) => onToggle(next === "on")}
                  options={onOffOptions}
                  ariaLabel={t(`${K}.rows.mode.label`)}
                  disabled={isSaving}
                  breakpoint="never"
                  glyph={renderCheckGlyph}
                />
              </SettingRow>

              <SettingRow
                label={t(`${K}.rows.provider.label`)}
                labelFor={providerId}
                sub={t(`${K}.rows.provider.consequence`)}
                held={!draft.enabled}
              >
                <div className={PROVIDER_TRIGGER}>
                  <Select
                    value={draft.provider}
                    onValueChange={onProvider}
                    disabled={!draft.enabled || isSaving}
                  >
                    <SelectTrigger id={providerId} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DNS_PROVIDERS.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                      <SelectItem value={CUSTOM_PROVIDER_ID}>
                        {t(`${K}.provider_custom`)}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </SettingRow>

              <SettingRow
                label={t(`${K}.rows.ignore_carrier.label`)}
                sub={t(
                  draft.ignoreCarrier
                    ? `${K}.rows.ignore_carrier.consequence_on`
                    : `${K}.rows.ignore_carrier.consequence_off`,
                )}
                held={!draft.enabled}
              >
                <SegmentedField
                  value={draft.ignoreCarrier ? "on" : "off"}
                  onValueChange={(next) => onIgnoreCarrier(next === "on")}
                  options={onOffOptions}
                  ariaLabel={t(`${K}.rows.ignore_carrier.label`)}
                  disabled={!draft.enabled || isSaving}
                  breakpoint="never"
                  glyph={renderCheckGlyph}
                />
              </SettingRow>

              <SettingRow
                label={t(`${K}.rows.answering.label`)}
                sub={t(SOURCE_SUB[currentSource])}
              >
                {currentUpstream.length > 0 ? (
                  <ul className={ANSWER.LIST}>
                    {currentUpstream.map((address) => (
                      <li key={address} className={ANSWER.ADDRESS}>
                        {address}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className={ANSWER.NONE}>{t(`${K}.rows.answering.none`)}</span>
                )}
              </SettingRow>
            </motion.div>
          </form>
        )}
      </CardContent>

      {/* Outside the form so `mt-auto` reaches the card edge; `form=` keeps Enter-to-submit. */}
      <CardFoot
        className={CARD_PAD}
        liveStatus={!pending}
        status={footStatus}
        actions={
          pending ? (
            <Skeleton className={SKELETON.ACTION} aria-hidden="true" />
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                size="action"
                onClick={onDiscard}
                disabled={!isDirty || isSaving}
              >
                {t(`${K}.action_discard`)}
              </Button>
              <SaveButton
                type="submit"
                form={formId}
                isSaving={isSaving}
                saved={saved}
                label={t("common:actions.apply")}
                disabled={!canApply}
                size="action"
              />
            </>
          )
        }
      />
    </Card>
  );
}

export default ResolverCard;
