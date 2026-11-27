import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { overBudget } from "./limits";
import { configureBackend, memoryBackend } from "./runs";

beforeEach(() => {
  vi.stubEnv("POPPY_PUBLIC", "true");
  vi.stubEnv("AGENT_PUBLIC_ORIGIN", "https://agent.example");
});
afterEach(() => {
  vi.unstubAllEnvs();
  configureBackend(memoryBackend());
});

/** Discovery from `address`, each time as a new visitor, so only the IP budget counts. */
const discover = (address: string, i: number) =>
  overBudget(address, `visitor-${address}-${i}`, "discover");

it("counts an IPv6 source by its /64 in the per-address budget", async () => {
  for (let i = 0; i < 80; i++)
    expect(await discover(`2001:db8:1:2::${(i + 1).toString(16)}`, i)).toBe(
      undefined,
    );
  // Another address in the same /64 is the same source.
  expect((await discover("2001:db8:1:2:aaaa::1", 80))?.status).toBe(429);
  // The next /64 is another.
  expect(await discover("2001:db8:1:3::1", 81)).toBe(undefined);
});

it("counts IPv4 addresses one each, mapped into IPv6 or not", async () => {
  for (let i = 0; i < 80; i++)
    expect(await discover("198.51.100.7", i)).toBe(undefined);
  expect((await discover("::ffff:198.51.100.7", 80))?.status).toBe(429);
  expect(await discover("198.51.100.8", 81)).toBe(undefined);
});
