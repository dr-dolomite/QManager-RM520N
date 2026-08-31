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
import { Tag } from "@/components/ui/tag";
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
// TtlSettingsCard — the first of Band B's two peer write cards
// =============================================================================
// Three rows in one tonal group: the rewrite switch, then the two values it
// gates. It owns its edits and nothing else — the fetch, the profile check and
// the Refresh pill all live in the shell, because the band above needs both
// endpoints and only the shell holds both.
//
// -----------------------------------------------------------------------------
// THE SILENT NO-OP IS GONE (finding 17)
// -----------------------------------------------------------------------------
// The retired handler opened with `if (isEnabled && ttl === 0 && hl === 0)
// return;`. Turning the switch on made the form dirty, which made the button
// live, and pressing it did NOTHING — no request, no toast, no state change. The
// only feedback was a field error that had been on screen since before the
// press, so the button read as broken rather than as refusing.
//
// It is answered in both directions rather than one:
//
//   * Apply is DISABLED whenever the form cannot be applied, and the provenance
//     line under it becomes the reason — the answer to "why can't I press this"
//     lands in the same glance as the button, not in a field error above it.
//   * The submit handler still refuses, because Enter inside a text input
//     submits a form whose button is disabled — but it refuses OUT LOUD, with
//     the same sentence as a toast. A guard that returns silently is the defect
//     restated, not the fix.
//
// -----------------------------------------------------------------------------
// THE DRAFT IS DERIVED, NOT SYNCED
// -----------------------------------------------------------------------------
// This card holds only the EDITS and overlays them on a baseline derived from
// the server values. The shape it replaces — local `useState` re-seeded whenever
// the hook's data identity changed — silently discarded whatever the user had
// typed on every re-read, and this page now has a Refresh pill that makes that
// reachable in one click. Overlaying re-BASES the pending change against the new
// server value instead of erasing it, which is exactly what the delta chips are
// there to show. It is also the only shape that passes
// `react-hooks/set-state-in-effect`, which is an ERROR in this repo.
//
// -----------------------------------------------------------------------------
// THE CARD IS COMPOSED FROM `Card` / `CardHeader` / `CardTitle` /
// `CardDescription` / `CardContent`
// -----------------------------------------------------------------------------
// `Card` takes `CARD_SHELL`; `CardHeader` and `CardContent` each take
// `CARD_PAD` (composed with `CARD_BODY` on the latter); `CardTitle` takes
// `CARD_TITLE`; `CardDescription` takes no className. This is the reference
// convention (speed-limit-card.tsx:134-139) and CLAUDE.md's stated rule: plain
// `CardTitle` + `CardDescription`, never an icon inside either.
// =============================================================================

const K = "ttlMtu";

/**
 * Where the value on screen came from.
 *
 * NOT simply a config file, and the distinction is the point. `ttl.sh`'s GET
 * reads the LIVE iptables mangle rules rather than the persisted file, so the
 * figures here are what the kernel is doing right now; `/etc/qmanager/ttl_state`
 * is what gets replayed at boot. A provenance line claiming the file is the
 * source would be naming the wrong one, which is the class of quiet inaccuracy
 * this re-author exists to remove.
 */
const TTL_STATE_PATH = "/etc/qmanager/ttl_state";

/** The bounds `ttl.sh` enforces. Stated here so the copy and the gate agree. */
const TTL_MIN = 1;
const TTL_MAX = 255;

/**
 * The two reasons Apply can be dead, as LITERAL key strings.
 *
 * Not assembled at the call site from a suffix: a half-built key is not
 * something any tool can resolve statically, and this surface's translation
 * coverage is checked by reading call sites. Same reason the band keeps its chip
 * labels in a record of literals.
 */
const ERR_VALUE_RANGE = `${K}.errors.value_range`;
const ERR_NO_VALUE = `${K}.errors.no_value`;

/**
 * What this card is allowed to know about the TTL endpoint.
 *
 * Deliberately NARROWER than `TtlSettingsData`: the hook also carries
 * `autostart`, which is a compile-time constant `true` on every device (the
 * installer creates the boot symlink on every install and every OTA), so it is
 * excluded structurally rather than by asking a reader not to render it.
 */
export interface TtlCardValue {
  isEnabled: boolean;
  /** 0 means "not rewritten", not "zero". */
  ttl: number;
  /** 0 means "not rewritten", not "zero". */
  hl: number;
}

/** The form, as the strings the fields actually hold. */
interface TtlDraft {
  enabled: boolean;
  ttl: string;
  hl: string;
}

/** What the fields show before anything has been read. */
const EMPTY_DRAFT: TtlDraft = { enabled: false, ttl: "", hl: "" };

export interface TtlSettingsCardProps {
  /** The endpoint's reading. `null` while it has not answered. */
  value: TtlCardValue | null;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  /** True when an active SIM profile writes these two values. */
  isProfileControlled: boolean;
  onApply: (ttl: number, hl: number) => Promise<boolean>;
}

/**
 * The pending-change chip in a row's label.
 *
 * Rendered on EVERY row, always — `invisible` when nothing changed — so a row
 * being promoted from clean to dirty moves nothing on the page. A settings form
 * that reflows the instant you touch a field punishes you for exploring it.
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

export function TtlSettingsCard({
  value,
  isLoading,
  isSaving,
  error,
  isProfileControlled,
  onApply,
}: TtlSettingsCardProps) {
  const { t } = useTranslation("common");
  const { saved, markSaved } = useSaveFlash();

  const switchId = useId();
  const switchLabelId = useId();
  const ttlId = useId();
  const hlId = useId();
  const ttlHintId = useId();
  const hlHintId = useId();

  // ---------------------------------------------------------------------------
  // Baseline + edits -> draft
  // ---------------------------------------------------------------------------
  // The memo keys off the PRIMITIVES, not the prop object: the shell rebuilds
  // that object on every render, so depending on its identity would rebuild the
  // baseline on renders where nothing about the device changed.
  const serverEnabled = value?.isEnabled ?? null;
  const serverTtl = value?.ttl ?? null;
  const serverHl = value?.hl ?? null;

  const baseline = useMemo<TtlDraft | null>(
    () =>
      serverEnabled === null || serverTtl === null || serverHl === null
        ? null
        : {
            enabled: serverEnabled,
            // 0 is the endpoint's word for "not rewritten", so it renders as an
            // empty field rather than as the number zero.
            ttl: serverTtl > 0 ? String(serverTtl) : "",
            hl: serverHl > 0 ? String(serverHl) : "",
          },
    [serverEnabled, serverTtl, serverHl],
  );

  const [edits, setEdits] = useState<Partial<TtlDraft>>({});
  const draft = useMemo<TtlDraft>(
    () => ({ ...(baseline ?? EMPTY_DRAFT), ...edits }),
    [baseline, edits],
  );

  const setField = useCallback(
    <F extends keyof TtlDraft>(field: F, next: TtlDraft[F]) =>
      setEdits((prev) => ({ ...prev, [field]: next })),
    [],
  );

  const enabledDirty = baseline !== null && draft.enabled !== baseline.enabled;
  const ttlDirty = baseline !== null && draft.ttl !== baseline.ttl;
  const hlDirty = baseline !== null && draft.hl !== baseline.hl;
  const dirtyCount = Number(enabledDirty) + Number(ttlDirty) + Number(hlDirty);

  // ---------------------------------------------------------------------------
  // Validity
  // ---------------------------------------------------------------------------
  const parse = (text: string): number | null => {
    const trimmed = text.trim();
    if (trimmed === "") return null;
    const parsed = Number(trimmed);
    return Number.isInteger(parsed) ? parsed : NaN;
  };

  const ttlParsed = parse(draft.ttl);
  const hlParsed = parse(draft.hl);
  const outOfRange = (parsed: number | null) =>
    parsed !== null &&
    (Number.isNaN(parsed) || parsed < TTL_MIN || parsed > TTL_MAX);

  const ttlBad = draft.enabled && outOfRange(ttlParsed);
  const hlBad = draft.enabled && outOfRange(hlParsed);
  const nothingEntered =
    draft.enabled && draft.ttl.trim() === "" && draft.hl.trim() === "";

  // The one sentence that says why Apply is dead. `null` means it is not.
  const blockedKey =
    ttlBad || hlBad ? ERR_VALUE_RANGE : nothingEntered ? ERR_NO_VALUE : null;

  // Nothing was ever read, so there is nothing to change and no baseline to
  // change it against. The band above already says why.
  const unread = baseline === null;
  const held = isProfileControlled || unread;
  const valuesHeld = held || !draft.enabled;

  const canApply = !held && dirtyCount > 0 && blockedKey === null;

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  // Discard drops the EDITS rather than restoring remembered numbers, which is
  // the whole advantage of the overlay: whatever the device most recently
  // reported is what the fields fall back to, even if it changed while the form
  // was dirty.
  const handleDiscard = useCallback(() => setEdits({}), []);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();

      // Enter inside a text field submits a form whose button is disabled, so
      // this path is reachable. It refuses OUT LOUD — the retired guard returned
      // silently, which is finding 17.
      if (blockedKey !== null) {
        toast.error(t(blockedKey, { min: TTL_MIN, max: TTL_MAX }));
        return;
      }
      if (!canApply) return;

      const nextTtl = draft.enabled && ttlParsed !== null ? ttlParsed : 0;
      const nextHl = draft.enabled && hlParsed !== null ? hlParsed : 0;

      const ok = await onApply(nextTtl, nextHl);
      if (!ok) {
        toast.error(error ?? t(`${K}.toast_ttl_error`));
        return;
      }

      markSaved();
      if (nextTtl > 0 || nextHl > 0) {
        toast.success(
          t(`${K}.toast_ttl_applied`, {
            ttl: nextTtl > 0 ? nextTtl : VALUE_NONE,
            hl: nextHl > 0 ? nextHl : VALUE_NONE,
          }),
        );
      } else {
        toast.success(t(`${K}.toast_ttl_cleared`));
      }
    },
    [
      blockedKey,
      canApply,
      draft.enabled,
      ttlParsed,
      hlParsed,
      onApply,
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
      <CardTitle className={CARD_TITLE}>{t(`${K}.cards.ttl.title`)}</CardTitle>
      <CardDescription>{t(`${K}.cards.ttl.description`)}</CardDescription>
    </CardHeader>
  );

  if (isLoading) {
    return (
      <Card className={CARD_SHELL}>
        {header}
        <CardContent className={cn(CARD_PAD, CARD_BODY)}>
          {/* The skeleton mirrors the loaded group BY REFERENCE: the same
              `ROW_GROUP` box holding three rows at `ROW.HEIGHT`. The retired
              card promised `h-8 w-48` plus two `h-10` boxes against a form of a
              switch row and two 42px fields. */}
          <div className={ROW_GROUP}>
            {Array.from({ length: 3 }).map((_, index) => (
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

  /** A value row's consequence: unread beats off beats the real sentence. */
  const valueConsequence = (active: string) =>
    unread
      ? t(`${K}.rows.shared.consequence_unread`)
      : draft.enabled
        ? active
        : t(`${K}.rows.shared.consequence_off`);

  return (
    <Card className={CARD_SHELL}>
      {header}
      <CardContent className={cn(CARD_PAD, CARD_BODY)}>
        <form onSubmit={handleSubmit} className={CARD_BODY}>
          <div className={ROW_GROUP}>
            {/* Row 1 — the switch that gates the other two. */}
            <div className={ROW.ROOT}>
              <div className={cn(ROW.TEXT, held && ROW.HELD)}>
                <span className={ROW.LABEL_LINE}>
                  <span id={switchLabelId} className={ROW.LABEL}>
                    {t(`${K}.rows.rewrite.label`)}
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
                    : t(`${K}.rows.rewrite.consequence`)}
                </span>
              </div>
              <div className={ROW.CONTROL}>
                <Switch
                  id={switchId}
                  aria-labelledby={switchLabelId}
                  checked={draft.enabled}
                  onCheckedChange={(next) => setField("enabled", next)}
                  disabled={held}
                />
              </div>
            </div>

            {/* Row 2 — TTL (IPv4). */}
            <div className={ROW.ROOT}>
              <div className={cn(ROW.TEXT, valuesHeld && ROW.HELD)}>
                <span className={ROW.LABEL_LINE}>
                  <label htmlFor={ttlId} className={ROW.LABEL}>
                    {t(`${K}.rows.ttl_value.label`)}
                  </label>
                  {/* IPv4 is metadata — which protocol this number belongs to —
                      so it is a Tag. A filled Badge says whether a thing is well,
                      and a protocol family is neither well nor unwell. */}
                  <Tag variant="neutral">{t(`${K}.rows.ttl_value.tag`)}</Tag>
                  <DeltaChip
                    from={
                      baseline === null || baseline.ttl === ""
                        ? VALUE_NONE
                        : baseline.ttl
                    }
                    to={draft.ttl === "" ? VALUE_NONE : draft.ttl}
                  />
                </span>
                <span id={ttlHintId} className={ROW.CONSEQUENCE}>
                  {valueConsequence(
                    t(`${K}.rows.ttl_value.consequence`, {
                      min: TTL_MIN,
                      max: TTL_MAX,
                    }),
                  )}
                </span>
              </div>
              <div className={ROW.CONTROL}>
                <input
                  id={ttlId}
                  type="number"
                  inputMode="numeric"
                  min={TTL_MIN}
                  max={TTL_MAX}
                  value={draft.ttl}
                  onChange={(event) => setField("ttl", event.target.value)}
                  disabled={valuesHeld}
                  aria-invalid={ttlBad || undefined}
                  aria-describedby={ttlHintId}
                  placeholder={t(`${K}.rows.ttl_value.placeholder`)}
                  className={cn(FIELD, ttlBad && FIELD_INVALID)}
                />
              </div>
            </div>

            {/* Row 3 — hop limit (IPv6). */}
            <div className={ROW.ROOT}>
              <div className={cn(ROW.TEXT, valuesHeld && ROW.HELD)}>
                <span className={ROW.LABEL_LINE}>
                  <label htmlFor={hlId} className={ROW.LABEL}>
                    {t(`${K}.rows.hl_value.label`)}
                  </label>
                  <Tag variant="neutral">{t(`${K}.rows.hl_value.tag`)}</Tag>
                  <DeltaChip
                    from={
                      baseline === null || baseline.hl === ""
                        ? VALUE_NONE
                        : baseline.hl
                    }
                    to={draft.hl === "" ? VALUE_NONE : draft.hl}
                  />
                </span>
                <span id={hlHintId} className={ROW.CONSEQUENCE}>
                  {valueConsequence(t(`${K}.rows.hl_value.consequence`))}
                </span>
              </div>
              <div className={ROW.CONTROL}>
                <input
                  id={hlId}
                  type="number"
                  inputMode="numeric"
                  min={TTL_MIN}
                  max={TTL_MAX}
                  value={draft.hl}
                  onChange={(event) => setField("hl", event.target.value)}
                  disabled={valuesHeld}
                  aria-invalid={hlBad || undefined}
                  aria-describedby={hlHintId}
                  placeholder={t(`${K}.rows.hl_value.placeholder`)}
                  className={cn(FIELD, hlBad && FIELD_INVALID)}
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

            {/* One slot, three jobs, in priority order: why the button is dead,
                what is waiting to be written, and otherwise where the number on
                screen came from. Growing a second line for the error would move
                the button out from under the cursor at the moment it is refused. */}
            <span
              className={blockedKey !== null ? PROVENANCE_BLOCKED : PROVENANCE}
              role={blockedKey !== null ? "alert" : undefined}
            >
              {blockedKey !== null ? (
                t(blockedKey, { min: TTL_MIN, max: TTL_MAX })
              ) : dirtyCount > 0 ? (
                t(`${K}.footer.unsaved`, { count: dirtyCount })
              ) : (
                <>
                  {t(`${K}.cards.ttl.provenance`)}{" "}
                  <span className="font-mono">{TTL_STATE_PATH}</span>
                </>
              )}
            </span>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export default TtlSettingsCard;
