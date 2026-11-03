"use client";

import * as React from "react";
import {
  useId,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { RefreshCcwIcon, RotateCcwIcon, TriangleAlertIcon } from "lucide-react";

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
import { HintIcon } from "@/components/ui/hint-icon";
import { fieldVariants } from "@/components/ui/input";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import {
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
import { useMotionReduced } from "@/components/motion-preference";
import {
  useLanDevices,
  type UseLanDevicesReturn,
} from "@/hooks/use-lan-devices";
import { DUR, EASE_STANDARD } from "@/lib/motion";
import { enterRebootFlow } from "@/lib/reboot";
import { cn } from "@/lib/utils";
import type { IpPassthroughApplyData } from "@/hooks/use-ip-passthrough";
import type {
  DnsProxy,
  IpptNat,
  PassthroughMode,
  UsbMode,
} from "@/types/ip-passthrough";

import {
  AUTOMATIC_MAC,
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  DEVICE_PICK,
  FOOT,
  MAC_FIELD,
  MODE_NOTE,
  SETTING,
  SKELETON,
} from "./shapes";
import { USB_SHORT } from "./status-strip";

// Applying writes every setting and reboots the modem; the AlertDialog stays in front of it.
// The reboot hand-off order is a contract: docs/reference/ip-passthrough.md.

const K = "ipPassthrough";

/** "device" writes the picked MAC into `macInput`, so it validates and applies like a typed one. */
type MacSource = "automatic" | "device" | "manual";
/** Descriptive local values: Radix's Select treats a bare `"0"` as unset. */
type NatMode = "nat-on" | "nat-off";
type UsbModeLocal = "rmnet" | "ecm" | "mbim" | "rndis";

const USB_TO_API: Record<UsbModeLocal, UsbMode> = {
  rmnet: "0",
  ecm: "1",
  mbim: "2",
  rndis: "3",
};

const USB_FROM_API: Record<string, UsbModeLocal> = {
  "0": "rmnet",
  "1": "ecm",
  "2": "mbim",
  "3": "rndis",
};

const USB_ORDER: readonly UsbModeLocal[] = ["rmnet", "ecm", "mbim", "rndis"];

const MAC_PATTERN = /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/;

/** The fill marks the pick; no check glyph on this surface. */
const NO_GLYPH = () => null;

interface Draft {
  mode: PassthroughMode;
  macSource: MacSource;
  macInput: string;
  nat: NatMode;
  usb: UsbModeLocal;
  dns: DnsProxy;
}

/** The MAC actually sent; both the dirty check and the apply go through it. */
function resolveMac(d: Draft): string {
  if (d.mode === "disabled") return "";
  return d.macSource === "automatic" ? AUTOMATIC_MAC : d.macInput;
}

function SettingRow({
  label,
  dirty,
  hint,
  sub,
  held = false,
  wide = false,
  children,
}: {
  label: string;
  dirty: boolean;
  hint?: React.ReactNode;
  sub?: string;
  held?: boolean;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={SETTING.ROW}>
      <div className={cn(SETTING.KEY, held && SETTING.HELD)}>
        <span className={SETTING.KEY_LINE}>
          {label}
          {hint}
          <span
            aria-hidden
            className={cn(SETTING.DOT, dirty ? SETTING.DOT_ON : SETTING.DOT_OFF)}
          />
        </span>
        {sub ? <span className={SETTING.KEY_SUB}>{sub}</span> : null}
      </div>
      <div className={wide ? SETTING.CONTROL_WIDE : SETTING.CONTROL}>
        {children}
      </div>
    </div>
  );
}

function SettingsSkeleton() {
  const row = (pill: string, i: number) => (
    <div key={i} className={SETTING.ROW}>
      <Skeleton className={SKELETON.ROW_KEY} />
      <Skeleton className={cn(SKELETON.PILL, "ml-auto", pill)} />
    </div>
  );
  return (
    <div className={SETTING.BODY} aria-hidden>
      <div className={SETTING.GROUP}>
        <Skeleton className={SKELETON.EYEBROW} />
        {row("w-60", 0)}
        <div className="flex flex-col gap-1">
          <Skeleton className={cn(SKELETON.NOTE_LINE, "w-full")} />
          <Skeleton className={cn(SKELETON.NOTE_LINE, "w-3/4")} />
          <Skeleton className={cn(SKELETON.NOTE_LINE, "w-1/2 @2xl/card:hidden")} />
        </div>
        {row("w-48", 1)}
      </div>
      <div className={SETTING.GROUP}>
        <Skeleton className={SKELETON.EYEBROW} />
        {["w-52", "w-72", "w-28"].map(row)}
      </div>
    </div>
  );
}

/** The live connected-device list behind "From LAN". */
function DevicePicker({
  value,
  lan,
  onPick,
  onManual,
  disabled,
}: {
  value: string;
  lan: UseLanDevicesReturn;
  onPick: (mac: string) => void;
  onManual: () => void;
  disabled: boolean;
}) {
  const { t } = useTranslation("common");
  const { devices, isLoading, error, refresh } = lan;
  const selected = devices.find((d) => d.mac.toUpperCase() === value);

  if (isLoading) {
    return (
      <div className={DEVICE_PICK.WRAP}>
        <p role="status" className={DEVICE_PICK.NOTE}>
          <RefreshCcwIcon
            className={cn(DEVICE_PICK.GLYPH, "motion-safe:animate-spin")}
            aria-hidden
          />
          {t(`${K}.device.scanning`)}
        </p>
      </div>
    );
  }

  if (error !== null || devices.length === 0) {
    return (
      <div className={DEVICE_PICK.WRAP}>
        <p
          role={error !== null ? "alert" : "status"}
          className={cn(DEVICE_PICK.NOTE, error !== null && DEVICE_PICK.NOTE_ERROR)}
        >
          {error !== null ? t(`${K}.device.error`) : t(`${K}.device.empty`)}
        </p>
        <div className={DEVICE_PICK.LINKS}>
          <Button
            type="button"
            variant="link"
            size="sm"
            onClick={refresh}
            disabled={disabled}
            className={DEVICE_PICK.LINK}
          >
            <RefreshCcwIcon className={DEVICE_PICK.GLYPH} aria-hidden />
            {error !== null ? t(`${K}.device.retry`) : t(`${K}.device.rescan`)}
          </Button>
          <Button
            type="button"
            variant="link"
            size="sm"
            onClick={onManual}
            disabled={disabled}
            className={DEVICE_PICK.LINK}
          >
            {t(`${K}.device.enter_manually`)}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={DEVICE_PICK.WRAP}>
      <div className={DEVICE_PICK.LINE}>
        <Select
          value={selected?.mac ?? ""}
          onValueChange={(v) => onPick(v.toUpperCase())}
          disabled={disabled}
        >
          <SelectTrigger
            aria-label={t(`${K}.device.label`)}
            className={DEVICE_PICK.TRIGGER}
          >
            <SelectValue placeholder={t(`${K}.device.placeholder`)} />
          </SelectTrigger>
          <SelectContent>
            {devices.map((d) => (
              <SelectItem key={d.mac} value={d.mac}>
                <span className={DEVICE_PICK.ITEM}>
                  <span className={DEVICE_PICK.ITEM_NAME}>
                    {d.hostname || d.ip || t(`${K}.device.unknown`)}
                  </span>
                  <span className={DEVICE_PICK.ITEM_MAC}>{d.mac.toUpperCase()}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="tonal-neutral"
          size="icon"
          onClick={refresh}
          disabled={disabled}
          aria-label={t(`${K}.device.rescan_label`)}
          className={DEVICE_PICK.RESCAN}
        >
          <RefreshCcwIcon aria-hidden />
        </Button>
      </div>
    </div>
  );
}

export interface IpPassthroughCardProps {
  /** `null` until the first successful read. */
  passthroughMode: PassthroughMode | null;
  targetMac: string | null;
  ipptNat: IpptNat | null;
  usbMode: UsbMode | null;
  dnsProxy: DnsProxy | null;
  isLoading: boolean;
  isSaving: boolean;
  /** True when a read failed and left nothing behind. */
  failed: boolean;
  saveSettings: (data: IpPassthroughApplyData) => Promise<boolean>;
}

export function IPPassthroughCard({
  passthroughMode,
  targetMac,
  ipptNat,
  usbMode,
  dnsProxy,
  isLoading,
  isSaving,
  failed,
  saveSettings,
}: IpPassthroughCardProps) {
  const { t } = useTranslation("common");
  const { saved, markSaved } = useSaveFlash();
  const reduced = useMotionReduced();
  const formId = useId();

  // Edits laid over the saved baseline: a re-read re-bases them instead of erasing them.
  const [edits, setEdits] = useState<Partial<Draft>>({});
  const [showConfirm, setShowConfirm] = useState(false);

  const baseline = useMemo<Draft | null>(() => {
    if (
      passthroughMode === null ||
      ipptNat === null ||
      usbMode === null ||
      dnsProxy === null
    ) {
      return null;
    }
    const mac = (targetMac ?? "").toUpperCase();
    const automatic = mac === "" || mac === AUTOMATIC_MAC;
    return {
      mode: passthroughMode,
      macSource: automatic ? "automatic" : "manual",
      macInput: automatic ? "" : mac,
      nat: ipptNat === "1" ? "nat-on" : "nat-off",
      usb: USB_FROM_API[usbMode] ?? "ecm",
      dns: dnsProxy,
    };
  }, [passthroughMode, targetMac, ipptNat, usbMode, dnsProxy]);

  const draft = useMemo<Draft | null>(
    () => (baseline === null ? null : { ...baseline, ...edits }),
    [baseline, edits],
  );

  const state = draft !== null && baseline !== null ? { draft, baseline } : null;

  const setField = <F extends keyof Draft>(field: F, value: Draft[F]) => {
    setEdits((prev) => ({ ...prev, [field]: value }));
  };

  // Idle until the user picks "From LAN"; every switch to it rescans.
  const lan = useLanDevices(false);
  const handleSourceChange = (v: MacSource) => {
    setField("macSource", v);
    if (v === "device") lan.refresh();
  };

  const modeDirty = state !== null && state.draft.mode !== state.baseline.mode;
  const targetDirty =
    state !== null && resolveMac(state.draft) !== resolveMac(state.baseline);
  const natDirty = state !== null && state.draft.nat !== state.baseline.nat;
  const usbDirty = state !== null && state.draft.usb !== state.baseline.usb;
  const dnsDirty = state !== null && state.draft.dns !== state.baseline.dns;

  const dirtyCount = [
    modeDirty,
    targetDirty,
    natDirty,
    usbDirty,
    dnsDirty,
  ].filter(Boolean).length;

  const macRequired = state !== null && state.draft.mode !== "disabled";
  const macSource = state?.draft.macSource ?? "automatic";
  const macManual = macRequired && macSource === "manual";
  const macPicking = macRequired && macSource === "device";
  // A device pick and a typed MAC both land in `macInput`; both must be whole.
  // From LAN applies only a MAC the latest successful scan lists, so a hidden MAC never ships.
  const macListed =
    !lan.isLoading &&
    lan.error === null &&
    lan.devices.some((d) => d.mac.toUpperCase() === state?.draft.macInput);
  const macValid =
    state === null ||
    !macRequired ||
    macSource === "automatic" ||
    (macPicking ? macListed : MAC_PATTERN.test(state.draft.macInput));

  const blockedReason =
    state === null
      ? t(`${K}.errors.card_unread`)
      : !macValid
        ? macPicking
          ? t(`${K}.errors.device_unpicked`)
          : t(`${K}.errors.mac_invalid`)
        : dirtyCount === 0
          ? t(`${K}.errors.no_changes`)
          : null;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (state === null || !macValid || dirtyCount === 0) return;
    setShowConfirm(true);
  };

  const handleDiscard = () => {
    setEdits({});
  };

  const handleConfirmedApply = async () => {
    setShowConfirm(false);
    if (draft === null) return;

    const ok = await saveSettings({
      passthrough_mode: draft.mode,
      target_mac: resolveMac(draft),
      ippt_nat: draft.nat === "nat-on" ? "1" : "0",
      usb_mode: USB_TO_API[draft.usb],
      dns_proxy: draft.dns,
    });

    if (!ok) {
      toast.error(t(`${K}.toast_apply_error`));
      return;
    }

    // The CGI reboots once /reboot/ acks; the hand-off is the success signal.
    markSaved();
    enterRebootFlow("ip_passthrough");
  };

  // Strip non-hex, uppercase, re-insert colons: typing is format-correct by construction.
  const handleMacChange = (event: ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value.replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
    const formatted = raw.match(/.{1,2}/g)?.join(":") ?? raw;
    setField("macInput", formatted.slice(0, 17));
  };

  const held = isSaving || state === null;

  const modeOptions: readonly SegmentedOption<PassthroughMode>[] = [
    { value: "disabled", label: t(`${K}.options.mode_disabled`) },
    { value: "eth", label: t(`${K}.options.mode_eth`) },
    { value: "usb", label: t(`${K}.options.mode_usb`) },
  ];
  const targetOptions: readonly SegmentedOption<MacSource>[] = [
    { value: "automatic", label: t(`${K}.options.target_automatic`) },
    { value: "device", label: t(`${K}.options.target_device`) },
    { value: "manual", label: t(`${K}.options.target_manual`) },
  ];
  const natOptions: readonly SegmentedOption<NatMode>[] = [
    { value: "nat-on", label: t(`${K}.options.nat_on`) },
    { value: "nat-off", label: t(`${K}.options.nat_off`) },
  ];
  const usbOptions: readonly SegmentedOption<UsbModeLocal>[] = USB_ORDER.map(
    (v) => ({ value: v, label: USB_SHORT[USB_TO_API[v]] }),
  );
  const dnsOptions: readonly SegmentedOption<DnsProxy>[] = [
    { value: "disabled", label: t(`${K}.options.dns_off`) },
    { value: "enabled", label: t(`${K}.options.dns_on`) },
  ];

  const revealMotion = {
    initial: { opacity: 0, y: reduced ? 0 : -6 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: DUR.quick, ease: EASE_STANDARD },
  } as const;

  return (
    <>
      <Card className={CARD_SHELL}>
        <CardHeader className={CARD_PAD}>
          <CardTitle className={CARD_TITLE}>{t(`${K}.card.title`)}</CardTitle>
          <CardDescription className={CARD_DESC}>
            {t(`${K}.card.description`)}
          </CardDescription>
        </CardHeader>

        <CardContent className={CARD_PAD}>
          {state === null ? (
            isLoading || !failed ? (
              <SettingsSkeleton />
            ) : (
              <p className={SETTING.UNREAD}>{t(`${K}.errors.card_unread`)}</p>
            )
          ) : (
            <form id={formId} className={SETTING.BODY} onSubmit={handleSubmit}>
              <div className={SETTING.GROUP}>
                <p className={SETTING.LABEL}>{t(`${K}.groups.passthrough`)}</p>

                <SettingRow label={t(`${K}.rows.mode.label`)} dirty={modeDirty}>
                  <SegmentedField
                    value={state.draft.mode}
                    onValueChange={(v) => setField("mode", v)}
                    options={modeOptions}
                    ariaLabel={t(`${K}.rows.mode.label`)}
                    disabled={held}
                    breakpoint="never"
                    glyph={NO_GLYPH}
                  />
                </SettingRow>

                <div
                  role="status"
                  className={cn(
                    MODE_NOTE.ROOT,
                    modeDirty ? MODE_NOTE.DIRTY : MODE_NOTE.REST,
                  )}
                >
                  {modeDirty ? (
                    <RotateCcwIcon className={MODE_NOTE.GLYPH} aria-hidden />
                  ) : (
                    <TriangleAlertIcon
                      className={cn(MODE_NOTE.GLYPH, MODE_NOTE.GLYPH_REST)}
                      aria-hidden
                    />
                  )}
                  <span>
                    {!modeDirty
                      ? t(`${K}.mode_note.rest`)
                      : state.draft.mode === "disabled"
                        ? t(`${K}.mode_note.to_router`)
                        : t(`${K}.mode_note.to_passthrough`)}
                  </span>
                </div>

                <SettingRow
                  label={t(`${K}.rows.target.label`)}
                  dirty={targetDirty}
                  sub={macRequired ? undefined : t(`${K}.rows.target.pick_mode`)}
                  held={!macRequired}
                  wide
                >
                  <SegmentedField
                    value={state.draft.macSource}
                    onValueChange={handleSourceChange}
                    options={targetOptions}
                    ariaLabel={t(`${K}.rows.target.label`)}
                    disabled={held || !macRequired}
                    breakpoint="lg"
                    glyph={NO_GLYPH}
                  />
                  {/* Swapped slots get an entrance only; a swapped-out control is simply gone. */}
                  {macPicking ? (
                    <motion.div
                      key="mac-device"
                      className={DEVICE_PICK.SLOT}
                      {...revealMotion}
                    >
                      <DevicePicker
                        value={state.draft.macInput}
                        lan={lan}
                        onPick={(mac) => setField("macInput", mac)}
                        onManual={() => setField("macSource", "manual")}
                        disabled={held}
                      />
                    </motion.div>
                  ) : macManual ? (
                    <motion.div
                      key="mac-entry"
                      className={MAC_FIELD.WRAP}
                      {...revealMotion}
                    >
                      <input
                        type="text"
                        autoComplete="off"
                        spellCheck={false}
                        maxLength={17}
                        value={state.draft.macInput}
                        onChange={handleMacChange}
                        disabled={held}
                        aria-label={t(`${K}.card.mac_label`)}
                        aria-invalid={!macValid || undefined}
                        placeholder={t(`${K}.card.mac_placeholder`)}
                        className={cn(fieldVariants(), MAC_FIELD.INPUT)}
                      />
                      {!macValid ? (
                        <span className={MAC_FIELD.ERROR} role="alert">
                          {t(`${K}.errors.mac_invalid`)}
                        </span>
                      ) : null}
                    </motion.div>
                  ) : null}
                </SettingRow>
              </div>

              <div className={SETTING.GROUP}>
                <p className={SETTING.LABEL}>{t(`${K}.groups.network`)}</p>

                <SettingRow
                  label={t(`${K}.rows.nat.label`)}
                  dirty={natDirty}
                  hint={
                    <HintIcon label={t(`${K}.rows.nat.hint_label`)}>
                      {t(`${K}.rows.nat.hint`)}
                    </HintIcon>
                  }
                >
                  <SegmentedField
                    value={state.draft.nat}
                    onValueChange={(v) => setField("nat", v)}
                    options={natOptions}
                    ariaLabel={t(`${K}.rows.nat.label`)}
                    disabled={held}
                    breakpoint="never"
                    glyph={NO_GLYPH}
                  />
                </SettingRow>

                <SettingRow label={t(`${K}.rows.usb.label`)} dirty={usbDirty} wide>
                  <SegmentedField
                    value={state.draft.usb}
                    onValueChange={(v) => setField("usb", v)}
                    options={usbOptions}
                    ariaLabel={t(`${K}.rows.usb.label`)}
                    disabled={held}
                    breakpoint="lg"
                    glyph={NO_GLYPH}
                  />
                </SettingRow>

                <SettingRow
                  label={t(`${K}.rows.dns.label`)}
                  dirty={dnsDirty}
                  hint={
                    <HintIcon label={t(`${K}.rows.dns.hint_label`)}>
                      {t(`${K}.rows.dns.hint`)}
                    </HintIcon>
                  }
                >
                  <SegmentedField
                    value={state.draft.dns}
                    onValueChange={(v) => setField("dns", v)}
                    options={dnsOptions}
                    ariaLabel={t(`${K}.rows.dns.label`)}
                    disabled={held}
                    breakpoint="never"
                    glyph={NO_GLYPH}
                  />
                </SettingRow>
              </div>
            </form>
          )}
        </CardContent>

        {/* Outside the form so `mt-auto` reaches the card edge; `form=` keeps Enter-to-submit. */}
        <CardFoot
          className={CARD_PAD}
          status={
            dirtyCount > 0 ? (
              <span className={FOOT.LINE}>
                <span className={FOOT.DOT} aria-hidden />
                {t(`${K}.card.unsaved`, { count: dirtyCount })}
              </span>
            ) : undefined
          }
          actions={
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={handleDiscard}
                disabled={isSaving || dirtyCount === 0}
                size="action"
              >
                {t(`${K}.card.discard`)}
              </Button>
              <SaveButton
                type="submit"
                form={formId}
                variant={modeDirty ? "destructive" : "default"}
                isSaving={isSaving}
                saved={saved}
                label={t(`${K}.card.apply`)}
                blockedReason={blockedReason}
                size="action"
              />
            </>
          }
        />
      </Card>

      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(`${K}.dialog.title`)}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-3 text-sm">
                <p>{t(`${K}.dialog.body`)}</p>
                {state !== null && state.draft.mode !== "disabled" ? (
                  <p className="text-on-surface font-medium">
                    {t(`${K}.dialog.body_gateway`)}
                  </p>
                ) : null}
                <p>{t(`${K}.dialog.body_persist`)}</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t(`${K}.dialog.cancel`)}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmedApply}>
              {t(`${K}.dialog.confirm`)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default IPPassthroughCard;
