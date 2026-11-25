/**
 * Lantern Noodle Bar's website: the ticket machine at the shop door. Read
 * only and server-rendered with no JavaScript. The menu and slots come from
 * the same arrays the API serves, so the page and the agent never disagree.
 * The consent page shares the visual system.
 */
import {
  annotatedJsonHtml,
  approvalSequenceSvg,
  breakablePath,
  consentSheetCss,
  consentSheetHtml,
  guideOperations,
  howItWorksLayoutCss,
  labBarHtml,
  labConsentBarHtml,
  labLineHtml,
  labPlaygroundUrl,
  specRefHtml,
  type GuidePaths,
} from "@poppy-lab/pap-core";
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
  "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline' ${fontSources.style}; img-src 'self'; font-src ${fontSources.font}; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
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
.btn .photo{display:block;width:calc(100% + 32px);height:auto;max-width:none;margin:-16px -16px 0;aspect-ratio:4/3;object-fit:cover;border-radius:9px 9px 0 0;border-bottom:1px solid var(--tile-edge)}
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
article.activity p{margin:0;color:var(--ink-soft);font-size:15px}.records{list-style:none;margin:0;padding:0;border-top:1px solid var(--rule)}.record{display:grid;gap:6px;padding:16px 0 18px;border-bottom:1px solid var(--rule);overflow-wrap:anywhere}.record-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:6px 16px}.record-when{font-size:13px;color:var(--muted);font-variant-numeric:tabular-nums}.record-title{margin:4px 0 0;max-width:65ch}.record-body{margin:0;max-width:65ch;font-size:15px;line-height:1.55}.record-meta{margin:0;font-size:13px;color:var(--muted)}.record[data-tone=muted] .record-tag{background:transparent;color:var(--muted);box-shadow:inset 0 0 0 1px var(--rule)}.record-tag{font:600 12px/1 var(--mono);letter-spacing:.04em;text-transform:uppercase;padding:6px 8px 5px;border-radius:3px;background:var(--panel);color:var(--tile)}.record[data-tone=pending] .record-tag{background:var(--amber);color:var(--ink)}.record[data-tone=info] .record-tag{background:var(--tile);color:var(--ink);box-shadow:inset 0 0 0 1px var(--amber)}.record-when{font-family:var(--mono)}.record-title{font:700 17px/1.35 var(--body);color:var(--ink)}.record-body{color:var(--ink-soft)}
.intro.wide h1{max-width:20ch;font-size:clamp(40px,6.4vw,84px)}
.intro.wide p{max-width:70ch}
.agents{padding:0 0 clamp(40px,6vw,64px)}
.agents.steps{padding-bottom:0}
.more{margin:20px 0 0;font:700 14px var(--mono)}
.step .num{font:900 clamp(56px,7vw,88px)/.85 var(--display);color:var(--red)}
.step h2{font:900 clamp(26px,3vw,36px)/1 var(--display);text-transform:uppercase;letter-spacing:.02em;margin:14px 0 10px}
.step .say{color:var(--ink-soft)}
.how{--how-rule:var(--rule);--how-mark:var(--amber);--how-mark-ink:var(--ink)}
.mark{font-family:var(--mono)}
.keys{color:var(--ink-soft)}
.keys strong{color:var(--ink)}
.doc{background:var(--panel);color:var(--tile);border-radius:14px}
.doc-head{border-bottom:1px solid rgba(255,255,255,.12);font:700 13px var(--mono)}
.doc-head span{font-weight:400;color:#b9c0cc}
.doc pre{font-family:var(--mono)}
.doc .ln.hit{background:rgba(228,161,27,.16)}
.doc .k{color:#f3c96a}
.ops{background:var(--panel);color:var(--tile);border-radius:18px;padding:clamp(16px,2.4vw,24px);display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0 12px}
.zone{grid-column:span var(--n);grid-row:span 2;display:grid;grid-template-rows:subgrid;gap:0}
.zone.n1{--n:1}.zone.n2{--n:2}.zone.n3{--n:3}
.zone .cap{padding:0 0 10px;margin-bottom:12px;border-bottom:1px solid rgba(255,255,255,.2)}
.zone:nth-child(n+2) .cap{margin-top:22px}
.zone h3{font:900 20px/1.05 var(--display);text-transform:uppercase;letter-spacing:.04em;margin:0 0 6px}
.zone .who{font:400 12px/1.45 var(--mono);color:#b9c0cc;margin:0}
.zone ul{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(var(--n),minmax(0,1fr));gap:12px}
.op{position:relative;background:var(--tile);color:var(--ink);border:1px solid var(--tile-edge);border-radius:10px;padding:14px 14px 12px;display:grid;gap:8px;align-content:start}
.op .n{position:absolute;top:10px;right:12px;font:700 12px var(--mono);color:var(--muted)}
.op .name{font:800 22px/1.05 var(--display);text-transform:uppercase;letter-spacing:.01em;padding-right:28px}
.op .path{justify-self:start;font:700 12px/1.35 var(--mono);background:var(--ink);color:#fff;padding:4px 7px;border-radius:3px;overflow-wrap:break-word}
.op .sum{margin:0;font-size:13px;line-height:1.4;color:var(--ink-soft)}
.op.lit{box-shadow:0 0 0 3px var(--amber-glow),0 0 18px 2px var(--amber-glow)}
.ticket{margin-top:24px;max-width:340px;background:var(--tile);border:1px solid var(--tile-edge);border-radius:6px;font:400 13px/1.5 var(--mono);color:var(--ink)}
.ticket .top{padding:14px 16px 10px;text-align:center;border-bottom:2px dashed var(--rule)}
.ticket .top strong{display:block;font:900 22px/1 var(--display);text-transform:uppercase;letter-spacing:.04em}
.ticket dl{margin:0;padding:10px 16px 12px}
.ticket dl div{display:flex;justify-content:space-between;gap:12px;padding:3px 0}
.ticket dt{color:var(--ink-soft)}
.ticket dd{margin:0;text-align:right;font-weight:700}
.ticket .new dt,.ticket .new dd{background:var(--amber);box-shadow:0 0 0 2px var(--amber)}
.ticket .was dd{font-weight:400;text-decoration:line-through;color:var(--muted)}
.ticket .rule{border-top:1px solid var(--rule);margin-top:6px;padding-top:8px}
.ticket .stamp{margin:0 16px;padding:6px 8px;border:2px solid var(--amber);font-weight:700;text-align:center;letter-spacing:.06em;text-transform:uppercase}
.ticket .where{margin:0;padding:10px 16px 14px;text-align:center;font-size:12px;color:var(--ink-soft)}
.seq figcaption{margin-top:10px;font-size:14px;color:var(--muted);max-width:60ch}
.sq-head{font:800 17px var(--display);letter-spacing:.04em;text-transform:uppercase}
.sq-label{font:700 12px var(--mono);letter-spacing:.04em;text-transform:uppercase}
.faq-title{font:900 clamp(24px,2.6vw,32px)/1 var(--display);text-transform:uppercase;letter-spacing:.02em;margin:0;padding-top:clamp(24px,4vw,40px);border-top:1px solid var(--rule)}
.faq dt{font:800 20px/1.15 var(--display);text-transform:uppercase;letter-spacing:.02em;margin:0 0 6px}
.faq dd{color:var(--ink-soft);font-size:15px}
@media(max-width:640px){.sq-head{font-size:15px}.ops{grid-template-columns:minmax(0,1fr)}.zone{--n:1!important;grid-row:auto;grid-template-rows:none}.zone .cap{margin-top:22px}.zone:first-child .cap{margin-top:0}}
@media(max-width:900px){.buttons{grid-template-columns:repeat(2,minmax(0,1fr))}.buttons.slots{grid-template-columns:repeat(2,minmax(0,1fr))}.cols{grid-template-columns:1fr}.tray{grid-template-columns:1fr}.tray .cta{justify-self:start}}
@media(max-width:560px){.strip .wrap{flex-wrap:wrap;row-gap:8px}.strip nav{width:100%;gap:14px;font-size:12px;white-space:nowrap}.quantities{grid-template-columns:1fr}.strip .tag{display:none}.btn{min-height:104px;padding:14px}.customers{grid-template-columns:1fr}}
${howItWorksLayoutCss}${consentSheetCss}.sheet{--sheet-rule:var(--rule);--sheet-accent:var(--ink)}
.sheet h1{font:900 clamp(34px,5vw,56px)/1 var(--display);text-transform:uppercase;letter-spacing:.01em}
.sheet-agent{color:var(--ink-soft)}.sheet-agent strong{color:var(--ink)}
.sheet-verified{font:700 12px/1 var(--mono);padding:5px 8px;border-radius:3px;background:var(--ink);color:#fff}
.sheet legend,.sheet h2{font:900 26px/1 var(--display);text-transform:uppercase;letter-spacing:.02em}
.sheet-person{border-radius:10px;background:var(--tile);border-color:var(--tile-edge)}
.sheet-person:has(input:checked){border-color:var(--amber);box-shadow:0 0 0 3px var(--amber-glow)}
.sheet-person strong{font:800 20px/1.1 var(--display);text-transform:uppercase;letter-spacing:.01em}
.sheet-person small{font:400 13px var(--mono);margin-top:4px}
.sheet-person small,.sheet-note,.sheet-reads span,.sheet-option span span,.sheet-none,.sheet-foot p{color:var(--ink-soft)}
.sheet-group h3{font:800 19px/1.1 var(--display);text-transform:uppercase;letter-spacing:.02em}
.sheet-group h3 span{font:400 14px var(--body);text-transform:none;letter-spacing:0;color:var(--ink-soft)}
.sheet-reads strong,.sheet-option strong{font-weight:700}
.sheet-field label{font:800 18px var(--display);text-transform:uppercase;letter-spacing:.02em}
.sheet-field input{border:1px solid var(--rule);border-radius:8px;background:#fff;color:var(--ink)}
.sheet button{border-radius:8px;border:1px solid var(--ink);background:var(--ink);color:#fff;font:800 17px var(--display);letter-spacing:.04em;text-transform:uppercase}
.sheet button:hover{background:var(--ink-soft)}
.sheet button.secondary{background:transparent;color:var(--ink);border-color:var(--rule)}
.sheet button.secondary:hover{background:#fff}
.sheet-fine{font-size:13px;color:var(--muted)}
`;

export function shell(
  title: string,
  body: string,
  current: "/" | "/for-agents" | "/account" | "/how-it-works",
  origin: string,
) {
  const nav = (
    [
      ["/", "Menu"],
      ["/for-agents", "For agents"],
      ["/account", "Your account"],
      ["/how-it-works", "How it works"],
    ] as const
  )
    .map(
      ([href, label]) =>
        `<a href="${href}"${href === current ? ' aria-current="page"' : ""}>${label}</a>`,
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>${fonts}<style>${css}</style></head><body>${labBarHtml(origin, "Lantern Noodle Bar")}<header class="strip"><div class="wrap"><a class="brand" href="/">Lantern Noodle Bar</a><nav aria-label="Site">${nav}</nav></div></header>${body}<footer><div class="wrap"><p>Lantern Noodle Bar is a fictional restaurant for testing personal agents. Nothing is sold, charged or delivered.</p><p>Independent experiment, not affiliated with or endorsed by the authors of the Personal Agent Protocol. “Personal Agent Protocol” and “Poppy” are their names.</p>${labLineHtml(origin, "lantern")}</div></footer></body></html>`;
}

const [slotDay, slotTime] = [
  (label: string) => label.split(" ")[0] ?? label,
  (label: string) => label.split(" ").slice(1).join(" "),
];

export type { GuidePaths };
/** What "How it works" shows of the protocol; built in lantern.ts from the objects the endpoints serve. */
export type AgentGuide = {
  discovery: Record<string, unknown>;
  paths: GuidePaths;
  excluded: string[];
  example: {
    ask: string;
    order: string;
    customer: string;
    fromSlot: string;
    toSlot: string;
    items: Array<{
      name: string;
      quantity: number;
      cents: number;
      added: boolean;
    }>;
    deliveryCents: number;
    beforeCents: number;
    afterCents: number;
  };
};

/** The parts of the discovery document the page points at, in the order they appear in it. */
const discoveryKeys: Array<[key: string, title: string, text: string]> = [
  [
    "organization",
    "Who we are.",
    "Our name, and the domain this file was served from.",
  ],
  [
    "auth",
    "Where you sign in.",
    "And the two permissions an agent can ask you for: to see your orders, and to propose changes to them.",
  ],
  [
    "apis",
    "What it can ask the kitchen.",
    "The menu, the delivery slots, your orders and changes to them.",
  ],
  [
    "agent",
    "Who it can talk to.",
    "Lantern's own automated agent, for hours, delivery and a missing dish.",
  ],
  [
    "tasks",
    "What we don't do through agents.",
    "And where an agent tells us what it couldn't do here.",
  ],
  [
    "extensions",
    "Changes wait for you.",
    "A change comes back with its exact terms and is held until you approve it.",
  ],
];

/** The API's operations and the Company's own agent as buttons, grouped by what each needs from the customer. */
function operationZones(guide: AgentGuide) {
  const operations = guideOperations(guide.paths, guide.discovery);
  const zones: Array<[title: string, who: string, list: typeof operations]> = [
    [
      "Anyone",
      "No sign-in. Any agent may press these.",
      operations.filter((o) => !o.signedIn && !o.approval),
    ],
    [
      "After you sign in",
      "Only for the customer who signed in here.",
      operations.filter((o) => o.signedIn && !o.approval),
    ],
    [
      "Needs your approval",
      "Held until you approve.",
      operations.filter((o) => o.approval),
    ],
  ];
  let n = 0;
  return zones
    .filter(([, , list]) => list.length)
    .map(
      ([title, who, list]) =>
        `<div class="zone n${Math.min(list.length, 3)}"><div class="cap"><h3>${title}</h3><p class="who">${who}</p></div><ul>${list
          .map(
            (o) =>
              `<li class="op${o.approval ? " lit" : ""}"><span class="n">${String(++n).padStart(2, "0")}</span><span class="name">${escape(o.name)}</span><span class="path">${breakablePath(o.where)}</span><p class="sum">${escape(o.text)}.</p></li>`,
          )
          .join("")}</ul></div>`,
    )
    .join("");
}

/** The change the customer approves, printed as the shop's ticket. */
function changeTicket(example: AgentGuide["example"]) {
  const difference = example.afterCents - example.beforeCents;
  const dishes = example.items
    .map(
      (item) =>
        `<div${item.added ? ' class="new"' : ""}><dt>${item.added ? "+ " : ""}${item.quantity} × ${escape(item.name)}</dt><dd>${usd(item.cents)}</dd></div>`,
    )
    .join("");
  return `<div class="ticket" role="img" aria-label="Change ticket for order ${escape(example.order)}: delivery moves from ${escape(example.fromSlot)} to ${escape(example.toSlot)}, the new total is ${usd(example.afterCents)}, ${usd(Math.abs(difference))} ${difference >= 0 ? "more" : "less"} than before, waiting for your approval."><div class="top"><strong>Change ticket</strong>${escape(example.order)} · ${escape(example.customer)}</div><dl><div class="was"><dt>Delivery</dt><dd>${escape(example.fromSlot)}</dd></div><div class="new"><dt>Moves to</dt><dd>${escape(example.toSlot)}</dd></div><div class="rule"></div>${dishes}<div><dt>Delivery</dt><dd>${usd(example.deliveryCents)}</dd></div><div class="rule was"><dt>Was</dt><dd>${usd(example.beforeCents)}</dd></div><div><dt>New total</dt><dd>${usd(example.afterCents)}</dd></div><div><dt>Difference</dt><dd>${difference >= 0 ? "+" : "−"} ${usd(Math.abs(difference))}</dd></div></dl><p class="stamp">Waiting for you</p><p class="where">You approve or decline in your agent.</p></div>`;
}

/** The approval as a sequence diagram, in the shop's colours; drawn wide and narrow. */
const approvalSequence = (narrow = false) =>
  approvalSequenceSvg(
    {
      id: "lantern-approval",
      company: "Lantern",
      request: "Change order",
      held: "The ticket waits · nothing has changed",
      ink: "#17202a",
      ground: "#f3efe6",
      paper: "#fbf7ee",
      line: "#d9d2c5",
      accent: "#e4a11b",
    },
    narrow,
  );

/** "How it works": three steps with a personal agent, each showing the real thing, then questions. */
export function howItWorksPage(origin: string, guide: AgentGuide) {
  const { example } = guide;
  const shown = discoveryKeys.filter(([key]) => key in guide.discovery);
  const keys = shown
    .map(
      ([, title, text], i) =>
        `<li><b class="mark">${i + 1}</b><span><strong>${title}</strong> ${text}</span></li>`,
    )
    .join("");
  const cannot = guide.excluded.length
    ? `An agent can&#39;t ${guide.excluded.map((task) => escape(task.charAt(0).toLowerCase() + task.slice(1))).join(" or ")}. It can move an order to another slot instead.`
    : "Nothing is ruled out.";
  const questions: Array<[string, string]> = [
    [
      "Do I have to set anything up?",
      "No. Your agent finds Lantern on its own. To see or change your order you sign in on this site, on a page we show you, and choose what the agent may do.",
    ],
    [
      "What can an agent do without me?",
      "Read the menu, the prices and the delivery slots, and ask our automated agent about hours and delivery. Nothing about you.",
    ],
    [
      "What needs my approval?",
      "Every change to an order. You see the dishes, the slot and the new total first, and the kitchen changes the order once, after you approve.",
    ],
    [
      "Does the agent get my password?",
      'No. You sign in on Lantern&#39;s own page. The agent gets a permission, and you can take it away under <a href="/account">Your account</a>.',
    ],
    [
      "What can&#39;t an agent do here?",
      `${cannot} For anything else, call <span class="mono tel">${PHONE}</span> (a fictional number).`,
    ],
    [
      "Which agents work here?",
      `Any personal agent that follows Personal Agent Protocol 1.0. <a href="${labPlaygroundUrl(origin)}">Iris</a>, the agent of Poppy Lab, is one you can try now. The addresses an agent needs are under <a href="/for-agents">For agents</a>.`,
    ],
  ];
  const body = `<main class="wrap how"><section class="intro wide"><h1>How Lantern works with your agent.</h1><p>Lantern takes orders from personal AI agents through Personal Agent Protocol, an open protocol. It takes three steps. Each is shown here as this site serves it.</p></section><section class="agents steps" aria-label="The three steps"><article class="step"><div><span class="num" aria-hidden="true">01</span><h2>Your agent finds the door</h2><p class="say">Every agent starts at one small file on our site. This is ours, as an agent reads it.</p><ol class="keys">${keys}</ol></div><div class="doc"><p class="doc-head"><code>/.well-known/poppy.json</code><span>as served to every agent</span></p><pre tabindex="0" aria-label="Lantern&#39;s discovery document">${annotatedJsonHtml(
    guide.discovery,
    shown.map(([key]) => key),
  )}</pre></div></article><article class="step"><div><span class="num" aria-hidden="true">02</span><h2>The machine shows it the buttons</h2><p class="say">The file leads to our API, which works like the machine at the door: a few buttons, each with one job. Some are for anyone, some open once you sign in, and one waits for you.</p></div><div class="ops">${operationZones(guide)}</div></article><article class="step"><div><span class="num" aria-hidden="true">03</span><h2>You approve the ticket</h2><p class="say">Ask your agent: <q>${escape(example.ask)}</q> It presses the last button, and the kitchen prints a ticket with the exact change and holds it. Nothing changes until you approve, and then it changes once.</p>${changeTicket(example)}</div><figure class="seq">${approvalSequence()}${approvalSequence(true)}<figcaption>The kitchen answers the first request with the terms, not with the change. The amber step is yours.</figcaption></figure></article></section><section class="agents" aria-labelledby="questions-title"><h2 class="faq-title" id="questions-title">Questions</h2><dl class="faq">${questions.map(([q, a]) => `<div><dt>${q}</dt><dd>${a}</dd></div>`).join("")}</dl></section></main>`;
  return shell(
    "Lantern Noodle Bar · How it works with your agent",
    body,
    "/how-it-works",
    origin,
  );
}

export function homePage(origin: string) {
  const dishes = menu
    .map(
      (d, i) =>
        `<li class="btn"><img class="photo" src="/img/${d.id}.webp" alt="" width="512" height="384"${i < 3 ? "" : ' loading="lazy"'}><span class="n">${String(i + 1).padStart(2, "0")}</span><span class="name">${escape(d.name)}</span><span class="price">${usd(d.price_cents)}</span></li>`,
    )
    .join("");
  const slotButtons = slots
    .map(
      (s) =>
        `<li class="btn slot"><span class="name">${escape(slotDay(s.label))}</span><span class="time">${escape(slotTime(s.label))}</span></li>`,
    )
    .join("");
  const body = `<main class="wrap"><section class="intro"><h1>Noodles on your night, not your to-do list.</h1><p>Six dishes, four delivery slots, one neighbourhood noodle bar. Schedule a delivery for the night you want it, and change the dishes or the slot until the kitchen starts.</p></section><section class="machine" aria-labelledby="machine-title"><div class="head"><h2 id="machine-title">Menu</h2><span>Delivery ${usd(DELIVERY_CENTS)} per order · USD</span></div><ol class="buttons" aria-label="Menu">${dishes}</ol><ol class="buttons slots" aria-label="Delivery slots">${slotButtons}</ol><div class="tray"><p><strong>Order through your agent.</strong> Lantern takes orders from personal AI agents. Yours reads the menu and the slots, gets the change ready, and you approve the exact new total.</p><a class="cta" href="${labPlaygroundUrl(origin)}">Try it with Iris</a></div></section><section class="plain"><h2>How ordering works</h2><div class="cols"><div><h3>1. Your agent reads the menu</h3><p>Dishes, prices and delivery slots are open to any agent. No account is needed for that.</p></div><div><h3>2. You sign in here</h3><p>To see or change your scheduled order, you sign in on Lantern&apos;s own page and choose what your agent may do. It never gets your password.</p></div><div><h3>3. You approve the ticket</h3><p>The agent proposes the change with the exact dishes, slot and price difference. The shop waits for your approval and performs it once.</p></div></div><p class="more"><a href="/how-it-works">See each step as your agent sees it</a></p></section><section class="plain"><h2>Hours and delivery</h2><div class="cols"><div><h3>Kitchen</h3><dl class="hours">${hours.map((h) => `<div><dt>${h.days}</dt><dd>${h.open}</dd></div>`).join("")}</dl></div><div><h3>Delivery slots</h3><p>Scheduled orders go out in the four slots above. A change of slot costs nothing; a change of dishes is charged at the difference.</p></div><div><h3>Find us</h3><p>12 Lantern Lane (fictional).<br>Dine in, collect, or let your agent schedule a delivery.<br>Phone <span class="mono">${PHONE}</span> (fictional number).</p></div></div></section></main>`;
  return shell("Lantern Noodle Bar · Menu and delivery", body, "/", origin);
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
    [
      "Direct Sign-In",
      `POST ${origin}/oauth/par (optional) · GET ${origin}/oauth/authorize · PKCE S256`,
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
      "Poppy-Session, Poppy-Version: 1.0 and Poppy-Extensions on API and conversation requests",
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
      '403 approval_required → resend with Poppy-Approval (approver="user" or "agent")',
      "Operations v3",
    ],
  ];
  const table = rows
    .map(
      ([what, where, spec]) =>
        `<tr><th scope="row">${what}</th><td><code>${escape(where)}</code></td><td>${specRefHtml(spec)}</td></tr>`,
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
  const body = `<main class="wrap"><section class="intro"><h1>Point your agent here.</h1><p>Lantern Noodle Bar speaks Personal Agent Protocol 1.0. Any Personal Agent with an HTTPS <code>client_id</code> that serves its metadata and keys (ES256 or PS384) can start a Session, sign in as a test customer, with or without a pushed authorization request, and change a scheduled order with Operations version 3. Every visitor gets its own copy of the customers.</p></section><section class="plain"><h2>Endpoints at ${host}</h2><div class="table-wrap"><table><thead><tr><th scope="col">What</th><th scope="col">Where</th><th scope="col">Spec</th></tr></thead><tbody>${table}</tbody></table></div><p class="try">Scopes: <code>orders:read</code> (scheduled orders) and <code>orders:write</code> (propose changes). Sign-in offers read first; a visitor adds write later.</p></section><section class="plain"><h2>Test customers</h2><ul class="customers">${people}</ul><p class="try">Try: <q>Add a matcha ice cream to my order and move it to Sunday lunchtime.</q> The approval shows the new slot, the dishes and the price difference before anything changes.</p><p class="try">Or: <q>The gyoza were missing from my last delivery.</q> Your agent takes it up with Lantern's own agent in a conversation. It answers structured requests with data, and proposes a refund you approve.</p></section><section class="plain"><h2>Watch it work</h2><p class="try">Open <a href="${labPlaygroundUrl(origin)}">Iris</a>, the test Personal Agent in Poppy Lab, with this Company connected. Its Inspector shows discovery, the Session and each API call with the spec section it meets.</p></section></main>`;
  return shell("For agents · Lantern Noodle Bar", body, "/for-agents", origin);
}

/** Server-rendered consent (§4.2) in the shop's own visual system. */
export function consentPage(input: {
  nonce: string;
  passwordRequired: boolean;
  scopes: string;
  client: string;
  clientHost: string;
  account?: string;
}) {
  const read = input.scopes.split(" ").includes("orders:read"),
    write = input.scopes.split(" ").includes("orders:write");
  const sheet = consentSheetHtml({
    company: "Lantern",
    agent: input.client,
    agentHost: input.clientHost,
    nonce: input.nonce,
    passwordRequired: input.passwordRequired,
    chosen: input.account,
    people: customers.map((customer) => ({
      id: customer.id,
      name: customer.name,
      note: `Order for ${slots.find((slot) => slot.id === customer.order.slot)?.label ?? customer.order.slot}`,
    })),
    reads: read
      ? [
          {
            title: "Your scheduled orders",
            text: "Dishes, delivery slot, address and price.",
          },
        ]
      : [],
    changes: write
      ? [
          {
            name: "write",
            title: "Your scheduled orders",
            text: "Move the slot, or add or remove dishes. A change can cost more.",
            checked: true,
            required: !read,
          },
        ]
      : [],
    disconnect: "You can take the permission away under Your account.",
    fine: "Lantern Noodle Bar is a fictional restaurant: no food, charges or deliveries. Independent experiment, not affiliated with or endorsed by the authors of the Personal Agent Protocol.",
  });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Allow ${escape(input.client)} · Lantern Noodle Bar</title>${fonts}<style>${css}</style></head><body>${labConsentBarHtml("Lantern Noodle Bar")}<header class="strip"><div class="wrap"><span class="brand">Lantern Noodle Bar</span></div></header>${sheet}</body></html>`;
}
