/**
 * End to end, in process: Iris asks, and the User answers in words. One
 * conversation with Lantern and Harborline, the lab's real Companies, as
 * in `two-companies.test.ts`: only the network is replaced. No model,
 * except where a test says so: the demo's rules answer.
 *
 * A sign-in the turn stopped for becomes Iris's question, and the request
 * goes on once it completes and the User says yes. A proposal becomes
 * Iris's question, answered by typing "yes", "no" or "approve the Lantern
 * one"; the approval goes through the account route's own handler, and
 * reaches the Company as the same request a click sends.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
type App = {
  request: (url: string, init?: RequestInit) => Response | Promise<Response>;
};
const net = vi.hoisted(() => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("PAP_ALLOW_PRIVATE_NETWORK", "true");
  return {
    apps: {} as Record<string, App>,
    cookies: new Map<string, string>(),
    seen: [] as Array<{
      origin: string;
      url: string;
      method: string;
      headers: Record<string, string>;
      body: string;
    }>,
  };
});
// A model that must never be asked: an approval is never the model's.
const model = vi.hoisted(() => ({
  asked: 0,
}));
vi.mock("@poppy-lab/llm-adapters/server", async (actual) => ({
  ...(await actual<typeof import("@poppy-lab/llm-adapters/server")>()),
  runModel: async () => {
    model.asked++;
    throw new Error("The model was asked");
  },
  askModel: async () => {
    model.asked++;
    throw new Error("The model was asked");
  },
}));
vi.mock("node:dns/promises", () => ({
  lookup: async () => [{ address: "127.0.0.1", family: 4 }],
}));
const undici = await vi.hoisted(async () => {
  const { createRequire } = await import("node:module");
  const { fileURLToPath } = await import("node:url");
  return createRequire(
    fileURLToPath(new URL("../../../packages/pap-client/", import.meta.url)),
  ).resolve("undici");
});
vi.mock(undici, () => ({
  Agent: class {
    destroy() {}
  },
  fetch: async (
    url: URL | string,
    init: RequestInit & { dispatcher?: unknown },
  ) => {
    const { dispatcher, ...rest } = init;
    void dispatcher;
    const origin = new URL(String(url)).origin;
    net.seen.push({
      origin,
      url: String(url),
      method: rest.method ?? "GET",
      headers: Object.fromEntries(new Headers(rest.headers).entries()),
      body: typeof rest.body === "string" ? rest.body : "",
    });
    return net.apps[origin]!.request(String(url), rest);
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      net.cookies.has(name) ? { value: net.cookies.get(name)! } : undefined,
    set: (name: string, value: string, options?: { maxAge?: number }) => {
      if (value && options?.maxAge !== 0) net.cookies.set(name, value);
      else net.cookies.delete(name);
    },
    delete: (name: string) => net.cookies.delete(name),
  }),
}));
import { createIdentity, parseApprovalHeader } from "@poppy-lab/pap-client";
import * as harborline from "../../harborline/src/test-harness";
import * as lantern from "../../lantern/src/test-harness";
import { POST as discover } from "../app/api/discover/route";
import { GET as account, POST as act } from "../app/api/account/route";
import { GET as callback } from "../app/api/account/callback/route";
import { POST as chat } from "../app/api/chat/route";
import type { Operation } from "@poppy-lab/pap-agent/runtime";

const agent = "http://localhost:3000";
const food = lantern.origin;
const bank = harborline.origin;
let conversation = "";

const post = async (
  handler: (r: Request) => Promise<Response>,
  path: string,
  body: unknown,
) => {
  const response = await handler(
    new Request(`${agent}${path}`, {
      method: "POST",
      headers: {
        origin: agent,
        "Content-Type": "application/json",
        ...(conversation ? { "X-Poppy-Conversation": conversation } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
  return {
    status: response.status,
    conversation: response.headers.get("X-Poppy-Conversation"),
    data: await response.json(),
  };
};
/** What the User types, as the page sends it. */
const say = (message: string, more: object = {}) =>
  post(chat, "/api/chat", {
    message,
    provider: "demo",
    companies: true,
    ...more,
  });
type Entry = {
  role: string;
  content: string;
  spoken?: string;
  choices?: Array<{ label: string; answer: Record<string, unknown> }>;
  from?: { origin: string; name: string };
};
const reload = async () =>
  (
    await account(
      new Request(`${agent}/api/account?conversation=${conversation}`),
    )
  ).json() as Promise<{
    history: Entry[];
    connections: Array<{
      origin: string;
      signedIn: boolean;
      scopes?: string;
      operations: Operation[];
    }>;
  }>;
const since = (from: number) => net.seen.slice(from);
const at = (from: number, origin: string) =>
  since(from).filter((r) => r.origin === origin);

/** The User on a Company's consent page: Elena allows what Iris asked. */
async function consent(company: string, url: string, form: object = {}) {
  const app = net.apps[company]!;
  const page = await app.request(url);
  expect(page.status).toBe(200);
  const cookie = page.headers
    .getSetCookie()
    .find((c) => c.includes("pap_consent_"))!
    .split(";")[0]!;
  const allowed = await app.request(`${company}/oauth/authorize`, {
    method: "POST",
    headers: {
      cookie,
      origin: company,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      nonce: cookie.split("=")[1]!,
      decision: "approve",
      account: "elena",
      ...form,
    }).toString(),
  });
  expect(allowed.status).toBe(302);
  const back = await callback(new Request(allowed.headers.get("location")!));
  expect(back.headers.get("Location")).toBe("/playground/sign-in/done");
}
const BANK_WRITE = {
  allow_cards_write: "yes",
  allow_transactions_write: "yes",
  allow_budgets_write: "yes",
  allow_payments_request: "yes",
  allow_transfers_request: "yes",
};

describe("Iris asks, and the User answers in words", () => {
  beforeAll(async () => {
    const keys = await createIdentity();
    vi.stubEnv("POPPY_IDENTITY", JSON.stringify(keys));
    const fetchJson = async (url: string) =>
      url.endsWith("client.json")
        ? {
            client_id: lantern.client,
            client_name: "Iris",
            jwks_uri: `${agent}/agent/jwks.json`,
            redirect_uris: [lantern.redirect],
          }
        : { keys: [keys.publicKey] };
    await lantern.setup({ fetchJson });
    await harborline.setup({ fetchJson });
    net.apps[food] = lantern.lab.app;
    net.apps[bank] = harborline.lab.app;
    net.cookies.set("poppy_visitor", "c".repeat(43));
  });
  afterAll(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("asks to sign in when a request needs the account, and sends nothing for a typed yes", async () => {
    const found = await post(discover, "/api/discover", { url: food });
    conversation = found.conversation!;
    const orders = await say("my orders");
    expect(orders.status).toBe(200);
    expect(orders.data.question).toEqual({
      text: "That needs your Lantern Noodle Bar account. Sign in on Lantern Noodle Bar's own page to go on with “my orders”? It's read only, and I never see your password.",
      spoken:
        "Sign in to Lantern Noodle Bar to go on? You do it on Lantern Noodle Bar's own page.",
      choices: [
        {
          label: "Sign in to Lantern Noodle Bar · read only",
          answer: { signin: { company: food, access: "read" } },
        },
      ],
    });
    // The question is last, with its button, after a reload too.
    expect((await reload()).history.at(-1)).toMatchObject({
      role: "assistant",
      content: orders.data.question.text,
      choices: orders.data.question.choices,
    });
    // A "yes" that reaches the server can't open a tab: Iris offers the
    // button again, and nothing goes to Lantern.
    const from = net.seen.length;
    const yes = await say("yes");
    expect(yes.data).toMatchObject({
      mode: "own",
      text: "Use the button below to open Lantern Noodle Bar's own page and sign in, read only. I never see your password.",
      choices: orders.data.question.choices,
    });
    expect(since(from)).toEqual([]);
    expect(model.asked).toBe(0);
  });

  it("goes on with the request once the sign-in completes and the User says yes", async () => {
    // The page read the typed "yes" itself and opened the tab.
    const started = await post(act, "/api/account", {
      action: "signin",
      company: food,
      access: "read",
      said: "yes",
    });
    expect(started.status).toBe(200);
    expect(started.data.said).toBe(
      "Lantern Noodle Bar's own page is open in a new tab. Sign in there; I never see your password.",
    );
    await consent(food, started.data.url);
    // The sign-in finished in its own tab: Iris asks, and a reload (or the
    // page's poll) shows it.
    const after = (await reload()).history;
    expect(after.at(-1)).toMatchObject({
      role: "assistant",
      content:
        "You're signed in at Lantern Noodle Bar. Shall I go on with “my orders”?",
      choices: [{ label: "Yes, go on", answer: { resume: food } }],
    });
    expect(after.map((e) => e.content)).toContain("yes");
    const from = net.seen.length;
    const resumed = await say("yes, go on");
    expect(resumed.status).toBe(200);
    expect(resumed.data.from).toEqual({
      origin: food,
      name: "Lantern Noodle Bar",
    });
    expect(resumed.data.signedIn).toBe(true);
    expect(at(from, food).length).toBeGreaterThan(0);
    // The User's line is what they typed; the model would get the request.
    const shown = (await reload()).history;
    expect(shown.at(-2)).toMatchObject({ role: "user", content: "yes, go on" });
    expect(shown.at(-1)!.role).toBe("assistant");
  });

  it("asks for change permission, and the proposal that follows, in its own words", async () => {
    const asked = await say(
      "Add a matcha ice cream and move it to Sunday lunchtime.",
    );
    expect(asked.data.question.text).toBe(
      "That needs change permission at Lantern Noodle Bar. Ask Lantern Noodle Bar for it to go on with “Add a matcha ice cream and move it to Sunday lunchtime”? Lantern Noodle Bar's page opens again, and nothing changes until you approve the change itself.",
    );
    expect(asked.data.question.choices[0].answer).toEqual({
      signin: { company: food, access: "write" },
    });
    // The question's button, pressed on the page.
    const started = await post(act, "/api/account", {
      action: "signin",
      company: food,
      access: "write",
      said: true,
    });
    await consent(food, started.data.url, { write: "yes" });
    const history = (await reload()).history;
    expect(history.slice(-3).map((e) => e.content)).toEqual([
      "Request change permission at Lantern Noodle Bar",
      "Lantern Noodle Bar's own page is open in a new tab for the change permission. Sign in there; I never see your password.",
      "You're signed in at Lantern Noodle Bar. Shall I go on with “Add a matcha ice cream and move it to Sunday lunchtime”?",
    ]);
    // The button sends the request that waited, and nothing else.
    const turn = await post(chat, "/api/chat", {
      answer: { resume: food },
      provider: "demo",
      companies: true,
    });
    expect(turn.status).toBe(200);
    expect(turn.data.operations).toHaveLength(1);
    const op = turn.data.operations[0] as Operation;
    expect(turn.data.question.text).toMatch(
      /^Lantern Noodle Bar wants to change your order: the delivery slot from [A-Z][a-z]+day at \d\d:\d\d to Sunday at 13:00\. The new total is \$\d+\.\d\d, \$\d+\.\d\d more than before\. It expires in 10 minutes\. Shall I approve it\?$/,
    );
    // Iris's words, never the Company's summary.
    expect(turn.data.question.text).not.toContain(op.summary!.slice(0, 20));
    expect(turn.data.question.spoken).toMatch(
      /^Lantern Noodle Bar wants to change your order, for a new total of \d+ dollars, \d+ more\. Shall I approve it\?$/,
    );
    expect(
      turn.data.question.choices.map((c: { label: string }) => c.label),
    ).toEqual([
      `Approve $${(Number(op.terms!.new_total_cents) / 100).toFixed(2)}`,
      "Decline this change",
    ]);
  });

  it("asks which when two proposals wait, and a name picks one", async () => {
    await say("connect with Harborline");
    const started = await post(act, "/api/account", {
      action: "signin",
      company: bank,
      access: "write",
    });
    await consent(bank, started.data.url, BANK_WRITE);
    const transfer = await say("Transfer $500 from checking to savings.");
    expect(transfer.status).toBe(200);
    const page = await reload();
    const order = page.connections[0]!.operations[0]!;
    const total = `$${(Number(order.terms!.new_total_cents) / 100).toFixed(2)}`;
    expect(transfer.data.question.text).toBe(
      `Harborline Bank wants to move $500.00 from Operating checking to Reserve savings. It expires in 10 minutes. The ${total} change at Lantern Noodle Bar is waiting for you too. Which one should I approve: the $500.00 transfer at Harborline Bank or the ${total} change at Lantern Noodle Bar?`,
    );
    // Four buttons: approve and decline each.
    expect(transfer.data.question.choices).toHaveLength(4);
    // A bare yes doesn't say which: asked again, nothing sent.
    let from = net.seen.length;
    const which = await say("yes");
    expect(which.data.text).toBe(
      `Which one do you want to approve: the $500.00 transfer at Harborline Bank or the ${total} change at Lantern Noodle Bar? You can say the company or the amount.`,
    );
    expect(since(from)).toEqual([]);
    // "approve the Lantern one": Lantern's, sent as the card sends it.
    from = net.seen.length;
    const approved = await say("approve the Lantern one");
    expect(approved.status).toBe(200);
    expect(approved.data.text).toBe(
      `Done. You approved the ${total} change at Lantern Noodle Bar, and Lantern Noodle Bar has carried it out. The $500.00 transfer at Harborline Bank is still waiting for you. Shall I approve that one too?`,
    );
    const sent = at(from, food);
    expect(sent.map((r) => [r.method, new URL(r.url).pathname])).toContainEqual(
      ["POST", new URL(order.request!.url!).pathname],
    );
    expect(at(from, bank)).toEqual([]);
    const now = await reload();
    expect(now.connections[0]!.operations[0]).toMatchObject({
      state: "succeeded",
      approvedBy: { approver: "user" },
    });
    // "no" declines the transfer: nothing is sent to the bank.
    from = net.seen.length;
    const declined = await say("no");
    expect(declined.data.text).toBe(
      "Declined. I sent no approval to Harborline Bank, and nothing was done.",
    );
    expect(since(from)).toEqual([]);
    expect((await reload()).connections[1]!.operations[0]!.state).toBe(
      "declined",
    );
    expect(model.asked).toBe(0);
  });

  it("sends a typed approval as the same request a click sends", async () => {
    const approvals: Array<{
      approval: ReturnType<typeof parseApprovalHeader>;
      body: string;
      url: string;
      method: string;
      asked: { url: string; body: unknown };
    }> = [];
    for (const how of ["typed", "click"] as const) {
      const turn = await say("Transfer $25 from checking to savings.");
      const op = (await reload()).connections[1]!.operations.find(
        (o) => o.state === "proposed",
      )!;
      const from = net.seen.length;
      const done =
        how === "typed"
          ? await say("yes")
          : await post(act, "/api/account", {
              action: "approve",
              company: bank,
              id: op.operation_id,
              revision: op.revision,
            });
      expect(done.status).toBe(200);
      void turn;
      const request = at(from, bank).find((r) => r.headers["poppy-approval"])!;
      approvals.push({
        approval: parseApprovalHeader(request.headers["poppy-approval"]!),
        body: request.body,
        url: request.url,
        method: request.method,
        asked: op.request as { url: string; body: unknown },
      });
    }
    const [typed, click] = approvals as [
      (typeof approvals)[0],
      (typeof approvals)[0],
    ];
    for (const one of [typed, click]) {
      // Operations §6: the same method, target and content as the request
      // the Company answered with the proposal.
      expect(one.method).toBe("POST");
      expect(one.url).toBe(one.asked.url);
      expect(JSON.parse(one.body)).toEqual(one.asked.body);
      expect(one.approval).toMatchObject({ approver: "user" });
    }
    expect(new URL(typed.url).pathname).toBe(new URL(click.url).pathname);
    expect(Object.keys(typed.approval!).sort()).toEqual(
      Object.keys(click.approval!).sort(),
    );
    // Only how the User answered differs, as the approval says it.
    expect(typed.approval!.input_type).toBe("typed");
    expect(click.approval!.input_type).toBe("tap");
  });

  it("reads the answer before any model, which never approves", async () => {
    await say("Transfer $25 from checking to savings.");
    const before = model.asked;
    const from = net.seen.length;
    const approved = await say("ok, go ahead", {
      provider: "openai-compatible",
      apiKey: "sk-test-not-used",
    });
    expect(approved.status).toBe(200);
    expect(approved.data.text).toBe(
      "Done. You approved the $25.00 transfer at Harborline Bank, and Harborline Bank has carried it out.",
    );
    expect(model.asked).toBe(before);
    expect(at(from, bank).some((r) => r.headers["poppy-approval"])).toBe(true);
    // Any other message is an ordinary turn, and the model gets it (here
    // the short call that chooses the Company, before Iris asks which).
    await say("Transfer $25 from checking to savings.");
    const other = await say("what do you think about the weather?", {
      provider: "openai-compatible",
      apiKey: "sk-test-not-used",
    });
    expect(other.data.text).toMatch(/^Is this for /);
    expect(model.asked).toBeGreaterThan(before);
    // The proposal still waits, and the question went with that message.
    const waiting = (await reload()).connections[1]!.operations.filter(
      (o) => o.state === "proposed",
    );
    expect(waiting).toHaveLength(1);
    const from2 = net.seen.length;
    const late = await say("yes");
    expect(late.data.mode).toBe("own");
    expect(at(from2, bank).some((r) => r.headers["poppy-approval"])).toBe(
      false,
    );
  });

  it("asks before signing out, and signs out on yes", async () => {
    const asked = await say("sign out of Harborline");
    expect(asked.data.text).toBe(
      "Sign out of Harborline Bank? That revokes the access you gave me there, and what I read with your account will be gone from here.",
    );
    expect(asked.data.choices).toEqual([
      { label: "Sign out of Harborline Bank", answer: { signout: bank } },
    ]);
    const from = net.seen.length;
    const done = await say("yes");
    expect(done.data.text).toBe(
      "Done, you're signed out of Harborline Bank. The access you gave me there is revoked, and what I read with your account is gone from here.",
    );
    expect(at(from, bank).map((r) => new URL(r.url).pathname)).toEqual([
      "/oauth/revoke",
    ]);
    expect(at(from, food)).toEqual([]);
    const page = await reload();
    expect(page.connections.map((c) => c.signedIn)).toEqual([true, false]);
    expect(page.history.at(-1)!.content).toBe(done.data.text);
  });

  it("approves nothing once the terms the question named have run out", async () => {
    // A minute on, past the chat's own budget for one, and a new
    // conversation: the one above has used most of its turns.
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 61000 });
    conversation = "";
    conversation = (await post(discover, "/api/discover", { url: food }))
      .conversation!;
    const started = await post(act, "/api/account", {
      action: "signin",
      company: food,
      access: "write",
    });
    await consent(food, started.data.url, { write: "yes" });
    const turn = await say("Add 2 pork gyoza");
    expect(turn.data.question?.text).toMatch(/Shall I approve it\?$/);
    vi.setSystemTime(Date.now() + 11 * 60000);
    const from = net.seen.length;
    const late = await say("yes");
    expect(late.data.text).toBe(
      "This proposal has expired or was already handled. Nothing was submitted. Ask for the change again to get fresh terms.",
    );
    expect(since(from).some((r) => r.headers["poppy-approval"])).toBe(false);
    vi.useRealTimers();
  });
});
