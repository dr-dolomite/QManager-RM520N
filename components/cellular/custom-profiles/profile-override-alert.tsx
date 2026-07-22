"use client";

import { InfoIcon } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "@/components/ui/alert";

// =============================================================================
// ProfileOverrideAlert — Reusable "managed by Custom SIM Profile" banner
// =============================================================================
// Used on every screen that is gated by an active Custom SIM Profile (APN,
// TTL/HL, Scenarios, Band Locking). The matching gate logic — which decides
// *when* to show this — lives in each screen and is keyed off the active
// profile's settings (apn.name, ttl/hl, scenario_id).
//
// The static scaffolding sentence is i18n-wired via common `profile_override.
// banner` (a <Trans> so the profile name stays bold). The `controls` clause and
// `profileName` remain CALLER-provided — several gated pages pass their own
// (already-translated) controls string plus an optional `note`, so the prop
// shape is intentionally preserved.
// =============================================================================

interface ProfileOverrideAlertProps {
  /** Display name of the active profile (e.g., "Home LTE"). */
  profileName: string;
  /** What is being controlled by the profile. Used as the leading clause —
   *  e.g., "APN configuration" → "APN configuration is managed by the …".
   *  Caller-provided (may be raw or already translated). */
  controls: string;
  /** Optional secondary line (e.g., "Scheduled to change at 22:00."). Rendered
   *  muted below the main sentence when present. */
  note?: string;
}

export function ProfileOverrideAlert({
  profileName,
  controls,
  note,
}: ProfileOverrideAlertProps) {
  const { t } = useTranslation("common");

  return (
    <Alert className="mb-4">
      <InfoIcon className="size-4" />
      <AlertDescription>
        <p>
          <Trans
            i18nKey="profile_override.banner"
            ns="common"
            values={{ controls, profile_name: profileName }}
            components={{ strong: <span className="font-semibold" /> }}
          >
            {t("profile_override.banner", {
              controls,
              profile_name: profileName,
            })}
          </Trans>
        </p>
        {note ? (
          <p className="text-muted-foreground text-sm mt-1">{note}</p>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

export default ProfileOverrideAlert;
