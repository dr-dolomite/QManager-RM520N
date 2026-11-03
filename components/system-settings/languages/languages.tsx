"use client";

import * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useLanguagePacks } from "@/hooks/use-language-packs";
import { AVAILABLE_LANGUAGES } from "@/lib/i18n/available-languages";
import { buildCatalogView } from "@/lib/i18n/language-pack-manifest";
import { installErrorKey, resolveErrorMessage } from "@/lib/i18n/resolve-error";
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

  // A failure's reason in locale text; device words only ever appear quoted as machine voice.
  const failureReason = React.useCallback(
    (code?: string | null, message?: string | null): string | undefined => {
      const key = installErrorKey(code);
      if (key) return t(key);
      const detail = message?.trim();
      if (code?.trim()) {
        return resolveErrorMessage(t, code, detail, t("unknown", { ns: "errors" }));
      }
      return detail ? t("unknown_with_detail", { ns: "errors", detail }) : undefined;
    },
    [t],
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
      // A refused start lands in `install` as a failed state, and the effect
      // below toasts it once, so there is no second toast here.
      void startInstall(code);
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
        toast.error(t(`${K}.toast.remove_failed`, { language: nameFor(code) }), {
          description: failureReason(res.error, res.error),
        });
        return;
      }
      toast.success(
        isActive
          ? t(`${K}.toast.removed_active`, { language: nameFor(code) })
          : t(`${K}.toast.removed`, { language: nameFor(code) }),
      );
    },
    [i18n, remove, nameFor, failureReason, t],
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
        id: `language-install-done-${code}`,
        action: {
          label: t(`${K}.toast.use_now`),
          onClick: () => handleSelect(code),
        },
      });
    } else if (install.state === "cancelled") {
      toast.info(t(`${K}.toast.install_cancelled`), {
        id: "language-install-cancelled",
      });
    } else if (install.state === "failed") {
      toast.error(
        install.code
          ? t(`${K}.toast.install_failed`, { language: nameFor(install.code) })
          : t(`${K}.toast.install_failed_generic`),
        {
          id: "language-install-failed",
          description: failureReason(install.error_code, install.message),
        },
      );
    }
  }, [
    install.state,
    install.code,
    install.message,
    install.error_code,
    nameFor,
    failureReason,
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
