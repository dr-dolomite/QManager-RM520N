"use client";

import { useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import {
  IMEI_TAC_PRESETS,
  IMEI_CUSTOM_ID,
  getImeiTacPreset,
} from "@/constants/imei-presets";
import {
  generateImei,
  validateImei,
  parseImeiBreakdown,
} from "@/lib/imei-utils";

const IMEIToolsCard = () => {
  const [selectedPresetId, setSelectedPresetId] = useState<string>(
    IMEI_TAC_PRESETS[0].id
  );
  const [customPrefix, setCustomPrefix] = useState("");
  const [imei, setImei] = useState("");

  const isCustom = selectedPresetId === IMEI_CUSTOM_ID;
  const activePrefix = isCustom
    ? customPrefix
    : (getImeiTacPreset(selectedPresetId)?.tac ?? "");
  const isValidPrefix = /^\d{8,12}$/.test(activePrefix);
  const showPrefixError = isCustom && customPrefix.length > 0 && !isValidPrefix;

  // Validation — derived, no state
  const is15Digits = /^\d{15}$/.test(imei);
  const isValid: boolean | null = is15Digits ? validateImei(imei) : null;
  const breakdown = is15Digits ? parseImeiBreakdown(imei) : null;

  const handlePresetChange = (value: string) => {
    setSelectedPresetId(value);
  };

  const handleCustomPrefixChange = (e: ChangeEvent<HTMLInputElement>) => {
    setCustomPrefix(e.target.value.replace(/\D/g, "").slice(0, 12));
  };

  const handleGenerate = () => {
    if (!isValidPrefix) return;
    setImei(generateImei(activePrefix));
  };

  const handleImeiChange = (e: ChangeEvent<HTMLInputElement>) => {
    setImei(e.target.value.replace(/\D/g, "").slice(0, 15));
  };

  const handleCopy = () => {
    if (!imei) return;
    navigator.clipboard.writeText(imei).then(
      () => toast.success("Copied to clipboard"),
      () => {
        const ta = document.createElement("textarea");
        ta.value = imei;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        toast.success("Copied to clipboard");
      },
    );
  };

  return (
    <Card className="@container/card @3xl/main:col-span-2">
      <CardHeader>
        <CardTitle>IMEI Tools</CardTitle>
        <CardDescription>
          Generate and validate IMEI numbers using the Luhn algorithm. For
          educational purposes only.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4 content-start"
          onSubmit={(e) => {
            e.preventDefault();
            handleGenerate();
          }}
        >
          <div className="grid grid-cols-1 @xl/card:grid-cols-2 gap-6">
            <FieldSet>
              <FieldGroup>
                <Field>
                  <FieldLabel>Device Preset</FieldLabel>
                  <Select
                    value={selectedPresetId}
                    onValueChange={handlePresetChange}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a device" />
                    </SelectTrigger>
                    <SelectContent>
                      {IMEI_TAC_PRESETS.map((preset) => (
                        <SelectItem key={preset.id} value={preset.id}>
                          {preset.label}
                        </SelectItem>
                      ))}
                      <SelectSeparator />
                      <SelectItem value={IMEI_CUSTOM_ID}>
                        Custom Prefix
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <FieldDescription>
                    Select a device TAC or enter a custom 8–12 digit prefix.
                  </FieldDescription>
                </Field>

                {isCustom && (
                  <Field>
                    <FieldLabel>Custom Prefix</FieldLabel>
                    <InputGroup>
                      <InputGroupInput
                        placeholder="Enter 8–12 digit prefix"
                        value={customPrefix}
                        onChange={handleCustomPrefixChange}
                        maxLength={12}
                        inputMode="numeric"
                        aria-invalid={showPrefixError}
                      />
                    </InputGroup>
                    {showPrefixError ? (
                      <FieldError>
                        Prefix must be 8–12 digits ({customPrefix.length}{" "}
                        entered)
                      </FieldError>
                    ) : (
                      <FieldDescription>
                        The remaining digits and check digit are generated
                        automatically.
                      </FieldDescription>
                    )}
                  </Field>
                )}
              </FieldGroup>
            </FieldSet>

            <FieldSet>
              <FieldGroup>
                <Field>
                  <FieldLabel>IMEI</FieldLabel>

                  <div className="flex items-center gap-2">
                    <InputGroup className="flex-1">
                      <InputGroupInput
                        placeholder="Generate or enter a 15-digit IMEI"
                        value={imei}
                        onChange={handleImeiChange}
                        maxLength={15}
                        inputMode="numeric"
                        className="font-mono"
                      />
                      {imei.length > 0 && (
                        <InputGroupAddon align="inline-end">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <InputGroupButton
                                type="button"
                                size="icon-xs"
                                aria-label="Copy IMEI"
                                onClick={handleCopy}
                              >
                                <MaterialSymbol name="content_copy" size={12} />
                              </InputGroupButton>
                            </TooltipTrigger>
                            <TooltipContent>Copy to clipboard</TooltipContent>
                          </Tooltip>
                        </InputGroupAddon>
                      )}
                    </InputGroup>
                  </div>
                  <FieldDescription>
                    Luhn validation runs automatically at 15 digits. You can
                    also type or paste any IMEI to validate it.
                  </FieldDescription>
                </Field>
              </FieldGroup>
            </FieldSet>
          </div>

          {breakdown && (
            <Field>
              <FieldLabel>Breakdown</FieldLabel>
              <div className="grid grid-cols-4 gap-2 rounded-md border bg-muted/30 px-3 py-2 font-mono text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Validity</p>
                  <p className="font-medium flex items-center gap-1">
                    {isValid ? (
                      <>
                        <MaterialSymbol name="check_circle" size={16} className="text-green-500" />
                        Valid IMEI
                      </>
                    ) : (
                      <>
                        <MaterialSymbol name="cancel" size={16} className="text-red-500" />
                        Invalid IMEI
                      </>
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">TAC (1–8)</p>
                  <p className="font-medium">{breakdown.tac}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">SNR (9–14)</p>
                  <p className="font-medium">{breakdown.snr}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Check (15)</p>
                  <p className="font-medium">{breakdown.checkDigit}</p>
                </div>
              </div>
            </Field>
          )}

          <div className="flex items-center gap-x-4">
            <Button type="submit" disabled={!isValidPrefix}>
              Generate IMEI
            </Button>

            <Button
              type="button"
              disabled={!is15Digits}
              onClick={() =>
                window.open(
                  `https://www.imei.info/?imei=${imei}`,
                  "_blank",
                  "noopener,noreferrer",
                )
              }
            >
              <MaterialSymbol name="open_in_new" size={16} />
              Check IMEI Info
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};

export default IMEIToolsCard;
