/**
 * The phrases, as data: what the User says, the conversation it is said
 * in, and what the turn should do. The runner (`runner.ts`) builds each
 * conversation from scratch with a new visitor, so no case depends on
 * another.
 *
 * `setup.companies` are connected signed out, in order; `setup.signIn`
 * signs in at some of them with the consent page's test customer, for
 * reading or with the change permission; `setup.before` are earlier
 * turns, asked of the same model. `expect.to` is where the turn should go:
 * one or more Companies, `"ask"` when the agent should ask which, or
 * `"agent"` when the agent should answer in its own voice. `expect.allowed`
 * are the Companies the User addressed: a request to any other one fails
 * the privacy check.
 */
import type { Language } from "../../packages/pap-agent/src/language.ts";

export type Site =
  "juniper" | "lantern" | "harborline" | "northwind" | "fernwick";

export type Case = {
  id: string;
  /** What the case is for, in a few words. */
  title: string;
  /** The language the User writes in, which the answer must be in. */
  language: Language;
  setup: {
    companies: Site[];
    signIn?: Partial<Record<Site, "read" | "write">>;
    before?: string[];
  };
  phrase: string;
  expect: {
    to?: Site[] | "ask" | "agent";
    allowed: Site[];
    /** The Companies in the conversation after the turn, in any order. */
    connected?: Site[];
    /** Whether a proposal waits for the User after the turn. */
    proposal?: boolean;
    /** A Company the turn removes, or asks to confirm removing. */
    removed?: Site;
    /** Words the answer must hold (any of them), as a pattern. */
    says?: RegExp;
    /** The most characters the agent's answer may have; 450 when not given. */
    maxChars?: number;
  };
};

export const CASES: Case[] = [
  {
    id: "en-menu",
    title: "English control: a public read",
    language: "en",
    setup: { companies: ["lantern"] },
    phrase: "What do you have on the menu tonight?",
    expect: { to: ["lantern"], allowed: ["lantern"], maxChars: 900 },
  },
  {
    id: "es-menu-two",
    title: "Spanish read, two Companies connected",
    language: "es",
    setup: { companies: ["lantern", "harborline"] },
    phrase: "¿Qué hay en el menú?",
    expect: { to: ["lantern"], allowed: ["lantern"], maxChars: 900 },
  },
  {
    id: "ca-balances",
    title: "Catalan read, signed in",
    language: "ca",
    setup: { companies: ["harborline"], signIn: { harborline: "read" } },
    phrase: "Quants diners tinc al compte corrent?",
    expect: { to: ["harborline"], allowed: ["harborline"] },
  },
  {
    id: "fr-trips",
    title: "French read, signed in",
    language: "fr",
    setup: { companies: ["northwind"], signIn: { northwind: "read" } },
    phrase: "Quels sont mes prochains vols ?",
    expect: { to: ["northwind"], allowed: ["northwind"], maxChars: 600 },
  },
  {
    id: "es-typo-connect",
    title: "Connecting in words, with a typo",
    language: "es",
    setup: { companies: [] },
    phrase: "connectate con lantern noodle bar",
    expect: { allowed: ["lantern"], connected: ["lantern"] },
  },
  {
    id: "fr-connect",
    title: "Connecting a second Company in words",
    language: "fr",
    setup: { companies: ["lantern"] },
    phrase: "Ajoute aussi la banque à cette conversation, s'il te plaît.",
    expect: { allowed: ["harborline"], connected: ["lantern", "harborline"] },
  },
  {
    id: "es-remove",
    title: "Removing a Company in words",
    language: "es",
    setup: { companies: ["lantern", "harborline"] },
    phrase: "Quita Lantern de esta conversación.",
    // Removed, or asked to confirm first: both are right.
    expect: { allowed: ["lantern"], removed: "lantern" },
  },
  {
    id: "en-ambiguous",
    title: "Ambiguous between two connected Companies",
    language: "en",
    setup: { companies: ["juniper", "lantern"] },
    phrase: "When can you deliver?",
    expect: { to: "ask", allowed: ["juniper", "lantern"] },
  },
  {
    id: "en-not-connected",
    title: "A Company that isn't connected, while another is",
    language: "en",
    setup: { companies: ["lantern"] },
    phrase: "What's my balance at Harborline Bank?",
    expect: { allowed: ["harborline"], says: /Harborline/ },
  },
  {
    id: "en-savings-privacy",
    title: "The privacy rule: two Companies, one asked",
    language: "en",
    setup: {
      companies: ["juniper", "harborline"],
      signIn: { harborline: "read" },
    },
    phrase: "How much is in my savings?",
    expect: { to: ["harborline"], allowed: ["harborline"] },
  },
  {
    id: "es-follow-up",
    title: "An earlier turn, then a follow-up in another language",
    language: "es",
    setup: {
      companies: ["lantern"],
      signIn: { lantern: "read" },
      before: ["Show me my recent orders, please."],
    },
    phrase: "¿Y cuánto costó el último?",
    expect: { to: ["lantern"], allowed: ["lantern"] },
  },
  {
    id: "es-transfer",
    title: "A change that leads to a proposal (Spanish)",
    language: "es",
    setup: { companies: ["harborline"], signIn: { harborline: "write" } },
    phrase: "Pasa 50 dólares de la cuenta corriente a ahorros.",
    expect: { to: ["harborline"], allowed: ["harborline"], proposal: true },
  },
  {
    id: "ca-order-change",
    title: "A change that leads to a proposal (Catalan)",
    language: "ca",
    setup: { companies: ["lantern"], signIn: { lantern: "write" } },
    phrase:
      "Afegeix un gelat de matcha a la meva comanda i passa-la a diumenge al migdia.",
    expect: { to: ["lantern"], allowed: ["lantern"], proposal: true },
  },
  {
    id: "en-gift-card",
    title: "A task the Company can't do",
    language: "en",
    setup: { companies: ["lantern"], signIn: { lantern: "write" } },
    phrase: "Can I pay for my order with a gift card?",
    expect: {
      to: ["lantern"],
      allowed: ["lantern"],
      proposal: false,
      says: /gift card/i,
    },
  },
  {
    id: "en-bill-pay",
    title: "Two Companies: pay the Fernwick bill from Harborline",
    language: "en",
    setup: {
      companies: ["fernwick", "harborline"],
      signIn: { fernwick: "read", harborline: "write" },
    },
    phrase: "Please pay what I owe Fernwick from my checking account.",
    expect: {
      to: ["fernwick", "harborline"],
      allowed: ["fernwick", "harborline"],
      proposal: true,
      maxChars: 500,
    },
  },
];
