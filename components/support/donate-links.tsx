"use client";

import type * as React from "react";
import { HeartIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import {
  DONATE_ACTIONS,
  PILL_ACTION,
  PILL_GLYPH,
  PILL_PAYPAL,
  PILL_SPONSOR,
  PILL_WISE,
} from "./shapes";

const K = "donate";

// Addresses, not copy — none of these is translated.
const LINKS = {
  WISE: "https://wise.com/pay/business/blackcatdev?currency=USD",
  PAYPAL: "https://paypal.me/iamrusss",
  SPONSORS: "https://github.com/sponsors/dr-dolomite",
} as const;

/** lucide carries no brand marks, so these two stay local inline SVG. */
function WiseIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M13.553 0 9.3 13.401 6.235 4.136H0l5.696 15.728h7.209L24 0h-10.447z" />
      <path d="m13.856 19.864 2.974-8.216-3.558-2.302-4.206 10.518h4.79z" />
    </svg>
  );
}

function PayPalIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M7.076 21.337H2.47a.641.641 0 0 1-.633-.74L4.944.901C5.026.382 5.474 0 5.998 0h7.46c2.57 0 4.578.543 5.69 1.81 1.01 1.15 1.304 2.42 1.012 4.287-.023.143-.047.288-.077.437-.983 5.05-4.349 6.797-8.647 6.797h-2.19c-.524 0-.968.382-1.05.9l-1.12 7.106zm14.146-14.42a3.35 3.35 0 0 0-.607-.541c-.013.076-.026.175-.041.254-.93 4.778-4.005 7.201-9.138 7.201h-2.19a.563.563 0 0 0-.556.479l-1.187 7.527h-.506l-.24 1.516a.56.56 0 0 0 .554.647h3.882c.46 0 .85-.334.922-.788.06-.26.76-4.852.816-5.09a.932.932 0 0 1 .923-.788h.58c3.76 0 6.705-1.528 7.565-5.946.36-1.847.174-3.388-.777-4.471z" />
    </svg>
  );
}

/**
 * The three donation channels, rendered identically by the `/support` band and
 * by the Donate dialog, so the channels and their copy cannot drift.
 */
export function DonateLinks({
  className,
}: {
  className?: string;
}): React.JSX.Element {
  const { t } = useTranslation("common");
  const newTab = t(`${K}.links.opens_new_tab`);

  return (
    <div
      className={cn(DONATE_ACTIONS, className)}
      role="group"
      aria-label={t(`${K}.links.group_label`)}
    >
      <Button asChild className={cn(PILL_ACTION, PILL_WISE)}>
        <a href={LINKS.WISE} target="_blank" rel="noopener noreferrer">
          <WiseIcon className={PILL_GLYPH} />
          Wise
          <span className="sr-only">{newTab}</span>
        </a>
      </Button>

      <Button asChild className={cn(PILL_ACTION, PILL_PAYPAL)}>
        <a href={LINKS.PAYPAL} target="_blank" rel="noopener noreferrer">
          <PayPalIcon className={PILL_GLYPH} />
          PayPal
          <span className="sr-only">{newTab}</span>
        </a>
      </Button>

      <Button asChild className={cn(PILL_ACTION, PILL_SPONSOR)}>
        <a href={LINKS.SPONSORS} target="_blank" rel="noopener noreferrer">
          <HeartIcon className={cn(PILL_GLYPH, "fill-current")} />
          GitHub Sponsors
          <span className="sr-only">{newTab}</span>
        </a>
      </Button>
    </div>
  );
}

export default DonateLinks;
