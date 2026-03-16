"use client";

import { useTailscale } from "@/hooks/use-tailscale";
import { TailscaleConnectionCard } from "./tailscale-connection-card";
import { TailscalePeersCard } from "./tailscale-peers-card";

const TailscaleComponent = () => {
  const hookData = useTailscale();

  return (
    <div className="@container/main mx-auto p-2">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Tailscale VPN</h1>
        <p className="text-muted-foreground">
          Manage your Tailscale mesh VPN connection and network peers.
        </p>
      </div>
      <div className="grid grid-cols-1 @xl/main:grid-cols-2 grid-flow-row gap-4">
        <TailscaleConnectionCard {...hookData} />
        <TailscalePeersCard
          status={hookData.status}
          isLoading={hookData.isLoading}
          error={hookData.error}
        />
      </div>
    </div>
  );
};

export default TailscaleComponent;
