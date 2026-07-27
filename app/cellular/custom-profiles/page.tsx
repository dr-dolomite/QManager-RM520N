import { Suspense } from 'react'
import CustomProfileComponent from '@/components/cellular/custom-profiles/custom-profile'

// Suspense wrapper is required because CustomProfileComponent reads
// `useSearchParams()` to support the ?action=create deep-link from the SIM-swap
// banner. Without it Next.js fails the static-export build with a CSR-bailout
// error.
const CustomProfilePage = () => {
  return (
    <Suspense>
      <CustomProfileComponent />
    </Suspense>
  )
}

export default CustomProfilePage
