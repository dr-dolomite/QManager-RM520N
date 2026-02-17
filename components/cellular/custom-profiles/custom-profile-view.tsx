"use client";

import React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ProfileTable } from "@/components/cellular/custom-profiles/custom-profile-table";
import EmptyProfileViewComponent from "@/components/cellular/custom-profiles/empty-profile";
import { Skeleton } from "@/components/ui/skeleton";
import type { ProfileSummary } from "@/types/sim-profile";

// =============================================================================
// CustomProfileViewComponent — Profile List Card
// =============================================================================

interface CustomProfileViewProps {
  profiles: ProfileSummary[];
  activeProfileId: string | null;
  isLoading: boolean;
  error: string | null;
  onEdit: (id: string) => void;
  onDelete: (id: string) => Promise<boolean>;
  onActivate: (id: string) => void;
  onRefresh: () => void;
}

const CustomProfileViewComponent = ({
  profiles,
  activeProfileId,
  isLoading,
  error,
  onEdit,
  onDelete,
  onActivate,
  onRefresh,
}: CustomProfileViewProps) => {
  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>Saved Profiles</CardTitle>
          <CardDescription>Manage your custom SIM profiles.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (profiles.length === 0) {
    return <EmptyProfileViewComponent onRefresh={onRefresh} />;
  }

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Saved Profiles</CardTitle>
        <CardDescription>
          {profiles.length} profile{profiles.length !== 1 ? "s" : ""} saved.
          {error && (
            <span className="text-destructive ml-2">{error}</span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ProfileTable
          data={profiles}
          activeProfileId={activeProfileId}
          onEdit={onEdit}
          onDelete={onDelete}
          onActivate={onActivate}
        />
      </CardContent>
    </Card>
  );
};

export default CustomProfileViewComponent;
