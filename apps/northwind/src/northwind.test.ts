import { expect, it, vi } from "vitest";
import { openApiTools } from "@poppy-lab/pap-client";
import { inject, lab, origin, setup } from "./test-harness.ts";

it("publishes Poppy 1.0 discovery, five differentiated scopes and excluded tasks", async () => {
  await setup();
  const discovery = (await inject("/.well-known/poppy.json")).json();
  expect(discovery).toMatchObject({
    protocol_version: "1.0",
    organization: { name: "Northwind Air", domain: "northwind.localhost:4400" },
    extensions: { operations: [{ version: "3" }] },
  });
  expect(Object.keys(discovery.auth.scopes)).toEqual([
    "flights:search",
    "bookings:read",
    "profile:read",
    "preferences:write",
    "bookings:change",
  ]);
  expect(discovery.auth.scope_hints).toMatchObject({
    "flights:search": { changes: "none", personal_data: false },
    "preferences:write": { changes: "reversible", personal_data: true },
    "bookings:change": { changes: "irreversible", personal_data: true },
  });
  const tasks = (await inject("/poppy/tasks")).json().excluded_tasks;
  expect(tasks.map((task: { task: string }) => task.task)).toEqual(
    expect.arrayContaining([
      "Decide whether a passenger is eligible for a visa or transit visa",
      "Guarantee entry at a border or destination",
      "Make a legal-name change on a booking",
      "Verify passports, visas, medical certificates or identity documents",
    ]),
  );
});

it("serves signed-out search, cheapest dates, status, information and fictional booking lookup", async () => {
  const x = await setup();
  const search = await x.call(
    "",
    "GET",
    "/api/flights/search?origin=PAU&destination=SMR&date=2027-06-03",
  );
  expect(search.statusCode).toBe(200);
  expect(search.json().itineraries).toHaveLength(2);
  const cheapest = (
    await x.call(
      "",
      "GET",
      "/api/flights/cheapest-dates?origin=PAU&destination=SMR&month=2027-06",
    )
  ).json();
  expect(cheapest.dates[0]).toMatchObject({
    date: "2027-06-03",
    from_cents: 25900,
  });
  expect(
    (
      await x.call(
        "",
        "GET",
        "/api/flights/status?flight_number=NA%20512&date=2027-06-14",
      )
    ).json(),
  ).toMatchObject({ status: "delayed", gate: "E04" });
  expect(
    (await x.call("", "GET", "/api/travel-information?topic=baggage")).json()
      .text,
  ).toContain("USD 45.00");
  const lookup = await x.call(
    "",
    "GET",
    "/api/bookings/lookup?booking_reference=NW7K2P&surname=Maren",
  );
  expect(lookup.json()).toMatchObject({
    booking_reference: "NW7K2P",
    status: "confirmed",
    passenger: "E. Maren",
  });
  expect(lookup.body).toContain("no real ticket is sold");
});

it("enforces booking and profile read scopes independently", async () => {
  const x = await setup();
  const challenge = await x.call("", "GET", "/api/account/bookings");
  expect(challenge.statusCode).toBe(401);
  expect(challenge.headers["www-authenticate"]).toBe(
    'DPoP scope="bookings:read"',
  );
  const elena = await x.sign("elena", false);
  expect(elena.scope).toBe("flights:search bookings:read profile:read");
  expect(
    (await x.call(elena.access_token, "GET", "/api/account/bookings"))
      .statusCode,
  ).toBe(200);
  expect(
    (await x.call(elena.access_token, "GET", "/api/account/loyalty")).json(),
  ).toMatchObject({ tier: "Silver Current", points: 28400 });
  const seat = await x.call(
    elena.access_token,
    "POST",
    "/api/account/bookings/NW7K2P/seat",
    { flight_id: "flt_na402_20270518", seat: "14A" },
  );
  expect(seat.statusCode).toBe(403);
  expect(seat.json().error).toBe("insufficient_scope");
  expect(seat.headers["www-authenticate"]).toContain("preferences:write");
});

it("chooses a seat only after approval and replays the first result", async () => {
  const x = await setup();
  const elena = await x.sign("elena", true);
  expect(elena.scope).toContain("preferences:write");
  const url = "/api/account/bookings/NW7K2P/seat";
  const body = { flight_id: "flt_na402_20270518", seat: "14A" };
  const proposal = await x.call(elena.access_token, "POST", url, body);
  expect(proposal.statusCode).toBe(403);
  const operation = proposal.json().operation;
  expect(operation.terms).toMatchObject({
    from_seat: "18A",
    to_seat: "14A",
    fee_cents: 0,
  });
  const before = (
    await x.call(elena.access_token, "GET", "/api/account/bookings/NW7K2P")
  ).json();
  expect(before.itinerary[0].seat).toBe("18A");
  const done = await x.call(elena.access_token, "POST", url, body, operation);
  expect(done.statusCode).toBe(200);
  expect(done.json().data.itinerary[0].seat).toBe("14A");
  expect(
    (await x.call(elena.access_token, "POST", url, body, operation)).json(),
  ).toEqual(done.json());
});

it("invalidates a flight-change proposal when inventory price changes and requires fresh approval", async () => {
  const x = await setup();
  const robin = await x.sign("robin", true);
  const url = "/api/account/bookings/NW4D8R/change-flight";
  const body = {
    old_flight_id: "flt_na274_20270603",
    new_flight_id: "flt_na278_20270603",
  };
  const first = await x.call(robin.access_token, "POST", url, body);
  const oldOperation = first.json().operation;
  expect(oldOperation.terms).toMatchObject({
    fare_difference_cents: 3000,
    change_fee_cents: 7500,
    amount_due_cents: 10500,
  });
  const business = lab.store.value.tenants.shared!.business as {
    inventory: Record<string, { economy_cents: number; version: number }>;
  };
  business.inventory.flt_na278_20270603!.economy_cents += 2000;
  business.inventory.flt_na278_20270603!.version++;
  const stale = await x.call(
    robin.access_token,
    "POST",
    url,
    body,
    oldOperation,
  );
  expect(stale.statusCode).toBe(403);
  const fresh = stale.json().operation;
  expect(fresh.operation_id).toBe(oldOperation.operation_id);
  expect(fresh.revision).not.toBe(oldOperation.revision);
  expect(fresh.terms.amount_due_cents).toBe(12500);
  const done = await x.call(robin.access_token, "POST", url, body, fresh);
  expect(done.statusCode).toBe(200);
  expect(done.json().data.itinerary[0].flight_number).toBe("NA 278");
  expect(
    (await x.call(robin.access_token, "POST", url, body, fresh)).json(),
  ).toEqual(done.json());
});

it("returns exact baggage, preference, upgrade and cancellation terms", async () => {
  const x = await setup();
  const elena = await x.sign("elena", true);
  const bag = (
    await x.call(
      elena.access_token,
      "POST",
      "/api/account/bookings/NW7K2P/baggage",
      { flight_id: "flt_na402_20270518", additional_pieces: 2 },
    )
  ).json().operation;
  expect(bag.terms).toMatchObject({
    amount_due_cents: 9000,
    current_checked_bags: 1,
    new_checked_bags: 3,
  });
  expect(bag.terms.refund_terms).toContain("24 hours");
  const preference = (
    await x.call(
      elena.access_token,
      "POST",
      "/api/account/bookings/NW7K2P/preferences",
      { meal: "vegan", assistance: "visual_guidance" },
    )
  ).json().operation;
  expect(preference.terms).toMatchObject({
    fee_cents: 0,
    to: { meal: "vegan", assistance: "visual_guidance" },
  });
  const upgrade = (
    await x.call(
      elena.access_token,
      "POST",
      "/api/account/bookings/NW7K2P/upgrade",
      { offer_id: "upg_elena_1" },
    )
  ).json().operation;
  expect(upgrade.terms).toMatchObject({ amount_due_cents: 24800 });
  expect(upgrade.terms.refund_terms).toContain("only if Northwind Air cancels");
  const cancel = (
    await x.call(
      elena.access_token,
      "POST",
      "/api/account/bookings/NW7K2P/cancel",
      {},
    )
  ).json().operation;
  expect(cancel.terms).toMatchObject({
    paid_cents: 62000,
    cancellation_fee_cents: 5000,
    refund_cents: 57000,
  });
  expect(cancel.terms.finality).toContain("cannot be undone");
});

it("accepts an upgrade and cancels a booking once after exact approval", async () => {
  const x = await setup();
  const robin = await x.sign("robin", true);
  const upgradeUrl = "/api/account/bookings/NW4D8R/upgrade";
  const upgradeBody = { offer_id: "upg_robin_1" };
  const upgrade = (
    await x.call(robin.access_token, "POST", upgradeUrl, upgradeBody)
  ).json().operation;
  const upgraded = await x.call(
    robin.access_token,
    "POST",
    upgradeUrl,
    upgradeBody,
    upgrade,
  );
  expect(upgraded.json().data.itinerary[0].cabin).toBe("Business");

  const x2 = await setup();
  const elena = await x2.sign("elena", true);
  const cancelUrl = "/api/account/bookings/NW7K2P/cancel";
  const cancellation = (
    await x2.call(elena.access_token, "POST", cancelUrl, {})
  ).json().operation;
  const cancelled = await x2.call(
    elena.access_token,
    "POST",
    cancelUrl,
    {},
    cancellation,
  );
  expect(cancelled.json().data.status).toBe("cancelled");
  expect(cancelled.json().summary).toContain("simulated refund USD 570.00");
});

it("serves a detailed OpenAPI contract suitable for Iris", async () => {
  await setup();
  const spec = (await inject("/openapi.json")).json();
  expect(spec.info).toEqual({ title: "Northwind Air", version: "1.0.0" });
  expect(Object.keys(spec.paths)).toHaveLength(15);
  const change =
    spec.paths["/api/account/bookings/{booking_reference}/change-flight"].post;
  expect(change.operationId).toBe("change_flight");
  expect(change["x-poppy-proposal"]).toBe(true);
  expect(change.security).toEqual([{ dpop: ["bookings:change"] }]);
  expect(
    change.requestBody.content["application/json"].schema.required,
  ).toEqual(["old_flight_id", "new_flight_id"]);
  expect(change.description).toContain("exact Operations v3 terms");
  expect(
    spec.paths["/api/flights/search"].get.parameters.map(
      (parameter: { name: string }) => parameter.name,
    ),
  ).toEqual(["origin", "destination", "date"]);
  const tools = openApiTools(spec, `${origin}/openapi.json`, {
    allowProposals: true,
    blockedPaths: [],
    trace: vi.fn(),
    request: vi.fn(async () => ({ ok: true })),
  });
  expect(Object.keys(tools).sort()).toEqual(
    [
      "search_flights",
      "cheapest_dates",
      "flight_status",
      "travel_information",
      "booking_lookup",
      "upcoming_trips",
      "booking_details",
      "loyalty_account",
      "passenger_preferences",
      "choose_seat",
      "add_baggage",
      "set_travel_preferences",
      "cancel_booking",
      "accept_upgrade",
      "change_flight",
    ].sort(),
  );
});

async function webLogin(account: string) {
  const page = await inject("/site/login");
  const login = String(page.headers["set-cookie"]).split(";")[0]!;
  const response = await lab.app.request("/site/login", {
    method: "POST",
    headers: {
      cookie: login,
      origin,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ account }).toString(),
    redirect: "manual",
  });
  const web = response.headers
    .getSetCookie()
    .find((entry) => entry.startsWith("northwind_web="))!
    .split(";")[0]!;
  return {
    cookie: web,
    headers: { cookie: web, origin, "X-Northwind-Account": account },
  };
}

it("customer portal uses the same booking and loyalty state as the APIs and revokes grants", async () => {
  const x = await setup();
  const elena = await x.sign("elena", true);
  const web = await webLogin("elena");
  const state = (await (
    await lab.app.request("/site/state", { headers: { cookie: web.cookie } })
  ).json()) as {
    bookings: Array<{
      booking_reference: string;
      itinerary: Array<{ seat: string }>;
    }>;
    loyalty: { points: number };
  };
  expect(state.bookings[0]).toMatchObject({ booking_reference: "NW7K2P" });
  expect(state.bookings[0]!.itinerary[0]!.seat).toBe("18A");
  expect(state.loyalty.points).toBe(28400);
  const seatUrl = "/api/account/bookings/NW7K2P/seat";
  const seatBody = { flight_id: "flt_na402_20270518", seat: "14C" };
  const operation = (
    await x.call(elena.access_token, "POST", seatUrl, seatBody)
  ).json().operation;
  await x.call(elena.access_token, "POST", seatUrl, seatBody, operation);
  const after = (await (
    await lab.app.request("/site/state", { headers: { cookie: web.cookie } })
  ).json()) as {
    bookings: Array<{ itinerary: Array<{ seat: string }> }>;
    activity: Array<{ state: string }>;
  };
  expect(after.bookings[0]!.itinerary[0]!.seat).toBe("14C");
  expect(after.activity[0]!.state).toBe("succeeded");
  const grants = (await (
    await lab.app.request("/site/access", { headers: { cookie: web.cookie } })
  ).json()) as { grants: Array<{ id: string }> };
  expect(grants.grants).toHaveLength(1);
  expect(
    (
      await lab.app.request(`/site/access/${grants.grants[0]!.id}/revoke`, {
        method: "POST",
        headers: web.headers,
      })
    ).status,
  ).toBe(200);
  expect(
    (await x.call(elena.access_token, "GET", "/api/account/bookings"))
      .statusCode,
  ).toBe(401);
});

it("serves responsive website, consent and account scripts with honest notices", async () => {
  await setup();
  const home = await lab.app.request("/");
  expect(home.status).toBe(200);
  expect(home.headers.get("content-security-policy")).toContain(
    "font-src https://fonts.gstatic.com",
  );
  const html = await home.text();
  expect(html).toContain('action="/flights"');
  expect(html).not.toContain("Poppy 1.0");
  expect(html).toContain(
    "No real ticket is sold, changed, cancelled or charged",
  );
  expect(html).toContain("PAU — Port Aurora");
  const results = await (
    await lab.app.request("/flights?origin=PAU&destination=NTH&date=2027-05-18")
  ).text();
  expect(results).toContain("Port Aurora to Northhaven");
  expect(results).toContain("1 stop in Cinder Bay");
  expect(results).toContain("NA 118");
  const none = await (
    await lab.app.request(
      "/flights?origin=%3Cscript%3E&destination=SMR&date=2027-01-01",
    )
  ).text();
  expect(none).toContain("No Northwind flights on that day");
  expect(none).not.toContain("<script>");
  const agents = await lab.app.request("/for-agents");
  expect(await agents.text()).toContain("bookings:change");
  const script = await (await lab.app.request("/site/app.js")).text();
  expect(() => new Function(script)).not.toThrow();
  const { readFileSync } = await import("node:fs");
  const { render, source, target } = await import("../scripts/site-script.mjs");
  expect(readFileSync(target, "utf8")).toBe(
    render(readFileSync(source, "utf8")),
  );
});
