/**
 * Builds the Cloudflare Worker and refuses to keep an artifact that carries
 * local secrets. OpenNext embeds `.env*` values in `next-env.mjs`; a deployed
 * Poppy takes its configuration from wrangler vars and secrets only, so that
 * file is emptied and the whole bundle is scanned for any local secret value.
 * Only names are ever printed.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import console from "node:console";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, ".open-next");
const built = spawnSync("pnpm", ["exec", "opennextjs-cloudflare", "build"], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    NEXT_PUBLIC_JUNIPER_URL: "https://juniper.poppylab.dev",
    NEXT_PUBLIC_LANTERN_URL: "https://noodles.poppylab.dev",
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
for (const file of readdirSync(root).filter((f) => f.startsWith(".env"))) {
  for (const line of readFileSync(path.join(root, file), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const value = m[2].replace(/^["']|["']$/g, "");
    // Secrets by name; model names and default URLs are ordinary code literals.
    if (
      value.length >= 8 &&
      /KEY|SECRET|TOKEN|PASSWORD|HASH|PRIVATE|IDENTITY|CREDENTIAL/.test(m[1])
    )
      secrets.set(`${file}:${m[1]}`, value);
  }
}
const identityFile = path.join(root, ".poppy", "identity.json");
if (existsSync(identityFile))
  secrets.set(
    "local identity",
    JSON.parse(readFileSync(identityFile, "utf8")).privateKey.d,
  );

const found = new Set();
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
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
