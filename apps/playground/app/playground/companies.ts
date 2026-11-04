import { isLocalCompany } from "@poppy-lab/pap-core";
import { isSandbox } from "@/lib/company-policy";

// Inlined at build time: local Companies in development, poppylab.dev when deployed.
export const exampleUrl =
  process.env.NEXT_PUBLIC_JUNIPER_URL ?? "http://juniper.localhost:4100";
export const lanternUrl =
  process.env.NEXT_PUBLIC_LANTERN_URL ?? "http://noodles.localhost:4200";
/** Shows the sign-in control; the server decides (PAP_ACCOUNT_ORIGINS). */
export const accountCompany = (origin: string) =>
  isLocalCompany(origin) ||
  isSandbox(origin) ||
  [exampleUrl, lanternUrl].some((u) => new URL(u).origin === origin);

export type View = "run" | "inspect" | "identity";
export type Message = {
  role: "You" | "Agent" | "Demo" | "Error" | "Company";
  text: string;
  /** A Company message (§8): who wrote it, its data and a short note. */
  author?: string;
  data?: string;
  note?: string;
};
/** Server history (`user`/`assistant`) as transcript messages. */
export const historyToMessages = (
  history: Array<{ role: string; content: string }> | undefined,
): Message[] =>
  (history ?? []).map((m) => ({
    role: m.role === "user" ? "You" : "Agent",
    text: m.content,
  }));
