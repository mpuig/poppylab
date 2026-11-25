/**
 * Juniper Market's public pages: the shop front and the page for agent
 * builders. The shelf, delivery terms and hours are the same data the APIs
 * serve, so the website and an agent never disagree.
 */
import { labPlaygroundUrl } from "@poppy-lab/pap-core";
import { personas } from "./personas.js";
import { publicPage } from "./website.js";

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const list = (items: string[]) =>
  items.length > 1
    ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`
    : (items[0] ?? "");

export type Shop = {
  products: ReadonlyArray<{
    id: string;
    name: string;
    price: number;
    unit: string;
    category: string;
    stock: number;
  }>;
  delivery: {
    days: string[];
    fee_cents: number;
    free_above_cents: number;
    coverage: string;
  };
  policies: { hours: string; returns: string };
};

export function homePage(origin: string, shop: Shop) {
  const shelf = shop.products
    .map(
      (product) =>
        `<article class="product"><p class="muted">${escape(capital(product.category))}</p><h3>${escape(product.name)}</h3><p class="price">${usd(product.price)} <small class="muted">per ${escape(product.unit)}</small></p><p class="muted">${product.stock} in stock</p></article>`,
    )
    .join("");
  const { delivery, policies } = shop;
  const body = `<div class="hero"><h1>Good things, in season.</h1><p class="intro lead">Fresh produce and pantry staples from your neighbourhood market, delivered on the day you choose.</p><p class="actions"><a class="button" href="#shelf">See this week&#39;s shelf</a><a class="button secondary" href="/account">Your account</a></p></div><section id="shelf"><h2>This week&#39;s shelf</h2><div class="shelf">${shelf}</div><p class="notice">Fill your basket from <a href="/account">your account</a>, or ask your personal agent to do it.</p></section><section id="delivery"><h2>Delivery and hours</h2><div class="facts"><div><h3>Delivery days</h3><p>${escape(list(delivery.days))}</p></div><div><h3>Delivery fee</h3><p>${usd(delivery.fee_cents)}, free on orders of ${usd(delivery.free_above_cents)} or more</p></div><div><h3>Where we deliver</h3><p>${escape(delivery.coverage)}</p></div><div><h3>Shop hours</h3><p>${escape(policies.hours)}</p></div><div><h3>Something not right?</h3><p>${escape(policies.returns)} <a href="/help">Help and support</a></p></div></div></section><section id="agents"><h2>Shop with your personal agent</h2><p class="intro">Juniper works with personal AI agents. Yours can browse the shelf, check your orders and get a change ready, like moving your weekly delivery to Saturday. You sign in on Juniper&#39;s own page, and nothing changes until you approve it.</p><p class="actions"><a class="button" href="${escape(labPlaygroundUrl(origin))}">Try it with Iris, the demo agent</a><a href="/for-agents">Technical details for agent builders</a></p></section>`;
  return publicPage(origin, "Fresh groceries, delivered", body, "/");
}

export function forAgentsPage(origin: string) {
  const rows: Array<[string, string, string]> = [
    ["Discovery", `${origin}/.well-known/poppy.json`, "§3"],
    [
      "Protected resource",
      `${origin}/.well-known/oauth-protected-resource`,
      "§3.2",
    ],
    [
      "Authorization server",
      `${origin}/.well-known/oauth-authorization-server`,
      "§3.2",
    ],
    [
      "Direct Sign-In",
      `POST ${origin}/oauth/par · GET ${origin}/oauth/authorize · PKCE S256`,
      "§4.2",
    ],
    [
      "Tokens and refresh",
      `POST ${origin}/oauth/token · private_key_jwt, DPoP`,
      "§4.4–4.5",
    ],
    ["Revocation", `POST ${origin}/oauth/revoke`, "§4.6"],
    [
      "Session header",
      "Poppy-Session and Poppy-Version: 1.0 on every request",
      "§3.4, §5.2–5.3",
    ],
    ["API", `${origin}/openapi.json · OpenAPI 3.1`, "§7"],
    ["Tasks", `GET ${origin}/poppy/tasks · excluded tasks`, "§9"],
    [
      "Conversations",
      `${origin}/poppy/conversations · structured requests in data`,
      "§8",
    ],
    [
      "Approvals",
      '403 approval_required → resend with Poppy-Approval (approver="user")',
      "Operations v3",
    ],
  ];
  const table = rows
    .map(
      ([what, where, spec]) =>
        `<tr><th scope="row">${what}</th><td><code>${escape(where)}</code></td><td>${spec}</td></tr>`,
    )
    .join("");
  const people = personas
    .map(
      (person) =>
        `<tr><th scope="row">${escape(person.name)}</th><td><code>${person.id}</code></td><td>${escape(person.day)}</td><td>${escape(
          Object.entries(person.items)
            .map(([id, quantity]) => `${quantity} × ${id}`)
            .join(", "),
        )}</td></tr>`,
    )
    .join("");
  const body = `<h1>Point your agent at Juniper.</h1><p class="intro">Juniper Market speaks Personal Agent Protocol 1.0 with Operations version 3. Any Personal Agent with an HTTPS <code>client_id</code> that serves its metadata and keys (ES256 or PS384) can start a Session, sign in as a test customer and propose changes. Every visitor gets a private copy of the customers.</p><section><h2>Endpoints</h2><div class="table-wrap"><table><thead><tr><th scope="col">What</th><th scope="col">Where</th><th scope="col">Spec</th></tr></thead><tbody>${table}</tbody></table></div></section><section><h2>Scopes</h2><div class="table-wrap"><table><tbody><tr><th scope="row"><code>poppy:read</code></th><td>Basket, orders, recurring delivery, profile, simulated invoices and support cases. No changes.</td></tr><tr><th scope="row"><code>poppy:write</code></th><td>Propose basket, checkout, delivery, profile and support-case changes. The customer approves each one separately.</td></tr></tbody></table></div><p class="notice">Sign-in offers read first. The customer adds write as a separate step.</p></section><section><h2>Test customers</h2><div class="table-wrap"><table><thead><tr><th scope="col">Customer</th><th scope="col">Account</th><th scope="col">Recurring delivery</th><th scope="col">Items</th></tr></thead><tbody>${people}</tbody></table></div><p class="notice">Try: “Move my recurring delivery to Saturday.” The approval shows the day before and after. Or: “Something was missing from my last order,” which opens a support case through Juniper&#39;s own agent.</p></section><section><h2>Watch it work</h2><p class="intro">Open <a href="${escape(labPlaygroundUrl(origin))}">Iris</a>, the lab&#39;s Personal Agent, with Juniper connected. Its Inspector shows discovery, the Session and each API call with the spec section it meets.</p></section>`;
  return publicPage(origin, "For agents", body, "/for-agents");
}
