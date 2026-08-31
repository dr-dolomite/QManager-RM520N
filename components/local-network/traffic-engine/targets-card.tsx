"use client";

import * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Loader2Icon, PlusIcon, TargetIcon, XIcon } from "lucide-react";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";
import { staggerRowItem, staggerRows } from "@/lib/motion";

import {
  CARD_HEAD,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  FIELD,
  FIELD_ROW,
  HOST_ROW,
  PILL_ACTION,
} from "./shapes";
import type { UseCdnHostlistReturn } from "@/hooks/use-cdn-hostlist";
import type { DpiMode } from "@/types/traffic-engine";

// =============================================================================
// TargetsCard — the Video Optimizer hostlist editor
// =============================================================================
// Replaces `cdn-hostlist-card.tsx`. Two things change beyond the tokens.
//
// -----------------------------------------------------------------------------
// A CONTROL THAT CANNOT WORK NOW EXPLAINS WHY, INSTEAD OF DISAPPEARING
// -----------------------------------------------------------------------------
// Finding 17. Switching to Traffic Masquerade used to unmount this editor along
// with its tab. The saved list still exists on the modem and applies again the
// moment you switch back — but the interface's only statement about that was
// its absence, which reads as "the list is gone" (The State-Honesty Rule).
//
// The card now stays mounted in every mode and says what is true: masquerade
// desyncs every connection, so there is no list to match against, and the saved
// domains are kept. The count Tag changes with it — "12 of 300" while the list
// is live, "12 saved" while it is idle — because the ceiling is only meaningful
// when there is something to fill.
//
// The editor is deliberately NOT disabled in the idle state either. The list is
// stored independently of the mode and tpws re-reads it per connection, so
// editing it while masquerade is on is a legitimate thing to do; what would be
// dishonest is implying the edits take effect right now.
//
// -----------------------------------------------------------------------------
// THE BANNER ROLE IS `override`, WHERE THE COMP DREW `info`
// -----------------------------------------------------------------------------
// Stated rather than hidden. Every `primary-container` banner role in the canon
// is a system CONDITION or a notification; this is a page-scoped note about one
// control, which is exactly what `override` is defined as — and it is the one
// role whose ink is `on-surface` rather than an `on-*-container`. Neutral is
// also the honest tone: nothing here is wrong.
// =============================================================================

const DOMAIN_PATTERN = /^[A-Za-z0-9._-]+$/;
const MAX_DOMAINS = 300;

export interface TargetsCardProps {
  hostlist: UseCdnHostlistReturn;
  /** The single derived answer. Decides live vs idle, never a data sniff. */
  mode: DpiMode;
}

export function TargetsCard({ hostlist, mode }: TargetsCardProps) {
  const { t } = useTranslation("common");

  const [draft, setDraft] = React.useState("");
  const [localError, setLocalError] = React.useState<string | null>(null);

  // The list is not consulted while masquerade owns the engine. It is still
  // stored, still editable, and still applies the moment the mode changes back.
  const idle = mode === "masquerade";
  const count = hostlist.domains.length;

  const addDomain = () => {
    const value = draft.trim().toLowerCase();
    setLocalError(null);
    if (!value) return;
    if (!DOMAIN_PATTERN.test(value) || !value.includes(".")) {
      setLocalError(t("trafficEngine.hostlist.invalid"));
      return;
    }
    if (hostlist.domains.includes(value)) {
      setLocalError(t("trafficEngine.hostlist.duplicate"));
      return;
    }
    if (count >= MAX_DOMAINS) {
      setLocalError(t("trafficEngine.hostlist.limit"));
      return;
    }
    hostlist.saveDomains([...hostlist.domains, value]).then((ok) => {
      if (ok) {
        setDraft("");
        toast.success(t("trafficEngine.hostlist.saved"));
      } else {
        // Backend failures must never be silent: the hook records the error
        // (rendered inline below) and the toast makes the failure immediate.
        toast.error(t("trafficEngine.hostlist.save_failed"));
      }
    });
  };

  const removeDomain = (domain: string) => {
    hostlist.saveDomains(hostlist.domains.filter((d) => d !== domain)).then((ok) => {
      toast[ok ? "success" : "error"](
        t(ok ? "trafficEngine.hostlist.saved" : "trafficEngine.hostlist.save_failed"),
      );
    });
  };

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={cn(CARD_PAD, CARD_HEAD.ROOT)}>
        <div className={CARD_HEAD.TITLES}>
          <span className={CARD_TITLE}>{t("trafficEngine.targets.title")}</span>
          <span className={CARD_HEAD.DESC}>
            {t("trafficEngine.targets.description")}
          </span>
        </div>
        {hostlist.isLoading ? null : (
          <div className={CARD_HEAD.ACTIONS}>
            <Tag variant="neutral" className="tabular-nums">
              {idle
                ? t("trafficEngine.targets.count_saved", { count })
                : t("trafficEngine.targets.count", { count, max: MAX_DOMAINS })}
            </Tag>
          </div>
        )}
      </CardHeader>

      <CardContent className={cn(CARD_PAD, "flex flex-col gap-4")}>
        {idle ? (
          <Banner
            role="override"
            icon={TargetIcon}
            title={t("trafficEngine.targets.idle_title")}
            description={
              count > 0
                ? t("trafficEngine.targets.idle_body", { count })
                : t("trafficEngine.targets.idle_body_empty")
            }
          />
        ) : null}

        {hostlist.isLoading ? (
          <div className={HOST_ROW.LIST}>
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className={cn(HOST_ROW.HEIGHT, "rounded-pill")} />
            ))}
          </div>
        ) : count === 0 ? (
          <p className="text-on-surface-variant text-sm">
            {t("trafficEngine.hostlist.empty")}
          </p>
        ) : (
          <motion.ul
            className={HOST_ROW.LIST}
            variants={staggerRows}
            initial="hidden"
            animate="visible"
          >
            {hostlist.domains.map((domain) => (
              <motion.li key={domain} className={HOST_ROW.ROOT} variants={staggerRowItem}>
                {/* A domain IS a machine string — matched byte-for-byte against
                    the SNI on the wire — so this is one of the places the
                    Machine-Voice Rule genuinely sends text to `font-mono`. */}
                <span className={HOST_ROW.TEXT}>{domain}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className={HOST_ROW.REMOVE}
                  aria-label={t("trafficEngine.hostlist.remove", { domain })}
                  onClick={() => removeDomain(domain)}
                >
                  <XIcon className={HOST_ROW.GLYPH} />
                </Button>
              </motion.li>
            ))}
          </motion.ul>
        )}

        <div className={FIELD_ROW}>
          {/* A raw input, deliberately not the `Input` primitive — its base
              string carries `dark:bg-input/30` and `md:text-sm`, so the fill
              reverts in dark mode and the size reverts at a 768px VIEWPORT,
              which is a viewport breakpoint leaking into a container-query
              surface. See `FIELD` in shapes.ts. */}
          <input
            type="text"
            placeholder="example.com"
            className={FIELD}
            value={draft}
            aria-label={t("trafficEngine.hostlist.add")}
            aria-invalid={localError !== null}
            onChange={(event) => {
              setDraft(event.target.value);
              setLocalError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addDomain();
              }
            }}
          />
          <Button
            onClick={addDomain}
            disabled={!draft.trim() || hostlist.isSaving}
            className={PILL_ACTION}
          >
            {hostlist.isSaving ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <PlusIcon className="size-4" />
            )}
            {t("trafficEngine.hostlist.add")}
          </Button>
        </div>

        {localError !== null ? (
          <p className="text-destructive-on-surface text-sm" role="alert">
            {localError}
          </p>
        ) : null}

        {hostlist.error !== null ? (
          <p className="text-destructive-on-surface text-sm" role="alert">
            {hostlist.error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default TargetsCard;
