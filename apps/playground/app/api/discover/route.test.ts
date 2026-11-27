import { beforeEach, describe, expect, it, vi } from "vitest";

const deployment = vi.hoisted(() => ({ serving: true }));
vi.mock("@poppy-lab/pap-agent/deployment", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@poppy-lab/pap-agent/deployment")>()),
  serving: () => deployment.serving,
}));
vi.mock("@poppy-lab/pap-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@poppy-lab/pap-client")>()),
  discoverCompany: vi.fn(),
}));
import { discoverCompany } from "@poppy-lab/pap-client";
import { POST } from "./route";

const makeRequest = (body: string, headers: Record<string, string> = {}) =>
  new Request("http://localhost:3000/api/discover", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:3000",
      ...headers,
    },
    body,
  });

beforeEach(() => {
  deployment.serving = true;
  vi.mocked(discoverCompany).mockReset();
});

describe("discovery route boundary", () => {
  it("rejects cross-origin requests before fetching", async () => {
    expect(
      (
        await POST(
          makeRequest('{"url":"example.com"}', {
            Origin: "https://attacker.example",
          }),
        )
      ).status,
    ).toBe(403);
    expect(discoverCompany).not.toHaveBeenCalled();
  });
  it("rejects requests without an Origin, as the other routes do", async () => {
    const request = makeRequest('{"url":"example.com"}');
    request.headers.delete("Origin");
    expect((await POST(request)).status).toBe(403);
    expect(discoverCompany).not.toHaveBeenCalled();
  });
  it("is disabled on a deployment that isn't configured", async () => {
    deployment.serving = false;
    const response = await POST(makeRequest('{"url":"example.com"}'));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Discovery is disabled on this deployment.",
    });
    expect(discoverCompany).not.toHaveBeenCalled();
  });
  it("rejects non-JSON content types", async () => {
    expect(
      (await POST(makeRequest("{}", { "Content-Type": "text/plain" }))).status,
    ).toBe(415);
  });
  it("bounds body size", async () => {
    expect((await POST(makeRequest(" ".repeat(4097)))).status).toBe(400);
    expect(discoverCompany).not.toHaveBeenCalled();
  });
  it("rejects malformed JSON", async () => {
    expect((await POST(makeRequest("{"))).status).toBe(400);
  });
  it("rejects blank URLs", async () => {
    expect((await POST(makeRequest('{"url":" "}'))).status).toBe(400);
  });
  it("never caches successful results", async () => {
    vi.mocked(discoverCompany).mockResolvedValue(
      {} as Awaited<ReturnType<typeof discoverCompany>>,
    );
    const response = await POST(makeRequest('{"url":"example.com"}'));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(discoverCompany).toHaveBeenCalledWith("example.com", {
      allowedPrivateOrigins: [],
    });
  });
});
