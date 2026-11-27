/**
 * Checks what a visitor to the deployed lab sees: each Company's discovery
 * and pages, the playground and Learn, and the demo's scripted examples
 * through the playground's own HTTP API, as a new anonymous visitor.
 *
 * It only reads and runs public examples: it never signs in, approves or
 * changes anything. Cookies stay in memory. Run it with
 * `pnpm smoke:production`, which borrows `tsx` from Juniper's dev
 * dependencies, since the root has none.
 *
 *   --local               the local servers (localhost:3000 and the Companies' ports)
 *   --lab=<url>           the playground and Learn
 *   --juniper=<url> …     a Company (juniper, lantern, harborline, northwind, fernwick)
 *   --all-media           every Learn media file, not this hour's third
 *
 * Exits 1 when a check fails, and writes the table to the GitHub Actions
 * job summary when there is one.
 */
import { appendFileSync } from "node:fs";
import { labSites } from "../../packages/pap-core/src/index.ts";
import { discoverCompany } from "../../packages/pap-client/src/index.ts";
import { labCompanies } from "../../apps/playground/app/playground/companies.ts";
import { demoGuidedReply } from "../../apps/playground/lib/demo-examples.ts";

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

/** Times every request of one check, and stops any that takes longer than `FAIL_MS`. */
class Timer {
  slowest = 0;
  slowestUrl = "";

  fetch = async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
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
    connections?: Array<{ origin: string; name: string }>;
    document?: { organization?: { name?: string } };
  };
};

/** A new anonymous visitor: its cookies are kept here and nowhere else. */
class Visitor {
  cookies = new Map<string, string>();
  conversation: string | null = null;

  async post(t: Timer, path: string, body: unknown): Promise<Answer> {
    const headers: Record<string, string> = {
      // The chat and discovery routes take same-origin requests only.
      origin: new URL(lab).origin,
      "content-type": "application/json",
      accept: "application/json",
    };
    if (this.cookies.size)
      headers.cookie = [...this.cookies]
        .map(([name, value]) => `${name}=${value}`)
        .join("; ");
    if (this.conversation) headers["x-poppy-conversation"] = this.conversation;
    const response = await t.fetch(`${lab}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
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
    const text = await response.text();
    let parsed: Answer["body"];
    try {
      parsed = JSON.parse(text) as Answer["body"];
    } catch {
      throw new Error(`${path} answered ${response.status} without JSON`);
    }
    const conversation = response.headers.get("x-poppy-conversation");
    if (conversation) this.conversation = conversation;
    return { status: response.status, conversation, body: parsed };
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
  console.log([...lines, "", total, ...notes].join("\n"));

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
      ].join("\n"),
    );
  }
  return failed.length === 0;
}

async function main() {
  for (const company of companies) await checkCompany(company);
  await checkSite();
  await checkPlayground();
  if (!report()) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
