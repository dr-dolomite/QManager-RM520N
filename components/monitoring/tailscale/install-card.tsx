"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  CheckCircle2Icon,
  CopyIcon,
  Loader2Icon,
  PackageIcon,
  RefreshCcwIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

import { ConditionBlock } from "./condition-block";
import { InstallLogViewer } from "./install-log-viewer";
import {
  CARD_BODY,
  CARD_DESC,
  CARD_HEAD,
  CARD_HEAD_TEXT,
  CARD_TITLE,
  COMMAND,
  HERO_PAD,
  HERO_SHELL,
  NOTICE,
  NOTICE_BODY,
  NOTICE_GLYPH,
  NOTICE_TONE,
  PILL_REST,
  RAIL,
  SKELETON,
} from "./shapes";

// -----------------------------------------------------------------------------
// Install — the not-installed hero. The only card on this shape.
// -----------------------------------------------------------------------------

export interface InstallResultShape {
  status: "idle" | "running" | "complete" | "error";
  message?: string;
  log?: string;
}

/** One labelled machine-voice row, replacing the "or install manually" ritual. */
function CommandRow({ command }: { command: string }) {
  const { t } = useTranslation("common");

  const copy = async () => {
    if (await copyText(command)) {
      toast.success(t("tailscale.toast.copied"));
    } else {
      toast.error(t("tailscale.toast.copyFailed"));
    }
  };

  return (
    <div className={COMMAND.ROOT}>
      <span className={COMMAND.LABEL}>{t("tailscale.install.manualLabel")}</span>
      <div className={COMMAND.BOX}>
        <code className={COMMAND.TEXT}>{command}</code>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={copy}
          className={COMMAND.COPY}
          aria-label={t("tailscale.install.copyCommand")}
        >
          <CopyIcon className="size-4" />
        </Button>
      </div>
    </div>
  );
}

export function InstallCard({
  installResult,
  runInstall,
  onRefresh,
  installHint,
}: {
  installResult: InstallResultShape;
  runInstall: () => Promise<void>;
  onRefresh: () => void;
  installHint?: string;
}) {
  const { t } = useTranslation("common");
  const running = installResult.status === "running";
  const command = installHint || "sudo qmanager_tailscale_mgr install";

  // One toast per finished install, fired when a run we watched ends. A result
  // that was already terminal on mount never toasts.
  const prevStatus = React.useRef(installResult.status);
  React.useEffect(() => {
    const prev = prevStatus.current;
    prevStatus.current = installResult.status;
    if (prev !== "running") return;
    if (installResult.status === "complete") {
      toast.success(t("tailscale.toast.installed"), { id: "tailscale-install" });
    } else if (installResult.status === "error") {
      toast.error(t("tailscale.toast.installFailed"), {
        id: "tailscale-install",
        description: installResult.message || undefined,
      });
    }
  }, [installResult.status, installResult.message, t]);
  const showLog =
    running ||
    ((installResult.status === "complete" ||
      installResult.status === "error") &&
      !!installResult.log);

  return (
    <Card className={HERO_SHELL}>
      <CardHeader className={cn(HERO_PAD, CARD_HEAD)}>
        <div className={CARD_HEAD_TEXT}>
          <CardTitle className={CARD_TITLE}>
            {t("tailscale.install.title")}
          </CardTitle>
          <CardDescription className={CARD_DESC}>
            {t("tailscale.install.description")}
          </CardDescription>
        </div>
      </CardHeader>

      {/* No card-level `aria-live`: the notices below and the transcript are
          already live regions, and nesting them announces twice. */}
      <CardContent className={cn(HERO_PAD, CARD_BODY)}>
        <ConditionBlock
          tone="muted"
          icon={PackageIcon}
          title={t("tailscale.install.conditionTitle")}
          description={t("tailscale.install.conditionDescription")}
        />

        {installResult.status === "complete" ? (
          <div role="status" className={cn(NOTICE, NOTICE_TONE.success)}>
            <CheckCircle2Icon className={NOTICE_GLYPH} />
            <span className={NOTICE_BODY}>
              {t("tailscale.install.done")}
            </span>
          </div>
        ) : null}

        {installResult.status === "error" ? (
          <div role="alert" className={cn(NOTICE, NOTICE_TONE.destructive)}>
            <TriangleAlertIcon className={NOTICE_GLYPH} />
            <span className={NOTICE_BODY}>
              {installResult.message || t("tailscale.install.failed")}
            </span>
          </div>
        ) : null}

        <div className={cn(RAIL, "justify-center")}>
          <Button
            type="button"
            size="action"
            onClick={runInstall}
            disabled={running}
          >
            {running ? (
              <Loader2Icon className="size-4 motion-safe:animate-spin" />
            ) : (
              <PackageIcon className="size-4" />
            )}
            {/* Never the backend's own message: a control's label has a width
                contract, and this surface ships in five locales. */}
            {running
              ? t("tailscale.install.installing")
              : t("tailscale.install.install")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="action"
            className={PILL_REST}
            onClick={onRefresh}
            disabled={running}
          >
            <RefreshCcwIcon className="size-4" />
            {t("tailscale.install.checkAgain")}
          </Button>
        </div>

        {showLog ? (
          <InstallLogViewer log={installResult.log ?? ""} isRunning={running} />
        ) : null}

        <CommandRow command={command} />
      </CardContent>
    </Card>
  );
}

/** Mirrors the hero from the same constants: real header copy, then the
 *  condition, the action and the command row at their pinned heights. */
export function InstallCardSkeleton() {
  const { t } = useTranslation("common");
  return (
    <Card className={HERO_SHELL}>
      <CardHeader className={cn(HERO_PAD, CARD_HEAD)}>
        <div className={CARD_HEAD_TEXT}>
          <CardTitle className={CARD_TITLE}>
            {t("tailscale.install.title")}
          </CardTitle>
          <CardDescription className={CARD_DESC}>
            {t("tailscale.install.description")}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className={cn(HERO_PAD, CARD_BODY)} aria-hidden>
        <Skeleton className={SKELETON.HERO_CONDITION} />
        <div className={cn(RAIL, "justify-center")}>
          <Skeleton className={cn(SKELETON.ACTION, "w-40")} />
        </div>
        <Skeleton className={SKELETON.HERO_COMMAND} />
      </CardContent>
    </Card>
  );
}
