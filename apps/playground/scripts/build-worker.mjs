/**
 * Builds the Cloudflare Worker and refuses to keep an artifact that carries
 * local secrets. OpenNext embeds `.env*` values in `next-env.mjs`; a deployed
 * Poppy takes its configuration from wrangler vars and secrets only, so that
 * file is emptied and the whole bundle is scanned for any local secret value
 * from `.env*` and `.dev.vars*`, and for any app's `.env*`, `.dev.vars*` or
 * `.poppy` itself. Only names are ever printed.
 *
 * `deploy:worker` then uploads exactly this checked artifact: it sets
 * OPEN_NEXT_DEPLOY so `wrangler deploy` doesn't hand over to
 * `opennextjs-cloudflare deploy`, which would start a local runtime that reads
 * `.dev.vars` and warns that the Durable Object class is missing.
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import process from "node:process";
import console from "node:console";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, ".open-next");
// The Web Analytics token and Turnstile site key are public and live in
// wrangler.toml's vars, but the pages and the Content-Security-Policy are
// fixed at build time, so the build reads them from there (lib/analytics.ts).
const wrangler = readFileSync(path.join(root, "wrangler.toml"), "utf8");
const analytics =
  /^\s*CF_WEB_ANALYTICS_TOKEN\s*=\s*"([^"]*)"/m.exec(wrangler)?.[1] ?? "";
const turnstile =
  /^\s*TURNSTILE_SITE_KEY\s*=\s*"([^"]*)"/m.exec(wrangler)?.[1] ?? "";
const built = spawnSync("pnpm", ["exec", "opennextjs-cloudflare", "build"], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    NEXT_PUBLIC_JUNIPER_URL: "https://grocery-demo.poppylab.dev",
    NEXT_PUBLIC_LANTERN_URL: "https://food-demo.poppylab.dev",
    NEXT_PUBLIC_HARBORLINE_URL: "https://bank-demo.poppylab.dev",
    NEXT_PUBLIC_NORTHWIND_URL: "https://airline-demo.poppylab.dev",
    NEXT_PUBLIC_FERNWICK_URL: "https://energy-demo.poppylab.dev",
    CF_WEB_ANALYTICS_TOKEN: analytics,
    TURNSTILE_SITE_KEY: turnstile,
  },
});
if (built.status !== 0) process.exit(built.status ?? 1);

const envModule = path.join(out, "cloudflare", "next-env.mjs");
writeFileSync(
  envModule,
  "export const production = {};\nexport const development = {};\nexport const test = {};\n",
);

// Every local secret-looking value, and the local agent identity.
const secrets = new Map();
/** The private scalars inside a JSON value such as POPPY_IDENTITY's key pair. */
const privateParts = (value) => {
  const parts = [];
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    for (const [key, inner] of Object.entries(node))
      if (key === "d" && typeof inner === "string") parts.push(inner);
      else visit(inner);
  };
  try {
    visit(JSON.parse(value));
  } catch {
    // Not JSON: the value itself is the secret.
  }
  return parts;
};
for (const file of readdirSync(root).filter(
  (f) => f.startsWith(".env") || f.startsWith(".dev.vars"),
)) {
  const fullPath = path.join(root, file);
  if (!statSync(fullPath).isFile()) continue;
  for (const [key, value] of Object.entries(
    parseEnv(readFileSync(fullPath, "utf8")),
  )) {
    if (typeof value !== "string") continue;
    // Secrets by name; model names and default URLs are ordinary code literals.
    if (
      value.length >= 8 &&
      /KEY|SECRET|TOKEN|PASSWORD|HASH|PRIVATE|IDENTITY|CREDENTIAL/i.test(key)
    ) {
      secrets.set(`${file}:${key}`, value);
      if (value.includes("\n"))
        secrets.set(
          `${file}:${key} escaped`,
          JSON.stringify(value).slice(1, -1),
        );
      // A reformatted key pair would still carry its private scalar.
      for (const [index, part] of privateParts(value).entries())
        secrets.set(`${file}:${key} private part ${index + 1}`, part);
    }
  }
}
const identityFile = path.join(root, ".poppy", "identity.json");
if (existsSync(identityFile))
  secrets.set(
    "local identity",
    JSON.parse(readFileSync(identityFile, "utf8")).privateKey.d,
  );

const found = new Set();
// Any app's local state or secrets file, whatever it holds: next.config's
// outputFileTracingExcludes keeps them out, and this checks it did.
const localFile = (name) =>
  name === ".poppy" || name.startsWith(".env") || name.startsWith(".dev.vars");
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (localFile(name)) found.add(`local file ${path.relative(root, p)}`);
    else if (statSync(p).isDirectory()) walk(p);
    else {
      const data = readFileSync(p);
      for (const [label, value] of secrets)
        if (data.includes(value))
          found.add(`${label} in ${path.relative(root, p)}`);
    }
  }
};
walk(out);
if (found.size) {
  rmSync(out, { recursive: true, force: true });
  console.error(
    `Refusing the build: local values found (artifact deleted):\n${[...found].join("\n")}`,
  );
  process.exit(1);
}
console.log(
  `Worker bundle checked: none of ${secrets.size} local values present.`,
);

// The static-assets incremental cache's "populate" step (open-next.config):
// prerendered pages, already scanned above, become static assets.
cpSync(
  path.join(out, "cache"),
  path.join(out, "assets", "cdn-cgi", "_next_cache"),
  { recursive: true },
);
console.log("Prerendered pages copied to static assets.");
