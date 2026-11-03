import {
  emptyState,
  type Changes,
  type GatewayState,
  type Store,
  type Tenant,
} from "./gateway.ts";

/** The subset of Durable Object storage the split store needs. */
export type KeyValue = {
  get<T>(key: string): Promise<T | undefined>;
  list<T>(options: { prefix: string }): Promise<Map<string, T>>;
  put(entries: Record<string, unknown>): Promise<void>;
  delete(keys: string[]): Promise<number>;
};
const PREFIX = "tenant:";

/**
 * Persists the protocol state under `state` and each tenant under its own
 * key, so a request rewrites only what it touched (Durable Object values are
 * bounded, and visitors are many).
 */
export async function splitStore(kv: KeyValue): Promise<Store> {
  const core = (await kv.get<GatewayState>("state")) ?? emptyState();
  const value: GatewayState = { ...core, tenants: {} };
  for (const [key, tenant] of await kv.list<Tenant>({ prefix: PREFIX }))
    value.tenants[key.slice(PREFIX.length)] = tenant;
  return {
    value,
    async save(changes: Changes) {
      const { tenants, business, ...rest } = value;
      void business;
      const entries: Record<string, unknown> = { state: rest };
      for (const key of changes.tenants)
        if (tenants[key]) entries[PREFIX + key] = tenants[key];
      await kv.put(entries);
      if (changes.removed.length)
        await kv.delete(changes.removed.map((k) => PREFIX + k));
    },
  };
}
