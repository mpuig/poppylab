/**
 * End to end, in process: a standing instruction at the real Harborline app.
 * As in `fdx-harborline.test.ts`, only the network is replaced. A transfer
 * within the User's limit is covered by the rule, so Iris sends an agent
 * approval; Harborline declines it, as it does for every agent approval of
 * money, and the proposal comes back to the User with the bank's reason.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const net = vi.hoisted(() => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("PAP_ALLOW_PRIVATE_NETWORK", "true");
  return {
    app: undefined as
      | {
          request: (
            url: string,
            init?: RequestInit,
          ) => Response | Promise<Response>;
        }
      | undefined,
    cookies: new Map<string, string>(),
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
    return net.app!.request(String(url), rest);
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      net.cookies.has(name) ? { value: net.cookies.get(name)! } : undefined,
    set: (name: string, value: string) => {
      if (value) net.cookies.set(name, value);
      else net.cookies.delete(name);
    },
    delete: (name: string) => net.cookies.delete(name),
  }),
}));
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createIdentity } from "@poppy-lab/pap-client";
import {
  lab,
  origin,
  client,
  redirect,
  setup,
} from "../../harborline/src/test-harness";
import { POST as discover } from "../app/api/discover/route";
import { POST as act } from "../app/api/account/route";
import { GET as callback } from "../app/api/account/callback/route";
import { POST as chat } from "../app/api/chat/route";
import { OperationReview } from "../app/operation-review";
import { leftToUser, nextAutoApproval } from "./auto-approval";
import type { ReviewOperation } from "./operation-presentation";

const agent = "http://localhost:3000";
let conversation: string;

const post = (
  handler: (r: Request) => Promise<Response>,
  path: string,
  body: unknown,
) =>
  handler(
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
/** The User on Harborline's consent page: Elena approves what Iris asked. */
async function consent(url: string) {
  const page = await net.app!.request(url);
  expect(page.status).toBe(200);
  const cookie = page.headers
    .getSetCookie()
    .find((c) => c.includes("pap_consent_"))!
    .split(";")[0]!;
  const approved = await net.app!.request(`${origin}/oauth/authorize`, {
    method: "POST",
    headers: {
      cookie,
      origin,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      nonce: cookie.split("=")[1]!,
      decision: "approve",
      account: "elena",
      // Each permission to change something is ticked on its own.
      allow_cards_write: "yes",
      allow_transactions_write: "yes",
      allow_budgets_write: "yes",
      allow_payments_request: "yes",
      allow_transfers_request: "yes",
    }).toString(),
  });
  expect(approved.status).toBe(302);
  return approved.headers.get("location")!;
}
const upTo = (dollars: number) => ({
  maxCents: dollars * 100,
  currency: "USD",
});

describe("A standing instruction at Harborline, end to end", () => {
  let op: ReviewOperation;
  beforeAll(async () => {
    const keys = await createIdentity();
    vi.stubEnv("POPPY_IDENTITY", JSON.stringify(keys));
    await setup({
      fetchJson: async (url: string) =>
        url.endsWith("client.json")
          ? {
              client_id: client,
              client_name: "Iris",
              jwks_uri: `${agent}/agent/jwks.json`,
              redirect_uris: [redirect],
            }
          : { keys: [keys.publicKey] },
    });
    net.app = lab.app;
    net.cookies.set("poppy_visitor", "s".repeat(43));
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("gets a $25 transfer as a proposal the rule covers", async () => {
    const found = await post(discover, "/api/discover", { url: origin });
    expect(found.status).toBe(200);
    conversation = found.headers.get("X-Poppy-Conversation")!;
    const signin = await post(act, "/api/account", {
      action: "signin",
      access: "write",
    });
    expect(signin.status).toBe(200);
    const done = await callback(
      new Request(await consent((await signin.json()).url)),
    );
    expect(done.status).toBe(303);
    const reply = await post(chat, "/api/chat", {
      url: origin,
      message: "Transfer $25 from checking to savings.",
      provider: "demo",
    });
    expect(reply.status).toBe(200);
    const { operations } = (await reply.json()) as {
      operations: ReviewOperation[];
    };
    expect(operations).toHaveLength(1);
    op = operations[0]!;
    expect(op.terms).toMatchObject({
      amount_cents: 2500,
      source_balance_before_cents: expect.any(Number),
      destination_balance_after_cents: expect.any(Number),
      currency: "USD",
    });
    // What the page decides: nothing for a smaller limit, with the reason;
    // an approval for a limit the transfer is within.
    const page = { operations, signedIn: true, busy: false };
    expect(
      nextAutoApproval({
        ...page,
        instruction: upTo(20),
        decided: new Set(),
      }),
    ).toBeNull();
    expect(leftToUser(op, upTo(20), "Harborline Bank")).toBe(
      "the amount, $25.00, is over your limit of $20.00",
    );
    expect(
      nextAutoApproval({
        ...page,
        instruction: upTo(50),
        decided: new Set(),
      }),
    ).toMatchObject({
      kind: "approve",
      covered: "$25.00 within your limit of $50.00",
      cents: 2500,
    });
  });

  it("is refused by the server for a limit the transfer is over", async () => {
    const refused = await post(act, "/api/account", {
      action: "approve",
      id: op.operation_id,
      revision: op.revision,
      instruction: upTo(20),
    });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: "not_covered" });
  });

  it("gives the proposal back to the User with the bank's reason", async () => {
    const answer = await post(act, "/api/account", {
      action: "approve",
      id: op.operation_id,
      revision: op.revision,
      instruction: upTo(50),
    });
    expect(answer.status).toBe(200);
    const body = (await answer.json()) as {
      code: string;
      operation: ReviewOperation;
    };
    expect(body.code).toBe("agent_approval_declined");
    // Nothing moved, and it still waits for an approval of the User's own.
    expect(body.operation).toMatchObject({
      state: "proposed",
      revision: op.revision,
      agentDeclined: {
        reason:
          "Harborline moves money only when you approve it yourself. Your agent's standing instruction can't approve payments or transfers here.",
      },
    });
    const html = renderToStaticMarkup(
      createElement(OperationReview, {
        op: body.operation,
        company: "Harborline Bank",
        busy: false,
        signedIn: true,
        onAction: vi.fn(),
        notApplied: leftToUser(body.operation, upTo(50), "Harborline Bank"),
      }),
    );
    expect(html).toContain(
      "Harborline Bank declined the approval Iris sent on your standing instruction, and did nothing. It says: “Harborline moves money only when you approve it yourself.",
    );
    expect(html).toContain("Approve $25.00");
    // The rule doesn't try again, even after a reload.
    expect(
      nextAutoApproval({
        operations: [body.operation],
        instruction: upTo(50),
        signedIn: true,
        busy: false,
        decided: new Set(),
      }),
    ).toBeNull();

    // The User's own approval is what Harborline takes.
    const own = await post(act, "/api/account", {
      action: "approve",
      id: op.operation_id,
      revision: op.revision,
    });
    expect(own.status).toBe(200);
    expect((await own.json()).operation).toMatchObject({
      state: "succeeded",
      approvedBy: { approver: "user" },
    });
  });
});
