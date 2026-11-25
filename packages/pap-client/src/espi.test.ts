import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { EspiExtensionEntry } from "@poppy-lab/pap-core";
import {
  decodeDstRule,
  ESPI_LIMITS,
  espiTools,
  offsetAt,
  type EspiDocument,
  type EspiOutcome,
  type EspiRequestOptions,
  type EspiResponse,
} from "./espi.ts";
import { InvalidToolArguments } from "./openapi.ts";

const RE = "https://energy-demo.poppylab.dev/espi/1_1/resource";
const SUB = "kQ7m_fw2";
const entry: EspiExtensionEntry = {
  version: "1",
  espi_version: "4.0",
  resource_endpoint: RE,
};
const fixture = readFileSync(
  join(__dirname, "fixtures", "espi-fernwick.xml"),
  "utf8",
);
const NS = `xmlns="http://www.w3.org/2005/Atom" xmlns:espi="http://naesb.org/espi"`;

/** The fixture's entries by the path of their self link under RE. */
const byPath = new Map(
  [...fixture.matchAll(/<entry>[\s\S]*?<\/entry>/g)].map(([text]) => [
    text.match(/rel="self" href="([^"]+)"/)![1]!.slice(RE.length),
    text,
  ]),
);
const xml = (body: string, contentType = "application/atom+xml") =>
  ({
    status: 200,
    contentType,
    bytes: new TextEncoder().encode(body),
  }) satisfies EspiDocument;
const feed = (entries: string[]) =>
  xml(
    `<?xml version="1.0" encoding="UTF-8"?>\n<feed ${NS}>\n<id>urn:uuid:feed</id>\n${entries.join("\n")}\n</feed>`,
  );
const one = (text: string) => xml(text.replace("<entry>", `<entry ${NS}>`));
const under = (path: string) =>
  [...byPath].filter(
    ([p]) =>
      p.startsWith(`${path}/`) && !p.slice(path.length + 1).includes("/"),
  );
/** Interval blocks in [min, max) by their interval start, paged. */
function blocks(path: string, query: URLSearchParams) {
  const min = Date.parse(query.get("published-min")!) / 1000;
  const max = Date.parse(query.get("published-max")!) / 1000;
  const start = Number(query.get("start-index") ?? 1);
  const size = Number(query.get("max-results") ?? 100);
  return under(path)
    .filter(([, text]) => {
      const s = Number(
        text.match(
          /<espi:interval>\s*<espi:duration>\d+<\/espi:duration>\s*<espi:start>(\d+)/,
        )![1],
      );
      return s >= min && s < max;
    })
    .map(([, text]) => text)
    .slice(start - 1, start - 1 + size);
}

/** The fixture served as a utility would, route by route. */
function utility(url: string): EspiResponse | EspiDocument {
  const u = new URL(url);
  if (
    u.origin !== new URL(RE).origin ||
    !u.pathname.startsWith("/espi/1_1/resource/")
  )
    return { status: 404, body: null };
  const path = u.pathname.slice("/espi/1_1/resource".length);
  if (/\/(UsagePoint|MeterReading)$/.test(path))
    return feed(under(path).map(([, t]) => t));
  if (path.endsWith("/IntervalBlock"))
    return feed(blocks(path, u.searchParams));
  if (path.endsWith("/UsageSummary"))
    return feed(under(path).map(([, t]) => t));
  const text = byPath.get(path);
  return text ? one(text) : { status: 404, body: null };
}

type Reply = EspiResponse | EspiDocument | EspiOutcome;
function setup(
  options: {
    /** Replies in order instead of the fixture's routes. */
    replies?: Reply[];
    resourceUri?: string | undefined;
    authorizationUri?: string | undefined;
  } = {},
) {
  const { replies } = options;
  // An explicit undefined means none kept.
  const resourceUri =
    "resourceUri" in options
      ? options.resourceUri
      : `${RE}/Batch/Subscription/${SUB}`;
  const authorizationUri =
    "authorizationUri" in options
      ? options.authorizationUri
      : `${RE}/Authorization/${SUB}`;
  const now = Date.parse("2026-11-25T12:00:00Z");
  const request = vi.fn(
    async (
      url: string,
      scopes: string[],
      options: EspiRequestOptions,
    ): Promise<Reply> => {
      void scopes;
      void options;
      if (replies) {
        const next = replies.shift();
        if (!next) throw Error("Unexpected request");
        return next;
      }
      return utility(url);
    },
  );
  const trace = vi.fn();
  const tools = espiTools({
    entry,
    request,
    trace,
    resourceUri: () => resourceUri,
    authorizationUri: () => authorizationUri,
    now: () => now,
  });
  const urls = () => request.mock.calls.map(([url]) => url.slice(RE.length));
  return { request, trace, tools, urls };
}
const accept = {
  accept: "application/atom+xml",
  maxBytes: ESPI_LIMITS.feedBytes,
};

describe("ESPI-shaped tools (poppylab.dev/espi v1)", () => {
  it("offers four read tools with closed input schemas", () => {
    const { tools } = setup();
    expect(Object.keys(tools)).toEqual([
      "espi_meters",
      "espi_usage",
      "espi_bills",
      "espi_authorization",
    ]);
    for (const tool of Object.values(tools)) {
      expect(tool.schema).toMatchObject({
        type: "object",
        additionalProperties: false,
      });
      expect(tool.description).toContain(
        "ESPI-shaped (modelled on NAESB REQ.21 ESPI, not certified)",
      );
      expect(tool.description).not.toMatch(/green button/i);
    }
  });

  it("lists the chosen meters with their reading types decoded", async () => {
    const { tools, request, trace, urls } = setup();
    const result = await tools.espi_meters!.execute({});
    expect(urls()).toEqual([
      `/Subscription/${SUB}/UsagePoint`,
      `/Subscription/${SUB}/UsagePoint/up-home/MeterReading`,
      "/ReadingType/rt-home",
      `/Subscription/${SUB}/UsagePoint/up-ev/MeterReading`,
      "/ReadingType/rt-ev",
    ]);
    expect(request).toHaveBeenCalledWith(
      `${RE}/Subscription/${SUB}/UsagePoint`,
      ["espi:usage"],
      accept,
    );
    expect(trace).toHaveBeenCalledWith(
      `GET /espi/1_1/resource/Subscription/${SUB}/UsagePoint · ESPI-shaped · espi:usage · application/atom+xml`,
    );
    const reading = (title: string, id: string) => ({
      meterReadingId: id,
      title,
      direction: "consumption",
      quantity: "energy",
      unit: "Wh",
      reportedIn: "kWh",
      intervalSeconds: 3600,
      accumulation: "per interval",
      commodity: "electricity",
      currency: "USD",
      codes: {
        uom: 72,
        powerOfTenMultiplier: 0,
        flowDirection: 1,
        kind: 12,
        accumulationBehaviour: 4,
        commodity: 1,
        currency: 840,
      },
    });
    expect(result).toEqual({
      usagePoints: [
        {
          usagePointId: "up-home",
          title: "Home",
          serviceKind: "electricity",
          meterReadings: [reading("Home, hourly energy delivered", "mr-home")],
        },
        {
          usagePointId: "up-ev",
          title: "EV charger",
          serviceKind: "electricity",
          meterReadings: [
            reading("EV charger, hourly energy delivered", "mr-ev"),
          ],
        },
      ],
      truncated: false,
    });
    expect(JSON.stringify(result)).not.toContain("Ignore previous");
  });

  it("adds up a meter's hourly intervals into local days, totals and top hours", async () => {
    const { tools, request, urls } = setup();
    const result = await tools.espi_usage!.execute({
      usagePointId: "up-home",
      from: "2026-11-21",
      to: "2026-11-23",
    });
    // Local midnight in Pacific standard time is 08:00 UTC.
    expect(urls()).toEqual([
      `/Subscription/${SUB}/UsagePoint/up-home`,
      "/LocalTimeParameters/ltp-pacific",
      `/Subscription/${SUB}/UsagePoint/up-home/MeterReading`,
      "/ReadingType/rt-home",
      `/Subscription/${SUB}/UsagePoint/up-home/MeterReading/mr-home/IntervalBlock?published-min=2026-11-21T08%3A00%3A00Z&published-max=2026-11-24T08%3A00%3A00Z&start-index=1&max-results=31`,
    ]);
    expect(
      request.mock.calls.every(([, scopes]) => scopes.join() === "espi:usage"),
    ).toBe(true);
    expect(result).toEqual({
      usagePointId: "up-home",
      title: "Home",
      serviceKind: "electricity",
      from: "2026-11-21",
      to: "2026-11-23",
      granularity: "day",
      timeZone: "UTC-08:00, UTC-07:00 in daylight time",
      meterReadings: [
        {
          meterReadingId: "mr-home",
          title: "Home, hourly energy delivered",
          direction: "consumption",
          unit: "kWh",
          currency: "USD",
          // 52,880 Wh at $0.31/kWh: 1,639,280 hundred-thousandths.
          total: { kWh: 52.88, cost: 16.39, intervals: 72 },
          days: [
            { date: "2026-11-21", kWh: 18, cost: 5.58 },
            { date: "2026-11-22", kWh: 18.585, cost: 5.76 },
            { date: "2026-11-23", kWh: 16.295, cost: 5.05 },
          ],
          topHours: [
            { start: "2026-11-22T18:00-08:00", kWh: 1.71, cost: 0.53 },
            { start: "2026-11-21T18:00-08:00", kWh: 1.62, cost: 0.5 },
            { start: "2026-11-22T19:00-08:00", kWh: 1.6, cost: 0.5 },
            { start: "2026-11-23T18:00-08:00", kWh: 1.56, cost: 0.48 },
            { start: "2026-11-21T19:00-08:00", kWh: 1.54, cost: 0.48 },
          ],
        },
      ],
      truncated: false,
    });
  });

  it("gives hours for a short window, and counts days without data", async () => {
    const { tools } = setup();
    const result = (await tools.espi_usage!.execute({
      usagePointId: "up-ev",
      from: "2026-11-22",
      to: "2026-11-24",
      granularity: "hour",
    })) as { meterReadings: Array<Record<string, unknown>> };
    const ev = result.meterReadings[0]!;
    expect(ev.total).toEqual({ kWh: 27, cost: 4.86, intervals: 48 });
    expect(ev.daysWithoutData).toBe(1);
    const hours = ev.hours as Array<Record<string, unknown>>;
    expect(hours).toHaveLength(48);
    expect(hours[0]).toEqual({
      start: "2026-11-22T00:00-08:00",
      kWh: 0,
      cost: 0,
    });
    expect(hours[23]).toEqual({
      start: "2026-11-22T23:00-08:00",
      kWh: 7.2,
      cost: 1.3,
    });
    expect(ev.topHours).toEqual([
      { start: "2026-11-22T23:00-08:00", kWh: 7.2, cost: 1.3 },
      { start: "2026-11-23T00:00-08:00", kWh: 7.2, cost: 1.3 },
      { start: "2026-11-23T01:00-08:00", kWh: 7.2, cost: 1.3 },
      { start: "2026-11-23T02:00-08:00", kWh: 5.4, cost: 0.97 },
      { start: "2026-11-22T00:00-08:00", kWh: 0, cost: 0 },
    ]);
    expect(ev).not.toHaveProperty("days");
  });

  it("decodes powerOfTenMultiplier, currency and direction from the ReadingType", async () => {
    const variant = (rt: Record<string, string>, values: string[]) => {
      let readingType = byPath.get("/ReadingType/rt-home")!;
      for (const [k, v] of Object.entries(rt))
        readingType = readingType.replace(
          new RegExp(`<espi:${k}>[^<]*</espi:${k}>`),
          `<espi:${k}>${v}</espi:${k}>`,
        );
      const start = 1795248000;
      const block = `<entry><link rel="self" href="${RE}/Subscription/${SUB}/UsagePoint/up-home/MeterReading/mr-home/IntervalBlock/b1"/><content><espi:IntervalBlock><espi:interval><espi:duration>86400</espi:duration><espi:start>${start}</espi:start></espi:interval>${values
        .map(
          (v, i) =>
            `<espi:IntervalReading><espi:cost>123456</espi:cost><espi:timePeriod><espi:duration>3600</espi:duration><espi:start>${start + i * 3600}</espi:start></espi:timePeriod><espi:value>${v}</espi:value></espi:IntervalReading>`,
        )
        .join("")}</espi:IntervalBlock></content></entry>`;
      return setup({
        replies: [
          one(byPath.get(`/Subscription/${SUB}/UsagePoint/up-home`)!),
          one(byPath.get("/LocalTimeParameters/ltp-pacific")!),
          feed([
            byPath.get(
              `/Subscription/${SUB}/UsagePoint/up-home/MeterReading/mr-home`,
            )!,
          ]),
          one(readingType),
          feed([block]),
        ],
      });
    };
    const usage = async (s: ReturnType<typeof setup>) =>
      (
        (await s.tools.espi_usage!.execute({
          usagePointId: "up-home",
          from: "2026-11-21",
          to: "2026-11-21",
        })) as { meterReadings: Array<Record<string, unknown>> }
      ).meterReadings[0]!;

    // Values in kWh (Wh × 10^3), costs in euros, energy exported.
    const exported = await usage(
      variant(
        { powerOfTenMultiplier: "3", currency: "978", flowDirection: "19" },
        ["25", "12"],
      ),
    );
    expect(exported).toMatchObject({
      direction: "export",
      unit: "kWh",
      currency: "EUR",
      // Two costs of 123,456 hundred-thousandths: €2.46912.
      total: { kWh: 37, cost: 2.47, intervals: 2 },
      days: [{ date: "2026-11-21", kWh: 37, cost: 2.47 }],
    });
    // Values in mWh (Wh × 10^-3): 1,500,250 mWh is 1.50025 kWh.
    const milli = await usage(
      variant({ powerOfTenMultiplier: "-3" }, ["1500000", "250"]),
    );
    expect(milli).toMatchObject({ total: { kWh: 1.5, intervals: 2 } });
    expect((milli.topHours as unknown[])[1]).toMatchObject({ kWh: 0 });
    // No known currency: energy only.
    const unpriced = await usage(variant({ currency: "0" }, ["1000"]));
    expect(unpriced.total).toEqual({ kWh: 1, intervals: 1 });
    expect(unpriced).not.toHaveProperty("currency");
    expect(JSON.stringify(unpriced)).not.toContain("cost");
    // Not energy per interval in Wh: not added up, and no intervals read.
    for (const rt of [{ uom: "38" }, { accumulationBehaviour: "1" }]) {
      const s = variant(rt, ["1000"]);
      const result = (await s.tools.espi_usage!.execute({
        usagePointId: "up-home",
        from: "2026-11-21",
        to: "2026-11-21",
      })) as { meterReadings: Array<Record<string, unknown>> };
      expect(result.meterReadings[0]).toMatchObject({
        meterReadingId: "mr-home",
        skipped: expect.stringContaining("Not energy per interval"),
      });
      expect(s.request).toHaveBeenCalledTimes(4);
    }
  });

  it("keeps only intervals inside the window, once each", async () => {
    const start = 1795248000; // 2026-11-21T00:00-08:00
    const reading = (s: number, v: number) =>
      `<espi:IntervalReading><espi:timePeriod><espi:duration>3600</espi:duration><espi:start>${s}</espi:start></espi:timePeriod><espi:value>${v}</espi:value></espi:IntervalReading>`;
    const block = (
      id: string,
      readings: string,
      self = `${RE}/Subscription/${SUB}/UsagePoint/up-home/MeterReading/mr-home/IntervalBlock/${id}`,
    ) =>
      `<entry><link rel="self" href="${self}"/><content><espi:IntervalBlock>${readings}</espi:IntervalBlock></content></entry>`;
    const { tools } = setup({
      replies: [
        one(byPath.get(`/Subscription/${SUB}/UsagePoint/up-home`)!),
        one(byPath.get("/LocalTimeParameters/ltp-pacific")!),
        feed([
          byPath.get(
            `/Subscription/${SUB}/UsagePoint/up-home/MeterReading/mr-home`,
          )!,
        ]),
        one(byPath.get("/ReadingType/rt-home")!),
        feed([
          block(
            "a",
            [
              reading(start - 3600, 9000), // the day before
              reading(start, 100),
              reading(start, 100), // the same hour again
              reading(start + 86400, 9000), // the day after
              `<espi:IntervalReading><espi:value>9000</espi:value></espi:IntervalReading>`, // no time
              reading(start + 3600, 2 ** 47), // beyond Int48
              `<espi:IntervalReading><espi:timePeriod><espi:duration>0</espi:duration><espi:start>${start + 7200}</espi:start></espi:timePeriod><espi:value>9000</espi:value></espi:IntervalReading>`,
              reading(start + 10800, 200),
            ].join(""),
          ),
          // Another meter reading's block, or one outside the endpoint.
          block(
            "b",
            reading(start + 14400, 9000),
            `${RE}/Subscription/${SUB}/UsagePoint/up-home/MeterReading/mr-ev/IntervalBlock/b`,
          ),
          block(
            "c",
            reading(start + 18000, 9000),
            `https://evil.example/espi/1_1/resource/Subscription/${SUB}/UsagePoint/up-home/MeterReading/mr-home/IntervalBlock/c`,
          ),
        ]),
      ],
    });
    const result = (await tools.espi_usage!.execute({
      usagePointId: "up-home",
      from: "2026-11-21",
      to: "2026-11-21",
    })) as { meterReadings: Array<Record<string, unknown>> };
    // No interval had a cost, so there is none.
    expect(result.meterReadings[0]!.total).toEqual({ kWh: 0.3, intervals: 2 });
  });

  it("pages interval blocks with start-index, within its page bound", async () => {
    const full = (page: number) =>
      feed(
        Array.from({ length: ESPI_LIMITS.pageSize }, (_, i) => {
          const s =
            Date.parse("2026-08-25T12:00:00Z") / 1000 +
            (page * ESPI_LIMITS.pageSize + i) * 86400;
          return `<entry><link rel="self" href="${RE}/Subscription/${SUB}/UsagePoint/up-home/MeterReading/mr-home/IntervalBlock/d${page}-${i}"/><content><espi:IntervalBlock><espi:IntervalReading><espi:timePeriod><espi:duration>3600</espi:duration><espi:start>${s}</espi:start></espi:timePeriod><espi:value>1000</espi:value></espi:IntervalReading></espi:IntervalBlock></content></entry>`;
        }),
      );
    const head = [
      one(byPath.get(`/Subscription/${SUB}/UsagePoint/up-home`)!),
      one(byPath.get("/LocalTimeParameters/ltp-pacific")!),
      feed([
        byPath.get(
          `/Subscription/${SUB}/UsagePoint/up-home/MeterReading/mr-home`,
        )!,
      ]),
      one(byPath.get("/ReadingType/rt-home")!),
    ];
    const s = setup({
      replies: [...head, ...Array.from({ length: 6 }, (_, p) => full(p))],
    });
    const result = (await s.tools.espi_usage!.execute({
      usagePointId: "up-home",
      from: "2026-08-25",
      to: "2026-11-24",
    })) as {
      truncated: boolean;
      meterReadings: Array<Record<string, unknown>>;
    };
    expect(
      s
        .urls()
        .slice(4)
        .map((u) => new URL(`${RE}${u}`).searchParams.get("start-index")),
    ).toEqual(["1", "32", "63", "94"]);
    expect(s.request).toHaveBeenCalledTimes(4 + ESPI_LIMITS.maxPages);
    expect(result.truncated).toBe(true);
    expect(result.meterReadings[0]!.total).toMatchObject({ intervals: 92 });

    // A short page ends paging.
    const short = setup({ replies: [...head, full(0), feed([])] });
    const done = (await short.tools.espi_usage!.execute({
      usagePointId: "up-home",
      from: "2026-08-25",
      to: "2026-11-24",
    })) as { truncated: boolean };
    expect(short.request).toHaveBeenCalledTimes(6);
    expect(done.truncated).toBe(false);
  });

  it("bounds the window: 92 days, 3 for hours, from no later than to", async () => {
    const { tools, request } = setup();
    const cases: Array<Record<string, unknown>> = [
      { usagePointId: "up-home", from: "2026-08-23", to: "2026-11-23" },
      {
        usagePointId: "up-home",
        from: "2026-11-20",
        to: "2026-11-23",
        granularity: "hour",
      },
      { usagePointId: "up-home", from: "2026-11-23", to: "2026-11-22" },
      {
        usagePointId: "up-home",
        from: "2026-11-23",
        to: "2026-11-23",
        granularity: "week",
      },
      { usagePointId: "up-home", from: "2026-02-30", to: "2026-03-01" },
      { usagePointId: "up-home", from: "yesterday", to: "2026-11-23" },
      { usagePointId: "up-home", from: "2026-11-23" },
      { usagePointId: "../up-home", from: "2026-11-23", to: "2026-11-23" },
      { usagePointId: "up/home", from: "2026-11-23", to: "2026-11-23" },
      { usagePointId: "up%2Fhome", from: "2026-11-23", to: "2026-11-23" },
      {
        usagePointId: "up-home",
        from: "2026-11-23",
        to: "2026-11-23",
        url: "https://evil.example",
      },
      {
        usagePointId: "up-home",
        from: "2026-11-23",
        to: "2026-11-23",
        subscriptionId: "other",
      },
    ];
    for (const input of cases)
      await expect(
        tools.espi_usage!.execute(input),
        JSON.stringify(input),
      ).rejects.toBeInstanceOf(InvalidToolArguments);
    // Exactly at the bounds is fine.
    await tools.espi_usage!.execute({
      usagePointId: "up-home",
      from: "2026-08-24",
      to: "2026-11-23",
    });
    await tools.espi_usage!.execute({
      usagePointId: "up-home",
      from: "2026-11-21",
      to: "2026-11-23",
      granularity: "hour",
    });
    expect(request).toHaveBeenCalled();
  });

  it("splits days at local midnight, through the end of daylight time", async () => {
    // 2026-11-01 in Pacific time has 25 hours: 07:00 UTC to 08:00 UTC next day.
    const midnight = Date.parse("2026-11-01T07:00:00Z") / 1000;
    const readings = Array.from(
      { length: 26 },
      (_, h) =>
        `<espi:IntervalReading><espi:timePeriod><espi:duration>3600</espi:duration><espi:start>${midnight + h * 3600}</espi:start></espi:timePeriod><espi:value>1000</espi:value></espi:IntervalReading>`,
    ).join("");
    const { tools, urls } = setup({
      replies: [
        one(byPath.get(`/Subscription/${SUB}/UsagePoint/up-home`)!),
        one(byPath.get("/LocalTimeParameters/ltp-pacific")!),
        feed([
          byPath.get(
            `/Subscription/${SUB}/UsagePoint/up-home/MeterReading/mr-home`,
          )!,
        ]),
        one(byPath.get("/ReadingType/rt-home")!),
        feed([
          `<entry><link rel="self" href="${RE}/Subscription/${SUB}/UsagePoint/up-home/MeterReading/mr-home/IntervalBlock/x"/><content><espi:IntervalBlock>${readings}</espi:IntervalBlock></content></entry>`,
        ]),
      ],
    });
    const result = (await tools.espi_usage!.execute({
      usagePointId: "up-home",
      from: "2026-11-01",
      to: "2026-11-01",
      granularity: "hour",
    })) as {
      meterReadings: Array<{ hours: Array<{ start: string }>; total: unknown }>;
    };
    expect(urls()[4]).toContain(
      "published-min=2026-11-01T07%3A00%3A00Z&published-max=2026-11-02T08%3A00%3A00Z",
    );
    const hours = result.meterReadings[0]!.hours.map((h) => h.start);
    expect(hours).toHaveLength(25);
    expect(hours.slice(0, 3)).toEqual([
      "2026-11-01T00:00-07:00",
      "2026-11-01T01:00-07:00",
      "2026-11-01T01:00-08:00",
    ]);
    expect(hours.at(-1)).toBe("2026-11-01T23:00-08:00");
    expect(result.meterReadings[0]!.total).toMatchObject({
      kWh: 25,
      intervals: 25,
    });
  });

  it("decodes ESPI's DST rule bitmap", () => {
    // Second Sunday of March, and first Sunday of November, at 02:00.
    expect(decodeDstRule("360E2000")).toEqual({
      month: 3,
      operator: 3,
      dayOfMonth: 0,
      dayOfWeek: 7,
      hours: 2,
      seconds: 0,
    });
    expect(decodeDstRule("B40E2000")).toMatchObject({
      month: 11,
      operator: 2,
      dayOfWeek: 7,
      hours: 2,
    });
    expect(decodeDstRule("0xB40E2000")).toMatchObject({ month: 11 });
    expect(decodeDstRule("FFFFFFFF")).toBeNull();
    for (const bad of [
      "",
      "zz",
      "123456789",
      "00000000",
      "D40E2000",
      "360F8000",
      "30002000",
    ])
      expect(decodeDstRule(bad), bad).toBeUndefined();
    const start = decodeDstRule("360E2000")!;
    const end = decodeDstRule("B40E2000")!;
    const pacific = { tz: -28800, dst: 3600, rules: { start, end } };
    const at = (iso: string) => offsetAt(pacific, Date.parse(iso) / 1000);
    // 2026: from 2026-03-08 10:00 UTC to 2026-11-01 09:00 UTC.
    expect(at("2026-03-08T09:59:59Z")).toBe(-28800);
    expect(at("2026-03-08T10:00:00Z")).toBe(-25200);
    expect(at("2026-07-01T00:00:00Z")).toBe(-25200);
    expect(at("2026-11-01T08:59:59Z")).toBe(-25200);
    expect(at("2026-11-01T09:00:00Z")).toBe(-28800);
    expect(at("2027-03-14T10:00:00Z")).toBe(-25200);
    // Operator 7 (the last Sunday), with the start after the end: a
    // southern-hemisphere year, in daylight time over the new year.
    const lastSunday = (month: number) =>
      decodeDstRule(
        (((month << 28) | (7 << 25) | (7 << 17) | (2 << 12)) >>> 0).toString(
          16,
        ),
      )!;
    const south = {
      tz: 36000,
      dst: 3600,
      rules: { start: lastSunday(10), end: lastSunday(3) },
    };
    expect(offsetAt(south, Date.parse("2026-01-15T00:00:00Z") / 1000)).toBe(
      39600,
    );
    expect(offsetAt(south, Date.parse("2026-07-15T00:00:00Z") / 1000)).toBe(
      36000,
    );
    expect(offsetAt(south, Date.parse("2026-12-15T00:00:00Z") / 1000)).toBe(
      39600,
    );
    // Operator 0 and 1: a day of the month, or the weekday on or after it.
    const rule = (month: number, operator: number, dom: number, dow: number) =>
      decodeDstRule(
        (
          ((month << 28) |
            (operator << 25) |
            (dom << 20) |
            (dow << 17) |
            (1 << 12)) >>>
          0
        ).toString(16),
      )!;
    const fixed = {
      tz: 0,
      dst: 3600,
      rules: { start: rule(4, 0, 10, 0), end: rule(9, 1, 15, 1) },
    };
    expect(offsetAt(fixed, Date.parse("2026-04-10T00:59:59Z") / 1000)).toBe(0);
    expect(offsetAt(fixed, Date.parse("2026-04-10T01:00:00Z") / 1000)).toBe(
      3600,
    );
    // 2026-09-15 is a Tuesday: the Monday on or after it is the 21st.
    expect(offsetAt(fixed, Date.parse("2026-09-20T12:00:00Z") / 1000)).toBe(
      3600,
    );
    expect(offsetAt(fixed, Date.parse("2026-09-21T00:00:00Z") / 1000)).toBe(0);
  });

  it("says when the utility's time zone is missing or its DST rules are unreadable", async () => {
    const ltp = byPath.get("/LocalTimeParameters/ltp-pacific")!;
    const head = (time: string | undefined) => [
      one(
        time === undefined
          ? byPath
              .get(`/Subscription/${SUB}/UsagePoint/up-home`)!
              .replace(
                /<link rel="related" href="[^"]+LocalTimeParameters[^"]+"[^>]*>/,
                "",
              )
          : byPath.get(`/Subscription/${SUB}/UsagePoint/up-home`)!,
      ),
      ...(time === undefined ? [] : [one(time)]),
      feed([]),
    ];
    const usage = async (time: string | undefined) =>
      setup({ replies: head(time) }).tools.espi_usage!.execute({
        usagePointId: "up-home",
        from: "2026-11-21",
        to: "2026-11-21",
      });
    expect(await usage(undefined)).toMatchObject({
      timeZone: "UTC (the utility gave no local time)",
      meterReadings: [],
    });
    expect(await usage(ltp.replace("360E2000", "D0000000"))).toMatchObject({
      timeZone: "UTC-08:00 (daylight time rules unreadable, not applied)",
    });
    expect(await usage(ltp.replace("360E2000", "FFFFFFFF"))).toMatchObject({
      timeZone: "UTC-08:00",
    });
    expect(await usage(ltp.replace("-28800", "not a number"))).toMatchObject({
      timeZone: "UTC (the utility gave no local time)",
    });
  });
});

describe("ESPI-shaped bills and authorization", () => {
  it("reads bill summaries in kWh and dollars, over the last 92 days by default", async () => {
    const { tools, request, urls } = setup();
    const result = await tools.espi_bills!.execute({ usagePointId: "up-home" });
    expect(urls()).toEqual([
      `/Subscription/${SUB}/UsagePoint/up-home`,
      "/LocalTimeParameters/ltp-pacific",
      `/Subscription/${SUB}/UsagePoint/up-home/UsageSummary?published-min=2026-08-26T07%3A00%3A00Z&published-max=2026-11-26T08%3A00%3A00Z&start-index=1&max-results=31`,
    ]);
    // Bills alone need espi:summary only: the usage point and its local
    // time are read with it too, as the extension allows.
    expect(request.mock.calls.map(([, scopes]) => scopes)).toEqual([
      ["espi:summary"],
      ["espi:summary"],
      ["espi:summary"],
    ]);
    expect(result).toEqual({
      usagePointId: "up-home",
      title: "Home",
      from: "2026-08-26",
      to: "2026-11-25",
      timeZone: "UTC-08:00, UTC-07:00 in daylight time",
      bills: [
        {
          summaryId: "us-202610",
          title: "October 2026",
          period: { from: "2026-10-01", to: "2026-10-31", days: 31 },
          // 459 × 10^3 Wh.
          kWh: 459,
          currency: "USD",
          amount: 151.79,
          additionalCharges: 9.5,
          lineItems: [{ note: "Monthly service charge", amount: 9.5 }],
          tariff: "Flat residential",
          statusAt: "2026-11-01T09:00:00Z",
        },
        {
          summaryId: "us-202609",
          title: "September 2026",
          period: { from: "2026-09-01", to: "2026-09-30", days: 30 },
          kWh: 512,
          currency: "USD",
          amount: 168.22,
          additionalCharges: 9.5,
          lineItems: [{ note: "Monthly service charge", amount: 9.5 }],
          tariff: "Flat residential",
          statusAt: "2026-10-01T09:00:00Z",
        },
      ],
      truncated: false,
    });
    // A meter with no summaries, and an explicit window.
    const ev = await tools.espi_bills!.execute({
      usagePointId: "up-ev",
      from: "2026-10-01",
      to: "2026-10-31",
    });
    expect(ev).toMatchObject({
      bills: [],
      from: "2026-10-01",
      to: "2026-10-31",
      truncated: false,
    });
    expect(urls().at(-1)).toContain(
      "published-min=2026-10-01T07%3A00%3A00Z&published-max=2026-11-01T07%3A00%3A00Z",
    );
  });

  it("gives a period the utility bills in UTC months in UTC dates", async () => {
    // September and October as UTC months: they start at UTC midnight,
    // which is 17:00 the day before in Pacific time.
    const utc = (text: string) =>
      text
        .replace(
          "<espi:start>1790838000</espi:start>",
          "<espi:start>1790812800</espi:start>",
        )
        .replace(
          "<espi:start>1788246000</espi:start>",
          "<espi:start>1788220800</espi:start>",
        );
    const summaries = under(
      `/Subscription/${SUB}/UsagePoint/up-home/UsageSummary`,
    ).map(([, text]) => utc(text));
    const { tools } = setup({
      replies: [
        one(byPath.get(`/Subscription/${SUB}/UsagePoint/up-home`)!),
        one(byPath.get("/LocalTimeParameters/ltp-pacific")!),
        feed(summaries),
      ],
    });
    const result = (await tools.espi_bills!.execute({
      usagePointId: "up-home",
    })) as { bills: Array<{ period: unknown }> };
    expect(result.bills.map((b) => b.period)).toEqual([
      { from: "2026-10-01", to: "2026-10-31", days: 31, timeZone: "UTC" },
      { from: "2026-09-01", to: "2026-09-30", days: 30, timeZone: "UTC" },
    ]);
  });

  it("bounds the bills window and refuses bad input", async () => {
    const { tools, request } = setup();
    for (const input of [
      {},
      { usagePointId: "../x" },
      { usagePointId: "up-home", from: "2026-01-01", to: "2026-11-25" },
      { usagePointId: "up-home", from: "2026-11-25", to: "2026-11-01" },
      { usagePointId: "up-home", from: "2026-01-01" },
      { usagePointId: "up-home", to: "2026-13-01" },
      { usagePointId: "up-home", url: `${RE}/Batch/Subscription/other` },
    ])
      await expect(
        tools.espi_bills!.execute(input),
        JSON.stringify(input),
      ).rejects.toBeInstanceOf(InvalidToolArguments);
    expect(request).not.toHaveBeenCalled();
  });

  it("reads the kept authorizationURI, never returning tokens", async () => {
    const auth = byPath
      .get(`/Authorization/${SUB}`)!
      .replace(
        "<espi:status>",
        "<espi:access_token>secret-access</espi:access_token><espi:refresh_token>secret-refresh</espi:refresh_token><espi:status>",
      );
    const { tools, request, trace } = setup({ replies: [one(auth)] });
    const result = await tools.espi_authorization!.execute({});
    expect(request).toHaveBeenCalledWith(
      `${RE}/Authorization/${SUB}`,
      [],
      accept,
    );
    expect(trace).toHaveBeenCalledWith(
      `GET /espi/1_1/resource/Authorization/${SUB} · ESPI-shaped · no scope · application/atom+xml`,
    );
    expect(result).toEqual({
      authorizationId: SUB,
      status: "active",
      statusCode: 1,
      authorizedPeriod: {
        start: "2026-11-20T18:00:00Z",
        end: "2027-11-20T18:00:00Z",
      },
      publishedPeriod: {
        start: "2026-08-25T07:00:00Z",
        end: "2026-11-25T07:00:00Z",
      },
      expiresAt: "2027-11-20T18:00:00Z",
      scope: "espi:usage espi:summary",
      subscriptionId: SUB,
    });
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(tools.espi_authorization!.schema).toMatchObject({
      properties: {},
      required: [],
    });
  });

  it("names revoked and denied authorizations, and refuses one for another id", async () => {
    const auth = byPath.get(`/Authorization/${SUB}`)!;
    const { tools } = setup({
      replies: [
        one(auth.replace("<espi:status>1<", "<espi:status>0<")),
        one(auth.replace("<espi:status>1<", "<espi:status>2<")),
        one(auth.replace("<espi:status>1<", "<espi:status>7<")),
        one(
          auth.replace(
            `<espi:authorizationURI>${RE}/Authorization/${SUB}`,
            `<espi:authorizationURI>${RE}/Authorization/other`,
          ),
        ),
        one(
          auth.replace(
            `rel="self" href="${RE}/Authorization/${SUB}"`,
            `rel="self" href="${RE}/Authorization/other"`,
          ),
        ),
      ],
    });
    expect(await tools.espi_authorization!.execute({})).toMatchObject({
      status: "revoked",
      statusCode: 0,
    });
    expect(await tools.espi_authorization!.execute({})).toMatchObject({
      status: "denied",
      statusCode: 2,
    });
    expect(await tools.espi_authorization!.execute({})).toMatchObject({
      status: "code 7",
    });
    expect(await tools.espi_authorization!.execute({})).toEqual({
      error: "invalid_response",
    });
    expect(await tools.espi_authorization!.execute({})).toEqual({
      error: "invalid_response",
    });
  });

  it("refuses an authorizationURI outside the entry's endpoint, sending nothing", async () => {
    for (const authorizationUri of [
      undefined,
      "",
      "not a url",
      `https://evil.example/espi/1_1/resource/Authorization/${SUB}`,
      `http://energy-demo.poppylab.dev/espi/1_1/resource/Authorization/${SUB}`,
      `https://energy-demo.poppylab.dev/other/Authorization/${SUB}`,
      `${RE}/Authorization/${SUB}?x=1`,
      `${RE}/Authorization/${SUB}#x`,
      `${RE}/Authorization/${SUB}/extra`,
      `${RE}/Authorization/..`,
      `${RE}/Authorization/a%2Fb`,
      `${RE}/Batch/Subscription/${SUB}`,
      `https://user:pw@energy-demo.poppylab.dev/espi/1_1/resource/Authorization/${SUB}`,
    ]) {
      const { tools, request } = setup({ authorizationUri });
      expect(
        await tools.espi_authorization!.execute({}),
        String(authorizationUri),
      ).toMatchObject({
        error: "authorization_unknown",
      });
      expect(request).not.toHaveBeenCalled();
    }
    await expect(
      setup().tools.espi_authorization!.execute({
        url: `${RE}/Authorization/x`,
      }),
    ).rejects.toBeInstanceOf(InvalidToolArguments);
  });
});

describe("ESPI-shaped subscription, errors and bounds", () => {
  it("takes the subscription only from a resourceURI under the entry's endpoint", async () => {
    for (const resourceUri of [
      undefined,
      `https://evil.example/espi/1_1/resource/Batch/Subscription/${SUB}`,
      `https://energy-demo.poppylab.dev/elsewhere/Batch/Subscription/${SUB}`,
      `${RE}/Subscription/${SUB}`,
      `${RE}/Batch/Subscription/${SUB}/UsagePoint`,
      `${RE}/Batch/Subscription/${SUB}?x=1`,
      `${RE}/Batch/Subscription/..`,
      `${RE}/Batch/Subscription/%2E%2E`,
      `${RE}/Batch/RetailCustomer/${SUB}`,
    ]) {
      const { tools, request } = setup({ resourceUri });
      for (const [name, input] of [
        ["espi_meters", {}],
        [
          "espi_usage",
          { usagePointId: "up-home", from: "2026-11-21", to: "2026-11-21" },
        ],
        ["espi_bills", { usagePointId: "up-home" }],
      ] as const)
        expect(
          await tools[name]!.execute(input),
          `${name} ${resourceUri}`,
        ).toMatchObject({
          error: "subscription_unknown",
        });
      expect(request).not.toHaveBeenCalled();
    }
    // A base64url id may start with - or _.
    const dash = setup({
      resourceUri: `${RE}/Batch/Subscription/-k_2`,
      replies: [feed([])],
    });
    expect(await dash.tools.espi_meters!.execute({})).toEqual({
      usagePoints: [],
      truncated: false,
    });
    expect(dash.urls()).toEqual(["/Subscription/-k_2/UsagePoint"]);
  });

  it("drops entries of another subscription, and links that leave the endpoint", async () => {
    const home = byPath.get(`/Subscription/${SUB}/UsagePoint/up-home`)!;
    const other = home.replaceAll(
      `/Subscription/${SUB}/`,
      "/Subscription/someone-else/",
    );
    const mr = byPath
      .get(`/Subscription/${SUB}/UsagePoint/up-home/MeterReading/mr-home`)!
      .replace(
        `${RE}/ReadingType/rt-home`,
        "https://evil.example/espi/1_1/resource/ReadingType/rt-home",
      );
    const { tools, urls } = setup({
      replies: [feed([other, home]), feed([mr])],
    });
    const result = await tools.espi_meters!.execute({});
    expect(urls()).toEqual([
      `/Subscription/${SUB}/UsagePoint`,
      `/Subscription/${SUB}/UsagePoint/up-home/MeterReading`,
    ]);
    expect(result).toEqual({
      usagePoints: [
        {
          usagePointId: "up-home",
          title: "Home",
          serviceKind: "electricity",
          meterReadings: [
            {
              meterReadingId: "mr-home",
              title: "Home, hourly energy delivered",
              readingType: "unavailable",
            },
          ],
        },
      ],
      truncated: false,
    });
  });

  it("passes utility errors on as structured, bounded errors", async () => {
    const outcome = { error: "sign_in_required", instruction: "Sign in" };
    const { tools } = setup({
      replies: [
        {
          status: 404,
          body: { error: "not_found", description: "No such meter" },
        },
        {
          status: 400,
          body: {
            error: "invalid_parameter",
            description: "published-min is not RFC 3339",
          },
        },
        { status: 500, body: { error: "<script>", description: "x" } },
        {
          status: 403,
          body: { error: "extension_required", description: "x".repeat(5000) },
        },
        { status: 502, body: null },
        { outcome },
      ],
    });
    const usage = () =>
      tools.espi_usage!.execute({
        usagePointId: "up-hidden",
        from: "2026-11-21",
        to: "2026-11-21",
      });
    expect(await usage()).toEqual({ error: "espi_error", status: 404 });
    expect(await usage()).toEqual({
      error: "espi_error",
      status: 400,
      code: "invalid_parameter",
      description: "published-min is not RFC 3339",
    });
    expect(await tools.espi_meters!.execute({})).toEqual({
      error: "espi_error",
      status: 500,
    });
    const long = (await tools.espi_bills!.execute({
      usagePointId: "up-home",
    })) as { description: string };
    expect(long).toMatchObject({
      error: "espi_error",
      status: 403,
      code: "extension_required",
    });
    expect(long.description).toHaveLength(300);
    expect(await tools.espi_authorization!.execute({})).toEqual({
      error: "espi_error",
      status: 502,
    });
    expect(await tools.espi_meters!.execute({})).toBe(outcome);
  });

  it("refuses responses that aren't bounded, strict Atom XML", async () => {
    const atom = (body: string, contentType?: string) => xml(body, contentType);
    const good = `<feed ${NS}></feed>`;
    const cases: Reply[] = [
      atom(good, "text/html"),
      atom(good, "application/json"),
      atom(good, "application/atom+xml; charset=iso-8859-1"),
      { status: 200, body: { usagePoints: [] } },
      { status: 204, body: null },
      { status: 200, contentType: undefined, bytes: "<feed/>" } as never,
      {
        status: 200,
        contentType: "application/atom+xml",
        bytes: new Uint8Array(ESPI_LIMITS.feedBytes + 1),
      },
      atom(`<!DOCTYPE feed [<!ENTITY x "y">]><feed ${NS}>&x;</feed>`),
      atom(`<feed ${NS}><entry><title>&ext;</title></entry></feed>`),
      atom(`<feed ${NS}><entry>`),
      atom(`<rss version="2.0"></rss>`),
      atom(`<feed xmlns="urn:not-atom"></feed>`),
    ];
    const { tools, trace } = setup({ replies: [...cases] });
    for (const [i] of cases.entries())
      expect(await tools.espi_meters!.execute({}), String(i)).toEqual({
        error: "invalid_response",
      });
    expect(trace).toHaveBeenCalledWith(
      `/espi/1_1/resource/Subscription/${SUB}/UsagePoint · Refused XML: DOCTYPE or other declaration`,
    );
    // Parameters of the type are fine, and so is application/xml.
    const fine = setup({
      replies: [
        atom(good, 'Application/Atom+XML; charset="UTF-8"'),
        atom(good, "application/xml"),
      ],
    });
    expect(await fine.tools.espi_meters!.execute({})).toEqual({
      usagePoints: [],
      truncated: false,
    });
    expect(await fine.tools.espi_meters!.execute({})).toEqual({
      usagePoints: [],
      truncated: false,
    });
  });

  it("bounds usage points, meter readings and text from the utility", async () => {
    const point = (i: number) =>
      `<entry><link rel="self" href="${RE}/Subscription/${SUB}/UsagePoint/up-${i}"/><title>Meter\u2028${"x".repeat(300)}</title><content><espi:UsagePoint><espi:ServiceCategory><espi:kind>42</espi:kind></espi:ServiceCategory></espi:UsagePoint></content></entry>`;
    const reading = (up: number, i: number) =>
      `<entry><link rel="self" href="${RE}/Subscription/${SUB}/UsagePoint/up-${up}/MeterReading/mr-${i}"/><content><espi:MeterReading/></content></entry>`;
    const replies: Reply[] = [
      feed(Array.from({ length: 20 }, (_, i) => point(i))),
    ];
    for (let up = 0; up < ESPI_LIMITS.usagePoints; up++)
      replies.push(feed(Array.from({ length: 6 }, (_, i) => reading(up, i))));
    const { tools, request } = setup({ replies });
    const result = (await tools.espi_meters!.execute({})) as {
      usagePoints: Array<{
        title: string;
        serviceKind: string;
        meterReadings: unknown[];
      }>;
      truncated: boolean;
    };
    expect(result.truncated).toBe(true);
    expect(result.usagePoints).toHaveLength(ESPI_LIMITS.usagePoints);
    expect(result.usagePoints[0]!.meterReadings).toHaveLength(
      ESPI_LIMITS.meterReadings,
    );
    expect(result.usagePoints[0]!.title).toBe(`Meter ${"x".repeat(114)}`);
    expect(result.usagePoints[0]!.serviceKind).toBe("code 42");
    expect(request).toHaveBeenCalledTimes(1 + ESPI_LIMITS.usagePoints);
  });

  it("rejects bad input before any request", async () => {
    const { tools, request } = setup();
    for (const [name, input] of [
      ["espi_meters", { usagePointId: "x" }],
      ["espi_meters", { headers: { Authorization: "Bearer x" } }],
      ["espi_meters", []],
      ["espi_usage", {}],
      ["espi_usage", { usagePointId: 7, from: "2026-11-21", to: "2026-11-21" }],
      [
        "espi_usage",
        { usagePointId: "", from: "2026-11-21", to: "2026-11-21" },
      ],
      [
        "espi_usage",
        { usagePointId: "x".repeat(129), from: "2026-11-21", to: "2026-11-21" },
      ],
      [
        "espi_usage",
        { usagePointId: "a b", from: "2026-11-21", to: "2026-11-21" },
      ],
      [
        "espi_usage",
        { usagePointId: "a?b", from: "2026-11-21", to: "2026-11-21" },
      ],
      [
        "espi_usage",
        { usagePointId: ".", from: "2026-11-21", to: "2026-11-21" },
      ],
      ["espi_bills", { usagePointId: "a\\b" }],
      ["espi_authorization", { authorizationUri: `${RE}/Authorization/x` }],
    ] as const)
      await expect(
        tools[name]!.execute(input as unknown as Record<string, unknown>),
        `${name} ${JSON.stringify(input)}`,
      ).rejects.toBeInstanceOf(InvalidToolArguments);
    expect(request).not.toHaveBeenCalled();
  });

  it("refuses an entry whose endpoint carries credentials, a query or a fragment", () => {
    for (const resource_endpoint of [
      `${RE}?x=1`,
      `${RE}#x`,
      "https://u:p@energy-demo.poppylab.dev/espi",
    ])
      expect(() =>
        espiTools({
          entry: { ...entry, resource_endpoint },
          request: vi.fn(),
          trace: vi.fn(),
        }),
      ).toThrow();
  });
});
