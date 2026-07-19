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
import { staggerContainer, staggerItem } from "@/lib/motion-presets";

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_TARGET_1 = "http://cp.cloudflare.com/";
const DEFAULT_TARGET_2 = "http://www.gstatic.com/generate_204";

function validateTargetClient(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "URL cannot be empty";
  if (trimmed.length > 256) return "URL too long (max 256 characters)";
  if (/\s/.test(trimmed)) return "URL cannot contain spaces";
  if (/[`$();|<>"\\]/.test(trimmed)) return "URL contains disallowed characters";
  return null;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function ConnectivitySensitivityCard() {
  const { target1, target2, isLoading, error, isSaving, saveError, save } =
    usePingProfile();
  const { saved, markSaved } = useSaveFlash();

  const [target1Input, setTarget1Input] = useState<string>("");
  const [target2Input, setTarget2Input] = useState<string>("");
  const [target1Err, setTarget1Err] = useState<string | null>(null);
  const [target2Err, setTarget2Err] = useState<string | null>(null);
  const initializedRef = useRef(false);

  // When the saved settings arrive, sync local state once.
  useEffect(() => {
    if (
      target1 !== undefined &&
      target2 !== undefined &&
      !initializedRef.current
    ) {
      setTarget1Input(target1);
      setTarget2Input(target2);
      initializedRef.current = true;
    }
  }, [target1, target2]);

  // Dirty detection
  const isDirty = useMemo(() => {
    if (target1 === undefined || target2 === undefined) return false;
    if (target1Input !== target1) return true;
    if (target2Input !== target2) return true;
    return false;
  }, [target1, target1Input, target2, target2Input]);

  const hasValidationErrors = target1Err !== null || target2Err !== null;
  const canSave = isDirty && !isSaving && !hasValidationErrors;

  // Save handler
  const handleSave = async () => {
    if (!canSave) return;
    // Re-validate at submit time
    const e1 = validateTargetClient(target1Input);
    const e2 = validateTargetClient(target2Input);
    setTarget1Err(e1);
    setTarget2Err(e2);
    if (e1 || e2) return;

    try {
      await save({
        target_1: target1Input.trim(),
        target_2: target2Input.trim(),
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
            {/* Primary URL */}
            <div className="grid gap-1.5">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-9 w-full rounded-md" />
            </div>
            {/* Secondary URL */}
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
  if (error && target1 === undefined) {
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
                  Primary is checked first. Secondary is only used if primary fails. URLs without a scheme default to https.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="shrink-0"
                onClick={() => {
                  setTarget1Input(DEFAULT_TARGET_1);
                  setTarget2Input(DEFAULT_TARGET_2);
                  setTarget1Err(null);
                  setTarget2Err(null);
                }}
                aria-label="Reset probe targets to defaults"
                title="Reset to defaults"
              >
                <RotateCcwIcon />
              </Button>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="target-primary">Primary URL</Label>
              <Input
                id="target-primary"
                value={target1Input}
                onChange={(e) => {
                  setTarget1Input(e.target.value);
                  setTarget1Err(validateTargetClient(e.target.value));
                }}
                placeholder="youtube.com or https://example.com/"
                aria-invalid={target1Err !== null}
                aria-describedby={
                  target1Err
                    ? "probe-targets-help target-primary-err"
                    : "probe-targets-help"
                }
              />
              {target1Err && (
                <p
                  id="target-primary-err"
                  role="alert"
                  className="text-xs text-destructive"
                >
                  {target1Err}
                </p>
              )}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="target-secondary">Secondary URL (fallback)</Label>
              <Input
                id="target-secondary"
                value={target2Input}
                onChange={(e) => {
                  setTarget2Input(e.target.value);
                  setTarget2Err(validateTargetClient(e.target.value));
                }}
                placeholder="cloudflare.com or http://example.com/generate_204"
                aria-invalid={target2Err !== null}
                aria-describedby={
                  target2Err
                    ? "probe-targets-help target-secondary-err"
                    : "probe-targets-help"
                }
              />
              {target2Err && (
                <p
                  id="target-secondary-err"
                  role="alert"
                  className="text-xs text-destructive"
                >
                  {target2Err}
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
