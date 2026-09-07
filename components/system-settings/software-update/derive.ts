import type {
  DownloadState,
  UpdateErrorKind,
  UpdateInfo,
  UpdateStatus,
} from "@/hooks/use-software-update";

import type {
  InstalledState,
  LatestState,
  StepKey,
  StepState,
} from "./shapes";

/**
 * The whole surface's single source of truth. Every child reads this union; no
 * component infers state from a payload's shape.
 */
export type UpdateView =
  | "loading"
  | "unreachable"
  | "check_failed"
  | "up_to_date"
  | "available"
  | "downloading"
  | "verifying"
  | "staged"
  | "installing"
  | "rebooting";

export interface ViewInput {
  isLoading: boolean;
  error: string | null;
  errorKind: UpdateErrorKind | null;
  updateInfo: UpdateInfo | null;
  updateStatus: UpdateStatus;
  downloadState: DownloadState | null;
  isUpdating: boolean;
  isDownloading: boolean;
}

/** Highest precedence first: a run in flight outranks anything the GET says. */
export function resolveView(input: ViewInput): UpdateView {
  const {
    isLoading,
    error,
    errorKind,
    updateInfo,
    updateStatus,
    downloadState,
    isUpdating,
    isDownloading,
  } = input;

  if (isLoading) return "loading";
  if (error && !updateInfo) return "unreachable";
  if (updateStatus.status === "rebooting") return "rebooting";
  if (isUpdating && updateStatus.status === "installing") return "installing";
  if (downloadState?.status === "verifying") return "verifying";
  // Both halves are gated on a run being in flight: a status left over from a
  // request that failed would otherwise spin a disabled pill forever.
  if ((isUpdating || isDownloading) && updateStatus.status === "downloading") {
    return "downloading";
  }
  if (isDownloading || downloadState?.status === "downloading") {
    return "downloading";
  }
  // ABOVE `staged`: a failed install leaves a ready package behind, and the
  // page must not repaint as though the click never happened.
  if (resolveFailure(updateInfo, error, errorKind, downloadState)) {
    return "check_failed";
  }
  if (isPackageStaged(downloadState, updateInfo)) return "staged";
  if (updateInfo?.update_available === true) return "available";
  return "up_to_date";
}

export type FailureKind = "check" | "download" | "install";

export interface FailureDetail {
  kind: FailureKind;
  message: string;
}

/**
 * Which sentence is honest when the view is `check_failed`. All three failures
 * land on one view for layout, so this is the single place that separates
 * them — a component reading `downloadState.status` itself is the defect the
 * union exists to stop.
 */
export function resolveFailure(
  info: UpdateInfo | null,
  error: string | null,
  errorKind: UpdateErrorKind | null,
  downloadState: DownloadState | null,
): FailureDetail | null {
  if (errorKind) {
    const fromDownload =
      errorKind === "download" ? downloadState?.message?.trim() : undefined;
    return { kind: errorKind, message: fromDownload || error?.trim() || "" };
  }
  if (downloadState?.status === "error") {
    return { kind: "download", message: downloadState.message?.trim() ?? "" };
  }
  const message = info?.check_error?.trim() || "";
  return message ? { kind: "check", message } : null;
}

/** The Latest-release tile's face, read off the one union. */
export function latestState(
  view: UpdateView,
  lastChecked: string | null,
  failure: FailureDetail | null,
): LatestState {
  switch (view) {
    case "available":
      return "available";
    case "downloading":
      return "downloading";
    case "verifying":
      return "verifying";
    case "staged":
      return "verified";
    case "installing":
    case "rebooting":
      return "installing";
    case "check_failed":
    case "unreachable":
      // The kind picks the glyph and the caption; the tone is destructive for
      // all three, so the glyph is the only thing that separates them.
      return failure?.kind === "download"
        ? "download_failed"
        : failure?.kind === "install"
          ? "install_failed"
          : "check_failed";
    case "up_to_date":
      return lastChecked === null ? "never_checked" : "up_to_date";
    default:
      return "never_checked";
  }
}

/** Read defensively: an older device's payload omits the field entirely. */
export function installedState(info: UpdateInfo | null): InstalledState {
  return info?.previous_install_failed === true ? "interrupted" : "normal";
}

/** Which of the four ladder rows is live, or `null` when nothing is running. */
export function activeStepIndex(view: UpdateView): number | null {
  switch (view) {
    case "downloading":
      return 0;
    case "verifying":
      return 1;
    case "installing":
      return 2;
    case "rebooting":
      return 3;
    default:
      return null;
  }
}

/** A `ready` marker for the build already running is stale, not an offer. */
export function isPackageStaged(
  downloadState: DownloadState | null,
  info: UpdateInfo | null,
): boolean {
  return (
    downloadState?.status === "ready" &&
    downloadState.version !== info?.current_version
  );
}

const AT_REST: Record<StepKey, StepState> = {
  download: "pending",
  verify: "pending",
  install: "pending",
  reboot: "pending",
};

/** All four rows always exist; a run changes their tone rather than the list. */
export function stepStates(
  view: UpdateView,
  packageStaged = false,
): Record<StepKey, StepState> {
  switch (view) {
    case "downloading":
      return { ...AT_REST, download: "active" };
    case "verifying":
      return { ...AT_REST, download: "done", verify: "active" };
    case "staged":
      return { ...AT_REST, download: "done", verify: "done" };
    case "installing":
      return {
        download: "done",
        verify: "done",
        install: "active",
        reboot: "pending",
      };
    case "rebooting":
      return {
        download: "done",
        verify: "done",
        install: "done",
        reboot: "active",
      };
    // A failed install leaves a verified package behind, so those two rows
    // stay done — the header offers to install it again, not to re-download.
    default:
      return packageStaged
        ? { ...AT_REST, download: "done", verify: "done" }
        : { ...AT_REST };
  }
}

/** The release asset's own size, which is where the real figure lives. */
export function latestAssetSize(info: UpdateInfo | null): string | null {
  if (!info?.latest_version) return null;
  return (
    info.available_versions.find((v) => v.tag === info.latest_version)
      ?.asset_size ?? null
  );
}

/**
 * `update.sh` sets `download_size` to an empty string unconditionally, so it is
 * never a figure on any device; the real one is on the matching release asset.
 */
export function packageSize(info: UpdateInfo | null): string | null {
  const declared = info?.download_size?.trim();
  return declared ? declared : latestAssetSize(info);
}

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * Keyed through i18n rather than returning English. `nowMs` is an argument so
 * the caller owns the clock — a render-time clock read is impure.
 */
export function formatRelativeTime(
  iso: string | null,
  nowMs: number,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;

  const elapsed = Math.max(0, nowMs - then);
  if (elapsed < MINUTE_MS) return t("software_update.time.just_now");

  const pick = (unit: "minutes" | "hours" | "days", value: number) =>
    t(
      value === 1
        ? `software_update.time.${unit}_one`
        : `software_update.time.${unit}`,
      { value },
    );

  if (elapsed < HOUR_MS) return pick("minutes", Math.floor(elapsed / MINUTE_MS));
  if (elapsed < DAY_MS) return pick("hours", Math.floor(elapsed / HOUR_MS));
  return pick("days", Math.floor(elapsed / DAY_MS));
}

/** The release channel the device is tracking, as a locale-key fragment. */
export function channelKey(
  info: UpdateInfo | null,
): "prerelease" | "stable" {
  return info?.include_prerelease === true ? "prerelease" : "stable";
}
