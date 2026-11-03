import { afterEach, expect, it, vi } from "vitest";
import { protocolRequest } from "./index.ts";

afterEach(() => vi.unstubAllGlobals());
function onWorkers() {
  vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
  const fetch = vi.fn(
    async () =>
      new Response('{"ok":true}', {
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

it("on Workers, fetches public HTTPS hosts without redirects", async () => {
  const fetch = onWorkers();
  expect(await protocolRequest("https://juniper.poppylab.dev/api/x")).toEqual({
    ok: true,
  });
  expect(fetch).toHaveBeenCalledOnce();
  expect((fetch.mock.calls[0] as unknown[])[1]).toMatchObject({
    redirect: "manual",
  });
});

it.each([
  "http://juniper.poppylab.dev/",
  "https://localhost/",
  "https://juniper.localhost/",
  "https://router.local/",
  "https://intranet/",
  "https://10.0.0.1/",
  "https://127.0.0.1/",
  "https://[::1]/",
  "https://169.254.169.254/",
  "https://user:pw@juniper.poppylab.dev/",
])("on Workers, refuses %s before any request", async (url) => {
  const fetch = onWorkers();
  await expect(protocolRequest(url)).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});
