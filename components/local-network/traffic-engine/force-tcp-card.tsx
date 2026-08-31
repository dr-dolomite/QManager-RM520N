"use client";

import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Banner } from "@/components/ui/banner";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";

import { useForceTcp } from "@/hooks/use-force-tcp";
import {
  CARD_HEAD,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  HOST_ROW,
  SETTING_ROW,
} from "./shapes";

// =============================================================================
// ForceTcpCard — QUIC Force-TCP, fully independent of the engine
// =============================================================================
// Renders at the very bottom of the page in EVERY state, including before the
// engine is installed. That placement is documented and deliberate
// (docs/reference/dpi.md > QUIC handling), and the re-author keeps it: the card
// talks through its own `use-force-tcp` hook with zero coupling to the engine
// hooks, so it stays usable when the engine read fails.
//
// -----------------------------------------------------------------------------
// THE CAVEAT WAS A WARNING DRAWN AS GREY BODY TEXT
// -----------------------------------------------------------------------------
// Finding 12. The retired tile hand-rolled two `rounded-tile bg-surface-container
// p-3` blocks, one carrying a `CheckCircle2Icon` greyed to
// `text-muted-foreground` — a success glyph in muted ink on a neutral block,
// which is neither a chip nor a banner. Beside it sat a genuine `warning`
// (forcing TCP can stream SLOWER on a network where QUIC already runs at full
// speed) rendered in the same neutral grey as the reassurance above it, so the
// two read as equally weighted notes.
//
// One is now a `degraded` Banner with the 36px glyph disc, and the other has no
// block at all: "works with either mode, and with neither" is a property of the
// control, so it belongs in the control's own consequence line, not in a box
// competing with the warning.
// =============================================================================

export function ForceTcpCard() {
  const { t } = useTranslation("common");
  const forceTcp = useForceTcp();

  const commit = async (next: boolean) => {
    const ok = await forceTcp.save(next);
    if (ok) {
      toast.success(
        t(
          next
            ? "trafficEngine.forceTcp.toast_enabled"
            : "trafficEngine.forceTcp.toast_disabled",
        ),
      );
    }
  };

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={cn(CARD_PAD, CARD_HEAD.ROOT)}>
        <div className={CARD_HEAD.TITLES}>
          <span className={CARD_TITLE}>{t("trafficEngine.forceTcp.title")}</span>
          <span className={CARD_HEAD.DESC}>
            {t("trafficEngine.forceTcp.description")}
          </span>
        </div>
        <div className={CARD_HEAD.ACTIONS}>
          {/* Identity, not status: it says what this control IS relative to the
              engine, and there is no second state for a glyph to disambiguate.
              That makes it a Tag, never a Badge (The Two-Form Rule). */}
          <Tag variant="neutral">{t("trafficEngine.forceTcp.independent")}</Tag>
        </div>
      </CardHeader>

      <CardContent className={cn(CARD_PAD, "flex flex-col gap-4")}>
        {forceTcp.isLoading ? (
          <Skeleton className={cn(HOST_ROW.HEIGHT, "w-full rounded-pill")} />
        ) : (
          <div className={SETTING_ROW.ROOT}>
            <span className={SETTING_ROW.TEXT}>
              <span className={SETTING_ROW.LABEL}>
                {t("trafficEngine.forceTcp.label")}
              </span>
              <span className={SETTING_ROW.HINT}>
                {t("trafficEngine.forceTcp.hint")}
              </span>
            </span>
            <Switch
              checked={forceTcp.data?.force_tcp ?? false}
              disabled={forceTcp.isSaving}
              aria-label={t("trafficEngine.forceTcp.switch_aria")}
              onCheckedChange={commit}
            />
          </div>
        )}

        {/* A real warning, drawn as one. The retired tile put this in the same
            neutral block as the reassurance beside it. */}
        <Banner
          role="degraded"
          title={t("trafficEngine.forceTcp.caveat_title")}
          description={t("trafficEngine.forceTcp.caveat")}
        />

        {forceTcp.error !== null ? (
          <Banner
            role="stale"
            title={t("trafficEngine.forceTcp.read_error")}
            description={forceTcp.error}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

export default ForceTcpCard;
