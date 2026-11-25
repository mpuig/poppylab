/**
 * Northwind Air: a fully fictional PAP 1.0 airline Company. It uses the shared
 * gateway for discovery, Direct Sign-In, Sessions, DPoP tokens, conversations
 * and Operations v3. No endpoint sells, changes, cancels or charges a real ticket.
 */
import type { Context, Hono } from "hono";
import type {
  CompanyDefinition,
  ConversationHandler,
  FeedbackReport,
  Gate,
  GrantAccess,
  OperationRecord,
  Session,
} from "@poppy-lab/pap-company";
import {
  airports,
  customers,
  fareBrands,
  FICTION_NOTICE,
  flightSchedule,
  northwindPersona,
  PHONE,
  PHONE_HOURS,
  travelInformationFor,
  type PassengerPreference,
  type SeedBooking,
} from "./data.ts";
import {
  consentPage,
  fontSources,
  flightsPage,
  forAgentsPage,
  homePage,
  pageHeaders,
} from "./site.ts";
import { howItWorksPage, type AgentGuide } from "./how-it-works.ts";
import { mountPortal } from "./portal.ts";
import { northwindAgent } from "./agent.ts";

export { airports, customers, fareBrands, flightSchedule } from "./data.ts";

export type FlightInventory = {
  version: number;
  economy_cents: number;
  business_cents: number;
  economy_available: number;
  business_available: number;
  available_seats: string[];
  status: string;
  gate: string;
};
export type Booking = Omit<SeedBooking, "preference"> & {
  version: number;
  status: "confirmed" | "cancelled";
  preference: PassengerPreference;
  cabins: Record<string, "Economy" | "Business">;
};
type State = {
  bookings?: Record<string, Booking[]>;
  inventory?: Record<string, FlightInventory>;
};

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const usd = (cents: number) => `USD ${(cents / 100).toFixed(2)}`;
/** The refund terms of an upgrade: in the proposal the passenger approves, and on "How it works". */
const UPGRADE_REFUND_TERMS =
  "The fictional upgrade is refundable only if Northwind Air cancels this segment.";
const dateOf = (iso: string) => iso.slice(0, 10);
const flightById = (id: string) =>
  flightSchedule.find((flight) => flight.id === id);
const airportByCode = (code: string) =>
  airports.find((airport) => airport.code === code);
/** The inventory count that a passenger in this cabin takes a seat from. */
const seatsLeft = (cabin: "Economy" | "Business") =>
  cabin === "Business" ? "business_available" : "economy_available";

const initialSeats = [
  "12A",
  "12C",
  "14A",
  "14C",
  "18A",
  "18C",
  "22A",
  "22C",
  "24D",
  "24F",
  "27D",
  "27F",
  "29A",
  "29C",
];

function seedInventory(): Record<string, FlightInventory> {
  return Object.fromEntries(
    flightSchedule.map((flight) => [
      flight.id,
      {
        version: 1,
        economy_cents: flight.economy_cents,
        business_cents: flight.business_cents,
        economy_available: 18,
        business_available: 4,
        available_seats: [...initialSeats],
        status: flight.status,
        gate: flight.gate,
      },
    ]),
  );
}
function seedBooking(seed: SeedBooking): Booking {
  return {
    ...seed,
    passenger: { ...seed.passenger },
    flight_ids: [...seed.flight_ids],
    seats: { ...seed.seats },
    baggage: { ...seed.baggage },
    preference: { ...seed.preference },
    ...(seed.upgrade_offer ? { upgrade_offer: { ...seed.upgrade_offer } } : {}),
    cabins: Object.fromEntries(seed.flight_ids.map((id) => [id, "Economy"])),
    version: 1,
    status: "confirmed",
  };
}
function flightView(id: string, inventory: Record<string, FlightInventory>) {
  const flight = flightById(id),
    stock = inventory[id];
  if (!flight || !stock) return undefined;
  return {
    id: flight.id,
    flight_number: flight.number,
    origin: airportByCode(flight.origin),
    destination: airportByCode(flight.destination),
    departure: flight.departure,
    arrival: flight.arrival,
    aircraft: flight.aircraft,
    status: stock.status,
    gate: stock.gate,
    inventory_version: stock.version,
    fares: [
      {
        fare: "Breeze Saver",
        fare_code: "SAVER",
        cabin: "Economy",
        price_cents: stock.economy_cents,
        seats_left: stock.economy_available,
      },
      {
        fare: "Gale Flex",
        fare_code: "FLEX",
        cabin: "Economy",
        price_cents: stock.economy_cents + 9600,
        seats_left: stock.economy_available,
      },
      {
        fare: "Aurora Business",
        fare_code: "AURORA",
        cabin: "Business",
        price_cents: stock.business_cents,
        seats_left: stock.business_available,
      },
    ],
    currency: "USD",
    note: FICTION_NOTICE,
  };
}
function bookingView(
  booking: Booking,
  inventory: Record<string, FlightInventory>,
) {
  const fare = fareBrands[booking.fare];
  return {
    booking_reference: booking.reference,
    status: booking.status,
    version: booking.version,
    passenger: booking.passenger,
    surname: booking.surname,
    itinerary: booking.flight_ids.map((id) => ({
      ...flightView(id, inventory),
      seat: booking.seats[id] ?? null,
      checked_bags: booking.baggage[id] ?? 0,
      cabin: booking.cabins[id] ?? fare.cabin,
    })),
    fare: {
      ...fare,
      paid_cents: booking.paid_cents,
      currency: "USD",
    },
    preference: booking.preference,
    upgrade_offer:
      booking.status === "confirmed" && booking.upgrade_offer
        ? {
            ...booking.upgrade_offer,
            currency: "USD",
            terms:
              "Upgrade applies to the named fictional segment only and is refundable only if Northwind Air cancels that segment.",
          }
        : null,
    note: FICTION_NOTICE,
  };
}

const publicGet = (
  operationId: string,
  summary: string,
  parameters: unknown[] = [],
) => ({
  get: {
    operationId,
    summary,
    description: `${summary} ${FICTION_NOTICE}`,
    "x-poppy-scopes": [],
    parameters,
    responses: { "200": { description: "Fictional Northwind Air data" } },
  },
});
const accountGet = (
  operationId: string,
  summary: string,
  scopes: string[],
  parameters: unknown[] = [],
) => ({
  get: {
    operationId,
    summary,
    description: `${summary} Read-only; ${FICTION_NOTICE}`,
    "x-poppy-scopes": scopes,
    security: [{ dpop: scopes }],
    parameters,
    responses: { "200": { description: "Fictional account data" } },
  },
});
const query = (
  name: string,
  description: string,
  schema: Record<string, unknown>,
) => ({
  name,
  in: "query",
  required: true,
  description,
  schema,
});
const bookingRef = {
  name: "booking_reference",
  in: "path",
  required: true,
  description: "Six-character fictional booking reference, for example NW7K2P.",
  schema: { type: "string", minLength: 6, maxLength: 6 },
};
const post = (
  operationId: string,
  summary: string,
  scopes: string[],
  schema: Record<string, unknown>,
) => ({
  post: {
    operationId,
    summary,
    description: `${summary} Nothing happens on the first call: Northwind returns exact Operations v3 terms for user approval. ${FICTION_NOTICE}`,
    "x-poppy-scopes": scopes,
    "x-poppy-proposal": true,
    security: [{ dpop: scopes }],
    parameters: [bookingRef],
    requestBody: {
      required: true,
      content: { "application/json": { schema } },
    },
    responses: {
      "200": { description: "Performed once after approval" },
      "403": {
        description:
          "approval_required: no change was made; review the exact revision and terms",
      },
      "409": {
        description:
          "The booking, price or inventory changed; request fresh terms and approval",
      },
    },
  },
});

export const northwindPaths = {
  "/api/flights/search": publicGet(
    "search_flights",
    "Search fictional scheduled flights by origin, destination and departure date.",
    [
      query("origin", "Fictional three-letter airport code.", {
        type: "string",
        enum: airports.map((airport) => airport.code),
      }),
      query("destination", "Fictional three-letter airport code.", {
        type: "string",
        enum: airports.map((airport) => airport.code),
      }),
      query("date", "Departure date in YYYY-MM-DD format.", {
        type: "string",
        format: "date",
      }),
    ],
  ),
  "/api/flights/cheapest-dates": publicGet(
    "cheapest_dates",
    "Suggest the lowest fictional fare dates for a route and month.",
    [
      query("origin", "Fictional three-letter airport code.", {
        type: "string",
        enum: airports.map((airport) => airport.code),
      }),
      query("destination", "Fictional three-letter airport code.", {
        type: "string",
        enum: airports.map((airport) => airport.code),
      }),
      query("month", "Month in YYYY-MM format.", {
        type: "string",
        minLength: 7,
        maxLength: 7,
      }),
    ],
  ),
  "/api/flights/status": publicGet(
    "flight_status",
    "Read the fictional status and gate for a flight number and date.",
    [
      query("flight_number", "Northwind flight number, for example NA 402.", {
        type: "string",
        maxLength: 12,
      }),
      query("date", "Departure date in YYYY-MM-DD format.", {
        type: "string",
        format: "date",
      }),
    ],
  ),
  "/api/travel-information": publicGet(
    "travel_information",
    "Read baggage, check-in or fare-condition information.",
    [
      query("topic", "Information topic.", {
        type: "string",
        enum: ["baggage", "check_in", "fares"],
      }),
    ],
  ),
  "/api/bookings/lookup": publicGet(
    "booking_lookup",
    "Look up a fictional booking using its booking reference and passenger surname.",
    [
      query("booking_reference", "Fictional six-character booking reference.", {
        type: "string",
        minLength: 6,
        maxLength: 6,
      }),
      query("surname", "Passenger surname on the fictional booking.", {
        type: "string",
        minLength: 2,
        maxLength: 80,
      }),
    ],
  ),
  "/api/account/bookings": accountGet(
    "upcoming_trips",
    "Read the signed-in customer's upcoming fictional trips.",
    ["bookings:read"],
  ),
  "/api/account/bookings/{booking_reference}": accountGet(
    "booking_details",
    "Read one fictional booking, its passengers, itinerary, fare, seats, bags and offers.",
    ["bookings:read"],
    [bookingRef],
  ),
  "/api/account/loyalty": accountGet(
    "loyalty_account",
    "Read loyalty points, tier and points due to expire.",
    ["profile:read"],
  ),
  "/api/account/preferences": accountGet(
    "passenger_preferences",
    "Read saved meal and non-medical assistance preferences.",
    ["profile:read"],
  ),
  "/api/account/bookings/{booking_reference}/seat": post(
    "choose_seat",
    "Choose or change a no-fee standard seat on one booked segment.",
    ["preferences:write"],
    {
      type: "object",
      properties: {
        flight_id: { type: "string", maxLength: 64 },
        seat: { type: "string", minLength: 2, maxLength: 3 },
      },
      required: ["flight_id", "seat"],
      additionalProperties: false,
    },
  ),
  "/api/account/bookings/{booking_reference}/baggage": post(
    "add_baggage",
    "Add one or two checked bags to one booked segment for an exact price.",
    ["bookings:change"],
    {
      type: "object",
      properties: {
        flight_id: { type: "string", maxLength: 64 },
        additional_pieces: { type: "integer", minimum: 1, maximum: 2 },
      },
      required: ["flight_id", "additional_pieces"],
      additionalProperties: false,
    },
  ),
  "/api/account/bookings/{booking_reference}/preferences": post(
    "set_travel_preferences",
    "Set a meal and a supported non-medical assistance preference.",
    ["preferences:write"],
    {
      type: "object",
      properties: {
        meal: {
          type: "string",
          enum: ["standard", "vegetarian", "vegan", "child"],
        },
        assistance: {
          type: "string",
          enum: [
            "none",
            "wheelchair_to_gate",
            "visual_guidance",
            "hearing_support",
          ],
        },
      },
      required: ["meal", "assistance"],
      additionalProperties: false,
    },
  ),
  "/api/account/bookings/{booking_reference}/cancel": post(
    "cancel_booking",
    "Cancel the entire fictional booking with exact fee and refund terms.",
    ["bookings:change"],
    { type: "object", properties: {}, additionalProperties: false },
  ),
  "/api/account/bookings/{booking_reference}/upgrade": post(
    "accept_upgrade",
    "Accept the booking's current fictional business-cabin upgrade offer.",
    ["bookings:change"],
    {
      type: "object",
      properties: { offer_id: { type: "string", maxLength: 80 } },
      required: ["offer_id"],
      additionalProperties: false,
    },
  ),
  "/api/account/bookings/{booking_reference}/change-flight": post(
    "change_flight",
    "Move one segment to another listed flight with exact fare difference, change fee and refund or amount due.",
    ["bookings:change"],
    {
      type: "object",
      properties: {
        old_flight_id: { type: "string", maxLength: 64 },
        new_flight_id: { type: "string", maxLength: 64 },
      },
      required: ["old_flight_id", "new_flight_id"],
      additionalProperties: false,
    },
  ),
};

function mount(
  app: Hono,
  ctx: {
    sessionFor: (c: Context) => Session;
    state: Record<string, unknown>;
    gate: Gate;
    grants: GrantAccess;
    origin: string;
    operations: () => Readonly<Record<string, OperationRecord>>;
    activity: Parameters<CompanyDefinition["mount"]>[1]["activity"];
    converse: (handler: ConversationHandler) => void;
    feedback: () => readonly FeedbackReport[];
  },
) {
  const state = ctx.state as State;
  const inventory = (state.inventory ??= seedInventory());
  const bookings = (state.bookings ??= {});
  const bookingsFor = (account: string) => {
    const customer = northwindPersona(account) ?? customers[0]!;
    return (bookings[account] ??= [seedBooking(customer.booking)]);
  };
  // Reserve each persona's current seat once the booking copy is created.
  for (const customer of customers)
    for (const booking of bookingsFor(customer.id))
      for (const [flightId, seat] of Object.entries(booking.seats)) {
        const available = inventory[flightId]?.available_seats;
        const index = available?.indexOf(seat) ?? -1;
        if (index >= 0) available!.splice(index, 1);
      }
  const account = (session: Session) => session.account ?? customers[0]!.id;
  const bookingOf = (session: Session, reference: string) =>
    bookingsFor(account(session)).find(
      (booking) => booking.reference === reference,
    );
  const allBookings = () =>
    customers.flatMap((customer) => bookingsFor(customer.id));

  mountPortal(app, ctx, {
    bookingsFor,
    inventory,
    bookingView,
  });
  ctx.converse(
    northwindAgent({
      booking: (accountId) =>
        bookingView(bookingsFor(accountId)[0]!, inventory),
      loyalty: (accountId) => northwindPersona(accountId)?.loyalty,
      status: (number, date) => {
        const flight = flightSchedule.find(
          (candidate) =>
            candidate.number.toLowerCase() === number.toLowerCase() &&
            dateOf(candidate.departure) === date,
        );
        return flight ? flightView(flight.id, inventory) : undefined;
      },
    }),
  );

  const searchFlights = (origin: string, destination: string, date: string) => {
    const direct = flightSchedule
      .filter(
        (flight) =>
          flight.origin === origin &&
          flight.destination === destination &&
          dateOf(flight.departure) === date,
      )
      .map((flight) => ({
        itinerary_id: `itin_${flight.id}`,
        segments: [flightView(flight.id, inventory)],
        from_cents: inventory[flight.id]!.economy_cents,
        currency: "USD",
      }));
    const connection =
      origin === "PAU" && destination === "NTH" && date === "2027-05-18"
        ? [
            {
              itinerary_id: "itin_pau_nth_20270518",
              segments: [
                flightView("flt_na402_20270518", inventory),
                flightView("flt_na118_20270518", inventory),
              ],
              from_cents:
                inventory.flt_na402_20270518!.economy_cents +
                inventory.flt_na118_20270518!.economy_cents,
              currency: "USD",
            },
          ]
        : [];
    return [...direct, ...connection];
  };
  app.get("/api/flights/search", (c) => {
    const origin = c.req.query("origin"),
      destination = c.req.query("destination"),
      date = c.req.query("date");
    if (!origin || !destination || !date)
      return c.json({ error: "origin_destination_and_date_required" }, 400);
    return c.json({
      itineraries: searchFlights(origin, destination, date),
      note: FICTION_NOTICE,
    });
  });
  // The website's search: the same results as the API, as a page for people.
  app.get("/flights", (c) => {
    const query = {
      origin: c.req.query("origin") ?? "",
      destination: c.req.query("destination") ?? "",
      date: (c.req.query("date") ?? "").slice(0, 10),
    };
    return c.html(
      flightsPage(
        ctx.origin,
        query,
        searchFlights(query.origin, query.destination, query.date),
      ),
      200,
      pageHeaders,
    );
  });
  app.get("/api/flights/cheapest-dates", (c) => {
    const origin = c.req.query("origin"),
      destination = c.req.query("destination"),
      month = c.req.query("month");
    if (!origin || !destination || !month)
      return c.json({ error: "origin_destination_and_month_required" }, 400);
    const dates = flightSchedule
      .filter(
        (flight) =>
          flight.origin === origin &&
          flight.destination === destination &&
          dateOf(flight.departure).startsWith(month),
      )
      .map((flight) => ({
        date: dateOf(flight.departure),
        from_cents: inventory[flight.id]!.economy_cents,
        currency: "USD",
        flight_id: flight.id,
      }))
      .sort((a, b) => a.from_cents - b.from_cents);
    return c.json({ dates, note: FICTION_NOTICE });
  });
  app.get("/api/flights/status", (c) => {
    const number = c.req.query("flight_number"),
      date = c.req.query("date");
    const flight = flightSchedule.find(
      (candidate) =>
        candidate.number.toLowerCase() === number?.toLowerCase() &&
        dateOf(candidate.departure) === date,
    );
    return flight
      ? c.json(flightView(flight.id, inventory))
      : c.json({ error: "flight_not_found" }, 404);
  });
  app.get("/api/travel-information", (c) => {
    const topic = c.req.query("topic");
    const information = travelInformationFor(topic);
    return information
      ? c.json({ topic, ...information, note: FICTION_NOTICE })
      : c.json({ error: "unknown_topic" }, 400);
  });
  app.get("/api/bookings/lookup", (c) => {
    const reference = c.req.query("booking_reference")?.toUpperCase(),
      surname = c.req.query("surname")?.toLowerCase();
    const booking = allBookings().find(
      (candidate) =>
        candidate.reference === reference &&
        candidate.surname.toLowerCase() === surname,
    );
    if (!booking) return c.json({ error: "booking_not_found" }, 404);
    return c.json({
      booking_reference: booking.reference,
      status: booking.status,
      passenger: `${booking.passenger.name[0]}. ${booking.surname}`,
      itinerary: booking.flight_ids.map((id) => flightView(id, inventory)),
      note: `${FICTION_NOTICE} Sign in for seats, baggage, fare and loyalty details.`,
    });
  });
  app.get("/api/account/bookings", (c) =>
    c.json({
      trips: bookingsFor(account(ctx.sessionFor(c))).map((booking) =>
        bookingView(booking, inventory),
      ),
    }),
  );
  app.get("/api/account/bookings/:booking_reference", (c) => {
    const booking = bookingOf(
      ctx.sessionFor(c),
      c.req.param("booking_reference"),
    );
    return booking
      ? c.json(bookingView(booking, inventory))
      : c.json({ error: "booking_not_found" }, 404);
  });
  app.get("/api/account/loyalty", (c) => {
    const customer = northwindPersona(account(ctx.sessionFor(c)))!;
    return c.json({ ...customer.loyalty, note: FICTION_NOTICE });
  });
  app.get("/api/account/preferences", (c) => {
    const booking = bookingsFor(account(ctx.sessionFor(c)))[0]!;
    return c.json({ preference: booking.preference, note: FICTION_NOTICE });
  });

  async function body(c: Context) {
    try {
      const value: unknown = await c.req.json();
      return object(value) ? value : undefined;
    } catch {
      return undefined;
    }
  }
  const findMutable = (c: Context) => {
    const booking = bookingOf(
      ctx.sessionFor(c),
      c.req.param("booking_reference") ?? "",
    );
    if (!booking) return { error: c.json({ error: "booking_not_found" }, 404) };
    if (booking.status !== "confirmed")
      return { error: c.json({ error: "booking_not_active" }, 409) };
    return { booking };
  };

  app.post("/api/account/bookings/:booking_reference/seat", async (c) => {
    const found = findMutable(c);
    if (found.error) return found.error;
    const booking = found.booking!,
      input = await body(c);
    const flightId = input?.flight_id,
      seat = input?.seat;
    if (
      typeof flightId !== "string" ||
      typeof seat !== "string" ||
      !booking.flight_ids.includes(flightId) ||
      !/^[1-9][0-9]?[A-F]$/.test(seat)
    )
      return c.json({ error: "invalid_seat_request" }, 400);
    const stock = inventory[flightId]!;
    if (booking.seats[flightId] === seat)
      return c.json({ error: "seat_already_selected" }, 400);
    if (!stock.available_seats.includes(seat))
      return c.json({ error: "seat_unavailable" }, 409);
    const terms = {
      booking_reference: booking.reference,
      booking_version: booking.version,
      flight_id: flightId,
      inventory_version: stock.version,
      from_seat: booking.seats[flightId] ?? null,
      to_seat: seat,
      fee_cents: 0,
      currency: "USD",
      reversibility:
        "May be changed again while another standard seat is available.",
      payment: "No payment; fictional booking only",
    };
    return ctx.gate(c, {
      key: `seat:${booking.reference}:${booking.version}`,
      terms,
      summary: `Change seat on ${flightById(flightId)!.number} from ${terms.from_seat ?? "unassigned"} to ${seat}. No fee. ${FICTION_NOTICE}`,
      perform: () => {
        const old = booking.seats[flightId];
        if (old) stock.available_seats.push(old);
        stock.available_seats.splice(stock.available_seats.indexOf(seat), 1);
        booking.seats[flightId] = seat;
        stock.version++;
        booking.version++;
        return {
          summary: `Seat changed to ${seat} on ${flightById(flightId)!.number}. ${FICTION_NOTICE}`,
          data: bookingView(booking, inventory),
        };
      },
      stale: (approved) =>
        booking.version !== approved.booking_version ||
        stock.version !== approved.inventory_version ||
        !stock.available_seats.includes(String(approved.to_seat)),
    });
  });

  app.post("/api/account/bookings/:booking_reference/baggage", async (c) => {
    const found = findMutable(c);
    if (found.error) return found.error;
    const booking = found.booking!,
      input = await body(c);
    const flightId = input?.flight_id,
      pieces = input?.additional_pieces;
    if (
      typeof flightId !== "string" ||
      !booking.flight_ids.includes(flightId) ||
      !Number.isSafeInteger(pieces) ||
      Number(pieces) < 1 ||
      Number(pieces) > 2
    )
      return c.json({ error: "invalid_baggage_request" }, 400);
    const price = Number(pieces) * 4500;
    const terms = {
      booking_reference: booking.reference,
      booking_version: booking.version,
      flight_id: flightId,
      current_checked_bags: booking.baggage[flightId] ?? 0,
      additional_pieces: Number(pieces),
      new_checked_bags: (booking.baggage[flightId] ?? 0) + Number(pieces),
      amount_due_cents: price,
      currency: "USD",
      refund_terms:
        "The fictional bag fee is refundable until 24 hours before departure; no real payment is taken.",
      payment: "Simulated card on file — no real charge",
    };
    return ctx.gate(c, {
      key: `baggage:${booking.reference}:${booking.version}`,
      terms,
      summary: `Add ${pieces} checked ${pieces === 1 ? "bag" : "bags"} to ${flightById(flightId)!.number} for ${usd(price)}. ${terms.refund_terms}`,
      perform: () => {
        booking.baggage[flightId] = terms.new_checked_bags;
        booking.paid_cents += price;
        booking.version++;
        return {
          summary: `Added ${pieces} checked ${pieces === 1 ? "bag" : "bags"} for ${usd(price)}. ${FICTION_NOTICE}`,
          data: bookingView(booking, inventory),
        };
      },
      stale: (approved) => booking.version !== approved.booking_version,
    });
  });

  app.post(
    "/api/account/bookings/:booking_reference/preferences",
    async (c) => {
      const found = findMutable(c);
      if (found.error) return found.error;
      const booking = found.booking!,
        input = await body(c);
      const meals = ["standard", "vegetarian", "vegan", "child"],
        assistance = [
          "none",
          "wheelchair_to_gate",
          "visual_guidance",
          "hearing_support",
        ];
      if (
        !meals.includes(String(input?.meal)) ||
        !assistance.includes(String(input?.assistance))
      )
        return c.json({ error: "invalid_preference" }, 400);
      const terms = {
        booking_reference: booking.reference,
        preference_version: booking.preference.version,
        passenger_id: booking.preference.passenger_id,
        from: {
          meal: booking.preference.meal,
          assistance: booking.preference.assistance,
        },
        to: {
          meal: String(input!.meal),
          assistance: String(input!.assistance),
        },
        fee_cents: 0,
        reversibility:
          "These non-medical preferences may be changed again until fictional check-in closes.",
      };
      if (JSON.stringify(terms.from) === JSON.stringify(terms.to))
        return c.json({ error: "preference_unchanged" }, 400);
      return ctx.gate(c, {
        key: `preferences:${booking.reference}:${booking.preference.version}`,
        terms,
        summary: `Set ${booking.passenger.name}'s meal to ${terms.to.meal} and assistance to ${terms.to.assistance}. No fee; reversible until fictional check-in closes.`,
        perform: () => {
          booking.preference.meal = terms.to
            .meal as PassengerPreference["meal"];
          booking.preference.assistance = terms.to
            .assistance as PassengerPreference["assistance"];
          booking.preference.version++;
          booking.version++;
          return {
            summary: `Passenger preferences updated. ${FICTION_NOTICE}`,
            data: booking.preference,
          };
        },
        stale: (approved) =>
          booking.preference.version !== approved.preference_version,
      });
    },
  );

  app.post("/api/account/bookings/:booking_reference/cancel", async (c) => {
    const found = findMutable(c);
    if (found.error) return found.error;
    const booking = found.booking!,
      input = await body(c);
    if (!input || Object.keys(input).length)
      return c.json({ error: "empty_object_required" }, 400);
    const fee =
      booking.fare === "SAVER"
        ? booking.paid_cents - 4200
        : booking.fare === "FLEX"
          ? 5000
          : 0;
    const refund = booking.fare === "SAVER" ? 4200 : booking.paid_cents - fee;
    const terms = {
      booking_reference: booking.reference,
      booking_version: booking.version,
      fare: fareBrands[booking.fare].name,
      paid_cents: booking.paid_cents,
      cancellation_fee_cents: fee,
      refund_cents: refund,
      currency: "USD",
      refund_method: "Simulated return to the card on file",
      finality:
        "Cancelling removes every segment from this fictional booking and cannot be undone. A new booking would need new terms.",
    };
    return ctx.gate(c, {
      key: `cancel:${booking.reference}:${booking.version}`,
      terms,
      summary: `Cancel booking ${booking.reference}. Refund ${usd(refund)} after a ${usd(fee)} fee. ${terms.finality} ${FICTION_NOTICE}`,
      perform: () => {
        // Each segment's seat and its place in the cabin go back on sale.
        for (const id of booking.flight_ids) {
          const stock = inventory[id]!,
            seat = booking.seats[id];
          if (seat) stock.available_seats.push(seat);
          delete booking.seats[id];
          stock[
            seatsLeft(booking.cabins[id] ?? fareBrands[booking.fare].cabin)
          ]++;
          stock.version++;
        }
        booking.status = "cancelled";
        booking.version++;
        return {
          summary: `Booking ${booking.reference} cancelled; simulated refund ${usd(refund)}. ${FICTION_NOTICE}`,
          data: bookingView(booking, inventory),
        };
      },
      stale: (approved) => booking.version !== approved.booking_version,
    });
  });

  app.post("/api/account/bookings/:booking_reference/upgrade", async (c) => {
    const found = findMutable(c);
    if (found.error) return found.error;
    const booking = found.booking!,
      input = await body(c),
      offer = booking.upgrade_offer;
    // An offer is for one booked segment: none is left once that flight is.
    if (
      !offer ||
      input?.offer_id !== offer.id ||
      !booking.flight_ids.includes(offer.flight_id)
    )
      return c.json({ error: "upgrade_offer_not_found" }, 404);
    const stock = inventory[offer.flight_id]!;
    if (stock.business_available < 1)
      return c.json({ error: "upgrade_unavailable" }, 409);
    const terms = {
      booking_reference: booking.reference,
      booking_version: booking.version,
      offer_id: offer.id,
      flight_id: offer.flight_id,
      inventory_version: stock.version,
      from_cabin: booking.cabins[offer.flight_id],
      to_cabin: "Business",
      amount_due_cents: offer.price_cents,
      currency: "USD",
      refund_terms: UPGRADE_REFUND_TERMS,
      payment: "Simulated card on file — no real charge",
    };
    return ctx.gate(c, {
      key: `upgrade:${booking.reference}:${booking.version}`,
      terms,
      summary: `Upgrade ${flightById(offer.flight_id)!.number} to Business for ${usd(offer.price_cents)}. ${terms.refund_terms}`,
      perform: () => {
        stock.business_available--;
        stock.economy_available++;
        stock.version++;
        booking.cabins[offer.flight_id] = "Business";
        booking.paid_cents += offer.price_cents;
        delete booking.upgrade_offer;
        booking.version++;
        return {
          summary: `Upgrade accepted for ${usd(offer.price_cents)}. ${FICTION_NOTICE}`,
          data: bookingView(booking, inventory),
        };
      },
      stale: (approved) =>
        booking.version !== approved.booking_version ||
        stock.version !== approved.inventory_version ||
        stock.business_available < 1 ||
        booking.upgrade_offer?.id !== approved.offer_id ||
        booking.upgrade_offer?.price_cents !== approved.amount_due_cents,
    });
  });

  app.post(
    "/api/account/bookings/:booking_reference/change-flight",
    async (c) => {
      const found = findMutable(c);
      if (found.error) return found.error;
      const booking = found.booking!,
        input = await body(c);
      const oldId = input?.old_flight_id,
        newId = input?.new_flight_id;
      if (
        typeof oldId !== "string" ||
        typeof newId !== "string" ||
        oldId === newId ||
        !booking.flight_ids.includes(oldId)
      )
        return c.json({ error: "invalid_flight_change" }, 400);
      const oldFlight = flightById(oldId),
        newFlight = flightById(newId);
      const oldStock = inventory[oldId],
        newStock = inventory[newId];
      const fare = fareBrands[booking.fare];
      // An upgrade is for its named segment only, so the passenger gives up
      // the cabin they are in and takes the fare's own cabin on the new flight.
      const oldCabin = booking.cabins[oldId] ?? fare.cabin,
        newCabin = fare.cabin;
      if (
        !oldFlight ||
        !newFlight ||
        !oldStock ||
        !newStock ||
        oldFlight.origin !== newFlight.origin ||
        oldFlight.destination !== newFlight.destination ||
        newStock[seatsLeft(newCabin)] < 1
      )
        return c.json({ error: "replacement_flight_unavailable" }, 409);
      // What the change does to the old flight's upgrade, or its offer of one.
      const upgrade =
        oldCabin !== newCabin
          ? `The ${oldCabin} upgrade is for ${oldFlight.number} only: it does not carry over to ${newFlight.number} and is not refunded. You travel in ${newCabin}.`
          : booking.upgrade_offer?.flight_id === oldId
            ? `The upgrade offer for ${oldFlight.number} does not carry over and is withdrawn.`
            : undefined;
      const oldPrice =
        oldStock.economy_cents + (booking.fare === "FLEX" ? 9600 : 0);
      const newPrice =
        newStock.economy_cents + (booking.fare === "FLEX" ? 9600 : 0);
      const difference = newPrice - oldPrice;
      const due = Math.max(0, difference + fare.change_fee_cents);
      const refund = Math.max(0, -difference - fare.change_fee_cents);
      // The User approves the seat they get: the first standard seat still
      // free on the new flight, or none when every one is taken.
      const oldSeat = booking.seats[oldId] ?? null,
        newSeat = newStock.available_seats[0] ?? null;
      const terms = {
        booking_reference: booking.reference,
        booking_version: booking.version,
        old_flight_id: oldId,
        new_flight_id: newId,
        old_inventory_version: oldStock.version,
        new_inventory_version: newStock.version,
        from: {
          flight_number: oldFlight.number,
          departure: oldFlight.departure,
          fare_cents: oldPrice,
          seat: oldSeat,
          cabin: oldCabin,
        },
        to: {
          flight_number: newFlight.number,
          departure: newFlight.departure,
          fare_cents: newPrice,
          seat: newSeat,
          cabin: newCabin,
        },
        change_fee_cents: fare.change_fee_cents,
        fare_difference_cents: difference,
        amount_due_cents: due,
        refund_cents: refund,
        currency: "USD",
        seat: newSeat
          ? `The current seat does not carry over; standard seat ${newSeat} is assigned on ${newFlight.number}.`
          : `The current seat does not carry over; no standard seat is free on ${newFlight.number}, so the seat is left unassigned.`,
        ...(upgrade ? { upgrade } : {}),
        payment: "Simulated card on file — no real charge or refund",
      };
      return ctx.gate(c, {
        key: `change-flight:${booking.reference}:${booking.version}`,
        terms,
        summary: `Change ${oldFlight.number} (${oldFlight.departure}) to ${newFlight.number} (${newFlight.departure}). Fare difference ${difference >= 0 ? usd(difference) + " more" : usd(-difference) + " less"}; change fee ${usd(fare.change_fee_cents)}; ${due ? `${usd(due)} due` : `${usd(refund)} refunded`}. ${terms.seat}${upgrade ? ` ${upgrade}` : ""} ${FICTION_NOTICE}`,
        perform: () => {
          const index = booking.flight_ids.indexOf(oldId);
          booking.flight_ids[index] = newId;
          if (oldSeat) oldStock.available_seats.push(oldSeat);
          delete booking.seats[oldId];
          if (newSeat) {
            newStock.available_seats.splice(
              newStock.available_seats.indexOf(newSeat),
              1,
            );
            booking.seats[newId] = newSeat;
          }
          booking.baggage[newId] = booking.baggage[oldId] ?? 0;
          delete booking.baggage[oldId];
          booking.cabins[newId] = newCabin;
          delete booking.cabins[oldId];
          if (booking.upgrade_offer?.flight_id === oldId)
            delete booking.upgrade_offer;
          booking.paid_cents += due - refund;
          booking.version++;
          oldStock[seatsLeft(oldCabin)]++;
          newStock[seatsLeft(newCabin)]--;
          oldStock.version++;
          newStock.version++;
          return {
            summary: `Flight changed to ${newFlight.number}; ${due ? `${usd(due)} simulated amount due` : `${usd(refund)} simulated refund`}. ${FICTION_NOTICE}`,
            data: bookingView(booking, inventory),
          };
        },
        stale: (approved) => {
          const to = approved.to as { fare_cents?: unknown; seat?: unknown };
          return (
            booking.version !== approved.booking_version ||
            oldStock.version !== approved.old_inventory_version ||
            newStock.version !== approved.new_inventory_version ||
            newStock[seatsLeft(newCabin)] < 1 ||
            newStock.economy_cents + (booking.fare === "FLEX" ? 9600 : 0) !==
              to.fare_cents ||
            // Someone else took the approved seat in the meantime.
            (typeof to.seat === "string" &&
              !newStock.available_seats.includes(to.seat))
          );
        },
      });
    },
  );
}

const scopes = [
  "flights:search",
  "bookings:read",
  "profile:read",
  "preferences:write",
  "bookings:change",
];

/** What "How it works" shows, read from this definition and the seeded booking. */
function agentGuide(origin: string): AgentGuide {
  const elena = customers[0]!;
  const { booking } = elena;
  const offer = booking.upgrade_offer;
  const flight = flightSchedule.find((f) => f.id === offer.flight_id)!;
  const airport = (code: string) => ({
    code,
    city: airports.find((a) => a.code === code)?.city ?? code,
  });
  const fare = fareBrands[booking.fare];
  const day = new Date(
    `${flight.departure.slice(0, 10)}T12:00:00Z`,
  ).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return {
    discovery: northwind.discovery(origin, new URL(origin).host),
    paths: northwindPaths as unknown as AgentGuide["paths"],
    excluded: (northwind.excludedTasks?.(origin) ?? []).map((task) =>
      String(task.task),
    ),
    phone: PHONE,
    example: {
      ask: `Upgrade my ${flight.number} flight to Business.`,
      booking: booking.reference,
      passenger: booking.passenger.name,
      flight: flight.number,
      from: airport(flight.origin),
      to: airport(flight.destination),
      departs: `${day} · ${flight.departure.slice(11, 16)}`,
      fromCabin: fare.name,
      toCabin: fareBrands.AURORA.name,
      cents: offer.price_cents,
      refund: UPGRADE_REFUND_TERMS,
    },
  };
}

export const northwind: CompanyDefinition = {
  name: "Northwind Air",
  readScope: "bookings:read",
  writeScope: "bookings:change",
  scopes,
  selectScopes: ({ requested, body }) => {
    const changeScopes = new Set(["preferences:write", "bookings:change"]);
    return requested.filter(
      (scope) => !changeScopes.has(scope) || body.write === "yes",
    );
  },
  requiredScopes: ({ path, method }) => {
    if (method === "GET")
      return path.startsWith("/api/account/loyalty") ||
        path.startsWith("/api/account/preferences")
        ? ["profile:read"]
        : ["bookings:read"];
    if (path.endsWith("/seat") || path.endsWith("/preferences"))
      return ["preferences:write"];
    return ["bookings:change"];
  },
  consent: consentPage,
  persona: northwindPersona,
  defaultAccount: "elena",
  paths: northwindPaths,
  mount,
  agent: {
    name: "Northwind's automated travel desk",
    handoff: {
      text: `Nobody can join this fictional conversation. Call ${PHONE} (${PHONE_HOURS}).`,
      data: { handoff: "unavailable", phone: PHONE, hours: PHONE_HOURS },
    },
  },
  discovery: (origin, domain) => ({
    protocol_version: "1.0",
    organization: { name: "Northwind Air", domain },
    auth: {
      issuer: origin,
      scopes: {
        "flights:search":
          "Search fictional flights and fare dates. Search also works signed out; this scope carries no personal data.",
        "bookings:read":
          "Read upcoming trips, booking details, seats, bags and fare terms.",
        "profile:read":
          "Read loyalty tier, points, expiring points and passenger preferences.",
        "preferences:write":
          "Choose a standard seat or change meal and supported non-medical assistance preferences. Reversible while available; every change needs approval.",
        "bookings:change":
          "Add paid baggage, cancel, accept an upgrade or change a flight. These can be irreversible or financially consequential; every change needs exact approval.",
      },
      scope_hints: {
        "flights:search": { changes: "none", personal_data: false },
        "bookings:read": { changes: "none", personal_data: true },
        "profile:read": { changes: "none", personal_data: true },
        "preferences:write": { changes: "reversible", personal_data: true },
        "bookings:change": { changes: "irreversible", personal_data: true },
      },
    },
    apis: [
      {
        type: "openapi",
        url: `${origin}/openapi.json`,
        description:
          "Fictional flight search, status, booking lookup, account trips, loyalty, preferences and approval-gated booking changes",
      },
    ],
    agent: {
      protocols: [
        {
          type: "poppy",
          endpoint: `${origin}/poppy/conversations`,
          description:
            'Northwind\'s deterministic travel desk: flight status, baggage/check-in/fare information, trip summaries and loyalty. Send {"request":"help"} for its structured requests.',
        },
      ],
    },
    web: {},
    tasks: { endpoint: `${origin}/poppy/tasks` },
    extensions: { operations: [{ version: "3" }] },
  }),
  excludedTasks: (origin) => [
    {
      task: "Decide whether a passenger is eligible for a visa or transit visa",
      alternative: {
        instructions:
          "Northwind Air cannot determine visa eligibility. Check the relevant fictional destination authority outside this demo.",
        references: [{ type: "web", url: `${origin}/for-agents` }],
      },
    },
    { task: "Guarantee entry at a border or destination" },
    { task: "Make a legal-name change on a booking" },
    {
      task: "Handle assistance that requires medical or document verification",
      alternative: {
        instructions: `The protocol supports only the listed non-medical preferences. Use the fictional phone desk at ${PHONE} for verification cases.`,
        references: [{ type: "web", url: `${origin}/` }],
      },
    },
    {
      task: "Verify passports, visas, medical certificates or identity documents",
    },
  ],
  landing: homePage,
  pages: {
    "/for-agents": forAgentsPage,
    "/how-it-works": (origin) => howItWorksPage(origin, agentGuide(origin)),
  },
  pageHeaders,
  fontSources,
};
