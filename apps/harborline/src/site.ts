/** Harborline Bank public, consent and shared portal visual system. */
import {
  labBarHtml,
  labLineHtml,
  labPlaygroundUrl,
  specRefHtml,
} from "@poppy-lab/pap-core";
import {
  accountLast4,
  customers,
  FICTION_NOTICE,
  type CustomerSeed,
} from "./data.ts";
import { isFdxScope, scopes, type HarborlineScope } from "./scopes.ts";

export const escape = (value: string) =>
  value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
/** Money as a bank statement prints it: a real minus sign before the symbol. */
const money = (cents: number) =>
  `${cents < 0 ? "−" : ""}$${(Math.abs(cents) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
const fontSources = {
  style: "https://fonts.googleapis.com",
  font: "https://fonts.gstatic.com",
};
export const pageHeaders = {
  "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline' ${fontSources.style}; font-src ${fontSources.font}; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
  "Referrer-Policy": "no-referrer",
};
const fonts = `<link rel="preconnect" href="${fontSources.style}"><link rel="preconnect" href="${fontSources.font}" crossorigin><link href="${fontSources.style}/css2?family=Barlow+Condensed:wght@600;700;800&family=Public+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">`;
const css = `
:root{color-scheme:light;--paper:#f4f7f5;--white:#fff;--ink:#0d2638;--soft:#3d5666;--muted:#566d79;--rule:#c9d4d5;--channel:#073b5c;--deep:#062b43;--orange:#ed6b2f;--glass:#b8ddd4;--glass-dark:#1f6e65;--danger:#a7352c;--display:"Barlow Condensed","Arial Narrow",sans-serif;--body:"Public Sans",Arial,sans-serif}
*{box-sizing:border-box}html{background:var(--paper);scroll-behavior:smooth}body{margin:0;color:var(--ink);font:400 16px/1.55 var(--body);-webkit-font-smoothing:antialiased}a{color:inherit;text-underline-offset:.22em;text-decoration-thickness:1px}a:hover{text-decoration-thickness:2px}button,input,select{font:inherit}::selection{background:var(--glass);color:var(--deep)}:focus-visible{outline:3px solid var(--orange);outline-offset:3px}.wrap{width:min(1180px,100% - 2*clamp(18px,4vw,52px));margin-inline:auto}.mast{background:var(--channel);color:#fff;box-shadow:inset 0 -5px var(--orange)}.mast .wrap{min-height:68px;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:28px}.brand{font:800 27px/1 var(--display);letter-spacing:.025em;text-transform:uppercase;text-decoration:none}.mast nav{display:flex;gap:24px;justify-self:center;font-weight:600;font-size:14px}.mast nav a{text-decoration:none}.mast nav a[aria-current]{text-decoration:underline;text-decoration-thickness:2px}.mast-login{display:inline-flex;align-items:center;min-height:40px;padding:0 16px;border:1px solid rgba(255,255,255,.45);border-radius:4px;font-weight:700;font-size:14px;text-decoration:none}.mast-login:hover,.mast-login[aria-current]{background:#fff;color:var(--channel)}.hero{display:grid;grid-template-columns:minmax(0,.85fr) minmax(540px,1.15fr);gap:clamp(36px,6vw,92px);align-items:center;padding:clamp(48px,8vw,96px) 0 clamp(42px,7vw,80px)}.hero h1{font:800 clamp(50px,6.6vw,92px)/.92 var(--display);letter-spacing:-.02em;text-transform:uppercase;margin:0 0 24px;max-width:10ch}.hero .lead{font-size:clamp(18px,2vw,23px);line-height:1.42;max-width:45ch;margin:0;color:var(--soft)}.hero .warning,.consent .warning{margin:20px 0 0;padding:12px 0;border-block:1px solid var(--rule);font-size:14px;color:var(--soft);max-width:56ch}.hero .warning strong,.consent .warning strong{color:var(--danger)}.agent-cta{display:flex;flex-wrap:wrap;align-items:center;gap:12px 24px;margin-top:28px}.actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:28px}.button,.account button{display:inline-flex;min-height:48px;align-items:center;justify-content:center;padding:0 20px;border:1px solid var(--channel);background:var(--channel);color:#fff;text-decoration:none;font-weight:700;cursor:pointer;border-radius:4px}.button:hover,.account button:hover{background:var(--deep)}.button.primary{background:var(--orange);border-color:var(--orange);color:var(--deep)}.button.primary:hover{background:#f07b45}.button.secondary,.account button.secondary{background:transparent;color:var(--channel);border-color:var(--rule)}.button.secondary:hover,.account button.secondary:hover{background:var(--white)}.ledger{background:var(--white);border:1px solid #aebfc2;box-shadow:0 24px 48px -38px rgba(6,43,67,.55);position:relative}.ledger:before{content:"";display:block;height:12px;background:var(--glass);border-bottom:1px solid #83b8ad}.ledger-head{display:flex;justify-content:space-between;gap:20px;padding:18px 22px 14px;border-bottom:2px solid var(--channel)}.ledger-head strong{font:800 24px/1 var(--display);text-transform:uppercase}.ledger-head span{font-size:12px;color:var(--muted);text-align:right}.ledger-section{padding:0 22px}.ledger-row{display:grid;grid-template-columns:1.4fr .8fr auto;gap:16px;align-items:center;padding:15px 0;border-bottom:1px solid var(--rule)}.ledger-row:last-child{border-bottom:0}.ledger-label{font-weight:700}.ledger-label small{display:block;color:var(--muted);font-weight:400}.amount{font-variant-numeric:tabular-nums;font-weight:700;text-align:right}.status{display:inline-flex;align-items:center;gap:7px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em}.status:before{content:"";width:8px;height:8px;border-radius:50%;background:var(--glass-dark)}.status.frozen:before{background:var(--orange)}.chart-line{height:7px;background:#dfe8e6;position:relative;margin-top:8px}.chart-line span{position:absolute;inset:0 auto 0 0;background:var(--glass-dark)}.ledger-note{padding:15px 22px;background:#eef5f3;border-top:1px solid var(--rule);font-size:13px;color:var(--soft)}.section{padding:clamp(42px,7vw,82px) 0;border-top:1px solid var(--rule)}.section h2{font:800 clamp(38px,5vw,64px)/.98 var(--display);text-transform:uppercase;letter-spacing:-.015em;margin:0 0 24px;max-width:14ch}.section-intro{max-width:70ch;color:var(--soft);margin:0 0 30px;font-size:18px}.manifest{box-shadow:inset 0 3px var(--channel);padding-top:3px}.manifest-row{display:grid;grid-template-columns:180px minmax(0,1fr) minmax(220px,.55fr);gap:28px;padding:22px 0;border-bottom:1px solid var(--rule);align-items:start}.manifest-row h3{font:700 23px/1.1 var(--display);text-transform:uppercase;margin:0}.manifest-row p{margin:0;color:var(--soft)}.manifest-row code,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.88em;overflow-wrap:anywhere}.manifest-row .mark{font-weight:700;color:var(--glass-dark)}.personas{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;background:var(--rule);border:1px solid var(--rule)}.persona{background:var(--white);padding:24px}.persona h3{font:800 29px/1 var(--display);text-transform:uppercase;margin:0 0 12px}.persona dl{margin:0}.persona dl div{display:flex;justify-content:space-between;gap:20px;padding:9px 0;border-bottom:1px solid #e3e9e9}.persona dt{color:var(--muted)}.persona dd{margin:0;text-align:right;font-variant-numeric:tabular-nums;font-weight:600}.notice-band{background:var(--orange);color:var(--deep);padding:18px 0;font-weight:800}.notice-band p{margin:0}.table-wrap{overflow:auto;border:1px solid var(--rule);background:var(--white)}table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:13px 15px;border-bottom:1px solid var(--rule);vertical-align:top}thead th{font:700 13px var(--display);text-transform:uppercase;letter-spacing:.04em;background:#e8efef}tbody th{white-space:nowrap}footer{background:var(--deep);color:#d9e6ea;padding:34px 0;font-size:14px}footer p{margin:0;max-width:85ch}footer p+p{margin-top:10px}footer a{color:#fff}.lab{border-top:1px solid rgba(255,255,255,.16);padding-top:14px;margin-top:16px}.consent main{width:min(850px,100% - 2*clamp(18px,5vw,48px));margin:auto;padding:clamp(40px,7vw,78px) 0}.consent h1{font:800 clamp(45px,7vw,76px)/.92 var(--display);text-transform:uppercase;letter-spacing:-.02em;margin:0 0 18px;max-width:12ch}.consent .intro-copy{max-width:62ch;color:var(--soft);font-size:18px}.consent form{margin-top:32px;box-shadow:inset 0 3px var(--channel);padding-top:3px}.consent fieldset{border:0;margin:0;padding:24px 0;border-bottom:1px solid var(--rule)}.consent legend{font:700 24px var(--display);text-transform:uppercase;padding:0 20px 0 0}.consent label.block{display:block;font-weight:700;margin-bottom:8px}.consent select,.consent input[type=password]{width:100%;min-height:48px;border:1px solid var(--rule);background:#fff;padding:10px 12px;color:var(--ink)}.permission{display:grid;grid-template-columns:24px 1fr;gap:12px;padding:12px 0}.permission input{width:20px;height:20px;margin:2px 0 0;accent-color:var(--channel)}.permission strong{display:block}.permission span{display:block;color:var(--soft);font-size:14px}.permission.readonly{grid-template-columns:12px 1fr}.permission.readonly:before{content:"";width:8px;height:8px;border-radius:50%;background:var(--glass-dark);margin-top:8px}.consent .actions{display:flex;justify-content:flex-end;gap:12px;padding-top:24px}.consent button{min-height:48px;padding:0 22px;border:1px solid var(--channel);background:var(--channel);color:#fff;font-weight:700;cursor:pointer}.consent button.secondary{background:transparent;color:var(--channel);border-color:var(--rule)}.fine{font-size:13px;color:var(--muted)}.form-card{max-width:620px;background:var(--white);border:1px solid var(--rule);padding:24px}.form-card label{display:block;font-weight:700;margin-bottom:8px}.form-card select{width:100%;min-height:48px;margin-bottom:16px;border:1px solid var(--rule);padding:10px 12px;background:#fff}.account-head{padding:44px 0 26px}.account-head h1{font:800 clamp(44px,6vw,76px)/.94 var(--display);text-transform:uppercase;margin:0 0 12px}.account-head p{margin:6px 0;color:var(--soft)}.live-row{display:flex;justify-content:space-between;align-items:center;gap:18px;flex-wrap:wrap;margin-top:20px}.live{color:var(--glass-dark);font-weight:700}.error{color:var(--danger);font-weight:700}.account-grid{display:grid;grid-template-columns:1.1fr .9fr;gap:36px}.account .section{padding:32px 0}.account .section h2{font-size:36px;margin-bottom:18px}.data-list{border-top:2px solid var(--channel)}.data-row{padding:15px 0;border-bottom:1px solid var(--rule)}.data-row header{display:flex;justify-content:space-between;gap:16px;align-items:baseline}.data-row h3{font:700 21px/1.1 var(--display);text-transform:uppercase;margin:0}.data-row p{margin:6px 0 0;color:var(--soft);font-size:14px}.data-row .amount{white-space:nowrap}.activity{padding:14px 0;border-bottom:1px solid var(--rule)}.activity strong{display:block}.activity p{margin:4px 0 0;color:var(--soft)}.records{list-style:none;margin:0;padding:0;border-top:1px solid var(--rule)}.record{display:grid;gap:6px;padding:16px 0 18px;border-bottom:1px solid var(--rule);overflow-wrap:anywhere}.record-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:6px 16px}.record-when{font-size:13px;color:var(--muted);font-variant-numeric:tabular-nums}.record-title{margin:4px 0 0;max-width:65ch}.record-body{margin:0;max-width:65ch;font-size:15px;line-height:1.55}.record-meta{margin:0;font-size:13px;color:var(--muted)}.record[data-tone=muted] .record-tag{background:transparent;color:var(--muted);box-shadow:inset 0 0 0 1px var(--rule)}.record-tag{font:700 13px/1 var(--display);letter-spacing:.08em;text-transform:uppercase;padding:5px 8px 4px;border-radius:2px;background:var(--glass);color:#0f4a43}.record[data-tone=pending] .record-tag{background:#fde3d6;color:#9a3a10}.record[data-tone=info] .record-tag{background:#dde8ef;color:var(--channel)}.record-title{font:600 16px/1.4 var(--body);color:var(--ink)}.record-body{color:var(--soft)}.account button:disabled{opacity:.55;cursor:wait}
@media(max-width:900px){.mast .wrap{grid-template-columns:1fr auto}.mast nav{grid-column:1/-1;grid-row:2;justify-self:start;padding-bottom:12px}.hero{grid-template-columns:1fr}.hero h1{max-width:10ch}.account-grid{grid-template-columns:1fr}.manifest-row{grid-template-columns:140px 1fr}.manifest-row .mark{grid-column:2}.personas{grid-template-columns:1fr}}
@media(max-width:560px){.mast .wrap{gap:12px}.mast nav{gap:14px;font-size:12px}.brand{font-size:23px}.hero{padding-top:38px}.hero h1{font-size:54px}.ledger-row{grid-template-columns:1fr auto}.ledger-row .status{grid-column:1/-1}.manifest-row{grid-template-columns:1fr;gap:8px}.manifest-row .mark{grid-column:auto}.consent .actions{flex-wrap:wrap}.consent .actions button{flex:1}.personas{display:block}.persona+.persona{border-top:1px solid var(--rule)}}
`;
export function shell(
  title: string,
  body: string,
  current: "/" | "/for-agents" | "/account",
  origin: string,
) {
  const nav = (
    [
      ["/", "Personal banking"],
      ["/for-agents", "For agents"],
    ] as const
  )
    .map(
      ([href, label]) =>
        `<a href="${href}"${href === current ? ' aria-current="page"' : ""}>${label}</a>`,
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title>${fonts}<style>${css}</style></head><body>${labBarHtml(origin, "Harborline Bank")}<header class="mast"><div class="wrap"><a class="brand" href="/">Harborline Bank</a><nav aria-label="Site">${nav}</nav><a class="mast-login" href="/account"${current === "/account" ? ' aria-current="page"' : ""}>Customer portal</a></div></header>${body}<footer><div class="wrap"><p><strong>Harborline Bank is entirely fictional.</strong> No real money moves, no financial service is provided, and no real banking data or credentials should be entered.</p><p>Independent Poppy Lab example, not affiliated with or endorsed by any real bank or by the authors of the Personal Agent Protocol. “Personal Agent Protocol” and “Poppy” are their names.</p>${labLineHtml(origin, "harborline")}</div></footer></body></html>`;
}

const sampleLedger = (customer: CustomerSeed) => {
  const accountRows = customer.accounts
    .map(
      (account) =>
        `<div class="ledger-row"><div class="ledger-label">${escape(account.name)}<small>${account.type}</small></div><div class="amount">${money(account.available_cents)}</div><span class="status">${account.status}</span></div>`,
    )
    .join("");
  const transaction = customer.transactions[0]!;
  const card = customer.cards[0]!;
  const budget = customer.budgets[0]!;
  const used = Math.min(
    100,
    Math.round((budget.spent_cents / budget.limit_cents) * 100),
  );
  return `<div class="ledger" aria-label="Sample fictional account ledger"><div class="ledger-head"><strong>${escape(customer.name)}'s accounts</strong><span>Sample customer<br>USD</span></div><div class="ledger-section">${accountRows}<div class="ledger-row"><div class="ledger-label">Recent: ${escape(transaction.description)}<small>${transaction.category} · ${transaction.status}</small></div><div class="amount">${money(transaction.amount_cents)}</div><span class="status">posted</span></div><div class="ledger-row"><div class="ledger-label">Card ending ${card.last4}<small>${escape(card.label)}</small></div><div class="amount">${money(card.spent_today_cents)} today</div><span class="status ${card.status}">${card.status}</span></div><div class="ledger-row"><div class="ledger-label">${escape(budget.name)} budget<small>${escape(budget.month)} · ${used}% used</small><div class="chart-line" aria-hidden="true"><span style="width:${used}%"></span></div></div><div class="amount">${money(budget.spent_cents)} / ${money(budget.limit_cents)}</div><span class="status">tracking</span></div></div><div class="ledger-note">A sample customer. The portal and a connected agent always see the same accounts.</div></div>`;
};

export function homePage(origin: string) {
  const sample = customers[0]!;
  const body = `<main><section class="wrap hero"><div><h1>Banking that waits for your say-so.</h1><p class="lead">Checking, savings, cards and budgets in one clear ledger. Use the customer portal yourself, or let your personal agent keep watch and propose payments that only go through when you approve them.</p><div class="actions"><a class="button primary" href="/account">Open the customer portal</a><a class="button secondary" href="#agents">Bank with your agent</a></div><p class="warning"><strong>No real money moves.</strong> Never enter real bank details, account numbers, passwords, card data or credentials.</p></div>${sampleLedger(sample)}</section><section class="wrap section"><h2>Everyday banking.</h2><p class="section-intro">Everything you would expect from your bank, in the portal or through your agent.</p><div class="manifest"><div class="manifest-row"><h3>See where you stand</h3><p>Accounts and balances, recent transactions, cards, saved recipients and monthly budgets.</p><span class="mark">Always up to date</span></div><div class="manifest-row"><h3>Stay organised</h3><p>Freeze or unfreeze a card, move a transaction to another category, and set or adjust a budget.</p><span class="mark">Easy to undo</span></div><div class="manifest-row"><h3>Move money</h3><p>Pay a saved recipient or transfer between your own accounts. Balance and limits are checked again at the moment you confirm.</p><span class="mark">Confirmed by you</span></div></div></section><section class="wrap section" id="agents"><h2>Bank with your personal agent.</h2><p class="section-intro">Harborline works with personal AI agents. Yours can answer “how much did I spend on groceries?” or get a transfer ready, and you stay in charge of every change.</p><div class="manifest"><div class="manifest-row"><h3>You choose what it sees</h3><p>You sign in here, on Harborline's own page, and pick what the agent may read. It never gets your password.</p><span class="mark">Your sign-in</span></div><div class="manifest-row"><h3>It proposes, you approve</h3><p>A payment or transfer arrives as an exact proposal: amount, recipient and account. Nothing leaves until you approve it, and it happens once.</p><span class="mark">Your approval</span></div><div class="manifest-row"><h3>You can disconnect it</h3><p>The customer portal lists the agents connected to your account and what each may do.</p><span class="mark">Your call</span></div></div><div class="agent-cta"><a class="button primary" href="${labPlaygroundUrl(origin)}">Try it with Iris, the demo agent</a><a href="/for-agents">Technical details for agent builders</a></div></section></main>`;
  return shell("Harborline Bank · Personal banking", body, "/", origin);
}

const scopePurpose: Record<HarborlineScope, string> = {
  "accounts:read": "Owned accounts and balances",
  "transactions:read": "Recent transactions and categories",
  "cards:read": "Cards, masked digits, status and limits",
  "recipients:read": "Existing masked payment recipients",
  "budgets:read": "Monthly budgets and simulated spend",
  "cards:write": "Freeze or unfreeze a card",
  "transactions:write": "Change a posted transaction category",
  "budgets:write": "Create or update a budget",
  "payments:request": "Request an outgoing payment",
  "transfers:request": "Transfer between owned accounts",
  "fdx:ACCOUNT_BASIC": "FDX-shaped: chosen accounts, no balances",
  "fdx:ACCOUNT_DETAILED": "FDX-shaped: balances of chosen accounts",
  "fdx:TRANSACTIONS": "FDX-shaped: transactions of chosen accounts",
  "fdx:STATEMENTS": "FDX-shaped: monthly PDF statements of chosen accounts",
  "fdx:CUSTOMER_CONTACT": "FDX-shaped: customer name and email",
  offline_access: "Refresh the fictional grant while away",
};

export function forAgentsPage(origin: string) {
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
    ["OpenAPI", `${origin}/openapi.json`, "§7"],
    [
      "FDX-shaped API (not FDX-conformant)",
      `${origin}/fdx/v6 · ${origin}/openapi/fdx.json · Poppy-Extensions: "poppylab.dev/fdx";v="1"`,
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
  const body = `<main class="wrap"><section class="section"><h2>Point a Poppy 1.0 agent at Harborline.</h2><p class="section-intro">Harborline accepts any HTTPS client metadata document with valid redirect URIs and ES256 or PS384 keys. The local plain-HTTP exception is only for Iris at localhost. Every public visitor receives a separate copy of the fictional customers.</p><div class="table-wrap"><table><thead><tr><th>Capability</th><th>Endpoint or header</th><th>Spec</th></tr></thead><tbody>${rows.map(([name, where, spec]) => `<tr><th>${escape(name)}</th><td><code>${escape(where)}</code></td><td>${specRefHtml(spec)}</td></tr>`).join("")}</tbody></table></div></section><section class="section"><h2>Two test customers.</h2><p class="section-intro">Choose either one on Harborline's consent page or in the portal. The portal and the APIs read the same state.</p><div class="personas">${customers.map((customer) => `<article class="persona"><h3>${escape(customer.name)}</h3><dl><div><dt>Accounts</dt><dd>${customer.accounts.length}</dd></div><div><dt>Total balance</dt><dd>${money(customer.accounts.reduce((sum, account) => sum + account.balance_cents, 0))}</dd></div><div><dt>Cards</dt><dd>${customer.cards.map((card) => `${card.last4} · ${card.status}`).join(", ")}</dd></div><div><dt>Recipients</dt><dd>${customer.recipients.length}</dd></div></dl></article>`).join("")}</div></section><section class="section"><h2>Scopes are deliberately narrow.</h2><div class="manifest">${scopes.map((scope) => `<div class="manifest-row"><h3><code>${scope}</code></h3><p>${escape(scopePurpose[scope])}</p><span class="mark">${scope.endsWith(":request") ? "irreversible" : scope.endsWith(":write") ? "reversible" : scope === "offline_access" ? "offline" : "read only"}</span></div>`).join("")}</div></section><section class="section"><h2>Suggested protocol runs.</h2><div class="manifest"><div class="manifest-row"><h3>Read</h3><p>“Show my account balances, latest transactions, cards, recipients and budgets.” The keyless Protocol demo can deterministically call no-argument read tools.</p><span class="mark">No approval</span></div><div class="manifest-row"><h3>Reversible</h3><p>“Freeze my active card ending 1842,” “categorize North Pier Grocer as dining,” or “raise my Software budget to $300.”</p><span class="mark">Exact approval</span></div><div class="manifest-row"><h3>Irreversible</h3><p>“Send Beacon Studio $125 for November design work,” or “transfer $500 from checking to savings.” Read current state first; use a stable idempotency key.</p><span class="mark">Exact approval</span></div></div><p class="fine">${escape(FICTION_NOTICE)}</p></section></main>`;
  return shell("For agents · Harborline Bank", body, "/for-agents", origin);
}

const permissionText: Record<HarborlineScope, string> = {
  "accounts:read":
    "See account names, types, balances, available balances and status.",
  "transactions:read":
    "See transaction descriptions, signed amounts, dates, status and categories.",
  "cards:read":
    "See card labels, last four digits, status, limits and linked account.",
  "recipients:read":
    "See existing recipients with fictional bank labels and masked account digits.",
  "budgets:read":
    "See budget names, categories, limits and simulated spending.",
  "cards:write":
    "Propose freezing or unfreezing a card. Each proposal needs separate approval.",
  "transactions:write":
    "Propose changing a posted transaction's category. Each proposal needs separate approval.",
  "budgets:write":
    "Propose creating or changing budgets. Each proposal needs separate approval.",
  "payments:request":
    "Propose an outgoing payment to an existing recipient. Treated as irreversible after approval.",
  "transfers:request":
    "Propose a transfer between owned accounts. Treated as irreversible after approval.",
  "fdx:ACCOUNT_BASIC":
    "Through the FDX-shaped API, see the accounts you choose below: type, name, masked number and status.",
  "fdx:ACCOUNT_DETAILED":
    "Through the FDX-shaped API, also see current and available balances of the accounts you choose.",
  "fdx:TRANSACTIONS":
    "Through the FDX-shaped API, see transactions of the accounts you choose.",
  "fdx:STATEMENTS":
    "Through the FDX-shaped API, list and download monthly PDF statements of the accounts you choose: balances and posted transactions.",
  "fdx:CUSTOMER_CONTACT":
    "Through the FDX-shaped API, see the customer's name and email.",
  offline_access:
    "Refresh this fictional grant after the current access token expires.",
};

/**
 * The accounts shared through the FDX-shaped API, per persona. Without
 * scripts (the consent CSP allows none), CSS `:has()` shows only the chosen
 * persona's accounts and hides "Allow" until one is ticked; a browser
 * without `:has()` shows every persona's, and the server keeps only the
 * chosen persona's (`selectResources`). One field name per account, since
 * the form keeps only the last value of a repeated name.
 */
const fdxAccounts = () =>
  `<fieldset><legend>Accounts for the FDX-shaped API</legend>${customers
    .map(
      (customer) =>
        `<div class="fdx-persona" data-persona="${escape(customer.id)}"><p class="fdx-owner">${escape(customer.name)}</p>${customer.accounts
          .map(
            (account) =>
              `<label class="permission" for="fdx-${escape(account.id)}"><input id="fdx-${escape(account.id)}" type="checkbox" name="fdx_account_${escape(account.id)}" value="yes" checked><span><strong>${escape(account.name)}</strong><span>${account.type} · ending ${accountLast4(account.id)}</span></span></label>`,
          )
          .join("")}</div>`,
    )
    .join(
      "",
    )}<p class="fdx-empty">Choose at least one account to allow this access, or don't allow it.</p><p class="fine">Only these accounts are visible through the FDX-shaped API. Harborline's own API scopes, if requested above, are not limited by this choice. FDX-shaped, not FDX-conformant or certified.</p></fieldset>`;
/** The persona's accounts only, and no "Allow" with none ticked. */
const fdxStyle = () => {
  const when = (id: string) =>
    `form:has(#account option[value="${id}"]:checked)`;
  const none = (id: string) =>
    `${when(id)}:not(:has(.fdx-persona[data-persona="${id}"] input:checked))`;
  return `.fdx-owner{margin:8px 0 0;font-weight:700}.fdx-empty{display:none;color:var(--danger);font-weight:700}@supports selector(:has(a)){.fdx-persona,.fdx-owner{display:none}${customers
    .map(
      ({ id }) =>
        `${when(id)} .fdx-persona[data-persona="${id}"]{display:block}${none(id)} .fdx-empty{display:block}${none(id)} button[value=approve]{display:none}`,
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
  const requested = input.scopes.split(" ") as HarborlineScope[];
  const read = requested.filter(
    (scope) =>
      !scope.endsWith(":write") &&
      !scope.endsWith(":request") &&
      scope !== "offline_access",
  );
  const changes = requested.filter(
    (scope) => scope.endsWith(":write") || scope.endsWith(":request"),
  );
  const offline = requested.includes("offline_access");
  const fdx = requested.some(isFdxScope);
  const agent = escape(input.client);
  const permissions = read
    .map(
      (scope) =>
        `<div class="permission readonly"><div><strong>${escape(scopePurpose[scope])}</strong><span>${escape(permissionText[scope])}</span></div></div>`,
    )
    .join("");
  const changePermissions = changes
    .map(
      (scope) =>
        `<label class="permission" for="allow-${scope}"><input id="allow-${scope}" type="checkbox" name="allow_${scope.replace(/[:_]/g, "_")}" value="yes" checked><span><strong>${escape(scopePurpose[scope])}</strong><span>${escape(permissionText[scope])}</span></span></label>`,
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Allow ${agent} · Harborline Bank</title>${fonts}<style>${css}${fdx ? fdxStyle() : ""}</style></head><body class="consent"><header class="mast"><div class="wrap"><span class="brand">Harborline Bank</span><span></span><span class="fiction-tag">Connecting ${agent}<br>verified host ${escape(input.clientHost)}</span></div></header><main><h1>Choose the fictional records ${agent} may use.</h1><p class="intro-copy">This is Harborline's own consent page. Select a test customer. Read scopes expose invented personal financial data; change scopes only let the agent propose exact Operations v3 terms that you approve separately.</p><p class="warning"><strong>No real account exists.</strong> Never enter a real banking password, account number, card number or financial information.</p><form method="post" action="/oauth/authorize"><input type="hidden" name="nonce" value="${escape(input.nonce)}"><fieldset><legend>Fictional customer</legend><label class="block" for="account">Persona</label><select id="account" name="account">${customers.map((customer) => `<option value="${customer.id}">${escape(customer.name)}</option>`).join("")}</select>${input.passwordRequired ? '<label class="block" for="password">Dedicated demo password</label><input id="password" type="password" name="password" required maxlength="256"><p class="fine">Use only the dedicated password configured for this demo.</p>' : '<p class="fine">Persona selection is not real identity verification.</p>'}</fieldset><fieldset><legend>Read access</legend>${permissions || '<p class="fine">No read scope was requested.</p>'}</fieldset>${fdx ? fdxAccounts() : ""}${changes.length ? `<fieldset><legend>Change proposals</legend>${changePermissions}<p class="fine">These permissions do not approve a payment, transfer or other change. Your agent must show each exact operation separately.</p></fieldset>` : ""}${offline ? `<fieldset><legend>Offline access</legend><label class="permission" for="allow-offline"><input id="allow-offline" type="checkbox" name="allow_offline" value="yes"><span><strong>Keep the fictional grant refreshable</strong><span>${escape(permissionText.offline_access)} Optional and off by default.</span></span></label></fieldset>` : ""}<div class="actions"><button class="secondary" name="decision" value="decline" formnovalidate>Don't allow</button><button name="decision" value="approve">Allow selected access</button></div></form><p class="fine">${escape(FICTION_NOTICE)} Independent experiment; no claim of banking or Poppy conformance.</p></main></body></html>`;
}
