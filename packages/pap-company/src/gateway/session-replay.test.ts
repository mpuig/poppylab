/**
 * Replayed Session JWTs (§5.3): a request without a DPoP proof has only its
 * Session JWT to stop a copy, so each is taken once. A DPoP-bound request's
 * proof is taken once already, and its Session JWT may come again with a
 * new proof after a nonce challenge (RFC 9449 §8).
 */
import { createHash } from "node:crypto";
import { calculateJwkThumbprint } from "jose";
import { expect, it } from "vitest";
import {
  createIdentity,
  createSessionKey,
  newSessionId,
  proof,
  ReplayCache,
  signSessionHeader,
} from "@poppy-lab/pap-client/core";
import { memoryStore } from "../memory.ts";
import { client, origin, setup } from "./test-company.ts";
import { NonceChallenge, type DpopNonces } from "./types.ts";

type Lab = Awaited<ReturnType<typeof setup>>;
const session = (x: Lab, method: string, path: string, accessToken?: string) =>
  signSessionHeader({
    key: x.sessionKey,
    clientId: client,
    audience: origin,
    sessionId: x.sessionId,
    userId: "usr_test",
    method,
    url: origin + path,
    ...(accessToken ? { accessToken } : {}),
  });

it("takes a signed-out request's Session JWT once, whatever the body", async () => {
  const x = await setup();
  for (const [path, bodies] of [
    [
      "/poppy/feedback",
      [
        { task: "Pay with a gift card", description: "No field for one." },
        { task: "Something else", description: "Another report." },
      ],
    ],
    [
      "/poppy/conversations",
      [
        { id: "req_1", message: { author: { type: "agent" }, text: "Hi." } },
        { id: "req_2", message: { author: { type: "agent" }, text: "Hi." } },
      ],
    ],
  ] as const) {
    const header = await session(x, "POST", path);
    const send = (body: object) =>
      x.app.request(path, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Poppy-Version": "1.0",
          "Poppy-Session": header,
        },
        body: JSON.stringify(body),
      });
    expect((await send(bodies[0])).status, path).toBeLessThan(300);
    const again = await send(bodies[1]);
    expect(again.status, path).toBe(400);
    expect(await again.json()).toEqual({ error: "invalid_session" });
  }
});

it("refuses a client that floods the replay cache, and no other client", async () => {
  // Another client signs many signed-out requests in a minute, more than
  // the whole cache holds. Only its share of them is kept.
  const flood = "https://flood.test/client.json";
  const keys = await createIdentity();
  const cache = new ReplayCache();
  const until = Math.floor(Date.now() / 1000) + 60;
  for (let i = 0; i < 10000; i++)
    try {
      cache.accept(`session:${flood}:${i}`, until, flood);
    } catch {
      // Past its share.
    }
  const store = memoryStore();
  store.value.replays = cache.snapshot();
  const x = await setup({ store });
  x.metadata.other = (url) =>
    url === flood
      ? {
          client_id: flood,
          jwks_uri: "https://flood.test/jwks.json",
          redirect_uris: [],
        }
      : url === "https://flood.test/jwks.json"
        ? { keys: [keys.publicKey] }
        : undefined;
  const path = "/poppy/conversations";
  const send = (header: string, id: string) =>
    x.app.request(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Poppy-Version": "1.0",
        "Poppy-Session": header,
      },
      body: JSON.stringify({
        id,
        message: { author: { type: "agent" }, text: "Hi." },
      }),
    });
  const flooded = await signSessionHeader({
    key: await createSessionKey(keys.privateKey, flood),
    clientId: flood,
    audience: origin,
    sessionId: newSessionId(),
    userId: "usr_flood",
    method: "POST",
    url: origin + path,
  });
  expect((await send(flooded, "req_flood")).status).toBe(400);
  // This client still gets through, and its copy is still refused.
  const header = await session(x, "POST", path);
  expect((await send(header, "req_1")).status).toBeLessThan(300);
  const again = await send(header, "req_2");
  expect(again.status).toBe(400);
  expect(await again.json()).toEqual({ error: "invalid_session" });
});

it("takes a DPoP-bound request's Session JWT again with a fresh proof after a nonce challenge", async () => {
  const dpopNonces: DpopNonces = {
    check(scope, nonce, binding) {
      const expected = `${scope}.${binding}`;
      if (nonce !== expected) throw new NonceChallenge(expected);
    },
  };
  const x = await setup({ dpopNonces });
  const path = "/api/account/things/1";
  const tokens = await signInWithNonce(
    x,
    `token.${await calculateJwkThumbprint(x.dpop.publicKey)}`,
  );
  const header = await session(x, "GET", path, tokens.access_token);
  const send = async (nonce?: string) =>
    x.app.request(path, {
      headers: {
        "Poppy-Version": "1.0",
        "Poppy-Session": header,
        Authorization: `DPoP ${tokens.access_token}`,
        DPoP: await proof(
          x.dpop.privateKey,
          origin + path,
          "GET",
          tokens.access_token,
          nonce,
        ),
      },
    });
  const first = await send();
  expect(first.status).toBe(401);
  expect(((await first.json()) as { error?: string }).error).toBe(
    "use_dpop_nonce",
  );
  const retried = await send(first.headers.get("dpop-nonce")!);
  // Past every check: the test Company has no such route.
  expect(retried.status).toBe(404);
});

/** Direct Sign-In whose code exchange sends the token endpoint's nonce. */
async function signInWithNonce(x: Lab, nonce: string) {
  const verifier = "v".repeat(64);
  const page = await x.app.request(
    `/oauth/authorize?${new URLSearchParams({
      client_id: client,
      redirect_uri: "https://agent.test/callback",
      response_type: "code",
      scope: "things:read",
      state: "s".repeat(32),
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    })}`,
  );
  const cookie = page.headers.getSetCookie()[0]!.split(";")[0]!;
  const consent = await x.form(
    "/oauth/authorize",
    { nonce: cookie.split("=")[1]!, decision: "approve", account: "elena" },
    { cookie, origin },
  );
  const code = new URL(consent.headers.get("location")!).searchParams.get(
    "code",
  )!;
  const r = await x.form(
    "/oauth/token",
    {
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: "https://agent.test/callback",
      ...(await x.credentials()),
    },
    {
      DPoP: await proof(
        x.dpop.privateKey,
        `${origin}/oauth/token`,
        "POST",
        undefined,
        nonce,
      ),
    },
  );
  expect(r.status).toBe(200);
  return (await r.json()) as { access_token: string };
}
