"use client";

import * as React from "react";
import { useCallback, useId, useMemo, useState } from "react";
import { CheckIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CardFoot } from "@/components/ui/card-foot";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import {
  SegmentedField,
  SEGMENTED,
  type SegmentedOption,
} from "@/components/ui/segmented-field";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { MutationResult } from "@/types/mutation-result";

import {
  ACTION_HEIGHT,
  CARD_BODY,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  DELTA,
  DISCARD,
  FIELD,
  FIELD_INVALID,
  PROVENANCE,
  PROVENANCE_BLOCKED,
  ROW,
  ROW_GROUP,
  VALUE_NONE,
} from "./shapes";
import { failureReason } from "./failure-reason";

// =============================================================================
// MtuSettingsCard — the second of Band B's two peer write cards
// =============================================================================
// Two rows in one tonal group: the override switch and the value it gates. A
// PEER of the TTL card, not a subordinate of it — same shell, same padding, same
// type step — because the two settings are independent and the layout should say
// so.
//
// -----------------------------------------------------------------------------
// THIS CARD STAYS WRITABLE WHEN THE TTL CARD IS HELD
// -----------------------------------------------------------------------------
// A Custom SIM Profile can own TTL and hop limit, and when one does the sibling
// card is held so two writers cannot fight over one setting. No profile field
// writes MTU, so this card is never held for that reason. Holding it in sympathy
// would be the interface claiming a constraint the device does not have.
//
// -----------------------------------------------------------------------------
// THE DRAFT IS DERIVED, NOT SYNCED
// -----------------------------------------------------------------------------
// Same shape as the sibling card, for the same reason: this card holds only the
// EDITS and overlays them on a baseline derived from the server value, so a
// background re-read or a press of the page's Refresh pill re-BASES a pending
// change instead of silently erasing what was typed.
//
// -----------------------------------------------------------------------------
// THE INVALID STATE DOES NOT MOVE ANYTHING
// -----------------------------------------------------------------------------
// An out-of-range value takes an INSET ring rather than a border — a border
// would change the field's box and shift every neighbour by 2px the moment a
// digit went out of range, i.e. a layout that moves while you are typing into
// it. Apply goes dead, and the footer status slot beside it carries the specific
// reason in destructive ink, so the button never moves out from under the cursor.
// =============================================================================

const K = "ttlMtu";

type OnOff = "on" | "off";

/** The lucide check that SegmentedField reserves on every segment. */
const renderCheckGlyph = (className: string) => (
  <CheckIcon size={SEGMENTED.GLYPH} className={className} aria-hidden="true" />
);

/** The bounds `mtu.sh` enforces. Stated here so the copy and the gate agree. */
const MTU_MIN = 576;
const MTU_MAX = 9000;

/**
 * The one reason Apply can be dead, as a LITERAL key string — not assembled at
 * the call site, so it stays statically resolvable.
 */
const ERR_MTU_RANGE = `${K}.errors.mtu_range`;

/** What this card is allowed to know about the MTU endpoint. */
export interface MtuCardValue {
  isEnabled: boolean;
  /**
   * What the interface reported — with the caveat that `mtu.sh:96-97` falls back
   * to 1500 when the read fails, so this is only trustworthy because nothing
   * renders it at all unless the endpoint answered.
   */
  currentValue: number;
}

/** The form, as the strings the fields actually hold. */
interface MtuDraft {
  enabled: boolean;
  mtu: string;
}

/** What the fields show before anything has been read. */
const EMPTY_DRAFT: MtuDraft = { enabled: false, mtu: "" };

export interface MtuSettingsCardProps {
  /** The endpoint's reading. `null` while it has not answered. */
  value: MtuCardValue | null;
  isLoading: boolean;
  isSaving: boolean;
  onApply: (mtu: number) => Promise<MutationResult>;
  onDisable: () => Promise<MutationResult>;
}

/**
 * The pending-change chip in a row's label.
 *
 * Rendered on EVERY row, always — `invisible` when nothing changed — so a row
 * being promoted from clean to dirty moves nothing on the page. The shape lives
 * in `DELTA`; the two cards restate the small component rather than importing
 * one from each other, on the same principle that keeps geometry in one module
 * per family and not one module across families.
 */
function DeltaChip({ from, to }: { from: string; to: string }) {
  const clean = from === to;
  return (
    <span
      className={cn(DELTA.ROOT, clean && DELTA.CLEAN)}
      aria-hidden={clean ? "true" : undefined}
    >
      {from}
      <span className={DELTA.ARROW}>→</span>
      {to}
    </span>
  );
}

export function MtuSettingsCard({
  value,
  isLoading,
  isSaving,
  onApply,
  onDisable,
}: MtuSettingsCardProps) {
  const { t } = useTranslation("common");
  const { saved, markSaved } = useSaveFlash();

  const formId = useId();
  const onOffOptions: SegmentedOption<OnOff>[] = [
    { value: "on", label: t(`${K}.values.on`) },
    { value: "off", label: t(`${K}.values.off`) },
  ];
  const mtuId = useId();
  const mtuHintId = useId();

  // ---------------------------------------------------------------------------
  // Baseline + edits -> draft
  // ---------------------------------------------------------------------------
  const serverEnabled = value?.isEnabled ?? null;
  const serverMtu = value?.currentValue ?? null;

  const baseline = useMemo<MtuDraft | null>(
    () =>
      serverEnabled === null || serverMtu === null
        ? null
        : { enabled: serverEnabled, mtu: String(serverMtu) },
    [serverEnabled, serverMtu],
  );

  const [edits, setEdits] = useState<Partial<MtuDraft>>({});
  const draft = useMemo<MtuDraft>(
    () => ({ ...(baseline ?? EMPTY_DRAFT), ...edits }),
    [baseline, edits],
  );

  const setField = useCallback(
    <F extends keyof MtuDraft>(field: F, next: MtuDraft[F]) =>
      setEdits((prev) => ({ ...prev, [field]: next })),
    [],
  );

  const enabledDirty = baseline !== null && draft.enabled !== baseline.enabled;
  const mtuDirty = baseline !== null && draft.mtu !== baseline.mtu;
  const dirtyCount = Number(enabledDirty) + Number(mtuDirty);

  // ---------------------------------------------------------------------------
  // Validity
  // ---------------------------------------------------------------------------
  const trimmed = draft.mtu.trim();
  const parsed = trimmed === "" ? null : Number(trimmed);
  const mtuBad =
    draft.enabled &&
    (parsed === null ||
      !Number.isInteger(parsed) ||
      parsed < MTU_MIN ||
      parsed > MTU_MAX);

  // The one sentence that says why Apply is dead. `null` means it is not.
  const blockedKey = mtuBad ? ERR_MTU_RANGE : null;

  // Nothing was ever read, so there is nothing to change and no baseline to
  // change it against. The band above already says why.
  const unread = baseline === null;
  const canApply = !unread && dirtyCount > 0 && blockedKey === null;

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  const handleDiscard = useCallback(() => setEdits({}), []);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();

      // Enter inside a number field submits a form whose button is disabled, so
      // this path is reachable — and it refuses OUT LOUD. A guard that returned
      // silently here would be the same defect the sibling card just removed.
      if (blockedKey !== null) {
        toast.error(t(blockedKey, { min: MTU_MIN, max: MTU_MAX }));
        return;
      }
      if (!canApply) return;

      if (!draft.enabled) {
        const cleared = await onDisable();
        if (cleared.ok) {
          markSaved();
          toast.success(t(`${K}.toast_mtu_cleared`));
        } else {
          const title = t(`${K}.toast_mtu_disable_error`);
          toast.error(title, { description: failureReason(title, cleared.error) });
        }
        return;
      }

      // `parsed` is proven a valid in-range integer by `blockedKey === null`
      // together with `draft.enabled`.
      const next = parsed as number;
      const result = await onApply(next);
      if (result.ok) {
        markSaved();
        toast.success(t(`${K}.toast_mtu_applied`, { mtu: next }));
      } else {
        const title = t(`${K}.toast_mtu_error`);
        toast.error(title, { description: failureReason(title, result.error) });
      }
    },
    [
      blockedKey,
      canApply,
      draft.enabled,
      parsed,
      onApply,
      onDisable,
      markSaved,
      t,
    ],
  );

  // ---------------------------------------------------------------------------
  // Header — identical in every state, so it is written once
  // ---------------------------------------------------------------------------
  const header = (
    <CardHeader className={CARD_PAD}>
      <CardTitle className={CARD_TITLE}>{t(`${K}.cards.mtu.title`)}</CardTitle>
      <CardDescription>{t(`${K}.cards.mtu.description`)}</CardDescription>
    </CardHeader>
  );

  if (isLoading) {
    return (
      <Card className={CARD_SHELL}>
        {header}
        <CardContent className={cn(CARD_PAD, CARD_BODY)}>
          {/* Two rows at `ROW.HEIGHT`, mirroring the loaded group BY REFERENCE.
              The retired card promised `h-8 w-48` plus one `h-10`. */}
          <div className={ROW_GROUP}>
            {Array.from({ length: 2 }).map((_, index) => (
              <Skeleton
                key={index}
                className={cn(ROW.HEIGHT, "rounded-field")}
              />
            ))}
          </div>
        </CardContent>
        <CardFoot
          className={CARD_PAD}
          liveStatus={false}
          aria-hidden="true"
          actions={
            <Skeleton className={cn(ACTION_HEIGHT, "w-32 rounded-pill")} />
          }
        />
      </Card>
    );
  }

  const valueHeld = unread || !draft.enabled;

  return (
    <Card className={CARD_SHELL}>
      {header}
      <CardContent className={cn(CARD_PAD, CARD_BODY)}>
        <form id={formId} onSubmit={handleSubmit} className={CARD_BODY}>
          <div className={ROW_GROUP}>
            {/* Row 1 — the override switch. */}
            <div className={ROW.ROOT}>
              <div className={cn(ROW.TEXT, unread && ROW.HELD)}>
                <span className={ROW.LABEL_LINE}>
                  <span className={ROW.LABEL}>
                    {t(`${K}.rows.mtu_toggle.label`)}
                  </span>
                  <DeltaChip
                    from={t(
                      baseline?.enabled ? `${K}.values.on` : `${K}.values.off`,
                    )}
                    to={t(draft.enabled ? `${K}.values.on` : `${K}.values.off`)}
                  />
                </span>
                <span className={ROW.CONSEQUENCE}>
                  {unread
                    ? t(`${K}.rows.shared.consequence_unread`)
                    : t(`${K}.rows.mtu_toggle.consequence`)}
                </span>
              </div>
              <div className={ROW.CONTROL}>
                <SegmentedField
                  value={draft.enabled ? "on" : "off"}
                  onValueChange={(next) => setField("enabled", next === "on")}
                  options={onOffOptions}
                  ariaLabel={t(`${K}.rows.mtu_toggle.label`)}
                  disabled={unread}
                  breakpoint="never"
                  glyph={renderCheckGlyph}
                />
              </div>
            </div>

            {/* Row 2 — the value. */}
            <div className={ROW.ROOT}>
              <div className={cn(ROW.TEXT, valueHeld && ROW.HELD)}>
                <span className={ROW.LABEL_LINE}>
                  <label htmlFor={mtuId} className={ROW.LABEL}>
                    {t(`${K}.rows.mtu_value.label`)}
                  </label>
                  <DeltaChip
                    from={
                      baseline === null || baseline.mtu === ""
                        ? VALUE_NONE
                        : baseline.mtu
                    }
                    to={draft.mtu === "" ? VALUE_NONE : draft.mtu}
                  />
                </span>
                <span id={mtuHintId} className={ROW.CONSEQUENCE}>
                  {unread
                    ? t(`${K}.rows.shared.consequence_unread`)
                    : draft.enabled
                      ? t(`${K}.rows.mtu_value.consequence`, {
                          min: MTU_MIN,
                          max: MTU_MAX,
                        })
                      : t(`${K}.rows.mtu_value.consequence_off`)}
                </span>
              </div>
              <div className={ROW.CONTROL}>
                <Input
                  host="container"
                  id={mtuId}
                  type="number"
                  inputMode="numeric"
                  min={MTU_MIN}
                  max={MTU_MAX}
                  value={draft.mtu}
                  onChange={(event) => setField("mtu", event.target.value)}
                  disabled={valueHeld}
                  aria-invalid={mtuBad || undefined}
                  aria-describedby={mtuHintId}
                  placeholder={t(`${K}.rows.mtu_value.placeholder`)}
                  className={cn(FIELD, mtuBad && FIELD_INVALID)}
                />
              </div>
            </div>
          </div>

        </form>
      </CardContent>
      {/* Outside the form so `mt-auto` reaches the card edge; `form=` keeps Enter-to-submit. */}
      <CardFoot
        className={CARD_PAD}
        liveStatus={false}
        status={
          blockedKey !== null ? (
            <span className={PROVENANCE_BLOCKED} role="alert">
              {t(blockedKey, { min: MTU_MIN, max: MTU_MAX })}
            </span>
          ) : dirtyCount > 0 ? (
            <span className={PROVENANCE}>
              {t(`${K}.footer.unsaved`, { count: dirtyCount })}
            </span>
          ) : undefined
        }
        actions={
          <>
            <Button
              type="button"
              variant="ghost"
              onClick={handleDiscard}
              disabled={isSaving || dirtyCount === 0}
              size="action"
              className={DISCARD}
            >
              {t(`${K}.footer.discard`)}
            </Button>
            <SaveButton
              type="submit"
              form={formId}
              isSaving={isSaving}
              saved={saved}
              label={t("actions.apply")}
              disabled={!canApply}
              size="action"
            />
          </>
        }
      />
    </Card>
  );
}

export default MtuSettingsCard;
