import type { Metadata } from "next";
import { Archivo, Martian_Mono } from "next/font/google";

const display = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
  display: "swap",
});
const mono = Martian_Mono({
  variable: "--font-martian",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Poppy Lab: Personal Agent Protocol, explained and live",
  description:
    "What Personal Agent Protocol 1.0 is, what companies and customers get from it, and a live demo: Iris, a Personal Agent, and four fictional companies it can sign in to. An independent lab.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
