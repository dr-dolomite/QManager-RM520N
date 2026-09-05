"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ExternalLinkIcon,
  Loader2Icon,
  LogInIcon,
  TriangleAlertIcon,
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tag } from "@/components/ui/tag";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { TailscaleStatus } from "@/hooks/use-tailscale";
import { cn } from "@/lib/utils";

import { ConditionBlock } from "./condition-block";
import {
  ACTION,
  CARD_BODY,
  CARD_DESC,
  CARD_HEAD,
  CARD_HEAD_ACTIONS,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  HEAD_TAG,
  LIVE_DOT,
  NOTICE,
  NOTICE_BODY,
  NOTICE_GLYPH,
  NOTICE_LIST,
  NOTICE_TONE,
  PILL_REST,
  RAIL,
  SKELETON,
  SWITCH_ROW,
  type TailscaleView,
} from "./shapes";

// -----------------------------------------------------------------------------
// Connection — what the link is doing, the two settings, and the action rail.
// -----------------------------------------------------------------------------

export interface ConnectionCardProps {
  view: TailscaleView;
  status: TailscaleStatus;
  isConnecting: boolean;
  isDisconnecting: boolean;
  isTogglingService: boolean;
  isTogglingSsh: boolean;
  connect: () => Promise<boolean>;
  disconnect: () => Promise<boolean>;
  logout: () => Promise<boolean>;
  startService: () => Promise<boolean>;
  stopService: () => Promise<boolean>;
  setBootEnabled: (enabled: boolean) => Promise<boolean>;
  setSshEnabled: (enabled: boolean) => Promise<boolean>;
}

/** A setting's tonal tile: rest is a surface container, on is a primary one. */
function SettingRow({
  id,
  title,
  description,
  note,
  checked,
  disabled,
  onCheckedChange,
  control,
}: {
  id: string;
  title: string;
  description: string;
  note?: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (value: boolean) => void;
  /** Replaces the switch when it needs a hoverable wrapper for a tooltip. */
  control?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        SWITCH_ROW.ROOT,
        SWITCH_ROW.TRANSITION,
        checked ? SWITCH_ROW.ON : SWITCH_ROW.REST,
      )}
    >
      <div className={SWITCH_ROW.TEXT}>
        <label htmlFor={id} className={cn(SWITCH_ROW.TITLE, "block")}>
          {title}
        </label>
        <p className={SWITCH_ROW.DESC}>{description}</p>
        {note ? <p className={SWITCH_ROW.NOTE}>{note}</p> : null}
      </div>
      {control ?? (
        <Switch
          id={id}
          checked={checked}
          disabled={disabled}
          onCheckedChange={onCheckedChange}
          className={SWITCH_ROW.CONTROL}
        />
      )}
    </div>
  );
}

export function ConnectionCard({
  view,
  status,
  isConnecting,
  isDisconnecting,
  isTogglingService,
  isTogglingSsh,
  connect,
  disconnect,
  logout,
  startService,
  stopService,
  setBootEnabled,
  setSshEnabled,
}: ConnectionCardProps) {
  const { t } = useTranslation("common");
  const [showSshDialog, setShowSshDialog] = React.useState(false);

  const version = status.version;
  const daemonRunning = status.daemon_running ?? false;
  const backendState = status.backend_state ?? "";
  const bootEnabled = status.enabled_on_boot ?? false;
  const sshEnabled = status.ssh_enabled ?? false;
  const authUrl = status.auth_url;

  // The accept-routes advisory is normal on this device and is not a fault.
  const health = (status.health ?? []).filter(
    (msg) => !msg.includes("--accept-routes"),
  );

  // `tailscale set` cannot reach a stopped daemon, and the flag-only path is
  // only meaningful at connect time.
  const sshLocked = !daemonRunning || backendState !== "Running";
  const sshPending = sshEnabled && sshLocked;

  const handleBoot = async (checked: boolean) => {
    const ok = await setBootEnabled(checked);
    if (ok) {
      toast.success(
        checked
          ? t("tailscale.toast.bootEnabled")
          : t("tailscale.toast.bootDisabled"),
      );
    } else {
      toast.error(t("tailscale.toast.bootFailed"));
    }
  };

  const handleSsh = async (checked: boolean) => {
    if (checked) {
      // `sshEnabled` is derived from server state, so the switch only reads
      // checked once the backend confirms on the next status fetch.
      setShowSshDialog(true);
      return;
    }
    const ok = await setSshEnabled(false);
    toast[ok ? "success" : "error"](
      ok ? t("tailscale.toast.sshDisabled") : t("tailscale.toast.sshDisableFailed"),
    );
  };

  const confirmSsh = async () => {
    setShowSshDialog(false);
    const ok = await setSshEnabled(true);
    toast[ok ? "success" : "error"](
      ok ? t("tailscale.toast.sshEnabled") : t("tailscale.toast.sshEnableFailed"),
    );
  };

  const run = async (
    action: () => Promise<boolean>,
    successKey: string,
    errorKey: string,
  ) => {
    const ok = await action();
    toast[ok ? "success" : "error"](ok ? t(successKey) : t(errorKey));
  };

  const logoutDialog = (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="destructive"
          disabled={isDisconnecting}
          className={ACTION}
        >
          {t("tailscale.connection.logout")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("tailscale.connection.logoutDialogTitle")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("tailscale.connection.logoutDialogDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("tailscale.actions.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() =>
              run(
                logout,
                "tailscale.toast.loggedOut",
                "tailscale.toast.logoutFailed",
              )
            }
          >
            {t("tailscale.connection.logout")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  const busyGlyph = (
    <Loader2Icon className="size-4 animate-spin motion-reduce:animate-none" />
  );

  let rail: React.ReactNode = null;
  if (view === "serviceStopped") {
    rail = (
      <Button
        type="button"
        className={ACTION}
        disabled={isTogglingService}
        onClick={() =>
          run(
            startService,
            "tailscale.toast.serviceStarted",
            "tailscale.toast.serviceStartFailed",
          )
        }
      >
        {isTogglingService ? busyGlyph : null}
        {isTogglingService
          ? t("tailscale.connection.starting")
          : t("tailscale.connection.startService")}
      </Button>
    );
  } else if (view === "needsLogin") {
    rail = (
      <>
        {authUrl ? null : (
          <Button
            type="button"
            className={ACTION}
            disabled={isConnecting}
            onClick={() =>
              run(
                connect,
                "tailscale.toast.connected",
                "tailscale.toast.connectFailed",
              )
            }
          >
            {isConnecting ? busyGlyph : null}
            {isConnecting
              ? t("tailscale.connection.connecting")
              : t("tailscale.connection.connect")}
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          className={cn(ACTION, PILL_REST)}
          disabled={isTogglingService}
          onClick={() =>
            run(
              stopService,
              "tailscale.toast.serviceStopped",
              "tailscale.toast.serviceStopFailed",
            )
          }
        >
          {isTogglingService ? busyGlyph : null}
          {isTogglingService
            ? t("tailscale.connection.stopping")
            : t("tailscale.connection.stopService")}
        </Button>
      </>
    );
  } else if (view === "running") {
    rail = (
      <>
        <Button
          type="button"
          variant="ghost"
          className={cn(ACTION, PILL_REST)}
          disabled={isDisconnecting}
          onClick={() =>
            run(
              disconnect,
              "tailscale.toast.disconnected",
              "tailscale.toast.disconnectFailed",
            )
          }
        >
          {isDisconnecting ? busyGlyph : null}
          {isDisconnecting
            ? t("tailscale.connection.disconnecting")
            : t("tailscale.connection.disconnect")}
        </Button>
        {logoutDialog}
      </>
    );
  } else {
    rail = (
      <>
        <Button
          type="button"
          className={ACTION}
          disabled={isConnecting}
          onClick={() =>
            run(
              connect,
              "tailscale.toast.connected",
              "tailscale.toast.connectFailed",
            )
          }
        >
          {isConnecting ? busyGlyph : null}
          {isConnecting
            ? t("tailscale.connection.connecting")
            : t("tailscale.connection.connect")}
        </Button>
        {logoutDialog}
      </>
    );
  }

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={cn(CARD_PAD, CARD_HEAD)}>
        <div className="flex min-w-0 flex-col gap-1.5">
          <CardTitle className={CARD_TITLE}>
            {t("tailscale.connection.title")}
          </CardTitle>
          <CardDescription className={CARD_DESC}>
            {t("tailscale.connection.description")}
          </CardDescription>
        </div>
        {version ? (
          <div className={CARD_HEAD_ACTIONS}>
            <Tag variant="neutral" className={HEAD_TAG}>
              {t("tailscale.connection.version", { version })}
            </Tag>
          </div>
        ) : null}
      </CardHeader>

      <CardContent className={cn(CARD_PAD, CARD_BODY)} aria-live="polite">
        {health.length > 0 ? (
          <div role="alert" className={cn(NOTICE, NOTICE_TONE.warning)}>
            <TriangleAlertIcon className={NOTICE_GLYPH} />
            <div className={cn(NOTICE_BODY, NOTICE_LIST)}>
              {health.map((msg) => (
                <span key={msg}>{msg}</span>
              ))}
            </div>
          </div>
        ) : null}

        {view === "needsLogin" && authUrl ? (
          <ConditionBlock
            tone="warning"
            icon={LogInIcon}
            title={t("tailscale.connection.authTitle")}
            description={t("tailscale.connection.authDescription")}
            actionLabel={t("tailscale.connection.openLogin")}
            actionIcon={ExternalLinkIcon}
            onAction={() =>
              window.open(authUrl, "_blank", "noopener,noreferrer")
            }
            footer={
              <>
                {/* The surface's one ambient loop, and only while it waits. */}
                <span aria-hidden className={LIVE_DOT} />
                {t("tailscale.connection.authWaiting")}
              </>
            }
          />
        ) : null}

        <SettingRow
          id="tailscale-boot"
          title={t("tailscale.connection.bootTitle")}
          description={t("tailscale.connection.bootDescription")}
          checked={bootEnabled}
          onCheckedChange={handleBoot}
        />

        <SettingRow
          id="tailscale-ssh"
          title={t("tailscale.connection.sshTitle")}
          description={t("tailscale.connection.sshDescription")}
          note={sshPending ? t("tailscale.connection.sshPending") : undefined}
          checked={sshEnabled}
          onCheckedChange={handleSsh}
          control={
            sshLocked && !isTogglingSsh ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  {/* The Switch is disabled, so the tooltip needs its own target. */}
                  <span tabIndex={0} className={SWITCH_ROW.CONTROL}>
                    <Switch
                      id="tailscale-ssh"
                      checked={sshEnabled}
                      onCheckedChange={handleSsh}
                      disabled
                    />
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {t("tailscale.connection.sshLocked")}
                </TooltipContent>
              </Tooltip>
            ) : undefined
          }
          disabled={isTogglingSsh}
        />

        <div className={RAIL}>{rail}</div>
      </CardContent>

      <AlertDialog open={showSshDialog} onOpenChange={setShowSshDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("tailscale.connection.sshDialogTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("tailscale.connection.sshDialogDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("tailscale.actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSsh}>
              {t("tailscale.connection.sshConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

/** Mirrors the loaded card's switch tiles from the same floor constant. */
export function ConnectionCardSkeleton() {
  const { t } = useTranslation("common");
  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={CARD_PAD}>
        <CardTitle className={CARD_TITLE}>
          {t("tailscale.connection.title")}
        </CardTitle>
        <CardDescription className={CARD_DESC}>
          {t("tailscale.connection.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className={cn(CARD_PAD, CARD_BODY)} aria-hidden>
        <Skeleton className={SKELETON.SWITCH} />
        <Skeleton className={SKELETON.SWITCH} />
        <Skeleton className={cn(SKELETON.ACTION, "w-40")} />
      </CardContent>
    </Card>
  );
}
