"use client";

import * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useLanguagePacks } from "@/hooks/use-language-packs";
import { AVAILABLE_LANGUAGES } from "@/lib/i18n/available-languages";
import { buildCatalogView } from "@/lib/i18n/language-pack-manifest";
import { installErrorKey } from "@/lib/i18n/resolve-error";
import { switchLanguage } from "@/lib/i18n/runtime-pack";
import { staggerContainer } from "@/lib/motion";

import CardSkeleton from "./card-skeleton";
import CommunityPacksCard from "./community-packs-card";
import DisplayLanguageCard from "./display-language-card";
import PageHeader from "./page-header";
import StatusBand from "./status-band";
import { isInstallActive, languageRows, packRows } from "./derive";
import { PAGE_ROOT } from "./shapes";

const K = "languages";

export function Languages(): React.JSX.Element {
  const { t, i18n } = useTranslation("system-settings");
  const {
    list,
    isLoading,
    isRefetching,
    listError,
    install,
    startInstall,
    cancelInstall,
    remove,
    refetch,
  } = useLanguagePacks();

  const [switchingCode, setSwitchingCode] = React.useState<string | null>(null);

  const activeCode = i18n.language;

  const view = React.useMemo(
    () =>
      buildCatalogView({
        catalog: AVAILABLE_LANGUAGES,
        installed: list?.installed ?? [],
        manifest: list?.manifest ?? null,
      }),
    [list],
  );

  const rows = React.useMemo(() => languageRows(view), [view]);
  const packs = React.useMemo(() => packRows(view), [view]);

  // A failed GET and a failed manifest fetch are the same fact to this page:
  // the catalog could not be read. Installed languages are unaffected either way.
  const catalogError = listError ?? list?.manifest_error ?? null;

  const nameFor = React.useCallback(
    (code: string) =>
      rows.find((row) => row.code === code)?.englishName ??
      packs.find((pack) => pack.code === code)?.englishName ??
      code,
    [rows, packs],
  );

  const handleSelect = React.useCallback(
    (code: string) => {
      if (code === activeCode || switchingCode) return;
      setSwitchingCode(code);
      void (async () => {
        try {
          const ok = await switchLanguage(i18n, code);
          if (ok) {
            toast.success(
              t(`${K}.toast.switched`, { language: nameFor(code) }),
            );
          } else {
            toast.error(
              t(`${K}.toast.switch_failed`, { language: nameFor(code) }),
              { description: t(`${K}.toast.switch_failed_detail`) },
            );
          }
        } finally {
          setSwitchingCode(null);
        }
      })();
    },
    [activeCode, switchingCode, i18n, nameFor, t],
  );

  const handleInstall = React.useCallback(
    (code: string) => {
      toast.info(t(`${K}.toast.installing`, { language: nameFor(code) }));
      void (async () => {
        const res = await startInstall(code);
        if (res.ok) return;
        const key = installErrorKey(res.error);
        toast.error(
          t(`${K}.toast.install_failed`, { language: nameFor(code) }),
          { description: key ? t(key) : res.error || undefined },
        );
      })();
    },
    [startInstall, nameFor, t],
  );

  const handleRemove = React.useCallback(
    async (code: string, isActive: boolean) => {
      // Switch to English BEFORE the delete, so i18next never tries to resolve
      // against resources that are no longer on disk.
      if (isActive) await switchLanguage(i18n, "en");
      const res = await remove(code);
      if (!res.ok) {
        const key = installErrorKey(res.error);
        toast.error(t(`${K}.toast.remove_failed`, { language: nameFor(code) }), {
          description: key ? t(key) : res.error || undefined,
        });
        return;
      }
      toast.success(
        isActive
          ? t(`${K}.toast.removed_active`, { language: nameFor(code) })
          : t(`${K}.toast.removed`, { language: nameFor(code) }),
      );
    },
    [i18n, remove, nameFor, t],
  );

  // Surface the install's terminal state once, on the transition into it. On
  // success the toast carries a one-tap switch to the pack just downloaded.
  const prevStateRef = React.useRef(install.state);
  React.useEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = install.state;
    if (!isInstallActive(prev)) return;

    if (install.state === "done" && install.code) {
      const code = install.code;
      toast.success(t(`${K}.toast.installed`, { language: nameFor(code) }), {
        action: {
          label: t(`${K}.toast.use_now`),
          onClick: () => handleSelect(code),
        },
      });
    } else if (install.state === "cancelled") {
      toast.info(t(`${K}.toast.install_cancelled`));
    } else if (install.state === "failed") {
      const key = installErrorKey(install.error_code);
      toast.error(t(`${K}.toast.install_failed_generic`), {
        description: key ? t(key) : install.message || undefined,
      });
    }
  }, [
    install.state,
    install.code,
    install.message,
    install.error_code,
    nameFor,
    handleSelect,
    t,
  ]);

  return (
    <motion.div
      className={PAGE_ROOT}
      initial="hidden"
      animate="visible"
      variants={staggerContainer}
    >
      <PageHeader
        isLoading={isLoading}
        isRefetching={isRefetching}
        onRefresh={() => void refetch()}
      />

      <StatusBand
        view={view}
        activeCode={activeCode}
        isLoading={isLoading}
        catalogError={catalogError}
        listFailed={Boolean(listError)}
      />

      {isLoading ? (
        <CardSkeleton />
      ) : (
        <>
          <DisplayLanguageCard
            rows={rows}
            activeCode={activeCode}
            switchingCode={switchingCode}
            onSelect={handleSelect}
            onRemove={handleRemove}
          />
          <CommunityPacksCard
            packs={packs}
            catalogError={catalogError}
            install={install}
            onInstall={handleInstall}
            onCancel={() => void cancelInstall()}
            onRetry={() => void refetch()}
          />
        </>
      )}
    </motion.div>
  );
}

export default Languages;
