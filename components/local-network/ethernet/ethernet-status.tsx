"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { RefreshCcwIcon } from "lucide-react";

import { authFetch } from "@/lib/auth-fetch";
import { Button } from "@/components/ui/button";
import { useSaveFlash } from "@/components/ui/save-button";
import { staggerContainer, staggerItem } from "@/lib/motion";

import { LinkStateStrip } from "./link-state-strip";
import { SpeedLimitCard } from "./speed-limit-card";
import { PAGE_ROOT, PILL_ACTION } from "./shapes";
import type { EthernetStatus } from "./types";

// =============================================================================
// Ethernet Status — page shell
// =============================================================================
// The shell owns ALL the data (fetch, 10s poll, speed-limit apply with its
// confirm-poll) and renders the page: a header with a Refresh pill, then a
// `staggerContainer` cascade over one live band and one write card.
//
// -----------------------------------------------------------------------------
// A FAILED REFRESH IS NOW REPORTED. IT USED TO BE SWALLOWED.
// -----------------------------------------------------------------------------
// The retired shell gated its error state on `!hasDataRef.current` — "only
// surface errors when we have no data to show". After ONE successful load that
// condition can never be true again, so a dead 10s poll and a healthy one
// rendered identically, forever: four confident figures, frozen, with nothing on
// screen saying so.
//
// The flag is now `pollFailed`, set on every failure and cleared on every
// success, and the two states it distinguishes are different things:
//
//   pollFailed && status !== null   the figures are STALE. They are held (they
//                                   are still the last thing the modem
//                                   confirmed), the band shows its warning chip,
//                                   and the write control is held with a
//                                   sentence saying why.
//   pollFailed && status === null   nothing was ever read. The band renders one
//                                   spanning notice instead of four tiles.
//
// -----------------------------------------------------------------------------
// THE POLL STANDS DOWN DURING AN APPLY
// -----------------------------------------------------------------------------
// Applying a speed limit deliberately drops the link for ~8s, so the background
// poll would fail during a window we CAUSED and raise "Not responding" over a
// working device. The interval skips while a write is in flight; the apply's own
// confirm-poll is what watches the link come back, and the consequence line
// under the control already says what is happening.
//
// The backend contract is otherwise unchanged: the CGI accepts one write
// (`speed_limit`) and returns `disconnect_window_seconds` so the UI can wait out
// the PHY bounce before confirming the new speed. It gained one READ-ONLY field
// on 2026-08-31 — `interface_present` — so the UI can tell "no cable" from "no
// controller"; a missing value means true.
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/network/ethernet.sh";
const K = "ethernet";

const EthernetStatusComponent = () => {
  const { t } = useTranslation("common");

  const [status, setStatus] = useState<EthernetStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [pollFailed, setPollFailed] = useState(false);
  const { saved, markSaved } = useSaveFlash();

  const mountedRef = useRef(true);
  // Read by the interval, which closes over its first render. A state value
  // would be stale there; the ref is what makes the stand-down actually stand
  // down.
  const savingRef = useRef(false);

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
    // A background poll during an apply would fail on a link WE dropped.
    if (silent && savingRef.current) return;
    if (!silent) setIsLoading(true);

    try {
      const resp = await authFetch(CGI_ENDPOINT);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const data = await resp.json();
      if (!mountedRef.current) return;

      // `success: false` is a read that did not happen, not a read that found
      // nothing. Falling through to the finally block would have cleared the
      // loading flag and left the page on a permanent skeleton.
      if (!data.success) throw new Error("unsuccessful response");

      setPollFailed(false);
      setStatus({
        link_status: data.link_status,
        speed: data.speed,
        duplex: data.duplex,
        auto_negotiation: data.auto_negotiation,
        speed_limit: data.speed_limit,
        supports_2500: data.supports_2500,
        interface_present: data.interface_present,
      });
    } catch {
      if (mountedRef.current) {
        setPollFailed(true);
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
    savingRef.current = true;
    // Optimistic update so the dropdown shows the requested value during PHY bounce.
    setStatus((prev) => (prev ? { ...prev, speed_limit: value } : prev));

    const MAX_POLLS = 6;
    const POLL_INTERVAL_MS = 1500;

    // Polls until the link comes back up at the requested speed, or gives up.
    // Returns true if confirmed, false if exhausted.
    const confirmSpeedChange = async (
      requestedValue: string,
      windowSec: number,
    ): Promise<boolean> => {
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
                interface_present: pollData.interface_present,
              });
              setPollFailed(false);
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

      // Exhausted — re-sync to whatever the modem currently reports. This runs
      // BEFORE savingRef is cleared, so it goes through the non-silent path.
      if (mountedRef.current) await fetchStatus();
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
      savingRef.current = false;
      if (mountedRef.current) {
        setIsSaving(false);
      }
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  // The cascade root declares `initial`/`animate` once. The band and the card
  // are `staggerItem` children and must NOT declare their own, or they detach
  // from the parent's clock.
  return (
    <motion.div
      className={PAGE_ROOT}
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
              className={PILL_ACTION}
            >
              <RefreshCcwIcon className="size-4" />
              {t(`${K}.header.refresh`)}
            </Button>
          </div>
        </div>
      </motion.div>

      <motion.div variants={staggerItem}>
        <LinkStateStrip
          status={status}
          isLoading={isLoading}
          pollFailed={pollFailed}
        />
      </motion.div>

      <motion.div variants={staggerItem}>
        <SpeedLimitCard
          // NOT `?? "auto"`. A defaulted value here would render the modem's
          // most common setting as a confirmed selection on a page that has
          // never read the modem.
          speedLimit={status?.speed_limit ?? ""}
          supports2500={status?.supports_2500 ?? false}
          isSaving={isSaving}
          saved={saved}
          hasStatus={status !== null}
          pollFailed={pollFailed}
          interfacePresent={status?.interface_present !== false}
          onSpeedChange={handleSpeedChange}
        />
      </motion.div>
    </motion.div>
  );
};

export default EthernetStatusComponent;
