"use client";

import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { useSmsForwarding } from "@/hooks/use-sms-forwarding";
import { staggerContainer, staggerItem } from "@/lib/motion";
import SmsForwardingCard, {
  CARD_CELL,
  CARD_GRID,
} from "./sms-forwarding-card";
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
// uniform card grid — per the Consistent-Layout Rule. The grid is a container
// query against `@container/main`, not a viewport breakpoint: the sidebar can
// expand and collapse underneath it, and a `md:` breakpoint would put two cards
// side by side in a column that no longer has room for them.
// =============================================================================

const ForwardingCenterComponent = () => {
  const { t } = useTranslation("cellular");
  const fwd = useSmsForwarding();

  return (
    <motion.div
      className="@container/main mx-auto flex flex-col gap-5 p-2"
      aria-live="polite"
      aria-atomic="false"
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
    >
      <motion.div variants={staggerItem}>
        <div className="flex max-w-[41rem] flex-col gap-1.5">
          <h1 className="text-3xl font-bold tracking-[-0.02em]">
            {t("sms.forwarding.page.title")}
          </h1>
          <p className="text-on-surface-variant text-sm leading-relaxed text-pretty">
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
