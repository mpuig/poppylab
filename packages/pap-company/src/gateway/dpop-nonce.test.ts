/**
 * DPoP nonces (RFC 9449 §8) challenge a proof; they don't make one required
 * where it's optional (a pushed request, revocation), and the token endpoint
 * still needs one.
 */
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { createIdentity, proof } from "@poppy-lab/pap-client/core";
import { client, origin, redirect, setup } from "./test-company.ts";
import { NonceChallenge, type DpopNonces } from "./types.ts";

/** One fixed nonce per scope and key is enough here. */
const dpopNonces: DpopNonces = {
  check(scope, nonce, binding) {
    const expected = `${scope}.${binding}`;
    if (nonce !== expected) throw new NonceChallenge(expected);
  },
};
const verifier = "v".repeat(64);
const request = {
  response_type: "code",
  redirect_uri: redirect,
  scope: "things:read",
  state: "s".repeat(32),
  code_challenge: createHash("sha256").update(verifier).digest("base64url"),
  code_challenge_method: "S256",
};
const error = async (r: Response) =>
  ((await r.json()) as { error?: string }).error;

it("takes a pushed request without a DPoP proof, and still needs one for the token", async () => {
  const x = await setup({ dpopNonces });
  const par = await x.form("/oauth/par", {
    ...request,
    ...(await x.credentials()),
  });
  expect(par.status).toBe(201);
  const { request_uri } = (await par.json()) as { request_uri: string };
  const page = await x.app.request(
    `/oauth/authorize?${new URLSearchParams({ client_id: client, request_uri })}`,
  );
  expect(page.status).toBe(200);
  const cookie = page.headers.getSetCookie()[0]!.split(";")[0]!;
  const consent = await x.form(
    "/oauth/authorize",
    { nonce: cookie.split("=")[1]!, decision: "approve", account: "elena" },
    { cookie, origin },
  );
  const code = new URL(consent.headers.get("location")!).searchParams.get(
    "code",
  )!;
  const dpop = await createIdentity();
  const token = async (nonce?: string, withProof = true) =>
    x.form(
      "/oauth/token",
      {
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        redirect_uri: redirect,
        ...(await x.credentials()),
      },
      withProof
        ? {
            DPoP: await proof(
              dpop.privateKey,
              `${origin}/oauth/token`,
              "POST",
              undefined,
              nonce,
            ),
          }
        : {},
    );
  const bare = await token(undefined, false);
  expect(bare.status).toBe(400);
  expect(await error(bare)).toBe("invalid_dpop_proof");
  const challenge = await token();
  expect(challenge.status).toBe(400);
  expect(await error(challenge)).toBe("use_dpop_nonce");
  const issued = await token(challenge.headers.get("dpop-nonce")!);
  expect(issued.status).toBe(200);
  expect(await issued.json()).toMatchObject({ token_type: "DPoP" });
});

it("challenges a pushed request's DPoP proof before its assertion is used", async () => {
  const x = await setup({ dpopNonces });
  const dpop = await createIdentity();
  const body = { ...request, ...(await x.credentials()) };
  const push = async (nonce?: string) =>
    x.form("/oauth/par", body, {
      DPoP: await proof(
        dpop.privateKey,
        `${origin}/oauth/par`,
        "POST",
        undefined,
        nonce,
      ),
    });
  const challenge = await push();
  expect(challenge.status).toBe(400);
  expect(await error(challenge)).toBe("use_dpop_nonce");
  // The same client assertion still verifies: the challenge used nothing.
  expect((await push(challenge.headers.get("dpop-nonce")!)).status).toBe(201);
});

it("revokes without a DPoP proof", async () => {
  const x = await setup({ dpopNonces });
  const revoked = await x.form("/oauth/revoke", {
    token: "unknown-refresh-token",
    ...(await x.credentials()),
  });
  expect(revoked.status).toBe(200);
});

it("challenges a revocation's DPoP proof as the token endpoint does, so the same request can be retried", async () => {
  const x = await setup({ dpopNonces });
  const dpop = await createIdentity();
  const body = {
    token: "unknown-refresh-token",
    ...(await x.credentials()),
  };
  const revoke = async (nonce?: string) =>
    x.form("/oauth/revoke", body, {
      DPoP: await proof(
        dpop.privateKey,
        `${origin}/oauth/revoke`,
        "POST",
        undefined,
        nonce,
      ),
    });
  const challenge = await revoke();
  expect(challenge.status).toBe(400);
  expect(await error(challenge)).toBe("use_dpop_nonce");
  // The same client assertion still verifies: the challenge used nothing.
  expect((await revoke(challenge.headers.get("dpop-nonce")!)).status).toBe(200);
  // Anything else is refused as before: that assertion is used now.
  const replayed = await x.form("/oauth/revoke", body);
  expect(replayed.status).toBe(401);
  expect(await error(replayed)).toBe("invalid_client");
});
