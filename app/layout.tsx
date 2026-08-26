import type { Metadata } from "next";
import { LYVRA_ICON_DATA_URL } from "@/lib/lyrva-icon-data";
import "./globals.css";

export const metadata: Metadata = {
  title: "LYRVA — Sistema Financeiro",
  description: "Inteligência financeira e controle de notas da Casal Odonto.",
  icons: { icon: LYVRA_ICON_DATA_URL, shortcut: LYVRA_ICON_DATA_URL, apple: LYVRA_ICON_DATA_URL },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body className="antialiased">{children}</body></html>;
}
