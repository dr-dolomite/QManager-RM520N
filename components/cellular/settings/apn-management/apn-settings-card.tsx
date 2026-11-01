"use client";

import * as React from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CardFoot } from "@/components/ui/card-foot";
import {
  MaterialSymbol,
  type MaterialSymbolName,
} from "@/components/ui/material-symbol";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import {
  SEGMENTED,
  SegmentedField,
  type SegmentedOption,
} from "@/components/ui/segmented-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tag } from "@/components/ui/tag";
import { ConditionScreen } from "@/components/cellular/condition-screen";
import type { ApnPreset } from "@/lib/apn-presets";
import { compressIPv6 } from "@/lib/ipv6";
import { staggerRowItem, staggerRows } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type {
  ApnActionResult,
  ApnSaveRequest,
  ApnSetting,
  CidContext,
} from "@/types/apn-settings";
import { PDP_TYPE_OPTIONS } from "@/types/apn-settings";
import type { ModemStatus } from "@/types/modem-status";

import { ApplyFootSkeleton } from "../apply-foot";
import RefreshButton from "../refresh-button";
import SettingRow from "../setting-row";
import {
  APN_VERDICT,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  FIELD_SHELL,
  READOUT_ROW,
  REVEAL,
  ROW_GROUP,
  SELECT_TRIGGER,
  SETTING_ROW,
} from "../shapes";
import { ApnPresetField } from "./apn-preset-field";

// APN write card (RM551E v0.1.34 layout): live readout incl. the GRANTED APN (+CGCONTRDP), settings, then commit. The
// verdict is held "unknown" mid-write, on a stale poller, or with either half missing.

const K = "core_settings.apn";
const R = `${K}.readout`;

/** No value to show. Punctuation, not copy. */
const EM_DASH = "—";

const renderCheckGlyph = (className: string) => (
  <MaterialSymbol
    name="check"
    filled
    size={SEGMENTED.GLYPH}
    aria-hidden="true"
    className={className}
  />
);

/** CIDs offered when the modem's context list has not arrived. */
const FALLBACK_CIDS = [1, 2, 3, 4, 5, 6] as const;

/** Conventional IMS / emergency contexts, guarded when the modem reported none. */
const FALLBACK_RESERVED_CIDS: readonly number[] = [2, 3];

/** "unverified" is the empty-list case: same guard, weaker claim. */
type PendingReserved = { cid: number; kind: "ims" | "emergency" | "unverified" };

/** The APN input: the family field plus a 260px floor so a long APN does not truncate. */
const APN_INPUT = cn(FIELD_SHELL, "@2xl/card:w-[16.25rem]");

export interface ApnSettingsCardProps {
  apn: ApnSetting | null;
  cids: CidContext[] | null;
  /** 1 = custom APN live, 0 = carrier default, null before first fetch. */
  active: number | null;
  /** The live WAN-bearing CID, or null before first fetch. */
  activeCid: number | null;
  isLoading: boolean;
  isSaving: boolean;
  /** A write's response was lost to the attach-cycle link drop; the re-read decides. */
  isReconciling: boolean;
  /** The first read failed and there is nothing to show (translated). */
  loadError: string | null;
  onRetry: () => void;
  onSave: (request: ApnSaveRequest) => Promise<ApnActionResult>;
  onDeactivate: () => Promise<ApnActionResult>;
  /** Known internet APNs for the SIM's network; null hides the suggestions. */
  presets: ApnPreset[] | null;
  /** Poller snapshot: the granted APN and WAN addresses. */
  status: ModemStatus | null;
  statusStale: boolean;
  statusError: string | null;
}


function CidTag({ ctx }: { ctx: CidContext }) {
  const { t } = useTranslation("cellular");
  const F = `${K}.edit.fields.modem_profile`;

  if (ctx.apn_type === "ims") {
    return (
      <Tag variant="neutral">
        <MaterialSymbol name="call" size={12} />
        {t(`${F}.ims_badge`)}
      </Tag>
    );
  }
  if (ctx.apn_type === "emergency") {
    return (
      <Tag variant="neutral">
        <MaterialSymbol name="sos" size={12} />
        {t(`${F}.sos_badge`)}
      </Tag>
    );
  }
  if (ctx.is_internet) {
    return (
      <Tag variant="neutral">
        <MaterialSymbol name="public" size={12} />
        {t(`${F}.for_internet`)}
      </Tag>
    );
  }
  return null;
}


type Verdict = "match" | "drift" | "unknown";

function ReadoutRow({
  label,
  value,
  glyph,
  glyphClass,
  mono = false,
  quiet = false,
  srVerdict,
}: {
  label: string;
  value: string;
  glyph?: MaterialSymbolName;
  glyphClass?: string;
  mono?: boolean;
  quiet?: boolean;
  /** The verdict in words, for assistive tech; the glyph is decorative. */
  srVerdict?: string;
}) {
  return (
    <div className={READOUT_ROW.ROOT}>
      <span className={READOUT_ROW.LABEL}>{label}</span>
      <span className={READOUT_ROW.VALUE_GROUP}>
        {glyph ? (
          <MaterialSymbol
            name={glyph}
            filled
            size={APN_VERDICT.GLYPH}
            className={cn("flex-none", glyphClass)}
          />
        ) : null}
        <span
          title={mono ? value : undefined}
          className={cn(
            mono ? READOUT_ROW.VALUE_MONO : READOUT_ROW.VALUE_TEXT,
            quiet && "text-on-surface-variant font-medium",
          )}
        >
          {value}
        </span>
        {srVerdict ? <span className="sr-only">{srVerdict}</span> : null}
      </span>
    </div>
  );
}

/** One sentence under the readout, arriving through the 0fr to 1fr row. */
function ReadoutNote({
  open,
  glyph,
  children,
}: {
  open: boolean;
  glyph: MaterialSymbolName;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(REVEAL.ROOT, open ? REVEAL.OPEN : REVEAL.CLOSED)}
      aria-hidden={!open}
    >
      <div className={REVEAL.CLIP}>
        <p className={cn(APN_VERDICT.NOTE, "pt-0.5")}>
          <MaterialSymbol
            name={glyph}
            size={APN_VERDICT.GLYPH}
            className="mt-0.5 flex-none"
          />
          {children}
        </p>
      </div>
    </div>
  );
}

function ApnReadout({
  active,
  activeCid,
  storedApn,
  holdVerdict,
  status,
  statusStale,
  statusError,
}: {
  active: number | null;
  activeCid: number | null;
  storedApn: string;
  holdVerdict: boolean;
  status: ModemStatus | null;
  statusStale: boolean;
  statusError: string | null;
}) {
  const { t } = useTranslation("cellular");

  const isCustom = active === 1;
  const network = status?.network;
  // +CGCONTRDP's APN: what the network granted, not what was asked for.
  const grantedApn = network?.apn?.trim() || null;
  const v4 = network?.wan_ipv4?.trim() || null;
  const v6Raw = network?.wan_ipv6?.trim() || null;
  const v6 = v6Raw ? compressIPv6(v6Raw) : null;
  const attached = !!v4 || !!v6;
  const stale = statusStale && !!status;
  const unavailable = !!statusError && !status;

  const verdict: Verdict =
    !isCustom || grantedApn === null || holdVerdict || stale
      ? "unknown"
      : storedApn.trim().toLowerCase() === grantedApn.toLowerCase()
        ? "match"
        : "drift";

  const grantedIp = !status
    ? null
    : v4 && v6
      ? t(`${R}.ip_both`)
      : v4
        ? t(`${R}.ip_v4_only`)
        : v6
          ? t(`${R}.ip_v6_only`)
          : t(`${R}.ip_none`);

  // "Not connected" only when the poller says no address was granted; no reading is a dash.
  const contextValue = !status
    ? EM_DASH
    : attached && activeCid !== null
      ? t(`${K}.edit.fields.modem_profile.option_template`, { cid: activeCid })
      : t(`${R}.not_connected`);

  return (
    <div className="flex flex-col gap-2">
      <div className={READOUT_ROW.LIST}>
        <ReadoutRow
          label={t(`${R}.mode_label`)}
          value={
            active === null
              ? EM_DASH
              : isCustom
                ? t(`${R}.custom`)
                : t(`${K}.status.carrier_default`)
          }
          quiet={!isCustom}
        />
        <ReadoutRow
          label={t(`${K}.status.network_using_label`)}
          value={grantedApn ?? EM_DASH}
          mono={grantedApn !== null}
          quiet={grantedApn === null}
          glyph={
            verdict === "match"
              ? "check_circle"
              : verdict === "drift"
                ? "warning"
                : undefined
          }
          glyphClass={verdict === "match" ? APN_VERDICT.MATCH : APN_VERDICT.DRIFT}
          srVerdict={
            verdict === "match"
              ? t(`${R}.matches`)
              : verdict === "drift"
                ? t(`${K}.status.not_live`)
                : undefined
          }
        />
        <ReadoutRow
          label={t(`${R}.context_label`)}
          value={contextValue}
          glyph={status && !attached ? "link_off" : undefined}
          glyphClass={APN_VERDICT.QUIET}
          quiet={!status || !attached}
        />
        <ReadoutRow
          label={t(`${R}.granted_ip`)}
          value={grantedIp ?? EM_DASH}
          quiet={!grantedIp || !attached}
        />
      </div>

      <ReadoutNote open={verdict === "drift"} glyph="warning">
        {t(`${R}.not_live_note`)}
      </ReadoutNote>
      <ReadoutNote open={stale} glyph="schedule">
        {t(`${R}.stale_body`)}
      </ReadoutNote>
      <ReadoutNote open={unavailable} glyph="error">
        {t(`${R}.error_body`)}
      </ReadoutNote>
    </div>
  );
}


function ApnCardHeader() {
  const { t } = useTranslation("cellular");
  return (
    <CardHeader className={CARD_PAD}>
      <CardTitle className={CARD_TITLE}>{t(`${K}.card.title`)}</CardTitle>
      <CardDescription>{t(`${K}.card.description`)}</CardDescription>
    </CardHeader>
  );
}

/** Loading: geometry imported from the loaded card's own constants. */
function ApnSettingsCardSkeleton() {
  return (
    <Card className={CARD_SHELL}>
      <ApnCardHeader />
      <CardContent className={cn(CARD_PAD, "flex flex-col gap-4")}>
        <div className={READOUT_ROW.LIST}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className={READOUT_ROW.HEIGHT} />
          ))}
        </div>
        <div className={ROW_GROUP.ROOT}>
          {Array.from({ length: 3 }).map((_, i) => (
            <React.Fragment key={i}>
              {i > 0 ? <div className={ROW_GROUP.DIVIDER} /> : null}
              <Skeleton className={cn(SETTING_ROW.HEIGHT, "rounded-field")} />
            </React.Fragment>
          ))}
        </div>
      </CardContent>
      <ApplyFootSkeleton />
    </Card>
  );
}


export function ApnSettingsCard({
  apn,
  cids,
  active,
  activeCid,
  isLoading,
  isSaving,
  isReconciling,
  loadError,
  onRetry,
  onSave,
  onDeactivate,
  presets,
  status,
  statusStale,
  statusError,
}: ApnSettingsCardProps) {
  const { t } = useTranslation("cellular");
  const { saved, markSaved } = useSaveFlash();
  const formId = React.useId();
  const apnLabelId = React.useId();
  const pdpLabelId = React.useId();
  const cidLabelId = React.useId();

  // Re-seeded whenever the stored baseline changes (a reconcile, a retry), so a
  // carrier-overridden APN replaces the value the user asked for.
  const baselineKey = apn ? JSON.stringify([apn.apn, apn.pdp_type, apn.cid]) : null;

  const [syncedKey, setSyncedKey] = React.useState<string | null>(null);
  const [apnValue, setApnValue] = React.useState("");
  const [pdpType, setPdpType] = React.useState("ipv4v6");
  const [cid, setCid] = React.useState("1");

  // Render-phase sync from PROPS, the case the React Compiler allows.
  if (apn && baselineKey !== syncedKey) {
    setSyncedKey(baselineKey);
    setApnValue(apn.apn);
    setPdpType(apn.pdp_type || "ipv4v6");
    setCid(String(apn.cid));
  }

  const [apnError, setApnError] = React.useState("");
  const [pendingCid, setPendingCid] = React.useState<PendingReserved | null>(
    null,
  );
  const [confirmDeactivate, setConfirmDeactivate] = React.useState(false);

  const pdpOptions: SegmentedOption<string>[] = PDP_TYPE_OPTIONS.map(
    (option) => ({
      value: option.value,
      label: t(`${K}.edit.fields.pdp_type.options.${option.value}`),
    }),
  );

  if (isLoading) return <ApnSettingsCardSkeleton />;

  // Only the NEVER-READ case: a failed re-read keeps the previous snapshot.
  if (!apn) {
    return (
      <Card className={CARD_SHELL}>
        <ApnCardHeader />
        <CardContent className={cn(CARD_PAD, "flex flex-1 flex-col")}>
          <ConditionScreen
            tone="destructive"
            glyph="error"
            ariaRole="alert"
            title={t(`${K}.page.error_load_title`)}
            description={loadError ?? t(`${K}.cards.unread`)}
            onRetry={onRetry}
            retryLabel={t("actions.retry", { ns: "common" })}
            className="flex-1 rounded-tile py-10"
          />
        </CardContent>
      </Card>
    );
  }

  const contexts = cids ?? [];

  // --- Dirty tracking --------------------------------------------------------

  const savedPdp = apn.pdp_type || "ipv4v6";
  const savedCid = String(apn.cid);
  const apnDirty = apnValue !== apn.apn;
  const pdpDirty = pdpType !== savedPdp;
  const cidDirty = cid !== savedCid;
  const isDirty = apnDirty || pdpDirty || cidDirty;
  const busy = isSaving || isReconciling;

  const pdpLabelOf = (value: string) =>
    pdpOptions.find((option) => option.value === value)?.label ?? value;
  const cidLabelOf = (value: string | number) =>
    t(`${K}.edit.fields.modem_profile.option_template`, { cid: value });

  const apnDelta = apnDirty
    ? `${apn.apn || EM_DASH} → ${apnValue.trim() || EM_DASH}`
    : null;
  const pdpDelta = pdpDirty
    ? `${pdpLabelOf(savedPdp)} → ${pdpLabelOf(pdpType)}`
    : null;
  const cidDelta = cidDirty ? `${cidLabelOf(savedCid)} → ${cidLabelOf(cid)}` : null;

  // --- CID selection — intercept reserved contexts for confirmation ----------
  // The modem's own classification when it reported one; a conventional
  // fallback, worded as the guess it is, when it reported nothing.
  const handleCidChange = (value: string) => {
    const ctx = contexts.find((context) => String(context.cid) === value);
    if (ctx) {
      if (ctx.apn_type === "ims" || ctx.apn_type === "emergency") {
        setPendingCid({ cid: ctx.cid, kind: ctx.apn_type });
        return;
      }
      setCid(value);
      return;
    }
    if (contexts.length === 0 && FALLBACK_RESERVED_CIDS.includes(Number(value))) {
      setPendingCid({ cid: Number(value), kind: "unverified" });
      return;
    }
    setCid(value);
  };

  const confirmCidChange = () => {
    if (pendingCid) setCid(String(pendingCid.cid));
    setPendingCid(null);
  };

  // --- Commit ----------------------------------------------------------------

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!apnValue.trim()) {
      setApnError(t(`${K}.edit.fields.apn.error_required`));
      return;
    }
    setApnError("");

    const result = await onSave({
      apn: apnValue.trim(),
      pdp_type: pdpType,
      cid: parseInt(cid, 10),
    });

    // Three outcomes: "reconciling" means the attach cycle dropped the link
    // before the reply came back, so the write almost certainly landed.
    if (result.outcome === "failed") {
      toast.error(t(`${K}.toast.save_error`), { description: result.error });
      return;
    }
    markSaved();
    if (result.outcome === "reconciling") {
      toast.success(t(`${K}.toast.reconciling`));
    } else if (!result.persisted) {
      toast.warning(t(`${K}.toast.saved_not_persisted`));
    } else {
      toast.success(t(`${K}.toast.saved`));
    }
  };

  const handleDeactivate = async () => {
    setConfirmDeactivate(false);
    const result = await onDeactivate();
    if (result.outcome === "failed") {
      toast.error(t(`${K}.toast.deactivate_error`), {
        description: result.error,
      });
      return;
    }
    if (result.outcome === "reconciling") {
      toast.success(t(`${K}.toast.reconciling`));
    } else if (!result.persisted) {
      toast.warning(t(`${K}.toast.deactivated_not_persisted`));
    } else {
      toast.success(t(`${K}.toast.deactivated`));
    }
  };

  const handleDiscard = () => {
    setApnValue(apn.apn);
    setPdpType(savedPdp);
    setCid(savedCid);
    setApnError("");
  };

  return (
    <Card className={CARD_SHELL}>
      <ApnCardHeader />

      <CardContent className={cn(CARD_PAD, "flex flex-col gap-4")}>
        <ApnReadout
          active={active}
          activeCid={activeCid}
          storedApn={apn.apn}
          holdVerdict={busy}
          status={status}
          statusStale={statusStale}
          statusError={statusError}
        />

        <form id={formId} onSubmit={handleSubmit} noValidate>
          {/* Declared initial AND animate: this group mounts when the read
              lands, after the page cascade has already run. */}
          <motion.div
            className={ROW_GROUP.ROOT}
            variants={staggerRows}
            initial="hidden"
            animate="visible"
          >
            <motion.div variants={staggerRowItem}>
              <SettingRow
                labelId={apnLabelId}
                label={t(`${K}.rows.apn.label`)}
                consequence={t(`${K}.rows.apn.consequence`)}
                dirty={apnDirty}
                delta={apnDelta}
                control={
                  <div className="flex w-full flex-col gap-1.5 @2xl/card:w-auto">
                    <ApnPresetField
                      presets={presets}
                      onPick={(preset) => {
                        setApnValue(preset.apn);
                        if (preset.pdpType) setPdpType(preset.pdpType);
                        if (apnError) setApnError("");
                      }}
                      inputProps={{
                        host: "container",
                        type: "text",
                        className: APN_INPUT,
                        "aria-labelledby": apnLabelId,
                        "aria-invalid": !!apnError,
                        "aria-describedby": apnError ? `${apnLabelId}-err` : undefined,
                        "aria-required": "true",
                        required: true,
                        autoCapitalize: "none",
                        autoCorrect: "off",
                        spellCheck: false,
                        autoComplete: "off",
                        placeholder: t(`${K}.edit.fields.apn.placeholder`),
                        value: apnValue,
                        onChange: (event) => {
                          setApnValue(event.target.value);
                          if (apnError) setApnError("");
                        },
                        disabled: isSaving,
                      }}
                    />
                    {apnError ? (
                      <span
                        id={`${apnLabelId}-err`}
                        role="alert"
                        className="bg-destructive-container text-on-destructive-container inline-flex w-fit items-center gap-1.5 rounded-pill px-2.5 py-1 text-[0.71875rem] font-medium"
                      >
                        <MaterialSymbol name="error" filled size={12} />
                        {apnError}
                      </span>
                    ) : null}
                  </div>
                }
              />
            </motion.div>

            {apnDirty || pdpDirty ? null : <div className={ROW_GROUP.DIVIDER} />}

            <motion.div variants={staggerRowItem}>
              <SettingRow
                labelId={pdpLabelId}
                label={t(`${K}.rows.pdp_type.label`)}
                consequence={t(`${K}.rows.pdp_type.consequence`)}
                dirty={pdpDirty}
                delta={pdpDelta}
                control={
                  <SegmentedField
                    value={pdpType}
                    onValueChange={setPdpType}
                    options={pdpOptions}
                    ariaLabel={t(`${K}.rows.pdp_type.label`)}
                    disabled={isSaving}
                    breakpoint="never"
                    glyph={renderCheckGlyph}
                  />
                }
              />
            </motion.div>

            {pdpDirty || cidDirty ? null : <div className={ROW_GROUP.DIVIDER} />}

            <motion.div variants={staggerRowItem}>
              <SettingRow
                labelId={cidLabelId}
                label={t(`${K}.rows.cid.label`)}
                consequence={t(`${K}.rows.cid.consequence`)}
                dirty={cidDirty}
                delta={cidDelta}
                control={
                  <Select
                    value={cid}
                    onValueChange={handleCidChange}
                    disabled={isSaving}
                  >
                    <SelectTrigger
                      host="container"
                      aria-labelledby={cidLabelId}
                      className={cn(SELECT_TRIGGER, "@2xl/card:min-w-44")}
                    >
                      <SelectValue
                        placeholder={t(`${K}.edit.fields.modem_profile.placeholder`)}
                      >
                        {cidLabelOf(cid)}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent className="rounded-tile">
                      {contexts.length > 0
                        ? contexts.map((ctx) => (
                            <SelectItem key={ctx.cid} value={String(ctx.cid)}>
                              <span className="flex items-center gap-2 tabular-nums">
                                {cidLabelOf(ctx.cid)}
                                <CidTag ctx={ctx} />
                              </span>
                            </SelectItem>
                          ))
                        : FALLBACK_CIDS.map((value) => (
                            <SelectItem key={value} value={String(value)}>
                              {cidLabelOf(value)}
                            </SelectItem>
                          ))}
                    </SelectContent>
                  </Select>
                }
              />
            </motion.div>
          </motion.div>
        </form>
      </CardContent>

      {/* Outside the form so `mt-auto` reaches the card edge; `form=` keeps
          Enter-to-submit. Re-read and "Use carrier default" hold the left
          edge: neither is part of the draft commit. */}
      <CardFoot
        className={CARD_PAD}
        liveStatus={false}
        status={
          <>
            <RefreshButton onClick={onRetry} disabled={busy} />
            {/* Gated on a positive state: `null` (never read) is not permission to detach. */}
            {active === 1 && !isDirty ? (
              <Button
                type="button"
                variant="tonal-neutral"
                size="action"
                onClick={() => setConfirmDeactivate(true)}
                disabled={busy}
              >
                {t(`${K}.carrier_default.button`)}
              </Button>
            ) : null}
            {isDirty ? (
              // The family's one-line apply note; the attach cycle drops data briefly.
              <span className="text-pretty">{t("core_settings.basic.save_bar.note")}</span>
            ) : null}
          </>
        }
        actions={
          <>
            <Button
              type="button"
              variant="ghost"
              size="action"
              onClick={handleDiscard}
              disabled={!isDirty || isSaving}
            >
              {t("core_settings.basic.save_bar.discard")}
            </Button>
            <SaveButton
              type="submit"
              form={formId}
              isSaving={isSaving}
              saved={saved}
              label={t(`${K}.save_apn`)}
              disabled={!isDirty}
              size="action"
            />
          </>
        }
      />

      {/* Reserved-context confirmation: a data APN on the IMS or emergency
          context can break VoLTE or SOS calling, so this path keeps asking. */}
      <AlertDialog
        open={pendingCid !== null}
        onOpenChange={(open) => !open && setPendingCid(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(`${K}.edit.cid_confirm.title`)}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingCid?.kind === "unverified"
                ? t(`${K}.edit.reserved_dialog.unverified_body`)
                : pendingCid?.kind === "ims"
                  ? t(`${K}.edit.cid_confirm.description_ims`, {
                      cid: pendingCid?.cid,
                    })
                  : t(`${K}.edit.cid_confirm.description_sos`, {
                      cid: pendingCid?.cid,
                    })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t(`${K}.edit.cid_confirm.cancel`)}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmCidChange}>
              {t(`${K}.edit.cid_confirm.confirm`)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Use carrier default confirmation */}
      <AlertDialog open={confirmDeactivate} onOpenChange={setConfirmDeactivate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(`${K}.carrier_default.dialog.title`)}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(`${K}.carrier_default.dialog.description`)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t(`${K}.carrier_default.dialog.cancel`)}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeactivate}>
              {t(`${K}.carrier_default.dialog.confirm`)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export default ApnSettingsCard;
