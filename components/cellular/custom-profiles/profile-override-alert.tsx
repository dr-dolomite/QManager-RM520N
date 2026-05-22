"use client";

import { InfoIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

// =============================================================================
// ProfileOverrideAlert — Reusable "managed by Custom SIM Profile" banner
// =============================================================================
// Used on every screen that is gated by an active Custom SIM Profile (APN,
// TTL/HL, Scenarios, Band Locking). The matching gate logic — which decides
// *when* to show this — lives in each screen and is keyed off the active
// profile's settings (apn.name, ttl/hl, scenario_id).
//
// Style is intentionally identical to the inline Alert used historically in
// TTLSettingsCard so the four gated screens read as a single visual pattern.
// =============================================================================

interface ProfileOverrideAlertProps {
  /** Display name of the active profile (e.g., "Home LTE"). */
  profileName: string;
  /** What is being controlled by the profile. Used as the leading clause —
   *  e.g., "APN configuration" → "APN configuration is managed by the …". */
  controls: string;
}

export function ProfileOverrideAlert({
  profileName,
  controls,
}: ProfileOverrideAlertProps) {
  return (
    <Alert className="mb-4">
      <InfoIcon className="size-4" />
      <AlertDescription>
        <p>
          {controls} is managed by the{" "}
          <span className="font-semibold">{profileName}</span> Custom SIM
          Profile.
        </p>
      </AlertDescription>
    </Alert>
  );
}

export default ProfileOverrideAlert;
