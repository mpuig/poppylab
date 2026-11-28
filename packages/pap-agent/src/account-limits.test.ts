import { afterEach, describe, expect, it } from "vitest";
import { overAccountBudget } from "./account-limits";
import { configureBackend, memoryBackend } from "./runs";

afterEach(() => {
  configureBackend(memoryBackend());
});

describe("overAccountBudget", () => {
  it("skips the per-account bucket for claimed accounts when no IP is known", async () => {
    for (let i = 0; i < 25; i++)
      expect(
        await overAccountBudget("signIn", {
          ip: null,
          account: "acct_target",
          claimed: true,
        }),
      ).toBeUndefined();

    for (let i = 0; i < 35; i++)
      expect(
        await overAccountBudget("refresh", {
          ip: null,
          account: "acct_target",
          claimed: true,
        }),
      ).toBeUndefined();
  });

  it("isolates claimed account attempts per source IP when an IP is known", async () => {
    for (let i = 0; i < 20; i++)
      expect(
        await overAccountBudget("signIn", {
          ip: "192.0.2.1",
          account: "acct_target",
          claimed: true,
        }),
      ).toBeUndefined();

    expect(
      (
        await overAccountBudget("signIn", {
          ip: "192.0.2.1",
          account: "acct_target",
          claimed: true,
        })
      )?.status,
    ).toBe(429);

    // A different IP claiming the same account is not blocked.
    expect(
      await overAccountBudget("signIn", {
        ip: "192.0.2.2",
        account: "acct_target",
        claimed: true,
      }),
    ).toBeUndefined();
  });

  it("normalizes IPv6 claimed account buckets by /64", async () => {
    for (let i = 0; i < 20; i++)
      expect(
        await overAccountBudget("signIn", {
          ip: `2001:db8:1:2::${(i + 1).toString(16)}`,
          account: "acct_v6",
          claimed: true,
        }),
      ).toBeUndefined();

    expect(
      (
        await overAccountBudget("signIn", {
          ip: "2001:db8:1:2:ffff::1",
          account: "acct_v6",
          claimed: true,
        })
      )?.status,
    ).toBe(429);

    expect(
      await overAccountBudget("signIn", {
        ip: "2001:db8:1:3::1",
        account: "acct_v6",
        claimed: true,
      }),
    ).toBeUndefined();
  });

  it("still counts verified (non-claimed) accounts even without a source IP", async () => {
    for (let i = 0; i < 20; i++)
      expect(
        await overAccountBudget("signIn", {
          ip: null,
          account: "acct_verified",
          claimed: false,
        }),
      ).toBeUndefined();

    expect(
      (
        await overAccountBudget("signIn", {
          ip: null,
          account: "acct_verified",
          claimed: false,
        })
      )?.status,
    ).toBe(429);

    for (let i = 0; i < 30; i++)
      expect(
        await overAccountBudget("manage", {
          ip: null,
          account: "acct_verified_manage",
        }),
      ).toBeUndefined();

    expect(
      (
        await overAccountBudget("manage", {
          ip: null,
          account: "acct_verified_manage",
        })
      )?.status,
    ).toBe(429);
  });

  it("budgets redeem per authenticated channel user without sharing a per-IP bucket", async () => {
    for (let i = 0; i < 10; i++)
      expect(
        await overAccountBudget("redeem", {
          ip: "198.51.100.5",
          account: "telegram\nuser-a",
        }),
      ).toBeUndefined();

    expect(
      (
        await overAccountBudget("redeem", {
          ip: "198.51.100.5",
          account: "telegram\nuser-a",
        })
      )?.status,
    ).toBe(429);

    // Another user from the same channel server IP still has their own budget.
    for (let i = 0; i < 10; i++)
      expect(
        await overAccountBudget("redeem", {
          ip: "198.51.100.5",
          account: "telegram\nuser-b",
        }),
      ).toBeUndefined();
  });
});
