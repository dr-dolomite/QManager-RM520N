import React from "react";
import SystemLogsCard from "./system-logs-card";

const SystemLogsComponent = () => {
  return (
    <div className="@container/main mx-auto p-2">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">System Logs</h1>
        <p className="text-muted-foreground max-w-5xl">
          View and manage QManager system logs. Filter by level, component, or
          search for specific events.
        </p>
      </div>
      <div className="grid grid-cols-1 grid-flow-row gap-4 *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card *:data-[slot=card]:bg-linear-to-t *:data-[slot=card]:shadow-xs">
        <SystemLogsCard />
      </div>
    </div>
  );
};

export default SystemLogsComponent;
