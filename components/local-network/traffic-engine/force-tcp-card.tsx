"use client";

import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { failureReason } from "./failure-reason";
import { CheckIcon, RefreshCcwIcon } from "lucide-react";

import { Banner, bannerActionVariants } from "@/components/ui/banner";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SEGMENTED, SegmentedField } from "@/components/ui/segmented-field";
import { Skeleton } from "@/components/ui/skeleton";
import { Tag } from "@/components/ui/tag";
import { useForceTcp } from "@/hooks/use-force-tcp";
import { cn } from "@/lib/utils";

import {
  CARD_ACTION,
  CARD_BODY,
  CARD_DESC,
  CARD_HEAD,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  FIELD,
  ONOFF_CTL,
  SKELETON,
} from "./shapes";

// QUIC Force-TCP: its own hook and its own CGI action, independent of the engine, so it
// renders in every state of the page (docs/reference/dpi.md > QUIC handling).

const renderCheckGlyph = (className: string) => (
  <CheckIcon size={SEGMENTED.GLYPH} className={className} aria-hidden="true" />
);

export function ForceTcpCard() {
  const { t } = useTranslation("local-network");
  const forceTcp = useForceTcp();
  const enabled = forceTcp.data?.force_tcp ?? false;

  const commit = async (next: boolean) => {
    const result = await forceTcp.save(next);
    if (result.ok) {
      toast.success(
        t(next ? "traffic_engine.force_tcp_toast_enabled" : "traffic_engine.force_tcp_toast_disabled"),
      );
    } else {
      toast.error(t("traffic_engine.force_tcp_toast_error"), {
        description: failureReason(t, result),
      });
    }
  };

  return (
    <Card id="traffic-engine-force-tcp" className={CARD_SHELL}>
      <CardHeader className={cn(CARD_PAD, CARD_HEAD)}>
        <CardTitle className={CARD_TITLE}>{t("traffic_engine.force_tcp_title")}</CardTitle>
        <CardDescription className={CARD_DESC}>
          {t("traffic_engine.force_tcp_description")}
        </CardDescription>
        <CardAction className={CARD_ACTION}>
          <Tag variant="neutral">{t("traffic_engine.force_tcp_independent")}</Tag>
        </CardAction>
      </CardHeader>

      <CardContent className={cn(CARD_PAD, CARD_BODY, "gap-4")}>
        <div className={FIELD.ROW}>
          <div className={FIELD.TEXT}>
            <p className={FIELD.LABEL}>{t("traffic_engine.force_tcp_label")}</p>
            <p className={FIELD.HINT}>{t("traffic_engine.force_tcp_hint")}</p>
          </div>
          {forceTcp.isLoading ? (
            <Skeleton className={SKELETON.ONOFF} />
          ) : (
            <SegmentedField
              value={enabled ? "on" : "off"}
              onValueChange={(next) => void commit(next === "on")}
              ariaLabel={t("traffic_engine.force_tcp_label")}
              disabled={forceTcp.isSaving || forceTcp.data === null}
              breakpoint="never"
              glyph={renderCheckGlyph}
              className={ONOFF_CTL}
              options={[
                { value: "off", label: t("state.off", { ns: "common" }) },
                { value: "on", label: t("state.on", { ns: "common" }) },
              ]}
            />
          )}
        </div>

        <Banner
          role="degraded"
          title={t("traffic_engine.force_tcp_caveat_title")}
          description={t("traffic_engine.force_tcp_caveat")}
        />

        {forceTcp.error !== null && forceTcp.data === null && !forceTcp.isLoading ? (
          <Banner
            role="stale"
            title={t("traffic_engine.force_tcp_read_error")}
            description={forceTcp.error}
            action={
              <button
                type="button"
                onClick={() => forceTcp.refresh()}
                className={bannerActionVariants({ tone: "destructive" })}
              >
                <RefreshCcwIcon aria-hidden="true" />
                {t("actions.retry", { ns: "common" })}
              </button>
            }
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

export default ForceTcpCard;
