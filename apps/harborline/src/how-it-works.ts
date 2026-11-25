/**
 * Harborline Bank's "How it works": what happens when a customer's personal
 * agent comes to the bank, in three steps, each beside the real thing. The
 * discovery document, the operations and the example transfer are built in
 * harborline.ts from the objects the endpoints serve and the seeded
 * customer, so the page can't drift from them.
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
import { escape, shell } from "./site.ts";

/** Money as a bank statement prints it: a real minus sign before the symbol. */
const money = (cents: number) =>
  `${cents < 0 ? "−" : ""}$${(Math.abs(cents) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export type AgentGuide = {
  discovery: Record<string, unknown>;
  paths: GuidePaths;
  excluded: string[];
  example: {
    ask: string;
    customer: string;
    cents: number;
    from: { name: string; type: string; last4: string; cents: number };
    to: { name: string; type: string; last4: string; cents: number };
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
    "And the permissions an agent can ask you for, each one narrow: to see one kind of record, or to propose one kind of change.",
  ],
  apis: [
    "What it can ask the bank.",
    "Accounts, transactions, cards, recipients and budgets; and a second, read-only API in the FDX shape.",
  ],
  agent: ["Who it can talk to.", "Harborline's own automated account guide."],
  tasks: [
    "What we don't do through agents.",
    "And where an agent tells us what it couldn't do here.",
  ],
  extensions: [
    "Changes wait for you.",
    "A payment or a change comes back with its exact terms and is held until you approve it.",
  ],
};

const css = `${howItWorksLayoutCss}
.how{--how-rule:var(--rule);--how-mark:var(--orange);--how-mark-ink:var(--deep)}
.how-head{padding:clamp(40px,6vw,72px) 0 clamp(28px,4vw,44px)}
.how-head h1{font:800 clamp(44px,6vw,80px)/.94 var(--display);letter-spacing:-.02em;text-transform:uppercase;margin:0 0 20px;max-width:22ch}
.how-head p{font-size:clamp(18px,2vw,21px);line-height:1.45;max-width:62ch;margin:0;color:var(--soft)}
.how .num{font:800 clamp(56px,7vw,84px)/.85 var(--display);color:var(--channel)}
.how .step h2{font:800 clamp(30px,3.4vw,42px)/1 var(--display);text-transform:uppercase;letter-spacing:-.01em;margin:14px 0 12px}
.how .say{color:var(--soft)}
.how .keys{color:var(--soft)}
.how .keys strong{color:var(--ink)}
.how .doc{background:var(--deep);color:#dbe7ea;box-shadow:inset 0 5px var(--orange)}
.how .doc-head{padding-top:18px;border-bottom:1px solid rgba(255,255,255,.16);font-size:13px}
.how .doc-head code{font:600 13px ui-monospace,SFMono-Regular,Menlo,monospace}
.how .doc-head span{color:#a9c0c9}
.how .doc-head a{color:#fff}
.how .doc pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.how .ln.hit{background:rgba(237,107,47,.17)}
.how .k{color:var(--glass)}
.how .fold{color:#a9c0c9}
.how .ops{background:var(--white);border:1px solid #aebfc2}
.how .ops:before{content:"";display:block;height:12px;background:var(--glass);border-bottom:1px solid #83b8ad}
.how .zone{padding:0 22px}
.how .zone-head{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:4px 16px;padding:18px 0 12px;border-bottom:2px solid var(--channel)}
.how .zone-head h3{font:800 24px/1 var(--display);text-transform:uppercase;margin:0}
.how .zone-head p{margin:0;font-size:12px;color:var(--muted)}
.how .zone ul{list-style:none;margin:0;padding:0}
.how .zone li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:16px;align-items:center;padding:13px 0;border-bottom:1px solid var(--rule)}
.how .zone:last-child li:last-child{border-bottom:0}
.how .zone li strong{display:block;font-weight:700}
.how .zone li strong::first-letter{text-transform:uppercase}
.how .zone li code{display:block;margin-top:2px;font:400 12.5px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted)}
.how .ops-note{margin:0;padding:15px 22px;background:#eef5f3;border-top:1px solid var(--rule);font-size:13px;color:var(--soft)}
.how .slip{margin-top:26px;max-width:460px}
.how .slip .ledger-row{grid-template-columns:minmax(0,1fr) auto}
.how .slip .after{display:block;font-weight:400;font-size:13px;color:var(--muted)}
.how .slip .ledger-note{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px}
.how .seq figcaption{margin-top:12px;font-size:14px;color:var(--muted);max-width:60ch}
.how .sq-head{font:800 19px var(--display);letter-spacing:.03em;text-transform:uppercase}
.how .sq-label{font:700 11.5px var(--body);letter-spacing:.05em;text-transform:uppercase}
.how .questions{padding:clamp(28px,4vw,44px) 0 clamp(48px,7vw,80px);border-top:1px solid var(--rule)}
.how .questions h2{font:800 clamp(34px,4vw,48px)/1 var(--display);text-transform:uppercase;letter-spacing:-.01em;margin:0}
.how .faq dt{font:700 23px/1.1 var(--display);text-transform:uppercase;margin:0 0 6px}
.how .faq dd{color:var(--soft)}
.how .faq ul{margin:8px 0 0;padding-left:18px}
@media(max-width:640px){.how .sq-head{font-size:16px}.how .zone{padding:0 16px}.how .ops-note{padding:14px 16px}}
`;

/** The API's operations as a ledger: three sections by what each needs from the customer. */
function operationLedger(guide: AgentGuide) {
  const operations = guideOperations(guide.paths, guide.discovery);
  const zones: Array<
    [title: string, who: string, list: typeof operations, state: string]
  > = [
    [
      "Open to anyone",
      "No sign-in",
      operations.filter((o) => !o.signedIn && !o.approval),
      '<span class="status">open</span>',
    ],
    [
      "After you sign in",
      "Only your own records",
      operations.filter((o) => o.signedIn && !o.approval),
      '<span class="status">read only</span>',
    ],
    [
      "Needs your approval",
      "Held until you approve",
      operations.filter((o) => o.approval),
      '<span class="status frozen">your approval</span>',
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

/** The transfer the customer approves, as a page of the bank's ledger. */
function transferSlip(example: AgentGuide["example"]) {
  const { from, to, cents } = example;
  const row = (
    account: AgentGuide["example"]["from"],
    change: number,
    direction: string,
  ) =>
    `<div class="ledger-row"><div class="ledger-label">${direction} ${escape(account.name)}<small>${escape(account.type)} · ending ${escape(account.last4)}</small></div><div class="amount">${money(change)}<span class="after">${money(account.cents)} → ${money(account.cents + change)}</span></div></div>`;
  return `<div class="ledger slip" role="img" aria-label="Transfer of ${money(cents)} for ${escape(example.customer)}, from ${escape(from.name)} to ${escape(to.name)}, waiting for your approval. ${escape(from.name)} goes from ${money(from.cents)} to ${money(from.cents - cents)}, and ${escape(to.name)} from ${money(to.cents)} to ${money(to.cents + cents)}."><div class="ledger-head"><strong>Transfer ${money(cents)}</strong><span>${escape(example.customer)}<br>USD</span></div><div class="ledger-section">${row(from, -cents, "From")}${row(to, cents, "To")}</div><div class="ledger-note"><span class="status frozen">Waiting for your approval</span><span>You approve or decline in your agent.</span></div></div>`;
}

const approvalSequence = (example: AgentGuide["example"], narrow = false) =>
  approvalSequenceSvg(
    {
      id: "harborline-approval",
      company: "Harborline",
      request: `Transfer ${money(example.cents).replace(/\.00$/, "")}`,
      held: "The transfer waits · no money has moved",
      ink: "#0d2638",
      ground: "#f4f7f5",
      paper: "#ffffff",
      line: "#c9d4d5",
      accent: "#ed6b2f",
      accentInk: "#062b43",
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
  // The sixteen permissions and their hints would run to two screens: said in words here, whole in the file.
  const permissions = Object.keys(
    (guide.discovery.auth as { scopes?: Record<string, string> } | undefined)
      ?.scopes ?? {},
  ).length;
  const fold = {
    "auth.scopes": `{ ${permissions} permissions, each described in words }`,
    "auth.scope_hints":
      "{ for each one: whether it reads, changes or moves money }",
  };
  const questions: Array<[string, string]> = [
    [
      "Do I have to set anything up?",
      "No. Your agent finds Harborline on its own. To see or change anything of yours you sign in on this site, on a page we show you, and tick what the agent may do.",
    ],
    [
      "What can an agent do without me?",
      "Ask our automated account guide what it can help with. Everything about your accounts needs your sign-in.",
    ],
    [
      "What needs my approval?",
      "Every change: a payment, a transfer, freezing a card, a transaction&#39;s category or a budget. You see the exact amount, recipient and account first, and the bank makes the change once, after you approve. Balance and limits are checked again at that moment.",
    ],
    [
      "Does the agent get my password?",
      'No. You sign in on Harborline&#39;s own page. The agent gets the permissions you ticked, and you can disconnect it in the <a href="/account">customer portal</a>.',
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
  const body = `<main class="wrap how"><section class="how-head"><h1>How Harborline works with your agent.</h1><p>Harborline takes requests from personal AI agents through Personal Agent Protocol, an open protocol. It takes three steps. Each is shown here as this site serves it.</p></section><section aria-label="The three steps"><article class="step"><div><span class="num" aria-hidden="true">01</span><h2>Your agent finds the bank</h2><p class="say">Every agent starts at one small file on our site. This is ours, as an agent reads it.</p><ol class="keys">${keys}</ol></div><div class="doc"><p class="doc-head"><code>/.well-known/poppy.json</code><span>as served, with the two long lists folded · <a href="/.well-known/poppy.json">the whole file</a></span></p><pre tabindex="0" aria-label="Harborline&#39;s discovery document">${annotatedJsonHtml(guide.discovery, shown, { fold })}</pre></div></article><article class="step"><div><span class="num" aria-hidden="true">02</span><h2>The bank says what it can do</h2><p class="say">The file leads to our API: a ledger of things an agent may ask for, each with one job. Reading opens once you sign in, and every change waits for you.</p></div><div class="ops">${operationLedger(guide)}<p class="ops-note">The portal and a connected agent always see the same accounts.</p></div></article><article class="step"><div><span class="num" aria-hidden="true">03</span><h2>You approve the transfer</h2><p class="say">Ask your agent: <q>${escape(example.ask)}</q> It proposes the transfer, and Harborline answers with the exact terms and holds it. No money moves until you approve, and then it moves once.</p>${transferSlip(example)}</div><figure class="seq">${approvalSequence(example)}${approvalSequence(example, true)}<figcaption>Harborline answers the first request with the terms, not with the transfer. The orange step is yours.</figcaption></figure></article></section><section class="questions" aria-labelledby="questions-title"><h2 id="questions-title">Questions</h2><dl class="faq">${questions.map(([q, a]) => `<div><dt>${q}</dt><dd>${a}</dd></div>`).join("")}</dl></section></main>`;
  return shell(
    "How it works with your agent · Harborline Bank",
    body,
    "/how-it-works",
    origin,
    css,
  );
}
