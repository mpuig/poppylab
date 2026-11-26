/**
 * Juniper Market's "How it works": what happens when a customer's personal
 * agent comes to the shop, in three steps, each beside the real thing. The
 * discovery document, the operations and the example are built in
 * juniper.ts from the objects the endpoints serve, so the page can't drift
 * from them.
 */
import {
  annotatedJsonHtml,
  approvalSequenceSvg,
  breakablePath,
  guideExcluded,
  guideOperations,
  howItWorksLayoutCss,
  labPlaygroundUrl,
  type GuidePaths,
} from "@poppy-lab/pap-core";
import { publicPage } from "./website.js";

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export type AgentGuide = {
  discovery: Record<string, unknown>;
  paths: GuidePaths;
  excluded: string[];
  phone: string;
  example: {
    ask: string;
    delivery: string;
    customer: string;
    fromDay: string;
    toDay: string;
    items: Array<{ name: string; quantity: number; cents: number }>;
  };
};

/** What the page says of each part of the discovery document it marks. */
const discoveryKeys: Record<string, [title: string, text: string]> = {
  organization: [
    "Who we are.",
    "Our name, and the domain this file was served from.",
  ],
  auth: [
    "Where you sign in.",
    "And the permissions an agent can ask you for: to see your account, to propose changes to it, and to open this website signed in, read only.",
  ],
  extensions: [
    "Changes wait for you.",
    "A change comes back with its exact terms and is held until you approve it.",
  ],
  agent: [
    "Who it can talk to.",
    "Juniper's own automated agent, for hours, deliveries and a problem with an order.",
  ],
  apis: [
    "What it can ask the shop.",
    "The shelf, delivery terms, and your basket, orders and recurring delivery.",
  ],
  tasks: [
    "What we don't do through agents.",
    "And where an agent tells us what it couldn't do here.",
  ],
};

const css = `${howItWorksLayoutCss}
.how{--how-rule:var(--line);--how-mark:#f1dfc6;--how-mark-ink:#7a3f1f}
.how .steps{padding-bottom:0}
.how .step:first-child{border-top:0;padding-top:8px}
.how .num{font:400 clamp(52px,6vw,72px)/.9 Georgia,serif;color:var(--accent);letter-spacing:-.03em}
.how .step h2{margin:14px 0 10px}
.how .say{color:var(--muted)}
.how .keys{color:var(--muted)}
.how .keys strong{color:var(--ink);font-weight:600}
.how .doc{background:var(--ink);color:#eef0e6;border-radius:5px}
.how .doc-head{border-bottom:1px solid rgba(245,243,235,.16);font-size:13px}
.how .doc-head code{font-weight:600}
.how .doc-head span{color:#b9c8b8}
.how .doc pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.how .ln.hit{background:rgba(241,223,198,.13)}
.how .k{color:#c8d8bf}
.how .zone+.zone{margin-top:28px}
.how .zone-head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:4px 16px;padding-bottom:10px;border-bottom:1px solid var(--ink)}
.how .zone-head h3{font:400 22px/1.2 Georgia,serif;margin:0}
.how .zone-head p{margin:0;font-size:14px;color:var(--muted)}
.how .zone ul{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:32px}
.how .zone li{padding:11px 0 12px;border-bottom:1px solid var(--line);min-width:0}
.how .zone li strong{display:block;font-weight:600;line-height:1.3}
.how .zone li strong::first-letter{text-transform:uppercase}
.how .zone li code{display:block;margin-top:3px;font-size:12.5px;color:var(--muted)}
.how .zone.waits .zone-head{border-bottom-color:var(--accent)}
.how .zone.waits li strong::after{content:"";display:inline-block;width:7px;height:7px;margin-left:8px;border-radius:50%;background:var(--accent);vertical-align:middle}
.how .slip{margin-top:24px;max-width:360px;background:#fdfcf8;border:1px solid var(--line);border-radius:5px;padding:18px 20px 20px}
.how .slip-head{display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin:0 0 4px;font-weight:600}
.how .slip-head span{font-weight:400;font-size:13px;color:var(--muted)}
.how .slip-who{margin:0 0 14px;font-size:14px;color:var(--muted)}
.how .slip dl{margin:0;border-top:1px solid var(--ink)}
.how .slip dl div{display:flex;justify-content:space-between;gap:16px;padding:9px 0;border-bottom:1px solid var(--line)}
.how .slip dt{color:var(--muted)}
.how .slip dd{margin:0;text-align:right;font-variant-numeric:tabular-nums}
.how .slip s{color:var(--muted)}
.how .slip .to{background:#f1dfc6;color:#5c2d14;font-weight:600;padding:1px 6px;border-radius:3px}
.how .slip .state{display:inline-flex;align-items:center;gap:8px;margin:14px 0 0;font-size:13px;font-weight:600;line-height:1;padding:6px 10px;border-radius:999px;background:#f1dfc6;color:#7a3f1f}
.how .slip .where{margin:10px 0 0;font-size:13px;color:var(--muted)}
.how .seq figcaption{margin-top:12px;font-size:14px;color:var(--muted);max-width:60ch}
.how .sq-head{font:400 19px Georgia,serif}
.how .sq-label{font:600 12.5px ui-sans-serif,system-ui,sans-serif}
.how .faq dt{font:400 21px/1.25 Georgia,serif;margin:0 0 6px}
.how .faq dd{color:var(--muted)}
@media(max-width:640px){.how .zone ul{grid-template-columns:minmax(0,1fr)}.how .sq-head{font-size:16px}}
`;

/** The API's operations as three ruled lists, by what each needs from the customer. */
function operationZones(guide: AgentGuide) {
  const operations = guideOperations(guide.paths, guide.discovery);
  const zones: Array<
    [title: string, who: string, list: typeof operations, waits?: true]
  > = [
    [
      "Open to anyone",
      "No sign-in",
      operations.filter((o) => !o.signedIn && !o.approval),
    ],
    [
      "After you sign in",
      "Only your own account",
      operations.filter((o) => o.signedIn && !o.approval),
    ],
    [
      "Needs your approval",
      "Held until you approve",
      operations.filter((o) => o.approval),
      true,
    ],
  ];
  return zones
    .filter(([, , list]) => list.length)
    .map(
      ([title, who, list, waits]) =>
        `<div class="zone${waits ? " waits" : ""}"><div class="zone-head"><h3>${title}</h3><p>${who}</p></div><ul>${list.map((o) => `<li><strong>${escape(o.name)}</strong><code>${breakablePath(o.where)}</code></li>`).join("")}</ul></div>`,
    )
    .join("");
}

/** The change the customer approves, as the shop would write it down. */
function changeSlip(example: AgentGuide["example"]) {
  const items = example.items
    .map(
      (item) =>
        `<div><dt>${item.quantity} × ${escape(item.name)}</dt><dd>${usd(item.cents)}</dd></div>`,
    )
    .join("");
  return `<div class="slip" role="img" aria-label="Recurring delivery ${escape(example.delivery)} for ${escape(example.customer)}: the day moves from ${escape(example.fromDay)} to ${escape(example.toDay)}, every week, at no charge, waiting for your approval."><p class="slip-head">Recurring delivery <span>${escape(example.delivery)}</span></p><p class="slip-who">${escape(example.customer)} · every week</p><dl><div><dt>Day</dt><dd><s>${escape(example.fromDay)}</s> → <span class="to">${escape(example.toDay)}</span></dd></div>${items}<div><dt>Charge for the change</dt><dd>${usd(0)}</dd></div></dl><p class="state">Waiting for your approval</p><p class="where">You approve or decline in your agent.</p></div>`;
}

const approvalSequence = (narrow = false) =>
  approvalSequenceSvg(
    {
      id: "juniper-approval",
      company: "Juniper",
      request: "Move delivery",
      held: "The change waits · nothing has moved",
      ink: "#17342b",
      ground: "#f5f3eb",
      paper: "#fdfcf8",
      line: "#c6cebf",
      accent: "#9b472e",
      accentInk: "#fdfcf8",
    },
    narrow,
  );

export function howItWorksPage(origin: string, guide: AgentGuide) {
  const { example } = guide;
  // In the document's own order, so the numbers run down the file.
  const shown = Object.keys(guide.discovery).filter(
    (key) => key in discoveryKeys,
  );
  const keys = shown
    .map((key, i) => {
      const [title, text] = discoveryKeys[key]!;
      return `<li><b class="mark">${i + 1}</b><span><strong>${title}</strong> ${escape(text)}</span></li>`;
    })
    .join("");
  const questions: Array<[string, string]> = [
    [
      "Do I have to set anything up?",
      "No. Your agent finds Juniper on its own. To see or change anything of yours you sign in on this site, on a page we show you, and choose what the agent may do.",
    ],
    [
      "What can an agent do without me?",
      "Browse the shelf and its prices, read the delivery days, the fee and the shop&#39;s hours, search the help pages and ask our automated agent. Nothing about you.",
    ],
    [
      "What needs my approval?",
      "Every change: to your basket, a checkout, your recurring delivery, your profile or a support case. You see the exact terms first, and Juniper makes the change once, after you approve.",
    ],
    [
      "Does the agent get my password?",
      'No. You sign in on Juniper&#39;s own page. The agent gets a permission, and you can take it away under <a href="/account">Your account</a>.',
    ],
    [
      "What can&#39;t an agent do here?",
      `An agent can&#39;t ${escape(guideExcluded(guide.excluded))}. A refund is reviewed by a person: open a support case under <a href="/help">Help</a>, or ask your agent to open one. For anything else, call <span class="tel">${escape(guide.phone)}</span> (a fictional number).`,
    ],
    [
      "Which agents work here?",
      `Any personal agent that follows Personal Agent Protocol 1.0. <a href="${escape(labPlaygroundUrl(origin))}">Iris</a>, the agent of Poppy Lab, is one you can try now. The addresses an agent needs are under <a href="/for-agents">For agents</a>.`,
    ],
  ];
  const body = `<div class="how"><div class="hero"><h1>How Juniper works with your agent.</h1><p class="intro lead">Juniper takes requests from personal AI agents through Personal Agent Protocol, an open protocol. It takes three steps. Each is shown here as this site serves it.</p></div><section class="steps" aria-label="The three steps"><article class="step"><div><span class="num" aria-hidden="true">1</span><h2>Your agent finds the shop</h2><p class="say">Every agent starts at one small file on our site. This is ours, as an agent reads it.</p><ol class="keys">${keys}</ol></div><div class="doc"><p class="doc-head"><code>/.well-known/poppy.json</code><span>as served to every agent</span></p><pre tabindex="0" aria-label="Juniper&#39;s discovery document">${annotatedJsonHtml(guide.discovery, shown, { width: 64 })}</pre></div></article><article class="step"><div><span class="num" aria-hidden="true">2</span><h2>The shop says what it can do</h2><p class="say">The file leads to our API: a list of things an agent may ask for, each with one job. Some are open to anyone, some open once you sign in, and every change waits for you.</p></div><div>${operationZones(guide)}</div></article><article class="step"><div><span class="num" aria-hidden="true">3</span><h2>You approve the change</h2><p class="say">Ask your agent: <q>${escape(example.ask)}</q> It proposes the change, and Juniper answers with the exact terms and holds it. Nothing changes until you approve, and then it changes once.</p>${changeSlip(example)}</div><figure class="seq">${approvalSequence()}${approvalSequence(true)}<figcaption>Juniper answers the first request with the terms, not with the change. The step in colour is yours.</figcaption></figure></article></section><section aria-labelledby="questions-title"><h2 id="questions-title">Questions</h2><dl class="faq">${questions.map(([q, a]) => `<div><dt>${q}</dt><dd>${a}</dd></div>`).join("")}</dl></section></div>`;
  return publicPage(
    origin,
    "How it works with your agent",
    body,
    "/how-it-works",
    css,
  );
}
