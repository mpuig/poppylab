import type { Metadata } from "next";
import { Geist_Mono, Hanken_Grotesk, STIX_Two_Text } from "next/font/google";
import { SITE_NAME, SITE_URL, pageMetadata } from "@/lib/site";

// Headings and the wordmark; the face of technical and scientific publishing.
const serif = STIX_Two_Text({
  variable: "--font-serif",
  subsets: ["latin"],
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

// The home's tags, and the default for a page that sets none of its own.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  ...pageMetadata({
    title: `${SITE_NAME}: Personal Agent Protocol, explained and live`,
    description:
      "What Personal Agent Protocol 1.0 is, what companies and customers get from it, and a live demo: Iris, a Personal Agent, and fictional companies it can sign in to. An independent lab.",
    path: "/",
  }),
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/icon.png", type: "image/png", sizes: "192x192" },
    ],
    apple: "/apple-touch-icon.png",
  },
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
