/**
 * A Company's Durable Object starts its gateway once, however many
 * requests arrive cold, and again from storage after a failed save. The
 * documents it fetches come over HTTPS, small and quick.
 */
import { afterEach, expect, it, vi } from "vitest";
import type { CompanyDefinition } from "./gateway/types.ts";
import type { KeyValue } from "./split-store.ts";
import { createWorkerCompany, workerFetchJson } from "./worker.ts";

const company: CompanyDefinition = {
  name: "Test Company",
  readScope: "things:read",
  writeScope: "things:write",
  consent: ({ nonce }) => `<p>${nonce}</p>`,
  persona: (id) => (id === "elena" ? { id: "elena" } : undefined),
  defaultAccount: "elena",
  discovery: () => ({}),
  paths: {},
  mount: () => {},
};

/** Durable Object storage in memory, counting loads; `wait` holds a load. */
function storage() {
  const data = new Map<string, unknown>();
  const kv: KeyValue & {
    loads: number;
    failPut?: boolean;
    wait?: Promise<void>;
  } = {
    loads: 0,
    async get<T>(key: string) {
      kv.loads++;
      await kv.wait;
      return structuredClone(data.get(key)) as T | undefined;
    },
    async list<T>() {
      return new Map<string, T>();
    },
    async put(entries) {
      if (kv.failPut) {
        delete kv.failPut;
        throw new Error("storage down");
      }
      for (const [k, v] of Object.entries(entries))
        data.set(k, structuredClone(v));
    },
    async delete(keys) {
      return keys.filter((k) => data.delete(k)).length;
    },
  };
  return kv;
}
const discovery = "https://company.test/.well-known/oauth-authorization-server";

afterEach(() => vi.unstubAllGlobals());

it("starts one gateway for requests that arrive while it starts", async () => {
  const kv = storage();
  let release!: () => void;
  kv.wait = new Promise((done) => (release = done));
  const define = vi.fn(() => company);
  const worker = createWorkerCompany(define, {
    storage: kv,
    origin: "https://company.test",
  });
  const both = Promise.all([
    worker.fetch(new Request(discovery)),
    worker.fetch(new Request(discovery)),
  ]);
  release();
  const statuses = (await both).map((r) => r.status);
  expect(statuses).toEqual([200, 200]);
  expect(kv.loads).toBe(1);
  expect(define).toHaveBeenCalledOnce();
});

it("starts again from storage after a failed save", async () => {
  const kv = storage();
  const worker = createWorkerCompany(company, {
    storage: kv,
    origin: "https://company.test",
  });
  expect((await worker.fetch(new Request(discovery))).status).toBe(200);
  kv.failPut = true;
  const failed = await worker.fetch(
    new Request("https://company.test/anything", { method: "POST" }),
  );
  expect(failed.status).toBe(503);
  expect(kv.loads).toBe(1);
  // The next request gets a new gateway, loaded from what is stored.
  expect((await worker.fetch(new Request(discovery))).status).toBe(200);
  expect(kv.loads).toBe(2);
});

it("tries a start that failed again on the next request", async () => {
  const kv = storage();
  kv.wait = Promise.reject(new Error("storage down"));
  kv.wait.catch(() => {});
  const worker = createWorkerCompany(company, {
    storage: kv,
    origin: "https://company.test",
  });
  await expect(worker.fetch(new Request(discovery))).rejects.toThrow(
    "storage down",
  );
  delete kv.wait;
  expect((await worker.fetch(new Request(discovery))).status).toBe(200);
});

it("accepts a plain-HTTP Personal Agent only on a local origin", async () => {
  const devHttpClient = "http://localhost:3000/agent/client.json";
  const csp = async (origin: string) => {
    const worker = createWorkerCompany(company, {
      storage: storage(),
      origin,
      devHttpClient,
    });
    const response = await worker.fetch(
      new Request(`${origin}/.well-known/oauth-authorization-server`),
    );
    return response.headers.get("content-security-policy") ?? "";
  };
  // The development client's origin is a form target only where it is accepted.
  expect(await csp("http://company.localhost:8787")).toContain(
    "form-action 'self' http://localhost:3000",
  );
  expect(await csp("https://company.test")).not.toContain("localhost:3000");
});

/** `fetch` answering with `body`, recording what it was asked. */
function serve(body: BodyInit | null, init: ResponseInit = {}) {
  const calls: Array<[string, RequestInit | undefined]> = [];
  vi.stubGlobal("fetch", async (url: string, options?: RequestInit) => {
    calls.push([url, options]);
    return new Response(body, init);
  });
  return calls;
}

it("fetches JSON over HTTPS, without following redirects, with a timeout", async () => {
  const calls = serve(JSON.stringify({ keys: [] }));
  expect(await workerFetchJson("https://agent.test/jwks.json")).toEqual({
    keys: [],
  });
  const [, options] = calls[0]!;
  expect(options?.redirect).toBe("manual");
  expect(options?.signal).toBeInstanceOf(AbortSignal);
});

it("refuses plain HTTP, except for the development origin", async () => {
  const calls = serve("{}");
  await expect(
    workerFetchJson("http://agent.test/client.json"),
  ).rejects.toThrow("HTTPS required");
  expect(calls).toHaveLength(0);
  expect(
    await workerFetchJson(
      "http://localhost:3000/agent/client.json",
      "http://localhost:3000",
    ),
  ).toEqual({});
  await expect(
    workerFetchJson(
      "http://localhost:3001/client.json",
      "http://localhost:3000",
    ),
  ).rejects.toThrow("HTTPS required");
});

it("refuses a redirect or an error", async () => {
  serve(null, { status: 302, headers: { Location: "https://elsewhere.test" } });
  await expect(workerFetchJson("https://agent.test/a")).rejects.toThrow(
    "HTTP 302",
  );
  serve("{}", { status: 500 });
  await expect(workerFetchJson("https://agent.test/a")).rejects.toThrow(
    "HTTP 500",
  );
});

it("refuses more than 64 KB, declared or streamed", async () => {
  serve("{}", { headers: { "Content-Length": String(64 * 1024 + 1) } });
  await expect(workerFetchJson("https://agent.test/a")).rejects.toThrow(
    "Response too large",
  );
  // No length declared: counted as the bytes arrive, and cut off.
  const chunk = new Uint8Array(16 * 1024).fill(32);
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      sent++;
      controller.enqueue(chunk);
    },
  });
  serve(body);
  await expect(workerFetchJson("https://agent.test/a")).rejects.toThrow(
    "Response too large",
  );
  expect(sent).toBeLessThan(10);
  // 64 KB exactly is read.
  serve(`"${"a".repeat(64 * 1024 - 2)}"`);
  expect(await workerFetchJson("https://agent.test/a")).toHaveLength(
    64 * 1024 - 2,
  );
});
