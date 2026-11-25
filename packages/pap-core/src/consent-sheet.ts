/**
 * The Companies' consent pages share one sheet: who is asking, then two
 * columns (who the visitor signs in as, and what the agent may do), then
 * one sentence and the same two buttons. The words are the same at every
 * Company, so a visitor who has allowed one agent knows the next page; the
 * header, faces and colours are each Company's own.
 *
 * Server-rendered with no script: the consent Content-Security-Policy
 * allows none. The form posts the fields the gateway reads (`nonce`,
 * `account`, `password`, `decision`) and whatever each Company's
 * `selectScopes` and `selectResources` read.
 */
const escape = (text: string) =>
  text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);

/** A checkbox the visitor may untick. */
export type ConsentOption = {
  /** The form field; its value is "yes". */
  name: string;
  title: string;
  text: string;
  /** Ticked when the page opens. */
  checked?: boolean;
  /** The form can't be allowed without it (it is all that was asked for). */
  required?: boolean;
};

export type ConsentSheet = {
  /** The account's short name, in the title: "Harborline". */
  company: string;
  /** The agent's `client_name`: self-asserted, so shown with `agentHost`. */
  agent: string;
  /** Host of the verified `client_id`. */
  agentHost: string;
  nonce: string;
  passwordRequired: boolean;
  /** Who the visitor can sign in as; the first is chosen when the page opens. */
  people: ReadonlyArray<{ id: string; name: string; note: string }>;
  /** "customer" unless the Company has another word for it. */
  personKind?: string;
  /** Trusted HTML under the people: what else is chosen with the person. */
  beside?: string;
  /** What the agent may read, without asking again. */
  reads: ReadonlyArray<{ title?: string; text: string }>;
  /** Said in place of the list when nothing of the visitor's is read. */
  noReads?: string;
  /** The changes the agent may propose. */
  changes: readonly ConsentOption[];
  /** Said in place of the options when no change can be proposed. */
  noChanges?: string;
  /** Further choices, each under its own heading. */
  extras?: ReadonlyArray<{ heading: string; option: ConsentOption }>;
  /** Where the visitor can take the permission away: one sentence. */
  disconnect: string;
  /** The Company's notice that nothing here is real. */
  fine: string;
};

const option = (o: ConsentOption) =>
  `<label class="sheet-option"><input type="checkbox" name="${escape(o.name)}" value="yes"${o.checked ? " checked" : ""}${o.required ? " required" : ""}><span><strong>${escape(o.title)}</strong><span>${escape(o.text)}</span></span></label>`;

/** The sheet, as the page's `<main>`. Every value is escaped except `beside`. */
export function consentSheetHtml(sheet: ConsentSheet) {
  const agent = escape(sheet.agent);
  const kind = escape(sheet.personKind ?? "customer");
  const people = sheet.people
    .map(
      (person, i) =>
        `<label class="sheet-person"><input type="radio" name="account" id="account-${escape(person.id)}" value="${escape(person.id)}"${i === 0 ? " checked" : ""}><span><strong>${escape(person.name)}</strong><small>${escape(person.note)}</small></span></label>`,
    )
    .join("");
  const password = sheet.passwordRequired
    ? '<div class="sheet-field"><label for="password">Demo password</label><input id="password" type="password" name="password" required autocomplete="current-password" maxlength="256" aria-describedby="password-hint"><p id="password-hint" class="sheet-note">It protects the whole demo, not each account. Don&#39;t use a password from another service.</p></div>'
    : "";
  const reads = sheet.reads.length
    ? `<ul class="sheet-reads">${sheet.reads.map((read) => `<li>${read.title ? `<strong>${escape(read.title)}</strong>` : ""}<span>${escape(read.text)}</span></li>`).join("")}</ul>`
    : `<p class="sheet-none">${escape(sheet.noReads ?? "Nothing of yours is read.")}</p>`;
  const changes = sheet.changes.length
    ? sheet.changes.map(option).join("")
    : `<p class="sheet-none">${escape(sheet.noChanges ?? "None. This permission is read only.")}</p>`;
  const extras = (sheet.extras ?? [])
    .map(
      (extra) =>
        `<div class="sheet-group"><h3>${escape(extra.heading)}</h3>${option(extra.option)}</div>`,
    )
    .join("");
  return `<main class="sheet"><div class="sheet-head"><h1>${agent} wants to connect to your ${escape(sheet.company)} account</h1><p class="sheet-agent"><strong>${agent}</strong><span>from ${escape(sheet.agentHost)}</span><span class="sheet-verified">address verified</span></p></div><form method="post" action="/oauth/authorize"><input type="hidden" name="nonce" value="${escape(sheet.nonce)}"><div class="sheet-cols"><fieldset class="sheet-you"><legend>Sign in as</legend>${people}<p class="sheet-note">Test ${kind}s. Choosing one doesn&#39;t verify who you are.</p>${password}${sheet.beside ?? ""}</fieldset><section class="sheet-may" aria-labelledby="sheet-may-title"><h2 id="sheet-may-title">What ${agent} may do</h2><div class="sheet-group"><h3>Read <span>without asking you again</span></h3>${reads}</div><div class="sheet-group"><h3>Propose changes <span>each one waits for your approval</span></h3>${changes}</div>${extras}</section></div><div class="sheet-foot"><p>Nothing changes when you allow. ${escape(sheet.disconnect)}</p><div class="sheet-actions"><button class="secondary" name="decision" value="decline" formnovalidate>Don&#39;t allow</button><button name="decision" value="approve">Allow</button></div></div></form><p class="sheet-fine">${escape(sheet.fine)}</p></main>`;
}

/**
 * The strip above a Company's header on its consent page: the same graphite
 * and amber as `labBarHtml`, without its links, so nothing on the page leads
 * away from the decision.
 */
export function labConsentBarHtml(company: string) {
  return `<aside aria-label="About this demo" style="margin:0;padding:8px 16px;background:#171a1f;color:#e3e6ea;font:400 13px/1.45 system-ui,-apple-system,'Segoe UI',sans-serif;text-align:center;letter-spacing:0;text-transform:none"><strong style="color:#f2b705;font-weight:600">Demo</strong> · ${escape(company)} is a fictional company in Poppy&nbsp;Lab. Nothing here is real.</aside>`;
}

/**
 * The sheet's layout. A Company adds its faces and colours, and sets
 * `--sheet-rule` (hairlines) and `--sheet-accent` (the chosen person and
 * the ticks).
 */
export const consentSheetCss = `.sheet{width:min(1040px,100% - 2*clamp(18px,4vw,48px));margin-inline:auto;padding:clamp(32px,5vw,60px) 0 clamp(40px,6vw,72px)}
.sheet-head{margin-bottom:clamp(22px,3.5vw,36px)}
.sheet h1{margin:0 0 14px;max-width:26ch;text-wrap:balance}
.sheet-agent{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px;margin:0}
.sheet form{margin:0}
.sheet-cols{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:clamp(28px,5vw,64px);align-items:start;padding-top:clamp(20px,3vw,30px);border-top:1px solid var(--sheet-rule)}
.sheet fieldset{border:0;margin:0;padding:0;min-width:0}
.sheet legend,.sheet h2{display:block;padding:0;margin:0 0 14px}
.sheet-person{display:grid;grid-template-columns:22px minmax(0,1fr);gap:12px;align-items:start;margin:0;padding:14px 16px;border:1px solid var(--sheet-rule);cursor:pointer}
.sheet-person+.sheet-person{margin-top:10px}
.sheet-person input,.sheet-option input{width:20px;height:20px;min-height:0;margin:2px 0 0;padding:0;accent-color:var(--sheet-accent);cursor:pointer}
.sheet-person strong,.sheet-person small,.sheet-option strong,.sheet-option span span{display:block}
.sheet-person:has(input:checked){border-color:var(--sheet-accent);box-shadow:inset 0 0 0 1px var(--sheet-accent)}
.sheet-note{margin:12px 0 0;font-size:14px}
.sheet-field{margin-top:22px}
.sheet-field label{display:block;margin:0 0 8px}
.sheet-field input{display:block;width:100%;min-height:48px;margin:0;padding:10px 12px;font:inherit}
.sheet-group{padding:18px 0;border-top:1px solid var(--sheet-rule)}
.sheet-may h2+.sheet-group{border-top:0;padding-top:0}
.sheet-group:last-child{padding-bottom:0}
.sheet-group h3{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 10px;margin:0 0 10px}
.sheet-reads{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.sheet-reads strong{display:block}
.sheet-none{margin:0}
.sheet-option{display:grid;grid-template-columns:22px minmax(0,1fr);gap:12px;align-items:start;margin:0;padding:6px 0;cursor:pointer}
.sheet-foot{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:16px 32px;margin-top:clamp(24px,4vw,40px);padding-top:24px;border-top:1px solid var(--sheet-rule)}
.sheet-foot p{margin:0;max-width:52ch}
.sheet-actions{display:flex;gap:12px;margin-left:auto}
.sheet button{min-height:48px;padding:0 26px;cursor:pointer}
.sheet-fine{margin:28px 0 0;max-width:84ch}
@media(max-width:760px){.sheet-cols{grid-template-columns:minmax(0,1fr)}.sheet-actions{width:100%}.sheet-actions button{flex:1}}
`;
