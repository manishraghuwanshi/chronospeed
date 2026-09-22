import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter } from "next/font/google";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { SITE_DESCRIPTION, SITE_NAME, siteUrl } from "@/lib/site";

import "./globals.css";

/**
 * Root layout.
 *
 * Note (Next 16): `LayoutProps<"/">` is a globally-generated type produced by
 * `next typegen` / `next dev` / `next build` — it is not importable, and route
 * `params` are async. Do not hand-write the props type.
 */

const inter = Inter({
  variable: "--font-sans-ui",
  subsets: ["latin"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-mono-ui",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: `${SITE_NAME} — Precision watches`,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: `${SITE_NAME} — Precision watches`,
    description: SITE_DESCRIPTION,
    url: siteUrl,
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfaf7" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0d0f" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${plexMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        {/* Keyboard users must be able to skip the navigation on every page. */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-sm focus:bg-accent focus:px-3 focus:py-2 focus:text-sm focus:text-accent-foreground"
        >
          Skip to content
        </a>

        <SiteHeader />

        <main id="main-content" className="flex flex-1 flex-col">
          {children}
        </main>

        <SiteFooter />
      </body>
    </html>
  );
}
