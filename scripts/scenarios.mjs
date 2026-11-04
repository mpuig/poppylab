import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import console from "node:console";
import { spawnSync } from "node:child_process";
const root = fileURLToPath(new URL("../", import.meta.url));
const groups = {
  authority: [
    [
      "example-company",
      [
        "src/accounts.test.ts",
        "src/refresh.test.ts",
        "src/authority-regression.test.ts",
        "src/shopping.test.ts",
      ],
    ],
  ],
  permissions: [
    [
      "example-company",
      [
        "src/accounts.test.ts",
        "src/consent-page.test.ts",
        "src/authority-regression.test.ts",
      ],
    ],
    [
      "playground",
      [
        "lib/account-permissions.test.ts",
        "lib/runtime.test.ts",
        "app/api/account/route.test.ts",
        "app/api/account/callback/route.test.ts",
      ],
    ],
  ],
  "pap-0.3": [
    [
      "pap-client",
      [
        "src/discovery03.test.ts",
        "src/index.test.ts",
        "src/session-header.test.ts",
      ],
    ],
    [
      "playground",
      [
        "app/company-profile.test.ts",
        "lib/mcp-runtime.test.ts",
        "lib/runtime.test.ts",
        "app/api/account/callback/route.test.ts",
      ],
    ],
  ],
  noodles: [
    ["lantern", ["src/lantern.test.ts"]],
    ["example-company", ["src/operations-v2.test.ts"]],
  ],
  conversations: [
    ["lantern", ["src/conversations.test.ts"]],
    ["example-company", ["src/conversations.test.ts"]],
    ["playground", ["lib/conversations.test.ts"]],
  ],
  mcp: [
    ["pap-client", ["src/mcp.test.ts", "src/mcp-transport.test.ts"]],
    ["playground", ["lib/mcp-runtime.test.ts"]],
  ],
  nonce: [
    ["pap-client", ["src/nonce-request.test.ts"]],
    ["example-company", ["src/dpop-nonce.test.ts"]],
  ],
  revisions: [
    [
      "example-company",
      [
        "src/operations-v2.test.ts",
        "src/authority-regression.test.ts",
        "src/openapi.test.ts",
      ],
    ],
    [
      "playground",
      ["app/api/account/juniper-approval.test.ts", "lib/runtime.test.ts"],
    ],
  ],
  operations: [
    [
      "playground",
      [
        "lib/operation-validation.test.ts",
        "app/api/account/route.test.ts",
        "app/api/account/callback/route.test.ts",
        "app/operation-review.test.ts",
      ],
    ],
  ],
  recovery: [
    [
      "pap-client",
      [
        "src/protocol-error.test.ts",
        "src/retry-persistence.test.ts",
        "src/vault.test.ts",
      ],
    ],
    ["example-company", ["src/authority-regression.test.ts"]],
  ],
};
const selected = process.argv.slice(2);
if (selected.includes("--list")) {
  console.log(Object.keys(groups).join("\n"));
  process.exit(0);
}
if (selected.some((name) => !Object.hasOwn(groups, name))) {
  console.error("Unknown scenario. Use --list.");
  process.exit(2);
}
const directory = mkdtempSync(path.join(tmpdir(), "poppy-scenarios-"));
const env = Object.fromEntries(
  ["PATH", "HOME", "TMPDIR", "SYSTEMROOT", "LANG"]
    .filter((key) => process.env[key])
    .map((key) => [key, process.env[key]]),
);
Object.assign(env, { NODE_ENV: "test", CI: "true", NO_COLOR: "1" });
const results = [];
for (const name of selected.length ? selected : Object.keys(groups)) {
  for (const [workspace, files] of groups[name]) {
    const output = path.join(directory, `${name}-${workspace}.json`);
    const started = Date.now();
    const child = spawnSync(
      "pnpm",
      [
        "--filter",
        `@poppy-lab/${workspace}`,
        "exec",
        "vitest",
        "run",
        ...files,
        "--maxWorkers=2",
        "--reporter=json",
        `--outputFile=${output}`,
      ],
      {
        cwd: root,
        env,
        encoding: "utf8",
        timeout: 120000,
        maxBuffer: 8 * 1024 * 1024,
      },
    );
    let report;
    try {
      report = JSON.parse(readFileSync(output, "utf8"));
    } catch {
      /* Missing report is a failed scenario. */
    }
    const passed =
      child.status === 0 &&
      report?.success === true &&
      report.numPassedTests > 0;
    results.push({
      name,
      workspace,
      passed,
      tests: report?.numTotalTests ?? 0,
      passedTests: report?.numPassedTests ?? 0,
      durationMs: Date.now() - started,
    });
    console.log(
      `${passed ? "PASS" : "FAIL"} ${name}/${workspace} (${results.at(-1).passedTests}/${results.at(-1).tests})`,
    );
  }
}
const report = path.join(directory, "summary.json");
writeFileSync(
  report,
  JSON.stringify({ isolatedTestState: true, results }, null, 2),
  { mode: 0o600 },
);
console.log(`Report: ${report}`);
process.exitCode = results.every((r) => r.passed) ? 0 : 1;
