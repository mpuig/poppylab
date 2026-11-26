import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
const s = vi.hoisted(() => {
  /** The conversation's one Company: the sign-in the callback completes. */
  const connection = {
    url: "https://food.papsandbox.com",
    user: "usr_food",
    operations: { old: {} } as Record<string, unknown>,
    accountToken: "old-refresh" as string | undefined,
    token: undefined as string | undefined,
    scopes: undefined as string | undefined,
    publicHistory: undefined as
      Array<{ role: "user" | "assistant"; content: string }> | undefined,
    dpop: undefined as object | undefined,
    sessionId: "session_1",
    consentVersion: 0,
    auth: undefined as
      | undefined
      | {
          state: string;
          verifier: string;
          issuer: string;
          scopes: string;
          expires: number;
          dpop?: object;
        },
  };
  return {
    connection,
    /** The conversation, as the callback finds it stored. */
    run: {
      protocol: "1.0",
      expires: Date.now() + 60000,
      busy: false,
      history: [{ role: "user", content: "Previous account data" }] as Array<{
        role: "user" | "assistant";
        content: string;
      }>,
      connections: [connection],
    },
    request: vi.fn(),
    /** The Company's answer to a request Iris sends at the connection. */
    pap: vi.fn(),
    revoke: vi.fn(async () => undefined),
    set: vi.fn(),
    remove: vi.fn(),
    dpop: true,
  };
});
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => ({
      value: name.includes("visitor") ? "v".repeat(43) : "state_test",
    }),
    set: s.set,
    delete: s.remove,
  }),
}));
vi.mock("@/lib/runtime", () => {
  return {
    identity: async () => ({ privateKey: {} }),
    clientFor: () => "https://identity.example/agent/client.json",
    agentFor: () => "https://identity.example",
    localOrigins: [],
    accountConfiguration: () => ({
      issuer: "https://food.papsandbox.com",
      token_endpoint: "https://food.papsandbox.com/oauth/token",
    }),
    usesDpop: () => s.dpop,
    newSession: (connection: { sessionId?: string }) => {
      connection.sessionId = `new_${Math.random()}`;
    },
    revokeRefreshToken: s.revoke,
    papRequest: s.pap,
  };
});
vi.mock("@poppy-lab/pap-client", async (original) => ({
  ...(await original<typeof import("@poppy-lab/pap-client")>()),
  assertion: async () => "assertion_test",
  proof: async () => "proof_test",
  protocolRequest: s.request,
}));
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => {}),
  writeFile: vi.fn(async () => {}),
  readFile: vi.fn(async () => {
    throw Object.assign(new Error("fixture"), { code: "ENOENT" });
  }),
}));
vi.mock("@/lib/deployment", () => ({
  serving: () => process.env.NODE_ENV === "development",
  publicMode: () => false,
  isAccountCompany: (origin: string) =>
    ["http://juniper.localhost:4100", "https://food.papsandbox.com"].includes(
      origin,
    ),
  proposalsAllowed: () => true,
  localOrigins: ["http://juniper.localhost:4100"],
}));
import { GET } from "./route";
import { listConversations, seedRun, visitorOf } from "@/lib/runs";
import { directState } from "@/lib/direct-state";
import { ProtocolError } from "@poppy-lab/pap-client";
beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "development");
  s.run.busy = false;
  await seedRun("v".repeat(43), "run_fixture_0001", s.run as never);
  s.request.mockReset();
  s.revoke.mockClear();
  s.set.mockReset();
  s.dpop = true;
  Object.assign(s.run, {
    busy: false,
    history: [{ role: "user", content: "Previous account data" }],
  });
  Object.assign(s.connection, {
    accountToken: "old-refresh",
    token: undefined,
    scopes: undefined,
    publicHistory: undefined,
    operations: { old: {} },
    sessionId: "session_1",
    consentVersion: 0,
    dpop: undefined,
  });
  s.connection.auth = {
    state: "state_test",
    verifier: "verifier_test",
    issuer: "https://food.papsandbox.com",
    scopes: "orders:read",
    expires: Date.now() + 60000,
    dpop: { kty: "EC" },
  };
});
const req = (iss = "https://food.papsandbox.com", state = "state_test") =>
  new Request(
    "http://localhost:3000/api/account/callback?" +
      new URLSearchParams({ code: "code_test", state, iss }),
  );
/** Where the tab is sent: the address says how the sign-in went. */
const DONE = "/playground/sign-in/done",
  FAILED = "/playground/sign-in/failed";
const landed = async (request = req()) =>
  (await GET(request)).headers.get("Location");
const success = (extra: Record<string, unknown> = {}) => ({
  access_token: "new-access",
  refresh_token: "new-refresh",
  token_type: "DPoP",
  expires_in: 3600,
  ...extra,
});

it("exchanges the code with PKCE, no session_id, and starts a new Session", async () => {
  s.request.mockResolvedValue(success());
  expect(await landed()).toBe(DONE);
  const [url, init] = s.request.mock.calls[0]!;
  expect(url).toBe("https://food.papsandbox.com/oauth/token");
  const form = new URLSearchParams(init.body);
  expect(form.get("grant_type")).toBe("authorization_code");
  expect(form.get("code_verifier")).toBe("verifier_test");
  expect(form.get("redirect_uri")).toBe(
    "https://identity.example/api/account/callback",
  );
  expect(form.has("session_id")).toBe(false);
  expect(init.headers.DPoP).toBe("proof_test");
  // §4.7: scope omitted means exactly the requested scopes.
  expect(s.connection.scopes).toBe("orders:read");
  expect(s.connection.token).toBe("new-access");
  expect(s.connection.accountToken).toBe("new-refresh");
  expect(s.connection.sessionId).not.toBe("session_1");
  expect(s.connection.operations).toEqual({});
  expect(s.connection.consentVersion).toBe(1);
  // The replaced refresh token is revoked (best effort), not reused.
  expect(s.revoke).toHaveBeenCalledWith(s.connection, "old-refresh");
  expect(s.connection.auth).toBeUndefined();
});

it("keeps the FDX-shaped consent id of the grant, and drops an earlier one when there is none (poppylab.dev/fdx v1)", async () => {
  const connection = s.connection as typeof s.connection & {
    fdxConsent?: string;
  };
  s.request.mockResolvedValue(success({ consent_id: "grant_7Hk2" }));
  expect(await landed()).toBe(DONE);
  expect(connection.fdxConsent).toBe("grant_7Hk2");
  // A base64url grant ID may start with - or _: kept.
  for (const consent_id of ["-Hk2_a", "_Hk2-a"]) {
    s.connection.auth = {
      state: "state_test",
      verifier: "verifier_test",
      issuer: "https://food.papsandbox.com",
      scopes: "orders:read",
      expires: Date.now() + 60000,
      dpop: { kty: "EC" },
    };
    s.request.mockResolvedValue(success({ consent_id }));
    expect(await landed()).toBe(DONE);
    expect(connection.fdxConsent).toBe(consent_id);
  }
  // Not one path segment: not kept.
  for (const consent_id of [undefined, "../grant", ".", 7]) {
    connection.fdxConsent = "grant_old";
    s.connection.auth = {
      state: "state_test",
      verifier: "verifier_test",
      issuer: "https://food.papsandbox.com",
      scopes: "orders:read",
      expires: Date.now() + 60000,
      dpop: { kty: "EC" },
    };
    s.request.mockResolvedValue(success({ consent_id }));
    expect(await landed()).toBe(DONE);
    expect(connection.fdxConsent).toBeUndefined();
  }
});

it("keeps the ESPI-shaped subscription and authorization URIs that fit the entry, and drops earlier ones (poppylab.dev/espi v1)", async () => {
  const RE = "https://food.papsandbox.com/espi/1_1/resource";
  const connection = s.connection as typeof s.connection & {
    company?: unknown;
    espiResourceUri?: string;
    espiAuthorizationUri?: string;
  };
  const sign = async (fields: Record<string, unknown>) => {
    s.connection.auth = {
      state: "state_test",
      verifier: "verifier_test",
      issuer: "https://food.papsandbox.com",
      scopes: "orders:read",
      expires: Date.now() + 60000,
      dpop: { kty: "EC" },
    };
    s.request.mockResolvedValue(success(fields));
    expect((await GET(req())).status).toBe(303);
  };
  connection.company = {
    profile: {
      extensions: {
        "poppylab.dev/espi": { version: "1", resource_endpoint: RE },
      },
    },
  };
  try {
    await sign({
      resourceURI: `${RE}/Batch/Subscription/grant_7Hk2`,
      authorizationURI: `${RE}/Authorization/grant_7Hk2`,
    });
    expect(connection.espiResourceUri).toBe(
      `${RE}/Batch/Subscription/grant_7Hk2`,
    );
    expect(connection.espiAuthorizationUri).toBe(
      `${RE}/Authorization/grant_7Hk2`,
    );
    // Elsewhere, or not exactly the shape: not kept, and the earlier gone.
    await sign({
      resourceURI:
        "https://evil.example/espi/1_1/resource/Batch/Subscription/g",
      authorizationURI: `${RE}/Authorization/grant_7Hk2/../x`,
    });
    expect(connection.espiResourceUri).toBeUndefined();
    expect(connection.espiAuthorizationUri).toBeUndefined();
  } finally {
    delete connection.company;
  }
});

it("forgets the per-service tokens of the sign-in it replaces (§4.5)", async () => {
  const connection = s.connection as { resourceTokens?: unknown };
  const cached = {
    "https://food.papsandbox.com/api": {
      value: "old-service-token",
      type: "DPoP",
      expires: Date.now() + 3600000,
    },
  };
  try {
    // A failed exchange keeps the previous access, and so its tokens.
    connection.resourceTokens = structuredClone(cached);
    s.request.mockResolvedValueOnce(success({ refresh_token: undefined }));
    expect(await landed()).toBe(FAILED);
    expect(connection.resourceTokens).toEqual(cached);
    // They were issued to the old sign-in's account, scopes and DPoP key.
    s.connection.auth = {
      state: "state_test",
      verifier: "verifier_test",
      issuer: "https://food.papsandbox.com",
      scopes: "orders:read",
      expires: Date.now() + 60000,
      dpop: { kty: "EC" },
    };
    s.request.mockResolvedValueOnce(success());
    expect(await landed()).toBe(DONE);
    expect(connection.resourceTokens).toBeUndefined();
  } finally {
    delete connection.resourceTokens;
  }
});

it("uses Bearer tokens when the issuer doesn't bind DPoP", async () => {
  s.dpop = false;
  s.request.mockResolvedValue(success({ token_type: "Bearer" }));
  expect(await landed()).toBe(DONE);
  expect(s.request.mock.calls[0]![1].headers).not.toHaveProperty("DPoP");
  expect(s.connection.token).toBe("new-access");
});

it.each([
  ["a broader grant", { scope: "orders:read orders:write" }],
  ["a missing refresh token", { refresh_token: undefined }],
  ["an unexpected token type", { token_type: "Bearer" }],
])("rejects %s and keeps the previous access", async (_name, extra) => {
  s.request.mockResolvedValue(success(extra));
  const before = structuredClone({
    token: s.connection.token,
    refresh: s.connection.accountToken,
    history: s.run.history,
    session: s.connection.sessionId,
  });
  expect(await landed()).toBe(FAILED);
  expect({
    token: s.connection.token,
    refresh: s.connection.accountToken,
    history: s.run.history,
    session: s.connection.sessionId,
  }).toEqual(before);
  expect(s.revoke).not.toHaveBeenCalled();
});

it("preserves the public conversation on first sign-in", async () => {
  s.connection.accountToken = undefined;
  const publicTurns = [
    { role: "user" as const, content: "When do you deliver?" },
    { role: "assistant" as const, content: "Tuesday, Thursday and Saturday." },
  ];
  s.run.history = structuredClone(publicTurns);
  s.request.mockResolvedValue(success());
  expect(await landed()).toBe(DONE);
  expect(s.run.history).toEqual(publicTurns);
  expect(s.connection.publicHistory).toEqual(publicTurns);
  expect(s.revoke).not.toHaveBeenCalled();
});

it("retains only pre-account turns on later consent, never another account's context", async () => {
  s.connection.publicHistory = [
    { role: "user", content: "When do you deliver?" },
  ];
  s.run.history = [
    ...s.connection.publicHistory,
    { role: "assistant", content: "Private order details" },
  ];
  s.request.mockResolvedValue(success());
  expect(await landed()).toBe(DONE);
  expect(JSON.stringify(s.run.history)).not.toContain("Private order");
});

/**
 * A Company that keeps §8.2 for a conversation `owner`'s account has used
 * (none: no account has), given the account each access token is for. It
 * answers the events, a challenge, or `conversation_not_found`. Returns who
 * asked, in order: the access token sent, or "signed out".
 */
function companyKeeping(
  owner: string | undefined,
  accounts: Record<string, string>,
) {
  const asked: string[] = [];
  s.pap.mockImplementation(
    async (
      r: { token?: string },
      _url: string,
      _method: string,
      _body: unknown,
      options?: { signedOut?: boolean },
    ) => {
      const token = options?.signedOut ? undefined : r.token;
      asked.push(token ?? "signed out");
      const account = token ? accounts[token] : undefined;
      if (owner && !account) throw new ProtocolError(401, undefined);
      if (owner && account !== owner)
        throw new ProtocolError(404, "conversation_not_found");
      return { conversation_id: "cnv_1", events: [] };
    },
  );
  return asked;
}

describe("the conversation with the Company's agent across a sign-in (§8.2)", () => {
  const endpoint = "https://food.papsandbox.com/poppy/conversations";
  const connection = s.connection as typeof s.connection & {
    conversation?: unknown;
  };
  // The User is in a Direct Conversation, and the Company had asked again.
  const open = () => ({
    endpoint,
    id: "cnv_1",
    cursor: "evt_9",
    seen: ["evt_9"],
    invitation: { event: "evt_ur", reason: "About order ord_LNB0907" },
    direct: { id: "cnv_d", cursor: "evt_d3", seen: ["evt_d3"] },
  });
  beforeEach(() => {
    s.pap.mockReset();
    connection.conversation = open();
    s.request.mockResolvedValue(success());
  });
  afterEach(() => {
    delete connection.conversation;
  });

  it("keeps it for the same account: the Company still takes the new sign-in on both threads", async () => {
    s.connection.token = "old-access";
    const asked = companyKeeping("elena", {
      "old-access": "elena",
      "new-access": "elena",
    });
    expect(await landed()).toBe(DONE);
    expect(connection.conversation).toEqual(open());
    // Reads that change nothing here. First whether it has used the
    // account of the sign-in being replaced, then with the new sign-in.
    expect(asked).toEqual([
      "signed out",
      "old-access",
      "new-access",
      "new-access",
    ]);
    expect(s.pap.mock.calls.map((call) => call.slice(1, 3))).toEqual([
      [`${endpoint}/cnv_1/events?cursor=evt_9`, "GET"],
      [`${endpoint}/cnv_1/events?cursor=evt_9`, "GET"],
      [`${endpoint}/cnv_1/events?cursor=evt_9`, "GET"],
      [`${endpoint}/cnv_d/events?cursor=evt_d3`, "GET"],
    ]);
    expect(directState(s.connection as never).direct).toBe(true);
  });

  it("keeps one that no account has used, asking only with the new sign-in", async () => {
    s.connection.token = "old-access";
    const asked = companyKeeping(undefined, {});
    expect(await landed()).toBe(DONE);
    expect(connection.conversation).toEqual(open());
    // Never with the sign-in being replaced: that would make the
    // conversation its account's, and another account's sign-in lose it.
    expect(asked).toEqual(["signed out", "new-access", "new-access"]);
  });

  it.each([
    [
      "says it belongs to another account",
      new ProtocolError(404, "conversation_not_found"),
    ],
    ["doesn't answer", new Error("socket hang up")],
  ])(
    "forgets it, and the Direct Conversation with it, when the Company %s",
    async (_name, error) => {
      s.pap.mockRejectedValue(error);
      expect(await landed()).toBe(DONE);
      expect(s.connection.accountToken).toBe("new-refresh");
      expect(connection.conversation).toBeUndefined();
      // What a reloaded page is told: no Direct Conversation, no invitation.
      expect(directState(s.connection as never)).toEqual({
        direct: false,
        conversation: false,
        invitation: null,
      });
    },
  );

  it("forgets it when only the User's own thread belongs to another account", async () => {
    s.pap.mockImplementation(async (_run: unknown, url: string) => {
      if (url.includes("/cnv_d/"))
        throw new ProtocolError(404, "conversation_not_found");
      return { conversation_id: "cnv_1", events: [] };
    });
    expect(await landed()).toBe(DONE);
    expect(connection.conversation).toBeUndefined();
  });

  it("keeps a signed-out conversation on first sign-in without asking: no account has used it (§8.11)", async () => {
    s.connection.accountToken = undefined;
    expect(await landed()).toBe(DONE);
    expect(connection.conversation).toEqual(open());
    expect(s.pap).not.toHaveBeenCalled();
  });

  it("leaves it alone when the sign-in fails", async () => {
    s.request.mockResolvedValue(success({ refresh_token: undefined }));
    expect(await landed()).toBe(FAILED);
    expect(connection.conversation).toEqual(open());
    expect(s.pap).not.toHaveBeenCalled();
  });
});

it("rejects wrong issuer or state without exchanging the code", async () => {
  expect(await landed(req("https://flowers.papsandbox.com"))).toBe(FAILED);
  expect(await landed(req(undefined, "other_state"))).toBe(FAILED);
  expect(s.request).not.toHaveBeenCalled();
});

it("leaves the callback's address, with its one-time code, for a clean one, whether the sign-in worked or not", async () => {
  s.request.mockResolvedValue(success());
  // The Company declined: no code, an error it describes in its own words.
  const declined = new Request(
    "http://localhost:3000/api/account/callback?" +
      new URLSearchParams({
        state: "state_test",
        iss: "https://food.papsandbox.com",
        error: "access_denied",
        error_description: "Words of the Company's own.",
      }),
  );
  for (const [request, address] of [
    [req(), "/playground/sign-in/done"],
    // The same code again: it was spent.
    [req(), "/playground/sign-in/failed"],
    [declined, "/playground/sign-in/failed"],
  ] as const) {
    if (request === declined)
      s.connection.auth = {
        state: "state_test",
        verifier: "verifier_test",
        issuer: "https://food.papsandbox.com",
        scopes: "orders:read",
        expires: Date.now() + 60000,
      };
    const response = await GET(request);
    expect(response.status).toBe(303);
    // One of two fixed addresses: nothing of the query, in any form.
    expect(response.headers.get("Location")).toBe(address);
    expect(await response.text()).toBe("");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  }
  expect(s.request).toHaveBeenCalledTimes(1);
});

it("is single use", async () => {
  s.request.mockResolvedValue(success());
  expect(await landed()).toBe(DONE);
  expect(await landed()).toBe(FAILED);
  expect(s.request).toHaveBeenCalledTimes(1);
});

it("lists in the Inspector what was written before any account, then each sign-in, and nothing of the account before", async () => {
  const run = s.run as typeof s.run & {
    log?: Array<{ at: number; text: string; signedOut?: true }>;
  };
  const before = {
    at: 1000,
    text: "GET /api/products · Poppy Session",
    signedOut: true as const,
  };
  run.log = [
    before,
    { at: 2000, text: "GET /api/account/orders/ord_7 · Poppy Session" },
    { at: 3000, text: "Account grant revoked · Session signed out" },
  ];
  try {
    s.request.mockResolvedValue(success());
    expect(await landed()).toBe(DONE);
    // The sign-in's own line says only that it happened, and how: it names
    // nothing an account holds, so it is kept as the public lines are.
    expect(run.log).toEqual([
      before,
      {
        at: expect.any(Number),
        text: "Direct Sign-In completed · PKCE + issuer validation · DPoP account Session",
        signedOut: true,
      },
    ]);
    // A second consent with no message in between, as "Request change
    // permission" is: both sign-ins are listed. Bearer tokens are said to
    // be that.
    s.dpop = false;
    s.connection.auth = {
      state: "state_test",
      verifier: "verifier_test",
      issuer: "https://food.papsandbox.com",
      scopes: "orders:read",
      expires: Date.now() + 60000,
    };
    s.request.mockResolvedValue(success({ token_type: "Bearer" }));
    expect(await landed()).toBe(DONE);
    expect(run.log.map((line) => line.text)).toEqual([
      before.text,
      "Direct Sign-In completed · PKCE + issuer validation · DPoP account Session",
      "Direct Sign-In completed · PKCE + issuer validation · Bearer account Session",
    ]);
    // A sign-in that fails changes nothing.
    s.request.mockRejectedValue(new Error("refused"));
    s.connection.auth = {
      state: "state_test",
      verifier: "verifier_test",
      issuer: "https://food.papsandbox.com",
      scopes: "orders:read",
      expires: Date.now() + 60000,
    };
    expect(await landed()).toBe(FAILED);
    expect(run.log).toHaveLength(3);
  } finally {
    delete run.log;
  }
});

describe("what the page shows of the conversation after a sign-in", () => {
  const run = s.run as typeof s.run & { transcript?: unknown[] };
  // As the transcript keeps them: what the page showed while signed out…
  const before = [
    { role: "user", content: "When do you deliver?", signedOut: true },
    {
      role: "company",
      content: "Any day but Sunday.",
      author: "Lantern Noodle Bar · automated agent",
      signedOut: true,
    },
    {
      role: "assistant",
      content: "Protocol demo (no LLM). Tuesday, Thursday and Saturday.",
      demo: true,
      steps: [
        {
          text: "Talked to the Company's own agent",
          how: "Company's agent",
          access: null,
          state: "done",
        },
      ],
      data: '{"days":3}',
      signedOut: true,
    },
  ];
  // …and what it showed with an account.
  const withAccount = [
    { role: "user", content: "my orders" },
    { role: "company", content: "Private order ord_1", author: "Lantern" },
    { role: "assistant", content: "Private order details", data: '{"o":1}' },
  ];
  const publicTurns = [
    { role: "user" as const, content: "When do you deliver?" },
    {
      role: "assistant" as const,
      content: "Protocol demo (no LLM). Tuesday, Thursday and Saturday.",
    },
  ];
  beforeEach(() => {
    s.request.mockResolvedValue(success());
  });
  afterEach(() => {
    delete run.transcript;
  });

  it("keeps the public conversation as it was shown on first sign-in", async () => {
    s.connection.accountToken = undefined;
    s.run.history = structuredClone(publicTurns);
    run.transcript = structuredClone(before);
    expect((await GET(req())).status).toBe(303);
    // Company content, the answer's label, its steps and its data stay.
    expect(run.transcript).toEqual(before);
    // The model's context is the turns' words, as before.
    expect(s.run.history).toEqual(publicTurns);
  });

  it("keeps only that part on a later consent, never what an account showed", async () => {
    s.connection.publicHistory = structuredClone(publicTurns);
    s.run.history = [
      ...publicTurns,
      { role: "assistant", content: "Private order details" },
    ];
    run.transcript = structuredClone([...before, ...withAccount]);
    expect((await GET(req())).status).toBe(303);
    expect(run.transcript).toEqual(before);
    expect(s.run.history).toEqual(publicTurns);
    expect(JSON.stringify([run.transcript, s.run.history])).not.toContain(
      "Private",
    );
  });

  it("drops a transcript stored before entries said when they were shown", async () => {
    s.connection.publicHistory = structuredClone(publicTurns);
    run.transcript = [
      ...publicTurns,
      { role: "assistant", content: "Private order details" },
    ];
    expect((await GET(req())).status).toBe(303);
    // The page then shows the public history, as it did before.
    expect(run.transcript).toBeUndefined();
    expect(s.run.history).toEqual(publicTurns);
  });

  describe("and what History lists it under", () => {
    const titled = run as typeof run & { title?: string };
    const visitor = visitorOf({
      get: () => ({ value: "v".repeat(43) }),
      set: vi.fn(),
    })!;
    const listed = async () =>
      (await listConversations(visitor)).find(
        (item) => item.id === "run_fixture_0001",
      );
    afterEach(() => {
      delete titled.title;
    });

    it("no longer lists it under a request the sign-in removed", async () => {
      // Everything was said with the account: nothing of it is left.
      titled.title = "Show my orders";
      s.run.history = structuredClone(withAccount.slice(0, 1)) as never;
      run.transcript = structuredClone(withAccount);
      expect((await GET(req())).status).toBe(303);
      expect(run.transcript).toBeUndefined();
      expect(titled.title).toBeUndefined();
      // Listed as the empty conversation it now is, while it runs…
      const item = await listed();
      expect(item).toMatchObject({ active: true });
      expect(item).not.toHaveProperty("title");
      // …and not at all once it has ended with nothing to read.
      s.run.expires = Date.now() - 1;
      try {
        expect(await listed()).toBeUndefined();
      } finally {
        s.run.expires = Date.now() + 60000;
        await seedRun("v".repeat(43), "run_fixture_0001", s.run as never);
      }
    });

    it("lists it under the first request still shown", async () => {
      titled.title = "my orders";
      s.connection.publicHistory = structuredClone(publicTurns);
      run.transcript = structuredClone([...withAccount, ...before]);
      expect((await GET(req())).status).toBe(303);
      expect(titled.title).toBe("When do you deliver?");
    });
  });

  describe("when the conversation with the Company's agent used the account (§8.2)", () => {
    const talking = s.connection as typeof s.connection & {
      conversation?: unknown;
    };
    const thread = () => ({
      endpoint: "https://food.papsandbox.com/poppy/conversations",
      id: "cnv_1",
      cursor: "evt_9",
      seen: ["evt_9"],
    });
    const turns = [
      ...publicTurns,
      { role: "assistant" as const, content: "Private order details" },
    ];
    const whole = () => structuredClone([...before, ...withAccount]);
    const proposal = { op_1: { operation_id: "op_1", state: "proposed" } };
    beforeEach(() => {
      s.pap.mockReset();
      talking.conversation = thread();
      s.connection.token = "old-access";
      s.connection.publicHistory = structuredClone(publicTurns);
      s.run.history = structuredClone(turns);
      run.transcript = whole();
      s.connection.operations = structuredClone(proposal);
    });
    afterEach(() => {
      delete talking.conversation;
    });
    /** The conversation as a sign-in leaves it when it may be another's. */
    const reset = () => {
      expect(run.transcript).toEqual(before);
      expect(s.run.history).toEqual(publicTurns);
      expect(s.connection.operations).toEqual({});
      expect(
        JSON.stringify([
          run.transcript,
          s.run.history,
          s.connection.operations,
        ]),
      ).not.toMatch(/Private|op_1/);
    };

    it("keeps the whole conversation when the new sign-in is for the same account", async () => {
      const asked = companyKeeping("elena", {
        "old-access": "elena",
        "new-access": "elena",
      });
      expect((await GET(req())).status).toBe(303);
      // What the page showed with the account, the model's turns and the
      // proposals: all of it is this account's.
      expect(run.transcript).toEqual(whole());
      expect(s.run.history).toEqual(turns);
      expect(s.connection.operations).toEqual(proposal);
      expect(talking.conversation).toEqual(thread());
      // The new sign-in is in use, and the old one is revoked as before.
      expect(s.connection.token).toBe("new-access");
      expect(s.revoke).toHaveBeenCalledWith(s.connection, "old-refresh");
      // A later sign-in as someone else still goes back to the public part.
      expect(s.connection.publicHistory).toEqual(publicTurns);
      expect(asked).toEqual(["signed out", "old-access", "new-access"]);
    });

    it("keeps only the public part when the new sign-in is for another account", async () => {
      companyKeeping("elena", { "old-access": "elena", "new-access": "robin" });
      expect((await GET(req())).status).toBe(303);
      reset();
      expect(talking.conversation).toBeUndefined();
    });

    it("lists the first sign-in in the Inspector whoever the second is for", async () => {
      const kept = s.run as typeof s.run & {
        log?: Array<{ at: number; text: string; signedOut?: true }>;
      };
      const first = {
        at: 1000,
        text: "Direct Sign-In completed · PKCE + issuer validation · DPoP account Session",
        signedOut: true as const,
      };
      const read = { at: 2000, text: "GET /api/account/orders/ord_7" };
      const second = expect.objectContaining({ text: first.text });
      try {
        for (const [account, lines] of [
          ["elena", [first, read, second]],
          ["robin", [first, second]],
        ] as const) {
          kept.log = [first, read];
          companyKeeping("elena", {
            "old-access": "elena",
            "new-access": account,
          });
          expect((await GET(req())).status).toBe(303);
          expect(kept.log).toEqual(lines);
          // The next sign-in replaces this one, as in every test here.
          Object.assign(s.run, { accountToken: "old-refresh" });
          s.connection.token = "old-access";
          talking.conversation = thread();
          s.connection.auth = {
            state: "state_test",
            verifier: "verifier_test",
            issuer: "https://food.papsandbox.com",
            scopes: "orders:read",
            expires: Date.now() + 60000,
            dpop: { kty: "EC" },
          };
        }
      } finally {
        delete kept.log;
      }
    });

    it("keeps only the public part when no account has used the conversation: it says nothing about the sign-in", async () => {
      companyKeeping(undefined, {});
      expect((await GET(req())).status).toBe(303);
      reset();
      expect(talking.conversation).toEqual(thread());
    });

    it("keeps only the public part when the conversation is another account's than the sign-in being replaced", async () => {
      // The new sign-in reads it, the one the answers were read with can't.
      companyKeeping("robin", { "old-access": "elena", "new-access": "robin" });
      expect((await GET(req())).status).toBe(303);
      reset();
    });

    it.each([
      ["doesn't answer", new Error("socket hang up")],
      ["fails", new ProtocolError(503, undefined)],
    ])(
      "keeps only the public part when the Company %s",
      async (_name, error) => {
        s.pap.mockRejectedValue(error);
        expect((await GET(req())).status).toBe(303);
        reset();
      },
    );
  });
});
