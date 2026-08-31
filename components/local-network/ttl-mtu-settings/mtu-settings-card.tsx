"use client";

import * as React from "react";
import { useCallback, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Undo2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import {
  CARD_BODY,
  CARD_FOOT,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  DELTA,
  FIELD,
  FIELD_INVALID,
  PROVENANCE,
  PROVENANCE_BLOCKED,
  ROW,
  ROW_GROUP,
  VALUE_NONE,
} from "./shapes";

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
// it. Apply goes dead, and the provenance slot under it becomes the specific
// reason in destructive ink. That is one slot doing two jobs on purpose: "why
// can't I press this" and "where did this number come from" are asked in the
// same glance, and growing a second line would push the button out from under
// the cursor at the exact moment it is refused.
// =============================================================================

const K = "ttlMtu";

/**
 * The interfaces the write lands on.
 *
 * A machine string — `mtu.sh` globs `/sys/class/net` for exactly this prefix and
 * runs `ip link set <iface> mtu N` on each match — so it takes the machine voice
 * in the provenance line. It is NOT a config path: this setting has no file the
 * value is read back from, which is precisely why naming the interfaces is the
 * honest provenance here and naming a file would not be.
 */
const RMNET_GLOB = "rmnet_data*";

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
  error: string | null;
  onApply: (mtu: number) => Promise<boolean>;
  onDisable: () => Promise<boolean>;
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
  error,
  onApply,
  onDisable,
}: MtuSettingsCardProps) {
  const { t } = useTranslation("common");
  const { saved, markSaved } = useSaveFlash();

  const switchId = useId();
  const switchLabelId = useId();
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
        if (cleared) {
          markSaved();
          toast.success(t(`${K}.toast_mtu_cleared`));
        } else {
          toast.error(error ?? t(`${K}.toast_mtu_error`));
        }
        return;
      }

      // `parsed` is proven a valid in-range integer by `blockedKey === null`
      // together with `draft.enabled`.
      const next = parsed as number;
      const ok = await onApply(next);
      if (ok) {
        markSaved();
        toast.success(t(`${K}.toast_mtu_applied`, { mtu: next }));
      } else {
        toast.error(error ?? t(`${K}.toast_mtu_error`));
      }
    },
    [
      blockedKey,
      canApply,
      draft.enabled,
      parsed,
      onApply,
      onDisable,
      error,
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
          <div className={CARD_FOOT.ROOT}>
            <Skeleton
              className={cn(CARD_FOOT.ACTION_HEIGHT, "w-32 rounded-pill")}
            />
          </div>
        </CardContent>
      </Card>
    );
  }

  const valueHeld = unread || !draft.enabled;

  return (
    <Card className={CARD_SHELL}>
      {header}
      <CardContent className={cn(CARD_PAD, CARD_BODY)}>
        <form onSubmit={handleSubmit} className={CARD_BODY}>
          <div className={ROW_GROUP}>
            {/* Row 1 — the override switch. */}
            <div className={ROW.ROOT}>
              <div className={cn(ROW.TEXT, unread && ROW.HELD)}>
                <span className={ROW.LABEL_LINE}>
                  <span id={switchLabelId} className={ROW.LABEL}>
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
                <Switch
                  id={switchId}
                  aria-labelledby={switchLabelId}
                  checked={draft.enabled}
                  onCheckedChange={(next) => setField("enabled", next)}
                  disabled={unread}
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
                <input
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

          <div className={CARD_FOOT.ROOT}>
            <div className={CARD_FOOT.ACTIONS}>
              <SaveButton
                type="submit"
                isSaving={isSaving}
                saved={saved}
                label={t("actions.apply")}
                disabled={!canApply}
              />
              {dirtyCount > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleDiscard}
                  disabled={isSaving}
                  className={CARD_FOOT.DISCARD}
                >
                  <Undo2Icon className={CARD_FOOT.GLYPH} aria-hidden="true" />
                  {t(`${K}.footer.discard`)}
                </Button>
              ) : null}
            </div>

            <span
              className={blockedKey !== null ? PROVENANCE_BLOCKED : PROVENANCE}
              role={blockedKey !== null ? "alert" : undefined}
            >
              {blockedKey !== null ? (
                t(blockedKey, { min: MTU_MIN, max: MTU_MAX })
              ) : dirtyCount > 0 ? (
                t(`${K}.footer.unsaved`, { count: dirtyCount })
              ) : (
                <>
                  {t(`${K}.cards.mtu.provenance`)}{" "}
                  <span className="font-mono">{RMNET_GLOB}</span>
                </>
              )}
            </span>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export default MtuSettingsCard;
