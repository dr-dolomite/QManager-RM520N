import { Suspense } from "react";

import SmsCenterComponent from "@/components/cellular/sms/sms-center";

// The open thread is read from `?thread=` (a static export cannot enumerate
// arbitrary sender addresses for a `[addr]` segment), and `useSearchParams`
// must sit inside a Suspense boundary for the page to prerender. Same shape as
// `app/local-network/traffic-engine/page.tsx`.
const SmsCenterPage = () => {
  return (
    <Suspense fallback={null}>
      <SmsCenterComponent />
    </Suspense>
  );
};

export default SmsCenterPage;
