/**
 * Juniper Market: the first fictional PAP 0.3 example Company — a grocery
 * with a basket, recurring delivery, orders, simulated invoices, support
 * cases, a profile and a customer website. Runs on the portable gateway
 * (`@poppy-lab/pap-company`) in Node and in Cloudflare Workers.
 * Independent experiment, not affiliated with the protocol's authors.
 */
import type { CompanyDefinition } from "@poppy-lab/pap-company";
import { accountPaths } from "./openapi.js";
import { servicePaths } from "./service-openapi.js";
import { operations, type Commerce } from "./operations.js";
import { website, type WebSession } from "./website.js";
import { consentPage } from "./consent-page.js";
import { persona } from "./personas.js";
import { labLineHtml } from "@poppy-lab/pap-core";
import { router } from "./router.js";

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );
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
      summary: "Browse products, prices in cents, and current stock",
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

/** A Map persisted as a plain object inside the Company state. */
class ObjectMap<V> extends Map<string, V> {
  constructor(private target: Record<string, V>) {
    super(Object.entries(target));
  }
  override set(key: string, value: V) {
    if (this.target) this.target[key] = value;
    return super.set(key, value);
  }
  override delete(key: string) {
    delete this.target[key];
    return super.delete(key);
  }
}

export function juniperCompany(options: {
  portal: boolean;
}): CompanyDefinition {
  return {
    name: "Juniper Market",
    readScope: "poppy:read",
    writeScope: "poppy:write",
    consent: ({ nonce, passwordRequired, scopes, client }) =>
      consentPage(nonce, passwordRequired, scopes, client),
    persona,
    defaultAccount: "alex",
    paths,
    discovery: (publicOrigin, publicDomain) => {
      return {
        protocol_version: "0.3",
        organization: { name: "Juniper Market", domain: publicDomain },
        auth: {
          issuer: publicOrigin,
          // Juniper's own scope names; PAP 0.3 defines none.
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
        extensions: {
          operations: { version: "2" },
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
        excluded_tasks: { url: `${publicOrigin}/poppy/excluded-tasks.json` },
      };
    },
    excludedTasks: (publicOrigin) => {
      return {
        tasks: [
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
        ],
      };
    },
    landing: (publicOrigin) => {
      return `<!doctype html>
    <html lang="en">
    <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Juniper Market — PAP example Company</title>
    <style>
      :root{--paper:#f2f0e6;--ink:#17342b;--leaf:#4e715b;--fruit:#d46a43;--line:#bfc8b7}
      *{box-sizing:border-box} body{margin:0;background:var(--paper);color:var(--ink);font-family:ui-sans-serif,system-ui,sans-serif}
      header{display:flex;align-items:center;justify-content:space-between;padding:22px clamp(24px,5vw,72px);border-bottom:1px solid var(--line)}
      .brand{font-size:1.2rem;font-weight:800;letter-spacing:-.03em}.pap{font-size:.75rem;border:1px solid var(--ink);padding:7px 10px}
      main{padding:clamp(48px,8vw,110px) clamp(24px,7vw,100px)}
      h1{font-size:clamp(3.2rem,9vw,8rem);line-height:.88;letter-spacing:-.045em;max-width:9ch;margin:0 0 38px}
      .lead{font-size:clamp(1.1rem,2vw,1.55rem);line-height:1.45;max-width:52ch;margin:0 0 70px}
      .shelf{display:grid;grid-template-columns:repeat(3,1fr);border-top:1px solid var(--ink)}
      article{padding:28px 24px 42px;border-right:1px solid var(--line)} article:last-child{border:0}
      .number{font-variant-numeric:tabular-nums;color:var(--fruit);font-weight:800}.produce{font-size:2rem;margin:42px 0 8px}.meta{color:var(--leaf)}
      footer{display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px 20px;padding:24px clamp(24px,5vw,72px);border-top:1px solid var(--line);font-size:.8rem}footer .lab{flex-basis:100%;margin:0;color:var(--muted)}footer .lab a{color:inherit}
      code{font-family:ui-monospace,monospace}
      @media(max-width:700px){.shelf{grid-template-columns:1fr}.shelf article{border-right:0;border-bottom:1px solid var(--line)}footer{flex-direction:column}}
    </style>
    </head>
    <body>
    <header><div class="brand">Juniper Market</div><a class="pap" href="/account" style="color:inherit;text-underline-offset:4px">Sign in to your account</a></header>
    <main>
    <h1>Good things, in season.</h1>
    <p class="lead">A fictional neighborhood market used to test Personal Agent Protocol discovery. Connect in Poppy Lab to browse the catalogue, check delivery, and ask about store policies through signed PAP Sessions. Sign in as a fictional customer to read deliveries and approve delivery changes. No real purchases or shipments are made.</p>
    <section class="shelf" aria-label="Seasonal produce">
      <article><span class="number">A—01</span><h2 class="produce">Cara cara oranges</h2><div class="meta">Bright · sweet · California</div></article>
      <article><span class="number">A—02</span><h2 class="produce">Purple sprouting broccoli</h2><div class="meta">Tender · mineral · Local</div></article>
      <article><span class="number">A—03</span><h2 class="produce">Pink lady apples</h2><div class="meta">Crisp · tart · Washington</div></article>
    </section>
    </main>
    <footer><span>Fictional Company. Nothing is sold or shipped.</span><code>${escapeHtml(publicOrigin)}/.well-known/poppy.json</code>${labLineHtml(publicOrigin, "juniper")}</footer>
    </body></html>`;
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
      );
      website(
        r,
        ctx.origin,
        commerce.view,
        new ObjectMap((business.webSessions ??= {})),
        commerce.services,
        ctx.grants,
        options.portal,
      );
      r.get("/api/products", async () => ({ currency: "USD", products }));
      r.get("/api/delivery", async () => ({
        days: ["Tuesday", "Thursday", "Saturday"],
        fee_cents: 500,
        free_above_cents: 3500,
        coverage: "Within 5 miles of Juniper Market",
        note: "Fictional demo; no real deliveries.",
      }));
      r.get("/api/policies", async () => ({
        hours: "Monday–Saturday, 8am–7pm; Sunday, 9am–4pm",
        returns:
          "Fresh produce issues can be reported within 48 hours for a replacement or refund.",
        note: "Read-only demo: purchases and account changes are not available.",
      }));
    },
  };
}
