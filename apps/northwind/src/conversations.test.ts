import { expect, it } from "vitest";
import { inject, setup } from "./test-harness.ts";

const BASE = "/poppy/conversations";
let sequence = 0;
const message = (data: Record<string, unknown>) => ({
  id: `req_northwind_${++sequence}`,
  message: { author: { type: "agent" }, data },
});
type Event = {
  type: string;
  scope?: string;
  message?: {
    role: string;
    text?: string;
    data?: Record<string, unknown>;
    author: { name?: string };
  };
};
type Read = { conversation_id: string; events: Event[]; cursor: string };

it("advertises and answers deterministic signed-out travel desk requests", async () => {
  const x = await setup();
  const discovery = (await inject("/.well-known/poppy.json")).json();
  expect(discovery.agent.protocols[0]).toMatchObject({
    type: "poppy",
    endpoint: "http://northwind.localhost:4400/poppy/conversations",
  });
  const started = await x.call(
    "",
    "POST",
    `${BASE}?wait=0`,
    message({
      request: "flight_status",
      flight_number: "NA 512",
      date: "2027-06-14",
    }),
  );
  expect(started.statusCode).toBe(201);
  const read = started.json() as Read;
  const reply = read.events.find(
    (event) => event.message?.role === "company",
  )!.message!;
  expect(reply.author.name).toBe("Northwind's automated travel desk");
  expect(reply.data?.flight).toMatchObject({ status: "delayed", gate: "E04" });
});

it("uses authorization events for booking and loyalty scopes", async () => {
  const x = await setup();
  const started = (
    await x.call(
      "",
      "POST",
      `${BASE}?wait=0`,
      message({ request: "trip_summary" }),
    )
  ).json() as Read;
  expect(started.events.at(-1)).toMatchObject({
    type: "authorization",
    scope: "bookings:read",
  });
  const read = await x.sign("robin", false);
  const continued = (
    await x.call(
      read.access_token,
      "POST",
      `${BASE}/${started.conversation_id}/messages?wait=0&cursor=${started.cursor}`,
      message({ request: "trip_summary" }),
    )
  ).json() as Read;
  const reply = continued.events.find(
    (event) => event.message?.role === "company",
  )!.message!;
  expect(reply.data?.booking).toMatchObject({ booking_reference: "NW4D8R" });
  expect(JSON.stringify(reply.data)).toContain("no real ticket is sold");
});

it("hands off to a fictional phone desk and closes", async () => {
  const x = await setup();
  const started = (
    await x.call("", "POST", BASE, message({ request: "help" }))
  ).json() as { conversation_id: string };
  const handoff = await x.call(
    "",
    "POST",
    `${BASE}/${started.conversation_id}/handoff?wait=0`,
    { id: `req_northwind_${++sequence}` },
  );
  expect(handoff.statusCode).toBe(202);
  expect(handoff.body).toContain("+1 555-0168");
  const closed = await x.call(
    "",
    "POST",
    `${BASE}/${started.conversation_id}/close`,
    { id: `req_northwind_${++sequence}` },
  );
  expect(closed.statusCode).toBe(202);
});
