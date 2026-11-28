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
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  const from = (address: string, header = "cf-connecting-ip") =>
    new Request("https://poppylab.dev/api/v1/account", {
      headers: { [header]: address },
    });
  const none = { get: () => undefined, set: () => {} };

  it("is Cloudflare's header on Workers, where Cloudflare sets it", async () => {
    vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
    expect(clientAddress(from("203.0.113.9"))).toBe("203.0.113.9");
    expect((await browserCaller(from("203.0.113.9"), none)).ip).toBe(
      "203.0.113.9",
    );
  });

  it("is taken from no header elsewhere when no proxy header is configured", async () => {
    expect(clientAddress(from("203.0.113.9"))).toBeNull();
    expect(clientAddress(from("203.0.113.9", "x-forwarded-for"))).toBeNull();
    expect((await browserCaller(from("203.0.113.9"), none)).ip).toBeNull();
    expect(
      apiSessionCaller(from("203.0.113.9"), {
        user: "u",
        account: "a",
        id: "s",
      } as ApiSession).ip,
    ).toBeNull();
  });

  it("reads POPPY_TRUSTED_PROXY_HEADER on Node when configured", async () => {
    vi.stubEnv("POPPY_TRUSTED_PROXY_HEADER", "X-Forwarded-For");
    // Takes the rightmost non-empty entry appended by the proxy.
    const proxied = from(" 198.51.100.1 , 203.0.113.9 ", "x-forwarded-for");
    expect(clientAddress(proxied)).toBe("203.0.113.9");
    expect((await browserCaller(proxied, none)).ip).toBe("203.0.113.9");
    expect(
      apiSessionCaller(proxied, {
        user: "u",
        account: "a",
        id: "s",
      } as ApiSession).ip,
    ).toBe("203.0.113.9");
    expect(clientAddress(from(" , , ", "x-forwarded-for"))).toBeNull();
    expect(clientAddress(from("203.0.113.9", "cf-connecting-ip"))).toBeNull();
  });

  it("ignores invalid POPPY_TRUSTED_PROXY_HEADER names and prefers Cloudflare on Workers", () => {
    vi.stubEnv("POPPY_TRUSTED_PROXY_HEADER", "x-forwarded-for invalid!");
    expect(clientAddress(from("203.0.113.9", "x-forwarded-for"))).toBeNull();

    vi.stubEnv("POPPY_TRUSTED_PROXY_HEADER", "");
    expect(clientAddress(from("203.0.113.9", "x-forwarded-for"))).toBeNull();

    vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
    vi.stubEnv("POPPY_TRUSTED_PROXY_HEADER", "x-forwarded-for");
    expect(
      clientAddress(
        new Request("https://poppylab.dev/api/v1/account", {
          headers: {
            "cf-connecting-ip": "198.51.100.1",
            "x-forwarded-for": "203.0.113.9",
          },
        }),
      ),
    ).toBe("198.51.100.1");
  });
});
