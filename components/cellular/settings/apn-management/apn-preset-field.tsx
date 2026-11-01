"use client";

import { useRef, useState, type ComponentProps } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import type { ApnPreset } from "@/lib/apn-presets";
import { cn } from "@/lib/utils";

// =============================================================================
// ApnPresetField: the APN input, plus the carrier's known APNs one click away
// =============================================================================
// A free-text field first: typing works exactly as before and any valid APN
// can be saved. When the SIM's home network has known internet APNs, a
// trailing expand button opens them as a menu, the way a phone's APN screen
// offers them. Picking one fills the draft (the card's Save still commits).
// With no suggestions the button is absent and the field is a plain input.
//
// The network's own APNs come first; brands that ride the network (MVNOs)
// follow under their own heading so the host's entries stay easy to find.
//
// The menu takes the field's width (measured when it opens) so both edges
// line up under the field at every card width.
// =============================================================================

const K = "core_settings.apn.edit.fields.apn.presets";

export interface ApnPresetFieldProps {
  /** Suggestions for the SIM's network; null or empty hides the menu. */
  presets: ApnPreset[] | null;
  /** Called with the chosen suggestion; the caller fills its draft. */
  onPick: (preset: ApnPreset) => void;
  /** The input's props, passed through unchanged. */
  inputProps: ComponentProps<typeof Input>;
}

export function ApnPresetField({ presets, onPick, inputProps }: ApnPresetFieldProps) {
  const { t } = useTranslation("cellular");
  const fieldRef = useRef<HTMLDivElement>(null);
  const [menuWidth, setMenuWidth] = useState<number | undefined>(undefined);
  const hasPresets = !!presets && presets.length > 0;
  const current = String(inputProps.value ?? "").trim().toLowerCase();

  if (!hasPresets) return <Input {...inputProps} />;

  const own = presets.filter((p) => !p.mvno);
  const mvno = presets.filter((p) => p.mvno);

  const renderItem = (preset: ApnPreset) => {
    const selected = preset.apn.toLowerCase() === current;
    return (
      <DropdownMenuItem
        key={`${preset.label}|${preset.apn}`}
        onSelect={() => onPick(preset)}
        className="gap-2 rounded-inline py-2"
      >
        <span className="flex size-4 flex-none items-center justify-center text-primary">
          {selected ? <MaterialSymbol name="check" size={16} /> : null}
        </span>
        <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-medium">
          {preset.label}
        </span>
        <span className="max-w-[45%] flex-none truncate font-mono text-xs text-on-surface-variant">
          {preset.apn}
        </span>
      </DropdownMenuItem>
    );
  };

  return (
    <div ref={fieldRef} className="relative w-full">
      <Input {...inputProps} className={cn(inputProps.className, "pr-11")} />
      <DropdownMenu
        modal={false}
        onOpenChange={(open) => {
          if (open) setMenuWidth(fieldRef.current?.offsetWidth);
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={inputProps.disabled}
            aria-label={t(`${K}.trigger`)}
            className="absolute top-1/2 right-1 -translate-y-1/2 text-on-surface-variant data-[state=open]:text-on-surface"
          >
            <MaterialSymbol name="expand_more" size={20} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          alignOffset={-4}
          sideOffset={10}
          style={{ width: menuWidth }}
          className="min-w-56 rounded-field"
        >
          {own.length > 0 ? (
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs font-medium text-on-surface-variant">
                {t(`${K}.group_network`)}
              </DropdownMenuLabel>
              {own.map(renderItem)}
            </DropdownMenuGroup>
          ) : null}
          {mvno.length > 0 ? (
            <>
              {own.length > 0 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuGroup>
                <DropdownMenuLabel className="text-xs font-medium text-on-surface-variant">
                  {t(`${K}.group_mvno`)}
                </DropdownMenuLabel>
                {mvno.map(renderItem)}
              </DropdownMenuGroup>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
