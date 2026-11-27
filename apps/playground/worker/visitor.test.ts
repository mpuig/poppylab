/**
 * How long the playground's Durable Objects keep what they hold: an
 * account a year after its last use, a passkey ceremony or a link code
 * only until it runs out, and an object left empty not at all.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(
      protected ctx: unknown,
      protected env: unknown,
    ) {}
  },
}));
const { PoppyAccount, PoppyVisitor } = await import("./visitor");

/** Durable Object storage as the objects use it, with its one alarm. */
function storage() {
  const data = new Map<string, unknown>();
  let alarm: number | null = null;
  return {
    data,
    alarm: () => alarm,
    async get<T>(key: string) {
      return data.get(key) as T | undefined;
    },
    async put(key: string, value: unknown) {
      data.set(key, value);
    },
    async delete(key: string) {
      return data.delete(key);
    },
    async list<T>({ prefix = "", limit }: { prefix?: string; limit?: number }) {
      const found = [...data].filter(([k]) => k.startsWith(prefix));
      return new Map(found.slice(0, limit ?? found.length)) as Map<string, T>;
    },
    async deleteAll() {
      data.clear();
    },
    async getAlarm() {
      return alarm;
    },
    async setAlarm(time: number) {
      alarm = time;
    },
    async deleteAlarm() {
      alarm = null;
    },
  };
}
const open = <T>(Kind: new (ctx: never, env: never) => T) => {
  const kept = storage();
  return { kept, object: new Kind({ storage: kept } as never, {} as never) };
};

const minute = 60000,
  day = 86400000;
let now: number;
beforeEach(() => {
  now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now);
});

describe("an account's object", () => {
  it("keeps the account a year after it was last written", async () => {
    const { kept, object } = open(PoppyAccount);
    await object.putEntry("account", { sealed: true }, null);
    expect(kept.alarm()).toBe(now + 365 * day);
  });

  it("keeps a ceremony only until it runs out, and nothing once it is taken", async () => {
    const { kept, object } = open(PoppyAccount);
    await object.putEntry("ceremony", { sealed: true }, null, now + 5 * minute);
    expect(kept.alarm()).toBe(now + 5 * minute);
    // Taken: marked once, then removed.
    await object.putEntry("ceremony", { sealed: true }, 1, now + 5 * minute);
    await object.removeEntry("ceremony");
    expect(kept.data.size).toBe(0);
    expect(kept.alarm()).toBeNull();
  });

  it("never brings an account's end closer for a short-lived entry", async () => {
    const { kept, object } = open(PoppyAccount);
    await object.putEntry("account", {}, null);
    await object.putEntry("ceremony", {}, null, now + 5 * minute);
    expect(kept.alarm()).toBe(now + 365 * day);
  });

  it("goes with its alarm, whatever it holds", async () => {
    const { kept, object } = open(PoppyAccount);
    await object.putEntry("ceremony", {}, null, now + 5 * minute);
    await object.alarm();
    expect(kept.data.size).toBe(0);
  });
});

describe("a visitor's object", () => {
  it("keeps conversations eight days after the last write", async () => {
    const { kept, object } = open(PoppyVisitor);
    await object.putEntry("run:a", {}, null);
    expect(kept.alarm()).toBe(now + 8 * day);
  });

  it("keeps a budget's count only for its window", async () => {
    const { kept, object } = open(PoppyVisitor);
    await object.count("acct-signin:m", minute);
    expect(kept.alarm()).toBe(now + minute);
  });

  it("keeps the rest when one entry of several is removed", async () => {
    const { kept, object } = open(PoppyVisitor);
    await object.putEntry("run:a", {}, null);
    await object.putEntry("run:b", {}, null);
    await object.removeEntry("run:a");
    expect(kept.alarm()).toBe(now + 8 * day);
  });
});
