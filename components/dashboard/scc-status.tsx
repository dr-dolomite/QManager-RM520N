"use client";

import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { FaCircle } from "react-icons/fa6";
import type { CarrierComponent } from "@/types/modem-status";
import { RSRP_THRESHOLDS, getSignalQuality } from "@/types/modem-status";
import {
  listVariants,
  rowVariants,
  getValueColorClass,
} from "./signal-card-utils";

interface SccStatusProps {
  carriers: CarrierComponent[];
}

const SccStatusComponent = ({ carriers }: SccStatusProps) => {
  const { t } = useTranslation("dashboard");
  const sccCarriers = carriers.filter((c) => c.type === "SCC");
  const totalBw = sccCarriers.reduce(
    (sum, c) => sum + (c.bandwidth_mhz || 0),
    0,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-semibold">
          {t("scc.title")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4">
          {/* Summary — mirrors SignalStatusCard's signal strength header */}
          <div className="flex items-center justify-between">
            <div className="grid gap-0.5">
              <h3 className="text-sm font-semibold">{t("scc.heading")}</h3>
              <div className="flex items-center gap-x-1">
                <FaCircle
                  className="w-2 h-2 text-success"
                  aria-hidden
                />
                <p className="text-muted-foreground text-xs">
                  {t("scc.active_carriers", { count: sccCarriers.length })}
                </p>
              </div>
            </div>
            <Badge
              variant="outline"
              className="bg-info/15 text-info hover:bg-info/20 border-info/30 tabular-nums"
            >
              +{totalBw} MHz
            </Badge>
          </div>

          {/* Carrier rows — dl/dt/dd semantics matching SignalStatusCard */}
          <motion.dl
            className="grid divide-y divide-border border-y border-border"
            variants={listVariants}
            initial="hidden"
            animate="visible"
          >
            {sccCarriers.map((carrier, index) => {
              const quality = getSignalQuality(carrier.rsrp, RSRP_THRESHOLDS);
              const rsrpColor = getValueColorClass(quality);

              return (
                <motion.div
                  key={`${carrier.band}-${carrier.pci}-${index}`}
                  variants={rowVariants}
                  transition={{ duration: 0.25, ease: "easeOut" }}
                  className="flex items-center justify-between py-2"
                >
                  <dt className="flex items-center gap-2">
                    <span className="font-semibold text-sm">
                      {carrier.band}
                    </span>
                    <span className="text-muted-foreground text-sm tabular-nums">
                      ({carrier.pci ?? "-"})
                    </span>
                  </dt>
                  <dd className={cn("font-semibold text-sm tabular-nums", rsrpColor)}>
                    {carrier.rsrp != null ? `${carrier.rsrp} dBm` : "-"}
                  </dd>
                </motion.div>
              );
            })}
          </motion.dl>
        </div>
      </CardContent>
    </Card>
  );
};

export default SccStatusComponent;
