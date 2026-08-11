import type { Metadata } from "next";
import "./globals.css";

import localFont from "next/font/local";
import { JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { MotionProvider } from "@/components/motion-provider";
import { MotionPreferenceProvider } from "@/components/motion-preference";
import { MOTION_BOOT_SCRIPT } from "@/lib/motion-preference";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import { Toaster } from "@/components/ui/sonner";

// Machine-voice mono font — bound to --font-jetbrains-mono, which globals.css
// maps to --font-mono (font-mono utility). Self-hosted at build time.
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
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
const materialSymbols = localFont({
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

// Interface font — a true variable font (wght 400-800), so one file per style
// covers every weight the app uses instead of a static cut per weight.
const rethinkSans = localFont({
  variable: "--font-rethink-sans",
  src: [
    {
      path: "./fonts/RethinkSans-Variable.woff2",
      weight: "400 800",
      style: "normal",
    },
    {
      path: "./fonts/RethinkSans-Italic-Variable.woff2",
      weight: "400 800",
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
        className={`${rethinkSans.variable} ${jetbrainsMono.variable} ${materialSymbols.variable} ${rethinkSans.className} antialiased`}
      >
        {/* Render-blocking: stamps data-motion on <html> from localStorage
            BEFORE anything paints, the same way next-themes avoids a theme
            flash. Without it a user on "Reduced" would see exactly one frame of
            the entrance animations they asked to suppress. <html> already
            carries suppressHydrationWarning for the theme script's sake. */}
        <script
          dangerouslySetInnerHTML={{ __html: MOTION_BOOT_SCRIPT }}
        />
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {/* Owns the System/Full/Reduced choice. Must sit OUTSIDE
              MotionProvider, which reads it to pick MotionConfig's
              `reducedMotion` value. */}
          <MotionPreferenceProvider>
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
          </MotionPreferenceProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
