"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  CheckCircle2Icon,
  DownloadIcon,
  Loader2Icon,
  RefreshCwIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyableCommand } from "@/components/ui/copyable-command";
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
import { isPackCompatible } from "@/lib/i18n/app-version";
import { resolveInstallError } from "@/lib/i18n/resolve-error";
import type {
  LanguageCode,
  LanguageMeta,
  LanguagePackInstallState,
  RemoteManifestEntry,
} from "@/types/i18n";

export type LanguagePackRowVariant =
  | { kind: "built_in"; entry: LanguageMeta; isActive: boolean }
  | {
      kind: "downloaded";
      entry: LanguageMeta;
      isActive: boolean;
      version: string;
      completeness: number;
      updateAvailableVersion?: string;
      manifestEntry?: RemoteManifestEntry;
    }
  | { kind: "available"; manifestEntry: RemoteManifestEntry };

interface LanguagePackRowProps {
  variant: LanguagePackRowVariant;
  installState: LanguagePackInstallState;
  onInstall: (code: LanguageCode) => Promise<void>;
  onCancelInstall: () => Promise<void>;
  onRemove: (code: LanguageCode, isActive: boolean) => Promise<void>;
  onSelectActive: (code: LanguageCode) => void;
  switching: boolean;
}

// Human labels for the worker's install steps (machine-voice states).
const STEP_LABELS: Record<string, string> = {
  pending: "Queued…",
  downloading: "Downloading…",
  verifying: "Verifying checksum…",
  extracting: "Extracting…",
  validating: "Validating…",
  installing: "Installing…",
  cancelling: "Cancelling…",
};

function formatSize(bytes: number): string {
  if (bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function completenessLabel(fraction: number): string {
  return `${Math.floor(Math.max(0, Math.min(1, fraction)) * 100)}%`;
}

export function LanguagePackRow({
  variant,
  installState,
  onInstall,
  onCancelInstall,
  onRemove,
  onSelectActive,
  switching,
}: LanguagePackRowProps) {
  const [removeOpen, setRemoveOpen] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);

  const code =
    variant.kind === "available" ? variant.manifestEntry.code : variant.entry.code;
  const nativeName =
    variant.kind === "available"
      ? variant.manifestEntry.native_name
      : variant.entry.native_name;
  const englishName =
    variant.kind === "available"
      ? variant.manifestEntry.english_name
      : variant.entry.english_name;

  const isThisInstalling =
    installState.state !== "idle" &&
    installState.state !== "done" &&
    installState.state !== "failed" &&
    installState.state !== "cancelled" &&
    installState.code === code;
  const installFailed = installState.state === "failed" && installState.code === code;

  const manifestEntry =
    variant.kind === "available"
      ? variant.manifestEntry
      : variant.kind === "downloaded"
        ? variant.manifestEntry
        : undefined;

  const isActive =
    (variant.kind === "built_in" || variant.kind === "downloaded") && variant.isActive;

  // Available packs requiring a newer app can't be installed.
  const compatible =
    variant.kind === "available"
      ? isPackCompatible(variant.manifestEntry.app_min_version)
      : true;

  // Completeness: downloaded rows report their own; available reads the manifest.
  const completeness =
    variant.kind === "downloaded"
      ? variant.completeness
      : variant.kind === "available"
        ? variant.manifestEntry.completeness
        : undefined;

  const handleRemoveClick = async () => {
    setRemoving(true);
    try {
      const active = variant.kind === "downloaded" && variant.isActive;
      await onRemove(code, active);
    } finally {
      setRemoving(false);
      setRemoveOpen(false);
    }
  };

  const stepLabel = installState.step
    ? STEP_LABELS[installState.step] ?? installState.message ?? "Working…"
    : STEP_LABELS[installState.state] ?? installState.message ?? "Working…";

  return (
    <div
      className="flex flex-col gap-3 rounded-md border p-4"
      aria-current={isActive || undefined}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-base font-medium break-words">{nativeName}</span>
            {nativeName !== englishName && (
              <span className="text-xs text-muted-foreground break-words">
                ({englishName})
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {variant.kind === "built_in" && (
              <Badge
                variant="outline"
                className="bg-muted/50 text-muted-foreground border-muted-foreground/30"
              >
                Built-in
              </Badge>
            )}
            {variant.kind === "downloaded" && (
              <Badge
                variant="outline"
                className="bg-success/15 text-success hover:bg-success/20 border-success/30"
              >
                <CheckCircle2Icon className="size-3" />
                Installed
              </Badge>
            )}
            {variant.kind === "downloaded" && variant.updateAvailableVersion && (
              <Badge
                variant="outline"
                className="bg-info/15 text-info hover:bg-info/20 border-info/30"
              >
                <DownloadIcon className="size-3" />
                Update available
              </Badge>
            )}
            {isActive && (
              <Badge
                variant="outline"
                className="bg-success/15 text-success hover:bg-success/20 border-success/30"
              >
                <CheckCircle2Icon className="size-3" />
                Active
              </Badge>
            )}
            {variant.kind === "available" && !compatible && (
              <Badge
                variant="outline"
                className="bg-warning/15 text-warning hover:bg-warning/20 border-warning/30"
              >
                <TriangleAlertIcon className="size-3" />
                Needs newer app
              </Badge>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {(variant.kind === "built_in" || variant.kind === "downloaded") &&
            !isActive && (
              <Button
                size="sm"
                onClick={() => onSelectActive(code)}
                disabled={switching}
                aria-label={`Use ${englishName}`}
              >
                {switching ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : null}
                Use
              </Button>
            )}

          {variant.kind === "available" && (
            <Button
              size="sm"
              onClick={() => onInstall(code)}
              disabled={isThisInstalling || !compatible}
              aria-busy={isThisInstalling}
              aria-label={`Install ${englishName}`}
            >
              {isThisInstalling ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <DownloadIcon className="size-4" />
              )}
              {isThisInstalling ? "Installing…" : "Install"}
            </Button>
          )}

          {variant.kind === "downloaded" && variant.updateAvailableVersion && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onInstall(code)}
              disabled={isThisInstalling}
              aria-busy={isThisInstalling}
              aria-label={`Update ${englishName}`}
            >
              {isThisInstalling ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <RefreshCwIcon className="size-4" />
              )}
            </Button>
          )}

          {variant.kind === "downloaded" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setRemoveOpen(true)}
              disabled={isThisInstalling}
              aria-label={`Remove ${englishName}`}
            >
              <Trash2Icon className="size-4" />
            </Button>
          )}

          {isThisInstalling && installState.state !== "cancelling" && (
            <Button size="sm" variant="ghost" onClick={() => onCancelInstall()}>
              Cancel
            </Button>
          )}
        </div>
      </div>

      {(completeness !== undefined || manifestEntry) && (
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <div>
            <div className="text-muted-foreground">Completeness</div>
            <div className="text-foreground tabular-nums">
              {completeness !== undefined ? completenessLabel(completeness) : "—"}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Size</div>
            <div className="text-foreground tabular-nums">
              {manifestEntry ? formatSize(manifestEntry.size_bytes) : "—"}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Version</div>
            <div className="font-mono text-foreground">
              {variant.kind === "downloaded"
                ? variant.version || "—"
                : manifestEntry?.version || "—"}
            </div>
          </div>
          <div className="min-w-0">
            <div className="text-muted-foreground">
              {manifestEntry && manifestEntry.contributors.length > 1
                ? "Translators"
                : "Translator"}
            </div>
            <div className="truncate text-foreground">
              {manifestEntry && manifestEntry.contributors.length > 0
                ? manifestEntry.contributors.join(", ")
                : "Community"}
            </div>
          </div>
        </div>
      )}

      {isThisInstalling && (
        <div
          className="flex items-center gap-2 text-xs text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          <Loader2Icon className="size-3 animate-spin" />
          <span>{stepLabel}</span>
        </div>
      )}

      {/* manifestEntry guard: built-in packs never run an install. */}
      <AnimatePresence initial={false}>
        {installFailed && manifestEntry && (
          <motion.div
            key="install-failure"
            initial={{ opacity: 0, y: -6, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, y: -6, height: 0 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <Alert variant="destructive">
              <TriangleAlertIcon />
              <AlertTitle>Install failed</AlertTitle>
              <AlertDescription className="flex flex-col gap-2">
                <p>
                  {resolveInstallError(
                    undefined,
                    installState.message,
                    "The language pack couldn't be installed. You can install it manually over SSH:",
                  )}
                </p>
                <CopyableCommand
                  command={`qmanager_language_install ${code} ${manifestEntry.url} ${manifestEntry.sha256}`}
                />
              </AlertDescription>
            </Alert>
          </motion.div>
        )}
      </AnimatePresence>

      <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {englishName}?</AlertDialogTitle>
            <AlertDialogDescription>
              {variant.kind === "downloaded" && variant.isActive
                ? `${englishName} is the active language. Removing it switches QManager back to English.`
                : `This deletes the downloaded ${englishName} pack from the device. You can reinstall it any time.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRemoveClick} disabled={removing}>
              {removing ? <Loader2Icon className="size-4 animate-spin" /> : null}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
