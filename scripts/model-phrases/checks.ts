/**
 * The checks on one turn, from what the agent answered (`TurnResult`),
 * the steps it recorded (the Inspector's trace) and the requests that
 * left the process while the turn ran. Pure: no I/O, so each can be read
 * on its own.
 */
import type {
  AgentMessage,
  TurnResult,
} from "../../packages/pap-agent/src/api.ts";
import {
  LANGUAGES,
  languageScores,
  type Language,
} from "../../packages/pap-agent/src/language.ts";
import type { Case, Site } from "./cases.ts";

export type Status = "pass" | "fail" | "warn" | "n/a";
export type Check = { status: Status; detail: string };

/** A request that left the process for a Company: never its query. */
export type WireRequest = { origin: string; method: string; path: string };

export type CheckName =
  | "to"
  | "privacy"
  | "language"
  | "ids"
  | "tools"
  | "terms"
  | "length"
  | "expect";

/** The table's column for each check, in order. */
export const COLUMNS: Record<CheckName, string> = {
  to: "went to",
  privacy: "privacy",
  language: "language",
  ids: "no IDs",
  tools: "no tool talk",
  terms: "terms once",
  length: "length",
  expect: "expected",
};

export type Companies = Record<Site, { origin: string; name: string }>;

const pass = (detail = ""): Check => ({ status: "pass", detail });
const fail = (detail: string): Check => ({ status: "fail", detail });
const warn = (detail: string): Check => ({ status: "warn", detail });
const none = (detail = ""): Check => ({ status: "n/a", detail });

/** The agent's messages in the turn: Iris's words, never a Company's. */
export const agentMessages = (turn: TurnResult) =>
  turn.messages.filter((m) => m.from === "agent");

/**
 * Iris's answer: her messages without the question that carries a new
 * proposal's terms, which the agent writes from the terms by fixed rules.
 */
export const answerMessages = (turn: TurnResult) =>
  agentMessages(turn).filter((m) => !m.proposals?.length);

const joined = (messages: AgentMessage[]) =>
  messages
    .map((m) => m.text)
    .join("\n\n")
    .trim();

/** What a Company says, quoted in Iris's answer: “…”. */
const QUOTED = /“[^”]*”/g;

/** IDs and codes that should never reach the User's eyes. */
const ID_PATTERNS: Array<[string, RegExp]> = [
  // ord_LNB1001, acc_HLB_A100, flt_na118_20270518, psg_elena, upg_elena_1
  [
    "an ID",
    /\b(?:ord|acc|txn|rcp|card|bdg|flt|psg|upg|itin|op|opr|usr|cus|grant|sess)_[A-Za-z0-9_]+\b/,
  ],
  // sun-1300, sat-1230
  ["a slot code", /\b(?:mon|tue|wed|thu|fri|sat|sun)-\d{4}\b/i],
  // The menu's and plans' keys.
  [
    "a key",
    /\b(?:matcha-ice|miso-ramen|shoyu-ramen|pork-gyoza|veg-gyoza|edamame-\w+|MR-[ER]\d|UP-[ER]\d|RT-[A-Z-]+)\b/,
  ],
  [
    "a UUID",
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
  ],
  ["a long hex string", /\b[0-9a-f]{20,}\b/i],
];

/** Signs that the answer talks about its tools instead of the task. */
const TOOL_PATTERNS: Array<[string, RegExp]> = [
  // list_orders, company_agent_send, report_unsupported_task
  ["a tool's name", /\b[a-z]+(?:_[a-z]+)+\b/],
  [
    "talk of tools",
    /\b(?:tool|tools|herramienta|herramientas|eina|eines|outil|outils|function call|API call)\b/i,
  ],
  [
    "a call narrated",
    /\b(?:I (?:called|used|ran|invoked)|I'll (?:call|use)|let me (?:call|check with the tool)|he llamado|he usado|j'ai appelé|j'ai utilisé|he cridat)\b/i,
  ],
];

const firstMatch = (text: string, patterns: Array<[string, RegExp]>) => {
  for (const [what, pattern] of patterns) {
    const found = pattern.exec(text);
    if (found) return `${what}: "${found[0]}"`;
  }
  return undefined;
};

/** The Companies a message says the turn was with. */
const companiesOf = (m: AgentMessage) =>
  m.using?.length ? m.using : m.company ? [m.company] : [];

/** The origins the trace says were sent a request, with what was sent. */
export function traced(turn: TurnResult) {
  const sent: Array<{ origin: string; line: string }> = [];
  for (const m of turn.messages)
    for (const step of m.steps ?? []) {
      if (step.text.startsWith("Did not send a request to ")) continue;
      const origins = new Set<string>();
      if (step.company) origins.add(step.company);
      for (const [url] of step.text.matchAll(/https?:\/\/[^\s)]+/g))
        try {
          origins.add(new URL(url).origin);
        } catch {
          // Not an address after all.
        }
      for (const origin of origins) sent.push({ origin, line: step.text });
    }
  return sent;
}

/** Every number and name in a proposal's terms, as the User would read them. */
function termWords(terms: unknown): string[] {
  const out = new Set<string>();
  const visit = (value: unknown, key = "") => {
    if (Array.isArray(value)) value.forEach((v) => visit(v, key));
    else if (value && typeof value === "object")
      for (const [k, v] of Object.entries(value)) visit(v, k);
    else if (typeof value === "number" && Number.isFinite(value)) {
      const amount = /cents/.test(key) ? value / 100 : value;
      // Small counts ("1 item") say nothing about the terms.
      if (Math.abs(amount) >= 10) {
        out.add(amount.toLocaleString("en-US", { maximumFractionDigits: 2 }));
        if (!Number.isInteger(amount)) out.add(amount.toFixed(2));
      }
    } else if (
      typeof value === "string" &&
      /^(name|label|title|item|dish|description|payee|memo|reference|slot_label|when)$/i.test(
        key,
      ) &&
      value.length >= 4 &&
      !/[_]/.test(value)
    )
      out.add(value);
  };
  visit(terms);
  return [...out];
}

/** Requests in a line: each method and path once, with how many times. */
export function wireSummary(requests: WireRequest[]) {
  const counted = new Map<string, number>();
  for (const r of requests) {
    const key = `${r.method} ${r.path}`;
    counted.set(key, (counted.get(key) ?? 0) + 1);
  }
  return counted.size
    ? [...counted].map(([key, n]) => (n > 1 ? `${key} ×${n}` : key)).join(", ")
    : "in the trace only";
}

export type TurnFacts = {
  turn: TurnResult | undefined;
  /** The proposals waiting before the turn, by Company and ID. */
  before: Set<string>;
  wire: WireRequest[];
  error?: string;
};

export function checkTurn(
  c: Case,
  companies: Companies,
  facts: TurnFacts,
): Record<CheckName, Check> {
  const { turn } = facts;
  if (!turn) {
    const failed = fail(facts.error ?? "No answer");
    return {
      to: failed,
      privacy: none(),
      language: none(),
      ids: none(),
      tools: none(),
      terms: none(),
      length: none(),
      expect: none(),
    };
  }
  const nameOf = (origin: string) =>
    Object.values(companies).find((x) => x.origin === origin)?.name ?? origin;
  const labOrigins = new Set(Object.values(companies).map((x) => x.origin));
  const allowed = new Set(c.expect.allowed.map((s) => companies[s].origin));
  const agent = agentMessages(turn);
  const answer = joined(answerMessages(turn));
  const said = joined(agent);
  const plain = said.replace(QUOTED, " ");

  // Where the turn went: the Companies its answers name.
  const went = [
    ...new Map(
      agent.flatMap(companiesOf).map((ref) => [ref.origin, ref.name]),
    ).values(),
  ];
  const sentOrigins = new Set([
    ...traced(turn).map((t) => t.origin),
    ...facts.wire.map((w) => w.origin),
  ]);
  const asked = agent.some((m) => (m.choices?.length ?? 0) > 1);
  const to = (() => {
    const shown = went.length ? went.join(" + ") : "Iris";
    const expected = c.expect.to;
    if (expected === undefined) return none(shown);
    if (expected === "ask")
      return asked && ![...sentOrigins].some((o) => labOrigins.has(o))
        ? pass("asked which")
        : fail(`${shown}${asked ? ", asked after a request" : ", didn't ask"}`);
    if (expected === "agent") return went.length ? fail(shown) : pass(shown);
    const want = expected.map((s) => companies[s].name);
    const missing = want.filter((n) => !went.includes(n));
    const extra = went.filter((n) => !want.includes(n));
    return missing.length || extra.length ? fail(shown) : pass(shown);
  })();

  // Privacy: no request reached a Company the User didn't address.
  const outside = [
    ...new Set(
      [
        ...traced(turn)
          .filter((t) => labOrigins.has(t.origin) && !allowed.has(t.origin))
          .map((t) => t.origin),
        ...facts.wire
          .filter((w) => !allowed.has(w.origin))
          .map((w) => w.origin),
      ].filter(Boolean),
    ),
  ];
  const untraced = facts.wire.filter(
    (w) => !traced(turn).some((t) => t.origin === w.origin),
  );
  const privacy = outside.length
    ? fail(
        outside
          .map(
            (origin) =>
              `${nameOf(origin)}: ${wireSummary(facts.wire.filter((w) => w.origin === origin))}`,
          )
          .join("; "),
      )
    : pass(
        [
          facts.wire.length
            ? `${facts.wire.length} request${facts.wire.length === 1 ? "" : "s"} to ${[...new Set(facts.wire.map((w) => nameOf(w.origin)))].join(", ")}`
            : "no requests",
          untraced.length
            ? `${untraced.length} not in the trace (${[...new Set(untraced.map((w) => `${w.method} ${w.path}`))].slice(0, 3).join(", ")})`
            : "",
        ]
          .filter(Boolean)
          .join("; "),
      );

  // The answer's language, from its own words (a Company's quoted words
  // and its name left out).
  const scores = languageScores(
    Object.values(companies).reduce(
      (text, x) => text.split(x.name).join(" "),
      plain,
    ),
  );
  const best = Math.max(...LANGUAGES.map((l) => scores[l]));
  const top = LANGUAGES.filter((l) => scores[l] === best && best > 0);
  const scoreLine = LANGUAGES.filter((l) => scores[l])
    .map((l) => `${l} ${scores[l]}`)
    .join(", ");
  const language = !said
    ? none("no words")
    : best === 0
      ? warn("no word of any list")
      : top.includes(c.language)
        ? top.length > 1
          ? warn(`tie: ${scoreLine}`)
          : pass(scoreLine)
        : fail(`${top.join("/")} (${scoreLine})`);

  const idFound = firstMatch(plain, ID_PATTERNS);
  const ids = idFound ? fail(idFound) : pass();
  const toolFound = firstMatch(plain, TOOL_PATTERNS);
  const tools = toolFound ? fail(toolFound) : pass();

  // The terms of a new proposal are shown by the chat: the answer mustn't
  // say them as well.
  const fresh = turn.state.proposals.filter(
    (p) =>
      p.state === "proposed" &&
      !facts.before.has(`${p.company.origin} ${p.id}`),
  );
  const repeated = [
    ...new Set(
      fresh.flatMap((p) =>
        termWords(p.terms).filter((w) =>
          answer.toLowerCase().includes(w.toLowerCase()),
        ),
      ),
    ),
  ];
  const quoted = (words: string[]) =>
    `says ${words
      .slice(0, 4)
      .map((w) => `"${w}"`)
      .join(", ")}`;
  // An amount said again fails; a name or a memo said again is a warning,
  // since the answer may need a word for what is waiting.
  const amounts = repeated.filter((w) => /^[\d.,]+$/.test(w));
  const terms = !fresh.length
    ? none()
    : amounts.length
      ? fail(quoted(repeated))
      : repeated.length
        ? warn(quoted(repeated))
        : pass();

  const max = c.expect.maxChars ?? 450;
  const length = !answer
    ? none("no answer")
    : answer.length > max
      ? fail(`${answer.length} > ${max} chars`)
      : pass(`${answer.length} chars`);

  // What the case expects of the conversation afterwards.
  const problems: string[] = [];
  const notes: string[] = [];
  if (c.expect.connected) {
    const now = turn.state.companies.map((x) => nameOf(x.origin));
    const want = c.expect.connected.map((s) => companies[s].name);
    if (now.length !== want.length || want.some((n) => !now.includes(n)))
      problems.push(`connected: ${now.join(", ") || "none"}`);
    else notes.push(`connected: ${now.join(", ")}`);
  }
  if (c.expect.proposal !== undefined) {
    if (c.expect.proposal && !fresh.length) problems.push("no proposal");
    else if (!c.expect.proposal && fresh.length)
      problems.push(`${fresh.length} proposal(s)`);
    else if (fresh.length)
      notes.push(
        `proposal at ${[...new Set(fresh.map((p) => p.company.name))].join(", ")}`,
      );
  }
  if (c.expect.removed) {
    const origin = companies[c.expect.removed].origin;
    const gone = !turn.state.companies.some((x) => x.origin === origin);
    // Asked first: a choice that removes exactly that Company.
    const confirming = agent.some((m) =>
      m.choices?.some((choice) => {
        const remove = (choice.answer as { remove?: unknown }).remove;
        return Array.isArray(remove) && remove.includes(origin);
      }),
    );
    if (gone) notes.push(`${nameOf(origin)} removed`);
    else if (confirming)
      notes.push(`asked to confirm removing ${nameOf(origin)}`);
    else problems.push(`${nameOf(origin)} neither removed nor asked about`);
  }
  if (c.expect.says && !c.expect.says.test(said))
    problems.push(`doesn't say ${c.expect.says}`);
  const expect = problems.length
    ? fail(problems.join("; "))
    : notes.length || c.expect.says
      ? pass(notes.join("; "))
      : none();

  return { to, privacy, language, ids, tools, terms, length, expect };
}

/** The languages, as the table names them. */
export const LANGUAGE_NAMES: Record<Language, string> = {
  en: "English",
  es: "Spanish",
  ca: "Catalan",
  fr: "French",
};
