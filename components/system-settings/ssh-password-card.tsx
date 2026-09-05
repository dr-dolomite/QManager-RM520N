"use client";

import { useCallback, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { toast } from "sonner";
import { CircleAlertIcon, EyeIcon, EyeOffIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { changeSSHPassword } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { cn } from "@/lib/utils";

import {
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  COARSE_TARGET,
  FIELD,
  NOTICE,
  PILL_ACTION,
  ROW,
  ROW_GROUP,
} from "./shapes";

const K = "ssh";

// The row, restated WITHOUT `ROW.ROOT`'s side-by-side flip: these controls are
// full-width password fields, so label and field stack at every width.
const STACK_ROW = "flex flex-col gap-2.5 rounded-field px-4 py-4";

// The field fills its row rather than collapsing to `FIELD`'s side-by-side
// width, and reserves the lane the eye toggle rides in.
const FIELD_FULL = "@2xl/card:w-full pr-11";

// The toggle sits INSIDE the 42px pill, so it paints 32px and cannot grow.
// `COARSE_TARGET` reaches the 44px floor with a pseudo-element instead.
const FIELD_TOGGLE = `absolute top-1/2 right-1.5 -translate-y-1/2 rounded-pill text-on-surface-variant hover:text-on-surface ${COARSE_TARGET}`;

interface PasswordFieldProps {
  id: string;
  label: string;
  /** Omitted on the confirm row, which restates rather than decides. */
  consequence?: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  autoComplete: string;
}

/**
 * One password row. It owns its own show/hide state, which is the whole point
 * of the extraction — three near-identical blocks and three `showX` flags
 * collapse into one component the card never has to think about.
 */
function PasswordField({
  id,
  label,
  consequence,
  value,
  onChange,
  disabled,
  autoComplete,
}: PasswordFieldProps) {
  const { t } = useTranslation("system-settings");
  const [visible, setVisible] = useState(false);
  const Glyph = visible ? EyeOffIcon : EyeIcon;

  return (
    <div className={STACK_ROW}>
      <div className={ROW.TEXT}>
        <label htmlFor={id} className={ROW.LABEL}>
          {label}
        </label>
        {consequence ? (
          <span className={ROW.CONSEQUENCE}>{consequence}</span>
        ) : null}
      </div>

      <div className="relative">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            onChange(e.target.value)
          }
          required
          disabled={disabled}
          className={cn(FIELD, FIELD_FULL)}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={FIELD_TOGGLE}
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          aria-label={t(visible ? `${K}.toggle.hide` : `${K}.toggle.show`)}
        >
          <Glyph className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

export default function SSHPasswordCard() {
  const { t } = useTranslation("system-settings");
  const { saved, markSaved } = useSaveFlash();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Bumped on a successful change to remount the group, which re-hides any
  // field the user had revealed.
  const [formKey, setFormKey] = useState(0);

  const reset = useCallback(() => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setError("");
    setFormKey((k) => k + 1);
  }, []);

  const canSubmit =
    currentPassword.length > 0 &&
    newPassword.length >= 6 &&
    confirmPassword.length > 0 &&
    !isSubmitting;

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setError("");

      if (newPassword.length < 6) {
        setError(t(`${K}.errors.too_short`));
        return;
      }

      if (newPassword !== confirmPassword) {
        setError(t(`${K}.errors.mismatch`));
        return;
      }

      setIsSubmitting(true);
      try {
        const result = await changeSSHPassword(
          currentPassword,
          newPassword,
          confirmPassword,
        );
        if (result.success) {
          toast.success(t(`${K}.toast_saved`));
          markSaved();
          reset();
        } else {
          setError(result.error || t(`${K}.errors.failed`));
        }
      } finally {
        setIsSubmitting(false);
      }
    },
    [currentPassword, newPassword, confirmPassword, reset, markSaved, t],
  );

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={CARD_PAD}>
        <CardTitle className={CARD_TITLE}>{t(`${K}.card.title`)}</CardTitle>
        <CardDescription className={CARD_DESC}>
          {t(`${K}.card.description`)}
        </CardDescription>
      </CardHeader>

      <CardContent className={cn(CARD_PAD, "flex min-h-0 flex-1 flex-col")}>
        <form
          onSubmit={handleSubmit}
          className="flex min-h-0 flex-1 flex-col gap-4"
        >
          {/* The row group is this card's slack absorber: the page grid locks
              every cell to `h-full`, and the group is what grows to fill it. */}
          <div key={formKey} className={cn(ROW_GROUP, "min-h-0 flex-1")}>
            <PasswordField
              id="ssh-current-password"
              label={t(`${K}.fields.current.label`)}
              consequence={t(`${K}.fields.current.consequence`)}
              value={currentPassword}
              onChange={setCurrentPassword}
              disabled={isSubmitting}
              autoComplete="current-password"
            />
            <PasswordField
              id="ssh-new-password"
              label={t(`${K}.fields.new.label`)}
              consequence={t(`${K}.fields.new.consequence`)}
              value={newPassword}
              onChange={setNewPassword}
              disabled={isSubmitting}
              autoComplete="new-password"
            />
            <PasswordField
              id="ssh-confirm-password"
              label={t(`${K}.fields.confirm.label`)}
              value={confirmPassword}
              onChange={setConfirmPassword}
              disabled={isSubmitting}
              autoComplete="new-password"
            />
          </div>

          {error ? (
            <div role="alert" className={cn(NOTICE.BOX, NOTICE.FAILED)}>
              <CircleAlertIcon className={NOTICE.GLYPH} aria-hidden="true" />
              <span className={NOTICE.TEXT}>{error}</span>
            </div>
          ) : null}

          <div className="flex justify-end">
            <SaveButton
              type="submit"
              isSaving={isSubmitting}
              saved={saved}
              label={t(`${K}.card.save`)}
              disabled={!canSubmit}
              className={PILL_ACTION}
            />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
