/**
 * Runs the phrases (`cases.ts`) through the agent's real code path, the
 * `/api/v1` handler of the agent's core, in this process, against the
 * lab's Companies on their local ports, with the model named on the
 * command line. See docs/model-phrases.md.
 */
import { subscribe } from "node:diagnostics_channel";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { createIdentity } from "../../packages/pap-client/src/index.ts";
import { labSites } from "../../packages/pap-core/src/index.ts";
import { configureAgent } from "../../packages/pap-agent/src/agent.ts";
import { identity } from "../../packages/pap-agent/src/agent-keys.ts";
import { account } from "../../packages/pap-agent/src/account.ts";
import { v1 } from "../../packages/pap-agent/src/api-http.ts";
import type {
  ConversationState,
  TurnResult,
} from "../../packages/pap-agent/src/api.ts";
import {
  configureFreeModel,
  FREE_LIMITS,
  neuronsToday,
} from "../../packages/pap-agent/src/free-model.ts";
import { demoExamplesFor } from "../../packages/pap-agent/src/demo-examples.ts";
import { LANGUAGES } from "../../packages/pap-agent/src/language.ts";
import { say } from "../../packages/pap-agent/src/lines.ts";
import {
  configureBackend,
  memoryBackend,
} from "../../packages/pap-agent/src/runs.ts";
import { signInCallback } from "../../packages/pap-agent/src/sign-in-callback.ts";
import type { CookieStore } from "../../packages/pap-agent/src/web.ts";
import { AGENT_NAME } from "../../apps/playground/lib/agent-name.ts";
import { GET as clientMetadata } from "../../apps/playground/app/agent/client.json/route.ts";
import { GET as agentKeys } from "../../apps/playground/app/agent/jwks.json/route.ts";
import { CASES, type Case, type Site } from "./cases.ts";
import {
  agentMessages,
  checkTurn,
  COLUMNS,
  LANGUAGE_NAMES,
  type Check,
  type CheckName,
  type Companies,
  type WireRequest,
  wireSummary,
} from "./checks.ts";
import { CompanyBrowser, shown } from "./consent.ts";
import {
  AGENT,
  answers,
  ensureCompanies,
  root,
  serveAgentMetadata,
  startWorkersAi,
  stopAll,
} from "./servers.ts";

type Model = "free" | "openai" | "anthropic" | "demo";

// ---- Command line -----------------------------------------------------------

const USAGE = `pnpm phrases --model <free|openai|anthropic|demo> [options]

  --model free        Workers AI's ${"@cf/google/gemma-4-26b-a4b-it"} through wrangler dev --remote
  --model openai      OPENAI_API_KEY from your environment (OPENAI_MODEL or --model-name)
  --model anthropic   ANTHROPIC_API_KEY from your environment (ANTHROPIC_MODEL or --model-name)
  --model demo        no model: checks the runner itself, at no cost
  --model-name <id>   the provider's model (not for free)
  --case <id,id…>     only these cases
  --max-neurons <n>   free: stop once the run has used this many (default 3000)
  --list              list the cases and exit`;

function parseArgs(argv: string[]) {
  const args = argv.filter((a) => a !== "--");
  const value = (name: string) => {
    const at = args.findIndex(
      (a) => a === `--${name}` || a.startsWith(`--${name}=`),
    );
    if (at < 0) return undefined;
    const arg = args[at]!;
    return arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : args[at + 1];
  };
  const model = value("model");
  return {
    list: args.includes("--list"),
    help: args.includes("--help") || args.includes("-h"),
    model: (["free", "openai", "anthropic", "demo"].includes(model ?? "")
      ? model
      : undefined) as Model | undefined,
    modelName: value("model-name"),
    cases: value("case")?.split(",").filter(Boolean),
    maxNeurons: Number(value("max-neurons") ?? 3000),
  };
}

// ---- The agent, in this process ---------------------------------------------

/** A browser's cookies for the agent, as Next's `cookies()` gives them. */
class Jar implements CookieStore {
  private values = new Map<string, string>();
  get(name: string) {
    const value = this.values.get(name);
    return value === undefined ? undefined : { value };
  }
  set(
    name: string,
    value: string,
    options: Record<string, string | number | boolean>,
  ) {
    if (!value || options.maxAge === 0) this.values.delete(name);
    else this.values.set(name, value);
  }
}

type Answer<T = Record<string, unknown>> = { status: number; body: T };

/**
 * One request to `/api/v1`, as the page's own origin makes it. Local
 * development takes 20 chat requests a minute in all ("Chat is busy"),
 * refused before anything is sent, so a 429 is asked again a little later.
 */
async function api<T = Record<string, unknown>>(
  jar: Jar,
  method: "GET" | "POST",
  route: string,
  body?: unknown,
): Promise<Answer<T>> {
  for (let attempt = 0; ; attempt++) {
    const response = await v1(
      new Request(`${AGENT}/api/v1${route}`, {
        method,
        headers: {
          origin: AGENT,
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      jar,
    );
    if (response.status === 429 && attempt < 3) {
      await response.body?.cancel();
      console.log("· the agent is busy (429): asking again in 30 s");
      await new Promise((r) => setTimeout(r, 30_000));
      continue;
    }
    return { status: response.status, body: (await response.json()) as T };
  }
}

/** The page's own `/api/account`, for signing out after a case. */
async function signOut(jar: Jar, conversation: string, origin: string) {
  const response = await account(
    new Request(`${AGENT}/api/account`, {
      method: "POST",
      headers: {
        origin: AGENT,
        "content-type": "application/json",
        "x-poppy-conversation": conversation,
      },
      body: JSON.stringify({ action: "signout", company: origin }),
    }),
    jar,
  );
  await response.body?.cancel();
  return response.status;
}

const failure = (what: string, answer: Answer) =>
  new Error(
    `${what}: ${answer.status}${typeof answer.body.code === "string" ? ` ${answer.body.code}` : ""}${typeof answer.body.error === "string" ? ` (${answer.body.error})` : ""}`,
  );

// ---- What the run measures --------------------------------------------------

const wire: WireRequest[] = [];
let recording = false;
let labOrigins = new Set<string>();

/** Every HTTP request this process makes, by its origin and path only. */
function recordRequests() {
  subscribe("undici:request:create", (message) => {
    if (!recording) return;
    const { request } = message as {
      request: { origin?: unknown; method?: unknown; path?: unknown };
    };
    const origin = String(request.origin ?? "").replace(/\/$/, "");
    if (!labOrigins.has(origin)) return;
    wire.push({
      origin,
      method: String(request.method ?? "GET"),
      path: String(request.path ?? "").replace(/[?#].*$/, ""),
    });
  });
}

/** Tokens a provider reports in its answers (openai and anthropic). */
const tokens = { input: 0, output: 0 };
function countTokens() {
  const original = globalThis.fetch;
  const hosts = new Set(["api.openai.com", "api.anthropic.com"]);
  if (process.env.OPENAI_BASE_URL)
    try {
      hosts.add(new URL(process.env.OPENAI_BASE_URL).host);
    } catch {
      // Not a URL: the provider will say so.
    }
  globalThis.fetch = async (input, init) => {
    const response = await original(input, init);
    try {
      const url = new URL(
        typeof input === "string" || input instanceof URL ? input : input.url,
      );
      if (
        hosts.has(url.host) &&
        response.headers.get("content-type")?.includes("json")
      ) {
        const body = (await response.clone().json()) as {
          usage?: Record<string, unknown>;
        };
        const n = (v: unknown) => (typeof v === "number" ? v : 0);
        tokens.input +=
          n(body.usage?.input_tokens) + n(body.usage?.prompt_tokens);
        tokens.output +=
          n(body.usage?.output_tokens) + n(body.usage?.completion_tokens);
      }
    } catch {
      // Counting is best effort; the answer goes on as it came.
    }
    return response;
  };
}

/** The lines the free model's turn says when it ran in demo mode instead. */
const DEMO_FALLBACK = LANGUAGES.flatMap((language) =>
  (
    [
      "notDeployed",
      "off",
      "allowance",
      "unfinished",
      "failed",
      "hour",
      "day",
      "network",
    ] as const
  ).map((why) =>
    say(language, "freeModel", {
      why,
      count: why === "day" ? FREE_LIMITS.visitor.day : FREE_LIMITS.visitor.hour,
    }),
  ),
);

/** Demo mode's own words: its scripted answers and its guided reply. */
const DEMO_TEXT = /Protocol demo \(no LLM\)|^Demo mode runs the examples/m;

/** An address in the text, without what its query could carry. */
const scrubbed = (text: string) =>
  text.replace(/(https?:\/\/[^\s?#)]+)[?#][^\s)]*/g, "$1?…");

// ---- One case ---------------------------------------------------------------

type Outcome = {
  c: Case;
  checks: Record<CheckName, Check>;
  answer: string;
  /** Each earlier turn's answer, for the reader. */
  earlier: Array<{ said: string; answer: string }>;
  neurons: number;
  ms: number;
  /** The turn's requests to Companies, and the steps it recorded. */
  requests: WireRequest[];
  steps: string[];
  note?: string;
};

const TURN_MS = 180_000;

async function runCase(
  c: Case,
  model: Record<string, string>,
  companies: Companies,
  urls: Record<Site, string>,
): Promise<Outcome> {
  const jar = new Jar();
  const started = Date.now();
  const neuronsBefore = await neuronsToday();
  const signedIn: string[] = [];
  let conversation = "";
  const earlier: Outcome["earlier"] = [];
  const blank = (error: string): Outcome => ({
    c,
    checks: checkTurn(c, companies, {
      turn: undefined,
      before: new Set(),
      wire: [],
      error,
    }),
    answer: "",
    earlier,
    requests: [],
    steps: [],
    neurons: 0,
    ms: Date.now() - started,
    note: error,
  });
  const say = (text: string) =>
    api<TurnResult & { error?: string }>(
      jar,
      "POST",
      `/conversations/${conversation}/messages`,
      { text, model },
    );
  try {
    // The conversation: a new visitor, its first Company connected
    // signed out, the others in words (demo mode connects them, no model).
    const [first, ...rest] = c.setup.companies;
    const opened = await api<ConversationState>(
      jar,
      "POST",
      "/conversations",
      first ? { company: urls[first] } : {},
    );
    if (opened.status !== 201)
      throw failure("Starting the conversation", opened);
    conversation = opened.body.id;
    if (rest.length) {
      const names = rest.map((s) => companies[s].name).join(" and ");
      const connected = await api<TurnResult>(
        jar,
        "POST",
        `/conversations/${conversation}/messages`,
        { text: `connect with ${names}`, model: { provider: "demo" } },
      );
      const origins =
        connected.body.state?.companies.map((x) => x.origin) ?? [];
      if (
        connected.status !== 200 ||
        rest.some((s) => !origins.includes(companies[s].origin))
      )
        throw failure(`Connecting ${names}`, connected);
    }
    for (const [site, access] of Object.entries(c.setup.signIn ?? {}) as Array<
      [Site, "read" | "write"]
    >) {
      const origin = companies[site].origin;
      const begun = await api<{ url?: string }>(
        jar,
        "POST",
        `/conversations/${conversation}/sign-ins`,
        { company: origin, access },
      );
      if (begun.status !== 200 || !begun.body.url)
        throw failure(`Signing in at ${companies[site].name}`, begun);
      const back = await new CompanyBrowser(origin).allow(begun.body.url);
      if (back.origin !== AGENT || back.pathname !== "/api/account/callback")
        throw new Error(`Allow led to ${shown(back.href)}, not the callback`);
      const landed = await signInCallback(new Request(back.href), jar);
      await landed.body?.cancel();
      if (landed.status !== 303)
        throw new Error(
          `The callback for ${companies[site].name} answered ${landed.status}`,
        );
      signedIn.push(origin);
    }
    for (const text of c.setup.before ?? []) {
      const answered = await say(text);
      if (answered.status !== 200)
        throw failure(`The earlier turn "${text}"`, answered);
      earlier.push({
        said: text,
        answer: agentMessages(answered.body)
          .map((m) => m.text)
          .join("\n\n"),
      });
    }
    const state = await api<ConversationState>(
      jar,
      "GET",
      `/conversations/${conversation}`,
    );
    const before = new Set(
      state.body.proposals.map((p) => `${p.company.origin} ${p.id}`),
    );

    // The turn itself, its requests recorded.
    wire.length = 0;
    recording = true;
    let timer: NodeJS.Timeout | undefined;
    const answered = await Promise.race([
      say(c.phrase),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`No answer within ${TURN_MS / 1000} s`)),
          TURN_MS,
        );
      }),
    ]).finally(() => {
      recording = false;
      clearTimeout(timer);
    });
    const requests = [...wire];
    const neurons = (await neuronsToday()) - neuronsBefore;
    if (answered.status !== 200)
      return { ...blank(failure("The turn", answered).message), neurons };
    const turn = answered.body;
    const text = agentMessages(turn)
      .map((m) => m.text)
      .join("\n\n");
    const checks = checkTurn(c, companies, { turn, before, wire: requests });
    const fellBack =
      model.provider !== "demo" &&
      (DEMO_FALLBACK.some((l) => text.includes(l)) || DEMO_TEXT.test(text));
    if (fellBack)
      checks.to = { status: "fail", detail: "ran in demo mode, not the model" };

    // Nothing left waiting at a Company: every new proposal declined.
    for (const p of turn.state.proposals.filter((p) => p.state === "proposed"))
      await api(
        jar,
        "POST",
        `/conversations/${conversation}/proposals/${encodeURIComponent(p.id)}/decision`,
        {
          company: p.company.origin,
          revision: p.revision,
          decision: "decline",
        },
      );
    return {
      c,
      checks,
      answer: text,
      earlier,
      requests,
      steps: turn.messages.flatMap((m) => (m.steps ?? []).map((s) => s.text)),
      neurons,
      ms: Date.now() - started,
      ...(fellBack ? { note: "The free model's turn ran in demo mode." } : {}),
    };
  } catch (error) {
    return blank(error instanceof Error ? error.message : String(error));
  } finally {
    // Every sign-in signed out again: no grant is left at a Company.
    for (const origin of signedIn)
      await signOut(jar, conversation, origin).catch(() => 0);
  }
}

// ---- Report -----------------------------------------------------------------

const MARK: Record<Check["status"], string> = {
  pass: "ok",
  fail: "FAIL",
  warn: "warn",
  "n/a": "–",
};

const names = Object.keys(COLUMNS) as CheckName[];

function table(outcomes: Outcome[]) {
  const header = ["case", ...names.map((n) => COLUMNS[n])];
  const rows = outcomes.map((o) => [
    o.c.id,
    ...names.map((n) => MARK[o.checks[n].status]),
  ]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i]!.length)),
  );
  const line = (cells: string[]) =>
    cells.map((cell, i) => cell.padEnd(widths[i]!)).join("  ");
  return [line(header), ...rows.map(line)].join("\n");
}

const failedCase = (o: Outcome) =>
  names.some((n) => o.checks[n].status === "fail");

function markdown(
  outcomes: Outcome[],
  summary: string[],
  modelLine: string,
  companies: Companies,
) {
  const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\n/g, " ");
  const quote = (text: string) =>
    scrubbed(text || "(nothing)")
      .split("\n")
      .map((l) => `> ${l}`)
      .join("\n");
  return [
    `# Model phrases: ${modelLine}`,
    "",
    ...summary.map((s) => `- ${s}`),
    "",
    `| Case | ${names.map((n) => COLUMNS[n]).join(" | ")} |`,
    `| --- | ${names.map(() => "---").join(" | ")} |`,
    ...outcomes.map(
      (o) =>
        `| ${o.c.id} | ${names
          .map((n) => {
            const { status, detail } = o.checks[n];
            return cell(`${MARK[status]}${detail ? ` ${detail}` : ""}`);
          })
          .join(" | ")} |`,
    ),
    "",
    ...outcomes.flatMap((o) => [
      `## ${o.c.id}: ${o.c.title}`,
      "",
      `${LANGUAGE_NAMES[o.c.language]}. Connected: ${o.c.setup.companies.join(", ") || "none"}${
        o.c.setup.signIn
          ? `; signed in: ${Object.entries(o.c.setup.signIn)
              .map(
                ([s, a]) =>
                  `${s} (${a === "write" ? "with change permission" : "reading"})`,
              )
              .join(", ")}`
          : ""
      }. ${(o.ms / 1000).toFixed(1)} s${o.neurons ? `, ${o.neurons.toFixed(1)} Neurons` : ""}.${o.note ? ` ${scrubbed(o.note)}` : ""}`,
      "",
      ...o.earlier.flatMap((e) => [
        `Earlier: “${e.said}”`,
        "",
        quote(e.answer),
        "",
      ]),
      `User: “${o.c.phrase}”`,
      "",
      quote(o.answer),
      "",
      ...(o.steps.length
        ? ["Steps:", "", ...o.steps.map((s) => `- ${scrubbed(s)}`), ""]
        : []),
      ...(o.requests.length
        ? [
            "Requests:",
            "",
            ...Object.values(companies)
              .filter((x) => o.requests.some((r) => r.origin === x.origin))
              .map(
                (x) =>
                  `- ${x.name}: ${wireSummary(o.requests.filter((r) => r.origin === x.origin))}`,
              ),
            "",
          ]
        : []),
      ...names
        .filter((n) => o.checks[n].detail || o.checks[n].status === "fail")
        .map(
          (n) =>
            `- ${COLUMNS[n]}: ${MARK[o.checks[n].status]}${o.checks[n].detail ? `, ${scrubbed(o.checks[n].detail)}` : ""}`,
        ),
      "",
    ]),
  ].join("\n");
}

// ---- Main -------------------------------------------------------------------

export async function main(argv: string[]) {
  const options = parseArgs(argv);
  if (options.help || (!options.model && !options.list)) {
    console.log(USAGE);
    if (!options.help) process.exitCode = 1;
    return;
  }
  const chosen = options.cases
    ? CASES.filter((c) => options.cases!.includes(c.id))
    : CASES;
  if (options.list || !options.model) {
    for (const c of CASES)
      console.log(`${c.id.padEnd(20)} ${c.title}: “${c.phrase}”`);
    return;
  }
  // A message that is one of demo mode's scripted examples is answered by
  // the script whatever model is chosen (`withoutModel` in the core), so
  // such a phrase would test nothing of the model.
  const scripted = CASES.flatMap((c) =>
    [c.phrase, ...(c.setup.before ?? [])]
      .filter((text) => demoExamplesFor(text).length)
      .map((text) => `${c.id}: “${text}”`),
  );
  if (scripted.length) {
    console.error(
      `These are demo mode's scripted examples, which no model is asked:\n  ${scripted.join("\n  ")}`,
    );
    process.exitCode = 1;
    return;
  }
  if (options.cases && chosen.length !== options.cases.length) {
    const known = new Set(CASES.map((c) => c.id));
    console.error(
      `No such case: ${options.cases.filter((id) => !known.has(id)).join(", ")}`,
    );
    process.exitCode = 1;
    return;
  }
  const modelId = options.model;
  // Only whether a key is there: it is never read here, printed or kept.
  const keyName =
    modelId === "openai"
      ? "OPENAI_API_KEY"
      : modelId === "anthropic"
        ? "ANTHROPIC_API_KEY"
        : undefined;
  if (keyName && !process.env[keyName]) {
    console.error(
      `Set ${keyName} in your environment to use --model ${modelId}.`,
    );
    process.exitCode = 1;
    return;
  }
  const model: Record<string, string> =
    modelId === "free"
      ? // Cloudflare's dummy token, which its always-pass test secret accepts.
        { provider: "free", turnstile: "XXXX.DUMMY.TOKEN.XXXX" }
      : modelId === "demo"
        ? { provider: "demo" }
        : {
            provider: modelId === "openai" ? "openai-compatible" : "anthropic",
            ...(options.modelName ? { model: options.modelName } : {}),
          };
  const modelLine =
    modelId === "free"
      ? "free (Workers AI @cf/google/gemma-4-26b-a4b-it)"
      : modelId === "demo"
        ? "demo (no model)"
        : `${modelId} (${
            options.modelName ??
            (modelId === "openai"
              ? (process.env.OPENAI_MODEL ?? "gpt-4.1-mini")
              : (process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6"))
          })`;

  const log = (line: string) => console.log(`· ${line}`);
  const sites = labSites(AGENT);
  const urls = Object.fromEntries(
    sites.filter((s) => "words" in s).map((s) => [s.id, s.url]),
  ) as Record<Site, string>;
  const companies = Object.fromEntries(
    sites
      .filter((s) => "words" in s)
      .map((s) => [s.id, { origin: new URL(s.url).origin, name: s.label }]),
  ) as Companies;
  labOrigins = new Set(Object.values(companies).map((x) => x.origin));

  // Conversations and accounts in memory only: the developer's vault is
  // left alone.
  configureBackend(memoryBackend());
  configureAgent({ name: AGENT_NAME });
  recordRequests();
  if (modelId === "openai" || modelId === "anthropic") countTokens();

  process.on("SIGINT", () => {
    stopAll();
    process.exit(130);
  });
  try {
    // The agent's keys: a fresh pair for this run, served at
    // localhost:3000; or, when the playground already runs there, its own,
    // which this process reads from the playground's folder as it does.
    if (await answers(`${AGENT}/agent/jwks.json`)) {
      delete process.env.POPPY_IDENTITY;
      process.chdir(path.join(root, "apps/playground"));
      const served = (await (
        await fetch(`${AGENT}/agent/jwks.json`)
      ).json()) as {
        keys?: Array<{ x?: string; y?: string }>;
      };
      const own = (await identity()).publicKey;
      if (!served.keys?.some((k) => k.x === own.x && k.y === own.y))
        throw new Error(
          "localhost:3000 is taken by an agent with other keys. Stop it, or run the playground from this checkout.",
        );
      log("agent: using the playground already at localhost:3000 for its keys");
    } else {
      process.env.POPPY_IDENTITY = JSON.stringify(await createIdentity());
      await serveAgentMetadata({ client: clientMetadata, jwks: agentKeys });
      log("agent: client metadata served at localhost:3000");
    }
    const needed = new Set<Site>(
      chosen.flatMap((c) => [
        ...c.setup.companies,
        ...c.expect.allowed,
        ...(c.expect.connected ?? []),
      ]),
    );
    await ensureCompanies(needed, urls, log);

    if (modelId === "free") {
      // Cloudflare's published test keys, which always pass, in this
      // process only: never a deployment's configuration.
      process.env.TURNSTILE_SITE_KEY = "1x00000000000000000000AA";
      process.env.TURNSTILE_SECRET_KEY = "1x0000000000000000000000000000000AA";
      process.env.FREE_MODEL_DAILY_NEURONS = String(options.maxNeurons);
      delete process.env.FREE_MODEL_PAID_USD_PER_DAY;
      const binding = await startWorkersAi(log);
      configureFreeModel({ binding: () => binding });
    }

    console.log(`\nModel: ${modelLine}. ${chosen.length} cases.\n`);
    const outcomes: Outcome[] = [];
    const began = Date.now();
    for (const c of chosen) {
      if (modelId === "free" && (await neuronsToday()) >= options.maxNeurons) {
        log(`stopped: ${options.maxNeurons} Neurons used`);
        break;
      }
      const outcome = await runCase(c, model, companies, urls);
      outcomes.push(outcome);
      const marks = names
        .map((n) => `${COLUMNS[n]} ${MARK[outcome.checks[n].status]}`)
        .join(", ");
      console.log(
        `${failedCase(outcome) ? "FAIL" : "ok  "} ${c.id} (${(outcome.ms / 1000).toFixed(1)} s): ${marks}`,
      );
      if (outcome.note) console.log(`     ${scrubbed(outcome.note)}`);
      console.log(
        scrubbed(outcome.answer || "(no answer)")
          .split("\n")
          .map((l) => `     │ ${l}`)
          .join("\n"),
      );
    }
    const seconds = (Date.now() - began) / 1000;
    const failed = outcomes.filter(failedCase);
    const used =
      modelId === "free"
        ? `${(await neuronsToday()).toFixed(1)} Neurons`
        : modelId === "demo"
          ? "no model"
          : `${tokens.input} input and ${tokens.output} output tokens`;
    const summary = [
      `${outcomes.length - failed.length} of ${outcomes.length} cases passed every check; ${failed.length} failed${
        failed.length ? ` (${failed.map((o) => o.c.id).join(", ")})` : ""
      }.`,
      `Model: ${modelLine}.`,
      `Used: ${used}.`,
      `Time: ${seconds.toFixed(0)} s.`,
    ];
    console.log(`\n${table(outcomes)}\n\n${summary.join("\n")}`);

    const folder = path.join(root, "scripts/model-phrases/reports");
    mkdirSync(folder, { recursive: true });
    const file = path.join(
      folder,
      `${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}-${modelId}.md`,
    );
    writeFileSync(file, markdown(outcomes, summary, modelLine, companies));
    console.log(`\nReport: ${path.relative(root, file)}`);
    if (failed.length) process.exitCode = 1;
  } finally {
    stopAll();
  }
}
