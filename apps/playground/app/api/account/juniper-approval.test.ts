import { it, expect, vi } from "vitest";
import type * as OperationStore from "../../../lib/operation-store";
import { testApp } from "../../../../example-company/src/test-app";
import { openApiTools, ProtocolError } from "@poppy-lab/pap-client";
import { operations } from "../../../../example-company/src/operations";
import { accountPaths } from "../../../../example-company/src/openapi";
import type { Operation } from "@/lib/runtime";
import { recordOperation } from "../../../lib/operation-store";
const state = vi.hoisted(() => ({
  run: {
    url: "http://juniper.localhost:4100",
    expires: Date.now() + 60000,
    busy: false,
    accountToken: "fixture-refresh",
    scopes: "poppy:read poppy:write",
    operations: {} as Record<string, Operation>,
    history: [] as Array<{ role: "assistant"; content: string }>,
    company: {
      document: {},
      profile: {
        version: "0.3",
        identifier: "http://juniper.localhost:4100",
        signIn: { direct: true, device: false },
        scopes: ["poppy:read", "poppy:write"],
        scopeDescriptions: {},
        scopeHints: {
          "poppy:read": { changes: "none", personal_data: true },
          "poppy:write": { changes: "irreversible", personal_data: true },
        },
      },
    } as unknown,
  },
  send: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => ({
      value: name.includes("visitor") ? "v".repeat(43) : "run_fixture_0001",
    }),
    set: vi.fn(),
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

vi.mock("@/lib/runtime", async () => ({
  localOrigins: ["http://juniper.localhost:4100"],
  sendApproval: state.send,
  recordOperation: (
    await vi.importActual<typeof OperationStore>("../../../lib/operation-store")
  ).recordOperation,
  connect: vi.fn(),
  clientFor: vi.fn(),
  agentFor: vi.fn(),
  accountConfiguration: vi.fn(),
  usesDpop: vi.fn(),
  revokeRefreshToken: vi.fn(),
}));
import { POST } from "./route";
import { seedRun } from "@/lib/runs";

it("model tool → real Juniper 403 operation → human approval → Poppy-Approval retry → exactly one order", async () => {
  Object.assign(state.run, { protocol: "0.3" });
  await seedRun("v".repeat(43), "run_fixture_0001", state.run as never);
  // The verified Session is injected; Session headers and DPoP are covered
  // by Juniper's authority-regression tests against the real gateway.
  const app = testApp();
  operations(app, () => ({
    client: "fixture",
    user: "usr_a",
    account: "alex",
    expires: Date.now() + 60000,
  }));
  const invoke = async (
    url: string,
    method: "GET" | "POST",
    payload?: unknown,
    approval?: { operation_id: string; revision: string },
  ) => {
    const response = await app.inject({
      url: new URL(url, state.run.url).pathname,
      method,
      headers: {
        ...(payload === undefined
          ? {}
          : { "Content-Type": "application/json" }),
        ...(approval
          ? {
              "Poppy-Approval": `operation_id="${approval.operation_id}", revision="${approval.revision}"`,
            }
          : {}),
      },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    });
    if (response.statusCode >= 400)
      throw new ProtocolError(
        response.statusCode,
        response.json().error,
        undefined,
        undefined,
        response.json().operation,
      );
    return response.json();
  };
  // Mirrors runtime's OpenAPI POST handling: record the refused operation.
  const tools = openApiTools(
    { paths: accountPaths },
    state.run.url + "/openapi.json",
    {
      allowProposals: true,
      blockedPaths: [],
      trace: vi.fn(),
      request: async (url, method, body) => {
        try {
          return await invoke(url, method, body);
        } catch (error) {
          if (
            !(error instanceof ProtocolError) ||
            error.code !== "approval_required"
          )
            throw error;
          const op = recordOperation(state.run, error.operation, { url, body });
          return { status: "approval_required", operation_id: op.operation_id };
        }
      },
    },
  );
  state.send.mockImplementation((_run, op: Operation) =>
    invoke(op.request!.url, "POST", op.request!.body, {
      operation_id: op.operation_id,
      revision: op.revision,
    }),
  );
  const action = (action: string, id: string, revision: string) =>
    POST(
      new Request("http://localhost:3000/api/account", {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action, id, revision }),
      }),
    );
  try {
    vi.stubEnv("NODE_ENV", "development");
    const thursday = (await tools.propose_checkout!.execute({
      day: "Thursday",
    })) as { operation_id: string };
    const firstRevision = state.run.operations[thursday.operation_id]!.revision;
    // Asking again with another day revises the same operation.
    await tools.propose_checkout!.execute({ day: "Saturday" });
    const saturday = state.run.operations[thursday.operation_id]!;
    expect(saturday.revision).not.toBe(firstRevision);
    expect(saturday.terms?.delivery_day).toBe("Saturday");
    expect((await invoke("/api/account/orders", "GET")).orders).toEqual([]);
    // The superseded local revision can't be approved any more.
    expect(
      (await action("approve", thursday.operation_id, firstRevision)).status,
    ).toBe(400);
    const approved = await action(
      "approve",
      thursday.operation_id,
      saturday.revision,
    );
    expect(approved.status).toBe(200);
    expect((await approved.json()).operation).toMatchObject({
      state: "succeeded",
    });
    expect(state.send).toHaveBeenCalledTimes(1);
    // Approving again is refused locally: it is already done.
    expect(
      (await action("approve", thursday.operation_id, saturday.revision))
        .status,
    ).toBe(410);
    const orders = (await invoke("/api/account/orders", "GET")).orders;
    expect(orders).toHaveLength(1);
    expect(orders[0].delivery_day).toBe("Saturday");
    // No tool can confirm, cancel or approve anything.
    expect(
      Object.keys(tools).some((name) =>
        /confirm|cancel|approv|revis/.test(name),
      ),
    ).toBe(false);
  } finally {
    await app.close();
    vi.unstubAllEnvs();
  }
});
