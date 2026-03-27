"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { FieldError } from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import { AlertTriangle, Loader2, Plus, RotateCcw, X } from "lucide-react";
import { useCdnHostlist } from "@/hooks/use-cdn-hostlist";

const DOMAIN_REGEX = /^[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?$/;

function validateDomain(
  value: string,
  existing: string[]
): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Domain is required";
  if (!DOMAIN_REGEX.test(trimmed)) return "Invalid domain format";
  if (!trimmed.includes(".")) return "Must contain at least one dot";
  if (trimmed.length > 253) return "Domain too long (max 253 chars)";
  if (existing.some((d) => d.toLowerCase() === trimmed.toLowerCase()))
    return "Domain already in list";
  return null;
}

function HostlistSkeleton() {
  return (
    <Card className="@container/card">
      <CardHeader>
        <Skeleton className="h-5 w-44" />
        <Skeleton className="h-4 w-72" />
      </CardHeader>
      <CardContent className="grid gap-4">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-9 w-full" />
      </CardContent>
    </Card>
  );
}

export default function CdnHostlistCard() {
  const {
    domains,
    isLoading,
    isSaving,
    isRestoring,
    error,
    saveHostlist,
    restoreDefaults,
    refresh,
  } = useCdnHostlist();

  const [editDomains, setEditDomains] = useState<string[]>([]);
  const [newDomain, setNewDomain] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const { saved, markSaved } = useSaveFlash();

  useEffect(() => {
    setEditDomains(domains);
  }, [domains]);

  const isDirty = useMemo(() => {
    if (editDomains.length !== domains.length) return true;
    const sortedEdit = [...editDomains].sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase())
    );
    const sortedSaved = [...domains].sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase())
    );
    return sortedEdit.some(
      (d, i) => d.toLowerCase() !== sortedSaved[i].toLowerCase()
    );
  }, [editDomains, domains]);

  const handleAddDomain = useCallback(() => {
    const trimmed = newDomain.trim();
    const err = validateDomain(trimmed, editDomains);
    if (err) {
      setValidationError(err);
      return;
    }
    setEditDomains((prev) => [...prev, trimmed]);
    setNewDomain("");
    setValidationError(null);
  }, [newDomain, editDomains]);

  const handleRemoveDomain = useCallback((index: number) => {
    setEditDomains((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleAddDomain();
      }
    },
    [handleAddDomain]
  );

  const handleSave = useCallback(async () => {
    const success = await saveHostlist(editDomains);
    if (success) {
      markSaved();
      toast.success("Hostname list saved");
    } else {
      toast.error(error || "Failed to save hostname list");
    }
  }, [editDomains, saveHostlist, markSaved, error]);

  const handleReset = useCallback(() => {
    setEditDomains(domains);
    setValidationError(null);
  }, [domains]);

  const handleRestoreDefaults = useCallback(async () => {
    const success = await restoreDefaults();
    if (success) {
      toast.success("Default hostnames restored");
    } else {
      toast.error(error || "Failed to restore defaults");
    }
  }, [restoreDefaults, error]);

  if (isLoading) return <HostlistSkeleton />;

  if (error && domains.length === 0) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>CDN Hostname List</CardTitle>
          <CardDescription>
            Hostnames targeted for DPI evasion — video CDN domains that will
            have their TLS handshakes modified
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Failed to load hostname list.{" "}
              <button
                type="button"
                className="underline underline-offset-4"
                onClick={() => refresh()}
              >
                Retry
              </button>
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="@container/card">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <CardTitle>CDN Hostname List</CardTitle>
            <CardDescription>
              Hostnames targeted for DPI evasion — video CDN domains that will
              have their TLS handshakes modified
            </CardDescription>
          </div>
          <CardAction>
            <Badge variant="secondary">{editDomains.length}</Badge>
          </CardAction>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="space-y-1.5">
          <InputGroup>
            <InputGroupInput
              type="text"
              placeholder="e.g. cdn.example.com"
              value={newDomain}
              onChange={(e) => {
                setNewDomain(e.target.value);
                if (validationError) setValidationError(null);
              }}
              onKeyDown={handleKeyDown}
              aria-label="New domain"
              aria-invalid={!!validationError}
              aria-describedby={
                validationError ? "add-domain-error" : undefined
              }
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="sm"
                variant="ghost"
                onClick={handleAddDomain}
                aria-label="Add domain"
              >
                <Plus className="h-4 w-4" />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          {validationError && (
            <FieldError id="add-domain-error">{validationError}</FieldError>
          )}
        </div>

        <div className="max-h-[400px] overflow-y-auto rounded-md border">
          {editDomains.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              No domains configured
            </div>
          ) : (
            editDomains.map((domain, index) => (
              <div
                key={`${domain}-${index}`}
                className="flex items-center justify-between px-3 py-2 text-sm even:bg-muted/30"
              >
                <span className="truncate">{domain}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => handleRemoveDomain(index)}
                  aria-label={`Remove ${domain}`}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))
          )}
        </div>

        <Separator />

        <div className="flex items-center gap-2">
          <SaveButton
            type="button"
            isSaving={isSaving}
            saved={saved}
            disabled={!isDirty}
            onClick={handleSave}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={!isDirty || isSaving}
            onClick={handleReset}
            aria-label="Discard changes"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>

          <div className="flex-1" />

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                variant="outline"
                disabled={isSaving || isRestoring}
              >
                {isRestoring ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Restoring...
                  </>
                ) : (
                  "Restore Defaults"
                )}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Restore Default Hostnames?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will replace the current list with the factory default CDN
                  hostnames. Any custom domains you added will be removed.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleRestoreDefaults}>
                  Restore Defaults
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}
