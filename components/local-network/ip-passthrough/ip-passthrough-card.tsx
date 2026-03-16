"use client";

import { useState, useEffect, type FormEvent, type ChangeEvent } from "react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel, FieldSet } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
import { Loader2, RotateCcwIcon } from "lucide-react";

import { useIpPassthrough } from "@/hooks/use-ip-passthrough";
import type {
  PassthroughMode,
  DnsProxy,
  IpptNat,
  UsbMode,
} from "@/types/ip-passthrough";

// MAC source: "automatic" = FF:FF:FF:FF:FF:FF (first connected device), "manual" = text input
type MacSource = "automatic" | "manual";

// Local-only types — descriptive strings avoid Radix Select "0"-as-falsy bug
type NatMode = "nat-on" | "nat-off";
type UsbModeLocal = "rmnet" | "ecm" | "mbim" | "rndis";

const USB_MODE_TO_API: Record<UsbModeLocal, string> = {
  rmnet: "0",
  ecm: "1",
  mbim: "2",
  rndis: "3",
};
const USB_MODE_FROM_API: Record<string, UsbModeLocal> = {
  "0": "rmnet",
  "1": "ecm",
  "2": "mbim",
  "3": "rndis",
};

const IPPassthroughCard = () => {
  const {
    passthroughMode,
    targetMac,
    ipptNat,
    usbMode,
    dnsProxy,
    isLoading,
    isSaving,
    error,
    saveSettings,
    refresh,
  } = useIpPassthrough();

  // Local form state — NatMode and UsbModeLocal use descriptive strings to
  // avoid Radix Select treating "0" as falsy and showing the placeholder
  const [localMode, setLocalMode] = useState<PassthroughMode>("disabled");
  const [localMacSource, setLocalMacSource] = useState<MacSource>("automatic");
  const [localMacInput, setLocalMacInput] = useState<string>("");
  const [localIpptNat, setLocalIpptNat] = useState<NatMode | "">("");
  const [localUsbMode, setLocalUsbMode] = useState<UsbModeLocal>("ecm");
  const [localDnsProxy, setLocalDnsProxy] = useState<DnsProxy>("disabled");

  // Pre-save confirmation dialog
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  // Sync form state when server data arrives
  useEffect(() => {
    if (passthroughMode !== null) setLocalMode(passthroughMode);
    if (ipptNat !== null) setLocalIpptNat(ipptNat === "1" ? "nat-on" : "nat-off");
    if (usbMode !== null) setLocalUsbMode(USB_MODE_FROM_API[usbMode] ?? "ecm");
    if (dnsProxy !== null) setLocalDnsProxy(dnsProxy);

    // Initialise MAC source only when mode is active
    if (
      passthroughMode !== null &&
      passthroughMode !== "disabled" &&
      targetMac !== null
    ) {
      if (targetMac === "" || targetMac === "FF:FF:FF:FF:FF:FF") {
        setLocalMacSource("automatic");
        setLocalMacInput("");
      } else {
        setLocalMacSource("manual");
        setLocalMacInput(targetMac);
      }
    }
  }, [passthroughMode, targetMac, ipptNat, usbMode, dnsProxy]);

  // Resolved MAC to send to backend
  const resolvedMac =
    localMacSource === "automatic" ? "FF:FF:FF:FF:FF:FF" : localMacInput;

  const macRequired = localMode !== "disabled";
  const macValid =
    !macRequired ||
    localMacSource === "automatic" ||
    /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/.test(localMacInput);

  const resetToServer = () => {
    if (passthroughMode !== null) setLocalMode(passthroughMode);
    if (ipptNat !== null) setLocalIpptNat(ipptNat === "1" ? "nat-on" : "nat-off");
    if (usbMode !== null) setLocalUsbMode(USB_MODE_FROM_API[usbMode] ?? "ecm");
    if (dnsProxy !== null) setLocalDnsProxy(dnsProxy);

    if (passthroughMode !== "disabled" && targetMac) {
      if (targetMac === "" || targetMac === "FF:FF:FF:FF:FF:FF") {
        setLocalMacSource("automatic");
        setLocalMacInput("");
      } else {
        setLocalMacSource("manual");
        setLocalMacInput(targetMac);
      }
    } else {
      setLocalMacSource("automatic");
      setLocalMacInput("");
    }
  };

  // Step 1: validate → open confirm dialog
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();

    if (!macValid) {
      toast.error("Enter a valid MAC address (XX:XX:XX:XX:XX:XX)");
      return;
    }

    setShowConfirmDialog(true);
  };

  // Step 2: user confirmed → apply + reboot
  const handleConfirmedApply = async () => {
    setShowConfirmDialog(false);

    const success = await saveSettings({
      passthrough_mode: localMode,
      target_mac: macRequired ? resolvedMac : "",
      ippt_nat: (localIpptNat === "nat-on" ? "1" : "0") as IpptNat,
      usb_mode: USB_MODE_TO_API[localUsbMode] as UsbMode,
      dns_proxy: localDnsProxy,
    });

    if (success) {
      toast.success("Settings applied — device is rebooting…");
    } else {
      toast.error("Failed to save IP Passthrough settings");
    }
  };

  // Format MAC input: strip non-hex, uppercase, insert colons every 2 chars
  const handleMacInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
    const formatted = raw.match(/.{1,2}/g)?.join(":") ?? raw;
    setLocalMacInput(formatted.slice(0, 17));
  };

  // Loading skeleton
  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>IP Passthrough Configuration</CardTitle>
          <CardDescription>
            Assign the modem's public IP directly to a downstream device,
            bypassing the router's NAT.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            <div className="grid @md/card:grid-cols-2 grid-cols-1 gap-4">
              <div className="space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-9 w-full" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-9 w-full" />
              </div>
            </div>
            <div className="grid @md/card:grid-cols-2 grid-cols-1 gap-4">
              <div className="space-y-2">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-9 w-full" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-9 w-full" />
              </div>
            </div>
            <div className="grid @md/card:grid-cols-2 grid-cols-1 gap-4">
              <div className="space-y-2">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-9 w-full" />
              </div>
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-9 w-28" />
              <Skeleton className="h-9 w-9" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>IP Passthrough Configuration</CardTitle>
        <CardDescription>
          Assign the modem's public IP directly to a downstream device,
          bypassing the router's NAT.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="flex items-center justify-between gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 mb-4">
            <p className="text-sm text-destructive">{error}</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0 text-destructive hover:text-destructive"
              onClick={refresh}
            >
              Retry
            </Button>
          </div>
        )}
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <div className="w-full">
            <FieldSet>
              <FieldGroup>
                <div className="grid @md/card:grid-cols-2 grid-cols-1 gap-4">
                  {/* Field 1: Passthrough Mode */}
                  <Field>
                    <FieldLabel>IP Passthrough Mode</FieldLabel>
                    <Select
                      name="ippt_mode"
                      value={localMode}
                      onValueChange={(v) => setLocalMode(v as PassthroughMode)}
                      disabled={isSaving}
                    >
                      <SelectTrigger aria-label="IP Passthrough mode">
                        <SelectValue placeholder="Select Mode" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="disabled">
                          Disabled (Router Mode)
                        </SelectItem>
                        <SelectItem value="eth">Ethernet (ETH)</SelectItem>
                        <SelectItem value="usb">USB Tethering</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>

                  {/* Field 2: Target Device MAC (hidden when disabled) */}
                  <Field>
                    <FieldLabel>Target Device (MAC)</FieldLabel>
                    <AnimatePresence mode="wait">
                      {localMode === "disabled" ? (
                        <motion.div
                          key="mac-disabled"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.2 }}
                        >
                          <Select disabled>
                            <SelectTrigger aria-label="Target Device MAC">
                              <SelectValue placeholder="N/A — Router Mode" />
                            </SelectTrigger>
                            <SelectContent />
                          </Select>
                        </motion.div>
                      ) : (
                        <motion.div
                          key="mac-active"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="flex flex-col gap-2"
                        >
                          <Select
                            name="mac_source"
                            value={localMacSource}
                            onValueChange={(v) =>
                              setLocalMacSource(v as MacSource)
                            }
                            disabled={isSaving}
                          >
                            <SelectTrigger aria-label="MAC source" className="w-full">
                              <SelectValue placeholder="Select Target" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="automatic">
                                Automatic — First Connected Device
                              </SelectItem>
                              <SelectItem value="manual">
                                Enter Manually…
                              </SelectItem>
                            </SelectContent>
                          </Select>

                          {/* Manual MAC text input */}
                          <AnimatePresence mode="wait">
                            {localMacSource === "manual" && (
                              <motion.div
                                key="manual-mac-input"
                                initial={{ opacity: 0, y: -10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                transition={{
                                  duration: 0.3,
                                  ease: [0.16, 1, 0.3, 1],
                                }}
                              >
                                <Input
                                  aria-label="MAC address"
                                  placeholder="XX:XX:XX:XX:XX:XX"
                                  className="font-mono uppercase placeholder:normal-case"
                                  value={localMacInput}
                                  onChange={handleMacInputChange}
                                  maxLength={17}
                                  disabled={isSaving}
                                />
                                <p className="text-xs text-muted-foreground mt-1">
                                  Enter the MAC address of the device that will
                                  receive the WAN IP.
                                </p>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </Field>
                </div>

                <div className="grid @md/card:grid-cols-2 grid-cols-1 grid-flow-row gap-4">
                  {/* Field 3: IPPT NAT Mode */}
                  <Field>
                    <FieldLabel>NAT Mode (Network Address Translation)</FieldLabel>
                    <Select
                      value={
                        localIpptNat ||
                        (ipptNat !== null
                          ? ipptNat === "1"
                            ? "nat-on"
                            : "nat-off"
                          : "")
                      }
                      onValueChange={(v) => setLocalIpptNat(v as NatMode)}
                      disabled={isSaving}
                    >
                      <SelectTrigger aria-label="NAT mode">
                        <SelectValue placeholder="Select NAT Mode" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="nat-on">
                          With NAT (Recommended)
                        </SelectItem>
                        <SelectItem value="nat-off">Without NAT</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>

                  {/* Field 4: USB Modem Protocol */}
                  <Field>
                    <FieldLabel>USB Connection Mode</FieldLabel>
                    <Select
                      value={localUsbMode}
                      onValueChange={(v) => setLocalUsbMode(v as UsbModeLocal)}
                      disabled={isSaving}
                    >
                      <SelectTrigger aria-label="USB Connection Mode">
                        <SelectValue placeholder="Choose USB Modem Protocol" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="rmnet">RMNET (QMI)</SelectItem>
                        <SelectItem value="ecm">ECM (Universal)</SelectItem>
                        <SelectItem value="mbim">MBIM (Windows)</SelectItem>
                        <SelectItem value="rndis">RNDIS (Legacy)</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>

                <div className="grid @md/card:grid-cols-2 grid-cols-1 grid-flow-row gap-4">
                  {/* Field 5: DNS Offloading */}
                  <Field>
                    <FieldLabel>DNS Proxy</FieldLabel>
                    <Select
                      name="dns_mode"
                      value={localDnsProxy}
                      onValueChange={(v) => setLocalDnsProxy(v as DnsProxy)}
                      disabled={isSaving}
                    >
                      <SelectTrigger aria-label="DNS proxy">
                        <SelectValue placeholder="Select DNS mode" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="disabled">
                          Disabled (Recommended)
                        </SelectItem>
                        <SelectItem value="enabled">
                          Enabled (Use Modem DNS)
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              </FieldGroup>
            </FieldSet>
          </div>

          <div className="flex items-center gap-x-2">
            <Button type="submit" disabled={isSaving || !macValid}>
              {isSaving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Applying…
                </>
              ) : (
                "Save Settings"
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={resetToServer}
              disabled={isSaving}
              aria-label="Reset to saved values"
            >
              <RotateCcwIcon />
            </Button>
          </div>
        </form>

        {/* Pre-save confirmation dialog */}
        <AlertDialog
          open={showConfirmDialog}
          onOpenChange={setShowConfirmDialog}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Device Will Reboot Immediately
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p>
                    Applying these changes will save the configuration and
                    immediately reboot the device.
                  </p>
                  {localMode !== "disabled" && (
                    <p className="font-medium text-foreground">
                      Once IP Passthrough is active, the device&apos;s local
                      gateway will no longer be reachable. Make sure you have an
                      active Tailscale connection or another out-of-band method
                      to access the device after reboot.
                    </p>
                  )}
                  <p>This setting persists across reboots.</p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleConfirmedApply}>
                Apply &amp; Reboot
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
};

export default IPPassthroughCard;
