"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { motion, type Variants } from "motion/react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
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
import { DownloadIcon } from "lucide-react";
import { toast } from "sonner";

import type { UpdateInfo } from "@/hooks/use-software-update";

// ─── Props ──────────────────────────────────────────────────────────────────

interface UpdatePreferencesCardProps {
  updateInfo: UpdateInfo | null;
  isLoading: boolean;
  isUpdating: boolean;
  isDownloading: boolean;
  installVersion: (version: string) => Promise<void>;
  togglePrerelease: (enabled: boolean) => Promise<void>;
  saveAutoUpdate: (enabled: boolean, time: string) => Promise<void>;
}

// ─── Component ──────────────────────────────────────────────────────────────

const AUTO_UPDATE_DEBOUNCE = 800;

const containerVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25, ease: "easeOut" } },
};

export function UpdatePreferencesCard({
  updateInfo,
  isLoading,
  isUpdating,
  isDownloading,
  installVersion,
  togglePrerelease,
  saveAutoUpdate,
}: UpdatePreferencesCardProps) {
  const [showInstallDialog, setShowInstallDialog] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<string>("");
  const [prereleaseToggling, setPrereleaseToggling] = useState(false);
  const [autoUpdateToggling, setAutoUpdateToggling] = useState(false);
  const [autoUpdateTime, setAutoUpdateTime] = useState("03:00");
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync local time from server data
  useEffect(() => {
    if (updateInfo?.auto_update_time) {
      setAutoUpdateTime(updateInfo.auto_update_time);
    }
  }, [updateInfo?.auto_update_time]);

  const handleTogglePrerelease = useCallback(
    async (checked: boolean) => {
      setPrereleaseToggling(true);
      try {
        await togglePrerelease(checked);
        toast.success(
          checked
            ? "Pre-release updates enabled"
            : "Pre-release updates disabled",
        );
      } catch {
        toast.error("Failed to update preference");
      } finally {
        setPrereleaseToggling(false);
      }
    },
    [togglePrerelease],
  );

  const handleVersionInstall = useCallback(async () => {
    setShowInstallDialog(false);
    if (!selectedVersion) return;
    try {
      await installVersion(selectedVersion);
    } catch {
      toast.error("Failed to start installation");
    }
  }, [selectedVersion, installVersion]);

  const handleAutoUpdateToggle = useCallback(
    async (checked: boolean) => {
      setAutoUpdateToggling(true);
      try {
        await saveAutoUpdate(checked, autoUpdateTime);
        toast.success(
          checked ? "Automatic updates enabled" : "Automatic updates disabled",
        );
      } catch {
        toast.error("Failed to update preference");
      } finally {
        setAutoUpdateToggling(false);
      }
    },
    [saveAutoUpdate, autoUpdateTime],
  );

  const handleAutoUpdateTimeChange = useCallback(
    (newTime: string) => {
      setAutoUpdateTime(newTime);
      if (!updateInfo?.auto_update_enabled) return;

      // Debounced save
      if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
      autoTimerRef.current = setTimeout(async () => {
        try {
          await saveAutoUpdate(true, newTime);
          toast.success("Update schedule saved");
        } catch {
          toast.error("Failed to save schedule");
        }
      }, AUTO_UPDATE_DEBOUNCE);
    },
    [saveAutoUpdate, updateInfo?.auto_update_enabled],
  );

  // Clean up debounce timer
  useEffect(() => {
    return () => {
      if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
    };
  }, []);

  // ── Loading skeleton ──────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>Update Preferences</CardTitle>
          <CardDescription>
            Configure update channel and version management.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2">
            <Separator />
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-36" />
              <Skeleton className="h-6 w-12" />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-36" />
              <Skeleton className="h-6 w-12" />
            </div>
            <Separator />
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-20 w-full rounded-lg" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>Update Preferences</CardTitle>
          <CardDescription>
            Configure update channel and version management.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <motion.div
            className="grid gap-2"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
          >
            {/* ── Pre-release toggle ──────────────────────────────── */}
            <Separator />
            <motion.div variants={itemVariants} className="flex items-center justify-between">
              <p className="font-semibold text-muted-foreground text-sm">
                Include pre-releases
              </p>
              <div className="flex items-center space-x-2">
                <Switch
                  id="include-prerelease"
                  checked={updateInfo?.include_prerelease ?? false}
                  onCheckedChange={handleTogglePrerelease}
                  disabled={prereleaseToggling || isUpdating}
                />
                <Label htmlFor="include-prerelease">
                  {updateInfo?.include_prerelease ? "Enabled" : "Disabled"}
                </Label>
              </div>
            </motion.div>

            {/* ── Automatic updates ─────────────────────────────── */}
            <Separator />
            <motion.div variants={itemVariants} className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-muted-foreground text-sm">
                  Automatic updates
                </p>
                <div className="flex items-center space-x-2">
                  <Switch
                    id="auto-update"
                    checked={updateInfo?.auto_update_enabled ?? false}
                    onCheckedChange={handleAutoUpdateToggle}
                    disabled={autoUpdateToggling || isUpdating}
                  />
                  <Label htmlFor="auto-update">
                    {updateInfo?.auto_update_enabled ? "Enabled" : "Disabled"}
                  </Label>
                </div>
              </div>
            </motion.div>

            {/* Time Configuration for Automatic Updates */}
            {updateInfo?.auto_update_enabled && (
              <>
                <Separator />
                <motion.div variants={itemVariants} className="flex flex-col gap-2">
                  <p className="font-semibold text-sm">
                    Update Installation Time
                  </p>

                  <div className="flex flex-col @sm/card:flex-row @sm/card:items-center gap-2 @sm/card:justify-between rounded-lg border bg-muted/50 p-3">
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="text-xs text-muted-foreground">
                        Update at
                      </span>
                      <p className="text-xs text-muted-foreground">
                        Checks for updates and installs automatically. The
                        device will reboot if an update is found.
                      </p>
                    </div>
                    <Input
                      id="auto-update-time"
                      type="time"
                      value={autoUpdateTime}
                      onChange={(e) =>
                        handleAutoUpdateTimeChange(e.target.value)
                      }
                      disabled={isUpdating || autoUpdateToggling}
                      aria-label="Automatic update time"
                      className="w-28 shrink-0"
                    />
                  </div>
                </motion.div>
              </>
            )}

            {/* ── Version Management ──────────────────────────────── */}
            <Separator />
            <motion.div variants={itemVariants} className="flex flex-col gap-2">
              <p className="font-semibold text-sm">Version Management</p>
              <div className="flex flex-col gap-2 rounded-lg border bg-muted/50 p-3">
                <span className="text-xs text-muted-foreground">
                  Select a version to install, reinstall, or rollback.
                </span>
                <div className="flex items-center gap-2">
                  <Select
                    value={selectedVersion}
                    onValueChange={setSelectedVersion}
                    disabled={isUpdating || isDownloading}
                  >
                    <SelectTrigger className="flex-1" aria-label="Select version to install">
                      <SelectValue placeholder="Select version..." />
                    </SelectTrigger>
                    <SelectContent>
                      {(updateInfo?.available_versions ?? []).map((v) => (
                        <SelectItem
                          key={v.tag}
                          value={v.tag}
                          disabled={!v.has_assets}
                        >
                          <div className="flex items-center justify-between gap-3 w-full">
                            <span>{v.tag}</span>
                            {v.is_current ? (
                              <span className="text-[10px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                                current
                              </span>
                            ) : !v.has_assets ? (
                              <span className="text-[10px] text-muted-foreground">
                                no binary
                              </span>
                            ) : v.asset_size ? (
                              <span className="text-[10px] text-muted-foreground">
                                {v.asset_size}
                              </span>
                            ) : null}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowInstallDialog(true)}
                    disabled={!selectedVersion || isUpdating || isDownloading}
                    className="shrink-0"
                  >
                    <DownloadIcon className="size-4" />
                    Install
                  </Button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        </CardContent>
      </Card>

      {/* ── Version install confirmation dialog ────────────────────── */}
      <AlertDialog
        open={showInstallDialog}
        onOpenChange={setShowInstallDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {selectedVersion === updateInfo?.current_version
                ? "Reinstall Current Version"
                : `Install ${selectedVersion}`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {selectedVersion === updateInfo?.current_version ? (
                <>
                  This will reinstall <strong>{selectedVersion}</strong> to repair the
                  current installation. The device will reboot after installation.
                </>
              ) : (
                <>
                  This will install <strong>{selectedVersion}</strong>, replacing the
                  current version (<strong>{updateInfo?.current_version}</strong>).
                  The device will reboot after installation.
                </>
              )}
              {" "}Do not power off the device during this process.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleVersionInstall}>
              <DownloadIcon className="size-4" />
              {selectedVersion === updateInfo?.current_version
                ? "Reinstall Now"
                : "Install Now"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
