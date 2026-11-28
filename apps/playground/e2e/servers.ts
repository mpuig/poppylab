/**
 * The servers the browser scenario runs against, started for it and
 * stopped after it: the scripted model (`fake-model.ts`), the Companies it
 * talks to and the playground in development mode, every one on its usual
 * port moved by `E2E_PORT_OFFSET` (20000 unless set: 23000, 24200,
 * 24500), so it runs beside a developer's own `pnpm dev`.
 *
 * Nothing is shared with a developer's servers either: each one keeps its
 * state in a new temporary folder, the playground builds into `.next/e2e`,
 * and no model key or tunnel of theirs is used. `next dev` rewrites
 * `next-env.d.ts` for the folder it builds into; it is put back on stop.
 */
import { spawn, type ChildProcess } from "node:child_process";
import {
  createWriteStream,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import { startFakeModel } from "./fake-model.ts";

export const OFFSET = Number(process.env.E2E_PORT_OFFSET ?? 20000);
export const PLAYGROUND = `http://localhost:${3000 + OFFSET}`;
const MODEL_PORT = 3900 + OFFSET;
/** The Companies the scenario uses, by app folder, with their local host. */
export const COMPANIES = {
  fernwick: `http://fernwick.localhost:${4500 + OFFSET}`,
  lantern: `http://noodles.localhost:${4200 + OFFSET}`,
} as const;

const playgroundDir = fileURLToPath(new URL("..", import.meta.url));
const appsDir = path.dirname(playgroundDir);
/** Where each server's output goes, kept for a failed run's artifacts. */
export const LOGS = path.join(playgroundDir, "test-results", "servers");

/** Only what a server needs from this shell: never a key or a tunnel. */
const shell = () =>
  Object.fromEntries(
    ["PATH", "HOME", "TMPDIR", "LANG", "CI", "SYSTEMROOT"].flatMap((k) =>
      process.env[k] ? [[k, process.env[k]!]] : [],
    ),
  );

type Started = { name: string; child: ChildProcess };

function start(
  name: string,
  command: string,
  args: string[],
  options: { cwd: string; env: Record<string, string> },
): Started {
  const log = createWriteStream(path.join(LOGS, `${name}.log`));
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: { ...shell(), ...options.env } as NodeJS.ProcessEnv,
    // Its own process group, so stopping it stops what it started too.
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.pipe(log);
  child.stderr!.pipe(log);
  return { name, child };
}

/** Waits until `url` answers, or fails once the server has stopped or 3 minutes passed. */
async function ready({ name, child }: Started, url: string) {
  const until = Date.now() + 180_000;
  for (;;) {
    if (child.exitCode !== null)
      throw new Error(
        `${name} stopped (exit ${child.exitCode}); see ${LOGS}/${name}.log`,
      );
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(60_000),
      });
      if (response.status < 500) return;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > until) throw new Error(`${name} did not answer at ${url}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** Whether any process of the group is left. */
const alive = (group: number) => {
  try {
    process.kill(-group, 0);
    return true;
  } catch {
    return false;
  }
};

/**
 * Stops a server and everything it started, and waits until all of it is
 * gone: `next dev` serves from a child process, which can hold the port a
 * moment after the parent exits, and a retry starts new servers at once.
 */
async function stop({ child }: Started) {
  const group = child.pid;
  if (group === undefined || !alive(group)) return;
  process.kill(-group, "SIGTERM");
  const until = Date.now() + 10_000;
  while (alive(group)) {
    if (Date.now() > until) {
      try {
        process.kill(-group, "SIGKILL");
      } catch {
        // Gone in the meantime.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Starts everything and answers how to stop it all again. */
export async function startServers(): Promise<() => Promise<void>> {
  mkdirSync(LOGS, { recursive: true });
  const state = mkdtempSync(path.join(tmpdir(), "poppy-e2e-"));
  const nextEnv = path.join(playgroundDir, "next-env.d.ts");
  const nextEnvBefore = readFileSync(nextEnv, "utf8");
  const started: Started[] = [];
  let model: Server | undefined;
  const stopAll = async () => {
    await Promise.all(started.map(stop));
    await new Promise((resolve) =>
      model ? model.close(resolve) : resolve(undefined),
    );
    writeFileSync(nextEnv, nextEnvBefore);
    rmSync(state, { recursive: true, force: true });
  };
  try {
    const modelLog = createWriteStream(path.join(LOGS, "model.log"));
    model = await startFakeModel(MODEL_PORT, (line) =>
      modelLog.write(`${line}\n`),
    );
    const local = { POPPY_LOCAL_PORT_OFFSET: String(OFFSET) };
    for (const [app, origin] of Object.entries(COMPANIES)) {
      const dir = path.join(appsDir, app);
      const cwd = path.join(state, app);
      mkdirSync(cwd);
      // Run from the state folder: its vault is there, and no .env.local is.
      started.push(
        start(
          app,
          path.join(dir, "node_modules", ".bin", "tsx"),
          [
            "--tsconfig",
            path.join(dir, "tsconfig.json"),
            path.join(dir, "src", "node.ts"),
          ],
          {
            cwd,
            env: { ...local, HOST: "127.0.0.1", PUBLIC_ORIGIN: origin },
          },
        ),
      );
    }
    const playground = start(
      "playground",
      path.join(playgroundDir, "node_modules", ".bin", "next"),
      ["dev", "-p", String(3000 + OFFSET)],
      {
        cwd: playgroundDir,
        env: {
          ...local,
          PAP_ALLOW_PRIVATE_NETWORK: "true",
          POPPY_STATE_DIR: path.join(state, "playground"),
          POPPY_NEXT_DIST_DIR: ".next/e2e",
          NEXT_TELEMETRY_DISABLED: "1",
          // Over any of a developer's .env.local, which next dev still reads.
          AGENT_PUBLIC_ORIGIN: PLAYGROUND,
          POPPY_PUBLIC: "false",
          OPENAI_API_KEY: "scripted-model-no-key",
          OPENAI_BASE_URL: `http://127.0.0.1:${MODEL_PORT}/v1`,
          OPENAI_MODEL: "scripted",
        },
      },
    );
    started.push(playground);
    await Promise.all([
      ...started
        .filter((s) => s.name in COMPANIES)
        .map((s) =>
          ready(
            s,
            `${COMPANIES[s.name as keyof typeof COMPANIES]}/.well-known/poppy.json`,
          ),
        ),
      ready(playground, `${PLAYGROUND}/agent/client.json`),
    ]);
    // Compiled once here, so the scenario's own waits are about the page.
    for (const page of [
      "/playground",
      "/playground/sign-in/done",
      "/api/model",
    ])
      await ready(playground, `${PLAYGROUND}${page}`);
    return stopAll;
  } catch (error) {
    await stopAll();
    throw error;
  }
}

// `node e2e/servers.ts` starts them and keeps them up until Ctrl-C.
if (import.meta.url === `file://${process.argv[1]}`) {
  const stopAll = await startServers();
  console.log(`Playground on ${PLAYGROUND}/playground; Ctrl-C stops it all.`);
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => void stopAll().then(() => process.exit(0)));
}
