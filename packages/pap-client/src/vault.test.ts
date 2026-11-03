import { it, expect } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  statSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { vault } from "./vault.js";
it("persists initial values, skips unchanged commits and retries a failed changed snapshot", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "poppy-vault-failure-"));
  try {
    const store = vault("test", () => ({ version: 1 }), directory);
    store.save();
    const file = path.join(directory, "test.enc"),
      original = readFileSync(file),
      temporary = `${file}.${process.pid}.tmp`;
    mkdirSync(temporary);
    store.value.version = 2;
    expect(() => store.save()).toThrow();
    expect(readFileSync(file)).toEqual(original);
    rmSync(temporary, { recursive: true });
    store.save();
    expect(vault("test", () => ({ version: 0 }), directory).value.version).toBe(
      2,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
it("persists authenticated encrypted snapshots with private permissions and fails closed on corruption", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "poppy-vault-"));
  try {
    const store = vault(
      "test",
      () => ({ token: "secret-token", orders: [] as string[] }),
      directory,
    );
    store.value.orders.push("order1");
    store.save();
    const file = path.join(directory, "test.enc");
    expect(readFileSync(file).includes(Buffer.from("secret-token"))).toBe(
      false,
    );
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(path.join(directory, "storage.key")).mode & 0o777).toBe(
      0o600,
    );
    expect(
      vault("test", () => ({ token: "", orders: [] as string[] }), directory)
        .value,
    ).toEqual(store.value);
    const unchanged = readFileSync(file),
      stat = statSync(file);
    store.save();
    store.save();
    expect(readFileSync(file)).toEqual(unchanged);
    expect(statSync(file).ino).toBe(stat.ino);
    expect(statSync(file).mtimeMs).toBe(stat.mtimeMs);
    const reopened = vault(
      "test",
      () => ({ token: "", orders: [] as string[] }),
      directory,
    );
    reopened.save();
    expect(readFileSync(file)).toEqual(unchanged);
    reopened.value.orders.push("order2");
    reopened.save();
    expect(readFileSync(file)).not.toEqual(unchanged);
    const data = readFileSync(file);
    data[30] = data[30]! ^ 1;
    writeFileSync(file, data);
    expect(() => vault("test", () => ({}), directory)).toThrow(
      "Encrypted storage",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
