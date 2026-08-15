"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { authFetch } from "@/lib/auth-fetch";
import { Button } from "@/components/ui/button";
import { useSaveFlash } from "@/components/ui/save-button";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { RefreshCcwIcon } from "lucide-react";

import {
  EthernetErrorState,
  EthernetSettingsCard,
  EthernetTiles,
  EthernetTilesSkeleton,
  type EthernetStatus,
} from "./ethernet-card";

// =============================================================================
// Ethernet Status — page shell
// =============================================================================
// The shell owns ALL the data (fetch, 10s poll, speed-limit apply with its
// confirm-poll) and renders the page: a header with a Refresh pill, then a
// `staggerContainer` cascade over the presentational body from
// `ethernet-card.tsx`. Same anatomy as `components/cellular/cellular-information.tsx`:
// the stateful component owns the data and the stateless children draw it.
//
// The backend contract is unchanged: the CGI accepts one write (`speed_limit`)
// and returns `disconnect_window_seconds` so the UI can wait out the PHY
// bounce before confirming the new speed.
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/network/ethernet.sh";

const EthernetStatusComponent = () => {
  const { t } = useTranslation("common");
  const K = "ethernet";

  const [status, setStatus] = useState<EthernetStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [hasError, setHasError] = useState(false);
  const { saved, markSaved } = useSaveFlash();

  const mountedRef = useRef(true);
  const hasDataRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Fetch ethernet status
  // ---------------------------------------------------------------------------
  const fetchStatus = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);

    try {
      const resp = await authFetch(CGI_ENDPOINT);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const data = await resp.json();
      if (!mountedRef.current) return;

      if (data.success) {
        hasDataRef.current = true;
        setHasError(false);
        setStatus({
          link_status: data.link_status,
          speed: data.speed,
          duplex: data.duplex,
          auto_negotiation: data.auto_negotiation,
          speed_limit: data.speed_limit,
          supports_2500: data.supports_2500,
        });
      }
    } catch {
      // Only surface errors when we have no data to show.
      if (mountedRef.current && !hasDataRef.current) {
        setHasError(true);
      }
    } finally {
      if (mountedRef.current && !silent) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchStatus();

    const interval = setInterval(() => {
      fetchStatus(true);
    }, 10000);

    return () => clearInterval(interval);
  }, [fetchStatus]);

  // ---------------------------------------------------------------------------
  // Set link speed limit
  // ---------------------------------------------------------------------------
  const handleSpeedChange = async (value: string) => {
    setIsSaving(true);
    // Optimistic update so the dropdown shows the requested value during PHY bounce.
    setStatus((prev) => (prev ? { ...prev, speed_limit: value } : prev));

    const MAX_POLLS = 6;
    const POLL_INTERVAL_MS = 1500;

    // Polls until the link comes back up at the requested speed, or gives up.
    // Returns true if confirmed, false if exhausted.
    const confirmSpeedChange = async (requestedValue: string, windowSec: number): Promise<boolean> => {
      await new Promise((resolve) => setTimeout(resolve, windowSec * 1000));

      for (let i = 0; i < MAX_POLLS; i++) {
        if (!mountedRef.current) return false;
        try {
          const pollResp = await authFetch(CGI_ENDPOINT);
          if (pollResp.ok) {
            const pollData = await pollResp.json();
            if (!mountedRef.current) return false;
            if (
              pollData.success === true &&
              pollData.speed_limit === requestedValue &&
              pollData.link_status === "up" &&
              pollData.speed &&
              pollData.speed !== "Unknown"
            ) {
              setStatus({
                link_status: pollData.link_status,
                speed: pollData.speed,
                duplex: pollData.duplex,
                auto_negotiation: pollData.auto_negotiation,
                speed_limit: pollData.speed_limit,
                supports_2500: pollData.supports_2500,
              });
              setHasError(false);
              hasDataRef.current = true;
              return true;
            }
          }
        } catch {
          // PHY may still be renegotiating; retry.
        }
        if (i < MAX_POLLS - 1) {
          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        }
      }

      // Exhausted — re-sync to whatever the modem currently reports.
      if (mountedRef.current) await fetchStatus(true);
      return false;
    };

    try {
      const resp = await authFetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ speed_limit: value }),
      });

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const data = await resp.json();
      if (!mountedRef.current) return;

      if (data.success) {
        // Backend reports how long the PHY link bounce takes. Fall back to
        // 8 s if the field is missing (older builds / non-ethtool paths).
        const windowSec =
          typeof data.disconnect_window_seconds === "number"
            ? data.disconnect_window_seconds
            : 8;

        const confirmed = await confirmSpeedChange(value, windowSec);

        // markSaved() must fire after the confirm-poll resolves, in the same
        // synchronous continuation as the finally block's setIsSaving(false)
        // below — otherwise isSaving stays true (and wins the render ternary
        // over saved) for the whole ~8s poll window. See issue #10.
        //
        // An exhausted poll is NOT a save: the link never came back at the
        // requested speed, so claiming "updated" would be the interface lying
        // about what the device is doing (State-Honesty Rule). The catch path
        // below says the same thing in the same words.
        if (!mountedRef.current) return;
        if (confirmed) {
          markSaved();
          toast.success(t(`${K}.settings.toast_success`));
        } else {
          toast.error(t(`${K}.settings.toast_confirm_error`));
        }
      } else {
        toast.error(data.detail || t(`${K}.settings.toast_error`));
      }
    } catch {
      // Network error during POST likely means the PHY bounced mid-request.
      // Confirm silently rather than showing a false-negative error.
      if (mountedRef.current) {
        const confirmed = await confirmSpeedChange(value, 8);
        if (confirmed) {
          markSaved();
          toast.success(t(`${K}.settings.toast_success`));
        } else {
          toast.error(t(`${K}.settings.toast_confirm_error`));
        }
      }
    } finally {
      if (mountedRef.current) {
        setIsSaving(false);
      }
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <motion.div
      className="@container/main mx-auto flex flex-col gap-5 p-2"
      aria-live="polite"
      aria-atomic="false"
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
    >
      <motion.div variants={staggerItem}>
        <div className="flex flex-col gap-5 @3xl/main:flex-row @3xl/main:items-end">
          <div className="flex max-w-[41rem] flex-col gap-1.5">
            <h1 className="text-3xl font-bold tracking-[-0.02em]">
              {t(`${K}.page.title`)}
            </h1>
            <p className="text-on-surface-variant text-sm leading-relaxed text-pretty">
              {t(`${K}.page.description`)}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 @3xl/main:ml-auto">
            <Button
              type="button"
              variant="outline"
              onClick={() => fetchStatus()}
              disabled={isSaving}
              className="h-[2.625rem] gap-2 rounded-pill px-5 text-sm font-semibold"
            >
              <RefreshCcwIcon className="size-4" />
              {t(`${K}.header.refresh`)}
            </Button>
          </div>
        </div>
      </motion.div>

      {isLoading ? (
        <motion.div variants={staggerItem}>
          <EthernetTilesSkeleton label={t(`${K}.loading_sr`)} />
        </motion.div>
      ) : hasError && !status ? (
        <motion.div variants={staggerItem}>
          <EthernetErrorState
            title={t(`${K}.error.title`)}
            body={t(`${K}.error.body`)}
            retryLabel={t("actions.retry")}
            onRetry={() => fetchStatus()}
          />
        </motion.div>
      ) : status ? (
        <>
          <motion.div variants={staggerItem}>
            <EthernetTiles status={status} />
          </motion.div>
          <motion.div variants={staggerItem}>
            <EthernetSettingsCard
              speedLimit={status.speed_limit}
              supports2500={status.supports_2500 ?? false}
              isSaving={isSaving}
              saved={saved}
              onSpeedChange={handleSpeedChange}
            />
          </motion.div>
        </>
      ) : null}
    </motion.div>
  );
};

export default EthernetStatusComponent;
