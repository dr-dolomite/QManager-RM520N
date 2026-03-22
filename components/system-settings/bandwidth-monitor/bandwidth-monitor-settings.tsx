"use client";

import { motion, type Variants } from "motion/react";
import { toast } from "sonner";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TbInfoCircleFilled } from "react-icons/tb";
import { AlertTriangleIcon } from "lucide-react";

import { useBandwidthSettings } from "@/hooks/use-bandwidth-settings";

// ─── Animation variants ────────────────────────────────────────────────────

const containerVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25, ease: "easeOut" } },
};

const BandwidthMonitorSettings = () => {
  const bandwidth = useBandwidthSettings();

  return (
    <div className="@container/main mx-auto p-2">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Bandwidth Monitor</h1>
      </div>
      <div className="grid grid-cols-1 @3xl/main:grid-cols-2 grid-flow-row gap-4">
        <Card className="@container/card">
          <CardHeader>
            <div className="flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex"
                    aria-label="Bandwidth monitor info"
                  >
                    <TbInfoCircleFilled className="size-5 text-info" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>
                    Monitors real-time network throughput across multiple <br />
                    interfaces using a dedicated binary and WebSocket stream. <br />
                    Requires <code>websocat</code> package.
                  </p>
                </TooltipContent>
              </Tooltip>
              <CardTitle>Settings</CardTitle>
            </div>
            <CardDescription>
              Configure the live bandwidth monitoring service.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {bandwidth.isLoading ? (
              <div className="grid gap-2">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-5 w-44" />
                  <Skeleton className="h-6 w-28" />
                </div>
                <Separator />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : (
              <motion.div
                className="grid gap-2"
                variants={containerVariants}
                initial="hidden"
                animate="visible"
              >
                {/* Dependency warnings */}
                {bandwidth.dependencies && !bandwidth.dependencies.websocat_installed && (
                  <motion.div variants={itemVariants}>
                    <Alert>
                      <AlertTriangleIcon className="size-4" />
                      <AlertDescription>
                        <code>websocat</code> is not installed. Install with:{" "}
                        <code className="text-xs">opkg install websocat</code>
                      </AlertDescription>
                    </Alert>
                  </motion.div>
                )}

                {/* Enable toggle */}
                <motion.div variants={itemVariants} className="flex items-center justify-between">
                  <p className="font-semibold text-muted-foreground text-sm">
                    Enable Bandwidth Monitor
                  </p>
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="bandwidth-monitor"
                      checked={bandwidth.settings?.enabled ?? false}
                      disabled={bandwidth.isSaving}
                      onCheckedChange={async (checked) => {
                        const success = await bandwidth.saveSettings({
                          action: "save_settings",
                          enabled: checked,
                        });
                        if (success) {
                          toast.success(
                            checked
                              ? "Bandwidth monitor enabled"
                              : "Bandwidth monitor disabled",
                          );
                        } else {
                          toast.error("Failed to update bandwidth monitor");
                        }
                      }}
                    />
                    <Label htmlFor="bandwidth-monitor">
                      {bandwidth.settings?.enabled ? "Enabled" : "Disabled"}
                    </Label>
                  </div>
                </motion.div>
                <Separator />

                {/* Refresh rate (when enabled) */}
                {bandwidth.settings?.enabled && (
                  <>
                    <motion.div variants={itemVariants} className="flex items-center justify-between mt-4">
                      <Label className="font-semibold text-muted-foreground text-sm">
                        Refresh Rate
                      </Label>
                      <Select
                        value={String(bandwidth.settings.refresh_rate_ms)}
                        onValueChange={async (value) => {
                          const success = await bandwidth.saveSettings({
                            action: "save_settings",
                            refresh_rate_ms: Number(value),
                          });
                          if (success) {
                            toast.success("Refresh rate updated");
                          } else {
                            toast.error("Failed to update refresh rate");
                          }
                        }}
                        disabled={bandwidth.isSaving}
                      >
                        <SelectTrigger className="w-32 h-8" aria-label="Refresh rate">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl">
                          <SelectItem value="500" className="rounded-lg">500 ms</SelectItem>
                          <SelectItem value="1000" className="rounded-lg">1 second</SelectItem>
                          <SelectItem value="2000" className="rounded-lg">2 seconds</SelectItem>
                          <SelectItem value="3000" className="rounded-lg">3 seconds</SelectItem>
                        </SelectContent>
                      </Select>
                    </motion.div>
                    <Separator />

                    {/* Status indicators */}
                    <motion.div variants={itemVariants} className="flex items-center justify-between mt-4">
                      <p className="font-semibold text-muted-foreground text-sm">
                        Service Status
                      </p>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className={
                            bandwidth.status?.websocat_running
                              ? "text-emerald-600 border-emerald-500/30"
                              : "text-muted-foreground"
                          }
                        >
                          WebSocket {bandwidth.status?.websocat_running ? "Running" : "Stopped"}
                        </Badge>
                        <Badge
                          variant="outline"
                          className={
                            bandwidth.status?.monitor_running
                              ? "text-emerald-600 border-emerald-500/30"
                              : "text-muted-foreground"
                          }
                        >
                          Monitor {bandwidth.status?.monitor_running ? "Running" : "Stopped"}
                        </Badge>
                      </div>
                    </motion.div>
                    <Separator />
                  </>
                )}
              </motion.div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default BandwidthMonitorSettings;
