"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { MaterialSymbol } from "@/components/ui/material-symbol";
import { Button } from "@/components/ui/button";
import { staggerContainer, staggerItem } from "@/lib/motion";

import { useSms } from "@/hooks/use-sms";
import { useSmsReadState, parseSmsTimestamp } from "@/hooks/use-sms-read-state";

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

const PILL_ACTION = "h-[2.625rem] gap-2 rounded-pill px-5 text-sm font-semibold";

const SmsCenterComponent = () => {
  const { t } = useTranslation("cellular");
  const {
    data,
    lastSuccessfulFetch,
    isLoading,
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
    <motion.div
      className="@container/main mx-auto flex flex-col gap-5 p-2"
      aria-live="polite"
      aria-atomic="false"
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
    >
      {/* Cascade children must be block boxes — a bare span silently drops the
          10px rise. */}
      <motion.div variants={staggerItem}>
        <div className="flex flex-col gap-5 @3xl/main:flex-row @3xl/main:items-end">
          <div className="flex max-w-[41rem] flex-col gap-1.5">
            {/* Display step: 30px / 700. The mock's 32px/600 title and 15px
                description are not ramp steps — 15px is banner-scoped, and the
                denser pre-auth scale is scoped to `/` and `/login/`. */}
            <h1 className="text-3xl font-bold tracking-[-0.02em]">
              {t("sms.page.title")}
            </h1>
            <p className="text-on-surface-variant text-sm leading-relaxed text-pretty">
              {t("sms.page.description")}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 @3xl/main:ml-auto">
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
          </div>
        </div>
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
            error={error}
            lastSuccessfulFetch={lastSuccessfulFetch}
            isRead={isRead}
            markRead={markRead}
            markAllRead={markAllRead}
            unreadCount={unreadCount}
            onDelete={deleteSms}
            onRefresh={() => refresh()}
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
