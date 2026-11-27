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
 * The protocol state's collections, each kept in a row of its own
 * (`state:sessions` and so on): together, filled to every cap, they come to
 * several times what one value may hold.
 */
const ROWS = [
  "sessions",
  "tokens",
  "grants",
  "replays",
  "consents",
  "codes",
  "pushed",
  "devices",
  "links",
  "joins",
  "browsers",
] as const;
const ROW = "state:";
/**
 * The most one value may hold: Cloudflare stores at most 2 MB in one. It is
 * measured as UTF-8 JSON, which is at least what Cloudflare stores for the
 * same value.
 */
export const MAX_VALUE_BYTES = 2_000_000;
export const valueBytes = (value: unknown) =>
  Buffer.byteLength(JSON.stringify(value) ?? "");

/**
 * Persists the protocol state under `state`, each of its collections under a
 * key of its own, and each tenant under its own key, so a request rewrites
 * only the tenant it touched (Durable Object values are bounded, and
 * visitors are many). A save that has a value over the bound writes nothing
 * and fails, as one storage refused would.
 */
export async function splitStore(kv: KeyValue): Promise<Store> {
  const core = (await kv.get<GatewayState>("state")) ?? emptyState();
  // A state saved before the collections had rows of their own has them in
  // `state`; a row, once written, is newer.
  const value: GatewayState = { ...core, tenants: {} };
  for (const [key, rows] of await kv.list<unknown>({ prefix: ROW }))
    (value as Record<string, unknown>)[key.slice(ROW.length)] = rows;
  for (const [key, tenant] of await kv.list<Tenant>({ prefix: PREFIX }))
    value.tenants[key.slice(PREFIX.length)] = tenant;
  return {
    value,
    async save(changes: Changes) {
      const { tenants, business, ...rest } = value;
      void business;
      const state: Record<string, unknown> = { ...rest };
      const entries: Record<string, unknown> = {};
      for (const name of ROWS)
        if (state[name] !== undefined) {
          entries[ROW + name] = state[name];
          delete state[name];
        }
      entries.state = state;
      for (const key of changes.tenants)
        if (tenants[key]) entries[PREFIX + key] = tenants[key];
      for (const [key, entry] of Object.entries(entries)) {
        const bytes = valueBytes(entry);
        if (bytes > MAX_VALUE_BYTES) {
          console.error("state_value_too_large", key, bytes);
          throw new Error(`${key} is ${bytes} bytes, over ${MAX_VALUE_BYTES}`);
        }
      }
      await kv.put(entries);
      // A tenant dropped and started again under its key is live, and the
      // request that started it writes it, in this save or in one that
      // overlaps it. So only a key no tenant holds now, after the write, is
      // deleted.
      const gone = changes.removed.filter((k) => !tenants[k]);
      if (gone.length) await kv.delete(gone.map((k) => PREFIX + k));
    },
  };
}
