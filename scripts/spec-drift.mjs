/**
 * Compares the pinned PAP 0.3 text (spec/upstream.json) with the published
 * draft. Exit 1 when it changed, with the changed documents listed. The
 * draft changes often; review the diff before updating the pin.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import console from "node:console";
import { fileURLToPath, URL } from "node:url";

const { fetch } = globalThis;

const root = fileURLToPath(new URL("../", import.meta.url));
const pin = JSON.parse(readFileSync(root + "spec/upstream.json", "utf8"));
let changed = 0;
for (const doc of pin.documents) {
  const response = await fetch(doc.url, { redirect: "error" });
  if (!response.ok) throw new Error(`${doc.url}: HTTP ${response.status}`);
  const text = await response.text();
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
process.exit(changed ? 1 : 0);
