/**
 * Juniper Market: the first fictional PAP 1.0 example Company — a grocery
 * with a basket, recurring delivery, orders, simulated invoices, support
 * cases, a profile and a customer website. Runs on the portable gateway
 * (`@poppy-lab/pap-company`) in Node and in Cloudflare Workers.
 * Independent experiment, not affiliated with the protocol's authors.
 */
import { ObjectMap, type CompanyDefinition } from "@poppy-lab/pap-company";
import { accountPaths } from "./openapi.js";
import { servicePaths } from "./service-openapi.js";
import { operations, type Commerce } from "./operations.js";
import { website, type WebSession } from "./website.js";
import { consentExpiredPage, consentPage } from "./consent-page.js";
import { persona, personas } from "./personas.js";
import { forAgentsPage, homePage } from "./home.js";
import { howItWorksPage, type AgentGuide } from "./how-it-works.js";
import { router } from "./router.js";
import { juniperAgent, PHONE, PHONE_HOURS } from "./agent.js";

const products = [
  {
    id: "oranges",
    name: "Cara cara oranges",
    price: 450,
    unit: "bag",
    category: "fruit",
    stock: 24,
  },
  {
    id: "broccoli",
    name: "Purple sprouting broccoli",
    price: 325,
    unit: "bunch",
    category: "vegetables",
    stock: 18,
  },
  {
    id: "apples",
    name: "Pink lady apples",
    price: 390,
    unit: "bag",
    category: "fruit",
    stock: 32,
  },
  {
    id: "coffee",
    name: "Juniper house coffee",
    price: 1400,
    unit: "250g bag",
    category: "pantry",
    stock: 12,
  },
];
const paths = {
  ...accountPaths,
  ...servicePaths,
  "/api/products": {
    get: {
      operationId: "list_products",
      summary:
        "Browse products, prices in cents, current stock, and a photo URL (image) for each",
      responses: { "200": { description: "Product catalogue" } },
    },
  },
  "/api/delivery": {
    get: {
      operationId: "delivery_info",
      summary: "Get delivery days, charges, and coverage",
      responses: { "200": { description: "Delivery information" } },
    },
  },
  "/api/policies": {
    get: {
      operationId: "store_policies",
      summary: "Get opening hours and returns policy",
      responses: { "200": { description: "Store policies" } },
    },
  },
};

const delivery = {
  days: ["Tuesday", "Thursday", "Saturday"],
  fee_cents: 500,
  free_above_cents: 3500,
  currency: "USD",
  coverage: "Within 5 miles of Juniper Market",
  note: "Fictional demo; no real deliveries.",
};
const policies = {
  hours: "Monday–Saturday, 8am–7pm; Sunday, 9am–4pm",
  returns:
    "Fresh produce issues can be reported within 48 hours for a replacement or refund.",
};

export function juniperCompany(options: {
  portal: boolean;
}): CompanyDefinition {
  /** What "How it works" shows, read from this definition and the seed data. */
  const guide = (publicOrigin: string): AgentGuide => {
    const elena = personas[0]!;
    return {
      discovery: company.discovery(publicOrigin, new URL(publicOrigin).host),
      paths: paths as unknown as AgentGuide["paths"],
      excluded: (company.excludedTasks?.(publicOrigin) ?? []).map((task) =>
        String(task.task),
      ),
      phone: PHONE,
      example: {
        ask: "Move my recurring delivery to Saturday.",
        delivery: "delivery_001",
        customer: elena.name,
        fromDay: elena.day,
        toDay: "Saturday",
        items: Object.entries(elena.items).map(([id, quantity]) => {
          const product = products.find((p) => p.id === id)!;
          return {
            name: product.name,
            quantity,
            cents: product.price * quantity,
          };
        }),
      },
    };
  };
  const company: CompanyDefinition = {
    name: "Juniper Market",
    readScope: "poppy:read",
    writeScope: "poppy:write",
    consent: ({
      nonce,
      passwordRequired,
      scopes,
      client,
      clientHost,
      account,
    }) =>
      consentPage(nonce, passwordRequired, scopes, client, clientHost, account),
    consentExpired: consentExpiredPage,
    persona,
    defaultAccount: "elena",
    paths,
    agent: {
      name: "Juniper's automated agent",
      handoff: {
        text: `Nobody at Juniper can join this conversation right now. Call ${PHONE} (${PHONE_HOURS}).`,
        data: { handoff: "unavailable", phone: PHONE, hours: PHONE_HOURS },
      },
    },
    discovery: (publicOrigin, publicDomain) => {
      return {
        protocol_version: "1.0",
        organization: { name: "Juniper Market", domain: publicDomain },
        auth: {
          issuer: publicOrigin,
          // Juniper's own scope names; PAP 1.0 defines only poppy:browser-sign-in.
          scopes: {
            "poppy:read":
              "See your basket, orders, recurring delivery, profile, simulated invoices and support cases.",
            "poppy:write":
              "Propose basket, checkout, delivery, profile and support-case changes. You approve each one separately.",
          },
          scope_hints: {
            "poppy:read": { changes: "none", personal_data: true },
            // Checkout places a (fictional) order, which can't be undone.
            "poppy:write": { changes: "irreversible", personal_data: true },
          },
        },
        extensions: { operations: [{ version: "3" }] },
        agent: {
          protocols: [
            {
              type: "poppy",
              endpoint: `${publicOrigin}/poppy/conversations`,
              description:
                'Juniper\'s automated agent: store hours and policies, the status of your deliveries, and reporting a problem with an order, which opens a support case. It answers structured requests; send {"request":"help"} for the list.',
            },
          ],
        },
        apis: [
          {
            type: "openapi",
            url: `${publicOrigin}/openapi.json`,
            description:
              "Products, delivery information, opening hours, and returns policies",
          },
        ],
        web: {},
        tasks: { endpoint: `${publicOrigin}/poppy/tasks` },
      };
    },
    excludedTasks: (publicOrigin) => {
      return [
        {
          task: "Get a refund",
          alternative: {
            instructions:
              "Refunds are reviewed by a person. Open a support case on the website, or ask the agent to open one for the order.",
            references: [{ type: "web", url: `${publicOrigin}/help` }],
          },
        },
        {
          task: "Cancel a placed order",
          alternative: {
            instructions:
              "Placed orders can't be cancelled. The recurring delivery can be moved or changed instead.",
          },
        },
        { task: "Delete my account" },
      ];
    },
    // §9.3: Juniper's own matching, no model. Other reports get a plain 202.
    feedback: ({ task, description }, publicOrigin) => {
      const said = `${task} ${description}`.toLowerCase();
      if (/gift ?card|voucher|business account|bulk|invoice address/.test(said))
        return {
          instructions: `Gift cards, business accounts and bulk orders are handled by customer service at ${PHONE} (fictional number). The help page lists the frequent questions.`,
          references: [{ type: "web", url: `${publicOrigin}/help` }],
        };
      return undefined;
    },
    // The home page shows product photos from its own origin, nothing else.
    pageHeaders: {
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    },
    landing: (publicOrigin) =>
      homePage(publicOrigin, { products, delivery, policies }),
    pages: {
      "/for-agents": forAgentsPage,
      "/how-it-works": (publicOrigin) =>
        howItWorksPage(publicOrigin, guide(publicOrigin)),
    },
    mount(app, ctx) {
      const r = router(app);
      const business = ctx.state as {
        commerce?: Commerce;
        webSessions?: Record<string, WebSession>;
      };
      business.commerce ??= { customers: {}, records: {} };
      const commerce = operations(
        r,
        (req) => ctx.sessionFor(req.ctx),
        business.commerce,
        (req, action) => ctx.gate(req.ctx, action),
        ctx.activity,
      );
      website(
        r,
        ctx.origin,
        commerce.view,
        // Read from the state each time: the gateway moves a browser's
        // logins here when it starts to see this copy.
        new ObjectMap((business.webSessions ??= {})),
        commerce.services,
        ctx.grants,
        options.portal,
        ctx.feedback,
      );
      r.get("/api/products", async () => ({
        currency: "USD",
        products: products.map((p) => ({
          ...p,
          image: `${ctx.origin}/img/${p.id}.webp`,
        })),
      }));
      r.get("/api/delivery", async () => delivery);
      r.get("/api/policies", async () => ({
        ...policies,
        note: "Read-only demo: purchases and account changes are not available.",
      }));
      ctx.converse(juniperAgent(commerce, { ...policies, delivery }));
    },
  };
  return company;
}
