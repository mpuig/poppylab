import { describe, it, expect } from "vitest";
import {
  createIdentity,
  assertion,
  verifyAssertion,
  proof,
  verifyProof,
  ReplayCache,
} from "./session";

describe("Session cryptography", () => {
  it("verifies assertions and rejects their replay", async () => {
    const key = await createIdentity();
    const cache = new ReplayCache();
    const jwt = await assertion(
      key.privateKey,
      "https://agent.example/client.json",
      "usr_random",
      "https://company.example",
    );
    await expect(
      verifyAssertion(
        jwt,
        key.publicKey,
        "https://agent.example/client.json",
        "usr_random",
        "https://company.example",
        cache,
      ),
    ).resolves.toMatchObject({ sub: "usr_random" });
    await expect(
      verifyAssertion(
        jwt,
        key.publicKey,
        "https://agent.example/client.json",
        "usr_random",
        "https://company.example",
        cache,
      ),
    ).rejects.toThrow();
  });
  it("accepts PS384 and any lifetime up to 5 minutes, and refuses longer (§4.1)", async () => {
    const { generateKeyPair, exportJWK, SignJWT, importJWK } =
      await import("jose");
    const pair = await generateKeyPair("PS384", {
      modulusLength: 2048,
      extractable: true,
    });
    const rsa = {
      publicKey: { ...(await exportJWK(pair.publicKey)), kid: "rsa1" },
      privateKey: { ...(await exportJWK(pair.privateKey)), kid: "rsa1" },
    };
    const id = "https://agent.example/client.json";
    const ps = await assertion(
      rsa.privateKey,
      id,
      id,
      "https://issuer.example",
    );
    await expect(
      verifyAssertion(
        ps,
        rsa.publicKey,
        id,
        id,
        "https://issuer.example",
        new ReplayCache(),
      ),
    ).resolves.toBeTruthy();
    const ec = await createIdentity();
    const lasting = async (seconds: number, age: number) => {
      const now = Math.floor(Date.now() / 1000) - age;
      return new SignJWT({})
        .setProtectedHeader({ alg: "ES256", kid: ec.privateKey.kid })
        .setIssuer(id)
        .setSubject(id)
        .setAudience("https://issuer.example")
        .setIssuedAt(now)
        .setExpirationTime(now + seconds)
        .setJti(`j${seconds}${age}`)
        .sign(await importJWK(ec.privateKey, "ES256"));
    };
    const check = async (jwt: string) =>
      verifyAssertion(
        jwt,
        ec.publicKey,
        id,
        id,
        "https://issuer.example",
        new ReplayCache(),
      );
    // Five minutes, used after two: still valid for its lifetime.
    await expect(check(await lasting(300, 120))).resolves.toBeTruthy();
    await expect(check(await lasting(301, 0))).rejects.toThrow();
  });

  it("rejects another Company's audience", async () => {
    const key = await createIdentity();
    const jwt = await assertion(
      key.privateKey,
      "https://agent.example",
      "user",
      "https://company.example",
    );
    await expect(
      verifyAssertion(
        jwt,
        key.publicKey,
        "https://agent.example",
        "user",
        "https://other.example",
        new ReplayCache(),
      ),
    ).rejects.toThrow();
  });
  it("binds proofs to tokens, URLs, and methods", async () => {
    const key = await createIdentity();
    const url = "https://company.example/api/products";
    const jwt = await proof(key.privateKey, url, "GET", "fake-test-token");
    await expect(
      verifyProof(jwt, url, "GET", new ReplayCache(), "fake-test-token"),
    ).resolves.toBeTypeOf("string");
    await expect(
      verifyProof(jwt, url, "POST", new ReplayCache(), "fake-test-token"),
    ).rejects.toThrow();
    await expect(
      verifyProof(jwt, url, "GET", new ReplayCache(), "wrong-token"),
    ).rejects.toThrow();
    await expect(
      verifyProof(
        jwt,
        "https://company.example/api/other",
        "GET",
        new ReplayCache(),
        "fake-test-token",
      ),
    ).rejects.toThrow();
  });
  it("rejects a different DPoP binding and repeated proof", async () => {
    const key = await createIdentity();
    const url = "https://company.example/token";
    const cache = new ReplayCache();
    const jwt = await proof(key.privateKey, url, "POST");
    await expect(verifyProof(jwt, url, "POST", cache)).resolves.toBeTypeOf(
      "string",
    );
    await expect(verifyProof(jwt, url, "POST", cache)).rejects.toThrow();
    await expect(
      verifyProof(
        jwt,
        url,
        "POST",
        new ReplayCache(),
        undefined,
        "wrong-binding",
      ),
    ).rejects.toThrow();
  });
});
