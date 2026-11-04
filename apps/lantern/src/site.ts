/**
 * Lantern Noodle Bar's website: the ticket machine at the shop door. Read
 * only and server-rendered with no JavaScript. The menu and slots come from
 * the same arrays the API serves, so the page and the agent never disagree.
 * The consent page shares the visual system.
 */
import { labLineHtml } from "@poppy-lab/pap-core";
import {
  customers,
  DELIVERY_CENTS,
  hours,
  menu,
  PHONE,
  slots,
} from "./data.ts";

export const escape = (t: string) =>
  t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** Fonts load from Google Fonts; everything else stays on this origin. */
export const fontSources = {
  style: "https://fonts.googleapis.com",
  font: "https://fonts.gstatic.com",
};
export const pageHeaders = {
  "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline' ${fontSources.style}; font-src ${fontSources.font}; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
  "Referrer-Policy": "no-referrer",
};
const fonts = `<link rel="preconnect" href="${fontSources.style}"><link rel="preconnect" href="${fontSources.font}" crossorigin><link href="${fontSources.style}/css2?family=Big+Shoulders+Display:wght@700;900&family=Manrope:wght@500;700&family=Sometype+Mono:wght@400;700&display=swap" rel="stylesheet">`;

const css = `
:root{color-scheme:light;--wall:#f3efe6;--ink:#17202a;--ink-soft:#3a4452;--muted:#5d6673;--panel:#17202a;--panel-edge:#0b1118;--tile:#fbf7ee;--tile-edge:#e6dfd0;--amber:#e4a11b;--amber-glow:rgba(228,161,27,.55);--red:#c62f1e;--rule:#d9d2c5;--display:"Big Shoulders Display","Archivo Narrow","Arial Narrow",sans-serif;--body:Manrope,"Helvetica Neue",Arial,sans-serif;--mono:"Sometype Mono",ui-monospace,monospace}
*{box-sizing:border-box}
html{background:var(--wall)}
body{margin:0;color:var(--ink);font:500 17px/1.55 var(--body);-webkit-font-smoothing:antialiased}
code{font:inherit;font-family:var(--mono);font-size:.92em}
a{color:inherit;text-underline-offset:.2em}
a:hover{text-decoration-thickness:2px}
:focus-visible{outline:3px solid var(--amber);outline-offset:3px}
::selection{background:var(--amber);color:var(--ink)}
.wrap{width:min(1120px,100% - 2*clamp(16px,4vw,40px));margin-inline:auto}
header.strip{background:var(--red);color:#fff}
header.strip .wrap{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:56px;padding-block:8px}
.brand{font:900 26px/1 var(--display);letter-spacing:.02em;text-transform:uppercase;text-decoration:none}
.strip nav{display:flex;gap:20px;font:700 14px var(--mono)}
.strip nav a{text-decoration:none}
.strip nav a[aria-current]{text-decoration:underline;text-decoration-thickness:2px}
.strip .tag{font:400 12px var(--mono);opacity:.9}
.intro{padding:clamp(28px,5vw,56px) 0 clamp(20px,3vw,32px)}
.intro h1{font:900 clamp(44px,8vw,104px)/1 var(--display);letter-spacing:.005em;text-transform:uppercase;margin:0 0 14px;max-width:14ch}
.intro p{margin:0;max-width:60ch;color:var(--ink-soft)}
.intro .how{margin-top:10px;font-size:15px;color:var(--muted)}
.machine{background:var(--panel);color:var(--tile);border-radius:18px;padding:clamp(16px,2.6vw,28px);box-shadow:inset 0 0 0 1px rgba(255,255,255,.06),0 24px 60px -30px rgba(11,17,24,.6);margin-block:8px clamp(40px,6vw,72px)}
.machine .head{display:flex;justify-content:space-between;align-items:baseline;gap:16px;padding:0 6px 14px;border-bottom:1px solid rgba(255,255,255,.12);margin-bottom:18px}
.machine .head h2{font:900 clamp(22px,2.4vw,30px)/1 var(--display);letter-spacing:.04em;text-transform:uppercase;margin:0}
.machine .head span{font:400 13px var(--mono);color:#b9c0cc}
.buttons{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin:0;padding:0;list-style:none}
.buttons.slots{grid-template-columns:repeat(4,minmax(0,1fr));margin-top:14px}
.btn{position:relative;background:var(--tile);color:var(--ink);border-radius:10px;padding:16px 16px 14px;min-height:118px;display:flex;flex-direction:column;justify-content:space-between;gap:10px;border:1px solid var(--tile-edge);box-shadow:0 1px 0 rgba(255,255,255,.4) inset,0 0 0 3px var(--amber-glow),0 0 18px 2px var(--amber-glow)}
.btn .n{position:absolute;top:10px;right:12px;font:700 12px var(--mono);color:var(--muted)}
.btn .name{font:800 clamp(20px,2vw,26px)/1.05 var(--display);text-transform:uppercase;letter-spacing:.01em;padding-right:28px}
.btn .price{align-self:flex-start;font:700 15px/1 var(--mono);letter-spacing:.06em;background:var(--ink);color:#fff;padding:5px 8px;border-radius:3px;box-shadow:inset 0 1px 0 rgba(255,255,255,.25),inset 0 -1px 0 rgba(0,0,0,.6)}
.btn.slot{min-height:92px}
.btn.slot .name{font-size:clamp(18px,1.6vw,22px)}
.btn.slot .time{font:700 14px var(--mono);color:var(--ink-soft)}
.tray{margin-top:18px;display:grid;grid-template-columns:minmax(0,1.4fr) auto;gap:18px;align-items:center;background:var(--panel-edge);border-radius:12px;padding:16px 18px;color:#dfe3ea;font-size:15px;line-height:1.5}
.tray strong{color:#fff}
.tray .cta{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 20px;border-radius:8px;background:var(--amber);color:var(--ink);font:800 17px var(--display);letter-spacing:.04em;text-transform:uppercase;text-decoration:none;white-space:nowrap}
.tray .cta:hover{background:#f0b232}
.tray p{margin:0}
section.plain{padding:0 0 clamp(40px,6vw,64px)}
section.plain h2{font:900 clamp(28px,3.4vw,40px)/1 var(--display);text-transform:uppercase;letter-spacing:.02em;margin:0 0 18px}
.cols{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:clamp(20px,3vw,40px)}
.cols h3{font:800 20px/1.1 var(--display);text-transform:uppercase;margin:0 0 8px;letter-spacing:.02em}
.cols p{margin:0;color:var(--ink-soft);font-size:15px}
.cols ol{margin:0;padding-left:20px;color:var(--ink-soft);font-size:15px}
.cols li+li{margin-top:6px}
dl.hours{margin:0;font-size:15px}
dl.hours dd{font-family:var(--mono)}
dl.hours div{display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px solid var(--rule)}
dl.hours dt{color:var(--muted)}dl.hours dd{margin:0;font-weight:700}
table{width:100%;border-collapse:collapse;font-size:14px}
td code{font-size:13px}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--rule);vertical-align:top}
thead th{font:700 12px var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
tbody th{font-weight:700;white-space:nowrap}
td code{font:inherit;overflow-wrap:anywhere}
.table-wrap{overflow-x:auto;border:1px solid var(--rule);border-radius:10px;background:#fff}
.customers{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin:0;padding:0;list-style:none}
.customers li{background:#fff;border:1px solid var(--rule);border-radius:10px;padding:16px}
.customers strong{font:800 22px/1 var(--display);text-transform:uppercase;display:block;margin-bottom:6px}
.customers span{font-size:14px;color:var(--ink-soft)}
.try{font-size:15px;color:var(--ink-soft);margin:18px 0 0}
.try q{font-weight:700;color:var(--ink)}
footer{background:var(--ink);color:#dfe3ea;font-size:14px;padding:28px 0 32px}
footer .wrap{display:grid;gap:10px}
footer p{margin:0;max-width:78ch}
footer a{color:#fff}
footer .lab{margin-top:6px;padding-top:12px;border-top:1px solid rgba(255,255,255,.14);color:#b9c0cc;font-size:13px}
footer .lab [aria-current]{color:#fff}
.consent main{max-width:720px;margin:auto;padding:clamp(28px,5vw,56px) clamp(16px,4vw,32px)}
.consent h1{font:900 clamp(34px,6vw,56px)/1 var(--display);text-transform:uppercase;margin:0 0 12px}
.consent p{margin:0 0 14px;color:var(--ink-soft)}
.consent label{display:block;font:800 18px var(--display);text-transform:uppercase;letter-spacing:.02em;margin:22px 0 8px}
.consent select,.consent input[type=password]{width:100%;min-height:48px;border:1px solid var(--rule);border-radius:8px;padding:10px 12px;font:inherit;background:#fff;color:var(--ink)}
.consent .check{display:flex;gap:12px;align-items:flex-start;margin-top:18px;font:800 18px var(--display);text-transform:uppercase}
.consent .check input{width:22px;height:22px;margin-top:2px;accent-color:var(--amber)}
.consent .actions{display:flex;gap:12px;justify-content:flex-end;margin-top:32px;border-top:1px solid var(--rule);padding-top:24px}
.consent button{min-height:48px;padding:12px 22px;border-radius:8px;border:1px solid var(--ink);background:var(--ink);color:#fff;font:800 17px var(--display);letter-spacing:.04em;text-transform:uppercase;cursor:pointer}
.consent button:hover{background:var(--ink-soft)}
.consent .secondary{background:transparent;color:var(--ink);border-color:var(--rule)}
.consent .secondary:hover{background:#fff}
.consent small{display:block;margin-top:28px;color:var(--muted)}
.notice{font-size:14px;color:var(--muted)}
.card.form{background:#fff;border:1px solid var(--rule);border-radius:12px;padding:clamp(18px,3vw,28px);max-width:560px}
.card.form label,.editor label{display:block;font:800 16px var(--display);text-transform:uppercase;letter-spacing:.02em;margin:0 0 8px}
.card.form select,.editor select,.editor input{width:100%;min-height:46px;border:1px solid var(--rule);border-radius:8px;padding:10px 12px;font:inherit;background:#fff;color:var(--ink);margin-bottom:14px}
.card.form button,.editor button,.live-row button,.account button{min-height:46px;padding:10px 18px;border-radius:8px;border:1px solid var(--ink);background:var(--ink);color:#fff;font:800 16px var(--display);letter-spacing:.04em;text-transform:uppercase;cursor:pointer}
.account button:hover,.card.form button:hover{background:var(--ink-soft)}
.account button:disabled{opacity:.6;cursor:wait}
.account .secondary,.live-row .secondary{background:transparent;color:var(--ink);border-color:var(--rule)}
.account .secondary:hover{background:#fff}
.live-row{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;margin:18px 0 0}
.live-row p{margin:0;font-size:15px}
.live{color:#2f6b3f}.error{color:var(--red)}
article.order{background:var(--tile);border:1px solid var(--tile-edge);border-radius:12px;padding:clamp(16px,2.4vw,24px);margin-bottom:16px;box-shadow:0 0 0 3px var(--amber-glow)}
.order-head{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:10px}
.order-head h3{font:800 24px/1 var(--display);text-transform:uppercase;margin:0}
.mono{font-family:var(--mono);font-size:14px}
.lines .line,.totals div{display:flex;justify-content:space-between;gap:16px;padding:7px 0;border-bottom:1px solid var(--rule)}
.totals{max-width:320px;margin:10px 0 10px auto}
.totals .total{font-weight:800;border-bottom:0}
.account article.order>button{margin-top:10px}
.editor{margin-top:18px;padding-top:18px;border-top:1px dashed var(--rule)}
.quantities{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 24px}
.quantity label{font:600 15px var(--body);text-transform:none;letter-spacing:0}
.quantity small{display:block;font:400 12px var(--mono)}
.editor .actions{display:flex;gap:10px;flex-wrap:wrap}
article.activity{padding:14px 0;border-bottom:1px solid var(--rule)}
article.activity h3{font:800 18px/1 var(--display);text-transform:uppercase;margin:0 0 6px}
article.activity p{margin:0;color:var(--ink-soft);font-size:15px}
@media(max-width:900px){.buttons{grid-template-columns:repeat(2,minmax(0,1fr))}.buttons.slots{grid-template-columns:repeat(2,minmax(0,1fr))}.cols{grid-template-columns:1fr}.tray{grid-template-columns:1fr}.tray .cta{justify-self:start}}
@media(max-width:560px){.strip nav{gap:10px;font-size:12px}.quantities{grid-template-columns:1fr}.strip .tag{display:none}.btn{min-height:104px;padding:14px}.customers{grid-template-columns:1fr}.consent .actions{flex-wrap:wrap}.consent .actions button{flex:1}}
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
      ["/", "Menu"],
      ["/for-agents", "For agents"],
      ["/account", "Your account"],
    ] as const
  )
    .map(
      ([href, label]) =>
        `<a href="${href}"${href === current ? ' aria-current="page"' : ""}>${label}</a>`,
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>${fonts}<style>${css}</style></head><body><header class="strip"><div class="wrap"><a class="brand" href="/">Lantern Noodle Bar</a><nav aria-label="Site">${nav}</nav><span class="tag">Fictional test Company · PAP 0.3</span></div></header>${body}<footer><div class="wrap"><p>Lantern Noodle Bar is a fictional restaurant for testing personal agents. Nothing is sold, charged or delivered.</p><p>Independent experiment, not affiliated with or endorsed by the authors of the Personal Agent Protocol. “Personal Agent Protocol” and “Poppy” are their names.</p>${labLineHtml(origin, "lantern")}</div></footer></body></html>`;
}

const [slotDay, slotTime] = [
  (label: string) => label.split(" ")[0] ?? label,
  (label: string) => label.split(" ").slice(1).join(" "),
];

export function homePage(origin: string) {
  const dishes = menu
    .map(
      (d, i) =>
        `<li class="btn"><span class="n">${String(i + 1).padStart(2, "0")}</span><span class="name">${escape(d.name)}</span><span class="price">${usd(d.price_cents)}</span></li>`,
    )
    .join("");
  const slotButtons = slots
    .map(
      (s) =>
        `<li class="btn slot"><span class="name">${escape(slotDay(s.label))}</span><span class="time">${escape(slotTime(s.label))}</span></li>`,
    )
    .join("");
  const body = `<main class="wrap"><section class="intro"><h1>Noodles on your night, not your to-do list.</h1><p>Six dishes, four delivery slots, one neighbourhood noodle bar. Your personal agent reads the menu and the slots, proposes the order, and nothing happens until you approve it.</p><p class="how">A fictional shop for testing the Personal Agent Protocol. No kitchen, no delivery van.</p></section><section class="machine" aria-labelledby="machine-title"><div class="head"><h2 id="machine-title">Ticket machine</h2><span>Delivery ${usd(DELIVERY_CENTS)} per order · USD</span></div><ol class="buttons" aria-label="Menu">${dishes}</ol><ol class="buttons slots" aria-label="Delivery slots">${slotButtons}</ol><div class="tray"><p><strong>No coins here.</strong> Your personal agent presses the buttons for you. In Poppy Lab, connect this Company, sign in as a test customer, and ask it to change a scheduled order; you approve the exact new total.</p><a class="cta" href="${playgroundFor(origin)}">Order through your agent</a></div></section><section class="plain"><h2>How ordering works</h2><div class="cols"><div><h3>1. Your agent reads</h3><p>It discovers this shop, starts a signed Session, and reads the menu and the slots. No account is needed for that.</p></div><div><h3>2. You sign in here</h3><p>To see or change a scheduled order, you sign in on this shop&apos;s own page as a test customer and choose what the agent may do.</p></div><div><h3>3. You approve the ticket</h3><p>The agent proposes the change with the exact dishes, slot and price difference. The shop waits for your approval and performs it once.</p></div></div></section><section class="plain"><h2>Hours and delivery</h2><div class="cols"><div><h3>Kitchen</h3><dl class="hours">${hours.map((h) => `<div><dt>${h.days}</dt><dd>${h.open}</dd></div>`).join("")}</dl></div><div><h3>Delivery slots</h3><p>Scheduled orders go out in the four slots above. A change of slot costs nothing; a change of dishes is charged at the difference, simulated.</p></div><div><h3>Find us</h3><p>12 Lantern Lane (fictional).<br>Dine in, collect, or let your agent schedule a delivery.<br>Phone <span class="mono">${PHONE}</span> (fictional number).</p></div></div></section></main>`;
  return shell("Lantern Noodle Bar · fictional noodle bar", body, "/", origin);
}

export function forAgentsPage(origin: string) {
  const host = escape(new URL(origin).host);
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
    ["Direct Sign-In", `GET ${origin}/oauth/authorize · PKCE S256`, "§4.2"],
    [
      "Tokens and refresh",
      `POST ${origin}/oauth/token · private_key_jwt, DPoP`,
      "§4.4–4.5",
    ],
    ["Revocation", `POST ${origin}/oauth/revoke`, "§4.6"],
    ["Session header", "Poppy-Session on every /api request", "§5.2–5.3"],
    ["API", `${origin}/openapi.json · OpenAPI 3.1`, "§7"],
    ["Excluded tasks", `${origin}/poppy/excluded-tasks.json`, "§9.1"],
    [
      "Conversations",
      `${origin}/poppy/conversations · structured requests in data`,
      "§8",
    ],
    [
      "Approvals",
      "403 approval_required → resend with Poppy-Approval",
      "Operations v2",
    ],
  ];
  const table = rows
    .map(
      ([what, where, spec]) =>
        `<tr><th scope="row">${what}</th><td><code>${escape(where)}</code></td><td>${spec}</td></tr>`,
    )
    .join("");
  const people = customers
    .map((c) => {
      const lines = Object.entries(c.order.lines)
        .map(([id, q]) => `${q} × ${menu.find((d) => d.id === id)?.name ?? id}`)
        .join(", ");
      const slot =
        slots.find((s) => s.id === c.order.slot)?.label ?? c.order.slot;
      return `<li><strong>${escape(c.name)}</strong><span>Account <code>${c.id}</code> · order <code>${c.order.id}</code>: ${escape(lines)} · ${escape(slot)}</span></li>`;
    })
    .join("");
  const body = `<main class="wrap"><section class="intro"><h1>Point your agent here.</h1><p>Lantern Noodle Bar speaks Personal Agent Protocol draft 0.3. Any Personal Agent with an HTTPS <code>client_id</code> that serves its metadata and keys can start a Session, sign in as a test customer and change a scheduled order with Operations v2. Every visitor gets its own copy of the customers.</p></section><section class="plain"><h2>Endpoints at ${host}</h2><div class="table-wrap"><table><thead><tr><th scope="col">What</th><th scope="col">Where</th><th scope="col">Spec</th></tr></thead><tbody>${table}</tbody></table></div><p class="try">Scopes: <code>orders:read</code> (scheduled orders) and <code>orders:write</code> (propose changes). Sign-in offers read first; a visitor adds write later.</p></section><section class="plain"><h2>Test customers</h2><ul class="customers">${people}</ul><p class="try">Try: <q>Add a matcha ice cream to my order and move it to Sunday lunchtime.</q> The approval shows the new slot, the dishes and the price difference before anything changes.</p><p class="try">Or: <q>The gyoza were missing from my last delivery.</q> Your agent takes it up with Lantern's own agent in a conversation. It answers structured requests with data, and proposes a refund you approve.</p></section><section class="plain"><h2>Watch it work</h2><p class="try">Open <a href="${playgroundFor(origin)}">Iris</a>, the test Personal Agent in Poppy Lab, with this Company connected. Its Inspector shows discovery, the Session and each API call with the spec section it meets.</p></section></main>`;
  return shell("For agents · Lantern Noodle Bar", body, "/for-agents", origin);
}

/** Server-rendered consent (§4.2) in the shop's own visual system. */
export function consentPage(input: {
  nonce: string;
  passwordRequired: boolean;
  scopes: string;
  client: string;
  clientHost: string;
}) {
  const { nonce, passwordRequired, scopes, client, clientHost } = input;
  const read = scopes.split(" ").includes("orders:read"),
    write = scopes.split(" ").includes("orders:write");
  const agent = escape(client);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Allow ${agent} · Lantern Noodle Bar</title>${fonts}<style>${css}</style></head><body class="consent"><header class="strip"><div class="wrap"><span class="brand">Lantern Noodle Bar</span><span class="tag">Connecting ${agent} from ${escape(clientHost)}</span></div></header><main><h1>Let ${agent} help with your orders.</h1><p>Lantern Noodle Bar is a fictional test restaurant. Choose a test customer and what the agent may do.</p><form method="post" action="/oauth/authorize"><input type="hidden" name="nonce" value="${escape(nonce)}"><label for="account">Test customer</label><select id="account" name="account">${customers.map((c) => `<option value="${c.id}">${escape(c.name)}</option>`).join("")}</select>${passwordRequired ? '<label for="password">Demo password</label><input id="password" type="password" name="password" required maxlength="256">' : ""}${read ? "<p><strong>See your scheduled orders</strong>: dishes, delivery slot, address and price.</p>" : ""}${write ? `<label class="check" for="write"><input id="write" type="checkbox" name="write" value="yes" checked ${read ? "" : "required"}><span>Propose changes to scheduled orders</span></label><p>Move the slot or add or remove dishes. A change can cost more. You approve every change separately in your agent.</p>` : "<p>Read only: no changes can be proposed.</p>"}<div class="actions"><button class="secondary" name="decision" value="decline" formnovalidate>Don't allow</button><button name="decision" value="approve">Allow</button></div></form><small>Fictional: no food, charges or deliveries. Independent experiment, not affiliated with or endorsed by the authors of the Personal Agent Protocol.</small></main></body></html>`;
}
