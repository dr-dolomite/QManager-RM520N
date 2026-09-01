"use client";

import * as React from "react";
import { motion, type Variants } from "motion/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  DownloadIcon,
  Loader2Icon,
  PlusIcon,
  RotateCcwIcon,
  TargetIcon,
  UploadIcon,
  XIcon,
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
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";
import { DUR, EASE_STANDARD, rowCascadeDelay } from "@/lib/motion";

import {
  CARD_HEAD,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  FIELD,
  FIELD_ROW,
  HOST_ROW,
  HOST_MAX_COLUMNS,
  HOST_VISIBLE_ROWS,
  ICON_ACTION,
  PILL_ACTION,
  SKELETON,
} from "./shapes";
import type { UseCdnHostlistReturn } from "@/hooks/use-cdn-hostlist";
import type { DpiMode } from "@/types/traffic-engine";

// =============================================================================
// TargetsCard — the Video Optimizer hostlist editor
// =============================================================================
// Replaces `cdn-hostlist-card.tsx`. Two things change beyond the tokens, and
// the 2026-08-31 polish pass added three more, recorded further down.
//
// -----------------------------------------------------------------------------
// A CONTROL THAT CANNOT WORK NOW EXPLAINS WHY, INSTEAD OF DISAPPEARING
// -----------------------------------------------------------------------------
// Finding 17. Switching to Full Bypass (then called Traffic Masquerade) used to
// unmount this editor with its tab. The saved list still exists and applies the
// moment you switch back — but the interface's only statement about that was
// its absence, which reads as "the list is gone" (The State-Honesty Rule).
//
// The card now stays mounted in every mode and says what is true: full bypass
// desyncs every connection, so there is no list to match against, and the saved
// domains are kept. The count Tag changes with it — "12 of 300" while the list
// is live, "12 saved" while it is idle — because the ceiling is only meaningful
// when there is something to fill.
//
// The editor is deliberately NOT disabled in the idle state either. The list is
// stored independently of the mode and tpws re-reads it per connection, so
// editing it while full bypass is on is a legitimate thing to do; what would be
// dishonest is implying the edits take effect right now. The same reasoning
// governs import, export and restore: none of the three is gated on the mode.
//
// -----------------------------------------------------------------------------
// THE BANNER ROLE IS `override`, WHERE THE COMP DREW `info`
// -----------------------------------------------------------------------------
// Stated rather than hidden. Every `primary-container` banner role in the canon
// is a system CONDITION or a notification; this is a page-scoped note about one
// control, which is exactly what `override` is defined as — and it is the one
// role whose ink is `on-surface` rather than an `on-*-container`. Neutral is
// also the honest tone: nothing here is wrong.
//
// -----------------------------------------------------------------------------
// THE LIST IS A VIEWPORT, NOT A COLUMN (2026-08-31, user report R4)
// -----------------------------------------------------------------------------
// "It takes a lot of vertical AND horizontal space." Both halves are one shape:
// a domain is eleven characters and each chip was a full card width, so most of
// every row was empty pill, and 21 of them stacked ran past 900px. The fix is
// `HOST_ROW.VIEWPORT` wrapping `HOST_ROW.GRID` — columns reclaim the horizontal
// run, the cap bounds the vertical.
//
// The skeleton renders `HOST_VISIBLE_ROWS` blocks inside the SAME two
// constants. That is The Skeleton-Mirror Rule, and it is not decoration here:
// the retired skeleton drew four bare blocks in a flex column against a loaded
// state that was neither four rows nor one column, so the handoff jumped twice.
//
// -----------------------------------------------------------------------------
// THE CASCADE IS CAPPED, AND THE CAP IS THE SHARED ONE
// -----------------------------------------------------------------------------
// This list holds up to 300 entries. `staggerRows` drives its cascade with
// `staggerChildren`, which is unbounded, so the last domain used to land 24
// seconds after the first — `lib/motion.ts` names that failure in its own JSDoc
// ("row 180 wait[s] 14 seconds to appear, which is not choreography, it is a
// bug") and exports `rowCascadeDelay` as the answer.
//
// The scroll cap above makes it worse rather than better: a row scrolled into
// view would sit invisible until its slot fired. So the delay moves onto the
// item variant via `custom`, exactly as `band-grid-card.tsx` does it, and the
// parent carries `initial`/`animate` with no `variants` of its own so nothing
// adds a second stagger on top.
// =============================================================================

const DOMAIN_PATTERN = /^[A-Za-z0-9._-]+$/;
const MAX_DOMAINS = 300;

/**
 * The per-domain length ceiling, mirrored from the CGI.
 *
 * `video_optimizer.sh` rejects any entry over 253 characters, and the write is
 * ATOMIC and all-or-nothing: one over-length line in an imported file rejects
 * the entire merge, after a toast has already told the user "42 domains added".
 * So the ceiling is checked here, on both write paths, rather than discovered
 * from a `detail` string once the modem has refused the whole batch.
 *
 * 253 is the DNS name limit (255 wire octets, less the root label's length byte
 * and terminator), so it is the backend's number rather than a policy this file
 * invented — which is why it is named after the rule and not after this card.
 */
const MAX_DOMAIN_LENGTH = 253;

/**
 * The import size ceiling, checked BEFORE the file is read.
 *
 * A file picker will hand back a 4GB file as cheerfully as a 4KB one, and
 * `FileReader.readAsText` would try to hold all of it as a string. 300 domains
 * at the 253-character ceiling is ~76KB even in the pathological case, so 256KB
 * is generous for every real hostlist and still refuses anything that was
 * plainly not one.
 */
const MAX_IMPORT_BYTES = 256 * 1024;

/**
 * The first line of an exported file, byte-identical to the one the CGI writes
 * at the top of `video_domains.txt`.
 *
 * Export writes the DEVICE's own format so a round-trip is lossless: the import
 * parser strips `#` comments, and so does the backend's own reader, which means
 * a file exported here can be dropped straight back in, or hand-edited, or
 * copied to a second modem, without either end needing to know about the other.
 */
const EXPORT_HEADER = "# QManager Video Optimizer hostlist";

/**
 * One domain chip's entrance.
 *
 * `staggerRowItem`'s 5px rise and `DUR.standard` on `EASE_STANDARD` are the
 * tokens; the only addition is the capped delay, which cannot be expressed
 * through `staggerChildren` because that has no ceiling. Restated here rather
 * than imported because a variant carrying a `custom` function is a different
 * shape from the plain object `staggerRowItem` exports.
 */
const hostChipVariants: Variants = {
  hidden: { opacity: 0, y: 5 },
  visible: (index: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      duration: DUR.standard,
      ease: EASE_STANDARD,
      delay: rowCascadeDelay(index),
    },
  }),
};

/**
 * The three rules the CGI applies per entry, in one place.
 *
 * Charset, the dot, and the length ceiling. Both write paths call this, so the
 * single-add field and a bulk import can never disagree about what the modem
 * will accept.
 */
function isAcceptableDomain(value: string): boolean {
  return (
    DOMAIN_PATTERN.test(value) &&
    value.includes(".") &&
    value.length <= MAX_DOMAIN_LENGTH
  );
}

/** Which list action currently owns the card, so each control spins alone. */
type ListAction = "import" | "restore";

export interface TargetsCardProps {
  hostlist: UseCdnHostlistReturn;
  /** The single derived answer. Decides live vs idle, never a data sniff. */
  mode: DpiMode;
}

export function TargetsCard({ hostlist, mode }: TargetsCardProps) {
  const { t } = useTranslation("common");

  const [draft, setDraft] = React.useState("");
  const [localError, setLocalError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<ListAction | null>(null);
  const [restoreOpen, setRestoreOpen] = React.useState(false);
  const importInputRef = React.useRef<HTMLInputElement>(null);

  // The list is not consulted while Full Bypass owns the engine. It is still
  // stored, still editable, and still applies the moment the mode changes back.
  const idle = mode === "full_bypass";
  const count = hostlist.domains.length;
  const defaultCount = hostlist.defaultDomains.length;
  const listBusy = busy !== null || hostlist.isSaving;

  const addDomain = () => {
    const value = draft.trim().toLowerCase();
    setLocalError(null);
    if (!value) return;
    if (!DOMAIN_PATTERN.test(value) || !value.includes(".")) {
      setLocalError(t("trafficEngine.hostlist.invalid"));
      return;
    }
    // Its own message rather than the charset one: a 300-character string IS a
    // valid domain shape, and telling its author to check for stray punctuation
    // would send them looking for a defect that is not there.
    if (value.length > MAX_DOMAIN_LENGTH) {
      setLocalError(t("trafficEngine.hostlist.too_long", { max: MAX_DOMAIN_LENGTH }));
      return;
    }
    if (hostlist.domains.includes(value)) {
      setLocalError(t("trafficEngine.hostlist.duplicate"));
      return;
    }
    if (count >= MAX_DOMAINS) {
      setLocalError(t("trafficEngine.hostlist.limit"));
      return;
    }
    hostlist.saveDomains([...hostlist.domains, value]).then((ok) => {
      if (ok) {
        setDraft("");
        toast.success(t("trafficEngine.hostlist.saved"));
      } else {
        // Backend failures must never be silent: the hook records the error
        // (rendered inline below) and the toast makes the failure immediate.
        toast.error(t("trafficEngine.hostlist.save_failed"));
      }
    });
  };

  const removeDomain = (domain: string) => {
    hostlist.saveDomains(hostlist.domains.filter((d) => d !== domain)).then((ok) => {
      toast[ok ? "success" : "error"](
        t(ok ? "trafficEngine.hostlist.saved" : "trafficEngine.hostlist.save_failed"),
      );
    });
  };

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------
  // The pattern `at-terminal-card.tsx` already ships: a text Blob, an object
  // URL, a synthetic anchor, then a revoke. There is no CSP anywhere in this app
  // (no security headers in lighttpd.conf, and next.config.ts is a bare
  // `output: "export"`), so a `blob:` href is not blocked on the device.
  const exportList = () => {
    const date = new Date().toISOString().slice(0, 10);
    const text = `${[EXPORT_HEADER, ...hostlist.domains].join("\n")}\n`;
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `video-optimizer-targets-${date}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  // ---------------------------------------------------------------------------
  // Import — a MERGE, never a replace
  // ---------------------------------------------------------------------------
  // Importing must never destroy what is already saved, so the parsed file is
  // unioned onto the existing list rather than substituted for it. Restore
  // defaults is the one control on this card that replaces, and it is the one
  // control that asks first.
  const mergeImported = (text: string) => {
    const existing = new Set(hostlist.domains);
    const seen = new Set<string>();
    const additions: string[] = [];
    let invalid = 0;
    let duplicate = 0;

    // `\r` alone is split too: a file that has been through a Windows editor
    // and back can carry any of the three terminators, and one unsplit line is
    // indistinguishable from a corrupt file to everything downstream.
    for (const rawLine of text.split(/\r\n|\r|\n/)) {
      const line = rawLine.trim();
      // The device's own format, so a file exported from here reads back in
      // without its header being counted as a rejected entry.
      if (line === "" || line.startsWith("#")) continue;
      const value = line.toLowerCase();
      if (!isAcceptableDomain(value)) {
        invalid += 1;
        continue;
      }
      if (existing.has(value) || seen.has(value)) {
        duplicate += 1;
        continue;
      }
      seen.add(value);
      additions.push(value);
    }

    const room = Math.max(0, MAX_DOMAINS - count);
    const accepted = additions.slice(0, room);
    const dropped = additions.length - accepted.length;

    // Only the non-zero reasons are reported. A clean import that says
    // "0 invalid, 0 already present, 0 over the limit" is three sentences of
    // noise that the reader has to parse to learn nothing.
    const skipped: string[] = [];
    if (invalid > 0) {
      skipped.push(t("trafficEngine.hostlist.import_invalid", { count: invalid }));
    }
    if (duplicate > 0) {
      skipped.push(t("trafficEngine.hostlist.import_duplicate", { count: duplicate }));
    }
    if (dropped > 0) {
      skipped.push(
        t("trafficEngine.hostlist.import_dropped", { count: dropped, max: MAX_DOMAINS }),
      );
    }
    const description = skipped.length > 0 ? skipped.join(" ") : undefined;

    if (accepted.length === 0) {
      // Nothing to write, so nothing is sent. This is not an error state: a
      // file whose every line was already saved did exactly what it should.
      setBusy(null);
      if (description === undefined) {
        toast.warning(t("trafficEngine.hostlist.import_empty"));
      } else {
        toast.warning(t("trafficEngine.hostlist.import_none"), { description });
      }
      return;
    }

    // THE COUNT IS CLAIMED ONLY AFTER THE WRITE RESOLVES. `saveDomains` returns
    // a boolean and the CGI's write is atomic, so a toast fired before it
    // returned would be reporting a merge the modem may have refused outright.
    hostlist
      .saveDomains([...hostlist.domains, ...accepted])
      .then((ok) => {
        if (ok) {
          toast.success(
            t("trafficEngine.hostlist.import_added", { count: accepted.length }),
            { description },
          );
        } else {
          toast.error(t("trafficEngine.hostlist.save_failed"));
        }
      })
      .finally(() => setBusy(null));
  };

  const handleImportFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset immediately rather than at the end of the handler: every path below
    // this line can return early, and an input still holding the last filename
    // fires no `change` when the same file is picked again.
    event.target.value = "";
    if (!file) return;

    if (file.size > MAX_IMPORT_BYTES) {
      toast.error(
        t("trafficEngine.hostlist.import_too_large", {
          limit: Math.round(MAX_IMPORT_BYTES / 1024),
        }),
      );
      return;
    }

    setBusy("import");
    const reader = new FileReader();
    reader.onerror = () => {
      setBusy(null);
      toast.error(t("trafficEngine.hostlist.import_unreadable"));
    };
    reader.onload = () => {
      mergeImported(typeof reader.result === "string" ? reader.result : "");
    };
    reader.readAsText(file);
  };

  const confirmRestore = () => {
    setBusy("restore");
    hostlist
      .restoreDefaults()
      .then((ok) => {
        toast[ok ? "success" : "error"](
          t(
            ok
              ? "trafficEngine.hostlist.restore_done"
              : "trafficEngine.hostlist.restore_failed",
          ),
        );
      })
      .finally(() => {
        setBusy(null);
        setRestoreOpen(false);
      });
  };

  return (
    <Card className={CARD_SHELL}>
      {/* `ROOT_WRAP` / `ACTIONS_WRAP` rather than `ROOT` / `ACTIONS`: the plain
          pair is `flex-none`, which never shrinks, so on a narrow card a group
          of four controls would take the width it wants and `CARD_TITLE` —
          which WRAPS by design rather than truncating — would absorb the whole
          loss. The wrapping pair drops the group onto its own line instead and
          only claims the right edge once the card is wide enough to give it
          one. See CARD_HEAD in shapes.ts. */}
      <CardHeader className={cn(CARD_PAD, CARD_HEAD.ROOT_WRAP)}>
        <div className={CARD_HEAD.TITLES}>
          <span className={CARD_TITLE}>{t("trafficEngine.targets.title")}</span>
          <span className={CARD_HEAD.DESC}>
            {t("trafficEngine.targets.description")}
          </span>
        </div>
        {hostlist.isLoading ? null : (
          <div className={CARD_HEAD.ACTIONS_WRAP}>
            <Tag variant="neutral" className="tabular-nums">
              {idle
                ? t("trafficEngine.targets.count_saved", { count })
                : t("trafficEngine.targets.count", { count, max: MAX_DOMAINS })}
            </Tag>

            {/* Icon-only, so every label lives in BOTH `aria-label` and
                `title`: the first serves a screen reader, the second serves a
                sighted user who does not recognise the glyph. Three unlabelled
                icons in a row is a guessing game. */}
            <input
              ref={importInputRef}
              type="file"
              accept=".txt,text/plain"
              className="hidden"
              onChange={handleImportFile}
            />
            <Button
              variant="ghost"
              className={ICON_ACTION}
              disabled={listBusy}
              aria-label={t("trafficEngine.hostlist.import_action")}
              title={t("trafficEngine.hostlist.import_action")}
              onClick={() => importInputRef.current?.click()}
            >
              {busy === "import" ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <UploadIcon />
              )}
            </Button>

            {/* Disabled on an empty list: an export of nothing is a file the
                user has to open to discover is empty. */}
            <Button
              variant="ghost"
              className={ICON_ACTION}
              disabled={count === 0}
              aria-label={t("trafficEngine.hostlist.export_action")}
              title={t("trafficEngine.hostlist.export_action")}
              onClick={exportList}
            >
              <DownloadIcon />
            </Button>

            {/* The one control on this card that REPLACES rather than adds, so
                it is the one that confirms first, and the confirm names how
                many saved domains are about to go. */}
            <AlertDialog open={restoreOpen} onOpenChange={setRestoreOpen}>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  className={ICON_ACTION}
                  disabled={listBusy}
                  aria-label={t("trafficEngine.hostlist.restore_action")}
                  title={t("trafficEngine.hostlist.restore_action")}
                >
                  {busy === "restore" ? (
                    <Loader2Icon className="animate-spin" />
                  ) : (
                    <RotateCcwIcon />
                  )}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {t("trafficEngine.hostlist.restore_title")}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {count > 0
                      ? t("trafficEngine.hostlist.restore_body", { count })
                      : t("trafficEngine.hostlist.restore_body_empty")}
                    {defaultCount > 0
                      ? ` ${t("trafficEngine.hostlist.restore_body_defaults", {
                          count: defaultCount,
                        })}`
                      : null}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={busy === "restore"}>
                    {t("trafficEngine.hostlist.restore_cancel")}
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={(event) => {
                      // The dialog closes on the write's result, not on the
                      // click, so the confirm can report a refusal instead of
                      // dismissing over one.
                      event.preventDefault();
                      confirmRestore();
                    }}
                    disabled={busy === "restore"}
                  >
                    {t("trafficEngine.hostlist.restore_confirm")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </CardHeader>

      <CardContent className={cn(CARD_PAD, "flex flex-col gap-4")}>
        {idle ? (
          <Banner
            role="override"
            icon={TargetIcon}
            title={t("trafficEngine.targets.idle_title")}
            description={
              count > 0
                ? t("trafficEngine.targets.idle_body", { count })
                : t("trafficEngine.targets.idle_body_empty")
            }
          />
        ) : null}

        {hostlist.isLoading ? (
          // The Skeleton-Mirror Rule, by reference: the same VIEWPORT, the same
          // GRID, the same row HEIGHT, and `HOST_VISIBLE_ROWS` blocks, which is
          // the count the cap itself is derived from. Nothing here restates a
          // number, so the loading state cannot drift from the loaded one.
          <div className={HOST_ROW.VIEWPORT}>
            <div className={HOST_ROW.GRID}>
              {Array.from({ length: HOST_VISIBLE_ROWS * HOST_MAX_COLUMNS }).map((_, index) => (
                <Skeleton key={index} className={cn(HOST_ROW.HEIGHT, "rounded-pill")} />
              ))}
            </div>
          </div>
        ) : count === 0 ? (
          <p className="text-on-surface-variant text-sm">
            {t("trafficEngine.hostlist.empty")}
          </p>
        ) : (
          <div className={HOST_ROW.VIEWPORT}>
            <motion.ul className={HOST_ROW.GRID} initial="hidden" animate="visible">
              {hostlist.domains.map((domain, index) => (
                <motion.li
                  key={domain}
                  className={HOST_ROW.ROOT}
                  custom={index}
                  variants={hostChipVariants}
                >
                  {/* A domain IS a machine string — matched byte-for-byte against
                      the SNI on the wire — so this is one of the places the
                      Machine-Voice Rule genuinely sends text to `font-mono`. */}
                  <span className={HOST_ROW.TEXT}>{domain}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={HOST_ROW.REMOVE}
                    aria-label={t("trafficEngine.hostlist.remove", { domain })}
                    onClick={() => removeDomain(domain)}
                  >
                    <XIcon className={HOST_ROW.GLYPH} />
                  </Button>
                </motion.li>
              ))}
            </motion.ul>
          </div>
        )}

        <div className={FIELD_ROW}>
          {/* A raw input, deliberately not the `Input` primitive — its base
              string carries `dark:bg-input/30` and `md:text-sm`, so the fill
              reverts in dark mode and the size reverts at a 768px VIEWPORT,
              which is a viewport breakpoint leaking into a container-query
              surface. See `FIELD` in shapes.ts. */}
          <input
            type="text"
            placeholder="example.com"
            className={FIELD}
            value={draft}
            aria-label={t("trafficEngine.hostlist.add")}
            aria-invalid={localError !== null}
            onChange={(event) => {
              setDraft(event.target.value);
              setLocalError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addDomain();
              }
            }}
          />
          <Button
            onClick={addDomain}
            disabled={!draft.trim() || listBusy}
            className={PILL_ACTION}
          >
            {hostlist.isSaving ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <PlusIcon className="size-4" />
            )}
            {t("trafficEngine.hostlist.add")}
          </Button>
        </div>

        {localError !== null ? (
          <p className="text-destructive-on-surface text-sm" role="alert">
            {localError}
          </p>
        ) : null}

        {hostlist.error !== null ? (
          <p className="text-destructive-on-surface text-sm" role="alert">
            {hostlist.error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * The loading mirror, for the PAGE's read rather than the hostlist's.
 *
 * Two different loads reach this card and only one of them was ever drawn. The
 * hostlist's own read is handled inside the card above (the list becomes
 * `HOST_VISIBLE_ROWS` blocks and the header keeps its actions); the PAGE's read
 * used to render nothing at all, so the whole card arrived after the fact along
 * with the two above it. That is the reported defect: the skeleton "doesnt
 * really show the true content once loaded".
 *
 * Everything geometric here is imported. The header line boxes come from
 * `SKELETON`, the list from `HOST_ROW` and `HOST_VISIBLE_ROWS`, the field row
 * from `FIELD_ROW` -- so this file states no number the loaded view does not
 * also state.
 */
export function TargetsCardSkeleton() {
  return (
    <Card className={CARD_SHELL} aria-hidden="true">
      <CardHeader className={cn(CARD_PAD, CARD_HEAD.ROOT_WRAP)}>
        <div className={cn(CARD_HEAD.TITLES, "w-full max-w-[26rem]")}>
          <Skeleton className={cn(SKELETON.LINE, "w-40")} />
          <Skeleton className={cn(SKELETON.LINE_SM, "w-full")} />
        </div>
      </CardHeader>
      <CardContent className={cn(CARD_PAD, "flex flex-col gap-4")}>
        <div className={HOST_ROW.VIEWPORT}>
          <div className={HOST_ROW.GRID}>
            {Array.from({ length: HOST_VISIBLE_ROWS * HOST_MAX_COLUMNS }).map((_, index) => (
              <Skeleton key={index} className={cn(HOST_ROW.HEIGHT, "rounded-pill")} />
            ))}
          </div>
        </div>
        <div className={FIELD_ROW}>
          <Skeleton className={cn(SKELETON.PILL, "flex-1 rounded-field")} />
          <Skeleton className={cn(SKELETON.PILL, "w-32")} />
        </div>
      </CardContent>
    </Card>
  );
}

export default TargetsCard;
