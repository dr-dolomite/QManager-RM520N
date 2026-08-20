"use client";

import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { useSmsForwarding } from "@/hooks/use-sms-forwarding";
import { staggerContainer, staggerItem } from "@/lib/motion";
import {
  CARD_CELL,
  CARD_GRID,
  PAGE_DESCRIPTION,
  PAGE_SHELL,
  PAGE_TITLE,
} from "../shapes";
import SmsForwardingCard from "./sms-forwarding-card";
import DeliveryHealthCard from "./delivery-health-card";

// =============================================================================
// Forwarding Center — the page shell for /cellular/sms/forwarding
// =============================================================================
// The hook is lifted here so both cards read one source of truth and share a
// single fetch/poll loop: the left card CONTROLS the relay, the right card
// REPORTS on it (live state, preview, test, delivery failures). Two hook calls
// would mean two 20s polls landing at different instants, and a saved change
// showing on one card a cycle before the other.
//
// Layout is the standard feature-page shape — display title, muted description,
// uniform card grid — per the Consistent-Layout Rule, and every string of it
// comes from `../shapes`. The grid used to be exported by one of the two cards
// it lays out; a card is not the page's geometry source. It is a container query
// against `@container/main`, never a viewport breakpoint: the sidebar can expand
// and collapse underneath it, and a `md:` breakpoint would put two cards side by
// side in a column that no longer has room for them.
//
// NO `aria-live` ON THIS ROOT. It used to carry `aria-live="polite"` over the
// whole page, and `useSmsForwarding` re-fetches every 20s building a fresh data
// object each time — so both card subtrees re-render and a screen reader is
// handed an announcement loop with no end. It also contradicted the product's
// stated announcement channel: `save-button.tsx` records that the save result is
// announced by the sonner toast every caller already fires, and "an `aria-live`
// here would double-announce". The states that genuinely need announcing already
// declare it locally — `ConditionScreen` takes `ariaRole="alert"`, the failure
// notice is `role="alert"`, the loading branches carry `sr-only` strings, and
// the health block scopes its own `role="status"`.
// =============================================================================

const ForwardingCenterComponent = () => {
  const { t } = useTranslation("cellular");
  const fwd = useSmsForwarding();

  return (
    <motion.div
      className={PAGE_SHELL}
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
    >
      <motion.div variants={staggerItem}>
        <div className="flex max-w-[41rem] flex-col gap-1.5">
          <h1 className={PAGE_TITLE}>{t("sms.forwarding.page.title")}</h1>
          <p className={PAGE_DESCRIPTION}>
            {t("sms.forwarding.page.description")}
          </p>
        </div>
      </motion.div>

      <motion.div className={CARD_GRID} variants={staggerContainer}>
        {/* `CARD_CELL` pins both cards to the row height rather than letting
            each size to its own content — otherwise the control card, which is
            the shorter of the two, is visibly stubby beside a health card
            carrying five failure rows. */}
        <motion.div variants={staggerItem} className={CARD_CELL}>
          <SmsForwardingCard fwd={fwd} />
        </motion.div>
        <motion.div variants={staggerItem} className={CARD_CELL}>
          <DeliveryHealthCard fwd={fwd} />
        </motion.div>
      </motion.div>
    </motion.div>
  );
};

export default ForwardingCenterComponent;
