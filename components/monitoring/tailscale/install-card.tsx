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
import { cn } from "@/lib/utils";

import { ConditionBlock } from "./condition-block";
import { InstallLogViewer } from "./install-log-viewer";
import {
  ACTION,
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
} from "./shapes";

// -----------------------------------------------------------------------------
// Install — the not-installed hero. The only card on this shape.
// -----------------------------------------------------------------------------

export interface InstallResultShape {
  status: "idle" | "running" | "complete" | "error";
  message?: string;
  detail?: string;
  log?: string;
}

/** One labelled machine-voice row, replacing the "or install manually" ritual. */
function CommandRow({ command }: { command: string }) {
  const { t } = useTranslation("common");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      toast.success(t("tailscale.toast.copied"));
    } catch {
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
              {installResult.message ?? t("tailscale.install.done")}
            </span>
          </div>
        ) : null}

        {installResult.status === "error" ? (
          <div role="alert" className={cn(NOTICE, NOTICE_TONE.destructive)}>
            <TriangleAlertIcon className={NOTICE_GLYPH} />
            <span className={NOTICE_BODY}>
              {installResult.message ?? t("tailscale.install.failed")}
              {installResult.detail ? (
                <span className="mt-0.5 block">{installResult.detail}</span>
              ) : null}
            </span>
          </div>
        ) : null}

        <div className={cn(RAIL, "justify-center")}>
          <Button
            type="button"
            className={ACTION}
            onClick={runInstall}
            disabled={running}
          >
            {running ? (
              <Loader2Icon className="size-4 animate-spin motion-reduce:animate-none" />
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
            className={cn(ACTION, PILL_REST)}
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
