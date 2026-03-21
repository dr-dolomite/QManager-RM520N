"use client";

import { useState } from "react";
import { ChevronDownIcon, Trash2Icon } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { DEFAULT_AT_COMMANDS, type ATCommandPreset } from "@/constants/at-commands";

// ─── Constants ───────────────────────────────────────────────────────────────

const STORAGE_KEY = "qm_at_custom_commands";

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

// ─── Props ───────────────────────────────────────────────────────────────────

interface CommandsPopoverProps {
  onSelect: (command: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function CommandsPopover({
  onSelect,
  inputRef,
}: CommandsPopoverProps) {
  const [open, setOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

  // Load custom commands once on mount via initializer
  const [customCommands, setCustomCommands] = useState<ATCommandPreset[]>(
    () => loadCustomCommands()
  );

  // Add form state
  const [newLabel, setNewLabel] = useState("");
  const [newCommand, setNewCommand] = useState("");
  const [addError, setAddError] = useState("");

  const totalCount = DEFAULT_AT_COMMANDS.length + customCommands.length;

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleAdd() {
    const trimmedLabel = newLabel.trim();
    const trimmedCommand = newCommand.trim();

    if (!trimmedLabel || !trimmedCommand) {
      setAddError("Both fields are required.");
      return;
    }

    if (!trimmedCommand.toUpperCase().startsWith("AT")) {
      setAddError('Command must start with "AT".');
      return;
    }

    const allCommands = [...DEFAULT_AT_COMMANDS, ...customCommands];
    const isDuplicate = allCommands.some(
      (p) => p.command.toLowerCase() === trimmedCommand.toLowerCase()
    );
    if (isDuplicate) {
      setAddError("This command already exists.");
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

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="xs" aria-expanded={open}>
            Commands
            <ChevronDownIcon />
          </Button>
        </PopoverTrigger>

        <PopoverContent className="w-80 p-0" align="end">
          <Command>
            <CommandInput placeholder="Search commands..." />
            <CommandList>
              <CommandEmpty>No commands found.</CommandEmpty>

              <CommandGroup heading="Default">
                {DEFAULT_AT_COMMANDS.map((preset) => (
                  <CommandItem
                    key={preset.command}
                    value={preset.label}
                    onSelect={() => {
                      onSelect(preset.command);
                      setOpen(false);
                      inputRef.current?.focus();
                    }}
                  >
                    <span className="font-medium flex-1 min-w-0 truncate">
                      {preset.label}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground truncate max-w-32">
                      {preset.command}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>

              {customCommands.length > 0 && (
                <CommandGroup heading="Custom">
                  {customCommands.map((preset) => (
                    <CommandItem
                      key={preset.command}
                      value={preset.label}
                      onSelect={() => {
                        onSelect(preset.command);
                        setOpen(false);
                        inputRef.current?.focus();
                      }}
                    >
                      <span className="font-medium flex-1 min-w-0 truncate">
                        {preset.label}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground truncate max-w-32">
                        {preset.command}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>

          {/* Footer */}
          <div className="flex items-center justify-between px-3 py-2 border-t text-xs text-muted-foreground">
            <span>{totalCount} commands</span>
            <button
              className="text-xs underline underline-offset-2 hover:text-foreground transition-colors"
              onClick={() => {
                setManageOpen(true);
                setOpen(false);
              }}
            >
              Manage Commands
            </button>
          </div>
        </PopoverContent>
      </Popover>

      {/* Manage Commands Dialog */}
      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Manage Custom Commands</DialogTitle>
            <DialogDescription>
              Add and remove custom AT command presets.
            </DialogDescription>
          </DialogHeader>

          {/* Custom command list */}
          {customCommands.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No custom commands yet.
            </p>
          ) : (
            <ul className="space-y-1">
              {customCommands.map((preset, index) => (
                <li
                  key={`${preset.command}-${index}`}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50"
                >
                  <span className="flex-1 min-w-0">
                    <span className="font-medium text-sm block truncate">
                      {preset.label}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground block truncate">
                      {preset.command}
                    </span>
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Delete ${preset.label}`}
                    onClick={() => handleDelete(index)}
                  >
                    <Trash2Icon />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <Separator />

          {/* Add form */}
          <div className="flex gap-2">
            <Input
              placeholder="Command name"
              aria-label="Command name"
              value={newLabel}
              onChange={(e) => {
                setNewLabel(e.target.value);
                setAddError("");
              }}
              className="flex-1"
            />
            <Input
              placeholder="AT+..."
              aria-label="AT command"
              value={newCommand}
              onChange={(e) => {
                setNewCommand(e.target.value);
                setAddError("");
              }}
              className="flex-1 font-mono"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAdd();
              }}
            />
            <Button size="sm" onClick={handleAdd}>
              Add
            </Button>
          </div>

          {addError && (
            <p className="text-xs text-destructive">{addError}</p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
