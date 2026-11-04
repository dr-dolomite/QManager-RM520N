"use client";

import * as React from "react";
import { useCallback, useId, useMemo, useState } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Banner } from "@/components/ui/banner";
import { useSaveFlash } from "@/components/ui/save-button";
import { useCustomDns } from "@/hooks/use-custom-dns";
import { staggerContainer, staggerItem } from "@/lib/motion";

import { CUSTOM_PROVIDER_ID, DNS_PROVIDERS } from "./dns-providers";
import {
  BASE_SLOTS,
  MAX_SERVERS,
  baselineFrom,
  hasAnyAddress,
  isValidAddress,
  presetFill,
  providerFor,
  sameList,
  serversOf,
  type Draft,
  type Family,
} from "./draft";
import { ResolverCard } from "./resolver-card";
import { ServersCard } from "./servers-card";
import { BANNERS, FAMILY_GRID, PAGE_HEAD, PAGE_ROOT } from "./shapes";

// Holds only the user's edits over a baseline derived from the read; the server
// cards join the Resolver form via `form=`. See docs/reference/custom-dns.md.

const K = "dns";

const BLANK: Draft = {
  enabled: false,
  ignoreCarrier: false,
  v4: Array.from({ length: BASE_SLOTS }, () => ""),
  v6: Array.from({ length: BASE_SLOTS }, () => ""),
  provider: CUSTOM_PROVIDER_ID,
};

const CustomDnsComponent = () => {
  const { t } = useTranslation("local-network");
  const { settings, isLoading, isSaving, error, fieldError, saveSettings, refresh } =
    useCustomDns();
  const { saved, markSaved } = useSaveFlash();
  const formId = useId();

  const baseline = useMemo(() => (settings ? baselineFrom(settings) : null), [settings]);
  const [edits, setEdits] = useState<Partial<Draft>>({});
  const draft = useMemo<Draft>(() => ({ ...(baseline ?? BLANK), ...edits }), [baseline, edits]);

  const status = !settings
    ? isLoading || error === null
      ? "pending"
      : "failed"
    : settings.available === false
      ? "unavailable"
      : "ready";
  const ready = status === "ready";

  // ---------------------------------------------------------------------------
  // Edits
  // ---------------------------------------------------------------------------
  const handleToggle = useCallback(
    (enabled: boolean) =>
      setEdits((prev) => {
        const next = { ...draft, ...prev, enabled };
        // Turning on with nothing to send starts from the first preset.
        return enabled && !hasAnyAddress(next)
          ? { ...prev, enabled, ...presetFill(DNS_PROVIDERS[0].id, next) }
          : { ...prev, enabled };
      }),
    [draft],
  );

  const handleIgnoreCarrier = useCallback(
    (ignoreCarrier: boolean) => setEdits((prev) => ({ ...prev, ignoreCarrier })),
    [],
  );

  const handleProvider = useCallback(
    (id: string) => setEdits((prev) => ({ ...prev, ...presetFill(id, { ...draft, ...prev }) })),
    [draft],
  );

  const handleAddress = useCallback(
    (family: Family, index: number, value: string) =>
      setEdits((prev) => {
        const list = [...({ ...draft, ...prev })[family]];
        list[index] = value;
        const next = { ...draft, ...prev, [family]: list };
        return { ...prev, [family]: list, provider: providerFor(next) };
      }),
    [draft],
  );

  const handleDiscard = useCallback(() => setEdits({}), []);

  // ---------------------------------------------------------------------------
  // Validity
  // ---------------------------------------------------------------------------
  const invalid = useMemo(
    () => ({
      v4: draft.v4.map((v) => draft.enabled && !isValidAddress("v4", v)),
      v6: draft.v6.map((v) => draft.enabled && !isValidAddress("v6", v)),
    }),
    [draft],
  );

  const anyInvalid = invalid.v4.some(Boolean) || invalid.v6.some(Boolean);
  const blockedKey = !draft.enabled
    ? null
    : anyInvalid
      ? `${K}.blocked_invalid`
      : !hasAnyAddress(draft)
        ? `${K}.error_at_least_one`
        : serversOf(draft).length > MAX_SERVERS
          ? `${K}.blocked_too_many`
          : null;

  // While off, addresses and the fallback are held but never sent.
  const isDirty =
    baseline !== null &&
    (draft.enabled || baseline.enabled) &&
    (draft.enabled !== baseline.enabled ||
      draft.ignoreCarrier !== baseline.ignoreCarrier ||
      !sameList(draft.v4, baseline.v4) ||
      !sameList(draft.v6, baseline.v6));

  const canApply = ready && isDirty && blockedKey === null && !isSaving;

  // ---------------------------------------------------------------------------
  // Apply
  // ---------------------------------------------------------------------------
  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (blockedKey !== null) {
        // Enter can still submit a blocked form; refuse out loud.
        toast.error(t(blockedKey, { max: MAX_SERVERS }));
        return;
      }
      if (!canApply) return;

      const ok = await saveSettings({
        enabled: draft.enabled,
        ignoreCarrier: draft.ignoreCarrier,
        // Off sends no servers: the backend strips the block and ignores them.
        servers: draft.enabled ? serversOf(draft) : [],
      });

      if (ok) {
        // The hook stored the applied payload, so the baseline is fresh.
        setEdits({});
        markSaved();
        toast.success(
          t(draft.enabled ? `${K}.toast_success_enabled` : `${K}.toast_success_disabled`),
        );
      } else {
        // The backend's reason renders in the foot; the toast stays one fixed sentence.
        toast.error(t(`${K}.toast_error_apply`));
      }
    },
    [blockedKey, canApply, draft, saveSettings, markSaved, t],
  );

  // Off (or unread) holds the address rows: they keep their values but cannot
  // be edited until custom DNS is on.
  const serversHeld = !ready || !draft.enabled || isSaving;
  // `passthroughBypass` is a CGI stub (always false) and must not render: docs/reference/custom-dns.md.
  const blockCorrupt = settings?.blockCorrupt === true;

  // The cascade root declares `initial`/`animate` once; children must not.
  return (
    <motion.div
      className={PAGE_ROOT}
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
    >
      <motion.div variants={staggerItem}>
        <div className={PAGE_HEAD.ROOT}>
          <div className={PAGE_HEAD.TITLES}>
            <h1 className={PAGE_HEAD.TITLE}>{t(`${K}.page_title`)}</h1>
            <p className={PAGE_HEAD.DESC}>{t(`${K}.page_description`)}</p>
          </div>
        </div>
      </motion.div>

      {blockCorrupt ? (
        <motion.div variants={staggerItem} className={BANNERS}>
          <Banner
            role="degraded"
            title={t(`${K}.banner_corrupt_title`)}
            description={t(`${K}.banner_corrupt_desc`)}
          />
        </motion.div>
      ) : null}

      <motion.div variants={staggerItem}>
        <ResolverCard
          status={status}
          formId={formId}
          draft={draft}
          dnsMode={settings?.dnsMode ?? ""}
          currentUpstream={settings?.currentUpstream ?? []}
          currentSource={settings?.currentSource ?? "unknown"}
          isSaving={isSaving}
          saved={saved}
          isDirty={isDirty}
          canApply={canApply}
          blockedKey={blockedKey}
          saveError={
            fieldError === null
              ? null
              : t(fieldError.field === "servers" ? `${K}.save_failed_servers` : `${K}.toast_error_apply`)
          }
          onToggle={handleToggle}
          onIgnoreCarrier={handleIgnoreCarrier}
          onProvider={handleProvider}
          onDiscard={handleDiscard}
          onSubmit={handleSubmit}
          onRetry={() => refresh()}
        />
      </motion.div>

      {/* A failed read or an unused proxy leaves nothing to edit; the Resolver card says why. */}
      {status === "pending" || status === "ready" ? (
        <motion.div variants={staggerItem} className={FAMILY_GRID}>
          <ServersCard
            family="v4"
            values={draft.v4}
            pending={status === "pending"}
            formId={formId}
            invalid={invalid.v4}
            held={serversHeld}
            onChange={handleAddress}
          />
          <ServersCard
            family="v6"
            values={draft.v6}
            pending={status === "pending"}
            formId={formId}
            invalid={invalid.v6}
            held={serversHeld}
            onChange={handleAddress}
          />
        </motion.div>
      ) : null}
    </motion.div>
  );
};

export default CustomDnsComponent;
