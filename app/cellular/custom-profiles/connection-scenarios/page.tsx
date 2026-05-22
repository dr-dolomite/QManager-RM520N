import { Suspense } from 'react'
import ConnectionScenariosComponent from '@/components/cellular/custom-profiles/connection-scenarios/connection-scenario'

// Suspense wrapper is required because ConnectionScenariosComponent reads
// `useSearchParams()` to support the ?action=create deep-link from the SIM
// Profile form. Without it Next.js fails the build with a CSR-bailout error.
const ConnectionScenariosPage = () => {
  return (
    <Suspense>
      <ConnectionScenariosComponent />
    </Suspense>
  )
}

export default ConnectionScenariosPage
