import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/lib/providers";
import { Nav } from "@/components/Nav";

const geist = Geist({ subsets: ["latin"], display: "swap", variable: "--font-geist" });
const geistMono = Geist_Mono({ subsets: ["latin"], display: "swap", variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "Verity — verify what agents promise",
  description:
    "A GenLayer-native verification and settlement protocol for autonomous agent work.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geist.variable} ${geistMono.variable} font-sans antialiased`}>
        {/* §59 — keyboard users reach content without tabbing the whole nav */}
        <a href="#main"
           className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2
                      focus:rounded-lg focus:bg-brand-500 focus:px-3 focus:py-2 focus:text-white">
          Skip to content
        </a>
        <Providers>
          <Nav />
          <main id="main" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {children}
          </main>
          <footer className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10
                             text-xs text-ink-muted dark:text-night-muted">
            Verity · GenLayer determines meaning; the contract determines consequences.
          </footer>
        </Providers>
      </body>
    </html>
  );
}
