import IPPassthroughCard from "./ip-passthrough-card";

const IPPassthroughComponent = () => {
  return (
    <div className="@container/main mx-auto p-2">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">
          IP Passthrough Settings (IPPT)
        </h1>
        <p className="text-muted-foreground">
          Assign the modem&apos;s public IP directly to a connected device,
          bypassing the router&apos;s NAT layer.
        </p>
      </div>
      <div className="grid grid-cols-1 @xl/main:grid-cols-2 grid-flow-row gap-4">
        <IPPassthroughCard />
      </div>
    </div>
  );
};

export default IPPassthroughComponent;
