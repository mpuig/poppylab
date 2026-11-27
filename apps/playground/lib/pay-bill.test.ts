/**
 * End to end, in process: demo mode's example across two Companies, "Pay
 * my Fernwick bill from checking.", against the real Fernwick and
 * Harborline apps. As in `two-companies.test.ts`, only the network is
 * replaced: DNS answers loopback and the pinned fetch hands each request
 * to the app at its origin, so discovery, Sessions, sign-in and the
 * proposal are the real ones. No model: the demo's script answers.
 *
 * It goes the way a person would: one Company missing, then signed out
 * at each, then without change permission at the bank, and at last the
 * proposal, approved. At the end every request Iris made is checked: a
 * token and a Session only ever went to the Company they were for, and
 * the bank got the bill's amount and reference and nothing else of the
 * User's Fernwick account.
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
      headers: Record<string, string>;
      body: string;
    }>,
  };
});
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
import { createIdentity } from "@poppy-lab/pap-client";
import * as fernwick from "../../fernwick/src/test-harness";
import * as harborline from "../../harborline/src/test-harness";
import { POST as discover } from "../app/api/discover/route";
import { GET as account, POST as act } from "../app/api/account/route";
import { GET as callback } from "../app/api/account/callback/route";
import { POST as chat } from "../app/api/chat/route";
import { loadRun, visitorOf } from "./runs";
import type { Operation } from "./runtime";

const agent = "http://localhost:3000";
const power = fernwick.origin;
const bank = harborline.origin;
const fern = { origin: power, name: "Fernwick Power & Light" };
const harbor = { origin: bank, name: "Harborline Bank" };
const ask = "Pay my Fernwick bill from checking.";
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
const say = () =>
  post(chat, "/api/chat", { message: ask, provider: "demo", companies: true });
const reload = async () =>
  (
    await account(
      new Request(`${agent}/api/account?conversation=${conversation}`),
    )
  ).json() as Promise<{
    history: Array<{
      role: string;
      content: string;
      from?: { name: string };
      using?: Array<{ name: string }>;
      steps?: Array<{ company?: string; args?: string; text: string }>;
    }>;
  }>;
/** The requests made since `from`. */
const since = (from: number) => net.seen.slice(from);
/** Account requests among them: what was asked of an account, or sent. */
const asked = (from: number) =>
  since(from)
    .filter((r) => new URL(r.url).pathname.startsWith("/api/account/"))
    .map(
      (r) =>
        `${r.origin === power ? "fernwick" : "harborline"} ${new URL(r.url).pathname}`,
    );

/** Elena on a Company's consent page, allowing what `form` ticks. */
async function consent(company: string, url: string, form: object) {
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
  return allowed.headers.get("location")!;
}
async function signIn(company: string, access: "read" | "write", form = {}) {
  const started = await post(act, "/api/account", {
    action: "signin",
    company,
    access,
  });
  expect(started.status).toBe(200);
  const back = await consent(company, started.data.url, form);
  expect((await callback(new Request(back))).headers.get("Location")).toBe(
    "/playground/sign-in/done",
  );
}
async function held() {
  const visitor = visitorOf({
    get: (name) =>
      net.cookies.has(name) ? { value: net.cookies.get(name)! } : undefined,
    set: () => undefined,
  })!;
  const run = (await loadRun(visitor, conversation))!.run;
  return Object.fromEntries(
    run.connections.map((c) => [new URL(c.url).origin, c]),
  );
}

describe("Pay my Fernwick bill from checking, in demo mode", () => {
  const secrets: Record<string, Set<string>> = {
    [power]: new Set(),
    [bank]: new Set(),
  };
  const note = async () => {
    for (const [origin, connection] of Object.entries(await held()))
      for (const secret of [connection.token, connection.accountToken])
        if (secret) secrets[origin]!.add(secret);
  };
  let payment: Operation;

  beforeAll(async () => {
    // Bills close on the 1st: the latest is October's, due 21 November.
    vi.useFakeTimers({
      toFake: ["Date"],
      now: new Date("2026-11-25T12:00:00Z"),
    });
    const keys = await createIdentity();
    vi.stubEnv("POPPY_IDENTITY", JSON.stringify(keys));
    const fetchJson = async (url: string) =>
      url.endsWith("client.json")
        ? {
            client_id: harborline.client,
            client_name: "Iris",
            jwks_uri: `${agent}/agent/jwks.json`,
            redirect_uris: [harborline.redirect],
          }
        : { keys: [keys.publicKey] };
    await fernwick.setup({ fetchJson });
    await harborline.setup({ fetchJson });
    net.apps[power] = fernwick.lab.app;
    net.apps[bank] = harborline.lab.app;
    net.cookies.set("poppy_visitor", "p".repeat(43));
  });
  afterAll(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("says Fernwick is missing, with a button to connect it, and sends nothing", async () => {
    const found = await post(discover, "/api/discover", { url: bank });
    expect(found.status).toBe(200);
    conversation = found.conversation!;
    const from = net.seen.length;
    const turn = await say();
    expect(turn.status).toBe(200);
    expect(turn.data).toMatchObject({
      mode: "iris",
      text: "This takes two companies: Fernwick Power & Light, where Iris reads your bill, and Harborline Bank, where it proposes the payment. Fernwick Power & Light isn't connected to this conversation yet. Connect it, sign in at both and ask again. Nothing was sent to any company.",
      choices: [
        { label: "Fernwick Power & Light", answer: { connect: power } },
      ],
    });
    expect(turn.data).not.toHaveProperty("from");
    expect(since(from)).toEqual([]);
    // The button connects it, as "connect with Fernwick" does.
    const pressed = await post(chat, "/api/chat", {
      answer: { connect: power },
      provider: "demo",
      companies: true,
    });
    expect(pressed.status).toBe(200);
    expect(
      pressed.data.connections.map((c: { origin: string }) => c.origin),
    ).toEqual([bank, power]);
  });

  it("asks for the sign-in at Fernwick first, and reads nothing", async () => {
    const from = net.seen.length;
    const turn = await say();
    expect(turn.status).toBe(200);
    expect(turn.data).toMatchObject({ mode: "demo", from: fern });
    expect(turn.data.using).toEqual([fern, harbor]);
    expect(turn.data.text).toBe(
      "Protocol demo (no LLM). Paying your Fernwick Power & Light bill from checking reads the bill at Fernwick Power & Light and proposes the payment at Harborline Bank, so it needs you signed in at both. Sign in to Fernwick Power & Light first, and then to Harborline Bank. Iris didn't read your bill or ask Harborline Bank for anything.",
    );
    // Iris stopped before the read: the step says so, at Fernwick.
    expect(turn.data.steps).toContainEqual(
      expect.objectContaining({
        text: "Did not send a request to /api/account/bills (sign-in needed)",
        company: power,
      }),
    );
    expect(asked(from)).toEqual([]);
  });

  it("asks for the sign-in at Harborline once Fernwick is signed in, and still reads nothing", async () => {
    // Elena shares both her meters, as the consent page ticks them.
    await signIn(power, "read", {
      "espi_meter_UP-E1": "yes",
      "espi_meter_UP-E2": "yes",
    });
    const from = net.seen.length;
    const turn = await say();
    expect(turn.data).toMatchObject({ mode: "demo", from: harbor });
    expect(turn.data.text).toBe(
      "Protocol demo (no LLM). Paying your Fernwick Power & Light bill from checking reads the bill at Fernwick Power & Light and proposes the payment at Harborline Bank, so it needs you signed in at both. Sign in to Harborline Bank too. Iris didn't read your bill or ask Harborline Bank for anything.",
    );
    expect(turn.data.steps).toContainEqual(
      expect.objectContaining({
        text: "Did not send a request to /api/account/accounts (sign-in needed)",
        company: bank,
      }),
    );
    expect(asked(from)).toEqual([]);
  });

  it("doesn't send the payment while the bank's sign-in can't propose it", async () => {
    await signIn(bank, "read");
    const from = net.seen.length;
    const turn = await say();
    expect(turn.data).toMatchObject({ from: harbor, operations: [] });
    expect(turn.data.text).toContain(
      "didn't send it to the Company: your access to this Company doesn't include the permission it needs. Press “Request change permission”",
    );
    expect(turn.data.steps).toContainEqual(
      expect.objectContaining({
        text: "Did not send a request to /api/account/payments (permission not granted)",
        company: bank,
      }),
    );
    expect(asked(from)).toEqual([
      "fernwick /api/account/bills",
      "harborline /api/account/accounts",
      "harborline /api/account/recipients",
    ]);
  });

  it("reads the bill at Fernwick and proposes its payment at Harborline, saying what it took", async () => {
    await signIn(bank, "write", {
      allow_payments_request: "yes",
      allow_transfers_request: "yes",
    });
    await note();
    const from = net.seen.length;
    const turn = await say();
    expect(turn.status).toBe(200);
    expect(turn.data).toMatchObject({ mode: "demo", from: harbor });
    expect(turn.data.using).toEqual([fern, harbor]);
    // What Fernwick answered, as "Data" keeps it, gives the amount.
    const data = JSON.parse(turn.data.data) as Array<{
      company: { name: string };
      tool: string;
      output: { bills?: Array<Record<string, unknown>> };
    }>;
    expect(data.map((d) => [d.company.name, d.tool])).toEqual([
      ["Fernwick Power & Light", "bills"],
      ["Harborline Bank", "accounts"],
      ["Harborline Bank", "recipients"],
      ["Harborline Bank", "request_payment"],
    ]);
    const october = data[0]!.output.bills!.filter((b) => b.id === "2026-10");
    expect(october.map((b) => b.meter)).toEqual(["Home", "EV charger"]);
    const total = october.reduce((sum, b) => sum + Number(b.total_cents), 0);
    const dollars = `$${(total / 100).toFixed(2)}`;
    expect(turn.data.text).toContain(
      `The demo read your latest bill at Fernwick Power & Light, for October 2026 and due on 21 November 2026, then your accounts and saved recipients at Harborline Bank, and asked Harborline Bank to pay Fernwick Power & Light ${dollars} from Operating checking.`,
    );
    // The one line of what crossed.
    expect(turn.data.text).toContain(
      `From Fernwick Power & Light, Iris sent Harborline Bank the bill's amount, ${dollars}, its reference, FPL-2041-7731-202610, and its month, October 2026, in the memo, and nothing else.`,
    );
    expect(turn.data.text).toContain(
      "The Company holds a change until you click Approve.",
    );
    // The proposal is Harborline's, with the bill's amount and reference.
    expect(turn.data.operations).toHaveLength(1);
    payment = turn.data.operations[0];
    expect(payment.terms).toMatchObject({
      recipient_id: "rcp_HLB_A503",
      recipient_name: "Fernwick Power & Light",
      source_account_id: "acc_HLB_A100",
      amount_cents: total,
      reference: "FPL-2041-7731-202610",
      memo: "Bill for October 2026",
    });
    // Every Company's state comes with it: the proposal is at Harborline.
    expect(
      turn.data.connections.map(
        (c: { origin: string; operations: unknown[] }) => [
          c.origin,
          c.operations.length,
        ],
      ),
    ).toEqual([
      [bank, 1],
      [power, 0],
    ]);
    expect(asked(from)).toEqual([
      "fernwick /api/account/bills",
      "harborline /api/account/accounts",
      "harborline /api/account/recipients",
      "harborline /api/account/payments",
    ]);
    // The bank got the amount, the reference and the month, and nothing
    // else of the Fernwick account: no address, meter or reading.
    const paid = since(from).find((r) =>
      r.url.endsWith("/api/account/payments"),
    )!;
    const body = JSON.parse(paid.body) as Record<string, unknown>;
    expect(body).toEqual({
      source_account_id: "acc_HLB_A100",
      recipient_id: "rcp_HLB_A503",
      amount_cents: total,
      memo: "Bill for October 2026",
      reference: "FPL-2041-7731-202610",
      idempotency_key: expect.any(String),
    });
    for (const request of since(from).filter((r) => r.origin === bank))
      for (const word of ["Bracken", "UP-E1", "UP-E2", "EV charger", "kwh"])
        expect(request.body).not.toContain(word);
    // "What Iris did" shows that call's arguments, at Harborline.
    const step = (
      turn.data.steps as Array<{
        text: string;
        company?: string;
        args?: string;
      }>
    ).find((s) => s.text === "Sent a request to /api/account/payments")!;
    expect(step.company).toBe(bank);
    expect(JSON.parse(step.args!)).toEqual(body);
    // A reload shows the same answer, with both Companies and the steps.
    const last = (await reload()).history.at(-1)!;
    expect(last.from?.name).toBe("Harborline Bank");
    expect(last.using?.map((c) => c.name)).toEqual([
      "Fernwick Power & Light",
      "Harborline Bank",
    ]);
    expect(last.steps).toEqual(turn.data.steps);
  });

  it("is approved at Harborline, its own card, and performed once", async () => {
    const from = net.seen.length;
    const approved = await post(act, "/api/account", {
      action: "approve",
      company: bank,
      id: payment.operation_id,
      revision: payment.revision,
    });
    expect(approved.status).toBe(200);
    expect(approved.data.operation).toMatchObject({ state: "succeeded" });
    expect(new Set(since(from).map((r) => r.origin))).toEqual(new Set([bank]));
  });

  it("never sent one Company a token or a Session of the other's", async () => {
    await note();
    const other: Record<string, string> = { [power]: bank, [bank]: power };
    let sessions = 0;
    for (const request of net.seen) {
      const carried = JSON.stringify([request.headers, request.body]);
      for (const secret of secrets[other[request.origin]!]!)
        expect(carried, request.url).not.toContain(secret);
      const session = request.headers["poppy-session"];
      if (!session) continue;
      sessions++;
      const claims = JSON.parse(
        Buffer.from(session.split(".")[1]!, "base64url").toString(),
      ) as { aud: string };
      expect(claims.aud).toBe(request.origin);
    }
    expect(sessions).toBeGreaterThan(10);
    expect(secrets[power]!.size).toBeGreaterThan(0);
    expect(secrets[bank]!.size).toBeGreaterThan(0);
  });
});
