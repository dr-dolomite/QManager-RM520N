"use client";

import React from "react";
import { useTranslation } from "react-i18next";
import { motion, useReducedMotion } from "motion/react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { UserRoundPenIcon, RefreshCcwIcon } from "lucide-react";

interface EmptyProfileViewProps {
  onRefresh?: () => void;
}

const EmptyProfileViewComponent = ({ onRefresh }: EmptyProfileViewProps) => {
  const { t } = useTranslation("cellular");
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduceMotion ? { duration: 0 } : { duration: 0.3, ease: "easeOut" }}
      className="h-full"
    >
      <Card className="@container/card h-full">
        <CardHeader>
          <CardTitle>{t("custom_profiles.empty_state.card_title")}</CardTitle>
          <CardDescription>
            {t("custom_profiles.empty_state.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex h-full items-center justify-center">
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <UserRoundPenIcon />
              </EmptyMedia>
              <EmptyTitle>
                {t("custom_profiles.empty_state.title")}
              </EmptyTitle>
              <EmptyDescription>
                {t("custom_profiles.empty_state.description_full")}
              </EmptyDescription>
            </EmptyHeader>
            {onRefresh && (
              <EmptyContent>
                <Button variant="outline" size="sm" onClick={onRefresh}>
                  <RefreshCcwIcon className="size-4" />
                  {t("custom_profiles.empty_state.refresh")}
                </Button>
              </EmptyContent>
            )}
          </Empty>
        </CardContent>
      </Card>
    </motion.div>
  );
};

export default EmptyProfileViewComponent;
