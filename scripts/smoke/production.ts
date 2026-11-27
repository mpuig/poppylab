/**
 * Checks what a visitor to the deployed lab sees: each Company's discovery
 * and pages, the playground and Learn, and the demo's scripted examples
 * through the playground's own HTTP API, as a new anonymous visitor. Then,
 * as another new visitor, it signs in at one Company (a different one each
 * hour), reads the account, asks for the change permission and one
 * proposal, declines it and signs out.
 *
 * It never approves anything: the hourly run leaves nothing done at any
 * Company. Cookies, codes and `state` stay in memory and are never printed;
 * an error names a URL without its query. Run it with
 * `pnpm smoke:production`, which borrows `tsx` from Juniper's dev
 * dependencies, since the root has none.
 *
 *   --local               the local servers (localhost:3000 and the Companies' ports)
 *   --lab=<url>           the playground and Learn
 *   --juniper=<url> …     a Company (juniper, lantern, harborline, northwind, fernwick)
 *   --all-media           every Learn media file, not this hour's third
 *   --sign-in=<company>   sign in at that Company, not this hour's
 *
 * Exits 1 when a check fails, and writes the table to the GitHub Actions
 * job summary when there is one.
 */
import { appendFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { labSites } from "../../packages/pap-core/src/index.ts";
import { discoverCompany } from "../../packages/pap-client/src/index.ts";
import { labCompanies } from "../../apps/playground/app/playground/companies.ts";
import {
  DEMO_SUGGESTIONS,
  demoGuidedReply,
} from "../../packages/pap-agent/src/demo-examples.ts";

/** A request slower than this fails its check; one slower than `WARN_MS` is reported. */
const FAIL_MS = 20_000;
const WARN_MS = 8_000;
/** Each hourly run checks one share of the Learn media, so a run stays well under 200 requests. */
const MEDIA_SHARES = 3;
/** The Company pages a visitor reads before connecting an agent. */
const COMPANY_PAGES = ["/", "/for-agents", "/how-it-works", "/site/login"];

type Status = "pass" | "warn" | "fail";
type Result = { name: string; status: Status; ms: number; reason?: string };

const args = process.argv.slice(2).filter((a) => a !== "--");
const flag = (name: string) =>
  args
    .find((a) => a.startsWith(`--${name}=`))
    ?.slice(name.length + 3)
    .replace(/\/+$/, "");
const sites = labSites(
  args.includes("--local") ? "http://localhost:3000" : "https://poppylab.dev",
);
const lab = flag("lab") ?? sites[0]!.url;
const companies = sites.flatMap((site) => {
  if (site.id === "home" || site.id === "playground") return [];
  const url = flag(site.id) ?? site.url;
  const shown = labCompanies.find((c) => c.name === site.label);
  return [
    {
      key: site.id,
      name: site.label,
      url,
      origin: new URL(url).origin,
      open: shown?.open ?? [],
      account: shown?.account ?? [],
    },
  ];
});
type Company = (typeof companies)[number];

let requests = 0;
const results: Result[] = [];

/**
 * A URL as the output may show it: without its query, which in a sign-in
 * holds the `state`, the code or the `request_uri`.
 */
const shown = (url: string) => {
  try {
    const { origin, pathname } = new URL(url);
    return origin + pathname;
  } catch {
    return "an address that isn't a URL";
  }
};

/** Times every request of one check, and stops any that takes longer than `FAIL_MS`. */
class Timer {
  slowest = 0;
  slowestUrl = "";

  fetch = async (input: string | URL, init: RequestInit = {}) => {
    const url = shown(String(input));
    const method = (init.method ?? "GET").toUpperCase();
    for (let attempt = 0; ; attempt += 1) {
      requests += 1;
      const started = performance.now();
      const limit = AbortSignal.timeout(FAIL_MS);
      try {
        const response = await fetch(input, {
          ...init,
          signal: init.signal ? AbortSignal.any([init.signal, limit]) : limit,
        });
        this.note(url, started);
        return response;
      } catch (error) {
        this.note(url, started);
        if (limit.aborted)
          throw new Error(`No answer within ${FAIL_MS / 1000} s: ${url}`, {
            cause: error,
          });
        // A dropped connection on a read is tried once more; a POST never is.
        if (attempt === 0 && (method === "GET" || method === "HEAD")) continue;
        throw new Error(`${url} could not be reached`, { cause: error });
      }
    }
  };

  private note(url: string, started: number) {
    const ms = Math.round(performance.now() - started);
    if (ms >= this.slowest) {
      this.slowest = ms;
      this.slowestUrl = url;
    }
  }
}

async function check(name: string, body: (t: Timer) => Promise<void>) {
  const t = new Timer();
  try {
    await body(t);
    results.push(
      t.slowest > WARN_MS
        ? {
            name,
            status: "warn",
            ms: t.slowest,
            reason: `${(t.slowest / 1000).toFixed(1)} s for ${t.slowestUrl}`,
          }
        : { name, status: "pass", ms: t.slowest },
    );
    return true;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    results.push({ name, status: "fail", ms: t.slowest, reason });
    return false;
  }
}

/** Runs `fn` over `items`, a few at a time. */
async function pool<T>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<void>,
) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]!);
    }),
  );
}

/** The forms a name can take in HTML: "Fernwick Power &amp; Light". */
const inPage = (html: string, name: string) =>
  [name, name.replace(/&/g, "&amp;"), name.replace(/&/g, "&#38;")].some((n) =>
    html.includes(n),
  );

/** Several failures in one line: the first three, and how many more. */
const listed = (failures: string[]) =>
  failures.slice(0, 3).join("; ") +
  (failures.length > 3 ? `; and ${failures.length - 3} more` : "");

// ---- Companies --------------------------------------------------------------

async function checkCompany(company: Company) {
  await check(`${company.name}: discovery`, async (t) => {
    const local = new URL(company.url).protocol === "http:";
    const found = await discoverCompany(company.url, {
      fetchImpl: t.fetch as typeof fetch,
      timeoutMs: FAIL_MS,
      allowedPrivateOrigins: local ? [company.origin] : [],
    }).catch((error: Error) => {
      throw new Error(`Discovery failed: ${error.message}`);
    });
    const named = found.document.organization.name;
    if (named !== company.name)
      throw new Error(`poppy.json names "${named}", not "${company.name}"`);
    // Every lab Company offers sign-in, so it must have an issuer.
    if (!found.profile.issuer)
      throw new Error("Discovery found no OAuth issuer for the domain");
  });
  await check(`${company.name}: pages`, async (t) => {
    const failures: string[] = [];
    await pool(COMPANY_PAGES, 4, async (path) => {
      const response = await t.fetch(new URL(path, company.url));
      const html = await response.text();
      if (response.status !== 200)
        failures.push(`${path} answered ${response.status}`);
      else if (!inPage(html, company.name))
        failures.push(`${path} doesn't name ${company.name}`);
    });
    if (failures.length) throw new Error(listed(failures));
  });
}

// ---- Playground and Learn ---------------------------------------------------

async function checkSite() {
  await check("Playground page", async (t) => {
    const response = await t.fetch(`${lab}/playground`);
    const html = await response.text();
    if (response.status !== 200)
      throw new Error(`/playground answered ${response.status}`);
    if (!/<title>[^<]*Playground/.test(html))
      throw new Error("/playground has no Playground title");
  });

  // The index lists each section; a section's page lists its own pages.
  const pages = new Set(["/learn"]);
  const media = new Set<string>();
  const failures: string[] = [];
  const row = results.length;
  await check("Learn pages", async (t) => {
    const queue = ["/learn"];
    while (queue.length) {
      const batch = queue.splice(0);
      await pool(batch, 4, async (path) => {
        const response = await t.fetch(`${lab}${path}`);
        const html = await response.text();
        if (response.status !== 200) {
          failures.push(`${path} answered ${response.status}`);
          return;
        }
        if (!html.includes("<h1")) failures.push(`${path} has no heading`);
        for (const [, link] of html.matchAll(
          /href="(\/learn(?:\/[a-z0-9-]+)*)(?:#[^"]*)?"/g,
        ))
          if (link && !pages.has(link) && pages.size < 80) {
            pages.add(link);
            queue.push(link);
          }
        for (const [, file] of html.matchAll(
          /(?:src|href|poster|srcset)="(\/learn-media\/[^"\s?#]+)/g,
        ))
          if (file) media.add(file);
      });
    }
    if (failures.length) throw new Error(listed(failures));
  });
  // How many there are is known once they have been read.
  results[row]!.name = `Learn pages (${pages.size})`;

  const all = [...media].sort();
  const share = args.includes("--all-media")
    ? undefined
    : new Date().getUTCHours() % MEDIA_SHARES;
  const chosen = all.filter(
    (_, i) => share === undefined || i % MEDIA_SHARES === share,
  );
  await check(`Learn media (${chosen.length} of ${all.length})`, async (t) => {
    if (!all.length) throw new Error("The Learn pages reference no media");
    const missing: string[] = [];
    await pool(chosen, 6, async (file) => {
      const response = await t.fetch(`${lab}${file}`, { method: "HEAD" });
      if (response.status !== 200)
        missing.push(`${file} answered ${response.status}`);
    });
    if (missing.length) throw new Error(listed(missing));
  });
}

// ---- The playground's HTTP API ----------------------------------------------

/** A proposal as the playground keeps it (`Operation` in pap-agent). */
type Proposal = {
  operation_id: string;
  revision: string;
  state: string;
  terms?: Record<string, unknown>;
  expires_at: string;
  result?: { summary: string } | null;
};

type Answer = {
  status: number;
  conversation: string | null;
  body: {
    error?: string;
    code?: string;
    text?: string;
    mode?: string;
    from?: { origin: string; name: string };
    choices?: Array<{ label: string; answer: Record<string, unknown> }>;
    connections?: Array<{
      origin: string;
      name: string;
      signedIn?: boolean;
      scopes?: string;
      operations?: Proposal[];
    }>;
    document?: { organization?: { name?: string } };
    profile?: { scopeHints?: Record<string, { changes?: string }> };
    signedIn?: boolean;
    data?: string;
    url?: string;
    operations?: Proposal[];
    operation?: Proposal;
    trace?: string[];
  };
};

/** One site's cookies, kept here and nowhere else, as a browser keeps them. */
class Jar {
  private cookies = new Map<string, string>();

  header(): Record<string, string> {
    return this.cookies.size
      ? {
          cookie: [...this.cookies]
            .map(([name, value]) => `${name}=${value}`)
            .join("; "),
        }
      : {};
  }

  keep(response: Response) {
    for (const line of response.headers.getSetCookie()) {
      const [pair = "", ...attributes] = line.split(";");
      const at = pair.indexOf("=");
      const name = pair.slice(0, at).trim();
      const value = pair.slice(at + 1).trim();
      if (!name) continue;
      if (!value || attributes.some((a) => /^\s*max-age=0\s*$/i.test(a)))
        this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
}

/** A JSON answer's body, or an error that says which route gave none. */
async function jsonOf(response: Response, path: string) {
  const text = await response.text();
  try {
    return JSON.parse(text) as Answer["body"];
  } catch {
    throw new Error(`${path} answered ${response.status} without JSON`);
  }
}

/** A new anonymous visitor: its cookies are kept here and nowhere else. */
class Visitor {
  jar = new Jar();
  conversation: string | null = null;

  async post(t: Timer, path: string, body: unknown): Promise<Answer> {
    const headers: Record<string, string> = {
      // The chat and discovery routes take same-origin requests only.
      origin: new URL(lab).origin,
      "content-type": "application/json",
      accept: "application/json",
      ...this.jar.header(),
    };
    if (this.conversation) headers["x-poppy-conversation"] = this.conversation;
    const response = await t.fetch(`${lab}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    this.jar.keep(response);
    const parsed = await jsonOf(response, path);
    const conversation = response.headers.get("x-poppy-conversation");
    if (conversation) this.conversation = conversation;
    return { status: response.status, conversation, body: parsed };
  }

  /** A GET as the browser makes it, its redirect not followed. */
  async get(t: Timer, url: string) {
    const response = await t.fetch(url, {
      headers: this.jar.header(),
      redirect: "manual",
    });
    this.jar.keep(response);
    return response;
  }

  chat(t: Timer, message: string) {
    return this.post(t, "/api/chat", {
      message,
      companies: true,
      provider: "demo",
    });
  }
}

/** Fails unless the answer is a demo answer from `company`, not an error. */
function demoAnswerFrom(answer: Answer, company: Company) {
  const { status, body } = answer;
  if (status !== 200 || body.error)
    throw new Error(
      `Answered ${status}${body.code ? ` ${body.code}` : ""}: ${body.error ?? "no answer"}`,
    );
  if (body.mode !== "demo")
    throw new Error(`Answered in mode "${body.mode}", not as a demo answer`);
  if (body.from?.origin !== company.origin)
    throw new Error(
      `Answered by ${body.from?.name ?? "no Company"}, not ${company.name}`,
    );
  if (!body.text?.trim()) throw new Error("The answer has no text");
}

async function checkPlayground() {
  // Each Company in a conversation of its own, as a visitor picks one.
  const visitor = new Visitor();
  for (const company of companies) {
    visitor.conversation = null;
    const connected = await check(
      `${company.name}: connect in the playground`,
      async (t) => {
        const { status, body, conversation } = await visitor.post(
          t,
          "/api/discover",
          { url: company.url },
        );
        if (status !== 200)
          throw new Error(`Answered ${status}: ${body.error ?? "no error"}`);
        if (body.document?.organization?.name !== company.name)
          throw new Error(
            `Discovery named "${body.document?.organization?.name}"`,
          );
        if (!conversation) throw new Error("No conversation was started");
      },
    );
    if (!connected) continue;
    // A Company with no public example is asked its first account one,
    // which a signed-out visitor is answered by asking to sign in.
    const examples = company.open.length
      ? company.open.map((text) => ({ text, label: text }))
      : company.account
          .slice(0, 1)
          .map((text) => ({ text, label: `${text} (signed out)` }));
    for (const example of examples)
      await check(`${company.name}: “${example.label}”`, async (t) => {
        demoAnswerFrom(await visitor.chat(t, example.text), company);
      });
  }

  // One conversation with two Companies, from a second visitor so the
  // chat's per-visitor budget (8 a minute) holds.
  const harborline = companies.find((c) => c.name === "Harborline Bank")!;
  const lantern = companies.find((c) => c.name === "Lantern Noodle Bar")!;
  const two = new Visitor();
  const connected = await check(
    "Two Companies: “connect with Harborline and Lantern”",
    async (t) => {
      const { status, body } = await two.chat(
        t,
        "connect with Harborline and Lantern",
      );
      if (status !== 200 || body.error)
        throw new Error(`Answered ${status}: ${body.error ?? "no answer"}`);
      if (!two.conversation) throw new Error("No conversation was started");
      const origins = body.connections?.map((c) => c.origin) ?? [];
      for (const company of [harborline, lantern])
        if (!origins.includes(company.origin))
          throw new Error(`${company.name} wasn't connected`);
    },
  );
  if (!connected) return;
  for (const [company, text] of [
    [lantern, lantern.open[0]],
    [harborline, harborline.account[0]],
  ] as const)
    if (text)
      await check(`Two Companies: “${text}”`, async (t) => {
        demoAnswerFrom(await two.chat(t, text), company);
      });
  await check("Two Companies: a message that is no example", async (t) => {
    const { status, body } = await two.chat(t, "Hello, what can you do?");
    if (status !== 200 || body.error)
      throw new Error(`Answered ${status}: ${body.error ?? "no answer"}`);
    if (body.mode !== "iris" || body.from)
      throw new Error(
        `Answered by ${body.from?.name ?? `mode "${body.mode}"`}, not by Iris`,
      );
    if (body.text !== demoGuidedReply([]).text)
      throw new Error("Iris didn't give the guided answer");
    if (!body.choices?.some((c) => typeof c.answer.message === "string"))
      throw new Error("The guided answer offers no examples");
  });
}

// ---- Signed in at one Company -----------------------------------------------

/** What the output says these checks leave out, and why. */
const notCovered = [
  "The free model: Cloudflare Turnstile refuses automated browsers, by design.",
  "Passkey accounts: there is no authenticator to use.",
  "Approvals: the hourly run must leave nothing done at a Company.",
];

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};
const decoded = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) =>
    e[0] !== "#"
      ? (ENTITIES[e.toLowerCase()] ?? all)
      : String.fromCodePoint(
          e[1] === "x" || e[1] === "X"
            ? parseInt(e.slice(2), 16)
            : Number(e.slice(1)),
        ),
  );
/** A tag's attributes, by name in lowercase. */
const attributesOf = (tag: string) =>
  new Map(
    [...tag.matchAll(/([a-z][a-z0-9_-]*)(?:="([^"]*)")?/gi)]
      .slice(1)
      .map(([, name, value]) => [name!.toLowerCase(), decoded(value ?? "")]),
  );

/**
 * What a browser posts for the form that posts to `action`, before a
 * button is pressed: its hidden and typed values, the boxes and radios
 * ticked and each select's chosen option, as the page left them.
 */
function formFields(html: string, action: string) {
  const form = [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)].find(
    ([, tag]) => attributesOf(`<form${tag}`).get("action") === action,
  )?.[2];
  if (form === undefined) return undefined;
  const fields = new URLSearchParams();
  for (const [tag] of form.matchAll(/<input\b[^>]*>/gi)) {
    const a = attributesOf(tag);
    const name = a.get("name");
    const type = a.get("type") ?? "text";
    const ticks = type === "checkbox" || type === "radio";
    if (!name || ["submit", "button", "image", "reset", "file"].includes(type))
      continue;
    if (ticks && !a.has("checked")) continue;
    fields.append(name, a.get("value") ?? (ticks ? "on" : ""));
  }
  for (const [, tag, body] of form.matchAll(
    /<select\b([^>]*)>([\s\S]*?)<\/select>/gi,
  )) {
    const name = attributesOf(`<select${tag}`).get("name");
    const options = [...body!.matchAll(/<option\b[^>]*>/gi)].map(([o]) =>
      attributesOf(o),
    );
    const chosen = options.find((o) => o.has("selected")) ?? options[0];
    if (name && chosen) fields.append(name, chosen.get("value") ?? "");
  }
  return { fields, html: form };
}

/** A browser at one Company: its cookies, kept here and nowhere else. */
class CompanyBrowser {
  jar = new Jar();
  constructor(readonly company: Company) {}

  async get(t: Timer, url: string) {
    const response = await t.fetch(new URL(url, this.company.url), {
      headers: { accept: "text/html", ...this.jar.header() },
      redirect: "manual",
    });
    this.jar.keep(response);
    return response;
  }

  /** A form of the Company's own page, posted as the browser posts it. */
  async submit(t: Timer, path: string, fields: URLSearchParams) {
    const response = await t.fetch(new URL(path, this.company.url), {
      method: "POST",
      headers: {
        origin: this.company.origin,
        accept: "text/html",
        "content-type": "application/x-www-form-urlencoded",
        ...this.jar.header(),
      },
      body: fields.toString(),
      redirect: "manual",
    });
    this.jar.keep(response);
    return response;
  }
}

/** The protocol's error code in a refusal, when it has one. */
const errorOf = async (response: Response) => {
  const text = await response.text();
  try {
    const { error } = JSON.parse(text) as { error?: unknown };
    return typeof error === "string" ? `: ${error.slice(0, 60)}` : "";
  } catch {
    return "";
  }
};

/** Whether a grant of these scopes can change something (`canChange` in pap-agent). */
const canChange = (profile: Answer["body"]["profile"], scopes = "") =>
  !!profile?.scopeHints &&
  scopes
    .split(" ")
    .some((s) => s && profile.scopeHints![s]?.changes !== "none");

/**
 * Signs in as the page does: the playground starts the sign-in, the
 * Company's consent page is answered with Allow for the test customer it
 * opens on, as the page left it, and the browser comes back to the
 * callback. Returns the customer.
 */
async function signIn(
  t: Timer,
  visitor: Visitor,
  browser: CompanyBrowser,
  access: "read" | "write",
) {
  const { company } = browser;
  const started = await visitor.post(t, "/api/account", {
    action: "signin",
    company: company.origin,
    access,
  });
  if (started.status !== 200 || !started.body.url)
    throw new Error(
      `The sign-in didn't start: ${started.status}${started.body.code ? ` ${started.body.code}` : ""}`,
    );
  const authorize = new URL(started.body.url);
  if (authorize.origin !== company.origin)
    throw new Error(`The sign-in opens ${authorize.origin}, not the Company`);
  const page = await browser.get(t, authorize.href);
  if (page.status !== 200)
    throw new Error(`The consent page answered ${page.status}`);
  const form = formFields(await page.text(), "/oauth/authorize");
  if (!form?.fields.get("nonce"))
    throw new Error("The consent page has no consent form");
  if (form.fields.has("password"))
    throw new Error("The consent page asks for a password");
  const chosen = form.fields.get("account");
  // The sheet names each test customer beside its radio (`consent-sheet.ts`).
  const name = [
    ...form.html.matchAll(
      /<input\b([^>]*)>\s*<span>\s*<strong>([^<]+)<\/strong>/gi,
    ),
  ].find(([, tag]) => {
    const a = attributesOf(`<input${tag}`);
    return a.get("name") === "account" && a.get("value") === chosen;
  })?.[2];
  if (!chosen || !name)
    throw new Error("The consent page offers no test customer");
  form.fields.set("decision", "approve");
  const allowed = await browser.submit(t, "/oauth/authorize", form.fields);
  const location = allowed.headers.get("location");
  if (allowed.status !== 302 || !location)
    throw new Error(
      `Allow answered ${allowed.status}${await errorOf(allowed)}`,
    );
  const back = new URL(location, company.url);
  if (
    back.origin !== new URL(lab).origin ||
    back.pathname !== "/api/account/callback"
  )
    throw new Error(`Allow led to ${shown(back.href)}, not to the callback`);
  if (back.searchParams.has("error"))
    throw new Error(
      `The Company answered Allow with ${back.searchParams.get("error")?.slice(0, 40)}`,
    );
  const landed = await visitor.get(t, back.href);
  await landed.body?.cancel();
  const end = landed.headers.get("location") ?? "";
  if (landed.status !== 303 || !end.endsWith("/playground/sign-in/done"))
    throw new Error(
      `The callback answered ${landed.status}${end ? `, to ${shown(new URL(end, lab).href)}` : ""}`,
    );
  return { id: chosen, name: decoded(name) };
}

/** The conversation's connection to `company`, as a reload reads it. */
async function reloaded(t: Timer, visitor: Visitor, company: Company) {
  const path = "/api/account";
  const response = await visitor.get(
    t,
    `${lab}${path}?conversation=${encodeURIComponent(visitor.conversation ?? "")}`,
  );
  const body = await jsonOf(response, path);
  const own = body.connections?.find((c) => c.origin === company.origin);
  if (response.status !== 200 || !own)
    throw new Error(
      `A reload answered ${response.status}${own ? "" : `, without ${company.name}`}`,
    );
  return own;
}

/**
 * The grants the Company lists to the playground's agent for `customer`,
 * as the customer sees them on its website: logged in there in the browser
 * that allowed the consent, which sees that agent user's copy.
 */
async function grantsAtCompany(
  t: Timer,
  browser: CompanyBrowser,
  customer: string,
) {
  const path = "/site/access";
  let response = await browser.get(t, path);
  if (response.status === 401) {
    const page = await browser.get(t, "/site/login");
    const form = formFields(await page.text(), "/site/login");
    if (page.status !== 200 || !form)
      throw new Error(`The Company's login page answered ${page.status}`);
    form.fields.set("account", customer);
    const login = await browser.submit(t, "/site/login", form.fields);
    await login.body?.cancel();
    if (login.status !== 302)
      throw new Error(`The Company's login answered ${login.status}`);
    response = await browser.get(t, path);
  }
  const body = (await response.json().catch(() => ({}))) as {
    grants?: Array<{ host: string; scopes: string }>;
  };
  if (response.status !== 200 || !body.grants)
    throw new Error(`The Company's ${path} answered ${response.status}`);
  return body.grants.filter((g) => g.host === new URL(lab).host);
}

async function checkSignedIn() {
  // A different Company each hour: over a day, each of the five.
  const asked = flag("sign-in");
  const company = asked
    ? companies.find((c) => c.key === asked)
    : companies[new Date().getUTCHours() % companies.length];
  if (!company) {
    results.push({
      name: "Signed in",
      status: "fail",
      ms: 0,
      reason: `--sign-in=${asked} names none of the lab's Companies`,
    });
    return;
  }
  const demo = DEMO_SUGGESTIONS[company.key as keyof typeof DEMO_SUGGESTIONS];
  const at = `${company.name}, signed in`;
  const visitor = new Visitor();
  const browser = new CompanyBrowser(company);
  let profile: Answer["body"]["profile"];
  let customer: { id: string; name: string } | undefined;

  const read = await check(`${at}: sign in to read`, async (t) => {
    const found = await visitor.post(t, "/api/discover", { url: company.url });
    if (found.status !== 200 || !visitor.conversation)
      throw new Error(`Connecting answered ${found.status}`);
    profile = found.body.profile;
    if (!profile?.scopeHints) throw new Error("Discovery has no scope hints");
    customer = await signIn(t, visitor, browser, "read");
    const own = await reloaded(t, visitor, company);
    if (!own.signedIn) throw new Error("The conversation isn't signed in");
    if (canChange(profile, own.scopes))
      throw new Error(`Reading was granted a change scope: ${own.scopes}`);
  });
  if (read && demo)
    await check(`${at}: “${demo.account[0]}”`, async (t) => {
      const answer = await visitor.chat(t, demo.account[0]);
      demoAnswerFrom(answer, company);
      if (!answer.body.signedIn) throw new Error("It was answered signed out");
      // The account's own data names its customer.
      if (!`${answer.body.text}\n${answer.body.data}`.includes(customer!.name))
        throw new Error(`The answer doesn't name ${customer!.name}`);
    });
  const write =
    read &&
    (await check(`${at}: the change permission`, async (t) => {
      // The page opens on the customer this browser allowed before.
      const again = await signIn(t, visitor, browser, "write");
      if (again.id !== customer?.id)
        throw new Error("The second consent page opened on another customer");
      const own = await reloaded(t, visitor, company);
      if (!own.signedIn || !canChange(profile, own.scopes))
        throw new Error(
          `The second consent granted ${own.scopes ?? "nothing"}`,
        );
    }));
  if (write && demo?.demoChange)
    await check(`${at}: “${demo.ask}”, declined`, async (t) => {
      const answer = await visitor.chat(t, demo.ask);
      demoAnswerFrom(answer, company);
      const waiting =
        answer.body.operations?.filter((o) => o.state === "proposed") ?? [];
      if (waiting.length !== 1)
        throw new Error(`${waiting.length} proposals wait, not one`);
      const proposal = waiting[0]!;
      if (!proposal.terms || !Object.keys(proposal.terms).length)
        throw new Error("The proposal has no terms");
      if (!(Date.parse(proposal.expires_at) > Date.now()))
        throw new Error("The proposal has already expired");
      let sent: { operation_id?: unknown; terms?: unknown } | undefined;
      try {
        sent = JSON.parse(answer.body.data ?? "") as typeof sent;
      } catch {
        sent = undefined;
      }
      if (
        sent?.operation_id !== proposal.operation_id ||
        !isDeepStrictEqual(sent.terms, proposal.terms)
      )
        throw new Error(
          "The proposal's terms aren't the ones the Company sent",
        );
      const declined = await visitor.post(t, "/api/account", {
        action: "decline",
        company: company.origin,
        id: proposal.operation_id,
        revision: proposal.revision,
      });
      if (
        declined.status !== 200 ||
        declined.body.operation?.state !== "declined"
      )
        throw new Error(`Declining answered ${declined.status}`);
      const kept = (await reloaded(t, visitor, company)).operations?.find(
        (o) => o.operation_id === proposal.operation_id,
      );
      if (kept?.state !== "declined")
        throw new Error(`A reload shows it ${kept?.state ?? "gone"}`);
    });
  else if (write)
    notCovered.unshift(
      `A proposal at ${company.name}: demo mode has no scripted change there.`,
    );
  // Whatever failed before, a sign-in that was allowed is signed out.
  if (customer)
    await check(`${at}: sign out`, async (t) => {
      const before = await grantsAtCompany(t, browser, customer!.id);
      if (read && !before.length)
        throw new Error("The Company lists no grant before sign-out");
      const out = await visitor.post(t, "/api/account", {
        action: "signout",
        company: company.origin,
      });
      if (out.status !== 200 || out.body.signedIn !== false)
        throw new Error(`Signing out answered ${out.status}`);
      const left = await grantsAtCompany(t, browser, customer!.id);
      if (left.length)
        throw new Error(
          `The Company still lists ${left.length} grant${left.length === 1 ? "" : "s"} after sign-out`,
        );
      if ((await reloaded(t, visitor, company)).signedIn)
        throw new Error("A reload shows it signed in");
    });
}

// ---- Report -----------------------------------------------------------------

function report() {
  const width = Math.max(...results.map((r) => r.name.length), 5);
  const lines = [
    `${"check".padEnd(width)}  result  ms`,
    ...results.map(
      (r) => `${r.name.padEnd(width)}  ${r.status.padEnd(6)}  ${r.ms}`,
    ),
  ];
  const failed = results.filter((r) => r.status === "fail");
  const slow = results.filter((r) => r.status === "warn");
  const total = `${results.length} checks, ${failed.length} failed, ${slow.length} slow; ${requests} requests. Each check's ms is its slowest request.`;
  const notes = [...failed, ...slow].map(
    (r) => `${r.status === "fail" ? "FAIL" : "slow"}  ${r.name}: ${r.reason}`,
  );
  const left = ["Not covered:", ...notCovered.map((n) => `  ${n}`)];
  console.log([...lines, "", total, ...notes, "", ...left].join("\n"));

  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    const cell = (text: string) => text.replace(/\|/g, "\\|");
    appendFileSync(
      summary,
      [
        `## Production checks against ${lab}`,
        "",
        "| Check | Result | ms | Reason |",
        "| --- | --- | --: | --- |",
        ...results.map(
          (r) =>
            `| ${cell(r.name)} | ${r.status} | ${r.ms} | ${cell(r.reason ?? "")} |`,
        ),
        "",
        total,
        "",
        "Not covered:",
        "",
        ...notCovered.map((n) => `- ${n}`),
        "",
      ].join("\n"),
    );
  }
  return failed.length === 0;
}

async function main() {
  for (const company of companies) await checkCompany(company);
  await checkSite();
  await checkPlayground();
  await checkSignedIn();
  if (!report()) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
