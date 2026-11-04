"use client";

// 404: a pixel-art campfire card, always night. Its fire is the sanctioned
// decorative loop (`campfire-*` in globals.css) and stops under Reduced motion.

import { motion } from "motion/react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { TentIcon } from "lucide-react";
import { transitionStandard } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { BODY, CARD_TITLE } from "@/components/pre-auth-type";
import { CAMPFIRE_PALETTE as P, CampfireScene } from "@/components/not-found/campfire-scene";

const CAMPFIRE_VARS = {
  "--campfire-ground": P.ground,
  "--campfire-rim": P.rim,
  "--campfire-text": P.text,
  "--campfire-text-muted": P.textMuted,
  "--campfire-amber": P.amber,
  "--campfire-amber-hover": P.amberHover,
  "--campfire-amber-light": P.amberLight,
  "--campfire-amber-edge": P.amberEdge,
  "--campfire-amber-ink": P.amberInk,
} as React.CSSProperties;

export default function NotFound() {
  const { t } = useTranslation("common");

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-4 md:p-10">
      <motion.main
        className="w-full max-w-md"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={transitionStandard}
      >
        <div
          style={CAMPFIRE_VARS}
          className="overflow-hidden rounded-hero bg-(--campfire-ground) text-center shadow-[var(--shadow-whisper)] ring-1 ring-(--campfire-rim)"
        >
          <CampfireScene label={t("not_found.scene_label")} className="block h-auto w-full" />

          <div className="flex flex-col items-center gap-6 px-6 pt-1 pb-8 sm:px-8">
            <div className="flex flex-col gap-2">
              <h1 className={cn(CARD_TITLE, "text-balance text-(--campfire-text)")}>
                {t("not_found.title")}
              </h1>
              <p className={cn(BODY, "leading-relaxed text-balance text-(--campfire-text-muted)")}>
                {t("not_found.description")}
              </p>
            </div>

            <span className="campfire-button-frame">
              <Link href="/dashboard/" className="campfire-button">
                <TentIcon className="size-4" aria-hidden />
                {t("not_found.home")}
              </Link>
            </span>
          </div>
        </div>
      </motion.main>

      <div className="flex items-center gap-2">
        <img
          src="/qmanager-mark.svg"
          alt=""
          aria-hidden
          className="size-4 opacity-70"
        />
        <p className="text-xs text-muted-foreground">{t("not_found.footer")}</p>
      </div>
    </div>
  );
}
