/**
 * Fernwick's Company Agent (§8) and customer portal: help, sign-in events,
 * usage and the last bill of the chosen meters only, the approval-gated
 * plan change, and the portal reading the same state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { restartingStore } from "@poppy-lab/pap-company";
import { inject, lab, origin, setup } from "./test-harness.ts";

type Harness = Awaited<ReturnType<typeof setup>>;
type Message = {
  role: string;
  text?: string;
  data?: Record<string, unknown>;
  extensions?: Record<string, unknown>;
};
const companyMessages = (body: {
  events: Array<{ type: string; message?: Message }>;
}) =>
  body.events
    .filter((e) => e.type === "message" && e.message?.role === "company")
    .map((e) => e.message!);
let n = 0;
const say = (data: Record<string, unknown>) => ({
  id: `req_fernwick_${++n}`,
  message: { author: { type: "agent" }, data },
});

describe("Fernwick conversations and portal", () => {
  let h: Harness;
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-25T12:00:00.000Z"));
    h = await setup();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("offers help and asks to sign in for account requests", async () => {
    const help = await h.call(
      "",
      "POST",
      "/poppy/conversations?wait=0",
      say({ request: "help" }),
    );
    expect(help.statusCode).toBe(201);
    expect(companyMessages(help.json())[0]?.data?.requests).toHaveLength(3);
    const usage = await h.call(
      "",
      "POST",
      "/poppy/conversations?wait=0",
      say({ request: "usage_this_month" }),
    );
    expect(usage.json().events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "authorization",
          scope: "account:read",
        }),
      ]),
    );
  });

  it("keeps to the meters chosen at consent", async () => {
    const tokens = await h.sign("elena", ["account:read", "plan:write"], {
      meters: ["UP-E2"],
    });
    const usage = companyMessages(
      (
        await h.call(
          tokens.access_token,
          "POST",
          "/poppy/conversations?wait=0",
          say({ request: "usage_this_month" }),
        )
      ).json(),
    )[0]!;
    const meters = usage.data!.usage as Array<Record<string, unknown>>;
    expect(meters.map((m) => m.usage_point_id)).toEqual(["UP-E2"]);
    expect(meters[0]).toMatchObject({
      from: "2026-11-01T00:00:00.000Z",
      to: "2026-11-25T12:00:00.000Z",
    });
    const bill = companyMessages(
      (
        await h.call(
          tokens.access_token,
          "POST",
          "/poppy/conversations?wait=0",
          say({ request: "last_bill" }),
        )
      ).json(),
    )[0]!;
    expect(bill.data!.bills).toEqual([
      expect.objectContaining({ usage_point_id: "UP-E2", month: "2026-10" }),
    ]);
    const refused = companyMessages(
      (
        await h.call(
          tokens.access_token,
          "POST",
          "/poppy/conversations?wait=0",
          say({
            request: "change_plan",
            usage_point_id: "UP-E1",
            plan: "time-of-use",
          }),
        )
      ).json(),
    )[0]!;
    expect(refused.data!.error).toBe("meter_not_found");
  });

  it("changes a plan only after approval in the conversation, and the portal shows it", async () => {
    const tokens = await h.sign("robin", ["account:read", "plan:write"]);
    const started = await h.call(
      tokens.access_token,
      "POST",
      "/poppy/conversations?wait=0",
      say({ request: "change_plan", usage_point_id: "UP-R1", plan: "flat" }),
    );
    const conversation = started.json().conversation_id as string;
    const proposal = companyMessages(started.json()).at(-1)!;
    const { operation } = proposal.extensions!.operations as {
      operation: {
        operation_id: string;
        revision: string;
        terms: Record<string, unknown>;
      };
    };
    expect(operation.terms).toMatchObject({
      usage_point_id: "UP-R1",
      from_plan: "time-of-use",
      to_plan: "flat",
      effective_date: "2026-12-01",
    });
    const approved = await h.call(
      tokens.access_token,
      "POST",
      `/poppy/conversations/${conversation}/messages?wait=0`,
      {
        id: "req_fernwick_approve",
        message: {
          author: { type: "human" },
          data: { request: "approve" },
          extensions: {
            operations: {
              approval: {
                operation_id: operation.operation_id,
                revision: operation.revision,
                approver: "user",
                approved_at: Math.floor(Date.now() / 1000),
                input_type: "tap",
              },
            },
          },
        },
      },
    );
    expect(companyMessages(approved.json()).at(-1)?.data?.change).toMatchObject(
      {
        usage_point_id: "UP-R1",
        to_plan: "flat",
        effective_date: "2026-12-01",
      },
    );
    const account = (
      await h.call(tokens.access_token, "GET", "/api/account/account")
    ).json();
    expect(account.meters[0].scheduled_change.plan).toBe("flat");

    // The portal, signed in as Robin, shows the same scheduled change.
    const login = await inject("/site/login");
    const loginCookie = String(login.headers["set-cookie"]).split(";")[0]!;
    const signed = await inject({
      method: "POST",
      url: "/site/login",
      headers: { cookie: loginCookie, origin },
      payload: { account: "robin", login_token: loginCookie.split("=")[1] },
    });
    const web = String(signed.headers["set-cookie"]).split(";")[0]!;
    const state = (
      await inject({ url: "/site/state", headers: { cookie: web } })
    ).json();
    expect(state.meters[0]).toMatchObject({
      id: "UP-R1",
      plan: "time-of-use",
      scheduled: { plan: "flat", effective_date: "2026-12-01" },
    });
    expect(state.meters[0].days).toHaveLength(7);
    expect(state.activity[0].state).toBe("succeeded");
    const page = await inject({ url: "/account", headers: { cookie: web } });
    expect(page.body).toContain("Connected agents");
    // The portal's own read of the account carries the list of connected
    // agents, in the consent page's words: nothing to press to see it.
    expect(page.body).not.toContain("load-access");
    expect(state.agents).toMatchObject([
      {
        name: "Iris",
        host: "localhost:3000",
        client: "http://localhost:3000/agent/client.json",
        permissions: [
          "Read: Address, chosen meters, plans and bills.",
          "Propose changes: Switch a chosen meter's rate plan.",
        ],
        expires: expect.stringMatching(
          /^[A-Z][a-z]{2} \d{1,2}, \d{2}:\d{2} UTC$/,
        ),
      },
    ]);
    // Disconnecting the agent in the portal ends its access.
    const grants = (
      await inject({ url: "/site/access", headers: { cookie: web } })
    ).json();
    expect(grants.grants[0].resources).toEqual(["UP-R1"]);
    const revoke = await inject({
      method: "POST",
      url: `/site/access/${grants.grants[0].id}/revoke`,
      headers: { cookie: web, origin, "x-fernwick-account": "robin" },
    });
    expect(revoke.statusCode).toBe(200);
    expect(
      (await inject({ url: "/site/state", headers: { cookie: web } })).json()
        .agents,
    ).toEqual([]);
    expect(
      (await h.call(tokens.access_token, "GET", "/api/account/account"))
        .statusCode,
    ).toBe(401);
  });

  it("keeps the customer's record of an applied request and of who approved it after the gateway has forgotten the operation", async () => {
    const tokens = await h.sign("elena", ["account:read", "plan:write"]);
    const change = (
      meter: string,
      plan: string,
      key: string,
      approval?: Parameters<typeof h.call>[4],
    ) =>
      h.call(
        tokens.access_token,
        "POST",
        "/api/account/plan",
        { usage_point_id: meter, plan, idempotency_key: key },
        approval,
      );
    const first = ["UP-E1", "time-of-use", "plan-history-01"] as const;
    const op = (await change(...first)).json().operation;
    expect((await change(...first, op)).statusCode).toBe(200);
    const login = await inject("/site/login");
    const loginCookie = String(login.headers["set-cookie"]).split(";")[0]!;
    const signed = await inject({
      method: "POST",
      url: "/site/login",
      headers: { cookie: loginCookie, origin },
      payload: { account: "elena", login_token: loginCookie.split("=")[1] },
    });
    const web = String(signed.headers["set-cookie"]).split(";")[0]!;
    const activity = async () =>
      (await inject({ url: "/site/state", headers: { cookie: web } })).json()
        .activity as Array<Record<string, unknown>>;
    const applied = {
      state: "succeeded",
      approver: "user",
      summary: op.summary,
    };
    expect(await activity()).toMatchObject([applied]);
    // Eleven minutes on, the next request makes the gateway forget the
    // performed operation. The customer's record of it stays.
    vi.setSystemTime(Date.now() + 11 * 60000);
    const next = (await change("UP-E2", "flat", "plan-history-02")).json()
      .operation;
    const later = await activity();
    expect(later).toMatchObject([
      { state: "proposed", summary: next.summary },
      applied,
    ]);
    expect(later[1]!.when).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{2}:\d{2} UTC$/);
    // The proposal that waits says until when, and what a decline in the
    // agent, which the Company is not told about, means.
    expect(later[0]!.when).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{2}:\d{2} UTC$/);
    expect(later[0]!.result).toBe(
      `It waits for your approval in your agent until ${later[0]!.when}. If you decline it there or let it run out, nothing changes. Your agent does not tell us when you decline, so it shows as awaiting until then.`,
    );
  });

  it("accepts the login form after a restart, and gives a form without its token a page with a way back", async () => {
    const load = restartingStore();
    await setup({ store: load(), isolation: "visitor" });
    // A browser the site has seen: opening the form again saves nothing.
    const first = await lab.app.request("/site/login");
    const browser = first.headers
      .getSetCookie()
      .find((entry) => entry.includes("pap_browser="))!
      .split(";")[0]!;
    const page = await lab.app.request("/site/login", {
      headers: { cookie: browser },
    });
    const login = page.headers
      .getSetCookie()
      .find((entry) => entry.startsWith("fernwick_login="))!
      .split(";")[0]!;
    const post = (fields: Record<string, string>) =>
      lab.app.request("/site/login", {
        method: "POST",
        headers: {
          cookie: `${browser}; ${login}`,
          origin,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ account: "robin", ...fields }).toString(),
      });
    // The Durable Object was dropped from memory while the form was open.
    await setup({ store: load(), isolation: "visitor" });
    const refused = await post({});
    expect(refused.status).toBe(403);
    const html = await refused.text();
    expect(html).toContain("This sign-in page has expired.");
    expect(html).toContain(
      '<a href="/site/login">Open the sign-in page again</a>',
    );
    const entered = await post({ login_token: login.split("=")[1]! });
    expect(entered.status).toBe(302);
    expect(entered.headers.get("location")).toBe("/account");
    // The form is used up.
    expect(
      entered.headers
        .getSetCookie()
        .some((entry) => entry.startsWith("fernwick_login=;")),
    ).toBe(true);
  });
});
