import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LYRVA — Sistema Financeiro",
  description: "Inteligência financeira e controle de notas da Casal Odonto.",
  icons: { icon: "/lyrva-icon.png", shortcut: "/lyrva-icon.png", apple: "/lyrva-icon.png" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body className="antialiased">{children}</body></html>;
}
