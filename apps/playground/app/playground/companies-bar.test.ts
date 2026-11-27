import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { discovered } from "@/lib/company-fixture";
import { CompaniesBar } from "./companies-bar";
import { harborlineUrl, lanternUrl, type Message } from "./companies";
import {
  companyFromView,
  type CompanyState,
  type Operation,
} from "./company-state";
import { Conversation } from "./conversation";
import type { Playground } from "./use-playground";

const lantern = new URL(lanternUrl).origin;
const harborline = new URL(harborlineUrl).origin;
const at = (
  origin: string,
  name: string,
  more: Partial<CompanyState> = {},
): CompanyState => ({
  ...companyFromView({ origin, name, company: discovered(origin, name) }),
  ...more,
});
const proposal = (id: string): Operation => ({
  operation_id: id,
  revision: "1",
  state: "proposed",
  summary: `Proposal ${id}`,
  terms: { amount_cents: 500, currency: "USD" },
  expires_at: new Date(Date.now() + 60_000).toISOString(),
});

/** The page's state, with only what these views read. */
const page = (more: Partial<Playground>): Playground =>
  ({
    companies: [],
    former: [],
    messages: [],
    busy: false,
    readOnly: false,
    missing: false,
    discovering: false,
    conversation: "c".repeat(20),
    addError: "",
    barNote: "",
    error: "",
    task: "",
    instructions: {},
    heldBack: {},
    canWrite: () => false,
    moreAccess: () => false,
    grantShown: () => false,
    statementsShown: () => false,
    extensionSignIn: () => false,
    ...more,
  }) as unknown as Playground;
const bar = (p: Playground) =>
  renderToStaticMarkup(createElement(CompaniesBar, { p, onInspect: () => {} }));
const chat = (p: Playground) =>
  renderToStaticMarkup(
    createElement(Conversation, {
      p,
      transcript: { current: null },
      taskInput: { current: null },
    }),
  );

describe("the Companies bar", () => {
  it("lists each Company with its state, and a way to add one", () => {
    const html = bar(
      page({
        companies: [
          at(lantern, "Lantern Noodle Bar", {
            signedIn: true,
            scopes: "orders:read",
          }),
          at(harborline, "Harborline Bank", {
            signingIn: { baseline: 0, since: 0 },
          }),
        ],
      }),
    );
    expect(html).toContain("<strong>Lantern Noodle Bar</strong>");
    expect(html).toContain("<span>Signed in · ");
    expect(html).toContain("Sign-in under way");
    expect(html).toContain("Add a company");
    // Each item opens what is that Company's; nothing is open yet.
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(3);
  });

  it("says so when the conversation has no Company yet", () => {
    expect(bar(page({}))).toContain("No company yet");
  });

  it("opens one Company's account controls and its removal", () => {
    const html = bar(
      page({
        panel: lantern,
        companies: [
          at(lantern, "Lantern Noodle Bar"),
          at(harborline, "Harborline Bank"),
        ],
      }),
    );
    expect(html).toContain('aria-label="Lantern Noodle Bar"');
    expect(html).toContain("Sign in to Lantern Noodle Bar · read only");
    expect(html).not.toContain("Sign in to Harborline Bank");
    expect(html).toContain("Remove from this conversation");
    expect(html).toContain("Inspect connection");
  });

  it("offers the lab's other Companies, and refuses a fourth before sending", () => {
    const two = bar(
      page({
        panel: "add",
        companies: [
          at(lantern, "Lantern Noodle Bar"),
          at(harborline, "Harborline Bank"),
        ],
      }),
    );
    const offered = two.slice(two.indexOf('class="add-options"'));
    expect(offered).toContain("<strong>Northwind Air</strong>");
    expect(offered).not.toContain("Lantern Noodle Bar");
    expect(two).toContain("Use another address");
    const three = bar(
      page({
        panel: "add",
        companies: [
          at(lantern, "Lantern Noodle Bar"),
          at(harborline, "Harborline Bank"),
          at("https://another.example", "Another"),
        ],
      }),
    );
    expect(three).toContain(
      "A conversation works with at most 3 companies. Remove one to add another.",
    );
    expect(three).not.toContain("Use another address");
  });
});

describe("a conversation with several Companies", () => {
  const two = [
    at(lantern, "Lantern Noodle Bar", { operations: [proposal("op_1")] }),
    at(harborline, "Harborline Bank", { operations: [proposal("op_1")] }),
  ];
  const messages: Message[] = [
    { role: "You", text: "the menu" },
    {
      role: "Demo",
      text: "Dishes.",
      from: { origin: lantern, name: "Lantern Noodle Bar" },
    },
    {
      role: "Iris",
      text: "Which company is this for?",
      choices: [
        { label: "Lantern Noodle Bar", answer: { company: lantern } },
        { label: "Harborline Bank", answer: { company: harborline } },
      ],
    },
  ];

  it("names the Company of each answer, and offers Iris's question as buttons", () => {
    const html = chat(page({ companies: two, messages }));
    expect(html).toContain('class="from-company"');
    expect(html).toMatch(/Protocol demo<span class="from-company">/);
    expect(html).toContain(">Harborline Bank</button>");
    // Which Company a message is for, when the person wants to say so.
    expect(html).toContain("Iris decides");
    expect(html).toContain("For Harborline Bank");
  });

  it("keeps one Company's screen as it was", () => {
    const html = chat(page({ companies: [two[0]!], messages }));
    expect(html).not.toContain('class="from-company"');
    expect(html).not.toContain("Iris decides");
  });

  it("offers a button only while Iris's question is the last thing said", () => {
    const html = chat(
      page({
        companies: two,
        messages: [...messages, { role: "You", text: "Lantern" }],
      }),
    );
    expect(html).not.toContain(">Harborline Bank</button>");
  });

  it("tells two Companies' proposals apart in Needs you, though their IDs match", () => {
    const html = chat(page({ companies: two }));
    expect(html).toContain("Needs you");
    expect(html).toContain("Lantern Noodle Bar · Approval required");
    expect(html).toContain("Harborline Bank · Approval required");
  });

  it("names the Company the person is talking with directly", () => {
    const direct = at(lantern, "Lantern Noodle Bar", {
      direct: { direct: true, invitation: null, canTalkDirectly: true },
    });
    const html = chat(
      page({ companies: [direct, two[1]!], directWith: direct, messages }),
    );
    expect(html).toContain(
      "You&#x27;re talking with <strong>Lantern Noodle Bar</strong> directly.",
    );
    expect(html).toContain('placeholder="Message Lantern Noodle Bar…"');
  });
});

describe("the account row at the end of the transcript", () => {
  const bank = { origin: harborline, name: "Harborline Bank" };
  const read = (path: string) => ({
    text: `Read ${path}`,
    how: "API" as const,
    access: "view" as const,
    state: "done" as const,
  });
  const balances: Message[] = [
    { role: "You", text: "my account balances" },
    {
      role: "Demo",
      text: "Accounts (2).",
      from: bank,
      steps: [read("/api/account/accounts")],
    },
  ];
  const signedIn = (scopes: string, more: Partial<CompanyState> = {}) =>
    at(harborline, "Harborline Bank", { signedIn: true, scopes, ...more });
  const row = (html: string) => html.includes('class="account-row"');

  it("goes once nothing there waits for the person, with one Company or several", () => {
    for (const companies of [
      [signedIn("poppy:read poppy:write")],
      [at(lantern, "Lantern Noodle Bar"), signedIn("poppy:read poppy:write")],
    ]) {
      const p = page({ companies, messages: balances, lastTurn: harborline });
      expect(row(chat(p))).toBe(false);
      // Its controls are in the Company's panel in the Companies bar.
      const panel = bar({ ...p, panel: harborline });
      expect(panel).toContain('class="account-row"');
      expect(panel).toContain("poppy:read, poppy:write");
      expect(panel).toContain(">Sign out</button>");
    }
  });

  it("is there while the guide asks for a press in it", () => {
    // Signed out: the guide says to sign in, and the button is right here.
    const out = chat(
      page({
        companies: [at(harborline, "Harborline Bank")],
        messages: balances,
        lastTurn: harborline,
      }),
    );
    expect(out).toContain("Sign in to Harborline Bank · read only");
    // Read only: the guide says to press "Request change permission".
    const readOnly = chat(
      page({
        companies: [signedIn("poppy:read")],
        messages: balances,
        lastTurn: harborline,
        moreAccess: () => true,
      }),
    );
    expect(readOnly).toContain("Request change permission");
  });

  it("is there while a sign-in is under way, or after the access was lost", () => {
    const signing = chat(
      page({
        companies: [
          signedIn("poppy:read poppy:write", {
            signingIn: { baseline: 1, since: 0 },
          }),
        ],
        messages: balances,
        lastTurn: harborline,
      }),
    );
    expect(row(signing)).toBe(true);
    // Lost while a proposal waits at another Company, which the guide is
    // about.
    const lost = chat(
      page({
        companies: [
          at(lantern, "Lantern Noodle Bar", {
            signedIn: true,
            scopes: "poppy:read poppy:write",
            operations: [proposal("op_1")],
          }),
          at(harborline, "Harborline Bank", { recovery: "access_denied" }),
        ],
        messages: balances,
        lastTurn: harborline,
      }),
    );
    expect(lost).toContain("Sign in to Harborline Bank · read only");
  });

  it("is there when the last turn there stopped for a permission, and not for a turn elsewhere", () => {
    const stopped: Message[] = [
      { role: "You", text: "my cards" },
      {
        role: "Demo",
        text: "This needs a permission your sign-in to Harborline Bank doesn't include.",
        from: bank,
        steps: [
          {
            text: "Did not send a request to /api/account/cards (permission not granted)",
            how: "API",
            access: null,
            state: "done",
          },
        ],
      },
    ];
    const here = chat(
      page({
        companies: [signedIn("poppy:read poppy:write")],
        messages: stopped,
        lastTurn: harborline,
      }),
    );
    expect(here).toContain(">Sign out</button>");
    const elsewhere = chat(
      page({
        companies: [
          signedIn("poppy:read poppy:write"),
          at(lantern, "Lantern Noodle Bar", {
            signedIn: true,
            scopes: "poppy:read poppy:write",
          }),
        ],
        messages: [
          ...stopped,
          {
            role: "Demo",
            text: "Dishes.",
            from: { origin: lantern, name: "Lantern Noodle Bar" },
            steps: [read("/api/menu")],
          },
        ],
        lastTurn: lantern,
      }),
    );
    expect(row(elsewhere)).toBe(false);
  });
});
