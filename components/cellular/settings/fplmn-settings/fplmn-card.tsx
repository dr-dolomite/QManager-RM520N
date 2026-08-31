"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import ConditionScreen, {
  type ConditionTone,
} from "@/components/cellular/condition-screen";
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import type { MaterialSymbolName } from "@/components/ui/material-symbol";
import { authFetch } from "@/lib/auth-fetch";
import { staggerRowItem } from "@/lib/motion";

import {
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  CONDITION_ACTIONS,
  INLINE_LINK,
  INLINE_LINK_GLYPH,
  PILL_ACTION,
  PILL_ACTION_GLYPH,
} from "../shapes";

// =============================================================================
// Blocked Networks (FPLMN) — the whole surface, as one condition
// =============================================================================
// This card reports exactly ONE fact: whether the SIM's forbidden-PLMN list has
// anything in it. There is no loaded "layout" to fall back to — the fact IS the
// body — so every state renders through `ConditionScreen`, the shared shape for
// "a condition replaced the page body".
//
// FIVE STATES, FIVE GLYPHS. `success-container` and `warning-container` measure
// ~1.03:1 apart and are identical under deuteranopia, so the glyph is the only
// channel that survives grayscale. Two of these states (`entries`, `error`) are
// both `destructive`, which makes `cancel` vs `error` load-bearing rather than
// decorative — they must never collapse to one glyph.
//
// THE UNKNOWN STATE IS A BUG FIX. The incumbent render branched on
// `hasEntries === true` for the alarming state and fell through to the
// reassuring "No Blocked Networks" for EVERYTHING else — including `null`, the
// initial value that survives any failed read. A surface whose only job is
// reporting a fault was asserting "no fault" when it had no data at all, which
// is what DESIGN.md's State-Honesty Rule forbids. `null` now gets its own
// neutral screen that says we could not determine it, plus a retry.
//
// WHY THE CLEAN STATE IS `success` AND NOT `neutral`. This paragraph used to
// argue for `primary` on the grounds that `ConditionScreen` had no `success`
// tone. It has one now — the member was added FOR this surface — and the code
// moved while the comment did not, which in a file this comment-dense is its own
// defect: the next reader trusts the prose. Corrected here. The live reasoning
// is unchanged in substance: `neutral` is already spoken for by the unknown
// state, and clean vs unknown are exactly the two states a user must never
// confuse, so they cannot share a container fill and lean on the glyph alone.
// `success` is now available and is the honest tone for "we read the SIM and
// there is nothing blocked" — a verified good state, not merely an
// informational one.
//
// WHY THE LOADING STATE IS A `ConditionScreen` AND NOT A SKELETON. The
// Skeleton-Mirror Rule says a skeleton must mirror the loaded geometry by
// SHARING it, never by restating numbers — and the incumbent skeleton restated
// four (`h-12 w-12 rounded-xl`, `h-5 w-48`, `h-4 w-64`, `h-9 w-36`), none of
// which matched what actually rendered. The loaded body here is one condition
// block whose content is entirely text, so the perfect mirror is the component
// itself, driven transient. It cannot drift, because it is the same code.
// `spin` is honest here for the same reason it is banned elsewhere: this
// condition really is transient work in flight.
//
// THE CLEAR IS CONFIRMED. It writes the SIM's EF_FPLMN and there is no undo;
// it previously fired straight from the button's `onClick`. Nothing here
// reboots, so the dialog says so plainly rather than implying a risk that does
// not exist.
//
// FOLLOW-UP (out of scope): the CGI already returns `raw_data`, 24 hex chars
// holding the actual blocked PLMNs. It is fetched and thrown away. Decoding it
// into a real MCC-MNC list would turn this boolean into an answer.
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/cellular/fplmn.sh";

const LEARN_MORE_URL =
  "https://onomondo.com/blog/how-to-clear-the-fplmn-list-on-a-sim/";

const K = "core_settings.fplmn";

/** The CGI envelope. `has_entries` is the only field this surface consumes. */
interface FplmnResponse {
  success?: boolean;
  has_entries?: boolean;
  /** 24 hex chars. Fetched by the backend, not yet surfaced — see the header. */
  raw_data?: string;
  detail?: string;
}

type ScreenState = "loading" | "error" | "entries" | "clean" | "unknown";

const SCREEN_TONE: Record<
  ScreenState,
  { tone: ConditionTone; glyph: MaterialSymbolName; ariaRole: "alert" | "status" }
> = {
  loading: { tone: "neutral", glyph: "progress_activity", ariaRole: "status" },
  error: { tone: "destructive", glyph: "error", ariaRole: "alert" },
  entries: { tone: "destructive", glyph: "cancel", ariaRole: "alert" },
  clean: { tone: "success", glyph: "check_circle", ariaRole: "status" },
  unknown: { tone: "neutral", glyph: "help", ariaRole: "status" },
};

export function FPLMNCard() {
  const { t } = useTranslation("cellular");

  const [hasEntries, setHasEntries] = React.useState<boolean | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isClearing, setIsClearing] = React.useState(false);
  const [fetchError, setFetchError] = React.useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const mountedRef = React.useRef(true);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // `t` is read through a ref inside the async callbacks below. i18next hands
  // back a NEW `t` identity on every language change, and a `t` in this
  // callback's dependency array would rebuild `fetchStatus` and re-run the
  // mount effect on a language switch — a re-read the user did not ask for.
  const tRef = React.useRef(t);
  React.useEffect(() => {
    tRef.current = t;
  }, [t]);

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  const fetchStatus = React.useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    setFetchError(null);

    try {
      const resp = await authFetch(CGI_ENDPOINT);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const data = (await resp.json()) as FplmnResponse;
      if (!mountedRef.current) return;

      if (data.success) {
        // Normalised rather than assigned straight through: a success envelope
        // with no boolean is genuinely UNKNOWN, and coercing it to `false`
        // here is precisely the false reassurance this rebuild removes.
        setHasEntries(
          typeof data.has_entries === "boolean" ? data.has_entries : null,
        );
      } else {
        setFetchError(data.detail || tRef.current(`${K}.errors.read_failed`));
      }
    } catch {
      if (mountedRef.current) {
        setFetchError(tRef.current(`${K}.errors.unreachable`));
      }
    } finally {
      if (mountedRef.current && !silent) {
        setIsLoading(false);
      }
    }
  }, []);

  React.useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  // ---------------------------------------------------------------------------
  // Write — confirmed, because it edits the SIM and cannot be undone
  // ---------------------------------------------------------------------------

  const handleClear = async () => {
    setConfirmOpen(false);
    setIsClearing(true);

    try {
      const resp = await authFetch(CGI_ENDPOINT, { method: "POST" });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const data = (await resp.json()) as FplmnResponse;
      if (!mountedRef.current) return;

      if (data.success) {
        toast.success(t(`${K}.toast.cleared`));
        await fetchStatus(true);
      } else {
        toast.error(data.detail || t(`${K}.toast.clear_failed`));
      }
    } catch {
      if (mountedRef.current) {
        toast.error(t(`${K}.toast.clear_failed`));
      }
    } finally {
      if (mountedRef.current) {
        setIsClearing(false);
      }
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const state: ScreenState = isLoading
    ? "loading"
    : fetchError
      ? "error"
      : hasEntries === true
        ? "entries"
        : hasEntries === false
          ? "clean"
          : "unknown";

  const spec = SCREEN_TONE[state];

  const description =
    state === "error" ? (fetchError ?? "") : t(`${K}.states.${state}.description`);

  // The three refresh-shaped states own the screen's own retry affordance —
  // it renders a `refresh` glyph, which is exactly what they mean. The
  // entries state does not: its action is a destructive write behind a
  // confirmation, and that belongs in a real Button below the screen.
  const onRetry =
    state === "clean" || state === "unknown" || state === "error"
      ? () => void fetchStatus()
      : undefined;

  return (
    <Card className={CARD_SHELL}>
      {/* No icon in a CardHeader, ever. */}
      <CardHeader className={CARD_PAD}>
        <CardTitle className={CARD_TITLE}>{t(`${K}.card.title`)}</CardTitle>
        <CardDescription>
          {t(`${K}.card.description`)}{" "}
          <a
            href={LEARN_MORE_URL}
            target="_blank"
            rel="noreferrer"
            className={INLINE_LINK}
          >
            {t(`${K}.card.learn_more`)}
            <MaterialSymbol name="open_in_new" size={INLINE_LINK_GLYPH} />
          </a>
        </CardDescription>
      </CardHeader>

      <CardContent className={CARD_PAD}>
        {/* ENTER-ONLY. A condition has no exit animation (DESIGN.md > The
            Enter-Only Rule), and `mode="wait"` made that concretely expensive:
            the incoming state could not mount until the outgoing one finished
            leaving, so pressing Retry bought ~600ms of empty card before the
            answer appeared. `key={state}` still remounts on a state change, so
            each new condition still arrives.

            The rise is `staggerRowItem`, not the hand-written `y: 4` that was
            here. Four pixels was a third travel distance against a system that
            authors exactly two — 10px for cards, 5px for rows inside one card —
            and it carried its own duration and curve literals besides, so a
            retune of the scale would have left this one block behind. Sharing
            the variant also makes it identical to the swap next door on Network
            Priority, which is the point of both surfaces having one. */}
        <AnimatePresence initial={false}>
          <motion.div
            key={state}
            variants={staggerRowItem}
            initial="hidden"
            animate="visible"
            className="flex flex-col gap-4"
          >
            <ConditionScreen
              tone={spec.tone}
              glyph={spec.glyph}
              spin={state === "loading"}
              ariaRole={spec.ariaRole}
              title={t(`${K}.states.${state}.title`)}
              description={description}
              onRetry={onRetry}
              retryLabel={
                state === "error"
                  ? t("common:actions.retry")
                  : t(`${K}.actions.refresh`)
              }
            />

            {state === "entries" ? (
              <div className={CONDITION_ACTIONS}>
                <Button
                  type="button"
                  variant="destructive"
                  className={PILL_ACTION}
                  onClick={() => setConfirmOpen(true)}
                  disabled={isClearing}
                >
                  {isClearing ? (
                    <>
                      {/* `motion-safe:`, matching `ConditionScreen`'s own
                          spinner. Both variants are redefined in globals.css so
                          the Animations preference can outrank the OS setting
                          in EITHER direction, and two spellings for one gesture
                          inside one feature is how a future retune misses
                          half of it. */}
                      <MaterialSymbol
                        name="progress_activity"
                        size={PILL_ACTION_GLYPH}
                        className="motion-safe:animate-spin"
                      />
                      {t(`${K}.actions.clearing`)}
                    </>
                  ) : (
                    <>
                      <MaterialSymbol
                        name="delete_sweep"
                        size={PILL_ACTION_GLYPH}
                      />
                      {t(`${K}.actions.clear`)}
                    </>
                  )}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className={PILL_ACTION}
                  onClick={() => void fetchStatus()}
                  disabled={isClearing}
                >
                  <MaterialSymbol name="refresh" size={PILL_ACTION_GLYPH} />
                  {t(`${K}.actions.refresh`)}
                </Button>
              </div>
            ) : null}
          </motion.div>
        </AnimatePresence>
      </CardContent>

      {/* The confirmation. `alert-dialog.tsx` already writes its two directions
          separately (emphasized in, quick out) so the page is not left
          click-dead behind an invisible dialog — inherited, unchanged. */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(`${K}.confirm.title`)}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(`${K}.confirm.description`)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common:actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleClear}>
              {t(`${K}.confirm.confirm`)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export default FPLMNCard;
