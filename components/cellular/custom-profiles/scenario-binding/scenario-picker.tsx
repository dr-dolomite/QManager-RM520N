"use client";

import Link from "next/link";
import { PlusIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { ScenarioOption } from "@/hooks/use-scenario-list";

// =============================================================================
// ScenarioPicker — Select listing built-in + custom scenarios
// =============================================================================
// Shared by the default-scenario picker and each schedule block's selector.
// Resolves an unknown/stale id to a "(deleted scenario)" item so a dangling
// block.scenario never renders blank.
// =============================================================================

interface ScenarioPickerProps {
  id?: string;
  value: string;
  scenarios: ScenarioOption[];
  loading?: boolean;
  disabled?: boolean;
  "aria-label"?: string;
  onChange: (id: string) => void;
}

export function ScenarioPicker({
  id,
  value,
  scenarios,
  loading,
  disabled,
  onChange,
  ...rest
}: ScenarioPickerProps) {
  const { t } = useTranslation("cellular");

  if (loading) {
    return <Skeleton className="h-9 w-full rounded-md" />;
  }

  const known = scenarios.some((s) => s.id === value);

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} aria-label={rest["aria-label"]}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {scenarios.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {s.name}
          </SelectItem>
        ))}
        {/* Render the current value as a fallback item when it no longer
            resolves to a known scenario (e.g. the custom scenario was deleted),
            so the Select still shows something selected. */}
        {!known && value && (
          <SelectItem value={value}>
            {t("custom_profiles.form.scenario.deleted_scenario")}
          </SelectItem>
        )}

        {/* Pinned action: leaves the picker and opens the full scenarios
            editor. Rendered as a Link (not a SelectItem) so it fires a
            navigation instead of becoming the selected value. */}
        <SelectSeparator />
        <Link
          href="/cellular/custom-profiles/connection-scenarios?create=1"
          className="text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground relative flex w-full cursor-pointer items-center gap-2 rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none transition-colors"
        >
          <PlusIcon className="size-4 shrink-0" />
          {t("custom_profiles.form.scenario.create_new")}
        </Link>
      </SelectContent>
    </Select>
  );
}
