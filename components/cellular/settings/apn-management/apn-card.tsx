"use client";

import React, { useState, useEffect } from "react";
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
import { Loader2, RotateCcwIcon } from "lucide-react";
import {
  AUTO_APN_PRESETS,
  getAutoApnPreset,
} from "@/constants/mno-presets";
import type { CurrentApnProfile } from "@/types/sim-profile";
import type { ApnSaveRequest } from "@/types/apn-settings";

interface APNSettingsCardProps {
  profiles: CurrentApnProfile[] | null;
  activeCid: number | null;
  isLoading: boolean;
  isSaving: boolean;
  onSave: (request: ApnSaveRequest) => Promise<boolean>;
}

const APNSettingsCard = ({
  profiles,
  activeCid,
  isLoading,
  isSaving,
  onSave,
}: APNSettingsCardProps) => {
  // Form state
  const [selectedCid, setSelectedCid] = useState<string>("");
  const [activeApn, setActiveApn] = useState<string>("");
  const [pdpType, setPdpType] = useState<string>("");
  const [autoApnPreset, setAutoApnPreset] = useState<string>("none");

  // TTL/HL from Auto APN preset (hidden, included in save request)
  const [pendingTtl, setPendingTtl] = useState<number>(0);
  const [pendingHl, setPendingHl] = useState<number>(0);

  // Sync form state from fetched data
  useEffect(() => {
    if (profiles && activeCid !== null) {
      const activeProfile = profiles.find((p) => p.cid === activeCid);
      setSelectedCid(String(activeCid));
      setActiveApn(activeProfile?.apn ?? "");
      setPdpType(activeProfile?.pdp_type ?? "IPV4V6");
      setAutoApnPreset("none");
      setPendingTtl(0);
      setPendingHl(0);
    }
  }, [profiles, activeCid]);

  // When user selects a different Carrier Profile (CID)
  const handleCidChange = (cidStr: string) => {
    setSelectedCid(cidStr);
    const profile = profiles?.find((p) => p.cid === Number(cidStr));
    if (profile) {
      setActiveApn(profile.apn);
      setPdpType(profile.pdp_type);
    }
    setAutoApnPreset("none");
    setPendingTtl(0);
    setPendingHl(0);
  };

  // When user selects an Auto APN preset
  const handleAutoApnChange = (presetId: string) => {
    setAutoApnPreset(presetId);

    if (presetId === "none") {
      // Revert to current CID's values
      const profile = profiles?.find((p) => p.cid === Number(selectedCid));
      if (profile) {
        setActiveApn(profile.apn);
        setPdpType(profile.pdp_type);
      }
      setPendingTtl(0);
      setPendingHl(0);
      return;
    }

    const preset = getAutoApnPreset(presetId);
    if (preset) {
      setActiveApn(preset.apn_name);
      setSelectedCid(String(preset.cid));
      setPendingTtl(preset.ttl);
      setPendingHl(preset.hl);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profiles) return;

    const request: ApnSaveRequest = {
      cid: Number(selectedCid),
      pdp_type: pdpType,
      apn: activeApn,
    };

    if (pendingTtl > 0) request.ttl = pendingTtl;
    if (pendingHl > 0) request.hl = pendingHl;

    const success = await onSave(request);
    if (success) {
      toast.success("APN settings applied successfully");
    } else {
      toast.error("Failed to apply APN settings");
    }
  };

  const handleReset = () => {
    if (profiles && activeCid !== null) {
      const activeProfile = profiles.find((p) => p.cid === activeCid);
      setSelectedCid(String(activeCid));
      setActiveApn(activeProfile?.apn ?? "");
      setPdpType(activeProfile?.pdp_type ?? "IPV4V6");
      setAutoApnPreset("none");
      setPendingTtl(0);
      setPendingHl(0);
    }
  };

  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>APN Settings</CardTitle>
          <CardDescription>
            Configure and manage Access Point Names (APNs) for your cellular
            connections.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            <div className="grid xl:grid-cols-2 grid-cols-1 gap-4">
              <div className="space-y-2">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-9 w-full" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-9 w-full" />
              </div>
            </div>
            <div className="grid xl:grid-cols-2 grid-cols-1 gap-4">
              <div className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-9 w-full" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-24" />
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
        <CardTitle>APN Settings</CardTitle>
        <CardDescription>
          Configure and manage Access Point Names (APNs) for your cellular
          connections.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={handleSave}>
          <div className="w-full">
            <FieldSet>
              <FieldGroup>
                <div className="grid xl:grid-cols-2 grid-cols-1 grid-flow-row gap-4">
                  <Field>
                    <FieldLabel htmlFor="active-apn">Active APN</FieldLabel>
                    <Input
                      id="active-apn"
                      placeholder="Enter Active APN"
                      value={activeApn}
                      onChange={(e) => setActiveApn(e.target.value)}
                      disabled={isSaving}
                      required
                    />
                  </Field>

                  <Field>
                    <FieldLabel>Auto APN</FieldLabel>
                    <Select
                      value={
                        autoApnPreset ||
                        "none"
                      }
                      onValueChange={handleAutoApnChange}
                      disabled={isSaving}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Choose Auto APN" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {AUTO_APN_PRESETS.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.label} Auto APN
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>

                <div className="grid xl:grid-cols-2 grid-cols-1 grid-flow-row gap-4">
                  <Field>
                    <FieldLabel>Carrier Profiles</FieldLabel>
                    <Select
                      value={
                        selectedCid ||
                        (activeCid !== null ? String(activeCid) : "")
                      }
                      onValueChange={handleCidChange}
                      disabled={isSaving}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Choose Carrier Profile" />
                      </SelectTrigger>
                      <SelectContent>
                        {profiles?.map((p) => (
                          <SelectItem key={p.cid} value={String(p.cid)}>
                            CID {p.cid} - {p.apn || "(empty)"}
                            {p.cid === activeCid ? " (Data)" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field>
                    <FieldLabel>IP Protocol</FieldLabel>
                    <Select
                      value={
                        pdpType ||
                        (profiles && activeCid !== null
                          ? profiles.find((p) => p.cid === activeCid)
                              ?.pdp_type ?? "IPV4V6"
                          : "")
                      }
                      onValueChange={setPdpType}
                      disabled={isSaving}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Choose IP Protocol" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="IPV4V6">
                          IPv4 + IPv6 (Default)
                        </SelectItem>
                        <SelectItem value="IP">IPv4 Only</SelectItem>
                        <SelectItem value="IPV6">IPv6 Only</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              </FieldGroup>
            </FieldSet>
          </div>
          <div className="flex items-center gap-x-2">
            <Button type="submit" disabled={isSaving}>
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save Settings"
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleReset}
              disabled={isSaving}
            >
              <RotateCcwIcon />
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};

export default APNSettingsCard;
