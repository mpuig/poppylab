/**
 * What the runner needs running on this machine: the lab's Companies on
 * their local ports, the agent's client metadata at localhost:3000 (where
 * the local Companies look for it), and for the free model the Workers AI
 * binding through `wrangler dev --remote`. What the runner starts it
 * stops; what was already running it leaves alone.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import type { Site } from "./cases.ts";

export const root = fileURLToPath(new URL("../../", import.meta.url));
export const AGENT = "http://localhost:3000";

const started: ChildProcess[] = [];
const servers: Server[] = [];

/** Stops everything the runner started, its children with it. */
export function stopAll() {
  for (const child of started)
    if (child.pid && child.exitCode === null)
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        // Already gone.
      }
  started.length = 0;
  for (const server of servers) server.close();
  servers.length = 0;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Whether anything answers HTTP at `url` within two seconds. */
export async function answers(url: string, init: RequestInit = {}) {
  try {
    const response = await fetch(url, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(2000),
    });
    await response.body?.cancel();
    return response.status;
  } catch {
    return 0;
  }
}

/** A child in its own process group, so stopping it stops what it ran. */
function launch(command: string, args: string[], cwd = root) {
  const child = spawn(command, args, {
    cwd,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  let tail = "";
  const keep = (chunk: Buffer) => {
    tail = (tail + chunk.toString()).slice(-2000);
  };
  child.stdout?.on("data", keep);
  child.stderr?.on("data", keep);
  started.push(child);
  return { child, tail: () => tail };
}

/** Waits until `ready` says so, or fails with the child's last output. */
async function until(
  what: string,
  ready: () => Promise<boolean>,
  launched: ReturnType<typeof launch>,
  ms: number,
) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await ready()) return;
    if (launched.child.exitCode !== null) break;
    await wait(500);
  }
  throw new Error(
    `${what} didn't start. Its last output:\n${launched
      .tail()
      .split("\n")
      .filter((l) => !/token|secret|key/i.test(l))
      .slice(-15)
      .join("\n")}`,
  );
}

/**
 * Each Company the cases use, on its local port: started with its own
 * Node entry (`src/node.ts`) when nothing answers there yet.
 */
export async function ensureCompanies(
  sites: Iterable<Site>,
  urls: Record<Site, string>,
  log: (line: string) => void,
) {
  await Promise.all(
    [...new Set(sites)].map(async (site) => {
      const url = urls[site];
      if (await answers(url)) return log(`${site}: already running at ${url}`);
      const app = path.join(root, "apps", site);
      const script = spawnSync("node", ["scripts/site-script.mjs"], {
        cwd: app,
        stdio: "ignore",
      });
      if (script.status !== 0)
        throw new Error(`${site}: its site script failed`);
      const launched = launch(
        "pnpm",
        ["--filter", `@poppy-lab/${site}`, "exec", "tsx", "src/node.ts"],
        root,
      );
      await until(site, async () => (await answers(url)) > 0, launched, 60000);
      log(`${site}: started at ${url}`);
    }),
  );
}

/**
 * The agent's client metadata and keys at localhost:3000, served by the
 * playground's own route handlers, which the local Companies fetch to
 * check the agent's signatures. Only these two: every other request the
 * runner makes to the agent is handed to the core in this process.
 */
export async function serveAgentMetadata(handlers: {
  client: (request: Request) => Response | Promise<Response>;
  jwks: () => Response | Promise<Response>;
}) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", AGENT);
    const handler =
      req.method === "GET" && url.pathname === "/agent/client.json"
        ? () => handlers.client(new Request(url))
        : req.method === "GET" && url.pathname === "/agent/jwks.json"
          ? () => handlers.jwks()
          : undefined;
    if (!handler) {
      res.writeHead(404).end();
      return;
    }
    const response = await handler();
    res.writeHead(response.status, {
      "content-type":
        response.headers.get("content-type") ?? "application/json",
    });
    res.end(await response.text());
  });
  // `localhost` is both addresses here; a Company may reach either.
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(3000, "127.0.0.1", () => resolve());
  });
  servers.push(server);
  const six = createServer(server.listeners("request")[0] as never);
  await new Promise<void>((resolve) => {
    six.once("error", () => resolve());
    six.listen(3000, "::1", () => {
      servers.push(six);
      resolve();
    });
  });
}

/** A port nothing listens on now. */
async function freePort() {
  const server = createNetServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const address = server.address();
  await new Promise<void>((r) => server.close(() => r()));
  return typeof address === "object" && address ? address.port : 8799;
}

/**
 * The free model's binding: a small Worker (`ai-proxy/worker.ts`) run
 * with `wrangler dev --remote` under the developer's own wrangler login,
 * on a local port, answering only this run's token. Returns a
 * `WorkersAiBinding` for the core.
 */
export async function startWorkersAi(log: (line: string) => void) {
  const port = await freePort();
  const token = randomBytes(24).toString("base64url");
  const base = `http://127.0.0.1:${port}/`;
  const launched = launch(
    "pnpm",
    [
      "--filter",
      "@poppy-lab/playground",
      "exec",
      "wrangler",
      "dev",
      "--remote",
      "--config",
      path.join(root, "scripts/model-phrases/ai-proxy/wrangler.toml"),
      "--port",
      String(port),
      "--ip",
      "127.0.0.1",
      "--var",
      `PROXY_TOKEN:${token}`,
    ],
    root,
  );
  const headers = { "x-proxy-token": token };
  await until(
    "wrangler dev --remote",
    async () => (await answers(base, { headers })) === 200,
    launched,
    120000,
  );
  log(`Workers AI: wrangler dev --remote on ${base}`);
  return {
    async run(model: string, input: Record<string, unknown>) {
      const response = await fetch(base, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ model, input }),
      });
      if (!response.ok) {
        const { error } = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(error ?? `Workers AI answered ${response.status}`);
      }
      return input.stream === true ? response.body : response.json();
    },
  };
}
