import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { discovered } from "@poppy-lab/pap-agent/company-fixture";
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
            signingIn: { baseline: 0, since: 0, access: "read" },
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
      role: "Own",
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
    // Iris works out which Company a message is for, and asks: the
    // composer has no choice of its own.
    expect(html).not.toContain("Iris decides");
    expect(html).not.toContain("composer-target");
  });

  it("keeps one Company's screen as it was", () => {
    const html = chat(page({ companies: [two[0]!], messages }));
    expect(html).not.toContain('class="from-company"');
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

  it("tells two Companies' cards apart, though their IDs match, and counts both as waiting", () => {
    const html = chat(page({ companies: two }));
    expect(html).toContain("<strong>Lantern Noodle Bar</strong>");
    expect(html).toContain("<strong>Harborline Bank</strong>");
    expect(
      html.match(/Waiting for you<span class="operation-expiry">/g),
    ).toHaveLength(2);
    expect(html).toContain('id="proposal-noodles-localhost-4200-op_1"');
    expect(html).toContain('id="proposal-harbor-localhost-4300-op_1"');
    // The count in the heading; the panel that docked below is gone.
    expect(html).toContain("2 waiting</button>");
    expect(html).not.toContain("needs-you");
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

  it("offers to talk directly only with the Company the conversation is with now", () => {
    const can = { direct: false, invitation: null, canTalkDirectly: true };
    const companies = [
      at(harborline, "Harborline Bank", { direct: can }),
      at(lantern, "Lantern Noodle Bar", { direct: can }),
    ];
    const html = chat(page({ companies, messages, lastTurn: lantern }));
    expect(html).toContain("Talk to Lantern Noodle Bar yourself");
    expect(html).not.toContain("Talk to Harborline Bank yourself");
  });
});

describe("what waits, where it arose in the transcript", () => {
  const fernwick = "http://fernwick.localhost:4500";
  const plan = (state: string, more: Partial<Operation> = {}): Operation => ({
    ...proposal("op_plan"),
    revision: "r1",
    state,
    terms: {
      from_plan: "time_of_use",
      to_plan: "flat",
      from_plan_name: "Time of use",
      to_plan_name: "Flat rate",
      estimated_monthly_difference_cents: 3254,
      currency: "USD",
    },
    ...more,
  });
  const asked: Message[] = [
    { role: "You", text: "switch my plan to flat rate" },
    {
      role: "Own",
      text: "Fernwick Power & Light proposes a change: plan from Time of use to Flat rate. There is no payment now. Approve it?",
      choices: [
        {
          label: "Approve this change",
          answer: {
            approve: { company: fernwick, proposal: "op_plan", revision: "r1" },
          },
        },
        {
          label: "Decline this change",
          answer: {
            decline: { company: fernwick, proposal: "op_plan", revision: "r1" },
          },
        },
      ],
      proposals: [{ company: fernwick, proposal: "op_plan", revision: "r1" }],
    },
  ];
  const later: Message[] = [
    { role: "You", text: "connect with lantern noodle bar" },
    { role: "Own", text: "Connected Lantern Noodle Bar." },
    { role: "You", text: "show the menu" },
    {
      role: "Demo",
      text: "Dishes.",
      from: { origin: lantern, name: "Lantern Noodle Bar" },
    },
  ];
  const fern = (op: Operation) =>
    at(fernwick, "Fernwick Power & Light", {
      signedIn: true,
      scopes: "poppy:read poppy:write",
      operations: [op],
    });
  /** Where each of these words is in the page, in their order. */
  const order = (html: string, ...words: string[]) =>
    words.map((w) => html.indexOf(w)) as [number, number, number];

  it("shows one card after Iris's question, with one pair of buttons", () => {
    const html = chat(
      page({ companies: [fern(plan("proposed"))], messages: asked }),
    );
    const [question, card] = order(
      html,
      "Fernwick Power &amp; Light proposes a change",
      'class="operation-review waiting"',
    );
    expect(question).toBeGreaterThan(-1);
    expect(card).toBeGreaterThan(question);
    // The question's own buttons are the card's: not a second pair.
    expect(html.match(/>Approve this change</g)).toHaveLength(1);
    expect(html.match(/>Decline</g)).toHaveLength(1);
    expect(html).toContain("1 waiting</button>");
  });

  it("keeps a decided card where the proposal arrived, above later messages", () => {
    const html = chat(
      page({
        companies: [
          fern(
            plan("succeeded", {
              approvedBy: { approver: "user" },
              approval: { approved_at: Math.floor(Date.now() / 1000) },
            }),
          ),
          at(lantern, "Lantern Noodle Bar"),
        ],
        messages: [...asked, ...later],
        lastTurn: lantern,
      }),
    );
    const [card, connected, menu] = order(
      html,
      'class="operation-review done"',
      "Connected Lantern Noodle Bar.",
      "Dishes.",
    );
    expect(card).toBeGreaterThan(-1);
    expect(card).toBeLessThan(connected);
    expect(connected).toBeLessThan(menu);
    expect(html).toMatch(/Approved by you · \d\d:\d\d/);
    // Nothing waits: no count, and the card's buttons are gone.
    expect(html).not.toContain("waiting</button>");
    expect(html).not.toContain("Approve this change");
    expect(html).not.toContain(">Decline<");
  });

  it("asks for change permission where it arose, and docks no account controls below", () => {
    const signedInRead = at(lantern, "Lantern Noodle Bar", {
      signedIn: true,
      scopes: "poppy:read",
    });
    const p = page({
      companies: [signedInRead],
      messages: later,
      lastTurn: lantern,
      moreAccess: () => true,
    });
    const html = chat(p);
    expect(html).toContain("Request change permission");
    // Sign out and the access level are the Companies bar's.
    expect(html).not.toContain('class="account-row"');
    expect(html).not.toContain("Sign out");
    expect(html).not.toContain("Read-only access");
    expect(bar({ ...p, panel: lantern })).toContain(">Sign out</button>");
  });

  it("asks to finish a sign-in under way, or to sign in again once access was lost", () => {
    const signing = chat(
      page({
        companies: [
          at(harborline, "Harborline Bank", {
            signingIn: { baseline: 1, since: 0, access: "read" },
          }),
        ],
        messages: later,
        lastTurn: harborline,
      }),
    );
    expect(signing).toContain(
      "Finish signing in on Harborline Bank&#x27;s own page",
    );
    expect(signing).toContain("1 waiting</button>");
    const lost = chat(
      page({
        companies: [
          at(harborline, "Harborline Bank", { recovery: "access_denied" }),
        ],
        messages: later,
        lastTurn: harborline,
      }),
    );
    expect(lost).toContain("Sign in to Harborline Bank again");
    expect(lost).toContain("1 waiting</button>");
  });

  it("keeps a Company's bookkeeping data out of the transcript", () => {
    const html = chat(
      page({
        companies: [at(lantern, "Lantern Noodle Bar")],
        messages: [
          {
            role: "Company",
            author: "Lantern Noodle Bar automated agent",
            text: "Nobody can join this fictional demo.",
            data: '{"handoff":"unavailable","fictional_company":true}',
          },
          {
            role: "Company",
            author: "Lantern Noodle Bar automated agent",
            text: "Here is your order.",
            data: '{"order":{"id":"ord_1"}}',
          },
        ],
      }),
    );
    expect(html.match(/<summary>Data<\/summary>/g)).toHaveLength(1);
  });
});
