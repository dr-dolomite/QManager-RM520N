"use client";

import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { CircleAlertIcon, Loader2Icon } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CardFoot } from "@/components/ui/card-foot";
import { SaveButton } from "@/components/ui/save-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
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

import { useWebPort } from "@/hooks/use-web-port";
import { followMove, originForPorts } from "@/lib/web-port";
import { cn } from "@/lib/utils";

import { ConditionBlock } from "../condition-block";
import {
  CARD_BODY,
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  CONDITION_PANEL,
  GROUP_FILL,
  PORT_FIELD,
  PORT_GRID,
  ROW,
  ROW_GROUP,
  SKELETON_WEB_PORT,
} from "../shapes";

const K = "web_port";

// A move ends in navigation to the new origin, which is its success signal; only failures toast.
const LANDING_PATH = "/system-settings/device-access/";

type Phase = "idle" | "moving";

function parsePort(raw: string): number | null {
  if (!/^\d{1,5}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= 65535 ? n : null;
}

function WebPortHeader() {
  const { t } = useTranslation("system-settings");
  return (
    <CardHeader className={CARD_PAD}>
      <CardTitle className={CARD_TITLE}>{t(`${K}.card_title`)}</CardTitle>
      <CardDescription className={CARD_DESC}>
        {t(`${K}.card_description`)}
      </CardDescription>
    </CardHeader>
  );
}

function WebPortSkeleton() {
  return (
    <Card className={CARD_SHELL} aria-hidden="true">
      <WebPortHeader />
      <CardContent className={cn(CARD_PAD, CARD_BODY)}>
        <div className={cn(ROW_GROUP, GROUP_FILL, PORT_GRID)}>
          {[0, 1].map((i) => (
            <div key={i} className={ROW.ROOT}>
              <div className={ROW.TEXT}>
                <Skeleton className={cn(SKELETON_WEB_PORT.LABEL, "w-24")} />
                <Skeleton
                  className={cn(SKELETON_WEB_PORT.CONSEQUENCE, "w-56 max-w-full")}
                />
              </div>
              <div className={ROW.CONTROL}>
                <Skeleton className={SKELETON_WEB_PORT.FIELD} />
              </div>
            </div>
          ))}
        </div>
        <CardFoot
          className="mt-auto"
          liveStatus={false}
          actions={<Skeleton className={SKELETON_WEB_PORT.ACTION} />}
        />
      </CardContent>
    </Card>
  );
}

const WebPortCard = () => {
  const { t } = useTranslation("system-settings");
  const { state, isLoading, isSaving, save, refresh } = useWebPort();
  const httpId = useId();
  const httpsId = useId();

  const [httpDraft, setHttpDraft] = useState("");
  const [httpsDraft, setHttpsDraft] = useState("");
  const [seen, setSeen] = useState<string | null>(null);
  const savedKey = state ? `${state.httpPort}/${state.httpsPort}` : null;
  if (savedKey !== seen) {
    setSeen(savedKey);
    setHttpDraft(state ? String(state.httpPort) : "");
    setHttpsDraft(state ? String(state.httpsPort) : "");
  }

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  // Stops a follow in flight when the card unmounts, so it cannot navigate or refresh later.
  const followAbortRef = useRef<AbortController | null>(null);
  useEffect(() => () => followAbortRef.current?.abort(), []);

  if (isLoading && state === null) return <WebPortSkeleton />;

  if (state === null) {
    return (
      <Card className={CARD_SHELL}>
        <WebPortHeader />
        <CardContent className={cn(CARD_PAD, CARD_BODY)}>
          <ConditionBlock
            tone="destructive"
            glyph={CircleAlertIcon}
            ariaRole="alert"
            title={t(`${K}.error_title`)}
            description={t(`${K}.error_description`)}
            onRetry={refresh}
            retryLabel={t("common:actions.retry")}
            className={CONDITION_PANEL.SCREEN}
          />
        </CardContent>
      </Card>
    );
  }

  const httpPort = parsePort(httpDraft);
  const httpsPort = parsePort(httpsDraft);
  const dirty =
    httpDraft !== String(state.httpPort) ||
    httpsDraft !== String(state.httpsPort);
  const invalid = httpPort === null || httpsPort === null;
  const same = !invalid && httpPort === httpsPort;
  const canSave = dirty && !invalid && !same && phase === "idle";
  const target =
    canSave || phase === "moving"
      ? originForPorts(httpPort ?? 0, httpsPort ?? 0)
      : "";
  const fieldsDisabled = isSaving || phase === "moving";

  const discard = () => {
    setHttpDraft(String(state.httpPort));
    setHttpsDraft(String(state.httpsPort));
  };

  const handleSave = async () => {
    setConfirmOpen(false);
    if (httpPort === null || httpsPort === null) return;
    const result = await save(httpPort, httpsPort);
    if (!result.ok) {
      toast.error(result.error ?? t(`${K}.toast_failed`));
      return;
    }
    if (!result.moving) {
      toast.success(t(`${K}.toast_unchanged`));
      return;
    }
    setPhase("moving");
    const origin = originForPorts(
      result.httpPort ?? httpPort,
      result.httpsPort ?? httpsPort,
    );
    followAbortRef.current?.abort();
    const ctrl = new AbortController();
    followAbortRef.current = ctrl;
    const outcome = await followMove(origin, LANDING_PATH, { signal: ctrl.signal });
    if (outcome.kind === "navigated" || outcome.kind === "aborted") return;
    setPhase("idle");
    if (outcome.kind === "timeout") {
      toast.error(t(`${K}.toast_timeout`));
    } else if (outcome.origin === window.location.origin) {
      toast.error(t(`${K}.toast_unreachable`));
    } else {
      // This origin is gone; the rollback landed on the default ports.
      const back = outcome.origin;
      toast.error(t(`${K}.toast_back_on`, { origin: back }), {
        duration: Infinity,
        action: {
          label: t(`${K}.open_origin`),
          onClick: () => window.location.assign(`${back}${LANDING_PATH}`),
        },
      });
      return;
    }
    refresh();
  };

  const status =
    phase === "moving" ? (
      <span className="inline-flex items-center gap-2 font-medium">
        <Loader2Icon
          className="size-4 flex-none motion-safe:animate-spin"
          aria-hidden="true"
        />
        {t(`${K}.moving`, { origin: target })}
      </span>
    ) : dirty && invalid ? (
      <span className="text-destructive-on-surface font-medium">
        {t(`${K}.invalid`)}
      </span>
    ) : same ? (
      <span className="text-destructive-on-surface font-medium">
        {t(`${K}.same`)}
      </span>
    ) : dirty ? (
      <span className="font-medium">{t(`${K}.pending`, { origin: target })}</span>
    ) : null;

  const rows = [
    {
      id: httpId,
      key: "http",
      draft: httpDraft,
      port: httpPort,
      set: setHttpDraft,
    },
    {
      id: httpsId,
      key: "https",
      draft: httpsDraft,
      port: httpsPort,
      set: setHttpsDraft,
    },
  ] as const;

  return (
    <Card className={CARD_SHELL}>
      <WebPortHeader />
      <CardContent className={cn(CARD_PAD, CARD_BODY)}>
        <div className={cn(ROW_GROUP, GROUP_FILL, PORT_GRID)}>
          {rows.map((row) => (
            <div key={row.key} className={ROW.ROOT}>
              <div className={ROW.TEXT}>
                <label htmlFor={row.id} className={ROW.LABEL}>
                  {t(`${K}.${row.key}_label`)}
                </label>
                <span className={ROW.CONSEQUENCE}>
                  {t(`${K}.${row.key}_consequence`)}
                </span>
              </div>
              <div className={ROW.CONTROL}>
                <Input
                  id={row.id}
                  type="number"
                  inputMode="numeric"
                  host="container"
                  min={1}
                  max={65535}
                  step={1}
                  className={PORT_FIELD}
                  value={row.draft}
                  disabled={fieldsDisabled}
                  aria-invalid={
                    dirty && (row.port === null || same) ? true : undefined
                  }
                  onChange={(e) => row.set(e.target.value.trim())}
                />
              </div>
            </div>
          ))}
        </div>

        <CardFoot
          className="mt-auto"
          status={status}
          actions={
            <>
              <Button
                type="button"
                variant="ghost"
                size="action"
                onClick={discard}
                disabled={!dirty || fieldsDisabled}
              >
                {t("common:actions.discard")}
              </Button>
              <SaveButton
                onClick={() => setConfirmOpen(true)}
                isSaving={fieldsDisabled}
                saved={false}
                label={t("common:actions.apply")}
                disabled={!canSave}
                size="action"
              />
            </>
          }
        />
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(`${K}.confirm_title`)}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(`${K}.confirm_description`, { origin: target })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common:actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleSave();
              }}
            >
              {t(`${K}.confirm_action`)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};

export default WebPortCard;
