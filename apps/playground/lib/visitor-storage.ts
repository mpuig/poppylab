/**
 * Where the playground keeps conversations on Workers: one Durable Object
 * per visitor (and per budget bucket, `worker/visitor.ts`), every value
 * sealed with the POPPY_STATE_KEY secret before it leaves the isolate. The
 * agent's core defines the store (`Backend`); this is the playground's.
 * Agent accounts are kept the same way in objects of their own
 * (`accountStorage`), which outlive a visitor's.
 */
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Backend, Versioned } from "@poppy-lab/pap-agent/runs";
import { importStateKey, sealedBackend } from "@poppy-lab/pap-agent/sealed";

/** The visitor Durable Object's RPC surface (`worker/visitor.ts`). */
type VisitorObject = {
  getEntry(key: string): Promise<Versioned | undefined>;
  putEntry(
    key: string,
    value: unknown,
    expected: number | null,
  ): Promise<boolean>;
  removeEntry(key: string): Promise<void>;
  listEntries(prefix: string): Promise<Array<[string, Versioned]>>;
  count(key: string, windowMs: number): Promise<number>;
};
type Namespace = {
  idFromName(name: string): unknown;
  get(id: unknown): VisitorObject;
};

const env = () => getCloudflareContext().env as Record<string, unknown>;
function durableStorage(binding: string): Backend {
  const stub = (bucket: string) => {
    const ns = env()[binding] as Namespace;
    return ns.get(ns.idFromName(bucket));
  };
  const key = importStateKey(
    typeof env().POPPY_STATE_KEY === "string"
      ? (env().POPPY_STATE_KEY as string)
      : undefined,
  );
  key.catch(() => {});
  return sealedBackend(plainDurableBackend(stub), key);
}
export const visitorStorage = () => durableStorage("POPPY_VISITORS");
export const accountStorage = () => durableStorage("POPPY_ACCOUNTS");
function plainDurableBackend(
  stub: (visitor: string) => VisitorObject,
): Backend {
  return {
    get: (visitor, key) => stub(visitor).getEntry(key),
    put: (visitor, key, value, expected) =>
      stub(visitor).putEntry(key, value, expected),
    remove: (visitor, key) => stub(visitor).removeEntry(key),
    list: (visitor, prefix) => stub(visitor).listEntries(prefix),
    count: (visitor, key, windowMs) => stub(visitor).count(key, windowMs),
  };
}
