"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { MaterialSymbol } from "@/components/ui/material-symbol";
import { Button } from "@/components/ui/button";
import { CellularPageHeader } from "@/components/cellular/page-header";
import { staggerContainer, staggerItem } from "@/lib/motion";

import { useSms } from "@/hooks/use-sms";
import { useSmsReadState, parseSmsTimestamp } from "@/hooks/use-sms-read-state";

import { PAGE_SHELL, PILL_ACTION } from "./shapes";
import SmsInboxCard from "./inbox-card";
import SmsComposeDialog from "./sms-compose-dialog";
import { SmsSummaryTiles } from "./summary-tiles";
import { InboxLoadingState, SmsTilesSkeleton } from "./states";

// =============================================================================
// SMS Center — page shell
// =============================================================================
// Page header, the three-tile strip, then the Inbox card. One cascade owns the
// page, so the beats land where the mock's hardcoded 0/60/120ms delays put them
// — those ARE the 60ms card step — without restating a single duration.
//
// TWO THINGS FROM THE MOCK ARE DELIBERATELY NOT BUILT.
//
// The "Polling inbox" pill: it lives inside the mock's fake browser chrome, and
// `use-sms.ts` does not poll. Nor should it — one inbox GET takes the shared AT
// lock SIX times and returned 13 KB on the live device, so a poll here would
// contend with the status poller and the watchdog for the same lock. Claiming a
// poll that does not run also breaks the State-Honesty Rule.
//
// The "Motion on this page" card: comp documentation, not product.
// =============================================================================

const SmsCenterComponent = () => {
  const { t } = useTranslation("cellular");
  const {
    data,
    lastSuccessfulFetch,
    isLoading,
    isFetching,
    isSaving,
    error,
    sendSms,
    deleteSms,
    refresh,
  } = useSms();

  const [composeOpen, setComposeOpen] = React.useState(false);
  const [composePhone, setComposePhone] = React.useState("");

  // Newest-first regardless of backend ordering. The modem's
  // "MM/DD/YY HH:MM:SS" stamp is parsed to epoch ms by `parseSmsTimestamp`,
  // which returns 0 on a malformed value so a bad stamp sorts last rather than
  // throwing. Sorting lives here, above the read-state hook, so the hook always
  // sees one stable order.
  const sortedMessages = React.useMemo(
    () =>
      [...(data?.messages ?? [])].sort(
        (a, b) =>
          parseSmsTimestamp(b.timestamp) - parseSmsTimestamp(a.timestamp),
      ),
    [data?.messages],
  );

  const { isRead, markRead, markAllRead, unreadCount } =
    useSmsReadState(sortedMessages);

  const openCompose = React.useCallback((phone?: string) => {
    setComposePhone(phone ?? "");
    setComposeOpen(true);
  }, []);

  return (
    // NO `aria-live` ON THE PAGE ROOT. It used to sit here, which made a live
    // region of the ENTIRE surface: every filter change, every pagination click
    // and every re-render was announced, in full, to a screen reader. A live
    // region has to be the smallest thing that actually changed. The two things
    // that genuinely need announcing already announce on their own: the
    // delete-progress list carries `aria-live="polite"`, and the read-failure
    // banner that raises the staleness chip carries `role="alert"`. So the root
    // carries none.
    <motion.div
      className={PAGE_SHELL}
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
    >
      {/* Cascade children must be block boxes — a bare span silently drops the
          10px rise. */}
      <motion.div variants={staggerItem}>
        {/* The shared primitive, not a copy of it. This page hand-rolled a
            byte-identical duplicate of `CellularPageHeader`'s internals and was
            the only one of twelve `/cellular/` families not using it — including
            missing the `min-w-0` the primitive carries, which is what stops a
            long Italian title from pushing the actions off the row. */}
        <CellularPageHeader
          title={t("sms.page.title")}
          description={t("sms.page.description")}
          actions={
            <>
              {/* `Link`, never an `<a>` — an anchor here would full-reload the
                  static export and drop every bit of client state. */}
              <Button asChild variant="tonal" className={PILL_ACTION}>
                <Link href="/cellular/sms/forwarding">
                  <MaterialSymbol name="send" size={18} />
                  {t("sms.page.forwarding")}
                </Link>
              </Button>
              <Button
                type="button"
                onClick={() => openCompose()}
                className={PILL_ACTION}
              >
                <MaterialSymbol name="edit" size={18} />
                {t("sms.inbox.buttons.new_message")}
              </Button>
            </>
          }
        />
      </motion.div>

      <motion.div variants={staggerItem}>
        {isLoading ? (
          <SmsTilesSkeleton label={t("sms.tiles.loading_sr")} />
        ) : (
          <SmsSummaryTiles
            unreadCount={unreadCount}
            totalCount={sortedMessages.length}
            newestTimestamp={sortedMessages[0]?.timestamp ?? null}
            storage={data?.storage}
          />
        )}
      </motion.div>

      <motion.div variants={staggerItem}>
        {isLoading ? (
          <InboxLoadingState />
        ) : (
          <SmsInboxCard
            messages={sortedMessages}
            storage={data?.storage}
            isSaving={isSaving}
            isFetching={isFetching}
            error={error}
            lastSuccessfulFetch={lastSuccessfulFetch}
            isRead={isRead}
            markRead={markRead}
            markAllRead={markAllRead}
            unreadCount={unreadCount}
            onDelete={deleteSms}
            // SILENT. `refresh()` defaults to a NON-silent fetch, which raises
            // `isLoading`, which flips the ternary below and UNMOUNTS this card
            // for the duration — wiping the tab, the search text, the sort
            // direction, the row selection and the pagination page. Pressing
            // Refresh therefore destroyed exactly the state the surface's own
            // freeze-while-stale invariant exists to preserve. The in-flight
            // state now shows on the button itself instead.
            onRefresh={() => refresh(true)}
            onCompose={openCompose}
          />
        )}
      </motion.div>

      <SmsComposeDialog
        open={composeOpen}
        onOpenChange={setComposeOpen}
        onSend={sendSms}
        isSaving={isSaving}
        initialPhone={composePhone}
      />
    </motion.div>
  );
};

export default SmsCenterComponent;
