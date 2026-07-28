"use client";

import { Trans, useTranslation } from "react-i18next";
import { Banner } from "@/components/ui/banner";

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

  // Role 07 in the banner system: the neutral, page-scoped note. No CTA and no
  // dismiss — this is a standing condition of the page, and it goes away only
  // when the profile stops owning the setting. `role="note"`, neutral
  // `surface-container` skin and the one unfilled glyph disc all come from the
  // primitive.
  return (
    <Banner
      role="override"
      className="mb-4"
      title={
        <Trans
          i18nKey="profile_override.banner"
          ns="common"
          values={{ controls, profile_name: profileName }}
          components={{ strong: <strong className="font-semibold" /> }}
        >
          {t("profile_override.banner", {
            controls,
            profile_name: profileName,
          })}
        </Trans>
      }
      description={note}
    />
  );
}

export default ProfileOverrideAlert;
