/**
 * Revocation (§4.6, RFC 7009): a refresh token ends with its access tokens,
 * and an access token sent on its own ends too, for its own client only.
 */
import { expect, it } from "vitest";
import { assertion, createIdentity } from "@poppy-lab/pap-client/core";
import { origin, setup } from "./test-company.ts";

const ROUTE = "/api/account/things/1";

it("revokes an access token sent on its own, and only for the client it was issued to", async () => {
  const x = await setup();
  const tokens = await x.signIn();
  if ("refused" in tokens) throw new Error("refused");
  const works = async () =>
    (await x.call(ROUTE, { access: tokens.access_token })).status !== 401;
  expect(await works()).toBe(true);

  // Another Personal Agent can't revoke it: 200, and nothing ends.
  const other = "https://other.test/client.json";
  const keys = await createIdentity();
  x.metadata.other = (url) =>
    url === other
      ? {
          client_id: other,
          jwks_uri: "https://other.test/jwks.json",
          redirect_uris: ["https://other.test/callback"],
        }
      : url === "https://other.test/jwks.json"
        ? { keys: [keys.publicKey] }
        : undefined;
  const stranger = await x.form("/oauth/revoke", {
    token: tokens.access_token,
    client_id: other,
    client_assertion_type:
      "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: await assertion(keys.privateKey, other, other, origin),
  });
  expect(stranger.status).toBe(200);
  expect(await works()).toBe(true);

  const revoked = await x.form("/oauth/revoke", {
    token: tokens.access_token,
    token_type_hint: "access_token",
    ...(await x.credentials()),
  });
  expect(revoked.status).toBe(200);
  expect(await works()).toBe(false);
  // The grant goes on: its refresh token still gets a new access token.
  const refreshed = await x.token({
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token,
  });
  expect(
    (await x.call(ROUTE, { access: refreshed.access_token })).status,
  ).not.toBe(401);
});
