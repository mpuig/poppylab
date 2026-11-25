/** Northwind Air website: a synoptic route chart, shared by landing, account and consent. */
import { labLineHtml } from "@poppy-lab/pap-core";
import {
  airports,
  customers,
  fareBrands,
  FICTION_NOTICE,
  flightSchedule,
  PHONE,
  travelInformation,
} from "./data.ts";

export const escape = (text: string) =>
  text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
export const fontSources = {
  style: "https://fonts.googleapis.com",
  font: "https://fonts.gstatic.com",
};
export const pageHeaders = {
  "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline' ${fontSources.style}; font-src ${fontSources.font}; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
  "Referrer-Policy": "no-referrer",
};
const fonts = `<link rel="preconnect" href="${fontSources.style}"><link rel="preconnect" href="${fontSources.font}" crossorigin><link href="${fontSources.style}/css2?family=Azeret+Mono:wght@400;600&family=Barlow+Condensed:wght@600;700;800&family=Figtree:wght@400;500;650;750&display=swap" rel="stylesheet">`;

const css = `
:root{color-scheme:light;--sky:#dbeaf0;--paper:#f7f4ea;--ink:#102a38;--soft:#385362;--muted:#627783;--line:#91aab4;--wind:#1d6882;--sun:#efb73e;--alert:#a9382d;--ok:#22694f;--display:"Barlow Condensed","Arial Narrow",sans-serif;--body:Figtree,"Helvetica Neue",sans-serif;--mono:"Azeret Mono",ui-monospace,monospace}
*{box-sizing:border-box}html{background:var(--paper);scroll-behavior:smooth}body{margin:0;color:var(--ink);font:500 17px/1.55 var(--body);-webkit-font-smoothing:antialiased}a{color:inherit;text-underline-offset:.22em}a:hover{text-decoration-thickness:2px}:focus-visible{outline:3px solid var(--sun);outline-offset:3px}::selection{background:var(--sun);color:var(--ink)}button,input,select{font:inherit}code,.mono{font-family:var(--mono);font-size:.9em;font-variant-numeric:tabular-nums}.wrap{width:min(1180px,calc(100% - 2*clamp(18px,4vw,48px)));margin-inline:auto}.notice{color:var(--muted);font-size:14px}.error{color:var(--alert)}.live{color:var(--ok)}
header{background:var(--ink);color:var(--paper);border-bottom:4px solid var(--sun)}header .wrap{min-height:68px;display:grid;grid-template-columns:1fr auto auto;align-items:center;gap:clamp(18px,3vw,36px)}.brand{font:800 31px/.9 var(--display);letter-spacing:.025em;text-transform:uppercase;text-decoration:none}.brand span{display:block;font:600 10px/1.2 var(--mono);letter-spacing:.14em;color:#b9d2db;margin-top:5px}.nav{display:flex;gap:22px}.nav a{font:650 14px var(--body);text-decoration:none}.nav a[aria-current]{color:var(--sun)}.fiction-tag{font:600 11px/1.3 var(--mono);max-width:24ch;text-align:right;color:#c7d7dd}
.chart-hero{position:relative;overflow:hidden;background:var(--sky);min-height:660px;border-bottom:1px solid var(--line)}.isobars{position:absolute;inset:0;width:100%;height:100%;opacity:.48;pointer-events:none}.hero-grid{position:relative;display:grid;grid-template-columns:minmax(0,1.05fr) minmax(360px,.95fr);gap:clamp(34px,6vw,84px);align-items:center;padding-block:clamp(54px,8vw,100px)}h1,h2,h3{font-family:var(--display);text-transform:uppercase;letter-spacing:.005em}.hero-copy h1{font-size:clamp(58px,8.3vw,118px);line-height:.84;margin:0 0 24px;max-width:8ch}.hero-copy p{max-width:58ch;margin:0;color:var(--soft)}.hero-copy .fiction{margin-top:12px;font:600 12px/1.5 var(--mono);color:var(--wind)}
.search-panel{background:var(--paper);border:1px solid var(--ink);padding:clamp(22px,3vw,34px);box-shadow:12px 14px 28px rgba(16,42,56,.14)}.search-panel h2{font-size:32px;line-height:1;margin:0 0 8px}.search-panel>p{margin:0 0 22px;color:var(--soft);font-size:15px}.search-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.search-grid .full{grid-column:1/-1}label{display:block;font:700 12px/1.2 var(--mono);letter-spacing:.05em;text-transform:uppercase;margin:0 0 7px}input,select{width:100%;min-height:50px;border:1px solid var(--line);background:#fffdf6;color:var(--ink);padding:11px 12px;border-radius:0}input:focus,select:focus{border-color:var(--wind)}button,.button{display:inline-flex;align-items:center;justify-content:center;min-height:50px;border:1px solid var(--ink);background:var(--ink);color:var(--paper);padding:11px 20px;font:750 16px var(--display);letter-spacing:.045em;text-transform:uppercase;text-decoration:none;cursor:pointer}.button:hover,button:hover{background:var(--wind)}button:disabled{opacity:.55;cursor:wait}.secondary{background:transparent;color:var(--ink);border-color:var(--line)}.secondary:hover{background:#fffdf6}.search-panel button{width:100%;background:var(--sun);color:var(--ink)}.search-panel button:hover{background:#dca326}.route-note{display:flex;justify-content:space-between;gap:14px;margin-top:16px;padding-top:14px;border-top:1px solid var(--line);font:500 11px/1.45 var(--mono);color:var(--muted)}
.band{background:var(--ink);color:var(--paper);padding:22px 0}.band .wrap{display:grid;grid-template-columns:repeat(3,1fr);gap:0}.band article{padding:0 clamp(18px,3vw,34px);border-right:1px solid #46606d}.band article:first-child{padding-left:0}.band article:last-child{border-right:0}.band h3{font-size:22px;line-height:1;margin:0 0 7px;color:var(--sun)}.band p{font-size:14px;margin:0;color:#cfdee3}
.section{padding-block:clamp(58px,8vw,96px)}.section h2{font-size:clamp(40px,5vw,68px);line-height:.95;margin:0 0 22px;max-width:12ch}.section-lead{max-width:68ch;color:var(--soft);margin:0 0 36px}.departure-board{border-top:2px solid var(--ink)}.flight-row{display:grid;grid-template-columns:110px minmax(0,1.3fr) minmax(0,1fr) 140px;gap:18px;align-items:center;padding:18px 0;border-bottom:1px solid var(--line)}.flight-row strong{font:750 24px/1 var(--display)}.flight-row .route{font-size:18px}.flight-row .time,.flight-row .fare{font-family:var(--mono);font-size:13px}.flight-row .fare{text-align:right}.status{display:inline-block;padding:4px 8px;background:var(--sun);font:600 11px var(--mono);text-transform:uppercase}.info-grid{display:grid;grid-template-columns:1.2fr .8fr 1fr;gap:clamp(26px,4vw,52px)}.info-grid article{border-top:2px solid var(--ink);padding-top:18px}.info-grid h3{font-size:28px;line-height:1;margin:0 0 10px}.info-grid p{margin:0;color:var(--soft)}
.agent-strip{background:var(--sun);padding:clamp(34px,5vw,58px) 0}.agent-strip .wrap{display:grid;grid-template-columns:1fr auto;align-items:center;gap:30px}.agent-strip h2{font-size:clamp(38px,5vw,64px);line-height:.9;margin:0 0 12px}.agent-strip p{margin:0;max-width:64ch}.agent-strip .button{white-space:nowrap}
.table-wrap{overflow-x:auto;border:1px solid var(--line);background:#fffdf6}table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:12px 14px;border-bottom:1px solid #c9d5d9;vertical-align:top}thead th{font:600 11px var(--mono);letter-spacing:.05em;text-transform:uppercase;color:var(--muted)}tbody th{white-space:nowrap}.personas{display:grid;grid-template-columns:repeat(2,1fr);gap:18px;list-style:none;padding:0;margin:0}.personas li{border-top:2px solid var(--ink);padding:18px 0}.personas strong{display:block;font:750 28px/1 var(--display);text-transform:uppercase}.personas span{color:var(--soft);font-size:14px}
footer{background:#091c26;color:#c8d9df;padding:34px 0}.footer-grid{display:grid;grid-template-columns:1.5fr 1fr;gap:30px}.footer-grid p{margin:0 0 10px;max-width:78ch;font-size:14px}.footer-grid .lab{border-top:1px solid #38515d;padding-top:12px;margin-top:16px}
.consent main{width:min(760px,calc(100% - 36px));margin:auto;padding:clamp(38px,7vw,76px) 0}.consent h1{font-size:clamp(48px,7vw,80px);line-height:.88;margin:0 0 20px}.consent .requester{font:600 12px var(--mono);color:var(--wind)}.consent form{margin-top:28px;border-top:2px solid var(--ink);padding-top:24px}.scope-list{list-style:none;margin:18px 0;padding:0;border-top:1px solid var(--line)}.scope-list li{padding:14px 0;border-bottom:1px solid var(--line)}.scope-list code{display:block;color:var(--wind);margin-bottom:4px}.check{display:flex;align-items:flex-start;gap:12px;margin:22px 0}.check input{width:22px;min-height:22px;accent-color:var(--wind);margin:2px 0 0}.consent .actions{display:flex;justify-content:flex-end;gap:12px;margin-top:28px}.consent small{display:block;margin-top:24px;color:var(--muted)}
.account-shell{padding-block:clamp(38px,6vw,70px)}.account-head{display:grid;grid-template-columns:1fr auto;gap:24px;align-items:end;border-bottom:2px solid var(--ink);padding-bottom:22px;margin-bottom:34px}.account-head h1{font-size:clamp(50px,7vw,84px);line-height:.88;margin:0 0 12px}.account-head p{margin:0;max-width:65ch;color:var(--soft)}.live-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.live-row p{width:100%;margin:0 0 4px;text-align:right}.account-grid{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(300px,.75fr);gap:clamp(28px,5vw,58px)}.account-grid section{margin-bottom:38px}.account-grid h2{font-size:34px;line-height:1;margin:0 0 14px;border-bottom:1px solid var(--line);padding-bottom:10px}.trip{border:1px solid var(--line);background:#fffdf6;margin-bottom:18px}.trip-head{display:flex;justify-content:space-between;gap:16px;align-items:baseline;padding:16px 18px;background:var(--sky);border-bottom:1px solid var(--line)}.trip-head h3{font-size:28px;line-height:1;margin:0}.trip-body{padding:18px}.segment{display:grid;grid-template-columns:90px 1fr auto;gap:14px;padding:13px 0;border-bottom:1px solid #d5dedf}.segment strong{font:750 22px var(--display)}.segment p{margin:0;color:var(--soft);font-size:14px}.segment .mono{text-align:right}.facts{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:18px}.fact{border-top:1px solid var(--line);padding-top:10px}.fact span{display:block;color:var(--muted);font-size:12px}.fact strong{font-size:16px}.activity{padding:13px 0;border-bottom:1px solid var(--line)}.activity h3{font-size:20px;line-height:1;margin:0 0 5px}.activity p{margin:0;color:var(--soft);font-size:14px}.account-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}
@media(max-width:900px){header .wrap{grid-template-columns:1fr auto}.fiction-tag{display:none}.hero-grid{grid-template-columns:1fr;padding-block:56px}.chart-hero{min-height:0}.hero-copy h1{max-width:9ch}.band .wrap{grid-template-columns:1fr}.band article{padding:16px 0;border-right:0;border-bottom:1px solid #46606d}.band article:last-child{border-bottom:0}.info-grid{grid-template-columns:1fr}.agent-strip .wrap{grid-template-columns:1fr}.agent-strip .button{justify-self:start}.account-grid{grid-template-columns:1fr}.live-row p{text-align:left}.account-head{grid-template-columns:1fr}.flight-row{grid-template-columns:90px 1fr 110px}.flight-row .time{display:none}}
@media(max-width:620px){header .wrap{min-height:62px}.brand{font-size:24px}.brand span{display:none}.nav{gap:11px}.nav a{font-size:11px}.hero-copy h1{font-size:58px}.search-grid{grid-template-columns:1fr}.search-grid .full{grid-column:auto}.route-note{display:block}.route-note span{display:block;margin-top:6px}.flight-row{grid-template-columns:72px 1fr}.flight-row .fare{grid-column:2;text-align:left}.personas{grid-template-columns:1fr}.footer-grid{grid-template-columns:1fr}.consent .actions{display:grid}.facts{grid-template-columns:1fr 1fr}.segment{grid-template-columns:72px 1fr}.segment .mono{grid-column:2;text-align:left}}
`;

const playgroundFor = (origin: string) =>
  /localhost/.test(origin)
    ? `http://localhost:3000/playground?company=${encodeURIComponent(origin)}`
    : `https://poppylab.dev/playground?company=${encodeURIComponent(origin)}`;

export function shell(
  title: string,
  body: string,
  current: "/" | "/for-agents" | "/account",
  origin: string,
) {
  const nav = (
    [
      ["/", "Flights"],
      ["/for-agents", "For agents"],
      ["/account", "My Northwind"],
    ] as const
  )
    .map(
      ([href, label]) =>
        `<a href="${href}"${current === href ? ' aria-current="page"' : ""}>${label}</a>`,
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title>${fonts}<style>${css}</style></head><body><header><div class="wrap"><a class="brand" href="/">Northwind Air<span>Fictional airline · PAP 1.0</span></a><nav class="nav" aria-label="Site">${nav}</nav><span class="fiction-tag">No real ticket is sold, changed, cancelled or charged.</span></div></header>${body}<footer><div class="wrap footer-grid"><div><p>Northwind Air is a fictional airline for testing personal agents. No real flight, ticket, passenger record, loyalty balance, payment, cancellation or border advice exists.</p><p>Independent experiment, not affiliated with or endorsed by the authors of the Personal Agent Protocol. “Personal Agent Protocol” and “Poppy” are their names.</p>${labLineHtml(origin, "northwind")}</div><p>Fictional assistance desk: <span class="mono">${PHONE}</span>. Never enter a real booking reference, passport, payment card, medical record or account credential.</p></div></footer></body></html>`;
}

const chart = `<svg class="isobars" viewBox="0 0 1400 720" preserveAspectRatio="none" aria-hidden="true"><g fill="none" stroke="#568296" stroke-width="1.2"><path d="M-80 210 C180 70 390 80 560 230 S930 460 1510 160"/><path d="M-100 280 C190 120 420 130 610 285 S1000 520 1510 235"/><path d="M-120 350 C210 180 450 200 650 350 S1060 580 1530 305"/><path d="M40 680 C160 490 360 430 540 510 S930 690 1110 520 S1340 360 1510 400"/><ellipse cx="1110" cy="170" rx="230" ry="105"/><ellipse cx="1110" cy="170" rx="170" ry="72"/><ellipse cx="260" cy="570" rx="260" ry="120"/></g><g fill="#1d6882"><circle cx="238" cy="425" r="6"/><circle cx="618" cy="326" r="6"/><circle cx="995" cy="252" r="6"/></g><path d="M238 425 C420 380 470 350 618 326 S850 286 995 252" fill="none" stroke="#1d6882" stroke-width="3" stroke-dasharray="8 8"/></svg>`;

export function homePage(origin: string) {
  const airportOptions = airports
    .map(
      (airport) =>
        `<option value="${airport.code}">${airport.code} — ${escape(airport.city)}</option>`,
    )
    .join("");
  const board = flightSchedule
    .slice(0, 5)
    .map(
      (flight) =>
        `<div class="flight-row"><strong>${escape(flight.number)}</strong><span class="route">${flight.origin} → ${flight.destination}</span><span class="time">${escape(flight.departure.replace("T", " ").slice(0, 16))}</span><span class="fare">from ${money(flight.economy_cents)} <span class="status">${escape(flight.status.replace("_", " "))}</span></span></div>`,
    )
    .join("");
  const information = Object.values(travelInformation)
    .map(
      (item) =>
        `<article><h3>${escape(item.title)}</h3><p>${escape(item.text)}</p></article>`,
    )
    .join("");
  const body = `<main><section class="chart-hero">${chart}<div class="wrap hero-grid"><div class="hero-copy"><h1>Follow the route. Keep control of the ticket.</h1><p>Search Northwind Air's fictional network, ask your personal agent about a trip, and review exact seats, bags, upgrades, cancellations or flight changes before anything is applied.</p><p class="fiction">${escape(FICTION_NOTICE)}</p></div><form class="search-panel" method="get" action="/api/flights/search"><h2>Search the fictional timetable</h2><p>Try Port Aurora to Sunmere on 3 June 2027, or Port Aurora to Northhaven on 18 May 2027.</p><div class="search-grid"><div><label for="origin">From</label><select id="origin" name="origin">${airportOptions}</select></div><div><label for="destination">To</label><select id="destination" name="destination"><option value="SMR">SMR — Sunmere</option>${airportOptions}</select></div><div class="full"><label for="date">Departure date</label><input id="date" name="date" type="date" value="2027-06-03" required></div><div class="full"><button type="submit">Search flights</button></div></div><div class="route-note">Search returns JSON for agents and implementers.<span>No purchase or reservation is created.</span></div></form></div></section><section class="band"><div class="wrap"><article><h3>Search without signing in</h3><p>Flights, cheapest dates, status, baggage, check-in, fares and reference-plus-surname lookup.</p></article><article><h3>Read your test account</h3><p>Upcoming trips, booking details, loyalty points, tier, expiring points and passenger preferences.</p></article><article><h3>Approve exact changes</h3><p>Seats, bags, preferences, cancellation, upgrades and flight changes use Operations v3 and execute once.</p></article></div></section><section class="section wrap"><h2>Fictional departures</h2><p class="section-lead">The same schedule and prices power this board, the OpenAPI tools and the account portal. Data is deterministic for protocol demos.</p><div class="departure-board">${board}</div></section><section class="section wrap"><h2>Before the airport</h2><div class="info-grid">${information}</div></section><section class="agent-strip"><div class="wrap"><div><h2>Give Iris the route, not your credentials.</h2><p>Connect Northwind Air in Poppy Lab. Sign in on Northwind's own consent page as Elena or Darius, request change permission separately, then approve each exact operation in the chat.</p></div><a class="button" href="${playgroundFor(origin)}">Connect in Poppy Lab</a></div></section></main>`;
  return shell("Northwind Air · fictional airline", body, "/", origin);
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
      `POST ${origin}/oauth/par · GET ${origin}/oauth/authorize`,
      "§4.2",
    ],
    [
      "Tokens",
      `POST ${origin}/oauth/token · private_key_jwt · DPoP`,
      "§4.4–4.5",
    ],
    [
      "Sessions",
      "Poppy-Session · Poppy-Version: 1.0 · Operations v3 declaration",
      "§3.4, §5",
    ],
    ["OpenAPI", `${origin}/openapi.json`, "§7"],
    ["Tasks", `${origin}/poppy/tasks`, "§9"],
    ["Conversations", `${origin}/poppy/conversations`, "§8"],
    [
      "Approvals",
      "403 approval_required → resend exact request with Poppy-Approval",
      "Operations v3",
    ],
  ];
  const people = customers
    .map(
      (customer) =>
        `<li><strong>${escape(customer.name)}</strong><span>Account <code>${customer.id}</code> · booking <code>${customer.booking.reference}</code> · surname <code>${customer.booking.surname}</code> · ${escape(fareBrands[customer.booking.fare].name)}</span></li>`,
    )
    .join("");
  const body = `<main class="section wrap"><h1 style="font:800 clamp(58px,9vw,112px)/.85 var(--display);margin:0 0 24px;max-width:9ch">A complete airline-shaped PAP 1.0 Company.</h1><p class="section-lead">Northwind Air is deterministic, fictional and deployable on Node or Cloudflare Workers. It uses the shared Company gateway without compatibility routes for earlier PAP versions.</p><h2>Endpoints</h2><div class="table-wrap"><table><thead><tr><th>What</th><th>Where</th><th>Protocol</th></tr></thead><tbody>${rows.map(([what, where, spec]) => `<tr><th scope="row">${what}</th><td><code>${escape(where)}</code></td><td>${spec}</td></tr>`).join("")}</tbody></table></div><section class="section"><h2>Test passengers</h2><ul class="personas">${people}</ul><p class="section-lead">Try: “Move Darius from NA 274 to NA 278.” The proposal states the old and new departure, fare difference, change fee, amount due or refund, seat reset and fictional payment terms. Change the inventory price before approval and the old revision no longer executes.</p></section><section class="section"><h2>Scope shape</h2><div class="table-wrap"><table><tbody><tr><th><code>flights:search</code></th><td>Public search shape; no personal data and no changes.</td></tr><tr><th><code>bookings:read</code></th><td>Trips and booking details.</td></tr><tr><th><code>profile:read</code></th><td>Loyalty and preferences.</td></tr><tr><th><code>preferences:write</code></th><td>Reversible seats, meals and supported non-medical assistance.</td></tr><tr><th><code>bookings:change</code></th><td>Paid, irreversible or financially consequential booking changes.</td></tr></tbody></table></div></section><a class="button" href="${playgroundFor(origin)}">Connect Northwind in Iris</a></main>`;
  return shell("For agents · Northwind Air", body, "/for-agents", origin);
}

export function consentPage(input: {
  nonce: string;
  passwordRequired: boolean;
  scopes: string;
  client: string;
  clientHost: string;
}) {
  const requested = input.scopes.split(" ").filter(Boolean);
  const descriptions: Record<string, string> = {
    "flights:search":
      "Search fictional flights. Search also works without account access.",
    "bookings:read":
      "See upcoming trips, booking details, seats, bags and fare terms.",
    "profile:read":
      "See loyalty tier, points, expiring points and passenger preferences.",
    "preferences:write":
      "Propose reversible seat, meal and supported non-medical assistance changes.",
    "bookings:change":
      "Propose paid baggage, cancellation, upgrades and flight changes.",
  };
  const write = requested.some((scope) =>
    ["preferences:write", "bookings:change"].includes(scope),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Allow ${escape(input.client)} · Northwind Air</title>${fonts}<style>${css}</style></head><body class="consent"><header><div class="wrap"><span class="brand">Northwind Air<span>Fictional consent</span></span><span class="requester">${escape(input.client)} from ${escape(input.clientHost)}</span></div></header><main><h1>Choose what travels with your agent.</h1><p>Northwind Air is a fictional test Company. Select a test passenger and review only the permissions requested by <strong>${escape(input.client)}</strong>.</p><form method="post" action="/oauth/authorize"><input type="hidden" name="nonce" value="${escape(input.nonce)}"><label for="account">Fictional passenger</label><select id="account" name="account">${customers.map((customer) => `<option value="${customer.id}">${escape(customer.name)} · ${customer.booking.reference}</option>`).join("")}</select>${input.passwordRequired ? '<label for="password">Demo password</label><input id="password" type="password" name="password" required maxlength="256">' : ""}<ul class="scope-list">${requested.map((scope) => `<li><code>${escape(scope)}</code>${escape(descriptions[scope] ?? "Permission requested by the agent.")}</li>`).join("")}</ul>${write ? '<label class="check" for="write"><input id="write" type="checkbox" name="write" value="yes" checked><span><strong>Allow change proposals</strong><br>Every seat, preference, bag, cancellation, upgrade or flight change still needs a separate approval with exact terms in your agent.</span></label>' : "<p><strong>Read only.</strong> This consent cannot propose account changes.</p>"}<div class="actions"><button class="secondary" name="decision" value="decline" formnovalidate>Don't allow</button><button name="decision" value="approve">Allow selected access</button></div></form><small>${escape(FICTION_NOTICE)} Never enter a real airline password, booking reference, passport, payment card or medical record.</small></main></body></html>`;
}
