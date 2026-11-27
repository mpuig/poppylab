/**
 * Juniper's Company Agent (PAP 1.0 §8): structured requests, sign-in by
 * authorization event, and a support case proposed in a message and opened
 * only with the User's approval (Operations v3), then visible on the website.
 */
import { expect, it } from "vitest";
import { visitors, webLogin } from "./test-visitors.js";

const BASE = "/poppy/conversations";
type Said = {
  text?: string;
  data?: Record<string, unknown>;
  extensions?: {
    operations?: { operation?: { operation_id: string; revision: string } };
  };
};
type Read = {
  events: Array<{
    type: string;
    scope?: string;
    message?: Said & { role: string };
  }>;
  cursor: string;
};
const company = (r: Read) =>
  r.events.filter((e) => e.message?.role === "company").map((e) => e.message!);
let n = 0;
const msg = (body: Record<string, unknown>) => ({
  id: `req_j${++n}`,
  message: { author: { type: "agent" }, ...body },
});

it("answers store questions signed out and asks for sign-in for the account", async () => {
  const { app, anonymous } = await visitors();
  const doc = (await app.inject({ url: "/.well-known/poppy.json" })).json();
  expect(doc.agent.protocols[0]).toMatchObject({
    type: "poppy",
    endpoint: "https://juniper.example/poppy/conversations",
    description: expect.stringContaining("support case"),
  });
  const ana = anonymous("usr_ana");
  const info = (
    await ana(
      "POST",
      `${BASE}?wait=0`,
      msg({ data: { request: "store_info" } }),
    )
  ).json() as Read & { conversation_id: string };
  expect(company(info)[0]!.data).toMatchObject({
    hours: "Monday–Saturday, 8am–7pm; Sunday, 9am–4pm",
    phone: "+1 555-0117",
    // The delivery fee comes with its currency, as at `/api/delivery`.
    delivery: { fee_cents: 500, free_above_cents: 3500, currency: "USD" },
  });
  const status = (
    await ana(
      "POST",
      `${BASE}/${info.conversation_id}/messages?wait=0&cursor=${info.cursor}`,
      msg({ data: { request: "delivery_status" } }),
    )
  ).json() as Read;
  expect(status.events.at(-1)).toMatchObject({
    type: "authorization",
    scope: "poppy:read",
  });
  expect(company(status).at(-1)).toMatchObject({
    text: "That needs your Juniper account. Sign in, then send the request again.",
    data: { error: "sign_in_required", scopes: ["poppy:read"] },
  });
});

it("tells a customer signed in without a permission which one is missing, not to sign in", async () => {
  const { visitor } = await visitors();
  const reader = await visitor("usr_ana", undefined, "poppy:read");
  const report = (
    await reader(
      "POST",
      `${BASE}?wait=0`,
      msg({
        data: {
          request: "report_problem",
          topic: "delivery",
          subject: "Bruised apples",
          message: "Two apples were bruised.",
        },
      }),
    )
  ).json() as Read;
  expect(company(report).at(-1)).toMatchObject({
    text: "You're signed in, but you haven't allowed this agent to propose changes, such as opening a support case. Allow it from your agent, then send the request again.",
    data: {
      error: "insufficient_scope",
      scopes: ["poppy:read", "poppy:write"],
    },
  });
  expect(report.events.at(-1)).toMatchObject({
    type: "authorization",
    scope: "poppy:read poppy:write",
  });
});

it("opens a support case only with the approval, and the website shows it", async () => {
  const { app, visitor } = await visitors();
  const browser = { cookie: "" };
  const ana = await visitor("usr_ana", browser);
  const report = (
    await ana(
      "POST",
      `${BASE}?wait=0`,
      msg({
        data: {
          request: "report_problem",
          topic: "delivery",
          subject: "Bruised apples",
          message: "Half the apples in Thursday's delivery were bruised.",
        },
      }),
    )
  ).json() as Read & { conversation_id: string };
  const op = company(report)[0]!.extensions!.operations!.operation!;
  const id = report.conversation_id;
  expect((await ana("GET", "/api/account/cases")).json().cases).toHaveLength(0);
  const done = (
    await ana(
      "POST",
      `${BASE}/${id}/messages?wait=0&cursor=${report.cursor}`,
      msg({
        text: "The user approved.",
        extensions: {
          operations: {
            approval: {
              operation_id: op.operation_id,
              revision: op.revision,
              approver: "user",
              input_type: "tap",
            },
          },
        },
      }),
    )
  ).json() as Read;
  expect(company(done)[0]!.text).toMatch(/^Case case_.+ opened\./);
  const cases = (await ana("GET", "/api/account/cases")).json().cases;
  expect(cases).toHaveLength(1);
  expect(cases[0].subject).toBe("Bruised apples");
  // The same browser, signed in on the website, sees the case and the activity.
  const state = (
    await app.inject({
      url: "/site/state",
      headers: { cookie: await webLogin(app, browser.cookie) },
    })
  ).json();
  expect(state.cases[0].subject).toBe("Bruised apples");
  expect(state.activity[0]).toMatchObject({ state: "succeeded" });
  // Handoff: nobody is available; the reply says how to call.
  const handoff = (
    await ana("POST", `${BASE}/${id}/handoff?wait=0&cursor=${done.cursor}`, {
      id: "req_j_handoff",
    })
  ).json() as Read & { handoff: string; responder: string };
  expect(handoff).toMatchObject({ handoff: "none", responder: "agent" });
  expect(company(handoff)[0]!.data).toMatchObject({
    handoff: "unavailable",
    phone: "+1 555-0117",
  });
});

it("answers the customer in a Direct Conversation with how to call, since its agent doesn't handle them (§8.10)", async () => {
  const { anonymous } = await visitors();
  const ana = anonymous("usr_ana_direct");
  const parent = (
    await ana("POST", BASE, msg({ data: { request: "store_info" } }))
  ).json() as { conversation_id: string };
  const opened = await ana("POST", `${BASE}?wait=0`, {
    id: `req_j${++n}`,
    parent_conversation_id: parent.conversation_id,
    message: { author: { type: "human" }, text: "Hello, is anyone there?" },
  });
  expect(opened.statusCode).toBe(201);
  const reply = company(opened.json() as Read);
  expect(reply).toHaveLength(1);
  expect(reply[0]!.text).toContain("+1 555-0117");
});
