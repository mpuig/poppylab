/**
 * Fernwick Power & Light's "How it works": what happens when a customer's
 * personal agent comes to the utility, in three steps, each beside the real
 * thing. The discovery document, the operations and the example plan switch
 * are built in fernwick.ts from the objects the endpoints serve and the
 * seeded meter, priced as the switch's own terms price it, so the page
 * can't drift from them.
 */
import {
  annotatedJsonHtml,
  approvalSequenceSvg,
  breakablePath,
  guideOperations,
  howItWorksLayoutCss,
  labPlaygroundUrl,
  type GuidePaths,
} from "@poppy-lab/pap-core";
import { escape, money, shell } from "./site.ts";

export type AgentGuide = {
  discovery: Record<string, unknown>;
  paths: GuidePaths;
  excluded: string[];
  /** The ESPI-shaped API's address, read-only, beside the own API. */
  espi: string;
  example: {
    ask: string;
    customer: string;
    meter: string;
    from: string;
    to: string;
    /** `YYYY-MM-DD`, the next bill cycle. */
    effective: string;
    /** The last closed bill the estimate prices both ways. */
    basis: { month: string; kwh: string; billed: number; onNewPlan: number };
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
    "And the permissions an agent can ask you for, each one narrow: to see your account, your hourly usage or your bills, to propose a plan switch, or to open this website signed in, read only.",
  ],
  apis: [
    "What it can ask the utility.",
    "Your account, meters, plans and bills, and the plan switch.",
  ],
  agent: ["Who it can talk to.", "Fernwick's own automated account guide."],
  tasks: [
    "What we don't do through agents.",
    "And where an agent tells us what it couldn't do here.",
  ],
  extensions: [
    "Changes wait for you, and usage comes in a standard shape.",
    "A plan switch comes back with its exact terms and is held until you approve it. Hourly usage and bills are also served read-only in the ESPI shape, as Atom XML, to an agent that asks for it.",
  ],
};

const css = `${howItWorksLayoutCss}
.how{--how-rule:var(--rule);--how-mark:var(--seal);--how-mark-ink:var(--seal-ink)}
.how-head{padding:clamp(40px,6vw,72px) 0 clamp(28px,4vw,44px)}
.how-head h1{font:700 clamp(44px,6vw,80px)/.98 var(--head);margin:0 0 20px;max-width:16ch}
.how-head p{font-size:clamp(18px,2vw,21px);line-height:1.45;max-width:62ch;margin:0;color:var(--soft)}
.how .num{font:700 clamp(56px,7vw,84px)/.85 var(--head);color:var(--fern)}
.how .step h2{font:700 clamp(30px,3.4vw,42px)/1.02 var(--head);margin:14px 0 12px}
.how .say,.how .keys{color:var(--soft)}
.how .keys strong{color:var(--ink)}
.how .doc{background:var(--deep);color:#dbe5dd;box-shadow:inset 0 5px var(--seal)}
.how .doc-head{padding-top:18px;border-bottom:1px solid rgba(255,255,255,.16);font-size:13px}
.how .doc-head code{font:500 13px var(--mono)}
.how .doc-head span{color:#a9bfb0}
.how .doc-head a{color:#fff}
.how .doc pre{font-family:var(--mono)}
.how .ln.hit{background:rgba(240,196,25,.14)}
.how .k{color:#f4d04a}
.how .fold{color:#a9bfb0}
.how .ops{background:var(--white);border:1px solid var(--rule);border-top:4px solid var(--fern)}
.how .zone{padding:0 22px}
.how .zone-head{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:4px 16px;padding:18px 0 10px;border-bottom:2px solid var(--ink)}
.how .zone-head h3{font:700 22px/1.1 var(--head);margin:0}
.how .zone-head p{margin:0;font-size:13px;color:var(--muted)}
.how .zone ul{list-style:none;margin:0;padding:0}
.how .zone li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:16px;align-items:center;padding:13px 0;border-bottom:1px solid var(--rule)}
.how .zone:last-of-type li:last-child{border-bottom:0}
.how .zone li strong{display:block;font-weight:600}
.how .zone li strong::first-letter{text-transform:uppercase}
.how .zone li code{display:block;margin-top:2px;font-size:12.5px;color:var(--muted)}
.how .tag{font:500 12px/1 var(--mono);padding:5px 8px;border-radius:2px;background:var(--leaf);color:var(--deep);white-space:nowrap}
.how .tag.yours{background:var(--seal);color:var(--seal-ink)}
.how .ops-note{margin:0;padding:15px 22px;background:#ecebe1;border-top:1px solid var(--rule);font-size:13px;color:var(--soft)}
.how .slip{margin-top:26px;max-width:460px}
.how .slip .value{font:500 15px/1.3 var(--mono);font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
.how .slip .after{display:block;font:400 13px var(--body);color:var(--muted);text-align:right}
.how .slip .card-note{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px}
.how .seq figcaption{margin-top:12px;font-size:14px;color:var(--muted);max-width:60ch}
.how .sq-head{font:700 19px var(--head)}
.how .sq-label{font:600 12px var(--body);letter-spacing:.02em}
.how .questions{padding:clamp(28px,4vw,44px) 0 clamp(48px,7vw,80px);border-top:1px solid var(--rule)}
.how .questions h2{font:700 clamp(34px,4vw,48px)/1 var(--head);margin:0}
.how .faq dt{font:700 22px/1.15 var(--head);margin:0 0 6px}
.how .faq dd{color:var(--soft)}
.how .faq ul{margin:8px 0 0;padding-left:18px}
@media(max-width:640px){.how .sq-head{font-size:16px}.how .zone{padding:0 16px}.how .ops-note{padding:14px 16px}}
`;

/** The API's operations as a meter route card: three rows by what each needs. */
function operationCard(guide: AgentGuide) {
  const operations = guideOperations(guide.paths, guide.discovery);
  const zones: Array<
    [title: string, who: string, list: typeof operations, state: string]
  > = [
    [
      "Open to anyone",
      "No sign-in",
      operations.filter((o) => !o.signedIn && !o.approval),
      '<span class="tag">open</span>',
    ],
    [
      "After you sign in",
      "Only the meters you choose",
      operations.filter((o) => o.signedIn && !o.approval),
      '<span class="tag">read only</span>',
    ],
    [
      "Needs your approval",
      "Held until you approve",
      operations.filter((o) => o.approval),
      '<span class="tag yours">your approval</span>',
    ],
  ];
  return zones
    .filter(([, , list]) => list.length)
    .map(
      ([title, who, list, state]) =>
        `<div class="zone"><div class="zone-head"><h3>${title}</h3><p>${who}</p></div><ul>${list.map((o) => `<li><span><strong>${escape(o.name)}</strong><code>${breakablePath(o.where)}</code></span>${state}</li>`).join("")}</ul></div>`,
    )
    .join("");
}

const longDay = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
/** "$12.34 more", "$0.50 less", "the same", in hundred-thousandths of USD. */
const difference = (amount: number) =>
  amount === 0
    ? "the same"
    : `${money(Math.abs(amount))} ${amount > 0 ? "more" : "less"}`;

/** The switch the customer approves, as a slip of the utility's own bill. */
function switchSlip(example: AgentGuide["example"]) {
  const { basis } = example;
  const change = basis.onNewPlan - basis.billed;
  const row = (label: string, small: string, value: string, after = "") =>
    `<div class="row"><span>${label}<small>${small}</small></span><span class="value">${value}${after ? `<span class="after">${after}</span>` : ""}</span></div>`;
  return `<div class="card slip" role="img" aria-label="Plan switch for ${escape(example.customer)}'s ${escape(example.meter)}, from ${escape(example.from)} to ${escape(example.to)} from ${longDay(example.effective)}, waiting for your approval. On ${escape(basis.month)}'s usage of ${basis.kwh} kWh the bill would have been ${difference(change)}: ${money(basis.onNewPlan)} instead of ${money(basis.billed)}."><div class="card-head"><strong>Switch to ${escape(example.to)}</strong><span>${escape(example.customer)}<br>${escape(example.meter)}</span></div><div class="card-body">${row("Plan", `From ${longDay(example.effective)}, the next bill cycle`, escape(example.to), `${escape(example.from)} → ${escape(example.to)}`)}${row(`${escape(basis.month)} as billed`, `${basis.kwh} kWh on ${escape(example.from)}`, money(basis.billed))}${row(`${escape(basis.month)} on ${escape(example.to)}`, "The same hours, priced on the new plan", money(basis.onNewPlan), difference(change))}</div><div class="card-note"><span class="tag yours">Waiting for your approval</span><span>You approve or decline in your agent.</span></div></div>`;
}

const approvalSequence = (example: AgentGuide["example"], narrow = false) =>
  approvalSequenceSvg(
    {
      id: "fernwick-approval",
      company: "Fernwick",
      request: "Switch plan",
      held: "The switch waits · your plan hasn't changed",
      ink: "#18231d",
      ground: "#f4f2ea",
      paper: "#fffdf8",
      line: "#d3d2c4",
      accent: "#f0c419",
      accentInk: "#2e2600",
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
  // The permissions and their hints would run long: said in words here, whole in the file.
  const permissions = Object.keys(
    (guide.discovery.auth as { scopes?: Record<string, string> } | undefined)
      ?.scopes ?? {},
  ).length;
  const fold = {
    "auth.scopes": `{ ${permissions} permissions, each described in words }`,
    "auth.scope_hints":
      "{ for each one: whether it reads or changes something }",
  };
  const questions: Array<[string, string]> = [
    [
      "Do I have to set anything up?",
      "No. Your agent finds Fernwick on its own. To see anything of yours you sign in on this site, on a page we show you, and tick the meters the agent may read.",
    ],
    [
      "What can an agent do without me?",
      "Ask our automated account guide what it can help with, and read our plans and prices. Everything about your meters needs your sign-in.",
    ],
    [
      "What needs my approval?",
      "A plan switch. You see the meter, the new plan, the day it starts and the estimated difference on last month's bill first, and Fernwick makes the switch once, after you approve. Nothing changes before the next bill cycle.",
    ],
    [
      "What is the ESPI shape?",
      `A standard way utilities publish hourly usage and bills, as Atom XML. Ours is ${escape("ESPI-shaped (modelled on NAESB REQ.21 ESPI), not certified")}, and read-only: an agent that asks for it reads the same meters you chose, at <code>${breakablePath(guide.espi)}</code>.`,
    ],
    [
      "Does the agent get my password?",
      'No. You sign in on Fernwick&#39;s own page. The agent gets the meters and permissions you ticked, and you can disconnect it in <a href="/account">your account</a>.',
    ],
    [
      "What can&#39;t an agent do here?",
      `These are not offered through an agent:<ul>${guide.excluded.map((task) => `<li>${escape(task)}</li>`).join("")}</ul>`,
    ],
    [
      "Which agents work here?",
      `Any personal agent that follows Personal Agent Protocol 1.0. <a href="${escape(labPlaygroundUrl(origin))}">Iris</a>, the agent of Poppy Lab, is one you can try now. The addresses an agent needs are under <a href="/for-agents">For agents</a>.`,
    ],
  ];
  const body = `<main class="wrap how"><section class="how-head"><h1>How Fernwick works with your agent.</h1><p>Fernwick takes requests from personal AI agents through Personal Agent Protocol, an open protocol. It takes three steps. Each is shown here as this site serves it.</p></section><section aria-label="The three steps"><article class="step"><div><span class="num" aria-hidden="true">01</span><h2>Your agent finds the utility</h2><p class="say">Every agent starts at one small file on our site. This is ours, as an agent reads it.</p><ol class="keys">${keys}</ol></div><div class="doc"><p class="doc-head"><code>/.well-known/poppy.json</code><span>as served, with the two long lists folded · <a href="/.well-known/poppy.json">the whole file</a></span></p><pre tabindex="0" aria-label="Fernwick&#39;s discovery document">${annotatedJsonHtml(guide.discovery, shown, { fold })}</pre></div></article><article class="step"><div><span class="num" aria-hidden="true">02</span><h2>The utility says what it can do</h2><p class="say">The file leads to our API: a short route card of things an agent may ask for, each with one job. Reading opens once you sign in, and a plan switch waits for you.</p></div><div class="ops">${operationCard(guide)}<p class="ops-note">Your account, our API and the ESPI-shaped usage data all show the meters you chose, and only those.</p></div></article><article class="step"><div><span class="num" aria-hidden="true">03</span><h2>You approve the plan switch</h2><p class="say">Ask your agent: <q>${escape(example.ask)}</q> It proposes the switch, and Fernwick answers with the exact terms and holds it. Your plan stays as it is until you approve, and then it switches once, from the next bill cycle.</p>${switchSlip(example)}</div><figure class="seq">${approvalSequence(example)}${approvalSequence(example, true)}<figcaption>Fernwick answers the first request with the terms, not with the switch. The yellow step is yours.</figcaption></figure></article></section><section class="questions" aria-labelledby="questions-title"><h2 id="questions-title">Questions</h2><dl class="faq">${questions.map(([q, a]) => `<div><dt>${q}</dt><dd>${a}</dd></div>`).join("")}</dl></section></main>`;
  return shell(
    "How it works with your agent · Fernwick Power & Light",
    body,
    "/how-it-works",
    origin,
    css,
  );
}
