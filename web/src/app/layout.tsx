import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Header } from "@/components/header";

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
      <body className={`${grotesk.variable} ${plex.variable} antialiased`}>
        <Providers>
          <div className="max-w-[680px] mx-auto px-4 pb-10">
            <Header />
            <main>{children}</main>
            <footer className="font-mono text-[10.5px] leading-relaxed text-faint text-center mt-9 max-w-[560px] mx-auto">
              <b className="text-muted font-semibold">
                Fixtures, scores and odds are real
              </b>{" "}
              — live from TxLINE (TxODDS), cryptographically anchored on Solana.
              Pools settle on the 90-minute result. Devnet USDC · this is a
              hackathon build, not a licensed betting product.
            </footer>
          </div>
        </Providers>
      </body>
    </html>
  );
}
