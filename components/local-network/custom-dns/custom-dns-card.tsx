"use client";

import {
  useMemo,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { PlusIcon, XIcon } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { SaveButton } from "@/components/ui/save-button";
import { cn } from "@/lib/utils";
import type {
  CustomDnsApplyData,
  CustomDnsFieldError,
} from "@/hooks/use-custom-dns";
import type { CustomDnsSettingsResponse } from "@/types/custom-dns";

import {
  CARD_FOOT,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  DELTA,
  ERROR_BOX,
  ERROR_TEXT,
  FIELD,
  FIELD_REMOVE,
  PILL_ACTION,
  PROVENANCE,
  ROW,
  ROW_GROUP,
} from "./shapes";

// =============================================================================
// CustomDnsCard — Band B of /local-network/custom-dns
// =============================================================================
// ONE write card, under the live strip. Every field on it changes what the
// modem forwards to; nothing on it is a readout, because the readout was
// promoted into Band A where the page's actual question lives.
//
// -----------------------------------------------------------------------------
// THE BACKEND'S REJECTION REASON IS NOW RENDERED
// -----------------------------------------------------------------------------
// `fieldError` was destructured by the retired card and never rendered once, so
// dnsmasq's specific complaint — "invalid IP address: 1.1.1.300", "too many
// servers (max 4)", or a `dnsmasq --test` transcript — was replaced by a generic
// band. The reason was on the wire the whole time.
//
// IT IS SCOPED TO THE GROUP, NOT TO A ROW, AND THAT IS MEASURED. The CGI sets
// `field` to exactly one of "enabled", "ignore_carrier" or "servers", and NEVER
// to a row index; six further failure paths carry no `field` at all. Targeting a
// row would mean string-parsing the prose message for an address and matching it
// back against local state, which fails silently the first time the backend
// rewords itself. So the message renders against the resolver GROUP when the
// field is "servers", and against the card otherwise.
//
// -----------------------------------------------------------------------------
// WHY THERE IS NO REPAIR BUTTON FOR A DAMAGED BLOCK
// -----------------------------------------------------------------------------
// The corruption notice is a page-level Banner in the shell and it offers no
// in-app remedy. The only verb the backend has for this is `action=clear`, which
// maps onto save-with-`enabled=false` and runs `strip_sentinel_block`. That
// function raises its in-block flag on the BEGIN sentinel and lowers it only on
// END — and a damaged block is DEFINED as one sentinel without the other. With
// BEGIN and no END, the flag never lowers and every following line of
// `dnsmasq.conf` is dropped: `listen-address`, `dhcp-authoritative`, `conf-dir`.
//
// Nothing downstream catches it. `dnsmasq --test` passes, because the truncated
// file is syntactically valid and merely missing directives. The result is then
// installed with `sudo mv` and made live with `killall -HUP dnsmasq`, on a
// device the reader is reaching over that same LAN.
//
// The flag also has a FALSE-POSITIVE path — the block parser reads with
// `while IFS= read -r line`, whose body never runs for a final line with no
// trailing newline, so a healthy file that ends exactly at the END marker
// reports damage. That is the second reason the notice does not disable this
// form: a false positive must not lock a user out of their own DNS settings.
// =============================================================================

const K = "customDns";

const MAX_RESOLVERS = 4;

/**
 * The file the whole surface is read back from, and the one thing a settings
 * card cannot otherwise tell you: the fields show what you asked for, and this
 * says where the answer comes from. A machine string, so it is never translated
 * and it renders in the mono face at the call site.
 */
const DNSMASQ_CONF = "/etc/data/dnsmasq.conf";

// IPv4 dotted-quad: four 0-255 octets.
const IPV4_RE =
  /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

// IPv6 (permissive): hex groups separated by colons, supporting the "::"
// shorthand. dnsmasq's own parser is the authoritative gate; this exists so the
// obvious typo is caught before a round trip, not to be exhaustive.
const IPV6_RE =
  /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;

function isValidResolver(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  return IPV4_RE.test(v) || IPV6_RE.test(v);
}

export interface CustomDnsCardProps {
  /**
   * The GET's payload, NEVER null.
   *
   * The shell mounts this component only once a read has landed, and the
   * skeleton below is what stands in until then. That is not a stylistic choice:
   * it is what lets every field initialise from the device at mount and never
   * re-synchronise, which removes the "hydrate once from a ref-guarded effect"
   * dance the retired card ran — a cascading render on every payload, guarded by
   * a mutable flag that had to be reset by hand after each save.
   */
  settings: CustomDnsSettingsResponse;
  isSaving: boolean;
  /** The save-flash window, owned by the shell so the pill and the flash agree. */
  saved: boolean;
  /** Transport or top-level read error. */
  error: string | null;
  /** The backend's own rejection reason for the most recent save. */
  fieldError: CustomDnsFieldError | null;
  /** False when dnsmasq is not in the path at all — every write is refused. */
  available: boolean;
  /**
   * True when the sentinel block is malformed. Read here ONLY to caption the
   * provenance line honestly; it deliberately does not disable anything.
   */
  blockCorrupt: boolean;
  onSave: (data: CustomDnsApplyData) => Promise<boolean>;
  onSaved: () => void;
}

export function CustomDnsCard({
  settings,
  isSaving,
  saved,
  error,
  fieldError,
  available,
  blockCorrupt,
  onSave,
  onSaved,
}: CustomDnsCardProps) {
  const { t } = useTranslation("common");

  // ---------------------------------------------------------------------------
  // Local form state — seeded from the device ONCE, at mount
  // ---------------------------------------------------------------------------
  // A lazy initialiser rather than a synchronising effect. Calling setState in
  // an effect body triggers a cascading render on every payload the poll
  // delivers, and the retired card's defence against that was a mutable
  // `hydratedRef` flag that had to be reset by hand after each save — a
  // one-line omission away from silently clobbering whatever the user was
  // halfway through typing.
  //
  // Mounting on a landed read removes the problem instead of guarding it: there
  // is exactly one moment this state can be seeded, and it is the moment the
  // component exists. A later Refresh updates the LIVE BAND above, which is what
  // Refresh is for; it deliberately does not reach into a form the user is
  // editing.
  const [localEnabled, setLocalEnabled] = useState(settings.enabled);
  const [localIgnoreCarrier, setLocalIgnoreCarrier] = useState(
    settings.ignoreCarrier,
  );
  const [localServers, setLocalServers] = useState<string[]>(() =>
    // One empty row when nothing is configured, so there is something to type
    // into rather than an "Add resolver" button standing alone.
    settings.servers.length > 0 ? [...settings.servers] : [""],
  );
  // Per-row blur-validated flag — true once the user has LEFT an invalid value.
  // Hidden while they are still typing, so a half-typed address is not scolded
  // one keystroke into itself.
  const [rowInvalid, setRowInvalid] = useState<boolean[]>(() =>
    (settings.servers.length > 0 ? settings.servers : [""]).map(() => false),
  );

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------
  const formDisabled = isSaving || !available;
  const rowsDisabled = formDisabled || !localEnabled;

  const trimmedServers = useMemo(
    () => localServers.map((s) => s.trim()),
    [localServers],
  );
  const nonEmptyServers = useMemo(
    () => trimmedServers.filter((s) => s.length > 0),
    [trimmedServers],
  );
  const anyRowInvalid = trimmedServers.some(
    (s, i) => s.length > 0 && !isValidResolver(s) && rowInvalid[i],
  );
  const emptyWhenEnabled = localEnabled && nonEmptyServers.length === 0;

  // What is on the device versus what is in the form, per row. `settings` is
  // replaced by the save response, so every marker goes clean the moment the
  // write lands — without anything having to clear them by hand.
  const savedServers = settings.servers;
  const enabledDirty = localEnabled !== settings.enabled;
  const ignoreDirty = localIgnoreCarrier !== settings.ignoreCarrier;
  const serverDirty = (index: number) =>
    (trimmedServers[index] ?? "") !== (savedServers[index] ?? "");

  // The backend's rejection reason, routed to the thing it is about. `servers`
  // is the only field that maps onto a group; everything else is about the card.
  const groupError =
    fieldError?.field === "servers" ? fieldError.message : null;
  const cardError = fieldError
    ? fieldError.field === "servers"
      ? null
      : fieldError.message
    : error;

  // Why the save cannot be taken, as a SENTENCE rather than a grey pill. The
  // order is the order a reader would hit them.
  const blockedReason = !available
    ? t(`${K}.card.blocked_unavailable`)
    : anyRowInvalid
      ? t(`${K}.errors.fix_rows`)
      : emptyWhenEnabled
        ? t(`${K}.errors.empty_when_enabled`)
        : null;

  // ---------------------------------------------------------------------------
  // Row helpers
  // ---------------------------------------------------------------------------
  const updateRow = (index: number, value: string) => {
    setLocalServers((rows) => {
      const next = [...rows];
      next[index] = value;
      return next;
    });
    setRowInvalid((flags) => {
      if (!flags[index]) return flags;
      const next = [...flags];
      next[index] = false;
      return next;
    });
  };

  const handleRowBlur = (index: number) => {
    const value = (localServers[index] ?? "").trim();
    setRowInvalid((flags) => {
      const next = [...flags];
      next[index] = value.length > 0 && !isValidResolver(value);
      return next;
    });
  };

  const addRow = () => {
    setLocalServers((rows) =>
      rows.length >= MAX_RESOLVERS ? rows : [...rows, ""],
    );
    setRowInvalid((flags) =>
      flags.length >= MAX_RESOLVERS ? flags : [...flags, false],
    );
  };

  const removeRow = (index: number) => {
    setLocalServers((rows) =>
      rows.length <= 1 ? [""] : rows.filter((_, i) => i !== index),
    );
    setRowInvalid((flags) =>
      flags.length <= 1 ? [false] : flags.filter((_, i) => i !== index),
    );
  };

  // Paste auto-split. A resolver pair is almost always copied as one string
  // ("1.1.1.1, 1.0.0.1"), and splitting it by hand across two fields is busywork
  // the page can do — which is exactly what the row's consequence sentence says.
  const handlePaste = (index: number, e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (!text) return;
    const parts = text
      .split(/[\s,;]+/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length <= 1) return;

    e.preventDefault();
    setLocalServers((rows) => {
      const next = [...rows];
      let slot = index;
      for (const part of parts) {
        if (slot >= MAX_RESOLVERS) break;
        if (slot >= next.length) next.push(part);
        else next[slot] = part;
        slot += 1;
      }
      return next.slice(0, MAX_RESOLVERS);
    });
    setRowInvalid((flags) => {
      const next = [...flags];
      let slot = index;
      for (let i = 0; i < parts.length; i += 1) {
        if (slot >= MAX_RESOLVERS) break;
        if (slot >= next.length) next.push(false);
        else next[slot] = false;
        slot += 1;
      }
      return next.slice(0, MAX_RESOLVERS);
    });
  };

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    if (index !== localServers.length - 1) return;
    if (localServers.length >= MAX_RESOLVERS) return;
    e.preventDefault();
    addRow();
  };

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    // Re-validate every non-empty row at submit time and mark the offenders, so
    // the button never performs a silent no-op: if this returns early, the rows
    // it returned early FOR have just been marked on screen.
    const finalInvalid = trimmedServers.map(
      (s) => s.length > 0 && !isValidResolver(s),
    );
    setRowInvalid(finalInvalid);
    if (finalInvalid.some(Boolean)) {
      toast.error(t(`${K}.errors.fix_rows`));
      return;
    }

    const ok = await onSave({
      enabled: localEnabled,
      ignoreCarrier: localIgnoreCarrier,
      servers: nonEmptyServers,
    });

    if (ok) {
      onSaved();
      toast.success(t(`${K}.toast_saved`));
    } else {
      toast.error(t(`${K}.toast_error`));
    }
  };

  const usedCount = nonEmptyServers.length;

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={CARD_PAD}>
        <CardTitle className={CARD_TITLE}>{t(`${K}.card.title`)}</CardTitle>
        <CardDescription>{t(`${K}.card.description`)}</CardDescription>
      </CardHeader>

      <CardContent className={cn(CARD_PAD, "flex flex-col gap-4")}>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className={ROW_GROUP}>
            {/* Row 1 — the switch the whole page hangs off. */}
            <div className={ROW.ROOT}>
              <div className={ROW.TEXT}>
                <div className="flex items-center gap-2">
                  <label htmlFor="custom-dns-enabled" className={ROW.LABEL}>
                    {t(`${K}.rows.enabled.label`)}
                  </label>
                  <span className={cn(DELTA.ROOT, !enabledDirty && DELTA.CLEAN)}>
                    {t(`${K}.delta.unsaved`)}
                  </span>
                </div>
                <span className={ROW.CONSEQUENCE}>
                  {t(`${K}.rows.enabled.consequence`)}
                </span>
              </div>
              <div className={ROW.CONTROL}>
                <Switch
                  id="custom-dns-enabled"
                  checked={localEnabled}
                  onCheckedChange={setLocalEnabled}
                  disabled={formDisabled}
                />
              </div>
            </div>

            {/* Rows 2..N — the resolvers. They DIM rather than disappearing
                while custom DNS is off: the rows are the answer to "what would
                turning this on give me", and hiding them makes the switch a
                leap. */}
            {localServers.map((value, index) => {
              const showInvalid = Boolean(rowInvalid[index]);
              const inputId = `custom-dns-server-${index}`;
              const dirty = serverDirty(index);
              return (
                <div key={index} className={ROW.ROOT}>
                  <div className={cn(ROW.TEXT, rowsDisabled && ROW.DIM)}>
                    <div className="flex items-center gap-2">
                      <label htmlFor={inputId} className={ROW.LABEL}>
                        {t(`${K}.rows.resolver.label`, { n: index + 1 })}
                      </label>
                      <span className={cn(DELTA.ROOT, !dirty && DELTA.CLEAN)}>
                        {t(`${K}.delta.unsaved`)}
                      </span>
                    </div>
                    {showInvalid ? (
                      <span role="alert" className={ROW.ERROR}>
                        {t(`${K}.errors.invalid_address`)}
                      </span>
                    ) : !localEnabled ? (
                      <span className={ROW.CONSEQUENCE}>
                        {t(`${K}.rows.resolver.consequence_off`)}
                      </span>
                    ) : index === 0 ? (
                      <span className={ROW.CONSEQUENCE}>
                        {t(`${K}.rows.resolver.consequence`)}
                      </span>
                    ) : null}
                  </div>
                  <div className={cn(ROW.CONTROL, "w-full @2xl/card:w-auto")}>
                    <input
                      id={inputId}
                      type="text"
                      inputMode="text"
                      autoComplete="off"
                      spellCheck={false}
                      className={cn(FIELD, "@2xl/card:w-[17rem]")}
                      value={value}
                      aria-invalid={showInvalid || undefined}
                      placeholder={t(`${K}.rows.resolver.placeholder`)}
                      disabled={rowsDisabled}
                      onChange={(e: ChangeEvent<HTMLInputElement>) =>
                        updateRow(index, e.target.value)
                      }
                      onBlur={() => handleRowBlur(index)}
                      onPaste={(e) => handlePaste(index, e)}
                      onKeyDown={(e) => handleKeyDown(index, e)}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className={FIELD_REMOVE}
                      onClick={() => removeRow(index)}
                      disabled={
                        rowsDisabled ||
                        (localServers.length === 1 && value === "")
                      }
                      aria-label={t(`${K}.rows.resolver.remove`, {
                        n: index + 1,
                      })}
                    >
                      <XIcon className="size-4" />
                    </Button>
                  </div>
                </div>
              );
            })}

            {/* The backend's own words about the resolver list, in the place the
                list lives. `emptyWhenEnabled` is caught locally and reads the
                same way, so the two never stack. */}
            {groupError || emptyWhenEnabled ? (
              <div className={ERROR_BOX} role="alert">
                <span className={ERROR_TEXT}>
                  {groupError ?? t(`${K}.errors.empty_when_enabled`)}
                </span>
              </div>
            ) : null}

            {/* Last row — the one whose OFF is louder than its ON. */}
            <div className={ROW.ROOT}>
              <div className={cn(ROW.TEXT, rowsDisabled && ROW.DIM)}>
                <div className="flex items-center gap-2">
                  <label
                    htmlFor="custom-dns-ignore-carrier"
                    className={ROW.LABEL}
                  >
                    {t(`${K}.rows.ignore_carrier.label`)}
                  </label>
                  <span className={cn(DELTA.ROOT, !ignoreDirty && DELTA.CLEAN)}>
                    {t(`${K}.delta.unsaved`)}
                  </span>
                </div>
                <span className={ROW.CONSEQUENCE}>
                  {t(`${K}.rows.ignore_carrier.consequence`)}
                </span>
              </div>
              <div className={ROW.CONTROL}>
                <Switch
                  id="custom-dns-ignore-carrier"
                  checked={localIgnoreCarrier}
                  onCheckedChange={setLocalIgnoreCarrier}
                  disabled={rowsDisabled}
                />
              </div>
            </div>
          </div>

          {/* A failure that is about the card rather than about one group: a
              transport error, a refused `enabled` flag, or the dnsmasq --test
              transcript that arrives with no field at all. */}
          {cardError ? (
            <div className={ERROR_BOX} role="alert">
              <span className={ERROR_TEXT}>{cardError}</span>
            </div>
          ) : null}

          <div className={CARD_FOOT.ROOT}>
            <div className={CARD_FOOT.ACTIONS}>
              {/* `blockedReason`, never `disabled`. A disabled button cannot be
                  focused and receives no pointer events, so the reason it is
                  blocked would be unreachable by exactly the people who need it —
                  and every reason this control can be blocked for is a sentence
                  worth reading before pressing anything. */}
              <SaveButton
                type="submit"
                isSaving={isSaving}
                saved={saved}
                label={t(`${K}.card.save`)}
                blockedReason={blockedReason}
                className={PILL_ACTION}
              />
              <Button
                type="button"
                variant="outline"
                className={PILL_ACTION}
                onClick={addRow}
                disabled={rowsDisabled || localServers.length >= MAX_RESOLVERS}
              >
                <PlusIcon className="size-4" />
                {t(`${K}.card.add`)}
              </Button>
            </div>

            <p className={PROVENANCE}>
              <span>
                {t(
                  blockCorrupt
                    ? `${K}.card.provenance_corrupt`
                    : `${K}.card.provenance`,
                  { used: usedCount, max: MAX_RESOLVERS },
                )}
              </span>
              <span className="font-mono">{DNSMASQ_CONF}</span>
            </p>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * The card's loading state.
 *
 * It is the REAL card, with the REAL row structure, holding placeholders — not a
 * stack of guessed heights. The retired skeleton promised a 68px panel and four
 * 36px boxes against a form that ships neither number, so the handoff jumped
 * every time it resolved. Geometry inherited by construction cannot drift from
 * the thing it is standing in for, which is the whole of the Skeleton-Mirror
 * Rule.
 *
 * The header and the description are the real strings rather than shimmering
 * bars: they are static copy, known before the device answers, and a bar in
 * their place would be pretending to wait for something.
 */
export function CustomDnsCardSkeleton() {
  const { t } = useTranslation("common");

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={CARD_PAD}>
        <CardTitle className={CARD_TITLE}>{t(`${K}.card.title`)}</CardTitle>
        <CardDescription>{t(`${K}.card.description`)}</CardDescription>
      </CardHeader>

      <CardContent className={cn(CARD_PAD, "flex flex-col gap-4")}>
        <div className={ROW_GROUP} aria-hidden="true">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className={ROW.ROOT}>
              <div className={ROW.TEXT}>
                <Skeleton className="h-4 w-44 rounded-pill" />
                <Skeleton className="h-3 w-full max-w-[26rem] rounded-pill" />
              </div>
              <div className={ROW.CONTROL}>
                <Skeleton className="h-[2.625rem] w-[11rem] rounded-pill" />
              </div>
            </div>
          ))}
        </div>

        <div className={CARD_FOOT.ROOT} aria-hidden="true">
          <div className={CARD_FOOT.ACTIONS}>
            <Skeleton className="h-[2.625rem] w-[9.5rem] rounded-pill" />
            <Skeleton className="h-[2.625rem] w-[8.5rem] rounded-pill" />
          </div>
          <Skeleton className="h-3 w-[18rem] max-w-full rounded-pill" />
        </div>
      </CardContent>
    </Card>
  );
}

export default CustomDnsCard;
