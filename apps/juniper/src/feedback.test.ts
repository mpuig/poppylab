/**
 * Juniper's answers to feedback reports (PAP 1.0 §9.3): every valid report
 * gets an alternative (§9.2), the particular ones first, and the general one
 * names an operation an agent can really open a support case with.
 */
import { expect, it } from "vitest";
import { visitors, webLogin } from "./test-visitors.js";

const FEEDBACK = "/poppy/feedback";
/** What the protocol's validator sends. */
const VALIDATOR = {
  task: "Validator test report",
  description: "Validator test report. Please ignore.",
};
type Reference = { type: string; url: string; operation_id?: string };

it("answers a report it doesn't recognise with the support case, through an API poppy.json lists", async () => {
  const { app, anonymous } = await visitors();
  const reply = await anonymous("usr_ana")("POST", FEEDBACK, VALIDATOR);
  expect(reply.statusCode).toBe(200);
  const alternative = reply.json() as {
    instructions: string;
    references: Reference[];
  };
  expect(alternative.instructions).toContain("support case");
  expect(alternative.instructions).toContain("approves");
  expect(alternative.references).toHaveLength(1);
  const [reference] = alternative.references;
  // §9.2: the reference repeats the `url` of an `openapi` entry in `apis`,
  // and names an operation that description has.
  const apis = (await app.inject("/.well-known/poppy.json")).json()
    .apis as Array<{ type: string; url: string }>;
  expect(
    apis.filter((api) => api.type === "openapi").map((a) => a.url),
  ).toEqual([reference!.url]);
  expect(reference).toEqual({
    type: "openapi",
    url: "https://juniper.example/openapi.json",
    operation_id: "propose_support_case",
  });
  const paths = (await app.inject("/openapi.json")).json().paths as Record<
    string,
    Record<string, { operationId: string; "x-poppy-proposal"?: boolean }>
  >;
  const operations = Object.values(paths).flatMap((p) => Object.values(p));
  expect(
    operations.find((o) => o.operationId === reference!.operation_id),
  ).toMatchObject({ "x-poppy-proposal": true });
});

it("opens a case through the operation the alternative names, only with the customer's approval", async () => {
  const { visitor } = await visitors();
  const ana = await visitor("usr_ana");
  const body = {
    topic: "other",
    subject: "Engrave a gift tag",
    message: "Can a gift tag be added to Saturday's delivery?",
  };
  const proposed = await ana("POST", "/api/account/case-proposal", body);
  expect(proposed.statusCode).toBe(403);
  expect(proposed.json().error).toBe("approval_required");
  expect((await ana("GET", "/api/account/cases")).json().cases).toHaveLength(0);
  const { operation_id, revision } = proposed.json().operation;
  const opened = await ana("POST", "/api/account/case-proposal", body, {
    operation_id,
    revision,
  });
  expect(opened.statusCode).toBe(200);
  const cases = (await ana("GET", "/api/account/cases")).json().cases;
  expect(cases).toHaveLength(1);
  expect(cases[0].subject).toBe("Engrave a gift tag");
});

it("keeps its particular alternatives ahead of the general one", async () => {
  const { anonymous } = await visitors();
  const reply = await anonymous("usr_ana")("POST", FEEDBACK, {
    task: "Pay with a gift card",
    description: "The User wanted to pay for a new order with a gift card.",
  });
  expect(reply.statusCode).toBe(200);
  expect(reply.json()).toEqual({
    instructions: expect.stringContaining("+1 555-0117"),
    references: [{ type: "web", url: "https://juniper.example/help" }],
  });
});

it("still refuses a malformed or overlong report, and one without a Session", async () => {
  const { app, anonymous } = await visitors();
  const ana = anonymous("usr_ana");
  for (const body of [
    { task: 42 },
    { task: "x" },
    { task: "", description: "d" },
    { task: "x".repeat(201), description: "d" },
    { task: "x", description: "d".repeat(2001) },
  ]) {
    const refused = await ana("POST", FEEDBACK, body);
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toEqual({ error: "invalid_request" });
  }
  const bare = await app.inject({
    method: "POST",
    url: FEEDBACK,
    payload: VALIDATOR,
  });
  expect(bare.statusCode).toBe(400);
  expect(bare.json()).toEqual({ error: "invalid_session" });
});

it("shows each report on the website as one an alternative was offered for", async () => {
  const { app, visitor } = await visitors();
  const browser = { cookie: "" };
  const ana = await visitor("usr_ana", browser);
  for (const task of ["Engrave a gift tag", "Pay with a gift card"])
    expect(
      (
        await ana("POST", FEEDBACK, {
          task,
          description: "The User wanted it.",
        })
      ).statusCode,
    ).toBe(200);
  const page = await app.inject({
    url: "/account",
    headers: { cookie: await webLogin(app, browser.cookie) },
  });
  const section = page.body.slice(page.body.indexOf('id="agent-feedback"'));
  expect(section).toContain("Engrave a gift tag");
  expect(section).toContain("Pay with a gift card");
  expect(section.match(/Alternative offered/g)).toHaveLength(2);
  expect(section).not.toContain('<span class="record-tag">Received</span>');
});
