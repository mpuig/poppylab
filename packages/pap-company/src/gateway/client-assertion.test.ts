/**
 * Which key verifies a client assertion (§4.1): the one its `kid` names.
 * Neither §4.1 nor RFC 7523 requires a `kid`, so an assertion without one
 * is verified when the client publishes exactly one key, and never with the
 * first of several.
 */
import { expect, it } from "vitest";
import { assertion, createIdentity } from "@poppy-lab/pap-client/core";
import { client, origin, redirect, setup } from "./test-company.ts";

const request = {
  response_type: "code",
  redirect_uri: redirect,
  scope: "things:read",
  state: "s".repeat(32),
  code_challenge: "c".repeat(43),
  code_challenge_method: "S256",
};

/**
 * A Personal Agent that publishes `count` keys and signs with the first.
 * `answers` sends an assertion with that `kid` header (or none) to the three
 * endpoints that take one, and says what each answered.
 */
async function agent(count: number) {
  const keys = await Promise.all(
    Array.from({ length: count }, () => createIdentity()),
  );
  const x = await setup({
    fetchJson: async (url) =>
      url === client
        ? {
            client_id: client,
            client_name: "Agent",
            jwks_uri: "https://agent.test/jwks.json",
            redirect_uris: [redirect],
          }
        : { keys: keys.map((k) => k.publicKey) },
  });
  const { kid: own, ...signer } = keys[0]!.privateKey;
  const answers = async (kid: string | undefined) => {
    const credentials = async () => ({
      client_id: client,
      client_assertion_type:
        "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: await assertion(
        kid === undefined ? signer : { ...signer, kid },
        client,
        client,
        origin,
      ),
    });
    const par = await x.form("/oauth/par", {
      ...request,
      ...(await credentials()),
    });
    // As the official validator does: an accepted assertion with a refresh
    // token that doesn't exist is invalid_grant, a refused one invalid_client.
    const token = await x.form("/oauth/token", {
      grant_type: "refresh_token",
      refresh_token: "unknown-refresh-token",
      ...(await credentials()),
    });
    const revoke = await x.form("/oauth/revoke", {
      token: "unknown-refresh-token",
      ...(await credentials()),
    });
    return {
      par: par.status,
      token: ((await token.json()) as { error?: string }).error,
      revoke: revoke.status,
    };
  };
  return { answers, kid: own };
}
const accepted = { par: 201, token: "invalid_grant", revoke: 200 };
const refused = { par: 401, token: "invalid_client", revoke: 401 };

it("verifies an assertion without a kid when the client publishes one key", async () => {
  const x = await agent(1);
  expect(await x.answers(undefined)).toEqual(accepted);
  expect(await x.answers(x.kid)).toEqual(accepted);
});

it("refuses an assertion that names a key the client doesn't publish", async () => {
  const x = await agent(1);
  expect(await x.answers("another-key")).toEqual(refused);
});

it("never picks one of several keys for an assertion without a kid", async () => {
  const x = await agent(2);
  expect(await x.answers(undefined)).toEqual(refused);
  expect(await x.answers(x.kid)).toEqual(accepted);
});
