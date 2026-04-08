"use client";

import { useSystemSettings } from "@/hooks/use-system-settings";
import SystemSettingsCard from "@/components/system-settings/system-settings-card";
import ScheduledOperationsCard from "@/components/system-settings/scheduled-operations-card";
import SSHPasswordCard from "@/components/system-settings/ssh-password-card";

const SystemSettings = () => {
  const hookData = useSystemSettings();

  return (
    <div className="@container/main mx-auto p-2">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">System Settings</h1>
      </div>
      <div className="grid grid-cols-1 @3xl/main:grid-cols-2 grid-flow-row gap-4">
        <SystemSettingsCard {...hookData} />
        <ScheduledOperationsCard {...hookData} />
        <SSHPasswordCard />
      </div>
    </div>
  );
};

export default SystemSettings;
