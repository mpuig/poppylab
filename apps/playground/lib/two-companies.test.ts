/**
 * End to end, in process: one conversation with two of the lab's real
 * Companies, Lantern and Harborline. As in `standing-harborline.test.ts`,
 * only the network is replaced: DNS answers loopback and the pinned fetch
 * hands each request to the app at its origin, so discovery, Sessions,
 * sign-in and approvals are the real ones. No model: the demo's rules
 * answer.
 *
 * After each step the test reads what the page would get, and at the end
 * every request Iris made is checked: a token, a refresh token and a
 * Session header only ever went to the Company they were for.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
type App = {
  request: (url: string, init?: RequestInit) => Response | Promise<Response>;
};
const net = vi.hoisted(() => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("PAP_ALLOW_PRIVATE_NETWORK", "true");
  return {
    /** The Company at each origin. */
    apps: {} as Record<string, App>,
    cookies: new Map<string, string>(),
    /** Every request Iris sent: where, and everything it carried. */
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
// The undici that pap-client's pinned fetch imports (it isn't the
// playground's own dependency).
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
import * as harborline from "../../harborline/src/test-harness";
import * as lantern from "../../lantern/src/test-harness";
import { POST as discover } from "../app/api/discover/route";
import { GET as account, POST as act } from "../app/api/account/route";
import { GET as callback } from "../app/api/account/callback/route";
import { POST as chat } from "../app/api/chat/route";
import type { ConnectionView } from "./conversation-view";
import { loadRun, visitorOf } from "./runs";
import type { Operation } from "./runtime";

const agent = "http://localhost:3000";
const food = lantern.origin;
const bank = harborline.origin;
const noodles = { origin: food, name: "Lantern Noodle Bar" };
const harbor = { origin: bank, name: "Harborline Bank" };
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
/** What a reload of the page is answered. */
const reload = async () =>
  (
    await account(
      new Request(`${agent}/api/account?conversation=${conversation}`),
    )
  ).json() as Promise<{
    connections: ConnectionView[];
    former: Array<{ name: string }>;
    history: Array<{
      role: string;
      content: string;
      from?: { origin: string; name: string };
    }>;
    signedIn: boolean;
    url?: string;
  }>;
/** The requests made since `from`, by the Company each went to. */
const since = (from: number) => net.seen.slice(from).map((r) => r.origin);

/** The User on a Company's consent page: Elena allows what Iris asked. */
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
/** What Iris holds for each Company right now: read from the stored run. */
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

describe("One conversation with Lantern and Harborline, end to end", () => {
  /** Each Company's secrets as they were issued, for the last check. */
  const secrets: Record<string, Set<string>> = {
    [food]: new Set(),
    [bank]: new Set(),
  };
  const note = async () => {
    for (const [origin, connection] of Object.entries(await held()))
      for (const secret of [connection.token, connection.accountToken])
        if (secret) secrets[origin]!.add(secret);
  };
  let noodleOrder: Operation;
  let transfer: Operation;

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
    net.cookies.set("poppy_visitor", "t".repeat(43));
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("starts with Lantern, and asks it for the menu", async () => {
    const found = await post(discover, "/api/discover", { url: food });
    expect(found.status).toBe(200);
    conversation = found.conversation!;
    expect((await reload()).connections.map((c) => c.name)).toEqual([
      "Lantern Noodle Bar",
    ]);
    const from = net.seen.length;
    const menu = await post(chat, "/api/chat", {
      message: "What's on the menu?",
      provider: "demo",
    });
    expect(menu.status).toBe(200);
    expect(menu.data).toMatchObject({ from: noodles, signedIn: false });
    expect(menu.data.text).toContain("The company answered:");
    expect(menu.data.text).toContain("Matcha ice cream");
    expect(new Set(since(from))).toEqual(new Set([food]));
  });

  it("connects Harborline when the User types it, and sends neither Company anything of the other's", async () => {
    const from = net.seen.length;
    const typed = await post(chat, "/api/chat", {
      message: "connect with Harborline",
      provider: "demo",
      companies: true,
    });
    expect(typed.status).toBe(200);
    expect(typed.data.text).toBe(
      "Connected to Harborline Bank. It describes what it offers as “Fictional accounts, balances, transactions, cards, recipients, budgets, payment requests and owned-account transfers”. You can ask it something now. Signing in is offered when a request needs your account there.",
    );
    expect(typed.data).toMatchObject({ mode: "iris" });
    expect(typed.data).not.toHaveProperty("from");
    expect(
      typed.data.connections.map((c: ConnectionView) => [c.name, c.signedIn]),
    ).toEqual([
      ["Lantern Noodle Bar", false],
      ["Harborline Bank", false],
    ]);
    // Discovery only, at Harborline only: public documents, read with no
    // Session and no token.
    const requests = net.seen.slice(from);
    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests) {
      expect(request.origin).toBe(bank);
      expect(request.headers).not.toHaveProperty("poppy-session");
      expect(request.headers).not.toHaveProperty("authorization");
    }
    // A reload shows both, and what was said with the Company it was for.
    const page = await reload();
    expect(page.connections.map((c) => c.origin)).toEqual([food, bank]);
    expect(page.history.map((e) => e.from?.name)).toEqual([
      "Lantern Noodle Bar",
      "Lantern Noodle Bar",
      "Harborline Bank",
      "Harborline Bank",
    ]);
    // The page that shows one Company still gets the first one's state.
    expect(new URL(page.url!).origin).toBe(food);
  });

  it("refuses an account action that doesn't say which Company it is for", async () => {
    const from = net.seen.length;
    const refused = await post(act, "/api/account", { action: "signin" });
    expect(refused.status).toBe(400);
    expect(refused.data.code).toBe("company_required");
    expect(since(from)).toEqual([]);
  });

  it("signs in at both, with both sign-ins under way at once", async () => {
    const atFood = await post(act, "/api/account", {
      action: "signin",
      company: food,
      access: "write",
    });
    const atBank = await post(act, "/api/account", {
      action: "signin",
      company: bank,
      access: "write",
    });
    expect(atFood.status).toBe(200);
    expect(atBank.status).toBe(200);
    expect(new URL(atFood.data.url).origin).toBe(food);
    expect(new URL(atBank.data.url).origin).toBe(bank);
    expect(
      (await reload()).connections.map((c) => [c.signedIn, c.authPending]),
    ).toEqual([
      [false, true],
      [false, true],
    ]);
    // The bank's consent comes back first, then the restaurant's.
    const backFromBank = await consent(bank, atBank.data.url, {
      allow_cards_write: "yes",
      allow_transactions_write: "yes",
      allow_budgets_write: "yes",
      allow_payments_request: "yes",
      allow_transfers_request: "yes",
    });
    expect(
      (await callback(new Request(backFromBank))).headers.get("Location"),
    ).toBe("/playground/sign-in/done");
    const backFromFood = await consent(food, atFood.data.url, {
      write: "yes",
    });
    expect(
      (await callback(new Request(backFromFood))).headers.get("Location"),
    ).toBe("/playground/sign-in/done");
    const page = await reload();
    expect(
      page.connections.map((c) => [c.name, c.signedIn, c.authPending]),
    ).toEqual([
      ["Lantern Noodle Bar", true, false],
      ["Harborline Bank", true, false],
    ]);
    expect(page.connections[0]!.scopes).toContain("orders:write");
    expect(page.connections[1]!.scopes).toContain("transfers:request");
    await note();
    expect(secrets[food]!.size).toBe(2);
    expect(secrets[bank]!.size).toBe(2);
  });

  it("gets a proposal at each, each from the Company the turn names", async () => {
    let from = net.seen.length;
    const order = await post(chat, "/api/chat", {
      company: food,
      message: "Add a matcha ice cream to my order.",
      provider: "demo",
    });
    expect(order.status).toBe(200);
    expect(order.data).toMatchObject({ from: noodles, signedIn: true });
    expect(order.data.operations).toHaveLength(1);
    noodleOrder = order.data.operations[0];
    expect(new Set(since(from))).toEqual(new Set([food]));

    from = net.seen.length;
    const move = await post(chat, "/api/chat", {
      company: bank,
      message: "Transfer $25 from checking to savings.",
      provider: "demo",
    });
    expect(move.status).toBe(200);
    expect(move.data).toMatchObject({ from: harbor, signedIn: true });
    expect(move.data.operations).toHaveLength(1);
    transfer = move.data.operations[0];
    expect(transfer.terms).toMatchObject({ amount_cents: 2500 });
    expect(new Set(since(from))).toEqual(new Set([bank]));

    // The page gets each Company's proposal with that Company.
    const page = await reload();
    expect(
      page.connections.map((c) => c.operations.map((op) => op.operation_id)),
    ).toEqual([[noodleOrder.operation_id], [transfer.operation_id]]);
    // A message that names no Company goes where the last turn went.
    const next = await post(chat, "/api/chat", {
      message: "my account balances",
      provider: "demo",
    });
    expect(next.data.from).toEqual(harbor);
    await note();
  });

  it("approves the transfer at Harborline, and leaves Lantern's proposal waiting", async () => {
    // Found by Company and ID together: the bank's ID is no proposal of
    // the restaurant's.
    const wrong = await post(act, "/api/account", {
      action: "approve",
      company: food,
      id: transfer.operation_id,
      revision: transfer.revision,
    });
    expect(wrong.status).toBe(400);
    const from = net.seen.length;
    const approved = await post(act, "/api/account", {
      action: "approve",
      company: bank,
      id: transfer.operation_id,
      revision: transfer.revision,
    });
    expect(approved.status).toBe(200);
    expect(approved.data.operation).toMatchObject({
      state: "succeeded",
      approvedBy: { approver: "user" },
    });
    expect(new Set(since(from))).toEqual(new Set([bank]));
    const page = await reload();
    expect(page.connections[0]!.operations).toMatchObject([
      { operation_id: noodleOrder.operation_id, state: "proposed" },
    ]);
    expect(page.connections[1]!.operations).toMatchObject([
      { operation_id: transfer.operation_id, state: "succeeded" },
    ]);
  });

  it("removes Lantern: its grant is revoked there, and the conversation goes on with Harborline", async () => {
    await note();
    const from = net.seen.length;
    const removed = await post(act, "/api/account", {
      action: "remove",
      company: food,
    });
    expect(removed.status).toBe(200);
    expect(removed.data).toMatchObject({
      removed: noodles,
      revoked: true,
      trace: [
        "Account grant revoked · Lantern Noodle Bar removed from the conversation",
      ],
    });
    // One request: the revocation, at Lantern.
    expect(since(from)).toEqual([food]);
    expect(net.seen.at(-1)!.url).toBe(`${food}/oauth/revoke`);
    expect(
      removed.data.connections.map((c: ConnectionView) => [c.name, c.signedIn]),
    ).toEqual([["Harborline Bank", true]]);
    expect(removed.data.former).toMatchObject([{ ...noodles, operations: [] }]);
    // What Lantern showed signed out stays, under its name; what it
    // showed with the account is gone; Harborline's is all there.
    const page = await reload();
    expect(page.connections.map((c) => c.origin)).toEqual([bank]);
    expect(page.former.map((f) => f.name)).toEqual(["Lantern Noodle Bar"]);
    const words = page.history.map((e) => [e.from?.name, e.content]);
    expect(words[0]).toEqual(["Lantern Noodle Bar", "What's on the menu?"]);
    expect(words.map(([, content]) => content)).not.toContain(
      "Add a matcha ice cream to my order.",
    );
    expect(words.map(([, content]) => content)).toContain(
      "Transfer $25 from checking to savings.",
    );
    expect(new URL(page.url!).origin).toBe(bank);
    expect(page.signedIn).toBe(true);
    // Nothing of Lantern's sign-in is left in what Iris holds.
    const now = await held();
    expect(Object.keys(now)).toEqual([bank]);
    for (const secret of secrets[food]!)
      expect(JSON.stringify(now)).not.toContain(secret);
    // The revocation named Lantern's own refresh token, and no other.
    const revoked = new URLSearchParams(net.seen.at(-1)!.body).get("token")!;
    expect(secrets[food]!.has(revoked)).toBe(true);
    expect(secrets[bank]!.has(revoked)).toBe(false);
  });

  it("never sent one Company a token, a refresh token or a Session of the other's", () => {
    expect(net.seen.length).toBeGreaterThan(20);
    const other: Record<string, string> = { [food]: bank, [bank]: food };
    let sessions = 0;
    let tokens = 0;
    for (const request of net.seen) {
      expect([food, bank]).toContain(request.origin);
      const carried = JSON.stringify([request.headers, request.body]);
      for (const secret of secrets[other[request.origin]!]!)
        expect(carried, request.url).not.toContain(secret);
      for (const secret of secrets[request.origin]!)
        if (carried.includes(secret)) tokens++;
      // A Session header is signed for the Company it is sent to.
      const session = request.headers["poppy-session"];
      if (!session) continue;
      sessions++;
      const claims = JSON.parse(
        Buffer.from(session.split(".")[1]!, "base64url").toString(),
      ) as { aud: string; htu: string; sub: string };
      expect(claims.aud).toBe(request.origin);
      expect(new URL(claims.htu).origin).toBe(request.origin);
    }
    // The check looked at real ones: both were sent, to their own Company.
    expect(sessions).toBeGreaterThan(10);
    expect(tokens).toBeGreaterThan(4);
    // And each Company met the User under an ID of its own.
    const subjects = (origin: string) =>
      new Set(
        net.seen
          .filter((r) => r.origin === origin && r.headers["poppy-session"])
          .map(
            (r) =>
              (
                JSON.parse(
                  Buffer.from(
                    r.headers["poppy-session"]!.split(".")[1]!,
                    "base64url",
                  ).toString(),
                ) as { sub: string }
              ).sub,
          ),
      );
    expect(subjects(food).size).toBe(1);
    expect(subjects(bank).size).toBe(1);
    expect([...subjects(food)][0]).not.toBe([...subjects(bank)][0]);
  });
});
