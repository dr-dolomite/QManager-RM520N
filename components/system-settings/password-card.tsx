"use client";

import { useCallback, useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";
import { CircleAlertIcon, Loader2Icon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useSshPassword } from "@/hooks/use-ssh-password";
import { useWebPassword } from "@/hooks/use-web-password";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CardFoot } from "@/components/ui/card-foot";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { PasswordActions } from "@/types/password-change";

import { PasswordChangeDialog } from "./password-change-dialog";
import { PasswordInput } from "./password-input";
import {
  CARD_BODY,
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  FIELD,
  GROUP_FILL,
  NOTICE,
  ROW,
  ROW_GROUP,
  STACK_ROW,
  TAB_RAIL,
} from "./shapes";

// Passwords card: each tab verifies its own current password (`verify_only`) before the new-password dialog.
// A web change redirects to /login/ (that is the confirmation, no toast); an SSH change toasts.

type Kind = "web" | "ssh";

const KINDS: readonly Kind[] = ["web", "ssh"];

// `@2xl/card:w-full` cancels `FIELD`'s side-by-side auto-width: this row never
// flips, so the field always fills it.
const FIELD_GROUP = cn(FIELD, "@2xl/card:w-full");

interface PanelProps {
  kind: Kind;
  actions: PasswordActions;
}

function PasswordPanel({ kind, actions }: PanelProps) {
  const { t } = useTranslation("system-settings");
  const { verifyPassword, changePassword, isPending } = actions;

  const [current, setCurrent] = useState("");
  const [error, setError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  // True once a change landed. The web tab is then already leaving for /login/,
  // so the dialog stays locked instead of flashing back to editable.
  const [leaving, setLeaving] = useState(false);
  // Bumped to remount the field (re-hiding it) and the dialog (clearing it).
  const [formKey, setFormKey] = useState(0);

  const reset = useCallback(() => {
    setCurrent("");
    setError("");
    setDialogOpen(false);
    setFormKey((k) => k + 1);
  }, []);

  const handleContinue = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (current.length === 0 || isPending) return;
      setError("");

      const result = await verifyPassword(current);
      if (result.success) {
        setDialogOpen(true);
      } else {
        setError(result.message ?? t("passwords.errors.verify_failed"));
      }
    },
    [current, isPending, verifyPassword, t],
  );

  const handleDialogOpenChange = useCallback(
    (open: boolean) => {
      setDialogOpen(open);
      // Cancelling drops the typed password too: Continue re-asks for it.
      if (!open) {
        setCurrent("");
        setError("");
        setFormKey((k) => k + 1);
      }
    },
    [],
  );

  const handleSave = useCallback(
    async (newPassword: string, enforceStrong: boolean) => {
      const result = await changePassword(current, newPassword, enforceStrong);
      if (!result.success) {
        toast.error(result.message ?? t("passwords.errors.change_failed"));
        return;
      }
      if (kind === "web") {
        setLeaving(true);
        return;
      }
      toast.success(t("passwords.ssh.toast_saved"));
      reset();
    },
    [changePassword, current, kind, reset, t],
  );

  const fieldId = `password-current-${kind}`;

  return (
    <>
      <form
        key={`form-${formKey}`}
        onSubmit={handleContinue}
        className={cn(CARD_BODY, "gap-4")}
      >
        {/* The row group is this card's slack absorber: the page grid locks
            every cell to `h-full`, and the group is what grows to fill it. */}
        <div className={cn(ROW_GROUP, GROUP_FILL)}>
          <div className={STACK_ROW}>
            <div className={ROW.TEXT}>
              <label htmlFor={fieldId} className={ROW.LABEL}>
                {t(`passwords.${kind}.label`)}
              </label>
              <span className={ROW.CONSEQUENCE}>
                {t(`passwords.${kind}.consequence`)}
              </span>
            </div>
            <PasswordInput
              id={fieldId}
              host="container"
              autoComplete="current-password"
              value={current}
              onChange={(next) => {
                setCurrent(next);
                if (error) setError("");
              }}
              disabled={isPending || leaving}
              invalid={error.length > 0}
              className={FIELD_GROUP}
            />
          </div>
        </div>

        {error ? (
          <div role="alert" className={cn(NOTICE.BOX, NOTICE.FAILED)}>
            <CircleAlertIcon className={NOTICE.GLYPH} aria-hidden="true" />
            <span className={NOTICE.TEXT}>{error}</span>
          </div>
        ) : null}

        {/* The form is the flex column, so `mt-auto` reaches the card's
            bottom edge and Continue stays inside the form. */}
        <CardFoot
          actions={
            <Button
              type="submit"
              size="action"
              disabled={current.length === 0 || isPending || leaving}
            >
              {isPending && !dialogOpen ? (
                <Loader2Icon
                  className="size-4 motion-safe:animate-spin"
                  aria-hidden="true"
                />
              ) : null}
              {t("passwords.continue")}
            </Button>
          }
        />
      </form>

      {/* Sibling, not child: React bubbles the portaled dialog's submit up the
          tree, so inside the form every Save would also fire Continue. */}
      <PasswordChangeDialog
        key={`dialog-${formKey}`}
        open={dialogOpen}
        onOpenChange={handleDialogOpenChange}
        title={t(`passwords.${kind}.dialog_title`)}
        description={t(`passwords.${kind}.dialog_description`)}
        busy={isPending || leaving}
        onSubmit={handleSave}
      />
    </>
  );
}

export default function PasswordCard() {
  const { t } = useTranslation("system-settings");
  const web = useWebPassword();
  const ssh = useSshPassword();
  const [tab, setTab] = useState<Kind>("web");

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={CARD_PAD}>
        <CardTitle className={CARD_TITLE}>{t("passwords.card.title")}</CardTitle>
        <CardDescription className={CARD_DESC}>
          {t("passwords.card.description")}
        </CardDescription>
      </CardHeader>

      <CardContent className={cn(CARD_PAD, CARD_BODY)}>
        <Tabs
          value={tab}
          onValueChange={(next) => setTab(next as Kind)}
          className="min-h-0 flex-1 gap-4"
        >
          <TabsList
            className={TAB_RAIL.LIST_TWO_UP}
            aria-label={t("passwords.tabs.aria")}
          >
            {KINDS.map((kind) => (
              <TabsTrigger
                key={kind}
                value={kind}
                className={TAB_RAIL.TRIGGER}
              >
                {t(`passwords.tabs.${kind}`)}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="web" className={CARD_BODY}>
            <PasswordPanel kind="web" actions={web} />
          </TabsContent>
          <TabsContent value="ssh" className={CARD_BODY}>
            <PasswordPanel kind="ssh" actions={ssh} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
