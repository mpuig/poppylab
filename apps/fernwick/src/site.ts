/**
 * Fernwick Power & Light's public pages, consent page and shared shell. The
 * world is a meter reader's route card and the bill that follows it:
 * ruled rows of readings, plain numerals, a fern-green masthead and the
 * yellow of a meter seal for the one action that matters.
 */
import { GRANT_MS, TOKEN_MS } from "@poppy-lab/pap-company";
import {
  consentSheetCss,
  consentSheetHtml,
  labBarHtml,
  labConsentBarHtml,
  labLineHtml,
  labPlaygroundUrl,
  specRefHtml,
} from "@poppy-lab/pap-core";
import {
  addressLine,
  customers,
  ESPI_SHAPED,
  EXPORT_CREDIT_PER_WH,
  FICTION_NOTICE,
  plans,
  type CustomerSeed,
} from "./data.ts";
import { billsFor, readings } from "./billing.ts";
import { DAY, dayStart, isoDay, nowSeconds } from "./time.ts";
import { ESPI, ESPI_BASE } from "./espi.ts";
import { meterScopes, scopes, type FernwickScope } from "./scopes.ts";

export const escape = (value: string) =>
  value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
/** Hundred-thousandths of USD as a bill prints them. */
export const money = (amount: number) => {
  const cents = Math.round(amount / 1000);
  return `${cents < 0 ? "−" : ""}$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const fontSources = {
  style: "https://fonts.googleapis.com",
  font: "https://fonts.gstatic.com",
};
export const pageHeaders = {
  "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline' ${fontSources.style}; font-src ${fontSources.font}; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
  "Referrer-Policy": "no-referrer",
};
const fonts = `<link rel="preconnect" href="${fontSources.style}"><link rel="preconnect" href="${fontSources.font}" crossorigin><link href="${fontSources.style}/css2?family=IBM+Plex+Mono:wght@500&family=IBM+Plex+Sans+Condensed:wght@600;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">`;
const css = `
:root{color-scheme:light;--paper:#f4f2ea;--white:#fffdf8;--ink:#18231d;--soft:#3f4b44;--muted:#5d6861;--rule:#d3d2c4;--fern:#2c5a41;--deep:#183526;--seal:#f0c419;--seal-ink:#2e2600;--leaf:#dce8d2;--danger:#a2392c;--head:"IBM Plex Sans Condensed","Arial Narrow",sans-serif;--body:"IBM Plex Sans",Arial,sans-serif;--mono:"IBM Plex Mono",ui-monospace,Menlo,monospace}
*{box-sizing:border-box}html{background:var(--paper)}body{margin:0;color:var(--ink);font:400 16px/1.55 var(--body);-webkit-font-smoothing:antialiased}a{color:inherit;text-underline-offset:.22em;text-decoration-thickness:1px}a:hover{text-decoration-thickness:2px}button,input,select{font:inherit}:focus-visible{outline:3px solid var(--seal);outline-offset:3px}.wrap{width:min(1160px,100% - 2*clamp(16px,4vw,52px));margin-inline:auto}
.mast{background:var(--fern);color:#fff}.mast .wrap{min-height:66px;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:28px}.brand{font:700 25px/1 var(--head);text-decoration:none;letter-spacing:.01em}.brand small{display:block;font:500 12px/1.3 var(--body);opacity:.85;letter-spacing:0}.mast nav{display:flex;gap:24px;justify-self:center;font-weight:600;font-size:14px}.mast nav a{text-decoration:none}.mast nav a[aria-current]{text-decoration:underline;text-decoration-thickness:2px}.mast-login{display:inline-flex;align-items:center;min-height:40px;padding:0 16px;border:1px solid rgba(255,255,255,.5);border-radius:3px;font-weight:600;font-size:14px;text-decoration:none}.mast-login:hover,.mast-login[aria-current]{background:#fff;color:var(--fern)}
.hero{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:clamp(32px,6vw,84px);align-items:start;padding:clamp(44px,7vw,88px) 0 clamp(40px,6vw,72px)}.hero h1{font:700 clamp(44px,6vw,80px)/.98 var(--head);margin:0 0 22px;max-width:12ch}.lead{font-size:clamp(18px,2vw,22px);line-height:1.45;max-width:44ch;margin:0;color:var(--soft)}.warning{margin:22px 0 0;padding:12px 0;border-block:1px solid var(--rule);font-size:14px;color:var(--soft);max-width:58ch}.warning strong{color:var(--danger)}.actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:28px}.button,.account button{display:inline-flex;min-height:48px;align-items:center;justify-content:center;padding:0 20px;border:1px solid var(--fern);background:var(--fern);color:#fff;text-decoration:none;font-weight:600;cursor:pointer;border-radius:3px}.button:hover,.account button:hover{background:var(--deep)}.button.primary{background:var(--seal);border-color:var(--seal);color:var(--seal-ink)}.button.primary:hover{background:#f4d04a}.button.secondary,.account button.secondary{background:transparent;color:var(--fern);border-color:var(--rule)}.button.secondary:hover,.account button.secondary:hover{background:var(--white)}
.card{background:var(--white);border:1px solid var(--rule);border-top:4px solid var(--fern)}.card-head{display:flex;justify-content:space-between;gap:16px;padding:18px 22px 12px;border-bottom:1px solid var(--rule)}.card-head strong{font:700 22px/1.1 var(--head)}.card-head span{font-size:13px;color:var(--muted);text-align:right}.card-body{padding:4px 22px 8px}.row{display:grid;grid-template-columns:1fr auto;gap:16px;align-items:baseline;padding:12px 0;border-bottom:1px solid var(--rule)}.row:last-child{border-bottom:0}.row small{display:block;color:var(--muted);font-size:13px}.num{font:500 15px/1.3 var(--mono);font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}.total{font:700 20px/1.2 var(--head)}.days{display:grid;gap:6px;padding:10px 0 14px}.day{display:grid;grid-template-columns:92px 1fr 76px;gap:10px;align-items:center;font-size:13px;color:var(--soft)}.bar{height:8px;background:#e6e4d8}.bar span{display:block;height:100%;background:var(--fern)}.card-note{padding:12px 22px;border-top:1px solid var(--rule);font-size:13px;color:var(--muted)}
.section{padding:clamp(40px,6vw,76px) 0;border-top:1px solid var(--rule)}.section h2{font:700 clamp(32px,4.4vw,52px)/1.02 var(--head);margin:0 0 20px;max-width:18ch}.section-intro{max-width:68ch;color:var(--soft);margin:0 0 28px;font-size:18px}.ruled{border-top:2px solid var(--ink)}.ruled-row{display:grid;grid-template-columns:200px minmax(0,1fr) minmax(180px,.5fr);gap:26px;padding:20px 0;border-bottom:1px solid var(--rule);align-items:start}.ruled-row h3{font:700 21px/1.15 var(--head);margin:0}.ruled-row p{margin:0;color:var(--soft)}.ruled-row .mark{font-size:14px;font-weight:600;color:var(--fern)}code,.mono{font-family:var(--mono);font-size:.86em;overflow-wrap:anywhere}
.table-wrap{overflow:auto;border:1px solid var(--rule);background:var(--white)}table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:12px 14px;border-bottom:1px solid var(--rule);vertical-align:top}thead th{font:700 14px var(--head);background:#ecebe1}tbody th{white-space:nowrap}th.num,td.num{text-align:right}
.personas{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;background:var(--rule);border:1px solid var(--rule)}.persona{background:var(--white);padding:22px}.persona h3{font:700 26px/1 var(--head);margin:0 0 12px}.persona dl{margin:0}.persona dl div{display:flex;justify-content:space-between;gap:20px;padding:8px 0;border-bottom:1px solid #e6e4d8}.persona dt{color:var(--muted)}.persona dd{margin:0;text-align:right}
footer{background:var(--deep);color:#dbe5dd;padding:32px 0;font-size:14px}footer p{margin:0;max-width:88ch}footer p+p{margin-top:10px}footer a{color:#fff}.lab{border-top:1px solid rgba(255,255,255,.18);padding-top:14px;margin-top:16px}
.fine{font-size:13px;color:var(--muted)}.form-card{max-width:620px;background:var(--white);border:1px solid var(--rule);padding:24px}.form-card label{display:block;font-weight:600;margin-bottom:8px}.form-card select{width:100%;min-height:48px;margin-bottom:16px;border:1px solid var(--rule);padding:10px 12px;background:#fff}.account-head{padding:42px 0 24px}.account-head h1{font:700 clamp(40px,5.5vw,68px)/1 var(--head);margin:0 0 12px}.account-head p{margin:6px 0;color:var(--soft)}.live-row{display:flex;justify-content:space-between;align-items:center;gap:18px;flex-wrap:wrap;margin-top:20px}.live{color:var(--fern);font-weight:600}.error{color:var(--danger);font-weight:600}.account-grid{display:grid;grid-template-columns:1.1fr .9fr;gap:36px}.account .section{padding:30px 0}.account .section h2{font-size:32px;margin-bottom:16px}.data-list{border-top:2px solid var(--ink)}.data-row{padding:14px 0;border-bottom:1px solid var(--rule)}.data-row header{display:flex;justify-content:space-between;gap:16px;align-items:baseline}.data-row h3{font:700 19px/1.2 var(--head);margin:0}.data-row p{margin:6px 0 0;color:var(--soft);font-size:14px}.activity{padding:14px 0;border-bottom:1px solid var(--rule)}.activity p{margin:4px 0 0;color:var(--soft)}
.records{list-style:none;margin:0;padding:0;border-top:1px solid var(--rule)}.record{display:grid;gap:6px;padding:16px 0 18px;border-bottom:1px solid var(--rule);overflow-wrap:anywhere}.record-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:6px 16px}.record-when{font-size:13px;color:var(--muted);font-variant-numeric:tabular-nums}.record-tag{font:500 12px/1 var(--mono);padding:5px 8px;border-radius:2px;background:var(--leaf);color:var(--deep)}.record[data-tone=pending] .record-tag{background:var(--seal);color:var(--seal-ink)}.record[data-tone=info] .record-tag{background:#e3e7e9;color:var(--ink)}.record[data-tone=muted] .record-tag{background:transparent;color:var(--muted);box-shadow:inset 0 0 0 1px var(--rule)}.record-title{margin:4px 0 0;max-width:65ch;font-weight:600}.record-body{margin:0;max-width:65ch;font-size:15px;color:var(--soft)}.record-meta{margin:0;font-size:13px;color:var(--muted)}.account button:disabled{opacity:.55;cursor:wait}
@media(max-width:900px){.mast .wrap{grid-template-columns:1fr auto}.mast nav{grid-column:1/-1;grid-row:2;justify-self:start;padding-bottom:12px}.hero{grid-template-columns:1fr}.account-grid{grid-template-columns:1fr}.ruled-row{grid-template-columns:150px 1fr}.ruled-row .mark{grid-column:2}.personas{grid-template-columns:1fr}}
@media(max-width:560px){.mast .wrap{gap:12px}.mast nav{gap:14px;font-size:13px}.brand{font-size:21px}.hero h1{font-size:42px}.ruled-row{grid-template-columns:1fr;gap:8px}.ruled-row .mark{grid-column:auto}.day{grid-template-columns:78px 1fr 64px}}
`;

export function shell(
  title: string,
  body: string,
  current: "/" | "/for-agents" | "/account",
  origin: string,
) {
  const nav = (
    [
      ["/", "Home energy"],
      ["/for-agents", "For agents"],
    ] as const
  )
    .map(
      ([href, label]) =>
        `<a href="${href}"${href === current ? ' aria-current="page"' : ""}>${label}</a>`,
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title>${fonts}<style>${css}</style></head><body>${labBarHtml(origin, "Fernwick Power & Light")}<header class="mast"><div class="wrap"><a class="brand" href="/">Fernwick Power &amp; Light</a><nav aria-label="Site">${nav}</nav><a class="mast-login" href="/account"${current === "/account" ? ' aria-current="page"' : ""}>Your account</a></div></header>${body}<footer><div class="wrap"><p><strong>Fernwick Power &amp; Light is entirely fictional.</strong> No electricity is supplied, metered or billed, and no real utility account data or credentials should be entered. Its usage data API is ${escape(ESPI_SHAPED)}.</p><p>Independent Poppy Lab example, not affiliated with or endorsed by any real utility, by NAESB or by the authors of the Personal Agent Protocol. “Personal Agent Protocol” and “Poppy” are their names.</p>${labLineHtml(origin, "fernwick")}</div></footer></body></html>`;
}

/** A sample of the last week and the last bill, from the same data. */
function sampleCard(customer: CustomerSeed) {
  const meter = customer.meters[0]!;
  const now = nowSeconds();
  const history = [{ plan: meter.plan, from: 0 }];
  const today = dayStart(now);
  const days = Array.from({ length: 7 }, (_, i) => {
    const start = today - (7 - i) * DAY;
    const hours = readings(meter, 1, history, start, start + DAY);
    return {
      day: isoDay(start),
      wh: hours.reduce((sum, r) => sum + r.value, 0),
    };
  });
  const peak = Math.max(...days.map((d) => d.wh), 1);
  const bill = billsFor(meter, history, now).at(-1)!;
  const month = new Date(bill.start * 1000).toLocaleDateString("en-US", {
    month: "long",
    timeZone: "UTC",
  });
  const label = (day: string) =>
    new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
  return `<div class="card" aria-label="Sample fictional usage and bill"><div class="card-head"><strong>${escape(customer.name)}'s home</strong><span>Sample customer<br>${escape(plans[meter.plan].name)}</span></div><div class="card-body"><div class="days">${days.map((d) => `<div class="day"><span>${label(d.day)}</span><div class="bar" aria-hidden="true"><span style="width:${Math.round((d.wh / peak) * 100)}%"></span></div><span class="num">${(d.wh / 1000).toFixed(1)} kWh</span></div>`).join("")}</div>${bill.lines.map((item) => `<div class="row"><span>${escape(item.note)}${item.wh !== undefined ? `<small>${(item.wh / 1000).toFixed(1)} kWh</small>` : ""}</span><span class="num">${money(item.amount + item.rounding)}</span></div>`).join("")}<div class="row"><span class="total">${escape(month)} bill</span><span class="num total">${money(bill.total)}</span></div></div><div class="card-note">The last seven days, hour by hour summed per day, and the last closed bill. The portal and a connected agent read the same meter.</div></div>`;
}

export function homePage(origin: string) {
  const bands = plans["time-of-use"].bands;
  const hours = (from: number, to: number) =>
    `${String(from).padStart(2, "0")}:00–${String(to).padStart(2, "0")}:00`;
  const body = `<main><section class="wrap hero"><div><h1>Your power, read hour by hour.</h1><p class="lead">Fernwick reads your meter every hour and bills on the 1st. See what you used yesterday evening, what last month cost, and whether time-of-use pricing would save you money. Or let your personal agent keep an eye on it.</p><div class="actions"><a class="button primary" href="/account">Open your account</a><a class="button secondary" href="#agents">Use it with your agent</a></div><p class="warning"><strong>Nothing here is real.</strong> Fernwick supplies no electricity. Never enter a real utility account number, address, password or bill.</p></div>${sampleCard(customers[0]!)}</section><section class="wrap section"><h2>Two plans, priced by the hour.</h2><p class="section-intro">Every meter is on one of two plans, and you can switch at the start of any bill cycle. Hours are Pacific time; a bill also carries a basic service charge per meter.</p><div class="table-wrap"><table><thead><tr><th>Plan</th><th>Hours</th><th class="num">Price per kWh</th></tr></thead><tbody><tr><th>${escape(plans.flat.name)}</th><td>All hours</td><td class="num">${plans.flat.bands[0]!.perWh}¢</td></tr>${bands.map((band, i) => `<tr><th>${i === 0 ? escape(plans["time-of-use"].name) : ""}</th><td>${escape(band.name)}, ${hours(band.from, band.to)}</td><td class="num">${band.perWh}¢</td></tr>`).join("")}<tr><th>Solar credit</th><td>Energy your panels send to the grid</td><td class="num">${EXPORT_CREDIT_PER_WH}¢</td></tr></tbody></table></div></section><section class="wrap section"><h2>What your account shows.</h2><div class="ruled"><div class="ruled-row"><h3>Hourly usage</h3><p>Every hour of the last 92 days, for each meter: the house, an EV charger, and what solar panels send back.</p><span class="mark">Read every hour</span></div><div class="ruled-row"><h3>Bills</h3><p>Each month closes on the 1st. The bill lists the service charge, the energy by price band and any solar credit, worked out from the same hours.</p><span class="mark">From your readings</span></div><div class="ruled-row"><h3>Plan changes</h3><p>Switch a meter between flat and time-of-use. The change starts with the next bill cycle, and you see the estimated difference first.</p><span class="mark">Your approval</span></div></div></section><section class="wrap section" id="agents"><h2>Use Fernwick with your personal agent.</h2><p class="section-intro">Fernwick works with personal AI agents. Yours can answer “how much did the EV charger use this month?” or work out whether time-of-use suits you, and you stay in charge of every change.</p><div class="ruled"><div class="ruled-row"><h3>You choose the meters</h3><p>You sign in here, on Fernwick's own page, and pick which meters the agent may read. It never gets your password, and it sees nothing of the meters you leave out.</p><span class="mark">Your sign-in</span></div><div class="ruled-row"><h3>It proposes, you approve</h3><p>A plan change arrives as an exact proposal: the meter, the new plan, the date it starts and the estimated difference. Nothing changes until you approve it, and it happens once.</p><span class="mark">Your approval</span></div><div class="ruled-row"><h3>You can disconnect it</h3><p>Your account lists the agents connected to it and what each may see. Disconnecting one ends its access at once.</p><span class="mark">Your call</span></div></div><div class="actions"><a class="button primary" href="${labPlaygroundUrl(origin)}">Try it with Iris, the demo agent</a><a class="button secondary" href="/for-agents">Technical details for agent builders</a></div></section></main>`;
  return shell("Fernwick Power & Light · Home energy", body, "/", origin);
}

const scopePurpose: Record<FernwickScope, string> = {
  "account:read": "Address, chosen meters, plans and bills",
  "plan:write": "Switch a chosen meter's rate plan",
  "espi:usage": "ESPI-shaped: chosen meters and hourly usage with cost",
  "espi:summary": "ESPI-shaped: bill summaries of chosen meters",
  "espi:customer": "ESPI-shaped: name and service address",
  offline_access: "Refresh the fictional grant while away",
};

export function forAgentsPage(origin: string) {
  const base = `${origin}${ESPI_BASE}`;
  const rows: Array<[string, string, string]> = [
    ["Discovery", `${origin}/.well-known/poppy.json`, "§3"],
    [
      "OAuth metadata",
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
      `POST ${origin}/oauth/token · private_key_jwt + DPoP`,
      "§4.4–4.5",
    ],
    ["Revocation", `POST ${origin}/oauth/revoke`, "§4.6"],
    ["OpenAPI (own API)", `${origin}/openapi.json`, "§7"],
    [
      `ESPI-shaped API (${ESPI_SHAPED})`,
      `${base} · Atom XML · Poppy-Extensions: "${ESPI.name}";v="${ESPI.version}"`,
      "§3.3",
    ],
    ["Conversations", `${origin}/poppy/conversations`, "§8"],
    ["Excluded tasks", `${origin}/poppy/tasks`, "§9"],
    [
      "Approvals",
      `Poppy-Extensions: "operations";v="3" · Poppy-Approval`,
      "Operations v3",
    ],
  ];
  const routes: Array<[string, string, string]> = [
    [
      "Batch/Subscription/{sub}",
      "espi:usage",
      "Everything about the chosen meters: usage points, local time, readings, reading types, interval blocks in the window, and bill summaries with espi:summary",
    ],
    ["Subscription/{sub}/UsagePoint[/{up}]", "espi:usage", "The chosen meters"],
    [
      "…/UsagePoint/{up}/MeterReading[/{mr}]",
      "espi:usage",
      "Its readings: delivered, and sent to the grid with solar",
    ],
    [
      "…/MeterReading/{mr}/IntervalBlock[/{day}]",
      "espi:usage",
      "One block per UTC day, 24 hourly readings with cost",
    ],
    [
      "…/UsagePoint/{up}/UsageSummary[/{month}]",
      "espi:summary",
      "Monthly bills with line items",
    ],
    [
      "ReadingType[/{id}] · LocalTimeParameters[/{id}]",
      "espi:usage",
      "Units and Pacific time with US daylight saving rules",
    ],
    [
      "Authorization[/{sub}]",
      "any token of the grant",
      "The grant as an ESPI Authorization; DELETE Authorization/{sub} revokes it (204)",
    ],
    ["Batch/RetailCustomer/{sub}", "espi:customer", "Name and service address"],
  ];
  const body = `<main class="wrap"><section class="section"><h2>Point a Poppy 1.0 agent at Fernwick.</h2><p class="section-intro">Fernwick accepts any HTTPS client metadata document with valid redirect URIs and ES256 or PS384 keys. The local plain-HTTP exception is only for Iris at localhost. Every public visitor receives a separate copy of the fictional customers.</p><div class="table-wrap"><table><thead><tr><th>Capability</th><th>Endpoint or header</th><th>Spec</th></tr></thead><tbody>${rows.map(([name, where, spec]) => `<tr><th>${escape(name)}</th><td><code>${escape(where)}</code></td><td>${specRefHtml(spec)}</td></tr>`).join("")}</tbody></table></div></section><section class="section"><h2>The ESPI-shaped API.</h2><p class="section-intro">Read-only Atom XML under <code>${escape(base)}</code>, modelled on NAESB REQ.21 ESPI and not certified. Energy in Wh (uom 72) per hour, cost in hundred-thousandths of a US dollar, times in seconds since 1970 UTC. The subscription is the grant: its ID comes back as <code>resourceURI</code> and <code>authorizationURI</code> in every token response. <code>published-min</code> and <code>published-max</code> choose the window (the last 31 days by default, at most 92); <code>max-results</code> and <code>start-index</code> page a feed. A subscription or meter outside the grant is a plain 404; a malformed parameter is a 400 with Fernwick's own JSON body, <code>{"error":"invalid_parameter","description":…}</code>.</p><div class="table-wrap"><table><thead><tr><th>Route</th><th>Scope</th><th>Answers</th></tr></thead><tbody>${routes.map(([route, scope, what]) => `<tr><th><code>${escape(route)}</code></th><td><code>${escape(scope)}</code></td><td>${escape(what)}</td></tr>`).join("")}</tbody></table></div></section><section class="section"><h2>Two test customers.</h2><p class="section-intro">Choose either one on Fernwick's consent page or in the account portal. The portal and the APIs read the same state.</p><div class="personas">${customers.map((customer) => `<article class="persona"><h3>${escape(customer.name)}</h3><dl><div><dt>Service address</dt><dd>${escape(addressLine(customer.address))}</dd></div>${customer.meters.map((meter) => `<div><dt>${escape(meter.label)} <code>${meter.id}</code></dt><dd>${escape(plans[meter.plan].name)}</dd></div>`).join("")}</dl></article>`).join("")}</div></section><section class="section"><h2>Scopes are narrow.</h2><div class="ruled">${scopes.map((scope) => `<div class="ruled-row"><h3><code>${scope}</code></h3><p>${escape(scopePurpose[scope])}</p><span class="mark">${scope === "plan:write" ? "reversible" : scope === "offline_access" ? "offline" : "read only"}</span></div>`).join("")}</div></section><section class="section"><h2>Suggested protocol runs.</h2><div class="ruled"><div class="ruled-row"><h3>Read</h3><p>“How much did my EV charger use this month, and what did October cost?”</p><span class="mark">No approval</span></div><div class="ruled-row"><h3>Compare</h3><p>“Would time-of-use be cheaper for my home meter?” The proposal's terms carry the estimate from the last closed bill.</p><span class="mark">No change yet</span></div><div class="ruled-row"><h3>Change</h3><p>“Switch my home meter to time-of-use.” It starts with the next bill cycle, after exact approval, once.</p><span class="mark">Exact approval</span></div></div><p class="fine">${escape(FICTION_NOTICE)}</p></section></main>`;
  return shell(
    "For agents · Fernwick Power & Light",
    body,
    "/for-agents",
    origin,
  );
}

/** A length of time in whole days or hours: "7 days", "1 hour". */
const span = (ms: number) => {
  const [count, unit] =
    ms % 86400000 === 0 ? [ms / 86400000, "day"] : [ms / 3600000, "hour"];
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
};
const permissionText: Record<FernwickScope, string> = {
  "account:read":
    "See the service address, the meters you choose with their rate plans, and their monthly bills.",
  "plan:write":
    "Propose switching a chosen meter between flat and time-of-use from the next bill cycle. Each proposal needs separate approval.",
  "espi:usage":
    "Through the ESPI-shaped API, see the meters you choose, their hourly usage and its cost.",
  "espi:summary":
    "Through the ESPI-shaped API, see the monthly bill summaries of the meters you choose.",
  "espi:customer":
    "Through the ESPI-shaped API, see the customer's name and service address.",
  // The two ends `grantLifetime` gives a grant, said as the gateway counts them.
  offline_access: `The agent stays connected for ${span(GRANT_MS)}. Without this, it is disconnected after ${span(TOKEN_MS)}.`,
};

/** The consent sheet in Fernwick's faces and colours. */
const sheetCss = `${consentSheetCss}.sheet{--sheet-rule:var(--rule);--sheet-accent:var(--fern)}
.sheet h1{font:700 clamp(36px,5vw,58px)/1 var(--head)}
.sheet-agent{color:var(--soft)}.sheet-agent strong{color:var(--ink)}
.sheet-verified{display:inline-flex;align-items:center;gap:7px;font-size:13px;font-weight:600;color:var(--fern)}
.sheet-verified:before{content:"";width:8px;height:8px;border-radius:50%;background:var(--fern)}
.sheet-cols{border-top:2px solid var(--ink)}
.sheet legend,.sheet h2{font:700 26px/1.05 var(--head)}
.sheet-person{background:var(--white)}
.sheet-person strong,.sheet-reads strong,.sheet-option strong{font-weight:600}
.sheet-person small,.sheet-reads span,.sheet-option span span{font-size:14px}
.sheet-person small,.sheet-note,.sheet-reads span,.sheet-option span span,.sheet-none,.sheet-foot p{color:var(--soft)}
.sheet-group h3{font:700 20px/1.15 var(--head)}
.sheet-group h3 span{font:400 14px var(--body);color:var(--muted)}
.sheet-field label{font-weight:600}
.sheet-field input{border:1px solid var(--rule);background:#fff;color:var(--ink)}
.sheet button{border:1px solid var(--fern);border-radius:3px;background:var(--fern);color:#fff;font-weight:600}
.sheet button:hover{background:var(--deep)}
.sheet button.secondary{background:transparent;color:var(--fern);border-color:var(--rule)}
.sheet button.secondary:hover{background:var(--white)}
.sheet-foot p{font-size:15px}
.sheet-fine{font-size:13px;color:var(--muted)}
.sheet-meters{margin-top:26px;padding-top:20px;border-top:1px solid var(--rule)}
.sheet-meters h3{font:700 20px/1.15 var(--head);margin:0 0 8px}
.meter-owner{margin:8px 0 0;font-weight:600}.meter-empty{display:none;margin:10px 0 0;color:var(--danger);font-weight:600}
`;

/**
 * The meters to share, per person, under the people since they are chosen
 * with the person. They limit the whole grant: both APIs and the Company
 * Agent. Without scripts (the consent CSP allows none), CSS `:has()` shows
 * only the chosen person's meters and hides "Allow" until one is ticked; a
 * browser without `:has()` shows every person's, and the server keeps only
 * the chosen person's (`selectResources`). One field name per meter, since
 * a form keeps only the last value of a repeated name.
 */
const meterChoice = () =>
  `<div class="sheet-meters"><h3>Meters to share</h3>${customers
    .map(
      (customer) =>
        `<div class="meter-persona" data-persona="${escape(customer.id)}"><p class="meter-owner">${escape(customer.name)}</p>${customer.meters
          .map(
            (meter) =>
              `<label class="sheet-option"><input id="meter-${escape(meter.id)}" type="checkbox" name="espi_meter_${escape(meter.id)}" value="yes" checked><span><strong>${escape(meter.label)}</strong><span>${escape(plans[meter.plan].name)} · ${meter.readings.length > 1 ? "usage and solar export" : "usage"}</span></span></label>`,
          )
          .join("")}</div>`,
    )
    .join(
      "",
    )}<p class="meter-empty">Choose at least one meter to allow this access, or don't allow it.</p><p class="sheet-note">The meters you choose are the only ones the agent can see or act on, through Fernwick's own API, the ESPI-shaped one or Fernwick's automated guide.</p></div>`;
/** The person's meters only, and no "Allow" with none ticked. */
const meterStyle = () => {
  const when = (id: string) => `form:has(#account-${id}:checked)`;
  const none = (id: string) =>
    `${when(id)}:not(:has(.meter-persona[data-persona="${id}"] input:checked))`;
  return `@supports selector(:has(a)){.meter-persona,.meter-owner{display:none}${customers
    .map(
      ({ id }) =>
        `${when(id)} .meter-persona[data-persona="${id}"]{display:block}${none(id)} .meter-empty{display:block}${none(id)} button[value=approve]{display:none}`,
    )
    .join("")}}`;
};

export function consentPage(input: {
  nonce: string;
  passwordRequired: boolean;
  scopes: string;
  client: string;
  clientHost: string;
}) {
  const requested = input.scopes.split(" ") as FernwickScope[];
  const read = requested.filter(
    (scope) => scope !== "plan:write" && scope !== "offline_access",
  );
  const meters = requested.some((scope) => meterScopes.includes(scope));
  const sheet = consentSheetHtml({
    company: "Fernwick",
    agent: input.client,
    agentHost: input.clientHost,
    nonce: input.nonce,
    passwordRequired: input.passwordRequired,
    people: customers.map((customer) => ({
      id: customer.id,
      name: customer.name,
      note: `${addressLine(customer.address)} · ${customer.meters.length} ${customer.meters.length === 1 ? "meter" : "meters"}`,
    })),
    ...(meters ? { beside: meterChoice() } : {}),
    reads: read.map((scope) => ({
      title: scopePurpose[scope],
      text: permissionText[scope],
    })),
    changes: requested.includes("plan:write")
      ? [
          {
            name: "allow_plan_write",
            title: scopePurpose["plan:write"],
            text: permissionText["plan:write"],
            checked: true,
          },
        ]
      : [],
    ...(requested.includes("offline_access")
      ? {
          extras: [
            {
              heading: "While you're away",
              option: {
                name: "allow_offline",
                title: "Keep the agent connected",
                text: `${permissionText.offline_access} Optional and off by default.`,
              },
            },
          ],
        }
      : {}),
    disconnect: "You can disconnect the agent in your Fernwick account.",
    fine: `No real account exists. Never enter a real utility account number, password, address or bill. ${FICTION_NOTICE} The usage data API is ${ESPI_SHAPED}. Independent experiment; no claim of utility or Poppy conformance.`,
  });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Allow ${escape(input.client)} · Fernwick Power &amp; Light</title>${fonts}<style>${css}${sheetCss}${meters ? meterStyle() : ""}</style></head><body>${labConsentBarHtml("Fernwick Power & Light")}<header class="mast"><div class="wrap"><span class="brand">Fernwick Power &amp; Light</span></div></header>${sheet}</body></html>`;
}
