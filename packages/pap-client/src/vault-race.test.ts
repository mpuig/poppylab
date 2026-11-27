import { it, expect } from "vitest";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { vault } from "./vault.js";

const source = fileURLToPath(new URL("./vault.ts", import.meta.url));

// A child process opens the vault and saves its own snapshot, so a child that
// read a half-written key, or kept a key another child replaced, shows up as
// a failed child or as a snapshot the parent can't decrypt. A slow child
// writes the key in two halves and waits for a release file in between,
// holding open the moment another opener could see a partial key.
function opener(directory: string, name: string, slow?: { signals: string }) {
  const pause = slow
    ? `import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const write = fs.writeFileSync;
fs.writeFileSync = (file, data, options) => {
  if (!String(file).includes("storage.key")) return write(file, data, options);
  const fd = fs.openSync(file, options?.flag ?? "w", options?.mode);
  try {
    fs.writeSync(fd, data.subarray(0, 16));
    write(${JSON.stringify(path.join(slow.signals, "started"))}, "");
    const until = Date.now() + 10000;
    while (!fs.existsSync(${JSON.stringify(path.join(slow.signals, "release"))}) && Date.now() < until)
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    fs.writeSync(fd, data.subarray(16));
  } finally {
    fs.closeSync(fd);
  }
};
syncBuiltinESMExports();
`
    : "";
  const script = `${pause}const { vault } = await import(${JSON.stringify(source)});
const store = vault(${JSON.stringify(name)}, () => ({ name: ${JSON.stringify(name)} }), ${JSON.stringify(directory)});
store.save();`;
  return new Promise<string>((resolve) => {
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", script],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("close", (code) => resolve(code === 0 ? "" : stderr));
  });
}

it("gives processes that open a new vault at once the same complete key", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "poppy-vault-race-"));
  const signals = mkdtempSync(path.join(tmpdir(), "poppy-vault-signals-"));
  try {
    const slow = opener(directory, "slow", { signals });
    while (!existsSync(path.join(signals, "started"))) await sleep(10);
    const names = Array.from({ length: 4 }, (_, i) => `opener-${i}`);
    const failures = await Promise.all(
      names.map((name) => opener(directory, name)),
    );
    writeFileSync(path.join(signals, "release"), "");
    failures.push(await slow);
    expect(failures.filter(Boolean)).toEqual([]);
    for (const name of ["slow", ...names])
      expect(vault(name, () => ({ name: "" }), directory).value.name).toBe(
        name,
      );
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(signals, { recursive: true, force: true });
  }
}, 30_000);
