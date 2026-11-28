import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountAction } from "./account";
import { RUN_LIMITS } from "./run-size";
import {
  configureBackend,
  createRun,
  memoryBackend,
  releaseRun,
  type Backend,
} from "./runs";
import type { Operation } from "./runtime";
import type { Caller } from "./web";

const COMPANY = "https://food.papsandbox.com";

function copyingBackend(): Backend {
  const inner = memoryBackend();
  return {
    async get(visitor, key) {
      const entry = await inner.get(visitor, key);
      return entry ? structuredClone(entry) : undefined;
    },
    put(visitor, key, value, expected, expires) {
      return inner.put(visitor, key, structuredClone(value), expected, expires);
    },
    remove: (visitor, key) => inner.remove(visitor, key),
    async list(visitor, prefix) {
      return (await inner.list(visitor, prefix)).map(([k, v]) => [
        k,
        structuredClone(v),
      ]);
    },
    count: (visitor, key, windowMs) => inner.count(visitor, key, windowMs),
  };
}

function makeCaller(visitor = "visitor_account_test"): Caller {
  return {
    authentic: true,
    localDev: true,
    origin: "http://localhost:3000",
    ip: "127.0.0.1",
    user: () => visitor,
    signIns: {
      holds: () => false,
      bind: () => {},
      release: () => {},
    },
  };
}

function proposal(id = "op_1"): Operation {
  return {
    operation_id: id,
    revision: "r1",
    state: "proposed",
    expires_at: "2030-01-01T00:00:00Z",
    request: { url: `${COMPANY}/api/order`, body: { item: "ramen" } },
  };
}

describe("accountAction persistence failure handling", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    configureBackend(memoryBackend());
  });

  it("does not return success when releaseRun fails with RunNotSaved (failed)", async () => {
    const store = copyingBackend();
    configureBackend(store);
    const visitor = "visitor_save_fail";
    const held = await createRun(visitor, COMPANY);
    held.run.connections[0]!.operations = { op_1: proposal("op_1") };
    await releaseRun(visitor, held);

    // First put is acquireRun's lock write; second put is releaseRun's save.
    const realPut = store.put;
    let puts = 0;
    store.put = async (v, key, value, expected, expires) => {
      puts += 1;
      if (puts === 2) throw new Error("storage unavailable");
      return realPut(v, key, value, expected, expires);
    };

    const reply = await accountAction(
      {
        conversation: held.id,
        shown: COMPANY,
        read: async () => ({
          action: "decline",
          id: "op_1",
          revision: "r1",
        }),
      },
      makeCaller(visitor),
    );

    expect(reply.status).toBe(503);
    expect(reply.headers?.["Cache-Control"]).toBe("no-store");
    expect(reply.body).toMatchObject({
      code: "conversation_not_saved",
    });
  });

  it("returns 507 conversation_too_large when releaseRun fails with RunNotSaved (too_large)", async () => {
    const store = copyingBackend();
    configureBackend(store);
    const visitor = "visitor_too_large";
    const held = await createRun(visitor, COMPANY);
    held.run.connections[0]!.operations = { op_1: proposal("op_1") };
    await releaseRun(visitor, held);

    // Grow the stored run so the next releaseRun exceeds RUN_LIMITS.bytes.
    const stored = (await store.get(visitor, `run:${held.id}`))!;
    const run = stored.value as {
      transcript?: Array<{ role: "assistant"; content: string }>;
    };
    run.transcript = [
      { role: "assistant", content: "x".repeat(RUN_LIMITS.bytes) },
    ];
    await store.put(visitor, `run:${held.id}`, run, stored.version);

    const reply = await accountAction(
      {
        conversation: held.id,
        shown: COMPANY,
        read: async () => ({
          action: "decline",
          id: "op_1",
          revision: "r1",
        }),
      },
      makeCaller(visitor),
    );

    expect(reply.status).toBe(507);
    expect(reply.body).toMatchObject({
      code: "conversation_too_large",
    });
  });

  it("does not return success for remove when releaseRun fails with RunNotSaved", async () => {
    const store = copyingBackend();
    configureBackend(store);
    const visitor = "visitor_remove_fail";
    const held = await createRun(visitor, COMPANY);
    await releaseRun(visitor, held);

    const realPut = store.put;
    let puts = 0;
    store.put = async (v, key, value, expected, expires) => {
      puts += 1;
      if (puts === 2) throw new Error("storage unavailable");
      return realPut(v, key, value, expected, expires);
    };

    const reply = await accountAction(
      {
        conversation: held.id,
        shown: COMPANY,
        read: async () => ({ action: "remove", company: COMPANY }),
      },
      makeCaller(visitor),
    );

    expect(reply.status).toBe(503);
    expect(reply.body).toMatchObject({
      code: "conversation_not_saved",
    });
  });

  it("surfaces RunNotSaved from letIn when releaseRun fails on early refusal", async () => {
    const store = copyingBackend();
    configureBackend(store);
    const visitor = "visitor_letin_fail";
    const held = await createRun(visitor, COMPANY);
    await releaseRun(visitor, held);

    const realPut = store.put;
    let puts = 0;
    store.put = async (v, key, value, expected, expires) => {
      puts += 1;
      if (puts === 2) throw new Error("storage unavailable");
      return realPut(v, key, value, expected, expires);
    };

    const reply = await accountAction(
      {
        conversation: held.id,
        shown: COMPANY,
        read: async () => {
          throw new Error("bad json");
        },
      },
      makeCaller(visitor),
    );

    expect(reply.status).toBe(503);
    expect(reply.body).toMatchObject({
      code: "conversation_not_saved",
    });
  });
});
