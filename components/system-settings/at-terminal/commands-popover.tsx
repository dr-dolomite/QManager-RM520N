"use client";

import { useMemo, useState } from "react";
import { ChevronDownIcon, Trash2Icon } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";
import { type ATCommandPreset } from "@/constants/at-commands";

import { groupedDefaults } from "./derive";
import { HEAD_ACTION, HEAD_GLYPH, MANAGE, POPOVER } from "./shapes";

const STORAGE_KEY = "qm_at_custom_commands";
const K = "at_terminal.commands";

function loadCustomCommands(): ATCommandPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ATCommandPreset[];
  } catch {
    return [];
  }
}

function saveCustomCommands(commands: ATCommandPreset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(commands));
  } catch {
    // ignore storage errors
  }
}

interface CommandsPopoverProps {
  onSelect: (command: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}

export default function CommandsPopover({
  onSelect,
  inputRef,
}: CommandsPopoverProps) {
  const { t } = useTranslation("system-settings");
  const [open, setOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

  // Load custom commands once on mount via initializer
  const [customCommands, setCustomCommands] = useState<ATCommandPreset[]>(() =>
    loadCustomCommands(),
  );

  const [newLabel, setNewLabel] = useState("");
  const [newCommand, setNewCommand] = useState("");
  const [addError, setAddError] = useState("");

  const groups = useMemo(() => groupedDefaults(), []);
  const defaultCount = useMemo(
    () => groups.reduce((sum, group) => sum + group.items.length, 0),
    [groups],
  );
  const totalCount = defaultCount + customCommands.length;

  /** Every label on the surface, built-ins translated, for the duplicate test. */
  const allLabels = useMemo(
    () => [
      ...groups.flatMap((group) =>
        group.items.map((preset) => t(`${K}.presets.${preset.id}`)),
      ),
      ...customCommands.map((preset) => preset.label),
    ],
    [groups, customCommands, t],
  );

  const allCommands = useMemo(
    () => [
      ...groups.flatMap((group) => group.items.map((preset) => preset.command)),
      ...customCommands.map((preset) => preset.command),
    ],
    [groups, customCommands],
  );

  const pick = (command: string) => {
    onSelect(command);
    setOpen(false);
    inputRef.current?.focus();
  };

  function handleAdd() {
    const trimmedLabel = newLabel.trim();
    const trimmedCommand = newCommand.trim();

    if (!trimmedLabel || !trimmedCommand) {
      setAddError(t(`${K}.errors.required`));
      return;
    }

    if (!trimmedCommand.toUpperCase().startsWith("AT")) {
      setAddError(t(`${K}.errors.must_start_at`));
      return;
    }

    if (
      allCommands.some(
        (command) => command.toLowerCase() === trimmedCommand.toLowerCase(),
      )
    ) {
      setAddError(t(`${K}.errors.duplicate_command`));
      return;
    }

    if (
      allLabels.some(
        (label) => label.toLowerCase() === trimmedLabel.toLowerCase(),
      )
    ) {
      setAddError(t(`${K}.errors.duplicate_label`));
      return;
    }

    const updated = [
      ...customCommands,
      { label: trimmedLabel, command: trimmedCommand },
    ];
    setCustomCommands(updated);
    saveCustomCommands(updated);
    setNewLabel("");
    setNewCommand("");
    setAddError("");
  }

  function handleDelete(index: number) {
    const updated = customCommands.filter((_, i) => i !== index);
    setCustomCommands(updated);
    saveCustomCommands(updated);
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            aria-expanded={open}
            className={HEAD_ACTION}
          >
            {t(`${K}.trigger`)}
            <ChevronDownIcon className={HEAD_GLYPH} />
          </Button>
        </PopoverTrigger>

        <PopoverContent className={POPOVER.CONTENT} align="end">
          <Command>
            <CommandInput placeholder={t(`${K}.search_placeholder`)} />
            <CommandList className={POPOVER.LIST}>
              <CommandEmpty>{t(`${K}.empty`)}</CommandEmpty>

              {/* The 26 built-ins, split by function. One flat "Default" list
                  asked the reader to scan a paragraph to find a band query. */}
              {groups.map((group) => (
                <CommandGroup
                  key={group.category}
                  heading={t(`${K}.groups.${group.category}`)}
                >
                  {group.items.map((preset) => (
                    <CommandItem
                      key={preset.command}
                      value={t(`${K}.presets.${preset.id}`)}
                      className={POPOVER.ITEM}
                      onSelect={() => pick(preset.command)}
                    >
                      <span className={POPOVER.LABEL}>
                        {t(`${K}.presets.${preset.id}`)}
                      </span>
                      <Tag variant="neutral" className={POPOVER.PREVIEW}>
                        <span className={POPOVER.PREVIEW_TEXT}>
                          {preset.command}
                        </span>
                      </Tag>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}

              {customCommands.length > 0 && (
                <CommandGroup heading={t(`${K}.groups.custom`)}>
                  {customCommands.map((preset) => (
                    <CommandItem
                      key={preset.command}
                      value={preset.label}
                      className={POPOVER.ITEM}
                      onSelect={() => pick(preset.command)}
                    >
                      <span className={POPOVER.LABEL}>{preset.label}</span>
                      <Tag variant="neutral" className={POPOVER.PREVIEW}>
                        <span className={POPOVER.PREVIEW_TEXT}>
                          {preset.command}
                        </span>
                      </Tag>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>

          <div className={POPOVER.FOOT}>
            <span className={POPOVER.COUNT}>
              {t(`${K}.count`, { count: totalCount })}
            </span>
            <button
              type="button"
              className={POPOVER.MANAGE}
              onClick={() => {
                setManageOpen(true);
                setOpen(false);
              }}
            >
              {t(`${K}.manage`)}
            </button>
          </div>
        </PopoverContent>
      </Popover>

      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogContent className={MANAGE.CONTENT}>
          <DialogHeader>
            <DialogTitle>{t(`${K}.manage_dialog.title`)}</DialogTitle>
            <DialogDescription>
              {t(`${K}.manage_dialog.description`)}
            </DialogDescription>
          </DialogHeader>

          {customCommands.length === 0 ? (
            <p className={MANAGE.EMPTY}>{t(`${K}.manage_dialog.empty`)}</p>
          ) : (
            <ul className={MANAGE.LIST}>
              {customCommands.map((preset, index) => (
                <li key={`${preset.command}-${index}`} className={MANAGE.ROW}>
                  <span className={MANAGE.ROW_TEXT}>
                    <span className={MANAGE.ROW_LABEL}>{preset.label}</span>
                    <span className={MANAGE.ROW_COMMAND}>{preset.command}</span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t(`${K}.manage_dialog.delete`, {
                      label: preset.label,
                    })}
                    onClick={() => handleDelete(index)}
                    className={MANAGE.DELETE}
                  >
                    <Trash2Icon className={MANAGE.DELETE_GLYPH} />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <Separator />

          <div className={MANAGE.FORM}>
            <input
              placeholder={t(`${K}.manage_dialog.label_placeholder`)}
              aria-label={t(`${K}.manage_dialog.label_field`)}
              value={newLabel}
              onChange={(e) => {
                setNewLabel(e.target.value);
                setAddError("");
              }}
              className={MANAGE.FIELD}
            />
            <input
              placeholder={t(`${K}.manage_dialog.command_placeholder`)}
              aria-label={t(`${K}.manage_dialog.command_field`)}
              value={newCommand}
              onChange={(e) => {
                setNewCommand(e.target.value);
                setAddError("");
              }}
              className={cn(MANAGE.FIELD, MANAGE.FIELD_MONO)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAdd();
              }}
            />
            <Button type="button" onClick={handleAdd} className={MANAGE.ADD}>
              {t(`${K}.manage_dialog.add`)}
            </Button>
          </div>

          {addError && <p className={MANAGE.ERROR}>{addError}</p>}
        </DialogContent>
      </Dialog>
    </>
  );
}
