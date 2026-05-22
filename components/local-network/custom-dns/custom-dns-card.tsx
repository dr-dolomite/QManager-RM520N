"use client";

import {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
  type FormEvent,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import {
  CheckCircle2Icon,
  MinusCircleIcon,
  PlusIcon,
  RotateCcwIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { MetaPanel, MetaPair } from "@/components/ui/meta-panel";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { Skeleton } from "@/components/ui/skeleton";

import { useCustomDns } from "@/hooks/use-custom-dns";
import { cn } from "@/lib/utils";

// =============================================================================
// Constants
// =============================================================================

const MAX_RESOLVERS = 4;

// IPv4 dotted-quad: four 0-255 octets.
const IPV4_RE =
  /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

// IPv6 (permissive): hex groups separated by colons, supports the "::" shorthand.
// Accepts the common forms — dnsmasq's parser is the authoritative gate.
const IPV6_RE =
  /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;

function isValidResolver(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  return IPV4_RE.test(v) || IPV6_RE.test(v);
}

// motion easing — out-quart, matches IPPassthroughCard's reveal idiom
const REVEAL_EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];
const REVEAL_DURATION = 0.2;

// =============================================================================
// CustomDnsCard
// =============================================================================

const CustomDnsCard = () => {
  const {
    settings,
    isLoading,
    isSaving,
    error,
    fieldError,
    saveSettings,
    refresh,
  } = useCustomDns();
  const { saved, markSaved } = useSaveFlash();

  // ---------------------------------------------------------------------------
  // Local form state — preserved across off/on toggles within a session
  // ---------------------------------------------------------------------------
  const [localEnabled, setLocalEnabled] = useState(false);
  const [localIgnoreCarrier, setLocalIgnoreCarrier] = useState(false);
  // Per-row state. An empty initial row gives the user something to type into.
  const [localServers, setLocalServers] = useState<string[]>([""]);
  // Per-row blur-validated invalid flag — true once the user has left an
  // invalid value. Hidden while the user is still typing.
  const [rowInvalid, setRowInvalid] = useState<boolean[]>([false]);

  // Track whether we've already hydrated from the server response so the
  // user's local edits don't get clobbered by background refreshes.
  const hydratedRef = useRef(false);

  const hydrateFromServer = useCallback(() => {
    if (!settings) return;
    setLocalEnabled(settings.enabled);
    setLocalIgnoreCarrier(settings.ignoreCarrier);
    const servers =
      settings.servers.length > 0
        ? [...settings.servers]
        : settings.enabled
          ? [""]
          : [""];
    setLocalServers(servers);
    setRowInvalid(servers.map(() => false));
  }, [settings]);

  useEffect(() => {
    if (settings && !hydratedRef.current) {
      hydrateFromServer();
      hydratedRef.current = true;
    }
  }, [settings, hydrateFromServer]);

  // ---------------------------------------------------------------------------
  // Derived flags
  // ---------------------------------------------------------------------------
  const available = settings?.available ?? true;
  const dnsMode = settings?.dnsMode ?? "";
  const passthroughBypass = settings?.passthroughBypass ?? false;
  const formDisabled = isSaving || !available;

  const trimmedServers = useMemo(
    () => localServers.map((s) => s.trim()),
    [localServers]
  );
  const nonEmptyServers = useMemo(
    () => trimmedServers.filter((s) => s.length > 0),
    [trimmedServers]
  );
  const anyRowInvalid = trimmedServers.some(
    (s, i) => s.length > 0 && !isValidResolver(s) && rowInvalid[i]
  );
  const emptyWhenEnabled = localEnabled && nonEmptyServers.length === 0;

  // ---------------------------------------------------------------------------
  // Row helpers
  // ---------------------------------------------------------------------------
  const updateRow = (index: number, value: string) => {
    setLocalServers((rows) => {
      const next = [...rows];
      next[index] = value;
      return next;
    });
    // Clear blur-validated invalid flag while the user types so the
    // destructive border doesn't follow each keystroke.
    setRowInvalid((flags) => {
      if (!flags[index]) return flags;
      const next = [...flags];
      next[index] = false;
      return next;
    });
  };

  const handleRowBlur = (index: number) => {
    const value = (localServers[index] ?? "").trim();
    if (!value) {
      setRowInvalid((flags) => {
        if (!flags[index]) return flags;
        const next = [...flags];
        next[index] = false;
        return next;
      });
      return;
    }
    setRowInvalid((flags) => {
      const next = [...flags];
      next[index] = !isValidResolver(value);
      return next;
    });
  };

  const addRow = () => {
    setLocalServers((rows) => {
      if (rows.length >= MAX_RESOLVERS) return rows;
      return [...rows, ""];
    });
    setRowInvalid((flags) => {
      if (flags.length >= MAX_RESOLVERS) return flags;
      return [...flags, false];
    });
  };

  const removeRow = (index: number) => {
    setLocalServers((rows) => {
      if (rows.length <= 1) return [""];
      return rows.filter((_, i) => i !== index);
    });
    setRowInvalid((flags) => {
      if (flags.length <= 1) return [false];
      return flags.filter((_, i) => i !== index);
    });
  };

  // Paste auto-split: "1.1.1.1, 1.0.0.1" → two rows, clamped to MAX_RESOLVERS.
  const handlePaste = (
    index: number,
    e: ClipboardEvent<HTMLInputElement>
  ) => {
    const text = e.clipboardData.getData("text");
    if (!text) return;
    const parts = text
      .split(/[\s,;]+/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length <= 1) return; // single token — let the default paste happen

    e.preventDefault();
    setLocalServers((rows) => {
      const next = [...rows];
      let slot = index;
      for (const part of parts) {
        if (slot >= MAX_RESOLVERS) break;
        if (slot >= next.length) next.push(part);
        else next[slot] = part;
        slot += 1;
      }
      return next.slice(0, MAX_RESOLVERS);
    });
    setRowInvalid((flags) => {
      const next = [...flags];
      let slot = index;
      for (let i = 0; i < parts.length; i += 1) {
        if (slot >= MAX_RESOLVERS) break;
        if (slot >= next.length) next.push(false);
        else next[slot] = false;
        slot += 1;
      }
      return next.slice(0, MAX_RESOLVERS);
    });
  };

  // Enter on the last row → add a new row (if there's room).
  const handleKeyDown = (
    index: number,
    e: KeyboardEvent<HTMLInputElement>
  ) => {
    if (e.key !== "Enter") return;
    if (index !== localServers.length - 1) return;
    if (localServers.length >= MAX_RESOLVERS) return;
    e.preventDefault();
    addRow();
  };

  // ---------------------------------------------------------------------------
  // Reset to last-known server state
  // ---------------------------------------------------------------------------
  const handleReset = () => {
    hydrateFromServer();
  };

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!available) return;

    // Re-validate every non-empty row at submit time and mark invalid rows so
    // the user can see exactly where the problem is.
    const finalInvalid = trimmedServers.map(
      (s) => s.length > 0 && !isValidResolver(s)
    );
    setRowInvalid(finalInvalid);

    if (finalInvalid.some(Boolean)) {
      toast.error("Fix the highlighted resolver(s) before saving.");
      return;
    }

    if (emptyWhenEnabled) {
      toast.error("Add at least one resolver, or turn off Custom DNS.");
      return;
    }

    const success = await saveSettings({
      enabled: localEnabled,
      ignoreCarrier: localIgnoreCarrier,
      servers: nonEmptyServers,
    });

    if (success) {
      markSaved();
      toast.success(
        "Custom DNS applied. LAN clients may see a brief pause as caches refresh."
      );
    }
  };

  // ---------------------------------------------------------------------------
  // Loading skeleton — mirrors the live layout
  // ---------------------------------------------------------------------------
  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>Custom Upstream DNS</CardTitle>
          <CardDescription>
            Override the carrier-provided resolver dnsmasq forwards to. LAN
            clients keep querying the modem; only the upstream changes.
          </CardDescription>
          <CardAction>
            <Skeleton className="h-6 w-32 rounded-md" />
          </CardAction>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6">
            {/* MetaPanel — current upstream readout */}
            <Skeleton className="h-[68px] w-full rounded-md" />
            {/* Switch row */}
            <div className="flex items-center justify-between gap-4">
              <Skeleton className="h-4 w-56" />
              <Skeleton className="h-5 w-9" />
            </div>
            {/* Resolver rows */}
            <div className="grid gap-2">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
            {/* Action row */}
            <div className="flex items-center gap-2">
              <Skeleton className="h-9 w-32" />
              <Skeleton className="h-9 w-9" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ---------------------------------------------------------------------------
  // Status badge for the strip
  // ---------------------------------------------------------------------------
  const renderStatusBadge = () => {
    if (!available) {
      return (
        <Badge
          variant="outline"
          className="bg-warning/15 text-warning hover:bg-warning/20 border-warning/30"
        >
          <TriangleAlertIcon className="size-3" />
          Unavailable
        </Badge>
      );
    }
    if (settings?.currentSource === "custom") {
      return (
        <Badge
          variant="outline"
          className="bg-success/15 text-success hover:bg-success/20 border-success/30"
        >
          <CheckCircle2Icon className="size-3" />
          Custom
        </Badge>
      );
    }
    return (
      <Badge
        variant="outline"
        className="bg-muted/50 text-muted-foreground border-muted-foreground/30"
      >
        <MinusCircleIcon className="size-3" />
        Carrier-assigned
      </Badge>
    );
  };

  const currentUpstream = settings?.currentUpstream ?? [];

  return (
    <div className="grid gap-4">
      {/* Unavailable alert sits above the card chrome */}
      {!available && (
        <Alert>
          <TriangleAlertIcon />
          <AlertDescription>
            Custom DNS is unavailable while DNS Mode is{" "}
            <span className="font-medium text-foreground">
              &quot;{dnsMode || "unknown"}&quot;
            </span>
            . This usually means the modem is in a non-PROXY DNS configuration.
            Switch DNS Mode in your network settings to enable this feature.
          </AlertDescription>
        </Alert>
      )}

      <Card className="@container/card">
        <CardHeader>
          <CardTitle>Custom Upstream DNS</CardTitle>
          <CardDescription>
            Override the carrier-provided resolver dnsmasq forwards to. LAN
            clients keep querying the modem; only the upstream changes.
          </CardDescription>
          <CardAction>{renderStatusBadge()}</CardAction>
          {passthroughBypass && (
            <p className="mt-2 text-sm text-muted-foreground">
              IP Passthrough is bypassing dnsmasq; this setting only affects
              clients that route DNS through the modem.
            </p>
          )}
        </CardHeader>

        <CardContent>
          {/* Inline error band — CGI already includes the "dnsmasq rejected this configuration: …" prefix when relevant. */}
          {error && (
            <div className="mb-4 flex items-center justify-between gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2">
              <p className="text-sm text-destructive">{error}</p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0 text-destructive hover:text-destructive"
                onClick={refresh}
              >
                Retry
              </Button>
            </div>
          )}

          <form className="grid gap-6" onSubmit={handleSubmit}>
            {/* Zone 1: Current upstream readout. Hidden when unavailable —
                the Alert above the card already explains the state, so an
                additional "—" panel would be redundant noise. */}
            {available && (
              <MetaPanel title="Currently forwarding">
                <div className="mt-2 grid grid-cols-1 gap-x-3 gap-y-1 @sm:grid-cols-2">
                  {currentUpstream.length > 0 ? (
                    currentUpstream.map((ip, i) => (
                      <MetaPair
                        key={`${ip}-${i}`}
                        label={
                          currentUpstream.length === 1
                            ? "Resolver"
                            : `Resolver ${i + 1}`
                        }
                        value={ip}
                      />
                    ))
                  ) : (
                    <MetaPair label="Resolver" value="—" />
                  )}
                </div>
              </MetaPanel>
            )}

            {/* Zone 2: Controls */}
            <FieldSet>
              <FieldGroup>
                {/* Enable switch row */}
                <Field orientation="horizontal">
                  <FieldLabel htmlFor="custom-dns-enabled">
                    Enable custom upstream DNS
                  </FieldLabel>
                  <Switch
                    id="custom-dns-enabled"
                    checked={localEnabled}
                    onCheckedChange={setLocalEnabled}
                    disabled={formDisabled}
                    aria-label="Enable custom upstream DNS"
                  />
                </Field>

                {/* Resolver list + ignore-carrier — revealed when enabled */}
                <AnimatePresence initial={false}>
                  {localEnabled && (
                    <motion.div
                      key="resolver-controls"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{
                        duration: REVEAL_DURATION,
                        ease: REVEAL_EASE,
                      }}
                      className="overflow-hidden"
                    >
                      <div className="flex flex-col gap-5 pt-1">
                        <Field>
                          <div className="flex items-center justify-between gap-2">
                            <FieldLabel>Upstream resolvers</FieldLabel>
                            {localServers.length >= MAX_RESOLVERS && (
                              <span className="text-xs text-muted-foreground">
                                up to {MAX_RESOLVERS}
                              </span>
                            )}
                          </div>

                          <div className="flex flex-col gap-2">
                            {localServers.map((value, index) => {
                              const showInvalid = rowInvalid[index];
                              const inputId = `custom-dns-server-${index}`;
                              return (
                                <div
                                  key={index}
                                  className="flex flex-col gap-1"
                                >
                                  <div className="flex items-center gap-2">
                                    <Input
                                      id={inputId}
                                      aria-label={`Upstream resolver ${index + 1}`}
                                      aria-invalid={showInvalid || undefined}
                                      placeholder="e.g. 1.1.1.1 or 2606:4700:4700::1111"
                                      className={cn(
                                        "font-mono",
                                        showInvalid &&
                                          "border-destructive focus-visible:ring-destructive/30"
                                      )}
                                      value={value}
                                      onChange={(
                                        e: ChangeEvent<HTMLInputElement>
                                      ) =>
                                        updateRow(index, e.target.value)
                                      }
                                      onBlur={() => handleRowBlur(index)}
                                      onPaste={(e) => handlePaste(index, e)}
                                      onKeyDown={(e) =>
                                        handleKeyDown(index, e)
                                      }
                                      disabled={formDisabled}
                                    />
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => removeRow(index)}
                                      disabled={
                                        formDisabled ||
                                        (localServers.length === 1 &&
                                          value === "")
                                      }
                                      aria-label={`Remove resolver ${index + 1}`}
                                    >
                                      <XIcon className="size-4" />
                                    </Button>
                                  </div>
                                  {showInvalid && (
                                    <p
                                      role="alert"
                                      className="text-xs text-destructive"
                                    >
                                      Not a valid IPv4 or IPv6 address.
                                    </p>
                                  )}
                                </div>
                              );
                            })}
                          </div>

                          <div className="mt-1 flex items-center justify-between gap-2">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={addRow}
                              disabled={
                                formDisabled ||
                                localServers.length >= MAX_RESOLVERS
                              }
                              className="-ml-2"
                            >
                              <PlusIcon className="size-4" />
                              Add resolver
                            </Button>
                            {emptyWhenEnabled && (
                              <span className="text-xs text-destructive">
                                Add at least one resolver, or turn off Custom
                                DNS.
                              </span>
                            )}
                          </div>
                        </Field>

                        {/* Ignore-carrier checkbox */}
                        <Field orientation="horizontal">
                          <Checkbox
                            id="custom-dns-ignore-carrier"
                            checked={localIgnoreCarrier}
                            onCheckedChange={(c) =>
                              setLocalIgnoreCarrier(c === true)
                            }
                            disabled={formDisabled}
                            aria-describedby="custom-dns-ignore-carrier-help"
                          />
                          <div className="flex flex-1 flex-col gap-1 leading-snug">
                            <FieldLabel htmlFor="custom-dns-ignore-carrier">
                              Ignore carrier DNS as fallback
                            </FieldLabel>
                            <p
                              id="custom-dns-ignore-carrier-help"
                              className="text-sm text-muted-foreground"
                            >
                              dnsmasq will only forward to the resolvers above;
                              it will not fall back to carrier DNS if these
                              fail.
                            </p>
                          </div>
                        </Field>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </FieldGroup>
            </FieldSet>

            {/* Zone 3: Actions */}
            <div className="flex items-center gap-x-2">
              <SaveButton
                type="submit"
                isSaving={isSaving}
                saved={saved}
                label="Save & apply"
                disabled={
                  formDisabled || anyRowInvalid || emptyWhenEnabled
                }
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleReset}
                disabled={isSaving || !settings}
                aria-label="Reset to saved values"
              >
                <RotateCcwIcon />
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default CustomDnsCard;
