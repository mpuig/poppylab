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
