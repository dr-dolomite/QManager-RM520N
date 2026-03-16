import SystemLogsCard from "./system-logs-card";

const SystemLogsComponent = () => {
  return (
    <div className="@container/main mx-auto p-2">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">System Logs</h1>
        <p className="text-muted-foreground">
          Filter and search QManager event logs.
        </p>
      </div>
      <div className="grid grid-cols-1 grid-flow-row gap-4">
        <SystemLogsCard />
      </div>
    </div>
  );
};

export default SystemLogsComponent;
