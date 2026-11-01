import { Suspense } from "react";

import CustomProfileComponent from "@/components/cellular/custom-profiles/custom-profile";

// Suspense is required: the page reads `?action=` deep links through
// useSearchParams, which fails the static export build when unwrapped.
const CustomProfilePage = () => (
  <Suspense>
    <CustomProfileComponent />
  </Suspense>
);

export default CustomProfilePage;
