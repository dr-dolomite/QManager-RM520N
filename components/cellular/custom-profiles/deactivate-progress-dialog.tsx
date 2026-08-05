"use client";

import { useTranslation } from "react-i18next";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { cn } from "@/lib/utils";

import { PILL_ACTION, PILL_ACTION_PLAIN } from "./shapes";

// =============================================================================
// DeactivateProgressDialog — confirm, then STAY OPEN for the whole request
// =============================================================================
// WHY THIS EXISTS. Deactivate used to be a Radix `AlertDialogAction`, which
// closes the dialog synchronously on click. `deactivate.sh` synchronously runs
// `apn_apply_write 1 "IPV4V6" "" 1` — a blank-APN revert through the shared
// attach-cycle primitive — before it clears any profile state. Adding up
// `apn_apply.sh`'s own timing constants (sleep 3 after `AT+CGDCONT`, sleep 1
// after the `AT+COPS=2` detach, up to three `AT+COPS=0` attach retries on a 3s
// backoff, sleep 3 after the attach, then `AT+CGCONTRDP` polled at 1s with a
// 15s ceiling) the HARD FLOOR is 7s; the realistic band is 8-12s and the worst
// case is ~25-33s. So the old wiring rendered its pending state into an
// unmounted dialog and the user watched nothing happen for ten seconds.
//
// There is NO status endpoint for deactivate — it is one blocking HTTP request,
// not a spawned worker with a state file like `apply.sh`. That is the whole
// reason this is NOT a sibling ledger of `ApplyProgressDialog`: a step list here
// would be four invented rows advanced by a timer, which is precisely the
// theatre the State-Honesty Rule forbids. What we honestly know is "the request
// is in flight" and "roughly how long that takes", so that is exactly, and only,
// what this says.
//
// The terminal state is a TOAST, branched on the backend's error code, owned by
// the coordinator (`custom-profile.tsx`). This dialog closes the moment the
// request resolves — it never reports an outcome itself, so a verdict can never
// be told twice.
// =============================================================================

/**
 * The dialog's glyph disc.
 *
 * TODO(shapes): promote to shapes.ts. `apply-progress-dialog.tsx` hand-writes
 * the identical geometry inline for its own status hero, so there are now two
 * call sites and it has earned a constant — but WS1 owns that file concurrently,
 * so it is defined locally here rather than raced.
 */
const DIALOG_DISC = "grid size-14 flex-none place-items-center rounded-pill";

/**
 * `verifying` is the third phase, and it is not cosmetic.
 *
 * Measured on a live RM520N-GL: when `apn_apply_write` re-attaches the data
 * call, the stock firmware restarts dnsmasq and drops the Ethernet PHY for
 * ~4 seconds (`r8125: eth0: link down`), which destroys the browser's TCP
 * connection about 3 seconds before this endpoint writes its response. So the
 * answer to a SUCCESSFUL deactivate is routinely lost in transit, and
 * `use-sim-profiles.ts` reconciles by polling `list.sh` until the device can be
 * read again.
 *
 * That reconcile is a second wait, with a different cause, and saying nothing
 * would leave the spinner looking stuck. This phase names what is actually
 * happening — the modem's own LAN link is down — instead of inventing progress.
 */
export type DeactivatePhase = "confirm" | "working" | "verifying";

export interface DeactivateProgressDialogProps {
  open: boolean;
  /**
   * "confirm" asks; "working" reports the in-flight request; "verifying"
   * reports the reconcile that follows a response lost to the link drop.
   */
  phase: DeactivatePhase;
  /** The profile being deactivated, for the description line. */
  profileName?: string;
  /** Fires the request. The caller flips `phase` to "working". */
  onConfirm: () => void;
  /**
   * Dismissal. The dialog refuses to close on any non-confirm phase — see
   * the trap note on `ApplyProgressDialog`: the request keeps running whether
   * or not the dialog is on screen, and closing mid-flight strands the user
   * with no route back to the only feedback there is.
   */
  onOpenChange: (open: boolean) => void;
}

export function DeactivateProgressDialog({
  open,
  phase,
  profileName,
  onConfirm,
  onOpenChange,
}: DeactivateProgressDialogProps) {
  const { t } = useTranslation("cellular");
  const { t: tc } = useTranslation("common");

  // Both non-confirm phases are "a request the user cannot cancel is in
  // flight": the dialog stays locked and offers no actions in either.
  const verifying = phase === "verifying";
  const working = phase === "working" || verifying;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && working) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="overflow-hidden rounded-card sm:max-w-md"
        showCloseButton={!working}
        // Radix's `onOpenChange` guard above already refuses the close; these
        // cancel the gesture at source so an outside click mid-request does not
        // bounce focus out of the dialog on its way to being ignored.
        onInteractOutside={(e) => {
          if (working) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (working) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {verifying
              ? t("custom_profiles.deactivate_dialog.verifying_title")
              : working
                ? t("custom_profiles.deactivate_dialog.working_title")
                : t("custom_profiles.deactivate_dialog.title")}
          </DialogTitle>
          {/* Always rendered — an omitted DialogDescription leaves the Radix
              dialog without an accessible description. */}
          <DialogDescription>
            {profileName ||
              t("custom_profiles.deactivate_dialog.unknown_profile")}
          </DialogDescription>
        </DialogHeader>

        {/* --- The one focal point -----------------------------------------
            The disc PERSISTS across both phases and only its glyph changes, so
            confirming reads as the same object continuing rather than as a
            second dialog replacing the first. Both glyphs are distinct, which
            is the only channel separating them — they share a fill. */}
        <div className="flex flex-col items-center gap-3 py-1 text-center">
          <span
            className={cn(DIALOG_DISC, "bg-primary text-primary-foreground")}
          >
            {/* Each of the three phases carries a DISTINCT glyph — they share
                one fill, so the glyph is the only channel separating them.
                `verifying` deliberately does not spin: nothing is progressing
                during it, we are waiting for a link that is down, and a
                spinner would claim otherwise. */}
            <MaterialSymbol
              name={
                verifying
                  ? "cloud_off"
                  : working
                    ? "progress_activity"
                    : "power_settings_new"
              }
              filled
              size={28}
              className={cn(
                // ONE-SCALE exception, as in `ApplyProgressDialog`: a
                // continuous in-progress loop with its own ambient tempo, not a
                // transition on the 360/600/800 scale.
                working &&
                  !verifying &&
                  "animate-spin motion-reduce:animate-none",
              )}
            />
          </span>

          {/* The text block reserves a floor so swapping phase does not resize
              the dialog under the pointer. */}
          <div
            className="flex min-h-[5.5rem] flex-col justify-center gap-1.5"
            aria-live="polite"
          >
            <p className="text-base leading-tight font-semibold tracking-tight text-balance">
              {verifying
                ? t("custom_profiles.deactivate_dialog.verifying_headline")
                : working
                  ? t("custom_profiles.deactivate_dialog.working_headline")
                  : t("custom_profiles.deactivate_dialog.confirm_headline")}
            </p>
            <p className="text-on-surface-variant text-sm leading-relaxed text-pretty">
              {verifying
                ? t("custom_profiles.deactivate_dialog.verifying_sub")
                : working
                  ? t("custom_profiles.deactivate_dialog.working_sub")
                  : t("custom_profiles.deactivate_dialog.description")}
            </p>
          </div>
        </div>

        {/* --- Actions ------------------------------------------------------
            Height reserved so the row emptying out on the working phase does
            not resize the dialog. Nothing renders while the request is in
            flight: there is no honest action to offer — it cannot be cancelled,
            the modem is mid-attach-cycle, and a disabled button that says
            "Deactivating…" is a spinner the disc above is already running. */}
        <div className="flex min-h-10 items-center justify-end gap-2">
          {working ? null : (
            <>
              <Button
                variant="tonal"
                className={PILL_ACTION_PLAIN}
                onClick={() => onOpenChange(false)}
              >
                {tc("actions.cancel")}
              </Button>
              <Button className={PILL_ACTION} onClick={onConfirm}>
                <MaterialSymbol name="power_settings_new" size={16} />
                {t("custom_profiles.deactivate_dialog.confirm")}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default DeactivateProgressDialog;
