/**
 * Fernwick's ESPI-shaped API (`poppylab.dev/espi` v1): discovery, the
 * extension requirement (§3.3), scopes per route, the meters chosen at
 * consent, every route's Atom XML (well-formed, namespaces, links, units),
 * deterministic bytes, the window and paging, 404s, token response fields,
 * the Authorization entry and its revocation, and the bills' arithmetic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ATOM_NS, CUSTOMER_NS, ESPI_NS } from "./atom.ts";
import { ESPI_BASE } from "./espi.ts";
import { espiScopes, scopes } from "./scopes.ts";
import { inject, origin, setup } from "./test-harness.ts";
import { kid, kids, parseXml, textAt, type XmlElement } from "./xml-test.ts";

type Harness = Awaited<ReturnType<typeof setup>>;
const R = ESPI_BASE;
const usage = ["espi:usage", "espi:summary", "espi:customer"];
const NOW = "2026-11-25T12:00:00.000Z";
const at = (iso: string) => Date.parse(iso) / 1000;

/** The XML of a 200 Atom response, parsed, with its raw text. */
function atom(response: Awaited<ReturnType<typeof inject>>) {
  expect(response.statusCode).toBe(200);
  expect(response.headers["content-type"]).toBe("application/atom+xml");
  expect(
    response.body.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n'),
  ).toBe(true);
  const root = parseXml(response.body);
  expect(root.ns).toBe(ATOM_NS);
  return root;
}
const entriesOf = (feed: XmlElement) => kids(feed, "entry", ATOM_NS);
const contentOf = (entry: XmlElement) => {
  const content = kid(entry, "content", ATOM_NS);
  expect(content.attrs).toEqual({});
  expect(content.children).toHaveLength(1);
  return content.children[0]!;
};
const linksOf = (entry: XmlElement) =>
  Object.fromEntries(
    kids(entry, "link", ATOM_NS)
      .filter((l) => l.attrs.rel !== "related")
      .map((l) => [l.attrs.rel, { href: l.attrs.href, type: l.attrs.type }]),
  );
const related = (entry: XmlElement) =>
  kids(entry, "link", ATOM_NS)
    .filter((l) => l.attrs.rel === "related")
    .map((l) => ({ href: l.attrs.href!, type: l.attrs.type! }));
/** Checks an entry's Atom shape; returns its ESPI object. */
function checkEntry(entry: XmlElement, resource: string) {
  expect(textAt(entry, "id")).toMatch(
    /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  expect(textAt(entry, "title")).not.toBe("");
  for (const name of ["published", "updated"])
    expect(textAt(entry, name)).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
    );
  expect(kids(entry, "author")).toHaveLength(0);
  const links = linksOf(entry);
  expect(links.self!.type).toBe(`espi-entry/${resource}`);
  expect(links.self!.href.startsWith(`${origin}${R}/`)).toBe(true);
  expect(links.up!.type).toMatch(/^espi-feed\//);
  const object = contentOf(entry);
  expect(object.local).toBe(resource);
  return object;
}
const path = (url: string) => new URL(url).pathname + new URL(url).search;

describe("Fernwick ESPI-shaped API", () => {
  let h: Harness;
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(NOW));
    h = await setup();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const get = (
    access: string,
    url: string,
    extra: Record<string, string> = {},
  ) => h.call(access, "GET", url, undefined, undefined, "usr_fernwick", extra);

  it("lists the extension and its scopes in discovery, with no second API", async () => {
    const discovery = (await inject("/.well-known/poppy.json")).json();
    expect(discovery.extensions).toEqual({
      operations: [{ version: "3" }],
      "poppylab.dev/espi": [
        {
          version: "1",
          espi_version: "4.0",
          resource_endpoint: `${origin}${R}`,
          resources: [
            "UsagePoint",
            "MeterReading",
            "IntervalBlock",
            "ReadingType",
            "LocalTimeParameters",
            "UsageSummary",
            "Authorization",
            "RetailCustomer",
          ],
          function_blocks: [1, 3, 4, 5, 12, 13, 15, 16, 51, 53, 54, 55],
        },
      ],
    });
    // The ESPI-shaped API is XML: only Fernwick's own OpenAPI is listed.
    expect(discovery.apis).toHaveLength(1);
    expect(Object.keys(discovery.auth.scopes)).toEqual([...scopes]);
    for (const scope of espiScopes)
      expect(discovery.auth.scope_hints[scope]).toEqual({
        changes: "none",
        personal_data: true,
      });
    expect(discovery.auth.scope_hints["plan:write"].changes).toBe("reversible");
    expect(discovery.auth.scopes["espi:usage"]).toContain(
      "function blocks 1, 3, 4, 5, 12 and 13",
    );
    expect(discovery.auth.scopes["espi:summary"]).toContain("15 and 16");
    expect(discovery.auth.scopes["espi:customer"]).toContain(
      "51, 53, 54 and 55",
    );
    expect(discovery.auth.scopes["espi:usage"]).toContain("not certified");
    for (const page of [
      "/",
      "/for-agents",
      "/.well-known/poppy.json",
      "/openapi.json",
    ]) {
      const body = (await inject(page)).body;
      // Names this lab never uses for Fernwick (see docs/fernwick-power.md).
      for (const words of [
        ["green", "button"],
        ["connect", "my", "data"],
        ["compatible"],
      ])
        expect(body.toLowerCase()).not.toContain(words.join(" "));
    }
  });

  it("refuses ESPI routes without the declaration, before the token", async () => {
    const tokens = await h.sign("elena", usage);
    for (const access of [tokens.access_token, ""]) {
      const r = await get(access, path(tokens.resourceURI!), {
        "Poppy-Extensions": '"operations";v="3"',
      });
      expect(r.statusCode).toBe(403);
      expect(r.json()).toEqual({
        error: "extension_required",
        extension: "poppylab.dev/espi",
      });
      expect(r.headers["www-authenticate"]).toBeUndefined();
    }
    // Declared but signed out: a token challenge naming the scope (§7).
    const signedOut = await get("", path(tokens.resourceURI!));
    expect(signedOut.statusCode).toBe(401);
    expect(signedOut.headers["www-authenticate"]).toBe(
      'DPoP scope="espi:usage"',
    );
  });

  it("asks for meters at consent, per person, and refuses none", async () => {
    const { page, consent } = await h.authorize("robin", usage, { meters: [] });
    expect(page.body).toContain(
      'id="account-elena" type="radio" name="account"',
    );
    expect(page.body).toContain('name="espi_meter_UP-E2" value="yes" checked');
    expect(page.body).toContain('name="espi_meter_UP-R1" value="yes" checked');
    expect(page.body).toContain(
      'form:has(#account-robin:checked) .meter-persona[data-persona="robin"]{display:block}',
    );
    expect(consent.statusCode).toBe(400);
    expect(consent.json().error).toBe("invalid_request");
    // Another person's meters are not this person's choice.
    const other = await h.authorize("robin", usage, { meters: ["UP-E1"] });
    expect(other.consent.statusCode).toBe(400);
    // espi:customer alone reads no meter and asks for none.
    const plain = await h.authorize("elena", ["espi:customer"], { meters: [] });
    expect(plain.page.body).not.toContain("Meters to share");
    expect(plain.consent.statusCode).toBe(302);
  });

  it("returns resourceURI and authorizationURI at sign-in and refresh, only with espi scopes", async () => {
    const tokens = await h.sign("elena", [...usage, "offline_access"], {
      allowOffline: true,
    });
    const auth = await get(tokens.access_token, `${R}/Authorization`);
    const grantId = linksOf(entriesOf(atom(auth))[0]!)
      .self!.href.split("/")
      .at(-1)!;
    expect(tokens.resourceURI).toBe(
      `${origin}${R}/Batch/Subscription/${grantId}`,
    );
    expect(tokens.authorizationURI).toBe(
      `${origin}${R}/Authorization/${grantId}`,
    );
    const refreshed = await h.token({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
    });
    expect(refreshed.resourceURI).toBe(tokens.resourceURI);
    expect(refreshed.authorizationURI).toBe(tokens.authorizationURI);
    const own = await h.sign("elena", ["account:read"]);
    expect(own).not.toHaveProperty("resourceURI");
    expect(own).not.toHaveProperty("authorizationURI");
  });

  it("serves the batch: usage points, local time, readings, reading types, blocks and summaries", async () => {
    const tokens = await h.sign("robin", usage);
    const r = await get(tokens.access_token, path(tokens.resourceURI!));
    const feed = atom(r);
    expect(feed.attrs).toEqual({});
    expect(r.body).toContain(`xmlns="${ATOM_NS}"`);
    expect(r.body).toContain(`xmlns:espi="${ESPI_NS}"`);
    expect(textAt(feed, "rights")).toContain(
      "ESPI-shaped (modelled on NAESB REQ.21 ESPI), not certified",
    );
    expect(textAt(feed, "rights")).toContain("Fictional");
    expect(kids(feed, "published")).toHaveLength(0);
    expect(linksOf(feed).self).toEqual({
      href: tokens.resourceURI,
      type: "espi-feed/Batch",
    });
    const kinds = entriesOf(feed).map((entry) => contentOf(entry).local);
    // One meter, two readings; 31 days of blocks each; October's bill.
    expect(kinds.slice(0, 5)).toEqual([
      "UsagePoint",
      "LocalTimeParameters",
      "MeterReading",
      "ReadingType",
      "IntervalBlock",
    ]);
    expect(kinds.filter((k) => k === "IntervalBlock")).toHaveLength(62);
    expect(kinds.filter((k) => k === "MeterReading")).toHaveLength(2);
    expect(kinds.filter((k) => k === "ReadingType")).toHaveLength(2);
    expect(kinds.filter((k) => k === "UsageSummary")).toHaveLength(1);
    for (const entry of entriesOf(feed))
      checkEntry(entry, contentOf(entry).local);
    // The feed's updated is its newest entry's: the last completed hour.
    expect(textAt(feed, "updated")).toBe("2026-11-25T12:00:00Z");
    expect(r.body.length).toBeLessThan(400000);
    // Without espi:summary, no summaries.
    const narrow = await h.sign("robin", ["espi:usage"]);
    const without = atom(
      await get(narrow.access_token, path(narrow.resourceURI!)),
    );
    expect(entriesOf(without).map((e) => contentOf(e).local)).not.toContain(
      "UsageSummary",
    );
  });

  it("serves the same bytes for the same request, and the same hours on another day", async () => {
    const tokens = await h.sign("elena", usage);
    const url = `${R}/Subscription/${tokens.resourceURI!.split("/").at(-1)}/UsagePoint/UP-E2/MeterReading/MR-E2/IntervalBlock`;
    const one = await get(tokens.access_token, url);
    const two = await get(tokens.access_token, url);
    expect(two.body).toBe(one.body);
    // Two days later, through another grant: the same entry ID and content.
    const block = async (access: string, sub: string) => {
      const body = (
        await get(
          access,
          `${R}/Subscription/${sub}/UsagePoint/UP-E2/MeterReading/MR-E2/IntervalBlock/2026-11-20`,
        )
      ).body;
      return [
        /<id>.*?<\/id>/.exec(body)![0],
        /<content>.*<\/content>/s.exec(body)![0],
      ];
    };
    const before = await block(
      tokens.access_token,
      tokens.resourceURI!.split("/").at(-1)!,
    );
    vi.setSystemTime(new Date("2026-11-27T09:30:00Z"));
    h = await setup();
    const later = await h.sign("elena", usage);
    const after = await block(
      later.access_token,
      later.resourceURI!.split("/").at(-1)!,
    );
    expect(after).toEqual(before);
    expect(before[1]).toContain("<espi:IntervalReading>");
  });

  it("describes each resource with ESPI's units and links", async () => {
    const tokens = await h.sign("robin", usage);
    const sub = tokens.resourceURI!.split("/").at(-1)!;
    const S = `${R}/Subscription/${sub}`;
    const list = atom(await get(tokens.access_token, `${S}/UsagePoint`));
    expect(entriesOf(list)).toHaveLength(1);
    const point = checkEntry(entriesOf(list)[0]!, "UsagePoint");
    expect(point.ns).toBe(ESPI_NS);
    expect(textAt(point, "ServiceCategory", "kind")).toBe("0");
    const pointEntry = atom(
      await get(tokens.access_token, `${S}/UsagePoint/UP-R1`),
    );
    expect(pointEntry.local).toBe("entry");
    expect(linksOf(pointEntry)).toEqual({
      self: {
        href: `${origin}${S}/UsagePoint/UP-R1`,
        type: "espi-entry/UsagePoint",
      },
      up: { href: `${origin}${S}/UsagePoint`, type: "espi-feed/UsagePoint" },
    });
    expect(related(pointEntry)).toEqual([
      {
        href: `${origin}${S}/UsagePoint/UP-R1/MeterReading`,
        type: "espi-feed/MeterReading",
      },
      {
        href: `${origin}${S}/UsagePoint/UP-R1/UsageSummary`,
        type: "espi-feed/UsageSummary",
      },
      {
        href: `${origin}${R}/LocalTimeParameters/LTP-PACIFIC`,
        type: "espi-entry/LocalTimeParameters",
      },
    ]);
    // Every link resolves.
    for (const link of related(pointEntry))
      expect((await get(tokens.access_token, path(link.href))).statusCode).toBe(
        200,
      );

    const readings = atom(
      await get(tokens.access_token, `${S}/UsagePoint/UP-R1/MeterReading`),
    );
    const [delivered, received] = entriesOf(readings);
    const rt = related(received!).find(
      (l) => l.type === "espi-entry/ReadingType",
    )!;
    const type = checkEntry(
      atom(await get(tokens.access_token, path(rt.href))),
      "ReadingType",
    );
    expect(type.children.map((c) => [c.local, c.text])).toEqual([
      ["accumulationBehaviour", "4"],
      ["commodity", "1"],
      ["currency", "840"],
      ["flowDirection", "19"],
      ["intervalLength", "3600"],
      ["kind", "12"],
      ["powerOfTenMultiplier", "0"],
      ["uom", "72"],
    ]);
    const deliveredType = related(delivered!).find(
      (l) => l.type === "espi-entry/ReadingType",
    )!;
    expect(deliveredType.href).toBe(
      `${origin}${R}/ReadingType/RT-DELIVERED-WH`,
    );
    expect(
      entriesOf(atom(await get(tokens.access_token, `${R}/ReadingType`))),
    ).toHaveLength(2);
    expect(
      (await get(tokens.access_token, path(linksOf(delivered!).self!.href)))
        .statusCode,
    ).toBe(200);

    const ltp = checkEntry(
      atom(
        await get(tokens.access_token, `${R}/LocalTimeParameters/LTP-PACIFIC`),
      ),
      "LocalTimeParameters",
    );
    expect(ltp.children.map((c) => [c.local, c.text])).toEqual([
      ["dstEndRule", "B40E2000"],
      ["dstOffset", "3600"],
      ["dstStartRule", "360E2000"],
      ["tzOffset", "-28800"],
    ]);

    const blocks = atom(
      await get(
        tokens.access_token,
        `${S}/UsagePoint/UP-R1/MeterReading/MR-R1/IntervalBlock`,
      ),
    );
    expect(entriesOf(blocks)).toHaveLength(31);
    const first = entriesOf(blocks)[0]!;
    expect(textAt(first, "published")).toBe("2026-10-26T00:00:00Z");
    expect(textAt(first, "updated")).toBe("2026-10-27T00:00:00Z");
    const block = checkEntry(first, "IntervalBlock");
    expect(textAt(block, "interval", "start")).toBe(
      String(at("2026-10-26T00:00:00Z")),
    );
    expect(textAt(block, "interval", "duration")).toBe("86400");
    const hours = kids(block, "IntervalReading", ESPI_NS);
    expect(hours).toHaveLength(24);
    for (const [i, hour] of hours.entries()) {
      expect(hour.children.map((c) => c.local)).toEqual([
        "cost",
        "timePeriod",
        "value",
        "tou",
      ]);
      expect(textAt(hour, "timePeriod", "duration")).toBe("3600");
      expect(Number(textAt(hour, "timePeriod", "start"))).toBe(
        at("2026-10-26T00:00:00Z") + i * 3600,
      );
      const value = Number(textAt(hour, "value"));
      const rate = { "1": 17, "2": 25, "3": 41 }[textAt(hour, "tou")]!;
      expect(Number(textAt(hour, "cost"))).toBe(value * rate);
    }
    // Today's block holds the hours that ended: 00:00 to 12:00.
    const today = entriesOf(blocks).at(-1)!;
    expect(textAt(today, "published")).toBe("2026-11-25T00:00:00Z");
    expect(
      kids(checkEntry(today, "IntervalBlock"), "IntervalReading"),
    ).toHaveLength(12);
    // Exported energy is credited at 7 per Wh, with no band.
    const sent = atom(
      await get(
        tokens.access_token,
        `${S}/UsagePoint/UP-R1/MeterReading/MR-R2/IntervalBlock/2026-11-20`,
      ),
    );
    for (const hour of kids(
      checkEntry(sent, "IntervalBlock"),
      "IntervalReading",
    )) {
      expect(kids(hour, "tou")).toHaveLength(0);
      expect(Number(textAt(hour, "cost"))).toBe(
        Number(textAt(hour, "value")) * 7,
      );
    }
  });

  it("adds up each bill summary from its intervals", async () => {
    const tokens = await h.sign("elena", usage);
    const S = `${R}/Subscription/${tokens.resourceURI!.split("/").at(-1)}/UsagePoint/UP-E2`;
    const window =
      "published-min=2026-09-01T00:00:00Z&published-max=2026-11-01T00:00:00Z";
    const summaries = atom(
      await get(tokens.access_token, `${S}/UsageSummary?${window}`),
    );
    expect(entriesOf(summaries).map((e) => textAt(e, "published"))).toEqual([
      "2026-10-01T00:00:00Z",
      "2026-11-01T00:00:00Z",
    ]);
    const october = checkEntry(
      atom(await get(tokens.access_token, `${S}/UsageSummary/2026-10`)),
      "UsageSummary",
    );
    expect(textAt(october, "billingPeriod", "start")).toBe(
      String(at("2026-10-01T00:00:00Z")),
    );
    expect(textAt(october, "billingPeriod", "duration")).toBe(
      String(31 * 86400),
    );
    expect(textAt(october, "statusTimeStamp")).toBe(
      String(at("2026-11-01T00:00:00Z")),
    );
    expect(textAt(october, "currency")).toBe("840");
    expect(textAt(october, "tariffProfile")).toBe("Time of use");
    const lines = kids(october, "costAdditionalDetailLastPeriod");
    expect(lines.map((l) => textAt(l, "note"))).toEqual([
      "Basic service charge",
      "Energy, off-peak",
      "Energy, mid-peak",
      "Energy, peak",
    ]);
    const n = (el: XmlElement, ...p: string[]) => Number(textAt(el, ...p));
    expect(n(october, "billLastPeriod")).toBe(
      lines.reduce((sum, l) => sum + n(l, "amount") + n(l, "rounding"), 0),
    );
    // The energy lines are October's interval costs, as the API serves them.
    const blocks = atom(
      await get(
        tokens.access_token,
        `${S}/MeterReading/MR-E2/IntervalBlock?published-min=2026-10-01T00:00:00Z&published-max=2026-11-01T00:00:00Z`,
      ),
    );
    expect(entriesOf(blocks)).toHaveLength(31);
    let cost = 0,
      wh = 0;
    for (const entry of entriesOf(blocks))
      for (const hour of kids(contentOf(entry), "IntervalReading")) {
        cost += n(hour, "cost");
        wh += n(hour, "value");
      }
    expect(lines.slice(1).reduce((sum, l) => sum + n(l, "amount"), 0)).toBe(
      cost,
    );
    expect(n(october, "overallConsumptionLastPeriod", "value")).toBe(wh);
    expect(textAt(october, "overallConsumptionLastPeriod", "uom")).toBe("72");
  });

  it("chooses the window with published-min and published-max, and pages", async () => {
    const tokens = await h.sign("elena", usage);
    const S = `${R}/Subscription/${tokens.resourceURI!.split("/").at(-1)}/UsagePoint/UP-E1/MeterReading/MR-E1/IntervalBlock`;
    const count = async (query: string) =>
      entriesOf(atom(await get(tokens.access_token, `${S}?${query}`))).map(
        (e) => textAt(e, "published").slice(0, 10),
      );
    expect(await count("")).toHaveLength(31);
    // The window is [min, max): a block starting at max is out.
    expect(
      await count(
        "published-min=2026-11-01T00:00:00Z&published-max=2026-11-03T00:00:00Z",
      ),
    ).toEqual(["2026-11-01", "2026-11-02"]);
    // Every block that overlaps it is in: local midnights (Pacific) take in
    // the UTC days that hold the local day's hours. Offsets are instants.
    expect(
      await count(
        "published-min=2026-11-01T00:00:00-07:00&published-max=2026-11-02T00:00:00-08:00",
      ),
    ).toEqual(["2026-11-01", "2026-11-02"]);
    expect(
      await count(
        "published-min=2026-11-01T07:00:00%2B00:00&published-max=2026-11-01T08:00:00Z",
      ),
    ).toEqual(["2026-11-01"]);
    // Paged as the client pages: 31 at a time.
    expect(
      await count(
        "published-min=2026-08-26T00:00:00Z&published-max=2026-11-26T00:00:00Z&max-results=31&start-index=32",
      ),
    ).toHaveLength(31);
    // Only the 92 days that exist.
    expect(
      await count(
        "published-min=2026-08-25T00:00:00Z&published-max=2026-11-25T00:00:00Z",
      ),
    ).toHaveLength(91);
    expect(
      await count("published-min=2026-11-01T00:00:00Z&max-results=2"),
    ).toEqual(["2026-11-01", "2026-11-02"]);
    expect(
      await count(
        "published-min=2026-11-01T00:00:00Z&max-results=2&start-index=24",
      ),
    ).toEqual(["2026-11-24", "2026-11-25"]);
    expect(await count("start-index=40")).toEqual([]);
    for (const [query, words] of [
      ["published-min=yesterday", "published-min must be an RFC 3339"],
      ["published-max=2026-02-30T00:00:00Z", "published-max must be"],
      [
        "published-min=2026-11-10T00:00:00Z&published-max=2026-11-01T00:00:00Z",
        "must not be after",
      ],
      [
        "published-min=2026-08-01T00:00:00Z&published-max=2026-11-25T00:00:00Z",
        "at most 92 days",
      ],
      ["max-results=0", "max-results"],
      ["start-index=-1", "start-index"],
    ]) {
      const r = await get(tokens.access_token, `${S}?${query}`);
      expect(r.statusCode).toBe(400);
      expect(r.headers["content-type"]).toContain("application/json");
      expect(r.json().error).toBe("invalid_parameter");
      expect(r.json().description).toContain(words);
    }
  });

  it("answers another subscription, an unchosen meter and unknown resources with a bare 404", async () => {
    const tokens = await h.sign("elena", usage, { meters: ["UP-E1"] });
    const other = await h.sign("robin", usage);
    const sub = tokens.resourceURI!.split("/").at(-1)!;
    const otherSub = other.resourceURI!.split("/").at(-1)!;
    for (const url of [
      `${R}/Batch/Subscription/${otherSub}`,
      `${R}/Subscription/${otherSub}/UsagePoint`,
      `${R}/Subscription/${sub}/UsagePoint/UP-E2`,
      `${R}/Subscription/${sub}/UsagePoint/UP-E2/MeterReading/MR-E2/IntervalBlock`,
      `${R}/Subscription/${sub}/UsagePoint/UP-R1`,
      `${R}/Subscription/${sub}/UsagePoint/UP-E1/MeterReading/MR-E2`,
      `${R}/Subscription/${sub}/UsagePoint/UP-E1/MeterReading/MR-E1/IntervalBlock/2026-08-25`,
      `${R}/Subscription/${sub}/UsagePoint/UP-E1/MeterReading/MR-E1/IntervalBlock/2026-11-26`,
      `${R}/Subscription/${sub}/UsagePoint/UP-E1/UsageSummary/2026-11`,
      `${R}/ReadingType/RT-RECEIVED-WH`,
      `${R}/LocalTimeParameters/LTP-OTHER`,
      `${R}/Authorization/${otherSub}`,
      `${R}/Batch/RetailCustomer/${otherSub}`,
      `${R}/NoSuchThing`,
    ]) {
      const r = await get(tokens.access_token, url);
      expect([url, r.statusCode, r.body]).toEqual([url, 404, ""]);
    }
    // The chosen meter alone is in the feed.
    const list = atom(
      await get(tokens.access_token, `${R}/Subscription/${sub}/UsagePoint`),
    );
    expect(entriesOf(list).map((e) => textAt(e, "title"))).toEqual(["Home"]);
  });

  it("enforces each route's scope", async () => {
    const tokens = await h.sign("elena", ["espi:usage"]);
    const sub = tokens.resourceURI!.split("/").at(-1)!;
    for (const [url, scope] of [
      [
        `${R}/Subscription/${sub}/UsagePoint/UP-E1/UsageSummary`,
        "espi:summary",
      ],
      [
        `${R}/Subscription/${sub}/UsagePoint/UP-E1/UsageSummary/2026-10`,
        "espi:summary",
      ],
      [`${R}/Batch/RetailCustomer/${sub}`, "espi:customer"],
      [`${R}/RetailCustomer/${sub}/Customer`, "espi:customer"],
    ]) {
      const r = await get(tokens.access_token, url!);
      expect(r.statusCode).toBe(403);
      expect(r.headers["www-authenticate"]).toContain(`scope="${scope}"`);
    }
    // espi:summary alone reads the usage points and local time, for bills
    // in local dates, but no readings.
    const bills = await h.sign("elena", ["espi:summary"]);
    const bsub = bills.resourceURI!.split("/").at(-1)!;
    for (const [url, status] of [
      [`${R}/Subscription/${bsub}/UsagePoint`, 200],
      [`${R}/Subscription/${bsub}/UsagePoint/UP-E1`, 200],
      [`${R}/LocalTimeParameters/LTP-PACIFIC`, 200],
      [`${R}/Subscription/${bsub}/UsagePoint/UP-E1/UsageSummary`, 200],
      [`${R}/Subscription/${bsub}/UsagePoint/UP-E1/MeterReading`, 403],
      [`${R}/ReadingType/RT-DELIVERED-WH`, 403],
      [`${R}/Batch/Subscription/${bsub}`, 403],
    ] as const)
      expect([url, (await get(bills.access_token, url)).statusCode]).toEqual([
        url,
        status,
      ]);
    const customerOnly = await h.sign("elena", ["espi:customer"]);
    expect(
      (
        await get(
          customerOnly.access_token,
          `${R}/Subscription/${customerOnly.resourceURI!.split("/").at(-1)}/UsagePoint`,
        )
      ).statusCode,
    ).toBe(403);
    const csub = customerOnly.resourceURI!.split("/").at(-1)!;
    expect(
      (await get(customerOnly.access_token, `${R}/Batch/Subscription/${csub}`))
        .statusCode,
    ).toBe(403);
    // Any token of the grant reads its Authorization.
    expect(
      (await get(customerOnly.access_token, `${R}/Authorization/${csub}`))
        .statusCode,
    ).toBe(200);
    const people = atom(
      await get(customerOnly.access_token, `${R}/Batch/RetailCustomer/${csub}`),
    );
    const [customer, location] = entriesOf(people);
    const name = checkEntry(customer!, "Customer");
    expect(name.ns).toBe(CUSTOMER_NS);
    expect(textAt(name, "customerName")).toBe("Elena Maren");
    const place = checkEntry(location!, "ServiceLocation");
    expect(textAt(place, "mainAddress", "streetDetail", "name")).toBe(
      "Bracken Row",
    );
    expect(textAt(place, "mainAddress", "postalCode")).toBe("00000");
    expect(
      (
        await get(
          customerOnly.access_token,
          path(linksOf(location!).self!.href),
        )
      ).statusCode,
    ).toBe(200);
  });

  it("describes the Authorization and revokes the grant on DELETE", async () => {
    const tokens = await h.sign(
      "elena",
      [...usage, "account:read", "offline_access"],
      {
        allowOffline: true,
      },
    );
    const entry = atom(
      await get(tokens.access_token, path(tokens.authorizationURI!)),
    );
    const auth = checkEntry(entry, "Authorization");
    expect(auth.children.map((c) => c.local)).toEqual([
      "authorizedPeriod",
      "publishedPeriod",
      "status",
      "expires_at",
      "scope",
      "token_type",
      "resourceURI",
      "authorizationURI",
      "customerResourceURI",
    ]);
    expect(textAt(auth, "status")).toBe("1");
    expect(textAt(auth, "authorizedPeriod", "start")).toBe(String(at(NOW)));
    expect(textAt(auth, "authorizedPeriod", "duration")).toBe(
      String(7 * 86400),
    );
    expect(textAt(auth, "publishedPeriod", "start")).toBe(
      String(at("2026-08-26T00:00:00Z")),
    );
    expect(textAt(auth, "scope").split(" ").sort()).toEqual(
      [...usage, "account:read", "offline_access"].sort(),
    );
    expect(textAt(auth, "resourceURI")).toBe(tokens.resourceURI);
    expect(textAt(auth, "authorizationURI")).toBe(tokens.authorizationURI);
    const revoked = await h.call(
      tokens.access_token,
      "DELETE",
      path(tokens.authorizationURI!),
    );
    expect(revoked.statusCode).toBe(204);
    expect(revoked.body).toBe("");
    for (const url of [path(tokens.resourceURI!), "/api/account/account"]) {
      const r = await get(tokens.access_token, url);
      expect(r.statusCode).toBe(401);
      expect(r.headers["www-authenticate"]).toContain("invalid_token");
    }
    const refreshed = await h.token({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
    });
    expect(refreshed.error).toBe("invalid_grant");
  });
});
