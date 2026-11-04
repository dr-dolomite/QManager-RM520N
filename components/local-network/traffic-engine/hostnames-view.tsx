"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { failureReason } from "./failure-reason";
import {
  Download,
  Loader2,
  MoreHorizontalIcon,
  Plus,
  RefreshCcwIcon,
  TriangleAlertIcon,
  Upload,
  X,
} from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { CardFoot } from "@/components/ui/card-foot";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { Skeleton } from "@/components/ui/skeleton";
import type { UseCdnHostlistReturn } from "@/hooks/use-cdn-hostlist";
import { cn } from "@/lib/utils";
import { CONDITION, CONDITION_TONE, HOSTS, SKELETON } from "./shapes";
import { groupDomains } from "./video-services";

export type Hostlist = UseCdnHostlistReturn;

/** The CGI's own limits: `save_hostlist` rejects the whole write past either. */
export const MAX_DOMAINS = 300;
const MAX_DOMAIN_LENGTH = 253;
const MAX_IMPORT_BYTES = 256 * 1024;
const DOMAIN_PATTERN = /^[a-z0-9._-]+$/;
/** The device's own file header, so an export imports back losslessly. */
const EXPORT_HEADER = "# QManager Video Optimizer hostlist";

/** The locale key for why a domain cannot join the list, or null when it can. */
function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(b);
  return a.every((d) => set.has(d));
}

function domainErrorKey(value: string, list: readonly string[]): string | null {
  if (value.length > MAX_DOMAIN_LENGTH) return "traffic_engine.hosts_too_long";
  if (!DOMAIN_PATTERN.test(value) || !value.includes(".")) return "traffic_engine.hosts_invalid";
  if (list.includes(value)) return "traffic_engine.hosts_duplicate";
  if (list.length >= MAX_DOMAINS) return "traffic_engine.hosts_limit";
  return null;
}

/**
 * The hostname list's draft, owned by the Video Optimizer card so it survives Back: edits
 * stay pending until Apply, and a load or save replaces the draft.
 */
export function useHostlistDraft(hostlist: Hostlist) {
  const { t } = useTranslation("local-network");
  const { domains, saveHostlist, restoreDefaults } = hostlist;
  const { saved, markSaved } = useSaveFlash();

  const [draft, setDraft] = useState<string[]>(domains);
  const [prevDomains, setPrevDomains] = useState(domains);
  if (domains !== prevDomains) {
    setPrevDomains(domains);
    // A re-read adopts the new list only when nothing is pending; a save lands as draft == domains.
    if (sameSet(draft, prevDomains) || sameSet(draft, domains)) setDraft(domains);
  }

  const dirty = useMemo(() => !sameSet(draft, domains), [draft, domains]);

  const add = useCallback((domain: string) => setDraft((prev) => [domain, ...prev]), []);
  const remove = useCallback(
    (domain: string) => setDraft((prev) => prev.filter((d) => d !== domain)),
    [],
  );
  const discard = useCallback(() => setDraft(domains), [domains]);

  const save = useCallback(async () => {
    const result = await saveHostlist(draft);
    if (result.ok) {
      markSaved();
      toast.success(t("traffic_engine.toast_hosts_saved"));
    } else {
      toast.error(t("traffic_engine.toast_hosts_save_error"), {
        description: failureReason(t, result),
      });
    }
    return result.ok;
  }, [draft, saveHostlist, markSaved, t]);

  const restore = useCallback(async () => {
    const result = await restoreDefaults();
    if (result.ok) {
      toast.success(t("traffic_engine.toast_hosts_restored"));
    } else {
      toast.error(t("traffic_engine.toast_hosts_restore_error"), {
        description: failureReason(t, result),
      });
    }
  }, [restoreDefaults, t]);

  /** Merges an imported file into the draft: valid, new, and under the cap. */
  const importText = useCallback(
    (text: string) => {
      const existing = new Set(draft);
      const additions: string[] = [];
      let invalid = 0;
      let duplicate = 0;
      for (const raw of text.split(/\r\n|\r|\n/)) {
        const line = raw.trim();
        if (line === "" || line.startsWith("#")) continue;
        const value = line.toLowerCase();
        if (value.length > MAX_DOMAIN_LENGTH || !DOMAIN_PATTERN.test(value) || !value.includes(".")) {
          invalid += 1;
        } else if (existing.has(value)) {
          duplicate += 1;
        } else {
          existing.add(value);
          additions.push(value);
        }
      }
      const accepted = additions.slice(0, Math.max(0, MAX_DOMAINS - draft.length));
      const dropped = additions.length - accepted.length;
      const skipped: string[] = [];
      if (invalid) skipped.push(t("traffic_engine.import_invalid", { count: invalid }));
      if (duplicate) skipped.push(t("traffic_engine.import_duplicate", { count: duplicate }));
      if (dropped) {
        skipped.push(t("traffic_engine.import_dropped", { count: dropped, max: MAX_DOMAINS }));
      }
      const description = skipped.length ? skipped.join(" ") : undefined;
      if (accepted.length === 0) {
        toast.warning(t("traffic_engine.import_none"), { description });
        return;
      }
      setDraft((prev) => [...accepted, ...prev]);
      // Import only edits the draft; speak up only about lines the file lost.
      if (description) {
        toast.warning(t("traffic_engine.import_added", { count: accepted.length }), { description });
      }
    },
    [draft, t],
  );

  return {
    draft,
    dirty,
    /** The CGI accepts an empty list, so this is the only guard against applying one. */
    invalid: draft.length === 0,
    saved,
    add,
    remove,
    discard,
    save,
    restore,
    importText,
  };
}

export type HostlistDraft = ReturnType<typeof useHostlistDraft>;

/** The `...` menu in the hostnames view's `CardAction`: Import and Export. */
export function HostnamesMenu({ draft }: { draft: HostlistDraft }) {
  const { t } = useTranslation("local-network");
  const fileRef = useRef<HTMLInputElement>(null);

  const exportList = () => {
    const text = `${[EXPORT_HEADER, ...draft.draft].join("\n")}\n`;
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `video_domains-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t("traffic_engine.toast_export", { count: draft.draft.length }));
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      toast.error(t("traffic_engine.import_too_large", { limit: MAX_IMPORT_BYTES / 1024 }));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => toast.error(t("traffic_engine.import_unreadable"));
    reader.onload = () => draft.importText(typeof reader.result === "string" ? reader.result : "");
    reader.readAsText(file);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={HOSTS.REMOVE}
            aria-label={t("traffic_engine.aria_hosts_menu")}
          >
            <MoreHorizontalIcon className="size-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => fileRef.current?.click()}>
            <Upload className="size-4" aria-hidden="true" />
            {t("traffic_engine.menu_import")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={exportList}>
            <Download className="size-4" aria-hidden="true" />
            {t("traffic_engine.menu_export")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        ref={fileRef}
        type="file"
        accept=".txt,.csv,text/plain"
        className="hidden"
        onChange={onFile}
      />
    </>
  );
}

interface HostnamesViewProps {
  hostlist: Hostlist;
  draft: HostlistDraft;
}

/**
 * The Video Optimizer card's second view: one column grouped by service, custom domains
 * first, an add field on top and its own Restore / Discard / Save foot.
 */
export function HostnamesView({ hostlist, draft }: HostnamesViewProps) {
  const { t } = useTranslation("local-network");
  const [input, setInput] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const groups = useMemo(() => groupDomains(draft.draft), [draft.draft]);
  const busy = hostlist.isSaving || hostlist.isRestoring;

  if (hostlist.isLoading) {
    return (
      <div className={HOSTS.LIST} aria-hidden="true">
        <Skeleton className={SKELETON.FIELD} />
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className={SKELETON.ROW} />
        ))}
      </div>
    );
  }

  if (hostlist.error && hostlist.domains.length === 0) {
    const tone = CONDITION_TONE.destructive;
    return (
      <div role="alert" className={cn(CONDITION.ROOT, tone.ROOT)}>
        <span aria-hidden className={cn(CONDITION.DISC, tone.DISC)}>
          <TriangleAlertIcon className={CONDITION.GLYPH} />
        </span>
        <p className={CONDITION.DESC}>{t("traffic_engine.hosts_error_load")}</p>
        <div className={CONDITION.ACTIONS}>
          <Button
            variant="ghost"
            size="action"
            onClick={() => hostlist.refresh()}
            className={tone.ACTION}
          >
            <RefreshCcwIcon aria-hidden="true" />
            {t("actions.retry", { ns: "common" })}
          </Button>
        </div>
      </div>
    );
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = input.trim().toLowerCase();
    if (!value) return;
    const errKey = domainErrorKey(value, draft.draft);
    if (errKey) {
      setInputError(t(errKey, { max: errKey.endsWith("limit") ? MAX_DOMAINS : MAX_DOMAIN_LENGTH }));
      return;
    }
    draft.add(value);
    setInput("");
    setInputError(null);
  };

  return (
    <>
      <form className={HOSTS.TOOLBAR} onSubmit={submit}>
        <div className={HOSTS.INPUT_WRAP}>
          <Input
            type="text"
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="none"
            className={HOSTS.INPUT}
            placeholder={t("traffic_engine.hosts_placeholder")}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              if (inputError) setInputError(null);
            }}
            aria-label={t("traffic_engine.aria_new_domain")}
            aria-invalid={!!inputError}
            aria-describedby={inputError ? "te-new-domain-error" : undefined}
          />
          {inputError ? (
            <FieldError id="te-new-domain-error" className="mt-1.5">
              {inputError}
            </FieldError>
          ) : null}
        </div>
        <Button type="submit" variant="tonal" disabled={!input.trim() || busy}>
          <Plus aria-hidden="true" />
          {t("traffic_engine.hosts_add")}
        </Button>
      </form>

      {draft.draft.length === 0 ? (
        <div className={HOSTS.EMPTY}>
          <p className={HOSTS.EMPTY_TITLE}>{t("traffic_engine.hosts_empty_title")}</p>
          <p className={HOSTS.EMPTY_TEXT}>{t("traffic_engine.hosts_empty_desc")}</p>
        </div>
      ) : (
        <div className={HOSTS.SCROLL}>
          <div className={HOSTS.LIST}>
            {groups.map((g) => {
              const name = g.service ?? t("traffic_engine.hosts_group_custom");
              return (
                <section key={name} aria-label={name}>
                  <h3 className={HOSTS.GROUP_HEAD}>
                    <span>{name}</span>
                    <span className={HOSTS.GROUP_COUNT}>{g.domains.length}</span>
                  </h3>
                  <ul>
                    {g.domains.map((d) => (
                      <li key={d} className={HOSTS.ROW}>
                        <span className={HOSTS.NAME} title={d}>
                          {d}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className={HOSTS.REMOVE}
                          onClick={() => draft.remove(d)}
                          disabled={busy}
                          aria-label={t("traffic_engine.aria_remove_domain", { domain: d })}
                        >
                          <X className="size-4" aria-hidden="true" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </div>
      )}

      <CardFoot
        status={
          draft.dirty && draft.invalid
            ? t("traffic_engine.foot_hosts_empty")
            : t("traffic_engine.hosts_count", { count: draft.draft.length, max: MAX_DOMAINS })
        }
        actions={
          <>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="ghost" disabled={busy}>
                  {hostlist.isRestoring ? (
                    <Loader2 className="motion-safe:animate-spin" aria-hidden="true" />
                  ) : null}
                  {hostlist.isRestoring
                    ? t("traffic_engine.state_restoring")
                    : t("traffic_engine.button_restore_defaults")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("traffic_engine.dialog_restore_title")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("traffic_engine.dialog_restore_desc", {
                      count: hostlist.defaultDomains.length,
                    })}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("actions.cancel", { ns: "common" })}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void draft.restore()}>
                    {t("traffic_engine.button_restore_defaults")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button
              type="button"
              variant="ghost"
              onClick={draft.discard}
              disabled={!draft.dirty || busy}
            >
              {t("traffic_engine.discard")}
            </Button>
            <SaveButton
              type="button"
              isSaving={hostlist.isSaving}
              saved={draft.saved}
              disabled={!draft.dirty || draft.invalid || hostlist.isRestoring}
              onClick={() => void draft.save()}
              label={t("actions.apply", { ns: "common" })}
              savingLabel={t("traffic_engine.applying")}
            />
          </>
        }
      />
    </>
  );
}
