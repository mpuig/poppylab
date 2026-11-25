/**
 * Fernwick's ESPI-shaped, read-only API (`poppylab.dev/espi` v1), modelled
 * on NAESB REQ.21 ESPI and not certified: Atom feeds and entries of the
 * meters (UsagePoints) the User chose at consent, their readings, hourly
 * IntervalBlocks with cost, bill summaries, the customer, and the
 * Authorization behind the token. Element names and codes follow the ESPI
 * schemas; the data, titles and rules are Fernwick's own.
 *
 * Only requests that declare the extension get here (§3.3,
 * `requiredExtension`), and the gateway has already checked the Session,
 * the token and the route's scope (§7, `accountPrefixes`,
 * `requiredScopes`). The subscription is the grant: `{sub}` is its ID.
 */
import type { Context, Hono } from "hono";
import type { CompanyDefinition, GrantView } from "@poppy-lab/pap-company";
import {
  addressLine,
  ESPI_SHAPED,
  FICTION_NOTICE,
  plans,
  READING_TYPES,
  type MeterReadingSeed,
  type ReadingTypeId,
} from "./data.ts";
import { billsFor, readings, type Bill } from "./billing.ts";
import {
  ATOM_TYPE,
  cust,
  entryDocument,
  espi,
  feedDocument,
  type Entry,
} from "./atom.ts";
import {
  DAY,
  HOUR,
  dayStart,
  historyOf,
  isoDay,
  nowSeconds,
  PACIFIC,
  ruleHex,
} from "./time.ts";
import { withinGrant, type Customer, type Meter } from "./state.ts";

/** The extension (§3.3) and where its resources live. */
export const ESPI = { name: "poppylab.dev/espi", version: "1" } as const;
export const ESPI_BASE = "/espi/1_1/resource";
export const DEFAULT_WINDOW_DAYS = 31,
  MAX_WINDOW_DAYS = 92,
  MAX_RESULTS = 1000;
/** When the fictional meters were installed: their entries' dates. */
export const SERVICE_START = Date.UTC(2024, 2, 1) / 1000;
const RIGHTS = `${FICTION_NOTICE} ${ESPI_SHAPED}.`;

type Mount = Parameters<CompanyDefinition["mount"]>[1];
type View = {
  customer: Customer;
  grant: GrantView;
  account: string;
  meters: Meter[];
  scopes: string[];
  now: number;
  /** Absolute `resource_endpoint`. */
  base: string;
};

// ---- Query parameters ------------------------------------------------------

const RFC3339 =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/i;
/** An RFC 3339 date-time as UTC seconds, or `undefined` when malformed. */
export function instant(value: string) {
  // A `+` in a query string arrives as a space.
  const match = RFC3339.exec(value.replace(/ (\d{2}:\d{2})$/, "+$1"));
  if (!match) return undefined;
  const [, y, mo, d, h, mi, s] = match.map(Number) as number[];
  const day = new Date(Date.UTC(y!, mo! - 1, d!));
  if (
    mo! < 1 ||
    mo! > 12 ||
    day.getUTCDate() !== d ||
    h! > 23 ||
    mi! > 59 ||
    s! > 59
  )
    return undefined;
  const ms = Date.parse(match[0]);
  return Number.isNaN(ms) ? undefined : Math.floor(ms / 1000);
}
export type Query = {
  min: number;
  max: number;
  maxResults: number;
  startIndex: number;
};
/** Malformed parameters: Fernwick's own JSON body (ESPI defines none). */
const invalid = (c: Context, description: string) =>
  c.json({ error: "invalid_parameter", description }, 400);
/**
 * `published-min` and `published-max` are the window `[min, max)`: an
 * IntervalBlock or a bill summary is in it when its interval (the UTC day,
 * the billing month) overlaps it, so every hour inside the window comes
 * with its block, and one starting at `max` is out. By default the 31 UTC
 * days up to now (today and the 30 before), at most 92 days apart. `max-results` (at most 1000) and
 * `start-index` (from 1) page any feed's entries.
 */
export function parseQuery(c: Context, now: number): Query | Response {
  const q = c.req.query();
  const time = (name: "published-min" | "published-max") => {
    const value = q[name];
    return value === undefined ? null : instant(value);
  };
  const max = time("published-max"),
    min = time("published-min");
  for (const [name, value] of [
    ["published-min", min],
    ["published-max", max],
  ] as const)
    if (value === undefined)
      return invalid(
        c,
        `${name} must be an RFC 3339 date-time, such as 2026-11-01T00:00:00Z`,
      );
  const to = max ?? now;
  const from = min ?? dayStart(to) - (DEFAULT_WINDOW_DAYS - 1) * DAY;
  if (from > to)
    return invalid(c, "published-min must not be after published-max");
  if (to - from > MAX_WINDOW_DAYS * DAY)
    return invalid(
      c,
      `published-min and published-max must be at most ${MAX_WINDOW_DAYS} days apart`,
    );
  const count = (name: "max-results" | "start-index", fallback: number) => {
    const value = q[name];
    if (value === undefined) return fallback;
    return /^\d{1,9}$/.test(value) && Number(value) >= 1
      ? Number(value)
      : undefined;
  };
  const maxResults = count("max-results", MAX_RESULTS),
    startIndex = count("start-index", 1);
  if (maxResults === undefined)
    return invalid(c, "max-results must be a whole number from 1");
  if (startIndex === undefined)
    return invalid(c, "start-index must be a whole number from 1");
  return {
    min: from,
    max: to,
    maxResults: Math.min(maxResults, MAX_RESULTS),
    startIndex,
  };
}
const page = (entries: Entry[], q: Query) =>
  entries.slice(q.startIndex - 1, q.startIndex - 1 + q.maxResults);
/** Whether `[start, end)` overlaps the window `[min, max)`. */
const inWindow = (start: number, end: number, q: Query) =>
  start < q.max && end > q.min;

// ---- Paths and links -------------------------------------------------------

const paths = (view: View) => {
  const sub = `${view.base}/Subscription/${view.grant.id}`;
  const usagePoint = (meter: Meter) => `${sub}/UsagePoint/${meter.seed.id}`;
  const meterReading = (meter: Meter, reading: MeterReadingSeed) =>
    `${usagePoint(meter)}/MeterReading/${reading.id}`;
  return {
    batch: `${view.base}/Batch/Subscription/${view.grant.id}`,
    usagePoints: `${sub}/UsagePoint`,
    usagePoint,
    meterReadings: (meter: Meter) => `${usagePoint(meter)}/MeterReading`,
    meterReading,
    intervalBlocks: (meter: Meter, reading: MeterReadingSeed) =>
      `${meterReading(meter, reading)}/IntervalBlock`,
    usageSummaries: (meter: Meter) => `${usagePoint(meter)}/UsageSummary`,
    readingTypes: `${view.base}/ReadingType`,
    readingType: (id: string) => `${view.base}/ReadingType/${id}`,
    localTimes: `${view.base}/LocalTimeParameters`,
    localTime: `${view.base}/LocalTimeParameters/${PACIFIC.id}`,
    authorizations: `${view.base}/Authorization`,
    authorization: `${view.base}/Authorization/${view.grant.id}`,
    retailCustomer: `${view.base}/Batch/RetailCustomer/${view.grant.id}`,
    customer: `${view.base}/RetailCustomer/${view.grant.id}/Customer`,
    serviceLocation: `${view.base}/RetailCustomer/${view.grant.id}/ServiceLocation`,
  };
};
const entryType = (resource: string) => `espi-entry/${resource}`;
const feedType = (resource: string) => `espi-feed/${resource}`;
const self = (resource: string, href: string) =>
  ({ rel: "self", type: entryType(resource), href }) as const;
const up = (resource: string, href: string) =>
  ({ rel: "up", type: feedType(resource), href }) as const;
const related = (type: string, href: string) =>
  ({ rel: "related", type, href }) as const;
const interval = (start: number, duration: number) =>
  [espi("duration", duration), espi("start", start)] as const;

// ---- Entries ---------------------------------------------------------------

/** Every key starts with the customer: each customer's resources are theirs. */
const keyOf = (view: View, ...parts: string[]) =>
  ["fernwick", view.customer.seed.id, ...parts].join(":");

function usagePointEntry(view: View, meter: Meter): Entry {
  const p = paths(view);
  return {
    key: keyOf(view, "UsagePoint", meter.seed.id),
    title: meter.seed.label,
    published: SERVICE_START,
    updated: SERVICE_START,
    links: [
      self("UsagePoint", p.usagePoint(meter)),
      up("UsagePoint", p.usagePoints),
      related(feedType("MeterReading"), p.meterReadings(meter)),
      related(feedType("UsageSummary"), p.usageSummaries(meter)),
      related(entryType("LocalTimeParameters"), p.localTime),
    ],
    // Electricity (ServiceKind 0), in service.
    content: espi(
      "UsagePoint",
      espi("ServiceCategory", espi("kind", 0)),
      espi("status", 1),
    ),
  };
}
function meterReadingEntry(
  view: View,
  meter: Meter,
  reading: MeterReadingSeed,
): Entry {
  const p = paths(view);
  return {
    key: keyOf(view, "MeterReading", reading.id),
    title:
      reading.flowDirection === 1
        ? "Hourly energy delivered"
        : "Hourly energy sent to the grid",
    published: SERVICE_START,
    updated: SERVICE_START,
    links: [
      self("MeterReading", p.meterReading(meter, reading)),
      up("MeterReading", p.meterReadings(meter)),
      related(entryType("ReadingType"), p.readingType(reading.readingType)),
      related(feedType("IntervalBlock"), p.intervalBlocks(meter, reading)),
    ],
    content: espi("MeterReading"),
  };
}
function readingTypeEntry(view: View, id: ReadingTypeId): Entry {
  const type = READING_TYPES[id];
  const p = paths(view);
  return {
    key: `fernwick:ReadingType:${id}`,
    title: type.title,
    published: SERVICE_START,
    updated: SERVICE_START,
    links: [
      self("ReadingType", p.readingType(id)),
      up("ReadingType", p.readingTypes),
    ],
    // In the schema's order: summed per interval (4), electricity at the
    // meter (1), US dollars (840), the flow, an hour, energy (12), no
    // power of ten, watt-hours (72).
    content: espi(
      "ReadingType",
      espi("accumulationBehaviour", 4),
      espi("commodity", 1),
      espi("currency", 840),
      espi("flowDirection", type.flowDirection),
      espi("intervalLength", HOUR),
      espi("kind", 12),
      espi("powerOfTenMultiplier", 0),
      espi("uom", 72),
    ),
  };
}
function localTimeEntry(view: View): Entry {
  const p = paths(view);
  return {
    key: `fernwick:LocalTimeParameters:${PACIFIC.id}`,
    title: PACIFIC.name,
    published: SERVICE_START,
    updated: SERVICE_START,
    links: [
      self("LocalTimeParameters", p.localTime),
      up("LocalTimeParameters", p.localTimes),
    ],
    content: espi(
      "LocalTimeParameters",
      espi("dstEndRule", ruleHex(PACIFIC.dstEndRule)),
      espi("dstOffset", PACIFIC.dstOffset),
      espi("dstStartRule", ruleHex(PACIFIC.dstStartRule)),
      espi("tzOffset", PACIFIC.tzOffset),
    ),
  };
}
/** The IntervalBlock of the UTC day starting at `day`: hours that ended. */
function intervalBlockEntry(
  view: View,
  meter: Meter,
  reading: MeterReadingSeed,
  day: number,
): Entry | undefined {
  const end = Math.min(day + DAY, historyOf(view.now).to);
  if (end <= day) return undefined;
  const hours = readings(
    meter.seed,
    reading.flowDirection,
    meter.history,
    day,
    end,
  );
  const p = paths(view);
  const href = `${p.intervalBlocks(meter, reading)}/${isoDay(day)}`;
  return {
    key: keyOf(view, "IntervalBlock", reading.id, isoDay(day)),
    title: `Hourly readings for ${isoDay(day)} (UTC)`,
    published: day,
    updated: end,
    links: [
      self("IntervalBlock", href),
      up("IntervalBlock", p.intervalBlocks(meter, reading)),
    ],
    content: espi(
      "IntervalBlock",
      espi("interval", ...interval(day, end - day)),
      ...hours.map((hour) =>
        espi(
          "IntervalReading",
          espi("cost", hour.cost),
          espi("timePeriod", ...interval(hour.start, HOUR)),
          espi("value", hour.value),
          hour.tou !== undefined && espi("tou", hour.tou),
        ),
      ),
    ),
  };
}
function usageSummaryEntry(view: View, meter: Meter, bill: Bill): Entry {
  const p = paths(view);
  const month = new Date(bill.start * 1000).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return {
    key: keyOf(view, "UsageSummary", meter.seed.id, bill.id),
    title: `${meter.seed.label}: bill for ${month}`,
    published: bill.end,
    updated: bill.end,
    links: [
      self("UsageSummary", `${p.usageSummaries(meter)}/${bill.id}`),
      up("UsageSummary", p.usageSummaries(meter)),
    ],
    content: espi(
      "UsageSummary",
      espi("billingPeriod", ...interval(bill.start, bill.end - bill.start)),
      espi("billLastPeriod", bill.total),
      ...bill.lines.map((item) =>
        espi(
          "costAdditionalDetailLastPeriod",
          espi("amount", item.amount),
          espi("rounding", item.rounding),
          espi("note", item.note),
          item.wh !== undefined &&
            espi(
              "measurement",
              espi("powerOfTenMultiplier", 0),
              espi("uom", 72),
              espi("value", item.wh),
            ),
          espi("itemKind", item.itemKind),
          item.unitCost !== undefined && espi("unitCost", item.unitCost),
          espi("itemPeriod", ...interval(bill.start, bill.end - bill.start)),
        ),
      ),
      espi("currency", 840),
      espi(
        "overallConsumptionLastPeriod",
        espi("powerOfTenMultiplier", 0),
        espi("uom", 72),
        espi("value", bill.deliveredWh),
      ),
      espi("statusTimeStamp", bill.end),
      espi("commodity", 1),
      espi("tariffProfile", plans[bill.plan].name),
    ),
  };
}
function authorizationEntry(view: View): Entry {
  const p = paths(view);
  const created = view.grant.created_at
    ? Math.floor(Date.parse(view.grant.created_at) / 1000)
    : view.now;
  const expires = Math.floor(Date.parse(view.grant.expires_at) / 1000);
  const history = historyOf(view.now);
  return {
    key: `fernwick:Authorization:${view.grant.id}`,
    title: "Access to your fictional Fernwick data",
    published: created,
    updated: created,
    links: [
      self("Authorization", p.authorization),
      up("Authorization", p.authorizations),
    ],
    content: espi(
      "Authorization",
      espi("authorizedPeriod", ...interval(created, expires - created)),
      espi(
        "publishedPeriod",
        ...interval(history.from, history.to - history.from),
      ),
      // Only a live grant's token gets here: revoked or expired ones fail
      // at the gateway, so the status is always 1, active.
      espi("status", 1),
      espi("expires_at", expires),
      espi("scope", view.grant.scopes.join(" ")),
      // The tokens are DPoP-bound (§4.5); ESPI's schema lists only Bearer.
      espi("token_type", "DPoP"),
      espi("resourceURI", p.batch),
      espi("authorizationURI", p.authorization),
      view.grant.scopes.includes("espi:customer") &&
        espi("customerResourceURI", p.retailCustomer),
    ),
  };
}
function customerEntries(view: View): Entry[] {
  const p = paths(view);
  const { seed } = view.customer;
  return [
    {
      key: keyOf(view, "Customer"),
      title: seed.name,
      published: SERVICE_START,
      updated: SERVICE_START,
      links: [
        self("Customer", p.customer),
        up("RetailCustomer", p.retailCustomer),
        related(entryType("ServiceLocation"), p.serviceLocation),
      ],
      content: cust("Customer", cust("customerName", seed.name)),
    },
    {
      key: keyOf(view, "ServiceLocation"),
      title: addressLine(seed.address),
      published: SERVICE_START,
      updated: SERVICE_START,
      links: [
        self("ServiceLocation", p.serviceLocation),
        up("RetailCustomer", p.retailCustomer),
        related(entryType("Customer"), p.customer),
      ],
      content: cust(
        "ServiceLocation",
        cust(
          "mainAddress",
          cust(
            "streetDetail",
            cust("number", seed.address.number),
            cust("name", seed.address.street),
          ),
          cust("townDetail", cust("name", seed.address.town)),
          cust("postalCode", seed.address.postalCode),
        ),
      ),
    },
  ];
}

/** The UTC days whose IntervalBlocks are published inside the window. */
function blockDays(view: View, q: Query) {
  const { from, to } = historyOf(view.now);
  const days: number[] = [];
  for (let day = from; day < to; day += DAY)
    if (inWindow(day, day + DAY, q)) days.push(day);
  return days;
}
const blocksOf = (
  view: View,
  meter: Meter,
  reading: MeterReadingSeed,
  q: Query,
) =>
  blockDays(view, q)
    .map((day) => intervalBlockEntry(view, meter, reading, day))
    .filter((entry): entry is Entry => !!entry);
const summariesOf = (view: View, meter: Meter, q: Query) =>
  billsFor(meter.seed, meter.history, view.now)
    .filter((bill) => inWindow(bill.start, bill.end, q))
    .map((bill) => usageSummaryEntry(view, meter, bill));
/** The ReadingTypes the chosen meters use, in order of first use. */
const readingTypesOf = (view: View) => [
  ...new Set(
    view.meters.flatMap((meter) =>
      meter.seed.readings.map(
        (reading) => reading.readingType as ReadingTypeId,
      ),
    ),
  ),
];

// ---- Routes ----------------------------------------------------------------

export function mountEspi(
  app: Hono,
  ctx: Mount,
  { customerFor }: { customerFor: (id: string) => Customer },
) {
  const atom = (c: Context, body: string) =>
    c.body(body, 200, {
      "Content-Type": ATOM_TYPE,
      "Cache-Control": "no-store",
    });
  // Not revealing whether a resource exists (ESPI does the same).
  const notFound = (c: Context) => c.body(null, 404);
  /** What this request may see: its grant, customer and chosen meters. */
  const viewOf = (c: Context): View | undefined => {
    const session = ctx.sessionFor(c);
    const grant = ctx.grantFor(c);
    // The gateway refused tokens without a grant; this never answers one.
    if (!grant || !session.account) return undefined;
    const customer = customerFor(session.account);
    return {
      customer,
      grant,
      account: session.account,
      meters: withinGrant(customer, grant.resources),
      // The token's own scopes, which may be fewer than the grant's.
      scopes: (session.scopes ?? "").split(" "),
      now: nowSeconds(),
      base: `${ctx.origin}${ESPI_BASE}`,
    };
  };
  /** The view and query of a request for subscription `:sub`, or a refusal. */
  const subscription = (c: Context) => {
    const view = viewOf(c);
    if (!view || c.req.param("sub") !== view.grant.id) return notFound(c);
    const q = parseQuery(c, view.now);
    if (q instanceof Response) return q;
    return { view, q };
  };
  /**
   * The usage point and local time routes serve `espi:summary` too, so a
   * token for bills alone can place them in local dates; readings and
   * intervals stay `espi:usage` (gateway, `requiredScopes`).
   */
  const reads = (view: View) =>
    view.scopes.includes("espi:usage") || view.scopes.includes("espi:summary");
  const insufficient = (c: Context) =>
    c.json({ error: "insufficient_scope" }, 403, {
      "WWW-Authenticate": 'DPoP error="insufficient_scope", scope="espi:usage"',
    });
  const meterOf = (view: View, id: string | undefined) =>
    view.meters.find((meter) => meter.seed.id === id);
  const readingOf = (meter: Meter, id: string | undefined) =>
    meter.seed.readings.find((reading) => reading.id === id);
  const feed = (
    c: Context,
    view: View,
    q: Query,
    resource: string,
    href: string,
    title: string,
    entries: Entry[],
    kind?: "customer",
  ) =>
    atom(
      c,
      feedDocument({
        key: `fernwick:feed:${view.grant.id}:${href.slice(view.base.length)}`,
        title,
        self: { href, type: feedType(resource) },
        entries: page(entries, q),
        empty: SERVICE_START,
        rights: RIGHTS,
        ...(kind ? { kind } : {}),
      }),
    );
  const entry = (c: Context, value: Entry, kind?: "customer") =>
    atom(c, entryDocument(value, RIGHTS, kind));
  const S = `${ESPI_BASE}/Subscription/:sub/UsagePoint`;

  app.get(`${ESPI_BASE}/Batch/Subscription/:sub`, (c) => {
    const found = subscription(c);
    if (found instanceof Response) return found;
    const { view, q } = found;
    const summaries = view.scopes.includes("espi:summary");
    const typesSeen = new Set<string>();
    const entries: Entry[] = [];
    for (const [i, meter] of view.meters.entries()) {
      entries.push(usagePointEntry(view, meter));
      if (i === 0) entries.push(localTimeEntry(view));
      for (const reading of meter.seed.readings) {
        entries.push(meterReadingEntry(view, meter, reading));
        if (!typesSeen.has(reading.readingType)) {
          typesSeen.add(reading.readingType);
          entries.push(
            readingTypeEntry(view, reading.readingType as ReadingTypeId),
          );
        }
        entries.push(...blocksOf(view, meter, reading, q));
      }
      if (summaries) entries.push(...summariesOf(view, meter, q));
    }
    return feed(
      c,
      view,
      q,
      "Batch",
      paths(view).batch,
      "Fernwick Power & Light: your chosen meters",
      entries,
    );
  });

  app.get(S, (c) => {
    const found = subscription(c);
    if (found instanceof Response) return found;
    const { view, q } = found;
    if (!reads(view)) return insufficient(c);
    return feed(
      c,
      view,
      q,
      "UsagePoint",
      paths(view).usagePoints,
      "Usage points",
      view.meters.map((meter) => usagePointEntry(view, meter)),
    );
  });
  app.get(`${S}/:up`, (c) => {
    const found = subscription(c);
    if (found instanceof Response) return found;
    if (!reads(found.view)) return insufficient(c);
    const meter = meterOf(found.view, c.req.param("up"));
    return meter ? entry(c, usagePointEntry(found.view, meter)) : notFound(c);
  });
  app.get(`${S}/:up/MeterReading`, (c) => {
    const found = subscription(c);
    if (found instanceof Response) return found;
    const { view, q } = found;
    const meter = meterOf(view, c.req.param("up"));
    if (!meter) return notFound(c);
    return feed(
      c,
      view,
      q,
      "MeterReading",
      paths(view).meterReadings(meter),
      `Meter readings of ${meter.seed.label}`,
      meter.seed.readings.map((reading) =>
        meterReadingEntry(view, meter, reading),
      ),
    );
  });
  app.get(`${S}/:up/MeterReading/:mr`, (c) => {
    const found = subscription(c);
    if (found instanceof Response) return found;
    const meter = meterOf(found.view, c.req.param("up"));
    const reading = meter && readingOf(meter, c.req.param("mr"));
    return meter && reading
      ? entry(c, meterReadingEntry(found.view, meter, reading))
      : notFound(c);
  });
  app.get(`${S}/:up/MeterReading/:mr/IntervalBlock`, (c) => {
    const found = subscription(c);
    if (found instanceof Response) return found;
    const { view, q } = found;
    const meter = meterOf(view, c.req.param("up"));
    const reading = meter && readingOf(meter, c.req.param("mr"));
    if (!meter || !reading) return notFound(c);
    return feed(
      c,
      view,
      q,
      "IntervalBlock",
      paths(view).intervalBlocks(meter, reading),
      `Hourly readings of ${meter.seed.label}, one block per UTC day`,
      blocksOf(view, meter, reading, q),
    );
  });
  app.get(`${S}/:up/MeterReading/:mr/IntervalBlock/:day`, (c) => {
    const found = subscription(c);
    if (found instanceof Response) return found;
    const { view } = found;
    const meter = meterOf(view, c.req.param("up"));
    const reading = meter && readingOf(meter, c.req.param("mr"));
    const day = c.req.param("day");
    const start = /^\d{4}-\d{2}-\d{2}$/.test(day)
      ? Date.parse(`${day}T00:00:00Z`) / 1000
      : NaN;
    const { from } = historyOf(view.now);
    const block =
      meter &&
      reading &&
      start >= from &&
      isoDay(start) === day &&
      intervalBlockEntry(view, meter, reading, dayStart(start));
    return block ? entry(c, block) : notFound(c);
  });
  app.get(`${S}/:up/UsageSummary`, (c) => {
    const found = subscription(c);
    if (found instanceof Response) return found;
    const { view, q } = found;
    const meter = meterOf(view, c.req.param("up"));
    if (!meter) return notFound(c);
    return feed(
      c,
      view,
      q,
      "UsageSummary",
      paths(view).usageSummaries(meter),
      `Bills of ${meter.seed.label}`,
      summariesOf(view, meter, q),
    );
  });
  app.get(`${S}/:up/UsageSummary/:id`, (c) => {
    const found = subscription(c);
    if (found instanceof Response) return found;
    const { view } = found;
    const meter = meterOf(view, c.req.param("up"));
    const bill =
      meter &&
      billsFor(meter.seed, meter.history, view.now).find(
        (item) => item.id === c.req.param("id"),
      );
    return meter && bill
      ? entry(c, usageSummaryEntry(view, meter, bill))
      : notFound(c);
  });

  /** A request outside a subscription path: its view and query. */
  const plain = (c: Context) => {
    const view = viewOf(c);
    if (!view) return notFound(c);
    const q = parseQuery(c, view.now);
    if (q instanceof Response) return q;
    return { view, q };
  };
  app.get(`${ESPI_BASE}/ReadingType`, (c) => {
    const found = plain(c);
    if (found instanceof Response) return found;
    const { view, q } = found;
    return feed(
      c,
      view,
      q,
      "ReadingType",
      paths(view).readingTypes,
      "Reading types of your chosen meters",
      readingTypesOf(view).map((id) => readingTypeEntry(view, id)),
    );
  });
  app.get(`${ESPI_BASE}/ReadingType/:id`, (c) => {
    const found = plain(c);
    if (found instanceof Response) return found;
    const id = readingTypesOf(found.view).find(
      (item) => item === c.req.param("id"),
    );
    return id ? entry(c, readingTypeEntry(found.view, id)) : notFound(c);
  });
  app.get(`${ESPI_BASE}/LocalTimeParameters`, (c) => {
    const found = plain(c);
    if (found instanceof Response) return found;
    if (!reads(found.view)) return insufficient(c);
    const { view, q } = found;
    return feed(
      c,
      view,
      q,
      "LocalTimeParameters",
      paths(view).localTimes,
      "Local time of your chosen meters",
      view.meters.length ? [localTimeEntry(view)] : [],
    );
  });
  app.get(`${ESPI_BASE}/LocalTimeParameters/:id`, (c) => {
    const found = plain(c);
    if (found instanceof Response) return found;
    if (!reads(found.view)) return insufficient(c);
    return found.view.meters.length && c.req.param("id") === PACIFIC.id
      ? entry(c, localTimeEntry(found.view))
      : notFound(c);
  });

  // The Authorization is the grant's, read or ended with any of its tokens.
  app.get(`${ESPI_BASE}/Authorization`, (c) => {
    const found = plain(c);
    if (found instanceof Response) return found;
    const { view, q } = found;
    return feed(
      c,
      view,
      q,
      "Authorization",
      paths(view).authorizations,
      "Your authorization",
      [authorizationEntry(view)],
    );
  });
  app.get(`${ESPI_BASE}/Authorization/:sub`, (c) => {
    const found = subscription(c);
    if (found instanceof Response) return found;
    return entry(c, authorizationEntry(found.view));
  });
  app.delete(`${ESPI_BASE}/Authorization/:sub`, (c) => {
    const view = viewOf(c);
    if (!view || c.req.param("sub") !== view.grant.id) return notFound(c);
    // Ends the grant, its access tokens and its refresh token (§4.6), as
    // disconnecting the agent in the customer portal does.
    ctx.grants.revoke(view.account, view.grant.id);
    return c.body(null, 204);
  });

  app.get(`${ESPI_BASE}/Batch/RetailCustomer/:sub`, (c) => {
    const found = subscription(c);
    if (found instanceof Response) return found;
    const { view, q } = found;
    return feed(
      c,
      view,
      q,
      "RetailCustomer",
      paths(view).retailCustomer,
      "Your name and service address",
      customerEntries(view),
      "customer",
    );
  });
  app.get(
    `${ESPI_BASE}/RetailCustomer/:sub/:part{Customer|ServiceLocation}`,
    (c) => {
      const found = subscription(c);
      if (found instanceof Response) return found;
      const [customer, location] = customerEntries(found.view);
      return entry(
        c,
        c.req.param("part") === "Customer" ? customer! : location!,
        "customer",
      );
    },
  );

  app.all(`${ESPI_BASE}/*`, (c) => c.body(null, 404));
}
