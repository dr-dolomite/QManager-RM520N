import NetworkEventsCard from "./network-events-card";

const NetworkEventsComponent = () => {
  return (
    <div className="@container/main mx-auto p-2">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Network Events</h1>
        <p className="text-muted-foreground">
          Band changes, connection drops, signal transitions, and other
          cellular events logged by the poller.
        </p>
      </div>
      <div className="grid grid-cols-1 @xl/main:grid-cols-2 grid-flow-row gap-4">
        <NetworkEventsCard />
      </div>
    </div>
  );
};

export default NetworkEventsComponent;
