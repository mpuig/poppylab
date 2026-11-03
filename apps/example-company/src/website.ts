import type { Req, Router } from "./router.js";
import { siteScript } from "./site/app-script.js";
import { randomId, tokenHash } from "@poppy-lab/pap-client";
import { scryptSync, timingSafeEqual } from "node:crypto";
import type { Session } from "@poppy-lab/pap-company";
import { ProfileConflict } from "./profiles.js";
import { faqs } from "./customer-services.js";
import type { operations } from "./operations.js";
import { ShoppingConflict } from "./shopping-edits.js";
import { persona, personaSelect } from "./personas.js";
export type WebSession = { expires: number; account?: string };
const cookie = (req: Req, name: string) =>
  String(req.headers.cookie ?? "")
    .split(/;\s*/)
    .find((v) => v.startsWith(name + "="))
    ?.slice(name.length + 1) ?? "";
const css = `:root{color-scheme:light;--paper:#f5f3eb;--ink:#17342b;--muted:#496653;--line:#c6cebf;--accent:#9b472e}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.5 ui-sans-serif,system-ui,sans-serif}header{padding:20px clamp(20px,5vw,70px);display:flex;justify-content:space-between;gap:20px;border-bottom:1px solid var(--line)}a{color:inherit;text-underline-offset:4px}a:hover{color:var(--accent)}.brand{font-weight:800;text-decoration:none;font-size:20px;letter-spacing:-.03em}main{max-width:1080px;margin:auto;padding:48px 24px 64px}h1{font:400 clamp(36px,6vw,64px)/1.05 Georgia,serif;letter-spacing:-.03em;margin:0 0 18px}h2{font:400 30px/1.15 Georgia,serif;margin:0 0 20px}h3{font-size:17px;margin:0 0 12px}.intro{max-width:62ch;color:var(--muted)}nav{display:flex;gap:24px;flex-wrap:wrap;margin:28px 0 16px}section{padding:32px 0;border-top:1px solid var(--line)}.columns{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:64px}.line-item{display:flex;justify-content:space-between;gap:24px;padding:14px 0;border-bottom:1px solid var(--line)}.line-item strong{display:block;font-weight:600}.line-item small,.muted{color:var(--muted)}.price{white-space:nowrap;font-variant-numeric:tabular-nums}.totals{margin:20px 0;max-width:340px;margin-left:auto}.totals div{display:flex;justify-content:space-between;gap:16px;padding:4px 0}.totals .total{font-weight:700;border-top:1px solid var(--line);padding-top:12px;margin-top:8px}button{font:inherit;cursor:pointer;background:var(--ink);color:var(--paper);border:0;padding:11px 18px;border-radius:5px;min-height:44px}button:hover{background:#2b5140}button:disabled{opacity:.6;cursor:wait}button.secondary{background:transparent;color:var(--ink);border:1px solid var(--line)}input,textarea,select{display:block;width:100%;font:inherit;padding:12px;margin:8px 0 22px;border:1px solid var(--line);border-radius:5px;background:#fdfcf8;color:var(--ink)}.columns>*{min-width:0}textarea{resize:vertical}.support-message{white-space:pre-wrap;overflow-wrap:anywhere}.support-message strong,.support-message span{display:block}#reply-form{margin-top:32px}#profile-data dd{margin:0;overflow-wrap:anywhere}#invoice-list article{overflow-wrap:anywhere}:focus-visible{outline:2px solid var(--accent);outline-offset:4px}.login{max-width:560px}.notice{font-size:14px;color:var(--muted)}.live-row{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;margin:24px 0}.live-row p{margin:0}.live{color:#315e42}.error{color:#963a26}article.order,article.activity{padding:20px 0;border-bottom:1px solid var(--line);overflow-wrap:anywhere}summary{cursor:pointer;min-height:36px}summary:hover{text-decoration:underline}summary h2{display:inline}details p{max-width:65ch}footer{max-width:1080px;margin:auto;padding:24px;border-top:1px solid var(--line);color:var(--muted);font-size:13px}.empty{color:var(--muted);padding:16px 0}.day{font-size:20px;font-weight:600;margin-bottom:12px}::selection{background:#c8d8bf;color:var(--ink)}[hidden]{display:none!important}#basket-form,#delivery-form{margin-top:24px}.shopping-quantity{display:grid;grid-template-columns:minmax(0,1fr) 90px;gap:16px;align-items:center}.shopping-quantity small{display:block}.shopping-quantity input{margin:8px 0 16px}@media(max-width:700px){#profile-form{margin-top:24px}.columns{grid-template-columns:1fr;gap:0}main{padding-top:32px}header{align-items:center}.brand{font-size:18px}.line-item{gap:12px}}@media(prefers-reduced-motion:no-preference){.updated{animation:updated .65s ease-out}@keyframes updated{from{background:#dce8d2}to{background:transparent}}}`;
function page(title: string, body: string, script = false, account = "") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Juniper Market</title><style>${css}</style>${script ? '<script defer src="/site/app.js"></script>' : ""}</head><body data-account="${account}"><header><a class="brand" href="/">Juniper Market</a><a href="/account">Your account</a></header><main>${body}</main><footer>Fictional shop and account. Nothing is charged or shipped.</footer></body></html>`;
}
export function website(
  app: Router,
  origin: string,
  view: (s: Session) => unknown,
  sessions = new Map<string, WebSession>(),
  services?: Pick<
    ReturnType<typeof operations>["services"],
    "create" | "reply" | "updateProfile" | "updateBasket" | "updateDelivery"
  >,
  access?: {
    list: (account: string) => unknown[];
    revoke: (account: string, id: string) => boolean;
  },
  /** The demo portal (shared fictional personas): local by default. */
  portal = origin === "http://juniper.localhost:4100",
) {
  app.addHook("onSend", async (req, reply) => {
    if (req.url === "/account" || req.url.startsWith("/site/")) {
      reply.header("Cache-Control", "no-store");
      // The portal's own script and same-origin fetches.
      reply.header(
        "Content-Security-Policy",
        "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      );
      reply.header("Referrer-Policy", "same-origin");
    }
  });
  const pending = new Map<string, number>();
  let failures = 0,
    windowStart = Date.now();
  const active = (req: Req) => {
    const record = sessions.get(tokenHash(cookie(req, "juniper_web")));
    return (
      portal &&
      !!record &&
      record.expires > Date.now() &&
      !!persona(record.account ?? "alex") &&
      (req.method !== "POST" ||
        req.headers["x-juniper-account"] === (record.account ?? "alex"))
    );
  };
  const setCookie = (name: string, value: string, maxAge: number) =>
    `${name}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${origin.startsWith("https:") ? "; Secure" : ""}`;
  app.get("/site/login", async (_req, reply) => {
    if (!portal) return reply.code(403).send({ error: "local_demo_only" });
    for (const [id, expires] of pending)
      if (expires < Date.now()) pending.delete(id);
    if (pending.size >= 500)
      return reply
        .code(429)
        .send("Too many attempts. Try again in a few minutes.");
    const nonce = randomId();
    pending.set(tokenHash(nonce), Date.now() + 300000);
    reply
      .header("Cache-Control", "no-store")
      .header("Set-Cookie", setCookie("juniper_login", nonce, 300));
    return reply
      .type("text/html")
      .send(
        page(
          "Sign in",
          `<div class="login"><h1>Welcome to Juniper.</h1><p class="intro">Sign in to see your shopping, deliveries, billing and profile, or to open a support case. Your agent in Poppy Lab sees the same data.</p><form method="post" action="/site/login">${personaSelect}${process.env.JUNIPER_PASSWORD_HASH ? '<label for="password">Demo environment password</label><input id="password" type="password" name="password" autocomplete="current-password" required maxlength="256">' : '<p class="notice">Choose a fictional account. This does not verify real identities. The optional password protects the whole environment.</p>'}<button type="submit">Sign in to the selected account</button></form><p class="notice">Don't enter credentials from other services. You approve your agent's proposals in Poppy Lab. You can open support cases directly on this website.</p></div>`,
        ),
      );
  });
  app.post<{ Body: { password?: string; account?: string } }>(
    "/site/login",
    async (req, reply) => {
      const key = tokenHash(cookie(req, "juniper_login")),
        expires = pending.get(key);
      if (
        !portal ||
        req.headers.origin !== origin ||
        !expires ||
        expires < Date.now()
      )
        return reply
          .code(403)
          .send("This sign-in has expired. Open /site/login and try again.");
      if (Date.now() - windowStart > 60000) {
        failures = 0;
        windowStart = Date.now();
      }
      if (failures >= 10)
        return reply.code(429).send("Too many attempts. Wait a minute.");
      const configured = process.env.JUNIPER_PASSWORD_HASH;
      if (configured) {
        if (!/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(configured))
          throw new Error("Invalid password configuration");
        const [salt, expected] = configured.split(":");
        const actual = scryptSync(
          String(req.body?.password ?? "").slice(0, 256),
          salt!,
          64,
        );
        if (!timingSafeEqual(actual, Buffer.from(expected!, "hex"))) {
          failures++;
          return reply
            .code(401)
            .send("Wrong password. Go back to /site/login.");
        }
      }
      const selected = persona(req.body?.account ?? "alex");
      if (!selected) return reply.code(400).send({ error: "invalid_account" });
      pending.delete(key);
      sessions.delete(tokenHash(cookie(req, "juniper_web")));
      for (const [id, s] of sessions)
        if (s.expires < Date.now()) sessions.delete(id);
      if (sessions.size >= 1000)
        return reply.code(429).send("Too many sessions.");
      const token = randomId();
      sessions.set(tokenHash(token), {
        expires: Date.now() + 1800000,
        account: selected.id,
      });
      return reply
        .header("Cache-Control", "no-store")
        .header("Set-Cookie", [
          setCookie("juniper_web", token, 1800),
          setCookie("juniper_login", "", 0),
        ])
        .redirect("/account");
    },
  );
  app.post("/site/logout", async (req, reply) => {
    if (req.headers.origin !== origin)
      return reply.code(403).send({ error: "same_origin_required" });
    sessions.delete(tokenHash(cookie(req, "juniper_web")));
    return reply
      .header("Set-Cookie", setCookie("juniper_web", "", 0))
      .header("Cache-Control", "no-store")
      .send({ ok: true });
  });
  const browserSession = (req: Req): Session => ({
    client: "juniper-website",
    user:
      sessions.get(tokenHash(cookie(req, "juniper_web")))!.account ?? "alex",
    account:
      sessions.get(tokenHash(cookie(req, "juniper_web")))!.account ?? "alex",
    expires: Date.now() + 60000,
  });
  app.get("/help", async (_req, reply) =>
    reply
      .type("text/html")
      .send(
        page(
          "Help",
          `<h1>How can we help?</h1><p class="intro">Answers about this fictional shop. To check an order or open a support case, sign in to your account.</p>${faqs.map((f) => `<section><h2>${f.question}</h2><p>${f.answer}</p></section>`).join("")}<p><a href="/account">Sign in to my account</a></p>`,
        ),
      ),
  );
  app.post("/site/cases", async (req, reply) => {
    if (!active(req) || req.headers.origin !== origin)
      return reply
        .code(403)
        .send({ error: "customer_session_and_origin_required" });
    if (!services)
      return reply.code(503).send({ error: "service_unavailable" });
    try {
      return reply
        .code(201)
        .send({ case: services.create(browserSession(req), req.body) });
    } catch {
      return reply.code(400).send({
        error:
          "Check the subject, topic, message and order. Use fictional details only.",
      });
    }
  });
  app.post<{ Params: { id: string }; Body: { message?: unknown } }>(
    "/site/cases/:id/messages",
    async (req, reply) => {
      if (!active(req) || req.headers.origin !== origin)
        return reply
          .code(403)
          .send({ error: "customer_session_and_origin_required" });
      if (!services)
        return reply.code(503).send({ error: "service_unavailable" });
      try {
        if (!req.body || Object.keys(req.body).some((k) => k !== "message"))
          throw Error();
        return {
          case: services.reply(
            browserSession(req),
            req.params.id,
            req.body.message,
          ),
        };
      } catch {
        return reply.code(400).send({
          error:
            "The message couldn't be recorded. Check the case reference and the text length.",
        });
      }
    },
  );
  for (const target of ["basket", "delivery"] as const)
    app.post("/site/" + target, async (req, reply) => {
      if (!active(req) || req.headers.origin !== origin)
        return reply
          .code(403)
          .send({ error: "customer_session_and_origin_required" });
      if (!services)
        return reply.code(503).send({ error: "service_unavailable" });
      try {
        return target === "basket"
          ? services.updateBasket(browserSession(req), req.body)
          : services.updateDelivery(browserSession(req), req.body);
      } catch (e) {
        return reply.code(e instanceof ShoppingConflict ? 409 : 400).send({
          error:
            e instanceof ShoppingConflict
              ? "shopping_changed"
              : "invalid_shopping",
        });
      }
    });
  app.post("/site/profile", async (req, reply) => {
    if (!active(req) || req.headers.origin !== origin)
      return reply
        .code(403)
        .send({ error: "customer_session_and_origin_required" });
    if (!services)
      return reply.code(503).send({ error: "service_unavailable" });
    try {
      const b = req.body;
      if (!b || typeof b !== "object" || Array.isArray(b)) throw Error();
      const data = b as Record<string, unknown>;
      return services.updateProfile(browserSession(req), {
        ...data,
        version:
          typeof data.version === "string"
            ? Number(data.version)
            : data.version,
      });
    } catch (e) {
      return reply.code(e instanceof ProfileConflict ? 409 : 400).send({
        error:
          e instanceof ProfileConflict
            ? "profile_changed"
            : "invalid_fictional_profile",
      });
    }
  });
  app.get("/site/access", async (req, reply) => {
    if (!active(req))
      return reply.code(401).send({ error: "sign_in_required" });
    return { grants: access?.list(browserSession(req).account!) ?? [] };
  });
  app.post<{ Params: { id: string } }>(
    "/site/access/:id/revoke",
    async (req, reply) => {
      if (!active(req) || req.headers.origin !== origin)
        return reply
          .code(403)
          .send({ error: "customer_session_and_origin_required" });
      if (!access?.revoke(browserSession(req).account!, req.params.id))
        return reply.code(404).send({ error: "grant_not_found" });
      return { revoked: true };
    },
  );
  app.get("/site/state", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!active(req))
      return reply.code(401).send({ error: "sign_in_required" });
    return view(browserSession(req));
  });
  app.get("/account", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!active(req)) return reply.redirect("/site/login");
    return reply
      .type("text/html")
      .send(
        page(
          "Your account",
          `<h1>Your account, up to date.</h1><p class="intro">Shopping, deliveries and customer service, with the same data your agent reads. Pending proposals don't change your account.</p><p id="current-account" class="notice"></p><p><a href="/site/login">Switch fictional account</a></p><nav aria-label="Your account services"><a href="#basket">Shopping</a><a href="#delivery">Deliveries</a><a href="#orders">Orders</a><a href="#billing">Billing</a><a href="#support">Help and support</a><a href="#profile">Profile</a><a href="#agent-access">Connected agents</a><a href="#activity">Activity</a></nav><div class="live-row"><p id="status" class="live" role="status">Loading your account…</p><div><button id="refresh" class="secondary" type="button">Refresh now</button> <button id="logout" class="secondary" type="button">Log out</button></div></div><div id="content" aria-busy="true"><div class="columns"><section id="basket"><h2>Your basket</h2><div id="basket-items"></div><div id="basket-total"></div>${shoppingEditor("basket")}</section><section id="delivery"><h2>Recurring delivery</h2><p id="day" class="day"></p><div id="delivery-items"></div><div id="delivery-total"></div>${shoppingEditor("delivery")}</section></div><section id="orders"><h2>Your orders</h2><div id="order-list"></div></section><section id="billing"><h2>Billing</h2><p class="notice">Documents generated from your simulated orders. They are not tax receipts and prove no real payment.</p><div id="invoice-list"></div></section><section id="support"><h2>Help and support</h2><p class="intro">Read the frequent answers or send a request. Support in this demo replies automatically; no person is on duty.</p><p><a href="/help">See frequent questions</a></p><div class="columns"><div><h3>Your requests</h3><div id="case-list"></div></div><div><h3>Open a support case</h3><form id="case-form" method="post" action="/site/cases"><label for="case-topic">Topic</label><select id="case-topic" name="topic"><option value="delivery">Deliveries</option><option value="billing">Billing</option><option value="profile">Profile</option><option value="other">Something else</option></select><label for="case-subject">Subject</label><input id="case-subject" name="subject" required maxlength="120"><label for="case-order">Order reference (optional)</label><select id="case-order" name="order_id"><option value="">No related order</option></select><label for="case-message">What happened?</label><textarea id="case-message" name="message" required maxlength="2000" rows="5"></textarea><p class="notice">Sending creates a fictional request. It doesn't change orders, deliveries or amounts. Don't include real personal or bank details.</p><button type="submit">Send request</button></form><form id="reply-form" method="post" action="/site/cases" hidden><h3 id="reply-title">Reply to a support case</h3><input id="reply-id" type="hidden"><label for="reply-message">Add information</label><textarea id="reply-message" required maxlength="2000" rows="4"></textarea><p class="notice">Sending a follow-up reopens the case and invalidates any earlier proposal to close it.</p><button type="submit">Send follow-up</button></form><p id="support-status" role="status"></p></div></div></section><section id="profile"><h2>Your profile</h2><p class="notice">Fictional details for future purchases. Changing them doesn't alter existing orders or verify a real identity.</p><div class="columns"><div><dl id="profile-data"></dl><button id="edit-profile" type="button" class="secondary" disabled>Edit profile</button></div><form id="profile-form" method="post" action="/site/profile" hidden><input id="profile-version" name="version" type="hidden"><label for="profile-name">Fictional name</label><input id="profile-name" name="name" required maxlength="80" autocomplete="off"><label for="profile-email">Correo de prueba</label><input id="profile-email" name="email" type="email" required maxlength="120" pattern=".+[.]invalid" aria-describedby="profile-hint" autocomplete="off"><label for="profile-address">Fictional address for future purchases</label><input id="profile-address" name="address" required maxlength="240" autocomplete="off"><p id="profile-hint" class="notice">Use fictional details only and an email ending in .invalid. No email is sent. Saving invalidates earlier profile and checkout proposals.</p><button type="submit">Save profile</button> <button id="cancel-profile" type="button" class="secondary">Cancel</button></form></div><p id="profile-status" role="status"></p></section><section id="agent-access"><h2>Your agent's access</h2><p class="notice">Revoking ends that grant's PAP access. It doesn't log you out of the website or delete orders. Logging out of the website doesn't revoke the agent.</p><button id="load-access" type="button" class="secondary">Show grants</button><div id="access-list"></div><p id="access-status" role="status"></p></section><section id="activity"><details><summary><h2>Your agent's activity</h2></summary><p class="notice">A pending proposal doesn't change your data. Approve or decline it in Poppy Lab.</p><div id="activity-list"></div></details></section></div>`,
          true,
          browserSession(req).account,
        ),
      );
  });
  app.get("/site/app.js", async (_req, reply) =>
    reply.type("text/javascript").send(clientScript),
  );
}
function shoppingEditor(target: "basket" | "delivery") {
  return `<button id="edit-${target}" type="button" class="secondary" disabled>${target === "basket" ? "Edit basket" : "Edit recurring delivery"}</button><form id="${target}-form" method="post" action="/site/${target}" aria-label="${target === "basket" ? "Edit basket" : "Edit recurring delivery"}" hidden>${target === "delivery" ? '<label for="delivery-day">Recurring delivery day</label><select id="delivery-day"><option value="Tuesday">Tuesday</option><option value="Thursday">Thursday</option><option value="Saturday">Saturday</option></select>' : ""}<div id="${target}-quantities"></div><p class="notice">${target === "basket" ? "Saving changes only the basket; it doesn't create an order. Checkout is reviewed and approved in Poppy." : "Saving changes only the recurring delivery, not the basket or existing orders. With no products there is no simulated shipment."} Zero removes the product. The total above is for the saved data, not this draft; it updates when you save. Fictional data only; nothing is charged or shipped.</p><button type="submit">${target === "basket" ? "Save basket" : "Save delivery"}</button> <button id="cancel-${target}" type="button" class="secondary">Cancel</button></form><p id="${target}-status" role="status"></p>`;
}
const clientScript = `"use strict";\n${siteScript}`;
