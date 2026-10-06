import type { Metadata } from "next";
import { Archivo, IBM_Plex_Mono, IBM_Plex_Sans_KR } from "next/font/google";
import { DemoGuide } from "@/components/DemoGuide";
import { Header } from "@/components/Header";
import { StatusStrip } from "@/components/StatusStrip";
import { ModeProvider } from "@/lib/mode";
import { WalletProvider } from "@/lib/wallet";
import "./globals.css";

const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo" });
const plexKr = IBM_Plex_Sans_KR({ weight: ["400", "500", "600"], subsets: ["latin"], variable: "--font-plex-kr", preload: false });
const plexMono = IBM_Plex_Mono({ weight: ["400", "500"], subsets: ["latin"], variable: "--font-plex-mono" });

export const metadata: Metadata = {
  title: "K2X — 2x SK hynix and Samsung, no liquidations",
  description:
    "2x tokens on SK hynix and Samsung Electronics that are never liquidated. Mint and redeem settle at the next price a Monad contract accepts under Korean market rules.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${plexKr.variable} ${plexMono.variable}`}>
      <body className="min-h-screen">
        <WalletProvider>
          <ModeProvider>
            <Header />
            <StatusStrip />
            <DemoGuide />
            <main className="mx-auto max-w-6xl px-4 pb-24">{children}</main>
          </ModeProvider>
        </WalletProvider>
      </body>
    </html>
  );
}
