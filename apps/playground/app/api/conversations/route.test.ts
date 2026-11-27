/**
 * The conversations list and the demo reset, at their boundary: they fail
 * closed on a deployment that isn't configured, take only the page's own
 * requests, and read a bounded body.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const deployment = vi.hoisted(() => ({ serving: true }));
const reset = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@poppy-lab/pap-agent/deployment", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@poppy-lab/pap-agent/deployment")>()),
  serving: () => deployment.serving,
}));
vi.mock("@poppy-lab/pap-agent/runs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@poppy-lab/pap-agent/runs")>()),
  resetDemo: reset,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name.includes("visitor") ? { value: "c".repeat(43) } : undefined,
    set: vi.fn(),
  }),
}));
import { configureBackend, memoryBackend } from "@poppy-lab/pap-agent/runs";
import { GET, POST } from "./route";

const agent = "http://localhost:3000";
const action = (body: string, headers: Record<string, string> = {}) =>
  POST(
    new Request(`${agent}/api/conversations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: agent,
        ...headers,
      },
      body,
    }),
  );

beforeEach(() => {
  deployment.serving = true;
  reset.mockClear();
  configureBackend(memoryBackend());
});

describe("/api/conversations", () => {
  it("lists and resets for the page's own requests", async () => {
    expect(await (await GET()).json()).toEqual({ conversations: [] });
    const done = await action('{"action":"reset-demo"}');
    expect(done.status).toBe(200);
    expect(reset).toHaveBeenCalledOnce();
  });
  it("is disabled on a deployment that isn't configured", async () => {
    deployment.serving = false;
    const listed = await GET();
    expect(listed.status).toBe(403);
    expect(await listed.json()).toEqual({
      error: "Conversations are disabled on this deployment.",
    });
    expect((await action('{"action":"reset-demo"}')).status).toBe(403);
    expect(reset).not.toHaveBeenCalled();
  });
  it("refuses a reset without the page's Origin", async () => {
    const request = new Request(`${agent}/api/conversations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"action":"reset-demo"}',
    });
    expect((await POST(request)).status).toBe(403);
    expect(
      (await action('{"action":"reset-demo"}', { Origin: "https://x.example" }))
        .status,
    ).toBe(403);
    expect(reset).not.toHaveBeenCalled();
  });
  it("reads a bounded JSON body only", async () => {
    const large = JSON.stringify({
      action: "reset-demo",
      padding: "x".repeat(2000),
    });
    expect((await action(large)).status).toBe(400);
    expect(
      (
        await action('{"action":"reset-demo"}', {
          "Content-Type": "text/plain",
        })
      ).status,
    ).toBe(400);
    expect(reset).not.toHaveBeenCalled();
  });
});
