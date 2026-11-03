"use client";

import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { ConditionScreen } from "@/components/cellular/condition-screen";
import { CellularPageHeader } from "@/components/cellular/page-header";
import { useSmsForwarding } from "@/hooks/use-sms-forwarding";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { CARD_CELL, CARD_GRID } from "./shapes";
import SmsForwardingCard from "./sms-forwarding-card";
import DeliveryHealthCard from "./delivery-health-card";

// =============================================================================
// ForwardingCenter — the page shell for /cellular/sms/forwarding
// =============================================================================
// A page header over a two-up grid: the left card CONTROLS the relay, the right
// card REPORTS on it (live state, preview, test, delivery failures). The grid is
// a container query against `@container/main`, never a viewport breakpoint — the
// sidebar can expand and collapse underneath it — and the page column is full
// width. Below the step the cards stack, control first.
//
// The hook is lifted here so both cards read one source of truth and share a
// single fetch/poll loop; two hook calls would land two 20 s polls at different
// instants and show a saved change on one card a cycle before the other. A
// failed first read replaces both cards with one condition screen rather than
// two copies of it.
// =============================================================================

const ForwardingCenterComponent = () => {
  const { t } = useTranslation("cellular");
  const fwd = useSmsForwarding();
  const readFailed = !fwd.isLoading && !fwd.data;

  return (
    <div className="@container/main mx-auto flex flex-col gap-5 p-2">
      <CellularPageHeader
        title={t("sms.forwarding.page.title")}
        description={t("sms.forwarding.page.description")}
      />

      {readFailed ? (
        <ConditionScreen
          tone="destructive"
          glyph="error"
          ariaRole="alert"
          title={t("sms.forwarding.sms.error_load")}
          description={fwd.error ?? t("sms.forwarding.errors.load_failed")}
          onRetry={() => fwd.refresh()}
          retryLabel={t("actions.retry", { ns: "common" })}
        />
      ) : (
        <motion.div
          className={CARD_GRID}
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
        >
          {/* `CARD_CELL` pins both cards to the row height rather than letting
              each size to its own content, so the control card (the shorter of
              the two) isn't stubby beside a health card carrying failure rows. */}
          <motion.div variants={staggerItem} className={CARD_CELL}>
            <SmsForwardingCard fwd={fwd} />
          </motion.div>
          <motion.div variants={staggerItem} className={CARD_CELL}>
            <DeliveryHealthCard fwd={fwd} />
          </motion.div>
        </motion.div>
      )}
    </div>
  );
};

export default ForwardingCenterComponent;
