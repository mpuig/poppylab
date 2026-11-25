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
  title: "Poppy Lab: a test bench for the Personal Agent Protocol",
  description:
    "An independent lab for Personal Agent Protocol 1.0: Iris, a Personal Agent you run with your own model key, and two fictional Companies it can sign in to and talk to.",
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
