/**
 * The contract between Fernwick's ESPI-shaped API and the client's native
 * tools, in process: the real `espiTools` against the real Fernwick app.
 * Discovery is read through pap-client as the playground reads it, and the
 * sign-in shares one of Elena's two meters. The tools' numbers are checked
 * against Fernwick's own data: its hourly readings and its bills.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const net = vi.hoisted(() => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("PAP_ALLOW_PRIVATE_NETWORK", "true");
  return {
    app: undefined as
      | {
          request: (
            url: string,
            init?: RequestInit,
          ) => Response | Promise<Response>;
        }
      | undefined,
  };
});
vi.mock("node:dns/promises", () => ({
  lookup: async () => [{ address: "127.0.0.1", family: 4 }],
}));
const undici = await vi.hoisted(async () => {
  const { createRequire } = await import("node:module");
  const { fileURLToPath } = await import("node:url");
  return createRequire(
    fileURLToPath(new URL("../../../packages/pap-client/", import.meta.url)),
  ).resolve("undici");
});
vi.mock(undici, () => ({
  Agent: class {
    destroy() {}
  },
  fetch: async (
    url: URL | string,
    init: RequestInit & { dispatcher?: unknown },
  ) => {
    const { dispatcher, ...rest } = init;
    void dispatcher;
    return net.app!.request(String(url), rest);
  },
}));
import {
  discoverCompany,
  espiTools,
  type ApiTool,
  type EspiRequest,
} from "@poppy-lab/pap-client";
import {
  companyProfile,
  ESPI_EXTENSION,
  type EspiExtensionEntry,
} from "@poppy-lab/pap-core";
import { lab, origin, setup } from "../../fernwick/src/test-harness";
import { customers } from "../../fernwick/src/data";
import { billsFor, readings } from "../../fernwick/src/billing";
import { DAY, localOffset } from "../../fernwick/src/time";

/** 15:30 in Fernwick's Pacific time, a Wednesday in standard time. */
const NOW = Date.parse("2026-11-25T23:30:00Z");
const elena = customers.find((c) => c.id === "elena")!;
const ev = elena.meters.find((m) => m.id === "UP-E2")!;
const history = [{ plan: ev.plan, from: 0 }];

/** The UTC instant of local midnight on a `YYYY-MM-DD` day in Fernwick. */
const localMidnight = (day: string) => {
  const utc = Date.parse(`${day}T00:00:00Z`) / 1000;
  return utc - localOffset(utc - localOffset(utc));
};
const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY * 1000)
    .toISOString()
    .slice(0, 10);
/** Fernwick's own hours of the EV meter in `[from, to)`. */
const hours = (from: number, to: number) => readings(ev, 1, history, from, to);
const kWh = (wh: number) => Math.round(wh) / 1000;
const usd = (cost: number) => Math.round(cost / 1000) / 100;
const sum = (list: Array<{ value: number; cost: number }>) => ({
  wh: list.reduce((s, r) => s + r.value, 0),
  cost: list.reduce((s, r) => s + r.cost, 0),
});

type Harness = Awaited<ReturnType<typeof setup>>;
type Issued = Awaited<ReturnType<Harness["sign"]>>;
let harness: Harness;
let entry: EspiExtensionEntry;
let tools: Record<string, ApiTool>;
let token: Issued;
const sent: string[] = [];

/**
 * The tools for one sign-in, with what the playground's transport does: the
 * token, the Session, the extension declared and Accept as asked, nothing
 * sent for a scope the grant lacks, and an error with its JSON body.
 */
function toolsFor(issued: Issued) {
  const granted = (issued.scope ?? "").split(" ");
  const request: EspiRequest = async (url, scopes, options) => {
    if (!scopes.every((s) => granted.includes(s)))
      return { outcome: { error: "insufficient_scope" } };
    const target = new URL(url);
    expect(target.origin).toBe(origin);
    sent.push(`${target.pathname}${target.search}`);
    const answer = await harness.call(
      issued.access_token,
      "GET",
      `${target.pathname}${target.search}`,
      undefined,
      undefined,
      "usr_fernwick",
      { Accept: options.accept },
    );
    if (answer.statusCode >= 200 && answer.statusCode < 300)
      return {
        status: answer.statusCode,
        contentType: answer.headers["content-type"] ?? "",
        bytes: answer.bytes,
      };
    let body: unknown;
    try {
      body = answer.json();
    } catch {
      body = null;
    }
    return { status: answer.statusCode, body };
  };
  return espiTools({
    entry,
    request,
    trace: () => undefined,
    resourceUri: () => issued.resourceURI,
    authorizationUri: () => issued.authorizationURI,
  });
}

describe("Fernwick's ESPI-shaped API and the client's tools agree", () => {
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(NOW));
    harness = await setup();
    net.app = lab.app;
    const company = await discoverCompany(origin, {
      allowedPrivateOrigins: [origin],
    });
    entry = companyProfile(company).extensions![ESPI_EXTENSION]!;
    expect(entry.resource_endpoint).toBe(`${origin}/espi/1_1/resource`);
    token = await harness.sign("elena", ["espi:usage", "espi:summary"], {
      meters: ["UP-E2"],
    });
    tools = toolsFor(token);
  });
  afterAll(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("returns the subscription and authorization URIs with the token", () => {
    expect(token.resourceURI).toMatch(
      new RegExp(`^${origin}/espi/1_1/resource/Batch/Subscription/[\\w-]+$`),
    );
    expect(token.authorizationURI).toBe(
      token.resourceURI!.replace("/Batch/Subscription/", "/Authorization/"),
    );
  });

  it("lists only the shared meter, in consumption Wh per hour", async () => {
    expect(await tools.espi_meters!.execute({})).toEqual({
      usagePoints: [
        {
          usagePointId: "UP-E2",
          title: "EV charger",
          serviceKind: "electricity",
          meterReadings: [
            expect.objectContaining({
              meterReadingId: "MR-E2",
              direction: "consumption",
            }),
          ],
        },
      ],
      truncated: false,
    });
    // The other meter is answered as one that doesn't exist.
    expect(
      await tools.espi_usage!.execute({
        usagePointId: "UP-E1",
        from: "2026-11-20",
        to: "2026-11-21",
      }),
    ).toEqual({ error: "espi_error", status: 404 });
  });

  it("adds up a week per local day to Fernwick's own hours, costs included", async () => {
    const from = "2026-11-18",
      to = "2026-11-24";
    const answer = (await tools.espi_usage!.execute({
      usagePointId: "UP-E2",
      from,
      to,
    })) as {
      timeZone: string;
      truncated: boolean;
      meterReadings: Array<{
        total: { kWh: number; cost: number; intervals: number };
        days: Array<{ date: string; kWh: number; cost: number }>;
        topHours: Array<{ start: string; kWh: number }>;
        daysWithoutData?: number;
      }>;
    };
    expect(answer.truncated).toBe(false);
    const [reading] = answer.meterReadings;
    expect(reading!.daysWithoutData).toBeUndefined();
    expect(reading!.days.map((d) => d.date)).toEqual(
      Array.from({ length: 7 }, (_, i) => addDays(from, i)),
    );
    for (const day of reading!.days) {
      const own = sum(
        hours(localMidnight(day.date), localMidnight(addDays(day.date, 1))),
      );
      expect(day.kWh).toBe(kWh(own.wh));
      expect(day.cost).toBe(usd(own.cost));
    }
    const week = hours(localMidnight(from), localMidnight(addDays(to, 1)));
    expect(reading!.total.intervals).toBe(week.length);
    expect(reading!.total.kWh).toBe(kWh(sum(week).wh));
    expect(reading!.total.cost).toBe(usd(sum(week).cost));
    // The daily totals add up to the week's.
    expect(
      Math.round(reading!.days.reduce((s, d) => s + d.kWh, 0) * 1000),
    ).toBe(Math.round(reading!.total.kWh * 1000));
    // The EV charges at night: its top hour is one of Fernwick's own.
    const top = Math.max(...week.map((r) => r.value));
    expect(reading!.topHours[0]!.kWh).toBe(kWh(top));
    // One IntervalBlock request per page, under the subscription.
    expect(
      sent.some((p) =>
        p.includes("/UsagePoint/UP-E2/MeterReading/MR-E2/IntervalBlock?"),
      ),
    ).toBe(true);
  });

  it("gives a day's hours one by one, adding up to the day", async () => {
    const day = "2026-11-23";
    const [byHour, byDay] = (await Promise.all([
      tools.espi_usage!.execute({
        usagePointId: "UP-E2",
        from: day,
        to: day,
        granularity: "hour",
      }),
      tools.espi_usage!.execute({ usagePointId: "UP-E2", from: day, to: day }),
    ])) as Array<{
      meterReadings: Array<{
        total: { kWh: number; cost: number };
        hours?: Array<{ start: string; kWh: number; cost: number }>;
      }>;
    }>;
    const own = hours(localMidnight(day), localMidnight(addDays(day, 1)));
    const listed = byHour!.meterReadings[0]!.hours!;
    expect(listed).toHaveLength(24);
    listed.forEach((hour, i) => {
      expect(hour.kWh).toBe(kWh(own[i]!.value));
      expect(hour.cost).toBe(usd(own[i]!.cost));
    });
    expect(listed[0]!.start).toMatch(/^2026-11-23T00:00/);
    expect(byHour!.meterReadings[0]!.total).toEqual(
      byDay!.meterReadings[0]!.total,
    );
  });

  it("reads the bills as Fernwick bills them, each one the sum of its month's hours", async () => {
    const answer = (await tools.espi_bills!.execute({
      usagePointId: "UP-E2",
    })) as {
      truncated: boolean;
      bills: Array<{
        summaryId: string;
        kWh: number;
        amount: number;
        currency: string;
        tariff: string;
        period: { from: string; to: string; days: number };
        lineItems: Array<{ note: string; amount: number }>;
      }>;
    };
    expect(answer.truncated).toBe(false);
    const own = billsFor(ev, history, Math.floor(NOW / 1000));
    expect(own.map((b) => b.id)).toEqual(["2026-09", "2026-10"]);
    expect(answer.bills.map((b) => b.summaryId)).toEqual(own.map((b) => b.id));
    for (const [i, bill] of answer.bills.entries()) {
      const fernwick = own[i]!;
      const month = sum(hours(fernwick.start, fernwick.end));
      expect(fernwick.deliveredWh).toBe(month.wh);
      expect(bill.kWh).toBe(kWh(month.wh));
      expect(bill.amount).toBe(fernwick.total / 100_000);
      expect(bill.currency).toBe("USD");
      expect(bill.tariff).toBe("Time of use");
      // The energy lines add up to the month's hourly costs.
      const energy = bill.lineItems.filter((l) => l.note.startsWith("Energy"));
      expect(Math.round(energy.reduce((s, l) => s + l.amount, 0) * 100)).toBe(
        Math.round(
          fernwick.lines
            .filter((l) => l.itemKind === 3)
            .reduce((s, l) => s + l.amount + l.rounding, 0) / 1000,
        ),
      );
      // Fernwick bills UTC months: the period is the month itself.
      const first = new Date(fernwick.start * 1000).toISOString().slice(0, 10);
      const last = new Date((fernwick.end - DAY) * 1000)
        .toISOString()
        .slice(0, 10);
      expect(bill.period).toMatchObject({ from: first, to: last });
      expect(bill.period.days).toBe((fernwick.end - fernwick.start) / DAY);
    }
  });

  it("reads the bills with espi:summary alone, the meter and its local time included", async () => {
    const summary = await harness.sign("elena", ["espi:summary"], {
      meters: ["UP-E2"],
    });
    const alone = toolsFor(summary);
    const answer = (await alone.espi_bills!.execute({
      usagePointId: "UP-E2",
    })) as { bills: Array<{ summaryId: string }>; timeZone: string };
    expect(answer.bills.map((b) => b.summaryId)).toEqual([
      "2026-09",
      "2026-10",
    ]);
    expect(answer.timeZone).toContain("UTC-08:00");
    // Usage stays espi:usage, which this grant lacks: nothing is sent.
    expect(
      await alone.espi_usage!.execute({
        usagePointId: "UP-E2",
        from: "2026-11-20",
        to: "2026-11-21",
      }),
    ).toEqual({ error: "insufficient_scope" });
  });

  it("reads the authorization behind the token", async () => {
    const answer = (await tools.espi_authorization!.execute({})) as Record<
      string,
      unknown
    >;
    const id = token.authorizationURI!.split("/").at(-1);
    expect(answer).toMatchObject({
      authorizationId: id,
      status: "active",
      statusCode: 1,
      scope: "espi:usage espi:summary",
      subscriptionId: id,
    });
    expect(Date.parse(answer.expiresAt as string)).toBeGreaterThan(NOW);
  });
});
