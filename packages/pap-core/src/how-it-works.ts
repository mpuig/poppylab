/**
 * What the Companies' "How it works" pages share. Each page shows a visitor
 * three things as the Company's own endpoints serve them: its discovery
 * document, its API's operations, and one change waiting for approval. The
 * words, the picture of that change and the look belong to each Company;
 * the parts here only read the served objects and lay them out.
 */
const escape = (text: string) =>
  text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);

/** JSON on one line, spaced as a person would write it. */
function inlineJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(inlineJson).join(", ")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    return entries.length
      ? `{ ${entries.map(([key, item]) => `${JSON.stringify(key)}: ${inlineJson(item)}`).join(", ")} }`
      : "{}";
  }
  return JSON.stringify(value);
}

export type JsonLine = {
  depth: number;
  text: string;
  /** Set on a line that stands for a folded value: not JSON, said in words. */
  folded?: true;
};

export type JsonLayout = {
  /**
   * Values to say in words, by dotted path ("auth.scopes"), for a list too
   * long to show whole. A page that folds says so beside the document.
   */
  fold?: Readonly<Record<string, string>>;
  /** The characters a line may hold before its value opens up; 76 when omitted. */
  width?: number;
};

/**
 * A document's lines: a value stays on its line when it is short and opens
 * up when it is not.
 */
export function jsonLines(
  value: unknown,
  layout: JsonLayout = {},
  depth = 0,
  lead = "",
  trail = "",
  path = "",
): JsonLine[] {
  const { fold = {}, width = 76 } = layout;
  const folded = fold[path];
  if (folded !== undefined)
    return [{ depth, text: `${lead}${folded}${trail}`, folded: true }];
  const short = inlineJson(value);
  const foldsInside = Object.keys(fold).some((key) =>
    key.startsWith(path ? `${path}.` : ""),
  );
  if (
    value === null ||
    typeof value !== "object" ||
    (!foldsInside &&
      depth * 2 + lead.length + short.length + trail.length <= width)
  )
    return [{ depth, text: `${lead}${short}${trail}` }];
  const array = Array.isArray(value);
  const entries: Array<[lead: string, item: unknown, path: string]> = array
    ? value.map((item, i) => ["", item, `${path}.${i}`])
    : Object.entries(value).map(([key, item]) => [
        `${JSON.stringify(key)}: `,
        item,
        path ? `${path}.${key}` : key,
      ]);
  return [
    { depth, text: `${lead}${array ? "[" : "{"}` },
    ...entries.flatMap(([key, item, itemPath], i) =>
      jsonLines(
        item,
        layout,
        depth + 1,
        key,
        i < entries.length - 1 ? "," : "",
        itemPath,
      ),
    ),
    { depth, text: `${array ? "]" : "}"}${trail}` },
  ];
}

/**
 * A discovery document as HTML lines (`.ln`, `.d0`–`.d5` by depth), each key
 * in a `.k`. A top-level key listed in `marked` gets `.hit` and a numbered
 * `.mark`, in the order of `marked`, so a legend beside it can use the same
 * numbers.
 */
export function annotatedJsonHtml(
  document: Record<string, unknown>,
  marked: readonly string[],
  layout: JsonLayout = {},
) {
  return jsonLines(document, layout)
    .map(({ depth, text, folded }) => {
      const key = depth === 1 ? /^"([^"]+)":/.exec(text)?.[1] : undefined;
      const number = key === undefined ? 0 : marked.indexOf(key) + 1;
      let html = escape(text).replace(
        /^(&#34;[^&]*&#34;)(:)/,
        '<span class="k">$1</span>$2',
      );
      // The words that stand for a folded value are set apart from the JSON.
      if (folded)
        html = html.replace(
          /^((?:<span class="k">.*?<\/span>: )?)(.*?)(,?)$/,
          '$1<i class="fold">$2</i>$3',
        );
      return `<span class="ln d${Math.min(depth, 5)}${number ? " hit" : ""}">${number ? `<b class="mark">${number}</b>` : ""}${html}</span>`;
    })
    .join("");
}

/** One operation of an OpenAPI description, as the gateway's Companies write them. */
type DescribedOperation = {
  operationId: string;
  summary: string;
  "x-poppy-scopes"?: readonly string[];
  "x-poppy-proposal"?: boolean;
};
export type GuidePaths = Record<string, Record<string, DescribedOperation>>;

export type GuideOperation = {
  /** The operation's id in words: "change order". */
  name: string;
  /** "POST /api/account/orders/{order_id}/changes". */
  where: string;
  /** The first clause of the API's own summary, without its full stop. */
  text: string;
  /** Needs the customer to have signed in. */
  signedIn: boolean;
  /** Proposes a change that waits for the customer's approval. */
  approval: boolean;
};

/**
 * The API's operations in the order it lists them, then the Company's own
 * agent when the discovery document names one. `paths` is the object the
 * Company serves in its OpenAPI description.
 */
export function guideOperations(
  paths: GuidePaths,
  discovery: Record<string, unknown>,
): GuideOperation[] {
  const operations = Object.entries(paths).flatMap(([path, methods]) =>
    Object.entries(methods).map(([method, operation]) => ({
      name: operation.operationId.replace(/_/g, " "),
      where: `${method.toUpperCase()} ${path}`,
      text: operation.summary.split(/[:.;]/)[0] ?? "",
      signedIn: (operation["x-poppy-scopes"] ?? []).length > 0,
      approval: operation["x-poppy-proposal"] === true,
    })),
  );
  const agent = (
    discovery.agent as
      | { protocols?: Array<{ endpoint?: string; description?: string }> }
      | undefined
  )?.protocols?.[0];
  if (agent?.endpoint)
    operations.push({
      name: "ask our agent",
      where: `POST ${new URL(agent.endpoint).pathname}`,
      text: (agent.description ?? "").split(/[.;]/)[0] ?? "",
      signedIn: false,
      approval: false,
    });
  return operations;
}

/**
 * The tasks a Company excludes, as the end of a sentence said to the
 * customer: "cancel an order or change the delivery address of an order".
 */
export function guideExcluded(tasks: readonly string[]) {
  const said = tasks.map((task) =>
    (task.charAt(0).toLowerCase() + task.slice(1)).replace(/\bmy\b/g, "your"),
  );
  return said.length > 1
    ? `${said.slice(0, -1).join(", ")} or ${said.at(-1)}`
    : (said[0] ?? "");
}

/** A method and path with a break allowed after each slash, for a narrow label. */
export const breakablePath = (where: string) =>
  escape(where).replace(/\//g, "/<wbr>");

export type SequenceLook = {
  /** Unique on the page; the narrow drawing adds "-narrow". */
  id: string;
  /** The Company's name on the third lifeline. */
  company: string;
  /** Message 2 in the Company's own words: "Change order", "Transfer $500". */
  request: string;
  /** The words on the band where the proposal waits. */
  held: string;
  /** Lines, arrowheads, text and the Company's own head. */
  ink: string;
  /** The page's ground, behind each label. */
  ground: string;
  /** The two lighter heads and the waiting band. */
  paper: string;
  /** The lifelines. */
  line: string;
  /** The customer's own step and the band's edge. */
  accent: string;
  /** Text on the accent; the ink when omitted. */
  accentInk?: string;
};

/**
 * Who says what when a change is approved: three lifelines and six
 * messages, straight and level, each label on its own ground above its
 * line, replies dashed. The customer's approval is the one message in the
 * accent. Drawn 640 units wide, or 360 for a phone, where a label may cross
 * a lifeline on its own ground. Text takes the classes `sq-head` and
 * `sq-label`, which the page styles in its own faces.
 */
export function approvalSequenceSvg(look: SequenceLook, narrow = false) {
  const id = `${look.id}${narrow ? "-narrow" : ""}`;
  const width = narrow ? 360 : 640;
  const at = narrow
    ? { you: 52, agent: 180, company: 308 }
    : { you: 90, agent: 320, company: 550 };
  const box = narrow ? 100 : 156;
  const accentInk = look.accentInk ?? look.ink;
  const messages: Array<
    [from: keyof typeof at, to: keyof typeof at, label: string, kind?: string]
  > = [
    ["you", "agent", "Ask for a change"],
    ["agent", "company", look.request],
    ["company", "agent", "403 · exact terms", "reply"],
    ["you", "agent", "Approve", "yours"],
    ["agent", "company", "Again, with approval"],
    ["company", "agent", "Changed, once", "reply"],
  ];
  const rows = messages
    .map(([from, to, label, kind], i) => {
      const y = 98 + i * 48 + (i >= 3 ? 48 : 0);
      const x1 = at[from],
        x2 = at[to];
      const text = `${i + 1} · ${label}`;
      const ground = text.length * 7.9 + 16;
      // Centred on its arrow, and kept inside the picture.
      const middle = Math.min(
        Math.max((x1 + x2) / 2, ground / 2 + 4),
        width - ground / 2 - 4,
      );
      const yours = kind === "yours";
      return `<line x1="${x1}" y1="${y}" x2="${x2 > x1 ? x2 - 10 : x2 + 10}" y2="${y}" stroke="${yours ? look.accent : look.ink}" stroke-width="${yours ? 2.5 : 1.5}"${kind === "reply" ? ' stroke-dasharray="5 4"' : ""} marker-end="url(#${id}-${yours ? "accent" : "ink"})"/><rect x="${middle - ground / 2}" y="${y - 27}" width="${ground}" height="18" rx="2" fill="${yours ? look.accent : look.ground}"/><text class="sq-label" x="${middle}" y="${y - 14}" text-anchor="middle" fill="${yours ? accentInk : look.ink}">${escape(text)}</text>`;
    })
    .join("");
  const head = (x: number, label: string, own: boolean) =>
    `<rect x="${x - box / 2}" y="8" width="${box}" height="40" rx="6" fill="${own ? look.ink : look.paper}" stroke="${look.ink}" stroke-width="1.5"/><text class="sq-head" x="${x}" y="34" text-anchor="middle" fill="${own ? look.paper : look.ink}">${escape(label)}</text>`;
  const marker = (name: string, fill: string) =>
    `<marker id="${id}-${name}" viewBox="0 0 10 10" refX="1" refY="5" markerUnits="userSpaceOnUse" markerWidth="11" markerHeight="11" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${fill}"/></marker>`;
  const lifelines = Object.values(at)
    .map(
      (x) =>
        `<line x1="${x}" y1="48" x2="${x}" y2="398" stroke="${look.line}" stroke-width="1.5"/>`,
    )
    .join("");
  // Between the terms and the approval nothing has changed: the band says so across all three.
  const held = `<rect x="${narrow ? 2 : 12}" y="216" width="${width - (narrow ? 4 : 24)}" height="30" rx="4" fill="${look.paper}" stroke="${look.accent}" stroke-width="1.5" stroke-dasharray="6 4"/><text class="sq-label" x="${width / 2}" y="235" text-anchor="middle" fill="${look.ink}">${escape(look.held)}</text>`;
  const company = escape(look.company);
  return `<svg class="${narrow ? "narrow" : "wide"}" viewBox="0 0 ${width} 410" role="img" aria-labelledby="${id}-title ${id}-desc"><title id="${id}-title">How a change is approved</title><desc id="${id}-desc">You ask your agent for a change. Your agent sends it to ${company}, which answers with the exact terms and changes nothing. You approve. Your agent sends the same request again with your approval, and ${company} makes the change once.</desc><defs>${marker("ink", look.ink)}${marker("accent", look.accent)}</defs>${lifelines}${held}${rows}${head(at.you, "You", false)}${head(at.agent, "Your agent", false)}${head(at.company, look.company, true)}</svg>`;
}

/**
 * The layout the four pages share, under `.how`: a step is words beside the
 * real thing (4/7, one column at 1000px and below, the words staying in view
 * while a long thing scrolls past); the document's lines hang by depth; the
 * diagram swaps to its narrow drawing at 640px; questions run in two
 * columns. Colours and faces come from each Company's own rules, through
 * `--how-rule`, `--how-mark` and `--how-mark-ink` where the layout needs one.
 */
export const howItWorksLayoutCss = `.how .step{display:grid;grid-template-columns:minmax(0,4fr) minmax(0,7fr);gap:clamp(20px,4vw,48px);align-items:start;padding:clamp(24px,4vw,40px) 0;border-top:1px solid var(--how-rule)}
.how .step>div:first-child{position:sticky;top:24px}
.how .step>*{min-width:0}
.how .num{display:block}
.how .say{margin:0;max-width:44ch}
.how .mark{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;background:var(--how-mark);color:var(--how-mark-ink);font-weight:700;font-size:12px;line-height:1;font-style:normal}
.how .keys{list-style:none;margin:20px 0 0;padding:0;display:grid;gap:10px;font-size:15px;line-height:1.45}
.how .keys li{display:grid;grid-template-columns:22px minmax(0,1fr);gap:12px}
.how .doc{overflow:hidden}
.how .doc-head{margin:0;display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:4px 12px;padding:12px 18px}
.how .doc pre{margin:0;padding:14px 0;font-size:13px;line-height:1.65;white-space:pre-wrap;overflow-wrap:anywhere}
.how .ln{display:block;position:relative;padding:0 18px 0 calc(46px + var(--d,0)*2ch + 2ch);text-indent:-2ch}
.how .d1{--d:1}.how .d2{--d:2}.how .d3{--d:3}.how .d4{--d:4}.how .d5{--d:5}
.how .ln .mark{position:absolute;left:14px;top:1px;width:20px;height:20px;font-size:11px;text-indent:0}
.how .seq{margin:0}
.how .seq svg{display:block;width:100%;height:auto}
.how .seq .narrow{display:none}
.how .faq{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px clamp(24px,4vw,56px);margin:20px 0 0}
.how .faq dd{margin:0;max-width:52ch}
.how .tel{white-space:nowrap}
@media(max-width:1000px){.how .step,.how .faq{grid-template-columns:minmax(0,1fr)}.how .step>div:first-child{position:static}}
@media(max-width:640px){.how .seq .wide{display:none}.how .seq .narrow{display:block;max-width:420px}.how .doc pre{font-size:12px}}
`;
