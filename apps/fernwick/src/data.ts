/**
 * Fully fictional Fernwick Power & Light customers, meters and rate plans.
 * Usage is never stored: `curves.ts` computes each hour from the meter's
 * seed, and `billing.ts` prices it with the plan in force at that hour.
 */
export const FICTION_NOTICE =
  "Fictional Fernwick Power & Light data. No electricity is supplied or billed; never enter real utility account data or credentials.";
/** How the ESPI-shaped API describes itself, everywhere it does. */
export const ESPI_SHAPED =
  "ESPI-shaped (modelled on NAESB REQ.21 ESPI), not certified";

export type PlanId = "flat" | "time-of-use";
export const planIds: readonly PlanId[] = ["flat", "time-of-use"];
/**
 * A band of a plan: local hours `[from, to)`, wrapping past midnight when
 * `from > to`, and its price. Prices are in hundred-thousandths of a US
 * dollar per watt-hour, so a reading's cost is exact: 24 per Wh is
 * USD 0.24 per kWh, and 1,000 Wh at 24 cost 24,000, USD 0.24.
 */
export type Band = {
  /** ESPI's `tou` index on a time-of-use reading; 0 on a flat plan. */
  tou: number;
  name: string;
  from: number;
  to: number;
  perWh: number;
};
export type Plan = { id: PlanId; name: string; bands: readonly Band[] };
export const plans: Record<PlanId, Plan> = {
  flat: {
    id: "flat",
    name: "Flat rate",
    bands: [{ tou: 0, name: "All hours", from: 0, to: 24, perWh: 24 }],
  },
  "time-of-use": {
    id: "time-of-use",
    name: "Time of use",
    bands: [
      { tou: 1, name: "Off-peak", from: 21, to: 7, perWh: 17 },
      { tou: 2, name: "Mid-peak", from: 7, to: 16, perWh: 25 },
      { tou: 3, name: "Peak", from: 16, to: 21, perWh: 41 },
    ],
  },
};
/** Credit for energy a meter sends to the grid, per Wh (USD 0.07/kWh). */
export const EXPORT_CREDIT_PER_WH = 7;

/** How a meter's hourly curve is drawn (`curves.ts`). */
export type Profile =
  | { kind: "home"; seed: number; scale: number }
  | { kind: "ev"; seed: number }
  | { kind: "solar-home"; seed: number; scale: number; panelWatts: number };
export type MeterReadingSeed = {
  id: string;
  /** ESPI `flowDirection`: 1 delivered to the customer, 19 received from them. */
  flowDirection: 1 | 19;
  readingType: string;
};
export type MeterSeed = {
  /** The UsagePoint's ID, in every URL. */
  id: string;
  label: string;
  plan: PlanId;
  /** Monthly basic service charge, in hundred-thousandths of USD. */
  serviceCharge: number;
  profile: Profile;
  readings: readonly MeterReadingSeed[];
};
export type Address = {
  number: string;
  street: string;
  town: string;
  postalCode: string;
};
export type CustomerSeed = {
  id: "elena" | "robin";
  name: string;
  email: string;
  accountNumber: string;
  address: Address;
  meters: readonly MeterSeed[];
};

export const READING_TYPES = {
  "RT-DELIVERED-WH": {
    id: "RT-DELIVERED-WH",
    title: "Hourly energy delivered, Wh",
    flowDirection: 1,
  },
  "RT-RECEIVED-WH": {
    id: "RT-RECEIVED-WH",
    title: "Hourly energy received from the customer, Wh",
    flowDirection: 19,
  },
} as const;
export type ReadingTypeId = keyof typeof READING_TYPES;

export const customers: readonly CustomerSeed[] = [
  {
    id: "elena",
    name: "Elena Maren",
    email: "elena.maren@example.invalid",
    accountNumber: "FPL-2041-7731",
    address: {
      number: "41",
      street: "Bracken Row",
      town: "Fernwick",
      postalCode: "00000",
    },
    meters: [
      {
        id: "UP-E1",
        label: "Home",
        plan: "flat",
        serviceCharge: 1150000,
        profile: { kind: "home", seed: 4101, scale: 1 },
        readings: [
          { id: "MR-E1", flowDirection: 1, readingType: "RT-DELIVERED-WH" },
        ],
      },
      {
        id: "UP-E2",
        label: "EV charger",
        plan: "time-of-use",
        serviceCharge: 400000,
        profile: { kind: "ev", seed: 4102 },
        readings: [
          { id: "MR-E2", flowDirection: 1, readingType: "RT-DELIVERED-WH" },
        ],
      },
    ],
  },
  {
    id: "robin",
    name: "Robin Ito",
    email: "robin.ito@example.invalid",
    accountNumber: "FPL-2041-8806",
    address: {
      number: "7",
      street: "Sorrel Court",
      town: "Fernwick",
      postalCode: "00000",
    },
    meters: [
      {
        id: "UP-R1",
        label: "Home with solar panels",
        plan: "time-of-use",
        serviceCharge: 1150000,
        profile: {
          kind: "solar-home",
          seed: 7201,
          scale: 0.85,
          panelWatts: 5600,
        },
        readings: [
          { id: "MR-R1", flowDirection: 1, readingType: "RT-DELIVERED-WH" },
          { id: "MR-R2", flowDirection: 19, readingType: "RT-RECEIVED-WH" },
        ],
      },
    ],
  },
] as const;

export const energyPersona = (id: unknown) =>
  customers.find((customer) => customer.id === id);
export const addressLine = ({ number, street, town, postalCode }: Address) =>
  `${number} ${street}, ${town} ${postalCode}`;
/** Hundred-thousandths of USD as dollars and cents, rounded to the cent. */
export const usd = (amount: number) => {
  const cents = Math.round(amount / 1000);
  return `${cents < 0 ? "−" : ""}USD ${(Math.abs(cents) / 100).toFixed(2)}`;
};
/** Watt-hours as kilowatt-hours with one decimal: `12.3 kWh`. */
export const kwh = (wh: number) => `${(wh / 1000).toFixed(1)} kWh`;
