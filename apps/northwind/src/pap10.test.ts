import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { assertion, proof } from "@poppy-lab/pap-client/core";
import { client, inject, origin, redirect, setup } from "./test-harness.ts";

it("offers PAR, DPoP tokens, refresh, revocation and Poppy 1.0 only", async () => {
  const x = await setup();
  const metadata = (
    await inject("/.well-known/oauth-authorization-server")
  ).json();
  expect(metadata).toMatchObject({
    issuer: origin,
    pushed_authorization_request_endpoint: `${origin}/oauth/par`,
    token_endpoint: `${origin}/oauth/token`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    dpop_signing_alg_values_supported: ["ES256"],
    scopes_supported: [
      "flights:search",
      "bookings:read",
      "profile:read",
      "preferences:write",
      "bookings:change",
      "poppy:browser-sign-in",
    ],
  });
  const verifier = "p".repeat(64);
  const payload = {
    response_type: "code",
    client_id: client,
    redirect_uri: redirect,
    scope: "flights:search bookings:read profile:read",
    state: "s".repeat(32),
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    client_assertion_type:
      "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: await assertion(
      x.keys.privateKey,
      client,
      client,
      origin,
    ),
  };
  const { lab } = await import("./test-harness.ts");
  const parResponse = await lab.app.request("/oauth/par", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      DPoP: await proof(x.dpop.privateKey, `${origin}/oauth/par`, "POST"),
    },
    body: new URLSearchParams(payload).toString(),
  });
  expect(parResponse.status).toBe(201);
  const par = (await parResponse.json()) as { request_uri: string };
  expect(par.request_uri).toMatch(/^urn:ietf:params:oauth:request_uri:/);
  const unsupported = await x.call(
    "",
    "GET",
    "/api/flights/status?flight_number=NA%20402&date=2027-05-18",
    undefined,
    undefined,
    undefined,
    { "Poppy-Version": "0.4" },
  );
  expect(unsupported.json()).toEqual({ error: "version_unsupported" });
});

it("ends a Session when a second fictional account is used", async () => {
  const x = await setup();
  const elena = await x.sign("elena", false);
  const robin = await x.sign("robin", false);
  const sid = "sid_shared_northwind";
  expect(
    (
      await x.call(
        elena.access_token,
        "GET",
        "/api/account/bookings",
        undefined,
        undefined,
        "usr_northwind",
        {},
        sid,
      )
    ).statusCode,
  ).toBe(200);
  const second = await x.call(
    robin.access_token,
    "GET",
    "/api/account/bookings",
    undefined,
    undefined,
    "usr_northwind",
    {},
    sid,
  );
  expect(second.statusCode).toBe(400);
  expect(second.json()).toEqual({ error: "session_ended" });
});

it("binds refresh tokens to their DPoP key", async () => {
  const x = await setup();
  const elena = await x.sign("elena", false);
  const other = await import("@poppy-lab/pap-client/core").then((module) =>
    module.createIdentity(),
  );
  const refresh = async (privateKey: typeof x.dpop.privateKey) =>
    inject({
      method: "POST",
      url: "/oauth/token",
      headers: {
        DPoP: await proof(privateKey, `${origin}/oauth/token`, "POST"),
      },
      payload: {
        grant_type: "refresh_token",
        refresh_token: elena.refresh_token,
        client_id: client,
        client_assertion_type:
          "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
        client_assertion: await assertion(
          x.keys.privateKey,
          client,
          client,
          origin,
        ),
      },
    });
  expect((await (await refresh(other.privateKey)).json()).error).toBe(
    "invalid_grant",
  );
  expect((await refresh(x.dpop.privateKey)).statusCode).toBe(200);
});
