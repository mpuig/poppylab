/**
 * Architectural boundary checks for `@poppy-lab/pap-agent`:
 * - Every subpath imported across `apps/`, `packages/`, and `scripts/` is
 *   declared in `package.json` `exports` and points to an existing file.
 * - Every declared export points to an existing file, and no stale unimported
 *   exports linger outside the intentional public entry allowlist.
 * - Test-only entry points (`./testing`, `./openapi`) are never imported from
 *   production (non-test) files.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const PACKAGE_NAME = "@poppy-lab/pap-agent";
const PACKAGE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const REPO_ROOT = path.resolve(PACKAGE_DIR, "../..");
const SCAN_ROOTS = ["apps", "packages", "scripts"] as const;
const IGNORED_DIRS = new Set([
  "node_modules",
  ".next",
  ".open-next",
  ".wrangler",
  "dist",
  "test-results",
  "coverage",
]);
const SOURCE_FILE_RE = /\.[cm]?[jt]sx?$/;
const TEST_FILE_RE = /\.(?:test|spec|e2e)\.[cm]?[jt]sx?$|\/e2e\//;
const VI_MOCK_METHODS = new Set([
  "mock",
  "doMock",
  "unmock",
  "doUnmock",
  "importActual",
  "importMock",
]);

/**
 * Intentional public entry points that may remain exported even when not
 * directly imported inside this monorepo.
 */
const PUBLIC_ENTRY_ALLOWLIST = new Set([
  ".",
  "./api-contract",
  "./openapi.json",
  "./testing",
]);

/** Entry points that must only be imported by test files. */
const TEST_ONLY_SUBPATHS = new Set(["./testing", "./openapi"]);

type PackageManifest = {
  exports: Record<string, string>;
};

function loadPackageExports(): Record<string, string> {
  const manifest = JSON.parse(
    readFileSync(path.join(PACKAGE_DIR, "package.json"), "utf8"),
  ) as PackageManifest;
  return manifest.exports;
}

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      collectSourceFiles(path.join(dir, entry.name), out);
    } else if (entry.isFile() && SOURCE_FILE_RE.test(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

function toSubpath(specifier: string): string | undefined {
  if (specifier === PACKAGE_NAME) return ".";
  if (specifier.startsWith(`${PACKAGE_NAME}/`)) {
    return `./${specifier.slice(PACKAGE_NAME.length + 1)}`;
  }
  return undefined;
}

function extractImportedSubpaths(filePath: string, source: string): string[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const subpaths = new Set<string>();

  const record = (node: ts.Node | undefined) => {
    if (!node || !ts.isStringLiteralLike(node)) return;
    const subpath = toSubpath(node.text);
    if (subpath) subpaths.add(subpath);
  };

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      record(node.moduleSpecifier);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument)
    ) {
      record(node.argument.literal);
    } else if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const expr = node.expression;
      if (expr.kind === ts.SyntaxKind.ImportKeyword) {
        record(node.arguments[0]);
      } else if (ts.isIdentifier(expr) && expr.text === "require") {
        record(node.arguments[0]);
      } else if (
        ts.isPropertyAccessExpression(expr) &&
        ts.isIdentifier(expr.expression) &&
        expr.expression.text === "vi" &&
        VI_MOCK_METHODS.has(expr.name.text)
      ) {
        record(node.arguments[0]);
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return [...subpaths];
}

function isTestFile(repoRelativePath: string): boolean {
  return TEST_FILE_RE.test(repoRelativePath.replaceAll(path.sep, "/"));
}

function scanWorkspaceImports(): Map<string, string[]> {
  const importsBySubpath = new Map<string, string[]>();
  for (const root of SCAN_ROOTS) {
    for (const filePath of collectSourceFiles(path.join(REPO_ROOT, root))) {
      const source = readFileSync(filePath, "utf8");
      if (!source.includes(PACKAGE_NAME)) continue;
      const relPath = path
        .relative(REPO_ROOT, filePath)
        .replaceAll(path.sep, "/");
      for (const subpath of extractImportedSubpaths(filePath, source)) {
        const files = importsBySubpath.get(subpath) ?? [];
        files.push(relPath);
        importsBySubpath.set(subpath, files);
      }
    }
  }
  return importsBySubpath;
}

describe("@poppy-lab/pap-agent package exports", () => {
  const packageExports = loadPackageExports();
  const workspaceImports = scanWorkspaceImports();

  it("declares every imported subpath in package.json exports and points to existing files", () => {
    expect(workspaceImports.size).toBeGreaterThan(0);

    const missingExports: Array<{ subpath: string; files: string[] }> = [];
    const missingTargets: Array<{ subpath: string; target: string }> = [];

    for (const [subpath, files] of [...workspaceImports.entries()].sort()) {
      const target = packageExports[subpath];
      if (!target) {
        missingExports.push({ subpath, files: [...files].sort() });
        continue;
      }
      if (!existsSync(path.resolve(PACKAGE_DIR, target))) {
        missingTargets.push({ subpath, target });
      }
    }

    for (const [subpath, target] of Object.entries(packageExports)) {
      if (!existsSync(path.resolve(PACKAGE_DIR, target))) {
        missingTargets.push({ subpath, target });
      }
    }

    expect(missingExports).toEqual([]);
    expect(missingTargets).toEqual([]);
  });

  it("has no stale unimported exports outside the public entry allowlist", () => {
    const staleExports = Object.keys(packageExports)
      .filter(
        (subpath) =>
          !workspaceImports.has(subpath) &&
          !PUBLIC_ENTRY_ALLOWLIST.has(subpath),
      )
      .sort();

    expect(staleExports).toEqual([]);
  });

  it("forbids importing test-only subpaths from production files", () => {
    const violations: Array<{ subpath: string; file: string }> = [];

    for (const subpath of TEST_ONLY_SUBPATHS) {
      for (const file of workspaceImports.get(subpath) ?? []) {
        if (!isTestFile(file)) {
          violations.push({ subpath, file });
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
