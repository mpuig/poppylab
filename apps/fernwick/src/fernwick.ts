/**
 * Fernwick Power & Light: a fully fictional PAP 1.0 electricity utility.
 * Its own API shows the account, meters, rate plans and bills, and
 * proposes one change, a rate plan switch, behind Operations v3 approval.
 * The same data is served read-only as ESPI-shaped Atom XML through the
 * `poppylab.dev/espi` extension (`espi.ts`). No electricity is supplied or
 * billed and no real utility data exists.
 */
import { createHash } from "node:crypto";
import type { Context, Hono } from "hono";
import {
  GRANT_MS,
  TOKEN_MS,
  type CompanyDefinition,
} from "@poppy-lab/pap-company";
import {
  addressLine,
  EXPORT_CREDIT_PER_WH,
  energyPersona,
  ESPI_SHAPED,
  FICTION_NOTICE,
  planIds,
  plans,
  type PlanId,
} from "./data.ts";
import { billsFor, type Bill } from "./billing.ts";
import { isoDay, nextMonthStart, nowSeconds } from "./time.ts";
import {
  customerStore,
  planStatus,
  withinGrant,
  type Meter,
  type State,
} from "./state.ts";
import { cannotSwitch, estimate, switchAction } from "./plans.ts";
import { howItWorksPage, type AgentGuide } from "./how-it-works.ts";
import { ESPI, ESPI_BASE, mountEspi } from "./espi.ts";
import {
  isEspiScope,
  meterScopes,
  scopeDescriptions,
  scopes,
  type FernwickScope,
} from "./scopes.ts";
import { fernwickAgent } from "./agent.ts";
import { skills } from "./skills.ts";
import { mountPortal } from "./portal.ts";
import {
  consentExpiredPage,
  consentPage,
  fontSources,
  forAgentsPage,
  homePage,
  pageHeaders,
} from "./site.ts";

export { customers, energyPersona } from "./data.ts";
export { scopes, espiScopes, type FernwickScope } from "./scopes.ts";
export { ESPI, ESPI_BASE } from "./espi.ts";

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const idempotencyKey = (value: unknown) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(value)
    ? value
    : undefined;
const generatedId = (prefix: string, key: string) =>
  `${prefix}_${createHash("sha256").update(key).digest("base64url").slice(0, 14)}`;
const cents = (amount: number) => Math.round(amount / 1000);
const kwhText = (wh: number) => (wh / 1000).toFixed(1);

export const meterView = (meter: Meter, now: number) => {
  const status = planStatus(meter, now);
  return {
    usage_point_id: meter.seed.id,
    label: meter.seed.label,
    plan: status.current,
    plan_name: plans[status.current].name,
    ...(status.scheduled
      ? {
          scheduled_change: {
            plan: status.scheduled.plan,
            plan_name: plans[status.scheduled.plan].name,
            effective_date: status.scheduled.effective_date,
          },
        }
      : {}),
    service_charge_cents: cents(meter.seed.serviceCharge),
    readings: meter.seed.readings.map((reading) => ({
      id: reading.id,
      flow: reading.flowDirection === 1 ? "delivered" : "sent_to_grid",
    })),
  };
};
export const billView = (meter: Meter, bill: Bill) => ({
  id: bill.id,
  usage_point_id: meter.seed.id,
  meter: meter.seed.label,
  period_start: new Date(bill.start * 1000).toISOString().slice(0, 10),
  period_end: new Date(bill.end * 1000).toISOString().slice(0, 10),
  plan: bill.plan,
  delivered_kwh: kwhText(bill.deliveredWh),
  ...(bill.receivedWh ? { sent_to_grid_kwh: kwhText(bill.receivedWh) } : {}),
  total_cents: cents(bill.total),
  lines: bill.lines.map((item) => ({
    note: item.note,
    amount_cents: cents(item.amount + item.rounding),
    ...(item.wh !== undefined ? { kwh: kwhText(item.wh) } : {}),
  })),
});
/** The plans as the own API and the website describe them. */
export const planCatalogue = () =>
  planIds.map((id) => ({
    id,
    name: plans[id].name,
    bands: plans[id].bands.map((band) => ({
      name: band.name,
      from_hour: band.from,
      to_hour: band.to,
      // Hundred-thousandths of USD per Wh are US cents per kWh.
      cents_per_kwh: band.perWh,
    })),
  }));

const response = (description: string) => ({ description });
const auth = (required: FernwickScope[]) => ({
  "x-poppy-scopes": required,
  security: [{ dpop: required }],
});
export const accountPaths: Record<string, unknown> = {
  "/api/account/account": {
    get: {
      operationId: "account",
      summary:
        "The fictional customer's service address and the meters shared with this grant, each with its rate plan (flat or time-of-use), any plan change scheduled for the next bill cycle, and the plans' prices by local hour (Pacific time). Read this before proposing a plan change.",
      ...auth(["account:read"]),
      responses: { "200": response("Account, meters and plans") },
    },
  },
  "/api/account/bills": {
    get: {
      operationId: "bills",
      summary:
        "Closed monthly bills of the shared meters, newest first: period (UTC, closing on the 1st), plan, kWh delivered and sent to the grid, line items and total in whole US cents. Computed from the hourly readings.",
      ...auth(["account:read"]),
      responses: { "200": response("Bills") },
    },
  },
  "/api/account/plan": {
    post: {
      operationId: "change_plan",
      summary:
        "Propose switching one shared meter between the flat and time-of-use plans. The exact terms name the meter, both plans, the effective date (the first day of the next bill cycle) and the estimated monthly difference from the last closed bill. Requires Operations v3 approval and a stable idempotency key; performed once, and nothing changes before the effective date.",
      ...auth(["account:read", "plan:write"]),
      "x-poppy-proposal": true,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["usage_point_id", "plan", "idempotency_key"],
              properties: {
                usage_point_id: { type: "string", maxLength: 40 },
                plan: { type: "string", enum: [...planIds] },
                idempotency_key: {
                  type: "string",
                  minLength: 8,
                  maxLength: 80,
                  pattern: "^[A-Za-z0-9_-]+$",
                  description:
                    "A caller-generated stable key for this intended change. Reusing it with a different request returns idempotency_conflict; replaying the same approved request returns the first result.",
                },
              },
              additionalProperties: false,
            },
          },
        },
      },
      responses: {
        "200": response("Scheduled once after exact Operations v3 approval"),
        "400": response("Invalid request body"),
        "403": response(
          "approval_required with exact terms, or insufficient_scope/extension_required",
        ),
        "404": response("meter_not_found: not a meter of this grant"),
        "409": response(
          "plan_unchanged, change_already_scheduled, or idempotency_conflict",
        ),
      },
    },
  },
};

const routeScopes = ({ path }: { path: string; method: string }): string[] => {
  if (path.startsWith(ESPI_BASE)) {
    const rest = path.slice(ESPI_BASE.length);
    // Read or ended with any token of its grant, which the route checks.
    if (/^\/Authorization(\/|$)/.test(rest)) return [];
    if (/^\/(Batch\/)?RetailCustomer(\/|$)/.test(rest))
      return ["espi:customer"];
    if (
      /^\/Subscription\/[^/]+\/UsagePoint\/[^/]+\/UsageSummary(\/|$)/.test(rest)
    )
      return ["espi:summary"];
    // espi:usage or espi:summary, which the route checks (`espi.ts`).
    if (
      /^\/Subscription\/[^/]+\/UsagePoint(\/[^/]+)?$/.test(rest) ||
      /^\/LocalTimeParameters(\/[^/]+)?$/.test(rest)
    )
      return [];
    return ["espi:usage"];
  }
  if (path === "/api/account/plan") return ["account:read", "plan:write"];
  return ["account:read"];
};

function mount(app: Hono, ctx: Parameters<CompanyDefinition["mount"]>[1]) {
  const customerFor = customerStore(ctx.state as State);
  /** The request's customer and the meters its grant reaches. */
  const reachOf = (c: Context) => {
    const customer = customerFor(ctx.sessionFor(c).account ?? "elena");
    return {
      customer,
      meters: withinGrant(customer, ctx.grantFor(c)?.resources),
    };
  };
  /**
   * As at Harborline: the gateway's operation for a key reserves it while
   * it can be approved, so a different request under it is refused.
   */
  const reservedForAnother = (
    account: string,
    action: string,
    request: Record<string, unknown>,
  ) =>
    Object.values(ctx.operations()).some(
      (record) =>
        record.account === account &&
        record.key === action &&
        record.revisions.some(
          (revision) =>
            Date.parse(revision.expires_at) > Date.now() &&
            Object.entries(request).some(
              ([name, value]) => revision.terms[name] !== value,
            ),
        ),
    );

  mountPortal(app, ctx, { customerFor });
  ctx.converse(fernwickAgent({ customerFor }));
  mountEspi(app, ctx, { customerFor });

  app.get("/api/account/account", (c) => {
    const { customer, meters } = reachOf(c);
    const now = nowSeconds();
    return c.json({
      customer: {
        id: customer.seed.id,
        name: customer.seed.name,
        account_number: customer.seed.accountNumber,
      },
      service_address: {
        line: addressLine(customer.seed.address),
        ...customer.seed.address,
      },
      meters: meters.map((meter) => meterView(meter, now)),
      plans: planCatalogue(),
      export_credit_cents_per_kwh: EXPORT_CREDIT_PER_WH,
      local_time: "Pacific time (UTC−8, UTC−7 with daylight saving)",
      currency: "USD",
      note: FICTION_NOTICE,
    });
  });
  app.get("/api/account/bills", (c) => {
    const { meters } = reachOf(c);
    const now = nowSeconds();
    return c.json({
      bills: meters
        .flatMap((meter) =>
          billsFor(meter.seed, meter.history, now).map((bill) =>
            billView(meter, bill),
          ),
        )
        .sort(
          (a, b) =>
            b.period_start.localeCompare(a.period_start) ||
            a.usage_point_id.localeCompare(b.usage_point_id),
        ),
      currency: "USD",
      note: FICTION_NOTICE,
    });
  });

  app.post("/api/account/plan", async (c) => {
    const { customer, meters } = reachOf(c);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      body = undefined;
    }
    if (
      !object(body) ||
      Object.keys(body).some(
        (key) => !["usage_point_id", "plan", "idempotency_key"].includes(key),
      )
    )
      return c.json({ error: "invalid_plan_change" }, 400);
    const to = planIds.find((id) => id === body.plan),
      key = idempotencyKey(body.idempotency_key);
    if (!to || !key || typeof body.usage_point_id !== "string")
      return c.json({ error: "invalid_plan_change" }, 400);
    // A meter outside the grant is answered as one that doesn't exist.
    const meter = meters.find((item) => item.seed.id === body.usage_point_id);
    if (!meter) return c.json({ error: "meter_not_found" }, 404);
    const now = nowSeconds();
    const account = customer.seed.id;
    const id = generatedId("chg_FPL", `${account}:${key}`);
    const request = { usage_point_id: meter.seed.id, to_plan: to as PlanId };
    const action = switchAction({
      customer,
      meter,
      to,
      key: `plan:${key}`,
      id,
      now,
      extraTerms: { idempotency_key: key },
    });
    // A key that has switched a plan is answered by its change, with no
    // new approval: the same request gets the first result again.
    const made = customer.customer.changes.find((change) => change.id === id);
    if (made)
      return made.usage_point_id === request.usage_point_id &&
        made.to_plan === request.to_plan
        ? c.json(action.result(made))
        : c.json({ error: "idempotency_conflict" }, 409);
    const refused = cannotSwitch(meter, to, now);
    if (refused) return c.json({ error: refused }, 409);
    if (reservedForAnother(account, `plan:${key}`, request))
      return c.json({ error: "idempotency_conflict" }, 409);
    return ctx.gate(c, action);
  });
}

export const fernwick: CompanyDefinition = {
  name: "Fernwick Power & Light",
  readScope: "account:read",
  writeScope: "plan:write",
  scopes: [...scopes],
  requiredScopes: routeScopes,
  // §7: Fernwick's own account API and the ESPI-shaped one.
  accountPrefixes: ["/api/account", ESPI_BASE],
  // §3.3: the ESPI-shaped routes only for requests that declare it.
  requiredExtension: ({ path }) =>
    path.startsWith("/espi/") ? ESPI : undefined,
  // The meters the User shares, of the chosen persona only, asked whenever
  // the sign-in requests a scope that reads or changes one. They limit the
  // whole grant: both APIs and the Company Agent (`withinGrant`). Sharing
  // no meter shares nothing, so it's turned down rather than granted empty.
  selectResources: ({ persona, body, scopes: granted }) => {
    if (!granted.some((scope) => meterScopes.includes(scope))) return undefined;
    const chosen = (energyPersona(persona)?.meters ?? [])
      .filter((meter) => body[`espi_meter_${meter.id}`] === "yes")
      .map((meter) => meter.id);
    return chosen.length
      ? chosen
      : {
          refuse:
            "Choose at least one meter to share, or go back and don't allow access.",
        };
  },
  // ESPI's token response fields: the subscription and its Authorization.
  tokenFields: (grant, origin) =>
    grant.scopes.some(isEspiScope)
      ? {
          resourceURI: `${origin}${ESPI_BASE}/Batch/Subscription/${grant.id}`,
          authorizationURI: `${origin}${ESPI_BASE}/Authorization/${grant.id}`,
        }
      : {},
  // offline_access is what keeps the grant refreshable: without it, the
  // grant ends with its first access token, after an hour; with it, it
  // lasts 7 days.
  grantLifetime: (granted) =>
    granted.includes("offline_access") ? GRANT_MS : TOKEN_MS,
  selectScopes: ({ requested, body }) =>
    requested.filter((scope) => {
      if (scope === "offline_access") return body.allow_offline === "yes";
      if (scope === "plan:write") return body.allow_plan_write === "yes";
      return true;
    }),
  consent: consentPage,
  consentExpired: consentExpiredPage,
  // The consent page loads the same faces: without this its policy blocks them.
  fontSources,
  persona: energyPersona,
  defaultAccount: "elena",
  paths: accountPaths,
  mount,
  agent: {
    name: "Fernwick's automated account guide",
    handoff: {
      text: "No real customer service agent can join this fictional demo. For protocol questions, inspect the endpoints or return to Poppy Lab.",
      data: { handoff: "unavailable", fictional_company: true },
    },
  },
  discovery: (origin, domain) => ({
    protocol_version: "1.0",
    organization: { name: "Fernwick Power & Light", domain },
    auth: {
      issuer: origin,
      scopes: scopeDescriptions,
      scope_hints: Object.fromEntries(
        scopes.map((scope) => [
          scope,
          {
            changes: scope === "plan:write" ? "reversible" : "none",
            personal_data: scope !== "offline_access",
          },
        ]),
      ),
    },
    // The ESPI-shaped API is Atom XML, described by the extension entry
    // below, not by an OpenAPI document.
    apis: [
      {
        type: "openapi",
        url: `${origin}/openapi.json`,
        description:
          "Fictional electricity account: service address, meters and rate plans, monthly bills, and an approval-gated switch between the flat and time-of-use plans",
      },
    ],
    agent: {
      protocols: [
        {
          type: "poppy",
          endpoint: `${origin}/poppy/conversations`,
          description:
            'Fernwick\'s deterministic account guide: supported requests, usage this month, the last bill, and an approval-gated rate plan change. Send {"request":"help"} in data.',
        },
      ],
    },
    web: { browser_session_endpoint: `${origin}/poppy/browser-session` },
    tasks: { endpoint: `${origin}/poppy/tasks` },
    extensions: {
      operations: [{ version: "3" }],
      [ESPI.name]: [
        {
          version: ESPI.version,
          espi_version: "4.0",
          resource_endpoint: `${origin}${ESPI_BASE}`,
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
    },
  }),
  // §9.4: how to switch a meter's rate plan, for Personal Agents.
  skills,
  excludedTasks: (origin) => [
    {
      task: "Start, stop or move electricity service",
      alternative: {
        instructions:
          "Fernwick only has the two fictional customers' existing meters. Service changes aren't offered through this protocol demo.",
        references: [{ type: "web", url: `${origin}/for-agents` }],
      },
    },
    { task: "Pay a bill or set up automatic payments" },
    {
      task: "Report an outage or a safety hazard",
      alternative: {
        instructions:
          "Fernwick is fictional and has no grid. For a real hazard, contact your own utility or the emergency services.",
      },
    },
    {
      task: "Download usage data as a file",
      alternative: {
        instructions: `The ESPI-shaped API serves the same hourly data as Atom XML to an agent that declares the ${ESPI.name} extension (${ESPI_SHAPED}).`,
        references: [{ type: "web", url: `${origin}/for-agents` }],
      },
    },
  ],
  landing: homePage,
  pages: {
    "/for-agents": forAgentsPage,
    "/how-it-works": (origin) => howItWorksPage(origin, agentGuide(origin)),
  },
  pageHeaders,
};

/**
 * What "How it works" shows, from what the endpoints serve: the discovery
 * document, the own API's operations, the excluded tasks, and Elena's EV
 * charger switching to the flat rate, priced as the switch's terms are.
 */
function agentGuide(origin: string): AgentGuide {
  const elena = energyPersona("elena")!;
  const seed = elena.meters.find((m) => m.id === "UP-E2")!;
  const history = [{ plan: seed.plan, from: 0 }];
  const meter: Meter = {
    seed,
    state: { plans: history, version: 1 },
    history,
  };
  const now = nowSeconds();
  const { basis, difference } = estimate(meter, "flat", now);
  return {
    discovery: fernwick.discovery(origin, new URL(origin).host),
    paths: accountPaths as unknown as AgentGuide["paths"],
    excluded: (fernwick.excludedTasks?.(origin) ?? []).map((task) =>
      String(task.task),
    ),
    espi: `${origin}${ESPI_BASE}`,
    example: {
      ask: "Switch my EV charger to the flat rate.",
      customer: elena.name,
      meter: seed.label,
      from: plans[seed.plan].name,
      to: plans.flat.name,
      effective: isoDay(nextMonthStart(now)),
      basis: {
        month: new Date(basis.start * 1000).toLocaleDateString("en-US", {
          month: "long",
          timeZone: "UTC",
        }),
        kwh: (basis.deliveredWh / 1000).toFixed(1),
        billed: basis.total,
        onNewPlan: basis.total + difference,
      },
    },
  };
}
