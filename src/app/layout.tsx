import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

/**
 * Sollos 3 uses Inter as the product font (same as api.velluma.co/dashboard
 * and velluma.co). JetBrains Mono is loaded for the few places we show code
 * or fixed-width IDs (audit log entity IDs, migration names, etc).
 *
 * Both fonts are exposed as CSS variables so Tailwind's `font-sans` +
 * `font-mono` utilities resolve through them without any extra config.
 */

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Sollos 3 — Operations software for cleaning companies",
    template: "%s · Sollos 3",
  },
  description:
    "Bookings, scheduling, invoicing, team chat, on-call freelancer bench, and field tools — all in one place. Built for cleaning businesses.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    // black-translucent = status bar transparent with light content.
    // Lets our dark loader background bleed into the status bar so there's
    // no white strip during PWA cold boot on iOS.
    statusBarStyle: "black-translucent",
    title: "Sollos 3",
  },
  openGraph: {
    type: "website",
    siteName: "Sollos 3",
    title: "Sollos 3 — Operations software for cleaning companies",
    description:
      "Bookings, scheduling, invoicing, team chat, on-call freelancer bench, and field tools — all in one place.",
    url: SITE_URL,
    // OG image auto-generated from src/app/opengraph-image.tsx
  },
  twitter: {
    card: "summary_large_image",
    title: "Sollos 3 — Operations software for cleaning companies",
    description:
      "Bookings, scheduling, invoicing, team chat, on-call freelancer bench, and field tools — all in one place.",
    // Twitter image auto-generated from opengraph-image.tsx fallback
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrains.variable} h-full antialiased`}
    >
      <head>
        <meta name="theme-color" content="#4f46e5" />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster richColors closeButton />
      </body>
    </html>
  );
}
