/**
 * Compares the pinned PAP 1.0 text (spec/upstream.json) with the published
 * text. Exit 1 when it changed, with the changed documents listed, or exit 2
 * when any document cannot be fetched. Review the diff before updating the pin.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import console from "node:console";
import { fileURLToPath, URL } from "node:url";

const { AbortSignal, fetch } = globalThis;
const REQUEST_TIMEOUT_MS = 15_000;

const root = fileURLToPath(new URL("../", import.meta.url));
const pin = JSON.parse(readFileSync(root + "spec/upstream.json", "utf8"));
let changed = 0;
let failed = 0;
for (const doc of pin.documents) {
  let text;
  try {
    const response = await fetch(doc.url, {
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    text = await response.text();
  } catch (error) {
    failed++;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`ERROR      ${doc.url}: ${message}`);
    continue;
  }
  const hash = createHash("sha256").update(text).digest("hex");
  if (hash === doc.sha256) {
    console.log(`unchanged  ${doc.url}`);
    continue;
  }
  changed++;
  const latest = root + doc.file.replace(/\.md$/, ".latest.md");
  writeFileSync(latest, text);
  console.log(
    `CHANGED    ${doc.url}\n           diff ${doc.file} ${latest.slice(root.length)}`,
  );
}
console.log(`Pinned text retrieved ${pin.retrieved}.`);
process.exit(failed ? 2 : changed ? 1 : 0);
