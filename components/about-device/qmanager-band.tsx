"use client";

import type * as React from "react";
import Image from "next/image";
import { ExternalLinkIcon, FileTextIcon, HeartIcon } from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import { staggerItem } from "@/lib/motion";
import packageJson from "@/package.json";
import QManagerMark from "@/public/qmanager-mark.svg";

import { PILL_ACTION, PILL_GLYPH, WIDE } from "./shapes";

const K = "aboutDevice";

const REPO_URL = "https://github.com/dr-dolomite/QManager-RM520N";
const RELEASES_URL = `${REPO_URL}/releases`;

/** Not a key: the licence name is a legal identifier, identical in every locale. */
const LICENSE = "MIT + Commons Clause";

/** lucide carries no brand marks, so the GitHub mark stays local inline SVG. */
function GitHubIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 0-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.4-6 0-1.2.4-2.3 1.1-3.1-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.7.2 2.9.1 3.2.7.8 1.1 1.9 1.1 3.1 0 4.7-2.8 5.7-5.5 6 .5.4.9 1.1.9 2.2v3.3c0 .3.1.7.8.6A12 12 0 0 0 12 .3" />
    </svg>
  );
}

export interface QManagerBandProps {
  onSupport: () => void;
}

/**
 * The page's closing statement: what this software is, who made it, and the
 * three things a reader might want next. Full width because it is prose rather
 * than a pair of readings.
 */
export function QManagerBand({
  onSupport,
}: QManagerBandProps): React.JSX.Element {
  const { t } = useTranslation("common");

  return (
    <motion.section variants={staggerItem} className={WIDE.ROOT}>
      <div className={WIDE.INNER}>
        <div className={WIDE.MARK_DISC}>
          <Image
            src={QManagerMark}
            alt=""
            aria-hidden="true"
            className={WIDE.MARK}
            priority
          />
        </div>

        <div className={WIDE.TEXT}>
          <div className={WIDE.TITLE_ROW}>
            <h3 className={WIDE.TITLE}>{t(`${K}.qmanager.title`)}</h3>
            <Tag variant="neutral">{packageJson.version}</Tag>
            <Tag variant="neutral">{LICENSE}</Tag>
          </div>

          <p className={WIDE.BODY}>{t(`${K}.qmanager.note`)}</p>
          <p className={WIDE.LEGAL}>
            {t(`${K}.qmanager.copyright`, { year: new Date().getFullYear() })}
          </p>

          <div className={WIDE.ACTIONS}>
            <Button asChild variant="tonal" className={PILL_ACTION}>
              <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
                <GitHubIcon className={PILL_GLYPH} />
                {t(`${K}.qmanager.repository`)}
                <ExternalLinkIcon
                  className={WIDE.EXT_GLYPH}
                  aria-hidden="true"
                />
              </a>
            </Button>

            <Button asChild variant="outline" className={PILL_ACTION}>
              <a href={RELEASES_URL} target="_blank" rel="noopener noreferrer">
                <FileTextIcon className={PILL_GLYPH} aria-hidden="true" />
                {t(`${K}.qmanager.release_notes`)}
                <ExternalLinkIcon
                  className={WIDE.EXT_GLYPH}
                  aria-hidden="true"
                />
              </a>
            </Button>

            <Button
              type="button"
              variant="outline"
              className={PILL_ACTION}
              onClick={onSupport}
            >
              <HeartIcon
                className={PILL_GLYPH}
                fill="currentColor"
                aria-hidden="true"
              />
              {t(`${K}.qmanager.support`)}
            </Button>
          </div>
        </div>
      </div>
    </motion.section>
  );
}

export default QManagerBand;
