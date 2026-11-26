/**
 * §9.3 at the gateway: a report gets 202 with no body, or 200 with the
 * alternative the Company's own `feedback` hook returns; a malformed or
 * overlong report never reaches the hook.
 */
import { expect, it } from "vitest";
import { origin, setup } from "./test-company.ts";
import { SHARED_TENANT, type Alternative } from "./types.ts";

const FEEDBACK = "/poppy/feedback";
const report = {
  task: "Pay with a gift card",
  description: "No field for one.",
};

it("answers 202 with no body when the Company has no alternative", async () => {
  const x = await setup();
  const plain = await x.post(FEEDBACK, report);
  expect(plain.status).toBe(202);
  expect(await plain.text()).toBe("");
  // A hook that knows nothing for this report is the same.
  const y = await setup({}, { feedback: () => undefined });
  expect((await y.post(FEEDBACK, report)).status).toBe(202);
  expect(y.store.value.tenants[SHARED_TENANT]!.feedback).toMatchObject([
    { ...report, answer: "accepted" },
  ]);
});

it("answers 200 with the hook's alternative, whose reference can repeat the API poppy.json lists", async () => {
  const seen: Array<{ task: string; description: string }> = [];
  const api = (at: string) => `${at}/openapi.json`;
  const x = await setup(
    {},
    {
      discovery: (at) => ({ apis: [{ type: "openapi", url: api(at) }] }),
      // The hook gets the deployment's origin, as `discovery` does, so the
      // reference's `url` is the listed one at every deployment (§9.2).
      feedback: (said, at): Alternative => {
        seen.push(said);
        return {
          instructions: "Ask the staff in a support case.",
          references: [
            { type: "openapi", url: api(at), operation_id: "open_case" },
          ],
        };
      },
    },
  );
  const reply = await x.post(FEEDBACK, {
    task: "  Engrave a gift tag ",
    description: " The User wanted one. ",
  });
  expect(reply.status).toBe(200);
  const alternative = (await reply.json()) as Alternative;
  expect(alternative).toEqual({
    instructions: "Ask the staff in a support case.",
    references: [
      {
        type: "openapi",
        url: `${origin}/openapi.json`,
        operation_id: "open_case",
      },
    ],
  });
  const poppy = (await (
    await x.app.request("/.well-known/poppy.json")
  ).json()) as { apis: Array<{ type: string; url: string }> };
  expect(poppy.apis.map((entry) => `${entry.type} ${entry.url}`)).toContain(
    `openapi ${alternative.references![0]!.url}`,
  );
  // The hook sees the trimmed report, and the tenant keeps what was answered.
  expect(seen).toEqual([
    { task: "Engrave a gift tag", description: "The User wanted one." },
  ]);
  expect(x.store.value.tenants[SHARED_TENANT]!.feedback).toMatchObject([
    { task: "Engrave a gift tag", answer: "alternative" },
  ]);
});

it("refuses a malformed or overlong report before the hook, and keeps none of it", async () => {
  let asked = 0;
  const x = await setup(
    {},
    {
      feedback: () => {
        asked++;
        return { instructions: "Ask the staff." };
      },
    },
  );
  for (const body of [
    { task: 42 },
    { task: "x" },
    { task: " ", description: "d" },
    { task: "x".repeat(201), description: "d" },
    { task: "x", description: "d".repeat(2001) },
  ]) {
    const refused = await x.post(FEEDBACK, body);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: "invalid_request" });
  }
  expect(asked).toBe(0);
  expect(x.store.value.tenants[SHARED_TENANT]?.feedback ?? []).toEqual([]);
});
