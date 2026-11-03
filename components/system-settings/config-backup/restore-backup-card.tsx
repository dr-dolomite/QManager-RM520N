"use client";

import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  ArchiveRestoreIcon,
  CircleAlertIcon,
  FileUpIcon,
  InfoIcon,
  Loader2Icon,
  TriangleAlertIcon,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { CardFoot } from "@/components/ui/card-foot";
import { SLOT } from "@/components/auth/interpolation-slot";
import { useConfigRestore } from "@/hooks/use-config-restore";
import { useModemStatus } from "@/hooks/use-modem-status";
import type { UseBackupSupportReturn } from "@/hooks/use-config-backup";
import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import { effectiveKeys, restoreSelection, type SelectionMap } from "@/lib/config-backup/sections";
import { clearPendingReboot, enterRebootFlow, requestRebootLater } from "@/lib/reboot";
import { cn } from "@/lib/utils";
import type { BackupSectionKey } from "@/types/config-backup";

import {
  CARD_BODY,
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  DROP,
  FIELD,
  IMEI_TEXT,
  NOTICE,
  PICK,
  PILL_GLYPH,
  RECEIPT,
  ROW,
  ROW_GROUP,
  STACK_ROW,
} from "../shapes";
import { BACKUP_PASSPHRASE_ID } from "./config-backup-card";
import { RestorePipelineDialog, type PipelinePhase } from "./restore-pipeline-dialog";
import { SectionPicker } from "./section-picker";

const K = "config_backup.restore";
const SLOT_2 = "\u0001";

/** Drops two styled values into an interpolated sentence; translators keep word order. */
function twoSlots(template: string, a: ReactNode, b: ReactNode): ReactNode {
  return template.split(/(\u0000|\u0001)/).map((part, i) => (
    <Fragment key={i}>{part === SLOT ? a : part === SLOT_2 ? b : part}</Fragment>
  ));
}

/** The IMEI a backup would write: the section's own value, else the header's. */
function backupImei(section: unknown, headerImei: string): string {
  if (typeof section === "string" && section) return section;
  if (section && typeof section === "object") {
    const v = (section as { imei?: unknown }).imei;
    if (typeof v === "string" && v) return v;
  }
  return headerImei;
}

/** Profile IMEIs in the backup that differ from this modem's. */
function differingProfileImeis(section: unknown, current: string): number {
  if (!section || typeof section !== "object") return 0;
  const list = (section as { profiles?: unknown }).profiles;
  if (!Array.isArray(list)) return 0;
  return list.filter((p) => {
    const v = p && typeof p === "object" ? (p as { imei?: unknown }).imei : undefined;
    return typeof v === "string" && v !== "" && v !== current;
  }).length;
}

const RestoreConfigBackupCard = ({ support }: { support: UseBackupSupportReturn }) => {
  const { t } = useTranslation("system-settings");
  const modem = useModemStatus();
  const currentModel = modem.data?.device.model ?? "";
  const currentImei = modem.data?.device.imei ?? "";
  const { state, planned, readFile, tryPassword, startApply, cancel, reset } = useConfigRestore();

  const fileInput = useRef<HTMLInputElement>(null);
  const passId = useId();
  const [passphrase, setPassphrase] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  // Edits over the restore defaults; derived, so a new file starts clean.
  const [edits, setEdits] = useState<SelectionMap>({});
  const [imeiConfirmed, setImeiConfirmed] = useState(false);
  // Optional: unconfirmed, the backend clears the differing profile IMEIs and keeps the rest.
  const [profileImeiKept, setProfileImeiKept] = useState(false);
  const [pipelineOpen, setPipelineOpen] = useState(false);
  const [stopRequested, setStopRequested] = useState(false);
  const [rebootDialogOpen, setRebootDialogOpen] = useState(false);
  const [rebootBusy, setRebootBusy] = useState(false);

  const { ui, envelope, progress, payload } = state;

  const selection = useMemo(
    () => ({ ...restoreSelection(planned), ...edits }),
    [planned, edits],
  );
  // Sections the build lacks stay listed but can never be sent.
  const unsupported = useMemo(() => {
    if (!support.supported) return null;
    return new Set(planned.filter((k) => !support.supported!.has(k)));
  }, [planned, support.supported]);
  const chosen = useMemo(
    () => effectiveKeys(selection).filter((k) => !unsupported?.has(k)),
    [selection, unsupported],
  );

  const imeiFromBackup = envelope ? backupImei(payload?.sections.imei, envelope.device.imei) : "";
  const imeiOn = chosen.includes("imei");
  const imeiDiffers = imeiOn && imeiFromBackup !== currentImei;
  const imeiBlocked = imeiDiffers && !imeiConfirmed;
  const profileImeiCount = chosen.includes("profiles")
    ? differingProfileImeis(payload?.sections.profiles, currentImei)
    : 0;
  const modelMismatch =
    !!envelope && currentModel !== "" && envelope.device.model !== currentModel;

  const phase: PipelinePhase =
    ui === "success" || ui === "partial_success"
      ? "done"
      : ui === "failed"
        ? "start_failed"
        : progress
          ? "running"
          : "starting";

  // One toast at the terminal moment of a run this page started; the id stops a re-render repeating it.
  useEffect(() => {
    if (!pipelineOpen) return;
    if (ui === "success" || ui === "partial_success") {
      const id = `config-restore:${progress?.job_id ?? "run"}:${ui}`;
      const failed = progress?.summary?.failed ?? 0;
      const restored = progress?.summary?.success ?? 0;
      if (progress?.reboot_required) requestRebootLater("config_restore");
      if (progress?.status === "crashed") {
        toast.error(t(`${K}.toast_crashed`), { id });
      } else if (progress?.status === "cancelled") {
        toast.error(t(`${K}.toast_cancelled`, { count: restored }), { id });
      } else if (failed > 0) {
        toast.error(t(`${K}.toast_partial`, { count: failed }), { id });
      } else {
        toast.success(t(`${K}.toast_success`), { id });
      }
    } else if (ui === "failed" && state.error === "status_lost") {
      toast.error(resolveErrorMessage(t, "status_lost", null, t(`${K}.toast_failed`)), {
        id: "config-restore:status_lost",
      });
    }
  }, [pipelineOpen, ui, progress, state.error, t]);

  const clearDraft = () => {
    setPassphrase("");
    setEdits({});
    setImeiConfirmed(false);
    setProfileImeiKept(false);
  };

  const onFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) {
      clearDraft();
      await readFile(f);
    }
  };

  const handleUnlock = async (e: FormEvent) => {
    e.preventDefault();
    if (!passphrase || unlocking) return;
    setUnlocking(true);
    try {
      await tryPassword(passphrase);
    } finally {
      setUnlocking(false);
    }
  };

  const handleCancel = () => {
    clearDraft();
    reset();
  };

  const handleRestore = async () => {
    if (chosen.length === 0 || imeiBlocked) return;
    setStopRequested(false);
    setPipelineOpen(true);
    // True only after the explicit confirm; an unchanged IMEI needs none.
    const result = await startApply(
      chosen,
      (imeiDiffers && imeiConfirmed) || (profileImeiCount > 0 && profileImeiKept),
    );
    if (!result.ok) {
      toast.error(resolveErrorMessage(t, result.code, result.detail, t(`${K}.toast_failed`)));
    }
  };

  const handleStop = async () => {
    setStopRequested(true);
    const ok = await cancel();
    if (!ok) {
      setStopRequested(false);
      toast.error(t(`${K}.toast_stop_failed`));
    }
  };

  const handlePipelineClose = () => {
    const needsReboot = progress?.reboot_required === true;
    setPipelineOpen(false);
    clearDraft();
    reset();
    if (needsReboot) setRebootDialogOpen(true);
  };

  const handleRebootNow = async () => {
    setRebootBusy(true);
    clearPendingReboot();
    try {
      const res = await authFetch("/cgi-bin/quecmanager/system/reboot.sh", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Ends in the /reboot/ hand-off, which is its own confirmation.
      enterRebootFlow("config_restore");
    } catch {
      requestRebootLater("config_restore");
      setRebootBusy(false);
      setRebootDialogOpen(false);
      toast.error(t("config_backup.reboot_failed_toast"));
    }
  };

  const goToCreate = () => {
    const el = document.getElementById(BACKUP_PASSPHRASE_ID);
    el?.scrollIntoView({ block: "center" });
    el?.focus({ preventScroll: true });
  };

  const rowNote = (key: BackupSectionKey): string | null => {
    if (key === "lan") return t(`${K}.note_lan`);
    if (key === "profiles" && profileImeiCount > 0 && !profileImeiKept) {
      return t(`${K}.note_profiles_imei`);
    }
    if (key === "imei" || key === "ip_passthrough" || key === "profiles") {
      return t(`${K}.note_reboot`);
    }
    return null;
  };

  // The read failed before anything was decrypted: stay on the picker and say why.
  const readFailed = ui === "failed" && !payload;
  const unlocked = !!payload && (ui === "ready" || pipelineOpen);
  const opened =
    !!envelope && (ui === "password_required" || ui === "password_incorrect" || unlocked);

  const receipt = envelope ? (
    <div className={ROW_GROUP}>
      <div className={RECEIPT.ROW}>
        <span className={RECEIPT.KEY}>{t(`${K}.receipt_model`)}</span>
        <span className={RECEIPT.VALUE}>{envelope.device.model || "—"}</span>
      </div>
      <div className={RECEIPT.ROW}>
        <span className={RECEIPT.KEY}>{t(`${K}.receipt_created`)}</span>
        <span className={RECEIPT.VALUE}>{new Date(envelope.created_at).toLocaleString()}</span>
      </div>
    </div>
  ) : null;

  let body: ReactNode;
  let foot: ReactNode;

  if (opened && !unlocked) {
    // ── Passphrase ──────────────────────────────────────────────────────
    body = (
      <>
        {receipt}
        <div className={ROW_GROUP}>
          <div className={STACK_ROW}>
            <div className={ROW.TEXT}>
              <label htmlFor={passId} className={ROW.LABEL}>
                {t(`${K}.passphrase_label`)}
              </label>
              <span className={ROW.CONSEQUENCE}>{t(`${K}.passphrase_consequence`)}</span>
            </div>
            <Input
              id={passId}
              type="password"
              host="container"
              autoComplete="current-password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              aria-invalid={ui === "password_incorrect" || undefined}
              disabled={unlocking}
              autoFocus
              className={cn(FIELD, "@2xl/card:w-full")}
            />
          </div>
        </div>
        {ui === "password_incorrect" ? (
          <div role="alert" className={cn(NOTICE.BOX, NOTICE.FAILED)}>
            <CircleAlertIcon className={NOTICE.GLYPH} aria-hidden="true" />
            <span className={NOTICE.TEXT}>{t(`${K}.password_incorrect`)}</span>
          </div>
        ) : null}
      </>
    );
    foot = (
      <>
        <Button type="button" variant="ghost" size="action" onClick={handleCancel}>
          {t("common:actions.cancel")}
        </Button>
        <Button type="submit" size="action" disabled={!passphrase || unlocking}>
          {unlocking ? (
            <Loader2Icon className={cn(PILL_GLYPH, "motion-safe:animate-spin")} aria-hidden="true" />
          ) : null}
          {t(`${K}.button_unlock`)}
        </Button>
      </>
    );
  } else if (opened && unlocked && envelope) {
    // ── Ready: pick what will be overwritten ───────────────────────────
    body = (
      <>
        {receipt}
        {modelMismatch ? (
          <div role="note" className={cn(NOTICE.BOX, NOTICE.STALE)}>
            <TriangleAlertIcon className={NOTICE.GLYPH} aria-hidden="true" />
            <span className={NOTICE.TEXT}>
              {t(`${K}.model_warning`, { from: envelope.device.model, to: currentModel })}
            </span>
          </div>
        ) : null}
        <div className="flex items-center gap-3 px-1">
          <InfoIcon className="text-on-surface-variant size-4 flex-none" aria-hidden="true" />
          <p className={cn(PICK.WHY, "flex-1")}>{t(`${K}.backup_first`)}</p>
          <Button type="button" variant="ghost" size="sm" onClick={goToCreate}>
            {t(`${K}.backup_first_action`)}
          </Button>
        </div>
        <div className="flex flex-col gap-2">
          <p className={PICK.LABEL}>{t(`${K}.overwrite_label`)}</p>
          <SectionPicker
            idPrefix="restore-section"
            keys={planned}
            selection={selection}
            onChange={(key, checked) => {
              setEdits((prev) => ({ ...prev, [key]: checked }));
              if (key === "imei" && !checked) setImeiConfirmed(false);
              if (key === "profiles" && !checked) setProfileImeiKept(false);
            }}
            unsupported={unsupported}
            busy={pipelineOpen}
            note={rowNote}
          />
        </div>
        {imeiDiffers ? (
          <div className={cn(NOTICE.BOX, NOTICE.STALE)}>
            <TriangleAlertIcon className={NOTICE.GLYPH} aria-hidden="true" />
            <label htmlFor="restore-imei-confirm" className="flex min-w-0 flex-1 items-start gap-3">
              <span className={cn(NOTICE.TEXT, "flex-1")}>
                {twoSlots(
                  t(`${K}.imei_confirm`, { backup: SLOT, current: SLOT_2 }),
                  <span className={IMEI_TEXT}>{imeiFromBackup || "—"}</span>,
                  <span className={IMEI_TEXT}>{currentImei || "—"}</span>,
                )}
              </span>
              <Checkbox
                id="restore-imei-confirm"
                checked={imeiConfirmed}
                disabled={pipelineOpen}
                onCheckedChange={(v) => setImeiConfirmed(v === true)}
                className="mt-0.5"
              />
            </label>
          </div>
        ) : null}
        {profileImeiCount > 0 ? (
          <div className={cn(NOTICE.BOX, NOTICE.STALE)}>
            <TriangleAlertIcon className={NOTICE.GLYPH} aria-hidden="true" />
            <label htmlFor="restore-profile-imei-confirm" className="flex min-w-0 flex-1 items-start gap-3">
              <span className={cn(NOTICE.TEXT, "flex-1")}>
                {t(`${K}.profiles_imei_confirm`, { count: profileImeiCount })}
              </span>
              <Checkbox
                id="restore-profile-imei-confirm"
                checked={profileImeiKept}
                disabled={pipelineOpen}
                onCheckedChange={(v) => setProfileImeiKept(v === true)}
                className="mt-0.5"
              />
            </label>
          </div>
        ) : null}
      </>
    );
    foot = (
      <>
        <Button
          type="button"
          variant="ghost"
          size="action"
          onClick={handleCancel}
          disabled={pipelineOpen}
        >
          {t("common:actions.cancel")}
        </Button>
        <Button
          type="button"
          size="action"
          onClick={() => void handleRestore()}
          disabled={pipelineOpen || chosen.length === 0 || imeiBlocked}
        >
          <ArchiveRestoreIcon className={PILL_GLYPH} aria-hidden="true" />
          {t(`${K}.button_apply`)}
        </Button>
      </>
    );
  } else {
    // ── Picker (idle, reading, or a file that could not be read) ──────
    const reading = ui === "reading";
    body = (
      <>
        <div className={DROP.ROOT}>
          <span className={DROP.DISC} aria-hidden="true">
            {reading ? (
              <Loader2Icon className={cn(DROP.GLYPH, "motion-safe:animate-spin")} />
            ) : (
              <FileUpIcon className={DROP.GLYPH} />
            )}
          </span>
          <div className="flex flex-col gap-1">
            <p className={DROP.TITLE}>{t(reading ? `${K}.reading_title` : `${K}.idle_title`)}</p>
            <p className={DROP.BODY}>{t(`${K}.idle_description`)}</p>
          </div>
        </div>
        {readFailed ? (
          <div role="alert" className={cn(NOTICE.BOX, NOTICE.FAILED)}>
            <CircleAlertIcon className={NOTICE.GLYPH} aria-hidden="true" />
            <span className={NOTICE.TEXT}>
              {resolveErrorMessage(t, state.error, null, t(`${K}.read_failed`))}
            </span>
          </div>
        ) : null}
      </>
    );
    foot = (
      <Button
        type="button"
        size="action"
        onClick={() => fileInput.current?.click()}
        disabled={reading}
      >
        <FileUpIcon className={PILL_GLYPH} aria-hidden="true" />
        {t(readFailed ? `${K}.button_choose_another` : `${K}.upload_button`)}
      </Button>
    );
  }

  const isPassphraseView = opened && !unlocked;
  const footStatus =
    opened && unlocked ? (
      <span className="tabular-nums">{t(`${K}.selected_count`, { count: chosen.length })}</span>
    ) : null;

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={CARD_PAD}>
        <CardTitle className={CARD_TITLE}>{t(`${K}.card_title`)}</CardTitle>
        <CardDescription className={CARD_DESC}>{t(`${K}.card_description`)}</CardDescription>
      </CardHeader>

      <CardContent className={cn(CARD_PAD, CARD_BODY)}>
        <input
          ref={fileInput}
          type="file"
          accept=".qmbackup,application/octet-stream"
          className="hidden"
          onChange={onFileChange}
          aria-label={t(`${K}.upload_button`)}
        />
        <form
          onSubmit={isPassphraseView ? handleUnlock : (e) => e.preventDefault()}
          className={cn(CARD_BODY, "gap-4")}
        >
          {body}
          <CardFoot className="mt-auto" status={footStatus} actions={foot} />
        </form>
      </CardContent>

      <RestorePipelineDialog
        open={pipelineOpen}
        phase={phase}
        planned={chosen}
        progress={progress}
        startError={state.error}
        startDetail={state.detail}
        sourceModel={envelope?.device.model ?? ""}
        stopping={stopRequested}
        onStop={() => void handleStop()}
        onClose={handlePipelineClose}
      />

      <AlertDialog open={rebootDialogOpen} onOpenChange={setRebootDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(`${K}.reboot_dialog_title`)}</AlertDialogTitle>
            <AlertDialogDescription>{t(`${K}.reboot_dialog_description`)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rebootBusy}>{t(`${K}.reboot_later_button`)}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleRebootNow();
              }}
              disabled={rebootBusy}
            >
              {rebootBusy ? (
                <Loader2Icon className={cn(PILL_GLYPH, "motion-safe:animate-spin")} aria-hidden="true" />
              ) : null}
              {t("config_backup.reboot_now_button")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};

export default RestoreConfigBackupCard;
