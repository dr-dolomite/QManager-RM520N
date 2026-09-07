"use client";

import * as React from "react";
import { RefreshCwIcon } from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import DonateDialog from "@/components/donate-dialog";
import { Button } from "@/components/ui/button";
import { useAboutDevice } from "@/hooks/use-about-device";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";

import AddressesCard from "./addresses-card";
import IdentityBand from "./identity-band";
import ModemCard from "./modem-card";
import QManagerBand from "./qmanager-band";
import { aboutView } from "./derive";
import {
  CARD_GRID,
  PAGE_HEAD,
  PAGE_ROOT,
  PILL_ACTION,
  PILL_GLYPH,
  SPIN,
} from "./shapes";

const K = "aboutDevice";

/**
 * The surface's ONE cascade root, and the one place the page's condition is
 * derived. Every child reads `view`; none re-derives it from a payload's shape.
 */
const AboutDeviceComponent = () => {
  const { t } = useTranslation("common");
  const { data, isLoading, isRefreshing, error, refresh } = useAboutDevice();
  const [donateOpen, setDonateOpen] = React.useState(false);

  const view = aboutView({ data, isLoading, error });
  const busy = isLoading || isRefreshing;

  return (
    <motion.div
      className={PAGE_ROOT}
      initial="hidden"
      animate="visible"
      variants={staggerContainer}
    >
      <motion.header variants={staggerItem} className={PAGE_HEAD.ROOT}>
        <div className={PAGE_HEAD.TITLES}>
          <h1 className={PAGE_HEAD.TITLE}>{t(`${K}.page.title`)}</h1>
          <p className={PAGE_HEAD.DESC}>{t(`${K}.page.description`)}</p>
        </div>
        <div className={PAGE_HEAD.ACTIONS}>
          <Button
            type="button"
            variant="outline"
            className={PILL_ACTION}
            onClick={refresh}
            disabled={busy}
          >
            <RefreshCwIcon
              className={cn(PILL_GLYPH, busy && SPIN)}
              aria-hidden="true"
            />
            {busy ? t(`${K}.actions.refreshing`) : t(`${K}.actions.refresh`)}
          </Button>
        </div>
      </motion.header>

      <IdentityBand view={view} data={data} error={error} onRetry={refresh} />

      <motion.div className={CARD_GRID} variants={staggerContainer}>
        <ModemCard view={view} data={data} />
        <AddressesCard view={view} data={data} />
      </motion.div>

      <QManagerBand onSupport={() => setDonateOpen(true)} />

      <DonateDialog open={donateOpen} onOpenChange={setDonateOpen} />
    </motion.div>
  );
};

export default AboutDeviceComponent;
