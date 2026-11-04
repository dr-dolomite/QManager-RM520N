"use client";

import * as React from "react";
import { RefreshCwIcon } from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import DonateDialog from "@/components/donate-dialog";
import { RevealLabelButton } from "@/components/ui/reveal-label-button";
import { useAboutDevice } from "@/hooks/use-about-device";
import { staggerContainer, staggerItem } from "@/lib/motion";

import AddressesCard from "./addresses-card";
import CreditsDialog from "./credits-dialog";
import IdentityBand from "./identity-band";
import ModemCard from "./modem-card";
import QManagerBand from "./qmanager-band";
import { aboutView } from "./derive";
import { CARD_GRID, PAGE_HEAD, PAGE_ROOT } from "./shapes";

const K = "aboutDevice";

/**
 * The surface's ONE cascade root, and the one place the page's condition is
 * derived. Every child reads `view`; none re-derives it from a payload's shape.
 */
const AboutDeviceComponent = () => {
  const { t } = useTranslation("common");
  const { data, isLoading, isRefreshing, error, refresh } = useAboutDevice();
  const [donateOpen, setDonateOpen] = React.useState(false);
  const [creditsOpen, setCreditsOpen] = React.useState(false);

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
          <RevealLabelButton
            icon={RefreshCwIcon}
            label={busy ? t(`${K}.actions.refreshing`) : t(`${K}.actions.refresh`)}
            onClick={refresh}
            disabled={busy}
            spinning={busy}
          />
        </div>
      </motion.header>

      <IdentityBand view={view} data={data} error={error} onRetry={refresh} />

      <motion.div className={CARD_GRID} variants={staggerContainer}>
        <ModemCard view={view} data={data} />
        <AddressesCard view={view} data={data} />
      </motion.div>

      <QManagerBand
        onSupport={() => setDonateOpen(true)}
        onCredits={() => setCreditsOpen(true)}
      />

      <DonateDialog open={donateOpen} onOpenChange={setDonateOpen} />
      <CreditsDialog open={creditsOpen} onOpenChange={setCreditsOpen} />
    </motion.div>
  );
};

export default AboutDeviceComponent;
