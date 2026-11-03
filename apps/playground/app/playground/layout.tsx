import type { Metadata } from "next";
import "./playground.css";

export const metadata: Metadata = {
  title: "Playground · Poppy Lab",
  description:
    "Run a Personal Agent against PAP 0.3 Companies with your own model key, and inspect every protocol step.",
};

export default function PlaygroundLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <div className="playground-root">{children}</div>;
}
