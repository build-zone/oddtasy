import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Header } from "@/components/header";
import { BottomNav } from "@/components/bottom-nav";
import { SiteFooter } from "@/components/site-footer";

const grotesk = Space_Grotesk({
  variable: "--font-grotesk",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const plex = IBM_Plex_Mono({
  variable: "--font-plex",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Oddtasy — social betting pools on Solana",
  description:
    "Bet with your friends on live World Cup matches. Everyone bets the same amount, winners split the prize — settled automatically on Solana from real-time TxLINE data.",
};

export const viewport: Viewport = {
  themeColor: "#0a1410",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      {/* extensions inject attrs on <body> pre-hydration; suppress is shallow, children still checked */}
      <body
        className={`${grotesk.variable} ${plex.variable} antialiased`}
        suppressHydrationWarning
      >
        <Providers>
          {/* pb clears the fixed BottomNav + the iOS home indicator */}
          <div className="max-w-[680px] mx-auto px-4 pb-[calc(76px+env(safe-area-inset-bottom,0px))]">
            <Header />
            <main>{children}</main>
            <SiteFooter />
          </div>
          <BottomNav />
        </Providers>
      </body>
    </html>
  );
}
