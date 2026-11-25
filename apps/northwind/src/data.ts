/** Fully fictional routes, flights, fares and test customers for Northwind Air. */
export const airports = [
  { code: "PAU", city: "Port Aurora", airport: "Port Aurora International" },
  { code: "CDB", city: "Cinder Bay", airport: "Cinder Bay Gateway" },
  { code: "NTH", city: "Northhaven", airport: "Northhaven Field" },
  { code: "SMR", city: "Sunmere", airport: "Sunmere Coast Airport" },
  { code: "ALD", city: "Alder Coast", airport: "Alder Coast Terminal" },
] as const;

export const fareBrands = {
  SAVER: {
    code: "SAVER",
    name: "Breeze Saver",
    cabin: "Economy",
    checked_bags: 0,
    change_fee_cents: 7500,
    cancellation:
      "Non-refundable. Unused fictional taxes of USD 42.00 are returned.",
  },
  FLEX: {
    code: "FLEX",
    name: "Gale Flex",
    cabin: "Economy",
    checked_bags: 1,
    change_fee_cents: 0,
    cancellation:
      "Refundable before departure less a USD 50.00 cancellation fee.",
  },
  AURORA: {
    code: "AURORA",
    name: "Aurora Business",
    cabin: "Business",
    checked_bags: 2,
    change_fee_cents: 0,
    cancellation: "Fully refundable before departure.",
  },
} as const;
export type FareCode = keyof typeof fareBrands;

export const flightSchedule = [
  {
    id: "flt_na402_20270518",
    number: "NA 402",
    origin: "PAU",
    destination: "CDB",
    departure: "2027-05-18T08:20:00-04:00",
    arrival: "2027-05-18T11:05:00-04:00",
    aircraft: "Northwind Aster 321",
    status: "on_time",
    gate: "D14",
    economy_cents: 18400,
    business_cents: 52600,
  },
  {
    id: "flt_na118_20270518",
    number: "NA 118",
    origin: "CDB",
    destination: "NTH",
    departure: "2027-05-18T13:10:00-04:00",
    arrival: "2027-05-18T16:00:00-03:00",
    aircraft: "Northwind Aster 330",
    status: "on_time",
    gate: "A06",
    economy_cents: 23600,
    business_cents: 68800,
  },
  {
    id: "flt_na119_20270526",
    number: "NA 119",
    origin: "NTH",
    destination: "CDB",
    departure: "2027-05-26T10:30:00-03:00",
    arrival: "2027-05-26T13:10:00-04:00",
    aircraft: "Northwind Aster 330",
    status: "scheduled",
    gate: "B02",
    economy_cents: 22100,
    business_cents: 65400,
  },
  {
    id: "flt_na409_20270526",
    number: "NA 409",
    origin: "CDB",
    destination: "PAU",
    departure: "2027-05-26T15:05:00-04:00",
    arrival: "2027-05-26T17:50:00-04:00",
    aircraft: "Northwind Aster 321",
    status: "scheduled",
    gate: "A11",
    economy_cents: 17200,
    business_cents: 49800,
  },
  {
    id: "flt_na274_20270603",
    number: "NA 274",
    origin: "PAU",
    destination: "SMR",
    departure: "2027-06-03T09:45:00-04:00",
    arrival: "2027-06-03T13:20:00-05:00",
    aircraft: "Northwind Aster 321",
    status: "scheduled",
    gate: "C09",
    economy_cents: 25900,
    business_cents: 71400,
  },
  {
    id: "flt_na278_20270603",
    number: "NA 278",
    origin: "PAU",
    destination: "SMR",
    departure: "2027-06-03T18:10:00-04:00",
    arrival: "2027-06-03T21:45:00-05:00",
    aircraft: "Northwind Aster 321",
    status: "scheduled",
    gate: "C16",
    economy_cents: 28900,
    business_cents: 74800,
  },
  {
    id: "flt_na512_20270614",
    number: "NA 512",
    origin: "ALD",
    destination: "CDB",
    departure: "2027-06-14T07:15:00-06:00",
    arrival: "2027-06-14T11:40:00-04:00",
    aircraft: "Northwind Aster 330",
    status: "delayed",
    gate: "E04",
    economy_cents: 31400,
    business_cents: 83200,
  },
] as const;

export type PassengerPreference = {
  passenger_id: string;
  meal: "standard" | "vegetarian" | "vegan" | "child";
  assistance:
    "none" | "wheelchair_to_gate" | "visual_guidance" | "hearing_support";
  version: number;
};

export type SeedBooking = {
  reference: string;
  surname: string;
  passenger: { id: string; name: string };
  flight_ids: string[];
  fare: FareCode;
  paid_cents: number;
  seats: Record<string, string>;
  baggage: Record<string, number>;
  preference: PassengerPreference;
  upgrade_offer?: { id: string; flight_id: string; price_cents: number };
};

export const customers = [
  {
    id: "elena",
    name: "Elena Maren",
    loyalty: {
      number: "GALE-104-882",
      tier: "Silver Current",
      points: 28400,
      expiring_points: 3200,
      expires_on: "2027-08-31",
    },
    booking: {
      reference: "NW7K2P",
      surname: "Maren",
      passenger: { id: "psg_elena", name: "Elena Maren" },
      flight_ids: ["flt_na402_20270518", "flt_na118_20270518"],
      fare: "FLEX",
      paid_cents: 62000,
      seats: { flt_na402_20270518: "18A", flt_na118_20270518: "22C" },
      baggage: { flt_na402_20270518: 1, flt_na118_20270518: 1 },
      preference: {
        passenger_id: "psg_elena",
        meal: "vegetarian",
        assistance: "none",
        version: 1,
      },
      upgrade_offer: {
        id: "upg_elena_1",
        flight_id: "flt_na118_20270518",
        price_cents: 24800,
      },
    } satisfies SeedBooking,
  },
  {
    id: "robin",
    name: "Robin Ito",
    loyalty: {
      number: "GALE-207-451",
      tier: "Blue",
      points: 9600,
      expiring_points: 1200,
      expires_on: "2027-07-15",
    },
    booking: {
      reference: "NW4D8R",
      surname: "Ito",
      passenger: { id: "psg_robin", name: "Robin Ito" },
      flight_ids: ["flt_na274_20270603"],
      fare: "SAVER",
      paid_cents: 25900,
      seats: { flt_na274_20270603: "27D" },
      baggage: { flt_na274_20270603: 0 },
      preference: {
        passenger_id: "psg_robin",
        meal: "standard",
        assistance: "hearing_support",
        version: 1,
      },
      upgrade_offer: {
        id: "upg_robin_1",
        flight_id: "flt_na274_20270603",
        price_cents: 31900,
      },
    } satisfies SeedBooking,
  },
] as const;

export const northwindPersona = (id: unknown) =>
  customers.find((customer) => customer.id === id);

export const travelInformation = {
  baggage: {
    title: "Baggage",
    text: "Breeze Saver includes no checked bag, Gale Flex includes one, and Aurora Business includes two. A first extra checked bag costs USD 45.00 per direction in this fictional demo.",
  },
  check_in: {
    title: "Check-in",
    text: "Fictional online check-in opens 24 hours before departure and closes 75 minutes before departure. No real boarding pass is issued.",
  },
  fares: {
    title: "Fare conditions",
    text: "Breeze Saver has a USD 75.00 change fee plus fare difference; Gale Flex has no change fee; Aurora Business has no change fee and is fully refundable before departure.",
  },
} as const;
/** A listed topic's information: `constructor` is a key of every object too. */
export const travelInformationFor = (topic: unknown) =>
  typeof topic === "string" && Object.hasOwn(travelInformation, topic)
    ? travelInformation[topic as keyof typeof travelInformation]
    : undefined;

export const PHONE = "+1 555-0168";
export const PHONE_HOURS = "daily 06:00–22:00 fictional local time";
export const FICTION_NOTICE =
  "Fictional Northwind Air data: no real ticket is sold, changed, cancelled or charged.";
