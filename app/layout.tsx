import type { Metadata } from "next";
import "./globals.css";

import localFont from "next/font/local";
import { ThemeProvider } from "@/components/theme-provider";
import { MotionProvider } from "@/components/motion-provider";
import { MotionPreferenceProvider } from "@/components/motion-preference";
import { MOTION_BOOT_SCRIPT } from "@/lib/motion-preference";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import { Toaster } from "@/components/ui/sonner";

// Machine-voice mono font — bound to --font-jetbrains-mono, which globals.css
// maps to --font-mono (font-mono utility).
//
// VENDORED, NOT `next/font/google`. That loader self-hosts its OUTPUT but still
// makes a live request to fonts.googleapis.com on every cold build; on a slow
// link it times out and the production build dies. This app is built to be
// served BY the modem, often from a field machine on a poor connection, so a
// build-time dependency on a third-party CDN is the wrong shape. All faces here
// are local; the build touches no network.
//
// The file is Google's own latin cut of the variable font, byte-for-byte:
//   https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbV2o-flEEny0FZhsfKu5WU4xD7OwE.woff2
//   sha256 18be452724bfdc236c074ca94a249a7f41a86752c7d04ab258ce9ed5651f6a7e
// `weight: "100 800"` and the `unicode-range` below are copied from that same
// stylesheet, so the declaration the browser sees is unchanged — only where the
// bytes come from changed. Re-vendoring means re-fetching the `css2?family=
// JetBrains+Mono:wght@100..800` stylesheet and taking its `/* latin */` block.
const jetbrainsMono = localFont({
  variable: "--font-jetbrains-mono",
  display: "swap",
  src: [
    {
      path: "./fonts/JetBrainsMono-Variable.woff2",
      weight: "100 800",
      style: "normal",
    },
  ],
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
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
          {/* Owns the System/Full/Reduced choice; MotionProvider re-renders on it. */}
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
