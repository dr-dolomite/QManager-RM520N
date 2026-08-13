"use client";

import * as React from "react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type {
  ApnSaveRequest,
  ApnSetting,
  CidContext,
} from "@/types/apn-settings";
import { PDP_TYPE_OPTIONS } from "@/types/apn-settings";

import SegmentedField, { type SegmentedOption } from "../segmented-field";
import SettingRow from "../setting-row";
import {
  BADGE_GLYPH_SIZE,
  CARD_PAD,
  CARD_SHELL,
  FIELD_SHELL,
  FIELD_SHELL_ON_FILL,
  PILL_ACTION,
  ROW_GROUP,
  SAVE_BAR,
  SELECT_TRIGGER,
  SELECT_TRIGGER_ON_FILL,
  SETTING_ROW,
} from "../shapes";

// =============================================================================
// APN Configuration — the write surface
// =============================================================================
// Three decisions as grouped rows rather than three labels over three fields.
// The geometry and the tone are the sibling settings surface's, imported from
// `../shapes` — this page used to hand-roll its own card, which is precisely
// how the family drifted apart in the first place.
//
// -----------------------------------------------------------------------------
// THE DATA CONTEXT ROW, AND THE HONESTY CONSTRAINT ON ITS CHIP
// -----------------------------------------------------------------------------
// The approved comp drew four CID chips (CID 1 Internet / CID 2 Internet /
// CID 3 IMS / CID 4 Emergency), which invites a reader to treat the whole set
// as verified truth. It is not: the backend's `detect_active_cid()` silently
// FALLS BACK TO "1" when both the QMAP read and the CGPADDR read fail, and it
// publishes no confidence signal alongside that guess. So exactly one chip is
// rendered, for the CID the modem reports as bearing the internet, and it is
// labelled for what is provable — "in use for Internet" — never "confirmed".
// When no active CID is reported at all the chip degrades to a muted "not
// reported" rather than defaulting to CID 1 in the UI as well.
//
// The picker itself stays a real control (the CID is a genuine setting), and
// the reserved-context confirmation dialog is preserved unchanged: writing a
// data APN onto the IMS or emergency context can break VoLTE or SOS calling,
// so that path must keep asking.
//
// -----------------------------------------------------------------------------
// WHY THE VALIDATION ERROR IS A FILLED CHIP
// -----------------------------------------------------------------------------
// A dirty row promotes to `primary-container`, so a bare `text-destructive`
// error line under the input would be one role's ink on another role's
// container — the cross-pair this surface's shapes file names as its most
// common failure. A solid `destructive-container` chip carries its own pair and
// therefore reads correctly on the neutral row AND on the promoted one.
// =============================================================================

export interface ApnSettingsCardProps {
  apn: ApnSetting | null;
  cids: CidContext[] | null;
  /** 1 = custom APN live, 0 = carrier default, null before first fetch. */
  active: number | null;
  /** The live WAN-bearing CID, or null before first fetch. */
  activeCid: number | null;
  isLoading: boolean;
  isSaving: boolean;
  onSave: (request: ApnSaveRequest) => Promise<boolean>;
  onDeactivate: () => Promise<boolean>;
}

/** CIDs offered when the modem's context list has not arrived. */
const FALLBACK_CIDS = [1, 2, 3, 4, 5, 6] as const;

/**
 * The APN input: the family's shared field shells plus the comp's 260px
 * minimum, which is what stops a long `internet.talkntext.ph` truncating on a
 * half-width card. Nothing else is added.
 *
 * THIS WAS `components/ui/input.tsx` AND A LOCAL PATCH. The patch covered only
 * the `dark:` axis, and the primitive smuggles four more things past
 * tailwind-merge on axes an unprefixed override cannot displace or does not
 * touch at all: `md:text-sm` (so this one field rendered 14px above 768px while
 * every sibling rendered 13.5px), `transition-[color,box-shadow]` with NO
 * duration (a raw Tailwind 150ms — off the scale, so it silently would not
 * retune), `shadow-xs` (a cast shadow on an input, which DESIGN.md > Inputs
 * forbids) and `placeholder:text-muted-foreground` (a legacy token surviving in
 * the rest state). A raw `<input>` on `FIELD_SHELL` removes all five at once —
 * and picks up `placeholder:font-sans` for free, without which the
 * human-authored placeholder rendered in JetBrains Mono and read as though the
 * field were already filled.
 */
const APN_INPUT = cn(FIELD_SHELL, "@2xl/card:w-[16.25rem]");

const APN_INPUT_ON_FILL = cn(FIELD_SHELL_ON_FILL, "@2xl/card:w-[16.25rem]");

export function ApnSettingsCard({
  apn,
  cids,
  active,
  activeCid,
  isLoading,
  isSaving,
  onSave,
  onDeactivate,
}: ApnSettingsCardProps) {
  const { t } = useTranslation("cellular");
  const { saved, markSaved } = useSaveFlash();
  const K = "core_settings.apn";

  // --- Draft state -----------------------------------------------------------
  // Seeded from the stored setting, and RE-seeded whenever that baseline
  // genuinely changes (a save's reconcile, a retry after an error). Keying the
  // sync on the baseline's own value rather than on a one-shot `seeded` flag is
  // what makes the second case work: the old flag latched on the first fetch,
  // so a reconcile that came back with a carrier-overridden APN left the form
  // showing the value the user asked for rather than the one that took.
  const baselineKey = apn ? JSON.stringify([apn.apn, apn.pdp_type, apn.cid]) : null;

  const [syncedKey, setSyncedKey] = React.useState<string | null>(null);
  const [apnValue, setApnValue] = React.useState("");
  const [pdpType, setPdpType] = React.useState("ipv4v6");
  const [cid, setCid] = React.useState("1");

  // Render-phase sync, not an effect: this reads PROPS, never state derived in
  // the same render, which is the case the React Compiler allows.
  if (apn && baselineKey !== syncedKey) {
    setSyncedKey(baselineKey);
    setApnValue(apn.apn);
    setPdpType(apn.pdp_type || "ipv4v6");
    setCid(String(apn.cid));
  }

  const [apnError, setApnError] = React.useState("");
  const [pendingCid, setPendingCid] = React.useState<CidContext | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = React.useState(false);

  const pdpOptions: SegmentedOption<string>[] = PDP_TYPE_OPTIONS.map(
    (option) => ({
      value: option.value,
      label: t(`${K}.edit.fields.pdp_type.options.${option.value}`),
    }),
  );

  // --- Loading ---------------------------------------------------------------
  // Geometry is MIRRORED from the shape constants. The header text is real in
  // both states, so the card never swaps its own title on load.

  if (isLoading) {
    return (
      <Card className={cn(CARD_SHELL)}>
        <CardHeader className={CARD_PAD}>
          <CardTitle>{t(`${K}.card.title`)}</CardTitle>
          <CardDescription>{t(`${K}.card.description`)}</CardDescription>
        </CardHeader>
        <CardContent className={cn(CARD_PAD, "flex flex-col gap-4")}>
          <div className={ROW_GROUP.ROOT}>
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton
                key={index}
                className={cn(SETTING_ROW.HEIGHT, "rounded-field")}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-[2.625rem] w-32 rounded-pill" />
            <Skeleton className="h-[2.625rem] w-44 rounded-pill" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const contexts = cids ?? [];

  // --- Dirty tracking --------------------------------------------------------

  const apnDirty = apn !== null && apnValue !== apn.apn;
  const pdpDirty = apn !== null && pdpType !== (apn.pdp_type || "ipv4v6");
  const cidDirty = apn !== null && cid !== String(apn.cid);
  const changeCount =
    (apnDirty ? 1 : 0) + (pdpDirty ? 1 : 0) + (cidDirty ? 1 : 0);

  const pdpLabelOf = (value: string) =>
    pdpOptions.find((option) => option.value === value)?.label ?? value;

  const apnDelta = apnDirty
    ? `${apn?.apn || "—"} → ${apnValue.trim() || "—"}`
    : null;
  const pdpDelta = pdpDirty
    ? `${pdpLabelOf(apn?.pdp_type ?? "")} → ${pdpLabelOf(pdpType)}`
    : null;
  const cidDelta = cidDirty ? `${apn?.cid} → ${cid}` : null;

  // --- CID selection — intercept reserved contexts for confirmation ----------

  const handleCidChange = (value: string) => {
    const ctx = contexts.find((context) => String(context.cid) === value);
    if (ctx && (ctx.apn_type === "ims" || ctx.apn_type === "emergency")) {
      setPendingCid(ctx);
      return;
    }
    setCid(value);
  };

  const confirmCidChange = () => {
    if (pendingCid) setCid(String(pendingCid.cid));
    setPendingCid(null);
  };

  // --- Submit ----------------------------------------------------------------

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!apnValue.trim()) {
      setApnError(t(`${K}.edit.fields.apn.error_required`));
      return;
    }
    setApnError("");

    const success = await onSave({
      apn: apnValue.trim(),
      pdp_type: pdpType,
      cid: parseInt(cid, 10),
    });

    if (success) {
      markSaved();
      toast.success(t(`${K}.toast.saved`));
    } else {
      toast.error(t(`${K}.toast.save_error`));
    }
  };

  const handleDeactivate = async () => {
    setConfirmDeactivate(false);
    const success = await onDeactivate();
    if (success) {
      toast.success(t(`${K}.toast.deactivated`));
    } else {
      toast.error(t(`${K}.toast.deactivate_error`));
    }
  };

  return (
    <Card className={cn(CARD_SHELL)}>
      <CardHeader className={CARD_PAD}>
        <CardTitle>{t(`${K}.card.title`)}</CardTitle>
        <CardDescription>{t(`${K}.card.description`)}</CardDescription>
      </CardHeader>

      <CardContent className={cn(CARD_PAD, "flex flex-col gap-4")}>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className={ROW_GROUP.ROOT}>
            <SettingRow
              labelId="apn-name-label"
              label={t(`${K}.rows.apn.label`)}
              consequence={t(`${K}.rows.apn.consequence`)}
              dirty={apnDirty}
              delta={apnDelta}
              control={
                <div className="flex w-full flex-col gap-1.5 @2xl/card:w-auto">
                  <input
                    id="apn-input"
                    type="text"
                    aria-labelledby="apn-name-label"
                    aria-invalid={!!apnError}
                    aria-describedby={apnError ? "apn-input-error" : undefined}
                    aria-required="true"
                    required
                    spellCheck={false}
                    autoComplete="off"
                    placeholder={t(`${K}.edit.fields.apn.placeholder`)}
                    value={apnValue}
                    onChange={(event) => {
                      setApnValue(event.target.value);
                      if (apnError) setApnError("");
                    }}
                    disabled={isSaving}
                    className={apnDirty ? APN_INPUT_ON_FILL : APN_INPUT}
                  />
                  {apnError ? (
                    <span
                      id="apn-input-error"
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

            {apnDirty || pdpDirty ? null : (
              <div className={ROW_GROUP.DIVIDER} />
            )}

            <SettingRow
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
                  onFill={pdpDirty}
                />
              }
            />

            {pdpDirty || cidDirty ? null : <div className={ROW_GROUP.DIVIDER} />}

            <SettingRow
              labelId="apn-cid-label"
              label={t(`${K}.rows.cid.label`)}
              consequence={t(`${K}.rows.cid.consequence`)}
              dirty={cidDirty}
              delta={cidDelta}
              control={
                <div className="flex w-full flex-wrap items-center gap-2 @2xl/card:w-auto @2xl/card:justify-end">
                  <Select
                    value={cid}
                    onValueChange={handleCidChange}
                    disabled={isSaving}
                  >
                    <SelectTrigger
                      id="apn-cid"
                      aria-labelledby="apn-cid-label"
                      className={
                        cidDirty ? SELECT_TRIGGER_ON_FILL : SELECT_TRIGGER
                      }
                    >
                      <SelectValue
                        placeholder={t(
                          `${K}.edit.fields.modem_profile.placeholder`,
                        )}
                      >
                        {t(`${K}.edit.fields.modem_profile.option_template`, {
                          cid,
                        })}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent className="rounded-tile">
                      {(contexts.length > 0
                        ? contexts.map((context) => context.cid)
                        : [...FALLBACK_CIDS]
                      ).map((value) => (
                        <SelectItem key={value} value={String(value)}>
                          {t(
                            `${K}.edit.fields.modem_profile.option_template`,
                            { cid: value },
                          )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* ONE chip, for the context the modem reports as bearing the
                      internet — not a chip per CID. See the header note on
                      `detect_active_cid()`'s silent fallback to "1". */}
                  {activeCid !== null ? (
                    <Badge variant="success">
                      <MaterialSymbol
                        name="check_circle"
                        filled
                        size={BADGE_GLYPH_SIZE}
                      />
                      {t(`${K}.cid_in_use`, { cid: activeCid })}
                    </Badge>
                  ) : (
                    <Badge variant="muted">
                      <MaterialSymbol name="help" size={BADGE_GLYPH_SIZE} />
                      {t(`${K}.cid_unknown`)}
                    </Badge>
                  )}
                </div>
              }
            />
          </div>

          <div className="flex flex-col gap-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <SaveButton
                type="submit"
                isSaving={isSaving}
                saved={saved}
                label={t(`${K}.save_apn`)}
                disabled={changeCount === 0}
                className={PILL_ACTION}
              />
              {active !== 0 ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setConfirmDeactivate(true)}
                  disabled={isSaving}
                  className={PILL_ACTION}
                >
                  {t(`${K}.carrier_default.button`)}
                </Button>
              ) : null}
            </div>
            <p className={SAVE_BAR.NOTE}>{t(`${K}.save_connection_notice`)}</p>
          </div>
        </form>
      </CardContent>

      {/* Reserved-context confirmation. Preserved verbatim in behaviour: a data
          APN written onto the IMS or emergency context can break VoLTE or SOS
          calling, so this path keeps asking. */}
      <AlertDialog
        open={pendingCid !== null}
        onOpenChange={(open) => !open && setPendingCid(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(`${K}.edit.cid_confirm.title`)}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingCid?.apn_type === "ims"
                ? t(`${K}.edit.cid_confirm.description_ims`, {
                    cid: pendingCid?.cid,
                  })
                : t(`${K}.edit.cid_confirm.description_sos`, {
                    cid: pendingCid?.cid,
                  })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t(`${K}.edit.cid_confirm.cancel`)}
            </AlertDialogCancel>
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
            <AlertDialogTitle>
              {t(`${K}.carrier_default.dialog.title`)}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(`${K}.carrier_default.dialog.description`)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t(`${K}.carrier_default.dialog.cancel`)}
            </AlertDialogCancel>
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
