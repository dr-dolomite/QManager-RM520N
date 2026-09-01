"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { motion } from "motion/react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangleIcon, RotateCcwIcon } from "lucide-react";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";

import {
  usePingProfile,
  type PingProfileTargets,
} from "@/hooks/use-ping-profile";
import { useModemStatus } from "@/hooks/use-modem-status";
import { staggerContainer, staggerItem } from "@/lib/motion";

// ─── Constants ──────────────────────────────────────────────────────────────

// The seeded chain, in probe order. Mirrors scripts/etc/qmanager/ping_profile.json
// and the CGI's own fallbacks, so "Reset to defaults" lands the device exactly
// where a fresh install would.
const DEFAULT_TARGETS: PingProfileTargets = {
  target_host_1: "cloudflare.com",
  target_host_2: "google.com",
  target_ip_1: "1.1.1.1",
  target_ip_2: "8.8.8.8",
};

type SlotKey = keyof PingProfileTargets;

const SLOT_ORDER: SlotKey[] = [
  "target_host_1",
  "target_host_2",
  "target_ip_1",
  "target_ip_2",
];

type SlotErrors = Partial<Record<SlotKey, string | null>>;

// ─── Validation — mirrors validate_target() in the CGI ──────────────────────
//
// The backend re-validates every save regardless; this exists so the user sees
// the same verdict inline that the CGI would have returned. A client that is
// laxer than the server produces a rejection naming a slot the user cannot
// see, so the two charsets below are kept deliberately identical to the shell's.

// Common rules for both families: trimmed, non-empty, length-bounded, no
// interior whitespace, no shell/HTML metacharacters.
function checkCommonRules(trimmed: string): string | null {
  if (!trimmed) return "Address cannot be empty";
  if (trimmed.length > 128) return "Address too long (max 128 characters)";
  if (/\s/.test(trimmed)) return "Address cannot contain spaces";
  if (/[`$();|<>"\\]/.test(trimmed))
    return "Address contains disallowed characters";
  return null;
}

// family `host` — charset is letters, digits, dot and hyphen, plus label
// sanity: no leading or trailing dot or hyphen, no hyphen adjacent to a dot,
// no empty label.
function validateHost(value: string): string | null {
  const trimmed = value.trim();
  const common = checkCommonRules(trimmed);
  if (common) return common;
  if (/[^0-9A-Za-z.-]/.test(trimmed)) return "Enter a valid hostname";
  if (/^[-.]|[-.]$|\.\.|-\.|\.-/.test(trimmed))
    return "Enter a valid hostname";
  return null;
}

// family `ipv4_literal` — charset is digits and dot only, and the value must be
// a dotted quad of four octets, each 1-3 digits and no greater than 255.
function validateIpv4Literal(value: string): string | null {
  const trimmed = value.trim();
  const common = checkCommonRules(trimmed);
  if (common) return common;
  if (/[^0-9.]/.test(trimmed))
    return "Enter an IPv4 address — a hostname is not accepted here";
  const octets = trimmed.split(".");
  if (octets.length !== 4) return "Enter a valid IPv4 address";
  for (const oct of octets) {
    if (!/^[0-9]{1,3}$/.test(oct)) return "Enter a valid IPv4 address";
    if (Number(oct) > 255) return "Enter a valid IPv4 address";
  }
  return null;
}

function validateSlot(slot: SlotKey, value: string): string | null {
  return slot === "target_host_1" || slot === "target_host_2"
    ? validateHost(value)
    : validateIpv4Literal(value);
}

// ─── Field labels & placeholders ────────────────────────────────────────────
//
// The label carries the ROLE, not the key name: which leg of the chain this is
// and what it is for. The chain's order is the whole point of the design.
const SLOT_META: Record<
  SlotKey,
  { label: string; placeholder: string; inputMode?: "numeric" }
> = {
  target_host_1: { label: "First hostname", placeholder: "cloudflare.com" },
  target_host_2: { label: "Second hostname", placeholder: "google.com" },
  target_ip_1: {
    label: "First IPv4 address",
    placeholder: "1.1.1.1",
    inputMode: "numeric",
  },
  target_ip_2: {
    label: "Second IPv4 address",
    placeholder: "8.8.8.8",
    inputMode: "numeric",
  },
};

// ─── Static chrome, shared by all three states ──────────────────────────────

function CardChrome({ children }: { children: React.ReactNode }) {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Probe Targets</CardTitle>
        <CardDescription>
          Which endpoints the modem checks to confirm the internet is reachable.
        </CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function ConnectivitySensitivityCard() {
  const { targets, isLoading, error, isSaving, saveError, save } =
    usePingProfile();
  const { data: modemStatus } = useModemStatus();
  const { saved, markSaved } = useSaveFlash();

  const [draft, setDraft] = useState<PingProfileTargets>(DEFAULT_TARGETS);
  const [errors, setErrors] = useState<SlotErrors>({});
  const initializedRef = useRef(false);

  // When the saved settings arrive, sync local state once.
  useEffect(() => {
    if (targets !== undefined && !initializedRef.current) {
      setDraft(targets);
      initializedRef.current = true;
    }
  }, [targets]);

  // Live family indicator: which address family the daemon's last successful
  // probe used. It belongs to the hostname legs — those are the ones that
  // delegate the choice to the resolver; the literal legs are IPv4 by
  // construction.
  const lastFamily = modemStatus?.connectivity?.last_family;

  const isDirty = useMemo(() => {
    if (targets === undefined) return false;
    return SLOT_ORDER.some((slot) => draft[slot] !== targets[slot]);
  }, [targets, draft]);

  const hasValidationErrors = SLOT_ORDER.some((slot) => errors[slot]);
  const canSave = isDirty && !isSaving && !hasValidationErrors;

  const setSlot = (slot: SlotKey, value: string) => {
    setDraft((prev) => ({ ...prev, [slot]: value }));
    setErrors((prev) => ({ ...prev, [slot]: validateSlot(slot, value) }));
  };

  const resetToDefaults = () => {
    setDraft(DEFAULT_TARGETS);
    setErrors({});
  };

  const handleSave = async () => {
    if (!canSave) return;

    // Re-validate at submit time — a slot never touched has no error recorded.
    const submitErrors: SlotErrors = {};
    for (const slot of SLOT_ORDER) {
      submitErrors[slot] = validateSlot(slot, draft[slot]);
    }
    setErrors(submitErrors);
    if (SLOT_ORDER.some((slot) => submitErrors[slot])) return;

    try {
      await save({
        target_host_1: draft.target_host_1.trim(),
        target_host_2: draft.target_host_2.trim(),
        target_ip_1: draft.target_ip_1.trim(),
        target_ip_2: draft.target_ip_2.trim(),
      });
      markSaved();
      toast.success("Probe targets updated");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to save";
      toast.error(msg);
    }
  };

  // ── Loading skeleton ────────────────────────────────────────────────────
  // Mirrors the loaded geometry: the group header + reset control, then two
  // two-field groups, then the save row.
  if (isLoading) {
    return (
      <CardChrome>
        <div className="grid gap-5">
          <div className="flex items-start justify-between gap-3">
            <div className="grid gap-1.5 flex-1">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-full max-w-md" />
            </div>
            <Skeleton className="h-9 w-9 rounded-md shrink-0" />
          </div>
          {[0, 1].map((group) => (
            <div key={group} className="grid gap-2">
              <Skeleton className="h-3 w-56" />
              <div className="grid gap-3 @md/card:grid-cols-2">
                {[0, 1].map((field) => (
                  <div key={field} className="grid gap-1.5">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-9 w-full rounded-md" />
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="flex justify-end">
            <Skeleton className="h-9 w-32" />
          </div>
        </div>
      </CardChrome>
    );
  }

  // ── Error variant ──────────────────────────────────────────────────────
  if (error && targets === undefined) {
    return (
      <CardChrome>
        <Alert variant="destructive">
          <AlertTriangleIcon className="size-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </CardChrome>
    );
  }

  // ── A single slot field ────────────────────────────────────────────────
  const renderSlot = (slot: SlotKey, describedBy: string) => {
    const meta = SLOT_META[slot];
    const err = errors[slot] ?? null;
    const errId = `${slot}-err`;
    return (
      <div key={slot} className="grid gap-1.5">
        <Label htmlFor={slot}>{meta.label}</Label>
        <Input
          id={slot}
          value={draft[slot]}
          onChange={(e) => setSlot(slot, e.target.value)}
          placeholder={meta.placeholder}
          inputMode={meta.inputMode}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={err !== null}
          aria-describedby={err ? `${describedBy} ${errId}` : describedBy}
        />
        {err && (
          <p id={errId} role="alert" className="text-xs text-destructive">
            {err}
          </p>
        )}
      </div>
    );
  };

  // ── Empty state ────────────────────────────────────────────────────────
  // The CGI defaults every slot independently, so this should not happen — but
  // a config the backend could not read at all comes back as four empty slots,
  // and a form of four blank boxes with no explanation is the worst possible
  // reading of that. Say what happened and offer the one-click repair.
  const isEmpty =
    targets !== undefined && SLOT_ORDER.every((slot) => !targets[slot]);

  return (
    <CardChrome>
      {isEmpty && !isDirty && (
        <Alert className="mb-4">
          <AlertTriangleIcon className="size-4" />
          <AlertDescription>
            No probe targets are configured, so connectivity cannot be checked.
            Reset to defaults to restore the standard chain.
          </AlertDescription>
        </Alert>
      )}

      {saveError && (
        <Alert variant="destructive" className="mb-4">
          <AlertTriangleIcon className="size-4" />
          <AlertDescription>{saveError}</AlertDescription>
        </Alert>
      )}

      <motion.div
        className="grid gap-5"
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
      >
        {/* ── What the chain is ───────────────────────────────────────── */}
        <motion.div
          variants={staggerItem}
          className="flex items-start justify-between gap-3"
        >
          <div>
            <h4 className="text-sm font-medium">Probe chain</h4>
            <p id="probe-chain-help" className="text-xs text-muted-foreground mt-0.5">
              The modem pings these four endpoints in order and stops at the
              first one that answers. The internet is only reported as down when
              all four fail.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="shrink-0"
            onClick={resetToDefaults}
            aria-label="Reset probe targets to defaults"
            title="Reset to defaults"
          >
            <RotateCcwIcon />
          </Button>
        </motion.div>

        {/* ── Legs 1-2: hostnames ─────────────────────────────────────── */}
        <motion.div variants={staggerItem} className="grid gap-2">
          <p id="probe-hosts-help" className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">
              Tried first — hostnames.
            </span>{" "}
            The modem lets DNS pick the address, so an IPv4 or IPv6 connection
            is answered by whichever the network actually offers.
            {(lastFamily === "ipv4" || lastFamily === "ipv6") && (
              <>
                {" "}
                <span className="text-foreground">
                  {lastFamily === "ipv6"
                    ? "The last successful probe answered over IPv6."
                    : "The last successful probe answered over IPv4."}
                </span>
              </>
            )}
          </p>
          <div className="grid gap-3 @md/card:grid-cols-2">
            {renderSlot("target_host_1", "probe-chain-help probe-hosts-help")}
            {renderSlot("target_host_2", "probe-chain-help probe-hosts-help")}
          </div>
        </motion.div>

        {/* ── Legs 3-4: IPv4 literals ─────────────────────────────────── */}
        <motion.div variants={staggerItem} className="grid gap-2">
          <p id="probe-ips-help" className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">
              Fallback — IPv4 addresses.
            </span>{" "}
            Used only when both hostnames fail. These need no DNS, so a broken
            resolver is not mistaken for a lost connection. Hostnames are not
            accepted here.
          </p>
          <div className="grid gap-3 @md/card:grid-cols-2">
            {renderSlot("target_ip_1", "probe-chain-help probe-ips-help")}
            {renderSlot("target_ip_2", "probe-chain-help probe-ips-help")}
          </div>
        </motion.div>

        {/* ── Cross-link: probe timing lives in the Watchdog now ───── */}
        <motion.div variants={staggerItem}>
          <p className="text-xs text-muted-foreground">
            Probe timing — how often the modem checks and how many failures
            trigger recovery — now lives in the{" "}
            <Link
              href="/monitoring/watchdog"
              className="text-primary underline-offset-4 hover:underline"
            >
              Connection Watchdog
            </Link>
            .
          </p>
        </motion.div>

        {/* ── Save button ──────────────────────────────────────────── */}
        <motion.div variants={staggerItem} className="flex justify-end">
          <SaveButton
            onClick={handleSave}
            isSaving={isSaving}
            saved={saved}
            disabled={!canSave}
          />
        </motion.div>
      </motion.div>
    </CardChrome>
  );
}
