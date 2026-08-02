"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";

import ConnectionScenariosCard from "./connection-scenario-card";

// =============================================================================
// ConnectionScenariosComponent — the scenarios card's deep-link adapter
// =============================================================================
// This used to be the Connection Scenarios PAGE SHELL: an `h1`, a description,
// and its own `staggerContainer` clock. All three are gone. Scenarios are no
// longer a destination — the card mounts inside the Custom SIM Profiles page,
// which owns the page title and the cascade, and a second `h1` (or a second
// stagger clock) inside a column of somebody else's page is a defect in both
// systems at once.
//
// What is left is the one thing the card genuinely cannot do for itself: read
// the URL. `?action=create-scenario` opens the "New Scenario" dialog on mount —
// the deep link the SIM Profile form's scenario picker fires, renamed from the
// old route's `?action=create` because the merged page's query string is now
// shared with the profiles UI and a bare `create` would be ambiguous about which
// thing it creates.
//
// `useSearchParams()` forces a client-side bailout, so the CONSUMER must wrap
// this in `<Suspense>` — this is a static export (`output: "export"`), and Next
// fails the build outright on an unwrapped read.
// =============================================================================

/** The query value that opens the New Scenario dialog on the merged page. */
export const SCENARIO_CREATE_ACTION = "create-scenario";

const ConnectionScenariosComponent = () => {
  const searchParams = useSearchParams();
  const autoOpenAdd = searchParams.get("action") === SCENARIO_CREATE_ACTION;

  return <ConnectionScenariosCard autoOpenAddDialog={autoOpenAdd} />;
};

export default ConnectionScenariosComponent;
