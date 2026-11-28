import { expect, it, vi } from "vitest";
import { openApiTools } from "@poppy-lab/pap-client";
import { restartingStore } from "@poppy-lab/pap-company";
import { northwind } from "./northwind.ts";
import {
  bookElenaOnNa274,
  business,
  inject,
  lab,
  origin,
  setup,
} from "./test-harness.ts";

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
    // The protocol's own, for an agent's browser (§6).
    "poppy:browser-sign-in",
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
  // A topic is one of the listed ones, not any key an object inherits.
  for (const topic of ["constructor", "toString", "__proto__", "visas"]) {
    const unknown = await x.call(
      "",
      "GET",
      `/api/travel-information?topic=${topic}`,
    );
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json()).toEqual({ error: "unknown_topic" });
  }
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
  expect(seat.headers["www-authenticate"]).toBe(
    'DPoP error="insufficient_scope", scope="bookings:read preferences:write"',
  );
});

it("requires matching read and write scopes on every account proposal route", async () => {
  const x = await setup();
  const bookingsWriteOnly = await x.sign("elena", true, "bookings:change");
  expect(bookingsWriteOnly.scope).toBe("bookings:change");
  const prefsWriteOnly = await x.sign("elena", true, "preferences:write");
  expect(prefsWriteOnly.scope).toBe("preferences:write");
  const bookingsReadChange = await x.sign(
    "elena",
    true,
    "bookings:read bookings:change",
  );
  const bookingsReadPrefsWrite = await x.sign(
    "elena",
    true,
    "bookings:read preferences:write",
  );
  const profileReadPrefsWrite = await x.sign(
    "elena",
    true,
    "profile:read preferences:write",
  );
  const bookingsProfileReadPrefsWrite = await x.sign(
    "elena",
    true,
    "bookings:read profile:read preferences:write",
  );
  const robinChangeOnly = await x.sign("robin", true, "bookings:change");
  const robinReadChange = await x.sign(
    "robin",
    true,
    "bookings:read bookings:change",
  );

  const leakedBookingDetails = [
    "approval_required",
    "Elena Maren",
    "Robin Ito",
    "NW7K2P",
    "NW4D8R",
    "Gale Flex",
    "Breeze Saver",
    "62000",
    "18A",
    "27D",
    "upg_elena_1",
    "24800",
    "NA 402",
    "NA 118",
    "NA 274",
  ];
  const leakedPreferenceDetails = [
    "approval_required",
    "Elena Maren",
    "psg_elena",
    "vegetarian",
  ];

  const bookingProposals: Array<[string, string, Record<string, unknown>]> = [
    [
      bookingsWriteOnly.access_token,
      "/api/account/bookings/NW7K2P/baggage",
      { flight_id: "flt_na402_20270518", additional_pieces: 1 },
    ],
    [
      bookingsWriteOnly.access_token,
      "/api/account/bookings/NW7K2P/upgrade",
      { offer_id: "upg_elena_1" },
    ],
    [bookingsWriteOnly.access_token, "/api/account/bookings/NW7K2P/cancel", {}],
    [
      robinChangeOnly.access_token,
      "/api/account/bookings/NW4D8R/change-flight",
      toNa278,
    ],
  ];

  for (const [access, url, payload] of bookingProposals) {
    const denied = await x.call(access, "POST", url, payload);
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toEqual({ error: "insufficient_scope" });
    expect(denied.headers["www-authenticate"]).toBe(
      'DPoP error="insufficient_scope", scope="bookings:read bookings:change"',
    );
    for (const leaked of leakedBookingDetails)
      expect(denied.body).not.toContain(leaked);
  }

  // /seat returns current seat and booking details: needs bookings:read + preferences:write.
  for (const access of [
    prefsWriteOnly.access_token,
    profileReadPrefsWrite.access_token,
  ]) {
    const denied = await x.call(
      access,
      "POST",
      "/api/account/bookings/NW7K2P/seat",
      { flight_id: "flt_na402_20270518", seat: "14A" },
    );
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toEqual({ error: "insufficient_scope" });
    expect(denied.headers["www-authenticate"]).toBe(
      'DPoP error="insufficient_scope", scope="bookings:read preferences:write"',
    );
    for (const leaked of leakedBookingDetails)
      expect(denied.body).not.toContain(leaked);
  }

  // /preferences looks up the booking (status + passenger name) and returns
  // saved passenger preferences: needs bookings:read + profile:read + preferences:write.
  for (const access of [
    prefsWriteOnly.access_token,
    bookingsReadPrefsWrite.access_token,
    profileReadPrefsWrite.access_token,
  ]) {
    const denied = await x.call(
      access,
      "POST",
      "/api/account/bookings/NW7K2P/preferences",
      { meal: "vegan", assistance: "visual_guidance" },
    );
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toEqual({ error: "insufficient_scope" });
    expect(denied.headers["www-authenticate"]).toBe(
      'DPoP error="insufficient_scope", scope="bookings:read profile:read preferences:write"',
    );
    for (const leaked of leakedPreferenceDetails)
      expect(denied.body).not.toContain(leaked);
  }

  // Read+write tokens proceed to approval_required proposals.
  const seatProposal = await x.call(
    bookingsReadPrefsWrite.access_token,
    "POST",
    "/api/account/bookings/NW7K2P/seat",
    { flight_id: "flt_na402_20270518", seat: "14A" },
  );
  expect(seatProposal.statusCode).toBe(403);
  expect(seatProposal.json().error).toBe("approval_required");
  expect(seatProposal.json().operation.terms).toMatchObject({
    from_seat: "18A",
    to_seat: "14A",
  });

  const prefProposal = await x.call(
    bookingsProfileReadPrefsWrite.access_token,
    "POST",
    "/api/account/bookings/NW7K2P/preferences",
    { meal: "vegan", assistance: "visual_guidance" },
  );
  expect(prefProposal.statusCode).toBe(403);
  expect(prefProposal.json().error).toBe("approval_required");
  expect(prefProposal.json().operation.terms).toMatchObject({
    from: { meal: "vegetarian", assistance: "none" },
    to: { meal: "vegan", assistance: "visual_guidance" },
  });

  const bagProposal = await x.call(
    bookingsReadChange.access_token,
    "POST",
    "/api/account/bookings/NW7K2P/baggage",
    { flight_id: "flt_na402_20270518", additional_pieces: 1 },
  );
  expect(bagProposal.statusCode).toBe(403);
  expect(bagProposal.json().error).toBe("approval_required");
  expect(bagProposal.json().operation.terms).toMatchObject({
    current_checked_bags: 1,
    new_checked_bags: 2,
  });

  const changeProposal = await x.call(
    robinReadChange.access_token,
    "POST",
    "/api/account/bookings/NW4D8R/change-flight",
    toNa278,
  );
  expect(changeProposal.statusCode).toBe(403);
  expect(changeProposal.json().error).toBe("approval_required");
  expect(changeProposal.json().operation.terms).toMatchObject({
    booking_reference: "NW4D8R",
    amount_due_cents: 10500,
  });
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

const toNa278 = {
  old_flight_id: "flt_na274_20270603",
  new_flight_id: "flt_na278_20270603",
};

it("gives two customers changing to the same flight different seats, named in the terms", async () => {
  const x = await setup();
  const elena = await x.sign("elena", true);
  const robin = await x.sign("robin", true);
  await x.call(robin.access_token, "GET", "/api/account/bookings");
  bookElenaOnNa274();
  const elenaUrl = "/api/account/bookings/NW2E9S/change-flight";
  const robinUrl = "/api/account/bookings/NW4D8R/change-flight";
  const early = (
    await x.call(elena.access_token, "POST", elenaUrl, toNa278)
  ).json().operation;
  expect(early.terms).toMatchObject({
    from: { seat: "14A" },
    to: { seat: "12A" },
  });
  expect(early.summary).toContain("seat 12A is assigned on NA 278");
  const proposal = (
    await x.call(robin.access_token, "POST", robinUrl, toNa278)
  ).json().operation;
  expect(proposal.terms).toMatchObject({
    from: { seat: "27D" },
    to: { seat: "12A" },
  });
  const changed = await x.call(
    robin.access_token,
    "POST",
    robinUrl,
    toNa278,
    proposal,
  );
  expect(changed.json().data.itinerary[0].seat).toBe("12A");
  // Robin now holds the seat Elena was shown: her approval of it is refused.
  const refused = await x.call(
    elena.access_token,
    "POST",
    elenaUrl,
    toNa278,
    early,
  );
  expect(refused.statusCode).toBe(403);
  const fresh = refused.json().operation;
  expect(fresh.terms.to.seat).toBe("12C");
  const done = await x.call(
    elena.access_token,
    "POST",
    elenaUrl,
    toNa278,
    fresh,
  );
  expect(done.json().data.itinerary[0].seat).toBe("12C");
  const { inventory } = business();
  expect(inventory.flt_na278_20270603!.available_seats).not.toContain("12A");
  expect(inventory.flt_na278_20270603!.available_seats).not.toContain("12C");
  expect(inventory.flt_na274_20270603!.available_seats).toEqual(
    expect.arrayContaining(["14A", "27D"]),
  );
});

it("leaves the seat unassigned, and says so, when the new flight has no standard seat left", async () => {
  const x = await setup();
  const robin = await x.sign("robin", true);
  const url = "/api/account/bookings/NW4D8R/change-flight";
  await x.call(robin.access_token, "GET", "/api/account/bookings");
  business().inventory.flt_na278_20270603!.available_seats = [];
  const proposal = (
    await x.call(robin.access_token, "POST", url, toNa278)
  ).json().operation;
  expect(proposal.terms.to.seat).toBeNull();
  expect(proposal.summary).toContain("the seat is left unassigned");
  const done = await x.call(robin.access_token, "POST", url, toNa278, proposal);
  expect(done.json().data.itinerary[0]).toMatchObject({
    flight_number: "NA 278",
    seat: null,
  });
});

/** Asks for a change and approves the terms that come back. */
async function approve(
  x: Awaited<ReturnType<typeof setup>>,
  access: string,
  url: string,
  body: Record<string, unknown>,
) {
  const operation = (await x.call(access, "POST", url, body)).json().operation;
  return {
    operation,
    done: await x.call(access, "POST", url, body, operation),
  };
}

it("withdraws an upgrade offer with its flight and accepts none for a flight not booked", async () => {
  const x = await setup();
  const robin = await x.sign("robin", true);
  const elena = await x.sign("elena", true);
  const change = await approve(
    x,
    robin.access_token,
    "/api/account/bookings/NW4D8R/change-flight",
    toNa278,
  );
  expect(change.operation.terms.upgrade).toBe(
    "The upgrade offer for NA 274 does not carry over and is withdrawn.",
  );
  expect(change.operation.summary).toContain(change.operation.terms.upgrade);
  expect(change.done.json().data.upgrade_offer).toBeNull();
  const upgrade = await x.call(
    robin.access_token,
    "POST",
    "/api/account/bookings/NW4D8R/upgrade",
    { offer_id: "upg_robin_1" },
  );
  expect(upgrade.statusCode).toBe(404);
  expect(upgrade.json().error).toBe("upgrade_offer_not_found");
  // An offer saved before this rule may still name a flight that was changed.
  business().bookings.elena![0]!.upgrade_offer!.flight_id =
    "flt_na119_20270526";
  const stray = await x.call(
    elena.access_token,
    "POST",
    "/api/account/bookings/NW7K2P/upgrade",
    { offer_id: "upg_elena_1" },
  );
  expect(stray.statusCode).toBe(404);
});

it("moves an upgraded passenger back to the fare's cabin, says so, and keeps both cabin counts right", async () => {
  const x = await setup();
  const robin = await x.sign("robin", true);
  const base = "/api/account/bookings/NW4D8R";
  await approve(x, robin.access_token, `${base}/upgrade`, {
    offer_id: "upg_robin_1",
  });
  const change = await approve(
    x,
    robin.access_token,
    `${base}/change-flight`,
    toNa278,
  );
  expect(change.operation.terms).toMatchObject({
    from: { cabin: "Business" },
    to: { cabin: "Economy" },
    upgrade:
      "The Business upgrade is for NA 274 only: it does not carry over to NA 278 and is not refunded. You travel in Economy.",
  });
  expect(change.operation.summary).toContain(change.operation.terms.upgrade);
  expect(change.done.json().data.itinerary[0]).toMatchObject({
    flight_number: "NA 278",
    cabin: "Economy",
  });
  const { inventory } = business();
  expect(inventory.flt_na274_20270603).toMatchObject({
    economy_available: 19,
    business_available: 4,
  });
  expect(inventory.flt_na278_20270603).toMatchObject({
    economy_available: 17,
    business_available: 4,
  });
});

it("returns a cancelled booking's seats and cabin places to its flights", async () => {
  const x = await setup();
  const elena = await x.sign("elena", true);
  const robin = await x.sign("robin", true);
  await x.call(robin.access_token, "GET", "/api/account/bookings");
  bookElenaOnNa274();
  await approve(x, robin.access_token, "/api/account/bookings/NW4D8R/upgrade", {
    offer_id: "upg_robin_1",
  });
  const seatUrl = "/api/account/bookings/NW4D8R/seat";
  const elenasSeat = { flight_id: "flt_na274_20270603", seat: "14A" };
  expect(
    (await x.call(robin.access_token, "POST", seatUrl, elenasSeat)).json(),
  ).toEqual({ error: "seat_unavailable" });
  const cancelled = await approve(
    x,
    elena.access_token,
    "/api/account/bookings/NW2E9S/cancel",
    {},
  );
  // The seat Elena held is Robin's to choose now.
  expect(
    (await x.call(robin.access_token, "POST", seatUrl, elenasSeat)).json(),
  ).toMatchObject({
    error: "approval_required",
    operation: { terms: { from_seat: "27D", to_seat: "14A" } },
  });
  expect(cancelled.done.json().data).toMatchObject({
    status: "cancelled",
    itinerary: [{ flight_number: "NA 274", seat: null }],
    upgrade_offer: null,
  });
  // A cancelled booking's upgrade offer cannot be accepted.
  expect(
    (
      await x.call(
        elena.access_token,
        "POST",
        "/api/account/bookings/NW2E9S/upgrade",
        { offer_id: "upg_robin_1" },
      )
    ).json(),
  ).toEqual({ error: "booking_not_active" });
  await approve(
    x,
    robin.access_token,
    "/api/account/bookings/NW4D8R/cancel",
    {},
  );
  // Both passengers are off NA 274: one more Economy place than at the start
  // (Robin's own), and the Business place Robin's upgrade took is back.
  const search = await x.call(
    "",
    "GET",
    "/api/flights/search?origin=PAU&destination=SMR&date=2027-06-03",
  );
  const fares = search.json().itineraries[0].segments[0].fares;
  expect(fares[0]).toMatchObject({ cabin: "Economy", seats_left: 19 });
  expect(fares[2]).toMatchObject({ cabin: "Business", seats_left: 4 });
  expect(business().inventory.flt_na274_20270603!.available_seats).toEqual(
    expect.arrayContaining(["14A", "27D"]),
  );
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
    currency: "USD",
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
  // The cabin is each flight's. The fare names none, so nothing beside the
  // upgraded flight still says Economy, there or in the trips.
  expect(upgraded.json().data.fare).not.toHaveProperty("cabin");
  const trips = (
    await x.call(robin.access_token, "GET", "/api/account/bookings")
  ).json().trips;
  expect(trips[0].fare).not.toHaveProperty("cabin");
  expect(trips[0].itinerary[0].cabin).toBe("Business");

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

it("does not refund Elena's accepted upgrade on passenger cancellation and keeps replayed approval idempotent", async () => {
  const x = await setup();
  const elena = await x.sign("elena", true);
  const upgraded = await approve(
    x,
    elena.access_token,
    "/api/account/bookings/NW7K2P/upgrade",
    { offer_id: "upg_elena_1" },
  );
  expect(upgraded.done.statusCode).toBe(200);
  expect(upgraded.done.json().data.fare.paid_cents).toBe(86800);

  const cancelUrl = "/api/account/bookings/NW7K2P/cancel";
  const proposal = await x.call(elena.access_token, "POST", cancelUrl, {});
  expect(proposal.statusCode).toBe(403);
  const operation = proposal.json().operation;
  expect(operation.terms).toMatchObject({
    paid_cents: 86800,
    fare_paid_cents: 62000,
    baggage_paid_cents: 0,
    upgrade_paid_cents: 24800,
    cancellation_fee_cents: 5000,
    fare_refund_cents: 57000,
    baggage_refund_cents: 0,
    upgrade_refund_cents: 0,
    refund_cents: 57000,
  });
  expect(operation.terms.upgrade_refund_terms).toContain(
    "only if Northwind Air cancels",
  );
  expect(operation.summary).toContain("Refund USD 570.00");
  expect(operation.summary).toContain(
    "USD 248.00 upgrade is non-refundable on passenger cancellation",
  );

  const done = await x.call(
    elena.access_token,
    "POST",
    cancelUrl,
    {},
    operation,
  );
  expect(done.statusCode).toBe(200);
  expect(done.json().summary).toContain("simulated refund USD 570.00");
  expect(done.json().data).toMatchObject({
    status: "cancelled",
    cancellation: {
      paid_cents: 86800,
      fare_paid_cents: 62000,
      baggage_paid_cents: 0,
      upgrade_paid_cents: 24800,
      cancellation_fee_cents: 5000,
      fare_refund_cents: 57000,
      baggage_refund_cents: 0,
      upgrade_refund_cents: 0,
      refund_cents: 57000,
      currency: "USD",
    },
  });

  const versionAfterCancel = business().bookings.elena![0]!.version;
  const businessSeatsAfterCancel =
    business().inventory.flt_na118_20270518!.business_available;
  const replay = await x.call(
    elena.access_token,
    "POST",
    cancelUrl,
    {},
    operation,
  );
  expect(replay.statusCode).toBe(200);
  expect(replay.json()).toEqual(done.json());
  expect(business().bookings.elena![0]!.version).toBe(versionAfterCancel);
  expect(business().inventory.flt_na118_20270518!.business_available).toBe(
    businessSeatsAfterCancel,
  );
});

it("refunds Robin's paid baggage on a SAVER booking only when cancelled at least 24 hours before departure", async () => {
  // NA 274 departs 2027-06-03T09:45:00-04:00 (2027-06-03T13:45:00.000Z).
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    // 24 hours and 1 minute before departure: bag is refundable + USD 42.00 fare tax refund.
    vi.setSystemTime(new Date("2027-06-02T13:44:00.000Z"));
    const xEarly = await setup();
    const robinEarly = await xEarly.sign("robin", true);
    await approve(
      xEarly,
      robinEarly.access_token,
      "/api/account/bookings/NW4D8R/baggage",
      { flight_id: "flt_na274_20270603", additional_pieces: 1 },
    );
    const cancelUrl = "/api/account/bookings/NW4D8R/cancel";
    const earlyOp = (
      await xEarly.call(robinEarly.access_token, "POST", cancelUrl, {})
    ).json().operation;
    expect(earlyOp.terms).toMatchObject({
      paid_cents: 30400,
      fare_paid_cents: 25900,
      baggage_paid_cents: 4500,
      upgrade_paid_cents: 0,
      cancellation_fee_cents: 21700,
      fare_refund_cents: 4200,
      baggage_refund_cents: 4500,
      upgrade_refund_cents: 0,
      refund_cents: 8700,
    });
    expect(earlyOp.summary).toContain("Refund USD 87.00");
    expect(earlyOp.summary).toContain("USD 42.00 unused taxes");
    expect(earlyOp.summary).toContain("USD 45.00 refundable baggage");

    const earlyDone = await xEarly.call(
      robinEarly.access_token,
      "POST",
      cancelUrl,
      {},
      earlyOp,
    );
    expect(earlyDone.statusCode).toBe(200);
    expect(earlyDone.json().summary).toContain("simulated refund USD 87.00");
    expect(earlyDone.json().data.cancellation).toMatchObject({
      fare_refund_cents: 4200,
      baggage_refund_cents: 4500,
      upgrade_refund_cents: 0,
      refund_cents: 8700,
    });
    // Replaying the approved cancellation returns the exact first response.
    const earlyReplay = await xEarly.call(
      robinEarly.access_token,
      "POST",
      cancelUrl,
      {},
      earlyOp,
    );
    expect(earlyReplay.statusCode).toBe(200);
    expect(earlyReplay.json()).toEqual(earlyDone.json());

    // Crossing the 24-hour cutoff invalidates an earlier proposal and quotes USD 42.00 only.
    vi.setSystemTime(new Date("2027-06-02T13:44:00.000Z"));
    const xLate = await setup();
    const robinLate = await xLate.sign("robin", true);
    await approve(
      xLate,
      robinLate.access_token,
      "/api/account/bookings/NW4D8R/baggage",
      { flight_id: "flt_na274_20270603", additional_pieces: 1 },
    );
    const beforeCutoff = (
      await xLate.call(robinLate.access_token, "POST", cancelUrl, {})
    ).json().operation;
    expect(beforeCutoff.terms.refund_cents).toBe(8700);

    // 23 hours and 59 minutes before departure: bag is no longer refundable, fare tax refund stays USD 42.00.
    vi.setSystemTime(new Date("2027-06-02T13:46:00.000Z"));
    const stale = await xLate.call(
      robinLate.access_token,
      "POST",
      cancelUrl,
      {},
      beforeCutoff,
    );
    expect(stale.statusCode).toBe(403);
    const lateOp = stale.json().operation;
    expect(lateOp.revision).not.toBe(beforeCutoff.revision);
    expect(lateOp.terms).toMatchObject({
      paid_cents: 30400,
      fare_paid_cents: 25900,
      baggage_paid_cents: 4500,
      upgrade_paid_cents: 0,
      cancellation_fee_cents: 21700,
      fare_refund_cents: 4200,
      baggage_refund_cents: 0,
      upgrade_refund_cents: 0,
      refund_cents: 4200,
    });
    expect(lateOp.summary).toContain("Refund USD 42.00");
    expect(lateOp.summary).toContain("non-refundable within 24 hours");

    const lateDone = await xLate.call(
      robinLate.access_token,
      "POST",
      cancelUrl,
      {},
      lateOp,
    );
    expect(lateDone.statusCode).toBe(200);
    expect(lateDone.json().summary).toContain("simulated refund USD 42.00");
    expect(lateDone.json().data.cancellation).toMatchObject({
      fare_refund_cents: 4200,
      baggage_refund_cents: 0,
      upgrade_refund_cents: 0,
      refund_cents: 4200,
    });
    expect(
      (
        await xLate.call(robinLate.access_token, "POST", cancelUrl, {}, lateOp)
      ).json(),
    ).toEqual(lateDone.json());
  } finally {
    vi.useRealTimers();
  }
});

it("defaults payment breakdown from paid_cents for existing bookings without separate payment fields", async () => {
  const x = await setup();
  const elena = await x.sign("elena", true);
  await x.call(elena.access_token, "GET", "/api/account/bookings");
  const legacy = business().bookings.elena![0]!;
  delete legacy.fare_paid_cents;
  delete legacy.baggage_paid_cents;
  delete legacy.upgrade_paid_cents;
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
    fare_paid_cents: 62000,
    baggage_paid_cents: 0,
    upgrade_paid_cents: 0,
    cancellation_fee_cents: 5000,
    fare_refund_cents: 57000,
    refund_cents: 57000,
  });
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
  expect(change["x-poppy-scopes"]).toEqual([
    "bookings:read",
    "bookings:change",
  ]);
  expect(change.security).toEqual([
    { dpop: ["bookings:read", "bookings:change"] },
  ]);
  for (const [path, expected] of [
    [
      "/api/account/bookings/{booking_reference}/seat",
      ["bookings:read", "preferences:write"],
    ],
    [
      "/api/account/bookings/{booking_reference}/preferences",
      ["bookings:read", "profile:read", "preferences:write"],
    ],
    [
      "/api/account/bookings/{booking_reference}/baggage",
      ["bookings:read", "bookings:change"],
    ],
    [
      "/api/account/bookings/{booking_reference}/cancel",
      ["bookings:read", "bookings:change"],
    ],
    [
      "/api/account/bookings/{booking_reference}/upgrade",
      ["bookings:read", "bookings:change"],
    ],
    [
      "/api/account/bookings/{booking_reference}/change-flight",
      ["bookings:read", "bookings:change"],
    ],
  ] as const) {
    const op = spec.paths[path].post;
    expect(op["x-poppy-scopes"]).toEqual(expected);
    expect(op.security).toEqual([{ dpop: expected }]);
  }
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
    body: new URLSearchParams({
      account,
      login_token: login.split("=")[1]!,
    }).toString(),
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

it("accepts the login form for five minutes, across a restart, and gives an expired one a page with a way back", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
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
      .find((entry) => entry.startsWith("northwind_login="))!
      .split(";")[0]!;
    const token = login.split("=")[1]!;
    expect(await page.text()).toContain(
      `<input type="hidden" name="login_token" value="${token}">`,
    );
    const post = (fields: Record<string, string>, cookie = login) =>
      lab.app.request("/site/login", {
        method: "POST",
        headers: {
          cookie: `${browser}; ${cookie}`,
          origin,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ account: "robin", ...fields }).toString(),
      });
    // The Durable Object was dropped from memory while the form was open.
    await setup({ store: load(), isolation: "visitor" });
    vi.setSystemTime(Date.now() + 4 * 60000 + 59000);
    // A form that isn't this browser's own is refused.
    expect((await post({})).status).toBe(403);
    expect((await post({ login_token: token }, "")).status).toBe(403);
    const entered = await post({ login_token: token });
    expect(entered.status).toBe(302);
    expect(entered.headers.get("location")).toBe("/account");

    vi.setSystemTime(Date.now() + 2000);
    const late = await post({ login_token: token });
    expect(late.status).toBe(403);
    expect(late.headers.get("content-type")).toContain("text/html");
    const html = await late.text();
    expect(html).toContain("This login page has expired.");
    expect(html).toContain(
      '<a href="/site/login">Open the login page again</a>',
    );
    expect(html).toContain('<a class="brand" href="/">Northwind Air</a>');
  } finally {
    vi.useRealTimers();
  }
});

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
  // The page's own read of the account carries the list of connected
  // agents, in the consent page's words, so it shows with the page and
  // stays current.
  const agents = async () =>
    (
      (await (
        await lab.app.request("/site/state", {
          headers: { cookie: web.cookie },
        })
      ).json()) as { agents: Array<Record<string, unknown>> }
    ).agents;
  expect(await agents()).toMatchObject([
    {
      id: grants.grants[0]!.id,
      name: "Iris",
      host: "localhost:3000",
      client: "http://localhost:3000/agent/client.json",
      permissions: [
        "Read: Flights and fares; Your trips; Your profile.",
        "Propose changes: Your trips and preferences.",
      ],
      expires: expect.stringMatching(
        /^[A-Z][a-z]{2} \d{1,2}, \d{2}:\d{2} UTC$/,
      ),
    },
  ]);
  const page = await lab.app.request("/account", {
    headers: { cookie: web.cookie },
  });
  expect(await page.text()).not.toContain("load-access");
  expect(
    (
      await lab.app.request(`/site/access/${grants.grants[0]!.id}/revoke`, {
        method: "POST",
        headers: web.headers,
      })
    ).status,
  ).toBe(200);
  expect(await agents()).toEqual([]);
  expect(
    (await x.call(elena.access_token, "GET", "/api/account/bookings"))
      .statusCode,
  ).toBe(401);
});

it("opens the consent page on the passenger the gateway names, else on the first", () => {
  const page = (account?: string) =>
    northwind.consent({
      nonce: "n",
      passwordRequired: false,
      scopes: "bookings:read",
      client: "Iris",
      clientHost: "poppylab.dev",
      ...(account ? { account } : {}),
    });
  expect(page("robin")).toContain('id="account-robin" value="robin" checked>');
  expect(page("robin")).not.toContain('value="elena" checked');
  expect(page()).toContain('id="account-elena" value="elena" checked>');
});

it("answers a consent page that ran out with a page of the airline, and a tool with the error", async () => {
  await setup();
  // A page the airline no longer holds, from a browser without its cookie.
  const allow = (headers: Record<string, string>) =>
    inject({
      method: "POST",
      url: "/oauth/authorize",
      headers,
      payload: { nonce: "n".repeat(32), decision: "approve", account: "elena" },
    });
  const page = await allow({ origin, accept: "text/html,*/*;q=0.8" });
  expect(page.statusCode).toBe(400);
  expect(page.headers["content-type"]).toContain("text/html");
  expect(page.body).toContain(
    "<title>This page has expired · Northwind Air</title>",
  );
  expect(page.body).toContain('<span class="brand">Northwind Air</span>');
  expect(page.body).toContain(
    "connect to your Northwind account works for five minutes after it opens, and this one is older. Your answer arrived too late, so nothing was allowed and nothing has changed.</p><p>To connect the agent, go back to it and start the sign-in again.</p>",
  );
  expect(page.body).not.toMatch(/<form|<script|<button|n{32}/);
  expect(page.headers["content-security-policy"]).toContain(
    "font-src https://fonts.gstatic.com; form-action 'none'",
  );
  const tool = await allow({ origin });
  expect(tool.statusCode).toBe(400);
  expect(tool.json()).toEqual({ error: "invalid_request" });
  // A pushed request's page loaded again once the airline has forgotten it.
  const reload = (headers: Record<string, string>) =>
    inject({
      url: `/oauth/authorize?${new URLSearchParams({ client_id: "https://agent.example/client.json", request_uri: "urn:ietf:params:oauth:request_uri:gone" })}`,
      headers,
    });
  const again = await reload({ accept: "text/html,*/*;q=0.8" });
  expect(again.statusCode).toBe(400);
  expect(again.body).toContain(
    "<title>This page has expired · Northwind Air</title>",
  );
  expect(again.body).toContain(
    "connect to your Northwind account can be answered once, within five minutes of opening, and this one can&#39;t be shown again. Opening it again changed nothing.</p><p>To connect the agent, go back to it and start the sign-in again.</p>",
  );
  expect((await reload({})).json()).toEqual({ error: "invalid_request_uri" });
});

it("keeps the customer's record of an applied request and of who approved it after the gateway has forgotten the operation", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    const x = await setup();
    const elena = await x.sign("elena", true);
    const choose = (seat: string, approval?: Parameters<typeof x.call>[4]) =>
      x.call(
        elena.access_token,
        "POST",
        "/api/account/bookings/NW7K2P/seat",
        { flight_id: "flt_na402_20270518", seat },
        approval,
      );
    const op = (await choose("14A")).json().operation;
    expect((await choose("14A", op)).statusCode).toBe(200);
    const web = await webLogin("elena");
    const activity = async () =>
      (
        (await (
          await lab.app.request("/site/state", {
            headers: { cookie: web.cookie },
          })
        ).json()) as { activity: Array<Record<string, unknown>> }
      ).activity;
    const applied = {
      state: "succeeded",
      approver: "user",
      summary: op.summary,
    };
    expect(await activity()).toMatchObject([applied]);
    // Eleven minutes on, the next request makes the gateway forget the
    // performed operation. The customer's record of it stays.
    vi.setSystemTime(Date.now() + 11 * 60000);
    const next = (await choose("14C")).json().operation;
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
    // Once it runs out, the portal explains that it expired without changing anything.
    vi.setSystemTime(Date.now() + 11 * 60000);
    const expired = await activity();
    expect(expired[0]).toMatchObject({
      state: "expired",
      summary: next.summary,
      result: "The proposal expired. Nothing changed.",
    });
  } finally {
    vi.useRealTimers();
  }
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
  // The footer: what Northwind is, then the lab's groups, with this site as text.
  const foot = html.slice(html.indexOf("<footer>"));
  expect(foot).toContain(
    '<p class="lab-foot-name">Northwind Air</p><p>Northwind Air is a fictional airline for testing personal agents. No real flight, ticket, passenger record, loyalty balance, payment, cancellation or border advice exists.</p><p>Fictional assistance desk: <span class="mono">+1 555-0168</span>. Never enter a real booking reference, passport, payment card, medical record or account credential.</p><p>Part of <a href="http://localhost:3000">Poppy&nbsp;Lab</a>, an independent experiment that is not affiliated with or endorsed by the authors of the Personal Agent Protocol.',
  );
  expect(foot).toContain('<span aria-current="page">Northwind Air</span>');
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
