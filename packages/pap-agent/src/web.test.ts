import { describe, expect, it } from "vitest";
import { readJson } from "./web";

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
