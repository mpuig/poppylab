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

it("does not spend global quota on requests refused by the per-IP limit", async () => {
  const chat = (address: string, i: number) =>
    overBudget(address, `visitor-${address}-${i}`, "chat");

  // One IP exhausts its own 60/min chat budget, then floods past the 600/min global cap.
  for (let i = 0; i < 60; i++)
    expect(await chat("198.51.100.1", i)).toBe(undefined);
  for (let i = 60; i < 760; i++)
    expect((await chat("198.51.100.1", i))?.status).toBe(429);

  // Nine other IPs can still use all remaining 540/600 of the global chat budget.
  for (let n = 2; n <= 10; n++)
    for (let i = 0; i < 60; i++)
      expect(await chat(`198.51.100.${n}`, i)).toBe(undefined);

  // Only once 600 allowed requests have been admitted does the global cap trigger.
  expect((await chat("198.51.100.11", 0))?.status).toBe(429);
});

it("does not spend global quota on requests refused by the per-visitor limit", async () => {
  for (let i = 0; i < 8; i++)
    expect(await overBudget(null, "noisy-visitor", "chat")).toBe(undefined);
  for (let i = 0; i < 650; i++)
    expect((await overBudget(null, "noisy-visitor", "chat"))?.status).toBe(429);

  expect(await overBudget(null, "other-visitor", "chat")).toBe(undefined);
});
