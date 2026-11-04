"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  CheckIcon,
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
import { SEGMENTED, SegmentedField } from "@/components/ui/segmented-field";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { TailscaleStatus } from "@/hooks/use-tailscale";
import { cn } from "@/lib/utils";

import { ConditionBlock } from "./condition-block";
import {
  CARD_BODY,
  CARD_DESC,
  CARD_HEAD,
  CARD_HEAD_TEXT,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
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
  isUpdating: boolean;
  connect: () => Promise<boolean>;
  disconnect: () => Promise<boolean>;
  logout: () => Promise<boolean>;
  startService: () => Promise<boolean>;
  stopService: () => Promise<boolean>;
  setBootEnabled: (enabled: boolean) => Promise<boolean>;
  setSshEnabled: (enabled: boolean) => Promise<boolean>;
}

/** The lucide check that SegmentedField reserves on every segment. */
const renderCheckGlyph = (className: string) => (
  <CheckIcon size={SEGMENTED.GLYPH} className={className} aria-hidden="true" />
);

/** A setting's tonal tile: rest is a surface container, on is a primary one.
 *  The control is an On/Off pill group, never a bare switch. */
function SettingRow({
  title,
  description,
  note,
  checked,
  disabled,
  onCheckedChange,
  control,
}: {
  title: string;
  description: string;
  note?: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (value: boolean) => void;
  /** Replaces the pill when it needs a hoverable wrapper for a tooltip. */
  control?: React.ReactNode;
}) {
  const { t } = useTranslation("common");
  return (
    <div
      className={cn(
        SWITCH_ROW.ROOT,
        SWITCH_ROW.TRANSITION,
        checked ? SWITCH_ROW.ON : SWITCH_ROW.REST,
      )}
    >
      <div className={SWITCH_ROW.TEXT}>
        <p className={SWITCH_ROW.TITLE}>{title}</p>
        <p className={SWITCH_ROW.DESC}>{description}</p>
        {note ? <p className={SWITCH_ROW.NOTE}>{note}</p> : null}
      </div>
      {control ?? (
        <SegmentedField
          value={checked ? "on" : "off"}
          onValueChange={(next) => onCheckedChange(next === "on")}
          ariaLabel={title}
          disabled={disabled}
          breakpoint="never"
          glyph={renderCheckGlyph}
          options={[
            { value: "off", label: t("tailscale.connection.off") },
            { value: "on", label: t("tailscale.connection.on") },
          ]}
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
  isUpdating,
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

  // An update swaps the binary under the running tunnel, so every action waits.
  const updating = isUpdating || status.busy === "update";
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
          disabled={isDisconnecting || updating}
          size="action"
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
            variant="destructive"
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
    <Loader2Icon className="size-4 motion-safe:animate-spin" />
  );

  let rail: React.ReactNode = null;
  if (view === "serviceStopped") {
    rail = (
      <Button
        type="button"
        size="action"
        disabled={isTogglingService || updating}
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
            size="action"
            disabled={isConnecting || updating}
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
          size="action"
          className={PILL_REST}
          disabled={isTogglingService || updating}
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
          size="action"
          className={PILL_REST}
          disabled={isDisconnecting || updating}
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
          size="action"
          disabled={isConnecting || updating}
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
        <div className={CARD_HEAD_TEXT}>
          <CardTitle className={CARD_TITLE}>
            {t("tailscale.connection.title")}
          </CardTitle>
          <CardDescription className={CARD_DESC}>
            {t("tailscale.connection.description")}
          </CardDescription>
        </div>
      </CardHeader>

      {/* No card-level `aria-live`: the health notice and the auth condition
          below are already live regions, and nesting them announces twice. */}
      <CardContent className={cn(CARD_PAD, CARD_BODY)}>
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
            actionHref={authUrl}
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
          title={t("tailscale.connection.bootTitle")}
          description={t("tailscale.connection.bootDescription")}
          checked={bootEnabled}
          onCheckedChange={handleBoot}
          disabled={updating}
        />

        <SettingRow
          title={t("tailscale.connection.sshTitle")}
          description={t("tailscale.connection.sshDescription")}
          note={sshPending ? t("tailscale.connection.sshPending") : undefined}
          checked={sshEnabled}
          onCheckedChange={handleSsh}
          control={
            sshLocked && !isTogglingSsh ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  {/* The pill is disabled, so the tooltip needs its own
                      target — a real tab stop, so it carries a name and a ring. */}
                  <span
                    tabIndex={0}
                    role="button"
                    aria-disabled
                    aria-label={t("tailscale.connection.sshTitle")}
                    className={SWITCH_ROW.CONTROL_WRAP}
                  >
                    <SegmentedField
                      value={sshEnabled ? "on" : "off"}
                      onValueChange={() => {}}
                      ariaLabel={t("tailscale.connection.sshTitle")}
                      disabled
                      breakpoint="never"
                      glyph={renderCheckGlyph}
                      options={[
                        { value: "off", label: t("tailscale.connection.off") },
                        { value: "on", label: t("tailscale.connection.on") },
                      ]}
                    />
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {t("tailscale.connection.sshLocked")}
                </TooltipContent>
              </Tooltip>
            ) : undefined
          }
          disabled={isTogglingSsh || updating}
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

/** Mirrors the loaded card's header structure and its switch tiles, both from
 *  the same constants, so the swap moves nothing. */
export function ConnectionCardSkeleton() {
  const { t } = useTranslation("common");
  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={cn(CARD_PAD, CARD_HEAD)}>
        <div className={CARD_HEAD_TEXT}>
          <CardTitle className={CARD_TITLE}>
            {t("tailscale.connection.title")}
          </CardTitle>
          <CardDescription className={CARD_DESC}>
            {t("tailscale.connection.description")}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className={cn(CARD_PAD, CARD_BODY)} aria-hidden>
        <Skeleton className={SKELETON.SWITCH} />
        <Skeleton className={SKELETON.SWITCH} />
        <Skeleton className={cn(SKELETON.ACTION, "w-40")} />
      </CardContent>
    </Card>
  );
}
