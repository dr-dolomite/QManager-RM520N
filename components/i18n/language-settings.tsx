"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AnimatePresence, motion } from "motion/react";
import { LanguagesIcon, TriangleAlertIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useLanguagePacks } from "@/hooks/use-language-packs";
import { buildCatalogView } from "@/lib/i18n/language-pack-manifest";
import { resolveInstallError } from "@/lib/i18n/resolve-error";
import { AVAILABLE_LANGUAGES } from "@/lib/i18n/available-languages";
import { switchLanguage } from "@/lib/i18n/runtime-pack";
import { LanguagePackRow } from "./language-pack-row";
import type { LanguageCode } from "@/types/i18n";

// The /system-settings/languages manager. Two sections: Installed (bundled
// built-ins + downloaded packs, selectable) and Available (community packs from
// the manifest, installable). Runtime download/install/remove flows through the
// language-pack CGI; switching a downloaded language injects its pack via
// addResourceBundle before changeLanguage (the hard i18n invariant).
export function LanguageSettings() {
  const { t, i18n } = useTranslation("common");
  const {
    list,
    isLoading,
    listError,
    install,
    startInstall,
    cancelInstall,
    remove,
    refetch,
  } = useLanguagePacks();

  const [switchingCode, setSwitchingCode] = React.useState<string | null>(null);

  const activeCode = i18n.language as LanguageCode;

  const catalogView = React.useMemo(
    () =>
      buildCatalogView({
        catalog: AVAILABLE_LANGUAGES,
        installed: list?.installed ?? [],
        manifest: list?.manifest ?? null,
      }),
    [list],
  );

  const nameFor = React.useCallback(
    (code: LanguageCode) =>
      AVAILABLE_LANGUAGES.find((e) => e.code === code)?.english_name ??
      list?.manifest?.packs.find((p) => p.code === code)?.english_name ??
      list?.installed.find((p) => p.code === code)?.english_name ??
      code,
    [list],
  );

  const handleSelectActive = React.useCallback(
    async (code: LanguageCode) => {
      if (code === activeCode) return;
      setSwitchingCode(code);
      try {
        const ok = await switchLanguage(i18n, code);
        if (ok) {
          toast.success(`Switched to ${nameFor(code)}.`);
        } else {
          toast.error(
            `Couldn't load the ${nameFor(code)} pack. It may need to be reinstalled.`,
          );
        }
      } finally {
        setSwitchingCode(null);
      }
    },
    [activeCode, i18n, nameFor],
  );

  const handleInstall = React.useCallback(
    async (code: LanguageCode) => {
      toast.info(`Installing ${nameFor(code)}…`);
      const res = await startInstall(code);
      if (!res.ok) {
        toast.error(
          resolveInstallError(res.error, undefined, `Couldn't install ${nameFor(code)}.`),
        );
      }
    },
    [startInstall, nameFor],
  );

  // Surface install completion. On success, offer a one-tap "Use now" that
  // injects + switches to the freshly downloaded pack.
  const prevStateRef = React.useRef(install.state);
  React.useEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = install.state;
    const wasActive = prev !== "idle" && prev !== "done" && prev !== "failed" && prev !== "cancelled";
    if (!wasActive) return;
    if (install.state === "done" && install.code) {
      const code = install.code;
      toast.success(`${nameFor(code)} installed.`, {
        action: { label: "Use now", onClick: () => handleSelectActive(code) },
      });
    } else if (install.state === "cancelled") {
      toast.info("Install cancelled.");
    } else if (install.state === "failed") {
      toast.error(
        resolveInstallError(undefined, install.message, "The install failed."),
      );
    }
  }, [install.state, install.code, install.message, nameFor, handleSelectActive]);

  const handleRemove = React.useCallback(
    async (code: LanguageCode, isActive: boolean) => {
      // Switch to English BEFORE removing an active pack, so i18next never tries
      // to resolve against the just-deleted resources.
      if (isActive) {
        await switchLanguage(i18n, "en");
      }
      const res = await remove(code);
      if (!res.ok) {
        toast.error(
          resolveInstallError(res.error, undefined, `Couldn't remove ${nameFor(code)}.`),
        );
        return;
      }
      toast.success(
        isActive
          ? `${nameFor(code)} removed — switched to English.`
          : `${nameFor(code)} removed.`,
      );
    },
    [i18n, remove, nameFor],
  );

  const manifestError = listError || list?.manifest_error;

  return (
    <div className="@container/main mx-auto p-2">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">{t("language.page_title")}</h1>
        <p className="text-muted-foreground">{t("language.page_description")}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 @3xl/main:grid-cols-2">
        {/* Installed: bundled built-ins + downloaded packs */}
        <Card className="@container/card">
          <CardHeader>
            <CardTitle>Installed</CardTitle>
            <CardDescription>
              Languages ready to use on this device. Select one to switch.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {catalogView.builtIn.map((row) =>
              row.status === "built_in" ? (
                <LanguagePackRow
                  key={row.entry.code}
                  variant={{
                    kind: "built_in",
                    entry: row.entry,
                    isActive: row.entry.code === activeCode,
                  }}
                  installState={install}
                  onInstall={handleInstall}
                  onCancelInstall={cancelInstall}
                  onRemove={handleRemove}
                  onSelectActive={handleSelectActive}
                  switching={switchingCode === row.entry.code}
                />
              ) : null,
            )}
            {isLoading ? (
              <div
                className="flex flex-col gap-3 rounded-md border p-4"
                aria-hidden
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col gap-2">
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-4 w-16" />
                  </div>
                  <Skeleton className="h-8 w-16" />
                </div>
                <span className="sr-only" role="status">
                  Checking for downloaded language packs…
                </span>
              </div>
            ) : (
              catalogView.downloaded.map((row) =>
                row.status === "downloaded" ? (
                  <LanguagePackRow
                    key={row.entry.code}
                    variant={{
                      kind: "downloaded",
                      entry: row.entry,
                      isActive: row.entry.code === activeCode,
                      version: row.version,
                      completeness: row.completeness,
                      updateAvailableVersion: row.updateAvailableVersion,
                      manifestEntry: row.manifestEntry,
                    }}
                    installState={install}
                    onInstall={handleInstall}
                    onCancelInstall={cancelInstall}
                    onRemove={handleRemove}
                    onSelectActive={handleSelectActive}
                    switching={switchingCode === row.entry.code}
                  />
                ) : null,
              )
            )}
          </CardContent>
        </Card>

        {/* Available: community packs from the manifest */}
        <Card className="@container/card">
          <CardHeader>
            <CardTitle>Available</CardTitle>
            <CardDescription>
              Community translation packs published for QManager.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {isLoading ? (
              <>
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="flex flex-col gap-3 rounded-md border p-4"
                    aria-hidden
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex flex-col gap-2">
                        <Skeleton className="h-5 w-40" />
                        <Skeleton className="h-4 w-20" />
                      </div>
                      <Skeleton className="h-8 w-24" />
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <Skeleton className="h-8 w-full" />
                      <Skeleton className="h-8 w-full" />
                      <Skeleton className="h-8 w-full" />
                      <Skeleton className="h-8 w-full" />
                    </div>
                  </div>
                ))}
                <span className="sr-only" role="status">
                  Loading available language packs…
                </span>
              </>
            ) : manifestError ? (
              <AnimatePresence initial={false}>
                <motion.div
                  key="manifest-error"
                  initial={{ opacity: 0, y: -6, height: 0 }}
                  animate={{ opacity: 1, y: 0, height: "auto" }}
                  exit={{ opacity: 0, y: -6, height: 0 }}
                  transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                  className="overflow-hidden"
                >
                  <Alert variant="destructive">
                    <TriangleAlertIcon />
                    <AlertTitle>Couldn&apos;t load the pack catalog</AlertTitle>
                    <AlertDescription className="flex flex-col gap-2">
                      <p>
                        The device couldn&apos;t reach the language-pack catalog on
                        GitHub. Check connectivity and try again.
                      </p>
                      <Button size="sm" variant="outline" onClick={() => refetch()}>
                        {t("actions.retry")}
                      </Button>
                    </AlertDescription>
                  </Alert>
                </motion.div>
              </AnimatePresence>
            ) : catalogView.available.length === 0 ? (
              <Empty className="border-none">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <LanguagesIcon />
                  </EmptyMedia>
                  <EmptyTitle>No community packs yet</EmptyTitle>
                  <EmptyDescription>
                    No downloadable language packs have been published for QManager
                    yet. Built-in languages are always available on the left.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              catalogView.available.map((row) =>
                row.status === "available" ? (
                  <LanguagePackRow
                    key={row.manifestEntry.code}
                    variant={{ kind: "available", manifestEntry: row.manifestEntry }}
                    installState={install}
                    onInstall={handleInstall}
                    onCancelInstall={cancelInstall}
                    onRemove={handleRemove}
                    onSelectActive={handleSelectActive}
                    switching={false}
                  />
                ) : null,
              )
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
