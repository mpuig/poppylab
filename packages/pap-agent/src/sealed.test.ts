import { expect, it } from "vitest";
import { importStateKey, seal, sealedBackend, unseal } from "./sealed";
import { memoryBackend } from "./runs";

const secret = Buffer.from(new Uint8Array(32).fill(7)).toString("base64url");

it("stores only ciphertext, bound to the row, and reads it back", async () => {
  const inner = memoryBackend();
  const b = sealedBackend(inner, importStateKey(secret));
  const run = { accountToken: "refresh-secret", history: [] };
  expect(await b.put("v1", "run:a", run, null)).toBe(true);
  const raw = (await inner.get("v1", "run:a"))!.value as Record<
    string,
    unknown
  >;
  expect(JSON.stringify(raw)).not.toContain("refresh-secret");
  expect(raw).toMatchObject({ v: 1 });
  expect((await b.get("v1", "run:a"))!.value).toEqual(run);
  expect((await b.list("v1", "run:"))[0]![1].value).toEqual(run);
  // The same ciphertext under another visitor or key is unreadable.
  const key = await importStateKey(secret);
  await expect(unseal(key, "v2\nrun:a", raw)).rejects.toThrow();
  const other = await importStateKey(
    Buffer.from(new Uint8Array(32).fill(9)).toString("base64url"),
  );
  await expect(
    unseal(other, "v1\nrun:a", await seal(key, "v1\nrun:a", 1)),
  ).rejects.toThrow();
  // A record this key can't open reads as absent, never as data.
  await inner.put(
    "v1",
    "run:b",
    { v: 1, iv: "AAAAAAAAAAAAAAAA", ct: "AAAA" },
    null,
  );
  expect(await b.get("v1", "run:b")).toBeUndefined();
});

it("refuses a missing or short key", async () => {
  await expect(importStateKey(undefined)).rejects.toThrow("POPPY_STATE_KEY");
  await expect(importStateKey("c2hvcnQ")).rejects.toThrow("POPPY_STATE_KEY");
});
