"use client";

import type * as React from "react";
import Image from "next/image";
import { BugIcon, ExternalLinkIcon, FileTextIcon, HeartIcon, MailIcon } from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { APP_VERSION } from "@/lib/i18n/app-version";
import { staggerContainer, staggerItem, staggerRowItem, staggerRows } from "@/lib/motion";
import { cn } from "@/lib/utils";

import DonateLinks from "./donate-links";
import {
  ACTION_LIST,
  ACTION_ROW,
  BAND,
  CARD_BODY,
  CARD_CELL,
  CARD_DESC,
  CARD_GRID,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  COMMUNITY,
  FOCUS_RING,
  PAGE_HEAD,
  PAGE_ROOT,
  PILL_ACTION,
  PILL_GLYPH,
} from "./shapes";

const K = "support";
const D = "donate";

// Addresses, not copy — none of these is translated. The repo slug mirrors
// system/update.sh's own GITHUB_REPO, which is the build this device ships from.
const GITHUB_REPO = "dr-dolomite/QManager-RM520N";

const LINKS = {
  ISSUES: `https://github.com/${GITHUB_REPO}/issues`,
  ISSUES_LABEL: `github.com/${GITHUB_REPO}/issues`,
  RELEASES: `https://github.com/${GITHUB_REPO}/releases`,
  DISCORD: "https://discord.iamromulan.dev/",
  /** The server's own name — a proper noun, so it is never translated. */
  DISCORD_NAME: "Cellular Modem Talk/Development",
  EMAIL: "russel.yasol@gmail.com",
} as const;

/** lucide carries no brand marks, so Discord stays local inline SVG. */
function DiscordIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.947 2.418-2.157 2.418z" />
    </svg>
  );
}

interface ActionRowProps {
  href: string;
  icon: React.ReactNode;
  label: string;
  /** The destination, shown under the label so the row says where it goes. */
  dest: string;
  /** True when the destination is an address the machine emits verbatim. */
  mono?: boolean;
  /** A mailto: opens a client rather than a tab, so it carries no glyph. */
  external?: boolean;
  newTabLabel: string;
}

/** One 64px row where the whole row is the link, not the address text inside it. */
function ActionRow({
  href,
  icon,
  label,
  dest,
  mono = false,
  external = true,
  newTabLabel,
}: ActionRowProps): React.JSX.Element {
  return (
    <motion.a
      variants={staggerRowItem}
      href={href}
      {...(external
        ? { target: "_blank", rel: "noopener noreferrer" }
        : undefined)}
      className={cn(ACTION_ROW.ROOT, FOCUS_RING)}
    >
      <span className={ACTION_ROW.DISC} aria-hidden="true">
        {icon}
      </span>
      <span className={ACTION_ROW.TEXT}>
        <span className={ACTION_ROW.LABEL}>{label}</span>
        <span
          className={mono ? ACTION_ROW.DEST_MONO : ACTION_ROW.DEST}
          title={dest}
        >
          {dest}
        </span>
      </span>
      {external ? (
        <>
          <ExternalLinkIcon className={ACTION_ROW.EXT} aria-hidden="true" />
          <span className="sr-only">{newTabLabel}</span>
        </>
      ) : null}
    </motion.a>
  );
}

/**
 * `/support` — where to get help, where the community is, and one place to give
 * back. Static, so the page has no loading, empty or error state.
 */
export function SupportComponent(): React.JSX.Element {
  const { t } = useTranslation("common");
  const newTab = t(`${K}.opens_new_tab`);

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
      </motion.header>

      <div className={CARD_GRID}>
        <motion.div variants={staggerItem} className={CARD_CELL}>
          <Card className={CARD_SHELL}>
            <CardHeader className={CARD_PAD}>
              <CardTitle className={CARD_TITLE}>
                {t(`${K}.help.title`)}
              </CardTitle>
              <CardDescription className={CARD_DESC}>
                {t(`${K}.help.description`)}
              </CardDescription>
            </CardHeader>
            <CardContent className={cn(CARD_PAD, CARD_BODY)}>
              <motion.div variants={staggerRows} className={ACTION_LIST}>
                <ActionRow
                  href={LINKS.ISSUES}
                  icon={<BugIcon className={ACTION_ROW.GLYPH} />}
                  label={t(`${K}.help.bug.label`)}
                  dest={LINKS.ISSUES_LABEL}
                  mono
                  newTabLabel={newTab}
                />
                <ActionRow
                  href={LINKS.DISCORD}
                  icon={<DiscordIcon className={ACTION_ROW.GLYPH} />}
                  label={t(`${K}.help.community.label`)}
                  dest={LINKS.DISCORD_NAME}
                  newTabLabel={newTab}
                />
                <ActionRow
                  href={`mailto:${LINKS.EMAIL}`}
                  icon={<MailIcon className={ACTION_ROW.GLYPH} />}
                  label={t(`${K}.help.email.label`)}
                  dest={LINKS.EMAIL}
                  mono
                  external={false}
                  newTabLabel={newTab}
                />
                <ActionRow
                  href={LINKS.RELEASES}
                  icon={<FileTextIcon className={ACTION_ROW.GLYPH} />}
                  label={t(`${K}.help.release_notes.label`)}
                  dest={t(`${K}.help.release_notes.dest`, {
                    version: APP_VERSION,
                  })}
                  newTabLabel={newTab}
                />
              </motion.div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={staggerItem} className={CARD_CELL}>
          <Card className={CARD_SHELL}>
            <CardHeader className={CARD_PAD}>
              <CardTitle className={CARD_TITLE}>
                {t(`${K}.community.title`)}
              </CardTitle>
              <CardDescription className={CARD_DESC}>
                {t(`${K}.community.description`)}
              </CardDescription>
            </CardHeader>
            <CardContent className={cn(CARD_PAD, CARD_BODY)}>
              <div className={COMMUNITY.BODY}>
                <p className={COMMUNITY.COPY}>{t(`${K}.community.body`)}</p>
                <div className={COMMUNITY.PLATE}>
                  <Image
                    src="/discord-qr.svg"
                    alt={t(`${K}.community.qr_alt`)}
                    width={160}
                    height={160}
                    className={COMMUNITY.IMAGE}
                  />
                </div>
                <Button asChild variant="tonal" className={PILL_ACTION}>
                  <a
                    href={LINKS.DISCORD}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <DiscordIcon className={PILL_GLYPH} />
                    {t(`${K}.community.open_invite`)}
                    <span className="sr-only">{newTab}</span>
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <motion.section variants={staggerItem} className={BAND.ROOT}>
        <div className={BAND.INNER}>
          <div className={BAND.DISC} aria-hidden="true">
            <HeartIcon className={cn(BAND.DISC_GLYPH, "fill-current")} />
          </div>
          <div className={BAND.TEXT}>
            <h3 className={BAND.TITLE}>{t(`${D}.band.title`)}</h3>
            <p className={BAND.BODY}>{t(`${D}.band.body`)}</p>
            <DonateLinks className="pt-0.5" />
          </div>
        </div>
      </motion.section>
    </motion.div>
  );
}

export default SupportComponent;
