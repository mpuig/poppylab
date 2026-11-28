import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
      "juniper",
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
      "juniper",
      [
        "src/accounts.test.ts",
        "src/consent-page.test.ts",
        "src/authority-regression.test.ts",
      ],
    ],
    ["pap-agent", ["src/account-permissions.test.ts", "src/runtime.test.ts"]],
    [
      "playground",
      [
        "app/api/account/route.test.ts",
        "app/api/account/callback/route.test.ts",
        "lib/later-consent.test.ts",
        "lib/same-account.test.ts",
      ],
    ],
  ],
  "pap-1.0": [
    ["pap-core", ["src/index.test.ts"]],
    [
      "pap-client",
      [
        "src/discovery.test.ts",
        "src/index.test.ts",
        "src/session-header.test.ts",
        "src/session.test.ts",
        "src/headers.test.ts",
        "src/protocol-error.test.ts",
      ],
    ],
    ["lantern", ["src/pap10.test.ts"]],
    ["pap-agent", ["src/mcp-runtime.test.ts", "src/runtime.test.ts"]],
    [
      "playground",
      ["app/company-profile.test.ts", "app/api/account/callback/route.test.ts"],
    ],
  ],
  noodles: [
    ["lantern", ["src/lantern.test.ts"]],
    ["juniper", ["src/operations-v2.test.ts"]],
  ],
  banking: [
    ["pap-company", ["src/gateway/grant-lifetime.test.ts"]],
    [
      "harborline",
      [
        "src/harborline.test.ts",
        "src/conversations.test.ts",
        "src/fdx.test.ts",
        "src/account-choice.test.ts",
        "src/statements.test.ts",
      ],
    ],
  ],
  fdx: [
    [
      "pap-company",
      [
        "src/gateway/account-routes.test.ts",
        "src/gateway/extensions.test.ts",
        "src/gateway/grant-lifetime.test.ts",
      ],
    ],
    [
      "harborline",
      [
        "src/fdx.test.ts",
        "src/account-choice.test.ts",
        "src/statements.test.ts",
      ],
    ],
    ["pap-client", ["src/fdx.test.ts", "src/protocol-error.test.ts"]],
    ["pap-agent", ["src/fdx-runtime.test.ts", "src/demo-fdx.test.ts"]],
    [
      "playground",
      [
        "lib/fdx-harborline.test.ts",
        "app/playground/fdx-consent.test.ts",
        "app/playground/fdx-statements.test.ts",
      ],
    ],
  ],
  airline: [["northwind", ["src/northwind.test.ts"]]],
  energy: [
    [
      "fernwick",
      [
        "src/data.test.ts",
        "src/espi.test.ts",
        "src/fernwick.test.ts",
        "src/conversations.test.ts",
        "src/how-it-works.test.ts",
      ],
    ],
    ["pap-company", ["src/gateway/account-routes.test.ts"]],
    ["pap-client", ["src/espi.test.ts", "src/xml.test.ts"]],
    [
      "pap-agent",
      [
        "src/espi-runtime.test.ts",
        "src/demo-espi.test.ts",
        "src/token-response.test.ts",
      ],
    ],
    [
      "playground",
      [
        "lib/espi-fernwick.test.ts",
        "lib/use-espi-fernwick.test.ts",
        "app/playground/espi-authorization.test.ts",
      ],
    ],
  ],
  conversations: [
    ["lantern", ["src/conversations.test.ts"]],
    ["harborline", ["src/conversations.test.ts"]],
    ["northwind", ["src/conversations.test.ts"]],
    ["fernwick", ["src/conversations.test.ts"]],
    ["juniper", ["src/conversations.test.ts"]],
    ["pap-agent", ["src/conversations.test.ts"]],
  ],
  mcp: [
    ["pap-client", ["src/mcp.test.ts", "src/mcp-transport.test.ts"]],
    ["pap-agent", ["src/mcp-runtime.test.ts"]],
  ],
  nonce: [
    ["pap-client", ["src/nonce-request.test.ts"]],
    ["juniper", ["src/dpop-nonce.test.ts"]],
  ],
  revisions: [
    [
      "juniper",
      [
        "src/operations-v2.test.ts",
        "src/authority-regression.test.ts",
        "src/openapi.test.ts",
      ],
    ],
    ["pap-agent", ["src/runtime.test.ts"]],
    ["playground", ["app/api/account/juniper-approval.test.ts"]],
  ],
  operations: [
    ["pap-agent", ["src/operation-validation.test.ts"]],
    [
      "playground",
      [
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
    ["juniper", ["src/authority-regression.test.ts"]],
  ],
};
// A test file that moved or was renamed would otherwise run nothing and
// fail its group with no reason given.
const missing = Object.values(groups)
  .flat()
  .flatMap(([workspace, files]) => {
    const folder = ["apps", "packages"]
      .map((parent) => path.join(root, parent, workspace))
      .find((candidate) => existsSync(candidate));
    return files
      .filter((file) => !folder || !existsSync(path.join(folder, file)))
      .map((file) => `${workspace}/${file}`);
  });
if (missing.length) {
  console.error(`Listed test files not found:\n${missing.join("\n")}`);
  process.exit(2);
}
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
