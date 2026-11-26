/**
 * Northwind Air's "How it works": what happens when a passenger's personal
 * agent comes to the airline, in three steps, each beside the real thing.
 * The discovery document, the operations and the example upgrade are built
 * in northwind.ts from the objects the endpoints serve and the seeded
 * booking, so the page can't drift from them.
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

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export type AgentGuide = {
  discovery: Record<string, unknown>;
  paths: GuidePaths;
  excluded: string[];
  phone: string;
  example: {
    ask: string;
    booking: string;
    passenger: string;
    flight: string;
    from: { code: string; city: string };
    to: { code: string; city: string };
    /** "18 May 2027 · 13:10", in the departure airport's time. */
    departs: string;
    fromCabin: string;
    toCabin: string;
    cents: number;
    refund: string;
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
    "And the permissions an agent can ask you for: to read your trips and profile, to set preferences, to propose changes to a booking, and to open this website signed in, read only.",
  ],
  apis: [
    "What it can ask the airline.",
    "Flights, fares and status for anyone; your trips, loyalty and changes once you sign in.",
  ],
  agent: ["Who it can talk to.", "Northwind's own automated travel desk."],
  tasks: [
    "What we don't do through agents.",
    "And where an agent tells us what it couldn't do here.",
  ],
  extensions: [
    "Changes wait for you.",
    "A change comes back with its exact price and terms and is held until you approve it.",
  ],
};

const css = `${howItWorksLayoutCss}
.how{--how-rule:var(--line);--how-mark:var(--sun);--how-mark-ink:var(--ink)}
.how-head{padding:clamp(40px,6vw,76px) 0 clamp(28px,4vw,46px)}
.how-head h1{font-size:clamp(46px,6.4vw,88px);line-height:.88;margin:0 0 22px;max-width:20ch}
.how-head p{max-width:64ch;margin:0;color:var(--soft)}
.how .num{font:800 clamp(56px,7vw,88px)/.82 var(--display);color:var(--wind)}
.how .step h2{font-size:clamp(30px,3.4vw,44px);line-height:.95;margin:14px 0 12px}
.how .say{color:var(--soft)}
.how .mark{font-family:var(--mono)}
.how .keys{color:var(--soft)}
.how .keys strong{color:var(--ink);font-weight:750}
.how .doc{background:var(--ink);color:#e6eef0;border-bottom:4px solid var(--sun)}
.how .doc-head{border-bottom:1px solid #46606d;font:600 12px var(--mono)}
.how .doc-head span{font-weight:400;color:#b9d2db}
.how .doc pre{font-family:var(--mono);font-size:12.5px}
.how .ln.hit{background:rgba(239,183,62,.16)}
.how .k{color:#b9d2db}
.how .board+.board{margin-top:30px}
.how .board-head{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:4px 16px;padding-bottom:10px;border-bottom:2px solid var(--ink)}
.how .board-head h3{font-size:28px;line-height:1;margin:0}
.how .board-head p{margin:0;font:500 11px/1.45 var(--mono);color:var(--muted)}
.how .board ul{list-style:none;margin:0;padding:0}
.how .board li{display:grid;grid-template-columns:44px minmax(0,1fr) auto;gap:14px;align-items:center;padding:13px 0;border-bottom:1px solid var(--line)}
.how .board .n{font:750 22px/1 var(--display);color:var(--wind)}
.how .board strong{display:block;font:750 21px/1.05 var(--display);text-transform:uppercase;letter-spacing:.01em}
.how .board code{display:block;margin-top:4px;font-size:12px;color:var(--muted)}
.how .board .status{white-space:nowrap}
.how .board .status.quiet{background:transparent;box-shadow:inset 0 0 0 1px var(--line);color:var(--soft)}
.how .pass{margin-top:26px;max-width:440px;border:1px solid var(--line);background:#fffdf6}
.how .pass-head{display:flex;justify-content:space-between;align-items:baseline;gap:16px;flex-wrap:wrap;padding:14px 18px;background:var(--sky);border-bottom:1px solid var(--line)}
.how .pass-head strong{font:750 26px/1 var(--display);text-transform:uppercase}
.how .pass-head span{font:500 12px var(--mono)}
.how .pass-route{margin:0;padding:16px 18px 4px;font-size:18px}
.how .pass-route small{display:block;font:500 12px var(--mono);color:var(--muted)}
.how .pass dl{margin:0;padding:6px 18px 4px}
.how .pass dl div{display:flex;justify-content:space-between;gap:16px;padding:10px 0;border-top:1px solid #d5dedf}
.how .pass dt{color:var(--muted);font-size:14px}
.how .pass dd{margin:0;text-align:right;font-weight:650}
.how .pass s{font-weight:500;color:var(--muted)}
.how .pass .to{background:var(--sun);padding:1px 6px}
.how .pass .terms{margin:0;padding:0 18px 14px;font-size:13px;color:var(--soft)}
.how .pass-foot{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;padding:13px 18px;border-top:1px solid var(--line);font-size:13px;color:var(--soft)}
.how .seq figcaption{margin-top:12px;font-size:14px;color:var(--muted);max-width:60ch}
.how .sq-head{font:800 19px var(--display);letter-spacing:.03em;text-transform:uppercase}
.how .sq-label{font:600 11px var(--mono);letter-spacing:.03em;text-transform:uppercase}
.how .questions{padding:clamp(28px,4vw,46px) 0 clamp(52px,8vw,90px);border-top:1px solid var(--line)}
.how .questions h2{font-size:clamp(36px,4.4vw,56px);line-height:.95;margin:0}
.how .faq dt{font:750 24px/1.05 var(--display);text-transform:uppercase;margin:0 0 6px}
.how .faq dd{color:var(--soft);font-size:16px}
.how .faq ul{margin:8px 0 0;padding-left:18px}
@media(max-width:640px){.how .sq-head{font-size:16px}.how .board li{grid-template-columns:30px minmax(0,1fr)}.how .board .status{grid-column:2;justify-self:start}}
`;

/** The API's operations as three departure boards, by what each needs from the passenger. */
function operationBoards(guide: AgentGuide) {
  const operations = guideOperations(guide.paths, guide.discovery);
  const boards: Array<
    [title: string, who: string, list: typeof operations, state: string]
  > = [
    [
      "Open to anyone",
      "No sign-in",
      operations.filter((o) => !o.signedIn && !o.approval),
      '<span class="status quiet">open</span>',
    ],
    [
      "After you sign in",
      "Only your own trips",
      operations.filter((o) => o.signedIn && !o.approval),
      '<span class="status quiet">read only</span>',
    ],
    [
      "Needs your approval",
      "Held until you approve",
      operations.filter((o) => o.approval),
      '<span class="status">your approval</span>',
    ],
  ];
  let n = 0;
  return boards
    .filter(([, , list]) => list.length)
    .map(
      ([title, who, list, state]) =>
        `<div class="board"><div class="board-head"><h3>${title}</h3><p>${who}</p></div><ul>${list.map((o) => `<li><span class="n" aria-hidden="true">${String(++n).padStart(2, "0")}</span><span><strong>${escape(o.name)}</strong><code>${breakablePath(o.where)}</code></span>${state}</li>`).join("")}</ul></div>`,
    )
    .join("");
}

/** The upgrade the passenger approves, as a page of the trip. */
function upgradePass(example: AgentGuide["example"]) {
  return `<div class="pass" role="img" aria-label="Upgrade of flight ${escape(example.flight)} from ${escape(example.from.city)} to ${escape(example.to.city)} on booking ${escape(example.booking)} for ${escape(example.passenger)}: the cabin goes from ${escape(example.fromCabin)} to ${escape(example.toCabin)} for ${money(example.cents)}, waiting for your approval."><div class="pass-head"><strong>${escape(example.flight)}</strong><span>${escape(example.departs)}</span></div><p class="pass-route">${escape(example.from.city)} → ${escape(example.to.city)}<small>${escape(example.from.code)} → ${escape(example.to.code)} · booking ${escape(example.booking)} · ${escape(example.passenger)}</small></p><dl><div><dt>Cabin</dt><dd><s>${escape(example.fromCabin)}</s> → <span class="to">${escape(example.toCabin)}</span></dd></div><div><dt>To pay</dt><dd>${money(example.cents)}</dd></div></dl><p class="terms">${escape(example.refund)}</p><div class="pass-foot"><span class="status">Waiting for your approval</span><span>You approve or decline in your agent.</span></div></div>`;
}

const approvalSequence = (example: AgentGuide["example"], narrow = false) =>
  approvalSequenceSvg(
    {
      id: "northwind-approval",
      company: "Northwind",
      request: `Upgrade ${example.flight}`,
      held: "The upgrade waits · nothing is charged",
      ink: "#102a38",
      ground: "#f7f4ea",
      paper: "#fffdf6",
      line: "#91aab4",
      accent: "#efb73e",
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
      "No. Your agent finds Northwind on its own. To see or change your trips you sign in on this site, on a page we show you, and choose what the agent may do.",
    ],
    [
      "What can an agent do without me?",
      "Search flights and the cheapest dates, check a flight&#39;s status, read the baggage, check-in and fare rules, look up a booking with its reference and surname, and ask our automated travel desk. Nothing from your account.",
    ],
    [
      "What needs my approval?",
      "Every change: a seat, a bag, your meal or assistance preference, an upgrade, another flight or a cancellation. You see the exact price, fee or refund first, and Northwind applies it once, after you approve.",
    ],
    [
      "Does the agent get my password?",
      'No. You sign in on Northwind&#39;s own page. The agent gets a permission, and you can take it away under <a href="/account">My Northwind</a>.',
    ],
    [
      "What can&#39;t an agent do here?",
      `These are not offered through an agent:<ul>${guide.excluded.map((task) => `<li>${escape(task)}</li>`).join("")}</ul>For assistance that needs documents checked, call <span class="mono tel">${escape(guide.phone)}</span> (a fictional number).`,
    ],
    [
      "Which agents work here?",
      `Any personal agent that follows Personal Agent Protocol 1.0. <a href="${escape(labPlaygroundUrl(origin))}">Iris</a>, the agent of Poppy Lab, is one you can try now. The addresses an agent needs are under <a href="/for-agents">For agents</a>.`,
    ],
  ];
  const body = `<main class="wrap how"><section class="how-head"><h1>How Northwind works with your agent.</h1><p>Northwind takes requests from personal AI agents through Personal Agent Protocol, an open protocol. It takes three steps. Each is shown here as this site serves it.</p></section><section aria-label="The three steps"><article class="step"><div><span class="num" aria-hidden="true">01</span><h2>Your agent finds the airline</h2><p class="say">Every agent starts at one small file on our site. This is ours, as an agent reads it.</p><ol class="keys">${keys}</ol></div><div class="doc"><p class="doc-head"><code>/.well-known/poppy.json</code><span>as served to every agent</span></p><pre tabindex="0" aria-label="Northwind&#39;s discovery document">${annotatedJsonHtml(guide.discovery, shown, { width: 78 })}</pre></div></article><article class="step"><div><span class="num" aria-hidden="true">02</span><h2>The airline says what it can do</h2><p class="say">The file leads to our API: a board of things an agent may ask for, each with one job. Search is open to anyone, your trips open once you sign in, and every change waits for you.</p></div><div>${operationBoards(guide)}</div></article><article class="step"><div><span class="num" aria-hidden="true">03</span><h2>You approve the upgrade</h2><p class="say">Ask your agent: <q>${escape(example.ask)}</q> It proposes the upgrade, and Northwind answers with the exact price and terms and holds it. Nothing is charged or changed until you approve, and then it happens once.</p>${upgradePass(example)}</div><figure class="seq">${approvalSequence(example)}${approvalSequence(example, true)}<figcaption>Northwind answers the first request with the terms, not with the upgrade. The yellow step is yours.</figcaption></figure></article></section><section class="questions" aria-labelledby="questions-title"><h2 id="questions-title">Questions</h2><dl class="faq">${questions.map(([q, a]) => `<div><dt>${q}</dt><dd>${a}</dd></div>`).join("")}</dl></section></main>`;
  return shell(
    "How it works with your agent · Northwind Air",
    body,
    "/how-it-works",
    origin,
    css,
  );
}
