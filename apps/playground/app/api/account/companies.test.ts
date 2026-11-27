/**
 * The account route for a conversation with several Companies: every
 * action names its Company, and a reload is answered each Company's own
 * state. The real runtime; only the network is replaced, so each test can
 * say which Company a request went to and what it carried.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
const transport = vi.hoisted(() =>
  vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>(),
);
const discover = vi.hoisted(() => vi.fn());
/** The Companies this playground may not sign in to. */
const policy = vi.hoisted(() => ({ noAccount: [] as string[] }));
vi.mock("@poppy-lab/pap-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@poppy-lab/pap-client")>()),
  protocolRequest: transport,
  discoverCompany: discover,
}));
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => {}),
  writeFile: vi.fn(async () => {}),
  readFile: vi.fn(async () => {
    throw Object.assign(new Error("fixture missing"), { code: "ENOENT" });
  }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name.includes("visitor") ? { value: "v".repeat(43) } : undefined,
    set: vi.fn(),
  }),
}));
vi.mock("@poppy-lab/pap-agent/deployment", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@poppy-lab/pap-agent/deployment")>()),
  serving: () => true,
  publicMode: () => false,
  isAccountCompany: (origin: string) => !policy.noAccount.includes(origin),
  proposalsAllowed: () => true,
}));
import { connected, discovered } from "@/lib/company-fixture";
import { keepLines } from "@/lib/inspector-log";
import { seedRun } from "@/lib/runs";
import type { Operation, Run } from "@/lib/runtime";
import { recordTurn } from "@/lib/transcript";
import { GET, POST } from "./route";

const shop = "https://shop.papsandbox.com";
const food = "https://food.example";
const names = { [shop]: "Juniper Market", [food]: "Lantern Noodle Bar" };
const expires = new Date(Date.now() + 600000).toISOString();
const proposal = (origin: string): Operation => ({
  operation_id: "op_1",
  revision: "r1",
  state: "proposed",
  summary: "A change",
  terms: {},
  expires_at: expires,
  request: { url: `${origin}/api/account/change`, body: {} },
});

let count = 0;
let id = "";
/** A conversation signed in at both, with a proposal at each under one ID. */
async function conversation(change: (run: Run) => void = () => {}) {
  const run: Run = {
    protocol: "1.0",
    visitor: "",
    expires: Date.now() + 3600000,
    calls: 0,
    busy: false,
    history: [],
    connections: [
      connected(shop, names[shop]),
      connected(food, names[food], "poppy:read poppy:write"),
    ],
  };
  const [a, b] = run.connections as [
    Run["connections"][0],
    Run["connections"][0],
  ];
  recordTurn(run, a, "When do you deliver?", "Tuesday and Saturday.");
  keepLines(run, a, ["GET /api/delivery · 200"], 1000);
  Object.assign(a, connected(shop, names[shop], "poppy:read poppy:write"));
  recordTurn(run, a, "my deliveries", "Elena's delivery is on Thursday.");
  recordTurn(run, b, "my orders", "Order 12 for Dana.");
  keepLines(run, b, ["GET /api/account/orders · 200"], 2000);
  a.operations = { op_1: proposal(shop) };
  b.operations = { op_1: proposal(food) };
  change(run);
  id = `run_companies_${String(++count).padStart(4, "0")}`;
  await seedRun("v".repeat(43), id, run);
  return run;
}
const act = (body: Record<string, unknown>, shown?: string) =>
  POST(
    new Request("http://localhost:3000/api/account", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        "Content-Type": "application/json",
        "X-Poppy-Conversation": id,
        // The Company the page shows, as a page with one Company sends it.
        ...(shown ? { "X-PAP-Company": shown } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
const reload = async () =>
  (
    await GET(
      new Request(`http://localhost:3000/api/account?conversation=${id}`),
    )
  ).json();
/** Every request made, as its address and what it carried. */
const sent = () =>
  transport.mock.calls.map(([url, init]) => ({
    url,
    carried: JSON.stringify(init ?? {}),
  }));

beforeEach(() => {
  policy.noAccount = [];
  transport.mockReset().mockImplementation(async (url) =>
    url.endsWith("/poppy/openapi.json")
      ? {
          servers: [{ url: new URL(url).origin }],
          paths: { "/api/products": { get: { operationId: "list_products" } } },
        }
      : { ok: true },
  );
  discover
    .mockReset()
    .mockImplementation(async (url: string) =>
      discovered(
        new URL(url).origin,
        names[new URL(url).origin as keyof typeof names],
      ),
    );
});

describe("an account action in a conversation with several Companies", () => {
  it("is refused when it doesn't say which Company it is for, and nothing happens", async () => {
    const run = await conversation();
    const before = structuredClone(run.connections);
    for (const action of ["signin", "signout", "approve", "decline", "fdx"]) {
      const refused = await act({ action, id: "op_1", revision: "r1" });
      expect(refused.status).toBe(400);
      expect(await refused.json()).toEqual({
        code: "company_required",
        error:
          "This conversation works with Juniper Market, Lantern Noodle Bar. Choose which one this is for.",
      });
    }
    // Nor does the Company the page shows, when it isn't one of them.
    const stale = await act(
      { action: "decline", id: "op_1", revision: "r1" },
      "https://bank.example",
    );
    expect((await stale.json()).code).toBe("company_required");
    expect(run.connections).toEqual(before);
    expect(transport).not.toHaveBeenCalled();
    expect(run.busy).toBe(false);
  });

  it("takes the Company the page shows for one that names none, as a page with one Company sends it", async () => {
    const run = await conversation();
    const declined = await act(
      { action: "decline", id: "op_1", revision: "r1" },
      `${food}/`,
    );
    expect(declined.status).toBe(200);
    expect(run.connections[1]!.operations!.op_1!.state).toBe("declined");
    expect(run.connections[0]!.operations!.op_1!.state).toBe("proposed");
    // What the request says in `company` comes first.
    const out = await act({ action: "signout", company: shop }, food);
    expect(out.status).toBe(200);
    expect(run.connections[0]!.accountToken).toBeUndefined();
    expect(run.connections[1]!.accountToken).toBe("refresh-food.example");
  });

  it("is refused for a Company the conversation isn't connected to", async () => {
    await conversation();
    for (const company of ["https://bank.example", 7, ""]) {
      const refused = await act({ action: "signout", company });
      expect(refused.status).toBe(400);
      expect(await refused.json()).toEqual({
        code: "company_not_connected",
        error: "This conversation isn't connected to that company.",
      });
    }
    expect(transport).not.toHaveBeenCalled();
  });

  it("finds a proposal by its Company and its ID together", async () => {
    const run = await conversation();
    const declined = await act({
      action: "decline",
      // Any address at the Company's origin names it.
      company: `${food}/menu`,
      id: "op_1",
      revision: "r1",
    });
    expect(declined.status).toBe(200);
    expect(run.connections[1]!.operations!.op_1!.state).toBe("declined");
    // The other Company's proposal has the same ID and still waits.
    expect(run.connections[0]!.operations!.op_1).toEqual(proposal(shop));
    expect(transport).not.toHaveBeenCalled();
  });

  it("signs out at the Company it names, with that Company's token and no other's", async () => {
    const run = await conversation();
    const out = await act({ action: "signout", company: shop });
    expect(out.status).toBe(200);
    const body = await out.json();
    expect(body).toMatchObject({
      signedIn: false,
      trace: ["Account grant revoked · Session signed out"],
    });
    // One request, to Juniper's own revocation endpoint, with its token.
    expect(sent()).toHaveLength(1);
    expect(sent()[0]!.url).toBe(`${shop}/oauth/revoke`);
    expect(sent()[0]!.carried).toContain("refresh-shop.papsandbox.com");
    expect(sent()[0]!.carried).not.toMatch(/food\.example/);
    const [a, b] = run.connections;
    expect(a!.accountToken).toBeUndefined();
    expect(a!.operations).toEqual({});
    expect(b!.accountToken).toBe("refresh-food.example");
    expect(b!.operations!.op_1).toEqual(proposal(food));
    // What the conversation still shows comes with the answer: the other
    // Company's, each entry and line saying where it came from.
    const lantern = { origin: food, name: "Lantern Noodle Bar" };
    expect(body.history).toEqual([
      { role: "user", content: "my orders", from: lantern },
      { role: "assistant", content: "Order 12 for Dana.", from: lantern },
    ]);
    expect(body.log).toEqual([
      { at: 2000, text: "GET /api/account/orders · 200", from: lantern },
    ]);
    // The line of the sign-out itself is kept after it, as Juniper's.
    expect((await reload()).log.at(-1)).toMatchObject({
      text: "Account grant revoked · Session signed out",
      from: { origin: shop, name: "Juniper Market" },
    });
  });

  it("starts a sign-in at the Company it names, and at no other", async () => {
    const run = await conversation();
    const started = await act({ action: "signin", company: food });
    const answer = await started.json();
    expect(answer).not.toHaveProperty("error");
    expect(new URL(answer.url).origin).toBe(food);
    expect(run.connections[1]!.auth).toMatchObject({ issuer: food });
    expect(run.connections[0]!.auth).toBeUndefined();
    // Nothing of Juniper's went to Lantern, and nothing was sent to Juniper.
    for (const request of sent()) {
      expect(new URL(request.url).origin).toBe(food);
      expect(request.carried).not.toMatch(/shop\.papsandbox\.com/);
    }
  });

  it("still takes an action that names no Company when there is one, as a page that shows one sends it", async () => {
    const run = await conversation((r) => r.connections.shift());
    const declined = await act({
      action: "decline",
      id: "op_1",
      revision: "r1",
    });
    expect(declined.status).toBe(200);
    expect(run.connections[0]!.operations!.op_1!.state).toBe("declined");
  });

  it("is refused in a conversation that has no Company", async () => {
    await conversation((r) => r.connections.splice(0));
    const refused = await act({ action: "signout" });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({
      code: "no_company",
      error:
        "This conversation isn't connected to a company. Connect one first.",
    });
  });
});

describe("removing a Company from a conversation", () => {
  const juniper = { origin: shop, name: "Juniper Market" };
  const lantern = { origin: food, name: "Lantern Noodle Bar" };
  const remove = (company: string) => act({ action: "remove", company });

  it("revokes its grant there, as sign-out does, and goes on with the others", async () => {
    const run = await conversation();
    const other = structuredClone(run.connections[1]);
    const removed = await remove(shop);
    expect(removed.status).toBe(200);
    const body = await removed.json();
    // One request, to Juniper's own revocation endpoint, with its token.
    expect(sent()).toHaveLength(1);
    expect(sent()[0]!.url).toBe(`${shop}/oauth/revoke`);
    expect(sent()[0]!.carried).toContain("refresh-shop.papsandbox.com");
    expect(sent()[0]!.carried).not.toMatch(/food\.example/);
    expect(body).toMatchObject({
      removed: juniper,
      revoked: true,
      trace: [
        "Account grant revoked · Juniper Market removed from the conversation",
      ],
      former: [{ ...juniper, url: shop, operations: [] }],
    });
    expect(body).not.toHaveProperty("notice");
    // The conversation's Companies now, for the page to show.
    expect(body.connections).toHaveLength(1);
    expect(body.connections[0]).toMatchObject({ ...lantern, signedIn: true });
    // What was shown with Juniper's account is gone; what was shown signed
    // out stays, still saying where it came from.
    expect(
      body.history.map((e: { content: string; from: unknown }) => [
        e.content,
        e.from,
      ]),
    ).toEqual([
      ["When do you deliver?", juniper],
      ["Tuesday and Saturday.", juniper],
      ["my orders", lantern],
      ["Order 12 for Dana.", lantern],
    ]);
    expect(body.log.map((l: { text: string }) => l.text)).toEqual([
      "GET /api/delivery · 200",
      "GET /api/account/orders · 200",
    ]);
    // Nothing of Juniper's Session or sign-in is left in what is stored.
    expect(run.connections).toEqual([other]);
    expect(JSON.stringify(run)).not.toMatch(/refresh-shop|access-shop|Elena/);
    expect(run.busy).toBe(false);
    // The line of the removal is kept, and names no account data.
    expect((await reload()).log.at(-1)).toEqual({
      at: expect.any(Number),
      text: body.trace[0],
      signedOut: true,
      from: juniper,
    });
  });

  it("still removes a Company that can't be reached, and says its grant wasn't revoked", async () => {
    const run = await conversation();
    transport.mockRejectedValue(new Error("connect ECONNREFUSED"));
    const removed = await remove(shop);
    expect(removed.status).toBe(200);
    expect(await removed.json()).toMatchObject({
      removed: juniper,
      revoked: false,
      notice:
        "Juniper Market couldn't be reached, so the access you gave Iris there wasn't revoked. You can end that access on Juniper Market's own website.",
      trace: [
        "Account grant not revoked · the Company could not be reached · Juniper Market removed from the conversation",
      ],
    });
    expect(run.connections.map((c) => c.url)).toEqual([food]);
    expect(JSON.stringify(run)).not.toMatch(/refresh-shop|access-shop/);
  });

  it("sends nothing for a Company that isn't signed in", async () => {
    const run = await conversation((r) => {
      const a = r.connections[0]!;
      delete a.accountToken;
      delete a.token;
      delete a.scopes;
    });
    const body = await (await remove(shop)).json();
    expect(body).toMatchObject({
      removed: juniper,
      trace: ["Juniper Market removed from the conversation"],
    });
    expect(body).not.toHaveProperty("revoked");
    expect(transport).not.toHaveBeenCalled();
    expect(run.connections).toHaveLength(1);
  });

  it("is refused while an approval sent there has an unknown outcome, and nothing is sent or removed", async () => {
    const run = await conversation((r) => {
      Object.assign(r.connections[0]!.operations!.op_1!, {
        state: "uncertain",
        approval: { approved_at: 1, reference: "apr_1" },
      });
    });
    const sentThere = run.connections[0]!.operations!.op_1!;
    const refused = await remove(shop);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({
      code: "approval_unsettled",
      error:
        "An approval sent to Juniper Market has an unknown outcome, so Juniper Market can't be removed yet. Retry that approval first: it is performed at most once. Without Juniper Market there would be no way to retry it, and the same change could be asked for twice.",
      operations: [structuredClone(sentThere)],
    });
    expect(transport).not.toHaveBeenCalled();
    expect(run.connections).toHaveLength(2);
    expect(run.connections[0]!.accountToken).toBe(
      "refresh-shop.papsandbox.com",
    );
    expect(run.busy).toBe(false);
    // The other Company isn't held back by it.
    expect((await remove(food)).status).toBe(200);
    // Once the retry settled it, Juniper can go.
    sentThere.state = "succeeded";
    expect((await remove(shop)).status).toBe(200);
    expect(run.connections).toEqual([]);
    expect(run.former).toEqual([
      { url: food, name: "Lantern Noodle Bar" },
      { url: shop, name: "Juniper Market" },
    ]);
  });

  it("has to say which Company, like every action", async () => {
    const run = await conversation();
    const refused = await act({ action: "remove" });
    expect(refused.status).toBe(400);
    expect((await refused.json()).code).toBe("company_required");
    expect(run.connections).toHaveLength(2);
  });

  it("removes a Company this playground may not sign in to", async () => {
    const run = await conversation();
    policy.noAccount = [shop, food];
    expect((await act({ action: "signout", company: food })).status).toBe(400);
    expect((await remove(food)).status).toBe(200);
    expect(run.connections.map((c) => c.url)).toEqual([shop]);
  });

  it("leaves a conversation with no Company, and its words, when the last one goes", async () => {
    const run = await conversation();
    await remove(food);
    const last = await (await remove(shop)).json();
    expect(last.connections).toEqual([]);
    expect(last.former.map((f: { name: string }) => f.name)).toEqual([
      "Lantern Noodle Bar",
      "Juniper Market",
    ]);
    expect(run.connections).toEqual([]);
    const data = await reload();
    expect(data.missing).toBe(false);
    expect(data.history.map((e: { content: string }) => e.content)).toEqual([
      "When do you deliver?",
      "Tuesday and Saturday.",
    ]);
  });
});

describe("a reload of a conversation with several Companies", () => {
  it("is answered each Company's own state, and each entry and line with the Company it came from", async () => {
    const run = await conversation((r) => {
      r.connections[0]!.consentVersion = 2;
      r.connections[1]!.fdx = true;
      r.former = [
        {
          url: "https://bank.example/",
          name: "Harborline Bank",
          operations: {
            sent: { ...proposal("https://bank.example"), state: "uncertain" },
          },
        },
      ];
    });
    const data = await reload();
    const juniper = { origin: shop, name: "Juniper Market" };
    const lantern = { origin: food, name: "Lantern Noodle Bar" };
    expect(data.connections).toHaveLength(2);
    expect(data.connections[0]).toMatchObject({
      ...juniper,
      url: shop,
      company: { document: { organization: { name: "Juniper Market" } } },
      signedIn: true,
      scopes: "poppy:read poppy:write",
      authPending: false,
      consentVersion: 2,
      fdx: false,
      espi: false,
      directConversation: { direct: false, conversation: false },
      operations: [proposal(shop)],
      excludedTasks: [],
      skills: [],
    });
    expect(data.connections[1]).toMatchObject({
      ...lantern,
      url: food,
      signedIn: true,
      consentVersion: 0,
      fdx: true,
      operations: [proposal(food)],
    });
    // A Company that left: its name, and the approval it left unanswered.
    expect(data.former).toEqual([
      {
        origin: "https://bank.example",
        name: "Harborline Bank",
        url: "https://bank.example/",
        operations: [
          { ...proposal("https://bank.example"), state: "uncertain" },
        ],
      },
    ]);
    expect(
      data.history.map((e: { content: string; from: unknown }) => [
        e.content,
        e.from,
      ]),
    ).toEqual([
      ["When do you deliver?", juniper],
      ["Tuesday and Saturday.", juniper],
      ["my deliveries", juniper],
      ["Elena's delivery is on Thursday.", juniper],
      ["my orders", lantern],
      ["Order 12 for Dana.", lantern],
    ]);
    expect(data.log.map((l: { from: unknown }) => l.from)).toEqual([
      juniper,
      lantern,
    ]);
    // Nothing the page gets says whose account an entry holds, or any
    // token, key or Session.
    expect(JSON.stringify(data)).not.toMatch(
      /"accounts"|refresh-|access-|sessionKey/,
    );
    // The members a page with one Company reads are the first one's.
    for (const member of Object.keys(data.connections[0]).filter(
      (key) => key !== "origin" && key !== "name",
    ))
      expect(data[member]).toEqual(data.connections[0][member]);
    expect(run.connections).toHaveLength(2);
  });

  it("is answered no Company for a conversation that has none, with its words", async () => {
    await conversation((r) => {
      r.connections.splice(0);
      r.former = [
        { url: shop, name: "Juniper Market" },
        { url: food, name: "Lantern Noodle Bar" },
      ];
    });
    const data = await reload();
    expect(data).toMatchObject({
      missing: false,
      connections: [],
      signedIn: false,
      operations: [],
    });
    expect(data.company).toBeUndefined();
    expect(data.history).toHaveLength(6);
    expect(data.history[0].from).toEqual({
      origin: shop,
      name: "Juniper Market",
    });
  });
});
