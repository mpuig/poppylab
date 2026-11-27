/**
 * A deployment's demo password on the consent page: wrong ones are limited
 * where they come from, so nobody can lock everyone else out, and a
 * `passwordHash` that can't be checked stops the Company from starting.
 */
import { createHash, scryptSync } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { client, origin, redirect, setup } from "./test-company.ts";

const salt = "a".repeat(32);
const passwordHash = `${salt}:${scryptSync("right", salt, 64).toString("hex")}`;

afterEach(() => vi.unstubAllGlobals());

/** A consent page, and its answer with `password` from `ip`. */
async function lab() {
  const x = await setup({ passwordHash });
  const open = async () => {
    const page = await x.app.request(
      `/oauth/authorize?${new URLSearchParams({
        client_id: client,
        redirect_uri: redirect,
        response_type: "code",
        scope: "things:read",
        state: "s".repeat(32),
        code_challenge: createHash("sha256")
          .update("v".repeat(64))
          .digest("base64url"),
        code_challenge_method: "S256",
      })}`,
    );
    return page.headers.getSetCookie()[0]!.split(";")[0]!;
  };
  const answer = async (cookie: string, password: string, ip: string) =>
    (
      await x.form(
        "/oauth/authorize",
        {
          nonce: cookie.split("=")[1]!,
          decision: "approve",
          account: "elena",
          password,
        },
        { cookie, origin, "cf-connecting-ip": ip },
      )
    ).status;
  return { open, answer };
}

it("limits wrong passwords per source, so others can still approve", async () => {
  vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
  const x = await lab();
  const mine = await x.open();
  for (let i = 0; i < 10; i++)
    expect(await x.answer(mine, "wrong", "192.0.2.1")).toBe(401);
  expect(await x.answer(mine, "right", "192.0.2.1")).toBe(429);
  // Another visitor's page still takes their password.
  const theirs = await x.open();
  expect(await x.answer(theirs, "wrong", "192.0.2.2")).toBe(401);
  expect(await x.answer(theirs, "right", "192.0.2.2")).toBe(302);
});

it("counts an IPv6 source by its /64, and an IPv4 one by its address", async () => {
  vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
  const x = await lab();
  const mine = await x.open();
  // Ten addresses in one /64, written as Cloudflare or anyone might.
  for (let i = 0; i < 9; i++)
    expect(await x.answer(mine, "wrong", `2001:db8:1:2::${i + 1}`)).toBe(401);
  expect(await x.answer(mine, "wrong", "2001:DB8:1:2:0:0:abcd:1")).toBe(401);
  expect(await x.answer(mine, "right", "2001:db8:1:2:ffff::9")).toBe(429);
  // The next /64 is someone else.
  const theirs = await x.open();
  expect(await x.answer(theirs, "right", "2001:db8:1:3::1")).toBe(302);
  // IPv4 addresses stay one each, mapped into IPv6 or not.
  const four = await x.open();
  for (let i = 0; i < 10; i++)
    expect(await x.answer(four, "wrong", "198.51.100.7")).toBe(401);
  expect(await x.answer(four, "right", "::ffff:198.51.100.7")).toBe(429);
  expect(await x.answer(four, "right", "198.51.100.8")).toBe(302);
});

it("limits wrong passwords per consent page where no address is known", async () => {
  const x = await lab();
  const mine = await x.open();
  for (let i = 0; i < 10; i++)
    expect(await x.answer(mine, "wrong", `192.0.2.${i}`)).toBe(401);
  expect(await x.answer(mine, "right", "192.0.2.99")).toBe(429);
  expect(await x.answer(await x.open(), "right", "192.0.2.1")).toBe(302);
});

it("won't start with a passwordHash it can't check", async () => {
  for (const bad of [
    "",
    "no-colon",
    `${salt}:abcd`,
    `${salt}:${"z".repeat(128)}`,
  ])
    await expect(setup({ passwordHash: bad }), bad).rejects.toThrow(
      "passwordHash",
    );
});
