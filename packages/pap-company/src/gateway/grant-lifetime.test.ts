/**
 * A Company's grant lifetime (`grantLifetime`): the grant's end is set at
 * the code exchange from the granted scopes, a refresh after it is
 * `invalid_grant` (RFC 6749 §5.2), and no access token outlives it. Without
 * the hook every grant lasts `GRANT_MS`, as before.
 */
import { afterEach, expect, it, vi } from "vitest";
import { tokenHash } from "@poppy-lab/pap-client/core";
import { setup } from "./test-company.ts";
import { GRANT_MS, TOKEN_MS, type CompanyDefinition } from "./types.ts";

type Issued = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
};

/** Account routes of the test Company, for scopes with and without offline. */
const company = (
  overrides: Partial<CompanyDefinition> = {},
): Partial<CompanyDefinition> => ({
  scopes: ["things:read", "things:write", "offline_access"],
  mount: (app, ctx) =>
    app.get("/api/account/things", (c) =>
      c.json({ grant: ctx.grantFor(c) ?? null }),
    ),
  ...overrides,
});
/** One access token without offline access, the default lifetime with it. */
const offlineOnly = (scopes: string[]) =>
  scopes.includes("offline_access") ? GRANT_MS : TOKEN_MS;

const signIn = async (x: Awaited<ReturnType<typeof setup>>, scope: string) => {
  const issued = await x.signIn(scope);
  if ("refused" in issued) throw new Error("consent refused");
  return issued as unknown as Issued;
};
const refresh = (x: Awaited<ReturnType<typeof setup>>, refreshToken: string) =>
  x.token({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  }) as Promise<unknown> as Promise<Issued>;
const grantOf = (x: Awaited<ReturnType<typeof setup>>, refreshToken: string) =>
  x.store.value.grants[tokenHash(refreshToken)]!;
const tokenOf = (x: Awaited<ReturnType<typeof setup>>, accessToken: string) =>
  x.store.value.tokens[tokenHash(accessToken)]!;

afterEach(() => vi.useRealTimers());

it("lasts GRANT_MS without the hook, and refreshes for all of it", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const x = await setup({}, company());
  const start = Date.now();
  const tokens = await signIn(x, "things:read");
  expect(tokens.expires_in).toBe(TOKEN_MS / 1000);
  expect(tokens.refresh_token).toEqual(expect.any(String));
  const grant = grantOf(x, tokens.refresh_token);
  expect(grant.expires).toBe(start + GRANT_MS);
  vi.setSystemTime(start + GRANT_MS - 2 * TOKEN_MS);
  const later = await refresh(x, tokens.refresh_token);
  expect(later.expires_in).toBe(TOKEN_MS / 1000);
  vi.setSystemTime(start + GRANT_MS + 1);
  await expect(refresh(x, tokens.refresh_token)).rejects.toThrow(
    /invalid_grant/,
  );
});

it("ends a grant with its first access token, and refreshes only up to that end", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const asked: string[][] = [];
  const x = await setup(
    {},
    company({
      grantLifetime: (scopes) => {
        asked.push(scopes);
        return offlineOnly(scopes);
      },
    }),
  );
  const start = Date.now();
  // Sign-in still returns a refresh token (§4.4).
  const tokens = await signIn(x, "things:read things:write");
  expect(asked).toEqual([["things:read", "things:write"]]);
  expect(tokens.refresh_token).toEqual(expect.any(String));
  expect(tokens.expires_in).toBe(TOKEN_MS / 1000);
  const grant = grantOf(x, tokens.refresh_token);
  expect(grant.expires).toBe(start + TOKEN_MS);
  expect(tokenOf(x, tokens.access_token).expires).toBe(grant.expires);
  // A refresh before the end: a token that ends with the grant, not later.
  vi.setSystemTime(start + TOKEN_MS / 2);
  const half = await refresh(x, tokens.refresh_token);
  expect(half.expires_in).toBe(TOKEN_MS / 2000);
  expect(tokenOf(x, half.access_token).expires).toBe(grant.expires);
  expect(
    (await x.call("/api/account/things", { access: half.access_token })).status,
  ).toBe(200);
  // After the end: invalid_grant, and the token stops working too.
  vi.setSystemTime(start + TOKEN_MS + 1);
  await expect(refresh(x, tokens.refresh_token)).rejects.toThrow(
    /invalid_grant/,
  );
  const after = await x.call("/api/account/things", {
    access: half.access_token,
  });
  expect(after.status).toBe(401);
  expect(after.headers.get("www-authenticate")).toContain("invalid_token");
});

it("keeps a grant the hook gives longer refreshable for its whole lifetime", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const x = await setup({}, company({ grantLifetime: offlineOnly }));
  const start = Date.now();
  const tokens = await signIn(x, "things:read offline_access");
  expect(grantOf(x, tokens.refresh_token).expires).toBe(start + GRANT_MS);
  vi.setSystemTime(start + 2 * TOKEN_MS);
  const refreshed = await refresh(x, tokens.refresh_token);
  expect(refreshed.expires_in).toBe(TOKEN_MS / 1000);
  // Near the end, the access token is cut to the grant's.
  vi.setSystemTime(start + GRANT_MS - 60000);
  const last = await refresh(x, tokens.refresh_token);
  expect(last.expires_in).toBe(60);
  expect(tokenOf(x, last.access_token).expires).toBe(start + GRANT_MS);
  vi.setSystemTime(start + GRANT_MS + 1);
  await expect(refresh(x, tokens.refresh_token)).rejects.toThrow(
    /invalid_grant/,
  );
});

it("fails the code exchange when the hook's lifetime isn't a positive number", async () => {
  for (const lifetime of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const x = await setup({}, company({ grantLifetime: () => lifetime }));
    await expect(x.signIn("things:read")).rejects.toThrow(/invalid_grant/);
    expect(x.store.value.grants).toEqual({});
  }
});
