"use client";

import { useState } from "react";
import WanProfileListCard from "./wan-profile-list";
import WanProfileEditCard from "./wan-profile-edit";
import MBNCard from "./mbn-card";
import { useWanProfiles } from "@/hooks/use-wan-profiles";
import { useMbnSettings } from "@/hooks/use-mbn-settings";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertCircleIcon, RefreshCwIcon } from "lucide-react";

const APNSettingsComponent = () => {
  const {
    profiles,
    dataSource,
    isLoading,
    isSaving,
    error,
    saveProfile,
    toggleProfile,
    refresh,
  } = useWanProfiles();

  const {
    profiles: mbnProfiles,
    autoSel,
    isLoading: mbnLoading,
    isSaving: mbnSaving,
    saveMbn,
  } = useMbnSettings();

  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const editingProfile =
    editingIndex !== null
      ? profiles?.find((p) => p.index === editingIndex) ?? null
      : null;

  return (
    <div className="@container/main mx-auto p-2">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">APN Management</h1>
        <p className="text-muted-foreground">
          Manage cellular APN connection profiles and carrier configuration.
        </p>
      </div>

      {error && !isLoading && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircleIcon />
          <AlertTitle>Failed to load WAN profiles</AlertTitle>
          <AlertDescription className="flex items-center gap-2">
            <span>Displayed values may be outdated.</span>
            <Button variant="outline" size="sm" onClick={() => refresh()}>
              <RefreshCwIcon className="size-3.5" />
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 @3xl/main:grid-cols-2 grid-flow-row gap-4">
        <WanProfileListCard
          profiles={profiles}
          isLoading={isLoading}
          isSaving={isSaving}
          onEdit={setEditingIndex}
          onToggle={toggleProfile}
          editingIndex={editingIndex}
        />

        {editingProfile !== null ? (
          <WanProfileEditCard
            profile={editingProfile}
            isSaving={isSaving}
            dataSource={dataSource}
            onSave={saveProfile}
            onCancel={() => setEditingIndex(null)}
          />
        ) : (
          <MBNCard
            profiles={mbnProfiles}
            autoSel={autoSel}
            isLoading={mbnLoading}
            isSaving={mbnSaving}
            onSave={saveMbn}
          />
        )}
      </div>
    </div>
  );
};

export default APNSettingsComponent;
