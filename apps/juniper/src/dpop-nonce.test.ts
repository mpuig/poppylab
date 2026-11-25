import { it, expect, vi } from "vitest";
import { createIdentity, assertion, proof } from "@poppy-lab/pap-client";
import { juniperApp } from "./test-app.js";
import { dpopNonces, nonceAuthority, NonceRequired } from "./dpop-nonce.js";
const fetchJson = vi.fn();
it("rejects missing, wrong, expired, foreign-key and foreign-server nonces", () => {
  const authority = nonceAuthority(),
    check = authority("token");
  let nonce = "";
  try {
    check(undefined, "key");
  } catch (e) {
    nonce = (e as InstanceType<typeof NonceRequired>).nonce;
  }
  expect(() => check(nonce, "key")).not.toThrow();
  for (const fn of [
    () => check("wrong", "key"),
    () => check(nonce, "other"),
    () => authority("api")(nonce, "key"),
    () => nonceAuthority()("token")(nonce, "key"),
  ])
    expect(fn).toThrow(NonceRequired);
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60001);
  try {
    expect(() => check(nonce, "key")).toThrow(NonceRequired);
  } finally {
    vi.restoreAllMocks();
  }
});
it("challenges at the token endpoint before the client assertion or grant is consumed", async () => {
  let app!: ReturnType<typeof juniperApp>;
  const origin = "http://juniper.localhost:4100",
    client = "http://localhost:3000/agent/client.json";
  const keys = await createIdentity(),
    dpop = await createIdentity();
  fetchJson.mockImplementation(async (url) =>
    url.endsWith("client.json")
      ? { client_id: client, jwks_uri: "http://localhost:3000/agent/jwks.json" }
      : { keys: [keys.publicKey] },
  );
  try {
    app = juniperApp({ fetchJson, dpopNonces: dpopNonces() });
    const payload = {
      grant_type: "refresh_token",
      refresh_token: "unknown-refresh-token",
      client_id: client,
      client_assertion_type:
        "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: await assertion(
        keys.privateKey,
        client,
        client,
        origin,
      ),
    };
    const token = async (nonce?: string) =>
      app.inject({
        method: "POST",
        url: "/oauth/token",
        payload,
        headers: {
          DPoP: await proof(
            dpop.privateKey,
            origin + "/oauth/token",
            "POST",
            undefined,
            nonce,
          ),
        },
      });
    const challenge = await token();
    expect(challenge.statusCode).toBe(400);
    expect(challenge.json().error).toBe("use_dpop_nonce");
    // The same client assertion still verifies: the challenge consumed nothing.
    const retried = await token(String(challenge.headers["dpop-nonce"]));
    expect(retried.json().error).toBe("invalid_grant");
  } finally {
    await app.close();
  }
});
