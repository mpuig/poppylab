import type { Metadata } from "next";
import { Geist_Mono, Hanken_Grotesk, STIX_Two_Text } from "next/font/google";

// Headings and the wordmark; the face of technical and scientific publishing.
const serif = STIX_Two_Text({
  variable: "--font-serif",
  subsets: ["latin"],
  style: ["normal", "italic"],
  display: "swap",
});
const sans = Hanken_Grotesk({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});
const mono = Geist_Mono({
  variable: "--font-mono",
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
    <html
      lang="en"
      className={`${serif.variable} ${sans.variable} ${mono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
