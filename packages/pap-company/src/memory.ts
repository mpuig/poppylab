import { emptyState, type Store } from "./gateway.ts";
/** In-memory store for tests. */
export const memoryStore = (): Store & { saves: number } => {
  const store = {
    value: emptyState(),
    saves: 0,
    save() {
      store.saves++;
    },
  };
  return store;
};
/**
 * For tests of a restart: each call returns a store holding what the last
 * save wrote, and nothing a request left only in memory, as a Durable Object
 * that was dropped from memory loads it.
 */
export const restartingStore = () => {
  let saved = emptyState();
  return (): Store => {
    const store = {
      value: structuredClone(saved),
      save() {
        saved = structuredClone(store.value);
      },
    };
    return store;
  };
};
