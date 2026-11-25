import { it, expect, vi } from "vitest";
import {
  demoEspiAnswer,
  demoEspiRead,
  demoEspiReply,
  formatEspi,
} from "./demo-espi";

const NOW = Date.parse("2026-11-25T12:00:00Z");
const week = {
  usagePointId: "UP-E2",
  title: "EV charger",
  from: "2026-11-18",
  to: "2026-11-24",
  granularity: "day",
  meterReadings: [
    {
      meterReadingId: "MR-E2",
      title: "Hourly energy delivered",
      direction: "consumption",
      unit: "kWh",
      currency: "USD",
      total: { kWh: 1234.5, cost: 210.4, intervals: 168 },
      days: [
        { date: "2026-11-18", kWh: 20.986, cost: 3.58 },
        { date: "2026-11-19", kWh: 0.096, cost: 0.02 },
      ],
      topHours: [{ start: "2026-11-18T00:00-08:00", kWh: 7.2, cost: 1.22 }],
      daysWithoutData: 2,
    },
    {
      meterReadingId: "MR-X",
      direction: "net",
      skipped: "Not energy per interval in Wh, so it isn't added up.",
    },
  ],
  truncated: false,
};
const espi = (meters: unknown) => ({
  espi_meters: { execute: vi.fn(async () => meters) },
  espi_usage: {
    execute: vi.fn(async (input?: Record<string, unknown>) => ({
      ...week,
      usagePointId: input?.usagePointId,
    })),
  },
  espi_bills: {
    execute: vi.fn(async (input?: Record<string, unknown>) => ({
      usagePointId: input?.usagePointId,
      bills: [],
    })),
  },
});

it("reads usage and bills through the ESPI tools only when they exist (Use ESPI on)", () => {
  const tools = espi({ usagePoints: [] });
  for (const message of [
    "How much electricity did my EV use last week?",
    "my usage",
    "¿Cuál fue mi consumo?",
    "kWh this week",
  ])
    expect(demoEspiRead(message, tools)).toBe("usage");
  for (const message of [
    "my bills",
    "my last electricity bill",
    "mi última factura",
    "el recibo de la luz",
  ])
    expect(demoEspiRead(message, tools)).toBe("bills");
  expect(demoEspiRead("Switch my EV charger to the flat rate", tools)).toBe(
    undefined,
  );
  // Use ESPI off: no ESPI tools, the demo keeps its other rules.
  expect(demoEspiRead("my usage", {})).toBeUndefined();
  expect(demoEspiRead("my bills", {})).toBeUndefined();
});

it("reads each shared meter, by the id the utility gave, over the week before today", async () => {
  const tools = espi({
    usagePoints: [{ usagePointId: "UP-E1" }, { usagePointId: "UP-E2" }, {}],
  });
  const answer = (await demoEspiAnswer("usage", tools, NOW)) as {
    usage: Array<{ usagePointId: string }>;
  };
  expect(answer.usage.map((u) => u.usagePointId)).toEqual(["UP-E1", "UP-E2"]);
  expect(tools.espi_usage.execute).toHaveBeenCalledWith({
    usagePointId: "UP-E1",
    from: "2026-11-18",
    to: "2026-11-24",
  });
  expect(await demoEspiAnswer("bills", tools, NOW)).toEqual({
    bills: [
      { usagePointId: "UP-E1", bills: [] },
      { usagePointId: "UP-E2", bills: [] },
    ],
  });
  expect(tools.espi_bills.execute).toHaveBeenCalledWith({
    usagePointId: "UP-E2",
  });
});

it("passes an error answer on, with what to do next", async () => {
  for (const [error, words] of [
    ["sign_in_required", "Sign in first"],
    ["insufficient_scope", "sign in again with Use ESPI on"],
    ["subscription_unknown", "no ESPI-shaped subscription"],
  ] as const) {
    const tools = espi({ error });
    const answer = await demoEspiAnswer("usage", tools, NOW);
    expect(answer).toEqual({ error });
    expect(tools.espi_usage.execute).not.toHaveBeenCalled();
    expect(demoEspiReply(answer, () => `error: ${error}`)).toContain(words);
  }
});

it("words the week in kWh and dollars per day, with the total, and keeps the exact answer for Data", () => {
  const answer = { usage: [week, { error: "espi_error", status: 404 }] };
  expect(formatEspi(answer)).toBe(
    [
      "EV charger (UP-E2), 2026-11-18 to 2026-11-24:",
      "  Hourly energy delivered, consumption:",
      "  - 2026-11-18 · 20.986 kWh · $3.58",
      "  - 2026-11-19 · 0.096 kWh · $0.02",
      "  Total 1,234.5 kWh · $210.40 over 168 hours",
      "  Highest hour: 2026-11-18 00:00 (UTC-08:00) · 7.2 kWh",
      "  2 days without data.",
      "  net: Not energy per interval in Wh, so it isn't added up.",
      "- espi_error",
    ].join("\n"),
  );
  let kept: unknown;
  const reply = demoEspiReply(answer, (value) => {
    kept = value;
    return JSON.stringify(value);
  });
  expect(kept).toBe(answer);
  expect(reply).toContain("ESPI-shaped tools (poppylab.dev/espi v1)");
  expect(reply).toContain("Turn Use ESPI off");
  expect(reply).not.toMatch(/green button/i);
});

it("words bills with their period, energy, amount and tariff", () => {
  expect(
    formatEspi({
      bills: [
        {
          usagePointId: "UP-E1",
          title: "Home",
          bills: [
            {
              summaryId: "2026-10",
              period: {
                from: "2026-10-01",
                to: "2026-10-31",
                days: 31,
                timeZone: "UTC",
              },
              kWh: 468.197,
              currency: "USD",
              amount: 83.83,
              tariff: "Flat rate",
            },
          ],
          truncated: true,
        },
        { usagePointId: "UP-E2", bills: [] },
      ],
    }),
  ).toBe(
    [
      "Home (UP-E1):",
      "  - 2026-10-01 to 2026-10-31 (UTC) · 468.197 kWh · $83.83 · Flat rate",
      "  More bills exist: ask for a shorter period.",
      "UP-E2:",
      "  No bills in the last 92 days.",
    ].join("\n"),
  );
  expect(formatEspi({ usage: [] })).toBe("No shared meters.");
  expect(formatEspi({ accounts: [] })).toBeUndefined();
});
