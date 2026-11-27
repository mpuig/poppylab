import type { Metadata } from "next";
import { SITE_NAME, pageMetadata } from "@/lib/site";
import "./playground.css";

export const metadata: Metadata = pageMetadata({
  title: `Playground · ${SITE_NAME}`,
  description:
    "Run Iris, a Personal Agent, against Poppy 1.0 Companies with your own model key, and inspect every protocol step.",
  path: "/playground",
  image: "playground",
});

export default function PlaygroundLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <div className="playground-root">{children}</div>;
}
