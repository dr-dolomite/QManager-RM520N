"use client";

import { useSmsForwarding } from "@/hooks/use-sms-forwarding";
import SmsForwardingCard from "./sms-forwarding-card";
import DeliveryHealthCard from "./delivery-health-card";

// The hook is lifted to the center so both cards read one source of truth and
// share a single fetch/poll loop: the left card controls the relay, the right
// card reports on it (live state, preview, test, delivery failures).
const ForwardingCenterComponent = () => {
  const fwd = useSmsForwarding();

  return (
    <div className="@container/main mx-auto p-2">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">SMS Forwarding</h1>
        <p className="text-muted-foreground">
          Relay incoming SMS to another number and watch the delivery health.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:items-stretch">
        <SmsForwardingCard fwd={fwd} />
        <DeliveryHealthCard fwd={fwd} />
      </div>
    </div>
  );
};

export default ForwardingCenterComponent;
