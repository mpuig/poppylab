import { afterEach, describe, expect, it, vi } from "vitest";
import { apiSessionCaller } from "./identity";
import type { ApiSession } from "./account-store";
import { browserCaller, clientAddress, readJson } from "./web";

/** A JSON request whose body arrives in the given chunks. */
const streamed = (chunks: Uint8Array[]) =>
  new Request("http://localhost:3000/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
    duplex: "half",
  } as RequestInit);

describe("readJson", () => {
  it("keeps a character whole when it is split between two chunks", async () => {
    const bytes = new TextEncoder().encode('{"text":"Crème brûlée"}');
    const split = bytes.indexOf(0xc3) + 1;
    expect(
      await readJson(
        streamed([bytes.slice(0, split), bytes.slice(split)]),
        6000,
      ),
    ).toEqual({ text: "Crème brûlée" });
  });
  it("refuses a body over its limit, counted in bytes", async () => {
    const bytes = new TextEncoder().encode(`{"text":"${"é".repeat(10)}"}`);
    await expect(readJson(streamed([bytes]), 20)).rejects.toThrow(
      "Request too large",
    );
  });
  it("refuses what isn't JSON", async () => {
    await expect(
      readJson(
        new Request("http://localhost:3000/api/chat", {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: "{}",
        }),
        6000,
      ),
    ).rejects.toThrow("Use JSON");
  });
});

describe("the client's address", () => {
  afterEach(() => vi.unstubAllGlobals());
  const from = (address: string) =>
    new Request("https://poppylab.dev/api/v1/account", {
      headers: { "cf-connecting-ip": address },
    });
  const none = { get: () => undefined, set: () => {} };

  it("is Cloudflare's header on Workers, where Cloudflare sets it", async () => {
    vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
    expect(clientAddress(from("203.0.113.9"))).toBe("203.0.113.9");
    expect((await browserCaller(from("203.0.113.9"), none)).ip).toBe(
      "203.0.113.9",
    );
  });

  it("is taken from no header elsewhere, where any client can send one", async () => {
    expect(clientAddress(from("203.0.113.9"))).toBeNull();
    expect((await browserCaller(from("203.0.113.9"), none)).ip).toBeNull();
    expect(
      apiSessionCaller(from("203.0.113.9"), {
        user: "u",
        account: "a",
        id: "s",
      } as ApiSession).ip,
    ).toBeNull();
  });
});
