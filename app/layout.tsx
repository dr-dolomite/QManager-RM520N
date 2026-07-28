import type { Metadata } from "next";
import "./globals.css";

import Euclid from "next/font/local";
import { Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { MotionProvider } from "@/components/motion-provider";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import { Toaster } from "@/components/ui/sonner";

// Machine-voice mono font — bound to --font-geist-mono, which globals.css
// maps to --font-mono (font-mono utility). Self-hosted at build time.
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Icon typeface for the sidebar and the dashboard route (DESIGN.md > Icons:
// the Icon-Boundary Rule; every other route stays on lucide). Self-hosted and
// subset at build time to the 53 glyphs those two surfaces render — 19.3 KB
// instead of the family's 3.4 MB.
// The modem serves this app and may have no internet, so a CDN <link> would
// render every nav item as the literal ligature text ("cell_tower") in the
// field. Regenerate with `bun run icons:subset` when the glyph set changes,
// and remember the union and the generator's list are hand-synced
// (docs/reference/icon-system.md).
//
// display: "block" (not "swap") for the same reason: during the brief load
// window an icon font must render nothing rather than its ligature source text.
const materialSymbols = Euclid({
  variable: "--font-material-symbols",
  display: "block",
  src: [
    {
      path: "./fonts/MaterialSymbolsRounded-subset.woff2",
      weight: "400",
      style: "normal",
    },
  ],
});

// Font files can be colocated inside of `app`
const euclid = Euclid({
  variable: "--font-euclid",
  src: [
    {
      path: "./fonts/EuclidCircularB-Light.woff2",
      weight: "300",
      style: "normal",
    },
    {
      path: "./fonts/EuclidCircularB-Regular.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "./fonts/EuclidCircularB-Medium.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "./fonts/EuclidCircularB-SemiBold.woff2",
      weight: "600",
      style: "normal",
    },
    {
      path: "./fonts/EuclidCircularB-Bold.woff2",
      weight: "700",
      style: "normal",
    },
    {
      path: "./fonts/EuclidCircularB-Italic.woff2",
      weight: "400",
      style: "italic",
    },
  ],
});

export const metadata: Metadata = {
  title: "QManager",
  description:
    "QManager is a modern web-based GUI for managing Quectel modems — from APN and band locking to advanced diagnostics and cellular device management.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${euclid.variable} ${geistMono.variable} ${materialSymbols.variable} ${euclid.className} antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <MotionProvider>
            {/* Client-only i18next provider — wraps BOTH the pre-auth (login /
                setup) shell and the authenticated app so every surface can call
                t(). Nested under MotionProvider because the root layout is a
                server component and the provider is "use client". */}
            <I18nProvider>
              {children}
              <Toaster />
            </I18nProvider>
          </MotionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
