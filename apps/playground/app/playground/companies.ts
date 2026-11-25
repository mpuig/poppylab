import { isLocalCompany } from "@poppy-lab/pap-core";
import type { AgentStep } from "@/lib/agent-steps";
import { isSandbox } from "@/lib/company-policy";
import type { TranscriptEntry } from "@/lib/transcript";

// Inlined at build time: local Companies in development, poppylab.dev when deployed.
export const exampleUrl =
  process.env.NEXT_PUBLIC_JUNIPER_URL ?? "http://juniper.localhost:4100";
export const lanternUrl =
  process.env.NEXT_PUBLIC_LANTERN_URL ?? "http://noodles.localhost:4200";
export const harborlineUrl =
  process.env.NEXT_PUBLIC_HARBORLINE_URL ?? "http://harbor.localhost:4300";
export const northwindUrl =
  process.env.NEXT_PUBLIC_NORTHWIND_URL ?? "http://northwind.localhost:4400";
export const fernwickUrl =
  process.env.NEXT_PUBLIC_FERNWICK_URL ?? "http://fernwick.localhost:4500";
/** Shows the sign-in control; the server decides (PAP_ACCOUNT_ORIGINS). */
export const accountCompany = (origin: string) =>
  isLocalCompany(origin) ||
  isSandbox(origin) ||
  [exampleUrl, lanternUrl, harborlineUrl, northwindUrl, fernwickUrl].some(
    (u) => new URL(u).origin === origin,
  );

/**
 * The lab's five Companies, for the cards a new conversation starts from and
 * the requests the chat suggests. `open` needs no account, `account` reads
 * one, `ask` changes it. Demo mode (no model) answers with keyword rules:
 * every phrase here was checked against them, and `demoChange` says the
 * rules can prepare that Company's change (see `lib/demo-changes.ts`).
 */
export const labCompanies = [
  {
    url: exampleUrl,
    sector: "Grocery",
    name: "Juniper Market",
    people: "Elena or Robin",
    open: ["What are your products?", "When do you deliver?"],
    account: ["my deliveries", "my orders"],
    ask: "Move my recurring delivery to Saturday.",
    demoChange: true,
  },
  {
    url: lanternUrl,
    sector: "Restaurant",
    name: "Lantern Noodle Bar",
    people: "Elena or Robin",
    open: ["What’s on the menu?", "Which delivery slots are there?"],
    account: ["my orders"],
    ask: "Add a matcha ice cream and move it to Sunday lunchtime.",
    demoChange: true,
  },
  {
    url: harborlineUrl,
    sector: "Bank",
    name: "Harborline Bank",
    people: "Elena or Robin",
    open: [],
    account: ["my account balances", "my recent transactions"],
    ask: "Transfer $500 from checking to savings.",
    demoChange: true,
  },
  {
    url: northwindUrl,
    sector: "Airline",
    name: "Northwind Air",
    people: "Elena or Robin",
    open: [],
    account: ["my upcoming trips"],
    ask: "Upgrade my NA 118 flight to Business.",
    demoChange: true,
  },
  {
    url: fernwickUrl,
    sector: "Utility",
    name: "Fernwick Power & Light",
    people: "Elena or Robin",
    open: [],
    // The first reads through the ESPI-shaped tools: with Use ESPI on in
    // demo mode (`lib/demo-espi.ts`), or with a model.
    account: ["How much electricity did my EV use last week?", "my bills"],
    ask: "Switch my EV charger to the flat rate.",
    demoChange: false,
  },
] as const;
export const labCompany = (url: string | undefined) => {
  if (!url) return undefined;
  try {
    const origin = new URL(url).origin;
    return labCompanies.find((c) => new URL(c.url).origin === origin);
  } catch {
    return undefined;
  }
};

export type View = "run" | "inspect" | "identity" | "history";
export type Message = {
  role: "You" | "Agent" | "Demo" | "Error" | "Company";
  text: string;
  /** A Company message (§8): who wrote it, its data and a short note. */
  author?: string;
  data?: string;
  note?: string;
  /** What Iris did to produce this answer, for Agent and Demo messages. */
  steps?: AgentStep[];
  /** §8.10: said in the User's Direct Conversation with the Company. */
  direct?: boolean;
};
/**
 * A turn of a transcript stored before it kept what the page showed: the
 * notes written for the model stood in for the User's own direct lines and
 * buttons. Ended conversations are kept for seven days, so these lines are
 * still read for that long after the change.
 */
function earlierTurn(m: TranscriptEntry): Message[] | undefined {
  if (m.role === "user") {
    const direct =
      /^\((?:Said|Written) to .+? directly, without Iris(?:; it may not have been sent)?\) /.exec(
        m.content,
      );
    if (direct)
      return [
        { role: "You", text: m.content.slice(direct[0].length), direct: true },
      ];
    // Accept, decline and leave were buttons: Iris's next line says it.
    if (
      /^\(Direct conversation with .+: (accept|decline|close)\)$/.test(
        m.content,
      )
    )
      return [];
  }
  if (
    m.role === "assistant" &&
    m.content ===
      "(No reply from Iris: the user was talking with the Company directly.)"
  )
    return [];
  return undefined;
}

/**
 * The server's transcript as the messages the page showed: the User's
 * words, Company content with its author, and each answer with its label,
 * steps and data.
 */
export const historyToMessages = (
  history: TranscriptEntry[] | undefined,
): Message[] =>
  (history ?? []).flatMap((m): Message[] => {
    const earlier = earlierTurn(m);
    if (earlier) return earlier;
    const direct = m.direct ? { direct: true } : {};
    const data = m.data ? { data: m.data } : {};
    if (m.role === "company")
      return [
        {
          role: "Company",
          author: m.author ?? "Company",
          text: m.content,
          ...data,
          ...(m.note ? { note: m.note } : {}),
          ...direct,
        },
      ];
    if (m.role === "user") return [{ role: "You", text: m.content, ...direct }];
    return [
      {
        role: m.demo ? "Demo" : "Agent",
        text: m.content,
        ...data,
        ...(m.steps?.length ? { steps: m.steps } : {}),
      },
    ];
  });
