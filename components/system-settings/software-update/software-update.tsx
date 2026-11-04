"use client";

import * as React from "react";
import { DownloadIcon, RotateCwIcon, ServerOffIcon } from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import ConditionBlock from "@/components/system-settings/condition-block";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Banner, bannerActionVariants } from "@/components/ui/banner";
import { useSoftwareUpdate } from "@/hooks/use-software-update";
import { staggerContainer, staggerItem } from "@/lib/motion";

import { AnchorCardSkeleton, NotesCardSkeleton } from "./card-skeleton";
import PageHeader from "./page-header";
import ReleaseNotesCard from "./release-notes-card";
import StatusBand from "./status-band";
import UpdateCard from "./update-card";
import UpdatePreferencesCard from "./update-preferences-card";
import VersionManagementCard from "./version-management-card";
import {
  installedState,
  isPackageStaged,
  packageSize as resolvePackageSize,
  resolveFailure,
  resolveView,
} from "./derive";
import {
  CARD_GRID,
  CARD_GRID_SOLO,
  DIALOG_MOTION,
  ERROR_STATE,
  FOCUS_RING_ON_SURFACE,
  PAGE_ROOT,
  PILL_GLYPH,
} from "./shapes";

const K = "software_update";

export function SoftwareUpdate(): React.JSX.Element {
  const { t } = useTranslation("system-settings");
  const {
    updateInfo,
    updateStatus,
    downloadState,
    isLoading,
    isChecking,
    isUpdating,
    isDownloading,
    error,
    errorKind,
    isInstallStalled,
    lastChecked,
    checkForUpdates,
    downloadUpdate,
    installStaged,
    installVersion,
    rebootDevice,
    togglePrerelease,
    saveAutoUpdate,
  } = useSoftwareUpdate();

  // The one union every child reads, so nothing infers state from a payload.
  const view = resolveView({
    isLoading,
    error,
    errorKind,
    updateInfo,
    updateStatus,
    downloadState,
    isUpdating,
    isDownloading,
  });
  const failure = resolveFailure(
    updateInfo,
    error,
    errorKind,
    downloadState,
    view === "installing" && isInstallStalled,
  );
  const packageSize = resolvePackageSize(updateInfo);
  const packageStaged = isPackageStaged(downloadState, updateInfo);

  // The version select and its confirm live here so the interrupted-install
  // banner can preselect a build and open the dialog from outside the card.
  const [selectedVersion, setSelectedVersion] = React.useState("");
  const [versionDialogOpen, setVersionDialogOpen] = React.useState(false);
  const [installDialogOpen, setInstallDialogOpen] = React.useState(false);
  const [rebootDialogOpen, setRebootDialogOpen] = React.useState(false);

  const running = view === "installing" || view === "rebooting";
  const interrupted = installedState(updateInfo) === "interrupted";
  const pendingVersion = updateInfo?.pending_version ?? null;

  // Neither rejects — a failure lands in `errorKind` and repaints the view.
  const handleDownload = React.useCallback(async () => {
    await downloadUpdate();
  }, [downloadUpdate]);

  const handleInstallStaged = React.useCallback(async () => {
    setInstallDialogOpen(false);
    await installStaged();
  }, [installStaged]);

  // The reboot is the navigation hand-off, so success shows no toast.
  const handleReboot = React.useCallback(() => {
    setRebootDialogOpen(false);
    rebootDevice();
  }, [rebootDevice]);

  const resumeInterrupted = React.useCallback(() => {
    if (!pendingVersion) return;
    setSelectedVersion(pendingVersion);
    setVersionDialogOpen(true);
  }, [pendingVersion]);

  return (
    <motion.div
      className={PAGE_ROOT}
      initial="hidden"
      animate="visible"
      variants={staggerContainer}
    >
      {/* A standing condition, so it carries no dismiss and no motion wrapper —
          `Banner` owns its own entrance. */}
      {/* The condition, not the CTA, decides whether this renders: the Installed
          tile already flips to warning without a pending version. */}
      {interrupted && (
        <Banner
          role="degraded"
          title={t(`${K}.banner.title`)}
          description={
            pendingVersion
              ? t(`${K}.banner.description`, {
                  version: updateInfo?.current_version ?? "",
                  pending: pendingVersion,
                })
              : t(`${K}.banner.description_unknown`, {
                  version: updateInfo?.current_version ?? "",
                })
          }
          action={
            pendingVersion ? (
              <button
                type="button"
                onClick={resumeInterrupted}
                className={bannerActionVariants({ tone: "on-warning" })}
              >
                {t(`${K}.banner.action`)}
              </button>
            ) : undefined
          }
        />
      )}

      <PageHeader
        view={view}
        failure={failure}
        isChecking={isChecking}
        onCheck={() => void checkForUpdates()}
      />

      <StatusBand
        view={view}
        failure={failure}
        info={updateInfo}
        packageSize={packageSize}
        lastChecked={lastChecked}
      />

      {view === "loading" ? (
        <div className={CARD_GRID}>
          <AnchorCardSkeleton />
          <NotesCardSkeleton />
        </div>
      ) : view === "unreachable" ? (
        // This branch mounts AFTER the page root settled, so it declares its
        // own directions: a variants-only child that mounts late renders blank.
        <motion.div
          variants={staggerItem}
          initial="hidden"
          animate="visible"
          className={ERROR_STATE.ROOT}
        >
          <ConditionBlock
            tone="destructive"
            glyph={ServerOffIcon}
            ariaRole="alert"
            title={t(`${K}.states.unreachable.title`)}
            description={t(`${K}.states.unreachable.description`)}
            detail={
              error ? <p className={ERROR_STATE.DETAIL}>{error}</p> : undefined
            }
            onRetry={() => void checkForUpdates()}
            retryLabel={t(`${K}.actions.retry`)}
            className={ERROR_STATE.BLOCK}
          />
        </motion.div>
      ) : (
        // `display: contents` keeps these in the page's flex column while
        // giving the late-mounting group its own cascade root: a variants-only
        // child that mounts after its parent settled renders blank.
        <motion.div
          className="contents"
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
        >
          {/* The anchor and the notes share a row. The wrapper keeps its
              identity across a run, so the anchor never remounts. */}
          <div className={running ? CARD_GRID_SOLO : CARD_GRID}>
            <UpdateCard
              view={view}
              info={updateInfo}
              failure={failure}
              packageStaged={packageStaged}
              onDownload={() => void handleDownload()}
              onInstall={() => setInstallDialogOpen(true)}
              onReboot={() => setRebootDialogOpen(true)}
            />

            {/* Download and verify leave the page whole; only a run that is
                replacing files takes the notes away. */}
            {!running && <ReleaseNotesCard view={view} info={updateInfo} />}
          </div>

          {!running && (
            <>
              <div className={CARD_GRID}>
                <UpdatePreferencesCard
                  view={view}
                  info={updateInfo}
                  busy={isUpdating || isDownloading}
                  togglePrerelease={togglePrerelease}
                  saveAutoUpdate={saveAutoUpdate}
                />
                <VersionManagementCard
                  view={view}
                  info={updateInfo}
                  busy={isUpdating || isDownloading}
                  packageSize={packageSize}
                  selectedVersion={selectedVersion}
                  onSelectVersion={setSelectedVersion}
                  dialogOpen={versionDialogOpen}
                  onDialogOpenChange={setVersionDialogOpen}
                  onInstallVersion={installVersion}
                />
              </div>
            </>
          )}
        </motion.div>
      )}

      {/* The staged package still gets a confirm: the pill's one click is what
          restarts the modem. */}
      <AlertDialog open={installDialogOpen} onOpenChange={setInstallDialogOpen}>
        <AlertDialogContent className={DIALOG_MOTION}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(`${K}.versions.dialog.title_install`, {
                version: updateInfo?.latest_version ?? "",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {[
                t(`${K}.versions.dialog.description_install`, {
                  version: updateInfo?.latest_version ?? "",
                  current: updateInfo?.current_version ?? "",
                }),
                packageSize
                  ? t(`${K}.versions.dialog.size`, { size: packageSize })
                  : null,
                t(`${K}.versions.dialog.warning`),
              ]
                .filter(Boolean)
                .join(" ")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            {/* The gap takes the DIALOG's ground, which is `bg-surface`. */}
            <AlertDialogCancel className={FOCUS_RING_ON_SURFACE}>
              {t(`${K}.versions.dialog.cancel`)}
            </AlertDialogCancel>
            <AlertDialogAction
              className={FOCUS_RING_ON_SURFACE}
              onClick={() => void handleInstallStaged()}
            >
              <DownloadIcon className={PILL_GLYPH} aria-hidden="true" />
              {t(`${K}.versions.dialog.confirm_install`)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* A stalled install is rescued by a manual restart, so it is confirmed. */}
      <AlertDialog open={rebootDialogOpen} onOpenChange={setRebootDialogOpen}>
        <AlertDialogContent className={DIALOG_MOTION}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(`${K}.stall_dialog.title`)}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(`${K}.stall_dialog.description`)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className={FOCUS_RING_ON_SURFACE}>
              {t(`${K}.stall_dialog.cancel`)}
            </AlertDialogCancel>
            <AlertDialogAction
              className={FOCUS_RING_ON_SURFACE}
              onClick={handleReboot}
            >
              <RotateCwIcon className={PILL_GLYPH} aria-hidden="true" />
              {t(`${K}.stall_dialog.confirm`)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}

export default SoftwareUpdate;
