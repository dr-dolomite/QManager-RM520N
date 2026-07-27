"use client";

import React from "react";
import { motion, useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";
import {
  AlertCircleIcon,
  InfoIcon,
  Loader2Icon,
  PlusIcon,
  SparklesIcon,
  TriangleAlertIcon,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SuggestionView } from "@/hooks/use-profile-suggestions";

// =============================================================================
// SuggestedProfiles — "Recommended for your SIM"
// =============================================================================
// A section that renders profiles which DO NOT EXIST YET. It sits below the
// saved-profiles list rather than interleaving synthetic rows into it, because
// those rows would be counted by the list's badge, prefetched by its detail
// loader (firing CGI GETs for ids that resolve to nothing), and wired to
// activate/delete endpoints that only accept real ids.
//
// The visual contract: everything a real profile row shows, inside a DASHED
// container with an info-toned "Suggested" badge. Dashed is the structural
// signal that this is not saved state — colour alone would not carry it, and
// the muted/MinusCircle treatment is reserved for "deliberately disabled".
// =============================================================================

const STAGGER_STEP_S = 0.04;

export interface SuggestedProfilesProps {
  /** Suggestions to render, already band-intersected. Empty renders nothing. */
  suggestions: SuggestionView[];
  /** Suggestion id currently being created, or null. */
  creatingId: string | null;
  /** Error from the last create attempt. */
  error?: string | null;
  /** Materialize a suggestion as a real profile. */
  onCreate: (suggestionId: string) => void;
}

const SuggestedProfiles = ({
  suggestions,
  creatingId,
  error = null,
  onCreate,
}: SuggestedProfilesProps) => {
  const { t } = useTranslation("cellular");
  const reduceMotion = useReducedMotion();
  const headingId = React.useId();

  if (suggestions.length === 0) return null;

  // Both notes below are conditional on what is actually on screen.
  //
  // The ambiguity warning applies only where two suggestions share a PLMN and
  // the user genuinely has to choose (T-Mobile/TMHI, Globe/GOMO). Showing it
  // above a single unambiguous card would invent a decision that isn't there.
  //
  // The band rationale keys off the RECIPE, not the intersected result: a
  // suggestion that recommends bands still deserves the explanation even when
  // none survived the modem's supported-band check, because the "Auto" pills
  // it renders are the outcome that paragraph accounts for.
  const hasAmbiguity = suggestions.some((v) => v.suggestion.ambiguous_plan);
  const hasBandRecipe = suggestions.some(
    (v) =>
      v.suggestion.nsa_nr_bands.length > 0 || v.suggestion.sa_nr_bands.length > 0,
  );

  return (
    // mt-4 matches the coordinator grid's gap-4. It lives here rather than on a
    // wrapper in the coordinator because this component returns null when there
    // is nothing to suggest — a wrapper would leave stray spacing behind.
    <section aria-labelledby={headingId} className="mt-4">
      <Card className="@container/card">
        <CardHeader>
          <CardTitle id={headingId}>
            {t("custom_profiles.suggestions.title")}
          </CardTitle>
          <CardDescription>
            {t("custom_profiles.suggestions.description")}
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-3">
          {/* Plan ambiguity. Sibling suggestions on a shared PLMN are
              indistinguishable over the air, so this is framed as the user's
              choice, never as a detection result. */}
          {hasAmbiguity && (
            <div className="text-warning bg-warning/10 flex items-start gap-2 rounded-md p-2 text-xs">
              <TriangleAlertIcon className="mt-px size-3.5 shrink-0" />
              <span>{t("custom_profiles.suggestions.plan_ambiguity")}</span>
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertCircleIcon className="size-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="grid gap-3 @3xl/card:grid-cols-2">
            {suggestions.map((view, i) => (
              <SuggestionCard
                key={view.suggestion.id}
                view={view}
                index={i}
                reduceMotion={!!reduceMotion}
                isCreating={creatingId === view.suggestion.id}
                disabled={creatingId !== null}
                onCreate={() => onCreate(view.suggestion.id)}
              />
            ))}
          </div>

          {/* Honest rationale. These lines carry the safety warning: a band
              lock narrows the radio, and both are undone by deactivating. */}
          <div className="text-muted-foreground flex flex-col gap-1.5 text-xs">
            {hasBandRecipe && (
              <p className="flex items-start gap-2">
                <InfoIcon className="mt-px size-3.5 shrink-0" />
                <span>{t("custom_profiles.suggestions.rationale_bands")}</span>
              </p>
            )}
            <p className="flex items-start gap-2">
              <InfoIcon className="mt-px size-3.5 shrink-0" />
              <span>{t("custom_profiles.suggestions.rationale_ttl")}</span>
            </p>
          </div>
        </CardContent>
      </Card>
    </section>
  );
};

// -----------------------------------------------------------------------------
// One suggestion — mirrors the saved-profile row, dashed to read as unsaved.
// -----------------------------------------------------------------------------
const SuggestionCard = ({
  view,
  index,
  reduceMotion,
  isCreating,
  disabled,
  onCreate,
}: {
  view: SuggestionView;
  index: number;
  reduceMotion: boolean;
  isCreating: boolean;
  disabled: boolean;
  onCreate: () => void;
}) => {
  const { t } = useTranslation("cellular");
  const { suggestion, nsaBands, saBands } = view;
  const recommendsBands =
    suggestion.nsa_nr_bands.length > 0 || suggestion.sa_nr_bands.length > 0;

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.3,
        delay: index * STAGGER_STEP_S,
        ease: [0.16, 1, 0.3, 1],
      }}
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-dashed p-3",
        "border-info/40 bg-info/5",
      )}
    >
      {/* Identity + suggested badge */}
      <div className="flex items-start justify-between gap-3">
        <div className="grid min-w-0 gap-0.5">
          <span className="truncate text-sm font-semibold">
            {suggestion.label}
          </span>
          <span className="text-muted-foreground truncate text-xs">
            {suggestion.mno}
          </span>
        </div>
        <Badge
          variant="outline"
          className="border-info/30 bg-info/15 text-info hover:bg-info/20 shrink-0"
        >
          <SparklesIcon className="size-3" />
          {t("custom_profiles.suggestions.badge")}
        </Badge>
      </div>

      {/* Config readout — same pill vocabulary as a saved profile row. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Pill>
          {t("custom_profiles.pills.apn", { name: suggestion.apn_name })}
        </Pill>
        <Pill>{t("custom_profiles.pills.cid", { cid: suggestion.cid })}</Pill>
        <Pill>{t("custom_profiles.pills.ip_dual")}</Pill>
        {suggestion.ttl > 0 && (
          <Pill>{t("custom_profiles.pills.ttl", { value: suggestion.ttl })}</Pill>
        )}
        {suggestion.hl > 0 && (
          <Pill>{t("custom_profiles.pills.hl", { value: suggestion.hl })}</Pill>
        )}
      </div>

      {/* Band lock — rendered only when this recipe actually recommends bands.
          Most carriers here are APN + TTL/HL only, and a row of "Auto / Auto"
          pills on those would imply a band decision was made when none was.
          Where a recipe DOES recommend bands, "Auto" is meaningful: it means
          the modem did not confirm support, so no lock will be written. */}
      {recommendsBands && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Pill tone="info">
            {nsaBands.length > 0
              ? t("custom_profiles.suggestions.bands_nsa", {
                  bands: nsaBands.join(", "),
                })
              : t("custom_profiles.suggestions.bands_nsa_auto")}
          </Pill>
          <Pill tone="info">
            {saBands.length > 0
              ? t("custom_profiles.suggestions.bands_sa", {
                  bands: saBands.join(", "),
                })
              : t("custom_profiles.suggestions.bands_sa_auto")}
          </Pill>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 pt-0.5">
        <span className="text-muted-foreground text-xs">
          {t("custom_profiles.suggestions.not_saved_yet")}
        </span>
        <Button
          size="sm"
          className="shrink-0"
          onClick={onCreate}
          disabled={disabled}
          aria-label={t("custom_profiles.suggestions.create_aria", {
            name: suggestion.label,
          })}
        >
          {isCreating ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <PlusIcon className="size-4" />
          )}
          {isCreating
            ? t("custom_profiles.suggestions.creating")
            : t("custom_profiles.suggestions.create")}
        </Button>
      </div>
    </motion.div>
  );
};

// -----------------------------------------------------------------------------
// Config pill — mirrors the saved-profile list's vocabulary so the two read
// identically. Kept local: the list's copy is owned by another surface.
// -----------------------------------------------------------------------------
const Pill = ({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "info";
}) => (
  <span
    className={cn(
      "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium tabular-nums",
      tone === "info"
        ? "border-info/30 bg-info/10 text-info"
        : "border-border bg-muted/40 text-muted-foreground",
    )}
  >
    {children}
  </span>
);

export default SuggestedProfiles;
