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

import { usePingProfile } from "@/hooks/use-ping-profile";
import { useModemStatus } from "@/hooks/use-modem-status";
import { staggerContainer, staggerItem } from "@/lib/motion-presets";

// ─── Constants ──────────────────────────────────────────────────────────────

// Cloudflare anycast DNS — reliable ICMP responders for both address families.
const DEFAULT_TARGET_IPV4 = "1.1.1.1";
const DEFAULT_TARGET_IPV6 = "2606:4700:4700::1111";

// Common host rules shared by both families: trimmed, non-empty, length-bounded,
// no whitespace, no shell/HTML metacharacters. Mirrors the CGI's validate_target
// so the user sees the same verdict inline that the backend would return.
function checkCommonHostRules(trimmed: string): string | null {
  if (!trimmed) return "Address cannot be empty";
  if (trimmed.length > 128) return "Address too long (max 128 characters)";
  if (/\s/.test(trimmed)) return "Address cannot contain spaces";
  if (/[`$();|<>"\\]/.test(trimmed))
    return "Address contains disallowed characters";
  return null;
}

// IPv4 literal or hostname — charset [0-9A-Za-z.-].
function validateIpv4Target(value: string): string | null {
  const trimmed = value.trim();
  const common = checkCommonHostRules(trimmed);
  if (common) return common;
  if (/[^0-9A-Za-z.-]/.test(trimmed))
    return "Enter an IPv4 address or hostname";
  return null;
}

// IPv6 literal — charset [0-9A-Fa-f:.%], and must contain a colon.
function validateIpv6Target(value: string): string | null {
  const trimmed = value.trim();
  const common = checkCommonHostRules(trimmed);
  if (common) return common;
  if (/[^0-9A-Fa-f:.%]/.test(trimmed)) return "Enter a valid IPv6 address";
  if (!trimmed.includes(":")) return "An IPv6 address must contain ':'";
  return null;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function ConnectivitySensitivityCard() {
  const { targetIpv4, targetIpv6, isLoading, error, isSaving, saveError, save } =
    usePingProfile();
  const { data: modemStatus } = useModemStatus();
  const { saved, markSaved } = useSaveFlash();

  const [ipv4Input, setIpv4Input] = useState<string>("");
  const [ipv6Input, setIpv6Input] = useState<string>("");
  const [ipv4Err, setIpv4Err] = useState<string | null>(null);
  const [ipv6Err, setIpv6Err] = useState<string | null>(null);
  const initializedRef = useRef(false);

  // When the saved settings arrive, sync local state once.
  useEffect(() => {
    if (
      targetIpv4 !== undefined &&
      targetIpv6 !== undefined &&
      !initializedRef.current
    ) {
      setIpv4Input(targetIpv4);
      setIpv6Input(targetIpv6);
      initializedRef.current = true;
    }
  }, [targetIpv4, targetIpv6]);

  // Live family indicator: which address family the daemon's last successful
  // probe used. "ipv6" means the IPv4 leg failed and the fallback carried the
  // connection — the exact case this card's IPv6 target exists to cover.
  const lastFamily = modemStatus?.connectivity?.last_family;

  // Dirty detection
  const isDirty = useMemo(() => {
    if (targetIpv4 === undefined || targetIpv6 === undefined) return false;
    if (ipv4Input !== targetIpv4) return true;
    if (ipv6Input !== targetIpv6) return true;
    return false;
  }, [targetIpv4, ipv4Input, targetIpv6, ipv6Input]);

  const hasValidationErrors = ipv4Err !== null || ipv6Err !== null;
  const canSave = isDirty && !isSaving && !hasValidationErrors;

  // Save handler
  const handleSave = async () => {
    if (!canSave) return;
    // Re-validate at submit time
    const e4 = validateIpv4Target(ipv4Input);
    const e6 = validateIpv6Target(ipv6Input);
    setIpv4Err(e4);
    setIpv6Err(e6);
    if (e4 || e6) return;

    try {
      await save({
        target_ipv4: ipv4Input.trim(),
        target_ipv6: ipv6Input.trim(),
      });
      markSaved();
      toast.success("Probe targets updated");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to save";
      toast.error(msg);
    }
  };

  // ── Loading skeleton ────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>Probe Targets</CardTitle>
          <CardDescription>
            Which endpoints the modem checks to confirm the internet is
            reachable.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3">
            {/* Probe targets header + reset icon */}
            <div className="flex items-start justify-between gap-3">
              <div className="grid gap-1.5 flex-1">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-3 w-full max-w-md" />
              </div>
              <Skeleton className="h-9 w-9 rounded-md shrink-0" />
            </div>
            {/* IPv4 target */}
            <div className="grid gap-1.5">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-9 w-full rounded-md" />
            </div>
            {/* IPv6 target */}
            <div className="grid gap-1.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-9 w-full rounded-md" />
            </div>
            {/* Save button */}
            <div className="flex justify-end">
              <Skeleton className="h-9 w-32" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Error variant ──────────────────────────────────────────────────────
  if (error && targetIpv4 === undefined) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>Probe Targets</CardTitle>
          <CardDescription>
            Which endpoints the modem checks to confirm the internet is
            reachable.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertTriangleIcon className="size-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Probe Targets</CardTitle>
        <CardDescription>
          Which endpoints the modem checks to confirm the internet is reachable.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {saveError && (
          <Alert variant="destructive" className="mb-4">
            <AlertTriangleIcon className="size-4" />
            <AlertDescription>{saveError}</AlertDescription>
          </Alert>
        )}

        <motion.div
          className="grid gap-3"
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
        >
          {/* ── Probe target inputs ──────────────────────────────────── */}
          <motion.div variants={staggerItem} className="grid gap-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h4 className="text-sm font-medium">Probe Targets</h4>
                <p id="probe-targets-help" className="text-xs text-muted-foreground mt-0.5">
                  DNS servers the modem pings to confirm the internet is
                  reachable. IPv4 is tried first; IPv6 is the fallback, so an
                  IPv6-only connection is never reported as down.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="shrink-0"
                onClick={() => {
                  setIpv4Input(DEFAULT_TARGET_IPV4);
                  setIpv6Input(DEFAULT_TARGET_IPV6);
                  setIpv4Err(null);
                  setIpv6Err(null);
                }}
                aria-label="Reset probe targets to defaults"
                title="Reset to defaults"
              >
                <RotateCcwIcon />
              </Button>
            </div>

            {/* IPv4 DNS server — pinged first */}
            <div className="grid gap-1.5">
              <Label htmlFor="target-ipv4">IPv4 DNS Server</Label>
              <Input
                id="target-ipv4"
                value={ipv4Input}
                onChange={(e) => {
                  setIpv4Input(e.target.value);
                  setIpv4Err(validateIpv4Target(e.target.value));
                }}
                placeholder="1.1.1.1"
                inputMode="numeric"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={ipv4Err !== null}
                aria-describedby={
                  ipv4Err
                    ? "probe-targets-help target-ipv4-err"
                    : "probe-targets-help"
                }
              />
              {ipv4Err && (
                <p
                  id="target-ipv4-err"
                  role="alert"
                  className="text-xs text-destructive"
                >
                  {ipv4Err}
                </p>
              )}
            </div>

            {/* IPv6 DNS server — fallback for IPv6-only bearers */}
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="target-ipv6">IPv6 DNS Server</Label>
                {lastFamily === "ipv6" && (
                  <span className="text-xs text-muted-foreground">
                    Currently reachable via IPv6
                  </span>
                )}
              </div>
              <Input
                id="target-ipv6"
                value={ipv6Input}
                onChange={(e) => {
                  setIpv6Input(e.target.value);
                  setIpv6Err(validateIpv6Target(e.target.value));
                }}
                placeholder="2606:4700:4700::1111"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={ipv6Err !== null}
                aria-describedby={
                  ipv6Err
                    ? "probe-targets-help target-ipv6-err"
                    : "probe-targets-help"
                }
              />
              {ipv6Err && (
                <p
                  id="target-ipv6-err"
                  role="alert"
                  className="text-xs text-destructive"
                >
                  {ipv6Err}
                </p>
              )}
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
      </CardContent>
    </Card>
  );
}
