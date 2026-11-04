import { Suspense } from "react";
import TrafficEngine from "@/components/local-network/traffic-engine/traffic-engine";

// `useSearchParams` (the `?mode=` deep link) needs a Suspense boundary in a static export.
const TrafficEnginePage = () => {
  return (
    <Suspense fallback={null}>
      <TrafficEngine />
    </Suspense>
  );
};

export default TrafficEnginePage;
