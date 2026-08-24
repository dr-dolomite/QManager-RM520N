"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Loader2Icon, PlusIcon, XIcon } from "lucide-react";
import type { UseCdnHostlistReturn } from "@/hooks/use-cdn-hostlist";

// =============================================================================
// cdn-hostlist-card — Video Optimizer hostlist editor: add/remove domains,
// save (backend validates charset/length/count), and empty state. tpws
// hot-reloads the hostlist, so a save applies immediately while running.
// =============================================================================

const DOMAIN_PATTERN = /^[A-Za-z0-9._-]+$/;
const MAX_DOMAINS = 300;

export interface CdnHostlistCardProps {
  hostlist: UseCdnHostlistReturn;
}

const CdnHostlistCard = ({ hostlist }: CdnHostlistCardProps) => {
  const { t } = useTranslation("common");

  const [draft, setDraft] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const addDomain = () => {
    const value = draft.trim().toLowerCase();
    setLocalError(null);
    if (!value) return;
    if (!DOMAIN_PATTERN.test(value) || !value.includes(".")) {
      setLocalError(t("trafficEngine.hostlist.invalid"));
      return;
    }
    if (hostlist.domains.includes(value)) {
      setLocalError(t("trafficEngine.hostlist.duplicate"));
      return;
    }
    if (hostlist.domains.length >= MAX_DOMAINS) {
      setLocalError(t("trafficEngine.hostlist.limit"));
      return;
    }
    hostlist.saveDomains([...hostlist.domains, value]).then((ok) => {
      if (ok) {
        setDraft("");
        toast.success(t("trafficEngine.hostlist.saved"));
      } else {
        // Backend failures must never be silent: the hook records the error
        // (rendered inline below) and the toast makes the failure immediate.
        toast.error(t("trafficEngine.hostlist.save_failed"));
      }
    });
  };

  const removeDomain = (domain: string) => {
    hostlist.saveDomains(hostlist.domains.filter((d) => d !== domain)).then((ok) => {
      if (ok) {
        toast.success(t("trafficEngine.hostlist.saved"));
      } else {
        toast.error(t("trafficEngine.hostlist.save_failed"));
      }
    });
  };

  if (hostlist.isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>{t("trafficEngine.hostlist.title")}</CardTitle>
          <CardDescription>{t("trafficEngine.hostlist.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{t("trafficEngine.hostlist.title")}</CardTitle>
        <CardDescription>{t("trafficEngine.hostlist.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4">
          {hostlist.domains.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("trafficEngine.hostlist.empty")}
            </p>
          ) : (
            <ul className="grid gap-1.5">
              {hostlist.domains.map((domain) => (
                <li
                  key={domain}
                  className="flex items-center justify-between gap-2 rounded-field bg-surface-container px-3 py-2"
                >
                  <span className="font-mono text-sm break-all">{domain}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label={t("trafficEngine.hostlist.remove", { domain })}
                    onClick={() => removeDomain(domain)}
                  >
                    <XIcon className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              type="text"
              placeholder="example.com"
              className="flex-1 font-mono"
              value={draft}
              aria-invalid={!!localError}
              onChange={(e) => {
                setDraft(e.target.value);
                setLocalError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addDomain();
                }
              }}
            />
            <Button onClick={addDomain} disabled={!draft.trim()}>
              <PlusIcon className="size-4" />
              {t("trafficEngine.hostlist.add")}
            </Button>
          </div>

          {localError && (
            <p className="text-sm text-destructive" role="alert">
              {localError}
            </p>
          )}

          {hostlist.error && (
            <p className="text-sm text-destructive" role="alert">
              {hostlist.error}
            </p>
          )}

          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-muted/50 text-muted-foreground border-muted-foreground/30 tabular-nums">
              {t("trafficEngine.status.domains")}: {hostlist.domains.length}
            </Badge>
            {hostlist.isSaving && (
              <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default CdnHostlistCard;