/**
 * Token endpoint resilience: grant cap and grant-lifetime checks run before
 * consuming an authorization code or approved device request, so a refused
 * exchange does not burn the user's approval.
 */
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import {
  assertion,
  createIdentity,
  proof,
  tokenHash,
} from "@poppy-lab/pap-client/core";
import { memoryStore } from "../memory.ts";
import { client, origin, redirect, setup } from "./test-company.ts";
import { DEVICE_GRANT, GRANT_MS, type Grant } from "./types.ts";

const verifier = "v".repeat(64);
const challenge = createHash("sha256").update(verifier).digest("base64url");

/** Creates a store where `client` already holds `count` live grants. */
function withGrants(count: number) {
  const store = memoryStore();
  for (let i = 0; i < count; i++)
    store.value.grants[`g${i}`] = {
      account: "elena",
      id: `g${i}`,
      client,
      scopes: "things:read",
      expires: Date.now() + 86400000,
    } satisfies Grant;
  return store;
}

/** Completes Direct Sign-In consent and returns the issued authorization code. */
async function approveCode(x: Awaited<ReturnType<typeof setup>>) {
  const page = await x.app.request(
    `/oauth/authorize?${new URLSearchParams({
      client_id: client,
      redirect_uri: redirect,
      response_type: "code",
      scope: "things:read",
      state: "s".repeat(32),
      code_challenge: challenge,
      code_challenge_method: "S256",
    })}`,
  );
  expect(page.status).toBe(200);
  const cookie = page.headers
    .getSetCookie()
    .find((c) => c.includes("pap_consent_"))!
    .split(";")[0]!;
  const approved = await x.form(
    "/oauth/authorize",
    { nonce: cookie.split("=")[1]!, decision: "approve", account: "elena" },
    { cookie, origin },
  );
  expect(approved.status).toBe(302);
  return new URL(approved.headers.get("location")!).searchParams.get("code")!;
}

/** Starts Device Sign-In, approves it in a browser, and returns the `device_code`. */
async function approveDevice(x: Awaited<ReturnType<typeof setup>>) {
  const started = await x.form("/oauth/device", {
    scope: "things:read",
    ...(await x.credentials()),
  });
  expect(started.status).toBe(200);
  const { device_code, user_code } = (await started.json()) as {
    device_code: string;
    user_code: string;
  };
  const page = await x.form("/device", { user_code }, { origin });
  expect(page.status).toBe(200);
  const cookie = page.headers
    .getSetCookie()
    .find((c) => c.includes("pap_consent_"))!
    .split(";")[0]!;
  const approved = await x.form(
    "/oauth/authorize",
    { nonce: cookie.split("=")[1]!, decision: "approve", account: "elena" },
    { cookie, origin },
  );
  expect(approved.status).toBe(200);
  return device_code;
}

it("does not consume an authorization code when the grant cap is reached", async () => {
  const store = withGrants(200);
  const x = await setup({ store });
  const code = await approveCode(x);
  const exchange = async () =>
    x.form(
      "/oauth/token",
      {
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        redirect_uri: redirect,
        ...(await x.credentials()),
      },
      {
        DPoP: await proof(x.dpop.privateKey, `${origin}/oauth/token`, "POST"),
      },
    );

  // At the 200-grant share cap: refused with 429, code remains unconsumed.
  const limited = await exchange();
  expect(limited.status).toBe(429);
  expect(store.value.codes).toHaveProperty(tokenHash(code));

  // Once a grant slot opens up, retrying with the same code succeeds.
  delete store.value.grants.g0;
  const ok = await exchange();
  expect(ok.status).toBe(200);
  expect(await ok.json()).toMatchObject({
    access_token: expect.any(String),
    refresh_token: expect.any(String),
  });
  expect(store.value.codes).not.toHaveProperty(tokenHash(code));

  // Consumed once issued: a further replay fails.
  const replay = await exchange();
  expect(replay.status).toBe(400);
  expect(await replay.json()).toEqual({ error: "invalid_grant" });
});

it("does not consume an approved device request when the grant cap is reached", async () => {
  const store = withGrants(200);
  const x = await setup({ store });
  const deviceCode = await approveDevice(x);
  const poll = async () =>
    x.form(
      "/oauth/token",
      {
        grant_type: DEVICE_GRANT,
        device_code: deviceCode,
        ...(await x.credentials()),
      },
      {
        DPoP: await proof(x.dpop.privateKey, `${origin}/oauth/token`, "POST"),
      },
    );

  // At the 200-grant share cap: refused with 429, device approval remains intact.
  const limited = await poll();
  expect(limited.status).toBe(429);
  expect(store.value.devices).toHaveProperty(tokenHash(deviceCode));

  // Once a grant slot opens up, polling the same device_code issues tokens.
  delete store.value.grants.g0;
  const ok = await poll();
  expect(ok.status).toBe(200);
  expect(await ok.json()).toMatchObject({
    access_token: expect.any(String),
    refresh_token: expect.any(String),
  });
  expect(store.value.devices).not.toHaveProperty(tokenHash(deviceCode));

  // Consumed once issued.
  const replay = await poll();
  expect(replay.status).toBe(400);
  expect(await replay.json()).toEqual({ error: "invalid_grant" });
});

it("does not consume an authorization code or device request when grantLifetime is non-positive", async () => {
  let lifetime = 0;
  const x = await setup({}, { grantLifetime: () => lifetime });

  // Direct Sign-In authorization code
  const code = await approveCode(x);
  const exchange = async () =>
    x.form(
      "/oauth/token",
      {
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        redirect_uri: redirect,
        ...(await x.credentials()),
      },
      {
        DPoP: await proof(x.dpop.privateKey, `${origin}/oauth/token`, "POST"),
      },
    );
  const refusedCode = await exchange();
  expect(refusedCode.status).toBe(400);
  expect(await refusedCode.json()).toEqual({ error: "invalid_grant" });
  expect(x.store.value.codes).toHaveProperty(tokenHash(code));

  // Device Sign-In approved request
  const deviceCode = await approveDevice(x);
  const poll = async () =>
    x.form(
      "/oauth/token",
      {
        grant_type: DEVICE_GRANT,
        device_code: deviceCode,
        ...(await x.credentials()),
      },
      {
        DPoP: await proof(x.dpop.privateKey, `${origin}/oauth/token`, "POST"),
      },
    );
  const refusedDevice = await poll();
  expect(refusedDevice.status).toBe(400);
  expect(await refusedDevice.json()).toEqual({ error: "invalid_grant" });
  expect(x.store.value.devices).toHaveProperty(tokenHash(deviceCode));

  // Once lifetime is valid, both approvals can still be exchanged.
  lifetime = GRANT_MS;
  expect((await exchange()).status).toBe(200);
  expect((await poll()).status).toBe(200);
});

it("does not let another client burn a legitimate client's authorization code", async () => {
  const otherId = "https://other.test/client.json";
  const otherKeys = await createIdentity();
  const x = await setup();
  x.metadata.other = (url) =>
    url === otherId
      ? {
          client_id: otherId,
          client_name: "Other",
          jwks_uri: "https://other.test/jwks.json",
          redirect_uris: ["https://other.test/cb"],
        }
      : url === "https://other.test/jwks.json"
        ? { keys: [otherKeys.publicKey] }
        : undefined;

  const code = await approveCode(x);
  const stolen = await x.form(
    "/oauth/token",
    {
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: redirect,
      client_id: otherId,
      client_assertion_type:
        "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: await assertion(
        otherKeys.privateKey,
        otherId,
        otherId,
        origin,
      ),
    },
    {
      DPoP: await proof(x.dpop.privateKey, `${origin}/oauth/token`, "POST"),
    },
  );
  expect(stolen.status).toBe(400);
  expect(await stolen.json()).toEqual({ error: "invalid_grant" });
  expect(x.store.value.codes).toHaveProperty(tokenHash(code));

  // The rightful client can still exchange its code.
  const issued = await x.token({
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    redirect_uri: redirect,
  });
  expect(issued.access_token).toBeTruthy();
});
