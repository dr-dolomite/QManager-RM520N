"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldError,
} from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import {
  GlobeIcon,
  PhoneCallIcon,
  SirenIcon,
  TriangleAlertIcon,
  CircleSlashIcon,
} from "lucide-react";

import type { ApnSetting, CidContext, ApnSaveRequest } from "@/types/apn-settings";
import { PDP_TYPE_OPTIONS } from "@/types/apn-settings";

// =============================================================================
// Props
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

// =============================================================================
// CID badge — one per modem context in the picker.
// Carrier (IMS/SOS) takes precedence over Internet; icons inherit text color.
// =============================================================================

function CidBadge({ ctx }: { ctx: CidContext }) {
  const { t } = useTranslation("cellular");

  if (ctx.apn_type === "ims") {
    return (
      <Badge variant="outline" className="bg-warning/15 text-warning border-warning/30">
        <PhoneCallIcon className="text-warning size-3" />
        {t("core_settings.apn.edit.fields.modem_profile.ims_badge")}
      </Badge>
    );
  }
  if (ctx.apn_type === "emergency") {
    return (
      <Badge variant="outline" className="bg-destructive/15 text-destructive border-destructive/30">
        <SirenIcon className="text-destructive size-3" />
        {t("core_settings.apn.edit.fields.modem_profile.sos_badge")}
      </Badge>
    );
  }
  if (ctx.is_internet) {
    return (
      <Badge variant="outline" className="bg-success/15 text-success border-success/30">
        <GlobeIcon className="text-success size-3" />
        {t("core_settings.apn.edit.fields.modem_profile.for_internet")}
      </Badge>
    );
  }
  return null;
}

// =============================================================================
// Live-status badge — reflects honest APN/active truth.
// =============================================================================

function LiveStatusBadge({
  active,
  activeCid,
  storedApn,
  cids,
  isSaving,
}: {
  active: number | null;
  activeCid: number | null;
  storedApn: string;
  cids: CidContext[] | null;
  isSaving: boolean;
}) {
  const { t } = useTranslation("cellular");

  if (active === null || cids === null) return null;

  if (active === 0) {
    return (
      <div className="flex items-center gap-2">
        <Badge
          variant="outline"
          className="bg-muted/50 text-muted-foreground border-muted-foreground/30"
        >
          <CircleSlashIcon className="size-3" />
          {t("core_settings.apn.status.carrier_default")}
        </Badge>
      </div>
    );
  }

  // active === 1 — check if stored APN matches live CID's APN
  const liveCtx = activeCid !== null ? cids.find((c) => c.cid === activeCid) : null;
  // An empty live APN ("") is the backend's "couldn't read it" sentinel, not a
  // confirmed value — the compound AT read fails transiently (notably during the
  // COPS settle window right after a save). Collapse "" to null with `||` (NOT
  // `??`, which preserves "") so an unknown live APN falls through to "Active"
  // instead of a false "Not live". A genuinely different non-empty APN (a real
  // carrier override) still produces a mismatch.
  const liveApn = liveCtx?.apn || null;

  const isMatch =
    liveApn !== null &&
    storedApn.trim().toLowerCase() === liveApn.trim().toLowerCase();

  // Suppress "Not live" badge while saving to avoid flicker during COPS cycle
  if (!isSaving && liveApn !== null && !isMatch) {
    return (
      <div className="flex flex-col gap-1">
        <Badge
          variant="outline"
          className="bg-warning/15 text-warning border-warning/30 w-fit"
        >
          <TriangleAlertIcon className="size-3" />
          {t("core_settings.apn.status.not_live")}
        </Badge>
        <p className="text-xs text-muted-foreground">
          {liveApn
            ? t("core_settings.apn.status.network_using", { apn: liveApn })
            : t("core_settings.apn.list.live.mismatch_default")}
        </p>
      </div>
    );
  }

  return (
    <Badge
      variant="outline"
      className="bg-success/15 text-success border-success/30"
    >
      <GlobeIcon className="size-3" />
      {t("core_settings.apn.status.active")}
    </Badge>
  );
}

// =============================================================================
// Loading Skeleton
// =============================================================================

function ApnSettingsCardSkeleton() {
  const { t } = useTranslation("cellular");
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{t("core_settings.apn.card.title")}</CardTitle>
        <CardDescription>{t("core_settings.apn.card.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4">
          <Skeleton className="h-6 w-24 rounded-full" />
          <div className="grid @md/card:grid-cols-2 grid-cols-1 gap-4">
            <div className="space-y-2">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-9 w-full" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-9 w-full" />
            </div>
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-9 w-full" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-9 w-28" />
            <Skeleton className="h-9 w-36" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Component
// =============================================================================

export default function ApnSettingsCard({
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

  // --- Form state (seeded from `apn`; reset when hook data arrives) ---
  const [apnValue, setApnValue] = useState(apn?.apn ?? "");
  const [pdpType, setPdpType] = useState(apn?.pdp_type ?? "ipv4v6");
  const [cid, setCid] = useState(String(apn?.cid ?? 1));

  // Sync form when hook data arrives after initial skeleton
  // Safe: React Compiler only disallows setState-in-effect when reading
  // derived state from the SAME render; this reads hook props.
  const [seeded, setSeeded] = useState(false);
  if (!seeded && apn !== null) {
    setSeeded(true);
    setApnValue(apn.apn);
    setPdpType(apn.pdp_type || "ipv4v6");
    setCid(String(apn.cid));
  }

  // --- UI state ---
  const [apnError, setApnError] = useState("");
  const [pendingCid, setPendingCid] = useState<CidContext | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  const contexts = cids ?? [];

  if (isLoading) return <ApnSettingsCardSkeleton />;

  // --- CID selection — intercept carrier contexts for confirmation ---
  const handleCidChange = (value: string) => {
    const ctx = contexts.find((c) => String(c.cid) === value);
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

  // --- Validation ---
  const validateForm = (): boolean => {
    if (!apnValue.trim()) {
      setApnError(t("core_settings.apn.edit.fields.apn.error_required"));
      return false;
    }
    setApnError("");
    return true;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    const request: ApnSaveRequest = {
      apn: apnValue.trim(),
      pdp_type: pdpType,
      cid: parseInt(cid, 10),
    };

    const success = await onSave(request);
    if (success) {
      markSaved();
      toast.success(t("core_settings.apn.toast.saved"));
    } else {
      toast.error(t("core_settings.apn.toast.save_error"));
    }
  };

  const handleDeactivate = async () => {
    setConfirmDeactivate(false);
    const success = await onDeactivate();
    if (success) {
      toast.success(t("core_settings.apn.toast.deactivated"));
    } else {
      toast.error(t("core_settings.apn.toast.deactivate_error"));
    }
  };

  const pendingType = pendingCid?.apn_type;

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{t("core_settings.apn.card.title")}</CardTitle>
        <CardDescription>{t("core_settings.apn.card.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={handleSubmit}>
          {/* Live-status badge row */}
          <LiveStatusBadge
            active={active}
            activeCid={activeCid}
            storedApn={apnValue}
            cids={cids}
            isSaving={isSaving}
          />

          <FieldSet>
            <FieldGroup>
              {/* APN field */}
              <Field data-invalid={apnError ? true : undefined}>
                <FieldLabel htmlFor="apn-input">
                  {t("core_settings.apn.edit.fields.apn.label")}
                </FieldLabel>
                <Input
                  id="apn-input"
                  placeholder={t("core_settings.apn.edit.fields.apn.placeholder")}
                  value={apnValue}
                  onChange={(e) => {
                    setApnValue(e.target.value);
                    if (apnError) setApnError("");
                  }}
                  disabled={isSaving}
                  required
                  aria-required="true"
                  aria-invalid={!!apnError}
                />
                {apnError && <FieldError>{apnError}</FieldError>}
              </Field>

              {/* PDP Type + CID row */}
              <div className="grid @md/card:grid-cols-2 grid-cols-1 gap-4">
                <Field>
                  <FieldLabel htmlFor="apn-pdp-type">
                    {t("core_settings.apn.edit.fields.pdp_type.label")}
                  </FieldLabel>
                  <Select value={pdpType} onValueChange={setPdpType} disabled={isSaving}>
                    <SelectTrigger
                      id="apn-pdp-type"
                      aria-label={t("core_settings.apn.edit.fields.pdp_type.aria")}
                    >
                      <SelectValue
                        placeholder={t("core_settings.apn.edit.fields.pdp_type.placeholder")}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {PDP_TYPE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {t(
                            `core_settings.apn.edit.fields.pdp_type.options.${opt.value}`
                          )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <Field>
                  <FieldLabel htmlFor="apn-cid">
                    {t("core_settings.apn.edit.fields.modem_profile.label")}
                  </FieldLabel>
                  <Select value={cid} onValueChange={handleCidChange} disabled={isSaving}>
                    <SelectTrigger
                      id="apn-cid"
                      aria-label={t("core_settings.apn.edit.fields.modem_profile.aria")}
                    >
                      <SelectValue
                        placeholder={t(
                          "core_settings.apn.edit.fields.modem_profile.placeholder"
                        )}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {contexts.length > 0 ? (
                        contexts.map((ctx) => (
                          <SelectItem key={ctx.cid} value={String(ctx.cid)}>
                            <span className="flex items-center gap-2">
                              {t(
                                "core_settings.apn.edit.fields.modem_profile.option_template",
                                { cid: ctx.cid }
                              )}
                              <CidBadge ctx={ctx} />
                            </span>
                          </SelectItem>
                        ))
                      ) : (
                        // Fallback when cids[] hasn't loaded yet — offer CID 1–6
                        [1, 2, 3, 4, 5, 6].map((n) => (
                          <SelectItem key={n} value={String(n)}>
                            {t(
                              "core_settings.apn.edit.fields.modem_profile.option_template",
                              { cid: n }
                            )}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            </FieldGroup>
          </FieldSet>

          {/* Actions */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <SaveButton
                type="submit"
                isSaving={isSaving}
                saved={saved}
                label={t("core_settings.apn.edit.save_button")}
              />
              {active !== 0 && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setConfirmDeactivate(true)}
                  disabled={isSaving}
                >
                  {t("core_settings.apn.carrier_default.button")}
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("core_settings.apn.save_connection_notice")}
            </p>
          </div>
        </form>
      </CardContent>

      {/* Carrier-CID confirmation */}
      <AlertDialog
        open={pendingCid !== null}
        onOpenChange={(o) => !o && setPendingCid(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("core_settings.apn.edit.cid_confirm.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingType === "ims"
                ? t("core_settings.apn.edit.cid_confirm.description_ims", {
                    cid: pendingCid?.cid,
                  })
                : t("core_settings.apn.edit.cid_confirm.description_sos", {
                    cid: pendingCid?.cid,
                  })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("core_settings.apn.edit.cid_confirm.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmCidChange}
            >
              {t("core_settings.apn.edit.cid_confirm.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Use carrier default confirmation */}
      <AlertDialog open={confirmDeactivate} onOpenChange={setConfirmDeactivate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("core_settings.apn.carrier_default.dialog.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("core_settings.apn.carrier_default.dialog.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("core_settings.apn.carrier_default.dialog.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleDeactivate}>
              {t("core_settings.apn.carrier_default.dialog.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
