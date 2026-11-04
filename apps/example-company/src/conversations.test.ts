/**
 * Juniper's Company Agent (PAP 0.3 §8): structured requests, sign-in by
 * authorization event, and a support case proposed in a message and opened
 * only with the User's approval, then visible on the website.
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
  message: { id: `msg_j${++n}`, author: { type: "agent" }, ...body },
});

it("answers store questions signed out and asks for sign-in for the account", async () => {
  const { app, anonymous } = await visitors();
  const doc = (await app.inject({ url: "/.well-known/poppy.json" })).json();
  expect(doc.agent.protocols[0]).toEqual({
    type: "poppy",
    endpoint: "https://juniper.example/poppy/conversations",
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
        extensions: { operations: { approval: op } },
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
    await ana("POST", `${BASE}/${id}/handoff?wait=0&cursor=${done.cursor}`, {})
  ).json() as Read & { status: string };
  expect(handoff.status).toBe("idle");
  expect(company(handoff)[0]!.data).toMatchObject({
    handoff: "unavailable",
    phone: "+1 555-0117",
  });
});
