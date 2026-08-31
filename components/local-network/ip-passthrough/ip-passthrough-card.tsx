"use client";

import * as React from "react";
import {
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { RotateCcwIcon } from "lucide-react";

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
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { DUR, EASE_STANDARD } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { IpPassthroughApplyData } from "@/hooks/use-ip-passthrough";
import type {
  DnsProxy,
  IpptNat,
  PassthroughMode,
  UsbMode,
} from "@/types/ip-passthrough";

import { AUTOMATIC_MAC } from "./ippt-strip";
import {
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  DELTA,
  FIELD,
  FOOTER,
  MAC_FIELD,
  PILL_ACTION,
  PROVENANCE,
  ROW,
  ROW_GROUP,
} from "./shapes";

// =============================================================================
// IPPassthroughCard — Band B of /local-network/ip-passthrough
// =============================================================================
// Five decisions in one group, under a band that reports what was last applied.
//
// -----------------------------------------------------------------------------
// THE CONSEQUENCE MOVED ONTO THE CONTROL. THE CONFIRM DIALOG STAYED.
// -----------------------------------------------------------------------------
// The riskiest sentence in this product — "the device's local gateway will no
// longer be reachable" — used to exist in exactly one place: inside the confirm
// dialog, i.e. on screen only AFTER Apply had been pressed. Someone choosing
// "Ethernet" from the mode dropdown had no way to learn, at the moment of
// choosing, that they were about to cut the route they were reading the page
// over. QManager runs ON the modem it is reconfiguring, so that is not
// hypothetical.
//
// It now appears in three places, each doing a different job:
//
//   the mode row's CONSEQUENCE   permanent, readable before the choice
//   the destructive BANNER       appears the moment the mode row goes dirty
//   the AlertDialog              unchanged in job: the deliberate act
//
// The dialog is deliberately KEPT. A reboot is a considered action and removing
// its confirm would trade one honesty problem for a worse one. What changed is
// that nothing in it is news by the time it opens.
//
// -----------------------------------------------------------------------------
// THE REBOOT HANDOFF IS LOAD-BEARING — ALL THREE LINES
// -----------------------------------------------------------------------------
// `cgi_base.sh` returns `{"success":true}` immediately and then polls, in a
// backgrounded subshell, for `/tmp/qmanager_reboot_ack` before actually
// rebooting. The `/reboot/` page writes that marker on mount. So the order in
// `handleConfirmedApply` is the contract, not decoration:
//
//   sessionStorage "qm_rebooting"  the countdown page knows why it was opened
//   clearing `qm_logged_in`        the session dies with the device, not later
//   navigating to "/reboot/"       what actually releases the backend's wait
//
// Drop any one and this page ships GREEN with a broken reboot: a dead page, a
// stale login cookie, or a reboot stalled until QM_REBOOT_ACK_TIMEOUT.
//
// -----------------------------------------------------------------------------
// DIRTY STATE RESERVES ITS LINE
// -----------------------------------------------------------------------------
// The delta chip is rendered on every row, clean or not, going `invisible` when
// clean. Promoting a row therefore moves nothing — no reflow of the group, no
// jump of the rows below. The footer's provenance slot doubles as the unsaved
// count, because when the form and the file disagree, the disagreement is the
// more useful fact.
// =============================================================================

const K = "ipPassthrough";

/** Where the values are read back from. A literal the device holds, never prose. */
const CONFIG_PATH = "/etc/qmanager/ippt_config.json";

/**
 * `NatMode` and `UsbModeLocal` are descriptive strings rather than the wire's
 * `"0"` / `"1"`, because Radix's `Select` treats a `"0"` value as absent and
 * falls back to its placeholder. The mapping to the wire happens once, on the
 * way out.
 */
type MacSource = "automatic" | "manual";
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

/**
 * The delta chip's short forms for the USB row.
 *
 * These are PROTOCOL NAMES the device round-trips — `ECM`, `RNDIS` — not prose,
 * so they are identical in all five locales and correctly live in code rather
 * than in a language pack. The dropdown's own labels ARE translated, because
 * they carry the explanatory half ("ECM (universal)").
 */
const USB_SHORT: Record<UsbModeLocal, string> = {
  rmnet: "RMNET",
  ecm: "ECM",
  mbim: "MBIM",
  rndis: "RNDIS",
};

/**
 * Literal key strings, never an interpolated `value_${mode}`. A half-assembled
 * key is not something any tool can resolve statically, and this surface's
 * translation coverage is checked by reading call sites.
 */
const MODE_VALUE_KEY: Record<PassthroughMode, string> = {
  disabled: `${K}.tiles.mode.value_disabled`,
  eth: `${K}.tiles.mode.value_eth`,
  usb: `${K}.tiles.mode.value_usb`,
};

const NAT_VALUE_KEY: Record<NatMode, string> = {
  "nat-on": `${K}.tiles.nat.value_on`,
  "nat-off": `${K}.tiles.nat.value_off`,
};

const DNS_VALUE_KEY: Record<DnsProxy, string> = {
  enabled: `${K}.tiles.dns.value_on`,
  disabled: `${K}.tiles.dns.value_off`,
};

const MODE_ID = "ippt-row-mode";
const TARGET_ID = "ippt-row-target";
const NAT_ID = "ippt-row-nat";
const USB_ID = "ippt-row-usb";
const DNS_ID = "ippt-row-dns";

const MAC_PATTERN = /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/;

interface Draft {
  mode: PassthroughMode;
  macSource: MacSource;
  macInput: string;
  nat: NatMode;
  usb: UsbModeLocal;
  dns: DnsProxy;
}

/**
 * The MAC actually sent to the backend for a given draft. Router mode sends the
 * empty string; "automatic" sends the backend's own sentinel.
 *
 * Both the dirty check and the apply go through this, so switching the source
 * to "manual" and typing back the same address is correctly NOT a change.
 */
function resolveMac(d: Draft): string {
  if (d.mode === "disabled") return "";
  return d.macSource === "automatic" ? AUTOMATIC_MAC : d.macInput;
}

/**
 * One setting row: a label line that reserves the delta chip's width, a required
 * consequence sentence, and the control.
 */
function SettingRow({
  labelId,
  label,
  delta,
  consequence,
  dimmed = false,
  children,
}: {
  labelId: string;
  label: string;
  /** `null` when the row is clean — the chip stays mounted and goes invisible. */
  delta: string | null;
  consequence: string;
  dimmed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn(ROW.ROOT, dimmed && ROW.DIMMED)}>
      <div className={ROW.TEXT}>
        <div className={ROW.LABEL_ROW}>
          <span id={labelId} className={ROW.LABEL}>
            {label}
          </span>
          <span
            className={cn(DELTA.CHIP, delta === null && DELTA.CLEAN)}
            aria-hidden={delta === null || undefined}
          >
            {delta ?? ""}
          </span>
        </div>
        <span className={ROW.CONSEQUENCE}>{consequence}</span>
      </div>
      <div className={ROW.CONTROL}>{children}</div>
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

  /**
   * THE DRAFT IS DERIVED, NOT SYNCED.
   *
   * The obvious shape — `useState<Draft>` plus a `useEffect` copying the server
   * values in — is a cascading render the compiler-backed `react-hooks` rule
   * rejects outright, and it is also wrong on its own terms: every background
   * re-read would overwrite whatever the user had typed. Holding only the EDITS
   * and laying them over the baseline removes both problems at once. A Refresh
   * now re-bases the deltas instead of erasing them, which is what the delta
   * chips are for.
   */
  const [edits, setEdits] = useState<Partial<Draft>>({});
  const [showConfirm, setShowConfirm] = useState(false);

  /**
   * The saved state, in the form's own vocabulary. Every dep is a primitive, so
   * the memo is stable and the sync effect below runs only on a real read.
   */
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

  /**
   * The two halves travel together or not at all. A single nullable object
   * narrows in one check, where two aliased booleans would leave every
   * `draft.mode` in the tree relying on control-flow analysis to hold.
   */
  const state = draft !== null && baseline !== null ? { draft, baseline } : null;

  const setField = <F extends keyof Draft>(field: F, value: Draft[F]) => {
    setEdits((prev) => ({ ...prev, [field]: value }));
  };

  // ---------------------------------------------------------------------------
  // Dirty rows
  // ---------------------------------------------------------------------------
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

  const arrow = (before: string, after: string) => `${before} → ${after}`;

  const automaticLabel = t(`${K}.card.delta_automatic`);
  const unsetLabel = t(`${K}.card.delta_unset`);

  const macLabel = (d: Draft) =>
    d.mode === "disabled" || d.macSource === "automatic"
      ? automaticLabel
      : d.macInput || unsetLabel;

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------
  const macRequired = state !== null && state.draft.mode !== "disabled";
  const macManual =
    state !== null && macRequired && state.draft.macSource === "manual";
  const macValid =
    state === null || !macManual || MAC_PATTERN.test(state.draft.macInput);

  const blockedReason =
    state === null
      ? t(`${K}.errors.card_unread`)
      : !macValid
        ? t(`${K}.errors.mac_invalid`)
        : dirtyCount === 0
          ? t(`${K}.errors.no_changes`)
          : null;

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
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

    markSaved();
    // THE DEFERRED-REBOOT CONTRACT. All three lines, in this order — see the
    // header note. The backend has already answered and is now waiting on
    // /tmp/qmanager_reboot_ack, which the /reboot/ page touches on mount.
    sessionStorage.setItem("qm_rebooting", "1");
    document.cookie = "qm_logged_in=; Path=/; Max-Age=0";
    window.location.href = "/reboot/";
  };

  // Strip non-hex, uppercase, re-insert colons every two characters. Typing is
  // therefore format-correct by construction, and the inline error only ever
  // reports an INCOMPLETE address rather than a mistyped separator.
  const handleMacChange = (event: ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value.replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
    const formatted = raw.match(/.{1,2}/g)?.join(":") ?? raw;
    setField("macInput", formatted.slice(0, 17));
  };

  const controlsHeld = isSaving || state === null;

  // The already-active banner names the device that took the WAN IP, because
  // "you are not it" is the only reason this page is still reachable.
  const activeMacLabel = state !== null ? macLabel(state.baseline) : "";

  return (
    <div className="flex flex-col gap-4">
      {/* Page-level, above the card: a condition about the SYSTEM rather than
          about one field. It leaves when the condition leaves, so it carries no
          dismiss. */}
      {state !== null && state.baseline.mode !== "disabled" ? (
        <Banner
          role="degraded"
          title={t(`${K}.banners.active.title`)}
          description={t(`${K}.banners.active.body`, { mac: activeMacLabel })}
        />
      ) : null}

      {modeDirty ? (
        // The destructive half of veto A: the moment the mode row goes dirty,
        // the page states what pressing Apply will cost. `RotateCcwIcon` rather
        // than the role's default triangle, so this banner and the warning one
        // above it never share a glyph.
        <Banner
          role="stale"
          icon={RotateCcwIcon}
          title={t(`${K}.banners.reboot.title`)}
          description={t(`${K}.banners.reboot.body`)}
        />
      ) : null}

      <Card className={CARD_SHELL}>
        <CardHeader className={CARD_PAD}>
          <CardTitle className={CARD_TITLE}>
            {t(`${K}.card.title`)}
          </CardTitle>
          <CardDescription className="text-on-surface-variant text-sm leading-relaxed text-pretty">
            {t(`${K}.card.description`)}
          </CardDescription>
        </CardHeader>

        <CardContent className={cn(CARD_PAD, "flex flex-col gap-3.5")}>
          <form className="flex flex-col gap-3.5" onSubmit={handleSubmit}>
            <div className={ROW_GROUP}>
              {state === null && (isLoading || !failed) ? (
                // Five boxes at the row's own resting height, mirrored BY
                // IMPORT rather than by a restated number.
                Array.from({ length: 5 }).map((_, index) => (
                  <Skeleton
                    key={index}
                    className={cn(ROW.HEIGHT, "rounded-field")}
                  />
                ))
              ) : state === null ? (
                // A failed read has nothing to draw. The band above already
                // reports the failure and owns the retry; this states only why
                // THIS card is empty — no glyph, no chip, no role colour.
                <div className={cn(ROW.ROOT, ROW.CONSEQUENCE)}>
                  {t(`${K}.errors.card_unread`)}
                </div>
              ) : (
                <>
                  <SettingRow
                    labelId={MODE_ID}
                    label={t(`${K}.rows.mode.label`)}
                    delta={
                      modeDirty
                        ? arrow(
                            t(MODE_VALUE_KEY[state.baseline.mode]),
                            t(MODE_VALUE_KEY[state.draft.mode]),
                          )
                        : null
                    }
                    consequence={t(`${K}.rows.mode.consequence`)}
                  >
                    <Select
                      value={state.draft.mode}
                      onValueChange={(v) =>
                        setField("mode", v as PassthroughMode)
                      }
                      disabled={controlsHeld}
                    >
                      <SelectTrigger
                        aria-labelledby={MODE_ID}
                        className={FIELD}
                      >
                        <SelectValue
                          placeholder={t(`${K}.options.placeholder`)}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="disabled">
                          {t(`${K}.options.mode_disabled`)}
                        </SelectItem>
                        <SelectItem value="eth">
                          {t(`${K}.options.mode_eth`)}
                        </SelectItem>
                        <SelectItem value="usb">
                          {t(`${K}.options.mode_usb`)}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </SettingRow>

                  <SettingRow
                    labelId={TARGET_ID}
                    label={t(`${K}.rows.target.label`)}
                    delta={
                      targetDirty
                        ? arrow(
                            macLabel(state.baseline),
                            macLabel(state.draft),
                          )
                        : null
                    }
                    consequence={
                      macRequired
                        ? t(`${K}.rows.target.consequence`)
                        : t(`${K}.rows.target.consequence_disabled`)
                    }
                    dimmed={!macRequired}
                  >
                    <Select
                      value={state.draft.macSource}
                      onValueChange={(v) =>
                        setField("macSource", v as MacSource)
                      }
                      disabled={controlsHeld || !macRequired}
                    >
                      <SelectTrigger
                        aria-labelledby={TARGET_ID}
                        className={FIELD}
                      >
                        <SelectValue
                          placeholder={t(`${K}.options.placeholder`)}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="automatic">
                          {t(`${K}.options.target_automatic`)}
                        </SelectItem>
                        <SelectItem value="manual">
                          {t(`${K}.options.target_manual`)}
                        </SelectItem>
                      </SelectContent>
                    </Select>

                    <AnimatePresence initial={false}>
                      {macManual ? (
                        <motion.div
                          key="mac-entry"
                          className="flex flex-col gap-1"
                          initial={{ opacity: 0, y: -6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -6 }}
                          transition={{
                            duration: DUR.quick,
                            ease: EASE_STANDARD,
                          }}
                        >
                          {/* A raw input, deliberately not the `Input`
                              primitive: its base string carries
                              `dark:bg-input/30` and `md:text-sm`, and `cn()`
                              cannot let an unprefixed class displace a
                              variant-prefixed one — so the fill reverts in dark
                              mode and the size reverts at a 768px VIEWPORT on a
                              container-query surface. Both were live here. */}
                          <input
                            type="text"
                            autoComplete="off"
                            spellCheck={false}
                            maxLength={17}
                            value={state.draft.macInput}
                            onChange={handleMacChange}
                            disabled={controlsHeld}
                            aria-label={t(`${K}.card.mac_label`)}
                            aria-invalid={!macValid || undefined}
                            placeholder={t(`${K}.card.mac_placeholder`)}
                            className={MAC_FIELD}
                          />
                          {!macValid ? (
                            <span className={ROW.ERROR} role="alert">
                              {t(`${K}.errors.mac_invalid`)}
                            </span>
                          ) : null}
                        </motion.div>
                      ) : null}
                    </AnimatePresence>
                  </SettingRow>

                  <SettingRow
                    labelId={NAT_ID}
                    label={t(`${K}.rows.nat.label`)}
                    delta={
                      natDirty
                        ? arrow(
                            t(NAT_VALUE_KEY[state.baseline.nat]),
                            t(NAT_VALUE_KEY[state.draft.nat]),
                          )
                        : null
                    }
                    consequence={t(`${K}.rows.nat.consequence`)}
                  >
                    <Select
                      value={state.draft.nat}
                      onValueChange={(v) => setField("nat", v as NatMode)}
                      disabled={controlsHeld}
                    >
                      <SelectTrigger aria-labelledby={NAT_ID} className={FIELD}>
                        <SelectValue
                          placeholder={t(`${K}.options.placeholder`)}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="nat-on">
                          {t(`${K}.options.nat_on`)}
                        </SelectItem>
                        <SelectItem value="nat-off">
                          {t(`${K}.options.nat_off`)}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </SettingRow>

                  <SettingRow
                    labelId={USB_ID}
                    label={t(`${K}.rows.usb.label`)}
                    delta={
                      usbDirty
                        ? arrow(
                            USB_SHORT[state.baseline.usb],
                            USB_SHORT[state.draft.usb],
                          )
                        : null
                    }
                    consequence={t(`${K}.rows.usb.consequence`)}
                  >
                    <Select
                      value={state.draft.usb}
                      onValueChange={(v) => setField("usb", v as UsbModeLocal)}
                      disabled={controlsHeld}
                    >
                      <SelectTrigger aria-labelledby={USB_ID} className={FIELD}>
                        <SelectValue
                          placeholder={t(`${K}.options.placeholder`)}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="rmnet">
                          {t(`${K}.options.usb_rmnet`)}
                        </SelectItem>
                        <SelectItem value="ecm">
                          {t(`${K}.options.usb_ecm`)}
                        </SelectItem>
                        <SelectItem value="mbim">
                          {t(`${K}.options.usb_mbim`)}
                        </SelectItem>
                        <SelectItem value="rndis">
                          {t(`${K}.options.usb_rndis`)}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </SettingRow>

                  <SettingRow
                    labelId={DNS_ID}
                    label={t(`${K}.rows.dns.label`)}
                    delta={
                      dnsDirty
                        ? arrow(
                            t(DNS_VALUE_KEY[state.baseline.dns]),
                            t(DNS_VALUE_KEY[state.draft.dns]),
                          )
                        : null
                    }
                    consequence={t(`${K}.rows.dns.consequence`)}
                  >
                    <Select
                      value={state.draft.dns}
                      onValueChange={(v) => setField("dns", v as DnsProxy)}
                      disabled={controlsHeld}
                    >
                      <SelectTrigger aria-labelledby={DNS_ID} className={FIELD}>
                        <SelectValue
                          placeholder={t(`${K}.options.placeholder`)}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="disabled">
                          {t(`${K}.options.dns_off`)}
                        </SelectItem>
                        <SelectItem value="enabled">
                          {t(`${K}.options.dns_on`)}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </SettingRow>
                </>
              )}
            </div>

            <div className={FOOTER.ROOT}>
              <div className={FOOTER.ACTIONS}>
                {/* Destructive only while the MODE row is dirty. Changing NAT or
                    the USB protocol also reboots, but it does not take the
                    gateway away — reserving the loudest affordance for the one
                    change that cuts the route in is what keeps it meaningful. */}
                <SaveButton
                  type="submit"
                  variant={modeDirty ? "destructive" : "default"}
                  isSaving={isSaving}
                  saved={saved}
                  label={t(`${K}.card.apply`)}
                  blockedReason={blockedReason}
                  className={PILL_ACTION}
                />
                {dirtyCount > 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={handleDiscard}
                    disabled={isSaving}
                    className={PILL_ACTION}
                  >
                    {t(`${K}.card.discard`)}
                  </Button>
                ) : null}
              </div>

              {/* The path is a machine string, so it takes the machine voice. It
                  sits after a colon rather than inside the sentence: a path
                  spliced mid-sentence would force every locale to keep it at the
                  English word position, which is the one thing a translator must
                  be free to move. */}
              <span className={PROVENANCE} aria-live="polite">
                {dirtyCount > 0 ? (
                  t(`${K}.card.provenance_dirty`, { count: dirtyCount })
                ) : (
                  <>
                    {t(`${K}.card.provenance`)}{" "}
                    <span className="font-mono">{CONFIG_PATH}</span>
                  </>
                )}
              </span>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Veto A: the dialog STAYS. A reboot is a deliberate act, and this is
          where it is taken — but nothing in it is news by the time it opens. */}
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
    </div>
  );
}

export default IPPassthroughCard;
